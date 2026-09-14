### Task 15: The cross-layer form

**Files:**

- Create: `src/features/processing/crossLayerParams.ts`, `src/ui/processing/CrossLayerParams.tsx`
- Modify: `src/ui/processing/ToolView.tsx`, `src/ui/processing/useToolForm.ts`, `src/features/processing/processingStore.ts`, `src/features/processing/toolRegistry.ts`, `src/features/processing/types.ts` (one optional argument on `outputColumns` — see the deviations), `src/features/processing/runQueue.ts` (one literal becomes `SOURCE_NEEDS_AREAS`, Step 6), `src/ui/processing/RecentRuns.tsx` ("Edit & run" carries the source)
- Test: `tests/unit/features/processing/crossLayerParams.test.ts`, `tests/unit/ui/processing/CrossLayerParams.test.tsx`, additions to `tests/unit/ui/processing/useToolForm.test.tsx`

**Interfaces:**

- Consumes: `geoPropertyTypes(records)` and `VectorPreflight.propertyTypes` and `documentGeometryKinds` (Task 12), `proxyOptions`/`defaultProxy`/`BuildingProxy`/`lodZeroLabel` (Task 14), `ToolDefinition.sourceKind` (Task 11), `OutputColumn`/`ColumnType` (`computedColumns.ts:30-34`), `geoRecords` (`geoRecords.ts:14`), `ColumnInfo` (`columnKind.ts:34-39`).
- Produces, in `crossLayerParams.ts`:

```ts
export type JoinPredicate = "intersects" | "within" | "centreWithin";
export type JoinTie = "first" | "largestOverlap" | "countOnly";
export interface JoinParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  readonly fields: ReadonlyArray<string>;
  readonly tie: JoinTie;
  readonly writeMatchCount: boolean;
  /** The SOURCE property types, EMBEDDED in the frozen bag by the form's
   *  `normaliseParams` so `outputColumns(prefix, params)` stays two-argument
   *  (commander's ruling, Decisions item 6 (iii)). Keyed by the RAW property
   *  name, not the slug. A field missing here is VARCHAR. */
  readonly fieldTypes: Readonly<Record<string, ColumnType>>;
}
export interface DistanceParams {
  readonly proxy: BuildingProxy;
  readonly maxDistanceM: number;
  readonly writeNearestId: boolean;
  readonly nearestIdProperty: string | null;
}
export type AggregateOp = "count" | "sum" | "mean" | "min" | "max";
export interface AggregateRow {
  readonly op: AggregateOp;
  readonly column: string | null;
}
export interface AggregateParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  readonly rows: ReadonlyArray<AggregateRow>;
}
export function joinParams(raw: Readonly<Record<string, unknown>>): JoinParams;
export function distanceParams(
  raw: Readonly<Record<string, unknown>>,
): DistanceParams;
export function aggregateParams(
  raw: Readonly<Record<string, unknown>>,
): AggregateParams;
export function joinColumns(
  prefix: string,
  params: JoinParams, // the types ride in `params.fieldTypes`
): ReadonlyArray<OutputColumn>;
export function distanceColumns(
  prefix: string,
  params: DistanceParams,
): ReadonlyArray<OutputColumn>;
export function aggregateColumns(
  prefix: string,
  params: AggregateParams,
): ReadonlyArray<OutputColumn>;
export function slugifyField(name: string): string;
// ADDED (see the deviations):
export const SOURCE_NEEDS_AREAS: ReadonlySet<ToolId>;
export const TARGET_NEEDS_AREAS: ReadonlySet<ToolId>;
export const POLYGONAL_KINDS: ReadonlySet<string>;
export interface CrossLayerContext {
  readonly table: LayerTable | null;
  readonly sourcePropertyKeys: ReadonlyArray<string>;
  readonly sourcePropertyTypes: ReadonlyMap<string, ColumnType>;
  readonly sourceHasFeatureIds: boolean;
  readonly numericColumns: ReadonlyArray<string>;
}
export function resolveCrossLayerParams(
  toolId: ToolId,
  raw: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): Readonly<Record<string, unknown>>;
export function crossLayerParamsError(
  toolId: ToolId,
  params: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): string | null;
export function numericColumnsOf(
  table: LayerTable | null,
): ReadonlyArray<string>;
```

- `ToolDraft` gains `sourceLayerId: string | null`; `useToolForm` gains `params`, `targetOptions`, `sourceOptions`, `sourceLayerId`, `sourceReason`, `cityLayer`, `cityTable`, `sourcePropertyKeys`, `sourcePropertyTypes`, `numericColumns`; the three registry entries gain `outputColumns`, `validateParams` and `normaliseParams` with `implemented` still `false`.
- Tasks 16, 17 and 19 consume the params readers and the column builders; Task 20 adds `ToolDraft.destination`/`newLayerName` to the same interface.

**Five deviations from the ledger, all named.**

1. **`JoinParams` gains `fieldTypes`, and `joinColumns` loses its third argument.** The ledger spelled `joinColumns(prefix, params, types)`; it is now `joinColumns(prefix, params)`, with the SOURCE's property types embedded in the bag by `resolveCrossLayerParams` and frozen with it. This is the commander's ruling (Decisions item 6 (iii)): `ToolDefinition.outputColumns(prefix, params)` stays TWO-argument, so `RunFooter`'s `tool.outputColumns(run.prefix, run.params)` is exact for Join with no source layer to ask. The §6.4 objection to a type map in the bag ("it would print as `[object Object]`") is answered by Task 27's `paramValue`, which JSON-stringifies an object; only the CHOSEN fields' types go in, so the record stays short.
2. **`resolveCrossLayerParams` is added**, and it is what makes §6.4 honest. §7.5's "all fields on by default" and §7.5's "footprint when available, otherwise extent centre" are defaults that depend on the SOURCE's keys and the TARGET's table — facts a pure `joinParams(raw)` cannot know. Writing them from a render would be a side effect (`useToolForm` says so at `:99-104` about the LoD), so the hook RESOLVES them per render into an effective bag, the form renders that bag, and `ToolView` freezes it. §6.4's "building geometry proxy actually used" is then literally what was frozen.
3. **`crossLayerParamsError` is added** beside the registry's `validateParams`, and the split is deliberate: `validateParams` decides what the BAG alone decides (no fields and no match count, largest overlap on a centre proxy, a non-positive distance, two aggregates resolving to one column, no aggregate rows), and `crossLayerParamsError` decides what needs the SOURCE (§7.7's "Choose the property to copy", which is only wrong when the source has no feature id of its own).
4. **`SOURCE_NEEDS_AREAS` / `TARGET_NEEDS_AREAS` / `POLYGONAL_KINDS` are added.** §7.5's source must be areas and §7.7's may be any geometry type, and §7.6's TARGET must be areas — three different answers that no field on `ToolDefinition` expresses. Two small sets in the params module, beside the tools they are about, keep it out of the view; `ToolView` already dispatches PARAMETERS on the tool (`:220`), so this is the same layer.
5. **`numericColumnsOf` is added** for §7.6's "a numeric column select of the source layer (computed columns included)". `columnKind.ts` has `isTextColumn` but no numeric predicate, and inverting `isTextColumn` would offer a BOOLEAN or a list column to `sum`.

**The one thing this task must not get wrong: `resolveCrossLayerParams` runs TWICE per run.** The form resolves the draft with the real source; `ToolView.run()` then calls the registry's `normaliseParams`, which resolves the ALREADY-resolved bag again with `BAG_ONLY` — no table, no source keys, no source types. Every narrowing against the context is therefore conditioned on the context HAVING an answer: an empty `sourcePropertyKeys` keeps the bag's `fields` and `nearestIdProperty`, an empty `sourcePropertyTypes` keeps its `fieldTypes`, an empty `numericColumns` keeps each aggregate row's column. Read naively — filter against an empty set — the second pass strips Join's fields to `[]`, nulls Distance's property and empties the type map, and the run writes nothing but `matches_n`. Three cases in `crossLayerParams.test.ts` pin it, one per tool, and they are the tests that keep ruling (iii) alive: without a self-sufficient frozen bag, `outputColumns(prefix, params)` cannot stay two-argument.

**§7.5's and §7.7's prefix default lands here.** "OUTPUT prefix defaults to the source layer name slugified (`zones_`)" is the one §7.5 requirement that has no other home: the registry's `defaultPrefix` is `""` for both tools and cannot know the source. It is DERIVED in the hook from the resolved source, never stored, so a later source change re-offers the new name — and a slug §6's own prefix rule would reject (one starting with a digit) falls back to the tool's default rather than opening the form on an invalid value.

**Three adapted strings, each with a row in the front matter's adapted-copy table; implement them verbatim.** §6 says "a distance limit must be a positive number" but gives no message, so this task uses **[adapted copy A11]** `A distance limit must be a positive number` — the spec's own clause as a sentence. Decisions recorded item 4 settles Aggregate's scope wording as proposed: the radios stay under TARGET with the muted line **[adapted copy A12]** `Scope applies to the source layer's buildings.` And §7.6 requires "a numeric column select of the source layer" for every aggregate except count but words no message for an unfilled one, so the row's placeholder option and its blocking error are both **[adapted copy A17]** `Choose a column to summarise` — §7.7's accepted `Choose the property to copy` for the sibling case, said about a column.

**Aggregate's scope counts come from the SOURCE, and the prefix check from the TARGET.** Two different layers in one form: the scope radios count the city layer's FEATURES (§7.6: "Scope applies to the SOURCE buildings"), so `useLayerCounts` is called with the city layer's id; and §6's "'height' belongs to the source data" is about the TARGET, so for a vector target it compares against the target document's public property KEYS rather than the city table's columns. A form that got either the wrong way round would count areas as buildings or refuse a prefix over a column on another layer.

- [ ] **Step 1: Write the failing test for the pure half**

Create `tests/unit/features/processing/crossLayerParams.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/crossLayerParams.test.ts
```

Expected: FAIL — `src/features/processing/crossLayerParams.ts` does not exist.

- [ ] **Step 3: Write the params module**

Create `src/features/processing/crossLayerParams.ts`:

```ts
/**
 * §7.5, §7.6 and §7.7's parameters, and the columns they resolve to.
 *
 * ONE module for three tools, because they share everything that matters: the
 * building proxy, the predicate, the slugified column names and the "resolves
 * to the same column" rule. Three files would be three places for the tie rule
 * to drift.
 *
 * FOUR READERS, and that is why every answer is pure: the registry (whose
 * `outputColumns`, `validateParams` and `normaliseParams` are data), the form
 * (which prints the resolved column list before any run exists), `submitRun`
 * (which FREEZES the normalised bag, so §6.4's log is the reproducible record)
 * and the executors (which read the frozen bag back).
 *
 * THE DEFAULTS THAT NEED CONTEXT LIVE IN `resolveCrossLayerParams`, NOT IN THE
 * READERS. §7.5's "all fields on by default" needs the SOURCE's keys and
 * "footprint when available" needs the TARGET's table — facts a `joinParams`
 * over an untyped bag cannot have. The hook resolves them per render, the form
 * renders the resolved bag, and `ToolView` freezes it; so the proxy in §6.4's
 * "building geometry proxy actually used" is literally the one that was used.
 * The readers' own fallback proxy is `"centre"`, the one every layer kind can
 * offer, so a bag that somehow lost its proxy can never claim a footprint the
 * layer does not have.
 */
import type { ColumnType, OutputColumn } from "../../insights/computedColumns";
import type { LayerTable } from "../../insights/layerTables";
import {
  defaultProxy,
  proxyOptions,
  type BuildingProxy,
} from "./buildingProxy";
import type { ToolId } from "./types";

export type JoinPredicate = "intersects" | "within" | "centreWithin";
export type JoinTie = "first" | "largestOverlap" | "countOnly";

export interface JoinParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  /** The SOURCE property names to copy, in source order. */
  readonly fields: ReadonlyArray<string>;
  readonly tie: JoinTie;
  readonly writeMatchCount: boolean;
  /**
   * The SOURCE property types, keyed by the RAW property name.
   * `resolveCrossLayerParams` puts them here and `normaliseParams` freezes them
   * with the rest of the bag, which is what keeps
   * `ToolDefinition.outputColumns(prefix, params)` TWO-argument and exact in
   * `RunFooter`, where no source layer is reachable (Decisions item 6 (iii)).
   * A field with no entry is VARCHAR — the type that holds anything — never
   * DOUBLE.
   */
  readonly fieldTypes: Readonly<Record<string, ColumnType>>;
}

export interface DistanceParams {
  readonly proxy: BuildingProxy;
  /** §7.7: "positive number, default 500". */
  readonly maxDistanceM: number;
  readonly writeNearestId: boolean;
  /** The source property to copy, or `null` for the feature's own GeoJSON
   *  `id` — §7.7's default when the source has one. */
  readonly nearestIdProperty: string | null;
}

export type AggregateOp = "count" | "sum" | "mean" | "min" | "max";
export interface AggregateRow {
  readonly op: AggregateOp;
  /** The SOURCE city column, or null for `count`. */
  readonly column: string | null;
}
export interface AggregateParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  readonly rows: ReadonlyArray<AggregateRow>;
}

/** §7.5's source must be AREAS; §7.7's may be any geometry type. */
export const SOURCE_NEEDS_AREAS: ReadonlySet<ToolId> = new Set<ToolId>([
  "join-by-location",
]);
/** §7.6's TARGET must be areas — "point and line layers are disabled". */
export const TARGET_NEEDS_AREAS: ReadonlySet<ToolId> = new Set<ToolId>([
  "aggregate-per-area",
]);
/** The GeoJSON geometry types that are areas. */
export const POLYGONAL_KINDS: ReadonlySet<string> = new Set([
  "Polygon",
  "MultiPolygon",
]);

const PROXIES: ReadonlyArray<BuildingProxy> = [
  "footprint",
  "rectangle",
  "centre",
];
const PREDICATES: ReadonlyArray<JoinPredicate> = [
  "intersects",
  "within",
  "centreWithin",
];
const TIES: ReadonlyArray<JoinTie> = ["first", "largestOverlap", "countOnly"];
const OPS: ReadonlyArray<AggregateOp> = ["count", "sum", "mean", "min", "max"];
const DEFAULT_MAX_DISTANCE_M = 500;

function pick<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;
}

function strings(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * A field name as a column name: lower snake case, §6's collision rule
 * included — "Zone Name" and "zone_name" BOTH resolve to `zone_name`, and the
 * second one is flagged.
 *
 * A name with nothing usable in it becomes `field` rather than an empty string,
 * because an empty suffix would make the column the bare prefix — and for
 * §7.5's empty default prefix, no name at all.
 */
export function slugifyField(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "field" : slug;
}

export function joinParams(raw: Readonly<Record<string, unknown>>): JoinParams {
  const tie = pick(raw["tie"], TIES, "first");
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    predicate: pick(raw["predicate"], PREDICATES, "intersects"),
    fields: strings(raw["fields"]),
    tie,
    // §7.5: "count only" "writes no fields and FORCES the match count on".
    writeMatchCount: tie === "countOnly" || raw["writeMatchCount"] === true,
    fieldTypes: columnTypes(raw["fieldTypes"]),
  };
}

/** A bag's `fieldTypes` entry, narrowed. Anything that is not one of the three
 *  `ColumnType` spellings is dropped, so a stale or hand-edited frozen bag
 *  reads as "unknown" (VARCHAR) rather than poisoning a column's type. */
function columnTypes(value: unknown): Readonly<Record<string, ColumnType>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, ColumnType> = {};
  for (const [key, type] of Object.entries(value as Record<string, unknown>)) {
    if (type === "DOUBLE" || type === "BOOLEAN" || type === "VARCHAR") {
      out[key] = type;
    }
  }
  return out;
}

export function distanceParams(
  raw: Readonly<Record<string, unknown>>,
): DistanceParams {
  // Kept as typed, not clamped: §6's validation is what refuses 0 and -4, and
  // a silently clamped limit would run over a distance the user never asked
  // for. `Number(undefined)` is NaN, so an absent limit takes the default
  // through the same branch as a junk one.
  const limit = Number(raw["maxDistanceM"]);
  const property = raw["nearestIdProperty"];
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    maxDistanceM: Number.isFinite(limit) ? limit : DEFAULT_MAX_DISTANCE_M,
    writeNearestId: raw["writeNearestId"] === true,
    nearestIdProperty: typeof property === "string" ? property : null,
  };
}

export function aggregateParams(
  raw: Readonly<Record<string, unknown>>,
): AggregateParams {
  const rows = Array.isArray(raw["rows"]) ? raw["rows"] : [];
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    predicate: pick(raw["predicate"], PREDICATES, "intersects"),
    rows: rows.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const record = row as Record<string, unknown>;
      const op = pick(record["op"], OPS, "count");
      const column = record["column"];
      return [
        {
          op,
          column: op === "count" || typeof column !== "string" ? null : column,
        },
      ];
    }),
  };
}

/**
 * §7.5's columns: one per copied field, then the match count.
 *
 * The ORDER is the fields' source order, which is what §6.2's Style by result
 * walks to find "the first copied TEXT field". A field whose type the source
 * did not report is VARCHAR — the type that holds anything — never DOUBLE.
 *
 * TWO arguments, never three: the types ride in `params.fieldTypes`, which the
 * form's `normaliseParams` embedded before the request was frozen. That is what
 * makes `tool.outputColumns(run.prefix, run.params)` exact in `RunFooter`,
 * which has no source layer left to ask (Decisions item 6 (iii)).
 */
export function joinColumns(
  prefix: string,
  params: JoinParams,
): ReadonlyArray<OutputColumn> {
  const columns: OutputColumn[] = [];
  // §7.5: "count only" writes NO fields.
  if (params.tie !== "countOnly") {
    for (const field of params.fields) {
      columns.push({
        name: `${prefix}${slugifyField(field)}`,
        type: params.fieldTypes[field] ?? "VARCHAR",
      });
    }
  }
  if (params.writeMatchCount) {
    columns.push({ name: `${prefix}matches_n`, type: "DOUBLE" });
  }
  return columns;
}

/** §7.7: `roads_distance_m`, then `roads_nearest_id`. */
export function distanceColumns(
  prefix: string,
  params: DistanceParams,
): ReadonlyArray<OutputColumn> {
  const columns: OutputColumn[] = [
    { name: `${prefix}distance_m`, type: "DOUBLE" },
  ];
  if (params.writeNearestId) {
    columns.push({ name: `${prefix}nearest_id`, type: "VARCHAR" });
  }
  return columns;
}

/**
 * §7.6: "one column per row, named `<prefix><agg>_<column>` (`buildings_n` for
 * count)". With the default prefix that reads `bld_buildings_n`,
 * `bld_sum_roof_area_m2`.
 *
 * A row whose op needs a column and has none is SKIPPED rather than named after
 * nothing; that state is reachable only on a source layer with no numeric
 * column at all, and `crossLayerParamsError` refuses Run for it.
 */
export function aggregateColumns(
  prefix: string,
  params: AggregateParams,
): ReadonlyArray<OutputColumn> {
  return params.rows.flatMap((row) => {
    if (row.op === "count") {
      return [{ name: `${prefix}buildings_n`, type: "DOUBLE" as const }];
    }
    if (row.column === null) return [];
    return [
      {
        name: `${prefix}${row.op}_${slugifyField(row.column)}`,
        type: "DOUBLE" as const,
      },
    ];
  });
}

/** The numeric columns §7.6's aggregate rows may summarise — the file's and the
 *  computed ones alike. `columnKind.ts` has `isTextColumn` but no numeric
 *  predicate, and inverting it would offer a BOOLEAN or a list column to
 *  `sum`. */
const NUMERIC_TYPE =
  /^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC|BIGINT|HUGEINT|INTEGER|SMALLINT|TINYINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)\b/i;

export function numericColumnsOf(
  table: LayerTable | null,
): ReadonlyArray<string> {
  return (table?.columns ?? [])
    .filter((c) => c.kind === "scalar" && NUMERIC_TYPE.test(c.type.trim()))
    .map((c) => c.name);
}

export interface CrossLayerContext {
  /** The COMPUTE layer's table — the city layer whose buildings are measured
   *  (the target for §7.5/§7.7, the source for §7.6). */
  readonly table: LayerTable | null;
  readonly sourcePropertyKeys: ReadonlyArray<string>;
  /** `geoPropertyTypes(records)` over the SOURCE document (Task 12). The join's
   *  resolved bag carries them into `fieldTypes`, so the FROZEN params alone
   *  type the copied columns. */
  readonly sourcePropertyTypes: ReadonlyMap<string, ColumnType>;
  /** Whether the source layer's features carry a GeoJSON `id` (§7.7). */
  readonly sourceHasFeatureIds: boolean;
  readonly numericColumns: ReadonlyArray<string>;
}

/**
 * The draft's bag with every context-dependent default filled in — the EFFECTIVE
 * parameters the form renders and `submitRun` freezes.
 *
 * **Idempotent, including against an EMPTY context, and that is load-bearing.**
 * The form resolves with the real source; `ToolView.run()` then calls the
 * registry's `normaliseParams`, which resolves the ALREADY-resolved bag again
 * with `BAG_ONLY` — no table, no source keys, no source types. Every narrowing
 * this function does against the context is therefore conditioned on the
 * context HAVING an answer: an empty `sourcePropertyKeys` narrows nothing, and
 * an empty `sourcePropertyTypes` falls back to the bag's own `fieldTypes`.
 * Without that, re-normalising would strip Join's `fields` to `[]`, null
 * Distance's `nearestIdProperty` and wipe the embedded types — and the run
 * would write nothing but `matches_n`.
 */
export function resolveCrossLayerParams(
  toolId: ToolId,
  raw: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): Readonly<Record<string, unknown>> {
  // §7.5: "footprint when available, otherwise extent centre" — and a proxy
  // the CURRENT table cannot offer is replaced, because the draft is kept per
  // tool for the session and survives a retarget.
  //
  // Only a TABLE can say a proxy is unavailable, so a context with none keeps
  // what the bag has. This is the same "an empty context is no opinion" rule as
  // the fields and the aggregate columns below, and here it is load-bearing in
  // the same way: `normaliseParams` re-resolves the form's already-resolved bag
  // with `BAG_ONLY`, and narrowing to "centre" there would freeze a run against
  // a proxy the form never showed — §6.4's record would name a proxy that was
  // not used, and a footprint join would silently become a centre join.
  const chosen = pick(raw["proxy"], PROXIES, "centre");
  const proxy =
    ctx.table === null
      ? chosen
      : raw["proxy"] === undefined ||
          !proxyOptions(ctx.table).some(
            (option) => option.key === chosen && option.available,
          )
        ? defaultProxy(ctx.table)
        : chosen;
  const known = new Set(ctx.sourcePropertyKeys);
  // No source in this context (the registry's `BAG_ONLY`) means "no opinion",
  // never "no properties": the caller that HAS the source has already pruned.
  const knowsSource = known.size > 0;

  if (toolId === "distance-to-nearest") {
    const p = distanceParams({ ...raw, proxy });
    const property =
      p.nearestIdProperty !== null &&
      (!knowsSource || known.has(p.nearestIdProperty))
        ? p.nearestIdProperty
        : null;
    return {
      proxy,
      maxDistanceM: p.maxDistanceM,
      // §7.7: on by default when the source has a feature `id`; off when it has
      // none, because ticking it would then need a property nobody chose.
      writeNearestId:
        raw["writeNearestId"] === undefined
          ? ctx.sourceHasFeatureIds
          : p.writeNearestId,
      nearestIdProperty: property,
    };
  }

  if (toolId === "aggregate-per-area") {
    const p = aggregateParams({ ...raw, proxy });
    // §7.6's "Default row: count".
    const rows =
      raw["rows"] === undefined
        ? [{ op: "count" as const, column: null }]
        : p.rows;
    return {
      proxy,
      predicate: p.predicate,
      rows: rows.map((row) =>
        row.op === "count"
          ? { op: row.op, column: null }
          : {
              op: row.op,
              // Same rule: an empty `numericColumns` is "no opinion". Keeping
              // the row's own column is what survives the re-normalise.
              column:
                ctx.numericColumns.length === 0 ||
                (row.column !== null && ctx.numericColumns.includes(row.column))
                  ? row.column
                  : (ctx.numericColumns[0] ?? null),
            },
      ),
    };
  }

  const p = joinParams({ ...raw, proxy });
  // §7.5: "all on by default". An EXPLICIT empty list stays empty — that is
  // the state the user reaches by unticking everything, and Run refuses it.
  const fields =
    raw["fields"] === undefined
      ? [...ctx.sourcePropertyKeys]
      : knowsSource
        ? p.fields.filter((field) => known.has(field))
        : p.fields;
  // Decisions item 6 (iii): the SOURCE's types are EMBEDDED here, so the frozen
  // bag is self-sufficient and `outputColumns(prefix, params)` needs no third
  // argument. Only the chosen fields go in — the bag is §6.4's record and a map
  // of every property the source ever had is noise. A plain object, not a Map,
  // because the bag is JSON: §6.4's log renders it through `paramValue`.
  //
  // The bag's OWN entry wins when this context has no answer, which is what
  // keeps the function idempotent: the registry's `normaliseParams` re-resolves
  // with `BAG_ONLY` (no source at all), and it must not wipe the types the
  // form already embedded.
  const fieldTypes: Record<string, ColumnType> = {};
  for (const field of fields) {
    const type = ctx.sourcePropertyTypes.get(field) ?? p.fieldTypes[field];
    if (type !== undefined) fieldTypes[field] = type;
  }
  return {
    proxy,
    predicate: p.predicate,
    fields,
    tie: p.tie,
    writeMatchCount: p.writeMatchCount,
    fieldTypes,
  };
}

/** The first duplicate column name in a list, or null. §6 flags it on the
 *  SECOND occurrence. */
function firstDuplicate(names: ReadonlyArray<string>): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

/**
 * §6's "Validation is inline and blocks Run", for the three cross-layer tools.
 *
 * Everything decidable from the BAG plus the SOURCE. The registry's
 * `validateParams` forwards to this with the context the form supplies; the
 * separation from the readers above is that these are SENTENCES, and a sentence
 * belongs beside the rule it states.
 */
export function crossLayerParamsError(
  toolId: ToolId,
  raw: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): string | null {
  if (toolId === "distance-to-nearest") {
    const p = distanceParams(raw);
    if (!(p.maxDistanceM > 0)) {
      // **[adapted copy]** — §6 states the rule ("a distance limit must be a
      // positive number") and gives no sentence.
      return "A distance limit must be a positive number";
    }
    // §7.7: "ticking it requires choosing a property". Only wrong when the
    // source has no feature `id` of its own to fall back on.
    if (
      p.writeNearestId &&
      p.nearestIdProperty === null &&
      !ctx.sourceHasFeatureIds
    ) {
      return "Choose the property to copy";
    }
    return null;
  }

  if (toolId === "aggregate-per-area") {
    const p = aggregateParams(raw);
    // §7.6's "+ Add aggregate" list, empty. `Pick at least one measure` is
    // REUSED here verbatim (Decisions recorded item 5).
    if (p.rows.length === 0) return "Pick at least one measure";
    // EVERY row, not just the ones that produced a column. `aggregateColumns`
    // skips a row whose op needs a column and has none, so a `count` beside a
    // column-less `sum` would otherwise pass validation with one column and the
    // sum would vanish between the form and the write — a run that silently
    // did less than it was asked. **[adapted copy A17]**
    if (p.rows.some((row) => row.op !== "count" && row.column === null)) {
      return "Choose a column to summarise";
    }
    const columns = aggregateColumns("", p);
    const duplicate = firstDuplicate(columns.map((c) => c.name));
    return duplicate === null
      ? null
      : `'${duplicate}' resolves to the same column`;
  }

  const p = joinParams(raw);
  // §6: "a proxy/predicate pair that cannot combine … disables the option with
  // that text" — and the same sentence blocks Run if a stored draft carries the
  // pair anyway.
  if (p.tie === "largestOverlap" && p.proxy === "centre") {
    return "Largest overlap needs a footprint or rectangle";
  }
  const columns = joinColumns("", p);
  if (columns.length === 0) return "Pick at least one measure";
  const duplicate = firstDuplicate(columns.map((c) => c.name));
  return duplicate === null
    ? null
    : `'${duplicate}' resolves to the same column`;
}
```

- [ ] **Step 4: Run the pure half to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/crossLayerParams.test.ts
```

Expected: PASS.

- [ ] **Step 5: The document helper the form needs, and the draft's new field**

Append to `src/features/processing/vectorSource.ts` (§7.7's "when the source has one"):

```ts
/**
 * Does any feature carry a GeoJSON `id` of its own?
 *
 * §7.7's nearest-id select "defaults to the GeoJSON feature `id` when the
 * source has one; when it has none, the checkbox is off by default". The form
 * asks this before any run, so it cannot come from `reprojectGeoLayer`.
 */
export function documentHasFeatureIds(document: unknown): boolean {
  return featuresOf(document).some(
    (feature) =>
      typeof feature.id === "string" || typeof feature.id === "number",
  );
}

/**
 * Does the document carry a feature at all?
 *
 * §7.5 and §7.7's "The source layer has no features" is about the SOURCE
 * select, which is drawn per keystroke over every candidate layer — so it is
 * one array length per layer, not a walk of anyone's geometry.
 */
export function documentHasFeatures(document: unknown): boolean {
  return featuresOf(document).length > 0;
}
```

In `src/features/processing/processingStore.ts`, `ToolDraft` gains the source:

```ts
/** The form's draft (spec §6: kept per tool for the session). */
export interface ToolDraft {
  readonly targetLayerId: string | null;
  /** The SECOND layer a cross-layer run reads (spec §3), or null. */
  readonly sourceLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
}
```

In `src/ui/processing/RecentRuns.tsx`, "Edit & run" carries it — §6.3's "the same parameters" includes which layer the run read:

```ts
useProcessingStore.getState().setDraft(run.toolId, {
  targetLayerId: run.targetLayerId,
  sourceLayerId: run.sourceLayerId,
  scope: run.scope,
  lod: run.lod,
  prefix: run.prefix,
  params: run.params,
});
```

In `src/features/processing/types.ts`, `outputColumns` gains its optional third argument (the doc comment keeps its existing first paragraph):

```ts
  readonly outputColumns?: (
    prefix: string,
    params: Readonly<Record<string, unknown>>,
  ) => ReadonlyArray<OutputColumn>;
```

**`outputColumns` stays exactly TWO arguments** (commander's ruling, Decisions item 6 (iii)). §7.5's copied columns keep the source property's type, and the type comes from the SOURCE document — which the definition cannot see. It does not need to: `resolveCrossLayerParams` embeds the chosen fields' types in the bag as `fieldTypes`, the bag is FROZEN into the request, and `joinColumns(prefix, params)` reads them back. `RunFooter`'s `tool.outputColumns(run.prefix, run.params)` is then exact for Join too, with no live store read and no third argument to forget. §6.4's log renders the entry through `paramValue` (Task 27), which JSON-stringifies an object — `{"zone":"VARCHAR","noise":"DOUBLE"}`, not `[object Object]`.

`import type { OutputColumn } from "../../insights/computedColumns";` is already present from Task 4.

- [ ] **Step 6: The three registry entries**

In `src/features/processing/toolRegistry.ts`, add at the top:

```ts
import {
  aggregateColumns,
  aggregateParams,
  crossLayerParamsError,
  distanceColumns,
  distanceParams,
  joinColumns,
  joinParams,
  resolveCrossLayerParams,
} from "./crossLayerParams";
```

and give the three entries their columns, validation and normalisation. The bag-only context is deliberate: the FORM calls `crossLayerParamsError` again with the real source, and this one answers what the bag alone decides, so the two can never disagree about a rule.

```ts
/** The context-free half of §6's validation: what the BAG alone decides. The
 *  form re-asks with the real source (`useToolForm`), which is the only reader
 *  that can decide §7.7's "Choose the property to copy". */
const BAG_ONLY: CrossLayerContext = {
  table: null,
  sourcePropertyKeys: [],
  // Empty on purpose. `resolveCrossLayerParams` reads an empty context as "no
  // opinion" rather than "no properties" — it keeps the bag's own `fields`,
  // `fieldTypes`, `nearestIdProperty` and aggregate columns — so re-normalising
  // an already-resolved bag at `submitRun` changes nothing. Three cases in
  // `crossLayerParams.test.ts` pin that, one per tool.
  sourcePropertyTypes: new Map(),
  sourceHasFeatureIds: true,
  numericColumns: [],
};
```

`join-by-location`:

```ts
    defaultPrefix: "",
    outputColumns: (prefix, params) => joinColumns(prefix, joinParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("join-by-location", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("join-by-location", params, BAG_ONLY),
    implemented: false,
```

`distance-to-nearest`:

```ts
    defaultPrefix: "",
    outputColumns: (prefix, params) =>
      distanceColumns(prefix, distanceParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("distance-to-nearest", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("distance-to-nearest", params, BAG_ONLY),
    implemented: false,
```

`aggregate-per-area`:

```ts
    defaultPrefix: "bld_",
    outputColumns: (prefix, params) =>
      aggregateColumns(prefix, aggregateParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("aggregate-per-area", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("aggregate-per-area", params, BAG_ONLY),
    implemented: false,
```

`normaliseParams` is reached only from `ToolView.run()`, which hands it the ALREADY-resolved bag (`f.params`), so the permissive context here never has to invent a default — it is idempotent over a resolved bag by construction.

And in `src/features/processing/runQueue.ts`, the source phase's one-tool literal becomes the shared set now that it exists — Task 13 wrote it with a note saying so:

```ts
const sourceMustBeAreas = SOURCE_NEEDS_AREAS.has(tool.id);
```

with `SOURCE_NEEDS_AREAS` added to the `./crossLayerParams` import. One fact, one owner: the form's disabled row and the run's refusal cannot come to disagree about which tools need areas.

- [ ] **Step 7: Write the failing test for the form**

Create `tests/unit/ui/processing/CrossLayerParams.test.tsx`:

```tsx
/**
 * §7.5-§7.7's PARAMETERS sections: three tools, one component, and every
 * validation string §6 puts inline.
 *
 * A `{ params, onChange }` sibling of `RoofMetricsParams` — no store, no
 * engine — so the section can be driven directly and the write-back asserted
 * as a whole bag.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CrossLayerParams } from "../../../../src/ui/processing/CrossLayerParams";
import type { ProxyOption } from "../../../../src/features/processing/buildingProxy";
import type { ColumnType } from "../../../../src/insights/computedColumns";

const PROXIES: ReadonlyArray<ProxyOption> = [
  { key: "footprint", label: "Footprint (LoD 0)", available: true, note: null },
  { key: "rectangle", label: "Extent rectangle", available: true, note: null },
  { key: "centre", label: "Extent centre", available: true, note: null },
];
const NO_FOOTPRINT: ReadonlyArray<ProxyOption> = [
  {
    key: "footprint",
    label: "Footprint (LoD 0)",
    available: false,
    note: "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
  },
  ...PROXIES.slice(1),
];
const TYPES: ReadonlyMap<string, ColumnType> = new Map([
  ["zone", "VARCHAR"],
  ["noise", "DOUBLE"],
]);

function renderSection(
  toolId: "join-by-location" | "distance-to-nearest" | "aggregate-per-area",
  params: Record<string, unknown>,
  over: Partial<Parameters<typeof CrossLayerParams>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <CrossLayerParams
      toolId={toolId}
      params={params}
      onChange={onChange}
      proxies={PROXIES}
      sourcePropertyKeys={["zone", "noise"]}
      sourcePropertyTypes={TYPES}
      sourceHasFeatureIds
      numericColumns={["roof_area_m2", "b3_h_dak_max"]}
      {...over}
    />,
  );
  return onChange;
}

describe("the building-geometry radio (§7.5)", () => {
  it("offers the three proxies and checks the one in the bag", () => {
    renderSection("join-by-location", { proxy: "rectangle" });
    expect(
      screen.getByRole("radio", { name: "Extent rectangle" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeEnabled();
  });

  it("disables the footprint and shows §7.5's muted line", () => {
    renderSection(
      "join-by-location",
      { proxy: "centre" },
      { proxies: NO_FOOTPRINT },
    );
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
      ),
    ).toBeInTheDocument();
  });

  it("writes the whole bag back on a change", async () => {
    const onChange = renderSection("join-by-location", {
      proxy: "footprint",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
    await userEvent.click(screen.getByRole("radio", { name: "Extent centre" }));
    expect(onChange).toHaveBeenCalledWith({
      proxy: "centre",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
  });
});

describe("Join attributes by location (§7.5)", () => {
  it("lists the source's properties with their types, all ticked by default", () => {
    renderSection("join-by-location", { fields: ["zone", "noise"] });
    expect(screen.getByRole("checkbox", { name: /zone/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /noise/ })).toBeChecked();
    expect(screen.getByText(/noise/)).toHaveTextContent("DOUBLE");
  });

  it("disables Largest overlap on the centre proxy, with §6's own text", () => {
    renderSection("join-by-location", { proxy: "centre", tie: "first" });
    const option = screen.getByRole("option", { name: /Largest overlap/ });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute(
      "title",
      "Largest overlap needs a footprint or rectangle",
    );
  });

  it("forces the match count on when the tie rule is 'count only' (§7.5)", async () => {
    const onChange = renderSection("join-by-location", {
      proxy: "footprint",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
    await userEvent.selectOptions(
      screen.getByLabelText("When several areas match"),
      "countOnly",
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tie: "countOnly", writeMatchCount: true }),
    );
  });

  it("cannot turn the match count off while 'count only' is the tie rule", () => {
    // A render of its OWN: the section above never re-rendered with the new
    // bag, so its checkbox is still the enabled one.
    renderSection("join-by-location", {
      tie: "countOnly",
      writeMatchCount: true,
    });
    expect(
      screen.getByRole("checkbox", { name: /Also write the match count/ }),
    ).toBeDisabled();
  });

  it("shows a search box only past twelve fields (§7.5)", () => {
    const many = Array.from({ length: 13 }, (_, i) => `p${i}`);
    renderSection(
      "join-by-location",
      { fields: many },
      { sourcePropertyKeys: many, sourcePropertyTypes: new Map() },
    );
    expect(screen.getByLabelText("Search fields")).toBeInTheDocument();
  });
});

describe("Distance to nearest (§7.7)", () => {
  it("shows the 500 m default and writes a typed limit back", async () => {
    const onChange = renderSection("distance-to-nearest", {
      proxy: "footprint",
      maxDistanceM: 500,
      writeNearestId: false,
      nearestIdProperty: null,
    });
    const input = screen.getByLabelText("Max search distance (m)");
    expect(input).toHaveValue(500);
    await userEvent.clear(input);
    await userEvent.type(input, "250");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxDistanceM: 250 }),
    );
  });

  it("offers the feature's own id when the source has one", () => {
    renderSection("distance-to-nearest", {
      writeNearestId: true,
      nearestIdProperty: null,
    });
    expect(screen.getByLabelText("Nearest feature's id")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "The feature's id" }),
    ).toBeInTheDocument();
  });

  it("has no 'feature's id' option when the source has none", () => {
    renderSection(
      "distance-to-nearest",
      { writeNearestId: true, nearestIdProperty: null },
      { sourceHasFeatureIds: false },
    );
    expect(
      screen.queryByRole("option", { name: "The feature's id" }),
    ).not.toBeInTheDocument();
  });
});

describe("Aggregate buildings per area (§7.6)", () => {
  it("renders one row per aggregate, count with no column select", () => {
    renderSection("aggregate-per-area", {
      rows: [{ op: "count", column: null }],
    });
    expect(screen.getByLabelText("Aggregate 1")).toHaveValue("count");
    expect(screen.queryByLabelText("Column 1")).not.toBeInTheDocument();
  });

  it("offers the source's NUMERIC columns beside a sum", () => {
    renderSection("aggregate-per-area", {
      rows: [{ op: "sum", column: "roof_area_m2" }],
    });
    expect(screen.getByLabelText("Column 1")).toHaveValue("roof_area_m2");
    expect(
      screen.getByRole("option", { name: "b3_h_dak_max" }),
    ).toBeInTheDocument();
  });

  it("shows the unfilled column select's own sentence (§7.6)", () => {
    // Reachable when the source layer has no numeric column at all. The select
    // must not render its first option as if it were chosen — the bag says
    // null, and `crossLayerParamsError` blocks Run with the same sentence.
    renderSection(
      "aggregate-per-area",
      { rows: [{ op: "sum", column: null }] },
      { numericColumns: [] },
    );
    expect(screen.getByLabelText("Column 1")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "Choose a column to summarise" }),
    ).toBeInTheDocument();
  });

  it("adds and removes rows", async () => {
    const onChange = renderSection("aggregate-per-area", {
      proxy: "footprint",
      predicate: "intersects",
      rows: [{ op: "count", column: null }],
    });
    await userEvent.click(
      screen.getByRole("button", { name: "+ Add aggregate" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rows: [
          { op: "count", column: null },
          { op: "count", column: null },
        ],
      }),
    );
  });
});
```

- [ ] **Step 8: Write the form section**

Create `src/ui/processing/CrossLayerParams.tsx`:

```tsx
/**
 * §7.5, §7.6 and §7.7's PARAMETERS, in ONE component.
 *
 * Three tools and one file, for the reason `crossLayerParams.ts` is one module:
 * they share the building-geometry radio and the predicate, and three files
 * would be three places for the disabled-option rule to drift. `ToolView`'s
 * dispatch is one branch on the tool's GROUP rather than three on its id.
 *
 * A `{ params, onChange }` sibling of `RoofMetricsParams`: no store access, the
 * bag normalised on the way in by the hook and written back WHOLE on every
 * change — which is what makes "untick everything" a state the form can reach.
 * Everything else it needs (the proxies the target can offer, the source's
 * property keys and types, the city layer's numeric columns) is a prop, because
 * they are facts about two other layers and this component should not be the
 * third place that looks them up.
 */
import { useState } from "react";
import type { ProxyOption } from "../../features/processing/buildingProxy";
import {
  aggregateParams,
  distanceParams,
  joinParams,
  type AggregateOp,
  type JoinPredicate,
  type JoinTie,
} from "../../features/processing/crossLayerParams";
import type { ToolId } from "../../features/processing/types";
import type { ColumnType } from "../../insights/computedColumns";

/** §7.5's three predicates, in §7.5's order, with its own parentheticals as
 *  the option's tooltip. */
const PREDICATES: ReadonlyArray<{
  readonly key: JoinPredicate;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    key: "intersects",
    label: "Intersects",
    hint: "Touching a boundary counts",
  },
  {
    key: "within",
    label: "Within",
    hint: "The whole proxy inside the area, boundary included",
  },
  {
    key: "centreWithin",
    label: "Centre within",
    hint: "Forces the centre proxy",
  },
];

const TIES: ReadonlyArray<{ readonly key: JoinTie; readonly label: string }> = [
  { key: "first", label: "First (by source order)" },
  { key: "largestOverlap", label: "Largest overlap" },
  { key: "countOnly", label: "Count only" },
];

const OPS: ReadonlyArray<AggregateOp> = ["count", "sum", "mean", "min", "max"];

/** §6: the pair that cannot combine, disabled with that text. */
const NEEDS_AREA_PROXY = "Largest overlap needs a footprint or rectangle";
/** §7.5's field-checklist search appears past this many properties. */
const SEARCH_AT = 12;

export function CrossLayerParams({
  toolId,
  params,
  onChange,
  proxies,
  sourcePropertyKeys,
  sourcePropertyTypes,
  sourceHasFeatureIds,
  numericColumns,
}: {
  readonly toolId: ToolId;
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly proxies: ReadonlyArray<ProxyOption>;
  readonly sourcePropertyKeys: ReadonlyArray<string>;
  readonly sourcePropertyTypes: ReadonlyMap<string, ColumnType>;
  readonly sourceHasFeatureIds: boolean;
  readonly numericColumns: ReadonlyArray<string>;
}) {
  const [search, setSearch] = useState("");
  const proxy =
    toolId === "distance-to-nearest"
      ? distanceParams(params).proxy
      : toolId === "aggregate-per-area"
        ? aggregateParams(params).proxy
        : joinParams(params).proxy;
  const footprintNote = proxies.find((o) => !o.available)?.note ?? null;

  return (
    <>
      <div className="processing-field">
        <span>Building geometry</span>
        <div
          className="processing-radios"
          role="radiogroup"
          aria-label="Building geometry"
        >
          {proxies.map((option) => (
            <label key={option.key} title={option.note ?? undefined}>
              <input
                type="radio"
                name="proxy"
                disabled={!option.available}
                checked={proxy === option.key}
                onChange={() => onChange({ ...params, proxy: option.key })}
              />
              {option.label}
            </label>
          ))}
        </div>
        {footprintNote !== null && (
          <p className="processing-note">{footprintNote}</p>
        )}
      </div>
      {toolId === "join-by-location" && (
        <JoinFields
          params={params}
          onChange={onChange}
          keys={sourcePropertyKeys}
          types={sourcePropertyTypes}
          search={search}
          setSearch={setSearch}
        />
      )}
      {toolId === "distance-to-nearest" && (
        <DistanceFields
          params={params}
          onChange={onChange}
          keys={sourcePropertyKeys}
          hasFeatureIds={sourceHasFeatureIds}
        />
      )}
      {toolId === "aggregate-per-area" && (
        <AggregateFields
          params={params}
          onChange={onChange}
          numericColumns={numericColumns}
        />
      )}
    </>
  );
}

function PredicateSelect({
  value,
  onPick,
}: {
  readonly value: JoinPredicate;
  readonly onPick: (next: JoinPredicate) => void;
}) {
  return (
    <label className="processing-field">
      <span>Predicate</span>
      <select
        aria-label="Predicate"
        value={value}
        onChange={(e) => onPick(e.target.value as JoinPredicate)}
      >
        {/* §7.5's own parentheticals are the options' titles — including
            "forces the centre proxy", which is the whole of what the reader
            needs to know about `centre within` and is the spec's own wording.
            No second sentence is invented under the select for it. */}
        {PREDICATES.map((option) => (
          <option key={option.key} value={option.key} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function JoinFields({
  params,
  onChange,
  keys,
  types,
  search,
  setSearch,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly keys: ReadonlyArray<string>;
  readonly types: ReadonlyMap<string, ColumnType>;
  readonly search: string;
  readonly setSearch: (next: string) => void;
}) {
  const current = joinParams(params);
  const ticked = new Set(current.fields);
  const shown =
    keys.length > SEARCH_AT && search.trim() !== ""
      ? keys.filter((k) =>
          k.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : keys;
  return (
    <>
      <PredicateSelect
        value={current.predicate}
        onPick={(predicate) => onChange({ ...params, predicate })}
      />
      <div className="processing-field">
        <span>Fields to copy</span>
        {keys.length > SEARCH_AT && (
          <input
            type="search"
            aria-label="Search fields"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div className="processing-checks">
          {shown.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={ticked.has(key)}
                onChange={() =>
                  onChange({
                    ...params,
                    // Rebuilt from the SOURCE order, not click order: §6.2's
                    // "first copied TEXT field" depends on it.
                    fields: keys.filter((k) =>
                      k === key ? !ticked.has(k) : ticked.has(k),
                    ),
                  })
                }
              />
              {key}
              <span className="processing-note">
                {" "}
                {types.get(key) ?? "VARCHAR"}
              </span>
            </label>
          ))}
        </div>
      </div>
      <label className="processing-field">
        <span>When several areas match</span>
        <select
          aria-label="When several areas match"
          value={current.tie}
          onChange={(e) => {
            const tie = e.target.value as JoinTie;
            onChange({
              ...params,
              tie,
              // §7.5: "count only" "writes no fields and forces the match
              // count on".
              writeMatchCount:
                tie === "countOnly" ? true : current.writeMatchCount,
            });
          }}
        >
          {TIES.map((option) => (
            <option
              key={option.key}
              value={option.key}
              // §6: "a proxy/predicate pair that cannot combine … disables the
              // option with that text".
              disabled={
                option.key === "largestOverlap" && current.proxy === "centre"
              }
              title={
                option.key === "largestOverlap" && current.proxy === "centre"
                  ? NEEDS_AREA_PROXY
                  : undefined
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={current.writeMatchCount}
          disabled={current.tie === "countOnly"}
          onChange={() =>
            onChange({ ...params, writeMatchCount: !current.writeMatchCount })
          }
        />
        Also write the match count
      </label>
    </>
  );
}

function DistanceFields({
  params,
  onChange,
  keys,
  hasFeatureIds,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly keys: ReadonlyArray<string>;
  readonly hasFeatureIds: boolean;
}) {
  const current = distanceParams(params);
  return (
    <>
      <label className="processing-field">
        <span>Max search distance (m)</span>
        <input
          type="number"
          aria-label="Max search distance (m)"
          min={0}
          step="any"
          value={current.maxDistanceM}
          onChange={(e) =>
            onChange({ ...params, maxDistanceM: Number(e.target.value) })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={current.writeNearestId}
          onChange={() =>
            onChange({ ...params, writeNearestId: !current.writeNearestId })
          }
        />
        Also write the nearest feature&apos;s id
      </label>
      {current.writeNearestId && (
        <label className="processing-field">
          <span>Nearest feature&apos;s id</span>
          <select
            aria-label="Nearest feature's id"
            value={current.nearestIdProperty ?? ""}
            onChange={(e) =>
              onChange({
                ...params,
                nearestIdProperty:
                  e.target.value === "" ? null : e.target.value,
              })
            }
          >
            {/* §7.7: the feature's OWN id, offered only when the source has
                one. Its value is the empty string, which is `null` in the bag
                — the same spelling `distanceParams` reads. */}
            {hasFeatureIds && <option value="">The feature&apos;s id</option>}
            {!hasFeatureIds && (
              // §7.7's own sentence for this state, verbatim.
              <option value="">Choose the property to copy</option>
            )}
            {keys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function AggregateFields({
  params,
  onChange,
  numericColumns,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly numericColumns: ReadonlyArray<string>;
}) {
  const current = aggregateParams(params);
  const replace = (
    index: number,
    next: { readonly op: AggregateOp; readonly column: string | null },
  ) =>
    onChange({
      ...params,
      rows: current.rows.map((row, i) => (i === index ? next : row)),
    });
  return (
    <>
      <PredicateSelect
        value={current.predicate}
        onPick={(predicate) => onChange({ ...params, predicate })}
      />
      {current.rows.map((row, index) => (
        // The rows are an ORDERED list the user edits in place; the index IS
        // the identity (two `sum`s of one column are a real, flagged state).
        <div key={index} className="processing-field">
          <select
            aria-label={`Aggregate ${index + 1}`}
            value={row.op}
            onChange={(e) => {
              const op = e.target.value as AggregateOp;
              replace(index, {
                op,
                column:
                  op === "count"
                    ? null
                    : (row.column ?? numericColumns[0] ?? null),
              });
            }}
          >
            {OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          {row.op !== "count" && (
            <select
              aria-label={`Column ${index + 1}`}
              value={row.column ?? ""}
              onChange={(e) =>
                replace(index, {
                  op: row.op,
                  column: e.target.value === "" ? null : e.target.value,
                })
              }
            >
              {/* A row with no column is a REAL state — a source layer with no
                  numeric column has nothing to offer — and a controlled select
                  whose value matches no option renders the first one instead,
                  which would show a column the bag does not carry. The
                  placeholder is the same sentence the blocking error uses.
                  **[adapted copy A17]** */}
              {row.column === null && (
                <option value="">Choose a column to summarise</option>
              )}
              {numericColumns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            aria-label={`Remove aggregate ${index + 1}`}
            onClick={() =>
              onChange({
                ...params,
                rows: current.rows.filter((_, i) => i !== index),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...params,
            rows: [...current.rows, { op: "count", column: null }],
          })
        }
      >
        + Add aggregate
      </button>
    </>
  );
}
```

- [ ] **Step 9: The hook learns the second layer**

Replace `src/ui/processing/useToolForm.ts`'s body from the imports down. The parts that do not appear below — the `PREFIX_RE` constant, the module doc comment, the LoD default rule, the streaming note — are unchanged, and **every field Task 5 added to the returned object stays in it** (`workloadNote` is spelled out below for exactly that reason: `ToolView` renders it, and a rewrite that dropped it would take §6's "Re-reads a 180 MB source…" note off the screen and fail `tsc`). Everything else is:

```ts
import { useMemo } from "react";
import { useLayerStore, type Layer } from "../../features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../../features/geoLayers/geoLayerStore";
import { geoRecords } from "../../features/geoLayers/geoRecords";
import { useLayerCounts } from "../table/useLayerCounts";
import {
  computedColumnsOf,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import { toolEligibility } from "../../features/processing/eligibility";
import { proxyOptions } from "../../features/processing/buildingProxy";
import {
  crossLayerParamsError,
  numericColumnsOf,
  resolveCrossLayerParams,
  slugifyField,
  POLYGONAL_KINDS,
  SOURCE_NEEDS_AREAS,
  TARGET_NEEDS_AREAS,
  type CrossLayerContext,
} from "../../features/processing/crossLayerParams";
import {
  documentGeometryKinds,
  documentHasFeatureIds,
  documentHasFeatures,
  geoPropertyTypes,
} from "../../features/processing/vectorSource";
import { sourceWorkloadNote } from "../../features/processing/sourceRead";
import type { ToolId } from "../../features/processing/types";
import {
  eligibilityContextFor,
  useEligibilityInputs,
} from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { useLodOptions } from "./useLodOptions";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";

/** One row of the TARGET or SOURCE select. */
export interface LayerOption {
  readonly id: string;
  readonly name: string;
  readonly disabled: boolean;
  /** §5's reason, as the row's tooltip and as Run's reason. */
  readonly reason: string | null;
}

/** Does the document carry at least one area (§7.5, §7.6)? */
function hasAreas(layer: GeoJsonLayer): boolean {
  return [...documentGeometryKinds(layer.config.preparedData)].some((kind) =>
    POLYGONAL_KINDS.has(kind),
  );
}

/**
 * Why a vector layer cannot be this tool's SOURCE, or null.
 *
 * IN THE SPEC'S OWN ORDER, and the order is the whole of it: a layer that is
 * still loading, or that failed, has no document to ask about geometry — and
 * asking anyway answers "no polygons", which would put "Needs areas
 * (polygons)" on a layer that is full of them. So preparation first
 * (**[adapted copy A4]**, the same two sentences `eligibility.ts` says about a
 * vector TARGET), then §7.5/§7.7's empty-source sentence, and only then the
 * geometry kind §7.5 needs.
 */
function vectorSourceReason(
  layer: GeoJsonLayer,
  toolId: ToolId,
): string | null {
  const preparation = layer.config.preparation;
  if (preparation === "loading") return "This vector layer is still loading";
  if (preparation === "failed") return "This vector layer could not be loaded";
  if (!documentHasFeatures(layer.config.preparedData)) {
    return "The source layer has no features";
  }
  if (SOURCE_NEEDS_AREAS.has(toolId) && !hasAreas(layer)) {
    return "Needs areas (polygons)";
  }
  return null;
}

export function useToolForm(toolId: ToolId) {
  const tool = toolById(toolId);
  const active = useActiveLayer();
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const inputs = useEligibilityInputs();
  const { tables } = inputs;
  const drafts = useProcessingStore((s) => s.drafts);
  const runs = useProcessingStore((s) => s.runs);
  useComputedColumnStore((s) => s.byLayer); // subscribe: the replace warning depends on it

  const vectorCandidates = useMemo(
    () => geoLayers.filter((l): l is GeoJsonLayer => l.kind === "geojson"),
    [geoLayers],
  );
  // Spec §6: the select lists "only layers the tool can target", which is the
  // tool's whole eligibility, not just "the table is ready". `candidates` keeps
  // the wider list so an UNIMPLEMENTED tool (every eligibility fails) still
  // opens on a layer rather than on a blank select.
  const candidates = useMemo(
    () => layers.filter((l) => tables[l.id]?.state === "ready"),
    [layers, tables],
  );
  const eligibleTargets = useMemo(
    () =>
      candidates.filter(
        (l) =>
          toolEligibility(
            tool,
            eligibilityContextFor({ kind: "city", layer: l }, inputs),
          ).ok,
      ),
    [candidates, inputs, tool],
  );
  const eligibleVectorTargets = useMemo(
    () =>
      vectorCandidates.filter(
        (l) =>
          toolEligibility(
            tool,
            eligibilityContextFor({ kind: "geo", layer: l }, inputs),
          ).ok,
      ),
    [vectorCandidates, inputs, tool],
  );

  const stored = drafts[toolId];
  const vectorTargeted = tool.target === "vector";
  const preferred = vectorTargeted
    ? eligibleVectorTargets.length > 0
      ? eligibleVectorTargets
      : vectorCandidates
    : eligibleTargets.length > 0
      ? eligibleTargets
      : candidates;
  const activeIsTargetKind =
    active !== null &&
    (vectorTargeted ? active.kind === "geo" : active.kind === "city");
  const defaultTarget =
    activeIsTargetKind && preferred.some((l) => l.id === active.layer.id)
      ? active.layer.id
      : (preferred[0]?.id ?? null);
  const allIds = useMemo(
    () => new Set([...layers.map((l) => l.id), ...geoLayers.map((l) => l.id)]),
    [layers, geoLayers],
  );
  const storedTargetExists =
    stored !== undefined &&
    stored.targetLayerId !== null &&
    allIds.has(stored.targetLayerId);
  const base: ToolDraft =
    stored === undefined
      ? {
          targetLayerId: defaultTarget,
          sourceLayerId: null,
          scope: "all",
          lod: null,
          prefix: tool.defaultPrefix,
          params: {},
        }
      : storedTargetExists
        ? stored
        : // The stored target is gone, so the form retargets itself — and the
          // LoD it carried was a statement about THAT layer.
          { ...stored, targetLayerId: defaultTarget, lod: null };

  // The TARGET, in whichever store it lives.
  const target: Layer | null = vectorTargeted
    ? null
    : (layers.find((l) => l.id === base.targetLayerId) ?? null);
  const vectorTarget: GeoJsonLayer | null = vectorTargeted
    ? (vectorCandidates.find((l) => l.id === base.targetLayerId) ?? null)
    : null;
  const targetLayerId = vectorTargeted
    ? (vectorTarget?.id ?? null)
    : (target?.id ?? null);
  const targetName = vectorTargeted
    ? (vectorTarget?.name ?? null)
    : (target?.name ?? null);
  const targetOptions: ReadonlyArray<LayerOption> = useMemo(() => {
    const rows = (vectorTargeted ? eligibleVectorTargets : eligibleTargets).map(
      (l) => ({
        id: l.id,
        name: l.name,
        disabled:
          vectorTargeted && TARGET_NEEDS_AREAS.has(toolId)
            ? !hasAreas(l as GeoJsonLayer)
            : false,
        // §7.6: a point or line layer is listed DISABLED with this reason.
        reason:
          vectorTargeted &&
          TARGET_NEEDS_AREAS.has(toolId) &&
          !hasAreas(l as GeoJsonLayer)
            ? "Needs areas (polygons)"
            : null,
      }),
    );
    // §5: "a disabled row still opens the tool view", so a target the user has
    // already chosen stays in the select even when the tool cannot run on it.
    const chosen = vectorTargeted ? vectorTarget : target;
    return chosen !== null && !rows.some((r) => r.id === chosen.id)
      ? [
          ...rows,
          { id: chosen.id, name: chosen.name, disabled: false, reason: null },
        ]
      : rows;
  }, [
    vectorTargeted,
    eligibleVectorTargets,
    eligibleTargets,
    toolId,
    vectorTarget,
    target,
  ]);

  // The SOURCE: §7.5/§7.7 want a vector layer, §7.6 a city layer.
  const sourceOptions: ReadonlyArray<LayerOption> = useMemo(() => {
    if (tool.sourceKind === "vector") {
      return vectorCandidates.map((l) => {
        const reason = vectorSourceReason(l, toolId);
        return { id: l.id, name: l.name, disabled: reason !== null, reason };
      });
    }
    if (tool.sourceKind === "city") {
      return candidates.map((l) => ({
        id: l.id,
        name: l.name,
        disabled: false,
        reason: null,
      }));
    }
    return [];
  }, [tool.sourceKind, toolId, vectorCandidates, candidates]);
  const storedSourceValid =
    base.sourceLayerId !== null &&
    sourceOptions.some((o) => o.id === base.sourceLayerId);
  const sourceLayerId = storedSourceValid
    ? base.sourceLayerId
    : (sourceOptions.find((o) => !o.disabled)?.id ?? null);
  const sourceGeo =
    tool.sourceKind === "vector"
      ? (vectorCandidates.find((l) => l.id === sourceLayerId) ?? null)
      : null;
  const sourceDocument = sourceGeo?.config.preparedData;
  const sourceRecords = useMemo(
    () => (sourceDocument === undefined ? [] : geoRecords(sourceDocument)),
    [sourceDocument],
  );
  const sourcePropertyTypes = useMemo(
    () => geoPropertyTypes(sourceRecords),
    [sourceRecords],
  );
  const sourcePropertyKeys = useMemo(
    () => [...sourcePropertyTypes.keys()],
    [sourcePropertyTypes],
  );
  const sourceHasFeatureIds = useMemo(
    () => documentHasFeatureIds(sourceDocument),
    [sourceDocument],
  );

  // The layer whose TABLE, LoD ladder and scope counts the form reads — the
  // same thing the queue calls `computeLayerId`. §7.6: "Scope applies to the
  // SOURCE buildings", so Aggregate's radios count the CITY layer.
  const cityLayer: Layer | null = vectorTargeted
    ? (layers.find((l) => l.id === sourceLayerId) ?? null)
    : target;
  const cityTableState = cityLayer ? tables[cityLayer.id] : undefined;
  const cityTable =
    cityTableState !== undefined && cityTableState.state === "ready"
      ? cityTableState.info
      : null;

  const lods = useLodOptions(tool, target);
  const qualifies = (lod: string | null): boolean =>
    lod !== null && lods.options.some((o) => o.lod === lod);
  const defaultLod = qualifies(target?.selectedLod ?? null)
    ? (target?.selectedLod ?? null)
    : (lods.options[0]?.lod ?? null);
  const lod = qualifies(base.lod) ? base.lod : defaultLod;
  // §7.5 and §7.7: "OUTPUT prefix defaults to the source layer name slugified
  // (`zones_`)" — `roads_distance_m`, `zones_matches_n`. It depends on the
  // SOURCE, which is resolved just above, so it is derived here rather than
  // stored: a stored default would freeze against a later source change, and
  // `setDraft` below keeps the RAW prefix for that reason. A slug that §6's own
  // prefix rule would reject (one starting with a digit) falls back to the
  // tool's default rather than opening the form on an invalid value.
  const sourceName =
    sourceOptions.find((o) => o.id === sourceLayerId)?.name ?? null;
  const slug = sourceName === null ? null : `${slugifyField(sourceName)}_`;
  const sourcePrefix =
    tool.sourceKind === "vector" && slug !== null && PREFIX_RE.test(slug)
      ? slug
      : tool.defaultPrefix;
  // Applied only to a draft still on the tool's own default, never over a
  // prefix the user typed. (Clearing the field therefore re-offers the source's
  // prefix, which is what the form opened with.)
  const prefix =
    base.prefix === tool.defaultPrefix ? sourcePrefix : base.prefix;
  const draft: ToolDraft = { ...base, sourceLayerId, lod, prefix };

  const counts = useLayerCounts(cityLayer?.id ?? null);
  const noFilter = useQueryStore((s) =>
    cityLayer === null ? true : layerQuery(s, cityLayer.id).applied === null,
  );

  const targetCtx = eligibilityContextFor(
    vectorTargeted
      ? vectorTarget
        ? { kind: "geo", layer: vectorTarget }
        : null
      : target
        ? { kind: "city", layer: target }
        : null,
    inputs,
  );
  const eligibility = toolEligibility(tool, targetCtx);

  // §7.5's defaults need the SOURCE's keys and the TARGET's table, so they are
  // resolved here rather than written into the store from a render.
  const crossCtx: CrossLayerContext = {
    table: cityTable,
    sourcePropertyKeys,
    sourcePropertyTypes,
    sourceHasFeatureIds,
    numericColumns: numericColumnsOf(cityTable),
  };
  const crossLayer = tool.group === "cross-layer";
  const params = crossLayer
    ? resolveCrossLayerParams(toolId, draft.params, crossCtx)
    : draft.params;
  // TWO arguments (Decisions item 6 (iii)): for Join the copied fields' types
  // are already inside `params`, put there by `resolveCrossLayerParams`.
  const columns = tool.outputColumns?.(draft.prefix, params) ?? [];

  // §6's "belongs to the source data" is about the TARGET's own attributes: a
  // city layer's table columns, a vector layer's public property keys.
  const existingNames = vectorTargeted
    ? [
        ...new Set(
          geoRecords(vectorTarget?.config.preparedData).flatMap((r) =>
            Object.keys(r),
          ),
        ),
      ]
    : cityTable !== null && !vectorTargeted && target !== null
      ? cityTable.columns.map((c) => c.name)
      : [];
  const computed =
    targetLayerId === null
      ? new Set<string>()
      : computedColumnsOf(targetLayerId);
  // DuckDB identifiers are CASE-INSENSITIVE, so "EXTENT_height_m" and
  // "extent_height_m" are one column.
  const onTable = new Map(
    existingNames.map((name) => [name.toLowerCase(), name]),
  );
  const computedLower = new Set([...computed].map((c) => c.toLowerCase()));
  const existing = columns.filter((c) => onTable.has(c.name.toLowerCase()));
  const sourceCollisions = existing
    .filter((c) => !computedLower.has(c.name.toLowerCase()))
    .map((c) => onTable.get(c.name.toLowerCase()) ?? c.name);
  const prefixError = !PREFIX_RE.test(draft.prefix)
    ? "Use letters, digits and underscores, starting with a letter"
    : sourceCollisions.length > 0
      ? `'${sourceCollisions[0]}' belongs to the source data; choose another prefix`
      : null;
  const paramsError = crossLayer
    ? crossLayerParamsError(toolId, params, crossCtx)
    : (tool.validateParams?.(draft.params) ?? null);
  const ext = tool.extension;
  const extensionNote =
    ext !== null && targetCtx.extensionState[ext] !== "loaded"
      ? `Loads the ${ext} extension on first run (about ${ext === "spatial" ? "24 MB" : "1 MB"}, once per session).`
      : null;

  // §7.6: an empty TARGET disables Run with its own sentence; §7.5/§7.7: an
  // empty SOURCE with theirs. A source row that is disabled says why here too,
  // because §5's rule is that Run repeats the row's reason.
  const targetReason =
    vectorTargeted && vectorTarget !== null && !hasAreas(vectorTarget)
      ? "The layer has no areas"
      : null;
  // §5's rule is that Run repeats the chosen row's own reason, and
  // `vectorSourceReason` has already asked the questions in the spec's order
  // (still loading / could not be loaded / no features / needs areas), so there
  // is exactly one producer of each sentence.
  const chosenSourceOption =
    sourceOptions.find((o) => o.id === sourceLayerId) ?? null;
  const sourceReason = chosenSourceOption?.reason ?? null;

  const scopeCount =
    draft.scope === "all"
      ? counts.all
      : draft.scope === "matching"
        ? counts.matching
        : counts.selected;
  const scopeReason =
    draft.scope === "matching" && noFilter
      ? "No filter applied"
      : draft.scope === "selected" && !(counts.selected && counts.selected > 0)
        ? "Nothing selected on this layer"
        : scopeCount === 0
          ? "Nothing to run on (0 buildings)"
          : null;
  // Precedence, top to bottom: what the TOOL cannot do here (eligibility), what
  // the TARGET and the SOURCE cannot offer, then the things the user can fix in
  // the form — the prefix, the parameters, the scope.
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (lods.emptyReason ??
      targetReason ??
      sourceReason ??
      prefixError ??
      paramsError ??
      scopeReason);
  const latestRun =
    runs.find(
      (r) => r.toolId === toolId && r.targetLayerId === targetLayerId,
    ) ?? null;
  const running =
    runs.find((r) => r.status === "running" || r.status === "cancelling") ??
    null;
  const queuedBehind =
    running !== null && running.id !== latestRun?.id
      ? toolById(running.toolId).name
      : null;
  return {
    tool,
    draft,
    params,
    eligibleTargets,
    target,
    vectorTarget,
    targetLayerId,
    targetName,
    targetOptions,
    sourceOptions,
    sourceLayerId,
    sourceReason,
    sourcePropertyKeys,
    sourcePropertyTypes,
    sourceHasFeatureIds,
    cityLayer,
    cityTable,
    proxies: cityTable === null ? [] : proxyOptions(cityTable),
    numericColumns: crossCtx.numericColumns,
    lodOptions: lods.options,
    lodNoun: lods.noun,
    lodReason: lods.emptyReason,
    counts,
    noFilter,
    columns,
    existing,
    prefixError,
    paramsError,
    extensionNote,
    // Task 5's expression, KEPT — `ToolView` renders it and this task rewrites
    // the hook. Only the TABLE is adjusted: the note is about the layer whose
    // SOURCE the run re-reads, which for Aggregate is the city SOURCE and not
    // the vector target. `cityTable` is that table under both directions, and
    // for every one-layer tool it is the target's own table, exactly as Task 5
    // wrote it.
    //
    // Task 5's `tool.needsReader` GUARD is kept too, and widened rather than
    // dropped: a warning about a read that will not happen is a false alarm,
    // and the three cross-layer tools declare `needsReader: false` because
    // their source read is OPTIONAL — only the footprint proxy re-reads. So the
    // same question is asked of the resolved proxy, and a run on the extent
    // rectangle or the extent centre shows no note at all.
    workloadNote:
      cityTable !== null &&
      (tool.needsReader || params["proxy"] === "footprint")
        ? sourceWorkloadNote(cityTable)
        : null,
    eligibility,
    canRun: runReason === null && targetLayerId !== null,
    runReason,
    latestRun,
    queuedBehind,
    setDraft: (patch: Partial<ToolDraft>) => {
      // A LoD is a statement about ONE layer, so changing the target drops it.
      // The PARAMETERS are a statement about the SOURCE (which fields to copy,
      // which property to write) as well as the target (the proxy), so changing
      // either drops them and the defaults re-apply on the next render.
      const retarget =
        patch.targetLayerId !== undefined &&
        patch.targetLayerId !== draft.targetLayerId;
      const resource =
        patch.sourceLayerId !== undefined &&
        patch.sourceLayerId !== draft.sourceLayerId;
      useProcessingStore.getState().setDraft(toolId, {
        ...draft,
        // The DERIVED prefix is never stored: it is a function of the source,
        // and storing it would freeze it against the next source change. What
        // is stored is the RAW prefix — the tool's default until the user types
        // one.
        prefix: base.prefix,
        ...(retarget ? { lod: null } : {}),
        ...(retarget || resource ? { params: {} } : {}),
        ...patch,
      });
    },
  };
}
```

- [ ] **Step 10: `ToolView` grows a SOURCE field and the PARAMETERS branch**

In `src/ui/processing/ToolView.tsx`, add `import { CrossLayerParams } from "./CrossLayerParams";`, and:

The TARGET select's options now come from the hook (delete the local `chosen`/`targetOptions` block above `run`):

```tsx
<label className="processing-field">
  <span>Layer</span>
  <select
    aria-label="Layer"
    value={f.targetLayerId ?? ""}
    onChange={(e) => f.setDraft({ targetLayerId: e.target.value })}
  >
    {f.targetOptions.map((option) => (
      <option
        key={option.id}
        value={option.id}
        disabled={option.disabled}
        title={option.reason ?? undefined}
      >
        {option.name}
      </option>
    ))}
  </select>
</label>;
{
  /* §6's TARGET section carries the SOURCE select for a cross-layer
            tool; a disabled row keeps §5's reason as its tooltip, and Run
            repeats it under the button. */
}
{
  f.tool.sourceKind !== null && (
    <label className="processing-field">
      <span>Source</span>
      <select
        aria-label="Source"
        value={f.sourceLayerId ?? ""}
        onChange={(e) => f.setDraft({ sourceLayerId: e.target.value })}
      >
        {f.sourceOptions.map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={option.disabled}
            title={option.reason ?? undefined}
          >
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

Under the scope radios, beside the streaming note:

```tsx
{
  f.tool.target === "vector" && (
    // **[adapted copy A12]** — Decisions recorded item 4: the radios
    // stay under TARGET and say which layer they count (§7.6: "Scope
    // applies to the SOURCE buildings").
    <p className="processing-note">
      Scope applies to the source layer&apos;s buildings.
    </p>
  );
}
```

The PARAMETERS dispatch gains one branch beside the `roof-metrics` one:

```tsx
{
  f.tool.group === "cross-layer" && (
    <fieldset className="processing-section" disabled={locked}>
      <legend className="processing-group__label">PARAMETERS</legend>
      <CrossLayerParams
        toolId={toolId}
        params={f.params}
        onChange={(params) => f.setDraft({ params })}
        proxies={f.proxies}
        sourcePropertyKeys={f.sourcePropertyKeys}
        sourcePropertyTypes={f.sourcePropertyTypes}
        sourceHasFeatureIds={f.sourceHasFeatureIds}
        numericColumns={f.numericColumns}
      />
      {f.paramsError !== null && (
        <p className="processing-error" role="alert">
          {f.paramsError}
        </p>
      )}
    </fieldset>
  );
}
```

The OUTPUT section's "This layer" label reads the hook's name, and the column list prints the typed columns:

```tsx
              <input type="radio" name="writeTo" checked readOnly disabled />
              This layer{f.targetName === null ? "" : ` (${f.targetName})`}
```

```tsx
<p className="processing-columns">{f.columns.map((c) => c.name).join(", ")}</p>
```

And `run()` submits both layers and the RESOLVED parameters:

```tsx
const run = () => {
  if (f.targetLayerId === null || !f.canRun) return;
  submitRun({
    toolId,
    targetLayerId: f.targetLayerId,
    sourceLayerId: f.sourceLayerId,
    scope: f.draft.scope,
    lod: f.draft.lod,
    // §6.1 freezes "everything the run needs" and §6.4 makes the log the
    // reproducible record of it, so what is frozen is the RESOLVED bag —
    // including the building-geometry proxy the form showed.
    params: f.tool.normaliseParams?.(f.params) ?? f.params,
    prefix: f.draft.prefix,
    columns: f.columns,
  });
};
```

- [ ] **Step 11: Extend the hook's suite**

Append to `tests/unit/ui/processing/useToolForm.test.tsx`. That file drives the
hook by RENDERING `<ToolView />` (it mocks `insights/duckdb`, `runQueue` and
`useLayerCounts`, and its `toolRegistry` mock already flips one tool on), so
these follow the same shape. Add the two geo fixtures beside its
`addCityLayer` helper, and add `join-by-location`, `distance-to-nearest` and
`aggregate-per-area` to the ids its `toolRegistry` mock switches on:

```tsx
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");

/** A polygon layer and a point layer, so §7.5's source select can refuse one. */
function addGeoLayer(name: string, kind: "Polygon" | "Point"): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name,
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: `${name}-1`,
            properties: { zone: "A" },
            geometry:
              kind === "Polygon"
                ? {
                    type: "Polygon",
                    coordinates: [
                      [
                        [4, 52],
                        [5, 52],
                        [5, 53],
                        [4, 52],
                      ],
                    ],
                  }
                : { type: "Point", coordinates: [4, 52] },
          },
        ],
      },
    },
  });
}

describe("the SOURCE select and the prefix it names (§7.5, §7.7)", () => {
  it("lists the vector layers and disables a point layer", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    addGeoLayer("Points", "Point");
    render(<ToolView toolId="join-by-location" />);
    const select = screen.getByRole("combobox", { name: "Source" });
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual(["Zones", "Points"]);
    // §7.5: a point layer is listed DISABLED with its reason.
    expect(options[1]).toBeDisabled();
    expect(options[1]).toHaveAttribute("title", "Needs areas (polygons)");
    // The first ELIGIBLE row is the one chosen.
    expect(select).toHaveValue(options[0]?.getAttribute("value"));
  });

  it("prefills the prefix from the source layer's slugified name", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(screen.getByLabelText("Prefix")).toHaveValue("zones_");
  });

  it("resolves the target's own default proxy, which the log then names", () => {
    // The fixture's ready table has a reader; give it an LoD 0 rung and §7.5's
    // default is the footprint, which is what the frozen bag must carry.
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
  });

  it("warns about a large source only when the PROXY will re-read it", () => {
    // Task 5 guarded the note with `tool.needsReader`, and the three
    // cross-layer tools declare `needsReader: false` because their source read
    // is OPTIONAL — only the footprint proxy re-reads. So the guard follows the
    // resolved proxy here, and the note is about the CITY layer (§7.6's
    // Aggregate re-reads the source's buildings, never the vector target).
    const id = addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    useLayerTableStore.setState((state) => {
      const entry = state.tables[id];
      if (entry?.state !== "ready") return state;
      return {
        tables: {
          ...state.tables,
          [id]: {
            ...entry,
            info: { ...entry.info, sourceBytes: 180_000_000 },
          },
        },
      };
    });
    render(<ToolView toolId="join-by-location" />);
    // The fixture's table has an LoD 0 rung, so the default proxy IS the
    // footprint (the case above) and §6's note is due, verbatim.
    expect(
      screen.getByText(
        "Re-reads a 180 MB source; this can take a minute and needs memory",
      ),
    ).toBeInTheDocument();

    // Switch to a proxy that reads the browsing table's `bbox` and nothing
    // else: no read, no note. A warning about a read that will not happen is
    // the false alarm Task 5's guard exists to prevent.
    fireEvent.click(screen.getByRole("radio", { name: "Extent rectangle" }));
    expect(screen.queryByText(/Re-reads a/)).toBeNull();
  });

  it("counts the SOURCE city layer's buildings for Aggregate (§7.6)", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="aggregate-per-area" />);
    // The TARGET select lists the vector layer; the scope radios count Delft.
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveTextContent(
      "Zones",
    );
    expect(screen.getByLabelText(/All 2 buildings/)).toBeInTheDocument();
    expect(
      screen.getByText("Scope applies to the source layer's buildings."),
    ).toBeInTheDocument();
  });

  it("freezes the proxy the form SHOWED, through `normaliseParams`", () => {
    // The registry's `normaliseParams` re-resolves the already-resolved bag
    // with a context that has no table. If that pass narrowed the proxy, the
    // run submitted here would be a CENTRE join while the form said footprint
    // — and §6.4's log would name a proxy that was never used. The assertion is
    // on the request the mocked `submitRun` actually received.
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "join-by-location",
        params: expect.objectContaining({ proxy: "footprint" }),
      }),
    );
  });

  it("says why a source row is unusable, in §7.5's own order", () => {
    // A layer whose document is still loading has no geometry to ask about, so
    // "Needs areas (polygons)" would be a sentence about a fact nobody knows.
    addCityLayer("Delft", true);
    const loading = useGeoLayerStore.getState().addGeoLayer({
      name: "Pending",
      kind: "geojson",
      config: { url: "https://x/zones.geojson", preparation: "loading" },
    });
    const empty = useGeoLayerStore.getState().addGeoLayer({
      name: "Empty",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    render(<ToolView toolId="join-by-location" />);
    const options = [
      ...screen
        .getByRole("combobox", { name: "Source" })
        .querySelectorAll("option"),
    ];
    const titleOf = (id: string) =>
      options
        .find((o) => o.getAttribute("value") === id)
        ?.getAttribute("title");
    expect(titleOf(loading)).toBe("This vector layer is still loading");
    expect(titleOf(empty)).toBe("The source layer has no features");
  });

  it("drops the parameters when the SOURCE changes, so stale fields cannot freeze", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    const other = addGeoLayer("Districts", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /zone/ }));
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toMatchObject({ fields: [] });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: other },
    });
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toEqual({});
  });
});
```

(`fireEvent` is already imported in that file's siblings; add it to this one's
`@testing-library/react` import, and add
`useGeoLayerStore.setState({ layers: [] })` to its `afterEach`. The fixture's
`readyTable(true)` needs `lods: [{ label: "0", suffix: "0" }]` for the footprint
radio to be offered — one field on an existing helper. `submitRun` is the
`vi.fn` from that file's existing `runQueue` mock: import it from
`../../../../src/features/processing/runQueue` and clear it in the same
`afterEach`, so the frozen-request assertion above reads one call.
`useLayerTableStore` is already imported by `addCityLayer`'s own helper, which
is what the workload case reaches through.)

- [ ] **Step 12: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, `tsc` clean, `vp check` still 0 errors / 56 warnings. Then check the three sections against their peers in a real browser (CLAUDE.md's UI rule): 30 px compact fields, 8 px radii, the checklist reading like `RoofMetricsParams`' checks.

- [ ] **Step 13: Commit**

```bash
git add src/features/processing/crossLayerParams.ts src/features/processing/vectorSource.ts \
  src/features/processing/processingStore.ts src/features/processing/toolRegistry.ts \
  src/features/processing/runQueue.ts \
  src/features/processing/types.ts src/ui/processing/CrossLayerParams.tsx \
  src/ui/processing/ToolView.tsx src/ui/processing/useToolForm.ts \
  src/ui/processing/RecentRuns.tsx \
  tests/unit/features/processing/crossLayerParams.test.ts \
  tests/unit/ui/processing/CrossLayerParams.test.tsx \
  tests/unit/ui/processing/useToolForm.test.tsx
git commit -m "feat: the cross-layer parameter forms and their validation"
```

---
