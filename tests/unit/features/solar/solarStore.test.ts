import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultSolarDatetime,
  sunPositionFromEnu,
  useSolarStore,
} from "../../../../src/features/solar/solarStore";

// ---------------------------------------------------------------------------
// sunPositionFromEnu
//
// `parseEpsgCode` moved to @cityjson/navara-core in Task A13; its cases live in
// packages/.../navara-core/tests/citymodel/crsProjDefs.test.ts, not here.
// The CRS->site derivation (`initFromModel`/`reprojectToLatLon`) is gone
// entirely (Task C22): the site now comes from the layer handles' geodetic
// bounds, which `NavaraViewport` pushes in through `setLatLon`.
// ---------------------------------------------------------------------------

describe("sunPositionFromEnu", () => {
  it("reads a straight-up direction as 90 deg altitude", () => {
    const p = sunPositionFromEnu([0, 0, 1]);
    expect(p.altitudeDeg).toBeCloseTo(90, 6);
    expect(p.direction).toEqual([0, 0, 1]);
  });

  it("reads due east on the horizon as altitude 0, azimuth 90", () => {
    const p = sunPositionFromEnu([1, 0, 0]);
    expect(p.altitudeDeg).toBeCloseTo(0, 6);
    expect(p.azimuthDeg).toBeCloseTo(90, 6);
  });

  it("reads due south as azimuth 180 and normalises a non-unit input", () => {
    const p = sunPositionFromEnu([0, -5, 0]);
    expect(p.azimuthDeg).toBeCloseTo(180, 6);
    expect(Math.hypot(...p.direction)).toBeCloseTo(1, 9);
  });

  it("reports a negative altitude for a below-horizon direction", () => {
    expect(sunPositionFromEnu([0, 1, -1]).altitudeDeg).toBeLessThan(0);
  });

  it("wraps a westerly azimuth into [0,360)", () => {
    expect(sunPositionFromEnu([-1, 0, 0]).azimuthDeg).toBeCloseTo(270, 6);
  });

  it("falls back to a zero direction for a degenerate input", () => {
    const p = sunPositionFromEnu([0, 0, 0]);
    expect(p.direction).toEqual([0, 0, 0]);
    expect(p.altitudeDeg).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("defaultSolarDatetime", () => {
  // The scene starts on the wall clock no longer: an evening session used to
  // open onto an almost-black globe, which reads as a broken renderer.
  it("keeps today's UTC date but pins midday UTC", () => {
    const dt = defaultSolarDatetime(new Date("2026-08-03T22:41:07.500Z"));
    expect(dt.toISOString()).toBe("2026-08-03T12:00:00.000Z");
  });

  it("uses the UTC date, not the local one, so it never drifts a day", () => {
    const dt = defaultSolarDatetime(new Date("2026-01-01T00:30:00.000Z"));
    expect(dt.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("puts the sun well above the horizon over Europe", () => {
    // 12:00 UTC is solar noon on the prime meridian; Delft (4.35E) is within
    // 20 minutes of it, so the sun is at its daily maximum whatever the date.
    expect(defaultSolarDatetime().getUTCHours()).toBe(12);
  });
});

describe("useSolarStore", () => {
  beforeEach(() => {
    useSolarStore.setState({
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      latLon: null,
      sunPosition: null,
    });
  });

  it("setSunPosition stores what the engine reported, without recomputing anything", () => {
    const sun = sunPositionFromEnu([0, 0, 1]);
    useSolarStore.getState().setSunPosition(sun);
    expect(useSolarStore.getState().sunPosition).toBe(sun);
  });

  it("setDatetime no longer derives a sun position — the atmosphere owns that", () => {
    useSolarStore.getState().setSunPosition(null);
    useSolarStore.getState().setDatetime(new Date("2026-06-21T12:00:00Z"));
    expect(useSolarStore.getState().sunPosition).toBeNull();
    expect(useSolarStore.getState().datetime.toISOString()).toBe(
      "2026-06-21T12:00:00.000Z",
    );
  });

  it("setLatLon no longer derives a sun position either", () => {
    useSolarStore.getState().setSunPosition(sunPositionFromEnu([0, 0, 1]));
    useSolarStore.getState().setLatLon({ lat: 52.37, lon: 4.9 });
    expect(useSolarStore.getState().latLon).toEqual({ lat: 52.37, lon: 4.9 });
    // The engine-reported sun survives a site change; only C16's wiring
    // replaces it.
    expect(useSolarStore.getState().sunPosition).not.toBeNull();
  });

  it("setLatLon(null) clears the site — the only way a site is now cleared", () => {
    useSolarStore.getState().setLatLon({ lat: 52.37, lon: 4.9 });
    useSolarStore.getState().setLatLon(null);
    expect(useSolarStore.getState().latLon).toBeNull();
  });

  // Migrated from the retired tests/integration/solarPipeline.test.ts, whose
  // fixture->CRS->proj4->site chain died with `initFromModel` (Task C22).
  // This sweep is the one case that file covered and this one did not.
  it("azimuth stays in [0, 360) across the compass", () => {
    const dirs: ReadonlyArray<[number, number, number]> = [
      [0, 1, 0.2],
      [1, 1, 0.2],
      [1, 0, 0.2],
      [1, -1, 0.2],
      [0, -1, 0.2],
      [-1, -1, 0.2],
      [-1, 0, 0.2],
      [-1, 1, 0.2],
    ];
    for (const d of dirs) {
      const p = sunPositionFromEnu(d);
      expect(p.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(p.azimuthDeg).toBeLessThan(360);
    }
  });
});
