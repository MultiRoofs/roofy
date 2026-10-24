/**
 * The registry's COMPOSITE key — `${layerId}::${family}` — and the resolver
 * every consumer that does not know about families goes through.
 *
 * Ruling R-C′: one layer can now own several tables (one per CityParquet object
 * family), so the registry cannot be keyed by the layer id alone. The whole
 * point of the spelling tested here is that `family === null` maps back to the
 * BARE layer id, so every single-table layer in the app — static, streaming,
 * derived — keeps the key it has always had and every consumer that looks a
 * table up by layer id keeps working untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];

vi.mock("../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
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
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    onEngineDeath: vi.fn(() => () => {}),
    getDuckDBStatus: vi.fn(() => ({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "unloaded" },
      },
      loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
      platform: "wasm_eh",
    })),
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
  adoptLayerTable,
  dropLayerTable,
  dropLayerTables,
  enqueueLayerTable,
  getLayerTable,
  hasFileBackedTable,
  layerTableKey,
  parseTableKey,
  resetLayerTablesForTest,
  resolveActiveTable,
  useLayerTableStore,
} = await import("../../../src/insights/layerTables");

type LayerTable = ReturnType<typeof getLayerTable>;

/** A minimal ready entry, as `familyViews` and `deriveLayer` publish one. */
function info(table: string, family: string | null, fileBacked: boolean) {
  return {
    table,
    sourceName: fileBacked ? `${table}.parquet` : null,
    source: null,
    reader: null,
    extension: null,
    sourceBytes: null,
    columns: [],
    lods: [],
    sourceFeatureIds: null,
    rowCount: 2,
    fileBacked,
    familyKey: family,
    sourceCrs: fileBacked ? "EPSG:6697" : null,
  } as NonNullable<LayerTable>;
}

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  resetLayerTablesForTest();
});

describe("layerTableKey / parseTableKey", () => {
  it("maps a null family to the BARE layer id, so nothing else moves", () => {
    expect(layerTableKey("layer-a", null)).toBe("layer-a");
    expect(parseTableKey("layer-a")).toEqual({
      layerId: "layer-a",
      family: null,
    });
  });

  it("round-trips a family key", () => {
    const key = layerTableKey("layer-a", "building");
    expect(key).toBe("layer-a::building");
    expect(parseTableKey(key)).toEqual({
      layerId: "layer-a",
      family: "building",
    });
  });

  it("splits at the FIRST separator, so a family may contain one", () => {
    // A family key comes from a manifest asset key or an href basename, which
    // this app does not get to constrain; a layer id is a UUID and never
    // carries `::`, so the first occurrence is always the boundary.
    const key = layerTableKey("layer-a", "east::building");
    expect(parseTableKey(key)).toEqual({
      layerId: "layer-a",
      family: "east::building",
    });
  });
});

describe("getLayerTable", () => {
  it("answers per family, and by layer id alone for a single-table layer", () => {
    adoptLayerTable("L", info("layer_1", null, false));
    adoptLayerTable("L", info("layer_2", "building", true));

    expect(getLayerTable("L")?.table).toBe("layer_1");
    expect(getLayerTable("L", "building")?.table).toBe("layer_2");
    expect(getLayerTable("L", "bridge")).toBeNull();
  });

  it("keys the STORE by the same composite spelling", () => {
    adoptLayerTable("L", info("layer_2", "building", true));
    const tables = useLayerTableStore.getState().tables;
    expect(Object.keys(tables)).toEqual(["L::building"]);
  });
});

describe("resolveActiveTable", () => {
  it("is null for a layer with no table at all", () => {
    expect(resolveActiveTable("L")).toBeNull();
  });

  it("answers the bare table for a single-table layer", () => {
    adoptLayerTable("L", info("layer_1", null, false));
    expect(resolveActiveTable("L")).toEqual({
      key: "L",
      layerId: "L",
      familyKey: null,
      info: getLayerTable("L"),
    });
  });

  it("prefers a FILE-BACKED family over the layer's resident table", () => {
    // The lifecycle enqueues a resident table for every streaming layer as it
    // is added, before any family view exists. Once the view is there it is
    // strictly better data — it covers the whole file rather than whatever the
    // camera has delivered — so the resolver must not keep answering with the
    // resident one.
    adoptLayerTable("L", info("layer_1", null, false));
    adoptLayerTable("L", info("layer_7", "building", true));
    expect(resolveActiveTable("L")).toMatchObject({
      key: "L::building",
      familyKey: "building",
    });
  });

  it("answers the FIRST registered family when several are file-backed", () => {
    adoptLayerTable("L", info("layer_7", "building", true));
    adoptLayerTable("L", info("layer_8", "bridge", true));
    expect(resolveActiveTable("L")?.familyKey).toBe("building");
  });

  it("does not answer with another layer's family table", () => {
    adoptLayerTable("OTHER", info("layer_7", "building", true));
    expect(resolveActiveTable("L")).toBeNull();
  });
});

describe("hasFileBackedTable", () => {
  it("is true as soon as ONE of the layer's tables reads from the file", () => {
    adoptLayerTable("L", info("layer_1", null, false));
    expect(hasFileBackedTable("L")).toBe(false);
    adoptLayerTable("L", info("layer_7", "building", true));
    expect(hasFileBackedTable("L")).toBe(true);
  });
});

describe("retiring a file-backed table", () => {
  it("DROPs a VIEW, not a table", async () => {
    // DuckDB REFUSES `DROP TABLE IF EXISTS` over a view ("is of type View,
    // trying to drop type Table" — measured in the integration suite), and
    // `retire` only warns about a failed drop: the view would survive under a
    // name nothing will ever use again, holding its source registration open
    // for the life of the page.
    adoptLayerTable("L", info("layer_7", "building", true));
    await dropLayerTable("L", "building");
    expect(sql).toContain('DROP VIEW IF EXISTS "layer_7"');
    expect(sql.some((s) => s.startsWith("DROP TABLE"))).toBe(false);
    expect(dropped).toContain("layer_7.parquet");
  });
});

describe("dropLayerTables", () => {
  it("takes EVERY family of one layer, and leaves other layers alone", async () => {
    adoptLayerTable("L", info("layer_1", null, false));
    adoptLayerTable("L", info("layer_7", "building", true));
    adoptLayerTable("L", info("layer_8", "bridge", true));
    adoptLayerTable("OTHER", info("layer_9", "building", true));

    await dropLayerTables("L");

    expect(getLayerTable("L")).toBeNull();
    expect(getLayerTable("L", "building")).toBeNull();
    expect(getLayerTable("L", "bridge")).toBeNull();
    expect(Object.keys(useLayerTableStore.getState().tables)).toEqual([
      "OTHER::building",
    ]);
    expect(sql).toContain('DROP VIEW IF EXISTS "layer_7"');
    expect(sql).toContain('DROP VIEW IF EXISTS "layer_8"');
    expect(sql).toContain('DROP TABLE IF EXISTS "layer_1"');
  });

  it("clears a FAMILY entry the engine's death left failed", async () => {
    // A death condemns every family's table and empties the registry, so the
    // only trace of `L::building` is the store's own `failed` card. Without the
    // store in the key scan that card would sit in the panel — "Analytics engine
    // stopped" — for a layer that has been removed.
    useLayerTableStore.setState({
      tables: {
        "L::building": {
          state: "failed",
          message: "Analytics engine stopped",
        },
      },
    });

    await dropLayerTables("L");

    expect(useLayerTableStore.getState().tables).toEqual({});
  });

  it("is quiet for a layer that never had a table", async () => {
    await dropLayerTables("nobody");
    expect(sql).toEqual([]);
  });
});

describe("a single-table layer's build", () => {
  it("still lands under the BARE layer id", async () => {
    await enqueueLayerTable("L", { kind: "resident", records: () => [] });
    expect(Object.keys(useLayerTableStore.getState().tables)).toEqual(["L"]);
    const table = getLayerTable("L");
    expect(table?.fileBacked).toBe(false);
    expect(table?.familyKey).toBeNull();
  });
});
