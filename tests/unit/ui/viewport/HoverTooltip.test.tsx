import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type {
  CityModel,
  Surface,
} from "../../../../src/domain/citymodel/types";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { HoverTooltip } from "../../../../src/ui/viewport/HoverTooltip";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

const roof: Surface = {
  type: "RoofSurface",
  rings: [
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 10],
    ],
  ],
  attributes: {},
  lod: "2",
};
const wall: Surface = {
  type: "WallSurface",
  rings: [
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ],
  ],
  attributes: {},
  lod: "2",
};
const model: CityModel = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  vertexCount: 0,
  objects: {
    root: {
      id: "root",
      objectType: "Building",
      attributes: {},
      surfaces: [],
      bbox: null,
      children: ["part"],
      parents: [],
      lod: "2",
    },
    part: {
      id: "part",
      objectType: "BuildingPart",
      attributes: {},
      surfaces: [roof, wall],
      bbox: null,
      children: [],
      parents: ["root"],
      lod: "2",
    },
  },
};
function layer(): Layer {
  return {
    id: "L",
    name: "L",
    model,
    modelRef: { type: "url", url: "x" },
    visible: true,
    rules: [],
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
    isStreaming: false,
  };
}
afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useSelectionStore.setState({
    hovered: null,
    selections: [],
    geoSelection: null,
  });
  useStreamStore.setState({ streams: {} });
});
describe("HoverTooltip", () => {
  it("shows city hover facts without selecting", () => {
    useLayerStore.setState({ layers: [layer()] });
    useSelectionStore
      .getState()
      .hover({ kind: "object", layerId: "L", objectId: "root" });
    render(<HoverTooltip />);
    expect(screen.getByText("Building · root")).toBeTruthy();
    expect(screen.getByText("1 roof surfaces")).toBeTruthy();
    expect(useSelectionStore.getState().selections).toEqual([]);
  });
  it("shows static roof metrics and hides after hover clears", () => {
    useLayerStore.setState({ layers: [layer()] });
    useSelectionStore.getState().hover({
      kind: "surface",
      layerId: "L",
      objectId: "part",
      surfaceIndex: 0,
    });
    const view = render(<HoverTooltip />);
    expect(screen.getByText("Roof surface")).toBeTruthy();
    expect(screen.getByText(/70.7 m²/)).toBeTruthy();
    act(() => useSelectionStore.getState().hover(null));
    expect(view.container.textContent).toBe("");
  });
  it("reports loading rather than fabricated streaming metrics after eviction", () => {
    useLayerStore.setState({ layers: [{ ...layer(), isStreaming: true }] });
    useStreamStore.setState({
      streams: {
        L: {
          version: 1,
          handle: {
            getResidentModel: () => ({
              objects: {},
              cellCount: 0,
              featureCount: 0,
              surfaceAttrKeys: [],
            }),
          },
        } as never,
      },
    });
    useSelectionStore
      .getState()
      .hover({ kind: "object", layerId: "L", objectId: "root" });
    render(<HoverTooltip />);
    expect(screen.getByText("Loading object…")).toBeTruthy();
  });

  it("does not render a geo tooltip because geo selection is not city hover", () => {
    useSelectionStore.setState({
      geoSelection: { geoLayerId: "G", batchId: 1, properties: {} },
    });
    const { container } = render(<HoverTooltip />);
    expect(container.textContent).toBe("");
  });
});
