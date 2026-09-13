import { describe, expect, it } from "vitest";
import {
  geoExportText,
  geoScopeCount,
} from "../../../../src/features/geoLayers/geoExport";
import { normalizeGeoJsonDocument } from "../../../../src/features/geoLayers/geoJsonRecords";
import { geoRecords } from "../../../../src/features/geoLayers/geoRecords";
import { mergeGeoDocumentProperties } from "../../../../src/features/geoLayers/geoLayerStore";
const name = `Al,pha\n"quoted"`;
const data = normalizeGeoJsonDocument({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a",
      properties: { name, tags: ["a", "b"] },
      geometry: null,
    },
    { type: "Feature", id: "b", properties: { name: "Beta" }, geometry: null },
  ],
}).data;
const matching = new Set(["id:string:b"]);
const selected = new Set(["id:string:a"]);
describe("vector export", () => {
  it("exports All, Matching and Selected from full source without private metadata", () => {
    expect(
      JSON.parse(geoExportText(data, "geojson", "all", matching, selected))
        .features,
    ).toHaveLength(2);
    expect(
      JSON.parse(geoExportText(data, "geojson", "matching", matching, selected))
        .features[0].properties,
    ).toEqual({ name: "Beta" });
    expect(
      JSON.parse(geoExportText(data, "geojson", "selected", matching, selected))
        .features[0].properties,
    ).toEqual({ name, tags: ["a", "b"] });
  });
  it("serializes source ids, nested values, quotes and newlines as CSV", () => {
    expect(geoScopeCount(geoRecords(data), "all", matching, selected)).toBe(2);
    const csv = geoExportText(data, "csv", "all", matching, selected);
    expect(csv).toContain("source_id");
    expect(csv).toContain('"a"');
    expect(csv).toContain('[""a"",""b""]');
    expect(csv).toContain('""quoted""');
    expect(csv).not.toContain("__roofy");
  });
  it("carries a run's computed properties into the GeoJSON it writes (§7.6)", () => {
    const merged = mergeGeoDocumentProperties(
      data,
      new Map([["id:string:a", { bld_buildings_n: 3 }]]),
    );
    const text = geoExportText(merged, "geojson", "all", matching, selected);
    expect(text).toContain('"bld_buildings_n":3');
    // The renderer's own bookkeeping is still not exported.
    expect(text).not.toContain("__roofy_stable_feature_id");
  });
});
