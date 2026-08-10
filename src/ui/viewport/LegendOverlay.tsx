/**
 * Legend overlay displayed on the viewport when rules are active.
 *
 * Shows the active rules across all visible layers with their color
 * swatches and names, GROUPED BY LAYER: rules are per-layer state, so a flat
 * list is ambiguous as soon as a second layer is loaded — two layers can
 * carry rules of the same name in different colours, and nothing told the
 * reader which swatch belonged to which layer. The heading renders in the
 * single-layer case too, so the legend doesn't change shape underneath the
 * user when the second layer arrives.
 */

import { useState } from "react";
import { useLayerStore } from "../../features/layers/layerStore";

export function LegendOverlay() {
  const layers = useLayerStore((s) => s.layers);
  const [visible, setVisible] = useState(true);

  // Active rules from visible, rule-enabled layers, kept in per-layer groups.
  // Layers that contribute no active rule are dropped, so an empty group
  // never renders a bare heading.
  const groups = layers
    .filter((l) => l.visible && l.rulesEnabled)
    .map((l) => ({
      layerId: l.id,
      layerName: l.name,
      rules: l.rules.filter((r) => r.enabled),
    }))
    .filter((g) => g.rules.length > 0);

  if (groups.length === 0) return null;

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
          {groups.map((group) => (
            <div
              key={group.layerId}
              className="legend-group"
              role="group"
              aria-label={group.layerName}
            >
              <div className="legend-group-name">{group.layerName}</div>
              {group.rules.map((rule) => (
                // Rule ids are only unique WITHIN a layer, so the key carries
                // the layer id too.
                <div
                  key={`${group.layerId}:${rule.id}`}
                  className="legend-item"
                >
                  <div
                    className="legend-dot"
                    style={{ background: rule.color }}
                  />
                  <span>{rule.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
