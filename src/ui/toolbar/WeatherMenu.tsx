/**
 * Weather, in one popover hanging off one toolbar button, sitting beside the
 * sun's — because clouds, rain and lens flare are all things that happen to the
 * SKY, and the sun is the other one. Grouping them by subject in the header is
 * what makes both reachable while looking at the scene; they were a section of
 * the Rendering panel until this pass, which put them behind a gear labelled
 * "how the scene is drawn" — true of the engine, useless to someone who wants
 * less cloud.
 *
 * Every control in here is a POST-PROCESSING pass, so the master toggle that
 * governs them (Rendering › Post Processing) lives in the Rendering panel and
 * switching it off disables most of this popover. That dependency now crosses
 * two SURFACES rather than two sections, so a fully-greyed popover would have
 * no visible cause — hence the hint line, which names where the switch is.
 * The user thinks in weather; the engine thinks in passes.
 *
 * Popover mechanics are `SolarMenu`'s, copied deliberately (outside-click and
 * Escape dismissal, focus into the dialog on open and back to the trigger on
 * Escape) and the chrome classes are shared with it — `SceneThemeMenu` already
 * reuses `.toolbar-solar-popover` for the same reason: the header must behave
 * and look the same whichever button opened it.
 *
 * Reads and writes `atmosphereStore` and `renderDebugStore` only — the same
 * fields, with the same disabled logic, as the section it replaces. What these
 * values DO is `NavaraViewport`'s effect wiring; this file only sets them.
 */

import { useEffect, useRef, useState } from "react";
import {
  useAtmosphereStore,
  type Precipitation,
} from "../../features/atmosphere/atmosphereStore";
import { useRenderDebugStore } from "../../features/debug/renderDebugStore";

export function WeatherMenu() {
  const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
  const setCoverage = useAtmosphereStore((s) => s.setCoverage);
  const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);
  const setLensFlareEnabled = useAtmosphereStore((s) => s.setLensFlareEnabled);
  const precipitation = useAtmosphereStore((s) => s.precipitation);
  const setPrecipitation = useAtmosphereStore((s) => s.setPrecipitation);
  const postProcessingEnabled = useRenderDebugStore(
    (s) => s.postProcessingEnabled,
  );
  const cloudsEnabled = useRenderDebugStore((s) => s.cloudsEnabled);
  const setCloudsEnabled = useRenderDebugStore((s) => s.setCloudsEnabled);

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
      // Never strand the focus ring on a node that has just unmounted: put it
      // back where the user opened this from.
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Move focus INTO the dialog when it opens, onto the first control.
  useEffect(() => {
    if (!open) return;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, button",
    );
    first?.focus();
  }, [open]);

  return (
    <div className="toolbar-weather-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`tb-btn weather-trigger ${open ? "tb-btn-active" : ""}`}
        aria-label="Weather"
        aria-expanded={open}
        aria-haspopup="dialog"
        // `data-tooltip`, never `title`: the toolbar's icon buttons draw the
        // app's own bubble, and both at once is two tips for one button.
        data-tooltip="Weather"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24">
          <path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 00-11.6 1.6A3.7 3.7 0 006.5 19h11z" />
        </svg>
      </button>

      {open && (
        <div
          ref={dialogRef}
          className="toolbar-solar-popover weather-menu-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Weather"
        >
          <div className="attr-section">
            <div className="attr-section-title">Weather</div>
            <div className="advanced-toggle-row">
              <span>Clouds</span>
              <input
                type="checkbox"
                aria-label="Clouds"
                checked={cloudsEnabled}
                disabled={!postProcessingEnabled}
                onChange={(e) => setCloudsEnabled(e.target.checked)}
              />
            </div>
            <div className="attr-row">
              <span className="attr-key">Cloud Coverage</span>
              <span className="attr-value">
                {(cloudCoverage * 100).toFixed(0)}%
              </span>
            </div>
            <div className="advanced-slider-row">
              <input
                type="range"
                className="advanced-slider"
                aria-label="Cloud Coverage"
                min={0}
                max={1}
                step={0.01}
                disabled={!postProcessingEnabled || !cloudsEnabled}
                value={cloudCoverage}
                onChange={(e) => setCoverage(Number(e.target.value))}
              />
            </div>
            {/* Rain and snow are alternatives, not independent switches: Navara
                models each as its own mesh and it makes no sense to ask for
                both, so this is one picker rather than two checkboxes. Needs a
                placed layer to fall on — with nothing loaded it selects but
                shows nothing. Deliberately NOT gated on the post chain, exactly
                as it was in the panel, which is why the hint below says the
                popover is mostly rather than wholly inert. */}
            <div className="advanced-toggle-row advanced-select-row">
              <label htmlFor="advanced-precipitation">Precipitation</label>
              <select
                id="advanced-precipitation"
                className="advanced-select"
                value={precipitation}
                onChange={(e) =>
                  setPrecipitation(e.target.value as Precipitation)
                }
              >
                <option value="none">None</option>
                <option value="rain">Rain</option>
                <option value="snow">Snow</option>
              </select>
            </div>
            <div className="advanced-toggle-row">
              <span>Lens Flare</span>
              <input
                type="checkbox"
                aria-label="Lens Flare"
                checked={lensFlareEnabled}
                disabled={!postProcessingEnabled}
                onChange={(e) => setLensFlareEnabled(e.target.checked)}
              />
            </div>
            {/* The one line that explains a popover full of dead controls. The
                switch it names is on another surface now, so without it the
                cause is invisible. */}
            {!postProcessingEnabled && (
              <p className="weather-menu-hint">
                Post-processing is off — enable it in Rendering settings
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
