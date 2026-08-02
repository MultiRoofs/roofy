/**
 * Wraps `@cityjson/navara-core`'s renderer-agnostic mesh arrays into a
 * Three.js BufferGeometry.
 *
 * The triangulation/normals/coloring live in the core package (M7.2 of the
 * Navara migration); this file is only the Three.js-specific tail of the
 * pipeline and disappears with the R3F scene in M7.3/M7.7.
 */

import { BufferAttribute, BufferGeometry } from "three";
import {
  buildCityMeshArrays,
  computeOriginOffset,
  type CityMeshArrays,
  type PickingIndex,
} from "@cityjson/navara-core";
import type { CityModel, Vec3 } from "../domain/citymodel/types";

export { buildCityMeshArrays, computeOriginOffset };
export type { CityMeshArrays, PickingIndex };

export interface CityMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly pickingIndex: PickingIndex;
  /** Snapshot of vertex colors before any highlight mutations. */
  readonly baseColors: Float32Array;
}

/**
 * Build a single merged BufferGeometry from all surfaces in a CityModel.
 * Vertex colors encode the semantic surface type.
 *
 * `originOffset` is an INPUT, not something this function computes or
 * returns: every vertex position is written as `coordinate - originOffset`,
 * so the offset is already baked into the geometry's own positions. Callers
 * get the offset to pass in from `computeOriginOffset` and are responsible
 * for keeping the mesh/group's OWN transform in whatever frame they chose.
 */
export function buildCityMesh(
  model: CityModel,
  layerId: string,
  originOffset: Vec3 = [0, 0, 0],
  selectedLod: string | null = null,
): CityMeshResult {
  const a = buildCityMeshArrays(model, layerId, originOffset, selectedLod);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(a.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(a.colors, 3));
  geometry.setAttribute("normal", new BufferAttribute(a.normals, 3));
  geometry.setAttribute("objectIndex", new BufferAttribute(a.objectIndices, 1));
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(a.surfaceIndices, 1),
  );

  return {
    geometry,
    triangleCount: a.triangleCount,
    pickingIndex: { layerId, objectKeys: a.objectKeys },
    baseColors: Float32Array.from(a.colors),
  };
}
