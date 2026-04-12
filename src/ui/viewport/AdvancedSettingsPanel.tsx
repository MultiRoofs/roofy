/**
 * Advanced rendering settings panel.
 *
 * Floating overlay at top-right of viewport, toggled from toolbar gear button.
 * Contains rendering configuration: lens flare, cloud coverage, etc.
 */

import { useAtmosphereStore } from "../../features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../features/tiles/tilesStore";
import {
  useRenderDebugStore,
  type CityMaterialMode,
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
  const cityShadowsEnabled = useRenderDebugStore((s) => s.cityShadowsEnabled);
  const setCityShadowsEnabled = useRenderDebugStore(
    (s) => s.setCityShadowsEnabled,
  );
  const cityDoubleSided = useRenderDebugStore((s) => s.cityDoubleSided);
  const setCityDoubleSided = useRenderDebugStore((s) => s.setCityDoubleSided);
  const cityMaterialMode = useRenderDebugStore((s) => s.cityMaterialMode);
  const setCityMaterialMode = useRenderDebugStore((s) => s.setCityMaterialMode);
  const resetDebugSettings = useRenderDebugStore((s) => s.reset);

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
        {/* Rendering */}
        <div className="attr-section">
          <div className="attr-section-title">Rendering</div>
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
          <div className="advanced-toggle-row">
            <span>Google 3D Tiles</span>
            <input
              type="checkbox"
              aria-label="Google 3D Tiles"
              checked={tilesEnabled}
              onChange={(e) => setTilesEnabled(e.target.checked)}
            />
          </div>
        </div>

        <div className="attr-section">
          <div className="attr-section-title">Scene Debug</div>
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
            <span>City Shadows</span>
            <input
              type="checkbox"
              aria-label="City Shadows"
              checked={cityShadowsEnabled}
              onChange={(e) => setCityShadowsEnabled(e.target.checked)}
            />
          </div>
          <div className="advanced-toggle-row">
            <span>Double Sided</span>
            <input
              type="checkbox"
              aria-label="Double Sided"
              checked={cityDoubleSided}
              onChange={(e) => setCityDoubleSided(e.target.checked)}
            />
          </div>
          <div className="advanced-toggle-row advanced-select-row">
            <label htmlFor="city-material-mode">City Material</label>
            <select
              id="city-material-mode"
              className="advanced-select"
              value={cityMaterialMode}
              onChange={(e) =>
                setCityMaterialMode(e.target.value as CityMaterialMode)
              }
            >
              <option value="standard">Standard</option>
              <option value="basic">Basic</option>
            </select>
          </div>
          <div className="advanced-settings-actions">
            <button className="rule-cancel-btn" onClick={resetDebugSettings}>
              Reset Debug
            </button>
          </div>
        </div>

        {/* Clouds */}
        <div className="attr-section">
          <div className="attr-section-title">Clouds</div>
          <div className="attr-row">
            <span className="attr-key">Coverage</span>
            <span className="attr-value">
              {(cloudCoverage * 100).toFixed(0)}%
            </span>
          </div>
          <div className="solar-control-row">
            <input
              type="range"
              className="solar-slider"
              min={0}
              max={1}
              step={0.01}
              value={cloudCoverage}
              onChange={(e) => setCoverage(Number(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
