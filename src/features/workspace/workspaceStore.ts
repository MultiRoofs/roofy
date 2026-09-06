/**
 * The one "active layer" for the whole workspace: city model, streaming,
 * vector, raster or tiles. Every panel that concerns a layer (style, filter,
 * details, the data drawer, the legend heading) follows this id. Nothing
 * else holds an active id — layerStore and geoLayerStore no longer do.
 *
 * Not persisted here; the snapshot records it as an index (persistence v4).
 */
import { create } from "zustand";
import {
  useSelectionStore,
  type SelectionState,
} from "../selection/selectionStore";

/** The name shown for a workspace that has never been renamed. */
export const DEFAULT_WORKSPACE_NAME = "Untitled workspace";

export interface WorkspaceState {
  readonly activeLayerId: string | null;
  readonly name: string;
}

export interface WorkspaceActions {
  /**
   * Rule 1: activating a layer ends a selection that belongs to a DIFFERENT
   * one, so the inspector, the legend and the highlight can never disagree
   * about which layer is being looked at. Never moves the camera.
   *
   * The rule lives here, in the store's own action, rather than in a helper
   * beside it: every caller — the layer list, a pick, a restore, the
   * invariants reconciler — goes through this one function, so there is no
   * back door that writes the id without honouring it.
   */
  setActiveLayerId: (id: string | null) => void;
  /** Trims the given name; an empty (or all-whitespace) result falls back
   *  to {@link DEFAULT_WORKSPACE_NAME} rather than leaving the workspace
   *  unnamed. */
  setName: (name: string) => void;
  /** "New workspace" calls this to restore the default name. */
  resetName: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

/**
 * The layer that owns the current selection: a city selection's `layerId` or
 * a geo selection's `geoLayerId`, or `null` when nothing is selected.
 *
 * Defined here rather than in `layerCoordination.ts` because
 * {@link WorkspaceActions.setActiveLayerId} needs it and must not import that
 * module — `layerCoordination` imports this store, never the reverse.
 * Re-exported from there for callers.
 *
 * A multi-select only ever spans one layer (`selectionStore.toggleSelect`
 * filters foreign layers out), so the first entry answers for all of them.
 */
export function selectionLayerId(
  state: Pick<SelectionState, "selections" | "geoSelection">,
): string | null {
  if (state.selections.length > 0) return state.selections[0]!.layerId;
  return state.geoSelection?.geoLayerId ?? null;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeLayerId: null,
  name: DEFAULT_WORKSPACE_NAME,
  setActiveLayerId: (id) => {
    const owner = selectionLayerId(useSelectionStore.getState());
    if (owner !== null && owner !== id) useSelectionStore.getState().clear();
    set({ activeLayerId: id });
  },
  setName: (name) => {
    const trimmed = name.trim();
    set({ name: trimmed.length > 0 ? trimmed : DEFAULT_WORKSPACE_NAME });
  },
  resetName: () => set({ name: DEFAULT_WORKSPACE_NAME }),
}));
