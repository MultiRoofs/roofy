import { publicGeoProperties, readGeoStableFeatureId } from "./geoJsonRecords";
import { geoRecordId, type GeoRecord } from "./geoRecords";

export type GeoExportScope = "all" | "matching" | "selected";
export type GeoExportFormat = "geojson" | "csv";

function features(document: unknown): ReadonlyArray<Record<string, unknown>> {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  return source?.type === "FeatureCollection" && Array.isArray(source.features)
    ? source.features.filter(
        (feature): feature is Record<string, unknown> =>
          typeof feature === "object" && feature !== null,
      )
    : source?.type === "Feature"
      ? [source as Record<string, unknown>]
      : [];
}
export function scopedGeoFeatures(
  document: unknown,
  scope: GeoExportScope,
  matchingIds: ReadonlySet<string>,
  selectedIds: ReadonlySet<string>,
): ReadonlyArray<Record<string, unknown>> {
  return features(document).flatMap((feature) => {
    const properties =
      typeof feature.properties === "object" && feature.properties !== null
        ? (feature.properties as Record<string, unknown>)
        : {};
    const id = readGeoStableFeatureId(properties);
    if (
      id === null ||
      (scope === "matching" && !matchingIds.has(id)) ||
      (scope === "selected" && !selectedIds.has(id))
    )
      return [];
    return [{ ...feature, properties: publicGeoProperties(properties) }];
  });
}
export function geoExportText(
  document: unknown,
  format: GeoExportFormat,
  scope: GeoExportScope,
  matchingIds: ReadonlySet<string>,
  selectedIds: ReadonlySet<string>,
): string {
  const scoped = scopedGeoFeatures(document, scope, matchingIds, selectedIds);
  if (format === "geojson")
    return JSON.stringify({ type: "FeatureCollection", features: scoped });
  const keys = [
    "source_id",
    ...new Set(
      scoped.flatMap((feature) =>
        Object.keys(feature.properties as Record<string, unknown>),
      ),
    ),
  ];
  const text = (value: unknown) =>
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const cell = (value: unknown) => `"${text(value).replaceAll('"', '""')}"`;
  return [
    keys.map(cell).join(","),
    ...scoped.map((feature) =>
      keys
        .map((key) =>
          cell(
            key === "source_id"
              ? feature.id
              : (feature.properties as Record<string, unknown>)[key],
          ),
        )
        .join(","),
    ),
  ].join("\n");
}
export function geoScopeCount(
  records: ReadonlyArray<GeoRecord>,
  scope: GeoExportScope,
  matchingIds: ReadonlySet<string>,
  selectedIds: ReadonlySet<string>,
): number {
  return scope === "all"
    ? records.length
    : records.filter((record) =>
        (scope === "matching" ? matchingIds : selectedIds).has(
          geoRecordId(record),
        ),
      ).length;
}
