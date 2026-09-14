import { computeRoofMetrics, type RoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { CityObject } from "../../domain/citymodel/types";

export interface SummaryBin {
  readonly label: string;
  readonly count: number;
}

export interface LayerSummary {
  readonly buildings: number;
  readonly parts: number | null;
  readonly roofSurfaces: number | null;
  readonly totalRoofArea: number | null;
  readonly meanHeight: number | null;
  readonly heightBins: ReadonlyArray<SummaryBin>;
  readonly roofTypes: ReadonlyArray<SummaryBin>;
  readonly constructionYears: ReadonlyArray<SummaryBin>;
}

interface SummaryObject {
  readonly id: string;
  readonly objectType: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly children: ReadonlyArray<string>;
  readonly parents: ReadonlyArray<string>;
  readonly roofMetrics: ReadonlyArray<RoofMetrics> | null;
}

function numberAttribute(
  attributes: Readonly<Record<string, unknown>>,
  name: string,
): number | null {
  const value = attributes[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textAttribute(
  attributes: Readonly<Record<string, unknown>>,
  name: string,
): string | null {
  const value = attributes[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function bins(values: ReadonlyArray<number>, count: number): SummaryBin[] {
  if (values.length === 0) return [];
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) return [{ label: String(min), count: values.length }];
  const width = (max - min) / count;
  const result = Array.from({ length: count }, (_, index) => ({
    label: `${(min + index * width).toFixed(1)}–${(min + (index + 1) * width).toFixed(1)}`,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(count - 1, Math.floor((value - min) / width));
    result[index]!.count++;
  }
  return result;
}

function grouped(values: ReadonlyArray<string>): SummaryBin[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count }));
}

function summarize(
  objects: Readonly<Record<string, SummaryObject>>,
  matchingIds: ReadonlySet<string> | null,
): LayerSummary {
  const roots = Object.values(objects).filter(
    (object) =>
      object.objectType === "Building" &&
      object.parents.length === 0 &&
      (matchingIds === null || matchingIds.has(object.id)),
  );
  const heights: number[] = [];
  const roofTypes: string[] = [];
  const years: number[] = [];
  let parts = 0;
  let roofSurfaces = 0;
  let totalRoofArea = 0;
  let roofMetricsAvailable = true;

  for (const root of roots) {
    const height = numberAttribute(root.attributes, "measuredHeight");
    if (height !== null) heights.push(height);
    const roofType = textAttribute(root.attributes, "roofType");
    if (roofType !== null) roofTypes.push(roofType);
    const year = numberAttribute(root.attributes, "yearOfConstruction");
    if (year !== null) years.push(year);

    const family: SummaryObject[] = [];
    const visited = new Set<string>();
    let incomplete = false;
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const object = objects[id];
      if (object === undefined) {
        incomplete = true;
        return;
      }
      family.push(object);
      for (const childId of object.children) visit(childId);
    };
    visit(root.id);
    if (incomplete) roofMetricsAvailable = false;
    parts += family.filter(
      (object) => object.objectType === "BuildingPart",
    ).length;
    for (const object of family) {
      if (object.roofMetrics === null) {
        roofMetricsAvailable = false;
        continue;
      }
      roofSurfaces += object.roofMetrics.length;
      totalRoofArea += object.roofMetrics.reduce(
        (sum, metric) => sum + metric.areaSqM,
        0,
      );
    }
  }

  return {
    buildings: roots.length,
    parts: roofMetricsAvailable ? parts : null,
    roofSurfaces: roofMetricsAvailable ? roofSurfaces : null,
    totalRoofArea: roofMetricsAvailable ? totalRoofArea : null,
    meanHeight:
      heights.length === 0
        ? null
        : heights.reduce((sum, height) => sum + height, 0) / heights.length,
    heightBins: bins(heights, 8),
    roofTypes: grouped(roofTypes),
    constructionYears: bins(years, 8),
  };
}

export function summarizeCityModel(
  objects: Readonly<Record<string, CityObject>>,
  matchingIds: ReadonlySet<string> | null = null,
): LayerSummary {
  const summaryObjects = Object.fromEntries(
    Object.values(objects).map((object) => [
      object.id,
      {
        id: object.id,
        objectType: object.objectType,
        attributes: object.attributes,
        children: Array.isArray(object.children) ? object.children : [],
        parents: Array.isArray(object.parents) ? object.parents : [],
        roofMetrics: Array.isArray(object.surfaces)
          ? object.surfaces
              .filter((surface) => surface.type === "RoofSurface")
              .map(computeRoofMetrics)
          : null,
      },
    ]),
  );
  return summarize(summaryObjects, matchingIds);
}

export function summarizeResidentRecords(
  records: Readonly<Record<string, ResidentObjectRecord>>,
  matchingIds: ReadonlySet<string> | null = null,
): LayerSummary {
  const summaryObjects = Object.fromEntries(
    Object.values(records).map((record) => [
      record.id,
      {
        id: record.id,
        objectType: record.objectType,
        attributes: record.attributes,
        children: Array.isArray(record.children) ? record.children : [],
        parents: Array.isArray(record.parents) ? record.parents : [],
        roofMetrics: Array.isArray(record.roofMetrics)
          ? record.roofMetrics
          : null,
      },
    ]),
  );
  return summarize(summaryObjects, matchingIds);
}
