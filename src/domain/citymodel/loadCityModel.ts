/**
 * Unified city model loading from text content or remote URLs.
 *
 * Keeps domain-level loading logic out of the app shell, making it
 * independently testable. Format detection delegates to detectEncoding.
 */

import type { CityModel } from "./types";
import type { CityJSONRoot } from "./cityjson/types";
import type { HttpClient } from "../../platform/types";
import { parseCityJSON } from "./cityjson/parseCityJSON";
import { parseCityJSONSeq } from "./cityjsonseq/parseCityJSONSeq";
import { loadFlatCityBuf } from "./flatcitybuf/loadFlatCityBuf";
import { detectEncoding } from "./detectEncoding";

/**
 * Parse city model text content. Format is detected from the name/URL.
 */
export function parseText(nameOrUrl: string, text: string): CityModel {
  const encoding = detectEncoding(nameOrUrl);

  if (encoding === "cityjsonseq") {
    return parseCityJSONSeq(text);
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
    throw new Error("Not a CityJSON file \u2014 expected \"type\": \"CityJSON\".");
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error("Invalid CityJSON \u2014 missing \"CityObjects\" property.");
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error("Invalid CityJSON \u2014 missing or invalid \"vertices\" array.");
  }
  return parseCityJSON(json);
}

/** Default HttpClient using browser fetch. */
const defaultHttp: HttpClient = {
  async fetchText(url: string) {
    const response = await fetch(url);
    const text = response.ok ? await response.text() : "";
    return { ok: response.ok, status: response.status, statusText: response.statusText, text };
  },
};

/**
 * Load a city model from a remote URL.
 *  - .fcb → FlatCityBuf (WASM HTTP range-request reader)
 *  - .city.jsonl / .jsonl → CityJSONSeq (fetch + parse)
 *  - everything else → CityJSON (fetch + parse)
 *
 * Accepts an optional HttpClient for platform abstraction (Tauri, testing).
 */
export async function loadFromUrl(url: string, http: HttpClient = defaultHttp): Promise<CityModel> {
  const encoding = detectEncoding(url);

  if (encoding === "flatcitybuf") {
    return loadFlatCityBuf(url);
  }

  let response: { ok: boolean; status: number; statusText: string; text: string };
  try {
    response = await http.fetchText(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new Error(
        `Network error loading "${fileNameFromUrl(url)}". Check that the URL is correct and accessible (CORS may block cross-origin requests).`,
      );
    }
    throw new Error(`Failed to load: ${msg}`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found (404) at "${fileNameFromUrl(url)}". Check the URL.`);
    }
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }
  const text = response.text;

  if (encoding === "cityjsonseq") {
    return parseCityJSONSeq(text);
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
    throw new Error("Not a CityJSON file \u2014 expected \"type\": \"CityJSON\".");
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error("Invalid CityJSON \u2014 missing \"CityObjects\" property.");
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error("Invalid CityJSON \u2014 missing or invalid \"vertices\" array.");
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
