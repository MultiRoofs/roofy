import { describe, expect, it } from "vitest";
import {
  GEO_STABLE_FEATURE_KEY,
  normalizeGeoJsonDocument,
  publicGeoProperties,
  readGeoStableFeatureId,
} from "../../../../src/features/geoLayers/geoJsonRecords";

describe("normalizeGeoJsonDocument", () => {
  it("keeps unique typed ids and falls back safely for duplicates and missing ids", () => {
    const source = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 7,
          properties: { name: "number" },
          geometry: null,
        },
        {
          type: "Feature",
          id: "7",
          properties: { name: "string" },
          geometry: null,
        },
        { type: "Feature", id: "dup", properties: {}, geometry: null },
        { type: "Feature", id: "dup", properties: {}, geometry: null },
        { type: "Feature", properties: null, geometry: null },
      ],
    };
    const normalized = normalizeGeoJsonDocument(source);
    expect(normalized.featureIds).toEqual([
      "id:number:7",
      "id:string:7",
      "index:2",
      "index:3",
      "index:4",
    ]);
    expect(source.features[0]!.properties).toEqual({ name: "number" });
    const output = normalized.data as typeof source;
    expect(readGeoStableFeatureId(output.features[2]!.properties!)).toBe(
      "index:2",
    );
  });

  it("round-trips a user property colliding with the private key", () => {
    const source = {
      type: "Feature",
      properties: { name: "Park", [GEO_STABLE_FEATURE_KEY]: "user value" },
      geometry: null,
    };
    const output = normalizeGeoJsonDocument(source).data as typeof source;
    expect(readGeoStableFeatureId(output.properties!)).toBe("index:0");
    expect(publicGeoProperties(output.properties!)).toEqual({
      name: "Park",
      [GEO_STABLE_FEATURE_KEY]: "user value",
    });
    expect(source.properties[GEO_STABLE_FEATURE_KEY]).toBe("user value");
  });

  it("removes only renderer bookkeeping from visible properties", () => {
    expect(
      publicGeoProperties({
        name: "Park",
        [GEO_STABLE_FEATURE_KEY]: { stableId: "index:1", hasOriginal: false },
      }),
    ).toEqual({ name: "Park" });
  });
});
