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
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { Harness } from "./harness";
import {
  buildDropVectorTableSql,
  buildVectorTableSql,
  encodeProjectedFeatures,
  vectorTableName,
} from "../../../src/features/processing/vectorTable";

/**
 * The engine seam, stubbed out entirely — the same reason
 * `computedColumns.test.ts` does it. `vectorTable.ts` imports `insights/duckdb`
 * for `registerBuffer`/`ddl`, and `insights/duckdb` imports the BROWSER bundle
 * of `@duckdb/duckdb-wasm` at module scope; this file is `node`, and the
 * default offline run COLLECTS it before skipping it. Nothing here may reach
 * the seam either — this suite talks to the node bindings through the harness —
 * so every stub throws, and only the builders and the encoder (which touch
 * none of it) are used.
 */
vi.mock("../../../src/insights/duckdb", () => {
  const unreachable = () => {
    throw new Error("this suite talks to the harness, not to insights/duckdb");
  };
  return {
    initDuckDB: unreachable,
    subscribeDuckDBStatus: () => () => {},
    getDuckDBStatusVersion: () => 0,
    getEngineGeneration: () => 1,
    onEngineDeath: () => () => {},
    getDuckDBStatus: unreachable,
    isExtensionLoaded: unreachable,
    ensureExtension: unreachable,
    formatDuckDBError: unreachable,
    queryDuckDB: unreachable,
    queryParquetBuffer: unreachable,
    runQuery: unreachable,
    ddl: unreachable,
    registerBuffer: unreachable,
    dropBuffer: unreachable,
    readFile: unreachable,
  };
});

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
 * The FACT, spelled literally: `read_json` with an explicit `columns=` (never
 * `read_json_auto`, which reads `props` back as a STRUCT), and WKT into
 * GEOMETRY with `ST_GeomFromText`. Task 13 appends a case running
 * `buildVectorTableSql`'s own output against this engine; the TEXT is that
 * task's to pin, not this one's.
 */
const VECTOR_TABLE_SQL = `CREATE OR REPLACE TABLE "${VECTOR_TABLE}" AS SELECT "idx", "sid", "fid", "props", ST_GeomFromText("wkt") AS "geom" FROM read_json('${VECTOR_FILE}', format = 'newline_delimited', columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', props: 'JSON', wkt: 'VARCHAR'})`;

/** A GeoJSON FeatureCollection, as a geo layer's own document hands it over. */
const FC_FILE = "__src_run_probe_fc.json";
const FEATURE_COLLECTION = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a",
      properties: { name: "A", n: 3 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "b",
      properties: { name: "B", n: 7 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [50, 0],
            [150, 0],
            [150, 100],
            [50, 100],
            [50, 0],
          ],
        ],
      },
    },
  ],
});

/** Whether THIS connection has the `json` extension loaded. */
function jsonLoaded(db: Harness): boolean {
  return (
    db.query(
      "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'json'",
    )[0]?.["loaded"] === true
  );
}

/** A Z polygon with a centre, an area and a height that are all exact. */
const Z_SQUARE = "POLYGON Z ((0 0 5, 10 0 5, 10 10 5, 0 10 5, 0 0 5))";
/** Its neighbour, overlapping it from x = 5 to x = 10. */
const Z_SQUARE_EAST = "POLYGON Z ((5 0 5, 15 0 5, 15 10 5, 5 10 5, 5 0 5))";

/**
 * Whether `ST_GeomFromGeoJSON(NULL)` binds at all depends on whether the `json`
 * extension is LOADED, and the FIRST `read_json` in a session loads it — which
 * the suite below does in its own `beforeAll`. So the unloaded state gets its
 * OWN describe, with its OWN engine: a connection no JSON expression has
 * touched. It runs first, it runs under `-t` filtering, and it needs no
 * conditional in the case body because the state is established by
 * construction rather than inherited.
 */
describe.skipIf(!enabled)("spatial BEFORE the json extension loads", () => {
  let db: Harness;

  beforeAll(async () => {
    const harness = await import("./harness");
    // A SECOND connection, deliberately: `openDuckDB` boots its own module
    // instance, so this one's extension state is independent of the suite
    // below's. The extension binaries are already downloaded by then, so the
    // extra boot costs about a second.
    db = await harness.openDuckDB();
    harness.installExtension(db, "spatial");
    db.registerBytes(VECTOR_FILE, new TextEncoder().encode(VECTOR_NDJSON));
  }, 180_000);

  afterAll(() => {
    db?.dropFile(VECTOR_FILE);
    db?.close();
  });

  it("refuses a bare NULL until the first read_json, and takes the cast either way", () => {
    expect(jsonLoaded(db)).toBe(false);
    // UNLOADED: two overloads, `(VARCHAR)` and `(JSON)`, and nothing to
    // choose between them.
    expect(() =>
      db.query("SELECT ST_GeomFromGeoJSON(NULL) IS NULL AS n"),
    ).toThrow(/Could not choose a best candidate function/);
    // The cast works in this state — it is the spelling every statement the
    // app emits uses, and the only one that is safe in BOTH states.
    expect(
      db.query("SELECT ST_GeomFromGeoJSON(NULL::VARCHAR) IS NULL AS n")[0]?.[
        "n"
      ],
    ).toBe(true);

    // The transition, by the very statement the suite below runs in setup:
    // `read_json` autoloads `json`.
    db.query(VECTOR_TABLE_SQL);
    expect(jsonLoaded(db)).toBe(true);

    // LOADED: the JSON overload wins and the SAME call now returns NULL
    // instead of raising. A builder that relied on the raise would be pinned
    // to session state; a builder that relied on the NULL would break in a
    // session that had not read JSON yet.
    expect(
      db.query("SELECT ST_GeomFromGeoJSON(NULL) IS NULL AS n")[0]?.["n"],
    ).toBe(true);
    expect(
      db.query("SELECT ST_GeomFromGeoJSON(NULL::VARCHAR) IS NULL AS n")[0]?.[
        "n"
      ],
    ).toBe(true);
  });
});

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
    db.registerBytes(FC_FILE, new TextEncoder().encode(FEATURE_COLLECTION));
    // The per-run table is built HERE, not inside the case that reads it back:
    // the predicate, overlap, distance and join cases all query it, and every
    // one of them must run alone under `vitest -t`.
    db.query(VECTOR_TABLE_SQL);
  }, 180_000);

  afterAll(() => {
    db?.dropFile(VECTOR_FILE);
    db?.dropFile(FC_FILE);
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
    // ST_Area is the 2-D area even on a Z geometry: the part is a 4 m × 5 m
    // box's ground and roof, so 40 m² of 2-D area over a 3.2 m tall shape.
    expect(rows[0]?.["area"]).toBe(40);
    expect(rows[0]?.["has_z"]).toBe(true);
    expect(rows[0]?.["dim"]).toBe(2);
    // The absence is the fact: a task reaching for the PostGIS spelling gets a
    // Catalog Error at run time, not a NULL.
    expect(() => db.query("SELECT ST_NDims(ST_Point(1, 2)) AS n")).toThrow(
      /st_ndims does not exist/,
    );
  });

  it("accepts a Z geometry in every predicate and measure the design uses", () => {
    // The plan lists ST_Intersects / ST_Within / ST_Distance / ST_Intersection
    // / ST_Area as Z-tolerant. Each is applied here to the reader's OWN
    // MultiPolygon Z against a 2-D probe, which is exactly the mix a
    // cross-layer run makes (city geometry Z, reprojected source geometry 2-D).
    const rows = db.query(
      `SELECT ST_Intersects(g, box) AS hit, ST_Within(box, g) AS inside, ST_Distance(g, ST_Point(85100, 446000)) AS far, ST_Area(ST_Intersection(g, box)) AS overlap, ST_Area(g) AS whole FROM (SELECT ST_GeomFromWKB("geometry_lod2_2") AS g, ST_MakeEnvelope(85012, 446000, 85016, 446005) AS box FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${NOT_A_SOLID}')`,
    );
    // The envelope is the part's own footprint, so it covers it exactly.
    expect(rows[0]?.["hit"]).toBe(true);
    expect(rows[0]?.["inside"]).toBe(true);
    expect(rows[0]?.["overlap"]).toBe(20);
    expect(rows[0]?.["whole"]).toBe(40);
    expect(rows[0]?.["far"]).toBeCloseTo(84, 6);
  });

  it("centres and flattens a Z geometry with ST_Centroid and ST_Force2D", () => {
    const rows = db.query(
      `SELECT ST_X(ST_Centroid(g)) AS cx, ST_Y(ST_Centroid(g)) AS cy, ST_AsText(ST_Centroid(g)) AS centre, ST_HasZ(ST_Centroid(g)) AS centre_has_z, ST_HasZ(ST_Force2D(g)) AS flat_has_z, ST_Area(ST_Force2D(g)) AS flat_area FROM (SELECT ST_GeomFromText('${Z_SQUARE}') AS g)`,
    );
    expect(rows[0]?.["cx"]).toBe(5);
    expect(rows[0]?.["cy"]).toBe(5);
    // The centroid of a Z polygon KEEPS its Z (`POINT Z (5 5 5)`) — only
    // `ST_Force2D` drops it, and it does so without touching the 2-D area. A
    // proxy point built with ST_Centroid is therefore still a 3-D geometry,
    // which matters for anything that compares it with a 2-D source.
    expect(rows[0]?.["centre"]).toBe("POINT Z (5 5 5)");
    expect(rows[0]?.["centre_has_z"]).toBe(true);
    expect(rows[0]?.["flat_has_z"]).toBe(false);
    expect(rows[0]?.["flat_area"]).toBe(100);
  });

  it("dissolves Z geometries with ST_Union_Agg", () => {
    // Two 10 × 10 squares overlapping by 5 in x: the union is 150, not 200,
    // and it too keeps Z.
    const rows = db.query(
      `SELECT ST_Area(ST_Union_Agg(g)) AS area, ST_HasZ(ST_Union_Agg(g)) AS has_z FROM (SELECT UNNEST([ST_GeomFromText('${Z_SQUARE}'), ST_GeomFromText('${Z_SQUARE_EAST}')]) AS g)`,
    );
    expect(rows[0]?.["area"]).toBe(150);
    expect(rows[0]?.["has_z"]).toBe(true);
  });

  it("reads a GeoJSON FeatureCollection through the stated columns= shape", () => {
    // The plan's reader shape, verbatim: `read_json` with the FeatureCollection
    // typed explicitly, then `unnest(features)`. `properties` and `geometry`
    // both stay JSON, so the property lookups and `ST_GeomFromGeoJSON`'s JSON
    // overload work straight off the struct.
    const rows = db.query(
      `SELECT f.properties->>'name' AS name, (f.properties->>'n')::DOUBLE AS n, ST_Area(ST_GeomFromGeoJSON(f.geometry)) AS area FROM (SELECT unnest(features) AS f FROM read_json('${FC_FILE}', columns = {type: 'VARCHAR', features: 'STRUCT(type VARCHAR, properties JSON, geometry JSON)[]'})) ORDER BY name`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "A", n: 3 });
    expect(rows[0]?.["area"]).toBe(10000);
    expect(rows[1]).toMatchObject({ name: "B", n: 7 });
  });

  it("has ST_Transform, which the design deliberately does not use", () => {
    // The plan states the function exists; reprojection is app-side, through
    // the app's single proj4 door (design decision (d)). Pinned so a task that
    // reached for the engine instead cannot claim it was unavailable.
    const rows = db.query(
      "SELECT ST_AsText(ST_Transform(ST_Point(85000, 446000), 'EPSG:28992', 'EPSG:4326')) AS p",
    );
    expect(String(rows[0]?.["p"])).toMatch(/^POINT \(/);
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

  it("publishes both ST_GeomFromGeoJSON overloads, and resolves a bare NULL once json is loaded", () => {
    // The state this suite's `beforeAll` always establishes: its
    // `VECTOR_TABLE_SQL` read `json` into being. The UNLOADED half of the fact
    // is the describe above, on its own connection.
    expect(jsonLoaded(db)).toBe(true);
    const sigs = db
      .query(
        "SELECT parameter_types FROM duckdb_functions() WHERE function_name = 'ST_GeomFromGeoJSON'",
      )
      .map((r) => String(r["parameter_types"]))
      .sort();
    expect(sigs).toEqual(["[JSON]", "[VARCHAR]"]);
    expect(
      db.query("SELECT ST_GeomFromGeoJSON(NULL) IS NULL AS n")[0]?.["n"],
    ).toBe(true);
    expect(
      db.query("SELECT ST_GeomFromGeoJSON(NULL::VARCHAR) IS NULL AS n")[0]?.[
        "n"
      ],
    ).toBe(true);
  });

  it("builds the two bbox proxies from an extent struct", () => {
    const rows = db.query(
      "SELECT ST_Area(ST_MakeEnvelope(0, 0, 10, 20)) AS a, ST_AsText(ST_Point(3, 4)) AS p",
    );
    expect(Number(rows[0]?.["a"])).toBeCloseTo(200, 6);
    expect(String(rows[0]?.["p"])).toContain("POINT");
  });

  it("round-trips the per-run vector table from NDJSON, stable id included", () => {
    // `VECTOR_TABLE_SQL` ran in `beforeAll`; this case reads back what it made.
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
    // The "largest overlap" rule (§7.5). A spans x 0–100 and B x 50–150, so a
    // footprint from x=40 to x=120, 10 tall, overlaps A over 60 (area 600) and
    // B over 70 (area 700): B wins.
    const ranked = db.query(
      `SELECT s.idx, ST_Area(ST_Intersection(ST_MakeEnvelope(40, 10, 120, 20), s.geom)) AS ov FROM "${VECTOR_TABLE}" s ORDER BY ov DESC, s.idx ASC`,
    );
    expect(ranked.map((r) => r["ov"])).toEqual([700, 600]);
    expect(ranked[0]?.["idx"]).toBe(1);

    // The TIE, which is the half that needed a real case: x=40 to x=110
    // overlaps BOTH by 60, so the ordering alone decides and `idx ASC` makes
    // that decision SOURCE ORDER.
    const tied = db.query(
      `SELECT s.idx, ST_Area(ST_Intersection(ST_MakeEnvelope(40, 10, 110, 20), s.geom)) AS ov FROM "${VECTOR_TABLE}" s ORDER BY ov DESC, s.idx ASC`,
    );
    expect(tied.map((r) => r["ov"])).toEqual([600, 600]);
    expect(tied[0]?.["idx"]).toBe(0);
    // `arg_max(idx, ov)` is NOT the tie rule: it picks either row. The pair
    // above is why §7.5 spells the ORDER BY out.
    const argMax = db.query(
      `SELECT arg_max(s.idx, ST_Area(ST_Intersection(ST_MakeEnvelope(40, 10, 110, 20), s.geom))) AS picked FROM "${VECTOR_TABLE}" s`,
    );
    expect([0, 1]).toContain(argMax[0]?.["picked"]);
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

  it("round-trips the app's OWN vector-table statement", async () => {
    // The fixture above was written BEFORE the builder existed, and a drift
    // between the two would be a bug in one of them — so this case runs
    // `buildVectorTableSql`'s own text over `encodeProjectedFeatures`' own
    // bytes, and reads back the three accessors §7.5-§7.7 use.
    const table = vectorTableName("run_builder");
    const file = `${table}.json`;
    const features = [
      {
        idx: 0,
        stableId: "id:string:z1",
        featureId: "z1",
        properties: { name: "A", n: 3 },
        wkt: "POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))",
      },
      {
        // The heterogeneous row is why the column list is explicit: inference
        // would have made `props` a STRUCT and `->>` would not compile. The
        // gap in `idx` is §7.5's source order, kept through a skipped feature.
        idx: 2,
        stableId: "index:2",
        featureId: null,
        properties: { name: "B" },
        wkt: "POINT (20 5)",
      },
      {
        // What Task 12 emits for a GeoJSON GeometryCollection — §7.7's source
        // is "any geometry type", so the statement has to parse this line.
        idx: 3,
        stableId: "id:string:z3",
        featureId: "z3",
        properties: { name: "C", n: 7 },
        wkt: "GEOMETRYCOLLECTION (POINT (0 0), LINESTRING (0 0, 5 5))",
      },
    ];
    db.registerBytes(file, await encodeProjectedFeatures(features));
    db.query(buildVectorTableSql(table, file));
    const rows = db.query(
      `SELECT "idx", "sid", "fid", "props"->>'name' AS name,
              ("props"->>'n')::DOUBLE AS n, ST_GeometryType("geom") AS kind
       FROM ${JSON.stringify(table)} ORDER BY "idx"`,
    );
    // The harness narrows a BigInt to a Number on the way out, so `idx` is a
    // plain 0 here.
    expect(rows).toEqual([
      {
        idx: 0,
        sid: "id:string:z1",
        fid: "z1",
        name: "A",
        n: 3,
        kind: "POLYGON",
      },
      { idx: 2, sid: "index:2", fid: null, name: "B", n: null, kind: "POINT" },
      {
        idx: 3,
        sid: "id:string:z3",
        fid: "z3",
        name: "C",
        n: 7,
        kind: "GEOMETRYCOLLECTION",
      },
    ]);
    db.query(buildDropVectorTableSql(table));
    db.dropFile(file);
  });
});
