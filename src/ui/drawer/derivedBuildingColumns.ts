import { computeRoofMetrics, type RoofMetrics } from "@cityjson/navara-core";
import type { CityObject } from "../../domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";

export interface DerivedBuildingValues {
  readonly roofArea: number | null;
  readonly meanSlope: number | null;
  readonly parts: number | null;
}

type Source =
  | Pick<CityObject, "id" | "children" | "objectType" | "surfaces">
  | Pick<
      ResidentObjectRecord,
      "id" | "children" | "objectType" | "roofMetrics"
    >;

function metricsOf(object: Source): ReadonlyArray<RoofMetrics> | null {
  if ("roofMetrics" in object)
    return Array.isArray(object.roofMetrics) ? object.roofMetrics : null;
  return Array.isArray(object.surfaces)
    ? object.surfaces
        .filter((surface) => surface.type === "RoofSurface")
        .map(computeRoofMetrics)
    : null;
}

/** Resolves a building family once. Missing resident descendants propagate
 * unavailable values; a cycle is harmless and never double-counts a part. */
export function derivedBuildingValues(
  rootId: string,
  objects: Readonly<Record<string, Source>>,
): DerivedBuildingValues {
  const root = objects[rootId];
  if (!root) return { roofArea: null, meanSlope: null, parts: null };
  const seen = new Set<string>();
  const family: Source[] = [];
  let missing = false;
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const object = objects[id];
    if (!object) {
      missing = true;
      return;
    }
    family.push(object);
    for (const child of object.children) visit(child);
  };
  visit(rootId);
  const metrics = family.flatMap((object) => metricsOf(object) ?? []);
  if (missing || family.some((object) => metricsOf(object) === null))
    return { roofArea: null, meanSlope: null, parts: null };
  const roofArea = metrics.reduce((sum, metric) => sum + metric.areaSqM, 0);
  return {
    roofArea,
    meanSlope:
      metrics.length === 0
        ? null
        : metrics.reduce((sum, metric) => sum + metric.inclinationDeg, 0) /
          metrics.length,
    parts: family.filter(
      (object) => object.id !== rootId && object.objectType === "BuildingPart",
    ).length,
  };
}
