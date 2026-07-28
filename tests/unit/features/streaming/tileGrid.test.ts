import { describe, it, expect } from "vitest";
import {
  makeGrid,
  cellSize,
  cellBBox,
  cellCentre,
  keysCovering,
  ownerKey,
} from "../../../../src/features/streaming/tileGrid";

// 1000 m x 1000 m extent starting at (0,0) -> ROOT_CELL rounds to 1600
const grid = makeGrid([0, 0, 0, 1000, 1000, 30]);

describe("tileGrid", () => {
  it("rounds the root cell to a power-of-two multiple of 100 m", () => {
    expect(grid.rootCell).toBe(1600); // 100 * 2^4 = 1600 >= 1000
    expect(cellSize(grid, 0)).toBe(1600);
    expect(cellSize(grid, 2)).toBe(400);
  });

  it("round-trips a key to its bbox", () => {
    expect(cellBBox(grid, "2/1/0")).toEqual([400, 0, 800, 400]);
  });

  it("covers a bbox with every intersecting cell", () => {
    const keys = keysCovering(grid, [350, 50, 450, 150], 2);
    expect(keys.sort()).toEqual(["2/0/0", "2/1/0"]);
  });

  it("assigns a centre exactly on a boundary to exactly one cell", () => {
    // centre x = 400 is the shared edge of cell 0 and cell 1 at level 2
    const k = ownerKey(grid, [390, 90, 0, 410, 110, 5], 2); // centre (400,100)
    expect(k).toBe("2/1/0"); // half-open: [400,800) wins
  });

  it("assigns the declared extent maximum to its legitimate cell", () => {
    // The declared extent max (1000, 1000) at level 2 belongs to cell 2/2/2,
    // not the padded grid's final index (2/3/3).
    const k = ownerKey(grid, [900, 900, 0, 1000, 1000, 1], 2); // centre (950, 950)
    expect(k).toBe("2/2/2");
  });

  it("clamps points outside the declared extent into the final cell", () => {
    // A point far outside the extent (5000, 5000) should clamp to 2/3/3
    const k = ownerKey(grid, [5000, 5000, 0, 5000, 5000, 1], 2);
    expect(k).toBe("2/3/3");
  });

  it("ensures boundary point consistency: keysCovering and ownerKey must agree", () => {
    // For a boundary point, keysCovering must include the cell returned by ownerKey
    const boundingBox: [number, number, number, number] = [390, 90, 410, 110];
    const key = ownerKey(grid, [390, 90, 0, 410, 110, 5], 2);
    const covered = keysCovering(grid, boundingBox, 2);
    expect(key).not.toBeNull();
    expect(covered).toContain(key);
  });

  it("handles negative coordinates correctly", () => {
    // Create a grid with negative origin to test negative coordinates
    const negGrid = makeGrid([-1000, -1000, 0, 0, 0, 30]);
    // At level 2, cellSize = 1600 / 4 = 400
    // Point at (-800, -800) should be in cell 2/0/0
    const k = ownerKey(negGrid, [-900, -900, 0, -700, -700, 5], 2);
    expect(k).toBe("2/0/0");
  });

  it("handles zero-span/degenerate extent without infinite looping", () => {
    // A degenerate extent where min equals max should produce a valid grid
    const degen = makeGrid([100, 100, 0, 100, 100, 30]);
    expect(degen.rootCell).toBe(100); // BASE_CELL_M since 0 < 100
    expect(degen.maxLevel).toBeGreaterThanOrEqual(0);
  });

  it("returns null for non-finite bbox components (including Y and Z)", () => {
    // Non-finite in X
    expect(ownerKey(grid, [NaN, 0, 0, 1, 1, 1], 2)).toBeNull();
    // Non-finite in Y
    expect(ownerKey(grid, [0, NaN, 0, 1, 1, 1], 2)).toBeNull();
    // Non-finite in Z (any component of bbox should disqualify)
    expect(ownerKey(grid, [0, 0, NaN, 1, 1, 1], 2)).toBeNull();
    // Infinity in X
    expect(ownerKey(grid, [Infinity, 0, 0, 1, 1, 1], 2)).toBeNull();
    // Infinity in Y
    expect(ownerKey(grid, [0, Infinity, 0, 1, 1, 1], 2)).toBeNull();
  });

  it("computes cell centre correctly", () => {
    const centre = cellCentre(grid, "2/1/0", 50);
    expect(centre).toEqual([600, 200, 50]); // cell 2/1/0 is [400,0,800,400], centre is (600, 200)
  });

  it("computes maxLevel based on minimum cell size", () => {
    // At grid's maxLevel, cellSize should be >= MIN_CELL_M (50)
    // At maxLevel + 1, cellSize would be < MIN_CELL_M
    const size = cellSize(grid, grid.maxLevel);
    const nextSize = grid.rootCell / 2 ** (grid.maxLevel + 1);
    expect(size).toBeGreaterThanOrEqual(50);
    expect(nextSize).toBeLessThan(50);
  });
});
