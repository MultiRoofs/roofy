/**
 * The footer: which rows are on screen, how many there are, and the two steps.
 *
 * "filtered from N" is shown alongside the filtered count because the two
 * numbers answer different questions — how much matched, and how much there
 * is — and a single number that silently changes meaning when a filter is
 * applied is how a user comes to believe a filter deleted their data.
 */

import { PAGE_SIZES, type PageSize } from "../../features/query/types";

/**
 * Row counts, grouped, in ONE locale.
 *
 * Explicitly `en-US`, not the host's: a bare `toLocaleString()` renders 2231 as
 * "2.231" on a de_DE machine and "2 231" on fr_FR, so every test asserting
 * "2,231" would fail on a developer's laptop and pass in CI, or the reverse.
 * The app has no localisation for this to be consistent with, so the formatter
 * is pinned and SHARED — `TablePanel` imports this one rather than growing a
 * second.
 */
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/**
 * "1–100 of 2,231". Counts from ONE: nobody reads a row range zero-based.
 *
 * A NULL total means the COUNT could not be taken (`LayerTable.rowCount`),
 * which is NOT the same as zero: the page query is a separate statement and
 * its rows are on screen, so the range is real and only the total is missing.
 * "0 rows" over a full grid would be a plain contradiction.
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
    </div>
  );
}
