/**
 * Resolves a raycast hit (geometry + triangle vertex index) to the city
 * object and surface it belongs to.
 *
 * This is pick-mode-agnostic: it always reports the concrete surface that
 * was hit. Callers decide whether to build an object-level or surface-level
 * `Selection` from the result based on the active `PickMode`.
 */

import type { BufferGeometry } from "three";
import type { PickingIndex } from "./buildCityMesh";

export interface PickResult {
  readonly layerId: string;
  readonly objectId: string;
  readonly surfaceIndex: number;
}

/**
 * Resolves a picked triangle to its city object + surface via the geometry's
 * `objectIndex`/`surfaceIndex` attributes and the layer's picking index.
 *
 * `faceVertexIndex` is the index of any one vertex of the hit triangle
 * (e.g. a Three.js intersection's `face.a`) — all three vertices of a
 * triangle share the same object/surface index, so any of them works.
 */
export function resolveSelection(
  geometry: BufferGeometry,
  pickingIndex: PickingIndex,
  faceVertexIndex: number,
): PickResult | null {
  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const objectIdx = objIdxAttr.getX(faceVertexIndex);
  const objectId = pickingIndex.objectKeys[objectIdx];
  if (objectId === undefined) return null;

  const surfaceIndex = surfIdxAttr.getX(faceVertexIndex);
  return { layerId: pickingIndex.layerId, objectId, surfaceIndex };
}
