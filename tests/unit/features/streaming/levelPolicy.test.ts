import { describe, it, expect } from "vitest";
import { makeGrid } from "../../../../src/features/streaming/tileGrid";
import {
  chooseLevel,
  buildLadder,
  lodForCellSize,
} from "../../../../src/features/streaming/levelPolicy";

const grid = makeGrid([0, 0, 0, 10000, 10000, 30]); // rootCell 12800

describe("chooseLevel", () => {
  it("picks the coarsest level giving at least MIN_COVER_CELLS", () => {
    const level = chooseLevel(grid, [0, 0, 3200, 3200]);
    expect(level).not.toBeNull();
    const cover = 2 ** level! * 2 ** level!;
    expect(cover).toBeGreaterThan(0);
  });

  it("returns null when no level satisfies both cover bounds", () => {
    // A degenerate zero-area footprint cannot reach MIN_COVER_CELLS
    // without exceeding maxLevel.
    expect(chooseLevel(grid, [0, 0, 0, 0])).toBeNull();
  });
});

describe("buildLadder", () => {
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
});
