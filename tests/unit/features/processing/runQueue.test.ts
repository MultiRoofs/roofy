/**
 * The run queue: one run at a time, over the SAME FIFO the table builds use.
 *
 * The queue is the whole design, so these tests drive it through the seam the
 * app uses — `submitRun` / `cancelRun` / `undoRun` — and watch the store the UI
 * renders, never the internals. `layerTables` is mocked for its registry and
 * its queue (a real build would need a real DuckDB), but `computedColumns` is
 * NOT: the statements a run sends are part of what is under test here, and they
 * reach the duckdb mock's log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** Every statement the run sent, in order. */
const sql: string[] = [];
/** VFS registrations `writeComputedColumns` made. */
const registered: string[] = [];
/** What the mocked registry hands back for "L1". */
let tableInfo: {
  table: string;
  sourceName: null;
  source: null;
  reader: null;
  columns: Array<{ name: string; type: string; kind: "scalar" }>;
  lods: [];
  extension: null;
  sourceBytes: null;
  sourceFeatureIds: null;
  rowCount: number | null;
} = freshTable();

function freshTable() {
  return {
    table: "layer_1",
    sourceName: null,
    source: null,
    reader: null,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" as const },
      { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    ],
    lods: [] as [],
    extension: null,
    sourceBytes: null,
    sourceFeatureIds: null,
    rowCount: 3 as number | null,
  };
}

/** The layer's FEATURE count, as the mocked COUNT(DISTINCT …) answers it. */
let featureTotal = 1;
/** Rows the feature-expansion query returns for an id scope. */
let scopeRows: Array<{ id: string; f: string }> = [];
/** Holds the first statement containing `needle` until `promise` resolves. */
let gate: { needle: string; promise: Promise<void> } | null = null;
/** Any statement containing this substring comes back as a database error. */
let failing: string | null = null;
/** The columns the fake database holds, tracked from the ALTERs it is sent. */
let liveColumns: string[] = ["id", "feature_id"];
/**
 * And at which TYPE, tracked from the same ALTERs.
 *
 * A DESCRIBE reports the type a column was ADDED with, and S2's migration
 * decides on exactly that: a fake that answered "VARCHAR" for every column
 * would make every DOUBLE output look like a type change and issue a DROP the
 * real engine never sees. Absent means VARCHAR, which is what the seed columns
 * are.
 */
let liveColumnTypes = new Map<string, string>();
/** Tables `adoptLayerTable` was handed, by layer id. */
const adopted = new Map<string, unknown>();
let mockTableCounter = 100;
/** What they were when the open transaction began, for its ROLLBACK. */
let columnsAtBegin: string[] | null = null;
let typesAtBegin: Map<string, string> | null = null;
/** Whoever `subscribeDuckDBStatus` handed a listener to, so a test can publish
 *  a transition the way `duckdb.ts` does. */
const statusListeners = new Set<() => void>();
/** Whoever asked to hear about the engine DYING — a signal of its own, because
 *  a run's abort cannot fire twice and a death can follow a cancel. */
const deathListeners = new Set<() => void>();

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (gate && statement.includes(gate.needle)) await gate.promise;
    if (failing !== null && statement.includes(failing)) {
      return { ok: false as const, message: "Database was closed" };
    }
    // DuckDB's DDL is transactional, and a cancelled write leans on exactly
    // that: the ROLLBACK is what takes the added columns (and the backup
    // table) away again. A fake that kept them would let a broken write look
    // clean.
    if (statement === "BEGIN TRANSACTION") {
      columnsAtBegin = [...liveColumns];
      typesAtBegin = new Map(liveColumnTypes);
    }
    if (statement === "ROLLBACK" && columnsAtBegin !== null) {
      liveColumns = columnsAtBegin;
      columnsAtBegin = null;
      if (typesAtBegin !== null) liveColumnTypes = typesAtBegin;
      typesAtBegin = null;
    }
    if (statement === "COMMIT") {
      columnsAtBegin = null;
      typesAtBegin = null;
    }
    // The registry's column list is what decides CREATE vs REPLACE on the next
    // run, so the fake database has to actually change shape.
    const added =
      /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS "([^"]+)" (.+)$/.exec(
        statement,
      );
    if (added?.[1] && !liveColumns.includes(added[1])) {
      liveColumns.push(added[1]);
      // `IF NOT EXISTS` is a NO-OP on a column that is already there, TYPE
      // included — which is the whole of S2 — so the type is recorded only when
      // the column is actually created.
      if (added[2]) liveColumnTypes.set(added[1], added[2]);
    }
    const dropped = /^ALTER TABLE "[^"]+" DROP COLUMN IF EXISTS "([^"]+)"/.exec(
      statement,
    );
    if (dropped?.[1]) {
      liveColumns = liveColumns.filter((c) => c !== dropped[1]);
      liveColumnTypes.delete(dropped[1]);
    }
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: featureTotal }] };
    }
    if (statement.includes("AS f FROM")) {
      return { ok: true as const, columns: ["id", "f"], rows: scopeRows };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string) => {
      registered.push(name);
      return true;
    }),
    dropBuffer: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn((listener: () => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.add(listener);
      return () => deathListeners.delete(listener);
    }),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
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
  };
});

vi.mock("../../../../src/insights/layerTables", async () => {
  // `create` is imported HERE rather than at the top of the file: the factory
  // runs while the module graph is still being built, when a top-level import
  // binding is not yet initialised.
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  // The real queue is one FIFO chain, and the "second run waits" test is a test
  // OF that chain — so the mock keeps it, and only loses the table building.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    useLayerTableStore: store,
    // A derived layer's table is minted and adopted from INSIDE the run's own
    // FIFO slot (Task 21): `runQueue`'s graph imports both, and a factory
    // without them throws `No "nextTableName" export is defined on the mock`.
    nextTableName: vi.fn(() => `layer_${++mockTableCounter}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
    }),
    getLayerTable: vi.fn(() => tableInfo),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    refreshLayerTableColumns: vi.fn(async () => {
      // The real one round-trips a DESCRIBE through WASM. The delay is what makes
      // "inside the queued task" observable: a refresh left outside it lands
      // after the next run has already read the columns.
      await new Promise((resolve) => setTimeout(resolve, 0));
      tableInfo = {
        ...tableInfo,
        columns: liveColumns.map((name) => ({
          name,
          type: liveColumnTypes.get(name) ?? "VARCHAR",
          kind: "scalar" as const,
        })),
      };
    }),
    __resetQueue: () => {
      chain = Promise.resolve();
      store.setState({ tables: {} });
    },
  };
});

const tables = await import("../../../../src/insights/layerTables");
const { ensureExtension, isExtensionLoaded, getDuckDBStatus } =
  await import("../../../../src/insights/duckdb");
const {
  submitRun,
  retryRun,
  cancelRun,
  undoRun,
  installStaleWatcher,
  installTargetRemovalWatcher,
  installEngineWatcher,
  summarise,
} = await import("../../../../src/features/processing/runQueue");
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { computedColumnsOf, provenanceOf, useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { withDestinations } = await import("./toolDestinations");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");

type Resettable = { __resetQueue: () => void };

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {
      a: {
        id: "a",
        objectType: "Building",
        attributes: {},
        surfaces: [],
        bbox: null,
        children: [],
        parents: [],
        lod: null,
      },
    },
    vertexCount: 0,
  };
}

function layer(): Layer {
  return {
    id: "L1",
    name: "Delft",
    model: model(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
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
    availableObjectTypes: ["Building"],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    derivedFrom: null,
  };
}

function attributesOf(objectId: string): Record<string, unknown> {
  return (useLayerStore.getState().layers[0]?.model.objects[objectId]
    ?.attributes ?? {}) as Record<string, unknown>;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Mark a column of the fake table as one an EARLIER RUN wrote.
 *
 * The distinction is load-bearing since §6's source-column rule is enforced at
 * the head of the queue: a column with no provenance belongs to the FILE, and a
 * run that would overwrite it is refused. A test that puts a column on the
 * table and then runs over it is describing a computed column, and has to say
 * so the way the app knows it — through the registry.
 */
function computedAlready(column: string): void {
  useComputedColumnStore.getState().setProvenance("L1", column, {
    runId: "run_0",
    toolName: "Height from extent",
    summary: "All 1 building",
    at: Date.now(),
    partial: null,
    previous: null,
  });
}

/** One run request, with the height-from-extent tool's real shape. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "height-from-extent" as const,
    targetLayerId: "L1",
    sourceLayerId: null,
    scope: "all" as const,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    destination: "layer" as const,
    newLayerName: null,
    ...overrides,
  };
}

beforeEach(() => {
  // `tools/register` registers the REAL Roof metrics executor at module load
  // (`runQueue.ts` imports it). This file's tools are fakes and one of its
  // cases needs a tool with NO executor, so the real one is taken off here
  // rather than left to whichever test ran first.
  delete EXECUTORS["roof-metrics"];
  sql.length = 0;
  registered.length = 0;
  featureTotal = 1;
  scopeRows = [];
  gate = null;
  failing = null;
  liveColumns = ["id", "feature_id"];
  liveColumnTypes = new Map();
  typesAtBegin = null;
  adopted.clear();
  mockTableCounter = 100;
  columnsAtBegin = null;
  statusListeners.clear();
  deathListeners.clear();
  tableInfo = freshTable();
  useSelectionStore.getState().clear();
  useLayerStore.setState({ layers: [layer()] });
  useProcessingStore.getState().resetForTest();
  useComputedColumnStore.setState({ byLayer: {} });
  vi.mocked(tables.refreshLayerTableColumns).mockClear();
  // The extension phase reads all three. `mockClear` before the value, so a
  // test that asserts "never called" cannot inherit the previous test's call.
  vi.mocked(isExtensionLoaded).mockClear().mockReturnValue(false);
  vi.mocked(ensureExtension).mockClear().mockResolvedValue(false);
  vi.mocked(getDuckDBStatus)
    .mockClear()
    .mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "unloaded" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
});

afterEach(() => {
  (tables as unknown as Resettable).__resetQueue();
  delete EXECUTORS["height-from-extent"];
  delete EXECUTORS["measure-solids"];
  // The offline test defines an own `onLine` over jsdom's prototype getter;
  // deleting it uncovers the getter again for every other test.
  Reflect.deleteProperty(navigator, "onLine");
});

describe("submitRun", () => {
  it("runs one at a time, records phases and publishes a done card", async () => {
    registerExecutor("height-from-extent", async (run, ctx) => {
      ctx.phase("compute");
      await ctx.query("read extents", "SELECT 1");
      return {
        columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const id = submitRun(request());
    expect(runById(id)?.status).toBe("queued");
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const run = runById(id)!;
    expect(run.summary?.line).toMatch(/^1 building measured · /);
    expect(run.log.map((l) => l.label)).toContain("read extents");
    expect(run.scopeCount).toBe(1);
    expect(run.phase).toBeNull();
    expect(run.undoable).toBe(true);
    expect(attributesOf("a").extent_height_m).toBe(4);
    expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    // The write really went out, inside one transaction.
    expect(sql).toContain("BEGIN TRANSACTION");
    expect(sql).toContain(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
    );
    expect(sql).toContain("COMMIT");
    expect(registered).toEqual([`__vals_${id}.json`]);
    // §6.4: the write is ONE log entry per statement it issued, each carrying
    // the real SQL — a planner reads the log back and repeats the UPDATE by
    // hand. The single `sql: null` "Writing results" entry M1 shipped could
    // not support that.
    const write = run.log.filter((l) => l.label.startsWith("Writing results"));
    expect(write.map((l) => l.label)).toEqual([
      "Writing results (1/4)",
      "Writing results (2/4)",
      "Writing results (3/4)",
      "Writing results (4/4)",
    ]);
    expect(write.map((l) => l.sql)).toEqual([
      "BEGIN TRANSACTION",
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
      expect.stringContaining('UPDATE "layer_1" SET "extent_height_m"'),
      "COMMIT",
    ]);
    // The TIMING is the whole write's and rides on the LAST entry only:
    // `writeComputedColumns` measures the transaction, not each statement, and
    // repeating one number four times would read as four slow statements.
    expect(write.slice(0, -1).map((l) => l.rows)).toEqual([null, null, null]);
    expect(write.at(-1)?.rows).toBe(1);
    // The registry's column list is re-read, so the next run sees the column.
    expect(tables.refreshLayerTableColumns).toHaveBeenCalledWith("L1");
    expect(useProcessingStore.getState().notice).toBe(run.summary?.line);
  });

  it("queues a second run behind the first", async () => {
    const gate = deferred<void>();
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      if (calls === 1) await gate.promise;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: calls }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("running"));
    expect(runById(second)?.status).toBe("queued");
    expect(calls).toBe(1);
    gate.resolve();
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    expect(runById(first)?.status).toBe("done");
    expect(calls).toBe(2);
  });

  it("a cancel before publication leaves nothing behind", async () => {
    registerExecutor("height-from-extent", async (_run, ctx) => {
      await new Promise((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
      throw new Error("unreachable");
    });
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("running"));
    cancelRun(id);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(registered).toEqual([]);
    expect(attributesOf("a")).toEqual({});
    expect(computedColumnsOf("L1").size).toBe(0);
    expect(runById(id)?.undoable).toBe(false);
  });

  it("a cancel while still queued never reaches the executor", async () => {
    const gate = deferred<void>();
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      await gate.promise;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 1 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("running"));
    cancelRun(second);
    expect(runById(second)?.status).toBe("cancelled");
    gate.resolve();
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(calls).toBe(1);
  });

  it("a failing executor lands as failed with the message and no write", async () => {
    registerExecutor("height-from-extent", async () => {
      throw new Error("Binder Error: x");
    });
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Binder Error: x");
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(attributesOf("a")).toEqual({});
  });

  it("a run that measured nothing is done, with no write and no undo", async () => {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map(),
      measured: 0,
      skipped: [{ cause: "no geometry", count: 1 }],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const run = runById(id)!;
    expect(run.summary?.line).toMatch(/^0 buildings measured · 1 skipped · /);
    expect(run.undoable).toBe(false);
    // `IN ()` is a syntax error: the write is skipped entirely rather than sent.
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(registered).toEqual([]);
    expect(computedColumnsOf("L1").size).toBe(0);
  });

  it("refuses a scope it cannot resolve, without calling the executor", async () => {
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      return {
        columns: [],
        rows: new Map(),
        measured: 0,
        skipped: [],
      };
    });
    const id = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Nothing selected on this layer");
    expect(calls).toBe(0);
  });

  it("freezes the scope at Run, not at the head of the queue", async () => {
    // The user selects one building, presses Run behind a long run, then clicks
    // a different building. The queued run must measure the FIRST one.
    featureTotal = 3;
    scopeRows = [{ id: "a", f: "a" }];
    const seen: Array<ReadonlyArray<string> | null> = [];
    const hold = deferred<void>();
    let calls = 0;
    registerExecutor("height-from-extent", async (_run, ctx) => {
      calls += 1;
      seen.push(ctx.featureIds);
      if (calls === 1) await hold.promise;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const first = submitRun(request());
    const second = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("running"));
    // Changing the selection now must not reach the queued run.
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "other" }]);
    hold.resolve();
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    expect(sql.some((s) => s.includes(`"id" IN ('a')`))).toBe(true);
    expect(sql.some((s) => s.includes("'other'"))).toBe(false);
    expect(seen[1]).toEqual(["a"]);
  });

  it("retries a failed run on the ids it froze, not on today's selection", async () => {
    // §6.3: "Retry re-runs with the same parameters" — and the scope is one of
    // them (§6.1's frozen parameters). The user selected one building, the run
    // failed, they clicked another, then pressed Retry: the retry measures the
    // FIRST one.
    featureTotal = 3;
    scopeRows = [{ id: "a", f: "a" }];
    const seen: Array<ReadonlyArray<string> | null> = [];
    let calls = 0;
    registerExecutor("height-from-extent", async (_run, ctx) => {
      calls += 1;
      seen.push(ctx.featureIds);
      if (calls === 1) throw new Error("Binder Error: x");
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const first = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("failed"));

    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "other" }]);
    sql.length = 0;
    const retried = retryRun(first);
    expect(retried).not.toBeNull();
    expect(retried).not.toBe(first);
    await vi.waitFor(() => expect(runById(retried!)?.status).toBe("done"));
    expect(sql.some((s) => s.includes(`"id" IN ('a')`))).toBe(true);
    expect(sql.some((s) => s.includes("'other'"))).toBe(false);
    expect(seen[1]).toEqual(["a"]);
  });

  it("refuses at the head a column that now belongs to the source data", async () => {
    // §6.1's re-validation names it: "a column that now belongs to the file
    // fails the run with that reason". The form checked before the run queued;
    // by the head the table can hold a column of the file's own — and DuckDB's
    // identifiers being case-insensitive, "EXTENT_height_m" IS that column.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      return {
        columns: [{ name: "EXTENT_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { EXTENT_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const id = submitRun(
      request({
        prefix: "EXTENT_",
        columns: [{ name: "EXTENT_height_m", type: "DOUBLE" }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe(
      "'extent_height_m' belongs to the source data; choose another prefix",
    );
    expect(calls).toBe(0);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("replaces a COMPUTED column whose case differs, rather than creating it", async () => {
    // The other half of the same fact: a column an earlier run wrote is the
    // run's to replace, whatever case the prefix is typed in — and it must be
    // BACKED UP, or this run's Undo would drop a column it did not create.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    computedAlready("extent_height_m");
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "EXTENT_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { EXTENT_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(
      request({
        prefix: "EXTENT_",
        columns: [{ name: "EXTENT_height_m", type: "DOUBLE" }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(sql.some((s) => s.startsWith(`CREATE TABLE "__undo_${id}"`))).toBe(
      true,
    );
  });

  it("has nothing to retry for a run it never froze", () => {
    expect(retryRun("run_nope")).toBeNull();
  });

  it("refuses a run whose table was rebuilt while it queued", async () => {
    const hold = deferred<void>();
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      if (calls === 1) await hold.promise;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("running"));
    // A streaming settle rebuilt the table under the queued run (spec §6.1
    // re-validation): its frozen ids describe rows that no longer exist.
    tableInfo = { ...freshTable(), table: "layer_2" };
    hold.resolve();
    await vi.waitFor(() => expect(runById(second)?.status).toBe("failed"));
    expect(runById(second)?.error).toBe(
      "Layer changed while running; run again",
    );
    expect(calls).toBe(1);
  });

  it("cancels a run aborted while its scope was still resolving", async () => {
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("COUNT(DISTINCT"))).toBe(true),
    );
    cancelRun(id);
    held.resolve();
    // `cancelRun` patched the card the moment it was pressed, so waiting for the
    // status would prove nothing: this waits for the whole run to unwind.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runById(id)?.status).toBe("cancelled");
    // The scope query had already gone out, but nothing after it may run.
    expect(calls).toBe(0);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("times a failure that happened before the scope resolved", async () => {
    const now = vi.spyOn(performance, "now");
    let t = 0;
    now.mockImplementation(() => (t += 100));
    try {
      const id = submitRun(request({ toolId: "roof-metrics" }));
      await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
      // A card that says "0.0 s" for a run that never started is a card that
      // looks like it is still going.
      expect(runById(id)?.elapsedMs).toBeGreaterThan(0);
    } finally {
      now.mockRestore();
    }
  });

  it("counts the provenance partial in FEATURES, not rows", async () => {
    // 1 building in scope, modelled as 2 rows (a Building and its part), on a
    // layer of 3 buildings: the tooltip says "1 of 3", never "2 of 3".
    featureTotal = 3;
    scopeRows = [
      { id: "a", f: "a" },
      { id: "a-part", f: "a" },
    ];
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([
        ["a", { extent_height_m: 4 }],
        ["a-part", { extent_height_m: 4 }],
      ]),
      measured: 1,
      skipped: [],
    }));
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const id = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const provenance = provenanceOf("L1", "extent_height_m");
    expect(provenance?.partial).toEqual({ count: 1, total: 3 });
    expect(provenance?.summary).toBe("Selected 1 building");
  });

  it("fails a tool with no executor rather than hanging", async () => {
    // A tool with no executor, which `beforeEach` guarantees by deleting the
    // real Roof metrics one: asking for "height-from-extent" here would pass
    // only because the previous test's `afterEach` deleted its fake.
    const id = submitRun(request({ toolId: "roof-metrics" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Not available yet");
  });

  it("refuses a New-layer request for a tool that does not offer it", async () => {
    // The pre-flight, still standing now that all SEVEN tools ship `"new"`
    // (Task 23 flipped the last of them). Nothing in the shipped registry
    // lacks the destination any more, so the definition is STAGED for the
    // length of the run rather than the rule losing its test — see
    // `toolDestinations.ts`.
    await withDestinations("height-from-extent", ["layer"], async () => {
      const id = submitRun(request({ destination: "new", newLayerName: "X" }));
      await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
      expect(runById(id)?.error).toBe("Not available yet");
    });
  });

  it("refuses a New-layer request on a STREAMING target, with A2's reason", async () => {
    // The form's radio is disabled for this case, so the request can only
    // arrive from a draft frozen before a retarget (or from `retryRun`
    // replaying one) — which is exactly what this guard is for. No staging:
    // `height-from-extent` offers `"new"` in the shipped registry, so the
    // refusal here is the streaming one and nothing else.
    useLayerStore.setState({ layers: [{ ...layer(), isStreaming: true }] });
    const id = submitRun(request({ destination: "new", newLayerName: "X" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe(
      "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
    );
  });
});

describe("a run over a column an earlier run wrote", () => {
  /** An executor that writes `extent_height_m` on object "a". */
  function writeHeight() {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
  }

  it("sees a column an Undo dropped as gone, not as one to replace", async () => {
    writeHeight();
    const first = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(tableInfo.columns.map((c) => c.name)).toContain("extent_height_m");

    sql.length = 0;
    // Undo and Run again, back to back — the second run is queued while the undo
    // is still on the queue, which is exactly when the registry may lie.
    const undoing = undoRun(first);
    const second = submitRun(request());
    await undoing;
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    // Nothing to back up: the column the Undo dropped is not an existing column.
    expect(sql.filter((s) => s.startsWith('CREATE TABLE "__undo_'))).toEqual(
      [],
    );

    sql.length = 0;
    await undoRun(second);
    // And its own Undo DROPS the column rather than restoring values that were
    // never there.
    expect(sql).toContain(
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
    );
  });

  it("takes the earlier run's Undo away and drops its backup", async () => {
    // The column is already on the table, so BOTH runs replace it.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    // `extent_height_m` is DOUBLE here, which is what the run declares: a
    // SAME-typed replacement, so the write backs the scoped rows up and changes
    // no schema. S2's differently-typed replacement has its own case below.
    liveColumnTypes = new Map([["extent_height_m", "DOUBLE"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    const first = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(sql).toContain(
      `CREATE TABLE "__undo_${first}" AS SELECT "id", "extent_height_m" FROM "layer_1" WHERE "id" IN ('a')`,
    );

    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    // Spec §6.2: the later run owns the column's Undo now.
    expect(runById(first)?.undoable).toBe(false);
    expect(runById(second)?.undoable).toBe(true);
    // And the copy the first run kept is a table nothing will ever read.
    await vi.waitFor(() =>
      expect(sql).toContain(`DROP TABLE IF EXISTS "__undo_${first}"`),
    );
  });

  it("re-types a replaced column and gives Undo its type back (S2)", async () => {
    // The column on the table is VARCHAR (a text Join output, say) and this run
    // declares DOUBLE. `ADD COLUMN IF NOT EXISTS` cannot change that, so the
    // write DROPS and re-adds it — and because a DROP takes the column away
    // from EVERY row, the backup covers the whole table rather than the scope.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    liveColumnTypes = new Map([["extent_height_m", "VARCHAR"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const drop = sql.indexOf(
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
    );
    const add = sql.indexOf(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
    );
    const backup = sql.indexOf(
      `CREATE TABLE "__undo_${id}" AS SELECT "id", "extent_height_m" FROM "layer_1"`,
    );
    expect(backup).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(backup);
    expect(add).toBeGreaterThan(drop);
    // And the column really is DOUBLE now, which is what the registry reports
    // to the grid and to the next run.
    expect(
      tableInfo.columns.find((c) => c.name === "extent_height_m")?.type,
    ).toBe("DOUBLE");

    sql.length = 0;
    await undoRun(id);
    // Undo puts the ORIGINAL type back BEFORE restoring the backup's values:
    // assigning a VARCHAR into a DOUBLE column is what it must not do.
    const undoDrop = sql.indexOf(
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
    );
    const undoAdd = sql.indexOf(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" VARCHAR',
    );
    const restore = sql.findIndex((statement) =>
      statement.includes(`FROM "__undo_${id}"`),
    );
    expect(undoDrop).toBeGreaterThan(-1);
    expect(undoAdd).toBeGreaterThan(undoDrop);
    expect(restore).toBeGreaterThan(undoAdd);
  });

  it("refuses a SCOPED re-type and leaves all three stories alone (S2)", async () => {
    // The migration DROPs the column, which takes its values from EVERY row —
    // so on a subset it would clear the buildings this run never measured while
    // their model attributes and the "the rest from …" provenance still hold
    // the old values. A type change is all-or-nothing; the head refuses.
    featureTotal = 3;
    scopeRows = [{ id: "a", f: "a" }];
    liveColumns = ["id", "feature_id", "extent_height_m"];
    liveColumnTypes = new Map([["extent_height_m", "VARCHAR"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const id = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe(
      "The existing extent_height_m is VARCHAR; run on All buildings to change its type",
    );
    // Nothing was written: no transaction, no schema change, no values.
    expect(
      sql.filter(
        (statement) =>
          statement.startsWith("BEGIN") ||
          statement.startsWith("ALTER TABLE") ||
          statement.startsWith("UPDATE") ||
          statement.startsWith('CREATE TABLE "__undo_'),
      ),
    ).toEqual([]);
    // The column is the type it was …
    expect(
      tableInfo.columns.find((c) => c.name === "extent_height_m")?.type,
    ).toBe("VARCHAR");
    // … the model never heard of this run …
    expect(attributesOf("a")).toEqual({});
    // … and the earlier run still owns the column.
    expect(provenanceOf("L1", "extent_height_m")?.runId).toBe("run_0");
  });

  it("lets a SCOPED replacement through when the type does not change", async () => {
    // The narrowness of the refusal above: a same-typed replacement writes the
    // scoped rows and backs up exactly those, which is what it always did.
    featureTotal = 3;
    scopeRows = [{ id: "a", f: "a" }];
    liveColumns = ["id", "feature_id", "extent_height_m"];
    liveColumnTypes = new Map([["extent_height_m", "DOUBLE"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const id = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(sql).toContain(
      `CREATE TABLE "__undo_${id}" AS SELECT "id", "extent_height_m" FROM "layer_1" WHERE "id" IN ('a')`,
    );
    expect(sql.some((statement) => statement.includes("DROP COLUMN"))).toBe(
      false,
    );
  });

  it("allows the re-type when the SCOPE covers every feature (S2)", async () => {
    // "Scope All, or the scoped ids equal the whole table": a filter that
    // matches everything is the whole column, so the migration is honest.
    featureTotal = 1;
    scopeRows = [{ id: "a", f: "a" }];
    liveColumns = ["id", "feature_id", "extent_height_m"];
    liveColumnTypes = new Map([["extent_height_m", "VARCHAR"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a" }]);
    const id = submitRun(request({ scope: "selected" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(sql).toContain(
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
    );
  });

  it("writes a differently-cased run under the column's own spelling", async () => {
    // DuckDB matched `EXTENT_height_m` to the column run 1 created and wrote
    // the same values; everything app-side keyed on the TYPED spelling instead
    // — two registry entries, two sets of model attributes, and run 1 still
    // holding an Undo that would drop the column run 2 owns. The run's output
    // names are resolved to the table's own spelling before anything is
    // written, so there is only ever one column.
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      const name = calls === 1 ? "extent_height_m" : "EXTENT_height_m";
      return {
        columns: [{ name, type: "DOUBLE" as const }],
        rows: new Map([["a", { [name]: calls === 1 ? 4 : 9 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));

    sql.length = 0;
    const second = submitRun(
      request({
        prefix: "EXTENT_",
        columns: [{ name: "EXTENT_height_m", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));

    // ONE column, spelled as the table spells it, on the table and everywhere
    // the app mirrors it.
    expect(sql.some((s) => s.includes('"EXTENT_height_m"'))).toBe(false);
    expect([...computedColumnsOf("L1")]).toEqual(["extent_height_m"]);
    expect(provenanceOf("L1", "extent_height_m")?.runId).toBe(second);
    expect(Object.keys(attributesOf("a"))).toEqual(["extent_height_m"]);
    expect(attributesOf("a").extent_height_m).toBe(9);
    expect(runById(second)?.columns).toEqual(["extent_height_m"]);
    // Spec §6.2: the later run took the Undo, so run 1 can no longer drop the
    // column run 2 owns.
    expect(runById(first)?.undoable).toBe(false);
    expect(runById(second)?.undoable).toBe(true);
  });

  it("does not undo a run whose Undo was taken away while the undo queued", async () => {
    // Undo pressed on run 1 while run 2 is mid-write. The undo waits behind it,
    // and by the time it reaches the head its backup describes the state TWO
    // writes ago — restoring it would delete what run 2 just wrote.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    // `extent_height_m` is DOUBLE here, which is what the run declares: a
    // SAME-typed replacement, so the write backs the scoped rows up and changes
    // no schema. S2's differently-typed replacement has its own case below.
    liveColumnTypes = new Map([["extent_height_m", "DOUBLE"]]);
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: liveColumnTypes.get(name) ?? "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: calls === 1 ? 4 : 9 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));

    const held = deferred<void>();
    gate = { needle: "COMMIT", promise: held.promise };
    // Cleared BEFORE run 2 is submitted: run 1's own COMMIT is still in the
    // log, so a wait for "COMMIT" would return instantly and the Undo below
    // would be pressed before run 2 had started — which is not the race this
    // is about.
    sql.length = 0;
    const second = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("COMMIT"));
    expect(runById(second)?.status).toBe("running");
    // Pressed while run 1 still says it can be undone, with run 2 held
    // mid-transaction.
    const undoing = undoRun(first);
    held.resolve();
    await undoing;
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));

    expect(sql.some((s) => s.includes(`FROM "__undo_${first}"`))).toBe(false);
    expect(sql.some((s) => s.includes("DROP COLUMN"))).toBe(false);
    expect(attributesOf("a").extent_height_m).toBe(9);
  });
});

describe("a cancel that lost the race", () => {
  it("publishes the run with the note instead of claiming the cancel", async () => {
    const held = deferred<void>();
    gate = { needle: "COMMIT", promise: held.promise };
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("COMMIT"));
    // The write is mid-transaction: there is nothing to un-commit.
    cancelRun(id);
    expect(runById(id)?.status).toBe("cancelling");
    held.resolve();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.note).toBe("finished before the cancel arrived");
    expect(runById(id)?.undoable).toBe(true);
    expect(attributesOf("a").extent_height_m).toBe(4);
  });
});

describe("a cancel during the write", () => {
  it("rolls the transaction back and publishes nothing", async () => {
    // Spec §6.1: a cancel that lands BEFORE publication leaves nothing
    // changed. The UPDATE is the window — the longest statement of the write —
    // and the cancel arrives while it is still in flight.
    const held = deferred<void>();
    gate = { needle: "UPDATE", promise: held.promise };
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("UPDATE"))).toBe(true),
    );
    cancelRun(id);
    expect(runById(id)?.status).toBe("cancelling");
    held.resolve();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));

    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    // Nothing published: not the table's shape, not the model, not the
    // provenance the card would have claimed.
    expect(liveColumns).toEqual(["id", "feature_id"]);
    expect(attributesOf("a").extent_height_m).toBeUndefined();
    expect(computedColumnsOf("L1").size).toBe(0);
    expect(runById(id)?.undoable).toBe(false);
    expect(runById(id)?.error).toBeNull();
  });

  it("keeps the statements it issued when the ENGINE dies under the write", async () => {
    // §6.4's record is of what was ATTEMPTED, and this is the failure a bug
    // report is most likely to be written about. duckdb-wasm strands the
    // requests that were in flight when its worker died, so the write's own
    // promise NEVER settles — the death race is what ends the run, and an
    // outcome read off that promise would never arrive. The statements have to
    // reach the log as they are issued.
    const stop = installEngineWatcher();
    const never = deferred<void>();
    gate = { needle: "UPDATE", promise: never.promise };
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("UPDATE"))).toBe(true),
    );

    killEngine();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Analytics engine stopped");

    const statements = (runById(id)?.log ?? [])
      .filter((entry) => entry.label.startsWith("Writing results ("))
      .map((entry) => entry.sql);
    expect(statements).toEqual([
      "BEGIN TRANSACTION",
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
      expect.stringContaining('UPDATE "layer_1" SET "extent_height_m"'),
    ]);
    // Neither was ever sent: the COMMIT was never reached and the ROLLBACK is
    // skipped for a database that is gone.
    expect(statements).not.toContain("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    gate = null;
    stop();
  });
});

describe("undoRun", () => {
  it("restores the layer and marks the run", async () => {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    sql.length = 0;
    await undoRun(id);
    expect(sql).toContain(
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
    );
    expect(attributesOf("a")).toEqual({});
    expect(computedColumnsOf("L1").size).toBe(0);
    expect(runById(id)?.undoable).toBe(false);
    expect(runById(id)?.note).toBe("Undone");
    expect(tables.refreshLayerTableColumns).toHaveBeenCalledTimes(2);
  });

  it("does nothing twice", async () => {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    await undoRun(id);
    sql.length = 0;
    await undoRun(id);
    expect(sql).toEqual([]);
  });
});

describe("installTargetRemovalWatcher", () => {
  it("fails a QUEUED run whose target was removed, before it can start", async () => {
    const stop = installTargetRemovalWatcher();
    const hold = deferred<void>();
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      if (calls === 1) await hold.promise;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const first = submitRun(request());
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("running"));

    useLayerStore.setState({ layers: [] });
    expect(runById(second)?.status).toBe("failed");
    expect(runById(second)?.error).toBe("Layer removed");

    hold.resolve();
    // The queued run never reached its executor: the head saw the abort.
    await vi.waitFor(() => expect(runById(first)?.status).not.toBe("running"));
    expect(calls).toBe(1);
    stop();
  });

  it("aborts a RUNNING run whose target was removed and says why", async () => {
    // Spec §6.1: "Removing the target or the source layer during a run cancels
    // it ('Layer removed')" — the run must not go on measuring a layer the user
    // has thrown away, and must not publish onto it either.
    const stop = installTargetRemovalWatcher();
    let seen: AbortSignal | null = null;
    registerExecutor("height-from-extent", async (_run, ctx) => {
      seen = ctx.signal;
      await new Promise((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("stop")));
      });
      throw new Error("unreachable");
    });
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("running"));

    useLayerStore.setState({ layers: [] });
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Layer removed");
    expect(runById(id)?.elapsedMs).toBeGreaterThanOrEqual(0);

    // The executor's rejection arrives afterwards and must not rewrite the
    // reason as a plain cancel.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Layer removed");
    expect(sql).not.toContain("BEGIN TRANSACTION");
    stop();
  });

  it("keeps 'Layer removed' when the run finishes after the removal", async () => {
    // The removal lands while the run is finishing its schema refresh. The
    // continuation used to publish DONE over it: the card claimed a result on
    // a layer that is gone, restored its Undo and toasted the summary.
    const stop = installTargetRemovalWatcher();
    liveColumns = ["id", "feature_id", "extent_height_m"];
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    const held = deferred<void>();
    vi.mocked(tables.refreshLayerTableColumns).mockImplementationOnce(
      async () => {
        await held.promise;
      },
    );
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("COMMIT"));

    useLayerStore.setState({ layers: [] });
    expect(runById(id)?.status).toBe("failed");
    held.resolve();
    await tables.runOnTableQueue(async () => {});

    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Layer removed");
    expect(runById(id)?.undoable).toBe(false);
    expect(useProcessingStore.getState().notice).toBeNull();
    // The copy the write made is unreachable from a card that offers no Undo.
    await vi.waitFor(() =>
      expect(sql).toContain(`DROP TABLE IF EXISTS "__undo_${id}"`),
    );
    stop();
  });

  it("keeps 'Layer removed' when the scope query then fails", async () => {
    const stop = installTargetRemovalWatcher();
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    failing = "COUNT(DISTINCT";
    let calls = 0;
    registerExecutor("height-from-extent", async () => {
      calls += 1;
      return {
        columns: [{ name: "extent_height_m", type: "DOUBLE" }],
        rows: new Map([["a", { extent_height_m: 4 }]]),
        measured: 1,
        skipped: [],
      };
    });
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("COUNT(DISTINCT"))).toBe(true),
    );

    useLayerStore.setState({ layers: [] });
    expect(runById(id)?.error).toBe("Layer removed");
    held.resolve();
    await tables.runOnTableQueue(async () => {});

    // The scope's own refusal is a SECOND reason for a run that already has
    // one; the removal is the reason the user can act on.
    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Layer removed");
    expect(calls).toBe(0);
    stop();
  });

  it("still lets a run reach done, and a cancelled one stay cancelled", async () => {
    // The terminal guard refuses to move a run OUT of failed or cancelled; it
    // must not touch the ordinary transitions either side of that.
    const stop = installTargetRemovalWatcher();
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const done = submitRun(request());
    await vi.waitFor(() => expect(runById(done)?.status).toBe("done"));
    expect(runById(done)?.undoable).toBe(true);

    const held = deferred<void>();
    gate = { needle: "BEGIN TRANSACTION", promise: held.promise };
    // The first run's own BEGIN is still in the log; a wait for it would return
    // before the second run had started.
    sql.length = 0;
    const cancelled = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("BEGIN TRANSACTION"));
    cancelRun(cancelled);
    expect(runById(cancelled)?.status).toBe("cancelling");
    held.resolve();
    await vi.waitFor(() =>
      expect(runById(cancelled)?.status).toBe("cancelled"),
    );
    stop();
  });

  it("leaves finished runs and other layers' runs alone", async () => {
    const stop = installTargetRemovalWatcher();
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    useLayerStore.setState({ layers: [{ ...layer(), id: "L2" }] });
    expect(runById(id)?.status).toBe("done");
    expect(runById(id)?.error).toBeNull();
    stop();
  });
});

describe("installStaleWatcher", () => {
  it("marks the layer's runs stale when its table is rebuilt", async () => {
    // The column is one an earlier run wrote, so this run keeps a backup table
    // — a rebuilt table makes that copy unreadable as well as useless.
    liveColumns = ["id", "feature_id", "extent_height_m"];
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: tableInfo } },
    } as never);
    const stop = installStaleWatcher();
    try {
      const id = submitRun(request());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      expect(runById(id)?.stale).toBe(false);
      tables.useLayerTableStore.setState({
        tables: {
          L1: { state: "ready", info: { ...tableInfo, table: "layer_2" } },
        },
      } as never);
      expect(runById(id)?.stale).toBe(true);
      expect(runById(id)?.undoable).toBe(false);
      expect(computedColumnsOf("L1").size).toBe(0);
      await vi.waitFor(() =>
        expect(sql).toContain(`DROP TABLE IF EXISTS "__undo_${id}"`),
      );
    } finally {
      stop();
    }
  });

  it("leaves a run alone when the same table only re-describes", async () => {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: tableInfo } },
    } as never);
    const stop = installStaleWatcher();
    try {
      const id = submitRun(request());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      tables.useLayerTableStore.setState({
        tables: {
          L1: {
            state: "ready",
            info: {
              ...tableInfo,
              columns: [
                ...tableInfo.columns,
                { name: "extent_height_m", type: "DOUBLE", kind: "scalar" },
              ],
            },
          },
        },
      } as never);
      expect(runById(id)?.stale).toBe(false);
      expect(runById(id)?.undoable).toBe(true);
      expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    } finally {
      stop();
    }
  });

  it("never clears a layer's provenance without marking its runs stale (F4)", async () => {
    // The gate saw a layer lose its computed-column provenance while the card
    // still read `done` and kept its Undo — a state in which the grid shows no
    // COMPUTED group and a second run of the same tool is refused with
    // "'extent_height_m' belongs to the source data". It was not reproduced, so
    // what is pinned here is the INVARIANT whose violation it was: the stale
    // marking and `clearLayer` are ONE decision, and every table transition
    // either does both or does neither.
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: tableInfo } },
    } as never);
    const stop = installStaleWatcher();
    try {
      const id = submitRun(request());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      const live = tableInfo;

      // A build still IN FLIGHT over the existing table: `layerTables` keeps the
      // entry `ready` under the SAME info and only flags `rebuilding`, so
      // neither half fires. This is the transition that would have to leak for
      // the gate's state to exist at all.
      tables.useLayerTableStore.setState({
        tables: { L1: { state: "ready", info: live, rebuilding: true } },
      } as never);
      expect(runById(id)?.stale).toBe(false);
      expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);

      // A FAILED rebuild puts the same info back with the flag off: still
      // neither — the old table was never touched.
      tables.useLayerTableStore.setState({
        tables: { L1: { state: "ready", info: live, rebuilding: false } },
      } as never);
      expect(runById(id)?.stale).toBe(false);
      expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
      expect(runById(id)?.undoable).toBe(true);

      // And a real rebuild, under a new name: BOTH, in one store write. The two
      // assertions are read together on purpose — a version that cleared the
      // provenance and left the card alone is exactly the gate's report.
      tables.useLayerTableStore.setState({
        tables: {
          L1: { state: "ready", info: { ...live, table: "layer_9" } },
        },
      } as never);
      expect([
        computedColumnsOf("L1").size === 0,
        runById(id)?.stale === true,
      ]).toEqual([true, true]);
      expect(runById(id)?.undoable).toBe(false);
    } finally {
      stop();
    }
  });

  it("leaves a run alone when a FIRST ready entry appears — an adoption, not a rebuild", async () => {
    // A New-layer run publishes its copy's table with `adoptLayerTable`, which
    // seeds a `ready` entry under an id the store has never held. That is an
    // ARRIVAL, not a rebuild — a watcher that read it as one would mark the run
    // that just succeeded stale and revoke its own Undo on publication.
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    // NO entry to begin with, which is the state `adoptLayerTable` writes into:
    // the registry answers for the layer (the mocked `getLayerTable`) while the
    // STORE has never held it.
    const stop = installStaleWatcher();
    try {
      const id = submitRun(request());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      tables.useLayerTableStore.setState({
        tables: { L1: { state: "ready", info: tableInfo } },
      } as never);
      expect(runById(id)?.stale).toBe(false);
      expect(runById(id)?.undoable).toBe(true);
      expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    } finally {
      stop();
    }
  });
});

describe("the Loading extension phase (spec §6.1)", () => {
  /** The one request these tests submit: `measure-solids` declares `three_d`. */
  function solidsRequest() {
    return request({
      toolId: "measure-solids",
      lod: "2.2",
      prefix: "solid_",
      columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
    });
  }

  /**
   * A `measure-solids` executor, and the flag that says whether it ran.
   *
   * "The run never reached the tool" is the assertion behind most of §6.1's
   * refusals, and a spy is the only way to tell it apart from a tool that ran
   * and produced nothing.
   */
  function registerSolids(): () => boolean {
    let ran = false;
    registerExecutor("measure-solids", async () => {
      ran = true;
      return {
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
        rows: new Map([["a", { solid_volume_m3: 1 }]]),
        measured: 1,
        skipped: [],
      };
    });
    return () => ran;
  }

  /** Every distinct phase the newest run passed through, in order. */
  function recordPhases(): {
    readonly phases: Array<string | null>;
    readonly stop: () => void;
  } {
    const phases: Array<string | null> = [];
    const stop = useProcessingStore.subscribe((s) => {
      const run = s.runs[0];
      if (run && phases[phases.length - 1] !== run.phase)
        phases.push(run.phase);
    });
    return { phases, stop };
  }

  it("loads the tool's extension under its own phase before computing", async () => {
    const { phases, stop } = recordPhases();
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(true);
    registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    stop();

    expect(ensureExtension).toHaveBeenCalledWith("three_d");
    expect(phases).toContain("extension");
    // §6.1's order is "Loading extension, Reading source, Computing", and
    // `measure-solids` re-reads its file — so the phase that follows the
    // extension is "source". Computing is the EXECUTOR's to announce once its
    // handle is open, and this fake one opens none.
    expect(phases.indexOf("extension")).toBeLessThan(phases.indexOf("source"));
    expect(runById(id)?.status).toBe("done");
  });

  it("keeps ONE execution start across the extension hand-off", async () => {
    // The footer's live ticker is `Date.now() - run.startedAt` while the run is
    // in flight (`RunFooter.useElapsed`). A `startedAt` re-stamped at the
    // compute phase makes a long download's ticker drop back to zero at the
    // hand-off — the run appears to restart. One stamp per execution, so the
    // ticker and the card's final `elapsedMs` measure the SAME run.
    const load = deferred<boolean>();
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockReturnValue(load.promise);
    registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.phase).toBe("extension"));
    const startedAt = runById(id)!.startedAt;
    // A real download takes time; without it `Date.now()` cannot tell a second
    // stamp from the first.
    await new Promise((resolve) => setTimeout(resolve, 10));
    load.resolve(true);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    expect(runById(id)?.startedAt).toBe(startedAt);
    // And the elapsed the card finally reports still covers the download.
    expect(runById(id)?.elapsedMs).toBeGreaterThanOrEqual(10);
  });

  it("holds the tool and the queue behind the load until it settles", async () => {
    const load = deferred<boolean>();
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockReturnValue(load.promise);
    const solidsRan = registerSolids();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));

    const first = submitRun(solidsRequest());
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.phase).toBe("extension"));

    // The load is INSIDE `runOnTableQueue`, so nothing else touches the table
    // while it is in flight: not this run's tool, and not the run behind it.
    expect(solidsRan()).toBe(false);
    expect(runById(first)?.status).toBe("running");
    expect(runById(second)?.status).toBe("queued");
    expect(sql).toEqual([]);

    load.resolve(true);
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    expect(solidsRan()).toBe(true);
    expect(runById(first)?.status).toBe("done");
  });

  it("cancelled during the load, it writes nothing once the load settles", async () => {
    const load = deferred<boolean>();
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockReturnValue(load.promise);
    const solidsRan = registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.phase).toBe("extension"));
    cancelRun(id);
    expect(runById(id)?.status).toBe("cancelling");
    // `ensureExtension` cannot be aborted, so the Cancel is honoured on the far
    // side of it — and everything after it must stay untouched.
    load.resolve(true);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));

    expect(solidsRan()).toBe(false);
    expect(sql).toEqual([]);
    expect(attributesOf("a").solid_volume_m3).toBeUndefined();
    expect(computedColumnsOf("L1").size).toBe(0);
    expect(runById(id)?.undoable).toBe(false);
    expect(runById(id)?.phase).toBeNull();
  });

  it("skips the phase when the extension is already loaded", async () => {
    const { phases, stop } = recordPhases();
    vi.mocked(isExtensionLoaded).mockReturnValue(true);
    registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    stop();

    // Not merely "nothing was downloaded": §6.1 skips the PHASE, so the card
    // never shows "Loading extension" for an extension that is already there.
    expect(phases).not.toContain("extension");
    expect(ensureExtension).not.toHaveBeenCalled();
  });

  it("fails the run when the extension cannot be loaded, and writes nothing", async () => {
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(false);
    vi.mocked(getDuckDBStatus).mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "failed", error: "HTTP 404" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
    const solidsRan = registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));

    expect(solidsRan()).toBe(false);
    const run = runById(id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe(
      "The three_d extension could not be loaded: HTTP 404",
    );
    // §6.4: the engine's own reason survives in the log whichever sentence
    // the card shows — including the offline one, which replaces it.
    expect(run?.warnings).toContain("three_d: HTTP 404");
    expect(run?.undoable).toBe(false);
    expect(sql).toEqual([]);
  });

  it("tells an offline browser what it can act on, and still records DuckDB's reason", async () => {
    // §6.3: "for the offline case, that it needs a network connection". The
    // detection is advisory — jsdom's `onLine` is a prototype getter, so the
    // test defines an own property over it and `afterEach` deletes it again.
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(false);
    vi.mocked(getDuckDBStatus).mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "failed", error: "Failed to fetch" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
    registerSolids();

    const id = submitRun(solidsRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));

    const run = runById(id);
    expect(run?.error).toBe(
      "The three_d extension could not be loaded; it needs a network connection.",
    );
    // "Failed to fetch" is true and useless to the user, and indispensable in a
    // bug report — so it is kept as the run's warning, not as its message.
    expect(run?.warnings).toContain("three_d: Failed to fetch");
  });
});

describe("the Reading source phase (spec §6.1)", () => {
  it("opens Reading source BEFORE the scope query, not after it", async () => {
    // §6.1's phases are discrete and IN ORDER, and the order is what a user
    // reads off the card: "Loading extension, Reading source, Computing".
    // `resolveScope` issues a statement of its own, and a reader-backed run that
    // entered the phase only on the far side of it would sit at "queued" (its
    // extension already loaded) for the whole scope resolution — the card saying
    // nothing is happening while the run holds the shared queue.
    //
    // Asserting the phase at the EXECUTOR's entry cannot see this: by then the
    // scope query has long since returned. The only way to catch the ordering is
    // to hold the scope query pending and read the record while it is.
    vi.mocked(isExtensionLoaded).mockReturnValue(true);
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    registerExecutor("measure-solids", async () => ({
      columns: [],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const id = submitRun(request({ toolId: "measure-solids" }));
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("COUNT(DISTINCT"))).toBe(true),
    );

    // The scope query is STILL PENDING at this point — the gate holds it.
    expect(runById(id)?.phase).toBe("source");
    expect(runById(id)?.status).toBe("running");

    held.resolve();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
  });

  it("never opens the source phase for a tool that needs no source", async () => {
    // The other half of the ordering: `height-from-extent` computes from the
    // table, so §6.1 skips the phase for it outright — not even for the one
    // patch that used to set it. While its scope query is pending it is still
    // waiting to start, and it goes straight to Computing afterwards.
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    const phases: Array<string | null> = [];
    const stop = useProcessingStore.subscribe((s) => {
      const run = s.runs[0];
      if (run && phases[phases.length - 1] !== run.phase)
        phases.push(run.phase);
    });
    registerExecutor("height-from-extent", async () => ({
      columns: [],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("COUNT(DISTINCT"))).toBe(true),
    );
    expect(runById(id)?.phase).toBeNull();

    held.resolve();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    stop();
    expect(phases).toContain("compute");
    expect(phases).not.toContain("source");
  });

  it("hands a reader-backed executor the Reading source phase, not Computing", async () => {
    // §6.1: the phases are discrete and in order — "Loading extension (skipped
    // once loaded), Reading source (registering bytes; skipped for tools that
    // need none), Computing". A run that re-reads a 300 MB source must not show
    // "Computing" for the length of the read.
    //
    // `three_d` reads as ALREADY LOADED, so the extension phase is skipped
    // outright: this suite's `beforeEach` leaves `isExtensionLoaded` false and
    // `ensureExtension` resolving false, which would fail a `measure-solids` run
    // with the offline sentence before any executor ran.
    vi.mocked(isExtensionLoaded).mockReturnValue(true);
    let phaseOnEntry: string | null = null;
    registerExecutor("measure-solids", async (record) => {
      // The record as the queue left it the instant before the call.
      phaseOnEntry = runById(record.id)?.phase ?? null;
      return { columns: [], rows: new Map(), measured: 0, skipped: [] };
    });
    const first = submitRun(request({ toolId: "measure-solids" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(phaseOnEntry).toBe("source");

    // And the tool that needs no source still starts in Computing.
    let heightPhase: string | null = null;
    registerExecutor("height-from-extent", async (record) => {
      heightPhase = runById(record.id)?.phase ?? null;
      return { columns: [], rows: new Map(), measured: 0, skipped: [] };
    });
    const second = submitRun(request({ toolId: "height-from-extent" }));
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    expect(heightPhase).toBe("compute");
  });
});

/** Publish a status the way `duckdb.ts` does: the value first, then every
 *  listener. */
function publishStatus(next: ReturnType<typeof getDuckDBStatus>): void {
  vi.mocked(getDuckDBStatus).mockReturnValue(next);
  for (const listener of statusListeners) listener();
}

/** The worker died: `markEngineDead` tells the death subscribers and publishes
 *  the status, in that order. */
function killEngine(reason = "worker gone"): void {
  // Over a COPY, as `markEngineDead` dispatches it: a waiter unsubscribes from
  // inside its own notification.
  for (const listener of Array.from(deathListeners)) listener();
  publishStatus({ state: "failed", error: reason });
}

/** Bring the engine back, the way the status bar's Retry does. */
function reviveEngine(): void {
  vi.mocked(getDuckDBStatus).mockReturnValue({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  });
  for (const listener of statusListeners) listener();
}

/** A `failed` status that was never preceded by a `ready` one — a boot that
 *  did not come up, which the status bar's Retry can still fix. */
function failBoot(reason = "no bundle for this platform"): void {
  vi.mocked(getDuckDBStatus).mockReturnValue({
    state: "failed",
    error: reason,
  });
}

describe("the engine watcher (spec §6.1)", () => {
  it("fails the queued AND the running run when the engine stops", async () => {
    const stop = installEngineWatcher();
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    registerExecutor("height-from-extent", async () => {
      throw new Error("the executor must never be reached");
    });
    const running = submitRun(request());
    const queued = submitRun(request({ prefix: "other_" }));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    expect(runById(queued)?.status).toBe("queued");

    killEngine();

    // §6.1's exact sentence, on BOTH runs.
    expect(runById(running)?.status).toBe("failed");
    expect(runById(running)?.error).toBe("Analytics engine stopped");
    expect(runById(queued)?.status).toBe("failed");
    expect(runById(queued)?.error).toBe("Analytics engine stopped");
    expect(useProcessingStore.getState().engineStopped).toBe(true);

    held.resolve();
    stop();
  });

  it("leaves a run that already finished alone, but takes its Undo away", async () => {
    const stop = installEngineWatcher();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.undoable).toBe(true);

    killEngine();

    // The RUN is untouched — it succeeded, and its columns are still in the
    // table and the model. Only the flag changes, and the UI reads that.
    expect(runById(id)?.status).toBe("done");
    expect(runById(id)?.undoable).toBe(true);
    expect(useProcessingStore.getState().engineStopped).toBe(true);
    stop();
  });

  it("does not issue a DROP for a backup table that died with the engine", async () => {
    const stop = installEngineWatcher();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    sql.length = 0;

    killEngine();
    await Promise.resolve();

    expect(sql.filter((q) => q.startsWith("DROP TABLE"))).toEqual([]);
    expect(runById(id)).not.toBeNull();
    stop();
  });

  it("says nothing about a BOOT that never came up", async () => {
    // §6.1 is about an engine that DIES. A boot that failed — offline, no
    // bundle for the platform — is the state the status bar's Retry exists
    // for, and it publishes the same `failed`. Treating it as a death would
    // strike every Undo for the rest of a session in which the engine then
    // came up perfectly well on the second attempt.
    failBoot();
    const stop = installEngineWatcher();
    expect(useProcessingStore.getState().engineStopped).toBe(false);

    // …and a death AFTER that retry is still heard.
    vi.mocked(getDuckDBStatus).mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "unloaded" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
    for (const listener of statusListeners) listener();
    killEngine();
    expect(useProcessingStore.getState().engineStopped).toBe(true);
    stop();
  });

  it("reads the status on install, so a LATE install still hears the death", () => {
    // The app shell installs this in an effect, which can run after the engine
    // is already up. Without the read on install the watcher would have no
    // `ready` to measure the next transition against, and would dismiss a real
    // death as a boot that never came up.
    const stop = installEngineWatcher();
    killEngine();
    expect(useProcessingStore.getState().engineStopped).toBe(true);
    stop();
  });

  it("releases a run whose QUERY died with the engine, and frees the queue", async () => {
    // duckdb-wasm drops the promises of requests that were in flight when its
    // worker died — its `onError` clears the pending map without rejecting —
    // so this query never settles. Aborting the controller is only half the
    // answer: the await has to be raced against the abort, or `execute` sits
    // on it forever and the run's task never leaves the shared table FIFO.
    const stop = installEngineWatcher();
    const never = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: never.promise };
    registerExecutor("height-from-extent", async () => {
      throw new Error("the executor must never be reached");
    });
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    sql.length = 0;

    killEngine();

    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Analytics engine stopped");

    // The queue is free: a run submitted after the status bar's Retry reaches
    // the engine instead of queueing behind a task that will never finish.
    gate = null;
    reviveEngine();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const next = submitRun(request({ prefix: "other_" }));
    await vi.waitFor(() => expect(runById(next)?.status).toBe("done"));
    stop();
  });

  it("releases a run whose WRITE died with the engine, and posts no ROLLBACK", async () => {
    // The write is the one await that holds a transaction open. Its own
    // pre-COMMIT cancel check is never reached when the statement in flight
    // cannot settle, and the ROLLBACK it would issue has no engine to answer
    // it — so the run is released here and nothing is sent to the corpse.
    const stop = installEngineWatcher();
    const never = deferred<void>();
    gate = { needle: "BEGIN TRANSACTION", promise: never.promise };
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("BEGIN TRANSACTION"));
    sql.length = 0;

    killEngine();
    await Promise.resolve();
    await Promise.resolve();

    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Analytics engine stopped");
    expect(sql).toEqual([]);

    gate = null;
    reviveEngine();
    const next = submitRun(request({ prefix: "other_" }));
    await vi.waitFor(() => expect(runById(next)?.status).toBe("done"));
    stop();
  });

  it("does not read a FAILED retry boot as a second death", async () => {
    // ready → failed → initializing → failed. The last one is the status bar's
    // Retry failing to bring the engine back, not a second crash: nothing was
    // running to lose. Watching for "the status is failed" rather than for the
    // TRANSITION into it fails the runs a user started while the engine was
    // coming up — which is exactly when they would start one.
    const stop = installEngineWatcher();
    killEngine();
    publishStatus({ state: "initializing" });

    const never = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: never.promise };
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    // Still "queued": the card turns "running" when the scope resolves, and
    // this run's scope query is the one held open.
    expect(runById(id)?.status).toBe("queued");

    publishStatus({ state: "failed", error: "no bundle for this platform" });

    expect(runById(id)?.status).toBe("queued");
    expect(runById(id)?.error).toBeNull();
    stop();
  });

  it("releases a run CANCELLED before the engine died, and frees the queue", async () => {
    // The abort already fired, for the user's Cancel, while the engine was
    // alive — and the write is entitled to decide that one for itself (§6.1's
    // "finished before the cancel arrived"). A signal cannot fire twice, so
    // the death that follows has to be a SIGNAL OF ITS OWN; without it the
    // card fails and `execute` goes on holding the queue for ever.
    const stop = installEngineWatcher();
    const never = deferred<void>();
    gate = { needle: "BEGIN TRANSACTION", promise: never.promise };
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("BEGIN TRANSACTION"));

    cancelRun(id);
    expect(runById(id)?.status).toBe("cancelling");
    sql.length = 0;

    killEngine();

    expect(runById(id)?.status).toBe("failed");
    expect(runById(id)?.error).toBe("Analytics engine stopped");
    // Nothing posted at the corpse — no ROLLBACK, no DROP.
    expect(sql).toEqual([]);

    gate = null;
    reviveEngine();
    const next = submitRun(request({ prefix: "other_" }));
    await vi.waitFor(() => expect(runById(next)?.status).toBe("done"));
    stop();
  });

  it("disposes the previous watcher rather than stacking a second", () => {
    const first = installEngineWatcher();
    const second = installEngineWatcher();
    // One live installer, the same shape as the removal watcher: a hot reload
    // must not leave two of them failing the same runs twice.
    expect(statusListeners.size).toBe(1);
    first();
    second();
    expect(statusListeners.size).toBe(0);
  });
});

/**
 * Does the shared FIFO take another task and finish it?
 *
 * The one question the death race exists to answer: duckdb-wasm drops the
 * promise of a request that was in flight when its worker died, so an unraced
 * await occupies the queue every later run and every later table build sits
 * behind — for the life of the page. A short real timer rather than a `waitFor`
 * so a stranded queue fails in 50 ms instead of timing out.
 */
async function fifoAccepts(): Promise<boolean> {
  const probe = tables.runOnTableQueue(async () => "ran" as const);
  const outcome = await Promise.race([
    probe,
    new Promise<"blocked">((resolve) => {
      setTimeout(() => resolve("blocked"), 50);
    }),
  ]);
  return outcome === "ran";
}

describe("the death race over the cleanup and the Undo", () => {
  /** An executor that writes `extent_height_m` on object "a". */
  function writeHeight() {
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
  }

  it("frees the FIFO when the engine dies under a discarded backup's DROP", async () => {
    // `discardUndo` posts its DROP on the shared queue and does not await it —
    // housekeeping, never something a card waits on. Unraced, the DROP caught
    // by the death holds the FIFO, and every later run and table build queues
    // behind a statement that can never answer.
    const stop = installEngineWatcher();
    liveColumns = ["id", "feature_id", "extent_height_m"];
    computedAlready("extent_height_m");
    tableInfo = {
      ...freshTable(),
      columns: liveColumns.map((name) => ({
        name,
        type: "VARCHAR",
        kind: "scalar" as const,
      })),
    };
    writeHeight();
    const first = submitRun(request());
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));

    // The second run overwrites the column, so §6.2 takes the first run's Undo
    // away and discards its backup — and that DROP is the statement the death
    // catches.
    const never = deferred<void>();
    gate = { needle: "DROP TABLE IF EXISTS", promise: never.promise };
    const second = submitRun(request());
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
    await vi.waitFor(() =>
      expect(sql).toContain(`DROP TABLE IF EXISTS "__undo_${first}"`),
    );

    killEngine();
    gate = null;

    expect(await fifoAccepts()).toBe(true);
    stop();
  });

  it("settles undoRun, publishes nothing and frees the FIFO when the engine dies under it", async () => {
    const stop = installEngineWatcher();
    writeHeight();
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(attributesOf("a").extent_height_m).toBe(4);

    sql.length = 0;
    const never = deferred<void>();
    gate = { needle: "DROP COLUMN", promise: never.promise };
    const undoing = undoRun(id);
    await vi.waitFor(() =>
      expect(sql).toContain(
        'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "extent_height_m"',
      ),
    );
    sql.length = 0;

    killEngine();
    // Settles at all: an unraced `undoComputedColumns` leaves this await — and
    // the queued task holding the FIFO — pending for the life of the page.
    await undoing;

    // Nothing was committed, so nothing is published: not the model, not the
    // provenance, not the card's "Undone". And nothing is posted at the corpse.
    expect(attributesOf("a").extent_height_m).toBe(4);
    expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    expect(runById(id)?.note).toBeNull();
    expect(sql).toEqual([]);
    // The card reads what the DEATH WATCHER set: the run itself succeeded, and
    // Undo is taken from the whole session because every backup table died with
    // the database.
    expect(runById(id)?.status).toBe("done");
    expect(useProcessingStore.getState().engineStopped).toBe(true);

    gate = null;
    expect(await fifoAccepts()).toBe(true);
    stop();
  });
});

describe("summarise", () => {
  const result = (
    rows: Array<[string, Record<string, unknown>]>,
    columns: string[],
  ) => ({
    columns: columns.map((name) => ({ name, type: "DOUBLE" as const })),
    rows: new Map(rows),
    measured: rows.length,
    skipped: [],
  });

  it("counts the rows that have a value, for EVERY output column", () => {
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: 180 }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.nonNullByColumn).toEqual({ roof_azimuth_deg: 1 });
  });

  it("counts each column separately, not the first one for all of them", () => {
    // The whole point of the per-column count: §6.2's "All values are empty" is
    // about the column the tool's `styleByResult` CHOOSES, and a run can write
    // one column for every feature and another for none of them (§7: azimuth
    // over flat roofs is NULL while area is not).
    const summary = summarise(
      result(
        [
          ["a", { roof_area_m2: 12, roof_azimuth_deg: null }],
          ["b", { roof_area_m2: 30, roof_azimuth_deg: null }],
        ],
        ["roof_area_m2", "roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.nonNullByColumn).toEqual({
      roof_area_m2: 2,
      roof_azimuth_deg: 0,
    });
  });

  it("is 0 when every object got NULL, even though features were measured", () => {
    // Azimuth-only over perfectly flat roofs: §7 gives NULL for the measure,
    // and §6.2's Style by result must read "All values are empty".
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: null }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.measured).toBe(2);
    expect(summary.nonNullByColumn).toEqual({ roof_azimuth_deg: 0 });
  });

  it("is EMPTY for a run that wrote no column at all", () => {
    const summary = summarise(result([], []), 1000, { streaming: false });
    expect(summary.nonNullByColumn).toEqual({});
  });

  it("says the run was over the resident set, for a streaming target", () => {
    const summary = summarise(
      result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started.",
    );
  });

  it("singularises a caveat's count noun at ONE (F2)", () => {
    // The gate defect: the head read "1 invalid solids (no volume)" while the
    // skip line under it already said "1 not a solid". The rule lives HERE,
    // once, so no tool can follow it on one card and not on another.
    const summary = summarise(
      {
        ...result([["a", { solid_volume_m3: null }]], ["solid_volume_m3"]),
        measured: 1,
        skipped: [
          { cause: "not a solid", count: 1 },
          {
            cause: "areas without a name",
            one: "area without a name",
            count: 1,
          },
        ],
        caveats: [
          {
            cause: "invalid solids (no volume)",
            one: "invalid solid (no volume)",
            count: 1,
          },
        ],
      },
      8200,
      { streaming: false },
    );
    expect(summary.line).toBe(
      "1 building measured · 1 invalid solid (no volume) · 2 skipped · 8.2 s",
    );
    // The muted line follows the same rule, and a cause with NO count noun is
    // left exactly as it is.
    expect(summary.detail).toBe(
      "2 skipped: 1 not a solid · 1 area without a name",
    );
  });

  it("keeps the plural at any other count, including zero-free ones", () => {
    const summary = summarise(
      {
        ...result([["a", { solid_volume_m3: null }]], ["solid_volume_m3"]),
        measured: 1115,
        skipped: [],
        caveats: [
          {
            cause: "invalid solids (no volume)",
            one: "invalid solid (no volume)",
            count: 37,
          },
        ],
      },
      2400,
      { streaming: false },
    );
    expect(summary.line).toBe(
      "1,115 buildings measured · 37 invalid solids (no volume) · 2.4 s",
    );
  });

  it("prints a caveat between the measured count and the skipped count", () => {
    // §6.2, and the mockup's own card: "1,115 buildings measured · 37 invalid
    // solids (no volume) · 12 skipped · 2.4 s". A caveat qualifies the measured
    // count — the building WAS measured, with its volume withheld — so it is
    // not part of the skipped count and does not sit after it.
    const summary = summarise(
      {
        ...result([["a", { solid_volume_m3: 5 }]], ["solid_volume_m3"]),
        measured: 1115,
        skipped: [{ cause: "no geometry at LoD 2.2", count: 12 }],
        caveats: [{ cause: "invalid solids (no volume)", count: 37 }],
      },
      2400,
      { streaming: false },
    );
    expect(summary.line).toBe(
      "1,115 buildings measured · 37 invalid solids (no volume) · 12 skipped · 2.4 s",
    );
    // The caveat is NOT in the skip breakdown: that line explains objects that
    // could not be evaluated at all.
    expect(summary.detail).toBe("12 skipped: 12 no geometry at LoD 2.2");
  });

  it("lets a tool speak its OWN first phrase instead of the default", () => {
    // §6.2's `line`, which §7.3's "1,079 valid" and §7.5's "1,143 buildings
    // joined" need. Measure solids does not set it; the default stands.
    const summary = summarise(
      {
        ...result([["a", { solid_valid: true }]], ["solid_valid"]),
        line: "1,079 valid",
      },
      1000,
      { streaming: false },
    );
    expect(summary.line).toBe("1,079 valid · 1.0 s");
  });

  it("prints a tool's OWN line in place of the measured count", () => {
    // §7.3's card, verbatim: "1,079 valid · 125 with issues". TWO counts, not
    // three — the valid count IS the line, so the default "N buildings
    // measured" phrase never appears for this tool, even though `measured`
    // carries both halves for the provenance summary.
    expect(
      summarise(
        {
          columns: [],
          rows: new Map(),
          measured: 1204,
          skipped: [],
          line: "1,079 valid",
          caveats: [{ cause: "with issues", count: 125 }],
        },
        2400,
        { streaming: false },
      ).line,
    ).toBe("1,079 valid · 125 with issues · 2.4 s");
  });

  it("keeps the skip breakdown beside the resident-set note", () => {
    const summary = summarise(
      {
        ...result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
        skipped: [{ cause: "no roof surfaces at LoD 2", count: 3 }],
      },
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started. · " +
        "3 skipped: 3 no roof surfaces at LoD 2",
    );
  });
});

describe("a caveat on the card (spec §6.2)", () => {
  it("survives the queue and reaches the finished run's summary", async () => {
    // The pure `summarise` cases above pin the arithmetic; this one pins that
    // `canonicalise` and the publication carry the new field through, which is
    // what the user actually reads.
    registerExecutor("height-from-extent", async () => ({
      columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 3 }]]),
      measured: 1115,
      skipped: [{ cause: "no geometry at LoD 2.2", count: 12 }],
      caveats: [{ cause: "invalid solids (no volume)", count: 37 }],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.summary?.line).toMatch(
      /^1,115 buildings measured · 37 invalid solids \(no volume\) · 12 skipped · /,
    );
  });
});

describe("the context a one-layer tool is handed", () => {
  it("hands a one-layer tool a city target, no source, and the same table", async () => {
    // A BOX rather than a `let`: the assignment happens inside the executor's
    // closure, which control-flow analysis cannot see, so a plain `let` narrows
    // to `null` at every assertion below.
    const box: {
      seen: { target: unknown; source: unknown; table: string } | null;
    } = { seen: null };
    registerExecutor("height-from-extent", async (run, ctx) => {
      box.seen = {
        target: ctx.target,
        source: ctx.source,
        table: ctx.table.table,
      };
      return {
        columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
        rows: new Map([["a", { [`${run.prefix}height_m`]: 3 }]]),
        measured: 1,
        skipped: [],
      };
    });
    submitRun({
      toolId: "height-from-extent",
      targetLayerId: "L1",
      sourceLayerId: null,
      scope: "all",
      lod: null,
      params: {},
      prefix: "extent_",
      columns: [{ name: "extent_height_m", type: "DOUBLE" }],
      destination: "layer",
      newLayerName: null,
    });
    await vi.waitFor(() => expect(box.seen).not.toBeNull());
    expect(box.seen?.table).toBe("layer_1");
    expect(box.seen?.source).toBeNull();
    expect((box.seen?.target as { kind: string } | undefined)?.kind).toBe(
      "city",
    );
  });

  // Task 7 shipped `line`, `caveats` and the `summarise` edit; this case pins
  // that a cross-layer result (a custom line AND a caveat AND skips) still
  // renders in §6.2's order. Nothing in this task changes `summarise`.
  it("puts a tool's own line and its caveats on the card, before the skips", () => {
    expect(
      summarise(
        {
          columns: [{ name: "zones_matches_n", type: "DOUBLE" }],
          rows: new Map(),
          measured: 1143,
          skipped: [{ cause: "no geometry", count: 4 }],
          line: "1,143 buildings joined",
          caveats: [{ cause: "outside every area", count: 61 }],
        },
        2900,
        { streaming: false },
      ).line,
    ).toBe(
      "1,143 buildings joined · 61 outside every area · 4 skipped · 2.9 s",
    );
  });

  it("keeps the default line for a result that declares none", () => {
    expect(
      summarise(
        {
          columns: [],
          rows: new Map(),
          measured: 2,
          skipped: [],
        },
        2400,
        { streaming: false },
      ).line,
    ).toBe("2 buildings measured · 2.4 s");
  });
});
