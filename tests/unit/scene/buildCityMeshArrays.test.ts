import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { BufferAttribute, BufferGeometry } from "three";
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
  Vec3,
} from "../../../src/domain/citymodel/types";

const fixture = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.json",
);
const model = parseCityJSON(
  JSON.parse(fs.readFileSync(fixture, "utf-8")) as CityJSONRoot,
);
const origin = computeOriginOffset(model);

// ---------------------------------------------------------------------------
// Wrapper-wiring tests.
//
// `buildCityMesh` is a thin wrapper that calls `buildCityMeshArrays`
// internally with the same arguments it was given. So comparing
// `buildCityMeshArrays`'s direct output against `buildCityMesh`'s geometry
// attributes does NOT verify that the underlying math (triangulation,
// coloring, normals, LoD filtering) is correct — a bug there would appear
// identically on both sides of the comparison and these assertions would
// still pass (verified empirically, see buildCityMesh.ts fix-round-1 report
// notes). What these tests DO verify, and the reason they're kept: that the
// wrapper forwards each array to the *correct* geometry attribute, in the
// correct shape, with no swaps/typos/omissions — a real risk introduced by
// this exact refactor (turning buildCityMesh into a wrapper).
// ---------------------------------------------------------------------------

describe("buildCityMeshArrays -> buildCityMesh wrapper wiring", () => {
  it("wrapper forwards the core's positions into the position attribute unchanged", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const pos = mesh.geometry.getAttribute("position").array as Float32Array;
    expect(arrays.positions.length).toBe(pos.length);
    for (let i = 0; i < pos.length; i++) {
      expect(arrays.positions[i]).toBeCloseTo(pos[i]!, 5);
    }
  });

  it("wrapper forwards the core's object/surface indices into their attributes unchanged", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const obj = mesh.geometry.getAttribute("objectIndex").array;
    const surf = mesh.geometry.getAttribute("surfaceIndex").array;
    expect([...arrays.objectIndices]).toEqual([...obj]);
    expect([...arrays.surfaceIndices]).toEqual([...surf]);
  });

  it("wrapper forwards the core's normals into the normal attribute unchanged", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const n = mesh.geometry.getAttribute("normal").array as Float32Array;
    expect(arrays.normals.length).toBe(n.length);
    for (let i = 0; i < n.length; i++) {
      expect(arrays.normals[i]).toBeCloseTo(n[i]!, 4);
    }
  });

  it("wrapper forwards the core's triangleCount and objectKeys unchanged", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
    expect(arrays.objectKeys).toEqual(mesh.pickingIndex.objectKeys);
  });

  it("wrapper forwards LoD-filtered triangleCount consistently with the core", () => {
    const lod = model.objects[Object.keys(model.objects)[0]!]!.surfaces[0]?.lod;
    // Fail loudly rather than silently asserting nothing if the fixture
    // ever changes to have a null LoD.
    expect(
      lod,
      "fixture surface must have a non-null lod for this test",
    ).not.toBeNull();
    const arrays = buildCityMeshArrays(model, "L", origin, lod!);
    const mesh = buildCityMesh(model, "L", origin, lod!);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
  });
});

// ---------------------------------------------------------------------------
// Independent-oracle tests.
//
// These use hand-computed expected values or the REAL Three.js
// `computeVertexNormals()` — never a second call to `buildCityMesh` — so
// they can actually fail if buildCityMeshArrays's own math is wrong.
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

/**
 * Asserts that every emitted vertex in `positions` matches exactly one
 * vertex in `expected` (order-independent, since the triangulator may
 * relabel/rotate which ring vertex becomes v0/v1/v2), and that every
 * expected vertex is matched exactly once (catches missing/extra vertices
 * too).
 */
function expectVertexSet(
  positions: Float32Array,
  expected: ReadonlyArray<Vec3>,
) {
  const vertexCount = positions.length / 3;
  expect(vertexCount, "emitted vertex count").toBe(expected.length);
  const remaining: number[][] = expected.map((v) => [...v]);
  for (let i = 0; i < vertexCount; i++) {
    const ax = positions[i * 3]!;
    const ay = positions[i * 3 + 1]!;
    const az = positions[i * 3 + 2]!;
    const idx = remaining.findIndex(
      ([ex, ey, ez]) =>
        Math.abs(ex! - ax) < 1e-3 &&
        Math.abs(ey! - ay) < 1e-3 &&
        Math.abs(ez! - az) < 1e-3,
    );
    expect(
      idx,
      `emitted vertex ${i} = (${ax}, ${ay}, ${az}) matched no expected vertex`,
    ).not.toBe(-1);
    remaining.splice(idx, 1);
  }
  expect(remaining, "all expected vertices should be consumed").toEqual([]);
}

describe("buildCityMeshArrays positions (independent oracle)", () => {
  it("emits every vertex at its hand-computed origin-relative coordinates", () => {
    const surface = makeSurface("RoofSurface", [
      [100, 200, 5],
      [110, 205, 5],
      [102, 212, 9],
    ]);
    const model = makeModel({ b1: makeObject("b1", [surface]) });
    const origin: Vec3 = [50, 60, 1];
    const arrays = buildCityMeshArrays(model, "L", origin, null);

    expect(arrays.triangleCount).toBe(1);
    expectVertexSet(arrays.positions, [
      [100 - 50, 200 - 60, 5 - 1],
      [110 - 50, 205 - 60, 5 - 1],
      [102 - 50, 212 - 60, 9 - 1],
    ]);
  });
});

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

  // Genuine oracle: builds a real BufferGeometry from the ACTUAL emitted
  // (already Float32-rounded) positions and calls the REAL
  // BufferGeometry.computeVertexNormals() — unlike the wrapper-wiring test
  // above (named "...unchanged"), this never goes through buildCityMesh, so
  // it independently verifies the array core's own normal math, including
  // against Three.js's real implementation rather than a hand-derivation.
  it("matches the real BufferGeometry.computeVertexNormals() on the fixture model", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);

    const oracleGeometry = new BufferGeometry();
    oracleGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(arrays.positions), 3),
    );
    oracleGeometry.computeVertexNormals();
    const oracleNormals = oracleGeometry.getAttribute("normal")
      .array as Float32Array;

    expect(arrays.normals.length).toBe(oracleNormals.length);
    for (let i = 0; i < oracleNormals.length; i++) {
      expect(arrays.normals[i]).toBeCloseTo(oracleNormals[i]!, 5);
    }
  });

  // Float32-collapse case: a triangle whose DOUBLE-PRECISION area is
  // non-zero, but whose FLOAT32-STORED positions collapse two vertices onto
  // the identical representable value, zeroing the area. Near 2^23, Float32
  // has exhausted its 23 mantissa bits, so the gap between representable
  // values (the ULP) is exactly 1.0 — a 0.4-unit offset on X rounds away
  // completely. The real computeVertexNormals() reads the (already
  // Float32-rounded) position ATTRIBUTE, so it must see this collapse and
  // produce the zero vector, not the double-precision-derived unit normal.
  it("matches computeVertexNormals() when Float32 rounding collapses a non-degenerate triangle", () => {
    const BASE = 8388608; // 2^23: Float32 ULP here is 1.0
    const surface = makeSurface("RoofSurface", [
      [BASE, 0, 0],
      [BASE + 0.4, 0, 0], // rounds to BASE once stored as Float32
      [BASE, 100, 0],
    ]);
    const collapseModel = makeModel({ b1: makeObject("b1", [surface]) });
    const arrays = buildCityMeshArrays(collapseModel, "L", [0, 0, 0], null);
    expect(arrays.triangleCount).toBe(1);

    const oracleGeometry = new BufferGeometry();
    oracleGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(arrays.positions), 3),
    );
    oracleGeometry.computeVertexNormals();
    const oracleNormals = oracleGeometry.getAttribute("normal")
      .array as Float32Array;

    for (let i = 0; i < 9; i++) {
      expect(arrays.normals[i]).toBeCloseTo(oracleNormals[i]!, 6);
    }
    // Explicitly: this must be the degenerate (zero) normal — not the
    // double-precision-derived ~(0,0,1) unit normal a naive
    // double-precision computation would produce.
    for (let i = 0; i < 9; i++) {
      expect(arrays.normals[i]).toBeCloseTo(0, 6);
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
