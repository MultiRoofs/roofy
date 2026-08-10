/**
 * Footprint geometry for the catalog's mini-map.
 *
 * Everything `StacItemMap` would otherwise compute inline lives here, for one
 * reason: maplibre needs a real WebGL context, so the component itself gets no
 * jsdom test at all. A ring wound the wrong way or a union that quietly drops
 * the first box would then be found by eye, in a browser, or not at all. This
 * module is pure — no maplibre import, no DOM — so it is tested under Node
 * like the rest of `features/stac`.
 *
 * MUTABLE tuples on the way out are deliberate, not sloppiness. maplibre's
 * `LngLatBoundsLike` and the GeoJSON DOM types are declared with mutable
 * arrays and reject `readonly` ones, so the widening happens here, once, at
 * the boundary — rather than at every call site with a cast.
 */

import type { StacItemRecord } from "./stacTypes";

/** One item's bbox as a map feature. `id` is promoted (`promoteId: "itemId"`)
 *  because feature-state — how hover and selection are painted — is keyed on
 *  the feature id, and a GeoJSON source only has one if it is told where to
 *  find it. */
export interface FootprintFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly properties: { readonly itemId: string };
  readonly geometry: {
    readonly type: "Polygon";
    readonly coordinates: number[][][];
  };
}

/** The `features` array is MUTABLE for the same reason the bounds tuples are:
 *  it is handed straight to maplibre's `addSource`/`setData`, whose GeoJSON
 *  types are declared with mutable arrays and reject a `ReadonlyArray`
 *  outright. The widening happens here, once, rather than as a cast at every
 *  call site. */
export interface FootprintFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: FootprintFeature[];
}

/**
 * One rectangle per item that has a valid bbox; items with `bbox2d: null` are
 * skipped rather than drawn at the null island.
 *
 * The ring is closed (5 positions, first === last) and wound counter-clockwise,
 * which is what RFC 7946 asks of an exterior ring. maplibre tolerates either
 * winding for a fill this simple, but a correctly wound ring is the one that
 * survives being handed to anything else later.
 */
export function footprintFeatureCollection(
  items: readonly StacItemRecord[],
): FootprintFeatureCollection {
  const features: FootprintFeature[] = [];
  for (const it of items) {
    const b = it.bbox2d;
    if (!b) continue;
    const [minLng, minLat, maxLng, maxLat] = b;
    features.push({
      type: "Feature",
      id: it.id,
      properties: { itemId: it.id },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [minLng, minLat],
            [maxLng, minLat],
            [maxLng, maxLat],
            [minLng, maxLat],
            [minLng, minLat],
          ],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * The union of the given items' bboxes as `[[minLng,minLat],[maxLng,maxLat]]`,
 * or `null` when no item has one.
 *
 * `null` rather than a world-wide default on purpose: `fitBounds(null)` throws,
 * and the caller's fallback is the collection extent, not the whole globe.
 */
export function combinedBounds(
  items: readonly StacItemRecord[],
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let any = false;
  for (const it of items) {
    const b = it.bbox2d;
    if (!b) continue;
    any = true;
    if (b[0] < minLng) minLng = b[0];
    if (b[1] < minLat) minLat = b[1];
    if (b[2] > maxLng) maxLng = b[2];
    if (b[3] > maxLat) maxLat = b[3];
  }
  if (!any) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** A collection `extent2d` as bounds, or `null`. The fitBounds fallback for a
 *  collection whose items all lack a footprint. */
export function extentToBounds(
  extent: readonly [number, number, number, number] | null,
): [[number, number], [number, number]] | null {
  if (!extent) return null;
  return [
    [extent[0], extent[1]],
    [extent[2], extent[3]],
  ];
}

/**
 * Whether a bbox intersects a bounds rectangle — the list's "only what is on
 * screen" filter.
 *
 * Touching counts as intersecting: an item flush against the viewport edge is
 * visible, and the alternative makes items flicker out of the list at the exact
 * moment they are still half-drawn. Comparison is plain lng/lat, so a viewport
 * that has been panned across the antimeridian is not handled; this catalog is
 * European and the map is a small inset that cannot reach it.
 */
export function bboxIntersectsBounds(
  bbox2d: readonly [number, number, number, number],
  bounds: [[number, number], [number, number]],
): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox2d;
  const [[bMinLng, bMinLat], [bMaxLng, bMaxLat]] = bounds;
  return (
    minLng <= bMaxLng &&
    maxLng >= bMinLng &&
    minLat <= bMaxLat &&
    maxLat >= bMinLat
  );
}
