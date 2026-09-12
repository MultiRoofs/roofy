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
 * DEVIATES from the plan's §7.2 text in ONE clause, forced by the engine and
 * verified here 2026-09-12: the plan reads `r.is_valid AS is_valid` and rests
 * on "`ST_3DValidationReport(NULL)` is NULL, so `r.is_valid` is NULL rather
 * than false". That holds for a CONSTANT NULL only. Over a row vector,
 * `three_d` v0.2.0 leaves the report's CHILD vectors untouched for a NULL
 * solid: `ST_3DValidationReport(s) IS NULL` is true, yet `r.is_valid` reads
 * uninitialised memory — observed both `false` and `true` for the SAME row on
 * two runs, with garbage BIGINT counts beside it. So every read of a report
 * field is wrapped in `CASE WHEN s IS NOT NULL THEN … END`, which restores
 * exactly the §7.2 output (`valid` NULL for a row that is not a solid).
 * See the "tells a NULL solid's report apart" case below for the pin.
 */
const MEASURE_SQL = `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid, CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('two.city.json', lod => '2.2'))`;

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
    const row = rows[0];
    expect(row).toBeDefined();
    expect(Number(row?.["a"])).toBeCloseTo(388, 0);
    expect(Number(row?.["f"])).toBeCloseTo(80, 0);
    expect(Number(row?.["lo"])).toBeCloseTo(0, 3);
    expect(Number(row?.["hi"])).toBeCloseTo(8.4, 1);
    expect(row?.["closed"]).toBe(false);
    expect(Number(row?.["shells"])).toBeGreaterThan(0);
    expect(Number(row?.["faces"])).toBeGreaterThan(0);
  });

  it("runs §7.2's one statement over all three rows and measures each correctly", () => {
    const rows = db.query(MEASURE_SQL);
    const byId = new Map(rows.map((r) => [String(r["id"]), r]));

    const invalid = byId.get(INVALID);
    expect(invalid?.["parsed"]).toBe(true);
    expect(invalid?.["is_valid"]).toBe(false);
    // Volume is NULL because the guard refused it — not because the solid has
    // none. §7.2: "volume NULL, valid false; envelope, footprint, height,
    // ground and ridge still computed".
    expect(invalid?.["volume_m3"]).toBeNull();
    expect(Number(invalid?.["envelope_m2"])).toBeCloseTo(388, 0);
    expect(Number(invalid?.["footprint_m2"])).toBeCloseTo(80, 0);
    expect(Number(invalid?.["ridge_m"])).toBeCloseTo(8.4, 1);

    const notASolid = byId.get(NOT_A_SOLID);
    expect(notASolid?.["parsed"]).toBe(false);
    expect(notASolid?.["is_valid"]).toBeNull();
    expect(notASolid?.["envelope_m2"]).toBeNull();

    const valid = byId.get(VALID);
    expect(valid?.["is_valid"]).toBe(true);
    expect(Number(valid?.["volume_m3"])).toBeCloseTo(2178, 0);
    expect(Number(valid?.["envelope_m2"])).toBeCloseTo(1013.4, 0);
    expect(Number(valid?.["footprint_m2"])).toBeCloseTo(180, 0);
    expect(Number(valid?.["ground_m"])).toBeCloseTo(0, 3);
    expect(Number(valid?.["ridge_m"])).toBeCloseTo(12.1, 1);

    // §7's roll-up ground: the part belongs to the same FEATURE as the root,
    // so a run must group on `f` and not on `id`.
    expect(String(byId.get(NOT_A_SOLID)?.["f"])).toBe(INVALID);
  });

  it("reports the seven §7.3 fields on a parsed solid, valid or not", () => {
    // Every field read carries the `s IS NOT NULL` guard, for the reason the
    // case above pins. Task 10's `buildSolidValidationSql` must do the same on
    // all seven, or an unparsed row gets garbage counts instead of NULL.
    const rows = db.query(
      `SELECT "id", CASE WHEN s IS NOT NULL THEN r.is_closed END AS closed, CASE WHEN s IS NOT NULL THEN r.is_manifold END AS man, CASE WHEN s IS NOT NULL THEN r.is_oriented END AS ori, CASE WHEN s IS NOT NULL THEN r.is_valid END AS valid, CASE WHEN s IS NOT NULL THEN r.open_edge_count END AS open_n, CASE WHEN s IS NOT NULL THEN r.non_manifold_edge_count END AS nm_n, CASE WHEN s IS NOT NULL THEN r.degenerate_face_count END AS deg_n FROM (SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('${SOURCE}', lod => '${LOD}')) ORDER BY "id"`,
    );
    const byId = new Map(rows.map((r) => [String(r["id"]), r]));
    expect(byId.get(INVALID)).toMatchObject({ closed: false, valid: false });
    expect(Number(byId.get(INVALID)?.["open_n"])).toBe(2);
    expect(Number(byId.get(INVALID)?.["nm_n"])).toBe(1);
    expect(byId.get(VALID)).toMatchObject({
      closed: true,
      man: true,
      ori: true,
      valid: true,
    });
    // The unparsed row gets NULL in all seven — never a zero count, which
    // would read as "checked and found nothing wrong".
    expect(byId.get(NOT_A_SOLID)?.["valid"]).toBeNull();
    expect(byId.get(NOT_A_SOLID)?.["open_n"]).toBeNull();
  });

  it("behaves identically through read_cityjsonseq", () => {
    db.register("two.city.jsonl", "two-buildings.city.jsonl");
    const rows = db.query(
      `SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") IS NOT NULL AS parsed FROM read_cityjsonseq('two.city.jsonl', lod => '${LOD}') ORDER BY "id"`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r["parsed"] === true)).toBe(true);
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
              CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume,
              ST_3DNumShells(s) AS shells
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
    expect(rows[0]?.["valid"]).toBe(true);
    expect(Number(rows[0]?.["volume"])).toBeCloseTo(2, 6);
    expect(Number(rows[0]?.["shells"])).toBe(2);
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
      `SELECT "id", s IS NOT NULL AS parsed, r.is_valid AS valid, r.is_closed AS closed,
              r.open_edge_count AS open_n, r.non_manifold_edge_count AS nm_n,
              CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume,
              ST_3DSurfaceArea(s) AS envelope, ST_3DFootprintArea(s) AS footprint,
              ST_3DZMin(s) AS ground, ST_3DZMax(s) AS ridge
       FROM (SELECT "id", ST_3DTryFromWKB("geometry_lod2_2") AS s,
                    ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r
             FROM read_cityjson('invalid.city.json', lod => '2.2'))`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ parsed: true, valid: false, closed: false });
    expect(Number(row?.["open_n"])).toBe(2);
    expect(Number(row?.["nm_n"])).toBe(1);
    expect(row?.["volume"]).toBeNull();
    expect(Number(row?.["envelope"])).toBeCloseTo(388, 0);
    expect(Number(row?.["footprint"])).toBeCloseTo(80, 0);
    expect(Number(row?.["ground"])).toBeCloseTo(0, 3);
    expect(Number(row?.["ridge"])).toBeCloseTo(8.4, 1);
  });
});
