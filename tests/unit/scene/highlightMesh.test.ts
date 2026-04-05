import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry, Color } from "three";
import { applyHighlight, clearHighlight } from "../../../src/scene/highlightMesh";
import type { PickingIndex } from "../../../src/scene/buildCityMesh";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal geometry with 2 triangles (6 vertices).
 * Triangle 0 belongs to object 0, surface 0.
 * Triangle 1 belongs to object 1, surface 0.
 */
function makeTwoObjectGeometry() {
  const positions = new Float32Array(18); // 6 vertices × 3
  const colors = new Float32Array([
    1, 0, 0, 1, 0, 0, 1, 0, 0, // tri 0: red
    0, 0, 1, 0, 0, 1, 0, 0, 1, // tri 1: blue
  ]);
  const objectIndices = new Int32Array([0, 0, 0, 1, 1, 1]);
  const surfaceIndices = new Int32Array([0, 0, 0, 0, 0, 0]);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("objectIndex", new BufferAttribute(objectIndices, 1));
  geometry.setAttribute("surfaceIndex", new BufferAttribute(surfaceIndices, 1));

  const baseColors = Float32Array.from(colors);
  const pickingIndex: PickingIndex = { objectKeys: ["b1", "b2"] };

  return { geometry, baseColors, pickingIndex };
}

const HIGHLIGHT = new Color(0xe8973f);
const HOVER = new Color(0xfbbf24);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyHighlight", () => {
  it("highlights the selected object's vertices with amber", () => {
    const { geometry, baseColors, pickingIndex } = makeTwoObjectGeometry();

    applyHighlight(
      geometry,
      baseColors,
      { kind: "object", objectId: "b1" },
      null,
      pickingIndex,
    );

    const colorAttr = geometry.getAttribute("color");
    // Object b1 (vertices 0-2) should be amber highlight
    expect(colorAttr.getX(0)).toBeCloseTo(HIGHLIGHT.r, 2);
    expect(colorAttr.getY(0)).toBeCloseTo(HIGHLIGHT.g, 2);

    // Object b2 (vertices 3-5) should be unchanged (blue)
    expect(colorAttr.getX(3)).toBeCloseTo(0, 1);
    expect(colorAttr.getZ(3)).toBeCloseTo(1, 1);
  });

  it("highlights hovered object with yellow-amber", () => {
    const { geometry, baseColors, pickingIndex } = makeTwoObjectGeometry();

    applyHighlight(
      geometry,
      baseColors,
      null,
      { kind: "object", objectId: "b2" },
      pickingIndex,
    );

    const colorAttr = geometry.getAttribute("color");
    // Object b2 (vertices 3-5) should be hover color
    expect(colorAttr.getX(3)).toBeCloseTo(HOVER.r, 2);

    // Object b1 (vertices 0-2) should be unchanged (red)
    expect(colorAttr.getX(0)).toBeCloseTo(1, 1);
  });

  it("selection overrides hover on the same object", () => {
    const { geometry, baseColors, pickingIndex } = makeTwoObjectGeometry();

    applyHighlight(
      geometry,
      baseColors,
      { kind: "object", objectId: "b1" },
      { kind: "object", objectId: "b1" },
      pickingIndex,
    );

    const colorAttr = geometry.getAttribute("color");
    // Selection amber should win over hover
    expect(colorAttr.getX(0)).toBeCloseTo(HIGHLIGHT.r, 2);
  });

  it("does nothing when both selection and hovered are null", () => {
    const { geometry, baseColors, pickingIndex } = makeTwoObjectGeometry();

    applyHighlight(geometry, baseColors, null, null, pickingIndex);

    const colorAttr = geometry.getAttribute("color");
    // Should match base colors exactly
    expect(colorAttr.getX(0)).toBeCloseTo(1, 5); // red
    expect(colorAttr.getX(3)).toBeCloseTo(0, 5); // blue
  });

  it("handles surface-level selection", () => {
    // 2 surfaces in one object: surface 0 and surface 1
    const positions = new Float32Array(18);
    const colors = new Float32Array([
      1, 0, 0, 1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const objectIndices = new Int32Array([0, 0, 0, 0, 0, 0]);
    const surfaceIndices = new Int32Array([0, 0, 0, 1, 1, 1]);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("objectIndex", new BufferAttribute(objectIndices, 1));
    geometry.setAttribute("surfaceIndex", new BufferAttribute(surfaceIndices, 1));

    const baseColors = Float32Array.from(colors);
    const pickingIndex: PickingIndex = { objectKeys: ["b1"] };

    applyHighlight(
      geometry,
      baseColors,
      { kind: "surface", objectId: "b1", surfaceIndex: 1 },
      null,
      pickingIndex,
    );

    const colorAttr = geometry.getAttribute("color");
    // Surface 0 (vertices 0-2) unchanged
    expect(colorAttr.getX(0)).toBeCloseTo(1, 1);
    // Surface 1 (vertices 3-5) highlighted
    expect(colorAttr.getX(3)).toBeCloseTo(HIGHLIGHT.r, 2);
  });
});

describe("clearHighlight", () => {
  it("restores base colors", () => {
    const { geometry, baseColors, pickingIndex } = makeTwoObjectGeometry();

    // Apply then clear
    applyHighlight(
      geometry,
      baseColors,
      { kind: "object", objectId: "b1" },
      null,
      pickingIndex,
    );
    clearHighlight(geometry, baseColors);

    const colorAttr = geometry.getAttribute("color");
    expect(colorAttr.getX(0)).toBeCloseTo(1, 5); // restored red
    expect(colorAttr.getX(3)).toBeCloseTo(0, 5); // restored blue
  });
});
