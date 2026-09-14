/**
 * Which CityParquet object table a CityObject type belongs in.
 *
 * `cityparquet_write` requires each table in the export schema to be an
 * ORDINARY table named for a CityGML module; a name outside this list is
 * refused. The mapping is the CityGML 3.0 module partition, and everything
 * unrecognised goes to `generics` rather than being dropped — an export that
 * silently loses objects is worse than one with a wide `generics` table.
 *
 * Pure, no engine import.
 */

export type CityGmlModule =
  | "building"
  | "bridge"
  | "tunnel"
  | "construction"
  | "transportation"
  | "vegetation"
  | "relief"
  | "water_body"
  | "land_use"
  | "city_furniture"
  | "generics";

/** Table order inside an exported package — stable, so a diff of two exports
 *  of the same data is empty. */
export const CITY_GML_MODULES: ReadonlyArray<CityGmlModule> = [
  "building",
  "bridge",
  "tunnel",
  "construction",
  "transportation",
  "vegetation",
  "relief",
  "water_body",
  "land_use",
  "city_furniture",
  "generics",
];

/** Families whose members all start with the same word (`BuildingPart`,
 *  `TunnelConstructiveElement`, …). Checked before the exact names. */
const PREFIXES: ReadonlyArray<readonly [string, CityGmlModule]> = [
  ["Building", "building"],
  ["Bridge", "bridge"],
  ["Tunnel", "tunnel"],
];

const EXACT: Readonly<Record<string, CityGmlModule>> = {
  OtherConstruction: "construction",
  Road: "transportation",
  Railway: "transportation",
  TransportSquare: "transportation",
  Waterway: "transportation",
  PlantCover: "vegetation",
  SolitaryVegetationObject: "vegetation",
  TINRelief: "relief",
  WaterBody: "water_body",
  LandUse: "land_use",
  CityFurniture: "city_furniture",
};

export function cityGmlModuleOf(objectType: string): CityGmlModule {
  for (const [prefix, module] of PREFIXES) {
    if (objectType.startsWith(prefix)) return module;
  }
  return EXACT[objectType] ?? "generics";
}

/**
 * The caller's types, partitioned into the tables they will be written to.
 *
 * Modules with no types are omitted — an empty `exp.bridge` would still be a
 * table `cityparquet_init` has to describe, and a package listing an object
 * table with zero rows reads as data loss.
 */
export function groupTypesByModule(
  types: ReadonlyArray<string>,
): ReadonlyArray<{
  readonly module: CityGmlModule;
  readonly types: ReadonlyArray<string>;
}> {
  const buckets = new Map<CityGmlModule, string[]>();
  for (const type of types) {
    const module = cityGmlModuleOf(type);
    const bucket = buckets.get(module);
    if (bucket) bucket.push(type);
    else buckets.set(module, [type]);
  }
  const out: Array<{ module: CityGmlModule; types: ReadonlyArray<string> }> =
    [];
  for (const module of CITY_GML_MODULES) {
    const bucket = buckets.get(module);
    if (bucket) out.push({ module, types: bucket });
  }
  return out;
}
