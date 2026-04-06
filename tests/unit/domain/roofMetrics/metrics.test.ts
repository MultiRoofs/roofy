import { describe, it, expect } from "vitest";
import {
  computeArea,
  computeInclination,
  computeAzimuth,
  computeRoofMetrics,
} from "../../../../src/domain/roofMetrics/metrics";
import type { Vec3 } from "../../../../src/domain/citymodel/types";
import type { Surface } from "../../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// Known geometry fixtures (CityJSON coords: X=easting, Y=northing, Z=height)
// ---------------------------------------------------------------------------

/** Flat 1×1 square at ground level. Area = 1.0, inclination = 0°. */
const FLAT_SQUARE: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
];

/** Right triangle with base=3, height=4. Area = 6.0. */
const RIGHT_TRIANGLE: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [3, 0, 0],
  [0, 4, 0],
];

/**
 * South-facing vertical wall (normal points in -Y direction).
 * Inclination = 90°, azimuth = 180° (south).
 */
const SOUTH_WALL: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
];

/**
 * East-facing vertical wall (normal points in +X direction).
 * Inclination = 90°, azimuth = 90° (east).
 */
const EAST_WALL: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [0, 1, 0],
  [0, 1, 1],
  [0, 0, 1],
];

/**
 * 45° south-facing slope.
 * Normal has equal Z and -Y components → inclination = 45°, azimuth = 180°.
 */
const SOUTH_45_SLOPE: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 1],
  [0, 1, 1],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeArea", () => {
  it("returns 1.0 for a unit square", () => {
    expect(computeArea(FLAT_SQUARE)).toBeCloseTo(1.0, 5);
  });

  it("returns 6.0 for a 3×4 right triangle", () => {
    expect(computeArea(RIGHT_TRIANGLE)).toBeCloseTo(6.0, 5);
  });

  it("returns 0 for degenerate ring with < 3 vertices", () => {
    expect(computeArea([[0, 0, 0], [1, 0, 0]])).toBe(0);
  });

  it("returns 0 for empty ring", () => {
    expect(computeArea([])).toBe(0);
  });
});

describe("computeInclination", () => {
  it("returns 0° for a flat horizontal surface", () => {
    expect(computeInclination(FLAT_SQUARE)).toBeCloseTo(0, 1);
  });

  it("returns 90° for a vertical wall", () => {
    expect(computeInclination(SOUTH_WALL)).toBeCloseTo(90, 1);
  });

  it("returns 45° for a 45-degree slope", () => {
    expect(computeInclination(SOUTH_45_SLOPE)).toBeCloseTo(45, 1);
  });

  it("returns 0 for degenerate ring", () => {
    expect(computeInclination([[0, 0, 0], [1, 0, 0]])).toBe(0);
  });
});

describe("computeAzimuth", () => {
  it("returns 180° for a south-facing surface", () => {
    expect(computeAzimuth(SOUTH_WALL)).toBeCloseTo(180, 1);
  });

  it("returns 90° for an east-facing surface", () => {
    expect(computeAzimuth(EAST_WALL)).toBeCloseTo(90, 1);
  });

  it("returns 0° for a flat surface (no horizontal component)", () => {
    // Flat surface has a vertical normal → no meaningful azimuth → 0 by convention
    expect(computeAzimuth(FLAT_SQUARE)).toBe(0);
  });

  it("returns 180° for a south-facing 45° slope", () => {
    expect(computeAzimuth(SOUTH_45_SLOPE)).toBeCloseTo(180, 1);
  });
});

describe("computeRoofMetrics", () => {
  it("returns all metrics for a RoofSurface", () => {
    const surface: Surface = {
      type: "RoofSurface",
      rings: [FLAT_SQUARE],
      attributes: {},
    };
    const metrics = computeRoofMetrics(surface);

    expect(metrics.areaSqM).toBeCloseTo(1.0, 5);
    expect(metrics.inclinationDeg).toBeCloseTo(0, 1);
    expect(metrics.azimuthDeg).toBe(0);
  });

  it("handles surface with no exterior ring", () => {
    const surface: Surface = {
      type: "RoofSurface",
      rings: [],
      attributes: {},
    };
    const metrics = computeRoofMetrics(surface);

    expect(metrics.areaSqM).toBe(0);
    expect(metrics.inclinationDeg).toBe(0);
    expect(metrics.azimuthDeg).toBe(0);
  });
});
