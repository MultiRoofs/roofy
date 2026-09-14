import { describe, expect, it } from "vitest";
import {
  GEO_STABLE_FEATURE_KEY,
  normalizeGeoJsonDocument,
  publicGeoDocument,
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

describe("publicGeoDocument", () => {
  const collection = (properties: Record<string, unknown>) => ({
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "a", properties, geometry: null },
      {
        type: "Feature",
        id: "b",
        properties: { name: "South" },
        geometry: null,
      },
    ],
  });

  it("takes a PREPARED document back to the properties the file had", () => {
    // The round trip a derived vector layer needs: prepare, then strip, then
    // prepare again — and the second preparation must see exactly what the
    // first one did, or it stamps an envelope over an envelope and the private
    // key becomes a visible attribute.
    const source = collection({ name: "North" });
    const prepared = normalizeGeoJsonDocument(source).data;
    const stripped = publicGeoDocument(prepared) as typeof source;
    expect(stripped.features[0]?.properties).toEqual({ name: "North" });
    const again = normalizeGeoJsonDocument(stripped).data as typeof source;
    expect(readGeoStableFeatureId(again.features[0]?.properties ?? {})).toBe(
      readGeoStableFeatureId(
        (prepared as typeof source).features[0]?.properties ?? {},
      ),
    );
    expect(publicGeoProperties(again.features[0]?.properties ?? {})).toEqual({
      name: "North",
    });
  });

  it("gives a file's OWN reserved key back, rather than eating it", () => {
    const prepared = normalizeGeoJsonDocument(
      collection({ name: "North", [GEO_STABLE_FEATURE_KEY]: "user value" }),
    ).data;
    const stripped = publicGeoDocument(prepared) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(stripped.features[0]?.properties).toEqual({
      name: "North",
      [GEO_STABLE_FEATURE_KEY]: "user value",
    });
  });

  it("leaves a document that carries no envelope exactly as it is", () => {
    const source = collection({ name: "North" });
    const out = publicGeoDocument(source) as typeof source;
    // Copy-on-write: an untouched feature keeps its identity.
    expect(out.features[0]).toBe(source.features[0]);
  });

  it("handles a bare Feature and a document that is neither", () => {
    const feature = normalizeGeoJsonDocument({
      type: "Feature",
      id: "a",
      properties: { name: "North" },
      geometry: null,
    }).data;
    expect(
      (publicGeoDocument(feature) as { properties: unknown }).properties,
    ).toEqual({ name: "North" });
    expect(publicGeoDocument(null)).toBeNull();
  });
});
