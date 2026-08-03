/**
 * The basemap catalogue is pure data, and every field in it is either a
 * licence obligation or a URL the engine will fetch thousands of times — so it
 * is pinned here rather than only in the browser smoke.
 */
import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  basemapById,
} from "../../../src/scene/basemaps";

describe("basemaps", () => {
  it("offers None plus the three tile services, with stable ids", () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual([
      "none",
      "osm",
      "esri-imagery",
      "carto-positron",
    ]);
  });

  it("defaults to OpenStreetMap, so the globe is never black on first paint", () => {
    // Navara's default photoreal scene adds sky/stars/sun and NO imagery; a
    // "none" default would ship the exact bug this catalogue exists to fix.
    expect(DEFAULT_BASEMAP_ID).toBe("osm");
    expect(basemapById(DEFAULT_BASEMAP_ID).source).not.toBeNull();
  });

  it("keeps None empty — it is the one option that adds nothing", () => {
    const none = basemapById("none");
    expect(none.source).toBeNull();
    expect(none.attribution).toEqual([]);
  });

  it("gives every tile service a {z}/{x}/{y} template and a maxZoom", () => {
    for (const b of BASEMAPS) {
      if (b.source === null) continue;
      expect(b.source.type).toBe("raster-tile");
      expect(b.source.url).toContain("{z}");
      expect(b.source.url).toContain("{x}");
      expect(b.source.url).toContain("{y}");
      expect(b.source.maxZoom).toBe(19);
    }
  });

  it("uses Esri's {z}/{y}/{x} axis order, which is NOT the usual one", () => {
    // Swapping x and y here yields tiles from the wrong place, silently.
    expect(basemapById("esri-imagery").source!.url).toMatch(/{z}\/{y}\/{x}$/);
  });

  it("credits every service it fetches from — a licence obligation", () => {
    expect(basemapById("osm").attribution).toEqual([
      "© OpenStreetMap contributors",
    ]);
    // The service's own `copyrightText`, verbatim — the imagery is a
    // composite and a shortened "© Esri" under-credits the other sources.
    expect(basemapById("esri-imagery").attribution).toEqual([
      "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    ]);
    // CARTO's basemaps are OSM-derived, so BOTH credits are required.
    expect(basemapById("carto-positron").attribution).toEqual([
      "© CARTO",
      "© OpenStreetMap contributors",
    ]);
  });

  it("falls back to the default for an unknown id rather than throwing", () => {
    // A stale share link or a hand-edited snapshot must not cost a scene.
    expect(basemapById("mapbox-satellite").id).toBe(DEFAULT_BASEMAP_ID);
  });
});
