/**
 * Pure statistics functions computed from a CityModel.
 *
 * No side effects, no stores, no Three.js — fully testable.
 * Uses the existing roofMetrics module for per-surface computations.
 */

import type { CityModel, CityObject } from "../domain/citymodel/types";
import { computeRoofMetrics } from "../domain/roofMetrics/metrics";
import type { RoofMetrics } from "../domain/roofMetrics/types";
import type { ModelStats, ObjectStats, OrientationCount } from "./types";

// ---------------------------------------------------------------------------
// Orientation bands
// ---------------------------------------------------------------------------

const ORIENTATION_BANDS = [
  { band: "N", min: 337.5, max: 360 },
  { band: "N", min: 0, max: 22.5 },
  { band: "NE", min: 22.5, max: 67.5 },
  { band: "E", min: 67.5, max: 112.5 },
  { band: "SE", min: 112.5, max: 157.5 },
  { band: "S", min: 157.5, max: 202.5 },
  { band: "SW", min: 202.5, max: 247.5 },
  { band: "W", min: 247.5, max: 292.5 },
  { band: "NW", min: 292.5, max: 337.5 },
] as const;

function classifyOrientation(azimuthDeg: number): string {
  for (const { band, min, max } of ORIENTATION_BANDS) {
    if (azimuthDeg >= min && azimuthDeg < max) return band;
  }
  return "N"; // fallback for exactly 360
}

function countByOrientation(
  metrics: RoofMetrics[],
): OrientationCount[] {
  const counts = new Map<string, number>();
  for (const band of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
    counts.set(band, 0);
  }

  for (const m of metrics) {
    // Skip flat roofs — their azimuth is meaningless
    if (m.inclinationDeg < 1) continue;
    const band = classifyOrientation(m.azimuthDeg);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([band, count]) => ({ band, count }));
}

// ---------------------------------------------------------------------------
// Model-level stats
// ---------------------------------------------------------------------------

export function computeModelStats(model: CityModel): ModelStats {
  const objects = Object.values(model.objects);

  let surfaceCount = 0;
  let roofSurfaceCount = 0;
  let totalRoofArea = 0;
  let avgRoofSlope = 0;
  let roofSlopeWeightSum = 0;

  const heights: number[] = [];
  const roofMetricsList: RoofMetrics[] = [];

  for (const obj of objects) {
    if (!obj) continue;

    const h = obj.attributes.measuredHeight;
    if (typeof h === "number") heights.push(h);

    for (const surface of obj.surfaces) {
      surfaceCount++;
      if (surface.type === "RoofSurface") {
        roofSurfaceCount++;
        const m = computeRoofMetrics(surface);
        roofMetricsList.push(m);
        totalRoofArea += m.areaSqM;
        avgRoofSlope += m.inclinationDeg * m.areaSqM;
        roofSlopeWeightSum += m.areaSqM;
      }
    }
  }

  return {
    buildingCount: objects.length,
    surfaceCount,
    roofSurfaceCount,
    totalRoofArea,
    avgBuildingHeight: heights.length > 0 ? heights.reduce((a, b) => a + b, 0) / heights.length : 0,
    minBuildingHeight: heights.length > 0 ? Math.min(...heights) : 0,
    maxBuildingHeight: heights.length > 0 ? Math.max(...heights) : 0,
    avgRoofSlope: roofSlopeWeightSum > 0 ? avgRoofSlope / roofSlopeWeightSum : 0,
    roofsByOrientation: countByOrientation(roofMetricsList),
  };
}

// ---------------------------------------------------------------------------
// Per-object stats
// ---------------------------------------------------------------------------

export function computeObjectStats(model: CityModel, objectId: string): ObjectStats | null {
  const obj: CityObject | undefined = model.objects[objectId];
  if (!obj) return null;

  let roofSurfaceCount = 0;
  let totalRoofArea = 0;
  let slopeSum = 0;
  let slopeWeight = 0;
  let azimuthSinSum = 0;
  let azimuthCosSum = 0;
  let azimuthWeight = 0;

  for (const surface of obj.surfaces) {
    if (surface.type === "RoofSurface") {
      roofSurfaceCount++;
      const m = computeRoofMetrics(surface);
      totalRoofArea += m.areaSqM;
      slopeSum += m.inclinationDeg * m.areaSqM;
      slopeWeight += m.areaSqM;

      if (m.inclinationDeg >= 1) {
        const rad = (m.azimuthDeg * Math.PI) / 180;
        azimuthSinSum += m.areaSqM * Math.sin(rad);
        azimuthCosSum += m.areaSqM * Math.cos(rad);
        azimuthWeight += m.areaSqM;
      }
    }
  }

  let avgAzimuth = 0;
  if (azimuthWeight > 0) {
    avgAzimuth = Math.atan2(azimuthSinSum, azimuthCosSum) * (180 / Math.PI);
    if (avgAzimuth < 0) avgAzimuth += 360;
  }

  const h = obj.attributes.measuredHeight;

  return {
    objectId,
    objectType: obj.objectType,
    surfaceCount: obj.surfaces.length,
    roofSurfaceCount,
    totalRoofArea,
    height: typeof h === "number" ? h : null,
    avgRoofSlope: slopeWeight > 0 ? slopeSum / slopeWeight : 0,
    avgRoofAzimuth: avgAzimuth,
  };
}
