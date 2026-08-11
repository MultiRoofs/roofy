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
import {
  DEFAULT_BASEMAP_ID,
  ELEVATION_HEATMAP_DEFAULTS,
  type BasemapId,
} from "../../scene/basemaps";

/**
 * The user-editable half of the elevation heatmap's ramp. `logBoundary` is
 * deliberately absent: it is an implementation detail of the log curve, and
 * the engine seam derives it from these three (clamped under `maxHeight`).
 */
export interface HeatmapSettings {
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly logarithmic: boolean;
}

export const HEATMAP_SETTINGS_DEFAULTS: HeatmapSettings = {
  minHeight: ELEVATION_HEATMAP_DEFAULTS.minHeight,
  maxHeight: ELEVATION_HEATMAP_DEFAULTS.maxHeight,
  logarithmic: ELEVATION_HEATMAP_DEFAULTS.logarithmic,
};

export interface BasemapState {
  readonly basemapId: BasemapId;
  readonly heatmap: HeatmapSettings;
}

export interface BasemapActions {
  setBasemapId: (id: BasemapId) => void;
  /**
   * Merge a partial edit into the heatmap settings, keeping them SANE rather
   * than trusting the inputs: non-finite numbers are dropped, and a range
   * where min ≥ max is refused wholesale (the engine's ramp has no meaning
   * for it, and half-applying an edit would leave the two inputs describing
   * a state the scene does not show).
   */
  setHeatmap: (patch: Partial<HeatmapSettings>) => void;
}

export type BasemapStore = BasemapState & BasemapActions;

export const useBasemapStore = create<BasemapStore>((set, get) => ({
  basemapId: DEFAULT_BASEMAP_ID,
  heatmap: HEATMAP_SETTINGS_DEFAULTS,

  setBasemapId: (basemapId) => set({ basemapId }),

  setHeatmap: (patch) => {
    const current = get().heatmap;
    const next: HeatmapSettings = {
      minHeight: Number.isFinite(patch.minHeight)
        ? (patch.minHeight as number)
        : current.minHeight,
      maxHeight: Number.isFinite(patch.maxHeight)
        ? (patch.maxHeight as number)
        : current.maxHeight,
      logarithmic: patch.logarithmic ?? current.logarithmic,
    };
    if (next.minHeight >= next.maxHeight) return;
    set({ heatmap: next });
  },
}));
