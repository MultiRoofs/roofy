import { describe, it, expect } from "vitest";
import {
  cardinalFor,
  compassRotationDeg,
  formatBearing,
  formatTilt,
  MAX_PITCH_DEG,
  MIN_PITCH_DEG,
  normaliseHeading,
  northedCamera,
  tiltedCamera,
  TILT_STEP_DEG,
  zoomedCamera,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "../../../src/scene/cameraControls";
import type { GeographicCameraState } from "../../../src/scene/geographicCamera";

const M_PER_DEG_LAT = 111_320;
const DEG = Math.PI / 180;

/** Delft, looking north and tilted 45 degrees down from 200 m up. */
const CAMERA: GeographicCameraState = {
  lng: 4.35,
  lat: 52.0,
  height: 200,
  heading: 0,
  pitch: -45,
  roll: 0,
};

/**
 * Where the view ray crosses height 0, derived here from plain trigonometry
 * rather than from the module under test — so "the pivot stayed put" is
 * checked against an independent derivation.
 */
function groundPointOf(state: GeographicCameraState): {
  lng: number;
  lat: number;
  distance: number;
} {
  const p = state.pitch * DEG;
  const h = state.heading * DEG;
  const distance = state.height / -Math.sin(p);
  const horizontal = distance * Math.cos(p);
  return {
    lng:
      state.lng +
      (horizontal * Math.sin(h)) / (M_PER_DEG_LAT * Math.cos(state.lat * DEG)),
    lat: state.lat + (horizontal * Math.cos(h)) / M_PER_DEG_LAT,
    distance,
  };
}

describe("zoomedCamera", () => {
  it("keeps heading, pitch and roll — a zoom is not a re-aim", () => {
    const next = zoomedCamera({ ...CAMERA, heading: 137, roll: 0 }, 0.5);
    expect(next.heading).toBeCloseTo(137, 9);
    expect(next.pitch).toBeCloseTo(-45, 9);
    expect(next.roll).toBe(0);
  });

  it("scales the DISTANCE to the ground point, not the height in place", () => {
    // Straight down: the pivot is directly under the camera, so the two are the
    // same number and the arithmetic is checkable by hand.
    const overhead = { ...CAMERA, pitch: -90, height: 400 };
    expect(zoomedCamera(overhead, 0.5).height).toBeCloseTo(200, 6);
    expect(zoomedCamera(overhead, 2).height).toBeCloseTo(800, 6);
  });

  it("leaves the point under the crosshair exactly where it was", () => {
    const before = groundPointOf(CAMERA);
    const after = groundPointOf(zoomedCamera(CAMERA, ZOOM_IN_FACTOR));
    expect(after.lat).toBeCloseTo(before.lat, 9);
    expect(after.lng).toBeCloseTo(before.lng, 9);
    // ...and it really did move closer.
    expect(after.distance).toBeCloseTo(before.distance * ZOOM_IN_FACTOR, 6);
  });

  it("holds the pivot for an off-axis heading too", () => {
    const oblique = { ...CAMERA, heading: 115, height: 900 };
    const before = groundPointOf(oblique);
    const after = groundPointOf(zoomedCamera(oblique, ZOOM_IN_FACTOR));
    // 1e-6 degrees is ~0.1 m: the residual of the spherical
    // metres-per-degree approximation, not a drift in the maths.
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lng).toBeCloseTo(before.lng, 6);
  });

  it("returns to where it started when a zoom in is undone by a zoom out", () => {
    const there = zoomedCamera(CAMERA, ZOOM_IN_FACTOR);
    const back = zoomedCamera(there, ZOOM_OUT_FACTOR);
    expect(back.lng).toBeCloseTo(CAMERA.lng, 9);
    expect(back.lat).toBeCloseTo(CAMERA.lat, 9);
    expect(back.height).toBeCloseTo(CAMERA.height, 6);
  });

  it("falls back to scaling height when there is no ground point ahead", () => {
    // Level with the horizon: the view ray never comes down, so a
    // pivot-anchored zoom is undefined and the camera simply drops.
    const level = { ...CAMERA, pitch: 0 };
    const next = zoomedCamera(level, 0.5);
    expect(next.height).toBeCloseTo(100, 6);
    expect(next.lng).toBe(level.lng);
    expect(next.lat).toBe(level.lat);
  });

  it("never lets a zoom out escape the planet, or a zoom in bury the camera", () => {
    const far = zoomedCamera({ ...CAMERA, height: 11_000_000 }, 1000);
    expect(far.height).toBeLessThanOrEqual(12_000_000);
    const near = zoomedCamera({ ...CAMERA, pitch: -90, height: 6 }, 1e-9);
    expect(near.height).toBeGreaterThanOrEqual(5);
  });

  it("refuses a state or a factor it cannot compute with", () => {
    const broken = { ...CAMERA, heading: Number.NaN };
    expect(zoomedCamera(broken, 0.5)).toBe(broken);
    expect(zoomedCamera(CAMERA, 0)).toBe(CAMERA);
    expect(zoomedCamera(CAMERA, Number.NaN)).toBe(CAMERA);
  });
});

describe("tiltedCamera", () => {
  it("adds the step to the pitch, positive tilting towards the horizon", () => {
    expect(tiltedCamera(CAMERA, TILT_STEP_DEG).pitch).toBeCloseTo(-35, 9);
    expect(tiltedCamera(CAMERA, -TILT_STEP_DEG).pitch).toBeCloseTo(-55, 9);
  });

  it("clamps at both ends rather than passing the horizon or the nadir", () => {
    expect(tiltedCamera({ ...CAMERA, pitch: -8 }, 10).pitch).toBe(
      MAX_PITCH_DEG,
    );
    expect(tiltedCamera({ ...CAMERA, pitch: -85 }, -10).pitch).toBe(
      MIN_PITCH_DEG,
    );
  });

  it("orbits the ground point instead of swinging the view off it", () => {
    const before = groundPointOf(CAMERA);
    const tilted = tiltedCamera(CAMERA, TILT_STEP_DEG);
    const after = groundPointOf(tilted);
    expect(after.lat).toBeCloseTo(before.lat, 9);
    expect(after.lng).toBeCloseTo(before.lng, 9);
    // Same distance from the pivot: a tilt is a rotation about it, not a zoom.
    expect(after.distance).toBeCloseTo(before.distance, 6);
    // Tilting up towards the horizon lowers the camera and pushes it back.
    expect(tilted.height).toBeLessThan(CAMERA.height);
    expect(tilted.lat).toBeLessThan(CAMERA.lat);
  });

  it("just sets the pitch when there is no ground point to orbit", () => {
    const level = { ...CAMERA, pitch: 0 };
    const next = tiltedCamera(level, -20);
    expect(next.pitch).toBeCloseTo(-20, 9);
    expect(next.lng).toBe(level.lng);
    expect(next.lat).toBe(level.lat);
    expect(next.height).toBe(level.height);
  });

  // The view modes narrow this clamp rather than adding a second one of their
  // own: 2.5D passes min === max === -60, so the buttons hold the mode's angle.
  it("honours narrower limits when a view mode supplies them", () => {
    const limits = { minDeg: -60, maxDeg: -60 };
    expect(tiltedCamera(CAMERA, TILT_STEP_DEG, limits).pitch).toBe(-60);
    expect(tiltedCamera(CAMERA, -TILT_STEP_DEG, limits).pitch).toBe(-60);
    // A camera that drifted off the pinned angle is snapped back onto it.
    expect(tiltedCamera({ ...CAMERA, pitch: -12 }, 0, limits).pitch).toBe(-60);
  });

  it("falls back to the button limits when no mode limits are given", () => {
    expect(tiltedCamera({ ...CAMERA, pitch: -85 }, -10).pitch).toBe(
      MIN_PITCH_DEG,
    );
  });
});

describe("northedCamera", () => {
  it("faces north while keeping the pitch and the distance", () => {
    const turned = { ...CAMERA, heading: 250 };
    const next = northedCamera(turned);
    expect(next.heading).toBe(0);
    expect(next.pitch).toBeCloseTo(turned.pitch, 9);
    expect(next.height).toBeCloseTo(turned.height, 6);
  });

  it("rotates AROUND what the camera is looking at", () => {
    const turned = { ...CAMERA, heading: 250 };
    const before = groundPointOf(turned);
    const after = groundPointOf(northedCamera(turned));
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lng).toBeCloseTo(before.lng, 6);
    // Facing north from due south of the pivot.
    expect(northedCamera(turned).lat).toBeLessThan(before.lat);
  });

  it("is a no-op for a camera already facing north", () => {
    const next = northedCamera(CAMERA);
    expect(next.heading).toBe(0);
    expect(next.lat).toBeCloseTo(CAMERA.lat, 9);
    expect(next.height).toBeCloseTo(CAMERA.height, 6);
  });

  it("still faces north with no ground point to pivot about", () => {
    const level = { ...CAMERA, pitch: 12, heading: 200 };
    expect(northedCamera(level).heading).toBe(0);
    expect(northedCamera(level).height).toBe(level.height);
  });
});

describe("the compass readouts", () => {
  it("turns the dial by the negated heading, so N points at true north", () => {
    expect(compassRotationDeg(0)).toBe(0);
    expect(compassRotationDeg(90)).toBe(270);
    expect(compassRotationDeg(270)).toBe(90);
    expect(compassRotationDeg(-30)).toBe(30);
    expect(compassRotationDeg(450)).toBe(270);
  });

  it("normalises any heading into [0, 360)", () => {
    expect(normaliseHeading(-1)).toBe(359);
    expect(normaliseHeading(360)).toBe(0);
    expect(normaliseHeading(Number.NaN)).toBe(0);
  });

  it("prints a three-digit bearing that never changes width", () => {
    expect(formatBearing(0)).toBe("000°");
    expect(formatBearing(4.6)).toBe("005°");
    expect(formatBearing(359.7)).toBe("000°");
    expect(formatBearing(-90)).toBe("270°");
    expect(formatBearing(137.4)).toBe("137°");
  });

  it("names the eight-point cardinal the camera faces", () => {
    expect(cardinalFor(0)).toBe("N");
    expect(cardinalFor(22)).toBe("N");
    expect(cardinalFor(46)).toBe("NE");
    expect(cardinalFor(180)).toBe("S");
    expect(cardinalFor(350)).toBe("N");
    expect(cardinalFor(-90)).toBe("W");
  });

  it("reads the tilt as degrees BELOW the horizon", () => {
    expect(formatTilt(-45.4)).toBe("45°");
    expect(formatTilt(-90)).toBe("90°");
    expect(formatTilt(Number.NaN)).toBe("0°");
  });
});
