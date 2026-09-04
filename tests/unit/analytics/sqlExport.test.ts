import { describe, it, expect } from "vitest";
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
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
      }),
    ).toBe(
      'COPY (SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)) TO \'exp_1.csv\' (FORMAT csv)',
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
      }),
    ).toContain("(FORMAT json, ARRAY true)");
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
      }),
    ).toBe('COPY (SELECT "id" FROM "layer_1") TO \'x.csv\' (FORMAT csv)');
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
