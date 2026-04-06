/**
 * Legend overlay displayed on the viewport when rules are active.
 *
 * Shows the active rules with their color swatches and names.
 * Can be toggled on/off by the user.
 */

import { useState } from "react";
import { useRuleStore } from "../../features/rules/ruleStore";

export function LegendOverlay() {
  const rules = useRuleStore((s) => s.rules);
  const enabled = useRuleStore((s) => s.enabled);
  const [visible, setVisible] = useState(true);

  const activeRules = rules.filter((r) => r.enabled);

  if (!enabled || activeRules.length === 0) return null;

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
              <div
                className="legend-dot"
                style={{ background: rule.color }}
              />
              <span>{rule.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
