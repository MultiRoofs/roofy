/**
 * §7.7 end to end: the one statement, the search limit in the JOIN, §6.1's two
 * re-validations and the card's own sentence.
 *
 * The SQL is asserted as a STRING (it is what §6.4's log shows and what a
 * planner reruns by hand); the executor is driven over a fake context whose
 * `query` answers the rows a real engine would, so the roll-up, the value rule
 * and the two counts are tested without DuckDB. The STATEMENT itself runs
 * against a real DuckDB 1.5.5 in `tests/integration/duckdb/crossLayer.test.ts`.
 *
 * TASK 5's TWO SOURCE DOORS ARE THE REAL ONES, exactly as Join's suite has
 * them. Only `readSource` is stubbed (it registers bytes in the wasm heap,
 * which this suite has none of): `readerQuery` and `assertSourceIds` come from
 * `importActual`, wrapped in spies that DELEGATE — so the scope-wide identity
 * ruling is asserted by the sentence §6.1 actually throws, not by a mock's call
 * log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerTable } from "../../../../src/insights/layerTables";
import type {
  ToolContext,
  ToolSource,
} from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

/**
 * `sourceRead` reaches `insights/duckdb`, which is the ONE importer of
 * `@duckdb/duckdb-wasm` — so the engine seam is mocked here, HOISTED, with
 * every export the module under test's import graph reads.
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
 *  the one case that builds a source through Task 12's REAL preflight needs a
 *  projection that answers without a network fetch. */
vi.mock("../../../../src/scene/cursorCrsReadout", () => ({
  crsFromGeodetic: (lng: number, lat: number, h: number) =>
    [lng * 1000, lat * 1000, h] as const,
  epsgForLayer: () => 28992,
}));

const released: string[] = [];
const readSource = vi.fn(async (input: { runId: string; lod: string }) => {
  // IDEMPOTENT, like the real handle (`sourceRead.ts`): the executor drops the
  // bytes as soon as the parse is done AND again in its `finally`.
  let done = false;
  return {
    from: `read_cityjson('layer_1_${input.runId}.city.json', lod => '${input.lod}')`,
    geometryColumn: `geometry_lod${input.lod.replace(".", "_")}`,
    propertiesColumn: `geometry_properties_lod${input.lod.replace(".", "_")}`,
    release: async () => {
      if (done) return;
      done = true;
      released.push(input.runId);
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

const { buildDistanceSql, distanceToNearest, DISTANCE_BATCH_ROWS } =
  await import("../../../../src/features/processing/tools/distanceToNearest");
const { assertSourceIds, readerQuery, SOURCE_IDS_DIFFER } =
  await import("../../../../src/features/processing/sourceRead");
const { reprojectGeoLayer } =
  await import("../../../../src/features/processing/vectorSource");
const { normalizeGeoJsonDocument } =
  await import("../../../../src/features/geoLayers/geoJsonRecords");

const SRC = "__src_run_1";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    extension: "city.json",
    sourceBytes: 4,
    columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
    lods: [{ label: "0", suffix: "0" }],
    rowCount: 3,
    ...over,
  } as LayerTable;
}

function source(over: Partial<Extract<ToolSource, { kind: "vector" }>> = {}) {
  return {
    kind: "vector" as const,
    layer: { id: "GEO", name: "Roads", kind: "geojson" },
    table: SRC,
    propertyKeys: ["name"],
    propertyTypes: new Map([["name", "VARCHAR" as const]]),
    skipped: 0,
    ...over,
  } as Extract<ToolSource, { kind: "vector" }>;
}

function run(
  params: Record<string, unknown>,
  over: Partial<RunRecord> = {},
): RunRecord {
  return {
    id: "run_1",
    toolId: "distance-to-nearest",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: "GEO",
    sourceName: "Roads",
    scope: "all",
    scopeCount: 3,
    featureIds: null,
    lod: null,
    params,
    prefix: "roads_",
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
    note: null,
    ...over,
  };
}

/** One result row of the distance statement, internal columns and all. */
function row(
  id: string,
  f: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return { id, f, no_proxy: false, ...values };
}

interface Answers {
  /** The distance statement's rows. */
  readonly distance?: ReadonlyArray<Record<string, unknown>>;
  /** The scope-rows statement's rows — every SCOPED row of the table. */
  readonly scope?: ReadonlyArray<{ id: string; f: string }>;
  /** The ids the re-read source still holds. */
  readonly sourceIds?: ReadonlyArray<string>;
}

/**
 * A `ToolContext` whose `query` answers PER STATEMENT.
 *
 * Three different statements reach it on the footprint path — the scope rows
 * off the table, the reader's ids, and the distance statement itself — and
 * answering all three with the same rows would make the identity check pass by
 * accident.
 */
function context(
  answers: Answers,
  over: Partial<ToolContext> = {},
): { ctx: ToolContext; sql: string[]; labels: string[]; phases: string[] } {
  const sql: string[] = [];
  const labels: string[] = [];
  const phases: string[] = [];
  const ctx = {
    layer: { id: "L1", name: "Delft", isStreaming: false },
    table: table(),
    target: { kind: "city", layer: { id: "L1" }, table: table() },
    source: source(),
    featureIds: null,
    signal: new AbortController().signal,
    query: vi.fn(async (label: string, statement: string) => {
      sql.push(statement);
      labels.push(label);
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
      return {
        ok: true as const,
        columns: [],
        rows: [...(answers.distance ?? [])],
      };
    }),
    phase: vi.fn((p: string) => {
      phases.push(p);
    }),
    warn: vi.fn(),
    throwIfCancelled: vi.fn(),
    ...over,
  } as unknown as ToolContext;
  return { ctx, sql, labels, phases };
}

/** The distance statement, out of everything the run sent. */
const distanceStatement = (sql: ReadonlyArray<string>): string =>
  sql.find((s) => s.startsWith("WITH b AS (")) ?? "";

beforeEach(() => {
  released.length = 0;
  vi.mocked(readSource).mockClear();
  vi.mocked(readerQuery).mockClear();
  vi.mocked(assertSourceIds).mockClear();
});

describe("buildDistanceSql", () => {
  const base = {
    table: "layer_1",
    source: SRC,
    proxy: "rectangle" as const,
    from: null,
    geometryColumn: null,
    ids: null,
    maxDistanceM: 500,
    prefix: "roads_",
    nearestId: null as { readonly property: string | null } | null,
  };

  it("puts the search limit in the JOIN, so beyond it there is no match", () => {
    const sql = buildDistanceSql(base);
    // §7.7: "beyond it the distance is NULL". In the `ON` clause the LEFT JOIN
    // produces no match at all, so `d` is NULL by the join's own semantics
    // rather than by a second CASE — and the engine may stop looking.
    expect(sql).toContain('ST_Distance(b."g", s."geom") <= 500');
    expect(sql).not.toContain("HAVING");
    expect(sql).toContain('ST_Distance(b."g", s."geom") AS "d"');
    expect(sql).toContain('m."d" AS "roads_distance_m"');
    // The FEATURE proxy, and the answer copied back to every row (§7).
    expect(sql).toContain(
      'WITH b AS (SELECT COALESCE("feature_id", "id") AS f',
    );
    expect(sql).toContain(
      'FROM "layer_1" t JOIN m ON COALESCE(t."feature_id", t."id") = m."f"',
    );
    expect(sql).not.toContain("roads_nearest_id");
  });

  it("orders by distance then SOURCE ORDER, never arg_min (§7.7)", () => {
    // §7.7: "ties go to the first source feature in source order". Two ORDER BY
    // keys state that; `arg_min` picks either row on equal keys and would let
    // the nearest id disagree with the distance it was chosen by.
    const sql = buildDistanceSql(base);
    expect(sql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY "d" ASC NULLS LAST, "idx" ASC NULLS LAST)',
    );
    expect(sql).not.toContain("arg_min");
  });

  it("writes the feature's OWN id when no property was chosen (§7.7)", () => {
    // §7.7's default: "the GeoJSON feature `id` when the source has one" —
    // which is `fid`, the column `encodeProjectedFeatures` wrote from
    // `ProjectedFeature.featureId`, not a property of the document.
    expect(
      buildDistanceSql({ ...base, nearestId: { property: null } }),
    ).toContain('m."fid" AS "roads_nearest_id"');
  });

  it("writes a chosen property, quoted as a JSON key", () => {
    const sql = buildDistanceSql({
      ...base,
      nearestId: { property: "name" },
    });
    expect(sql).toContain(`m."props"->>'name' AS "roads_nearest_id"`);
    expect(sql).not.toContain(`m."fid" AS`);
  });

  it("restricts to the frozen ids on both sides", () => {
    const sql = buildDistanceSql({ ...base, ids: ["b1"] });
    expect(sql).toContain(`WHERE "id" IN ('b1')`);
    expect(sql).toContain(`WHERE t."id" IN ('b1')`);
  });

  it("carries the no-proxy flag §6.2's value rule needs", () => {
    expect(buildDistanceSql(base)).toContain('(b."g" IS NULL) AS "no_proxy"');
  });
});

describe("distanceToNearest", () => {
  const params = {
    proxy: "rectangle",
    maxDistanceM: 500,
    writeNearestId: true,
    nearestIdProperty: null,
  };

  it("writes the distance and the id onto every row of the feature", async () => {
    const { ctx } = context({
      distance: [
        row("B1", "B1", { roads_distance_m: 0, roads_nearest_id: "r7" }),
        row("B1P", "B1", { roads_distance_m: 0, roads_nearest_id: "r7" }),
        row("B2", "B2", { roads_distance_m: 12.5, roads_nearest_id: "r9" }),
      ],
    });
    const out = await distanceToNearest(run(params), ctx);
    expect(out.columns).toEqual([
      { name: "roads_distance_m", type: "DOUBLE" },
      { name: "roads_nearest_id", type: "VARCHAR" },
    ]);
    // §7.7: 0 when they touch or overlap — a real 0, never NULL.
    expect(out.rows.get("B1P")).toEqual({
      roads_distance_m: 0,
      roads_nearest_id: "r7",
    });
    expect(out.rows.get("B2")).toEqual({
      roads_distance_m: 12.5,
      roads_nearest_id: "r9",
    });
  });

  it("is §7.7's card: measured, then the ones with nothing in range", async () => {
    const { ctx } = context({
      distance: [
        row("B1", "B1", { roads_distance_m: 3, roads_nearest_id: "r7" }),
        row("B2", "B2", { roads_distance_m: null, roads_nearest_id: null }),
      ],
    });
    const out = await distanceToNearest(run(params), ctx);
    expect(out.measured).toBe(2);
    expect(out.line).toBe("2 buildings measured");
    expect(out.caveats).toEqual([{ cause: "none within 500 m", count: 1 }]);
    expect(out.skipped).toEqual([]);
  });

  it("counts a FEATURE once, whatever its parts say", async () => {
    const { ctx } = context({
      distance: [
        row("B1", "B1", { roads_distance_m: null, roads_nearest_id: null }),
        row("B1P", "B1", { roads_distance_m: null, roads_nearest_id: null }),
        row("B1P2", "B1", { roads_distance_m: null, roads_nearest_id: null }),
      ],
    });
    const out = await distanceToNearest(run(params), ctx);
    expect(out.measured).toBe(1);
    expect(out.line).toBe("1 building measured");
    expect(out.caveats).toEqual([{ cause: "none within 500 m", count: 1 }]);
  });

  it("uses the search limit the run actually froze in its sentence", async () => {
    const { ctx, sql } = context({
      distance: [
        row("B1", "B1", { roads_distance_m: null, roads_nearest_id: null }),
      ],
    });
    const out = await distanceToNearest(
      run({ ...params, maxDistanceM: 250 }),
      ctx,
    );
    expect(out.caveats).toEqual([{ cause: "none within 250 m", count: 1 }]);
    expect(distanceStatement(sql)).toContain(
      'ST_Distance(b."g", s."geom") <= 250',
    );
  });

  it("counts a feature with no proxy as skipped, never as out of range", async () => {
    const { ctx } = context({
      distance: [
        row("B1", "B1", { roads_distance_m: 3, roads_nearest_id: "r7" }),
        {
          ...row("B2", "B2", {
            roads_distance_m: null,
            roads_nearest_id: null,
          }),
          no_proxy: true,
        },
      ],
    });
    const out = await distanceToNearest(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
    expect(out.caveats).toEqual([]);
    expect(out.measured).toBe(1);
    expect(out.line).toBe("1 building measured");
  });

  it("names the proxy in the log, as §7.7 words it", async () => {
    const { ctx, labels } = context({
      distance: [row("B1", "B1", { roads_distance_m: 1 })],
    });
    await distanceToNearest(run({ ...params, proxy: "centre" }), ctx);
    expect(labels).toEqual(["2D distance to the building centre"]);
  });

  it("yields and re-checks the cancellation every batch of rows", async () => {
    // Nothing walks a whole layer's results without giving the event loop a
    // turn: a 100k-row layer must stay cancellable and keep painting.
    const many = Array.from({ length: DISTANCE_BATCH_ROWS * 2 + 1 }, (_, i) =>
      row(`B${i}`, `B${i}`, { roads_distance_m: 1, roads_nearest_id: "r7" }),
    );
    const cancelChecks = vi.fn();
    const { ctx } = context(
      { distance: many },
      { throwIfCancelled: cancelChecks },
    );
    await distanceToNearest(run(params), ctx);
    // Once when the statement came back, then once per completed batch.
    expect(cancelChecks).toHaveBeenCalledTimes(
      1 + Math.floor(many.length / DISTANCE_BATCH_ROWS),
    );
  });

  it("omits the id column when the checkbox is off", async () => {
    const { ctx, sql } = context({
      distance: [row("B1", "B1", { roads_distance_m: 1 })],
    });
    const out = await distanceToNearest(
      run({ ...params, writeNearestId: false }),
      ctx,
    );
    expect(out.columns).toEqual([{ name: "roads_distance_m", type: "DOUBLE" }]);
    expect(distanceStatement(sql)).not.toContain("roads_nearest_id");
  });

  it("opens and RELEASES the reader for the footprint proxy", async () => {
    const { ctx, phases } = context({
      distance: [row("B1", "B1", { roads_distance_m: 1 })],
      scope: [{ id: "B1", f: "B1" }],
      sourceIds: ["B1"],
    });
    await distanceToNearest(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readSource)).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run_1", lod: "0" }),
    );
    expect(phases).toEqual(["source", "compute"]);
    expect(released).toEqual(["run_1"]);
  });

  it("releases the reader when the statement FAILS", async () => {
    const { ctx } = context(
      {
        scope: [{ id: "B1", f: "B1" }],
        sourceIds: ["B1"],
      },
      {
        query: vi.fn(async (_label: string, statement: string) => {
          if (statement.startsWith(`SELECT "id", COALESCE`)) {
            return {
              ok: true as const,
              columns: ["id", "f"],
              rows: [{ id: "B1", f: "B1" }],
            };
          }
          if (statement.startsWith(`SELECT "id" FROM read_cityjson(`)) {
            return { ok: true as const, columns: ["id"], rows: [{ id: "B1" }] };
          }
          throw new Error("Invalid Input Error: not a CityJSON file");
        }),
      },
    );
    await expect(
      distanceToNearest(run({ ...params, proxy: "footprint" }), ctx),
    ).rejects.toThrow(
      "Could not re-read the source (network or decompression error)",
    );
    expect(released).toEqual(["run_1"]);
  });

  it("sends the footprint statement through Task 5's two source doors", async () => {
    // §6.1's sentences and the id-join threshold belong to `sourceRead`; this
    // executor's job is to go through them rather than decide them again.
    const { ctx } = context({
      distance: [row("B1", "B1", { roads_distance_m: 1 })],
      scope: [
        { id: "B1", f: "B1" },
        { id: "B1P", f: "B1" },
      ],
      sourceIds: ["B1", "B1P"],
    });
    await distanceToNearest(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Checking source ids",
      expect.stringContaining(`SELECT "id" FROM read_cityjson(`),
    );
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "2D distance to the building footprint",
      expect.stringContaining("read_cityjson('layer_1_run_1.city.json'"),
    );
    // EVERY id THIS RUN'S OWN SCOPE READ returned — roots and non-contributors
    // included — never `ctx.featureIds`, which is null on scope "all" and
    // would leave the widest scope the only unchecked one.
    expect(vi.mocked(assertSourceIds)).toHaveBeenCalledWith(
      ["B1", "B1P"],
      new Set(["B1", "B1P"]),
    );
  });

  // The scope-wide identity ruling, over the three scopes §6 offers.
  const scopeRows = [
    { id: "B1", f: "B1" },
    { id: "B1P", f: "B1" },
    { id: "B2", f: "B2" },
  ];
  const scopes: ReadonlyArray<{
    readonly scope: RunRecord["scope"];
    readonly featureIds: ReadonlyArray<string> | null;
  }> = [
    { scope: "all", featureIds: null },
    { scope: "selected", featureIds: ["B1", "B1P", "B2"] },
    { scope: "matching", featureIds: ["B1", "B1P", "B2"] },
  ];
  for (const { scope, featureIds } of scopes) {
    it(`fails a ${scope} run whose source no longer holds the ROOT`, async () => {
      // The root carries the semantics and the part carries the shape, so a
      // footprint run measures the PART — and a root that has vanished from the
      // file would never be missed by a check over contributors alone.
      const { ctx } = context(
        {
          distance: [row("B1", "B1", { roads_distance_m: 1 })],
          scope: scopeRows,
          sourceIds: ["B1P", "B2"],
        },
        { featureIds },
      );
      await expect(
        distanceToNearest(
          run({ ...params, proxy: "footprint" }, { scope }),
          ctx,
        ),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      expect(released).toEqual(["run_1"]);
    });

    it(`fails a ${scope} run whose source no longer holds a PART`, async () => {
      const { ctx, sql } = context(
        {
          distance: [row("B1", "B1", { roads_distance_m: 1 })],
          scope: scopeRows,
          sourceIds: ["B1", "B2"],
        },
        { featureIds },
      );
      await expect(
        distanceToNearest(
          run({ ...params, proxy: "footprint" }, { scope }),
          ctx,
        ),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      // BEFORE the compute: the distance statement never ran.
      expect(distanceStatement(sql)).toBe("");
    });
  }

  it("leaves both doors alone for a proxy that reads no source", async () => {
    // The bbox proxies read the browsing TABLE and nothing else, so there is no
    // re-read to check the identity of — and no scope read to pay for either.
    const { ctx, sql } = context({
      distance: [row("B1", "B1", { roads_distance_m: 1 })],
    });
    await distanceToNearest(run({ ...params, proxy: "centre" }), ctx);
    expect(vi.mocked(readSource)).not.toHaveBeenCalled();
    expect(vi.mocked(readerQuery)).not.toHaveBeenCalled();
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
    expect(sql).toHaveLength(1);
  });

  it("refuses a run whose source is not a vector layer", async () => {
    const { ctx } = context({}, { source: null });
    await expect(distanceToNearest(run(params), ctx)).rejects.toThrow(
      "Add a vector layer to join with",
    );
  });

  it("refuses a footprint run whose target lost its LoD 0 rung (§6.1)", async () => {
    const { ctx } = context(
      {},
      { table: table({ lods: [{ label: "2.2", suffix: "2_2" }] }) },
    );
    await expect(
      distanceToNearest(run({ ...params, proxy: "footprint" }), ctx),
    ).rejects.toThrow("Layer changed while running; run again");
  });

  it("refuses when the FROZEN id property left the source (§6.1)", async () => {
    // Frozen with `name`; the source was re-linked while the run was queued and
    // carries `label` now. `props->>'name'` would write NULL into every
    // building under a card that says the run measured them all.
    const { ctx, sql } = context(
      {},
      { source: source({ propertyKeys: ["label"] }) },
    );
    await expect(
      distanceToNearest(run({ ...params, nearestIdProperty: "name" }), ctx),
    ).rejects.toThrow("Layer changed while running; run again");
    expect(sql).toEqual([]);
  });

  it("accepts an id property carried only by a SKIPPED source feature", async () => {
    // Residual B7, through Task 12's REAL preflight: `propertyKeys` lists every
    // LIVE feature's keys, kept or skipped, so a property that belongs to a
    // feature whose GEOMETRY was skipped is still a property of an unchanged
    // layer. Failing it would call an untouched document "Layer changed".
    const preflight = await reprojectGeoLayer(
      normalizeGeoJsonDocument({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "r1",
            properties: { name: "Oude Delft" },
            geometry: {
              type: "LineString",
              coordinates: [
                [4, 52],
                [5, 53],
              ],
            },
          },
          // Skipped for its geometry; `ref` is still the layer's property.
          {
            type: "Feature",
            id: "r2",
            properties: { ref: "N470" },
            geometry: null,
          },
        ],
      }).data,
      28992,
    );
    expect(preflight.skipped).toBe(1);
    const { ctx } = context(
      {
        distance: [
          row("B1", "B1", { roads_distance_m: 4, roads_nearest_id: "N470" }),
        ],
      },
      {
        source: source({
          propertyKeys: preflight.propertyKeys,
          propertyTypes: preflight.propertyTypes,
          skipped: preflight.skipped,
        }),
      },
    );
    const out = await distanceToNearest(
      run({ ...params, nearestIdProperty: "ref" }),
      ctx,
    );
    expect(out.line).toBe("1 building measured");
  });

  it("does not mind a changed source when the id comes from the FEATURE id", async () => {
    // `nearestIdProperty: null` is §7.7's "the GeoJSON feature `id`", which is
    // `fid` — a column of the per-run table, not a property of the document.
    const { ctx } = context(
      {
        distance: [
          row("B1", "B1", { roads_distance_m: 1, roads_nearest_id: "r7" }),
        ],
      },
      { source: source({ propertyKeys: [] }) },
    );
    const out = await distanceToNearest(run(params), ctx);
    expect(out.rows.get("B1")).toMatchObject({ roads_nearest_id: "r7" });
  });

  it("does not mind a changed source when the id is not written at all", async () => {
    const { ctx } = context(
      { distance: [row("B1", "B1", { roads_distance_m: 1 })] },
      { source: source({ propertyKeys: [] }) },
    );
    const out = await distanceToNearest(
      run({ ...params, writeNearestId: false, nearestIdProperty: "name" }),
      ctx,
    );
    expect(out.columns).toEqual([{ name: "roads_distance_m", type: "DOUBLE" }]);
  });
});
