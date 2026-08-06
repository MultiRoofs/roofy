/**
 * Geographic camera math for the Navara viewport (spec 4.2).
 *
 * Pure and ENGINE-FREE — it never imports `@navaramap/*` (Task B1:
 * `NODE_IMPORT_SAFE = false`, the engine crashes at module scope under Node),
 * so `fitAll` / `fitLayer` / `alignView` are unit-testable without WebGL. Task
 * B11a feeds the results to `view.setCamera()` (instant) or `view.flyTo()`
 * (animated); note that `flyTo` emits a full `movestart..moveend` burst that
 * Task C7's suppression bracket must swallow, while `setCamera` emits nothing.
 *
 * Semantics: the returned `lng`/`lat`/`height` are the CAMERA's own geodetic
 * position (Navara's `setCamera(camPos)` with `distance` omitted), and
 * `heading`/`pitch`/`roll` are degrees, with pitch negative when looking down
 * and heading measured clockwise from north. `cameraForBounds` parks the
 * camera directly ABOVE the centre of the box; `alignCameraForBounds` moves it
 * one fit distance along the requested axis instead and DERIVES the
 * orientation that looks back at the centre.
 */
import type { GeodeticBounds } from "@cityjson/navara-cityjson";
import type { ViewDirection } from "./ViewAlignButtons";

export interface GeographicCameraState {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
}

/** Metres per degree of latitude (spherical approximation — fit and orbit
 *  maths only). Shared with `cameraControls.ts`, whose zoom/tilt pivots have to
 *  use the SAME approximation as the fit they are nudging away from. */
export const METRES_PER_DEGREE_LAT = 111_320;
/** Floor so a single small building does not put the camera inside the roof. */
const MIN_VIEW_DISTANCE_M = 200;
/** How many box diagonals away from the model the fit camera sits. */
const FIT_DISTANCE_FACTOR = 1.5;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/**
 * Floor on cos(latitude) when converting metres to degrees of longitude. A
 * camera aligned on a box that touches a pole would otherwise divide by zero
 * and hand `setCamera` a NaN longitude, which wedges the engine's camera.
 */
const MIN_COS_LAT = 1e-6;

function isUsable(bounds: GeodeticBounds): boolean {
  return (
    Number.isFinite(bounds.west) &&
    Number.isFinite(bounds.south) &&
    Number.isFinite(bounds.east) &&
    Number.isFinite(bounds.north) &&
    Number.isFinite(bounds.minHeight) &&
    Number.isFinite(bounds.maxHeight)
  );
}

/** Distance east from `from` to `to` in [0, 360). */
function eastwardDelta(from: number, to: number): number {
  return (((to - from) % 360) + 360) % 360;
}

/** Longitude normalised into [-180, 180). */
function normaliseLng(lng: number): number {
  const wrapped = (((lng + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

/**
 * Width of a bounds' longitude span in degrees, in [0, 360].
 *
 * A box whose `east` is numerically smaller than its `west` wraps the
 * antimeridian; measuring it as `east - west` would report ~360 degrees instead
 * of the few metres it really covers.
 */
function lngSpanDegrees(bounds: GeodeticBounds): number {
  const raw = bounds.east - bounds.west;
  if (raw >= 360) return 360;
  if (raw >= 0) return raw;
  return eastwardDelta(bounds.west, bounds.east);
}

/**
 * Smallest box covering all of `bounds`, or `null` when there is nothing to
 * cover (empty list, or every entry carrying a non-finite number — a NaN would
 * otherwise propagate into `setCamera` and wedge the engine's camera).
 *
 * Latitude and height take a plain min/max. Longitude is circular, so the
 * union is the shortest arc containing every input arc: two layers either side
 * of the antimeridian union to a sliver across the seam, not to a box spanning
 * the globe the long way. The common case (one box, or several that neither
 * wrap nor span more than a hemisphere) is returned by exact min/max, with no
 * modular arithmetic and therefore no float drift.
 */
export function unionGeodeticBounds(
  bounds: readonly GeodeticBounds[],
): GeodeticBounds | null {
  const usable = bounds.filter(isUsable);
  if (usable.length === 0) return null;

  let south = Infinity;
  let north = -Infinity;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let naiveWest = Infinity;
  let naiveEast = -Infinity;
  let anyWrapping = false;
  for (const b of usable) {
    south = Math.min(south, b.south);
    north = Math.max(north, b.north);
    minHeight = Math.min(minHeight, b.minHeight);
    maxHeight = Math.max(maxHeight, b.maxHeight);
    naiveWest = Math.min(naiveWest, b.west);
    naiveEast = Math.max(naiveEast, b.east);
    if (b.east < b.west) anyWrapping = true;
  }

  const first = usable[0]!;
  if (usable.length === 1) {
    // Exact passthrough: no arithmetic on the longitudes at all.
    return {
      west: first.west,
      south,
      east: first.east,
      north,
      minHeight,
      maxHeight,
    };
  }
  if (!anyWrapping && naiveEast - naiveWest <= 180) {
    return {
      west: naiveWest,
      south,
      east: naiveEast,
      north,
      minHeight,
      maxHeight,
    };
  }

  // Circular case: try each box's west edge as the start of the arc and keep
  // the start that needs the least width to reach every other box's east edge.
  let bestWest = usable[0]!.west;
  let bestSpan = Infinity;
  for (const candidate of usable) {
    let span = 0;
    for (const other of usable) {
      span = Math.max(
        span,
        eastwardDelta(candidate.west, other.west) + lngSpanDegrees(other),
      );
    }
    if (span < bestSpan) {
      bestSpan = span;
      bestWest = candidate.west;
    }
  }
  if (bestSpan >= 360) {
    return { west: -180, south, east: 180, north, minHeight, maxHeight };
  }
  return {
    west: normaliseLng(bestWest),
    south,
    east: normaliseLng(bestWest + bestSpan),
    north,
    minHeight,
    maxHeight,
  };
}

/**
 * Length of the box's space diagonal in metres — the size the fit distance is
 * derived from. Longitude degrees are shortened by cos(latitude); the vertical
 * extent counts too, so a narrow tower is not framed as if it were flat.
 */
export function boundsDiagonalMetres(bounds: GeodeticBounds): number {
  const midLat = centreLat(bounds) * (Math.PI / 180);
  const dx = lngSpanDegrees(bounds) * METRES_PER_DEGREE_LAT * Math.cos(midLat);
  const dy = (bounds.north - bounds.south) * METRES_PER_DEGREE_LAT;
  const dz = bounds.maxHeight - bounds.minHeight;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Where an address-search result asks the camera to be flown, in the terms the
 * viewport's `flyTo` takes: a point and a height. Orientation is deliberately
 * absent — the active view mode decides that (a 2D plan view must not be
 * tilted back to -60 just because someone searched for a street).
 */
export interface FlyToTarget {
  readonly lng: number;
  readonly lat: number;
  /** Metres above the WGS84 ellipsoid. */
  readonly heightM: number;
}

/** Height for a result with no extent — a house number, a POI: close enough to
 *  see the building, far enough to see the street it is on. */
export const DEFAULT_SEARCH_HEIGHT_M = 1500;
/** A zero-area extent (a single node) must still be flown to from far enough
 *  away to see something. */
export const MIN_SEARCH_HEIGHT_M = 400;
/** A country-sized extent is not a place to fly INTO; stop where the whole of
 *  it is on screen. */
export const MAX_SEARCH_HEIGHT_M = 50_000;

/**
 * How high to fly for a geocoder result, from its bounding box.
 *
 * The box arrives in PHOTON's order — `[minLng, maxLat, maxLng, minLat]`, which
 * is not GeoJSON's — so it is unpacked by position here rather than passed on
 * as a `GeodeticBounds`. The height is the box's ground diagonal, the same
 * "size of the thing" {@link boundsDiagonalMetres} measures, clamped so neither
 * a pinpoint nor a continent produces an unusable camera.
 */
export function cameraHeightForExtent(
  extent?: readonly [number, number, number, number],
): number {
  if (extent === undefined || !extent.every((n) => Number.isFinite(n))) {
    return DEFAULT_SEARCH_HEIGHT_M;
  }
  const [minLng, maxLat, maxLng, minLat] = extent;
  const diagonal = boundsDiagonalMetres({
    west: Math.min(minLng, maxLng),
    east: Math.max(minLng, maxLng),
    south: Math.min(minLat, maxLat),
    north: Math.max(minLat, maxLat),
    minHeight: 0,
    maxHeight: 0,
  });
  return Math.min(Math.max(diagonal, MIN_SEARCH_HEIGHT_M), MAX_SEARCH_HEIGHT_M);
}

function centreLat(bounds: GeodeticBounds): number {
  return (bounds.south + bounds.north) / 2;
}

/** Centre longitude, walking east from `west` so a wrapped box stays wrapped. */
function centreLng(bounds: GeodeticBounds): number {
  const span = lngSpanDegrees(bounds);
  if (bounds.east >= bounds.west) return (bounds.west + bounds.east) / 2;
  return normaliseLng(bounds.west + span / 2);
}

function centreHeight(bounds: GeodeticBounds): number {
  return (bounds.minHeight + bounds.maxHeight) / 2;
}

/**
 * How far from the centre of the box a fitted camera stands, in metres — 1.5
 * space diagonals, floored so a single small building is still framed from
 * outside its own roof.
 */
export function fitDistanceMetres(bounds: GeodeticBounds): number {
  return Math.max(
    boundsDiagonalMetres(bounds) * FIT_DISTANCE_FACTOR,
    MIN_VIEW_DISTANCE_M,
  );
}

/** Downward tilt of the default (non-axis-aligned) framing, in degrees. */
const FIT_PITCH_DEG = -60;

/**
 * Default framing: one {@link fitDistanceMetres} from the centre of the box,
 * looking north and tilted down 60 degrees — i.e. the camera stands SOUTH of
 * and ABOVE the model, with the model in front of it.
 *
 * BROWSER-VERIFIED that the obvious alternative does not work: parking the
 * camera at `maxHeight + 1.5 * diagonal` directly OVER the centre (the shape
 * this had in B11a) leaves the model 30 degrees outside a 60-degree-pitched
 * view frustum's lower edge, so the first `fitAll` of the M7.3 smoke framed
 * empty space. Offsetting along the view axis is the same thing
 * {@link alignCameraForBounds} does, so both now share one derivation.
 */
export function cameraForBounds(bounds: GeodeticBounds): GeographicCameraState {
  const pitch = FIT_PITCH_DEG * DEG_TO_RAD;
  // Unit vector FROM the centre TO the camera: back down the view direction
  // (heading 0 = north), so `cameraFromUnitOffset` derives exactly heading 0 /
  // pitch -60 back out of it.
  return cameraFromUnitOffset(bounds, [0, -Math.cos(pitch), -Math.sin(pitch)]);
}

/**
 * Unit ENU offset (east, north, up) FROM the centre of the box TO the camera.
 *
 * The axes match the pre-Navara viewport's scene frame (X=east, Y=up,
 * Z=south), so the buttons keep meaning what they meant: `front` looks north
 * from the south side, and `right` shows the model's right-hand side as seen
 * from the front — the camera stands EAST and looks west.
 */
const ALIGN_OFFSETS: Record<
  ViewDirection,
  readonly [east: number, north: number, up: number]
> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

/** Heading normalised into [0, 360). */
function normaliseHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/**
 * A true elevation/plan view of the box from `direction`: the camera is moved
 * one {@link fitDistanceMetres} along that axis from the centre of the box,
 * and its heading/pitch are then DERIVED from where it landed, so it looks
 * straight back at the centre.
 *
 * This is what makes the four horizontal directions usable. Parking the camera
 * at the fit ALTITUDE and pitching to the horizon — the earlier preset table —
 * left the model below the camera and out of frame; standing level with the
 * centre of the box and looking at it does not, and still needs only the six
 * scalars the Shared Interface Contract allows (no target-anchored
 * `setCamera({lng, lat, height, distance})` form required).
 *
 * The offset uses the same spherical metres-per-degree approximation as the
 * rest of this module, which is exact enough at the hundreds-of-metres to
 * kilometres range a fit distance covers.
 */
export function alignCameraForBounds(
  bounds: GeodeticBounds,
  direction: ViewDirection,
): GeographicCameraState {
  return cameraFromUnitOffset(bounds, ALIGN_OFFSETS[direction]);
}

/**
 * The shared body of {@link cameraForBounds} and {@link alignCameraForBounds}:
 * stand one {@link fitDistanceMetres} from the centre of the box along the unit
 * ENU vector `offset`, then DERIVE heading/pitch from where that landed.
 */
function cameraFromUnitOffset(
  bounds: GeodeticBounds,
  offset: readonly [east: number, north: number, up: number],
): GeographicCameraState {
  const [east, north, up] = offset;
  const distance = fitDistanceMetres(bounds);
  const lat0 = centreLat(bounds);
  const metresPerDegreeLng =
    METRES_PER_DEGREE_LAT *
    Math.max(Math.abs(Math.cos(lat0 * DEG_TO_RAD)), MIN_COS_LAT);

  const lat = Math.max(
    -90,
    Math.min(90, lat0 + (north * distance) / METRES_PER_DEGREE_LAT),
  );
  // Normalise only when the offset actually pushed the camera off the map:
  // running an in-range longitude through the modular arithmetic costs a
  // sub-nanodegree of drift, which is enough to turn the exactly-zero east
  // offset of a top/bottom view into a spurious 90-degree heading below.
  const lngRaw = centreLng(bounds) + (east * distance) / metresPerDegreeLng;
  const lng = lngRaw >= -180 && lngRaw <= 180 ? lngRaw : normaliseLng(lngRaw);
  const height = centreHeight(bounds) + up * distance;

  // Look back down the offset: the vector from the camera to the centre is the
  // negated offset, so heading/pitch fall out of it rather than out of a table.
  const toCentreEast = -east * distance;
  const toCentreNorth = -north * distance;
  const toCentreUp = -up * distance;
  const horizontal = Math.hypot(toCentreEast, toCentreNorth);

  return {
    lng,
    lat,
    height,
    // Straight up/down has no heading to derive — `atan2(-0, -0)` would report
    // 180 degrees, silently spinning a plan view round.
    heading:
      horizontal === 0
        ? 0
        : normaliseHeading(
            Math.atan2(toCentreEast, toCentreNorth) * RAD_TO_DEG,
          ),
    pitch: Math.atan2(toCentreUp, horizontal) * RAD_TO_DEG,
    roll: 0,
  };
}
