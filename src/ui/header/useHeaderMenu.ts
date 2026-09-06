/**
 * The header's popover mechanics, in one place.
 *
 * Three of them hang off the workspace header (the workspace menu, the Scene
 * popover, Preferences) and they must behave identically: a click outside
 * dismisses, Escape dismisses AND hands the focus ring back to the trigger
 * that opened it — the rule the rendering panel was fixed to obey too, because
 * a popover that unmounts with the focus still inside strands the ring on
 * `<body>` and the keyboard user loses their place.
 *
 * Extracted rather than copied a third time from `SolarMenu`: three
 * hand-written copies of the same two listeners are three chances for one of
 * them to forget the focus hand-back.
 *
 * Escape is read on the DOCUMENT in the bubble phase, so a control inside the
 * popover that owns the key for itself — the inline rename field, where
 * Escape means "abandon this edit" — can keep it with `stopPropagation()`.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export interface HeaderMenu {
  readonly open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Put on the element wrapping BOTH the trigger and the popover: a click
   *  inside it is not an "outside" click. */
  readonly rootRef: RefObject<HTMLDivElement | null>;
  /** Put on the trigger button, so Escape can give it the focus back. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}

export function useHeaderMenu(): HeaderMenu {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((o) => !o),
    rootRef,
    triggerRef,
  };
}
