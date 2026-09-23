import {
  createCandidateLoader,
  type CandidateLoader,
} from "../../insights/filterCandidates";
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnStatsLoader,
  type ColumnStatsLoader,
} from "../../insights/columnStats";
import { runQuery } from "../../insights/duckdb";
import type { ColumnInfo } from "../../insights/columnKind";
import {
  layerTableKey,
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import {
  useActiveFamily,
  useFamilyTableState,
} from "../../features/layers/familyStore";
import {
  buildCountSql,
  buildFeatureScopeWhere,
  buildPageSql,
  compileFilter,
  gridColumns,
  quoteLiteral,
} from "../../insights/sql";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useLayerStore } from "../../features/layers/layerStore";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../domain/citymodel/featureId";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface LayerQueryView {
  /**
   * `"no-layer"` means NOTHING is selected. A selected layer whose registry
   * entry has not been written yet is `"queued"`, never `"no-layer"`.
   *
   * `"absent"` is a CityParquet family whose view has never been created (or
   * whose creation failed): nothing is building, so a spinner would never
   * resolve, and nothing is wrong with the data either — the panel offers to
   * load it. Every other layer's table is enqueued the moment the layer lands,
   * so it can never be absent.
   */
  readonly status:
    | "no-layer"
    | "queued"
    | "absent"
    | "building"
    | "failed"
    | "ready";
  /** A build failure, a compile refusal, or DuckDB's own message — from the
   *  page query OR from a COUNT that failed on its own. */
  readonly message: string | null;
  readonly table: LayerTable | null;
  /** The columns the grid renders, blobs already dropped. Referentially
   *  STABLE while the table's own column list is, because `DataGrid` is
   *  memoised and a fresh array every render would defeat it. */
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /**
   * Rows matching the applied filter, or `null` when the COUNT could not be
   * taken.
   *
   * NULL rather than 0, for the same reason `LayerTable.rowCount` is: the
   * count is a SEPARATE statement from the page query, so it can fail while
   * real rows are on screen, and "0 rows" under a full grid is a plain
   * contradiction. The footer renders an unknown total as "of ?".
   */
  readonly totalRows: number | null;
  /** Rows in the table, filter or no filter. Same provenance, same `null`. */
  readonly unfilteredRows: number | null;
  readonly loading: boolean;
  readonly reload: () => void;
  readonly getColumnStats?: ColumnStatsLoader;
  readonly getCandidates?: CandidateLoader;
}

const NO_ROWS: ReadonlyArray<Record<string, unknown>> = [];
const NO_COLUMNS: ReadonlyArray<ColumnInfo> = [];

function countOf(rows: ReadonlyArray<Record<string, unknown>>): number {
  const n = rows[0]?.n;
  return typeof n === "number" ? n : Number(n) || 0;
}

export function useLayerQuery(layerId: string | null): LayerQueryView {
  // Ruling S3: a CityParquet layer's rows live in its ACTIVE family's view, under
  // the composite key. `null` — every other layer — is the bare key this hook has
  // always read.
  const family = useActiveFamily(layerId);
  // The FAMILY's own table state, which is the only thing that can tell an
  // uncreated view (`absent`) from a table the lifecycle has queued.
  const familyTable = useFamilyTableState(layerId, family);
  // ONE key for the table and its query state (R-C′): two families are two
  // tables with two column lists, so a sort or a predicate belongs to the family
  // it was written against, not to the layer.
  const queryKey = layerId === null ? null : layerTableKey(layerId, family);
  const tableState = useLayerTableStore((s) =>
    queryKey === null ? undefined : s.tables[queryKey],
  );
  const query = useQueryStore((s) =>
    queryKey === null ? null : layerQuery(s, queryKey),
  );
  const selections = useSelectionStore((s) => s.selections);
  const layer = useLayerStore((s) =>
    layerId === null
      ? null
      : (s.layers.find((candidate) => candidate.id === layerId) ?? null),
  );
  const streamVersion = useStreamStore((s) =>
    layerId === null ? undefined : s.streams[layerId]?.version,
  );

  const [rows, setRows] =
    useState<ReadonlyArray<Record<string, unknown>>>(NO_ROWS);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [unfilteredRows, setUnfilteredRows] = useState<number | null>(null);
  const [queryMessage, setQueryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
  /** Which TABLE the rows on screen came from — the layer AND its family (see
   *  the reset in the effect): switching family changes the columns under the
   *  rows exactly as switching layer does. */
  const shownLayer = useRef<string | null>(null);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const table = tableState?.state === "ready" ? tableState.info : null;
  const applied = query?.applied ?? null;
  const sort = query?.sort ?? null;
  const page = query?.page ?? 0;
  const pageSize = query?.pageSize ?? 20;
  const viewMode = query?.view ?? "buildings";
  const showSelectedOnly = query?.showSelectedOnly ?? false;
  const rawObjectId = query?.rawObjectId ?? null;
  const selectedIds = selections
    .filter((selection) => selection.layerId === layerId)
    .map((selection) => selection.objectId);
  const selectedFeatureIds = useMemo(() => {
    if (viewMode !== "buildings" || layer === null) return selectedIds;
    const objects = layer.isStreaming
      ? getResidentModel(layer.id, streamVersion ?? 0).objects
      : layer.model.objects;
    const parents = parentsIndexOf(objects);
    return selectedIds.map((id) => rootFeatureId(id, parents));
  }, [layer, selectedIds.join("\u0000"), streamVersion, viewMode]);

  /**
   * MEMOISED on the table's own column list.
   *
   * `gridColumns` filters, so it returns a fresh array every call — and this
   * value is a prop of the memoised `DataGrid`, which would then re-render up
   * to 1000 rows of DOM on every keystroke in the filter bar.
   */
  const tableColumns = table?.columns ?? null;
  const columns = useMemo(
    () => (tableColumns === null ? NO_COLUMNS : gridColumns(tableColumns)),
    [tableColumns],
  );

  const scope = useMemo(() => {
    if (!table) return { error: null, where: null, unfilteredWhere: null };
    const compiled =
      applied === null
        ? ({ ok: true, where: null } as const)
        : compileFilter(applied, table.columns);
    if (!compiled.ok) {
      // Refused before anything was sent: nothing to cancel, and the grid
      // keeps the page it is already showing rather than blanking.
      return { error: compiled.message, where: null, unfilteredWhere: null };
    }

    const rootBuildings = '"parents" IS NULL AND "object_type" = \'Building\'';
    const filteredWhere =
      viewMode === "buildings"
        ? buildFeatureScopeWhere(table.table, compiled.where)
        : compiled.where;
    const terms: string[] = [];
    if (rawObjectId !== null) {
      // Details may target a child outside the current filter. This is a
      // temporary record scope only; it never changes `applied` or map membership.
      terms.push(`"id" = ${quoteLiteral(rawObjectId)}`);
    } else if (filteredWhere !== null) terms.push(`(${filteredWhere})`);
    // Buildings is intentionally semantic roots only.  A table without
    // Buildings remains useful through Raw objects rather than lying about a
    // count of every parentless object.
    if (viewMode === "buildings" && rawObjectId === null)
      terms.push(rootBuildings);
    if (showSelectedOnly && rawObjectId === null) {
      const ids = [...new Set(selectedFeatureIds)];
      terms.push(
        ids.length === 0
          ? "FALSE"
          : viewMode === "buildings"
            ? `COALESCE("feature_id", "id") IN (${ids.map(quoteLiteral).join(", ")})`
            : `"id" IN (${ids.map(quoteLiteral).join(", ")})`,
      );
    }
    const scopedWhere = terms.length === 0 ? null : terms.join(" AND ");
    const unfilteredWhere = viewMode === "buildings" ? rootBuildings : null;
    return { error: null, where: scopedWhere, unfilteredWhere };
  }, [
    table,
    applied,
    viewMode,
    rawObjectId,
    showSelectedOnly,
    selectedFeatureIds.join("\u0000"),
  ]);
  const getCandidates = useMemo(
    () =>
      table
        ? createCandidateLoader(table.table, table.columns, runQuery)
        : undefined,
    [table, reloadToken],
  );
  const getColumnStats = useMemo(
    () =>
      table && !scope.error
        ? createColumnStatsLoader(
            table.table,
            table.columns,
            scope.where,
            runQuery,
          )
        : undefined,
    [table, scope, reloadToken],
  );

  useEffect(() => {
    // Bumped FIRST, before EITHER early return: a page query from the previous
    // effect run may still be in flight, and a run that bails — on a compile
    // refusal, or because the table went away — without invalidating it would
    // let that older answer land afterwards and replace the rows with a page
    // nothing asked for.
    const gen = ++generation.current;

    // A DIFFERENT LAYER means the columns changed under the rows, and nothing
    // on screen belongs to what is now selected.
    //
    // Keyed on the layer id and NOT on the SQL table name, which was the
    // first attempt and was wrong in a way only a streaming layer shows: the
    // lifecycle rebuilds a streaming table on every camera settle while the
    // panel is open, and a rebuild mints a NEW `layer_<n>` (it builds the
    // replacement before retiring the old one, so the names cannot collide).
    // Keyed on the name, every settle therefore blanked the grid to "This
    // layer has no rows yet.", dropped the header count and flipped the
    // footer to "of ?" until the new page landed — several times a pan.
    //
    // A same-layer rebuild keeps the page and both counts on screen and only
    // raises `loading`, which dims the body: the previous page is still the
    // truthful answer to the same question, and it is replaced when the new
    // one lands rather than being withdrawn while nothing is ready to take
    // its place. A page step and a sort keep it for the same reason.
    if (shownLayer.current !== queryKey) {
      shownLayer.current = queryKey;
      setRows(NO_ROWS);
      setTotalRows(null);
      setUnfilteredRows(null);
    }

    if (table === null) {
      setQueryMessage(null);
      setLoading(false);
      return;
    }

    if (scope.error) {
      setQueryMessage(scope.error);
      setLoading(false);
      return;
    }
    const scopedWhere = scope.where;
    const unfilteredWhere = scope.unfilteredWhere;

    setLoading(true);
    setQueryMessage(null);

    void (async () => {
      const [pageResult, filteredCount, totalCount] = await Promise.all([
        runQuery(
          buildPageSql(
            table.table,
            gridColumns(table.columns),
            scopedWhere,
            sort,
            page,
            pageSize,
          ),
        ),
        runQuery(buildCountSql(table.table, scopedWhere)),
        scopedWhere === unfilteredWhere
          ? Promise.resolve(null)
          : runQuery(buildCountSql(table.table, unfilteredWhere)),
      ]);
      if (gen !== generation.current) return;

      if (!pageResult.ok) {
        setQueryMessage(pageResult.message);
        setRows(NO_ROWS);
        setTotalRows(null);
        setUnfilteredRows(null);
        setLoading(false);
        return;
      }
      // A COUNT that failed is an UNKNOWN total, never a zero — and it is
      // reported, because a footer quietly reading "of ?" is a symptom nobody
      // can act on without the engine's own sentence.
      const filtered = filteredCount.ok ? countOf(filteredCount.rows) : null;

      // CLAMP BEFORE PUBLISHING. The page index is stored per layer and
      // survives a rebuild that SHRINKS the table — a streaming layer whose
      // cells were dropped, a filter narrowed elsewhere — so a stored page 9
      // keeps asking for `OFFSET 900` of a 50-row table and the grid is empty
      // with a footer that says there are rows. Writing the clamp back to the
      // store re-runs this effect with a page that exists; publishing the empty
      // page first would flash "no rows" on the way there, so `loading` is left
      // raised and the rows are left alone until the real page lands. An
      // UNKNOWN total clamps nothing: there is no last page to clamp to.
      if (filtered !== null && queryKey !== null) {
        const lastPage = Math.max(0, Math.ceil(filtered / pageSize) - 1);
        if (page > lastPage) {
          useQueryStore.getState().setPage(queryKey, lastPage);
          return;
        }
      }

      setRows(pageResult.rows);
      setTotalRows(filtered);
      setUnfilteredRows(
        totalCount === null
          ? filtered
          : totalCount.ok
            ? countOf(totalCount.rows)
            : null,
      );
      setQueryMessage(
        !filteredCount.ok
          ? filteredCount.message
          : totalCount !== null && !totalCount.ok
            ? totalCount.message
            : null,
      );
      setLoading(false);
    })();
  }, [
    queryKey,
    table,
    applied,
    sort,
    page,
    pageSize,
    viewMode,
    showSelectedOnly,
    rawObjectId,
    selectedFeatureIds.join("\u0000"),
    reloadToken,
    scope,
  ]);

  if (layerId === null) {
    return {
      status: "no-layer",
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: null,
      unfilteredRows: null,
      loading: false,
      reload,
    };
  }
  if (tableState === undefined && familyTable !== null) {
    // A FAMILY with no view. Nothing is in flight unless the family says so, and
    // `absent`/`failed` is a state only the user can move — by asking for the
    // table (the panel's "Load table"), or by the family's own Retry.
    if (familyTable === "absent" || familyTable === "failed") {
      return {
        status: "absent",
        message:
          familyTable === "failed"
            ? "This family's table could not be created."
            : null,
        table: null,
        columns: NO_COLUMNS,
        rows: NO_ROWS,
        totalRows: null,
        unfilteredRows: null,
        loading: false,
        reload,
      };
    }
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
      totalRows: null,
      unfilteredRows: null,
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
      totalRows: null,
      unfilteredRows: null,
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
      totalRows: null,
      unfilteredRows: null,
      loading: false,
      reload,
    };
  }
  return {
    status: "ready",
    message: queryMessage,
    table: tableState.info,
    columns,
    rows,
    totalRows,
    unfilteredRows,
    loading,
    reload,
    getColumnStats,
    getCandidates,
  };
}
