import { create } from "zustand";
/** Matching stable feature ids per vector layer; null means no active filter. */
export const useGeoFeatureVisibilityStore = create<{
  readonly visible: Readonly<Record<string, ReadonlySet<string> | null>>;
  setVisible: (layerId: string, ids: ReadonlySet<string> | null) => void;
}>((set) => ({
  visible: {},
  setVisible: (layerId, ids) =>
    set((state) => ({ visible: { ...state.visible, [layerId]: ids } })),
}));
