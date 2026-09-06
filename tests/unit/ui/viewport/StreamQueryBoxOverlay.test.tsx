/**
 * The fetch-bbox readout overlay: shows the numbers behind the ground outline,
 * and shows nothing at all when the diagnostic is off.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";
import { StreamQueryBoxOverlay } from "../../../../src/ui/viewport/StreamQueryBoxOverlay";
import { useQueryRegionStore } from "../../../../src/features/streaming/queryRegionStore";
import { useRenderDebugStore } from "../../../../src/features/debug/renderDebugStore";
import {
  useLayerStore,
  type Layer,
} from "../../../../src/features/layers/layerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

function region(layerId: string, minX = 84000): QueryRegion {
  return {
    layerId,
    bbox: [minX, 445000, minX + 2500, 446500],
    epsg: 7415,
    span: 2500,
    heightM: 43.2,
    ring: [
      [4.35, 52],
      [4.36, 52],
      [4.36, 52.01],
      [4.35, 52.01],
    ],
  };
}

describe("StreamQueryBoxOverlay", () => {
  beforeEach(() => {
    useQueryRegionStore.setState({ regions: {} });
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(false);
  });
  afterEach(() => {
    cleanup();
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(false);
  });

  it("renders nothing while the diagnostic is off, even with a region published", () => {
    useQueryRegionStore.getState().setRegion(region("delft.fcb"));
    render(<StreamQueryBoxOverlay />);
    expect(screen.queryByTestId("query-box-overlay")).toBeNull();
  });

  it("renders nothing when no streaming layer has queried yet", () => {
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    render(<StreamQueryBoxOverlay />);
    expect(screen.queryByTestId("query-box-overlay")).toBeNull();
  });

  it("names the layer rather than printing its UUID", () => {
    // Browser-verified regression: `QueryRegion.layerId` is the layer store's
    // id (a UUID), and the plugin has no notion of a display name.
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useLayerStore.setState({
      layers: [{ id: "uuid-1", name: "delft.fcb", isStreaming: true } as Layer],
    });
    useQueryRegionStore.getState().setRegion(region("uuid-1"));
    render(<StreamQueryBoxOverlay />);

    expect(screen.getByText("delft.fcb")).toBeTruthy();
    expect(screen.queryByText("uuid-1")).toBeNull();
  });

  it("falls back to the layer id when its layer has already left the store", () => {
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useQueryRegionStore.getState().setRegion(region("uuid-gone"));
    render(<StreamQueryBoxOverlay />);
    expect(screen.getByText("uuid-gone")).toBeTruthy();
  });

  it("prints the CRS, the extent and both axes of the queried bbox", () => {
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useQueryRegionStore.getState().setRegion(region("delft.fcb"));
    render(<StreamQueryBoxOverlay />);

    expect(screen.getByTestId("query-box-overlay")).toBeTruthy();
    expect(screen.getByText("delft.fcb")).toBeTruthy();
    expect(screen.getByText("EPSG:7415")).toBeTruthy();
    expect(screen.getByText("2,500 m × 1,500 m")).toBeTruthy();
    expect(screen.getByText("84000.0 → 86500.0")).toBeTruthy();
    expect(screen.getByText("445000.0 → 446500.0")).toBeTruthy();
  });

  it("lists one block per streaming layer", () => {
    // A workspace can stream several .fcb files at once, which is exactly why
    // this is a viewport overlay rather than a single status-bar slot.
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useQueryRegionStore.getState().setRegion(region("a.fcb"));
    useQueryRegionStore.getState().setRegion(region("b.fcb", 90000));
    render(<StreamQueryBoxOverlay />);
    expect(screen.getByText("a.fcb")).toBeTruthy();
    expect(screen.getByText("b.fcb")).toBeTruthy();
    expect(screen.getByText("90000.0 → 92500.0")).toBeTruthy();
  });
});
