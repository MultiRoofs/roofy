/** Pure, surface-level legend counts. These are deliberately separate from
 * building/table totals: palette and rule entries describe rendered surfaces,
 * while vector entries describe features. */
import { computeRoofMetrics, type RoofMetrics } from "@cityjson/navara-core";
import type { CityObject } from "../../domain/citymodel/types";
import type { ResidentModel } from "../../features/streaming/residentModel";
import type { GeoLayer } from "../../features/geoLayers/geoLayerStore";
import { readGeoStableFeatureId } from "../../features/geoLayers/geoJsonRecords";
import type { Layer } from "../../features/layers/layerStore";
import { CATEGORY_OTHER_HEX } from "../../scene/cityColors";
import { firstMatchingRule } from "../../features/rules/colorBy";
import {
  cityRows,
  geoRows,
  legendGroups,
  type LegendGroup,
  type LegendRow,
} from "./legendModel";

export interface CountedLegendRow extends LegendRow {
  readonly count: number | null;
  readonly currentlyLoaded: boolean;
}

export interface CountedLegendGroup extends Omit<LegendGroup, "rows"> {
  readonly rows: ReadonlyArray<CountedLegendRow>;
}

const roofMetricsByObject = new WeakMap<
  CityObject,
  ReadonlyArray<{
    readonly metrics: RoofMetrics;
    readonly attributes: Readonly<Record<string, unknown>>;
  }>
>();

function staticRoofs(object: CityObject): ReadonlyArray<{
  readonly metrics: RoofMetrics;
  readonly attributes: Readonly<Record<string, unknown>>;
}> {
  const cached = roofMetricsByObject.get(object);
  if (cached !== undefined) return cached;
  const roofs = object.surfaces
    .filter((surface) => surface.type === "RoofSurface")
    .map((surface) => ({
      metrics: computeRoofMetrics(surface),
      attributes: object.attributes,
    }));
  roofMetricsByObject.set(object, roofs);
  return roofs;
}

function shown(
  layer: Layer,
  object: { readonly id: string; readonly objectType: string },
): boolean {
  return (
    !layer.hiddenTypes.includes(object.objectType) &&
    (layer.visibleObjectIds === null || layer.visibleObjectIds.has(object.id))
  );
}

function cityCounts(
  layer: Layer,
  resident: ResidentModel | undefined,
): ReadonlyArray<number | null> {
  const rows = cityRows(layer);
  const streaming = layer.isStreaming;
  const surfaceCounts = new Map<string, number>([
    ["RoofSurface", 0],
    ["WallSurface", 0],
    ["GroundSurface", 0],
  ]);
  let total = 0;
  let unavailable = false;
  let metricsUnavailable = false;
  const ruleCounts = new Map<string, number>();
  let unmatched = 0;

  const matchRoof = (
    attributes: Readonly<Record<string, unknown>>,
    metrics: RoofMetrics,
  ) => {
    const match = firstMatchingRule(attributes, metrics, layer.rules);
    if (match === null) unmatched += 1;
    else ruleCounts.set(match.id, (ruleCounts.get(match.id) ?? 0) + 1);
  };

  if (streaming) {
    for (const record of Object.values(resident?.objects ?? {})) {
      if (!shown(layer, record)) continue;
      if (!Number.isFinite(record.surfaceCount)) unavailable = true;
      else total += record.surfaceCount;
      if (!Array.isArray(record.roofMetrics)) {
        metricsUnavailable = true;
        continue;
      }
      surfaceCounts.set(
        "RoofSurface",
        (surfaceCounts.get("RoofSurface") ?? 0) + record.roofMetrics.length,
      );
      for (const metrics of record.roofMetrics)
        matchRoof(record.attributes, metrics);
    }
  } else {
    for (const object of Object.values(layer.model.objects)) {
      if (!object || !shown(layer, object)) continue;
      total += object.surfaces.length;
      for (const surface of object.surfaces) {
        surfaceCounts.set(
          surface.type,
          (surfaceCounts.get(surface.type) ?? 0) + 1,
        );
      }
      for (const roof of staticRoofs(object))
        matchRoof(roof.attributes, roof.metrics);
    }
  }

  const visibleRuleIds = layer.rules
    .filter((rule) => rule.enabled)
    .map((rule) => rule.id);
  let visibleRuleIndex = 0;
  return rows.map((row) => {
    if (row.kind === "single") return unavailable ? null : total;
    if (row.kind === "surface") {
      if (streaming && row.label !== "Roof") return null;
      if (streaming && metricsUnavailable) return null;
      if (row.label === "Other") {
        return [...surfaceCounts.entries()]
          .filter(
            ([type]) =>
              !["RoofSurface", "WallSurface", "GroundSurface"].includes(type),
          )
          .reduce((sum, [, count]) => sum + count, 0);
      }
      return surfaceCounts.get(`${row.label}Surface`) ?? 0;
    }
    if (row.kind === "rule") {
      const ruleId = visibleRuleIds[visibleRuleIndex++];
      return unavailable || metricsUnavailable
        ? null
        : (ruleCounts.get(ruleId ?? "") ?? 0);
    }
    if (row.kind === "unmatched")
      return unavailable || metricsUnavailable ? null : unmatched;
    return null;
  });
}

function geoFeatures(data: unknown): ReadonlyArray<Record<string, unknown>> {
  if (typeof data !== "object" || data === null) return [];
  if (Array.isArray(data))
    return data.filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null,
    );
  const record = data as Record<string, unknown>;
  if (record.type === "FeatureCollection" && Array.isArray(record.features)) {
    return record.features.filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null,
    );
  }
  return record.type === "Feature" ? [record] : [];
}

/** Counts vector features in the same category buckets used by the renderer.
 * `allowedIds` is optional so a later map filter can constrain this without
 * changing category semantics. */
export function geoLegendCounts(
  layer: Extract<GeoLayer, { readonly kind: "geojson" }>,
  data: unknown,
  allowedIds?: ReadonlySet<string>,
): ReadonlyArray<number | null> {
  const rows = geoRows(layer);
  const counts = rows.map(() => 0);
  if (data === null || data === undefined) return rows.map(() => null);
  const attribute = layer.style.colorByAttribute?.attribute;
  for (const feature of geoFeatures(data)) {
    const properties =
      typeof feature.properties === "object" && feature.properties !== null
        ? (feature.properties as Record<string, unknown>)
        : undefined;
    const id = readGeoStableFeatureId(properties);
    if (allowedIds !== undefined && (id === null || !allowedIds.has(id)))
      continue;
    if (attribute === undefined) {
      counts[0]! += 1;
      continue;
    }
    const raw = properties?.[attribute];
    const value = raw === undefined || raw === null ? null : String(raw);
    const categories = layer.style.colorByAttribute!.categories;
    const isOther = (index: number) =>
      categories[index]!.value === null &&
      categories[index]!.color.toLowerCase() ===
        CATEGORY_OTHER_HEX.toLowerCase();
    const rowIndex = categories.findIndex(
      (category, index) => !isOther(index) && category.value === value,
    );
    const target =
      rowIndex >= 0
        ? rowIndex
        : categories.findIndex((_category, index) => isOther(index));
    if (target >= 0) counts[target]! += 1;
  }
  return counts;
}

export function countedLegendGroups(
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
  residents: ReadonlyMap<string, ResidentModel>,
  geoDocuments: ReadonlyMap<string, unknown | null>,
  geoVisibleIds: Readonly<Record<string, ReadonlySet<string> | null>> = {},
): ReadonlyArray<CountedLegendGroup> {
  return legendGroups(layers, geoLayers).map((group) => {
    const city = layers.find((layer) => layer.id === group.layerId);
    const geo = geoLayers.find((layer) => layer.id === group.layerId);
    const counts = city
      ? cityCounts(city, residents.get(city.id))
      : geo?.kind === "geojson"
        ? geoLegendCounts(
            geo,
            geoDocuments.get(geo.id),
            geoVisibleIds[geo.id] ?? undefined,
          )
        : group.rows.map(() => null);
    const currentlyLoaded = city?.isStreaming === true;
    return {
      ...group,
      rows: group.rows.map((row, index) => ({
        ...row,
        count: counts[index] ?? null,
        currentlyLoaded,
      })),
    };
  });
}
