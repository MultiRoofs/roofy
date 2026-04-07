/**
 * Detect city model encoding from a file name or URL.
 *
 * Used by both the local file drop handler and the remote URL loader
 * to route to the correct parser.
 */

import type { CityModelEncoding } from "./supportedEncodings";

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
 */
export function detectEncoding(nameOrUrl: string): CityModelEncoding {
  const p = cleanPath(nameOrUrl);
  if (p.endsWith(".city.jsonl") || p.endsWith(".jsonl")) return "cityjsonseq";
  if (p.endsWith(".fcb")) return "flatcitybuf";
  return "cityjson";
}
