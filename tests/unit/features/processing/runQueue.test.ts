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
    rowCount: 3 as number | null,
  };
}

/** The layer's FEATURE count, as the mocked COUNT(DISTINCT …) answers it. */
let featureTotal = 1;
/** Rows the feature-expansion query returns for an id scope. */
let scopeRows: Array<{ id: string; f: string }> = [];
/** Holds the first statement containing `needle` until `promise` resolves. */
let gate: { needle: string; promise: Promise<void> } | null = null;
/** The columns the fake database holds, tracked from the ALTERs it is sent. */
let liveColumns: string[] = ["id", "feature_id"];

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (gate && statement.includes(gate.needle)) await gate.promise;
    // The registry's column list is what decides CREATE vs REPLACE on the next
    // run, so the fake database has to actually change shape.
    const added =
      /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(statement);
    if (added?.[1] && !liveColumns.includes(added[1]))
      liveColumns.push(added[1]);
    const dropped = /^ALTER TABLE "[^"]+" DROP COLUMN IF EXISTS "([^"]+)"/.exec(
      statement,
    );
    if (dropped?.[1]) liveColumns = liveColumns.filter((c) => c !== dropped[1]);
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
          type: "VARCHAR",
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
const { submitRun, cancelRun, undoRun, installStaleWatcher } =
  await import("../../../../src/features/processing/runQueue");
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { computedColumnsOf, provenanceOf, useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
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

/** One run request, with the height-from-extent tool's real shape. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "height-from-extent" as const,
    targetLayerId: "L1",
    scope: "all" as const,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    ...overrides,
  };
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  featureTotal = 1;
  scopeRows = [];
  gate = null;
  liveColumns = ["id", "feature_id"];
  tableInfo = freshTable();
  useSelectionStore.getState().clear();
  useLayerStore.setState({ layers: [layer()] });
  useProcessingStore.getState().resetForTest();
  useComputedColumnStore.setState({ byLayer: {} });
  vi.mocked(tables.refreshLayerTableColumns).mockClear();
});

afterEach(() => {
  (tables as unknown as Resettable).__resetQueue();
  delete EXECUTORS["height-from-extent"];
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
    // A tool NOTHING registers in this milestone, deliberately: asking for
    // "height-from-extent" here would pass only because the previous test's
    // `afterEach` deleted the executor Task 10 registers at module load.
    const id = submitRun(request({ toolId: "roof-metrics" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Not available yet");
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

  it("does not undo a run whose Undo was taken away while the undo queued", async () => {
    // Undo pressed on run 1 while run 2 is mid-write. The undo waits behind it,
    // and by the time it reaches the head its backup describes the state TWO
    // writes ago — restoring it would delete what run 2 just wrote.
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
    const second = submitRun(request());
    await vi.waitFor(() => expect(sql).toContain("COMMIT"));
    sql.length = 0;
    // Pressed while run 1 still says it can be undone.
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

describe("installStaleWatcher", () => {
  it("marks the layer's runs stale when its table is rebuilt", async () => {
    // The column is pre-existing, so the run keeps a backup table — a rebuilt
    // table makes that copy unreadable as well as useless.
    liveColumns = ["id", "feature_id", "extent_height_m"];
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
});
