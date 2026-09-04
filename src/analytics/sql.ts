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
    // A `castText` column is ALREADY shown as text — the grid projects it
    // `"c"::VARCHAR` because JS cannot hold a BIGINT or a DATE exactly — so
    // "does the year contain 19" is a question the user can see the answer to,
    // and the same cast makes it askable. A DOUBLE is not text in any
    // rendering, and nested/blob were refused above.
    if (!isTextColumn(column) && column.kind !== "castText") {
      return {
        ok: false,
        message: `"${condition.op}" needs a text column; "${column.name}" is ${column.type}.`,
      };
    }
    const subject = column.kind === "castText" ? `${ident}::VARCHAR` : ident;
    const needle =
      typeof condition.value === "string"
        ? condition.value
        : String(condition.value);
    // An empty needle compiles to `LIKE '%%'`, which matches every non-NULL
    // row — a blank box in a half-written condition would silently read as
    // "everything", indistinguishable from a filter that did not apply.
    if (needle.trim() === "") {
      return {
        ok: false,
        message: `"${condition.op}" needs something to look for in "${column.name}".`,
      };
    }
    return {
      ok: true,
      sql: `${subject} LIKE ${quoteLiteral(likePattern(condition.op, needle))} ESCAPE '\\'`,
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
    // Every element goes through the SAME coercion a single value would: the
    // list is typed into the same kind of box, so a numeric column must get
    // `IN (10, 20.5)` rather than `IN ('10', '20.5')` — and a mis-typed
    // element must be named, which a blanket cast in SQL could never do.
    const literals: string[] = [];
    for (const element of condition.value) {
      if (String(element).trim() === "") {
        return {
          ok: false,
          message: `"in" cannot take an empty value for "${column.name}".`,
        };
      }
      const literal = literalFor(column, element);
      if (!literal.ok) return { ok: false, message: literal.message };
      literals.push(literal.sql);
    }
    return { ok: true, sql: `${ident} IN (${literals.join(", ")})` };
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
 * beside another predicate wrap it themselves — see
 * {@link buildFeatureScopeWhere}.
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

// ---------------------------------------------------------------------------
// Browsing: projection, paging, counts, feature ids
// ---------------------------------------------------------------------------

/**
 * How one column reaches the grid.
 *
 * `scalar` crosses raw; `castText` is cast IN SQL because DuckDB knows its own
 * formatting for a DATE, a TIMESTAMP or a HUGEINT and JS does not (a BIGINT
 * arrives as a `BigInt`, which `JSON.stringify` refuses outright); `nested`
 * goes through `to_json`, which yields a plain `Utf8` and leaves NULL as null;
 * `blob` is not shown at all — geometry WKB in a table cell is noise.
 */
export function projectColumn(column: ColumnInfo): string | null {
  const ident = quoteIdent(column.name);
  switch (column.kind) {
    case "scalar":
      return ident;
    case "castText":
      return `${ident}::VARCHAR AS ${ident}`;
    case "nested":
      return `to_json(${ident}) AS ${ident}`;
    case "blob":
      return null;
  }
}

/** The columns a grid shows, in table order. */
export function gridColumns(
  columns: ReadonlyArray<ColumnInfo>,
): ReadonlyArray<ColumnInfo> {
  return columns.filter((c) => c.kind !== "blob");
}

/**
 * ORDER BY is offered only for a column that HAS an order: a LIST or a STRUCT
 * sorts by a rule nobody could predict from the header.
 *
 * The reference is TABLE-QUALIFIED, and that is load-bearing rather than
 * decorative. A `castText` column is projected as `"c"::VARCHAR AS "c"`, so
 * the select list puts a VARCHAR alias in scope under the column's own name —
 * and DuckDB resolves a bare `ORDER BY "c"` to that ALIAS, sorting a BIGINT
 * year lexicographically ("1920" before "199"). `"table"."c"` can only ever
 * name the table's column.
 */
function orderClause(
  table: string,
  columns: ReadonlyArray<ColumnInfo>,
  sort: { readonly column: string; readonly dir: "asc" | "desc" } | null,
): string {
  if (sort === null) return "";
  const column = columns.find((c) => c.name === sort.column);
  if (!column) return "";
  if (column.kind !== "scalar" && column.kind !== "castText") return "";
  // NULLS LAST in both directions: a page of nulls at the top of a descending
  // sort is the one thing nobody clicks a header to see.
  return ` ORDER BY ${quoteIdent(table)}.${quoteIdent(column.name)} ${sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`;
}

/** The page size a caller gets when it asks for one SQL cannot take. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * A LIMIT/OFFSET operand that is certainly a non-negative integer.
 *
 * These two numbers are the only ones this module interpolates WITHOUT
 * quoting them — `LIMIT '100'` does not bind — so they are the one place a
 * value from a store could reach SQL as a token. `NaN`, `Infinity` and `-1`
 * all stringify to something DuckDB reads as a syntax error rather than as a
 * number, and a fractional page size is not a page size at all.
 */
function pagingInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored < 0 ? fallback : floored;
}

export function buildPageSql(
  table: string,
  columns: ReadonlyArray<ColumnInfo>,
  where: string | null,
  sort: { readonly column: string; readonly dir: "asc" | "desc" } | null,
  page: number,
  pageSize: number,
): string {
  const projections = columns
    .map(projectColumn)
    .filter((p): p is string => p !== null);
  // `SELECT 1` rather than `SELECT ` for a table of nothing but blobs: an
  // empty select list does not bind, and the row count still has to work.
  const select = projections.length === 0 ? "1" : projections.join(", ");
  const whereClause = where === null ? "" : ` WHERE ${where}`;
  const limit = Math.max(1, pagingInt(pageSize, DEFAULT_PAGE_SIZE));
  const offset = pagingInt(page, 0) * limit;
  return `SELECT ${select} FROM ${quoteIdent(table)}${whereClause}${orderClause(table, columns, sort)} LIMIT ${limit} OFFSET ${offset}`;
}

export function buildCountSql(table: string, where: string | null): string {
  const whereClause = where === null ? "" : ` WHERE ${where}`;
  return `SELECT COUNT(*) AS "n" FROM ${quoteIdent(table)}${whereClause}`;
}

/**
 * The scope predicate every FEATURE-wise operation shares.
 *
 * Always the POSITIVE `IN` form, and `COALESCE` on BOTH sides: a single NULL
 * `feature_id` makes a `NOT IN` predicate NULL, which hides nothing and looks
 * like a filter that silently did not apply. The COALESCE is what lets a root
 * object (whose `feature_id` may be its own id, or NULL in a fallback table)
 * match its own parts.
 */
export function buildFeatureScopeWhere(
  table: string,
  where: string | null,
): string | null {
  if (where === null) return null;
  const t = quoteIdent(table);
  return `COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM ${t} WHERE ${where})`;
}

/**
 * The ids the map should draw for `where`.
 *
 * Matches are expanded to their whole FEATURE, because attributes and geometry
 * live on different rows in real data: a `Building` carries the semantics and
 * a `BuildingPart` carries the shape, so filtering on `b3_h_dak_max > 10` and
 * drawing only the matching rows would draw nothing at all.
 */
export function buildFeatureIdsSql(
  table: string,
  where: string | null,
): string {
  const t = quoteIdent(table);
  const scope = buildFeatureScopeWhere(table, where);
  return scope === null
    ? `SELECT "id" FROM ${t}`
    : `SELECT "id" FROM ${t} WHERE ${scope}`;
}

/**
 * The layer's TOP-LEVEL object types — what the export dialog offers.
 *
 * `parents IS NULL` is the test, not a type-name heuristic: the reader writes
 * SQL NULL (never `[]`) for an object with no parents, so this is exactly the
 * set of feature roots. Parts follow their root into the export.
 */
export function buildRootTypesSql(table: string): string {
  return `SELECT DISTINCT "object_type" AS "value" FROM ${quoteIdent(table)} WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type AttributeExportFormat = "parquet" | "csv" | "json";

/**
 * How one column reaches a FILE — deliberately not {@link projectColumn}.
 *
 * The grid's projection exists to work around JS: a BIGINT arrives as a
 * `BigInt` that `JSON.stringify` refuses, a DATE as epoch milliseconds, so
 * `castText` columns are cast to VARCHAR and DuckDB's own formatting becomes
 * the answer. A FILE has no such limit — Parquet holds an INT64 and a DATE
 * exactly, and CSV/JSON get DuckDB's text rendering of the native value
 * anyway — so casting here would silently downgrade `bouwjaar` to a string in
 * the artefact the user takes away, and anything that later sums or compares
 * that column would be sorting text. Hence: scalar and castText alike travel
 * as themselves.
 *
 * Only NESTED columns still differ by format — native for parquet, which holds
 * a list, and `to_json` for CSV and JSON, where a raw list would arrive as
 * DuckDB's bracket spelling in one and as a nested document in the other —
 * and BLOBs are dropped everywhere: geometry belongs in the CityParquet route.
 */
function exportProjection(
  column: ColumnInfo,
  format: AttributeExportFormat,
): string | null {
  if (column.kind === "blob") return null;
  const ident = quoteIdent(column.name);
  if (column.kind !== "nested") return ident;
  return format === "parquet" ? ident : `to_json(${ident}) AS ${ident}`;
}

/**
 * The `COPY` option list for a format.
 *
 * JSON needs `ARRAY true`: without it DuckDB writes newline-delimited objects
 * (JSONL), which `JSON.parse` and every "load this JSON" tool reject, and the
 * user asked for a `.json` file.
 */
function copyFormatOptions(format: AttributeExportFormat): string {
  return format === "json" ? "FORMAT json, ARRAY true" : `FORMAT ${format}`;
}

/**
 * `COPY (SELECT …) TO '<file>' (FORMAT …)` for the attribute formats.
 *
 * See {@link exportProjection} for why a file's projection is not the grid's.
 *
 * NOT offered here, and never to be added without re-probing: `FORMAT cityjson
 * | cityjsonseq | flatcitybuf` write ZERO BYTES in wasm, silently.
 */
export function buildAttributeExportSql(input: {
  readonly table: string;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  readonly format: AttributeExportFormat;
  readonly outFile: string;
}): string {
  const projections = input.columns
    .map((column) => exportProjection(column, input.format))
    .filter((p): p is string => p !== null);
  const select = projections.length === 0 ? "1" : projections.join(", ");
  const scope = buildFeatureScopeWhere(input.table, input.where);
  const whereClause = scope === null ? "" : ` WHERE ${scope}`;
  return `COPY (SELECT ${select} FROM ${quoteIdent(input.table)}${whereClause}) TO ${quoteLiteral(input.outFile)} (${copyFormatOptions(input.format)})`;
}

/**
 * The columns a CityParquet object table must carry, whatever else is dropped.
 *
 * Measured, not guessed (probe P6g): attributes may go to zero and one LoD is
 * fine, but `id, feature_id, parents, children` must be present, and a
 * `geometry_lodX_Y` without its `geometry_properties_lodX_Y` sidecar fails
 * validation. `object_type`, `children_roles` and `bbox` are kept because the
 * writer's `metadata.json` reports them and a package without them is poorer
 * for no saving.
 */
export const CITYPARQUET_REQUIRED_COLUMNS: ReadonlyArray<string> = [
  "id",
  "feature_id",
  "object_type",
  "parents",
  "children",
  "children_roles",
  "bbox",
];

/** The scratch table's name inside its own schema. */
export const CITYPARQUET_SOURCE_TABLE = "src";

/**
 * ONE read of the re-registered source, filtered to the export's feature scope.
 *
 * The source is read again (rather than the layer's browsing table being
 * reused) because that table has no geometry in it at all — the entire point of
 * dropping the BLOB columns — and a CityParquet package without geometry is not
 * a package. But it is read exactly ONCE: cutting each module table straight
 * from the reader would re-parse the whole file per module, so a package with
 * buildings, vegetation and city furniture in it would parse a 300 MB CityJSON
 * three times over.
 *
 * The scratch table lives in a SCHEMA OF ITS OWN, not beside the module tables:
 * `cityparquet_init` describes every table in the schema it is given, and a
 * table called `src` is not a CityGML module.
 *
 * No `lod := …` argument: the explicit column list already names exactly one
 * LoD's geometry pair, and that is the route probed end to end (P6b/P6c/P6g).
 * `lod :=` narrows the SCHEMA rather than the rows and would only add a
 * bind-time failure mode for an LoD spelled differently than the file spells it.
 *
 * `lodSuffix` is the exact text after `geometry_lod` in the SOURCE'S OWN column
 * name — "0_0", "2_2" — never a label put through string surgery: the reader
 * spells Delft's LoD 0 as `geometry_lod0_0` while another file may spell the
 * same rung `geometry_lod0`, so only the column list can say which it is.
 *
 * The whole select list is DEDUPED. A caller's attribute list is chosen from
 * the layer's columns, which include the required names and the geometry pair,
 * so `id` or `geometry_lod2_2` arriving twice is a UI slip rather than an
 * impossibility — and a repeated column makes `CREATE TABLE … AS SELECT` fail
 * on a duplicate name, losing the whole export to a cosmetic mistake.
 */
export function buildCityParquetSourceSql(input: {
  readonly scratchSchema: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly sourceFile: string;
  readonly table: string;
  readonly lodSuffix: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
}): string {
  const columns = [
    ...CITYPARQUET_REQUIRED_COLUMNS,
    `geometry_lod${input.lodSuffix}`,
    `geometry_properties_lod${input.lodSuffix}`,
    ...input.attributes,
  ];
  const select = [...new Set(columns)].map(quoteIdent).join(", ");
  const scope = buildFeatureScopeWhere(input.table, input.where);
  const whereClause = scope === null ? "" : ` WHERE ${scope}`;
  return `CREATE TABLE ${quoteIdent(input.scratchSchema)}.${quoteIdent(CITYPARQUET_SOURCE_TABLE)} AS SELECT ${select} FROM ${input.reader}(${quoteLiteral(input.sourceFile)})${whereClause}`;
}

/**
 * One `exp.<module>` table, cut from the scratch table.
 *
 * The MODULE predicate asks which table a feature belongs in by its ROOT's
 * type, so a BuildingPart follows its Building rather than being classified on
 * its own. It reads the LAYER table (which has `parents` and `object_type` for
 * every object) while the rows come from the scratch table.
 */
export function buildCityParquetModuleSql(input: {
  readonly schema: string;
  readonly module: string;
  readonly scratchSchema: string;
  readonly table: string;
  readonly moduleTypes: ReadonlyArray<string>;
}): string {
  const t = quoteIdent(input.table);
  const types = input.moduleTypes.map((v) => quoteLiteral(v)).join(", ");
  // `IN ()` is a SYNTAX error, so an empty module would take the whole export
  // down at the first statement. `WHERE FALSE` is the honest reading of "no
  // types belong to this module": an empty table, and the package still
  // builds around it.
  const modulePredicate =
    input.moduleTypes.length === 0
      ? "FALSE"
      : `COALESCE("feature_id", "id") IN (SELECT "id" FROM ${t} WHERE "parents" IS NULL AND "object_type" IN (${types}))`;
  return `CREATE TABLE ${quoteIdent(input.schema)}.${quoteIdent(input.module)} AS SELECT * FROM ${quoteIdent(input.scratchSchema)}.${quoteIdent(CITYPARQUET_SOURCE_TABLE)} WHERE ${modulePredicate}`;
}
