/**
 * Zustand store for colorization rules.
 *
 * Rules are evaluated in array order (first match wins).
 * Accessible from both React components and imperative scene code.
 */

import { create } from "zustand";
import type { Rule } from "./types";

export interface RuleStoreState {
  readonly rules: Rule[];
  /** Global toggle — when false, no rule colorization is applied. */
  readonly enabled: boolean;
}

export interface RuleStoreActions {
  addRule: (rule: Rule) => void;
  updateRule: (id: string, patch: Partial<Omit<Rule, "id">>) => void;
  deleteRule: (id: string) => void;
  reorderRules: (fromIdx: number, toIdx: number) => void;
  toggleEnabled: () => void;
  clearRules: () => void;
}

export type RuleStore = RuleStoreState & RuleStoreActions;

export const useRuleStore = create<RuleStore>((set) => ({
  rules: [],
  enabled: true,

  addRule: (rule) =>
    set((state) => ({ rules: [...state.rules, rule] })),

  updateRule: (id, patch) =>
    set((state) => ({
      rules: state.rules.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    })),

  deleteRule: (id) =>
    set((state) => ({
      rules: state.rules.filter((r) => r.id !== id),
    })),

  reorderRules: (fromIdx, toIdx) =>
    set((state) => {
      const rules = [...state.rules];
      const [moved] = rules.splice(fromIdx, 1);
      if (moved) rules.splice(toIdx, 0, moved);
      return { rules };
    }),

  toggleEnabled: () =>
    set((state) => ({ enabled: !state.enabled })),

  clearRules: () =>
    set({ rules: [] }),
}));
