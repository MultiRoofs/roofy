import { describe, it, expect } from "vitest";
import {
  buildCountSql,
  buildFeatureIdsSql,
  buildFeatureScopeWhere,
  buildPageSql,
  buildRootTypesSql,
  gridColumns,
  projectColumn,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

describe("projectColumn", () => {
  it("passes a scalar through", () => {
    expect(projectColumn({ name: "id", type: "VARCHAR", kind: "scalar" })).toBe(
      '"id"',
    );
  });

  it("casts a castText column to VARCHAR under its own name", () => {
    expect(
      projectColumn({ name: "bouwjaar", type: "BIGINT", kind: "castText" }),
    ).toBe('"bouwjaar"::VARCHAR AS "bouwjaar"');
  });

  it("wraps a nested column in to_json under its own name", () => {
    expect(
      projectColumn({ name: "parents", type: "VARCHAR[]", kind: "nested" }),
    ).toBe('to_json("parents") AS "parents"');
  });

  it("drops a blob", () => {
    expect(
      projectColumn({ name: "geometry_lod2_2", type: "BLOB", kind: "blob" }),
    ).toBeNull();
  });
});

describe("gridColumns", () => {
  it("keeps everything but the blobs, in order", () => {
    const withBlob = [
      ...COLUMNS,
      { name: "g", type: "BLOB", kind: "blob" as const },
    ];
    expect(gridColumns(withBlob).map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "parents",
      "b3_h_dak_max",
    ]);
  });
});

describe("buildPageSql", () => {
  it("builds the whole statement, exactly", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        `"object_type" = 'Building'`,
        { column: "b3_h_dak_max", dir: "desc" },
        2,
        500,
      ),
    ).toBe(
      'SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE "object_type" = \'Building\' ORDER BY "b3_h_dak_max" DESC NULLS LAST LIMIT 500 OFFSET 1000',
    );
  });

  it("omits the WHERE and the ORDER BY when there are none", () => {
    expect(buildPageSql("layer_1", COLUMNS, null, null, 0, 100)).toBe(
      'SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" LIMIT 100 OFFSET 0',
    );
  });

  it("sorts ascending with NULLS LAST too", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "id", dir: "asc" },
        0,
        100,
      ),
    ).toContain('ORDER BY "id" ASC NULLS LAST');
  });

  it("refuses to sort on a nested column, dropping the ORDER BY", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "parents", dir: "asc" },
        0,
        100,
      ),
    ).not.toContain("ORDER BY");
  });

  it("refuses to sort on a column the table does not have", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "gone", dir: "asc" },
        0,
        100,
      ),
    ).not.toContain("ORDER BY");
  });

  it("selects 1 when every column is a blob, so the page query still binds", () => {
    expect(
      buildPageSql(
        "layer_1",
        [{ name: "g", type: "BLOB", kind: "blob" }],
        null,
        null,
        0,
        10,
      ),
    ).toBe('SELECT 1 FROM "layer_1" LIMIT 10 OFFSET 0');
  });
});

describe("buildCountSql", () => {
  it("counts everything", () => {
    expect(buildCountSql("layer_1", null)).toBe(
      'SELECT COUNT(*) AS "n" FROM "layer_1"',
    );
  });

  it("counts the filtered rows", () => {
    expect(buildCountSql("layer_1", `"object_type" = 'Building'`)).toBe(
      'SELECT COUNT(*) AS "n" FROM "layer_1" WHERE "object_type" = \'Building\'',
    );
  });
});

describe("buildFeatureIdsSql", () => {
  it("expands matches to their whole feature, COALESCEd on both sides", () => {
    expect(buildFeatureIdsSql("layer_1", `"b3_h_dak_max" > 10`)).toBe(
      'SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("returns every id when there is no filter", () => {
    expect(buildFeatureIdsSql("layer_1", null)).toBe(
      'SELECT "id" FROM "layer_1"',
    );
  });
});

describe("buildFeatureScopeWhere", () => {
  it("is null for no filter", () => {
    expect(buildFeatureScopeWhere("layer_1", null)).toBeNull();
  });

  it("is the positive IN form", () => {
    expect(
      buildFeatureScopeWhere("layer_1", `"object_type" = 'Building'`),
    ).toBe(
      'COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "object_type" = \'Building\')',
    );
  });
});

describe("buildRootTypesSql", () => {
  it("lists the TOP-LEVEL object types — the rows with no parents", () => {
    expect(buildRootTypesSql("layer_1")).toBe(
      'SELECT DISTINCT "object_type" AS "value" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1',
    );
  });
});
