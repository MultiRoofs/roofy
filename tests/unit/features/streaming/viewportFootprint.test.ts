import { describe, it, expect } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { viewportFootprint } from "../../../../src/features/streaming/viewportFootprint";
import { sceneToSource } from "../../../../src/features/streaming/sceneTransform";
import {
  MAX_FOOTPRINT_SPAN_M,
  T_MAX_M,
} from "../../../../src/features/streaming/constants";

const ORIGIN = [0, 0, 0] as const;

function cam(
  pos: [number, number, number],
  lookAt: [number, number, number],
  up: [number, number, number] = [0, 1, 0],
) {
  const c = new PerspectiveCamera(50, 16 / 9, 1, 50000);
  c.position.set(...pos);
  c.up.set(...up);
  c.lookAt(...lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const EPS_REF = 1e-6;
const NDC_CORNERS_REF: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Independent re-implementation of the documented viewportFootprint branch
 * logic (same EPS, same T_MAX_M, same ground-plane test), written separately
 * from src/features/streaming/viewportFootprint.ts. Used to assert precisely
 * which t (a real ground hit, or the T_MAX_M fallback) each corner should
 * have used for a given fixture — a plain `if (f !== null) {...}` cannot
 * catch a regression that silently changes which branch fires.
 */
function referenceFootprint(
  camera: PerspectiveCamera,
  groundY: number,
  origin: readonly [number, number, number],
): { bbox: [number, number, number, number] } {
  const eye = camera.getWorldPosition(new Vector3());
  const pts: Array<[number, number]> = [];
  for (const [nx, ny] of NDC_CORNERS_REF) {
    const dir = new Vector3(nx, ny, 0.5).unproject(camera).sub(eye).normalize();
    let t = T_MAX_M;
    if (dir.y < -EPS_REF || (dir.y > EPS_REF && groundY > eye.y)) {
      const tHit = (groundY - eye.y) / dir.y;
      if (tHit > 0 && tHit <= T_MAX_M) t = tHit;
    }
    const world: [number, number, number] = [
      eye.x + dir.x * t,
      eye.y + dir.y * t,
      eye.z + dir.z * t,
    ];
    const src = sceneToSource(world, origin, [0, 0, 0]);
    pts.push([src[0], src[1]]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

function expectBBoxCloseTo(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
) {
  expect(actual[0]).toBeCloseTo(expected[0], 3);
  expect(actual[1]).toBeCloseTo(expected[1], 3);
  expect(actual[2]).toBeCloseTo(expected[2], 3);
  expect(actual[3]).toBeCloseTo(expected[3], 3);
}

describe("viewportFootprint", () => {
  it("gives a centred rectangle for a top-down camera", () => {
    // up=[0,0,-1] avoids three.js's degenerate lookAt branch (forward
    // parallel to up), which otherwise perturbs the camera's basis by ~1e-4
    // and produces a spurious ~6cm centre offset unrelated to this module.
    const f = viewportFootprint(
      cam([0, 500, 0], [0, 0, 0], [0, 0, -1]),
      0,
      ORIGIN,
    );
    expect(f).not.toBeNull();
    expect(f!.centre[0]).toBeCloseTo(0, 3);
    expect(f!.centre[1]).toBeCloseTo(0, 3);
    expect(f!.span).toBeGreaterThan(0);
    expect(f!.span).toBeLessThan(MAX_FOOTPRINT_SPAN_M);
  });

  it("clamps a tilted camera at T_MAX instead of running to the horizon", () => {
    // Shallow tilt: far corners would otherwise project enormously far away.
    const f = viewportFootprint(cam([0, 200, 0], [0, 0, -8000]), 0, ORIGIN);
    expect(f).not.toBeNull();
    expect(Number.isFinite(f!.span)).toBe(true);
    expect(f!.span).toBeLessThanOrEqual(MAX_FOOTPRINT_SPAN_M);
  });

  it("returns finite values, never NaN, for a camera aimed at the horizon", () => {
    const f = viewportFootprint(cam([0, 100, 0], [0, 100, -1000]), 0, ORIGIN);
    expect(f).not.toBeNull();
    for (const v of f!.bbox) expect(Number.isFinite(v)).toBe(true);
  });

  it("handles a camera below the ground plane without inverting", () => {
    const f = viewportFootprint(cam([0, -50, 0], [0, 0, -100]), 0, ORIGIN);
    expect(f).not.toBeNull();
    expect(f!.bbox[0]).toBeLessThanOrEqual(f!.bbox[2]);
    expect(f!.bbox[1]).toBeLessThanOrEqual(f!.bbox[3]);
  });

  it("falls back to T_MAX_M, not a zero-length ray, when the eye sits exactly on the ground plane (tHit === 0)", () => {
    // groundY - eye.y === 0, so tHit === 0 for every corner regardless of
    // direction; tHit > 0 must reject that and fall back to T_MAX_M rather
    // than collapsing every corner to the eye's own position.
    const camera = cam([0, 0, 0], [0, -50, -100]);
    const f = viewportFootprint(camera, 0, ORIGIN);
    expect(f).not.toBeNull();
    expect(f!.span).toBeGreaterThan(1000); // nowhere near a zero-size footprint
    expectBBoxCloseTo(f!.bbox, referenceFootprint(camera, 0, ORIGIN).bbox);
  });

  it("falls back to T_MAX_M when the ground plane is behind a descending ray below ground (negative tHit)", () => {
    // Eye below ground, ray descending further away from the plane: the
    // algebraic tHit is negative, which must be rejected (not treated as a
    // valid hit behind the camera).
    const camera = cam([0, -1000, 0], [0, -2000, -100]);
    const f = viewportFootprint(camera, 0, ORIGIN);
    expect(f).not.toBeNull();
    expect(f!.bbox[0]).toBeLessThanOrEqual(f!.bbox[2]);
    expect(f!.bbox[1]).toBeLessThanOrEqual(f!.bbox[3]);
    expectBBoxCloseTo(f!.bbox, referenceFootprint(camera, 0, ORIGIN).bbox);
  });

  it("clamps to T_MAX_M — not the true, larger intersection — when a corner's real ground hit exceeds T_MAX_M", () => {
    // At this pose the two bottom corners' true algebraic ground intersection
    // is ~7504.6m (computed independently), well past T_MAX_M=5000. The two
    // top corners point above the horizon and are excluded outright. Both
    // must fall back to the same T_MAX_M, not the true 7504.6m distance.
    const camera = cam([0, 3000, 0], [0, 2912.5, -1000]);
    const f = viewportFootprint(camera, 0, ORIGIN);
    expect(f).not.toBeNull();
    expectBBoxCloseTo(f!.bbox, referenceFootprint(camera, 0, ORIGIN).bbox);
    // A regression that stopped clamping (used the true ~7504.6m hit) would
    // produce a visibly larger footprint than clamping to T_MAX_M does.
    expect(f!.span).toBeLessThan(2 * T_MAX_M);
  });

  it("computes a real ground hit for a corner shallow enough to approach EPS, without EPS swallowing it", () => {
    // The two bottom corners here have dir.y ≈ -1.4e-4 — comfortably above
    // EPS=1e-6 (by ~140x) but far shallower than any other fixture in this
    // file — and a true hit at ~3583m, safely inside T_MAX_M. This locks in
    // that EPS doesn't over-exclude a legitimate, if grazing, intersection.
    const camera = cam([0, 0.5, 0], [0, 466.5951915859124, -1000]);
    const f = viewportFootprint(camera, 0, ORIGIN);
    expect(f).not.toBeNull();
    // If EPS regressed to something coarser (e.g. 1e-3), this corner's
    // dir.y (~-1.4e-4) would be wrongly treated as grazing/excluded and
    // fall back to T_MAX_M instead of its true ~3583m hit — changing the
    // bbox on the near (ny=-1) side. referenceFootprint uses the documented
    // EPS=1e-6 independently, so this comparison catches that regression.
    expectBBoxCloseTo(f!.bbox, referenceFootprint(camera, 0, ORIGIN).bbox);
  });

  it("refuses the footprint when it exceeds MAX_FOOTPRINT_SPAN_M instead of returning an oversized rectangle", () => {
    // Every corner ray is clamped to T_MAX_M, so no two footprint points can
    // be more than 2*T_MAX_M apart — MAX_FOOTPRINT_SPAN_M=8000 sits inside
    // that reachable range, so a wide enough FOV genuinely exceeds it.
    const wide = new PerspectiveCamera(120, 16 / 9, 1, 50000);
    wide.position.set(0, 100, 0);
    wide.lookAt(0, 100, -1000);
    wide.updateMatrixWorld(true);
    wide.updateProjectionMatrix();
    const f = viewportFootprint(wide, 0, ORIGIN);
    expect(f).toBeNull();
  });

  it("rejects the footprint when a corner's source coordinates overflow to non-finite", () => {
    // eye.x and origin.x are each individually representable, but their sum
    // (inside sceneToSource) overflows past Number.MAX_VALUE to Infinity.
    const camera = cam([1e308, 500, 0], [1e308, 0, 0]);
    const f = viewportFootprint(camera, 0, [1e308, 0, 0]);
    expect(f).toBeNull();
  });

  it("uses the camera's world position, not its local position, when parented under a translated group", () => {
    // unproject() returns world-space coordinates; using camera.position
    // (local) instead of getWorldPosition() would put the ray origin 10000m
    // away from where the rays themselves actually start, badly distorting
    // the footprint even though the camera's own local transform is
    // identical to the un-parented top-down fixture above.
    const group = new Group();
    group.position.set(10000, 0, 0);
    const camera = new PerspectiveCamera(50, 16 / 9, 1, 50000);
    camera.position.set(0, 500, 0);
    camera.up.set(0, 0, -1); // avoid the unrelated degenerate-lookAt wobble
    camera.lookAt(0, 0, 0);
    group.add(camera);
    group.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const f = viewportFootprint(camera, 0, ORIGIN);
    expect(f).not.toBeNull();
    // World-space eye is (10000, 500, 0); the footprint must be centred
    // there, not at local (0, 500, 0).
    expect(f!.centre[0]).toBeCloseTo(10000, 3);
    expect(f!.centre[1]).toBeCloseTo(0, 3);
  });

  it("computes an overflow-safe centre when bbox extremes are large same-sign finite values", () => {
    // bbox[0] and bbox[2] each round to ~9e307 here (individually finite,
    // well under Number.MAX_VALUE), but their naive sum (9e307 + 9e307)
    // overflows to Infinity in plain IEEE-754 arithmetic — verified directly
    // below. centre must still come out finite and correct.
    expect(9e307 + 9e307).toBe(Infinity); // sanity-check the premise itself
    const f = viewportFootprint(cam([0, 500, 0], [0, 0, 0]), 0, [9e307, 0, 0]);
    expect(f).not.toBeNull();
    expect(Number.isFinite(f!.centre[0])).toBe(true);
    expect(f!.centre[0]).toBe(9e307);
  });
});
