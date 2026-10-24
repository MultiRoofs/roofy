/**
 * `colorBy` — the ONE effective rule list both renderers consume.
 *
 * The point of these tests is that "Color by surface type / rules / a single
 * colour" is not three colouring paths: it is three ways of building one
 * `Rule[]`, which `compileRuleEvaluator` (static layers) and the FlatCityBuf
 * worker (streaming layers) already know how to draw. A zero-condition rule
 * matches everything — verified in a real browser on `fixtures/delft.fcb`
 * before this file was written — so "a single colour" is one catch-all rule
 * and "the unmatched colour" is a TRAILING catch-all.
 */
import { describe, expect, it } from "vitest";
import {
  CATCH_ALL_RULE_ID_PREFIX,
  effectiveExpression,
  effectiveRules,
  effectiveRulesEnabled,
  firstMatchingRule,
  isColorBy,
  isSyntheticRule,
  normalizeColorBy,
  seedStyleExpression,
  type ColorByInput,
} from "../../../../src/features/rules/colorBy";
import type { Rule } from "../../../../src/features/rules/types";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";
import {
  compileStyleExpression,
  rulesToStyleExpression,
  type RoofMetrics,
} from "@cityjson/navara-core";

const FLAT: Rule = {
  id: "r1",
  name: "Flat roofs",
  color: "#3b82f6",
  logic: "AND",
  conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
  enabled: true,
};
const STEEP: Rule = {
  id: "r2",
  name: "Steep roofs",
  color: "#f2683c",
  logic: "AND",
  conditions: [{ field: "inclinationDeg", operator: ">", value: 45 }],
  enabled: true,
};

function input(patch: Partial<ColorByInput> = {}): ColorByInput {
  return {
    rules: [],
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    ...patch,
  };
}

const metrics = (inclinationDeg: number): RoofMetrics => ({
  areaSqM: 100,
  inclinationDeg,
  azimuthDeg: 180,
  elevationM: 0,
});

describe("effectiveRules", () => {
  it('paints nothing in "surface" mode, so the semantic colours show through', () => {
    expect(effectiveRules(input({ rules: [FLAT] }))).toEqual([]);
    expect(effectiveRulesEnabled(input({ rules: [FLAT] }))).toBe(false);
  });

  it('"single" is ONE catch-all rule wearing the single colour', () => {
    const rules = effectiveRules(
      input({ colorBy: "single", singleColor: "#123456", rules: [FLAT] }),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]!.color).toBe("#123456");
    expect(rules[0]!.conditions).toEqual([]);
    expect(rules[0]!.enabled).toBe(true);
    expect(isSyntheticRule(rules[0]!)).toBe(true);
    // The user's own rules are deliberately not consulted in this mode.
    expect(rules.some((r) => r.id === FLAT.id)).toBe(false);
    expect(effectiveRulesEnabled(input({ colorBy: "single" }))).toBe(true);
  });

  it('"rules" is the enabled user rules, then a TRAILING unmatched catch-all', () => {
    const rules = effectiveRules(
      input({
        colorBy: "rules",
        rules: [FLAT, { ...STEEP, enabled: false }],
        unmatchedColor: "#abcdef",
      }),
    );
    expect(rules.map((r) => r.id)).toEqual([FLAT.id, expect.any(String)]);
    expect(rules).toHaveLength(2);
    const last = rules[rules.length - 1]!;
    expect(last.color).toBe("#abcdef");
    expect(last.conditions).toEqual([]);
    expect(isSyntheticRule(last)).toBe(true);
    expect(effectiveRulesEnabled(input({ colorBy: "rules" }))).toBe(true);
  });

  it("gives a synthetic rule an id no user rule can collide with", () => {
    const rules = effectiveRules(input({ colorBy: "single" }));
    expect(rules[0]!.id.startsWith(CATCH_ALL_RULE_ID_PREFIX)).toBe(true);
    expect(isSyntheticRule(FLAT)).toBe(false);
  });
});

describe("effectiveRules memoisation", () => {
  // `handleSync` tests "did the style change?" by ARRAY IDENTITY, so a fresh
  // array per render would repaint every vertex of every layer on every
  // unrelated store change.
  it("returns the same array for the same five inputs", () => {
    const a = input({ colorBy: "rules", rules: [FLAT] });
    expect(effectiveRules(a)).toBe(effectiveRules({ ...a }));
    const s = input({ colorBy: "single" });
    expect(effectiveRules(s)).toBe(effectiveRules({ ...s }));
    const surface = input();
    expect(effectiveRules(surface)).toBe(effectiveRules({ ...surface }));
  });

  it("returns a NEW array when any one of the five changes", () => {
    const base = input({ colorBy: "rules", rules: [FLAT] });
    const first = effectiveRules(base);
    expect(effectiveRules({ ...base, unmatchedColor: "#010203" })).not.toBe(
      first,
    );
    expect(effectiveRules({ ...base, colorBy: "single" })).not.toBe(first);
    expect(effectiveRules({ ...base, rules: [FLAT] })).not.toBe(first);
    expect(effectiveRules({ ...base, singleColor: "#010203" })).not.toBe(first);
    // ...and the original inputs still answer with the original array.
    expect(effectiveRules(base)).toBe(first);
  });
});

describe("firstMatchingRule", () => {
  it("is the first ENABLED rule that matches, by identity", () => {
    const twin: Rule = { ...STEEP, id: "r3", name: "Also steep" };
    // Same colour on purpose: the answer is a rule, never a colour, so two
    // rules that paint identically are still told apart.
    const rules = [{ ...STEEP, enabled: false }, twin, STEEP];
    expect(firstMatchingRule({}, metrics(60), rules)).toBe(twin);
  });

  it("is null when nothing matches", () => {
    expect(firstMatchingRule({}, metrics(30), [FLAT, STEEP])).toBeNull();
  });

  it("is null when the match is a synthetic catch-all", () => {
    const rules = effectiveRules(input({ colorBy: "rules", rules: [FLAT] }));
    // 30 degrees is neither flat nor steep, so only the trailing catch-all
    // matches — which the inspector must report as "Unmatched", not as a rule.
    expect(firstMatchingRule({}, metrics(30), rules)).toBeNull();
    expect(firstMatchingRule({}, metrics(5), rules)).toBe(FLAT);
    expect(
      firstMatchingRule(
        {},
        metrics(30),
        effectiveRules(input({ colorBy: "single" })),
      ),
    ).toBeNull();
  });
});

describe("normalizeColorBy", () => {
  it("derives an absent mode from the old rules/rulesEnabled pair", () => {
    expect(
      normalizeColorBy({ rules: [FLAT], rulesEnabled: true }).colorBy,
    ).toBe("rules");
    expect(
      normalizeColorBy({ rules: [FLAT], rulesEnabled: false }).colorBy,
    ).toBe("surface");
    expect(normalizeColorBy({ rules: [], rulesEnabled: true }).colorBy).toBe(
      "surface",
    );
    expect(normalizeColorBy({}).colorBy).toBe("surface");
  });

  it("reads a mode it does not know as an absent one", () => {
    expect(
      normalizeColorBy({ colorBy: "gradient", rules: [FLAT] }).colorBy,
    ).toBe("rules");
    expect(normalizeColorBy({ colorBy: 7 }).colorBy).toBe("surface");
  });

  it("keeps a valid #rrggbb and defaults anything else", () => {
    expect(
      normalizeColorBy({ singleColor: "#0A1B2C", unmatchedColor: "#ffffff" }),
    ).toMatchObject({ singleColor: "#0A1B2C", unmatchedColor: "#ffffff" });
    expect(
      normalizeColorBy({ singleColor: "#abc", unmatchedColor: "red" }),
    ).toMatchObject({
      singleColor: SINGLE_COLOR_HEX,
      unmatchedColor: UNMATCHED_COLOR_HEX,
    });
    expect(normalizeColorBy({ singleColor: 12 }).singleColor).toBe(
      SINGLE_COLOR_HEX,
    );
  });

  it("accepts the four modes and nothing else", () => {
    expect(isColorBy("surface")).toBe(true);
    expect(isColorBy("rules")).toBe(true);
    expect(isColorBy("single")).toBe(true);
    expect(isColorBy("expression")).toBe(true);
    expect(isColorBy("Surface")).toBe(false);
    expect(isColorBy(undefined)).toBe(false);
  });

  it("keeps an expression whatever the mode, and reads it as an array or a string", () => {
    const red = ["case", true, "#ff0000", ["get", "$base"]];
    expect(normalizeColorBy({ styleExpression: red }).styleExpression).toEqual(
      red,
    );
    expect(
      normalizeColorBy({ styleExpression: "#ff0000" }).styleExpression,
    ).toBe("#ff0000");
    expect(normalizeColorBy({ styleExpression: 7 }).styleExpression).toBeNull();
    expect(
      normalizeColorBy({ styleExpression: { a: 1 } }).styleExpression,
    ).toBeNull();
    expect(normalizeColorBy({}).styleExpression).toBeNull();
    expect(
      normalizeColorBy({ colorBy: "single", styleExpression: red }),
    ).toMatchObject({ colorBy: "single", styleExpression: red });
  });

  it('reads "expression" without an expression as an absent mode', () => {
    expect(normalizeColorBy({ colorBy: "expression" }).colorBy).toBe("surface");
    expect(
      normalizeColorBy({ colorBy: "expression", rules: [FLAT] }).colorBy,
    ).toBe("rules");
    expect(
      normalizeColorBy({ colorBy: "expression", styleExpression: "#ff0000" })
        .colorBy,
    ).toBe("expression");
  });
});

describe("effectiveExpression", () => {
  const red = ["case", true, "#ff0000", ["get", "$base"]];

  it('is the layer\'s expression in "expression" mode only', () => {
    expect(
      effectiveExpression(
        input({ colorBy: "expression", styleExpression: red }),
      ),
    ).toBe(red);
    expect(
      effectiveExpression(input({ colorBy: "rules", styleExpression: red })),
    ).toBeNull();
    expect(effectiveExpression(input({ colorBy: "expression" }))).toBeNull();
  });

  it("paints no rules beside it", () => {
    const layer = input({
      colorBy: "expression",
      styleExpression: red,
      rules: [FLAT],
    });
    expect(effectiveRules(layer)).toEqual([]);
    expect(effectiveRulesEnabled(layer)).toBe(false);
  });
});

describe("seedStyleExpression", () => {
  it("carries the rendering the layer had into an expression that draws it", () => {
    expect(
      seedStyleExpression(input({ colorBy: "rules", rules: [FLAT, STEEP] })),
    ).toEqual(
      rulesToStyleExpression(
        effectiveRules(input({ colorBy: "rules", rules: [FLAT, STEEP] })),
      ),
    );
    expect(
      seedStyleExpression(input({ colorBy: "single", singleColor: "#123456" })),
    ).toEqual(
      rulesToStyleExpression(
        effectiveRules(input({ colorBy: "single", singleColor: "#123456" })),
      ),
    );
  });

  it("starts from the layer's rules when it was on surface type", () => {
    expect(seedStyleExpression(input({ rules: [FLAT] }))).toEqual(
      rulesToStyleExpression(
        effectiveRules(input({ colorBy: "rules", rules: [FLAT] })),
      ),
    );
  });

  it("offers a starter that compiles when there is nothing to carry", () => {
    const starter = seedStyleExpression(input());
    expect(compileStyleExpression(starter).ok).toBe(true);
    expect(JSON.stringify(starter)).toContain("RoofSurface");
  });
});
