/**
 * Advanced rendering settings panel.
 *
 * Floating overlay at top-right of the viewport, toggled from the toolbar gear
 * button.
 *
 * EVERY control here drives live engine state — a `DefaultPlugin`
 * photoreal-scene handle, a `view.addEffect` pass,
 * `view.toneMappingExposure`, or a source/layer pair. That is the whole point
 * of this file's second pass: it previously carried "City Shadows", "Double
 * Sided" and "City Material", none of which was read by anything, so a third
 * of the panel was decorative. They are gone rather than wired — their real
 * counterpart is the city mesh's three.js material, which lives in
 * `@cityjson/navara-cityjson`, not in the app (see `renderDebugStore.ts`).
 */

import {
  useAtmosphereStore,
  type Precipitation,
} from "../../features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../features/tiles/tilesStore";
import { useBasemapStore } from "../../features/basemap/basemapStore";
import { BASEMAPS, type BasemapId } from "../../scene/basemaps";
import {
  EXPOSURE_RANGE,
  useRenderDebugStore,
} from "../../features/debug/renderDebugStore";

interface AdvancedSettingsPanelProps {
  readonly onClose: () => void;
}

export function AdvancedSettingsPanel({ onClose }: AdvancedSettingsPanelProps) {
  const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
  const setCoverage = useAtmosphereStore((s) => s.setCoverage);
  const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);
  const setLensFlareEnabled = useAtmosphereStore((s) => s.setLensFlareEnabled);
  const precipitation = useAtmosphereStore((s) => s.precipitation);
  const setPrecipitation = useAtmosphereStore((s) => s.setPrecipitation);
  const tilesEnabled = useTilesStore((s) => s.enabled);
  const setTilesEnabled = useTilesStore((s) => s.setEnabled);
  const basemapId = useBasemapStore((s) => s.basemapId);
  const setBasemapId = useBasemapStore((s) => s.setBasemapId);
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
   * Restore every LIGHTING and POST-PROCESSING default, in one action.
   *
   * Both stores, because the split between them is historical and invisible
   * here: lens flare and cloud coverage live in `atmosphereStore`, the rest in
   * `renderDebugStore`, and a reset that silently skipped two of the sliders it
   * sits under would be exactly the incoherence this button used to have when
   * it was tucked inside the Backdrop section resetting neither of the two
   * controls above it.
   *
   * Deliberately NOT the backdrop: the basemap and the Google tileset are
   * choices of what to look AT, not of how it is rendered, and silently
   * swapping the user's imagery is not what "reset render settings" promises.
   * The button's title says so out loud.
   */
  const resetRenderSettings = () => {
    resetRenderDebug();
    resetAtmosphere();
  };

  return (
    <div className="advanced-settings-panel">
      <div className="advanced-settings-header">
        <span>Advanced Settings</span>
        <button className="tb-btn" title="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="advanced-settings-body">
        {/* Lighting — the section that decides how bright the scene reads. */}
        <div className="attr-section">
          <div className="attr-section-title">Lighting</div>
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
        </div>

        {/* Post processing */}
        <div className="attr-section">
          <div className="attr-section-title">Post Processing</div>
          <div className="advanced-toggle-row">
            <span>Enabled</span>
            <input
              type="checkbox"
              aria-label="Post Processing"
              checked={postProcessingEnabled}
              onChange={(e) => setPostProcessingEnabled(e.target.checked)}
            />
          </div>
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
        </div>

        {/* Backdrop */}
        <div className="attr-section">
          <div className="attr-section-title">Backdrop</div>
          <div className="advanced-toggle-row">
            <span>Google 3D Tiles</span>
            <input
              type="checkbox"
              aria-label="Google 3D Tiles"
              checked={tilesEnabled}
              onChange={(e) => setTilesEnabled(e.target.checked)}
            />
          </div>
          <div className="advanced-toggle-row advanced-select-row">
            <label htmlFor="advanced-basemap">Basemap</label>
            <select
              id="advanced-basemap"
              className="advanced-select"
              value={basemapId}
              onChange={(e) => setBasemapId(e.target.value as BasemapId)}
            >
              {BASEMAPS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
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
          title="Restore the default lighting and post-processing settings. The basemap and Google 3D Tiles choices are left alone."
          onClick={resetRenderSettings}
        >
          Reset render settings
        </button>
      </div>
    </div>
  );
}
