/**
 * Zustand store for viewer selection state.
 *
 * Supports multi-select (Shift+click), tool modes (select, box-select, measure),
 * and hover. Accessible from both React components (via hook) and imperative
 * Three.js code (via `selectionStore.getState()` / `.setState()`).
 */

import { create } from "zustand";
import type {
  PickMode,
  ToolMode,
  Selection,
  GeoFeatureSelection,
} from "../../domain/selection/types";

export interface SelectionState {
  readonly mode: PickMode;
  readonly toolMode: ToolMode;
  readonly selections: ReadonlyArray<Selection>;
  readonly hovered: Selection | null;
  /**
   * The picked GeoJSON feature, if any. Mutually exclusive with
   * `selections`: selecting a city object clears it, and selecting a geo
   * feature clears the city selections.
   */
  readonly geoSelection: GeoFeatureSelection | null;
}

export interface SelectionActions {
  /** Replace all selections with a single item (normal click). */
  select: (selection: Selection | null) => void;
  /** Add or remove from selections (Shift+click). */
  toggleSelect: (selection: Selection) => void;
  /** Replace all selections with a batch (box select). */
  selectMany: (selections: Selection[]) => void;
  /** Replace the geo feature selection (clears city-object selections). */
  selectGeoFeature: (selection: GeoFeatureSelection | null) => void;
  hover: (hovered: Selection | null) => void;
  setMode: (mode: PickMode) => void;
  setToolMode: (toolMode: ToolMode) => void;
  clear: () => void;
}

export type SelectionStore = SelectionState & SelectionActions;

function selectionEquals(a: Selection, b: Selection): boolean {
  if (a.layerId !== b.layerId || a.objectId !== b.objectId) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "surface" && b.kind === "surface") {
    return a.surfaceIndex === b.surfaceIndex;
  }
  return true;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  mode: "object",
  toolMode: "select",
  selections: [],
  hovered: null,
  geoSelection: null,

  // A city pick — including a miss (`null`) — always ends any geo selection.
  select: (selection) =>
    set({ selections: selection ? [selection] : [], geoSelection: null }),

  toggleSelect: (selection) => {
    const { selections } = get();
    const idx = selections.findIndex((s) => selectionEquals(s, selection));
    if (idx >= 0) {
      set({
        selections: selections.filter((_, i) => i !== idx),
        geoSelection: null,
      });
    } else {
      // Only allow multi-select within the same layer
      const filtered = selections.filter(
        (s) => s.layerId === selection.layerId,
      );
      set({ selections: [...filtered, selection], geoSelection: null });
    }
  },

  selectMany: (selections) => {
    if (selections.length === 0) {
      set({ selections: [], geoSelection: null });
      return;
    }
    const layerId = selections[0]!.layerId;
    set({
      selections: selections.filter((s) => s.layerId === layerId),
      geoSelection: null,
    });
  },

  // Picking a geo feature ends any city selection; clearing it (`null`)
  // touches nothing else, so a city pick that follows one survives.
  selectGeoFeature: (selection) =>
    set(
      selection
        ? { geoSelection: selection, selections: [] }
        : { geoSelection: null },
    ),

  hover: (hovered) => set({ hovered }),

  // Switching pick mode CONVERTS what is selected; it never wipes it. Going
  // to "surface" keeps object selections as they are (there is no surface to
  // narrow them to, and picking one is the user's next act); going to
  // "object" collapses every surface pick to its owning object, deduplicated,
  // so two faces of one building read as one selected building. The geo
  // selection is untouched either way — pick mode is a city-object concept.
  setMode: (mode) =>
    set((state) => {
      if (mode === "surface") return { mode, hovered: null };
      const seen = new Set<string>();
      const narrowed: Selection[] = [];
      for (const s of state.selections) {
        const key = `${s.layerId} ${s.objectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        narrowed.push({
          kind: "object",
          layerId: s.layerId,
          objectId: s.objectId,
        });
      }
      return { mode, selections: narrowed, hovered: null };
    }),

  setToolMode: (toolMode) => set({ toolMode, hovered: null }),

  clear: () => set({ selections: [], hovered: null, geoSelection: null }),
}));
