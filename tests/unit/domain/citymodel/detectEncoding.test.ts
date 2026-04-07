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
    expect(detectEncoding("https://example.com/data.city.jsonl?token=abc")).toBe("cityjsonseq");
  });

  it("handles URLs with fragments", () => {
    expect(detectEncoding("https://example.com/model.fcb#section")).toBe("flatcitybuf");
  });

  it("handles full URLs for CityJSON", () => {
    expect(detectEncoding("https://storage.googleapis.com/cityjson/delft.city.json")).toBe("cityjson");
  });

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(detectEncoding("Model.CITY.JSON")).toBe("cityjson");
    expect(detectEncoding("Data.JSONL")).toBe("cityjsonseq");
    expect(detectEncoding("Buildings.FCB")).toBe("flatcitybuf");
  });
});
