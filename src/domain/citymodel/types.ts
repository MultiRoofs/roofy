/**
 * Format-agnostic domain types for city models.
 *
 * These represent the normalized data that downstream modules
 * (scene rendering, analytics, persistence) consume.
 * Parsers for CityJSON / CityJSONSeq / FlatCityBuf all produce these types.
 */

import type { CityModelEncoding } from "./supportedEncodings";

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/** A 3D point in real-world coordinates (already dequantized). */
export type Vec3 = readonly [number, number, number];

/** Axis-aligned bounding box: [minX, minY, minZ, maxX, maxY, maxZ]. */
export type BBox3 = readonly [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Semantic type of a surface on a building. */
export type BuildingSurfaceType =
  | "RoofSurface"
  | "WallSurface"
  | "GroundSurface"
  | "ClosureSurface"
  | "OuterCeilingSurface"
  | "OuterFloorSurface"
  | "Window"
  | "Door"
  | "unknown";

/**
 * A single semantic surface extracted from a city object's geometry.
 * Contains the polygon vertices (real-world coordinates) and metadata.
 */
export interface Surface {
  /** The semantic type of this surface. */
  readonly type: BuildingSurfaceType;
  /** Polygon rings: first ring is exterior, rest are interior (holes). */
  readonly rings: ReadonlyArray<ReadonlyArray<Vec3>>;
  /** Extra semantic attributes (e.g. slope, solar-potential). */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** LoD of the source geometry that produced this surface (e.g. "2", "2.2"). */
  readonly lod: string | null;
}

// ---------------------------------------------------------------------------
// City objects (normalized)
// ---------------------------------------------------------------------------

/** A normalized city object — one entry per feature in the model. */
export interface CityObject {
  /** Unique ID within the model. */
  readonly id: string;
  /** CityJSON/CityGML type string (e.g. "Building", "LandUse"). */
  readonly objectType: string;
  /** Key-value attributes from the source data. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** Extracted surfaces with semantic labels and real-world coordinates. */
  readonly surfaces: ReadonlyArray<Surface>;
  /** Axis-aligned bounding box of this object, or null if no geometry. */
  readonly bbox: BBox3 | null;
  /** IDs of child objects. */
  readonly children: ReadonlyArray<string>;
  /** IDs of parent objects. */
  readonly parents: ReadonlyArray<string>;
  /** Level of detail string from the source geometry (e.g. "2", "2.2"). */
  readonly lod: string | null;
}

// ---------------------------------------------------------------------------
// City model (top-level container)
// ---------------------------------------------------------------------------

export interface CityModelMetadata {
  readonly title?: string;
  readonly identifier?: string;
  readonly referenceDate?: string;
  /** CRS as an OGC URI, e.g. "https://www.opengis.net/def/crs/EPSG/0/7415". */
  readonly referenceSystem?: string;
}

/** The complete, normalized city model ready for rendering and analysis. */
export interface CityModel {
  /** Which encoding was used to produce this model. */
  readonly sourceEncoding: CityModelEncoding;
  /** Top-level metadata (CRS, title, etc.). */
  readonly metadata: CityModelMetadata;
  /** Axis-aligned bounding box of the entire model. */
  readonly bbox: BBox3 | null;
  /** All city objects keyed by their ID. */
  readonly objects: Readonly<Record<string, CityObject>>;
  /** Total vertex count before normalization (for diagnostics). */
  readonly vertexCount: number;
}
