/**
 * Aggregation functions for roof metrics across multiple surfaces.
 */

import type { RoofMetrics } from "@cityjson/navara-core";

/** Inclination threshold below which THE APP considers a surface flat
 *  (degrees). Looser than core's own `FLAT_INCLINATION_DEG`, deliberately: core
 *  withholds an azimuth only where the bearing would be the frame's tilt, while
 *  this is a presentation gate on what counts as sloped at all.
 *
 *  Exported, and imported rather than respelled, because every caller that has
 *  to tell "no aspect" from "due north" — `computeAverageAzimuth` answers 0 for
 *  both — must mirror the SAME gate. */
export const FLAT_THRESHOLD_DEG = 1;

/** Compute the area-weighted circular mean of azimuth angles.
 *  Flat surfaces (inclination < 1°, or with a null azimuth) are excluded since
 *  their azimuth is undefined. Returns 0 when nothing is left to average — the
 *  caller has to distinguish that from a real northerly mean itself. */
export function computeAverageAzimuth(
  metrics: ReadonlyArray<RoofMetrics>,
): number {
  if (metrics.length === 0) return 0;

  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;

  for (const m of metrics) {
    if (m.inclinationDeg < FLAT_THRESHOLD_DEG) continue;
    // A surface with no aspect at all (core answers null below its own
    // `FLAT_INCLINATION_DEG`)
    // never contributes: read as 0 it would drag the mean due north.
    if (m.azimuthDeg === null) continue;
    const rad = (m.azimuthDeg * Math.PI) / 180;
    const w = m.areaSqM;
    sinSum += w * Math.sin(rad);
    cosSum += w * Math.cos(rad);
    totalWeight += w;
  }

  if (totalWeight === 0) return 0;

  let avg = Math.atan2(sinSum, cosSum) * (180 / Math.PI);
  if (avg < 0) avg += 360;
  return avg;
}

/** Compute aggregate metrics for a set of roof surfaces.
 *  Averages are weighted by surface area so large planes dominate over small facets. */
export function aggregateRoofMetrics(metrics: ReadonlyArray<RoofMetrics>): {
  totalArea: number;
  avgInclination: number;
  avgAzimuth: number;
  count: number;
} {
  if (metrics.length === 0) {
    return { totalArea: 0, avgInclination: 0, avgAzimuth: 0, count: 0 };
  }

  const totalArea = metrics.reduce((sum, m) => sum + m.areaSqM, 0);
  const avgInclination =
    totalArea > 0
      ? metrics.reduce((sum, m) => sum + m.inclinationDeg * m.areaSqM, 0) /
        totalArea
      : 0;
  const avgAzimuth = computeAverageAzimuth(metrics);

  return { totalArea, avgInclination, avgAzimuth, count: metrics.length };
}
