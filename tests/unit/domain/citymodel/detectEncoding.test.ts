import { describe, it, expect } from "vitest";
import { detectEncoding } from "../../../../src/domain/citymodel/detectEncoding";

describe("detectEncoding", () => {
  // CityJSON (default)
  it("detects .city.json as cityjson", () => {
    expect(detectEncoding("model.city.json")).toBe("cityjson");
  });

  it("detects .json as cityjson", () => {
    expect(detectEncoding("model.json")).toBe("cityjson");
  });

  it("defaults to cityjson for unknown extensions", () => {
    expect(detectEncoding("model.xyz")).toBe("cityjson");
  });

  // CityJSONSeq
  it("detects .city.jsonl as cityjsonseq", () => {
    expect(detectEncoding("model.city.jsonl")).toBe("cityjsonseq");
  });

  it("detects .jsonl as cityjsonseq", () => {
    expect(detectEncoding("data.jsonl")).toBe("cityjsonseq");
  });

  // FlatCityBuf
  it("detects .fcb as flatcitybuf", () => {
    expect(detectEncoding("buildings.fcb")).toBe("flatcitybuf");
  });

  // URLs with query strings and fragments
  it("handles URLs with query strings", () => {
    expect(
      detectEncoding("https://example.com/data.city.jsonl?token=abc"),
    ).toBe("cityjsonseq");
  });

  it("handles URLs with fragments", () => {
    expect(detectEncoding("https://example.com/model.fcb#section")).toBe(
      "flatcitybuf",
    );
  });

  it("handles full URLs for CityJSON", () => {
    expect(
      detectEncoding("https://storage.googleapis.com/cityjson/delft.city.json"),
    ).toBe("cityjson");
  });

  // CityGML
  it("detects .gml as citygml", () => {
    expect(detectEncoding("buildings.gml")).toBe("citygml");
  });

  it("detects .citygml as citygml", () => {
    expect(detectEncoding("buildings.citygml")).toBe("citygml");
  });

  it("handles CityGML URLs", () => {
    expect(
      detectEncoding("https://example.com/data/buildings.gml?token=abc"),
    ).toBe("citygml");
  });

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(detectEncoding("Model.CITY.JSON")).toBe("cityjson");
    expect(detectEncoding("Data.JSONL")).toBe("cityjsonseq");
    expect(detectEncoding("Buildings.FCB")).toBe("flatcitybuf");
    expect(detectEncoding("Buildings.GML")).toBe("citygml");
  });

  // Edge cases
  it("returns cityjson for an empty string", () => {
    expect(detectEncoding("")).toBe("cityjson");
  });

  it("returns cityjson for a filename with no extension", () => {
    expect(detectEncoding("modelfile")).toBe("cityjson");
  });

  it("handles path-only strings (no URL scheme)", () => {
    expect(detectEncoding("/data/model.city.jsonl")).toBe("cityjsonseq");
    expect(detectEncoding("/data/buildings.fcb")).toBe("flatcitybuf");
  });

  // Gzipped assets (STAC catalogs commonly serve *.city.json.gz)
  it("strips a trailing .gz before matching the extension", () => {
    expect(detectEncoding("tile.city.json.gz")).toBe("cityjson");
    expect(detectEncoding("tile.city.jsonl.gz")).toBe("cityjsonseq");
    expect(
      detectEncoding(
        "https://data.3dbag.nl/v1/tiles/10/1/2/t.city.json.gz?x=1",
      ),
    ).toBe("cityjson");
    expect(detectEncoding("model.gml.gz")).toBe("citygml");
  });

  // CityParquet
  it("detects .parquet as cityparquet", () => {
    expect(detectEncoding("model.parquet")).toBe("cityparquet");
    expect(detectEncoding("https://x/y/building.parquet")).toBe("cityparquet");
    expect(detectEncoding("Building.PARQUET")).toBe("cityparquet");
  });

  // The `.gz` strip runs first, so this routes to the CityParquet reader and
  // then fails there on the missing PAR1 magic — the honest outcome for a
  // gzipped parquet file, which the format does not define.
  it("routes .parquet.gz to cityparquet too", () => {
    expect(detectEncoding("model.parquet.gz")).toBe("cityparquet");
  });

  it("ignores extensions in query strings — only pathname matters", () => {
    expect(
      detectEncoding("https://example.com/data?file=model.city.jsonl"),
    ).toBe("cityjson");
  });
});
