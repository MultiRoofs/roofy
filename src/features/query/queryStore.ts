import { normalizeTablePresentation } from "./tablePresentation";
/**
 * One {@link LayerQuery} per layer, session only.
 *
 * Keyed by layer id rather than held on the layer, because none of it is
 * layer DATA: a layer that is removed and re-added is a different table, and
 * `resetQuery` is what the table lifecycle calls when a rebuild invalidates a
 * predicate written against the old columns.
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
  restorePresentation: (layerId: string, value: unknown) => void;
  setDrawerTab: (layerId: string, tab: "records" | "summary") => void;
  setFilter: (layerId: string, filter: FilterGroup) => void;
  /** Draft -> applied, page back to 0. An EMPTY draft applies `null`, so
   *  "Apply" on a cleared bar means "no filter" rather than "a filter that
   *  matches everything" — the two differ for the map sync. */
  applyFilter: (layerId: string) => void;
  clearFilter: (layerId: string) => void;
  setSort: (layerId: string, sort: LayerQuery["sort"]) => void;
  /** Header click: same column flips direction, a new column starts asc. */
  toggleSort: (layerId: string, column: string) => void;
  setPage: (layerId: string, page: number) => void;
  setPageSize: (layerId: string, pageSize: PageSize) => void;
  setView: (layerId: string, view: LayerQuery["view"]) => void;
  setShowSelectedOnly: (layerId: string, on: boolean) => void;
  /** Opens Raw view on this exact object without changing the applied filter. */
  navigateRawObject: (layerId: string, objectId: string) => void;
  clearRawObject: (layerId: string) => void;
  setColumns: (layerId: string, columns: ReadonlyArray<string> | null) => void;
  resetQuery: (layerId: string) => void;
}

export type QueryStore = QueryStoreState & QueryStoreActions;

/** The layer's query, defaulted. Never undefined, so no caller needs a
 *  fallback of its own (and none can invent a different default). */
export function layerQuery(
  state: QueryStoreState,
  layerId: string,
): LayerQuery {
  return state.queries[layerId] ?? DEFAULT_LAYER_QUERY;
}

function patch(
  state: QueryStoreState,
  layerId: string,
  next: (current: LayerQuery) => LayerQuery,
): QueryStoreState {
  return {
    queries: {
      ...state.queries,
      [layerId]: next(layerQuery(state, layerId)),
    },
  };
}

export const useQueryStore = create<QueryStore>((set) => ({
  queries: {},
  restorePresentation: (layerId, value) => {
    const presentation = normalizeTablePresentation(value);
    if (presentation)
      set((s) =>
        patch(s, layerId, () => ({ ...DEFAULT_LAYER_QUERY, ...presentation })),
      );
  },
  setDrawerTab: (layerId, drawerTab) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, drawerTab }))),

  setFilter: (layerId, filter) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, filter }))),

  applyFilter: (layerId) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        applied: q.filter.conditions.length === 0 ? null : q.filter,
        page: 0,
      })),
    ),

  clearFilter: (layerId) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        filter: EMPTY_FILTER,
        applied: null,
        page: 0,
      })),
    ),

  setSort: (layerId, sort) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, sort, page: 0 }))),

  toggleSort: (layerId, column) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        sort:
          q.sort?.column === column
            ? { column, dir: q.sort.dir === "asc" ? "desc" : "asc" }
            : { column, dir: "asc" },
        page: 0,
      })),
    ),

  setPage: (layerId, page) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, page: Math.max(0, page) }))),

  setPageSize: (layerId, pageSize) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, pageSize, page: 0 }))),

  setView: (layerId, view) =>
    set((s) =>
      patch(s, layerId, (q) => ({ ...q, view, columns: null, page: 0 })),
    ),

  setShowSelectedOnly: (layerId, showSelectedOnly) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, showSelectedOnly, page: 0 }))),

  navigateRawObject: (layerId, objectId) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        view: "raw",
        columns: null,
        showSelectedOnly: false,
        rawObjectId: objectId,
        page: 0,
      })),
    ),

  clearRawObject: (layerId) =>
    set((s) =>
      patch(s, layerId, (q) => ({ ...q, rawObjectId: null, page: 0 })),
    ),

  setColumns: (layerId, columns) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, columns, page: 0 }))),

  resetQuery: (layerId) =>
    set((s) => {
      if (!(layerId in s.queries)) return s;
      const queries = { ...s.queries };
      delete queries[layerId];
      return { queries };
    }),
}));
