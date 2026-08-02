/**
 * `compileRuleEvaluator` — the app-side rules -> `SurfaceStyleEvaluator` glue
 * (spec 5's `ruleStore-per-layer --compile--> SurfaceStyleEvaluator -->
 * handle.setStyle` edge, Task B14).
 *
 * The function was introduced in Task A12 as the shared compile step behind
 * `buildRuleColorsFromArrays`; these are its first DIRECT tests, and they pin
 * the semantics the pre-Navara `applyRuleColors` had, because
 * `CityModelHandle.setStyle` now depends on every one of them:
 *
 * - only `RoofSurface` participates;
 * - roof metrics come from `computeRoofMetrics` (so `inclinationDeg` &c. are
 *   matchable fields);
 * - object attributes are merged UNDER surface attributes;
 * - rules are evaluated in array order, first match wins, disabled rules skipped;
 * - the result is a LINEAR-sRGB triple — no hex round trip, no engine `Color`.
 *
 * Expected colors come from three's own `Color` (an independently implemented
 * sRGB -> linear conversion), never from `srgbHexToLinear` itself, so these
 * assertions cannot pass by comparing the implementation with itself.
 */
import { describe, expect, it } from "vitest";
import { Color } from "three";
import { compileRuleEvaluator } from "../../../src/scene/applyRuleColors";
import type { CityObject, Surface } from "../../../src/domain/citymodel/types";
import type { Rule } from "../../../src/features/rules/types";

/**
 * Assert a compiled color against three's own sRGB -> linear conversion.
 * Per-channel `toBeCloseTo`, not `toEqual`: the two implementations agree to
 * ~1e-11, which is far below any visible difference but is not bit-identical
 * (three's `Color` and `srgbHexToLinear` evaluate the same `((c+0.055)/1.055)
 * ** 2.4` through different expression trees).
 */
function expectLinear(
  actual: readonly [number, number, number] | null,
  hex: string,
): void {
  const c = new Color(hex);
  expect(actual).not.toBeNull();
  expect(actual![0]).toBeCloseTo(c.r, 9);
  expect(actual![1]).toBeCloseTo(c.g, 9);
  expect(actual![2]).toBeCloseTo(c.b, 9);
}

const flatRoof: Surface = {
  type: "RoofSurface",
  rings: [
    [
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
      [0, 10, 10],
    ],
  ],
  attributes: {},
  lod: "2",
};

/** 45 degrees: rises 10 m over a 10 m run. */
const slopedRoof: Surface = {
  ...flatRoof,
  rings: [
    [
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 20],
      [0, 10, 20],
    ],
  ],
};

const wall: Surface = { ...flatRoof, type: "WallSurface" };

const object: CityObject = {
  id: "B1",
  objectType: "Building",
  attributes: { function: "residential" },
  surfaces: [flatRoof, wall],
  bbox: null,
  children: [],
  parents: [],
  lod: "2",
};

const objectInfo = { objectId: "B1", object };

function rule(patch: Partial<Rule> & { id: string; color: string }): Rule {
  return {
    name: patch.id,
    conditions: [],
    logic: "AND",
    enabled: true,
    ...patch,
  };
}

const flatRule = rule({
  id: "r1",
  color: "#4ec84e",
  conditions: [{ field: "inclinationDeg", operator: "<", value: 5 }],
});
const disabledRule = rule({ id: "r2", color: "#ff0000", enabled: false });

describe("compileRuleEvaluator", () => {
  it("returns null when the layer's rules are switched off", () => {
    // The `rulesEnabled` gate: the layer keeps its rules, but nothing paints.
    expect(compileRuleEvaluator([flatRule], false)).toBeNull();
  });

  it("returns null when no rule is enabled", () => {
    expect(compileRuleEvaluator([disabledRule], true)).toBeNull();
    expect(compileRuleEvaluator([], true)).toBeNull();
  });

  it("defaults to enabled, so the existing single-argument callers are unchanged", () => {
    expect(compileRuleEvaluator([flatRule])).not.toBeNull();
  });

  it("colors a matching roof surface with a linear-sRGB triple", () => {
    const evaluate = compileRuleEvaluator([flatRule], true)!;
    const color = evaluate({ surfaceIndex: 0, surface: flatRoof }, objectInfo);
    // Not a hex string, not an engine Color: three floats.
    expectLinear(color, "#4ec84e");
  });

  it("never colors a non-roof surface", () => {
    const evaluate = compileRuleEvaluator([flatRule], true)!;
    expect(evaluate({ surfaceIndex: 1, surface: wall }, objectInfo)).toBeNull();
  });

  it("matches on computed roof metrics, not just attributes", () => {
    const evaluate = compileRuleEvaluator([flatRule], true)!;
    // Same rule, same object: only the geometry differs, and a 45 degree roof
    // is not `inclinationDeg < 5`.
    expect(
      evaluate({ surfaceIndex: 0, surface: slopedRoof }, objectInfo),
    ).toBeNull();
  });

  it("matches object attributes when the surface carries none", () => {
    const evaluate = compileRuleEvaluator(
      [
        rule({
          id: "byObject",
          color: "#123456",
          conditions: [
            { field: "function", operator: "=", value: "residential" },
          ],
        }),
      ],
      true,
    )!;
    expectLinear(
      evaluate({ surfaceIndex: 0, surface: flatRoof }, objectInfo),
      "#123456",
    );
  });

  it("lets a surface attribute override the object's attribute of the same name", () => {
    const evaluate = compileRuleEvaluator(
      [
        rule({
          id: "bySurface",
          color: "#123456",
          conditions: [{ field: "function", operator: "=", value: "shed" }],
        }),
      ],
      true,
    )!;
    const shed: Surface = { ...flatRoof, attributes: { function: "shed" } };
    // The object says "residential"; the surface wins.
    expectLinear(
      evaluate({ surfaceIndex: 0, surface: shed }, objectInfo),
      "#123456",
    );
  });

  it("keeps rule priority: first enabled match wins, disabled rules are skipped", () => {
    const evaluate = compileRuleEvaluator(
      [
        rule({ id: "off", color: "#ff0000", enabled: false }),
        rule({ id: "first", color: "#00ff00" }),
        rule({ id: "second", color: "#0000ff" }),
      ],
      true,
    )!;
    expectLinear(
      evaluate({ surfaceIndex: 0, surface: flatRoof }, objectInfo),
      "#00ff00",
    );
  });

  it("leaves an unmatched roof at its base color", () => {
    const evaluate = compileRuleEvaluator(
      [
        rule({
          id: "never",
          color: "#123456",
          conditions: [{ field: "inclinationDeg", operator: ">", value: 80 }],
        }),
      ],
      true,
    )!;
    expect(
      evaluate({ surfaceIndex: 0, surface: flatRoof }, objectInfo),
    ).toBeNull();
  });

  it("converts each hex exactly once (A12's linear cache)", () => {
    const evaluate = compileRuleEvaluator([flatRule], true)!;
    const a = evaluate({ surfaceIndex: 0, surface: flatRoof }, objectInfo);
    const b = evaluate({ surfaceIndex: 2, surface: flatRoof }, objectInfo);
    // Same triple instance: the conversion is cached per hex, not redone per
    // surface (this runs once per surface of every rule-colored layer).
    expect(a).toBe(b);
  });
});
