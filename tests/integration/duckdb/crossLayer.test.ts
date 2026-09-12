// @vitest-environment node
/**
 * Every `spatial` fact the M3 cross-layer tools rest on, against a REAL
 * DuckDB 1.5.5 with core `spatial`.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 *
 * The two decisive ones are negative: `ST_GeomFromWKB` REFUSES a
 * PolyhedralSurface Z (which is every solid LoD, so a footprint proxy is only
 * ever offered where the target has an LoD 0 column), and
 * `ST_GeomFromGeoJSON` returns an EMPTY geometry rather than NULL for a
 * polygon with `[]` coordinates (so preflight must test `ST_IsEmpty` as well
 * as `IS NULL`, or an empty area would silently match nothing while being
 * counted as usable).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Harness } from "./harness";

const enabled = process.env.DUCKDB_INTEGRATION === "1";

const SOURCE = "two.city.json";
const LOD = "2.2";
const NOT_A_SOLID = "NL.IMBAG.Pand.0001-part1";
const VALID = "NL.IMBAG.Pand.0002";

/** The per-run vector table's name shape (`vectorTableName`, Task 13). */
const VECTOR_TABLE = "__src_run_probe";
const VECTOR_FILE = "__src_run_probe.json";

/**
 * Two areas, as the app will hand them over: NDJSON, one object per line,
 * already reprojected 2-D WKT in the city layer's CRS, each carrying its
 * SOURCE-ORDER index, its stable feature id, its GeoJSON feature id and its
 * public properties NESTED under `props`.
 *
 * The nesting is the point of the probe: `props` must come back as JSON so
 * `props->>'name'` and `(props->>'n')::DOUBLE` work, which is why the read
 * below spells `columns=` instead of using `read_json_auto`. Same field names
 * as Task 13's `encodeProjectedFeatures` — the fixture and the encoder are one
 * shape, so a change to either fails here.
 */
const VECTOR_NDJSON = [
  {
    idx: 0,
    sid: "f-a",
    fid: "a",
    props: { name: "A", n: 3 },
    wkt: "POLYGON ((0 0, 100 0, 100 100, 0 100, 0 0))",
  },
  {
    idx: 1,
    sid: "f-b",
    fid: "b",
    props: { name: "B", n: 7 },
    wkt: "POLYGON ((50 0, 150 0, 150 100, 50 100, 50 0))",
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

/**
 * Tasks 13, 14, 16 and 19 APPEND their own cases INSIDE this `describe`, at the
 * bottom, beside the ones below — `db` is the block's own binding and there is
 * ONE harness for the file, opened once here. An appended case that opens its
 * own harness pays the extension download again and races this one's `afterAll`.
 * Some of those appended cases are `async` (they await the app's own encoder);
 * the `it` signature is per case, so that is no constraint on this block.
 */
describe.skipIf(!enabled)("spatial against real DuckDB 1.5.5", () => {
  let db: Harness;

  beforeAll(async () => {
    const harness = await import("./harness");
    db = await harness.openDuckDB();
    harness.installExtension(db, "spatial");
    db.register(SOURCE, "two-buildings.city.json");
    db.registerBytes(VECTOR_FILE, new TextEncoder().encode(VECTOR_NDJSON));
  }, 180_000);

  afterAll(() => {
    db?.dropFile(VECTOR_FILE);
    db?.close();
  });

  it("RAISES on a PolyhedralSurface Z, which is every solid LoD column", () => {
    // Why a footprint proxy is offered ONLY where the target has an LoD 0
    // geometry column AND a reader (`proxyOptions`, Task 14).
    expect(() =>
      db.query(
        `SELECT ST_GeomFromWKB("geometry_lod2_2") FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${VALID}'`,
      ),
    ).toThrow(/Unsupported geometry type in WKB/);
  });

  it("parses a MultiPolygon Z — the shape an LoD 0 column carries — keeping Z", () => {
    // `ST_NDims` does NOT exist in this spatial build (Catalog Error, "did you
    // mean st_crs"); `ST_HasZ` is the one that answers, and `ST_Dimension` is
    // the TOPOLOGICAL dimension (2 for a polygon), not the coordinate count.
    const rows = db.query(
      `SELECT ST_Area(g) AS area, ST_HasZ(g) AS has_z, ST_Dimension(g) AS dim FROM (SELECT ST_GeomFromWKB("geometry_lod2_2") AS g FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${NOT_A_SOLID}')`,
    );
    // ST_Area is the 2-D area even on a Z geometry.
    expect(Number(rows[0]?.["area"])).toBeGreaterThan(0);
    expect(rows[0]?.["has_z"]).toBe(true);
    expect(Number(rows[0]?.["dim"])).toBe(2);
  });

  it("returns an EMPTY geometry, not NULL, for a polygon with [] coordinates", () => {
    // The NULL needs its cast: `ST_GeomFromGeoJSON` has a VARCHAR and a JSON
    // overload, and a bare NULL is a Binder Error rather than a NULL result.
    const rows = db.query(
      `SELECT ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[]}') IS NULL AS is_null, ST_IsEmpty(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[]}')) AS is_empty, ST_GeomFromGeoJSON(NULL::VARCHAR) IS NULL AS null_in`,
    );
    expect(rows[0]).toMatchObject({
      is_null: false,
      is_empty: true,
      null_in: true,
    });
  });

  it("refuses a bare NULL in ST_GeomFromGeoJSON — VARCHAR and JSON overloads", () => {
    expect(() =>
      db.query("SELECT ST_GeomFromGeoJSON(NULL) IS NULL AS n"),
    ).toThrow(/Could not choose a best candidate function/);
  });

  it("builds the two bbox proxies from an extent struct", () => {
    const rows = db.query(
      "SELECT ST_Area(ST_MakeEnvelope(0, 0, 10, 20)) AS a, ST_AsText(ST_Point(3, 4)) AS p",
    );
    expect(Number(rows[0]?.["a"])).toBeCloseTo(200, 6);
    expect(String(rows[0]?.["p"])).toContain("POINT");
  });

  it("round-trips the per-run vector table from NDJSON, stable id included", () => {
    // The FACT, spelled literally: `read_json` with an explicit `columns=`
    // (never `read_json_auto`, which reads `props` back as a STRUCT), and WKT
    // into GEOMETRY with `ST_GeomFromText`. Task 13 appends a case to this file
    // running `buildVectorTableSql`'s own output against this engine; the TEXT
    // is that task's to pin, not this one's.
    db.query(
      `CREATE OR REPLACE TABLE "${VECTOR_TABLE}" AS SELECT "idx", "sid", "fid", "props", ST_GeomFromText("wkt") AS "geom" FROM read_json('${VECTOR_FILE}', format = 'newline_delimited', columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', props: 'JSON', wkt: 'VARCHAR'})`,
    );
    const rows = db.query(
      `SELECT "idx", "sid", "fid", "props"->>'name' AS name, ("props"->>'n')::DOUBLE AS n, json_keys("props") AS keys, ST_IsEmpty("geom") AS empty FROM "${VECTOR_TABLE}" ORDER BY "idx"`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sid: "f-a", fid: "a", name: "A" });
    expect(Number(rows[0]?.["idx"])).toBe(0);
    expect(rows[0]?.["empty"]).toBe(false);
    expect(Number(rows[1]?.["n"])).toBe(7);
    // `json_keys` is what §7.5's fields checklist would use if it read the
    // table rather than the document; pinned so the JSON type is not silently
    // inferred away.
    const keys = (rows[0]?.["keys"] ?? []) as Iterable<string>;
    expect(Array.from(keys).sort()).toEqual(["n", "name"]);
  });

  it("answers the three predicates, and counts a boundary hit in BOTH areas", () => {
    // §7.6: "a building on a boundary counts in both areas". x=75 is inside
    // both; x=25 only in A; the centre exactly on the shared edge (x=50)
    // matches both, which is why the tie rule is source order.
    const rows = db.query(
      `SELECT p.x, COUNT(*) FILTER (WHERE ST_Intersects(ST_Point(p.x, 50), s.geom)) AS hits FROM (SELECT UNNEST([25, 50, 75]) AS x) p, "${VECTOR_TABLE}" s GROUP BY p.x ORDER BY p.x`,
    );
    const byX = new Map(rows.map((r) => [Number(r["x"]), Number(r["hits"])]));
    expect(byX.get(25)).toBe(1);
    expect(byX.get(50)).toBe(2);
    expect(byX.get(75)).toBe(2);

    const within = db.query(
      `SELECT COUNT(*) AS n FROM "${VECTOR_TABLE}" s WHERE ST_Within(ST_MakeEnvelope(10, 10, 20, 20), s.geom)`,
    );
    expect(Number(within[0]?.["n"])).toBe(1);
  });

  it("needs ST_CoveredBy, not ST_Within, for a boundary-inclusive 'inside'", () => {
    // The point (50, 50) is INTERIOR to A and sits exactly on B's x = 50 edge.
    // `ST_Within` is interior-only and so counts it once; `ST_CoveredBy` and
    // `ST_Intersects` count it in both. §7.6's "a building on a boundary
    // counts in both areas" is therefore `ST_CoveredBy` — a tool that reached
    // for `ST_Within` would silently drop every boundary building.
    const rows = db.query(
      `SELECT COUNT(*) FILTER (WHERE ST_Within(ST_Point(50, 50), s.geom)) AS within_n, COUNT(*) FILTER (WHERE ST_CoveredBy(ST_Point(50, 50), s.geom)) AS covered_n, COUNT(*) FILTER (WHERE ST_Intersects(ST_Point(50, 50), s.geom)) AS intersects_n FROM "${VECTOR_TABLE}" s`,
    );
    expect(Number(rows[0]?.["within_n"])).toBe(1);
    expect(Number(rows[0]?.["covered_n"])).toBe(2);
    expect(Number(rows[0]?.["intersects_n"])).toBe(2);
  });

  it("ranks overlapping areas by ST_Area(ST_Intersection(…)), ties to source order", () => {
    // The "largest overlap" tie rule (§7.5): a footprint from x=40 to x=120
    // overlaps A by 10 and B by 70, so B wins; `arg_min(idx, …)` on equal
    // areas would keep the lower idx, which is source order.
    const rows = db.query(
      `SELECT s.idx, ST_Area(ST_Intersection(ST_MakeEnvelope(40, 10, 120, 20), s.geom)) AS ov FROM "${VECTOR_TABLE}" s ORDER BY ov DESC, s.idx ASC`,
    );
    expect(Number(rows[0]?.["idx"])).toBe(1);
    expect(Number(rows[0]?.["ov"])).toBeCloseTo(700, 6);
  });

  it("finds the nearest source feature with MIN(ST_Distance) and arg_min", () => {
    const rows = db.query(
      `SELECT MIN(ST_Distance(ST_Point(200, 50), s.geom)) AS d, arg_min(s.idx, ST_Distance(ST_Point(200, 50), s.geom)) AS nearest FROM "${VECTOR_TABLE}" s`,
    );
    expect(Number(rows[0]?.["d"])).toBeCloseTo(50, 6);
    expect(Number(rows[0]?.["nearest"])).toBe(1);
    // 0 when they touch or overlap (§7.7).
    const touching = db.query(
      `SELECT MIN(ST_Distance(ST_Point(10, 10), s.geom)) AS d FROM "${VECTOR_TABLE}" s`,
    );
    expect(Number(touching[0]?.["d"])).toBe(0);
  });

  it("LEFT JOINs buildings to areas, leaving the unmatched ones NULL", () => {
    // The copied field is read out of the JSON `props` column — the table has
    // no `name` column of its own, and §7.5's copy is always a key lookup.
    const rows = db.query(
      `SELECT b.x, s."props"->>'name' AS name FROM (SELECT UNNEST([25, 400]) AS x) b LEFT JOIN "${VECTOR_TABLE}" s ON ST_Intersects(ST_Point(b.x, 50), s.geom) ORDER BY b.x`,
    );
    expect(rows[0]).toMatchObject({ name: "A" });
    expect(rows[1]?.["name"]).toBeNull();
  });

  it("reads GeoJSON properties back by key, and lists them", () => {
    const rows = db.query(
      `SELECT props->>'name' AS name, (props->>'n')::DOUBLE AS n, json_keys(props) AS keys FROM (SELECT '{"name":"A","n":3}'::JSON AS props)`,
    );
    expect(rows[0]?.["name"]).toBe("A");
    expect(Number(rows[0]?.["n"])).toBe(3);
    expect(String(rows[0]?.["keys"])).toContain("name");
  });

  it("needs the CAST to DOUBLE before median() — the M2 DECIMAL trap", () => {
    const rows = db.query(
      "SELECT median(CAST(v AS DOUBLE)) AS m FROM (SELECT UNNEST([1.5::DECIMAL(18,3), 2.5::DECIMAL(18,3), 9.5::DECIMAL(18,3)]) AS v)",
    );
    // Without the cast the value arrives as a DECIMAL object and
    // `typeof value === "number"` in `RunFooter` is false, so Style by result
    // would report "All values are empty" over a column full of numbers.
    expect(typeof rows[0]?.["m"]).toBe("number");
    expect(Number(rows[0]?.["m"])).toBeCloseTo(2.5, 6);
  });
});
