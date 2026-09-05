/**
 * Every pure string/shape decision the table panel makes, in ONE engine-free,
 * component-free module.
 *
 * Two reasons it is not spread across the components that use it. The first is
 * mechanical: `eslint-plugin-react(only-export-components)` fails fast refresh
 * for any file that exports both a component and a function, and each of these
 * is exported precisely so a test can call it without rendering anything. The
 * second is that they are the panel's VOCABULARY — what a cell says, what an
 * empty grid says, which operators a column can take — and a vocabulary that
 * lives inside the thing that renders it can only be checked by rendering.
 *
 * No React import, no engine import, no I/O.
 */

import { isTextColumn, type ColumnInfo } from "../../analytics/columnKind";
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
} from "../../features/query/types";

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Row counts, grouped, in ONE locale.
 *
 * Explicitly `en-US`, not the host's: a bare `toLocaleString()` renders 2231 as
 * "2.231" on a de_DE machine and "2 231" on fr_FR, so every test asserting
 * "2,231" would fail on a developer's laptop and pass in CI, or the reverse.
 * The app has no localisation for this to be consistent with, so the formatter
 * is pinned and SHARED — the footer and the panel header both read this one.
 */
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/**
 * "1–100 of 2,231". Counts from ONE: nobody reads a row range zero-based.
 *
 * A NULL total means the COUNT could not be taken, which is NOT the same as
 * zero: the page query is a separate statement and its rows are on screen, so
 * the range is real and only the total is missing. "0 rows" over a full grid
 * would be a plain contradiction.
 */
export function rangeLabel(
  page: number,
  pageSize: number,
  totalRows: number | null,
): string {
  if (totalRows === null) {
    const from = page * pageSize + 1;
    return `${formatCount(from)}–${formatCount(from + pageSize - 1)} of ?`;
  }
  if (totalRows === 0) return "0 rows";
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalRows);
  return `${formatCount(first)}–${formatCount(last)} of ${formatCount(totalRows)}`;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A cell as text.
 *
 * `String(unknown)` is not good enough: a value out of DuckDB or a CityJSON
 * file can be a plain object, which `String` renders as the useless
 * "[object Object]" — every distinct object displaying identically. Every
 * branch narrows first, so `String` only ever sees a primitive.
 *
 * The `typeof value === "number"` guard on the rounding branch is load-bearing:
 * HUGEINT and DECIMAL cells arrive through Arrow as STRINGS (and `castText`
 * columns arrive as `::VARCHAR` text by construction), so an unguarded
 * `toFixed` would throw on them — and rounding a 38-digit DECIMAL to two
 * places would misreport the value DuckDB actually holds.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/** The unrounded value, for the cell's `title`. Null renders as the same em
 *  dash the text does — there is nothing more to reveal about a null. */
export function rawCellTitle(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  // Narrowed to the primitives BEFORE the fallback, not after: `String` on an
  // unnarrowed `unknown` is the "[object Object]" trap `formatCell` documents,
  // and the linter is right to refuse it.
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

// ---------------------------------------------------------------------------
// The empty grid
// ---------------------------------------------------------------------------

/**
 * What the grid says with no rows to show.
 *
 * Three different situations, three different sentences — "No rows match this
 * filter" over a table that HAS no rows is simply wrong, and an empty viewport
 * with no explanation reads as a rendering bug rather than as a filter doing
 * its job:
 *
 *  - no filter applied → the table itself is empty (a streaming layer whose
 *    first cells have not landed);
 *  - a filter applied, map sync off → the ordinary "nothing matched";
 *  - a filter applied, map sync ON → the same, plus why the globe went empty,
 *    with both numbers so "too narrow" is distinguishable from "broken".
 *
 * The `unfilteredRows === null` arm is live, but NOT for the reason it is
 * tempting to give. A COUNT that fails does leave the total unknown — and it
 * also sets `message`, which makes the panel render the error INSTEAD of the
 * grid, so this function is never asked. What actually reaches it is the
 * window before the first answer: a table that is `ready` with a filter
 * already applied renders once with no rows, no counts and no message while
 * the page and count queries are still out — on mount, on `reload()`, and on
 * a switch to another layer. Brief, dimmed by the loading state, and still a
 * sentence somebody can read.
 */
export function emptyGridMessage(
  filtered: boolean,
  syncToMap: boolean,
  unfilteredRows: number | null,
): string {
  if (!filtered) return "This layer has no rows yet.";
  if (!syncToMap) return "No rows match this filter.";
  if (unfilteredRows === null) {
    return "Nothing matches this filter; the map shows nothing while Filter map is on";
  }
  return `0 of ${formatCount(unfilteredRows)} rows match; the map shows nothing while Filter map is on`;
}

// ---------------------------------------------------------------------------
// The filter bar's vocabulary
// ---------------------------------------------------------------------------

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

export const OP_LABELS: Readonly<Record<FilterOp, string>> = {
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
export function valueText(value: FilterCondition["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? String(value) : String(value ?? "");
}

/**
 * The draft as it is SENT.
 *
 * The draft holds the RAW STRING for every operator, including "is one of",
 * and the split happens here — once, at Apply. Splitting as the user types
 * cannot work: `"a,".split(",")` is `["a"]`, which the input re-renders as
 * "a", so the separator is deleted the instant it is typed and a second
 * element can never be started. It is the same failure as `Number("1.")`
 * eating a decimal point, and it has the same answer: keep the string the user
 * is holding, and interpret it at the moment it means something.
 *
 * A value that is ALREADY a list (a programmatic caller, a draft that came
 * from somewhere other than the bar) passes through untouched.
 */
export function normalizeFilterForApply(filter: FilterGroup): FilterGroup {
  let changed = false;
  const conditions = filter.conditions.map((condition) => {
    if (condition.op !== "in" || Array.isArray(condition.value)) {
      return condition;
    }
    changed = true;
    return {
      ...condition,
      value: String(condition.value)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    };
  });
  return changed ? { ...filter, conditions } : filter;
}
