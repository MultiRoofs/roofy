/**
 * Swallow file drags that miss a drop zone.
 *
 * A browser's default action for a file dropped on a document is to NAVIGATE
 * to it, which in a single-page viewer means the whole session — layers,
 * rules, camera — is gone because the user let go two centimetres left of the
 * target. There is no undo for that, and no warning either.
 *
 * Mounted once, for the whole app: every drop zone in the app calls
 * `preventDefault()` and `stopPropagation()` on its own drop, so nothing that
 * was AIMED at one ever reaches these window-level listeners. What reaches
 * them is exactly the missed drop, and the only thing they do about it is
 * refuse the browser's default. Deliberately silent: a missed drop should feel
 * like nothing happened, not raise an error the user did not ask for.
 *
 * Not capture-phase, on purpose — a capturing listener would run BEFORE the
 * drop zones and could not tell a hit from a miss.
 */

import { useEffect } from "react";

export function useFileDropGuard(): void {
  useEffect(() => {
    const isFileDrag = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    // Both are needed: a `drop` only fires at all where `dragover` was
    // prevented, so preventing `dragover` here is what lets `drop` run and be
    // swallowed rather than the browser handling the drop itself.
    const onDragOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}
