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
  hasCityLayer: true,
  vectorPreparation: "none",
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
    // The REAL Join entry: it is implemented now, so this is the reason its
    // catalogue row actually shows on a workspace with no vector layer.
    const tool = toolById("join-by-location");
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
    const tool = toolById("join-by-location");
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
        hasCityLayer: true,
        vectorPreparation: "none",
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
        hasCityLayer: true,
        vectorPreparation: "none",
        extensionState: { spatial: "unloaded", three_d: "unloaded" },
      }),
    ).toEqual({ ok: false, reason: "Needs a city model layer" });
  });

  it("asks for a city layer for Aggregate buildings per area", () => {
    const tool = { ...toolById("aggregate-per-area"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        targetKind: "vector",
        vectorPreparation: "ready",
        hasCityLayer: false,
      }),
    ).toEqual({ ok: false, reason: "Add a city model layer to aggregate" });
  });

  it("refuses a vector target whose document is still loading, or failed", () => {
    const tool = { ...toolById("aggregate-per-area"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        targetKind: "vector",
        vectorPreparation: "loading",
      }),
    ).toEqual({ ok: false, reason: "This vector layer is still loading" });
    expect(
      toolEligibility(tool, {
        ...base,
        targetKind: "vector",
        vectorPreparation: "failed",
      }),
    ).toEqual({ ok: false, reason: "This vector layer could not be loaded" });
  });

  it("says the document is loading before it asks for a city layer", () => {
    // §5's order: the target's own readiness outranks the workspace question,
    // so a user with neither is told about the layer in front of them first.
    const tool = { ...toolById("aggregate-per-area"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        targetKind: "vector",
        vectorPreparation: "loading",
        hasCityLayer: false,
      }),
    ).toEqual({ ok: false, reason: "This vector layer is still loading" });
  });

  it("still refuses Aggregate on a city layer, with \u00a75's own words", () => {
    const tool = { ...toolById("aggregate-per-area"), implemented: true };
    expect(toolEligibility(tool, base)).toEqual({
      ok: false,
      reason: "Needs a vector layer",
    });
  });

  it("accepts the real Join entry on a ready city layer beside a vector one", () => {
    // Every reason above answered: Join ships in this commit, so its row is
    // enabled rather than "Not available yet".
    expect(toolEligibility(toolById("join-by-location"), base)).toEqual({
      ok: true,
    });
  });

  it("keeps the real Aggregate row at 'Not available yet' until Task 19", () => {
    // `!implemented` outranks every reason above, on a target that satisfies
    // all of them.
    expect(
      toolEligibility(toolById("aggregate-per-area"), {
        ...base,
        targetKind: "vector",
        vectorPreparation: "ready",
      }),
    ).toEqual({ ok: false, reason: "Not available yet" });
  });
});
