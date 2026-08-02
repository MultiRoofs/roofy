/**
 * Re-export shim — the CityJSON parse helpers now live in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export {
  dequantizeAll,
  mergeBBox,
  parseCityObject,
  mapMetadata,
} from "@cityjson/navara-core";
