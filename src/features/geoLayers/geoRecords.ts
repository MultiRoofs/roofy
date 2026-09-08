import type { ColumnInfo } from "../../insights/columnKind";
import type { FilterCondition, FilterGroup } from "../query/types";
import { publicGeoProperties, readGeoStableFeatureId } from "./geoJsonRecords";

export const GEO_RECORD_ID = Symbol("geo record stable identity");
export interface GeoRecord extends Record<string, unknown> {
  readonly [GEO_RECORD_ID]: string;
}
export function geoRecordId(record: GeoRecord): string {
  return record[GEO_RECORD_ID];
}

/** Read the prepared document used by the renderer into table-safe attributes. */
export function geoRecords(document: unknown): ReadonlyArray<GeoRecord> {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const features =
    source?.type === "FeatureCollection" && Array.isArray(source.features)
      ? source.features
      : source?.type === "Feature"
        ? [source]
        : [];
  return features.flatMap((feature) => {
    const properties = (feature as { properties?: unknown } | null)?.properties;
    if (properties === null || typeof properties !== "object") return [];
    const stableId = readGeoStableFeatureId(
      properties as Record<string, unknown>,
    );
    return stableId === null
      ? []
      : [
          {
            ...publicGeoProperties(properties as Record<string, unknown>),
            [GEO_RECORD_ID]: stableId,
          },
        ];
  });
}

export function geoRecordColumns(
  records: ReadonlyArray<GeoRecord>,
): ReadonlyArray<ColumnInfo> {
  const names = new Set<string>();
  records.forEach((record) =>
    Object.keys(record).forEach((name) => names.add(name)),
  );
  return [...names].map((name) => ({
    name,
    type: records.some((r) => typeof r[name] === "number")
      ? "DOUBLE"
      : "VARCHAR",
    kind: "scalar",
  }));
}
function conditionMatches(row: GeoRecord, condition: FilterCondition): boolean {
  const value = row[condition.column];
  const wanted = condition.value;
  if (condition.op === "isNull") return value === null || value === undefined;
  if (condition.op === "isNotNull")
    return value !== null && value !== undefined;
  // SQL WHERE comparisons with NULL are unknown, never matching.
  if (value === null || value === undefined) return false;
  const text = String(value);
  switch (condition.op) {
    case "contains":
      return text.toLowerCase().includes(String(wanted).toLowerCase());
    case "startsWith":
      return text.toLowerCase().startsWith(String(wanted).toLowerCase());
    case "endsWith":
      return text.toLowerCase().endsWith(String(wanted).toLowerCase());
    case "in":
      return Array.isArray(wanted) && wanted.map(String).includes(text);
    case "=":
      return text === String(wanted);
    case "!=":
      return text !== String(wanted);
    case "<":
      return (
        Number.isFinite(Number(value)) &&
        Number.isFinite(Number(wanted)) &&
        Number(value) < Number(wanted)
      );
    case "<=":
      return (
        Number.isFinite(Number(value)) &&
        Number.isFinite(Number(wanted)) &&
        Number(value) <= Number(wanted)
      );
    case ">":
      return (
        Number.isFinite(Number(value)) &&
        Number.isFinite(Number(wanted)) &&
        Number(value) > Number(wanted)
      );
    case ">=":
      return (
        Number.isFinite(Number(value)) &&
        Number.isFinite(Number(wanted)) &&
        Number(value) >= Number(wanted)
      );
  }
}
export function filterGeoRecords(
  records: ReadonlyArray<GeoRecord>,
  filter: FilterGroup | null,
): ReadonlyArray<GeoRecord> {
  if (filter === null || filter.conditions.length === 0) return records;
  return records.filter((row) =>
    filter.logic === "AND"
      ? filter.conditions.every((condition) => conditionMatches(row, condition))
      : filter.conditions.some((condition) => conditionMatches(row, condition)),
  );
}
