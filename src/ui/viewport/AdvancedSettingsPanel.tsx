/**
 * Advanced rendering settings panel.
 *
 * Floating overlay at top-right of the viewport, toggled from the toolbar gear
 * button.
 *
 * EVERY control here drives live engine state — a `DefaultPlugin`
 * photoreal-scene handle, a `view.addEffect` pass, `view.addLight`,
 * `view.toneMappingExposure`, or a source/layer pair. That is the whole point
 * of this file's second pass: it previously carried "City Shadows", "Double
 * Sided" and "City Material", none of which was read by anything, so a third
 * of the panel was decorative. They are gone rather than wired — their real
 * counterpart is the city mesh's three.js material, which lives in
 * `@cityjson/navara-cityjson`, not in the app (see `renderDebugStore.ts`).
 */

import { useAtmosphereStore } from "../../features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../features/tiles/tilesStore";
import { useBasemapStore } from "../../features/basemap/basemapStore";
import { BASEMAPS, type BasemapId } from "../../scene/basemaps";
import {
  AMBIENT_RANGE,
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
  const ambientIntensity = useRenderDebugStore((s) => s.ambientIntensity);
  const setAmbientIntensity = useRenderDebugStore((s) => s.setAmbientIntensity);
  const resetRenderSettings = useRenderDebugStore((s) => s.reset);

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
          <div className="attr-row">
            <span className="attr-key">Ambient Light</span>
            <span className="attr-value">{ambientIntensity.toFixed(2)}</span>
          </div>
          <div className="advanced-slider-row">
            <input
              type="range"
              className="advanced-slider"
              aria-label="Ambient Light"
              min={AMBIENT_RANGE.min}
              max={AMBIENT_RANGE.max}
              step={AMBIENT_RANGE.step}
              value={ambientIntensity}
              onChange={(e) => setAmbientIntensity(Number(e.target.value))}
            />
          </div>
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
          <div className="advanced-settings-actions">
            <button className="rule-cancel-btn" onClick={resetRenderSettings}>
              Reset Rendering
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
