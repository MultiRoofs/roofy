import { describe, it, expect } from "vitest";
import {
  compileFilter,
  escapeLikeNeedle,
  quoteIdent,
  quoteLiteral,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";
import type { FilterGroup } from "../../../src/features/query/types";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
  { name: "oorspronkelijkbouwjaar", type: "BIGINT", kind: "castText" },
  { name: "geconstateerd", type: "BOOLEAN", kind: "scalar" },
  { name: "geometry_lod2_2", type: "BLOB", kind: "blob" },
];

function group(
  conditions: FilterGroup["conditions"],
  logic: "AND" | "OR" = "AND",
): FilterGroup {
  return { logic, conditions };
}

describe("quoteIdent", () => {
  it("wraps in double quotes and doubles an embedded quote", () => {
    expect(quoteIdent("id")).toBe('"id"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe("quoteLiteral", () => {
  it("wraps a string in single quotes, doubling embedded ones", () => {
    expect(quoteLiteral("Building")).toBe("'Building'");
    expect(quoteLiteral("O'Hara")).toBe("'O''Hara'");
  });

  it("renders a finite number bare and a boolean as a keyword", () => {
    expect(quoteLiteral(10)).toBe("10");
    expect(quoteLiteral(-2.5)).toBe("-2.5");
    expect(quoteLiteral(true)).toBe("TRUE");
    expect(quoteLiteral(false)).toBe("FALSE");
  });

  it("throws on a non-finite number", () => {
    expect(() => quoteLiteral(Number.NaN)).toThrow();
    expect(() => quoteLiteral(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("escapeLikeNeedle", () => {
  it("escapes the wildcards and the escape character itself", () => {
    expect(escapeLikeNeedle("100%")).toBe("100\\%");
    expect(escapeLikeNeedle("a_b")).toBe("a\\_b");
    expect(escapeLikeNeedle("c:\\x")).toBe("c:\\\\x");
  });
});

describe("compileFilter", () => {
  it("is null for an empty group", () => {
    expect(compileFilter(group([]), COLUMNS)).toEqual({
      ok: true,
      where: null,
    });
  });

  it("compiles an equality on a text column", () => {
    expect(
      compileFilter(
        group([
          { id: "c1", column: "object_type", op: "=", value: "Building" },
        ]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"object_type" = 'Building'` });
  });

  it("compiles every comparison operator", () => {
    for (const op of ["=", "!=", "<", "<=", ">", ">="] as const) {
      expect(
        compileFilter(
          group([{ id: "c", column: "b3_h_dak_max", op, value: 10 }]),
          COLUMNS,
        ),
      ).toEqual({ ok: true, where: `"b3_h_dak_max" ${op} 10` });
    }
  });

  it("compiles a boolean literal", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: true }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"geconstateerd" = TRUE` });
  });

  it("compiles a castText column against a string literal and lets DuckDB cast", () => {
    expect(
      compileFilter(
        group([
          {
            id: "c",
            column: "oorspronkelijkbouwjaar",
            op: ">=",
            value: "1900",
          },
        ]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"oorspronkelijkbouwjaar" >= '1900'` });
  });

  it("compiles the LIKE family with an ESCAPE clause and an escaped needle", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "contains", value: "50%_a" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: true,
      where: `"id" LIKE '%50\\%\\_a%' ESCAPE '\\'`,
    });
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "startsWith", value: "NL." }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"id" LIKE 'NL.%' ESCAPE '\\'` });
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "endsWith", value: "-0" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"id" LIKE '%-0' ESCAPE '\\'` });
  });

  it("refuses an EMPTY needle rather than compiling LIKE '%%'", () => {
    // A blank "contains" box is a row the user has not finished, not a request
    // for every object in the layer — and `LIKE '%%'` is indistinguishable
    // from a filter that silently did not apply.
    for (const op of ["contains", "startsWith", "endsWith"] as const) {
      expect(
        compileFilter(
          group([{ id: "c", column: "id", op, value: "   " }]),
          COLUMNS,
        ),
      ).toEqual({
        ok: false,
        message: `"${op}" needs something to look for in "id".`,
      });
    }
  });

  it("compiles the null tests without a value", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "isNull", value: "" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"parents" IS NULL` });
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "isNotNull", value: "" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"parents" IS NOT NULL` });
  });

  it("compiles IN over a list", () => {
    expect(
      compileFilter(
        group([
          {
            id: "c",
            column: "object_type",
            op: "in",
            value: ["Building", "BuildingPart"],
          },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: true,
      where: `"object_type" IN ('Building', 'BuildingPart')`,
    });
  });

  it("coerces every IN element the way a comparison would", () => {
    // The list comes from the same text inputs as a single value, so a
    // numeric column's list must not become IN ('10', '20.5') — DuckDB would
    // cast it row by row, and a genuinely bad element would never be named.
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: "in", value: ["10", "20.5"] },
        ]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"b3_h_dak_max" IN (10, 20.5)` });
  });

  it("names the element that cannot be coerced", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: "in", value: ["10", "abc"] },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"b3_h_dak_max" needs a number; "abc" is not one.',
    });
  });

  it("refuses an EMPTY element of an IN list", () => {
    expect(
      compileFilter(
        group([
          {
            id: "c",
            column: "object_type",
            op: "in",
            value: ["Building", " "],
          },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"in" cannot take an empty value for "object_type".',
    });
  });

  it("joins with the group's logic", () => {
    const conditions = [
      { id: "c1", column: "object_type", op: "=" as const, value: "Building" },
      { id: "c2", column: "b3_h_dak_max", op: ">" as const, value: 10 },
    ];
    expect(compileFilter(group(conditions, "AND"), COLUMNS)).toEqual({
      ok: true,
      where: `"object_type" = 'Building' AND "b3_h_dak_max" > 10`,
    });
    expect(compileFilter(group(conditions, "OR"), COLUMNS)).toEqual({
      ok: true,
      where: `"object_type" = 'Building' OR "b3_h_dak_max" > 10`,
    });
  });

  it("rejects an unknown column with a sentence", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "nope", op: "=", value: "x" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: 'This layer has no column called "nope".',
    });
  });

  it("rejects a nested column outright", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "=", value: "B1" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message:
        '"parents" holds VARCHAR[] values, which cannot be compared — only IS NULL / IS NOT NULL work on it.',
    });
  });

  it("rejects a blob column outright", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geometry_lod2_2", op: "=", value: "x" }]),
        COLUMNS,
      ).ok,
    ).toBe(false);
  });

  it("rejects a text operator on a non-text column", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: "contains", value: "1" },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"contains" needs a text column; "b3_h_dak_max" is DOUBLE.',
    });
  });

  it("rejects IN without a list", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "object_type", op: "in", value: "Building" },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message:
        '"in" needs a list of values; "object_type" was given one value.',
    });
  });

  it("rejects an empty IN list", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "object_type", op: "in", value: [] }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"in" needs at least one value for "object_type".',
    });
  });

  it("rejects a non-finite number rather than emitting NaN into SQL", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: ">", value: Number.NaN },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"b3_h_dak_max" needs a number; "NaN" is not one.',
    });
  });

  it("coerces a RAW STRING against a numeric column", () => {
    // The bar keeps what the user typed — "1." on the way to "1.5" would be
    // eaten by a parse-as-you-type input — so the coercion happens here.
    expect(
      compileFilter(
        group([{ id: "c", column: "b3_h_dak_max", op: ">", value: "1.5" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"b3_h_dak_max" > 1.5` });
  });

  it("refuses text against a numeric column, with a sentence", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "b3_h_dak_max", op: ">", value: "abc" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"b3_h_dak_max" needs a number; "abc" is not one.',
    });
  });

  it("refuses an EMPTY value rather than emitting \"col\" > ''", () => {
    for (const column of ["b3_h_dak_max", "id"]) {
      expect(
        compileFilter(
          group([{ id: "c", column, op: ">", value: "   " }]),
          COLUMNS,
        ),
      ).toEqual({
        ok: false,
        message: `"${column}" needs a value for this comparison.`,
      });
    }
  });

  it("reads true/false text against a BOOLEAN column", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: "true" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"geconstateerd" = TRUE` });
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: "ja" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"geconstateerd" is a true/false column; "ja" is neither.',
    });
  });
});
