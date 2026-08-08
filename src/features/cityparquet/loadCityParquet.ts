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
 * EXPANSION IS CAPPED ON EVERY ARM, fetching is not throttled beyond a small
 * pool. {@link MAX_CITYPARQUET_FILES} is a whole-LOAD memory bound (spec D5),
 * so it applies to a glob, to a listing, to a manifest's declared hrefs and to
 * a picked folder alike — a manifest is a list someone else wrote (3D BAG's
 * root package declares up to a thousand tables), reachable from one pasted URL
 * or share link. Refused up front with the count, rather than a slice of it
 * being loaded silently.
 */

import {
  CITYPARQUET_SIDECAR_NAMES,
  CityParquetError,
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
 *
 * THE POOL STOPS ON THE FIRST FAILURE. `Promise.all` rejects immediately but
 * does not stop anything, so without the shared flag the other five workers
 * keep draining the cursor and issue every remaining request of a 64-file glob
 * for a load that has already failed. The flag is checked before each new
 * target, so at most the requests already in flight complete.
 */
async function fetchAll(
  targets: ReadonlyArray<{ url: string; name: string }>,
  http: HttpClient,
): Promise<FetchedTable[]> {
  // Written by index (never pushed), so the array ends up dense in target
  // order however the responses interleave.
  const results: FetchedTable[] = [];
  let cursor = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed) return;
      const index = cursor++;
      const target = targets[index];
      if (target === undefined) return;
      try {
        results[index] = await fetchTable(target.url, target.name, http);
      } catch (error) {
        failed = true;
        throw error;
      }
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

/**
 * The tables a fetched manifest declares, as fetch targets.
 *
 * CAPPED like every other expansion: the hrefs are a list the PACKAGE wrote,
 * not one the user typed, and the largest real packages declare hundreds of
 * them. The count is refused before the first byte is requested — there is no
 * "narrow the pattern" advice to give here, because there is no pattern.
 */
function manifestTargets(
  manifest: unknown,
  baseUrl: string,
): { url: string; name: string }[] {
  const hrefs = parseCityParquetManifest(manifest).objectTables;
  if (overCap(hrefs)) {
    throw new Error(declaredOverCap(hrefs.length));
  }
  return hrefs.map((href) => ({
    url: resolveHref(href, baseUrl),
    name: href,
  }));
}

/** The sentence for a manifest that declares more tables than the cap. */
function declaredOverCap(count: number): string {
  return `This package declares ${String(count)} object tables; the viewer loads at most ${String(MAX_CITYPARQUET_FILES)} at once.`;
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
    // `detectEncoding` matches on a name, `classifyCityParquetUrl` on a URL, so
    // a `.parquet` string that is not a parsable http(s)/gs/s3 URL at all (a
    // bare relative path, another scheme) is CityParquet to the router and
    // nothing to the classifier. Fetching it as a single table keeps the two in
    // agreement, and the reader then says what is actually wrong — "could not
    // be read as Parquet" — instead of this function claiming the URL was never
    // CityParquet at all. (A `.parquet.gz` no longer lands here: the classifier
    // owns it as a table, for the same reason.)
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
 * A picked file's path RELATIVE to the folder the user chose.
 *
 * A folder picker sets `webkitRelativePath` to "<folder>/a/building.parquet";
 * the first segment is the folder the user chose (the package root), so it is
 * dropped and what remains is exactly what a manifest href says. Base name is
 * the fallback for a drag-and-drop multi-file selection, where the browser sets
 * no relative path at all.
 *
 * KEYING BY BASE NAME ALONE IS WRONG for a tiled package: "a/building.parquet"
 * and "b/building.parquet" would collapse onto one entry, and the model would
 * silently be built from ONE tile read twice (the assembler's first-wins merge
 * hides it behind a duplicate-id warning).
 */
function pickedPath(file: File): string {
  // Read defensively: the attribute is absent on a `File` constructed by hand
  // (tests, and some non-browser hosts), where the spec's "" is not there to
  // read either.
  const relative =
    typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : "";
  if (relative === "") return baseName(file.name);
  const segments = relative.split("/").filter((s) => s !== "");
  return segments.slice(1).join("/") || baseName(file.name);
}

/**
 * The picked file for one manifest href.
 *
 * Exact relative path first; a bare base name is accepted only when it is
 * UNAMBIGUOUS, which is what makes a drag-and-drop selection (no relative
 * paths) of a flat package work without letting a tiled one guess.
 */
function fileForHref(
  href: string,
  byPath: ReadonlyMap<string, File>,
): File | undefined {
  const exact = byPath.get(href);
  if (exact !== undefined) return exact;
  const wanted = baseName(href);
  const matches = [...byPath.entries()].filter(
    ([path]) => baseName(path) === wanted,
  );
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

/**
 * Load a CityParquet package the user picked off disk.
 *
 * Files are keyed by their path within the picked folder (see
 * {@link pickedPath}): a manifest picks the tables when there is one, and the
 * parquet files minus the known sidecars do when there is not — the same
 * two-step `parseCityParquetManifest` applies to a fetched package.
 */
export async function loadCityParquetFromFiles(
  files: ReadonlyArray<File>,
): Promise<CityModel> {
  const byPath = new Map<string, File>();
  for (const file of files) {
    const path = pickedPath(file);
    if (byPath.has(path)) {
      // Two files cannot share a path within one folder, so this is a
      // selection spanning several — silently keeping one of them would build
      // a model out of the wrong tiles.
      throw new CityParquetError(
        `The selection contains two files called "${path}". Pick one package folder at a time.`,
      );
    }
    byPath.set(path, file);
  }

  const manifestFile = byPath.get(MANIFEST_FILENAME);
  let names: string[];
  if (manifestFile === undefined) {
    names = dropSidecars(
      [...byPath.keys()].filter((path) => path.endsWith(".parquet")),
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
    names = parseCityParquetManifest(manifest).objectTables;
  }

  if (names.length === 0) {
    // "Selection", not "folder": the same loader serves a picked folder, a
    // multi-file drop and a single dropped file, and one dropped `.parquet.gz`
    // reaches exactly this line.
    throw new Error(
      "The selection contains no CityParquet object tables (*.parquet).",
    );
  }
  // The cap bounds the whole LOAD, so reading local files is not exempt: 1000
  // tables assembled into one model end in the same place however they arrived.
  if (overCap(names)) {
    throw new Error(
      manifestFile === undefined
        ? `The selection contains ${String(names.length)} object tables; the viewer loads at most ${String(MAX_CITYPARQUET_FILES)} at once.`
        : declaredOverCap(names.length),
    );
  }

  const tables: FetchedTable[] = [];
  for (const name of names) {
    const file = fileForHref(name, byPath);
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

/** Drop a trailing ".parquet" (or ".parquet.gz") from a file name. */
function withoutParquet(name: string): string {
  const base = name.endsWith(".gz") ? name.slice(0, -".gz".length) : name;
  return base.endsWith(".parquet") ? base.slice(0, -".parquet".length) : base;
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
