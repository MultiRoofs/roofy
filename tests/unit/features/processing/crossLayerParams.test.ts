/**
 * §7.5-§7.7's parameters: ONE answer to "what did the user ask for" and ONE to
 * "which columns will this write", shared by the form, the frozen request, the
 * log and the three executors.
 *
 * Pure: no store, no engine, no React.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateColumns,
  aggregateParams,
  aggregateRowErrors,
  crossLayerParamsError,
  distanceColumns,
  distanceParams,
  joinColumns,
  joinParams,
  numericColumnsOf,
  resolveCrossLayerParams,
  slugifyField,
  type CrossLayerContext,
} from "../../../../src/features/processing/crossLayerParams";
import type { LayerTable } from "../../../../src/insights/layerTables";
import type { ColumnType } from "../../../../src/insights/computedColumns";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
      { name: "roof_area_m2", type: "DOUBLE", kind: "scalar" },
      { name: "bouwjaar", type: "BIGINT", kind: "scalar" },
      { name: "status", type: "VARCHAR", kind: "scalar" },
      { name: "parents", type: "VARCHAR[]", kind: "list" },
    ],
    lods: [
      { label: "0", suffix: "0" },
      { label: "2.2", suffix: "2_2" },
    ],
    rowCount: 3,
    ...over,
  } as LayerTable;
}

// The shape `fieldTypes` takes INSIDE the frozen bag: a plain JSON object
// keyed by the RAW property name (Decisions item 6 (iii)). DECLARED FIRST:
// `ctx` reads it at module scope, and a `const` read before its own line is a
// TDZ throw, not a hoist.
const TYPES: Readonly<Record<string, ColumnType>> = {
  "Zone Name": "VARCHAR",
  noise: "DOUBLE",
  flood: "BOOLEAN",
};

const ctx: CrossLayerContext = {
  table: table(),
  sourcePropertyKeys: ["Zone Name", "noise", "flood"],
  sourcePropertyTypes: new Map(Object.entries(TYPES)),
  sourceHasFeatureIds: true,
  numericColumns: ["b3_h_dak_max", "roof_area_m2", "bouwjaar"],
};

/** The registry's own context, copied here: `normaliseParams` re-resolves an
 *  already-resolved bag with exactly this. Every case below that uses it is
 *  about the frozen request surviving that second pass. */
const BAG_ONLY: CrossLayerContext = {
  table: null,
  sourcePropertyKeys: [],
  sourcePropertyTypes: new Map(),
  sourceHasFeatureIds: true,
  numericColumns: [],
};

describe("slugifyField", () => {
  it("is lower snake case, and two names can collide (§6)", () => {
    expect(slugifyField("Zone Name")).toBe("zone_name");
    expect(slugifyField("zone_name")).toBe("zone_name");
    expect(slugifyField("  Noise (dB) ")).toBe("noise_db");
    expect(slugifyField("a--b__c")).toBe("a_b_c");
    expect(slugifyField("2023 zone")).toBe("2023_zone");
    expect(slugifyField("###")).toBe("field");
  });
});

describe("resolveCrossLayerParams", () => {
  it("fills §7.5's defaults: the table's proxy, intersects, every field, first", () => {
    expect(resolveCrossLayerParams("join-by-location", {}, ctx)).toEqual({
      proxy: "footprint",
      predicate: "intersects",
      fields: ["Zone Name", "noise", "flood"],
      tie: "first",
      writeMatchCount: false,
      fieldTypes: TYPES,
    });
  });

  it("falls back to the centre when the layer has no LoD 0 or no reader", () => {
    expect(
      resolveCrossLayerParams(
        "join-by-location",
        {},
        {
          ...ctx,
          table: table({ reader: null }),
        },
      ),
    ).toMatchObject({ proxy: "centre" });
  });

  it("replaces a proxy the CURRENT target cannot offer", () => {
    // The draft is kept per tool for the session, so a footprint chosen on
    // Delft must not survive a retarget to a CityGML layer.
    expect(
      resolveCrossLayerParams(
        "join-by-location",
        { proxy: "footprint" },
        {
          ...ctx,
          table: table({ lods: [] }),
        },
      ),
    ).toMatchObject({ proxy: "centre" });
  });

  it("keeps an explicit proxy when the context has no table", () => {
    // The registry's `normaliseParams` re-resolves with `BAG_ONLY`. Only a
    // TABLE can say a proxy is unavailable, so this pass must keep the
    // footprint the form resolved — otherwise the FROZEN request submits a
    // centre join and §6.4's log names a proxy that was never used.
    expect(
      resolveCrossLayerParams(
        "join-by-location",
        { proxy: "footprint" },
        BAG_ONLY,
      ),
    ).toMatchObject({ proxy: "footprint" });
    // With nothing in the bag either, the safe proxy is still the centre.
    expect(
      resolveCrossLayerParams("join-by-location", {}, BAG_ONLY),
    ).toMatchObject({ proxy: "centre" });
  });

  it("keeps an EMPTY field list empty — that is the state Run refuses", () => {
    expect(
      resolveCrossLayerParams("join-by-location", { fields: [] }, ctx),
    ).toMatchObject({ fields: [] });
  });

  it("drops a field the CURRENT source does not have", () => {
    expect(
      resolveCrossLayerParams(
        "join-by-location",
        { fields: ["noise", "gone"] },
        ctx,
      ),
    ).toMatchObject({ fields: ["noise"] });
  });

  it("forces the match count on for 'count only' (§7.5)", () => {
    expect(
      resolveCrossLayerParams("join-by-location", { tie: "countOnly" }, ctx),
    ).toMatchObject({ tie: "countOnly", writeMatchCount: true });
  });

  it("fills §7.7's defaults: 500 m, and the feature's own id when there is one", () => {
    expect(resolveCrossLayerParams("distance-to-nearest", {}, ctx)).toEqual({
      proxy: "footprint",
      maxDistanceM: 500,
      writeNearestId: true,
      nearestIdProperty: null,
    });
  });

  it("leaves the nearest-id checkbox OFF when the source has no feature id", () => {
    expect(
      resolveCrossLayerParams(
        "distance-to-nearest",
        {},
        {
          ...ctx,
          sourceHasFeatureIds: false,
        },
      ),
    ).toMatchObject({ writeNearestId: false, nearestIdProperty: null });
  });

  it("fills §7.6's default row: one count (§7.6)", () => {
    expect(resolveCrossLayerParams("aggregate-per-area", {}, ctx)).toEqual({
      proxy: "footprint",
      predicate: "intersects",
      rows: [{ op: "count", column: null }],
    });
  });

  it("defaults a numeric row's column to the source's first numeric one", () => {
    expect(
      resolveCrossLayerParams(
        "aggregate-per-area",
        { rows: [{ op: "sum" }] },
        ctx,
      ),
    ).toMatchObject({ rows: [{ op: "sum", column: "b3_h_dak_max" }] });
  });

  it("drops a row's column when the source no longer has it", () => {
    expect(
      resolveCrossLayerParams(
        "aggregate-per-area",
        { rows: [{ op: "sum", column: "gone" }] },
        ctx,
      ),
    ).toMatchObject({ rows: [{ op: "sum", column: "b3_h_dak_max" }] });
  });

  it("embeds the source's types as `fieldTypes`, for the chosen fields only", () => {
    // Decisions item 6 (iii): this is what makes the FROZEN bag enough for
    // `joinColumns(prefix, params)` and for `RunFooter`.
    expect(
      resolveCrossLayerParams(
        "join-by-location",
        { fields: ["noise", "flood"] },
        ctx,
      ),
    ).toMatchObject({ fieldTypes: { noise: "DOUBLE", flood: "BOOLEAN" } });
  });

  it("is idempotent, so freezing a resolved bag changes nothing", () => {
    const once = resolveCrossLayerParams("join-by-location", {}, ctx);
    expect(resolveCrossLayerParams("join-by-location", once, ctx)).toEqual(
      once,
    );
  });

  // The three cases that keep ruling (iii) alive. `ToolView.run()` resolves
  // with the real source, then calls the registry's `normaliseParams`, which
  // re-resolves with a context that has NO source. Every narrowing has to read
  // an empty context as "no opinion", or the frozen request loses Join's
  // fields and types, Distance's property, and Aggregate's columns.
  it("re-resolving Join with an empty context keeps the fields and the types", () => {
    const resolved = resolveCrossLayerParams(
      "join-by-location",
      { fields: ["Zone Name", "noise"] },
      ctx,
    );
    expect(resolved).toMatchObject({
      fields: ["Zone Name", "noise"],
      fieldTypes: { "Zone Name": "VARCHAR", noise: "DOUBLE" },
    });
    expect(
      resolveCrossLayerParams("join-by-location", resolved, BAG_ONLY),
    ).toEqual(resolved);
  });

  it("re-resolving Distance with an empty context keeps the property", () => {
    const resolved = resolveCrossLayerParams(
      "distance-to-nearest",
      { nearestIdProperty: "Zone Name", writeNearestId: true },
      ctx,
    );
    expect(resolved).toMatchObject({ nearestIdProperty: "Zone Name" });
    expect(
      resolveCrossLayerParams("distance-to-nearest", resolved, BAG_ONLY),
    ).toEqual(resolved);
  });

  it("re-resolving Aggregate with an empty context keeps the columns", () => {
    const resolved = resolveCrossLayerParams(
      "aggregate-per-area",
      { rows: [{ op: "sum", column: "roof_area_m2" }] },
      ctx,
    );
    expect(resolved).toMatchObject({
      rows: [{ op: "sum", column: "roof_area_m2" }],
    });
    expect(
      resolveCrossLayerParams("aggregate-per-area", resolved, BAG_ONLY),
    ).toEqual(resolved);
  });
});

describe("the params readers", () => {
  it("reads an unknown value as the safe default rather than throwing", () => {
    expect(joinParams({ proxy: "nonsense", predicate: 7, tie: null })).toEqual({
      // "centre" is the one proxy every layer kind can offer, so a bag that
      // lost its proxy can never claim a footprint the layer does not have.
      proxy: "centre",
      predicate: "intersects",
      fields: [],
      tie: "first",
      writeMatchCount: false,
      // Residual B4: the reader always answers with the whole record, and a
      // bag with no embedded types answers with an empty map — never
      // `undefined`, which `joinColumns` would have to guard.
      fieldTypes: {},
    });
    expect(distanceParams({ maxDistanceM: "abc" })).toEqual({
      proxy: "centre",
      maxDistanceM: 500,
      writeNearestId: false,
      nearestIdProperty: null,
    });
    expect(aggregateParams({ rows: "nope" })).toEqual({
      proxy: "centre",
      predicate: "intersects",
      rows: [],
    });
  });

  it("keeps a non-integer distance and a zero, for validation to refuse", () => {
    expect(distanceParams({ maxDistanceM: 12.5 }).maxDistanceM).toBe(12.5);
    expect(distanceParams({ maxDistanceM: 0 }).maxDistanceM).toBe(0);
    expect(distanceParams({ maxDistanceM: -4 }).maxDistanceM).toBe(-4);
  });
});

describe("the column builders", () => {
  it("names §7.5's copied columns after the slugified field, typed", () => {
    expect(
      joinColumns(
        "zones_",
        joinParams({
          fields: ["Zone Name", "noise", "flood"],
          writeMatchCount: true,
          fieldTypes: TYPES,
        }),
      ),
    ).toEqual([
      { name: "zones_zone_name", type: "VARCHAR" },
      { name: "zones_noise", type: "DOUBLE" },
      { name: "zones_flood", type: "BOOLEAN" },
      { name: "zones_matches_n", type: "DOUBLE" },
    ]);
  });

  it("writes only the match count for 'count only' (§7.5)", () => {
    expect(
      joinColumns(
        "zones_",
        joinParams({
          fields: ["noise"],
          tie: "countOnly",
          writeMatchCount: true,
          fieldTypes: TYPES,
        }),
      ),
    ).toEqual([{ name: "zones_matches_n", type: "DOUBLE" }]);
  });

  it("calls a field of unknown type VARCHAR rather than guessing DOUBLE", () => {
    expect(joinColumns("zones_", joinParams({ fields: ["mystery"] }))).toEqual([
      { name: "zones_mystery", type: "VARCHAR" },
    ]);
  });

  it("is §7.7's two columns, in §7.7's order", () => {
    expect(
      distanceColumns("roads_", distanceParams({ writeNearestId: true })),
    ).toEqual([
      { name: "roads_distance_m", type: "DOUBLE" },
      { name: "roads_nearest_id", type: "VARCHAR" },
    ]);
    expect(distanceColumns("roads_", distanceParams({}))).toEqual([
      { name: "roads_distance_m", type: "DOUBLE" },
    ]);
  });

  it("is §7.6's one column per row, count spelled buildings_n", () => {
    expect(
      aggregateColumns(
        "bld_",
        aggregateParams({
          rows: [
            { op: "count", column: null },
            { op: "sum", column: "roof_area_m2" },
            { op: "mean", column: "b3_h_dak_max" },
          ],
        }),
      ),
    ).toEqual([
      { name: "bld_buildings_n", type: "DOUBLE" },
      { name: "bld_sum_roof_area_m2", type: "DOUBLE" },
      { name: "bld_mean_b3_h_dak_max", type: "DOUBLE" },
    ]);
  });

  it("skips an aggregate row whose op needs a column and has none", () => {
    // Reachable only on a source layer with no numeric column at all; the
    // validation below then refuses Run, so nothing is silently written.
    expect(
      aggregateColumns("bld_", aggregateParams({ rows: [{ op: "sum" }] })),
    ).toEqual([]);
  });
});

describe("the validation §6 puts inline and blocks Run with", () => {
  const join = (raw: Record<string, unknown>) =>
    crossLayerParamsError("join-by-location", raw, ctx);

  it("refuses a join that would write nothing", () => {
    expect(join({ fields: [], writeMatchCount: false })).toBe(
      "Pick at least one measure",
    );
  });

  it("refuses largest overlap on the centre proxy (§6)", () => {
    expect(join({ tie: "largestOverlap", proxy: "centre" })).toBe(
      "Largest overlap needs a footprint or rectangle",
    );
    expect(
      join({ tie: "largestOverlap", proxy: "rectangle", fields: ["noise"] }),
    ).toBeNull();
  });

  it("flags two fields that slugify to the same column, on the SECOND", () => {
    expect(join({ fields: ["Zone Name", "zone_name"] })).toBe(
      "'zone_name' resolves to the same column",
    );
  });

  it("refuses a distance limit that is not positive", () => {
    expect(
      crossLayerParamsError("distance-to-nearest", { maxDistanceM: 0 }, ctx),
    ).toBe("A distance limit must be a positive number"); // [adapted copy A11]
    expect(
      crossLayerParamsError("distance-to-nearest", { maxDistanceM: 500 }, ctx),
    ).toBeNull();
  });

  it("asks for the nearest-id property only when the source has no id", () => {
    const ticked = { writeNearestId: true, nearestIdProperty: null };
    expect(
      crossLayerParamsError("distance-to-nearest", ticked, ctx),
    ).toBeNull();
    expect(
      crossLayerParamsError("distance-to-nearest", ticked, {
        ...ctx,
        sourceHasFeatureIds: false,
      }),
    ).toBe("Choose the property to copy");
  });

  it("refuses a row that would write nothing, even beside a valid one", () => {
    // The mixed case: the count is fine, the sum has no column, and
    // `aggregateColumns` would quietly drop the sum. **[adapted copy A17]**
    expect(
      crossLayerParamsError(
        "aggregate-per-area",
        {
          rows: [
            { op: "count", column: null },
            { op: "sum", column: null },
          ],
        },
        ctx,
      ),
    ).toBe("Choose a column to summarise");
    expect(
      crossLayerParamsError(
        "aggregate-per-area",
        {
          rows: [
            { op: "count", column: null },
            { op: "sum", column: "roof_area_m2" },
          ],
        },
        ctx,
      ),
    ).toBeNull();
  });

  it("refuses an aggregate with no rows, and two rows on one column", () => {
    expect(crossLayerParamsError("aggregate-per-area", { rows: [] }, ctx)).toBe(
      "Pick at least one measure",
    );
    expect(
      crossLayerParamsError(
        "aggregate-per-area",
        {
          rows: [
            { op: "sum", column: "roof_area_m2" },
            { op: "sum", column: "roof_area_m2" },
          ],
        },
        ctx,
      ),
    ).toBe("'sum_roof_area_m2' resolves to the same column");
  });
});

/**
 * Residual B11: §6's validation is inline and BESIDE the offence. Aggregate's
 * offences are ROW-shaped, so the sentence has to be attributable to one row —
 * and `crossLayerParamsError` above must say the same thing, from the same
 * function, or the form and Run would disagree about which row is wrong.
 */
describe("aggregateRowErrors (§6, per row)", () => {
  it("is null for every runnable row", () => {
    expect(
      aggregateRowErrors(
        aggregateParams({
          rows: [
            { op: "count", column: null },
            { op: "sum", column: "roof_area_m2" },
          ],
        }),
      ),
    ).toEqual([null, null]);
  });

  it("puts A17 on the incomplete row and leaves its neighbour alone", () => {
    expect(
      aggregateRowErrors(
        aggregateParams({
          rows: [
            { op: "count", column: null },
            { op: "sum", column: null },
          ],
        }),
      ),
    ).toEqual([null, "Choose a column to summarise"]);
  });

  it("flags a duplicate output column on the SECOND row (§6)", () => {
    expect(
      aggregateRowErrors(
        aggregateParams({
          rows: [
            { op: "sum", column: "roof_area_m2" },
            { op: "sum", column: "roof_area_m2" },
            { op: "mean", column: "roof_area_m2" },
          ],
        }),
      ),
    ).toEqual([null, "'sum_roof_area_m2' resolves to the same column", null]);
  });

  it("flags two counts as one column too — `buildings_n` is not per row", () => {
    expect(
      aggregateRowErrors(
        aggregateParams({
          rows: [
            { op: "count", column: null },
            { op: "count", column: null },
          ],
        }),
      ),
    ).toEqual([null, "'buildings_n' resolves to the same column"]);
  });
});

describe("numericColumnsOf", () => {
  it("offers the numeric columns, computed ones included, and no others", () => {
    expect(numericColumnsOf(table())).toEqual([
      "b3_h_dak_max",
      "roof_area_m2",
      "bouwjaar",
    ]);
  });

  it("is empty for no table at all", () => {
    expect(numericColumnsOf(null)).toEqual([]);
  });
});
