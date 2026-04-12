/**
 * Converts normalized CityModel surfaces into Three.js BufferGeometry.
 *
 * This is the bridge between the domain model and the GPU.
 * It triangulates polygon surfaces and assigns vertex colors
 * based on semantic surface type.
 */

import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import type { BBox3, CityModel, Vec3 } from "../domain/citymodel/types";
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

interface SurfaceTriangulation {
  readonly vertices: ReadonlyArray<Vec3>;
  readonly triangles: ReadonlyArray<readonly [number, number, number]>;
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
  const triangulationCache = new Map<
    string,
    Array<SurfaceTriangulation | null>
  >();

  // Pass 1: count total triangles and build object key list
  let totalTriangles = 0;
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    objectKeys.push(id);
    const surfaceTriangulations: Array<SurfaceTriangulation | null> = [];
    for (const surface of obj.surfaces) {
      if (selectedLod !== null && surface.lod !== selectedLod) continue;
      const triangulation = triangulateSurface(surface.rings, obj.bbox);
      surfaceTriangulations.push(triangulation);
      totalTriangles += triangulation?.triangles.length ?? 0;
    }
    triangulationCache.set(id, surfaceTriangulations);
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
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    const surfaceTriangulations = triangulationCache.get(id) ?? [];
    let cachedSurfaceIdx = 0;

    for (let surfaceIdx = 0; surfaceIdx < obj.surfaces.length; surfaceIdx++) {
      const surface = obj.surfaces[surfaceIdx]!;
      if (selectedLod !== null && surface.lod !== selectedLod) continue;
      const color = SURFACE_COLORS[surface.type];
      const triangulation = surfaceTriangulations[cachedSurfaceIdx++] ?? null;
      if (!triangulation) continue;

      for (const triangle of triangulation.triangles) {
        const v0 = triangulation.vertices[triangle[0]]!;
        const v1 = triangulation.vertices[triangle[1]]!;
        const v2 = triangulation.vertices[triangle[2]]!;
        const base = writeIdx * 3;

        posArray[base] = v0[0] - originOffset[0];
        posArray[base + 1] = v0[1] - originOffset[1];
        posArray[base + 2] = v0[2] - originOffset[2];
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

function triangulateSurface(
  rings: ReadonlyArray<ReadonlyArray<Vec3>>,
  objectBBox: BBox3 | null,
): SurfaceTriangulation | null {
  if (rings.length === 0) return null;

  const exteriorRing = orientExteriorRing(rings[0], objectBBox);
  if (!exteriorRing || exteriorRing.length < 3) return null;

  const normal = computeNewellNormal(exteriorRing);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  if (normalLength === 0) return null;

  const basis = buildProjectionBasis(exteriorRing, [
    normal[0] / normalLength,
    normal[1] / normalLength,
    normal[2] / normalLength,
  ]);
  if (!basis) return null;

  const projectedContour = projectRingTo2D(exteriorRing, basis);
  const contourClockwise = ShapeUtils.isClockWise([...projectedContour]);

  const holeRings = rings
    .slice(1)
    .filter((ring) => ring.length >= 3)
    .map((ring) => [...ring]);
  const projectedHoles = holeRings.map((ring) => {
    const projectedHole = projectRingTo2D(ring, basis);
    const holeClockwise = ShapeUtils.isClockWise([...projectedHole]);
    return holeClockwise === contourClockwise
      ? [...projectedHole].reverse()
      : projectedHole;
  });

  const vertices = [exteriorRing, ...holeRings].flat();
  const triangles = ShapeUtils.triangulateShape(
    [...projectedContour],
    projectedHoles.map((hole) => [...hole]),
  ).map(
    (triangle) =>
      [triangle[0]!, triangle[1]!, triangle[2]!] as const satisfies readonly [
        number,
        number,
        number,
      ],
  );

  return { vertices, triangles };
}

function orientExteriorRing(
  ring: ReadonlyArray<Vec3> | undefined,
  objectBBox: BBox3 | null,
): ReadonlyArray<Vec3> | undefined {
  if (!ring || ring.length < 3 || !objectBBox) return ring;

  const normal = computeNewellNormal(ring);
  const normalLengthSq =
    normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2];
  if (normalLengthSq === 0) return ring;

  const faceCenter = computeRingCenter(ring);
  const objectCenter = [
    (objectBBox[0] + objectBBox[3]) / 2,
    (objectBBox[1] + objectBBox[4]) / 2,
    (objectBBox[2] + objectBBox[5]) / 2,
  ] as const;
  const toFace = [
    faceCenter[0] - objectCenter[0],
    faceCenter[1] - objectCenter[1],
    faceCenter[2] - objectCenter[2],
  ] as const;
  const dot =
    normal[0] * toFace[0] + normal[1] * toFace[1] + normal[2] * toFace[2];

  return dot < 0 ? [...ring].reverse() : ring;
}

function computeRingCenter(ring: ReadonlyArray<Vec3>): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;

  for (const v of ring) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }

  return [sx / ring.length, sy / ring.length, sz / ring.length];
}

// Newell's method is stable for arbitrary planar polygon winding.
function computeNewellNormal(ring: ReadonlyArray<Vec3>): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < ring.length; i++) {
    const current = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
  }

  return [nx, ny, nz];
}

interface ProjectionBasis {
  readonly origin: Vec3;
  readonly tangent: Vec3;
  readonly bitangent: Vec3;
}

function buildProjectionBasis(
  ring: ReadonlyArray<Vec3>,
  normal: Vec3,
): ProjectionBasis | null {
  const origin = ring[0]!;
  let tangent: Vec3 | null = null;

  for (let i = 1; i < ring.length; i++) {
    const edge = subtractVec3(ring[i]!, origin);
    const length = Math.hypot(edge[0], edge[1], edge[2]);
    if (length > 0) {
      tangent = [edge[0] / length, edge[1] / length, edge[2] / length];
      break;
    }
  }

  if (!tangent) return null;

  const bitangentRaw = crossVec3(normal, tangent);
  const bitangentLength = Math.hypot(
    bitangentRaw[0],
    bitangentRaw[1],
    bitangentRaw[2],
  );
  if (bitangentLength === 0) return null;

  const bitangent: Vec3 = [
    bitangentRaw[0] / bitangentLength,
    bitangentRaw[1] / bitangentLength,
    bitangentRaw[2] / bitangentLength,
  ];
  const tangentOrthoRaw = crossVec3(bitangent, normal);
  const tangentOrthoLength = Math.hypot(
    tangentOrthoRaw[0],
    tangentOrthoRaw[1],
    tangentOrthoRaw[2],
  );
  if (tangentOrthoLength === 0) return null;

  return {
    origin,
    tangent: [
      tangentOrthoRaw[0] / tangentOrthoLength,
      tangentOrthoRaw[1] / tangentOrthoLength,
      tangentOrthoRaw[2] / tangentOrthoLength,
    ],
    bitangent,
  };
}

function projectRingTo2D(
  ring: ReadonlyArray<Vec3>,
  basis: ProjectionBasis,
): Vector2[] {
  return ring.map((vertex) => {
    const offset = subtractVec3(vertex, basis.origin);
    return new Vector2(
      dotVec3(offset, basis.tangent),
      dotVec3(offset, basis.bitangent),
    );
  });
}

function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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
