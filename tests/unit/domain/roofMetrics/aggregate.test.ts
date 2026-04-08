import { describe, it, expect } from "vite-plus/test";
import {
  computeAverageAzimuth,
  aggregateRoofMetrics,
} from "../../../../src/domain/roofMetrics/aggregate";
import type { RoofMetrics } from "../../../../src/domain/roofMetrics/types";

// ---------------------------------------------------------------------------
// computeAverageAzimuth
// ---------------------------------------------------------------------------

describe("computeAverageAzimuth", () => {
  it("returns 0 for empty array", () => {
    expect(computeAverageAzimuth([])).toBe(0);
  });

  it("returns the single azimuth for one surface", () => {
    const metrics: RoofMetrics[] = [
      { areaSqM: 50, inclinationDeg: 30, azimuthDeg: 180, elevationM: 0 },
    ];
    expect(computeAverageAzimuth(metrics)).toBeCloseTo(180, 1);
  });

  it("computes circular mean correctly across north wrap", () => {
    // 350° and 10° should average to 0° (north), which may be represented as 360°
    const metrics: RoofMetrics[] = [
      { areaSqM: 50, inclinationDeg: 30, azimuthDeg: 350, elevationM: 0 },
      { areaSqM: 50, inclinationDeg: 30, azimuthDeg: 10, elevationM: 0 },
    ];
    const avg = computeAverageAzimuth(metrics);
    // 0° and 360° are equivalent
    expect(avg % 360).toBeCloseTo(0, 0);
  });

  it("excludes flat surfaces (inclinationDeg < 1) from the azimuth average", () => {
    // Flat roof has azimuthDeg=0 by convention — must not pull average north
    const metrics: RoofMetrics[] = [
      { areaSqM: 100, inclinationDeg: 0, azimuthDeg: 0, elevationM: 0 }, // flat — should be excluded
      { areaSqM: 50, inclinationDeg: 30, azimuthDeg: 180, elevationM: 0 }, // south-facing
    ];
    expect(computeAverageAzimuth(metrics)).toBeCloseTo(180, 1);
  });

  it("returns 0 when all surfaces are flat", () => {
    const metrics: RoofMetrics[] = [
      { areaSqM: 100, inclinationDeg: 0, azimuthDeg: 0, elevationM: 0 },
      { areaSqM: 50, inclinationDeg: 0.5, azimuthDeg: 0, elevationM: 0 },
    ];
    expect(computeAverageAzimuth(metrics)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateRoofMetrics
// ---------------------------------------------------------------------------

describe("aggregateRoofMetrics", () => {
  it("returns zeros for empty array", () => {
    const agg = aggregateRoofMetrics([]);
    expect(agg).toEqual({
      totalArea: 0,
      avgInclination: 0,
      avgAzimuth: 0,
      count: 0,
    });
  });

  it("computes area-weighted average inclination", () => {
    // Large roof (100 m²) at 10°, small dormer (10 m²) at 50°
    // Weighted avg = (100*10 + 10*50) / 110 = 1500/110 ≈ 13.6°
    const metrics: RoofMetrics[] = [
      { areaSqM: 100, inclinationDeg: 10, azimuthDeg: 180, elevationM: 0 },
      { areaSqM: 10, inclinationDeg: 50, azimuthDeg: 180, elevationM: 0 },
    ];
    const agg = aggregateRoofMetrics(metrics);
    expect(agg.avgInclination).toBeCloseTo(13.636, 1);
  });

  it("computes area-weighted average azimuth", () => {
    // Large south roof (100 m²) vs small east roof (10 m²)
    // Should be dominated by south
    const metrics: RoofMetrics[] = [
      { areaSqM: 100, inclinationDeg: 30, azimuthDeg: 180, elevationM: 0 },
      { areaSqM: 10, inclinationDeg: 30, azimuthDeg: 90, elevationM: 0 },
    ];
    const agg = aggregateRoofMetrics(metrics);
    // Should be much closer to 180 than to 135
    expect(agg.avgAzimuth).toBeGreaterThan(160);
    expect(agg.avgAzimuth).toBeLessThan(185);
  });

  it("sums total area", () => {
    const metrics: RoofMetrics[] = [
      { areaSqM: 30, inclinationDeg: 10, azimuthDeg: 180, elevationM: 0 },
      { areaSqM: 70, inclinationDeg: 20, azimuthDeg: 90, elevationM: 0 },
    ];
    const agg = aggregateRoofMetrics(metrics);
    expect(agg.totalArea).toBeCloseTo(100, 5);
    expect(agg.count).toBe(2);
  });
});
