/**
 * Shared parsing helpers for CityJSON-family formats.
 *
 * Both CityJSON and CityJSONSeq (CityJSON Text Sequences) use the same
 * object and geometry schema. This module provides the low-level
 * primitives — dequantization, surface extraction, bbox computation,
 * and per-object parsing — so each format parser can compose them.
 */

import type {
  BBox3,
  BuildingSurfaceType,
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

export function dequantizeAll(
  vertices: ReadonlyArray<CityJSONVertex>,
  transform: CityJSONTransform,
): Vec3[] {
  return vertices.map((v) => dequantizeVertex(v, transform));
}

// ---------------------------------------------------------------------------
// Bounding box helpers
// ---------------------------------------------------------------------------

function expandBBox(
  bbox: [number, number, number, number, number, number],
  v: Vec3,
): void {
  if (v[0] < bbox[0]) bbox[0] = v[0];
  if (v[1] < bbox[1]) bbox[1] = v[1];
  if (v[2] < bbox[2]) bbox[2] = v[2];
  if (v[0] > bbox[3]) bbox[3] = v[0];
  if (v[1] > bbox[4]) bbox[4] = v[1];
  if (v[2] > bbox[5]) bbox[5] = v[2];
}

export function mergeBBox(a: BBox3 | null, b: BBox3 | null): BBox3 | null {
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

function extractSurfacesFromMultiSurface(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
  lod: string | null,
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
      semanticIndex !== undefined && semanticIndex !== null && semanticSurfaces
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
      lod,
    });
  }

  return surfaces;
}

// ---------------------------------------------------------------------------
// Surface extraction from Solid boundaries
// ---------------------------------------------------------------------------

function extractSurfacesFromSolid(
  geom: CityJSONSurfaceGeometry,
  realVertices: Vec3[],
  objectBBox: [number, number, number, number, number, number],
  lod: string | null,
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
        lod,
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
  lod: string | null,
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
          lod,
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
  lod: string | null,
): Surface[] {
  switch (geom.type) {
    case "MultiSurface":
    case "CompositeSurface":
      return extractSurfacesFromMultiSurface(
        geom,
        realVertices,
        objectBBox,
        lod,
      );
    case "Solid":
      return extractSurfacesFromSolid(geom, realVertices, objectBBox, lod);
    case "MultiSolid":
    case "CompositeSolid":
      return extractSurfacesFromCompositeSolid(
        geom,
        realVertices,
        objectBBox,
        lod,
      );
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Object parsing
// ---------------------------------------------------------------------------

export function parseCityObject(
  id: string,
  raw: CityJSONObject,
  realVertices: Vec3[],
): CityObject {
  const allSurfaces: Surface[] = [];
  const objectBBox: [number, number, number, number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  let lod: string | null = null;

  for (const geom of raw.geometry ?? []) {
    if (geom.type === "GeometryInstance") continue;
    const geomLod = geom.lod ?? null;
    // Track highest LoD for display purposes
    if (
      geomLod !== null &&
      (lod === null || parseFloat(geomLod) > parseFloat(lod))
    ) {
      lod = geomLod;
    }
    const surfaces = extractSurfaces(geom, realVertices, objectBBox, geomLod);
    allSurfaces.push(...surfaces);
  }

  const hasBBox = objectBBox[0] !== Infinity;

  return {
    id,
    objectType: raw.type,
    attributes: raw.attributes ?? {},
    surfaces: allSurfaces,
    bbox: hasBBox
      ? [
          objectBBox[0],
          objectBBox[1],
          objectBBox[2],
          objectBBox[3],
          objectBBox[4],
          objectBBox[5],
        ]
      : null,
    children: raw.children ? [...raw.children] : [],
    parents: raw.parents ? [...raw.parents] : [],
    lod,
  };
}

// ---------------------------------------------------------------------------
// Metadata mapping
// ---------------------------------------------------------------------------

export function mapMetadata(raw: CityJSONRoot["metadata"]): CityModelMetadata {
  if (!raw) return {};
  return {
    title: raw.title,
    identifier: raw.identifier,
    referenceDate: raw.referenceDate,
    referenceSystem: raw.referenceSystem,
  };
}
