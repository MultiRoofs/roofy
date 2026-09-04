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
  fetchModelBytes,
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

// ---------------------------------------------------------------------------
// The LoadedModel envelope
// ---------------------------------------------------------------------------

describe("loadFromUrl's LoadedModel envelope", () => {
  const cityjson = JSON.stringify({
    type: "CityJSON",
    version: "2.0",
    CityObjects: {},
    vertices: [],
  });

  /** Keeps the array it serves, so a test can assert the loader handed that
   *  very array on rather than a re-encoded copy of it. */
  function http(body: string) {
    const bytes = new TextEncoder().encode(body);
    return {
      bytes,
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: body,
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes,
      }),
    };
  }

  it("carries the decoded bytes and the encoding for a CityJSON URL", async () => {
    const client = http(cityjson);
    const loaded = await loadFromUrl("https://x/a.city.json", client);
    expect(loaded.encoding).toBe("cityjson");
    // IDENTITY rather than `toBeInstanceOf(Uint8Array)`: the body was never
    // gzipped, so the fetched array IS the decoded one and no second copy is
    // allocated. (`instanceof` would be the wrong probe here anyway — under
    // jsdom a TextEncoder produces a NODE-realm Uint8Array that fails it
    // against the jsdom global. A test-realm artifact, not a property of the
    // value.)
    expect(loaded.bytes).toBe(client.bytes);
    expect(new TextDecoder().decode(loaded.bytes!)).toBe(cityjson);
    expect(loaded.model.sourceEncoding).toBe("cityjson");
  });

  it("says cityjsonseq for a .jsonl URL", async () => {
    // `seqFixtureText` is the real two-buildings fixture this file already
    // reads at the top — a hand-written one-liner would be a second, weaker
    // idea of what CityJSONSeq looks like.
    const loaded = await loadFromUrl(
      "https://x/a.city.jsonl",
      http(seqFixtureText),
    );
    expect(loaded.encoding).toBe("cityjsonseq");
    expect(loaded.bytes).not.toBeNull();
    expect(Object.keys(loaded.model.objects).length).toBeGreaterThan(0);
  });

  it("carries NO bytes for a CityGML document — it has no DuckDB reader", async () => {
    const gml = `<?xml version="1.0"?><CityModel xmlns="http://www.opengis.net/citygml/2.0"></CityModel>`;
    const loaded = await loadFromUrl("https://x/a.gml", http(gml));
    expect(loaded.encoding).toBe("citygml");
    expect(loaded.bytes).toBeNull();
  });
});

describe("fetchModelBytes", () => {
  it("GUNZIPS by magic bytes, not by extension — no DuckDB reader gunzips", async () => {
    const body =
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}';
    const gz = new Uint8Array(
      await new Response(
        new Response(
          new TextEncoder().encode(body) as BodyInit,
        ).body!.pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    // The URL says ".city.json", the BYTES say gzip. The bytes win.
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: "",
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: gz,
      }),
    });
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("returns the FETCHED array untouched when the body was not gzipped", async () => {
    const raw = new TextEncoder().encode(
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}',
    );
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: "",
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: raw,
      }),
    });
    // Identity, not equality: a second copy of a 300 MB file is the cost this
    // avoids, and `registerBuffer` is about to consume whichever array it gets.
    expect(bytes).toBe(raw);
  });

  it("returns the decoded bytes for an export re-registration", async () => {
    const body =
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}';
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: body,
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(body),
      }),
    });
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("keeps the friendly 404 sentence", async () => {
    await expect(
      fetchModelBytes("https://x/a.city.json", {
        fetchText: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: "",
        }),
        fetchBytes: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          bytes: new Uint8Array(),
        }),
      }),
    ).rejects.toThrow(/File not found \(404\)/);
  });
});
