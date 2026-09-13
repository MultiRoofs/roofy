/**
 * Distance to nearest (spec §7.7).
 *
 * THE SAME ONE-STATEMENT SHAPE AS §7.5 — feature proxy, LEFT JOIN, a window per
 * feature, joined back to the rows — so the two executors can be read side by
 * side. Three differences, each of them §7.7's:
 *
 *  - the max search distance is in the JOIN's `ON`, which is what makes the
 *    distance NULL "beyond it" by the join's own semantics rather than by a
 *    second CASE, and what lets the engine stop looking;
 *  - the ordering key is the distance, then the source order, so "ties go to
 *    the first source feature" is STATED rather than left to `arg_min`, whose
 *    behaviour on equal keys is unspecified and which would let the nearest id
 *    disagree with the distance it was chosen by;
 *  - the nearest id is the source feature's OWN GeoJSON id (`fid`) unless a
 *    property was chosen.
 *
 * THE MEASURE IS `ST_Distance_GEOS`, AND `ST_Distance` IS A BUG HERE. On this
 * checkout's DuckDB 1.5.5 `spatial`, core `ST_Distance` returns **0** for ANY
 * polygon-to-polygon pair, however far apart they are — a degenerate envelope
 * (the one-coordinate building's rectangle) and a GeometryCollection carrying a
 * polygon included — while every other pairing is right. Two of §7.7's three
 * proxies ARE polygons (the extent rectangle and the LoD 0 footprint union) and
 * §7.7's source is "any geometry type", so the core function would answer "0 m"
 * for every building against a polygon source: a whole layer measured wrong,
 * silently, under a card saying it was measured. `ST_Distance_GEOS` is correct
 * on every pairing probed, returns NULL rather than raising on a NULL geometry,
 * and ships in the `wasm_eh` build the app downloads. Pinned in
 * `crossLayer.test.ts` ("the CORE ST_Distance is 0 between two polygons"), and
 * the unit suite asserts the core spelling is ABSENT so nobody simplifies back
 * to it. (`ST_DWithin` has the same defect; `ST_DWithin_GEOS` is correct and
 * could bound the join, but one function deciding both the limit and the value
 * is what keeps them from disagreeing at the boundary.)
 *
 * The distance is 0 when the geometries touch or overlap (§7.7), so no special
 * case is written for it: 0 sorts first and is written as 0, which §6.2
 * distinguishes from the NULL of "could not be evaluated".
 *
 * WHY PER FEATURE. §7: the distance and the nearest id are "evaluated ONCE on
 * the feature's proxy geometry … then copied to root and parts alike". A
 * per-ROW search gives a three-part building three different nearest features,
 * and every count would read it as three buildings.
 *
 * WHY `g IS NULL` IS THE ONE "NO PROXY" SIGNAL. `buildFeatureProxySql` already
 * folds an empty union into NULL (Task 14's finding D8), so nothing here
 * re-tests `ST_IsEmpty` — a second opinion about "has a proxy" is a second
 * answer. A feature with no proxy is SKIPPED ("no geometry"), never counted as
 * "none within <max> m": nobody looked.
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
import type { OutputColumn } from "../../../insights/computedColumns";
import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import {
  buildFeatureProxySql,
  lodZeroLabel,
  proxyDistanceNote,
  type BuildingProxy,
} from "../buildingProxy";
import { distanceColumns, distanceParams } from "../crossLayerParams";
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

export interface DistanceSqlInput {
  readonly table: string;
  readonly source: string;
  readonly proxy: BuildingProxy;
  /** The reader FROM clause (`ReadSourceHandle.from`), footprint only. */
  readonly from: string | null;
  readonly geometryColumn: string | null;
  /** The frozen ROW ids, or null for every row. */
  readonly ids: ReadonlyArray<string> | null;
  readonly maxDistanceM: number;
  readonly prefix: string;
  /**
   * Null when no id is written; `{ property: null }` is §7.7's default — the
   * source feature's OWN GeoJSON id, which is the per-run table's `fid` column
   * and not a property of the document.
   */
  readonly nearestId: { readonly property: string | null } | null;
}

export function buildDistanceSql(input: DistanceSqlInput): string {
  const b = buildFeatureProxySql({
    proxy: input.proxy,
    table: input.table,
    from: input.from,
    geometryColumn: input.geometryColumn,
    ids: input.ids,
  });
  // `quoteLiteral` throws on a non-finite number, which is the guard: §6's
  // validation has already refused a limit that is not positive (A11).
  const limit = quoteLiteral(input.maxDistanceM);
  const selected = [`m."d" AS ${quoteIdent(`${input.prefix}distance_m`)}`];
  if (input.nearestId !== null) {
    selected.push(
      `${
        input.nearestId.property === null
          ? `m."fid"`
          : `m."props"->>${quoteLiteral(input.nearestId.property)}`
      } AS ${quoteIdent(`${input.prefix}nearest_id`)}`,
    );
  }
  const where =
    input.ids === null
      ? ""
      : ` WHERE t."id" IN (${input.ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `WITH b AS (${b}), ` +
    `j AS (SELECT b."f" AS "f", (b."g" IS NULL) AS "no_proxy", s."idx" AS "idx", ` +
    `s."fid" AS "fid", s."props" AS "props", ST_Distance_GEOS(b."g", s."geom") AS "d" ` +
    `FROM b LEFT JOIN ${quoteIdent(input.source)} s ` +
    `ON b."g" IS NOT NULL AND ST_Distance_GEOS(b."g", s."geom") <= ${limit}), ` +
    `r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY "f" ` +
    `ORDER BY "d" ASC NULLS LAST, "idx" ASC NULLS LAST) AS "rn" FROM j), ` +
    `m AS (SELECT * FROM r WHERE "rn" = 1) ` +
    // `f` and `no_proxy` are INTERNAL: the per-FEATURE accounting needs the
    // feature key and whether it had a proxy, and neither is an output column.
    `SELECT t."id" AS "id", m."f" AS "f", m."no_proxy" AS "no_proxy", ` +
    `${selected.join(", ")} ` +
    `FROM ${quoteIdent(input.table)} t JOIN m ON COALESCE(t."feature_id", t."id") = m."f"${where}`
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
export const DISTANCE_BATCH_ROWS = 500;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const distanceToNearest: ToolExecutor = async (run, ctx) => {
  const source = ctx.source;
  if (source === null || source.kind !== "vector") {
    // §5's own words, the same sentence the catalogue row shows. Unreachable
    // through the form and through the queue head — spelled here so an executor
    // never computes over a source it does not have.
    throw new Error("Add a vector layer to join with");
  }
  const params = distanceParams(run.params);
  // §6.1's head re-validation of the FROZEN parameters against the source
  // preflight actually read: a run can wait minutes in the queue, and a source
  // re-linked in between may no longer carry the property the nearest id was
  // promised from. `props->>'gone'` writes NULL into every building and the
  // card still says "1,204 buildings measured", which is the failure this
  // prevents. §6.1's own sentence, not a new one.
  //
  // Against `propertyKeys`, which is EVERY LIVE FEATURE's keys — kept and
  // skipped alike (Task 12). A property carried only by a feature whose
  // GEOMETRY preflight skipped has not gone anywhere, and calling that "Layer
  // changed while running" would refuse a run over an untouched document.
  if (
    params.writeNearestId &&
    params.nearestIdProperty !== null &&
    !source.propertyKeys.includes(params.nearestIdProperty)
  ) {
    throw new Error("Layer changed while running; run again");
  }
  // The REGISTRY's answer, not a second list: this is the promise the frozen
  // request was made on and what `RunFooter` types its columns from.
  const columns: ReadonlyArray<OutputColumn> = distanceColumns(
    run.prefix,
    params,
  );
  const distanceColumn = `${run.prefix}distance_m`;

  let handle: ReadSourceHandle | null = null;
  try {
    if (params.proxy === "footprint") {
      const label = lodZeroLabel(ctx.table);
      if (label === null) {
        // The form cannot offer a footprint without an LoD 0 rung, so this is a
        // frozen draft whose target was rebuilt. §6.1 fails such a run.
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
      // by its part, or a part with no LoD 0 geometry, contributes to nobody's
      // proxy and is still checked, because its disappearance from the file is
      // the same evidence that the source moved. Without it the final inner
      // join would simply drop such a building and it would be published as
      // "no geometry", a verdict on geometry nobody looked at.
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

    // §7.7: "The description and the log say '2D distance to the building
    // footprint / extent / centre' accordingly."
    const distanceLabel = proxyDistanceNote(params.proxy);
    const sql = buildDistanceSql({
      table: ctx.table.table,
      source: source.table,
      proxy: params.proxy,
      from: handle?.from ?? null,
      geometryColumn: handle?.geometryColumn ?? null,
      ids: ctx.featureIds,
      maxDistanceM: params.maxDistanceM,
      prefix: run.prefix,
      nearestId: params.writeNearestId
        ? { property: params.nearestIdProperty }
        : null,
    });
    // With the footprint proxy this statement PARSES the re-read source, so a
    // gunzip-to-garbage or a wasm allocation failure happens inside it and §6.1
    // promises a sentence for it: Task 5's `readerQuery` is the one door, over
    // the one classifier both stages share, and it keeps DuckDB's own words in
    // the log. Every other proxy reads the browsing table only and stays on
    // `ctx.query`.
    const out =
      handle === null
        ? await ctx.query(distanceLabel, sql)
        : await readerQuery(ctx, distanceLabel, sql);
    if (!out.ok) throw new Error(out.message);
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle?.release();
    ctx.throwIfCancelled();

    const rows = new Map<string, Record<string, unknown>>();
    const byFeature = new Map<string, { proxy: boolean; inRange: boolean }>();
    let sinceYield = 0;
    for (const row of out.rows) {
      const noProxy = row["no_proxy"] === true;
      const values: Record<string, unknown> = {};
      for (const column of columns)
        values[column.name] = row[column.name] ?? null;
      rows.set(String(row["id"]), values);

      // The per-FEATURE accounting, keyed on the feature key `f` the projection
      // carries: a three-part building is ONE building in every count (§7).
      const f = row["f"];
      const key = typeof f === "string" ? f : String(row["id"]);
      if (!byFeature.has(key)) {
        byFeature.set(key, {
          proxy: !noProxy,
          inRange: num(row[distanceColumn]) !== null,
        });
      }

      sinceYield += 1;
      if (sinceYield >= DISTANCE_BATCH_ROWS) {
        sinceYield = 0;
        // YIELD FIRST, then check. A MACROTASK, so the event loop actually
        // turns and a Cancel click can land — which is why the check comes
        // after the await.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    let measured = 0;
    let none = 0;
    let noGeometry = 0;
    for (const entry of byFeature.values()) {
      if (!entry.proxy) {
        // Nobody looked: §6.2's "could not be evaluated", never "nothing in
        // range".
        noGeometry += 1;
        continue;
      }
      measured += 1;
      if (!entry.inRange) none += 1;
    }
    const skipped: SkipCount[] = [];
    if (noGeometry > 0) {
      skipped.push({ cause: "no geometry", count: noGeometry });
    }
    return {
      columns,
      rows,
      measured,
      skipped,
      // §7.7: "1,204 buildings measured · 12 none within 500 m". The elapsed
      // time is `summarise`'s, and so is the separator.
      line: plural(measured, "building measured", "buildings measured"),
      // A `SkipCount` (Task 7's caveat channel), never a pre-rendered string:
      // the COUNT is `summarise`'s to render, so the cause carries the limit
      // and no number.
      caveats:
        none > 0
          ? [{ cause: `none within ${params.maxDistanceM} m`, count: none }]
          : [],
    };
  } finally {
    // ALWAYS: done, failed or cancelled, the buffer must not outlive the run.
    // `release()` is idempotent, so the happy path's early drop is not undone.
    await handle?.release();
  }
};

registerExecutor("distance-to-nearest", distanceToNearest);
