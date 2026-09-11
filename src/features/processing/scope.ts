/**
 * What a run runs ON, frozen when Run is pressed.
 *
 * TWO HALVES, and the split is the point. `snapshotScopeInputs` reads the live
 * stores ONCE, in `submitRun`; `resolveScope` reads no store at all and resolves
 * the snapshot it is handed at the head of the queue. A run that waits behind a
 * long table build therefore measures the selection and the filter the user saw
 * when they pressed Run (spec §6.1, "Frozen parameters"), not whatever they have
 * clicked since.
 *
 * Three scopes, and the difference between them is not just a predicate:
 *
 *  - "all" keeps NO id list. The write may touch every row, so there is nothing
 *    to freeze and nothing to splice into an `IN (…)` of thousands of literals.
 *  - "matching" uses the APPLIED filter, never the draft in the filter bar: the
 *    user pressed Run against what the map and the grid are showing.
 *  - "selected" uses the selection, which is a set of ROWS the user clicked —
 *    a BuildingPart as often as a Building.
 *
 * Both id scopes expand to the whole FEATURE, for the reason
 * {@link buildFeatureIdsSql} exists: attributes live on the `Building` and
 * geometry on its `BuildingPart`s, so a run scoped to the literally-matching
 * rows would measure nothing on real data.
 *
 * The COUNTS are of FEATURES in every case — `count` in scope, `total` on the
 * layer. They are what the card and the provenance tooltip say ("All 1,115
 * buildings", "312 of 1,115"), and a count of rows would inflate both by however
 * many parts the file happens to model.
 */

import { runQuery } from "../../insights/duckdb";
import type { LayerTable } from "../../insights/layerTables";
import {
  buildFeatureRowsSql,
  compileFilter,
  quoteIdent,
  quoteLiteral,
} from "../../insights/sql";
import type { FilterGroup } from "../query/types";
import { layerQuery, useQueryStore } from "../query/queryStore";
import { useSelectionStore } from "../selection/selectionStore";
import type { Scope } from "./types";

/** The live inputs a scope resolves against, read once at Run. */
export interface ScopeSnapshot {
  /** Object ids selected on the target layer, deduplicated. */
  readonly selectedObjectIds: ReadonlyArray<string>;
  /** The layer's APPLIED filter, or null when none is applied. */
  readonly filter: FilterGroup | null;
}

export type ScopeResolution =
  | {
      readonly ok: true;
      /** The ROWS to write to, or `null` for "every row". */
      readonly featureIds: ReadonlyArray<string> | null;
      /** FEATURES in scope, not rows. */
      readonly count: number;
      /** FEATURES on the whole layer, for "count of total". */
      readonly total: number;
    }
  | { readonly ok: false; readonly message: string };

/** Freeze the stores' contribution to a run. Called from `submitRun`, once. */
export function snapshotScopeInputs(layerId: string): ScopeSnapshot {
  return {
    selectedObjectIds: [
      ...new Set(
        useSelectionStore
          .getState()
          .selections.filter((s) => s.layerId === layerId)
          .map((s) => s.objectId),
      ),
    ],
    filter: layerQuery(useQueryStore.getState(), layerId).applied,
  };
}

/** The layer's FEATURE count: one query, asked once per run. */
async function countFeatures(
  table: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const out = await runQuery(
    `SELECT COUNT(DISTINCT COALESCE("feature_id", "id")) AS n FROM ${quoteIdent(table)}`,
  );
  if (!out.ok) return { ok: false, message: out.message };
  return { ok: true, count: Number(out.rows[0]?.n ?? 0) };
}

export async function resolveScope(input: {
  table: LayerTable;
  scope: Scope;
  snapshot: ScopeSnapshot;
}): Promise<ScopeResolution> {
  // Refusals FIRST, so a scope the user cannot have meant costs no query.
  let where: string | null = null;
  if (input.scope === "matching") {
    const applied = input.snapshot.filter;
    if (applied === null) return { ok: false, message: "No filter applied" };
    const compiled = compileFilter(applied, input.table.columns);
    if (!compiled.ok) return { ok: false, message: compiled.message };
    // An applied filter that compiles to nothing is an applied filter with no
    // conditions, which the store spells as `null` — but a restored draft could
    // still get here, and "everything" is not what the user asked for.
    if (compiled.where === null)
      return { ok: false, message: "No filter applied" };
    where = compiled.where;
  } else if (input.scope === "selected") {
    const ids = input.snapshot.selectedObjectIds;
    if (ids.length === 0)
      return { ok: false, message: "Nothing selected on this layer" };
    where = `"id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  }

  const total = await countFeatures(input.table.table);
  if (!total.ok) return { ok: false, message: total.message };
  if (where === null) {
    return {
      ok: true,
      featureIds: null,
      count: total.count,
      total: total.count,
    };
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
    total: total.count,
  };
}
