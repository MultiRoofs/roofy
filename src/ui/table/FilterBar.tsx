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
 */

import { useCallback } from "react";
import { isTextColumn, type ColumnInfo } from "../../analytics/columnKind";
import {
  isNullaryOp,
  type FilterCondition,
  type FilterGroup,
  type FilterOp,
} from "../../features/query/types";

const COMPARISON_OPS: ReadonlyArray<FilterOp> = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
];
const NULL_OPS: ReadonlyArray<FilterOp> = ["isNull", "isNotNull"];
const TEXT_OPS: ReadonlyArray<FilterOp> = [
  "contains",
  "startsWith",
  "endsWith",
];

const OP_LABELS: Readonly<Record<FilterOp, string>> = {
  "=": "=",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  isNull: "is empty",
  isNotNull: "is not empty",
  in: "is one of",
};

/**
 * What a column can be asked.
 *
 * A LIST, STRUCT or BLOB has no ordering and no equality a user could mean, so
 * only the null tests survive for it. The LIKE family is offered for VARCHAR
 * AND for `castText` — `compileFilter` casts the left side for the latter, so
 * "starts with 2024" on a DATE and "contains 3412" on a BIGINT both work, and
 * against exactly the rendering the grid is showing.
 */
export function operatorsFor(
  column: ColumnInfo | undefined,
): ReadonlyArray<FilterOp> {
  if (!column) return [];
  if (column.kind === "nested" || column.kind === "blob") return NULL_OPS;
  return isTextColumn(column) || column.kind === "castText"
    ? [...COMPARISON_OPS, ...TEXT_OPS, "in", ...NULL_OPS]
    : [...COMPARISON_OPS, "in", ...NULL_OPS];
}

/** A value the input can show. A list is joined for the "is one of" box. */
function valueText(value: FilterCondition["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? String(value) : String(value ?? "");
}

/**
 * What a text input contributes to the condition.
 *
 * The RAW STRING, for everything but "is one of" — and that is deliberate.
 * Parsing as the user types cannot work: `Number("1.")` is 1, so the decimal
 * point is deleted the instant it is typed and no fractional threshold can
 * ever be entered; `Number("-")` is NaN, so a negative number cannot be
 * started either. The column's type decides what the string MEANS at compile
 * time (`literalFor` in `analytics/sql.ts`), where nothing is being retyped
 * and a bad value can be refused with a sentence.
 *
 * "is one of" is the exception: a list is not something a single string can
 * hold, so the commas are split here.
 */
function parseValue(raw: string, op: FilterOp): FilterCondition["value"] {
  if (op === "in") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return raw;
}

export interface FilterBarProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly error: string | null;
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

  return (
    <div className="filter-bar">
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
                disabled={disabled}
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
                disabled={disabled}
                value={condition.op}
                onChange={(e) =>
                  patch(condition.id, { op: e.target.value as FilterOp })
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
                  disabled={disabled}
                  value={valueText(condition.value)}
                  placeholder={condition.op === "in" ? "a, b, c" : "value"}
                  onChange={(e) =>
                    patch(condition.id, {
                      value: parseValue(e.target.value, condition.op),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !disabled) onApply();
                  }}
                />
              )}

              <button
                type="button"
                className="filter-remove"
                aria-label="Remove condition"
                title="Remove this condition"
                disabled={disabled}
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
          disabled={disabled || columns.length === 0}
          onClick={addCondition}
        >
          Add condition
        </button>
        {filter.conditions.length >= 1 && (
          <button
            type="button"
            className="tb-btn table-action-btn filter-logic-btn"
            disabled={disabled}
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
          onClick={onApply}
        >
          Apply
        </button>
        <button
          type="button"
          className="tb-btn table-action-btn"
          disabled={disabled}
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
