/**
 * What a STAC asset is, and whether this app can open it.
 *
 * THE INVARIANT: `loadable` must agree with what `addLayerFromUrl` will
 * ACTUALLY do with the href. That routing is by extension alone — the loader
 * calls `detectEncoding(url)`, which sends `.fcb` to the streaming plugin and
 * DEFAULTS every unrecognised extension to `"cityjson"`, i.e. to `JSON.parse`.
 * So an asset is loadable only when its extension is one the loader
 * recognises, and the decision is made by calling `detectEncoding` itself
 * rather than by a parallel table here — a second table would be free to drift
 * out of agreement with the router, and the failure mode of that drift is an
 * Add button that hands a GML document to the JSON parser.
 *
 * ONE EXCEPTION, in the safe direction: a collection's stac-geoparquet items
 * MIRROR has a `.parquet` href and is never a city model, so it is excluded by
 * asset key/role — see {@link MIRROR_ASSET_KEY}.
 *
 * A media type is therefore used for the LABEL only. `application/gml+xml`
 * behind a `?download=` endpoint, or on an `.xml` file, names the format
 * honestly and still cannot be loaded, so the UI shows it as a download link.
 */

import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import type { StacAssetInfo, StacAssetKind } from "./stacTypes";

const LABELS: Record<StacAssetKind, string> = {
  cityjson: "CityJSON",
  cityjsonseq: "CityJSONSeq",
  flatcitybuf: "FlatCityBuf",
  citygml: "CityGML",
  cityparquet: "CityParquet",
  archive: "ZIP archive",
  unknown: "Unknown format",
};

/**
 * Extensions the loader routes. `.json` and `.jsonl` are included because
 * `detectEncoding` handles them; anything not listed falls through to its
 * `"cityjson"` default, which is exactly the case that must NOT be loadable.
 */
const MODEL_EXTENSIONS = [
  ".fcb",
  ".city.jsonl",
  ".jsonl",
  ".city.json",
  ".json",
  ".citygml",
  ".gml",
  ".parquet",
] as const;

/**
 * The asset key, and the role, of a collection's stac-geoparquet items mirror.
 *
 * The mirror is a `.parquet` file and would otherwise become loadable the
 * moment `.parquet` joined {@link MODEL_EXTENSIONS} — but it is the collection's
 * item INDEX (one row per item, with hrefs and bboxes), not a city model, so
 * offering an Add button for it would hand the CityParquet reader a table with
 * no city geometry in it. Both signals are checked for the same reason
 * `stacNormalize` matches on either: the key is `items-geoparquet` in most
 * collections of this catalog, but not in all of them.
 */
const MIRROR_ASSET_KEY = "items-geoparquet";
const MIRROR_ASSET_ROLE = "collection-mirror";

/** What the catalog said about an asset besides its href and media type. */
export interface StacAssetContext {
  /** The asset's key in the `assets` object, when the caller knows it. */
  readonly key?: string | null;
  readonly roles?: readonly string[] | null;
}

/** True for the collection's own items mirror, in either spelling. */
function isItemsMirror(context: StacAssetContext | undefined): boolean {
  if (context === undefined) return false;
  return (
    context.key === MIRROR_ASSET_KEY ||
    (context.roles ?? []).includes(MIRROR_ASSET_ROLE)
  );
}

/** Container formats: recognisable, never directly loadable. */
const ARCHIVE_EXTENSIONS = [".zip", ".7z", ".tar"] as const;

const MEDIA_TYPE_KINDS: Record<string, StacAssetKind> = {
  "application/city+json": "cityjson",
  "application/cityjson": "cityjson",
  "application/json+cityjson": "cityjson",
  "application/x-cityjson-seq": "cityjsonseq",
  "application/x-flatcitybuf": "flatcitybuf",
  "application/gml+xml": "citygml",
  "application/citygml+xml": "citygml",
  "application/vnd.citygml+xml": "citygml",
  "application/vnd.apache.parquet": "cityparquet",
  "application/zip": "archive",
};

function info(kind: StacAssetKind, loadable: boolean): StacAssetInfo {
  return { kind, loadable, label: LABELS[kind] };
}

/**
 * The path of an href, lowercased, with query/fragment gone and one trailing
 * `.gz` stripped — the same normalisation `detectEncoding` applies, repeated
 * here only so the "is this an extension we route?" gate sees the same string.
 */
function extensionPath(href: string): string {
  let path: string;
  try {
    // The base makes a relative href resolvable; only the path is used.
    path = new URL(href, "https://x/").pathname.toLowerCase();
  } catch {
    path = href.toLowerCase();
  }
  return path.endsWith(".gz") ? path.slice(0, -3) : path;
}

/** Media type without its parameters (`; charset=…`), lowercased. */
function normalizeMediaType(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Classify a STAC asset for display and for the Add button. */
export function classifyStacAsset(
  href: string | null,
  mediaType: string | null,
  context?: StacAssetContext,
): StacAssetInfo {
  if (href === null) return info("unknown", false);

  const path = extensionPath(href);

  // Archives first: a `.zip` of CityJSON still advertises a CityJSON media
  // type in this catalog, and it is the container that decides.
  if (ARCHIVE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    return info("archive", false);
  }

  // The items mirror is labelled honestly (it IS a CityParquet-media-type
  // file) but never offered as a layer.
  if (isItemsMirror(context)) {
    return info(detectEncoding(path), false);
  }

  if (MODEL_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    // Single source of truth: whatever the loader would parse it as.
    return info(detectEncoding(path), true);
  }

  if (mediaType === null) return info("unknown", false);
  return info(
    MEDIA_TYPE_KINDS[normalizeMediaType(mediaType)] ?? "unknown",
    false,
  );
}
