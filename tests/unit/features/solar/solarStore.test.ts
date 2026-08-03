import { describe, it, expect, beforeEach } from "vitest";
import {
  sunPositionFromEnu,
  reprojectToLatLon,
  useSolarStore,
} from "../../../../src/features/solar/solarStore";
import type { BBox3 } from "../../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// sunPositionFromEnu
//
// `parseEpsgCode` moved to @cityjson/navara-core in Task A13; its cases live in
// packages/.../navara-core/tests/citymodel/crsProjDefs.test.ts, not here.
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
// reprojectToLatLon
// ---------------------------------------------------------------------------

describe("reprojectToLatLon", () => {
  it("reprojects Dutch RD New (EPSG:7415) bbox to WGS84", () => {
    // Fixture bbox center approximately at Delft, Netherlands
    const bbox: BBox3 = [85000, 446000, 0, 87500, 446012, 10];
    const result = reprojectToLatLon(bbox, 7415);

    expect(result).not.toBeNull();
    // Should be in western Netherlands
    expect(result!.lat).toBeGreaterThan(51);
    expect(result!.lat).toBeLessThan(53);
    expect(result!.lon).toBeGreaterThan(3);
    expect(result!.lon).toBeLessThan(6);
  });

  it("returns null for unknown EPSG code", () => {
    const bbox: BBox3 = [0, 0, 0, 1, 1, 1];
    expect(reprojectToLatLon(bbox, 99999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

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

  it("initFromModel still derives lat/lon via proj4 for the atmosphere's site", () => {
    useSolarStore
      .getState()
      .initFromModel(
        "https://www.opengis.net/def/crs/EPSG/0/7415",
        [84000, 446000, 0, 86000, 448000, 20],
      );
    const { latLon } = useSolarStore.getState();
    expect(latLon!.lat).toBeCloseTo(52.0, 1);
    expect(latLon!.lon).toBeCloseTo(4.36, 1);
  });

  it("initFromModel clears latLon for an unknown CRS", () => {
    useSolarStore
      .getState()
      .initFromModel("urn:ogc:def:crs:UNKNOWN:0:9999", [0, 0, 0, 1, 1, 1]);
    expect(useSolarStore.getState().latLon).toBeNull();
  });

  it("initFromModel clears latLon when the model has no bbox", () => {
    useSolarStore.getState().setLatLon({ lat: 52.37, lon: 4.9 });
    useSolarStore
      .getState()
      .initFromModel("https://www.opengis.net/def/crs/EPSG/0/7415", null);
    expect(useSolarStore.getState().latLon).toBeNull();
  });
});
