/**
 * Preferences — the gear at the end of the header, and the ONE place the
 * interface's appearance is chosen.
 *
 * The sun/moon toggle it replaces is gone from both the header and the
 * landing page (design ruling D10): a two-state toggle cannot express "follow
 * my system", which is what most people actually want, and a toggle sitting
 * in the header also claimed appearance was a scene control rather than a
 * setting. Segmented System / Light / Dark says all three states at once and
 * shows which one is in force.
 *
 * The popover holds appearance alone today. Units and Reduce motion were
 * dropped from the design (metric only; reduced motion is honoured by CSS
 * `prefers-reduced-motion`), so the section is titled rather than the popover
 * being one unlabelled row — the next preference to land gets a peer, not a
 * rewrite.
 *
 * Rendered by both the landing page and the viewer header. `tooltip` opts in
 * to the header's hover-bubble attributes; the landing page has no tooltip
 * system, so it stays off there.
 */
import { useTheme } from "../../features/theme/useTheme";
import type { ThemePreference } from "../../features/theme/themeStore";
import { useHeaderMenu } from "./useHeaderMenu";

const APPEARANCE_OPTIONS: ReadonlyArray<{
  readonly value: ThemePreference;
  readonly label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function PreferencesMenu({ tooltip = false }: { tooltip?: boolean }) {
  const { preference, setPreference } = useTheme();
  const { open, toggle, rootRef, triggerRef } = useHeaderMenu();

  return (
    <div className="header-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`tb-btn preferences-trigger ${open ? "tb-btn-active" : ""}`}
        aria-label="Preferences"
        aria-expanded={open}
        aria-haspopup="dialog"
        {...(tooltip
          ? { "data-tooltip": "Preferences", "data-tooltip-align": "end" }
          : {})}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
        <span>Preferences</span>
      </button>

      {open && (
        <div
          className="header-popover preferences-popover"
          role="dialog"
          aria-label="Preferences"
        >
          <div className="attr-section">
            <div className="attr-section-title">Interface appearance</div>
            <div
              className="appearance-segments"
              role="group"
              aria-label="Interface appearance"
            >
              {APPEARANCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`appearance-segment ${
                    preference === option.value ? "is-selected" : ""
                  }`}
                  aria-pressed={preference === option.value}
                  onClick={() => setPreference(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
