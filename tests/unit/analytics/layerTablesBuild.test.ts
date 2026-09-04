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

vi.mock("../../../src/analytics/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
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
      if (initGate) await initGate;
    }),
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
    registerBuffer: vi.fn(async (name: string, bytes: Uint8Array) => {
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
  enqueueLayerTable,
  getLayerTable,
  resetLayerTablesForTest,
  retryEngine,
  useLayerTableStore,
} = await import("../../../src/analytics/layerTables");
import type { CityModel } from "../../../src/domain/citymodel/types";

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

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  describeRows = READER_DESCRIBE;
  countValue = 2231;
  failures = {};
  engineReady = true;
  initGate = null;
  resetLayerTablesForTest();
  useLayerTableStore.setState({ tables: {} });
});

describe("reader-backed layer table", () => {
  async function build(): Promise<void> {
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    });
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
    expect(info!.source).toBeTypeOf("function");
  });

  it("mirrors the outcome into the store", async () => {
    const promise = enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    });
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "queued",
    });
    await promise;
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("records a CREATE failure instead of throwing, and still drops the buffer", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await expect(build()).resolves.toBeUndefined();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
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

describe("waiting for the engine", () => {
  function readerSource() {
    return {
      kind: "bytes" as const,
      bytes: new Uint8Array(16),
      reader: "read_cityjson" as const,
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    };
  }

  it("sends NOTHING until initDuckDB has resolved", async () => {
    // The window this closes: a snapshot restored at boot, or a file dropped
    // on the landing page, reaches the queue two seconds into a five-second
    // engine boot. Before this await, that layer's table failed for good.
    engineReady = false;
    let openGate!: () => void;
    initGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const build = enqueueLayerTable("L1", readerSource());
    await Promise.resolve();
    await Promise.resolve();
    expect(sql).toEqual([]);
    expect(registered).toEqual([]);

    engineReady = true;
    openGate();
    await build;

    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
  });

  it("records the not-running message and KEEPS the source when the engine never came up", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());

    expect(sql).toEqual([]);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "failed",
      message: "The analytics engine is not running.",
    });
  });

  it("retryEngine rebuilds what only the engine's absence had failed", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
    });

    engineReady = true;
    await retryEngine();

    // The SAME bytes: on the refused path `registerFileBuffer` was never
    // called, so the array was never transferred and never detached.
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("retryEngine does nothing while the engine is STILL down", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    sql.length = 0;

    await retryEngine();
    expect(sql).toEqual([]);
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
    });
  });

  it("does NOT retry a table that failed on its own merits", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await enqueueLayerTable("L1", readerSource());
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
      message: "Binder Error: nope",
    });
    sql.length = 0;

    // A bad file is still a bad file with the engine up; re-running it would
    // only fail again, and `retryEngine` is about ONE cause.
    await retryEngine();
    expect(sql).toEqual([]);
  });
});

describe("flat-fallback layer table", () => {
  it("registers JSON rows and creates the table through read_json_auto", async () => {
    describeRows = [
      { column_name: "id", column_type: "VARCHAR" },
      { column_name: "feature_id", column_type: "VARCHAR" },
      { column_name: "object_type", column_type: "VARCHAR" },
      { column_name: "parents", column_type: "VARCHAR[]" },
      { column_name: "children", column_type: "VARCHAR[]" },
      { column_name: "bouwjaar", column_type: "BIGINT" },
    ];
    countValue = 1;
    await enqueueLayerTable("L1", { kind: "model", model: model() });

    expect(registered[0]!.name).toBe("layer_1.json");
    expect(sql[0]).toBe(
      "CREATE OR REPLACE TABLE \"layer_1\" AS SELECT * FROM read_json_auto('layer_1.json')",
    );
    // read_json_auto types an all-NULL `parents` as JSON, not VARCHAR[], so
    // the fallback schema would diverge from the reader's without these. Both
    // are no-ops when the inference was already right.
    expect(sql[1]).toBe(
      'ALTER TABLE "layer_1" ALTER COLUMN "parents" TYPE VARCHAR[]',
    );
    expect(sql[2]).toBe(
      'ALTER TABLE "layer_1" ALTER COLUMN "children" TYPE VARCHAR[]',
    );
    expect(sql[3]).toBe('DESCRIBE SELECT * FROM "layer_1"');
    expect(dropped).toEqual(["layer_1.json"]);

    const info = getLayerTable("L1");
    expect(info).toMatchObject({
      reader: null,
      source: null,
      lods: [],
      rowCount: 1,
    });
  });

  it("creates an EMPTY typed table when a streaming layer has no residents yet", async () => {
    describeRows = [
      { column_name: "id", column_type: "VARCHAR" },
      { column_name: "feature_id", column_type: "VARCHAR" },
      { column_name: "object_type", column_type: "VARCHAR" },
      { column_name: "parents", column_type: "VARCHAR[]" },
      { column_name: "children", column_type: "VARCHAR[]" },
    ];
    countValue = 0;
    await enqueueLayerTable("L9", { kind: "resident", records: () => [] });

    expect(registered).toEqual([]);
    expect(sql[0]).toBe(
      'CREATE OR REPLACE TABLE "layer_1" ("id" VARCHAR, "feature_id" VARCHAR, "object_type" VARCHAR, "parents" VARCHAR[], "children" VARCHAR[])',
    );
    expect(getLayerTable("L9")).toMatchObject({ rowCount: 0 });
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
