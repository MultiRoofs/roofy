/**
 * §7.6, the reverse direction: every target area written, buildings counted
 * once per area they fall in, parts never counted.
 *
 * The statement as a string, then the executor over a fake context whose
 * `query` answers PER STATEMENT — three different ones reach it on the
 * footprint path (the scope rows off the table, the reader's ids, and the
 * aggregate itself), and answering all three with the same rows would make
 * §6.1's identity check pass by accident.
 *
 * TASK 5's TWO SOURCE DOORS ARE THE REAL ONES, as in `joinByLocation.test.ts`:
 * only `readSource` is stubbed (it registers bytes in a wasm heap this suite
 * has none of), while `readerQuery` and `assertSourceIds` come from
 * `importActual` wrapped in delegating spies. So the scope-wide identity ruling
 * is asserted by the sentence §6.1 actually throws.
 *
 * `createVectorTable` is stubbed so the cases are about the AGGREGATION rather
 * than about the VFS; `reprojectGeoLayer` is the REAL one (proj4 replaced by a
 * deterministic affine), so preflight's skip counts are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerTable } from "../../../../src/insights/layerTables";
import type { ToolContext } from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

/**
 * `sourceRead` and `vectorTable` both reach `insights/duckdb`, which is the ONE
 * importer of `@duckdb/duckdb-wasm` — so the engine seam is mocked here,
 * HOISTED, with every export the module under test's import graph reads.
 */
vi.mock("../../../../src/insights/duckdb", () => ({
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  runQuery: vi.fn(async () => ({ ok: false, message: "not used here" })),
  ddl: vi.fn(async () => ({ ok: false, message: "not used here" })),
  readFile: vi.fn(async () => null),
  getDuckDBStatus: vi.fn(() => ({ state: "ready", extensions: {} })),
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  formatDuckDBError: (e: unknown) => String(e),
  initDuckDB: vi.fn(async () => {}),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

/** proj4 replaced by a deterministic affine, as `vectorSource.test.ts` does:
 *  the REAL preflight runs in every case here and must answer without a
 *  network fetch. */
vi.mock("../../../../src/scene/cursorCrsReadout", () => ({
  crsFromGeodetic: (lng: number, lat: number, h: number) =>
    [lng * 1000, lat * 1000, h] as const,
  epsgForLayer: () => 28992,
}));

const crsChecked: string[] = [];
vi.mock("../../../../src/features/layers/ensureCrs", () => ({
  ensureModelCrsLoadable: vi.fn(async (model: unknown) => {
    crsChecked.push(
      String(
        (model as { metadata?: { referenceSystem?: string } } | null)?.metadata
          ?.referenceSystem,
      ),
    );
  }),
}));

const created: Array<{
  runId: string;
  features: number;
  signal: boolean;
  control: boolean;
}> = [];
const released: string[] = [];
vi.mock("../../../../src/features/processing/vectorTable", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/vectorTable")
  >("../../../../src/features/processing/vectorTable");
  return {
    ...actual,
    createVectorTable: vi.fn(
      async (input: {
        runId: string;
        preflight: { features: unknown[] };
        control?: unknown;
        signal?: unknown;
      }) => {
        created.push({
          runId: input.runId,
          features: input.preflight.features.length,
          signal: input.signal != null,
          control: input.control != null,
        });
        // IDEMPOTENT, like the real handle: `release()` is called from a
        // `finally` and a stub that counted twice would make a correct
        // executor look like a leak.
        let done = false;
        return {
          table: `__src_${input.runId}`,
          release: async () => {
            if (done) return;
            done = true;
            released.push(`__src_${input.runId}`);
          },
        };
      },
    ),
  };
});

const readSource = vi.fn(async (input: { runId: string; lod: string }) => {
  let done = false;
  return {
    from: `read_cityjson('layer_1_${input.runId}.city.json', lod => '${input.lod}')`,
    geometryColumn: `geometry_lod${input.lod.replace(".", "_")}`,
    propertiesColumn: `geometry_properties_lod${input.lod.replace(".", "_")}`,
    release: async () => {
      if (done) return;
      done = true;
      released.push(`reader_${input.runId}`);
    },
  };
});
vi.mock("../../../../src/features/processing/sourceRead", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/sourceRead")
  >("../../../../src/features/processing/sourceRead");
  return {
    ...actual,
    readSource,
    // Spies that DELEGATE: the call is observable and the RULE is still Task
    // 5's own.
    readerQuery: vi.fn(actual.readerQuery),
    assertSourceIds: vi.fn(actual.assertSourceIds),
  };
});

const { aggregatePerArea, buildAggregateSql } =
  await import("../../../../src/features/processing/tools/aggregatePerArea");
const { assertSourceIds, readerQuery, SOURCE_IDS_DIFFER } =
  await import("../../../../src/features/processing/sourceRead");
const { normalizeGeoJsonDocument } =
  await import("../../../../src/features/geoLayers/geoJsonRecords");
const { geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");

const RING = [
  [4, 52],
  [5, 52],
  [5, 53],
  [4, 52],
];

function zonesDocument(count: number): unknown {
  return normalizeGeoJsonDocument({
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => ({
      type: "Feature",
      id: `z${i + 1}`,
      properties: { zone: String.fromCharCode(65 + i) },
      geometry: { type: "Polygon", coordinates: [RING] },
    })),
  }).data;
}

function table(): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    extension: "city.json",
    sourceBytes: 4,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "roof_area_m2", type: "DOUBLE", kind: "scalar" },
    ],
    lods: [{ label: "0", suffix: "0" }],
    sourceFeatureIds: null,
    rowCount: 3,
  } as LayerTable;
}

function run(
  params: Record<string, unknown>,
  over: Partial<RunRecord> = {},
): RunRecord {
  return {
    id: "run_1",
    toolId: "aggregate-per-area",
    targetLayerId: "GEO",
    targetName: "Zones",
    targetDerivedFrom: null,
    sourceLayerId: "L1",
    sourceName: "Delft",
    scope: "all",
    scopeCount: 3,
    featureIds: null,
    lod: null,
    params,
    prefix: "bld_",
    columns: [],
    status: "running",
    phase: "compute",
    startedAt: 0,
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    destination: "layer",
    newLayerName: null,
    newLayerId: null,
    note: null,
    ...over,
  };
}

/** One aggregate-statement row, the three card scalars included. */
function area(
  sid: string,
  values: Record<string, unknown>,
  card: {
    multi?: number | bigint;
    total?: number | bigint;
    noProxy?: number | bigint;
  } = {},
): Record<string, unknown> {
  return {
    sid,
    ...values,
    multi_n: card.multi ?? 0,
    buildings_total: card.total ?? 0,
    no_proxy_n: card.noProxy ?? 0,
  };
}

interface Answers {
  /** The aggregate statement's rows. */
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  /** The scope-rows statement's rows — every SCOPED row of the table. */
  readonly scope?: ReadonlyArray<{ id: string; f: string }>;
  /** The ids the re-read source still holds. */
  readonly sourceIds?: ReadonlyArray<string>;
  /** The TARGET document, when a case needs one of its own. */
  readonly document?: unknown;
  /** How many areas the default target document holds. */
  readonly areas?: number;
}

function context(
  answers: Answers,
  over: Partial<ToolContext> = {},
): {
  ctx: ToolContext;
  sql: string[];
  labels: string[];
  phases: string[];
  warnings: string[];
} {
  const sql: string[] = [];
  const labels: string[] = [];
  const phases: string[] = [];
  const warnings: string[] = [];
  const document = answers.document ?? zonesDocument(answers.areas ?? 2);
  const ctx = {
    layer: {
      id: "L1",
      name: "Delft",
      isStreaming: false,
      model: {
        metadata: {
          referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
        },
      },
    },
    table: table(),
    target: {
      kind: "vector",
      layer: {
        id: "GEO",
        name: "Zones",
        kind: "geojson",
        config: { preparedData: document },
      },
      records: geoRecords(document),
    },
    source: { kind: "city", layer: { id: "L1" }, table: table() },
    featureIds: null,
    signal: new AbortController().signal,
    query: vi.fn(async (label: string, statement: string) => {
      sql.push(statement);
      labels.push(label);
      // The AGGREGATE first: Task 16's own lesson — a looser branch above it
      // would answer this statement with the wrong rows.
      if (statement.startsWith("WITH b AS (")) {
        return {
          ok: true as const,
          columns: [],
          rows: [...(answers.rows ?? [])],
        };
      }
      if (statement.startsWith(`SELECT "id", COALESCE("feature_id", "id")`)) {
        return {
          ok: true as const,
          columns: ["id", "f"],
          rows: [...(answers.scope ?? [])],
        };
      }
      if (statement.startsWith(`SELECT "id" FROM read_cityjson(`)) {
        return {
          ok: true as const,
          columns: ["id"],
          rows: (answers.sourceIds ?? []).map((id) => ({ id })),
        };
      }
      return { ok: true as const, columns: [], rows: [] };
    }),
    phase: vi.fn((p: string) => {
      phases.push(p);
    }),
    warn: vi.fn((text: string) => warnings.push(text)),
    throwIfCancelled: vi.fn(),
    ...over,
  } as unknown as ToolContext;
  return { ctx, sql, labels, phases, warnings };
}

/** The aggregate statement, out of everything the run sent. */
const aggregateStatement = (sql: ReadonlyArray<string>): string | undefined =>
  sql.find((s) => s.startsWith("WITH b AS ("));

beforeEach(() => {
  created.length = 0;
  released.length = 0;
  crsChecked.length = 0;
  vi.mocked(readSource).mockClear();
  vi.mocked(readerQuery).mockClear();
  vi.mocked(assertSourceIds).mockClear();
});

describe("buildAggregateSql", () => {
  const base = {
    table: "layer_1",
    source: "__src_run_1",
    proxy: "rectangle" as const,
    from: null,
    geometryColumn: null,
    ids: null,
    predicate: "intersects" as const,
    rows: [
      { op: "count" as const, column: null, name: "bld_buildings_n" },
      {
        op: "sum" as const,
        column: "roof_area_m2",
        name: "bld_sum_roof_area_m2",
      },
    ],
  };

  it("keeps EVERY area, so an empty one is a 0 and not a missing row", () => {
    const sql = buildAggregateSql(base);
    expect(sql).toContain('FROM "__src_run_1" s LEFT JOIN p');
    expect(sql).toContain('COUNT(m."f") AS "bld_buildings_n"');
    expect(sql).toContain('GROUP BY m."sid"');
  });

  it("qualifies the outer aggregates with `m`, the only table in scope there", () => {
    // `p` and `s` live INSIDE the `m` CTE; a `p.` in the outer SELECT is a
    // binder error, which a string test is the only cheap way to catch.
    const sql = buildAggregateSql(base);
    const outer = sql.slice(sql.lastIndexOf("SELECT m."));
    expect(outer).not.toContain("COUNT(p.");
    expect(outer).not.toContain("GROUP BY s.");
  });

  it("reads a building's value from its ROOT row only (§7, §8)", () => {
    expect(buildAggregateSql(base)).toContain(
      'WHERE "id" = COALESCE("feature_id", "id")',
    );
    expect(buildAggregateSql(base)).toContain(
      'SUM(m."c0") AS "bld_sum_roof_area_m2"',
    );
  });

  it("reads the value as a DOUBLE, which is the type the column was declared", () => {
    // `numericColumnsOf` offers DECIMAL and the integer types too, and a SUM
    // over a DECIMAL comes back as a scaled HUGEINT — not a number the values
    // file can carry under a column this run has already declared DOUBLE. The
    // same CAST the median takes, and TRY_ because a frozen bag can name a
    // column a rebuild has since made text: §6.2's rule for a value that could
    // not be read is NULL, not a failed run.
    expect(buildAggregateSql(base)).toContain(
      'TRY_CAST("roof_area_m2" AS DOUBLE) AS "c0"',
    );
  });

  it("counts the buildings that fell in more than one area, in the same statement", () => {
    expect(buildAggregateSql(base)).toContain(
      'HAVING COUNT(DISTINCT "sid") > 1',
    );
  });

  it("reads one distinct source column once, whatever the op", () => {
    // Two aggregates over one column share `c0`, so the value relation is read
    // once and no alias can collide with a data column.
    const sql = buildAggregateSql({
      ...base,
      rows: [
        { op: "mean", column: "roof_area_m2", name: "bld_mean_roof_area_m2" },
        { op: "max", column: "roof_area_m2", name: "bld_max_roof_area_m2" },
      ],
    });
    expect(sql).toContain('AVG(m."c0") AS "bld_mean_roof_area_m2"');
    expect(sql).toContain('MAX(m."c0") AS "bld_max_roof_area_m2"');
    expect(sql).not.toContain('"c1"');
  });

  it("uses ST_CoveredBy for `within` and the centre for `centre within`", () => {
    const within = buildAggregateSql({ ...base, predicate: "within" });
    expect(within).toContain('ST_CoveredBy(p."g", s."geom")');
    expect(within).not.toContain("ST_Within(");
    const centre = buildAggregateSql({ ...base, predicate: "centreWithin" });
    expect(centre).toContain('ST_Intersects(p."g", s."geom")');
    expect(centre).toContain("ST_Point(");
  });

  it("restricts the BUILDINGS to the frozen scope, never the areas", () => {
    const sql = buildAggregateSql({ ...base, ids: ["b1"] });
    expect(sql).toContain(`WHERE "id" IN ('b1')`);
    expect(sql).not.toContain(`s."sid" IN`);
  });
});

describe("aggregatePerArea", () => {
  const params = {
    proxy: "rectangle",
    predicate: "intersects",
    rows: [
      { op: "count", column: null },
      { op: "sum", column: "roof_area_m2" },
    ],
  };

  it("writes every area, keyed by its stable feature id", async () => {
    const { ctx } = context({
      rows: [
        area(
          "id:string:z1",
          { bld_buildings_n: 2, bld_sum_roof_area_m2: 90 },
          { total: 2 },
        ),
        area(
          "id:string:z2",
          { bld_buildings_n: 0, bld_sum_roof_area_m2: null },
          { total: 2 },
        ),
      ],
    });
    const out = await aggregatePerArea(run(params), ctx);
    expect([...out.rows.keys()]).toEqual(["id:string:z1", "id:string:z2"]);
    // §6.2: an empty area's count is a real 0; its sum is NULL.
    expect(out.rows.get("id:string:z2")).toEqual({
      bld_buildings_n: 0,
      bld_sum_roof_area_m2: null,
    });
    expect(out.columns).toEqual([
      { name: "bld_buildings_n", type: "DOUBLE" },
      { name: "bld_sum_roof_area_m2", type: "DOUBLE" },
    ]);
  });

  it("publishes a COUNT as a plain number, whatever the engine handed back", async () => {
    // `COUNT(m."f")` is a BIGINT. `insights/duckdb`'s `toRows` narrows one to a
    // Number at the seam (`duckdb.ts:656-667`, "`JSON.stringify` throws on
    // it"), but the vector path has no values file and no replacer behind it:
    // §7.6's publication copies what it is given straight onto the feature
    // properties, where a `2n` would break a GeoJSON export and read as a
    // foreign type in the records panel. So the executor does not depend on the
    // seam's narrowing — every column it declares is a DOUBLE and it answers
    // with one.
    const { ctx } = context({
      rows: [
        area(
          "id:string:z1",
          { bld_buildings_n: 2n, bld_sum_roof_area_m2: 90 },
          { total: 2n, multi: 1n, noProxy: 1n },
        ),
        area(
          "id:string:z2",
          { bld_buildings_n: 0n, bld_sum_roof_area_m2: null },
          { total: 2n, multi: 1n, noProxy: 1n },
        ),
      ],
    });
    const out = await aggregatePerArea(run(params), ctx);
    expect(out.rows.get("id:string:z1")).toEqual({
      bld_buildings_n: 2,
      bld_sum_roof_area_m2: 90,
    });
    expect(typeof out.rows.get("id:string:z2")?.["bld_buildings_n"]).toBe(
      "number",
    );
    // The card's own three scalars go through the same door already.
    expect(out.line).toBe("2 areas aggregated over 2 buildings");
    expect(out.caveats).toEqual([
      { cause: "building counted in more than one area", count: 1 },
    ]);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
  });

  it("is §7.6's card line, with the overlap count as a caveat", async () => {
    const { ctx } = context({
      rows: [
        area(
          "id:string:z1",
          { bld_buildings_n: 2, bld_sum_roof_area_m2: 90 },
          { multi: 1, total: 3 },
        ),
        area(
          "id:string:z2",
          { bld_buildings_n: 2, bld_sum_roof_area_m2: 40 },
          { multi: 1, total: 3 },
        ),
      ],
    });
    const out = await aggregatePerArea(run(params), ctx);
    expect(out.line).toBe("2 areas aggregated over 3 buildings");
    // `summarise` renders "<count> <cause>", so the cause carries the NOUN —
    // §7.6's own "14 buildings counted in more than one area".
    expect(out.caveats).toEqual([
      { cause: "building counted in more than one area", count: 1 },
    ]);
    expect(out.measured).toBe(3);
  });

  it("reports a building with no proxy as skipped, not as an area's zero", async () => {
    const { ctx } = context({
      rows: [
        area(
          "id:string:z1",
          { bld_buildings_n: 1, bld_sum_roof_area_m2: 50 },
          { total: 1, noProxy: 2 },
        ),
        area(
          "id:string:z2",
          { bld_buildings_n: 0, bld_sum_roof_area_m2: null },
          { total: 1, noProxy: 2 },
        ),
      ],
    });
    const out = await aggregatePerArea(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 2 }]);
  });

  it("reprojects the TARGET's areas and releases the table it made", async () => {
    const { ctx, phases } = context({
      rows: [area("id:string:z1", { bld_buildings_n: 0 })],
    });
    await aggregatePerArea(run(params), ctx);
    // The SOURCE city model's CRS is what proj4 must hold, and the await is
    // not optional: `crsFromGeodetic`'s guard is synchronous.
    expect(crsChecked).toEqual([
      "https://www.opengis.net/def/crs/EPSG/0/28992",
    ]);
    expect(created).toEqual([
      { runId: "run_1", features: 2, signal: true, control: true },
    ]);
    expect(released).toEqual(["__src_run_1"]);
    expect(phases).toEqual(["source", "compute"]);
  });

  it("sends the footprint statement through `readerQuery` and checks §6.1's ids", async () => {
    const { ctx, sql } = context({
      rows: [area("id:string:z1", { bld_buildings_n: 0 })],
      scope: [
        { id: "b1", f: "b1" },
        { id: "b1p", f: "b1" },
      ],
      sourceIds: ["b1", "b1p"],
    });
    await aggregatePerArea(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Aggregating buildings per area",
      expect.stringContaining("read_cityjson('layer_1_run_1.city.json'"),
    );
    // §6.1's id join, over the executor's OWN scope-rows read — never
    // `ctx.featureIds`, which is null on scope "all".
    expect(vi.mocked(assertSourceIds)).toHaveBeenCalledWith(
      ["b1", "b1p"],
      new Set(["b1", "b1p"]),
    );
    expect(sql[0]).toContain('SELECT "id", COALESCE("feature_id", "id")');
    expect(released).toEqual(["reader_run_1", "__src_run_1"]);
  });

  it("leaves both source doors alone for a bbox proxy", async () => {
    // The rectangle and centre proxies read the BROWSING table only: there is
    // no re-read whose identity could differ, so neither statement is issued.
    const { ctx, sql } = context({
      rows: [area("id:string:z1", { bld_buildings_n: 0 })],
    });
    await aggregatePerArea(run(params), ctx);
    expect(vi.mocked(readSource)).not.toHaveBeenCalled();
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
    expect(sql).toHaveLength(1);
  });

  const scopeRows = [
    { id: "b1", f: "b1" },
    { id: "b1p", f: "b1" },
    { id: "b2", f: "b2" },
  ];
  const scopes: ReadonlyArray<{
    readonly scope: RunRecord["scope"];
    readonly featureIds: ReadonlyArray<string> | null;
  }> = [
    { scope: "all", featureIds: null },
    { scope: "selected", featureIds: ["b1", "b1p", "b2"] },
    { scope: "matching", featureIds: ["b1", "b1p", "b2"] },
  ];
  for (const { scope, featureIds } of scopes) {
    it(`fails a ${scope} run whose source no longer holds the ROOT`, async () => {
      const { ctx, sql } = context(
        {
          rows: [area("id:string:z1", { bld_buildings_n: 1 })],
          scope: scopeRows,
          sourceIds: ["b1p", "b2"],
        },
        { featureIds },
      );
      await expect(
        aggregatePerArea(
          run({ ...params, proxy: "footprint" }, { scope }),
          ctx,
        ),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      // Refused BEFORE the expensive parse, and both handles dropped.
      expect(aggregateStatement(sql)).toBeUndefined();
      expect(released).toEqual(["reader_run_1", "__src_run_1"]);
    });

    it(`fails a ${scope} run whose source no longer holds a PART`, async () => {
      const { ctx, sql } = context(
        {
          rows: [area("id:string:z1", { bld_buildings_n: 1 })],
          scope: scopeRows,
          sourceIds: ["b1", "b2"],
        },
        { featureIds },
      );
      await expect(
        aggregatePerArea(
          run({ ...params, proxy: "footprint" }, { scope }),
          ctx,
        ),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      expect(aggregateStatement(sql)).toBeUndefined();
      expect(released).toEqual(["reader_run_1", "__src_run_1"]);
    });
  }

  it("refuses a target with no usable areas, with §7.6's own sentence", async () => {
    const { ctx } = context({
      document: normalizeGeoJsonDocument({
        type: "FeatureCollection",
        features: [],
      }).data,
    });
    await expect(aggregatePerArea(run(params), ctx)).rejects.toThrow(
      "The layer has no areas",
    );
    expect(created).toEqual([]);
  });

  /** One usable area and one whose geometry preflight cannot use. */
  function partlyUsable(): unknown {
    return normalizeGeoJsonDocument({
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "z1", properties: {}, geometry: null },
        {
          type: "Feature",
          id: "z2",
          properties: {},
          geometry: { type: "Polygon", coordinates: [RING] },
        },
      ],
    }).data;
  }

  it("records the areas preflight could not use, as §7.5 words it", async () => {
    const { ctx, warnings } = context({
      document: partlyUsable(),
      rows: [area("id:string:z2", { bld_buildings_n: 0 })],
    });
    await aggregatePerArea(run(params), ctx);
    expect(warnings).toContain("1 area skipped: invalid geometry");
    expect(created).toEqual([
      { runId: "run_1", features: 1, signal: true, control: true },
    ]);
  });

  it("writes NULL over an area preflight could not use, never stale values", async () => {
    // §7.6: "the target's every feature is written." The area whose geometry
    // became unusable is not in the statement's answer at all, so without an
    // explicit NULL row it would keep the PREVIOUS run's numbers under this
    // run's provenance.
    const { ctx } = context({
      document: partlyUsable(),
      rows: [
        area(
          "id:string:z2",
          { bld_buildings_n: 4, bld_sum_roof_area_m2: 120 },
          { total: 4 },
        ),
      ],
    });
    const out = await aggregatePerArea(run(params), ctx);
    expect([...out.rows.keys()].sort()).toEqual([
      "id:string:z1",
      "id:string:z2",
    ]);
    expect(out.rows.get("id:string:z1")).toEqual({
      bld_buildings_n: null,
      bld_sum_roof_area_m2: null,
    });
    // And the card counts the areas that were AGGREGATED, not the written ones.
    expect(out.line).toBe("1 area aggregated over 4 buildings");
  });
});
