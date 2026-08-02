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
 * `heading`/`pitch`/`roll` are degrees, with pitch negative when looking down.
 * Every fit therefore parks the camera directly ABOVE the centre of the box —
 * see the caveat on `alignCameraForBounds` for what that costs the horizontal
 * presets.
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

/** Metres per degree of latitude (spherical approximation — fit maths only). */
const METRES_PER_DEGREE_LAT = 111_320;
/** Floor so a single small building does not put the camera inside the roof. */
const MIN_VIEW_HEIGHT_M = 200;
/** How many box diagonals above the model the fit camera sits. */
const FIT_DISTANCE_FACTOR = 1.5;

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

function centreLat(bounds: GeodeticBounds): number {
  return (bounds.south + bounds.north) / 2;
}

/** Centre longitude, walking east from `west` so a wrapped box stays wrapped. */
function centreLng(bounds: GeodeticBounds): number {
  const span = lngSpanDegrees(bounds);
  if (bounds.east >= bounds.west) return (bounds.west + bounds.east) / 2;
  return normaliseLng(bounds.west + span / 2);
}

function fitHeight(bounds: GeodeticBounds): number {
  return Math.max(
    bounds.maxHeight + boundsDiagonalMetres(bounds) * FIT_DISTANCE_FACTOR,
    MIN_VIEW_HEIGHT_M,
  );
}

/** Default framing: above the centre of the box, tilted down at 60 degrees. */
export function cameraForBounds(bounds: GeodeticBounds): GeographicCameraState {
  return {
    lng: centreLng(bounds),
    lat: centreLat(bounds),
    height: fitHeight(bounds),
    heading: 0,
    pitch: -60,
    roll: 0,
  };
}

const ALIGN_PRESETS: Record<
  ViewDirection,
  { readonly heading: number; readonly pitch: number }
> = {
  top: { heading: 0, pitch: -90 },
  bottom: { heading: 0, pitch: 90 },
  front: { heading: 0, pitch: 0 },
  back: { heading: 180, pitch: 0 },
  right: { heading: 90, pitch: 0 },
  left: { heading: 270, pitch: 0 },
};

/**
 * The same framing as {@link cameraForBounds} with a preset orientation, so
 * alignment changes where the camera looks without changing how far out it is.
 *
 * KNOWN LIMITATION (Shared Interface Contract keeps the state to six scalars,
 * so it cannot be fixed here): the four horizontal presets keep the fit
 * altitude while pitching to the horizon, which puts the model below the
 * camera rather than in front of it. Making them true elevation views needs
 * the target-anchored form of `setCamera` (`{lng, lat, height, distance}`,
 * where lng/lat/height is the aim point) — a viewport-side (B11a) decision,
 * not a change to this module's contract.
 */
export function alignCameraForBounds(
  bounds: GeodeticBounds,
  direction: ViewDirection,
): GeographicCameraState {
  const preset = ALIGN_PRESETS[direction];
  return {
    lng: centreLng(bounds),
    lat: centreLat(bounds),
    height: fitHeight(bounds),
    heading: preset.heading,
    pitch: preset.pitch,
    roll: 0,
  };
}
