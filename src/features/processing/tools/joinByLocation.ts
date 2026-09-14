/**
 * Join attributes by location (spec §7.5).
 *
 * ONE compute statement, and the shape of it is the whole design:
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
 * three-part building three different winners, and every count would read it as
 * three buildings.
 *
 * WHY `g IS NULL` IS THE ONE "NO PROXY" SIGNAL. `buildFeatureProxySql` already
 * folds an empty union into NULL (Task 14's finding D8: `ST_Union_Agg` over an
 * empty set is `GEOMETRYCOLLECTION EMPTY`, not NULL), so nothing here re-tests
 * `ST_IsEmpty` — a second opinion about "has a proxy" is a second answer.
 *
 * WHY `ROW_NUMBER` AND NOT `arg_min`. §7.5's tie rule is ordered: largest
 * overlap, then "equal overlaps fall back to first", and first is by SOURCE
 * ORDER. Two `ORDER BY` keys state exactly that; `arg_min` on equal keys picks
 * either row (pinned against the real engine in `crossLayer.test.ts`).
 *
 * WHY `within` IS `ST_CoveredBy` AND `centre within` IS `ST_Intersects`. §7.5
 * words `within` as "the whole proxy inside the area, BOUNDARY INCLUDED", and
 * `ST_Within` is the predicate that excludes the boundary (Task 1's finding
 * D6). Covered-by is the OGC predicate for the sentence §7.5 wrote. `centre
 * within` wants the opposite emphasis — "a centre exactly on a shared boundary
 * matches BOTH areas and the tie rule below applies" — and for a point
 * `ST_Intersects` and `ST_CoveredBy` agree. The proxy is FORCED to the centre,
 * as §7.5 says.
 *
 * WHY `TRY_CAST`. A source property that is text in one feature and a number in
 * another would fail the whole statement under `::DOUBLE`; §6.2's rule for a
 * value that could not be read is NULL.
 *
 * TWO CHEAP STATEMENTS PRECEDE THE COMPUTE, AND ONLY ON THE FOOTPRINT PATH.
 * That proxy is the one that re-reads the parent source, so §6.1's id join is
 * owed — over EVERY SCOPED ROW (the scope-wide identity ruling), which means
 * this executor must know which rows its scope names before any roll-up.
 * `ctx.featureIds` is not that list: it is null on scope "all". So the table is
 * asked (`buildScopeRowsSql`) and the reader is asked for its ids alone
 * (`buildSourceIdsSql`), both of them Task 7's spellings rather than a second
 * copy, and `assertSourceIds` compares the two BEFORE the expensive parse. The
 * two bbox proxies read the browsing table only — there is no re-read to check
 * the identity of — so they issue neither statement.
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
  joinColumns,
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
import { buildScopeRowsSql, buildSourceIdsSql } from "../solidSql";
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
  /** The reader FROM clause (`ReadSourceHandle.from`), footprint only. */
  readonly from: string | null;
  readonly geometryColumn: string | null;
  /** The frozen ROW ids, or null for every row. */
  readonly ids: ReadonlyArray<string> | null;
  readonly predicate: JoinPredicate;
  readonly tie: JoinTie;
  readonly prefix: string;
  readonly fields: ReadonlyArray<JoinField>;
  readonly writeMatchCount: boolean;
}

function predicateSql(predicate: JoinPredicate): string {
  // See the module comment: `within` is boundary-inclusive by §7.5's own words,
  // and `centreWithin`'s proxy is already the centre.
  return predicate === "within"
    ? `ST_CoveredBy(b."g", s."geom")`
    : `ST_Intersects(b."g", s."geom")`;
}

export function buildJoinSql(input: JoinSqlInput): string {
  // §7.5: "centre within" FORCES the centre proxy.
  const centreOnly = input.predicate === "centreWithin";
  const proxy: BuildingProxy = centreOnly ? "centre" : input.proxy;
  const b = buildFeatureProxySql({
    proxy,
    table: input.table,
    // The reader is not read for a forced centre: the bbox arm needs neither,
    // and passing them would leave §6.4's log naming a file nothing parsed.
    from: centreOnly ? null : input.from,
    geometryColumn: centreOnly ? null : input.geometryColumn,
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
  for (const field of input.fields) {
    const read = `m."props"->>${quoteLiteral(field.field)}`;
    selected.push(
      field.type === "VARCHAR"
        ? // The `->>` reading IS the VARCHAR one, and the JSON text of a nested
          // object — which is what §7.5 asks for.
          `${read} AS ${quoteIdent(field.column)}`
        : `TRY_CAST(${read} AS ${field.type}) AS ${quoteIdent(field.column)}`,
    );
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
    // `f`, `no_proxy` and `matches_n_feature` are INTERNAL: the per-FEATURE
    // accounting needs the feature key, whether it had a proxy and the raw
    // count, and none of the three is an output column.
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

/**
 * Result rows per batch: a bound, not a tuning knob.
 *
 * Nothing walks a whole layer's results without giving the event loop a turn,
 * so a 100k-row layer stays cancellable and keeps painting. The same 500 every
 * other executor in this toolbox uses.
 */
export const JOIN_BATCH_ROWS = 500;

export const joinByLocation: ToolExecutor = async (run, ctx) => {
  const source = ctx.source;
  if (source === null || source.kind !== "vector") {
    // §5's own words. Unreachable through the form (eligibility refuses it) and
    // through the queue head (which builds the table or fails first) — spelled
    // here so an executor never computes over a source it does not have.
    throw new Error("Add a vector layer to join with");
  }
  const params = joinParams(run.params);
  // §7.5: "count only" writes NO fields, whatever the checklist said.
  const copied = params.tie === "countOnly" ? [] : params.fields;
  // §6.1's head re-validation, for the SOURCE's own document. The fields were
  // frozen at Run; the queue may have held this run for minutes, and the source
  // layer can have been re-linked or re-prepared in between. `props->>'gone'`
  // would then copy NULL into every building and the run would report a
  // successful join of nothing — so the frozen list is checked against what
  // preflight actually read, and §6.1's own sentence for a subject that moved
  // is used rather than a new one.
  //
  // Against `propertyKeys`, which is EVERY LIVE FEATURE's keys — kept and
  // skipped alike (Task 12). A field carried only by a feature whose GEOMETRY
  // preflight skipped has not gone anywhere, and calling that "Layer changed
  // while running" would refuse a run over an untouched document.
  if (copied.some((field) => !source.propertyKeys.includes(field))) {
    throw new Error("Layer changed while running; run again");
  }
  const fields: JoinField[] = copied.map((field) => ({
    field,
    column: `${run.prefix}${slugifyField(field)}`,
    // The FROZEN bag, not `source.propertyTypes`: `joinColumns` types the same
    // columns from the same `params.fieldTypes`, and the two must not be able
    // to disagree about a column the write has already declared (Decisions item
    // 6 (iii)).
    type: params.fieldTypes[field] ?? "VARCHAR",
  }));
  // The REGISTRY's answer, not a second list: this is the promise the frozen
  // request was made on and what `RunFooter` types its columns from.
  const columns: ReadonlyArray<OutputColumn> = joinColumns(run.prefix, params);

  // §6.1's "Reading source" is already past for the VECTOR side (the queue
  // built `__src_<runId>`); the footprint proxy needs the CITY source too.
  // "centre within" forces the centre proxy, so it reads neither.
  const needsReader =
    params.proxy === "footprint" && params.predicate !== "centreWithin";
  let handle: ReadSourceHandle | null = null;
  try {
    if (needsReader) {
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
    // The handle is open, which is all "Reading source" promised; everything
    // past here is the compute.
    ctx.phase("compute");

    if (handle !== null) {
      // §6.1's id join, over EVERY SCOPED ROW and BEFORE the parse. The rows
      // this run's own scope read returns are the threshold — a root displaced
      // by its part, or a part with no LoD 0 geometry, is joined by nobody and
      // is still checked, because its disappearance from the file is the same
      // evidence that the source moved. Without it the final inner join would
      // simply drop such a building and it would be published as "no geometry",
      // a verdict on geometry nobody looked at.
      const scope = await ctx.query(
        "Reading features",
        buildScopeRowsSql(ctx.table.table, ctx.featureIds),
      );
      // A type guard, not logic: the context throws on a failed query.
      if (!scope.ok) throw new Error(scope.message);
      ctx.throwIfCancelled();
      const scopeIds = scope.rows.map((row) => String(row["id"]));
      if (scopeIds.length > 0) {
        const present = await readerQuery(
          ctx,
          "Checking source ids",
          buildSourceIdsSql({ from: handle.from, ids: ctx.featureIds }),
        );
        assertSourceIds(
          scopeIds,
          new Set(present.rows.map((row) => String(row["id"]))),
        );
        ctx.throwIfCancelled();
      }
    }

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
    if (!out.ok) throw new Error(out.message);
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle?.release();
    ctx.throwIfCancelled();

    const rows = new Map<string, Record<string, unknown>>();
    const countColumn = `${run.prefix}matches_n`;
    const byFeature = new Map<string, { proxy: boolean; matched: boolean }>();
    let sinceYield = 0;
    for (const row of out.rows) {
      const noProxy = row["no_proxy"] === true;
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        values[column.name] =
          column.name === countColumn
            ? // §6.2: NULL for a building with no proxy, a real 0 for one that
              // was evaluated and matched nothing.
              noProxy
              ? null
              : (num(row[column.name]) ?? 0)
            : (row[column.name] ?? null);
      }
      rows.set(String(row["id"]), values);

      // The per-FEATURE accounting, keyed on the feature key `f` the projection
      // carries: a three-part building is ONE building in every count (§7).
      const f = row["f"];
      const key = typeof f === "string" ? f : String(row["id"]);
      if (!byFeature.has(key)) {
        const count = num(row["matches_n_feature"]);
        byFeature.set(key, {
          proxy: !noProxy,
          matched: !noProxy && count !== null && count > 0,
        });
      }

      sinceYield += 1;
      if (sinceYield >= JOIN_BATCH_ROWS) {
        sinceYield = 0;
        // YIELD FIRST, then check. A MACROTASK, so the event loop actually
        // turns and a Cancel click can land — which is why the check comes
        // after the await.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    let joined = 0;
    let outside = 0;
    let noGeometry = 0;
    for (const entry of byFeature.values()) {
      if (!entry.proxy) noGeometry += 1;
      else if (entry.matched) joined += 1;
      else outside += 1;
    }
    const skipped: SkipCount[] = [];
    if (noGeometry > 0) {
      skipped.push({ cause: "no geometry", count: noGeometry });
    }
    return {
      columns,
      rows,
      measured: joined + outside,
      skipped,
      // §7.5: "1,143 buildings joined · 61 outside every area · 2.9 s". The
      // elapsed time is `summarise`'s, and so is the separator.
      line: plural(joined, "building joined", "buildings joined"),
      // A `SkipCount` (Task 7's caveat channel), never a pre-rendered string:
      // `summarise` prints it as "61 outside every area".
      caveats:
        outside > 0 ? [{ cause: "outside every area", count: outside }] : [],
    };
  } finally {
    // ALWAYS: done, failed or cancelled, the buffer must not outlive the run.
    // `release()` is idempotent, so the happy path's early drop is not undone.
    await handle?.release();
  }
};

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

registerExecutor("join-by-location", joinByLocation);
