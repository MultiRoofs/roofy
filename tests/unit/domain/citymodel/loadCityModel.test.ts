/**
 * Unit tests for parseText and fileNameFromUrl.
 *
 * These are pure domain functions extracted from the app shell
 * for testability. loadFromUrl requires fetch mocking and is
 * tested at a higher level.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseText,
  fileNameFromUrl,
  loadFromUrl,
} from "../../../../src/domain/citymodel/loadCityModel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cjFixturePath = path.resolve(
  import.meta.dirname!,
  "../../../../fixtures/two-buildings.city.json",
);
const cjFixtureText = fs.readFileSync(cjFixturePath, "utf-8");

const seqFixturePath = path.resolve(
  import.meta.dirname!,
  "../../../../fixtures/two-buildings.city.jsonl",
);
const seqFixtureText = fs.readFileSync(seqFixturePath, "utf-8");

// ---------------------------------------------------------------------------
// parseText
// ---------------------------------------------------------------------------

describe("parseText", () => {
  it("parses CityJSON when name ends with .city.json", () => {
    const model = parseText("model.city.json", cjFixtureText);
    expect(model.sourceEncoding).toBe("cityjson");
    expect(Object.keys(model.objects)).toHaveLength(3);
  });

  it("parses CityJSONSeq when name ends with .city.jsonl", () => {
    const model = parseText("model.city.jsonl", seqFixtureText);
    expect(model.sourceEncoding).toBe("cityjsonseq");
    expect(Object.keys(model.objects)).toHaveLength(3);
  });

  it("parses CityJSONSeq when name ends with .jsonl", () => {
    const model = parseText("data.jsonl", seqFixtureText);
    expect(model.sourceEncoding).toBe("cityjsonseq");
  });

  it("works with a full URL as the name", () => {
    const model = parseText(
      "https://example.com/data.city.jsonl?token=abc",
      seqFixtureText,
    );
    expect(model.sourceEncoding).toBe("cityjsonseq");
  });

  it("throws for non-CityJSON content with .json extension", () => {
    expect(() => parseText("data.json", '{"type":"NotCityJSON"}')).toThrow(
      /Not a CityJSON file/,
    );
  });

  it("throws descriptive error for invalid JSON", () => {
    expect(() => parseText("model.city.json", "not json")).toThrow(
      /Invalid JSON/,
    );
  });

  it("throws for CityJSON missing CityObjects", () => {
    const noObjects = JSON.stringify({
      type: "CityJSON",
      version: "2.0",
      vertices: [],
    });
    expect(() => parseText("model.city.json", noObjects)).toThrow(
      /missing "CityObjects"/,
    );
  });

  it("throws for CityJSON missing vertices", () => {
    const noVertices = JSON.stringify({
      type: "CityJSON",
      version: "2.0",
      CityObjects: {},
    });
    expect(() => parseText("model.city.json", noVertices)).toThrow(
      /missing or invalid "vertices"/,
    );
  });
});

// ---------------------------------------------------------------------------
// loadFromUrl
// ---------------------------------------------------------------------------

describe("loadFromUrl", () => {
  it("throws a clear, honest error for .fcb instead of attempting a whole-file read", async () => {
    // Checked before any fetch, so no HttpClient/network mocking is needed
    // here — the rejection happens purely from encoding detection.
    await expect(loadFromUrl("https://example.com/delft.fcb")).rejects.toThrow(
      /viewport streaming/,
    );
  });

  it("keeps the friendly 404 message on the bytes path", async () => {
    // Envelope fake mirrors the real fetchBytes contract: never throws on
    // non-2xx, returns { ok, status, statusText, bytes }.
    const http = {
      fetchText: async () => {
        throw new Error("unused");
      },
      fetchBytes: async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        bytes: new Uint8Array(),
      }),
    };
    await expect(
      loadFromUrl("https://example.com/gone.city.json", http),
    ).rejects.toThrow(/not found \(404\)/i);
  });
});

// ---------------------------------------------------------------------------
// fileNameFromUrl
// ---------------------------------------------------------------------------

describe("fileNameFromUrl", () => {
  it("extracts filename from a simple URL", () => {
    expect(fileNameFromUrl("https://example.com/model.city.json")).toBe(
      "model.city.json",
    );
  });

  it("strips query strings", () => {
    expect(fileNameFromUrl("https://example.com/data.fcb?token=abc")).toBe(
      "data.fcb",
    );
  });

  it("strips fragments", () => {
    expect(fileNameFromUrl("https://example.com/data.city.jsonl#section")).toBe(
      "data.city.jsonl",
    );
  });

  it("handles URLs with nested paths", () => {
    expect(
      fileNameFromUrl("https://storage.example.com/v2/buildings/delft.fcb"),
    ).toBe("delft.fcb");
  });

  it("falls back to full string for non-URL input", () => {
    expect(fileNameFromUrl("not-a-url")).toBe("not-a-url");
  });

  it("handles trailing slash", () => {
    expect(fileNameFromUrl("https://example.com/data/")).toBe("data");
  });
});
