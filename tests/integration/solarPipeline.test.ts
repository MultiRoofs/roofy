/**
 * Integration test: solar pipeline from model CRS to sun position.
 *
 * Verifies that loading a CityJSON fixture with a known CRS (EPSG:7415)
 * triggers the full solar chain: EPSG parsing → proj4 reprojection →
 * lat/lon derivation → sun position computation. This covers the M3
 * exit criterion: "A user can change datetime and clearly see the scene respond."
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/domain/citymodel/cityjson/parseCityJSON";
import { useSolarStore } from "../../src/features/solar/solarStore";

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

  it("initFromModel derives lat/lon and sun position from fixture CRS", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    const { latLon, sunPosition } = useSolarStore.getState();

    // Fixture CRS is EPSG:7415 (Netherlands) — should produce valid coordinates
    expect(latLon).not.toBeNull();
    expect(latLon!.lat).toBeGreaterThan(51);
    expect(latLon!.lat).toBeLessThan(53);
    expect(latLon!.lon).toBeGreaterThan(3);
    expect(latLon!.lon).toBeLessThan(6);

    // At noon UTC on summer solstice in NL, sun should be well above horizon
    expect(sunPosition).not.toBeNull();
    expect(sunPosition!.altitudeDeg).toBeGreaterThan(30);
    expect(sunPosition!.direction[1]).toBeGreaterThan(0); // Y-up in Three.js
  });

  it("changing datetime updates sun position", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    const summerNoon = useSolarStore.getState().sunPosition;

    // Move to winter solstice noon
    useSolarStore
      .getState()
      .setDatetime(new Date(Date.UTC(2025, 11, 21, 12, 0, 0)));
    const winterNoon = useSolarStore.getState().sunPosition;

    expect(summerNoon).not.toBeNull();
    expect(winterNoon).not.toBeNull();
    // Winter sun should be lower than summer sun at the same clock time
    expect(winterNoon!.altitudeDeg).toBeLessThan(summerNoon!.altitudeDeg);
  });

  it("midnight produces below-horizon sun position", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    useSolarStore
      .getState()
      .setDatetime(new Date(Date.UTC(2025, 5, 21, 0, 0, 0)));

    const { sunPosition } = useSolarStore.getState();
    expect(sunPosition).not.toBeNull();
    expect(sunPosition!.altitudeDeg).toBeLessThan(0);
    expect(sunPosition!.direction[1]).toBeLessThan(0); // below horizon
  });

  it("sun direction vector is unit-length", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    const { sunPosition } = useSolarStore.getState();
    expect(sunPosition).not.toBeNull();

    const [x, y, z] = sunPosition!.direction;
    const length = Math.sqrt(x * x + y * y + z * z);
    expect(length).toBeCloseTo(1.0, 4);
  });

  it("model without CRS produces null latLon and sunPosition", () => {
    useSolarStore.getState().initFromModel(undefined, model.bbox);

    const { latLon, sunPosition } = useSolarStore.getState();
    expect(latLon).toBeNull();
    expect(sunPosition).toBeNull();
  });

  it("azimuth stays in [0, 360) range across multiple time changes", () => {
    useSolarStore
      .getState()
      .initFromModel(model.metadata.referenceSystem, model.bbox);

    const hours = [0, 3, 6, 9, 12, 15, 18, 21];
    for (const h of hours) {
      useSolarStore
        .getState()
        .setDatetime(new Date(Date.UTC(2025, 5, 21, h, 0, 0)));
      const { sunPosition } = useSolarStore.getState();
      expect(sunPosition).not.toBeNull();
      expect(sunPosition!.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(sunPosition!.azimuthDeg).toBeLessThan(360);
    }
  });
});
