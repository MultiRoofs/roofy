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
  /** A city model layer exists somewhere in the workspace — Aggregate's
   *  mirror of `hasVectorLayer` (§5 gives the sentence for a vector source
   *  only; **[adapted copy A3]** gives this one). */
  readonly hasCityLayer: boolean;
  /**
   * A VECTOR target's document state. `"none"` when the target is not a vector
   * layer, or is one whose bytes did not survive a reload — that case is the
   * form's "The layer has no areas" (§7.6), not an eligibility refusal.
   */
  readonly vectorPreparation: "loading" | "ready" | "failed" | "none";
  readonly extensionState: Readonly<
    Record<"spatial" | "three_d", "unloaded" | "loading" | "loaded" | "failed">
  >;
  /**
   * The CRS the target's ACTIVE table measures in (`LayerTable.sourceCrs`,
   * ruling R-G), or `null` when nothing recorded one.
   *
   * Only a file-backed CityParquet family view records it today, which is
   * exactly the case ruling S2 is about: the view reads the FILE, so its `bbox`
   * columns are the file's own coordinates — degrees for a PLATEAU package —
   * rather than the metres the scene is drawn in.
   */
  readonly activeTableCrs: string | null;
  /**
   * Whether {@link activeTableCrs} is metre-based. `null` is NO CLAIM, which is
   * every layer whose table carries no CRS — so nothing that worked before this
   * ruling is refused by it.
   *
   * Resolved by the caller (`eligibilityContextFor`) rather than here, because
   * the answer needs proj4's registry and this module stays a pure predicate.
   */
  readonly activeTableCrsMetric: boolean | null;
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
  } else {
    if (ctx.targetKind !== "vector") {
      return { ok: false, reason: "Needs a vector layer" };
    }
    // §7.5-§7.7 assume a loaded document: the predicates read its features and
    // the results are written onto its properties. **[adapted copy A4]**
    if (ctx.vectorPreparation === "loading") {
      return { ok: false, reason: "This vector layer is still loading" };
    }
    if (ctx.vectorPreparation === "failed") {
      return { ok: false, reason: "This vector layer could not be loaded" };
    }
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
  if (tool.sourceKind === "vector" && !ctx.hasVectorLayer) {
    return { ok: false, reason: "Add a vector layer to join with" };
  }
  if (tool.sourceKind === "city" && !ctx.hasCityLayer) {
    // **[adapted copy A3]**
    return { ok: false, reason: "Add a city model layer to aggregate" };
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
  // Ruling S2, LAST of the reasons: it is about the table's coordinates, so
  // every reason that says the table is not even usable outranks it.
  const metric = metricBoundsRefusal(tool, ctx);
  if (metric !== null) return { ok: false, reason: metric };
  return { ok: true };
}

/**
 * Ruling S2's sentence, or `null` when the tool may run.
 *
 * Exported because the refusal is a statement about a TABLE, and the table a
 * run measures is not always the target's: Aggregate buildings per area writes
 * to a vector layer and reads a CITY layer, whose row in the source select has
 * to carry the same sentence (`useToolForm`).
 *
 * "Temporary" is part of the message on purpose: the bounds are not wrong, they
 * are in the file's own CRS, and the next milestone makes the coordinate story
 * coherent. A user told only "not supported" would go looking for a different
 * file.
 */
export function metricBoundsRefusal(
  tool: Pick<ToolDefinition, "needsMetricBounds">,
  ctx: Pick<EligibilityContext, "activeTableCrs" | "activeTableCrsMetric">,
): string | null {
  if (!tool.needsMetricBounds) return null;
  if (ctx.activeTableCrsMetric !== false) return null;
  return `This layer's table measures ${
    ctx.activeTableCrs ?? "an unknown CRS"
  }, which is not metre-based; temporary, until CityParquet coordinates are reworked`;
}
