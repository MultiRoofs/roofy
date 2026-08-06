/**
 * The scene-theme picker: four looks, one popover, one toolbar button.
 *
 * Popover mechanics copied from `SolarMenu` beside it (outside-click and
 * Escape dismissal, focus moved into the dialog on open and back to the trigger
 * on Escape) so the header behaves the same way whichever button opened it.
 *
 * Radios rather than a segmented control, unlike `ViewModeToggle`: a theme
 * needs a sentence to be choosable — "cyber" and "wireframe" mean nothing on
 * their own — and four labelled sentences do not fit in a toolbar row.
 *
 * Reads and writes `sceneThemeStore` only. What a theme DOES is
 * `scene/sceneThemePolicy.ts`; this file only names them.
 */
import { useEffect, useRef, useState } from "react";
import {
  SCENE_THEMES,
  useSceneThemeStore,
  type SceneTheme,
} from "../../features/sceneTheme/sceneThemeStore";

/** Name and one-line description per theme — the whole of the UI's copy, in
 *  the order `SCENE_THEMES` lists them. */
const THEME_COPY: Record<
  SceneTheme,
  { readonly label: string; readonly description: string }
> = {
  photoreal: {
    label: "Photoreal",
    description: "The real globe, real sky and real imagery.",
  },
  cartoon: {
    label: "Cartoon",
    description: "Flat colours on a pastel map, drawn with dark ink edges.",
  },
  cyber: {
    label: "Cyber",
    description: "Night city: dark fills, glowing neon edges, stars up.",
  },
  wireframe: {
    label: "Wireframe",
    description: "Architectural hidden-line — bright edges, nothing else.",
  },
};

export function SceneThemeMenu() {
  const theme = useSceneThemeStore((s) => s.theme);
  const setSceneTheme = useSceneThemeStore((s) => s.setSceneTheme);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape — same reasoning as `SolarMenu`: a
  // toolbar popover that only closes via its own button covers the viewport
  // until the user finds that button again.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Never strand the focus ring on a node that has just unmounted.
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Focus the ACTIVE option when the popover opens, not merely the first one:
  // this is a radio group, and landing on the current choice is where a
  // keyboard user expects to arrive.
  useEffect(() => {
    if (!open) return;
    const active = dialogRef.current?.querySelector<HTMLElement>(
      '[aria-checked="true"]',
    );
    (
      active ?? dialogRef.current?.querySelector<HTMLElement>("button")
    )?.focus();
  }, [open]);

  const activeLabel = THEME_COPY[theme].label;

  return (
    <div className="toolbar-theme-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`tb-btn ${open ? "tb-btn-active" : ""}`}
        aria-label="Scene theme"
        aria-expanded={open}
        aria-haspopup="dialog"
        // Pressed whenever a theme is actually overriding the scene, so the
        // header shows at a glance that what is on screen is not the viewer's
        // own rendering.
        aria-pressed={theme !== "photoreal"}
        title={`Scene theme — ${activeLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 000 18" />
          <path d="M12 3v18" />
        </svg>
      </button>

      {open && (
        <div
          ref={dialogRef}
          className="toolbar-solar-popover scene-theme-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Scene theme"
        >
          <div className="attr-section">
            <div className="attr-section-title">Scene theme</div>
            <div
              role="radiogroup"
              aria-label="Scene theme"
              className="scene-theme-list"
            >
              {SCENE_THEMES.map((candidate) => {
                const { label, description } = THEME_COPY[candidate];
                const active = candidate === theme;
                return (
                  <button
                    key={candidate}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`scene-theme-option${active ? " scene-theme-option-active" : ""}`}
                    onClick={() => setSceneTheme(candidate)}
                  >
                    <span className="scene-theme-name">{label}</span>
                    <span className="scene-theme-desc">{description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
