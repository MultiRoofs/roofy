/**
 * The camera's live orientation, published for the overlays that read it.
 *
 * WHY THIS EXISTS AT ALL: the compass and the scale bar have to follow the
 * camera, and the camera moves inside the engine's render loop. Putting that
 * in React state on
 * `NavaraViewport` would re-render the whole viewport — and re-evaluate every
 * engine binding hanging off it — at gesture rate, for two numbers only a
 * 40-pixel dial reads. So the viewport PUBLISHES here and only the overlay
 * subscribes, exactly as the solar animation publishes to `solarStore` on a
 * ~10 Hz beat instead of setting state per frame.
 *
 * The publication cadence is the viewport's business (it throttles the engine's
 * `move` events and publishes on `moveend`); this module's own contribution is
 * the EPSILON below — a pose that differs by less than a twentieth of a degree
 * is not published at all, so a drifting last decimal cannot re-render the
 * overlay on a camera nobody is moving.
 *
 * A module-level singleton rather than a store instance, for the same reason
 * `streamPlugin.ts` is one: at most one `NavaraViewport` may be mounted per
 * process (Navara's tile worker pool is a process-wide singleton), so there is
 * exactly one camera to speak for. Engine-free — no `@navaramap/*` — so tests
 * drive it directly.
 */
import { useSyncExternalStore } from "react";

export interface CameraPose {
  /** Degrees clockwise from north. */
  readonly heading: number;
  /** Degrees, negative looking down. */
  readonly pitch: number;
  /**
   * The latitude the camera stands over, in degrees.
   *
   * Here rather than in a second publisher because the SCALE BAR needs it and
   * the scale bar is the same kind of consumer as the compass: a few pixels of
   * overlay that must follow the camera without re-rendering the viewport.
   * Web Mercator's metres-per-pixel is proportional to cos(latitude), so a
   * scale bar that ignores it is wrong by a factor of two over Delft.
   */
  readonly lat: number;
  /**
   * The engine's fractional Web-Mercator zoom (`view.camera.zoom`), or
   * `undefined` when it has none to report yet.
   *
   * Optional because the engine's own type is `number | undefined`: the value
   * is computed from the ellipsoid height, the field of view and the viewport,
   * none of which exist before the first rendered frame. The scale bar hides
   * itself rather than inventing a scale.
   */
  readonly zoom?: number;
}

/** Below this, an angular change is drift rather than movement. */
const POSE_EPSILON_DEG = 0.05;
/** Below this, a zoom change cannot move the scale bar by a pixel. */
const ZOOM_EPSILON = 0.01;

let current: CameraPose | null = null;
const listeners = new Set<() => void>();

function same(a: CameraPose | null, b: CameraPose | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.zoom === undefined || b.zoom === undefined) {
    // A zoom appearing or disappearing is exactly the moment the scale bar
    // shows or hides, so it is never "the same pose".
    if (a.zoom !== b.zoom) return false;
  } else if (Math.abs(a.zoom - b.zoom) >= ZOOM_EPSILON) {
    return false;
  }
  return (
    Math.abs(a.heading - b.heading) < POSE_EPSILON_DEG &&
    Math.abs(a.pitch - b.pitch) < POSE_EPSILON_DEG &&
    Math.abs(a.lat - b.lat) < POSE_EPSILON_DEG
  );
}

/**
 * Publish the pose the camera is at now, or `null` when there is no camera to
 * speak for (before the engine's first frame, and after it is torn down).
 *
 * Notifying is skipped for an unchanged pose, which is what keeps a subscriber
 * off the render path while the camera is still.
 */
export function publishCameraPose(pose: CameraPose | null): void {
  if (same(current, pose)) return;
  current = pose;
  // A copy: a listener that unsubscribes from inside its own callback (React
  // does exactly that on unmount) must not shorten the set being iterated.
  for (const listener of Array.from(listeners)) listener();
}

export function getCameraPose(): CameraPose | null {
  return current;
}

export function subscribeCameraPose(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The live pose, or `null` while there is no camera.
 *
 * `useSyncExternalStore` rather than a `useState` + effect pair: the snapshot
 * is the module's own object, so React never tears between the value a control
 * acts on and the value the dial is drawn from.
 */
export function useCameraPose(): CameraPose | null {
  return useSyncExternalStore(
    subscribeCameraPose,
    getCameraPose,
    getCameraPose,
  );
}
