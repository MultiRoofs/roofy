/**
 * Converts normalized CityModel surfaces into Three.js BufferGeometry.
 *
 * This is the bridge between the domain model and the GPU.
 * It triangulates polygon surfaces using a simple fan triangulation
 * and assigns vertex colors based on semantic surface type.
 */

import { BufferAttribute, BufferGeometry, Color } from "three";
import type { CityModel, Vec3 } from "../domain/citymodel/types";
import { SURFACE_COLORS } from "./surfaceColors";

// ---------------------------------------------------------------------------
// Fan triangulation for convex-ish polygons
// ---------------------------------------------------------------------------

/**
 * Triangulates a polygon ring using fan triangulation from vertex 0.
 * This works correctly for convex polygons and is a reasonable
 * approximation for the mostly-planar faces in city models.
 *
 * Returns arrays of positions and colors for the generated triangles.
 */
function triangulateFan(
  ring: ReadonlyArray<Vec3>,
  color: Color,
  positions: number[],
  colors: number[],
  objectIndices: number[],
  surfaceIndices: number[],
  objectIdx: number,
  surfaceIdx: number,
): void {
  if (ring.length < 3) return;

  const v0 = ring[0]!;
  for (let i = 1; i < ring.length - 1; i++) {
    const v1 = ring[i]!;
    const v2 = ring[i + 1]!;

    positions.push(v0[0], v0[1], v0[2]);
    positions.push(v1[0], v1[1], v1[2]);
    positions.push(v2[0], v2[1], v2[2]);

    colors.push(color.r, color.g, color.b);
    colors.push(color.r, color.g, color.b);
    colors.push(color.r, color.g, color.b);

    objectIndices.push(objectIdx, objectIdx, objectIdx);
    surfaceIndices.push(surfaceIdx, surfaceIdx, surfaceIdx);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PickingIndex {
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
 * The geometry uses an origin offset to maintain float precision
 * for large coordinates. The returned offset should be applied
 * as a translation on the mesh or parent group.
 */
export function buildCityMesh(
  model: CityModel,
  originOffset: Vec3 = [0, 0, 0],
): CityMeshResult {
  const positions: number[] = [];
  const vertexColors: number[] = [];
  const objectIndices: number[] = [];
  const surfaceIndices: number[] = [];
  const objectKeys: string[] = [];

  // Object.entries preserves insertion order (guaranteed by the spec
  // for string keys). The integer objectIdx assigned here is the same
  // index used at pick-decode time via pickingIndex.objectKeys.
  let objectIdx = 0;
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    objectKeys.push(id);

    for (let surfaceIdx = 0; surfaceIdx < obj.surfaces.length; surfaceIdx++) {
      const surface = obj.surfaces[surfaceIdx]!;
      const color = SURFACE_COLORS[surface.type];
      // Only triangulate the exterior ring (index 0).
      // Interior rings are holes — proper hole handling requires
      // constrained triangulation (e.g. earcut), planned for M2.
      const exteriorRing = surface.rings[0];
      if (!exteriorRing) continue;
      const offsetRing: Vec3[] = exteriorRing.map((v) => [
        v[0] - originOffset[0],
        v[1] - originOffset[1],
        v[2] - originOffset[2],
      ]);
      triangulateFan(
        offsetRing,
        color,
        positions,
        vertexColors,
        objectIndices,
        surfaceIndices,
        objectIdx,
        surfaceIdx,
      );
    }

    objectIdx++;
  }

  const geometry = new BufferGeometry();
  const posArray = new Float32Array(positions);
  const colorArray = new Float32Array(vertexColors);

  geometry.setAttribute("position", new BufferAttribute(posArray, 3));
  geometry.setAttribute("color", new BufferAttribute(colorArray, 3));
  geometry.setAttribute(
    "objectIndex",
    new BufferAttribute(new Int32Array(objectIndices), 1),
  );
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(new Int32Array(surfaceIndices), 1),
  );
  geometry.computeVertexNormals();

  return {
    geometry,
    triangleCount: positions.length / 9,
    pickingIndex: { objectKeys },
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
