/**
 * Detect city model encoding from a file name or URL.
 *
 * Used by both the local file drop handler and the remote URL loader
 * to route to the correct parser.
 */

import type { CityModelEncoding } from "@cityjson/navara-core";

/**
 * Strip query string and fragment from a URL path for extension matching.
 */
function cleanPath(nameOrUrl: string): string {
  try {
    return new URL(nameOrUrl).pathname.toLowerCase();
  } catch {
    return nameOrUrl.toLowerCase();
  }
}

/**
 * Detect the encoding from a file name or URL.
 * Returns the encoding type, defaulting to "cityjson" for unknown extensions.
 *
 * A trailing `.gz` is stripped before matching, so `tile.city.jsonl.gz`
 * detects as CityJSONSeq. This only decides which *parser* to use; whether a
 * body actually needs gunzipping is decided from its magic bytes, never from
 * the extension (see decodeModelBytes in loadCityModel.ts).
 */
export function detectEncoding(nameOrUrl: string): CityModelEncoding {
  let p = cleanPath(nameOrUrl);
  if (p.endsWith(".gz")) p = p.slice(0, -3);
  if (p.endsWith(".city.jsonl") || p.endsWith(".jsonl")) return "cityjsonseq";
  if (p.endsWith(".fcb")) return "flatcitybuf";
  if (p.endsWith(".gml") || p.endsWith(".citygml")) return "citygml";
  return "cityjson";
}
