### Task 12: App-side reprojection and preflight

**Files:**

- Create: `src/features/processing/vectorSource.ts`
- Test: `tests/unit/features/processing/vectorSource.test.ts`

**Interfaces:**

- Consumes: `crsFromGeodetic(lngDeg, latDeg, height, epsg)` and `epsgForLayer(referenceSystem)` (`src/scene/cursorCrsReadout.ts:35-79`), `ensureModelCrsLoadable(model)` (`src/features/layers/ensureCrs.ts:32` — awaited by the CALLER, see below), `geoRecords`/`GeoRecord`/`GEO_RECORD_ID` (`geoRecords.ts:5-37`), `publicGeoProperties`/`readGeoStableFeatureId` (`geoJsonRecords.ts:11-21, 98-114`), `ColumnType` (`computedColumns.ts:30`).
- Produces:

```ts
export interface ProjectedFeature {
  readonly idx: number; // 0-based SOURCE ORDER — the tie rule everywhere
  readonly stableId: string; // geoJsonRecords' stable feature id
  /** The GeoJSON feature-level `id` as text, or null — §7.7's default for
   *  "the nearest feature's id". It is NOT in `properties` (a feature's `id`
   *  is a sibling of them), so it needs its own slot. */
  readonly featureId: string | null;
  readonly properties: Readonly<Record<string, unknown>>; // public properties
  readonly wkt: string; // reprojected, 2-D, in the city layer's CRS
}
export interface VectorPreflight {
  readonly features: ReadonlyArray<ProjectedFeature>;
  readonly skipped: number; // null/empty/unparseable/unprojectable
  readonly propertyKeys: ReadonlyArray<string>;
  readonly propertyTypes: ReadonlyMap<string, ColumnType>;
  readonly polygonOnly: boolean; // every kept feature is (Multi)Polygon
}
/** What a batched walk reports to and asks permission from — see deviation 3. */
export interface YieldControl {
  /** Called once per batch, before the yield. The run passes
   *  `ctx.throwIfCancelled` (or an `AbortSignal` check); it THROWS to stop. */
  readonly checkpoint?: () => void;
}
export async function reprojectGeoLayer(
  document: unknown,
  epsg: number,
  control?: YieldControl,
): Promise<VectorPreflight>;
export function geoPropertyTypes(
  records: ReadonlyArray<GeoRecord>,
): ReadonlyMap<string, ColumnType>;
/** The geometry `type` strings a document carries, for the FORM's
 *  "Needs areas (polygons)" row — see the deviation below. */
export function documentGeometryKinds(document: unknown): ReadonlySet<string>;
```

- Tasks 13, 15, 16, 17 and 19 consume it.

**Four deviations from the ledger, all named.**

1. **`ProjectedFeature` gains `featureId`.** §7.7's nearest-id select "defaults to the GeoJSON feature `id` when the source has one", and a feature's `id` is a sibling of `properties`, not a member of it — `publicGeoProperties` only strips the renderer envelope. Recovering it from `stableId`'s `"id:string:z1"` spelling would make an internal format a public contract.
2. **`documentGeometryKinds` is added.** §7.5's source select disables a point or line layer with "Needs areas (polygons)" BEFORE any run, and `reprojectGeoLayer` cannot answer that question for the form: it needs an EPSG and a loaded proj4 definition, and until `ensureModelCrsLoadable` has resolved, `crsFromGeodetic` returns `null` for every coordinate — every feature skips, `features` is empty and `polygonOnly` is vacuously true. One cheap synchronous scan of the document's geometry types is the honest answer for a select that is drawn on every keystroke.
3. **`reprojectGeoLayer` is ASYNC and walks in bounded batches** (commander's ruling, after the plan review). The ledger spelled it synchronous. A 200 MB roads layer is millions of coordinates, and one synchronous walk blocks the frame and the Cancel button for as long as it takes — the same hazard M2's "nothing walks a whole layer's geometry synchronously" names. The walk therefore yields a MACROTASK every `FEATURE_BATCH` features **and** every `COORDINATE_BUDGET` coordinates, calling `control.checkpoint()` before each yield so a cancelled run stops inside the phase rather than after it. The coordinate budget is spent POSITION by position wherever the walk is, so a single 400,000-vertex commune boundary yields inside its own ring — a per-feature batch alone would not.
4. **Geometry STRUCTURE is validated, and a same-family `GeometryCollection` is converted rather than skipped.** The ledger's preflight only checked nesting and non-emptiness, so a one-position `LineString`, a three-position polygon ring and an unclosed ring all reached `ST_GeomFromText` — which RAISES, and the vector table is ONE statement, so one malformed feature would fail the whole run instead of being skipped and counted (§7.5: "null, empty or unparseable geometry are skipped and counted"). Each type's real rule is checked here: a line needs 2 positions, a ring 4 and a closing position equal to its first, a polygon at least one ring. And §7.7's source is "a vector layer of any geometry type": a `GeometryCollection` whose members are all points, all lines or all areas is converted to the matching multi-geometry (the members' parts concatenated), which is exactly equivalent for every operation §7.5-§7.7 performs; a MIXED collection is still skipped and counted, because no single WKT multi-geometry says it and `GEOMETRYCOLLECTION` is a shape no probe in this plan has pinned.

**The async warm-up is still the CALLER's, and that is deliberate.** `reprojectGeoLayer` reaches no store and no engine — its only async is its own yielding — which is what lets every §7.5 preflight sentence be decided in a unit test with no engine. `ensureModelCrsLoadable(targetModel)` must be awaited before it is called, because `crsFromGeodetic`'s `ensureProjDef` guard is synchronous and answers `null` for a definition proj4 has not fetched yet — the difference between "4 areas skipped" and "every area skipped" on a cold CRS. Task 13's `"source"` phase and Task 19's executor each await it; this module states the requirement and does not perform it.

**`idx` is the DOCUMENT index, gaps included.** §7.5's tie rule is "first, by source order", and a skipped feature must not renumber the ones after it: an index that closed the gaps would make the tie rule depend on which features happened to be unprojectable. The executors build `Map<idx, ProjectedFeature>`, so gaps cost nothing.

**`geoPropertyTypes` refines `geoRecordColumns`, and never contradicts it.** `geoRecordColumns` (`geoRecords.ts:39-53`) answers DOUBLE when any row's value is a number and VARCHAR otherwise — it feeds the grid's filter bar, which has no BOOLEAN kind, and it is deliberately left alone. `geoPropertyTypes` keeps the same DOUBLE rule and splits the VARCHAR half: a key whose non-null values are ALL booleans is BOOLEAN, everything else stays VARCHAR. So the two can disagree only where `geoRecordColumns` would have said VARCHAR about a column of `true`/`false`, which is exactly the case §7.5's "copied values keep their type: numbers as DOUBLE, booleans, everything else as VARCHAR" asks about.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/vectorSource.test.ts`:

```ts
/**
 * §7.5's CRS and preflight paragraph, with no engine and no proj4.
 *
 * `crsFromGeodetic` is mocked with a deterministic affine (x = lng * 1000,
 * y = lat * 1000) so the WKT strings can be asserted exactly, and a sentinel
 * longitude stands for "proj4 could not transform this" — the real function's
 * only failure mode is a `null` return, which is what preflight counts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/scene/cursorCrsReadout", () => ({
  // A coordinate at longitude 999 is the unprojectable one.
  crsFromGeodetic: (lng: number, lat: number, h: number) =>
    lng === 999 ? null : ([lng * 1000, lat * 1000, h] as const),
  epsgForLayer: () => 28992,
}));

const { documentGeometryKinds, geoPropertyTypes, reprojectGeoLayer } =
  await import("../../../../src/features/processing/vectorSource");
const { normalizeGeoJsonDocument } =
  await import("../../../../src/features/geoLayers/geoJsonRecords");
const { geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");

type Feature = Record<string, unknown>;

function collection(...features: Feature[]): unknown {
  return normalizeGeoJsonDocument({
    type: "FeatureCollection",
    features,
  }).data;
}

function polygon(
  id: string | undefined,
  properties: Record<string, unknown>,
  ring: Array<[number, number]>,
): Feature {
  return {
    type: "Feature",
    ...(id === undefined ? {} : { id }),
    properties,
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

const SQUARE: Array<[number, number]> = [
  [4, 52],
  [5, 52],
  [5, 53],
  [4, 53],
  [4, 52],
];

describe("reprojectGeoLayer", () => {
  it("projects a polygon into the target's CRS, 2-D, ring closed", async () => {
    const out = await reprojectGeoLayer(
      collection(polygon("z1", { zone: "A" }, SQUARE)),
      28992,
    );
    expect(out.skipped).toBe(0);
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.wkt).toBe(
      "POLYGON ((4000 52000, 5000 52000, 5000 53000, 4000 53000, 4000 52000))",
    );
    expect(out.features[0]?.idx).toBe(0);
    expect(out.features[0]?.featureId).toBe("z1");
    expect(out.features[0]?.properties).toEqual({ zone: "A" });
    expect(out.polygonOnly).toBe(true);
  });

  it("carries the stable feature id the records panel and the write-back use", async () => {
    // `normalizeGeoJsonDocument`'s own spelling for a unique source id — the
    // key §7.6's results are merged back under, and the key the records panel
    // already identifies a row by.
    const out = await reprojectGeoLayer(
      collection(polygon("z1", {}, SQUARE)),
      28992,
    );
    expect(out.features[0]?.stableId).toBe("id:string:z1");
  });

  it("drops the third ordinate and keeps a MultiPolygon's holes", async () => {
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [4, 52, 7],
                [5, 52, 7],
                [5, 53, 7],
                [4, 52, 7],
              ],
              [
                [4.2, 52.2],
                [4.4, 52.2],
                [4.4, 52.4],
                [4.2, 52.2],
              ],
            ],
          ],
        },
      }),
      28992,
    );
    expect(out.features[0]?.wkt).toBe(
      "MULTIPOLYGON (((4000 52000, 5000 52000, 5000 53000, 4000 52000), " +
        "(4200 52200, 4400 52200, 4400 52400, 4200 52200)))",
    );
  });

  it("projects points and lines too — §7.7's source is any geometry type", async () => {
    const out = await reprojectGeoLayer(
      collection(
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [4, 52] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [4, 52],
              [5, 53],
            ],
          },
        },
      ),
      28992,
    );
    expect(out.features.map((f) => f.wkt)).toEqual([
      "POINT (4000 52000)",
      "LINESTRING (4000 52000, 5000 53000)",
    ]);
    expect(out.polygonOnly).toBe(false);
  });

  it("skips and COUNTS a null, an empty and an unknown geometry", async () => {
    const out = await reprojectGeoLayer(
      collection(
        { type: "Feature", properties: {}, geometry: null },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "GeometryCollection", geometries: [] },
        },
        polygon("z4", {}, SQUARE),
      ),
      28992,
    );
    // §7.5: "4 areas skipped: invalid geometry" is this count, formatted.
    expect(out.skipped).toBe(3);
    expect(out.features).toHaveLength(1);
  });

  it("skips a feature whose coordinates do not reproject", async () => {
    const out = await reprojectGeoLayer(
      collection(
        polygon("z1", {}, [
          [999, 52],
          [5, 52],
          [5, 53],
          [999, 52],
        ]),
        polygon("z2", {}, SQUARE),
      ),
      28992,
    );
    expect(out.skipped).toBe(1);
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.featureId).toBe("z2");
  });

  it("keeps SOURCE order in idx, gaps and all", async () => {
    const out = await reprojectGeoLayer(
      collection(
        { type: "Feature", properties: {}, geometry: null },
        polygon("z2", {}, SQUARE),
        { type: "Feature", properties: {}, geometry: null },
        polygon("z4", {}, SQUARE),
      ),
      28992,
    );
    // The tie rule is "first by source order": renumbering would let a
    // skipped feature decide which of two equal matches wins.
    expect(out.features.map((f) => f.idx)).toEqual([1, 3]);
  });

  it("reports every feature skipped, which is the run's own refusal", async () => {
    const out = await reprojectGeoLayer(
      collection(
        { type: "Feature", properties: {}, geometry: null },
        { type: "Feature", properties: {}, geometry: null },
      ),
      28992,
    );
    // The CALLER turns `features.length === 0 && skipped > 0` into
    // "No usable areas in Zones"; preflight only counts.
    expect(out.features).toHaveLength(0);
    expect(out.skipped).toBe(2);
  });

  it("answers empty for a document that is not GeoJSON at all", async () => {
    const out = await reprojectGeoLayer({ hello: "world" }, 28992);
    expect(out).toMatchObject({ features: [], skipped: 0, polygonOnly: true });
    expect(out.propertyKeys).toEqual([]);
  });

  it("lists the KEPT features' property keys, in first-seen order, typed", async () => {
    const out = await reprojectGeoLayer(
      collection(
        polygon("z1", { zone: "A", noise: 62, quiet: false }, SQUARE),
        polygon("z2", { zone: "B", extra: "x" }, SQUARE),
        // Skipped, so its key never reaches the checklist.
        { type: "Feature", properties: { ghost: 1 }, geometry: null },
      ),
      28992,
    );
    expect(out.propertyKeys).toEqual(["zone", "noise", "quiet", "extra"]);
    expect([...out.propertyTypes]).toEqual([
      ["zone", "VARCHAR"],
      ["noise", "DOUBLE"],
      ["quiet", "BOOLEAN"],
      ["extra", "VARCHAR"],
    ]);
  });

  it("never exposes the renderer's stable-id envelope as a property", async () => {
    const out = await reprojectGeoLayer(
      collection(polygon("z1", {}, SQUARE)),
      28992,
    );
    expect(out.propertyKeys).toEqual([]);
    expect(out.features[0]?.properties).toEqual({});
  });

  it("stringifies a numeric feature id, and reports null when there is none", async () => {
    const out = await reprojectGeoLayer(
      collection(
        { ...polygon(undefined, {}, SQUARE), id: 7 },
        polygon(undefined, {}, SQUARE),
      ),
      28992,
    );
    expect(out.features.map((f) => f.featureId)).toEqual(["7", null]);
  });
});

describe("the structure §7.5 calls unparseable", () => {
  // Every case here would reach `ST_GeomFromText` as text it RAISES on, and the
  // vector table is ONE statement — so one malformed feature would fail the
  // whole run instead of being skipped and counted.
  it("skips a line with one position and a ring with three", async () => {
    const out = await reprojectGeoLayer(
      collection(
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [[4, 52]] },
        },
        polygon("z2", {}, [
          [4, 52],
          [5, 52],
          [4, 52],
        ]),
        polygon("z3", {}, SQUARE),
      ),
      28992,
    );
    expect(out.skipped).toBe(2);
    expect(out.features.map((f) => f.featureId)).toEqual(["z3"]);
  });

  it("skips a ring whose last position is not its first", async () => {
    const out = await reprojectGeoLayer(
      collection(
        polygon("z1", {}, [
          [4, 52],
          [5, 52],
          [5, 53],
          [4, 53],
        ]),
      ),
      28992,
    );
    expect(out.skipped).toBe(1);
    expect(out.features).toHaveLength(0);
  });

  it("skips a polygon whose HOLE is malformed, not just its shell", async () => {
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            SQUARE,
            [
              [4.2, 52.2],
              [4.4, 52.2],
            ],
          ],
        },
      }),
      28992,
    );
    expect(out.skipped).toBe(1);
  });

  it("keeps the good features when the document is a mixture", async () => {
    const out = await reprojectGeoLayer(
      collection(
        polygon("z1", { zone: "A" }, SQUARE),
        { type: "Feature", properties: {}, geometry: null },
        polygon("z3", { zone: "C" }, [
          [4, 52],
          [5, 52],
          [4, 52],
        ]),
        polygon("z4", { zone: "D" }, SQUARE),
      ),
      28992,
    );
    expect(out.features.map((f) => f.featureId)).toEqual(["z1", "z4"]);
    expect(out.skipped).toBe(2);
    expect(out.propertyKeys).toEqual(["zone"]);
  });
});

describe("a GeometryCollection (§7.7's source is any geometry type)", () => {
  it("converts a same-family collection to the matching multi-geometry", async () => {
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", coordinates: [SQUARE] },
            {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [6, 52],
                    [7, 52],
                    [7, 53],
                    [6, 52],
                  ],
                ],
              ],
            },
          ],
        },
      }),
      28992,
    );
    expect(out.features[0]?.wkt).toBe(
      "MULTIPOLYGON (((4000 52000, 5000 52000, 5000 53000, 4000 53000, 4000 52000)), " +
        "((6000 52000, 7000 52000, 7000 53000, 6000 52000)))",
    );
    // An area is an area however the document wrapped it, so §7.5's source
    // select and `polygonOnly` both say so.
    expect(out.polygonOnly).toBe(true);
  });

  it("skips a MIXED collection, which no single multi-geometry says", async () => {
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [4, 52] },
            { type: "Polygon", coordinates: [SQUARE] },
          ],
        },
      }),
      28992,
    );
    expect(out.skipped).toBe(1);
    expect(out.features).toHaveLength(0);
  });
});

describe("the batched walk", () => {
  /** 600 squares: past FEATURE_BATCH, so the walk has to yield at least once. */
  function manyAreas(count: number): unknown {
    return collection(
      ...Array.from({ length: count }, (_, i) => polygon(`z${i}`, {}, SQUARE)),
    );
  }

  it("checkpoints between batches, and a throwing checkpoint stops the walk", async () => {
    let seen = 0;
    await expect(
      reprojectGeoLayer(manyAreas(600), 28992, {
        checkpoint: () => {
          seen += 1;
          // What the run passes is `ctx.throwIfCancelled`, which throws
          // `CancelledError`; preflight neither catches nor translates it.
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
    expect(seen).toBe(1);
  });

  it("yields the event loop, so a Cancel and a repaint can land", async () => {
    let turned = false;
    setTimeout(() => {
      turned = true;
    }, 0);
    const out = await reprojectGeoLayer(manyAreas(600), 28992);
    expect(out.features).toHaveLength(600);
    // A synchronous walk would finish before any macrotask ran.
    expect(turned).toBe(true);
  });

  it("yields INSIDE one very large feature too", async () => {
    // One ring of 60,000 positions: past COORDINATE_BUDGET, so a per-FEATURE
    // batch alone would never yield.
    const ring: Array<[number, number]> = Array.from(
      { length: 60_000 },
      (_, i) => [4 + i / 1_000_000, 52],
    );
    ring.push([4, 52]);
    let checkpoints = 0;
    const out = await reprojectGeoLayer(
      collection(polygon("big", {}, ring)),
      28992,
      { checkpoint: () => (checkpoints += 1) },
    );
    expect(out.features).toHaveLength(1);
    expect(checkpoints).toBeGreaterThan(0);
  });
});

describe("geoPropertyTypes", () => {
  it("is the ONE type rule the form and the run both read", () => {
    const document = collection(
      polygon("z1", { zone: "A", noise: 62, flood: true, mixed: 1 }, SQUARE),
      polygon(
        "z2",
        { zone: "B", noise: null, flood: false, mixed: "x" },
        SQUARE,
      ),
    );
    expect([...geoPropertyTypes(geoRecords(document))]).toEqual([
      ["zone", "VARCHAR"],
      ["noise", "DOUBLE"],
      ["flood", "BOOLEAN"],
      // One number anywhere makes it DOUBLE, exactly as `geoRecordColumns`
      // already decides it — the two must not disagree.
      ["mixed", "DOUBLE"],
    ]);
  });

  it("calls an all-null column VARCHAR rather than guessing", () => {
    const document = collection(polygon("z1", { empty: null }, SQUARE));
    expect(geoPropertyTypes(geoRecords(document)).get("empty")).toBe("VARCHAR");
  });
});

describe("documentGeometryKinds", () => {
  it("names the geometry types, so the source select can refuse points", () => {
    expect([
      ...documentGeometryKinds(
        collection(polygon("z1", {}, SQUARE), {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [4, 52] },
        }),
      ),
    ]).toEqual(["Polygon", "Point"]);
  });

  it("reports a collection's MEMBERS, so a collection of areas reads as areas", () => {
    expect([
      ...documentGeometryKinds(
        collection({
          type: "Feature",
          properties: {},
          geometry: {
            type: "GeometryCollection",
            geometries: [{ type: "Polygon", coordinates: [SQUARE] }],
          },
        }),
      ),
    ]).toEqual(["Polygon"]);
  });

  it("is empty for a document with no geometry at all", () => {
    expect(documentGeometryKinds(null).size).toBe(0);
    expect(
      documentGeometryKinds(
        collection({ type: "Feature", properties: {}, geometry: null }),
      ).size,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/vectorSource.test.ts
```

Expected: FAIL — `src/features/processing/vectorSource.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `src/features/processing/vectorSource.ts`:

```ts
/**
 * A vector layer's features, reprojected into a city layer's CRS, with §7.5's
 * preflight counted rather than swallowed.
 *
 * NO STORE AND NO ENGINE, which is the point: every sentence §7.5 asks for — "4
 * areas skipped: invalid geometry", "No usable areas in Zones", "The source
 * layer has no features" — is decided by counting `skipped` against
 * `features.length`, in a unit test with nothing mocked but proj4.
 *
 * ASYNC, AND IN BOUNDED BATCHES. A 200 MB roads layer is millions of
 * coordinates; one synchronous walk blocks the frame and the Cancel button for
 * as long as it takes, which is the hazard M2's "nothing walks a whole layer's
 * geometry synchronously" names. The walk yields a MACROTASK every
 * {@link FEATURE_BATCH} features and every {@link COORDINATE_BUDGET}
 * coordinates, and calls `control.checkpoint()` — the run's
 * `ctx.throwIfCancelled` — immediately before each yield, so a cancelled run
 * stops INSIDE the phase. The budget is spent position by position wherever the
 * walk is, so one enormous ring yields as well as ten thousand small ones.
 *
 * THE CALLER MUST AWAIT `ensureModelCrsLoadable(targetModel)` FIRST.
 * `crsFromGeodetic`'s `ensureProjDef` guard is synchronous and returns `null`
 * for a definition proj4 has not fetched yet, so on a cold CRS every feature
 * would be counted unprojectable — "every area skipped" instead of "4". The
 * run's `"source"` phase is where that await belongs; it costs nothing when
 * the definition is already loaded.
 *
 * `crsFromGeodetic` (`scene/cursorCrsReadout.ts`) is the app's ONE proj4 call
 * site and this module does not open a second: it is 2-D (every operation in
 * §7.5-§7.7 is), it returns `null` rather than a partly-NaN triple, and it is
 * already guarded. `features/` importing from `scene/` is established
 * (`geoLayers/categorize.ts:26-29`). `ST_Transform` is never used, even though
 * the wasm build has it (Global Constraints).
 */
import type { ColumnType } from "../../insights/computedColumns";
import {
  publicGeoProperties,
  readGeoStableFeatureId,
} from "../geoLayers/geoJsonRecords";
import type { GeoRecord } from "../geoLayers/geoRecords";
import { crsFromGeodetic } from "../../scene/cursorCrsReadout";

export interface ProjectedFeature {
  /**
   * The feature's index in the SOURCE document, gaps included.
   *
   * §7.5's tie rule is "first, by source order", everywhere: the first matching
   * area, the first equally-near feature. Renumbering the kept features would
   * let an unprojectable neighbour decide which of two ties wins.
   */
  readonly idx: number;
  /** `geoJsonRecords`' stable feature id — the key a vector target's results
   *  are written back under (§7.6). */
  readonly stableId: string;
  /**
   * The GeoJSON feature-level `id` as text, or null.
   *
   * §7.7's "Also write the nearest feature's id" defaults to it. A feature's
   * `id` is a SIBLING of `properties`, so it is not in the bag below.
   */
  readonly featureId: string | null;
  /** The feature's own properties, renderer bookkeeping removed. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** 2-D WKT in the target's CRS, for `ST_GeomFromText`. */
  readonly wkt: string;
}

export interface VectorPreflight {
  readonly features: ReadonlyArray<ProjectedFeature>;
  /** §7.5: null, empty, unparseable or unprojectable geometry. */
  readonly skipped: number;
  /** The KEPT features' property keys, in first-seen order. */
  readonly propertyKeys: ReadonlyArray<string>;
  readonly propertyTypes: ReadonlyMap<string, ColumnType>;
  /** Every kept feature is a Polygon or MultiPolygon (§7.5's areas). */
  readonly polygonOnly: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The feature objects of a `FeatureCollection`, a bare `Feature`, or junk. */
function featuresOf(document: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isRecord(document)) return [];
  if (document.type === "FeatureCollection" && Array.isArray(document.features))
    return document.features.filter(isRecord);
  if (document.type === "Feature") return [document];
  return [];
}

/**
 * One coordinate as WKT, to 0.1 mm.
 *
 * Rounded for two reasons: a metric CRS has nothing to say below a tenth of a
 * millimetre, and `String(1e-7)` is `"1e-7"` — exponent notation a WKT parser
 * is not obliged to accept. Rounding first makes every ordinate a plain
 * decimal.
 */
function ordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** How many coordinates the walk converts before it yields the event loop. */
const COORDINATE_BUDGET = 20_000;
/** How many features it converts before it yields, whatever their size. */
const FEATURE_BATCH = 500;

export interface YieldControl {
  /**
   * Called once per batch, immediately BEFORE the yield, and allowed to throw.
   *
   * The run passes `ctx.throwIfCancelled`, so a cancelled run stops inside the
   * walk instead of after it. Absent for the form's own uses, which have
   * nothing to cancel.
   */
  readonly checkpoint?: () => void;
}

/** The coordinate budget, as one cell the whole walk shares. */
interface Budget {
  left: number;
}

/**
 * Spend `n` coordinates, and yield when the budget runs out.
 *
 * A MACROTASK, not `Promise.resolve()`: a microtask does not let the browser
 * paint or a click land, which is the whole point of the batching.
 */
async function spend(
  n: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<void> {
  budget.left -= n;
  if (budget.left > 0) return;
  control?.checkpoint?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  budget.left = COORDINATE_BUDGET;
}

/** One position as `"x y"`, or null when it is not a projectable pair. */
function position(value: unknown, epsg: number): string | null {
  if (!Array.isArray(value)) return null;
  const lng = value[0];
  const lat = value[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  const xy = crsFromGeodetic(lng, lat, 0, epsg);
  if (xy === null) return null;
  return `${ordinate(xy[0])} ${ordinate(xy[1])}`;
}

/**
 * A list of positions, projected — or null when the STRUCTURE is wrong.
 *
 * `minimum` is the type's own rule (2 positions for a line, 4 for a ring) and
 * `closed` is the ring rule. Both matter: `ST_GeomFromText` RAISES on a
 * one-position line and on an unclosed ring, and the vector table is ONE
 * statement, so a malformed feature that reached it would fail the whole run
 * instead of being skipped and counted (§7.5). An EMPTY array is §7.5's "empty
 * geometry" — the probed `ST_GeomFromGeoJSON` trap in reverse.
 */
async function positionList(
  value: unknown,
  epsg: number,
  minimum: number,
  closed: boolean,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<ReadonlyArray<string> | null> {
  if (!Array.isArray(value) || value.length < minimum) return null;
  const parts: string[] = [];
  for (const entry of value) {
    const text = position(entry, epsg);
    // Half a ring is not a geometry: §7.5 skips the FEATURE.
    if (text === null) return null;
    parts.push(text);
    await spend(1, budget, control);
  }
  if (closed && parts[0] !== parts[parts.length - 1]) return null;
  return parts;
}

/** A polygon's rings as `"(shell), (hole)"`, or null if any ring is not one. */
async function ringsOf(
  value: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<string | null> {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts: string[] = [];
  for (const ring of value) {
    const positions = await positionList(ring, epsg, 4, true, budget, control);
    if (positions === null) return null;
    parts.push(`(${positions.join(", ")})`);
  }
  return parts.join(", ");
}

/**
 * A geometry as its FAMILY and its multi-parts.
 *
 * This shape is what makes a same-family `GeometryCollection` convertible: the
 * members' parts simply concatenate. A part carries no outer parentheses;
 * {@link wktOf} adds them, so one rule renders `POINT`/`MULTIPOINT`,
 * `LINESTRING`/`MULTILINESTRING` and `POLYGON`/`MULTIPOLYGON` alike.
 */
interface Shape {
  readonly family: "POINT" | "LINESTRING" | "POLYGON";
  /** The SOURCE said multi, so the WKT says multi even with one part. */
  readonly multi: boolean;
  readonly parts: ReadonlyArray<string>;
}

async function shapeOf(
  geometry: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<Shape | null> {
  if (!isRecord(geometry)) return null;
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case "Point": {
      const text = position(coordinates, epsg);
      await spend(1, budget, control);
      return text === null
        ? null
        : { family: "POINT", multi: false, parts: [text] };
    }
    case "MultiPoint": {
      const list = await positionList(
        coordinates,
        epsg,
        1,
        false,
        budget,
        control,
      );
      return list === null
        ? null
        : { family: "POINT", multi: true, parts: list };
    }
    case "LineString": {
      const list = await positionList(
        coordinates,
        epsg,
        2,
        false,
        budget,
        control,
      );
      return list === null
        ? null
        : { family: "LINESTRING", multi: false, parts: [list.join(", ")] };
    }
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
      const parts: string[] = [];
      for (const line of coordinates) {
        const list = await positionList(line, epsg, 2, false, budget, control);
        if (list === null) return null;
        parts.push(list.join(", "));
      }
      return { family: "LINESTRING", multi: true, parts };
    }
    case "Polygon": {
      const rings = await ringsOf(coordinates, epsg, budget, control);
      return rings === null
        ? null
        : { family: "POLYGON", multi: false, parts: [rings] };
    }
    case "MultiPolygon": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
      const parts: string[] = [];
      for (const polygon of coordinates) {
        const rings = await ringsOf(polygon, epsg, budget, control);
        if (rings === null) return null;
        parts.push(rings);
      }
      return { family: "POLYGON", multi: true, parts };
    }
    case "GeometryCollection":
      return await collectionShape(geometry.geometries, epsg, budget, control);
    default:
      // A type the list does not name reads as unparseable, which §7.5 COUNTS
      // rather than fails on.
      return null;
  }
}

/**
 * A `GeometryCollection` as one multi-geometry, or null.
 *
 * §7.7's source is "a vector layer of any geometry type", and a collection of
 * areas IS areas: concatenating the members' parts gives a MULTIPOLYGON that
 * every operation §7.5-§7.7 performs — intersects, covered-by, area,
 * distance — answers identically. A MIXED collection is skipped and counted:
 * no single multi-geometry says it, and `GEOMETRYCOLLECTION` is a shape no
 * probe in this plan has pinned. A NESTED collection resolves through the same
 * recursion, so a collection of one collection of polygons still converts.
 */
async function collectionShape(
  members: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<Shape | null> {
  if (!Array.isArray(members) || members.length === 0) return null;
  const parts: string[] = [];
  let family: Shape["family"] | null = null;
  for (const member of members) {
    const shape = await shapeOf(member, epsg, budget, control);
    if (shape === null) return null;
    if (family === null) family = shape.family;
    else if (family !== shape.family) return null;
    parts.push(...shape.parts);
  }
  return family === null ? null : { family, multi: true, parts };
}

const KEYWORDS: Readonly<Record<Shape["family"], readonly [string, string]>> = {
  POINT: ["POINT", "MULTIPOINT"],
  LINESTRING: ["LINESTRING", "MULTILINESTRING"],
  POLYGON: ["POLYGON", "MULTIPOLYGON"],
};

/** A shape as 2-D WKT. A multi keyword when the source said so or when the
 *  collection concatenated more than one part. */
function wktOf(shape: Shape): string {
  const multi = shape.multi || shape.parts.length > 1;
  const keyword = KEYWORDS[shape.family][multi ? 1 : 0];
  // A MULTIPOINT's parts are bare positions; every other multi parenthesises
  // each of its parts.
  const body =
    multi && shape.family !== "POINT"
      ? shape.parts.map((part) => `(${part})`).join(", ")
      : shape.parts.join(", ");
  return `${keyword} (${body})`;
}

export async function reprojectGeoLayer(
  document: unknown,
  epsg: number,
  control?: YieldControl,
): Promise<VectorPreflight> {
  const features: ProjectedFeature[] = [];
  let skipped = 0;
  let polygonOnly = true;
  const budget: Budget = { left: COORDINATE_BUDGET };
  const source = featuresOf(document);
  for (const [idx, feature] of source.entries()) {
    // A batch of small features costs no coordinates worth yielding for, so the
    // feature counter is what bounds it; `spend` bounds the other direction.
    if (idx > 0 && idx % FEATURE_BATCH === 0) {
      control?.checkpoint?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const shape = await shapeOf(feature.geometry, epsg, budget, control);
    if (shape === null) {
      skipped += 1;
      continue;
    }
    const rawProperties = isRecord(feature.properties)
      ? feature.properties
      : {};
    // A document that never went through `normalizeGeoJsonDocument` (a test,
    // a hand-built collection) has no envelope; the fallback is the same
    // spelling that function mints, so no feature is silently dropped.
    const stableId = readGeoStableFeatureId(rawProperties) ?? `index:${idx}`;
    const id = feature.id;
    // The FAMILY, not the document's type word: a collection of areas is
    // areas, and §7.5's source select should read it that way.
    if (shape.family !== "POLYGON") polygonOnly = false;
    features.push({
      idx,
      stableId,
      featureId:
        typeof id === "string" || typeof id === "number" ? String(id) : null,
      properties: publicGeoProperties(rawProperties),
      wkt: wktOf(shape),
    });
  }

  const propertyKeys: string[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    for (const key of Object.keys(feature.properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      propertyKeys.push(key);
    }
  }
  return {
    features,
    skipped,
    propertyKeys,
    propertyTypes: typesOf(
      features.map((f) => f.properties),
      propertyKeys,
    ),
    polygonOnly,
  };
}

/**
 * The ONE type rule (§7.5: "numbers as DOUBLE, booleans, everything else as
 * VARCHAR"), shared by preflight and by the form's fields checklist so the
 * types the user reads before Run are the types the columns are created with.
 *
 * `geoRecordColumns` (`geoRecords.ts:39-53`) keeps its own two-way answer: it
 * feeds the grid's filter bar, which has no BOOLEAN kind. This function agrees
 * with it about DOUBLE and splits its VARCHAR half, so the two can never
 * disagree about a column.
 */
function typesOf(
  bags: ReadonlyArray<Readonly<Record<string, unknown>>>,
  keys: ReadonlyArray<string>,
): ReadonlyMap<string, ColumnType> {
  const types = new Map<string, ColumnType>();
  for (const key of keys) {
    let anyNumber = false;
    let anyBoolean = false;
    let allBoolean = true;
    for (const bag of bags) {
      const value = bag[key];
      if (value === null || value === undefined) continue;
      if (typeof value === "number") anyNumber = true;
      if (typeof value === "boolean") anyBoolean = true;
      else allBoolean = false;
    }
    types.set(
      key,
      anyNumber ? "DOUBLE" : anyBoolean && allBoolean ? "BOOLEAN" : "VARCHAR",
    );
  }
  return types;
}

export function geoPropertyTypes(
  records: ReadonlyArray<GeoRecord>,
): ReadonlyMap<string, ColumnType> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    // `Object.keys` never yields the SYMBOL `geoRecords` keys its identity
    // with, so the checklist can never offer the renderer's own id as a field.
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return typesOf(records, keys);
}

/**
 * The geometry `type` strings a document carries, in first-seen order.
 *
 * The FORM's question, not the run's: §7.5 lists a point or line layer in the
 * source select disabled with "Needs areas (polygons)", and that select is
 * drawn before any CRS is resolved. `reprojectGeoLayer` cannot answer it — on
 * a cold proj4 definition every feature is skipped and `polygonOnly` is
 * vacuously true.
 *
 * A `GeometryCollection` reports its MEMBERS' types rather than itself, for the
 * same reason `reprojectGeoLayer` converts a same-family one: a collection of
 * areas is areas, and the select must not refuse a layer the run would accept.
 */
export function documentGeometryKinds(document: unknown): ReadonlySet<string> {
  const kinds = new Set<string>();
  const add = (geometry: unknown): void => {
    if (!isRecord(geometry) || typeof geometry.type !== "string") return;
    if (geometry.type === "GeometryCollection") {
      if (Array.isArray(geometry.geometries)) geometry.geometries.forEach(add);
      return;
    }
    kinds.add(geometry.type);
  };
  for (const feature of featuresOf(document)) add(feature.geometry);
  return kinds;
}
```

- [ ] **Step 4: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/vectorSource.test.ts
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/vectorSource.ts \
  tests/unit/features/processing/vectorSource.test.ts
git commit -m "feat: reproject a vector layer app-side, with a counted preflight"
```

---
