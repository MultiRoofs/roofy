/**
 * ONE answer to "which columns will this run write, and in what order".
 * The registry promises them before any run exists, the form prints them, the
 * frozen request carries them and the executor writes them; four literal lists
 * is how a form comes to promise a name a run never writes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOLID_PARAMS,
  SOLID_MEASURES,
  solidColumns,
  solidParams,
  validationColumns,
} from "../../../../src/features/processing/solidParams";
import { toolById } from "../../../../src/features/processing/toolRegistry";

describe("solidParams", () => {
  it("reads an EMPTY draft as the mockup's four primary measures", () => {
    expect(solidParams({})).toEqual(DEFAULT_SOLID_PARAMS);
    expect(DEFAULT_SOLID_PARAMS.measures).toEqual([
      "volume",
      "envelope",
      "footprint",
      "height",
    ]);
  });

  it("keeps the user's ticks in §7.2's order, not click order", () => {
    expect(solidParams({ measures: ["ridge", "volume"] }).measures).toEqual([
      "volume",
      "ridge",
    ]);
  });

  it("keeps an EMPTY tick list empty — that is the state Run refuses", () => {
    expect(solidParams({ measures: [] }).measures).toEqual([]);
  });

  it("drops a measure key it does not know", () => {
    expect(solidParams({ measures: ["volume", "slope"] }).measures).toEqual([
      "volume",
    ]);
  });

  it("is idempotent, so freezing a normalised bag changes nothing", () => {
    const once = solidParams({ measures: ["ground"] });
    expect(solidParams({ ...once })).toEqual(once);
  });

  it("has one spec entry per measure, with no duplicate suffix or label", () => {
    expect(new Set(SOLID_MEASURES.map((m) => m.suffix)).size).toBe(
      SOLID_MEASURES.length,
    );
    expect(new Set(SOLID_MEASURES.map((m) => m.label)).size).toBe(
      SOLID_MEASURES.length,
    );
  });

  it("carries the two accepted hovers, verbatim, and no other", () => {
    // The A5 copy: only Volume and Height trim an explanation off the label.
    const hints = new Map(SOLID_MEASURES.map((m) => [m.key, m.hint]));
    expect(hints.get("volume")).toBe("Only for a closed, valid solid");
    expect(hints.get("height")).toBe("Ridge minus ground at this LoD");
    expect(hints.get("envelope")).toBeNull();
    expect(hints.get("footprint")).toBeNull();
    expect(hints.get("ground")).toBeNull();
    expect(hints.get("ridge")).toBeNull();
  });

  it("labels each measure with the accepted A5 string", () => {
    expect(SOLID_MEASURES.map((m) => m.label)).toEqual([
      "Volume (m³)",
      "Envelope area (m²)",
      "Footprint area (m²)",
      "Height (m)",
      "Ground elevation (m)",
      "Ridge elevation (m)",
    ]);
  });
});

describe("solidColumns", () => {
  it("is §7.2's list in §7.2's order, always ending with the validity flag", () => {
    expect(solidColumns("solid_", DEFAULT_SOLID_PARAMS)).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_envelope_m2", type: "DOUBLE" },
      { name: "solid_footprint_m2", type: "DOUBLE" },
      { name: "solid_height_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
  });

  it("writes the two elevations when they are ticked, still in order", () => {
    expect(
      solidColumns("solid_", { measures: ["ridge", "ground", "volume"] }),
    ).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_ground_m", type: "DOUBLE" },
      { name: "solid_ridge_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
  });

  it("writes `<prefix>valid` even with nothing ticked — §7.2 says always", () => {
    expect(solidColumns("s_", { measures: [] })).toEqual([
      { name: "s_valid", type: "BOOLEAN" },
    ]);
  });

  it("honours a different prefix", () => {
    expect(solidColumns("vol_", { measures: ["volume"] })).toEqual([
      { name: "vol_volume_m3", type: "DOUBLE" },
      { name: "vol_valid", type: "BOOLEAN" },
    ]);
  });
});

describe("validationColumns", () => {
  it("is §7.3's seven columns, four BOOLEAN flags then three counts", () => {
    expect(validationColumns("solid_")).toEqual([
      { name: "solid_closed", type: "BOOLEAN" },
      { name: "solid_manifold", type: "BOOLEAN" },
      { name: "solid_oriented", type: "BOOLEAN" },
      { name: "solid_valid", type: "BOOLEAN" },
      { name: "solid_open_edges_n", type: "DOUBLE" },
      { name: "solid_nonmanifold_edges_n", type: "DOUBLE" },
      { name: "solid_degenerate_faces_n", type: "DOUBLE" },
    ]);
  });
});

/**
 * The registry entry is the GLUE: the form reads the promise, `submitRun`
 * freezes the normalised bag and Run reads the message, all through the
 * definition rather than through this module. A working module wired to a
 * definition that forgot one of the three hooks is the failure these pin.
 */
describe("the measure-solids registry entry", () => {
  const solids = toolById("measure-solids");

  it("promises the mockup's four columns for a draft nobody has touched", () => {
    expect(solids.outputColumns!(solids.defaultPrefix, {})).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_envelope_m2", type: "DOUBLE" },
      { name: "solid_footprint_m2", type: "DOUBLE" },
      { name: "solid_height_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
    expect(solids.defaultPrefix).toBe("solid_");
  });

  it("blocks Run with §6's words once every measure is unticked", () => {
    expect(solids.validateParams!({ measures: [] })).toBe(
      "Pick at least one measure",
    );
    expect(solids.validateParams!({})).toBeNull();
  });

  it("freezes the real values, not the empty bag the user never touched", () => {
    // §6.4: the log is "the reproducible record of the run". An untouched
    // draft is `{}`, and a log that prints "Parameters: —" for a run that
    // measured four things is not reproducible.
    expect(solids.normaliseParams!({})).toEqual({
      measures: ["volume", "envelope", "footprint", "height"],
    });
  });

  it("is still NOT implemented — Task 8 flips it with the LoD answer", () => {
    // §6: an unimplemented tool claims no fact about the user's data, and a
    // flip without `useLodOptions` would render an empty LoD select.
    expect(solids.implemented).toBe(false);
  });
});
