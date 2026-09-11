/**
 * Height from extent (spec §7.4).
 *
 * The cheapest tool in the box: no geometry re-read and no extension. Every
 * layer table carries a `bbox STRUCT(xmin, ymin, zmin, xmax, ymax, zmax)` — the
 * reader path and the flat fallback agree on that type on purpose — so the whole
 * measurement is one projection plus a roll-up in JS.
 *
 * WHY THE ROLL-UP IS NOT `GROUP BY`. A CityJSON feature is a ROOT object plus
 * its parts, each of which is its own ROW with its own bbox, and the height of
 * the building is the extent of the WHOLE feature (max zmax − min zmin across
 * root and parts). Every member row then receives the feature's values, so the
 * column reads the same whichever part of a building the user clicks. SQL could
 * do it with a window function; doing it here keeps the SQL a plain projection
 * that is readable in the run's log, and the counts (FEATURES measured, features
 * skipped) fall out of the same pass.
 *
 * "Includes chimneys and antennas; not a roof or terrain height" is the tool's
 * own description — this module deliberately does not try to be cleverer than
 * the bounding box.
 */

import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import type { OutputColumn } from "../../../insights/computedColumns";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** One row of the extent read: a row id, its feature, and the z extent. */
export interface ExtentRow {
  readonly id: string;
  readonly f: string;
  readonly zmin: number | null;
  readonly zmax: number | null;
}

export interface RollUp {
  /** objectId → the feature's values, for EVERY member row. */
  readonly rows: ReadonlyMap<string, Record<string, number | null>>;
  /** FEATURES with an extent. */
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

/**
 * The scope's z extents, one row per table row.
 *
 * `ids` are ROW ids (`resolveScope` has already expanded them to whole
 * features); `null` means every row.
 */
export function buildExtentSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f, ` +
    `"bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM ${quoteIdent(table)}${where}`
  );
}

/**
 * Roll the rows up per feature and hand every member the feature's values.
 *
 * A feature is skipped ONLY when no member has a bbox: a part with a null bbox
 * beside a root that has one does not poison the building, in either arrival
 * order.
 */
export function rollUpExtents(
  rows: ReadonlyArray<ExtentRow>,
  prefix: string,
): RollUp {
  const extents = new Map<string, { zmin: number; zmax: number } | null>();
  const members = new Map<string, string[]>();
  for (const row of rows) {
    const seen = members.get(row.f);
    if (seen) seen.push(row.id);
    else members.set(row.f, [row.id]);

    if (row.zmin === null || row.zmax === null) {
      if (!extents.has(row.f)) extents.set(row.f, null);
      continue;
    }
    const current = extents.get(row.f) ?? null;
    extents.set(
      row.f,
      current
        ? {
            zmin: Math.min(current.zmin, row.zmin),
            zmax: Math.max(current.zmax, row.zmax),
          }
        : { zmin: row.zmin, zmax: row.zmax },
    );
  }

  const out = new Map<string, Record<string, number | null>>();
  let measured = 0;
  let skipped = 0;
  for (const [feature, extent] of extents) {
    if (extent) measured += 1;
    else skipped += 1;
    for (const id of members.get(feature) ?? []) {
      out.set(id, {
        [`${prefix}height_m`]: extent ? extent.zmax - extent.zmin : null,
        [`${prefix}zmin_m`]: extent ? extent.zmin : null,
        [`${prefix}zmax_m`]: extent ? extent.zmax : null,
      });
    }
  }
  return {
    rows: out,
    measured,
    skipped: skipped > 0 ? [{ cause: "no geometry", count: skipped }] : [],
  };
}

/** `NULL`, a missing STRUCT field and an unparseable value all read as null. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const heightFromExtent: ToolExecutor = async (run, ctx) => {
  ctx.phase("compute");
  const out = await ctx.query(
    "Reading extents",
    buildExtentSql(ctx.table.table, ctx.featureIds),
  );
  // A type guard, not logic: the context throws on a failed query.
  if (!out.ok) throw new Error(out.message);

  const rolled = rollUpExtents(
    out.rows.map((row) => ({
      id: String(row.id),
      f: String(row.f),
      zmin: num(row.zmin),
      zmax: num(row.zmax),
    })),
    run.prefix,
  );
  const columns: OutputColumn[] = [
    { name: `${run.prefix}height_m`, type: "DOUBLE" },
    { name: `${run.prefix}zmin_m`, type: "DOUBLE" },
    { name: `${run.prefix}zmax_m`, type: "DOUBLE" },
  ];
  return {
    columns,
    rows: rolled.rows,
    measured: rolled.measured,
    skipped: rolled.skipped,
  };
};

registerExecutor("height-from-extent", heightFromExtent);
