### Task 1: The real-engine probes for `three_d` and `spatial`

**Files:**

- Create: `tests/integration/duckdb/solids.test.ts`, `tests/integration/duckdb/crossLayer.test.ts`, `fixtures/composite-solid.city.json` (Decisions recorded item 4), `fixtures/invalid-solid.city.json` (the commander's fixture ruling)
- Modify: `tests/integration/duckdb/harness.ts` (an installer beside the `cityjson` install in `openDuckDB`). `fixtures/README.md`'s rows for the two new fixtures are Task 28's.

**Interfaces:**

- Consumes: `openDuckDB(): Promise<Harness>` and `fixtureBytes(fixture)` (`harness.ts:36, 88`).
- Produces: `export function installExtension(db: Harness, name: "spatial" | "three_d"): void` in `harness.ts`, and two `describe.skipIf(!enabled)` suites gated on `process.env.DUCKDB_INTEGRATION === "1"`.

**Why the SQL here is spelled LITERALLY and the builders are not imported.** `buildSolidMeasureSql` and `buildSolidValidationSql` do not exist yet — Task 6 creates them — so this suite cannot issue them. The rejection criterion "re-spelling SQL a later task will build" is satisfied in TWO places, and both are named so no reviewer has to guess: the literal below is copied VERBATIM into Task 6's unit test as the expected output of `buildSolidMeasureSql`, and Task 6 appends one case to `solids.test.ts` that runs the builder's own output against this engine. From Task 6 onwards the literal and the builder are pinned to each other; until then the literal is the only statement of the fact.

**This suite is opt-in and offline-safe.** It matches `tests/**/*.test.ts`, so the default run COLLECTS it and `describe.skipIf` keeps it from executing. The harness is imported DYNAMICALLY inside `beforeAll`, exactly as `layerTables.test.ts:128` does it, because a top-level import would evaluate the node bindings in every offline run.

**What this task pins and what it does NOT.** It pins the ENGINE's behaviour, spelled literally, for both extensions. It does not pin any builder's TEXT: `buildSolidMeasureSql` / `buildSolidValidationSql` (Task 6), `buildVectorTableSql` (Task 13), `buildFeatureProxySql` (Task 14) and `buildAggregateSql` (Task 19) are each pinned by their OWN task, which appends a case running that builder's output against this same engine — Task 6 to `solids.test.ts`, Tasks 13, 14, 16 and 19 to `crossLayer.test.ts` — Task 16's append is the three PREDICATES (`ST_CoveredBy` vs `ST_Within`, a boundary centre, a degenerate `ST_MakeEnvelope`), which a unit test over a fake `query` cannot see. (Task 17 appends nothing: its statement is `buildFeatureProxySql` joined to the vector table, and both halves are already pinned.) No later task may say "Task 1 already covers it": Task 1 covers the FACT, the owning task covers the TEXT.

**This task also adds TWO fixtures, both spelled out in full in Step 1.**

`fixtures/composite-solid.city.json` (Decisions recorded item 4) is a minimal CityJSON 2.0 file with one Building whose LoD `"2.2"` geometry is a `CompositeSolid` of two unit cubes sharing a face — local `(0,0,0)`-`(1,1,1)` and `(1,0,0)`-`(2,1,1)` over the RD translate, so the members' volumes sum to exactly 2. Every ring is wound counter-clockwise seen from OUTSIDE (each member's signed volume is `+1`, checked by the divergence formula before this plan was written), because an unoriented fixture makes `ST_3DVolume` RAISE — the very trap this plan's guard exists for.

`fixtures/invalid-solid.city.json` (the commander's fixture ruling) is one Building with **no parts** whose LoD `"2.2"` `Solid` is NOT closed: it is `NL.IMBAG.Pand.0001`'s own solid from `two-buildings.city.json`, lifted out with the nine vertices it uses — 7 faces, 2 open edges, 1 non-manifold edge, `is_valid` false, `is_closed` false, envelope 388 m², footprint 80 m², zmin 0, zmax 8.4. It exists because `two-buildings.city.json` cannot express "a building whose solid is invalid" at the FEATURE level: `NL.IMBAG.Pand.0001` has a MultiSurface PART at 2.2, so §7's contributor rule makes the PART the contributor and the whole feature reads "not a solid". Over `two-buildings`, Measure solids therefore measures ONE feature (`NL.IMBAG.Pand.0002`, valid, volume 2178) and skips one ("not a solid"); every FEATURE-level "invalid solid" expectation in this milestone uses `invalid-solid.city.json` instead.

Both rows go into `fixtures/README.md` (Task 28).

- [ ] **Step 1: Add the two fixtures**

Create `fixtures/composite-solid.city.json`:

```json
{
  "type": "CityJSON",
  "version": "2.0",
  "transform": {
    "scale": [1.0, 1.0, 1.0],
    "translate": [85000.0, 446000.0, 0.0]
  },
  "metadata": {
    "referenceSystem": "https://www.opengis.net/def/crs/EPSG/0/7415",
    "title": "CompositeSolid fixture",
    "identifier": "fixture-composite-solid"
  },
  "CityObjects": {
    "NL.TEST.Composite.0001": {
      "type": "Building",
      "attributes": {
        "measuredHeight": 1.0,
        "roofType": "flat"
      },
      "geometry": [
        {
          "type": "CompositeSolid",
          "lod": "2.2",
          "boundaries": [
            [
              [
                [[0, 3, 2, 1]],
                [[4, 5, 6, 7]],
                [[0, 1, 5, 4]],
                [[1, 2, 6, 5]],
                [[2, 3, 7, 6]],
                [[3, 0, 4, 7]]
              ]
            ],
            [
              [
                [[1, 2, 9, 8]],
                [[5, 10, 11, 6]],
                [[1, 8, 10, 5]],
                [[8, 9, 11, 10]],
                [[9, 2, 6, 11]],
                [[2, 1, 5, 6]]
              ]
            ]
          ]
        }
      ]
    }
  },
  "vertices": [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
    [2, 0, 0],
    [2, 1, 0],
    [2, 0, 1],
    [2, 1, 1]
  ]
}
```

The nesting is CityJSON 2.0's: a `CompositeSolid`'s boundaries are an array of SOLIDS, each solid an array of SHELLS, each shell an array of SURFACES, each surface an array of RINGS. The two solids share the face `x = 1` (vertices 1, 2, 6, 5), which is why this is a composite and not a MultiSolid of two disjoint boxes. No `semantics` block: semantics are optional and nothing here reads them — the parser test for `geometryType` is Task 2's, on hand-built models.

Create `fixtures/invalid-solid.city.json`:

```json
{
  "type": "CityJSON",
  "version": "2.0",
  "transform": {
    "scale": [0.001, 0.001, 0.001],
    "translate": [85000.0, 446000.0, 0.0]
  },
  "metadata": {
    "referenceSystem": "https://www.opengis.net/def/crs/EPSG/0/7415",
    "title": "Invalid solid fixture",
    "identifier": "fixture-invalid-solid"
  },
  "CityObjects": {
    "NL.IMBAG.Pand.0001": {
      "type": "Building",
      "attributes": {
        "measuredHeight": 8.4,
        "roofType": "gabled",
        "yearOfConstruction": 1923,
        "status": "in use",
        "function": "residential"
      },
      "geometry": [
        {
          "type": "Solid",
          "lod": "2.2",
          "boundaries": [
            [
              [[0, 3, 2, 1]],
              [[4, 5, 6, 7]],
              [[8, 5, 4]],
              [[0, 1, 5, 4]],
              [[1, 2, 6, 5]],
              [[2, 3, 7, 6]],
              [[3, 0, 4, 7]]
            ]
          ],
          "semantics": {
            "surfaces": [
              {
                "type": "GroundSurface"
              },
              {
                "type": "RoofSurface"
              },
              {
                "type": "RoofSurface",
                "slope": 35.0
              },
              {
                "type": "WallSurface"
              },
              {
                "type": "WallSurface"
              },
              {
                "type": "WallSurface"
              },
              {
                "type": "WallSurface"
              }
            ],
            "values": [[0, 1, 2, 3, 4, 5, 6]]
          }
        }
      ]
    }
  },
  "vertices": [
    [0, 0, 0],
    [10000, 0, 0],
    [10000, 8000, 0],
    [0, 8000, 0],
    [0, 0, 6000],
    [10000, 0, 6000],
    [10000, 8000, 6000],
    [0, 8000, 6000],
    [5000, 0, 8400]
  ]
}
```

The gable face `[[8, 5, 4]]` is the reason the solid does not close: it is a ridge triangle over a flat roof that was never opened, so two of its edges belong to one face only and one belongs to three. That is the DEFECT this fixture carries, and it is verbatim what `two-buildings.city.json` already contains — kept identical so the row-level numbers the probe below asserts on the two files agree.

- [ ] **Step 2: Write the failing solids probe**

Create `tests/integration/duckdb/solids.test.ts`:

```ts
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
 * The one-statement shape §7.2 runs, verbatim.
 *
 * `ST_3DTryFromWKB` in a subquery so the parse happens ONCE per row; the
 * validation report beside it, so `r.is_valid` guards `ST_3DVolume` in the
 * outer select. Every other measure is applied unguarded, which is the fact
 * the assertions below exist to pin.
 */
const MEASURE_SQL = `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, r.is_valid AS is_valid, CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('two.city.json', lod => '2.2'))`;

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

  afterAll(() => db?.close());

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

  it("makes ST_3DValidationReport(NULL) NULL, so is_valid is NULL and not false", () => {
    // The row that is NOT A SOLID is told from the row that is INVALID by
    // `s IS NULL`, never by the report — `r.is_valid` is NULL for both a
    // missing solid and (nothing else), and a task reading NULL as false
    // would write `valid = false` where §7.2 requires NULL.
    const rows = db.query(
      "SELECT ST_3DValidationReport(NULL) IS NULL AS report_null, ST_3DValidationReport(NULL).is_valid IS NULL AS flag_null",
    );
    expect(rows[0]).toMatchObject({ report_null: true, flag_null: true });
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
    const rows = db.query(
      `SELECT "id", r.is_closed AS closed, r.is_manifold AS man, r.is_oriented AS ori, r.is_valid AS valid, r.open_edge_count AS open_n, r.non_manifold_edge_count AS nm_n, r.degenerate_face_count AS deg_n FROM (SELECT "id", ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r FROM read_cityjson('${SOURCE}', lod => '${LOD}')) ORDER BY "id"`,
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
      `SELECT ST_3DValidationReport(s).is_valid AS valid,
              CASE WHEN ST_3DValidationReport(s).is_valid THEN ST_3DVolume(s) END AS volume,
              ST_3DNumShells(s) AS shells
       FROM (SELECT ST_3DTryFromWKB("geometry_lod2_2") AS s
             FROM read_cityjson('composite.city.json', lod => '2.2'))`,
    );
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
```

- [ ] **Step 3: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts
```

Expected: FAIL — `harness.installExtension is not a function` in `beforeAll`.

- [ ] **Step 4: Add the installer to the harness**

In `tests/integration/duckdb/harness.ts`, after `openDuckDB` (the file's last export), append:

```ts
/**
 * `INSTALL` + `LOAD` for one of the app's two lazy extensions, through the
 * harness's own connection.
 *
 * The app's door is `ensureExtension(name)` (`duckdb.ts:540`), which issues
 * exactly these two statements once per session and memoises the promise. The
 * node harness cannot call it (it boots a Worker from a jsDelivr blob), so the
 * statements are spelled here — the ONE place in the integration suites that
 * may, and the reason a probe suite for both extensions is possible at all.
 *
 * `three_d` comes from the COMMUNITY repository and `spatial` from core, which
 * is the only difference between them. Left to throw: a failure is the report
 * the suite exists to make — the slot for this DuckDB version is gone or was
 * rebuilt — and the extension's own words say more than any wrapper could.
 */
export function installExtension(
  db: Harness,
  name: "spatial" | "three_d",
): void {
  db.query(
    name === "three_d" ? "INSTALL three_d FROM community;" : "INSTALL spatial;",
  );
  db.query(`LOAD ${name};`);
}
```

- [ ] **Step 5: Run the solids probe to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts
```

Expected: PASS, all 14 cases, none skipped (`describe.skipIf(!enabled)` is off because `DUCKDB_INTEGRATION=1`). A failure on the first `INSTALL` means the community slot moved — report it, do not work around it.

- [ ] **Step 6: Write the cross-layer probe**

Create `tests/integration/duckdb/crossLayer.test.ts`:

```ts
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
    const rows = db.query(
      `SELECT ST_Area(g) AS area, ST_NDims(g) AS dims FROM (SELECT ST_GeomFromWKB("geometry_lod2_2") AS g FROM read_cityjson('${SOURCE}', lod => '${LOD}') WHERE "id" = '${NOT_A_SOLID}')`,
    );
    // ST_Area is the 2-D area even on a Z geometry.
    expect(Number(rows[0]?.["area"])).toBeGreaterThan(0);
    expect(Number(rows[0]?.["dims"])).toBe(3);
  });

  it("returns an EMPTY geometry, not NULL, for a polygon with [] coordinates", () => {
    const rows = db.query(
      `SELECT ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[]}') IS NULL AS is_null, ST_IsEmpty(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[]}')) AS is_empty, ST_GeomFromGeoJSON(NULL) IS NULL AS null_in`,
    );
    expect(rows[0]).toMatchObject({
      is_null: false,
      is_empty: true,
      null_in: true,
    });
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
    expect([...(rows[0]?.["keys"] as string[])].sort()).toEqual(["n", "name"]);
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
```

- [ ] **Step 7: Run both probes**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
```

Expected: PASS, all four integration suites. Then confirm the DEFAULT run still skips them:

```bash
npx vitest run tests/integration/duckdb
```

Expected: PASS with every case skipped, and no network access.

- [ ] **Step 8: Commit**

The two fixtures are STAGED here, with the suites that read them — a probe whose fixture is not in the tree is a suite nobody else can run.

```bash
git add fixtures/composite-solid.city.json fixtures/invalid-solid.city.json \
  tests/integration/duckdb/harness.ts tests/integration/duckdb/solids.test.ts \
  tests/integration/duckdb/crossLayer.test.ts
git commit -m "test: probe three_d and spatial against real DuckDB 1.5.5"
```

---
