/**
 * Per-layer object-type toggles.
 *
 * The list is of TOP-LEVEL groups: hiding "Building" hides its BuildingParts
 * too, which is the only thing that hides anything on real data (the parts
 * carry all the geometry). Static layers list what the model contains;
 * streaming layers list what the worker has decoded so far, which is empty
 * exactly when the panel is first opened.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayerTypeToggles } from "../../../../src/ui/layers/LayerTypeToggles";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { StreamState } from "../../../../src/features/streaming/streamStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
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

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "test layer",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: ["Building", "Road"],
    isStreaming: false,
    ...overrides,
  };
}

/** Registers `layer` in the store so the component's `setHiddenTypes` writes
 *  land somewhere observable, and returns it for rendering. */
function seed(layer: Layer): Layer {
  useLayerStore.setState({ layers: [layer], activeLayerId: layer.id });
  return layer;
}

function streamState(types: ReadonlyArray<string>): StreamState {
  return {
    handle: {} as never,
    disposers: [],
    grid: { originX: 0, originY: 0, rootCell: 800, maxLevel: 3 },
    header: {} as never,
    level: null,
    ladder: [],
    ladderVersion: 0,
    types,
    typesVersion: types.length === 0 ? 0 : 1,
    status: "idle",
    message: null,
    version: 0,
  };
}

function hiddenTypesOf(layerId: string): ReadonlyArray<string> {
  return useLayerStore.getState().layers.find((l) => l.id === layerId)!
    .hiddenTypes;
}

describe("LayerTypeToggles — static layer", () => {
  it("lists the model's groups, all checked, once expanded", () => {
    const layer = seed(makeLayer());
    render(<LayerTypeToggles layer={layer} />);

    // Collapsed by default: the layer rows are dense, and the common case is
    // wanting to see everything.
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /object types/i }));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Building" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Road" })).toBeChecked();
  });

  it("unchecking a group hides it in the store", () => {
    const layer = seed(makeLayer());
    render(<LayerTypeToggles layer={layer} />);
    fireEvent.click(screen.getByRole("button", { name: /object types/i }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Building" }));

    expect(hiddenTypesOf("L")).toEqual(["Building"]);
  });

  it("renders a hidden group unchecked, and re-checking it shows it again", () => {
    const layer = seed(makeLayer({ hiddenTypes: ["Building"] }));
    render(<LayerTypeToggles layer={layer} />);
    fireEvent.click(screen.getByRole("button", { name: /object types/i }));

    expect(
      screen.getByRole("checkbox", { name: "Building" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Road" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Building" }));
    expect(hiddenTypesOf("L")).toEqual([]);
  });

  it("renders nothing at all for a single-type layer — there is no meaningful choice", () => {
    const layer = seed(makeLayer({ availableObjectTypes: ["Building"] }));
    const { container } = render(<LayerTypeToggles layer={layer} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LayerTypeToggles — streaming layer", () => {
  it("lists the types the worker has decoded so far", () => {
    const layer = seed(
      makeLayer({ isStreaming: true, availableObjectTypes: [] }),
    );
    useStreamStore.setState({ streams: { L: streamState(["Building"]) } });
    render(<LayerTypeToggles layer={layer} />);

    fireEvent.click(screen.getByRole("button", { name: /object types/i }));
    expect(screen.getByRole("checkbox", { name: "Building" })).toBeChecked();
  });

  it("says types appear as features stream in while nothing has been decoded", () => {
    // Always offered for a streaming layer, unlike a one-type static one: the
    // union only grows, so an empty list now says nothing about later.
    const layer = seed(
      makeLayer({ isStreaming: true, availableObjectTypes: [] }),
    );
    useStreamStore.setState({ streams: { L: streamState([]) } });
    render(<LayerTypeToggles layer={layer} />);

    fireEvent.click(screen.getByRole("button", { name: /object types/i }));
    expect(
      screen.getByText(/types appear as features stream in/i),
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
