/**
 * One page of one layer's DuckDB table, kept in step with `queryStore`.
 *
 * The generation counter is the whole reason this is a hook and not three
 * effects: a filter change, a sort click and a page step can be in flight at
 * once, and DuckDB answers in whatever order it finishes. Without the counter
 * a slow first page overwrites a fast second one and the grid shows a page the
 * footer says it is not on.
 *
 * The filter is compiled BEFORE anything is sent, so a condition naming a
 * column the table does not have is a sentence in the bar rather than a bind
 * error in the console.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { runQuery } from "../../analytics/duckdb";
import type { ColumnInfo } from "../../analytics/columnKind";
import {
  useLayerTableStore,
  type LayerTable,
} from "../../analytics/layerTables";
import {
  buildCountSql,
  buildPageSql,
  compileFilter,
  gridColumns,
} from "../../analytics/sql";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";

export interface LayerQueryView {
  /** `"no-layer"` means NOTHING is selected. A selected layer whose registry
   *  entry has not been written yet is `"queued"`, never `"no-layer"`. */
  readonly status: "no-layer" | "queued" | "building" | "failed" | "ready";
  readonly message: string | null;
  readonly table: LayerTable | null;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly totalRows: number;
  readonly unfilteredRows: number;
  readonly loading: boolean;
  readonly reload: () => void;
}

const NO_ROWS: ReadonlyArray<Record<string, unknown>> = [];
const NO_COLUMNS: ReadonlyArray<ColumnInfo> = [];

function countOf(rows: ReadonlyArray<Record<string, unknown>>): number {
  const n = rows[0]?.n;
  return typeof n === "number" ? n : Number(n) || 0;
}

export function useLayerQuery(layerId: string | null): LayerQueryView {
  const tableState = useLayerTableStore((s) =>
    layerId === null ? undefined : s.tables[layerId],
  );
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );

  const [rows, setRows] =
    useState<ReadonlyArray<Record<string, unknown>>>(NO_ROWS);
  const [totalRows, setTotalRows] = useState(0);
  const [unfilteredRows, setUnfilteredRows] = useState(0);
  const [queryMessage, setQueryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const table = tableState?.state === "ready" ? tableState.info : null;
  const applied = query?.applied ?? null;
  const sort = query?.sort ?? null;
  const page = query?.page ?? 0;
  const pageSize = query?.pageSize ?? 100;

  useEffect(() => {
    if (table === null) {
      setRows(NO_ROWS);
      setTotalRows(0);
      setUnfilteredRows(0);
      setQueryMessage(null);
      return;
    }

    // Bumped FIRST, before any early return: a page query from the previous
    // effect run may still be in flight, and if this run bails on a compile
    // refusal without invalidating it, that older answer lands afterwards and
    // replaces the rows with a page the refused filter never asked for.
    const gen = ++generation.current;

    const compiled =
      applied === null
        ? ({ ok: true, where: null } as const)
        : compileFilter(applied, table.columns);
    if (!compiled.ok) {
      // Refused before anything was sent: nothing to cancel, and the grid
      // keeps the page it is already showing rather than blanking.
      setQueryMessage(compiled.message);
      setLoading(false);
      return;
    }

    setLoading(true);
    setQueryMessage(null);

    void (async () => {
      const columns = gridColumns(table.columns);
      const [pageResult, filteredCount, totalCount] = await Promise.all([
        runQuery(
          buildPageSql(
            table.table,
            columns,
            compiled.where,
            sort,
            page,
            pageSize,
          ),
        ),
        runQuery(buildCountSql(table.table, compiled.where)),
        compiled.where === null
          ? Promise.resolve(null)
          : runQuery(buildCountSql(table.table, null)),
      ]);
      if (gen !== generation.current) return;

      if (!pageResult.ok) {
        setQueryMessage(pageResult.message);
        setRows(NO_ROWS);
        setLoading(false);
        return;
      }
      setRows(pageResult.rows);
      const filtered = filteredCount.ok ? countOf(filteredCount.rows) : 0;
      setTotalRows(filtered);
      setUnfilteredRows(
        totalCount === null
          ? filtered
          : totalCount.ok
            ? countOf(totalCount.rows)
            : filtered,
      );
      setLoading(false);
    })();
  }, [table, applied, sort, page, pageSize, reloadToken]);

  if (layerId === null) {
    return {
      status: "no-layer",
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState === undefined) {
    // A layer IS selected; its registry entry has simply not been written yet.
    // `addCityLayer` adds the layer and enqueues the table in that order, so
    // there is a commit in between where the registry has nothing — and
    // "Select a layer to browse its table" over a layer the user just dropped
    // is a lie that flashes on every single add.
    return {
      status: "queued",
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState.state === "failed") {
    return {
      status: "failed",
      message: tableState.message,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState.state !== "ready") {
    return {
      status: tableState.state,
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  return {
    status: "ready",
    message: queryMessage,
    table: tableState.info,
    columns: gridColumns(tableState.info.columns),
    rows,
    totalRows,
    unfilteredRows,
    loading,
    reload,
  };
}
