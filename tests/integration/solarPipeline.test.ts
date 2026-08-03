/**
 * Integration test: solar pipeline from model CRS to sun position.
 *
 * Verifies the chain that survived the Navara migration: loading a CityJSON
 * fixture with a known CRS (EPSG:7415) gives EPSG parsing → proj4
 * reprojection → the atmosphere's site lat/lon, and an ENU sun direction
 * reported by the engine turns into the altitude/azimuth the UI shows.
 * The store no longer derives sun position from the datetime — the
 * atmosphere owns that (spec §4.4).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/domain/citymodel/cityjson/parseCityJSON";
import {
  sunPositionFromEnu,
  useSolarStore,
} from "../../src/features/solar/solarStore";

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../fixtures/two-buildings.city.json",
);
const fixtureJson = JSON.parse(
  fs.readFileSync(fixturePath, "utf-8"),
) as CityJSONRoot;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("solar pipeline integration", () => {
  const model = parseCityJSON(fixtureJson);

  beforeEach(() => {
    // Reset store to a known datetime (summer solstice noon UTC)
    useSolarStore.setState({
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      latLon: null,
      sunPosition: null,
    });
  });

  it("initFromModel derives the atmosphere's site lat/lon from the fixture CRS", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    const { latLon } = useSolarStore.getState();

    // Fixture CRS is EPSG:7415 (Netherlands) — should produce valid coordinates
    expect(latLon).not.toBeNull();
    expect(latLon!.lat).toBeGreaterThan(51);
    expect(latLon!.lat).toBeLessThan(53);
    expect(latLon!.lon).toBeGreaterThan(3);
    expect(latLon!.lon).toBeLessThan(6);
  });

  it("an engine-reported ENU direction becomes the altitude/azimuth the UI shows", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    // A high southern sun, as the atmosphere would report it for NL noon:
    // east=0, north=-cos(60°), up=sin(60°).
    const alt = (60 * Math.PI) / 180;
    useSolarStore
      .getState()
      .setSunPosition(sunPositionFromEnu([0, -Math.cos(alt), Math.sin(alt)]));

    const { sunPosition } = useSolarStore.getState();
    expect(sunPosition).not.toBeNull();
    expect(sunPosition!.altitudeDeg).toBeCloseTo(60, 6);
    expect(sunPosition!.azimuthDeg).toBeCloseTo(180, 6);
    expect(sunPosition!.direction[2]).toBeGreaterThan(0); // up = above horizon
  });

  it("a below-horizon direction reports a negative altitude", () => {
    useSolarStore.getState().setSunPosition(sunPositionFromEnu([0, 1, -0.5]));

    const { sunPosition } = useSolarStore.getState();
    expect(sunPosition!.altitudeDeg).toBeLessThan(0);
    expect(sunPosition!.direction[2]).toBeLessThan(0);
  });

  it("sun direction vector is unit-length", () => {
    useSolarStore.getState().setSunPosition(sunPositionFromEnu([3, -4, 12]));

    const [x, y, z] = useSolarStore.getState().sunPosition!.direction;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1.0, 9);
  });

  it("changing the datetime leaves the sun untouched — the atmosphere drives it", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);
    const sun = sunPositionFromEnu([0, 0, 1]);
    useSolarStore.getState().setSunPosition(sun);

    useSolarStore
      .getState()
      .setDatetime(new Date(Date.UTC(2025, 11, 21, 12, 0, 0)));

    expect(useSolarStore.getState().sunPosition).toBe(sun);
    expect(useSolarStore.getState().datetime.toISOString()).toBe(
      "2025-12-21T12:00:00.000Z",
    );
  });

  it("model without CRS produces null latLon", () => {
    useSolarStore.getState().initFromModel(undefined, model.bbox);

    expect(useSolarStore.getState().latLon).toBeNull();
  });

  it("azimuth stays in [0, 360) across the compass", () => {
    const dirs: [number, number, number][] = [
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
      useSolarStore.getState().setSunPosition(sunPositionFromEnu(d));
      const { sunPosition } = useSolarStore.getState();
      expect(sunPosition!.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(sunPosition!.azimuthDeg).toBeLessThan(360);
    }
  });
});
