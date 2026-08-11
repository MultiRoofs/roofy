/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * Engine-free: bounds are lng/lat degrees (GeodeticBounds), computed from the
 * layer's own data — Navara 0.0.5 exposes no bounds API on Layer/Source.
 */
import { describe, expect, it } from "vitest";
import {
  geoJsonBounds,
  tilesetBounds,
} from "../../../../src/features/geoLayers/geoLayerBounds";

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
