/**
 * Unified city model loading from text content or remote URLs.
 *
 * Keeps domain-level loading logic out of the app shell, making it
 * independently testable. Format detection delegates to detectEncoding.
 */

import type { CityModel } from "./types";
import type { HttpClient } from "../../platform/types";
import {
  parseCityJSON,
  parseCityJSONSeq,
  type CityJSONRoot,
} from "@cityjson/navara-core";
import { parseCityGML } from "./citygml/parseCityGML";
import { detectEncoding } from "./detectEncoding";

/**
 * Parse city model text content. Format is detected from the name/URL.
 */
export function parseText(nameOrUrl: string, text: string): CityModel {
  const encoding = detectEncoding(nameOrUrl);

  if (encoding === "cityjsonseq") {
    return parseCityJSONSeq(text);
  }

  if (encoding === "citygml") {
    return parseCityGML(text);
  }

  let json: CityJSONRoot;
  try {
    json = JSON.parse(text) as CityJSONRoot;
  } catch {
    throw new Error(
      "Invalid JSON \u2014 the file could not be parsed. Check that it is valid CityJSON.",
    );
  }
  if (json.type !== "CityJSON") {
    throw new Error('Not a CityJSON file \u2014 expected "type": "CityJSON".');
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error('Invalid CityJSON \u2014 missing "CityObjects" property.');
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error(
      'Invalid CityJSON \u2014 missing or invalid "vertices" array.',
    );
  }
  return parseCityJSON(json);
}

/** Default HttpClient using browser fetch. */
const defaultHttp: HttpClient = {
  async fetchText(url: string) {
    const response = await fetch(url);
    const text = response.ok ? await response.text() : "";
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
    };
  },

  async fetchBytes(url: string) {
    const response = await fetch(url);
    const bytes = response.ok
      ? new Uint8Array(await response.arrayBuffer())
      : new Uint8Array();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bytes,
    };
  },
};

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Gunzip when the payload carries gzip magic bytes (server sent the .gz file
 * verbatim); pass through otherwise (server already decompressed via
 * Content-Encoding, or the file was never gzipped).
 */
export async function decodeModelBytes(bytes: Uint8Array): Promise<string> {
  if (
    bytes.length > 2 &&
    bytes[0] === GZIP_MAGIC_0 &&
    bytes[1] === GZIP_MAGIC_1
  ) {
    // Response (not Blob) as the byte source: in tests the Response and
    // DecompressionStream globals come from the same (Node) realm, whereas
    // jsdom's Blob.stream() would brand-check-fail against Node's streams.
    const body = new Response(bytes as BodyInit).body;
    if (!body) return new TextDecoder().decode(bytes);
    return await new Response(
      body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Load a city model from a remote URL.
 *  - .fcb → NOT loaded here. FlatCityBuf files are streamed by viewport
 *    rather than loaded whole; this function throws a clear error instead
 *    of attempting a whole-file read. (The whole-file WASM reader this
 *    branch used to call has been removed; viewport streaming is not yet
 *    wired up to this entry point.)
 *  - .city.jsonl / .jsonl → CityJSONSeq (fetch + parse)
 *  - everything else → CityJSON (fetch + parse)
 *
 * The body is fetched as bytes and gunzipped when it carries gzip magic
 * bytes, so `*.city.json.gz` assets work whether the server hands back the
 * compressed file verbatim or already decompressed it via Content-Encoding.
 *
 * Accepts an optional HttpClient for platform abstraction (Tauri, testing).
 */
export async function loadFromUrl(
  url: string,
  http: HttpClient = defaultHttp,
): Promise<CityModel> {
  const encoding = detectEncoding(url);

  if (encoding === "flatcitybuf") {
    throw new Error(
      `FlatCityBuf (.fcb) files are loaded by viewport streaming, not as a single whole-file read, and that path is not wired up yet. Could not load "${fileNameFromUrl(url)}".`,
    );
  }

  let response: {
    ok: boolean;
    status: number;
    statusText: string;
    bytes: Uint8Array;
  };
  try {
    response = await http.fetchBytes(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new Error(
        `Network error loading "${fileNameFromUrl(url)}". Check that the URL is correct and accessible (CORS may block cross-origin requests).`,
        { cause: err },
      );
    }
    throw new Error(`Failed to load: ${msg}`, { cause: err });
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `File not found (404) at "${fileNameFromUrl(url)}". Check the URL.`,
      );
    }
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`,
    );
  }
  let text: string;
  try {
    text = await decodeModelBytes(response.bytes);
  } catch (err) {
    throw new Error(
      `Corrupt or truncated compressed data for "${fileNameFromUrl(url)}". The gzipped body could not be decompressed.`,
      { cause: err },
    );
  }

  if (encoding === "cityjsonseq") {
    return parseCityJSONSeq(text);
  }

  if (encoding === "citygml") {
    return parseCityGML(text);
  }

  let json: CityJSONRoot;
  try {
    json = JSON.parse(text) as CityJSONRoot;
  } catch {
    throw new Error(
      "Invalid JSON \u2014 the remote file could not be parsed. Check that it is valid CityJSON.",
    );
  }
  if (json.type !== "CityJSON") {
    throw new Error('Not a CityJSON file \u2014 expected "type": "CityJSON".');
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error('Invalid CityJSON \u2014 missing "CityObjects" property.');
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error(
      'Invalid CityJSON \u2014 missing or invalid "vertices" array.',
    );
  }
  return parseCityJSON(json);
}

/**
 * Extract a display-friendly file name from a URL.
 * Strips query strings, fragments, and leading path segments.
 */
export function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? url;
  } catch {
    const segments = url.split("/");
    return segments.at(-1) ?? url;
  }
}
