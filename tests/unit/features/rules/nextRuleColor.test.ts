/**
 * §6.2: a new rule's colour is "the next palette colour". Until this existed
 * every draft took `#7cb518`, so a second Style-by-result rule was invisible
 * against the first.
 */
import { describe, expect, it } from "vitest";
import type { Rule } from "../../../../src/features/rules/types";
import { nextRuleColor } from "../../../../src/features/rules/nextRuleColor";
import { RULE_PALETTE_HEX } from "../../../../src/scene/cityColors";

const rule = (color: string, enabled = true): Rule => ({
  id: color,
  name: color,
  color,
  logic: "AND",
  conditions: [],
  enabled,
});

describe("nextRuleColor", () => {
  it("hands the FIRST palette colour to a layer with no rules", () => {
    // Nothing about a user's first rule changes: `RULE_PALETTE_HEX[0]` IS
    // `NEW_RULE_COLOR_HEX`.
    expect(nextRuleColor([])).toBe(RULE_PALETTE_HEX[0]);
  });

  it("skips a colour an existing rule already wears", () => {
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!)])).toBe(
      RULE_PALETTE_HEX[1],
    );
    expect(
      nextRuleColor([rule(RULE_PALETTE_HEX[0]!), rule(RULE_PALETTE_HEX[1]!)]),
    ).toBe(RULE_PALETTE_HEX[2]);
  });

  it("ignores case, as every other colour comparison does", () => {
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!.toUpperCase())])).toBe(
      RULE_PALETTE_HEX[1],
    );
  });

  it("re-offers a colour only a DISABLED rule holds", () => {
    // A disabled rule paints nothing, so its colour is not taken.
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!, false)])).toBe(
      RULE_PALETTE_HEX[0],
    );
  });

  it("wraps by the rule COUNT once every colour is taken", () => {
    const all = RULE_PALETTE_HEX.map((hex) => rule(hex));
    expect(nextRuleColor(all)).toBe(RULE_PALETTE_HEX[0]);
    expect(nextRuleColor([...all, rule("#000000")])).toBe(RULE_PALETTE_HEX[1]);
  });

  it("ignores a colour that is not in the palette", () => {
    expect(nextRuleColor([rule("#123456")])).toBe(RULE_PALETTE_HEX[0]);
  });
});
