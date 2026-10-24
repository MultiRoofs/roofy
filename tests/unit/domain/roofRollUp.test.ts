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
  azimuthDeg: number | null,
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
    // The surface AT the threshold is not merely excluded from the flat area:
    // being non-flat makes it a CANDIDATE for the dominant azimuth, which is
    // the other half of the strict comparison and the half a flat-area
    // assertion cannot see.
    expect(out.azimuthDeg).toBe(90);
  });

  it("leaves a horizontal roof non-flat at threshold 0, azimuth and all", () => {
    // The slider's bottom stop. "Slope under 0 degrees" is satisfied by
    // nothing, so a perfectly horizontal roof is NOT flat there: the flat area
    // is 0, the share is 0, and — the part the flat area does not show — that
    // roof is the largest non-flat surface, so ITS azimuth is the dominant one.
    // A non-strict `<=` would read 0 as "exactly horizontal counts", flip the
    // flat area to the whole roof and leave the feature with no azimuth at all.
    const out = rollUpRoofSurfaces([s(12, 0, 135), s(4, 0, 315)], 0)!;
    expect(out.flatM2).toBe(0);
    expect(out.flatShare).toBe(0);
    expect(out.azimuthDeg).toBe(135);
    // And the default threshold puts the same roof entirely in the flat area,
    // with no dominant surface to take an azimuth from.
    const atFive = rollUpRoofSurfaces([s(12, 0, 135), s(4, 0, 315)], 5)!;
    expect(atFive.flatM2).toBe(16);
    expect(atFive.azimuthDeg).toBeNull();
  });

  it("passes a surface's absent azimuth through as the dominant one", () => {
    // At threshold 0 a horizontal roof is the largest NON-flat surface, so it
    // supplies the dominant azimuth — and since the geographic-to-ENU milestone
    // a horizontal surface HAS no azimuth. The column is nullable for exactly
    // this: `roof_azimuth_deg` reads NULL rather than 0 (due north).
    const out = rollUpRoofSurfaces([s(12, 0, null), s(4, 0, null)], 0)!;
    expect(out.flatM2).toBe(0);
    expect(out.azimuthDeg).toBeNull();
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
