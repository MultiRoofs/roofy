/**
 * What a view mode MEANS, as a table.
 *
 * Navara 0.0.5 has no scene mode, no orthographic camera and no pitch clamp
 * (audited against the installed `.d.ts`), so 2D and 2.5D cannot be asked for —
 * they have to be BUILT out of the three levers the engine and this app already
 * have:
 *
 *   1. `view.camera.options = { enableSpin, enableTilt }` — which gestures the
 *      engine's controller still accepts;
 *   2. one entry flight (`view.flyTo`) that puts the camera where the mode
 *      says it belongs;
 *   3. the app's OWN soft pitch clamp in `cameraControls.ts`, narrowed per
 *      mode, which is what keeps the tilt buttons inside the mode.
 *
 * Pure and ENGINE-FREE, like every other module in this directory that is not
 * named after a binding: the viewport applies the table, the toolbar and the
 * compass overlay read it to disable what the mode forbids, and the tests below
 * are the specification. One table, so a mode cannot mean one thing to the
 * camera and another to the buttons.
 */
import type { ViewMode } from "../features/viewMode/viewModeStore";
import { MAX_PITCH_DEG, MIN_PITCH_DEG } from "./cameraControls";
import type { GeographicCameraState, ViewDirection } from "./geographicCamera";

/**
 * The plan view's pitch — a tenth of a degree short of straight down, and
 * NEVER exactly -90.
 *
 * `geographicCamera.ts` documents why: a camera looking exactly along the down
 * axis has no heading to derive (`atan2(-0, -0)` reports 180, silently spinning
 * the view round), and `cameraControls.ts`'s pivot maths degenerates for the
 * same reason. A tenth of a degree is invisible at any zoom this viewer reaches
 * and keeps both derivations well-conditioned.
 */
export const PLAN_PITCH_DEG = -89.9;

/** 2.5D's fixed obliquity — the same 60 degrees `cameraForBounds` frames a
 *  model at, so entering 2.5D looks like the fit the user already knows. */
export const TILTED_PITCH_DEG = -60;

/** How long the entry flight takes. Long enough to read as a move rather than
 *  a cut, short enough that the mode feels like a switch. */
export const VIEW_MODE_ENTRY_MS = 600;

export interface ViewModePolicy {
  /** The engine's orbit gesture. */
  readonly enableSpin: boolean;
  /** The engine's tilt gesture. */
  readonly enableTilt: boolean;
  /** Lower bound of the app's own tilt clamp (`tiltedCamera`). */
  readonly minPitchDeg: number;
  /** Upper bound of the same clamp. Equal to `minPitchDeg` when the mode PINS
   *  the pitch, which is how 2D and 2.5D hold their angle. */
  readonly maxPitchDeg: number;
  /** Pitch the entry flight lands on, or `null` for a mode that does not move
   *  the camera at all (3D frees it; it does not reframe it). */
  readonly entryPitchDeg: number | null;
  /** Heading the entry flight pins, or `null` to keep the camera's own. */
  readonly entryHeadingDeg: number | null;
  /** Whether the app's tilt BUTTONS are offered at all. Distinct from
   *  `enableTilt` (which is about the engine's drag gesture): 2.5D keeps them,
   *  because with the clamp pinned they snap a drifted pitch back to exactly
   *  -60; 2D has nothing left for them to do. */
  readonly tiltButtons: boolean;
}

const POLICIES: Record<ViewMode, ViewModePolicy> = {
  "3d": {
    enableSpin: false,
    enableTilt: true,
    minPitchDeg: MIN_PITCH_DEG,
    maxPitchDeg: MAX_PITCH_DEG,
    entryPitchDeg: null,
    entryHeadingDeg: null,
    tiltButtons: true,
  },
  "2.5d": {
    enableSpin: false,
    enableTilt: false,
    minPitchDeg: TILTED_PITCH_DEG,
    maxPitchDeg: TILTED_PITCH_DEG,
    entryPitchDeg: TILTED_PITCH_DEG,
    entryHeadingDeg: null,
    tiltButtons: true,
  },
  "2d": {
    enableSpin: false,
    enableTilt: false,
    minPitchDeg: PLAN_PITCH_DEG,
    maxPitchDeg: PLAN_PITCH_DEG,
    entryPitchDeg: PLAN_PITCH_DEG,
    entryHeadingDeg: 0,
    tiltButtons: false,
  },
};

export function viewModePolicy(mode: ViewMode): ViewModePolicy {
  return POLICIES[mode];
}

/**
 * Where the camera should fly when `policy`'s mode is entered — the same place
 * it already is, seen the way the mode demands — or `null` when the mode moves
 * nothing (3D) or there is no usable camera to move.
 */
export function entryCameraFor(
  policy: ViewModePolicy,
  current: GeographicCameraState,
): GeographicCameraState | null {
  if (policy.entryPitchDeg === null) return null;
  const usable = [
    current.lng,
    current.lat,
    current.height,
    current.heading,
    current.pitch,
    current.roll,
  ].every((n) => Number.isFinite(n));
  if (!usable) return null;
  return {
    ...current,
    heading: policy.entryHeadingDeg ?? current.heading,
    pitch: policy.entryPitchDeg,
  };
}

/**
 * Whether an alignment direction still means anything in this mode.
 *
 * 2D is a plan view by definition, so a front/left/bottom alignment would fly
 * straight out of the mode the user just chose; Top is the alignment 2D
 * already IS, so it stays as a re-centre.
 *
 * NO CALLER IN `src/` since the T/F/R overlay was removed (2026-08-10) — the
 * cluster was the only place this gate was ever enforced, and
 * `CitySceneHandle.alignView` has never consulted it. Kept (with its test) as
 * the policy any future alignment UI, or a gated handle, should read.
 */
export function isAlignDirectionAllowed(
  mode: ViewMode,
  direction: ViewDirection,
): boolean {
  return mode !== "2d" || direction === "top";
}

/** Why a control is unavailable, in words the tooltip can show. One place, so
 *  every control explains the mode the same way. `tilt` is read by
 *  `CameraControls`; `align` has had no consumer since the T/F/R overlay went,
 *  and stays paired with {@link isAlignDirectionAllowed}. */
export const VIEW_MODE_LOCK_TITLE = {
  tilt: "Tilt is locked in 2D — switch to 2.5D or 3D to tilt the camera",
  align: "Only the top view is available in 2D",
} as const;
