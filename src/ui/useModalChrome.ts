/**
 * The modal behaviour every portal dialog in this app needs, in one place.
 *
 * Extracted verbatim from `AddLayerDialog`, which was the app's only modal
 * until the STAC catalog got one of its own. Duplicating a focus trap is how
 * two dialogs end up with two subtly different ideas of what Escape does, so
 * the behaviour lives here and the dialogs only supply their own markup:
 *
 *  - focus moves into the dialog on mount and is restored to whatever had it
 *    (the trigger) on unmount — captured in the mount effect, not read at
 *    cleanup time, when the trigger is long gone from `document.activeElement`;
 *  - the page behind the modal cannot scroll;
 *  - Escape closes, on the CAPTURE phase, so a handler further down (the
 *    viewport's, a nested list's) cannot eat it first;
 *  - Tab cycles WITHIN the dialog — a modal you can tab out of is a modal that
 *    hands the keyboard to controls the user cannot see.
 *
 * Backdrop dismissal is NOT here: it is a prop on the element the dialog
 * renders, not a document-level effect, and each dialog wires its own.
 */

import { useEffect, type RefObject } from "react";

/** Everything that can hold focus inside a dialog, in DOM order. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus capture/restore, body scroll lock, capture-phase Escape-to-close and
 * Tab focus trap for a portal modal. `dialogRef` is focused on mount, so it
 * must point at a `tabIndex={-1}` element carrying the dialog's own role and
 * accessible name.
 */
export function useModalChrome(
  dialogRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  // Focus in on open, focus back on close. Captured in a ref during the mount
  // effect rather than read at cleanup time, when the trigger is long gone
  // from `document.activeElement`.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // The dialog itself, not its first control: a screen reader then announces
    // the dialog's own name and role before the user starts tabbing.
    dialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
    // `dialogRef` is a stable ref object; re-running this would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page behind a modal must not scroll — a wheel over the backdrop that
  // moves the document is the clearest possible signal that the "modal" is
  // just a box drawn on top.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it has somehow escaped
      // (the dialog container itself is focusable but not in `focusable`).
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dialogRef, onClose]);
}
