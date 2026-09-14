import { describe, expect, it } from "vitest";
import { derivedBuildingValues } from "../../../../src/ui/drawer/derivedBuildingColumns";

describe("derivedBuildingValues", () => {
  it("aggregates nested static parts once", () => {
    const roof = {
      type: "RoofSurface",
      rings: [
        [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 10],
        ],
      ],
      attributes: {},
      lod: null,
    } as const;
    const objects = {
      root: {
        id: "root",
        objectType: "Building",
        children: ["part"],
        surfaces: [],
      },
      part: {
        id: "part",
        objectType: "BuildingPart",
        children: ["root"],
        surfaces: [roof],
      },
    } as never;
    const values = derivedBuildingValues("root", objects);
    expect(values.parts).toBe(1);
    expect(values.roofArea).toBeGreaterThan(0);
    expect(values.meanSlope).toBeGreaterThan(0);
  });

  it("marks a missing resident part unavailable", () => {
    const objects = {
      root: {
        id: "root",
        objectType: "Building",
        children: ["gone"],
        roofMetrics: [],
      },
    } as never;
    expect(derivedBuildingValues("root", objects)).toEqual({
      roofArea: null,
      meanSlope: null,
      parts: null,
    });
  });
});
