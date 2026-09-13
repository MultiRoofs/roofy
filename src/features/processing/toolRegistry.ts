import type { OutputColumn } from "../../insights/computedColumns";
import {
  aggregateColumns,
  aggregateParams,
  crossLayerParamsError,
  distanceColumns,
  distanceParams,
  joinColumns,
  joinParams,
  resolveCrossLayerParams,
  type CrossLayerContext,
} from "./crossLayerParams";
import { roofColumnNames, roofParams } from "./roofMetricsParams";
import { solidColumns, solidParams, validationColumns } from "./solidParams";
import type { ToolDefinition, ToolId } from "./types";

/**
 * §6.2's default: the first column the run actually wrote. Correct for every
 * tool whose §7 order puts its primary measure first — Roof metrics
 * (`roof_area_m2 >` median), Measure solids (`solid_volume_m3 >` median) and
 * Height from extent (`extent_height_m >` median).
 */
const firstWritten = (
  written: ReadonlyArray<OutputColumn>,
): OutputColumn | null => written[0] ?? null;

/** The context-free half of §6's validation: what the BAG alone decides. The
 *  form re-asks with the real source (`useToolForm`), which is the only reader
 *  that can decide §7.7's "Choose the property to copy". */
const BAG_ONLY: CrossLayerContext = {
  table: null,
  sourcePropertyKeys: [],
  // Empty on purpose. `resolveCrossLayerParams` reads an empty context as "no
  // opinion" rather than "no properties" — it keeps the bag's own `fields`,
  // `fieldTypes`, `nearestIdProperty` and aggregate columns — so re-normalising
  // an already-resolved bag at `submitRun` changes nothing. Three cases in
  // `crossLayerParams.test.ts` pin that, one per tool.
  sourcePropertyTypes: new Map(),
  sourceHasFeatureIds: true,
  numericColumns: [],
};

/** Spec §5 catalogue, in display order. Names and descriptions verbatim. */
export const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    id: "roof-metrics",
    name: "Roof metrics to attributes",
    group: "roof",
    description: "Roof area, slope, azimuth per building",
    longDescription:
      "Writes the roof metrics Roofy already computes as attributes of each building.",
    extension: null,
    needsReader: false,
    target: "city",
    sourceKind: null,
    needsLod: true,
    defaultPrefix: "roof_",
    outputColumns: (prefix, params) =>
      roofColumnNames(prefix, roofParams(params)),
    validateParams: (params) =>
      roofParams(params).measures.length === 0
        ? "Pick at least one measure"
        : null,
    normaliseParams: (params) => ({ ...roofParams(params) }),
    styleByResult: {
      kind: "rule",
      operator: ">",
      value: { kind: "median" },
      pick: firstWritten,
    },
    implemented: true,
  },
  {
    id: "measure-solids",
    name: "Measure solids",
    group: "3d",
    description: "Volume, envelope, footprint, height",
    longDescription:
      "Volume, envelope area, footprint area and height of each building's solid.",
    extension: "three_d",
    needsReader: true,
    target: "city",
    sourceKind: null,
    needsLod: true,
    defaultPrefix: "solid_",
    outputColumns: (prefix, params) =>
      solidColumns(prefix, solidParams(params)),
    validateParams: (params) =>
      solidParams(params).measures.length === 0
        ? "Pick at least one measure"
        : null,
    normaliseParams: (params) => ({ ...solidParams(params) }),
    styleByResult: {
      kind: "rule",
      operator: ">",
      value: { kind: "median" },
      pick: firstWritten,
    },
    implemented: true,
  },
  {
    id: "validate-solids",
    name: "Validate solids",
    group: "3d",
    description: "Closed, manifold, oriented, report",
    longDescription:
      "Checks whether each building's solid is closed, manifold and oriented, with the counts behind the verdict.",
    extension: "three_d",
    needsReader: true,
    target: "city",
    sourceKind: null,
    needsLod: true,
    defaultPrefix: "solid_",
    // No `validateParams` and no `normaliseParams`: §7.3 has no parameters, so
    // there is nothing to refuse and nothing to fill in.
    outputColumns: (prefix) => validationColumns(prefix),
    styleByResult: {
      kind: "rule",
      operator: "=",
      value: { kind: "literal", value: false },
      // The validity flag by NAME, not by position: §7.3 writes seven columns
      // and this is the fourth. `endsWith` rather than an interpolated prefix,
      // because the run's prefix is the user's and the table's spelling wins.
      pick: (written) =>
        written.find((c) => c.name.toLowerCase().endsWith("valid")) ?? null,
    },
    implemented: true,
  },
  {
    id: "height-from-extent",
    name: "Height from extent",
    group: "3d",
    description: "Vertical extent from the bounding box",
    longDescription:
      "The vertical extent of each building's geometry (highest minus lowest coordinate), across all LoDs in the file. Includes chimneys and antennas; not a roof or terrain height.",
    extension: null,
    needsReader: false,
    target: "city",
    sourceKind: null,
    needsLod: false,
    defaultPrefix: "extent_",
    outputColumns: (p) => [
      { name: `${p}height_m`, type: "DOUBLE" },
      { name: `${p}zmin_m`, type: "DOUBLE" },
      { name: `${p}zmax_m`, type: "DOUBLE" },
    ],
    styleByResult: {
      kind: "rule",
      operator: ">",
      value: { kind: "median" },
      pick: firstWritten,
    },
    implemented: true,
  },
  {
    id: "join-by-location",
    name: "Join attributes by location",
    group: "cross-layer",
    description: "Copy area attributes onto the buildings inside them",
    longDescription:
      "Copies attributes of the vector feature each building falls in (zoning, district, noise band, flood zone) onto the building.",
    extension: "spatial",
    needsReader: false,
    target: "city",
    sourceKind: "vector",
    needsLod: false,
    defaultPrefix: "",
    outputColumns: (prefix, params) => joinColumns(prefix, joinParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("join-by-location", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("join-by-location", params, BAG_ONLY),
    styleByResult: {
      kind: "rule",
      operator: "=",
      value: { kind: "mostFrequent" },
      pick: (written) => written.find((c) => c.type === "VARCHAR") ?? null,
    },
    implemented: false,
  },
  {
    id: "aggregate-per-area",
    name: "Aggregate buildings per area",
    group: "cross-layer",
    description: "Count and summarise buildings inside each area",
    longDescription:
      "Summarises the buildings inside each vector feature: count, and sums or means of a numeric column.",
    extension: "spatial",
    needsReader: false,
    target: "vector",
    sourceKind: "city",
    needsLod: false,
    defaultPrefix: "bld_",
    outputColumns: (prefix, params) =>
      aggregateColumns(prefix, aggregateParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("aggregate-per-area", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("aggregate-per-area", params, BAG_ONLY),
    styleByResult: {
      kind: "attribute",
      // Unused for "attribute"; stated rather than left to a cast, because the
      // field is required and a lie would be worse than a redundancy.
      operator: "=",
      value: { kind: "literal", value: true },
      pick: firstWritten,
    },
    implemented: false,
  },
  {
    id: "distance-to-nearest",
    name: "Distance to nearest",
    group: "cross-layer",
    description: "Distance from each building to the nearest feature",
    longDescription:
      "The 2D distance from each building to the nearest feature of a vector layer, with the feature's id.",
    extension: "spatial",
    needsReader: false,
    target: "city",
    sourceKind: "vector",
    needsLod: false,
    defaultPrefix: "",
    outputColumns: (prefix, params) =>
      distanceColumns(prefix, distanceParams(params)),
    validateParams: (params) =>
      crossLayerParamsError("distance-to-nearest", params, BAG_ONLY),
    normaliseParams: (params) =>
      resolveCrossLayerParams("distance-to-nearest", params, BAG_ONLY),
    styleByResult: {
      kind: "rule",
      operator: "<",
      value: { kind: "median" },
      pick: (written) =>
        written.find((c) => c.name.toLowerCase().endsWith("distance_m")) ??
        null,
    },
    implemented: false,
  },
];

export const GROUP_LABELS: Readonly<Record<ToolDefinition["group"], string>> = {
  roof: "ROOF",
  "3d": "3D MEASUREMENTS",
  "cross-layer": "CROSS-LAYER",
};

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

/** Search filter (spec §5): name or description, case-insensitive. */
export function filterTools(
  tools: ReadonlyArray<ToolDefinition>,
  query: string,
): ReadonlyArray<ToolDefinition> {
  const q = query.trim().toLowerCase();
  if (q === "") return tools;
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q),
  );
}
