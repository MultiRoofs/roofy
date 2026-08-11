/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * ENGINE-FREE and computed from the layer's OWN data, because Navara 0.0.5
 * exposes no bounds/fit API on Layer or Source — the engine draws a geo layer
 * but cannot say where it is. GeoJSON is walked coordinate by coordinate; a
 * 3D Tiles tileset answers from its root bounding volume; an XYZ raster
 * template names no extent at all, so a raster layer has none (null).
 *
 * Antimeridian-crossing data produces a naive min/max box — a documented
 * limitation, matching the spec.
 */
import type { GeodeticBounds } from "@cityjson/navara-cityjson";

interface MutableBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Positions are [lng, lat, z?]; anything nested deeper is recursed. A
 *  position outside the lng/lat value space is SKIPPED, not clamped — a
 *  projected-CRS file must read as "no extent", not as a wrong one. */
function extendFromCoordinates(value: unknown, box: MutableBox): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    const lng = value[0];
    const lat = value[1];
    if (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      lng >= -180 &&
      lng <= 180 &&
      lat >= -90 &&
      lat <= 90
    ) {
      if (lng < box.west) box.west = lng;
      if (lng > box.east) box.east = lng;
      if (lat < box.south) box.south = lat;
      if (lat > box.north) box.north = lat;
    }
    return;
  }
  for (const item of value) extendFromCoordinates(item, box);
}

function walkGeoJson(node: unknown, box: MutableBox): void {
  if (!isRecord(node)) return;
  if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
    for (const feature of node.features) walkGeoJson(feature, box);
    return;
  }
  if (node.type === "Feature") {
    walkGeoJson(node.geometry, box);
    return;
  }
  if (node.type === "GeometryCollection" && Array.isArray(node.geometries)) {
    for (const geometry of node.geometries) walkGeoJson(geometry, box);
    return;
  }
  if ("coordinates" in node) extendFromCoordinates(node.coordinates, box);
}

/**
 * The lng/lat box around every position in a GeoJSON document, or null when
 * it contains none. Heights are 0 — `cameraForBounds` frames a flat box fine,
 * and a coordinate z is elevation of unknown datum, not worth trusting.
 */
export function geoJsonBounds(data: unknown): GeodeticBounds | null {
  const box: MutableBox = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };
  walkGeoJson(data, box);
  if (box.west > box.east || box.south > box.north) return null;
  return { ...box, minHeight: 0, maxHeight: 0 };
}
