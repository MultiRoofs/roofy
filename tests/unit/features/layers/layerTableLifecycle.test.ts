import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueued: string[] = [];
const dropped: string[] = [];
vi.mock("../../../../src/insights/layerTables", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/insights/layerTables")
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

const clearMapFilter = vi.fn();
const forgetMapFilter = vi.fn();
// The map-filter door is SPIED, not exercised: this file is about which
// lifecycle beats call it. That the clear invalidates an in-flight id query is
// `mapFilterSync`'s own test.
vi.mock("../../../../src/features/query/mapFilterSync", () => ({
  syncFilterToMap: vi.fn(async () => {}),
  clearMapFilter: (layerId: string) => clearMapFilter(layerId),
  forgetMapFilter: (layerId: string) => forgetMapFilter(layerId),
}));

const {
  installLayerTableLifecycle,
  refreshStreamingTable,
  residentTableSource,
  STREAM_REBUILD_DEBOUNCE_MS,
} = await import("../../../../src/features/layers/layerTableLifecycle");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
import type { RunRecord } from "../../../../src/features/processing/types";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

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
  clearMapFilter.mockReset();
  forgetMapFilter.mockReset();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  // The toolbox is a table CONSUMER too, so its `open` and its in-flight runs
  // are inputs to every gate below — a leaked `open: true` would make the
  // panel-closed cases pass for the wrong reason.
  useProcessingStore.getState().resetForTest();
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
    useLayerStore.setState({ layers: [] });
    expect(useQueryStore.getState().queries.A).toBeUndefined();
  });

  it("forgets the layer's map-filter generation along with its table", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useLayerStore.setState({ layers: [] });
    expect(forgetMapFilter).toHaveBeenCalledWith("A");
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

  it("clears the map filter through the sync BEFORE a debounced rebuild", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    clearMapFilter.mockReset();

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    // Not when the timer is ARMED — a rebuild the fire-time gate abandons must
    // not have thrown the drawn set away on its way past.
    expect(clearMapFilter).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    expect(clearMapFilter).toHaveBeenCalledWith("S");
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
    clearMapFilter.mockReset();
    useLayerTableStore.getState().setTablePanelOpen(true);
    expect(enqueued.sort()).toEqual(["S1", "S2"]);
    // Every one of those tables is being replaced, so every one of their
    // drawn sets is stale — and only the streaming ones, never layer "A".
    expect(clearMapFilter.mock.calls.map((args) => String(args[0]))).toEqual([
      "S1",
      "S2",
    ]);
  });

  it("keeps a separate debounce timer per streaming layer", () => {
    useLayerStore.setState({
      layers: [
        layer({ id: "S1", isStreaming: true }),
        layer({ id: "S2", isStreaming: true }),
      ],
    });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S1: { version: 1 } as never } });
    vi.advanceTimersByTime(300);
    useStreamStore.setState({
      streams: {
        S1: { version: 1 } as never,
        S2: { version: 1 } as never,
      },
    });

    // S1's window closes first; S2's is still 300 ms from the end. One shared
    // timer would fire both at once, or restart S1's on S2's commit.
    vi.advanceTimersByTime(300);
    expect(enqueued).toEqual(["S1"]);
    vi.advanceTimersByTime(300);
    expect(enqueued).toEqual(["S1", "S2"]);
  });

  it("abandons a debounced rebuild if the panel is CLOSED before it fires", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    // Half a second is long enough to close the panel inside the window.
    useLayerTableStore.getState().setTablePanelOpen(false);
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("does not build twice when the panel reopens over an armed timer", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    const panel = useLayerTableStore.getState();
    panel.setTablePanelOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    panel.setTablePanelOpen(false);
    panel.setTablePanelOpen(true);
    // The reopen sweep rebuilt it; the timer left over from the commit must
    // not find the panel open again and do it a second time.
    expect(enqueued).toEqual(["S"]);
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual(["S"]);
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

describe("the processing toolbox as a table consumer", () => {
  /** A run record in whatever state the case needs, over layer "S". */
  function run(over: Partial<RunRecord>): RunRecord {
    return {
      id: "run_1",
      toolId: "height-from-extent",
      targetLayerId: "S",
      targetName: "layer",
      sourceLayerId: null,
      sourceName: null,
      scope: "all",
      scopeCount: 0,
      featureIds: null,
      lod: null,
      params: {},
      prefix: "",
      columns: [],
      status: "running",
      phase: null,
      startedAt: 0,
      elapsedMs: 0,
      summary: null,
      error: null,
      log: [],
      warnings: [],
      undoable: false,
      stale: false,
      note: null,
      ...over,
    } as RunRecord;
  }

  it("rebuilds on a commit while the TOOLBOX is open and the table panel is not", () => {
    // The toolbox reads its scope, its counts and its LoD options from this
    // table. Opening Tools with the table panel shut used to leave a streaming
    // layer's table at whatever was resident the last time anyone looked —
    // "All 0 buildings" with Run disabled, on a layer with 1,115 residents.
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useProcessingStore.getState().setOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    expect(enqueued).toEqual(["S"]);
  });

  it("rebuilds AGAIN on a later commit, so a result is never read against newer geometry", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useProcessingStore.getState().setOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    useStreamStore.setState({ streams: { S: { version: 2 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    // Two builds, two table names: `installStaleWatcher` (its own tests in
    // `runQueue.test.ts`) is what turns the second one into "stale: layer
    // reloaded" on the earlier run's card.
    expect(enqueued).toEqual(["S", "S"]);
  });

  it("rebuilds every streaming layer when the TOOLBOX opens, as the table panel does", () => {
    useLayerStore.setState({
      layers: [
        layer({ id: "S1", isStreaming: true }),
        layer({ id: "S2", isStreaming: true }),
        layer({ id: "A" }),
      ],
    });
    enqueued.length = 0;
    clearMapFilter.mockReset();
    useProcessingStore.getState().setOpen(true);
    expect(enqueued.sort()).toEqual(["S1", "S2"]);
    expect(clearMapFilter.mock.calls.map((args) => String(args[0]))).toEqual([
      "S1",
      "S2",
    ]);
  });

  it("rebuilds for a run still IN FLIGHT with nothing open at all", () => {
    // A run submitted from the toolbox and still queued when the user shut the
    // panel is the one reader left, and it re-reads the table at the head of
    // the queue.
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useProcessingStore.getState().upsertRun(run({ status: "queued" }));
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    expect(enqueued).toEqual(["S"]);
  });

  it("ignores a commit for a run that is already DONE", () => {
    // A finished card is not a reader: it describes a table that already
    // exists, and rebuilding for it would only retire it as stale.
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useProcessingStore.getState().upsertRun(run({ status: "done" }));
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("ignores a commit for a run in flight over ANOTHER layer", () => {
    useLayerStore.setState({
      layers: [
        layer({ id: "S", isStreaming: true }),
        layer({ id: "S2", isStreaming: true }),
      ],
    });
    useProcessingStore
      .getState()
      .upsertRun(run({ status: "running", targetLayerId: "S2" }));
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("abandons a debounced rebuild if the toolbox is CLOSED before it fires", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useProcessingStore.getState().setOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    useProcessingStore.getState().setOpen(false);
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("does not build twice when the toolbox reopens over an armed timer", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    const processing = useProcessingStore.getState();
    processing.setOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    processing.setOpen(false);
    processing.setOpen(true);
    expect(enqueued).toEqual(["S"]);
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual(["S"]);
  });

  it("stops sweeping on uninstall", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    enqueued.length = 0;
    uninstall();
    useProcessingStore.getState().setOpen(true);
    expect(enqueued).toEqual([]);
  });
});

describe("residentTableSource", () => {
  /** A stream entry whose handle reports whatever `objects` currently holds. */
  function stubStream(objects: () => Record<string, unknown>) {
    useStreamStore.setState({
      streams: {
        S: {
          version: 1,
          handle: {
            getResidentModel: () => ({
              objects: objects(),
              cellCount: 1,
              featureCount: Object.keys(objects()).length,
              surfaceAttrKeys: [],
            }),
          },
        } as never,
      },
    });
  }

  function readRecords(layerId: string): ReadonlyArray<unknown> {
    const source = residentTableSource(layerId);
    if (source.kind !== "resident") throw new Error("not a resident source");
    return source.records();
  }

  it("reads the LATEST resident set, at call time", () => {
    // The thunk is the whole point: a streaming layer's table is rebuilt over
    // and over, and each build must see the cells resident THEN — not the ones
    // that happened to be loaded when the source object was made.
    let objects: Record<string, unknown> = {};
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    stubStream(() => objects);

    const source = residentTableSource("S");
    if (source.kind !== "resident") throw new Error("not a resident source");
    expect(source.records()).toEqual([]);

    objects = { R1: { id: "R1" }, R2: { id: "R2" } };
    expect(source.records()).toHaveLength(2);
  });

  it("is empty for a layer with no stream registered", () => {
    expect(readRecords("nobody")).toEqual([]);
  });
});
