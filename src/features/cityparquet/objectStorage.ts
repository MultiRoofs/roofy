/**
 * Listing and addressing objects in a public GCS or S3 bucket.
 *
 * ENGINE-FREE and dependency-free: it takes the app's `HttpClient` as a seam,
 * so the pagination and parsing are unit-testable under Node against a fake
 * client, with no SDK and no credentials. Both listing APIs used here are the
 * ANONYMOUS ones — the GCS JSON API on a public bucket and S3
 * `ListObjectsV2` — because the viewer never holds a key.
 *
 * WHY REGEX AND NOT DOMParser FOR S3. `DOMParser` does not exist under Node,
 * which would push these tests into jsdom for one XML document that is machine
 * generated and shallow. `<Key>…</Key>` is matched directly and the five XML
 * entities are decoded by hand; keys containing "<" arrive escaped and survive
 * that, which is the only case the shortcut has to get right.
 */

import type { HttpClient } from "../../platform/types";
import type { StorageRef } from "./sourceClassify";

/**
 * How many tables one CityParquet source may expand to.
 *
 * A glob over a tiled dataset can name thousands of files; each is a fetch and
 * a mesh. Sixty-four is a budget the browser can actually finish, and the
 * caller reports the cap rather than silently loading a slice of it.
 */
export const MAX_CITYPARQUET_FILES = 64;

/**
 * How many listing pages to follow before giving up.
 *
 * A guard against a server that keeps handing back a page token, not a real
 * limit: at 1000 objects a page this is 50k names, far past what
 * {@link MAX_CITYPARQUET_FILES} would ever select from.
 */
const MAX_LIST_PAGES = 50;

/** Objects requested per listing page (the maximum both APIs allow). */
const PAGE_SIZE = 1000;

/** Escape every character that means something to a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a glob over object names into an anchored RegExp.
 *
 * `*` matches a run WITHIN one path segment, `**` crosses separators, `?`
 * matches one non-separator character; everything else is literal. Anchored at
 * both ends, because a pattern names whole objects, not substrings.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * The literal text before the first wildcard.
 *
 * This is what a listing call sends as its `prefix`, so the server filters the
 * bulk of the bucket instead of this module downloading it.
 */
export function globLiteralPrefix(pattern: string): string {
  const star = pattern.indexOf("*");
  const question = pattern.indexOf("?");
  const first =
    star === -1 ? question : question === -1 ? star : Math.min(star, question);
  return first === -1 ? pattern : pattern.slice(0, first);
}

/** Percent-encode each path segment, keeping the "/" separators literal. */
function encodeObjectName(objectName: string): string {
  return objectName.split("/").map(encodeURIComponent).join("/");
}

/** The public https URL of one object. */
export function storageObjectUrl(
  store: StorageRef,
  objectName: string,
): string {
  const encoded = encodeObjectName(objectName);
  return store.provider === "gcs"
    ? `https://storage.googleapis.com/${store.bucket}/${encoded}`
    : `https://${store.bucket}.s3.amazonaws.com/${encoded}`;
}

/**
 * Fetch text, turning both failure modes into one explanatory Error.
 *
 * A cross-origin listing that the bucket has not opened up fails as a REJECTED
 * fetch (the browser never surfaces the response), not as a status — so the
 * CORS hint belongs on the rejection path and on a status of 0, and nowhere
 * else, where it would only muddy a plain 404.
 */
async function fetchListing(
  url: string,
  store: StorageRef,
  http: HttpClient,
): Promise<string> {
  let response: Awaited<ReturnType<HttpClient["fetchText"]>>;
  try {
    response = await http.fetchText(url);
  } catch (error) {
    throw new Error(
      `Could not list bucket "${store.bucket}": the request failed before a response arrived (the bucket may not allow cross-origin listing). ${String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const detail = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    const hint =
      response.status === 0
        ? " (the bucket may not allow cross-origin listing)"
        : "";
    throw new Error(
      `Could not list bucket "${store.bucket}": ${detail}${hint}.`,
    );
  }
  return response.text;
}

/** One listed object: its full name and its byte size, when the listing
 *  said (a missing or unparsable size is `null`, never a guess). */
export interface StorageEntry {
  readonly name: string;
  readonly size: number | null;
}

/** A listing's size field as a byte count, or `null`. */
function sizeOf(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** One page of the GCS JSON listing API, typed as loosely as it arrives. */
interface GcsListPage {
  readonly items?: readonly {
    readonly name?: unknown;
    /** A decimal STRING in the JSON API (it is a uint64). */
    readonly size?: unknown;
  }[];
  readonly nextPageToken?: unknown;
}

/** List a GCS bucket through the anonymous JSON API. */
async function listGcsObjects(
  store: StorageRef,
  prefix: string,
  http: HttpClient,
): Promise<StorageEntry[]> {
  const base =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(store.bucket)}/o` +
    `?prefix=${encodeURIComponent(prefix)}&maxResults=${PAGE_SIZE}` +
    `&fields=${encodeURIComponent("items/name,items/size,nextPageToken")}`;

  const entries: StorageEntry[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const url = pageToken
      ? `${base}&pageToken=${encodeURIComponent(pageToken)}`
      : base;
    const text = await fetchListing(url, store, http);
    let parsed: GcsListPage;
    try {
      parsed = JSON.parse(text) as GcsListPage;
    } catch {
      throw new Error(
        `Could not list bucket "${store.bucket}": the listing response was not valid JSON.`,
      );
    }
    for (const item of parsed.items ?? []) {
      if (typeof item?.name === "string") {
        entries.push({ name: item.name, size: sizeOf(item.size) });
      }
    }
    const next =
      typeof parsed.nextPageToken === "string" ? parsed.nextPageToken : "";
    // A repeated token would loop forever; treat it as the end.
    if (next === "" || next === pageToken) break;
    pageToken = next;
  }
  return entries;
}

/** Decode the five XML entities S3 uses to escape a key. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" does not become "<"
}

/** Read the text of the first `<tag>` element, or "" when absent. */
function xmlTagText(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match ? unescapeXml(match[1] ?? "") : "";
}

/** List an S3 bucket through the anonymous virtual-hosted ListObjectsV2 API. */
async function listS3Objects(
  store: StorageRef,
  prefix: string,
  http: HttpClient,
): Promise<StorageEntry[]> {
  const base =
    `https://${store.bucket}.s3.amazonaws.com/?list-type=2` +
    `&prefix=${encodeURIComponent(prefix)}&max-keys=${PAGE_SIZE}`;

  const entries: StorageEntry[] = [];
  let token = "";
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const url = token
      ? `${base}&continuation-token=${encodeURIComponent(token)}`
      : base;
    const xml = await fetchListing(url, store, http);
    // Per <Contents> block, so each <Key> pairs with ITS <Size>.
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1] ?? "";
      if (!/<Key>/.test(block)) continue;
      entries.push({
        name: xmlTagText(block, "Key"),
        size: sizeOf(xmlTagText(block, "Size")),
      });
    }
    const truncated = xmlTagText(xml, "IsTruncated") === "true";
    const next = xmlTagText(xml, "NextContinuationToken");
    if (!truncated || next === "" || next === token) break;
    token = next;
  }
  return entries;
}

/**
 * Every object name under `prefix`, following the API's own pagination.
 *
 * Returns FULL object names (the prefix is included), which is what
 * {@link globToRegExp} matches against and {@link storageObjectUrl} addresses.
 */
export async function listStorageObjects(
  store: StorageRef,
  prefix: string,
  http: HttpClient,
): Promise<string[]> {
  return (await listStorageEntries(store, prefix, http)).map((e) => e.name);
}

/** {@link listStorageObjects}, with each object's size as the listing gave
 *  it — what the CityParquet loader sizes a bucket source by. */
export async function listStorageEntries(
  store: StorageRef,
  prefix: string,
  http: HttpClient,
): Promise<StorageEntry[]> {
  return store.provider === "gcs"
    ? listGcsObjects(store, prefix, http)
    : listS3Objects(store, prefix, http);
}
