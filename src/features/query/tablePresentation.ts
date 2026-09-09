import type { LayerQuery } from "./types";
/** Durable table preferences, separate from query results and selection. */
export interface TablePresentation {
  readonly columns: ReadonlyArray<string> | null;
  readonly sort: LayerQuery["sort"];
  readonly view: LayerQuery["view"];
  readonly pageSize: 20 | 50 | 100;
  readonly drawerTab: "records" | "summary";
}
export function normalizeTablePresentation(
  value: unknown,
): TablePresentation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  const s = v.sort as Record<string, unknown> | null;
  return {
    columns:
      Array.isArray(v.columns) &&
      v.columns.every((key) => typeof key === "string")
        ? [...new Set(v.columns)]
        : null,
    sort:
      s && typeof s.column === "string" && (s.dir === "asc" || s.dir === "desc")
        ? { column: s.column, dir: s.dir }
        : null,
    view: v.view === "raw" ? "raw" : "buildings",
    pageSize: v.pageSize === 50 || v.pageSize === 100 ? v.pageSize : 20,
    drawerTab: v.drawerTab === "summary" ? "summary" : "records",
  };
}
export function captureTablePresentation(
  query: LayerQuery | undefined,
): TablePresentation | undefined {
  return normalizeTablePresentation(query);
}
