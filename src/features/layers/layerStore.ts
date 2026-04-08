/**
 * Zustand store for the layer system.
 *
 * Each layer holds a CityModel, its source reference, visibility,
 * and per-layer colorization rules. Replaces the global useRuleStore.
 */

import { create } from "zustand";
import type { CityModel } from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type { Rule } from "../rules/types";

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible: boolean;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
}

export interface LayerStoreState {
  readonly layers: ReadonlyArray<Layer>;
  readonly activeLayerId: string | null;
}

export interface LayerStoreActions {
  addLayer: (layer: Omit<Layer, "id">) => string;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<Pick<Layer, "name" | "visible">>,
  ) => void;
  setActiveLayer: (id: string | null) => void;
  removeAllLayers: () => void;

  // Per-layer rule actions
  addRule: (layerId: string, rule: Rule) => void;
  updateRule: (
    layerId: string,
    ruleId: string,
    patch: Partial<Omit<Rule, "id">>,
  ) => void;
  deleteRule: (layerId: string, ruleId: string) => void;
  reorderRules: (layerId: string, fromIdx: number, toIdx: number) => void;
  toggleRulesEnabled: (layerId: string) => void;
  clearRules: (layerId: string) => void;
}

export type LayerStore = LayerStoreState & LayerStoreActions;

export const useLayerStore = create<LayerStore>((set) => ({
  layers: [],
  activeLayerId: null,

  addLayer: (input) => {
    const id = crypto.randomUUID();
    set((state) => ({
      layers: [...state.layers, { ...input, id }],
      activeLayerId: state.activeLayerId ?? id,
    }));
    return id;
  },

  removeLayer: (id) =>
    set((state) => {
      const layers = state.layers.filter((l) => l.id !== id);
      const activeLayerId =
        state.activeLayerId === id
          ? (layers[layers.length - 1]?.id ?? null)
          : state.activeLayerId;
      return { layers, activeLayerId };
    }),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  setActiveLayer: (id) => set({ activeLayerId: id }),

  removeAllLayers: () => set({ layers: [], activeLayerId: null }),

  // --- Per-layer rule actions ---

  addRule: (layerId, rule) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rules: [...l.rules, rule] } : l,
      ),
    })),

  updateRule: (layerId, ruleId, patch) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              rules: l.rules.map((r) =>
                r.id === ruleId ? { ...r, ...patch } : r,
              ),
            }
          : l,
      ),
    })),

  deleteRule: (layerId, ruleId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId
          ? { ...l, rules: l.rules.filter((r) => r.id !== ruleId) }
          : l,
      ),
    })),

  reorderRules: (layerId, fromIdx, toIdx) =>
    set((state) => ({
      layers: state.layers.map((l) => {
        if (l.id !== layerId) return l;
        const rules = [...l.rules];
        const [moved] = rules.splice(fromIdx, 1);
        if (moved) rules.splice(toIdx, 0, moved);
        return { ...l, rules };
      }),
    })),

  toggleRulesEnabled: (layerId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rulesEnabled: !l.rulesEnabled } : l,
      ),
    })),

  clearRules: (layerId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rules: [] } : l,
      ),
    })),
}));
