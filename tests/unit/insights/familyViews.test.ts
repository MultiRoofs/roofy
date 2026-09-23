/**
 * `ensureFamilyView`: register a CityParquet family's file ONCE, then publish
 * its table as a VIEW over `read_parquet` (ruling R-B′).
 *
 * The engine is mocked, so what these cases pin is the DECISIONS: which
 * statements are sent and in what order, how identifiers are quoted (real
 * PLATEAU files have columns with spaces and non-ASCII names), that a second
 * call for the same family costs no second registration and no second view
 * name, and that every failure comes back as an outcome rather than a throw.
 * The SQL itself is exercised against a real DuckDB in
 * `tests/integration/duckdb/familyViews.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];
/** Every `registerParquetUrl` / `registerParquetFile` call. */
const registered: Array<{ kind: "url" | "file"; name: string; at: unknown }> =
  [];
/** The DESCRIBE answer, as DuckDB's `column_name`/`column_type` rows. */
let describeRows: Array<{ column_name: string; column_type: string }> = [];
/** When set, the next registration refuses with this message. */
let registerFailure: string | null = null;
/** When set, every DESCRIBE fails with this message. */
let describeFailure: string | null = null;
/** When set, every CREATE fails with this message. */
let createFailure: string | null = null;
let engineReady = true;
/** Holds every DESCRIBE until it is released — the window a drop lands in. */
let describeGate: { promise: Promise<void>; open: () => void } | null = null;
/** The death listeners `onEngineDeath` handed out, so a case can fire one. */
let deathListeners: Array<() => void> = [];

vi.mock("../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (!engineReady) {
      return {
        ok: false as const,
        message: "The analytics engine is not running.",
      };
    }
    if (statement.startsWith("DESCRIBE")) {
      if (describeGate) await describeGate.promise;
      return describeFailure === null
        ? { ok: true as const, columns: [], rows: describeRows }
        : { ok: false as const, message: describeFailure };
    }
    if (statement.startsWith("CREATE")) {
      return createFailure === null
        ? { ok: true as const, columns: [], rows: [] }
        : { ok: false as const, message: createFailure };
    }
    if (statement.includes("COUNT(*)")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 884106 }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.push(listener);
      return () => {
        deathListeners = deathListeners.filter((l) => l !== listener);
      };
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
    registerBuffer: vi.fn(async () => true),
    registerParquetUrl: vi.fn(async (name: string, url: string) => {
      registered.push({ kind: "url", name, at: url });
      return registerFailure === null
        ? { ok: true as const }
        : { ok: false as const, message: registerFailure };
    }),
    registerParquetFile: vi.fn(async (name: string, file: File) => {
      registered.push({ kind: "file", name, at: file });
      return registerFailure === null
        ? { ok: true as const }
        : { ok: false as const, message: registerFailure };
    }),
    dropRegisteredFile: vi.fn(async (name: string) => {
      dropped.push(name);
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
  buildFamilyViewSql,
  describeParquetSql,
  dropFamilyView,
  dropFamilyViews,
  ensureFamilyView,
  keptFamilyColumns,
  resetFamilyViewsForTest,
} = await import("../../../src/insights/familyViews");
const { getLayerTable, resetLayerTablesForTest, useLayerTableStore } =
  await import("../../../src/insights/layerTables");

/** The real file's vocabulary, as a DESCRIBE reports it. */
const YOKOHAMA_COLUMNS = [
  { column_name: "id", column_type: "VARCHAR" },
  { column_name: "feature_id", column_type: "VARCHAR" },
  { column_name: "object_type", column_type: "VARCHAR" },
  { column_name: "parents", column_type: "VARCHAR[]" },
  { column_name: "children", column_type: "VARCHAR[]" },
  {
    column_name: "bbox",
    column_type:
      "STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)",
  },
  { column_name: "geometry_lod0_0", column_type: "BLOB" },
  { column_name: "geometry_properties_lod0_0", column_type: "JSON" },
  { column_name: "geometry_lod2_2", column_type: "BLOB" },
  { column_name: "material_lod2_2", column_type: "JSON" },
  { column_name: "texture_lod2_2", column_type: "JSON" },
  { column_name: "template", column_type: "JSON" },
  { column_name: "measuredHeight", column_type: "DOUBLE" },
  { column_name: "other_attributes", column_type: "JSON" },
];

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  registered.length = 0;
  describeRows = [...YOKOHAMA_COLUMNS];
  registerFailure = null;
  describeFailure = null;
  createFailure = null;
  engineReady = true;
  describeGate = null;
  resetLayerTablesForTest();
  resetFamilyViewsForTest();
});

describe("keptFamilyColumns", () => {
  it("keeps identity and attributes, drops geometry, appearance and template", () => {
    expect(keptFamilyColumns(YOKOHAMA_COLUMNS).map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "parents",
      "children",
      "bbox",
      "measuredHeight",
      "other_attributes",
    ]);
  });

  it("classifies each kept column, so the grid and the filter bar agree", () => {
    const bbox = keptFamilyColumns(YOKOHAMA_COLUMNS).find(
      (c) => c.name === "bbox",
    );
    expect(bbox?.kind).toBe("nested");
  });
});

describe("buildFamilyViewSql", () => {
  it("quotes every identifier, including a column with quotes and spaces", () => {
    // Real PLATEAU files carry attribute names with spaces and non-ASCII
    // characters; an unquoted projection would be a syntax error at best and an
    // injection point at worst. The registered NAME is generated by this
    // module, never user text, and is passed as a literal.
    expect(
      buildFamilyViewSql("layer_3", "family_1.parquet", [
        { name: "id", type: "VARCHAR", kind: "scalar" },
        { name: 'a "b" c', type: "VARCHAR", kind: "scalar" },
        { name: "建物ID", type: "VARCHAR", kind: "scalar" },
      ]),
    ).toBe(
      'CREATE OR REPLACE VIEW "layer_3" AS SELECT "id", "a ""b"" c", "建物ID" ' +
        "FROM read_parquet('family_1.parquet')",
    );
  });
});

describe("ensureFamilyView", () => {
  it("registers the URL, describes the file and publishes a VIEW", async () => {
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: "EPSG:6697",
    });

    expect(outcome).toEqual({ ok: true });
    expect(registered).toEqual([
      {
        kind: "url",
        name: "family_1.parquet",
        at: "https://example.test/building.parquet",
      },
    ]);
    expect(sql[0]).toBe(describeParquetSql("family_1.parquet"));
    expect(sql[1]).toMatch(
      /^CREATE OR REPLACE VIEW "layer_1" AS SELECT "id", /,
    );
    expect(sql[1]).toContain("FROM read_parquet('family_1.parquet')");

    const info = getLayerTable("L", "building");
    expect(info).toMatchObject({
      table: "layer_1",
      sourceName: "family_1.parquet",
      fileBacked: true,
      familyKey: "building",
      // R-G: the file's own bbox is in the file's own CRS — degrees for a
      // PLATEAU package — and it is RECORDED, never reprojected in SQL.
      sourceCrs: "EPSG:6697",
      rowCount: 884106,
    });
    expect(info?.columns.map((c) => c.name)).toContain("measuredHeight");
    expect(info?.columns.map((c) => c.name)).not.toContain("geometry_lod2_2");
    // The LoD ladder still comes from the dropped geometry column names.
    expect(info?.lods.map((l) => l.label)).toEqual(["0.0", "2.2"]);
    // Published under the composite key, so the resident rebuilds cannot reach it.
    expect(Object.keys(useLayerTableStore.getState().tables)).toEqual([
      "L::building",
    ]);
  });

  it("registers a local File through the handle door", async () => {
    const file = new File([new Uint8Array([1])], "building.parquet");
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { file },
      sourceCrs: null,
    });
    expect(registered).toEqual([
      { kind: "file", name: "family_1.parquet", at: file },
    ]);
  });

  it("is idempotent: a second call re-registers nothing and keeps the view name", async () => {
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    sql.length = 0;
    const again = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });

    expect(again).toEqual({ ok: true });
    expect(registered).toHaveLength(1);
    // The SAME view name, replaced in place: a fresh name would leak the first
    // view under a name nothing will ever use again.
    expect(sql.some((s) => s.includes('VIEW "layer_1"'))).toBe(true);
    expect(getLayerTable("L", "building")?.table).toBe("layer_1");
  });

  it("gives each family of one layer its own registration and view", async () => {
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });

    expect(registered.map((r) => r.name)).toEqual([
      "family_1.parquet",
      "family_2.parquet",
    ]);
    expect(getLayerTable("L", "building")?.table).toBe("layer_1");
    expect(getLayerTable("L", "bridge")?.table).toBe("layer_2");
  });

  it("gives two families over ONE url their own registration, so dropping one leaves the other's file", async () => {
    // A manifest that lists one href twice (`building` and `bridge` resolving
    // to the same URL) used to yield ONE registration for both families: the
    // first drop released the VFS name under the second family's live view,
    // which then read nothing at all with no error anywhere.
    const url = "https://example.test/objects.parquet";
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url },
      sourceCrs: null,
    });
    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url },
      sourceCrs: null,
    });
    const building = getLayerTable("L", "building")?.sourceName;
    const bridge = getLayerTable("L", "bridge")?.sourceName;
    expect(registered).toHaveLength(2);
    expect(building).not.toBeUndefined();
    expect(bridge).not.toBe(building);

    dropped.length = 0;
    await dropFamilyView("L", "bridge");

    expect(dropped).toContain(bridge);
    expect(dropped).not.toContain(building);
    expect(getLayerTable("L", "building")?.sourceName).toBe(building);
  });

  it("reports a registration that was refused, and publishes nothing", async () => {
    registerFailure = "HTTP 404";
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/gone.parquet" },
      sourceCrs: null,
    });
    expect(outcome).toEqual({ ok: false, message: "HTTP 404" });
    expect(sql).toEqual([]);
    expect(getLayerTable("L", "building")).toBeNull();
  });

  it("reports a DESCRIBE that failed", async () => {
    describeFailure = "IO Error: could not read footer";
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(outcome).toEqual({
      ok: false,
      message: "IO Error: could not read footer",
    });
    expect(sql.some((s) => s.startsWith("CREATE"))).toBe(false);
  });

  it("reports a CREATE that failed", async () => {
    createFailure = "Binder Error: nope";
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(outcome).toEqual({ ok: false, message: "Binder Error: nope" });
    expect(getLayerTable("L", "building")).toBeNull();
  });

  it("refuses a file with nothing browsable in it", async () => {
    describeRows = [{ column_name: "geometry_lod2_2", column_type: "BLOB" }];
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(outcome.ok).toBe(false);
    expect(sql.some((s) => s.startsWith("CREATE"))).toBe(false);
  });

  it("refuses while the engine is not running, without registering", async () => {
    engineReady = false;
    const outcome = await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(outcome).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
    expect(registered).toEqual([]);
  });

  it("registers AGAIN after the engine died, because the VFS went with it", async () => {
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(registered).toHaveLength(1);

    // A new engine has an EMPTY virtual file system. A cached name from the old
    // one would be skipped here and the view built over a file that resolves to
    // nothing — an empty table with no error anywhere.
    for (const listener of [...deathListeners]) listener();

    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(registered).toHaveLength(2);
  });
});

describe("dropFamilyView", () => {
  it("takes ONE family and leaves the layer's others alone", async () => {
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });
    sql.length = 0;

    await dropFamilyView("L", "bridge");

    expect(sql).toContain('DROP VIEW IF EXISTS "layer_2"');
    expect(sql).not.toContain('DROP VIEW IF EXISTS "layer_1"');
    expect(getLayerTable("L", "bridge")).toBeNull();
    expect(getLayerTable("L", "building")?.table).toBe("layer_1");
  });

  it("forgets the registration, so re-enabling the family registers again", async () => {
    // The drop released the file behind the view, and a dropped VFS name still
    // RESOLVES — to nothing. A cache entry left behind would make the next
    // ensure skip its registration and build a view over an empty file.
    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });
    await dropFamilyView("L", "bridge");
    registered.length = 0;

    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).not.toBe("family_1.parquet");
  });
});

describe("a drop that lands while an ensure is IN FLIGHT", () => {
  function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  /**
   * Let the ensure get as far as its held DESCRIBE.
   *
   * The window matters: a drop that lands while the call is still QUEUED is the
   * cheap case (nothing registered, nothing to release), and these cases are
   * about the expensive one — the file is already in the VFS and remembered.
   */
  async function reachDescribe(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(registered).toHaveLength(1);
  }

  it("publishes nothing and re-registers next time (dropFamilyView)", async () => {
    // The window: while the ensure is queued or awaiting its DESCRIBE nothing is
    // in the registry yet, so `dropFamilyView` finds no `sourceName` to forget.
    // Without a generation check the ensure would then publish its view, the
    // drop's queued task would retire it and release the file — and the cached
    // name would make the NEXT ensure build a view over a dropped VFS name,
    // which resolves to nothing and fails at query time.
    describeGate = gate();
    const ensuring = ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    await reachDescribe();
    const dropping = dropFamilyView("L", "building");
    describeGate.open();
    describeGate = null;

    const outcome = await ensuring;
    await dropping;

    expect(outcome.ok).toBe(false);
    expect(getLayerTable("L", "building")).toBeNull();
    // It undoes its OWN work rather than leaving it for a drop that cannot see
    // it: the view it had just created goes, and so does the registration.
    expect(sql).toContain('DROP VIEW IF EXISTS "layer_1"');
    expect(dropped).toContain("family_1.parquet");

    registered.length = 0;
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).not.toBe("family_1.parquet");
    expect(getLayerTable("L", "building")?.table).not.toBeUndefined();
  });

  it("publishes nothing when the LAYER was removed under it (dropFamilyViews)", async () => {
    // `keysForLayer` can only enumerate what the registry, the parked sources
    // and the enqueues know about, and a pending ensure has touched none of
    // them — so the removal cannot see this family at all. Left unguarded, the
    // ensure would publish a live view and a live registration for a layer that
    // no longer exists.
    describeGate = gate();
    const ensuring = ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    await reachDescribe();
    const dropping = dropFamilyViews("L");
    describeGate.open();
    describeGate = null;

    expect((await ensuring).ok).toBe(false);
    await dropping;

    expect(getLayerTable("L", "building")).toBeNull();
    expect(useLayerTableStore.getState().tables["L::building"]).toBeUndefined();
    expect(dropped).toContain("family_1.parquet");
  });

  it("leaves an ensure for ANOTHER family of the same layer alone", async () => {
    describeGate = gate();
    const ensuring = ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });
    await reachDescribe();
    const dropping = dropFamilyView("L", "building");
    describeGate.open();
    describeGate = null;

    expect(await ensuring).toEqual({ ok: true });
    await dropping;
    expect(getLayerTable("L", "bridge")).not.toBeNull();
  });
});

describe("dropFamilyViews", () => {
  it("drops every view, releases the registrations and forgets them", async () => {
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    await ensureFamilyView({
      layerId: "L",
      family: "bridge",
      source: { url: "https://example.test/bridge.parquet" },
      sourceCrs: null,
    });
    sql.length = 0;

    await dropFamilyViews("L");

    expect(sql).toContain('DROP VIEW IF EXISTS "layer_1"');
    expect(sql).toContain('DROP VIEW IF EXISTS "layer_2"');
    expect(dropped).toContain("family_1.parquet");
    expect(dropped).toContain("family_2.parquet");
    expect(getLayerTable("L", "building")).toBeNull();

    // A re-add under the SAME layer id must register again: a dropped VFS name
    // still resolves, to zero bytes, forever.
    registered.length = 0;
    await ensureFamilyView({
      layerId: "L",
      family: "building",
      source: { url: "https://example.test/building.parquet" },
      sourceCrs: null,
    });
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).not.toBe("family_1.parquet");
  });

  it("leaves another layer's registration of the same URL alone", async () => {
    const url = "https://example.test/building.parquet";
    await ensureFamilyView({
      layerId: "A",
      family: "building",
      source: { url },
      sourceCrs: null,
    });
    await ensureFamilyView({
      layerId: "B",
      family: "building",
      source: { url },
      sourceCrs: null,
    });
    // Two layers over one URL are two registrations on purpose: dropping one
    // layer must not pull the file out from under the other's view.
    expect(registered).toHaveLength(2);

    await dropFamilyViews("A");

    expect(getLayerTable("B", "building")).not.toBeNull();
    expect(dropped).not.toContain(registered[1]?.name);
  });
});
