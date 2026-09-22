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
  subscribeDuckDBStatus,
  isExtensionLoaded,
  runQuery,
  type QueryOutcome,
} from "../../insights/duckdb";
import {
  CancelledError,
  EngineDeadError,
  raced,
} from "../../insights/engineAwait";
import { quoteIdent } from "../../insights/sql";
import {
  computedColumnsOf,
  migrationRefusal,
  typeMigrations,
  undoComputedColumns,
  type ExistingColumn,
  useComputedColumnStore,
  writeComputedColumns,
  type ColumnType,
  type OutputColumn,
} from "../../insights/computedColumns";
import {
  getLayerTable,
  parseTableKey,
  refreshLayerTableColumns,
  resolveActiveTable,
  runOnTableQueue,
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import {
  useLayerStore,
  type DerivedFrom,
  type Layer,
} from "../layers/layerStore";
import {
  GEO_PROPERTY_ABSENT,
  restoreGeoDocumentProperties,
  useGeoLayerStore,
  type GeoJsonLayer,
  type GeoPreviousValues,
} from "../geoLayers/geoLayerStore";
import {
  geoRecordId,
  geoRecords,
  type GeoRecord,
} from "../geoLayers/geoRecords";
import { ensureModelCrsLoadable } from "../layers/ensureCrs";
import { getActiveFamily } from "../layers/familyStore";
import { epsgForLayer } from "../../scene/cursorCrsReadout";
import { SOURCE_NEEDS_AREAS } from "./crossLayerParams";
import {
  derivedLayerName,
  prepareDerivedCityLayer,
  prepareDerivedVectorLayer,
  STREAMING_NO_NEW_LAYER,
} from "./deriveLayer";
import {
  preflightWarnings,
  reprojectGeoLayer,
  type VectorPreflight,
} from "./vectorSource";
import { createVectorTable, type VectorTableHandle } from "./vectorTable";
import { runById, useProcessingStore } from "./processingStore";
import { resolveScope, snapshotScopeInputs, type ScopeSnapshot } from "./scope";
import { toolById } from "./toolRegistry";
import { EXECUTORS } from "./tools";
import "./tools/register";
import type {
  LogEntry,
  RunPhase,
  RunRecord,
  RunStatus,
  RunSummary,
  Scope,
  SkipCount,
  ToolDestination,
  ToolId,
} from "./types";

export interface RunRequest {
  readonly toolId: ToolId;
  /** The layer the results are WRITTEN to (spec §3's "target"). */
  readonly targetLayerId: string;
  /** The second layer the run READS (spec §3's "source"), or null. */
  readonly sourceLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  readonly columns: ReadonlyArray<OutputColumn>;
  /** §6's "Write to", frozen at Run and re-validated at the head. */
  readonly destination: ToolDestination;
  /** §6's Name field, frozen; null for `destination === "layer"`. */
  readonly newLayerName: string | null;
}

/** A {@link RunRequest} plus everything `submitRun` froze for it. */
interface FrozenRequest extends RunRequest {
  readonly snapshot: ScopeSnapshot;
  /**
   * The layer whose TABLE the run reads and whose FIFO slot it holds.
   *
   * `sourceLayerId` for a vector-TARGET tool, else `targetLayerId`. EVERY read
   * of `targetLayerId` inside the queue is really a read of this — the scope
   * snapshot, the frozen `tableName`, the "Layer removed" / "Layer changed
   * while running" pre-flights and the stale watcher — because a vector layer
   * has no table to compute over (Design decision (c)). The target-removal
   * watcher is the exception: it checks BOTH ids, since §6.1 cancels a run when
   * either layer goes away.
   */
  readonly computeLayerId: string;
  /** The COMPUTE layer's table name at Run; a different one at the head is a
   *  rebuild. */
  readonly tableName: string | null;
  /**
   * WHICH of the compute layer's tables this run owns — the CityParquet object
   * family, or `null` for a single-table layer (R-C′).
   *
   * Frozen with the name above, and for a reason the name alone cannot cover: a
   * user who switches family mid-run would otherwise have the head, the
   * post-write re-DESCRIBE and the stale watcher all re-resolve "the active
   * table" and silently retarget the run onto a different family's view.
   */
  readonly familyKey: string | null;
}

/**
 * Where a run WRITES (spec §3's "target").
 *
 * A city target carries its table, because the write is `ALTER TABLE` +
 * `UPDATE` over it. A vector target carries its RECORDS instead: a geo layer
 * has no table and no model, and what the app holds is the document — so the
 * executor is handed the same `GeoRecord` list the records panel builds, keyed
 * by the stable feature id the results come back under (Design decision (c)).
 *
 * The vector arm is `GeoJsonLayer`, not `GeoLayer`: every consumer reads
 * `layer.config.preparedData`, and the raster and tiles arms have no such field.
 * `execute` narrows once, at the resolution below, so nothing downstream casts.
 */
export type ToolTarget =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly records: ReadonlyArray<GeoRecord>;
    };

/**
 * The SECOND layer a cross-layer run reads, or null for a one-layer tool.
 *
 * A city source is by construction the COMPUTE layer (`submitRun` points
 * `computeLayerId` at it), so it is the same `layer`/`table` pair `ToolContext`
 * carries — spelled out because an executor should not have to know that. A
 * VECTOR source is the per-run `__src_<runId>` table plus what preflight
 * learned about it, and it is built in the `"source"` phase (Task 13).
 */
export type ToolSource =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly table: string;
      readonly propertyKeys: ReadonlyArray<string>;
      /** The SOURCE's property types, as preflight inferred them — the ONE
       *  answer the form also used, so the columns the executor declares are
       *  the columns the frozen request promised (§7.5). */
      readonly propertyTypes: ReadonlyMap<string, ColumnType>;
      readonly skipped: number;
    };

/**
 * What a tool executor is handed. Everything a tool needs and nothing it does
 * not: no store, no engine, no run id — the log, the phase and the warnings all
 * reach the card through these three methods.
 */
export interface ToolContext {
  /**
   * The layer whose TABLE the compute reads. For a vector-TARGET tool this is
   * the SOURCE city layer; for every other tool it is `target.layer`. The two
   * M2 executors read only these and are unaffected.
   */
  readonly table: LayerTable;
  readonly layer: Layer;
  /** Where the run WRITES. */
  readonly target: ToolTarget;
  readonly source: ToolSource | null;
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
   * queries. `CancelledError` is not reachable from an executor on purpose: it is
   * what makes `execute`'s catch read "cancelled" rather than "failed", and an
   * executor must not be able to fake either — it throws through this method or
   * not at all.
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
  /**
   * Spec §6.2: the card's OWN first phrase, when "N buildings measured" is not
   * what this tool measured — "1,143 buildings joined" (§7.5), "6 areas
   * aggregated over 1,204 buildings" (§7.6), "1,079 valid" (§7.3). Absent for
   * a tool whose line is the default, which Measure solids' is.
   */
  readonly line?: string;
  /**
   * §6.2's CAVEATS: objects that WERE evaluated, with something withheld —
   * "37 invalid solids (no volume)". Distinct from `skipped`, which is "could
   * not be evaluated" and NULL everywhere. Optional: the M1 and M2 executors
   * have none and say nothing.
   */
  readonly caveats?: ReadonlyArray<SkipCount>;
}

export type ToolExecutor = (
  run: RunRecord,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** Spec §6.1's sentence for a run the engine's death took. */
const ENGINE_STOPPED = "Analytics engine stopped";

/**
 * The abort+death race, and the two error classes it rejects with, live in
 * `insights/engineAwait.ts`: the TABLE BUILDS need exactly the same protection
 * — duckdb-wasm strands the requests that were in flight when its worker died,
 * and a build sitting on one holds the shared FIFO for the life of the page —
 * and two copies of that race would be two answers to one hazard.
 *
 * `signal` is null for the awaits at and past this module's point of no return.
 * A user's Cancel during the write is decided INSIDE the write — its pre-COMMIT
 * check, and §6.1's "finished before the cancel arrived" when the COMMIT won
 * the race — and the DESCRIBE that follows it is past the COMMIT, where the
 * columns are on the table whatever the signal says. Only the death may take
 * those two.
 */

const controllers = new Map<string, AbortController>();

/**
 * What an Undo needs to put a layer back, per destination kind.
 *
 * A CITY run's Undo is a transaction over a table plus the model values it
 * overwrote. A VECTOR run's is a per-feature record of what THIS run's columns
 * held before it wrote (§7.6). Two shapes and one Map, because §6.2's Undo is
 * one button whichever kind of layer it is about.
 */
type UndoState =
  | {
      readonly kind: "city";
      readonly table: string;
      readonly backupTable: string | null;
      readonly created: ReadonlyArray<string>;
      readonly replaced: ReadonlyArray<string>;
      /** The columns the write re-typed, at the type they had before (S2). */
      readonly migrated: ReadonlyArray<ExistingColumn>;
      readonly ids: ReadonlyArray<string> | null;
      /** The model attributes the run overwrote; `undefined` for "was not there". */
      readonly previousModelValues: ReadonlyMap<
        string,
        Record<string, unknown>
      >;
    }
  | {
      readonly kind: "vector";
      readonly layerId: string;
      /**
       * Per feature, what THIS run's columns held before it wrote — with
       * `GEO_PROPERTY_ABSENT` for a property the feature did not have.
       *
       * Not the document: two runs writing disjoint columns onto one layer are
       * both undoable (Undo is stolen only where they share a column), so a
       * snapshot-restore of run A would erase run B's results behind its back.
       * This is `previousModelValues`' exact analogue for a vector layer.
       */
      readonly previousValues: GeoPreviousValues;
      /** WHICH document these values belong to. Not `preparedData` — a later
       *  run's disjoint merge moves that identity and must not block this
       *  Undo — but the SOURCE the layer was prepared from: a re-link replaces
       *  it, and the ids this Undo holds then name features of another file. */
      readonly source: GeoSourceIdentity;
      readonly created: ReadonlyArray<string>;
      readonly replaced: ReadonlyArray<string>;
    };

/** The three fields that say WHICH document a GeoJSON layer is showing —
 *  `geoSelectionRefresh.ts` compares the same three for the same reason. */
interface GeoSourceIdentity {
  readonly data: unknown;
  readonly url: string | undefined;
  readonly preparationEpoch: number | undefined;
}

function geoSourceIdentity(layer: GeoJsonLayer): GeoSourceIdentity {
  return {
    data: layer.config.data,
    url: layer.config.url,
    preparationEpoch: layer.config.preparationEpoch,
  };
}

function sameGeoSource(
  layer: GeoJsonLayer,
  source: GeoSourceIdentity,
): boolean {
  return (
    layer.config.data === source.data &&
    layer.config.url === source.url &&
    layer.config.preparationEpoch === source.preparationEpoch
  );
}

/**
 * What Undo MEANS for a run, which is a question about its DESTINATION (§6.2).
 *
 * "This layer": columns the run created are dropped and columns it replaced
 * get their previous values back — from a backup table for a city target, from
 * the captured per-feature values for a vector one. That is {@link UndoState},
 * which already discriminates on `kind: "city" | "vector"`.
 * "New layer": the whole Undo is removing the layer — nothing was written to
 * the target, so there is no backup and nothing to restore.
 *
 * NESTED, not intersected: `{ kind: "columns" } & UndoState` is `never`,
 * because `UndoState`'s own `kind` is already `"city" | "vector"` and no value
 * can carry both. So the destination's discriminant wraps the target's, and
 * the two questions stay separable — "what does Undo mean here" and "what kind
 * of thing does it put back".
 */
type RunUndo =
  | { readonly kind: "columns"; readonly state: UndoState }
  | {
      readonly kind: "layer";
      readonly layerId: string;
      /** The PARENT's table, for the record — nothing reads it to undo. */
      readonly table: string;
      /**
       * Provenance run ids the copy carried at publication: the inherited ones
       * plus this run's. A column whose provenance names any OTHER run is one
       * the derived layer grew afterwards, which §6.2 blocks the Undo on.
       */
      readonly runIds: ReadonlySet<string>;
    };

const undoState = new Map<string, RunUndo>();
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

/**
 * A skip or caveat cause, singular at a count of one (gate defect F2).
 *
 * The ONE chooser, used by the head line's caveats and by the muted skip line
 * alike: a cause that reads "1 invalid solids (no volume)" on the head while
 * the line under it says "1 not a solid" is the inconsistency this closes.
 * A cause with no `one` carries no count noun and reads the same either way.
 */
function causeOf(entry: SkipCount): string {
  return entry.count === 1 ? (entry.one ?? entry.cause) : entry.cause;
}

/** Spec §10 scenario 4: a streaming run's card says what it ran over. */
const RESIDENT_SET_NOTE =
  "Over the resident set: the buildings loaded when the run started.";

/** Spec §6.1: "2 buildings measured · 14 skipped · 2.4 s". */
export function summarise(
  result: ToolResult,
  elapsedMs: number,
  options: { readonly streaming: boolean },
): RunSummary {
  const skippedTotal = result.skipped.reduce((a, s) => a + s.count, 0);
  const parts = [
    result.line ??
      plural(result.measured, "building measured", "buildings measured"),
  ];
  // §6.2's order, from the mockup's own card: "1,115 buildings measured · 37
  // invalid solids (no volume) · 12 skipped · 2.4 s". A caveat sits between the
  // measured count and the skipped count because it qualifies the first and is
  // not part of the second.
  for (const caveat of result.caveats ?? []) {
    parts.push(`${fmt(caveat.count)} ${causeOf(caveat)}`);
  }
  if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
  parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);

  const detailParts: string[] = [];
  if (options.streaming) detailParts.push(RESIDENT_SET_NOTE);
  if (skippedTotal > 0) {
    detailParts.push(
      `${fmt(skippedTotal)} skipped: ${result.skipped
        .map((s) => `${fmt(s.count)} ${causeOf(s)}`)
        .join(" · ")}`,
    );
  }

  // Every written column, in ONE pass: §6.2's "All values are empty" is about
  // the column the tool's `styleByResult` CHOOSES, which is not always the
  // first one written (Validate solids styles `<prefix>valid`, its fourth).
  const nonNullByColumn: Record<string, number> = {};
  for (const col of result.columns) nonNullByColumn[col.name] = 0;
  for (const values of result.rows.values()) {
    for (const col of result.columns) {
      const value = values[col.name];
      if (value !== null && value !== undefined) {
        nonNullByColumn[col.name] = (nonNullByColumn[col.name] ?? 0) + 1;
      }
    }
  }

  return {
    line: parts.join(" · "),
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    measured: result.measured,
    skipped: result.skipped,
    nonNullByColumn,
  };
}

/**
 * Spec §6.2's New-layer card: "Created Delft · solids · 312 buildings · 37
 * invalid solids (no volume) · 2.4 s".
 *
 * It DELEGATES to {@link summarise} and replaces the head segment rather than
 * rebuilding the line, so the caveat and skipped segments stay in one place: a
 * tool that adds one gets it on both destinations for free. The count is the
 * FEATURES the copy holds (the frozen scope), not the measured count — the
 * sentence is about the layer that now exists.
 *
 * `features === null` keeps the tool's own head segment instead, for a copy
 * whose head already names what it holds: §7.6's card is "6 areas aggregated
 * over 1,204 buildings", where the 6 are the target AREAS the copy holds and
 * the 1,204 are the SOURCE's buildings. Replacing that with a building count
 * would put the source's number on the created layer — the one number on the
 * card that would be about another layer. Both branches are spec-verbatim
 * fragments: §6.2's "Created <name>" and, for the second, §7.6's own line.
 */
export function summariseCreated(
  result: ToolResult,
  elapsedMs: number,
  layerName: string,
  features: number | null,
  options: { readonly streaming: boolean },
): RunSummary {
  const base = summarise(result, elapsedMs, options);
  const segments = base.line.split(" · ");
  return {
    ...base,
    line:
      features === null
        ? [`Created ${layerName}`, ...segments].join(" · ")
        : [
            `Created ${layerName}`,
            plural(features, "building", "buildings"),
            ...segments.slice(1),
          ].join(" · "),
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
  // For a vector-TARGET tool the compute ground is the SOURCE city layer: it
  // owns the table, the scope and the FIFO slot. `sourceLayerId` may be null
  // for a malformed request (the form's `canRun` blocks it); the head refuses
  // it with §5's own reason rather than resolving a table for a vector id.
  const computeLayerId =
    toolById(request.toolId).target === "vector"
      ? (request.sourceLayerId ?? request.targetLayerId)
      : request.targetLayerId;
  // ONE resolution, frozen: the table AND the family it belongs to, so every
  // later step addresses exactly what the user pressed Run over — the family the
  // panel was SHOWING, not whichever one the manifest happened to list first.
  const active = resolveActiveTable(
    computeLayerId,
    getActiveFamily(computeLayerId),
  );
  return queueRun({
    ...request,
    computeLayerId,
    snapshot: snapshotScopeInputs(computeLayerId),
    tableName: active?.info.table ?? null,
    familyKey: active?.familyKey ?? null,
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
    // The layer as it is NOW, but the SAME family: a retry repeats the run the
    // user made, and re-resolving the active family would aim it somewhere else.
    tableName:
      getLayerTable(frozen.computeLayerId, frozen.familyKey)?.table ?? null,
  });
}

/**
 * A layer's name, whichever store it lives in.
 *
 * Two stores and one run: the target of an Aggregate run is a `GeoLayer` and
 * its source is a `Layer`, and the card, the history's "← source" line and
 * §6.4's log header all read the NAMES. `null` when the id names neither, which
 * the head's pre-flights then report as "Layer removed".
 */
function layerNameOf(layerId: string | null): string | null {
  if (layerId === null) return null;
  const city = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (city) return city.name;
  return (
    useGeoLayerStore.getState().layers.find((l) => l.id === layerId)?.name ??
    null
  );
}

/**
 * A layer's OWN ancestry, whichever store it lives in — §6.2's `derivedFrom`.
 *
 * Read once, at Run, and frozen onto the record: [adapted copy A7]'s log row
 * has to survive the target being removed, and a derived layer is a derived
 * layer whether its row is a `Layer` or a `GeoLayer`.
 */
function derivedFromOf(layerId: string): DerivedFrom | null {
  return (
    useLayerStore.getState().layers.find((l) => l.id === layerId)
      ?.derivedFrom ??
    useGeoLayerStore.getState().layers.find((l) => l.id === layerId)
      ?.derivedFrom ??
    null
  );
}

/** Does either store still hold this id? §6.1's removal pre-flight. */
function layerExists(layerId: string): boolean {
  return (
    useLayerStore.getState().layers.some((l) => l.id === layerId) ||
    useGeoLayerStore.getState().layers.some((l) => l.id === layerId)
  );
}

function queueRun(frozen: FrozenRequest): string {
  const request: RunRequest = frozen;
  const id = `run_${++counter}`;
  const record: RunRecord = {
    id,
    toolId: request.toolId,
    targetLayerId: request.targetLayerId,
    targetName: layerNameOf(request.targetLayerId) ?? "?",
    targetDerivedFrom: derivedFromOf(request.targetLayerId),
    sourceLayerId: request.sourceLayerId,
    sourceName: layerNameOf(request.sourceLayerId),
    scope: request.scope,
    scopeCount: 0,
    featureIds: null,
    lod: request.lod,
    params: request.params,
    prefix: request.prefix,
    columns: request.columns.map((c) => c.name),
    destination: request.destination,
    newLayerName: request.newLayerName,
    newLayerId: null,
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
  // A New-layer run's Undo holds no backup table — its whole undo is removing
  // the layer, and the layer's own table goes with it through
  // `layerTableLifecycle`'s removal branch. There is nothing to drop here.
  if (state.kind === "layer") return;
  // A VECTOR run's Undo holds no database resource at all — its copy is one
  // JavaScript object, which the Map delete above has already released.
  if (state.state.kind !== "city") return;
  const backup = state.state.backupTable;
  if (!backup) return;
  // On the queue, like every other statement about a layer table, and NOT
  // awaited: dropping a backup is housekeeping, never something a card waits on.
  //
  // RACED all the same, and that is the point of racing it: nothing here waits
  // for the DROP, but the QUEUE does. A drop caught by the engine's death never
  // answers (duckdb-wasm drops the promises of the requests that were in flight),
  // and an unraced one would hold the shared FIFO — every later run and every
  // later table build behind it — for the life of the page. The rejection is
  // swallowed because there is nothing to say: the table died with the database.
  void runOnTableQueue(() =>
    raced(runQuery(`DROP TABLE IF EXISTS ${quoteIdent(backup)}`), null),
  ).catch(() => {});
}

/** Spec §7's provenance, for whichever layer the results landed on. */
function publishProvenance(
  runId: string,
  layerId: string,
  result: ToolResult,
  toolName: string,
  request: FrozenRequest,
  scope: {
    readonly featureIds: ReadonlyArray<string> | null;
    readonly count: number;
    readonly total: number;
  },
): void {
  for (const col of result.columns) {
    const registry = useComputedColumnStore.getState();
    const previous = registry.byLayer[layerId]?.[col.name] ?? null;
    registry.setProvenance(layerId, col.name, {
      runId,
      toolName,
      summary: `${request.lod ? `LoD ${request.lod} · ` : ""}${scopeLabel(
        request.scope,
        scope.count,
      )}`,
      at: Date.now(),
      // FEATURES on both sides of "312 of 1,115": `rows` are ROWS (a Building
      // and its parts), and the tooltip would read as more than the layer has.
      // A derived layer's scope "all" now resolves to ITS OWN row ids rather
      // than null (`resolveScope`, Task 21), so "kept no id list" is no
      // longer the same question as "covered the whole layer". Compared on
      // the COUNTS, which is what the tooltip is about.
      partial:
        scope.featureIds === null || scope.count >= scope.total
          ? null
          : { count: scope.count, total: scope.total },
      previous,
    });
  }
}

/**
 * §6.1's re-validation for a VECTOR SOURCE, asked at the publication boundary.
 *
 * The areas are read ONCE, before the compute: they are reprojected into the
 * target's CRS and written to a per-run table, and every value the run produces
 * is measured against that snapshot. A re-link in the meantime replaces the
 * document — other areas, other attributes, other stable ids — so publishing
 * afterwards would write numbers about a Zones the user can no longer see, and
 * the column's provenance would name a source that no longer exists.
 *
 * The TARGET has been checked this way since Task 18; the SOURCE was not, and
 * the removal watcher only sees removals. The identity compared is the same
 * one the target's check uses — `config.preparedData`, which re-linking
 * replaces — so the two cannot come to disagree about what "changed" means.
 *
 * Returns the SENTENCE to fail with, or null when the source stood still (and
 * for a city source, which has no document).
 */
function vectorSourceMoved(source: ToolSource | null): string | null {
  if (source === null || source.kind !== "vector") return null;
  const live = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === source.layer.id);
  if (live === undefined || live.kind !== "geojson") return "Layer removed";
  return live.config.preparedData === source.layer.config.preparedData
    ? null
    : "Layer changed while running; run again";
}

/**
 * Spec §6.2: only ONE run can own a column's Undo. An earlier run whose column
 * this run has just overwritten can no longer restore anything — its backup
 * describes a state two writes ago.
 */
function stealUndo(runId: string, layerId: string, result: ToolResult): void {
  for (const other of useProcessingStore.getState().runs) {
    if (
      other.id !== runId &&
      other.targetLayerId === layerId &&
      // A NEW-LAYER run wrote nothing to this layer — its `targetLayerId` is
      // the parent it copied FROM. Its Undo removes the copy, and no write
      // here can make that stale (§6.2's own block is the run-history scan
      // in `newLayerUndoBlock`).
      other.newLayerId === null &&
      other.undoable &&
      // Case-insensitively, like every other comparison between column names:
      // an earlier run recorded under a different spelling still owns the
      // column this run has just overwritten.
      other.columns.some((name) =>
        result.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()),
      )
    ) {
      patch(other.id, { undoable: false });
      discardUndo(other.id);
    }
  }
}

/**
 * The registry half of §6.2's Undo: created columns go, replaced ones go back
 * to the provenance they had. The same for both destinations.
 */
function rollBackProvenance(
  layerId: string,
  created: ReadonlyArray<string>,
  replaced: ReadonlyArray<string>,
): void {
  const registry = useComputedColumnStore.getState();
  registry.removeColumns(layerId, created);
  for (const col of replaced) {
    const provenance = registry.byLayer[layerId]?.[col];
    // A replaced column goes back to the provenance it had, so the tooltip says
    // which run the values on the layer now came from.
    if (provenance?.previous) {
      registry.setProvenance(layerId, col, provenance.previous);
    } else {
      registry.removeColumns(layerId, [col]);
    }
  }
}

/** Spec §6.2's reason a finished New-layer run can no longer be undone. */
const USED_BY_LATER_RUN =
  "Used by a later run; remove the layer from the layer list instead";

/**
 * The statuses §6.2 counts as a later run USING the copy: "queued, running or
 * done".
 *
 * A run that FAILED (refused at the head for a bad prefix, a removed source, a
 * rebuilt table) or was CANCELLED never wrote anything and never will, so it
 * cannot be the reason a user may no longer remove an otherwise untouched
 * layer with one press. `cancelling` is on the list although §6.2 does not
 * name it: it is a RUNNING run that has been asked to stop and may still
 * commit — §6.1's "finished before the cancel arrived" — so treating it as
 * already gone would let the Undo remove a layer a live run is mid-publication
 * over.
 */
const USES_THE_COPY: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "queued",
  "running",
  "cancelling",
  "done",
]);

/**
 * §6.2: "Undo of a New-layer run is available only while the derived layer is
 * untouched as data: it has not been the target or source of any later run
 * (queued, running or done) and has no computed columns of its own. Renaming
 * or restyling it does not block Undo."
 *
 * Null for a This-layer run — that Undo has its own rules — and null when the
 * block does not apply, so the card can use it directly as its disabled reason.
 */
export function newLayerUndoBlock(run: RunRecord): string | null {
  const layerId = run.newLayerId;
  if (layerId === null) return null;
  const used = useProcessingStore
    .getState()
    .runs.some(
      (other) =>
        other.id !== run.id &&
        USES_THE_COPY.has(other.status) &&
        (other.targetLayerId === layerId || other.sourceLayerId === layerId),
    );
  if (used) return USED_BY_LATER_RUN;
  const state = undoState.get(run.id);
  // No recorded state (an engine restart, an eviction): the card's `undoable`
  // is the authority and this adds no reason of its own. `kind !== "layer"` is
  // the same silence for a This-layer run, whose Undo has its own rules.
  if (state === undefined || state.kind !== "layer") return null;
  const grown = Object.values(
    useComputedColumnStore.getState().byLayer[layerId] ?? {},
  ).some((p) => !state.runIds.has(p.runId));
  return grown ? USED_BY_LATER_RUN : null;
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

/**
 * §6.4's "the SQL statements issued in order", for a write step.
 *
 * ONE entry per statement, labelled `Writing results (1/6)` … so the log reads
 * as the transaction it was and a planner can repeat the UPDATE by hand. The
 * TIMING is the whole write's and is carried by the LAST entry only:
 * `writeComputedColumns` measures the transaction, not each statement, and
 * repeating one number six times would read as six slow statements.
 *
 * Shared, because a New-layer run writes its columns into the COPY through the
 * same `writeComputedColumns` — from inside `prepareDerivedCityLayer` — and a
 * derived run whose log stopped at `CREATE TABLE` would be the one run §6.4's
 * promise is not true for. Called on FAILURE too: the statements a failed
 * write got through are exactly what a bug report needs.
 *
 * An EMPTY list is the write that never reached the engine (its buffer
 * registration failed), and it keeps M1's single entry — there is no statement
 * to name, and a missing step would read as a write that never happened.
 */
function logWriteStatements(
  log: LogEntry[],
  statements: ReadonlyArray<string>,
  ms: number,
  rows: number,
): void {
  if (statements.length === 0) {
    log.push({ label: "Writing results", sql: null, ms, rows });
    return;
  }
  statements.forEach((sql, i) => {
    const last = i === statements.length - 1;
    log.push({
      label: `Writing results (${i + 1}/${statements.length})`,
      sql,
      ms: last ? ms : 0,
      rows: last ? rows : null,
    });
  });
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
  // The run's own `__src_<id>` table, dropped in the `finally` below on EVERY
  // exit path — done, failed, cancelled, the engine's death.
  let vectorSourceHandle: VectorTableHandle | null = null;
  /**
   * `ctx.query`, lifted out of the context literal: the `"source"` phase issues
   * the CREATE before the context exists, and §6.4's log must hold that
   * statement like any other.
   */
  const query = async (label: string, sql: string): Promise<QueryOutcome> => {
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
  };
  /**
   * A run that matched nothing: §6.2's card with no Undo and nothing written.
   *
   * ONE answer for all three publications — the vector one, the city write and
   * §6.1's New-layer branch — because "nothing matched" is the same fact
   * whatever the destination: the write's `UPDATE … WHERE "id" IN ()` is a
   * SYNTAX error, and a run that measured nothing has no column to own. So it
   * is a DONE run with a summary, not a failure.
   */
  const doneWithNothing = (result: ToolResult, streaming: boolean): void => {
    const summary = summarise(result, elapsed(), { streaming });
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
  };
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

    const tool = toolById(request.toolId);
    // A destination the tool does not offer has not shipped yet, which is the
    // same fact an unimplemented tool reports and so reads with the same
    // sentence. It is checked before anything is resolved, because it depends
    // on nothing but the request.
    if (request.destination === "new" && !tool.destinations.includes("new")) {
      patch(id, {
        status: "failed",
        error: "Not available yet",
        elapsedMs: elapsed(),
      });
      return;
    }
    // §5's own reason, at the head: a vector-target tool with no source has no
    // compute ground at all, and resolving a city table for a vector layer id
    // would report "Layer removed" about a layer that is right there.
    if (tool.sourceKind !== null && request.sourceLayerId === null) {
      patch(id, {
        status: "failed",
        error:
          tool.sourceKind === "vector"
            ? "Add a vector layer to join with"
            : "Add a city model layer to aggregate",
        elapsedMs: elapsed(),
      });
      return;
    }
    // §6.1: "Removing the target or the source layer during a run cancels it."
    // Checked for BOTH ids, in whichever store each lives in.
    if (
      !layerExists(request.targetLayerId) ||
      (request.sourceLayerId !== null && !layerExists(request.sourceLayerId))
    ) {
      patch(id, {
        status: "failed",
        error: "Layer removed",
        elapsedMs: elapsed(),
      });
      return;
    }
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === request.computeLayerId);
    if (!layer) {
      patch(id, {
        status: "failed",
        error: "Layer removed",
        elapsedMs: elapsed(),
      });
      return;
    }
    // The FROZEN family, never "whatever is active": a family switch while this
    // run sat in the queue must not retarget it.
    const table = getLayerTable(request.computeLayerId, request.familyKey);
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
    // Where the run WRITES, which for Aggregate is not where it computes.
    let target: ToolTarget;
    if (tool.target === "city") {
      target = { kind: "city", layer, table };
    } else {
      const geo = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === request.targetLayerId);
      if (!geo || geo.kind !== "geojson") {
        patch(id, {
          status: "failed",
          error: "Layer removed",
          elapsedMs: elapsed(),
        });
        return;
      }
      target = {
        kind: "vector",
        layer: geo,
        records: geoRecords(geo.config.preparedData),
      };
    }
    // §6's A2 refusal, the head's copy of it. The form disables the radio, but
    // the DRAFT keeps `destination: "new"` across a retarget onto a streaming
    // layer, and `retryRun` replays a request frozen before one. Only a CITY
    // destination can be streaming: a vector copy is a GeoJSON document, and
    // `target.kind === "vector"` means the parent is the vector layer.
    if (
      request.destination === "new" &&
      target.kind === "city" &&
      target.layer.isStreaming
    ) {
      patch(id, {
        status: "failed",
        error: STREAMING_NO_NEW_LAYER,
        elapsedMs: elapsed(),
      });
      return;
    }
    // A CITY source IS the compute layer — `submitRun` made it so — and a
    // VECTOR source is built in the "source" phase below.
    let source: ToolSource | null =
      tool.sourceKind === "city" ? { kind: "city", layer, table } : null;
    // Spec §6.1: "a column that now belongs to the file fails the run with that
    // reason". The form checked when the user typed the prefix; by the head the
    // table may hold a column of the file's own under that name, and DuckDB's
    // identifiers are CASE-INSENSITIVE — "EXTENT_height_m" would overwrite
    // "extent_height_m" without the run ever noticing.
    //
    // About the TARGET's own table, so it does not apply to a vector target,
    // whose columns land on its feature properties (Task 18) and whose compute
    // table belongs to another layer entirely.
    if (target.kind === "city") {
      const owned = new Set(
        [...computedColumnsOf(request.targetLayerId)].map((c) =>
          c.toLowerCase(),
        ),
      );
      const clash = target.table.columns.find(
        (c) =>
          !owned.has(c.name.toLowerCase()) &&
          request.columns.some(
            (out) => out.name.toLowerCase() === c.name.toLowerCase(),
          ),
      );
      if (clash) {
        patch(id, {
          status: "failed",
          // The TABLE's spelling: that is the column that belongs to the data.
          error: `'${clash.name}' belongs to the source data; choose another prefix`,
          elapsedMs: elapsed(),
        });
        return;
      }
    } else {
      // The same rule for a vector target, against its OWN attributes: the
      // document's public property keys. The form checked them at Run, but a
      // queued run can wait minutes and a re-linked source may have brought a
      // `bld_buildings_n` of its own — and the merge would then overwrite a
      // property of the file under a "computed" badge. The registry's own
      // columns are excluded, exactly as on the city side: replacing a column a
      // previous run wrote is what a re-run IS.
      const owned = new Set(
        [...computedColumnsOf(request.targetLayerId)].map((c) =>
          c.toLowerCase(),
        ),
      );
      const keys = new Set(
        target.records.flatMap((record) => Object.keys(record)),
      );
      const clash = [...keys].find(
        (key) =>
          !owned.has(key.toLowerCase()) &&
          request.columns.some(
            (out) => out.name.toLowerCase() === key.toLowerCase(),
          ),
      );
      if (clash !== undefined) {
        patch(id, {
          status: "failed",
          error: `'${clash}' belongs to the source data; choose another prefix`,
          elapsedMs: elapsed(),
        });
        return;
      }
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

    // §6.1's phases are discrete and IN ORDER: "Loading extension (skipped once
    // loaded), Reading source (registering bytes; skipped for tools that need
    // none), Computing". A reader-backed run therefore enters Reading source
    // HERE, on the far side of the pre-flight refusals and the extension load
    // and BEFORE the scope query — `resolveScope` issues a statement of its own,
    // and a run that waited for it in the phase it was already in would read
    // "queued" (or still "Loading extension") for the length of it, which is the
    // card saying nothing is happening while the run holds the queue.
    //
    // This is the PHASE only. The bytes are registered by the executor, through
    // `readSource`, which needs the scope's ids; the phase is what the user
    // reads, and it has to open before the first thing done under it.
    // A VECTOR source enters it here too, and for the same reason: its
    // reprojection, its NDJSON and its CREATE all happen under this phase, and
    // the scope query below is work the run does while already holding the
    // FIFO. Leaving a vector run in "queued" (or in "Loading extension") for
    // the length of the scope query is the card saying nothing is happening.
    if (tool.needsReader || tool.sourceKind === "vector") {
      patch(id, { status: "running", phase: "source" });
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
    // S2, round 2: a REPLACEMENT that would change the column's TYPE is only
    // allowed when the run covers every row of it.
    //
    // The write migrates a re-typed column by DROPPING it and re-adding it, and
    // a DROP takes the values from the whole table — so on a subset the rows
    // this run never measured would be NULL in the database while the model
    // attributes and the "the rest from <earlier tool>" provenance still held
    // their old values. There is no honest partial migration to write (a DOUBLE
    // cannot live in a BOOLEAN column), so the run is refused and the sentence
    // names the one scope that CAN do it.
    //
    // It sits HERE rather than beside the other pre-flight refusals because
    // "covers every row" is not knowable until the scope is resolved: `all` is
    // the ruling's own first clause, and a filter or a selection that happens
    // to name every feature is the second. A NEW-layer run is exempt: its table
    // is CUT to the scope, so every row of the copy is in it by construction.
    if (target.kind === "city" && request.destination !== "new") {
      const wholeColumn =
        request.scope === "all" || scope.count === scope.total;
      const refusal = wholeColumn
        ? null
        : migrationRefusal(request.columns, target.table.columns);
      if (refusal !== null) {
        patch(id, {
          status: "failed",
          phase: null,
          error: refusal,
          elapsedMs: elapsed(),
        });
        return;
      }
    }
    if (tool.sourceKind === "vector") {
      // §6.1's second phase, for the other kind of source — ENTERED ABOVE,
      // before the scope query, and held open across everything below.
      // `runFormat.ts` already labels it "Reading source"; this is the first
      // tool that enters it with a vector layer rather than a re-read file.
      const geo = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === request.sourceLayerId);
      if (!geo || geo.kind !== "geojson") {
        patch(id, {
          status: "failed",
          phase: null,
          error: "Layer removed",
          elapsedMs: elapsed(),
        });
        return;
      }
      // §7.5: the areas are reprojected into the TARGET's CRS, and
      // `crsFromGeodetic`'s `ensureProjDef` guard is SYNCHRONOUS — a definition
      // proj4 has not fetched yet answers `null` for every coordinate, which is
      // the difference between "4 areas skipped" and "every area skipped". It
      // costs nothing when the definition is already loaded, and it throws the
      // loader's own sentence when the CRS cannot be resolved at all.
      await raced(ensureModelCrsLoadable(layer.model), signal);
      if (signal.aborted) {
        if (!failedAlready(id)) {
          patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
        }
        return;
      }
      const epsg = epsgForLayer(layer.model.metadata?.referenceSystem);
      // The run's own cancel, handed to the batched walk and to the encoder so
      // a Cancel lands INSIDE the reprojection of a large source rather than
      // after it.
      const control = {
        checkpoint: () => {
          if (signal.aborted) throw new CancelledError();
        },
      };
      // A city layer always has a recognised metric CRS (§7.5; the loader
      // refuses the others), so a null here is a layer nothing can be projected
      // INTO — the same outcome as every area failing to reproject, which §7.5
      // already has the sentence for.
      // S3: §7.5's source is defined over AREAS, and a mixed polygon/point
      // layer is eligible as long as it holds one polygon — so the features
      // that are not areas are dropped HERE, before the vector table exists,
      // rather than left for a predicate to match a point with.
      const sourceMustBeAreas = SOURCE_NEEDS_AREAS.has(tool.id);
      const preflight: VectorPreflight =
        epsg === null
          ? {
              features: [],
              skipped: geoRecords(geo.config.preparedData).length,
              propertyKeys: [],
              propertyTypes: new Map(),
              polygonOnly: true,
              notAreas: 0,
            }
          : await reprojectGeoLayer(geo.config.preparedData, epsg, control, {
              areasOnly: sourceMustBeAreas,
            });
      if (preflight.features.length === 0) {
        // §7.5's source must be AREAS, so "No usable areas in Zones" is ITS
        // sentence; §7.7's source is any geometry type and its only sentence is
        // "The source layer has no features" (§7.7: "An empty source (no usable
        // geometry after preflight) disables Run with …"). Task 15's
        // `SOURCE_NEEDS_AREAS` is the FORM's copy of the same fact, and it is
        // now the ONE owner: the form's disabled source row and this refusal
        // read the same set, so they cannot come to disagree.
        patch(id, {
          status: "failed",
          phase: null,
          error:
            preflight.skipped > 0 && sourceMustBeAreas
              ? `No usable areas in ${geo.name}`
              : "The source layer has no features",
          elapsedMs: elapsed(),
        });
        return;
      }
      if (preflight.skipped > 0) {
        // §7.5's "4 areas skipped: invalid geometry", recorded on the run so
        // §6.4's log says what the compute never saw — and S3's own cause
        // beside it, because a point is not invalid, it is simply not an area.
        warnings.push(...preflightWarnings(preflight));
        patch(id, { warnings: [...warnings] });
      }
      vectorSourceHandle = await createVectorTable({
        runId: id,
        preflight,
        query,
        control,
        signal,
      });
      source = {
        kind: "vector",
        layer: geo,
        table: vectorSourceHandle.table,
        propertyKeys: preflight.propertyKeys,
        propertyTypes: preflight.propertyTypes,
        skipped: preflight.skipped,
      };
    }

    patch(id, {
      status: "running",
      // A reader-backed run STAYS in Reading source, which it entered above:
      // its executor calls `ctx.phase("compute")` once its handle is open. A
      // tool that needs no source never shows the phase at all
      // (`roofMetrics.ts` and `heightFromExtent.ts` go straight to Computing).
      // Deciding it here rather than inside the executor is what stops the
      // progress block flashing "Computing" for one frame before a 300 MB read.
      // A reader-backed run STAYS in Reading source; a vector-source run has
      // just finished its own, so Computing is next for it.
      phase: tool.needsReader ? "source" : "compute",
      featureIds: scope.featureIds,
      scopeCount: scope.count,
    });

    const ctx: ToolContext = {
      table,
      layer,
      target,
      source,
      featureIds: scope.featureIds,
      signal,
      query,
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
    const raw = await executor(record, ctx);
    if (signal.aborted) throw new CancelledError();

    // §6.1's OTHER publication, and it is dispatched HERE — before the vector
    // publication below and before the city write — so that no This-layer
    // publication can run for a New-layer run. The compute above is identical
    // for both destinations (same table, same frozen ids, same executor) and
    // the branch is at the WRITE and nowhere else: a second path through the
    // executors would be the place the two destinations silently diverge.
    if (request.destination === "new") {
      // The parent a VECTOR copy is cut from, narrowed ONCE and verified here
      // — the same check, in the same place and with the same sentences, that
      // the This-layer vector publication below makes: `target` was resolved
      // before the compute, and a re-link in between re-minted every stable id.
      // Copying the captured document then would publish a layer of a Zones
      // the user no longer sees, under results keyed by ids it no longer has.
      let vectorParent: GeoJsonLayer | null = null;
      if (target.kind === "vector") {
        const live = useGeoLayerStore
          .getState()
          .layers.find((l) => l.id === target.layer.id);
        if (live === undefined || live.kind !== "geojson") {
          patch(id, {
            status: "failed",
            phase: null,
            error: "Layer removed",
            elapsedMs: elapsed(),
          });
          return;
        }
        if (live.config.preparedData !== target.layer.config.preparedData) {
          patch(id, {
            status: "failed",
            phase: null,
            error: "Layer changed while running; run again",
            elapsedMs: elapsed(),
          });
          return;
        }
        vectorParent = live;
      }
      // The PARENT's own spelling wins, exactly as for a This-layer run: the
      // city copy is `SELECT *` of the parent table, and the vector copy is the
      // parent's document — so a column an earlier run already wrote keeps the
      // spelling it has there. The SOURCE city table's columns are deliberately
      // not the answer for a vector copy: they belong to another layer.
      const result = canonicalise(
        raw,
        vectorParent === null
          ? table.columns
          : [
              ...new Set(
                geoRecords(vectorParent.config.preparedData).flatMap((record) =>
                  Object.keys(record),
                ),
              ),
            ].map((name) => ({ name })),
      );
      if (result.rows.size === 0) {
        // Nothing matched, so there is nothing to publish: a copy whose
        // declared columns hold no value anywhere would be a layer made of
        // the run's failure to measure.
        doneWithNothing(result, layer.isStreaming);
        return;
      }
      patch(id, { phase: "write" });
      const plan =
        vectorParent === null
          ? await prepareDerivedCityLayer({
              runId: id,
              parent: layer,
              parentTable: table,
              // The frozen name (§6.1), with the prefill as the fallback for a
              // request built without one. The source's name comes off the
              // RECORD (`runById`), which is where Task 11 put it — `execute`
              // holds the source's id, not its name.
              name:
                request.newLayerName ??
                derivedLayerName(
                  layer.name,
                  request.toolId,
                  runById(id)?.sourceName ?? null,
                ),
              rowIds: scope.featureIds,
              columns: result.columns,
              rows: result.rows,
              signal,
              // The closure, not `ctx.query`: it is the same function, and
              // reading it off the context declares a METHOD reference, which
              // the lint baseline refuses (`unbound-method`).
              query,
              // §6.4 again: the copy's ALTER/UPDATE/COMMIT belong in the log
              // beside its CREATE TABLE, and only the preparation knows them —
              // the write happens inside it. The SAME recorder the This-layer
              // write uses, so the two destinations cannot drift.
              recordWrite: (statements, ms, rows) => {
                logWriteStatements(log, statements, ms, rows);
                patch(id, { log: [...log] });
              },
            })
          : // §7.6's reversed direction: the TARGET is the vector layer and
            // its copy holds every one of its areas, whatever the scope
            // selected on the SOURCE city layer (§6, §10.11). The prefill's
            // source segment is the compute layer's name, which for a
            // vector-target tool IS the source.
            await prepareDerivedVectorLayer({
              runId: id,
              parent: vectorParent,
              name:
                request.newLayerName ??
                derivedLayerName(vectorParent.name, request.toolId, layer.name),
              columns: result.columns,
              rows: result.rows,
            });
      // §6.1: "a cancel (or a failure) that lands BEFORE publication discards
      // every partial resource … and the run reads cancelled with nothing
      // changed". This is the LAST moment that is true, and the ONLY
      // `discard()` the caller owns: the preparation drops its own table when
      // it throws, and nothing below this line may reach `discard()` — after
      // `publish()` the table belongs to a layer the user can see.
      if (signal.aborted) {
        await plan.discard();
        throw new CancelledError();
      }
      // The SOURCE's own re-validation, at the same boundary and for the same
      // reason as the target's above: the copy would otherwise carry columns
      // measured against a document the user replaced while it was being
      // built. `discard()` first — after `publish()` there is a layer to see.
      const sourceMoved = vectorSourceMoved(source);
      if (sourceMoved !== null) {
        await plan.discard();
        patch(id, {
          status: "failed",
          phase: null,
          error: sourceMoved,
          elapsedMs: elapsed(),
        });
        return;
      }
      const newLayerId = plan.publish();
      // BOTH stores. A derived CITY layer's row is in `layerStore`; a derived
      // VECTOR layer's (Task 23) is in `geoLayerStore`, and reading only the
      // city one would give `undefined` — so a name that publication had to
      // disambiguate would never reach the card or A15's note.
      const name =
        useLayerStore.getState().layers.find((l) => l.id === newLayerId)
          ?.name ??
        useGeoLayerStore.getState().layers.find((l) => l.id === newLayerId)
          ?.name ??
        plan.name;

      // The copy's own new columns, with the run's real provenance — through
      // the SAME publisher both This-layer paths use, so there is one rule for
      // what a badge says. The INHERITED entries were copied inside
      // `publish()`.
      //
      // The scope is handed over with `total: scope.count`: the copy holds
      // exactly the scoped features, so the run covered ALL of it and the
      // tooltip must not read "312 of 1,115" about a layer of 312.
      publishProvenance(id, newLayerId, result, tool.name, request, {
        featureIds: scope.featureIds,
        count: scope.count,
        total: scope.count,
      });

      // RE-READ, and this is the bug it is written against: `getState()`
      // returns a SNAPSHOT, and every `setProvenance` above replaced
      // `byLayer` with a new object. A set built from a snapshot taken BEFORE
      // them holds none of this run's entries, so `newLayerUndoBlock` would
      // see every column of the copy as one it "grew afterwards" and disable
      // Undo the instant the card appeared.
      const carried =
        useComputedColumnStore.getState().byLayer[newLayerId] ?? {};
      undoState.set(id, {
        kind: "layer",
        layerId: newLayerId,
        table: table.table,
        // Everything the copy carried the moment it was published — the
        // inherited runs plus this one. Anything that appears later is a
        // column of its OWN, and blocks the Undo.
        runIds: new Set(Object.values(carried).map((p) => p.runId)),
      });

      const summary = summariseCreated(
        result,
        elapsed(),
        name,
        // §7.6's own head segment already names what the copy holds — "6 areas
        // aggregated over 1,204 buildings", where the 6 are the target's areas
        // and the 1,204 are the source's buildings. `null` keeps it; a count
        // here would replace it with the SOURCE's number (§6.2's "312
        // buildings" is a CITY copy's, and a city copy holds the scope).
        vectorParent === null ? scope.count : null,
        { streaming: layer.isStreaming },
      );
      const notes = [
        // [adapted copy A15] — §10 scenario 12's "the card says so".
        name === plan.name
          ? null
          : `Renamed to "${name}": a layer already had that name`,
        // §6.1: a cancel that lost the race is told, not hidden.
        signal.aborted ? "finished before the cancel arrived" : null,
      ].filter((n): n is string => n !== null);
      patch(id, {
        status: "done",
        phase: null,
        elapsedMs: elapsed(),
        summary,
        log: [...log],
        columns: result.columns.map((c) => c.name),
        newLayerId,
        undoable: true,
        note: notes.length === 0 ? null : notes.join(" · "),
      });
      // Read BACK, never assumed, exactly as the city write does: a run
      // something else has already ended keeps no Undo, and says nothing in
      // the toast.
      if (runById(id)?.status !== "done") {
        discardUndo(id);
        return;
      }
      useProcessingStore.getState().pushNotice(summary.line);
      return;
    }

    if (target.kind === "vector") {
      // §7.6: the durable copy of a vector layer's results is its FEATURE
      // PROPERTIES. So no table, no transaction and no model — but the same
      // canonical spelling, the same provenance, the same Undo-stealing and the
      // same card as a city run.
      //
      // The document is re-read and VERIFIED first, immediately before anything
      // is written: `target` was resolved before the compute, and a re-link in
      // between replaced the document, re-minted every stable id and may have
      // brought properties of its own. Merging into it would overwrite the
      // file's own values and record rollback values for a document that is
      // gone — so the run fails with §6.1's sentence instead.
      const live = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === target.layer.id);
      if (live === undefined || live.kind !== "geojson") {
        patch(id, {
          status: "failed",
          phase: null,
          error: "Layer removed",
          elapsedMs: elapsed(),
        });
        return;
      }
      // NARROWED once, and every read below is off this one variable.
      const verified: GeoJsonLayer = live;
      if (verified.config.preparedData !== target.layer.config.preparedData) {
        patch(id, {
          status: "failed",
          phase: null,
          error: "Layer changed while running; run again",
          elapsedMs: elapsed(),
        });
        return;
      }
      // From the VERIFIED document, never from the records captured before the
      // compute: the spelling, the created/replaced split and the rollback
      // values all have to describe what is about to be overwritten.
      const records = geoRecords(verified.config.preparedData);
      const existingProperties = [
        ...new Set(records.flatMap((record) => Object.keys(record))),
      ].map((name) => ({ name }));
      const result = canonicalise(raw, existingProperties);
      if (result.rows.size === 0) {
        // Nothing matched, so there is nothing to merge and no column to own.
        doneWithNothing(result, layer.isStreaming);
        return;
      }
      patch(id, { phase: "write" });
      const onDocument = new Set(
        existingProperties.map((c) => c.name.toLowerCase()),
      );
      const existing = new Set(
        result.columns
          .map((c) => c.name)
          .filter((name) => onDocument.has(name.toLowerCase())),
      );
      // Captured BEFORE the merge, per feature and per COLUMN — §6.2's Undo
      // puts this run's own values back into whatever the document is by then,
      // so a later run's results on the same layer survive it.
      const before = new Map(
        records.map((record) => [geoRecordId(record), record]),
      );
      const previousValues = new Map<string, Record<string, unknown>>();
      for (const stableId of result.rows.keys()) {
        const record = before.get(stableId);
        const prior: Record<string, unknown> = {};
        for (const column of result.columns) {
          prior[column.name] =
            record !== undefined && column.name in record
              ? record[column.name]
              : GEO_PROPERTY_ABSENT;
        }
        previousValues.set(stableId, prior);
      }
      useGeoLayerStore
        .getState()
        .mergeGeoFeatureProperties(verified.id, result.rows);
      log.push({
        label: "Writing results",
        sql: null,
        ms: 0,
        rows: result.rows.size,
      });
      publishProvenance(id, verified.id, result, tool.name, request, scope);
      stealUndo(id, verified.id, result);
      undoState.set(id, {
        kind: "columns",
        state: {
          kind: "vector",
          layerId: verified.id,
          previousValues,
          source: geoSourceIdentity(verified),
          created: result.columns
            .map((c) => c.name)
            .filter((name) => !existing.has(name)),
          replaced: result.columns
            .map((c) => c.name)
            .filter((name) => existing.has(name)),
        },
      });
      // Evicted while it ran: no card, so nothing can press Undo.
      if (!runById(id)) discardUndo(id);
      const summary = summarise(result, elapsed(), {
        streaming: layer.isStreaming,
      });
      patch(id, {
        status: "done",
        phase: null,
        elapsedMs: elapsed(),
        summary,
        log: [...log],
        columns: result.columns.map((c) => c.name),
        undoable: true,
      });
      if (runById(id)?.status !== "done") {
        discardUndo(id);
        return;
      }
      useProcessingStore.getState().pushNotice(summary.line);
      return;
    }
    // The SOURCE's re-validation, on the far side of the compute and before
    // anything at all is decided from its results — the last moment at which
    // "nothing has been published" is still true for a city target, and ABOVE
    // the no-rows exit, because a run that matched nothing against a document
    // the user has replaced is not a `done` run either. A vector TARGET is
    // checked the same way further up; this is the other half of §6.1's
    // sentence. (Nothing between here and the write awaits, so this covers the
    // write preparation too; the executors have released their reader handle
    // in their own `finally` by now.)
    const sourceMoved = vectorSourceMoved(source);
    if (sourceMoved !== null) {
      patch(id, {
        status: "failed",
        phase: null,
        error: sourceMoved,
        elapsedMs: elapsed(),
      });
      return;
    }
    // The table's spelling wins from here on, so the SQL, the rows' keys, the
    // model, the registry, the card and Undo all name the same column.
    const result = canonicalise(raw, table.columns);

    if (result.rows.size === 0) {
      // Nothing to write.
      doneWithNothing(result, layer.isStreaming);
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
    // …and at WHICH type it has them (S2). A replacement whose declared type
    // differs is migrated inside the write's transaction, and the ORIGINAL
    // types below are what this run's Undo puts back.
    const existingTypes = new Map(
      table.columns.map((c) => [c.name.toLowerCase(), c.type]),
    );
    const migrated = typeMigrations(result.columns, existingTypes);
    const t0 = performance.now();
    // Mirrored as they are ISSUED, because the death race below can reject with
    // the write still in flight: duckdb-wasm strands the statement its worker
    // died under, so that promise never settles and there is no outcome to read
    // the record off. Identical to `written.statements` on every path that
    // resolves (`writeComputedColumns` feeds both from one place).
    const issuedByWrite: string[] = [];
    const writing = writeComputedColumns({
      runId: id,
      table: table.table,
      columns: result.columns,
      rows: result.rows,
      existing,
      existingTypes,
      onStatement: (sql) => issuedByWrite.push(sql),
      // Spec §6.1: the write is the publication, so the LAST moment a cancel
      // can still mean "nothing changed" is inside it, before its COMMIT.
      signal,
    });
    const written = await raced(writing, null).catch((error: unknown) => {
      // The engine died under the write. §6.4 still has to say what was
      // attempted, and a `log`-only patch is accepted even for a run the death
      // watcher has already failed (`patch` refuses a second STATUS, not a
      // record).
      logWriteStatements(
        log,
        issuedByWrite,
        Math.round(performance.now() - t0),
        result.rows.size,
      );
      patch(id, { log: [...log] });
      throw error;
    });
    logWriteStatements(
      log,
      written.statements,
      Math.round(performance.now() - t0),
      result.rows.size,
    );
    patch(id, { log: [...log] });
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
    // S2: a RE-TYPED column is a new column, and §7 says of one that "in a new
    // column they are NULL".
    //
    // The migration DROPPED the column and re-added it, so every row the
    // UPDATE did not name is NULL in the table — including the rows this run
    // COVERED but skipped (no geometry, not a solid, outside every area). Their
    // model attributes still held the previous run's values, and the table and
    // the model would have told two different stories about the same building.
    // So the NULL is published too. A same-typed replacement changes no schema
    // and is untouched: there the skipped row's value is still in the table.
    //
    // Covered, not "every object": the table's other rows are not this run's to
    // speak about — and a migration is only allowed on a run that covers the
    // whole column (the head refuses the others), so in practice this is every
    // row of it.
    const migratedNames = migrated.map((m) => m.name);
    if (migratedNames.length > 0) {
      const covered =
        scope.featureIds === null ? null : new Set(scope.featureIds);
      // ONE object, read and never written by `mergeAttributes`.
      const nulls: Record<string, unknown> = Object.fromEntries(
        migratedNames.map((name) => [name, null]),
      );
      for (const [objectId, object] of Object.entries(layer.model.objects)) {
        if (result.rows.has(objectId)) continue;
        if (covered !== null && !covered.has(objectId)) continue;
        const previous: Record<string, unknown> = {};
        for (const name of migratedNames) {
          previous[name] = object.attributes[name];
        }
        // Undo puts these back the same way it puts the measured rows back:
        // an `undefined` here removes the attribute again.
        previousModelValues.set(objectId, previous);
        merge.set(objectId, nulls);
      }
    }
    useLayerStore.getState().mergeAttributes(layer.id, merge);

    publishProvenance(id, layer.id, result, tool.name, request, scope);
    stealUndo(id, layer.id, result);

    undoState.set(id, {
      kind: "columns",
      state: {
        kind: "city",
        table: table.table,
        backupTable: written.backupTable,
        created: result.columns
          .map((c) => c.name)
          .filter((name) => !existing.has(name)),
        replaced: result.columns
          .map((c) => c.name)
          .filter((name) => existing.has(name)),
        migrated,
        ids: scope.featureIds === null ? null : [...result.rows.keys()],
        previousModelValues,
      },
    });
    // Evicted while it ran: there is no card to press Undo on, so the backup the
    // write just made would never be read. (The eviction diff in `submitRun`
    // cannot see this one — the run was already gone when it was pushed out.)
    if (!runById(id)) discardUndo(id);

    // The registry's `columns` came from a DESCRIBE at build time; the grid and
    // the NEXT run both read it, and the next run's "did this column exist?"
    // decides whether Undo restores a value or drops the column.
    try {
      await raced(refreshLayerTableColumns(layer.id, request.familyKey), null);
    } catch (error) {
      // Past the COMMIT nothing may fail the run, and this is the one await
      // left that a dead engine can strand. A DESCRIBE that will never answer
      // is abandoned; the run's own card is already the watcher's to write.
      if (!(error instanceof EngineDeadError)) throw error;
    }

    const summary = summarise(result, elapsed(), {
      streaming: layer.isStreaming,
    });
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
    // EVERY exit path: done, failed, cancelled, the engine's death. The table
    // is this run's own, so nothing else will ever drop it — and `release`
    // neither throws nor hangs, because this `await` is inside the FIFO slot.
    await vectorSourceHandle?.release();
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
  // §6.2: "Undo (removes the new layer; asks no confirmation)". Nothing was
  // written to the target, so there is no transaction to reverse — and no
  // reason to take a FIFO slot for it either.
  if (state.kind === "layer") {
    const blocked = newLayerUndoBlock(run);
    if (blocked !== null) {
      patch(id, { error: blocked });
      return;
    }
    // OUTSIDE the queue, and that is a hard fact rather than a preference:
    // `removeLayer` reaches `layerTableLifecycle`'s removal branch, which
    // calls `dropLayerTable` — and that ENQUEUES. Removing from inside a FIFO
    // slot would deadlock exactly as `enqueueLayerTable` would (Design
    // decision (g)).
    // ONE of the two stores holds it; a removal for an id the other store
    // owns is a no-op, so both are called rather than branched on.
    useLayerStore.getState().removeLayer(state.layerId);
    useGeoLayerStore.getState().removeGeoLayer(state.layerId);
    useComputedColumnStore.getState().clearLayer(state.layerId);
    undoState.delete(id);
    patch(id, { undoable: false, note: "Undone" });
    return;
  }
  // Everything below is the This-layer Undo, unchanged except that the state
  // it reads is now one level in. ONE new binding rather than a rename at
  // every site, so the diff is the wrapper and not the Undo.
  const undo = state.state;
  if (undo.kind === "vector") {
    // ON THE FIFO, like the city Undo, although it writes no table: a
    // cross-layer run holds that queue for its whole life and has CAPTURED this
    // layer's records and built its preflight from them, so replacing the
    // document underneath it would leave the run computing against a document
    // nothing on screen shows. Serialising is the whole fix and it costs one
    // queue slot.
    await runOnTableQueue(async () => {
      // Re-validated at the head, exactly as the city Undo is. While this
      // waited a LATER run may have overwritten one of these columns, which
      // takes this run's Undo with it (§6.2) — restoring now would erase a
      // result that is on screen. The card already reads `undoable: false`, so
      // it is left exactly as it is.
      if (!runById(id)?.undoable || !undoState.has(id)) return;
      const live = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === undo.layerId);
      // Gone, of another kind, or showing a DIFFERENT document than the one
      // this run wrote into (a re-link, a re-prepare): the ids this Undo holds
      // name features of a file the user has replaced, and there is nothing to
      // put back. Not `preparedData` identity — a later run's disjoint merge
      // moves that legitimately, and this Undo must still work.
      if (live === undefined || live.kind !== "geojson") {
        undoState.delete(id);
        patch(id, { undoable: false });
        return;
      }
      // NARROWED once; every read below is off this variable.
      const verified: GeoJsonLayer = live;
      if (!sameGeoSource(verified, undo.source)) {
        undoState.delete(id);
        patch(id, { undoable: false });
        return;
      }
      // This run's OWN columns, back into whatever the document is NOW — never
      // a stored snapshot, or a later run's disjoint results would go with it.
      const restored = restoreGeoDocumentProperties(
        verified.config.preparedData,
        undo.previousValues,
      );
      if (restored !== null) {
        useGeoLayerStore
          .getState()
          .replaceGeoPreparedData(undo.layerId, restored);
      }
      rollBackProvenance(undo.layerId, undo.created, undo.replaced);
      undoState.delete(id);
      patch(id, { undoable: false, note: "Undone" });
    });
    return;
  }
  const out = await runOnTableQueue(async () => {
    // Re-validated at the head, exactly like a run's scope: while this Undo
    // waited, a later run over the same column may have published (§6.2) or a
    // rebuild may have retired the card. Its backup then describes the state two
    // writes ago, and restoring it would delete what the later run wrote — so the
    // card, which already reads `undoable: false`, is left as it is.
    const current = runById(id);
    if (!current?.undoable || !undoState.has(id)) return null;
    // RACED against the engine's death, the same way `execute`'s write is: an
    // Undo is a transaction over a layer table, and a statement of it caught by
    // the death never answers — which would leave this task holding the shared
    // FIFO for the life of the page. No abort signal: an Undo is not something
    // the user can cancel, so only the death may take it.
    let undone: QueryOutcome;
    try {
      undone = await raced(
        undoComputedColumns({
          table: undo.table,
          backupTable: undo.backupTable,
          created: undo.created,
          replaced: undo.replaced,
          migrated: undo.migrated,
          ids: undo.ids,
        }),
        null,
      );
    } catch (error) {
      if (!(error instanceof EngineDeadError)) throw error;
      // Nothing was committed and there is nothing left to roll back — the
      // transaction, the backup table and the database went together. So nothing
      // is published either: the model keeps the run's values, and the card is
      // left as the death watcher wrote it (the session's Undo is gone with the
      // flag, because every backup table died too).
      return null;
    }
    if (undone.ok) {
      try {
        await raced(
          refreshLayerTableColumns(
            run.targetLayerId,
            frozenById.get(run.id)?.familyKey ?? null,
          ),
          null,
        );
      } catch (error) {
        if (!(error instanceof EngineDeadError)) throw error;
        // NOT a fall-through. `execute`'s equivalent catch is right to abandon
        // the DESCRIBE — its COMMIT went through and its columns are on a
        // table that exists. Here the database itself is gone: the restored
        // values describe a table nobody can read, and publishing the model,
        // the provenance rollback and the "Undone" card would tell the user
        // their layer had been put back when the layer's table no longer
        // exists. The card is left exactly as it is — the engine watcher does
        // not touch a run that is already `done` — and the session's Undo is
        // gone with the store's `engineStopped` flag, because every backup
        // table died with the database.
        return null;
      }
    }
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
    .mergeAttributes(run.targetLayerId, undo.previousModelValues);
  rollBackProvenance(run.targetLayerId, undo.created, undo.replaced);
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
    // BOTH stores: §6.1's removal is about the target OR the source, and either
    // may be a geo layer.
    const layerIds = new Set([
      ...useLayerStore.getState().layers.map((l) => l.id),
      ...useGeoLayerStore.getState().layers.map((l) => l.id),
    ]);
    for (const run of useProcessingStore.getState().runs) {
      if (
        run.status !== "queued" &&
        run.status !== "running" &&
        run.status !== "cancelling"
      ) {
        continue;
      }
      if (
        layerIds.has(run.targetLayerId) &&
        (run.sourceLayerId === null || layerIds.has(run.sourceLayerId))
      ) {
        continue;
      }
      patch(run.id, {
        status: "failed",
        phase: null,
        error: "Layer removed",
        elapsedMs: Math.max(0, Date.now() - run.startedAt),
      });
      controllers.get(run.id)?.abort();
    }
  };

  const unsubscribeCity = useLayerStore.subscribe((state, previous) => {
    // Only the LIST matters here; the store's other writes (a colour, a filter,
    // a merged attribute) are not removals.
    if (state.layers === previous.layers) return;
    failRunsWithoutTarget();
  });
  const unsubscribeGeo = useGeoLayerStore.subscribe((state, previous) => {
    if (state.layers === previous.layers) return;
    failRunsWithoutTarget();
  });
  failRunsWithoutTarget();

  const dispose = () => {
    unsubscribeCity();
    unsubscribeGeo();
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
    for (const [key, entry] of Object.entries(state.tables)) {
      const before = previous.tables[key];
      const rebuilt =
        entry.state === "ready" &&
        ((before?.state === "ready" &&
          before.info.table !== entry.info.table) ||
          before?.state === "building");
      if (!rebuilt) continue;
      // A KEY is not a layer id (R-C′). Comparing the raw key against a run's
      // layer id would miss every rebuild of a family's view, and clearing the
      // computed columns under it would file them against `"<uuid>::building"`,
      // where nothing would ever find them again.
      const { layerId, family } = parseTableKey(key);
      for (const run of useProcessingStore.getState().runs) {
        // The layer whose TABLE the run read, which for a vector-target run is
        // its SOURCE city layer. The record carries only the target's id, so
        // the compute id comes from what `submitRun` froze; a run whose frozen
        // request the history has dropped falls back to the target, which is
        // the compute layer for every one-layer tool.
        const frozen = frozenById.get(run.id);
        const computeLayerId = frozen?.computeLayerId ?? run.targetLayerId;
        if (
          computeLayerId === layerId &&
          // …and the run read THIS family's table. Another family of the same
          // layer being rebuilt says nothing about the one this run measured.
          (frozen?.familyKey ?? null) === family &&
          // §6: a rebuild of the PARENT says nothing about the copy — "a
          // derived layer is independent of its parent from publication on".
          // The copy's own table is adopted, never rebuilt, so no rebuild of
          // it can reach here either.
          run.newLayerId === null &&
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
