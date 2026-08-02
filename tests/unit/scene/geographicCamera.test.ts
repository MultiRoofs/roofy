import { describe, expect, it } from "vitest";
import {
  alignCameraForBounds,
  boundsDiagonalMetres,
  cameraForBounds,
  unionGeodeticBounds,
  type GeographicCameraState,
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
  const DEG = Math.PI / 180;
  const METRES_PER_DEGREE_LAT = 111_320;
  const fitDistance = (bounds: typeof a) =>
    Math.max(boundsDiagonalMetres(bounds) * 1.5, 200);

  it("stands SOUTH of and ABOVE the box, looking north and 60 degrees down", () => {
    // BROWSER-VERIFIED regression guard (M7.3 smoke): the earlier framing put
    // the camera directly OVER the centre at `maxHeight + 1.5 * diagonal` and
    // still pitched it -60, which leaves the model 30 degrees below the view
    // axis — outside the frustum. `fitAll` then framed empty space.
    const c = cameraForBounds(a);
    const d = fitDistance(a);
    expect(c.lng).toBeCloseTo(4.345, 6);
    expect(c.lat).toBeCloseTo(
      52.005 - (d * Math.cos(60 * DEG)) / METRES_PER_DEGREE_LAT,
      9,
    );
    expect(c.height).toBeCloseTo(6 + d * Math.sin(60 * DEG), 6);
    expect(c.heading).toBe(0);
    expect(c.pitch).toBeCloseTo(-60, 9);
    expect(c.roll).toBe(0);
  });

  it("looks straight back at the centre from one fit distance away", () => {
    // The same invariant `alignCameraForBounds` obeys — both derive the
    // orientation from the offset, so a fit can never point away from the box.
    const c = cameraForBounds(a);
    const east =
      (4.345 - c.lng) * METRES_PER_DEGREE_LAT * Math.cos(52.005 * DEG);
    const north = (52.005 - c.lat) * METRES_PER_DEGREE_LAT;
    const up = 6 - c.height;
    expect(Math.hypot(east, north, up)).toBeCloseTo(fitDistance(a), 3);
    expect(Math.atan2(up, Math.hypot(east, north)) / DEG).toBeCloseTo(
      c.pitch,
      6,
    );
  });

  it("never stands closer than the minimum distance to a tiny model", () => {
    const tiny = {
      west: 4.35,
      south: 52,
      east: 4.3501,
      north: 52.0001,
      minHeight: 0,
      maxHeight: 3,
    };
    const c = cameraForBounds(tiny);
    const east = (4.35005 - c.lng) * METRES_PER_DEGREE_LAT * Math.cos(52 * DEG);
    const north = (52.00005 - c.lat) * METRES_PER_DEGREE_LAT;
    const up = 1.5 - c.height;
    expect(Math.hypot(east, north, up)).toBeCloseTo(200, 3);
  });

  it("centres inside the box when it wraps the antimeridian", () => {
    const wrapped = {
      west: 179.9,
      south: 0,
      east: -179.9,
      north: 0.1,
      minHeight: 0,
      maxHeight: 5,
    };
    const c = cameraForBounds(wrapped);
    // Midpoint of [179.9, 180.1] is the antimeridian itself (+/-180), NOT the
    // 0.0 that a naive (west + east) / 2 would produce. Only the LATITUDE is
    // offset by the fit, so the camera stays on the seam.
    expect(Math.abs(Math.abs(c.lng) - 180)).toBeLessThan(1e-9);
    expect(c.lat).toBeCloseTo(
      0.05 -
        (fitDistance(wrapped) * Math.cos(60 * DEG)) / METRES_PER_DEGREE_LAT,
      9,
    );
    expect(Number.isFinite(c.height)).toBe(true);
  });
});

describe("alignCameraForBounds", () => {
  const DEG = Math.PI / 180;
  const METRES_PER_DEGREE_LAT = 111_320;
  const ALL_DIRECTIONS = [
    "top",
    "bottom",
    "front",
    "back",
    "right",
    "left",
  ] as const;

  function centreOf(bounds: typeof a) {
    return {
      lng: (bounds.west + bounds.east) / 2,
      lat: (bounds.south + bounds.north) / 2,
      height: (bounds.minHeight + bounds.maxHeight) / 2,
    };
  }

  /** ENU vector, in metres, pointing from the camera at the box centre. */
  function toCentre(cam: GeographicCameraState, bounds: typeof a) {
    const c = centreOf(bounds);
    return {
      east: (c.lng - cam.lng) * METRES_PER_DEGREE_LAT * Math.cos(c.lat * DEG),
      north: (c.lat - cam.lat) * METRES_PER_DEGREE_LAT,
      up: c.height - cam.height,
    };
  }

  /** What the fit distance is documented to be: 1.5 diagonals, floored. */
  function fitDistance(bounds: typeof a) {
    return Math.max(boundsDiagonalMetres(bounds) * 1.5, 200);
  }

  it("stands one fit distance off the centre, whatever the direction", () => {
    for (const direction of ALL_DIRECTIONS) {
      const v = toCentre(alignCameraForBounds(a, direction), a);
      expect(Math.hypot(v.east, v.north, v.up)).toBeCloseTo(fitDistance(a), 3);
    }
  });

  it("DERIVES heading and pitch so the camera faces the box centre", () => {
    // The whole point of the rework: the orientation is computed from where
    // the camera ended up, not read off a fixed table. A camera that is level
    // with the centre gets pitch 0; one above it gets a negative pitch.
    for (const direction of ALL_DIRECTIONS) {
      const cam = alignCameraForBounds(a, direction);
      const v = toCentre(cam, a);
      const horizontal = Math.hypot(v.east, v.north);
      const expectedHeading =
        (((Math.atan2(v.east, v.north) / DEG) % 360) + 360) % 360;
      expect(cam.heading).toBeCloseTo(expectedHeading, 6);
      expect(cam.pitch).toBeCloseTo(Math.atan2(v.up, horizontal) / DEG, 6);
      expect(cam.roll).toBe(0);
    }
  });

  it("maps top to a straight-down view directly over the centre", () => {
    const c = alignCameraForBounds(a, "top");
    expect(c.pitch).toBe(-90);
    expect(c.heading).toBe(0);
    expect(c.lng).toBeCloseTo(4.345, 9);
    expect(c.lat).toBeCloseTo(52.005, 9);
    expect(c.height).toBeCloseTo(centreOf(a).height + fitDistance(a), 6);
  });

  it("maps bottom to a straight-up view directly under the centre", () => {
    const c = alignCameraForBounds(a, "bottom");
    expect(c.pitch).toBe(90);
    expect(c.heading).toBe(0);
    expect(c.lng).toBeCloseTo(4.345, 9);
    expect(c.lat).toBeCloseTo(52.005, 9);
    expect(c.height).toBeCloseTo(centreOf(a).height - fitDistance(a), 6);
  });

  it("makes the four horizontal directions true LEVEL elevation views", () => {
    // Regression guard for the old fixed-pitch presets, which kept the fit
    // ALTITUDE and pitched to the horizon — the model was then below the
    // camera and out of frame. A level view sits at the centre's own height.
    for (const direction of ["front", "back", "right", "left"] as const) {
      const c = alignCameraForBounds(a, direction);
      expect(c.pitch).toBeCloseTo(0, 9);
      expect(c.height).toBeCloseTo(centreOf(a).height, 9);
    }
  });

  it("puts each horizontal camera on the side its name implies", () => {
    // Matches the pre-Navara viewport (X=east, Y=up, Z=south): front looks
    // north from the south side, and `right` views the model's right-hand
    // side, i.e. the camera stands EAST and looks west.
    const headings = (["front", "back", "right", "left"] as const).map(
      (d) => alignCameraForBounds(a, d).heading,
    );
    expect(headings).toEqual([0, 180, 270, 90]);

    const centre = centreOf(a);
    expect(alignCameraForBounds(a, "front").lat).toBeLessThan(centre.lat);
    expect(alignCameraForBounds(a, "back").lat).toBeGreaterThan(centre.lat);
    expect(alignCameraForBounds(a, "right").lng).toBeGreaterThan(centre.lng);
    expect(alignCameraForBounds(a, "left").lng).toBeLessThan(centre.lng);
  });

  it("never stands closer than the minimum distance to a tiny model", () => {
    const tiny = {
      west: 4.35,
      south: 52,
      east: 4.3501,
      north: 52.0001,
      minHeight: 0,
      maxHeight: 3,
    };
    const v = toCentre(alignCameraForBounds(tiny, "front"), tiny);
    expect(Math.hypot(v.east, v.north, v.up)).toBeCloseTo(200, 3);
  });

  it("stays finite for a box that wraps the antimeridian", () => {
    const wrapped = {
      west: 179.9,
      south: 0,
      east: -179.9,
      north: 0.1,
      minHeight: 0,
      maxHeight: 5,
    };
    for (const direction of ALL_DIRECTIONS) {
      const c = alignCameraForBounds(wrapped, direction);
      expect(Number.isFinite(c.lng)).toBe(true);
      expect(c.lng).toBeGreaterThanOrEqual(-180);
      expect(c.lng).toBeLessThanOrEqual(180);
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.height)).toBe(true);
    }
  });

  it("does not divide by zero at the pole", () => {
    const polar = {
      west: 0,
      south: 89.999,
      east: 0.001,
      north: 90,
      minHeight: 0,
      maxHeight: 5,
    };
    for (const direction of ALL_DIRECTIONS) {
      const c = alignCameraForBounds(polar, direction);
      expect(Number.isFinite(c.lng)).toBe(true);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Number.isFinite(c.height)).toBe(true);
    }
  });
});
