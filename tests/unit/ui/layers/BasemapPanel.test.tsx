import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { BasemapPanel } from "../../../../src/ui/layers/BasemapPanel";
import {
  HEATMAP_SETTINGS_DEFAULTS,
  useBasemapStore,
} from "../../../../src/features/basemap/basemapStore";
import { BASEMAPS, DEFAULT_BASEMAP_ID } from "../../../../src/scene/basemaps";

afterEach(() => {
  cleanup();
  useBasemapStore.setState({
    basemapId: DEFAULT_BASEMAP_ID,
    heatmap: HEATMAP_SETTINGS_DEFAULTS,
  });
});

describe("BasemapPanel", () => {
  it("lists every catalogue option and selects the store's current one", () => {
    render(<BasemapPanel />);
    const select = screen.getByLabelText("Basemap") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(
      BASEMAPS.filter((b) => !b.hidden).map((b) => b.id),
    );
    expect([...select.options].map((o) => o.textContent)).toEqual(
      BASEMAPS.filter((b) => !b.hidden).map((b) => b.label),
    );
    expect(select.value).toBe(DEFAULT_BASEMAP_ID);
  });

  it("writes the picked option to the store", () => {
    render(<BasemapPanel />);
    fireEvent.change(screen.getByLabelText("Basemap"), {
      target: { value: "esri-imagery" },
    });
    expect(useBasemapStore.getState().basemapId).toBe("esri-imagery");
  });

  it("follows a change made elsewhere (the advanced-settings panel)", () => {
    render(<BasemapPanel />);
    act(() => useBasemapStore.setState({ basemapId: "none" }));
    expect((screen.getByLabelText("Basemap") as HTMLSelectElement).value).toBe(
      "none",
    );
  });

  it("offers the Ramp button only while the elevation heatmap is selected", () => {
    render(<BasemapPanel />);
    // The default (imagery) basemap has no ramp to configure.
    expect(screen.queryByLabelText("Configure elevation ramp")).toBeNull();
    act(() => useBasemapStore.setState({ basemapId: "elevation-heatmap" }));
    expect(screen.getByLabelText("Configure elevation ramp")).toBeTruthy();
  });

  it("commits min/max edits on blur and refuses an inverted range", () => {
    render(<BasemapPanel />);
    act(() => useBasemapStore.setState({ basemapId: "elevation-heatmap" }));
    fireEvent.click(screen.getByLabelText("Configure elevation ramp"));

    const max = screen.getByLabelText("Heatmap maximum height");
    fireEvent.change(max, { target: { value: "40" } });
    // Typing alone must not touch the store — the commit is the blur.
    expect(useBasemapStore.getState().heatmap.maxHeight).toBe(
      HEATMAP_SETTINGS_DEFAULTS.maxHeight,
    );
    fireEvent.blur(max);
    expect(useBasemapStore.getState().heatmap.maxHeight).toBe(40);

    // min ≥ max is refused, and the draft snaps back to the store's value.
    const min = screen.getByLabelText("Heatmap minimum height");
    fireEvent.change(min, { target: { value: "40" } });
    fireEvent.blur(min);
    expect(useBasemapStore.getState().heatmap.minHeight).toBe(
      HEATMAP_SETTINGS_DEFAULTS.minHeight,
    );
    expect((min as HTMLInputElement).value).toBe(
      String(HEATMAP_SETTINGS_DEFAULTS.minHeight),
    );
  });

  it("writes the log-scale toggle immediately", () => {
    render(<BasemapPanel />);
    act(() => useBasemapStore.setState({ basemapId: "elevation-heatmap" }));
    fireEvent.click(screen.getByLabelText("Configure elevation ramp"));
    fireEvent.click(screen.getByLabelText("Heatmap logarithmic scale"));
    expect(useBasemapStore.getState().heatmap.logarithmic).toBe(
      !HEATMAP_SETTINGS_DEFAULTS.logarithmic,
    );
  });
});
