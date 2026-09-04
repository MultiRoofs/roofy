import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueued: string[] = [];
const dropped: string[] = [];
vi.mock("../../../../src/analytics/layerTables", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/analytics/layerTables")
    >();
  return {
    ...actual,
    enqueueLayerTable: vi.fn(async (layerId: string) => {
      enqueued.push(layerId);
    }),
    dropLayerTable: vi.fn(async (layerId: string) => {
      dropped.push(layerId);
    }),
  };
});

const {
  installLayerTableLifecycle,
  refreshStreamingTable,
  STREAM_REBUILD_DEBOUNCE_MS,
} = await import("../../../../src/features/layers/layerTableLifecycle");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function layer(over: Partial<Layer>): Layer {
  return {
    id: "L",
    name: "layer",
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
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

let uninstall: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  enqueued.length = 0;
  dropped.length = 0;
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  uninstall = installLayerTableLifecycle();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("removals", () => {
  it("drops the table of a layer that disappeared", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useLayerStore.setState({ layers: [] });
    expect(dropped).toEqual(["A"]);
  });

  it("drops every table when the whole workspace is cleared", () => {
    useLayerStore.setState({
      layers: [layer({ id: "A" }), layer({ id: "B" })],
    });
    useLayerStore.getState().removeAllLayers();
    expect(dropped.sort()).toEqual(["A", "B"]);
  });

  it("forgets the layer's query along with its table", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useQueryStore.getState().setSyncToMap("A", true);
    useLayerStore.setState({ layers: [] });
    expect(useQueryStore.getState().queries.A).toBeUndefined();
  });

  it("does not drop a table for a layer that is merely renamed", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useLayerStore.getState().updateLayer("A", { name: "renamed" });
    expect(dropped).toEqual([]);
  });
});

describe("streaming layers", () => {
  it("enqueues a table when a streaming layer appears (static ones are already enqueued by addCityLayer)", () => {
    useLayerStore.setState({
      layers: [layer({ id: "S", isStreaming: true }), layer({ id: "A" })],
    });
    expect(enqueued).toEqual(["S"]);
  });

  it("ignores a commit while the table panel is closed", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    enqueued.length = 0;
    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("rebuilds on a commit while the panel is open, debounced", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    useStreamStore.setState({ streams: { S: { version: 2 } as never } });
    useStreamStore.setState({ streams: { S: { version: 3 } as never } });
    expect(enqueued).toEqual([]);

    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    expect(enqueued).toEqual(["S"]);
  });

  it("refreshStreamingTable rebuilds at once, with no panel and no debounce", async () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    enqueued.length = 0;
    await refreshStreamingTable("S");
    expect(enqueued).toEqual(["S"]);
  });

  it("rebuilds every streaming layer when the panel OPENS — their versions moved while it was shut", () => {
    useLayerStore.setState({
      layers: [
        layer({ id: "S1", isStreaming: true }),
        layer({ id: "S2", isStreaming: true }),
        layer({ id: "A" }),
      ],
    });
    enqueued.length = 0;
    useLayerTableStore.getState().setTablePanelOpen(true);
    expect(enqueued.sort()).toEqual(["S1", "S2"]);
  });

  it("cancels a pending rebuild on uninstall", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;
    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    uninstall();
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });
});
