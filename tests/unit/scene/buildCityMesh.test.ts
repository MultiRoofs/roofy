import { describe, expect, it } from "vitest";
import { buildCityMesh, computeOriginOffset } from "../../../src/scene/buildCityMesh";
import type { CityModel, CityObject, Surface } from "../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSurface(
  type: Surface["type"],
  ring: Surface["rings"][0],
): Surface {
  return { type, rings: [ring], attributes: {} };
}

function makeObject(id: string, surfaces: Surface[]): CityObject {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces,
    bbox: null,
    children: [],
    parents: [],
    lod: "2",
  };
}

function makeModel(objects: Record<string, CityObject>): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: [0, 0, 0, 10, 10, 5],
    objects,
    vertexCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeOriginOffset", () => {
  it("returns zero offset when model has no bbox", () => {
    const model: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    };
    expect(computeOriginOffset(model)).toEqual([0, 0, 0]);
  });

  it("returns the center of the bounding box", () => {
    const model: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [100, 200, 0, 110, 210, 10],
      objects: {},
      vertexCount: 0,
    };
    const offset = computeOriginOffset(model);
    expect(offset[0]).toBeCloseTo(105);
    expect(offset[1]).toBeCloseTo(205);
    expect(offset[2]).toBeCloseTo(5);
  });
});

describe("buildCityMesh", () => {
  it("returns zero triangles for an empty model", () => {
    const model = makeModel({});
    const result = buildCityMesh(model);

    expect(result.triangleCount).toBe(0);
    expect(result.geometry.getAttribute("position")).toBeDefined();
  });

  it("produces correct triangle count for a triangle surface", () => {
    // A single triangle = 1 triangle
    const surface = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const result = buildCityMesh(model);

    expect(result.triangleCount).toBe(1);
  });

  it("produces correct triangle count for a quad surface", () => {
    // A quad = 2 triangles via fan triangulation
    const surface = makeSurface("WallSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const result = buildCityMesh(model);

    expect(result.triangleCount).toBe(2);
  });

  it("applies origin offset to positions", () => {
    const surface = makeSurface("RoofSurface", [
      [100, 200, 0],
      [110, 200, 0],
      [100, 210, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const result = buildCityMesh(model, [105, 205, 0]);

    const posAttr = result.geometry.getAttribute("position");
    // First vertex: (100-105, 200-205, 0-0) = (-5, -5, 0)
    expect(posAttr.getX(0)).toBeCloseTo(-5);
    expect(posAttr.getY(0)).toBeCloseTo(-5);
    expect(posAttr.getZ(0)).toBeCloseTo(0);
  });

  it("assigns different colors for different surface types", () => {
    const roof = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const wall = makeSurface("WallSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]);
    const model = makeModel({
      b1: makeObject("b1", [roof, wall]),
    });
    const result = buildCityMesh(model);

    const colorAttr = result.geometry.getAttribute("color");
    // RoofSurface (0xcc4444) and WallSurface (0xcccccc) differ in green channel
    expect(colorAttr.getY(0)).not.toBeCloseTo(colorAttr.getY(3), 1);
  });

  it("skips surfaces with less than 3 vertices", () => {
    const degenerate = makeSurface("WallSurface", [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [degenerate]) });
    const result = buildCityMesh(model);

    expect(result.triangleCount).toBe(0);
  });

  it("only triangulates exterior ring, ignoring holes", () => {
    // Surface with exterior quad + interior triangle (hole)
    const surfaceWithHole: Surface = {
      type: "RoofSurface",
      rings: [
        // Exterior ring (quad = 2 triangles)
        [
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
          [0, 10, 0],
        ],
        // Interior ring (hole — should be ignored)
        [
          [2, 2, 0],
          [8, 2, 0],
          [5, 8, 0],
        ],
      ],
      attributes: {},
    };
    const model = makeModel({
      b1: makeObject("b1", [surfaceWithHole]),
    });
    const result = buildCityMesh(model);

    // Only the exterior quad should be triangulated: 2 triangles
    expect(result.triangleCount).toBe(2);
  });
});
