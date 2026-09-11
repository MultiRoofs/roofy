# Task 9 report — Scope resolution and the single-flight run queue

Branch `develop`. Three commits on top of d673991:

- `b8d9f85` feat(processing): resolve a run's scope to frozen feature ids and a feature count
- `dc088cd` feat(processing): single-flight run queue with undo and stale tracking
- `17a6b9f` test(processing): ask the no-executor case for a tool nothing will register

`index.html`'s pre-existing uncommitted edit was left untouched (it is the only
thing `npx vp check` still reports, and it is not mine).

## What was implemented

### 1. `buildFeatureRowsSql(table, where)` — `src/insights/sql.ts`

Sibling of `buildFeatureIdsSql`, built on the same `buildFeatureScopeWhere`:

```
SELECT "id", COALESCE("feature_id", "id") AS f FROM "t"
  WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "t" WHERE <where>)
```

Both halves of the pair are needed and neither derives the other: the write
targets ROWS, the card counts FEATURES. `where === null` yields the projection
with no WHERE, like its sibling.

### 2. `resolveScope` — `src/features/processing/scope.ts`

Per the brief, with the controller's ruling applied (row shape `{ id, f }`,
`count` = distinct `f`):

- `all` → `SELECT COUNT(DISTINCT COALESCE("feature_id", "id")) AS n FROM t`;
  `featureIds: null`, `count` from the count.
- `matching` → the layer's APPLIED filter through `compileFilter`; refused with
  "No filter applied" when there is none (and when a restored draft compiles to
  `null`), and with the compiler's own message when it will not compile. No query
  is sent in either refusal.
- `selected` → the selection's object ids on THIS layer, deduped, as
  `"id" IN (…)` through `quoteLiteral`; refused with "Nothing selected on this
  layer".
- Both id scopes expand to the whole feature through `buildFeatureRowsSql`; a
  zero-row scope is refused with "Nothing to run on (0 buildings)" rather than
  reaching the write as `IN ()`.

### 3. `src/features/processing/tools/index.ts` + `tools/register.ts`

`EXECUTORS: Partial<Record<ToolId, ToolExecutor>>` and `registerExecutor`;
`index.ts` imports only the TYPE from `../runQueue`, and `register.ts` (currently
`export {}` with a comment) is the side-effect module `runQueue.ts` imports, so
Task 10 registers `height-from-extent` there with no runtime cycle.

### 4. `src/features/processing/runQueue.ts`

`submitRun` / `cancelRun` / `undoRun` / `installStaleWatcher` / `summarise`, plus
`RunRequest`, `ToolContext`, `ToolResult`, `ToolExecutor`.

- The card is published `queued` synchronously, and the work goes on
  `runOnTableQueue` — the SAME FIFO the table builds use, so a run and a
  streaming rebuild can never interleave.
- `execute` resolves the scope at the head of the queue, patches `running` /
  `phase` / `featureIds` / `scopeCount`, then hands the executor a context whose
  `query` logs every statement onto the card and whose `phase`/`warn` patch it.
- Publication order after the committed write: `mergeAttributes` → provenance
  (`setProvenance`, carrying `previous` and `partial`) → earlier runs that owned
  a now-overwritten column lose their Undo (spec §6.2) → `undoState` →
  `refreshLayerTableColumns` → the done card + `pushNotice`.
- Empty-result guard (controller ruling): `rows.size === 0` skips the write, the
  provenance and the refresh, and publishes a DONE card with a summary and
  `undoable: false`.
- Cancel: a queued run is `cancelled` outright and its executor never runs; a
  running one goes `cancelling` and the abort reaches the executor. A run that
  commits anyway is published with `note: "finished before the cancel arrived"`.
- `undoRun` goes back on the table queue, restores the model from
  `previousModelValues` (undefined deletes), restores or removes provenance, and
  patches `{ undoable: false, note: "Undone" }`. A failed undo keeps the Undo
  (the undo is itself a transaction) and shows the message.
- `installStaleWatcher` subscribes with zustand's `(state, previous)` and fires
  on a CHANGED table name or a `building → ready` transition only, so the
  re-describe below cannot retire a card.

Deviations from the brief's sketch, all deliberate:

- `refreshLayerTableColumns` is imported statically (no cycle exists; the dynamic
  `await import` only made it harder to mock).
- The whole of `execute` is wrapped in `try/finally`, so the early returns
  (aborted, layer gone, table gone, no executor, scope refused) cannot leak an
  `AbortController`.
- The brief's `void tool;` leftover in `submitRun` is gone.

### 5. `refreshLayerTableColumns(layerId)` — `src/insights/layerTables.ts`

Re-runs `DESCRIBE SELECT * FROM "<table>"` (the spelling the build uses) through
`runQuery`, maps with the existing `columnsFromDescribe`, and publishes a new
`info` with the SAME `table` name into BOTH the module `registry` and the store
entry (preserving `rebuilding`). Not on the queue — it is called from inside a
queued run. A failed DESCRIBE leaves the entry as it was: the write is already
committed, and failing the run would lie about it.

Updating the registry as well as the store is load-bearing: the next run's
`existing` set comes from `table.columns`, and without it a second run writing
the same column would see it as newly CREATED, take no backup, and Undo would
DROP a column holding real data.

### 6. `src/app/App.tsx`

The DuckDB-boot effect now returns a disposer that stops both
`installLayerTableLifecycle()` and `installStaleWatcher()`.

## Tests

New/changed test files:

- `tests/unit/insights/sqlQuery.test.ts` — 2 new cases for `buildFeatureRowsSql`
  (exact strings, with and without a filter).
- `tests/unit/features/processing/scope.test.ts` — 8 cases: all (ids null +
  count + the COUNT(DISTINCT …) spelling), a failed count, matching (ids + count
  1 from `f`, and the compiled predicate in the SQL), matching with no filter,
  matching with an uncompilable filter, selected (expanded + the `"id" IN (…)`
  literal), selected on another layer, and a zero-row scope.
- `tests/unit/features/processing/runQueue.test.ts` — 12 cases: the done card
  (queued → done, summary line, log label, scopeCount, undoable, model
  attribute, provenance, the BEGIN/ALTER/COMMIT statements, the ONE buffer
  registration, the refresh call, the notice); a second run queued behind the
  first until a deferred resolves; a cancel mid-run (cancelled, no
  `BEGIN TRANSACTION`, no registration, attributes untouched); a cancel while
  queued (executor never called); a failing executor (failed + exact message +
  no write); the empty-result guard; an unresolvable scope (executor not
  called); a tool with no executor; undo (DROP COLUMN issued, attribute gone,
  provenance gone, `undoable: false`, note "Undone", refresh called twice); undo
  twice is a no-op; the stale watcher on a new table name; and the watcher NOT
  firing on a same-name re-describe.
- `tests/unit/insights/layerTablesBuild.test.ts` — 3 cases for
  `refreshLayerTableColumns` (new column in both registry and store with the
  table name unchanged; a failed DESCRIBE changes nothing; an unknown layer is a
  no-op).

### TDD evidence

1. `buildFeatureRowsSql` test written first →
   `TypeError: buildFeatureRowsSql is not a function` (2 failed / 20 passed).
   Implemented → 22 passed.
2. `scope.test.ts` written first → the file failed to load (no
   `src/features/processing/scope`). Implemented → 8 passed.
3. `runQueue.test.ts` written first → failed to load (no `runQueue` / `tools`).
   Implemented → 12 passed.
4. `refreshLayerTableColumns` tests written first →
   `TypeError: refreshLayerTableColumns is not a function` (3 failed / 37
   passed). Implemented → 40 passed.
5. Mutation check on the subtlest assertion: changing the watcher's test from
   `before.info.table !== entry.info.table` to `before.info !== entry.info` made
   exactly the "leaves a run alone when the same table only re-describes" case
   fail (1 failed / 11 passed). Reverted.

### Results

- `npx vitest run tests/unit/features/processing tests/unit/insights` → 20 files,
  304 tests, all passing (re-run after the pre-commit formatter rewrote imports).
- `npx vitest run tests/unit/app` → 7 files, 72 tests passing (App.tsx changed).
- `npx tsc -b --noEmit` → clean.
- `npx vp check` → clean apart from the pre-existing `index.html` edit, which was
  deliberately not touched.

## Self-review

- Hard rules: no new `@duckdb/duckdb-wasm` importer and no new `duckdb.ts`
  export; the engine is reached through `runQuery` and `computedColumns`. No
  `@navaramap/*` import. No directory named `analytics/`.
- Single writer of the run record: only `runQueue.ts` patches a run's status, and
  it does so through `patchRun` (which ignores evicted ids).
- The write is the only thing that can fail a run after the executor returns;
  everything after the commit is store work that cannot throw.
- The `undoState` map is module state keyed by run id, dropped on a successful
  undo. It is NOT dropped when a run is evicted past `MAX_RUNS` (20) — a bounded
  leak of a few string arrays per session, and dropping it would need a store
  eviction hook; noted rather than built.
- `installStaleWatcher` also fires on a layer's FIRST `building → ready`
  transition, where `clearLayer` is a no-op on an empty registry entry.

## Concerns for later tasks

1. **Scope is resolved at the head of the queue, not at Run.** `RunRecord`'s
   comment says `scopeCount` is "frozen at Run", and it is — but a "selected" or
   "matching" run that waits behind a long build picks up whatever the user has
   selected or applied by the time it starts. Fixable by snapshotting
   `selections` / `applied` in `submitRun` and passing them into `resolveScope`;
   out of scope for this brief, worth a plan decision before the UI lets users
   queue runs freely.
2. **`all` needs a `feature_id` column.** The count (like every other
   feature-scoped predicate in `sql.ts`) assumes it exists. A flat-fallback table
   that lacks it refuses the run with the binder error as the message. Consistent
   with the rest of the feature, but it is a user-visible SQL message.
3. **The REPLACED-column path has no queue-level test.** `existing.has(name)` →
   backup → `undoRun`'s `provenance.previous` restore, and the §6.2 loop that
   takes Undo away from an earlier run over the same column, are exercised only
   by reading: the mocked `refreshLayerTableColumns` is a no-op and the mocked
   registry's column list is fixed, so no test in `runQueue.test.ts` can see a
   column as pre-existing. `computedColumns.test.ts` pins the SQL; the queue's
   bookkeeping around it should get a test when the UI can drive two runs over
   one column (Task 11 or later).
4. **`undoRun` does not re-check staleness.** The stale watcher clears
   `undoable`, so a stale run cannot be undone; a run whose table was dropped
   entirely (layer removed) would issue its DROP against a missing table and show
   the binder message.

## Contract for Tasks 10 / 11

```ts
// src/features/processing/scope.ts
export type ScopeResolution =
  | {
      readonly ok: true;
      readonly featureIds: ReadonlyArray<string> | null;
      readonly count: number;
    }
  | { readonly ok: false; readonly message: string };
export function resolveScope(input: {
  layerId: string;
  table: LayerTable;
  scope: Scope;
}): Promise<ScopeResolution>;

// src/features/processing/tools/index.ts
export const EXECUTORS: Partial<Record<ToolId, ToolExecutor>>;
export function registerExecutor(id: ToolId, executor: ToolExecutor): void;
// src/features/processing/tools/register.ts — import tool modules here for their
// registerExecutor side effect; runQueue.ts imports this file.

// src/features/processing/runQueue.ts
export interface RunRequest {
  readonly toolId: ToolId;
  readonly targetLayerId: string;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  readonly columns: ReadonlyArray<OutputColumn>;
}
export interface ToolContext {
  readonly table: LayerTable;
  readonly layer: Layer;
  readonly featureIds: ReadonlyArray<string> | null; // null = every row
  readonly signal: AbortSignal;
  query(label: string, sql: string): Promise<QueryOutcome>; // throws on !ok
  phase(p: RunPhase): void;
  warn(text: string): void;
}
export interface ToolResult {
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>; // objectId -> values
  readonly measured: number; // FEATURES, for the summary line
  readonly skipped: ReadonlyArray<SkipCount>;
}
export type ToolExecutor = (
  run: RunRecord,
  ctx: ToolContext,
) => Promise<ToolResult>;
export function submitRun(request: RunRequest): string; // the run id, queued
export function cancelRun(id: string): void;
export function undoRun(id: string): Promise<void>;
export function installStaleWatcher(): () => void; // already wired in App.tsx
export function summarise(result: ToolResult, elapsedMs: number): RunSummary;

// src/insights/sql.ts
export function buildFeatureRowsSql(
  table: string,
  where: string | null,
): string;

// src/insights/layerTables.ts
export function refreshLayerTableColumns(layerId: string): Promise<void>;
```

Notes for a tool author: return EVERY output column on EVERY row (nulls allowed);
`rows` keys are object ids the model may or may not have (unknown ids reach
DuckDB and are skipped in the model); an empty `rows` is a legal, done, non-undoable
run; `ctx.query` already appends to the card's log, so do not log yourself; check
`ctx.signal.aborted` (or await it) in any long loop.

`runQueue.test.ts` registers its own executor for `height-from-extent` per test
and deletes it in `afterEach`, so a real registration in `tools/register.ts`
does not fight it; the "no executor" case deliberately asks for `roof-metrics`,
which nothing registers in M1.

---

## Fix round 1

Two commits on top of `368de10`:

- `0dd69e4` fix(insights): bail out of a column refresh whose table moved
- `fd8a6f8` fix(processing): freeze a run's scope inputs at Run, not at the queue's head
- `63eb06e` fix(processing): re-validate a run's Undo at the head of the queue

`index.html`'s uncommitted edit was again left alone (staged by path only; it is
still the single thing `npx vp check` reports).

### Important 1 — the refresh outside the queued task

- `undoRun` now runs `undoComputedColumns` AND `refreshLayerTableColumns` inside
  ONE `runOnTableQueue` task (the refresh only when the undo committed), so a
  "Run again" queued behind it cannot reach the head while the registry still
  lists the column the Undo dropped. The post-write refresh in `execute` was
  already inside the queued task (`execute` IS the task); it stays where it was.
- `refreshLayerTableColumns` (`src/insights/layerTables.ts`) re-reads the store
  entry AND the module registry AFTER its DESCRIBE and returns without writing
  when the entry's `table` has changed meanwhile. It previously read `current`
  before the round trip and published `{ ...current, columns }`, so a rebuild
  that landed during the DESCRIBE was clobbered back to the old table name.
- Tests: `runQueue.test.ts` → "sees a column an Undo dropped as gone, not as one
  to replace" (Undo and a second `submitRun` back to back: no
  `CREATE TABLE "__undo_…"` for the second run, and its own Undo issues the
  `DROP COLUMN` rather than a restore). `layerTablesBuild.test.ts` → "bails out
  when the table was REBUILT while it described".
- The runQueue test's `layerTables` mock now models the registry properly: the
  duckdb mock tracks `ADD COLUMN` / `DROP COLUMN` into a `liveColumns` list and
  the mocked `refreshLayerTableColumns` republishes `tableInfo` from it after a
  `setTimeout(0)` (the real one round-trips a DESCRIBE). That delay is what makes
  "inside the queued task" observable — verified red against the old `undoRun`
  (`expected [ Array(1) ] to deeply equal []`, the stray backup) and green after.

### Important 2 — `partial` counts features

`resolveScope` now returns `total` as well as `count`, both FEATURES: the
`COUNT(DISTINCT COALESCE("feature_id","id"))` query moved into a private
`countFeatures` helper and runs once per run for EVERY scope (it used to run only
for `all`). `execute` writes `partial: { count: scope.count, total: scope.total }`
and the row-based `result.rows.size` / `table.rowCount` pair is gone.

Consequence worth knowing: `matching` and `selected` can now be refused by a
failed feature count, the same way `all` always could — pinned by
"a failed feature count refuses an id scope too".

Test: "counts the provenance partial in FEATURES, not rows" (1 building in scope
modelled as 2 rows, on a layer of 3 → `{ count: 1, total: 3 }`, summary
"Selected 1 building").

### Important 3 — the scope's inputs are frozen at Run

- `scope.ts` gained `snapshotScopeInputs(layerId): ScopeSnapshot` (the deduped
  selection on THIS layer + the APPLIED filter). It is the only store reader in
  the module; `resolveScope({ table, scope, snapshot })` reads no store at all.
  The `layerId` field is gone from its input — nothing used it once the stores
  were out.
- `submitRun` takes that snapshot plus the target's table name into a private
  `FrozenRequest` and hands it to `execute`. At the head, a table name that
  differs from the frozen one fails the run with "Layer changed while running;
  run again" (spec §6.1 re-validation). Every existing refusal and message in
  `resolveScope` is unchanged.
- `scope.test.ts` passes the snapshots explicitly and gained cases for the
  snapshot helper (other-layer selections excluded and duplicates collapsed; the
  draft filter is not the applied one) and for "ignores a selection made AFTER
  the snapshot was taken".
- `runQueue.test.ts` → "freezes the scope at Run, not at the head of the queue"
  (the selection changes while the run is queued; the SQL still names the frozen
  id) and "refuses a run whose table was rebuilt while it queued".

### Minor 4 — abort between the scope and the executor

`execute` patches `{ status: "cancelled", elapsedMs }` and returns when the signal
is aborted after `resolveScope`. Test: "cancels a run aborted while its scope was
still resolving" (the duckdb mock gates the COUNT statement). The first version of
this test passed against the unfixed code because `cancelRun` patches the card
synchronously — it now waits for the run to unwind before asserting the executor
was never called, and was verified red (`expected 1 to be +0`) then green.

### Minor 5 — the `__undo_<runId>` backup is dropped when its Undo dies

New private `discardUndo(id)`: deletes the `undoState` entry and queues
`DROP TABLE IF EXISTS "__undo_<runId>"` (not awaited — housekeeping never blocks a
card). Called from the §6.2 takeover loop, from the stale watcher, from
`submitRun` for every run the `upsertRun` eviction pushed past `MAX_RUNS`, and
once more right after `undoState.set` for a run that was evicted WHILE it ran
(which the eviction diff cannot see).

### Minor 6 — the cancel that lost the race

Test "publishes the run with the note instead of claiming the cancel": the duckdb
mock holds `COMMIT`, the cancel lands mid-transaction, and the run publishes
`done` + `note: "finished before the cancel arrived"` + `undoable: true`, with the
attribute merged.

### Minor 7 — the §6.2 Undo takeover

Test "takes the earlier run's Undo away and drops its backup": the column is
already on the table, so both runs REPLACE it. The first run's backup statement is
pinned exactly, the first run ends `undoable: false`, the second `true`, and
`DROP TABLE IF EXISTS "__undo_run_N"` follows (awaited through `vi.waitFor`, since
the drop is fire-and-forget on the queue). This also closes concern 3 of the
original report — the REPLACED path now has queue-level coverage.

### Minor 8 — `elapsedMs` on the pre-scope failures

"Layer removed", "This layer's table could not be built", "Layer changed while
running; run again" and "Not available yet" all patch `elapsedMs`. Test: "times a
failure that happened before the scope resolved" (`performance.now` stubbed to
advance, so the assertion is not a race).

### Beyond the eight findings: Undo re-validation

Found while reviewing the round. Undo pressed on run 1 while run 2 over the same
column is mid-write: the undo task queues behind run 2, run 2 publishes and takes
run 1's Undo away (patching `undoable: false` and queueing the backup's DROP
BEHIND the already-queued undo), and the undo then ran anyway — restoring the
column from a backup describing the state two writes ago and dropping columns run
2 had created, while run 2's card still read done. A rebuild in the same window
sent the undo's `UPDATE` against a dropped table.

`undoRun`'s queued task now re-reads the card and the `undoState` entry at the
head and does nothing when either has gone — the same re-validation a run's scope
gets, and the reason the guard at the top of `undoRun` is not enough. Test: "does
not undo a run whose Undo was taken away while the undo queued" (verified red:
the restore statement was issued and the model lost run 2's value).

### Coverage of the three `discardUndo` paths

The §6.2 takeover and the stale watcher both pin the
`DROP TABLE IF EXISTS "__undo_<runId>"` (the stale test's column is pre-existing
so the run actually keeps a backup). The eviction path — 21 runs in one session —
is NOT tested: it needs 21 submits to move `MAX_RUNS`, which buys a queue-level
assertion about a line that is a two-line diff of the same helper.

### Commands

```
$ npx vitest run tests/unit/features/processing tests/unit/insights
 Test Files  22 passed (22)
      Tests  329 passed (329)

$ npx vitest run tests/unit/app
 Test Files  7 passed (7)
      Tests  72 passed (72)

$ npx tsc -b --noEmit          # clean
$ npx vp check                 # index.html only (pre-existing, not mine)
```

Baseline before the round was 22 files / 315 tests, so the round added 14 tests
(13 in `runQueue.test.ts` / `scope.test.ts` net of the rewritten ones, 1 in
`layerTablesBuild.test.ts`).

Not mine, and untouched: `index.html`, and `src/app/launchScreen.ts` /
`tests/unit/app/launchScreen.test.ts`, which appeared in the working tree during
the round (the same launch-screen edit as `index.html`). Every commit staged its
paths explicitly.

### Still open after this round

1. Original concern 4 is closed by the Undo re-validation above: a run retired by
   the stale watcher no longer reaches the SQL. A run whose whole TABLE was
   dropped without a rebuild (the layer removed) still would, and would paint
   DuckDB's binder message on the card.
2. `all` still needs a `feature_id` column, and a table without one refuses the
   run with DuckDB's binder message (original concern 2) — now on every scope,
   since the feature count runs for all three.
3. The frozen table name is the only re-validation at the head. Spec §6.1 also
   names a missing source field and a column that now belongs to the file; both
   belong to the form (Task 11) and to the cross-layer tools, which do not exist
   yet.
