/**
 * Zustand store for viewer selection state.
 *
 * Accessible from both React components (via hook) and imperative
 * Three.js code (via `selectionStore.getState()` / `.setState()`).
 */

import { create } from "zustand";
import type { PickMode, Selection } from "../../domain/selection/types";

export interface SelectionState {
  readonly mode: PickMode;
  readonly selection: Selection | null;
  readonly hovered: Selection | null;
}

export interface SelectionActions {
  select: (selection: Selection | null) => void;
  hover: (hovered: Selection | null) => void;
  setMode: (mode: PickMode) => void;
  clear: () => void;
}

export type SelectionStore = SelectionState & SelectionActions;

export const useSelectionStore = create<SelectionStore>((set) => ({
  mode: "object",
  selection: null,
  hovered: null,

  select: (selection) => set({ selection }),
  hover: (hovered) => set({ hovered }),
  setMode: (mode) => set({ mode, selection: null, hovered: null }),
  clear: () => set({ selection: null, hovered: null }),
}));
