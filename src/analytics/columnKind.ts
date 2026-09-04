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

const DROPPED = /^(geometry_|geometry_properties_|material_|texture_)/;

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
    const match = /^geometry_lod(.+)$/.exec(name);
    if (match?.[1] !== undefined) lods.add(match[1].replace(/_/g, "."));
  }
  return [...lods].sort((a, b) => parseFloat(a) - parseFloat(b));
}
