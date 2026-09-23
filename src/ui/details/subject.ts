/**
 * The selection's identity and its summary numbers, pure.
 *
 * The DetailsPanel's subject is the thing the user picked: one building (with
 * its parts), one surface, several buildings, or a geospatial feature. This
 * module resolves a selection into that subject and turns a subject into the
 * strings the panel shows — a pure function of the selection and the model,
 * so it is pinned by a test and the panel stays a thin renderer.
 *
 * `subjectOf` never reads a store: the caller hands it `resolveObject`, the
 * one function that turns a layer id + object id into a `CityObject` — which
 * is what lets the static path resolve against `model.objects` and the
 * streaming path against the resident model without this module knowing
 * either.
 */
import type { CityObject, Surface } from "../../domain/citymodel/types";
import type {
  GeoFeatureSelection,
  Selection,
} from "../../domain/selection/types";
import type { RoofMetrics } from "@cityjson/navara-core";
import { computeAverageAzimuth } from "../../domain/roofMetrics/aggregate";

export type Subject =
  | {
      readonly kind: "building";
      readonly layerId: string;
      readonly objectId: string;
      readonly object: CityObject;
      readonly parts: ReadonlyArray<CityObject>;
    }
  | {
      readonly kind: "surface";
      readonly layerId: string;
      readonly objectId: string;
      readonly surfaceIndex: number;
      /** Streaming records retain surface identity but not rings. */
      readonly surface: Surface | null;
      readonly owner: CityObject;
    }
  | {
      readonly kind: "multi";
      readonly layerId: string;
      readonly objectIds: ReadonlyArray<string>;
      readonly objects: ReadonlyArray<CityObject>;
    }
  | {
      readonly kind: "geo";
      readonly geoLayerId: string;
      readonly batchId: number;
      readonly properties: Readonly<Record<string, unknown>>;
    };

export function subjectOf(
  selections: ReadonlyArray<Selection>,
  geoSelection: GeoFeatureSelection | null,
  resolveObject: (layerId: string, id: string) => CityObject | null,
): Subject | null {
  if (geoSelection !== null) {
    return {
      kind: "geo",
      geoLayerId: geoSelection.geoLayerId,
      batchId: geoSelection.batchId,
      properties: geoSelection.properties,
    };
  }
  if (selections.length === 0) return null;
  const first = selections[0]!;

  if (selections.length > 1) {
    const objects = selections
      .map((s) => resolveObject(s.layerId, s.objectId))
      .filter((o): o is CityObject => o !== null);
    return {
      kind: "multi",
      layerId: first.layerId,
      objectIds: selections.map((s) => s.objectId),
      objects,
    };
  }

  const object = resolveObject(first.layerId, first.objectId);
  if (first.kind === "surface") {
    const surface = object?.surfaces[first.surfaceIndex] ?? null;
    if (object === null) return null;
    return {
      kind: "surface",
      layerId: first.layerId,
      objectId: first.objectId,
      surfaceIndex: first.surfaceIndex,
      surface,
      owner: object,
    };
  }

  if (object === null) return null;
  const parts: CityObject[] = [];
  const seen = new Set([object.id]);
  const visit = (parent: CityObject) => {
    for (const childId of parent.children) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = resolveObject(first.layerId, childId);
      if (child === null) continue;
      parts.push(child);
      visit(child);
    }
  };
  visit(object);
  return {
    kind: "building",
    layerId: first.layerId,
    objectId: first.objectId,
    object,
    parts,
  };
}

/** Ids render shortened to their last five characters after an ellipsis, so
 *  the trail fits the panel without hiding which object it is. */
export function shortId(id: string): string {
  return id.length > 5 ? `\u2026${id.slice(-5)}` : id;
}

export type TrailAction = "activate-layer" | "narrow-to-building" | "current";

export interface TrailCrumb {
  readonly label: string;
  readonly act: TrailAction;
}

/** "Delft → Building …25028 → Roof surface 12" — the layer crumb activates
 *  the layer, the building crumb narrows to the whole building, the last
 *  crumb is where we are. */
export function identityTrail(
  subject: Subject,
  layerName: string,
): ReadonlyArray<TrailCrumb> {
  const layer: TrailCrumb = { label: layerName, act: "activate-layer" };
  switch (subject.kind) {
    case "building":
      return [
        layer,
        { label: `Building ${shortId(subject.objectId)}`, act: "current" },
      ];
    case "surface":
      return [
        layer,
        {
          label: `Building ${shortId(subject.objectId)}`,
          act: "narrow-to-building",
        },
        {
          label: `${subject.surface ? formatSurfaceType(subject.surface.type) : "Roof surface"} ${subject.surfaceIndex}`,
          act: "current",
        },
      ];
    case "multi":
      return [
        layer,
        { label: `${subject.objectIds.length} buildings`, act: "current" },
      ];
    case "geo":
      return [layer, { label: "Feature", act: "current" }];
  }
}

/** A row of a summary, with an optional action marker. `act: "owner"` marks
 *  the "Belongs to" row, which the summary section renders as a link that
 *  selects the owning building. */
export interface SummaryRow {
  readonly label: string;
  readonly value: string;
  readonly act?: "owner";
}

/** One roof surface with its owner and its metrics — what SUMMARY and RULE
 *  MATCH need (the owner's attributes to match rules against, the metrics to
 *  sum and average). The `Surface` itself (rings) is deliberately NOT here:
 *  neither consumer reads it, and a streaming record has metrics without
 *  rings. */
export interface ResolvedSurface {
  readonly owner: CityObject;
  readonly metrics: RoofMetrics;
}

/** A building's roofs across the object AND its parts, for SUMMARY and RULE
 *  MATCH. `loading` is true while the source (a streaming resident model) has
 *  not yet materialised the roofs — the panel must wait rather than show a
 *  blank summary. */
export interface ResolvedBuilding {
  readonly object: CityObject;
  readonly parts: ReadonlyArray<CityObject>;
  readonly roofSurfaces: ReadonlyArray<ResolvedSurface>;
  readonly loading: boolean;
}

function attributeString(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = attributes[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** The rows every building summary shows. "Avg solar score" is deliberately
 *  NOT here: it needs the scene's sun direction, which a pure function cannot
 *  reach — the summary SECTION appends it when it can compute it (static
 *  roofs + a sun above the horizon). */
export function buildingSummary(
  building: ResolvedBuilding,
): ReadonlyArray<SummaryRow> {
  const totalArea = building.roofSurfaces.reduce(
    (sum, r) => sum + r.metrics.areaSqM,
    0,
  );
  const metrics = building.roofSurfaces.map((r) => r.metrics);
  const inclinations = metrics.map((m) => m.inclinationDeg);
  const meanSlope =
    inclinations.length > 0
      ? inclinations.reduce((a, b) => a + b, 0) / inclinations.length
      : 0;
  // `computeAverageAzimuth` returns 0 both for due north and for "nothing to
  // average", so the row asks the surfaces themselves whether any of them has
  // an aspect at all.
  const anySloped = metrics.some((m) => m.azimuthDeg !== null);
  const azimuth = anySloped ? computeAverageAzimuth(metrics) : null;

  const rows: SummaryRow[] = [
    { label: "Roof area", value: `${totalArea.toFixed(1)} m\u00B2` },
    { label: "Mean roof slope", value: `${meanSlope.toFixed(1)}\u00B0` },
    { label: "Main orientation", value: formatAzimuth(azimuth) },
  ];

  const attributes = building.object.attributes;
  const height = attributeString(attributes, "measuredHeight");
  if (height !== null) rows.push({ label: "Height", value: `${height} m` });
  const roofType = attributeString(attributes, "roofType");
  if (roofType !== null) rows.push({ label: "Roof type", value: roofType });
  if (building.parts.length > 0) {
    rows.push({ label: "Parts", value: String(building.parts.length) });
  }
  return rows;
}

/** A surface's rows: Area, Slope, Azimuth, Type, and a "Belongs to" row that
 *  selects the owning building. */
export function surfaceSummary(
  surface: Surface,
  metrics: RoofMetrics,
  owner: CityObject,
): ReadonlyArray<SummaryRow> {
  return [
    { label: "Area", value: `${metrics.areaSqM.toFixed(1)} m\u00B2` },
    {
      label: "Slope",
      value: `${metrics.inclinationDeg.toFixed(1)}\u00B0`,
    },
    { label: "Azimuth", value: formatAzimuth(metrics.azimuthDeg) },
    { label: "Type", value: formatSurfaceType(surface.type) },
    {
      label: "Belongs to",
      value: `Building ${shortId(owner.id)}`,
      act: "owner",
    },
  ];
}

/** A geo feature's rows: Name and Zone when present, else the first three
 *  properties. */
export function geoSummary(
  properties: Readonly<Record<string, unknown>>,
): ReadonlyArray<SummaryRow> {
  const entries = Object.entries(properties);
  const name = entries.find(([k]) => k.toLowerCase() === "name");
  const zone = entries.find(([k]) => k.toLowerCase() === "zone");
  const rows: SummaryRow[] = [];
  if (name) rows.push({ label: "Name", value: formatValue(name[1]) });
  if (zone) rows.push({ label: "Zone", value: formatValue(zone[1]) });
  if (rows.length === 0) {
    for (const [key, value] of entries.slice(0, 3)) {
      rows.push({ label: key, value: formatValue(value) });
    }
  }
  return rows;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** "RoofSurface" → "Roof surface", "unknown" → "Surface". */
export function formatSurfaceType(type: Surface["type"]): string {
  if (type === "unknown") return "Surface";
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").replace("Surface", "surface");
}

/** `null` is "no aspect" — core answers that below 0.1 degrees of inclination,
 *  where a bearing would be the frame's tilt rather than the roof's. It must
 *  not read as "N (0°)". */
function formatAzimuth(deg: number | null): string {
  if (deg === null) return "Flat";
  return `${azimuthToCardinal(deg)} (${deg.toFixed(0)}\u00B0)`;
}

function azimuthToCardinal(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return "N";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "E";
  if (deg < 157.5) return "SE";
  if (deg < 202.5) return "S";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "W";
  return "NW";
}
