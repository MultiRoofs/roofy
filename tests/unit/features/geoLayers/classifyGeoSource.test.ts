/**
 * What a pasted URL IS, and what a dropped file is allowed to be.
 *
 * Both decisions are made from user input alone — no request is issued to find
 * out — so they are pure functions with a table test rather than UI behaviour.
 * The CityJSON rejection is the one that matters most in practice: a `.json`
 * city model dropped on the geospatial tab is the likeliest mistake in this
 * app, and "0 features" would be a far worse answer than a pointer to the
 * other tab.
 */
import { describe, expect, it } from "vitest";
import {
  classifyGeoUrl,
  geoLayerFromUrl,
  parseGeoJsonText,
} from "../../../../src/features/geoLayers/classifyGeoSource";

describe("classifyGeoUrl", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["https://tile.example/{z}/{x}/{y}.png", "raster-xyz"],
    ["https://tile.example/tiles/{Z}/{X}/{Y}@2x.jpg", "raster-xyz"],
    // One placeholder is enough to be a template — a service may hard-code
    // the others in the path.
    ["https://tile.example/12/{x}/{y}.png", "raster-xyz"],
    ["https://tiles.example/data/tileset.json", "3d-tiles"],
    ["https://tiles.example/data/TileSet.JSON", "3d-tiles"],
    // The query string is not part of the path, so a key does not hide the
    // tileset.
    ["https://tiles.example/data/tileset.json?key=abc", "3d-tiles"],
    ["https://example.com/roads.geojson", "geojson"],
    ["https://example.com/api/features?bbox=1,2,3,4", "geojson"],
    // A raster template WITH a tileset-looking tail is still a template:
    // nothing fetches a tileset per tile.
    ["https://x/{z}/{x}/{y}/tileset.json", "raster-xyz"],
  ];

  for (const [url, kind] of cases) {
    it(`classifies ${url} as ${kind}`, () => {
      expect(classifyGeoUrl(url)).toBe(kind);
    });
  }

  it("ignores surrounding whitespace", () => {
    expect(classifyGeoUrl("  https://x/{z}/{x}/{y}.png  ")).toBe("raster-xyz");
  });
});

describe("geoLayerFromUrl", () => {
  it("builds a raster-xyz layer whose config carries the template", () => {
    expect(geoLayerFromUrl("https://tile.example/{z}/{x}/{y}.png")).toEqual({
      name: "tile.example",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
  });

  it("names a file-shaped URL after its last path segment", () => {
    expect(geoLayerFromUrl("https://example.com/data/roads.geojson")).toEqual({
      name: "roads.geojson",
      kind: "geojson",
      config: { url: "https://example.com/data/roads.geojson" },
    });
  });

  it("builds a 3d-tiles layer from a tileset URL", () => {
    expect(geoLayerFromUrl("https://x/paris/tileset.json")).toEqual({
      name: "tileset.json",
      kind: "3d-tiles",
      config: { url: "https://x/paris/tileset.json" },
    });
  });

  it("honours an explicit kind override over the URL's own shape", () => {
    const layer = geoLayerFromUrl(
      "https://example.com/roads.geojson",
      "3d-tiles",
    );
    expect(layer).toEqual({
      name: "roads.geojson",
      kind: "3d-tiles",
      config: { url: "https://example.com/roads.geojson" },
    });
  });

  it("refuses an empty or unparseable URL", () => {
    expect(geoLayerFromUrl("   ")).toBeNull();
    expect(geoLayerFromUrl("not a url")).toBeNull();
  });
});

describe("parseGeoJsonText", () => {
  it("accepts a FeatureCollection", () => {
    const text = JSON.stringify({ type: "FeatureCollection", features: [] });
    expect(parseGeoJsonText(text)).toEqual({
      ok: true,
      data: { type: "FeatureCollection", features: [] },
    });
  });

  it("accepts a single Feature", () => {
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.35, 52.01] },
      properties: {},
    };
    const result = parseGeoJsonText(JSON.stringify(feature));
    expect(result.ok).toBe(true);
  });

  it("rejects a CityJSON document and points at the city-model tab", () => {
    const result = parseGeoJsonText(
      JSON.stringify({ type: "CityJSON", version: "2.0", CityObjects: {} }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("CityJSON");
    expect(result.error.toLowerCase()).toContain("city model");
  });

  it("rejects a bare geometry — a layer needs features, not one shape", () => {
    const result = parseGeoJsonText(
      JSON.stringify({ type: "Point", coordinates: [0, 0] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a FeatureCollection with no features array", () => {
    const result = parseGeoJsonText(
      JSON.stringify({ type: "FeatureCollection" }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects text that is not JSON at all", () => {
    const result = parseGeoJsonText("<html></html>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON");
  });
});
