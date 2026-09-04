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

  it("uses to_json for JSON, and names the format", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        format: "json",
        outFile: "exp_3.json",
      }),
    ).toContain("(FORMAT json)");
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
        lod: "2.2",
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
        lod: "1.2",
        attributes: [],
        where: null,
      }),
    ).toBe(
      'CREATE TABLE "exp_src_2"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod1_2", "geometry_properties_lod1_2" FROM read_cityjsonseq(\'exp_2_src.city.jsonl\')',
    );
  });

  it("always keeps the geometry_properties sidecar beside the geometry", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "e",
        reader: "read_cityjson",
        sourceFile: "s.json",
        table: "t",
        lod: "0",
        attributes: [],
        where: null,
      }),
    ).toContain('"geometry_lod0", "geometry_properties_lod0"');
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
