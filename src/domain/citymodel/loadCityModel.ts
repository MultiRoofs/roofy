/**
 * Unified city model loading from text content or remote URLs.
 *
 * Keeps domain-level loading logic out of the app shell, making it
 * independently testable. Format detection delegates to detectEncoding.
 */

import type { CityModel } from "./types";
import type { CityJSONRoot } from "./cityjson/types";
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

  const json = JSON.parse(text) as CityJSONRoot;
  if (json.type !== "CityJSON") {
    throw new Error("Not a CityJSON file \u2014 expected \"type\": \"CityJSON\".");
  }
  return parseCityJSON(json);
}

/**
 * Load a city model from a remote URL.
 *  - .fcb → FlatCityBuf (WASM HTTP range-request reader)
 *  - .city.jsonl / .jsonl → CityJSONSeq (fetch + parse)
 *  - everything else → CityJSON (fetch + parse)
 */
export async function loadFromUrl(url: string): Promise<CityModel> {
  const encoding = detectEncoding(url);

  if (encoding === "flatcitybuf") {
    return loadFlatCityBuf(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  if (encoding === "cityjsonseq") {
    return parseCityJSONSeq(text);
  }

  const json = JSON.parse(text) as CityJSONRoot;
  if (json.type !== "CityJSON") {
    throw new Error("Not a CityJSON file \u2014 expected \"type\": \"CityJSON\".");
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
