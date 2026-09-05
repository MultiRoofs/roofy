/**
 * The rows themselves: a sticky-header table over ONE page of results.
 *
 * No virtualisation and no infinite scroll — the page IS the window, capped at
 * 1000 rows, which a browser lays out without help. (The old
 * `IntersectionObserver` sentinel is gone with the in-memory paths it fed.)
 */

import { memo } from "react";
import type { ColumnInfo } from "../../analytics/columnKind";
import { formatCell, rawCellTitle } from "./tableText";

/** The id a row is selected by. Every layer table has an `id` column, but a
 *  hand-built one may not, so the index is the fallback. */
function rowIdOf(row: Record<string, unknown>, index: number): string {
  const id = row.id;
  return typeof id === "string" ? id : formatCell(id ?? index);
}

/** Only a column with an ORDER can be sorted on — the same rule
 *  `buildPageSql` applies, so a header that looks clickable really is. */
function sortable(column: ColumnInfo): boolean {
  return column.kind === "scalar" || column.kind === "castText";
}

export interface DataGridProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSort: (column: string) => void;
  readonly onRowClick: (rowId: string, shiftKey: boolean) => void;
  readonly emptyMessage?: string;
}

/**
 * MEMOISED, and its props are memoised at the call site to match.
 *
 * The panel above re-renders on every hover, every camera settle and every
 * store touch; this component's output is up to 1000 rows x N columns of DOM,
 * and none of it changes on any of those. `React.memo` turns those into a
 * props comparison — provided nobody hands it a freshly built `Set` or array
 * each time, which is why `TablePanel` memoises `selectedIds`.
 */
export const DataGrid = memo(function DataGrid({
  columns,
  rows,
  sort,
  selectedIds,
  onSort,
  onRowClick,
  emptyMessage = "No rows match this filter.",
}: DataGridProps) {
  if (rows.length === 0) {
    return <div className="table-empty">{emptyMessage}</div>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => {
            const canSort = sortable(col);
            const sorted = sort?.column === col.name;
            return (
              <th
                key={col.name}
                className={`data-th ${sorted ? "sorted" : ""} ${canSort ? "" : "data-th-static"}`}
                title={`${col.name} (${col.type})`}
                onClick={canSort ? () => onSort(col.name) : undefined}
                aria-sort={
                  sorted
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <span>{col.name}</span>
                {sorted && (
                  <span className="sort-indicator">
                    {sort.dir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const rowId = rowIdOf(row, i);
          const isSelected = selectedIds.has(rowId);
          return (
            <tr
              key={`${rowId}:${i}`}
              className={`data-row ${isSelected ? "data-row-selected" : ""}`}
              onClick={(e) => onRowClick(rowId, e.shiftKey)}
            >
              {columns.map((col) => {
                const value = row[col.name];
                return (
                  <td
                    key={col.name}
                    className="data-td"
                    // The RAW value on hover: the cell TEXT rounds a float to
                    // two places, and a tooltip that repeats the rounding is a
                    // tooltip that hides the number the user hovered to see.
                    title={rawCellTitle(value)}
                  >
                    {formatCell(value)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});
