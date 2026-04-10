/**
 * Advanced rendering settings panel.
 *
 * Floating overlay at top-right of viewport, toggled from toolbar gear button.
 * Contains rendering configuration: lens flare, cloud coverage, etc.
 */

import { useAtmosphereStore } from "../../features/atmosphere/atmosphereStore";

interface AdvancedSettingsPanelProps {
  readonly onClose: () => void;
}

export function AdvancedSettingsPanel({ onClose }: AdvancedSettingsPanelProps) {
  const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
  const setCoverage = useAtmosphereStore((s) => s.setCoverage);
  const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);
  const setLensFlareEnabled = useAtmosphereStore((s) => s.setLensFlareEnabled);

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
            <span>Lens Flare</span>
            <input
              type="checkbox"
              checked={lensFlareEnabled}
              onChange={(e) => setLensFlareEnabled(e.target.checked)}
            />
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
