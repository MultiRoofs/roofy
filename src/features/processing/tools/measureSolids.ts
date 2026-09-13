/**
 * Measure solids (spec §7.2).
 *
 * THREE statements, in this order:
 *
 *   1. against the LAYER TABLE — which rows are in scope, and which FEATURE
 *      does each belong to? The table is the authority on that: it is what the
 *      write targets and what `feature_id` means.
 *   2. against the RE-READ SOURCE, over the WHOLE SCOPE and asking for ids
 *      ONLY — §6.1's id join. It is its own statement because the join's
 *      threshold is every scoped row (the scope-wide identity ruling) while the
 *      measurement is the contributors' alone.
 *   3. against the RE-READ SOURCE again, restricted to the contributor ids §7's
 *      rule chose — the guarded `three_d` measure statement.
 *
 * The contributor rule is answered from the MODEL's surface TAGS, never from
 * the reader, which is what lets §7.2's "no geometry" outcome be decided before
 * a single solid is parsed and keeps the parse to the rows that can produce a
 * value.
 *
 * BOUNDED WORK. Features are rolled up in batches of `SOLID_BATCH_FEATURES`,
 * and between batches the executor yields a MACROTASK and re-checks the
 * cancellation. That buys responsiveness and an early exit, nothing more: the
 * queue already refuses to publish an aborted run.
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { geometryLodsByObject } from "../roofGeometrySource";
import { assertSourceIds, readSource, readerQuery } from "../sourceRead";
import { solidColumns, solidParams, type SolidParams } from "../solidParams";
import {
  buildScopeRowsSql,
  buildSolidMeasureSql,
  buildSourceIdsSql,
} from "../solidSql";
import {
  CAVEAT_DEGENERATE_SOLIDS,
  CAVEAT_INVALID_SOLIDS,
  SKIP_NOT_A_SOLID,
  countsAsSkips,
  groupContributors,
  rollUpSolids,
  skipNoGeometry,
  type FeatureRow,
  type SolidRollUp,
  type SolidRow,
} from "../solidRollUp";
import type { ToolExecutor } from "../runQueue";
import { registerExecutor } from "./index";

/** Features per batch. A bound, not a tuning knob (see the module comment). */
export const SOLID_BATCH_FEATURES = 500;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

/** One reader row, narrowed out of DuckDB's untyped record. */
function toSolidRow(row: Readonly<Record<string, unknown>>): SolidRow {
  const type = row["geometry_type"];
  return {
    id: String(row["id"]),
    geometry_type: typeof type === "string" ? type : null,
    parsed: row["parsed"] === true,
    is_valid: bool(row["is_valid"]),
    degenerate: bool(row["degenerate"]),
    volume_m3: num(row["volume_m3"]),
    envelope_m2: num(row["envelope_m2"]),
    footprint_m2: num(row["footprint_m2"]),
    ground_m: num(row["ground_m"]),
    ridge_m: num(row["ridge_m"]),
  };
}

/** One roll-up as the run's column values, ticked measures only. */
function valuesOf(
  rollUp: SolidRollUp | null,
  params: SolidParams,
  prefix: string,
): Record<string, unknown> {
  const ticked = new Set(params.measures);
  const out: Record<string, unknown> = {};
  if (ticked.has("volume")) out[`${prefix}volume_m3`] = rollUp?.volume ?? null;
  if (ticked.has("envelope"))
    out[`${prefix}envelope_m2`] = rollUp?.envelope ?? null;
  if (ticked.has("footprint"))
    out[`${prefix}footprint_m2`] = rollUp?.footprint ?? null;
  if (ticked.has("height")) out[`${prefix}height_m`] = rollUp?.height ?? null;
  if (ticked.has("ground")) out[`${prefix}ground_m`] = rollUp?.ground ?? null;
  if (ticked.has("ridge")) out[`${prefix}ridge_m`] = rollUp?.ridge ?? null;
  // §7.2: always written.
  out[`${prefix}valid`] = rollUp?.valid ?? null;
  return out;
}

export const measureSolids: ToolExecutor = async (run, ctx) => {
  // The form guarantees a LoD (Run is refused with "No solid geometry in this
  // layer" when none qualifies), so this is unreachable through the UI. It is
  // here because a skip cause reading "no geometry at LoD null" would be worse
  // than a failure.
  if (run.lod === null) throw new Error("No solid geometry in this layer");
  const lod = run.lod;
  const params = solidParams(run.params);
  const columns: ReadonlyArray<OutputColumn> = solidColumns(run.prefix, params);

  // §6.1's "Reading source": the queue already put the card in this phase, so
  // the progress block does not flash "Computing" before a 300 MB read.
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

    // §6.1's id join, "the only check possible", BEFORE the expensive parse and
    // over EVERY SCOPED ROW — the ids THIS run's scope read returned, never
    // `ctx.featureIds` (null on scope "all", which would leave the widest scope
    // the only unchecked one). The reader returns a row per object of the file,
    // so an id that does not come back means the file no longer holds that
    // object, which is §6.1's "no longer reads as the loaded layer". A root
    // displaced by its part and a part with no geometry here are measured by
    // nobody and are still checked: their disappearance is the same evidence.
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

    // TAGS ONLY, one walk of the model: §7's contributor question is about
    // geometry of ANY kind at the LoD, which is what `geometryLodsByObject`
    // answers. Using a "has a solid" test here instead would make a wall-only
    // part fall back to the root's solid — the 3D BAG double count.
    const lods = geometryLodsByObject(ctx.layer);
    const groups = groupContributors(
      rows,
      (id, at) => lods.get(id)?.has(at) ?? false,
      lod,
    );
    const contributorIds = groups.flatMap((g) => [...g.contributors]);

    const byId = new Map<string, SolidRow>();
    if (contributorIds.length > 0) {
      const measured = await readerQuery(
        ctx,
        "Measuring solids",
        buildSolidMeasureSql({
          from: handle.from,
          geometryColumn: handle.geometryColumn,
          propertiesColumn: handle.propertiesColumn,
          ids: contributorIds,
        }),
      );
      for (const row of measured.rows) {
        const solid = toSolidRow(row);
        byId.set(solid.id, solid);
      }
      // The same threshold again over the rows that are actually measured: a
      // contributor missing from THIS answer would be rolled up as "not a
      // solid", a verdict on geometry nobody looked at.
      assertSourceIds(contributorIds, new Set(byId.keys()));
    }
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle.release();
    ctx.throwIfCancelled();

    const out = new Map<string, Record<string, unknown>>();
    let measuredFeatures = 0;
    let noGeometry = 0;
    let notASolid = 0;
    let invalid = 0;
    let degenerate = 0;
    let sinceYield = 0;

    for (const group of groups) {
      const rollUp = rollUpSolids(
        group.contributors
          .map((id) => byId.get(id))
          .filter((row): row is SolidRow => row !== undefined),
      );
      if (rollUp === null) {
        // §7.2's first two outcomes, told apart by whether §7's rule found a
        // contributor at all — never by the validation report, which is NULL
        // for both a missing solid and a missing row.
        if (group.contributors.length === 0) noGeometry += 1;
        else notASolid += 1;
      } else {
        measuredFeatures += 1;
        // §6.2's caveat, and only when a volume was actually withheld.
        if (rollUp.hasInvalid && params.measures.includes("volume")) {
          invalid += 1;
        }
        // F1's caveat, the same rule about the other withheld measure: the
        // statement guards `ST_3DSurfaceArea` on the degenerate-face count, so
        // this building was measured with no envelope.
        if (rollUp.hasDegenerate && params.measures.includes("envelope")) {
          degenerate += 1;
        }
      }

      for (const member of group.members) {
        // §8: the ROOT row carries the feature's roll-up; every other row
        // carries its OWN. A part stamped with its building's total is a
        // measurement of something the user never selected.
        if (member.id === group.featureId) {
          out.set(member.id, valuesOf(rollUp, params, run.prefix));
        } else {
          const own = byId.get(member.id);
          out.set(
            member.id,
            valuesOf(
              own === undefined ? null : rollUpSolids([own]),
              params,
              run.prefix,
            ),
          );
        }
      }

      sinceYield += 1;
      if (sinceYield >= SOLID_BATCH_FEATURES) {
        sinceYield = 0;
        // YIELD FIRST, then check. A MACROTASK, so the event loop actually
        // turns and a Cancel click can land — which is why the check comes
        // after the await.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    return {
      columns,
      rows: out,
      measured: measuredFeatures,
      skipped: countsAsSkips([
        [skipNoGeometry(lod), noGeometry],
        [SKIP_NOT_A_SOLID, notASolid],
      ]),
      caveats: countsAsSkips([
        [CAVEAT_INVALID_SOLIDS, invalid],
        [CAVEAT_DEGENERATE_SOLIDS, degenerate],
      ]),
    };
  } finally {
    // ALWAYS: done, failed or cancelled, the buffer must not outlive the run.
    // `release()` is idempotent, so the happy path's early drop is not undone.
    await handle.release();
  }
};

registerExecutor("measure-solids", measureSolids);
