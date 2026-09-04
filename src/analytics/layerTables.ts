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
  ddl,
  dropBuffer,
  getDuckDBStatus,
  initDuckDB,
  registerBuffer,
  runQuery,
} from "./duckdb";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
  flatRowsFromRecords,
  type FlatRow,
} from "./layerRows";
import { buildCountSql, quoteIdent } from "./sql";

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
 * once — two exports of one layer, or a retry after a failed write.
 *
 * Lives in the registry, never in the layer store — a function is not snapshot
 * state, which is also why a layer restored from a snapshot has to re-obtain
 * its bytes rather than inherit them.
 */
export type SourceProvider = () => Promise<Uint8Array>;

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
      /** The VFS file extension, e.g. "city.json" / "city.jsonl". */
      readonly extension: string;
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
  readonly columns: ReadonlyArray<ColumnInfo>;
  /** From the reader's own `geometry_lod*` names — each rung carries the label
   *  to SHOW and the suffix to BUILD A COLUMN NAME WITH, because the two are
   *  not interconvertible. `[]` for a fallback table. */
  readonly lods: ReadonlyArray<LodColumn>;
  readonly rowCount: number;
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

function setState(layerId: string, state: LayerTableState | null): void {
  useLayerTableStore.setState((s) => {
    const tables = { ...s.tables };
    if (state === null) delete tables[layerId];
    else tables[layerId] = state;
    return { tables };
  });
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
 * Sources whose build was refused because the ENGINE was not running.
 *
 * DuckDB takes ~5 s to come up (a 36 MB wasm module plus a 3.5 s `LOAD
 * cityjson`), and the most common first layer of a session lands inside that
 * window: a snapshot restored at boot, a share link, a file dropped on the
 * landing page. Without this that layer's table fails PERMANENTLY, and the
 * only way back is to remove and re-add the layer — which nobody would guess.
 *
 * Safe to keep. On this path `registerFileBuffer` was never called, so a
 * `bytes` source's array is intact rather than detached; a `model` or
 * `resident` source is a reference either way.
 */
const pendingSources = new Map<string, LayerTableSource>();
/** The message the engine itself uses for a query it cannot run. Repeated
 *  rather than imported because `duckdb.ts` keeps it private — but it must
 *  READ the same, or the panel says two different things about one cause. */
const ENGINE_NOT_RUNNING = "The analytics engine is not running.";
let seqCounter = 0;
let counter = 0;
let chain: Promise<void> = Promise.resolve();

export function getLayerTable(layerId: string): LayerTable | null {
  return registry.get(layerId) ?? null;
}

/** Append `task` to the single queue. One queue, not one per layer, so a drop
 *  enqueued behind a create can never race the `CREATE` it must follow. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

export function resetLayerTablesForTest(): void {
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

function columnsFromDescribe(
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

async function countRows(table: string): Promise<number> {
  const result = await runQuery(buildCountSql(table, null));
  if (!result.ok) return 0;
  const n = result.rows[0]?.n;
  return typeof n === "number" ? n : Number(n) || 0;
}

class BuildError extends Error {}

async function buildFromReader(
  table: string,
  source: Extract<LayerTableSource, { kind: "bytes" }>,
): Promise<LayerTable> {
  const sourceName = `${table}.${source.extension}`;
  const registered = await registerBuffer(sourceName, source.bytes);
  if (!registered) {
    throw new BuildError("The source bytes could not be handed to DuckDB.");
  }
  try {
    const described = await runQuery(
      `DESCRIBE SELECT * FROM ${source.reader}('${sourceName}')`,
    );
    if (!described.ok) throw new BuildError(described.message);

    const all = columnsFromDescribe(described.rows);
    const kept = all.filter((c) => !isDroppedColumn(c.name));
    if (kept.length === 0) {
      throw new BuildError("This file has no attribute columns to browse.");
    }
    const select = kept.map((c) => quoteIdent(c.name)).join(", ");
    const created = await ddl(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ${select} FROM ${source.reader}('${sourceName}')`,
    );
    if (!created.ok) throw new BuildError(created.message);

    return {
      table,
      sourceName,
      source: source.provider,
      reader: source.reader,
      columns: kept,
      lods: lodsFromColumnNames(all.map((c) => c.name)),
      rowCount: await countRows(table),
    };
  } finally {
    // ALWAYS, success or not: the table (if it was made) survives this, and a
    // failed build must not leave a multi-megabyte buffer in the VFS.
    await dropBuffer(sourceName);
  }
}

/** The columns an empty fallback table is declared with — the vocabulary every
 *  other layer publishes, so a streaming layer with no cells yet still has a
 *  browsable (empty) table rather than a failure. */
const EMPTY_FALLBACK_DDL =
  '("id" VARCHAR, "feature_id" VARCHAR, "object_type" VARCHAR, "parents" VARCHAR[], "children" VARCHAR[])';

async function buildFromRows(
  table: string,
  rows: ReadonlyArray<FlatRow>,
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
      const created = await ddl(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_json_auto('${sourceName}')`,
      );
      if (!created.ok) throw new BuildError(created.message);

      // `read_json_auto` infers from the DATA, and a layer of nothing but root
      // objects has `parents` NULL in every row — which it types as JSON, not
      // VARCHAR[]. That is a real divergence from the reader schema: a JSON
      // column classifies `castText` instead of `nested`, so the filter bar
      // would offer it comparisons it cannot honour and `parents IS NULL`
      // would stop meaning the same thing on the two kinds of table.
      //
      // Probed (2026-09-04, DuckDB 1.5.5): `sample_size = -1` and
      // `union_by_name` do NOT help — an all-NULL column stays JSON — and a
      // PARTIAL `columns = {...}` option DROPS every column it does not name,
      // which would throw the layer's attributes away. `ALTER COLUMN … TYPE`
      // is the route that works: it is a no-op when the inference was already
      // right, and it preserves both the list values and the NULLs.
      for (const column of ["parents", "children"]) {
        const altered = await ddl(
          `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(column)} TYPE VARCHAR[]`,
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
      columns: columnsFromDescribe(described.rows),
      lods: [],
      rowCount: await countRows(table),
    };
  } finally {
    if (sourceName !== null) await dropBuffer(sourceName);
  }
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
  await initDuckDB();
  if (getDuckDBStatus().state !== "ready") return;
  // Snapshot and CLEAR first: each `enqueueLayerTable` below can put its layer
  // straight back in (a second failure), and iterating a map being written to
  // is how one layer gets retried forever.
  const pending = [...pendingSources.entries()];
  pendingSources.clear();
  await Promise.all(
    pending.map(([layerId, source]) => enqueueLayerTable(layerId, source)),
  );
}

/**
 * `DROP TABLE` plus the VFS cleanup for one entry.
 *
 * Called from INSIDE the queue only — by a rebuild that has just published its
 * replacement, and by `dropLayerTable` (Task 14).
 */
async function retire(info: LayerTable): Promise<void> {
  await ddl(`DROP TABLE IF EXISTS ${quoteIdent(info.table)}`);
  // Belt and braces: the build already dropped this on the way out, and a
  // second drop of an absent name is harmless. A build that failed BETWEEN
  // registration and its own `finally` is the case this covers.
  if (info.sourceName !== null) await dropBuffer(info.sourceName);
}

/**
 * Build (or rebuild) `layerId`'s table.
 *
 * Resolves when the build has SETTLED, success or failure — a DuckDB failure
 * is recorded on the entry and shown in the panel, never thrown into the
 * loader: an analytics engine that could not start must not fail a layer add.
 */
export function enqueueLayerTable(
  layerId: string,
  source: LayerTableSource,
): Promise<void> {
  const seq = ++seqCounter;
  lastEnqueueSeq.set(layerId, seq);
  // A REBUILD keeps the table it is replacing ON SCREEN. Only a layer with no
  // table yet passes through "queued"/"building".
  const queuedOver = registry.get(layerId);
  setState(
    layerId,
    queuedOver
      ? { state: "ready", info: queuedOver, rebuilding: true }
      : { state: "queued" },
  );
  /** Has a drop superseded this build? Asked twice — once before it starts,
   *  once after it finishes — because a drop can arrive at any point in
   *  between. (`?? 0` is safe: `seqCounter` starts at 1.) */
  const superseded = () => seq <= (cancelBefore.get(layerId) ?? 0);

  return enqueue(async () => {
    // Checked SYNCHRONOUSLY, before the first await: a build still WAITING
    // when the drop arrived is skipped outright and never touches DuckDB.
    if (superseded()) return;
    // Re-read at RUN time, not at enqueue time: a drop or an earlier rebuild
    // may have landed in between.
    const previous = registry.get(layerId);
    if (!previous) setState(layerId, { state: "building" });

    // WAIT FOR THE ENGINE. `registerBuffer` and `ddl` both answer "not
    // running" while the status is anything but ready, and the boot takes ~5 s
    // — comfortably longer than a restored snapshot, a share link or a quick
    // file drop takes to reach this point. Without this await, the first layer
    // of a session reliably gets a table that failed for a reason that had
    // already stopped being true. `initDuckDB` never rejects (it records a
    // failure in the status), and it is memoised, so this is one await for the
    // first build and free for every one after.
    await initDuckDB();
    if (superseded()) return;
    if (getDuckDBStatus().state !== "ready") {
      // KEEP the source: `registerFileBuffer` was never called, so a `bytes`
      // array is still intact, and `retryEngine` can build this table without
      // the user re-adding the layer.
      pendingSources.set(layerId, source);
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
      return;
    }
    // Past this point the engine is up, so this attempt is not a candidate for
    // the retry queue any more.
    pendingSources.delete(layerId);
    // The name is minted INSIDE the queued task, so table numbering follows
    // build order rather than enqueue order and a cancelled build burns no
    // number at all.
    const table = `layer_${++counter}`;
    try {
      const info =
        source.kind === "bytes"
          ? await buildFromReader(table, source)
          : await buildFromRows(
              table,
              source.kind === "model"
                ? flatRowsFromModel(source.model)
                : flatRowsFromRecords(source.records()),
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
        return;
      }
      registry.set(layerId, info);
      setState(layerId, { state: "ready", info });
      // AFTER the replacement exists, never before. Retiring first would leave
      // the layer with NO table for the length of the build — several times a
      // pan, on a streaming layer — and with none at all if the build failed.
      if (previous) await retire(previous);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The table could not be built.";
      console.warn(`DuckDB table for layer ${layerId} failed: ${message}`);
      if (superseded()) {
        // Same reason as the success path: the drop owns the store entry now,
        // and a failed build of a removed layer has nothing to report to a
        // panel that is no longer showing it.
        return;
      }
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
    }
  });
}
