/**
 * The two guarded statements §7.2 and §7.3 issue, pinned to the exact text the
 * real-engine probe (`tests/integration/duckdb/solids.test.ts`) asserts against
 * DuckDB 1.5.5. If these strings and that suite's `MEASURE_SQL` /
 * `VALIDATE_SQL` ever disagree, one of them is describing an engine nobody has
 * run — which is why that suite runs these very builders.
 *
 * The three guards this file exists to defend, all three measured on the real
 * engine and all three statement-fatal or silently wrong if broken:
 *  - `ST_3DTryFromWKB`, NEVER `ST_3DFromWKB`: the second RAISES on a
 *    MultiPolygon Z, and one such row fails the whole statement.
 *  - `ST_3DVolume` ONLY under `CASE WHEN s IS NOT NULL AND r.is_valid`: it
 *    RAISES "solid is not closed" on a parsed-but-unclosed solid, and one such
 *    row fails the whole statement. Every OTHER three_d measure is safe on an
 *    invalid solid.
 *  - EVERY validation-report field under `CASE WHEN s IS NOT NULL` (Task 1's
 *    finding D1): over a row vector, `three_d` v0.2.0 leaves the report's child
 *    vectors UNINITIALISED for a NULL solid, so an unguarded `r.is_valid` reads
 *    garbage — observed both `false` and `true` for the same row. `r.code` and
 *    `r.message` are never selected at all: reading one crashed the wasm
 *    instance.
 */
import { describe, expect, it } from "vitest";
import {
  buildScopeRowsSql,
  buildSolidMeasureSql,
  buildSolidValidationSql,
  buildSourceIdsSql,
} from "../../../../src/features/processing/solidSql";

const FROM = "read_cityjson('two.city.json', lod => '2.2')";
const G = "geometry_lod2_2";
const P = "geometry_properties_lod2_2";

/** The subquery both statements share, for the fixture's own columns. */
const PARSED_ROWS =
  `(SELECT "id", "feature_id", "geometry_properties_lod2_2".type AS geometry_type, ` +
  `ST_3DTryFromWKB("geometry_lod2_2") AS s, ` +
  `ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r ` +
  `FROM read_cityjson('two.city.json', lod => '2.2'))`;

describe("buildSolidMeasureSql", () => {
  it("is the probed statement, verbatim, for the whole layer", () => {
    expect(
      buildSolidMeasureSql({
        from: FROM,
        geometryColumn: G,
        propertiesColumn: P,
        ids: null,
      }),
    ).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, geometry_type, ` +
        `s IS NOT NULL AS parsed, ` +
        `CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, ` +
        `CASE WHEN s IS NOT NULL THEN r.degenerate_face_count > 0 END AS degenerate, ` +
        `CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ` +
        `CASE WHEN s IS NOT NULL AND r.degenerate_face_count = 0 THEN ST_3DSurfaceArea(s) END AS envelope_m2, ` +
        `ST_3DFootprintArea(s) AS footprint_m2, ` +
        `ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m ` +
        `FROM ${PARSED_ROWS}`,
    );
  });

  it("guards ST_3DSurfaceArea on the degenerate-face count, never on validity", () => {
    // F1: `ST_3DSurfaceArea` RAISES "solid contains degenerate faces" and ONE
    // such row aborts the whole statement (the Delft LoD 2.2 run). DuckDB's
    // `TRY()` does not catch a three_d Invalid Error (finding D11), so the
    // guard has to come from the validation report. It must NOT be `is_valid`:
    // an unclosed-but-not-degenerate solid still has an envelope (388 m² on
    // `invalid-solid.city.json`), which §7.2's caveat rule depends on.
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      propertiesColumn: P,
      ids: null,
    });
    expect(sql).toContain(
      "CASE WHEN s IS NOT NULL AND r.degenerate_face_count = 0 THEN ST_3DSurfaceArea(s) END AS envelope_m2",
    );
    expect(sql).not.toContain("AND r.is_valid THEN ST_3DSurfaceArea");
    // The three measures the probe pins as SAFE on a degenerate solid keep
    // their values: guarding them would cost a real footprint and a real
    // height for nothing.
    expect(sql).toContain("ST_3DFootprintArea(s) AS footprint_m2");
    expect(sql).toContain("ST_3DZMin(s) AS ground_m");
    expect(sql).toContain("ST_3DZMax(s) AS ridge_m");
  });

  it("reports the degenerate faces as a column, so the caveat can be counted", () => {
    expect(
      buildSolidMeasureSql({
        from: FROM,
        geometryColumn: G,
        propertiesColumn: P,
        ids: null,
      }),
    ).toContain(
      "CASE WHEN s IS NOT NULL THEN r.degenerate_face_count > 0 END AS degenerate",
    );
  });

  it("never mentions the unguarded parser or an unguarded volume", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      propertiesColumn: P,
      ids: null,
    });
    expect(sql).not.toMatch(/[^y]ST_3DFromWKB/);
    expect(sql).toContain(
      "CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END",
    );
    // Exactly one ST_3DVolume, and it is the guarded one.
    expect(sql.match(/ST_3DVolume/g)).toHaveLength(1);
  });

  it("reads NO report field without the `s IS NOT NULL` guard (D1)", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      propertiesColumn: P,
      ids: null,
    });
    // Every `r.<field>` in the outer select sits inside a CASE that tested the
    // solid first, and the two fields whose read crashed the engine are absent.
    for (const unguarded of sql.matchAll(/r\.\w+/g)) {
      const before = sql.slice(0, unguarded.index);
      expect(
        before.endsWith("CASE WHEN s IS NOT NULL THEN ") ||
          before.endsWith("CASE WHEN s IS NOT NULL AND "),
        unguarded[0],
      ).toBe(true);
    }
    expect(sql).not.toContain("r.code");
    expect(sql).not.toContain("r.message");
  });

  it("selects the CityJSON geometry TYPE, which is what tells a non-solid apart", () => {
    // D4: a CompositeSolid's WKB name is "GeometryCollection Z", so
    // `cityjson_wkb_geometry_type` cannot answer "is this a solid?".
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      propertiesColumn: "geometry_properties_lod0_0",
      ids: null,
    });
    expect(sql).toContain('"geometry_properties_lod0_0".type AS geometry_type');
    expect(sql).not.toContain("cityjson_wkb_geometry_type");
  });

  it("restricts to the contributor rows, quoting each id", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      propertiesColumn: P,
      ids: ["a", "b'c"],
    });
    // INSIDE the subquery, so the parse happens for the scoped rows only — a
    // WHERE on the outer select would parse the whole file first.
    expect(sql).toContain(
      `FROM read_cityjson('two.city.json', lod => '2.2') WHERE "id" IN ('a', 'b''c'))`,
    );
  });

  it("addresses the geometry column it is given, quoted", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: "geometry_lod0_0",
      propertiesColumn: "geometry_properties_lod0_0",
      ids: null,
    });
    expect(sql).toContain('ST_3DTryFromWKB("geometry_lod0_0")');
  });
});

describe("buildSolidValidationSql", () => {
  it("selects §7.3's four flags and the counts off ONE guarded report", () => {
    expect(
      buildSolidValidationSql({
        from: FROM,
        geometryColumn: G,
        propertiesColumn: P,
        ids: null,
      }),
    ).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, geometry_type, ` +
        `s IS NOT NULL AS parsed, ` +
        `CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, ` +
        `CASE WHEN s IS NOT NULL THEN r.is_closed END AS is_closed, ` +
        `CASE WHEN s IS NOT NULL THEN r.is_manifold END AS is_manifold, ` +
        `CASE WHEN s IS NOT NULL THEN r.is_oriented END AS is_oriented, ` +
        `CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n, ` +
        `CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n, ` +
        `CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n, ` +
        `CASE WHEN s IS NOT NULL THEN r.orientation_error_count END AS ori_n ` +
        `FROM ${PARSED_ROWS}`,
    );
  });

  it("never calls ST_3DVolume — §7.3 reports validity and never measures", () => {
    expect(
      buildSolidValidationSql({
        from: FROM,
        geometryColumn: G,
        propertiesColumn: P,
        ids: null,
      }),
    ).not.toContain("ST_3DVolume");
  });

  it("scopes inside the subquery too", () => {
    expect(
      buildSolidValidationSql({
        from: FROM,
        geometryColumn: G,
        propertiesColumn: P,
        ids: ["a"],
      }),
    ).toContain(
      `FROM read_cityjson('two.city.json', lod => '2.2') WHERE "id" IN ('a'))`,
    );
  });
});

describe("buildScopeRowsSql", () => {
  it("asks the TABLE which rows belong to which feature", () => {
    expect(buildScopeRowsSql("layer_3", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_3"',
    );
    expect(buildScopeRowsSql("layer_3", ["a", "b"])).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_3" WHERE "id" IN (\'a\', \'b\')',
    );
  });
});

describe("buildSourceIdsSql", () => {
  it("asks the SOURCE for ids only — no parse, no report", () => {
    // §6.1's id join is a question about which objects the file still holds, so
    // it must not pay for a single `ST_3DTryFromWKB`.
    const sql = buildSourceIdsSql({ from: FROM, ids: null });
    expect(sql).toBe(`SELECT "id" FROM ${FROM}`);
    expect(sql).not.toContain("ST_3D");
  });

  it("carries no WHERE for scope 'all', and the SCOPE's ids otherwise", () => {
    // "All" is `ctx.featureIds === null`: a 100k-building IN list would be the
    // longest statement in §6.4's log and would say nothing the reader's own
    // row-per-object answer does not.
    expect(buildSourceIdsSql({ from: FROM, ids: null })).not.toContain("WHERE");
    expect(buildSourceIdsSql({ from: FROM, ids: ["a", "b"] })).toBe(
      `SELECT "id" FROM ${FROM} WHERE "id" IN ('a', 'b')`,
    );
  });

  it("quotes an id that carries a quote", () => {
    expect(buildSourceIdsSql({ from: FROM, ids: ["O'Hara"] })).toContain(
      `WHERE "id" IN ('O''Hara')`,
    );
  });
});
