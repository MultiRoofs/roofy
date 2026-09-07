/**
 * What a name or a URL IS, before anything is fetched.
 *
 * One table, one answer: the Add Layer dialog shows this result to the user
 * ("Detected: CityJSON") and hands the very same value to the loader as an
 * override, so a wrong guess is one select away from being corrected rather
 * than a failed load. The three classifiers it composes are tested in their
 * own suites; what is pinned here is the ORDER they are consulted in, which
 * is the only thing that decides an ambiguous name.
 */
import { describe, expect, it } from "vitest";
import {
  SOURCE_OVERRIDES,
  detectSourceFromName,
  sourceKey,
  type DetectedSource,
} from "../../../../src/features/layers/detectSource";

/** The table. Left: what the user dropped or pasted. Right: what it is. */
const CASES: ReadonlyArray<readonly [string, DetectedSource]> = [
  // ---- CityJSON, and the plain `.json` that is the common spelling --------
  [
    "delft.city.json",
    { kind: "city", encoding: "cityjson", label: "CityJSON" },
  ],
  ["model.json", { kind: "city", encoding: "cityjson", label: "CityJSON" }],
  [
    "https://example.com/model.city.json?token=abc",
    { kind: "city", encoding: "cityjson", label: "CityJSON" },
  ],
  [
    "https://example.com/model.city.json.gz",
    { kind: "city", encoding: "cityjson", label: "CityJSON" },
  ],

  // ---- CityJSONSeq -------------------------------------------------------
  [
    "delft.city.jsonl",
    { kind: "city", encoding: "cityjsonseq", label: "CityJSONSeq" },
  ],
  [
    "tile.jsonl",
    { kind: "city", encoding: "cityjsonseq", label: "CityJSONSeq" },
  ],
  [
    "https://example.com/tile.city.jsonl.gz",
    { kind: "city", encoding: "cityjsonseq", label: "CityJSONSeq" },
  ],

  // ---- FlatCityBuf: the label says what makes it different ---------------
  [
    "delft.fcb",
    {
      kind: "city",
      encoding: "flatcitybuf",
      label: "FlatCityBuf · streams as the camera moves",
    },
  ],

  // ---- CityParquet: an extension, or a bucket/directory SHAPE ------------
  [
    "building.parquet",
    { kind: "city", encoding: "cityparquet", label: "CityParquet" },
  ],
  [
    "gs://bucket/delft/*.parquet",
    { kind: "city", encoding: "cityparquet", label: "CityParquet" },
  ],
  [
    "s3://bucket/delft/",
    { kind: "city", encoding: "cityparquet", label: "CityParquet" },
  ],
  [
    "https://example.com/delft/metadata.json",
    { kind: "city", encoding: "cityparquet", label: "CityParquet" },
  ],
  [
    "https://example.com/delft/",
    { kind: "city", encoding: "cityparquet", label: "CityParquet" },
  ],

  // ---- CityGML, plain and in the container it usually ships in -----------
  ["delft.gml", { kind: "city", encoding: "citygml", label: "CityGML" }],
  ["delft.citygml", { kind: "city", encoding: "citygml", label: "CityGML" }],
  ["delft.zip", { kind: "city", encoding: "citygml", label: "CityGML (zip)" }],

  // ---- Geospatial: checked BEFORE the CityJSON default -------------------
  ["parcels.geojson", { kind: "geo", geoKind: "geojson", label: "GeoJSON" }],
  [
    "https://example.com/parcels.geojson?key=1",
    { kind: "geo", geoKind: "geojson", label: "GeoJSON" },
  ],
  [
    "https://tile.example/{z}/{x}/{y}.png",
    { kind: "geo", geoKind: "raster-xyz", label: "XYZ raster tiles" },
  ],
  // A template whose tail says "json" is still a template: nothing fetches
  // one tileset per tile.
  [
    "https://tile.example/{z}/{x}/{y}/tileset.json",
    { kind: "geo", geoKind: "raster-xyz", label: "XYZ raster tiles" },
  ],
  [
    "https://tiles.example/paris/tileset.json",
    { kind: "geo", geoKind: "3d-tiles", label: "3D Tiles" },
  ],
  [
    "https://tiles.example/paris/tileset.json?key=abc",
    { kind: "geo", geoKind: "3d-tiles", label: "3D Tiles" },
  ],

  // ---- And the honest answer for everything else -------------------------
  ["notes.txt", { kind: "unknown", label: "Unknown format" }],
  [
    "https://api.example/features?bbox=1,2,3,4",
    { kind: "unknown", label: "Unknown format" },
  ],
  ["", { kind: "unknown", label: "Unknown format" }],
];

describe("detectSourceFromName", () => {
  it.each(CASES)("classifies %s", (input, expected) => {
    expect(detectSourceFromName(input)).toEqual(expected);
  });
});

describe("SOURCE_OVERRIDES", () => {
  it("offers every format the app can load, city first", () => {
    expect(SOURCE_OVERRIDES.map((s) => s.label)).toEqual([
      "CityJSON",
      "CityJSONSeq",
      "FlatCityBuf · streams as the camera moves",
      "CityParquet",
      "CityGML",
      "GeoJSON",
      "XYZ raster tiles",
      "3D Tiles",
    ]);
  });

  it("never offers `unknown` — it is a detection outcome, not a choice", () => {
    expect(SOURCE_OVERRIDES.some((s) => s.kind === "unknown")).toBe(false);
  });

  it("keys options by format, not by label — the zip CityGML picks the CityGML option", () => {
    const zip = detectSourceFromName("delft.zip");
    const options = SOURCE_OVERRIDES.map(sourceKey);
    expect(options).toContain(sourceKey(zip));
    // Every option is distinct, so a `<select>` value identifies exactly one.
    expect(new Set(options).size).toBe(options.length);
  });
});
