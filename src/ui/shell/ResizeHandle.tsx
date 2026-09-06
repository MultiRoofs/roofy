/**
 * The shell's one drag handle: a 4px strip that reports pointer movement
 * along ONE axis and knows nothing about what it resizes.
 *
 * `onDelta` receives the movement SINCE THE LAST MOVE, not since the drag
 * started, so a consumer can add it to whatever the store currently holds
 * without carrying a start value across the drag (`useShellStore.getState()`
 * at the moment of the move is always the truth). The cost is that a drag
 * pushed past a clamp has to travel back the same distance before the panel
 * moves again; the alternative — a cumulative delta — needs a start width the
 * `{ axis, onDelta, label }` contract has nowhere to put.
 *
 * `setPointerCapture` is guarded: jsdom has no pointer capture, and calling
 * it there throws where the drag would otherwise work fine.
 */

import { useCallback, useEffect, useRef } from "react";

export interface ResizeHandleProps {
  /** "x" for a vertical handle on a panel's side edge, "y" for a horizontal
   *  one on the drawer's top edge. */
  readonly axis: "x" | "y";
  /** Pixels moved along `axis` since the previous move event: positive is
   *  right (x) or down (y). */
  readonly onDelta: (px: number) => void;
  /** The handle's accessible name — "Resize details panel". */
  readonly label: string;
}

export function ResizeHandle({ axis, onDelta, label }: ResizeHandleProps) {
  const draggingRef = useRef(false);
  const lastRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // A drag that outlives the handle (a panel closing under it) would leave
  // its window listeners behind.
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      lastRef.current = axis === "x" ? e.clientX : e.clientY;

      const target = e.currentTarget;
      const pointerId = e.pointerId;
      if (typeof target.setPointerCapture === "function") {
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // No capture available (jsdom, or a pointer already gone): the
          // window listeners below carry the drag on their own.
        }
      }

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const position = axis === "x" ? ev.clientX : ev.clientY;
        const delta = position - lastRef.current;
        lastRef.current = position;
        if (delta !== 0) onDelta(delta);
      };

      const stop = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        cleanupRef.current = null;
        if (typeof target.releasePointerCapture === "function") {
          try {
            target.releasePointerCapture(pointerId);
          } catch {
            // Never captured, or the pointer is already gone.
          }
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      cleanupRef.current = stop;
    },
    [axis, onDelta],
  );

  return (
    <div
      className={`resize-handle resize-handle-${axis}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      onPointerDown={handlePointerDown}
    />
  );
}
