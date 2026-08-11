/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * Engine-free: bounds are lng/lat degrees (GeodeticBounds), computed from the
 * layer's own data — Navara 0.0.5 exposes no bounds API on Layer/Source.
 */
import { describe, expect, it } from "vitest";
import { geoJsonBounds } from "../../../../src/features/geoLayers/geoLayerBounds";

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
