/**
 * A collection's items, read from its stac-geoparquet mirror with the app's
 * existing DuckDB-wasm.
 *
 * WHY PARQUET AND NOT THE STAC ITEM API. This catalog is a pile of static
 * files on a bucket: there is no `/search` endpoint, and a collection's items
 * are otherwise one `item.json` per item — thousands of requests for one
 * table. The mirror is a single file of at most ~2.24 MB, so it is fetched
 * WHOLE and handed to DuckDB as a buffer (`queryParquetBuffer`). No `httpfs`,
 * no range reads: at this size the extension, the preflights and the
 * partial-footer failure modes cost more than the download.
 *
 * WHY NO GEOMETRY. stac-geoparquet stores a WKB `geometry` column, which
 * `queryDuckDB`'s row extraction would surface as an Arrow blob nobody here
 * can decode. It is never selected — every footprint in this catalog is a
 * rectangle, and the `bbox` struct already IS that rectangle.
 *
 * WHY A SCHEMA PROBE. The 31 mirrors are generated independently and only
 * happen to agree today. A projection assuming a fixed schema turns one
 * pipeline's missing `city3d:lods` into "Could not read the item index" for a
 * whole collection, so the SELECT list is built per file from a `DESCRIBE`,
 * defaulting absent columns to NULL — a collection stays browsable minus one
 * badge rather than not at all.
 *
 * ENGINE-FREE and store-free, like `stacClient.ts`: a function of a card
 * returning plain records.
 */

import {
  getDuckDBStatus,
  initDuckDB,
  queryParquetBuffer,
} from "../../insights/duckdb";
import { validBbox2d } from "./stacNormalize";
import type { StacCollectionCard, StacItemRecord } from "./stacTypes";

/** The separator the SQL joins list columns with before they cross back into
 *  JS. Any character works as long as it cannot occur in an LoD or a
 *  CityObject type — both are identifiers. */
const LIST_SEPARATOR = "|";

/** Makes every registration name unique — see {@link itemsFileName}. */
let registrationCounter = 0;

/**
 * The DuckDB file name a collection's buffer is registered under.
 *
 * SANITIZED, and that is not cosmetic: this name is interpolated into SQL
 * below, and a collection id is a third party's string. Anything outside
 * `[A-Za-z0-9_-]` — a quote above all — becomes `_`, so there is nothing left
 * to break out of the literal with.
 *
 * UNIQUE PER CALL, because `queryParquetBuffer` drops the file when its query
 * ends: two overlapping reads (a double-click, or two collections whose ids
 * sanitize to the same string) sharing a name would let the first one's
 * `dropFile` pull the file out from under the second one's query, which then
 * fails with a generic "could not read" for no reason the user could act on.
 */
export function itemsFileName(collectionId: string): string {
  const safe = collectionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `stac-items-${safe}-${++registrationCounter}.parquet`;
}

/** The `DESCRIBE` that tells us which of the expected columns this particular
 *  mirror actually has. Exported for tests. */
export function buildDescribeSql(fileName: string): string {
  return `DESCRIBE SELECT * FROM read_parquet('${fileName}')`;
}

/**
 * The item projection, built from the columns that actually exist.
 *
 * Every selected expression is a SCALAR — list columns collapsed with
 * `array_to_string`, struct fields addressed by bracket path — because
 * `queryDuckDB` reads a row cell by cell with `getChild(col).get(i)` and would
 * hand back a live Arrow vector for anything nested.
 *
 * @param columns top-level column names reported by the DESCRIBE probe.
 */
export function buildItemsSql(
  fileName: string,
  columns: ReadonlySet<string>,
): string {
  const has = (c: string) => columns.has(c);
  const parts = [
    has("id") ? "id" : "NULL AS id",
    has("bbox")
      ? "t.bbox['xmin'] AS xmin, t.bbox['ymin'] AS ymin, t.bbox['xmax'] AS xmax, t.bbox['ymax'] AS ymax"
      : "NULL AS xmin, NULL AS ymin, NULL AS xmax, NULL AS ymax",
    has("assets")
      ? "t.assets['data']['href'] AS href, t.assets['data']['type'] AS media_type"
      : "NULL AS href, NULL AS media_type",
    has("city3d:lods")
      ? `array_to_string("city3d:lods", '${LIST_SEPARATOR}') AS lods`
      : "NULL AS lods",
    has("city3d:co_types")
      ? `array_to_string("city3d:co_types", '${LIST_SEPARATOR}') AS co_types`
      : "NULL AS co_types",
    has("city3d:city_objects")
      ? `TRY_CAST("city3d:city_objects" AS BIGINT) AS city_objects`
      : "NULL AS city_objects",
    has("proj:code") ? `"proj:code" AS proj_code` : "NULL AS proj_code",
  ];
  return `SELECT ${parts.join(", ")} FROM read_parquet('${fileName}') AS t`;
}

/** The error every failure to produce a table shares, so the UI has one
 *  sentence to show and the tests one string to match. */
function unreadable(): Error {
  return new Error("Could not read the item index for this collection.");
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  return null;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A `'a|b'` cell as a list, with empty segments dropped — an item with no
 *  LoDs at all arrives as `''`, which `split` would turn into `[""]`. */
function splitList(value: unknown): readonly string[] {
  if (typeof value !== "string" || value === "") return [];
  return value.split(LIST_SEPARATOR).filter((part) => part !== "");
}

/**
 * An item's data-asset href, made absolute and restricted to http(s).
 *
 * RESOLVED, because a STAC asset href is allowed to be relative and several of
 * these mirrors write one: the parquet's own URL is the only base the item was
 * ever described against, so `tiles/x.city.json` becomes a real URL instead of
 * being handed to `fetch` as a path relative to the APP.
 *
 * SCHEME-GUARDED, because this string ends up in `<a href>` and in the URL
 * loader, and the catalog is a third party's file: `javascript:` and `data:`
 * are not sources, they are ways of running something. Anything that is not
 * http(s) becomes null, which the UI already renders as "No data asset".
 */
function assetHrefFrom(value: unknown, base: string): string | null {
  const text = textOrNull(value);
  if (text === null) return null;
  let url: URL;
  try {
    url = new URL(text, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

/** One projected row as a record, or null when it has no usable id — an item
 *  that cannot be identified cannot be selected, shared or loaded. */
function recordFromRow(
  row: Record<string, unknown>,
  collectionId: string,
  /** The mirror's own URL — the base every relative asset href resolves
   *  against. */
  parquetHref: string,
): StacItemRecord | null {
  // A usable id is a scalar and nothing else: a mirror that put an object or
  // an array in the column has no identity to offer, and `String()` would turn
  // that into the one "[object Object]" every such row would share. `bigint` is
  // in the list because DuckDB hands an integer column back as one.
  const rawId: unknown = row.id;
  if (
    typeof rawId !== "string" &&
    typeof rawId !== "number" &&
    typeof rawId !== "bigint"
  ) {
    return null;
  }
  const id = String(rawId);
  if (id === "") return null;

  const xmin = finiteOrNull(row.xmin);
  const ymin = finiteOrNull(row.ymin);
  const xmax = finiteOrNull(row.xmax);
  const ymax = finiteOrNull(row.ymax);
  const bbox2d =
    xmin === null || ymin === null || xmax === null || ymax === null
      ? null
      : validBbox2d(xmin, ymin, xmax, ymax);

  return {
    id,
    collectionId,
    bbox2d,
    assetHref: assetHrefFrom(row.href, parquetHref),
    assetType: textOrNull(row.media_type),
    lods: splitList(row.lods),
    coTypes: splitList(row.co_types),
    cityObjects: finiteOrNull(row.city_objects),
    projCode: textOrNull(row.proj_code),
  };
}

/**
 * The items of a collection, sorted by id.
 *
 * THROWS rather than returning an empty list on failure: an empty table and "we
 * could not read the table" look identical in a UI, and only one of them is
 * worth a retry. The four messages distinguish "this collection never had a
 * mirror" (an ordinary outcome — only 31 of 53 do), "the analytics engine never
 * started", "the download failed" and "the database could not read it".
 */
export async function fetchCollectionItems(
  card: StacCollectionCard,
): Promise<StacItemRecord[]> {
  const href = card.itemsParquetHref;
  if (href === null) {
    throw new Error("This collection has no item index yet.");
  }

  await initDuckDB();
  // `initDuckDB` RESOLVES on failure — it records the failure in the status and
  // leaves the query functions returning null. Without this check a browser
  // that could not start WebAssembly at all would blame the catalog's index
  // ("could not read"), which is neither true nor actionable, and would spend a
  // multi-megabyte download finding it out.
  if (getDuckDBStatus().state !== "ready") {
    throw new Error(
      "The analytics engine could not start, so item indexes cannot be read.",
    );
  }

  let buffer: Uint8Array;
  try {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new Error("Could not download the item index for this collection.", {
      cause: error,
    });
  }

  const fileName = itemsFileName(card.id);

  const described = await queryParquetBuffer(
    fileName,
    buffer,
    buildDescribeSql(fileName),
  );
  if (described === null) throw unreadable();

  const columns = new Set<string>();
  for (const row of described.rows) {
    const name = row.column_name;
    if (typeof name === "string") columns.add(name);
  }

  const result = await queryParquetBuffer(
    fileName,
    buffer,
    buildItemsSql(fileName, columns),
  );
  if (result === null) throw unreadable();

  const items: StacItemRecord[] = [];
  for (const row of result.rows) {
    const record = recordFromRow(row, card.id, href);
    if (record !== null) items.push(record);
  }

  // Sorted here, not in the UI, so the table, a share link and a test all
  // agree on an order that the parquet's own row order does not guarantee.
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
