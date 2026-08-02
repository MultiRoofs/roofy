/**
 * Status-bar cursor readout: the last leg of the pointer -> XYZ pipeline.
 *
 * Navara reports positions in ECEF; the viewport converts them to geodetic
 * (lng/lat/height) and this module takes it the final step back into the
 * layer's SOURCE CRS — the coordinates the user recognises, and the same
 * numbers the pre-Navara `sceneToCrsImpl` put in the status bar. It also owns
 * the throttle gate the old `handlePointerMove` carried inline (a `useRef`
 * timestamp + a 66 ms `performance.now()` comparison), so the cadence is
 * testable instead of buried in a component.
 *
 * Engine-free by construction: no `@navaramap/*`, no Three.js, no DOM, no
 * store. The router that lands the pointer events (Task B15) supplies the
 * geodetic triple and the layer's `referenceSystem`, and pushes the result at
 * `onCursorPosition`.
 *
 * HEIGHT SEMANTICS (parity, read before wiring): a layer's vertices are
 * placed at `geodeticHeight = sourceZ + heightOffset`, where `heightOffset` is
 * the sampled geoid undulation (Global Constraints -> Vertical datum). The
 * `height` this module returns is passed through UNCHANGED, so a caller that
 * wants the source CRS's own z — the orthometric value the file contained —
 * must hand in `geodeticHeight - heightOffset` for that layer. Passing the raw
 * geodetic height instead reports an ellipsoidal height, which for a Delft
 * model reads ~43 m high.
 */
import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";
import proj4 from "proj4";

/**
 * The EPSG code a layer's readout should be expressed in, or `null` when there
 * is nothing usable to convert into: no CRS on the layer, an unparseable URI,
 * or a code proj4 has no definition for (in which case a conversion would only
 * ever throw or return garbage, so the status bar shows nothing at all).
 */
export function epsgForLayer(
  referenceSystem: string | undefined,
): number | null {
  const epsg = parseEpsgCode(referenceSystem);
  if (epsg === null) return null;
  return ensureProjDef(epsg) ? epsg : null;
}

/**
 * WGS84 lng/lat -> `epsg` easting/northing, with `height` carried through
 * untouched (see HEIGHT SEMANTICS above — proj4 only reprojects the horizontal
 * pair, and the vertical component of a compound CRS such as EPSG:7415 is not
 * part of the registered definition).
 *
 * Returns `null` — never a partially-NaN triple — when the CRS is unusable or
 * the conversion does not produce finite numbers, because the status bar must
 * fall back to "no position" rather than print `NaN`.
 */
export function crsFromGeodetic(
  lngDeg: number,
  latDeg: number,
  height: number,
  epsg: number,
): readonly [number, number, number] | null {
  if (!ensureProjDef(epsg)) return null;
  if (
    !Number.isFinite(lngDeg) ||
    !Number.isFinite(latDeg) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  try {
    const [x, y] = proj4("WGS84", `EPSG:${epsg}`, [lngDeg, latDeg]) as [
      number,
      number,
    ];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y, height];
  } catch {
    // proj4 throws on definitions it cannot build a transform for; a readout
    // is not worth taking a pointer handler down for.
    return null;
  }
}

/**
 * Leading-edge throttle: runs the first call immediately, then drops every
 * call until `intervalMs` has elapsed. Dropped calls are NOT deferred — for a
 * cursor readout the next pointer move carries fresher data than any queued
 * trailing call would, which is exactly what the old inline gate did at 66 ms
 * (~15 Hz).
 *
 * `now` is injected so tests drive the clock instead of sleeping.
 */
export function createThrottle(
  intervalMs: number,
  now: () => number = () => performance.now(),
): (fn: () => void) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (fn: () => void) => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
