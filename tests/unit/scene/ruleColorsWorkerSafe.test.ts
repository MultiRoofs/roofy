import { describe, it, expect, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Color } from "three";
import {
  srgbHexToLinear,
  buildRuleColorsFromArrays,
  buildRuleColors,
} from "../../../src/scene/applyRuleColors";
import type {
  CityModel,
  CityObject,
  Surface,
} from "../../../src/domain/citymodel/types";
import type { Rule } from "../../../src/features/rules/types";

// Independent (not imported from production) duplicate of the sRGB->linear
// channel formula, used only to build a "what the buggy un-expanded parse
// would have produced" comparison value in the 3-digit regression test
// below. Its own correctness is separately locked down by the three.Color
// parity tests above.
function srgbChannelToLinearForTest(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// ---------------------------------------------------------------------------
// Colour-space parity.
//
// `new Color(hex)` (with ColorManagement on, three's default) converts
// sRGB -> Linear-sRGB; it is NOT hexChannel / 255. `srgbHexToLinear` must
// reproduce that conversion exactly, since streamed (worker-colored) cells
// and statically-colored geometry must render identically.
//
// The hex list below deliberately brackets the 0.04045 knee where the
// piecewise formula's two branches diverge most: 10/255 = 0.0392 (below,
// linear branch) and 11/255 = 0.0431 (the nearest 8-bit value above the
// knee, power branch), plus pure black/white (both branch endpoints) and a
// mid-grey (largest naive-vs-linear divergence).
// ---------------------------------------------------------------------------

describe("srgbHexToLinear parity with three.Color", () => {
  const hexes = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#3a7bd5",
    "#0a0a0a", // 10/255 = 0.0392..., just BELOW the 0.04045 knee
    "#0b0b0b", // 11/255 = 0.0431..., the nearest 8-bit value ABOVE the knee
    "#010101", // deep into the linear branch
    "#808080", // mid-grey: largest linear-vs-naive divergence
  ];

  for (const hex of hexes) {
    it(`matches three.Color for ${hex}`, () => {
      const expected = new Color(hex);
      const [r, g, b] = srgbHexToLinear(hex);
      expect(r).toBeCloseTo(expected.r, 6);
      expect(g).toBeCloseTo(expected.g, 6);
      expect(b).toBeCloseTo(expected.b, 6);
    });
  }

  it("is not the naive hex/255 conversion", () => {
    // 0x80 / 255 = 0.5019..., but linear-sRGB is ~0.2158
    const [r] = srgbHexToLinear("#808080");
    expect(r).not.toBeCloseTo(0.5019, 3);
  });

  it("uses the linear (c/12.92) branch strictly below the 0.04045 knee", () => {
    // 10/255 = 0.039215686... < 0.04045, so the expected value is the
    // SIMPLE division, not the power curve. A wrong branch selection
    // (e.g. always using the power formula) would fail this by a wide
    // margin: c/12.92 = 0.003035..., power-branch would give ~0.00743.
    const [r] = srgbHexToLinear("#0a0a0a");
    const naiveLinearBranch = 10 / 255 / 12.92;
    expect(r).toBeCloseTo(naiveLinearBranch, 6);
  });

  it("uses the power ((c+0.055)/1.055)^2.4 branch strictly above the 0.04045 knee", () => {
    // 11/255 = 0.043137... > 0.04045.
    const [r] = srgbHexToLinear("#0b0b0b");
    const c = 11 / 255;
    const powerBranch = ((c + 0.055) / 1.055) ** 2.4;
    expect(r).toBeCloseTo(powerBranch, 6);
  });
});

// ---------------------------------------------------------------------------
// 3-digit CSS hex shorthand support.
//
// three.Color's setStyle accepts BOTH 3-digit ("#abc") and 6-digit
// ("#aabbcc") hex. srgbHexToLinear previously only handled the 6-digit
// form (parseInt on the whole string), so e.g. "#fff" silently produced
// [0, 0.0048, 1] instead of white [1, 1, 1] — a real regression, since
// Rule.color accepts any non-empty string from imported rule configs
// (see RuleBuilderTab.tsx) with no validation forcing 6 digits.
// ---------------------------------------------------------------------------

describe("srgbHexToLinear 3-digit CSS hex shorthand", () => {
  const shorthand = ["#fff", "#abc", "#0f0"];

  for (const hex of shorthand) {
    it(`matches three.Color for 3-digit ${hex}`, () => {
      const expected = new Color(hex);
      const [r, g, b] = srgbHexToLinear(hex);
      expect(r).toBeCloseTo(expected.r, 6);
      expect(g).toBeCloseTo(expected.g, 6);
      expect(b).toBeCloseTo(expected.b, 6);
    });
  }

  it("does not match the un-expanded (wrong) 6-digit parse of a 3-digit string", () => {
    // Regression guard: parseInt("abc", 16) as if "abc" were 6 hex digits
    // gives a materially different (and wrong) color than the correct
    // expansion "aabbcc". Both sides must go through the SAME sRGB->linear
    // conversion for this to be a meaningful comparison (comparing linear
    // output against raw un-converted channels would pass regardless of
    // whether the expansion bug is present, since linear != raw either way).
    const [r, g, b] = srgbHexToLinear("#abc");
    const wrongViaRawParse = parseInt("abc", 16); // treats "abc" as if 6-digit
    const wrongLinear = [
      srgbChannelToLinearForTest(((wrongViaRawParse >> 16) & 255) / 255),
      srgbChannelToLinearForTest(((wrongViaRawParse >> 8) & 255) / 255),
      srgbChannelToLinearForTest((wrongViaRawParse & 255) / 255),
    ];
    expect([r, g, b]).not.toEqual(wrongLinear);
  });
});

// ---------------------------------------------------------------------------
// Malformed hex input.
//
// Rule.color's documented contract is "CSS hex color" only (3 or 6 hex
// digits) — CSS color names and rgb()/hsl() function syntax, which
// three.Color's setStyle also accepts, are intentionally out of scope.
// For anything outside that contract, srgbHexToLinear must fail visibly
// (a warning plus an obviously-wrong white) rather than silently produce a
// plausible-looking wrong color — matching what `new Color(...)` itself
// does for malformed/unrecognized color strings on a fresh instance.
// ---------------------------------------------------------------------------

describe("srgbHexToLinear malformed input", () => {
  it("falls back to white and warns for a non-hex string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [r, g, b] = srgbHexToLinear("#xyz");
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to white and warns for the empty string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [r, g, b] = srgbHexToLinear("");
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to white and warns for a wrong-length hex string (2 digits)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [r, g, b] = srgbHexToLinear("#ab");
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to white and warns for a wrong-length hex string (4 digits)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [r, g, b] = srgbHexToLinear("#abcd");
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

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
