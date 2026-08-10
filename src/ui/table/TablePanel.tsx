/**
 * Bottom table panel showing city objects in a database-like view.
 *
 * Data source: DuckDB SQL queries with infinite scroll (LIMIT/OFFSET).
 * Falls back to in-memory CityModel when DuckDB is unavailable.
 * Supports column sorting, row selection, and optional scene sync.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CityModel, CityObject } from "../../domain/citymodel/types";
import { queryDuckDB } from "../../analytics/duckdb";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { Selection } from "../../domain/selection/types";

const PAGE_SIZE = 100;

interface TablePanelProps {
  readonly duckdbTableLoaded: boolean;
  readonly onCollapse: () => void;
  readonly onHeightChange: (height: number) => void;
}

type SortDir = "asc" | "desc";

export function TablePanel({
  duckdbTableLoaded,
  onCollapse,
  onHeightChange,
}: TablePanelProps) {
  const [columns, setColumns] = useState<string[]>([]);
  /**
   * Mirror of `columns` for `loadPage`'s SQL guard. `columns` cannot be a
   * dependency of that callback: every load calls `setColumns` with a fresh
   * array, which would give the callback a new identity, which the reload
   * effect below would treat as a data-source change — an endless query loop.
   * The ref is written at the same instant as the state, so the guard reads a
   * value at least as fresh as a dependency would have given it.
   */
  const columnsRef = useRef<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncSelection, setSyncSelection] = useState(true);
  const [tableSelection, setTableSelection] = useState<Set<string>>(new Set());
  const pageRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const sceneSelections = useSelectionStore((s) => s.selections);
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];

  // Only meaningful (and only subscribed) for a streaming active layer —
  // bumps on every cell commit, which is what drives loadPage to re-read
  // the merged resident model below.
  const streamVersion = useStreamStore((s) =>
    activeLayer ? s.streams[activeLayer.id]?.version : undefined,
  );

  // Determine the active selected IDs based on sync mode
  const selectedIds = syncSelection
    ? new Set(sceneSelections.map((s) => s.objectId))
    : tableSelection;

  // -----------------------------------------------------------------------
  // Data loading — DuckDB with in-memory fallback
  // -----------------------------------------------------------------------

  // Generation counter to discard stale async loads
  const loadGenRef = useRef(0);

  /** Every write to `columns` goes through here, so the ref cannot drift. */
  const applyColumns = useCallback((next: string[]) => {
    columnsRef.current = next;
    setColumns(next);
  }, []);

  const loadPage = useCallback(
    async (page: number, reset: boolean) => {
      if (reset) pageRef.current = 0;
      const gen = ++loadGenRef.current;
      setLoading(true);

      try {
        const offset = page * PAGE_SIZE;

        if (duckdbTableLoaded) {
          // DuckDB path — fetch data and count in parallel to avoid
          // generation counter race (count was discarded if a re-render
          // triggered another loadPage before the count query finished)
          const safeCol =
            sortCol && columnsRef.current.includes(sortCol)
              ? sortCol.replace(/"/g, '""')
              : null;
          const orderClause = safeCol ? `ORDER BY "${safeCol}" ${sortDir}` : "";
          const [result, countResult] = await Promise.all([
            queryDuckDB(
              `SELECT * FROM city_objects ${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            ),
            page === 0
              ? queryDuckDB("SELECT COUNT(*) AS cnt FROM city_objects")
              : null,
          ]);
          if (gen !== loadGenRef.current) return; // stale
          if (result) {
            if (reset || page === 0) {
              applyColumns(result.columns);
              setRows(result.rows);
            } else {
              setRows((prev) => [...prev, ...result.rows]);
            }
            setHasMore(result.rows.length === PAGE_SIZE);
          } else {
            setHasMore(false);
          }
          if (countResult?.rows[0]) {
            setTotalCount(Number(countResult.rows[0].cnt) || 0);
          }
        } else if (activeLayer?.isStreaming) {
          // Streaming layer, no DuckDB table: read whatever cells are
          // currently resident via the memoised merge instead of a
          // `CityModel` — a streaming layer never has one populated with
          // real objects (see residentModel.ts's doc comment on why this
          // isn't a Zustand selector).
          const residentModel = getResidentModel(
            activeLayer.id,
            streamVersion ?? 0,
          );
          const allRecords = Object.values(residentModel.objects);
          if (gen !== loadGenRef.current) return; // stale
          if (page === 0) {
            applyColumns(getColumnsFromRecords(allRecords));
            setTotalCount(allRecords.length);
          }

          const sorted = sortRecordsInMemory(allRecords, sortCol, sortDir);
          const pageRows = sorted
            .slice(offset, offset + PAGE_SIZE)
            .map(recordToRow);

          if (reset || page === 0) {
            setRows(pageRows);
          } else {
            setRows((prev) => [...prev, ...pageRows]);
          }
          setHasMore(offset + PAGE_SIZE < sorted.length);
        } else if (activeLayer) {
          // In-memory fallback
          const allObjects = Object.values(activeLayer.model.objects).filter(
            Boolean,
          );
          if (gen !== loadGenRef.current) return; // stale
          if (page === 0) {
            applyColumns(getColumnsFromModel(activeLayer.model));
            setTotalCount(allObjects.length);
          }

          const sorted = sortInMemory(allObjects, sortCol, sortDir);
          const pageRows = sorted
            .slice(offset, offset + PAGE_SIZE)
            .map(objectToRow);

          if (reset || page === 0) {
            setRows(pageRows);
          } else {
            setRows((prev) => [...prev, ...pageRows]);
          }
          setHasMore(offset + PAGE_SIZE < sorted.length);
        } else {
          setHasMore(false);
        }
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    },
    [
      duckdbTableLoaded,
      sortCol,
      sortDir,
      activeLayer,
      streamVersion,
      applyColumns,
    ],
  );

  // Reload on sort change or data source change
  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          pageRef.current += 1;
          void loadPage(pageRef.current, false);
        }
      },
      { root: bodyRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadPage]);

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir("asc");
      }
    },
    [sortCol],
  );

  // -----------------------------------------------------------------------
  // Row selection
  // -----------------------------------------------------------------------

  const handleRowClick = useCallback(
    (objectId: string, shiftKey: boolean) => {
      if (syncSelection) {
        const store = useSelectionStore.getState();
        const layerId = activeLayer?.id;
        if (!layerId) return;
        const sel: Selection = { kind: "object", layerId, objectId };
        if (shiftKey) {
          store.toggleSelect(sel);
        } else {
          store.select(sel);
        }
      } else {
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
      }
    },
    [syncSelection, activeLayer],
  );

  const handleUnselectAll = useCallback(() => {
    if (syncSelection) {
      useSelectionStore.getState().clear();
    } else {
      setTableSelection(new Set());
    }
  }, [syncSelection]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="table-panel">
      {/* Drag handle at top edge */}
      <TableResizeHandle onHeightChange={onHeightChange} />

      <div className="table-panel-header">
        <span className="table-panel-title">
          Objects{" "}
          <span className="table-count">
            ({totalCount.toLocaleString()} rows)
          </span>
        </span>

        <label className="table-sync-label">
          <input
            type="checkbox"
            checked={syncSelection}
            onChange={(e) => setSyncSelection(e.target.checked)}
          />
          <span>Sync scene</span>
        </label>

        <button
          className="tb-btn table-action-btn"
          title="Unselect all"
          onClick={handleUnselectAll}
        >
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span>Clear</span>
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

      <div className="table-panel-body" ref={bodyRef}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className={`data-th ${sortCol === col ? "sorted" : ""}`}
                  onClick={() => handleSort(col)}
                  aria-sort={
                    sortCol === col
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <span>{col}</span>
                  {sortCol === col && (
                    <span className="sort-indicator">
                      {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowId = stringifyValue(row.id ?? i);
              const isSelected = selectedIds.has(rowId);
              return (
                <tr
                  key={rowId}
                  className={`data-row ${isSelected ? "data-row-selected" : ""}`}
                  onClick={(e) => handleRowClick(rowId, e.shiftKey)}
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="data-td"
                      title={formatCell(row[col])}
                    >
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="scroll-sentinel">
          {loading && <span className="table-loading">Loading...</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resize handle (drag to change table height)
// ---------------------------------------------------------------------------

function TableResizeHandle({
  onHeightChange,
}: {
  onHeightChange: (height: number) => void;
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
        const newHeight = Math.max(100, Math.min(startHeight + delta, 600));
        onHeightChange(newHeight);
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

// ---------------------------------------------------------------------------
// In-memory helpers
// ---------------------------------------------------------------------------

function getColumnsFromModel(model: CityModel): string[] {
  const cols = ["id", "type", "lod", "surface_count"];
  const attrKeys = new Set<string>();
  for (const obj of Object.values(model.objects)) {
    if (!obj) continue;
    for (const key of Object.keys(obj.attributes)) {
      attrKeys.add(key);
    }
  }
  return [...cols, ...Array.from(attrKeys).sort()];
}

function objectToRow(obj: CityObject): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: obj.id,
    type: obj.objectType,
    lod: obj.lod,
    surface_count: obj.surfaces.length,
  };
  for (const [key, value] of Object.entries(obj.attributes)) {
    row[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : value;
  }
  return row;
}

function sortInMemory(
  objects: CityObject[],
  sortCol: string | null,
  sortDir: SortDir,
): CityObject[] {
  if (!sortCol) return objects;

  return [...objects].sort((a, b) => {
    const av = getObjectValue(a, sortCol);
    const bv = getObjectValue(b, sortCol);
    const cmp = compareValues(av, bv);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function getObjectValue(obj: CityObject, col: string): unknown {
  if (col === "id") return obj.id;
  if (col === "type") return obj.objectType;
  if (col === "lod") return obj.lod;
  if (col === "surface_count") return obj.surfaces.length;
  return obj.attributes[col];
}

// ---------------------------------------------------------------------------
// Streaming (ResidentObjectRecord) helpers — mirror the in-memory helpers
// above field-for-field, but read `surface_count` from `r.surfaceCount`
// instead of `surfaces.length`, since a ResidentObjectRecord never carries
// a `surfaces` array (see `@cityjson/navara-flatcitybuf`'s workerProtocol.ts for why).
// ---------------------------------------------------------------------------

function getColumnsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): string[] {
  const cols = ["id", "type", "lod", "surface_count"];
  const attrKeys = new Set<string>();
  for (const r of records) {
    for (const key of Object.keys(r.attributes)) {
      attrKeys.add(key);
    }
  }
  return [...cols, ...Array.from(attrKeys).sort()];
}

function recordToRow(r: ResidentObjectRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: r.id,
    type: r.objectType,
    lod: r.lod,
    surface_count: r.surfaceCount,
  };
  for (const [key, value] of Object.entries(r.attributes)) {
    row[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : value;
  }
  return row;
}

function sortRecordsInMemory(
  records: ReadonlyArray<ResidentObjectRecord>,
  sortCol: string | null,
  sortDir: SortDir,
): ResidentObjectRecord[] {
  if (!sortCol) return [...records];

  return [...records].sort((a, b) => {
    const av = getRecordValue(a, sortCol);
    const bv = getRecordValue(b, sortCol);
    const cmp = compareValues(av, bv);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function getRecordValue(r: ResidentObjectRecord, col: string): unknown {
  if (col === "id") return r.id;
  if (col === "type") return r.objectType;
  if (col === "lod") return r.lod;
  if (col === "surface_count") return r.surfaceCount;
  return r.attributes[col];
}

/**
 * A cell value as text. `String(unknown)` is not good enough: an attribute
 * value straight out of DuckDB or a CityJSON file can be a plain object, which
 * `String` renders as the useless "[object Object]" \u2014 a row would sort and
 * display identically for every distinct object. Every branch narrows first,
 * so `String` only ever sees a primitive.
 */
function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value) ?? "";
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return stringifyValue(a).localeCompare(stringifyValue(b));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return stringifyValue(value);
}
