import { describe, it, expect } from "vite-plus/test";
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

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(detectEncoding("Model.CITY.JSON")).toBe("cityjson");
    expect(detectEncoding("Data.JSONL")).toBe("cityjsonseq");
    expect(detectEncoding("Buildings.FCB")).toBe("flatcitybuf");
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

  it("ignores extensions in query strings — only pathname matters", () => {
    expect(
      detectEncoding("https://example.com/data?file=model.city.jsonl"),
    ).toBe("cityjson");
  });
});
