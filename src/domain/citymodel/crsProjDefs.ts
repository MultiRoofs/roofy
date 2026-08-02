/**
 * Re-export shim — proj4 EPSG registration now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration). Importing through
 * this path keeps `solarStore` and `fcbSource` on the same proj4 registry.
 */

export { ensureProjDef } from "@cityjson/navara-core";
