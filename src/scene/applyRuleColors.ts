/**
 * The app's `BufferGeometry`-typed entry point into rule colorization.
 *
 * The rule engine (`matchRule`), the roof metrics, the format-agnostic
 * recoloring loop AND the rules -> `SurfaceStyleEvaluator` compile step all
 * live in `@cityjson/navara-core` now: `compileRuleEvaluator` and
 * `buildRuleColorsFromArrays` moved there in Task C5, when the FlatCityBuf
 * worker moved into `@cityjson/navara-flatcitybuf` and could no longer import
 * from the app. Both are re-exported here at their previous names and
 * signatures; what genuinely remains app-side is `buildRuleColors`, which
 * reads its index arrays off a three `BufferGeometry`.
 */

import type { BufferGeometry } from "three";
import {
  buildRuleColorsFromArrays,
  compileRuleEvaluator,
  type PickingIndex,
  type Rule,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import type { CityModel } from "../domain/citymodel/types";

export { buildRuleColorsFromArrays, compileRuleEvaluator };
export type { SurfaceStyleEvaluator };

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
