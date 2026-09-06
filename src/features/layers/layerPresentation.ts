/**
 * A layer's kind and its one-line state, for the layer list row (Task 17).
 *
 * PURE and engine-free: no React, no Zustand, no `@navaramap/*`. The row
 * itself decides which `LayerStateInput` fields it has to hand (a static
 * city layer's counts, a streaming layer's resident count and status, a
 * restored placeholder's `unavailable` flag, a load failure's `error`) —
 * this module only turns that shape into the string a person reads.
 *
 * Counting is `countRootObjects`, exported here rather than left for Task 17
 * to redo: only ROOT objects (no `parents`) are meaningful counts — a
 * `BuildingPart` is not a second building — and "does every root object
 * happen to be a Building" is the one bit `layerStateLine` needs to choose
 * between "N buildings" and "N objects".
 */
import { toplevelCityObjectType } from "@cityjson/navara-core";
import type { CityModel } from "../../domain/citymodel/types";
import type { ActiveLayer } from "../workspace/activeLayer";
import type { StreamStatus } from "../streaming/streamStore";
import { presentStreamStatus } from "../streaming/streamStatusPresentation";

export type LayerKind = "city" | "streaming" | "vector" | "raster" | "tiles";

export function layerKindOf(item: ActiveLayer): LayerKind {
  if (item.kind === "city") {
    return item.layer.isStreaming ? "streaming" : "city";
  }
  switch (item.layer.kind) {
    case "geojson":
      return "vector";
    case "raster-xyz":
      return "raster";
    case "3d-tiles":
      return "tiles";
  }
}

export interface LayerStateInput {
  readonly kind: LayerKind;
  /** Static city: `Object.keys(model.objects).length`. Superseded by
   *  `counts` when both are given — `counts` is the only source that can
   *  tell "all Buildings" from "mixed types". */
  readonly objectCount?: number;
  /** Static city: root-object counts, from {@link countRootObjects}. */
  readonly counts?: { readonly buildings: number; readonly objects: number };
  /** Static city: `selectedLod`. */
  readonly lod?: string | null;
  /** Streaming: `getResidentModel().featureCount`. */
  readonly residentCount?: number;
  /** Streaming. */
  readonly streamStatus?: StreamStatus;
  /** Vector: `features.length` when the GeoJSON data is inline. */
  readonly featureCount?: number;
  /** Any kind: the load/parse error message. Wins over every other field. */
  readonly error?: string | null;
  /** Any kind: a restored placeholder awaiting a re-link. Wins over
   *  everything but `error`. */
  readonly unavailable?: boolean;
}

/** "1 building", "2 buildings", "1,204 buildings" — grouped digits, unit
 *  pluralized for everything but exactly 1. */
export function pluralize(n: number, unit: string): string {
  return `${formatCount(n)} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Root-object counts for a city model.
 *
 * A root object has no `parents` — a `BuildingPart` under a `Building` does,
 * so it counts toward neither `buildings` nor `objects`. `buildings` counts
 * roots whose `toplevelCityObjectType` is `"Building"`; `objects` counts
 * every root, of any type.
 */
export function countRootObjects(model: CityModel): {
  buildings: number;
  objects: number;
} {
  let buildings = 0;
  let objects = 0;
  for (const object of Object.values(model.objects)) {
    if (object.parents.length > 0) continue;
    objects += 1;
    if (toplevelCityObjectType(object.objectType) === "Building") {
      buildings += 1;
    }
  }
  return { buildings, objects };
}

export function layerStateLine(input: LayerStateInput): string {
  if (input.error != null) return `Error · ${input.error}`;
  if (input.unavailable) return "Needs re-link";
  switch (input.kind) {
    case "city":
      return cityStateLine(input);
    case "streaming":
      return streamingStateLine(input);
    case "vector":
      // `featureCount` is only known for inline data (`features.length`); a
      // URL-sourced GeoJSON layer that loaded fine still has none, and that
      // is not "loading" — unlike a city layer, which always has a model,
      // so a kind label is the honest fallback here.
      return input.featureCount != null
        ? pluralize(input.featureCount, "feature")
        : "GeoJSON";
    case "raster":
      return "Raster";
    case "tiles":
      return "3D Tiles";
  }
}

function cityStateLine(input: LayerStateInput): string {
  const suffix = input.lod != null ? ` · LoD ${input.lod}` : "";
  if (input.counts) {
    const { buildings, objects } = input.counts;
    const allBuildings = objects > 0 && buildings === objects;
    return `${pluralize(objects, allBuildings ? "building" : "object")}${suffix}`;
  }
  if (input.objectCount != null) {
    return `${pluralize(input.objectCount, "object")}${suffix}`;
  }
  return "Loading…";
}

function streamingStateLine(input: LayerStateInput): string {
  const status = input.streamStatus;
  if (
    input.residentCount != null &&
    (status === undefined || status === "idle" || status === "fetching")
  ) {
    return `Streaming · ${formatCount(input.residentCount)} currently loaded`;
  }
  switch (status) {
    case "probing":
      return "Streaming · probing…";
    case "fetching":
      return "Streaming · fetching…";
    case "too-far":
      return `Streaming · ${presentStreamStatus(status).label}`;
    case "error":
      return `Error · ${presentStreamStatus(status, input.error ?? null).label}`;
    case "idle":
    case undefined:
      return "Streaming";
  }
}

/** Grouped digits, one locale (`en-GB`), independent of the host machine's
 *  own locale — same reasoning as `formatCount` in `src/ui/table/tableText.ts`,
 *  reimplemented locally rather than imported: `features/` does not import
 *  from `ui/`. */
const COUNT_FORMAT = new Intl.NumberFormat("en-GB");
function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}
