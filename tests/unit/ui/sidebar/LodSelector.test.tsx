/**
 * Component tests for LodSelector's static-vs-streaming and auto-vs-manual
 * branching.
 *
 * The key correctness risk this file guards against: `Layer.lodMode`
 * defaults to `"auto"` for EVERY layer, streaming or not (layerStore.ts's
 * `addLayer`). If the auto-mode-disables-the-dropdown behaviour weren't
 * gated on `isStreaming`, every existing static layer's LoD selector would
 * silently become a non-interactive read-out — `lodMode` has no effect on
 * static rendering (`handleSync` only ever pushes `selectedLod`), so
 * that would be a functional regression for the overwhelming majority of
 * layers today. The first describe block below proves that does NOT
 * happen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LodSelector } from "../../../../src/ui/sidebar/LodSelector";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { StreamState } from "../../../../src/features/streaming/streamStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useStreamStore.setState({ streams: {} });
});

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function baseLayer(overrides: Partial<Layer>): Layer {
  return {
    id: "L",
    name: "test layer",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    // Defaults, like every other field of this fixture: a layer with no
    // rules colours by surface type. A case that needs a mode sets one.
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    derivedFrom: null,
    isStreaming: false,
    ...overrides,
  };
}

// rootCell 800, level 3 -> cellSize 100m (< 200, so lodForCellSize picks the
// LAST/highest-detail rung of the ladder — see the plugin's levelPolicy.ts).
function baseStream(overrides: Partial<StreamState> = {}): StreamState {
  return {
    // The handle is never touched by this component — it reads the store's
    // mirrored level/grid/ladder only — so it is the one field cast here.
    handle: {} as never,
    disposers: [],
    header: {} as never,
    grid: { originX: 0, originY: 0, rootCell: 800, maxLevel: 5 },
    level: 3,
    ladder: ["1.2", "2.2"],
    ladderVersion: 1,
    types: [],
    typesVersion: 0,
    appearanceThemes: [],
    status: "idle",
    message: null,
    version: 1,
    ...overrides,
  };
}

describe("LodSelector — static layer (isStreaming: false)", () => {
  it("renders an interactive dropdown even though lodMode defaults to 'auto'", () => {
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod="2.2"
        isStreaming={false}
        lodMode="auto"
      />,
    );
    const select = screen.getByTitle("Level of Detail") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("2.2");
    expect(select).not.toBeDisabled();
  });

  it("changing the selection calls setLayerLod, same as before streaming existed", () => {
    useLayerStore.setState({
      layers: [baseLayer({ availableLods: ["1.2", "2.2"] })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod="1.2"
        isStreaming={false}
        lodMode="auto"
      />,
    );
    fireEvent.change(screen.getByTitle("Level of Detail"), {
      target: { value: "2.2" },
    });
    expect(useLayerStore.getState().layers[0]?.selectedLod).toBe("2.2");
  });

  it("renders nothing when there are no available LoDs", () => {
    const { container } = render(
      <LodSelector
        layerId="L"
        availableLods={[]}
        selectedLod={null}
        isStreaming={false}
        lodMode="auto"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LodSelector — streaming layer, auto mode", () => {
  it("shows a read-out of the LoD in use and the current cell size, not an editable select", () => {
    useStreamStore.setState({ streams: { L: baseStream() } });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod={null}
        isStreaming
        lodMode="auto"
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("LoD 2.2")).toBeTruthy();
    expect(screen.getByText("100m cells")).toBeTruthy();
  });

  it("shows 'Auto' with no cell size before any level has been committed", () => {
    useStreamStore.setState({ streams: { L: baseStream({ level: null }) } });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod={null}
        isStreaming
        lodMode="auto"
      />,
    );
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.queryByText(/cells$/)).toBeNull();
  });

  it("clicking 'Manual' switches the layer's lodMode to manual", () => {
    useStreamStore.setState({ streams: { L: baseStream() } });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true, lodMode: "auto" })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod={null}
        isStreaming
        lodMode="auto"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(useLayerStore.getState().layers[0]?.lodMode).toBe("manual");
  });
});

describe("LodSelector — streaming layer, manual mode", () => {
  it("renders an editable select pinned to the layer's selectedLod, plus an Auto switch button", () => {
    useStreamStore.setState({ streams: { L: baseStream() } });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod="1.2"
        isStreaming
        lodMode="manual"
      />,
    );
    const select = screen.getByTitle(
      "Level of Detail (manual — pinned everywhere)",
    ) as HTMLSelectElement;
    expect(select.value).toBe("1.2");
    expect(screen.getByRole("button", { name: "Auto" })).toBeTruthy();
  });

  it("clicking 'Auto' switches the layer's lodMode back to auto", () => {
    useStreamStore.setState({ streams: { L: baseStream() } });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true, lodMode: "manual" })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(
      <LodSelector
        layerId="L"
        availableLods={["1.2", "2.2"]}
        selectedLod={null}
        isStreaming
        lodMode="manual"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(useLayerStore.getState().layers[0]?.lodMode).toBe("auto");
  });

  it("offers the LEARNED ladder, not the layer store's empty availableLods", () => {
    // A streaming layer's `Layer.model` is an empty stub, so
    // `computeAvailableLods` yields `[]` and the layer store's list stays
    // empty forever. Reading it here left manual mode with nothing but "All"
    // — a mode with no LoD to pin. The labels are learned from the worker and
    // published on `streamStore.ladder` (2026-08-05).
    useStreamStore.setState({
      streams: { L: baseStream({ ladder: ["1.2", "1.3", "2.2"] }) },
    });
    render(
      <LodSelector
        layerId="L"
        availableLods={[]}
        selectedLod={null}
        isStreaming
        lodMode="manual"
      />,
    );
    const select = screen.getByTitle(
      "Level of Detail (manual — pinned everywhere)",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "1.2",
      "1.3",
      "2.2",
    ]);
  });
});
