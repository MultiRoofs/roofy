import { describe, it, expect, beforeEach } from "vitest";
import {
  parseEpsgCode,
  sunDirectionThreeJs,
  computeSunPosition,
  reprojectToLatLon,
  useSolarStore,
} from "../../../../src/features/solar/solarStore";
import type { BBox3 } from "../../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// parseEpsgCode
// ---------------------------------------------------------------------------

describe("parseEpsgCode", () => {
  it("extracts code from OGC URI", () => {
    expect(parseEpsgCode("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(7415);
  });

  it("extracts code from short URI", () => {
    expect(parseEpsgCode("EPSG/0/28992")).toBe(28992);
  });

  it("returns null for undefined", () => {
    expect(parseEpsgCode(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEpsgCode("")).toBeNull();
  });

  it("returns null for non-numeric last segment", () => {
    expect(parseEpsgCode("https://example.com/crs/foo")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sunDirectionThreeJs
// ---------------------------------------------------------------------------

describe("sunDirectionThreeJs", () => {
  it("returns [0, 1, 0] for sun directly overhead (altitude = 90°)", () => {
    const dir = sunDirectionThreeJs(0, Math.PI / 2);
    expect(dir[0]).toBeCloseTo(0, 5);
    expect(dir[1]).toBeCloseTo(1, 5); // Three.js Y = up
    expect(dir[2]).toBeCloseTo(0, 5);
  });

  it("sun at horizon from south (suncalc azimuth=0, altitude=0)", () => {
    // suncalc azimuth 0 = south. So sun is due south at horizon.
    // In CityJSON: easting=0, northing=-1, up=0
    // In Three.js Y-up: [0, 0, -(-1)] = [0, 0, 1]
    const dir = sunDirectionThreeJs(0, 0);
    expect(dir[0]).toBeCloseTo(0, 5);
    expect(dir[1]).toBeCloseTo(0, 5);
    expect(dir[2]).toBeCloseTo(1, 5);
  });

  it("sun at horizon from east (suncalc azimuth = -π/2)", () => {
    // suncalc azimuth: 0=S, positive=W. So -π/2 = east.
    // bearingFromNorth = -π/2 + π = π/2 (east)
    // CityJSON: easting=sin(π/2)*1=1, northing=cos(π/2)*1=0, up=0
    // Three.js: [1, 0, 0]
    const dir = sunDirectionThreeJs(-Math.PI / 2, 0);
    expect(dir[0]).toBeCloseTo(1, 5);
    expect(dir[1]).toBeCloseTo(0, 5);
    expect(dir[2]).toBeCloseTo(0, 5);
  });

  it("sun below horizon has negative Y", () => {
    const dir = sunDirectionThreeJs(0, -Math.PI / 6); // -30° altitude
    expect(dir[1]).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeSunPosition
// ---------------------------------------------------------------------------

describe("computeSunPosition", () => {
  it("returns a valid SunPosition for noon in Amsterdam", () => {
    // June 21, 2025 at noon UTC
    const dt = new Date(Date.UTC(2025, 5, 21, 12, 0, 0));
    const pos = computeSunPosition(dt, { lat: 52.37, lon: 4.9 });

    expect(pos.altitudeDeg).toBeGreaterThan(0); // sun above horizon at noon
    expect(pos.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(pos.azimuthDeg).toBeLessThan(360);
    expect(pos.direction).toHaveLength(3);
    // Direction Y should be positive (sun above horizon)
    expect(pos.direction[1]).toBeGreaterThan(0);
  });

  it("returns negative altitude for midnight", () => {
    const dt = new Date(Date.UTC(2025, 5, 21, 0, 0, 0));
    const pos = computeSunPosition(dt, { lat: 52.37, lon: 4.9 });

    expect(pos.altitudeDeg).toBeLessThan(0);
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

  it("setLatLon computes sun position", () => {
    useSolarStore.getState().setLatLon({ lat: 52.37, lon: 4.9 });

    const { sunPosition, latLon } = useSolarStore.getState();
    expect(latLon).not.toBeNull();
    expect(sunPosition).not.toBeNull();
    expect(sunPosition!.altitudeDeg).toBeGreaterThan(0);
  });

  it("setDatetime recomputes sun position when latLon is set", () => {
    useSolarStore.getState().setLatLon({ lat: 52.37, lon: 4.9 });

    const before = useSolarStore.getState().sunPosition;
    useSolarStore.getState().setDatetime(new Date(Date.UTC(2025, 11, 21, 12, 0, 0)));
    const after = useSolarStore.getState().sunPosition;

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Winter solstice noon should have lower altitude than summer solstice
    expect(after!.altitudeDeg).toBeLessThan(before!.altitudeDeg);
  });

  it("initFromModel extracts lat/lon and computes sun position", () => {
    useSolarStore.getState().initFromModel(
      "https://www.opengis.net/def/crs/EPSG/0/7415",
      [85000, 446000, 0, 87500, 446012, 10],
    );

    const { latLon, sunPosition } = useSolarStore.getState();
    expect(latLon).not.toBeNull();
    expect(sunPosition).not.toBeNull();
  });

  it("initFromModel does nothing for unknown CRS", () => {
    useSolarStore.getState().initFromModel("urn:ogc:def:crs:UNKNOWN:0:9999", [0, 0, 0, 1, 1, 1]);

    const { latLon } = useSolarStore.getState();
    expect(latLon).toBeNull();
  });
});
