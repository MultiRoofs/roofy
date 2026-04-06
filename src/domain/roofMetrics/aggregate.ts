/**
 * Aggregation functions for roof metrics across multiple surfaces.
 */

import type { RoofMetrics } from "./types";

/** Inclination threshold below which a surface is considered flat (degrees). */
const FLAT_THRESHOLD_DEG = 1;

/** Compute the area-weighted circular mean of azimuth angles.
 *  Flat surfaces (inclination < 1°) are excluded since their azimuth is undefined. */
export function computeAverageAzimuth(metrics: ReadonlyArray<RoofMetrics>): number {
  if (metrics.length === 0) return 0;

  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;

  for (const m of metrics) {
    if (m.inclinationDeg < FLAT_THRESHOLD_DEG) continue;
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
      ? metrics.reduce((sum, m) => sum + m.inclinationDeg * m.areaSqM, 0) / totalArea
      : 0;
  const avgAzimuth = computeAverageAzimuth(metrics);

  return { totalArea, avgInclination, avgAzimuth, count: metrics.length };
}
