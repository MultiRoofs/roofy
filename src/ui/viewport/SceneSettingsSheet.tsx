import {
  useAtmosphereStore,
  type Precipitation,
} from "../../features/atmosphere/atmosphereStore";
import {
  EXPOSURE_RANGE,
  useRenderDebugStore,
} from "../../features/debug/renderDebugStore";
import {
  SCENE_THEMES,
  useSceneThemeStore,
} from "../../features/sceneTheme/sceneThemeStore";
import { BasemapPanel } from "../layers/BasemapPanel";
import { GoogleTilesPanel } from "../layers/GoogleTilesPanel";
import "./sceneSettingsSheet.css";

export function SceneSettingsSheet({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  const render = useRenderDebugStore();
  const atmosphere = useAtmosphereStore();
  const theme = useSceneThemeStore((s) => s.theme);
  const setTheme = useSceneThemeStore((s) => s.setSceneTheme);
  const reset = () => {
    render.reset();
    atmosphere.reset();
  };
  return (
    <section
      className="scene-settings-sheet"
      role="dialog"
      aria-label="Scene settings"
    >
      <header>
        <h2>Scene settings</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scene settings"
        >
          ×
        </button>
      </header>
      <div className="scene-settings-sheet__body">
        <section>
          <h3>Basemap</h3>
          <BasemapPanel />
        </section>
        <section>
          <h3>Context</h3>
          <GoogleTilesPanel />
        </section>
        <section>
          <h3>Rendering</h3>
          <label>
            Exposure <output>{render.exposure.toFixed(1)}</output>
            <input
              aria-label="Exposure"
              type="range"
              min={EXPOSURE_RANGE.min}
              max={EXPOSURE_RANGE.max}
              step={EXPOSURE_RANGE.step}
              value={render.exposure}
              onChange={(e) => render.setExposure(Number(e.target.value))}
            />
          </label>
          <Toggle
            label="Post processing"
            checked={render.postProcessingEnabled}
            onChange={render.setPostProcessingEnabled}
          />
          <Toggle
            label="Aerial perspective"
            checked={render.aerialPerspectiveEnabled}
            disabled={!render.postProcessingEnabled}
            onChange={render.setAerialPerspectiveEnabled}
          />
          <Toggle
            label="Sun shadows"
            checked={render.sunShadowsEnabled}
            onChange={render.setSunShadowsEnabled}
          />
          <label>
            Shadow quality
            <select
              aria-label="Shadow quality"
              disabled={!render.sunShadowsEnabled}
              value={render.shadowQuality}
              onChange={(e) =>
                render.setShadowQuality(
                  e.target.value as typeof render.shadowQuality,
                )
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <p className="scene-settings-sheet__hint">
            Low is faster and coarser. High uses 64 MB per cascade × 4.
          </p>
        </section>
        <section>
          <h3>Scene appearance</h3>
          <Toggle
            label="Clouds"
            checked={render.cloudsEnabled}
            disabled={!render.postProcessingEnabled}
            onChange={render.setCloudsEnabled}
          />
          <label>
            Cloud coverage{" "}
            <input
              aria-label="Cloud coverage"
              type="range"
              min="0"
              max="1"
              step=".01"
              disabled={!render.postProcessingEnabled || !render.cloudsEnabled}
              value={atmosphere.cloudCoverage}
              onChange={(e) => atmosphere.setCoverage(Number(e.target.value))}
            />
          </label>
          <label>
            Precipitation
            <select
              aria-label="Precipitation"
              value={atmosphere.precipitation}
              onChange={(e) =>
                atmosphere.setPrecipitation(e.target.value as Precipitation)
              }
            >
              <option value="none">None</option>
              <option value="rain">Rain</option>
              <option value="snow">Snow</option>
            </select>
          </label>
          <Toggle
            label="Lens flare"
            checked={atmosphere.lensFlareEnabled}
            disabled={!render.postProcessingEnabled}
            onChange={atmosphere.setLensFlareEnabled}
          />
          <p className="scene-settings-sheet__hint">
            Visual effect only, not weather data.
          </p>
        </section>
        <details>
          <summary>Presentation looks</summary>
          <p className="scene-settings-sheet__hint">
            A look can override your basemap and background choices.
          </p>
          {SCENE_THEMES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={theme === candidate}
              onClick={() => setTheme(candidate)}
            >
              {
                {
                  photoreal: "Photorealistic",
                  cartoon: "Cartoon",
                  cyber: "Cyber",
                  wireframe: "Wireframe",
                }[candidate]
              }
            </button>
          ))}
          <p className="scene-settings-sheet__hint">
            Cyber overrides layer colours.
          </p>
        </details>
        <details>
          <summary>Diagnostics</summary>
          <Toggle
            label="Streaming fetch box"
            checked={render.streamQueryBoxEnabled}
            onChange={render.setStreamQueryBoxEnabled}
          />
          <button type="button" onClick={reset}>
            Reset render and atmosphere settings
          </button>
        </details>
      </div>
    </section>
  );
}
function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className="scene-settings-sheet__toggle">
      <span>{label}</span>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
