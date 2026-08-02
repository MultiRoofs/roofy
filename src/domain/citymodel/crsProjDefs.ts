/**
 * Re-export shim — proj4 EPSG registration now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration). This path is a
 * convenience for existing app imports only; it carries no guarantees of its
 * own. What actually keeps `solarStore` and `fcbSource` on a single proj4 EPSG
 * registry is `resolve.dedupe: ["proj4", "three"]` in `vite.config.ts` (plus
 * proj4 being a peer dependency of navara-core), which collapses the app's copy
 * and the submodule's copy onto one module instance. Importing proj4 directly
 * is equally safe under that rule; importing it without that rule would not be
 * safe even through this file.
 */

export { ensureProjDef } from "@cityjson/navara-core";
