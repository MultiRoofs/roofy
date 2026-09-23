import { normalizeTablePresentation } from "./tablePresentation";
/**
 * One {@link LayerQuery} per TABLE, session only.
 *
 * Keyed by the table's own key rather than held on the layer, because none of
 * it is layer DATA: a layer that is removed and re-added is a different table,
 * and `resetQuery` is what the table lifecycle calls when a rebuild invalidates
 * a predicate written against the old columns.
 *
 * THE KEY IS `familyStore.getActiveTableKey`'s — the bare layer id for a layer
 * with one table, `${layerId}::${family}` for a CityParquet object family
 * (R-C′). A family's query state is its own because a family is its own table
 * with its own column list: a sort on `bridge_name`, or a predicate compiled
 * against the bridge columns, says nothing about the building table. Every
 * caller resolves the key the same way, so the grid, the footer, the filter
 * chip and an export cannot end up describing different tables.
 *
 * Geo layers and every non-family city layer keep the bare id, so nothing about
 * them changed.
 */

import { create } from "zustand";
import {
  DEFAULT_LAYER_QUERY,
  EMPTY_FILTER,
  type FilterGroup,
  type LayerQuery,
  type PageSize,
} from "./types";

export interface QueryStoreState {
  readonly queries: Readonly<Record<string, LayerQuery>>;
}

export interface QueryStoreActions {
  restorePresentation: (key: string, value: unknown) => void;
  setDrawerTab: (key: string, tab: "records" | "summary") => void;
  setFilter: (key: string, filter: FilterGroup) => void;
  /** Draft -> applied, page back to 0. An EMPTY draft applies `null`, so
   *  "Apply" on a cleared bar means "no filter" rather than "a filter that
   *  matches everything" — the two differ for the map sync. */
  applyFilter: (key: string) => void;
  clearFilter: (key: string) => void;
  setSort: (key: string, sort: LayerQuery["sort"]) => void;
  /** Header click: same column flips direction, a new column starts asc. */
  toggleSort: (key: string, column: string) => void;
  setPage: (key: string, page: number) => void;
  setPageSize: (key: string, pageSize: PageSize) => void;
  setView: (key: string, view: LayerQuery["view"]) => void;
  setShowSelectedOnly: (key: string, on: boolean) => void;
  /** Opens Raw view on this exact object without changing the applied filter. */
  navigateRawObject: (key: string, objectId: string) => void;
  clearRawObject: (key: string) => void;
  setColumns: (key: string, columns: ReadonlyArray<string> | null) => void;
  resetQuery: (layerId: string) => void;
}

export type QueryStore = QueryStoreState & QueryStoreActions;

/** The layer's query, defaulted. Never undefined, so no caller needs a
 *  fallback of its own (and none can invent a different default). */
export function layerQuery(state: QueryStoreState, key: string): LayerQuery {
  return state.queries[key] ?? DEFAULT_LAYER_QUERY;
}

function patch(
  state: QueryStoreState,
  key: string,
  next: (current: LayerQuery) => LayerQuery,
): QueryStoreState {
  return {
    queries: {
      ...state.queries,
      [key]: next(layerQuery(state, key)),
    },
  };
}

export const useQueryStore = create<QueryStore>((set) => ({
  queries: {},
  restorePresentation: (key, value) => {
    const presentation = normalizeTablePresentation(value);
    if (presentation)
      set((s) =>
        patch(s, key, () => ({ ...DEFAULT_LAYER_QUERY, ...presentation })),
      );
  },
  setDrawerTab: (key, drawerTab) =>
    set((s) => patch(s, key, (q) => ({ ...q, drawerTab }))),

  setFilter: (key, filter) =>
    set((s) => patch(s, key, (q) => ({ ...q, filter }))),

  applyFilter: (key) =>
    set((s) =>
      patch(s, key, (q) => ({
        ...q,
        applied: q.filter.conditions.length === 0 ? null : q.filter,
        page: 0,
      })),
    ),

  clearFilter: (key) =>
    set((s) =>
      patch(s, key, (q) => ({
        ...q,
        filter: EMPTY_FILTER,
        applied: null,
        page: 0,
      })),
    ),

  setSort: (key, sort) =>
    set((s) => patch(s, key, (q) => ({ ...q, sort, page: 0 }))),

  toggleSort: (key, column) =>
    set((s) =>
      patch(s, key, (q) => ({
        ...q,
        sort:
          q.sort?.column === column
            ? { column, dir: q.sort.dir === "asc" ? "desc" : "asc" }
            : { column, dir: "asc" },
        page: 0,
      })),
    ),

  setPage: (key, page) =>
    set((s) => patch(s, key, (q) => ({ ...q, page: Math.max(0, page) }))),

  setPageSize: (key, pageSize) =>
    set((s) => patch(s, key, (q) => ({ ...q, pageSize, page: 0 }))),

  setView: (key, view) =>
    set((s) => patch(s, key, (q) => ({ ...q, view, columns: null, page: 0 }))),

  setShowSelectedOnly: (key, showSelectedOnly) =>
    set((s) => patch(s, key, (q) => ({ ...q, showSelectedOnly, page: 0 }))),

  navigateRawObject: (key, objectId) =>
    set((s) =>
      patch(s, key, (q) => ({
        ...q,
        view: "raw",
        columns: null,
        showSelectedOnly: false,
        rawObjectId: objectId,
        page: 0,
      })),
    ),

  clearRawObject: (key) =>
    set((s) => patch(s, key, (q) => ({ ...q, rawObjectId: null, page: 0 }))),

  setColumns: (key, columns) =>
    set((s) => patch(s, key, (q) => ({ ...q, columns, page: 0 }))),

  resetQuery: (layerId) =>
    set((s) => {
      // EVERY family's state, not only the bare key: the caller is naming a
      // LAYER (a rebuild, a removal), and a family layer's states live under
      // `${layerId}::${family}`. Leaving those behind would re-apply a
      // predicate written against columns that no longer exist.
      const stale = Object.keys(s.queries).filter(
        (key) => key === layerId || key.startsWith(`${layerId}::`),
      );
      if (stale.length === 0) return s;
      const queries = { ...s.queries };
      for (const key of stale) delete queries[key];
      return { queries };
    }),
}));
