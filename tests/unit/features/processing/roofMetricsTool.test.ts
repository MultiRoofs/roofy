/**
 * Spec §7.1's tool, and §7's contributor and roll-up rules through it.
 *
 * The pure halves are tested directly: `buildFeatureRowsReadSql` (the run's one
 * statement) and `computeRoofRows` (everything else). The executor itself is
 * glue over them, and `roofMetricsRun.test.ts` drives it through a real run.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildFeatureRowsReadSql,
  computeRoofRows,
} from "../../../../src/features/processing/tools/roofMetrics";
import type { RoofSurfaceMetric } from "../../../../src/domain/roofMetrics/roofRollUp";
import {
  DEFAULT_ROOF_PARAMS,
  type RoofMeasure,
} from "../../../../src/features/processing/roofMetricsParams";
import type { RoofGeometrySource } from "../../../../src/features/processing/roofGeometrySource";
import { toolById } from "../../../../src/features/processing/toolRegistry";

const s = (
  lod: string,
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

/**
 * A source built from two plain maps: which LoDs each object has GEOMETRY at
 * (of any type), and which roof surfaces it has there. The separation IS the
 * rule under test.
 */
function source(
  geometry: Record<string, string[]>,
  roofs: Record<string, RoofSurfaceMetric[]>,
): RoofGeometrySource {
  return {
    has: (id) => id in geometry,
    hasGeometryAt: (id, lod) => (geometry[id] ?? []).includes(lod),
    roofSurfacesAt: (id, lod) =>
      (roofs[id] ?? []).filter((surface) => surface.lod === lod),
  };
}

describe("buildFeatureRowsReadSql", () => {
  it("reads every row when the scope named none", () => {
    expect(buildFeatureRowsReadSql("layer_1", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"',
    );
  });

  it("restricts to the frozen row ids, quoted", () => {
    expect(buildFeatureRowsReadSql("layer_1", ["b1", "o'x"])).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"' +
        ` WHERE "id" IN ('b1', 'o''x')`,
    );
  });
});

describe("computeRoofRows", () => {
  const rows = [
    { id: "B1", f: "B1" },
    { id: "B1P", f: "B1" },
    { id: "B2", f: "B2" },
  ];

  it("gives the ROOT the contributors' roll-up and a PART its own (§8)", async () => {
    const out = await computeRoofRows({
      rows,
      // The part has geometry at 2.2, so per §7 the PART is the contributor and
      // the root's own 2.2 surfaces are ignored (3D BAG stores both).
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        {
          B1: [s("2.2", 999, 0, 0)],
          B1P: [s("2.2", 10, 30, 180), s("2.2", 10, 0, 0)],
          B2: [s("2.2", 4, 45, 90)],
        },
      ),
      params: {
        measures: ["area", "flatShare", "azimuth"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B1P")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B2")).toEqual({
      roof_area_m2: 4,
      roof_flat_share: 0,
      roof_azimuth_deg: 90,
    });
    expect(out.measured).toBe(2);
    expect(out.skipped).toEqual([]);
  });

  it("selects a WALL-ONLY part as the contributor, and then finds no roof", async () => {
    // §7's rule is about GEOMETRY, not roofs: "if any part of the feature has
    // geometry, the PARTS are the contributors and the root's own geometry at
    // that LoD is ignored". A root roof beside a wall-only part is exactly the
    // 3D BAG double-storage the rule exists for, and measuring the root here
    // would report a roof the chosen contributor does not have.
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        { B1: [s("2.2", 40, 30, 180)], B1P: [], B2: [s("2.2", 4, 45, 90)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B2")).toEqual({ roof_area_m2: 4 });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("falls back to the ROOT when no part has geometry at the LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["1.2"], B2: [] },
        { B1: [s("2.2", 12, 20, 270)], B1P: [s("1.2", 99, 20, 0)], B2: [] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: 12 });
    // The part has nothing at 2.2 — its OWN value is NULL, and that does not
    // take the building's away.
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
  });

  it("sums UNEQUAL parts and weights the slope by their areas", async () => {
    const out = await computeRoofRows({
      rows: [
        { id: "B1", f: "B1" },
        { id: "P1", f: "B1" },
        { id: "P2", f: "B1" },
      ],
      source: source(
        { B1: ["2.2"], P1: ["2.2"], P2: ["2.2"] },
        {
          B1: [s("2.2", 500, 90, 0)],
          P1: [s("2.2", 30, 40, 180)],
          P2: [s("2.2", 10, 0, 0)],
        },
      ),
      params: {
        measures: ["area", "slope", "surfaces", "flatArea"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 40,
      roof_flat_m2: 10,
      roof_slope_deg: (30 * 40) / 40,
      roof_surfaces_n: 2,
    });
    expect(out.rows.get("P1")).toEqual({
      roof_area_m2: 30,
      roof_flat_m2: 0,
      roof_slope_deg: 40,
      roof_surfaces_n: 1,
    });
    expect(out.rows.get("P2")).toEqual({
      roof_area_m2: 10,
      roof_flat_m2: 10,
      roof_slope_deg: 0,
      roof_surfaces_n: 1,
    });
  });

  it("writes NULL everywhere and counts the feature skipped, by LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["1.2"], B1P: [], B2: [] },
        { B1: [s("1.2", 5, 0, 0)], B1P: [], B2: [] },
      ),
      params: {
        measures: ["area", "slope", "surfaces"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: null,
      roof_slope_deg: null,
      roof_surfaces_n: null,
    });
    expect(out.measured).toBe(0);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 2 },
    ]);
  });

  it("treats a row the source has never heard of as having nothing", async () => {
    // A streaming feature evicted between Run and the head of the queue. It is
    // in the frozen scope and in the table; it has no geometry NOW, which is
    // exactly what "no roof surfaces at LoD 2.2" says.
    const out = await computeRoofRows({
      rows,
      source: source({ B2: ["2.2"] }, { B2: [s("2.2", 4, 45, 90)] }),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("writes a row for every row the table gave it, and no others", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], ghost: ["2.2"] },
        { B1: [s("2.2", 1, 0, 0)], ghost: [s("2.2", 1, 0, 0)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect([...out.rows.keys()].sort()).toEqual(["B1", "B1P", "B2"]);
  });

  it("respects the threshold in flat area and in the dominant azimuth", async () => {
    const build = (flatThresholdDeg: number) =>
      computeRoofRows({
        rows: [{ id: "B2", f: "B2" }],
        source: source(
          { B2: ["2.2"] },
          { B2: [s("2.2", 10, 4, 45), s("2.2", 6, 9, 270)] },
        ),
        params: { measures: ["flatArea", "azimuth"], flatThresholdDeg },
        prefix: "roof_",
        lod: "2.2",
      });
    expect((await build(5)).rows.get("B2")).toEqual({
      roof_flat_m2: 10,
      roof_azimuth_deg: 270,
    });
    expect((await build(15)).rows.get("B2")).toEqual({
      roof_flat_m2: 16,
      roof_azimuth_deg: null,
    });
  });

  it("declares one DOUBLE column per ticked measure, in the spec's order", async () => {
    const out = await computeRoofRows({
      rows,
      source: source({}, {}),
      params: {
        measures: ["surfaces", "area", "slope"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.columns).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("declares exactly what the tool DEFINITION promised the form", async () => {
    // ONE deciding site for a column's NAME and its TYPE (§7). The form prints
    // the registry's answer before any run exists and the write path
    // interpolates `col.type`; an executor that restates the list is how the
    // two come apart — a BOOLEAN promised and a DOUBLE written, or a column
    // promised and never written.
    const promises = async (params: {
      measures: RoofMeasure[];
      flatThresholdDeg: number;
    }) => {
      const out = await computeRoofRows({
        rows,
        source: source({}, {}),
        params,
        prefix: "dak_",
        lod: "2.2",
      });
      return out.columns;
    };
    const registry = (params: Record<string, unknown>) =>
      toolById("roof-metrics").outputColumns!("dak_", params);

    const all = {
      measures: [...DEFAULT_ROOF_PARAMS.measures],
      flatThresholdDeg: 5,
    };
    expect(await promises(all)).toEqual(registry(all));
    // A SUBSET, because the list is params-dependent: the two sites agreeing on
    // all six proves nothing about the tick the user actually made.
    const subset = {
      measures: ["area", "slope"] as RoofMeasure[],
      flatThresholdDeg: 5,
    };
    expect(await promises(subset)).toEqual(registry(subset));
    expect(await promises(subset)).toEqual([
      { name: "dak_area_m2", type: "DOUBLE" },
      { name: "dak_slope_deg", type: "DOUBLE" },
    ]);
  });

  it("calls onBatch between bounded batches, not per feature", async () => {
    const onBatch = vi.fn(async () => {});
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await computeRoofRows({
      rows: many,
      source: source({}, {}),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
      onBatch,
    });
    // 1200 features at 500 per batch: after the first and second batches.
    expect(onBatch).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as onBatch throws, instead of computing to the end", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await expect(
      computeRoofRows({
        rows: many,
        source: source({}, {}),
        params: { measures: ["area"], flatThresholdDeg: 5 },
        prefix: "roof_",
        lod: "2.2",
        onBatch: async () => {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
  });
});
