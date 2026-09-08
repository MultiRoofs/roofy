/**
 * A panel resize separator that supports pointer and keyboard resizing.
 * Pointer movement is always measured from pointerdown: returning from an
 * overshoot therefore returns to the original size rather than a clamped
 * intermediate value. `direction` maps physical movement to size changes.
 */

import { useCallback, useEffect, useRef } from "react";

const KEY_STEP = 16;
const PAGE_STEP = 64;

export interface ResizeHandleProps {
  /** "x" for a vertical panel edge, "y" for the drawer's top edge. */
  readonly axis: "x" | "y";
  /** Current, bounded size represented by the separator. */
  readonly current: number;
  readonly min: number;
  readonly max: number;
  /** +1 grows with right/down movement; -1 grows with left/up movement. */
  readonly direction: 1 | -1;
  /** Consumers clamp through their store before committing this value. */
  readonly onResize: (px: number) => void;
  /** The handle's accessible name — "Resize details panel". */
  readonly label: string;
}

export function ResizeHandle({
  axis,
  current,
  min,
  max,
  direction,
  onResize,
  label,
}: ResizeHandleProps) {
  const draggingRef = useRef(false);
  const originPositionRef = useRef(0);
  const originSizeRef = useRef(current);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      originPositionRef.current = axis === "x" ? event.clientX : event.clientY;
      originSizeRef.current = current;

      const target = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        target.setPointerCapture?.(pointerId);
      } catch {
        // jsdom and a departed pointer have no capture to release.
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (!draggingRef.current) return;
        const position = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
        onResize(
          originSizeRef.current +
            direction * (position - originPositionRef.current),
        );
      };
      const stop = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        cleanupRef.current = null;
        try {
          target.releasePointerCapture?.(pointerId);
        } catch {
          // The pointer may already have been released.
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      cleanupRef.current = stop;
    },
    [axis, current, direction, onResize],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === "Home") next = min;
      if (event.key === "End") next = max;
      if (event.key === "PageUp") next = current + PAGE_STEP;
      if (event.key === "PageDown") next = current - PAGE_STEP;

      const physicalDelta =
        (axis === "x" && event.key === "ArrowRight") ||
        (axis === "y" && event.key === "ArrowDown")
          ? KEY_STEP
          : (axis === "x" && event.key === "ArrowLeft") ||
              (axis === "y" && event.key === "ArrowUp")
            ? -KEY_STEP
            : null;
      if (physicalDelta !== null) next = current + direction * physicalDelta;
      if (next === null) return;

      event.preventDefault();
      onResize(Math.min(max, Math.max(min, next)));
    },
    [axis, current, direction, max, min, onResize],
  );

  return (
    <div
      className={`resize-handle resize-handle-${axis}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={current}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}
