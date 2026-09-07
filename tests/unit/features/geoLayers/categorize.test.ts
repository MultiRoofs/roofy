/**
 * "Color by attribute" for vector layers: which attribute keys a document
 * offers, and which colour each distinct value wears.
 *
 * Pure and engine-free — the map-side painting (`geoLayerSync.applyFeatureColors`)
 * reads what this module computes, and the Style section's select and swatch
 * rows render it. The palette order is FIRST-SEEN: the first eight distinct
 * values take `CATEGORY_PALETTE_HEX` in encounter order, every later value
 * (and a missing-value feature that did not make the cut) lands in the ONE
 * overflow bucket on `CATEGORY_OTHER_HEX` — which is why a feature whose value
 * matches no entry of a non-overflowing list cannot exist, and the evaluator's
 * "no match" can only ever mean overflow.
 */
import { describe, expect, it } from "vitest";
import {
  attributeKeys,
  categoriesFor,
} from "../../../../src/features/geoLayers/categorize";
import {
  CATEGORY_OTHER_HEX,
  CATEGORY_PALETTE_HEX,
} from "../../../../src/scene/cityColors";

function feature(
  properties: Record<string, unknown> | null,
): Record<string, unknown> {
  return { type: "Feature", properties, geometry: null };
}

function collection(...features: unknown[]): Record<string, unknown> {
  return { type: "FeatureCollection", features };
}

describe("attributeKeys", () => {
  it("unions the property keys of every feature, in first-seen order", () => {
    const data = collection(
      feature({ zone: "residential", name: "A" }),
      feature({ zone: "retail", floors: 2 }),
      feature({ name: "B" }),
    );

    expect(attributeKeys(data)).toEqual(["zone", "name", "floors"]);
  });

  it("accepts a bare feature array and a single Feature", () => {
    expect(attributeKeys([feature({ a: 1 }), feature({ b: 2 })])).toEqual([
      "a",
      "b",
    ]);
    expect(attributeKeys(feature({ only: 1 }))).toEqual(["only"]);
  });

  it("tolerates junk: no crash, no keys", () => {
    expect(attributeKeys(undefined)).toEqual([]);
    expect(attributeKeys(null)).toEqual([]);
    expect(attributeKeys("geojson")).toEqual([]);
    expect(attributeKeys(42)).toEqual([]);
    expect(
      attributeKeys(collection(null, "x", { type: "Feature" }, feature(null))),
    ).toEqual([]);
  });

  it("skips inherited properties (a tampered prototype is not a key)", () => {
    const props = Object.create({ inherited: true }) as Record<string, unknown>;
    props.own = 1;
    expect(attributeKeys(collection(feature(props)))).toEqual(["own"]);
  });
});

describe("categoriesFor", () => {
  it("colours the distinct values in first-seen order from the palette", () => {
    const data = collection(
      feature({ zone: "residential" }),
      feature({ zone: "retail" }),
      feature({ zone: "residential" }),
      feature({ zone: "campus" }),
    );

    expect(categoriesFor(data, "zone")).toEqual([
      { value: "residential", color: CATEGORY_PALETTE_HEX[0] },
      { value: "retail", color: CATEGORY_PALETTE_HEX[1] },
      { value: "campus", color: CATEGORY_PALETTE_HEX[2] },
    ]);
  });

  it("stringifies non-string values rather than dropping them", () => {
    const data = collection(feature({ floors: 2 }), feature({ floors: "3" }));

    expect(categoriesFor(data, "floors")).toEqual([
      { value: "2", color: CATEGORY_PALETTE_HEX[0] },
      { value: "3", color: CATEGORY_PALETTE_HEX[1] },
    ]);
  });

  it("groups every feature MISSING the attribute into the one null category", () => {
    const data = collection(
      feature({ zone: "residential" }),
      feature({}), // no zone at all
      feature({ zone: null }),
      feature({ zone: "retail" }),
    );

    expect(categoriesFor(data, "zone")).toEqual([
      { value: "residential", color: CATEGORY_PALETTE_HEX[0] },
      { value: null, color: CATEGORY_PALETTE_HEX[1] },
      { value: "retail", color: CATEGORY_PALETTE_HEX[2] },
    ]);
  });

  it("puts the ninth distinct value and beyond into the single OTHER bucket", () => {
    const data = collection(
      ...Array.from({ length: 11 }, (_, i) => feature({ zone: `zone-${i}` })),
    );

    const categories = categoriesFor(data, "zone");
    expect(categories).toHaveLength(9);
    expect(categories.slice(0, 8)).toEqual(
      CATEGORY_PALETTE_HEX.slice(0, 8).map((color, i) => ({
        value: `zone-${i}`,
        color,
      })),
    );
    // ONE overflow row, never one per overflowing value.
    expect(categories[8]).toEqual({ value: null, color: CATEGORY_OTHER_HEX });
  });

  it("colours the missing-value category OTHER when null did not make the first eight", () => {
    const data = collection(
      ...Array.from({ length: 8 }, (_, i) => feature({ zone: `zone-${i}` })),
      feature({}), // missing — the ninth distinct value
    );

    const categories = categoriesFor(data, "zone");
    expect(categories[8]).toEqual({ value: null, color: CATEGORY_OTHER_HEX });
  });

  it('treats a literal "Other" value in the data as an ordinary value', () => {
    const data = collection(
      feature({ zone: "Other" }),
      feature({ zone: "residential" }),
    );

    expect(categoriesFor(data, "zone")).toEqual([
      { value: "Other", color: CATEGORY_PALETTE_HEX[0] },
      { value: "residential", color: CATEGORY_PALETTE_HEX[1] },
    ]);
  });

  it("answers the empty list when nothing COULD carry the attribute", () => {
    // A feature with properties but no `zone` key still MISSES the attribute
    // (the null category above) — the empty answer is for a document with no
    // properties bags at all.
    expect(
      categoriesFor(collection(feature(null), feature(null)), "zone"),
    ).toEqual([]);
    expect(categoriesFor(undefined, "zone")).toEqual([]);
    expect(categoriesFor(collection(null, 42), "zone")).toEqual([]);
  });
});
