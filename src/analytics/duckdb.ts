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
        row[col] = result.getChild(col)?.get(i);
      }
      rows.push(row);
    }

    return { columns, rows };
  } catch {
    return null;
  }
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
    await conn.query(`
      CREATE OR REPLACE TABLE city_objects AS
      SELECT * FROM ${readerFn}('${sourceUrl}')
    `);
    return true;
  } catch {
    return false;
  }
}
