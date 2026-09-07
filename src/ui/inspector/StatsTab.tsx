/**
 * Model and object statistics.
 *
 * UNMOUNTED since 12.3: its host (`InspectorPanel`) was deleted when the
 * details panel replaced it. Kept, with its test, because 12.4 folds this
 * content into the drawer's Summary view — that is where these model/object
 * aggregates come back. Do not delete without first building that view.
 *
 * Shows model-level aggregate stats when nothing is selected, and per-object
 * stats when a building is selected. The DuckDB section summarises the
 * DISPLAYED LAYER'S OWN table — the one `layerTables` built for it — grouped
 * by `object_type`. There is no global `city_objects` table any more, so
 * nothing DuckDB-ish renders until that layer's entry in `useLayerTableStore`
 * reaches `ready`.
 */

import { useEffect, useMemo, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import type { Selection } from "../../domain/selection/types";
import {
  computeModelStats,
  computeObjectStats,
} from "../../insights/computeStats";
import { runQuery } from "../../insights/duckdb";
import { useLayerTableStore } from "../../insights/layerTables";
import { quoteIdent } from "../../insights/sql";

interface StatsTabProps {
  readonly model: CityModel;
  readonly selection: Selection | null;
  /** Whose DuckDB table to summarise — the layer the inspector is showing,
   *  which follows the SELECTION when there is one. `null` while no layer has
   *  a table, in which case the pure model statistics stand alone. */
  readonly layerId: string | null;
}

interface DuckDBStats {
  /** `null` when the table's COUNT could not be taken — see
   *  `LayerTable.rowCount`. Rendered as "unknown", never as 0. */
  readonly rowCount: number | null;
  readonly typeBreakdown: ReadonlyArray<{ type: string; count: number }>;
}

export function StatsTab({ model, selection, layerId }: StatsTabProps) {
  const modelStats = useMemo(() => computeModelStats(model), [model]);

  const objectStats = useMemo(
    () => (selection ? computeObjectStats(model, selection.objectId) : null),
    [model, selection],
  );

  // Subscribed to the entry, not read imperatively: the table is built
  // asynchronously after the layer lands, so the panel has to re-render when
  // it becomes ready.
  const tableState = useLayerTableStore((s) =>
    layerId === null ? undefined : s.tables[layerId],
  );
  const table = tableState?.state === "ready" ? tableState.info : null;

  const [duckdbStats, setDuckdbStats] = useState<DuckDBStats | null>(null);

  useEffect(() => {
    if (table === null) {
      setDuckdbStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // `object_type`, not `type`: that is the column the cityjson reader
      // writes, and the one the flat fallback was aligned to. The old query
      // named `type`, which no layer table has ever had.
      const result = await runQuery(
        `SELECT "object_type", COUNT(*) AS "n" FROM ${quoteIdent(table.table)} GROUP BY 1 ORDER BY 2 DESC`,
      );
      if (cancelled) return;
      setDuckdbStats({
        rowCount: table.rowCount,
        typeBreakdown: result.ok ? extractTypeBreakdown(result.rows) : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [table]);

  return (
    <>
      {/* Per-object stats when selected */}
      {objectStats && (
        <div className="attr-section">
          <div
            className="attr-section-title"
            style={{ color: "var(--accent-text)" }}
          >
            Selected: {objectStats.objectType}
          </div>
          {objectStats.height !== null && (
            <StatRow
              label="Height"
              value={`${objectStats.height.toFixed(1)} m`}
            />
          )}
          <StatRow label="Surfaces" value={String(objectStats.surfaceCount)} />
          <StatRow
            label="Roof surfaces"
            value={String(objectStats.roofSurfaceCount)}
          />
          <StatRow
            label="Roof area"
            value={`${objectStats.totalRoofArea.toFixed(1)} m\u00B2`}
          />
          <StatRow
            label="Avg slope"
            value={`${objectStats.avgRoofSlope.toFixed(1)}\u00B0`}
          />
          {objectStats.avgRoofAzimuth > 0 && (
            <StatRow
              label="Avg azimuth"
              value={`${cardinalFromDeg(objectStats.avgRoofAzimuth)} (${objectStats.avgRoofAzimuth.toFixed(0)}\u00B0)`}
            />
          )}
        </div>
      )}

      {/* Model-level aggregate stats */}
      <div className="attr-section">
        <div className="attr-section-title">
          {objectStats ? "Model Summary" : "Statistics"}
        </div>
        <StatRow label="Buildings" value={String(modelStats.buildingCount)} />
        <StatRow
          label="Total surfaces"
          value={String(modelStats.surfaceCount)}
        />
        <StatRow
          label="Roof surfaces"
          value={String(modelStats.roofSurfaceCount)}
        />
        <StatRow
          label="Total roof area"
          value={`${modelStats.totalRoofArea.toFixed(1)} m\u00B2`}
        />
      </div>

      <div className="attr-section">
        <div className="attr-section-title">Heights</div>
        <StatRow
          label="Average"
          value={`${modelStats.avgBuildingHeight.toFixed(1)} m`}
        />
        <StatRow
          label="Min"
          value={`${modelStats.minBuildingHeight.toFixed(1)} m`}
        />
        <StatRow
          label="Max"
          value={`${modelStats.maxBuildingHeight.toFixed(1)} m`}
        />
      </div>

      <div className="attr-section">
        <div className="attr-section-title">Roof Slope</div>
        <StatRow
          label="Average"
          value={`${modelStats.avgRoofSlope.toFixed(1)}\u00B0`}
        />
      </div>

      <div className="attr-section">
        <div className="attr-section-title">Roof Orientation</div>
        {modelStats.roofsByOrientation.map((o) => (
          <StatRow key={o.band} label={o.band} value={String(o.count)} />
        ))}
      </div>

      {/* DuckDB SQL analytics */}
      {duckdbStats && (
        <div className="attr-section">
          <div className="attr-section-title" style={{ color: "var(--teal)" }}>
            DuckDB Analytics
          </div>
          <StatRow
            label="Rows loaded"
            // "unknown", not "0" and not "null": a count nobody could take and
            // a table with nothing in it are different facts, and only one of
            // them is worth acting on.
            value={
              duckdbStats.rowCount === null
                ? "unknown"
                : String(duckdbStats.rowCount)
            }
          />
          {duckdbStats.typeBreakdown.map((t) => (
            <StatRow key={t.type} label={t.type} value={String(t.count)} />
          ))}
        </div>
      )}
    </>
  );
}

function StatRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="attr-row">
      <span className="attr-key">{label}</span>
      <span className="attr-value">{value}</span>
    </div>
  );
}

function extractTypeBreakdown(
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<{ type: string; count: number }> {
  return rows.map((row) => ({
    type:
      typeof row.object_type === "string"
        ? row.object_type
        : JSON.stringify(row.object_type ?? "unknown"),
    count: typeof row.n === "number" ? row.n : Number(row.n) || 0,
  }));
}

function cardinalFromDeg(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return "N";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "E";
  if (deg < 157.5) return "SE";
  if (deg < 202.5) return "S";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "W";
  return "NW";
}
