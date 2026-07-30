/**
 * Pure hysteresis gate for the streaming driver's settle commit.
 *
 * Both thresholds are relative to the CURRENT span, so they track zoom
 * automatically — the same absolute pixel/metre drift matters less when
 * zoomed out. Bypassable on purpose: if the desired cover has holes, or the
 * level/LoD changed, a hysteresis skip would leave the view permanently
 * incomplete, so those two conditions always win over the thresholds below.
 */
import { MOVE_FRAC, SCALE_FACTOR } from "./constants";

export interface CommitView {
  readonly centre: readonly [number, number];
  readonly span: number;
}

export function shouldRefetch(
  prev: CommitView | null,
  next: CommitView,
  hasHoles: boolean,
  levelChanged: boolean,
): boolean {
  if (prev === null || hasHoles || levelChanged) return true;
  const moved = Math.hypot(
    next.centre[0] - prev.centre[0],
    next.centre[1] - prev.centre[1],
  );
  if (moved > prev.span * MOVE_FRAC) return true;
  const ratio = next.span / prev.span;
  return ratio >= SCALE_FACTOR || ratio <= 1 / SCALE_FACTOR;
}
