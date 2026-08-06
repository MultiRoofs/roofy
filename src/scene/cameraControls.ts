/**
 * The maths behind the viewport's compass and map-control cluster.
 *
 * Pure and ENGINE-FREE, exactly like `geographicCamera.ts` (which this builds
 * on): every function here takes the camera state the viewport last read out of
 * the engine and returns the state it should be given, so the zoom step, the
 * tilt step and the "reset to north" are unit-testable without WebGL. The
 * viewport hands the result to `view.setCamera()` — instant, and emitting no
 * camera events of its own, which is why the caller has to publish the new pose
 * itself (see `cameraPose.ts`).
 *
 * PIVOT, NOT POSITION. Naively zooming by scaling `height`, or tilting by
 * writing `pitch` where the camera stands, both swing the model out of frame:
 * the camera looks along its heading/pitch, so changing either in place moves
 * what is in front of it. Every control here therefore works the way a map's
 * zoom/tilt buttons do — it derives the GROUND POINT the camera is looking at
 * (where the view ray crosses height 0), changes the distance or the angle, and
 * re-places the camera so that same point stays under the crosshair.
 *
 * The ground point is the ray's crossing of the h=0 ellipsoid height, not a
 * terrain or model intersection: this module cannot raycast (that would need
 * the engine), and at the hundreds-of-metres-to-kilometres range these controls
 * operate over the difference is a few metres of framing. Same spherical
 * metres-per-degree approximation as `geographicCamera.ts`, for the same reason.
 *
 * Looking at or above the horizon there is no such point (the ray never comes
 * down), so each function falls back to the naive in-place change rather than
 * refusing to act — a control that does nothing reads as broken.
 */
import {
  METRES_PER_DEGREE_LAT,
  type GeographicCameraState,
} from "./geographicCamera";

const DEG_TO_RAD = Math.PI / 180;

/** One click of the zoom-in button: the distance to the pivot is multiplied by
 *  this, so the camera ends up 33% closer. Matches the feel of a wheel notch
 *  without being so large that two clicks overshoot the model. */
export const ZOOM_IN_FACTOR = 0.67;
/** One click of the zoom-out button — the exact inverse of {@link
 *  ZOOM_IN_FACTOR}, so in-then-out returns to where it started. */
export const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
/** Degrees of pitch per click of a tilt button. */
export const TILT_STEP_DEG = 10;

/**
 * How far the tilt buttons may go.
 *
 * Down is capped just short of -90 because a camera looking EXACTLY straight
 * down has no heading to speak of (the compass would spin on the last decimal),
 * and up is capped short of the horizon because the pivot maths degenerates
 * there — past this the ray takes kilometres to reach the ground, and beyond
 * it never does. Dragging still gives the full range the engine allows; these
 * are the limits of the BUTTONS.
 */
export const MIN_PITCH_DEG = -89;
export const MAX_PITCH_DEG = -5;

/** How far a tilt may go. Narrowed per view mode (`viewModePolicy.ts` pins
 *  `min === max` in 2D and 2.5D), which is why {@link tiltedCamera} takes it as
 *  an argument rather than reading the constants directly: one clamp, moved,
 *  instead of a second clamp somewhere else that could disagree with it. */
export interface PitchLimits {
  readonly minDeg: number;
  readonly maxDeg: number;
}

/** The buttons' own range, used when no mode narrows it. */
export const DEFAULT_PITCH_LIMITS: PitchLimits = {
  minDeg: MIN_PITCH_DEG,
  maxDeg: MAX_PITCH_DEG,
};

/** Below this the camera is on top of the ground and a pivot is meaningless. */
const MIN_CAMERA_HEIGHT_M = 5;
/** Roughly two Earth radii: far enough to see the whole globe, close enough
 *  that a runaway zoom-out cannot send the camera to infinity. */
const MAX_CAMERA_HEIGHT_M = 12_000_000;
/** Closest the zoom may bring the camera to its pivot. */
const MIN_PIVOT_DISTANCE_M = 10;
/** Furthest the zoom may take it, and the longest ray that still counts as
 *  "looking at the ground" rather than at the horizon. */
const MAX_PIVOT_DISTANCE_M = 20_000_000;
/**
 * Floor on cos(latitude) when converting metres to degrees of longitude —
 * the same guard `geographicCamera.ts` carries, and for the same reason: a
 * camera over a pole would otherwise divide by zero and hand `setCamera` a NaN
 * longitude, which wedges the engine's camera.
 */
const MIN_COS_LAT = 1e-6;

/** The ground point the camera is looking at, and how far away it is. */
interface Pivot {
  readonly lng: number;
  readonly lat: number;
  /** Metres from the camera to the pivot, along the view direction. */
  readonly distance: number;
  /**
   * The metres-per-degree-of-longitude scale this pivot was derived with —
   * carried rather than recomputed at the far end so the trip out to the pivot
   * and back is EXACTLY reversible. Recomputing it from the pivot's own
   * latitude would use a different cosine, and a zoom in followed by a zoom out
   * would not land where it started.
   */
  readonly metresPerDegreeLng: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function metresPerDegreeLng(lat: number): number {
  return (
    METRES_PER_DEGREE_LAT *
    Math.max(Math.abs(Math.cos(lat * DEG_TO_RAD)), MIN_COS_LAT)
  );
}

/** Longitude normalised into [-180, 180). */
function normaliseLng(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng;
  const wrapped = (((lng + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

/** Heading normalised into [0, 360). */
export function normaliseHeading(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

/** Whether a camera state is usable as the starting point for a control —
 *  every field finite, so nothing NaN can reach `setCamera`. */
function isUsable(state: GeographicCameraState): boolean {
  return (
    Number.isFinite(state.lng) &&
    Number.isFinite(state.lat) &&
    Number.isFinite(state.height) &&
    Number.isFinite(state.heading) &&
    Number.isFinite(state.pitch) &&
    Number.isFinite(state.roll)
  );
}

/**
 * Where the view ray crosses height 0, or `null` when it never does — the
 * camera is level with or above the horizon, is already on the ground, or the
 * crossing is so far away that calling it "what the user is looking at" would
 * be a fiction.
 */
function groundPivot(state: GeographicCameraState): Pivot | null {
  if (state.pitch >= 0 || state.height <= MIN_CAMERA_HEIGHT_M) return null;
  const pitch = state.pitch * DEG_TO_RAD;
  const heading = state.heading * DEG_TO_RAD;
  const descent = -Math.sin(pitch); // > 0 while the camera looks down
  if (descent <= 0) return null;
  const distance = state.height / descent;
  if (!Number.isFinite(distance) || distance > MAX_PIVOT_DISTANCE_M) {
    return null;
  }
  const horizontal = distance * Math.cos(pitch);
  const scale = metresPerDegreeLng(state.lat);
  return {
    lng: normaliseLng(state.lng + (horizontal * Math.sin(heading)) / scale),
    lat: clamp(
      state.lat + (horizontal * Math.cos(heading)) / METRES_PER_DEGREE_LAT,
      -90,
      90,
    ),
    distance,
    metresPerDegreeLng: scale,
  };
}

/**
 * Stand `distance` metres from `pivot` along the reverse of the view direction
 * `heading`/`pitch`, so the camera looks straight back at it. The inverse of
 * {@link groundPivot}, and the shared body of all three controls.
 */
function cameraAtPivot(
  pivot: Pivot,
  heading: number,
  pitch: number,
  distance: number,
  roll: number,
): GeographicCameraState {
  const p = pitch * DEG_TO_RAD;
  const h = heading * DEG_TO_RAD;
  const horizontal = distance * Math.cos(p);
  return {
    lng: normaliseLng(
      pivot.lng - (horizontal * Math.sin(h)) / pivot.metresPerDegreeLng,
    ),
    lat: clamp(
      pivot.lat - (horizontal * Math.cos(h)) / METRES_PER_DEGREE_LAT,
      -90,
      90,
    ),
    // `-sin(p)` is positive while the camera looks down, so this lifts the
    // camera off the pivot rather than burying it.
    height: clamp(
      -distance * Math.sin(p),
      MIN_CAMERA_HEIGHT_M,
      MAX_CAMERA_HEIGHT_M,
    ),
    heading: normaliseHeading(heading),
    pitch,
    roll,
  };
}

/**
 * One zoom step: multiply the distance to the pivot by `factor` (< 1 moves
 * closer), keeping heading, pitch and the point being looked at.
 *
 * With no pivot — the horizon is in view, or the camera is already on the deck
 * — the camera's own height is scaled instead, which is the best a
 * ground-anchored zoom can do when there is no ground in front of it.
 */
export function zoomedCamera(
  state: GeographicCameraState,
  factor: number,
): GeographicCameraState {
  if (!isUsable(state) || !Number.isFinite(factor) || factor <= 0) return state;
  const pivot = groundPivot(state);
  if (pivot === null) {
    return {
      ...state,
      height: clamp(
        state.height * factor,
        MIN_CAMERA_HEIGHT_M,
        MAX_CAMERA_HEIGHT_M,
      ),
    };
  }
  return cameraAtPivot(
    pivot,
    state.heading,
    state.pitch,
    clamp(pivot.distance * factor, MIN_PIVOT_DISTANCE_M, MAX_PIVOT_DISTANCE_M),
    state.roll,
  );
}

/**
 * One tilt step: `deltaDeg` degrees of pitch, positive tilting UP towards the
 * horizon, orbiting the pivot so the model stays framed. Clamped to `limits`,
 * which defaults to the buttons' own range ({@link DEFAULT_PITCH_LIMITS}) and
 * is narrowed by the active view mode — a mode that pins the pitch passes
 * `minDeg === maxDeg`, so a step lands back on exactly that angle.
 */
export function tiltedCamera(
  state: GeographicCameraState,
  deltaDeg: number,
  limits: PitchLimits = DEFAULT_PITCH_LIMITS,
): GeographicCameraState {
  if (!isUsable(state) || !Number.isFinite(deltaDeg)) return state;
  const pitch = clamp(state.pitch + deltaDeg, limits.minDeg, limits.maxDeg);
  const pivot = groundPivot(state);
  if (pivot === null) return { ...state, pitch };
  return cameraAtPivot(pivot, state.heading, pitch, pivot.distance, state.roll);
}

/**
 * Point the camera north, orbiting the pivot: the model stays where it is on
 * screen and rotates under the camera, rather than the view swinging off it.
 */
export function northedCamera(
  state: GeographicCameraState,
): GeographicCameraState {
  if (!isUsable(state)) return state;
  const pivot = groundPivot(state);
  if (pivot === null) return { ...state, heading: 0 };
  return cameraAtPivot(pivot, 0, state.pitch, pivot.distance, state.roll);
}

/**
 * How far the compass dial has to be rotated on screen, in degrees clockwise,
 * for its N marker to point at true north.
 *
 * The camera's heading is measured clockwise from north, so a camera looking
 * east (90) needs its dial turned 90 degrees anticlockwise — i.e. the dial's
 * rotation is the NEGATED heading. Returned in [0, 360) so a CSS `rotate()`
 * never carries a sign the stylesheet has to reason about.
 */
export function compassRotationDeg(heading: number): number {
  return normaliseHeading(-heading);
}

/** The bearing as it is read out under the dial: three digits and a degree
 *  sign, so the column never changes width as the camera turns (and 360 reads
 *  as 000, not as a fourth digit). */
export function formatBearing(heading: number): string {
  const rounded = Math.round(normaliseHeading(heading)) % 360;
  return `${String(rounded).padStart(3, "0")}°`;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The eight-point cardinal the camera is facing — what makes the compass
 *  readable at a glance, where three digits are not. */
export function cardinalFor(heading: number): string {
  const index = Math.round(normaliseHeading(heading) / 45) % CARDINALS.length;
  return CARDINALS[index]!;
}

/** The tilt readout: whole degrees BELOW the horizon, which is how a viewer
 *  thinks about it — the engine's own pitch is negative looking down. */
export function formatTilt(pitch: number): string {
  if (!Number.isFinite(pitch)) return "0°";
  return `${Math.round(-pitch)}°`;
}
