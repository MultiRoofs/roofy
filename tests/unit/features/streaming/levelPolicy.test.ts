import { describe, it, expect } from "vitest";
import {
  makeGrid,
  keysCovering,
} from "../../../../src/features/streaming/tileGrid";
import {
  MIN_COVER_CELLS,
  MAX_COVER_CELLS,
} from "../../../../src/features/streaming/constants";
import {
  chooseLevel,
  buildLadder,
  lodForCellSize,
} from "../../../../src/features/streaming/levelPolicy";

const grid = makeGrid([0, 0, 0, 10000, 10000, 30]); // rootCell 12800

describe("chooseLevel", () => {
  it("picks the coarsest level giving at least MIN_COVER_CELLS (T4-F3)", () => {
    const level = chooseLevel(grid, [0, 0, 3200, 3200]);
    expect(level).not.toBeNull();

    // Verify the cover is within bounds
    const cover = keysCovering(grid, [0, 0, 3200, 3200], level!).length;
    expect(cover).toBeGreaterThanOrEqual(MIN_COVER_CELLS);
    expect(cover).toBeLessThanOrEqual(MAX_COVER_CELLS);

    // Verify it's the coarsest: level-1 should be below MIN_COVER_CELLS
    if (level! > 0) {
      const coarserCover = keysCovering(
        grid,
        [0, 0, 3200, 3200],
        level! - 1,
      ).length;
      expect(coarserCover).toBeLessThan(MIN_COVER_CELLS);
    }
  });

  it("returns null for degenerate zero-area footprints", () => {
    expect(chooseLevel(grid, [0, 0, 0, 0])).toBeNull();
  });

  it("returns null for zero-width lines (T4-F2)", () => {
    expect(chooseLevel(grid, [0, 0, 0, 10000])).toBeNull();
  });

  it("returns null for zero-height lines (T4-F2)", () => {
    expect(chooseLevel(grid, [0, 0, 10000, 0])).toBeNull();
  });
});

describe("buildLadder", () => {
  it("sorts numeric labels numerically and non-numeric lexicographically (T4-F1, T4-F4)", () => {
    // ["10", "2", "1.2", "abc"] should sort numerically as [1.2, 2, 10]
    // then non-numeric "abc" after, not lexicographically as [1.2, 10, 2]
    expect(buildLadder(["10", "2", "1.2", "abc"])).toEqual([
      "1.2",
      "2",
      "10",
      "abc",
    ]);
  });

  it("sorts labels ascending and drops null", () => {
    expect(buildLadder(["2.2", null, "1.2", "1.3"])).toEqual([
      "1.2",
      "1.3",
      "2.2",
    ]);
  });

  it("returns an empty ladder for wholly unlabelled data", () => {
    expect(buildLadder([null, null])).toEqual([]);
  });
});

describe("lodForCellSize", () => {
  const ladder = ["1.2", "1.3", "2.2"];

  it("uses the coarsest LoD for a large cell", () => {
    expect(lodForCellSize(ladder, 4000)).toEqual({ kind: "exact", lod: "1.2" });
  });

  it("uses the finest LoD for a small cell", () => {
    expect(lodForCellSize(ladder, 100)).toEqual({ kind: "exact", lod: "2.2" });
  });

  it("uses the lower-middle rung in the mid band", () => {
    expect(lodForCellSize(ladder, 800)).toEqual({ kind: "exact", lod: "1.3" });
  });

  it("collapses to identity for a single-LoD dataset", () => {
    expect(lodForCellSize(["2.2"], 4000)).toEqual({
      kind: "exact",
      lod: "2.2",
    });
    expect(lodForCellSize(["2.2"], 100)).toEqual({ kind: "exact", lod: "2.2" });
  });

  it("renders everything when the dataset carries no labels", () => {
    expect(lodForCellSize([], 800)).toEqual({ kind: "all" });
  });

  it("for n=2, coarse and mid band map to same LoD (T4-F5)", () => {
    const ladder2 = ["1.0", "2.0"];
    expect(lodForCellSize(ladder2, 4000)).toEqual({
      kind: "exact",
      lod: "1.0",
    });
    expect(lodForCellSize(ladder2, 800)).toEqual({ kind: "exact", lod: "1.0" });
    expect(lodForCellSize(ladder2, 100)).toEqual({ kind: "exact", lod: "2.0" });
  });

  it("for n=4, mid band gets second rung (T4-F5)", () => {
    const ladder4 = ["1.0", "1.5", "2.0", "2.5"];
    expect(lodForCellSize(ladder4, 4000)).toEqual({
      kind: "exact",
      lod: "1.0",
    });
    expect(lodForCellSize(ladder4, 800)).toEqual({ kind: "exact", lod: "1.5" });
    expect(lodForCellSize(ladder4, 100)).toEqual({ kind: "exact", lod: "2.5" });
  });

  it("for n=5, mid band gets middle rung (T4-F5)", () => {
    const ladder5 = ["1.0", "1.5", "2.0", "2.5", "3.0"];
    expect(lodForCellSize(ladder5, 4000)).toEqual({
      kind: "exact",
      lod: "1.0",
    });
    expect(lodForCellSize(ladder5, 800)).toEqual({ kind: "exact", lod: "2.0" });
    expect(lodForCellSize(ladder5, 100)).toEqual({ kind: "exact", lod: "3.0" });
  });
});
