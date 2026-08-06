/**
 * Which camera policy the viewer is in: 2D (plan), 2.5D (fixed oblique) or 3D
 * (free).
 *
 * A store rather than a prop, for the same reason `tilesStore` is one: the mode
 * is set from the toolbar, read by the viewport (to drive the engine's
 * controller flags and the entry flight) and read again by two overlays (the
 * tilt buttons, the view-align cluster) that are nowhere near either. What a
 * mode MEANS is not here but in `scene/viewModePolicy.ts` — engine-free, so the
 * viewport and the UI share one table instead of each re-deciding what "2D"
 * forbids.
 */
import { create } from "zustand";

export type ViewMode = "2d" | "2.5d" | "3d";

/** Every mode, flattest first — the order the toolbar's segmented control
 *  renders them in, so the UI never re-lists them. */
export const VIEW_MODES: readonly ViewMode[] = ["2d", "2.5d", "3d"];

/** Free camera: what the viewer did before modes existed, and what a 3D city
 *  viewer should open in. */
export const DEFAULT_VIEW_MODE: ViewMode = "3d";

export interface ViewModeState {
  readonly mode: ViewMode;
}

export interface ViewModeActions {
  setViewMode: (mode: ViewMode) => void;
}

export type ViewModeStore = ViewModeState & ViewModeActions;

export const useViewModeStore = create<ViewModeStore>((set) => ({
  mode: DEFAULT_VIEW_MODE,

  // No-op when the mode is already the one asked for: entering a mode FLIES the
  // camera, and a redundant set (a restore writing back what is already there,
  // a double click on the active segment) must not move it.
  setViewMode: (mode) =>
    set((state) => (state.mode === mode ? state : { mode })),
}));
