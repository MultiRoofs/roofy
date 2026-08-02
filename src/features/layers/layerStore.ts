/**
 * Zustand store for the layer system.
 *
 * Each layer holds a CityModel, its source reference, visibility,
 * per-layer colorization rules, and LoD selection.
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
  readonly selectedLod: string | null;
  readonly availableLods: ReadonlyArray<string>;
  /** "auto": the viewport-streaming driver (Task 14) picks the LoD ladder
   *  rung from zoom level. "manual": the user's `selectedLod` choice pins
   *  it, same as a non-streaming layer. Defaults to "auto" so a freshly
   *  loaded streaming layer follows zoom without extra user action. */
  readonly lodMode: "auto" | "manual";
  /** True once a layer's stream has been opened and admitted (Task 8's
   *  `checkAdmission`) for viewport streaming, i.e. it has per-cell state
   *  in `useStreamStore` rather than one resident `model`. Defaults to
   *  false: every layer starts as a plain, fully-resident layer. */
  readonly isStreaming: boolean;
}

export interface LayerStoreState {
  readonly layers: ReadonlyArray<Layer>;
  readonly activeLayerId: string | null;
}

export interface LayerStoreActions {
  addLayer: (
    layer: Omit<
      Layer,
      "id" | "selectedLod" | "availableLods" | "lodMode" | "isStreaming"
    > & {
      /** Defaults to a fresh UUID. Supplied only by `openStreamingLayer`,
       *  where the plugin has already registered its handle under an id it
       *  minted first — the layer and the handle must share one id or every
       *  `plugin.getHandle(layer.id)` lookup misses. */
      readonly id?: string;
      /** Defaults to false. Set true for a layer opened via viewport
       *  streaming (Task 17's `openStreamingLayer`) — its `model` is a stub
       *  (bbox only, empty objects) rather than a fully-parsed model. */
      readonly isStreaming?: boolean;
    },
  ) => string;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<Pick<Layer, "name" | "visible">>,
  ) => void;
  setActiveLayer: (id: string | null) => void;
  removeAllLayers: () => void;
  setLayerLod: (layerId: string, lod: string | null) => void;
  setLodMode: (layerId: string, mode: "auto" | "manual") => void;

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

/**
 * Collect unique LoD values from all surfaces in a model,
 * sorted numerically descending (highest first).
 */
export function computeAvailableLods(model: CityModel): string[] {
  const set = new Set<string>();
  for (const obj of Object.values(model.objects)) {
    for (const surface of obj?.surfaces ?? []) {
      if (surface.lod) set.add(surface.lod);
    }
  }
  return [...set].sort((a, b) => parseFloat(b) - parseFloat(a));
}

export const useLayerStore = create<LayerStore>((set) => ({
  layers: [],
  activeLayerId: null,

  addLayer: (input) => {
    const id = input.id ?? crypto.randomUUID();
    const availableLods = computeAvailableLods(input.model);
    const selectedLod = availableLods[0] ?? null;
    set((state) => ({
      layers: [
        ...state.layers,
        {
          ...input,
          id,
          selectedLod,
          availableLods,
          lodMode: "auto",
          isStreaming: input.isStreaming ?? false,
        },
      ],
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

  setLayerLod: (layerId, lod) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, selectedLod: lod } : l,
      ),
    })),

  setLodMode: (layerId, mode) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, lodMode: mode } : l,
      ),
    })),

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
