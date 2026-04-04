/**
 * Parser that converts a raw CityJSON object into a normalized CityModel.
 *
 * Responsibilities:
 * - Dequantize integer vertices using the transform object
 * - Extract surfaces with semantic labels from geometry boundaries
 * - Compute per-object and model-level bounding boxes
 * - Map CityJSON metadata to the format-agnostic CityModelMetadata
 */

import type {
  BBox3,
  BuildingSurfaceType,
  CityModel,
  CityModelMetadata,
  CityObject,
  Surface,
  Vec3,
} from "../types";
import type {
  CityJSONObject,
  CityJSONRoot,
  CityJSONSemanticSurface,
  CityJSONSurfaceGeometry,
  CityJSONTransform,
  CityJSONVertex,
} from "./types";

// ---------------------------------------------------------------------------
// Vertex dequantization
// ---------------------------------------------------------------------------

function dequantizeVertex(
  v: CityJSONVertex,
  transform: CityJSONTransform,
): Vec3 {
  return [
    v[0] * transform.scale[0] + transform.translate[0],
    v[1] * transform.scale[1] + transform.translate[1],
    v[2] * transform.scale[2] + transform.translate[2],
  ];
}

function dequantizeAll(
  vertices: ReadonlyArray<CityJSONVertex>,
  transform: CityJSONTransform,
): Vec3[] {
  return vertices.map((v) => dequantizeVertex(v, transform));
}

// ---------------------------------------------------------------------------
// Bounding box helpers
// ---------------------------------------------------------------------------

function expandBBox(bbox: [number, number, number, number, number, number], v: Vec3): void {
  if (v[0] < bbox[0]) bbox[0] = v[0];
  if (v[1] < bbox[1]) bbox[1] = v[1];
  if (v[2] < bbox[2]) bbox[2] = v[2];
  if (v[0] > bbox[3]) bbox[3] = v[0];
  if (v[1] > bbox[4]) bbox[4] = v[1];
  if (v[2] > bbox[5]) bbox[5] = v[2];
}

function mergeBBox(
  a: BBox3 | null,
  b: BBox3 | null,
): BBox3 | null {
  if (a === null) return b;
  if (b === null) return a;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.max(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

// ---------------------------------------------------------------------------
// Semantic type resolution
// ---------------------------------------------------------------------------

const KNOWN_BUILDING_SURFACE_TYPES = new Set<string>([
  "RoofSurface",
  "WallSurface",
  "GroundSurface",
  "ClosureSurface",
  "OuterCeilingSurface",
  "OuterFloorSurface",
  "Window",
  "Door",
]);

function resolveSemanticType(
  sem: CityJSONSemanticSurface | undefined,
): BuildingSurfaceType {
  if (!sem) return "unknown";
  if (KNOWN_BUILDING_SURFACE_TYPES.has(sem.type)) {
    return sem.type as BuildingSurfaceType;
  }
  return "unknown";
}

function extractSemanticAttributes(
  sem: CityJSONSemanticSurface | undefined,
): Record<string, unknown> {
  if (!sem) return {};
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sem)) {
    if (key !== "type" && key !== "parent" && key !== "children") {
      attrs[key] = value;
    }
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Surface extraction from MultiSurface / CompositeSurface boundaries
// ---------------------------------------------------------------------------

/**
 * Extract surfaces from a MultiSurface or CompositeSurface geometry.
 *
 * MultiSurface boundaries: [ surface, surface, ... ]
 * Each surface: [ ring, ring, ... ] where ring is [v0, v1, v2, ...]
 * CompositeSurface has the same boundary structure.
 */
function extractSurfacesFromMultiSurface(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
): Surface[] {
  const boundaries = geom.boundaries as ReadonlyArray<
    ReadonlyArray<ReadonlyArray<number>>
  >;
  const semanticSurfaces = geom.semantics?.surfaces;
  const semanticValues = geom.semantics?.values as
    | ReadonlyArray<number | null>
    | undefined;

  const surfaces: Surface[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const surfaceBoundary = boundaries[i]!;
    const semanticIndex =
      semanticValues !== undefined ? semanticValues[i] : undefined;
    const sem =
      semanticIndex !== undefined &&
      semanticIndex !== null &&
      semanticSurfaces
        ? semanticSurfaces[semanticIndex]
        : undefined;

    const rings: Vec3[][] = [];
    for (const ring of surfaceBoundary) {
      const realRing: Vec3[] = [];
      for (const idx of ring) {
        const v = realVertices[idx];
        if (v) {
          realRing.push(v);
          expandBBox(objectBBox, v);
        }
      }
      rings.push(realRing);
    }

    surfaces.push({
      type: resolveSemanticType(sem),
      rings,
      attributes: extractSemanticAttributes(sem),
    });
  }

  return surfaces;
}

// ---------------------------------------------------------------------------
// Surface extraction from Solid boundaries
// ---------------------------------------------------------------------------

/**
 * Extract surfaces from a Solid geometry.
 *
 * Solid boundaries: [ shell, shell, ... ]
 * Each shell: [ surface, surface, ... ] (same as MultiSurface)
 *
 * Semantic values for Solid: [ shell_values, ... ]
 * Each shell_values: [ idx_or_null, ... ]
 */
function extractSurfacesFromSolid(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
): Surface[] {
  const shells = geom.boundaries as ReadonlyArray<
    ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  >;
  const semanticSurfaces = geom.semantics?.surfaces;
  const shellValues = geom.semantics?.values as
    | ReadonlyArray<ReadonlyArray<number | null>>
    | undefined;

  const surfaces: Surface[] = [];

  for (let si = 0; si < shells.length; si++) {
    const shell = shells[si]!;
    const surfaceValues = shellValues?.[si];

    for (let fi = 0; fi < shell.length; fi++) {
      const surfaceBoundary = shell[fi]!;
      const semanticIndex =
        surfaceValues !== undefined ? surfaceValues[fi] : undefined;
      const sem =
        semanticIndex !== undefined &&
        semanticIndex !== null &&
        semanticSurfaces
          ? semanticSurfaces[semanticIndex]
          : undefined;

      const rings: Vec3[][] = [];
      for (const ring of surfaceBoundary) {
        const realRing: Vec3[] = [];
        for (const idx of ring) {
          const v = realVertices[idx];
          if (v) {
            realRing.push(v);
            expandBBox(objectBBox, v);
          }
        }
        rings.push(realRing);
      }

      surfaces.push({
        type: resolveSemanticType(sem),
        rings,
        attributes: extractSemanticAttributes(sem),
      });
    }
  }

  return surfaces;
}

// ---------------------------------------------------------------------------
// Surface extraction from CompositeSolid / MultiSolid boundaries
// ---------------------------------------------------------------------------

function extractSurfacesFromCompositeSolid(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
): Surface[] {
  const solids = geom.boundaries as ReadonlyArray<
    ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>
  >;
  const semanticSurfaces = geom.semantics?.surfaces;
  const solidValues = geom.semantics?.values as
    | ReadonlyArray<ReadonlyArray<ReadonlyArray<number | null>>>
    | undefined;

  const surfaces: Surface[] = [];

  for (let soi = 0; soi < solids.length; soi++) {
    const shells = solids[soi]!;
    const shellValues = solidValues?.[soi];

    for (let si = 0; si < shells.length; si++) {
      const shell = shells[si]!;
      const surfaceValues = shellValues?.[si];

      for (let fi = 0; fi < shell.length; fi++) {
        const surfaceBoundary = shell[fi]!;
        const semanticIndex =
          surfaceValues !== undefined ? surfaceValues[fi] : undefined;
        const sem =
          semanticIndex !== undefined &&
          semanticIndex !== null &&
          semanticSurfaces
            ? semanticSurfaces[semanticIndex]
            : undefined;

        const rings: Vec3[][] = [];
        for (const ring of surfaceBoundary) {
          const realRing: Vec3[] = [];
          for (const idx of ring) {
            const v = realVertices[idx];
            if (v) {
              realRing.push(v);
              expandBBox(objectBBox, v);
            }
          }
          rings.push(realRing);
        }

        surfaces.push({
          type: resolveSemanticType(sem),
          rings,
          attributes: extractSemanticAttributes(sem),
        });
      }
    }
  }

  return surfaces;
}

// ---------------------------------------------------------------------------
// Geometry dispatch
// ---------------------------------------------------------------------------

function extractSurfaces(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
): Surface[] {
  switch (geom.type) {
    case "MultiSurface":
    case "CompositeSurface":
      return extractSurfacesFromMultiSurface(geom, realVertices, objectBBox);
    case "Solid":
      return extractSurfacesFromSolid(geom, realVertices, objectBBox);
    case "MultiSolid":
    case "CompositeSolid":
      return extractSurfacesFromCompositeSolid(geom, realVertices, objectBBox);
    default:
      // MultiPoint, MultiLineString — not surface-based, skip
      return [];
  }
}

// ---------------------------------------------------------------------------
// Object parsing
// ---------------------------------------------------------------------------

function parseCityObject(
  id: string,
  raw: CityJSONObject,
  realVertices: Vec3[],
): CityObject {
  const allSurfaces: Surface[] = [];
  const objectBBox: [number, number, number, number, number, number] = [
    Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity,
  ];
  let lod: string | null = null;

  for (const geom of raw.geometry ?? []) {
    if (geom.type === "GeometryInstance") continue;
    if (!lod) lod = geom.lod;
    const surfaces = extractSurfaces(geom, realVertices, objectBBox);
    allSurfaces.push(...surfaces);
  }

  const hasBBox = objectBBox[0] !== Infinity;

  return {
    id,
    objectType: raw.type,
    attributes: raw.attributes ?? {},
    surfaces: allSurfaces,
    bbox: hasBBox
      ? [objectBBox[0], objectBBox[1], objectBBox[2], objectBBox[3], objectBBox[4], objectBBox[5]]
      : null,
    children: raw.children ? [...raw.children] : [],
    parents: raw.parents ? [...raw.parents] : [],
    lod,
  };
}

// ---------------------------------------------------------------------------
// Metadata mapping
// ---------------------------------------------------------------------------

function mapMetadata(
  raw: CityJSONRoot["metadata"],
): CityModelMetadata {
  if (!raw) return {};
  return {
    title: raw.title,
    identifier: raw.identifier,
    referenceDate: raw.referenceDate,
    referenceSystem: raw.referenceSystem,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseCityJSON(root: CityJSONRoot): CityModel {
  if (!root.version.startsWith("2.")) {
    throw new Error(
      `Unsupported CityJSON version "${root.version}". Only v2.x is supported.`,
    );
  }

  const realVertices = dequantizeAll(root.vertices, root.transform);

  const objects: Record<string, CityObject> = {};
  let modelBBox: BBox3 | null = null;

  for (const [id, rawObj] of Object.entries(root.CityObjects) as [string, CityJSONObject][]) {
    const obj = parseCityObject(id, rawObj, realVertices);
    objects[id] = obj;
    modelBBox = mergeBBox(modelBBox, obj.bbox);
  }

  return {
    sourceEncoding: "cityjson",
    metadata: mapMetadata(root.metadata),
    bbox: modelBBox,
    objects,
    vertexCount: root.vertices.length,
  };
}
