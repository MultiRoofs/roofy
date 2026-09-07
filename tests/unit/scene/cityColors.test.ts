/**
 * The COLLISION rule, pinned.
 *
 * `scene/cityColors.ts` says it in prose — "nothing below is byte-equal to a
 * preset, the new-rule default or the default geospatial colour" — and until
 * this file existed nothing checked it. The rule is not decoration: a
 * highlight equal to a rule colour makes a selected surface look unselected, a
 * base roof equal to a rule colour makes that rule look like a no-op, and an
 * unmatched grey equal to the unknown-surface grey makes "no rule applies"
 * indistinguishable from "no surface type".
 *
 * Task 26 added four constants to that file (the unmatched grey, the single
 * colour, the categorical palette and its Other bucket), which is what finally
 * made the missing test worth writing.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORY_OTHER_HEX,
  CATEGORY_PALETTE_HEX,
  CITY_COLORS,
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../src/scene/cityColors";
import { RULE_PRESETS } from "../../../src/features/rules/presets";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../src/features/geoLayers/geoLayerStyle";

/** The colour a fresh rule opens with in `RulesEditor`'s builder — a user's
 *  very first rule wears it, so it counts as a rule colour. */
const NEW_RULE_DEFAULT = "#7cb518";

const lower = (hex: string) => hex.toLowerCase();

/** The values `cityColors.ts` itself owns: the two interaction accents and
 *  every base surface colour. */
const CHROME: ReadonlyArray<readonly [string, string]> = [
  ["highlight", CITY_COLORS.highlightColor!],
  ["hover", CITY_COLORS.hoverColor!],
  ...Object.entries(CITY_COLORS.surfaceColors ?? {}).map(
    ([type, hex]) => [`surface ${type}`, hex] as const,
  ),
];

/**
 * The values a `cityColors` constant must not collide WITH: every rule colour
 * a user can end up with, plus the colour a geospatial layer draws in.
 *
 * Note that this list is deliberately not internally distinct — the "Steep
 * roofs" preset and `DEFAULT_GEO_LAYER_STYLE` are both the brand accent, and
 * that is fine: they never appear on the same geometry, and the hard rule is
 * about `cityColors` values, not about these.
 */
const RULE_COLORS: ReadonlyArray<readonly [string, string]> = [
  ...RULE_PRESETS.map((p) => [`preset ${p.label}`, p.create().color] as const),
  ["new-rule default", NEW_RULE_DEFAULT],
  ["default geo layer", DEFAULT_GEO_LAYER_STYLE.color],
];

const NEW_CONSTANTS: ReadonlyArray<readonly [string, string]> = [
  ["UNMATCHED_COLOR_HEX", UNMATCHED_COLOR_HEX],
  ["SINGLE_COLOR_HEX", SINGLE_COLOR_HEX],
  ["CATEGORY_OTHER_HEX", CATEGORY_OTHER_HEX],
  ...CATEGORY_PALETTE_HEX.map(
    (hex, i) => [`CATEGORY_PALETTE_HEX[${i}]`, hex] as const,
  ),
];

describe("the interaction accents and the base surfaces", () => {
  it("are never byte-equal to a rule colour", () => {
    const ruleColors = new Set(RULE_COLORS.map(([, hex]) => lower(hex)));
    for (const [name, hex] of CHROME) {
      expect([name, ruleColors.has(lower(hex))]).toEqual([name, false]);
    }
  });

  it("are distinct from one another", () => {
    const values = CHROME.map(([, hex]) => lower(hex));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("the colorBy constants", () => {
  it("differ from highlight, hover and every base surface colour", () => {
    const reserved = new Set(CHROME.map(([, hex]) => lower(hex)));
    for (const [name, hex] of NEW_CONSTANTS) {
      expect([name, reserved.has(lower(hex))]).toEqual([name, false]);
    }
  });

  it("differ from every rule preset, the new-rule default and the geo default", () => {
    const ruleColors = new Set(RULE_COLORS.map(([, hex]) => lower(hex)));
    for (const [name, hex] of NEW_CONSTANTS) {
      expect([name, ruleColors.has(lower(hex))]).toEqual([name, false]);
    }
  });

  it("differ from one another", () => {
    const values = NEW_CONSTANTS.map(([, hex]) => lower(hex));
    expect(new Set(values).size).toBe(values.length);
  });

  it("are all `#rrggbb`, which is what the persistence validator accepts", () => {
    for (const [name, hex] of NEW_CONSTANTS) {
      expect([name, /^#[0-9a-f]{6}$/i.test(hex)]).toEqual([name, true]);
    }
  });

  it("offers exactly 8 categorical colours plus a reserved Other", () => {
    expect(CATEGORY_PALETTE_HEX).toHaveLength(8);
    expect(CATEGORY_PALETTE_HEX).not.toContain(CATEGORY_OTHER_HEX);
  });
});
