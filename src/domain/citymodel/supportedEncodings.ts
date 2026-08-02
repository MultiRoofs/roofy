/**
 * Re-export shim — the encoding list now lives in `@cityjson/navara-core`
 * (M7.2 of the Navara migration).
 */

export type { CityModelEncoding } from "@cityjson/navara-core";
export {
  CITYMODEL_ENCODING_PRIORITY,
  isSupportedCityModelEncoding,
  getPreferredCityModelEncoding,
} from "@cityjson/navara-core";
