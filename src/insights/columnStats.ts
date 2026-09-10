import type { ColumnInfo } from "./columnKind";
import { quoteIdent } from "./sql";
export interface ColumnStats {
  count: number;
  missing: number;
  distinct: number;
  min: string | null;
  max: string | null;
}
export type ColumnStatsLoader = (name: string) => Promise<ColumnStats>;
export const COLUMN_STATS_LIMIT = 10000;
/** Per-scope, bounded cache. Aggregation runs in DuckDB's worker, only on demand.
 * LIMIT bounds distinct storage, not the cost of evaluating the active filter. */
export function createColumnStatsLoader(
  table: string,
  columns: readonly ColumnInfo[],
  where: string | null,
  query: (
    sql: string,
  ) => Promise<
    | { ok: true; rows: readonly Record<string, unknown>[] }
    | { ok: false; message: string }
  >,
): ColumnStatsLoader {
  const cache = new Map<string, Promise<ColumnStats>>();
  return async (name) => {
    if (
      !columns.some(
        (c) =>
          c.name === name && (c.kind === "scalar" || c.kind === "castText"),
      )
    )
      throw new Error("Statistics are unavailable for this column.");
    const existing = cache.get(name);
    if (existing) return existing;
    const request = query(
      `SELECT COUNT(*) AS n, COUNT(value) AS present, COUNT(DISTINCT value) AS cardinality, CAST(MIN(value) AS VARCHAR) AS min, CAST(MAX(value) AS VARCHAR) AS max FROM (SELECT ${quoteIdent(name)} AS value FROM ${quoteIdent(table)}${where ? ` WHERE ${where}` : ""} LIMIT ${COLUMN_STATS_LIMIT}) AS sample`,
    )
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        const row = result.rows[0];
        if (!row) throw new Error("No statistics returned.");
        return {
          count: Number(row.n),
          missing: Number(row.n) - Number(row.present),
          distinct: Number(row.cardinality),
          min: row.min == null ? null : String(row.min),
          max: row.max == null ? null : String(row.max),
        };
      })
      .catch((error) => {
        cache.delete(name);
        throw error;
      });
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(name, request);
    return request;
  };
}
