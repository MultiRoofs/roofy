/**
 * What a DuckDB column NAME and TYPE mean to this app.
 *
 * Two separate jobs, together because both are "read the reader's vocabulary":
 *
 *  - `classifyColumnType` decides how a value has to travel from Arrow to the
 *    grid. duckdb-wasm hands a cell back through `getChild(col).get(i)`, and
 *    that is where the trouble is: a LIST arrives as an Arrow `Vector`, a
 *    STRUCT as a `StructRow`, a BIGINT as a JS `BigInt` (which breaks
 *    `JSON.stringify` outright), a DATE or TIMESTAMP as epoch milliseconds, and
 *    a HUGEINT or DECIMAL as a STRING. So
 *    nested columns are projected through `to_json` and everything JS renders
 *    unfaithfully is cast to VARCHAR in SQL, where DuckDB's own formatting is
 *    the answer. Only the types JS can hold exactly travel raw.
 *  - `isDroppedColumn` names the reader columns a BROWSING table never wants:
 *    geometry WKB and its sidecar, per-LoD material/texture indices, and the
 *    geometry-template struct. Dropping them keeps 53 of 70 columns on the
 *    Delft sample and cuts table memory 2.45x (13.1 vs 32.1 MiB for 2231 rows).
 *
 * The dropped SHAPE is matched exactly, never by prefix. A reader column of
 * this family always carries the LoD suffix (`geometry_lod2_2`,
 * `material_lod1_2`), whereas `material_roof`, `texture_quality` and
 * `geometry_source` are perfectly ordinary third-party ATTRIBUTE names — a
 * prefix test would hide one of those from the table, the filter builder and
 * the export, silently and with nothing to show the user it happened. The same
 * precision governs `lodsFromColumnNames`, so an attribute like
 * `geometry_lod_note` cannot inject a bogus rung into a layer's LoD ladder.
 *
 * Pure, no engine import, no I/O.
 */

export type ColumnKind = "scalar" | "castText" | "nested" | "blob";

export interface ColumnInfo {
  readonly name: string;
  /** DuckDB's `column_type` verbatim, e.g. "VARCHAR[]", "DECIMAL(18,3)". */
  readonly type: string;
  readonly kind: ColumnKind;
}

/** The types a JS value holds EXACTLY, so they can cross unchanged. */
const SCALAR_TYPES = new Set([
  "VARCHAR",
  "BOOLEAN",
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

export function classifyColumnType(type: string): ColumnKind {
  const t = type.trim().toUpperCase();
  if (t.endsWith("[]") || t.startsWith("STRUCT(") || t.startsWith("MAP(")) {
    return "nested";
  }
  if (t === "BLOB") return "blob";
  if (SCALAR_TYPES.has(t)) return "scalar";
  return "castText";
}

/** Whether LIKE-family operators may be offered for this column. */
export function isTextColumn(column: ColumnInfo): boolean {
  return (
    column.kind === "scalar" && column.type.trim().toUpperCase() === "VARCHAR"
  );
}

/** A reader geometry/material/texture column, LoD suffix and all. */
const DROPPED =
  /^(geometry|geometry_properties|material|texture)_lod\d+(_\d+)?$/;

/** Whether a reader column is left out of a layer's browsing table. */
export function isDroppedColumn(name: string): boolean {
  return name === "template" || DROPPED.test(name);
}

/** "2.2" -> "2_2": how the reader spells an LoD inside a column name. */
export function lodColumnSuffix(lod: string): string {
  return lod.replace(/\./g, "_");
}

/** The LoD ladder a reader's column list implies, sorted ascending. */
export function lodsFromColumnNames(names: ReadonlyArray<string>): string[] {
  const lods = new Set<string>();
  for (const name of names) {
    const match = /^geometry_lod(\d+)_(\d+)$/.exec(name);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      lods.add(`${match[1]}.${match[2]}`);
    }
  }
  return [...lods].sort((a, b) => parseFloat(a) - parseFloat(b));
}
