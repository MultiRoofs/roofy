/**
 * The sun writer's math (Task C16): the engine's ECEF sun direction, read in
 * the site's local ENU frame.
 *
 * Engine-free on purpose — `@navaramap/three` cannot even be imported under
 * Node (Task B1: NODE_IMPORT_SAFE = false). What the engine hands over is a
 * plain `{x, y, z}` unit vector in ECEF, and every case below is a
 * configuration whose answer follows from geometry alone, so this pins the
 * conversion itself rather than a recorded output.
 */
import { describe, expect, it } from "vitest";
import {
  siteEnuFrame,
  sunPositionFromEcef,
} from "../../../src/scene/sunWriter";

/** Site on the equator at the prime meridian: ENU east = ECEF +Y,
 *  north = ECEF +Z, up = ECEF +X. Every axis of the frame is an ECEF axis,
 *  which is what makes the expected values below exact. */
const ORIGIN_SITE = siteEnuFrame({ lat: 0, lon: 0 });
/** The North Pole: up = ECEF +Z, and every horizontal direction is south. */
const POLE_SITE = siteEnuFrame({ lat: 90, lon: 0 });
const DELFT = { lat: 52.0116, lon: 4.3571 };
const DELFT_SITE = siteEnuFrame(DELFT);

/** The geodetic up direction at a site, in ECEF. */
function ecefUpAt(site: { lat: number; lon: number }) {
  const phi = (site.lat * Math.PI) / 180;
  const lam = (site.lon * Math.PI) / 180;
  return {
    x: Math.cos(phi) * Math.cos(lam),
    y: Math.cos(phi) * Math.sin(lam),
    z: Math.sin(phi),
  };
}

function negate(v: { x: number; y: number; z: number }) {
  return { x: -v.x, y: -v.y, z: -v.z };
}

describe("sunPositionFromEcef", () => {
  it("reads ECEF +X as straight up at (0N, 0E)", () => {
    const sun = sunPositionFromEcef(ORIGIN_SITE, { x: 1, y: 0, z: 0 });
    expect(sun.altitudeDeg).toBeCloseTo(90, 9);
    expect(sun.direction[2]).toBeCloseTo(1, 9);
  });

  it("reads ECEF +Z as due north on the horizon at (0N, 0E)", () => {
    const sun = sunPositionFromEcef(ORIGIN_SITE, { x: 0, y: 0, z: 1 });
    expect(sun.altitudeDeg).toBeCloseTo(0, 9);
    expect(sun.azimuthDeg).toBeCloseTo(0, 9);
  });

  it("reads ECEF +Y as due east on the horizon at (0N, 0E)", () => {
    const sun = sunPositionFromEcef(ORIGIN_SITE, { x: 0, y: 1, z: 0 });
    expect(sun.altitudeDeg).toBeCloseTo(0, 9);
    expect(sun.azimuthDeg).toBeCloseTo(90, 9);
  });

  it("reads ECEF -Y as due west — azimuth 270, not -90", () => {
    // The store's contract is a geographic azimuth in [0, 360).
    const sun = sunPositionFromEcef(ORIGIN_SITE, { x: 0, y: -1, z: 0 });
    expect(sun.azimuthDeg).toBeCloseTo(270, 9);
  });

  it("is a ROTATION: the frame's origin never enters the answer", () => {
    // The frame's translation is ~6.4e6 m, so treating the sun direction as a
    // POINT and differencing two `ecefToEnu` calls would leave the unit vector
    // to the mercy of that cancellation. A 1 m direction and a 1000 km one must
    // give the same angles.
    const near = sunPositionFromEcef(DELFT_SITE, { x: 0.3, y: -0.5, z: 0.8 });
    const far = sunPositionFromEcef(DELFT_SITE, {
      x: 0.3e6,
      y: -0.5e6,
      z: 0.8e6,
    });
    expect(far.altitudeDeg).toBeCloseTo(near.altitudeDeg, 9);
    expect(far.azimuthDeg).toBeCloseTo(near.azimuthDeg, 9);
    // …and the direction it publishes is a UNIT vector either way.
    expect(Math.hypot(...far.direction)).toBeCloseTo(1, 12);
  });

  it("puts the sun below the horizon on the night side of the Earth", () => {
    const up = sunPositionFromEcef(DELFT_SITE, ecefUpAt(DELFT));
    const down = sunPositionFromEcef(DELFT_SITE, negate(ecefUpAt(DELFT)));
    expect(up.altitudeDeg).toBeCloseTo(90, 6);
    expect(down.altitudeDeg).toBeCloseTo(-90, 6);
  });

  it("reads local noon as due south for a northern site", () => {
    // At noon the sun lies in the plane of the site's meridian; with the sun
    // over the equator its ECEF direction is (cos lng, sin lng, 0), which must
    // read as azimuth 180 and elevation 90 - latitude from Delft.
    const lam = (DELFT.lon * Math.PI) / 180;
    const sun = sunPositionFromEcef(DELFT_SITE, {
      x: Math.cos(lam),
      y: Math.sin(lam),
      z: 0,
    });
    expect(sun.azimuthDeg).toBeCloseTo(180, 6);
    expect(sun.altitudeDeg).toBeCloseTo(90 - DELFT.lat, 6);
  });

  it("reads every horizontal direction as south at the North Pole", () => {
    const horizontal = sunPositionFromEcef(POLE_SITE, { x: 1, y: 0, z: 0 });
    expect(horizontal.altitudeDeg).toBeCloseTo(0, 9);
    expect(horizontal.azimuthDeg).toBeCloseTo(180, 9);
    expect(
      sunPositionFromEcef(POLE_SITE, { x: 0, y: 0, z: 1 }).altitudeDeg,
    ).toBeCloseTo(90, 9);
  });
});
