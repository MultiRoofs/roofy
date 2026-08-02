import { describe, expect, it } from "vitest";
import { buildCityMesh } from "../../../src/scene/buildCityMesh";
import type {
  CityModel,
  CityObject,
  Surface,
} from "../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSurface(
  type: Surface["type"],
  ring: Surface["rings"][0],
): Surface {
  return { type, rings: [ring], attributes: {}, lod: "2" };
}

function makeObject(
  id: string,
  surfaces: Surface[],
  bbox: CityObject["bbox"] = null,
): CityObject {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces,
    bbox,
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

describe("buildCityMesh", () => {
  it("returns zero triangles for an empty model", () => {
    const model = makeModel({});
    const result = buildCityMesh(model, "test-layer");

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
    const result = buildCityMesh(model, "test-layer");

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
    const result = buildCityMesh(model, "test-layer");

    expect(result.triangleCount).toBe(2);
  });

  it("applies origin offset to positions", () => {
    const surface = makeSurface("RoofSurface", [
      [100, 200, 0],
      [110, 200, 0],
      [100, 210, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const result = buildCityMesh(model, "test-layer", [105, 205, 0]);

    const posAttr = result.geometry.getAttribute("position");
    const vertices = Array.from(
      { length: posAttr.count },
      (_, i) => [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)] as const,
    );

    expect(
      vertices.some(
        ([x, y, z]) =>
          Math.abs(x + 5) < 1e-6 &&
          Math.abs(y + 5) < 1e-6 &&
          Math.abs(z) < 1e-6,
      ),
    ).toBe(true);
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
    const result = buildCityMesh(model, "test-layer");

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
    const result = buildCityMesh(model, "test-layer");

    expect(result.triangleCount).toBe(0);
  });

  it("triangulates holes instead of filling them in", () => {
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
      lod: "2",
    };
    const model = makeModel({
      b1: makeObject("b1", [surfaceWithHole]),
    });
    const result = buildCityMesh(model, "test-layer");

    // 4 contour vertices + 3 hole vertices + 2 * 1 hole - 2 = 7 triangles
    expect(result.triangleCount).toBe(7);
  });

  it("reverses inward-wound rings when object bbox is available", () => {
    const reversedTopFace = makeSurface("RoofSurface", [
      [0, 0, 10],
      [0, 10, 10],
      [10, 10, 10],
      [10, 0, 10],
    ]);
    const model = makeModel({
      b1: makeObject("b1", [reversedTopFace], [0, 0, 0, 10, 10, 10]),
    });
    const result = buildCityMesh(model, "test-layer");
    const posAttr = result.geometry.getAttribute("position");

    const ax = posAttr.getX(0);
    const ay = posAttr.getY(0);
    const az = posAttr.getZ(0);
    const bx = posAttr.getX(1);
    const by = posAttr.getY(1);
    const bz = posAttr.getZ(1);
    const cx = posAttr.getX(2);
    const cy = posAttr.getY(2);
    const cz = posAttr.getZ(2);

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const normalZ = abx * acy - aby * acx;

    expect(abz).toBeCloseTo(0);
    expect(acz).toBeCloseTo(0);
    expect(normalZ).toBeGreaterThan(0);
  });
});

describe("picking index", () => {
  it("returns objectKeys matching the objects in the model", () => {
    const roof = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({
      b1: makeObject("b1", [roof]),
      b2: makeObject("b2", [roof]),
    });
    const result = buildCityMesh(model, "test-layer");

    expect(result.pickingIndex.objectKeys).toEqual(["b1", "b2"]);
  });

  it("objectIndex attribute has one entry per vertex", () => {
    const roof = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [roof]) });
    const result = buildCityMesh(model, "test-layer");

    const posAttr = result.geometry.getAttribute("position");
    const idxAttr = result.geometry.getAttribute("objectIndex");
    expect(idxAttr.count).toBe(posAttr.count);
  });

  it("assigns correct objectIndex for multiple objects", () => {
    const tri = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({
      b1: makeObject("b1", [tri]),
      b2: makeObject("b2", [tri]),
    });
    const result = buildCityMesh(model, "test-layer");

    const idxAttr = result.geometry.getAttribute("objectIndex");
    // b1's triangle: vertices 0,1,2 → objectIndex 0
    expect(idxAttr.getX(0)).toBe(0);
    expect(idxAttr.getX(1)).toBe(0);
    expect(idxAttr.getX(2)).toBe(0);
    // b2's triangle: vertices 3,4,5 → objectIndex 1
    expect(idxAttr.getX(3)).toBe(1);
    expect(idxAttr.getX(4)).toBe(1);
    expect(idxAttr.getX(5)).toBe(1);
  });

  it("assigns correct surfaceIndex within each object", () => {
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
    const result = buildCityMesh(model, "test-layer");

    const surfAttr = result.geometry.getAttribute("surfaceIndex");
    // roof triangle: vertices 0,1,2 → surfaceIndex 0
    expect(surfAttr.getX(0)).toBe(0);
    // wall triangle: vertices 3,4,5 → surfaceIndex 1
    expect(surfAttr.getX(3)).toBe(1);
  });

  it("returns baseColors as a copy of the vertex color data", () => {
    const roof = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [roof]) });
    const result = buildCityMesh(model, "test-layer");

    expect(result.baseColors).toBeInstanceOf(Float32Array);
    expect(result.baseColors.length).toBeGreaterThan(0);

    const colorAttr = result.geometry.getAttribute("color");
    // Same values but different buffer reference
    expect(result.baseColors[0]).toBe(colorAttr.getX(0));
  });

  it("returns empty pickingIndex for empty model", () => {
    const model = makeModel({});
    const result = buildCityMesh(model, "test-layer");

    expect(result.pickingIndex.objectKeys).toEqual([]);
    expect(result.baseColors.length).toBe(0);
  });
});
