/**
 * Known proj4 definitions for CRS commonly used in CityJSON/FlatCityBuf
 * datasets that proj4 does not ship built in.
 *
 * proj4 bundles a small fixed set of CRS (WGS84/EPSG:4326, NAD83/EPSG:4269,
 * Web Mercator/EPSG:3857, the WGS84 UTM zones, and the two UPS polar
 * projections — see proj4's `lib/global.js`); national or regional grids
 * like the Dutch RD New need explicit registration before proj4 can report
 * their units or reproject through them at all.
 *
 * This module is the single place that registration happens. It lives in
 * the domain layer (not `features/solar`) so both a UI-facing feature
 * (solar position, which reprojects a model's CRS to lat/lon) and a
 * format-agnostic domain module (FlatCityBuf admission, which only needs to
 * know whether a CRS is metric) can depend on it without either importing
 * the other's layer — sharing one list instead of maintaining two that can
 * silently drift apart.
 */
import proj4 from "proj4";

const RD_NEW_DEF =
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.2369,50.0087,465.658,-0.40685733032239757,-0.3507326765425626,1.8703473836067956,4.0812 +units=m +no_defs";

const KNOWN_PROJ4_DEFS: Record<number, string> = {
  28992: RD_NEW_DEF, // EPSG:28992 — RD New (Netherlands) horizontal
  7415: RD_NEW_DEF, // EPSG:7415 — compound CRS, horizontal component is RD New
};

/**
 * Registers `epsgCode` with proj4 if it is not already known, using the
 * fixed list above. Returns whether proj4 now has SOME definition for it
 * (built in, registered by an earlier call, or registered here) — this says
 * nothing about whether that definition is metric; callers that care about
 * units read `proj4.defs(\`EPSG:${epsgCode}\`)?.units` themselves afterwards.
 */
export function ensureProjDef(epsgCode: number): boolean {
  const key = `EPSG:${epsgCode}`;
  if (proj4.defs(key)) return true; // already registered (built in or prior call)

  const def = KNOWN_PROJ4_DEFS[epsgCode];
  if (!def) return false;

  proj4.defs(key, def);
  return true;
}
