/**
 * The FEATURE roots of a set of selected object ids, asked of the TABLE.
 *
 * Everything an export writes is feature-scoped: a Building carries the
 * attributes and its BuildingPart carries the geometry, so a selected part has
 * to travel as its whole root. For a resident model that answer is free —
 * `parentsIndexOf` walks the objects the app already holds — but a CityParquet
 * family's table is a VIEW over its file (ruling R-B′) and answers for objects
 * the camera never delivered. Selecting such a row in the grid and exporting
 * "Selected" then compared the PART's own id against `feature_id` and wrote a
 * file with no features in it, silently.
 *
 * So the file is asked instead: `COALESCE("feature_id", "id")` for the rows whose
 * `"id"` is one of the selected ones — which is the same expression the export's
 * own predicate uses, and is right for a selected ROOT too (its row carries its
 * own id).
 *
 * Only for a file-backed table. Every other layer keeps the resident answer,
 * which costs no round trip and is what the whole app has always done.
 */

import { runQuery } from "./duckdb";
import { quoteIdent, quoteLiteral } from "./sql";

/**
 * How many ids travel in one `IN (…)` list.
 *
 * A selection of thousands is ordinary (a box-select over a district), and one
 * statement per id would be thousands of round trips while a single list would
 * be a megabyte of SQL text. 500 is the same order as the paging the grid does.
 */
const BATCH = 500;

/**
 * Both columns, not just the root: the `"id"` is what says WHICH selected object
 * each root answers for, and without it an id the table has no row for cannot be
 * told from one it resolved.
 */
export function buildSelectedFeatureIdsSql(
  table: string,
  ids: ReadonlyArray<string>,
): string {
  const list = ids.map(quoteLiteral).join(", ");
  return `SELECT DISTINCT "id", COALESCE("feature_id", "id") AS "feature_id" FROM ${quoteIdent(table)} WHERE "id" IN (${list})`;
}

/**
 * The same question as a SUBQUERY, for a caller that is already sending a
 * statement over the same table — the counts hook, whose three counts must not
 * grow a fourth round trip per selection change.
 *
 * Deliberately un-batched: it is one statement either way, and it replaces an
 * `IN` list of exactly the same ids that this hook has always built.
 */
export function buildSelectedRootsSubquery(
  table: string,
  ids: ReadonlyArray<string>,
): string {
  const list = ids.map(quoteLiteral).join(", ");
  return `SELECT DISTINCT COALESCE("feature_id", "id") FROM ${quoteIdent(table)} WHERE "id" IN (${list})`;
}

export type SelectedFeatureIds =
  | { readonly ok: true; readonly featureIds: ReadonlyArray<string> }
  | { readonly ok: false; readonly message: string };

/**
 * Resolve `ids` to their feature roots through `table`.
 *
 * An id the table does not know keeps ITSELF, which is what the resident path
 * does for an object with no parent — a selection the table cannot account for
 * must not silently drop out of the export's predicate.
 *
 * A failure is returned, never swallowed: exporting the raw ids would write the
 * wrong features (or none), which is exactly the empty file this exists to
 * prevent.
 */
export async function resolveSelectedFeatureIds(
  table: string,
  ids: ReadonlyArray<string>,
): Promise<SelectedFeatureIds> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: true, featureIds: [] };
  const roots = new Set<string>();
  const found = new Set<string>();
  for (let at = 0; at < unique.length; at += BATCH) {
    const batch = unique.slice(at, at + BATCH);
    const result = await runQuery(buildSelectedFeatureIdsSql(table, batch));
    if (!result.ok) return { ok: false, message: result.message };
    for (const row of result.rows) {
      const root = row["feature_id"];
      const id = row["id"];
      if (typeof root === "string") roots.add(root);
      if (typeof id === "string") found.add(id);
    }
  }
  // An id the table has no row for travels as ITSELF, which is what the resident
  // path does for an object with no parent: a selection the table cannot account
  // for must not silently drop out of the predicate.
  for (const id of unique) if (!found.has(id)) roots.add(id);
  return { ok: true, featureIds: [...roots] };
}
