/**
 * Clock arithmetic for the sun animation.
 *
 * The play button advances `solarStore.datetime` from the engine's render loop
 * (`NavaraViewport`'s `preUpdate` subscription). Two rules make that safe, and
 * both live here rather than in the loop so they can be tested without a frame:
 *
 *  - a frame delta is CAPPED. `setAnimationLoop` stops firing in a backgrounded
 *    tab, so the first frame after a refocus carries the whole time the tab was
 *    away; uncapped, that would teleport the sun (at 3600x, ten seconds away is
 *    ten hours of sun) instead of resuming where it was.
 *  - the store is written on a WALL-CLOCK beat, not per frame. The atmosphere
 *    takes the new date imperatively every frame, but `setDatetime` re-renders
 *    every solar readout in the app, so it runs at ~10 Hz — fast enough to read,
 *    slow enough not to put React in the render loop.
 *
 * Carried over from the retired `CitySceneR3F`'s `useFrame` block (both
 * constants included), which is where these numbers were tuned.
 */

/** Longest frame delta the animation will honour, in seconds. */
const MAX_DELTA_S = 0.1;
/** Wall-clock milliseconds between two `setDatetime` publications. */
const STORE_SYNC_MS = 100;

export interface TimeStep {
  /** The datetime the atmosphere should show on this frame. */
  readonly next: Date;
  /** Whether this frame's date is also due to reach the store (and with it the
   *  toolbar clock, the solar tab and the sun readout). */
  readonly shouldSyncStore: boolean;
}

export function advanceTime(
  current: Date,
  deltaSeconds: number,
  speed: number,
  msSinceLastSync: number,
): TimeStep {
  const clamped = Math.min(deltaSeconds, MAX_DELTA_S);
  return {
    next: new Date(current.getTime() + clamped * 1000 * speed),
    shouldSyncStore: msSinceLastSync > STORE_SYNC_MS,
  };
}
