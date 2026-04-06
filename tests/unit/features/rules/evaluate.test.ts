import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateRule,
  matchRule,
} from "../../../../src/features/rules/evaluate";
import type { Condition, Rule } from "../../../../src/features/rules/types";
import type { RoofMetrics } from "../../../../src/domain/roofMetrics/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "Test rule",
    color: "#4ec84e",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

const FLAT_METRICS: RoofMetrics = {
  areaSqM: 50,
  inclinationDeg: 5,
  azimuthDeg: 180,
};

const STEEP_METRICS: RoofMetrics = {
  areaSqM: 30,
  inclinationDeg: 45,
  azimuthDeg: 90,
};

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe("evaluateCondition", () => {
  describe("numeric comparisons", () => {
    it("> returns true when value exceeds threshold", () => {
      const cond: Condition = { field: "x", operator: ">", value: 10 };
      expect(evaluateCondition(15, cond)).toBe(true);
      expect(evaluateCondition(10, cond)).toBe(false);
      expect(evaluateCondition(5, cond)).toBe(false);
    });

    it("< returns true when value is below threshold", () => {
      const cond: Condition = { field: "x", operator: "<", value: 10 };
      expect(evaluateCondition(5, cond)).toBe(true);
      expect(evaluateCondition(10, cond)).toBe(false);
    });

    it("= returns true for equal numeric values", () => {
      const cond: Condition = { field: "x", operator: "=", value: 10 };
      expect(evaluateCondition(10, cond)).toBe(true);
      expect(evaluateCondition(11, cond)).toBe(false);
    });

    it(">= returns true when value equals or exceeds threshold", () => {
      const cond: Condition = { field: "x", operator: ">=", value: 10 };
      expect(evaluateCondition(10, cond)).toBe(true);
      expect(evaluateCondition(15, cond)).toBe(true);
      expect(evaluateCondition(9, cond)).toBe(false);
    });

    it("<= returns true when value equals or is below threshold", () => {
      const cond: Condition = { field: "x", operator: "<=", value: 10 };
      expect(evaluateCondition(10, cond)).toBe(true);
      expect(evaluateCondition(5, cond)).toBe(true);
      expect(evaluateCondition(11, cond)).toBe(false);
    });
  });

  describe("string comparisons", () => {
    it("= matches equal strings", () => {
      const cond: Condition = { field: "x", operator: "=", value: "flat" };
      expect(evaluateCondition("flat", cond)).toBe(true);
      expect(evaluateCondition("gabled", cond)).toBe(false);
    });
  });

  describe("boolean comparisons", () => {
    it("= matches boolean values", () => {
      const cond: Condition = { field: "x", operator: "=", value: true };
      expect(evaluateCondition(true, cond)).toBe(true);
      expect(evaluateCondition(false, cond)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false when field value is undefined", () => {
      const cond: Condition = { field: "x", operator: ">", value: 10 };
      expect(evaluateCondition(undefined, cond)).toBe(false);
    });

    it("returns false when field value is null", () => {
      const cond: Condition = { field: "x", operator: "=", value: "test" };
      expect(evaluateCondition(null, cond)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateRule
// ---------------------------------------------------------------------------

describe("evaluateRule", () => {
  it("returns true for a rule with no conditions (vacuously true)", () => {
    const rule = makeRule({ conditions: [] });
    expect(evaluateRule({}, FLAT_METRICS, rule)).toBe(true);
  });

  describe("AND logic", () => {
    it("returns true when all conditions match", () => {
      const rule = makeRule({
        logic: "AND",
        conditions: [
          { field: "inclinationDeg", operator: "<", value: 10 },
          { field: "areaSqM", operator: ">", value: 20 },
        ],
      });
      expect(evaluateRule({}, FLAT_METRICS, rule)).toBe(true);
    });

    it("returns false when one condition fails", () => {
      const rule = makeRule({
        logic: "AND",
        conditions: [
          { field: "inclinationDeg", operator: "<", value: 10 },
          { field: "areaSqM", operator: ">", value: 100 }, // fails
        ],
      });
      expect(evaluateRule({}, FLAT_METRICS, rule)).toBe(false);
    });
  });

  describe("OR logic", () => {
    it("returns true when at least one condition matches", () => {
      const rule = makeRule({
        logic: "OR",
        conditions: [
          { field: "inclinationDeg", operator: ">", value: 90 }, // fails
          { field: "areaSqM", operator: ">", value: 20 }, // passes
        ],
      });
      expect(evaluateRule({}, FLAT_METRICS, rule)).toBe(true);
    });

    it("returns false when no conditions match", () => {
      const rule = makeRule({
        logic: "OR",
        conditions: [
          { field: "inclinationDeg", operator: ">", value: 90 },
          { field: "areaSqM", operator: ">", value: 100 },
        ],
      });
      expect(evaluateRule({}, FLAT_METRICS, rule)).toBe(false);
    });
  });

  it("resolves attribute fields from the attributes record", () => {
    const rule = makeRule({
      conditions: [{ field: "roofType", operator: "=", value: "flat" }],
    });
    expect(evaluateRule({ roofType: "flat" }, FLAT_METRICS, rule)).toBe(true);
    expect(evaluateRule({ roofType: "gabled" }, FLAT_METRICS, rule)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchRule
// ---------------------------------------------------------------------------

describe("matchRule", () => {
  it("returns the color of the first matching enabled rule", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r1",
        color: "#cc4444",
        conditions: [{ field: "inclinationDeg", operator: ">", value: 35 }],
      }),
      makeRule({
        id: "r2",
        color: "#4ec84e",
        conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
      }),
    ];

    expect(matchRule({}, FLAT_METRICS, rules)).toBe("#4ec84e");
    expect(matchRule({}, STEEP_METRICS, rules)).toBe("#cc4444");
  });

  it("returns null when no rule matches", () => {
    const rules: Rule[] = [
      makeRule({
        conditions: [{ field: "inclinationDeg", operator: ">", value: 80 }],
      }),
    ];

    expect(matchRule({}, FLAT_METRICS, rules)).toBeNull();
  });

  it("skips disabled rules", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r1",
        color: "#cc4444",
        enabled: false,
        conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
      }),
      makeRule({
        id: "r2",
        color: "#4ec84e",
        conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
      }),
    ];

    expect(matchRule({}, FLAT_METRICS, rules)).toBe("#4ec84e");
  });

  it("respects priority order (first match wins)", () => {
    const rules: Rule[] = [
      makeRule({ id: "r1", color: "#ff0000", conditions: [] }),
      makeRule({ id: "r2", color: "#00ff00", conditions: [] }),
    ];

    // Both match (empty conditions = vacuously true), first wins
    expect(matchRule({}, FLAT_METRICS, rules)).toBe("#ff0000");
  });
});
