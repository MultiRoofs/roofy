import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../src/domain/citymodel/cityjson/parseCityJSON";
import {
  buildCityMesh,
  buildCityMeshArrays,
  computeOriginOffset,
} from "../../../src/scene/buildCityMesh";
import type {
  CityModel,
  CityObject,
  Surface,
} from "../../../src/domain/citymodel/types";

const fixture = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.json",
);
const model = parseCityJSON(
  JSON.parse(fs.readFileSync(fixture, "utf-8")) as CityJSONRoot,
);
const origin = computeOriginOffset(model);

describe("buildCityMeshArrays parity with buildCityMesh", () => {
  it("produces identical positions", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const pos = mesh.geometry.getAttribute("position").array as Float32Array;
    expect(arrays.positions.length).toBe(pos.length);
    for (let i = 0; i < pos.length; i++) {
      expect(arrays.positions[i]).toBeCloseTo(pos[i]!, 5);
    }
  });

  it("produces identical object and surface indices", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const obj = mesh.geometry.getAttribute("objectIndex").array;
    const surf = mesh.geometry.getAttribute("surfaceIndex").array;
    expect([...arrays.objectIndices]).toEqual([...obj]);
    expect([...arrays.surfaceIndices]).toEqual([...surf]);
  });

  it("produces normals matching computeVertexNormals", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const n = mesh.geometry.getAttribute("normal").array as Float32Array;
    expect(arrays.normals.length).toBe(n.length);
    for (let i = 0; i < n.length; i++) {
      expect(arrays.normals[i]).toBeCloseTo(n[i]!, 4);
    }
  });

  it("agrees on triangle count and object keys", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
    expect(arrays.objectKeys).toEqual(mesh.pickingIndex.objectKeys);
  });

  it("filters by LoD identically", () => {
    const lod =
      model.objects[Object.keys(model.objects)[0]!]!.surfaces[0]?.lod ?? null;
    if (lod === null) return;
    const arrays = buildCityMeshArrays(model, "L", origin, lod);
    const mesh = buildCityMesh(model, "L", origin, lod);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
  });
});

// ---------------------------------------------------------------------------
// Independent-oracle tests.
//
// The parity tests above compare buildCityMeshArrays's output directly
// against buildCityMesh's geometry attributes. Since buildCityMesh is now a
// thin wrapper that calls buildCityMeshArrays internally with the same
// arguments, that comparison can only catch bugs in how the wrapper wires
// arrays onto BufferGeometry attributes (a real risk for this task) — it
// cannot catch a bug in buildCityMeshArrays's own math, because such a bug
// would appear identically on both sides of the comparison and the parity
// assertion would still pass.
//
// The tests below use hand-computed expected values instead of a second
// call to buildCityMesh, so they can actually fail if the underlying
// computation (face normals, LoD filtering) is wrong.
// ---------------------------------------------------------------------------

function makeSurface(
  type: Surface["type"],
  ring: Surface["rings"][0],
  lod: string | null = "2",
): Surface {
  return { type, rings: [ring], attributes: {}, lod };
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

describe("buildCityMeshArrays face normals (independent oracle)", () => {
  it("computes the hand-derived normal for a flat triangle in the XY plane", () => {
    // Triangle (0,0,0) -> (1,0,0) -> (0,1,0). Using the standard
    // right-hand-rule cross product of two edges from vertex 0:
    // edge1 x edge2 = (1,0,0) x (0,1,0) = (0,0,1).
    // This identity (cross of edges from any one vertex of a planar
    // triangle) is independent of which vertex the triangulator later
    // labels v0/v1/v2, so it is a valid oracle regardless of internal
    // triangulation/index order.
    const surface = makeSurface("RoofSurface", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const arrays = buildCityMeshArrays(model, "L", [0, 0, 0], null);

    expect(arrays.triangleCount).toBe(1);
    for (let v = 0; v < 3; v++) {
      const base = v * 3;
      expect(arrays.normals[base]).toBeCloseTo(0, 5);
      expect(arrays.normals[base + 1]).toBeCloseTo(0, 5);
      expect(arrays.normals[base + 2]).toBeCloseTo(1, 5);
    }
  });

  it("produces a unit-length normal", () => {
    const surface = makeSurface("WallSurface", [
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 4],
      [0, 0, 4],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const arrays = buildCityMeshArrays(model, "L", [0, 0, 0], null);

    for (let v = 0; v < arrays.normals.length / 3; v++) {
      const base = v * 3;
      const length = Math.hypot(
        arrays.normals[base]!,
        arrays.normals[base + 1]!,
        arrays.normals[base + 2]!,
      );
      expect(length).toBeCloseTo(1, 5);
    }
  });
});

describe("buildCityMeshArrays LoD filtering (independent oracle)", () => {
  const triLod1 = makeSurface(
    "RoofSurface",
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    "1",
  );
  const quadLod2 = makeSurface(
    "WallSurface",
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    "2",
  );
  const mixedModel = makeModel({
    b1: makeObject("b1", [triLod1, quadLod2]),
  });

  it("counts only lod-1 triangles when filtered to lod 1", () => {
    const arrays = buildCityMeshArrays(mixedModel, "L", [0, 0, 0], "1");
    expect(arrays.triangleCount).toBe(1);
  });

  it("counts only lod-2 triangles when filtered to lod 2", () => {
    const arrays = buildCityMeshArrays(mixedModel, "L", [0, 0, 0], "2");
    expect(arrays.triangleCount).toBe(2);
  });

  it("counts all triangles when no lod filter is applied", () => {
    const arrays = buildCityMeshArrays(mixedModel, "L", [0, 0, 0], null);
    expect(arrays.triangleCount).toBe(3);
  });
});
