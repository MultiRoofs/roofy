/**
 * Validate solids (spec §7.3).
 *
 * Structurally Measure solids' twin, and deliberately so: the same THREE
 * statements (the layer table for the scope's rows and their features, the
 * re-read source for §6.1's id-only identity check over the WHOLE scope, then
 * the re-read source again for the contributors' report), the same §7
 * contributor rule read from the MODEL's tags, the same D4 solid test and the
 * same two skip causes. What differs is the statement it issues and the
 * roll-up: flags AND, counts SUM, and NOTHING is measured —
 * `ST_3DValidationReport` answers on any parsed solid, so there is no
 * `ST_3DVolume` here and nothing to guard beyond D1's `s IS NOT NULL`, which
 * `buildSolidValidationSql` already carries on every field it reads.
 *
 * No parameters: §7.3's only input besides the target and the scope is the LoD.
 *
 * THE COUNTS ARE BIGINT IN THE ENGINE AND `number` HERE. `open_edge_count` and
 * its two siblings are BIGINT, but `runQuery` narrows every BigInt to a Number
 * on the way out (`insights/duckdb.ts`'s `toRows` — a `COUNT(*)` comes back as
 * one and `JSON.stringify` throws on it), so `num` below tests for `"number"`
 * and not for `"bigint"`. If that narrowing ever moves, every count here would
 * silently become NULL, which is why the reason is written down.
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { geometryLodsByObject } from "../roofGeometrySource";
import { assertSourceIds, readSource, readerQuery } from "../sourceRead";
import { validationColumns } from "../solidParams";
import {
  buildScopeRowsSql,
  buildSolidValidationSql,
  buildSourceIdsSql,
} from "../solidSql";
import {
  SKIP_NOT_A_SOLID,
  countsAsSkips,
  groupContributors,
  isMeasurableSolid,
  skipNoGeometry,
  type FeatureRow,
} from "../solidRollUp";
import type { ToolExecutor } from "../runQueue";
import { registerExecutor } from "./index";

/** Features per batch — the same bound Measure solids uses. */
export const VALIDATE_BATCH_FEATURES = 500;

/**
 * One row of `buildSolidValidationSql`'s output, under the READER's own column
 * names. §7.3's output names (`<prefix>closed`, `<prefix>open_edges_n`) are
 * `validationColumns`' and are applied only at the very end.
 *
 * `orientation_error_count` (`ori_n`) is selected by the statement and spent by
 * nothing: it is the only thing that explains an `is_oriented` of false, and
 * §7.3 names seven columns, none of which is it. Reading it costs nothing (the
 * report is computed whole) and a second statement to fetch it later would
 * parse every solid twice.
 */
interface ReportRow {
  readonly id: string;
  readonly geometry_type: string | null;
  readonly parsed: boolean;
  readonly is_closed: boolean | null;
  readonly is_manifold: boolean | null;
  readonly is_oriented: boolean | null;
  readonly is_valid: boolean | null;
  readonly open_n: number | null;
  readonly nm_n: number | null;
  readonly deg_n: number | null;
}

/** §7.3's roll-up of one feature's contributors — the seven values, unnamed. */
interface ValidationRollUp {
  readonly closed: boolean | null;
  readonly manifold: boolean | null;
  readonly oriented: boolean | null;
  readonly valid: boolean | null;
  readonly openEdges: number | null;
  readonly nonManifoldEdges: number | null;
  readonly degenerateFaces: number | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

/** One reader row, narrowed out of DuckDB's untyped record. */
function toReportRow(row: Readonly<Record<string, unknown>>): ReportRow {
  const type = row["geometry_type"];
  return {
    id: String(row["id"]),
    geometry_type: typeof type === "string" ? type : null,
    parsed: row["parsed"] === true,
    // READ, never re-derived (finding D1): the statement guards every report
    // field on `s IS NOT NULL`, so a NULL here means "no report was taken" and
    // never "the engine looked and said no".
    is_closed: bool(row["is_closed"]),
    is_manifold: bool(row["is_manifold"]),
    is_oriented: bool(row["is_oriented"]),
    is_valid: bool(row["is_valid"]),
    open_n: num(row["open_n"]),
    nm_n: num(row["nm_n"]),
    deg_n: num(row["deg_n"]),
  };
}

/**
 * §7.3's roll-up: "flags AND, counts sum", over the rows that are SOLIDS.
 *
 * The D4 filter is HERE rather than at the call site, exactly as `rollUpSolids`
 * does it, so neither the feature's roll-up nor a part's own one-row roll-up
 * can report on a row that is not a solid. A feature with nothing left gets
 * `null`, which the caller reports as §7.2's skip.
 *
 * Both reductions are ORDER-INDEPENDENT and decided after the loop. A flag is
 * `false` if ANY contributor's is — one part the engine checked and rejected
 * makes the building not closed, whatever a sibling with no report says — and
 * only in the absence of a rejection does an unknown withhold the verdict. A
 * count is the sum of the contributors that ANSWERED, and NULL when none did:
 * a zero would read as "checked, and nothing is wrong".
 */
function rollUpReports(
  contributors: ReadonlyArray<ReportRow>,
): ValidationRollUp | null {
  const rows = contributors.filter(isMeasurableSolid);
  if (rows.length === 0) return null;
  const and = (pick: (r: ReportRow) => boolean | null): boolean | null => {
    let hasFalse = false;
    let hasUnknown = false;
    for (const row of rows) {
      const value = pick(row);
      if (value === false) hasFalse = true;
      else if (value === null) hasUnknown = true;
    }
    return hasFalse ? false : hasUnknown ? null : true;
  };
  const sum = (pick: (r: ReportRow) => number | null): number | null => {
    let total: number | null = null;
    for (const row of rows) {
      const value = pick(row);
      if (value !== null) total = (total ?? 0) + value;
    }
    return total;
  };
  return {
    closed: and((r) => r.is_closed),
    manifold: and((r) => r.is_manifold),
    oriented: and((r) => r.is_oriented),
    valid: and((r) => r.is_valid),
    openEdges: sum((r) => r.open_n),
    nonManifoldEdges: sum((r) => r.nm_n),
    degenerateFaces: sum((r) => r.deg_n),
  };
}

/** One roll-up as the run's column values, all seven, NULL when unavailable. */
function valuesOf(
  rollUp: ValidationRollUp | null,
  prefix: string,
): Record<string, unknown> {
  return {
    [`${prefix}closed`]: rollUp?.closed ?? null,
    [`${prefix}manifold`]: rollUp?.manifold ?? null,
    [`${prefix}oriented`]: rollUp?.oriented ?? null,
    [`${prefix}valid`]: rollUp?.valid ?? null,
    [`${prefix}open_edges_n`]: rollUp?.openEdges ?? null,
    [`${prefix}nonmanifold_edges_n`]: rollUp?.nonManifoldEdges ?? null,
    [`${prefix}degenerate_faces_n`]: rollUp?.degenerateFaces ?? null,
  };
}

export const validateSolids: ToolExecutor = async (run, ctx) => {
  // Unreachable through the UI (Run is refused with this sentence when no LoD
  // qualifies), and a skip cause reading "no geometry at LoD null" would be
  // worse than a failure.
  if (run.lod === null) throw new Error("No solid geometry in this layer");
  const lod = run.lod;
  const columns: ReadonlyArray<OutputColumn> = validationColumns(run.prefix);

  const handle = await readSource({
    runId: run.id,
    table: ctx.table,
    lod,
    signal: ctx.signal,
  });
  try {
    // The handle is open, which is all "Reading source" promised (§6.1 spells
    // the phase "registering bytes"); everything past here is the compute.
    ctx.phase("compute");
    const scope = await ctx.query(
      "Reading features",
      buildScopeRowsSql(ctx.table.table, ctx.featureIds),
    );
    // A type guard, not logic: the context throws on a failed query.
    if (!scope.ok) throw new Error(scope.message);
    ctx.throwIfCancelled();

    const rows: FeatureRow[] = scope.rows.map((row) => ({
      id: String(row["id"]),
      f: String(row["f"]),
    }));

    // §6.1's id join, BEFORE the expensive parse and over EVERY SCOPED ROW —
    // the ids THIS run's scope read returned, never `ctx.featureIds` (null on
    // scope "all", which would leave the widest scope the only unchecked one).
    // A root displaced by its parts and a part with no geometry at this LoD are
    // reported on by nobody and are still checked: their disappearance from the
    // file is the same evidence that the source moved.
    if (rows.length > 0) {
      const present = await readerQuery(
        ctx,
        "Checking source ids",
        buildSourceIdsSql({ from: handle.from, ids: ctx.featureIds }),
      );
      assertSourceIds(
        rows.map((row) => row.id),
        new Set(present.rows.map((row) => String(row["id"]))),
      );
      ctx.throwIfCancelled();
    }

    // TAGS ONLY, and about geometry of ANY kind — §7's contributor rule. A
    // "has a solid" test here would let a wall-only part fall back to the
    // root's solid, which is the 3D BAG double count.
    const lods = geometryLodsByObject(ctx.layer);
    const groups = groupContributors(
      rows,
      (id, at) => lods.get(id)?.has(at) ?? false,
      lod,
    );
    const contributorIds = groups.flatMap((g) => [...g.contributors]);

    const byId = new Map<string, ReportRow>();
    if (contributorIds.length > 0) {
      const answered = await readerQuery(
        ctx,
        "Validating solids",
        buildSolidValidationSql({
          from: handle.from,
          geometryColumn: handle.geometryColumn,
          propertiesColumn: handle.propertiesColumn,
          ids: contributorIds,
        }),
      );
      for (const row of answered.rows) {
        const report = toReportRow(row);
        byId.set(report.id, report);
      }
      // The same threshold again over the rows actually reported on: a
      // contributor missing from THIS answer would be rolled up as "not a
      // solid", a verdict on geometry nobody looked at.
      assertSourceIds(contributorIds, new Set(byId.keys()));
    }
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle.release();
    ctx.throwIfCancelled();

    const out = new Map<string, Record<string, unknown>>();
    let valid = 0;
    let withIssues = 0;
    let noGeometry = 0;
    let notASolid = 0;
    let sinceYield = 0;

    for (const group of groups) {
      const rollUp = rollUpReports(
        group.contributors
          .map((id) => byId.get(id))
          .filter((row): row is ReportRow => row !== undefined),
      );
      if (rollUp === null) {
        // §7.2's first two outcomes, told apart by whether §7's rule found a
        // contributor at all — never by the report, which is NULL for both a
        // missing solid and a missing row.
        if (group.contributors.length === 0) noGeometry += 1;
        else notASolid += 1;
      } else if (rollUp.valid === true) {
        valid += 1;
      } else {
        // §7.3's card puts every feature the run reached a verdict on one side
        // or the other, so an UNKNOWN verdict over parsed contributors reads as
        // "with issues" rather than vanishing from the line. That keeps
        // `measured === valid + withIssues` an invariant, which is what the
        // provenance summary and §6.2's "N objects" are counted from. (The
        // guarded statement makes a parsed solid's report non-NULL, so this is
        // a rule about the arithmetic, not a case the engine produces.)
        withIssues += 1;
      }

      for (const member of group.members) {
        // §8: the ROOT row carries the feature's roll-up; every other row
        // carries its OWN. A part stamped with its building's verdict is a
        // claim about something the user never selected.
        if (member.id === group.featureId) {
          out.set(member.id, valuesOf(rollUp, run.prefix));
        } else {
          const own = byId.get(member.id);
          out.set(
            member.id,
            valuesOf(rollUpReports(own === undefined ? [] : [own]), run.prefix),
          );
        }
      }

      sinceYield += 1;
      if (sinceYield >= VALIDATE_BATCH_FEATURES) {
        sinceYield = 0;
        // YIELD FIRST, then check. A MACROTASK, so the event loop actually
        // turns and a Cancel click can land.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    return {
      columns,
      rows: out,
      // Every feature the run reached a verdict on. The CARD does not print it
      // (§7.3's line is the valid count), but the provenance summary and
      // §6.2's object count are taken from here.
      measured: valid + withIssues,
      skipped: countsAsSkips([
        [skipNoGeometry(lod), noGeometry],
        [SKIP_NOT_A_SOLID, notASolid],
      ]),
      // §7.3's card, verbatim: "1,079 valid · 125 with issues". TWO counts, so
      // the valid half is this tool's OWN first phrase (`line`) and only the
      // other half is a caveat — `summarise` prints `line`, then each caveat as
      // "<count> <cause>", then the skipped count and the elapsed time. Both
      // halves as caveats would print a third count in front of them that §7.3
      // never shows, and a "measured" count this tool never measured.
      //
      // Grouped like `summarise`'s own `fmt`, which is `toLocaleString`.
      line: `${valid.toLocaleString("en-US")} valid`,
      caveats: countsAsSkips([["with issues", withIssues]]),
    };
  } finally {
    // ALWAYS: done, failed or cancelled, the buffer must not outlive the run.
    // `release()` is idempotent, so the happy path's early drop is not undone.
    await handle.release();
  }
};

registerExecutor("validate-solids", validateSolids);
