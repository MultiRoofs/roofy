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
} from "../../domain/selection/types";

export interface SelectionState {
  readonly mode: PickMode;
  readonly toolMode: ToolMode;
  readonly selections: ReadonlyArray<Selection>;
  readonly hovered: Selection | null;
}

export interface SelectionActions {
  /** Replace all selections with a single item (normal click). */
  select: (selection: Selection | null) => void;
  /** Add or remove from selections (Shift+click). */
  toggleSelect: (selection: Selection) => void;
  /** Replace all selections with a batch (box select). */
  selectMany: (selections: Selection[]) => void;
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

  select: (selection) => set({ selections: selection ? [selection] : [] }),

  toggleSelect: (selection) => {
    const { selections } = get();
    const idx = selections.findIndex((s) => selectionEquals(s, selection));
    if (idx >= 0) {
      set({ selections: selections.filter((_, i) => i !== idx) });
    } else {
      // Only allow multi-select within the same layer
      const filtered = selections.filter(
        (s) => s.layerId === selection.layerId,
      );
      set({ selections: [...filtered, selection] });
    }
  },

  selectMany: (selections) => {
    if (selections.length === 0) {
      set({ selections: [] });
      return;
    }
    const layerId = selections[0]!.layerId;
    set({ selections: selections.filter((s) => s.layerId === layerId) });
  },

  hover: (hovered) => set({ hovered }),

  setMode: (mode) => set({ mode, selections: [], hovered: null }),

  setToolMode: (toolMode) => set({ toolMode, hovered: null }),

  clear: () => set({ selections: [], hovered: null }),
}));
