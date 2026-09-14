import { describe, expect, it } from "vitest";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { CityObject } from "../../../../src/domain/citymodel/types";
import {
  summarizeCityModel,
  summarizeResidentRecords,
} from "../../../../src/ui/drawer/layerSummary";

function record(
  id: string,
  objectType: string,
  options: Partial<ResidentObjectRecord> = {},
): ResidentObjectRecord {
  return {
    id,
    objectType,
    attributes: {},
    bbox: null,
    lod: null,
    surfaceCount: 0,
    roofMetrics: [],
    geometryLods: [],
    footprintAreaSqM: 0,
    volumeCuM: null,
    parents: [],
    children: [],
    ...options,
  } as unknown as ResidentObjectRecord;
}

describe("layer summary", () => {
  it("aggregates static roofs held only by BuildingParts", () => {
    const roof = {
      type: "RoofSurface",
      rings: [
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 0, 0],
        ],
      ],
    };
    const root = {
      id: "B1",
      objectType: "Building",
      attributes: { measuredHeight: 12 },
      surfaces: [],
      children: ["P1"],
      parents: [],
    } as unknown as CityObject;
    const part = {
      id: "P1",
      objectType: "BuildingPart",
      attributes: {},
      surfaces: [roof],
      children: [],
      parents: ["B1"],
    } as unknown as CityObject;

    const summary = summarizeCityModel({ B1: root, P1: part });
    expect(summary.buildings).toBe(1);
    expect(summary.parts).toBe(1);
    expect(summary.roofSurfaces).toBe(1);
    expect(summary.totalRoofArea).toBe(0.5);
  });

  it("aggregates child roofs under their Building root", () => {
    const summary = summarizeResidentRecords({
      B1: record("B1", "Building", {
        children: ["P1", "P2"],
        attributes: {
          measuredHeight: 12,
          roofType: "gable",
          yearOfConstruction: 2001,
        },
      }),
      P1: record("P1", "BuildingPart", {
        parents: ["B1"],
        roofMetrics: [
          {
            areaSqM: 10,
            inclinationDeg: 0,
            azimuthDeg: 0,
            elevationM: 0,
            lod: "2.2",
          },
        ],
      }),
      P2: record("P2", "BuildingPart", {
        parents: ["B1"],
        roofMetrics: [
          {
            areaSqM: 15,
            inclinationDeg: 0,
            azimuthDeg: 0,
            elevationM: 0,
            lod: "2.2",
          },
        ],
      }),
    });

    expect(summary.buildings).toBe(1);
    expect(summary.parts).toBe(2);
    expect(summary.roofSurfaces).toBe(2);
    expect(summary.totalRoofArea).toBe(25);
    expect(summary.meanHeight).toBe(12);
  });

  it("uses matching feature ids rather than a page or selection", () => {
    const records = {
      B1: record("B1", "Building", { children: ["P1"] }),
      P1: record("P1", "BuildingPart", { parents: ["B1"] }),
      B2: record("B2", "Building"),
    };

    expect(summarizeResidentRecords(records).buildings).toBe(2);
    // `buildFeatureIdsSql` expands a matching child to its root, so this is
    // the complete feature scope, independent of grid pagination/selection.
    expect(
      summarizeResidentRecords(records, new Set(["B1", "P1"])).buildings,
    ).toBe(1);
  });

  it("does not turn unavailable streaming roof metrics into zero", () => {
    const records = {
      B1: record("B1", "Building", { children: ["P1"] }),
      P1: record("P1", "BuildingPart", {
        parents: ["B1"],
        roofMetrics: undefined as never,
      }),
    };

    const summary = summarizeResidentRecords(records);
    expect(summary.roofSurfaces).toBeNull();
    expect(summary.totalRoofArea).toBeNull();
  });

  it("keeps empty and non-Building datasets truthful", () => {
    expect(summarizeResidentRecords({}).buildings).toBe(0);
    expect(
      summarizeResidentRecords({ P1: record("P1", "BuildingPart") }).buildings,
    ).toBe(0);
  });

  it("recurses through parts once and marks a missing resident child unavailable", () => {
    const complete = summarizeResidentRecords({
      B1: record("B1", "Building", { children: ["P1", "P2"] }),
      P1: record("P1", "BuildingPart", { parents: ["B1"], children: ["P2"] }),
      P2: record("P2", "BuildingPart", { parents: ["P1"], children: ["P1"] }),
      O1: record("O1", "CityObjectGroup", { parents: ["B1"] }),
    });
    expect(complete.parts).toBe(2);

    const incomplete = summarizeResidentRecords({
      B1: record("B1", "Building", { children: ["missing"] }),
    });
    expect(incomplete.parts).toBeNull();
    expect(incomplete.roofSurfaces).toBeNull();
  });
});
