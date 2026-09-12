/**
 * The guarded `three_d` statements §7.2 and §7.3 issue, and the layer-table
 * question that precedes them. Pure; every string here is pinned by
 * `tests/unit/features/processing/solidSql.test.ts` and run against a real
 * DuckDB 1.5.5 by `tests/integration/duckdb/solids.test.ts`, which asserts
 * these builders' own output rather than a literal of its own.
 *
 * THREE GUARDS, all measured on the real engine:
 *
 *  - `ST_3DTryFromWKB`, never `ST_3DFromWKB`. The second RAISES "Unsupported
 *    WKB geometry type for SOLID_3D import: type code 1006" on a MultiPolygon Z
 *    — which is what a MultiSurface at a solid LoD is — and ONE such row fails
 *    the whole statement. The `Try` form returns NULL, and `s IS NULL` is then
 *    §7.2's "not a solid" outcome.
 *  - `ST_3DVolume` only under `CASE WHEN s IS NOT NULL AND r.is_valid`. It
 *    RAISES "ST_3DVolume: solid is not closed" on a parsed-but-unclosed solid,
 *    and ONE such row fails the whole statement. Every other measure — surface
 *    area, footprint area, ZMin/ZMax — returns a value on an invalid solid,
 *    which is exactly what §7.2's "invalid solid" outcome requires.
 *  - EVERY validation-report field under `CASE WHEN s IS NOT NULL` (Task 1's
 *    finding D1). `ST_3DValidationReport(s)` over a ROW VECTOR sets the struct's
 *    own validity mask but leaves its CHILD vectors uninitialised for a NULL
 *    solid: `ST_3DValidationReport(s) IS NULL` reads true while `r.is_valid`
 *    returns whatever was in memory — observed `false` on one run of the same
 *    statement and `true` on another, with garbage BIGINT counts beside it. The
 *    guard restores §7.2's output (a row that is not a solid reports NULL
 *    validity), and `r.code` / `r.message` are never selected at all: reading
 *    one returned a 2.4-million-character length once and crashed the wasm
 *    instance another time.
 *
 * "Not a solid" is decided from the CityJSON GEOMETRY TYPE — the reader's
 * `geometry_properties_lod<suffix>.type`, selected here as `geometry_type` —
 * and never from `cityjson_wkb_geometry_type`, whose name for a CompositeSolid
 * is "GeometryCollection Z" (finding D4). The parse answers "did three_d
 * understand it", which is a different question from "was it modelled as a
 * solid".
 */
import { quoteIdent, quoteLiteral } from "../../insights/sql";

export interface SolidSqlInput {
  /** The reader clause from `readSource`: `read_cityjson('…', lod => '2.2')`. */
  readonly from: string;
  /** The reader's own spelling, from `ReadSourceHandle`: `geometry_lod2_2`. */
  readonly geometryColumn: string;
  /**
   * The reader's properties struct, from `ReadSourceHandle`:
   * `geometry_properties_lod2_2`. Its `.type` is the CityJSON geometry type.
   */
  readonly propertiesColumn: string;
  /** CONTRIBUTOR row ids, or null for every row the reader returns. */
  readonly ids: ReadonlyArray<string> | null;
}

/** The `WHERE "id" IN (…)` of a scope, or nothing at all for "every row". */
function idFilter(ids: ReadonlyArray<string> | null): string {
  return ids === null
    ? ""
    : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
}

/**
 * The scoped rows of the LAYER TABLE, each beside its FEATURE root.
 *
 * The TABLE is the authority on which rows exist and what `feature_id` means —
 * it is what the write targets — so the contributor rule is resolved against it
 * and never against the reader. Spelled here rather than imported from
 * `tools/roofMetrics.ts`, whose identical builder cannot be reached without
 * firing that module's `registerExecutor` side effect.
 */
export function buildScopeRowsSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  return `SELECT "id", COALESCE("feature_id", "id") AS f FROM ${quoteIdent(table)}${idFilter(ids)}`;
}

/**
 * The ids the SOURCE still holds, and nothing else — spec §6.1's id join.
 *
 * SEPARATE from the measure statement on purpose. The join's threshold is EVERY
 * SCOPED row, roots and non-contributors included (the scope-wide identity
 * ruling): a root displaced by its part, or a part with no geometry at this LoD,
 * is measured by nobody, so a check folded into the measure statement could only
 * ever cover the contributors and would miss a file that had stopped holding
 * the rest. Asking for the ids alone keeps the answer cheap — no
 * `ST_3DTryFromWKB`, no validation report, nothing but the reader's own id
 * column — and `ids === null` (scope "all") carries no `WHERE` at all, so the
 * widest scope is also the shortest statement in §6.4's log.
 */
export function buildSourceIdsSql(input: {
  readonly from: string;
  /** The SCOPE's row ids, or null for "every row the reader returns". */
  readonly ids: ReadonlyArray<string> | null;
}): string {
  return `SELECT "id" FROM ${input.from}${idFilter(input.ids)}`;
}

/**
 * The subquery both statements share: one parse and one report per row, beside
 * the CityJSON geometry type the executor classifies on.
 */
function parsedRows(input: SolidSqlInput): string {
  const g = quoteIdent(input.geometryColumn);
  // The WHERE is INSIDE the subquery, so only the scoped rows are ever parsed;
  // filtering on the outer select would parse the whole file first.
  return (
    `(SELECT "id", "feature_id", ${quoteIdent(input.propertiesColumn)}.type AS geometry_type, ` +
    `ST_3DTryFromWKB(${g}) AS s, ` +
    `ST_3DValidationReport(ST_3DTryFromWKB(${g})) AS r ` +
    `FROM ${input.from}${idFilter(input.ids)})`
  );
}

/** The columns every statement here opens with: the row, its feature, its type. */
const ROW_IDENTITY =
  `SELECT "id", COALESCE("feature_id", "id") AS f, geometry_type, ` +
  `s IS NOT NULL AS parsed, `;

/** §7.2's one statement: every measure, with volume guarded by validity. */
export function buildSolidMeasureSql(input: SolidSqlInput): string {
  return (
    ROW_IDENTITY +
    `CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, ` +
    `CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ` +
    `ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ` +
    `ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m ` +
    `FROM ${parsedRows(input)}`
  );
}

/**
 * §7.3's one statement: the four flags and the counts behind them.
 *
 * EIGHT report fields, not seven: `orientation_error_count` is the report
 * struct's 13th field (finding D3) and the only thing that explains an
 * `is_oriented` of false. It is read here and written to no column —
 * `validationColumns` is §7.3's seven — so Task 10 can say how many faces wind
 * the wrong way without a second statement.
 */
export function buildSolidValidationSql(input: SolidSqlInput): string {
  return (
    ROW_IDENTITY +
    `CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, ` +
    `CASE WHEN s IS NOT NULL THEN r.is_closed END AS is_closed, ` +
    `CASE WHEN s IS NOT NULL THEN r.is_manifold END AS is_manifold, ` +
    `CASE WHEN s IS NOT NULL THEN r.is_oriented END AS is_oriented, ` +
    `CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n, ` +
    `CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n, ` +
    `CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n, ` +
    `CASE WHEN s IS NOT NULL THEN r.orientation_error_count END AS ori_n ` +
    `FROM ${parsedRows(input)}`
  );
}
