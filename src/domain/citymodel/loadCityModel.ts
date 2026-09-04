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
import { isZipBytes, parseCityGmlArchive } from "./cityGmlArchive";
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
 * Does this payload carry gzip magic?
 *
 * Exported because it decides whether a caller needs a SECOND copy of the
 * bytes: when the answer is false, the array that was fetched or read IS the
 * decoded array, and `TextEncoder().encode(new TextDecoder().decode(bytes))`
 * would allocate a duplicate of a file that can be hundreds of megabytes for
 * no gain at all.
 */
export function isGzipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
  );
}

/**
 * Gunzip when the payload carries gzip magic bytes (server sent the .gz file
 * verbatim); pass through otherwise (server already decompressed via
 * Content-Encoding, or the file was never gzipped).
 */
export async function decodeModelBytes(bytes: Uint8Array): Promise<string> {
  if (isGzipBytes(bytes)) {
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
 * A loaded model PLUS the bytes it was decoded from.
 *
 * The bytes travel because the analytics table wants them and the loader is
 * the only place that has them: registering the buffer DuckDB reads means a
 * URL layer is never downloaded twice, and `read_cityjson` over a remote URL
 * — never exercised in wasm, CORS-dependent — is never used at all.
 *
 * `bytes` is null exactly where there is no DuckDB reader for the format: a
 * CityGML document and a ZIP archive of them both take the flat fallback.
 */
export interface LoadedModel {
  readonly model: CityModel;
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
}

/** The fetch, its friendly failures, and nothing else — shared by
 *  {@link loadFromUrl} and {@link fetchModelBytes}. Returns the RAW body, so
 *  the ZIP branch can still see its magic bytes. */
async function fetchRawBody(
  url: string,
  http: HttpClient,
): Promise<Uint8Array> {
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
  return response.bytes;
}

/** {@link decodeModelBytes}, with the raw `DecompressionStream` failure
 *  translated into the sentence every other branch of this module speaks. */
async function decodeOrExplain(
  url: string,
  bytes: Uint8Array,
): Promise<string> {
  try {
    return await decodeModelBytes(bytes);
  } catch (err) {
    throw new Error(
      `Corrupt or truncated compressed data for "${fileNameFromUrl(url)}". The gzipped body could not be decompressed.`,
      { cause: err },
    );
  }
}

/**
 * Load a city model from a remote URL.
 *  - .fcb → NOT loaded here. FlatCityBuf files are streamed by viewport
 *    rather than loaded whole; this function throws a clear error instead
 *    of attempting a whole-file read. (The whole-file WASM reader this
 *    branch used to call has been removed; viewport streaming is not yet
 *    wired up to this entry point.)
 *  - .city.jsonl / .jsonl → CityJSONSeq (fetch + parse)
 *  - a body with ZIP magic → unzipped and parsed as CityGML, whatever the
 *    extension said (see cityGmlArchive.ts)
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
): Promise<LoadedModel> {
  const encoding = detectEncoding(url);

  if (encoding === "flatcitybuf") {
    throw new Error(
      `FlatCityBuf (.fcb) files are loaded by viewport streaming, not as a single whole-file read, and that path is not wired up yet. Could not load "${fileNameFromUrl(url)}".`,
    );
  }

  const raw = await fetchRawBody(url, http);

  // BEFORE `decodeModelBytes` and before the encoding switch: a ZIP is a
  // CONTAINER, and only its bytes say so. Its magic is not gzip's, so
  // `decodeModelBytes` would TextDecode the archive into mojibake and hand
  // that to whichever parser the extension guessed — for `.zip` that is the
  // `detectEncoding` default, JSON. Everything above this point (the CORS
  // sentence, the 404 branch) is inherited unchanged.
  if (isZipBytes(raw)) {
    return {
      model: parseCityGmlArchive(raw, fileNameFromUrl(url)),
      bytes: null,
      encoding: "citygml",
    };
  }

  const gzipped = isGzipBytes(raw);
  const text = await decodeOrExplain(url, raw);
  // The FETCHED array when nothing was gunzipped — re-encoding the text would
  // allocate a second copy of the whole file for no gain. Safe to hand on:
  // `registerBuffer` consumes it, and nothing below reads `raw` again.
  const decodedBytes = gzipped ? new TextEncoder().encode(text) : raw;

  if (encoding === "cityjsonseq") {
    return {
      model: parseCityJSONSeq(text),
      bytes: decodedBytes,
      encoding: "cityjsonseq",
    };
  }

  if (encoding === "citygml") {
    return { model: parseCityGML(text), bytes: null, encoding: "citygml" };
  }

  let json: CityJSONRoot;
  try {
    json = JSON.parse(text) as CityJSONRoot;
  } catch {
    throw new Error(
      "Invalid JSON — the remote file could not be parsed. Check that it is valid CityJSON.",
    );
  }
  if (json.type !== "CityJSON") {
    throw new Error('Not a CityJSON file — expected "type": "CityJSON".');
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error('Invalid CityJSON — missing "CityObjects" property.');
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error('Invalid CityJSON — missing or invalid "vertices" array.');
  }
  return {
    model: parseCityJSON(json),
    bytes: decodedBytes,
    encoding: "cityjson",
  };
}

/**
 * The DECODED source bytes for a URL, with none of the parsing.
 *
 * The export's `SourceProvider`: a layer's bytes are dropped from the VFS as
 * soon as its table is built, so a CityParquet export re-fetches them (the
 * browser cache usually serves it) rather than the app holding a copy of every
 * loaded file for the lifetime of the session.
 *
 * DECODED, always, and decided on the MAGIC BYTES rather than the extension
 * — a `.city.json` a server handed back gzipped comes out as text either
 * way, and it has to, because no DuckDB reader gunzips anything. These are the
 * same bytes the table was built from.
 *
 * A body that was NOT gzipped is returned AS IS: it already is the decoded
 * array, and a decode-then-re-encode round trip would allocate a second copy
 * of the whole file. Either way the caller gets a FRESH array, because
 * `registerBuffer` consumes what it is given and this may be called twice.
 */
export async function fetchModelBytes(
  url: string,
  http: HttpClient = defaultHttp,
): Promise<Uint8Array> {
  const raw = await fetchRawBody(url, http);
  if (!isGzipBytes(raw)) return raw;
  return new TextEncoder().encode(await decodeOrExplain(url, raw));
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
