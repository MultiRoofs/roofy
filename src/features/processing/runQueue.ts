/**
 * ONE run at a time, on the SAME queue the table builds use.
 *
 * Why that queue and not one of its own: a run is `ALTER TABLE` + `UPDATE` over
 * a layer table, and a streaming layer REBUILDS that table on every settle. Two
 * queues would let a write land on a table that is being replaced underneath it
 * — the write succeeds, the rebuild wins, and the column silently disappears.
 * `runOnTableQueue` is the seam `layerTables` exposes for exactly this, so a run
 * and a build can never interleave.
 *
 * WHAT IS FROZEN AND WHEN. `submitRun` snapshots everything a run reads from the
 * live stores — the selection, the applied filter, the layer's table name — and
 * `resolveScope` resolves THAT at the head of the queue (spec §6.1, "Frozen
 * parameters"). A run queued behind a long build therefore measures the ground
 * the user saw when they pressed Run. The resolved ids are then held for the rest
 * of its life: the tool computes against them, the write targets them, and Undo
 * restores them. The one thing re-checked at the head is the table itself: a
 * rebuild between Run and the head means the frozen ids name rows that are gone,
 * and the run fails rather than writing to a table the user did not target.
 *
 * PUBLICATION IS THE LAST STEP. The DuckDB write is a transaction inside
 * `writeComputedColumns`; only once it has committed does the run touch the
 * model (`mergeAttributes`), the provenance registry and the result card. A
 * failure anywhere before that leaves the layer exactly as it was, which is what
 * makes "failed" a state the user can ignore.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts` and `insights/computedColumns.ts`.
 */

import {
  ensureExtension,
  getDuckDBStatus,
  onEngineDeath,
  subscribeDuckDBStatus,
  isExtensionLoaded,
  runQuery,
  type QueryOutcome,
} from "../../insights/duckdb";
import { quoteIdent } from "../../insights/sql";
import {
  computedColumnsOf,
  undoComputedColumns,
  useComputedColumnStore,
  writeComputedColumns,
  type OutputColumn,
} from "../../insights/computedColumns";
import {
  getLayerTable,
  refreshLayerTableColumns,
  runOnTableQueue,
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import { useLayerStore, type Layer } from "../layers/layerStore";
import { runById, useProcessingStore } from "./processingStore";
import { resolveScope, snapshotScopeInputs, type ScopeSnapshot } from "./scope";
import { toolById } from "./toolRegistry";
import { EXECUTORS } from "./tools";
import "./tools/register";
import type {
  LogEntry,
  RunPhase,
  RunRecord,
  RunSummary,
  Scope,
  SkipCount,
  ToolId,
} from "./types";

export interface RunRequest {
  readonly toolId: ToolId;
  readonly targetLayerId: string;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  readonly columns: ReadonlyArray<OutputColumn>;
}

/** A {@link RunRequest} plus everything `submitRun` froze for it. */
interface FrozenRequest extends RunRequest {
  readonly snapshot: ScopeSnapshot;
  /** The target's table name at Run; a different one at the head is a rebuild. */
  readonly tableName: string | null;
}

/**
 * What a tool executor is handed. Everything a tool needs and nothing it does
 * not: no store, no engine, no run id — the log, the phase and the warnings all
 * reach the card through these three methods.
 */
export interface ToolContext {
  readonly table: LayerTable;
  readonly layer: Layer;
  /** The rows to compute for, or `null` for "every row". */
  readonly featureIds: ReadonlyArray<string> | null;
  readonly signal: AbortSignal;
  query(label: string, sql: string): Promise<QueryOutcome>;
  phase(p: RunPhase): void;
  warn(text: string): void;
  /**
   * Throw if the user has cancelled — the ONE way a long, query-free executor
   * can stop EARLY.
   *
   * It does not make cancellation correct: `execute` already refuses to publish
   * an aborted run (it re-checks `signal.aborted` the moment the executor
   * returns, and its catch reads `CancelledError` as "cancelled"), so a Cancel
   * during a long compute was always honoured. What a query-free executor lacks
   * is the early EXIT: without this it computes to the end first. `ctx.query`
   * already does the same check, which is enough for a tool whose work IS
   * queries. `CancelledError` is private to this module on purpose: it is what
   * makes `execute`'s catch read "cancelled" rather than "failed", and an
   * executor must not be able to fake either.
   */
  throwIfCancelled(): void;
}

export interface ToolResult {
  readonly columns: ReadonlyArray<OutputColumn>;
  /** objectId → { column → value }. Every column present in every row. */
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** FEATURES measured, for the summary line. */
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

export type ToolExecutor = (
  run: RunRecord,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** Spec §6.1's sentence for a run the engine's death took. */
const ENGINE_STOPPED = "Analytics engine stopped";

/** Thrown by the context when the user cancelled; never surfaced as an error. */
class CancelledError extends Error {}

/**
 * Race an ENGINE await against the run's abort signal.
 *
 * Aborting a controller does not release an await. duckdb-wasm drops the
 * promises of requests that were in flight when its worker died — its own
 * `onError` clears the pending map WITHOUT rejecting them — so a query, an
 * extension load or a write caught by the death never settles, and an
 * `execute` sitting on one would hold the shared table FIFO for the life of
 * the page: the card would read "failed" while every later run and every table
 * build queued behind a task that can never finish.
 *
 * The listener is removed on settle; a run that is never cancelled would
 * otherwise leave one on its controller for as long as the signal lives.
 */
/** Thrown when the engine died under an await that can never settle. */
class EngineDeadError extends Error {}

/**
 * Race an ENGINE await against the engine's DEATH, and optionally against the
 * run's own abort.
 *
 * The death is an independent signal (`onEngineDeath`) and not a reading of
 * the abort, because an `AbortSignal` fires ONCE: a run cancelled while the
 * engine was alive has already spent its abort, and the crash that catches its
 * write a moment later would have nothing left to fire. Racing the death
 * separately covers every cancel state, which is the whole point.
 *
 * `signal` is null for the awaits at and past the point of no return. A user's
 * Cancel during the write is decided INSIDE the write — its pre-COMMIT check,
 * and §6.1's "finished before the cancel arrived" when the COMMIT won the race
 * — and the DESCRIBE that follows it is past the COMMIT, where the columns are
 * on the table whatever the signal says. Only the death may take those two.
 */
function raced<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise<T>((resolve, reject) => {
    const stopListening = () => {
      signal?.removeEventListener("abort", onAbort);
      stopDeath();
    };
    const onAbort = () => {
      stopListening();
      reject(new CancelledError());
    };
    const stopDeath = onEngineDeath(() => {
      stopListening();
      reject(new EngineDeadError());
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        stopListening();
        resolve(value);
      },
      (error: unknown) => {
        stopListening();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const controllers = new Map<string, AbortController>();

interface UndoState {
  readonly table: string;
  readonly backupTable: string | null;
  readonly created: ReadonlyArray<string>;
  readonly replaced: ReadonlyArray<string>;
  readonly ids: ReadonlyArray<string> | null;
  /** The model attributes the run overwrote; `undefined` for "was not there". */
  readonly previousModelValues: ReadonlyMap<string, Record<string, unknown>>;
}

const undoState = new Map<string, UndoState>();
/**
 * What each run froze, kept for as long as its card is in the history.
 *
 * Retry and Re-run repeat a run, and §6.3's "the same parameters" includes the
 * ones the user cannot see: the selection and the filter the run resolved its
 * scope from. Rebuilding the request from the RECORD loses exactly those — the
 * record keeps `scope: "selected"`, not WHICH buildings — so a Retry pressed
 * after clicking elsewhere would quietly measure something else.
 *
 * A module Map rather than a field on the record: none of this is state the UI
 * renders, and nothing about a run survives the session.
 */
const frozenById = new Map<string, FrozenRequest>();
let counter = 0;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** Spec §6.1: "2 buildings measured · 14 skipped · 2.4 s". */
export function summarise(result: ToolResult, elapsedMs: number): RunSummary {
  const skippedTotal = result.skipped.reduce((a, s) => a + s.count, 0);
  const parts = [
    plural(result.measured, "building measured", "buildings measured"),
  ];
  if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
  parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);
  const detail =
    skippedTotal > 0
      ? `${fmt(skippedTotal)} skipped: ${result.skipped
          .map((s) => `${fmt(s.count)} ${s.cause}`)
          .join(" · ")}`
      : null;
  return {
    line: parts.join(" · "),
    detail,
    measured: result.measured,
    skipped: result.skipped,
  };
}

/**
 * The run's output under the TABLE's OWN spelling of every column it touches.
 *
 * DuckDB matches identifiers without regard to case, so a run whose prefix
 * differs only in case from an earlier one ("EXTENT_" after "extent_") writes
 * the column that is already there. Everything the app keeps beside the table
 * — the model attributes, the provenance registry, the run record's `columns`
 * and the Undo-ownership check — is keyed on EXACT strings, so the typed
 * spelling would give that one column a second name: two registry entries, two
 * model attributes, and an earlier run still holding an Undo that would drop
 * the column the newer run owns.
 *
 * The canonical spelling is the table's when the table has the column, and the
 * name as typed when it does not (a column nothing has yet is named by the run
 * that creates it). Renaming here, once, is what makes every step downstream
 * agree without each of them having to lower-case anything.
 */
function canonicalise(
  result: ToolResult,
  columns: ReadonlyArray<{ readonly name: string }>,
): ToolResult {
  const onTable = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]));
  const renamed = new Map<string, string>();
  for (const col of result.columns) {
    const own = onTable.get(col.name.toLowerCase());
    if (own !== undefined && own !== col.name) renamed.set(col.name, own);
  }
  if (renamed.size === 0) return result;
  const rows = new Map<string, Record<string, unknown>>();
  for (const [objectId, values] of result.rows) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      next[renamed.get(key) ?? key] = value;
    }
    rows.set(objectId, next);
  }
  return {
    ...result,
    columns: result.columns.map((col) => {
      const own = renamed.get(col.name);
      return own === undefined ? col : { ...col, name: own };
    }),
    rows,
  };
}

function scopeLabel(scope: Scope, count: number): string {
  const n = plural(count, "building", "buildings");
  return scope === "all"
    ? `All ${n}`
    : scope === "matching"
      ? `Matching ${n}`
      : `Selected ${n}`;
}

/**
 * Every status a run writes goes through here, and ENDED means ended.
 *
 * A run has more than one thing that can finish it, and they do not take turns:
 * the target-removal watcher fails a run where it stands (§6.1's "Layer
 * removed") while `execute` is mid-await, and `execute`'s continuation then
 * arrives with a status of its own — done, or a second failure with the reason
 * the removal caused. Without this guard the removal's reason was overwritten
 * by whatever landed last, and a card could claim a result on a layer the user
 * had thrown away.
 *
 * Only a patch that CARRIES a status is refused: the log lines and warnings a
 * late statement still produces belong on the record either way.
 */
const patch = (id: string, p: Partial<RunRecord>) => {
  const current = runById(id);
  if (
    p.status !== undefined &&
    (current?.status === "failed" || current?.status === "cancelled")
  ) {
    return;
  }
  useProcessingStore.getState().patchRun(id, p);
};

/**
 * Queue a run and return its id immediately.
 *
 * The card exists before the work does, deliberately: the panel shows "Queued"
 * for a run behind a table build, and a user who pressed Run has something to
 * cancel from the first frame.
 */
export function submitRun(request: RunRequest): string {
  return queueRun({
    ...request,
    snapshot: snapshotScopeInputs(request.targetLayerId),
    tableName: getLayerTable(request.targetLayerId)?.table ?? null,
  });
}

/**
 * Spec §6.3: "Retry re-runs with the same parameters" — including the frozen
 * scope, which is why this exists instead of rebuilding a request from the
 * record. Recent runs' Re-run (a stale run, §7) takes the same door.
 *
 * The new run is a NEW run: its own id, its own card, its own controller. Only
 * the snapshot is inherited; the TABLE is read afresh, because the retry is
 * aimed at the layer as it is now — a Re-run after a rebuild that reused the
 * old table name would refuse itself with "Layer changed while running".
 *
 * `null` when the run is not one this session queued (an id from nowhere, or a
 * card the history has since evicted): there is nothing to repeat.
 */
export function retryRun(runId: string): string | null {
  const frozen = frozenById.get(runId);
  if (!frozen) return null;
  return queueRun({
    ...frozen,
    tableName: getLayerTable(frozen.targetLayerId)?.table ?? null,
  });
}

function queueRun(frozen: FrozenRequest): string {
  const request: RunRequest = frozen;
  const layer = useLayerStore
    .getState()
    .layers.find((l) => l.id === request.targetLayerId);
  const id = `run_${++counter}`;
  const record: RunRecord = {
    id,
    toolId: request.toolId,
    targetLayerId: request.targetLayerId,
    targetName: layer?.name ?? "?",
    sourceLayerId: null,
    sourceName: null,
    scope: request.scope,
    scopeCount: 0,
    featureIds: null,
    lod: request.lod,
    params: request.params,
    prefix: request.prefix,
    columns: request.columns.map((c) => c.name),
    status: "queued",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
  };
  const before = useProcessingStore.getState().runs.map((r) => r.id);
  useProcessingStore.getState().upsertRun(record);
  // A run pushed past MAX_RUNS has no card left to press Undo on, so its backup
  // table is dead weight in the database.
  const held = new Set(useProcessingStore.getState().runs.map((r) => r.id));
  for (const gone of before) {
    if (held.has(gone)) continue;
    discardUndo(gone);
    // The card is gone, so nothing can ask to repeat it.
    frozenById.delete(gone);
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  frozenById.set(id, frozen);
  // The queue's rejection is not this caller's business: every failure mode a
  // run has is already a patched card.
  void runOnTableQueue(() => execute(id, frozen, controller.signal)).catch(
    () => {},
  );
  return id;
}

/**
 * Give up a run's Undo and the database resources behind it.
 *
 * Three ways a run loses its Undo without using it: a later run overwrote one of
 * its columns (spec §6.2), a table rebuild retired it, or the history evicted it.
 * The backup table is a real table in the database in every one of them, and
 * nothing will ever read it again.
 */
function discardUndo(id: string): void {
  const state = undoState.get(id);
  if (!state) return;
  undoState.delete(id);
  const backup = state.backupTable;
  if (!backup) return;
  // On the queue, like every other statement about a layer table, and NOT
  // awaited: dropping a backup is housekeeping, never something a card waits on.
  void runOnTableQueue(() =>
    runQuery(`DROP TABLE IF EXISTS ${quoteIdent(backup)}`),
  ).catch(() => {});
}

/**
 * Has something already failed this run with a reason of its own?
 *
 * Only one thing can: the target-removal watcher, which patches the card and
 * THEN aborts. `execute` hears that abort as an ordinary cancel, and would
 * overwrite "Layer removed" with a cancel the user never asked for.
 */
function failedAlready(id: string): boolean {
  return runById(id)?.status === "failed";
}

/**
 * Spec §6.3: "Extension load failures say what failed to load and, for the
 * offline case, that it needs a network connection."
 *
 * The engine's own recorded reason is appended when there is one — it is the
 * same first-line treatment every other DuckDB error in this app gets — and an
 * offline browser is told the one thing it can act on instead, because
 * "HTTP request failed" is not a sentence a user can do anything with.
 */
/** DuckDB's own recorded reason for the failed load, or null. */
function extensionReason(name: "spatial" | "three_d"): string | null {
  const status = getDuckDBStatus();
  const entry = status.state === "ready" ? status.extensions[name] : null;
  return entry && entry.state === "failed" ? entry.error : null;
}

function extensionFailure(name: "spatial" | "three_d"): string {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    // Offline, the engine's own message is "fetch failed" or worse — true and
    // useless. The offline sentence is the one the user can act on; the
    // engine's is still RECORDED, as the warning the caller pushes.
    return `The ${name} extension could not be loaded; it needs a network connection.`;
  }
  const reason = extensionReason(name);
  return reason === null
    ? `The ${name} extension could not be loaded.`
    : `The ${name} extension could not be loaded: ${reason}`;
}

async function execute(
  id: string,
  request: FrozenRequest,
  signal: AbortSignal,
): Promise<void> {
  const started = performance.now();
  const log: LogEntry[] = [];
  const warnings: string[] = [];
  const elapsed = () => Math.round(performance.now() - started);
  try {
    // Cancelled while it waited its turn. The executor never runs, and the card
    // is already "cancelled" — this only stops the work.
    if (signal.aborted) return;

    // ONE execution start for the whole run, stamped here and never again.
    //
    // The footer's live ticker is `Date.now() - run.startedAt` while the run is
    // in flight, and the card's final `elapsedMs` is measured from `started`
    // above — the same instant. A `startedAt` re-stamped at a phase change
    // (which is what the extension phase and the compute phase each used to do)
    // made a long extension download's ticker drop back to zero at the
    // hand-off: the run looked like it had restarted, and the two numbers
    // described different spans. The record's own `startedAt` from `submitRun`
    // is the QUEUED stamp, and the ticker is not live for a queued run.
    patch(id, { startedAt: Date.now() });

    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === request.targetLayerId);
    if (!layer) {
      patch(id, {
        status: "failed",
        error: "Layer removed",
        elapsedMs: elapsed(),
      });
      return;
    }
    const table = getLayerTable(request.targetLayerId);
    if (!table) {
      patch(id, {
        status: "failed",
        error: "This layer's table could not be built",
        elapsedMs: elapsed(),
      });
      return;
    }
    // Spec §6.1: a queued run re-validates its frozen ground. A rebuilt table is
    // a different table — the frozen ids point at rows that no longer exist, and
    // the columns the form checked may not be there either.
    if (request.tableName !== null && request.tableName !== table.table) {
      patch(id, {
        status: "failed",
        error: "Layer changed while running; run again",
        elapsedMs: elapsed(),
      });
      return;
    }
    // Spec §6.1: "a column that now belongs to the file fails the run with that
    // reason". The form checked when the user typed the prefix; by the head the
    // table may hold a column of the file's own under that name, and DuckDB's
    // identifiers are CASE-INSENSITIVE — "EXTENT_height_m" would overwrite
    // "extent_height_m" without the run ever noticing.
    const owned = new Set(
      [...computedColumnsOf(request.targetLayerId)].map((c) => c.toLowerCase()),
    );
    const source = table.columns.find(
      (c) =>
        !owned.has(c.name.toLowerCase()) &&
        request.columns.some(
          (out) => out.name.toLowerCase() === c.name.toLowerCase(),
        ),
    );
    if (source) {
      patch(id, {
        status: "failed",
        // The TABLE's spelling: that is the column that belongs to the data.
        error: `'${source.name}' belongs to the source data; choose another prefix`,
        elapsedMs: elapsed(),
      });
      return;
    }
    const executor = EXECUTORS[request.toolId];
    if (!executor) {
      patch(id, {
        status: "failed",
        error: "Not available yet",
        elapsedMs: elapsed(),
      });
      return;
    }

    // Spec §6.1's first phase, "Loading extension (skipped once loaded)".
    //
    // It sits AFTER the cheap pre-flight refusals — a missing layer, a rebuilt
    // table, a column that now belongs to the file, an unimplemented tool — so
    // a run that cannot succeed never triggers a 24 MB download.
    //
    // It also sits INSIDE `runOnTableQueue`: the load blocks table builds for
    // its duration, once per session. That is the deliberate trade. Loading
    // outside the queue would take the phase out of §6.1's sequence and would
    // let the run start against a table that is being rebuilt underneath it.
    const tool = toolById(request.toolId);
    if (tool.extension !== null && !isExtensionLoaded(tool.extension)) {
      patch(id, { status: "running", phase: "extension" });
      const loaded = await raced(ensureExtension(tool.extension), signal);
      // `ensureExtension` cannot be aborted (it is one memoised INSTALL/LOAD
      // per extension), so a Cancel pressed during the download is honoured
      // here, on the far side of it.
      if (signal.aborted) {
        if (!failedAlready(id)) {
          patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
        }
        return;
      }
      if (!loaded) {
        // §6.4 makes the log the reproducible record of the run, so DuckDB's own
        // reason is kept there even when the card shows the offline sentence
        // instead — a bug report needs the engine's words, not only ours.
        const reason = extensionReason(tool.extension);
        if (reason !== null) {
          warnings.push(`${tool.extension}: ${reason}`);
          patch(id, { warnings: [...warnings] });
        }
        patch(id, {
          status: "failed",
          phase: null,
          error: extensionFailure(tool.extension),
          elapsedMs: elapsed(),
        });
        return;
      }
    }

    const scope = await raced(
      resolveScope({
        table,
        scope: request.scope,
        snapshot: request.snapshot,
      }),
      signal,
    );
    if (!scope.ok) {
      patch(id, {
        status: "failed",
        error: scope.message,
        elapsedMs: elapsed(),
      });
      return;
    }
    // Cancelled while the scope query was in flight. `cancelRun` has patched the
    // card already, but a run that is about to start must not.
    if (signal.aborted) {
      if (!failedAlready(id)) {
        patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
      }
      return;
    }
    patch(id, {
      status: "running",
      phase: "compute",
      featureIds: scope.featureIds,
      scopeCount: scope.count,
    });

    const ctx: ToolContext = {
      table,
      layer,
      featureIds: scope.featureIds,
      signal,
      async query(label, sql) {
        if (signal.aborted) throw new CancelledError();
        const t0 = performance.now();
        const out = await raced(runQuery(sql), signal);
        log.push({
          label,
          sql,
          ms: Math.round(performance.now() - t0),
          rows: out.ok ? out.rows.length : null,
        });
        patch(id, { log: [...log] });
        if (!out.ok) throw new Error(out.message);
        return out;
      },
      throwIfCancelled() {
        if (signal.aborted) throw new CancelledError();
      },
      phase(p) {
        patch(id, { phase: p });
      },
      warn(text) {
        warnings.push(text);
        patch(id, { warnings: [...warnings] });
      },
    };

    const record = runById(id);
    if (!record) return;
    // The table's spelling wins from here on, so the SQL, the rows' keys, the
    // model, the registry, the card and Undo all name the same column.
    const result = canonicalise(await executor(record, ctx), table.columns);
    if (signal.aborted) throw new CancelledError();

    if (result.rows.size === 0) {
      // Nothing to write. The write's `UPDATE … WHERE "id" IN ()` is a SYNTAX
      // error, and a run that measured nothing has no columns to own — so it is
      // a DONE run with a summary and no Undo, not a failure.
      const summary = summarise(result, elapsed());
      patch(id, {
        status: "done",
        phase: null,
        elapsedMs: elapsed(),
        summary,
        log: [...log],
        undoable: false,
      });
      if (runById(id)?.status === "done") {
        useProcessingStore.getState().pushNotice(summary.line);
      }
      return;
    }

    patch(id, { phase: "write" });
    // Which of THIS run's columns the table already has — matched the way
    // DuckDB matches them, without regard to case. A column classified as new
    // because its case differs would be backed up by nobody and DROPPED by
    // this run's Undo, taking the earlier run's values with it.
    const onTable = new Set(table.columns.map((c) => c.name.toLowerCase()));
    const existing = new Set(
      result.columns
        .map((c) => c.name)
        .filter((name) => onTable.has(name.toLowerCase())),
    );
    const t0 = performance.now();
    const writing = writeComputedColumns({
      runId: id,
      table: table.table,
      columns: result.columns,
      rows: result.rows,
      existing,
      // Spec §6.1: the write is the publication, so the LAST moment a cancel
      // can still mean "nothing changed" is inside it, before its COMMIT.
      signal,
    });
    const written = await raced(writing, null);
    log.push({
      label: "Writing results",
      sql: null,
      ms: Math.round(performance.now() - t0),
      rows: result.rows.size,
    });
    // A cancelled write is the user's Cancel arriving during the transaction,
    // not a failure: nothing was committed, so the card reads cancelled and
    // says nothing about an error.
    if (!written.ok) {
      throw written.cancelled
        ? new CancelledError()
        : new Error(written.message);
    }

    // Publication: model, then provenance, then the card. Past the commit, so
    // none of it can be rolled back and none of it may fail the run.
    const previousModelValues = new Map<string, Record<string, unknown>>();
    const merge = new Map<string, Record<string, unknown>>();
    for (const [objectId, values] of result.rows) {
      const object = layer.model.objects[objectId];
      // An id the table has and the model does not (a row the reader kept but
      // the mesh never got) is written to DuckDB and skipped here.
      if (!object) continue;
      const previous: Record<string, unknown> = {};
      for (const col of result.columns) {
        previous[col.name] = object.attributes[col.name];
      }
      previousModelValues.set(objectId, previous);
      merge.set(objectId, values);
    }
    useLayerStore.getState().mergeAttributes(layer.id, merge);

    for (const col of result.columns) {
      const registry = useComputedColumnStore.getState();
      const previous = registry.byLayer[layer.id]?.[col.name] ?? null;
      registry.setProvenance(layer.id, col.name, {
        runId: id,
        toolName: tool.name,
        summary: `${request.lod ? `LoD ${request.lod} · ` : ""}${scopeLabel(
          request.scope,
          scope.count,
        )}`,
        at: Date.now(),
        // FEATURES on both sides of "312 of 1,115": `rows` are ROWS (a Building
        // and its parts), and the tooltip would read as more than the layer has.
        partial:
          scope.featureIds === null
            ? null
            : { count: scope.count, total: scope.total },
        previous,
      });
    }

    // Spec §6.2: only ONE run can own a column's Undo. An earlier run whose
    // column this run has just overwritten can no longer restore anything — its
    // backup describes a state two writes ago.
    for (const other of useProcessingStore.getState().runs) {
      if (
        other.id !== id &&
        other.targetLayerId === layer.id &&
        other.undoable &&
        // Case-insensitively, like every other comparison between column
        // names: an earlier run recorded under a different spelling still owns
        // the column this run has just overwritten.
        other.columns.some((name) =>
          result.columns.some(
            (c) => c.name.toLowerCase() === name.toLowerCase(),
          ),
        )
      ) {
        patch(other.id, { undoable: false });
        discardUndo(other.id);
      }
    }

    undoState.set(id, {
      table: table.table,
      backupTable: written.backupTable,
      created: result.columns
        .map((c) => c.name)
        .filter((name) => !existing.has(name)),
      replaced: result.columns
        .map((c) => c.name)
        .filter((name) => existing.has(name)),
      ids: scope.featureIds === null ? null : [...result.rows.keys()],
      previousModelValues,
    });
    // Evicted while it ran: there is no card to press Undo on, so the backup the
    // write just made would never be read. (The eviction diff in `submitRun`
    // cannot see this one — the run was already gone when it was pushed out.)
    if (!runById(id)) discardUndo(id);

    // The registry's `columns` came from a DESCRIBE at build time; the grid and
    // the NEXT run both read it, and the next run's "did this column exist?"
    // decides whether Undo restores a value or drops the column.
    try {
      await raced(refreshLayerTableColumns(layer.id), null);
    } catch (error) {
      // Past the COMMIT nothing may fail the run, and this is the one await
      // left that a dead engine can strand. A DESCRIBE that will never answer
      // is abandoned; the run's own card is already the watcher's to write.
      if (!(error instanceof EngineDeadError)) throw error;
    }

    const summary = summarise(result, elapsed());
    patch(id, {
      status: "done",
      phase: null,
      elapsedMs: elapsed(),
      summary,
      log: [...log],
      // The columns as the TABLE spells them, not as the prefix was typed: the
      // card, Style by result and the next run's ownership check all read this.
      columns: result.columns.map((c) => c.name),
      undoable: true,
      // Spec §6.1: a cancel that lost the race is told, not hidden — the user
      // pressed Cancel and the results appeared anyway.
      note: signal.aborted ? "finished before the cancel arrived" : null,
    });
    // Read BACK, never assumed: the patch above is refused for a run something
    // else has already ended (the target was removed while this was finishing,
    // §6.1). Such a run keeps no Undo — its card offers none, so the copy the
    // write made is unreachable — and says nothing in the toast, which would
    // announce a result on a layer that is gone.
    if (runById(id)?.status !== "done") {
      discardUndo(id);
      return;
    }
    useProcessingStore.getState().pushNotice(summary.line);
  } catch (error) {
    // The target-removal watcher aborts the run AND says why (§6.1's "Layer
    // removed"). Its abort is what lands here, so the reason it wrote outranks
    // the plain cancel this would otherwise report.
    if (failedAlready(id)) return;
    if (error instanceof EngineDeadError) {
      // Normally the watcher has already written this — it fails every live run
      // on the same death, and `patch` refuses a second status. Spelled here
      // too, so a run ends with §6.1's sentence even when it is the await that
      // noticed first.
      patch(id, {
        status: "failed",
        phase: null,
        error: ENGINE_STOPPED,
        elapsedMs: elapsed(),
      });
      return;
    }
    if (error instanceof CancelledError || signal.aborted) {
      patch(id, {
        status: "cancelled",
        phase: null,
        elapsedMs: elapsed(),
        log: [...log],
      });
      return;
    }
    patch(id, {
      status: "failed",
      phase: null,
      elapsedMs: elapsed(),
      error: error instanceof Error ? error.message : String(error),
      log: [...log],
    });
  } finally {
    controllers.delete(id);
  }
}

/**
 * Cancel a queued or running run.
 *
 * A queued run is cancelled outright — nothing has happened yet. A running one
 * goes to "cancelling" and the abort travels to the executor, which may still
 * finish first (spec §6.1): there is no way to un-commit a transaction that has
 * already gone through, so the run is published with a note instead.
 */
export function cancelRun(id: string): void {
  const run = runById(id);
  if (!run) return;
  const controller = controllers.get(id);
  if (run.status === "queued") {
    controller?.abort();
    patch(id, { status: "cancelled" });
    return;
  }
  if (run.status === "running") {
    patch(id, { status: "cancelling" });
    controller?.abort();
  }
}

/**
 * Put the layer back the way the run found it, if it still can.
 *
 * On the table queue for the same reason the write was: an Undo is `UPDATE` +
 * `DROP COLUMN` over a table a streaming layer may be rebuilding.
 *
 * The re-DESCRIBE is part of the SAME queued task, not a step after it: the very
 * next thing the user does is "Run again", and a run that reaches the head while
 * the registry still lists the column this Undo dropped classifies it as a column
 * to REPLACE — it backs up a column that is gone and its own Undo then restores
 * nothing.
 */
export async function undoRun(id: string): Promise<void> {
  const run = runById(id);
  const state = undoState.get(id);
  if (!run || !run.undoable || !state) return;
  const out = await runOnTableQueue(async () => {
    // Re-validated at the head, exactly like a run's scope: while this Undo
    // waited, a later run over the same column may have published (§6.2) or a
    // rebuild may have retired the card. Its backup then describes the state two
    // writes ago, and restoring it would delete what the later run wrote — so the
    // card, which already reads `undoable: false`, is left as it is.
    const current = runById(id);
    if (!current?.undoable || !undoState.has(id)) return null;
    const undone = await undoComputedColumns({
      table: state.table,
      backupTable: state.backupTable,
      created: state.created,
      replaced: state.replaced,
      ids: state.ids,
    });
    if (undone.ok) await refreshLayerTableColumns(run.targetLayerId);
    return undone;
  });
  if (out === null) return;
  if (!out.ok) {
    // The card keeps its Undo: the table is unchanged (the undo is a
    // transaction too), so trying again is meaningful.
    patch(id, { error: out.message });
    return;
  }
  useLayerStore
    .getState()
    .mergeAttributes(run.targetLayerId, state.previousModelValues);
  const registry = useComputedColumnStore.getState();
  registry.removeColumns(run.targetLayerId, state.created);
  for (const col of state.replaced) {
    const provenance = registry.byLayer[run.targetLayerId]?.[col];
    // A replaced column goes back to the provenance it had, so the tooltip says
    // which run the values on the table now came from.
    if (provenance?.previous) {
      registry.setProvenance(run.targetLayerId, col, provenance.previous);
    } else {
      registry.removeColumns(run.targetLayerId, [col]);
    }
  }
  undoState.delete(id);
  patch(id, { undoable: false, note: "Undone" });
}

let disposeTargetWatcher: (() => void) | null = null;

/**
 * Spec §6.1: "Removing the target or the source layer during a run cancels it
 * ('Layer removed')."
 *
 * The head of the queue already refuses a run whose layer is gone, but that is
 * only checked ONCE, before the executor: a layer removed while the tool is
 * computing left the run measuring a layer the user had thrown away, and the
 * write then landed on its table. So the removal has to reach the run where it
 * is, which is what the controller is for.
 *
 * The card is patched BEFORE the abort, deliberately: the abort surfaces in
 * `execute` as an ordinary cancel, and the reason has to be on the record by
 * then for `failedAlready` to keep it.
 *
 * Installed once, by the app shell, disposing any earlier install — the same
 * single-live-installer shape as `installRuleDraftInvariants`: a hot reload
 * must not leave two watchers failing the same runs twice.
 */
export function installTargetRemovalWatcher(): () => void {
  disposeTargetWatcher?.();

  const failRunsWithoutTarget = () => {
    const layerIds = new Set(useLayerStore.getState().layers.map((l) => l.id));
    for (const run of useProcessingStore.getState().runs) {
      if (
        run.status !== "queued" &&
        run.status !== "running" &&
        run.status !== "cancelling"
      ) {
        continue;
      }
      if (layerIds.has(run.targetLayerId)) continue;
      patch(run.id, {
        status: "failed",
        phase: null,
        error: "Layer removed",
        elapsedMs: Math.max(0, Date.now() - run.startedAt),
      });
      controllers.get(run.id)?.abort();
    }
  };

  const unsubscribe = useLayerStore.subscribe((state, previous) => {
    // Only the LIST matters here; the store's other writes (a colour, a filter,
    // a merged attribute) are not removals.
    if (state.layers === previous.layers) return;
    failRunsWithoutTarget();
  });
  failRunsWithoutTarget();

  const dispose = () => {
    unsubscribe();
    if (disposeTargetWatcher === dispose) disposeTargetWatcher = null;
  };
  disposeTargetWatcher = dispose;
  return dispose;
}

let disposeEngineWatcher: (() => void) | null = null;

/**
 * Spec §6.1: "If the DuckDB engine itself dies, the running run and every
 * queued run fail with 'Analytics engine stopped'."
 *
 * The running run is ABORTED rather than awaited, because there may be nothing
 * to await: duckdb-wasm drops the promises of requests that were in flight when
 * its worker died (its own `onError` clears the pending map without rejecting),
 * so a run waiting on a query would otherwise hang for the life of the page.
 * The card is patched BEFORE the abort, as the removal watcher does it, so
 * `failedAlready` keeps this reason rather than `execute`'s cancel.
 *
 * A DEATH, not a failed boot. `duckdb.ts` publishes the same `failed` for both
 * — an offline boot with no bundle, and a worker that crashed after serving —
 * and they are not the same event: the boot failure is what the status bar's
 * Retry exists for, and treating it as a death would take every Undo away for
 * the rest of a session whose engine then came up on the second attempt. The
 * transition this watches is therefore `ready` → `failed`, which in that module
 * only `markEngineDead` produces.
 *
 * Undo is taken from every earlier run through the store's `engineStopped`
 * flag, not by patching each card: the backup tables lived in the database that
 * just died. `discardUndo` is deliberately NOT called — its `DROP TABLE` would
 * be posted at an engine that cannot answer, and there is nothing left to drop.
 */
export function installEngineWatcher(): () => void {
  disposeEngineWatcher?.();

  // The state of the PREVIOUS publication, because the event this watches is a
  // transition and not a value. `ready` → `failed` is a death; every other way
  // into `failed` is a boot that did not come up — including the status bar's
  // Retry failing (`failed` → `initializing` → `failed`), which must not fail
  // the runs a user started while the engine was coming back.
  let previous = getDuckDBStatus().state;
  const reactToStatus = () => {
    const state = getDuckDBStatus().state;
    const died = previous === "ready" && state === "failed";
    previous = state;
    if (!died) return;
    for (const run of useProcessingStore.getState().runs) {
      if (
        run.status !== "queued" &&
        run.status !== "running" &&
        run.status !== "cancelling"
      ) {
        continue;
      }
      patch(run.id, {
        status: "failed",
        phase: null,
        error: ENGINE_STOPPED,
        elapsedMs: Math.max(0, Date.now() - run.startedAt),
      });
      controllers.get(run.id)?.abort();
    }
    useProcessingStore.getState().markEngineStopped();
  };

  // `previous` is SEEDED from the current status above rather than by running
  // the body once: a shell that mounts after the engine came up needs the
  // `ready` to measure the next transition against, and a status that is
  // already `failed` at install time is a value with no transition behind it —
  // a boot that never came up and a worker that died read the same, and the
  // first of those must not strike a session's Undo. The app installs this
  // before DuckDB is asked to boot, so that case is a re-install, where the
  // watcher this one replaced has already failed the runs and set the flag.
  const unsubscribe = subscribeDuckDBStatus(reactToStatus);

  const dispose = () => {
    unsubscribe();
    if (disposeEngineWatcher === dispose) disposeEngineWatcher = null;
  };
  disposeEngineWatcher = dispose;
  return dispose;
}

/**
 * Spec §7: a REBUILT table has none of the run's columns, so every result card
 * for that layer is describing a table that no longer exists.
 *
 * The test is the table NAME (the build takes a fresh one from its counter) and
 * the building→ready transition. A re-DESCRIBE after a write publishes a new
 * `info` under the SAME name on purpose, and must not fire this.
 */
export function installStaleWatcher(): () => void {
  return useLayerTableStore.subscribe((state, previous) => {
    for (const [layerId, entry] of Object.entries(state.tables)) {
      const before = previous.tables[layerId];
      const rebuilt =
        entry.state === "ready" &&
        ((before?.state === "ready" &&
          before.info.table !== entry.info.table) ||
          before?.state === "building");
      if (!rebuilt) continue;
      for (const run of useProcessingStore.getState().runs) {
        if (
          run.targetLayerId === layerId &&
          run.status === "done" &&
          !run.stale
        ) {
          patch(run.id, { stale: true, undoable: false });
          discardUndo(run.id);
        }
      }
      useComputedColumnStore.getState().clearLayer(layerId);
    }
  });
}
