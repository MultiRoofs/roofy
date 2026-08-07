/**
 * What a user-typed URL MEANS for the CityParquet loader.
 *
 * ENGINE-FREE and I/O-FREE: a pure string → descriptor function, so the loader,
 * the Add-Layer dialog's enable/disable logic and the tests all agree on one
 * definition of "this is a CityParquet source" without a network round trip.
 *
 * WHY TWO ENTRY POINTS. `classifyCityParquetUrl` THROWS for the one shape that
 * is recognisably CityParquet but impossible to serve — an `https://` wildcard
 * on a host that exposes no listing API — because the user deserves a sentence
 * explaining why, not a silent "unsupported format". But a predicate that
 * throws is unusable at a call site that only asks "which arm of the loader
 * takes this?", so `isCityParquetUrl` is the TOTAL wrapper: it answers TRUE for
 * that same unlistable URL, routing it INTO the CityParquet arm where the
 * classifier's message is what the user finally sees.
 *
 * WHY `?` IS SPECIAL-CASED. It is a glob wildcard in an object name and a
 * query-string introducer in a URL, and signed GCS/S3 links are made of query
 * strings. So http(s) inputs are classified on `new URL(raw).pathname` (the
 * query cannot reach the wildcard test, and survives untouched on the `table`
 * form, where the signature is exactly what makes the fetch work), while
 * `gs://`/`s3://` inputs are classified on the raw remainder, where there is no
 * query-string layer and `?` really is a wildcard.
 */

/** An object-storage bucket, addressed by provider. */
export interface StorageRef {
  readonly provider: "gcs" | "s3";
  readonly bucket: string;
}

/** A CityParquet source, resolved from a URL but not yet fetched. */
export type CityParquetSource =
  /** One `.parquet` table, fetched directly over https. */
  | { readonly kind: "table"; readonly url: string }
  /** An https package directory (`baseUrl` always ends with "/"). */
  | { readonly kind: "package-dir"; readonly baseUrl: string }
  /** An object-name pattern to expand by listing the bucket. */
  | {
      readonly kind: "storage-glob";
      readonly store: StorageRef;
      readonly pattern: string;
    }
  /** One `.parquet` object in a bucket. */
  | {
      readonly kind: "storage-table";
      readonly store: StorageRef;
      readonly objectName: string;
    }
  /** A bucket prefix to list (ends with "/", or is empty for the root). */
  | {
      readonly kind: "storage-dir";
      readonly store: StorageRef;
      readonly prefix: string;
    };

/**
 * A URL that names a wildcard but lives on a host with no listing API.
 *
 * Thrown, not returned as `null`: the shape IS a CityParquet request, and
 * telling the user how to spell it (`gs://`, `s3://`, or the package's
 * `metadata.json`) is far more useful than "unrecognised format".
 */
export class UnlistableUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnlistableUrlError";
  }
}

/** The GCS host whose https spelling maps 1:1 onto a `gs://` URL. */
const GCS_HTTPS_HOST = "storage.googleapis.com";

/** The package manifest filename, at the root of a CityParquet directory. */
const MANIFEST_FILENAME = "metadata.json";

/** True if `text` contains a glob wildcard. */
function hasWildcard(text: string): boolean {
  return text.includes("*") || text.includes("?");
}

/**
 * True if `rest` names the package manifest ITSELF.
 *
 * The boundary is a "/" or the start of the name — `pkgmetadata.json` is an
 * object called "pkgmetadata.json", not a manifest inside "pkg". One predicate
 * shared by the strip below and by the https-GCS crossover gate, so a bare
 * `endsWith` cannot creep back into one of them.
 */
function isManifestPath(rest: string): boolean {
  return rest === MANIFEST_FILENAME || rest.endsWith(`/${MANIFEST_FILENAME}`);
}

/**
 * Percent-decode a path, segment by segment.
 *
 * Per segment so an encoded "%2F" cannot silently become a separator, and
 * failure-tolerant because a hand-typed URL may carry a lone "%" that
 * `decodeURIComponent` refuses — in which case the literal text is the best
 * available guess at the object name.
 */
function decodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/**
 * Classify the part of a bucket URL after the bucket name.
 *
 * Shared by `gs://`, `s3://` and the https GCS spelling, so the three cannot
 * drift apart.
 */
function classifyStorageRest(
  store: StorageRef,
  rest: string,
): CityParquetSource {
  if (hasWildcard(rest)) {
    return { kind: "storage-glob", store, pattern: rest };
  }
  if (rest.endsWith(".parquet")) {
    return { kind: "storage-table", store, objectName: rest };
  }
  // A directory: the manifest names the package, but listing takes its parent.
  // Any OTHER non-parquet name is read as a directory the user forgot to
  // "/"-terminate — including something like "pkgmetadata.json", which is
  // listed as a prefix of its own rather than mistaken for a manifest. Listing
  // a prefix that turns out to be empty is a clear, recoverable outcome;
  // silently loading a different directory than the one typed is not.
  const withoutManifest = isManifestPath(rest)
    ? rest.slice(0, rest.length - MANIFEST_FILENAME.length)
    : rest;
  const prefix =
    withoutManifest === "" || withoutManifest.endsWith("/")
      ? withoutManifest
      : `${withoutManifest}/`;
  return { kind: "storage-dir", store, prefix };
}

/** Split "bucket/rest" into its two halves ("" rest when there is none). */
function splitBucket(
  remainder: string,
): { bucket: string; rest: string } | null {
  const slash = remainder.indexOf("/");
  const bucket = slash === -1 ? remainder : remainder.slice(0, slash);
  if (bucket === "") return null;
  return { bucket, rest: slash === -1 ? "" : remainder.slice(slash + 1) };
}

/**
 * Classify a URL as a CityParquet source, or `null` if it is not one.
 *
 * @throws {UnlistableUrlError} for an https wildcard outside {@link GCS_HTTPS_HOST}.
 */
export function classifyCityParquetUrl(raw: string): CityParquetSource | null {
  const trimmed = raw.trim();

  for (const [scheme, provider] of [
    ["gs://", "gcs"],
    ["s3://", "s3"],
  ] as const) {
    if (trimmed.startsWith(scheme)) {
      const split = splitBucket(trimmed.slice(scheme.length));
      if (!split) return null;
      return classifyStorageRest(
        { provider, bucket: split.bucket },
        split.rest,
      );
    }
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null; // relative path, or nonsense
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Wildcards live in the PATH; a query string is not part of the pattern.
  const pathname = url.pathname;

  if (url.host === GCS_HTTPS_HOST) {
    const split = splitBucket(pathname.replace(/^\//, ""));
    // Only the shapes that are unambiguously CityParquet cross over to the
    // gs:// rules — a bare object URL of some other format must stay null.
    if (
      split &&
      (hasWildcard(split.rest) ||
        split.rest.endsWith(".parquet") ||
        split.rest.endsWith("/") ||
        isManifestPath(split.rest))
    ) {
      return classifyStorageRest(
        { provider: "gcs", bucket: split.bucket },
        decodePathSegments(split.rest),
      );
    }
  }

  if (hasWildcard(pathname)) {
    throw new UnlistableUrlError(
      "Plain https URLs cannot be listed — use gs:// or s3://, or point at the package's metadata.json.",
    );
  }
  if (pathname.endsWith(".parquet")) {
    return { kind: "table", url: trimmed };
  }
  if (pathname.endsWith(`/${MANIFEST_FILENAME}`) || pathname.endsWith("/")) {
    // `new URL(".", …)` resolves to the containing directory and drops the
    // query/hash, which is exactly the package base a manifest sits in.
    return { kind: "package-dir", baseUrl: new URL(".", url).href };
  }
  return null;
}

/**
 * Total predicate: does the CityParquet arm of the loader own this URL?
 *
 * TRUE for an unlistable https wildcard on purpose — see the module doc.
 */
export function isCityParquetUrl(raw: string): boolean {
  try {
    return classifyCityParquetUrl(raw) !== null;
  } catch (error) {
    return error instanceof UnlistableUrlError;
  }
}
