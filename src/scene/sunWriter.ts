/**
 * Engine sun -> the app's solar readout.
 *
 * Navara's atmosphere owns sun position now (spec §4.4): it derives the sun
 * from `atmosphere.date` and publishes it as a unit vector in **ECEF**. Every
 * consumer in this app speaks local **ENU** instead — `SolarTab`'s
 * altitude/azimuth rows, the toolbar's sun pill and `computeSolarScore`, which
 * dots the direction with a surface normal in CityJSON's own axes (Task C15).
 *
 * This module is that one conversion, and nothing else: engine-free (so it is
 * unit-testable at all — `@navaramap/three` cannot be imported under Node, Task
 * B1) and pure, so `NavaraViewport` is left holding only the subscription.
 *
 * The transform is a ROTATION. `ecefToEnu` maps a POINT, subtracting the
 * frame's ~6.4e6 m origin first; a direction has no origin, so it takes the
 * rotation block alone — which, being orthonormal, inverts by transpose.
 * Differencing two `ecefToEnu` points would recover the same vector out of the
 * cancellation of two huge coordinates, and throw away most of its precision on
 * the way.
 */
import { makeEnuFrame, type EnuFrame } from "@cityjson/navara-core";
import {
  sunPositionFromEnu,
  type LatLon,
  type SunPosition,
} from "../features/solar/solarStore";

/** A three `Vector3`, reduced to what this module reads. */
export interface Xyz {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The ENU frame of the site the solar readout speaks for.
 *
 * Height is 0 because only the frame's ROTATION is ever used here, and that
 * depends on lat/lon alone — a site's geoid offset cannot tilt its horizon.
 */
export function siteEnuFrame(latLon: LatLon): EnuFrame {
  return makeEnuFrame(latLon.lon, latLon.lat, 0);
}

/** The engine's ECEF sun direction, as the sun position the store publishes. */
export function sunPositionFromEcef(frame: EnuFrame, ecef: Xyz): SunPosition {
  const m = frame.matrix;
  // R^T · d, with R the frame's ENU -> ECEF rotation (columns east/north/up).
  return sunPositionFromEnu([
    m[0]! * ecef.x + m[1]! * ecef.y + m[2]! * ecef.z,
    m[4]! * ecef.x + m[5]! * ecef.y + m[6]! * ecef.z,
    m[8]! * ecef.x + m[9]! * ecef.y + m[10]! * ecef.z,
  ]);
}
