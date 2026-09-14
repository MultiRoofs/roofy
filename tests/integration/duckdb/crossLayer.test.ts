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
import {
  buildFeatureProxySql,
  buildProxySql,
} from "../../../src/features/processing/buildingProxy";
import { buildJoinSql } from "../../../src/features/processing/tools/joinByLocation";
import { buildDistanceSql } from "../../../src/features/processing/tools/distanceToNearest";
import { buildAggregateSql } from "../../../src/features/processing/tools/aggregatePerArea";
import { quoteIdent } from "../../../src/insights/sql";

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

/**
 * An LoD 0 CityJSON, built HERE because the shipped fixture has none.
 *
 * `two-buildings.city.json` carries only LoD 2.2, and that is a Solid — whose
 * WKB `ST_GeomFromWKB` refuses outright (the first case in this suite). So the
 * footprint proxy, the one path that reads the READER rather than the table,
 * needs a file with a real LoD 0 MultiSurface: a root with a 10 × 10 footprint,
 * its part with a 4 × 4 one INSIDE it (so the contributor rule and a union are
 * distinguishable — 16 versus 100), a building whose only geometry is at
 * another LoD, and a fourth outside every scope this suite freezes.
 */
const LOD0_FILE = "probe_lod0.city.json";
const LOD0_DOC = JSON.stringify({
  type: "CityJSON",
  version: "2.0",
  transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
  CityObjects: {
    P1: {
      type: "Building",
      children: ["P1-0"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[0, 1, 2, 3]]] },
      ],
    },
    "P1-0": {
      type: "BuildingPart",
      parents: ["P1"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[4, 5, 6, 7]]] },
      ],
    },
    P2: {
      type: "Building",
      geometry: [
        { type: "MultiSurface", lod: "2", boundaries: [[[0, 1, 2, 3]]] },
      ],
    },
    P3: {
      type: "Building",
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[8, 9, 10, 11]]] },
      ],
    },
    // Minor 6: a feature with TWO contributing parts, whose footprints are
    // DISJOINT — so the union's area is their sum (16 + 16) and not either one.
    // The root carries a footprint too, which the contributor rule must ignore.
    Q1: {
      type: "Building",
      children: ["Q1-0", "Q1-1"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[0, 1, 2, 3]]] },
      ],
    },
    "Q1-0": {
      type: "BuildingPart",
      parents: ["Q1"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[4, 5, 6, 7]]] },
      ],
    },
    "Q1-1": {
      type: "BuildingPart",
      parents: ["Q1"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[12, 13, 14, 15]]] },
      ],
    },
    // Minor 6: the ROOT FALLBACK — the part has geometry, but not at LoD 0, so
    // §7's "the union of its parts' footprints" has nothing and the root's own
    // 10 x 10 is the feature's proxy.
    R1: {
      type: "Building",
      children: ["R1-0"],
      geometry: [
        { type: "MultiSurface", lod: "0", boundaries: [[[0, 1, 2, 3]]] },
      ],
    },
    "R1-0": {
      type: "BuildingPart",
      parents: ["R1"],
      geometry: [
        { type: "MultiSurface", lod: "2", boundaries: [[[4, 5, 6, 7]]] },
      ],
    },
  },
  // Z on every vertex, so the WKB is the MultiPolygon Z an LoD 0 column really
  // carries and `ST_Force2D` has something to drop.
  vertices: [
    [0, 0, 5],
    [10, 0, 5],
    [10, 10, 5],
    [0, 10, 5],
    [0, 0, 5],
    [4, 0, 5],
    [4, 4, 5],
    [0, 4, 5],
    [100, 0, 5],
    [110, 0, 5],
    [110, 10, 5],
    [100, 10, 5],
    // 12-15: a second 4 x 4, well away from the first one.
    [20, 0, 5],
    [24, 0, 5],
    [24, 4, 5],
    [20, 4, 5],
  ],
});

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
    db.registerBytes(LOD0_FILE, new TextEncoder().encode(LOD0_DOC));
    // The per-run table is built HERE, not inside the case that reads it back:
    // the predicate, overlap, distance and join cases all query it, and every
    // one of them must run alone under `vitest -t`.
    db.query(VECTOR_TABLE_SQL);
  }, 180_000);

  afterAll(() => {
    db?.dropFile(VECTOR_FILE);
    db?.dropFile(FC_FILE);
    db?.dropFile(LOD0_FILE);
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
    // TRUSTED ONLY BECAUSE THE PROBE IS A POINT. Core `ST_Distance` answers 0
    // between any two polygons on this build (the case further down pins it),
    // so the shape below is the plan's ORIGINAL sketch rather than what
    // `buildDistanceSql` sends: the builder measures with `ST_Distance_GEOS`
    // and orders with a window instead of `arg_min`.
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
       FROM ${quoteIdent(table)} ORDER BY "idx"`,
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

  it("aggregates a feature's proxy the way buildFeatureProxySql does", () => {
    // The NULL-bbox row is why this case exists beside the fixture one below:
    // `two-buildings.city.json` has an extent on every object, and the CASE
    // guard's NULL branch — a feature with no proxy at all, which §6.2 must
    // tell apart from "no match" — has nowhere else to be exercised.
    db.query(
      `CREATE OR REPLACE TABLE probe_rows AS SELECT * FROM (VALUES
         ('b1', 'b1', {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('b1p', 'b1', {'xmin': 10.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 20.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('b2', 'b2', NULL)
       ) AS t("id", "feature_id", "bbox")`,
    );
    const rect = db.query(
      `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
        proxy: "rectangle",
        table: "probe_rows",
        from: null,
        geometryColumn: null,
        ids: null,
      })}) ORDER BY f`,
    );
    // The COMBINED extent of the two rows, and NULL for the feature with none —
    // which is what `ST_MakeEnvelope` under the CASE guard has to produce.
    expect(rect).toEqual([
      { f: "b1", a: 200 },
      { f: "b2", a: null },
    ]);
    const centre = db.query(
      `SELECT f, ST_X(g) AS x, ST_Y(g) AS y FROM (${buildFeatureProxySql({
        proxy: "centre",
        table: "probe_rows",
        from: null,
        geometryColumn: null,
        ids: null,
      })}) WHERE f = 'b1'`,
    );
    expect(centre).toEqual([{ f: "b1", x: 10, y: 5 }]);
    db.query(`DROP TABLE IF EXISTS probe_rows`);
  });

  it("builds the two bbox proxies over the two-buildings fixture's own extents", () => {
    // The REAL layer shape: `id`, `feature_id` and the reader's own `bbox`
    // struct, straight out of `read_cityjson`, which is what `layerTables`
    // writes into a layer's browsing table.
    //
    // The numbers are the fixture's, observed once and pinned: the root spans
    // 85000–85010 × 446000–446008 and its part 85012–85016 × 446000–446005, so
    // the feature's COMBINED extent is 16 × 8 = 128 m² centred on
    // (85008, 446004) — §7's "combined extent" is deliberately NOT the
    // contributor rule, so the ROOT's own box counts here as much as the
    // part's. `NL.IMBAG.Pand.0002` is a lone root, 15 × 12 = 180 m².
    db.query(
      `CREATE OR REPLACE TABLE probe_layer AS SELECT "id", "feature_id", "bbox" FROM read_cityjson('${SOURCE}', lod => '${LOD}')`,
    );
    expect(
      db.query(
        `SELECT f, ST_Area(g) AS a, ST_X(ST_Centroid(g)) AS x, ST_Y(ST_Centroid(g)) AS y FROM (${buildFeatureProxySql(
          {
            proxy: "rectangle",
            table: "probe_layer",
            from: null,
            geometryColumn: null,
            ids: null,
          },
        )}) ORDER BY f`,
      ),
    ).toEqual([
      { f: "NL.IMBAG.Pand.0001", a: 128, x: 85008, y: 446004 },
      { f: VALID, a: 180, x: 85027.5, y: 446006 },
    ]);
    expect(
      db.query(
        `SELECT f, ST_X(g) AS x, ST_Y(g) AS y FROM (${buildFeatureProxySql({
          proxy: "centre",
          table: "probe_layer",
          from: null,
          geometryColumn: null,
          ids: null,
        })}) ORDER BY f`,
      ),
    ).toEqual([
      { f: "NL.IMBAG.Pand.0001", x: 85008, y: 446004 },
      { f: VALID, x: 85027.5, y: 446006 },
    ]);
    // The PER-ROW relation too, `buildProxySql`'s own text: the feature roll-up
    // composes it only on the footprint path, so these two bbox arms would
    // otherwise never reach the engine — and Task 16 reaches for the rectangle
    // one. Each ROW's own box: the root 10 × 8, the part 4 × 5, the lone
    // building 15 × 12, each beside the feature it belongs to.
    expect(
      db.query(
        `SELECT "id", f, ST_Area(g) AS a, ST_X(ST_Centroid(g)) AS x, ST_Y(ST_Centroid(g)) AS y FROM (${buildProxySql(
          {
            proxy: "rectangle",
            table: "probe_layer",
            from: null,
            geometryColumn: null,
            ids: null,
          },
        )}) ORDER BY "id"`,
      ),
    ).toEqual([
      {
        id: "NL.IMBAG.Pand.0001",
        f: "NL.IMBAG.Pand.0001",
        a: 80,
        x: 85005,
        y: 446004,
      },
      {
        id: NOT_A_SOLID,
        f: "NL.IMBAG.Pand.0001",
        a: 20,
        x: 85014,
        y: 446002.5,
      },
      { id: VALID, f: VALID, a: 180, x: 85027.5, y: 446006 },
    ]);
    expect(
      db.query(
        `SELECT "id", ST_X(g) AS x, ST_Y(g) AS y FROM (${buildProxySql({
          proxy: "centre",
          table: "probe_layer",
          from: null,
          geometryColumn: null,
          ids: null,
        })}) ORDER BY "id"`,
      ),
    ).toEqual([
      { id: "NL.IMBAG.Pand.0001", x: 85005, y: 446004 },
      { id: NOT_A_SOLID, x: 85014, y: 446002.5 },
      { id: VALID, x: 85027.5, y: 446006 },
    ]);
    // Scoped: one building selected, and the other is not in the relation at
    // all — the same frozen-id guard the footprint path needs.
    expect(
      db.query(
        `SELECT f FROM (${buildFeatureProxySql({
          proxy: "centre",
          table: "probe_layer",
          from: null,
          geometryColumn: null,
          ids: [VALID],
        })})`,
      ),
    ).toEqual([{ f: VALID }]);
    db.query(`DROP TABLE IF EXISTS probe_layer`);
  });

  it("picks the PART footprints and honours the scope, through the real reader", () => {
    // The footprint path reads the READER, not the table, so it is probed
    // against `read_cityjson` itself over an LoD 0 file built here — the
    // shipped fixture has only LoD 2.2, whose PolyhedralSurface Z the case
    // above shows `ST_GeomFromWKB` refusing.
    //
    // The LoD is spelled `'0.0'`, and the column `geometry_lod0_0`, although
    // the DOCUMENT says `"lod": "0"`: the reader normalises, which is the whole
    // reason `lodZeroLabel` returns the LABEL off `table.lods` (read back from
    // the reader's own column names) and nothing re-spells a suffix.
    const from = `read_cityjson('${LOD0_FILE}', lod => '0.0')`;
    const rows = db.query(
      `SELECT f, ST_Area(g) AS a, ST_HasZ(g) AS has_z FROM (${buildFeatureProxySql(
        {
          proxy: "footprint",
          table: "unused",
          from,
          geometryColumn: "geometry_lod0_0",
          ids: ["P1", "P1-0", "P2"],
        },
      )}) ORDER BY f`,
    );
    expect(rows).toEqual([
      // §7's contributor rule: the PART's 16 m², never the root's 100 and never
      // their union (which would be 100, the part being inside the root).
      { f: "P1", a: 16, has_z: false },
      // LoD 2 geometry only, so no LoD 0 WKB: the row survives with a NULL
      // proxy (§6.2's "no proxy" ≠ "no match").
      { f: "P2", a: null, has_z: null },
      // `P3` is outside the frozen scope, so it is not here at all.
    ]);
    // `P2`'s NULL is the outer `ST_IsEmpty` CASE, and this is the fact that
    // makes it necessary: an aggregate over an EMPTY filtered set is an EMPTY
    // GEOMETRY, not NULL — so without it a building with no footprint would
    // read as a proxy that matches nothing (§6.2's 0) instead of no proxy at
    // all (§6.2's NULL).
    expect(
      db.query(
        `SELECT ST_Union_Agg(g) FILTER (WHERE FALSE) IS NULL AS n, ST_AsText(ST_Union_Agg(g) FILTER (WHERE FALSE)) AS t FROM (SELECT ST_Point(0, 0) AS g)`,
      ),
    ).toEqual([{ n: false, t: "GEOMETRYCOLLECTION EMPTY" }]);
    // `has_z` above is the `ST_Force2D` wrap, behaviourally: the reader's LoD 0
    // WKB is a MultiPolygon Z (`ST_HasZ` true without the wrap) and
    // `ST_Union_Agg` KEEPS Z, so an unwrapped proxy would hand Tasks 16, 17 and
    // 19 a 3-D geometry.
    expect(
      db.query(
        `SELECT ST_HasZ(ST_GeomFromWKB("geometry_lod0_0")) AS z FROM ${from} WHERE "id" = 'P1'`,
      ),
    ).toEqual([{ z: true }]);
    // And the gate `proxyOptions` enforces, against this builder's own text: a
    // footprint taken from a solid LoD is not a rougher answer, it is a failed
    // run. `ST_Area(g)` rather than `f` alone, because DuckDB prunes an
    // unreferenced projection and the parse then never happens.
    db.query(
      `CREATE OR REPLACE TABLE solid_lod_rows AS SELECT "id", "feature_id" FROM read_cityjson('${SOURCE}', lod => '${LOD}')`,
    );
    expect(() =>
      db.query(
        `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
          proxy: "footprint",
          table: "solid_lod_rows",
          from: `read_cityjson('${SOURCE}', lod => '${LOD}')`,
          geometryColumn: "geometry_lod2_2",
          ids: null,
        })})`,
      ),
    ).toThrow(/Unsupported geometry type in WKB/);
    db.query(`DROP TABLE IF EXISTS solid_lod_rows`);
  });

  it("unions SEVERAL parts' footprints, and falls back to the root (minor 6)", () => {
    // §7's contributor rule, the two halves the older case could not show: a
    // feature with more than ONE contributing part, and a feature whose parts
    // have geometry but none at LoD 0.
    const from = `read_cityjson('${LOD0_FILE}', lod => '0.0')`;
    const rows = db.query(
      `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
        proxy: "footprint",
        table: "unused_minor6",
        from,
        geometryColumn: "geometry_lod0_0",
        ids: ["Q1", "Q1-0", "Q1-1", "R1", "R1-0"],
      })}) ORDER BY f`,
    );
    expect(rows).toEqual([
      // TWO parts, 4 x 4 each and disjoint: 32, never one part's 16 and never
      // the root's 100.
      { f: "Q1", a: 32 },
      // The part has LoD 2 geometry only, so the ROOT is the sole contributor.
      { f: "R1", a: 100 },
    ]);
  });

  it("keeps scope ALL inside the LAYER TABLE when the file has gained a building (S1)", () => {
    // The gate finding: `ids === null` used to hand the whole RE-READ file to
    // the proxy relation. `probe_lod0.city.json` holds P3 with a real LoD 0
    // footprint at x 100-110; the LAYER never had it. §6.1's id join passes
    // either way — it only asks whether every id it requested still comes back
    // — so nothing but the table's own row list can keep P3 out.
    db.query(
      `CREATE OR REPLACE TABLE s1_rows AS SELECT * FROM (VALUES
         ('P1', 'P1'), ('P1-0', 'P1'), ('P2', 'P2')
       ) AS t("id", "feature_id")`,
    );
    const from = `read_cityjson('${LOD0_FILE}', lod => '0.0')`;
    const proxies = db.query(
      `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
        proxy: "footprint",
        table: "s1_rows",
        from,
        geometryColumn: "geometry_lod0_0",
        ids: null,
      })}) ORDER BY f`,
    );
    // The same three features the frozen-id case above returns — P3 is not
    // here, even though the reader would answer for it.
    expect(proxies).toEqual([
      { f: "P1", a: 16 },
      { f: "P2", a: null },
    ]);
    db.query(`DROP TABLE IF EXISTS s1_rows`);
  });

  it("does not let a gained building reach §7.6's per-area count (S1)", async () => {
    // The user-visible half of the same finding: an area drawn over P3's
    // footprint must count ZERO buildings, because the loaded layer has no
    // building there. Before the fix the reader's P3 was counted.
    db.query(
      `CREATE OR REPLACE TABLE s1_agg_rows AS SELECT * FROM (VALUES
         ('P1', 'P1'), ('P1-0', 'P1')
       ) AS t("id", "feature_id")`,
    );
    db.registerBytes(
      "__src_s1.json",
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:home",
          featureId: "home",
          properties: {},
          // Over P1's own 10 x 10 footprint.
          wkt: "POLYGON ((-1 -1, 11 -1, 11 11, -1 11, -1 -1))",
        },
        {
          idx: 1,
          stableId: "id:string:gained",
          featureId: "gained",
          properties: {},
          // Over P3's footprint, which the layer table does not hold.
          wkt: "POLYGON ((99 -1, 111 -1, 111 11, 99 11, 99 -1))",
        },
      ]),
    );
    db.query(buildVectorTableSql("__src_s1", "__src_s1.json"));
    const rows = db.query(
      buildAggregateSql({
        table: "s1_agg_rows",
        source: "__src_s1",
        proxy: "footprint",
        from: `read_cityjson('${LOD0_FILE}', lod => '0.0')`,
        geometryColumn: "geometry_lod0_0",
        ids: null,
        predicate: "intersects",
        rows: [{ op: "count", column: null, name: "bld_buildings_n" }],
      }),
    );
    expect(rows).toEqual([
      {
        sid: "id:string:gained",
        bld_buildings_n: 0,
        multi_n: 0,
        buildings_total: 1,
        no_proxy_n: 0,
      },
      {
        sid: "id:string:home",
        bld_buildings_n: 1,
        multi_n: 0,
        buildings_total: 1,
        no_proxy_n: 0,
      },
    ]);
    db.query(buildDropVectorTableSql("__src_s1"));
    db.query(`DROP TABLE IF EXISTS s1_agg_rows`);
    db.dropFile("__src_s1.json");
  });
  it("runs buildJoinSql's OWN statement, per FEATURE, over the vector table", () => {
    // §7.5 end to end against the engine: the rectangle proxy, the copied
    // fields with their types, the match count's three values (a match, a real
    // 0, and NULL for a building with no proxy at all) and §7's rule that the
    // answer is the FEATURE's and is copied to root and parts alike.
    //
    // A spans x 0-100, B x 50-150 (the fixture at the top of this file). The
    // root's box is 0-10 and its part's 0-4, so the FEATURE's combined extent
    // is 0-10 — inside A only. `B4` is DEGENERATE (min = max), which is what a
    // one-coordinate building's bbox is.
    db.query(
      `CREATE OR REPLACE TABLE probe_join AS SELECT * FROM (VALUES
         ('B1', NULL, {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('B1P', 'B1', {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 4.0, 'ymax': 4.0, 'zmax': 3.0}),
         ('B2', NULL, {'xmin': 200.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 210.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('B3', NULL, NULL),
         ('B4', NULL, {'xmin': 5.0, 'ymin': 5.0, 'zmin': 0.0, 'xmax': 5.0, 'ymax': 5.0, 'zmax': 0.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const rows = db.query(
      `SELECT * FROM (${buildJoinSql({
        table: "probe_join",
        source: VECTOR_TABLE,
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        tie: "first",
        prefix: "zones_",
        fields: [
          { field: "name", column: "zones_name", type: "VARCHAR" },
          { field: "n", column: "zones_n", type: "DOUBLE" },
        ],
        writeMatchCount: true,
      })}) ORDER BY "id"`,
    );
    expect(rows).toEqual([
      // The FEATURE's own answer…
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        matches_n_feature: 1,
        zones_name: "A",
        zones_n: 3,
        zones_matches_n: 1,
      },
      // …on the PART's row too (§7), and not the part's own.
      {
        id: "B1P",
        f: "B1",
        no_proxy: false,
        matches_n_feature: 1,
        zones_name: "A",
        zones_n: 3,
        zones_matches_n: 1,
      },
      // Outside every area: §6.2's real 0, and NULL in every copied field.
      {
        id: "B2",
        f: "B2",
        no_proxy: false,
        matches_n_feature: 0,
        zones_name: null,
        zones_n: null,
        zones_matches_n: 0,
      },
      // No proxy at all: §6.2's NULL, which is not the same answer as 0.
      {
        id: "B3",
        f: "B3",
        no_proxy: true,
        matches_n_feature: 0,
        zones_name: null,
        zones_n: null,
        zones_matches_n: null,
      },
      // The degenerate extent answers the predicate rather than raising.
      {
        id: "B4",
        f: "B4",
        no_proxy: false,
        matches_n_feature: 1,
        zones_name: "A",
        zones_n: 3,
        zones_matches_n: 1,
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_join");
  });

  it("copies a NESTED object as JSON text, and a bad number as NULL", () => {
    // §7.5: "nested objects are JSON text"; §6.2: a value that could not be
    // read is NULL, which is why the numeric read is TRY_CAST and not `::`.
    db.query(
      `CREATE OR REPLACE TABLE probe_nested_src AS SELECT 0 AS "idx", 'f-n' AS "sid", 'n' AS "fid",
         '{"meta":{"k":1},"n":"twelve"}'::JSON AS "props",
         ST_GeomFromText('POLYGON ((0 0, 100 0, 100 100, 0 100, 0 0))') AS "geom"`,
    );
    db.query(
      `CREATE OR REPLACE TABLE probe_nested AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const rows = db.query(
      buildJoinSql({
        table: "probe_nested",
        source: "probe_nested_src",
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        tie: "first",
        prefix: "zones_",
        fields: [
          { field: "meta", column: "zones_meta", type: "VARCHAR" },
          { field: "n", column: "zones_n", type: "DOUBLE" },
        ],
        writeMatchCount: false,
      }),
    );
    expect(rows).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        matches_n_feature: 1,
        zones_meta: '{"k":1}',
        // `'twelve'::DOUBLE` would fail the whole statement for every building.
        zones_n: null,
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_nested");
    db.query("DROP TABLE IF EXISTS probe_nested_src");
  });

  it("picks the largest overlap through the builder, ties to source order", () => {
    // §7.5's tie rule, as the statement states it. A spans x 0-100 and B
    // x 50-150: a proxy over 40-120 overlaps B more (700 vs 600), and one over
    // 40-110 overlaps both by 600 — so only the second ORDER BY key decides,
    // and it is `idx`, the SOURCE order.
    db.query(
      `CREATE OR REPLACE TABLE probe_tie AS SELECT * FROM (VALUES
         ('WIDE', NULL::VARCHAR, {'xmin': 40.0, 'ymin': 10.0, 'zmin': 0.0, 'xmax': 120.0, 'ymax': 20.0, 'zmax': 3.0}),
         ('TIED', NULL::VARCHAR, {'xmin': 40.0, 'ymin': 10.0, 'zmin': 0.0, 'xmax': 110.0, 'ymax': 20.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const rows = db.query(
      `SELECT * FROM (${buildJoinSql({
        table: "probe_tie",
        source: VECTOR_TABLE,
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        tie: "largestOverlap",
        prefix: "zones_",
        fields: [{ field: "name", column: "zones_name", type: "VARCHAR" }],
        writeMatchCount: true,
      })}) ORDER BY "id"`,
    );
    expect(rows).toEqual([
      {
        id: "TIED",
        f: "TIED",
        no_proxy: false,
        matches_n_feature: 2,
        zones_name: "A",
        zones_matches_n: 2,
      },
      {
        id: "WIDE",
        f: "WIDE",
        no_proxy: false,
        matches_n_feature: 2,
        zones_name: "B",
        zones_matches_n: 2,
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_tie");
  });

  it("is boundary-inclusive for `within`, which ST_Within is not", () => {
    // §7.5's `within` is "the whole proxy inside the area, BOUNDARY INCLUDED",
    // and the case that tells the two predicates apart is a BOUNDARY POINT:
    // the centre (50, 50) is interior to A and sits exactly on B's x = 50 edge,
    // so `ST_CoveredBy` counts it in BOTH and `ST_Within` counts it in one.
    // (A polygon PAIR does not show the difference: `ST_Within` is true for a
    // polygon that shares an edge with the area, on this engine.)
    db.query(
      `CREATE OR REPLACE TABLE probe_boundary AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': 40.0, 'ymin': 40.0, 'zmin': 0.0, 'xmax': 60.0, 'ymax': 60.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const covered = db.query(
      buildJoinSql({
        table: "probe_boundary",
        source: VECTOR_TABLE,
        proxy: "centre",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "within",
        tie: "first",
        prefix: "zones_",
        fields: [{ field: "name", column: "zones_name", type: "VARCHAR" }],
        writeMatchCount: true,
      }),
    );
    // BOTH areas, and the tie rule — source order — picks A.
    expect(covered).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        matches_n_feature: 2,
        zones_name: "A",
        zones_matches_n: 2,
      },
    ]);
    // What `ST_Within` would have answered for the same point: one area, so
    // every building on a shared boundary would silently lose a match.
    expect(
      db.query(
        `SELECT COUNT(*) FILTER (WHERE ST_Within(ST_Point(50, 50), s."geom")) AS within_n FROM "${VECTOR_TABLE}" s`,
      ),
      // ONE, where the builder's `ST_CoveredBy` found two.
    ).toEqual([{ within_n: 1 }]);

    // §7.5: "centre within" FORCES the centre proxy — the footprint asked for
    // here is not read at all, and the answer is the centre's.
    const forced = buildJoinSql({
      table: "probe_boundary",
      source: VECTOR_TABLE,
      proxy: "footprint",
      from: `read_cityjson('${LOD0_FILE}', lod => '0.0')`,
      geometryColumn: "geometry_lod0_0",
      ids: null,
      predicate: "centreWithin",
      tie: "first",
      prefix: "zones_",
      fields: [{ field: "name", column: "zones_name", type: "VARCHAR" }],
      writeMatchCount: true,
    });
    expect(forced).not.toContain("read_cityjson(");
    expect(db.query(forced)).toEqual(covered);
    db.query("DROP TABLE IF EXISTS probe_boundary");
  });

  it("joins FOOTPRINTS read from the reader, and tells the predicates apart", () => {
    // The one proxy that re-reads the parent source, through `read_cityjson`
    // itself. P1's footprint is its PART's 4 x 4 (§7's contributor rule), P2
    // has no LoD 0 geometry at all, and P3 spans x 100-110 — which TOUCHES A's
    // eastern edge at x = 100 and lies wholly inside B.
    db.query(
      `CREATE OR REPLACE TABLE probe_fp AS SELECT * FROM (VALUES
         ('P1', NULL::VARCHAR), ('P1-0', 'P1'), ('P2', NULL), ('P3', NULL)
       ) AS t("id", "feature_id")`,
    );
    const join = (predicate: "intersects" | "within") =>
      db.query(
        `SELECT * FROM (${buildJoinSql({
          table: "probe_fp",
          source: VECTOR_TABLE,
          proxy: "footprint",
          from: `read_cityjson('${LOD0_FILE}', lod => '0.0')`,
          geometryColumn: "geometry_lod0_0",
          ids: null,
          predicate,
          tie: "first",
          prefix: "zones_",
          fields: [{ field: "name", column: "zones_name", type: "VARCHAR" }],
          writeMatchCount: true,
        })}) ORDER BY "id"`,
      );
    expect(join("intersects")).toEqual([
      {
        id: "P1",
        f: "P1",
        no_proxy: false,
        matches_n_feature: 1,
        zones_name: "A",
        zones_matches_n: 1,
      },
      {
        id: "P1-0",
        f: "P1",
        no_proxy: false,
        matches_n_feature: 1,
        zones_name: "A",
        zones_matches_n: 1,
      },
      // No LoD 0 WKB: §6.2's NULL, not a 0.
      {
        id: "P2",
        f: "P2",
        no_proxy: true,
        matches_n_feature: 0,
        zones_name: null,
        zones_matches_n: null,
      },
      // Touching A's boundary counts (§7.5's default predicate), so BOTH.
      {
        id: "P3",
        f: "P3",
        no_proxy: false,
        matches_n_feature: 2,
        zones_name: "A",
        zones_matches_n: 2,
      },
    ]);
    // `within` is the whole proxy inside the area: P3 is covered by B alone.
    expect(
      join("within").map((r) => [
        r["id"],
        r["zones_name"],
        r["zones_matches_n"],
      ]),
    ).toEqual([
      ["P1", "A", 1],
      ["P1-0", "A", 1],
      ["P2", null, null],
      ["P3", "B", 1],
    ]);
    db.query("DROP TABLE IF EXISTS probe_fp");
  });

  it("answers 0 from the CORE ST_Distance between two polygons, however far apart", () => {
    // THE FINDING BEHIND `ST_Distance_GEOS` IN `buildDistanceSql`. On this
    // build, core `ST_Distance` is 0 for ANY polygon-to-polygon pair — the
    // degenerate envelope a one-coordinate building produces and a
    // GeometryCollection carrying a polygon included — while every other
    // pairing is correct. §7.7's two bbox proxies and its footprint union are
    // polygons and its source is "any geometry type", so the core function
    // would report "0 m" for a whole layer against a polygon source, silently.
    // `ST_Distance_GEOS` is right in every one of these cases.
    const near = `ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))')`;
    const far = `ST_GeomFromText('POLYGON ((50 0, 150 0, 150 100, 50 100, 50 0))')`;
    const withPolygon = `ST_GeomFromText('GEOMETRYCOLLECTION (POLYGON ((50 0, 150 0, 150 100, 50 100, 50 0)), POINT (200 200))')`;
    expect(
      db.query(
        `SELECT ST_Distance(${near}, ${far}) AS poly_poly,
                ST_Distance(ST_MakeEnvelope(5, 5, 5, 5), ${far}) AS degenerate,
                ST_Distance(${near}, ${withPolygon}) AS collection,
                ST_Distance(${near}, ST_Point(50, 5)) AS point,
                ST_Intersects(${near}, ${far}) AS intersects`,
      ),
    ).toEqual([
      // Wrong: the two are 40 m apart.
      {
        poly_poly: 0,
        degenerate: 0,
        collection: 0,
        point: 40,
        intersects: false,
      },
    ]);
    expect(
      db.query(
        `SELECT ST_Distance_GEOS(${near}, ${far}) AS poly_poly,
                ST_Distance_GEOS(ST_MakeEnvelope(5, 5, 5, 5), ${far}) AS degenerate,
                ST_Distance_GEOS(${near}, ${withPolygon}) AS collection,
                ST_Distance_GEOS(${near}, ST_GeomFromText('POLYGON ((5 5, 6 5, 6 6, 5 6, 5 5))')) AS contained,
                ST_Distance_GEOS(${near}, ST_GeomFromText('POLYGON ((10 0, 20 0, 20 10, 10 10, 10 0))')) AS touching,
                ST_Distance_GEOS(NULL::GEOMETRY, ST_Point(0, 0)) IS NULL AS null_left,
                ST_Distance_GEOS(ST_Point(0, 0), NULL::GEOMETRY) IS NULL AS null_right`,
      ),
      // §7.7's "0 when they touch or overlap" is the `contained` and `touching`
      // pair; the NULL columns are why the builder may put the call in a LEFT
      // JOIN's `ON` beside `b."g" IS NOT NULL` — a NULL proxy answers NULL
      // rather than raising, and one raise would fail the whole statement.
    ).toEqual([
      {
        poly_poly: 40,
        degenerate: 45,
        collection: 40,
        contained: 0,
        touching: 0,
        null_left: true,
        null_right: true,
      },
    ]);
    // The same defect in the predicate form, which is therefore NOT used to
    // bound the search: `ST_DWithin` says two polygons 40 m apart are within
    // 39 m. `ST_DWithin_GEOS` is correct and could bound the join, but one
    // function deciding both the limit and the value is what keeps the two
    // from disagreeing at the boundary.
    expect(
      db.query(
        `SELECT ST_DWithin(${near}, ${far}, 39) AS core_39,
                ST_DWithin_GEOS(${near}, ${far}, 39) AS geos_39,
                ST_DWithin_GEOS(${near}, ${far}, 41) AS geos_41`,
      ),
    ).toEqual([{ core_39: true, geos_39: false, geos_41: true }]);
  });

  it("runs buildDistanceSql's OWN statement, per FEATURE, over the vector table", () => {
    // §7.7 end to end against the engine. A spans x 0-100, B x 50-150 (the
    // fixture at the top of this file), both y 0-100.
    //
    //  B1 (+ its part) overlaps A          → 0, §7.7's "touch or overlap"
    //  B2 (root x 200-210, part x 205-215) → 50 to B, and the FEATURE's answer
    //                                        is on the part's row too (§7)
    //  B3 sits at y -50 under x 70-80      → 50 from BOTH, so only the second
    //                                        ORDER BY key decides and it is
    //                                        `idx`: A wins, `fid` 'a'
    //  B4 has no extent                    → `no_proxy`, distance NULL
    db.query(
      `CREATE OR REPLACE TABLE probe_distance AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('B1P', 'B1', {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 4.0, 'ymax': 4.0, 'zmax': 3.0}),
         ('B2', NULL, {'xmin': 200.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 210.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('B2P', 'B2', {'xmin': 205.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 215.0, 'ymax': 10.0, 'zmax': 3.0}),
         ('B3', NULL, {'xmin': 70.0, 'ymin': -60.0, 'zmin': 0.0, 'xmax': 80.0, 'ymax': -50.0, 'zmax': 3.0}),
         ('B4', NULL, NULL)
       ) AS t("id", "feature_id", "bbox")`,
    );
    const statement = (maxDistanceM: number) =>
      `SELECT * FROM (${buildDistanceSql({
        table: "probe_distance",
        source: VECTOR_TABLE,
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        maxDistanceM,
        prefix: "roads_",
        nearestId: { property: null },
      })}) ORDER BY "id"`;
    expect(db.query(statement(500))).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        roads_distance_m: 0,
        roads_nearest_id: "a",
      },
      {
        id: "B1P",
        f: "B1",
        no_proxy: false,
        roads_distance_m: 0,
        roads_nearest_id: "a",
      },
      {
        id: "B2",
        f: "B2",
        no_proxy: false,
        roads_distance_m: 50,
        roads_nearest_id: "b",
      },
      // §7: the FEATURE's answer, on the part's row as well.
      {
        id: "B2P",
        f: "B2",
        no_proxy: false,
        roads_distance_m: 50,
        roads_nearest_id: "b",
      },
      // §7.7: "ties go to the first source feature in source order".
      {
        id: "B3",
        f: "B3",
        no_proxy: false,
        roads_distance_m: 50,
        roads_nearest_id: "a",
      },
      // §6.2: no proxy at all is NULL, and it is not the same answer as
      // "nothing within the limit" — which is also NULL, but with `no_proxy`
      // false, and that is the difference the card's two counts rest on.
      {
        id: "B4",
        f: "B4",
        no_proxy: true,
        roads_distance_m: null,
        roads_nearest_id: null,
      },
    ]);
    // §7.7: "beyond it the distance is NULL". The limit is in the JOIN's `ON`,
    // so B2 and B3 simply have no match at 40 m — while B1, which overlaps, is
    // still 0.
    const near = db.query(statement(40)) as Array<Record<string, unknown>>;
    expect(
      near.map((r) => [r["id"], r["roads_distance_m"], r["no_proxy"]]),
    ).toEqual([
      ["B1", 0, false],
      ["B1P", 0, false],
      ["B2", null, false],
      ["B2P", null, false],
      ["B3", null, false],
      ["B4", null, true],
    ]);
    db.query("DROP TABLE IF EXISTS probe_distance");
  });

  it("bounds the candidates with the expanded box, and stays conservative (S4)", async () => {
    // S4's prefilter, on the engine. A pair within `limit` metres cannot fall
    // outside a box grown by `limit` — |qx - px| <= |q - p| — so the test is
    // conservative, and these two cases are the two sides of it: a source just
    // INSIDE the limit is still found, and one beyond it is not measured at all.
    db.query(
      `CREATE OR REPLACE TABLE probe_bound AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const table = vectorTableName("run_bound");
    const file = `${table}.json`;
    db.registerBytes(
      file,
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:far",
          featureId: "far",
          properties: { name: "far" },
          // 990 m east of B1's east edge.
          wkt: "POLYGON ((1000 0, 1010 0, 1010 10, 1000 10, 1000 0))",
        },
        {
          idx: 1,
          stableId: "id:string:near",
          featureId: "near",
          properties: { name: "near" },
          // 90 m east of B1's east edge.
          wkt: "POLYGON ((100 0, 110 0, 110 10, 100 10, 100 0))",
        },
      ]),
    );
    db.query(buildVectorTableSql(table, file));
    const statement = (maxDistanceM: number) =>
      buildDistanceSql({
        table: "probe_bound",
        source: table,
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        maxDistanceM,
        prefix: "roads_",
        nearestId: { property: null },
      });
    // The near one is inside the box AND inside the limit.
    expect(db.query(statement(500))).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        roads_distance_m: 90,
        roads_nearest_id: "near",
      },
    ]);
    // At 90 m the near source is EXACTLY at the limit — the box is grown by
    // the same 90, so a prefilter that were even slightly tight would lose it.
    expect(db.query(statement(90))[0]?.["roads_nearest_id"]).toBe("near");
    // And at 50 m nothing is within reach: the far source never reaches the
    // GEOS distance at all, and the near one fails the limit.
    expect(db.query(statement(50))).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        roads_distance_m: null,
        roads_nearest_id: null,
      },
    ]);
    // The prefilter is what keeps the far source out of the candidate set: the
    // box grown by 50 m reaches x = 60, and the far source starts at x = 1000.
    expect(
      db.query(
        `SELECT ST_Intersects_Extent(ST_Expand(ST_MakeEnvelope(0, 0, 10, 10), 50.0), s."geom") AS hit FROM ${quoteIdent(table)} s WHERE s."idx" = 0`,
      ),
    ).toEqual([{ hit: false }]);
    db.query(buildDropVectorTableSql(table));
    db.query("DROP TABLE IF EXISTS probe_bound");
    db.dropFile(file);
  });

  it("answers the POINT→polygon pair the same through buildDistanceSql as core ST_Distance", () => {
    // PARITY, explicitly. The case above ("finds the nearest source feature
    // with MIN(ST_Distance)") measures core `ST_Distance` from the point
    // (200, 50) to this file's two areas and gets 50, nearest `idx` 1 — the
    // one pairing the core function is trusted for. `buildDistanceSql` uses
    // `ST_Distance_GEOS` instead, because core is 0 for ANY polygon pair, so
    // the builder's answer for the pairing core DOES get right has to be the
    // same number: a centre proxy IS a point.
    //
    // The bbox below is centred on exactly (200, 50), so the two statements
    // measure the same geometry against the same source.
    db.query(
      `CREATE OR REPLACE TABLE probe_point_parity AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': 199.0, 'ymin': 49.0, 'zmin': 0.0, 'xmax': 201.0, 'ymax': 51.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    const core = db.query(
      `SELECT MIN(ST_Distance(ST_Point(200, 50), s.geom)) AS d, arg_min(s."fid", ST_Distance(ST_Point(200, 50), s.geom)) AS nearest FROM "${VECTOR_TABLE}" s`,
    );
    expect(Number(core[0]?.["d"])).toBeCloseTo(50, 6);
    expect(core[0]?.["nearest"]).toBe("b");
    expect(
      db.query(
        buildDistanceSql({
          table: "probe_point_parity",
          source: VECTOR_TABLE,
          proxy: "centre",
          from: null,
          geometryColumn: null,
          ids: null,
          maxDistanceM: 500,
          prefix: "roads_",
          nearestId: { property: null },
        }),
      ),
    ).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        roads_distance_m: 50,
        roads_nearest_id: "b",
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_point_parity");
  });

  it("measures FOOTPRINTS read from the reader against a distant area", () => {
    // The proxy that re-reads the parent source, and the one the polygon
    // defect above hit hardest: the footprint is a `ST_Force2D`'d union, i.e. a
    // POLYGON, and every distance to a polygon source would have been 0.
    // P1's footprint is its PART's 4 x 4 (§7's contributor rule) and P3's spans
    // x 100-110, so against an area at x 200-300 they are 196 m and 90 m away;
    // P2 has no LoD 0 geometry at all and keeps §6.2's NULL.
    db.query(
      `CREATE OR REPLACE TABLE probe_far_src AS SELECT 0 AS "idx", 'f-far' AS "sid", 'far' AS "fid",
         '{"name":"Far"}'::JSON AS "props",
         ST_GeomFromText('POLYGON ((200 0, 300 0, 300 10, 200 10, 200 0))') AS "geom"`,
    );
    db.query(
      `CREATE OR REPLACE TABLE probe_fp_distance AS SELECT * FROM (VALUES
         ('P1', NULL::VARCHAR), ('P1-0', 'P1'), ('P2', NULL), ('P3', NULL)
       ) AS t("id", "feature_id")`,
    );
    expect(
      db.query(
        `SELECT * FROM (${buildDistanceSql({
          table: "probe_fp_distance",
          source: "probe_far_src",
          proxy: "footprint",
          from: `read_cityjson('${LOD0_FILE}', lod => '0.0')`,
          geometryColumn: "geometry_lod0_0",
          ids: null,
          maxDistanceM: 500,
          prefix: "roads_",
          nearestId: { property: null },
        })}) ORDER BY "id"`,
      ),
    ).toEqual([
      {
        id: "P1",
        f: "P1",
        no_proxy: false,
        roads_distance_m: 196,
        roads_nearest_id: "far",
      },
      {
        id: "P1-0",
        f: "P1",
        no_proxy: false,
        roads_distance_m: 196,
        roads_nearest_id: "far",
      },
      {
        id: "P2",
        f: "P2",
        no_proxy: true,
        roads_distance_m: null,
        roads_nearest_id: null,
      },
      {
        id: "P3",
        f: "P3",
        no_proxy: false,
        roads_distance_m: 90,
        roads_nearest_id: "far",
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_fp_distance");
    db.query("DROP TABLE IF EXISTS probe_far_src");
  });

  it("measures the distance to a MIXED GeometryCollection (§7.7, residual B10)", async () => {
    // §7.7's source is "a vector layer of ANY geometry type", and Task 12
    // converts every GeoJSON GeometryCollection — mixed families included — so
    // the statement has to MEASURE one, not merely parse it. The WKT is the
    // text `vectorSource.test.ts` pins Task 12 emitting, written through the
    // real encoder and the real table statement.
    //
    // The centre proxy of the bbox below is (0, 0). The collection's POINT is
    // at (20, 20) — about 28.3 away — and its LINESTRING's nearest vertex is
    // (3, 4), which is exactly 5. `ST_Distance` over a collection answers the
    // MINIMUM over its members, so 5 is the expected value.
    const table = vectorTableName("run_collection");
    const file = `${table}.json`;
    db.registerBytes(
      file,
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:c1",
          featureId: "c1",
          properties: { name: "Mixed" },
          wkt: "GEOMETRYCOLLECTION (POINT (20 20), LINESTRING (3 4, 10 10))",
        },
      ]),
    );
    db.query(buildVectorTableSql(table, file));
    db.query(
      `CREATE OR REPLACE TABLE probe_collection AS SELECT * FROM (VALUES
         ('B1', NULL::VARCHAR, {'xmin': -1.0, 'ymin': -1.0, 'zmin': 0.0, 'xmax': 1.0, 'ymax': 1.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "bbox")`,
    );
    expect(
      db.query(
        buildDistanceSql({
          table: "probe_collection",
          source: table,
          proxy: "centre",
          from: null,
          geometryColumn: null,
          ids: null,
          maxDistanceM: 500,
          prefix: "roads_",
          nearestId: { property: "name" },
        }),
      ),
    ).toEqual([
      {
        id: "B1",
        f: "B1",
        no_proxy: false,
        roads_distance_m: 5,
        roads_nearest_id: "Mixed",
      },
    ]);
    db.query("DROP TABLE IF EXISTS probe_collection");
    db.query(buildDropVectorTableSql(table));
    db.dropFile(file);
  });

  it("answers the predicates on a DEGENERATE extent, which a one-point building has", () => {
    // `ST_MakeEnvelope` over a bbox whose min and max are equal: a building
    // with a single coordinate, or a flat one. `buildProxySql`'s rectangle arm
    // builds exactly this, and it must PARSE and answer rather than raise —
    // one raise fails the whole join statement for every other building too.
    const rows = db.query(
      `SELECT ST_Area(b) AS area, ST_CoveredBy(b, a) AS covered,
              ST_Intersects(b, a) AS intersects
       FROM (SELECT ST_MakeEnvelope(5.0, 5.0, 5.0, 5.0) AS b,
                    ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))') AS a)`,
    );
    expect(rows).toEqual([{ area: 0, covered: true, intersects: true }]);
  });

  /**
   * §7.6's own statement, which is the only one in M3 with three CTEs, a
   * `p.* EXCLUDE` and three scalar sub-selects — a string assertion cannot tell
   * a binder error from a typo.
   *
   * `agg_rows` is one feature with a part (`b1`/`b1p`), a lone building (`b2`),
   * a building with no extent at all (`b3`) and a building whose value is NULL
   * (`b4`). The three areas are one that holds two buildings, one that holds
   * only the NULL-valued building, and one that holds nothing.
   */
  async function aggregateFixture(): Promise<void> {
    db.query(
      `CREATE OR REPLACE TABLE agg_rows AS SELECT * FROM (VALUES
         ('b1', 'b1', 50.0, {'xmin': 1.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 2.0, 'ymax': 2.0, 'zmax': 3.0}),
         ('b1p', 'b1', 50.0, NULL),
         ('b2', 'b2', 20.0, {'xmin': 3.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 4.0, 'ymax': 2.0, 'zmax': 3.0}),
         ('b3', 'b3', NULL, NULL),
         ('b4', 'b4', NULL, {'xmin': 100.2, 'ymin': 100.2, 'zmin': 0.0, 'xmax': 100.4, 'ymax': 100.4, 'zmax': 3.0})
       ) AS t("id", "feature_id", "roof_area_m2", "bbox")`,
    );
    db.registerBytes(
      "__src_agg.json",
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:z1",
          featureId: "z1",
          properties: {},
          wkt: "POLYGON ((0 0, 5 0, 5 5, 0 5, 0 0))",
        },
        {
          idx: 1,
          stableId: "id:string:z2",
          featureId: "z2",
          properties: {},
          wkt: "POLYGON ((100 100, 101 100, 101 101, 100 101, 100 100))",
        },
        {
          idx: 2,
          stableId: "id:string:z3",
          featureId: "z3",
          properties: {},
          wkt: "POLYGON ((200 200, 201 200, 201 201, 200 201, 200 200))",
        },
      ]),
    );
    db.query(buildVectorTableSql("__src_agg", "__src_agg.json"));
  }

  function dropAggregateFixture(): void {
    db.query(buildDropVectorTableSql("__src_agg"));
    db.query(`DROP TABLE IF EXISTS agg_rows`);
    db.dropFile("__src_agg.json");
  }

  it("runs the app's OWN aggregate statement, every area kept", async () => {
    await aggregateFixture();
    const rows = db.query(
      buildAggregateSql({
        table: "agg_rows",
        source: "__src_agg",
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        rows: [
          { op: "count", column: null, name: "bld_buildings_n" },
          { op: "sum", column: "roof_area_m2", name: "bld_sum_roof_area_m2" },
          { op: "mean", column: "roof_area_m2", name: "bld_mean_roof_area_m2" },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        sid: "id:string:z1",
        bld_buildings_n: 2,
        // The ROOT rows only: b1's 50 counted ONCE despite its part, plus b2's
        // 20 — a per-ROW sum would answer 120.
        bld_sum_roof_area_m2: 70,
        bld_mean_roof_area_m2: 35,
        multi_n: 0,
        buildings_total: 3,
        // b3 has no bbox at all — §6.2's "no proxy", never an area's zero.
        no_proxy_n: 1,
      },
      {
        // §7.6: "an area whose buildings are all NULL gets NULL" — and its
        // COUNT is still the real 1, because counting is not measuring.
        sid: "id:string:z2",
        bld_buildings_n: 1,
        bld_sum_roof_area_m2: null,
        bld_mean_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 3,
        no_proxy_n: 1,
      },
      {
        // The area with no buildings KEEPS its row: count 0, the rest NULL.
        sid: "id:string:z3",
        bld_buildings_n: 0,
        bld_sum_roof_area_m2: null,
        bld_mean_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 3,
        no_proxy_n: 1,
      },
    ]);
    dropAggregateFixture();
  });

  it("runs the DEFAULT row — a count alone — with no value relation at all", async () => {
    // §7.6's "Default row: count", which is the statement most runs will send:
    // no `v` CTE, and `p.* EXCLUDE ("g")` projecting the feature key alone. A
    // string test cannot tell that from a binder error.
    await aggregateFixture();
    const rows = db.query(
      buildAggregateSql({
        table: "agg_rows",
        source: "__src_agg",
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "within",
        rows: [{ op: "count", column: null, name: "bld_buildings_n" }],
      }),
    );
    expect(rows).toEqual([
      // `within` is boundary-inclusive covered-by, and both extents are well
      // inside their zone.
      {
        sid: "id:string:z1",
        bld_buildings_n: 2,
        multi_n: 0,
        buildings_total: 3,
        no_proxy_n: 1,
      },
      {
        sid: "id:string:z2",
        bld_buildings_n: 1,
        multi_n: 0,
        buildings_total: 3,
        no_proxy_n: 1,
      },
      {
        sid: "id:string:z3",
        bld_buildings_n: 0,
        multi_n: 0,
        buildings_total: 3,
        no_proxy_n: 1,
      },
    ]);
    dropAggregateFixture();
  });

  it("runs MIN and MAX over mixed, all-NULL and empty membership (minor 6)", async () => {
    // §7.6's aggregate list includes min and max, and the older cases only ran
    // count/sum/mean. The three membership shapes are told apart on one
    // statement: an area whose buildings are PARTLY valued (the NULLs are
    // ignored, never treated as zero), one whose buildings are ALL NULL, and one
    // with no building at all.
    db.query(
      `CREATE OR REPLACE TABLE agg_mm AS SELECT * FROM (VALUES
         ('m1', 'm1', 50.0, {'xmin': 1.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 2.0, 'ymax': 2.0, 'zmax': 3.0}),
         ('m2', 'm2', NULL, {'xmin': 3.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 4.0, 'ymax': 2.0, 'zmax': 3.0}),
         ('m3', 'm3', 12.0, {'xmin': 1.5, 'ymin': 1.5, 'zmin': 0.0, 'xmax': 2.5, 'ymax': 2.5, 'zmax': 3.0}),
         ('m4', 'm4', NULL, {'xmin': 100.2, 'ymin': 100.2, 'zmin': 0.0, 'xmax': 100.4, 'ymax': 100.4, 'zmax': 3.0}),
         ('m5', 'm5', NULL, {'xmin': 100.6, 'ymin': 100.6, 'zmin': 0.0, 'xmax': 100.8, 'ymax': 100.8, 'zmax': 3.0})
       ) AS t("id", "feature_id", "roof_area_m2", "bbox")`,
    );
    db.registerBytes(
      "__src_mm.json",
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:mixed",
          featureId: "mixed",
          properties: {},
          // Holds m1 (50), m2 (NULL) and m3 (12).
          wkt: "POLYGON ((0 0, 5 0, 5 5, 0 5, 0 0))",
        },
        {
          idx: 1,
          stableId: "id:string:allnull",
          featureId: "allnull",
          properties: {},
          // Holds m4 and m5, both NULL.
          wkt: "POLYGON ((100 100, 101 100, 101 101, 100 101, 100 100))",
        },
        {
          idx: 2,
          stableId: "id:string:empty",
          featureId: "empty",
          properties: {},
          wkt: "POLYGON ((200 200, 201 200, 201 201, 200 201, 200 200))",
        },
      ]),
    );
    db.query(buildVectorTableSql("__src_mm", "__src_mm.json"));
    const rows = db.query(
      buildAggregateSql({
        table: "agg_mm",
        source: "__src_mm",
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        rows: [
          { op: "count", column: null, name: "bld_buildings_n" },
          { op: "min", column: "roof_area_m2", name: "bld_min_roof_area_m2" },
          { op: "max", column: "roof_area_m2", name: "bld_max_roof_area_m2" },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        // ALL NULL: the count is real, the extremes are NULL — never 0.
        sid: "id:string:allnull",
        bld_buildings_n: 2,
        bld_min_roof_area_m2: null,
        bld_max_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 5,
        no_proxy_n: 0,
      },
      {
        // EMPTY membership: count 0 and no extremes, which is a different fact
        // from "every building here is NULL" and reads the same in the columns
        // — the COUNT is what tells them apart.
        sid: "id:string:empty",
        bld_buildings_n: 0,
        bld_min_roof_area_m2: null,
        bld_max_roof_area_m2: null,
        multi_n: 0,
        buildings_total: 5,
        no_proxy_n: 0,
      },
      {
        // MIXED: the NULL is ignored rather than dragged in as a zero minimum.
        sid: "id:string:mixed",
        bld_buildings_n: 3,
        bld_min_roof_area_m2: 12,
        bld_max_roof_area_m2: 50,
        multi_n: 0,
        buildings_total: 5,
        no_proxy_n: 0,
      },
    ]);
    db.query(buildDropVectorTableSql("__src_mm"));
    db.query(`DROP TABLE IF EXISTS agg_mm`);
    db.dropFile("__src_mm.json");
  });

  it("counts a building on a shared boundary in BOTH areas, and says so once", async () => {
    // §7.6: "a building counts for every area its proxy satisfies the predicate
    // with (a building on a boundary counts in both areas); the card says so
    // when it happens". The building spans the two zones' shared edge at x = 5.
    db.query(
      `CREATE OR REPLACE TABLE agg_edge AS SELECT * FROM (VALUES
         ('b1', 'b1', 10.0, {'xmin': 4.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 6.0, 'ymax': 2.0, 'zmax': 3.0}),
         ('b2', 'b2', 7.0, {'xmin': 1.0, 'ymin': 1.0, 'zmin': 0.0, 'xmax': 2.0, 'ymax': 2.0, 'zmax': 3.0})
       ) AS t("id", "feature_id", "roof_area_m2", "bbox")`,
    );
    db.registerBytes(
      "__src_edge.json",
      await encodeProjectedFeatures([
        {
          idx: 0,
          stableId: "id:string:a",
          featureId: "a",
          properties: {},
          wkt: "POLYGON ((0 0, 5 0, 5 5, 0 5, 0 0))",
        },
        {
          idx: 1,
          stableId: "id:string:b",
          featureId: "b",
          properties: {},
          wkt: "POLYGON ((5 0, 10 0, 10 5, 5 5, 5 0))",
        },
      ]),
    );
    db.query(buildVectorTableSql("__src_edge", "__src_edge.json"));
    const rows = db.query(
      buildAggregateSql({
        table: "agg_edge",
        source: "__src_edge",
        proxy: "rectangle",
        from: null,
        geometryColumn: null,
        ids: null,
        predicate: "intersects",
        rows: [
          { op: "count", column: null, name: "bld_buildings_n" },
          { op: "sum", column: "roof_area_m2", name: "bld_sum_roof_area_m2" },
        ],
      }),
    );
    expect(rows).toEqual([
      // `b1` is in BOTH, and its 10 is summed into both — nothing de-duplicates
      // the join, which is §7.6's rule.
      {
        sid: "id:string:a",
        bld_buildings_n: 2,
        bld_sum_roof_area_m2: 17,
        multi_n: 1,
        // The DISTINCT buildings the run aggregated over: two, not three.
        buildings_total: 2,
        no_proxy_n: 0,
      },
      {
        sid: "id:string:b",
        bld_buildings_n: 1,
        bld_sum_roof_area_m2: 10,
        multi_n: 1,
        buildings_total: 2,
        no_proxy_n: 0,
      },
    ]);
    db.query(buildDropVectorTableSql("__src_edge"));
    db.query(`DROP TABLE IF EXISTS agg_edge`);
    db.dropFile("__src_edge.json");
  });
});
