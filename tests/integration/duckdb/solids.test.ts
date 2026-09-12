// @vitest-environment node
/**
 * Every `three_d` fact the M3 plan's SQL rests on, against a REAL DuckDB 1.5.5
 * with `three_d` v0.2.0 — the same wasm build the app ships.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 * Skipped otherwise: it downloads a 36 MB binary and fetches a community
 * extension over the network, neither of which belongs in the default run.
 *
 * WHAT ONLY THIS SUITE CAN CATCH: the community slot for a DuckDB version can
 * be REBUILT under us (the duckdb-wasm pin pins the extension build, it does
 * not freeze it). A renamed function or a `ST_3DVolume` that stopped raising
 * would sail through every unit test in the repo, and the two guards the plan
 * is built on — `ST_3DTryFromWKB` instead of `ST_3DFromWKB`, and
 * `ST_3DVolume` only under `is_valid` — exist only because of what is
 * asserted here.
 *
 * The statement in `MEASURE_SQL` is the shape `buildSolidMeasureSql` (Task 6)
 * emits. It is spelled literally because that builder does not exist yet;
 * Task 6 pins its output to this exact text and appends a case here that runs
 * the builder's own output.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Harness } from "./harness";

const enabled = process.env.DUCKDB_INTEGRATION === "1";

/** The fixture, under the VFS name the statements below address. */
const SOURCE = "two.city.json";
const LOD = "2.2";

/** A Solid, INVALID (not closed, 2 open edges, 1 non-manifold edge). */
const INVALID = "NL.IMBAG.Pand.0001";
/** A MultiSurface at a solid LoD — the "not a solid" row. */
const NOT_A_SOLID = "NL.IMBAG.Pand.0001-part1";
/** A Solid, VALID. */
const VALID = "NL.IMBAG.Pand.0002";

/**
 * The one-statement shape §7.2 runs, verbatim. **Task 6's `buildSolidMeasureSql`
 * must emit THIS text**, not the plan's.
 *
 * `ST_3DTryFromWKB` in a subquery so the parse happens ONCE per row; the
 * validation report beside it, so `r.is_valid` guards `ST_3DVolume` in the
 * outer select. Every other measure is applied unguarded, which is the fact
 * the assertions below exist to pin.
 *
 * DEVIATES from the plan's §7.2 text, forced by the engine and verified here
 * 2026-09-12: the plan reads `r.is_valid AS is_valid` and rests on
 * "`ST_3DValidationReport(NULL)` is NULL, so `r.is_valid` is NULL rather than
 * false". That holds for a CONSTANT NULL only. Over a row vector, `three_d`
 * v0.2.0 leaves the report's CHILD vectors untouched for a NULL solid:
 * `ST_3DValidationReport(s) IS NULL` is true, yet `r.is_valid` reads
 * uninitialised memory — observed both `false` and `true` for the SAME row on
 * two runs, with garbage BIGINT counts beside it. So EVERY read of a report
 * field carries `s IS NOT NULL`, the volume's condition included, which
 * restores exactly the §7.2 output (`valid` NULL for a row that is not a
 * solid). See the "tells a NULL solid's report apart" case below for the pin.
 */
const MEASURE_SQL = `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('two.city.json', lod => '2.2'))`;

/**
 * §7.3's statement, the same way: all EIGHT report fields a validation run
 * reads, each under the `s IS NOT NULL` guard.
 *
 * `orientation_error_count` is here because the report struct HAS it —
 * `STRUCT(is_valid, is_closed, is_manifold, is_oriented, solid_count,
 * shell_count, face_count, open_edge_count, non_manifold_edge_count,
 * degenerate_face_count, orientation_error_count, code, message)` — and the
 * plan's field list omits it. `code` and `message` are deliberately NOT
 * selected: see the garbage case below.
 *
 * Task 10's `buildSolidValidationSql` must emit this shape. Like MEASURE_SQL,
 * the TEXT is that task's to pin; this constant is the ENGINE fact until then.
 */
const VALIDATE_SQL = `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, CASE WHEN s IS NOT NULL THEN r.is_closed END AS is_closed, CASE WHEN s IS NOT NULL THEN r.is_manifold END AS is_manifold, CASE WHEN s IS NOT NULL THEN r.is_oriented END AS is_oriented, CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n, CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n, CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n, CASE WHEN s IS NOT NULL THEN r.orientation_error_count END AS ori_n FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('two.city.json', lod => '2.2'))`;

/**
 * The same statement against the CityJSONSeq reader, by swapping ONLY the
 * reader call — so the two runs cannot drift apart in any other character and
 * "behaves identically" means what it says.
 */
function throughSeq(sql: string): string {
  return sql.replace(
    "read_cityjson('two.city.json', lod => '2.2')",
    "read_cityjsonseq('two.city.jsonl', lod => '2.2')",
  );
}

/** What one row of MEASURE_SQL / VALIDATE_SQL must contain, column by column. */
type ExpectedRow = Record<string, string | number | boolean | null>;

/**
 * Asserts EVERY named column, with no `Number(…)` coercion that a NULL could
 * slip through: a `null` expectation is asserted as NULL, an integer (0
 * included) by identity, and only a non-integral measure is compared with a
 * tolerance.
 */
function expectRow(
  row: Record<string, unknown> | undefined,
  expected: ExpectedRow,
): void {
  expect(row).toBeDefined();
  for (const [column, want] of Object.entries(expected)) {
    const got = row?.[column];
    if (want === null) expect(got, column).toBeNull();
    else if (typeof want === "number" && !Number.isInteger(want))
      expect(got as number, column).toBeCloseTo(want, 6);
    else expect(got, column).toBe(want);
  }
}

describe.skipIf(!enabled)("three_d against real DuckDB 1.5.5", () => {
  let db: Harness;

  beforeAll(async () => {
    // DYNAMIC, inside `beforeAll`: the file is collected by the default run
    // and only `describe.skipIf` keeps it from executing — a top-level import
    // would still evaluate the node bindings and resolve three wasm paths.
    const harness = await import("./harness");
    db = await harness.openDuckDB();
    // A failure here IS the report this suite exists to make, so it is left
    // to throw with the extension's own words.
    harness.installExtension(db, "three_d");
    db.register(SOURCE, "two-buildings.city.json");
  }, 180_000);

  afterAll(() => {
    db?.close();
  });

  it("publishes every function name the plan's SQL uses", () => {
    const rows = db.query(
      "SELECT function_name FROM duckdb_functions() WHERE function_name LIKE 'st\\_3d%' ESCAPE '\\'",
    );
    const names = new Set(rows.map((r) => String(r["function_name"])));
    for (const fn of [
      "st_3dtryfromwkb",
      "st_3dfromwkb",
      "st_3dvolume",
      "st_3dsurfacearea",
      "st_3darea",
      "st_3dfootprintarea",
      "st_3dzmin",
      "st_3dzmax",
      "st_3dbounds",
      "st_3disclosed",
      "st_3dismanifold",
      "st_3disoriented",
      "st_3dnumshells",
      "st_3dnumfaces",
      "st_3dcentroid",
      "st_3ddistance",
      "st_3dvalidationreport",
    ]) {
      expect(names).toContain(fn);
    }
    // There is NO `ST_3DIsValid`: validity is the report's field. A task that
    // reached for one would get a Catalog Error at run time.
    expect(names.has("st_3disvalid")).toBe(false);
  });

  it("names the LoD column after the file's OWN label, and refuses another", () => {
    const described = db
      .query(
        `DESCRIBE SELECT * FROM read_cityjson('${SOURCE}', lod => '${LOD}')`,
      )
      .map((r) => String(r["column_name"]));
    // The label's "." becomes "_": "2.2" → geometry_lod2_2. This is why
    // `LodColumn.suffix` exists and is never derived from the label.
    expect(described).toContain("geometry_lod2_2");
    expect(described).toContain("geometry_properties_lod2_2");
    // The file's own label is the only one it answers to.
    expect(() =>
      db.query(`SELECT 1 FROM read_cityjson('${SOURCE}', lod => '2') LIMIT 1`),
    ).toThrow(/LOD '2\.0' not found in file/);
  });

  it("reports the CityJSON geometry type in the properties struct", () => {
    const rows = db.query(
      `SELECT "id", "geometry_properties_lod2_2".type AS t FROM read_cityjson('${SOURCE}', lod => '${LOD}') ORDER BY "id"`,
    );
    const byId = new Map(rows.map((r) => [String(r["id"]), String(r["t"])]));
    expect(byId.get(INVALID)).toBe("Solid");
    expect(byId.get(NOT_A_SOLID)).toBe("MultiSurface");
    expect(byId.get(VALID)).toBe("Solid");
  });

  it("has the two cheap WKB helpers, which need no three_d", () => {
    const rows = db.query(
      `SELECT "id", cityjson_wkb_geometry_type("geometry_lod2_2") AS wkb FROM read_cityjson('${SOURCE}', lod => '${LOD}') ORDER BY "id"`,
    );
    const byId = new Map(rows.map((r) => [String(r["id"]), String(r["wkb"])]));
    expect(byId.get(VALID)).toBe("PolyhedralSurface Z");
    expect(byId.get(NOT_A_SOLID)).toBe("MultiPolygon Z");
    const extent = db.query(
      `SELECT cityjson_wkb_extent("geometry_lod2_2") AS e FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${VALID}'`,
    );
    expect(extent[0]?.["e"]).toMatchObject({ zmin: 0 });
  });

  it("RAISES on ST_3DFromWKB over a MultiPolygon Z — the whole statement", () => {
    // Global Constraints: `ST_3DFromWKB` is never used. One such row fails the
    // statement, so a layer with a single MultiSurface at a solid LoD would
    // fail the whole run.
    expect(() =>
      db.query(
        `SELECT ST_3DFromWKB("geometry_lod2_2") FROM read_cityjson('${SOURCE}', lod => '${LOD}')`,
      ),
    ).toThrow(/Unsupported WKB geometry type for SOLID_3D import/);
  });

  it("returns NULL from ST_3DTryFromWKB instead — for a MultiSurface, garbage and NULL", () => {
    const rows = db.query(
      `SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") IS NULL AS n FROM read_cityjson('${SOURCE}', lod => '${LOD}') ORDER BY "id"`,
    );
    const byId = new Map(rows.map((r) => [String(r["id"]), r["n"]]));
    expect(byId.get(NOT_A_SOLID)).toBe(true);
    expect(byId.get(VALID)).toBe(false);
    const junk = db.query(
      "SELECT ST_3DTryFromWKB('\\x00\\x01\\x02'::BLOB) IS NULL AS a, ST_3DTryFromWKB(NULL) IS NULL AS b",
    );
    expect(junk[0]).toMatchObject({ a: true, b: true });
  });

  it("refuses a bare NULL: ST_3DValidationReport has a SOLID_3D and a BLOB overload", () => {
    // A unit test that spells `ST_3DValidationReport(NULL)` never runs. The
    // cast is not optional.
    expect(() =>
      db.query("SELECT ST_3DValidationReport(NULL) IS NULL AS n"),
    ).toThrow(/Could not choose a best candidate function/);
  });

  it("makes a CONSTANT NULL's report NULL — and only a constant one", () => {
    const rows = db.query(
      "SELECT ST_3DValidationReport(NULL::SOLID_3D) IS NULL AS report_null, ST_3DValidationReport(NULL::SOLID_3D).is_valid IS NULL AS flag_null",
    );
    expect(rows[0]).toMatchObject({ report_null: true, flag_null: true });
  });

  it("tells a NULL solid's report apart ONLY by `s IS NULL` — the field reads are GARBAGE", () => {
    // THE trap of this milestone, and the reason `MEASURE_SQL` deviates from
    // the plan's §7.2 text. For a solid that is NULL at RUN time (the row that
    // is a MultiSurface), `three_d` v0.2.0 sets the report struct's own
    // validity mask but leaves its CHILD vectors uninitialised: the struct
    // reads NULL while every field read out of it returns whatever was in
    // memory. `r.is_valid` came back `false` on one run of this very statement
    // and `true` on another, with garbage BIGINT counts (`solid_count`
    // 144117620806271230) beside it — so this case asserts only that the field
    // is NOT NULL, never which value, and pins the guard that fixes it.
    //
    // The same applies to `r.code` and `r.message`: a `length(r.message)` over
    // this vector returned 2_464_399 once and crashed the wasm instance with
    // "memory access out of bounds" another time. NEVER read a report field
    // without the `s IS NOT NULL` guard.
    const rows = db.query(
      `SELECT ST_3DValidationReport(s) IS NULL AS report_null, r.is_valid IS NOT NULL AS raw_field_not_null, CASE WHEN s IS NOT NULL THEN r.is_valid END IS NULL AS guarded_null FROM (SELECT ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${NOT_A_SOLID}')`,
    );
    expect(rows[0]).toMatchObject({
      report_null: true,
      raw_field_not_null: true,
      guarded_null: true,
    });
  });

  it("RAISES on ST_3DVolume over an unclosed solid, poisoning the statement", () => {
    // The reason `CASE WHEN r.is_valid THEN ST_3DVolume(s) END` is the ONLY
    // shape the plan allows. Unguarded, ONE bad building fails the run.
    expect(() =>
      db.query(
        `SELECT ST_3DVolume(ST_3DTryFromWKB("geometry_lod2_2")) FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${INVALID}'`,
      ),
    ).toThrow(/solid is not closed/);
  });

  it("answers every OTHER measure on an invalid solid", () => {
    const rows = db.query(
      `SELECT ST_3DSurfaceArea(s) AS a, ST_3DFootprintArea(s) AS f, ST_3DZMin(s) AS lo, ST_3DZMax(s) AS hi, ST_3DIsClosed(s) AS closed, ST_3DIsManifold(s) AS man, ST_3DIsOriented(s) AS ori, ST_3DNumShells(s) AS shells, ST_3DNumFaces(s) AS faces FROM (SELECT ST_3DTryFromWKB("geometry_lod2_2") AS s FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${INVALID}')`,
    );
    expectRow(rows[0], {
      a: 388,
      f: 80,
      lo: 0,
      hi: 8.4,
      closed: false,
      man: false,
      ori: false,
      shells: 1,
      faces: 7,
    });
  });

  it("runs §7.2's one statement over all three rows and measures EVERY column", () => {
    const byId = new Map(
      db.query(MEASURE_SQL).map((r) => [String(r["id"]), r]),
    );

    // Volume is NULL because the guard refused it — not because the solid has
    // none. §7.2: "volume NULL, valid false; envelope, footprint, height,
    // ground and ridge still computed".
    expectRow(byId.get(INVALID), {
      // §7's roll-up ground: the part below belongs to the same FEATURE as this
      // root, so a run must group on `f` and not on `id`.
      f: INVALID,
      parsed: true,
      is_valid: false,
      volume_m3: null,
      envelope_m2: 388,
      footprint_m2: 80,
      ground_m: 0,
      ridge_m: 8.4,
    });
    expectRow(byId.get(NOT_A_SOLID), {
      f: INVALID,
      parsed: false,
      is_valid: null,
      volume_m3: null,
      envelope_m2: null,
      footprint_m2: null,
      ground_m: null,
      ridge_m: null,
    });
    expectRow(byId.get(VALID), {
      f: VALID,
      parsed: true,
      is_valid: true,
      volume_m3: 2178,
      envelope_m2: 1013.4,
      footprint_m2: 180,
      ground_m: 0,
      ridge_m: 12.1,
    });
  });

  it("reports the EIGHT §7.3 report fields on a parsed solid, valid or not", () => {
    // Every field read carries the `s IS NOT NULL` guard, for the reason the
    // case above pins. Task 10's `buildSolidValidationSql` must do the same on
    // all eight, or an unparsed row gets garbage counts instead of NULL.
    const byId = new Map(
      db.query(VALIDATE_SQL).map((r) => [String(r["id"]), r]),
    );
    expectRow(byId.get(INVALID), {
      f: INVALID,
      parsed: true,
      is_valid: false,
      is_closed: false,
      is_manifold: false,
      is_oriented: false,
      open_n: 2,
      nm_n: 1,
      deg_n: 0,
      // The plan's field list omits `orientation_error_count`; the struct has
      // it, and it counts the faces this solid winds the wrong way.
      ori_n: 1,
    });
    // The unparsed row gets NULL in all eight — never a zero count, which would
    // read as "checked and found nothing wrong".
    expectRow(byId.get(NOT_A_SOLID), {
      f: INVALID,
      parsed: false,
      is_valid: null,
      is_closed: null,
      is_manifold: null,
      is_oriented: null,
      open_n: null,
      nm_n: null,
      deg_n: null,
      ori_n: null,
    });
    expectRow(byId.get(VALID), {
      f: VALID,
      parsed: true,
      is_valid: true,
      is_closed: true,
      is_manifold: true,
      is_oriented: true,
      open_n: 0,
      nm_n: 0,
      deg_n: 0,
      ori_n: 0,
    });
  });

  it("answers ST_3DArea and ST_3DBounds, on the valid solid and the invalid one", () => {
    // The plan states `ST_3DArea` is the same value as `ST_3DSurfaceArea` on
    // these fixtures and that `ST_3DBounds` is a
    // `STRUCT(min_x, min_y, min_z, max_x, max_y, max_z)`. Both unprobed until
    // now, and both answer on an INVALID solid as well as a valid one — which
    // is the property that lets a measure run report a bad building's extent.
    const byId = new Map(
      db
        .query(
          `SELECT "id", ST_3DArea(s) AS area, ST_3DSurfaceArea(s) AS surface, ST_3DBounds(s) AS b FROM (SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") AS s FROM read_cityjson('${SOURCE}', lod => '${LOD}'))`,
        )
        .map((r) => [String(r["id"]), r]),
    );

    for (const id of [INVALID, VALID]) {
      const row = byId.get(id);
      expect(row?.["area"], id).toBe(row?.["surface"]);
    }
    expect(byId.get(INVALID)?.["area"]).toBe(388);
    expect(byId.get(VALID)?.["area"]).toBeCloseTo(1013.4, 6);
    // A NULL solid gives a NULL area, not a zero.
    expect(byId.get(NOT_A_SOLID)?.["area"]).toBeNull();
    expect(byId.get(NOT_A_SOLID)?.["b"]).toBeNull();

    // The translate is [85000, 446000, 0] and the scale 0.001, so the bounds
    // come back in the file's own CRS, not in local vertex units.
    expect(byId.get(VALID)?.["b"]).toMatchObject({
      min_x: 85020,
      min_y: 446000,
      min_z: 0,
      max_x: 85035,
      max_y: 446012,
      max_z: 12.1,
    });
    expect(byId.get(INVALID)?.["b"]).toMatchObject({
      min_x: 85000,
      min_y: 446000,
      min_z: 0,
      max_x: 85010,
      max_y: 446008,
      max_z: 8.4,
    });
  });

  it("behaves identically through read_cityjsonseq — every row, every column", () => {
    // Not "some solid parses": the SAME two statements, with only the reader
    // call swapped, must return the SAME rows. `two-buildings.city.jsonl`
    // carries the same three objects across two CityJSONFeature lines, so a
    // reader that lost a part, renamed a feature id or measured differently
    // shows up here.
    db.register("two.city.jsonl", "two-buildings.city.jsonl");
    const byIdAsc = (rows: Record<string, unknown>[]) =>
      [...rows].sort((a, b) => String(a["id"]).localeCompare(String(b["id"])));

    const measured = byIdAsc(db.query(throughSeq(MEASURE_SQL)));
    expect(measured.map((r) => r["id"])).toEqual([INVALID, NOT_A_SOLID, VALID]);
    expect(measured).toEqual(byIdAsc(db.query(MEASURE_SQL)));
    // Spelled out on the seq side too, so the parity assertions cannot pass by
    // both readers being wrong in the same way.
    expectRow(measured[2], {
      id: VALID,
      f: VALID,
      parsed: true,
      is_valid: true,
      volume_m3: 2178,
      envelope_m2: 1013.4,
      footprint_m2: 180,
      ground_m: 0,
      ridge_m: 12.1,
    });
    expectRow(measured[1], {
      id: NOT_A_SOLID,
      f: INVALID,
      parsed: false,
      is_valid: null,
      volume_m3: null,
      envelope_m2: null,
      footprint_m2: null,
      ground_m: null,
      ridge_m: null,
    });

    const validated = byIdAsc(db.query(throughSeq(VALIDATE_SQL)));
    expect(validated).toEqual(byIdAsc(db.query(VALIDATE_SQL)));
    expectRow(validated[0], {
      id: INVALID,
      f: INVALID,
      parsed: true,
      is_valid: false,
      is_closed: false,
      is_manifold: false,
      is_oriented: false,
      open_n: 2,
      nm_n: 1,
      deg_n: 0,
      ori_n: 1,
    });
    expectRow(validated[2], {
      id: VALID,
      f: VALID,
      parsed: true,
      is_valid: true,
      is_closed: true,
      is_manifold: true,
      is_oriented: true,
      open_n: 0,
      nm_n: 0,
      deg_n: 0,
      ori_n: 0,
    });
    expectRow(validated[1], {
      id: NOT_A_SOLID,
      f: INVALID,
      parsed: false,
      is_valid: null,
      is_closed: null,
      is_manifold: null,
      is_oriented: null,
      open_n: null,
      nm_n: null,
      deg_n: null,
      ori_n: null,
    });
  });

  // The repo carried no CompositeSolid; Decisions recorded item 4 settled that
  // one IS added, so this is a real case and not a skip. Two unit cubes side by
  // side: the parse must succeed, the report must read valid, and the volume
  // must be the SUM of the members — which is the fact Task 7's §7 roll-up
  // rests on.
  it("parses a CompositeSolid and sums its members' volume", () => {
    db.register("composite.city.json", "composite-solid.city.json");
    const rows = db.query(
      `SELECT cityjson_wkb_geometry_type("geometry_lod2_2") AS wkb,
              "geometry_properties_lod2_2".type AS ptype,
              CASE WHEN s IS NOT NULL THEN r.is_valid END AS valid,
              CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END AS volume,
              ST_3DNumShells(s) AS shells, ST_3DNumFaces(s) AS faces,
              CASE WHEN s IS NOT NULL THEN r.is_closed END AS closed,
              CASE WHEN s IS NOT NULL THEN r.is_manifold END AS man,
              CASE WHEN s IS NOT NULL THEN r.is_oriented END AS ori,
              CASE WHEN s IS NOT NULL THEN r.solid_count END AS solid_n,
              CASE WHEN s IS NOT NULL THEN r.shell_count END AS shell_n,
              CASE WHEN s IS NOT NULL THEN r.face_count END AS face_n,
              CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n,
              CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n,
              CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n,
              CASE WHEN s IS NOT NULL THEN r.orientation_error_count END AS ori_n,
              ST_3DSurfaceArea(s) AS envelope, ST_3DFootprintArea(s) AS footprint
       FROM (SELECT "geometry_lod2_2", "geometry_properties_lod2_2",
                    ST_3DTryFromWKB("geometry_lod2_2") AS s,
                    ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r
             FROM read_cityjson('composite.city.json', lod => '2.2'))`,
    );
    // A CompositeSolid's WKB is a GeometryCollection Z, NOT the
    // "PolyhedralSurface Z" a plain Solid carries: a task that keyed "is this
    // a solid?" on the WKB type string would drop every CompositeSolid. The
    // CityJSON type in the properties struct is the reliable answer.
    expect(rows[0]?.["wkb"]).toBe("GeometryCollection Z");
    expect(rows[0]?.["ptype"]).toBe("CompositeSolid");
    // Both members counted: two shells, twelve faces (six each), and the
    // SUMMED volume — the fact Task 7's §7 roll-up rests on. The two unit
    // cubes share the face x = 1, so the envelope is the 12 outer unit squares
    // and the footprint the 2 × 1 ground rectangle.
    expectRow(rows[0], {
      valid: true,
      // The shared face x = 1 belongs to both members, and the report still
      // reads the composite as closed, manifold and correctly oriented.
      closed: true,
      man: true,
      ori: true,
      volume: 2,
      // The two ways of counting agree: the standalone measures and the
      // report's own `shell_count` / `face_count`.
      shells: 2,
      faces: 12,
      solid_n: 2,
      shell_n: 2,
      face_n: 12,
      open_n: 0,
      nm_n: 0,
      deg_n: 0,
      ori_n: 0,
      envelope: 12,
      footprint: 2,
    });
  });

  // The FEATURE-level invalid solid. `two-buildings.city.json` cannot express
  // one: its `NL.IMBAG.Pand.0001` has a MultiSurface PART at 2.2, so §7's
  // contributor rule reads the whole feature as "not a solid". This fixture is
  // that same solid on a building with NO parts, so a run over it measures one
  // building and withholds one volume — which is what every FEATURE-level
  // "invalid solid" expectation in this milestone rests on.
  it("measures the invalid-solid fixture: every measure but the volume", () => {
    db.register("invalid.city.json", "invalid-solid.city.json");
    const rows = db.query(
      `SELECT "id", s IS NOT NULL AS parsed,
              CASE WHEN s IS NOT NULL THEN r.is_valid END AS valid,
              CASE WHEN s IS NOT NULL THEN r.is_closed END AS closed,
              CASE WHEN s IS NOT NULL THEN r.is_manifold END AS man,
              CASE WHEN s IS NOT NULL THEN r.is_oriented END AS ori,
              CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n,
              CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n,
              CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n,
              CASE WHEN s IS NOT NULL THEN r.orientation_error_count END AS ori_n,
              CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END AS volume,
              ST_3DSurfaceArea(s) AS envelope, ST_3DFootprintArea(s) AS footprint,
              ST_3DZMin(s) AS ground, ST_3DZMax(s) AS ridge
       FROM (SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") AS s,
                    ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r
             FROM read_cityjson('invalid.city.json', lod => '2.2'))`,
    );
    expect(rows).toHaveLength(1);
    // The same numbers `NL.IMBAG.Pand.0001` gives in `two-buildings.city.json`
    // — the fixture is that solid lifted out, so the two files must agree.
    expectRow(rows[0], {
      id: INVALID,
      parsed: true,
      valid: false,
      closed: false,
      man: false,
      ori: false,
      open_n: 2,
      nm_n: 1,
      deg_n: 0,
      ori_n: 1,
      volume: null,
      envelope: 388,
      footprint: 80,
      ground: 0,
      ridge: 8.4,
    });
  });
});
