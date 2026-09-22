/**
 * Static or streamed: how a CityParquet source is loaded, decided by its size.
 *
 * A small package is read whole into one resident `CityModel` (the static
 * path: the table panel, processing and every analysis see all of it). A large
 * one cannot be — 335 MB of Yokohama read whole exhausts the tab — so above
 * {@link CITYPARQUET_STREAM_THRESHOLD_BYTES} it streams by viewport through the
 * FlatCityBuf machinery's CityParquet worker instead.
 *
 * THE SIZE IS THE OBJECT TABLES'. Sidecars never stream (textures are not
 * streamed), so they neither count nor ride in the stream source. Each table's
 * size comes from the cheapest source that knows it: the source's own
 * declaration (a manifest's `file:size`, a bucket listing's size), then a
 * `HEAD`, then a ranged open of the table itself, which learns its byte length
 * from the range probe — so an unknown size never silently routes a huge table
 * into the static path. When NO size can be learned (no HEAD, no ranges) the source
 * stays static, as before: a server that answers neither could not serve the
 * stream's range reads either.
 *
 * A SOURCE THAT CANNOT BE RESOLVED STAYS STATIC. An unlistable wildcard, a
 * manifest that 404s, a selection with no tables, an expansion over the file
 * cap: the decision swallows the error and the static load, which resolves
 * the same targets, throws the same sentence the user has always seen.
 *
 * THE COST: every STATIC package or bucket source (package directory, bucket
 * prefix, bucket glob) resolves its targets twice — once here, once in the
 * static load — so it pays one extra manifest or listing request. A lone
 * table resolves without I/O and pays nothing.
 *
 * Every size is read through an injected seam (`http`, `headLength`,
 * `footerSize`); the browser implementations are in `sourceSizes.ts`.
 */
import type { StreamSource } from "@cityjson/navara-flatcitybuf";
import type { HttpClient } from "../../platform/types";
import {
  cityParquetFileTargets,
  cityParquetTargets,
  type CityParquetFileTargets,
  type CityParquetTargets,
} from "./loadCityParquet";
import { classifyCityParquetUrl } from "./sourceClassify";
import { familyKeyFromName } from "../layers/familyStore";

/** Above this many bytes of object tables a CityParquet source streams. */
export const CITYPARQUET_STREAM_THRESHOLD_BYTES = 128 * 1024 * 1024;

/**
 * One OBJECT FAMILY of a streamed package (ruling R-A′).
 *
 * A family has two identities and they are not interchangeable. Its SOURCE
 * identity is the resolved URL or the picked `File` — unique, and what DuckDB
 * registers and the stream worker reads. Its family KEY is the manifest's asset
 * key when there is one, else the extension-stripped basename; it is a label and
 * the Building default's test, and two tables can legitimately produce the same
 * one.
 */
export interface CityParquetStreamFamily {
  readonly key: string;
  /** The manifest href (or the object/path name) — what tells two families with
   *  the same key apart, on screen and in a message. */
  readonly href: string;
  readonly size: number | null;
  readonly source: { readonly url: string } | { readonly file: File };
}

export type CityParquetMode =
  | { readonly mode: "static" }
  | {
      readonly mode: "stream";
      /** EVERY object table, which is what this source resolves to. The layer
       *  opens only the ENABLED families (`familyStore`'s R-D default), so a
       *  fresh open's stream is usually a subset of this. */
      readonly source: StreamSource;
      /** The object tables' summed size, as learned (a lower bound when
       *  some table's size could not be). */
      readonly totalBytes: number;
      /** One family per object table, in the source's own order. */
      readonly families: ReadonlyArray<CityParquetStreamFamily>;
    };

/** A byte length, or `null` when it could not be learned. */
export type SizeProbe = (url: string) => Promise<number | null>;

export type CityParquetModeInput =
  | {
      readonly kind: "url";
      readonly url: string;
      readonly http: HttpClient;
      /** The `Content-Length` of a `HEAD`, or `null`. */
      readonly headLength: SizeProbe;
      /** The table's byte length, learned by opening its Parquet footer
       *  through a ranged read, or `null` — tried only when `headLength` has
       *  no answer. */
      readonly footerSize?: SizeProbe;
    }
  | { readonly kind: "files"; readonly files: ReadonlyArray<File> };

const STATIC: CityParquetMode = { mode: "static" };

/** A probe's answer, with a rejection or a non-size read as "unknown". */
async function probe(
  fn: SizeProbe | undefined,
  url: string,
): Promise<number | null> {
  if (fn === undefined) return null;
  try {
    const n = await fn(url);
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** Run `resolve`, reading any throw as "cannot resolve" (`null`). */
async function orNull<T>(resolve: () => Promise<T>): Promise<T | null> {
  try {
    return await resolve();
  } catch {
    return null;
  }
}

function over(total: number): boolean {
  return total > CITYPARQUET_STREAM_THRESHOLD_BYTES;
}

async function decideUrl(
  input: Extract<CityParquetModeInput, { kind: "url" }>,
): Promise<CityParquetMode> {
  // A classifier throw (an unlistable https wildcard) or `null` (a bare
  // relative `.parquet` path the loader fetches as-is) is the static loader's
  // to explain or handle.
  const source = await orNull(async () => classifyCityParquetUrl(input.url));
  if (source === null) return STATIC;
  const targets: CityParquetTargets | null = await orNull(() =>
    cityParquetTargets(source, input.http),
  );
  if (targets === null) return STATIC;

  const sizes = await Promise.all(
    targets.tables.map(
      async (t) =>
        t.size ??
        (await probe(input.headLength, t.url)) ??
        (await probe(input.footerSize, t.url)),
    ),
  );
  const known = sizes.filter((n): n is number => n !== null);
  if (known.length === 0) return STATIC;
  const totalBytes = known.reduce((a, b) => a + b, 0);
  if (!over(totalBytes)) return STATIC;
  const urls = targets.tables.map((t) => t.url);
  return {
    mode: "stream",
    source: urls.length === 1 ? { url: urls[0]! } : { urls },
    totalBytes,
    families: targets.tables.map((t, index) => ({
      // The manifest's asset key when it named one, else the file name.
      key: t.family ?? familyKeyFromName(t.name),
      href: t.name,
      // The size this decision already learned — a HEAD or a footer probe, not
      // only the declaration — so the panel can state a family's weight without
      // asking again.
      size: sizes[index] ?? null,
      source: { url: t.url },
    })),
  };
}

async function decideFiles(
  files: ReadonlyArray<File>,
): Promise<CityParquetMode> {
  const targets: CityParquetFileTargets | null = await orNull(() =>
    cityParquetFileTargets(files),
  );
  if (targets === null) return STATIC;
  const blobs = targets.tables.map((t) => t.file);
  const totalBytes = blobs.reduce((a, f) => a + f.size, 0);
  if (!over(totalBytes)) return STATIC;
  return {
    mode: "stream",
    // A `File` IS a `Blob`: passed through, never read into memory.
    source: blobs.length === 1 ? { blob: blobs[0]! } : { blobs },
    totalBytes,
    families: targets.tables.map((t) => ({
      key: t.family ?? familyKeyFromName(t.name),
      href: t.name,
      size: t.file.size,
      // The `File` HANDLE, not its bytes: DuckDB reads it through
      // `registerFileHandle` and the worker through ranged `Blob` reads.
      source: { file: t.file },
    })),
  };
}

/** Decide how a CityParquet source loads — see the module doc. Never
 *  rejects: anything it cannot decide is `static`. */
export async function decideCityParquetMode(
  input: CityParquetModeInput,
): Promise<CityParquetMode> {
  return input.kind === "url" ? decideUrl(input) : decideFiles(input.files);
}
