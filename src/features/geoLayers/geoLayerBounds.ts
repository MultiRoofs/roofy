/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * ENGINE-FREE and computed from the layer's OWN data, because Navara (0.0.5,
 * and still 0.1.1) exposes no bounds/fit API on Layer or Source — the engine draws a geo layer
 * but cannot say where it is. GeoJSON is walked coordinate by coordinate; a
 * 3D Tiles tileset answers from its root bounding volume; an XYZ raster
 * template names no extent at all, so a raster layer has none (null).
 *
 * Antimeridian-crossing data produces a naive min/max box — a documented
 * limitation, matching the spec.
 */
import type { GeodeticBounds } from "@cityjson/navara-cityjson";
import type { GeoLayer } from "./geoLayerStore";

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

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const METRES_PER_DEGREE_LAT = 111_320;
const RAD_TO_DEG = 180 / Math.PI;

/** Bowring's single-pass approximation — metre-level accuracy, ample for
 *  framing a camera flight. Self-contained on purpose: proj4 has no ECEF
 *  pipeline registered here, and this module must stay dependency-light. */
function ecefToGeodetic(
  x: number,
  y: number,
  z: number,
): { lng: number; lat: number; height: number } {
  const lng = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  const b = WGS84_A * (1 - WGS84_F);
  const theta = Math.atan2(z * WGS84_A, p * b);
  const ePrime2 = (WGS84_A * WGS84_A - b * b) / (b * b);
  const lat = Math.atan2(
    z + ePrime2 * b * Math.sin(theta) ** 3,
    p - WGS84_E2 * WGS84_A * Math.cos(theta) ** 3,
  );
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  const height = p / Math.cos(lat) - n;
  return { lng: lng * RAD_TO_DEG, lat: lat * RAD_TO_DEG, height };
}

function boundsAroundEcef(
  x: number,
  y: number,
  z: number,
  radiusM: number,
): GeodeticBounds | null {
  if (![x, y, z, radiusM].every(Number.isFinite) || radiusM < 0) return null;
  const centre = ecefToGeodetic(x, y, z);
  if (!Number.isFinite(centre.lng) || !Number.isFinite(centre.lat)) return null;
  const dLat = radiusM / METRES_PER_DEGREE_LAT;
  const cosLat = Math.cos((centre.lat * Math.PI) / 180);
  const dLng = cosLat > 1e-6 ? radiusM / (METRES_PER_DEGREE_LAT * cosLat) : 180;
  return {
    west: centre.lng - dLng,
    south: Math.max(-90, centre.lat - dLat),
    east: centre.lng + dLng,
    north: Math.min(90, centre.lat + dLat),
    minHeight: centre.height - radiusM,
    maxHeight: centre.height + radiusM,
  };
}

/**
 * The extent of a 3D Tiles tileset, from its root bounding volume. A `region`
 * is already geodetic (radians); `sphere` and `box` are ECEF and become a box
 * around their centre — conservative (a box's half-diagonal), which for a
 * camera fit errs the right way: slightly too far out, never cropping.
 *
 * PRECEDENCE when a volume carries more than one form: `region` wins, being
 * the only exact geodetic one — and a MALFORMED region returns null rather
 * than falling through to `sphere`/`box`, because a volume that names a region
 * and gets it wrong is a broken tileset, not one to be second-guessed from a
 * secondary form.
 */
export function tilesetBounds(tileset: unknown): GeodeticBounds | null {
  if (!isRecord(tileset)) return null;
  const root = tileset.root;
  if (!isRecord(root)) return null;
  const volume = root.boundingVolume;
  if (!isRecord(volume)) return null;

  if (Array.isArray(volume.region) && volume.region.length >= 6) {
    const region = volume.region as number[];
    if (!region.slice(0, 6).every((v) => Number.isFinite(v))) return null;
    const [west, south, east, north, minHeight, maxHeight] = region;
    return {
      west: west! * RAD_TO_DEG,
      south: south! * RAD_TO_DEG,
      east: east! * RAD_TO_DEG,
      north: north! * RAD_TO_DEG,
      minHeight: minHeight!,
      maxHeight: maxHeight!,
    };
  }
  if (Array.isArray(volume.sphere) && volume.sphere.length >= 4) {
    const [cx, cy, cz, r] = volume.sphere as number[];
    return boundsAroundEcef(cx!, cy!, cz!, r!);
  }
  if (Array.isArray(volume.box) && volume.box.length >= 12) {
    const b = volume.box as number[];
    if (!b.slice(0, 12).every((v) => Number.isFinite(v))) return null;
    const radius = Math.hypot(
      Math.hypot(b[3]!, b[4]!, b[5]!),
      Math.hypot(b[6]!, b[7]!, b[8]!),
      Math.hypot(b[9]!, b[10]!, b[11]!),
    );
    return boundsAroundEcef(b[0]!, b[1]!, b[2]!, radius);
  }
  return null;
}

/** URL → in-flight-or-done bounds, so a second click on the same layer (or a
 *  second layer over the same file) costs nothing. Successes only: a null or
 *  a rejection is evicted, so the next click retries a flaky host. */
const boundsByUrl = new Map<string, Promise<GeodeticBounds | null>>();

/** Test seam. */
export function resetGeoLayerBoundsCache(): void {
  boundsByUrl.clear();
}

function cachedBounds(
  url: string,
  fetchFn: typeof fetch,
  toBounds: (body: unknown) => GeodeticBounds | null,
): Promise<GeodeticBounds | null> {
  const cached = boundsByUrl.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
    }
    return toBounds(await response.json());
  })();
  boundsByUrl.set(url, promise);
  promise.then(
    (bounds) => {
      if (bounds === null) boundsByUrl.delete(url);
    },
    () => boundsByUrl.delete(url),
  );
  return promise;
}

/**
 * The extent of a geo layer, fetching the layer's source when it lives behind
 * a URL. Resolves null when the layer HAS no extent (raster, an unlinked
 * GeoJSON row, a document with no positions); REJECTS when the network does —
 * the caller tells those apart to word its message.
 */
export function resolveGeoLayerBounds(
  layer: GeoLayer,
  fetchFn: typeof fetch = fetch,
): Promise<GeodeticBounds | null> {
  switch (layer.kind) {
    case "geojson": {
      if (layer.config.data !== undefined) {
        return Promise.resolve(geoJsonBounds(layer.config.data));
      }
      if (layer.config.url !== undefined && layer.config.url !== "") {
        return cachedBounds(layer.config.url, fetchFn, geoJsonBounds);
      }
      return Promise.resolve(null);
    }
    case "3d-tiles": {
      // An empty url is "no source", not a source at the app's own origin:
      // `fetch("")` fetches the page itself and fails inside `.json()`, which
      // would word a network failure for a layer that names nothing. Same
      // answer as the geojson arm.
      if (layer.config.url === "") return Promise.resolve(null);
      return cachedBounds(layer.config.url, fetchFn, tilesetBounds);
    }
    case "raster-xyz":
      return Promise.resolve(null);
  }
}
