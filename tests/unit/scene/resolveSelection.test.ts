import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { resolveSelection } from "../../../src/scene/resolvePicking";
import type { PickingIndex } from "../../../src/scene/buildCityMesh";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGeometryWithIndices(
  objectIndices: number[],
  surfaceIndices: number[],
) {
  const vertexCount = objectIndices.length;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(vertexCount * 3), 3),
  );
  geometry.setAttribute(
    "objectIndex",
    new BufferAttribute(new Int32Array(objectIndices), 1),
  );
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(new Int32Array(surfaceIndices), 1),
  );
  return geometry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// resolveSelection is mode-agnostic: it always resolves the concrete object
// + surface that was hit. Callers decide (based on the active PickMode)
// whether to build an object-level or surface-level Selection from the
// result — see resolveFromEvent in CitySceneR3F.tsx.
describe("resolveSelection", () => {
  const pickingIndex: PickingIndex = {
    layerId: "test-layer",
    objectKeys: ["b1", "b2"],
  };

  it("resolves the object and surface index for the hit vertex", () => {
    const geometry = makeGeometryWithIndices(
      [0, 0, 0, 1, 1, 1],
      [0, 0, 0, 0, 0, 0],
    );

    const result = resolveSelection(geometry, pickingIndex, 3);

    expect(result).toEqual({
      layerId: "test-layer",
      objectId: "b2",
      surfaceIndex: 0,
    });
  });

  it("reports the surface index of the hit triangle", () => {
    const geometry = makeGeometryWithIndices(
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 2, 2],
    );

    const result = resolveSelection(geometry, pickingIndex, 3);

    expect(result).toEqual({
      layerId: "test-layer",
      objectId: "b1",
      surfaceIndex: 2,
    });
  });

  it("returns null when object index is out of range", () => {
    const geometry = makeGeometryWithIndices([99, 99, 99], [0, 0, 0]);

    const result = resolveSelection(geometry, pickingIndex, 0);

    expect(result).toBeNull();
  });

  it("returns null when geometry lacks index attributes", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(9), 3),
    );

    const result = resolveSelection(geometry, pickingIndex, 0);

    expect(result).toBeNull();
  });
});
