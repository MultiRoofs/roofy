import { describe, it, expect } from "vitest";
import {
  makeGrid,
  cellSize,
  cellBBox,
  keysCovering,
  ownerKey,
} from "../../../../src/features/streaming/tileGrid";

// 1000 m x 1000 m extent starting at (0,0) -> ROOT_CELL rounds to 1024
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

  it("assigns the outer maximum to the final row/column", () => {
    const k = ownerKey(grid, [1600, 1600, 0, 1600, 1600, 1], 2); // centre at max
    expect(k).toBe("2/3/3");
  });

  it("returns null for a non-finite bbox", () => {
    expect(ownerKey(grid, [NaN, 0, 0, 1, 1, 1], 2)).toBeNull();
  });
});
