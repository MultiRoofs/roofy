/**
 * Unit tests for rule presets.
 *
 * Verifies each preset creates a valid Rule with a unique ID.
 */

import { describe, it, expect } from "vitest";
import { RULE_PRESETS } from "../../../../src/features/rules/presets";

describe("RULE_PRESETS", () => {
  it("has at least 3 presets", () => {
    expect(RULE_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  for (const preset of RULE_PRESETS) {
    describe(preset.label, () => {
      it("creates a rule with a unique ID", () => {
        const r1 = preset.create();
        const r2 = preset.create();
        expect(r1.id).toBeTruthy();
        expect(r2.id).toBeTruthy();
        expect(r1.id).not.toBe(r2.id);
      });

      it("has required fields", () => {
        const rule = preset.create();
        expect(rule.name).toBeTruthy();
        expect(rule.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(Array.isArray(rule.conditions)).toBe(true);
        expect(rule.conditions.length).toBeGreaterThan(0);
        expect(rule.enabled).toBe(true);
      });
    });
  }
});
