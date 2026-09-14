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
 * WGS84 geometry is never touched — `reprojectGeoLayer` mutates nothing and
 * hands back WKT.
 *
 * EVERY TARGET AREA IS WRITTEN (§7.6), which is why the join runs FROM the areas
 * LEFT JOIN the buildings: an area with no buildings keeps its row, its count is
 * a real 0 and its sums are NULL over an empty set — §6.2's value rule exactly.
 * And the areas preflight could NOT use are written too, as explicit NULLs:
 * they are not in the statement's answer at all, so without them an area whose
 * geometry became unusable between two runs would keep the FIRST run's numbers
 * under the SECOND run's provenance.
 *
 * A BUILDING COUNTS FOR EVERY AREA IT SATISFIES THE PREDICATE WITH (§7.6), so
 * nothing de-duplicates the join; the "counted in more than one area" number is
 * a scalar sub-select over the same join, so the compute is still one statement.
 *
 * PARTS NEVER COUNT. The buildings side is the per-FEATURE proxy relation, and a
 * value is read from the ROOT row only — a run writes its columns onto the root
 * AND the parts (§8), so summing every row would count a three-part building
 * four times.
 *
 * §6.1's ID JOIN IS OWED ON THE FOOTPRINT PATH, exactly as it is for §7.5 and
 * §7.7: that proxy is the one that RE-READS the parent source, and the check is
 * over EVERY SCOPED ROW (the scope-wide identity ruling) — so the table is asked
 * which rows this run's scope names (`buildScopeRowsSql`), the reader is asked
 * for its ids alone (`buildSourceIdsSql`), and `assertSourceIds` compares the two
 * BEFORE the expensive parse. `ctx.featureIds` is not that list: it is null on
 * scope "all", which would leave the widest scope the only unchecked one. The
 * AREAS need no such check: they are read from the per-run vector table this
 * executor has just built, and the target document's identity is verified by the
 * queue immediately before the publication (Task 18).
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
import { buildScopeRowsSql, buildSourceIdsSql } from "../solidSql";
import { preflightWarnings, reprojectGeoLayer } from "../vectorSource";
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
  /** The per-run vector table holding the TARGET's reprojected areas. */
  readonly source: string;
  readonly proxy: BuildingProxy;
  /** The reader FROM clause (`ReadSourceHandle.from`), footprint only. */
  readonly from: string | null;
  readonly geometryColumn: string | null;
  /** The frozen ROW ids, or null for every row. */
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
  // sharing an edge with its zone is `ST_Within` FALSE (Task 1's finding D6).
  // §7.6 shares §7.5's predicate list, so it shares this reading of it.
  const predicate =
    input.predicate === "within"
      ? `ST_CoveredBy(p."g", s."geom")`
      : `ST_Intersects(p."g", s."geom")`;
  const b = buildFeatureProxySql({
    proxy,
    table: input.table,
    // The reader is not read for a forced centre: the bbox arm needs neither,
    // and passing them would leave §6.4's log naming a file nothing parsed.
    from: proxy === "footprint" ? input.from : null,
    geometryColumn: proxy === "footprint" ? input.geometryColumn : null,
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
  // READ AS A DOUBLE, which is the type `aggregateColumns` has already declared
  // for every output. `numericColumnsOf` offers DECIMAL and the integer types
  // too, and a SUM over a DECIMAL comes back as a scaled HUGEINT — not a number
  // the values file can carry under a column declared DOUBLE (pinned against
  // the real engine in `crossLayer.test.ts`). It is the same CAST §7.1's median
  // takes, and TRY_ because a FROZEN bag can still name a column a rebuild has
  // since made text: §6.2's rule for a value that could not be read is NULL,
  // not a failed run.
  const valueSelect = [...aliases]
    .map(
      ([column, alias]) =>
        `TRY_CAST(${quoteIdent(column)} AS DOUBLE) AS ${quoteIdent(alias)}`,
    )
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
      : `${SQL_OP[row.op]}(m.${quoteIdent(aliases.get(row.column) ?? "")}) AS ${quoteIdent(row.name)}`,
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

/** A JS number, or null for anything that is not a finite one. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const aggregatePerArea: ToolExecutor = async (run, ctx) => {
  const target = ctx.target;
  if (target.kind !== "vector") {
    // §5's own words for the wrong target kind. Unreachable through the form.
    throw new Error("Needs a vector layer");
  }
  const params = aggregateParams(run.params);
  // The REGISTRY's answer, not a second list: this is the promise the frozen
  // request was made on and what `RunFooter` types its columns from.
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
  // §6.1's id join is owed where the parent source is RE-READ, and "centre
  // within" forces the centre proxy, which reads the browsing table only.
  const needsReader =
    params.proxy === "footprint" && params.predicate !== "centreWithin";

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
        : await reprojectGeoLayer(
            target.layer.config.preparedData,
            epsg,
            {
              // The batched walk's cancel hook — a Cancel lands inside the
              // reprojection of a large target, not after it (Task 12).
              checkpoint: () => ctx.throwIfCancelled(),
            },
            // S3: §7.6's target is AREAS, and a mixed polygon/point layer is
            // eligible as long as it holds one polygon. The features that are
            // not areas never reach the table, so no point is ever written a
            // building count; §7.6's "every target feature is written" still
            // holds for them, as §6.2's NULL.
            { areasOnly: true },
          );
    if (preflight === null || preflight.features.length === 0) {
      // §7.6's own sentence for a target with nothing usable in it.
      throw new Error("The layer has no areas");
    }
    if (preflight.skipped > 0) {
      // §7.5's sentences, which §7.6 adopts: "preflight and skip counts as in
      // §7.5 apply to the areas".
      for (const warning of preflightWarnings(preflight)) ctx.warn(warning);
    }
    areas = await createVectorTable({
      runId: run.id,
      preflight,
      // Wrapped rather than handed over: `ToolContext.query` is a method, and
      // passing it detached is exactly what `unbound-method` warns about.
      query: (label, statement) => ctx.query(label, statement),
      control: { checkpoint: () => ctx.throwIfCancelled() },
      // One more engine await reached from the table FIFO, so it is raced
      // against the run's abort as well as against the death.
      signal: ctx.signal,
    });
    if (needsReader) {
      const label = lodZeroLabel(ctx.table);
      // The form cannot offer the footprint without an LoD 0 rung, so this is
      // a frozen draft whose source was rebuilt. §6.1 fails such a run.
      if (label === null) {
        throw new Error("Layer changed while running; run again");
      }
      handle = await readSource({
        runId: run.id,
        table: ctx.table,
        lod: label,
        signal: ctx.signal,
      });
    }

    // The handle is open, which is all "Reading source" promised.
    ctx.phase("compute");

    if (handle !== null) {
      // §6.1's id join, over EVERY SCOPED ROW and BEFORE the parse. A root
      // displaced by its part, or a part with no LoD 0 geometry, is a
      // contributor to nobody and is still checked, because its disappearance
      // from the file is the same evidence that the source moved.
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
    // goes through Task 5's one door for §6.1's sentences; every other proxy
    // reads the browsing table only and stays on `ctx.query`.
    const out =
      handle === null
        ? await ctx.query("Aggregating buildings per area", sql)
        : await readerQuery(ctx, "Aggregating buildings per area", sql);
    // A type guard, not logic: the context throws on a failed query.
    if (!out.ok) throw new Error(out.message);
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle?.release();
    ctx.throwIfCancelled();

    // §7.6: "the target's EVERY feature is written". The statement answers for
    // the areas that reached the table, and preflight has already dropped the
    // ones with unusable geometry — so every target feature starts at NULL and
    // the evaluated ones are laid over it. NULL is §6.2's "could not be
    // evaluated", which is exactly what happened to them.
    const rows = new Map<string, Record<string, unknown>>();
    const blank: Record<string, unknown> = {};
    for (const column of columns) blank[column.name] = null;
    for (const record of target.records) {
      rows.set(geoRecordId(record), { ...blank });
    }
    for (const row of out.rows) {
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        // `num`, not the raw value: every column here is declared DOUBLE, and
        // `COUNT(m."f")` is a BIGINT. `insights/duckdb`'s `toRows` narrows one
        // at the seam, but the VECTOR path has no values file and no replacer
        // behind it — §7.6's publication copies what it is handed straight onto
        // the feature properties, where a `2n` would break a GeoJSON export.
        // So the promise the column declared is kept here rather than borrowed.
        values[column.name] = num(row[column.name]);
      }
      rows.set(String(row["sid"]), values);
    }
    const first = out.rows[0];
    const multi = num(first?.["multi_n"]) ?? 0;
    const buildings = num(first?.["buildings_total"]) ?? 0;
    const noProxy = num(first?.["no_proxy_n"]) ?? 0;
    const skipped: SkipCount[] = [];
    // §6.2: a building with no proxy geometry could not be evaluated at all —
    // it is skipped "no geometry", never an area's zero.
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
      // A `SkipCount` (Task 7's caveat channel). `summarise` renders "<count>
      // <cause>" and picks the singular at a count of one (gate defect F2), so
      // the cause carries both nouns and no number.
      caveats:
        multi > 0
          ? [
              {
                cause: "buildings counted in more than one area",
                one: "building counted in more than one area",
                count: multi,
              },
            ]
          : [],
    };
  } finally {
    // EVERY exit path, done or not: this executor owns both handles.
    // `release()` is idempotent on each, so the happy path's early drop of the
    // reader is not undone.
    await handle?.release();
    await areas?.release();
  }
};

registerExecutor("aggregate-per-area", aggregatePerArea);
