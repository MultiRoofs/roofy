/**
 * DuckDB-wasm integration with the cityjson community extension.
 *
 * Provides a lazy-initialized singleton DuckDB instance that attempts
 * to load the cityjson extension for analytical SQL queries over city
 * model files.
 *
 * If extension loading fails (e.g., WASM build unavailable in the
 * community repo), the module reports the failure via getDuckDBStatus()
 * and all query functions return null. The M4.2 pure-function stats
 * remain fully functional as the primary analytics path.
 *
 * Fallback plan (documented for M5): populate DuckDB tables from
 * in-memory CityModel data instead of using the extension readers.
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import type { CityModel } from "../domain/citymodel/types";
import type { CityModelReference, UrlModelRef } from "../persistence/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DuckDBStatus =
  | { readonly state: "uninitialized" }
  | { readonly state: "initializing" }
  | { readonly state: "ready"; readonly extensionLoaded: boolean }
  | { readonly state: "failed"; readonly error: string };

export interface QueryResult {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let status: DuckDBStatus = { state: "uninitialized" };
let initPromise: Promise<void> | null = null;

export function getDuckDBStatus(): DuckDBStatus {
  return status;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function doInit(): Promise<void> {
  status = { state: "initializing" };

  try {
    // Use MVP bundle (no SharedArrayBuffer / COOP-COEP required)
    const bundle = await duckdb.selectBundle({
      mvp: {
        mainModule: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm",
          import.meta.url,
        ).href,
        mainWorker: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
          import.meta.url,
        ).href,
      },
    });

    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const instance = new duckdb.AsyncDuckDB(logger, worker);
    await instance.instantiate(bundle.mainModule);

    db = instance;
    conn = await db.connect();

    // Try to load the cityjson community extension
    let extensionLoaded = false;
    try {
      await conn.query("INSTALL cityjson FROM community");
      await conn.query("LOAD cityjson");
      extensionLoaded = true;
    } catch (extErr) {
      console.warn(
        "DuckDB cityjson extension not available in WASM runtime:",
        extErr,
      );
    }

    status = { state: "ready", extensionLoaded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = { state: "failed", error: message };
    console.error("DuckDB-wasm initialization failed:", err);
  }
}

/**
 * Initialize DuckDB-wasm. Safe to call multiple times — returns the
 * same promise if already initializing or initialized.
 */
export function initDuckDB(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Run a SQL query against the DuckDB instance.
 * Returns null if DuckDB is not ready or the query fails.
 */
export async function queryDuckDB(sql: string): Promise<QueryResult | null> {
  if (!conn || status.state !== "ready") return null;

  try {
    const result = await conn.query(sql);
    const columns = result.schema.fields.map((f) => f.name);
    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < result.numRows; i++) {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const val = result.getChild(col)?.get(i);
        // Convert BigInt to Number for JSON compatibility
        row[col] = typeof val === "bigint" ? Number(val) : val;
      }
      rows.push(row);
    }

    return { columns, rows };
  } catch {
    return null;
  }
}

/**
 * Register `buffer` under `fileName`, run `sql` against it, then drop the file.
 *
 * The whole-file registration is the point: a stac-geoparquet item index is at
 * most a couple of megabytes, so downloading it once and handing DuckDB the
 * bytes is strictly simpler than `httpfs` + range reads — no extension to
 * install, no CORS preflight on `Range`, and no partially-read footer to
 * diagnose when a bucket answers 200 to a range request.
 *
 * Returns null when DuckDB is not ready or the query fails, the same contract
 * as {@link queryDuckDB} — callers already have to handle "no database" and
 * should not have to distinguish it from "bad SQL". Works WITHOUT the cityjson
 * extension: `read_parquet` is DuckDB core.
 *
 * The file is dropped in a `finally` so a repeated call may reuse the same
 * name, but a `dropFile` failure never discards a result that was already
 * produced.
 */
export async function queryParquetBuffer(
  fileName: string,
  buffer: Uint8Array,
  sql: string,
): Promise<QueryResult | null> {
  if (!db || !conn || status.state !== "ready") return null;

  const database = db;
  try {
    await database.registerFileBuffer(fileName, buffer);
  } catch {
    return null;
  }

  try {
    return await queryDuckDB(sql);
  } finally {
    await database.dropFile(fileName).catch(() => {});
  }
}

/**
 * Whether the whole-file extension reader (`loadModelIntoDuckDB`, below) is
 * allowed for a layer: only for a static (non-streaming) URL layer.
 *
 * A streaming layer already asked the worker for only the cells the
 * viewport needs. Running `read_flatcitybuf`/`read_cityjson*` over the
 * source URL anyway — which is what happened before this gate existed —
 * opens a SECOND, complete read of the remote file just to populate
 * `city_objects`, exactly the cost viewport streaming exists to avoid, and
 * would make the Stats/Table tabs silently report the entire dataset while
 * the rest of the UI claims to be showing only what's resident.
 * `loadResidentObjectsIntoDuckDB` feeds the table from what's actually
 * resident instead — see the caller in App.tsx.
 *
 * A type predicate (not a plain `boolean`) so callers that also need
 * `ref.url` get it narrowed for free, the same way the inline
 * `ref.type === "url"` check they're replacing did.
 */
export function shouldUseSourceUrlPath(
  ref: CityModelReference,
  isStreaming: boolean,
): ref is UrlModelRef {
  return ref.type === "url" && !isStreaming;
}

/**
 * Load a city model source into DuckDB tables using the cityjson extension.
 * Returns true if successful, false if extension not available or query failed.
 */
export async function loadModelIntoDuckDB(
  sourceUrl: string,
  encoding: "cityjson" | "cityjsonseq" | "flatcitybuf",
): Promise<boolean> {
  if (!conn || status.state !== "ready") return false;
  if (!(status as { extensionLoaded: boolean }).extensionLoaded) return false;

  const readerFn =
    encoding === "cityjsonseq"
      ? "read_cityjsonseq"
      : encoding === "flatcitybuf"
        ? "read_flatcitybuf"
        : "read_cityjson";

  try {
    const escapedUrl = sourceUrl.replace(/'/g, "''");
    await conn.query(`
      CREATE OR REPLACE TABLE city_objects AS
      SELECT * FROM ${readerFn}('${escapedUrl}')
    `);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory loading (file-dropped models or extension fallback)
// ---------------------------------------------------------------------------

const RESERVED_COLS = new Set(["id", "type", "lod", "surface_count"]);

/**
 * Registers `rows` as the `city_objects` table via `read_json_auto`, the
 * step shared by every in-memory (non-extension) loader below. Callers have
 * already confirmed `db`/`conn` are ready — taking them as parameters
 * (rather than re-reading the module-level `db`/`conn` and asserting
 * non-null) keeps this function itself fully type-safe.
 */
async function registerCityObjectRows(
  database: duckdb.AsyncDuckDB,
  connection: duckdb.AsyncDuckDBConnection,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<boolean> {
  if (rows.length === 0) return false;

  const jsonStr = JSON.stringify(rows);
  const buffer = new TextEncoder().encode(jsonStr);
  await database.registerFileBuffer("city_objects.json", buffer);
  await connection.query(
    "CREATE OR REPLACE TABLE city_objects AS SELECT * FROM read_json_auto('city_objects.json')",
  );
  return true;
}

/** Attributes common to both `CityObject` and `ResidentObjectRecord`, minus
 *  the reserved columns every row already carries under those exact names. */
function attributeRow(
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (RESERVED_COLS.has(key)) continue;
    row[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : value;
  }
  return row;
}

/**
 * Load a CityModel into DuckDB by converting objects to JSON and using
 * read_json_auto. Works without the cityjson extension — only needs
 * DuckDB core ready.
 */
export async function loadCityModelFromMemory(
  model: CityModel,
): Promise<boolean> {
  if (!db || !conn || status.state !== "ready") return false;

  try {
    const objects = Object.values(model.objects).filter(Boolean);

    const rows = objects.map((obj) => ({
      id: obj.id,
      type: obj.objectType,
      lod: obj.lod ?? null,
      surface_count: obj.surfaces.length,
      ...attributeRow(obj.attributes),
    }));

    return await registerCityObjectRows(db, conn, rows);
  } catch (err) {
    console.error("Failed to load CityModel into DuckDB from memory:", err);
    return false;
  }
}

/**
 * Load a streaming layer's currently RESIDENT objects into DuckDB —
 * the honest replacement for `loadModelIntoDuckDB` on a streaming layer
 * (see `shouldUseSourceUrlPath`). Takes the records directly (typically
 * `Object.values(getResidentModel(layerId, version).objects)`) rather than
 * reaching into any store itself, mirroring `loadCityModelFromMemory`'s
 * "data in, table out" shape so it stays trivially callable with
 * constructed test data.
 *
 * Row shape mirrors `loadCityModelFromMemory`'s field-for-field, but reads
 * `surface_count` from `r.surfaceCount` directly rather than
 * `surfaces.length` — a `ResidentObjectRecord` never carries ring geometry
 * (see `@cityjson/navara-flatcitybuf`'s workerProtocol.ts for why).
 */
export async function loadResidentObjectsIntoDuckDB(
  records: ReadonlyArray<ResidentObjectRecord>,
): Promise<boolean> {
  if (!db || !conn || status.state !== "ready") return false;

  try {
    const rows = records.map((r) => ({
      id: r.id,
      type: r.objectType,
      lod: r.lod ?? null,
      surface_count: r.surfaceCount,
      ...attributeRow(r.attributes),
    }));

    return await registerCityObjectRows(db, conn, rows);
  } catch (err) {
    console.error("Failed to load resident objects into DuckDB:", err);
    return false;
  }
}
