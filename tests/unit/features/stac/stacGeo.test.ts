/**
 * The footprint geometry helpers.
 *
 * These exist so `StacItemMap` — which cannot be unit-tested at all, because
 * maplibre needs a real WebGL context — carries no logic worth testing. Every
 * ring, every union and every hit test lives here, under Node.
 */

import { describe, expect, it } from "vitest";
import {
  bboxIntersectsBounds,
  combinedBounds,
  extentToBounds,
  footprintFeatureCollection,
} from "../../../../src/features/stac/stacGeo";
import type { StacItemRecord } from "../../../../src/features/stac/stacTypes";

function item(
  id: string,
  bbox2d: readonly [number, number, number, number] | null,
): StacItemRecord {
  return {
    id,
    collectionId: "c",
    bbox2d,
    assetHref: null,
    assetType: null,
    lods: [],
    coTypes: [],
    cityObjects: null,
    projCode: null,
  };
}

describe("footprintFeatureCollection", () => {
  it("builds one closed CCW rectangle ring per item", () => {
    const fc = footprintFeatureCollection([item("a", [4, 51, 5, 52])]);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.type).toBe("Feature");
    expect(f.id).toBe("a");
    expect(f.properties.itemId).toBe("a");
    expect(f.geometry.type).toBe("Polygon");
    expect(f.geometry.coordinates).toHaveLength(1);
    expect(f.geometry.coordinates[0]).toEqual([
      [4, 51],
      [5, 51],
      [5, 52],
      [4, 52],
      [4, 51],
    ]);
  });

  it("closes the ring (first position === last)", () => {
    const ring = footprintFeatureCollection([item("a", [0, 0, 1, 1])])
      .features[0]!.geometry.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("skips items whose bbox2d is null", () => {
    const fc = footprintFeatureCollection([
      item("a", null),
      item("b", [4, 51, 5, 52]),
      item("c", null),
    ]);
    expect(fc.features.map((f) => f.id)).toEqual(["b"]);
  });

  it("returns an empty collection for no items", () => {
    expect(footprintFeatureCollection([])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});

describe("combinedBounds", () => {
  it("unions several boxes", () => {
    expect(
      combinedBounds([
        item("a", [4, 51, 5, 52]),
        item("b", [3, 52, 4.5, 53]),
        item("c", [6, 50, 7, 50.5]),
      ]),
    ).toEqual([
      [3, 50],
      [7, 53],
    ]);
  });

  it("returns the box itself for a single item", () => {
    expect(combinedBounds([item("a", [4, 51, 5, 52])])).toEqual([
      [4, 51],
      [5, 52],
    ]);
  });

  it("ignores items without a bbox", () => {
    expect(
      combinedBounds([item("a", null), item("b", [4, 51, 5, 52])]),
    ).toEqual([
      [4, 51],
      [5, 52],
    ]);
  });

  it("returns null for an empty list", () => {
    expect(combinedBounds([])).toBeNull();
  });

  it("returns null when every item lacks a bbox", () => {
    expect(combinedBounds([item("a", null), item("b", null)])).toBeNull();
  });
});

describe("extentToBounds", () => {
  it("widens a collection extent into a bounds pair", () => {
    expect(extentToBounds([4, 51, 5, 52])).toEqual([
      [4, 51],
      [5, 52],
    ]);
  });

  it("returns null for a null extent", () => {
    expect(extentToBounds(null)).toBeNull();
  });
});

describe("bboxIntersectsBounds", () => {
  const view: [[number, number], [number, number]] = [
    [4, 51],
    [5, 52],
  ];

  it("is true for a bbox inside the bounds", () => {
    expect(bboxIntersectsBounds([4.2, 51.2, 4.8, 51.8], view)).toBe(true);
  });

  it("is true for a bbox containing the bounds", () => {
    expect(bboxIntersectsBounds([0, 0, 10, 60], view)).toBe(true);
  });

  it("is true for a partial overlap", () => {
    expect(bboxIntersectsBounds([4.5, 51.5, 6, 53], view)).toBe(true);
  });

  it("counts a touching edge as intersecting", () => {
    expect(bboxIntersectsBounds([3, 51, 4, 52], view)).toBe(true);
    expect(bboxIntersectsBounds([5, 51, 6, 52], view)).toBe(true);
    expect(bboxIntersectsBounds([4, 52, 5, 53], view)).toBe(true);
  });

  it("counts a touching corner as intersecting", () => {
    expect(bboxIntersectsBounds([3, 50, 4, 51], view)).toBe(true);
  });

  it("is false for a box east of the bounds", () => {
    expect(bboxIntersectsBounds([5.1, 51, 6, 52], view)).toBe(false);
  });

  it("is false for a box west of the bounds", () => {
    expect(bboxIntersectsBounds([2, 51, 3.9, 52], view)).toBe(false);
  });

  it("is false for a box north of the bounds", () => {
    expect(bboxIntersectsBounds([4, 52.1, 5, 53], view)).toBe(false);
  });

  it("is false for a box south of the bounds", () => {
    expect(bboxIntersectsBounds([4, 49, 5, 50.9], view)).toBe(false);
  });
});
