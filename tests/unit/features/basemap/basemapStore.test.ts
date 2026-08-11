import { afterEach, describe, expect, it } from "vitest";
import {
  HEATMAP_SETTINGS_DEFAULTS,
  useBasemapStore,
} from "../../../../src/features/basemap/basemapStore";
import {
  DEFAULT_BASEMAP_ID,
  ELEVATION_HEATMAP_DEFAULTS,
} from "../../../../src/scene/basemaps";

afterEach(() => {
  useBasemapStore.setState({
    basemapId: DEFAULT_BASEMAP_ID,
    heatmap: HEATMAP_SETTINGS_DEFAULTS,
  });
});

describe("basemapStore heatmap settings", () => {
  it("seeds from the catalogue's heatmap defaults", () => {
    const { heatmap } = useBasemapStore.getState();
    expect(heatmap.minHeight).toBe(ELEVATION_HEATMAP_DEFAULTS.minHeight);
    expect(heatmap.maxHeight).toBe(ELEVATION_HEATMAP_DEFAULTS.maxHeight);
    expect(heatmap.logarithmic).toBe(ELEVATION_HEATMAP_DEFAULTS.logarithmic);
  });

  it("merges a partial edit over the current settings", () => {
    useBasemapStore.getState().setHeatmap({ maxHeight: 40 });
    const { heatmap } = useBasemapStore.getState();
    expect(heatmap.maxHeight).toBe(40);
    expect(heatmap.minHeight).toBe(HEATMAP_SETTINGS_DEFAULTS.minHeight);
    expect(heatmap.logarithmic).toBe(HEATMAP_SETTINGS_DEFAULTS.logarithmic);
  });

  it("refuses a range where min is not below max", () => {
    useBasemapStore.getState().setHeatmap({ minHeight: 5000 });
    expect(useBasemapStore.getState().heatmap).toEqual(
      HEATMAP_SETTINGS_DEFAULTS,
    );
    useBasemapStore.getState().setHeatmap({ minHeight: 10, maxHeight: 10 });
    expect(useBasemapStore.getState().heatmap).toEqual(
      HEATMAP_SETTINGS_DEFAULTS,
    );
  });

  it("drops non-finite numbers instead of applying them", () => {
    useBasemapStore.getState().setHeatmap({ maxHeight: Number.NaN });
    expect(useBasemapStore.getState().heatmap.maxHeight).toBe(
      HEATMAP_SETTINGS_DEFAULTS.maxHeight,
    );
    useBasemapStore
      .getState()
      .setHeatmap({ minHeight: Number.POSITIVE_INFINITY });
    expect(useBasemapStore.getState().heatmap.minHeight).toBe(
      HEATMAP_SETTINGS_DEFAULTS.minHeight,
    );
  });

  it("toggles the log scale independently of the range", () => {
    useBasemapStore.getState().setHeatmap({ logarithmic: false });
    const { heatmap } = useBasemapStore.getState();
    expect(heatmap.logarithmic).toBe(false);
    expect(heatmap.minHeight).toBe(HEATMAP_SETTINGS_DEFAULTS.minHeight);
    expect(heatmap.maxHeight).toBe(HEATMAP_SETTINGS_DEFAULTS.maxHeight);
  });
});
