/**
 * Zustand store for the selected basemap.
 *
 * Deliberately shaped like `tilesStore`: one piece of state that
 * `NavaraViewport` mirrors into an engine source + layer pair, written by the
 * sidebar's basemap picker (its one UI since the Rendering panel shed its
 * Backdrop section).
 *
 * Defaults to `DEFAULT_BASEMAP_ID` (OpenStreetMap) rather than `"none"`,
 * because Navara's default photoreal scene adds no imagery of its own — see
 * `src/scene/basemaps.ts` — and a black globe on first paint reads as a broken
 * viewer, not as a deliberate choice.
 */

import { create } from "zustand";
import { DEFAULT_BASEMAP_ID, type BasemapId } from "../../scene/basemaps";

export interface BasemapState {
  readonly basemapId: BasemapId;
}

export interface BasemapActions {
  setBasemapId: (id: BasemapId) => void;
}

export type BasemapStore = BasemapState & BasemapActions;

export const useBasemapStore = create<BasemapStore>((set) => ({
  basemapId: DEFAULT_BASEMAP_ID,

  setBasemapId: (basemapId) => set({ basemapId }),
}));
