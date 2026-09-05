import { describe, it, expect } from "vitest";
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
  buildRootTypeWhere,
  exportColumnNames,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

describe("buildAttributeExportSql", () => {
  it("wraps the filtered SELECT in COPY … TO, with the feature scope", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: `"b3_h_dak_max" > 10`,
        format: "csv",
        outFile: "exp_1.csv",
        rootTypes: null,
      }),
    ).toBe(
      'COPY (SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)) TO \'exp_1.csv\' (FORMAT csv, HEADER)',
    );
  });

  it("keeps a nested column NATIVE for parquet, which can hold a list", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        format: "parquet",
        outFile: "exp_2.parquet",
        rootTypes: null,
      }),
    ).toBe(
      'COPY (SELECT "id", "feature_id", "object_type", "parents", "b3_h_dak_max" FROM "layer_1") TO \'exp_2.parquet\' (FORMAT parquet)',
    );
  });

  it("keeps a castText column NATIVE in every format — an export is not a grid", () => {
    // The grid casts a BIGINT to VARCHAR because JS cannot hold one; a Parquet
    // or JSON file can, and writing "1920" where 1920 belongs makes the export
    // useless for anything that would compare or sum it afterwards.
    for (const format of ["parquet", "csv", "json"] as const) {
      const sql = buildAttributeExportSql({
        table: "layer_1",
        columns: [
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "bouwjaar", type: "BIGINT", kind: "castText" },
        ],
        where: null,
        format,
        outFile: `x.${format}`,
        rootTypes: null,
      });
      expect(sql).toContain('SELECT "id", "bouwjaar" FROM "layer_1"');
      expect(sql).not.toContain("::VARCHAR");
    }
  });

  it("uses to_json for JSON, and names the format", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        format: "json",
        outFile: "exp_3.json",
        rootTypes: null,
      }),
    ).toContain("(FORMAT json, ARRAY true)");
  });

  it("ANDs the root-type predicate onto the feature scope", () => {
    // The type selection is the SAME predicate the CityParquet module tables
    // are cut with — it was simply ignored here, so a CSV of "Buildings only"
    // came back holding the vegetation too.
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
        where: `"b3_h_dak_max" > 10`,
        format: "csv",
        outFile: "x.csv",
        rootTypes: ["Building"],
      }),
    ).toBe(
      'COPY (SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10) AND COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\'))) TO \'x.csv\' (FORMAT csv, HEADER)',
    );
  });

  it("carries the root types with no filter of their own", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
        where: null,
        format: "json",
        outFile: "x.json",
        rootTypes: ["Building", "Bridge"],
      }),
    ).toBe(
      'COPY (SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\', \'Bridge\'))) TO \'x.json\' (FORMAT json, ARRAY true)',
    );
  });

  it("REFUSES an empty selection rather than reading it as `null`", () => {
    // `[]` and `null` are opposite intentions — "no type at all" against
    // "every type" — and treating the first as the second wrote the WHOLE
    // LAYER out for a caller that had asked for none of it. `IN ()` is not an
    // option either: it is a syntax error.
    expect(() =>
      buildAttributeExportSql({
        table: "layer_1",
        columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
        where: null,
        format: "csv",
        outFile: "x.csv",
        rootTypes: [],
      }),
    ).toThrow("Choose at least one object type to export.");
  });

  it("emits no predicate at all for `null` — every type, no self-join", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
        where: null,
        format: "csv",
        outFile: "x.csv",
        rootTypes: null,
      }),
    ).not.toContain("WHERE");
  });

  it("drops a blob column from every format", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: [
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "geometry_lod2_2", type: "BLOB", kind: "blob" },
        ],
        where: null,
        format: "csv",
        outFile: "x.csv",
        rootTypes: null,
      }),
    ).toBe(
      'COPY (SELECT "id" FROM "layer_1") TO \'x.csv\' (FORMAT csv, HEADER)',
    );
  });
});

describe("buildCityParquetSourceSql", () => {
  it("reads the source ONCE into a scratch schema, with the feature scope", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "exp_src_1",
        reader: "read_cityjson",
        sourceFile: "exp_1_src.city.json",
        table: "layer_1",
        lodSuffix: "2_2",
        attributes: ["b3_h_dak_max", "bouwjaar"],
        where: `"b3_h_dak_max" > 10`,
      }),
    ).toBe(
      'CREATE TABLE "exp_src_1"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod2_2", "geometry_properties_lod2_2", "b3_h_dak_max", "bouwjaar" FROM read_cityjson(\'exp_1_src.city.json\') WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("omits the WHERE entirely when the whole layer is exported", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "exp_src_2",
        reader: "read_cityjsonseq",
        sourceFile: "exp_2_src.city.jsonl",
        table: "layer_3",
        lodSuffix: "1_2",
        attributes: [],
        where: null,
      }),
    ).toBe(
      'CREATE TABLE "exp_src_2"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod1_2", "geometry_properties_lod1_2" FROM read_cityjsonseq(\'exp_2_src.city.jsonl\')',
    );
  });

  it("uses the suffix VERBATIM — the reader spells LoD 0 as lod0_0 here", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "e",
        reader: "read_cityjson",
        sourceFile: "s.json",
        table: "t",
        lodSuffix: "0_0",
        attributes: [],
        where: null,
      }),
    ).toContain('"geometry_lod0_0", "geometry_properties_lod0_0"');
  });

  it("names every column ONCE, whatever the attribute list repeats", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "e",
        reader: "read_cityjson",
        sourceFile: "s.json",
        table: "t",
        lodSuffix: "2_2",
        attributes: [
          "id",
          "parents",
          "geometry_lod2_2",
          "bouwjaar",
          "bouwjaar",
        ],
        where: null,
      }),
    ).toBe(
      'CREATE TABLE "e"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod2_2", "geometry_properties_lod2_2", "bouwjaar" FROM read_cityjson(\'s.json\')',
    );
  });
});

describe("buildCityParquetModuleSql", () => {
  it("cuts a module table from the scratch table by ROOT type", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "exp_1",
        module: "building",
        scratchSchema: "exp_src_1",
        table: "layer_1",
        moduleTypes: ["Building"],
      }),
    ).toBe(
      'CREATE TABLE "exp_1"."building" AS SELECT * FROM "exp_src_1"."src" WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\'))',
    );
  });

  it("lists every type of the module", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "exp_2",
        module: "vegetation",
        scratchSchema: "exp_src_2",
        table: "layer_3",
        moduleTypes: ["PlantCover", "SolitaryVegetationObject"],
      }),
    ).toBe(
      'CREATE TABLE "exp_2"."vegetation" AS SELECT * FROM "exp_src_2"."src" WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_3" WHERE "parents" IS NULL AND "object_type" IN (\'PlantCover\', \'SolitaryVegetationObject\'))',
    );
  });

  it("emits WHERE FALSE for no types, never an empty IN list", () => {
    // `IN ()` is a syntax error, so an empty module would take the whole
    // export down; an empty table is the honest answer to "no types".
    expect(
      buildCityParquetModuleSql({
        schema: "e",
        module: "generics",
        scratchSchema: "es",
        table: "t",
        moduleTypes: [],
      }),
    ).toBe(
      'CREATE TABLE "e"."generics" AS SELECT * FROM "es"."src" WHERE FALSE',
    );
  });

  it("escapes a quote in a type name rather than breaking out of the literal", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "e",
        module: "generics",
        scratchSchema: "es",
        table: "t",
        moduleTypes: ["O'dd"],
      }),
    ).toContain(`IN ('O''dd')`);
  });
});

describe("exportColumnNames", () => {
  it("names exactly the columns the projection keeps, in order", () => {
    expect(exportColumnNames(COLUMNS, "csv")).toEqual([
      "id",
      "feature_id",
      "object_type",
      "parents",
      "b3_h_dak_max",
    ]);
  });

  it("omits a blob, which no format writes", () => {
    expect(
      exportColumnNames(
        [
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "geometry_lod2_2", type: "BLOB", kind: "blob" },
        ],
        "csv",
      ),
    ).toEqual(["id"]);
  });
});

describe("buildRootTypeWhere", () => {
  it("is the SAME predicate both export routes use", () => {
    const predicate = buildRootTypeWhere("layer_1", ["Building"]);
    expect(predicate).toBe(
      'COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\'))',
    );
    // The module SQL is built from it, so the two cannot drift apart.
    expect(
      buildCityParquetModuleSql({
        schema: "exp_1",
        module: "building",
        scratchSchema: "exp_1_src",
        table: "layer_1",
        moduleTypes: ["Building"],
      }),
    ).toContain(predicate);
  });
});
