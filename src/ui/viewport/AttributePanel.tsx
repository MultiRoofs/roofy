/**
 * Floating, collapsible attribute panel overlaying the viewport.
 *
 * Shows attribute key-value pairs for the selected object(s).
 * For multi-select: numeric attributes show statistics, non-numeric show "mixed".
 */

import { useState } from "react";
import type { CityObject } from "../../domain/citymodel/types";
import { resolveInheritedAttributes } from "../../domain/citymodel/inheritedAttributes";

type AggMode = "sum" | "avg" | "min" | "max";

interface AttributePanelProps {
  readonly objects: ReadonlyArray<CityObject>;
  /**
   * The layer's whole object map, so a selected child can show the attributes
   * it inherits. Picking is geometric and lands on a `BuildingPart`, which in
   * CityJSON carries the geometry and none of the semantics — without this the
   * panel read "No attributes" for every building in the Delft dataset. See
   * `domain/citymodel/inheritedAttributes.ts`.
   */
  readonly objectsById?: Readonly<Record<string, CityObject>>;
}

export function AttributePanel({
  objects,
  objectsById = {},
}: AttributePanelProps) {
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
            <MultiAttributes
              objects={objects}
              objectsById={objectsById}
              aggMode={aggMode}
            />
          ) : (
            <SingleAttributes object={objects[0]!} objectsById={objectsById} />
          )}
        </div>
      )}
    </div>
  );
}

interface AttrTableRow {
  readonly key: string;
  readonly value: string;
  /** Renders muted: the selection disagrees, so no single value is the truth. */
  readonly mixed?: boolean;
}

/**
 * The one table both the single- and multi-select bodies render, so the two
 * cannot drift apart in markup or styling.
 */
function AttributeTable({
  rows,
  valueHeader,
  inheritedFrom = null,
}: {
  rows: ReadonlyArray<AttrTableRow>;
  valueHeader: string;
  inheritedFrom?: string | null;
}) {
  return (
    <table className="attr-table">
      {inheritedFrom !== null && (
        <caption className="attr-table-caption" title={inheritedFrom}>
          Inherited from {inheritedFrom}
        </caption>
      )}
      <thead>
        <tr>
          <th scope="col">Attribute</th>
          <th scope="col" className="attr-table-value-col">
            {valueHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, value, mixed }) => (
          <tr key={key}>
            <th scope="row" title={key}>
              {key}
            </th>
            <td
              className={
                mixed
                  ? "attr-table-value-col attr-table-mixed"
                  : "attr-table-value-col"
              }
              title={value}
            >
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SingleAttributes({
  object,
  objectsById,
}: {
  object: CityObject;
  objectsById: Readonly<Record<string, CityObject>>;
}) {
  const { attributes, inheritedFrom } = resolveInheritedAttributes(
    objectsById,
    object,
  );
  const entries = Object.entries(attributes);
  if (entries.length === 0) {
    return <div className="attr-panel-empty">No attributes</div>;
  }
  return (
    <AttributeTable
      rows={entries.map(([key, value]) => ({
        key,
        value: formatValue(value),
      }))}
      valueHeader="Value"
      inheritedFrom={inheritedFrom}
    />
  );
}

function MultiAttributes({
  objects,
  objectsById,
  aggMode,
}: {
  objects: ReadonlyArray<CityObject>;
  objectsById: Readonly<Record<string, CityObject>>;
  aggMode: AggMode;
}) {
  // Resolved ONCE per object: every read below (key collection and the
  // per-key value lookup) must see the same inherited values, and resolving
  // inside the loops would repeat the ancestor walk per key.
  const resolved = objects.map(
    (obj) => resolveInheritedAttributes(objectsById, obj).attributes,
  );
  const allKeys = new Set<string>();
  for (const attrs of resolved) {
    for (const key of Object.keys(attrs)) {
      allKeys.add(key);
    }
  }

  if (allKeys.size === 0) {
    return <div className="attr-panel-empty">No attributes</div>;
  }

  const rows = [...allKeys].map((key) => {
    const values = resolved.map((attrs) => attrs[key]);
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
    <AttributeTable
      rows={rows.map(({ key, value }) => ({
        key,
        value,
        mixed: value === "mixed",
      }))}
      valueHeader={`Value (${aggMode})`}
    />
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
