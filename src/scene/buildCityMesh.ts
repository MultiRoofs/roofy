/**
 * Converts normalized CityModel surfaces into Three.js BufferGeometry.
 *
 * This is the bridge between the domain model and the GPU.
 * It triangulates polygon surfaces using a simple fan triangulation
 * and assigns vertex colors based on semantic surface type.
 */

import { BufferAttribute, BufferGeometry } from "three";
import type { CityModel, Vec3 } from "../domain/citymodel/types";
import { SURFACE_COLORS } from "./surfaceColors";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PickingIndex {
  /** ID of the layer this mesh belongs to. */
  readonly layerId: string;
  /** Ordered list of CityObject IDs, one per unique object index. */
  readonly objectKeys: ReadonlyArray<string>;
}

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
 * Uses a two-pass approach for large-model performance:
 * Pass 1: count total triangles to pre-allocate typed arrays.
 * Pass 2: write directly into typed arrays (no intermediate number[]).
 *
 * The geometry uses an origin offset to maintain float precision
 * for large coordinates. The returned offset should be applied
 * as a translation on the mesh or parent group.
 */
export function buildCityMesh(
  model: CityModel,
  layerId: string,
  originOffset: Vec3 = [0, 0, 0],
  selectedLod: string | null = null,
): CityMeshResult {
  const objectKeys: string[] = [];

  // Pass 1: count total triangles and build object key list
  let totalTriangles = 0;
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    objectKeys.push(id);
    for (const surface of obj.surfaces) {
      if (selectedLod !== null && surface.lod !== selectedLod) continue;
      const ring = surface.rings[0];
      if (ring && ring.length >= 3) {
        totalTriangles += ring.length - 2;
      }
    }
  }

  const vertexCount = totalTriangles * 3;

  // Pre-allocate typed arrays (avoids dynamic array growth and copy)
  const posArray = new Float32Array(vertexCount * 3);
  const colorArray = new Float32Array(vertexCount * 3);
  const objIdxArray = new Int32Array(vertexCount);
  const surfIdxArray = new Int32Array(vertexCount);

  // Pass 2: write directly into typed arrays
  let writeIdx = 0;
  let objectIdx = 0;
  for (const obj of Object.values(model.objects)) {
    if (!obj) continue;

    for (let surfaceIdx = 0; surfaceIdx < obj.surfaces.length; surfaceIdx++) {
      const surface = obj.surfaces[surfaceIdx]!;
      if (selectedLod !== null && surface.lod !== selectedLod) continue;
      const color = SURFACE_COLORS[surface.type];
      // Only triangulate the exterior ring (index 0).
      // Interior rings are holes — proper hole handling requires
      // constrained triangulation (e.g. earcut).
      const exteriorRing = surface.rings[0];
      if (!exteriorRing || exteriorRing.length < 3) continue;

      const v0 = exteriorRing[0]!;
      const v0x = v0[0] - originOffset[0];
      const v0y = v0[1] - originOffset[1];
      const v0z = v0[2] - originOffset[2];

      for (let i = 1; i < exteriorRing.length - 1; i++) {
        const v1 = exteriorRing[i]!;
        const v2 = exteriorRing[i + 1]!;
        const base = writeIdx * 3;

        posArray[base] = v0x;
        posArray[base + 1] = v0y;
        posArray[base + 2] = v0z;
        posArray[base + 3] = v1[0] - originOffset[0];
        posArray[base + 4] = v1[1] - originOffset[1];
        posArray[base + 5] = v1[2] - originOffset[2];
        posArray[base + 6] = v2[0] - originOffset[0];
        posArray[base + 7] = v2[1] - originOffset[1];
        posArray[base + 8] = v2[2] - originOffset[2];

        colorArray[base] = color.r;
        colorArray[base + 1] = color.g;
        colorArray[base + 2] = color.b;
        colorArray[base + 3] = color.r;
        colorArray[base + 4] = color.g;
        colorArray[base + 5] = color.b;
        colorArray[base + 6] = color.r;
        colorArray[base + 7] = color.g;
        colorArray[base + 8] = color.b;

        objIdxArray[writeIdx] = objectIdx;
        objIdxArray[writeIdx + 1] = objectIdx;
        objIdxArray[writeIdx + 2] = objectIdx;
        surfIdxArray[writeIdx] = surfaceIdx;
        surfIdxArray[writeIdx + 1] = surfaceIdx;
        surfIdxArray[writeIdx + 2] = surfaceIdx;

        writeIdx += 3;
      }
    }

    objectIdx++;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(posArray, 3));
  geometry.setAttribute("color", new BufferAttribute(colorArray, 3));
  geometry.setAttribute("objectIndex", new BufferAttribute(objIdxArray, 1));
  geometry.setAttribute("surfaceIndex", new BufferAttribute(surfIdxArray, 1));
  geometry.computeVertexNormals();

  return {
    geometry,
    triangleCount: totalTriangles,
    pickingIndex: { layerId, objectKeys },
    baseColors: Float32Array.from(colorArray),
  };
}

/**
 * Compute a good origin offset from a CityModel's bounding box.
 * Uses the center of the bbox to minimize coordinate magnitudes.
 */
export function computeOriginOffset(model: CityModel): Vec3 {
  if (!model.bbox) return [0, 0, 0];
  return [
    (model.bbox[0] + model.bbox[3]) / 2,
    (model.bbox[1] + model.bbox[4]) / 2,
    (model.bbox[2] + model.bbox[5]) / 2,
  ];
}
