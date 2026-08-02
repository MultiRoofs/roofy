import { describe, expect, it } from "vitest";
import {
  alignCameraForBounds,
  boundsDiagonalMetres,
  cameraForBounds,
  unionGeodeticBounds,
} from "../../../src/scene/geographicCamera";

const a = {
  west: 4.34,
  south: 52.0,
  east: 4.35,
  north: 52.01,
  minHeight: 0,
  maxHeight: 12,
};
const b = {
  west: 4.36,
  south: 51.99,
  east: 4.37,
  north: 52.005,
  minHeight: 2,
  maxHeight: 30,
};

describe("unionGeodeticBounds", () => {
  it("returns null for an empty list", () => {
    expect(unionGeodeticBounds([])).toBeNull();
  });

  it("covers every input box", () => {
    const u = unionGeodeticBounds([a, b])!;
    expect(u.west).toBe(4.34);
    expect(u.east).toBe(4.37);
    expect(u.south).toBe(51.99);
    expect(u.north).toBe(52.01);
    expect(u.minHeight).toBe(0);
    expect(u.maxHeight).toBe(30);
  });

  it("returns a single box unchanged, without float drift", () => {
    expect(unionGeodeticBounds([b])).toEqual(b);
  });

  it("takes the short way round the antimeridian", () => {
    const east = {
      west: 179.5,
      south: -17.9,
      east: 179.9,
      north: -17.7,
      minHeight: 0,
      maxHeight: 10,
    };
    const west = {
      west: -179.9,
      south: -18.0,
      east: -179.5,
      north: -17.8,
      minHeight: 1,
      maxHeight: 20,
    };
    const u = unionGeodeticBounds([east, west])!;
    // The naive min/max union would be [-179.9, 179.9] — 359.8 degrees wide.
    expect(u.west).toBeCloseTo(179.5, 9);
    expect(u.east).toBeCloseTo(-179.5, 9);
    expect(u.south).toBe(-18.0);
    expect(u.north).toBe(-17.7);
    expect(boundsDiagonalMetres(u)).toBeLessThan(200_000);
  });

  it("skips boxes with non-finite numbers rather than poisoning the union", () => {
    const bad = { ...b, west: Number.NaN };
    expect(unionGeodeticBounds([a, bad])).toEqual(a);
  });

  it("returns null when every box is unusable", () => {
    expect(unionGeodeticBounds([{ ...a, maxHeight: Number.NaN }])).toBeNull();
  });
});

describe("boundsDiagonalMetres", () => {
  it("scales longitude by cos(latitude)", () => {
    const d = boundsDiagonalMetres(a);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1600);
  });

  it("is zero for a degenerate point box", () => {
    expect(
      boundsDiagonalMetres({
        west: 4.35,
        south: 52,
        east: 4.35,
        north: 52,
        minHeight: 3,
        maxHeight: 3,
      }),
    ).toBe(0);
  });

  it("measures a box that wraps the antimeridian across the seam", () => {
    const d = boundsDiagonalMetres({
      west: 179.9,
      south: 0,
      east: -179.9,
      north: 0.1,
      minHeight: 0,
      maxHeight: 0,
    });
    // 0.2 deg of longitude at the equator plus 0.1 deg of latitude, not 359.8.
    expect(d).toBeGreaterThan(20_000);
    expect(d).toBeLessThan(30_000);
  });
});

describe("cameraForBounds", () => {
  it("centres on the box with a tilted view above the top of the model", () => {
    const c = cameraForBounds(a);
    expect(c.lng).toBeCloseTo(4.345, 6);
    expect(c.lat).toBeCloseTo(52.005, 6);
    expect(c.height).toBeGreaterThan(12);
    expect(c.heading).toBe(0);
    expect(c.pitch).toBe(-60);
    expect(c.roll).toBe(0);
  });

  it("never drops below the minimum viewing height for a tiny model", () => {
    const c = cameraForBounds({
      west: 4.35,
      south: 52,
      east: 4.3501,
      north: 52.0001,
      minHeight: 0,
      maxHeight: 3,
    });
    expect(c.height).toBeGreaterThanOrEqual(200);
  });

  it("centres inside the box when it wraps the antimeridian", () => {
    const c = cameraForBounds({
      west: 179.9,
      south: 0,
      east: -179.9,
      north: 0.1,
      minHeight: 0,
      maxHeight: 5,
    });
    // Midpoint of [179.9, 180.1] is the antimeridian itself (+/-180), NOT the
    // 0.0 that a naive (west + east) / 2 would produce.
    expect(Math.abs(Math.abs(c.lng) - 180)).toBeLessThan(1e-9);
    expect(c.lat).toBeCloseTo(0.05, 6);
    expect(Number.isFinite(c.height)).toBe(true);
  });
});

describe("alignCameraForBounds", () => {
  it("maps top to a straight-down view", () => {
    const c = alignCameraForBounds(a, "top");
    expect(c.pitch).toBe(-90);
    expect(c.heading).toBe(0);
  });

  it("maps bottom to a straight-up view", () => {
    const c = alignCameraForBounds(a, "bottom");
    expect(c.pitch).toBe(90);
    expect(c.heading).toBe(0);
  });

  it("maps the four horizontal directions to distinct headings at pitch 0", () => {
    const headings = (["front", "back", "right", "left"] as const).map(
      (d) => alignCameraForBounds(a, d).heading,
    );
    expect(headings).toEqual([0, 180, 90, 270]);
    expect(alignCameraForBounds(a, "right").pitch).toBe(0);
  });

  it("keeps the fit distance when aligning", () => {
    expect(alignCameraForBounds(a, "front").height).toBe(
      cameraForBounds(a).height,
    );
  });

  it("keeps the fit centre when aligning", () => {
    const fit = cameraForBounds(a);
    const aligned = alignCameraForBounds(a, "left");
    expect(aligned.lng).toBe(fit.lng);
    expect(aligned.lat).toBe(fit.lat);
    expect(aligned.roll).toBe(0);
  });
});
