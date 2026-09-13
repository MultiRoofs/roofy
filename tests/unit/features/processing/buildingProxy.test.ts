/**
 * §7.5's "Building geometry" radio: which proxies a table can offer, which one
 * it defaults to, and the exact SQL each produces.
 *
 * Exact strings, because the statement lands verbatim in §6.4's log and a
 * planner reruns it by hand — and because the guards (the NULL branch, the
 * FILTER, the GROUP BY, the `ST_Force2D` wrap) are the whole correctness
 * argument.
 */
import { describe, expect, it } from "vitest";
import {
  buildFeatureProxySql,
  buildProxySql,
  defaultProxy,
  footprintAvailable,
  lodZeroLabel,
  proxyDistanceNote,
  proxyLogLabel,
  proxyOptions,
} from "../../../../src/features/processing/buildingProxy";
import type { LayerTable } from "../../../../src/insights/layerTables";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    columns: [],
    lods: [
      { label: "0", suffix: "0" },
      { label: "2.2", suffix: "2_2" },
    ],
    rowCount: 3,
    ...over,
  } as LayerTable;
}

describe("proxyOptions", () => {
  it("offers all three on a reader-backed layer with an LoD 0 column", () => {
    expect(proxyOptions(table())).toEqual([
      {
        key: "footprint",
        label: "Footprint (LoD 0)",
        available: true,
        note: null,
      },
      {
        key: "rectangle",
        label: "Extent rectangle",
        available: true,
        note: null,
      },
      { key: "centre", label: "Extent centre", available: true, note: null },
    ]);
  });

  it("disables the footprint with §7.5's own sentence when there is no LoD 0", () => {
    const [footprint] = proxyOptions(
      table({ lods: [{ label: "2.2", suffix: "2_2" }] }),
    );
    expect(footprint).toEqual({
      key: "footprint",
      label: "Footprint (LoD 0)",
      available: false,
      note: "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
    });
  });

  it("disables the footprint on a layer with no reader, LoD 0 or not", () => {
    // CityGML, CityParquet and a streaming layer: the LoD 0 geometry exists in
    // the model but nothing can re-read it as WKB.
    expect(proxyOptions(table({ reader: null }))[0]?.available).toBe(false);
  });

  it("always offers the two bbox proxies — every layer kind has the struct", () => {
    const options = proxyOptions(table({ reader: null, lods: [] }));
    expect(options.filter((o) => o.available).map((o) => o.key)).toEqual([
      "rectangle",
      "centre",
    ]);
  });
});

describe("footprintAvailable", () => {
  it("is the ONE predicate the form, the default and the options share", () => {
    // Both halves are required: an LoD 0 column in `lods` AND a reader to
    // re-read the WKB from, because the browsing table holds no geometry.
    expect(footprintAvailable(table())).toBe(true);
    expect(footprintAvailable(table({ reader: null }))).toBe(false);
    expect(
      footprintAvailable(table({ lods: [{ label: "1.2", suffix: "1_2" }] })),
    ).toBe(false);
    expect(footprintAvailable(table({ reader: null, lods: [] }))).toBe(false);
  });
});

describe("defaultProxy", () => {
  it("is the footprint when it is available (§7.5)", () => {
    expect(defaultProxy(table())).toBe("footprint");
  });

  it("falls back to the CENTRE, not the rectangle", () => {
    expect(defaultProxy(table({ reader: null }))).toBe("centre");
  });
});

describe("lodZeroLabel", () => {
  it("returns the file's OWN spelling of LoD 0", () => {
    expect(
      lodZeroLabel(table({ lods: [{ label: "0.0", suffix: "0_0" }] })),
    ).toBe("0.0");
    expect(lodZeroLabel(table({ lods: [{ label: "0", suffix: "0" }] }))).toBe(
      "0",
    );
  });

  it("is null when the file has no LoD 0 rung", () => {
    expect(
      lodZeroLabel(table({ lods: [{ label: "1.2", suffix: "1_2" }] })),
    ).toBeNull();
  });
});

describe("buildProxySql — one row per TABLE ROW", () => {
  it("reads the footprint WKB from the reader, guarded against NULL and flattened", () => {
    expect(
      buildProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('layer_1_run_7.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: null,
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "geometry_lod0" IS NULL THEN NULL ELSE ST_Force2D(ST_GeomFromWKB("geometry_lod0")) END AS g ' +
        "FROM read_cityjson('layer_1_run_7.city.json', lod => '0')",
    );
  });

  it("restricts the READER relation to the frozen ids, like the table one", () => {
    // Without this a Selected run reads every building in the file and the
    // cross-layer counts silently include buildings outside the scope.
    expect(
      buildProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('layer_1_run_7.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: ["b1", "b1p"],
      }),
    ).toContain(
      "FROM read_cityjson('layer_1_run_7.city.json', lod => '0') " +
        "WHERE \"id\" IN ('b1', 'b1p')",
    );
  });

  it("refuses to build a footprint without a reader and a column", () => {
    expect(() =>
      buildProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: null,
      }),
    ).toThrow(/reader/);
  });

  it("builds the rectangle and the centre from the table's bbox struct", () => {
    // No `ST_Force2D` on these two: `ST_MakeEnvelope` and `ST_Point` take
    // DOUBLEs and return 2-D geometry already.
    expect(
      buildProxySql({
        proxy: "rectangle",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["b1"],
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ' +
        'ST_MakeEnvelope("bbox"."xmin", "bbox"."ymin", "bbox"."xmax", "bbox"."ymax") END AS g ' +
        'FROM "layer_1" WHERE "id" IN (\'b1\')',
    );
    expect(
      buildProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: null,
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ' +
        'ST_Point(("bbox"."xmin" + "bbox"."xmax") / 2, ("bbox"."ymin" + "bbox"."ymax") / 2) END AS g ' +
        'FROM "layer_1"',
    );
  });

  it("quotes an id with a quote in it", () => {
    expect(
      buildProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["o'x"],
      }),
    ).toContain("WHERE \"id\" IN ('o''x')");
  });
});

describe("buildFeatureProxySql — one row per FEATURE", () => {
  it("unions the PART rows' footprints, falling back to the root's (§7)", () => {
    // §7's contributor rule, in SQL: where any part has an LoD 0 footprint the
    // parts ARE the contributors and the root's own polygon is ignored.
    //
    // The outer `ST_IsEmpty` CASE is the engine's doing: `ST_Union_Agg` over an
    // empty filtered set returns an EMPTY GEOMETRY rather than NULL (pinned in
    // `crossLayer.test.ts`), and §6.2 needs "no proxy" to be NULL.
    expect(
      buildFeatureProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('x.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: null,
      }),
    ).toBe(
      'SELECT "f", CASE WHEN ST_IsEmpty("u") THEN NULL ELSE "u" END AS g FROM (' +
        'SELECT "f", ST_Union_Agg("g") FILTER (WHERE "g" IS NOT NULL AND ("id" <> "f") = "parts") AS "u" ' +
        'FROM (SELECT *, COALESCE(BOOL_OR("g" IS NOT NULL AND "id" <> "f") ' +
        'OVER (PARTITION BY "f"), FALSE) AS "parts" FROM (' +
        buildProxySql({
          proxy: "footprint",
          table: "layer_1",
          from: "read_cityjson('x.city.json', lod => '0')",
          geometryColumn: "geometry_lod0",
          ids: null,
        }) +
        ')) GROUP BY "f")',
    );
  });

  it("carries the frozen ids into the footprint relation", () => {
    // The scope is applied ONCE, in the inner per-row relation — a building
    // outside the scope must not reach the union, or §7.6's per-area counts
    // include it with nothing in the output to show for it.
    expect(
      buildFeatureProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('x.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: ["b1", "b1p"],
      }),
    ).toContain("WHERE \"id\" IN ('b1', 'b1p')");
  });

  it("aggregates the BBOX NUMBERS for the two extent proxies, not the shapes", () => {
    // The union of two rectangles is not a rectangle. §7's combined extent is
    // the combined bbox, so the MIN/MAX happen before the geometry is built.
    expect(
      buildFeatureProxySql({
        proxy: "rectangle",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: null,
      }),
    ).toBe(
      'SELECT COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ' +
        'ST_MakeEnvelope(MIN("bbox"."xmin"), MIN("bbox"."ymin"), MAX("bbox"."xmax"), MAX("bbox"."ymax")) END AS g ' +
        'FROM "layer_1" GROUP BY 1',
    );
    expect(
      buildFeatureProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["b1", "b1p"],
      }),
    ).toBe(
      'SELECT COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ' +
        'ST_Point((MIN("bbox"."xmin") + MAX("bbox"."xmax")) / 2, ' +
        '(MIN("bbox"."ymin") + MAX("bbox"."ymax")) / 2) END AS g ' +
        "FROM \"layer_1\" WHERE \"id\" IN ('b1', 'b1p') GROUP BY 1",
    );
  });
});

describe("the log's words", () => {
  it("has ONE producer for the proxy's name (§6.4)", () => {
    expect(proxyLogLabel("footprint")).toBe("Footprint (LoD 0)");
    expect(proxyLogLabel("rectangle")).toBe("Extent rectangle");
    expect(proxyLogLabel("centre")).toBe("Extent centre");
  });

  it("collapses §7.7's slash list to the proxy that was used", () => {
    expect(proxyDistanceNote("footprint")).toBe(
      "2D distance to the building footprint",
    );
    expect(proxyDistanceNote("rectangle")).toBe(
      "2D distance to the building extent",
    );
    expect(proxyDistanceNote("centre")).toBe(
      "2D distance to the building centre",
    );
  });
});
