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
  /**
   * How many times the SELECTION has been set — a pick counter, bumped by
   * every action that chooses what is selected (`select`, `toggleSelect`,
   * `selectMany`, `selectGeoFeature`, `clear`) and by NOTHING else.
   *
   * It exists because a subscriber cannot otherwise tell a pick from the other
   * writes this store carries: `hover` fires on every mouse move, `setToolMode`
   * and `setMode` fire on a toolbar click, and `setMode("object")` even
   * REBUILDS the selections array (it narrows surface picks to their objects),
   * so neither the state's identity nor the selected ids answer the question.
   * `layerCoordination`'s rule 2 — "a pick activates the layer it landed on" —
   * compares this and only this, which is what lets a user re-pick the
   * building they already had selected and be taken back to its layer (gate
   * defect F5, round 3) without a hover doing the same thing.
   *
   * Monotonic within a session and never read as an identity: the only
   * question asked of it is "is this a later pick than the one I saw?".
   */
  readonly selectionVersion: number;
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
  selectionVersion: 0,

  // A city pick — including a miss (`null`) — always ends any geo selection.
  select: (selection) =>
    set((state) => ({
      selections: selection ? [selection] : [],
      geoSelection: null,
      selectionVersion: state.selectionVersion + 1,
    })),

  toggleSelect: (selection) => {
    const { selections } = get();
    const idx = selections.findIndex((s) => selectionEquals(s, selection));
    const version = get().selectionVersion + 1;
    if (idx >= 0) {
      set({
        selections: selections.filter((_, i) => i !== idx),
        geoSelection: null,
        selectionVersion: version,
      });
    } else {
      // Only allow multi-select within the same layer
      const filtered = selections.filter(
        (s) => s.layerId === selection.layerId,
      );
      set({
        selections: [...filtered, selection],
        geoSelection: null,
        selectionVersion: version,
      });
    }
  },

  selectMany: (selections) => {
    const version = get().selectionVersion + 1;
    if (selections.length === 0) {
      set({ selections: [], geoSelection: null, selectionVersion: version });
      return;
    }
    const layerId = selections[0]!.layerId;
    set({
      selections: selections.filter((s) => s.layerId === layerId),
      geoSelection: null,
      selectionVersion: version,
    });
  },

  // Picking a geo feature ends any city selection; clearing it (`null`)
  // touches nothing else, so a city pick that follows one survives.
  selectGeoFeature: (selection) =>
    set((state) => ({
      ...(selection
        ? { geoSelection: selection, selections: [] }
        : { geoSelection: null }),
      selectionVersion: state.selectionVersion + 1,
    })),

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

  clear: () =>
    set((state) => ({
      selections: [],
      hovered: null,
      geoSelection: null,
      selectionVersion: state.selectionVersion + 1,
    })),
}));
