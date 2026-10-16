import { describe, it, expect } from "vitest";
import {
  classifyColumnType,
  isDroppedColumn,
  isTextColumn,
  lodsFromColumnNames,
} from "../../../src/insights/columnKind";

describe("classifyColumnType", () => {
  it("calls a list, a struct and a map nested", () => {
    expect(classifyColumnType("VARCHAR[]")).toBe("nested");
    expect(classifyColumnType("STRUCT(xmin DOUBLE, ymin DOUBLE)")).toBe(
      "nested",
    );
    expect(classifyColumnType("MAP(VARCHAR, VARCHAR)")).toBe("nested");
    expect(classifyColumnType("STRUCT(a INTEGER)[]")).toBe("nested");
  });

  it("calls BLOB blob", () => {
    expect(classifyColumnType("BLOB")).toBe("blob");
  });

  it("calls the JS-safe scalars scalar", () => {
    for (const t of [
      "VARCHAR",
      "BOOLEAN",
      "DOUBLE",
      "FLOAT",
      "REAL",
      "INTEGER",
      "SMALLINT",
      "TINYINT",
      "UINTEGER",
      "USMALLINT",
      "UTINYINT",
    ]) {
      expect(classifyColumnType(t)).toBe("scalar");
    }
  });

  it("sends HUGEINT and DECIMAL to castText — Arrow hands them back as STRINGS", () => {
    // Not a nicety: an unguarded `toFixed` on one of these throws, and a
    // formatter that assumed a number would blank the whole column.
    expect(classifyColumnType("HUGEINT")).toBe("castText");
    expect(classifyColumnType("DECIMAL(38,10)")).toBe("castText");
  });

  it("calls everything else castText — the types JS cannot render faithfully", () => {
    for (const t of [
      "BIGINT",
      "HUGEINT",
      "DECIMAL(18,3)",
      "DATE",
      "TIMESTAMP",
      "TIMESTAMP WITH TIME ZONE",
      "TIME",
      "INTERVAL",
      "UUID",
    ]) {
      expect(classifyColumnType(t)).toBe("castText");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyColumnType("  varchar  ")).toBe("scalar");
    expect(classifyColumnType("varchar[]")).toBe("nested");
  });
});

describe("isTextColumn", () => {
  it("is true only for a VARCHAR scalar", () => {
    expect(isTextColumn({ name: "a", type: "VARCHAR", kind: "scalar" })).toBe(
      true,
    );
    expect(isTextColumn({ name: "a", type: "DOUBLE", kind: "scalar" })).toBe(
      false,
    );
    expect(isTextColumn({ name: "a", type: "VARCHAR[]", kind: "nested" })).toBe(
      false,
    );
  });
});

describe("isDroppedColumn", () => {
  it("drops geometry, its sidecar, materials and textures", () => {
    for (const n of [
      "geometry_lod2_2",
      "geometry_properties_lod2_2",
      "material_lod1_2",
      "texture_lod2_2",
      "material_lod2_2",
      "geometry_lod10_0",
      "geometry_lod0_0",
      "geometry_properties_lod1_3",
    ]) {
      expect(isDroppedColumn(n)).toBe(true);
    }
  });

  it("keeps a name off the extension's LoD suffix grammar: it is an attribute", () => {
    // `<prefix>_lod<major>_<minor>`, minor always present, canonical decimals.
    // The reader escapes only an attribute spelled that way, so every other
    // spelling reaches the table as the attribute it is.
    for (const n of [
      "geometry",
      "template",
      "material",
      "geometry_lod3",
      "geometry_lod02_2",
      "geometry_lod2_02",
      "texture_lod1",
    ]) {
      expect(isDroppedColumn(n)).toBe(false);
    }
  });

  it("keeps a user attribute that merely STARTS with a dropped word", () => {
    // A reader column of that family always carries the LoD suffix; these are
    // ordinary third-party attribute names, and hiding one would take it out
    // of the table, the filter builder and the export with nothing to show it.
    for (const n of [
      "material_roof",
      "geometry_source",
      "texture_quality",
      "geometry_lod_note",
    ]) {
      expect(isDroppedColumn(n)).toBe(false);
    }
  });

  it("keeps the identity, structural and attribute columns", () => {
    for (const n of [
      "id",
      "feature_id",
      "object_type",
      "parents",
      "children",
      "children_roles",
      "address",
      "bbox",
      "implicit_geometry",
      "other",
      "b3_h_dak_max",
    ]) {
      expect(isDroppedColumn(n)).toBe(false);
    }
  });
});

describe("LoD column maths", () => {
  it("reads the LoD ladder back off the geometry columns, sorted and deduped", () => {
    expect(
      lodsFromColumnNames([
        "id",
        "geometry_lod2_2",
        "geometry_properties_lod2_2",
        "geometry_lod1_2",
        "geometry_lod1_3",
      ]),
    ).toEqual([
      { label: "1.2", suffix: "1_2" },
      { label: "1.3", suffix: "1_3" },
      { label: "2.2", suffix: "2_2" },
    ]);
  });

  it("is empty for a table with no geometry columns", () => {
    expect(lodsFromColumnNames(["id", "object_type"])).toEqual([]);
  });

  it("reads only the extension's suffix grammar, so an attribute is no rung", () => {
    // `geometry_lod1`, `geometry_lod02_2` and `geometry_lod_note` are
    // attributes under the grammar the reader writes and escapes by.
    expect(
      lodsFromColumnNames([
        "geometry_lod0_0",
        "geometry_lod2_2",
        "geometry_lod1",
        "geometry_lod02_2",
        "geometry_lod_note",
        "geometry_properties_lod2_2",
      ]),
    ).toEqual([
      { label: "0.0", suffix: "0_0" },
      { label: "2.2", suffix: "2_2" },
    ]);
  });

  it("dedupes by suffix when a column repeats", () => {
    expect(lodsFromColumnNames(["geometry_lod2_2", "geometry_lod2_2"])).toEqual(
      [{ label: "2.2", suffix: "2_2" }],
    );
  });
});
