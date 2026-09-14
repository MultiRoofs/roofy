import { isTextColumn, type ColumnInfo } from "./columnKind";
import { quoteIdent } from "./sql";
export type CandidateLoader = (name: string) => Promise<readonly string[]>;
export function columnTypeLabel(column: ColumnInfo | undefined): string {
  if (!column) return "Unknown";
  if (column.kind === "nested") return "Nested";
  const type = column.type.trim().toUpperCase();
  if (/^(DATE|TIME|INTERVAL)/.test(type)) return "Date / time";
  if (isTextColumn(column)) return "Text";
  if (
    /^(U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|INT\d*|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/.test(
      type,
    )
  )
    return "Number";
  if (type === "BOOLEAN") return "Boolean";
  return column.type;
}
/** Suggestions from a bounded source sample, not an exhaustive value list. */
export function createCandidateLoader(
  table: string,
  columns: readonly ColumnInfo[],
  query: (
    sql: string,
  ) => Promise<
    | { ok: true; rows: readonly Record<string, unknown>[] }
    | { ok: false; message: string }
  >,
): CandidateLoader {
  const cache = new Map<string, Promise<readonly string[]>>();
  return async (name) => {
    const col = columns.find((c) => c.name === name);
    if (!col || !isTextColumn(col)) return [];
    const existing = cache.get(name);
    if (existing) return existing;
    const promise = query(
      `SELECT DISTINCT value FROM (SELECT ${quoteIdent(name)} AS value FROM ${quoteIdent(table)} LIMIT 10000) AS sample WHERE value IS NOT NULL AND value <> '' ORDER BY value LIMIT 20`,
    )
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        return result.rows.map((r) => String(r.value));
      })
      .catch((error) => {
        cache.delete(name);
        throw error;
      });
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(name, promise);
    return promise;
  };
}
