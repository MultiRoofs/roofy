### Task 19: Aggregate buildings per area

**Files:**

- Create: `src/features/processing/tools/aggregatePerArea.ts`
- Modify: `src/features/processing/toolRegistry.ts` (`styleByResult`, `implemented: true`), `src/features/processing/tools/register.ts`, `tests/unit/features/processing/register.test.ts`
- Test: `tests/unit/features/processing/aggregatePerArea.test.ts`, additions to `tests/integration/duckdb/crossLayer.test.ts`

**Interfaces:**

- Consumes: `ToolTarget` (`kind: "vector"`) and `ToolSource` (`kind: "city"`) (Task 11), `createVectorTable`/`VectorTableHandle` (Task 13 — here the TARGET areas are the reprojected side), `reprojectGeoLayer` (Task 12), `buildFeatureProxySql`/`lodZeroLabel` (Task 14) over the SOURCE city table, `aggregateParams`/`aggregateColumns`/`slugifyField` (Task 15), `mergeGeoFeatureProperties` (Task 18, through the queue's publication), `readSource`/`readerQuery` (Task 5 — `assertSourceIds` is deliberately not used: the statement's rows are AREAS, so there is no building-id set to join), `ensureModelCrsLoadable` (`ensureCrs.ts:32`), `epsgForLayer` (`cursorCrsReadout.ts:35`).
- Produces: `buildAggregateSql(input)` and `aggregatePerArea: ToolExecutor` in `tools/aggregatePerArea.ts`, plus `registerExecutor("aggregate-per-area", aggregatePerArea)`; the registry entry's `styleByResult` = `{ kind: "attribute", pick: (w) => w[0] ?? null }` and `implemented: true`.

**The direction is reversed, and the executor owns its own source phase.** For §7.5 and §7.7 the queue builds `__src_<runId>` from the SOURCE vector layer in the `"source"` phase (Task 13, `tool.sourceKind === "vector"`). Aggregate's `sourceKind` is `"city"`, so the queue builds nothing: the reprojected side is the TARGET's areas, and only the executor knows that. It therefore does its own `"source"` phase — `ensureModelCrsLoadable` on the SOURCE city model, `reprojectGeoLayer` on the target's `preparedData`, `createVectorTable`, and a `release()` in a `finally`. The areas' stored WGS84 geometry is never touched: `reprojectGeoLayer` is pure and returns WKT.

**Every target area is written, matched or not** (§7.6: "the target's every feature is written"). That is why the join is `FROM <areas> s LEFT JOIN <buildings> p`, not the other way round: an area with no buildings keeps its row, its count is `COUNT(p."f")` = 0, and its sums are NULL over an empty set — which is exactly §6.2's value rule ("a count that WAS evaluated and found nothing is 0"; "an area whose buildings are all NULL gets NULL").

**A building counts for every area it satisfies the predicate with** (§7.6), so nothing de-duplicates the join — and the card says so when it happens. The "counted in more than one area" number is a scalar sub-select over the same join, so the whole compute stays ONE statement.

**Parts never count.** The buildings side is `buildFeatureProxySql`'s per-FEATURE relation, and the values are read from the ROOT rows only (`"id" = COALESCE("feature_id","id")`) — a run's own columns are written onto the root AND the parts (§8), so summing every row would count a three-part building four times.

**`count` counts FEATURES WITH A PROXY, not rows and not values.** A building whose geometry is missing has no proxy, cannot satisfy any predicate, and is reported as skipped "no geometry" — never as an area's zero.

**The count column is `` `${prefix}buildings_n` ``, which with §7.6's default prefix reads `bld_buildings_n`** (commander's ruling, Decisions item 6 (v)). §7.6 names the column "`<prefix><agg>_<column>` (`buildings_n` for count)", so `buildings_n` there is the un-prefixed SUFFIX, and §10 scenario 11's bare `buildings_n` is the same shorthand — the layer's actual property is `bld_buildings_n`. `aggregateColumns` (Task 15) is the one producer; this executor and the smoke both read it from there and never spell the column by hand.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/aggregatePerArea.test.ts`:

```ts
/**
 * §7.6, the reverse direction: every target area written, buildings counted
 * once per area they fall in, parts never counted.
 *
 * The statement as a string, then the executor over a fake context whose
 * `query` answers one row per area. `vectorSource` and `vectorTable` are
 * mocked so the test is about the AGGREGATION, not about proj4 or the VFS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ runId: string; features: number }> = [];
const released: string[] = [];

vi.mock("../../../../src/features/processing/vectorTable", () => ({
  createVectorTable: vi.fn(
    async (input: { runId: string; preflight: { features: unknown[] } }) => {
      created.push({
        runId: input.runId,
        features: input.preflight.features.length,
      });
      return {
        table: `__src_${input.runId}`,
        release: async () => {
          released.push(`__src_${input.runId}`);
        },
      };
    },
  ),
}));

vi.mock("../../../../src/features/layers/ensureCrs", () => ({
  ensureModelCrsLoadable: vi.fn(async () => {}),
}));

// `sourceRead` reaches `insights/duckdb`, the one importer of
// `@duckdb/duckdb-wasm`. Every test here uses the rectangle proxy, so the
// mock's `readSource` is never called — but the module graph still loads it.
vi.mock("../../../../src/features/processing/sourceRead", () => ({
  readSource: vi.fn(async () => ({
    from: "read_cityjson('layer_1_run_1.city.json', lod => '0')",
    geometryColumn: "geometry_lod0",
    propertiesColumn: "geometry_properties_lod0",
    release: async () => {},
  })),
  // Task 5's other two source doors, spied rather than reimplemented: what the
  // §6.1 sentences and the id-join THRESHOLD do is `sourceRead.test.ts`'s to
  // assert, and what this executor owns is that it goes through them.
  readerQuery: vi.fn(
    async (
      ctx: { query: (label: string, sql: string) => Promise<unknown> },
      label: string,
      sql: string,
    ) => ctx.query(label, sql),
  ),
  assertSourceIds: vi.fn(),
  sourceWorkloadNote: () => null,
}));

vi.mock("../../../../src/scene/cursorCrsReadout", () => ({
  epsgForLayer: () => 28992,
  crsFromGeodetic: (lng: number, lat: number, h: number) =>
    [lng * 1000, lat * 1000, h] as const,
}));

const { aggregatePerArea, buildAggregateSql } =
  await import("../../../../src/features/processing/tools/aggregatePerArea");
const { assertSourceIds, readerQuery } =
  await import("../../../../src/features/processing/sourceRead");
const { normalizeGeoJsonDocument } =
  await import("../../../../src/features/geoLayers/geoJsonRecords");
const { geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");
import type { LayerTable } from "../../../../src/insights/layerTables";
import type { ToolContext } from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

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
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "roof_area_m2", type: "DOUBLE", kind: "scalar" },
    ],
    lods: [{ label: "0", suffix: "0" }],
    rowCount: 3,
  } as LayerTable;
}

function run(params: Record<string, unknown>): RunRecord {
  return {
    id: "run_1",
    toolId: "aggregate-per-area",
    targetLayerId: "GEO",
    targetName: "Zones",
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
    note: null,
  };
}

function context(
  rows: ReadonlyArray<Record<string, unknown>>,
  areas = 2,
): { ctx: ToolContext; sql: string[]; warnings: string[] } {
  const sql: string[] = [];
  const warnings: string[] = [];
  const document = zonesDocument(areas);
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
    query: vi.fn(async (_label: string, statement: string) => {
      sql.push(statement);
      return { ok: true as const, columns: [], rows: [...rows] };
    }),
    phase: vi.fn(),
    warn: vi.fn((text: string) => warnings.push(text)),
    throwIfCancelled: vi.fn(),
  } as unknown as ToolContext;
  return { ctx, sql, warnings };
}

beforeEach(() => {
  created.length = 0;
  released.length = 0;
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

  it("counts the buildings that fell in more than one area, in the same statement", () => {
    expect(buildAggregateSql(base)).toContain(
      'HAVING COUNT(DISTINCT "sid") > 1',
    );
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
    const { ctx } = context([
      {
        sid: "id:string:z1",
        bld_buildings_n: 2,
        bld_sum_roof_area_m2: 90,
        multi_n: 0,
        buildings_total: 2,
        no_proxy_n: 0,
      },
      {
        sid: "id:string:z2",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 2,
        no_proxy_n: 0,
      },
    ]);
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

  it("is §7.6's card line, with the overlap count as a caveat", async () => {
    const { ctx } = context([
      {
        sid: "id:string:z1",
        bld_buildings_n: 2,
        bld_sum_roof_area_m2: 90,
        multi_n: 1,
        buildings_total: 3,
        no_proxy_n: 0,
      },
      {
        sid: "id:string:z2",
        bld_buildings_n: 2,
        bld_sum_roof_area_m2: 40,
        multi_n: 1,
        buildings_total: 3,
        no_proxy_n: 0,
      },
    ]);
    const out = await aggregatePerArea(run(params), ctx);
    expect(out.line).toBe("2 areas aggregated over 3 buildings");
    expect(out.caveats).toEqual([
      { cause: "building counted in more than one area", count: 1 },
    ]);
    expect(out.measured).toBe(3);
  });

  it("reports a building with no proxy as skipped, not as an area's zero", async () => {
    const { ctx } = context([
      {
        sid: "id:string:z1",
        bld_buildings_n: 1,
        bld_sum_roof_area_m2: 50,
        multi_n: 0,
        buildings_total: 1,
        no_proxy_n: 2,
      },
      {
        sid: "id:string:z2",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 1,
        no_proxy_n: 2,
      },
    ]);
    const out = await aggregatePerArea(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 2 }]);
  });

  it("reprojects the TARGET's areas and releases the table it made", async () => {
    const { ctx } = context([
      {
        sid: "id:string:z1",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 0,
        no_proxy_n: 0,
      },
    ]);
    await aggregatePerArea(run(params), ctx);
    expect(created).toEqual([{ runId: "run_1", features: 2 }]);
    expect(released).toEqual(["__src_run_1"]);
  });

  it("sends the footprint statement through `readerQuery`, and joins no ids", async () => {
    // §6.1's sentence for a failure INSIDE the reader statement is Task 5's,
    // and this executor goes through its one door. The id join does NOT happen
    // here and that is deliberate: these rows are the TARGET's areas, so there
    // is no returned building-id set to join the requested one against.
    vi.mocked(readerQuery).mockClear();
    vi.mocked(assertSourceIds).mockClear();
    const { ctx } = context([
      {
        sid: "id:string:z1",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 0,
        no_proxy_n: 0,
      },
    ]);
    await aggregatePerArea(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Aggregating buildings per area",
      expect.stringContaining("read_cityjson('layer_1_run_1.city.json'"),
    );
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
  });

  it("refuses a target with no usable areas, with §7.6's own sentence", async () => {
    const { ctx } = context([]);
    const emptyTarget = {
      ...ctx,
      target: {
        kind: "vector",
        layer: {
          id: "GEO",
          name: "Zones",
          kind: "geojson",
          config: {
            preparedData: normalizeGeoJsonDocument({
              type: "FeatureCollection",
              features: [],
            }).data,
          },
        },
        records: [],
      },
    } as unknown as ToolContext;
    await expect(aggregatePerArea(run(params), emptyTarget)).rejects.toThrow(
      "The layer has no areas",
    );
  });

  it("records the areas preflight could not use, as §7.5 words it", async () => {
    const document = normalizeGeoJsonDocument({
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
    const { ctx, warnings } = context([
      {
        sid: "id:string:z2",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 0,
        no_proxy_n: 0,
      },
    ]);
    const withSkips = {
      ...ctx,
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
    } as unknown as ToolContext;
    await aggregatePerArea(run(params), withSkips);
    expect(warnings).toContain("1 area skipped: invalid geometry");
  });

  it("writes NULL over an area preflight could not use, never stale values", async () => {
    // §7.6: "the target's every feature is written." The area whose geometry
    // became unusable is not in the statement's answer at all, so without an
    // explicit NULL row it would keep the PREVIOUS run's numbers under this
    // run's provenance.
    const document = normalizeGeoJsonDocument({
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
    const { ctx } = context([
      {
        sid: "id:string:z2",
        bld_buildings_n: 4,
        bld_sum_roof_area_m2: 120,
        multi_n: 0,
        buildings_total: 4,
        no_proxy_n: 0,
      },
    ]);
    const withSkips = {
      ...ctx,
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
    } as unknown as ToolContext;
    const out = await aggregatePerArea(run(params), withSkips);
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
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/aggregatePerArea.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the executor**

Create `src/features/processing/tools/aggregatePerArea.ts`:

```ts
/**
 * Aggregate buildings per area (spec §7.6) — §7.5's direction reversed.
 *
 * THE REVERSAL IS THE WHOLE TASK. For §7.5 and §7.7 the SOURCE is the vector
 * layer and the queue registers it in the `"source"` phase; here the SOURCE is a
 * city layer and the reprojected side is the TARGET's areas, which only this
 * executor knows. So it runs its own `"source"` phase: `ensureModelCrsLoadable`
 * on the SOURCE city model (`crsFromGeodetic`'s guard is synchronous),
 * `reprojectGeoLayer` on the target's `preparedData`, `createVectorTable`, and a
 * `release()` in a `finally` that runs on every exit path. The areas' STORED
 * WGS84 geometry is never touched — `reprojectGeoLayer` mutates nothing and hands
 * back WKT.
 *
 * EVERY TARGET AREA IS WRITTEN (§7.6), which is why the join runs FROM the areas
 * LEFT JOIN the buildings: an area with no buildings keeps its row, its count is
 * a real 0 and its sums are NULL over an empty set — §6.2's value rule exactly.
 *
 * A BUILDING COUNTS FOR EVERY AREA IT SATISFIES THE PREDICATE WITH (§7.6), so
 * nothing de-duplicates the join; the "counted in more than one area" number is
 * a scalar sub-select over the same join, so the compute is still one statement.
 *
 * PARTS NEVER COUNT. The buildings side is the per-FEATURE proxy relation, and a
 * value is read from the ROOT row only — a run writes its columns onto the root
 * AND the parts (§8), so summing every row would count a three-part building
 * four times.
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import { ensureModelCrsLoadable } from "../../layers/ensureCrs";
import { geoRecordId } from "../../geoLayers/geoRecords";
import { epsgForLayer } from "../../../scene/cursorCrsReadout";
import {
  buildFeatureProxySql,
  lodZeroLabel,
  type BuildingProxy,
} from "../buildingProxy";
import {
  aggregateColumns,
  aggregateParams,
  type AggregateOp,
  type JoinPredicate,
} from "../crossLayerParams";
import {
  assertSourceIds,
  readSource,
  readerQuery,
  type ReadSourceHandle,
} from "../sourceRead";
import { reprojectGeoLayer } from "../vectorSource";
import { createVectorTable, type VectorTableHandle } from "../vectorTable";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** One aggregate row, resolved: the op, the SOURCE column and the output name. */
export interface AggregateSpec {
  readonly op: AggregateOp;
  readonly column: string | null;
  readonly name: string;
}

export interface AggregateSqlInput {
  readonly table: string;
  readonly source: string;
  readonly proxy: BuildingProxy;
  readonly from: string | null;
  readonly geometryColumn: string | null;
  readonly ids: ReadonlyArray<string> | null;
  readonly predicate: JoinPredicate;
  readonly rows: ReadonlyArray<AggregateSpec>;
}

const SQL_OP: Readonly<Record<Exclude<AggregateOp, "count">, string>> = {
  sum: "SUM",
  mean: "AVG",
  min: "MIN",
  max: "MAX",
};

export function buildAggregateSql(input: AggregateSqlInput): string {
  // §7.6 shares §7.5's predicate, including "centre within" forcing the centre.
  const proxy: BuildingProxy =
    input.predicate === "centreWithin" ? "centre" : input.proxy;
  // §7.5's `within` is boundary-INCLUSIVE ("the whole proxy inside the area,
  // boundary included"), which is covered-by and not within — a footprint
  // sharing an edge with its zone is `ST_Within` FALSE. §7.6 shares §7.5's
  // predicate list, so it shares this reading of it; Task 16 probes both
  // against the real engine.
  const predicate =
    input.predicate === "within"
      ? `ST_CoveredBy(p."g", s."geom")`
      : `ST_Intersects(p."g", s."geom")`;
  const b = buildFeatureProxySql({
    proxy,
    table: input.table,
    from: input.from,
    geometryColumn: input.geometryColumn,
    ids: input.ids,
  });
  // One alias per DISTINCT source column, so two aggregates over one column
  // read it once and no output name can collide with a data column.
  const aliases = new Map<string, string>();
  for (const row of input.rows) {
    if (row.column !== null && !aliases.has(row.column)) {
      aliases.set(row.column, `c${aliases.size}`);
    }
  }
  const valueSelect = [...aliases]
    .map(([column, alias]) => `${quoteIdent(column)} AS ${quoteIdent(alias)}`)
    .join(", ");
  const whereIds =
    input.ids === null
      ? ""
      : ` AND "id" IN (${input.ids.map((id) => quoteLiteral(id)).join(", ")})`;
  // The ROOT rows only: §8 writes a feature's value onto the root AND its
  // parts, so every row would count the building once per part.
  const v =
    aliases.size === 0
      ? null
      : `SELECT COALESCE("feature_id", "id") AS "f", ${valueSelect} ` +
        `FROM ${quoteIdent(input.table)} ` +
        `WHERE "id" = COALESCE("feature_id", "id")${whereIds}`;
  const p =
    v === null
      ? `SELECT b."f" AS "f", b."g" AS "g" FROM b`
      : `SELECT b."f" AS "f", b."g" AS "g", ${[...aliases.values()]
          .map((alias) => `v.${quoteIdent(alias)} AS ${quoteIdent(alias)}`)
          .join(", ")} FROM b LEFT JOIN v ON v."f" = b."f"`;
  // Qualified with `m`, never `p` or `s`: those two live INSIDE the `m` CTE and
  // are out of scope in the outer query (a `p.` there is a binder error, not a
  // slower plan). `m` carries `sid`, `f` and every value alias.
  const aggregates = input.rows.map((row) =>
    row.op === "count" || row.column === null
      ? `COUNT(m."f") AS ${quoteIdent(row.name)}`
      : `${SQL_OP[row.op]}(m.${quoteIdent(aliases.get(row.column)!)}) AS ${quoteIdent(row.name)}`,
  );
  return (
    `WITH b AS (${b})` +
    (v === null ? "" : `, v AS (${v})`) +
    `, p AS (${p})` +
    `, m AS (SELECT s."sid" AS "sid", p.* EXCLUDE ("g") ` +
    `FROM ${quoteIdent(input.source)} s LEFT JOIN p ON p."g" IS NOT NULL AND ${predicate}) ` +
    `SELECT m."sid" AS "sid", ${aggregates.join(", ")}, ` +
    // Three scalars for the card, over the same CTEs, so the compute stays one
    // statement: the buildings that fell in more than one area, the buildings
    // counted at all, and the ones with no proxy geometry. A CTE is visible
    // throughout the statement, so `p` is in scope HERE even though `m`'s own
    // aliases are what the aggregates above must use.
    `(SELECT COUNT(*) FROM (SELECT "f" FROM m WHERE "f" IS NOT NULL ` +
    `GROUP BY "f" HAVING COUNT(DISTINCT "sid") > 1) AS "multi") AS "multi_n", ` +
    `(SELECT COUNT(DISTINCT "f") FROM m WHERE "f" IS NOT NULL) AS "buildings_total", ` +
    `(SELECT COUNT(*) FROM p WHERE p."g" IS NULL) AS "no_proxy_n" ` +
    `FROM m GROUP BY m."sid" ORDER BY m."sid"`
  );
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

export const aggregatePerArea: ToolExecutor = async (run, ctx) => {
  const target = ctx.target;
  if (target.kind !== "vector") {
    // §5's own words for the wrong target kind. Unreachable through the form.
    throw new Error("Needs a vector layer");
  }
  const params = aggregateParams(run.params);
  const columns: ReadonlyArray<OutputColumn> = aggregateColumns(
    run.prefix,
    params,
  );
  const specs: AggregateSpec[] = [];
  {
    // `aggregateColumns` SKIPS a row whose op needs a column and has none, so
    // the names and the rows are zipped over the rows that produced a name.
    let i = 0;
    for (const row of params.rows) {
      if (row.op !== "count" && row.column === null) continue;
      const name = columns[i]?.name;
      if (name === undefined) continue;
      specs.push({ op: row.op, column: row.column, name });
      i += 1;
    }
  }

  let areas: VectorTableHandle | null = null;
  let handle: ReadSourceHandle | null = null;
  try {
    ctx.phase("source");
    // §7.6: "the TARGET areas (WGS84) are reprojected app-side into the SOURCE
    // city layer's metric CRS". The await is not optional — `crsFromGeodetic`'s
    // guard is synchronous and answers null for a definition proj4 has not
    // fetched, which would skip every area on a cold CRS.
    await ensureModelCrsLoadable(ctx.layer.model);
    ctx.throwIfCancelled();
    const epsg = epsgForLayer(ctx.layer.model.metadata?.referenceSystem);
    const preflight =
      epsg === null
        ? null
        : await reprojectGeoLayer(target.layer.config.preparedData, epsg, {
            // The batched walk's cancel hook — a Cancel lands inside the
            // reprojection of a large target, not after it (Task 12).
            checkpoint: () => ctx.throwIfCancelled(),
          });
    if (preflight === null || preflight.features.length === 0) {
      // §7.6's own sentence for a target with nothing usable in it.
      throw new Error("The layer has no areas");
    }
    if (preflight.skipped > 0) {
      // §7.5's sentence, which §7.6 adopts: "preflight and skip counts as in
      // §7.5 apply to the areas".
      ctx.warn(
        `${plural(preflight.skipped, "area", "areas")} skipped: invalid geometry`,
      );
    }
    areas = await createVectorTable({
      runId: run.id,
      preflight,
      query: ctx.query,
      control: { checkpoint: () => ctx.throwIfCancelled() },
    });
    if (params.proxy === "footprint" && params.predicate !== "centreWithin") {
      const label = lodZeroLabel(ctx.table);
      if (label === null)
        throw new Error("Layer changed while running; run again");
      handle = await readSource({
        runId: run.id,
        table: ctx.table,
        lod: label,
        signal: ctx.signal,
      });
    }

    ctx.phase("compute");
    const sql = buildAggregateSql({
      table: ctx.table.table,
      source: areas.table,
      proxy: params.proxy,
      from: handle?.from ?? null,
      geometryColumn: handle?.geometryColumn ?? null,
      ids: ctx.featureIds,
      predicate: params.predicate,
      rows: specs,
    });
    // The footprint proxy parses the re-read source inside this statement, so it
    // goes through Task 5's one door for §6.1's sentences.
    //
    // `assertSourceIds` is deliberately NOT called here, and this is the one
    // place in the milestone where that is true: this statement's rows are the
    // TARGET's areas, not the source's buildings, so there is no id set to join
    // the requested one against. A building the file has lost is simply absent
    // from the counts, which §6.1's own stated limit already covers (a source
    // whose CONTENT moved under the same ids is not detectable) — and no
    // executor re-decides the threshold, because none of them owns it.
    const out =
      handle === null
        ? await ctx.query("Aggregating buildings per area", sql)
        : await readerQuery(ctx, "Aggregating buildings per area", sql);
    // A type guard, not logic: the context throws on a failed query.
    if (!out.ok) throw new Error(out.message);

    // §7.6: "the target's EVERY feature is written". The statement answers for
    // the areas that reached the table, and preflight has already dropped the
    // ones with unusable geometry — so every target feature starts at NULL and
    // the evaluated ones are laid over it. Without that, an area whose geometry
    // became unusable between two runs keeps the FIRST run's numbers under the
    // second run's provenance: a value the layer no longer supports, with
    // nothing on screen to say so. NULL is §6.2's "could not be evaluated",
    // which is exactly what happened to it.
    const rows = new Map<string, Record<string, unknown>>();
    const blank: Record<string, unknown> = {};
    for (const column of columns) blank[column.name] = null;
    for (const record of target.records) {
      rows.set(geoRecordId(record), { ...blank });
    }
    for (const row of out.rows) {
      const values: Record<string, unknown> = {};
      for (const column of columns)
        values[column.name] = row[column.name] ?? null;
      rows.set(String(row["sid"]), values);
    }
    const first = out.rows[0];
    const multi = num(first?.["multi_n"]) ?? 0;
    const buildings = num(first?.["buildings_total"]) ?? 0;
    const noProxy = num(first?.["no_proxy_n"]) ?? 0;
    const skipped: SkipCount[] = [];
    if (noProxy > 0) skipped.push({ cause: "no geometry", count: noProxy });
    return {
      columns,
      rows,
      measured: buildings,
      skipped,
      // §7.6: "6 areas aggregated over 1,204 buildings". The areas that were
      // EVALUATED — `rows` also carries the ones preflight could not use, which
      // are written as NULL and were not aggregated over anything.
      line: `${plural(out.rows.length, "area", "areas")} aggregated over ${plural(
        buildings,
        "building",
        "buildings",
      )}`,
      // A `SkipCount` (Task 7's channel). `summarise` renders "<count>
      // <cause>", so the cause carries the NOUN only — picked by the same
      // count, or a single match would read "1 buildings counted in …".
      caveats:
        multi > 0
          ? [
              {
                cause: `${multi === 1 ? "building" : "buildings"} counted in more than one area`,
                count: multi,
              },
            ]
          : [],
    };
  } finally {
    // EVERY exit path, done or not: this executor owns both handles.
    await handle?.release();
    await areas?.release();
  }
};

registerExecutor("aggregate-per-area", aggregatePerArea);
```

- [ ] **Step 4: The registry entry**

In `src/features/processing/toolRegistry.ts`, the `aggregate-per-area` entry gains:

```ts
    // §7.6: "Style by result opens the vector layer's STYLE section with Color
    // by attribute set to the first output column". `operator` and `value` are
    // unused for `kind: "attribute"` and are spelled only because the type
    // requires them.
    styleByResult: {
      kind: "attribute",
      operator: "=",
      value: { kind: "literal", value: true },
      pick: (written) => written[0] ?? null,
    },
    implemented: true,
```

In `src/features/processing/tools/register.ts`, add `import "./aggregatePerArea";`, and add the id to `register.test.ts`'s expected list.

- [ ] **Step 5: Pin the statement against the real engine**

The aggregate statement is the only one in M3 with THREE CTEs, a `p.* EXCLUDE`
and three scalar sub-selects, and a string test cannot tell a binder error from a
typo. Append to `tests/integration/duckdb/crossLayer.test.ts`:

```ts
it("runs the app's OWN aggregate statement, every area kept", async () => {
  db.query(
    `CREATE OR REPLACE TABLE agg_rows AS SELECT * FROM (VALUES
       ('b1', 'b1', 50.0, {'xmin': 1.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 2.0, 'ymax': 2.0, 'zmax': 3.0}),
       ('b1p', 'b1', 50.0, NULL),
       ('b2', 'b2', 20.0, {'xmin': 3.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 4.0, 'ymax': 2.0, 'zmax': 3.0}),
       ('b3', 'b3', NULL, NULL)
     ) AS t("id", "feature_id", "roof_area_m2", "bbox")`,
  );
  db.registerBytes(
    "__src_agg.json",
    await encodeProjectedFeatures([
      {
        idx: 0,
        stableId: "id:string:z1",
        featureId: "z1",
        properties: {},
        wkt: "POLYGON ((0 0, 5 0, 5 5, 0 5, 0 0))",
      },
      {
        idx: 1,
        stableId: "id:string:z2",
        featureId: "z2",
        properties: {},
        wkt: "POLYGON ((100 100, 101 100, 101 101, 100 100))",
      },
    ]),
  );
  db.query(buildVectorTableSql("__src_agg", "__src_agg.json"));
  const rows = db.query(
    buildAggregateSql({
      table: "agg_rows",
      source: "__src_agg",
      proxy: "rectangle",
      from: null,
      geometryColumn: null,
      ids: null,
      predicate: "intersects",
      rows: [
        { op: "count", column: null, name: "bld_buildings_n" },
        { op: "sum", column: "roof_area_m2", name: "bld_sum_roof_area_m2" },
      ],
    }),
  );
  expect(rows).toEqual([
    {
      sid: "id:string:z1",
      bld_buildings_n: 2,
      // The ROOT rows only: b1's 50 counted ONCE despite its part, plus b2's 20.
      bld_sum_roof_area_m2: 70,
      multi_n: 0,
      buildings_total: 2,
      // b3 has no bbox at all — §6.2's "no proxy", never an area's zero.
      no_proxy_n: 1,
    },
    // The area with no buildings KEEPS its row: count 0, sum NULL (§7.6).
    {
      sid: "id:string:z2",
      bld_buildings_n: 0,
      bld_sum_roof_area_m2: null,
      multi_n: 0,
      buildings_total: 2,
      no_proxy_n: 1,
    },
  ]);
  db.query(buildDropVectorTableSql("__src_agg"));
  db.query(`DROP TABLE IF EXISTS agg_rows`);
  db.dropFile("__src_agg.json");
});
```

`buildAggregateSql` comes from `src/features/processing/tools/aggregatePerArea`, and
`encodeProjectedFeatures` / `buildVectorTableSql` / `buildDropVectorTableSql` from
`src/features/processing/vectorTable` (Task 13 already imports the three there).
`db` is Task 1's `Harness`, with `spatial` loaded by that suite's
`installExtension(db, "spatial")`. Run it:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
```

This is the probe that catches `p.* EXCLUDE ("g")`, the three scalar sub-selects
and the CTE scoping — a string assertion cannot tell a binder error from a typo.

- [ ] **Step 6: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features tests/unit/ui
npx tsc -b --noEmit
npx vp check
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
```

Expected: PASS, `tsc` clean, `vp check` at the baseline. All three cross-layer tools are now `implemented: true`, so the catalogue rows are live — check in a real browser that a city layer with no vector layer shows "Add a vector layer to join with" and that Aggregate on a vector target shows the SOURCE select.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/tools/aggregatePerArea.ts \
  src/features/processing/tools/register.ts \
  src/features/processing/toolRegistry.ts \
  tests/unit/features/processing/aggregatePerArea.test.ts \
  tests/unit/features/processing/register.test.ts \
  tests/integration/duckdb/crossLayer.test.ts
git commit -m "feat: Aggregate buildings per area summarises buildings inside each area"
```
