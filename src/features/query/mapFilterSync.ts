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

/** Take the layer's next generation. Every entry point starts here, so no
 *  caller can write the drawn set without invalidating what is in flight. */
function nextGeneration(layerId: string): number {
  const generation = (generations.get(layerId) ?? 0) + 1;
  generations.set(layerId, generation);
  return generation;
}

/**
 * Draw the layer WHOLE again, invalidating any id query in flight.
 *
 * The table lifecycle's door, called just before a rebuild replaces the table
 * the current set was computed from. It has to go through the generation and
 * not straight to the store: the query for the RETIRED table can still be out,
 * and a bare store write would be undone the moment that answer landed —
 * reinstating ids from a `layer_<n>` that no longer exists.
 */
export function clearMapFilter(layerId: string): void {
  nextGeneration(layerId);
  useLayerStore.getState().setVisibleObjectIds(layerId, null);
}

/**
 * The layer is gone — drop its generation entirely.
 *
 * Two reasons, and the second is the one that bites: the map would otherwise
 * hold an entry for every layer ever synced in the session, and a layer
 * re-added under the SAME id (a restore, a re-open) would inherit the old
 * number. A deleted entry also fails every in-flight `isCurrent()`, so a query
 * outliving its layer writes nothing.
 */
export function forgetMapFilter(layerId: string): void {
  generations.delete(layerId);
}

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

/**
 * One row's `id` as the string the layer store and the mesh key on.
 *
 * STRINGIFIED rather than type-tested. The bytes path does not constrain the
 * id column's TYPE — whatever the file gave it is what the reader hands back,
 * and a BIGINT or a UUID is perfectly legal — so the old
 * `typeof row.id === "string"` dropped every non-text id and left an EMPTY
 * set, which hides the whole layer with nothing said anywhere. An object is
 * still refused: it is not an id, and `String()` would make it
 * `"[object Object]"`, which matches nothing while looking like a value.
 */
function idText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return null;
}

export async function syncFilterToMap(layerId: string): Promise<void> {
  const generation = nextGeneration(layerId);
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
    const id = idText(row.id);
    if (id !== null) ids.add(id);
  }
  if (result.rows.length > 0 && ids.size === 0) {
    // Hiding everything is still the honest answer to an id column full of
    // NULLs, but not a SILENT one: on screen it is indistinguishable from a
    // filter that matched nothing.
    console.warn(
      `Map filter for layer ${layerId}: ${result.rows.length} matching rows carried no usable id, so nothing will be drawn.`,
    );
  }
  // Written even when EMPTY — that is "the filter matched nothing", and the
  // mesh draws nothing for it. Only `null` means "no filter".
  useLayerStore.getState().setVisibleObjectIds(layerId, ids);
}
