/**
 * Rendering panel — how the scene is DRAWN, grouped by subject: rendering
 * (exposure, shadows, the post chain), weather (clouds, precipitation, lens
 * flare) and the viewer's own diagnostics.
 *
 * Floating overlay at top-right of the viewport, toggled from the toolbar gear
 * button.
 *
 * The BACKDROP — basemap and Google 3D Tiles — is deliberately not here: it is
 * a choice of what to look AT, and its one home is the top of the left sidebar
 * (`BasemapPanel`, `GoogleTilesPanel`).
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

import {
  useAtmosphereStore,
  type Precipitation,
} from "../../features/atmosphere/atmosphereStore";
import {
  EXPOSURE_RANGE,
  useRenderDebugStore,
} from "../../features/debug/renderDebugStore";

interface RenderingPanelProps {
  readonly onClose: () => void;
}

export function RenderingPanel({ onClose }: RenderingPanelProps) {
  const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
  const setCoverage = useAtmosphereStore((s) => s.setCoverage);
  const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);
  const setLensFlareEnabled = useAtmosphereStore((s) => s.setLensFlareEnabled);
  const precipitation = useAtmosphereStore((s) => s.precipitation);
  const setPrecipitation = useAtmosphereStore((s) => s.setPrecipitation);
  const postProcessingEnabled = useRenderDebugStore(
    (s) => s.postProcessingEnabled,
  );
  const setPostProcessingEnabled = useRenderDebugStore(
    (s) => s.setPostProcessingEnabled,
  );
  const cloudsEnabled = useRenderDebugStore((s) => s.cloudsEnabled);
  const setCloudsEnabled = useRenderDebugStore((s) => s.setCloudsEnabled);
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
   * It must never reach the backdrop stores either: swapping the user's
   * imagery is not what "reset render settings" promises.
   */
  const resetRenderSettings = () => {
    resetRenderDebug();
    resetAtmosphere();
  };

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
        {/* Rendering — how bright the scene reads and which passes draw it. */}
        <div className="attr-section">
          <div className="attr-section-title">Rendering</div>
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
          {/* No ambient-light slider: the scene is lit by the physical
              atmosphere (the aerial-perspective pass in `irradiance` mode), not
              by scene lights, so a flat fill term is energy on top of an
              already-calibrated image. Exposure is the one brightness knob. */}
          <div className="advanced-toggle-row">
            <span>Sun Shadows</span>
            <input
              type="checkbox"
              aria-label="Sun Shadows"
              checked={sunShadowsEnabled}
              onChange={(e) => setSunShadowsEnabled(e.target.checked)}
            />
          </div>
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

        {/* Weather — grouped by subject, but every control in it is a
            post-processing pass, so the master toggle that governs them sits
            one section up (Rendering › Post Processing) and switching it off
            disables all of them. That dependency crosses the section boundary
            deliberately: the user thinks in weather, the engine thinks in
            passes. */}
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
              shows nothing. */}
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
          title="Restore the default rendering, weather and diagnostic settings."
          onClick={resetRenderSettings}
        >
          Reset render settings
        </button>
      </div>
    </div>
  );
}
