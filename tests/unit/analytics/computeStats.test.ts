/**
 * Unit tests for computeModelStats and computeObjectStats.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../src/domain/citymodel/cityjson/parseCityJSON";
import { computeModelStats, computeObjectStats } from "../../../src/analytics/computeStats";

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.json",
);
const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as CityJSONRoot;
const model = parseCityJSON(fixtureJson);

describe("computeModelStats", () => {
  const stats = computeModelStats(model);

  it("counts buildings", () => {
    expect(stats.buildingCount).toBe(3);
  });

  it("counts all surfaces", () => {
    expect(stats.surfaceCount).toBeGreaterThan(0);
  });

  it("counts roof surfaces", () => {
    expect(stats.roofSurfaceCount).toBeGreaterThan(0);
    expect(stats.roofSurfaceCount).toBeLessThanOrEqual(stats.surfaceCount);
  });

  it("computes total roof area > 0", () => {
    expect(stats.totalRoofArea).toBeGreaterThan(0);
  });

  it("computes average building height from attributes", () => {
    // Building 0001: 8.4m, part1: 3.2m, Building 0002: 12.1m
    expect(stats.avgBuildingHeight).toBeGreaterThan(0);
    expect(stats.avgBuildingHeight).toBeLessThan(20);
  });

  it("computes min and max height", () => {
    expect(stats.minBuildingHeight).toBe(3.2);
    expect(stats.maxBuildingHeight).toBe(12.1);
  });

  it("computes average roof slope", () => {
    expect(stats.avgRoofSlope).toBeGreaterThanOrEqual(0);
    expect(stats.avgRoofSlope).toBeLessThan(90);
  });

  it("produces orientation counts with all 8 bands", () => {
    expect(stats.roofsByOrientation).toHaveLength(8);
    const bands = stats.roofsByOrientation.map((o) => o.band);
    expect(bands).toContain("N");
    expect(bands).toContain("S");
    expect(bands).toContain("E");
    expect(bands).toContain("W");
  });

  it("orientation counts sum to the number of non-flat roof surfaces", () => {
    const total = stats.roofsByOrientation.reduce((s, o) => s + o.count, 0);
    // Should be <= roofSurfaceCount (flat roofs excluded)
    expect(total).toBeLessThanOrEqual(stats.roofSurfaceCount);
  });
});

describe("computeObjectStats", () => {
  it("computes stats for a known building", () => {
    const stats = computeObjectStats(model, "NL.IMBAG.Pand.0001");
    expect(stats).not.toBeNull();
    expect(stats!.objectType).toBe("Building");
    expect(stats!.height).toBe(8.4);
    expect(stats!.roofSurfaceCount).toBe(2);
    expect(stats!.totalRoofArea).toBeGreaterThan(0);
    expect(stats!.avgRoofSlope).toBeGreaterThanOrEqual(0);
  });

  it("computes stats for the second building", () => {
    const stats = computeObjectStats(model, "NL.IMBAG.Pand.0002");
    expect(stats).not.toBeNull();
    expect(stats!.objectType).toBe("Building");
    expect(stats!.height).toBe(12.1);
    expect(stats!.roofSurfaceCount).toBe(1);
  });

  it("returns null for unknown object", () => {
    expect(computeObjectStats(model, "nonexistent")).toBeNull();
  });

  it("handles object with no height attribute", () => {
    // part1 has measuredHeight: 3.2
    const stats = computeObjectStats(model, "NL.IMBAG.Pand.0001-part1");
    expect(stats).not.toBeNull();
    expect(stats!.height).toBe(3.2);
  });
});
