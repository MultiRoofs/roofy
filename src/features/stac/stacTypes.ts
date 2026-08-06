/**
 * The vocabulary of the STAC catalog browser.
 *
 * These are the app's OWN view of a catalog, not a transcription of the STAC
 * spec: every field here is something a card, a table row or the Add button
 * actually reads, already coerced out of the wire format's many shapes (see
 * `stacNormalize.ts`). Anything the UI does not consume is deliberately absent
 * — the raw JSON stays available to whoever fetched it.
 *
 * `null` is used consistently for "the catalog did not say", never `false` or
 * `0`, so a card can render "unknown" differently from "no".
 */

/** One collection, reduced to what a browsable card shows. */
export interface StacCollectionCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly license: string | null;
  /** Validated WGS84 [minLng, minLat, maxLng, maxLat], or null when the
   *  collection's bbox is missing/degenerate/in projected metres. */
  readonly extent2d: readonly [number, number, number, number] | null;
  readonly lods: readonly string[];
  readonly coTypes: readonly string[];
  readonly version: string | null;
  readonly projCodes: readonly string[];
  readonly semanticSurfaces: boolean | null; // null = unknown
  readonly textures: boolean | null;
  readonly materials: boolean | null;
  readonly cityObjectsTotal: number | null;
  /** Absolute URL of the stac-geoparquet items mirror, or null (22/53). */
  readonly itemsParquetHref: string | null;
  /** Absolute URL of the collection.json this card came from. */
  readonly collectionHref: string;
}

/** One item of a collection, as a table row / map footprint. */
export interface StacItemRecord {
  readonly id: string;
  readonly collectionId: string;
  /** Validated WGS84 [minLng, minLat, maxLng, maxLat], or null. */
  readonly bbox2d: readonly [number, number, number, number] | null;
  readonly assetHref: string | null;
  readonly assetType: string | null;
  readonly lods: readonly string[];
  readonly coTypes: readonly string[];
  readonly cityObjects: number | null;
  readonly projCode: string | null;
}

export type StacAssetKind =
  | "cityjson"
  | "cityjsonseq"
  | "flatcitybuf"
  | "citygml"
  | "archive"
  | "unknown";

export interface StacAssetInfo {
  readonly kind: StacAssetKind;
  /** true when the app can load it via addLayerFromUrl */
  readonly loadable: boolean;
  /** short human label, e.g. "CityJSON", "CityGML", "ZIP archive" */
  readonly label: string;
}
