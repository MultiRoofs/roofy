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
 * Per-layer tables live in `insights/layerTables.ts`, which reaches the
 * engine only through the functions exported here — this module is the ONLY
 * importer of `@duckdb/duckdb-wasm` in the app.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtensionName = "cityjson" | "spatial" | "three_d";

/** Per-extension load state. `cityjson` is loaded at init; `spatial` and
 *  `three_d` stay `"unloaded"` until `ensureExtension` asks for them. */
export type ExtensionStatus =
  | { readonly state: "unloaded" | "loading" | "loaded" }
  | { readonly state: "failed"; readonly error: string };

/** One row of `duckdb_extensions() WHERE loaded`, for the status tooltip. The
 *  community slot for a DuckDB version can be REBUILT under us — the
 *  duckdb-wasm pin is what pins the extension build — so a schema drift has to
 *  be diagnosable from the UI without a console. */
export interface LoadedExtension {
  readonly name: string;
  readonly version: string;
}

export type DuckDBStatus =
  | { readonly state: "uninitialized" }
  | { readonly state: "initializing" }
  | {
      readonly state: "ready";
      readonly extensions: Readonly<Record<ExtensionName, ExtensionStatus>>;
      readonly loadedExtensions: ReadonlyArray<LoadedExtension>;
      /** `PRAGMA platform` — "wasm_eh" or "wasm_mvp". The two get DIFFERENT
       *  extension artefacts, so it belongs in any bug report. */
      readonly platform: string | null;
    }
  | { readonly state: "failed"; readonly error: string };

export interface QueryResult {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
}

/** A query's outcome WITH its failure message — the contract every new caller
 *  uses. {@link queryDuckDB} keeps its swallow-to-null shape for the two
 *  legacy callers (`stacItems`, the old stats path). */
export type QueryOutcome =
  | {
      readonly ok: true;
      readonly columns: string[];
      readonly rows: Record<string, unknown>[];
    }
  | { readonly ok: false; readonly message: string };

const NOT_RUNNING = "The analytics engine is not running.";

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let extensions: Record<ExtensionName, ExtensionStatus> = {
  cityjson: { state: "unloaded" },
  spatial: { state: "unloaded" },
  three_d: { state: "unloaded" },
};
let loadedExtensions: ReadonlyArray<LoadedExtension> = [];
let platform: string | null = null;
let status: DuckDBStatus = { state: "uninitialized" };
/**
 * The status is a VALUE React subscribes to, so every transition has to be
 * announced. `statusVersion` — not the status object — is what
 * `useSyncExternalStore` snapshots. In PRODUCTION either would do:
 * `getDuckDBStatus()` returns this module's STORED object, the same reference
 * between transitions. The counter is for the TESTS, where 24 of the 26 mock
 * factories spell the status as `vi.fn(() => ({ … }))` — a fresh literal per
 * call, which React rejects as an uncached snapshot. A number cannot be spelled
 * that way by accident.
 */
let statusVersion = 0;
const statusListeners = new Set<() => void>();

/** The ONE writer. Every `status = …` in this module goes through it. */
function setStatus(next: DuckDBStatus): void {
  status = next;
  statusVersion += 1;
  // Over a COPY, so this dispatch's membership is frozen: a listener that
  // subscribes or unsubscribes from inside its own notification changes who
  // hears the NEXT transition, never who hears the one in flight.
  for (const listener of Array.from(statusListeners)) {
    // Per listener, because a subscriber is an OBSERVER and this is engine
    // work. `setStatus` is called from `doInit` — the `initializing` publish
    // sits before its try — so an escaping exception would abort the boot with
    // the status stranded at `initializing`, and one thrown from the `failed`
    // publish would jump over the Worker terminate and the memo reset in the
    // catch, stranding a wasm heap no Retry could reach. It would also skip
    // every listener queued after the thrower.
    try {
      listener();
    } catch (error) {
      console.error("A DuckDB status listener threw:", error);
    }
  }
}

export function subscribeDuckDBStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getDuckDBStatusVersion(): number {
  return statusVersion;
}
let initPromise: Promise<void> | null = null;
/** One in-flight load per extension, so N concurrent `ensureExtension` calls
 *  cost one INSTALL. */
const extensionPromises = new Map<ExtensionName, Promise<boolean>>();

export function getDuckDBStatus(): DuckDBStatus {
  return status;
}

export function isExtensionLoaded(name: ExtensionName): boolean {
  return extensions[name].state === "loaded";
}

/** Publish the current extension map into the `ready` status object — the
 *  status is a VALUE React subscribes to, so a lazy load has to mint a new
 *  one rather than mutate the old. */
function publishReady(): void {
  setStatus({
    state: "ready",
    extensions: { ...extensions },
    loadedExtensions,
    platform,
  });
}

/** DuckDB's own first error line. Its messages are one useful line plus a
 *  `LINE 1: …` echo and a caret; the echo is the SQL we just sent and the
 *  caret is meaningless outside a terminal, so both are dropped. */
export function formatDuckDBError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const kept: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^LINE \d+:/.test(trimmed)) break;
    if (trimmed !== "") kept.push(trimmed);
  }
  const message = kept.join(" ");
  return message === "" ? "The query failed." : message;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/** `spatial` is a CORE extension — `INSTALL spatial FROM community` fails
 *  outright — while `cityjson` and `three_d` come from the community repo.
 *  Neither `spatial` nor `three_d` autoloads in wasm. */
function installStatement(name: ExtensionName): string {
  return name === "spatial"
    ? "INSTALL spatial"
    : `INSTALL ${name} FROM community`;
}

async function loadExtension(name: ExtensionName): Promise<boolean> {
  const connection = conn;
  if (!connection) return false;
  extensions = { ...extensions, [name]: { state: "loading" } };
  try {
    await connection.query(installStatement(name));
    await connection.query(`LOAD ${name}`);
    extensions = { ...extensions, [name]: { state: "loaded" } };
    return true;
  } catch (error) {
    const message = formatDuckDBError(error);
    extensions = { ...extensions, [name]: { state: "failed", error: message } };
    console.warn(`DuckDB extension "${name}" did not load:`, message);
    return false;
  }
}

/** `PRAGMA platform` — "wasm_eh" or "wasm_mvp". Which one a session got
 *  decides WHICH extension artefacts the community repo served it, so a
 *  schema-drift report is unactionable without it. Best effort. */
async function readPlatform(): Promise<string | null> {
  const connection = conn;
  if (!connection) return null;
  try {
    const result = await connection.query("PRAGMA platform");
    const value = result.getChild("platform")?.get(0);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** The extensions actually loaded, for the status tooltip. Best effort: a
 *  database that cannot answer this is still perfectly usable. */
async function readLoadedExtensions(): Promise<ReadonlyArray<LoadedExtension>> {
  const connection = conn;
  if (!connection) return [];
  try {
    const result = await connection.query(
      "SELECT extension_name, extension_version FROM duckdb_extensions() WHERE loaded",
    );
    const out: LoadedExtension[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const name = result.getChild("extension_name")?.get(i);
      const version = result.getChild("extension_version")?.get(i);
      if (typeof name === "string") {
        out.push({ name, version: typeof version === "string" ? version : "" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function doInit(): Promise<void> {
  setStatus({ state: "initializing" });

  // Held OUTSIDE the try so the catch can terminate it. A failed init used to
  // leave its Worker running — and `initDuckDB` clears its memo on failure, so
  // a Retry starts a SECOND one beside the zombie, each holding a wasm heap.
  let worker: Worker | null = null;

  try {
    // Bundles come from jsDelivr, not from our own dist/: the mvp wasm alone
    // is 38 MB, which is over Cloudflare Workers' 25 MiB per-asset limit —
    // self-hosting it made the app undeployable there. DuckDB analytics
    // already needs the network at runtime regardless (the cityjson
    // community extension below is fetched from DuckDB's CDN), and this
    // whole module degrades gracefully offline, so the CDN is not a new
    // point of failure. `selectBundle` picks eh over mvp where the browser
    // supports wasm exceptions; neither needs COOP/COEP.
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());

    // The worker script is cross-origin, which `new Worker(url)` forbids —
    // wrap it in a same-origin blob that importScripts the real one.
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      }),
    );
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const instance = new duckdb.AsyncDuckDB(logger, worker);
    await instance.instantiate(bundle.mainModule);

    db = instance;
    conn = await db.connect();

    // `cityjson` at init, because every layer table wants it. `spatial` and
    // `three_d` are lazy (`ensureExtension`): nothing in this feature needs
    // them, and `spatial` alone is a 23 MB download.
    await loadExtension("cityjson");
    platform = await readPlatform();
    loadedExtensions = await readLoadedExtensions();
    publishReady();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ state: "failed", error: message });
    // Kill the Worker BEFORE clearing the memo: the reset below is what makes
    // a Retry re-run this function, and a retry must not stack a second
    // 36 MB wasm heap beside one nobody can reach any more.
    worker?.terminate();
    db = null;
    conn = null;
    // RESET, so a Retry button can call `initDuckDB()` again rather than being
    // handed the same rejected-once memo forever.
    initPromise = null;
    console.error("DuckDB-wasm initialization failed:", err);
  }
}

/**
 * Initialize DuckDB-wasm. Safe to call multiple times — returns the same
 * promise while initializing or once initialized. A FAILED init clears the
 * memo, so the next call genuinely retries.
 */
export function initDuckDB(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

/**
 * Load `spatial` or `three_d` on demand, memoised per extension.
 *
 * Nothing in the query/filter/export features needs either one; they are made
 * loadable for the analysis features to come, and a failed load is a `false`
 * plus a recorded status, never a throw.
 */
export async function ensureExtension(name: ExtensionName): Promise<boolean> {
  if (extensions[name].state === "loaded") return true;
  const existing = extensionPromises.get(name);
  if (existing) return await existing;
  const promise = (async () => {
    // The "loading" state has to reach the catalogue's chip (spec §5), and
    // `loadExtension` cannot announce it itself — `doInit` calls that function
    // for `cityjson` before the status is `ready` at all, so a publish inside
    // it would announce a half-built engine.
    //
    // Guarded on the SAME condition `loadExtension` bails on. Without a
    // connection that function returns `false` before writing anything, so a
    // pre-boot call is a no-op — and a `loading` written here would have
    // nothing to move it: the boot's own `publishReady()` would publish it and
    // the chip would read "Loading…" for the rest of the session.
    if (conn !== null) {
      extensions = { ...extensions, [name]: { state: "loading" } };
      if (status.state === "ready") publishReady();
    }
    const ok = await loadExtension(name);
    // A successful lazy load changes what `duckdb_extensions()` reports, and
    // THAT list is the status tooltip — without this re-read the tooltip goes
    // on claiming the extension the user just triggered is absent.
    if (ok) loadedExtensions = await readLoadedExtensions();
    if (status.state === "ready") publishReady();
    return ok;
  })().finally(() => extensionPromises.delete(name));
  extensionPromises.set(name, promise);
  return await promise;
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
    return toRows(await conn.query(sql));
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
 * CALLING THIS TWICE WITH THE SAME `fileName` AND `buffer` IS SAFE, and it
 * takes both of the things below to make it so:
 *
 * 1. every call REGISTERS `fileName` again before reading it, and registering
 *    a name that already exists REPLACES its bytes (probed). The `finally`
 *    drop is hygiene — nothing of ours is left in the VFS — not what makes the
 *    reuse safe, and a `dropFile` failure still never discards a result
 *    already produced. What is NOT safe is READING a dropped name without
 *    re-registering it first: see {@link registerBuffer}; and
 * 2. the bytes are COPIED with `.slice()` before registration, because
 *    duckdb-wasm's async bindings post the buffer to their worker in the
 *    TRANSFER list (`postTask(task, [buffer.buffer])`), which DETACHES the
 *    caller's ArrayBuffer — the whole backing buffer, even for a partial
 *    view. Without the copy, a second call with the same `Uint8Array` throws
 *    `DataCloneError` on a detached buffer and returns null, which reads as
 *    "the file is unreadable" when the file was fine. `.slice()` and not
 *    `new Uint8Array(buffer)`: the latter aliases the same memory and is
 *    detached right along with it.
 */
export async function queryParquetBuffer(
  fileName: string,
  buffer: Uint8Array,
  sql: string,
): Promise<QueryResult | null> {
  if (!db || !conn || status.state !== "ready") return null;

  const database = db;
  try {
    await database.registerFileBuffer(fileName, buffer.slice());
  } catch {
    return null;
  }

  try {
    return await queryDuckDB(sql);
  } finally {
    await database.dropFile(fileName).catch(() => {});
  }
}

/** One Arrow table as plain rows. BigInt is narrowed to Number because a
 *  `COUNT(*)` comes back as one and `JSON.stringify` throws on it. */
function toRows(
  result: Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>,
): QueryResult {
  const columns = result.schema.fields.map((f) => f.name);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const val = result.getChild(col)?.get(i);
      row[col] = typeof val === "bigint" ? Number(val) : val;
    }
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * Run `sql` and report EITHER rows OR the reason it failed.
 *
 * The whole point next to {@link queryDuckDB}: a filter bar that shows
 * "Binder Error: Referenced column \"nope\" not found!" teaches the user what
 * to fix, where a null teaches nothing. All new code uses this.
 */
export async function runQuery(sql: string): Promise<QueryOutcome> {
  if (!conn || status.state !== "ready") {
    return { ok: false, message: NOT_RUNNING };
  }
  try {
    const { columns, rows } = toRows(await conn.query(sql));
    return { ok: true, columns, rows };
  } catch (error) {
    return { ok: false, message: formatDuckDBError(error) };
  }
}

/** {@link runQuery} for a statement run for EFFECT (CREATE, DROP, COPY,
 *  PRAGMA). Same outcome shape, so a caller can report the message. */
export async function ddl(sql: string): Promise<QueryOutcome> {
  return await runQuery(sql);
}

/**
 * Register `bytes` in DuckDB's virtual file system under `name`.
 *
 * **CONSUMES `bytes`.** The array is handed over AS IS, deliberately not
 * copied: duckdb-wasm's async bindings post the buffer to their worker in the
 * TRANSFER list (`postTask(task, [buffer.buffer])`), which DETACHES the
 * caller's `ArrayBuffer` — the whole backing buffer, even for a partial view.
 * After this call the caller's array has length 0 and must never be read,
 * re-registered or handed to a second consumer; a caller that needs the bytes
 * again must obtain a FRESH array (see `SourceProvider`). That is the intent,
 * not a hazard to route around: a layer's source bytes are released from the
 * JS heap the moment the table is materialised, which is the whole reason the
 * VFS copy is dropped straight afterwards.
 *
 * `queryParquetBuffer` `.slice()`s instead, because ITS callers deliberately
 * re-use one buffer across two queries — see its own doc comment.
 *
 * Re-REGISTERING a name is fine: the new bytes replace whatever that name held
 * and read back correctly (probed) — which is exactly what makes
 * {@link queryParquetBuffer}'s repeated use of one name safe. READING a name
 * after {@link dropBuffer} is not: a dropped name still RESOLVES, to empty or
 * garbage bytes, so the query fails with a misleading parse error instead of
 * "no such file". Callers therefore mint a fresh name per load and never read
 * a name they have dropped.
 */
export async function registerBuffer(
  name: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!db || status.state !== "ready") return false;
  try {
    await db.registerFileBuffer(name, bytes);
    return true;
  } catch (error) {
    console.warn(`DuckDB could not register "${name}":`, error);
    return false;
  }
}

/** Drop a VFS entry. Never throws: a drop that fails must not discard a
 *  result already produced, and the name is dead either way. */
export async function dropBuffer(name: string): Promise<void> {
  if (!db) return;
  await db.dropFile(name).catch(() => {});
}

/** A file DuckDB wrote (a `COPY` target, a `cityparquet_write` output) as
 *  bytes, or null when there is no database or no such file. */
export async function readFile(name: string): Promise<Uint8Array | null> {
  if (!db || status.state !== "ready") return null;
  try {
    return await db.copyFileToBuffer(name);
  } catch (error) {
    console.warn(`DuckDB could not read "${name}":`, error);
    return null;
  }
}
