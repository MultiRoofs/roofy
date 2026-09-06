/**
 * Rendering panel — how the scene is DRAWN, grouped by subject: rendering
 * (exposure, shadows, the post chain) and the viewer's own diagnostics.
 *
 * Floating overlay at top-right of the viewport, toggled from the toolbar gear
 * button.
 *
 * WEATHER used to be a third section here and is now its own toolbar popover
 * (`ui/toolbar/WeatherMenu.tsx`), beside the sun — clouds and rain are things
 * that happen to the sky, and the sky's other control was already in the
 * header. Two consequences live in this file: `Post Processing` below is still
 * the master switch those controls depend on, so the dependency crosses two
 * SURFACES now (the popover names this panel in a hint when it is off), and the
 * footer's reset still restores BOTH stores, weather values included.
 *
 * The BACKDROP — basemap and Google 3D Tiles — is deliberately not here: it is
 * a choice of what to look AT, and its one home is the header's Scene popover
 * (`BasemapPanel`, `GoogleTilesPanel` in `SceneControlsTemp`; the left sidebar
 * held them until the layer panel became the LAYER's home alone).
 *
 * EVERY control here drives live engine state — a `DefaultPlugin`
 * photoreal-scene handle, a `view.addEffect` pass, or
 * `view.toneMappingExposure`. That is the whole point
 * of this file's second pass: it previously carried "City Shadows", "Double
 * Sided" and "City Material", none of which was read by anything, so a third
 * of the panel was decorative. They are gone rather than wired — their real
 * counterpart is the city mesh's three.js material, which lives in
 * `@cityjson/navara-cityjson`, not in the app (see `renderDebugStore.ts`).
 *
 * The `advanced-*` class names are historical and kept as they are.
 */

import { useEffect } from "react";
import { useAtmosphereStore } from "../../features/atmosphere/atmosphereStore";
import {
  EXPOSURE_RANGE,
  useRenderDebugStore,
} from "../../features/debug/renderDebugStore";

interface RenderingPanelProps {
  readonly onClose: () => void;
}

export function RenderingPanel({ onClose }: RenderingPanelProps) {
  const postProcessingEnabled = useRenderDebugStore(
    (s) => s.postProcessingEnabled,
  );
  const setPostProcessingEnabled = useRenderDebugStore(
    (s) => s.setPostProcessingEnabled,
  );
  const aerialPerspectiveEnabled = useRenderDebugStore(
    (s) => s.aerialPerspectiveEnabled,
  );
  const setAerialPerspectiveEnabled = useRenderDebugStore(
    (s) => s.setAerialPerspectiveEnabled,
  );
  const sunShadowsEnabled = useRenderDebugStore((s) => s.sunShadowsEnabled);
  const setSunShadowsEnabled = useRenderDebugStore(
    (s) => s.setSunShadowsEnabled,
  );
  const exposure = useRenderDebugStore((s) => s.exposure);
  const setExposure = useRenderDebugStore((s) => s.setExposure);
  const streamQueryBoxEnabled = useRenderDebugStore(
    (s) => s.streamQueryBoxEnabled,
  );
  const setStreamQueryBoxEnabled = useRenderDebugStore(
    (s) => s.setStreamQueryBoxEnabled,
  );
  const resetRenderDebug = useRenderDebugStore((s) => s.reset);
  const resetAtmosphere = useAtmosphereStore((s) => s.reset);

  /**
   * Restore every RENDERING, WEATHER and DIAGNOSTIC default, in one action.
   *
   * Both stores, because the split between them is historical and invisible
   * here: lens flare, cloud coverage and precipitation live in
   * `atmosphereStore`, the rest in `renderDebugStore`, and neither store maps
   * to a section — a reset bound to one alone would silently leave part of
   * every section untouched.
   *
   * That is still true now that weather is a toolbar popover: this reset
   * reaches ACROSS to it, restoring cloud coverage, precipitation and lens
   * flare along with everything on this panel. Deliberate — "reset render
   * settings" promises one clean slate for how the scene is drawn, and half a
   * slate is worse than none. The button's tooltip says so out loud.
   *
   * It must never reach the backdrop stores either: swapping the user's
   * imagery is not what "reset render settings" promises.
   */
  const resetRenderSettings = () => {
    resetRenderDebug();
    resetAtmosphere();
  };

  // A floating panel closes on Escape like every other popover (the toolbar
  // menus listen the same way), unless a modal is open above it — the modal's
  // own trap owns the key then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".modal-backdrop")) return;
      onClose();
      // Never strand the focus ring on a node that has just unmounted: put it
      // back on the toolbar button this panel opened from (the panel does not
      // own that button's ref, so it is found by its label).
      document
        .querySelector<HTMLElement>('[aria-label="Rendering settings"]')
        ?.focus();
    };
    // Capture phase, so the check above sees the modal BEFORE its own Escape
    // handler has closed it and React has flushed the backdrop away.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="advanced-settings-panel">
      <div className="advanced-settings-header">
        <span>Rendering</span>
        <button className="tb-btn" title="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="advanced-settings-body">
        {/* Light — how bright the scene reads and which passes draw it. Named
            for its subject, not "Rendering" again under a "Rendering" header. */}
        <div className="attr-section">
          <div className="attr-section-title">Light &amp; passes</div>
          <div className="attr-row">
            <span className="attr-key">Exposure</span>
            <span className="attr-value">{exposure.toFixed(1)}</span>
          </div>
          <div className="advanced-slider-row">
            <input
              type="range"
              className="advanced-slider"
              aria-label="Exposure"
              min={EXPOSURE_RANGE.min}
              max={EXPOSURE_RANGE.max}
              step={EXPOSURE_RANGE.step}
              value={exposure}
              onChange={(e) => setExposure(Number(e.target.value))}
            />
          </div>
          {/* No ambient-light slider: the sky light probe the photoreal scene
              adds is the ambient term, sampled from the atmosphere, so a flat
              fill on top of it is energy on top of an already-calibrated
              image. Exposure is the one brightness knob. */}
          <div className="advanced-toggle-row">
            <span>Sun Shadows</span>
            <input
              type="checkbox"
              aria-label="Sun Shadows"
              checked={sunShadowsEnabled}
              onChange={(e) => setSunShadowsEnabled(e.target.checked)}
            />
          </div>
          {/* The master switch for the whole post chain — including every
              control in the toolbar's Weather popover, which is why that
              popover explains itself with a hint naming this panel when this
              is off. */}
          <div className="advanced-toggle-row">
            <span>Post Processing</span>
            <input
              type="checkbox"
              aria-label="Post Processing"
              checked={postProcessingEnabled}
              onChange={(e) => setPostProcessingEnabled(e.target.checked)}
            />
          </div>
          <div className="advanced-toggle-row">
            <span>Aerial Perspective</span>
            <input
              type="checkbox"
              aria-label="Aerial Perspective"
              checked={aerialPerspectiveEnabled}
              disabled={!postProcessingEnabled}
              onChange={(e) => setAerialPerspectiveEnabled(e.target.checked)}
            />
          </div>
        </div>

        {/* Diagnostics — switches that reveal how the viewer WORKS rather than
            changing how the scene looks. Their own section so they do not read
            as scene furniture sitting among the render settings. They are part
            of `renderDebugStore`, so "Reset render settings" does switch them
            back off, which is the right default for a debug overlay. */}
        <div className="attr-section">
          <div className="attr-section-title">Diagnostics</div>
          <div className="advanced-toggle-row">
            <span title="Outline the ground rectangle each streaming (.fcb) layer's last commit actually queried, and show its coordinates.">
              Streaming Fetch Box
            </span>
            <input
              type="checkbox"
              aria-label="Streaming Fetch Box"
              checked={streamQueryBoxEnabled}
              onChange={(e) => setStreamQueryBoxEnabled(e.target.checked)}
            />
          </div>
        </div>
      </div>

      {/* Footer, outside the scrolling body: this action spans the whole panel,
          so it must not read as belonging to whichever section happens to be
          last. */}
      <div className="advanced-settings-footer">
        <button
          className="rule-cancel-btn"
          title="Restore the default rendering and diagnostic settings, and the weather settings in the toolbar's Weather popover."
          onClick={resetRenderSettings}
        >
          Reset render settings
        </button>
      </div>
    </div>
  );
}
