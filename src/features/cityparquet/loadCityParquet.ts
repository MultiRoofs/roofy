/**
 * Turning a CityParquet URL (or a picked folder) into a `CityModel`.
 *
 * This is the I/O half of the CityParquet path: `sourceClassify` decides what a
 * URL MEANS, `objectStorage` knows how to list and address a bucket, and
 * `@cityjson/navara-cityparquet` knows what the bytes ARE. Nothing here parses
 * parquet or interprets a manifest beyond "which files do I fetch"; the model
 * itself is always `assembleCityParquetModel`'s.
 *
 * ONE FAILED FILE FAILS THE LAYER (spec D6). A package is one model in one
 * frame — half of a city drawn with no indication that the other half is
 * missing is worse than an error naming the file that could not be read, and
 * unlike a streaming layer there is no later commit to repair it.
 *
 * EXPANSION IS CAPPED, fetching is not throttled beyond a small pool. A glob
 * over a tiled dataset can name thousands of objects; {@link MAX_CITYPARQUET_FILES}
 * is refused up front with the count, rather than a slice of it being loaded
 * silently.
 */

import {
  CITYPARQUET_SIDECAR_NAMES,
  assembleCityParquetModel,
  parseCityParquetManifest,
} from "@cityjson/navara-cityparquet";
import type { CityModel } from "@cityjson/navara-core";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import { browserPlatform } from "../../platform/browser";
import type { HttpClient } from "../../platform/types";
import {
  MAX_CITYPARQUET_FILES,
  globLiteralPrefix,
  globToRegExp,
  listStorageObjects,
  storageObjectUrl,
} from "./objectStorage";
import {
  type CityParquetSource,
  type StorageRef,
  classifyCityParquetUrl,
} from "./sourceClassify";

/** The package manifest filename, at the root of a CityParquet directory. */
const MANIFEST_FILENAME = "metadata.json";

/**
 * How many object tables are fetched at once.
 *
 * The same figure the STAC catalog crawl uses: enough to hide per-request
 * latency on a tiled package, few enough that a browser's connection pool is
 * not the thing being tested.
 */
const FETCH_CONCURRENCY = 6;

/** One fetched file, in the shape `assembleCityParquetModel` takes. */
interface FetchedTable {
  name: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** The last path segment of a URL or object name, for error messages. */
function baseName(pathOrUrl: string): string {
  const path = pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl;
  const segments = path.split("/").filter((s) => s !== "");
  return segments.at(-1) ?? path;
}

/**
 * Turn a rejected fetch into the app's standard network/CORS sentence.
 *
 * Deliberately the same wording as `loadCityModel.loadFromUrl`: a user who has
 * seen this message for a `.city.json` URL should not have to learn a second
 * vocabulary for a `.parquet` one.
 */
function networkError(url: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return new Error(
      `Network error loading "${baseName(url)}". Check that the URL is correct and accessible (CORS may block cross-origin requests).`,
      { cause: error },
    );
  }
  return new Error(`Failed to load: ${message}`, { cause: error });
}

/** Turn a non-ok response into the app's standard status sentence. */
function statusError(
  url: string,
  response: { status: number; statusText: string },
): Error {
  if (response.status === 404) {
    return new Error(
      `File not found (404) at "${baseName(url)}". Check the URL.`,
    );
  }
  return new Error(
    `Failed to fetch: ${String(response.status)} ${response.statusText}`,
  );
}

/** Fetch one object table's bytes, or reject with a friendly Error. */
async function fetchTable(
  url: string,
  name: string,
  http: HttpClient,
): Promise<FetchedTable> {
  let response: Awaited<ReturnType<HttpClient["fetchBytes"]>>;
  try {
    response = await http.fetchBytes(url);
  } catch (error) {
    throw networkError(url, error);
  }
  if (!response.ok) throw statusError(url, response);
  return { name, bytes: response.bytes };
}

/** Fetch and parse a package manifest, or reject with a friendly Error. */
async function fetchManifest(url: string, http: HttpClient): Promise<unknown> {
  let response: Awaited<ReturnType<HttpClient["fetchText"]>>;
  try {
    response = await http.fetchText(url);
  } catch (error) {
    throw networkError(url, error);
  }
  if (!response.ok) throw statusError(url, response);
  try {
    return JSON.parse(response.text) as unknown;
  } catch (error) {
    throw new Error(
      `This CityParquet package's ${MANIFEST_FILENAME} is not valid JSON.`,
      { cause: error },
    );
  }
}

/**
 * Fetch every table, at most {@link FETCH_CONCURRENCY} at a time, IN ORDER.
 *
 * A shared cursor drained by a fixed pool of workers — the same shape
 * `stacClient` uses for its collection crawl, written locally rather than
 * imported because that one is a private detail of the STAC feature. Results
 * are written back by index so the assembled model's table order is the
 * manifest's (or the listing's), not the network's.
 */
async function fetchAll(
  targets: ReadonlyArray<{ url: string; name: string }>,
  http: HttpClient,
): Promise<FetchedTable[]> {
  // Written by index (never pushed), so the array ends up dense in target
  // order however the responses interleave.
  const results: FetchedTable[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const target = targets[index];
      if (target === undefined) return;
      results[index] = await fetchTable(target.url, target.name, http);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, worker),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Selecting which objects of a bucket are tables
// ---------------------------------------------------------------------------

/**
 * Drop the format's sidecar tables, reporting how many went.
 *
 * Materials/textures/templates have a very different schema; reading one as an
 * object table fails deep in the parser with a message about columns. Named as
 * a count rather than silently, because a package whose only parquet files are
 * sidecars must be explicable.
 */
function dropSidecars(names: readonly string[]): string[] {
  const kept = names.filter((n) => !CITYPARQUET_SIDECAR_NAMES.has(baseName(n)));
  const dropped = names.length - kept.length;
  if (dropped > 0) {
    console.warn(
      `CityParquet: skipped ${String(dropped)} sidecar table(s) (materials/textures/geometry templates are not object tables).`,
    );
  }
  return kept;
}

/**
 * True when an expansion names more files than the viewer will load.
 *
 * The caller writes the sentence, because "narrow the pattern" is advice only a
 * wildcard can act on; the count is always in it, since "too many" without a
 * number leaves the user guessing how much narrower to get.
 */
function overCap(names: readonly string[]): boolean {
  return names.length > MAX_CITYPARQUET_FILES;
}

/** Every listed object that is a real `.parquet` file (not a placeholder). */
function parquetObjects(names: readonly string[]): string[] {
  // A zero-byte key ending in "/" is a console-created "folder", not a file.
  return names.filter((n) => !n.endsWith("/") && n.endsWith(".parquet"));
}

/** `storage-glob`: list by the pattern's literal prefix, then match it. */
async function expandGlob(
  store: StorageRef,
  pattern: string,
  http: HttpClient,
): Promise<string[]> {
  const listed = await listStorageObjects(
    store,
    globLiteralPrefix(pattern),
    http,
  );
  const matcher = globToRegExp(pattern);
  const matched = parquetObjects(listed.filter((n) => matcher.test(n)));
  const tables = dropSidecars(matched);
  if (tables.length === 0) {
    throw new Error(
      `The pattern "${pattern}" matched no .parquet object tables in "${store.bucket}".`,
    );
  }
  if (overCap(tables)) {
    throw new Error(
      `The wildcard matches ${String(tables.length)} files; the viewer loads at most ${String(MAX_CITYPARQUET_FILES)} at once — narrow the pattern.`,
    );
  }
  return tables;
}

/** `storage-dir` without a manifest: the `.parquet` files directly under it. */
function directTables(
  names: readonly string[],
  store: StorageRef,
  prefix: string,
): string[] {
  const depth = prefix === "" ? 0 : prefix.split("/").length - 1;
  const direct = parquetObjects(names).filter(
    (n) => n.startsWith(prefix) && n.split("/").length - 1 === depth,
  );
  const tables = dropSidecars(direct);
  if (tables.length === 0) {
    throw new Error(
      `No .parquet object tables found under "${store.bucket}/${prefix}".`,
    );
  }
  if (overCap(tables)) {
    throw new Error(
      `"${store.bucket}/${prefix}" holds ${String(tables.length)} .parquet files; the viewer loads at most ${String(MAX_CITYPARQUET_FILES)} at once — point at a subfolder or a single table.`,
    );
  }
  return tables;
}

/**
 * Resolve a manifest href against the package it came from.
 *
 * An href is allowed to be absolute; `new URL(href, base)` handles that and a
 * relative name identically, which is exactly why the object-storage arm builds
 * a base URL rather than concatenating the prefix itself.
 */
function resolveHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return `${baseUrl}${href}`;
  }
}

/** The tables a fetched manifest declares, as fetch targets. */
function manifestTargets(
  manifest: unknown,
  baseUrl: string,
): { url: string; name: string }[] {
  return parseCityParquetManifest(manifest).objectTables.map((href) => ({
    url: resolveHref(href, baseUrl),
    name: href,
  }));
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** The fetch targets one classified source expands to. */
async function targetsFor(
  source: CityParquetSource,
  http: HttpClient,
): Promise<{ url: string; name: string }[]> {
  switch (source.kind) {
    case "table":
      return [{ url: source.url, name: baseName(source.url) }];

    case "package-dir": {
      const manifestUrl = `${source.baseUrl}${MANIFEST_FILENAME}`;
      const manifest = await fetchManifest(manifestUrl, http);
      return manifestTargets(manifest, source.baseUrl);
    }

    case "storage-table":
      return [
        {
          url: storageObjectUrl(source.store, source.objectName),
          name: baseName(source.objectName),
        },
      ];

    case "storage-dir": {
      const listed = await listStorageObjects(
        source.store,
        source.prefix,
        http,
      );
      // A manifest is authoritative when the package ships one: it names the
      // object tables the writer meant, which is not necessarily every parquet
      // file sitting next to them.
      const manifestName = `${source.prefix}${MANIFEST_FILENAME}`;
      if (listed.includes(manifestName)) {
        const manifest = await fetchManifest(
          storageObjectUrl(source.store, manifestName),
          http,
        );
        return manifestTargets(
          manifest,
          storageObjectUrl(source.store, source.prefix),
        );
      }
      return directTables(listed, source.store, source.prefix).map((name) => ({
        url: storageObjectUrl(source.store, name),
        name: baseName(name),
      }));
    }

    case "storage-glob": {
      const names = await expandGlob(source.store, source.pattern, http);
      return names.map((name) => ({
        url: storageObjectUrl(source.store, name),
        // The full object name, because a glob's files usually SHARE a base
        // name ("…/a/building.parquet", "…/b/building.parquet") and an error
        // has to say which one.
        name,
      }));
    }
  }
}

/**
 * Load a CityParquet source — one table, a package directory, or a bucket
 * pattern — as a single `CityModel`.
 *
 * @throws {UnlistableUrlError} for an https wildcard that cannot be listed
 *   (propagated from `classifyCityParquetUrl` — its message is the explanation
 *   the user needs).
 */
export async function loadCityParquetFromUrl(
  rawUrl: string,
  http: HttpClient = browserPlatform.http,
): Promise<CityModel> {
  const source = classifyCityParquetUrl(rawUrl);
  if (source === null) {
    // `detectEncoding` routes anything ending in `.parquet` here, INCLUDING a
    // `.parquet.gz` (it strips one `.gz` first) that `classifyCityParquetUrl`
    // does not recognise. Fetching it as a single table keeps the router and
    // this loader in agreement, and the reader then says what is actually
    // wrong — "not a Parquet file" — instead of this function claiming the URL
    // was never CityParquet at all.
    if (detectEncoding(rawUrl) === "cityparquet") {
      return assembleCityParquetModel([
        await fetchTable(rawUrl, baseName(rawUrl), http),
      ]);
    }
    throw new Error(
      `"${rawUrl}" is not a CityParquet source — expected a .parquet file, a package directory containing ${MANIFEST_FILENAME}, or a gs:// / s3:// pattern.`,
    );
  }
  const targets = await targetsFor(source, http);
  return assembleCityParquetModel(await fetchAll(targets, http));
}

/**
 * Load a CityParquet package the user picked off disk.
 *
 * Files arrive flat from a folder picker, so selection is by BASE name: a
 * manifest picks the tables when there is one, and the parquet files minus the
 * known sidecars do when there is not — the same two-step
 * `parseCityParquetManifest` applies to a fetched package.
 */
export async function loadCityParquetFromFiles(
  files: ReadonlyArray<File>,
): Promise<CityModel> {
  const byName = new Map<string, File>();
  for (const file of files) {
    // Last wins is arbitrary but total: a folder cannot hold two files with
    // the same base name unless they are in different subfolders, and a
    // package is flat.
    byName.set(baseName(file.name), file);
  }

  const manifestFile = byName.get(MANIFEST_FILENAME);
  let names: string[];
  if (manifestFile === undefined) {
    names = dropSidecars(
      [...byName.keys()].filter((name) => name.endsWith(".parquet")),
    );
  } else {
    let manifest: unknown;
    try {
      manifest = JSON.parse(await manifestFile.text()) as unknown;
    } catch (error) {
      throw new Error(
        `This CityParquet package's ${MANIFEST_FILENAME} is not valid JSON.`,
        { cause: error },
      );
    }
    names = parseCityParquetManifest(manifest).objectTables.map(baseName);
  }

  if (names.length === 0) {
    throw new Error(
      "The folder contains no CityParquet object tables (*.parquet).",
    );
  }

  const tables: FetchedTable[] = [];
  for (const name of names) {
    const file = byName.get(name);
    if (file === undefined) {
      throw new Error(
        `The folder is missing "${name}", which its ${MANIFEST_FILENAME} declares as an object table.`,
      );
    }
    tables.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return assembleCityParquetModel(tables);
}

/**
 * A short, human layer name for a CityParquet source.
 *
 * The FOLDER is the name a user recognises for a package ("delft"), the file
 * is for a lone table ("building"), and a glob is named by the literal part of
 * its pattern — "3dbag_tiled/&#42;/building.parquet" is the 3dbag_tiled dataset, not
 * a layer called "building". Falls back to the bucket, then to the input, so
 * this never returns "".
 */
export function cityParquetLayerNameFromUrl(rawUrl: string): string {
  let source: CityParquetSource | null = null;
  try {
    source = classifyCityParquetUrl(rawUrl);
  } catch {
    source = null; // unlistable wildcard: named from the raw text below
  }
  const name = source === null ? "" : layerNameForSource(source);
  return name === "" ? rawUrl.trim() : name;
}

/** Percent-decode one path segment, tolerating a malformed escape. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The last non-empty segment of a path, decoded, or "". */
function lastSegment(path: string): string {
  const segments = path.split("/").filter((s) => s !== "");
  return decodeSegment(segments.at(-1) ?? "");
}

/** Drop a trailing ".parquet" from a file name. */
function withoutParquet(name: string): string {
  return name.endsWith(".parquet") ? name.slice(0, -".parquet".length) : name;
}

function layerNameForSource(source: CityParquetSource): string {
  switch (source.kind) {
    case "table":
      return withoutParquet(lastSegment(pathOf(source.url)));
    case "package-dir":
      return lastSegment(pathOf(source.baseUrl));
    case "storage-table":
      return withoutParquet(lastSegment(source.objectName));
    case "storage-dir":
      return lastSegment(source.prefix) || source.store.bucket;
    case "storage-glob":
      return (
        lastSegment(globLiteralPrefix(source.pattern)) || source.store.bucket
      );
  }
}

/** The path of a URL, or the whole string when it is not one. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
