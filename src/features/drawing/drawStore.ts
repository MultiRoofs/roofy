import { useWorkspaceStore } from "../workspace/workspaceStore";
import { useSelectionStore } from "../selection/selectionStore";
import { create } from "zustand";
import { useGeoLayerStore } from "../geoLayers/geoLayerStore";
import { activateLayer } from "../workspace/layerCoordination";
export const useDrawStore = create<{
  layerId: string | null;
  active: boolean;
  create: () => void;
  start: () => void;
  stop: () => void;
  finish: () => void;
}>((set, get) => ({
  layerId: null,
  active: false,
  create: () => {
    if (
      useGeoLayerStore.getState().layers.some((l) => l.id === get().layerId)
    ) {
      activateLayer(get().layerId!);
      get().start();
      return;
    }
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "Draw layer",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    set({ layerId: id, active: false });
    activateLayer(id);
    get().start();
  },
  start: () => {
    const id = get().layerId;
    if (
      !id ||
      useWorkspaceStore.getState().activeLayerId !== id ||
      !useGeoLayerStore.getState().layers.some((l) => l.id === id)
    )
      return;
    useSelectionStore.setState({ hovered: null });
    set({ active: true });
  },
  stop: () => set({ active: false }),
  finish: () => set({ active: false, layerId: null }),
}));

// Layer selection changes end drawing immediately, including switches outside React.
useWorkspaceStore.subscribe((state) => {
  const drawing = useDrawStore.getState();
  if (drawing.active && state.activeLayerId !== drawing.layerId) drawing.stop();
});
