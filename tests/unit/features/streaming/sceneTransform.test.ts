import { describe, it, expect } from "vitest";
import {
  sourceToScene,
  sceneToSource,
} from "../../../../src/features/streaming/sceneTransform";
import { meshOffset } from "../../../../src/features/streaming/tileGrid";

const ORIGIN = [100, 200, 10] as const;
const ZERO = [0, 0, 0] as const;

describe("sceneTransform", () => {
  it("maps source to world for a static layer (no mesh offset)", () => {
    // world = (X, Z, -Y) where (X,Y,Z) = src - origin
    expect(sourceToScene([105, 210, 13], ORIGIN, ZERO)).toEqual([5, 3, -10]);
  });

  it("round-trips with a non-zero offset on all three axes", () => {
    const cellCentre = [110, 220, 10] as const;
    const off = meshOffset(cellCentre, ORIGIN);
    const src = [113, 217, 14] as const;
    const world = sourceToScene(src, ORIGIN, off);
    expect(sceneToSource(world, ORIGIN, off)).toEqual([113, 217, 14]);
  });

  it("REGRESSION: a cell-local vertex plus its offset lands where the static path puts it", () => {
    // The bug this test exists for: using the raw delta instead of the
    // rotated one. Raw would give [10,20,0]; correct is [10,0,-20].
    const cellCentre = [110, 220, 10] as const;
    const off = meshOffset(cellCentre, ORIGIN);
    expect(off).toEqual([10, 0, -20]);

    const src = [113, 217, 14] as const;
    const viaStatic = sourceToScene(src, ORIGIN, ZERO);
    const viaCell = sourceToScene(src, cellCentre, off);
    expect(viaCell[0]).toBeCloseTo(viaStatic[0], 9);
    expect(viaCell[1]).toBeCloseTo(viaStatic[1], 9);
    expect(viaCell[2]).toBeCloseTo(viaStatic[2], 9);
  });
});
