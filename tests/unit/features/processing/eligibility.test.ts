import { describe, expect, it } from "vitest";
import {
  toolEligibility,
  type EligibilityContext,
} from "../../../../src/features/processing/eligibility";
import { toolById } from "../../../../src/features/processing/toolRegistry";

const base: EligibilityContext = {
  targetKind: "city",
  sourceEncoding: "cityjsonseq",
  hasReader: true,
  sourceAvailable: true,
  tableState: "ready",
  engineState: "ready",
  hasVectorLayer: true,
  extensionState: { spatial: "loaded", three_d: "loaded" },
};

describe("toolEligibility", () => {
  it("accepts an implemented tool on a ready city layer", () => {
    expect(toolEligibility(toolById("height-from-extent"), base)).toEqual({
      ok: true,
    });
  });

  it("rejects an unimplemented tool with the release note", () => {
    expect(toolEligibility(toolById("measure-solids"), base)).toEqual({
      ok: false,
      reason: "Not available yet",
    });
  });

  it("needs a city model layer for roof and 3D tools", () => {
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        targetKind: "vector",
      }),
    ).toEqual({ ok: false, reason: "Needs a city model layer" });
  });

  it("names the encoding when a reader is missing", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        hasReader: false,
        sourceEncoding: "citygml",
      }),
    ).toEqual({
      ok: false,
      reason:
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityGML",
    });
    expect(
      toolEligibility(tool, {
        ...base,
        hasReader: false,
        sourceEncoding: "flatcitybuf",
        targetKind: "streaming",
      }).ok,
    ).toBe(false);
  });

  it("reports an unavailable restored file", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(toolEligibility(tool, { ...base, sourceAvailable: false })).toEqual({
      ok: false,
      reason: "The source file is no longer available; add the layer again",
    });
  });

  it("asks for a vector layer for cross-layer tools", () => {
    const tool = { ...toolById("join-by-location"), implemented: true };
    expect(toolEligibility(tool, { ...base, hasVectorLayer: false })).toEqual({
      ok: false,
      reason: "Add a vector layer to join with",
    });
  });

  it("reports the engine and the table", () => {
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        engineState: "failed",
      }),
    ).toEqual({
      ok: false,
      reason: "Not available while DuckDB is unavailable",
    });
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        tableState: "failed",
      }),
    ).toEqual({ ok: false, reason: "This layer's table could not be built" });
  });

  it("reports a missing extension download", () => {
    const tool = { ...toolById("join-by-location"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        extensionState: { spatial: "failed", three_d: "loaded" },
      }),
    ).toEqual({
      ok: false,
      reason:
        "The spatial extension could not be downloaded; check the connection and retry",
    });
  });
});
