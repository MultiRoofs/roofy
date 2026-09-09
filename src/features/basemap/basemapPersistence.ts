import { BASEMAPS, DEFAULT_BASEMAP_ID } from "../../scene/basemaps";
import { customBasemapOption } from "./customBasemap";
import {
  HEATMAP_SETTINGS_DEFAULTS,
  useBasemapStore,
  type BasemapState,
} from "./basemapStore";
export function captureBasemap(): BasemapState {
  const { basemapId, custom, heatmap } = useBasemapStore.getState();
  return { basemapId, custom, heatmap };
}
export function restoreBasemap(value: unknown): void {
  const state =
    value && typeof value === "object" ? (value as Partial<BasemapState>) : {};
  const custom = customBasemapOption(state.custom) ? state.custom! : null;
  const basemapId =
    state.basemapId === "custom" && custom
      ? "custom"
      : BASEMAPS.some((b) => b.id === state.basemapId)
        ? state.basemapId!
        : DEFAULT_BASEMAP_ID;
  useBasemapStore.setState({
    basemapId,
    custom,
    heatmap: HEATMAP_SETTINGS_DEFAULTS,
  });
  if (state.heatmap && typeof state.heatmap === "object")
    useBasemapStore.getState().setHeatmap({
      ...state.heatmap,
      logarithmic:
        typeof state.heatmap.logarithmic === "boolean"
          ? state.heatmap.logarithmic
          : HEATMAP_SETTINGS_DEFAULTS.logarithmic,
    });
}
