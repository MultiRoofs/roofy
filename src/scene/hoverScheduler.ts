/**
 * Coalesces pointer moves into at most one hover resolve per animation frame,
 * and resolves none while a button is held.
 *
 * A hover resolve is a raycast against every visible city layer, and a pointer
 * reports moves far faster than a screen can show the highlight they produce;
 * during a drag the camera moves under the pointer and nothing should be
 * highlighted at all.
 */

export interface ScreenPointLike {
  readonly x: number;
  readonly y: number;
}

export interface HoverScheduler {
  /** A pointer move at `point`; `buttons` is `PointerEvent.buttons`. */
  move(point: ScreenPointLike, buttons: number): void;
  /** Drop a move that has not been resolved yet. */
  cancel(): void;
}

export function createHoverScheduler(options: {
  readonly schedule: (callback: () => void) => void;
  readonly resolve: (point: ScreenPointLike) => void;
}): HoverScheduler {
  let pending: ScreenPointLike | null = null;
  let scheduled = false;
  const run = () => {
    scheduled = false;
    const point = pending;
    pending = null;
    if (point) options.resolve(point);
  };
  return {
    move(point, buttons) {
      if (buttons !== 0) {
        pending = null;
        return;
      }
      pending = point;
      if (scheduled) return;
      scheduled = true;
      options.schedule(run);
    },
    cancel() {
      pending = null;
    },
  };
}
