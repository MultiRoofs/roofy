/**
 * Legend overlay displayed on the viewport when rules are active.
 *
 * Shows the active rules across all visible layers with their color
 * swatches and names.
 */

import { useState } from "react";
import { useLayerStore } from "../../features/layers/layerStore";

export function LegendOverlay() {
  const layers = useLayerStore((s) => s.layers);
  const [visible, setVisible] = useState(true);

  // Collect all active rules from visible layers with rules enabled
  const activeRules = layers
    .filter((l) => l.visible && l.rulesEnabled)
    .flatMap((l) => l.rules.filter((r) => r.enabled).map((r) => ({ ...r, layerName: l.name })));

  if (activeRules.length === 0) return null;

  return (
    <div className="legend-overlay">
      <button
        className="legend-toggle"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Hide legend" : "Show legend"}
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {visible && (
        <div className="legend-card">
          <div className="legend-title">Rules</div>
          {activeRules.map((rule) => (
            <div key={rule.id} className="legend-item">
              <div className="legend-dot" style={{ background: rule.color }} />
              <span>{rule.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
