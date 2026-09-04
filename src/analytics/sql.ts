/**
 * Every SQL string this feature sends to DuckDB, as PURE functions of the
 * layer's columns and the user's query.
 *
 * Pure on purpose, and tested against exact strings: the alternative is SQL
 * assembled inside a React effect, where the only way to see what was actually
 * sent is to break in a browser. Identifiers come from a DESCRIBE (so they are
 * whatever a third party's file named its attributes) and literals come from a
 * text input, so both are quoted here and nowhere else.
 *
 * No engine import — every builder returns a string the caller hands to
 * `runQuery`/`ddl` from `analytics/duckdb.ts`.
 */

import { isTextColumn, type ColumnInfo } from "./columnKind";
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
  FilterValue,
} from "../features/query/types";

export type CompileResult =
  | { readonly ok: true; readonly where: string | null }
  | { readonly ok: false; readonly message: string };

/** A DuckDB identifier, `"` doubled. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A DuckDB literal.
 *
 * A number must be FINITE: `NaN`/`Infinity` stringify to tokens DuckDB parses
 * as identifiers, so the predicate would fail at bind time with a message
 * about a missing column — a lie about which part of the filter is wrong.
 */
export function quoteLiteral(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("not a finite number");
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replace(/'/g, "''")}'`;
}

/** `%`, `_` and the escape character itself, neutralised inside a LIKE
 *  needle. Without this, typing "50%" in a "contains" box matches everything
 *  starting "50". */
export function escapeLikeNeedle(needle: string): string {
  return needle.replace(/([\\%_])/g, "\\$1");
}

const COMPARISONS = new Set<FilterOp>(["=", "!=", "<", "<=", ">", ">="]);
const LIKE_OPS = new Set<FilterOp>(["contains", "startsWith", "endsWith"]);

/** The scalar types a comparison reads as a NUMBER. Everything else scalar is
 *  VARCHAR or BOOLEAN; everything else entirely is `castText`, which takes a
 *  string literal and lets DuckDB do the cast. */
const NUMERIC_TYPES = new Set([
  "DOUBLE",
  "FLOAT",
  "REAL",
  "INTEGER",
  "SMALLINT",
  "TINYINT",
  "UINTEGER",
  "USMALLINT",
  "UTINYINT",
]);

/**
 * The SQL literal for a comparison against `column`.
 *
 * The coercion lives HERE, not in the filter bar's input handler, and that is
 * the whole point: an input that parsed as it typed could not accept "1." on
 * the way to "1.5" (`Number("1.")` re-renders as "1", so the decimal point is
 * eaten as fast as it is typed) and could never hold "-" on the way to "-3".
 * `FilterCondition.value` therefore keeps the RAW string, and the column's own
 * type decides what it means at the moment the SQL is built.
 *
 * A value that arrives already typed — a number or a boolean, from a
 * programmatic caller or a restored draft — is honoured as-is.
 */
function literalFor(
  column: ColumnInfo,
  value: string | number | boolean,
): { ok: true; sql: string } | { ok: false; message: string } {
  const type = column.type.trim().toUpperCase();

  if (typeof value === "string" && value.trim() === "") {
    return {
      ok: false,
      message: `"${column.name}" needs a value for this comparison.`,
    };
  }

  if (typeof value === "boolean" || type === "BOOLEAN") {
    if (typeof value === "boolean")
      return { ok: true, sql: quoteLiteral(value) };
    const text = String(value).trim().toLowerCase();
    if (text === "true" || text === "false") {
      return { ok: true, sql: quoteLiteral(text === "true") };
    }
    return {
      ok: false,
      message: `"${column.name}" is a true/false column; "${String(value)}" is neither.`,
    };
  }

  if (column.kind === "scalar" && NUMERIC_TYPES.has(type)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        message: `"${column.name}" needs a number; "${String(value)}" is not one.`,
      };
    }
    return { ok: true, sql: quoteLiteral(n) };
  }

  // VARCHAR, and every `castText` type (BIGINT, DECIMAL, DATE, TIMESTAMP…):
  // a string literal, which DuckDB casts with its own knowledge of its own
  // date and numeric formats.
  return { ok: true, sql: quoteLiteral(String(value)) };
}

/**
 * Is this condition's value a LIST?
 *
 * A hand-written predicate, not a bare `Array.isArray`, because that one's
 * built-in signature is `arg is any[]` — it narrows the TRUE branch but leaves
 * `ReadonlyArray<string>` in the union on the FALSE branch, so `quoteLiteral`
 * (which takes a scalar) fails to typecheck. It also does not narrow the true
 * branch to `ReadonlyArray<string>`, so `.map` over it loses its element type.
 */
function isValueList(value: FilterValue): value is ReadonlyArray<string> {
  return Array.isArray(value);
}

function likePattern(op: FilterOp, needle: string): string {
  const escaped = escapeLikeNeedle(needle);
  if (op === "startsWith") return `${escaped}%`;
  if (op === "endsWith") return `%${escaped}`;
  return `%${escaped}%`;
}

/** One condition as SQL, or the sentence explaining why it cannot be. */
function compileCondition(
  condition: FilterCondition,
  byName: ReadonlyMap<string, ColumnInfo>,
): { ok: true; sql: string } | { ok: false; message: string } {
  const column = byName.get(condition.column);
  if (!column) {
    return {
      ok: false,
      message: `This layer has no column called "${condition.column}".`,
    };
  }
  const ident = quoteIdent(column.name);

  if (condition.op === "isNull") return { ok: true, sql: `${ident} IS NULL` };
  if (condition.op === "isNotNull") {
    return { ok: true, sql: `${ident} IS NOT NULL` };
  }

  // A LIST, STRUCT or BLOB has no ordering and no equality a user could mean;
  // the null tests above are the only honest questions to ask of one.
  if (column.kind === "nested" || column.kind === "blob") {
    return {
      ok: false,
      message: `"${column.name}" holds ${column.type} values, which cannot be compared — only IS NULL / IS NOT NULL work on it.`,
    };
  }

  if (LIKE_OPS.has(condition.op)) {
    if (!isTextColumn(column)) {
      return {
        ok: false,
        message: `"${condition.op}" needs a text column; "${column.name}" is ${column.type}.`,
      };
    }
    const needle =
      typeof condition.value === "string"
        ? condition.value
        : String(condition.value);
    return {
      ok: true,
      sql: `${ident} LIKE ${quoteLiteral(likePattern(condition.op, needle))} ESCAPE '\\'`,
    };
  }

  if (condition.op === "in") {
    if (!isValueList(condition.value)) {
      return {
        ok: false,
        message: `"in" needs a list of values; "${column.name}" was given one value.`,
      };
    }
    if (condition.value.length === 0) {
      return {
        ok: false,
        message: `"in" needs at least one value for "${column.name}".`,
      };
    }
    const list = condition.value.map((v) => quoteLiteral(v)).join(", ");
    return { ok: true, sql: `${ident} IN (${list})` };
  }

  if (!COMPARISONS.has(condition.op)) {
    return {
      ok: false,
      message: `"${condition.op}" is not an operator this filter understands.`,
    };
  }
  if (isValueList(condition.value)) {
    return {
      ok: false,
      message: `"${condition.op}" takes one value, not a list, for "${column.name}".`,
    };
  }
  const literal = literalFor(column, condition.value);
  if (!literal.ok) return { ok: false, message: literal.message };
  return { ok: true, sql: `${ident} ${condition.op} ${literal.sql}` };
}

/**
 * The group as one WHERE clause, or the first reason it cannot compile.
 *
 * Rejected AT COMPILE TIME, before the query is sent: an unknown column or a
 * type-family mismatch would otherwise come back as a DuckDB bind error whose
 * wording is about SQL rather than about the row the user was editing.
 *
 * The clause is returned WITHOUT outer parentheses. Callers that embed it
 * beside another predicate wrap it themselves — see {@link buildExportWhere}.
 */
export function compileFilter(
  group: FilterGroup,
  columns: ReadonlyArray<ColumnInfo>,
): CompileResult {
  if (group.conditions.length === 0) return { ok: true, where: null };
  const byName = new Map(columns.map((c) => [c.name, c]));
  const parts: string[] = [];
  for (const condition of group.conditions) {
    const compiled = compileCondition(condition, byName);
    if (!compiled.ok) return { ok: false, message: compiled.message };
    parts.push(compiled.sql);
  }
  return { ok: true, where: parts.join(` ${group.logic} `) };
}
