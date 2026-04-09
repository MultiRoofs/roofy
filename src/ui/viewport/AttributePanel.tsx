/**
 * Floating, collapsible attribute panel overlaying the viewport.
 *
 * Shows attribute key-value pairs for the selected object(s).
 * For multi-select: numeric attributes show statistics, non-numeric show "mixed".
 */

import { useState } from "react";
import type { CityObject } from "../../domain/citymodel/types";

type AggMode = "sum" | "avg" | "min" | "max";

interface AttributePanelProps {
  readonly objects: ReadonlyArray<CityObject>;
}

export function AttributePanel({ objects }: AttributePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [aggMode, setAggMode] = useState<AggMode>("avg");

  if (objects.length === 0) return null;

  const isMulti = objects.length > 1;

  return (
    <div className={`attribute-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="attribute-panel-header">
        <span className="attribute-panel-title">
          Attributes{isMulti ? ` (${objects.length})` : ""}
        </span>
        <button
          className="attribute-panel-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            {collapsed ? (
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            ) : (
              <path
                d="M4 10l4-4 4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            )}
          </svg>
        </button>
      </div>
      {!collapsed && (
        <div className="attribute-panel-body">
          {isMulti && (
            <div className="agg-mode-select agg-mode-compact">
              <select
                value={aggMode}
                onChange={(e) => setAggMode(e.target.value as AggMode)}
              >
                <option value="sum">Sum</option>
                <option value="avg">Avg</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
            </div>
          )}
          {isMulti ? (
            <MultiAttributes objects={objects} aggMode={aggMode} />
          ) : (
            <SingleAttributes object={objects[0]!} />
          )}
        </div>
      )}
    </div>
  );
}

function SingleAttributes({ object }: { object: CityObject }) {
  const entries = Object.entries(object.attributes);
  if (entries.length === 0) {
    return <div className="attr-panel-empty">No attributes</div>;
  }
  return (
    <div className="attr-panel-list">
      {entries.map(([key, value]) => (
        <div key={key} className="attr-row">
          <span className="attr-key">{key}</span>
          <span className="attr-value" title={formatValue(value)}>
            {formatValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MultiAttributes({
  objects,
  aggMode,
}: {
  objects: ReadonlyArray<CityObject>;
  aggMode: AggMode;
}) {
  // Collect all attribute keys across all objects
  const allKeys = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj.attributes)) {
      allKeys.add(key);
    }
  }

  if (allKeys.size === 0) {
    return <div className="attr-panel-empty">No attributes</div>;
  }

  const rows = [...allKeys].map((key) => {
    const values = objects.map((obj) => obj.attributes[key]);
    const numericValues = values.filter(
      (v): v is number => typeof v === "number",
    );

    let displayValue: string;
    if (
      numericValues.length === values.filter((v) => v !== undefined).length &&
      numericValues.length > 0
    ) {
      // All defined values are numeric — aggregate
      displayValue = formatAggregate(numericValues, aggMode);
    } else if (numericValues.length > 0) {
      // Mixed types
      displayValue = "mixed";
    } else {
      // All non-numeric
      const uniqueStrings = new Set(
        values.filter((v) => v !== undefined).map((v) => formatValue(v)),
      );
      displayValue =
        uniqueStrings.size === 1 ? [...uniqueStrings][0]! : "mixed";
    }

    return { key, value: displayValue };
  });

  return (
    <div className="attr-panel-list">
      {rows.map(({ key, value }) => (
        <div key={key} className="attr-row">
          <span className="attr-key">{key}</span>
          <span
            className={`attr-value ${value === "mixed" ? "attr-mixed" : ""}`}
            title={value}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatAggregate(values: number[], mode: AggMode): string {
  if (values.length === 0) return "\u2014";
  let result: number;
  switch (mode) {
    case "sum":
      result = values.reduce((a, b) => a + b, 0);
      break;
    case "avg":
      result = values.reduce((a, b) => a + b, 0) / values.length;
      break;
    case "min":
      result = Math.min(...values);
      break;
    case "max":
      result = Math.max(...values);
      break;
  }
  return Number.isInteger(result) ? String(result) : result.toFixed(2);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}
