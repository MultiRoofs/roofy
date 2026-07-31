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

/**
 * Plain-array output of the CityModel → mesh conversion, with no Three.js
 * DOM/GPU types. Safe to construct inside a Web Worker; the caller is
 * responsible for wrapping these into a BufferGeometry (see `buildCityMesh`).
 */
export interface CityMeshArrays {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly objectIndices: Uint32Array;
  readonly surfaceIndices: Uint32Array;
  readonly objectKeys: string[];
  readonly triangleCount: number;
}

interface SurfaceTriangulation {
  readonly vertices: ReadonlyArray<Vec3>;
  readonly triangles: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * Build a single merged BufferGeometry from all surfaces in a CityModel.
 * Vertex colors encode the semantic surface type.
 *
 * Thin wrapper around `buildCityMeshArrays` — see that function for the
 * actual triangulation/coloring/normal logic (worker-safe, no Three.js
 * DOM/GPU types).
 *
 * `originOffset` is an INPUT, not something this function computes or
 * returns: every vertex position is written as `coordinate - originOffset`
 * (see `buildCityMeshArrays` below), so the offset is already baked into the
 * geometry's own positions. Callers get the offset to pass in from
 * `computeOriginOffset` (below) and are responsible for keeping the mesh/
 * group's OWN transform in whatever frame they chose — this function neither
 * applies nor reports a translation itself.
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

/**
 * Convert normalized CityModel surfaces into plain typed arrays: positions,
 * per-triangle face normals, vertex colors, and picking indices.
 *
 * Uses a two-pass approach for large-model performance:
 * Pass 1: count total triangles to pre-allocate typed arrays.
 * Pass 2: write directly into typed arrays (no intermediate number[]).
 *
 * Normals are computed per-triangle (flat face normal) and written
 * identically to all three of that triangle's vertices. Because the
 * geometry is non-indexed (no vertex sharing across triangles), this is
 * exactly what `BufferGeometry.computeVertexNormals()` produces: each
 * vertex belongs to only one triangle, so the "accumulated" normal is
 * just that triangle's own face normal, normalized.
 *
 * Contains no Three.js DOM/GPU types (no BufferGeometry/BufferAttribute),
 * so it can run inside a Web Worker.
 */
export function buildCityMeshArrays(
  model: CityModel,
  layerId: string,
  originOffset: Vec3 = [0, 0, 0],
  selectedLod: string | null = null,
): CityMeshArrays {
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
  const normalArray = new Float32Array(vertexCount * 3);
  const colorArray = new Float32Array(vertexCount * 3);
  const objIdxArray = new Uint32Array(vertexCount);
  const surfIdxArray = new Uint32Array(vertexCount);

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

        // Flat face normal, written to all three vertices. The geometry is
        // non-indexed (no vertex sharing across triangles), so this exactly
        // reproduces what BufferGeometry.computeVertexNormals() computes:
        // normal = normalize(cross(v2 - v1, v0 - v1)).
        //
        // Critically, this must be derived from the values just written
        // into posArray (already rounded to Float32), NOT from the
        // double-precision v0/v1/v2. computeVertexNormals() reads from the
        // Float32Array position attribute, so for a triangle whose
        // double-precision area is tiny relative to its coordinate
        // magnitude, Float32 rounding can collapse two vertices onto the
        // same representable value and zero out the cross product — a
        // real behavioral case that reading from v0/v1/v2 directly would
        // miss (it would "see" the double-precision area and produce a
        // non-zero normal where the old computeVertexNormals()-based
        // implementation produced zero).
        const [nx, ny, nz] = computeFaceNormal(
          posArray[base]!,
          posArray[base + 1]!,
          posArray[base + 2]!,
          posArray[base + 3]!,
          posArray[base + 4]!,
          posArray[base + 5]!,
          posArray[base + 6]!,
          posArray[base + 7]!,
          posArray[base + 8]!,
        );
        normalArray[base] = nx;
        normalArray[base + 1] = ny;
        normalArray[base + 2] = nz;
        normalArray[base + 3] = nx;
        normalArray[base + 4] = ny;
        normalArray[base + 5] = nz;
        normalArray[base + 6] = nx;
        normalArray[base + 7] = ny;
        normalArray[base + 8] = nz;

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

  return {
    positions: posArray,
    normals: normalArray,
    colors: colorArray,
    objectIndices: objIdxArray,
    surfaceIndices: surfIdxArray,
    objectKeys,
    triangleCount: totalTriangles,
  };
}

/**
 * Flat face normal for a triangle, normalized to unit length (or the zero
 * vector for a degenerate/zero-area triangle — matching
 * `Vector3.normalize()`'s `divideScalar(length() || 1)`, which leaves a
 * zero-length vector as `(0,0,0)` rather than producing `NaN`).
 *
 * Takes the three vertices as plain numbers already read back from the
 * Float32Array position buffer (see call site) — NOT double-precision
 * coordinates — because `BufferGeometry.computeVertexNormals()` operates on
 * the Float32-rounded position attribute. Uses the same vertex pairing and
 * cross-product order as that function (`cross(pC - pB, pA - pB)`) so
 * results match bit-for-bit (within float rounding) with what the old
 * `computeVertexNormals()`-based implementation produced for non-indexed
 * geometry, including the case where Float32 rounding collapses a
 * double-precision-nondegenerate triangle to zero area.
 */
function computeFaceNormal(
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
): Vec3 {
  const cbx = p2x - p1x;
  const cby = p2y - p1y;
  const cbz = p2z - p1z;
  const abx = p0x - p1x;
  const aby = p0y - p1y;
  const abz = p0z - p1z;
  const nx = cby * abz - cbz * aby;
  const ny = cbz * abx - cbx * abz;
  const nz = cbx * aby - cby * abx;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return [0, 0, 0];
  return [nx / length, ny / length, nz / length];
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
