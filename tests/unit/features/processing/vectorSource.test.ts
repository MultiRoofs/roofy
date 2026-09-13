/**
 * §7.5's CRS and preflight paragraph, with no engine and no proj4.
 *
 * `crsFromGeodetic` is mocked with a deterministic affine (x = lng * 1000,
 * y = lat * 1000) so the WKT strings can be asserted exactly, and a sentinel
 * longitude stands for "proj4 could not transform this" — the real function's
 * only failure mode is a `null` return, which is what preflight counts.
 */
import { describe, expect, it, vi } from "vitest";

/** Call counting lives in a hoisted cell: the factory runs before the file. */
const proj = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../../../src/scene/cursorCrsReadout", () => ({
  // A coordinate at longitude 999 is the unprojectable one.
  crsFromGeodetic: (lng: number, lat: number, h: number) => {
    proj.calls += 1;
    return lng === 999 ? null : ([lng * 1000, lat * 1000, h] as const);
  },
  epsgForLayer: () => 28992,
}));

const {
  documentGeometryKinds,
  documentHasFeatureIds,
  documentHasFeatures,
  documentPropertyKeys,
  geoPropertyTypes,
  reprojectGeoLayer,
} = await import("../../../../src/features/processing/vectorSource");
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
  ring: Array<Array<number>>,
): Feature {
  return {
    type: "Feature",
    ...(id === undefined ? {} : { id }),
    properties,
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

const SQUARE: Array<Array<number>> = [
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
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPoint",
            coordinates: [
              [4, 52],
              [5, 53],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [4, 52],
                [5, 53],
              ],
            ],
          },
        },
      ),
      28992,
    );
    expect(out.features.map((f) => f.wkt)).toEqual([
      "POINT (4000 52000)",
      "LINESTRING (4000 52000, 5000 53000)",
      "MULTIPOINT (4000 52000, 5000 53000)",
      "MULTILINESTRING ((4000 52000, 5000 53000))",
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
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Circle", coordinates: [4, 52] },
        },
        polygon("z4", {}, SQUARE),
      ),
      28992,
    );
    // §7.5: "4 areas skipped: invalid geometry" is this count, formatted.
    expect(out.skipped).toBe(4);
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

  it("skips a position that is not two FINITE numbers", async () => {
    const out = await reprojectGeoLayer(
      collection(
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [4] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [Number.NaN, 52] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [Number.POSITIVE_INFINITY, 52],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: ["4", "52"] },
        },
      ),
      28992,
    );
    expect(out.skipped).toBe(4);
    expect(out.features).toHaveLength(0);
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

  it("reads a bare Feature as well as a FeatureCollection", async () => {
    const out = await reprojectGeoLayer(
      normalizeGeoJsonDocument(polygon("z1", { zone: "A" }, SQUARE)).data,
      28992,
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.stableId).toBe("id:string:z1");
  });

  it("lists EVERY live feature's property keys, in first-seen order, typed", async () => {
    const out = await reprojectGeoLayer(
      collection(
        polygon("z1", { zone: "A", noise: 62, quiet: false }, SQUARE),
        polygon("z2", { zone: "B", extra: "x" }, SQUARE),
        // Skipped for its GEOMETRY, but its field is still a field of the live
        // source layer — the frozen-field check at the queue head must not
        // call an unchanged document "Layer changed while running".
        { type: "Feature", properties: { ghost: 1 }, geometry: null },
      ),
      28992,
    );
    expect(out.propertyKeys).toEqual([
      "zone",
      "noise",
      "quiet",
      "extra",
      "ghost",
    ]);
    expect([...out.propertyTypes]).toEqual([
      ["zone", "VARCHAR"],
      ["noise", "DOUBLE"],
      ["quiet", "BOOLEAN"],
      ["extra", "VARCHAR"],
      ["ghost", "DOUBLE"],
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

  it("accepts a ring that closes only after rounding, shell AND hole", async () => {
    // Closure is decided on the PROJECTED, ROUNDED text — the ordinates
    // `ST_GeomFromText` will actually read — so two source positions a tenth of
    // a millimetre apart close a ring. The rule has to be the same for a hole
    // as for a shell, or a polygon would be skipped for a difference its own
    // WKT does not contain.
    const closesWhenRounded = 4.000_000_01;
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [4, 52],
              [5, 52],
              [5, 53],
              [closesWhenRounded, 52],
            ],
            [
              [4.2, 52.2],
              [4.4, 52.2],
              [4.4, 52.4],
              [4.200_000_01, 52.2],
            ],
          ],
        },
      }),
      28992,
    );
    expect(out.skipped).toBe(0);
    expect(out.features[0]?.wkt).toBe(
      "POLYGON ((4000 52000, 5000 52000, 5000 53000, 4000 52000), " +
        "(4200 52200, 4400 52200, 4400 52400, 4200 52200))",
    );
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

  it("skips an empty multi-geometry and an empty line list", async () => {
    const out = await reprojectGeoLayer(
      collection(
        {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiPoint", coordinates: [] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiLineString", coordinates: [] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiPolygon", coordinates: [] },
        },
      ),
      28992,
    );
    expect(out.skipped).toBe(3);
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
  // Probed against this checkout's DuckDB 1.5.5 + spatial: `ST_GeomFromText`
  // parses a GEOMETRYCOLLECTION, and `ST_Intersects`, `ST_CoveredBy`,
  // `ST_Area(ST_Intersection(…))`, `ST_Centroid`, `ST_Union_Agg` and
  // `ST_Distance` all answer on one. So no collection is skipped, and none is
  // re-spelt as a multi-geometry it is not.
  it("converts a same-family collection, members and all", async () => {
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
      "GEOMETRYCOLLECTION (POLYGON ((4000 52000, 5000 52000, 5000 53000, " +
        "4000 53000, 4000 52000)), MULTIPOLYGON (((6000 52000, 7000 52000, " +
        "7000 53000, 6000 52000))))",
    );
    // An area is an area however the document wrapped it, so §7.5's source
    // select and `polygonOnly` both say so.
    expect(out.polygonOnly).toBe(true);
    expect(out.skipped).toBe(0);
  });

  it("converts a MIXED collection rather than skipping it", async () => {
    const out = await reprojectGeoLayer(
      collection({
        type: "Feature",
        properties: {},
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [4, 52] },
            {
              type: "LineString",
              coordinates: [
                [4, 52],
                [5, 53],
              ],
            },
          ],
        },
      }),
      28992,
    );
    expect(out.skipped).toBe(0);
    expect(out.features[0]?.wkt).toBe(
      "GEOMETRYCOLLECTION (POINT (4000 52000), " +
        "LINESTRING (4000 52000, 5000 53000))",
    );
    expect(out.polygonOnly).toBe(false);
  });

  it("nests, and skips when one member is malformed", async () => {
    const out = await reprojectGeoLayer(
      collection(
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "GeometryCollection",
            geometries: [
              {
                type: "GeometryCollection",
                geometries: [{ type: "Point", coordinates: [4, 52] }],
              },
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "Polygon", coordinates: [SQUARE] },
              { type: "LineString", coordinates: [[4, 52]] },
            ],
          },
        },
      ),
      28992,
    );
    expect(out.features.map((f) => f.wkt)).toEqual([
      "GEOMETRYCOLLECTION (GEOMETRYCOLLECTION (POINT (4000 52000)))",
    ]);
    expect(out.skipped).toBe(1);
  });
});

describe("the batched walk", () => {
  /** 600 squares: past FEATURE_BATCH, so the walk has to yield at least once. */
  function manyAreas(count: number): unknown {
    return collection(
      ...Array.from({ length: count }, (_, i) => polygon(`z${i}`, {}, SQUARE)),
    );
  }

  /** One ring of `count` positions, closed. */
  function bigRing(count: number): Array<Array<number>> {
    const ring: Array<Array<number>> = Array.from({ length: count }, (_, i) => [
      4 + i / 10_000_000,
      52,
    ]);
    ring.push([4, 52]);
    return ring;
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
    let checkpoints = 0;
    const out = await reprojectGeoLayer(
      collection(polygon("big", {}, bigRing(60_000))),
      28992,
      { checkpoint: () => (checkpoints += 1) },
    );
    expect(out.features).toHaveLength(1);
    expect(checkpoints).toBeGreaterThan(0);
  });

  it("stops inside ONE very large feature when Cancel lands on a timer", async () => {
    // The Cancel the user presses arrives as a TIMER, not as a flag the walk
    // already holds: it can only be seen if the walk actually gave the event
    // loop a turn part-way through this single 200,000-position ring.
    const positions = 200_000;
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);
    proj.calls = 0;
    await expect(
      reprojectGeoLayer(
        collection(polygon("big", {}, bigRing(positions))),
        28992,
        {
          checkpoint: () => {
            if (cancelled) throw new Error("cancelled");
          },
        },
      ),
    ).rejects.toThrow("cancelled");
    // It stopped INSIDE the feature: a walk that only checked between features
    // would have projected every one of its positions first.
    expect(proj.calls).toBeLessThan(positions);
  });

  it("stops during ASSEMBLY, after the feature's last coordinate is projected", async () => {
    // Projecting the positions is only half the work a 200,000-vertex ring
    // costs: the ring's text, the shell's parentheses and the POLYGON wrapper
    // are each a multi-megabyte copy, and a Cancel pressed while the walk is in
    // THEM must land too. The checkpoint arms the timer the moment every
    // coordinate of this feature has been projected, so the throw below can
    // only happen if assembly yields as well — and the cancel that arrives
    // during that park is what is caught.
    const ring = bigRing(200_000);
    const total = ring.length;
    let cancelled = false;
    let armed = false;
    proj.calls = 0;
    // Caught by hand rather than with `rejects`: a resolved multi-megabyte
    // preflight printed as a diff is unreadable, and the message is the whole
    // assertion anyway.
    let failure: unknown = null;
    try {
      await reprojectGeoLayer(collection(polygon("big", {}, ring)), 28992, {
        checkpoint: () => {
          if (cancelled) throw new Error("cancelled");
          if (armed || proj.calls < total) return;
          armed = true;
          setTimeout(() => {
            cancelled = true;
          }, 0);
        },
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as Error | null)?.message).toBe("cancelled");
    expect(armed).toBe(true);
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

describe("documentPropertyKeys", () => {
  it("reads every live feature, whatever its geometry is", () => {
    // §6.1's frozen-field check at the queue head reads THIS, not the kept
    // geometries: a field carried only by a feature preflight skipped is still
    // a field of an unchanged layer.
    expect(
      documentPropertyKeys(
        collection(
          polygon("z1", { zone: "A" }, SQUARE),
          { type: "Feature", properties: { ghost: 1 }, geometry: null },
          polygon("z3", { extra: "x" }, SQUARE),
        ),
      ),
    ).toEqual(["zone", "ghost", "extra"]);
  });

  it("is empty for a document that carries no feature", () => {
    expect(documentPropertyKeys({ hello: "world" })).toEqual([]);
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

describe("the two questions the FORM asks before any run", () => {
  it("reports whether any feature carries a GeoJSON id of its own", () => {
    expect(documentHasFeatureIds(collection(polygon("z1", {}, SQUARE)))).toBe(
      true,
    );
    expect(
      documentHasFeatureIds(
        collection({ ...polygon(undefined, {}, SQUARE), id: 7 }),
      ),
    ).toBe(true);
    expect(
      documentHasFeatureIds(collection(polygon(undefined, {}, SQUARE))),
    ).toBe(false);
  });

  it("reports whether the document carries a feature at all", () => {
    // §7.5's "The source layer has no features", decided per keystroke — one
    // array length per layer, never a walk of anyone's geometry.
    expect(documentHasFeatures(collection(polygon("z1", {}, SQUARE)))).toBe(
      true,
    );
    expect(documentHasFeatures(collection())).toBe(false);
    expect(documentHasFeatures({ hello: "world" })).toBe(false);
    expect(documentHasFeatures(null)).toBe(false);
    // A bare Feature is a document of one, and a collection of junk is none.
    expect(
      documentHasFeatures({ type: "Feature", properties: {}, geometry: null }),
    ).toBe(true);
    expect(
      documentHasFeatures({ type: "FeatureCollection", features: [null, 7] }),
    ).toBe(false);
  });
});
