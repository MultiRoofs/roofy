import type { ToolDefinition, ToolId } from "./types";

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
    needsVectorSource: false,
    defaultPrefix: "roof_",
    implemented: false,
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
    needsVectorSource: false,
    defaultPrefix: "solid_",
    implemented: false,
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
    needsVectorSource: false,
    defaultPrefix: "solid_",
    implemented: false,
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
    needsVectorSource: false,
    defaultPrefix: "extent_",
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
    needsVectorSource: true,
    defaultPrefix: "",
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
    needsVectorSource: false,
    defaultPrefix: "bld_",
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
    needsVectorSource: true,
    defaultPrefix: "",
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
