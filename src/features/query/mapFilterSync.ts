/**
 * The bridge from the table's applied filter to the geometry actually drawn.
 *
 * A separate module rather than a hook, because it is called from three
 * different beats — an Apply, the toggle going on, and a table rebuild — and
 * all three want the same "recompute or clear" decision made once.
 *
 * "Clear" is `null` on every failure path: a stale id set is worse than no
 * filter, because it looks like a filter that is working.
 */

import { runQuery } from "../../analytics/duckdb";
import {
  useLayerTableStore,
  type LayerTable,
} from "../../analytics/layerTables";
import { buildFeatureIdsSql, compileFilter } from "../../analytics/sql";
import { useLayerStore } from "../layers/layerStore";
import { layerQuery, useQueryStore } from "./queryStore";

/**
 * One generation per layer, bumped on every call.
 *
 * The same reason `useLayerQuery` has one — an Apply, a toggle and a table
 * rebuild can all be in flight at once and DuckDB answers in whatever order it
 * finishes — but the stakes are higher here: the LOSER does not merely paint a
 * stale grid, it rebuilds the layer's GEOMETRY from a predicate the user has
 * already replaced. Bumped on the early paths too, so a clear that lands late
 * cannot undo the filter that overtook it.
 */
const generations = new Map<string, number>();

/**
 * The layer's table, from the STORE rather than from `getLayerTable`'s module
 * registry.
 *
 * The two carry the same object in production — a build does `registry.set`
 * and `setState` back to back, with no await between them — but the store is
 * the one the PANEL reads (`useLayerQuery` uses `tableState.info`), and the
 * effect that calls this function re-runs on that object's identity. Reading
 * anything else would let the sync compute against a table the grid is not
 * showing.
 */
function readyTable(layerId: string): LayerTable | null {
  const entry = useLayerTableStore.getState().tables[layerId];
  return entry?.state === "ready" ? entry.info : null;
}

export async function syncFilterToMap(layerId: string): Promise<void> {
  const generation = (generations.get(layerId) ?? 0) + 1;
  generations.set(layerId, generation);
  const isCurrent = () => generations.get(layerId) === generation;

  const clear = () =>
    useLayerStore.getState().setVisibleObjectIds(layerId, null);

  const query = layerQuery(useQueryStore.getState(), layerId);
  if (!query.syncToMap || query.applied === null) {
    // The store's own identity guard already makes `clear()` free, but this is
    // the path taken on EVERY Apply, toggle and table rebuild for every layer
    // that is not being map-filtered — which is nearly all of them — so return
    // before touching the store at all.
    const current = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId);
    if (current === undefined || current.visibleObjectIds === null) return;
    clear();
    return;
  }

  const table = readyTable(layerId);
  if (table === null) {
    clear();
    return;
  }

  const compiled = compileFilter(query.applied, table.columns);
  if (!compiled.ok || compiled.where === null) {
    clear();
    return;
  }

  const result = await runQuery(
    buildFeatureIdsSql(table.table, compiled.where),
  );
  // A newer call overtook this one while the query ran. Its answer is the
  // current one; writing ours would rebuild the geometry from a predicate the
  // user has already moved on from.
  if (!isCurrent()) return;
  if (!result.ok) {
    clear();
    return;
  }

  const ids = new Set<string>();
  for (const row of result.rows) {
    if (typeof row.id === "string") ids.add(row.id);
  }
  // Written even when EMPTY — that is "the filter matched nothing", and the
  // mesh draws nothing for it. Only `null` means "no filter".
  useLayerStore.getState().setVisibleObjectIds(layerId, ids);
}
