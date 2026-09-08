/**
 * The query a user builds over ONE layer's DuckDB table — engine-free, so the
 * SQL builders, the filter bar and the tests all read one vocabulary.
 *
 * SESSION state, deliberately: none of this is in the v3 snapshot or a share
 * link, for the same reason the active-layer id is not. A restored workspace
 * opens on an unfiltered table, which is the honest starting point — a
 * restored filter would also have to restore the map filtering it drives, and
 * a saved predicate can name a column a re-linked file does not have.
 */

export type FilterOp =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull"
  | "in";

export type FilterValue = string | number | boolean | ReadonlyArray<string>;

export interface FilterCondition {
  readonly id: string;
  readonly column: string;
  readonly op: FilterOp;
  readonly value: FilterValue;
}

export interface FilterGroup {
  /** One logic for the whole group. Nested groups are deliberately out of
   *  scope: a two-level builder in a 320 px panel costs more than it buys,
   *  and AND/OR over a flat list covers the questions this data invites. */
  readonly logic: "AND" | "OR";
  readonly conditions: ReadonlyArray<FilterCondition>;
}

/** 500/1000 are accepted only to read an in-session pre-12.4 query. */
export type PageSize = 20 | 50 | 100 | 500 | 1000;

export const PAGE_SIZES: ReadonlyArray<PageSize> = [20, 50, 100];

export interface LayerQuery {
  /** The DRAFT edited in the bar — never itself queried. */
  readonly filter: FilterGroup;
  /** What the grid and the map currently use; `null` means no filter. Apply
   *  is an EXPLICIT act, never per keystroke: applying can rebuild geometry. */
  readonly applied: FilterGroup | null;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly page: number;
  readonly pageSize: PageSize;
  /** Drawer presentation state; kept session-local with the query. */
  readonly view: "buildings" | "raw";
  readonly showSelectedOnly: boolean;
  /** Exact Raw-object request from Details; independent of applied filters. */
  readonly rawObjectId: string | null;
  /** null means the stable drawer default column policy. */
  readonly columns: ReadonlyArray<string> | null;
  /** Compatibility field while old table consumers migrate; map filtering is automatic. */
}

export const EMPTY_FILTER: FilterGroup = Object.freeze({
  logic: "AND",
  conditions: Object.freeze([]) as ReadonlyArray<FilterCondition>,
});

export const DEFAULT_LAYER_QUERY: LayerQuery = Object.freeze({
  filter: EMPTY_FILTER,
  applied: null,
  sort: null,
  page: 0,
  pageSize: 20 as PageSize,
  view: "buildings",
  showSelectedOnly: false,
  rawObjectId: null,
  columns: null,
});

/** Whether an operator takes no value — the bar hides its value input. */
export function isNullaryOp(op: FilterOp): boolean {
  return op === "isNull" || op === "isNotNull";
}
