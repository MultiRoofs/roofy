// @vitest-environment node
/**
 * Gzip-aware remote loading tests.
 *
 * Runs under the Node environment (not jsdom) so `Response`,
 * `DecompressionStream` and the WHATWG streams all come from the same realm:
 * jsdom supplies its own `Blob`/`Response` that brand-check-fail against
 * Node's `DecompressionStream`. Nothing here is stubbed or polyfilled — the
 * real gunzip runs, so a broken implementation fails the test.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import {
  loadFromUrl,
  decodeModelBytes,
} from "../../../../src/domain/citymodel/loadCityModel";

const cjFixtureText = fs.readFileSync(
  path.resolve(
    import.meta.dirname!,
    "../../../../fixtures/two-buildings.city.json",
  ),
  "utf-8",
);

/**
 * Envelope fake mirroring the real fetchBytes contract: never throws on
 * non-2xx, returns { ok, status, statusText, bytes } and lets loadFromUrl
 * branch on it.
 */
function okBytes(bytes: Uint8Array) {
  return {
    fetchText: async () => {
      throw new Error("unused");
    },
    fetchBytes: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      bytes,
    }),
  };
}

describe("loadFromUrl (gzip)", () => {
  it("gunzips a body that still carries gzip magic bytes", async () => {
    const gzipped = new Uint8Array(gzipSync(Buffer.from(cjFixtureText)));
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);
    const model = await loadFromUrl(
      "https://example.com/tile.city.json.gz",
      okBytes(gzipped),
    );
    expect(Object.keys(model.objects).length).toBeGreaterThan(0);
  });

  it("passes plain (already-decompressed) bytes through as text", async () => {
    const model = await loadFromUrl(
      "https://example.com/tile.city.json.gz",
      okBytes(new TextEncoder().encode(cjFixtureText)),
    );
    expect(Object.keys(model.objects).length).toBeGreaterThan(0);
  });

  it("gunzips a gzipped CityJSONSeq body (.city.jsonl.gz)", async () => {
    const seqText = fs.readFileSync(
      path.resolve(
        import.meta.dirname!,
        "../../../../fixtures/two-buildings.city.jsonl",
      ),
      "utf-8",
    );
    const model = await loadFromUrl(
      "https://example.com/tile.city.jsonl.gz",
      okBytes(new Uint8Array(gzipSync(Buffer.from(seqText)))),
    );
    expect(model.sourceEncoding).toBe("cityjsonseq");
    expect(Object.keys(model.objects).length).toBeGreaterThan(0);
  });
});

describe("decodeModelBytes", () => {
  it("round-trips gzipped UTF-8 text", async () => {
    const text = "héllo — city";
    const gz = new Uint8Array(gzipSync(Buffer.from(text, "utf-8")));
    expect(await decodeModelBytes(gz)).toBe(text);
  });

  it("decodes plain UTF-8 bytes unchanged", async () => {
    const text = "héllo — city";
    expect(await decodeModelBytes(new TextEncoder().encode(text))).toBe(text);
  });

  it("returns an empty string for empty bytes", async () => {
    expect(await decodeModelBytes(new Uint8Array())).toBe("");
  });
});
