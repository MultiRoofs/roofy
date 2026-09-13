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
  getDuckDBStatus,
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

/**
 * The write's UPDATE, reading the values file with the columns' DECLARED types.
 *
 * `read_json` with an explicit `columns=`, NEVER `read_json_auto` (finding D9).
 * The file is a document this module built one line ago out of columns whose
 * types the run already declared, so there is nothing to infer — and inference
 * here is not merely redundant, it is WRONG: JSON's sample is 20,480 rows, and
 * a VARCHAR column whose first value appears after it is inferred `JSON`, which
 * renders a string WITH ITS QUOTES. Measured on DuckDB 1.5.5: an empty string
 * landed in the destination as the two-character value `""` and `Centrum` as
 * `"Centrum"`. A join whose first 20,480 buildings fall outside every area hits
 * exactly that (§7.5's "copied values keep their type"), and the table then
 * disagrees with the values published to the model.
 *
 * `"id"` is declared too, because it is the join key and a file of numeric-
 * looking ids would otherwise be inferred as numbers and match nothing.
 */
export function buildUpdateFromValuesSql(
  table: string,
  valuesFile: string,
  columns: ReadonlyArray<OutputColumn>,
): string {
  const sets = columns
    .map((c) => `${quoteIdent(c.name)} = v.${quoteIdent(c.name)}`)
    .join(", ");
  // A struct literal, so every key is a quoted identifier and every value the
  // type name as a string — the same shape `vectorTable.ts` reads its source
  // with, and for the same reason.
  const declared = [
    `"id": 'VARCHAR'`,
    ...columns.map((c) => `${quoteIdent(c.name)}: ${quoteLiteral(c.type)}`),
  ].join(", ");
  return (
    `UPDATE ${quoteIdent(table)} SET ${sets} ` +
    `FROM read_json(${quoteLiteral(valuesFile)}, columns = {${declared}}) AS v ` +
    `WHERE ${quoteIdent(table)}."id" = v."id"`
  );
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
  /**
   * The run's cancellation, read ONCE: immediately before COMMIT (spec §6.1).
   *
   * The write is the last thing a run does, and it is where a Cancel most
   * often lands — the UPDATE over every scoped row is the longest statement
   * of the whole run. Without this the transaction commits anyway and the
   * user, who pressed Cancel, gets their columns.
   *
   * It is deliberately not checked between every statement: the engine has no
   * statement-level cancel, so an earlier check would only ROLLBACK work that
   * the check before COMMIT rolls back just as completely.
   */
  readonly signal?: AbortSignal;
}

export type WriteOutcome =
  | {
      readonly ok: true;
      readonly backupTable: string | null;
      /**
       * Every statement the transaction issued, in order (spec §6.4: "the SQL
       * statements issued in order"). The run's log prints them so a planner
       * can read it back and repeat the UPDATE by hand — which the one
       * `sql: null` entry M1 shipped could not support.
       *
       * They are the statements, never the values: the rows travel through a
       * registered buffer and the UPDATE reads `read_json(…)`, so the log
       * stays a page long whatever the run measured.
       */
      readonly statements: ReadonlyArray<string>;
    }
  /** `cancelled` is the user's own Cancel, never an error to report. */
  | {
      readonly ok: false;
      readonly message: string;
      readonly cancelled?: true;
      /** What it got through before it failed — §6.3 shows the error, §6.4
       *  still has to say what was attempted. */
      readonly statements: ReadonlyArray<string>;
    };

async function step(
  sql: string,
  use: "ddl" | "query" = "query",
): Promise<QueryOutcome> {
  return use === "ddl" ? ddl(sql) : runQuery(sql);
}

/**
 * A ROLLBACK for a transaction whose database is gone.
 *
 * Cleanup runs on the failure path, and one of the ways a statement fails is
 * that the engine's worker died under it. There is nothing to roll back then —
 * the transaction, the backup table and the database all went together — and a
 * dead worker never answers, so the statement is skipped rather than sent.
 *
 * RETURNS WHETHER IT SENT ANYTHING, because §6.4's record is of what was
 * issued: a log that claimed a ROLLBACK nobody posted would be worse than one
 * that said nothing.
 */
async function cleanup(sql: string): Promise<boolean> {
  if (getDuckDBStatus().state !== "ready") return false;
  await step(sql);
  return true;
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
      // Nothing was sent: this is the one exit before the transaction opens.
      statements: [],
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
  // The COLUMNS, not their names: the read declares their types (finding D9).
  statements.push([
    buildUpdateFromValuesSql(input.table, valuesFile, input.columns),
    "query",
  ]);
  // What was actually SENT, in order — not the plan above, which may not have
  // been reached in full (§6.4).
  const issued: string[] = [];
  /** Roll back, and record it only if the statement really went out. */
  const rollback = async (): Promise<void> => {
    if (await cleanup("ROLLBACK")) issued.push("ROLLBACK");
  };
  try {
    for (const [sql, use] of statements) {
      issued.push(sql);
      const out = await step(sql, use);
      if (!out.ok) {
        await rollback();
        return { ok: false, message: out.message, statements: issued };
      }
    }
    // The COMMIT is OUTSIDE the loop because this check has to sit right
    // before it: everything above is undone by the ROLLBACK — the backup
    // table included, DuckDB's DDL being transactional — and after the COMMIT
    // nothing can be.
    if (input.signal?.aborted) {
      await rollback();
      return {
        ok: false,
        cancelled: true,
        message: "Cancelled",
        statements: issued,
      };
    }
    // Recorded BEFORE it is sent, like every statement in the loop: a COMMIT
    // that FAILED is the one a planner most needs to see in the log.
    issued.push("COMMIT");
    const committed = await step("COMMIT");
    if (!committed.ok) {
      await rollback();
      return { ok: false, message: committed.message, statements: issued };
    }
    return { ok: true, backupTable, statements: issued };
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
      await cleanup("ROLLBACK");
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
