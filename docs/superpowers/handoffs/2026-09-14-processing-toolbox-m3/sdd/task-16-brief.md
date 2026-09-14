### Task 16: Join attributes by location

**Files:**

- Create: `src/features/processing/tools/joinByLocation.ts`
- Modify: `src/features/processing/toolRegistry.ts` (`styleByResult`, `implemented: true`), `src/features/processing/tools/register.ts`, `tests/unit/features/processing/register.test.ts`
- Test: `tests/unit/features/processing/joinByLocation.test.ts`, additions to `tests/integration/duckdb/crossLayer.test.ts` (the three predicates, Step 5)

**Interfaces:**

- Consumes: `createVectorTable`/`VectorTableHandle` (Task 13, through `ctx.source`), `buildFeatureProxySql`/`lodZeroLabel`/`proxyDistanceNote` (Task 14), `joinParams`/`joinColumns`/`slugifyField` (Task 15), `readSource`/`ReadSourceHandle`/`readerQuery`/`assertSourceIds` (Task 5 — the footprint statement reads the re-read source, so §6.1's sentence and the id-join threshold come from there and are not decided again here), `ToolExecutor`/`ToolContext`/`ToolResult` (Task 11), `quoteIdent`/`quoteLiteral` (`sql.ts:28-48`).
- Produces: `buildJoinSql(input)` and `joinByLocation: ToolExecutor` in `tools/joinByLocation.ts`, plus `registerExecutor("join-by-location", joinByLocation)`; the registry entry's `styleByResult` and `implemented: true`. **Nothing in `types.ts`**: Task 9 already declares `StyleByResult.operator` and `.value` as `T | ((picked: OutputColumn) => T)` and already exports `resolveStyleOperator` / `resolveStyleValueSource`, and `RunFooter` already routes through them.

**This task SUPPLIES a descriptor and nothing more** (commander's ruling, Decisions recorded item 6 (ii)). §7.5's Style by result is "a rule on the first copied text field `=` its most frequent value; if no text field was copied, on `<prefix>matches_n > 0`" — two different OPERATORS and two different value sources, chosen by which column `pick` returned. That is exactly what Task 9's function unions exist for: this entry passes functions where the other six pass plain values. Do not widen the type, do not add a resolver, do not touch `RunFooter`.

**The whole compute is ONE statement, and it is per FEATURE fanned out to rows in SQL.** §7 evaluates a join "ONCE on the feature's proxy geometry … then copied to root and parts alike", so the proxy relation is `buildFeatureProxySql`'s `(f, g)`, the window picks the winning area per `f`, and the result is joined back to the table's rows by `COALESCE("feature_id","id")`. A per-ROW join would give a three-part building three different winners and would count it three times.

**Three exact SQL decisions, each with its reason.**

- **`within` is `ST_CoveredBy`, and `centre within` is `ST_Intersects`. Neither is `ST_Within`.** §7.5 words `within` as "the whole proxy inside the area, BOUNDARY INCLUDED", and `ST_Within` is exactly the predicate that excludes the boundary: a footprint sharing an edge with its zone — the ordinary case for a building on a parcel line — is `ST_Within` FALSE and `ST_CoveredBy` TRUE. Covered-by is the OGC predicate for "inside, boundary included", so it is the one the sentence names. `centre within` keeps `ST_Intersects` for the same reason stated the other way: §7.5 wants "a centre exactly on a shared boundary" to match BOTH areas so the tie rule decides, and for a point `ST_Intersects` and `ST_CoveredBy` agree. Both are probed against the real engine in Step 5, boundary cases and a degenerate (zero-area) extent included, because this is the one place where a wrong predicate silently drops matches rather than failing.
- **The tie is `ROW_NUMBER() OVER (PARTITION BY f ORDER BY …)`, never `arg_min`.** `arg_min`'s behaviour on equal keys is unspecified, and §7.5's rule is explicit: largest overlap first, "equal overlaps fall back to first", and first is by SOURCE ORDER (`idx`). Two `ORDER BY` keys say exactly that; one `arg_min` cannot.
- **`matches_n` is `CASE WHEN the proxy is NULL THEN NULL ELSE COUNT(idx) END`.** §6.2's value rule: NULL means "could not be evaluated" (no proxy geometry), and a count that WAS evaluated and found nothing is 0.

**Copied values keep their type, through `TRY_CAST`.** `props->>'Zone Name'` is the VARCHAR reading (and the JSON text for a nested object, which is what §7.5 asks for); a DOUBLE or BOOLEAN column is `TRY_CAST(props->>'k' AS DOUBLE)`. `TRY_CAST` and not `::`: a source property that is text in one feature and a number in another would otherwise fail the whole statement, and §6.2's rule for a value that could not be read is NULL.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/joinByLocation.test.ts`:

```ts
/**
 * §7.5 end to end: the one statement, the three predicates, the three tie
 * rules, and the card's own sentence.
 *
 * The SQL is asserted as a STRING (it is what §6.4's log shows and what a
 * planner reruns by hand); the executor is driven over a fake context whose
 * `query` answers the rows a real engine would, so the roll-up, the value rule
 * and the counts are tested without DuckDB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sourceRead` reaches `insights/duckdb`, which is the ONE importer of
 * `@duckdb/duckdb-wasm` — so it is mocked here, HOISTED, rather than doMocked
 * after the fact: a `vi.doMock` after the static import leaves the cached
 * module with the real `readSource` in it.
 */
const released: string[] = [];
vi.mock("../../../../src/features/processing/sourceRead", () => ({
  readSource: vi.fn(async (input: { runId: string; lod: string }) => ({
    from: `read_cityjson('layer_1_${input.runId}.city.json', lod => '${input.lod}')`,
    geometryColumn: `geometry_lod${input.lod.replace(".", "_")}`,
    propertiesColumn: `geometry_properties_lod${input.lod.replace(".", "_")}`,
    release: async () => {
      released.push(input.runId);
    },
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

const { buildJoinSql, joinByLocation } =
  await import("../../../../src/features/processing/tools/joinByLocation");
const { assertSourceIds, readerQuery } =
  await import("../../../../src/features/processing/sourceRead");
import type { LayerTable } from "../../../../src/insights/layerTables";
import type {
  ToolContext,
  ToolSource,
} from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

const SRC = "__src_run_1";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
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

function run(params: Record<string, unknown>): RunRecord {
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
    note: null,
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

beforeEach(() => {
  released.length = 0;
  vi.mocked(readerQuery).mockClear();
  vi.mocked(assertSourceIds).mockClear();
});

function context(
  rows: ReadonlyArray<Record<string, unknown>>,
  over: Partial<ToolContext> = {},
): { ctx: ToolContext; sql: string[] } {
  const sql: string[] = [];
  const ctx = {
    layer: { id: "L1", name: "Delft", isStreaming: false },
    table: table(),
    target: { kind: "city", layer: { id: "L1" }, table: table() },
    source: source(),
    featureIds: null,
    signal: new AbortController().signal,
    query: vi.fn(async (_label: string, statement: string) => {
      sql.push(statement);
      return { ok: true as const, columns: [], rows: [...rows] };
    }),
    phase: vi.fn(),
    warn: vi.fn(),
    throwIfCancelled: vi.fn(),
    ...over,
  } as unknown as ToolContext;
  return { ctx, sql };
}

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
    // `ST_Within` drops a footprint that shares an edge with its zone, which
    // is the ordinary case for a building on a parcel line.
    expect(within).not.toContain("ST_Within(");
    // §7.5: a centre ON a shared boundary must match BOTH areas, and
    // ST_Within of a boundary point is FALSE.
    const centre = buildJoinSql({ ...base, predicate: "centreWithin" });
    expect(centre).toContain('ST_Intersects(b."g", s."geom")');
    expect(centre).toContain("ST_Point(");
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
    expect(sql).toContain(`m."props"->>'Zone Name' AS "zones_zone_name"`);
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
    const { ctx } = context([
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
    ]);
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
    const { ctx } = context([
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
    ]);
    const out = await joinByLocation(run(params), ctx);
    expect(out.line).toBe("1 building joined");
    expect(out.caveats).toEqual([{ cause: "outside every area", count: 1 }]);
    expect(out.skipped).toEqual([]);
    expect(out.measured).toBe(2);
  });

  it("counts a feature with NO proxy as skipped 'no geometry'", async () => {
    const { ctx } = context([
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
    ]);
    const out = await joinByLocation(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
    expect(out.measured).toBe(1);
    expect(out.line).toBe("1 building joined");
  });

  it("forces the match count on and writes no fields for 'count only'", async () => {
    const { ctx, sql } = context([row("B1", "B1", 2, { zones_matches_n: 2 })]);
    const out = await joinByLocation(run({ ...params, tie: "countOnly" }), ctx);
    expect(out.columns).toEqual([{ name: "zones_matches_n", type: "DOUBLE" }]);
    expect(sql[0]).not.toContain("zones_zone");
  });

  it("opens and RELEASES the reader for the footprint proxy", async () => {
    const { ctx, sql } = context([row("B1", "B1", 1, { zones_matches_n: 1 })]);
    await joinByLocation(run({ ...params, proxy: "footprint" }), ctx);
    // The LoD 0 rung's own label reached `readSource`, and the FROM it returned
    // is the one the statement reads its footprints from.
    expect(sql[0]).toContain("read_cityjson('layer_1_run_1.city.json'");
    expect(sql[0]).toContain('ST_GeomFromWKB("geometry_lod0")');
    // In a `finally`, so a failed compute does not strand the bytes.
    expect(released).toEqual(["run_1"]);
  });

  it("sends the footprint statement through Task 5's two source doors", async () => {
    // The RULES are `sourceRead.test.ts`'s — §6.1's sentences and the id-join
    // threshold. What this asserts is that the executor does not write a second
    // copy of either, which is how the two solids tools and the three
    // cross-layer tools came to disagree in the review.
    const { ctx } = context([row("B1", "B1", 1, { zones_matches_n: 1 })], {
      featureIds: ["B1", "B2"],
    });
    await joinByLocation(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "Joining attributes",
      expect.stringContaining("read_cityjson('layer_1_run_1.city.json'"),
    );
    // EVERY requested id, not "no match at all": the statement answered for B1
    // only, so the file no longer holds B2 and §6.1's sentence is due.
    expect(vi.mocked(assertSourceIds)).toHaveBeenCalledWith(
      ["B1", "B2"],
      new Set(["B1"]),
    );
  });

  it("leaves both doors alone for a proxy that reads no source", async () => {
    const { ctx } = context([row("B1", "B1", 1, { zones_matches_n: 1 })]);
    await joinByLocation(run(params), ctx);
    expect(vi.mocked(readerQuery)).not.toHaveBeenCalled();
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
  });

  it("refuses a run whose source is not a vector layer", async () => {
    const { ctx } = context([], { source: null });
    await expect(joinByLocation(run(params), ctx)).rejects.toThrow(
      "Add a vector layer to join with",
    );
  });

  it("refuses when a FROZEN field is not in the source any more (§6.1)", async () => {
    // The run was queued with `zone` and `noise`; the source layer was
    // re-linked while it waited and now carries neither. Copying NULL into
    // every building and calling it a join is the failure this prevents.
    const { ctx, sql } = context([], {
      source: source({ propertyKeys: ["district"] }),
    });
    await expect(joinByLocation(run(params), ctx)).rejects.toThrow(
      "Layer changed while running; run again",
    );
    expect(sql).toEqual([]);
  });

  it("does not mind a changed source when no field is copied", async () => {
    // "Count only" copies nothing, so the source's properties are not part of
    // what was promised.
    const { ctx } = context([row("B1", "B1", 1, { zones_matches_n: 1 })], {
      source: source({ propertyKeys: [] }),
    });
    const out = await joinByLocation(run({ ...params, tie: "countOnly" }), ctx);
    expect(out.columns).toEqual([{ name: "zones_matches_n", type: "DOUBLE" }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/joinByLocation.test.ts
```

Expected: FAIL — `src/features/processing/tools/joinByLocation.ts` does not exist.

- [ ] **Step 3: Write the executor**

Create `src/features/processing/tools/joinByLocation.ts`:

```ts
/**
 * Join attributes by location (spec §7.5).
 *
 * ONE statement, and the shape of it is the whole design:
 *
 *   b  the FEATURE proxy — one row per building, `(f, g)`, `g` NULL where the
 *      building has no geometry at all (`buildFeatureProxySql`);
 *   j  the LEFT JOIN to the per-run vector table on the predicate, carrying the
 *      overlap area when the tie rule needs it;
 *   r  the window: ROW_NUMBER per feature in the tie rule's order, and COUNT of
 *      the matches per feature;
 *   m  the winner (`rn = 1`);
 *   …  joined back to the TABLE's rows by `COALESCE("feature_id","id")`, so the
 *      root and every part carry the feature's answer (§7).
 *
 * WHY PER FEATURE. §7: the joined fields are "evaluated ONCE on the feature's
 * proxy geometry … then copied to root and parts alike". A per-ROW join gives a
 * three-part building three different winners, and §7.6's reverse direction
 * would count it three times.
 *
 * WHY `ROW_NUMBER` AND NOT `arg_min`. §7.5's tie rule is ordered: largest
 * overlap, then "equal overlaps fall back to first", and first is by SOURCE
 * ORDER. Two `ORDER BY` keys state exactly that; `arg_min` on equal keys is
 * unspecified.
 *
 * WHY `within` IS `ST_CoveredBy` AND `centre within` IS `ST_Intersects`. §7.5
 * words `within` as "the whole proxy inside the area, BOUNDARY INCLUDED", and
 * `ST_Within` is the predicate that excludes the boundary — a footprint sharing
 * an edge with its zone is `ST_Within` FALSE. Covered-by is the OGC predicate
 * for the sentence §7.5 wrote. `centre within` wants the opposite emphasis: "a
 * centre exactly on a shared boundary matches BOTH areas and the tie rule below
 * applies", and for a point `ST_Intersects` and `ST_CoveredBy` agree. The proxy
 * is forced to the centre, as §7.5 says.
 *
 * WHY `TRY_CAST`. A source property that is text in one feature and a number in
 * another would fail the whole statement under `::DOUBLE`; §6.2's rule for a
 * value that could not be read is NULL.
 */
import type {
  ColumnType,
  OutputColumn,
} from "../../../insights/computedColumns";
import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import {
  buildFeatureProxySql,
  lodZeroLabel,
  type BuildingProxy,
} from "../buildingProxy";
import {
  joinParams,
  slugifyField,
  type JoinPredicate,
  type JoinTie,
} from "../crossLayerParams";
import {
  assertSourceIds,
  readSource,
  readerQuery,
  type ReadSourceHandle,
} from "../sourceRead";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** One copied field: the SOURCE's key, the column it lands in, and its type. */
export interface JoinField {
  readonly field: string;
  readonly column: string;
  readonly type: ColumnType;
}

export interface JoinSqlInput {
  readonly table: string;
  readonly source: string;
  readonly proxy: BuildingProxy;
  readonly from: string | null;
  readonly geometryColumn: string | null;
  readonly ids: ReadonlyArray<string> | null;
  readonly predicate: JoinPredicate;
  readonly tie: JoinTie;
  readonly prefix: string;
  readonly fields: ReadonlyArray<JoinField>;
  readonly writeMatchCount: boolean;
}

function predicateSql(predicate: JoinPredicate): string {
  // §7.5's `within` is "the whole proxy inside the area, BOUNDARY INCLUDED",
  // which is covered-by and not within: a footprint sharing an edge with its
  // zone is `ST_Within` FALSE and `ST_CoveredBy` TRUE. `centreWithin`'s proxy
  // is already the centre, and its predicate is `ST_Intersects` so a point on a
  // shared boundary matches BOTH areas and the tie rule decides (§7.5).
  return predicate === "within"
    ? `ST_CoveredBy(b."g", s."geom")`
    : `ST_Intersects(b."g", s."geom")`;
}

export function buildJoinSql(input: JoinSqlInput): string {
  // §7.5: "centre within" FORCES the centre proxy.
  const proxy: BuildingProxy =
    input.predicate === "centreWithin" ? "centre" : input.proxy;
  const b = buildFeatureProxySql({
    proxy,
    table: input.table,
    from: input.from,
    geometryColumn: input.geometryColumn,
    ids: input.ids,
  });
  const largest = input.tie === "largestOverlap";
  const overlap = largest
    ? `CASE WHEN s."idx" IS NULL THEN NULL ELSE ST_Area(ST_Intersection(b."g", s."geom")) END`
    : `NULL`;
  const order = largest
    ? `"overlap" DESC NULLS LAST, "idx" ASC NULLS LAST`
    : `"idx" ASC NULLS LAST`;
  const selected: string[] = [];
  if (input.tie !== "countOnly") {
    for (const field of input.fields) {
      const read = `m."props"->>${quoteLiteral(field.field)}`;
      selected.push(
        field.type === "VARCHAR"
          ? `${read} AS ${quoteIdent(field.column)}`
          : `TRY_CAST(${read} AS ${field.type}) AS ${quoteIdent(field.column)}`,
      );
    }
  }
  if (input.writeMatchCount) {
    // §6.2's value rule: NULL is "could not be evaluated" (no proxy), 0 is
    // "evaluated and found nothing".
    selected.push(
      `CASE WHEN m."no_proxy" THEN NULL ELSE m."matches_n" END AS ` +
        quoteIdent(`${input.prefix}matches_n`),
    );
  }
  const where =
    input.ids === null
      ? ""
      : ` WHERE t."id" IN (${input.ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `WITH b AS (${b}), ` +
    `j AS (SELECT b."f" AS "f", (b."g" IS NULL) AS "no_proxy", s."idx" AS "idx", ` +
    `s."props" AS "props", ${overlap} AS "overlap" ` +
    `FROM b LEFT JOIN ${quoteIdent(input.source)} s ` +
    `ON b."g" IS NOT NULL AND ${predicateSql(input.predicate)}), ` +
    `r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY ${order}) AS "rn", ` +
    `COUNT("idx") OVER (PARTITION BY "f") AS "matches_n" FROM j), ` +
    `m AS (SELECT * FROM r WHERE "rn" = 1) ` +
    // `f` and `matches_n_feature` are INTERNAL: the per-FEATURE accounting
    // needs the feature key and the raw count, and neither is an output column.
    `SELECT t."id" AS "id", m."f" AS "f", m."no_proxy" AS "no_proxy", ` +
    `m."matches_n" AS "matches_n_feature"` +
    (selected.length === 0 ? "" : `, ${selected.join(", ")}`) +
    ` FROM ${quoteIdent(input.table)} t JOIN m ON COALESCE(t."feature_id", t."id") = m."f"${where}`
  );
}

/** A JS number, or null for anything that is not a finite one. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Yield the event loop every this many result rows, so a Cancel lands and the
 *  page keeps painting on a 100k-row layer. */
const JOIN_BATCH_ROWS = 5000;

export const joinByLocation: ToolExecutor = async (run, ctx) => {
  const source = ctx.source;
  if (source === null || source.kind !== "vector") {
    // §5's own words. Unreachable through the form (eligibility refuses it),
    // and the head's pre-flight says the same — spelled here so an executor
    // never computes over a source it does not have.
    throw new Error("Add a vector layer to join with");
  }
  const params = joinParams(run.params);
  // §6.1's head re-validation, for the SOURCE's own document. The fields were
  // frozen at Run; the queue may have held this run for minutes, and the source
  // layer can have been re-linked or re-prepared in between. `props->>'gone'`
  // would then copy NULL into every building and the run would report a
  // successful join of nothing — so the frozen bag is checked against what
  // preflight actually read, and §6.1's own sentence for a subject that moved
  // is used rather than a new one.
  const missing = params.fields.filter(
    (field) => !source.propertyKeys.includes(field),
  );
  if (params.tie !== "countOnly" && missing.length > 0) {
    throw new Error("Layer changed while running; run again");
  }
  const fields: JoinField[] =
    params.tie === "countOnly"
      ? []
      : params.fields.map((field) => ({
          field,
          column: `${run.prefix}${slugifyField(field)}`,
          // The FROZEN bag, not `source.propertyTypes`: `outputColumns` types
          // the same columns from the same `params.fieldTypes`, and the two
          // must not be able to disagree about a column the write has already
          // declared (Decisions item 6 (iii)).
          type: params.fieldTypes[field] ?? "VARCHAR",
        }));
  const columns: OutputColumn[] = [
    ...fields.map((f) => ({ name: f.column, type: f.type })),
    ...(params.writeMatchCount
      ? [{ name: `${run.prefix}matches_n`, type: "DOUBLE" as const }]
      : []),
  ];

  // §6.1's "Reading source" is already past for the VECTOR side (the queue
  // built `__src_<runId>`); the footprint proxy needs the CITY source too.
  let handle: ReadSourceHandle | null = null;
  try {
    if (params.proxy === "footprint" && params.predicate !== "centreWithin") {
      const label = lodZeroLabel(ctx.table);
      if (label === null) {
        // The form cannot offer the footprint without an LoD 0 rung, so this is
        // a frozen draft whose target was rebuilt. §6.1 fails such a run.
        throw new Error("Layer changed while running; run again");
      }
      ctx.phase("source");
      handle = await readSource({
        runId: run.id,
        table: ctx.table,
        lod: label,
        signal: ctx.signal,
      });
    }
    ctx.phase("compute");
    const sql = buildJoinSql({
      table: ctx.table.table,
      source: source.table,
      proxy: params.proxy,
      from: handle?.from ?? null,
      geometryColumn: handle?.geometryColumn ?? null,
      ids: ctx.featureIds,
      predicate: params.predicate,
      tie: params.tie,
      prefix: run.prefix,
      fields,
      writeMatchCount: params.writeMatchCount,
    });
    // With the footprint proxy this statement PARSES the re-read source, so a
    // gunzip-to-garbage or a wasm allocation failure happens inside it and §6.1
    // promises a sentence for it: Task 5's `readerQuery` is the one door, over
    // the one classifier both stages share, and it keeps DuckDB's own words in
    // the log. Every other proxy reads the browsing table only and stays on
    // `ctx.query`.
    const out =
      handle === null
        ? await ctx.query("Joining attributes", sql)
        : await readerQuery(ctx, "Joining attributes", sql);
    // A type guard, not logic: the context throws on a failed query.
    if (!out.ok) throw new Error(out.message);
    if (handle !== null) {
      // §6.1's id join, at Task 5's ONE threshold. The footprint relation is
      // built FROM the reader (`buildProxySql`'s footprint arm is
      // `FROM <handle.from>`), so a file that no longer holds an object drops
      // that building out of the final inner join and it would be written as
      // "no geometry" — a verdict on geometry nobody looked at. `ctx.featureIds`
      // is what this run asked about BY NAME; a null scope named nothing and the
      // check is vacuous, which is `assertSourceIds`' own documented rule and
      // the same limit §6.1 already states for a source that changed under its
      // ids.
      assertSourceIds(
        ctx.featureIds ?? [],
        new Set(out.rows.map((row) => String(row["id"]))),
      );
    }

    const rows = new Map<string, Record<string, unknown>>();
    const countColumn = `${run.prefix}matches_n`;
    for (const [index, row] of out.rows.entries()) {
      if (index % JOIN_BATCH_ROWS === 0 && index > 0) {
        // A MACROTASK: the loop is cheap, but a Cancel and a repaint need the
        // event loop to actually turn.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
      const noProxy = row["no_proxy"] === true;
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        values[column.name] =
          column.name === countColumn
            ? noProxy
              ? null
              : (num(row[column.name]) ?? 0)
            : (row[column.name] ?? null);
      }
      rows.set(String(row["id"]), values);
    }

    let joined = 0;
    let outside = 0;
    let noGeometry = 0;
    for (const entry of featureEntries(out.rows)) {
      if (!entry.proxy) noGeometry += 1;
      else if (entry.matched) joined += 1;
      else outside += 1;
    }
    const skipped: SkipCount[] = [];
    if (noGeometry > 0)
      skipped.push({ cause: "no geometry", count: noGeometry });
    return {
      columns,
      rows,
      measured: joined + outside,
      skipped,
      // §7.5: "1,143 buildings joined · 61 outside every area · 2.9 s". The
      // elapsed time is `summarise`'s.
      line: plural(joined, "building joined", "buildings joined"),
      // A `SkipCount` (Task 7's channel), never a pre-rendered string:
      // `summarise` prints it as "61 outside every area".
      caveats:
        outside > 0 ? [{ cause: "outside every area", count: outside }] : [],
    };
  } finally {
    await handle?.release();
  }
};

/**
 * The per-FEATURE accounting, over the statement's per-ROW result.
 *
 * Keyed on the FEATURE key `f` the projection carries, so a three-part building
 * is ONE building in every count — §7's rule in every tool.
 */
function featureEntries(
  rows: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<{ readonly proxy: boolean; readonly matched: boolean }> {
  const byFeature = new Map<string, { proxy: boolean; matched: boolean }>();
  for (const row of rows) {
    const f = row["f"];
    // `f` is in the projection for exactly this reason. Counting ROWS would
    // make a three-part building three buildings, which §7 forbids in every
    // count; `f` is the same feature key every roll-up in this toolbox uses.
    const key = typeof f === "string" ? f : String(row["id"]);
    if (byFeature.has(key)) continue;
    const noProxy = row["no_proxy"] === true;
    const count = num(row["matches_n_feature"]);
    byFeature.set(key, {
      proxy: !noProxy,
      matched: !noProxy && count !== null && count > 0,
    });
  }
  return [...byFeature.values()];
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

registerExecutor("join-by-location", joinByLocation);
```

- [ ] **Step 4: The registry entry and the style descriptor**

`src/features/processing/types.ts` needs NO edit: Task 9's `StyleByResult.operator` and `.value` are already `T | ((picked: OutputColumn) => T)`, `resolveStyleOperator` and `resolveStyleValueSource` are already exported beside the type, and `RunFooter` already reads both through them. This entry is the first (and the only) one to pass functions.

In `src/features/processing/toolRegistry.ts`, the `join-by-location` entry gains the descriptor and flips on:

```ts
    // §7.5: "a rule on the first copied TEXT field `=` its most frequent
    // value; if no text field was copied, on `<prefix>matches_n > 0`". Both
    // halves are the same seam, because `pick` chose the column.
    styleByResult: {
      kind: "rule",
      operator: (picked) => (picked.type === "VARCHAR" ? "=" : ">"),
      value: (picked) =>
        picked.type === "VARCHAR"
          ? { kind: "mostFrequent" }
          : { kind: "literal", value: 0 },
      pick: (written) =>
        written.find((c) => c.type === "VARCHAR") ??
        written.find((c) => c.name.endsWith("matches_n")) ??
        null,
    },
    implemented: true,
```

In `src/features/processing/tools/register.ts`, add `import "./joinByLocation";`, and add the id to `tests/unit/features/processing/register.test.ts`'s expected list.

- [ ] **Step 4b: The `mostFrequent` path, end to end through the footer**

Task 9 could only pin Join's descriptor DIRECTLY: `RunFooter` types a run's
written columns from `tool.outputColumns(run.prefix, run.params)`, and Join had
none until Step 4 above. It does now, so this is where the button is actually
pressed — and where Task 9's direct case is brought in line with the FUNCTION
form Step 4 just installed.

Two edits to `tests/unit/ui/processing/styleByResult.test.tsx` (Task 9's file;
its helpers are `addLayer()`, `doneRun(over)`, `seed(run)` and the module-level
`runQuery` spy). First, the last assertion of the direct case. Find:

```ts
// No text field copied: nothing to style by YET. §7.5's other half
// (`<prefix>matches_n > 0`, which is what the operator/value FUNCTION
// unions exist for) is Task 16's, with the tool that ships it.
expect(descriptor.pick([count])).toBeNull();
```

Replace with §7.5's other half, which the descriptor now answers:

```ts
// §7.5's other half: "if no text field was copied, on
// `<prefix>matches_n > 0`". Same descriptor, different column — which is
// what the operator/value FUNCTION unions exist for.
expect(descriptor.pick([count])).toEqual(count);
expect(resolveStyleOperator(descriptor, count)).toBe(">");
expect(resolveStyleValueSource(descriptor, count)).toEqual({
  kind: "literal",
  value: 0,
});
```

Second, add the end-to-end case to the same `describe`, beside the direct one:

```ts
  it("styles a Join by the copied TEXT field's most frequent value (§7.5)", async () => {
    // The footer's own path: `outputColumns(prefix, params)` types the written
    // columns from the FROZEN `fieldTypes`, `pick` finds the VARCHAR, and the
    // value is read with `mode(...)` over ROOT rows — never a median, and
    // never a string handed to `>`.
    const id = addLayer();
    runQuery.mockImplementationOnce(async (sql: string) => {
      statements.push(sql);
      return {
        ok: true as const,
        columns: ["m"],
        rows: [{ m: "Centrum" } as Record<string, unknown>],
      };
    });
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "join-by-location",
            lod: null,
            prefix: "zones_",
            params: {
              proxy: "rectangle",
              predicate: "intersects",
              fields: ["name"],
              tie: "first",
              writeMatchCount: false,
              fieldTypes: { name: "VARCHAR" },
            },
            columns: ["zones_name"],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { zones_name: 2 },
            },
          }),
        )}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await waitFor(() => {
      expect(useRuleDraftStore.getState().drafts[id]?.form?.conditions).toEqual(
        [{ field: "zones_name", operator: "=", value: "Centrum" }],
      );
    });
    expect(statements[0]).toContain('mode("zones_name")');
  });
```

Run both files; the direct case and the footer case must pass together:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing/styleByResult.test.tsx \
  tests/unit/features/processing/joinByLocation.test.ts
```

- [ ] **Step 5: Pin the three predicates against the real engine**

A wrong predicate here does not fail — it silently returns fewer matches, which
no unit test over a fake `query` can see. Append to
`tests/integration/duckdb/crossLayer.test.ts` (Task 1's suite, with `spatial`
loaded by its `installExtension(db, "spatial")`):

```ts
it("is boundary-inclusive for `within`, which ST_Within is not", () => {
  // Two zones sharing the line x = 10, and a footprint that sits inside the
  // west zone with one edge ON that line — the ordinary case for a building on
  // a parcel boundary, and §7.5's "boundary included".
  const rows = db.query(
    `SELECT ST_Within(b, a) AS within, ST_CoveredBy(b, a) AS covered,
            ST_Intersects(b, a) AS intersects
     FROM (SELECT ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))') AS a,
                  ST_GeomFromText('POLYGON ((6 2, 10 2, 10 6, 6 6, 6 2))') AS b)`,
  );
  expect(rows).toEqual([{ within: false, covered: true, intersects: true }]);
});

it("matches a centre exactly on a shared boundary in BOTH areas", () => {
  // §7.5: the tie rule decides which one wins, so the predicate has to offer
  // both — which is why `centre within` is ST_Intersects.
  const rows = db.query(
    `SELECT ST_Intersects(p, west) AS in_west, ST_Intersects(p, east) AS in_east,
            ST_Within(p, west) AS within_west
     FROM (SELECT ST_Point(10, 5) AS p,
                  ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))') AS west,
                  ST_GeomFromText('POLYGON ((10 0, 20 0, 20 10, 10 10, 10 0))') AS east)`,
  );
  expect(rows).toEqual([{ in_west: true, in_east: true, within_west: false }]);
});

it("handles a DEGENERATE extent, which a one-point building has", () => {
  // `ST_MakeEnvelope` over a bbox whose min and max are equal: a building with
  // a single coordinate, or a flat one. It must parse and answer the
  // predicates rather than raising, because one raise fails the whole join.
  const rows = db.query(
    `SELECT ST_Area(b) AS area, ST_CoveredBy(b, a) AS covered,
            ST_Intersects(b, a) AS intersects
     FROM (SELECT ST_MakeEnvelope(5.0, 5.0, 5.0, 5.0) AS b,
                  ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))') AS a)`,
  );
  expect(rows).toEqual([{ area: 0, covered: true, intersects: true }]);
});
```

If `ST_MakeEnvelope` refuses a degenerate rectangle, OR if `ST_CoveredBy` does
not answer true on one that is plainly inside the area (a zero-area polygon is
the kind of input a geometry engine is entitled to call invalid), the fix is in
`buildProxySql`'s rectangle branch — a `CASE` down to `ST_Point` when both mins
equal both maxes — and not in the predicate. Which of the two, and whether
either is needed at all, is what the probe says; that is why it is a probe and
not an assumption.

- [ ] **Step 6: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/tools/joinByLocation.ts \
  src/features/processing/tools/register.ts \
  src/features/processing/toolRegistry.ts src/features/processing/types.ts \
  src/ui/processing/RunFooter.tsx \
  tests/unit/features/processing/joinByLocation.test.ts \
  tests/unit/features/processing/register.test.ts \
  tests/integration/duckdb/crossLayer.test.ts
git commit -m "feat: Join attributes by location copies area attributes onto buildings"
```

---
