import { describe, it, expect } from "vitest";
import { computeSolarScore } from "../../../../src/domain/geometry/derived";

// ---------------------------------------------------------------------------
// computeSolarScore
//
// Both arguments are in CityJSON/ENU Z-up space (x=east, y=north, z=up) since
// Task C15 — there is no Y-up scene space left to convert from.
// ---------------------------------------------------------------------------

describe("computeSolarScore", () => {
  it("scores a flat roof under an overhead sun as 1 with an ENU direction (no Y-up conversion left)", () => {
    expect(computeSolarScore([0, 0, 1], [0, 0, 1])).toBeCloseTo(1, 9);
  });

  it("scores a south-facing roof against a southern sun above 0", () => {
    expect(computeSolarScore([0, -1, 0], [0, -0.7071, 0.7071])).toBeCloseTo(
      0.7071,
      4,
    );
  });

  it("clamps a back-facing surface to 0", () => {
    expect(computeSolarScore([0, 0, 1], [0, 0, -1])).toBe(0);
  });

  it("scores a grazing sun on a flat roof near 0", () => {
    expect(computeSolarScore([0, 0, 1], [1, 0, 0])).toBeCloseTo(0, 9);
  });
});
