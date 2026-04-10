/**
 * Zustand store for Google Photorealistic 3D Tiles settings.
 *
 * Controls whether the background 3D tiles layer is visible.
 * Separate from layerStore (tiles are a built-in background,
 * not a user-loaded CityJSON layer).
 */

import { create } from "zustand";

export interface TilesState {
  readonly enabled: boolean;
}

export interface TilesActions {
  setEnabled: (v: boolean) => void;
}

export type TilesStore = TilesState & TilesActions;

export const useTilesStore = create<TilesStore>((set) => ({
  enabled: false,

  setEnabled: (v) => set({ enabled: v }),
}));
