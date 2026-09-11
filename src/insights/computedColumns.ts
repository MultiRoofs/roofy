/**
 * A tool run's results, written back onto the layer's DuckDB table.
 *
 * Two halves, deliberately separate:
 *
 *  - PURE SQL builders, tested against exact strings. Every identifier here
 *    comes from a tool's output spec and every id from a layer's own data, so
 *    both are quoted through `sql.ts` and nowhere else.
 *  - The WRITE, which is one transaction: back the replaced columns up for the
 *    touched ids, add the missing columns, then `UPDATE … FROM
 *    read_json_auto(<registered buffer>)`. A failure anywhere rolls the whole
 *    thing back, so a half-written column cannot exist.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts`'s exported functions, which is what lets the tests here
 * see the exact statement sequence.
 */

import { create } from "zustand";
import {
  ddl,
  dropBuffer,
  registerBuffer,
  runQuery,
  type QueryOutcome,
} from "./duckdb";
import { quoteIdent, quoteLiteral } from "./sql";

export type ColumnType = "DOUBLE" | "BOOLEAN" | "VARCHAR";
export interface OutputColumn {
  readonly name: string;
  readonly type: ColumnType;
}

/** One shared empty set, so `computedColumnsOf` of an untouched layer is
 *  referentially stable and cannot re-render a subscriber per call. */
const EMPTY = new Set<string>();

export function buildAddColumnSql(table: string, col: OutputColumn): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(col.name)} ${col.type}`;
}

function idList(ids: ReadonlyArray<string>): string {
  return ids.map((id) => quoteLiteral(id)).join(", ");
}

export function buildBackupSql(
  table: string,
  backupTable: string,
  columns: ReadonlyArray<string>,
  ids: ReadonlyArray<string> | null,
): string {
  const cols = ['"id"', ...columns.map((c) => quoteIdent(c))].join(", ");
  const where = ids === null ? "" : ` WHERE "id" IN (${idList(ids)})`;
  return `CREATE TABLE ${quoteIdent(backupTable)} AS SELECT ${cols} FROM ${quoteIdent(table)}${where}`;
}

export function buildUpdateFromValuesSql(
  table: string,
  valuesFile: string,
  columns: ReadonlyArray<string>,
): string {
  const sets = columns
    .map((c) => `${quoteIdent(c)} = v.${quoteIdent(c)}`)
    .join(", ");
  return `UPDATE ${quoteIdent(table)} SET ${sets} FROM read_json_auto(${quoteLiteral(valuesFile)}) AS v WHERE ${quoteIdent(table)}."id" = v."id"`;
}

export function buildRestoreSql(
  table: string,
  backupTable: string,
  columns: ReadonlyArray<string>,
): string {
  const sets = columns
    .map((c) => `${quoteIdent(c)} = u.${quoteIdent(c)}`)
    .join(", ");
  return `UPDATE ${quoteIdent(table)} SET ${sets} FROM ${quoteIdent(backupTable)} AS u WHERE ${quoteIdent(table)}."id" = u."id"`;
}

export function buildNullifySql(
  table: string,
  columns: ReadonlyArray<string>,
  ids: ReadonlyArray<string> | null,
): string {
  const sets = columns.map((c) => `${quoteIdent(c)} = NULL`).join(", ");
  const where = ids === null ? "" : ` WHERE "id" IN (${idList(ids)})`;
  return `UPDATE ${quoteIdent(table)} SET ${sets}${where}`;
}

export interface WriteInput {
  readonly runId: string;
  readonly table: string;
  readonly columns: ReadonlyArray<OutputColumn>;
  /** id → { column → value }. Every column present in every row (null allowed). */
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Column names that already exist on the table (they get backed up). */
  readonly existing: ReadonlySet<string>;
}

export type WriteOutcome =
  | { readonly ok: true; readonly backupTable: string | null }
  | { readonly ok: false; readonly message: string };

async function step(
  sql: string,
  use: "ddl" | "query" = "query",
): Promise<QueryOutcome> {
  return use === "ddl" ? ddl(sql) : runQuery(sql);
}

/** Spec §6.1: results land in ONE transaction; a failure leaves the layer as it was. */
export async function writeComputedColumns(
  input: WriteInput,
): Promise<WriteOutcome> {
  const ids = [...input.rows.keys()];
  const replaced = input.columns
    .map((c) => c.name)
    .filter((n) => input.existing.has(n));
  const backupTable = replaced.length > 0 ? `__undo_${input.runId}` : null;
  const valuesFile = `__vals_${input.runId}.json`;
  const payload = ids.map((id) => ({ id, ...input.rows.get(id) }));
  // A BIGINT from an upstream table arrives as a `BigInt`, which
  // `JSON.stringify` refuses outright rather than skipping.
  const bytes = new TextEncoder().encode(
    JSON.stringify(payload, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
  if (!(await registerBuffer(valuesFile, bytes))) {
    return {
      ok: false,
      message: "Could not hand the results to the analytics engine",
    };
  }
  const statements: Array<[string, "ddl" | "query"]> = [
    ["BEGIN TRANSACTION", "query"],
  ];
  if (backupTable) {
    statements.push([
      buildBackupSql(input.table, backupTable, replaced, ids),
      "ddl",
    ]);
  }
  for (const col of input.columns) {
    statements.push([buildAddColumnSql(input.table, col), "ddl"]);
  }
  statements.push([
    buildUpdateFromValuesSql(
      input.table,
      valuesFile,
      input.columns.map((c) => c.name),
    ),
    "query",
  ]);
  statements.push(["COMMIT", "query"]);
  try {
    for (const [sql, use] of statements) {
      const out = await step(sql, use);
      if (!out.ok) {
        await step("ROLLBACK");
        return { ok: false, message: out.message };
      }
    }
    return { ok: true, backupTable };
  } finally {
    // The VFS name is dead either way: a registration that outlived its
    // statement is a name a later run would read stale bytes from.
    await dropBuffer(valuesFile);
  }
}

export interface UndoInput {
  readonly table: string;
  readonly backupTable: string | null;
  readonly created: ReadonlyArray<string>;
  readonly replaced: ReadonlyArray<string>;
  readonly ids: ReadonlyArray<string> | null;
}

/** Spec §6.2: restore replaced values, drop created columns, drop the backup. */
export async function undoComputedColumns(
  input: UndoInput,
): Promise<QueryOutcome> {
  const statements: string[] = ["BEGIN TRANSACTION"];
  if (input.backupTable && input.replaced.length > 0) {
    statements.push(
      buildRestoreSql(input.table, input.backupTable, input.replaced),
    );
  }
  for (const c of input.created) {
    statements.push(
      `ALTER TABLE ${quoteIdent(input.table)} DROP COLUMN IF EXISTS ${quoteIdent(c)}`,
    );
  }
  if (input.backupTable) {
    statements.push(`DROP TABLE IF EXISTS ${quoteIdent(input.backupTable)}`);
  }
  statements.push("COMMIT");
  for (const sql of statements) {
    const out = await runQuery(sql);
    if (!out.ok) {
      await runQuery("ROLLBACK");
      return out;
    }
  }
  return { ok: true, columns: [], rows: [] };
}

export interface Provenance {
  readonly runId: string;
  readonly toolName: string;
  /** e.g. "LoD 2.2 · All 1,115 buildings". */
  readonly summary: string;
  readonly at: number;
  /** Set when the run covered part of the layer (spec §7 provenance tooltip). */
  readonly partial: { readonly count: number; readonly total: number } | null;
  /** The provenance this run replaced, for the "the rest from …" tooltip. */
  readonly previous: Provenance | null;
}

interface ComputedColumnState {
  readonly byLayer: Readonly<
    Record<string, Readonly<Record<string, Provenance>>>
  >;
}
interface ComputedColumnActions {
  setProvenance(layerId: string, column: string, p: Provenance): void;
  removeColumns(layerId: string, columns: ReadonlyArray<string>): void;
  clearLayer(layerId: string): void;
}

export const useComputedColumnStore = create<
  ComputedColumnState & ComputedColumnActions
>((set) => ({
  byLayer: {},
  setProvenance: (layerId, column, p) =>
    set((s) => ({
      byLayer: {
        ...s.byLayer,
        [layerId]: { ...s.byLayer[layerId], [column]: p },
      },
    })),
  removeColumns: (layerId, columns) =>
    set((s) => {
      const next = { ...s.byLayer[layerId] };
      for (const c of columns) delete next[c];
      return { byLayer: { ...s.byLayer, [layerId]: next } };
    }),
  clearLayer: (layerId) =>
    set((s) => {
      const byLayer = { ...s.byLayer };
      delete byLayer[layerId];
      return { byLayer };
    }),
}));

export function computedColumnsOf(layerId: string): ReadonlySet<string> {
  const cols = useComputedColumnStore.getState().byLayer[layerId];
  return cols ? new Set(Object.keys(cols)) : EMPTY;
}

/** `en-US` thousands separators, pinned for the same reason `tableText`'s
 *  formatter is: a tooltip that reads "1.204" in one locale and "1,204" in
 *  another is a tooltip nobody can quote in a bug report. Not imported from
 *  `ui/table` — `insights` does not depend on the UI. */
const COUNT = new Intl.NumberFormat("en-US");

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** LOCAL time, not `toISOString`: the run happened on the user's clock, and a
 *  tooltip reading 12:02 for a run they watched at 14:02 is simply wrong. */
function stamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * The one provenance sentence (spec §7): "Measure solids · LoD 2.2 ·
 * 2026-09-10 14:02", plus, when the run covered PART of the layer, "312 of
 * 1,204 buildings in this run; the rest from Measure solids · 13:40" — so a
 * column holding two runs' values is never silently mixed.
 *
 * A partial run with no `previous` (a layer's FIRST partial run) says only
 * what it knows: there is no earlier tool to name, and the rest of the column
 * is unset rather than another tool's answer.
 */
export function formatProvenance(p: Provenance): string {
  const head = [p.toolName, p.summary, stamp(p.at)].filter(
    (part) => part !== "",
  );
  if (p.partial === null) return head.join(" · ");
  const run = `${COUNT.format(p.partial.count)} of ${COUNT.format(p.partial.total)} buildings in this run`;
  const rest =
    p.previous === null
      ? ""
      : `; the rest from ${p.previous.toolName} · ${
          sameDay(p.previous.at, p.at)
            ? stamp(p.previous.at).slice(-5)
            : stamp(p.previous.at)
        }`;
  return [...head, `${run}${rest}`].join(" · ");
}

export function provenanceOf(
  layerId: string,
  column: string,
): Provenance | null {
  return useComputedColumnStore.getState().byLayer[layerId]?.[column] ?? null;
}
