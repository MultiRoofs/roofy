import { describe, it, expect } from "vitest";
import { makeGrid } from "../../../../src/features/streaming/tileGrid";
import { bucketFeatures } from "../../../../src/features/streaming/bucketFeatures";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const grid = makeGrid([0, 0, 0, 1000, 1000, 30]); // rootCell 1600, level 2 -> 400 m

function model(id: string, cx: number, cy: number): CityModel {
  return {
    sourceEncoding: "flatcitybuf",
    metadata: {},
    bbox: [cx - 5, cy - 5, 0, cx + 5, cy + 5, 10],
    vertexCount: 8,
    objects: {
      [id]: {
        id,
        objectType: "Building",
        attributes: {},
        surfaces: [],
        bbox: [cx - 5, cy - 5, 0, cx + 5, cy + 5, 10],
        children: [],
        parents: [],
        lod: "2.2",
      },
    },
  };
}

describe("bucketFeatures", () => {
  it("routes each feature to the cell containing its bbox centre", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 500, 100)],
      grid,
      2,
      new Set(),
    );
    expect([...out.keys()].sort()).toEqual(["2/0/0", "2/1/0"]);
    expect(Object.keys(out.get("2/0/0")!.objects)).toEqual(["a"]);
    expect(Object.keys(out.get("2/1/0")!.objects)).toEqual(["b"]);
  });

  it("assigns a straddling feature to exactly one cell", () => {
    // Spans the 400 m boundary but its centre is at 395 -> cell 0 only.
    const out = bucketFeatures([model("s", 395, 100)], grid, 2, new Set());
    expect([...out.keys()]).toEqual(["2/0/0"]);
  });

  it("skips features owned by an already-resident cell", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 500, 100)],
      grid,
      2,
      new Set(["2/0/0"]),
    );
    expect([...out.keys()]).toEqual(["2/1/0"]);
  });

  it("merges multiple features landing in the same cell", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 150, 150)],
      grid,
      2,
      new Set(),
    );
    expect(Object.keys(out.get("2/0/0")!.objects).sort()).toEqual(["a", "b"]);
  });

  it("drops a feature whose bbox is non-finite instead of throwing or misfiling it", () => {
    const bad = model("bad", 100, 100);
    const badObj = bad.objects.bad!;
    const broken = {
      ...bad,
      objects: {
        bad: { ...badObj, bbox: [0, 0, 0, Infinity, 10, 10] as const },
      },
    };
    const out = bucketFeatures(
      [broken, model("ok", 500, 100)],
      grid,
      2,
      new Set(),
    );
    expect([...out.keys()]).toEqual(["2/1/0"]);
    for (const cell of out.values()) {
      expect(Object.keys(cell.objects)).not.toContain("bad");
    }
  });
});
