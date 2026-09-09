import { ColumnsPanel } from "./ColumnsPanel";
import { columnLabel } from "../drawer/columnPolicy";
import { orderedColumns, moveColumn } from "./columnOrder";
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

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { DuckDBStatus } from "../../insights/duckdb";
import { useLayerTableStore } from "../../insights/layerTables";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import {
  useActiveCityLayer,
  useActiveLayer,
} from "../../features/workspace/activeLayer";
import { epsgOf } from "../../features/layers/layerPresentation";
import type { Selection } from "../../domain/selection/types";
import { ResizeHandle } from "../shell/ResizeHandle";
import { SHELL_LIMITS, useShellStore } from "../shell/shellStore";
import { SummaryView } from "../drawer/SummaryView";
import { DataGrid } from "./DataGrid";
import { ExportDialog } from "./ExportDialog";
import { FilterBar } from "./FilterBar";
import { Pagination } from "./Pagination";
import { GeoRecordsPanel } from "./GeoRecordsPanel";
import { geoRecords } from "../../features/geoLayers/geoRecords";
// ONE pinned `en-US` formatter for the whole panel, and the empty-grid
// sentences — see tableText.ts for why they do not live in a component.
import { emptyGridMessage, formatCount } from "./tableText";
import { useLayerQuery } from "./useLayerQuery";
import { derivedBuildingValues } from "../drawer/derivedBuildingColumns";
import { defaultColumns, derivedColumns } from "../drawer/columnPolicy";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { useLayerCounts } from "./useLayerCounts";

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
  const active = useActiveLayer();
  const activeLayer = useActiveCityLayer();
  const activeGeoLayer = active?.kind === "geo" ? active.layer : null;
  const geoRecordCount =
    activeGeoLayer?.kind === "geojson"
      ? geoRecords(activeGeoLayer.config.preparedData).length
      : null;
  const layerId = activeLayer?.id ?? null;

  const view = useLayerQuery(layerId);
  const layerCounts = useLayerCounts(layerId);
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );
  const sceneSelections = useSelectionStore((s) => s.selections);
  const streamVersion = useStreamStore((state) =>
    layerId === null ? undefined : state.streams[layerId]?.version,
  );

  const drawerHeight = useShellStore((state) => state.drawerHeight);
  const drawerExpanded = useShellStore((state) => state.drawerExpanded);
  const drawerMax = Math.max(
    SHELL_LIMITS.drawerMin,
    Math.min(
      SHELL_LIMITS.drawerMax,
      (typeof window === "undefined" ? 900 : window.innerHeight) - 200,
    ),
  );

  const summaryOpen = query?.drawerTab === "summary";
  const setSummaryOpen = (open: boolean) => {
    if (layerId !== null)
      useQueryStore
        .getState()
        .setDrawerTab(layerId, open ? "summary" : "records");
  };
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsButtonRef = useRef<HTMLButtonElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // The dialog is about ONE layer — its table, its types, its LoD ladder — and
  // the layer under it can change while it is open (the sidebar is live). It
  // closes rather than silently re-pointing at a different layer's data.
  useEffect(() => {
    setExportOpen(false);
    setColumnsOpen(false);
  }, [active?.layer.id]);

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
  //
  // There is ONE selection. The panel used to offer a "Sync selection"
  // checkbox that, switched off, gave the grid a second selection of its own:
  // a row highlighted here, an object highlighted in the viewport, and no way
  // for the user to know which of the two the inspector was describing. It
  // also died with the component, so collapsing the panel silently discarded
  // whatever had been picked in it.
  const partsById = useMemo(() => {
    if (activeLayer === null) return {};
    const objects = activeLayer.isStreaming
      ? getResidentModel(activeLayer.id, streamVersion ?? 0).objects
      : activeLayer.model.objects;
    return Object.fromEntries(
      Object.values(objects).map((object) => [object.id, object.children]),
    );
  }, [activeLayer, streamVersion]);

  const partRows = useMemo(() => {
    const pageRows = Object.fromEntries(
      view.rows
        .filter(
          (row): row is Record<string, unknown> & { id: string } =>
            typeof row.id === "string",
        )
        .map((row) => [row.id, row]),
    );
    if (activeLayer === null) return pageRows;
    const objects = activeLayer.isStreaming
      ? getResidentModel(activeLayer.id, streamVersion ?? 0).objects
      : activeLayer.model.objects;
    for (const object of Object.values(objects)) {
      pageRows[object.id] ??= {
        id: object.id,
        object_type: object.objectType,
        ...object.attributes,
      };
    }
    return pageRows;
  }, [activeLayer, streamVersion, view.rows]);

  const selectedIds = useMemo(
    () =>
      new Set(
        sceneSelections
          .filter((s) => s.layerId === layerId)
          .map((s) => s.objectId),
      ),
    [sceneSelections, layerId],
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

  const derivedKeys = useMemo(
    () => derivedColumns(view.columns),
    [view.columns],
  );
  const derivedRows = useMemo(
    () =>
      view.rows.map((row) => {
        const id = typeof row.id === "string" ? row.id : null;
        if (query?.view === "raw" || id === null || activeLayer === null)
          return row;
        const objects = activeLayer.isStreaming
          ? getResidentModel(activeLayer.id, streamVersion ?? 0).objects
          : activeLayer.model.objects;
        const values = derivedBuildingValues(id, objects);
        return {
          ...row,
          [derivedKeys[0]!.name]: values.roofArea,
          [derivedKeys[1]!.name]: values.meanSlope,
          [derivedKeys[2]!.name]: values.parts,
        };
      }),
    [activeLayer, derivedKeys, query?.view, streamVersion, view.rows],
  );

  const selectableColumns = useMemo(
    () => [
      ...view.columns.filter((column) => column.kind !== "blob"),
      ...derivedKeys,
    ],
    [derivedKeys, view.columns],
  );

  const visibleColumns = useMemo(() => {
    if (!query?.columns)
      return defaultColumns(view.columns, query?.view ?? "buildings");
    return orderedColumns(selectableColumns, query.columns);
  }, [query?.columns, query?.view, selectableColumns, view.columns]);

  const reorderColumn = useCallback(
    (source: string, target: string) => {
      if (layerId === null) return;
      useQueryStore.getState().setColumns(
        layerId,
        moveColumn(
          visibleColumns.map((column) => column.name),
          source,
          target,
        ),
      );
    },
    [layerId, visibleColumns],
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
        current={drawerHeight}
        min={SHELL_LIMITS.drawerMin}
        max={drawerMax}
        direction={-1}
        onResize={(height) => useShellStore.getState().setDrawerHeight(height)}
      />

      {query?.rawObjectId !== null && query?.rawObjectId !== undefined && (
        <div className="table-raw-target" role="status">
          <span>Viewing raw object {query.rawObjectId}</span>
          <button
            type="button"
            onClick={() => useQueryStore.getState().clearRawObject(layerId!)}
          >
            Return to filtered records
          </button>
        </div>
      )}
      <div className="table-panel-header">
        <span className="table-panel-title">
          {activeLayer?.name ?? activeGeoLayer?.name ?? "Objects"}
          {geoRecordCount !== null && (
            <span className="table-count">
              {" "}
              ({formatCount(geoRecordCount)} features)
            </span>
          )}
          {view.status === "ready" && layerCounts.all !== null && (
            /* The LAYER's size, not the filtered count: a heading number that
               silently changes meaning when a filter is applied is how a user
               comes to believe a filter deleted their data. How much matched
               is the footer's job, beside the range it belongs to. */
            <span
              className="table-count"
              title={`All ${query?.view === "raw" ? "objects" : "buildings"}, before any filter`}
            >
              {" "}
              All {formatCount(layerCounts.all)} · Matching{" "}
              {layerCounts.matching === null
                ? "?"
                : formatCount(layerCounts.matching)}{" "}
              · Selected{" "}
              {layerCounts.selected === null
                ? "?"
                : formatCount(layerCounts.selected)}{" "}
              {query?.view === "raw" ? "objects" : "buildings"}
              {activeLayer?.isStreaming ? " · currently loaded" : ""}
            </span>
          )}
        </span>

        <span
          className="table-sync-label"
          title={
            activeLayer?.isStreaming
              ? STREAMING_FILTER_REASON
              : "Filters update the map and table together"
          }
        >
          {activeLayer?.isStreaming
            ? "Table only · currently loaded"
            : "Map + table"}
        </span>
      </div>
      <div
        className="table-panel-actions"
        role="toolbar"
        aria-label="Table actions"
      >
        {activeLayer !== null && (
          <>
            <button
              type="button"
              className="tb-btn table-action-btn"
              ref={columnsButtonRef}
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((open) => !open)}
              disabled={view.status !== "ready"}
            >
              Columns
            </button>
            {columnsOpen && layerId !== null && (
              <ColumnsPanel
                anchorRef={columnsButtonRef}
                columns={selectableColumns}
                visible={visibleColumns}
                label={(name) =>
                  derivedKeys.some((key) => key.name === name)
                    ? columnLabel(name)
                    : name
                }
                onChange={(names) =>
                  useQueryStore.getState().setColumns(layerId, names)
                }
                onMove={reorderColumn}
                onClose={() => {
                  setColumnsOpen(false);
                  columnsButtonRef.current?.focus();
                }}
              />
            )}

            <button
              type="button"
              className="tb-btn table-action-btn"
              disabled={view.status !== "ready"}
              onClick={() => setExportOpen(true)}
            >
              Export
            </button>
          </>
        )}
        <button
          type="button"
          className="tb-btn table-action-btn"
          onClick={() =>
            useShellStore.getState().setDrawerExpanded(!drawerExpanded)
          }
        >
          {drawerExpanded ? "Show map" : "Expand"}
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

      {activeLayer !== null && (
        <div
          className="data-drawer-tabs"
          role="tablist"
          aria-label="Drawer view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!summaryOpen}
            className="data-drawer-tab"
            onClick={() => setSummaryOpen(false)}
          >
            Records
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={summaryOpen}
            className="data-drawer-tab"
            onClick={() => setSummaryOpen(true)}
          >
            Summary
          </button>
          {layerId !== null && (
            <button
              type="button"
              className="tb-btn table-action-btn"
              onClick={() =>
                useQueryStore
                  .getState()
                  .setView(layerId, query?.view === "raw" ? "buildings" : "raw")
              }
            >
              {query?.view === "raw" ? "Buildings" : "Raw objects"}
            </button>
          )}
          {layerId !== null && (
            <label className="table-sync-label">
              <input
                type="checkbox"
                checked={query?.showSelectedOnly ?? false}
                onChange={(e) =>
                  useQueryStore
                    .getState()
                    .setShowSelectedOnly(layerId, e.target.checked)
                }
              />{" "}
              Show selected records
            </label>
          )}
        </div>
      )}

      {summaryOpen && activeLayer !== null ? (
        <SummaryView layer={activeLayer} query={query} table={view.table} />
      ) : (
        <>
          {view.status === "ready" && query !== null && layerId !== null && (
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
            {activeGeoLayer !== null ? (
              activeGeoLayer.kind === "geojson" ? (
                <GeoRecordsPanel
                  key={activeGeoLayer.id}
                  layer={activeGeoLayer}
                />
              ) : (
                <div className="table-message">
                  This layer has no browsable vector records.
                </div>
              )
            ) : duckdbStatus.state === "initializing" ? (
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
                {view.message !== null && pageError && (
                  <div className="table-message" role="alert">
                    {view.message}
                  </div>
                )}
                {!pageError && (
                  <DataGrid
                    columns={visibleColumns}
                    rows={derivedRows}
                    sort={query?.sort ?? null}
                    selectedIds={selectedIds}
                    partsById={partsById}
                    partRows={partRows}
                    derivedColumnNames={
                      new Set(derivedKeys.map((column) => column.name))
                    }
                    emptyMessage={emptyGridMessage(
                      (query?.applied ?? null) !== null,
                      activeLayer?.isStreaming !== true,
                      view.unfilteredRows,
                    )}
                    onSort={handleSort}
                    onReorder={reorderColumn}
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
        </>
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
