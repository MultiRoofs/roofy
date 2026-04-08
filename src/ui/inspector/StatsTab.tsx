/**
 * Statistics tab in the inspector panel.
 *
 * Shows model-level aggregate stats when nothing is selected,
 * and per-object stats when a building is selected.
 * Optionally shows DuckDB SQL-derived analytics when available.
 */

import { useEffect, useMemo, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import type { Selection } from "../../domain/selection/types";
import {
  computeModelStats,
  computeObjectStats,
} from "../../analytics/computeStats";
import { queryDuckDB } from "../../analytics/duckdb";
import type { QueryResult } from "../../analytics/duckdb";

interface StatsTabProps {
  readonly model: CityModel;
  readonly selection: Selection | null;
  readonly duckdbModelLoaded?: boolean;
}

interface DuckDBStats {
  readonly rowCount: number;
  readonly typeBreakdown: ReadonlyArray<{ type: string; count: number }>;
}

export function StatsTab({
  model,
  selection,
  duckdbModelLoaded,
}: StatsTabProps) {
  const modelStats = useMemo(() => computeModelStats(model), [model]);

  const objectStats = useMemo(
    () => (selection ? computeObjectStats(model, selection.objectId) : null),
    [model, selection],
  );

  const [duckdbStats, setDuckdbStats] = useState<DuckDBStats | null>(null);

  useEffect(() => {
    if (!duckdbModelLoaded) {
      setDuckdbStats(null);
      return;
    }

    let cancelled = false;

    async function fetchStats() {
      const [countResult, typeResult] = await Promise.all([
        queryDuckDB("SELECT COUNT(*) AS cnt FROM city_objects"),
        queryDuckDB(
          "SELECT type, COUNT(*) AS cnt FROM city_objects GROUP BY type ORDER BY cnt DESC",
        ),
      ]);

      if (cancelled) return;

      const rowCount = extractCount(countResult);
      const typeBreakdown = extractTypeBreakdown(typeResult);
      setDuckdbStats({ rowCount, typeBreakdown });
    }

    void fetchStats();
    return () => {
      cancelled = true;
    };
  }, [duckdbModelLoaded]);

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
          <StatRow label="Rows loaded" value={String(duckdbStats.rowCount)} />
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

function extractCount(result: QueryResult | null): number {
  if (!result || result.rows.length === 0) return 0;
  const val = result.rows[0]!.cnt;
  return typeof val === "number" ? val : Number(val) || 0;
}

function extractTypeBreakdown(
  result: QueryResult | null,
): Array<{ type: string; count: number }> {
  if (!result) return [];
  return result.rows.map((row) => ({
    type:
      typeof row.type === "string"
        ? row.type
        : JSON.stringify(row.type ?? "unknown"),
    count: typeof row.cnt === "number" ? row.cnt : Number(row.cnt) || 0,
  }));
}
