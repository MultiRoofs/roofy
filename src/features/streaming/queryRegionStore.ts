/**
 * The React-visible mirror of "which bbox is each streaming layer fetching?".
 *
 * A SEPARATE store from `streamStore` for the same reason `streamStore` is
 * separate from `layerStore`: a query region changes on every settle, and the
 * consumers of `streamStore` (the layer panel, the inspector, the LoD
 * selector) have no interest in it. Writing it there would re-render all of
 * them on every camera stop for a readout only one small overlay shows.
 *
 * Nothing computes here. `NavaraViewport`'s query-box effect subscribes to
 * `FcbStreamLayerHandle.onQueryRegion` — the region the plugin's `probe`/
 * `fetch` messages actually carried — and mirrors it in. That is also why this
 * store is only ever POPULATED while the Advanced Settings toggle is on: with
 * the diagnostic off the effect does not subscribe at all, so neither the
 * outline nor this store costs anything.
 */
import { create } from "zustand";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";

export interface QueryRegionStoreState {
  /** Keyed by layer id. Empty whenever the diagnostic is off. */
  readonly regions: Readonly<Record<string, QueryRegion>>;
}

export interface QueryRegionStoreActions {
  setRegion: (region: QueryRegion) => void;
  /** Forget one layer — a stream closed, or its handle reported `null`. */
  clearRegion: (layerId: string) => void;
  /** Forget everything: the toggle went off, or the engine went away. */
  clear: () => void;
}

export type QueryRegionStore = QueryRegionStoreState & QueryRegionStoreActions;

export const useQueryRegionStore = create<QueryRegionStore>((set) => ({
  regions: {},

  setRegion: (region) =>
    set((s) => ({ regions: { ...s.regions, [region.layerId]: region } })),

  clearRegion: (layerId) =>
    set((s) => {
      // Identity-stable when there is nothing to remove, so an unregister for
      // a layer that never published cannot re-render the overlay.
      if (!(layerId in s.regions)) return s;
      const regions = { ...s.regions };
      delete regions[layerId];
      return { regions };
    }),

  clear: () =>
    set((s) => (Object.keys(s.regions).length === 0 ? s : { regions: {} })),
}));
