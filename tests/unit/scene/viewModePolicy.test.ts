/**
 * The view-mode policy table.
 *
 * A "mode" is not an engine feature — Navara 0.0.5 has no scene mode, no
 * orthographic camera and no pitch clamp — it is this table: which controller
 * gestures stay live, where the app's own tilt clamp sits, and where the camera
 * flies when the mode is entered. Keeping it here, engine-free, is what lets
 * both the viewport and the UI (the compass cluster's tilt buttons) read the
 * SAME source of truth instead of each hard-coding "in 2D you cannot...".
 *
 * `isAlignDirectionAllowed` has no caller in `src/` since the T/F/R align
 * overlay was removed (2026-08-10) — these cases are now the only thing holding
 * that rule, which is why they stay.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_PITCH_DEG,
  MAX_PITCH_DEG,
} from "../../../src/scene/cameraControls";
import {
  PLAN_PITCH_DEG,
  TILTED_PITCH_DEG,
  VIEW_MODE_ENTRY_MS,
  entryCameraFor,
  isAlignDirectionAllowed,
  viewModePolicy,
} from "../../../src/scene/viewModePolicy";

const CAMERA = {
  lng: 4.36,
  lat: 52.01,
  height: 800,
  heading: 137,
  pitch: -25,
  roll: 0,
};

describe("viewModePolicy", () => {
  it("leaves 3D exactly as the viewer has always behaved", () => {
    const policy = viewModePolicy("3d");
    expect(policy.enableSpin).toBe(true);
    expect(policy.enableTilt).toBe(true);
    expect(policy.minPitchDeg).toBe(MIN_PITCH_DEG);
    expect(policy.maxPitchDeg).toBe(MAX_PITCH_DEG);
    expect(policy.entryPitchDeg).toBeNull();
  });

  it("keeps rotation but locks tilt in 2.5D", () => {
    const policy = viewModePolicy("2.5d");
    expect(policy.enableSpin).toBe(true);
    expect(policy.enableTilt).toBe(false);
    // Pinned, not merely limited: min === max === the entry pitch.
    expect(policy.minPitchDeg).toBe(TILTED_PITCH_DEG);
    expect(policy.maxPitchDeg).toBe(TILTED_PITCH_DEG);
    expect(policy.entryPitchDeg).toBe(TILTED_PITCH_DEG);
    expect(policy.entryHeadingDeg).toBeNull();
  });

  it("locks both rotation and tilt in 2D, and faces north", () => {
    const policy = viewModePolicy("2d");
    expect(policy.enableSpin).toBe(false);
    expect(policy.enableTilt).toBe(false);
    expect(policy.minPitchDeg).toBe(PLAN_PITCH_DEG);
    expect(policy.maxPitchDeg).toBe(PLAN_PITCH_DEG);
    expect(policy.entryPitchDeg).toBe(PLAN_PITCH_DEG);
    expect(policy.entryHeadingDeg).toBe(0);
  });

  it("never looks EXACTLY straight down", () => {
    // A camera at pitch -90 has no heading to derive (`geographicCamera.ts`
    // documents this: `atan2(-0, -0)` silently reports 180), so the plan view
    // stops a tenth of a degree short.
    expect(PLAN_PITCH_DEG).toBeGreaterThan(-90);
    expect(PLAN_PITCH_DEG).toBeLessThan(-89);
  });

  it("entry flight keeps where the camera IS and changes how it looks", () => {
    const next = entryCameraFor(viewModePolicy("2d"), CAMERA);
    expect(next).toEqual({
      ...CAMERA,
      heading: 0,
      pitch: PLAN_PITCH_DEG,
    });
  });

  it("keeps the current heading when the mode does not pin one", () => {
    const next = entryCameraFor(viewModePolicy("2.5d"), CAMERA);
    expect(next).toEqual({ ...CAMERA, pitch: TILTED_PITCH_DEG });
  });

  it("has no entry flight for 3D — it frees the camera, it does not move it", () => {
    expect(entryCameraFor(viewModePolicy("3d"), CAMERA)).toBeNull();
  });

  it("refuses to fly from a camera state that is not usable", () => {
    expect(
      entryCameraFor(viewModePolicy("2d"), { ...CAMERA, lat: Number.NaN }),
    ).toBeNull();
  });

  it("allows only the top view-alignment in 2D", () => {
    for (const direction of [
      "front",
      "back",
      "left",
      "right",
      "bottom",
    ] as const) {
      expect(isAlignDirectionAllowed("2d", direction)).toBe(false);
      expect(isAlignDirectionAllowed("2.5d", direction)).toBe(true);
      expect(isAlignDirectionAllowed("3d", direction)).toBe(true);
    }
    expect(isAlignDirectionAllowed("2d", "top")).toBe(true);
  });

  it("flies the mode entry over a readable, non-zero duration", () => {
    expect(VIEW_MODE_ENTRY_MS).toBeGreaterThan(0);
  });
});
