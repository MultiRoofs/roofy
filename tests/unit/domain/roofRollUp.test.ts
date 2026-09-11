/**
 * Spec §7's roll-ups, for ONE set of roof surfaces (a contributor set, or one
 * part's own surfaces). Pure, so every rule is asserted here rather than
 * through a run.
 */
import { describe, expect, it } from "vitest";
import {
  rollUpRoofSurfaces,
  type RoofSurfaceMetric,
} from "../../../src/domain/roofMetrics/roofRollUp";

const s = (
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
  lod: string | null = "2.2",
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

describe("rollUpRoofSurfaces", () => {
  it("is null for no surfaces at all — the caller counts that as skipped", () => {
    expect(rollUpRoofSurfaces([], 5)).toBeNull();
  });

  it("sums areas and counts surfaces", () => {
    const out = rollUpRoofSurfaces([s(10, 30, 180), s(6, 0, 0)], 5)!;
    expect(out.areaM2).toBe(16);
    expect(out.surfaces).toBe(2);
  });

  it("counts a surface under the threshold as flat, and one AT it as not", () => {
    const out = rollUpRoofSurfaces([s(10, 4.9, 0), s(6, 5, 90)], 5)!;
    expect(out.flatM2).toBe(10);
    expect(out.flatShare).toBeCloseTo(10 / 16, 10);
  });

  it("weights the mean slope by area, over ALL surfaces", () => {
    // The threshold must not touch this: §7 says "area-weighted over all roof
    // surfaces of the feature".
    const out = rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 5)!;
    expect(out.slopeDeg).toBeCloseTo((30 * 40) / 40, 10);
    expect(
      rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 0)!.slopeDeg,
    ).toBeCloseTo(30, 10);
  });

  it("takes the azimuth of the LARGEST NON-FLAT surface, not a mean", () => {
    const out = rollUpRoofSurfaces(
      [s(5, 35, 10), s(20, 30, 200), s(100, 1, 999)],
      5,
    )!;
    expect(out.azimuthDeg).toBe(200);
  });

  it("breaks an azimuth tie on the first surface in order", () => {
    const out = rollUpRoofSurfaces([s(9, 20, 45), s(9, 20, 315)], 5)!;
    expect(out.azimuthDeg).toBe(45);
  });

  it("has no azimuth when every surface is flat", () => {
    const out = rollUpRoofSurfaces([s(10, 0, 0), s(4, 2, 90)], 5)!;
    expect(out.azimuthDeg).toBeNull();
    expect(out.flatShare).toBe(1);
    // Area-weighted over both: (10 m² × 0°) + (4 m² × 2°) = 8, over 14 m².
    expect(out.slopeDeg).toBeCloseTo(8 / 14, 10);
  });

  it("has no share and no slope when the surfaces are all zero-area", () => {
    // `computeRoofMetrics` returns all-zeros for a degenerate ring, so this is
    // real data, not a hypothetical. A 0/0 would be NaN in the column.
    const out = rollUpRoofSurfaces([s(0, 0, 0), s(0, 0, 0)], 5)!;
    expect(out.areaM2).toBe(0);
    expect(out.flatM2).toBe(0);
    expect(out.flatShare).toBeNull();
    expect(out.slopeDeg).toBeNull();
    expect(out.surfaces).toBe(2);
  });
});
