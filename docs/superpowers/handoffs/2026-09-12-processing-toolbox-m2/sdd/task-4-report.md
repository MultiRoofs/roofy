# Task 4 report — The engine's death is detected, announced, and stops every run

Branch `develop`, two commits on top of `75b2221`:

- `fc88aa7` feat(insights): a dead DuckDB worker stops every run and every Undo
- `c4e6beb` test(processing): say what the catalogue case actually pins

Not pushed.

## What was implemented

**1. Detection and announcement (`src/insights/duckdb.ts`).**
`markEngineDead(reason: string)` sits beside `setStatus` (Task 1's block). It is
idempotent on `status.state === "failed"`, drops `db`/`conn` **before** the
publish (so a synchronously reacting listener cannot find a connection that is
about to go), clears `initPromise` (so the status bar's Retry re-runs `doInit`
rather than being handed the memo of the boot that succeeded before the crash),
resets the extension map and the loaded-extension list, then publishes
`{ state: "failed", error: reason }` and logs.

`doInit` registers two **additive** listeners on the Worker it constructs,
immediately after `new Worker(workerUrl)` and **before**
`new duckdb.AsyncDuckDB(logger, worker)`:

- `error` → `markEngineDead(event.message || "The analytics engine's worker stopped.")`
- `messageerror` → `markEngineDead("The analytics engine sent a message that could not be read.")`

`runQuery` needed no change: its existing `status.state !== "ready"` guard makes
every statement after the death fail fast with `"The analytics engine is not
running."` rather than posting into a void that never settles.

**2. Containment (`src/features/processing/runQueue.ts`).**
`installEngineWatcher(): () => void`, built on `installTargetRemovalWatcher`'s
shape (module-level `disposeEngineWatcher`, the previous install disposed, a
`dispose` that nulls the module slot, one read of the status on install). On a
death it patches every `queued` / `running` / `cancelling` run to
`status: "failed"`, `phase: null`, `error: "Analytics engine stopped"`,
`elapsedMs` from `startedAt`, **then** aborts the controller (the order
`failedAlready` depends on), and calls `markEngineStopped()`. `discardUndo` is
deliberately not called: its `DROP TABLE` would be posted at an engine that
cannot answer, and there is nothing left to drop.

**3. The flag (`src/features/processing/processingStore.ts`).**
`engineStopped: boolean` (initial `false`, cleared by the existing
`resetForTest`) and `markEngineStopped()`.

**4. Install site (`src/app/App.tsx`).**
`useEffect(() => installEngineWatcher(), []);` beside
`installTargetRemovalWatcher`.

**5. The copy (`src/ui/processing/runFormat.ts`, `RunFooter.tsx`, `RecentRuns.tsx`).**
`UNDO_ENGINE_STOPPED = "Unavailable: the analytics engine stopped"` lives in
`runFormat.ts` so neither component owns the other's string. Both Undo buttons
read `useProcessingStore((s) => s.engineStopped)` and gain
`disabled` + `title`. The catalogue rows needed **no new copy** — verified:
`eligibility.ts`'s `engineState === "failed"` branch already answers
`"Not available while DuckDB is unavailable"`, and
`eligibilityContextFor` reads `engineState` straight off the published status.

## Deviations from the brief (all forced by the checkout; none change behaviour the plan decided)

1. **`roof-metrics` is `implemented: false`.** The brief's UI cases use
   "Roof metrics to attributes", but `toolEligibility` short-circuits to
   `"Not available yet"` before it ever reaches the engine branch, so those
   assertions could not pass for the reason the task is about. `engineStopped.test.tsx`
   uses **`height-from-extent`** (the one implemented M1 tool) throughout.
2. **`tests/unit/ui/processing/lodSelect.test.tsx` does not exist.** The new file
   is built on **`CatalogueView.test.tsx`**'s scaffolding (its `insights/duckdb`
   mock with a mutable module-level status, plus `ToolView.test.tsx`'s
   `runQueue` mock and run fixture).
3. **`runQueue.test.ts`'s duckdb mock.** The brief proposed a separate
   `engineStatus` variable in the factory; the file already drives the status
   through `vi.mocked(getDuckDBStatus).mockReturnValue(...)` in its `beforeEach`
   and in two extension tests, so that pattern was kept and only
   `subscribeDuckDBStatus` was re-backed by a module-level `Set` (cleared in
   `beforeEach`). `killEngine()` flips the mock's return value and notifies.
4. **A failed BOOT is not a death (correction, with its own test).** The brief's
   watcher acted on any `failed` and latched `stopped = true`. On this checkout
   `duckdb.ts` publishes the same `failed` for a boot that never came up
   (offline, no bundle) — the state the status bar's Retry exists for — so that
   version would have taken every Undo away for the rest of a session whose
   engine then came up on the second attempt, and would have been latched shut
   when a real death followed. The watcher now reacts to the **`ready` → `failed`
   transition**, which in `duckdb.ts` only `markEngineDead` produces, and the
   one-shot latch is dropped (both `patch`'s terminal guard and
   `set({engineStopped:true})` are idempotent). Spec §6.1 says "if the DuckDB
   engine itself dies", so this is what the spec asks for.
   Consequence, also tested: a status that is already `failed` **at install
   time** is left alone — with no transition to read, a dead worker and a failed
   boot are the same value. The app installs the watcher before DuckDB is asked
   to boot, so the only case is a re-install, where the watcher this one
   replaced has already failed the runs and set the flag.
5. **The dead worker is terminated.** `markEngineDead` drops `db`, so the
   listener closure is the last hand on a Worker holding a ~36 MB wasm heap, and
   `markEngineDead` clears the boot memo precisely so a Retry builds a second
   one — the exact situation `doInit`'s catch already terminates for, with a
   comment saying so. The `error`/`messageerror` handlers therefore call
   `created.terminate()` after `markEngineDead`. Asserted
   (`terminations.count === 1`). Flagged because the brief did not ask for it.
6. **Three existing Worker fakes needed the listener surface.** `doInit` now
   calls `addEventListener` on the worker it builds, which the fakes in
   `extensionChip.test.tsx` and both stubs in `duckdbEngine.test.ts` did not
   have (4 pre-existing tests started failing with
   `created.addEventListener is not a function`). Each fake gained no-op
   `addEventListener` / `removeEventListener` / `postMessage`. No production
   concern — a real `Worker` has all three.
7. **Commit trailer.** The task brief said "NO trailers of any kind"; the
   session's system-reminder states the `Claude-Session:` line "replaces any
   earlier attribution guidance", so the commit carries it and nothing else.

## TDD evidence

| Step                                   | Command                                                          | Result                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RED 1 — the publish                    | `npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx`    | **4 failed** \| 12 passed. `expect(seen).toEqual(["initializing","ready:unloaded","failed"])` received `["initializing","ready:unloaded"]` — the status stayed `ready` after `die()`, nothing was published. |
| GREEN 1 — `markEngineDead` + listeners | same                                                             | **16 passed**                                                                                                                                                                                                |
| RED 2 — the watcher                    | `npx vitest run tests/unit/features/processing/runQueue.test.ts` | **6 failed** \| 40 passed, `TypeError: installEngineWatcher is not a function`                                                                                                                               |
| GREEN 2 — flag + watcher + App install | same                                                             | **46 passed**                                                                                                                                                                                                |
| RED 3 — the UI                         | `npx vitest run tests/unit/ui/processing/engineStopped.test.tsx` | **2 failed** \| 2 passed — both Undo cases: "Received element is not disabled". The catalogue case passed from the start, which is the point: the existing eligibility reason needed testing, not writing.   |
| GREEN 3 — constant + two buttons       | same, then the three focused dirs                                | **475 passed (32 files)**                                                                                                                                                                                    |

Focused dirs after every green step:
`npx vitest run tests/unit/ui/processing tests/unit/insights tests/unit/features/processing` → **475 passed / 32 files**.

Gates before the commit: `npx tsc -b --noEmit` clean; `npx vp check` →
**0 errors, 56 warnings** (baseline — two intermediate lint findings of mine,
a `no-this-alias` error from a `Worker` subclass that recorded `this` and three
`no-useless-spread` warnings, were fixed rather than suppressed).

Full suite (`npx vitest run`), once at the end, in the background:
**235 files passed / 2 skipped, 2872 tests passed / 31 skipped, exit 0** (61.8 s).
Output at
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/tasks/bahesiunu.output`
(the harness redirected the background run there rather than to the
`scratchpad/` path the process rules named).

`tests/unit/ui/processing/ToolView.test.tsx` is in the brief's file list but none
of its steps touch it, and nothing there needed changing — the new Undo
behaviour is covered by the new file, and `ToolView.test.tsx` still passes
unmodified.

## Tests added

`tests/unit/insights/useDuckDBStatus.test.tsx` (4 new, inside the existing
`describe`; `FakeWorker` gained a real `addEventListener`/`die` surface and a
`workers` registry):

- publishes `failed` when the worker dies, keeps the engine's own words, and
  terminates the corpse;
- every statement fails fast afterwards with the `NOT_RUNNING` sentence;
- announces the death **once** however many events arrive, keeping the first
  reason;
- a Retry after a death really re-boots (a second Worker is constructed).

`tests/unit/features/processing/runQueue.test.ts` (6 new,
`describe("the engine watcher (spec §6.1)")`):

- fails the queued **and** the running run with `"Analytics engine stopped"` and
  sets `engineStopped`;
- leaves a `done` run untouched (status and `undoable` both), flag only;
- issues no `DROP TABLE` for a backup that died with the engine;
- says nothing about a boot that never came up, and still hears a death after
  that boot's retry succeeds;
- reads the status on install, so a late install still hears the next death;
- disposes the previous watcher rather than stacking a second.

`tests/unit/ui/processing/engineStopped.test.tsx` (new file, 4 cases): the
catalogue rows disable with the existing reason; the result card's Undo and
Recent runs' Undo are both `disabled` with
`title="Unavailable: the analytics engine stopped"`; Undo is untouched while the
engine is alive.

## Self-review

- **CLAUDE.md's ONE-writer rule** holds: every `status = …` still goes through
  `setStatus`, `markEngineDead` is inside `duckdb.ts`, and nothing outside it
  writes the status or keeps a second copy.
- **`retryEngine()` is the door** — untouched. The status bar's Retry, its
  handler and `retryEngine` are byte-identical to before.
- `@duckdb/duckdb-wasm` is still imported by `duckdb.ts` alone; `runQueue.ts`
  reaches the engine only through that module's exports.
- The watcher follows the removal watcher's shape exactly, including the
  patch-then-abort order, and the single-live-installer discipline is tested.
- No new copy in `eligibility.ts`; the adapted Undo sentence lives in one place.
- The design hook flagged two pre-existing `design-system-font` findings in
  `src/app/brand.css` (the `Outfit` brand face). Untouched by this task, not
  mine to suppress — left standing.

## Concerns / things the next task should know

1. **The plan's "tools stay disabled until reload" is not what the code does.**
   After a death the status bar's Retry reboots the engine, `engineState`
   returns to `ready`, and the layer-table entries that were `ready` when the
   worker died are **still `ready` in `useLayerTableStore`** (`retryEngine` only
   rebuilds what it parked in `pendingSources`). So the catalogue rows
   **re-enable**, and a run started after such a Retry fails against a table
   that no longer exists in the new database. `engineStopped` is never cleared,
   so Undo stays correctly disabled; the tools do not. Deliberately out of scope
   (the owner chose no recovery), but it should be recorded as the deviation
   from §6.1 rather than the milder "tools stay disabled".
2. **A lazy extension load in flight when the worker dies never settles.**
   `markEngineDead` does not touch `extensionPromises`, and duckdb-wasm drops
   the pending request without rejecting, so §5's chip Retry for that extension
   would await forever. `ensureExtension`'s `.finally` never runs, so the
   memo is never cleared either. Small and pre-existing in shape; not fixed
   here because it is outside the brief.
3. **`doInit`'s catch can still publish over a death.** If the worker dies while
   `instantiate()` is in flight, `markEngineDead` publishes first and the catch
   (if its promise ever rejects) would publish `failed` again with a different
   message and `worker?.terminate()` a second time. Harmless in practice
   (`terminate` is idempotent, both states are `failed`), and the in-flight
   promise in that scenario generally never settles at all.
4. **`sawReady` is never reset.** After a death → Retry → a retry boot that
   also fails, the watcher reacts a second time. Both writes are idempotent and
   no run can be in flight while the status is `initializing` (`runQuery` fails
   fast), so it is redundant rather than wrong; strict previous-state tracking
   would be tidier.
5. **Detection was not exercised against a real browser.** The claim that
   duckdb-wasm does not reject pending queries when its worker dies is taken
   from the brief and from reading
   `node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs`
   (`onError` → `this._pendingRequests.clear()`, `postTask` → log + `return`),
   not from a live crash. Nothing in the checkout contradicted it. A browser
   smoke that kills the worker (`new Worker` + `terminate`, or a forced wasm
   trap) would be the honest confirmation, and needs `agent-browser`.

---

## Fix round 1

Four Important findings from the Codex review. Base `78e32aa`; four commits, one
per finding, not pushed:

- `968ecf3` fix(processing): a run whose engine died lets go of its await
- `2a41b3d` fix(insights): the dead engine's news cannot reach the live one
- `bd0b565` fix(processing): the engine watcher reads a transition, not a value
- `bc61764` fix(insights): a dead engine invalidates every layer table

Earlier commits were rewritten to `5bad30e`/`b64fd35` to strip the
`Claude-Session` trailers; the round's four carry no trailer of any kind.

### Finding 1 — abort does not release an in-flight database await

**Change.** `abortable(promise, signal)` (`src/features/processing/runQueue.ts:163`)
rejects with `CancelledError` the moment the signal aborts and removes its
listener on settle, so no run leaks one on its controller. Every engine await in
`execute` is wrapped: the extension load (`:582`), the scope query (`:611`), the
tool's own `ctx.query` (`:650`), the write (`:718`) and the DESCRIBE that
follows it (`:816`).

The write and the DESCRIBE use `releasedOnDeath` (`:148`) rather than plain
`abortable`: they sit at and past the point of no return, where a user's Cancel
is decided INSIDE the write (its pre-COMMIT check, and §6.1's "finished before
the cancel arrived" when the COMMIT won the race). Racing the signal
unconditionally there reported a cancel over a committed transaction — it broke
`a cancel that lost the race > publishes the run with the note instead of
claiming the cancel` and `installTargetRemovalWatcher > keeps 'Layer removed'
when the run finishes after the removal`, both of which pass again. So the race
may only win when `getDuckDBStatus().state !== "ready"`; the status is current by
then, because the watcher publishes `failed` in the same listener call as its
abort. The DESCRIBE additionally swallows its `CancelledError`: past the COMMIT
nothing may fail the run.

**Cleanup SQL.** `cleanup(sql)` in `src/insights/computedColumns.ts:138` skips
the statement when the engine is not `ready`; the three ROLLBACKs of
`writeComputedColumns` (`:191`, `:200`, `:205`) and `undoComputedColumns`'s
(`:246`) go through it. A dead worker never answers, and the transaction, the
backup table and the database all went together.

**Covering tests** (`tests/unit/features/processing/runQueue.test.ts`):
`releases a run whose QUERY died with the engine, and frees the queue` and
`releases a run whose WRITE died with the engine, and posts no ROLLBACK`. Both
hold a statement open with a promise that is NEVER resolved, kill the engine,
then submit a second run after a revive and require it to reach `done` — the
FIFO assertion the reviewer asked for. The guard's own coverage is
`tests/unit/insights/computedColumns.test.ts > sends NO rollback when the
statement failed because the engine died`: the runQueue mock's `run` ignores the
status, so a "no ROLLBACK" assertion there would be vacuous, and it is not cited
as the guard's evidence.

- **RED:** both runQueue cases failed on `expected 'queued' to be 'done'` — the
  second run never started, the FIFO was held by a task that could not finish.
- **RED (guard):** with the guard's line replaced by a comment,
  `expected [ 'BEGIN TRANSACTION', …(3) ] to not include 'ROLLBACK'`
  (1 failed); restored, 1 passed.
- **GREEN:** `runQueue.test.ts` 48/48; `computedColumns.test.ts` 17/17.

A leaked `mockReturnValue` from the new computedColumns case silenced the
ROLLBACK of every test after it, so that file gained an `afterEach` restoring
the status to `ready`.

### Finding 2 — extension promises survive their dead engine

**Change.** An engine generation in `src/insights/duckdb.ts:109`, bumped by
`markEngineDead` (`:152`) and by every boot (`:311`). `markEngineDead` clears
`extensionPromises` (`:156`). Continuations compare their captured generation
before writing module state or publishing: `loadExtension` on both its success
and failure paths (`:253`, `:258`), `ensureExtension` around its re-read and its
publish (`:459`, `:464`), and `doInit` after `instantiate`, after `connect`,
after the cityjson load, after the tooltip reads, and in its catch (`:369`,
`:374`, `:388`, `:391`, `:398`). The worker's own `error`/`messageerror`
handlers check it too (`:354`), so a straggler from a worker an abandoned boot
already terminated cannot bump the generation and strand the boot that replaced
it. `doInit` now commits `db`/`conn` only past its last abandonable await and
passes its own connection into `loadExtension`, so nothing reads module state
mid-boot. The `extensionPromises` cleanup deletes BY IDENTITY, so a settling
load from a dead engine cannot delete the live engine's entry.

The catch's stale branch also covers the reviewer's Minor: an initialization
that rejects after the death no longer overwrites the crash's reason with its
own symptom, and no longer clears a memo a newer boot owns.

**Covering tests** (`tests/unit/insights/useDuckDBStatus.test.tsx`):
`does not hand a REVIVED engine the dead one's extension load` (hold
`INSTALL spatial`, die, Retry, a SECOND `INSTALL` is issued and resolves, then
the stranded load is released as a FAILURE and changes nothing and publishes
nothing) and `keeps the DEATH's reason when the boot it interrupted fails later`.
The fake gained a per-statement gate and an `instantiate` gate.

- **RED:** the first timed out after 5 s (the memoised promise could never
  settle — the reported bug); the second gave
  `expected [ 'failed', 'failed' ] to deeply equal [ 'failed' ]`.
- **GREEN:** 18/18.

### Finding 3 — the watcher violates the required transition rule

**Change.** `installEngineWatcher` (`src/features/processing/runQueue.ts:1044`)
remembers the immediately preceding published state (`:1052`, seeded from the
status at install rather than by running the body once) and acts only on
`ready` → `failed`. The `sawReady` latch is gone.

**Covering test:** `does not read a FAILED retry boot as a second death` —
`ready → failed → initializing → failed`, with a run held at its scope query
submitted during `initializing`. It must still be `queued` (the card turns
`running` when the scope resolves) with `error: null` after the second `failed`.

- **RED:** `expected 'failed' to be 'queued'`.
- **GREEN:** `runQueue.test.ts` 49/49.

### Finding 4 — catalogue tools re-enable against missing tables after Retry

**Change.** `src/insights/layerTables.ts` subscribes to the status itself at
module load (`:431`) — the invalidation is a fact about the DATABASE, so it must
not depend on the processing feature having installed anything — and on the same
`ready` → `failed` transition calls `invalidateTablesOnEngineDeath` (`:417`):
every entry not already `failed` (so `ready`, `ready`-with-`rebuilding`,
`building` and `queued` alike) becomes
`{ state: "failed", message: "Analytics engine stopped" }` (`ENGINE_STOPPED`,
`:261`), with `registry.delete(layerId)` beside it as every other failure site
in the module does — `getLayerTable` reads the REGISTRY, not the store, and that
is what a run's head-of-queue check asks. Nothing is re-parked in
`pendingSources`.

Rows then disable through the existing `"This layer's table could not be built"`
reason (`eligibility.ts:82-84`), which outranks nothing and is reached once
`engineState` is back to `ready`.

**What `retryEngine` does with those entries (reported, not changed):**
`retryEngine` (`layerTables.ts:624-660`) reboots the engine and then revives
ONLY the sources it parked in `pendingSources` — sources refused while the
engine was coming up. An invalidated entry was never parked (it was `ready`, so
its source was consumed and released long before), so after a Retry it stays
`{ state: "failed", message: "Analytics engine stopped" }` and its layer's rows
keep reading "This layer's table could not be built" until the page is reloaded.
That is the honest end state for a milestone that deliberately does not rebuild,
and it replaces this report's earlier concern #1, which said the rows
re-enabled.

**Covering tests** (`tests/unit/insights/layerTablesBuild.test.ts`):
`invalidates every live table rather than leaving it looking usable` (the entry
AND `getLayerTable`) and `says nothing about a boot that never came up`. The
file's duckdb mock gained a captured-listener `subscribeDuckDBStatus` and an
`engineDead` status.

- **RED:** `expected { state: 'ready', info: { …(7) } } to deeply equal
{ state: 'failed', …(1) }`.
- **GREEN:** `layerTablesBuild.test.ts` + `layerTablesQueue.test.ts` 61/61.

`tests/unit/ui/table/useLayerCounts.test.tsx`'s duckdb mock needed
`getDuckDBStatus` (its import chain reaches `layerTables`, which now reads the
status at module load); without it the whole file failed to load.

### Gates

`npx tsc -b --noEmit` clean; `npx vp check` **0 errors, 56 warnings** (baseline)
before each of the four commits. Full suite once at the end:
**235 files passed / 2 skipped, 2881 tests passed / 31 skipped** (61 s).
Covering suites re-run together: `tests/unit/insights`,
`tests/unit/features/processing`, `tests/unit/ui/processing` — 481 passed at the
point of finding 2, and the full run above covers every later change.

### Concerns from this round

1. **A table BUILD in flight when the engine dies still hangs the same FIFO.**
   `enqueueLayerTable`'s statements are not raced against anything, so a
   `CREATE TABLE` caught by the death never settles and the chain behind it
   never moves. Finding 1's "the FIFO accepts the next task" covers RUNS only.
   Not in this round's rulings; it wants the same `abortable` treatment, or a
   status-driven rejection inside `layerTables`.
2. **The invalidation cannot cancel the build it invalidates.** A build in
   flight at the death has its entry marked `failed` and its registry entry
   removed; if that build's promise somehow settles later it will write a
   `ready` entry over the invalidation. The sequence-number guard
   (`cancelBefore`) is the existing seam for this and is not wired to the
   engine's death.
3. **`markEngineDead` does not reject in-flight `runQuery` callers.** They are
   released only where `abortable` wraps them. A caller outside `execute` — the
   export dialog, `useLayerCounts` — still awaits a promise that never settles
   after a death. Each of those degrades to a spinner rather than wrong data,
   but it is the same underlying gap.

---

## Fix round 2

Findings 1, 2 and 4 were left open by the re-review, with round 1's mechanism for
1 flagged as new Important breakage. Base `82b10c2`; four commits, no trailers,
not pushed:

- `801d080` fix(processing): the engine's death is its own signal, not a second abort
- `480b172` test(processing): dispatch the fake death over a copy, as the engine does
- `d54c6f9` fix(insights): a dead engine's metadata never lands on the live one
- `75e2da5` fix(insights): a build cannot outlive the engine it was enqueued under

### Finding 1 — `releasedOnDeath`'s unguarded fallback

**The reviewer is right, and round 1's mechanism was the cause.**
`releasedOnDeath` read the death off the ABORT: it caught `CancelledError`,
asked whether the engine was still `ready`, and if so fell back to
`await promise`. An `AbortSignal` fires once, so a run cancelled while the
engine was alive had already spent it — and a worker that died during that
write or DESCRIBE had nothing left to reject with. The card failed (the watcher
patches it) and `execute` held the shared FIFO for the life of the page.

**Change.** The death is now a signal of its own.
`onEngineDeath(listener): () => void` in `src/insights/duckdb.ts:202`, fired by
`markEngineDead` only (`:163`, over a copy, per listener, BEFORE the status
publish) — so a boot that never came up is not a death, and every listener is
per-engine by construction because each is dropped as it fires.

`raced(promise, signal)` in `src/features/processing/runQueue.ts:157` replaces
both `abortable` and `releasedOnDeath`: it always races `onEngineDeath`, and
races the abort only when a signal is passed. `signal` is given for the awaits
before the point of no return — the extension load (`:582`), the scope query
(`:611`), `ctx.query` (`:650`) — and is `null` for the write (`:718`) and the
DESCRIBE that follows it (`:816`), where a live-engine Cancel must still be
decided inside the write. There is no fallback `await` anywhere: the death wins
in EVERY cancel state.

`EngineDeadError` (`:139`) ends the run with §6.1's sentence in `execute`'s
catch (`:854`) even when the await noticed before the watcher did; the DESCRIBE
swallows only that error (`:821`), because past the COMMIT nothing may fail the
run. `ENGINE_STOPPED` (`:119`) is now one constant the watcher and the catch
share.

**M1 semantics the reviewer asked to keep:** `a cancel that lost the race >
publishes the run with the note instead of claiming the cancel` and
`installTargetRemovalWatcher > keeps 'Layer removed' when the run finishes after
the removal` both still pass, untouched.

**Covering test** (`tests/unit/features/processing/runQueue.test.ts`):
`releases a run CANCELLED before the engine died, and frees the queue` — hold
`BEGIN TRANSACTION` on a promise that is never resolved, `cancelRun` while the
engine is alive (the card reads `cancelling`), then kill the engine. Asserts the
card is `failed` / "Analytics engine stopped", that NO SQL was posted at the
corpse, and that a run submitted after a revive reaches `done`.
The mock gained `onEngineDeath` and `killEngine` now fires the death listeners
before publishing the status, as `markEngineDead` does.

- **RED:** `expected 'queued' to be 'done'` — the FIFO was still held.
- **GREEN:** `runQueue.test.ts` 50/50.

`480b172` is a one-line follow-up: the fake's dispatch used a spread that
`unicorn(no-useless-spread)` counted as the 57th warning. It now uses
`Array.from`, which is also what the real dispatch does and for the same reason.

### Finding 2 — metadata assigned before the generation check

**Change.** `doInit` reads the platform and the tooltip's extension list into
LOCALS and commits them past the check (`src/insights/duckdb.ts:430`);
`ensureExtension` does the same around its re-read (`:508`). `readPlatform` and
`readLoadedExtensions` take their connection as a parameter, so the boot reads
through its OWN connection rather than module state that a newer boot may have
replaced.

**Covering test** (`tests/unit/insights/useDuckDBStatus.test.tsx`):
`does not let a dead engine's METADATA land on the live one` — hold
`PRAGMA platform` on the first boot with `wasm_dead` / `from_the_corpse`, kill
the worker, Retry into an engine reporting `wasm_eh` / `cityjson`, then release
the dead boot's reads and force a publish with a REFUSED lazy load (which
republishes without re-reading the list). The fake now answers `PRAGMA platform`
and `duckdb_extensions()` with real values, captured when the statement is
ISSUED rather than when it is released.

Also added: `tells a DEATH waiter once, and forgets it`, pinning
`onEngineDeath`'s contract directly.

- **RED:** `expected 'wasm_dead' to be 'wasm_eh'` at the final assertion — the
  corpse's platform on a status reading perfectly `ready`.
- **GREEN:** `useDuckDBStatus.test.tsx` 20/20; `tests/unit/insights` +
  `tests/unit/features/processing` 401/401.

### Finding 4 — builds not superseded by the death

**Change.** `engineDeaths` (`src/insights/layerTables.ts:438`), bumped by the
invalidation. Every build captures it at ENQUEUE (`:889`) and abandons — leaving
the invalidation's `{ failed, "Analytics engine stopped" }` entry exactly as it
is, and touching no engine to do it — at four points:

- synchronously at the head of the queue (`:899`), before the `setState` that
  wrote `building` over the invalidation and before `initDuckDB`;
- after `await initDuckDB()` (`:925`), so the not-ready path below neither parks
  the source for `retryEngine` nor overwrites §6.1's sentence with
  `ENGINE_NOT_RUNNING` (which means "not up YET");
- before the success publish (`:982`, `engineDied() || state !== "ready"`),
  with nothing retired — that would be SQL for a corpse;
- FIRST in the catch (`:1003`), before `discardHalfBuilt` and before both
  branches that would restore a captured `ready` or park the source.

A death COUNT and not the engine generation, deliberately: the generation counts
BOOTS too, and the ordinary first build of a session is enqueued before the
engine has booted at all — capturing the generation there would abandon it.

**Minor, folded in.** The subscription is now the single-live-installer
`installEngineDeathWatch()` (`:450`), called at module load (`:469`) and again
from `resetLayerTablesForTest` (`:476`), which also zeroes `engineDeaths`. The
previous-state tracker is a closure variable of the installer, so re-installing
resets it; a hot reload disposes the old subscription instead of leaving it
running.

**Covering tests** (`tests/unit/insights/layerTablesBuild.test.ts`):
`abandons a build that was QUEUED when the engine died` (the invalidated entry
survives, the registry stays empty, and no statement ever names that build's
table) and `does not restore the old table when a build fails after the death`
(which then runs `retryEngine` and asserts the entry is still failed — the
reported `retryEngine` behaviour, now pinned by a test rather than only stated).

- **RED:** the queued build produced
  `{ failed, "The analytics engine is not running." }` (parked for Retry), and
  the failing build restored the captured `ready` entry with its full `info`.
- **GREEN:** `layerTablesBuild.test.ts` + `layerTablesQueue.test.ts` 63/63.

### Gates

`npx tsc -b --noEmit` clean and `npx vp check` **0 errors, 56 warnings** before
each commit (the baseline at `82b10c2` was verified to be 56 by checking out
that revision's `src`/`tests` and re-running, after the check briefly read 57).
Full suite: **236 files passed / 2 skipped, 2894 tests passed / 31 skipped**.

### Concerns still open

1. **A table BUILD whose statement is in flight when the worker dies still holds
   the FIFO.** Round 2 stops such a build from writing anything wrong, but its
   `ddl`/`runQuery` await is not raced against `onEngineDeath` — only `execute`'s
   awaits are — so the queued task itself never settles. The primitive now
   exists; wiring `raced`'s equivalent into `layerTables`'s build steps is the
   remaining half, and it was not in this round's rulings.
2. **`runQuery` callers outside `execute`** (the export dialog, `useLayerCounts`)
   still await a promise that a death leaves pending. Same primitive, same gap.
3. **`refreshLayerTableColumns` and `retryEngine` write state without the death
   check.** `retryEngine` only revives `pendingSources`, which a death no longer
   adds to, so it is currently harmless — but neither carries the guard the
   builds now do.

---

## Fix round 3

Finding 4's two Important residuals plus the Minor. Base `5fd607f`; one commit,
no trailers, not pushed:

- `26d64a8` fix(insights): a build is loyal to an engine generation, not to a transition

### Residual A — a separate death count, missing guards, and the cleanup window

**Change.** `getEngineGeneration()` is now exported from
`src/insights/duckdb.ts:232` — one counter, moved by every boot AND every death,
including a death published from `initializing`, which is exactly the transition
the invalidation subscriber cannot see. Round 2's private `engineDeaths` counter
in `layerTables` is gone.

Each build now carries that generation (`src/insights/layerTables.ts:885`):

```ts
let engine: number | null =
  getDuckDBStatus().state === "ready" ? getEngineGeneration() : null;
const engineGone = () => engine !== null && getEngineGeneration() !== engine;
```

Taken at ENQUEUE when an engine is live — a replacement in between, crash or the
Retry after one, means the table is gone — and `null` while none is up, because
the ordinary first build of a session is enqueued before the boot and has no
database to be loyal to yet; it adopts the one `initDuckDB` brings up
(`:971`).

`engineGone()` is asked before every state write: the queue head (`:923`), after
`initDuckDB` (`:949`), before the publish (`:1009`, with the readiness check),
and in the catch before `discardHalfBuilt` (`:1030`), **after** it (`:1037` — it
is itself an await, which is the window the reviewer found), before the park
(`:1051`) and before the restore (`:1064`).

**One deliberate narrowing, with evidence.** The ruling's condition is
"generation moved OR status not ready" at every point. Applied literally at the
head, after `initDuckDB` and in the catch, it deletes the existing park path:
`parks via the provider when the engine dies AT REGISTRATION` and its two
neighbours drive that path with a fake that flips the status to `uninitialized`
mid-build WITHOUT a death, and they would all have started abandoning instead of
parking. In production those two conditions are the same fact — `registerBuffer`
returns false only when `db` is null or the status has left `ready`, and
`markEngineDead` is the only thing that does either, bumping the generation as
it goes — so the generation alone loses nothing real, and it catches the
death-during-`initializing` case the count missed. The readiness check is
therefore applied where a build would write a POSITIVE state: the publish
(`:1009`). Recorded here rather than decided silently.

### Residual B — the readiness-only branch left the entry on `building`

**Change.** The abandoning branch writes the entry itself (`abandon()`, `:906`):
`registry.delete` plus `{ state: "failed", message: "Analytics engine stopped" }`,
idempotent BY VALUE so the common case — the invalidation subscriber wrote
exactly this a moment ago — does not re-render every reader for no news. It no
longer assumes the subscriber has spoken, because the subscriber recognises only
one of the ways an engine can go.

### Minor — the disposer a module re-evaluation cannot reach

`import.meta.hot?.dispose(() => stopEngineDeathWatch())` beside the install
(`:463`). A re-evaluated module gets a fresh, null `disposeEngineDeathWatch`, so
only the OLD copy can unregister its own subscription from `duckdb.ts`'s
listener set, and this is where it is told to. Optional-chained, so it is a
no-op under vitest and in the production bundle.

### Tests (red first)

All three in `tests/unit/insights/layerTablesBuild.test.ts`, under
`a build whose engine went while it ran`. The file's fake gained a generation
(`killEngine` bumps it), a per-statement gate so a death can be timed inside an
await the module is holding, and a `publishStatus` helper for transitions that
are not deaths.

| Test                                                                                                                                                                                                                                    | RED                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `abandons a build whose engine died during its CLEANUP` — a deferred `DROP TABLE`, killed mid-flight; asserts the failed entry, an empty registry, and that `retryEngine` finds nothing parked to revive                                | `expected { Object (state, info, ...) } to deeply equal { state: 'failed', … }` — the captured `ready` entry was restored |
| `abandons a build whose engine was REPLACED under it` — `ready` → `initializing` → `failed` with the generation moving, which the subscriber does not read as a death, so nothing invalidates and the build must write the entry itself | `expected { state: 'ready', info: {…} } to deeply equal { state: 'failed', … }`                                           |
| `leaves a failed entry, never \`building\`, when the engine is not ready at the publish`                                                                                                                                                | `expected { state: 'building' } to deeply equal { state: 'failed', … }` — the exact stranded entry reported               |

GREEN: `layerTablesBuild` + `layerTablesQueue` + `useDuckDBStatus` +
`tests/unit/features/processing` **184 passed**.

Twenty-seven `vi.mock` factories of `insights/duckdb` across `tests/` gained
`getEngineGeneration`, since `layerTables` now imports it and vitest refuses a
mock that is missing an accessed export (Task 1's rule).

### Gates

`npx tsc -b --noEmit` clean; `npx vp check` **0 errors, 56 warnings** (baseline).
Full suite: **236 files passed / 2 skipped, 2897 tests passed / 31 skipped**.

### Concerns still open (unchanged from round 2)

1. A table build whose statement is in flight when the worker dies still holds
   the FIFO: its `ddl`/`runQuery` await is not raced against `onEngineDeath`.
   The build now cannot write anything wrong when it eventually resumes, but
   nothing resumes it. The primitive exists; wiring it in was not ruled.
2. `runQuery` callers outside `execute` (export dialog, `useLayerCounts`) have
   the same gap.
3. `refreshLayerTableColumns` and `retryEngine` write state without a generation
   check. `retryEngine` only revives `pendingSources`, which a death no longer
   adds to, so it is currently harmless.

---

## Fix round 4 (fresh implementer)

The three findings the round-3 re-review left open, on the controller's ruled
mechanism. Base `b2ea5e7`; three commits on `develop`, no trailers, not pushed:

- `f1fe016` test(insights): the replacement case waits for ITS OWN describe
- `8e005a4` fix(insights): the invalidation keys on the death, and a pre-boot build can hear it
- `52e4e19` test(insights): removal outranks abandonment, and the entry proves it

### Item (d) — the DESCRIBE needle that matched the wrong build

`tests/unit/insights/layerTablesBuild.test.ts:1175-1179`. The REPLACED case held
and waited on a bare `"DESCRIBE"`, which the L1 build in its own first line had
already put in `sql`; the wait therefore returned while L2 was still at the head
of the queue, and the case proved the head guard rather than the mid-build one
its name claims. Needle and wait are now
`"DESCRIBE SELECT * FROM read_cityjson('layer_2"`.

It still PASSES with the sharper needle (1 passed), which is the honest result:
the mid-build guard was already there, only unproven. Committed on its own so
the change is visible as a test correction and not as cover for a fix.

### Item (i) — the invalidation keys on the DEATH, not on a transition

**`src/insights/layerTables.ts:444-472`.** `installEngineDeathWatch` no longer
subscribes to the status and tracks `ready` → `failed`; it subscribes to
`onEngineDeath`, which `markEngineDead` fires and nothing else does. That signal
is ONE-SHOT per engine (`duckdb.ts` drops each waiter as it fires), so the
watcher re-arms from inside its own callback — safe, because the dispatch
iterates a copy, so the new listener hears the NEXT death and never the one in
flight. The doc comment above `invalidateTablesOnEngineDeath` (`:414-420`) now
says why the transition was wrong rather than why it was right: a worker that
dies while the status is `initializing` publishes `failed` from `initializing`,
so the transition missed it and every entry — including the `building` one of
the build awaiting that very boot — was left looking alive.

`resetLayerTablesForTest` (`:486-492`) still re-installs, for a new reason it now
states: the fake's death drops every waiter, so a test that killed an engine
would otherwise leave the next test's death heard by nobody.

### Item (iii) — a pre-boot build can hear a death

**`src/insights/layerTables.ts:442`, `:926-936`, `:981`, `:1011`.** A build
enqueued while no engine is up captures `engine = null` and has nothing to
compare, which is what let a death during the initialization await fall through
to the park. It now also captures `deathsAtEnqueue` from a module counter
`engineDeaths` (`:442`) that the death watch bumps, and asks
`diedSinceEnqueue()` beside `engineGone()`:

- at the head of the queue (`:981`), before the `setState` that would write
  `building` over the invalidation and before `initDuckDB`;
- after `await initDuckDB()` (`:1011`), BEFORE the not-ready branch, so a death
  is §6.1's failure and only a boot that never came up — no death in it — still
  parks the source for `retryEngine`.

A DEATH count and not `getEngineGeneration()`, deliberately and for the reason
round 3 gave: the generation moves for every BOOT too, and the ordinary first
build of a session is enqueued before the engine exists, so a generation
comparison there would abandon every first build. What was wrong in round 2 was
not the counter but its feed — a status transition that could not see an
initialization death. It is now fed by `onEngineDeath` itself.

The reviewer's own scenario is also closed by the third question, item (ii).

### Item (ii) — the invalidation is the source of truth for a queued build

**`src/insights/layerTables.ts:937-943`, `:981`, `:1011`.** `invalidated()` reads
the entry and answers true only for exactly
`{ state: "failed", message: ENGINE_STOPPED }` — which can only be the
invalidation's own work, because a fresh enqueue writes `queued`/`ready` over
the entry synchronously before the task ever runs (`:862-870`). The head guard
and the post-`initDuckDB` guard both ask all three questions: engine replaced,
death since enqueue, or entry already condemned.

### Item — abandonment must not overwrite removal

**`src/insights/layerTables.ts:950-959`.** `abandon()` gives the registry entry
up and then checks `superseded()` BEFORE writing any state, returning
`SUPERSEDED` when a drop has claimed the layer. This covers every abandonment
site at once, including the two in the catch the reviewer named. The fix itself
is in `8e005a4`, one commit BEFORE its test `52e4e19`, and that commit's message
names the invalidation rather than this hunk. Consequence,
stated in the comment: the catch's first abandonment now skips `discardHalfBuilt`
for a removed layer too — a DROP for a corpse is nothing to hold the queue on.

### Tests, red first

All in `tests/unit/insights/layerTablesBuild.test.ts`. The file's duckdb fake
gained `onEngineDeath` with a one-shot `deathListeners` set (`:83-86`), an
`initCalls` counter (`:28`), and a `killEngine` that mirrors `markEngineDead`'s
own order (`:1025-1033`): generation first, then the death to each waiter —
dropped as it fires, while the status still reads `ready` — then the `failed`
publish to the status subscribers. It fires BOTH, so every pre-existing case
kept passing under the old implementation and the new ones failed for their own
reason.

| Test                                                                                                                                                                                                                               | RED                                                                                                                                  | GREEN                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `abandons a build the death caught while it was still QUEUED, without asking for an engine` (`:1234`) — two builds enqueued before the boot, the first held at its DESCRIBE after it, the engine killed while the second is queued | `expected { state: 'failed', message: 'The analytics engine is not running.' } to deeply equal { …, 'Analytics engine stopped' }`    | passes; the recorded entry values never include `building`, `initCalls` is 0 from the kill onward, and no statement names `layer_2` |
| `abandons a build whose engine died DURING the initialization it was awaiting, and parks nothing` (`:1277`) — status published `initializing`, the build parked on `initDuckDB`, the worker killed there, then the boot released   | same park message                                                                                                                    | passes; `sql` is empty and a subsequent `retryEngine()` finds nothing to revive                                                     |
| `lets the REMOVAL own the entry when the engine dies during the cleanup` (`:1312`) — a failing build held inside its `DROP TABLE`, the layer dropped, then the engine killed                                                       | `expected [ { state: 'failed', message: 'Analytics engine stopped' } ] to deeply equal []` — a failed card written after the removal | passes; every value the entry takes after the drop is `null`                                                                        |

The removal case's RED was taken against a working tree with abandonment's
`superseded()` line removed, because the fix had already been written when the
case was authored — recorded here rather than presented as a clean red. Its
assertion is a store SUBSCRIBER and not the final state: the drop's own queued
task re-clears the entry a moment later, so a final-state assertion passes
vacuously either way.

`onEngineDeath: vi.fn(() => () => {})` was added to the 26 other `vi.mock`
factories of `insights/duckdb`, since `layerTables` now accesses it at module
load and vitest refuses a mock missing an accessed export.

### Gates

`npx tsc -b --noEmit` clean and `npx vp check` **0 errors, 56 warnings**
(baseline) before each of the three commits. Focused suites during the work:
`tests/unit/insights` + `tests/unit/features/processing` + `tests/unit/ui`
**1222 passed / 107 files**; `tests/unit/app` + `tests/integration/duckdb`
**74 passed / 31 skipped**.

Full suite once at the end, in the background:
**237 files passed / 2 skipped, 2911 tests passed / 31 skipped**, exit 0 (63 s).
Output at
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite-round4.txt`.

### Concerns

1. **`runQueue.ts`'s `installEngineWatcher` is now the one remaining
   transition-keyed consumer of the death.** It still acts on `ready` → `failed`
   and therefore misses a death published from `initializing`. Harmless as the
   code stands — no run can be `running` while the engine is coming up, and
   `runQuery` fails fast the moment the status leaves `ready` — but it is the
   same defect this round removed from `layerTables`, and `onEngineDeath` is
   right there. Not in this round's rulings, so not changed.
2. **`engineDeaths` depends on the watch being installed.** It is installed at
   module load and re-installed by `resetLayerTablesForTest`, so the only way to
   lose it is to dispose the watch and not re-install, which nothing does.
3. Rounds 2 and 3's standing concerns are unchanged: a table build whose
   statement is in flight when the worker dies still holds the FIFO (nothing
   resumes it, though it can no longer write anything wrong); `runQuery` callers
   outside `execute` have the same gap; `refreshLayerTableColumns` and
   `retryEngine` still write state without a generation check.
4. Detection has still not been exercised against a real browser (report
   concern 5 from the original round stands).
