import { describe, it, expect, beforeEach } from "vitest";
import { useRuleStore } from "../../../../src/features/rules/ruleStore";
import type { Rule } from "../../../../src/features/rules/types";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: crypto.randomUUID(),
    name: "Test",
    color: "#4ec84e",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

describe("ruleStore", () => {
  beforeEach(() => {
    useRuleStore.setState({ rules: [], enabled: true });
  });

  describe("addRule", () => {
    it("appends a rule", () => {
      const rule = makeRule({ name: "A" });
      useRuleStore.getState().addRule(rule);

      expect(useRuleStore.getState().rules).toHaveLength(1);
      expect(useRuleStore.getState().rules[0]!.name).toBe("A");
    });
  });

  describe("updateRule", () => {
    it("patches a rule by id", () => {
      const rule = makeRule({ name: "A" });
      useRuleStore.setState({ rules: [rule] });

      useRuleStore.getState().updateRule(rule.id, { name: "B" });

      expect(useRuleStore.getState().rules[0]!.name).toBe("B");
    });

    it("leaves other rules unchanged", () => {
      const r1 = makeRule({ name: "A" });
      const r2 = makeRule({ name: "B" });
      useRuleStore.setState({ rules: [r1, r2] });

      useRuleStore.getState().updateRule(r1.id, { name: "A2" });

      expect(useRuleStore.getState().rules[1]!.name).toBe("B");
    });
  });

  describe("deleteRule", () => {
    it("removes a rule by id", () => {
      const r1 = makeRule({ name: "A" });
      const r2 = makeRule({ name: "B" });
      useRuleStore.setState({ rules: [r1, r2] });

      useRuleStore.getState().deleteRule(r1.id);

      expect(useRuleStore.getState().rules).toHaveLength(1);
      expect(useRuleStore.getState().rules[0]!.name).toBe("B");
    });
  });

  describe("reorderRules", () => {
    it("moves a rule from one position to another", () => {
      const r1 = makeRule({ name: "A" });
      const r2 = makeRule({ name: "B" });
      const r3 = makeRule({ name: "C" });
      useRuleStore.setState({ rules: [r1, r2, r3] });

      useRuleStore.getState().reorderRules(0, 2);

      const names = useRuleStore.getState().rules.map((r) => r.name);
      expect(names).toEqual(["B", "C", "A"]);
    });

    it("is a no-op when from equals to", () => {
      const r1 = makeRule({ name: "A" });
      const r2 = makeRule({ name: "B" });
      useRuleStore.setState({ rules: [r1, r2] });

      useRuleStore.getState().reorderRules(0, 0);

      const names = useRuleStore.getState().rules.map((r) => r.name);
      expect(names).toEqual(["A", "B"]);
    });
  });

  describe("toggleEnabled", () => {
    it("toggles the enabled flag", () => {
      expect(useRuleStore.getState().enabled).toBe(true);

      useRuleStore.getState().toggleEnabled();
      expect(useRuleStore.getState().enabled).toBe(false);

      useRuleStore.getState().toggleEnabled();
      expect(useRuleStore.getState().enabled).toBe(true);
    });
  });

  describe("clearRules", () => {
    it("removes all rules", () => {
      useRuleStore.setState({ rules: [makeRule(), makeRule()] });

      useRuleStore.getState().clearRules();

      expect(useRuleStore.getState().rules).toHaveLength(0);
    });
  });
});
