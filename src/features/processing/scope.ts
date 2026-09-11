/**
 * What a run runs ON, resolved once at the moment it reaches the queue's head.
 *
 * Three scopes, and the difference between them is not just a predicate:
 *
 *  - "all" keeps NO id list. The write may touch every row, so there is nothing
 *    to freeze and nothing to splice into an `IN (…)` of thousands of literals.
 *  - "matching" reads the APPLIED filter, never the draft in the filter bar: the
 *    user pressed Run against what the map and the grid are showing.
 *  - "selected" reads the selection, which is a set of ROWS the user clicked —
 *    a BuildingPart as often as a Building.
 *
 * Both id scopes expand to the whole FEATURE, for the reason
 * {@link buildFeatureIdsSql} exists: attributes live on the `Building` and
 * geometry on its `BuildingPart`s, so a run scoped to the literally-matching
 * rows would measure nothing on real data.
 *
 * The COUNT is of FEATURES in every case. It is what the card and the
 * provenance tooltip say ("All 1,115 buildings"), and a count of rows would
 * inflate it by however many parts the file happens to model.
 */

import { runQuery } from "../../insights/duckdb";
import type { LayerTable } from "../../insights/layerTables";
import {
  buildFeatureRowsSql,
  compileFilter,
  quoteIdent,
  quoteLiteral,
} from "../../insights/sql";
import { layerQuery, useQueryStore } from "../query/queryStore";
import { useSelectionStore } from "../selection/selectionStore";
import type { Scope } from "./types";

export type ScopeResolution =
  | {
      readonly ok: true;
      /** The ROWS to write to, or `null` for "every row". */
      readonly featureIds: ReadonlyArray<string> | null;
      /** FEATURES, not rows. */
      readonly count: number;
    }
  | { readonly ok: false; readonly message: string };

export async function resolveScope(input: {
  layerId: string;
  table: LayerTable;
  scope: Scope;
}): Promise<ScopeResolution> {
  if (input.scope === "all") {
    const out = await runQuery(
      `SELECT COUNT(DISTINCT COALESCE("feature_id", "id")) AS n FROM ${quoteIdent(input.table.table)}`,
    );
    if (!out.ok) return { ok: false, message: out.message };
    return { ok: true, featureIds: null, count: Number(out.rows[0]?.n ?? 0) };
  }

  let where: string;
  if (input.scope === "matching") {
    const applied = layerQuery(useQueryStore.getState(), input.layerId).applied;
    if (applied === null) return { ok: false, message: "No filter applied" };
    const compiled = compileFilter(applied, input.table.columns);
    if (!compiled.ok) return { ok: false, message: compiled.message };
    // An applied filter that compiles to nothing is an applied filter with no
    // conditions, which the store spells as `null` — but a restored draft could
    // still get here, and "everything" is not what the user asked for.
    if (compiled.where === null)
      return { ok: false, message: "No filter applied" };
    where = compiled.where;
  } else {
    const ids = [
      ...new Set(
        useSelectionStore
          .getState()
          .selections.filter((s) => s.layerId === input.layerId)
          .map((s) => s.objectId),
      ),
    ];
    if (ids.length === 0)
      return { ok: false, message: "Nothing selected on this layer" };
    where = `"id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  }

  const out = await runQuery(buildFeatureRowsSql(input.table.table, where));
  if (!out.ok) return { ok: false, message: out.message };
  const featureIds = out.rows.map((r) => String(r.id));
  // Refused rather than run: an empty scope would reach the write as `IN ()`,
  // which is a SYNTAX error, and a run that measured nothing is not a result.
  if (featureIds.length === 0)
    return { ok: false, message: "Nothing to run on (0 buildings)" };
  return {
    ok: true,
    featureIds,
    count: new Set(out.rows.map((r) => String(r.f))).size,
  };
}
