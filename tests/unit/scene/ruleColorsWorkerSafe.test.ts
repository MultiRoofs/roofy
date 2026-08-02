import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry, Color } from "three";
import {
  buildRuleColorsFromArrays,
  buildRuleColors,
} from "../../../src/scene/applyRuleColors";
import type {
  CityModel,
  CityObject,
  Surface,
} from "../../../src/domain/citymodel/types";
import type { Rule } from "@cityjson/navara-core";

// ---------------------------------------------------------------------------
// buildRuleColorsFromArrays (independent oracle).
//
// These tests never call buildRuleColors and compare against
// buildRuleColorsFromArrays (or vice-versa) as their sole check — since
// buildRuleColors is now a thin wrapper that delegates to
// buildRuleColorsFromArrays, such a comparison would only prove wiring,
// not correctness (see Task 6's self-comparison pitfall). Instead, expected
// colors come from `new Color(hex)` (three's real, independently-implemented
// conversion) and expected routing (which vertices change / stay) is
// reasoned about directly from the synthetic model.
// ---------------------------------------------------------------------------

function makeSurface(
  type: Surface["type"],
  attributes: Record<string, unknown> = {},
  ring: Surface["rings"][0] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
): Surface {
  return { type, rings: [ring], attributes, lod: "2" };
}

function makeObject(
  id: string,
  surfaces: Surface[],
  attributes: Record<string, unknown> = {},
): CityObject {
  return {
    id,
    objectType: "Building",
    attributes,
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

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "r1",
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

function expectedLinear(hex: string): readonly [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

function fillSentinel(vertexCount: number, rgb: [number, number, number]) {
  const arr = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    arr[v * 3] = rgb[0];
    arr[v * 3 + 1] = rgb[1];
    arr[v * 3 + 2] = rgb[2];
  }
  return arr;
}

const SENTINEL: [number, number, number] = [0.11, 0.22, 0.33];

function expectVertexColor(
  arr: Float32Array,
  v: number,
  expected: readonly [number, number, number],
) {
  expect(arr[v * 3]).toBeCloseTo(expected[0], 6);
  expect(arr[v * 3 + 1]).toBeCloseTo(expected[1], 6);
  expect(arr[v * 3 + 2]).toBeCloseTo(expected[2], 6);
}

describe("buildRuleColorsFromArrays", () => {
  it("returns null when there are no enabled rules", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const objectIndices = new Uint32Array([0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0]);
    const baseColors = fillSentinel(3, SENTINEL);

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [makeRule({ enabled: false })],
      baseColors,
    );

    expect(result).toBeNull();
  });

  it("returns null when an enabled rule exists but matches no vertex", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface", { zone: "A" })]),
    });
    const objectIndices = new Uint32Array([0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0]);
    const baseColors = fillSentinel(3, SENTINEL);

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [
        makeRule({
          conditions: [{ field: "zone", operator: "=", value: "nonexistent" }],
        }),
      ],
      baseColors,
    );

    expect(result).toBeNull();
  });

  it("colors only RoofSurface vertices; WallSurface vertices keep baseColors even under a vacuously-true rule", () => {
    const roof = makeSurface("RoofSurface");
    const wall = makeSurface("WallSurface");
    const model = makeModel({ b1: makeObject("b1", [roof, wall]) });

    // vertices 0-2 -> roof (surfIdx 0), vertices 3-5 -> wall (surfIdx 1)
    const objectIndices = new Uint32Array([0, 0, 0, 0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0, 1, 1, 1]);
    const baseColors = fillSentinel(6, SENTINEL);

    const ruleHex = "#3a7bd5";
    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [makeRule({ color: ruleHex })], // conditions: [] matches everything
      baseColors,
    );

    expect(result).not.toBeNull();
    const expected = expectedLinear(ruleHex);
    expectVertexColor(result!, 0, expected);
    expectVertexColor(result!, 1, expected);
    expectVertexColor(result!, 2, expected);
    // Wall vertices are untouched — surface.type !== "RoofSurface" is filtered
    // out inside resolveRuleColor regardless of the rule's conditions.
    expectVertexColor(result!, 3, SENTINEL);
    expectVertexColor(result!, 4, SENTINEL);
    expectVertexColor(result!, 5, SENTINEL);
  });

  it("resolves independently-cached colors for different surfaces on the same object", () => {
    const surfaceA = makeSurface("RoofSurface", { zone: "A" });
    const surfaceB = makeSurface("RoofSurface", { zone: "B" });
    const model = makeModel({ b1: makeObject("b1", [surfaceA, surfaceB]) });

    const objectIndices = new Uint32Array([0, 0, 0, 0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0, 1, 1, 1]);
    const baseColors = fillSentinel(6, SENTINEL);

    const hexA = "#3a7bd5";
    const hexB = "#808080";
    const rules: Rule[] = [
      makeRule({
        id: "ruleA",
        color: hexA,
        conditions: [{ field: "zone", operator: "=", value: "A" }],
      }),
      makeRule({
        id: "ruleB",
        color: hexB,
        conditions: [{ field: "zone", operator: "=", value: "B" }],
      }),
    ];

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      rules,
      baseColors,
    );

    expect(result).not.toBeNull();
    const expectedA = expectedLinear(hexA);
    const expectedB = expectedLinear(hexB);
    expectVertexColor(result!, 0, expectedA);
    expectVertexColor(result!, 1, expectedA);
    expectVertexColor(result!, 2, expectedA);
    expectVertexColor(result!, 3, expectedB);
    expectVertexColor(result!, 4, expectedB);
    expectVertexColor(result!, 5, expectedB);
  });

  it("first matching enabled rule wins; disabled rules never win even ranked first", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const objectIndices = new Uint32Array([0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0]);
    const baseColors = fillSentinel(3, SENTINEL);

    const disabledHex = "#111111";
    const winningHex = "#3a7bd5";
    const rules: Rule[] = [
      makeRule({ id: "disabled", color: disabledHex, enabled: false }),
      makeRule({ id: "winner", color: winningHex }),
    ];

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      rules,
      baseColors,
    );

    expect(result).not.toBeNull();
    expectVertexColor(result!, 0, expectedLinear(winningHex));
  });

  it("does not crash and skips vertices whose objectIndex has no matching objectKey", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    // objectIndex 5 has no corresponding entry in objectKeys (length 1)
    const objectIndices = new Uint32Array([5]);
    const surfaceIndices = new Uint32Array([0]);
    const baseColors = fillSentinel(1, SENTINEL);

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [makeRule()],
      baseColors,
    );

    expect(result).toBeNull();
  });

  it("does not mutate the baseColors input array", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const objectIndices = new Uint32Array([0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0]);
    const baseColors = fillSentinel(3, SENTINEL);
    const snapshot = Float32Array.from(baseColors);

    buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [makeRule({ color: "#3a7bd5" })],
      baseColors,
    );

    expect(baseColors).toEqual(snapshot);
  });

  it("returns a new Float32Array, not the same reference as baseColors", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const objectIndices = new Uint32Array([0, 0, 0]);
    const surfaceIndices = new Uint32Array([0, 0, 0]);
    const baseColors = fillSentinel(3, SENTINEL);

    const result = buildRuleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      [makeRule({ color: "#3a7bd5" })],
      baseColors,
    );

    expect(result).not.toBeNull();
    expect(result).not.toBe(baseColors);
  });
});

// ---------------------------------------------------------------------------
// buildRuleColors wrapper (independent oracle against a hand-built
// BufferGeometry — NOT a comparison against buildRuleColorsFromArrays'
// output, per the self-comparison pitfall from Task 6).
// ---------------------------------------------------------------------------

describe("buildRuleColors (BufferGeometry wrapper)", () => {
  it("extracts objectIndex/surfaceIndex from the geometry and colors matching roof vertices", () => {
    // objectIndex (1) and surfaceIndex (2) are deliberately distinct and
    // non-zero, and only object index 1 / surface index 2 actually
    // resolves to a RoofSurface. This ensures a wrapper bug that reads the
    // two attributes into swapped slots (objectIndex <-> surfaceIndex) is
    // detectable: swapped, this vertex would resolve to objectKeys[2]
    // (out of range -> no match) instead of objectKeys[1]'s 3rd surface.
    const model = makeModel({
      dummy: makeObject("dummy", [makeSurface("WallSurface")]),
      b1: makeObject("b1", [
        makeSurface("WallSurface"),
        makeSurface("WallSurface"),
        makeSurface("RoofSurface"),
      ]),
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "objectIndex",
      new BufferAttribute(new Uint32Array([1, 1, 1]), 1),
    );
    geometry.setAttribute(
      "surfaceIndex",
      new BufferAttribute(new Uint32Array([2, 2, 2]), 1),
    );
    const baseColors = fillSentinel(3, SENTINEL);
    const ruleHex = "#3a7bd5";

    const result = buildRuleColors(
      model,
      geometry,
      { layerId: "L", objectKeys: ["dummy", "b1"] },
      [makeRule({ color: ruleHex })],
      baseColors,
    );

    expect(result).not.toBeNull();
    expectVertexColor(result!, 0, expectedLinear(ruleHex));
  });

  it("returns null when the geometry is missing the index attributes", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const geometry = new BufferGeometry(); // no objectIndex/surfaceIndex
    const baseColors = fillSentinel(3, SENTINEL);

    const result = buildRuleColors(
      model,
      geometry,
      { layerId: "L", objectKeys: ["b1"] },
      [makeRule({ color: "#3a7bd5" })],
      baseColors,
    );

    expect(result).toBeNull();
  });
});
