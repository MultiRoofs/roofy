/**
 * Pure normalisation of STAC Collection JSON.
 *
 * The cases below are the shapes the LIVE Open3D City catalog actually emits,
 * not invented ones: LoD arrays that are numbers in the degraded collections
 * and strings elsewhere, a non-numeric `"T"` LoD from Japan's PLATEAU, a
 * six-element bbox whose z values are sentinel garbage, collections that are
 * empty shells with no extent and no items mirror, and Zurich's bbox left in
 * projected EPSG:2056 metres. Every one of those has to survive without
 * throwing and without producing a card the map would then fly to the middle
 * of the Atlantic for.
 */
import { describe, expect, it } from "vitest";
import {
  cityObjectsTotal,
  collectionCardFromJson,
  extent2dFromCollection,
  flattenSummary,
  summaryBoolean,
  validBbox2d,
} from "../../../../src/features/stac/stacNormalize";

describe("flattenSummary", () => {
  it("keeps string arrays", () =>
    expect(flattenSummary(["0", "1.2"])).toEqual(["0", "1.2"]));
  it("coerces numeric arrays (degraded collections emit [2])", () =>
    expect(flattenSummary([1, 2, 3])).toEqual(["1", "2", "3"]));
  it("keeps non-numeric LoDs like Japan PLATEAU's 'T'", () =>
    expect(flattenSummary(["2", "T"])).toEqual(["2", "T"]));
  it("wraps scalars", () =>
    expect(flattenSummary("EPSG:7415")).toEqual(["EPSG:7415"]));
  it("flattens one level of nesting and drops objects/null/undefined", () =>
    expect(flattenSummary([["a"], "b", null, { min: 1 }])).toEqual(["a", "b"]));
  it("returns [] for absent", () =>
    expect(flattenSummary(undefined)).toEqual([]));
  it("dedupes while preserving order", () =>
    expect(flattenSummary(["2", "1", "2"])).toEqual(["2", "1"]));
  it("drops non-finite numbers", () =>
    expect(flattenSummary([Number.NaN, 1])).toEqual(["1"]));
});

describe("summaryBoolean", () => {
  it("unwraps [true]", () => expect(summaryBoolean([true])).toBe(true));
  it("unwraps [false] — false is a real answer, not 'unknown'", () =>
    expect(summaryBoolean([false])).toBe(false));
  it("passes bare booleans", () => {
    expect(summaryBoolean(true)).toBe(true);
    expect(summaryBoolean(false)).toBe(false);
  });
  it("null for a mixed array (some items have textures, some do not)", () =>
    expect(summaryBoolean([true, false])).toBeNull());
  it("null for absent and for non-booleans", () => {
    expect(summaryBoolean(undefined)).toBeNull();
    expect(summaryBoolean("true")).toBeNull();
    expect(summaryBoolean([])).toBeNull();
  });
});

describe("cityObjectsTotal", () => {
  it("reads {min,max,total}", () =>
    expect(cityObjectsTotal({ min: 2, max: 10370, total: 21555522 })).toBe(
      21555522,
    ));
  it("passes plain numbers", () => expect(cityObjectsTotal(873)).toBe(873));
  it("null otherwise", () => expect(cityObjectsTotal(["x"])).toBeNull());
  it("null for a stats object without a total", () =>
    expect(cityObjectsTotal({ min: 2, max: 10370 })).toBeNull());
});

describe("validBbox2d", () => {
  it("accepts a WGS84 box", () =>
    expect(validBbox2d(4.3, 52.0, 4.4, 52.1)).toEqual([4.3, 52.0, 4.4, 52.1]));
  it("rejects projected metres (Zurich EPSG:2056)", () =>
    expect(validBbox2d(2677116, 1241839, 2689381, 1254306)).toBeNull());
  it("rejects NaN and inverted boxes", () => {
    expect(validBbox2d(Number.NaN, 0, 1, 1)).toBeNull();
    expect(validBbox2d(5, 5, 4, 4)).toBeNull();
  });
  it("rejects a degenerate zero-area box", () =>
    expect(validBbox2d(4.3, 52.0, 4.3, 52.0)).toBeNull());
});

describe("extent2dFromCollection", () => {
  it("uses [0,1,3,4] of a 6-element bbox", () =>
    expect(
      extent2dFromCollection({
        extent: {
          spatial: { bbox: [[3.3, 50.7, -2147483.75, 7.2, 53.6, 331]] },
        },
      }),
    ).toEqual([3.3, 50.7, 7.2, 53.6]));
  it("uses a 4-element bbox as-is", () =>
    expect(
      extent2dFromCollection({
        extent: { spatial: { bbox: [[4, 52, 5, 53]] } },
      }),
    ).toEqual([4, 52, 5, 53]));
  it("null for a missing or oddly sized extent", () => {
    expect(extent2dFromCollection({})).toBeNull();
    expect(extent2dFromCollection(null)).toBeNull();
    expect(
      extent2dFromCollection({ extent: { spatial: { bbox: [[4, 52, 5]] } } }),
    ).toBeNull();
  });
});

describe("collectionCardFromJson", () => {
  const base =
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/collection.json";
  const json = {
    type: "Collection",
    id: "netherlands-3d-bag",
    title: "Netherlands 3D BAG",
    description: "All buildings.",
    license: "CC-BY-4.0",
    extent: { spatial: { bbox: [[3.3, 50.7, -2147483.75, 7.2, 53.6, 331]] } },
    summaries: {
      "proj:code": ["EPSG:7415"],
      "city3d:version": ["2.0"],
      "city3d:lods": ["0", "1.2", "1.3", "2.2"],
      "city3d:co_types": ["Building", "BuildingPart"],
      "city3d:textures": [false],
      "city3d:materials": [false],
      "city3d:semantic_surfaces": [true],
      "city3d:city_objects": { min: 2, max: 10370, total: 21555522 },
    },
    assets: {
      "items-geoparquet": {
        href: "./items.parquet",
        type: "application/vnd.apache.parquet",
        roles: ["collection-mirror"],
      },
    },
  };
  it("builds a full card with resolved parquet href", () => {
    const card = collectionCardFromJson(json, base)!;
    expect(card.id).toBe("netherlands-3d-bag");
    expect(card.extent2d).toEqual([3.3, 50.7, 7.2, 53.6]); // z values of the 6-elem bbox ignored
    expect(card.itemsParquetHref).toBe(
      "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/items.parquet",
    );
    expect(card.semanticSurfaces).toBe(true);
    expect(card.textures).toBe(false);
    expect(card.cityObjectsTotal).toBe(21555522);
    expect(card.collectionHref).toBe(base);
    expect(card.lods).toEqual(["0", "1.2", "1.3", "2.2"]);
    expect(card.coTypes).toEqual(["Building", "BuildingPart"]);
    expect(card.projCodes).toEqual(["EPSG:7415"]);
    expect(card.version).toBe("2.0");
    expect(card.license).toBe("CC-BY-4.0");
  });
  it("finds the parquet by type+role even under a different asset key", () => {
    const alt = {
      ...json,
      assets: {
        mirror: {
          href: "./items.parquet",
          type: "application/vnd.apache.parquet",
          roles: ["collection-mirror"],
        },
      },
    };
    expect(collectionCardFromJson(alt, base)!.itemsParquetHref).toMatch(
      /items\.parquet$/,
    );
  });
  it("null parquet href and null flags for an empty-shell collection", () => {
    const shell = {
      type: "Collection",
      id: "berlin-3d",
      title: "Berlin",
      description: "",
      extent: {},
      summaries: { "city3d:lods": [2] },
    };
    const card = collectionCardFromJson(shell, base)!;
    expect(card.itemsParquetHref).toBeNull();
    expect(card.lods).toEqual(["2"]);
    expect(card.semanticSurfaces).toBeNull();
    expect(card.extent2d).toBeNull();
  });
  it("falls back to the id for a missing title and to '' for a missing description", () => {
    const card = collectionCardFromJson({ id: "zurich-3d" }, base)!;
    expect(card.title).toBe("zurich-3d");
    expect(card.description).toBe("");
    expect(card.license).toBeNull();
    expect(card.version).toBeNull();
    expect(card.cityObjectsTotal).toBeNull();
  });
  it("returns null for junk", () =>
    expect(collectionCardFromJson({ hello: 1 }, base)).toBeNull());
});
