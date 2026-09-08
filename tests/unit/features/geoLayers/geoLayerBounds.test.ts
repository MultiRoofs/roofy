/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * Engine-free: bounds are lng/lat degrees (GeodeticBounds), computed from the
 * layer's own data — Navara 0.0.5 exposes no bounds API on Layer/Source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geoJsonBounds,
  resetGeoLayerBoundsCache,
  resolveGeoLayerBounds,
  tilesetBounds,
} from "../../../../src/features/geoLayers/geoLayerBounds";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../../src/features/geoLayers/geoLayerStyle";

describe("geoJsonBounds", () => {
  it("frames a FeatureCollection across all geometry types", () => {
    const bounds = geoJsonBounds({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [4.3, 52.0] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [4.5, 52.2],
                [4.6, 52.3],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4.1, 51.9],
                [4.2, 51.9],
                [4.2, 52.1],
                [4.1, 51.9],
              ],
            ],
          },
        },
      ],
    });
    expect(bounds).toEqual({
      west: 4.1,
      south: 51.9,
      east: 4.6,
      north: 52.3,
      minHeight: 0,
      maxHeight: 0,
    });
  });

  it("frames a bare Feature and a bare geometry", () => {
    const feature = geoJsonBounds({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [10, 20] },
    });
    expect(feature?.west).toBe(10);
    expect(feature?.north).toBe(20);

    const geometry = geoJsonBounds({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [1, 2],
            [3, 4],
            [1, 2],
          ],
        ],
      ],
    });
    expect(geometry).toMatchObject({ west: 1, south: 2, east: 3, north: 4 });
  });

  it("descends into a GeometryCollection", () => {
    const bounds = geoJsonBounds({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [0, 0] },
        { type: "Point", coordinates: [2, 3] },
      ],
    });
    expect(bounds).toMatchObject({ west: 0, south: 0, east: 2, north: 3 });
  });

  it("ignores a coordinate z — heights stay zero", () => {
    const bounds = geoJsonBounds({
      type: "Point",
      coordinates: [4.3, 52.0, 87.5],
    });
    expect(bounds?.minHeight).toBe(0);
    expect(bounds?.maxHeight).toBe(0);
  });

  it("skips positions outside lng/lat range instead of framing them", () => {
    // A projected-CRS file (metres masquerading as degrees) must not produce
    // a "valid" box in the middle of the ocean at lat 84 000.
    const bounds = geoJsonBounds({
      type: "Point",
      coordinates: [85000, 447000],
    });
    expect(bounds).toBeNull();
  });

  it("answers null for junk, empties and non-GeoJSON", () => {
    expect(geoJsonBounds(null)).toBeNull();
    expect(geoJsonBounds("not geojson")).toBeNull();
    expect(
      geoJsonBounds({ type: "FeatureCollection", features: [] }),
    ).toBeNull();
    expect(
      geoJsonBounds({ type: "Feature", properties: {}, geometry: null }),
    ).toBeNull();
    expect(
      geoJsonBounds({ type: "Point", coordinates: [Number.NaN, 1] }),
    ).toBeNull();
  });
});

describe("tilesetBounds", () => {
  it("converts a region volume from radians to degrees, keeping heights", () => {
    // ~lng 4.29–4.44, lat 51.98–52.03 (Delft-ish), heights 0–120 m.
    const bounds = tilesetBounds({
      asset: { version: "1.0" },
      root: {
        boundingVolume: {
          region: [0.074875, 0.907275, 0.077493, 0.908147, 0, 120],
        },
      },
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.west).toBeCloseTo((0.074875 * 180) / Math.PI, 6);
    expect(bounds!.east).toBeCloseTo((0.077493 * 180) / Math.PI, 6);
    expect(bounds!.south).toBeCloseTo((0.907275 * 180) / Math.PI, 6);
    expect(bounds!.north).toBeCloseTo((0.908147 * 180) / Math.PI, 6);
    expect(bounds!.minHeight).toBe(0);
    expect(bounds!.maxHeight).toBe(120);
  });

  it("frames a sphere volume around its ECEF centre", () => {
    // ECEF (6378137, 0, 0) is lng 0, lat 0, height 0 on the WGS84 ellipsoid.
    const bounds = tilesetBounds({
      root: { boundingVolume: { sphere: [6378137, 0, 0, 1000] } },
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.west).toBeLessThan(0);
    expect(bounds!.east).toBeGreaterThan(0);
    expect((bounds!.west + bounds!.east) / 2).toBeCloseTo(0, 4);
    expect((bounds!.south + bounds!.north) / 2).toBeCloseTo(0, 4);
    // 1000 m ≈ 0.009° of latitude.
    expect(bounds!.north - bounds!.south).toBeCloseTo((2 * 1000) / 111_320, 3);
    expect(bounds!.maxHeight).toBeCloseTo(1000, 0);
  });

  it("frames a box volume by its half-diagonal", () => {
    const bounds = tilesetBounds({
      root: {
        boundingVolume: {
          box: [6378137, 0, 0, 300, 0, 0, 0, 400, 0, 0, 0, 0],
        },
      },
    });
    expect(bounds).not.toBeNull();
    // hypot(300, 400) = 500 m radius.
    expect(bounds!.north - bounds!.south).toBeCloseTo((2 * 500) / 111_320, 3);
  });

  it("answers null for junk and absent volumes", () => {
    expect(tilesetBounds(null)).toBeNull();
    expect(tilesetBounds({})).toBeNull();
    expect(tilesetBounds({ root: {} })).toBeNull();
    expect(tilesetBounds({ root: { boundingVolume: {} } })).toBeNull();
    expect(
      tilesetBounds({ root: { boundingVolume: { region: [0, 1] } } }),
    ).toBeNull();
    expect(
      tilesetBounds({
        root: { boundingVolume: { sphere: [Number.NaN, 0, 0, 1] } },
      }),
    ).toBeNull();
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

function geoJsonLayer(config: { data?: unknown; url?: string }): GeoLayer {
  return {
    id: "g1",
    name: "roads",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config,
  };
}

describe("resolveGeoLayerBounds", () => {
  afterEach(() => {
    resetGeoLayerBoundsCache();
  });

  it("answers inline GeoJSON without touching the network", async () => {
    const fetchFn = vi.fn();
    const bounds = await resolveGeoLayerBounds(
      geoJsonLayer({ data: { type: "Point", coordinates: [4, 52] } }),
      fetchFn as unknown as typeof fetch,
    );
    expect(bounds).toMatchObject({ west: 4, north: 52 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches a URL-backed GeoJSON layer, and caches by URL", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ type: "Point", coordinates: [5, 50] }),
    );
    const layer = geoJsonLayer({ url: "https://x/roads.geojson" });

    const first = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    const second = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );

    expect(first).toMatchObject({ west: 5, south: 50 });
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fetches a tileset.json for a 3d-tiles layer", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        root: { boundingVolume: { sphere: [6378137, 0, 0, 500] } },
      }),
    );
    const layer: GeoLayer = {
      id: "t1",
      name: "tiles",
      kind: "3d-tiles",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { url: "https://x/tileset.json" },
    };
    const bounds = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    expect(bounds).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledWith("https://x/tileset.json");
  });

  it("resolves null for raster-xyz by contract, without fetching", async () => {
    const fetchFn = vi.fn();
    const layer: GeoLayer = {
      id: "r1",
      name: "osm",
      kind: "raster-xyz",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { urlTemplate: "https://tile/{z}/{x}/{y}.png" },
    };
    expect(
      await resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does NOT cache a failure — the next click retries", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        jsonResponse({ type: "Point", coordinates: [1, 2] }),
      );
    const layer = geoJsonLayer({ url: "https://x/flaky.geojson" });

    await expect(
      resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow("offline");
    const retry = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    expect(retry).toMatchObject({ west: 1, south: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects on an HTTP error status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false));
    const layer = geoJsonLayer({ url: "https://x/404.geojson" });
    await expect(
      resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("resolves null for a 3d-tiles layer with an empty url, without fetching", async () => {
    // `fetch("")` would fetch the APP PAGE, then fail in `.json()` — a network
    // rejection wording a "the source did not load" toast for a layer that
    // simply names no source. Mirrors the geojson arm.
    const fetchFn = vi.fn();
    const layer: GeoLayer = {
      id: "t2",
      name: "tiles",
      kind: "3d-tiles",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { url: "" },
    };
    expect(
      await resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("resolves null for a geojson layer with neither data nor url", async () => {
    expect(
      await resolveGeoLayerBounds(geoJsonLayer({}), vi.fn() as never),
    ).toBeNull();
  });
});

describe("selectedGeoJsonBounds", () => {
  it("uses only selected prepared feature coordinates", async () => {
    const { selectedGeoJsonBounds } =
      await import("../../../../src/features/geoLayers/geoLayerBounds");
    expect(
      selectedGeoJsonBounds(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { __roofy_stable_feature_id: { stableId: "a" } },
              geometry: { type: "Point", coordinates: [4, 52] },
            },
            {
              type: "Feature",
              properties: { __roofy_stable_feature_id: { stableId: "b" } },
              geometry: { type: "Point", coordinates: [8, 55] },
            },
          ],
        },
        new Set(["b"]),
      ),
    ).toMatchObject({ west: 8, east: 8, south: 55, north: 55 });
  });
});
