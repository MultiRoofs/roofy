/**
 * ONE answer to "which columns will this run write, and in what order".
 * The registry promises them before any run exists, the form prints them, and
 * the executor writes them; three literal lists is how a form comes to promise
 * a name a run never writes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOF_PARAMS,
  ROOF_MEASURES,
  roofColumnNames,
  roofParams,
} from "../../../../src/features/processing/roofMetricsParams";
import { toolById } from "../../../../src/features/processing/toolRegistry";

describe("roofParams", () => {
  it("reads an EMPTY draft as every measure at the default threshold", () => {
    // `useToolForm` mints a fresh draft with `params: {}`, and the form's
    // column list is printed from it before the user touches anything.
    expect(roofParams({})).toEqual(DEFAULT_ROOF_PARAMS);
    expect(DEFAULT_ROOF_PARAMS.measures).toHaveLength(6);
    expect(DEFAULT_ROOF_PARAMS.flatThresholdDeg).toBe(5);
  });

  it("keeps the user's ticks, in the spec's order rather than click order", () => {
    expect(roofParams({ measures: ["slope", "area"] }).measures).toEqual([
      "area",
      "slope",
    ]);
  });

  it("keeps an EMPTY tick list empty — that is the state Run refuses", () => {
    expect(roofParams({ measures: [] }).measures).toEqual([]);
  });

  it("drops a measure key it does not know", () => {
    expect(roofParams({ measures: ["area", "volume"] }).measures).toEqual([
      "area",
    ]);
  });

  it("clamps the threshold into 0-15 and falls back for a non-number", () => {
    expect(roofParams({ flatThresholdDeg: 12 }).flatThresholdDeg).toBe(12);
    expect(roofParams({ flatThresholdDeg: -3 }).flatThresholdDeg).toBe(0);
    expect(roofParams({ flatThresholdDeg: 99 }).flatThresholdDeg).toBe(15);
    expect(roofParams({ flatThresholdDeg: "5" }).flatThresholdDeg).toBe(5);
    expect(roofParams({ flatThresholdDeg: Number.NaN }).flatThresholdDeg).toBe(
      5,
    );
  });

  it("is idempotent, so freezing a normalised bag changes nothing", () => {
    const once = roofParams({ measures: ["azimuth"], flatThresholdDeg: 9 });
    expect(roofParams({ ...once })).toEqual(once);
  });
});

describe("roofColumnNames", () => {
  it("is spec §7.1's list, in spec §7.1's order, every column DOUBLE", () => {
    expect(roofColumnNames("roof_", DEFAULT_ROOF_PARAMS)).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_flat_m2", type: "DOUBLE" },
      { name: "roof_flat_share", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_azimuth_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("prints only the ticked measures, still in the spec's order", () => {
    expect(
      roofColumnNames("roof_", {
        measures: ["surfaces", "area"],
        flatThresholdDeg: 5,
      }),
    ).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("honours a different prefix", () => {
    expect(
      roofColumnNames("dak_", { measures: ["area"], flatThresholdDeg: 5 }),
    ).toEqual([{ name: "dak_area_m2", type: "DOUBLE" }]);
  });

  it("has one spec entry per measure, and no duplicate suffix or label", () => {
    expect(new Set(ROOF_MEASURES.map((m) => m.suffix)).size).toBe(
      ROOF_MEASURES.length,
    );
    expect(new Set(ROOF_MEASURES.map((m) => m.label)).size).toBe(
      ROOF_MEASURES.length,
    );
  });
});

/**
 * The registry entry is the GLUE: the form reads the promise, `submitRun`
 * freezes the normalised bag and Run reads the message, all through the
 * definition rather than through this module. A working module wired to a
 * definition that forgot one of the three hooks is the failure these pin.
 */
describe("the roof-metrics registry entry", () => {
  const roof = toolById("roof-metrics");

  it("promises §7.1's columns for a draft nobody has touched", () => {
    expect(roof.outputColumns!("roof_", {})).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_flat_m2", type: "DOUBLE" },
      { name: "roof_flat_share", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_azimuth_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("blocks Run with §6's words once every measure is unticked", () => {
    expect(roof.validateParams!({ measures: [] })).toBe(
      "Pick at least one measure",
    );
    expect(roof.validateParams!({})).toBeNull();
  });

  it("freezes the real values, not the empty bag the user never touched", () => {
    // §6.4: the log is "the reproducible record of the run". An untouched
    // draft is `{}`, and a log that prints "Parameters: —" for a run that used
    // six measures and a 5° threshold is not reproducible.
    expect(roof.normaliseParams!({})).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });

  it("is switched on, and asks the form for a LoD", () => {
    expect(roof.implemented).toBe(true);
    expect(roof.needsLod).toBe(true);
  });
});
