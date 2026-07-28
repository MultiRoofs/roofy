/**
 * Builds a rule-colorized Float32Array from model + rules.
 *
 * Iterates all vertices. For RoofSurface vertices, evaluates rules and
 * writes the matched color. For non-roof vertices, copies from baseColors.
 * Returns a new Float32Array that serves as the restore baseline for the
 * highlight layer.
 *
 * The array-based core (`buildRuleColorsFromArrays`) contains no Three.js
 * DOM/GPU types, so it can run inside a Web Worker. `buildRuleColors` is a
 * thin wrapper that reads the two index attributes off a `BufferGeometry`
 * and delegates, preserving the static (main-thread) path's signature.
 */

import type { BufferGeometry } from "three";
import type { CityModel } from "../domain/citymodel/types";
import { computeRoofMetrics } from "../domain/roofMetrics/metrics";
import { matchRule } from "../features/rules/evaluate";
import type { Rule } from "../features/rules/types";
import type { PickingIndex } from "./buildCityMesh";

type RGB = readonly [number, number, number];

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Expands a 3-digit CSS hex shorthand ("abc" -> "aabbcc") to 6 digits, or
 * passes a valid 6-digit hex through unchanged. Returns null for anything
 * else (wrong length, non-hex characters).
 *
 * CSS color names and rgb()/hsl() function syntax — which three.Color's
 * `setStyle` also accepts — are intentionally NOT supported here: `Rule.color`
 * is documented as "CSS hex color" only (see features/rules/types.ts), so
 * hex is the entire contract this function needs to honor.
 */
function expandHex(h: string): string | null {
  if (/^[0-9a-fA-F]{6}$/.test(h)) return h;
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  }
  return null;
}

/**
 * Matches three.Color's sRGB → Linear-sRGB conversion (ColorManagement on).
 * NOT hex/255 — see the parity test in ruleColorsWorkerSafe.test.ts. Accepts
 * both 3-digit ("#abc") and 6-digit ("#aabbcc") CSS hex shorthand, matching
 * three.Color's `setStyle` hex-parsing branch (3-digit expansion is
 * digit-duplication, verified numerically identical to three's own
 * per-digit `/15` computation — see the parity tests).
 *
 * For anything that isn't a valid 3- or 6-digit hex string, logs a warning
 * and falls back to white ([1, 1, 1]) — the same fallback `new Color(...)`
 * itself produces for malformed/unrecognized color strings on a freshly
 * constructed instance. Silently producing a plausible-looking wrong color
 * is the failure mode this guards against: an invalid `rule.color` should
 * render as an obviously-wrong bright white, not a quietly-incorrect shade.
 */
export function srgbHexToLinear(hex: string): RGB {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const expanded = expandHex(h);
  if (expanded === null) {
    console.warn(
      `srgbHexToLinear: invalid hex color "${hex}" — expected 3 or 6 hex digits, falling back to white`,
    );
    return [1, 1, 1];
  }
  const n = parseInt(expanded, 16);
  return [
    srgbChannelToLinear(((n >> 16) & 255) / 255),
    srgbChannelToLinear(((n >> 8) & 255) / 255),
    srgbChannelToLinear((n & 255) / 255),
  ];
}

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
  const enabledRules = rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return null;

  const result = Float32Array.from(baseColors);
  let anyChange = false;

  // Cache: "objIdx:surfIdx" → resolved linear-sRGB color, or null (no match)
  const colorCache = new Map<string, RGB | null>();

  for (let v = 0; v < objectIndices.length; v++) {
    const objIdx = objectIndices[v]!;
    const surfIdx = surfaceIndices[v]!;
    const cacheKey = `${objIdx}:${surfIdx}`;

    let ruleColor = colorCache.get(cacheKey);
    if (ruleColor === undefined) {
      ruleColor = resolveRuleColor(
        objIdx,
        surfIdx,
        model,
        { layerId: "", objectKeys },
        enabledRules,
      );
      colorCache.set(cacheKey, ruleColor);
    }

    if (ruleColor) {
      const base = v * 3;
      result[base] = ruleColor[0];
      result[base + 1] = ruleColor[1];
      result[base + 2] = ruleColor[2];
      anyChange = true;
    }
  }

  return anyChange ? result : null;
}

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Thin wrapper around `buildRuleColorsFromArrays` — reads the object/surface
 * index attributes off the geometry and delegates. Kept for the static
 * (main-thread) rendering path; see `buildRuleColorsFromArrays` for the
 * worker-safe core.
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

function resolveRuleColor(
  objIdx: number,
  surfIdx: number,
  model: CityModel,
  pickingIndex: PickingIndex,
  rules: ReadonlyArray<Rule>,
): RGB | null {
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

  return cachedLinear(colorHex);
}
