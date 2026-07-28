import { describe, it, expect } from "vitest";
import { PerspectiveCamera } from "three";
import { viewportFootprint } from "../../../../src/features/streaming/viewportFootprint";

const ORIGIN = [0, 0, 0] as const;

function cam(pos: [number, number, number], lookAt: [number, number, number]) {
  const c = new PerspectiveCamera(50, 16 / 9, 1, 50000);
  c.position.set(...pos);
  c.lookAt(...lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

describe("viewportFootprint", () => {
  it("gives a centred rectangle for a top-down camera", () => {
    const f = viewportFootprint(cam([0, 500, 0], [0, 0, 0]), 0, ORIGIN)!;
    expect(f).not.toBeNull();
    expect(f.centre[0]).toBeCloseTo(0, 3);
    // Precision loosened on this axis only: three.js's Matrix4.lookAt hits a
    // documented degenerate branch when `forward` is exactly parallel to `up`
    // (a perfectly top-down camera) and nudges the resulting quaternion by
    // ~1e-4 to avoid a zero cross product. That orientation noise, cast ~500m
    // to the ground plane, produces a real (not a bug) ~6cm centre offset that
    // no ground-intersection algorithm using this exact camera can avoid.
    expect(Math.abs(f.centre[1])).toBeLessThan(0.1);
    expect(f.span).toBeGreaterThan(0);
    expect(f.span).toBeLessThan(20000);
  });

  it("clamps a tilted camera at T_MAX instead of running to the horizon", () => {
    // Shallow tilt: far corners would otherwise project enormously far away.
    const f = viewportFootprint(cam([0, 200, 0], [0, 0, -8000]), 0, ORIGIN);
    // Either clamped within the span cap, or refused — never infinite.
    if (f !== null) {
      expect(Number.isFinite(f.span)).toBe(true);
      expect(f.span).toBeLessThanOrEqual(20000);
    }
  });

  it("returns finite values, never NaN, for a camera aimed at the horizon", () => {
    const f = viewportFootprint(cam([0, 100, 0], [0, 100, -1000]), 0, ORIGIN);
    if (f !== null) {
      for (const v of f.bbox) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("handles a camera below the ground plane without inverting", () => {
    const f = viewportFootprint(cam([0, -50, 0], [0, 0, -100]), 0, ORIGIN);
    if (f !== null) {
      expect(f.bbox[0]).toBeLessThanOrEqual(f.bbox[2]);
      expect(f.bbox[1]).toBeLessThanOrEqual(f.bbox[3]);
    }
  });
});
