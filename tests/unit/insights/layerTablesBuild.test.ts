import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every SQL statement the module sent, in order. */
const sql: string[] = [];
/** Every VFS registration, name -> byte length. */
const registered: Array<{ name: string; length: number }> = [];
const dropped: string[] = [];
/** `DESCRIBE` answers, keyed by the substring that identifies the query. */
let describeRows: Record<string, unknown>[] = [];
let countValue = 0;
/** SQL substrings that must FAIL, mapped to their message. */
let failures: Record<string, string> = {};
/** The engine's readiness, and a gate to hold `initDuckDB` open with. */
let engineReady = true;
let initGate: Promise<void> | null = null;
/** The worker has died: `duckdb.ts` publishes `failed` and every subscriber
 *  hears it. Separate from `engineReady`, which is "not up YET". */
let engineDead = false;
/** `duckdb.ts`'s engine generation: a new number for every boot AND every
 *  death, which is what tells a build the tables it knew are gone. */
let engineGeneration = 1;
const statusListeners = new Set<() => void>();
/** `onEngineDeath`'s waiters. ONE-SHOT, as in `duckdb.ts`: `markEngineDead`
 *  drops each listener as it fires, so a watcher that wants the next engine's
 *  death has to re-arm. */
const deathListeners = new Set<() => void>();
/** How many times `initDuckDB` was asked for an engine. */
let initCalls = 0;
/** What a case wants the BOOT itself to do — used to move the engine
 *  generation a SECOND time, under `retryEngine`'s await. */
let bootAlso: () => void = () => {};
/** Whether `initDuckDB` is holding a SETTLED memo — `duckdb.ts`'s
 *  `initPromise`. True means the next call boots nothing. */
let booted = true;
/** Holds every statement containing `needle` until `promise` settles, so a
 *  death can be timed INSIDE one the module is awaiting. */
let holdStatement: { needle: string; promise: Promise<void> } | null = null;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = () => {
      r();
    };
  });
  return { promise, resolve };
}
/**
 * Whether `registerBuffer` accepts a buffer.
 *
 * `duckdb.ts` returns false from it in exactly one situation — no database, or
 * a status that is not `ready` — so the fake flips `engineReady` alongside its
 * refusal rather than inventing a failure mode the real one does not have.
 */
let registerAccepts = true;
/**
 * Fires ONCE, on the first statement it is armed for, while that statement is
 * still in flight. The only way to model something happening to a layer's table
 * DURING a query the module is awaiting.
 */
let onStatement: ((statement: string) => Promise<void>) | null = null;

vi.mock("../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    const held = holdStatement;
    if (held && statement.includes(held.needle)) await held.promise;
    if (onStatement) {
      const hook = onStatement;
      onStatement = null;
      await hook(statement);
    }
    for (const [needle, message] of Object.entries(failures)) {
      if (statement.includes(needle)) return { ok: false as const, message };
    }
    if (statement.startsWith("DESCRIBE")) {
      return { ok: true as const, columns: [], rows: describeRows };
    }
    if (statement.includes("COUNT(*)")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: countValue }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {
      initCalls += 1;
      // THE MEMO, modelled: `initDuckDB` re-runs `doInit` only when
      // `initPromise` is null (`duckdb.ts:526-531`), so a call made while the
      // engine is UP boots nothing and moves no counter — which is what every
      // build's own `await initDuckDB()` is. Only a call made while it is down
      // is a boot.
      const boots = !booted;
      // A REAL boot bumps the generation SYNCHRONOUSLY, before its first await
      // (`doInit`, `duckdb.ts:405`) — so it has already happened by the time
      // `retryEngine` reads the number. That ordering is exactly what the
      // check is written against, so the mock reproduces it.
      if (boots) engineGeneration += 1;
      // The boot's first await. Everything after it happens DURING the boot,
      // which is where a worker death would land — `bootAlso` is how a case
      // puts one there, and a bump before this line would be part of the boot
      // rather than a death inside it.
      await Promise.resolve();
      if (boots) bootAlso();
      if (initGate) await initGate;
      // A boot that came up is memoised; one that did not cleared the memo, so
      // the next call really boots again.
      booted = engineReady && !engineDead;
    }),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.add(listener);
      return () => deathListeners.delete(listener);
    }),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => engineGeneration),
    subscribeDuckDBStatus: vi.fn((listener: () => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    getDuckDBStatus: vi.fn(() =>
      engineDead
        ? { state: "failed", error: "worker gone" }
        : engineReady
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
    registerBuffer: vi.fn(async (name: string, bytes: Uint8Array) => {
      if (!registerAccepts) {
        engineReady = false;
        return false;
      }
      registered.push({ name, length: bytes.length });
      return true;
    }),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const {
  adoptLayerTable,
  dropLayerTable,
  enqueueLayerTable,
  getLayerTable,
  nextTableName,
  refreshLayerTableColumns,
  resetLayerTablesForTest,
  retryEngine,
  useLayerTableStore,
} = await import("../../../src/insights/layerTables");
import type {
  LayerTableState,
  SourceProvider,
} from "../../../src/insights/layerTables";
import { FLAT_PREFIX_COLUMNS } from "../../../src/insights/layerRows";
import type { CityModel } from "../../../src/domain/citymodel/types";

/** The flat table's `bbox` column type, spelled once: `layerTables` declares it
 *  on the empty table AND forces it with an ALTER on a populated one. */
const BBOX_TYPE =
  "STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)";

const READER_DESCRIBE = [
  { column_name: "id", column_type: "VARCHAR" },
  { column_name: "feature_id", column_type: "VARCHAR" },
  { column_name: "object_type", column_type: "VARCHAR" },
  { column_name: "parents", column_type: "VARCHAR[]" },
  { column_name: "bbox", column_type: "STRUCT(xmin DOUBLE)" },
  { column_name: "geometry_lod1_2", column_type: "BLOB" },
  {
    column_name: "geometry_properties_lod1_2",
    column_type: "STRUCT(a INTEGER)",
  },
  { column_name: "geometry_lod2_2", column_type: "BLOB" },
  {
    column_name: "geometry_properties_lod2_2",
    column_type: "STRUCT(a INTEGER)",
  },
  { column_name: "material_lod2_2", column_type: "INTEGER[]" },
  { column_name: "texture_lod2_2", column_type: "INTEGER[]" },
  { column_name: "template", column_type: "STRUCT(a INTEGER)" },
  { column_name: "b3_h_dak_max", column_type: "DOUBLE" },
  { column_name: "bouwjaar", column_type: "BIGINT" },
];

const FALLBACK_DESCRIBE = [
  { column_name: "id", column_type: "VARCHAR" },
  { column_name: "feature_id", column_type: "VARCHAR" },
  { column_name: "object_type", column_type: "VARCHAR" },
  { column_name: "parents", column_type: "VARCHAR[]" },
  { column_name: "children", column_type: "VARCHAR[]" },
  { column_name: "bbox", column_type: BBOX_TYPE },
];

/** ONE provider instance, so `LayerTable.source` can be asserted by identity
 *  rather than by "is a function". */
const PROVIDER: SourceProvider = async () => new Uint8Array(16);

function readerSource() {
  return {
    kind: "bytes" as const,
    bytes: new Uint8Array(16),
    reader: "read_cityjson" as const,
    extension: "city.json" as const,
    provider: PROVIDER,
  };
}

function model(): CityModel {
  return {
    sourceEncoding: "citygml",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: {
        id: "B1",
        objectType: "Building",
        attributes: { bouwjaar: 1920 },
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: [],
        children: [],
        lod: null,
      },
    },
  } as unknown as CityModel;
}

function stateOf(layerId: string) {
  return useLayerTableStore.getState().tables[layerId];
}

/** A gate over `initDuckDB`, so a build can be observed MID-FLIGHT. */
function holdEngine(): () => void {
  let open!: () => void;
  initGate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return open;
}

/** Two microtask turns — enough for a queued task to start and reach its first
 *  real await, and no more. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  describeRows = READER_DESCRIBE;
  countValue = 2231;
  failures = {};
  engineReady = true;
  engineDead = false;
  engineGeneration = 1;
  deathListeners.clear();
  initCalls = 0;
  bootAlso = () => {};
  // The suite starts with the engine up, which is a boot already memoised.
  booted = true;
  holdStatement = null;
  initGate = null;
  registerAccepts = true;
  onStatement = null;
  resetLayerTablesForTest();
  useLayerTableStore.setState({ tables: {} });
});

describe("reader-backed layer table", () => {
  async function build(): Promise<void> {
    await enqueueLayerTable("L1", readerSource());
  }

  it("registers the bytes under the table's own name", async () => {
    await build();
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
  });

  it("describes the reader, then creates the table WITHOUT geometry columns", async () => {
    await build();
    expect(sql[0]).toBe(
      "DESCRIBE SELECT * FROM read_cityjson('layer_1.city.json')",
    );
    expect(sql[1]).toBe(
      'CREATE OR REPLACE TABLE "layer_1" AS SELECT "id", "feature_id", "object_type", "parents", "bbox", "b3_h_dak_max", "bouwjaar" FROM read_cityjson(\'layer_1.city.json\')',
    );
  });

  it("counts the rows and drops the source buffer", async () => {
    await build();
    expect(sql[2]).toBe('SELECT COUNT(*) AS "n" FROM "layer_1"');
    expect(dropped).toEqual(["layer_1.city.json"]);
  });

  it("publishes the table with its column kinds, LoDs and row count", async () => {
    await build();
    const info = getLayerTable("L1");
    expect(info).toMatchObject({
      table: "layer_1",
      sourceName: "layer_1.city.json",
      reader: "read_cityjson",
      extension: "city.json",
      // The MOCKED provider's `new Uint8Array(16)` — asserting the number is
      // what proves the capture happens BEFORE `registerBuffer` detaches it.
      sourceBytes: 16,
      rowCount: 2231,
      lods: [
        { label: "1.2", suffix: "1_2" },
        { label: "2.2", suffix: "2_2" },
      ],
    });
    expect(info!.columns).toEqual([
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "feature_id", type: "VARCHAR", kind: "scalar" },
      { name: "object_type", type: "VARCHAR", kind: "scalar" },
      { name: "parents", type: "VARCHAR[]", kind: "nested" },
      { name: "bbox", type: "STRUCT(xmin DOUBLE)", kind: "nested" },
      { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
      { name: "bouwjaar", type: "BIGINT", kind: "castText" },
    ]);
    // The SAME function the caller passed, not a wrapper: the export re-runs
    // the loader's own re-fetch, and identity is what proves it.
    expect(info!.source).toBe(PROVIDER);
  });

  it("publishes a NULL row count when the COUNT itself failed", async () => {
    // A table that exists with an unknown size is a real state; "0 rows" over
    // a grid that then pages real data is a lie.
    failures = { "COUNT(*)": "Out of Memory Error: could not allocate" };
    await build();
    expect(getLayerTable("L1")).toMatchObject({ rowCount: null });
    expect(stateOf("L1")).toMatchObject({ state: "ready" });
  });

  it("mirrors the outcome into the store", async () => {
    const promise = enqueueLayerTable("L1", readerSource());
    expect(stateOf("L1")).toEqual({ state: "queued" });
    await promise;
    expect(stateOf("L1")).toMatchObject({ state: "ready" });
  });

  it("records a CREATE failure instead of throwing, and still drops the buffer", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await expect(build()).resolves.toBeUndefined();
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Binder Error: nope",
    });
    expect(getLayerTable("L1")).toBeNull();
    expect(dropped).toEqual(["layer_1.city.json"]);
  });

  it("never reuses a VFS name across layers", async () => {
    await build();
    await enqueueLayerTable("L2", {
      kind: "bytes",
      bytes: new Uint8Array(8),
      reader: "read_cityjsonseq",
      extension: "city.jsonl",
      provider: async () => new Uint8Array(8),
    });
    expect(registered.map((r) => r.name)).toEqual([
      "layer_1.city.json",
      "layer_2.city.jsonl",
    ]);
  });
});

describe("a failed build leaves nothing behind", () => {
  it("DROPs the table when a step AFTER the CREATE fails", async () => {
    // The fallback route runs six ALTERs and a DESCRIBE after its CREATE, so
    // a failure there strands a fully materialised table under a name nothing
    // will ever use again — memory held for the life of the page.
    describeRows = FALLBACK_DESCRIBE;
    failures = { 'DESCRIBE SELECT * FROM "layer_1"': "Catalog Error: boom" };
    await enqueueLayerTable("L1", { kind: "model", model: model() });

    expect(sql).toContain(
      "CREATE OR REPLACE TABLE \"layer_1\" AS SELECT * FROM read_json_auto('layer_1.json', sample_size = -1, field_appearance_threshold = 0, map_inference_threshold = -1)",
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "layer_1"');
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Catalog Error: boom",
    });
    expect(getLayerTable("L1")).toBeNull();
    // Exactly once: the builder's own `finally` dropped it and struck it off
    // the scratch set, so the cleanup has nothing left to re-drop.
    expect(dropped).toEqual(["layer_1.json"]);
  });

  it("refuses a file whose columns are ALL geometry", async () => {
    describeRows = [
      { column_name: "geometry_lod1_2", column_type: "BLOB" },
      { column_name: "material_lod1_2", column_type: "INTEGER[]" },
      { column_name: "template", column_type: "STRUCT(a INTEGER)" },
    ];
    await enqueueLayerTable("L1", readerSource());

    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "This file has no attribute columns to browse.",
    });
    expect(sql.some((s) => s.startsWith("CREATE OR REPLACE TABLE"))).toBe(
      false,
    );
    expect(dropped).toEqual(["layer_1.city.json"]);
  });
});

describe("rebuilding a layer that already has a table", () => {
  it("keeps the OLD table on screen while the replacement builds, then swaps", async () => {
    await enqueueLayerTable("L1", readerSource());
    const first = getLayerTable("L1")!;

    const open = holdEngine();
    const rebuild = enqueueLayerTable("L1", readerSource());
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: first,
      rebuilding: true,
    });
    await tick();
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: first,
      rebuilding: true,
    });
    expect(getLayerTable("L1")).toBe(first);

    open();
    await rebuild;

    const second = getLayerTable("L1")!;
    expect(second.table).toBe("layer_2");
    expect(stateOf("L1")).toEqual({ state: "ready", info: second });
  });

  it("retires the OLD table only AFTER the replacement is published", async () => {
    await enqueueLayerTable("L1", readerSource());
    await enqueueLayerTable("L1", readerSource());

    const createdSecond = sql.findIndex((s) =>
      s.startsWith('CREATE OR REPLACE TABLE "layer_2"'),
    );
    const countedSecond = sql.indexOf('SELECT COUNT(*) AS "n" FROM "layer_2"');
    const retiredFirst = sql.indexOf('DROP TABLE IF EXISTS "layer_1"');
    expect(createdSecond).toBeGreaterThanOrEqual(0);
    expect(countedSecond).toBeGreaterThan(createdSecond);
    // The whole point: the drop comes after the replacement is finished, never
    // before, so the layer is never without a table.
    expect(retiredFirst).toBeGreaterThan(countedSecond);
    expect(dropped).toContain("layer_1.city.json");
  });

  it("keeps the previous table when a REBUILD fails", async () => {
    await enqueueLayerTable("L1", readerSource());
    const first = getLayerTable("L1")!;

    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await enqueueLayerTable("L1", readerSource());

    expect(getLayerTable("L1")).toBe(first);
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: first,
      rebuilding: false,
    });
    // The old table was never touched — only the half-built replacement was.
    expect(sql).not.toContain('DROP TABLE IF EXISTS "layer_1"');
    expect(sql).toContain('DROP TABLE IF EXISTS "layer_2"');
  });

  it("REPORTS a failed rebuild that the store deliberately hides", async () => {
    // The store keeps the previous table `ready` so the grid does not blank —
    // which means a caller that asked for a refresh (the export dialog, about
    // to write the result out) cannot learn from the store that it did not
    // happen. The build says so itself.
    await enqueueLayerTable("L1", readerSource());
    const first = getLayerTable("L1")!;
    expect(stateOf("L1")).toEqual({ state: "ready", info: first });

    failures = {
      "DESCRIBE SELECT * FROM read_cityjson('layer_2.city.json')":
        "IO Error: boom",
    };
    const outcome = await enqueueLayerTable("L1", readerSource());
    expect(outcome).toEqual({ ok: false, message: "IO Error: boom" });
    // …while the entry itself still reads as a working table, as designed.
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: first,
      rebuilding: false,
    });
  });

  it("reports a build that SUCCEEDED, and one the engine refused", async () => {
    expect(await enqueueLayerTable("L1", readerSource())).toEqual({ ok: true });

    engineReady = false;
    expect(await enqueueLayerTable("L2", readerSource())).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
  });

  it("keeps the old table and parks the source when the engine goes down under a rebuild", async () => {
    await enqueueLayerTable("L1", readerSource());
    const first = getLayerTable("L1")!;

    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    expect(getLayerTable("L1")).toBe(first);
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: first,
      rebuilding: false,
    });

    engineReady = true;
    await retryEngine();
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_2" });
    expect(stateOf("L1")).toEqual({
      state: "ready",
      info: getLayerTable("L1")!,
    });
  });

  it("does NOT put a layer back to queued while its FIRST build is running", async () => {
    const open = holdEngine();
    const first = enqueueLayerTable("L1", readerSource());
    await tick();
    expect(stateOf("L1")).toEqual({ state: "building" });

    const second = enqueueLayerTable("L1", readerSource());
    // "queued" over "building" reads as the layer going backwards.
    expect(stateOf("L1")).toEqual({ state: "building" });

    open();
    await first;
    await second;
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_2" });
  });
});

describe("re-describing a table a run has written to", () => {
  it("publishes the new columns under the SAME table name", async () => {
    await enqueueLayerTable("L1", readerSource());
    const before = getLayerTable("L1")!;

    describeRows = [
      ...READER_DESCRIBE,
      { column_name: "extent_height_m", column_type: "DOUBLE" },
    ];
    await refreshLayerTableColumns("L1");

    const after = getLayerTable("L1")!;
    expect(after.columns.map((c) => c.name)).toContain("extent_height_m");
    expect(after.columns.find((c) => c.name === "extent_height_m")?.kind).toBe(
      "scalar",
    );
    // The NAME is what the stale watcher compares: a re-describe is not a
    // rebuild, and must not retire the layer's result cards.
    expect(after.table).toBe(before.table);
    // Both the registry and the store, because the next run reads the registry
    // (its `existing` set decides whether Undo restores or drops) and the grid
    // reads the store.
    expect(stateOf("L1")).toEqual({ state: "ready", info: after });
  });

  it("bails out when the table was REBUILT while it described", async () => {
    await enqueueLayerTable("L1", readerSource());
    const before = getLayerTable("L1")!;
    expect(before.table).toBe("layer_1");

    // A streaming settle lands between the DESCRIBE going out and its rows
    // coming back. The refresh describes a table that is no longer the layer's,
    // and publishing what it read would put the OLD table name back.
    onStatement = async () => {
      await enqueueLayerTable("L1", readerSource());
    };
    describeRows = [
      ...READER_DESCRIBE,
      { column_name: "extent_height_m", column_type: "DOUBLE" },
    ];
    await refreshLayerTableColumns("L1");

    const after = getLayerTable("L1")!;
    expect(after.table).toBe("layer_2");
    expect(stateOf("L1")).toEqual({ state: "ready", info: after });
  });

  it("leaves the entry alone when the DESCRIBE fails", async () => {
    await enqueueLayerTable("L1", readerSource());
    const before = getLayerTable("L1")!;

    failures = { DESCRIBE: "Binder Error: gone" };
    await refreshLayerTableColumns("L1");

    // The write is already committed; a failed re-read says nothing about it.
    expect(getLayerTable("L1")).toBe(before);
  });

  it("does nothing for a layer with no table", async () => {
    await refreshLayerTableColumns("nope");
    expect(stateOf("nope")).toBeUndefined();
  });
});

describe("the build queue", () => {
  it("serialises two builds, second only after the first has finished", async () => {
    const open = holdEngine();
    const a = enqueueLayerTable("L1", readerSource());
    const b = enqueueLayerTable("L2", readerSource());
    await tick();
    expect(sql).toEqual([]);

    open();
    await Promise.all([a, b]);

    const firstCounted = sql.indexOf('SELECT COUNT(*) AS "n" FROM "layer_1"');
    const secondDescribed = sql.indexOf(
      "DESCRIBE SELECT * FROM read_cityjson('layer_2.city.json')",
    );
    expect(firstCounted).toBeGreaterThanOrEqual(0);
    expect(secondDescribed).toBeGreaterThan(firstCounted);
  });
});

describe("waiting for the engine", () => {
  it("sends NOTHING until initDuckDB has resolved", async () => {
    // The window this closes: a snapshot restored at boot, or a file dropped
    // on the landing page, reaches the queue two seconds into a five-second
    // engine boot. Before this await, that layer's table failed for good.
    engineReady = false;
    const open = holdEngine();

    const build = enqueueLayerTable("L1", readerSource());
    await tick();
    expect(sql).toEqual([]);
    expect(registered).toEqual([]);

    engineReady = true;
    open();
    await build;

    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
  });

  it("records the not-running message and PARKS the source when the engine never came up", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());

    expect(sql).toEqual([]);
    expect(getLayerTable("L1")).toBeNull();
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "The analytics engine is not running.",
    });
  });

  it("retryEngine rebuilds what only the engine's absence had failed", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    expect(stateOf("L1")).toMatchObject({ state: "failed" });

    engineReady = true;
    await retryEngine();

    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(stateOf("L1")).toMatchObject({ state: "ready" });
  });

  it("retryEngine does nothing while the engine is STILL down", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    sql.length = 0;

    await retryEngine();
    expect(sql).toEqual([]);
    expect(stateOf("L1")).toMatchObject({ state: "failed" });
  });

  it("retryEngine REBUILDS across an ordinary boot — a boot is not a death", async () => {
    // THE REGRESSION THIS PAIR EXISTS FOR. A real boot bumps the generation
    // itself, synchronously, before its first await (`doInit`'s
    // `const gen = ++generation`, `duckdb.ts:405`) — so a check that captured
    // the number BEFORE `bootEngine()` would see it move on every successful
    // Retry and skip every parked rebuild, leaving those layers table-less for
    // the session with no error anywhere.
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    expect(stateOf("L1")).toMatchObject({ state: "failed" });
    sql.length = 0;

    engineReady = true;
    await retryEngine();

    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
  });

  it("…and ABANDONS them when a DEATH moved the engine under the boot", async () => {
    // `bootEngine` takes ~5 s for a 36 MB wasm module, and a worker can die
    // inside that window. Rebuilding into an engine that has already gone
    // writes `ready` entries over the invalidation — the exact state the
    // catalogue would then offer tools against.
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    sql.length = 0;

    // The boot runs (and bumps the generation, as a boot does); a death lands
    // DURING it and bumps it again. Only that second move is a reason to stop.
    engineReady = true;
    bootAlso = () => {
      engineGeneration += 1;
    };
    await retryEngine();

    expect(sql).toEqual([]);
    expect(getLayerTable("L1")).toBeNull();
  });

  it("still re-parks the source when it abandons, so the NEXT Retry works", async () => {
    // The generation check returns BEFORE `pendingSources.clear()`, which is
    // the whole reason the two guards are in that order: a death during the
    // boot must not cost the user their parked source.
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    engineReady = true;
    bootAlso = () => {
      engineGeneration += 1;
    };
    await retryEngine();

    // Second Retry, same engine this time.
    bootAlso = () => {};
    await retryEngine();
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
  });

  it("does NOT retry a table that failed on its own merits", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await enqueueLayerTable("L1", readerSource());
    expect(stateOf("L1")).toMatchObject({
      state: "failed",
      message: "Binder Error: nope",
    });
    sql.length = 0;

    // A bad file is still a bad file with the engine up; re-running it would
    // only fail again, and `retryEngine` is about ONE cause.
    await retryEngine();
    expect(sql).toEqual([]);
  });

  it("RE-PARKS a source it could not read, so Retry can try it again", async () => {
    engineReady = false;
    // A source whose rows cannot be read — the shape a provider failure takes
    // by the time it reaches the queue.
    let broken = true;
    const flaky = {
      kind: "resident" as const,
      records: () => {
        if (broken) throw new Error("the source could not be read");
        return [];
      },
    };
    await enqueueLayerTable("L1", flaky);

    // First retry: the engine is up, the source still is not.
    engineReady = true;
    await retryEngine();
    expect(getLayerTable("L1")).toBeNull();

    // Second retry: the blip is over. Without the re-park the source would be
    // gone and this could never succeed, however often the user clicked.
    broken = false;
    describeRows = [{ column_name: "id", column_type: "VARCHAR" }];
    countValue = 0;
    await retryEngine();
    expect(getLayerTable("L1")).not.toBeNull();
  });

  it("does NOT re-park a source whose layer was removed mid-retry", async () => {
    engineReady = false;
    const flaky = {
      kind: "resident" as const,
      records: () => {
        throw new Error("the source could not be read");
      },
    };
    await enqueueLayerTable("L1", flaky);

    engineReady = true;
    const retry = retryEngine();
    await dropLayerTable("L1");
    await retry;

    // A removed layer must not come back on the NEXT retry either.
    await retryEngine();
    expect(getLayerTable("L1")).toBeNull();
    expect(stateOf("L1")).toBeUndefined();
  });

  it("does NOT re-park when the drop lands AFTER the retry took its snapshot", async () => {
    // The test above is won by `dropLayerTable`'s SYNCHRONOUS
    // `pendingSources.delete`: the retry has not snapshotted yet, so its
    // `pending` list comes back empty and `cancelBefore` never decides
    // anything. The only window where the guard is what answers is a drop
    // issued while the retry's own build is in flight — so the source itself
    // issues it, from inside `records()`.
    engineReady = false;
    let dropPromise: Promise<void> | null = null;
    const flaky = {
      kind: "resident" as const,
      records: () => {
        dropPromise ??= dropLayerTable("L1");
        throw new Error("the source could not be read");
      },
    };
    await enqueueLayerTable("L1", flaky);
    // The engine-down path returns before `records()`, so nothing dropped yet.
    expect(dropPromise).toBeNull();
    expect(stateOf("L1")).toMatchObject({ state: "failed" });

    engineReady = true;
    await retryEngine();
    await dropPromise;

    // Re-parking here would resurrect a layer the user removed.
    sql.length = 0;
    await retryEngine();
    expect(sql).toEqual([]);
    expect(getLayerTable("L1")).toBeNull();
    expect(stateOf("L1")).toBeUndefined();
  });

  it("abandons a retry whose layer was dropped while its PROVIDER was in flight", async () => {
    // The provider is a network fetch. `enqueueLayerTable`'s own supersede
    // check cannot catch this: the build's sequence number is taken AFTER the
    // drop, so it sits above the drop's `cancelBefore` and the build runs —
    // giving a removed layer a live table and a `ready` entry that nothing will
    // ever drop, because the drop's queued task has already been and gone.
    engineReady = false;
    let dropPromise: Promise<void> | null = null;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => {
        dropPromise ??= dropLayerTable("L1");
        await dropPromise; // resolve only once the drop has fully settled
        return new Uint8Array(32);
      },
    });
    expect(dropPromise).toBeNull();

    engineReady = true;
    await retryEngine();
    await dropPromise;

    expect(sql.some((s) => s.startsWith("CREATE OR REPLACE TABLE"))).toBe(
      false,
    );
    expect(getLayerTable("L1")).toBeNull();
    expect(stateOf("L1")).toBeUndefined();

    // And it was not re-parked either.
    sql.length = 0;
    await retryEngine();
    expect(sql).toEqual([]);
  });

  it("leaves NO failed entry when a dropped layer's provider then rejects", async () => {
    engineReady = false;
    let dropPromise: Promise<void> | null = null;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => {
        dropPromise ??= dropLayerTable("L1");
        await dropPromise;
        throw new Error("the file has gone");
      },
    });

    engineReady = true;
    await retryEngine();
    await dropPromise;

    // A `failed` entry here would be an ORPHAN: the drop's task has already
    // cleared the store and will never run again.
    expect(stateOf("L1")).toBeUndefined();
    expect(getLayerTable("L1")).toBeNull();
  });

  it("does NOT re-park a provider-less source whose array the build consumed", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: null,
    });

    engineReady = true;
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await retryEngine();
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Binder Error: nope",
    });

    // `registerBuffer` DETACHED that array. Re-parking it would register zero
    // bytes on the next Retry and build an empty table with no error anywhere —
    // the same refusal `parkConsumed` makes on the mid-build path.
    sql.length = 0;
    await retryEngine();
    expect(sql).toEqual([]);
  });
});

describe("parking a source while the engine is down", () => {
  it("parks a reader source WITHOUT its array and re-obtains bytes from the provider", async () => {
    // A dropped 200 MB file is already on the heap twice while DuckDB boots;
    // pinning a third reference in a module map for an engine that may never
    // come up is how the tab dies of memory rather than of a message.
    engineReady = false;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(32),
    });
    expect(registered).toEqual([]);

    engineReady = true;
    await retryEngine();

    // 32, not 16: what got registered came from the PROVIDER, so the parked
    // entry cannot have been holding the original array.
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 32 }]);
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
  });

  it("keeps the raw bytes only when there is NO provider to re-obtain them", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: null,
    });

    engineReady = true;
    await retryEngine();

    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
    expect(getLayerTable("L1")).toMatchObject({ source: null });
  });

  it("parks via the provider when the engine dies AT REGISTRATION", async () => {
    registerAccepts = false;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(32),
    });
    // The cause is the engine, not the file, so it reads as the engine.
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "The analytics engine is not running.",
    });

    registerAccepts = true;
    engineReady = true;
    await retryEngine();
    expect(registered).toEqual([{ name: "layer_2.city.json", length: 32 }]);
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_2" });
  });

  it("fails outright when the engine dies and the bytes cannot be re-obtained", async () => {
    // A detached array would register as zero bytes and build an EMPTY table
    // with no error at all — strictly worse than an honest failure.
    registerAccepts = false;
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: null,
    });
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "The source bytes could not be handed to DuckDB.",
    });

    engineReady = true;
    sql.length = 0;
    await retryEngine();
    expect(sql).toEqual([]);
  });
});

describe("flat-fallback layer table", () => {
  it("registers JSON rows and creates the table through read_json_auto", async () => {
    describeRows = [
      ...FALLBACK_DESCRIBE,
      { column_name: "bouwjaar", column_type: "BIGINT" },
    ];
    countValue = 1;
    await enqueueLayerTable("L1", { kind: "model", model: model() });

    expect(registered[0]!.name).toBe("layer_1.json");
    expect(sql[0]).toBe(
      "CREATE OR REPLACE TABLE \"layer_1\" AS SELECT * FROM read_json_auto('layer_1.json', sample_size = -1, field_appearance_threshold = 0, map_inference_threshold = -1)",
    );
    // EVERY fixed column is forced, in the published vocabulary's order.
    // `read_json_auto` types an all-NULL `parents` as JSON rather than
    // VARCHAR[], and a DATE-SHAPED id as DATE — either one silently diverges
    // the fallback schema from the reader's. Each ALTER is a no-op when the
    // inference was already right.
    expect(sql.slice(1, 7)).toEqual([
      'ALTER TABLE "layer_1" ALTER COLUMN "id" TYPE VARCHAR',
      'ALTER TABLE "layer_1" ALTER COLUMN "feature_id" TYPE VARCHAR',
      'ALTER TABLE "layer_1" ALTER COLUMN "object_type" TYPE VARCHAR',
      'ALTER TABLE "layer_1" ALTER COLUMN "parents" TYPE VARCHAR[]',
      'ALTER TABLE "layer_1" ALTER COLUMN "children" TYPE VARCHAR[]',
      `ALTER TABLE "layer_1" ALTER COLUMN "bbox" TYPE ${BBOX_TYPE}`,
    ]);
    expect(sql[7]).toBe('DESCRIBE SELECT * FROM "layer_1"');
    expect(dropped).toEqual(["layer_1.json"]);

    const info = getLayerTable("L1");
    expect(info).toMatchObject({
      reader: null,
      source: null,
      extension: null,
      sourceBytes: null,
      lods: [],
      rowCount: 1,
    });
  });

  it("creates an EMPTY typed table when a streaming layer has no residents yet", async () => {
    describeRows = FALLBACK_DESCRIBE;
    countValue = 0;
    await enqueueLayerTable("L9", { kind: "resident", records: () => [] });

    expect(registered).toEqual([]);
    expect(sql[0]).toBe(
      `CREATE OR REPLACE TABLE "layer_1" ("id" VARCHAR, "feature_id" VARCHAR, "object_type" VARCHAR, "parents" VARCHAR[], "children" VARCHAR[], "bbox" ${BBOX_TYPE})`,
    );
    expect(getLayerTable("L9")).toMatchObject({ rowCount: 0 });
  });

  it("declares the empty table from FLAT_PREFIX_COLUMNS itself", async () => {
    // Pinned to the array, not to a hand-written second copy of the
    // vocabulary: the fallback rows and the empty table must name the same
    // columns or a streaming layer's schema changes when its first cell lands.
    describeRows = FALLBACK_DESCRIBE;
    countValue = 0;
    await enqueueLayerTable("L9", { kind: "resident", records: () => [] });

    const names = [...sql[0]!.matchAll(/"([a-z_0-9]+)"/g)]
      .map((m) => m[1])
      .slice(1); // the first quoted name is the TABLE
    expect(names).toEqual([...FLAT_PREFIX_COLUMNS]);
  });

  it("reads the records lazily, at build time", async () => {
    const records = vi.fn(() => []);
    describeRows = [{ column_name: "id", column_type: "VARCHAR" }];
    const promise = enqueueLayerTable("L1", { kind: "resident", records });
    expect(records).not.toHaveBeenCalled();
    await promise;
    expect(records).toHaveBeenCalledTimes(1);
  });
});

/**
 * The worker died, in `markEngineDead`'s own order: the generation moves
 * FIRST, then the death is announced to the waiters — each dropped as it
 * fires, and while the status still reads `ready` — and only then is `failed`
 * published to the status subscribers.
 */
function killEngine(): void {
  engineGeneration += 1;
  for (const listener of Array.from(deathListeners)) {
    deathListeners.delete(listener);
    listener();
  }
  engineDead = true;
  for (const listener of Array.from(statusListeners)) listener();
}

/** Publish a status without a death, the way a boot does. */
function publishStatus(state: "initializing" | "failed"): void {
  engineDead = state === "failed";
  if (state === "initializing") engineReady = false;
  for (const listener of Array.from(statusListeners)) listener();
}

describe("the engine's death (spec §6.1)", () => {
  it("invalidates every live table rather than leaving it looking usable", async () => {
    // The database went with the worker. The entry and the registry both
    // describe a table that no longer exists anywhere, and a Retry reboots the
    // engine WITHOUT rebuilding them — so a catalogue row reading the rebooted
    // engine's `ready` would offer a tool that fails on a missing table.
    await enqueueLayerTable("L1", readerSource());
    expect(useLayerTableStore.getState().tables["L1"]?.state).toBe("ready");
    expect(getLayerTable("L1")).not.toBeNull();

    killEngine();

    expect(useLayerTableStore.getState().tables["L1"]).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    // The REGISTRY too: `getLayerTable` reads that and not the store, and it
    // is what a run's head-of-queue check asks.
    expect(getLayerTable("L1")).toBeNull();
  });

  it("says nothing about a boot that never came up", async () => {
    await enqueueLayerTable("L1", readerSource());
    engineReady = false;
    for (const listener of statusListeners) listener();
    expect(useLayerTableStore.getState().tables["L1"]?.state).toBe("ready");
  });
});

describe("a build the engine's death overtook", () => {
  it("abandons a build that was QUEUED when the engine died", async () => {
    // The invalidation marks every entry failed, and then the queue goes on
    // running the builds that were already on it. A build that does not know
    // its engine has gone writes `building` over the invalidation, asks
    // `initDuckDB` for an engine, and can publish `ready` for a table that was
    // never created in the database anyone is now talking to.
    await enqueueLayerTable("L1", readerSource());
    onStatement = async (statement) => {
      if (statement.startsWith("DESCRIBE")) killEngine();
    };
    const first = enqueueLayerTable("L1", readerSource());
    const second = enqueueLayerTable("L2", readerSource());
    await Promise.all([first, second]);

    expect(useLayerTableStore.getState().tables["L2"]).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L2")).toBeNull();
    // …and it never got as far as a table of its own.
    expect(sql.some((q) => q.includes("layer_3"))).toBe(false);
  });

  it("does not restore the old table when a build fails after the death", async () => {
    // The catch has two paths that would undo the invalidation: it puts the
    // captured `previous` back as `ready` (a table that died with the engine),
    // and it parks the source so `retryEngine` rebuilds it — which is the
    // rebuild this milestone deliberately does not do.
    await enqueueLayerTable("L1", readerSource());
    failures = { "CREATE OR REPLACE TABLE": "boom" };
    onStatement = async (statement) => {
      if (statement.startsWith("DESCRIBE")) killEngine();
    };
    await enqueueLayerTable("L1", readerSource());

    expect(useLayerTableStore.getState().tables["L1"]).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L1")).toBeNull();

    // The status bar's Retry reboots the engine. It revives what it PARKED —
    // and nothing was parked here, so the layer stays honestly table-less.
    engineDead = false;
    failures = {};
    await retryEngine();
    expect(useLayerTableStore.getState().tables["L1"]).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
  });
});

describe("a build whose engine went while it ran", () => {
  it("abandons a build whose engine died during its CLEANUP", async () => {
    // The catch checks the engine once, before `discardHalfBuilt` — and that
    // cleanup is itself an await. A death inside it slips past the only guard,
    // and what follows parks the source for a Retry that must not rebuild it,
    // or puts the captured `ready` back over a table that no longer exists.
    await enqueueLayerTable("L1", readerSource());
    failures = { "CREATE OR REPLACE TABLE": "boom" };
    const held = deferred();
    holdStatement = { needle: "DROP TABLE", promise: held.promise };
    const building = enqueueLayerTable("L1", readerSource());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.startsWith("DROP TABLE"))).toBe(true),
    );

    killEngine();
    held.resolve();
    await building;

    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L1")).toBeNull();

    // Not parked: a Retry reboots the engine and must find nothing to revive.
    engineDead = false;
    failures = {};
    holdStatement = null;
    await retryEngine();
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
  });

  it("releases a build whose statement NEVER settles, and the queue behind it", async () => {
    // THE ONE THING THE REAL ENGINE DOES that every other case here does not
    // model: duckdb-wasm drops the promises of the requests that were in flight
    // when its worker died — its `onError` clears the pending map WITHOUT
    // rejecting them — so the `CREATE` this build is awaiting NEVER settles.
    // Nothing resolves it by hand below, because nothing would in a browser.
    //
    // Unreleased, the build sits on that await for the life of the page holding
    // the shared FIFO, and every later build and every later run queues behind
    // a task that can never finish: the table panel's entries stay `building`
    // under a spinner and a Run does nothing at all.
    const never = new Promise<void>(() => {});
    holdStatement = { needle: "CREATE OR REPLACE TABLE", promise: never };
    const building = enqueueLayerTable("L1", readerSource());
    // Enqueued BEFORE the death, so it is genuinely stuck behind the stranded
    // build rather than starting on a queue that had already drained.
    const behind = enqueueLayerTable("L2", readerSource());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.startsWith("CREATE OR REPLACE TABLE"))).toBe(
        true,
      ),
    );
    const issued = sql.length;

    killEngine();

    expect(await building).toEqual({
      ok: false,
      message: "Analytics engine stopped",
    });
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L1")).toBeNull();
    // No further SQL: the half-built table died with the database, and a DROP
    // for a corpse is nothing to hold the queue on.
    expect(sql.slice(issued)).toEqual([]);
    // …and the FIFO accepted the next task.
    expect(await behind).toEqual({
      ok: false,
      message: "Analytics engine stopped",
    });
  });

  it("abandons a build whose engine was REPLACED under it", async () => {
    // A worker that dies while the status is `initializing` publishes `failed`
    // from there, which is not the `ready` → `failed` transition the
    // invalidation watches — so nothing invalidates, and a build that measures
    // only that transition happily publishes a table into a database that has
    // been replaced since. The ENGINE GENERATION is the fact that does not
    // depend on catching a particular transition, and the abandoning build
    // writes the failed entry itself rather than assuming someone else did.
    await enqueueLayerTable("L1", readerSource());
    const held = deferred();
    // THIS build's DESCRIBE, by the table name in it: a bare "DESCRIBE" is
    // already in `sql` from the L1 build above, so waiting on that would let
    // the test run on while L2 was still at the head of the queue — and prove
    // the head guard instead of the mid-build one this case is about.
    const describeL2 = "DESCRIBE SELECT * FROM read_cityjson('layer_2";
    holdStatement = { needle: describeL2, promise: held.promise };
    const building = enqueueLayerTable("L2", readerSource());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.startsWith(describeL2))).toBe(true),
    );

    publishStatus("initializing");
    engineGeneration += 1;
    engineReady = true;
    publishStatus("failed");
    engineDead = false;

    held.resolve();
    await building;

    expect(stateOf("L2")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L2")).toBeNull();
  });

  it("leaves a failed entry, never `building`, when the engine is not ready at the publish", async () => {
    // The readiness-only branch returned without writing anything, on the
    // assumption that the invalidation had already spoken. It has not when the
    // status left `ready` by any other route, and the entry then sits on
    // `building` for ever under a spinner nothing will ever stop.
    const held = deferred();
    holdStatement = { needle: "COUNT(*)", promise: held.promise };
    const building = enqueueLayerTable("L1", readerSource());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(*)"))).toBe(true),
    );
    engineReady = false;
    held.resolve();
    await building;

    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
  });
});

describe("a build enqueued before the engine came up", () => {
  /** Every value `L2`'s entry took, in order, so an intermediate write the
   *  final state hides can be asserted against. */
  function recordEntries(layerId: string): {
    seen: Array<LayerTableState | null>;
    stop: () => void;
  } {
    const seen: Array<LayerTableState | null> = [];
    const stop = useLayerTableStore.subscribe((s) => {
      seen.push(s.tables[layerId] ?? null);
    });
    return { seen, stop };
  }

  it("abandons a build the death caught while it was still QUEUED, without asking for an engine", async () => {
    // Both builds are enqueued before the boot, so neither has a generation to
    // be loyal to; the first adopts the engine `initDuckDB` brings up and the
    // second is still on the queue when that engine dies. Its own generation
    // check cannot see the death — it never bound one — so the INVALIDATION is
    // what the head guard has to read, or the build writes `building` over it,
    // asks for an engine and adopts the replacement.
    publishStatus("initializing");
    const open = holdEngine();
    const describeL1 = "DESCRIBE SELECT * FROM read_cityjson('layer_1";
    const held = deferred();
    holdStatement = { needle: describeL1, promise: held.promise };
    const first = enqueueLayerTable("L1", readerSource());
    const second = enqueueLayerTable("L2", readerSource());
    await tick();

    // The boot lands, and the first build starts against it.
    engineReady = true;
    open();
    await vi.waitFor(() =>
      expect(sql.some((q) => q.startsWith(describeL1))).toBe(true),
    );
    const { seen, stop } = recordEntries("L2");
    initCalls = 0;

    killEngine();
    held.resolve();
    await Promise.all([first, second]);
    stop();

    expect(stateOf("L2")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L2")).toBeNull();
    // Never `building`, and it never asked for an engine it has no business
    // using — nor made a table of its own.
    expect(seen.map((entry) => entry?.state ?? null)).not.toContain("building");
    expect(initCalls).toBe(0);
    expect(sql.some((q) => q.includes("layer_"))).toBe(true);
    expect(sql.some((q) => q.includes("layer_2"))).toBe(false);
  });

  it("abandons a build whose engine died DURING the initialization it was awaiting, and parks nothing", async () => {
    // The death is published from `initializing`, which is not the
    // `ready` → `failed` transition — so the invalidation has to key on the
    // DEATH itself, and the build, which has no generation yet, has to read
    // the not-ready status below as a death rather than as "not up YET".
    // Parking it would hand the source to `retryEngine`, which is the rebuild
    // this milestone deliberately does not do.
    publishStatus("initializing");
    const open = holdEngine();
    const building = enqueueLayerTable("L1", readerSource());
    await tick();

    killEngine();
    open();
    await building;

    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
    expect(getLayerTable("L1")).toBeNull();
    expect(sql).toEqual([]);

    // A Retry reboots the engine and must find nothing parked to revive.
    engineDead = false;
    engineReady = true;
    await retryEngine();
    expect(stateOf("L1")).toEqual({
      state: "failed",
      message: "Analytics engine stopped",
    });
  });
});

describe("a build the removal and the death both overtook", () => {
  it("lets the REMOVAL own the entry when the engine dies during the cleanup", async () => {
    // Abandonment and removal both want the entry, and removal wins: the layer
    // is gone from the app, so a `failed` card written after its drop is a card
    // for a layer nobody can see. The drop's own queued task clears it again a
    // moment later, which is exactly why the FINAL state cannot show this —
    // every value the entry took after the removal has to be watched.
    await enqueueLayerTable("L1", readerSource());
    failures = { "CREATE OR REPLACE TABLE": "boom" };
    const held = deferred();
    holdStatement = { needle: "DROP TABLE", promise: held.promise };
    const building = enqueueLayerTable("L1", readerSource());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.startsWith("DROP TABLE"))).toBe(true),
    );

    const removed = dropLayerTable("L1");
    const seen: Array<LayerTableState | null> = [];
    const stop = useLayerTableStore.subscribe((s) => {
      seen.push(s.tables["L1"] ?? null);
    });
    killEngine();
    held.resolve();
    await Promise.all([building, removed]);
    stop();

    expect(seen.filter((entry) => entry !== null)).toEqual([]);
    expect(stateOf("L1")).toBeUndefined();
    expect(getLayerTable("L1")).toBeNull();
  });
});

describe("a derived layer's table is adopted, never built", () => {
  it("mints a name from the SAME counter an ordinary build uses", () => {
    // A separate counter would eventually collide with `layer_N`, and the
    // collision would be a silent CREATE OR REPLACE over a live table.
    const a = nextTableName();
    const b = nextTableName();
    expect(a).toMatch(/^layer_\d+$/);
    expect(b).not.toBe(a);
  });

  it("seeds a READY entry that nothing will rebuild", () => {
    const info = {
      table: "layer_9",
      sourceName: "layer_1.city.json",
      source: null,
      reader: "read_cityjson" as const,
      extension: "city.json" as const,
      sourceBytes: null,
      sourceFeatureIds: ["a", "b"],
      columns: [{ name: "id", type: "VARCHAR", kind: "scalar" as const }],
      lods: [{ label: "2.2", suffix: "2_2" }],
      rowCount: 3,
    };
    adoptLayerTable("L-derived", info);
    const entry = useLayerTableStore.getState().tables["L-derived"];
    expect(entry?.state).toBe("ready");
    expect(entry?.state === "ready" ? entry.info : null).toEqual(info);
    // And the REGISTRY, not only the store — `getLayerTable` is what a run and
    // an export read, and an entry only the store knew about would give a
    // derived layer a grid and no tools.
    expect(getLayerTable("L-derived")).toEqual(info);
  });
});
