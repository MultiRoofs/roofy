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
  it("offers None plus the four tile services and the DEM, with stable ids", () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual([
      "none",
      "osm",
      "esri-imagery",
      "carto-positron",
      "carto-dark",
      "elevation-heatmap",
    ]);
  });

  it("defaults to satellite imagery, so the globe is never black and never blown out", () => {
    // Two constraints at once. Navara's default photoreal scene adds
    // sky/stars/sun and NO imagery, so a "none" default would ship the exact
    // bug this catalogue exists to fix — hence a source. And under the
    // physical-atmosphere calibration (exposure ~10, the globe lit as unlit
    // albedo by the aerial-perspective pass) OSM's near-white cartographic
    // tiles read as blown paper, so the default is photographic.
    expect(DEFAULT_BASEMAP_ID).toBe("esri-imagery");
    expect(basemapById(DEFAULT_BASEMAP_ID).source).not.toBeNull();
  });

  it("keeps None empty — it is the one option that adds nothing", () => {
    const none = basemapById("none");
    expect(none.source).toBeNull();
    expect(none.attribution).toEqual([]);
  });

  it("gives every source a {z}/{x}/{y} template and a maxZoom", () => {
    for (const b of BASEMAPS) {
      if (b.source === null) continue;
      expect(b.source.url).toContain("{z}");
      expect(b.source.url).toContain("{x}");
      expect(b.source.url).toContain("{y}");
      expect(b.source.maxZoom).toBeGreaterThan(0);
      // Every IMAGERY option is a raster-tile service at the same ceiling; the
      // DEM is the one exception and is pinned on its own below.
      if (b.id === "elevation-heatmap") continue;
      expect(b.source.type).toBe("raster-tile");
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
    // Dark Matter is the same service under a different style, so it carries
    // exactly the same pair.
    expect(basemapById("carto-dark").attribution).toEqual([
      "© CARTO",
      "© OpenStreetMap contributors",
    ]);
  });

  it("gives Dark Matter CARTO's dark style, not Positron's light one", () => {
    // The two differ ONLY in the style segment of the path, which is exactly
    // the kind of copy-paste a test should hold still: the cyber theme picks
    // this entry by id and would silently render a white sheet at night.
    const dark = basemapById("carto-dark").source!;
    expect(dark.url).toBe(
      "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    );
    expect(basemapById("carto-positron").source!.url).toContain("light_all");
  });

  it("reads the elevation heatmap as DATA, not as imagery", () => {
    // The one option whose tiles are decoded rather than drawn: a `raster-dem`
    // source (512 px terrarium tiles) plus the `elevationHeatmap` block on the
    // `raster` layer that colourises them. Without the layer block the engine
    // renders the raw DEM bytes as a picture, which is not a heatmap.
    const dem = basemapById("elevation-heatmap");
    expect(dem.source).toEqual({
      type: "raster-dem",
      url: "https://terrain.reearth.land/terrarium/elevation/{z}/{x}/{y}.png",
      // A MARKER, not a decoder: `basemaps.ts` must stay importable under Node,
      // and `TERRARIUM_ELEVATION_DECODER` is an engine export. The viewport
      // resolves it (see navaraViewport.test.tsx).
      elevationDecoder: "terrarium",
      tileSize: 512,
      maxZoom: 15,
    });
    expect(dem.layer).toEqual({
      elevationHeatmap: {
        maxHeight: 3200,
        minHeight: 0,
        logarithmic: true,
        logBoundary: 1000,
      },
    });
  });

  it("gives no imagery option a layer block", () => {
    // `addBasemap` spreads `option.layer` into the layer descriptor, so a stray
    // block on an imagery entry would reach the engine as an unknown key.
    for (const b of BASEMAPS) {
      if (b.id === "elevation-heatmap") continue;
      expect(b.layer).toBeUndefined();
    }
  });

  it("credits the DEM's provider as well as the service", () => {
    // CC BY 4.0. The overlay's dedupe is by exact string and the geoid's line
    // names Mapterhorn only as the GEOID's source; here the elevation data is
    // the picture itself, so it carries its own credit.
    expect(basemapById("elevation-heatmap").attribution).toEqual([
      "Elevation: © Re:Earth Terrain",
      "© Mapterhorn, CC BY 4.0",
    ]);
  });

  it("gives every option at least one credit line, except None", () => {
    for (const b of BASEMAPS) {
      if (b.source === null) continue;
      expect(b.attribution.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the default for an unknown id rather than throwing", () => {
    // A stale share link or a hand-edited snapshot must not cost a scene.
    expect(basemapById("mapbox-satellite").id).toBe(DEFAULT_BASEMAP_ID);
  });
});
