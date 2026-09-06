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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuckDBStatus } from "../../insights/duckdb";
import { useLayerTableStore } from "../../insights/layerTables";
import { syncFilterToMap } from "../../features/query/mapFilterSync";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useActiveCityLayer } from "../../features/workspace/activeLayer";
import { extractCrsCode } from "../toolbar/crsCode";
import type { Selection } from "../../domain/selection/types";
import { ResizeHandle } from "../shell/ResizeHandle";
import { useShellStore } from "../shell/shellStore";
import { DataGrid } from "./DataGrid";
import { ExportDialog } from "./ExportDialog";
import { FilterBar } from "./FilterBar";
import { Pagination } from "./Pagination";
// ONE pinned `en-US` formatter for the whole panel, and the empty-grid
// sentences — see tableText.ts for why they do not live in a component.
import { emptyGridMessage, formatCount } from "./tableText";
import { useLayerQuery } from "./useLayerQuery";

const STREAMING_FILTER_REASON =
  "Map filtering is not available for streaming layers yet";

export interface TablePanelProps {
  readonly duckdbStatus: DuckDBStatus;
  readonly onRetryDuckDB: () => void;
}

/** The panel is the shell's drawer: its height and its own closing are
 *  `shellStore`'s state, not props — the height limits live there too
 *  (`SHELL_LIMITS`, clamped against the viewport). */
export function TablePanel({ duckdbStatus, onRetryDuckDB }: TablePanelProps) {
  // The workspace's one active layer, with no fallback to the first: a table
  // that quietly showed some OTHER layer's rows while the sidebar highlighted
  // a geo layer is exactly the disagreement this milestone removes.
  const activeLayer = useActiveCityLayer();
  const layerId = activeLayer?.id ?? null;

  const view = useLayerQuery(layerId);
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );
  const sceneSelections = useSelectionStore((s) => s.selections);

  /** The drawer height the current resize drag started from. */
  const dragOriginHeight = useRef(0);

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // The dialog is about ONE layer — its table, its types, its LoD ladder — and
  // the layer under it can change while it is open (the sidebar is live). It
  // closes rather than silently re-pointing at a different layer's data.
  useEffect(() => {
    setExportOpen(false);
  }, [layerId]);

  // The registry cannot see the UI, and a streaming layer's table is only
  // worth rebuilding while somebody is looking at it.
  useEffect(() => {
    useLayerTableStore.getState().setTablePanelOpen(true);
    return () => useLayerTableStore.getState().setTablePanelOpen(false);
  }, []);

  // The applied filter, the toggle and the table identity are the three things
  // that can change what the map should draw. Re-running on the TABLE object
  // (not just its name) is what clears a stale set after a rebuild.
  useEffect(() => {
    if (layerId === null) return;
    void syncFilterToMap(layerId);
  }, [layerId, query?.applied, query?.syncToMap, view.table]);

  // MEMOISED: a new Set on every render gives `DataGrid` a new prop identity,
  // which defeats the `React.memo` below — and this component re-renders on
  // every hover, every camera settle and every store touch, while the grid is
  // up to 1000 rows of DOM.
  //
  // There is ONE selection. The panel used to offer a "Sync selection"
  // checkbox that, switched off, gave the grid a second selection of its own:
  // a row highlighted here, an object highlighted in the viewport, and no way
  // for the user to know which of the two the inspector was describing. It
  // also died with the component, so collapsing the panel silently discarded
  // whatever had been picked in it.
  const selectedIds = useMemo(
    () => new Set(sceneSelections.map((s) => s.objectId)),
    [sceneSelections],
  );

  const handleRowClick = useCallback(
    (objectId: string, shiftKey: boolean) => {
      if (layerId === null) return;
      const store = useSelectionStore.getState();
      const sel: Selection = { kind: "object", layerId, objectId };
      if (shiftKey) store.toggleSelect(sel);
      else store.select(sel);
    },
    [layerId],
  );

  const handleUnselectAll = useCallback(
    () => useSelectionStore.getState().clear(),
    [],
  );

  // A CALLBACK, like `selectedIds` is a memo: an inline arrow is a new prop
  // identity every render, which is all it takes to defeat `DataGrid`'s memo.
  const handleSort = useCallback(
    (column: string) => {
      if (layerId !== null)
        useQueryStore.getState().toggleSort(layerId, column);
    },
    [layerId],
  );

  const engineDown =
    duckdbStatus.state === "failed" || duckdbStatus.state === "uninitialized";

  /**
   * The message explains an ABSENT grid, not a stale one.
   *
   * With rows still on screen a page error is an annotation over the last good
   * page. With none, it is the reason there is nothing — and `DataGrid` would
   * otherwise answer "This layer has no rows yet.", which turns an engine
   * failure into a claim about the data.
   */
  const pageError = view.message !== null && view.rows.length === 0;

  return (
    <div className="table-panel">
      {/* Dragging the top edge UP (a negative delta) makes the drawer
          taller — the drawer grows from its top. The delta is measured from
          pointerdown, so the height it is added to is the one the drag
          started from. */}
      <ResizeHandle
        axis="y"
        label="Resize table"
        onStart={() => {
          dragOriginHeight.current = useShellStore.getState().drawerHeight;
        }}
        onDelta={(dy) =>
          useShellStore
            .getState()
            .setDrawerHeight(dragOriginHeight.current - dy)
        }
      />

      <div className="table-panel-header">
        <span className="table-panel-title">
          {activeLayer?.name ?? "Objects"}
          {view.status === "ready" && view.unfilteredRows !== null && (
            /* The LAYER's size, not the filtered count: a heading number that
               silently changes meaning when a filter is applied is how a user
               comes to believe a filter deleted their data. How much matched
               is the footer's job, beside the range it belongs to. */
            <span
              className="table-count"
              title="Rows in this layer's table, before any filter"
            >
              {" "}
              ({formatCount(view.unfilteredRows)} rows)
            </span>
          )}
        </span>

        <label
          className="table-sync-label"
          title={activeLayer?.isStreaming ? STREAMING_FILTER_REASON : undefined}
        >
          <input
            type="checkbox"
            aria-label="Filter map"
            disabled={
              activeLayer === null ||
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
          type="button"
          className="tb-btn table-action-btn"
          disabled={view.status !== "ready"}
          onClick={() => setExportOpen(true)}
        >
          Export
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
          onClick={() => useShellStore.getState().closeDrawer()}
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
            // The body renders it instead when it is the reason the grid is
            // empty — see `pageError` — so it is never said twice.
            error={pageError ? null : view.message}
            disabled={view.loading}
            onChange={(filter) =>
              useQueryStore.getState().setFilter(layerId, filter)
            }
            onApply={() => useQueryStore.getState().applyFilter(layerId)}
            onClear={() => useQueryStore.getState().clearFilter(layerId)}
          />
        )}

      <div
        className={`table-panel-body ${view.loading ? "table-loading" : ""}`}
      >
        {duckdbStatus.state === "initializing" ? (
          /* BEFORE the table state, deliberately. A Retry sets the status back
             to `initializing` while every table is still `failed` from the
             outage, and "This layer's table could not be built" over a retry
             in progress reads as a Retry that did nothing. */
          <div className="table-message">
            <span className="loading-spinner" />
            <span>Starting the analytics engine…</span>
          </div>
        ) : engineDown ? (
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
            {view.message !== null && (pageError || !filterOpen) && (
              <div className="table-message" role="alert">
                {view.message}
              </div>
            )}
            {!pageError && (
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
                onSort={handleSort}
                onRowClick={handleRowClick}
              />
            )}
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

      {exportOpen && view.table !== null && activeLayer !== null && (
        <ExportDialog
          layerId={activeLayer.id}
          layerName={activeLayer.name}
          table={view.table}
          epsg={epsgOf(activeLayer.model.metadata.referenceSystem)}
          selectedLod={activeLayer.selectedLod}
          isStreaming={activeLayer.isStreaming}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

/** The layer's EPSG code as a number, or null. The CityParquet writer takes
 *  `crs => 'EPSG:NNNN'` and nothing else, so a layer whose reference system
 *  names no code cannot be written as a package. */
function epsgOf(referenceSystem: string | undefined): number | null {
  const code = extractCrsCode(referenceSystem);
  if (code === null) return null;
  const n = Number(code);
  return Number.isInteger(n) && n > 0 ? n : null;
}
