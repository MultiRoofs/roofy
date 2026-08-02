/**
 * Re-export shim — the pure roof-geometry computations now live in
 * `@cityjson/navara-core` (M7.2); the FCB worker computes them per streamed
 * object, so they cannot live in the app.
 */
export {
  computeArea,
  computeAzimuth,
  computeElevation,
  computeInclination,
  computeRoofMetrics,
  computeSurfaceNormal,
} from "@cityjson/navara-core";
