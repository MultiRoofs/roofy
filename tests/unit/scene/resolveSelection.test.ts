import { describe, it, expect } from "vite-plus/test";
import { BufferAttribute, BufferGeometry } from "three";
import { resolveSelection } from "../../../src/scene/usePickingControls";
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

describe("resolveSelection", () => {
  const pickingIndex: PickingIndex = { objectKeys: ["b1", "b2"] };

  it("returns object selection in object mode", () => {
    const geometry = makeGeometryWithIndices(
      [0, 0, 0, 1, 1, 1],
      [0, 0, 0, 0, 0, 0],
    );

    const result = resolveSelection(3, geometry, pickingIndex, "object");

    expect(result).toEqual({ kind: "object", objectId: "b2" });
  });

  it("returns surface selection in surface mode", () => {
    const geometry = makeGeometryWithIndices(
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 2, 2],
    );

    const result = resolveSelection(3, geometry, pickingIndex, "surface");

    expect(result).toEqual({
      kind: "surface",
      objectId: "b1",
      surfaceIndex: 2,
    });
  });

  it("returns null when object index is out of range", () => {
    const geometry = makeGeometryWithIndices([99, 99, 99], [0, 0, 0]);

    const result = resolveSelection(0, geometry, pickingIndex, "object");

    expect(result).toBeNull();
  });

  it("returns null when geometry lacks index attributes", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(9), 3),
    );

    const result = resolveSelection(0, geometry, pickingIndex, "object");

    expect(result).toBeNull();
  });
});
