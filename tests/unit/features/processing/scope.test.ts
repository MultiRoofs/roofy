/**
 * What a run is about to run ON (spec §6).
 *
 * The three scopes differ in more than their predicate: "all" needs no id list
 * at all (the write can touch every row), while "matching" and "selected" FREEZE
 * the ids, because the filter bar and the selection are live and the run is not.
 * Every case reports a count of FEATURES rather than of rows — the ids are rows
 * (a Building and its BuildingParts), and "2 buildings measured" over a layer of
 * 2 buildings and 5 parts must not read "7".
 *
 * `resolveScope` reads NO store: the selection and the applied filter are
 * snapshotted by `snapshotScopeInputs` when Run is pressed and handed in, so a
 * run that waits behind a build resolves the ground the user saw. The two halves
 * are therefore tested separately — the snapshot against the stores, the
 * resolution against explicit inputs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/insights/duckdb", () => ({
  runQuery: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
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
const { resolveScope, snapshotScopeInputs } =
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

/** The layer's feature count, which every scope now asks for once. */
function countOnce(n: number): void {
  vi.mocked(duck.runQuery).mockResolvedValueOnce({
    ok: true,
    columns: ["n"],
    rows: [{ n }],
  });
}

const nothingSelected = { selectedObjectIds: [], filter: null };

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

describe("snapshotScopeInputs", () => {
  it("takes the selection on THIS layer only, deduplicated", () => {
    useSelectionStore.setState({
      selections: [
        { kind: "object", layerId: "L1", objectId: "a" },
        { kind: "surface", layerId: "L1", objectId: "a", surfaceIndex: 2 },
        { kind: "object", layerId: "L9", objectId: "z" },
      ],
    });
    expect(snapshotScopeInputs("L1").selectedObjectIds).toEqual(["a"]);
  });

  it("takes the APPLIED filter, never the draft", () => {
    const filter = {
      logic: "AND" as const,
      conditions: [
        { id: "c1", column: "status", op: "=" as const, value: "ok" },
      ],
    };
    useQueryStore.getState().setFilter("L1", filter);
    // Typed into the bar but not applied: the map and the grid show everything.
    expect(snapshotScopeInputs("L1").filter).toBeNull();
    useQueryStore.getState().applyFilter("L1");
    expect(snapshotScopeInputs("L1").filter).toEqual(filter);
  });
});

describe("resolveScope", () => {
  it("all: null ids and the feature count", async () => {
    countOnce(2);
    expect(
      await resolveScope({ table, scope: "all", snapshot: nothingSelected }),
    ).toEqual({ ok: true, featureIds: null, count: 2, total: 2 });
    expect(vi.mocked(duck.runQuery).mock.calls[0]?.[0]).toContain(
      'COUNT(DISTINCT COALESCE("feature_id", "id"))',
    );
  });

  it("all: a failed count refuses the run", async () => {
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: false,
      message: "Binder Error: no such table",
    });
    expect(
      await resolveScope({ table, scope: "all", snapshot: nothingSelected }),
    ).toEqual({ ok: false, message: "Binder Error: no such table" });
  });

  it("matching: the applied filter's feature ids, with the layer's total", async () => {
    countOnce(7);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [
        { id: "a", f: "a" },
        { id: "a-part", f: "a" },
      ],
    });
    const out = await resolveScope({
      table,
      scope: "matching",
      snapshot: {
        selectedObjectIds: [],
        filter: {
          logic: "AND",
          conditions: [{ id: "c1", column: "status", op: "=", value: "ok" }],
        },
      },
    });
    // `count` is FEATURES in scope, `total` the layer's features: the
    // provenance tooltip's "2 of 7 buildings" comes from the pair.
    expect(out).toEqual({
      ok: true,
      featureIds: ["a", "a-part"],
      count: 1,
      total: 7,
    });
    expect(vi.mocked(duck.runQuery).mock.calls[1]?.[0]).toContain(
      `"status" = 'ok'`,
    );
  });

  it("matching without a filter is refused", async () => {
    expect(
      await resolveScope({
        table,
        scope: "matching",
        snapshot: nothingSelected,
      }),
    ).toEqual({ ok: false, message: "No filter applied" });
    expect(duck.runQuery).not.toHaveBeenCalled();
  });

  it("matching on a filter that will not compile carries the reason", async () => {
    const out = await resolveScope({
      table,
      scope: "matching",
      snapshot: {
        selectedObjectIds: [],
        filter: {
          logic: "AND",
          conditions: [{ id: "c1", column: "gone", op: "=", value: "ok" }],
        },
      },
    });
    expect(out.ok).toBe(false);
    expect(duck.runQuery).not.toHaveBeenCalled();
  });

  it("selected: the snapshot's ids expanded to features", async () => {
    countOnce(4);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [
        { id: "a", f: "a" },
        { id: "a-part", f: "a" },
      ],
    });
    const out = await resolveScope({
      table,
      scope: "selected",
      snapshot: { selectedObjectIds: ["a-part"], filter: null },
    });
    expect(out).toEqual({
      ok: true,
      featureIds: ["a", "a-part"],
      count: 1,
      total: 4,
    });
    expect(vi.mocked(duck.runQuery).mock.calls[1]?.[0]).toContain(
      `"id" IN ('a-part')`,
    );
  });

  it("ignores a selection made AFTER the snapshot was taken", async () => {
    // The whole point of the snapshot: this selection is what the user has now,
    // not what they had when they pressed Run.
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "later" }]);
    expect(
      await resolveScope({
        table,
        scope: "selected",
        snapshot: nothingSelected,
      }),
    ).toEqual({ ok: false, message: "Nothing selected on this layer" });
  });

  it("selected with nothing in the snapshot is refused", async () => {
    expect(
      await resolveScope({
        table,
        scope: "selected",
        snapshot: { selectedObjectIds: [], filter: null },
      }),
    ).toEqual({ ok: false, message: "Nothing selected on this layer" });
    expect(duck.runQuery).not.toHaveBeenCalled();
  });

  it("a failed feature count refuses an id scope too", async () => {
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: false,
      message: "Binder Error: no feature_id",
    });
    expect(
      await resolveScope({
        table,
        scope: "selected",
        snapshot: { selectedObjectIds: ["a"], filter: null },
      }),
    ).toEqual({ ok: false, message: "Binder Error: no feature_id" });
  });

  it("a scope that names no row is refused rather than run empty", async () => {
    countOnce(4);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id", "f"],
      rows: [],
    });
    expect(
      await resolveScope({
        table,
        scope: "selected",
        snapshot: { selectedObjectIds: ["gone"], filter: null },
      }),
    ).toEqual({ ok: false, message: "Nothing to run on (0 buildings)" });
  });
});
