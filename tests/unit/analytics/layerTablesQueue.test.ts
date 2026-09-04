import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];
/** Resolvers for the gate below, so a build can be held mid-flight. */
let gate: { promise: Promise<void>; open: () => void } | null = null;
/** When set, the Nth CREATE (1-based) fails — for the rebuild-failure case. */
let failCreateNumber: number | null = null;
let createCount = 0;
/** The engine's readiness — the build task awaits `initDuckDB` and checks it. */
let engineReady = true;

function makeGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Let the queue's microtasks run.
 *
 * `enqueue` defers through `chain.then(task)`, so a task enqueued on this tick
 * has not STARTED yet when the caller's next statement executes. The
 * cancellation check happens at the top of the task, before its first await —
 * so "a drop that arrives while a build is in flight" and "a drop that arrives
 * while a build is still queued" are two genuinely different tests, and this
 * is what puts the first one in the first state.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

vi.mock("../../../src/analytics/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (statement.startsWith("CREATE OR REPLACE TABLE")) {
      createCount += 1;
      if (gate) await gate.promise;
      if (createCount === failCreateNumber) {
        return { ok: false as const, message: "Binder Error: rebuild failed" };
      }
    }
    if (statement.startsWith("DESCRIBE")) {
      return {
        ok: true as const,
        columns: [],
        rows: [{ column_name: "id", column_type: "VARCHAR" }],
      };
    }
    if (statement.includes("COUNT(*)")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 1 }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    getDuckDBStatus: vi.fn(() =>
      engineReady
        ? {
            state: "ready",
            extensions: {
              cityjson: { state: "loaded" },
              spatial: { state: "unloaded" },
              three_d: { state: "unloaded" },
            },
            loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
            platform: "wasm_eh",
          }
        : { state: "uninitialized" },
    ),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const {
  dropLayerTable,
  enqueueLayerTable,
  getLayerTable,
  resetLayerTablesForTest,
  retryEngine,
  useLayerTableStore,
} = await import("../../../src/analytics/layerTables");

const RESIDENT = { kind: "resident" as const, records: () => [] };
const ONE_ROW = {
  kind: "resident" as const,
  records: () => [
    {
      id: "R1",
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2",
      surfaceCount: 1,
      roofMetrics: [],
      footprintAreaSqM: 1,
      volumeCuM: 1,
      parents: [],
      children: [],
    },
  ],
} as never;

/** Whether any statement starting `prefix` was ever sent. */
function sent(prefix: string): boolean {
  return sql.some((s) => s.startsWith(prefix));
}

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  gate = null;
  failCreateNumber = null;
  createCount = 0;
  engineReady = true;
  resetLayerTablesForTest();
});

describe("dropLayerTable", () => {
  it("drops the table and forgets the layer", async () => {
    await enqueueLayerTable("L1", ONE_ROW);
    expect(getLayerTable("L1")).not.toBeNull();
    sql.length = 0;

    await dropLayerTable("L1");
    expect(sql).toEqual(['DROP TABLE IF EXISTS "layer_1"']);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("is a no-op for a layer that never had a table", async () => {
    await dropLayerTable("nobody");
    expect(sql).toEqual([]);
  });

  it("forgets a PENDING source, so a removed layer never returns on a retry", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", ONE_ROW);
    await dropLayerTable("L1");

    engineReady = true;
    await retryEngine();
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("WAITS for an in-flight create rather than racing it", async () => {
    gate = makeGate();
    const build = enqueueLayerTable("L1", ONE_ROW);
    // Let the build actually START — past its cancellation check — before the
    // drop arrives. Without this the drop supersedes a build that never ran,
    // which is the OTHER test, below.
    await flushMicrotasks();
    const drop = dropLayerTable("L1");

    // The DROP has not been sent while the CREATE is still held.
    await flushMicrotasks();
    expect(sent("DROP TABLE")).toBe(false);

    gate.open();
    await build;
    await drop;
    const createIdx = sql.findIndex((s) => s.startsWith("CREATE OR REPLACE"));
    const dropIdx = sql.findIndex((s) => s.startsWith("DROP TABLE"));
    // A build already in flight finishes — and then tears down what it made,
    // because the drop that arrived meanwhile means nobody wants it. Either
    // way the CREATE is never left standing.
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdx).toBeGreaterThan(createIdx);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("SKIPS a build whose layer was removed while it was still queued", async () => {
    gate = makeGate();
    const first = enqueueLayerTable("L1", ONE_ROW);
    const second = enqueueLayerTable("L2", ONE_ROW);
    // No flush: L2's build is still WAITING behind L1's when the drop lands.
    const drop = dropLayerTable("L2");

    gate.open();
    await Promise.all([first, second, drop]);

    expect(getLayerTable("L1")).not.toBeNull();
    expect(getLayerTable("L2")).toBeNull();
    // Only ONE table was ever created — L2's build never ran.
    expect(sql.filter((s) => s.startsWith("CREATE OR REPLACE")).length).toBe(1);
  });

  it("a build cancelled MID-FLIGHT publishes nothing and drops what it made", async () => {
    gate = makeGate();
    const build = enqueueLayerTable("L1", ONE_ROW);
    // Past the entry guard: this build WILL run to completion.
    await flushMicrotasks();
    const drop = dropLayerTable("L1");

    gate.open();
    await Promise.all([build, drop]);

    // Neither the registry nor — the point of this test — the STORE keeps an
    // entry for a layer that has been removed.
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
    // And the table the build did create was torn down, not orphaned.
    expect(sent('CREATE OR REPLACE TABLE "layer_1"')).toBe(true);
    expect(sql).toContain('DROP TABLE IF EXISTS "layer_1"');
  });

  it("does NOT cancel a re-add enqueued AFTER the drop", async () => {
    await enqueueLayerTable("L1", ONE_ROW);
    const drop = dropLayerTable("L1");
    // The user removes a layer and immediately drops the same file back in.
    // A boolean cancellation flag gets this wrong in one direction or the
    // other; a sequence number does not.
    const readd = enqueueLayerTable("L1", ONE_ROW);
    await Promise.all([drop, readd]);

    // The drop's queued task runs BEFORE the re-add's and must not blank the
    // newcomer's entry on its way out — hence `lastEnqueueSeq`.
    expect(getLayerTable("L1")).not.toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("drops a still-registered source buffer as well", async () => {
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(4),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(4),
    });
    dropped.length = 0;
    await dropLayerTable("L1");
    expect(dropped).toEqual(["layer_1.city.json"]);
  });

  it("sends the DROP TABLE before releasing the source buffer", async () => {
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(4),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(4),
    });
    sql.length = 0;
    dropped.length = 0;

    const order: string[] = [];
    const drop = dropLayerTable("L1");
    await drop;
    // The statement went out first; only then was the name released. A VFS
    // name that resolves to zero bytes under a live table is the failure mode
    // the other order invites.
    order.push(...sql, ...dropped.map((n) => `dropFile:${n}`));
    expect(order).toEqual([
      'DROP TABLE IF EXISTS "layer_1"',
      "dropFile:layer_1.city.json",
    ]);
  });
});

describe("rebuild", () => {
  it("replaces the table under a FRESH name and retires the old one AFTER the new one exists", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")!.table).toBe("layer_1");
    sql.length = 0;

    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")!.table).toBe("layer_2");

    const createIdx = sql.findIndex((s) =>
      s.startsWith('CREATE OR REPLACE TABLE "layer_2"'),
    );
    const dropIdx = sql.indexOf('DROP TABLE IF EXISTS "layer_1"');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    // Ordering is the point: the old table must survive until the new one is
    // real, or the layer has no analytics at all for the length of the build.
    expect(dropIdx).toBeGreaterThan(createIdx);
  });

  it("keeps the OLD table visible while the rebuild is in flight", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    gate = makeGate();
    const rebuild = enqueueLayerTable("L1", RESIDENT);

    // Not "building": the previous table still answers every query.
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: getLayerTable("L1"),
      rebuilding: true,
    });
    expect(getLayerTable("L1")!.table).toBe("layer_1");

    gate.open();
    await rebuild;
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: getLayerTable("L1"),
    });
    expect(getLayerTable("L1")!.table).toBe("layer_2");
  });

  it("a FAILED rebuild keeps the previous table, and never drops it", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    const before = getLayerTable("L1")!;
    sql.length = 0;
    failCreateNumber = 2;

    await enqueueLayerTable("L1", RESIDENT);

    expect(getLayerTable("L1")).toBe(before);
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: before,
      rebuilding: false,
    });
    expect(sql).not.toContain('DROP TABLE IF EXISTS "layer_1"');
  });

  it("a first build that fails IS a failed layer — there is nothing to fall back to", async () => {
    failCreateNumber = 1;
    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "failed",
      message: "Binder Error: rebuild failed",
    });
  });

  it("runs queued builds in the order they were enqueued", async () => {
    gate = makeGate();
    const a = enqueueLayerTable("A", RESIDENT);
    const b = enqueueLayerTable("B", RESIDENT);
    gate.open();
    await Promise.all([a, b]);
    expect(getLayerTable("A")!.table).toBe("layer_1");
    expect(getLayerTable("B")!.table).toBe("layer_2");
  });
});
