/**
 * One DuckDB table per city layer: the registry, the build, and the Zustand
 * mirror React subscribes to.
 *
 * WHY BYTES AND NOT A URL. `read_cityjson('https://…')` has never been
 * exercised in wasm and is CORS-dependent; the loader already HOLDS the
 * decoded bytes for every URL layer, so handing DuckDB those means the file is
 * never downloaded twice and there is no second failure mode to diagnose.
 *
 * WHY THE SOURCE IS DROPPED. Right after the table is materialised the source
 * buffer leaves the VFS, so a layer costs the ATTRIBUTE table and nothing
 * else: dropping the geometry/material/texture/template columns already cuts
 * that 2.45x (13.1 vs 32.1 MiB for Delft's 2231 rows), and the WKB is never
 * materialised for browsing at all. Probed under Node with the wasm_eh binary:
 * a materialised table survives `dropFile` of its source intact, while the
 * dropped NAME resolves to zero bytes forever — hence names from a module
 * counter that are never reused. An export re-registers the bytes under a
 * FRESH name through the entry's {@link SourceProvider}.
 *
 * The queue and the registry are plain module state; only the per-layer STATE
 * is a store, because that is the only part React renders.
 */

import { create } from "zustand";
import type { CityModel } from "../domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import {
  classifyColumnType,
  isDroppedColumn,
  lodsFromColumnNames,
  type ColumnInfo,
  type LodColumn,
} from "./columnKind";
import {
  ddl as sendDdl,
  dropBuffer as sendDropBuffer,
  getDuckDBStatus,
  getEngineGeneration,
  initDuckDB as bootEngine,
  onEngineDeath,
  registerBuffer as sendRegisterBuffer,
  runQuery as sendQuery,
  type QueryOutcome,
} from "./duckdb";
import { EngineDeadError, racedWithDeath } from "./engineAwait";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
  flatRowsFromRecords,
  FLAT_PREFIX_COLUMNS,
  type FlatRow,
} from "./layerRows";
import {
  buildCountSql,
  quoteIdent,
  quoteLiteral,
  READ_JSON_OPTIONS,
} from "./sql";

/**
 * EVERY engine await in this module, raced against the engine's DEATH.
 *
 * The names shadow `duckdb.ts`'s deliberately, so a call site cannot reach the
 * unraced primitive by accident and a new one gets the protection for free.
 *
 * WHY IT IS NEEDED HERE ABOVE ALL. duckdb-wasm drops the promises of the
 * requests that were in flight when its worker died — WITHOUT rejecting them —
 * so a `CREATE`, a `DESCRIBE`, a register or a boot caught by the death never
 * settles. A build sitting on one holds the ONE FIFO these builds share with
 * every processing run, for the life of the page: the entry stays `building`
 * under a spinner nothing will stop, and every later build and run waits behind
 * a task that can never finish. The race turns that into an
 * {@link EngineDeadError}, which the build reads as "the database is gone" —
 * `enqueueLayerTable`'s abandonment — rather than as a failure of the statement.
 *
 * Awaits STARTED after the death need no protection and get none: `onEngineDeath`
 * fires once per engine, and by then every primitive below answers immediately
 * on its own (no `db`, and a status that is not `ready`).
 */
function runQuery(sql: string): Promise<QueryOutcome> {
  return racedWithDeath(sendQuery(sql));
}

function ddl(sql: string): Promise<QueryOutcome> {
  return racedWithDeath(sendDdl(sql));
}

function registerBuffer(name: string, bytes: Uint8Array): Promise<boolean> {
  return racedWithDeath(sendRegisterBuffer(name, bytes));
}

function dropBuffer(name: string): Promise<void> {
  return racedWithDeath(sendDropBuffer(name));
}

function initDuckDB(): Promise<void> {
  return racedWithDeath(bootEngine());
}

/**
 * Re-registers a layer's source bytes for an export.
 *
 * DECODED bytes in every case — gunzipped when the payload carried gzip magic,
 * passed straight through when it did not — because that is exactly what the
 * table was built from, and no DuckDB reader gunzips anything, by name or by
 * magic. A dropped `File` is a REFERENCE, not a copy, so re-reading it from
 * disk is free; a URL is re-fetched through the same gunzip-aware client (the
 * browser cache usually serves it).
 *
 * Every call returns a FRESH array. `registerBuffer` CONSUMES what it is given
 * (the worker transfer detaches it), and a provider may be called more than
 * once — two exports of one layer, a retry after a failed write, or
 * {@link retryEngine} reviving a source parked while the engine was down.
 *
 * Lives in the registry, never in the layer store — a function is not snapshot
 * state, which is also why a layer restored from a snapshot has to re-obtain
 * its bytes rather than inherit them.
 */
export type SourceProvider = () => Promise<Uint8Array>;

/**
 * The VFS spellings a reader-backed layer may ask for.
 *
 * A CLOSED union, not a free string: the name is interpolated into the SQL
 * `read_cityjson('…')` argument, so an unconstrained extension would be an
 * injection point through a value the loader assembles from a URL. It is ALSO
 * passed through {@link quoteLiteral} at the call site — the type stops a
 * nonsense spelling reaching the SQL, the quoting stops a quote in one from
 * ending the literal, and neither alone is the whole answer.
 */
export type ReaderExtension = "city.json" | "city.jsonl";

export type LayerTableSource =
  | {
      readonly kind: "bytes";
      /**
       * CONSUMED by the build: `registerBuffer` transfers this array to the
       * DuckDB worker and DETACHES it, so the caller hands over an array it
       * will not read again — never one it also keeps.
       *
       * Which makes this source object SINGLE-USE. The registry never retains
       * it (only the `provider`), and a re-enqueue must supply a fresh one —
       * `refreshStreamingTable` builds a `resident` source, and the export
       * calls the provider. Re-submitting the same `bytes` source twice
       * registers a detached, zero-length array and produces a table with no
       * rows and no error.
       */
      readonly bytes: Uint8Array;
      readonly reader: "read_cityjson" | "read_cityjsonseq";
      /** The VFS file extension. */
      readonly extension: ReaderExtension;
      /** `null` when the bytes cannot be obtained again — the table is still
       *  built and browsable, but a CityParquet export needs the source and is
       *  refused with that reason. Each call returns a FRESH array, because
       *  registering one consumes it and an export may re-register. */
      readonly provider: SourceProvider | null;
    }
  | { readonly kind: "model"; readonly model: CityModel }
  | {
      /** A THUNK, not an array: a streaming layer re-enqueues as cells land,
       *  and the records have to be read at BUILD time, not at enqueue time. */
      readonly kind: "resident";
      readonly records: () => ReadonlyArray<ResidentObjectRecord>;
    };

export interface LayerTable {
  /** "layer_3" — a module counter, never the layer id (which is a UUID and
   *  not a legal bare identifier). */
  readonly table: string;
  readonly sourceName: string | null;
  readonly source: SourceProvider | null;
  readonly reader: "read_cityjson" | "read_cityjsonseq" | null;
  /**
   * The VFS spelling the reader expects, or null for a fallback table.
   *
   * It is reconstructible today only by parsing `sourceName`
   * (`` `${table}.${extension}` ``), which is exactly the fragility
   * `export.ts` routed around by making its CALLER pass `sourceExtension`
   * (`CityParquetExportRequest`). Stated once, here, so a second reader of the
   * source does not have to guess.
   */
  readonly extension: ReaderExtension | null;
  /**
   * The source's size in bytes at BUILD time, or null when there was none.
   *
   * Captured before `registerBuffer` detaches the array, because after that
   * the number exists nowhere: spec §6's workload note ("Re-reads a 180 MB
   * source…") has to be shown BEFORE any run, and re-obtaining the bytes to
   * measure them is the very cost the note warns about.
   */
  readonly sourceBytes: number | null;
  readonly columns: ReadonlyArray<ColumnInfo>;
  /** From the reader's own `geometry_lod*` names — each rung carries the label
   *  to SHOW and the suffix to BUILD A COLUMN NAME WITH, because the two are
   *  not interconvertible. `[]` for a fallback table. */
  readonly lods: ReadonlyArray<LodColumn>;
  /**
   * The FEATURE ROOT ids this table is restricted to — set only on a DERIVED
   * layer (§6, "What a derived layer is"), null on every ordinary one.
   *
   * Three things read the PARENT's source on this layer's behalf, and every
   * one of them must AND this filter in or the derived layer quietly reads its
   * parent whole: `readSource`'s reader `FROM` (Task 5), `resolveScope`'s
   * "all" (this task) and `buildCityParquetSourceSql`'s `where` (Task 24).
   * That is why it lives on the table and not inside `deriveLayer.ts`.
   */
  readonly sourceFeatureIds: ReadonlyArray<string> | null;
  /** `null` when the COUNT itself failed — the table exists and is browsable,
   *  but its size is UNKNOWN. Not 0: a zero would be shown as "0 rows" over a
   *  grid that then pages real data, which is worse than saying nothing. */
  readonly rowCount: number | null;
  /**
   * This "table" is a VIEW over the FILE (ruling R-B′), not a materialised
   * copy of anything.
   *
   * Three things follow, and each is a bug if it is missed. It cannot be STALE,
   * so nothing may rebuild it from the resident set — the whole point is that
   * it answers for objects the camera never delivered. It is retired with
   * `DROP VIEW`, not `DROP TABLE` (see {@link retire}). And its source
   * registration must outlive it, because every query re-reads the file.
   *
   * OPTIONAL, with `undefined` reading as "an ordinary materialised table":
   * the two builders below and `familyViews` all state it, and the fixtures of
   * three dozen tests do not have to.
   */
  readonly fileBacked?: boolean;
  /**
   * The CityParquet object family this table is of (R-A′'s family key), or
   * `null`/absent for a layer with one table.
   *
   * It is the second half of the registry key, and it is recorded ON the table
   * as well because a consumer that OWNS a table for the length of an operation
   * freezes `{layerId, familyKey, tableName}` and must be able to re-resolve
   * exactly the table it started with (R-C′).
   */
  readonly familyKey?: string | null;
  /**
   * The CRS the file's own `bbox` column is in (ruling R-G) — `"EPSG:6697"` for
   * a PLATEAU package, whose bbox is DEGREES.
   *
   * Carried, never converted: reprojecting in SQL was rejected, so the tools
   * that need metric bounds read this and refuse the layer instead of
   * silently measuring degrees as metres.
   */
  readonly sourceCrs?: string | null;
}

export type LayerTableState =
  | { readonly state: "queued" }
  | { readonly state: "building" }
  | {
      readonly state: "ready";
      readonly info: LayerTable;
      /**
       * A REBUILD is in flight over a table that still works.
       *
       * A streaming layer rebuilds on every settle, and the OLD table is
       * perfectly readable while the new one is built: dropping to "building"
       * would blank the grid several times a pan, and a rebuild that then
       * FAILED would leave a layer that had working analytics with none at
       * all. So the entry stays `ready` with the previous `info`, and only
       * swaps once the replacement exists.
       */
      readonly rebuilding?: boolean;
    }
  | { readonly state: "failed"; readonly message: string };

export interface LayerTableStoreState {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  /** The table panel is open, so a streaming layer's table is worth
   *  rebuilding as cells land. `layerTables` cannot see the UI, so the panel
   *  tells it. An export does NOT set a flag here: it forces ONE rebuild when
   *  its dialog opens (`refreshStreamingTable`) and then wants the table to
   *  hold still, not to move under the write. */
  readonly tablePanelOpen: boolean;
}

export interface LayerTableStoreActions {
  setTablePanelOpen: (open: boolean) => void;
}

export const useLayerTableStore = create<
  LayerTableStoreState & LayerTableStoreActions
>((set) => ({
  tables: {},
  tablePanelOpen: false,
  setTablePanelOpen: (open) => set({ tablePanelOpen: open }),
}));

function setState(key: string, state: LayerTableState | null): void {
  useLayerTableStore.setState((s) => {
    const tables = { ...s.tables };
    if (state === null) delete tables[key];
    else tables[key] = state;
    return { tables };
  });
}

// ---------------------------------------------------------------------------
// The composite key (ruling R-C′)
// ---------------------------------------------------------------------------

/**
 * The separator between a layer id and a family key.
 *
 * A layer id is a UUID, so it never contains this; a family key comes from a
 * manifest asset key or an href basename, which this app does not get to
 * constrain — hence {@link parseTableKey} splits at the FIRST occurrence and
 * takes everything after it as the family.
 */
const KEY_SEPARATOR = "::";

/**
 * The registry/store key for one table.
 *
 * `family === null` is the BARE layer id, deliberately: every single-table
 * layer in the app — static, streaming, derived — keeps the key it has always
 * had, so every consumer that looks a table up by layer id keeps working and
 * no snapshot, no query state and no frozen run changes meaning.
 */
export function layerTableKey(layerId: string, family: string | null): string {
  return family === null ? layerId : `${layerId}${KEY_SEPARATOR}${family}`;
}

/**
 * The layer id and family a key stands for.
 *
 * Every site that ENUMERATES the registry or the store has to go through this:
 * a key is not a layer id, and the ones that used to be interchangeable
 * (`mapFilterSync`'s reconcile, the run queue's stale watcher) would otherwise
 * ask the layer store about `"<uuid>::building"` and quietly find nothing.
 */
export function parseTableKey(key: string): {
  layerId: string;
  family: string | null;
} {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at === -1) return { layerId: key, family: null };
  return {
    layerId: key.slice(0, at),
    family: key.slice(at + KEY_SEPARATOR.length),
  };
}

// ---------------------------------------------------------------------------
// Module state: the registry, the counter and the one FIFO queue
// ---------------------------------------------------------------------------

const registry = new Map<string, LayerTable>();
/**
 * Per-layer cancellation, by SEQUENCE rather than by a flag.
 *
 * Every enqueue and every drop takes the next number off `seqCounter`, and a
 * queued build runs only if its own number is HIGHER than the last drop
 * recorded for its layer. A boolean set cannot express that: it also cancels
 * builds enqueued AFTER the drop, and clearing the flag at enqueue time —
 * which is what makes re-adding the same id work at all — silently un-cancels
 * a build the drop was meant to kill. The question is "which came first", so
 * the answer has to be a number.
 */
const cancelBefore = new Map<string, number>();
/**
 * The sequence number of the most recent ENQUEUE for a layer.
 *
 * Read by `dropLayerTable`'s queued task, which has to decide whether the
 * store entry it is about to clear belongs to the build it superseded or to a
 * newer one that has since claimed the same id (a remove-then-re-add of the
 * same file). Clearing the newer one's entry would blank a table that is
 * perfectly alive.
 */
const lastEnqueueSeq = new Map<string, number>();

/**
 * A source parked for {@link retryEngine}, with a reader layer's ARRAY LEFT
 * BEHIND whenever a provider can mint a fresh one.
 *
 * The array is the whole point of the distinction: a dropped 200 MB `.city.json`
 * is already on the JS heap twice while the engine boots (the raw bytes and
 * the parsed `CityModel`), and pinning a third reference in a module-level map
 * for an engine that may never come up is how a tab dies of memory rather than
 * of a message. A `provider` re-reads the `File` (a reference, not a copy) or
 * re-fetches the URL, so parking the FUNCTION costs nothing and yields a fresh,
 * un-detached array at retry time.
 *
 * Raw parking survives only for the case with no way back: a `bytes` source
 * whose provider is `null`, and the `model`/`resident` sources, which are
 * references to objects the layer store already holds.
 */
type PendingSource =
  | {
      readonly kind: "reader";
      readonly reader: "read_cityjson" | "read_cityjsonseq";
      readonly extension: ReaderExtension;
      readonly provider: SourceProvider;
    }
  | { readonly kind: "raw"; readonly source: LayerTableSource };

/**
 * Sources whose build was refused because the ENGINE was not running.
 *
 * DuckDB takes ~5 s to come up (a 36 MB wasm module plus a 3.5 s `LOAD
 * cityjson`), and the most common first layer of a session lands inside that
 * window: a snapshot restored at boot, a share link, a file dropped on the
 * landing page. Without this that layer's table fails PERMANENTLY, and the
 * only way back is to remove and re-add the layer — which nobody would guess.
 */
const pendingSources = new Map<string, PendingSource>();
/** The message the engine itself uses for a query it cannot run. Repeated
 *  rather than imported because `duckdb.ts` keeps it private — but it must
 *  READ the same, or the panel says two different things about one cause. */
const ENGINE_NOT_RUNNING = "The analytics engine is not running.";
/** Spec §6.1's sentence for a table whose database stopped existing. The same
 *  words the run queue puts on a run the death took. */
const ENGINE_STOPPED = "Analytics engine stopped";
let seqCounter = 0;
let counter = 0;
let chain: Promise<void> = Promise.resolve();

/** Park a source that has NOT yet been handed to DuckDB, so its `bytes` (if
 *  any) are still intact and raw parking is a valid fallback. */
function parkIntact(source: LayerTableSource): PendingSource {
  if (source.kind === "bytes" && source.provider !== null) {
    return {
      kind: "reader",
      reader: source.reader,
      extension: source.extension,
      provider: source.provider,
    };
  }
  return { kind: "raw", source };
}

/**
 * Park a source whose `bytes` may already have been CONSUMED — the engine died
 * part-way through a build. `null` when there is no way to replay it: a
 * detached array would register as zero bytes and build an empty table with no
 * error at all, which is strictly worse than an honest failure.
 */
function parkConsumed(source: LayerTableSource): PendingSource | null {
  if (source.kind !== "bytes") return { kind: "raw", source };
  return source.provider === null
    ? null
    : {
        kind: "reader",
        reader: source.reader,
        extension: source.extension,
        provider: source.provider,
      };
}

/**
 * The entry to park AGAIN after a retry build that did not land — `null` when
 * the source cannot be replayed.
 *
 * Routed through {@link parkConsumed} rather than re-using the entry blindly,
 * because by this point the build HAS run: a `raw` entry wrapping a `bytes`
 * source has had its array handed to `registerBuffer`, which detaches it. Put
 * back as it is, the next Retry would register zero bytes and build an empty
 * table with no error anywhere. A provider-backed entry has no such problem —
 * the provider is exactly what mints a fresh array.
 */
function reparkable(entry: PendingSource): PendingSource | null {
  return entry.kind === "reader" ? entry : parkConsumed(entry.source);
}

/** The source a parked entry stands for, calling the provider for a FRESH
 *  array. May reject — a deleted file, a URL that has since gone. */
async function reviveSource(pending: PendingSource): Promise<LayerTableSource> {
  if (pending.kind === "raw") return pending.source;
  return {
    kind: "bytes",
    bytes: await pending.provider(),
    reader: pending.reader,
    extension: pending.extension,
    provider: pending.provider,
  };
}

/**
 * One layer's table, by family — the bare one when no family is named.
 *
 * The default keeps every existing call site (`runQueue`, the export, the
 * stats tab) reading exactly the table it read before.
 */
export function getLayerTable(
  layerId: string,
  family: string | null = null,
): LayerTable | null {
  return registry.get(layerTableKey(layerId, family)) ?? null;
}

/** One resolved table, with the key and family that address it again later. */
export interface ResolvedLayerTable {
  readonly key: string;
  readonly layerId: string;
  readonly familyKey: string | null;
  readonly info: LayerTable;
}

/**
 * The table a consumer that knows nothing about families should use for
 * `layerId` — and the key it must FREEZE if it is going to own it (R-C′).
 *
 * FILE-BACKED FIRST, then the bare table. A streaming layer is given a resident
 * table by the lifecycle as it is added, before any family view exists, so for
 * part of a CityParquet layer's life both exist — and the view is strictly
 * better data: it answers for the whole file rather than for whatever the
 * camera has delivered. First registered wins among several families, which is
 * manifest order, so the default lands on Building for a PLATEAU package.
 *
 * A resolver is deliberately NOT the whole answer to R-C′: a consumer that
 * re-resolves mid-operation would retarget when the user switches family, which
 * is why the owners freeze the triple this returns rather than calling again.
 */
export function resolveActiveTable(
  layerId: string,
  /**
   * The family the user is actually looking at (`familyStore`'s `active`), when
   * the caller knows it.
   *
   * It wins over the file-backed scan below, which is only a FALLBACK ordering —
   * "first registered", i.e. manifest order — and would aim a run at Building
   * while the table panel showed Bridge. `null`/absent keeps the old answer for
   * every caller that has no family to offer.
   */
  preferFamily: string | null = null,
): ResolvedLayerTable | null {
  if (preferFamily !== null) {
    const key = layerTableKey(layerId, preferFamily);
    const info = registry.get(key);
    if (info !== undefined) {
      return { key, layerId, familyKey: preferFamily, info };
    }
  }
  const picked = pickActive(
    registry,
    layerId,
    (info) => info.fileBacked === true,
  );
  if (picked === null) return null;
  return {
    key: picked.key,
    layerId,
    familyKey: picked.familyKey,
    info: picked.value,
  };
}

/** One resolved STORE entry — the same choice, made over what React renders. */
export interface ResolvedLayerTableEntry {
  readonly key: string;
  readonly layerId: string;
  readonly familyKey: string | null;
  readonly entry: LayerTableState;
}

/**
 * {@link resolveActiveTable} over the STORE rather than the module registry.
 *
 * For the readers whose question is "what is the panel showing for this layer":
 * the two carry the same table in production — a build does `registry.set` and
 * `setState` back to back, with no await between them — but the store is the one
 * React subscribes to, and it is also the one that says `queued` / `building` /
 * `failed`, which the registry cannot express at all.
 */
export function resolveActiveTableEntry(
  layerId: string,
): ResolvedLayerTableEntry | null {
  const tables = useLayerTableStore.getState().tables;
  const picked = pickActive(
    Object.entries(tables),
    layerId,
    (entry) => entry.state === "ready" && entry.info.fileBacked === true,
  );
  if (picked === null) return null;
  return {
    key: picked.key,
    layerId,
    familyKey: picked.familyKey,
    entry: picked.value,
  };
}

/**
 * The one choice both resolvers make: a FILE-BACKED family first, else the bare
 * entry.
 *
 * Generic in the value so the registry (`LayerTable`) and the store
 * (`LayerTableState`) cannot drift apart on the rule — a difference between them
 * would show up as the grid and a processing run reading two different tables
 * for one layer.
 */
function pickActive<T>(
  entries: Iterable<readonly [string, T]>,
  layerId: string,
  isFileBacked: (value: T) => boolean,
): { key: string; familyKey: string | null; value: T } | null {
  let bare: { key: string; familyKey: string | null; value: T } | null = null;
  for (const [key, value] of entries) {
    const parsed = parseTableKey(key);
    if (parsed.layerId !== layerId) continue;
    const candidate = { key, familyKey: parsed.family, value };
    if (isFileBacked(value)) return candidate;
    if (parsed.family === null) bare = candidate;
  }
  return bare;
}

/**
 * Does any of `layerId`'s tables read straight from the file?
 *
 * The question the resident rebuilds ask before they run (Codex Critical): a
 * rebuild from the resident set over a layer whose table is file-backed would
 * replace whole-file answers with "whatever is on screen", several times a pan.
 */
export function hasFileBackedTable(layerId: string): boolean {
  for (const [key, info] of registry) {
    if (parseTableKey(key).layerId !== layerId) continue;
    if (info.fileBacked === true) return true;
  }
  return false;
}

/** Every key the module holds anything for under `layerId` — tables, parked
 *  sources and enqueues alike, plus the bare key, which a drop must always
 *  cover (a build still queued has no registry entry yet). */
function keysForLayer(layerId: string): string[] {
  const keys = new Set<string>([layerId]);
  for (const source of [
    registry.keys(),
    pendingSources.keys(),
    lastEnqueueSeq.keys(),
    // The STORE as well, which is the only one of the four that holds a FAILED
    // entry: an engine death condemns every family's table and clears the
    // registry, so without this a `<layerId>::<family>` card would sit in the
    // panel as "Analytics engine stopped" for a layer that has been removed.
    Object.keys(useLayerTableStore.getState().tables),
  ]) {
    for (const key of source) {
      if (parseTableKey(key).layerId === layerId) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Re-read one table's COLUMN LIST, in place.
 *
 * A processing run adds columns with `ALTER TABLE`, and after that the entry's
 * `columns` — a DESCRIBE from BUILD time — is a stale description of a table
 * that has more in it than it says. Two readers care: the grid, which renders
 * what the entry lists, and the NEXT run, whose "did this column already exist?"
 * test decides whether its Undo restores a value or drops the column outright.
 *
 * Deliberately NOT on the queue: this is called from INSIDE a queued run, and
 * enqueueing here would wait on the task that is waiting on it.
 *
 * Deliberately the SAME table name and a new `info` object: the processing
 * panel's stale watcher retires a layer's result cards when the table is
 * REBUILT, and it tells a rebuild from a re-describe by the name. `rebuilding`
 * is carried through untouched — a rebuild in flight is still in flight.
 */
export async function refreshLayerTableColumns(
  layerId: string,
  family: string | null = null,
): Promise<void> {
  // The run that wrote the column owns ONE table (R-C′), so the family it
  // froze is the one re-described — never "whatever is active now", which a
  // family switch mid-run would have moved.
  const key = layerTableKey(layerId, family);
  const entry = useLayerTableStore.getState().tables[key];
  const current = registry.get(key);
  if (!entry || entry.state !== "ready" || !current) return;
  const described = await runQuery(
    `DESCRIBE SELECT * FROM ${quoteIdent(current.table)}`,
  );
  // The write that prompted this has already committed. A DESCRIBE that failed
  // says nothing about it, so the entry keeps the description it had.
  if (!described.ok) return;
  // The registry is re-read AFTER the round trip: a rebuild that published a new
  // table while the DESCRIBE was in flight has already replaced this entry, and
  // writing `{ ...current, columns }` would put the old table's name back — the
  // grid would then query a table the rebuild dropped.
  const latest = useLayerTableStore.getState().tables[key];
  const held = registry.get(key);
  if (!latest || latest.state !== "ready" || held?.table !== current.table)
    return;
  const info: LayerTable = {
    ...held,
    columns: columnsFromDescribe(described.rows),
  };
  registry.set(key, info);
  setState(key, { ...latest, info });
}

/** Append `task` to the single queue. One queue, not one per layer, so a drop
 *  enqueued behind a create can never race the `CREATE` it must follow.
 *  GENERIC in the task's result, so a build can report its outcome to the
 *  caller that awaited it without a second channel. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  // The TAIL discards both the value and the rejection: `chain` is only ever a
  // "when is it my turn" marker, and a `.catch` alone would carry `T` forward
  // into the next task's link for no purpose.
  chain = next.then(
    () => {},
    () => {},
  );
  return next;
}

/** Public door onto the ONE queue for work that must not interleave with a
 *  table build: a processing run's ALTER/UPDATE on a layer table. */
export function runOnTableQueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(task);
}

/**
 * The next table name, from the SAME counter the builds use.
 *
 * A derived layer's table is created by the RUN, inside the run's own FIFO
 * slot — `enqueueLayerTable` goes through `enqueue` (see {@link dropLayerTable}
 * for the same reason), and enqueueing from inside the queue is a deadlock.
 * The name still has to come from here: a second counter would eventually mint
 * a `layer_N` an ordinary build is about to use, and the collision would be a
 * silent `CREATE OR REPLACE` over a live table.
 *
 * Call it from INSIDE a queued task only, like {@link adoptLayerTable}.
 */
export function nextTableName(): string {
  return `layer_${++counter}`;
}

/**
 * Adopt a table that was built OUTSIDE this module's build path.
 *
 * The derived layer's one door (Design decision (f)). It seeds the registry
 * and the store as `ready`, so nothing rebuilds it, nothing retries it, and
 * `getLayerTable` answers for it exactly as for a built table.
 *
 * Note what it does NOT do: no `enqueue`, no DESCRIBE, no source parking. The
 * caller has just created the table and knows its shape; a round trip here
 * would have to be awaited, and the publication is one SYNCHRONOUS step.
 */
export function adoptLayerTable(layerId: string, info: LayerTable): void {
  // The KEY comes from the table's own `familyKey`, so there is exactly one
  // door and a caller cannot publish a family table under the bare key (where
  // the resident rebuilds would then fight it) by forgetting an argument.
  const key = layerTableKey(layerId, info.familyKey ?? null);
  registry.set(key, info);
  setState(key, { state: "ready", info });
}

/**
 * Spec §6.1: the DuckDB worker died, so every table it held died with it.
 *
 * INVALIDATION, not recovery. The status bar's Retry reboots the engine but
 * rebuilds only what `retryEngine` parked in {@link pendingSources} — sources
 * refused while the engine was coming UP — so a table that was `ready` when
 * the worker crashed is simply not there any more. Left alone, its entry would
 * still read `ready` over a rebooted engine, and the catalogue would offer
 * tools that fail on a missing table; the grid would page rows from nothing.
 *
 * The REGISTRY is cleared beside the store, as every other failure site here
 * does: {@link getLayerTable} reads the registry, and that is what a run's
 * head-of-queue check asks.
 *
 * Nothing is re-parked: reviving these would be the rebuild this milestone
 * deliberately does not do, and the entries stay `failed` until the page is
 * reloaded.
 *
 * Keyed on the DEATH, {@link onEngineDeath}, and not on a status value or a
 * status transition. The value is no use — a boot that never came up publishes
 * the same `failed`, and it must not condemn tables an engine that worked
 * built. The `ready` → `failed` TRANSITION is no use either: a worker that dies
 * while the status is `initializing` publishes `failed` from there, so the
 * transition misses it, and every entry — including the `building` one of the
 * build that is awaiting that very boot — would be left looking alive.
 */
function invalidateTablesOnEngineDeath(): void {
  for (const [layerId, entry] of Object.entries(
    useLayerTableStore.getState().tables,
  )) {
    if (entry.state === "failed") continue;
    registry.delete(layerId);
    setState(layerId, { state: "failed", message: ENGINE_STOPPED });
  }
}

let disposeEngineDeathWatch: (() => void) | null = null;
/**
 * How many engines have DIED under this module, as announced by
 * {@link onEngineDeath}.
 *
 * Not {@link getEngineGeneration}, which a plain boot moves too: the question
 * a build enqueued before any engine existed has to ask is "has a database
 * been lost since I was enqueued", and the ordinary first build of a session
 * sees the generation move simply because the engine came up. Deaths only.
 */
let engineDeaths = 0;

/**
 * Installed at module load, deliberately: the invalidation is a fact about the
 * DATABASE, and must not depend on any feature having installed a watcher.
 *
 * A single live installer, the same shape as the run queue's watchers: a hot
 * reload must not leave the previous subscription behind.
 */
export function installEngineDeathWatch(): () => void {
  disposeEngineDeathWatch?.();
  let unsubscribe = (): void => {};
  const arm = () => {
    unsubscribe = onEngineDeath(() => {
      // `onEngineDeath` drops each listener AS it fires — one notification per
      // engine — so the next engine's death has to be subscribed to again.
      // Re-armed first, and from inside the dispatch, which is safe: the
      // dispatch iterates a copy, so this listener hears the NEXT death and
      // never the one in flight.
      arm();
      engineDeaths += 1;
      invalidateTablesOnEngineDeath();
    });
  };
  arm();
  const dispose = () => {
    unsubscribe();
    if (disposeEngineDeathWatch === dispose) disposeEngineDeathWatch = null;
  };
  disposeEngineDeathWatch = dispose;
  return dispose;
}

const stopEngineDeathWatch = installEngineDeathWatch();
// A module RE-EVALUATION gets a fresh `disposeEngineDeathWatch` (null), so the
// installer above cannot see — let alone dispose — the subscription the
// previous copy of this module left on `duckdb.ts`'s listener set. Only the
// old copy can, and this is where it is told to. Optional-chained because
// `import.meta.hot` exists in Vite's dev server and nowhere else (vitest, the
// production bundle).
import.meta.hot?.dispose(() => {
  stopEngineDeathWatch();
});

export function resetLayerTablesForTest(): void {
  // Re-installed, not merely reset: the subscription is a closure over a
  // listener a test's fake engine has already forgotten (a death drops every
  // waiter as it fires), so without this the next test's death is heard by
  // nobody.
  installEngineDeathWatch();
  engineDeaths = 0;
  registry.clear();
  cancelBefore.clear();
  lastEnqueueSeq.clear();
  pendingSources.clear();
  counter = 0;
  seqCounter = 0;
  chain = Promise.resolve();
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * A DESCRIBE's rows as this app's column list.
 *
 * Exported because `familyViews` builds its view from the same answer, and a
 * second reader of DuckDB's `column_name`/`column_type` pair would be a second
 * place for the CLASSIFICATION to drift — and the classification decides how
 * every cell travels from Arrow to the grid.
 */
export function columnsFromDescribe(
  rows: ReadonlyArray<Record<string, unknown>>,
): ColumnInfo[] {
  const out: ColumnInfo[] = [];
  for (const row of rows) {
    const name = row.column_name;
    const type = row.column_type;
    if (typeof name !== "string" || typeof type !== "string") continue;
    out.push({ name, type, kind: classifyColumnType(type) });
  }
  return out;
}

/**
 * One table's (or view's) row count, or `null` when the COUNT itself failed.
 *
 * Exported for `familyViews`: a view's count is the same question asked of the
 * same builder, and its death-race and its "not 0" rule must be the same too.
 */
export async function countTableRows(table: string): Promise<number | null> {
  const result = await runQuery(buildCountSql(table, null));
  // NOT 0. A count that could not run says nothing about the table's size, and
  // a table that exists with an unknown row count is a real, browsable state.
  if (!result.ok) return null;
  const n = result.rows[0]?.n;
  if (typeof n === "number") return n;
  const coerced = Number(n);
  return Number.isFinite(coerced) ? coerced : null;
}

class BuildError extends Error {}

/**
 * The VFS names a build has registered and NOT yet dropped.
 *
 * Each builder drops its own in a `finally` and deletes the name here as it
 * goes, so this set is empty on every path a builder controls. It exists for
 * the path none of them can: a throw between the register and the `finally`,
 * which would otherwise strand a multi-megabyte buffer in the VFS for the
 * lifetime of the page.
 */
type BuildScratch = Set<string>;

async function releaseBuffer(scratch: BuildScratch, name: string) {
  await dropBuffer(name);
  scratch.delete(name);
}

async function buildFromReader(
  table: string,
  source: Extract<LayerTableSource, { kind: "bytes" }>,
  scratch: BuildScratch,
): Promise<LayerTable> {
  const sourceName = `${table}.${source.extension}`;
  // BEFORE the register: `registerBuffer` transfers the array to the worker and
  // DETACHES it, after which `byteLength` is 0.
  const sourceBytes = source.bytes.byteLength;
  const registered = await registerBuffer(sourceName, source.bytes);
  if (!registered) {
    throw new BuildError("The source bytes could not be handed to DuckDB.");
  }
  scratch.add(sourceName);
  const from = `${source.reader}(${quoteLiteral(sourceName)})`;
  try {
    const described = await runQuery(`DESCRIBE SELECT * FROM ${from}`);
    if (!described.ok) throw new BuildError(described.message);

    const all = columnsFromDescribe(described.rows);
    const kept = all.filter((c) => !isDroppedColumn(c.name));
    if (kept.length === 0) {
      throw new BuildError("This file has no attribute columns to browse.");
    }
    const select = kept.map((c) => quoteIdent(c.name)).join(", ");
    const created = await ddl(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ${select} FROM ${from}`,
    );
    if (!created.ok) throw new BuildError(created.message);

    return {
      table,
      sourceName,
      source: source.provider,
      reader: source.reader,
      extension: source.extension,
      sourceBytes,
      columns: kept,
      // From ALL the described names, never the kept ones: the `geometry_lod*`
      // columns the ladder is read from are exactly the ones dropped.
      lods: lodsFromColumnNames(all.map((c) => c.name)),
      // An ordinary build holds the WHOLE source; only a derived layer's
      // adopted table carries a cut (`adoptLayerTable`).
      sourceFeatureIds: null,
      rowCount: await countTableRows(table),
      // MATERIALISED, and the bare key of its layer: only `familyViews` builds
      // a view, and only over a family. Stated rather than left `undefined` so
      // the two production builders are the documentation of the default.
      fileBacked: false,
      familyKey: null,
      sourceCrs: null,
    };
  } finally {
    // ALWAYS, success or not: the table (if it was made) survives this, and a
    // failed build must not leave a multi-megabyte buffer in the VFS.
    await releaseBuffer(scratch, sourceName);
  }
}

/**
 * The flat-fallback columns' declared types, keyed by the names
 * {@link FLAT_PREFIX_COLUMNS} publishes — which is where the NAMES come from,
 * so an empty table cannot drift out of agreement with the rows a populated
 * one is built from.
 */
const FLAT_COLUMN_TYPES: Readonly<Record<string, string>> = {
  id: "VARCHAR",
  feature_id: "VARCHAR",
  object_type: "VARCHAR",
  parents: "VARCHAR[]",
  children: "VARCHAR[]",
  // The reader's own extent struct, field for field (spec §7.4). DOUBLE, not
  // whatever the rows infer to: integer coordinates read back as
  // STRUCT(xmin BIGINT, ...) and an all-NULL bbox as JSON — and the tools that
  // read `"bbox"."zmin"` must see ONE type on every layer kind.
  bbox: "STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)",
};

/** The columns an empty fallback table is declared with — the vocabulary every
 *  other layer publishes, so a streaming layer with no cells yet still has a
 *  browsable (empty) table rather than a failure. */
const EMPTY_FALLBACK_DDL = `(${FLAT_PREFIX_COLUMNS.map(
  (name) => `${quoteIdent(name)} ${FLAT_COLUMN_TYPES[name] ?? "VARCHAR"}`,
).join(", ")})`;

async function buildFromRows(
  table: string,
  rows: ReadonlyArray<FlatRow>,
  scratch: BuildScratch,
): Promise<LayerTable> {
  let sourceName: string | null = null;
  try {
    if (rows.length === 0) {
      const created = await ddl(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} ${EMPTY_FALLBACK_DDL}`,
      );
      if (!created.ok) throw new BuildError(created.message);
    } else {
      sourceName = `${table}.json`;
      const ok = await registerBuffer(sourceName, encodeRowsAsJson(rows));
      if (!ok) {
        throw new BuildError("The layer's rows could not be handed to DuckDB.");
      }
      scratch.add(sourceName);
      const created = await ddl(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_json_auto(${quoteLiteral(sourceName)}, ${READ_JSON_OPTIONS})`,
      );
      if (!created.ok) throw new BuildError(created.message);

      // EVERY fixed column is forced to its declared type, because
      // `read_json_auto` infers from the DATA and gets two of them wrong in
      // ways that break different things (both measured, DuckDB 1.5.5):
      //
      //  - a layer of nothing but root objects has `parents` NULL in every row,
      //    which it types as JSON rather than VARCHAR[]. A JSON column
      //    classifies `castText` instead of `nested`, so the filter bar offers
      //    it comparisons it cannot honour and `parents IS NULL` stops meaning
      //    the same thing on the two kinds of table.
      //  - a DATE-SHAPED id types as DATE (`"2024-01-01"` → DATE, measured),
      //    and the map sync then reads back epoch-millisecond strings that
      //    match no key in the model. The same hazard is BIGINT for a numeric
      //    id. `id`, `feature_id` and `object_type` are strings in the domain
      //    and must be strings in the table.
      //
      // `ALTER COLUMN … TYPE` is the route that works, and it is what the
      // options above cannot do: a PARTIAL `columns = {...}` option DROPS every
      // column it does not name, which would throw the layer's attributes away.
      // The ALTER is a no-op when the inference was already right, and it
      // preserves the list values, the NULLs and the DATE's own spelling
      // (`2024-01-01`, not an epoch).
      for (const column of FLAT_PREFIX_COLUMNS) {
        const altered = await ddl(
          `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(column)} TYPE ${FLAT_COLUMN_TYPES[column]}`,
        );
        if (!altered.ok) throw new BuildError(altered.message);
      }
    }

    // DESCRIBE the TABLE, not the source: `read_json_auto` infers the types,
    // so the table is the only authority on what they came out as.
    const described = await runQuery(
      `DESCRIBE SELECT * FROM ${quoteIdent(table)}`,
    );
    if (!described.ok) throw new BuildError(described.message);

    return {
      table,
      sourceName: null,
      source: null,
      reader: null,
      // A fallback table has no reader and no source of its own: it was built
      // from ROWS, so there is nothing to re-read and nothing to measure.
      extension: null,
      sourceBytes: null,
      columns: columnsFromDescribe(described.rows),
      lods: [],
      sourceFeatureIds: null,
      rowCount: await countTableRows(table),
      fileBacked: false,
      familyKey: null,
      sourceCrs: null,
    };
  } finally {
    if (sourceName !== null) await releaseBuffer(scratch, sourceName);
  }
}

/**
 * Tear down whatever a FAILED build left behind.
 *
 * A build is several statements, and the `CREATE` is not the last of them: the
 * fallback route runs one `ALTER COLUMN` per fixed column and a `DESCRIBE`
 * after it, and any
 * of those can fail over a table that now exists. Without this the layer is
 * `failed` while a fully materialised table of its rows sits in the database
 * under a name nothing will ever use again — memory held for the life of the
 * page, invisible to every code path.
 *
 * `DROP TABLE IF EXISTS` is idempotent, so this is safe on the paths where the
 * `CREATE` itself never ran.
 */
async function discardHalfBuilt(
  table: string,
  scratch: BuildScratch,
): Promise<void> {
  await ddl(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
  for (const name of [...scratch]) await releaseBuffer(scratch, name);
}

/**
 * Try the engine again, and rebuild whatever failed only for want of it.
 *
 * Two callers, and both matter: the table panel's Retry button, and the app's
 * own boot — because the engine becoming ready three seconds after a layer
 * landed must not require the user to notice and act. A table that failed for
 * any OTHER reason (a bad file, a missing column) is not retried here; it
 * failed on its merits and re-running it would just fail again.
 */
export async function retryEngine(): Promise<void> {
  // `bootEngine`, NOT this module's raced `initDuckDB`: both callers are
  // `void retryEngine()` (`App.tsx`), so a rejection here would be an unhandled
  // one — and there is nothing for a death to release anyway. Every build this
  // function starts is raced on its own, inside the queue, where a release
  // actually frees something.
  //
  // STARTED FIRST, AND THE GENERATION READ AFTER. A boot bumps the counter
  // itself — `doInit` opens with `const gen = ++generation` (`duckdb.ts:405`),
  // which runs synchronously, before its first await and therefore before this
  // line — so the number below is the engine this retry is FOR, whether
  // `bootEngine()` started a new one or handed back the memo of a live one. A
  // number captured BEFORE the call would differ after every real boot, and
  // the retry would skip the rebuilds it exists for, leaving those layers
  // table-less for the session with no error anywhere.
  const booting = bootEngine();
  const engine = getEngineGeneration();
  await booting;
  // Only a LATER move — a worker that died inside the ~5 s boot window, or an
  // engine replaced under it — is a reason to stop. Rebuilding into an engine
  // that has already gone writes `ready` entries over the invalidation, which
  // is the exact state the catalogue would then offer tools against. The
  // builds below each check `engineGone()` for themselves, but the retry's own
  // `pendingSources.clear()` below them is not undone by that.
  //
  // FIRST of the two guards, deliberately: it returns before `pendingSources`
  // is cleared, so a death during the boot leaves every parked source parked
  // and the next Retry has something to retry — which is the whole reason
  // `retryEngine` keeps them.
  if (getEngineGeneration() !== engine) return;
  if (getDuckDBStatus().state !== "ready") return;
  // Snapshot and CLEAR first: each `enqueueLayerTable` below can put its layer
  // straight back in (a second failure), and iterating a map being written to
  // is how one layer gets retried forever.
  const pending = [...pendingSources.entries()];
  pendingSources.clear();
  // Everything issued from here on takes a HIGHER number, so a drop that lands
  // DURING the retry can be told apart from one that preceded it.
  const startSeq = seqCounter;
  /**
   * Has a DROP landed since this retry began?
   *
   * Asked at every point this function can resume, because a provider is
   * network-slow and a removal can arrive at any of them. It cannot be left to
   * `enqueueLayerTable`'s own `superseded()` check: that compares the build's
   * OWN sequence number, which is taken when the build is enqueued — AFTER the
   * drop — so it sits above the drop's `cancelBefore` and the build runs. The
   * layer would get a live table and a `ready` entry that nothing will ever
   * drop, because the drop's queued task has already been and gone (it found
   * an empty registry and retired nothing).
   */
  const droppedSince = (layerId: string): boolean =>
    (cancelBefore.get(layerId) ?? 0) > startSeq;

  await Promise.all(
    pending.map(async ([layerId, entry]) => {
      try {
        // A reader entry was parked WITHOUT its array; this is where the fresh
        // one is obtained, and where a provider whose fetch rejects throws.
        const source = await reviveSource(entry);
        if (droppedSince(layerId)) return;
        // SETTLES rather than throwing for a build that fails, so the decision
        // below is made on the OUTCOME — is there a table now? — and not on a
        // rejection. The catch is for what cannot settle: a provider that
        // rejects, or a source accessor that throws synchronously.
        await enqueueLayerTable(layerId, source);
      } catch (error) {
        // A provider that rejects for a layer that has since been REMOVED has
        // nothing to report: writing `failed` here would leave an entry for a
        // layer that no longer exists, and the drop's own task has already run.
        if (droppedSince(layerId)) return;
        const message =
          error instanceof Error
            ? error.message
            : "The layer's source could not be read again.";
        console.warn(`DuckDB retry for layer ${layerId} failed: ${message}`);
        // Never over a table that works — a rebuild whose source has gone
        // leaves the previous table exactly where it was.
        if (!registry.has(layerId))
          setState(layerId, { state: "failed", message });
      }
      // RE-PARK what did not land. `pendingSources` was cleared up front, so a
      // build that failed for a TRANSIENT reason — a provider whose fetch
      // blipped — would otherwise lose its source for good and leave the Retry
      // button with nothing to retry.
      //
      // Three conditions, and each rules out a different wrong answer. A table
      // in the registry succeeded. A layer already in `pendingSources` parked
      // ITSELF (a second "not running"), and re-parking would overwrite the
      // entry that build chose. And a `cancelBefore` past `startSeq` means a
      // DROP landed during this retry: re-parking then would resurrect a
      // removed layer on the next click.
      //
      // The ENTRY goes back, never the revived source — re-parking a revived
      // `bytes` source would pin the very array the parking exists to release —
      // and only when {@link reparkable} says it can be replayed at all.
      //
      // This does re-park a table that failed on its own merits (a bad file)
      // too. Deliberate: the alternative is matching on the failure MESSAGE,
      // which is DuckDB's wording and not a contract, and the cost of a wrong
      // guess here is one wasted rebuild per Retry click rather than a layer
      // that can never have a table again.
      const again = reparkable(entry);
      if (
        again !== null &&
        !registry.has(layerId) &&
        !pendingSources.has(layerId) &&
        !droppedSince(layerId)
      ) {
        pendingSources.set(layerId, again);
      }
    }),
  );

  // Everything this module cannot park. A CityParquet family's table is a VIEW
  // over a file DuckDB reads itself, so there are no bytes to replay and no
  // `pendingSources` entry for it — and since ruling S3 a streamed CityParquet
  // layer has no bare resident table to fall back on either, so without this the
  // engine's death would leave it table-less for the life of the page. Run LAST,
  // after the parked rebuilds, so a recovery that enqueues its own work queues
  // behind them rather than ahead.
  // The set itself: a hook that unregisters ITSELF mid-iteration is safe (a
  // deleted, not-yet-visited entry is simply skipped), and nothing registers a
  // hook from inside one — registration happens once, when App installs the
  // lifecycle.
  for (const hook of engineRetryHooks) {
    try {
      hook();
    } catch (error) {
      // One feature's recovery must not abandon the others', and the engine is
      // up either way — which is the part the caller acted on.
      console.warn("A DuckDB engine-retry recovery hook failed.", error);
    }
  }
}

/**
 * The recoveries `retryEngine` runs once the engine is back.
 *
 * A FEATURE-facing seam, because this module may not import `features/`: the
 * family store knows which layers have object families and which of their views
 * to rebuild, and nothing here can know that. Registered by
 * `installLayerTableLifecycle`, which App already installs and tears down once.
 */
const engineRetryHooks = new Set<() => void>();

/** Register a recovery for {@link retryEngine} to run after a successful boot;
 *  the returned function unregisters it. */
export function onEngineRetry(hook: () => void): () => void {
  engineRetryHooks.add(hook);
  return () => engineRetryHooks.delete(hook);
}

/**
 * `DROP TABLE` plus the VFS cleanup for one entry.
 *
 * Called from INSIDE the queue only — by a rebuild that has just published its
 * replacement, and by `dropLayerTable` (Task 14).
 */
async function retire(info: LayerTable): Promise<void> {
  // A VIEW is not a table, and `DROP TABLE IF EXISTS` over one is REFUSED:
  // DuckDB 1.5.5 answers "Existing object … is of type View, trying to drop
  // type Table" rather than treating it as a missing table (measured in
  // `tests/integration/duckdb/familyViews.test.ts`). That failure only reaches
  // the warning below, so the view would survive under a name nothing will ever
  // use again — holding its source registration open with it.
  const result = await ddl(
    info.fileBacked === true
      ? `DROP VIEW IF EXISTS ${quoteIdent(info.table)}`
      : `DROP TABLE IF EXISTS ${quoteIdent(info.table)}`,
  );
  if (!result.ok) {
    // Not thrown, and not surfaced: the caller has already decided this table
    // is gone, and the registry entry is going either way. But a DROP that
    // fails means the memory it was holding is STILL held under a name nothing
    // will ever use again, which is exactly the sort of thing that shows up
    // later as unexplained growth — so it must not vanish silently.
    console.warn(
      `DuckDB could not drop table ${info.table}: ${result.message}`,
    );
  }
  // Belt and braces: the build already dropped this on the way out, and a
  // second drop of an absent name is harmless.
  if (info.sourceName !== null) await dropBuffer(info.sourceName);
}

/**
 * What a settled build actually did.
 *
 * A REBUILD that fails is deliberately invisible in the store — the previous
 * table is still `ready` and still answers every query, which is right for the
 * grid (see {@link LayerTableState}) and WRONG for a caller that asked for a
 * refresh because it is about to write the result out. Reading the store back
 * cannot tell "the new table landed" from "the old one is still here", so the
 * build says so itself.
 */
export type LayerTableOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const OK: LayerTableOutcome = { ok: true };

/** A build a DROP overtook. Not a failure of the table — there is no layer to
 *  have one — but not a refresh anybody may act on either. */
/** A build whose engine died under it or before it ran. The entry it would
 *  have written belongs to the invalidation, which has already run. */
const ENGINE_DEAD: LayerTableOutcome = { ok: false, message: ENGINE_STOPPED };

const SUPERSEDED: LayerTableOutcome = {
  ok: false,
  message: "The layer was removed before its table was rebuilt.",
};

/**
 * Build (or rebuild) `layerId`'s table.
 *
 * Resolves when the build has SETTLED, success or failure — a DuckDB failure
 * is recorded on the entry and shown in the panel, never thrown into the
 * loader: an analytics engine that could not start must not fail a layer add.
 * The OUTCOME is returned for the callers that need to know (the export
 * dialog); every other caller ignores it exactly as before.
 */
export function enqueueLayerTable(
  layerId: string,
  source: LayerTableSource,
): Promise<LayerTableOutcome> {
  const seq = ++seqCounter;
  lastEnqueueSeq.set(layerId, seq);
  // A REBUILD keeps the table it is replacing ON SCREEN. Only a layer with no
  // table yet passes through "queued"/"building" — and one whose FIRST build is
  // already running stays "building", because a second enqueue behind it has
  // not put the layer back at the start of the queue for any purpose the panel
  // cares about, and "queued" over "building" reads as going backwards.
  const queuedOver = registry.get(layerId);
  const current = useLayerTableStore.getState().tables[layerId];
  setState(
    layerId,
    queuedOver
      ? { state: "ready", info: queuedOver, rebuilding: true }
      : current?.state === "building"
        ? current
        : { state: "queued" },
  );
  /** Has a drop superseded this build? Asked twice — once before it starts,
   *  once after it finishes — because a drop can arrive at any point in
   *  between. (`?? 0` is safe: `seqCounter` starts at 1.) */
  const superseded = () => seq <= (cancelBefore.get(layerId) ?? 0);
  /**
   * The engine this build belongs to, by {@link getEngineGeneration}.
   *
   * Taken at ENQUEUE when one is live, because a build enqueued against a
   * running engine is building a table in THAT database — and any replacement
   * in between, a crash or the Retry after one, means its table is gone.
   * `null` while no engine is up: a build enqueued before the boot (the
   * ordinary first layer of a session) has no database to be loyal to yet and
   * adopts whichever one `initDuckDB` brings up below.
   */
  let engine: number | null =
    getDuckDBStatus().state === "ready" ? getEngineGeneration() : null;
  /**
   * Is the engine this build adopted no longer the live one?
   *
   * Asked before EVERY state write, because what the build would write is a
   * claim about a database that is gone. The generation and not the invalidation
   * subscriber's own bookkeeping: that subscriber recognises `ready` → `failed`,
   * and a worker that dies while the status is `initializing` publishes
   * `failed` from there — a death it would miss, and the generation would not.
   */
  const engineGone = () => engine !== null && getEngineGeneration() !== engine;
  /**
   * Has an engine DIED since this build was enqueued?
   *
   * The question {@link engineGone} cannot answer while `engine` is null — a
   * build enqueued before the boot has nothing to compare — and the one that
   * decides what the not-ready branch below means: a death is "the database is
   * gone", which is §6.1's failure, while no death is "not up YET", which is
   * what the park and the Retry exist for.
   */
  const deathsAtEnqueue = engineDeaths;
  const diedSinceEnqueue = () => engineDeaths !== deathsAtEnqueue;
  /**
   * Has the INVALIDATION already condemned this entry?
   *
   * The source of truth for a build that is still QUEUED: it has no generation
   * of its own to compare, and the death that emptied the database wrote this
   * entry on the way past. A fresh enqueue always writes `queued`/`ready` over
   * the entry first (above), so this can only be the invalidation's own work.
   */
  const invalidated = () => {
    const current = useLayerTableStore.getState().tables[layerId];
    return current?.state === "failed" && current.message === ENGINE_STOPPED;
  };
  /**
   * Give the entry up with §6.1's sentence, and touch no engine doing it: a
   * dead worker answers no DROP, and the table is gone either way.
   *
   * WRITTEN HERE rather than left to the invalidation subscriber, which only
   * sees one of the ways an engine can go. Idempotent by VALUE, so the common
   * case — the subscriber wrote exactly this a moment ago — does not re-render
   * every reader of the store for no news.
   */
  const abandon = (): LayerTableOutcome => {
    registry.delete(layerId);
    // REMOVAL OWNS THE ENTRY. A layer dropped while this build was failing has
    // no entry to fail: writing one here would put a `failed` card back on the
    // very object React subscribes to, for a layer that is no longer in the
    // app, until the drop's own queued task clears it again. The registry is
    // still given up — the table went with the database either way — and the
    // engine is not touched, which is also why the catch's first abandonment
    // can skip its cleanup: a DROP for a corpse is nothing to hold on for.
    if (superseded()) return SUPERSEDED;
    const current = useLayerTableStore.getState().tables[layerId];
    if (current?.state !== "failed" || current.message !== ENGINE_STOPPED) {
      setState(layerId, { state: "failed", message: ENGINE_STOPPED });
    }
    return ENGINE_DEAD;
  };

  /**
   * The build itself. A function of its own so the queued task below can put
   * ONE guard around all of it — see there.
   */
  const build = async (): Promise<LayerTableOutcome> => {
    // Checked SYNCHRONOUSLY, before the first await: a build still WAITING
    // when the drop arrived is skipped outright and never touches DuckDB.
    if (superseded()) return SUPERSEDED;
    // …and the same for a build still waiting when its ENGINE went. Before the
    // `setState` below, which would otherwise put `building` over the
    // invalidation, and before `initDuckDB`, which it has no business asking
    // for on a table that is gone whatever the answer.
    //
    // THREE questions, because a queued build can have been condemned in three
    // ways: its adopted engine was replaced (`engineGone`), an engine died
    // while it had none to adopt (`diedSinceEnqueue` — the pre-boot build), or
    // the invalidation reached its entry (`invalidated`, which is the fact
    // itself rather than an inference from a counter).
    if (engineGone() || diedSinceEnqueue() || invalidated()) return abandon();
    // Re-read at RUN time, not at enqueue time: a drop or an earlier rebuild
    // may have landed in between, so a build that was queued over nothing can
    // turn out to be a rebuild by the time it runs (and vice versa).
    const previous = registry.get(layerId);
    setState(
      layerId,
      previous
        ? { state: "ready", info: previous, rebuilding: true }
        : { state: "building" },
    );

    // WAIT FOR THE ENGINE. `registerBuffer` and `ddl` both answer "not
    // running" while the status is anything but ready, and the boot takes ~5 s
    // — comfortably longer than a restored snapshot, a share link or a quick
    // file drop takes to reach this point. Without this await, the first layer
    // of a session reliably gets a table that failed for a reason that had
    // already stopped being true. `initDuckDB` never rejects (it records a
    // failure in the status), and it is memoised, so this is one await for the
    // first build and free for every one after.
    await initDuckDB();
    if (superseded()) return SUPERSEDED;
    // A death during that await — including one that struck the very boot this
    // build was waiting for, which is why `diedSinceEnqueue` is asked here and
    // not only `engineGone`: a build with no adopted engine cannot see a
    // generation move. NOT the park below: parking would hand this source to
    // `retryEngine`, which is the rebuild this milestone deliberately does not
    // do, and `ENGINE_NOT_RUNNING` would overwrite §6.1's sentence with the one
    // that means "not up YET". That park is for a boot that never came up, with
    // no death in it.
    if (engineGone() || diedSinceEnqueue() || invalidated()) return abandon();
    if (getDuckDBStatus().state !== "ready") {
      // PARK the source: nothing has been handed to DuckDB, so a `bytes`
      // array is still intact — but a provider is preferred over it anyway,
      // so a huge file is not pinned in the heap while the engine is down.
      pendingSources.set(layerId, parkIntact(source));
      if (previous) {
        // An engine that stopped being ready under a working table does not
        // take the table with it — same rule as a failed rebuild.
        setState(layerId, {
          state: "ready",
          info: previous,
          rebuilding: false,
        });
      } else {
        setState(layerId, { state: "failed", message: ENGINE_NOT_RUNNING });
      }
      return { ok: false, message: ENGINE_NOT_RUNNING };
    }
    // Past this point the engine is up, so this attempt is not a candidate for
    // the retry queue any more — and a build that was enqueued before any
    // engine existed now has one to be loyal to.
    engine = getEngineGeneration();
    pendingSources.delete(layerId);
    // The name is minted INSIDE the queued task, so table numbering follows
    // build order rather than enqueue order and a cancelled build burns no
    // number at all.
    const table = `layer_${++counter}`;
    const scratch: BuildScratch = new Set();
    try {
      const info =
        source.kind === "bytes"
          ? await buildFromReader(table, source, scratch)
          : await buildFromRows(
              table,
              source.kind === "model"
                ? flatRowsFromModel(source.model)
                : flatRowsFromRecords(source.records()),
              scratch,
            );
      // NOTE what is NOT kept: `info` carries the PROVIDER, never the source
      // object, so the (now detached) `bytes` array and the `model`/`records`
      // closure are both released with the caller's reference. A rebuild
      // therefore always re-obtains its input rather than replaying a
      // consumed one.
      if (superseded()) {
        // The layer was REMOVED while this build ran. Publishing now would
        // write a `ready` entry over the `null` the drop already set — a store
        // entry for a layer that no longer exists, on the very object React
        // subscribes to — so tear the new table down instead and publish
        // nothing. Any `previous` is left alone: the drop's own queued task
        // is right behind us and will retire it.
        await retire(info);
        return SUPERSEDED;
      }
      // The engine this table was built in has gone, or the status has left
      // `ready` under it. `info` describes a table in a database nobody can
      // reach, and publishing it would put a `ready` entry over the
      // invalidation — the exact state the catalogue would then offer tools
      // against. Nothing is retired: that is SQL for a corpse.
      if (engineGone() || getDuckDBStatus().state !== "ready") {
        return abandon();
      }
      registry.set(layerId, info);
      setState(layerId, { state: "ready", info });
      // AFTER the replacement exists, never before. Retiring first would leave
      // the layer with NO table for the length of the build — several times a
      // pan, on a streaming layer — and with none at all if the build failed.
      if (previous) await retire(previous);
      return OK;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The table could not be built.";
      console.warn(`DuckDB table for layer ${layerId} failed: ${message}`);
      // FIRST, and without touching the engine: the death is why this failed,
      // the half-built table died with the database, and both branches below
      // would undo the invalidation — one by restoring a captured `ready` over
      // a table that no longer exists, the other by parking the source for a
      // Retry that must not rebuild it.
      if (engineGone()) return abandon();
      // BEFORE any publishing, and on every branch below: a `CREATE` that
      // succeeded before a later statement failed has left a table nothing
      // will ever name again.
      await discardHalfBuilt(table, scratch);
      // AGAIN, because that cleanup is itself an await: a death inside it would
      // otherwise slip past the check above and reach the two branches below.
      if (engineGone()) return abandon();
      if (superseded()) {
        // Same reason as the success path: the drop owns the store entry now,
        // and a failed build of a removed layer has nothing to report to a
        // panel that is no longer showing it.
        return SUPERSEDED;
      }
      if (getDuckDBStatus().state !== "ready") {
        // The engine DIED mid-build — `registerBuffer` and `ddl` both start
        // answering "not running" the moment it does. That is the same cause
        // as the not-ready path above and deserves the same treatment, not a
        // dead `failed` a retry would never touch. Only when the source cannot
        // be replayed at all (bytes already consumed, no provider) does it
        // fall through to a real failure.
        if (engineGone()) return abandon();
        const parked = parkConsumed(source);
        if (parked) {
          pendingSources.set(layerId, parked);
          setState(
            layerId,
            previous
              ? { state: "ready", info: previous, rebuilding: false }
              : { state: "failed", message: ENGINE_NOT_RUNNING },
          );
          return { ok: false, message: ENGINE_NOT_RUNNING };
        }
      }
      if (engineGone()) return abandon();
      if (previous) {
        // A failed REBUILD is not a failed layer: the old table was never
        // touched and still answers every query. The console carries the
        // reason; the panel keeps showing real data rather than an error over
        // a table that works.
        setState(layerId, {
          state: "ready",
          info: previous,
          rebuilding: false,
        });
      } else {
        registry.delete(layerId);
        setState(layerId, { state: "failed", message });
      }
      // The SAME message on both branches, and this is the whole point of the
      // outcome: the `previous` branch leaves a perfectly `ready` entry in the
      // store, so a caller reading the store back would be told the refresh it
      // asked for had succeeded.
      return { ok: false, message };
    }
  };

  return enqueue(async () => {
    try {
      return await build();
    } catch (error) {
      // THE DEATH RELEASED AN AWAIT THAT WOULD NEVER HAVE SETTLED (see the
      // wrappers at the top of this file). Two awaits reach here rather than
      // the catch inside: the `initDuckDB` wait, which sits before that try,
      // and the cleanup INSIDE the catch — `discardHalfBuilt`'s DROP and the
      // VFS releases, which a death can take just as easily as the build's own
      // statements. Either way the answer is §6.1's: the database is gone, the
      // table went with it, and nothing may be said about the build's own SQL.
      //
      // Rethrown for anything else, because a bug in this module must not be
      // reported to the user as a dead engine.
      if (error instanceof EngineDeadError) return abandon();
      throw error;
    }
  });
}

/**
 * Forget ONE of `layerId`'s tables — its bare one, or one family's.
 *
 * Goes through the SAME queue as the builds, which is the whole reason there
 * is one: a removal that arrives while a create is in flight waits for it
 * instead of dropping a table that does not exist yet and then watching the
 * create put it back. A layer removed while its build is still QUEUED is
 * skipped outright — the table is never made.
 *
 * A layer being REMOVED goes through {@link dropLayerTables} instead, which
 * covers every family it accumulated; this is the single-key door.
 *
 * A FILE-BACKED key must not come here directly: retiring the view releases the
 * registration behind it, and `familyViews` still remembers that name — so the
 * next `ensureFamilyView` would skip its registration and build a view over a
 * dropped name, which resolves to nothing. Go through `familyViews`'
 * `dropFamilyView` / `dropFamilyViews`, which forget the cache as well.
 */
export function dropLayerTable(
  layerId: string,
  family: string | null = null,
): Promise<void> {
  const key = layerTableKey(layerId, family);
  // NOTHING to forget: no table, no parked source, and no enqueue this module
  // has not already finished with (`lastEnqueueSeq` is deleted by the drop that
  // settles a layer, and a build still queued always has its entry). Returning
  // here is not just an optimisation — it keeps the store object IDENTICAL, so
  // a drop of a layer that never had analytics cannot re-render every
  // subscriber of `useLayerTableStore` twice for nothing. Layer removal calls
  // this for EVERY layer, geospatial ones included; most of them were never in
  // here at all.
  //
  // The STORE is asked as well, and it is not redundant: an engine death clears
  // the registry and leaves a `failed` card behind, so for a family's key that
  // card is the only trace the layer's table ever existed — and a removal that
  // returned here would leave it in the panel for a layer that is gone.
  if (
    !registry.has(key) &&
    !pendingSources.has(key) &&
    !lastEnqueueSeq.has(key) &&
    useLayerTableStore.getState().tables[key] === undefined
  ) {
    return Promise.resolve();
  }
  // Everything enqueued for this layer BEFORE now is superseded; anything
  // enqueued after — a re-add of the same id — takes a higher number and runs.
  const seq = ++seqCounter;
  cancelBefore.set(key, seq);
  // A removed layer must not come back on the next `retryEngine()`. This is the
  // one thing a build's own cancellation check CANNOT cover: a layer parked
  // while the engine was down has no build in flight to cancel, so without this
  // the retry would enqueue a fresh one for a layer nobody can see.
  pendingSources.delete(key);
  setState(key, null);
  return enqueue(async () => {
    const info = registry.get(key);
    if (info) {
      registry.delete(key);
      try {
        // DROP TABLE first, dropBuffer second (inside `retire`): a VFS name that
        // has been dropped still RESOLVES, to zero bytes, so releasing it under a
        // live table invites a misleading parse error instead of a clean drop.
        await retire(info);
      } catch (error) {
        // The engine died under that DROP, so it will never settle (see the
        // wrappers at the top of this file). There is nothing left to drop —
        // the table went with the database — and the store still has to be
        // cleared below, which is the whole reason this is caught HERE rather
        // than allowed to reject the drop.
        if (!(error instanceof EngineDeadError)) throw error;
      }
    }
    // Clear the store AGAIN, and this is not belt-and-braces. It guards against
    // the writers that are NOT in this queue and so can land between the
    // synchronous `setState(null)` above and this task running.
    //
    // A build inside the queue is not one of them: its final `superseded()`
    // check, its `registry.set` and its `setState` are consecutive SYNCHRONOUS
    // statements, so a drop cannot be issued between them. The real case is
    // `retryEngine`'s catch, which writes a `failed` entry from outside the
    // queue when a parked source's provider rejects — for a layer this drop may
    // have removed a moment earlier.
    //
    // Unless a NEWER enqueue has claimed the id since (a remove-then-re-add of
    // the same file): that one's entry is alive and blanking it would empty a
    // table the user is looking at.
    if ((lastEnqueueSeq.get(key) ?? 0) <= seq) {
      setState(key, null);
      // Nothing is queued for this layer any more, so its bookkeeping goes with
      // it. `cancelBefore` deliberately STAYS: it is the record that everything
      // up to `seq` was cancelled, and forgetting it would let a build still
      // somewhere in the queue publish a table for a removed layer.
      lastEnqueueSeq.delete(key);
    }
  });
}

/**
 * Forget EVERY table `layerId` owns — its bare one and one per family.
 *
 * What layer removal calls. A CityParquet layer accumulates a table per family
 * the user opened, and dropping only the bare key would leave a view per family
 * in the database for the life of the page, each holding its source
 * registration open.
 *
 * The bare key is always included, even when nothing is registered under it: a
 * build that is still QUEUED has no registry entry yet, and the drop's job is
 * to record the cancellation before it can publish (see {@link dropLayerTable}).
 */
export function dropLayerTables(layerId: string): Promise<void> {
  return Promise.all(
    keysForLayer(layerId).map((key) => {
      const parsed = parseTableKey(key);
      return dropLayerTable(parsed.layerId, parsed.family);
    }),
  ).then(() => {});
}
