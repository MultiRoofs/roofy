/**
 * The bridge from an applied filter to the geometry drawn.
 *
 * Two properties carry the whole feature and neither is visible in the UI:
 * `null` and an EMPTY set mean different things, and a slow answer must never
 * overwrite a fast one that came after it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
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

const { syncFilterToMap } =
  await import("../../../../src/features/query/mapFilterSync");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
import type { CityModel } from "../../../../src/domain/citymodel/types";

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
    rulesEnabled: true,
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
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
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
    useQueryStore.getState().setSyncToMap(id, true);

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
    useQueryStore.getState().setSyncToMap(id, true);
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
    useQueryStore.getState().setSyncToMap(id, true);
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
    useQueryStore.getState().setSyncToMap(id, true);
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
    useQueryStore.getState().setSyncToMap(id, true);
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
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
