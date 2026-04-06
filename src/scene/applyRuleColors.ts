/**
 * Builds a rule-colorized Float32Array from model + rules.
 *
 * Iterates all vertices in the geometry. For RoofSurface vertices,
 * evaluates rules and writes the matched color. For non-roof vertices,
 * copies from baseColors. Returns a new Float32Array that serves as
 * the restore baseline for the highlight layer.
 */

import { Color } from "three";
import type { BufferGeometry } from "three";
import type { CityModel } from "../domain/citymodel/types";
import { computeRoofMetrics } from "../domain/roofMetrics/metrics";
import { matchRule } from "../features/rules/evaluate";
import type { Rule } from "../features/rules/types";
import type { PickingIndex } from "./buildCityMesh";

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Returns null if no rules produced any color changes (all non-roof
 * or no matches), allowing the caller to fall back to baseColors.
 */
export function buildRuleColors(
  model: CityModel,
  geometry: BufferGeometry,
  pickingIndex: PickingIndex,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const enabledRules = rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return null;

  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const result = Float32Array.from(baseColors);
  let anyChange = false;

  // Cache: object index → object data, surface metrics
  const colorCache = new Map<string, Color | null>();

  const vertexCount = objIdxAttr.count;

  for (let v = 0; v < vertexCount; v++) {
    const objIdx = objIdxAttr.getX(v);
    const surfIdx = surfIdxAttr.getX(v);
    const cacheKey = `${objIdx}:${surfIdx}`;

    let ruleColor = colorCache.get(cacheKey);
    if (ruleColor === undefined) {
      ruleColor = resolveRuleColor(objIdx, surfIdx, model, pickingIndex, enabledRules);
      colorCache.set(cacheKey, ruleColor);
    }

    if (ruleColor) {
      const base = v * 3;
      result[base] = ruleColor.r;
      result[base + 1] = ruleColor.g;
      result[base + 2] = ruleColor.b;
      anyChange = true;
    }
  }

  return anyChange ? result : null;
}

function resolveRuleColor(
  objIdx: number,
  surfIdx: number,
  model: CityModel,
  pickingIndex: PickingIndex,
  rules: ReadonlyArray<Rule>,
): Color | null {
  const objectId = pickingIndex.objectKeys[objIdx];
  if (!objectId) return null;

  const object = model.objects[objectId];
  if (!object) return null;

  const surface = object.surfaces[surfIdx];
  if (!surface || surface.type !== "RoofSurface") return null;

  const metrics = computeRoofMetrics(surface);

  // Merge object attributes and surface attributes for rule evaluation
  const attributes = { ...object.attributes, ...surface.attributes };
  const colorHex = matchRule(attributes, metrics, rules);
  if (!colorHex) return null;

  return new Color(colorHex);
}
