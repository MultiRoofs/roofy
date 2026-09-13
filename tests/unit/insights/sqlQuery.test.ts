import { describe, it, expect } from "vitest";
import {
  buildCountSql,
  buildMedianSql,
  buildMostFrequentSql,
  buildFeatureIdsSql,
  buildFeatureRowsSql,
  buildFeatureScopeWhere,
  buildPageSql,
  buildRootTypesSql,
  gridColumns,
  projectColumn,
} from "../../../src/insights/sql";
import type { ColumnInfo } from "../../../src/insights/columnKind";

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
      'SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE "object_type" = \'Building\' ORDER BY "layer_1"."b3_h_dak_max" DESC NULLS LAST LIMIT 500 OFFSET 1000',
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
    ).toContain('ORDER BY "layer_1"."id" ASC NULLS LAST');
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

  it("QUALIFIES the sort column, so a castText alias cannot capture it", () => {
    // `"bouwjaar"::VARCHAR AS "bouwjaar"` puts a VARCHAR alias in scope under
    // the column's own name, and an unqualified ORDER BY binds the ALIAS —
    // sorting 1920 next to 199 lexicographically. A qualified reference can
    // only ever mean the table's column.
    expect(
      buildPageSql(
        "layer_1",
        [
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "bouwjaar", type: "BIGINT", kind: "castText" },
        ],
        null,
        { column: "bouwjaar", dir: "asc" },
        0,
        100,
      ),
    ).toBe(
      'SELECT "id", "bouwjaar"::VARCHAR AS "bouwjaar" FROM "layer_1" ORDER BY "layer_1"."bouwjaar" ASC NULLS LAST LIMIT 100 OFFSET 0',
    );
  });

  it("clamps a page or page size SQL could not take", () => {
    const paging = (page: number, pageSize: number) =>
      buildPageSql("layer_1", COLUMNS, null, null, page, pageSize);
    expect(paging(Number.NaN, Number.NaN)).toContain("LIMIT 100 OFFSET 0");
    expect(paging(-3, -3)).toContain("LIMIT 100 OFFSET 0");
    expect(paging(2.5, 2.5)).toContain("LIMIT 2 OFFSET 4");
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

describe("buildMedianSql", () => {
  it("casts to DOUBLE, and takes the median over the ROOT rows only", () => {
    // The M2 DECIMAL trap. `median()` over a DECIMAL column answers with a
    // DECIMAL, which arrives in JS as an OBJECT — `typeof value === "number"`
    // in `RunFooter` is then false and §6.2's Style by result reports "All
    // values are empty" over a column full of numbers. Every computed column
    // this app writes is DOUBLE today, but a JOINED column (§7.5) copies the
    // source's own type, so the cast is the difference between a working
    // button and a silent one.
    //
    // Root rows only for the reason it always was: a run copies its value onto
    // the root AND its parts (§7.3), so a median over every row weights each
    // building by how many parts it happens to have modelled.
    expect(buildMedianSql("layer_1", "extent_height_m")).toBe(
      'SELECT median(CAST("extent_height_m" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    );
  });

  it("quotes a column whose name would otherwise end the identifier", () => {
    expect(buildMedianSql("layer_1", 'roof"area')).toBe(
      'SELECT median(CAST("roof""area" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    );
  });
});

describe("buildMostFrequentSql", () => {
  it("is the modal value over the feature ROOTS only", () => {
    // The same restriction as `buildMedianSql`, for the same reason: a run
    // writes its value onto the root AND onto every part, so a mode over every
    // row weights each building by how many parts it happens to have modelled.
    // On 3D BAG, where every Building has exactly one geometry-bearing part,
    // the unrestricted answer is not even a value from the data.
    expect(buildMostFrequentSql("layer_3", "zones_name")).toBe(
      'SELECT mode("zones_name") AS m FROM "layer_3" WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "zones_name" IS NOT NULL',
    );
  });

  it("quotes an identifier with a quote in it", () => {
    expect(buildMostFrequentSql('a"b', 'c"d')).toContain('FROM "a""b"');
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

describe("buildFeatureRowsSql", () => {
  it("projects the id beside its feature root, feature-scoped", () => {
    expect(buildFeatureRowsSql("layer_1", `"id" IN ('a-part')`)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "id" IN (\'a-part\'))',
    );
  });

  it("returns every row when there is no filter", () => {
    expect(buildFeatureRowsSql("layer_1", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"',
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
