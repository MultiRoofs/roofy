/**
 * Zustand store for solar / datetime state.
 *
 * Holds the user-selected datetime, derived lat/lon from model CRS,
 * and computed sun position. Sun position is recomputed on every
 * datetime or latLon change.
 *
 * Dependencies: suncalc (sun position), proj4 (CRS reprojection).
 */

import { create } from "zustand";
import SunCalc from "suncalc";
import proj4 from "proj4";
import type { BBox3 } from "../../domain/citymodel/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SunPosition {
  /** Degrees above horizon. Negative = below. */
  readonly altitudeDeg: number;
  /** Geographic azimuth in degrees: 0=N, 90=E, 180=S, 270=W. */
  readonly azimuthDeg: number;
  /** Unit direction vector FROM origin TOWARD sun, in Three.js Y-up space. */
  readonly direction: readonly [number, number, number];
}

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface SolarState {
  readonly datetime: Date;
  readonly latLon: LatLon | null;
  readonly sunPosition: SunPosition | null;
}

export interface SolarActions {
  setDatetime: (dt: Date) => void;
  setLatLon: (latLon: LatLon | null) => void;
  /** Extract lat/lon from model CRS and bbox, then compute sun position. */
  initFromModel: (referenceSystem: string | undefined, bbox: BBox3 | null) => void;
}

export type SolarStore = SolarState & SolarActions;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Parse EPSG code from an OGC URI like
 * "https://www.opengis.net/def/crs/EPSG/0/7415" → 7415.
 */
export function parseEpsgCode(uri: string | undefined): number | null {
  if (!uri) return null;
  const segments = uri.split("/");
  const last = segments[segments.length - 1];
  if (!last) return null;
  const code = Number(last);
  return Number.isFinite(code) && code > 0 ? code : null;
}

/**
 * Compute sun direction vector in Three.js Y-up space from suncalc output.
 *
 * suncalc convention:
 *   azimuth  = radians, measured clockwise from South (0=S, π/2=W)
 *   altitude = radians above horizon
 *
 * CityJSON space: X=easting, Y=northing, Z=up
 * Three.js space: X=easting, Y=up, Z=-northing (after -PI/2 rotation on X)
 *
 * Returns a unit vector pointing FROM origin TOWARD the sun.
 */
export function sunDirectionThreeJs(
  azimuthRad: number,
  altitudeRad: number,
): [number, number, number] {
  // suncalc azimuth: 0=S, positive=clockwise (west)
  // Convert to "from north, clockwise" (geographic bearing):
  //   bearingFromNorth = azimuthRad + π
  // In CityJSON Z-up:
  //   easting  = sin(bearingFromNorth) * cos(altitude) = -sin(azimuthRad) * cos(altitude)
  //   northing = cos(bearingFromNorth) * cos(altitude) = -cos(azimuthRad) * cos(altitude)
  //   up       = sin(altitude)
  const cosAlt = Math.cos(altitudeRad);
  const cjX = -Math.sin(azimuthRad) * cosAlt;
  const cjY = -Math.cos(azimuthRad) * cosAlt;
  const cjZ = Math.sin(altitudeRad);

  // CityJSON [X, Y, Z] → Three.js Y-up via rotation.x = -PI/2:
  //   threeX =  cjX
  //   threeY =  cjZ
  //   threeZ = -cjY
  return [cjX, cjZ, -cjY];
}

/**
 * Compute sun position from lat/lon/datetime.
 */
export function computeSunPosition(dt: Date, latLon: LatLon): SunPosition {
  const { azimuth, altitude } = SunCalc.getPosition(dt, latLon.lat, latLon.lon);
  const direction = sunDirectionThreeJs(azimuth, altitude);

  // Convert suncalc azimuth (0=S, clockwise) to geographic (0=N, clockwise)
  let azimuthDeg = ((azimuth + Math.PI) * 180) / Math.PI;
  if (azimuthDeg >= 360) azimuthDeg -= 360;
  if (azimuthDeg < 0) azimuthDeg += 360;

  return {
    altitudeDeg: (altitude * 180) / Math.PI,
    azimuthDeg,
    direction,
  };
}

/**
 * Known proj4 definition strings for common CRS used in CityJSON datasets.
 * proj4 includes WGS84 and a few others built-in, but national CRS
 * like RD New need explicit registration.
 */
const RD_NEW_DEF =
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.2369,50.0087,465.658,-0.40685733032239757,-0.3507326765425626,1.8703473836067956,4.0812 +units=m +no_defs";

const KNOWN_PROJ4_DEFS: Record<number, string> = {
  28992: RD_NEW_DEF, // EPSG:28992 — RD New (Netherlands) horizontal
  7415: RD_NEW_DEF,  // EPSG:7415 — compound CRS, horizontal component is RD New
};

function ensureProj4Def(epsgCode: number): boolean {
  const key = `EPSG:${epsgCode}`;
  if (proj4.defs(key)) return true; // already registered

  const def = KNOWN_PROJ4_DEFS[epsgCode];
  if (!def) return false;

  proj4.defs(key, def);
  return true;
}

/**
 * Reproject bbox center from source CRS to WGS84.
 */
export function reprojectToLatLon(
  bbox: BBox3,
  epsgCode: number,
): LatLon | null {
  if (!ensureProj4Def(epsgCode)) return null;

  const cx = (bbox[0] + bbox[3]) / 2;
  const cy = (bbox[1] + bbox[4]) / 2;

  try {
    const [lon, lat] = proj4(`EPSG:${epsgCode}`, "WGS84", [cx, cy]) as [number, number];
    return { lat, lon };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSolarStore = create<SolarStore>((set, get) => ({
  datetime: new Date(),
  latLon: null,
  sunPosition: null,

  setDatetime: (dt) => {
    const { latLon } = get();
    const sunPosition = latLon ? computeSunPosition(dt, latLon) : null;
    set({ datetime: dt, sunPosition });
  },

  setLatLon: (latLon) => {
    const { datetime } = get();
    const sunPosition = latLon ? computeSunPosition(datetime, latLon) : null;
    set({ latLon, sunPosition });
  },

  initFromModel: (referenceSystem, bbox) => {
    if (!bbox) {
      get().setLatLon(null);
      return;
    }
    const epsgCode = parseEpsgCode(referenceSystem);
    if (!epsgCode) {
      get().setLatLon(null);
      return;
    }
    const latLon = reprojectToLatLon(bbox, epsgCode);
    get().setLatLon(latLon);
  },
}));
