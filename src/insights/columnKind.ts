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
 *    geometry WKB and its sidecar, and the per-LoD material/texture indices.
 *    Dropping them keeps 53 of 70 columns on the Delft sample and cuts table
 *    memory 2.45x (13.1 vs 32.1 MiB for 2231 rows).
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

/** One LoD suffix part: a decimal with no leading zero, as the extension
 *  writes it (`<prefix>_lod<major>_<minor>`, the minor always present). */
const LOD_PART = "(0|[1-9][0-9]*)";

/** A reader geometry/material/texture column, LoD suffix and all. RE2 and
 *  JavaScript read it alike, so DuckDB's lambda below uses the same text. */
const DROPPED_PATTERN = `^(geometry|geometry_properties|material|texture)_lod${LOD_PART}_${LOD_PART}$`;
const DROPPED = new RegExp(DROPPED_PATTERN);

/**
 * Whether a reader column is left out of a layer's browsing table.
 *
 * Exactly the extension's reserved per-LoD names, and nothing else: the reader
 * escapes an attribute spelled that way (`_geometry_lod2_2`), so any other
 * spelling (`geometry_lod3`, a bare `geometry` or `material`) is an attribute
 * the user can see in their file, and over-dropping it would take it out of
 * the table, the filter bar and the export with nothing to show it happened.
 */
export function isDroppedColumn(name: string): boolean {
  return DROPPED.test(name);
}

/**
 * The prefix of the presence markers {@link readerTableSelectList} adds: one
 * BOOLEAN per `geometry_lod*` column the reader had, named after it.
 *
 * Random per session, so no attribute in a file can carry a marker's name: a
 * fixed prefix would let an attribute spelled like a marker add an LoD the
 * file does not have, and be dropped with the markers.
 */
export const LOD_MARKER_PREFIX = `__roofy_has_${Array.from(
  crypto.getRandomValues(new Uint8Array(4)),
  (b) => b.toString(16).padStart(2, "0"),
).join("")}_`;

/**
 * The select list that builds a layer table from a reader in ONE read of the
 * source: every column {@link isDroppedColumn} keeps, then the LoD markers.
 *
 * The markers are how the LoD ladder survives the geometry columns being left
 * out: the ladder is read from the reader's own column names, and those names
 * reach the table only as markers, which the build drops once it has read
 * them. `id` gets a marker too because DuckDB refuses a `COLUMNS` that matches
 * nothing, and a file with no geometry would otherwise fail.
 */
export function readerTableSelectList(): string {
  return (
    `COLUMNS(c -> NOT regexp_matches(c, '${DROPPED_PATTERN}')), ` +
    `COLUMNS('^(id|geometry_lod${LOD_PART}_${LOD_PART})$') IS NOT NULL AS '${LOD_MARKER_PREFIX}\\1'`
  );
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
  /** `major.minor`. */
  readonly label: string;
  /** The text after `geometry_lod`, verbatim: "0_0", "2_2". */
  readonly suffix: string;
}

/**
 * The LoD ladder a reader's column list implies, ascending by label.
 *
 * Deduplicated by SUFFIX, since the suffix is the thing that addresses a
 * column. Only the extension's grammar is a rung: `geometry_lod1` and
 * `geometry_lod_note` are attributes.
 */
const LOD_GEOMETRY = new RegExp(`^geometry_lod(${LOD_PART}_${LOD_PART})$`);

export function lodsFromColumnNames(
  names: ReadonlyArray<string>,
): ReadonlyArray<LodColumn> {
  const bySuffix = new Map<string, LodColumn>();
  for (const name of names) {
    const match = LOD_GEOMETRY.exec(name);
    const suffix = match?.[1];
    const major = match?.[2];
    const minor = match?.[3];
    if (suffix === undefined || major === undefined || minor === undefined) {
      continue;
    }
    const label = `${major}.${minor}`;
    if (!bySuffix.has(suffix)) bySuffix.set(suffix, { label, suffix });
  }
  return [...bySuffix.values()].sort(
    (a, b) => parseFloat(a.label) - parseFloat(b.label),
  );
}
