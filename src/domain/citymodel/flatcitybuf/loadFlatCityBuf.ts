/**
 * Loader for FlatCityBuf (.fcb) files via HTTP.
 *
 * FlatCityBuf is a FlatBuffers-based encoding of CityJSON, optimized for
 * cloud access with HTTP range requests and spatial indexing. The WASM
 * bindings provide an HttpFcbReader that streams CityJSONFeature objects
 * from a URL.
 *
 * Flow: URL → HttpFcbReader → CityJSONFeatures → cjseqToCj → parseCityJSON → CityModel
 *
 * Note: The WASM bindings return Map objects instead of plain JS objects
 * (a wasm-bindgen convention). We use mapToObject to convert them before
 * passing to parseCityJSON.
 */

import type { CityModel } from "../types";
import type { CityJSONRoot } from "../cityjson/types";
import { parseCityJSON } from "../cityjson/parseCityJSON";

// Lazy-loaded WASM module — cached as a Promise to avoid double-init races
type FcbModule = typeof import("@cityjson/flatcitybuf");
let initPromise: Promise<FcbModule> | null = null;

function ensureWasm(): Promise<FcbModule> {
  if (!initPromise) {
    initPromise = (async () => {
      const m = await import("@cityjson/flatcitybuf");
      await m.default();
      return m;
    })();
  }
  return initPromise;
}

/**
 * Recursively convert Map objects from WASM to plain JS objects.
 * The wasm-bindgen bindings deserialize Rust HashMaps as JS Maps.
 */
export function mapToObject(val: unknown): unknown {
  if (val instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of val) {
      obj[k as string] = mapToObject(v);
    }
    return obj;
  }
  if (Array.isArray(val)) {
    return val.map(mapToObject);
  }
  return val;
}

/**
 * Load a FlatCityBuf file from a URL and return a normalized CityModel.
 *
 * The reader fetches features via HTTP range requests, so the URL must
 * be accessible from the browser (CORS-enabled for cross-origin).
 */
export async function loadFlatCityBuf(url: string): Promise<CityModel> {
  const { HttpFcbReader, cjseqToCj } = await ensureWasm();

  const reader = new HttpFcbReader(url);
  const header = reader.cityjson();
  const iter = await reader.select_all();

  const features: unknown[] = [];
  while (true) {
    const feature = await iter.next();
    if (feature === undefined) break;
    features.push(feature);
  }

  // Merge header + features into a single CityJSON object (in WASM),
  // then convert Maps to plain objects for our parser.
  const merged = mapToObject(cjseqToCj(header, features)) as CityJSONRoot;
  const model = parseCityJSON(merged);

  return { ...model, sourceEncoding: "flatcitybuf" };
}
