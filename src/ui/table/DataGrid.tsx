/**
 * The rows themselves: a sticky-header table over ONE page of results.
 *
 * No virtualisation and no infinite scroll — the page IS the window, capped at
 * 1000 rows, which a browser lays out without help. (The old
 * `IntersectionObserver` sentinel is gone with the in-memory paths it fed.)
 */

import { Fragment, memo, useState } from "react";
import type { ColumnInfo } from "../../insights/columnKind";
import { formatCell, rawCellTitle } from "./tableText";
import { columnLabel, derivedColumnTitle } from "../drawer/columnPolicy";

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
  readonly partsById?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly getRowId?: (row: Record<string, unknown>, index: number) => string;
  /** Optional resident/source records for expanded child rows. */
  readonly partRows?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** Generated derived keys only; source attributes keep their literal labels. */
  readonly derivedColumnNames?: ReadonlySet<string>;
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
  partsById = {},
  getRowId,
  partRows = {},
  derivedColumnNames = new Set(),
}: DataGridProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const hasParts = Object.keys(partsById).length > 0;

  if (rows.length === 0) {
    return <div className="table-empty">{emptyMessage}</div>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {hasParts && <th className="data-th-static" aria-label="Parts" />}
          {columns.map((col) => {
            const canSort = sortable(col);
            const sorted = sort?.column === col.name;
            return (
              <th
                key={col.name}
                className={`data-th ${sorted ? "sorted" : ""} ${canSort ? "" : "data-th-static"}`}
                title={
                  derivedColumnNames.has(col.name)
                    ? derivedColumnTitle(col.name)
                    : `${col.name} (${col.type})`
                }
                onClick={canSort ? () => onSort(col.name) : undefined}
                aria-sort={
                  sorted
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <span>
                  {derivedColumnNames.has(col.name)
                    ? columnLabel(col.name)
                    : col.name}
                </span>
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
          const rowId = getRowId?.(row, i) ?? rowIdOf(row, i);
          const isSelected = selectedIds.has(rowId);
          const parts = partsById[rowId] ?? [];
          const canExpand = parts.length > 0;
          return (
            <Fragment key={`${rowId}:${i}`}>
              <tr
                className={`data-row ${isSelected ? "data-row-selected" : ""}`}
                onClick={(e) => onRowClick(rowId, e.shiftKey)}
              >
                {hasParts && (
                  <td>
                    {canExpand && (
                      <button
                        type="button"
                        aria-label={`Toggle parts for ${rowId}`}
                        aria-expanded={expanded.has(rowId)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(rowId)) next.delete(rowId);
                            else next.add(rowId);
                            return next;
                          });
                        }}
                      >
                        {expanded.has(rowId) ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                )}
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
              {expanded.has(rowId) &&
                parts.map((part) => (
                  <tr
                    key={`${rowId}:${part}`}
                    className="data-row data-row-part"
                    onClick={(event) => onRowClick(part, event.shiftKey)}
                  >
                    {columns.map((column, index) => {
                      const value =
                        index === 0
                          ? `↳ ${part}`
                          : partRows[part]?.[column.name];
                      return (
                        <td
                          key={column.name}
                          className="data-td"
                          aria-label={index === 0 ? "Part" : undefined}
                          title={rawCellTitle(value)}
                        >
                          {formatCell(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
});
