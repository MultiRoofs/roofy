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
import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";

/** Re-exported for existing call sites; the definition now lives in
 *  @cityjson/navara-core (M7.2). Task C15 drops this re-export. */
export { parseEpsgCode };

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
  readonly timeAnimating: boolean;
  readonly timeSpeed: number; // multiplier: 1, 60, 360, 3600
}

export interface SolarActions {
  setDatetime: (dt: Date) => void;
  setLatLon: (latLon: LatLon | null) => void;
  setTimeAnimating: (v: boolean) => void;
  setTimeSpeed: (v: number) => void;
  /** Extract lat/lon from model CRS and bbox, then compute sun position. */
  initFromModel: (
    referenceSystem: string | undefined,
    bbox: BBox3 | null,
  ) => void;
}

export type SolarStore = SolarState & SolarActions;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

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
 * Reproject bbox center from source CRS to WGS84.
 */
export function reprojectToLatLon(
  bbox: BBox3,
  epsgCode: number,
): LatLon | null {
  if (!ensureProjDef(epsgCode)) return null;

  const cx = (bbox[0] + bbox[3]) / 2;
  const cy = (bbox[1] + bbox[4]) / 2;

  try {
    const [lon, lat] = proj4(`EPSG:${epsgCode}`, "WGS84", [cx, cy]) as [
      number,
      number,
    ];
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
  timeAnimating: false,
  timeSpeed: 60,

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

  setTimeAnimating: (v) => set({ timeAnimating: v }),
  setTimeSpeed: (v) => set({ timeSpeed: v }),

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
