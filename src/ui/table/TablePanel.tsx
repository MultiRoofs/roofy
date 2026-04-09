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
import type { Selection } from "../../domain/selection/types";

const PAGE_SIZE = 100;

interface TablePanelProps {
  readonly duckdbTableLoaded: boolean;
  readonly onCollapse: () => void;
}

type SortDir = "asc" | "desc";

export function TablePanel({ duckdbTableLoaded, onCollapse }: TablePanelProps) {
  const [columns, setColumns] = useState<string[]>([]);
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

  // Determine the active selected IDs based on sync mode
  const selectedIds = syncSelection
    ? new Set(sceneSelections.map((s) => s.objectId))
    : tableSelection;

  // -----------------------------------------------------------------------
  // Data loading — DuckDB with in-memory fallback
  // -----------------------------------------------------------------------

  // Generation counter to discard stale async loads
  const loadGenRef = useRef(0);

  const loadPage = useCallback(
    async (page: number, reset: boolean) => {
      if (reset) pageRef.current = 0;
      const gen = ++loadGenRef.current;
      setLoading(true);

      try {
        const offset = page * PAGE_SIZE;

        if (duckdbTableLoaded) {
          // DuckDB path
          const orderClause = sortCol ? `ORDER BY "${sortCol}" ${sortDir}` : "";
          const result = await queryDuckDB(
            `SELECT * FROM city_objects ${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          );
          if (gen !== loadGenRef.current) return; // stale
          if (result) {
            if (reset || page === 0) {
              setColumns(result.columns);
              setRows(result.rows);
            } else {
              setRows((prev) => [...prev, ...result.rows]);
            }
            setHasMore(result.rows.length === PAGE_SIZE);
          } else {
            setHasMore(false);
          }
          // Get total count
          if (page === 0) {
            const countResult = await queryDuckDB(
              "SELECT COUNT(*) AS cnt FROM city_objects",
            );
            if (gen === loadGenRef.current && countResult?.rows[0]) {
              setTotalCount(Number(countResult.rows[0].cnt) || 0);
            }
          }
        } else if (activeLayer) {
          // In-memory fallback
          const allObjects = Object.values(activeLayer.model.objects).filter(
            Boolean,
          );
          if (gen !== loadGenRef.current) return; // stale
          if (page === 0) {
            setColumns(getColumnsFromModel(activeLayer.model));
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
    [duckdbTableLoaded, sortCol, sortDir, activeLayer],
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
      <TableResizeHandle />

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
              const rowId = String(row.id ?? i);
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

function TableResizeHandle() {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const shell = document.querySelector(".viewer-shell") as HTMLElement | null;
    if (!shell) return;
    const startHeight = parseInt(
      getComputedStyle(shell).getPropertyValue("--table-h") || "250",
      10,
    );

    const onMouseMove = (me: MouseEvent) => {
      const delta = startY - me.clientY;
      const newHeight = Math.max(100, Math.min(startHeight + delta, 600));
      shell.style.setProperty("--table-h", `${newHeight}px`);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

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

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
