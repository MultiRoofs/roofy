/**
 * The one "active layer" for the whole workspace: city model, streaming,
 * vector, raster or tiles. Every panel that concerns a layer (style, filter,
 * details, the data drawer, the legend heading) follows this id. Nothing
 * else holds an active id — layerStore and geoLayerStore no longer do.
 *
 * Not persisted here; the snapshot records it as an index (persistence v4).
 */
import { create } from "zustand";

export interface WorkspaceState {
  readonly activeLayerId: string | null;
}

export interface WorkspaceActions {
  setActiveLayerId: (id: string | null) => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeLayerId: null,
  setActiveLayerId: (id) => set({ activeLayerId: id }),
}));
