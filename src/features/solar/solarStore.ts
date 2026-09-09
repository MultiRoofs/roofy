/**
 * Zustand store for solar / datetime state.
 *
 * Holds the user-selected datetime, the atmosphere's site lat/lon, and the sun
 * position the engine reported. The store computes none of it: since the
 * Navara migration the atmosphere owns sun position (spec §4.4) and pushes it
 * in via `setSunPosition`, and the site comes from the live layer handles'
 * geodetic bounds — which a STREAMING layer has too — pushed in via
 * `setLatLon` by `NavaraViewport` (Task C16). The old CRS+bbox derivation
 * (`initFromModel`/`reprojectToLatLon`) died with `CitySceneR3F`; bounds need
 * no reprojection, so this store no longer touches proj4 at all.
 */

import { create } from "zustand";
import {
  DEFAULT_SOLAR_TIME_ZONE,
  normalizeSolarTimeZone,
  type SolarTimeZone,
} from "./solarTimeZone";

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
  readonly timeZone: SolarTimeZone;
  readonly latLon: LatLon | null;
  readonly sunPosition: SunPosition | null;
  readonly timeAnimating: boolean;
  readonly timeSpeed: number; // multiplier: 1, 60, 360, 3600
}

export interface SolarActions {
  setDatetime: (dt: Date) => void;
  setTimeZone: (zone: unknown) => void;
  setLatLon: (latLon: LatLon | null) => void;
  /** Record the sun position the atmosphere reported for the current datetime. */
  setSunPosition: (sun: SunPosition | null) => void;
  setTimeAnimating: (v: boolean) => void;
  setTimeSpeed: (v: number) => void;
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Today, at 12:00 UTC.
 *
 * NOT `new Date()`, which is what this store used to start from. The engine's
 * atmosphere follows `solarStore.datetime`, so opening the viewer at 22:00
 * local rendered a night scene over a night globe: an almost-black viewport
 * that reads as a broken renderer rather than as "it is dark outside". The
 * M7.5 browser smoke hit exactly this and had to shift the page's `Date` to
 * take its screenshots (research/2026-08-01-navara-spike-findings.md §M7.5,
 * finding 6) — a workaround for a real first-run defect.
 *
 * Midday **UTC** rather than midday local: the site comes from the model, not
 * from the user's timezone, and this is a European project (Delft is the
 * reference dataset). Noon UTC puts the sun high over the prime meridian and
 * above the horizon across all of Europe, Africa and the Americas. The clock
 * is one click from the toolbar's "now" button for anyone who wants the real
 * time back.
 */
export function defaultSolarDatetime(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
      0,
    ),
  );
}

export const useSolarStore = create<SolarStore>((set) => ({
  datetime: defaultSolarDatetime(),
  timeZone: DEFAULT_SOLAR_TIME_ZONE,
  latLon: null,
  sunPosition: null,
  timeAnimating: false,
  timeSpeed: 60,

  setDatetime: (dt) => set({ datetime: dt }),
  setTimeZone: (timeZone) =>
    set({ timeZone: normalizeSolarTimeZone(timeZone) }),

  setLatLon: (latLon) => set({ latLon }),

  setSunPosition: (sunPosition) => set({ sunPosition }),

  setTimeAnimating: (v) => set({ timeAnimating: v }),
  setTimeSpeed: (v) => {
    if (Number.isFinite(v) && v > 0 && v <= 86400) set({ timeSpeed: v });
  },
}));
