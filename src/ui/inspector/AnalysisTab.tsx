/**
 * Analysis tab showing computed roof metrics.
 *
 * Users can toggle between surface-level view (individual surface metrics)
 * and building-aggregate view (averages across all roof surfaces).
 */

import { useState } from "react";
import type { CityObject, Surface } from "../../domain/citymodel/types";
import { computeRoofMetrics } from "../../domain/roofMetrics/metrics";
import { aggregateRoofMetrics } from "../../domain/roofMetrics/aggregate";

interface AnalysisTabProps {
  readonly object: CityObject;
  readonly selectedSurfaceIndex: number | null;
}

type Scope = "building" | "surface";

export function AnalysisTab({
  object,
  selectedSurfaceIndex,
}: AnalysisTabProps) {
  const [scope, setScope] = useState<Scope>("building");

  const roofSurfaces = object.surfaces
    .map((s, i) => ({ surface: s, index: i }))
    .filter((s) => s.surface.type === "RoofSurface");

  if (roofSurfaces.length === 0) {
    return (
      <div className="inspector-placeholder">
        No roof surfaces found on this object
      </div>
    );
  }

  return (
    <>
      <div className="attr-section">
        <div className="analysis-scope-toggle">
          <button
            className={`scope-btn ${scope === "building" ? "active" : ""}`}
            onClick={() => setScope("building")}
          >
            Building
          </button>
          <button
            className={`scope-btn ${scope === "surface" ? "active" : ""}`}
            onClick={() => setScope("surface")}
          >
            Surface
          </button>
        </div>
      </div>

      {scope === "building" ? (
        <BuildingMetrics roofSurfaces={roofSurfaces.map((r) => r.surface)} />
      ) : (
        <SurfaceMetricsList
          roofSurfaces={roofSurfaces}
          selectedSurfaceIndex={selectedSurfaceIndex}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Building aggregate view
// ---------------------------------------------------------------------------

function BuildingMetrics({ roofSurfaces }: { roofSurfaces: Surface[] }) {
  const metrics = roofSurfaces.map(computeRoofMetrics);
  const agg = aggregateRoofMetrics(metrics);

  return (
    <div className="attr-section">
      <div
        className="attr-section-title"
        style={{ color: "var(--accent-text)" }}
      >
        Roof Analysis
      </div>
      <AttrRow label="Roof surfaces" value={String(agg.count)} />
      <AttrRow
        label="Total roof area"
        value={`${agg.totalArea.toFixed(1)} m\u00B2`}
        highlight
      />
      <AttrRow
        label="Avg inclination"
        value={`${agg.avgInclination.toFixed(1)}\u00B0`}
      />
      <AttrRow label="Avg azimuth" value={formatAzimuth(agg.avgAzimuth)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surface-level list view
// ---------------------------------------------------------------------------

function SurfaceMetricsList({
  roofSurfaces,
  selectedSurfaceIndex,
}: {
  roofSurfaces: { surface: Surface; index: number }[];
  selectedSurfaceIndex: number | null;
}) {
  return (
    <>
      {roofSurfaces.map(({ surface, index }) => {
        const metrics = computeRoofMetrics(surface);
        const isSelected = selectedSurfaceIndex === index;
        return (
          <div
            key={index}
            className={`attr-section ${isSelected ? "section-highlight" : ""}`}
          >
            <div
              className="attr-section-title"
              style={{ color: "var(--accent-text)" }}
            >
              Roof Surface #{index}
            </div>
            <AttrRow
              label="Area"
              value={`${metrics.areaSqM.toFixed(1)} m\u00B2`}
              highlight
            />
            <AttrRow
              label="Inclination"
              value={`${metrics.inclinationDeg.toFixed(1)}\u00B0`}
            />
            <AttrRow
              label="Azimuth"
              value={formatAzimuth(metrics.azimuthDeg)}
            />
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function AttrRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="attr-row">
      <span className="attr-key">{label}</span>
      <span className={`attr-value ${highlight ? "highlight" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function formatAzimuth(deg: number): string {
  const dir = azimuthToCardinal(deg);
  return `${dir} (${deg.toFixed(0)}\u00B0)`;
}

function azimuthToCardinal(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return "N";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "E";
  if (deg < 157.5) return "SE";
  if (deg < 202.5) return "S";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "W";
  return "NW";
}
