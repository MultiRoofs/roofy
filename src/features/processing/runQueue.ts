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

import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import { quoteIdent } from "../../insights/sql";
import {
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

/** Thrown by the context when the user cancelled; never surfaced as an error. */
class CancelledError extends Error {}

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

function scopeLabel(scope: Scope, count: number): string {
  const n = plural(count, "building", "buildings");
  return scope === "all"
    ? `All ${n}`
    : scope === "matching"
      ? `Matching ${n}`
      : `Selected ${n}`;
}

const patch = (id: string, p: Partial<RunRecord>) =>
  useProcessingStore.getState().patchRun(id, p);

/**
 * Queue a run and return its id immediately.
 *
 * The card exists before the work does, deliberately: the panel shows "Queued"
 * for a run behind a table build, and a user who pressed Run has something to
 * cancel from the first frame.
 */
export function submitRun(request: RunRequest): string {
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
  for (const gone of before) if (!held.has(gone)) discardUndo(gone);
  const controller = new AbortController();
  controllers.set(id, controller);
  const frozen: FrozenRequest = {
    ...request,
    snapshot: snapshotScopeInputs(request.targetLayerId),
    tableName: getLayerTable(request.targetLayerId)?.table ?? null,
  };
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
    const executor = EXECUTORS[request.toolId];
    if (!executor) {
      patch(id, {
        status: "failed",
        error: "Not available yet",
        elapsedMs: elapsed(),
      });
      return;
    }

    const scope = await resolveScope({
      table,
      scope: request.scope,
      snapshot: request.snapshot,
    });
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
      patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
      return;
    }
    patch(id, {
      status: "running",
      phase: "compute",
      featureIds: scope.featureIds,
      scopeCount: scope.count,
      startedAt: Date.now(),
    });

    const ctx: ToolContext = {
      table,
      layer,
      featureIds: scope.featureIds,
      signal,
      async query(label, sql) {
        if (signal.aborted) throw new CancelledError();
        const t0 = performance.now();
        const out = await runQuery(sql);
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
    const result = await executor(record, ctx);
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
      useProcessingStore.getState().pushNotice(summary.line);
      return;
    }

    patch(id, { phase: "write" });
    const existing = new Set(table.columns.map((c) => c.name));
    const t0 = performance.now();
    const written = await writeComputedColumns({
      runId: id,
      table: table.table,
      columns: result.columns,
      rows: result.rows,
      existing,
      // Spec §6.1: the write is the publication, so the LAST moment a cancel
      // can still mean "nothing changed" is inside it, before its COMMIT.
      signal,
    });
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

    const tool = toolById(request.toolId);
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
        other.columns.some((name) =>
          result.columns.some((c) => c.name === name),
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
    await refreshLayerTableColumns(layer.id);

    const summary = summarise(result, elapsed());
    patch(id, {
      status: "done",
      phase: null,
      elapsedMs: elapsed(),
      summary,
      log: [...log],
      undoable: true,
      // Spec §6.1: a cancel that lost the race is told, not hidden — the user
      // pressed Cancel and the results appeared anyway.
      note: signal.aborted ? "finished before the cancel arrived" : null,
    });
    useProcessingStore.getState().pushNotice(summary.line);
  } catch (error) {
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
