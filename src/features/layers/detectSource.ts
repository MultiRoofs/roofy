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
 * ENGINE-FREE: {@link detectSourceFromName} is a pure name → descriptor
 * function composing the geospatial classifier ({@link classifyGeoUrl}) with
 * the city format registry ({@link formatFromName}), so the dialog, the landing
 * page and the loader cannot disagree about what a name means.
 * {@link detectSourceFromFile} reads a file's first bytes as well, because a
 * name is a guess and the bytes are evidence.
 *
 * The geospatial shapes are asked first: a `{z}/{x}/{y}` template's tail and a
 * `.geojson`'s `json` would otherwise read as city formats.
 */
import type { CityModelEncoding } from "@cityjson/navara-core";
import {
  SNIFF_BYTES,
  cityFormat,
  detectFormat,
  formatFromName,
  sniffFormat,
} from "../../domain/citymodel/formats";
import { classifyGeoUrl } from "../geoLayers/classifyGeoSource";
import type { GeoLayerKind } from "../geoLayers/geoLayerStore";

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

/** A city format, under the registry's own label. */
function city(encoding: CityModelEncoding): DetectedSource {
  return { kind: "city", encoding, label: cityFormat(encoding).label };
}

const CITYJSON = city("cityjson");
const CITYJSONSEQ = city("cityjsonseq");
/** The label carries the one thing that makes this format feel different in
 *  use: the layer appears before the file has been read, and keeps filling in
 *  as the camera moves. */
const FLATCITYBUF: DetectedSource = {
  kind: "city",
  encoding: "flatcitybuf",
  label: `${cityFormat("flatcitybuf").label} · streams as the camera moves`,
};
const CITYPARQUET = city("cityparquet");
const CITYGML = city("citygml");
/** Same encoding, different label: the loader decides on the ZIP magic bytes,
 *  but a user who dropped an archive should read back the archive. */
const CITYGML_ZIP: DetectedSource = {
  kind: "city",
  encoding: "citygml",
  label: `${cityFormat("citygml").label} (zip)`,
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

/** The path part of a URL, lowercased, with any `.gz` wrapper stripped. */
function extensionPath(nameOrUrl: string): string {
  let path: string;
  try {
    path = new URL(nameOrUrl).pathname.toLowerCase();
  } catch {
    path = nameOrUrl.toLowerCase().split("#")[0]!.split("?")[0]!;
  }
  return path.endsWith(".gz") ? path.slice(0, -3) : path;
}

/** The descriptor for a city format, telling a ZIP apart by name: same
 *  encoding, but a user who chose an archive should read back the archive. */
function cityDescriptor(
  encoding: CityModelEncoding,
  zipped: boolean,
): DetectedSource {
  switch (encoding) {
    case "cityjson":
      return CITYJSON;
    case "cityjsonseq":
      return CITYJSONSEQ;
    case "flatcitybuf":
      return FLATCITYBUF;
    case "cityparquet":
      return CITYPARQUET;
    case "citygml":
      return zipped ? CITYGML_ZIP : CITYGML;
  }
}

/**
 * Classify a file name or URL.
 *
 * The order is the contract:
 *  1. the two geospatial SHAPES (a `{z}/{x}/{y}` template, a `tileset.json`
 *     path), because a template's tail lies about the rest;
 *  2. `.geojson`, which would otherwise end in a city format's `json`;
 *  3. whatever the city format registry recognises ({@link formatFromName}:
 *     a CityParquet package or pattern, then the extensions);
 *  4. anything else: unknown, said out loud.
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

  // 3.
  const encoding = formatFromName(trimmed);
  if (encoding !== null) return cityDescriptor(encoding, path.endsWith(".zip"));

  // 4.
  return UNKNOWN;
}

/**
 * Classify a picked file by its name AND its first bytes.
 *
 * The bytes win where they are definite (a magic number, a second line that
 * opens another object — see `detectFormat`), so a FlatCityBuf saved as
 * `download.json` or a CityJSONSeq saved as `.city.json` is shown as what it
 * is before the user has to find out from a failed load. A GeoJSON, and a name
 * whose bytes say nothing, keep the name's answer.
 */
export async function detectSourceFromFile(
  file: Blob & { readonly name: string },
): Promise<DetectedSource> {
  const named = detectSourceFromName(file.name);
  if (named.kind === "geo") return named;
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return named;
  }
  // An unknown name takes only what the bytes really show; CityJSON as the
  // last resort is the loader's fallback, not something to tell the user.
  const encoding =
    named.kind === "unknown"
      ? sniffFormat(head)
      : detectFormat({ name: file.name, head });
  if (encoding === null) return named;
  if (named.kind === "city" && named.encoding === encoding) return named;
  return cityDescriptor(encoding, extensionPath(file.name).endsWith(".zip"));
}
