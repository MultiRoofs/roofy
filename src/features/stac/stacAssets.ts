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
 * TWO EXCEPTIONS:
 *  - In the safe direction: a collection's stac-geoparquet items MIRROR is a
 *    `.parquet` file and is never a city model, so it is excluded from
 *    `loadable` BY DEFAULT — see {@link MIRROR_FILENAME}.
 *  - `.zip` is loadable WITHOUT `detectEncoding` agreeing, because the loader
 *    decides that one on the response's MAGIC BYTES rather than on the
 *    extension — see {@link ZIP_EXTENSION}. The invariant is unchanged; only
 *    the authority it defers to differs.
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
 * How a collection's stac-geoparquet items mirror is recognised.
 *
 * The mirror is the collection's item INDEX — one row per item, carrying hrefs
 * and bboxes — not a city model, so handing it to the CityParquet reader would
 * produce a table with no city geometry in it. It became a candidate for the
 * Add button the moment `.parquet` joined {@link MODEL_EXTENSIONS}, so it is
 * excluded here.
 *
 * THE DEFAULT RULE IS THE FILE NAME, deliberately, because it is the only
 * signal every call site already has. This catalog writes every mirror as
 * `…/<collection>/items.parquet` (see `stacNormalize`'s `itemsParquetHrefFrom`
 * and the fixtures in its tests); the asset KEY (`items-geoparquet`) and ROLE
 * (`collection-mirror`) are richer signals but reach this function only when a
 * caller passes them, and a guard that has to be remembered is not a guard. The
 * cost of the file-name rule is a genuine city model that happens to be called
 * `items.parquet` becoming a download link instead of an Add button — a
 * false negative, which is the safe direction for this decision.
 */
const MIRROR_FILENAME = "items.parquet";
const MIRROR_ASSET_KEY = "items-geoparquet";
const MIRROR_ASSET_ROLE = "collection-mirror";

/** What the catalog said about an asset besides its href and media type. */
export interface StacAssetContext {
  /** The asset's key in the `assets` object, when the caller knows it. */
  readonly key?: string | null;
  readonly roles?: readonly string[] | null;
}

/** True for the collection's own items mirror, by name or by declaration. */
function isItemsMirror(
  path: string,
  context: StacAssetContext | undefined,
): boolean {
  if (path.split("/").at(-1) === MIRROR_FILENAME) return true;
  if (context === undefined) return false;
  return (
    context.key === MIRROR_ASSET_KEY ||
    (context.roles ?? []).includes(MIRROR_ASSET_ROLE)
  );
}

/**
 * Container formats. `.zip` IS loadable — see {@link ZIP_EXTENSION} — while
 * `.7z` and `.tar` remain recognisable-but-not-openable download links.
 */
const ARCHIVE_EXTENSIONS = [".zip", ".7z", ".tar"] as const;

/**
 * The one container this app can open, and the one exception to the
 * extension-routing rule in this file's header.
 *
 * `detectEncoding(".zip")` still returns its `"cityjson"` default and is
 * deliberately not taught otherwise — the loader never asks it. `loadFromUrl`
 * sniffs ZIP MAGIC BYTES on the fetched body before it consults the encoding
 * at all, and unzips the CityGML inside (`cityGmlArchive.ts`). So the
 * invariant still holds, just through a different authority: what the loader
 * ACTUALLY does with a `.zip` href is unzip-and-parse-CityGML, and that is
 * what `loadable: true` promises here.
 *
 * The archive is offered even though many catalog hosts will refuse the
 * cross-origin read: a blocked fetch produces the loader's own CORS sentence
 * in the browser's error strip, which tells the user something true and
 * actionable, whereas a download-only link told them nothing at all.
 */
const ZIP_EXTENSION = ".zip";

/** Honest about the container AND about what comes out of it. */
const ZIP_LABEL = "CityGML archive (ZIP)";

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

/** The kind a media type names, or null when it names none this app knows. */
function kindFromMediaType(mediaType: string | null): StacAssetKind | null {
  if (mediaType === null) return null;
  return MEDIA_TYPE_KINDS[normalizeMediaType(mediaType)] ?? null;
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
  if (path.endsWith(ZIP_EXTENSION)) {
    return { kind: "archive", loadable: true, label: ZIP_LABEL };
  }
  if (ARCHIVE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    return info("archive", false);
  }

  // The items mirror is labelled honestly — by its media type first, since a
  // mirror behind an extensionless endpoint would otherwise read as the
  // `detectEncoding` default, "CityJSON" — but never offered as a layer.
  if (isItemsMirror(path, context)) {
    return info(kindFromMediaType(mediaType) ?? detectEncoding(path), false);
  }

  if (MODEL_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    // Single source of truth: whatever the loader would parse it as.
    return info(detectEncoding(path), true);
  }

  return info(kindFromMediaType(mediaType) ?? "unknown", false);
}
