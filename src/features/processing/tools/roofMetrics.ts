/**
 * Roof metrics to attributes (spec §7.1).
 *
 * NOTHING IS COMPUTED IN SQL. Roof area, inclination and azimuth are derived
 * from ring geometry, which exists nowhere in DuckDB (spec §2) and which the
 * app has already parsed. So this tool issues exactly ONE statement, and it is
 * a question about ROWS, not geometry:
 *
 *   which rows are in scope, and which FEATURE does each belong to?
 *
 * The table is the authority on that (it is what the write targets, and what
 * `feature_id` means); `RoofGeometrySource` is the authority on geometry, and
 * measures only what it is asked for. A row the source has never heard of
 * simply has nothing — which is true for a streaming feature that left the
 * resident set between Run and the head of the queue, and is reported as a
 * skip rather than as an error.
 *
 * `needsReader` is false and no source is registered, so §6.1's "Reading
 * source" phase is skipped and the run goes straight to Computing.
 *
 * BOUNDED WORK. Features are rolled up in batches of `ROOF_BATCH_FEATURES`,
 * and between batches the caller's `onBatch` runs — in the executor that is a
 * yield to the event loop plus a cancellation check. That buys RESPONSIVENESS
 * and an early EXIT, nothing more: the queue already refuses to publish an
 * aborted run, so a Cancel during a long compute was always honoured — it just
 * had to wait for the whole computation first.
 */

import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import type { OutputColumn } from "../../../insights/computedColumns";
import {
  rollUpRoofSurfaces,
  type RoofRollUp,
  type RoofSurfaceMetric,
} from "../../../domain/roofMetrics/roofRollUp";
import {
  ROOF_MEASURES,
  roofParams,
  type RoofMeasure,
  type RoofMetricsParams,
} from "../roofMetricsParams";
import {
  roofGeometrySource,
  type RoofGeometrySource,
} from "../roofGeometrySource";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** Features per batch. See the module comment: a bound, not a tuning knob. */
export const ROOF_BATCH_FEATURES = 500;

/** One table row: its own id, and the feature it belongs to. */
export interface FeatureRow {
  readonly id: string;
  readonly f: string;
}

/**
 * The run's one statement.
 *
 * `ids` are ROW ids — `resolveScope` has already expanded the user's selection
 * or filter to whole features — and `null` means every row.
 */
export function buildFeatureRowsReadSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f FROM ${quoteIdent(table)}` +
    where
  );
}

/** The scope's rows, grouped by feature, in first-seen order. */
export function groupRowsByFeature(
  rows: ReadonlyArray<FeatureRow>,
): ReadonlyArray<readonly [string, ReadonlyArray<FeatureRow>]> {
  const members = new Map<string, FeatureRow[]>();
  for (const row of rows) {
    const list = members.get(row.f);
    if (list) list.push(row);
    else members.set(row.f, [row]);
  }
  return [...members.entries()];
}

/** One measure of one roll-up, or null when it could not be evaluated. */
function valueOf(measure: RoofMeasure, rollUp: RoofRollUp): number | null {
  switch (measure) {
    case "area":
      return rollUp.areaM2;
    case "flatArea":
      return rollUp.flatM2;
    case "flatShare":
      return rollUp.flatShare;
    case "slope":
      return rollUp.slopeDeg;
    case "azimuth":
      return rollUp.azimuthDeg;
    case "surfaces":
      return rollUp.surfaces;
  }
}

export interface RoofComputeInput {
  readonly rows: ReadonlyArray<FeatureRow>;
  readonly source: RoofGeometrySource;
  readonly params: RoofMetricsParams;
  readonly prefix: string;
  readonly lod: string;
  /** Run between batches. Throwing from it aborts the whole computation. */
  readonly onBatch?: () => Promise<void>;
}

export interface RoofComputeOutput {
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Record<string, number | null>>;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

/**
 * Spec §7's contributor rule and roll-ups, over the rows the table gave us.
 *
 * CONTRIBUTORS (§7, verbatim): "At the chosen LoD, if any part of the feature
 * has GEOMETRY, the PARTS are the contributors and the root's own geometry at
 * that LoD is ignored (3D BAG stores the same building on both); otherwise the
 * root is the sole contributor." GEOMETRY — of any semantic type. A root with
 * a roof and a part with only walls selects the PART, and the feature is then
 * skipped for having no roof. Using the root's roof instead would report the
 * very double-storage this rule exists to avoid.
 *
 * WHAT EACH ROW GETS (§8): the ROOT row carries the feature's roll-up; every
 * other row carries its OWN. A part stamped with its building's total is a
 * measurement of something the user never selected.
 *
 * COUNTING (§7): per FEATURE. A building with one measurable contributor is
 * one building measured, whatever its other parts lack.
 */
export async function computeRoofRows(
  input: RoofComputeInput,
): Promise<RoofComputeOutput> {
  const ticked = ROOF_MEASURES.filter((m) =>
    input.params.measures.includes(m.key),
  );
  const columns: OutputColumn[] = ticked.map((m) => ({
    name: `${input.prefix}${m.suffix}`,
    type: "DOUBLE",
  }));

  const values = (rollUp: RoofRollUp | null): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const measure of ticked) {
      out[`${input.prefix}${measure.suffix}`] =
        rollUp === null ? null : valueOf(measure.key, rollUp);
    }
    return out;
  };

  const rows = new Map<string, Record<string, number | null>>();
  let measured = 0;
  let skipped = 0;
  let sinceYield = 0;

  for (const [featureId, memberRows] of groupRowsByFeature(input.rows)) {
    const parts = memberRows.filter((row) => row.id !== featureId);
    const partContributors = parts.filter((row) =>
      input.source.hasGeometryAt(row.id, input.lod),
    );
    const contributors =
      partContributors.length > 0
        ? partContributors
        : memberRows.filter(
            (row) =>
              row.id === featureId &&
              input.source.hasGeometryAt(row.id, input.lod),
          );

    const surfaces: RoofSurfaceMetric[] = [];
    for (const row of contributors) {
      surfaces.push(...input.source.roofSurfacesAt(row.id, input.lod));
    }
    const featureRollUp = rollUpRoofSurfaces(
      surfaces,
      input.params.flatThresholdDeg,
    );
    if (featureRollUp === null) skipped += 1;
    else measured += 1;

    for (const row of memberRows) {
      rows.set(
        row.id,
        row.id === featureId
          ? values(featureRollUp)
          : values(
              rollUpRoofSurfaces(
                [...input.source.roofSurfacesAt(row.id, input.lod)],
                input.params.flatThresholdDeg,
              ),
            ),
      );
    }

    sinceYield += 1;
    if (sinceYield >= ROOF_BATCH_FEATURES && input.onBatch) {
      sinceYield = 0;
      await input.onBatch();
    }
  }

  return {
    columns,
    rows,
    measured,
    skipped:
      skipped > 0
        ? [{ cause: `no roof surfaces at LoD ${input.lod}`, count: skipped }]
        : [],
  };
}

export const roofMetrics: ToolExecutor = async (run, ctx) => {
  // The form guarantees a LoD (Run is refused with "No roof surfaces in this
  // layer" when none qualifies), so this is unreachable through the UI. It is
  // here because a skip cause reading "no roof surfaces at LoD null" would be
  // worse than a failure.
  if (run.lod === null) throw new Error("No roof surfaces in this layer");

  ctx.phase("compute");
  const out = await ctx.query(
    "Reading features",
    buildFeatureRowsReadSql(ctx.table.table, ctx.featureIds),
  );
  // A type guard, not logic: the context throws on a failed query.
  if (!out.ok) throw new Error(out.message);
  // The query above can take a while on a large scope, and a Cancel pressed
  // during it should not be answered by starting the compute.
  ctx.throwIfCancelled();

  const computed = await computeRoofRows({
    rows: out.rows.map((row) => ({ id: String(row.id), f: String(row.f) })),
    source: roofGeometrySource(ctx.layer),
    params: roofParams(run.params),
    prefix: run.prefix,
    lod: run.lod,
    onBatch: async () => {
      // YIELD FIRST, then check. A MACROTASK, so the event loop actually turns:
      // the page can paint and the Cancel click can land — and it lands DURING
      // this await, which is why the check comes after it. `await
      // Promise.resolve()` is a microtask and would yield to nothing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      ctx.throwIfCancelled();
    },
  });

  return {
    columns: computed.columns,
    rows: computed.rows,
    measured: computed.measured,
    skipped: computed.skipped,
  };
};

registerExecutor("roof-metrics", roofMetrics);
