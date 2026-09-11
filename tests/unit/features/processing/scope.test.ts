/**
 * What a run is about to run ON (spec §6).
 *
 * The three scopes differ in more than their predicate: "all" needs no id list
 * at all (the write can touch every row), while "matching" and "selected" FREEZE
 * the ids, because the filter bar and the selection are live and the run is not.
 * Every case reports a count of FEATURES rather than of rows — the ids are rows
 * (a Building and its BuildingParts), and "2 buildings measured" over a layer of
 * 2 buildings and 5 parts must not read "7".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/insights/duckdb", () => ({
  runQuery: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {},
    loadedExtensions: [],
    platform: null,
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

const duck = await import("../../../../src/insights/duckdb");
const { resolveScope } =
  await import("../../../../src/features/processing/scope");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");

const table = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [{ name: "status", type: "VARCHAR", kind: "scalar" as const }],
  lods: [],
  rowCount: 3,
};

afterEach(() => {
  useSelectionStore.getState().clear();
  useQueryStore.setState({ queries: {} });
  vi.mocked(duck.runQuery).mockReset();
  vi.mocked(duck.runQuery).mockResolvedValue({
    ok: true,
    columns: [],
    rows: [],
  });
});

describe("resolveScope", () => {
  it("all: null ids and the feature count", async () => {
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["n"],
      rows: [{ n: 2 }],
    });
    expect(await resolveScope({ layerId: "L1", table, scope: "all" })).toEqual({
      ok: true,
      featureIds: null,
      count: 2,
    });
    expect(vi.mocked(duck.runQuery).mock.calls[0]?.[0]).toContain(
      'COUNT(DISTINCT COALESCE("feature_id", "id"))',
    );
  });

  it("all: a failed count refuses the run", async () => {
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: false,
      message: "Binder Error: no such table",
    });
    expect(await resolveScope({ layerId: "L1", table, scope: "all" })).toEqual({
      ok: false,
      message: "Binder Error: no such table",
    });
  });

  it("matching: the applied filter's feature ids", async () => {
    useQueryStore.getState().setFilter("L1", {
      logic: "AND",
      conditions: [{ id: "c1", column: "status", op: "=", value: "ok" }],
    });
    useQueryStore.getState().applyFilter("L1");
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [
        { id: "a", f: "a" },
        { id: "a-part", f: "a" },
      ],
    });
    const out = await resolveScope({ layerId: "L1", table, scope: "matching" });
    expect(out).toEqual({ ok: true, featureIds: ["a", "a-part"], count: 1 });
    expect(vi.mocked(duck.runQuery).mock.calls[0]?.[0]).toContain(
      `"status" = 'ok'`,
    );
  });

  it("matching without a filter is refused", async () => {
    expect(
      await resolveScope({ layerId: "L2", table, scope: "matching" }),
    ).toEqual({ ok: false, message: "No filter applied" });
    expect(duck.runQuery).not.toHaveBeenCalled();
  });

  it("matching on a filter that will not compile carries the reason", async () => {
    useQueryStore.getState().setFilter("L1", {
      logic: "AND",
      conditions: [{ id: "c1", column: "gone", op: "=", value: "ok" }],
    });
    useQueryStore.getState().applyFilter("L1");
    const out = await resolveScope({ layerId: "L1", table, scope: "matching" });
    expect(out.ok).toBe(false);
    expect(duck.runQuery).not.toHaveBeenCalled();
  });

  it("selected: the selection expanded to features", async () => {
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a-part" }]);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [
        { id: "a", f: "a" },
        { id: "a-part", f: "a" },
      ],
    });
    const out = await resolveScope({ layerId: "L1", table, scope: "selected" });
    expect(out).toEqual({ ok: true, featureIds: ["a", "a-part"], count: 1 });
    expect(vi.mocked(duck.runQuery).mock.calls[0]?.[0]).toContain(
      `"id" IN ('a-part')`,
    );
  });

  it("selected on another layer is refused", async () => {
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L9", objectId: "z" }]);
    expect(
      await resolveScope({ layerId: "L1", table, scope: "selected" }),
    ).toEqual({ ok: false, message: "Nothing selected on this layer" });
  });

  it("a scope that names no row is refused rather than run empty", async () => {
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "gone" }]);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [],
    });
    expect(
      await resolveScope({ layerId: "L1", table, scope: "selected" }),
    ).toEqual({ ok: false, message: "Nothing to run on (0 buildings)" });
  });
});
