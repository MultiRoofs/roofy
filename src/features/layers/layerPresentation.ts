/**
 * How a layer describes itself in words: its kind, its one-line state for the
 * list row (Task 17), and the definition lines the active layer's Details
 * section reads out (Task 18).
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
 * between "N buildings" and "N objects". {@link countRootObjectsByType}
 * applies the same rule per type, for the Details section's breakdown.
 */
import { toplevelCityObjectType } from "@cityjson/navara-core";
import type { CityModelEncoding } from "@cityjson/navara-core";
import type { BBox3, CityModel } from "../../domain/citymodel/types";
import type { ActiveLayer } from "../workspace/activeLayer";
import type { StreamStatus } from "../streaming/streamStore";
import { presentStreamStatus } from "../streaming/streamStatusPresentation";
import { extractCrsCode } from "./crsCode";

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
  /** Static city: root-object counts, from {@link countRootObjects}. The
   *  only source of a static city's count — a plain total (no buildings/
   *  objects split) cannot tell "all Buildings" from "mixed types", and
   *  Task 17 must not have a path that prints "N objects" for a model that
   *  is entirely Buildings. */
  readonly counts?: { readonly buildings: number; readonly objects: number };
  /** Static city: `selectedLod`. */
  readonly lod?: string | null;
  readonly lods?: readonly string[];
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
  /**
   * Any kind: the parent a New-layer run copied this layer from (§6.2's
   * "312 buildings · LoD 2.2 · Derived from Delft").
   *
   * The `layerName` is the COPY recorded at publication, so the tail stays
   * right after the parent is renamed or removed — "a derived layer is
   * independent of its parent from publication on" (§6).
   *
   * Structurally typed, not `DerivedFrom`: this module words a sentence and
   * needs one field of it, and `layerPresentation` has no other reason to
   * know the layer store's types.
   */
  readonly derivedFrom?: { readonly layerName: string } | null;
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

/**
 * Precedence contract: `error` wins over every other field, for every kind
 * — including "streaming" — so a caller with a stream error MUST copy the
 * driver's message into `error` itself (Task 17's row sources do this).
 * `unavailable` comes next, then the per-kind formatting below. The
 * `streamStatus: "error"` branch inside {@link streamingStateLine} is a
 * defensive fallback only, for an input that sets the status without also
 * copying the message — it is never reached through the intended path.
 */
export function layerStateLine(input: LayerStateInput): string {
  if (input.error != null) return `Error · ${input.error}`;
  if (input.unavailable) return "Needs re-link";
  // ONE place, after the per-kind sentence: §6.2 spells the tail for a city
  // layer, and a derived VECTOR layer is the same fact about the same kind of
  // row. Both refusals above still outrank it — a layer that failed says so.
  const tail =
    input.derivedFrom == null
      ? ""
      : ` · Derived from ${input.derivedFrom.layerName}`;
  return `${kindStateLine(input)}${tail}`;
}

function kindStateLine(input: LayerStateInput): string {
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
  const suffix =
    input.lods !== undefined
      ? input.lods.length === 0
        ? " · No LoDs selected"
        : input.lods.length === 1
          ? ` · LoD ${input.lods[0]}`
          : ` · Best of LoDs ${input.lods.join(", ")}`
      : input.lod != null
        ? ` · LoD ${input.lod}`
        : "";
  if (input.counts) {
    const { buildings, objects } = input.counts;
    const allBuildings = objects > 0 && buildings === objects;
    return `${pluralize(objects, allBuildings ? "building" : "object")}${suffix}`;
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

// ---------------------------------------------------------------------------
// The active layer's definition lines (Task 18)
// ---------------------------------------------------------------------------

/**
 * What each encoding is CALLED, in the format's own spelling.
 *
 * A `Record` rather than a `switch`, so adding a member to
 * `CityModelEncoding` upstream is a type error here rather than a silent
 * `undefined` in a panel.
 */
const ENCODING_LABELS: Readonly<Record<CityModelEncoding, string>> = {
  cityjson: "CityJSON",
  cityjsonseq: "CityJSONSeq",
  flatcitybuf: "FlatCityBuf",
  citygml: "CityGML",
  cityparquet: "CityParquet",
};

export function encodingLabel(encoding: CityModelEncoding): string {
  return ENCODING_LABELS[encoding];
}

/**
 * The line under the active layer's name: what kind of thing it is, and —
 * where there is a second word worth saying — what format it came in.
 *
 * The format comes from `model.sourceEncoding`, which every parser sets (and
 * `openStreamingLayer` sets on its stub), NOT from re-detecting the file
 * name: `detectEncoding` guesses from an extension and answers "cityjson" for
 * anything it does not recognise, so a signed or extensionless URL would wear
 * the wrong badge. A raster tile template and a 3D tileset name no encoding
 * at all, so their lines are one phrase.
 */
export function layerKindLine(item: ActiveLayer): string {
  switch (layerKindOf(item)) {
    case "city":
      return `City model · ${encodingLabel(cityModelOf(item).sourceEncoding)}`;
    case "streaming":
      return `Streaming city model · ${encodingLabel(
        cityModelOf(item).sourceEncoding,
      )}`;
    case "vector":
      return "Vector layer · GeoJSON";
    case "raster":
      return "Raster layer";
    case "tiles":
      return "3D Tiles";
  }
}

/** Narrowing helper for the two city branches above — `layerKindOf` has
 *  already proven the discriminant, but it cannot tell TypeScript so. */
function cityModelOf(item: ActiveLayer): CityModel {
  if (item.kind !== "city") throw new Error("not a city layer");
  return item.layer.model;
}

/**
 * The layer's CRS as one label — "EPSG:7415" — or `null` when the source
 * names no reference system.
 *
 * `extractCrsCode` strips whatever authority the source already carries (an
 * OGC URI from CityJSON, "EPSG:7415" from FlatCityBuf), so the prefix is
 * added exactly once here rather than at each of the three call sites that
 * used to compose it.
 */
export function crsLabel(referenceSystem: string | undefined): string | null {
  const code = extractCrsCode(referenceSystem);
  return code === null ? null : `EPSG:${code}`;
}

/** The layer's EPSG code as a number, or null. The CityParquet writer takes
 *  `crs => 'EPSG:NNNN'` and nothing else, so a layer whose reference system
 *  names no code cannot be written as a package. */
export function epsgOf(referenceSystem: string | undefined): number | null {
  const code = extractCrsCode(referenceSystem);
  if (code === null) return null;
  const n = Number(code);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A source path shortened from the MIDDLE, keeping both ends.
 *
 * A URL's two informative halves are its host and its file name, and both are
 * at the ends — an ellipsis on the right (the CSS default) throws away the
 * file name, which is the half that tells two tiles of the same dataset
 * apart. The head takes the odd character, so the host survives a tie.
 */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${tail === 0 ? "" : text.slice(-tail)}`;
}

/**
 * Root objects grouped by type, commonest first, ties broken by name.
 *
 * Same rule as {@link countRootObjects}: an object with `parents` is a PART
 * of something already counted, so a Delft building with five BuildingParts
 * is one Building here, not six objects. Sorted rather than left in insertion
 * order so the list does not reshuffle when a model is reloaded.
 */
export function countRootObjectsByType(
  model: CityModel,
): ReadonlyArray<{ readonly type: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const object of Object.values(model.objects)) {
    if (object.parents.length > 0) continue;
    counts.set(object.objectType, (counts.get(object.objectType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * The model's extent as one line: the two horizontal corners, in the CRS
 * they are expressed in.
 *
 * X and Y only. The Z range is real but it is a different question ("how tall
 * is this?"), the inspector already answers it per object, and a six-number
 * line does not fit a 300 px panel.
 *
 * The decimal places follow the extent's own SPAN rather than a fixed
 * setting: a projected model spans hundreds of metres, where a tenth of a
 * metre is already more precision than anyone reads, while a WGS84 extent
 * spans hundredths of a degree, where one decimal place would collapse both
 * corners onto the same number.
 */
export function extentLine(
  bbox: BBox3 | null,
  crs: string | null,
): string | null {
  if (bbox === null) return null;
  const [minX, minY, , maxX, maxY] = bbox;
  const span = Math.max(maxX - minX, maxY - minY);
  const digits = span >= 100 ? 1 : 5;
  const n = (v: number) =>
    v.toLocaleString("en-GB", { maximumFractionDigits: digits });
  const corners = `${n(minX)}, ${n(minY)} → ${n(maxX)}, ${n(maxY)}`;
  return crs === null ? corners : `${corners} (${crs})`;
}

/** Grouped digits, one locale (`en-GB`), independent of the host machine's
 *  own locale — same reasoning as `formatCount` in `src/ui/table/tableText.ts`,
 *  reimplemented locally rather than imported: `features/` does not import
 *  from `ui/`. */
const COUNT_FORMAT = new Intl.NumberFormat("en-GB");
function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}
