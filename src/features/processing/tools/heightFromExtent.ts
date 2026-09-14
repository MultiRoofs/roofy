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
 * root and parts). The ROOT row carries that roll-up; a PART row carries its
 * OWN extent, because §8 promises exactly that — "a Building shows the
 * aggregated value, a part its own" — and a part stamped with its building's
 * height is a measurement of something the user never selected. SQL could do it
 * with a window function; doing it here keeps the SQL a plain projection that is
 * readable in the run's log, and the counts (FEATURES measured, features
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
import { toolById } from "../toolRegistry";
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
 * The columns this run writes, read from the tool's own DEFINITION.
 *
 * The ONE answer: the roll-up keys its rows with their names, the executor
 * declares them WITH THEIR TYPES (the registry is the only place a type is
 * stated), and the form promises them before any run exists. Three literal
 * lists is how the form comes to promise a name the run never writes. The
 * registry is pure data, so reading it here adds no edge back to the queue or
 * to the UI.
 */
function outputColumns(prefix: string): ReadonlyArray<OutputColumn> {
  return toolById("height-from-extent").outputColumns?.(prefix, {}) ?? [];
}

/** The same list as bare names, for the row keys. */
function columnNames(prefix: string): ReadonlyArray<string> {
  return outputColumns(prefix).map((c) => c.name);
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

type Extent = { zmin: number; zmax: number } | null;

/**
 * Roll the rows up per feature: the feature's extent onto its ROOT row, each
 * part's own extent onto the part.
 *
 * A feature is skipped ONLY when no member has a bbox: a part with a null bbox
 * beside a root that has one does not poison the building, in either arrival
 * order — that part's own three values are NULL, and the building's are not.
 *
 * The root is the row whose id IS its feature id (`buildExtentSql` reads
 * `COALESCE("feature_id", "id")`, so a root answers with itself); a feature
 * whose root is not in the read has no row to carry the roll-up, and only its
 * parts are written.
 */
export function rollUpExtents(
  rows: ReadonlyArray<ExtentRow>,
  prefix: string,
): RollUp {
  const extents = new Map<string, Extent>();
  for (const row of rows) {
    const own: Extent =
      row.zmin === null || row.zmax === null
        ? null
        : { zmin: row.zmin, zmax: row.zmax };
    if (own === null) {
      if (!extents.has(row.f)) extents.set(row.f, null);
      continue;
    }
    const current = extents.get(row.f) ?? null;
    extents.set(
      row.f,
      current
        ? {
            zmin: Math.min(current.zmin, own.zmin),
            zmax: Math.max(current.zmax, own.zmax),
          }
        : own,
    );
  }

  // Three names, fixed by §7.4 and by this tool's registry entry; the `!`s
  // below are `noUncheckedIndexedAccess`, not a doubt about the shape.
  const [heightCol, zminCol, zmaxCol] = columnNames(prefix);
  const values = (extent: Extent): Record<string, number | null> => ({
    [heightCol!]: extent ? extent.zmax - extent.zmin : null,
    [zminCol!]: extent ? extent.zmin : null,
    [zmaxCol!]: extent ? extent.zmax : null,
  });

  const out = new Map<string, Record<string, number | null>>();
  for (const row of rows) {
    const isRoot = row.id === row.f;
    const own: Extent =
      row.zmin === null || row.zmax === null
        ? null
        : { zmin: row.zmin, zmax: row.zmax };
    out.set(row.id, values(isRoot ? (extents.get(row.f) ?? null) : own));
  }

  // The accounting is per FEATURE, as §7 counts everything: a building with one
  // measurable member is one building measured, whatever its parts lack.
  let measured = 0;
  let skipped = 0;
  for (const extent of extents.values()) {
    if (extent) measured += 1;
    else skipped += 1;
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
  const columns = outputColumns(run.prefix);
  return {
    columns,
    rows: rolled.rows,
    measured: rolled.measured,
    skipped: rolled.skipped,
  };
};

registerExecutor("height-from-extent", heightFromExtent);
