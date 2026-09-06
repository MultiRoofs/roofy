/**
 * "What is being left out?" — a SUMMARY of the layer's applied filter, and
 * deliberately not a second filter builder.
 *
 * The bar that composes a filter lives in the data drawer, where the columns
 * and their types are; a 300 px panel cannot offer the same thing without
 * offering a WORSE version of it, and two builders writing one `LayerQuery`
 * is two places for "Apply is an explicit act" to be got wrong. So this
 * section reads the applied predicate back — in the bar's own vocabulary
 * (`OP_LABELS`, `valueText`), so the two never word a condition differently —
 * and offers the two things a summary owes its reader: a way back to the bar
 * ("Edit in table") and a way out ("Clear filter").
 *
 * Only a CITY layer has a filter at all: a filter is a predicate over the
 * layer's DuckDB table, and only city layers have one. A geospatial layer is
 * told so rather than shown an empty summary it can never fill.
 */
import { clearMapFilter } from "../../features/query/mapFilterSync";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { isNullaryOp, type FilterCondition } from "../../features/query/types";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { useShellStore } from "../shell/shellStore";
import { OP_LABELS, valueText } from "../table/tableText";

export function FilterSection({ item }: { readonly item: ActiveLayer }) {
  const layerId = item.layer.id;

  // `layerQuery` defaults to the frozen `DEFAULT_LAYER_QUERY`, so `applied`
  // is a stable `null` for a layer with no query — no new object per store
  // notification, and no re-render loop.
  const applied = useQueryStore((s) => layerQuery(s, layerId).applied);
  const clearFilter = useQueryStore((s) => s.clearFilter);

  if (item.kind === "geo") {
    return <p className="active-layer-note">This layer cannot be filtered.</p>;
  }

  if (applied === null || applied.conditions.length === 0) {
    return (
      <p className="active-layer-note">
        {item.layer.isStreaming
          ? "No filter. Table only — map filtering for streaming layers is not available yet."
          : "No filter. Filters apply to the map and the table together."}
      </p>
    );
  }

  return (
    <>
      {/* Mono, because these are column names and literals — the same face
          the grid shows them in. One logic word for the whole group: nested
          groups are out of scope (see `FilterGroup`). */}
      <ul className="active-layer-conditions">
        {applied.conditions.map((condition, index) => (
          <li key={condition.id} className="active-layer-condition">
            {index > 0 && (
              <span className="active-layer-condition-logic">
                {applied.logic}
              </span>
            )}
            <code>{conditionText(condition)}</code>
          </li>
        ))}
      </ul>

      <div className="active-layer-actions">
        {/* The drawer, not a panel-local editor — 12.4 focuses the filter bar
            itself. It opens the drawer and NOTHING else: consuming a pending
            `requestedSection` belongs to `ActiveLayerPanel`'s effect, and a
            blind `requestSection(null)` here would also swallow a request
            aimed at a DIFFERENT layer that has not been rendered yet.
            Through `getState()` rather than a selector: the shell's actions
            never change identity, and `ShellActions` declares them as method
            shorthand, which `unbound-method` refuses as a captured
            reference. */}
        <button
          type="button"
          className="active-layer-action"
          onClick={() => useShellStore.getState().openDrawer()}
        >
          Edit in table
        </button>
        <button
          type="button"
          className="active-layer-action"
          onClick={() => {
            clearFilter(layerId);
            // BOTH halves, always. The query alone would leave the map drawn
            // from a predicate nothing is showing any more — a stale id set
            // is worse than no filter, because it looks like one that works.
            clearMapFilter(layerId);
          }}
        >
          Clear filter
        </button>
      </div>
    </>
  );
}

/** One condition as a sentence. A nullary operator ("is empty") takes no
 *  value, and printing `valueText`'s empty string for it would leave a
 *  trailing space where a reader looks for a missing number. */
function conditionText(condition: FilterCondition): string {
  const head = `${condition.column} ${OP_LABELS[condition.op]}`;
  return isNullaryOp(condition.op)
    ? head
    : `${head} ${valueText(condition.value)}`;
}
