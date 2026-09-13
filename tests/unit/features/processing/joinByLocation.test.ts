/**
 * §7.5 end to end: the one statement, the three predicates, the three tie
 * rules, §6.1's two re-validations and the card's own sentence.
 *
 * The SQL is asserted as a STRING (it is what §6.4's log shows and what a
 * planner reruns by hand); the executor is driven over a fake context whose
 * `query` answers the rows a real engine would, so the roll-up, the value rule
 * and the counts are tested without DuckDB. The STATEMENTS themselves run
 * against a real DuckDB 1.5.5 in `tests/integration/duckdb/crossLayer.test.ts`.
 *
 * TASK 5's TWO SOURCE DOORS ARE THE REAL ONES. Only `readSource` is stubbed
 * (it registers bytes in the wasm heap, which this suite has none of):
 * `readerQuery` and `assertSourceIds` come from `importActual`, wrapped in
 * spies that DELEGATE. So the scope-wide identity ruling is asserted by the
 * sentence §6.1 actually throws, not by a mock's call log — a stubbed
 * `assertSourceIds` would pass whatever ids it was handed.
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
  // bytes as soon as the parse is done AND again in its `finally`, and a stub
  // that counted both would make a correct early release look like a bug.
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
    // 5's own. What this executor owns is that it goes through both doors with
    // the right arguments; §6.1's sentences and the id-join threshold are
    // `sourceRead.test.ts`'s.
    readerQuery: vi.fn(actual.readerQuery),
    assertSourceIds: vi.fn(actual.assertSourceIds),
  };
});

const { buildJoinSql, joinByLocation, JOIN_BATCH_ROWS } =
  await import("../../../../src/features/processing/tools/joinByLocation");
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
    layer: { id: "GEO", name: "Zones", kind: "geojson" },
    table: SRC,
    propertyKeys: ["zone", "noise"],
    propertyTypes: new Map([
      ["zone", "VARCHAR" as const],
      ["noise", "DOUBLE" as const],
    ]),
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
    toolId: "join-by-location",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: "GEO",
    sourceName: "Zones",
    scope: "all",
    scopeCount: 3,
    featureIds: null,
    lod: null,
    params,
    prefix: "zones_",
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

/** One result row of the join statement, internal columns and all. */
function row(
  id: string,
  f: string,
  matchesFeature: number | null,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    f,
    no_proxy: false,
    matches_n_feature: matchesFeature,
    ...values,
  };
}

interface Answers {
  /** The join statement's rows. */
  readonly join?: ReadonlyArray<Record<string, unknown>>;
  /** The scope-rows statement's rows — every SCOPED row of the table. */
  readonly scope?: ReadonlyArray<{ id: string; f: string }>;
  /** The ids the re-read source still holds. */
  readonly sourceIds?: ReadonlyArray<string>;
}

/**
 * A `ToolContext` whose `query` answers PER STATEMENT.
 *
 * Three different statements reach it on the footprint path — the scope rows
 * off the table, the reader's ids, and the join itself — and answering all
 * three with the same rows would make the identity check pass by accident.
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
        rows: [...(answers.join ?? [])],
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

/** The join statement, out of everything the run sent. */
const joinStatement = (sql: ReadonlyArray<string>): string =>
  sql.find((s) => s.startsWith("WITH b AS (")) ?? "";

beforeEach(() => {
  released.length = 0;
  vi.mocked(readSource).mockClear();
  vi.mocked(readerQuery).mockClear();
  vi.mocked(assertSourceIds).mockClear();
});

describe("buildJoinSql", () => {
  const base = {
    table: "layer_1",
    source: SRC,
    proxy: "rectangle" as const,
    from: null,
    geometryColumn: null,
    ids: null,
    predicate: "intersects" as const,
    tie: "first" as const,
    prefix: "zones_",
    fields: [] as ReadonlyArray<{
      readonly field: string;
      readonly column: string;
      readonly type: "VARCHAR" | "DOUBLE" | "BOOLEAN";
    }>,
    writeMatchCount: true,
  };

  it("joins the FEATURE proxy to the source and picks by source order", () => {
    const sql = buildJoinSql(base);
    expect(sql).toContain('ST_Intersects(b."g", s."geom")');
    expect(sql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY "idx" ASC NULLS LAST)',
    );
    expect(sql).toContain('COUNT("idx") OVER (PARTITION BY "f")');
    // One row per TABLE ROW at the end: §7's "copied to root and parts alike".
    expect(sql).toContain(
      'FROM "layer_1" t JOIN m ON COALESCE(t."feature_id", t."id") = m."f"',
    );
    // The proxy relation is the FEATURE one: a per-ROW join would give a
    // three-part building three winners.
    expect(sql).toContain(
      'WITH b AS (SELECT COALESCE("feature_id", "id") AS f',
    );
  });

  it("orders by overlap then source order for largest overlap (§7.5)", () => {
    const sql = buildJoinSql({ ...base, tie: "largestOverlap" });
    expect(sql).toContain('ST_Area(ST_Intersection(b."g", s."geom"))');
    expect(sql).toContain(
      'ORDER BY "overlap" DESC NULLS LAST, "idx" ASC NULLS LAST',
    );
  });

  it("uses ST_CoveredBy for `within` — §7.5 includes the boundary", () => {
    const within = buildJoinSql({ ...base, predicate: "within" });
    expect(within).toContain('ST_CoveredBy(b."g", s."geom")');
    // `ST_Within` is interior-only (Task 1's finding D6), so a proxy touching
    // the area's boundary — the ordinary case for a building on a parcel line,
    // and the exact case §7.5 words as "boundary included" — would be dropped.
    expect(within).not.toContain("ST_Within(");
    // §7.5: a centre ON a shared boundary must match BOTH areas, and for a
    // point ST_Intersects and ST_CoveredBy agree while ST_Within does not.
    const centre = buildJoinSql({ ...base, predicate: "centreWithin" });
    expect(centre).toContain('ST_Intersects(b."g", s."geom")');
    expect(centre).toContain("ST_Point(");
  });

  it("FORCES the centre proxy for `centre within`, whatever was asked for", () => {
    // §7.5's own words. The reader is not even read: a footprint join that
    // silently became a centre join would still name the file in §6.4's log.
    const sql = buildJoinSql({
      ...base,
      proxy: "footprint",
      predicate: "centreWithin",
      from: "read_cityjson('x.city.json', lod => '0')",
      geometryColumn: "geometry_lod0",
    });
    expect(sql).toContain("ST_Point(");
    expect(sql).not.toContain("read_cityjson(");
    expect(sql).not.toContain("ST_GeomFromWKB(");
  });

  it("reads a copied field by its JSON key, cast with TRY_CAST", () => {
    const sql = buildJoinSql({
      ...base,
      fields: [
        { field: "Zone Name", column: "zones_zone_name", type: "VARCHAR" },
        { field: "noise", column: "zones_noise", type: "DOUBLE" },
        { field: "flood", column: "zones_flood", type: "BOOLEAN" },
      ],
    });
    // VARCHAR is the `->>` reading itself — and the JSON TEXT of a nested
    // object, which is what §7.5 asks for.
    expect(sql).toContain(`m."props"->>'Zone Name' AS "zones_zone_name"`);
    // TRY_CAST and not `::`: a property that is text in one feature and a
    // number in another would otherwise fail the whole statement, and §6.2's
    // rule for a value that could not be read is NULL.
    expect(sql).toContain(
      `TRY_CAST(m."props"->>'noise' AS DOUBLE) AS "zones_noise"`,
    );
    expect(sql).toContain(
      `TRY_CAST(m."props"->>'flood' AS BOOLEAN) AS "zones_flood"`,
    );
  });

  it("writes NULL rather than 0 for a feature with no proxy (§6.2)", () => {
    expect(buildJoinSql(base)).toContain(
      'CASE WHEN m."no_proxy" THEN NULL ELSE m."matches_n" END AS "zones_matches_n"',
    );
  });

  it("restricts to the frozen row ids on both sides", () => {
    const sql = buildJoinSql({ ...base, ids: ["b1", "o'x"] });
    expect(sql.match(/WHERE "id" IN \('b1', 'o''x'\)/g)).toHaveLength(1);
    expect(sql).toContain(`WHERE t."id" IN ('b1', 'o''x')`);
  });
});

describe("joinByLocation", () => {
  const params = {
    proxy: "rectangle",
    predicate: "intersects",
    fields: ["zone", "noise"],
    tie: "first",
    writeMatchCount: true,
    // Frozen by the form (Decisions item 6 (iii)); the executor types its
    // copied columns from HERE, not from `ctx.source.propertyTypes`.
    fieldTypes: { zone: "VARCHAR", noise: "DOUBLE" },
  };

  it("copies the winning area's values onto every row of the feature", async () => {
    // The three internal columns the projection carries (`f`, `no_proxy`,
    // `matches_n_feature`) are what the per-FEATURE accounting reads; the
    // prefixed ones are what gets written.
    const { ctx } = context({
      join: [
        row("B1", "B1", 1, {
          zones_zone: "A",
          zones_noise: 62,
          zones_matches_n: 1,
        }),
        row("B1P", "B1", 1, {
          zones_zone: "A",
          zones_noise: 62,
          zones_matches_n: 1,
        }),
        row("B2", "B2", 0, {
          zones_zone: null,
          zones_noise: null,
          zones_matches_n: 0,
        }),
      ],
    });
    const out = await joinByLocation(run(params), ctx);
    expect(out.columns).toEqual([
      { name: "zones_zone", type: "VARCHAR" },
      { name: "zones_noise", type: "DOUBLE" },
      { name: "zones_matches_n", type: "DOUBLE" },
    ]);
    expect(out.rows.get("B1P")).toEqual({
      zones_zone: "A",
      zones_noise: 62,
      zones_matches_n: 1,
    });
    // §6.2: a building outside every area got a real 0, not NULL.
    expect(out.rows.get("B2")).toEqual({
      zones_zone: null,
      zones_noise: null,
      zones_matches_n: 0,
    });
  });

  it("is §7.5's card line, with the outside count as a CAVEAT not a skip", async () => {
    const { ctx } = context({
      join: [
        row("B1", "B1", 1, {
          zones_zone: "A",
          zones_noise: 1,
          zones_matches_n: 1,
        }),
        row("B2", "B2", 0, {
          zones_zone: null,
          zones_noise: null,
          zones_matches_n: 0,
        }),
      ],
    });
    const out = await joinByLocation(run(params), ctx);
    expect(out.line).toBe("1 building joined");
    expect(out.caveats).toEqual([{ cause: "outside every area", count: 1 }]);
    expect(out.skipped).toEqual([]);
    expect(out.measured).toBe(2);
  });

  it("counts a feature ONCE, whatever its parts say", async () => {
    // §7: a BuildingPart is never a building. Three rows, two features.
    const { ctx } = context({
      join: [
        row("B1", "B1", 2, { zones_matches_n: 2 }),
        row("B1P", "B1", 2, { zones_matches_n: 2 }),
        row("B2", "B2", 0, { zones_matches_n: 0 }),
      ],
    });
    const out = await joinByLocation(run({ ...params, tie: "countOnly" }), ctx);
    expect(out.line).toBe("1 building joined");
    expect(out.measured).toBe(2);
    expect(out.caveats).toEqual([{ cause: "outside every area", count: 1 }]);
  });

  it("counts a feature with NO proxy as skipped 'no geometry'", async () => {
    const { ctx } = context({
      join: [
        row("B1", "B1", 1, {
          zones_zone: "A",
          zones_noise: 1,
          zones_matches_n: 1,
        }),
        // `no_proxy` — the building has no geometry at all, so §6.2's NULL.
        {
          ...row("B2", "B2", null, {
            zones_zone: null,
            zones_noise: null,
            zones_matches_n: null,
          }),
          no_proxy: true,
        },
      ],
    });
    const out = await joinByLocation(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
    expect(out.rows.get("B2")).toEqual({
      zones_zone: null,
      zones_noise: null,
      zones_matches_n: null,
    });
    expect(out.measured).toBe(1);
    expect(out.line).toBe("1 building joined");
  });

  it("forces the match count on and writes no fields for 'count only'", async () => {
    // §7.5: "count only" "writes no fields and FORCES the match count on" — so
    // the bag starts with the checkbox OFF and both fields ticked, and the run
    // still writes the count column and nothing else.
    const { ctx, sql } = context({
      join: [row("B1", "B1", 2, { zones_matches_n: 2 })],
    });
    const out = await joinByLocation(
      run({ ...params, tie: "countOnly", writeMatchCount: false }),
      ctx,
    );
    expect(out.columns).toEqual([{ name: "zones_matches_n", type: "DOUBLE" }]);
    expect(out.rows.get("B1")).toEqual({ zones_matches_n: 2 });
    expect(joinStatement(sql)).toContain('AS "zones_matches_n"');
    expect(joinStatement(sql)).not.toContain("zones_zone");
  });

  it("yields and re-checks the cancellation every batch of rows", async () => {
    // Nothing walks a whole layer's results without giving the event loop a
    // turn: a 100k-row layer must stay cancellable and keep painting.
    const many = Array.from({ length: JOIN_BATCH_ROWS * 2 + 1 }, (_, i) =>
      row(`B${i}`, `B${i}`, 1, { zones_matches_n: 1 }),
    );
    const cancelChecks = vi.fn();
    const { ctx } = context({ join: many }, { throwIfCancelled: cancelChecks });
    await joinByLocation(run({ ...params, tie: "countOnly" }), ctx);
    // Once when the statement came back, then once per completed batch.
    expect(cancelChecks).toHaveBeenCalledTimes(
      1 + Math.floor(many.length / JOIN_BATCH_ROWS),
    );
  });

  it("opens and RELEASES the reader for the footprint proxy", async () => {
    const { ctx, sql, phases } = context({
      join: [row("B1", "B1", 1, { zones_matches_n: 1 })],
      scope: [{ id: "B1", f: "B1" }],
      sourceIds: ["B1"],
    });
    await joinByLocation(run({ ...params, proxy: "footprint" }), ctx);
    // The LoD 0 rung's own label reached `readSource`, and the FROM it returned
    // is the one the statement reads its footprints from.
    expect(vi.mocked(readSource).mock.calls[0]?.[0]).toMatchObject({
      runId: "run_1",
      lod: "0",
    });
    expect(joinStatement(sql)).toContain(
      "read_cityjson('layer_1_run_1.city.json'",
    );
    expect(joinStatement(sql)).toContain('ST_GeomFromWKB("geometry_lod0")');
    // §6.1's phases, in order: the re-read is "Reading source", the statement
    // is "Computing".
    expect(phases).toEqual(["source", "compute"]);
    // In a `finally`, so a failed compute does not strand the bytes.
    expect(released).toEqual(["run_1"]);
  });

  it("releases the reader when the statement FAILS", async () => {
    const { ctx } = context(
      { scope: [{ id: "B1", f: "B1" }], sourceIds: ["B1"] },
      {
        query: vi.fn(async (_label: string, statement: string) => {
          if (statement.startsWith("WITH b AS (")) {
            throw new Error("Binder Error: no function ST_CoveredBy");
          }
          return statement.startsWith(`SELECT "id" FROM read_cityjson(`)
            ? { ok: true as const, columns: ["id"], rows: [{ id: "B1" }] }
            : {
                ok: true as const,
                columns: ["id", "f"],
                rows: [{ id: "B1", f: "B1" }],
              };
        }),
      },
    );
    await expect(
      joinByLocation(run({ ...params, proxy: "footprint" }), ctx),
    ).rejects.toThrow("Binder Error");
    expect(released).toEqual(["run_1"]);
  });

  it("sends the footprint statement through Task 5's two source doors", async () => {
    // The RULES are `sourceRead.test.ts`'s — §6.1's sentences and the id-join
    // threshold. What this asserts is that the executor does not write a second
    // copy of either, which is how the two solids tools and the three
    // cross-layer tools came to disagree in the review.
    const { ctx } = context({
      join: [row("B1", "B1", 1, { zones_matches_n: 1 })],
      scope: [
        { id: "B1", f: "B1" },
        { id: "B1P", f: "B1" },
      ],
      sourceIds: ["B1", "B1P"],
    });
    await joinByLocation(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Checking source ids",
      expect.stringContaining(`SELECT "id" FROM read_cityjson(`),
    );
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Joining attributes",
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

  // The scope-wide identity ruling, over the three scopes §6 offers. The
  // fixture is one three-row feature plus a lone building, and each case takes
  // exactly one row out of what the SOURCE answers with.
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
      // footprint join measures the PART — and a root that has vanished from
      // the file would never be missed by a check over contributors alone.
      const { ctx } = context(
        {
          join: [row("B1", "B1", 1, { zones_matches_n: 1 })],
          scope: scopeRows,
          sourceIds: ["B1P", "B2"],
        },
        { featureIds },
      );
      await expect(
        joinByLocation(run({ ...params, proxy: "footprint" }, { scope }), ctx),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      expect(released).toEqual(["run_1"]);
    });

    it(`fails a ${scope} run whose source no longer holds a PART`, async () => {
      const { ctx, sql } = context(
        {
          join: [row("B1", "B1", 1, { zones_matches_n: 1 })],
          scope: scopeRows,
          sourceIds: ["B1", "B2"],
        },
        { featureIds },
      );
      await expect(
        joinByLocation(run({ ...params, proxy: "footprint" }, { scope }), ctx),
      ).rejects.toThrow(SOURCE_IDS_DIFFER);
      // BEFORE the compute: the join statement never ran.
      expect(joinStatement(sql)).toBe("");
    });
  }

  it("leaves both doors alone for a proxy that reads no source", async () => {
    // The bbox proxies read the browsing TABLE and nothing else, so there is no
    // re-read to check the identity of — and no scope read to pay for either.
    const { ctx, sql } = context({
      join: [row("B1", "B1", 1, { zones_matches_n: 1 })],
    });
    await joinByLocation(run(params), ctx);
    expect(vi.mocked(readSource)).not.toHaveBeenCalled();
    expect(vi.mocked(readerQuery)).not.toHaveBeenCalled();
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
    expect(sql).toHaveLength(1);
  });

  it("refuses a run whose source is not a vector layer", async () => {
    const { ctx } = context({}, { source: null });
    await expect(joinByLocation(run(params), ctx)).rejects.toThrow(
      "Add a vector layer to join with",
    );
  });

  it("refuses a footprint run whose target lost its LoD 0 rung (§6.1)", async () => {
    const { ctx } = context(
      {},
      { table: table({ lods: [{ label: "2.2", suffix: "2_2" }] }) },
    );
    await expect(
      joinByLocation(run({ ...params, proxy: "footprint" }), ctx),
    ).rejects.toThrow("Layer changed while running; run again");
  });

  it("refuses when a FROZEN field is not in the source any more (§6.1)", async () => {
    // The run was queued with `zone` and `noise`; the source layer was
    // re-linked while it waited and now carries neither. Copying NULL into
    // every building and calling it a join is the failure this prevents.
    const { ctx, sql } = context(
      {},
      { source: source({ propertyKeys: ["district"] }) },
    );
    await expect(joinByLocation(run(params), ctx)).rejects.toThrow(
      "Layer changed while running; run again",
    );
    expect(sql).toEqual([]);
  });

  it("accepts a field carried only by a SKIPPED source feature", async () => {
    // Residual B7, through Task 12's REAL preflight: `propertyKeys` lists every
    // LIVE feature's keys, kept or skipped, so a field that belongs to a
    // feature whose GEOMETRY was skipped is still a field of an unchanged
    // layer. Failing it would call an untouched document "Layer changed".
    const square = [
      [4, 52],
      [5, 52],
      [5, 53],
      [4, 52],
    ];
    const preflight = await reprojectGeoLayer(
      normalizeGeoJsonDocument({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A" },
            geometry: { type: "Polygon", coordinates: [square] },
          },
          // Skipped for its geometry; `noise` is still the layer's field.
          {
            type: "Feature",
            id: "z2",
            properties: { noise: 62 },
            geometry: null,
          },
        ],
      }).data,
      28992,
    );
    expect(preflight.skipped).toBe(1);
    const { ctx } = context(
      {
        join: [
          row("B1", "B1", 1, {
            zones_zone: "A",
            zones_noise: null,
            zones_matches_n: 1,
          }),
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
    const out = await joinByLocation(run(params), ctx);
    expect(out.line).toBe("1 building joined");
  });

  it("does not mind a changed source when no field is copied", async () => {
    // "Count only" copies nothing, so the source's properties are not part of
    // what was promised.
    const { ctx } = context(
      { join: [row("B1", "B1", 1, { zones_matches_n: 1 })] },
      { source: source({ propertyKeys: [] }) },
    );
    const out = await joinByLocation(run({ ...params, tie: "countOnly" }), ctx);
    expect(out.columns).toEqual([{ name: "zones_matches_n", type: "DOUBLE" }]);
  });
});
