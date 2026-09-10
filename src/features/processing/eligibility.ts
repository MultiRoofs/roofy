import type { Eligibility, ToolDefinition } from "./types";

export type EncodingName =
  | "cityjson"
  | "cityjsonseq"
  | "flatcitybuf"
  | "citygml"
  | "cityparquet";

export interface EligibilityContext {
  /** `layerKindOf` of the target, or "none" when no layer is active. */
  readonly targetKind:
    | "city"
    | "streaming"
    | "vector"
    | "raster"
    | "tiles"
    | "none";
  readonly sourceEncoding: EncodingName | null;
  readonly hasReader: boolean;
  /** False for a restored dropped-file layer (no source provider). */
  readonly sourceAvailable: boolean;
  readonly tableState: "queued" | "building" | "ready" | "failed" | "none";
  readonly engineState: "uninitialized" | "initializing" | "ready" | "failed";
  readonly hasVectorLayer: boolean;
  readonly extensionState: Readonly<
    Record<"spatial" | "three_d", "unloaded" | "loading" | "loaded" | "failed">
  >;
}

const ENCODING_LABEL: Readonly<Record<EncodingName, string>> = {
  cityjson: "CityJSON",
  cityjsonseq: "CityJSONSeq",
  flatcitybuf: "a streaming FlatCityBuf",
  citygml: "CityGML",
  cityparquet: "CityParquet",
};

/** Spec §5: the disabled-row reasons, in priority order. Pure. */
export function toolEligibility(
  tool: ToolDefinition,
  ctx: EligibilityContext,
): Eligibility {
  if (!tool.implemented) return { ok: false, reason: "Not available yet" };
  if (ctx.engineState === "failed") {
    return { ok: false, reason: "Not available while DuckDB is unavailable" };
  }
  if (tool.target === "city") {
    if (ctx.targetKind !== "city" && ctx.targetKind !== "streaming") {
      return { ok: false, reason: "Needs a city model layer" };
    }
  } else if (ctx.targetKind !== "vector") {
    return { ok: false, reason: "Needs a vector layer" };
  }
  if (tool.needsReader && !ctx.hasReader) {
    const label = ctx.sourceEncoding
      ? ENCODING_LABEL[ctx.sourceEncoding]
      : "an unknown source";
    return {
      ok: false,
      reason: `Needs a CityJSON or CityJSONSeq source; this layer was loaded from ${label}`,
    };
  }
  if (tool.needsReader && !ctx.sourceAvailable) {
    return {
      ok: false,
      reason: "The source file is no longer available; add the layer again",
    };
  }
  if (tool.needsVectorSource && !ctx.hasVectorLayer) {
    return { ok: false, reason: "Add a vector layer to join with" };
  }
  if (
    tool.extension !== null &&
    ctx.extensionState[tool.extension] === "failed"
  ) {
    return {
      ok: false,
      reason: `The ${tool.extension} extension could not be downloaded; check the connection and retry`,
    };
  }
  if (ctx.tableState === "failed") {
    return { ok: false, reason: "This layer's table could not be built" };
  }
  return { ok: true };
}
