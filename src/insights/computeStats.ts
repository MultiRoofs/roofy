/**
 * Pure statistics functions computed from a CityModel.
 *
 * No side effects, no stores, no Three.js — fully testable.
 * Uses the existing roofMetrics module for per-surface computations.
 */

import type { CityModel, CityObject } from "../domain/citymodel/types";
import { computeRoofMetrics, type RoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
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

function countByOrientation(metrics: RoofMetrics[]): OrientationCount[] {
  const counts = new Map<string, number>();
  for (const band of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
    counts.set(band, 0);
  }

  for (const m of metrics) {
    // Skip flat roofs — their azimuth is meaningless, and core reports it as
    // null rather than as due north.
    if (m.inclinationDeg < 1 || m.azimuthDeg === null) continue;
    const band = classifyOrientation(m.azimuthDeg);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([band, count]) => ({ band, count }));
}

// ---------------------------------------------------------------------------
// Model-level stats
// ---------------------------------------------------------------------------

/** Normalized per-object input shared by both the `CityObject` (rings,
 *  recomputed roof metrics) and `ResidentObjectRecord` (rings absent,
 *  roof metrics already precomputed by the worker) paths, so the
 *  accumulation math below is written and tested exactly once. */
interface StatsInput {
  readonly surfaceCount: number;
  readonly roofMetrics: ReadonlyArray<RoofMetrics>;
  readonly height: number | null;
}

function heightFromAttributes(
  attributes: Readonly<Record<string, unknown>>,
): number | null {
  const h = attributes.measuredHeight;
  return typeof h === "number" ? h : null;
}

function accumulateModelStats(inputs: ReadonlyArray<StatsInput>): ModelStats {
  let surfaceCount = 0;
  let roofSurfaceCount = 0;
  let totalRoofArea = 0;
  let avgRoofSlope = 0;
  let roofSlopeWeightSum = 0;

  const heights: number[] = [];
  const roofMetricsList: RoofMetrics[] = [];

  for (const input of inputs) {
    if (input.height !== null) heights.push(input.height);
    surfaceCount += input.surfaceCount;

    for (const m of input.roofMetrics) {
      roofSurfaceCount++;
      roofMetricsList.push(m);
      totalRoofArea += m.areaSqM;
      avgRoofSlope += m.inclinationDeg * m.areaSqM;
      roofSlopeWeightSum += m.areaSqM;
    }
  }

  return {
    buildingCount: inputs.length,
    surfaceCount,
    roofSurfaceCount,
    totalRoofArea,
    avgBuildingHeight:
      heights.length > 0
        ? heights.reduce((a, b) => a + b, 0) / heights.length
        : 0,
    minBuildingHeight: heights.length > 0 ? Math.min(...heights) : 0,
    maxBuildingHeight: heights.length > 0 ? Math.max(...heights) : 0,
    avgRoofSlope:
      roofSlopeWeightSum > 0 ? avgRoofSlope / roofSlopeWeightSum : 0,
    roofsByOrientation: countByOrientation(roofMetricsList),
  };
}

export function computeModelStats(model: CityModel): ModelStats {
  const inputs: StatsInput[] = [];
  for (const obj of Object.values(model.objects)) {
    if (!obj) continue;
    const roofMetrics = obj.surfaces
      .filter((s) => s.type === "RoofSurface")
      .map(computeRoofMetrics);
    inputs.push({
      surfaceCount: obj.surfaces.length,
      roofMetrics,
      height: heightFromAttributes(obj.attributes),
    });
  }
  return accumulateModelStats(inputs);
}

/**
 * Streaming counterpart of `computeModelStats`: a `ResidentObjectRecord`
 * carries no ring geometry (see `ResidentObjectRecord` in
 * `@cityjson/navara-flatcitybuf`'s workerProtocol.ts), so roof metrics are
 * read from `r.roofMetrics` (already computed by the worker when the cell was
 * decoded) instead of being recomputed from surfaces, and `r.surfaceCount`
 * stands in for `obj.surfaces.length`.
 */
export function computeModelStatsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): ModelStats {
  const inputs: StatsInput[] = records.map((r) => ({
    surfaceCount: r.surfaceCount,
    roofMetrics: r.roofMetrics,
    height: heightFromAttributes(r.attributes),
  }));
  return accumulateModelStats(inputs);
}

// ---------------------------------------------------------------------------
// Per-object stats
// ---------------------------------------------------------------------------

interface ObjectStatsInput {
  readonly objectId: string;
  readonly objectType: string;
  readonly surfaceCount: number;
  readonly roofMetrics: ReadonlyArray<RoofMetrics>;
  readonly height: number | null;
}

function accumulateObjectStats(input: ObjectStatsInput): ObjectStats {
  let roofSurfaceCount = 0;
  let totalRoofArea = 0;
  let slopeSum = 0;
  let slopeWeight = 0;
  let azimuthSinSum = 0;
  let azimuthCosSum = 0;
  let azimuthWeight = 0;

  for (const m of input.roofMetrics) {
    roofSurfaceCount++;
    totalRoofArea += m.areaSqM;
    slopeSum += m.inclinationDeg * m.areaSqM;
    slopeWeight += m.areaSqM;

    if (m.inclinationDeg >= 1 && m.azimuthDeg !== null) {
      const rad = (m.azimuthDeg * Math.PI) / 180;
      azimuthSinSum += m.areaSqM * Math.sin(rad);
      azimuthCosSum += m.areaSqM * Math.cos(rad);
      azimuthWeight += m.areaSqM;
    }
  }

  // `null`, not 0, for "nothing to average": 0 is due north. See
  // `ObjectStats.avgRoofAzimuth`.
  let avgAzimuth: number | null = null;
  if (azimuthWeight > 0) {
    avgAzimuth = Math.atan2(azimuthSinSum, azimuthCosSum) * (180 / Math.PI);
    if (avgAzimuth < 0) avgAzimuth += 360;
  }

  return {
    objectId: input.objectId,
    objectType: input.objectType,
    surfaceCount: input.surfaceCount,
    roofSurfaceCount,
    totalRoofArea,
    height: input.height,
    avgRoofSlope: slopeWeight > 0 ? slopeSum / slopeWeight : 0,
    avgRoofAzimuth: avgAzimuth,
  };
}

export function computeObjectStats(
  model: CityModel,
  objectId: string,
): ObjectStats | null {
  const obj: CityObject | undefined = model.objects[objectId];
  if (!obj) return null;

  const roofMetrics = obj.surfaces
    .filter((s) => s.type === "RoofSurface")
    .map(computeRoofMetrics);

  return accumulateObjectStats({
    objectId,
    objectType: obj.objectType,
    surfaceCount: obj.surfaces.length,
    roofMetrics,
    height: heightFromAttributes(obj.attributes),
  });
}

/** Streaming counterpart of `computeObjectStats` — takes an already-resolved
 *  `ResidentObjectRecord` directly rather than a model + id, since callers
 *  get records from `getResidentModel(...).objects`, not from a `CityModel`. */
export function computeObjectStatsFromRecord(
  record: ResidentObjectRecord,
): ObjectStats {
  return accumulateObjectStats({
    objectId: record.id,
    objectType: record.objectType,
    surfaceCount: record.surfaceCount,
    roofMetrics: record.roofMetrics,
    height: heightFromAttributes(record.attributes),
  });
}
