/**
 * The structured WHERE builder above the grid.
 *
 * A flat list of conditions with ONE logic for the group, and the AND/OR
 * toggle in the BAR rather than between the rows — the group has one logic, so
 * a per-row control would be N buttons that always agree, and the first row
 * could never carry one at all. Nested groups are deliberately out of scope: a
 * two-level builder in a 320 px panel costs more screen and more explaining
 * than the questions this data invites are worth.
 *
 * The operator list is narrowed by the column's KIND, so an impossible
 * predicate cannot be built in the first place — `compileFilter` still refuses
 * one (a restored draft, a rebuilt table with different columns), but the
 * common case is prevented rather than reported.
 *
 * The DRAFT holds raw strings, never parsed values — see
 * `normalizeFilterForApply` in `tableText.ts` for why "is one of" is split at
 * Apply and not as the user types.
 */

import { useCallback } from "react";
import type { ColumnInfo } from "../../insights/columnKind";
import {
  isNullaryOp,
  type FilterCondition,
  type FilterGroup,
  type FilterOp,
} from "../../features/query/types";
import {
  normalizeFilterForApply,
  operatorsFor,
  OP_LABELS,
  valueText,
} from "./tableText";

export interface FilterBarProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly error: string | null;
  /**
   * A query is in flight, so APPLY is unavailable — and nothing else is.
   *
   * Deliberately narrow. Disabling the whole bar blurs the value input the
   * moment Enter fires (a disabled element loses focus), so the one gesture
   * that submits the filter also destroys the caret that typed it, and the
   * next keystroke goes nowhere. There is nothing to protect by freezing the
   * inputs anyway: editing the draft sends no query, and the hook's
   * generation counter already makes a second Apply landing over a first one
   * safe — a stale answer is discarded, not painted.
   */
  readonly disabled: boolean;
}

export function FilterBar({
  columns,
  filter,
  onChange,
  onApply,
  onClear,
  error,
  disabled,
}: FilterBarProps) {
  const byName = new Map(columns.map((c) => [c.name, c]));

  const replace = useCallback(
    (conditions: ReadonlyArray<FilterCondition>) =>
      onChange({ ...filter, conditions }),
    [filter, onChange],
  );

  const addCondition = useCallback(() => {
    const first = columns[0];
    if (!first) return;
    const op = operatorsFor(first)[0] ?? "isNull";
    replace([
      ...filter.conditions,
      { id: crypto.randomUUID(), column: first.name, op, value: "" },
    ]);
  }, [columns, filter.conditions, replace]);

  const patch = useCallback(
    (id: string, next: Partial<FilterCondition>) =>
      replace(
        filter.conditions.map((c) => (c.id === id ? { ...c, ...next } : c)),
      ),
    [filter.conditions, replace],
  );

  /**
   * Apply COMMITS the draft, and committing is what turns "a, b" into a list.
   *
   * The store's `applyFilter` copies whatever draft it finds, so the
   * normalisation has to happen first — and `setFilter` is a synchronous
   * zustand write, so the `onApply` on the next line reads the reshaped draft
   * rather than the one the user was typing into.
   */
  const handleApply = useCallback(() => {
    const normalized = normalizeFilterForApply(filter);
    if (normalized !== filter) onChange(normalized);
    onApply();
  }, [filter, onChange, onApply]);

  return (
    <div className="filter-bar" tabIndex={-1}>
      <div className="filter-bar-rows">
        {filter.conditions.map((condition, index) => {
          const column = byName.get(condition.column);
          const ops = operatorsFor(column);
          return (
            <div className="filter-row" key={condition.id}>
              {/* The row lead is TEXT: the group has ONE logic, and it is
                  toggled once, in the actions row below. */}
              <span className="filter-lead">
                {index === 0 ? "Where" : filter.logic}
              </span>

              <select
                className="filter-select"
                aria-label="Filter column"
                value={condition.column}
                onChange={(e) => {
                  const nextColumn = byName.get(e.target.value);
                  const allowed = operatorsFor(nextColumn);
                  patch(condition.id, {
                    column: e.target.value,
                    // A column change can make the current operator illegal
                    // (text -> list); fall back to the first one it allows.
                    op: allowed.includes(condition.op)
                      ? condition.op
                      : (allowed[0] ?? "isNull"),
                    // Back to the raw string the boxes hold, so a value that
                    // arrived as a list cannot outlive the operator that
                    // asked for one.
                    value: valueText(condition.value),
                  });
                }}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                className="filter-select filter-select-op"
                aria-label="Filter operator"
                value={condition.op}
                onChange={(e) =>
                  patch(condition.id, {
                    op: e.target.value as FilterOp,
                    // RESHAPED on every operator change, in both directions:
                    // "is one of" leaves a list behind in a draft that was
                    // applied, and `=` against a list is refused for shape by
                    // `compileFilter` — so `=` -> `in` -> `=` would be stuck
                    // on an error the user cannot see the cause of.
                    value: valueText(condition.value),
                  })
                }
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>

              {!isNullaryOp(condition.op) && (
                <input
                  className="filter-value"
                  aria-label="Filter value"
                  value={valueText(condition.value)}
                  placeholder={condition.op === "in" ? "a, b, c" : "value"}
                  // The RAW string, for every operator. Parsing as the user
                  // types cannot work: `Number("1.")` is 1, so a decimal point
                  // is eaten as fast as it is typed, and `"a,".split(",")` is
                  // `["a"]`, so a comma is too. The column's type (and, for
                  // "is one of", `normalizeFilterForApply`) decides what the
                  // string MEANS at the moment it is committed.
                  onChange={(e) =>
                    patch(condition.id, { value: e.target.value })
                  }
                  onKeyDown={(e) => {
                    // Enter IS Apply, so it waits with Apply — but the
                    // input keeps its focus and its caret either way.
                    if (e.key === "Enter" && !disabled) handleApply();
                  }}
                />
              )}

              <button
                type="button"
                className="filter-remove"
                aria-label="Remove condition"
                title="Remove this condition"
                onClick={() =>
                  replace(
                    filter.conditions.filter((c) => c.id !== condition.id),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="filter-bar-actions">
        <button
          type="button"
          className="tb-btn table-action-btn"
          disabled={columns.length === 0}
          onClick={addCondition}
        >
          Add condition
        </button>
        {filter.conditions.length >= 1 && (
          <button
            type="button"
            className="tb-btn table-action-btn filter-logic-btn"
            aria-label={`Match ${filter.logic === "AND" ? "ALL" : "ANY"} conditions`}
            title="Switch between matching all and any conditions"
            onClick={() =>
              onChange({
                ...filter,
                logic: filter.logic === "AND" ? "OR" : "AND",
              })
            }
          >
            {filter.logic === "AND" ? "Match all" : "Match any"}
          </button>
        )}
        <button
          type="button"
          className="tb-btn table-action-btn filter-apply"
          disabled={disabled || filter.conditions.length === 0}
          onClick={handleApply}
        >
          Apply
        </button>
        <button
          type="button"
          className="tb-btn table-action-btn"
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {error !== null && (
        <div className="filter-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
