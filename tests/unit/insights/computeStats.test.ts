/**
 * Unit tests for computeModelStats and computeObjectStats.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "@cityjson/navara-core";
import { parseCityJSON } from "@cityjson/navara-core";
import {
  computeModelStats,
  computeModelStatsFromRecords,
  computeObjectStats,
  computeObjectStatsFromRecord,
} from "../../../src/insights/computeStats";
import { toObjectRecords } from "@cityjson/navara-flatcitybuf";

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.json",
);
const fixtureJson = JSON.parse(
  fs.readFileSync(fixturePath, "utf-8"),
) as CityJSONRoot;
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

// ---------------------------------------------------------------------------
// Streaming (ResidentObjectRecord) counterparts
// ---------------------------------------------------------------------------

describe("computeModelStatsFromRecords / computeObjectStatsFromRecord", () => {
  const { records } = toObjectRecords(model);

  it("agrees with computeModelStats on the same fixture, via the record path", () => {
    // records and model.objects are built from the same source data, just
    // routed through toObjectRecords instead of walking obj.surfaces
    // directly — same iteration order, so the accumulated sums land on the
    // exact same floating-point totals, not just approximately equal ones.
    expect(computeModelStatsFromRecords(records)).toEqual(
      computeModelStats(model),
    );
  });

  it("agrees with computeObjectStats per object, via the record path", () => {
    for (const record of records) {
      expect(computeObjectStatsFromRecord(record)).toEqual(
        computeObjectStats(model, record.id),
      );
    }
  });

  it("reads r.surfaceCount for the surface count, not roofMetrics.length", () => {
    // Hand-built record, independent of the fixture and of the production
    // formula: surfaceCount (5) deliberately does NOT match roofMetrics.length
    // (2), so a wrong implementation that derived the count from the roof
    // metrics array would be caught here.
    const stats = computeObjectStatsFromRecord({
      id: "x1",
      objectType: "Building",
      attributes: { measuredHeight: 10 },
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 5,
      roofMetrics: [
        {
          areaSqM: 10,
          inclinationDeg: 30,
          azimuthDeg: 90,
          elevationM: 0,
          lod: "2.2",
        },
        {
          areaSqM: 30,
          inclinationDeg: 45,
          azimuthDeg: 90,
          elevationM: 0,
          lod: "2.2",
        },
      ],
      geometryLods: ["2.2"],
      footprintAreaSqM: 15,
      volumeCuM: 150,
      parents: [],
      children: [],
    });

    expect(stats.surfaceCount).toBe(5);
    expect(stats.roofSurfaceCount).toBe(2);
    expect(stats.totalRoofArea).toBe(40);
    expect(stats.height).toBe(10);
    // Weighted average of inclination: (30*10 + 45*30) / 40 = 41.25
    expect(stats.avgRoofSlope).toBeCloseTo(41.25, 10);
    // Both surfaces share the same azimuth, so the area-weighted circular
    // mean is exactly that azimuth regardless of the weights — a property
    // check, not a re-derivation of the atan2 formula under test.
    expect(stats.avgRoofAzimuth).toBeCloseTo(90, 10);
  });

  it("leaves a surface with no azimuth out of the object's mean", () => {
    // A null azimuth read as 0 would drag the circular mean north; the 1-degree
    // flat gate already excludes such a surface, so this pins that it stays
    // excluded and never becomes a NaN either.
    const stats = computeObjectStatsFromRecord({
      id: "flat",
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 2,
      roofMetrics: [
        {
          areaSqM: 900,
          inclinationDeg: 0,
          azimuthDeg: null,
          elevationM: 0,
          lod: "2.2",
        },
        {
          areaSqM: 10,
          inclinationDeg: 40,
          azimuthDeg: 90,
          elevationM: 0,
          lod: "2.2",
        },
      ],
      geometryLods: ["2.2"],
      footprintAreaSqM: 900,
      volumeCuM: null,
      parents: [],
      children: [],
    });
    expect(stats.avgRoofAzimuth).toBeCloseTo(90, 10);
  });

  /**
   * The fix-round review's N3, at the source. `avgRoofAzimuth` used to be a
   * non-nullable number that was 0 both for "nothing to average" and for "due
   * north", which is the same collision the milestone just removed from
   * `computeRoofMetrics`, `aggregate.ts` and `roofRollUp.ts` — and it made
   * `StatsTab`'s `> 0` gate hide the row for a genuinely north-facing building.
   */
  it("gives a due-north roof a mean of 0, not an absent one", () => {
    const stats = computeObjectStatsFromRecord({
      id: "north",
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 1,
      roofMetrics: [
        {
          areaSqM: 50,
          inclinationDeg: 35,
          azimuthDeg: 0,
          elevationM: 0,
          lod: "2.2",
        },
      ],
      geometryLods: ["2.2"],
      footprintAreaSqM: 50,
      volumeCuM: null,
      parents: [],
      children: [],
    });
    expect(stats.avgRoofAzimuth).not.toBeNull();
    expect(stats.avgRoofAzimuth).toBeCloseTo(0, 10);
  });

  it("has NO mean azimuth when every roof is flat", () => {
    const stats = computeObjectStatsFromRecord({
      id: "flat-only",
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 1,
      roofMetrics: [
        {
          areaSqM: 400,
          inclinationDeg: 0,
          azimuthDeg: null,
          elevationM: 0,
          lod: "2.2",
        },
      ],
      geometryLods: ["2.2"],
      footprintAreaSqM: 400,
      volumeCuM: null,
      parents: [],
      children: [],
    });
    expect(stats.avgRoofAzimuth).toBeNull();
  });

  it("uses r.roofMetrics directly (never recomputes from rings) for model-level aggregation", () => {
    const modelStats = computeModelStatsFromRecords([
      {
        id: "a",
        objectType: "Building",
        attributes: {},
        bbox: [0, 0, 0, 1, 1, 1],
        lod: null,
        surfaceCount: 7,
        roofMetrics: [
          {
            areaSqM: 5,
            inclinationDeg: 20,
            azimuthDeg: 0,
            elevationM: 0,
            lod: "2.2",
          },
        ],
        geometryLods: ["2.2"],
        footprintAreaSqM: 5,
        volumeCuM: null,
        parents: [],
        children: [],
      },
      {
        id: "b",
        objectType: "Building",
        attributes: {},
        bbox: [0, 0, 0, 1, 1, 1],
        lod: null,
        surfaceCount: 3,
        roofMetrics: [],
        geometryLods: [],
        footprintAreaSqM: 0,
        volumeCuM: null,
        parents: [],
        children: [],
      },
    ]);

    expect(modelStats.buildingCount).toBe(2);
    // 7 + 3 from r.surfaceCount, NOT from summing roofMetrics lengths (1 + 0).
    expect(modelStats.surfaceCount).toBe(10);
    expect(modelStats.roofSurfaceCount).toBe(1);
    expect(modelStats.totalRoofArea).toBe(5);
  });
});
