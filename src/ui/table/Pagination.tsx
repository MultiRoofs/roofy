/**
 * The footer: which rows are on screen, how many there are, and the two steps.
 *
 * "filtered from N" is shown alongside the filtered count because the two
 * numbers answer different questions — how much matched, and how much there
 * is — and a single number that silently changes meaning when a filter is
 * applied is how a user comes to believe a filter deleted their data.
 */

import { PAGE_SIZES, type PageSize } from "../../features/query/types";
import { formatCount, rangeLabel } from "./tableText";

export interface PaginationProps {
  readonly page: number;
  readonly pageSize: PageSize;
  readonly totalRows: number | null;
  readonly unfilteredRows: number | null;
  readonly filtered: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (pageSize: PageSize) => void;
}

export function Pagination({
  page,
  pageSize,
  totalRows,
  unfilteredRows,
  filtered,
  onPage,
  onPageSize,
}: PaginationProps) {
  // With no total there is no last page to stop at — Next stays live, and the
  // page query's own empty result is what ends the walk.
  const lastPage =
    totalRows === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.ceil(totalRows / pageSize) - 1);

  return (
    <div className="table-pagination">
      <span className="table-range">
        {rangeLabel(page, pageSize, totalRows)}
      </span>
      {filtered && unfilteredRows !== null && (
        <span className="table-range-muted">
          filtered from {formatCount(unfilteredRows)}
        </span>
      )}

      <div className="toolbar-spacer" />

      <label className="table-pagesize">
        <span>Rows per page</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="First page"
        title="First page"
        disabled={page <= 0}
        onClick={() => onPage(0)}
      >
        «
      </button>
      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="Previous page"
        title="Previous page"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        ‹
      </button>
      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="Next page"
        title="Next page"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        ›
      </button>
      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="Last page"
        title="Last page"
        disabled={page >= lastPage || !Number.isFinite(lastPage)}
        onClick={() => onPage(lastPage)}
      >
        »
      </button>
    </div>
  );
}
