import { describe, expect, it } from "vitest";
import {
  filterGeoRecords,
  GEO_RECORD_ID,
  geoRecordId,
  geoRecords,
  type GeoRecord,
} from "../../../../src/features/geoLayers/geoRecords";
import { normalizeGeoJsonDocument } from "../../../../src/features/geoLayers/geoJsonRecords";

describe("geoRecords", () => {
  const source = normalizeGeoJsonDocument({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "a",
        properties: { name: "Alpha", height: 12 },
        geometry: null,
      },
      {
        type: "Feature",
        id: "b",
        properties: { name: "Beta", height: 24 },
        geometry: null,
      },
    ],
  }).data;
  it("uses prepared stable identities and keeps all user attributes", () => {
    const records = geoRecords(source);
    expect(records.map(geoRecordId)).toEqual(["id:string:a", "id:string:b"]);
    expect(records.map((record) => record.id)).toEqual([undefined, undefined]);
  });
  it("keeps SQL-like null and numeric comparison semantics", () => {
    const records = [
      { [GEO_RECORD_ID]: "a", height: null, name: "x" },
      { [GEO_RECORD_ID]: "b", height: "not-number", name: "y" },
    ] as GeoRecord[];
    expect(
      filterGeoRecords(records, {
        logic: "AND",
        conditions: [{ id: "1", column: "height", op: "<", value: 10 }],
      }),
    ).toEqual([]);
    expect(
      filterGeoRecords(records, {
        logic: "AND",
        conditions: [{ id: "1", column: "height", op: "isNull", value: "" }],
      }).map(geoRecordId),
    ).toEqual(["a"]);
  });
  it("filters full source records rather than a page or batch identity", () => {
    expect(
      filterGeoRecords(geoRecords(source), {
        logic: "AND",
        conditions: [{ id: "1", column: "height", op: ">", value: 20 }],
      }),
    ).toEqual([expect.objectContaining({ name: "Beta", height: 24 })]);
  });
});
