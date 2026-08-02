/**
 * Compiles the app's per-layer colorization rules into a
 * `SurfaceStyleEvaluator` and delegates the vertex walk to
 * `@cityjson/navara-core`.
 *
 * The rule engine (`matchRule`), the roof metrics and the format-agnostic
 * recoloring loop all live in `@cityjson/navara-core` now (M7.2 of the Navara
 * migration); this file is the thin app-side adapter that keeps
 * `buildRuleColorsFromArrays` and `buildRuleColors` at their previous
 * signatures and semantics, so the FCB worker and the R3F scene are
 * unaffected until they are rewired in Parts B and C.
 */

import type { BufferGeometry } from "three";
import {
  buildStyleColorsFromArrays,
  computeRoofMetrics,
  matchRule,
  srgbHexToLinear,
  type PickingIndex,
  type RGB,
  type Rule,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import type { CityModel } from "../domain/citymodel/types";

export { srgbHexToLinear };
export type { SurfaceStyleEvaluator };

const linearCache = new Map<string, RGB>();
function cachedLinear(hex: string): RGB {
  let c = linearCache.get(hex);
  if (!c) {
    c = srgbHexToLinear(hex);
    linearCache.set(hex, c);
  }
  return c;
}

/**
 * Compile enabled rules into a per-surface styling hook.
 *
 * Returns null when no rule is enabled, so callers can fall back to
 * baseColors without walking any vertices. Only RoofSurfaces are rule-colored
 * — every other semantic type keeps its base color.
 */
export function compileRuleEvaluator(
  rules: ReadonlyArray<Rule>,
): SurfaceStyleEvaluator | null {
  const enabledRules = rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return null;

  return (surface, object) => {
    if (surface.surface.type !== "RoofSurface") return null;

    const metrics = computeRoofMetrics(surface.surface);
    // Merge object attributes and surface attributes for rule evaluation
    const attributes = {
      ...object.object.attributes,
      ...surface.surface.attributes,
    };
    const colorHex = matchRule(attributes, metrics, enabledRules);
    if (!colorHex) return null;

    return cachedLinear(colorHex);
  };
}

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Returns null if no rules produced any color changes (all non-roof
 * or no matches), allowing the caller to fall back to baseColors.
 *
 * Worker-safe: consumes plain typed arrays, no BufferGeometry/Color.
 */
export function buildRuleColorsFromArrays(
  model: CityModel,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: ReadonlyArray<string>,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const evaluate = compileRuleEvaluator(rules);
  if (!evaluate) return null;

  return buildStyleColorsFromArrays(
    model,
    objectIndices,
    surfaceIndices,
    objectKeys,
    evaluate,
    baseColors,
  );
}

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Thin wrapper around `buildRuleColorsFromArrays` — reads the object/surface
 * index attributes off the geometry and delegates. Kept for the static
 * (main-thread) rendering path.
 */
export function buildRuleColors(
  model: CityModel,
  geometry: BufferGeometry,
  pickingIndex: PickingIndex,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const vertexCount = objIdxAttr.count;
  const objectIndices = new Uint32Array(vertexCount);
  const surfaceIndices = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    objectIndices[v] = objIdxAttr.getX(v);
    surfaceIndices[v] = surfIdxAttr.getX(v);
  }

  return buildRuleColorsFromArrays(
    model,
    objectIndices,
    surfaceIndices,
    pickingIndex.objectKeys,
    rules,
    baseColors,
  );
}
