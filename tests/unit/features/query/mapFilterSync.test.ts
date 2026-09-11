/**
 * The bridge from an applied filter to the geometry drawn.
 *
 * Two properties carry the whole feature and neither is visible in the UI:
 * `null` and an EMPTY set mean different things, and a slow answer must never
 * overwrite a fast one that came after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runQuery = vi.fn();
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const {
  clearMapFilter,
  forgetMapFilter,
  installMapFilterSync,
  syncFilterToMap,
} = await import("../../../../src/features/query/mapFilterSync");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [],
  rowCount: 3,
};

const FILTER = {
  logic: "AND" as const,
  conditions: [
    { id: "c", column: "object_type", op: "=" as const, value: "Building" },
  ],
};

function addLayer(): string {
  return useLayerStore.getState().addLayer({
    name: "l",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
  });
}

function visibleIds(layerId: string): ReadonlySet<string> | null {
  return (
    useLayerStore.getState().layers.find((l) => l.id === layerId)
      ?.visibleObjectIds ?? null
  );
}

beforeEach(() => {
  runQuery.mockReset();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
});

let stopLifecycle: (() => void) | null = null;
afterEach(() => {
  stopLifecycle?.();
  stopLifecycle = null;
});

describe("syncFilterToMap", () => {
  it("does NOTHING when sync is off and the layer is already unfiltered", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    const state = useLayerStore.getState();

    await syncFilterToMap(id);
    // The common case, re-run on every Apply, toggle and table rebuild: no
    // query, and no store write that would re-render the viewport.
    expect(useLayerStore.getState()).toBe(state);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("writes null when sync is off", async () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("writes null when sync is on but no filter is applied", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("queries the feature-expanded ids and writes them", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }, { id: "B1-0" }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "object_type" = \'Building\')',
    );
    expect([...visibleIds(id)!]).toEqual(["B1", "B1-0"]);
  });

  it("writes an EMPTY set when nothing matched — hide everything", async () => {
    runQuery.mockResolvedValue({ ok: true, columns: ["id"], rows: [] });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)!.size).toBe(0);
  });

  it("clears the filter on a query failure rather than leaving a stale set", async () => {
    runQuery.mockResolvedValue({ ok: false, message: "Binder Error: nope" });
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["OLD"]));
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
  });

  it("a SLOW earlier call cannot overwrite a faster later one", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    // The FIRST query is held; the second answers at once.
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    runQuery
      .mockImplementationOnce(async () => {
        await held;
        return { ok: true, columns: ["id"], rows: [{ id: "OLD" }] };
      })
      .mockImplementationOnce(async () => ({
        ok: true,
        columns: ["id"],
        rows: [{ id: "NEW" }],
      }));

    const first = syncFilterToMap(id);
    const second = syncFilterToMap(id);
    await second;
    releaseFirst();
    await first;

    // The stale answer is DISCARDED. Without the generation check it would
    // rebuild the mesh from a predicate the user had already replaced.
    expect([...visibleIds(id)!]).toEqual(["NEW"]);
  });

  it("clears when the layer has no table (a rebuild in flight)", async () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["OLD"]));
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("automatic map-filter lifecycle", () => {
  it("updates an applied filter without mounting TablePanel", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    stopLifecycle = installMapFilterSync(vi.fn());

    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);
    await vi.waitFor(() => expect([...visibleIds(id)!]).toEqual(["B1"]));
  });

  it("does not resync for page, sort, columns, or selected-grid changes", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    stopLifecycle = installMapFilterSync(vi.fn());
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));

    useQueryStore.getState().setPage(id, 2);
    useQueryStore.getState().toggleSort(id, "id");
    useQueryStore.getState().setColumns(id, ["id"]);
    useQueryStore.getState().setShowSelectedOnly(id, true);
    await Promise.resolve();
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("invalidates a slow old result when the filter is cleared", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    stopLifecycle = installMapFilterSync(vi.fn());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    runQuery.mockImplementationOnce(async () => {
      await held;
      return { ok: true, columns: ["id"], rows: [{ id: "OLD" }] };
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);
    useQueryStore.getState().clearFilter(id);
    release();
    await vi.waitFor(() => expect(visibleIds(id)).toBeNull());
  });

  it("keeps streaming filters table-only", async () => {
    const id = useLayerStore.getState().addLayer({
      name: "stream",
      model: {
        sourceEncoding: "cityjson",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      } as unknown as CityModel,
      modelRef: { type: "url", url: "https://x/a.fcb" },
      visible: true,
      rules: [],
      isStreaming: true,
    });
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    stopLifecycle = installMapFilterSync(vi.fn());
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);
    await Promise.resolve();
    expect(runQuery).not.toHaveBeenCalled();
    expect(visibleIds(id)).toBeNull();
  });

  it("clears excluded selections and notifies through the feature callback", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }],
    });
    const notify = vi.fn();
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    const { useSelectionStore } =
      await import("../../../../src/features/selection/selectionStore");
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: id, objectId: "B2" });
    stopLifecycle = installMapFilterSync(notify);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);
    await vi.waitFor(() =>
      expect(useSelectionStore.getState().selections).toEqual([]),
    );
    expect(notify).toHaveBeenCalledWith(1);
  });
});

/** A layer set up to map-filter, with its id query HELD until the returned
 *  `release` is called. The started promise is returned so a test can await
 *  the write (or the discarded non-write) deterministically. */
function heldSync(rows: ReadonlyArray<Record<string, unknown>>): {
  readonly id: string;
  readonly release: () => void;
  readonly done: Promise<void>;
} {
  const id = addLayer();
  useLayerTableStore.setState({
    tables: { [id]: { state: "ready", info: TABLE } },
  });
  useQueryStore.getState().setFilter(id, FILTER);
  useQueryStore.getState().applyFilter(id);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  runQuery.mockImplementationOnce(async () => {
    await held;
    return { ok: true, columns: ["id"], rows };
  });
  return { id, release, done: syncFilterToMap(id) };
}

describe("clearMapFilter", () => {
  it("writes null", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));

    clearMapFilter(id);
    expect(visibleIds(id)).toBeNull();
  });

  it("INVALIDATES a query already in flight", async () => {
    const { id, release, done } = heldSync([{ id: "STALE" }]);

    // The lifecycle's rebuild clear, landing while the id query for the table
    // being RETIRED is still out. Going through the generation is the whole
    // point: a bare store write would be undone the moment that answer landed,
    // reinstating a set computed against a table that no longer exists.
    clearMapFilter(id);
    release();
    await done;

    expect(visibleIds(id)).toBeNull();
  });
});

describe("forgetMapFilter", () => {
  it("drops the layer's generation, so a late answer cannot write", async () => {
    const { id, release, done } = heldSync([{ id: "STALE" }]);

    // What layer removal calls. The layer is gone from the store, so the write
    // would be a no-op today — but the ENTRY must go too, or the map grows one
    // per layer ever synced, and a re-added id inherits a stale number.
    forgetMapFilter(id);
    release();
    await done;

    expect(visibleIds(id)).toBeNull();
  });
});

describe("non-string ids", () => {
  it("keeps a BIGINT id rather than silently hiding everything", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: 42 }, { id: 7n }, { id: "B1" }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    // The reader does not constrain the id column's TYPE — a numeric or UUID
    // id used to fall through the `typeof === "string"` test and leave an
    // empty set, which draws nothing at all.
    expect([...visibleIds(id)!]).toEqual(["42", "7", "B1"]);
  });

  it("WARNS when rows came back but not one usable id did", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: null }, { id: null }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    // Hiding everything is still the honest answer to an id column full of
    // NULLs — but not SILENTLY: nothing on screen distinguishes it from a
    // filter that matched nothing.
    expect(visibleIds(id)!.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
