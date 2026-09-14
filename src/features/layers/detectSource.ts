/**
 * What a dropped file or a pasted URL IS — one answer, shown to the user and
 * handed to the loader unchanged.
 *
 * The Add Layer dialog used to make the user choose the FAMILY first ("City
 * model" or "Geospatial" tabs) and then guessed the format inside it. That is
 * the wrong question: nobody thinks "I have a geospatial source", they think
 * "I have this file". So the dialog asks WHERE the source is (a file, a URL, the
 * catalog) and this module answers WHAT it is — visibly, in one line the user
 * can correct with a select before anything is loaded.
 *
 * ENGINE-FREE and I/O-FREE by construction: a pure name → descriptor function
 * composing the three classifiers the app already has ({@link classifyGeoUrl},
 * {@link isCityParquetUrl}, {@link detectEncoding}), so the dialog, the landing
 * page and the loader cannot disagree about what a name means.
 *
 * The ORDER the three are consulted in is the only real decision here, and it
 * runs geospatial-first: `detectEncoding` answers "cityjson" for everything it
 * does not recognise, so anything asked after it can never be reached.
 */
import type { CityModelEncoding } from "@cityjson/navara-core";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import { classifyGeoUrl } from "../geoLayers/classifyGeoSource";
import type { GeoLayerKind } from "../geoLayers/geoLayerStore";
import { isCityParquetUrl } from "../cityparquet/sourceClassify";

/**
 * A format, named the way the user will see it.
 *
 * `unknown` is a real outcome, not a failure: a bare API endpoint
 * (`/features?bbox=…`) genuinely could be anything, and saying so — with the
 * correction select right beside it — is more honest than loading it as
 * CityJSON and reporting "Invalid JSON" a second later.
 */
export type DetectedSource =
  | {
      readonly kind: "city";
      readonly encoding: CityModelEncoding;
      readonly label: string;
    }
  | {
      readonly kind: "geo";
      readonly geoKind: GeoLayerKind;
      readonly label: string;
    }
  | { readonly kind: "unknown"; readonly label: "Unknown format" };

const CITYJSON: DetectedSource = {
  kind: "city",
  encoding: "cityjson",
  label: "CityJSON",
};
const CITYJSONSEQ: DetectedSource = {
  kind: "city",
  encoding: "cityjsonseq",
  label: "CityJSONSeq",
};
/** The label carries the one thing that makes this format feel different in
 *  use: the layer appears before the file has been read, and keeps filling in
 *  as the camera moves. */
const FLATCITYBUF: DetectedSource = {
  kind: "city",
  encoding: "flatcitybuf",
  label: "FlatCityBuf · streams as the camera moves",
};
const CITYPARQUET: DetectedSource = {
  kind: "city",
  encoding: "cityparquet",
  label: "CityParquet",
};
const CITYGML: DetectedSource = {
  kind: "city",
  encoding: "citygml",
  label: "CityGML",
};
/** Same encoding, different label: the loader decides on the ZIP magic bytes,
 *  but a user who dropped an archive should read back the archive. */
const CITYGML_ZIP: DetectedSource = {
  kind: "city",
  encoding: "citygml",
  label: "CityGML (zip)",
};
const GEOJSON: DetectedSource = {
  kind: "geo",
  geoKind: "geojson",
  label: "GeoJSON",
};
const RASTER_XYZ: DetectedSource = {
  kind: "geo",
  geoKind: "raster-xyz",
  label: "XYZ raster tiles",
};
const TILES_3D: DetectedSource = {
  kind: "geo",
  geoKind: "3d-tiles",
  label: "3D Tiles",
};
/** The "I cannot tell" answer, exported because a caller sometimes has to
 *  DEMOTE a detection to it: the Add Layer dialog's File tab does, for the two
 *  geospatial kinds that only a URL can be. */
export const UNKNOWN_SOURCE: DetectedSource = {
  kind: "unknown",
  label: "Unknown format",
};
const UNKNOWN = UNKNOWN_SOURCE;

/**
 * The correction select's options.
 *
 * City formats first (this viewer's subject), then the three the engine draws
 * natively. `unknown` is absent on purpose: it is something detection can
 * CONCLUDE, never something a user would choose, and `CITYGML_ZIP` is absent
 * because it is the same format as `CITYGML` under another name.
 */
export const SOURCE_OVERRIDES: ReadonlyArray<DetectedSource> = [
  CITYJSON,
  CITYJSONSEQ,
  FLATCITYBUF,
  CITYPARQUET,
  CITYGML,
  GEOJSON,
  RASTER_XYZ,
  TILES_3D,
];

/**
 * A stable identity for a detected format — the `<option value>` of the
 * correction select, and how a detection is matched to the option that means
 * the same thing.
 *
 * By FORMAT, never by label: "CityGML (zip)" and "CityGML" are one option, and
 * a label is display copy that may be reworded without changing what loads.
 */
export function sourceKey(source: DetectedSource): string {
  switch (source.kind) {
    case "city":
      return `city:${source.encoding}`;
    case "geo":
      return `geo:${source.geoKind}`;
    case "unknown":
      return "unknown";
  }
}

/** The option a key names, or `null` — the select's inverse of
 *  {@link sourceKey}. */
export function sourceFromKey(key: string): DetectedSource | null {
  return SOURCE_OVERRIDES.find((s) => sourceKey(s) === key) ?? null;
}

/** The path part of a URL, lowercased, with any `.gz` wrapper stripped — the
 *  same normalisation {@link detectEncoding} does, reproduced here because the
 *  extensions asked about below are not the ones it knows. */
function extensionPath(nameOrUrl: string): string {
  let path: string;
  try {
    path = new URL(nameOrUrl).pathname.toLowerCase();
  } catch {
    path = nameOrUrl.toLowerCase().split("#")[0]!.split("?")[0]!;
  }
  return path.endsWith(".gz") ? path.slice(0, -3) : path;
}

/**
 * Classify a file name or URL.
 *
 * The order is the contract:
 *  1. the two geospatial SHAPES (a `{z}/{x}/{y}` template, a `tileset.json`
 *     path), because a template's tail lies about the rest;
 *  2. `.geojson`, which `detectEncoding` would swallow as CityJSON;
 *  3. CityParquet, which is as often a bucket pattern or a package directory
 *     with no extension at all as it is a `.parquet` file;
 *  4. `.zip`, the container CityGML ships in;
 *  5. the extensions `detectEncoding` really knows (`.fcb`, `.jsonl`, `.gml`);
 *  6. `.json` / `.city.json` — CityJSON, this viewer's own format;
 *  7. anything else: unknown, said out loud.
 */
export function detectSourceFromName(nameOrUrl: string): DetectedSource {
  const trimmed = nameOrUrl.trim();
  if (trimmed === "") return UNKNOWN;

  // 1. Shapes. `classifyGeoUrl`'s third answer ("geojson") is its DEFAULT for
  //    anything unrecognised, so only the two positive shapes are taken here.
  const geo = classifyGeoUrl(trimmed);
  if (geo === "raster-xyz") return RASTER_XYZ;
  if (geo === "3d-tiles") return TILES_3D;

  const path = extensionPath(trimmed);

  // 2. The one geospatial EXTENSION.
  if (path.endsWith(".geojson")) return GEOJSON;

  // 3. `isCityParquetUrl` is total (it answers true for an unlistable https
  //    wildcard as well, whose explanation the loader then raises), and it is
  //    the only classifier that recognises a source with no extension.
  if (isCityParquetUrl(trimmed)) return CITYPARQUET;

  // 4. A ZIP is a container, and CityGML is the only thing this app unpacks
  //    from one.
  if (path.endsWith(".zip")) return CITYGML_ZIP;

  // 5. What `detectEncoding` positively recognises. Its `cityjson` fallback is
  //    NOT consulted — that is step 6's job, and taking it here would make
  //    every unknown name "CityJSON".
  const encoding = detectEncoding(trimmed);
  if (encoding === "cityjsonseq") return CITYJSONSEQ;
  if (encoding === "flatcitybuf") return FLATCITYBUF;
  if (encoding === "citygml") return CITYGML;
  if (encoding === "cityparquet") return CITYPARQUET;

  // 6. CityJSON, spelled either way.
  if (path.endsWith(".city.json") || path.endsWith(".json")) return CITYJSON;

  // 7.
  return UNKNOWN;
}
