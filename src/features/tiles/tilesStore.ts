/**
 * Zustand store for Google Photorealistic 3D Tiles settings.
 *
 * Controls whether the background 3D tiles layer is in the scene. Separate from
 * layerStore (tiles are a built-in background, not a user-loaded CityJSON
 * layer). `NavaraViewport` reads `enabled` and adds/removes the engine's
 * `3d-tiles` source+layer pair to match it (Task C21) — between Task C17 and
 * C21 this flag was read only by the two toggle UIs and had no effect at all.
 *
 * Default `true`, not `false`: the viewport added the tiles unconditionally
 * before the flag was wired up, so `true` is the behaviour users have, and it
 * is the only value that makes the sidebar's eye icon tell the truth on first
 * paint. With no `VITE_GOOGLE_MAPS_API_KEY` nothing is added regardless, and
 * both toggle UIs disable themselves.
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
  enabled: true,

  setEnabled: (v) => set({ enabled: v }),
}));
