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
