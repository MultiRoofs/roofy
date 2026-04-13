/**
 * Pure helper functions for converting CityGML XML structures
 * into the format-neutral domain types.
 *
 * Handles:
 *  - gml:posList / gml:pos coordinate parsing
 *  - gml:Polygon ring extraction (exterior + interiors)
 *  - gml:MultiSurface / gml:Solid traversal
 *  - LoD detection from element names
 *  - Semantic surface type resolution
 *  - CRS (srsName) normalization
 */

import type { BuildingSurfaceType, Vec3 } from "../types";
import type {
  GMLLinearRing,
  GMLMultiSurface,
  GMLPolygon,
  GMLSolid,
  GMLSurfaceMemberEntry,
  XMLNode,
} from "./types";

// ---------------------------------------------------------------------------
// Coordinate parsing
// ---------------------------------------------------------------------------

/**
 * Parse a gml:posList string into Vec3 tuples.
 * Splits on whitespace, groups by srsDimension (default 3).
 * Returns [] on malformed input (lenient).
 */
export function parsePosList(raw: string, srsDimension = 3): Vec3[] {
  if (srsDimension !== 3) {
    // Domain model is inherently 3D; 2D CityGML data cannot be represented.
    console.warn(
      `[CityGML] Unsupported srsDimension=${srsDimension}, expected 3`,
    );
    return [];
  }
  const tokens = raw.trim().split(/\s+/);
  const result: Vec3[] = [];
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    const z = Number(tokens[i + 2]);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    result.push([x, y, z] as const);
  }
  return result;
}

/**
 * Resolve a gml:LinearRing node to an array of Vec3.
 * Handles both gml:posList (preferred) and multiple gml:pos elements.
 */
export function parseLinearRing(ring: GMLLinearRing): Vec3[] {
  // gml:posList — may be a string or an object with #text
  const posList = ring["gml:posList"];
  if (posList != null) {
    const text = typeof posList === "string" ? posList : posList["#text"];
    const dim =
      typeof posList === "object" && posList["@_srsDimension"]
        ? Number(posList["@_srsDimension"])
        : 3;
    if (typeof text === "string") {
      return parsePosList(text, dim);
    }
  }

  // Fallback: gml:pos (one or more individual coordinate elements)
  const pos = ring["gml:pos"];
  if (pos != null) {
    const entries = Array.isArray(pos) ? pos : [pos];
    const result: Vec3[] = [];
    for (const entry of entries) {
      const tokens = String(entry).trim().split(/\s+/);
      if (tokens.length >= 3) {
        const x = Number(tokens[0]);
        const y = Number(tokens[1]);
        const z = Number(tokens[2]);
        if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
          result.push([x, y, z] as const);
        }
      }
    }
    return result;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Polygon parsing
// ---------------------------------------------------------------------------

/**
 * Extract rings from a gml:Polygon node.
 * Returns [exteriorRing, ...interiorRings] or null if exterior is invalid.
 */
export function parsePolygon(
  poly: GMLPolygon,
): ReadonlyArray<ReadonlyArray<Vec3>> | null {
  const extLinearRing = poly["gml:exterior"]?.["gml:LinearRing"];
  if (!extLinearRing) return null;

  const exterior = parseLinearRing(extLinearRing);
  if (exterior.length < 3) return null;

  const rings: Vec3[][] = [exterior];

  // Interior rings (holes)
  const interior = poly["gml:interior"];
  if (interior != null) {
    const interiors = Array.isArray(interior) ? interior : [interior];
    for (const hole of interiors) {
      const lr = hole["gml:LinearRing"];
      if (lr) {
        const holeRing = parseLinearRing(lr);
        if (holeRing.length >= 3) {
          rings.push(holeRing);
        }
      }
    }
  }

  return rings;
}

// ---------------------------------------------------------------------------
// MultiSurface / Solid traversal
// ---------------------------------------------------------------------------

/** Normalize a value that may be a single item or an array. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Collect all gml:Polygon nodes from a gml:MultiSurface.
 * Skips XLink-only members (no inline polygon).
 */
export function collectPolygonsFromMultiSurface(
  ms: GMLMultiSurface,
): GMLPolygon[] {
  return collectInlinePolygons(ms["gml:surfaceMember"]);
}

/** Extract inline polygons from a surfaceMember list. */
function collectInlinePolygons(
  members: GMLSurfaceMemberEntry | GMLSurfaceMemberEntry[] | undefined,
): GMLPolygon[] {
  const polygons: GMLPolygon[] = [];
  for (const m of toArray(members)) {
    if (m["gml:Polygon"]) {
      polygons.push(m["gml:Polygon"]);
    }
  }
  return polygons;
}

/**
 * Collect all gml:Polygon nodes from a gml:Solid (exterior shell only).
 */
export function collectPolygonsFromSolid(solid: GMLSolid): GMLPolygon[] {
  const ext = solid["gml:exterior"];
  if (!ext) return [];

  // gml:CompositeSurface path
  const cs = ext["gml:CompositeSurface"];
  if (cs) return collectInlinePolygons(cs["gml:surfaceMember"]);

  // gml:Shell path (alternative CityGML encoding)
  const shell = ext["gml:Shell"];
  if (shell) return collectInlinePolygons(shell["gml:surfaceMember"]);

  return [];
}

// ---------------------------------------------------------------------------
// LoD detection
// ---------------------------------------------------------------------------

const LOD_REGEX = /lod(\d(?:\.\d)?)/i;

/**
 * Extract LoD string from a CityGML geometry container element name.
 * "lod2MultiSurface" -> "2", "lod1Solid" -> "1", etc.
 */
export function detectLodFromElementName(name: string): string | null {
  const match = LOD_REGEX.exec(name);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// Semantic surface type resolution
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

/**
 * Resolve a CityGML element's qualified name to BuildingSurfaceType.
 * Strips namespace prefix before lookup.
 * "bldg:RoofSurface" -> "RoofSurface", "con:WallSurface" -> "WallSurface"
 */
export function resolveGMLSurfaceType(
  qualifiedName: string,
): BuildingSurfaceType {
  const localName = qualifiedName.includes(":")
    ? qualifiedName.split(":").at(-1)!
    : qualifiedName;
  if (KNOWN_BUILDING_SURFACE_TYPES.has(localName)) {
    return localName as BuildingSurfaceType;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// CRS normalization
// ---------------------------------------------------------------------------

const URN_EPSG_REGEX = /urn:ogc:def:crs(?:,crs)?:EPSG:[\d.]*:(\d+)/;
const BARE_EPSG_REGEX = /^EPSG:(\d+)$/i;
const OGC_HTTP_PREFIX = "https://www.opengis.net/def/crs/";

/**
 * Normalize an srsName string to OGC URI format.
 *   "urn:ogc:def:crs:EPSG::28992"  -> "https://www.opengis.net/def/crs/EPSG/0/28992"
 *   "EPSG:28992"                    -> "https://www.opengis.net/def/crs/EPSG/0/28992"
 *   already OGC HTTP               -> pass through
 *   unrecognized                    -> pass through as-is
 */
export function normalizeSrsName(srsName: string): string {
  if (srsName.startsWith(OGC_HTTP_PREFIX)) return srsName;

  const urnMatch = URN_EPSG_REGEX.exec(srsName);
  if (urnMatch) {
    return `${OGC_HTTP_PREFIX}EPSG/0/${urnMatch[1]}`;
  }

  const bareMatch = BARE_EPSG_REGEX.exec(srsName);
  if (bareMatch) {
    return `${OGC_HTTP_PREFIX}EPSG/0/${bareMatch[1]}`;
  }

  return srsName;
}

// ---------------------------------------------------------------------------
// Node traversal utilities
// ---------------------------------------------------------------------------

/**
 * Strip namespace prefix from a qualified XML element name.
 * "bldg:Building" -> "Building", "Building" -> "Building"
 */
export function stripPrefix(qualifiedName: string): string {
  const idx = qualifiedName.indexOf(":");
  return idx >= 0 ? qualifiedName.slice(idx + 1) : qualifiedName;
}

/**
 * Find all geometry container keys on a node that match lod* patterns.
 * Returns pairs of [localElementName, childValue].
 */
export function findLodGeometryEntries(
  node: XMLNode,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    const localName = stripPrefix(key);
    if (LOD_REGEX.test(localName)) {
      entries.push([localName, value]);
    }
  }
  return entries;
}
