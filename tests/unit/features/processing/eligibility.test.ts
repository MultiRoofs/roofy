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
    // The tool is unimplemented BY DECLARATION, not by whichever registry entry
    // has not shipped yet — Measure solids ships in this commit, and the rule
    // §6 states ("a tool whose executor has not shipped claims no fact about
    // the user's data") outlives every one of them.
    const tool = { ...toolById("measure-solids"), implemented: false };
    expect(toolEligibility(tool, base)).toEqual({
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
    // The REAL Measure solids entry: it is implemented now, so these are the
    // reasons its catalogue row actually shows per layer.
    const tool = toolById("measure-solids");
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
        sourceEncoding: "cityparquet",
      }),
    ).toEqual({
      ok: false,
      reason:
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityParquet",
    });
    // A streaming FlatCityBuf target: a city layer kind the tool accepts, with
    // no reader to re-read the geometry from.
    expect(
      toolEligibility(tool, {
        ...base,
        hasReader: false,
        sourceEncoding: "flatcitybuf",
        targetKind: "streaming",
      }),
    ).toEqual({
      ok: false,
      reason:
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from a streaming FlatCityBuf",
    });
  });

  it("reports an unavailable restored file", () => {
    expect(
      toolEligibility(toolById("measure-solids"), {
        ...base,
        sourceAvailable: false,
      }),
    ).toEqual({
      ok: false,
      reason: "The source file is no longer available; add the layer again",
    });
  });

  it("reports a three_d download that failed, for a 3D tool that ships", () => {
    expect(
      toolEligibility(toolById("measure-solids"), {
        ...base,
        extensionState: { spatial: "loaded", three_d: "failed" },
      }),
    ).toEqual({
      ok: false,
      reason:
        "The three_d extension could not be downloaded; check the connection and retry",
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

  it("lets Roof metrics run on a streaming layer with no reader", () => {
    // Spec §7.1: "works on every city layer kind including streaming (resident
    // set) and CityGML". Nothing about it needs a reader or an extension.
    expect(
      toolEligibility(toolById("roof-metrics"), {
        targetKind: "streaming",
        sourceEncoding: "flatcitybuf",
        hasReader: false,
        sourceAvailable: false,
        tableState: "ready",
        engineState: "ready",
        hasVectorLayer: false,
        extensionState: { spatial: "unloaded", three_d: "unloaded" },
      }),
    ).toEqual({ ok: true });
  });

  it("refuses Roof metrics on a vector layer", () => {
    expect(
      toolEligibility(toolById("roof-metrics"), {
        targetKind: "vector",
        sourceEncoding: null,
        hasReader: false,
        sourceAvailable: false,
        tableState: "none",
        engineState: "ready",
        hasVectorLayer: true,
        extensionState: { spatial: "unloaded", three_d: "unloaded" },
      }),
    ).toEqual({ ok: false, reason: "Needs a city model layer" });
  });
});
