/**
 * The bottom panel: one layer's DuckDB table, filtered, sorted and paged.
 *
 * DuckDB-ONLY. The in-memory fallbacks this file used to carry (a `CityModel`
 * walk, a resident-record walk) are gone with the single global table they
 * shadowed: every layer now has a table of its own, so a fallback would be a
 * second, differently-shaped answer to the same question — with different
 * column names, which is exactly how the old `type` vs `object_type` split
 * happened.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuckDBStatus } from "../../analytics/duckdb";
import { useLayerTableStore } from "../../analytics/layerTables";
import { useLayerStore } from "../../features/layers/layerStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import type { Selection } from "../../domain/selection/types";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
// ONE pinned `en-US` formatter for the whole panel — see Pagination.tsx.
import { formatCount, Pagination } from "./Pagination";
import { useLayerQuery } from "./useLayerQuery";

/** The panel's height limits. Raised from 100–600: a filter bar, a header row
 *  and a footer eat ~110 px before a single record is on screen. */
export const MIN_TABLE_HEIGHT = 120;
export const MAX_TABLE_HEIGHT = 800;
export const DEFAULT_TABLE_HEIGHT = 320;

const STREAMING_FILTER_REASON =
  "Map filtering is not available for streaming layers yet";

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
 */
function emptyGridMessage(
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

export interface TablePanelProps {
  readonly duckdbStatus: DuckDBStatus;
  readonly onRetryDuckDB: () => void;
  readonly onCollapse: () => void;
  readonly onHeightChange: (height: number) => void;
}

export function TablePanel({
  duckdbStatus,
  onRetryDuckDB,
  onCollapse,
  onHeightChange,
}: TablePanelProps) {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const layerId = activeLayer?.id ?? null;

  const view = useLayerQuery(layerId);
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );
  const sceneSelections = useSelectionStore((s) => s.selections);

  const [syncSelection, setSyncSelection] = useState(true);
  const [tableSelection, setTableSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(false);

  // The registry cannot see the UI, and a streaming layer's table is only
  // worth rebuilding while somebody is looking at it.
  useEffect(() => {
    useLayerTableStore.getState().setTablePanelOpen(true);
    return () => useLayerTableStore.getState().setTablePanelOpen(false);
  }, []);

  // MEMOISED: a new Set on every render gives `DataGrid` a new prop identity,
  // which defeats the `React.memo` below — and this component re-renders on
  // every hover, every camera settle and every store touch, while the grid is
  // up to 1000 rows of DOM.
  const selectedIds = useMemo(
    () =>
      syncSelection
        ? new Set(sceneSelections.map((s) => s.objectId))
        : tableSelection,
    [syncSelection, sceneSelections, tableSelection],
  );

  const handleRowClick = useCallback(
    (objectId: string, shiftKey: boolean) => {
      if (!syncSelection) {
        setTableSelection((prev) => {
          const next = new Set(prev);
          if (shiftKey) {
            if (next.has(objectId)) next.delete(objectId);
            else next.add(objectId);
          } else {
            next.clear();
            next.add(objectId);
          }
          return next;
        });
        return;
      }
      if (layerId === null) return;
      const store = useSelectionStore.getState();
      const sel: Selection = { kind: "object", layerId, objectId };
      if (shiftKey) store.toggleSelect(sel);
      else store.select(sel);
    },
    [syncSelection, layerId],
  );

  const handleUnselectAll = useCallback(() => {
    if (syncSelection) useSelectionStore.getState().clear();
    else setTableSelection(new Set());
  }, [syncSelection]);

  const engineDown =
    duckdbStatus.state === "failed" || duckdbStatus.state === "uninitialized";

  return (
    <div className="table-panel">
      <TableResizeHandle onHeightChange={onHeightChange} />

      <div className="table-panel-header">
        <span className="table-panel-title">
          {activeLayer?.name ?? "Objects"}
          {view.status === "ready" && (
            <span className="table-count">
              {" "}
              ({formatCount(view.totalRows)} rows)
            </span>
          )}
        </span>

        <label className="table-sync-label">
          <input
            type="checkbox"
            checked={syncSelection}
            onChange={(e) => setSyncSelection(e.target.checked)}
          />
          <span>Sync selection</span>
        </label>

        <label
          className="table-sync-label"
          title={activeLayer?.isStreaming ? STREAMING_FILTER_REASON : undefined}
        >
          <input
            type="checkbox"
            aria-label="Filter map"
            disabled={
              activeLayer === undefined ||
              activeLayer.isStreaming ||
              view.status !== "ready"
            }
            checked={query?.syncToMap ?? false}
            onChange={(e) => {
              if (layerId !== null) {
                useQueryStore
                  .getState()
                  .setSyncToMap(layerId, e.target.checked);
              }
            }}
          />
          <span>Filter map</span>
        </label>

        <button
          type="button"
          className={`tb-btn table-action-btn ${filterOpen ? "active" : ""}`}
          onClick={() => setFilterOpen((o) => !o)}
          disabled={view.status !== "ready"}
        >
          Filter
        </button>

        <button
          className="tb-btn table-action-btn"
          title="Unselect all"
          onClick={handleUnselectAll}
        >
          Clear selection
        </button>

        <div className="toolbar-spacer" />

        <button
          className="tb-btn table-action-btn"
          title="Collapse table"
          onClick={onCollapse}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>

      {filterOpen &&
        view.status === "ready" &&
        query !== null &&
        layerId !== null && (
          <FilterBar
            columns={view.columns}
            filter={query.filter}
            error={view.message}
            disabled={false}
            onChange={(filter) =>
              useQueryStore.getState().setFilter(layerId, filter)
            }
            onApply={() => useQueryStore.getState().applyFilter(layerId)}
            onClear={() => useQueryStore.getState().clearFilter(layerId)}
          />
        )}

      <div className="table-panel-body">
        {engineDown ? (
          <div className="table-message" role="alert">
            <p>
              The analytics engine is not running
              {duckdbStatus.state === "failed"
                ? `: ${duckdbStatus.error}`
                : "."}
            </p>
            <button
              type="button"
              className="tb-btn table-action-btn"
              onClick={onRetryDuckDB}
            >
              Retry
            </button>
          </div>
        ) : view.status === "no-layer" ? (
          <div className="table-message">
            Select a layer to browse its table.
          </div>
        ) : view.status === "queued" || view.status === "building" ? (
          <div className="table-message">
            <span className="loading-spinner" />
            <span>Building this layer's table…</span>
          </div>
        ) : view.status === "failed" ? (
          <div className="table-message" role="alert">
            This layer's table could not be built: {view.message}
          </div>
        ) : (
          <>
            {/* The FilterBar carries this too — but the bar is COLLAPSED by
                default, so a DuckDB page error or a compile refusal would
                otherwise leave a stale grid with no explanation anywhere on
                screen. */}
            {view.message !== null && !filterOpen && (
              <div className="table-message" role="alert">
                {view.message}
              </div>
            )}
            <DataGrid
              columns={view.columns}
              rows={view.rows}
              sort={query?.sort ?? null}
              selectedIds={selectedIds}
              emptyMessage={emptyGridMessage(
                (query?.applied ?? null) !== null,
                query?.syncToMap ?? false,
                view.unfilteredRows,
              )}
              onSort={(column) => {
                if (layerId !== null) {
                  useQueryStore.getState().toggleSort(layerId, column);
                }
              }}
              onRowClick={handleRowClick}
            />
          </>
        )}
      </div>

      {view.status === "ready" && query !== null && layerId !== null && (
        <Pagination
          page={query.page}
          pageSize={query.pageSize}
          totalRows={view.totalRows}
          unfilteredRows={view.unfilteredRows}
          filtered={query.applied !== null}
          onPage={(page) => useQueryStore.getState().setPage(layerId, page)}
          onPageSize={(size) =>
            useQueryStore.getState().setPageSize(layerId, size)
          }
        />
      )}
    </div>
  );
}

function TableResizeHandle({
  onHeightChange,
}: {
  readonly onHeightChange: (height: number) => void;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const panel = (e.target as HTMLElement).closest(
        ".table-panel",
      ) as HTMLElement | null;
      if (!panel) return;
      const startHeight = panel.getBoundingClientRect().height;

      const onMouseMove = (me: MouseEvent) => {
        const delta = startY - me.clientY;
        onHeightChange(
          Math.max(
            MIN_TABLE_HEIGHT,
            Math.min(startHeight + delta, MAX_TABLE_HEIGHT),
          ),
        );
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onHeightChange],
  );

  return <div className="table-resize-handle" onMouseDown={handleMouseDown} />;
}
