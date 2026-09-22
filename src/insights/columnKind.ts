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

/**
 * Whether a reader column is left out of a layer's browsing table.
 *
 * A BARE `geometry` is dropped as well, and only that one of the four names.
 * CityParquet's pre-suffix grammar wrote a single unsuffixed geometry column
 * (`lodFromColumnName` in `navara-cityparquet` still reads it, as an LoD of
 * `null`), and a package in that dialect would otherwise put a WKB blob of
 * every object into the view — the exact column this list exists to keep out.
 * Its siblings (`geometry_properties`, `material`, `texture`, unsuffixed) are
 * deliberately NOT matched: `material` and `texture` are plausible third-party
 * ATTRIBUTE names, and this module's rule is that over-dropping — a column the
 * user can see in their file missing from the table, the filter bar and the
 * export with nothing to show it happened — is the worse failure. A legacy
 * file's view therefore still carries those three, JSON and all.
 */
export function isDroppedColumn(name: string): boolean {
  return name === "template" || name === "geometry" || DROPPED.test(name);
}

/**
 * One rung of a layer's LoD ladder, as the reader's own columns spell it.
 *
 * Two fields because the two jobs differ: `label` is what a human picks from
 * the LoD dropdown ("2.2"), `suffix` is the text that rebuilds the column name
 * (`geometry_lod` + suffix). The suffix is never derived from the label —
 * `"0.0"` and `"0"` are different columns and only the file knows which it has.
 */
export interface LodColumn {
  /** `major.minor`, or the bare major when the column names no minor part. */
  readonly label: string;
  /** The text after `geometry_lod`, verbatim: "0_0", "2_2", "1". */
  readonly suffix: string;
}

/**
 * The LoD ladder a reader's column list implies, ascending by label.
 *
 * Deduplicated by SUFFIX, since the suffix is the thing that addresses a
 * column. The minor part is optional, so `geometry_lod1` is a rung labelled
 * "1" rather than being skipped; `geometry_lod_note` is not a rung at all.
 */
export function lodsFromColumnNames(
  names: ReadonlyArray<string>,
): ReadonlyArray<LodColumn> {
  const bySuffix = new Map<string, LodColumn>();
  for (const name of names) {
    const match = /^geometry_lod((\d+)(?:_(\d+))?)$/.exec(name);
    const suffix = match?.[1];
    const major = match?.[2];
    if (suffix === undefined || major === undefined) continue;
    const minor = match?.[3];
    const label = minor === undefined ? major : `${major}.${minor}`;
    if (!bySuffix.has(suffix)) bySuffix.set(suffix, { label, suffix });
  }
  return [...bySuffix.values()].sort(
    (a, b) => parseFloat(a.label) - parseFloat(b.label),
  );
}
