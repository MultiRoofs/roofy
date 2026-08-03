/**
 * Zustand store for solar / datetime state.
 *
 * Holds the user-selected datetime, the lat/lon derived from the model CRS
 * (the atmosphere's site), and the sun position the engine reported. The store
 * no longer computes sun position itself: since the Navara migration the
 * atmosphere owns sun position (spec §4.4) and pushes it in via
 * `setSunPosition`.
 *
 * Dependencies: proj4 (CRS reprojection).
 */

import { create } from "zustand";
import proj4 from "proj4";
import type { BBox3 } from "../../domain/citymodel/types";
import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SunPosition {
  /** Degrees above horizon. Negative = below. */
  readonly altitudeDeg: number;
  /** Geographic azimuth in degrees: 0=N, 90=E, 180=S, 270=W. */
  readonly azimuthDeg: number;
  /**
   * Unit vector FROM the origin TOWARD the sun in local ENU
   * (x=east, y=north, z=up) — the same axes as CityJSON source coordinates.
   */
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
  /** Record the sun position the atmosphere reported for the current datetime. */
  setSunPosition: (sun: SunPosition | null) => void;
  setTimeAnimating: (v: boolean) => void;
  setTimeSpeed: (v: number) => void;
  /** Extract the atmosphere's site lat/lon from the model CRS and bbox. */
  initFromModel: (
    referenceSystem: string | undefined,
    bbox: BBox3 | null,
  ) => void;
}

export type SolarStore = SolarState & SolarActions;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Engine-reported ENU sun direction -> the altitude/azimuth the UI shows.
 *  The atmosphere owns sun position now (spec §4.4); this is only the
 *  presentation transform, so it stays pure and unit-testable. */
export function sunPositionFromEnu(
  dir: readonly [number, number, number],
): SunPosition {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const e = dir[0] / len;
  const n = dir[1] / len;
  const u = dir[2] / len;
  let azimuthDeg = (Math.atan2(e, n) * 180) / Math.PI;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return {
    altitudeDeg: (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI,
    azimuthDeg,
    direction: [e, n, u],
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

  setDatetime: (dt) => set({ datetime: dt }),

  setLatLon: (latLon) => set({ latLon }),

  setSunPosition: (sunPosition) => set({ sunPosition }),

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
