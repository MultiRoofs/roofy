// @vitest-environment node
/**
 * The SQL this app emits, run against a REAL DuckDB 1.5.5 with the real
 * cityjson extension.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 * Skipped otherwise, because it downloads a 36 MB binary and fetches the
 * community extension over the network — neither belongs in the default run.
 *
 * What only this suite can catch: the community slot for a DuckDB version can
 * be REBUILT under us (the duckdb-wasm pin pins the extension build, it does
 * not freeze it), and a column that changed name or type would sail through
 * every unit test in the repo.
 *
 * Every statement here comes from the app's OWN builders — `sql.ts` for the
 * SQL, `columnKind.ts` for what a column means, `layerRows.ts` for the flat
 * fallback's rows, `export.ts`/`cityGmlModule.ts` for the read-back rules. A
 * test that re-spelled the SQL would only prove that the test's SQL works.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Harness } from "./harness";
import {
  classifyColumnType,
  isDroppedColumn,
  lodsFromColumnNames,
  type ColumnInfo,
} from "../../../src/insights/columnKind";
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
  buildCountSql,
  buildFeatureIdsSql,
  buildPageSql,
  buildRootTypesSql,
  compileFilter,
  exportColumnNames,
  quoteIdent,
  quoteLiteral,
  READ_JSON_OPTIONS,
} from "../../../src/insights/sql";
import { groupTypesByModule } from "../../../src/insights/cityGmlModule";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
} from "../../../src/insights/layerRows";
import { validateExportBytes } from "../../../src/insights/export";
import type { CityModel } from "../../../src/domain/citymodel/types";

/**
 * `export.ts` reaches DuckDB through `insights/duckdb.ts`, whose module scope
 * imports `@duckdb/duckdb-wasm` — the BROWSER bundle, which has no business
 * being evaluated by a Node suite that talks to the node bindings, nor by the
 * default offline run that only collects this file. Only the module's PURE
 * exports are used here (`validateExportBytes`), so the engine seam is stubbed
 * out entirely; every stub throws, because nothing in this file may reach one.
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

const TABLE = "layer_t33";

/** The `bbox` type `layerTables.FLAT_COLUMN_TYPES` forces on a flat table —
 *  spelled here because the ALTER is built inside `buildFromRows`. */
const BBOX_TYPE =
  "STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)";

/**
 * The two export routes' output names, spelled as the app spells them:
 * `export_N.<format>` for an attribute file, `exp_N` for a CityParquet
 * package's directory. The distinction is load-bearing here — the package's
 * cleanup is checked with `glob('exp_*')`, and `export_t33.csv` deliberately
 * does not match that pattern.
 */
const ATTRIBUTE_BASE = "export_t33";
const EXPORT_BASE = "exp_t33";

/** Files this suite writes to DISK (see the harness's note on NODE_RUNTIME).
 *  Dropped through DuckDB where it can, removed here as the safety net. */
const WRITTEN_DIRS = [
  EXPORT_BASE,
  `${EXPORT_BASE}_joined`,
  `${EXPORT_BASE}_cutpkg`,
];
const WRITTEN_FILES = [
  `${ATTRIBUTE_BASE}.parquet`,
  `${ATTRIBUTE_BASE}.csv`,
  `${ATTRIBUTE_BASE}.json`,
];

describe.skipIf(!enabled)("layer tables over real fixtures", () => {
  let db: Harness;
  let columns: ColumnInfo[];
  /** Every column the reader published, dropped ones included. */
  let allColumns: ColumnInfo[];

  function describeColumns(from: string): ColumnInfo[] {
    return db.query(`DESCRIBE SELECT * FROM ${from}`).map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      kind: classifyColumnType(String(row.column_type)),
    }));
  }

  beforeAll(async () => {
    // DYNAMIC, inside `beforeAll`: the file is collected by the default run
    // (it matches `tests/**/*.test.ts`) and only `describe.skipIf` keeps it
    // from executing — a top-level import would still evaluate the harness,
    // which `require`s the DuckDB node bindings and resolves three wasm paths,
    // in every offline run of the suite.
    const started = Date.now();
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    console.log(
      `[t33] engine + cityjson extension ready in ${Date.now() - started} ms`,
    );

    db.register("two.city.json", "two-buildings.city.json");
    allColumns = describeColumns("read_cityjson('two.city.json')");
    columns = allColumns.filter((c) => !isDroppedColumn(c.name));
    const select = columns.map((c) => quoteIdent(c.name)).join(", ");
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(TABLE)} AS SELECT ${select} FROM read_cityjson('two.city.json')`,
    );
  }, 180_000);

  afterAll(() => {
    db?.close();
    // A COPY under NODE_RUNTIME lands on the real filesystem, so a failed run
    // must not leave a package sitting in the working tree.
    for (const dir of WRITTEN_DIRS) {
      rmSync(resolve(process.cwd(), dir), { recursive: true, force: true });
    }
    for (const file of WRITTEN_FILES) {
      rmSync(resolve(process.cwd(), file), { force: true });
    }
  });

  it("returns exactly the id set parseCityJSON produces — the map sync joins on it", async () => {
    // The whole map filter rests on this equality: `buildFeatureIdsSql` returns
    // reader `id` values, `setVisibleObjectIds` hands them to the mesh, and the
    // mesh looks them up in the PARSED model's object keys. A drift on either
    // side hides everything, silently and with no error to read.
    const { parseCityJSON } = await import("@cityjson/navara-core");
    const { fixtureBytes } = await import("./harness");
    const json = JSON.parse(
      new TextDecoder().decode(fixtureBytes("two-buildings.city.json")),
    ) as Parameters<typeof parseCityJSON>[0];
    const parsed = new Set(Object.keys(parseCityJSON(json).objects));
    const fromReader = new Set(
      db
        .query(`SELECT "id" FROM ${quoteIdent(TABLE)}`)
        .map((row) => String(row.id)),
    );
    // Three objects, and the BuildingPart is one of them: a reader that
    // published only the roots would still satisfy a bare size check.
    expect([...fromReader].sort()).toEqual([...parsed].sort());
    expect(fromReader.has("NL.IMBAG.Pand.0001-part1")).toBe(true);
  });

  it("reads a CityJSONSeq file to the same id set, through read_cityjsonseq", async () => {
    const { parseCityJSONSeq } = await import("@cityjson/navara-core");
    const { fixtureBytes } = await import("./harness");
    db.register("two.city.jsonl", "two-buildings.city.jsonl");
    const parsed = new Set(
      Object.keys(
        parseCityJSONSeq(
          new TextDecoder().decode(fixtureBytes("two-buildings.city.jsonl")),
        ).objects,
      ),
    );

    const seqColumns = describeColumns("read_cityjsonseq('two.city.jsonl')");
    const kept = seqColumns.filter((c) => !isDroppedColumn(c.name));
    const select = kept.map((c) => quoteIdent(c.name)).join(", ");
    db.query(
      `CREATE OR REPLACE TABLE "layer_t33_seq" AS SELECT ${select} FROM read_cityjsonseq('two.city.jsonl')`,
    );
    const fromReader = new Set(
      db.query('SELECT "id" FROM "layer_t33_seq"').map((row) => String(row.id)),
    );
    expect([...fromReader].sort()).toEqual([...parsed].sort());
    // And the two readers agree with each other, which is what makes the rest
    // of this suite's findings hold for a `.jsonl` layer too.
    expect(kept.map((c) => c.name)).toEqual(columns.map((c) => c.name));
    db.query('DROP TABLE "layer_t33_seq"');
  });

  it("still publishes the identity columns this app depends on", () => {
    const names = columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("feature_id");
    expect(names).toContain("object_type");
    expect(names).toContain("parents");
    expect(names).toContain("children");
  });

  it("drops every geometry, material, texture and template column", () => {
    for (const c of columns) {
      expect(c.name.startsWith("geometry_")).toBe(false);
      expect(c.name.startsWith("material_")).toBe(false);
      expect(c.name.startsWith("texture_")).toBe(false);
      expect(c.name).not.toBe("template");
    }
    // Non-vacuous: the reader really did publish some of that family, and
    // `isDroppedColumn` really did remove them.
    expect(allColumns.length).toBeGreaterThan(columns.length);
  });

  it("reads an LoD ladder off the reader's own column names", () => {
    const lods = lodsFromColumnNames(allColumns.map((c) => c.name));
    expect(lods.map((l) => l.suffix)).toEqual(["2_2"]);
    expect(lods.map((l) => l.label)).toEqual(["2.2"]);
  });

  it("spells Delft's ladder the way the reader does — LoD 0 is `0_0`", () => {
    // The regression this pins: `lodColumnSuffix("0")` produced
    // `geometry_lod0`, and 3D BAG writes `geometry_lod0_0`. The label is what
    // the dialog SHOWS; the suffix is what a column name is BUILT FROM, and
    // only the file gets to decide the second one.
    db.register("delft.fcb", "delft.fcb");
    const described = db.query(
      "DESCRIBE SELECT * FROM read_flatcitybuf('delft.fcb')",
    );
    const lods = lodsFromColumnNames(
      described.map((r) => String(r.column_name)),
    );
    expect(lods.map((l) => l.label)).toEqual(["0.0", "1.2", "1.3", "2.2"]);
    expect(lods.map((l) => l.suffix)).toEqual(["0_0", "1_2", "1_3", "2_2"]);

    // And every suffix really does name a pair of columns that exist.
    const names = new Set(described.map((r) => String(r.column_name)));
    for (const { suffix } of lods) {
      expect(names.has(`geometry_lod${suffix}`)).toBe(true);
      expect(names.has(`geometry_properties_lod${suffix}`)).toBe(true);
    }
  });

  it("runs the page SQL and returns rows", () => {
    const rows = db.query(buildPageSql(TABLE, columns, null, null, 0, 100));
    expect(rows.length).toBe(3);
    expect(typeof rows[0]!.id).toBe("string");
  });

  it("projects nested columns as JSON text, never as an Arrow vector", () => {
    const rows = db.query(
      buildPageSql(
        TABLE,
        columns,
        `"object_type" = 'BuildingPart'`,
        null,
        0,
        1,
      ),
    );
    const parents = rows[0]!.parents;
    expect(typeof parents).toBe("string");
    expect(JSON.parse(String(parents))).toEqual(["NL.IMBAG.Pand.0001"]);
  });

  it("counts, filters and expands matches to whole features", () => {
    const total = db.query(buildCountSql(TABLE, null))[0]!.n as number;
    expect(total).toBe(3);

    const compiled = compileFilter(
      {
        logic: "AND",
        conditions: [
          { id: "c", column: "object_type", op: "=", value: "Building" },
        ],
      },
      columns,
    );
    expect(compiled.ok).toBe(true);
    const where = compiled.ok ? compiled.where : null;

    const filtered = db.query(buildCountSql(TABLE, where))[0]!.n as number;
    expect(filtered).toBe(2);

    const ids = db.query(buildFeatureIdsSql(TABLE, where));
    // Feature expansion can only ever ADD rows to the matched set — and here
    // it really does: the BuildingPart follows its Building.
    expect(ids.length).toBe(3);
  });

  it("lists the top-level types with the parents IS NULL test", () => {
    const types = db.query(buildRootTypesSql(TABLE)).map((r) => r.value);
    expect(types).toEqual(["Building"]);
  });

  /** A model of nothing but root Buildings with the given ids — the flat
   *  fallback's most common shape, and the one that shows every inference
   *  hazard the ALTERs exist for. */
  function allRootModel(ids: ReadonlyArray<string>): CityModel {
    const objects: Record<string, CityModel["objects"][string]> = {};
    for (const id of ids) {
      objects[id] = {
        id,
        objectType: "Building",
        attributes: {},
        surfaces: [],
        bbox: null,
        children: [],
        parents: [],
        lod: null,
      };
    }
    return {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects,
    };
  }

  it("types an ALL-NULL parents column as VARCHAR[] on the flat-fallback path", () => {
    // The fallback's schema must match the reader's, and `read_json_auto`
    // types an all-NULL column as JSON. The ALTER in `buildFromRows` is what
    // fixes it — this asserts the SQL that task emits really does.
    const model: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        A: {
          id: "A",
          objectType: "Building",
          attributes: { yearOfConstruction: 1923 },
          surfaces: [],
          bbox: null,
          children: [],
          parents: [],
          lod: null,
        },
        B: {
          id: "B",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          bbox: null,
          children: [],
          parents: [],
          lod: null,
        },
      },
    };
    db.registerBytes("flat.json", encodeRowsAsJson(flatRowsFromModel(model)));
    db.query(
      `CREATE OR REPLACE TABLE "flat_t33" AS SELECT * FROM read_json_auto('flat.json', ${READ_JSON_OPTIONS})`,
    );
    // The options do NOT fix this one — they are about which COLUMNS exist,
    // not about the type an all-NULL one is given. The ALTER is the only fix.
    const inferred = db
      .query('DESCRIBE "flat_t33"')
      .find((r) => r.column_name === "parents");
    expect(inferred?.column_type).toBe("JSON");

    for (const column of ["parents", "children"]) {
      db.query(
        `ALTER TABLE "flat_t33" ALTER COLUMN ${quoteIdent(column)} TYPE VARCHAR[]`,
      );
    }
    const fixed = db
      .query('DESCRIBE "flat_t33"')
      .filter(
        (r) => r.column_name === "parents" || r.column_name === "children",
      )
      .map((r) => r.column_type);
    expect(fixed).toEqual(["VARCHAR[]", "VARCHAR[]"]);
    expect(
      db.query('SELECT count(*) AS n FROM "flat_t33" WHERE parents IS NULL')[0]!
        .n,
    ).toBe(2);
    // And the fallback's `parents IS NULL` really is the reader's root test.
    expect(db.query(buildRootTypesSql("flat_t33")).map((r) => r.value)).toEqual(
      ["Building"],
    );
    db.query('DROP TABLE "flat_t33"');
  });

  it("declares the reader's bbox EXACTLY as the flat fallback forces it", () => {
    // The point of the flat table's `bbox` column: a tool that reads
    // `"bbox"."zmin"` must see the SAME struct on a reader-backed table and on
    // a flat one. If the community extension ever renames a field, reorders
    // them or changes the numeric type, this is the ONLY test in the repo that
    // would notice — every unit test mocks the DESCRIBE.
    expect(allColumns.find((c) => c.name === "bbox")?.type).toBe(BBOX_TYPE);
  });

  it("types an ALL-NULL bbox column as the reader's STRUCT on the flat-fallback path", () => {
    // Same mechanism as `parents`, different consequence: every object in this
    // model has no geometry, `read_json_auto` types the all-NULL `bbox` as
    // JSON, and `"bbox"."zmin"` — how the extent is read on EVERY layer kind —
    // binds to no field on a JSON column. The ALTER in `buildFromRows` is the
    // fix, and BOTH casts it depends on are exercised here: JSON -> STRUCT
    // (this test) and STRUCT(... BIGINT) -> STRUCT(... DOUBLE) (below).
    db.registerBytes(
      "flatbbox.json",
      encodeRowsAsJson(flatRowsFromModel(allRootModel(["A", "B"]))),
    );
    db.query(
      `CREATE OR REPLACE TABLE "flat_bb" AS SELECT * FROM read_json_auto('flatbbox.json', ${READ_JSON_OPTIONS})`,
    );
    expect(
      db.query('DESCRIBE "flat_bb"').find((r) => r.column_name === "bbox")
        ?.column_type,
    ).toBe("JSON");
    db.query(`ALTER TABLE "flat_bb" ALTER COLUMN "bbox" TYPE ${BBOX_TYPE}`);
    expect(
      db.query('DESCRIBE "flat_bb"').find((r) => r.column_name === "bbox")
        ?.column_type,
    ).toBe(BBOX_TYPE);
    expect(
      db
        .query('SELECT "bbox"."zmin" AS zmin FROM "flat_bb"')
        .map((r) => r.zmin),
    ).toEqual([null, null]);
    db.query('DROP TABLE "flat_bb"');
  });

  it("carries an INTEGER-coordinate bbox through the ALTER as DOUBLE", () => {
    // A model whose extents are whole numbers infers STRUCT(xmin BIGINT, ...),
    // which is not the reader's STRUCT(xmin DOUBLE, ...). The ALTER has to cast
    // struct-to-struct WITHOUT losing the values, or the tool reads a table
    // whose column type depends on whether the file happened to use integers.
    const model = allRootModel(["A"]);
    (model.objects.A as { bbox: unknown }).bbox = [1, 2, 3, 4, 5, 9];
    db.registerBytes(
      "flatbbox2.json",
      encodeRowsAsJson(flatRowsFromModel(model)),
    );
    db.query(
      `CREATE OR REPLACE TABLE "flat_bb2" AS SELECT * FROM read_json_auto('flatbbox2.json', ${READ_JSON_OPTIONS})`,
    );
    db.query(`ALTER TABLE "flat_bb2" ALTER COLUMN "bbox" TYPE ${BBOX_TYPE}`);
    expect(
      db.query('DESCRIBE "flat_bb2"').find((r) => r.column_name === "bbox")
        ?.column_type,
    ).toBe(BBOX_TYPE);
    expect(
      db.query(
        'SELECT "bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM "flat_bb2"',
      )[0],
    ).toMatchObject({ zmin: 3, zmax: 9 });
    db.query('DROP TABLE "flat_bb2"');
  });

  it("keeps a DATE-SHAPED or numeric id readable AS THE MODEL SPELLS IT", () => {
    // The bug: `read_json_auto` infers `"2024-01-01"` as DATE, and the map sync
    // then reads back epoch-millisecond strings that match no key in the model
    // — selection, map filtering and every export lose the layer's ids, with
    // the grid still showing something that looks like a date. The ALTER to
    // VARCHAR is what makes the round trip exact.
    const ids = ["2024-01-01", "2024-02-03"];
    const model = allRootModel(ids);
    db.registerBytes("flatid.json", encodeRowsAsJson(flatRowsFromModel(model)));
    db.query(
      `CREATE OR REPLACE TABLE "flat_id" AS SELECT * FROM read_json_auto('flatid.json', ${READ_JSON_OPTIONS})`,
    );
    const before = db
      .query('DESCRIBE "flat_id"')
      .filter((r) => r.column_name === "id" || r.column_name === "feature_id")
      .map((r) => r.column_type);
    // The finding itself, pinned: without the ALTER these are not strings.
    expect(before).toEqual(["DATE", "DATE"]);

    for (const column of ["id", "feature_id", "object_type"]) {
      db.query(
        `ALTER TABLE "flat_id" ALTER COLUMN ${quoteIdent(column)} TYPE VARCHAR`,
      );
    }
    expect(
      db
        .query('DESCRIBE "flat_id"')
        .filter((r) => r.column_name === "id" || r.column_name === "feature_id")
        .map((r) => r.column_type),
    ).toEqual(["VARCHAR", "VARCHAR"]);
    expect(
      db.query('SELECT "id" FROM "flat_id" ORDER BY 1').map((r) => r.id),
    ).toEqual(ids);
    db.query('DROP TABLE "flat_id"');

    // A numeric-looking id survives the same route. It arrives as a JSON
    // STRING (an object key always is), so the inference already gets it
    // right — the ALTER is the no-op it is meant to be here.
    db.registerBytes(
      "flatnum.json",
      encodeRowsAsJson(flatRowsFromModel(allRootModel(["42", "7"]))),
    );
    db.query(
      `CREATE OR REPLACE TABLE "flat_num" AS SELECT * FROM read_json_auto('flatnum.json', ${READ_JSON_OPTIONS})`,
    );
    db.query('ALTER TABLE "flat_num" ALTER COLUMN "id" TYPE VARCHAR');
    expect(
      db.query('SELECT "id" FROM "flat_num" ORDER BY 1').map((r) => r.id),
    ).toEqual(["42", "7"]);
    db.query('DROP TABLE "flat_num"');
  });

  it("keeps every attribute as its OWN column, however heterogeneous", () => {
    // Without `READ_JSON_OPTIONS` this is catastrophic rather than untidy:
    // rows whose keys vary collapse into ONE `MAP(VARCHAR, JSON)` column, so
    // the table has no `id` at all and nothing the app names exists.
    const objects: Record<string, CityModel["objects"][string]> = {};
    for (let i = 0; i < 300; i++) {
      objects[`o${i}`] = {
        id: `o${i}`,
        objectType: "Building",
        attributes: { [`attr_${i}`]: i },
        surfaces: [],
        bbox: null,
        children: [],
        parents: [],
        lod: null,
      };
    }
    const bytes = encodeRowsAsJson(
      flatRowsFromModel({
        sourceEncoding: "cityjson",
        metadata: {},
        bbox: null,
        vertexCount: 0,
        objects,
      }),
    );

    db.registerBytes("wide_plain.json", bytes.slice());
    db.query(
      `CREATE OR REPLACE TABLE "wide_plain" AS SELECT * FROM read_json_auto('wide_plain.json')`,
    );
    const collapsed = db.query('DESCRIBE "wide_plain"');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.column_type).toBe("MAP(VARCHAR, JSON)");
    db.query('DROP TABLE "wide_plain"');

    db.registerBytes("wide_opts.json", bytes);
    db.query(
      `CREATE OR REPLACE TABLE "wide_opts" AS SELECT * FROM read_json_auto('wide_opts.json', ${READ_JSON_OPTIONS})`,
    );
    const kept = db.query('DESCRIBE "wide_opts"').map((r) => r.column_name);
    // Six fixed columns plus one per attribute, none lost or merged.
    expect(kept).toHaveLength(306);
    for (const fixed of ["id", "feature_id", "object_type"]) {
      expect(kept).toContain(fixed);
    }
    expect(kept).toContain("attr_0");
    expect(kept).toContain("attr_299");
    expect(db.query('SELECT count(*) AS n FROM "wide_opts"')[0]!.n).toBe(300);
    db.query('DROP TABLE "wide_opts"');
  });

  it("sorts a BIGINT (castText) column NUMERICALLY, not lexicographically", () => {
    // The regression: `castText` is projected as `"c"::VARCHAR AS "c"`, and a
    // bare `ORDER BY "c"` binds the ALIAS — so 985 sorts after 2005 because
    // "9" > "2". Only the table-qualified clause gets this right, and only the
    // real engine can prove it.
    db.query(
      `CREATE OR REPLACE TABLE "sort_probe" AS SELECT * FROM (VALUES
         ('a', 2005::BIGINT), ('b', 985::BIGINT), ('c', NULL)
       ) AS t("id", "bouwjaar")`,
    );
    const columnsProbe: ColumnInfo[] = [
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "bouwjaar", type: "BIGINT", kind: "castText" },
    ];
    const rows = db.query(
      buildPageSql(
        "sort_probe",
        columnsProbe,
        null,
        { column: "bouwjaar", dir: "desc" },
        0,
        10,
      ),
    );
    // 2005 first, then 985, then the NULL — lexicographically it would be
    // "985", "2005", and the null would still be last.
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // The value still arrives as TEXT, which is why the alias was in scope to
    // be bound in the first place.
    expect(rows[0]!.bouwjaar).toBe("2005");
    db.query('DROP TABLE "sort_probe"');
  });

  it("sorts with NULLS LAST without erroring on any scalar column", () => {
    for (const column of columns.filter(
      (c) => c.kind === "scalar" || c.kind === "castText",
    )) {
      expect(() =>
        db.query(
          buildPageSql(
            TABLE,
            columns,
            null,
            { column: column.name, dir: "desc" },
            0,
            5,
          ),
        ),
      ).not.toThrow();
    }
  });

  it("writes parquet, CSV and JSON that read back as what they claim to be", () => {
    // `validateExportBytes` is the app's own read-back rule, run over bytes
    // the real writer produced: a VFS name that was never created reads back
    // as ONE garbage byte with no error, so "DuckDB wrote nothing" and "here
    // is your file" are only distinguishable by content.
    for (const format of ["parquet", "csv", "json"] as const) {
      const outFile = `${ATTRIBUTE_BASE}.${format}`;
      db.query(
        buildAttributeExportSql({
          table: TABLE,
          columns,
          where: null,
          format,
          outFile,
          rootTypes: ["Building"],
        }),
      );
      const bytes = db.readFile(outFile);
      const readback = validateExportBytes(outFile, format, bytes);
      expect(readback.ok).toBe(true);
      // Unreachable — the assertion above throws — but it is what narrows the
      // outcome to its `bytes` for the format checks below.
      if (!readback.ok) continue;

      if (format === "parquet") {
        expect(Array.from(readback.bytes.slice(0, 4))).toEqual([
          0x50, 0x41, 0x52, 0x31,
        ]);
      }
      if (format === "csv") {
        const text = new TextDecoder().decode(readback.bytes);
        const lines = text.trimEnd().split("\n");
        // HEADER is written because we ask for it, and it names exactly the
        // columns `exportColumnNames` promises the dialog.
        expect(lines[0]).toBe(exportColumnNames(columns, "csv").join(","));
        // The type predicate is FEATURE-scoped: the BuildingPart follows its
        // Building into the file, so all three rows are here.
        expect(lines.length).toBe(4);
      }
      if (format === "json") {
        // `ARRAY true`, so this parses as one document rather than as JSONL.
        const parsed: unknown = JSON.parse(
          new TextDecoder().decode(readback.bytes),
        );
        expect(Array.isArray(parsed)).toBe(true);
        expect((parsed as unknown[]).length).toBe(3);
        // A nested column reaches a file as JSON TEXT for this format, so a
        // `parents` list arrives as a string rather than as an array.
        const first = (parsed as Record<string, unknown>[])[0]!;
        expect(Object.keys(first)).toContain("id");
        expect(Object.keys(first)).toContain("object_type");
      }
      db.dropFile(outFile);
    }
  });

  it("writes a CityParquet package through the extension's own writer", () => {
    const schema = EXPORT_BASE;
    const scratchSchema = `${EXPORT_BASE}_src`;
    const outDir = EXPORT_BASE;
    const sourceName = `${EXPORT_BASE}_src.city.json`;
    const modules = groupTypesByModule(["Building"]);
    expect(modules.map((m) => m.module)).toEqual(["building"]);

    db.query(`CREATE SCHEMA ${quoteIdent(scratchSchema)}`);
    db.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    db.register(sourceName, "two-buildings.city.json");

    // ONE read of the source, into a scratch table in a schema of its own —
    // `cityparquet_init` describes every table in the schema it is handed.
    db.query(
      buildCityParquetSourceSql({
        scratchSchema,
        reader: "read_cityjson",
        sourceFile: sourceName,
        table: TABLE,
        lodSuffix: "2_2",
        attributes: ["yearOfConstruction"],
        computedAttributes: [],
        where: null,
        sourceFeatureIds: null,
      }),
    );
    for (const { module, types } of modules) {
      db.query(
        buildCityParquetModuleSql({
          schema,
          module,
          scratchSchema,
          table: TABLE,
          moduleTypes: types,
        }),
      );
    }
    expect(
      db.query(
        `SELECT count(*) AS n FROM ${quoteIdent(schema)}.${quoteIdent("building")}`,
      )[0]!.n,
    ).toBe(3);

    // ITS OWN STATEMENT, never batched: `cityparquet_init` stamps the schema's
    // `__cityparquet` bookkeeping and a batched PRAGMA is not reliably applied
    // before the statement beside it runs.
    db.query(`PRAGMA cityparquet_init(${quoteLiteral(schema)})`);

    // The pragma RETURNS NO ROWS and MATERIALISES `cityparquet_validation`.
    // If a future build made it return its findings instead, every export
    // would silently report "no warnings".
    expect(
      db.query(`PRAGMA cityparquet_validate(${quoteLiteral(schema)})`),
    ).toEqual([]);
    const findings = db.query(
      'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1 ORDER BY 1',
    );
    expect(Array.isArray(findings)).toBe(true);

    const written = db.query(
      `SELECT * FROM cityparquet_write(${quoteLiteral(schema)}, ${quoteLiteral(outDir)}, crs => ${quoteLiteral("EPSG:7415")})`,
    );
    // The write's own result rows are the ONLY list of the files it produced —
    // globbing cannot tell a written file from an imaginary one, because a
    // name that was never created still resolves.
    const names = written.map((row) => {
      for (const value of Object.values(row)) {
        if (typeof value === "string" && value !== "") {
          return value.startsWith(`${outDir}/`)
            ? value.slice(outDir.length + 1)
            : value;
        }
      }
      return null;
    });
    expect(names).toEqual(["building.parquet", "metadata.json"]);

    for (const name of names) {
      const path = `${outDir}/${name!}`;
      const bytes = db.readFile(path);
      const format = name!.endsWith(".parquet") ? "parquet" : "json";
      const readback = validateExportBytes(path, format, bytes);
      expect(readback.ok).toBe(true);
      if (!readback.ok) continue;
      if (format === "parquet") {
        expect(Array.from(readback.bytes.slice(0, 4))).toEqual([
          0x50, 0x41, 0x52, 0x31,
        ]);
      } else {
        const metadata = JSON.parse(
          new TextDecoder().decode(readback.bytes),
        ) as { assets?: Record<string, unknown> };
        expect(Object.keys(metadata.assets ?? {})).toContain(
          "building.parquet",
        );
      }
    }

    // NON-VACUOUS: the files are there to be found before the cleanup runs.
    expect(db.query("SELECT file FROM glob('exp_*')").length).toBeGreaterThan(
      0,
    );

    db.query("DROP TABLE IF EXISTS cityparquet_validation");
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(scratchSchema)} CASCADE`);
    for (const name of names) db.dropFile(`${outDir}/${name!}`);
    db.dropFile(sourceName);
    // Nothing of this export is addressable any more — which is exactly what
    // the app's `finally` promises. (Under NODE_RUNTIME the bytes also exist as
    // real files, and `dropFile` clears the handle rather than unlinking them;
    // `afterAll` is what keeps the working tree clean. In the browser the VFS
    // entry IS the file, so the two coincide.)
    expect(db.query("SELECT file FROM glob('exp_*')")).toEqual([]);
  });

  it("cuts a DERIVED layer's package to its own features, PARTS included", () => {
    // §6, "What a derived layer is": the copy's table is reader-backed, and
    // "the reader re-reads the parent source filtered to those ids". The
    // filter is over feature ROOTS (`COALESCE("feature_id", "id")`), which is
    // what this case is for: `NL.IMBAG.Pand.0001` has a BuildingPart, so a
    // row-level `"id" IN (…)` would keep the Building and lose its geometry —
    // the failure no SQL-text assertion can see. The parent holds three rows
    // (two roots, one of them with a part); the copy names ONE root and must
    // come back with TWO rows and no trace of the sibling.
    const DERIVED_ROOT = "NL.IMBAG.Pand.0001";
    const SIBLING_ROOT = "NL.IMBAG.Pand.0002";
    const derivedTable = `${TABLE}_derived`;
    const scratchSchema = `${EXPORT_BASE}_cut`;
    const schema = `${EXPORT_BASE}_cutpkg`;
    const outDir = schema;
    const sourceName = `${EXPORT_BASE}_cut.city.json`;

    // The copy's table, exactly as `prepareDerivedCityLayer` builds it: a CTAS
    // from the PARENT's table cut by feature root, plus the run's own column
    // written into the copy.
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(derivedTable)} AS SELECT * FROM ${quoteIdent(TABLE)} WHERE COALESCE("feature_id", "id") IN (${quoteLiteral(DERIVED_ROOT)})`,
    );
    db.query(
      `ALTER TABLE ${quoteIdent(derivedTable)} ADD COLUMN IF NOT EXISTS "solid_volume_m3" DOUBLE`,
    );
    db.query(
      `UPDATE ${quoteIdent(derivedTable)} SET "solid_volume_m3" = 7.5 * length("id")`,
    );
    // The CTAS itself already proves the root rule on the parent's table: the
    // Building AND its part crossed, the sibling did not.
    expect(
      db
        .query(`SELECT "id" FROM ${quoteIdent(derivedTable)} ORDER BY "id"`)
        .map((r) => String(r.id)),
    ).toEqual([DERIVED_ROOT, `${DERIVED_ROOT}-part1`]);

    db.query(`CREATE SCHEMA ${quoteIdent(scratchSchema)}`);
    db.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    db.register(sourceName, "two-buildings.city.json");

    // The whole point of the task: ONE read of the PARENT's file, cut by the
    // copy's `sourceFeatureIds`, with the copy's computed column joined in.
    db.query(
      buildCityParquetSourceSql({
        scratchSchema,
        reader: "read_cityjson",
        sourceFile: sourceName,
        table: derivedTable,
        lodSuffix: "2_2",
        attributes: ["yearOfConstruction"],
        computedAttributes: ["solid_volume_m3"],
        where: null,
        sourceFeatureIds: [DERIVED_ROOT],
      }),
    );
    const scratch = db.query(
      `SELECT "id", "feature_id", "solid_volume_m3" FROM ${quoteIdent(scratchSchema)}."src" ORDER BY "id"`,
    );
    // The root AND its part, from the reader's own rows...
    expect(scratch.map((r) => String(r.id))).toEqual([
      DERIVED_ROOT,
      `${DERIVED_ROOT}-part1`,
    ]);
    // ...the sibling nowhere...
    expect(scratch.map((r) => String(r.id))).not.toContain(SIBLING_ROOT);
    // ...and the copy's OWN values on every row of the feature.
    for (const row of scratch) {
      expect(row.solid_volume_m3).toBe(7.5 * String(row.id).length);
    }

    // And the WRITER keeps both: a package of the copy is a package of two
    // rows, not of the parent's three.
    db.query(
      buildCityParquetModuleSql({
        schema,
        module: "building",
        scratchSchema,
        table: derivedTable,
        moduleTypes: ["Building"],
      }),
    );
    db.query(`PRAGMA cityparquet_init(${quoteLiteral(schema)})`);
    expect(
      db.query(
        `SELECT * FROM cityparquet_write(${quoteLiteral(schema)}, ${quoteLiteral(outDir)}, crs => ${quoteLiteral("EPSG:7415")})`,
      ).length,
    ).toBeGreaterThan(0);
    const parquet = `${outDir}/building.parquet`;
    expect(
      db
        .query(
          `SELECT "id", "solid_volume_m3" FROM read_parquet(${quoteLiteral(parquet)}) ORDER BY "id"`,
        )
        .map((r) => ({ id: String(r.id), v: r.solid_volume_m3 })),
    ).toEqual(scratch.map((r) => ({ id: String(r.id), v: r.solid_volume_m3 })));

    db.query("DROP TABLE IF EXISTS cityparquet_validation");
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(scratchSchema)} CASCADE`);
    db.query(`DROP TABLE IF EXISTS ${quoteIdent(derivedTable)}`);
    db.dropFile(parquet);
    db.dropFile(`${outDir}/metadata.json`);
    db.dropFile(sourceName);
  });

  it("joins a computed column into the CityParquet source read", () => {
    // Spec §8: "computed columns are included … in CityParquet as attributes".
    // They exist on the LAYER's table only, so the one read of the source
    // picks them up by object id — every row of a feature carrying its own
    // value. What this proves against the real engine is that the join and the
    // feature-scope predicate coexist: `id` comes through `USING` and
    // `feature_id` exists on the reader's side alone, so neither is ambiguous.
    const layerTable = `${TABLE}_computed`;
    const scratchSchema = `${EXPORT_BASE}_join`;
    const sourceName = `${EXPORT_BASE}_join.city.json`;
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(layerTable)} AS SELECT * FROM ${quoteIdent(TABLE)}`,
    );
    db.query(
      `ALTER TABLE ${quoteIdent(layerTable)} ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE`,
    );
    db.query(
      `UPDATE ${quoteIdent(layerTable)} SET "extent_height_m" = 12.5 * length("id")`,
    );
    db.query(`CREATE SCHEMA ${quoteIdent(scratchSchema)}`);
    db.register(sourceName, "two-buildings.city.json");

    db.query(
      buildCityParquetSourceSql({
        scratchSchema,
        reader: "read_cityjson",
        sourceFile: sourceName,
        table: layerTable,
        lodSuffix: "2_2",
        attributes: ["yearOfConstruction"],
        computedAttributes: ["extent_height_m"],
        where: `"id" IS NOT NULL`,
        sourceFeatureIds: null,
      }),
    );
    const rows = db.query(
      `SELECT "id", "extent_height_m" FROM ${quoteIdent(scratchSchema)}."src" ORDER BY "id"`,
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.extent_height_m).toBe(12.5 * String(row.id).length);
    }

    // And the WRITER takes it: §8 promises the column "in CityParquet as
    // attributes", which is the written package, not the scratch table. The
    // whole sequence runs over the joined source and the column survives into
    // `building.parquet`.
    const schema = `${EXPORT_BASE}_joined`;
    const outDir = schema;
    db.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    db.query(
      buildCityParquetModuleSql({
        schema,
        module: "building",
        scratchSchema,
        table: layerTable,
        moduleTypes: ["Building"],
      }),
    );
    db.query(`PRAGMA cityparquet_init(${quoteLiteral(schema)})`);
    const written = db.query(
      `SELECT * FROM cityparquet_write(${quoteLiteral(schema)}, ${quoteLiteral(outDir)}, crs => ${quoteLiteral("EPSG:7415")})`,
    );
    expect(written.length).toBeGreaterThan(0);
    const parquet = `${outDir}/building.parquet`;
    expect(
      db.query(
        `SELECT "extent_height_m" FROM read_parquet(${quoteLiteral(parquet)}) ORDER BY "id"`,
      ),
    ).toEqual(rows.map((r) => ({ extent_height_m: r.extent_height_m })));

    db.query("DROP TABLE IF EXISTS cityparquet_validation");
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(scratchSchema)} CASCADE`);
    db.query(`DROP TABLE IF EXISTS ${quoteIdent(layerTable)}`);
    db.dropFile(parquet);
    db.dropFile(`${outDir}/metadata.json`);
    db.dropFile(sourceName);
  });
});
