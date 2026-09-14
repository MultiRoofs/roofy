# Task 27 — The M1/M2 leftovers — report

**Status:** DONE. Six commits on `develop`, base `ca4cb79`, nothing pushed, **no trailers of any
kind** (`git log -5 --format=%B` checked and quoted below), hooks not bypassed, the plan untouched.
Nothing staged from `.github/hooks/`, `docs/design-history/` or `.superpowers/`; `git status --short`
is clean apart from those two pre-existing untracked directories.

- `a090400` `fix: the write step's SQL reaches the run log, statement by statement`
- `5c21b30` `feat: Open table scrolls the run's columns into view`
- `4de01be` `fix: the synthetic Roof area header explains the contributor rule`
- `93e7a0e` `fix: the consumer sweep compares stream versions before rebuilding`
- `3ea5a53` `fix: an undone run's Style by result leaves a vector layer alone too`
- `6df91b1` `test: the removed-layer version case really tests the deletions` (see the addendum)

One leftover per commit, plus requirement 6 as its own commit (the brief squashes all four; the
process rules allow one per leftover and the advisor concurred).

## Implemented

### 1. `WriteOutcome.statements` and the write step's log entries (`a090400`)

- `src/insights/computedColumns.ts`
  - `WriteOutcome` gains `statements: ReadonlyArray<string>` on **both** branches.
  - `cleanup(sql)` now returns `Promise<boolean>` — whether it actually SENT the statement (it is
    skipped when the engine is dead). A local `rollback()` helper pushes `"ROLLBACK"` into the
    record only on `true`, so the log never claims a rollback nobody issued (**residual C10**).
  - `writeComputedColumns` collects `issued: string[]`: each planned statement pushed immediately
    before `step()`, then `issued.push("COMMIT")` **immediately before** `step("COMMIT")` — so a
    FAILED commit appears in the record (**residual C10**). All five returns carry `statements`;
    the pre-transaction `registerBuffer` failure returns `statements: []`.
- `src/features/processing/runQueue.ts`
  - New module-level `logWriteStatements(log, statements, ms, rows)` beside `execute`: one
    `Writing results (n/N)` entry per statement (**[adapted copy A10]**), the whole write's `ms`
    and `rows` on the LAST entry only, and M1's single `sql: null` entry kept for an EMPTY list
    (the write that never reached the engine).
  - The This-layer write calls it and then `patch(id, { log: [...log] })`, so the entries are on the
    record before the throw on the failure path (the catch also re-patches `log`).
  - The New-layer branch passes `recordWrite:` into `prepareDerivedCityLayer` — the SAME recorder,
    so the two destinations cannot drift (**residual C9**).
- `src/features/processing/deriveLayer.ts`
  - `prepareDerivedCityLayer`'s input gains `recordWrite?: (statements, ms, rows) => void`, called
    with `written.statements` BEFORE the cancelled/failed translation throws.

The vector merge's own `Writing results` entry (`runQueue.ts:1706`) is deliberately untouched: a
document merge issues no SQL, which is the same case as the empty-list branch.

### 2. The column-reveal channel (`5c21b30`)

- **New** `src/ui/table/revealColumns.ts`: `ColumnReveal`, `requestColumnReveal`,
  `subscribeColumnReveal`, `drainColumnReveals`, `clearColumnReveals`. A listener returns a boolean;
  a request is RETAINED per layer until one acknowledges it. `requestColumnReveal` writes the
  pending entry **before** offering it and deletes it **on acknowledgement**, which is what makes an
  immediately-honoured B supersede a pending A (**residual C11**).
- `src/ui/table/DataGrid.tsx`: `headerRefs` map, one `reveal` callback (`useCallback` on `layerId`,
  first matching header wins, `scrollIntoView({ inline: "nearest", block: "nearest" })`), a
  subscribe effect and a drain effect on `[reveal, columns, rows]` — `rows` because an empty grid
  renders no `<th>` at all. A `ref` on the header `<th>` registers/unregisters each cell. All hooks
  sit above the `rows.length === 0` early return.
- `src/ui/processing/RunFooter.tsx`: Open table calls `requestColumnReveal(cardLayerId, run.columns)`
  unconditionally, after the `appendColumns`/`setColumns` pair.

### 3. **[adapted copy A8]** on the synthetic roof column (`4de01be`)

`src/ui/drawer/columnPolicy.ts`'s `derivedColumnTitle("__roofy_roof_area")` is now
`"Roof area (m²) — "` + A8 **verbatim**. The other two synthetic titles are unchanged.

### 4. The version-aware consumer sweep (`93e7a0e`)

`src/features/layers/layerTableLifecycle.ts`:

- **TWO** maps beside `knownVersions`, not one (**residual C5**): `pendingVersions` (written at
  enqueue, dropped when the build settles) and `builtVersions` (written only when the outcome is
  `ok`). `versionOf(layerId)`, `tableIsCurrent(layerId)` (pending OR built equals the current
  version) and `enqueueAt(layerId)` are the new helpers; `enqueueAt` reads the outcome through
  `.then(onFulfilled, onRejected)` and its `settle` only clears the pending entry if it is still
  ITS version.
- All three `void enqueueLayerTable(…, residentTableSource(…))` call sites inside the installer
  became `enqueueAt(…)` (the new-layer branch, `scheduleRebuild`'s timer body, the sweep).
- `sweepStreamingLayers` skips a layer whose table `tableIsCurrent` — before `cancelRebuild` /
  `clearMapFilter`, which is right: a same-version layer has no armed timer and no table being
  replaced.
- The removal loop deletes from both new maps beside `knownVersions.delete(id)`.
- `refreshStreamingTable` deliberately does NOT go through `enqueueAt`, with that reason as a
  comment on its doc block.

**Naming deviation, deliberate:** the brief's Interfaces line names one `enqueuedVersions` map.
Requirement 1 forbids exactly what a single map called "enqueued" would do, so the pair is
`builtVersions` + `pendingVersions`. Both are closure-local (inside `installLayerTableLifecycle`),
so no exported name changed and nothing outside the module can see the difference.

### 5. Requirement 6 — `styleGeoLayerByAttribute`'s undone-run guard (`3ea5a53`)

`src/ui/processing/RunFooter.tsx`: the attribute path's guard now reads
`current === null || current.stale || current.status !== "done" || current.note === "Undone"` —
the same four tests, in the same shape, as the median path Task 26 fixed.

## Tested + results

| Gate                                                         | Result                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npx tsc -b --noEmit`                                        | clean (exit 0), re-run after every commit                                                         |
| `npx vp check`                                               | **0 errors / 56 warnings in 592 files** — baseline held at every step                             |
| Full app suite (backgrounded, `& wait $!; echo "suite: $?"`) | `suite: 0` — `Test Files 282 passed \| 4 skipped (286)`, `Tests 3763 passed \| 97 skipped (3860)` |

New/changed suites: `tests/unit/insights/computedColumns.test.ts` (+5 cases, 5 existing outcome
assertions tightened), `tests/unit/features/processing/runQueue.test.ts` (+1 block),
`tests/unit/features/processing/derivedRun.test.ts` (+2), `measureSolidsRun.test.ts` /
`validateSolidsRun.test.ts` (label lists adapted), **new**
`tests/unit/ui/table/revealColumns.test.tsx` (15 cases: 10 channel + 5 DataGrid),
`tests/unit/ui/processing/ToolView.test.tsx` (+1 + `clearColumnReveals()` in the suite's
`afterEach`), `tests/unit/ui/drawer/columnPolicy.test.ts` (+2),
`tests/unit/ui/table/DataGrid.test.tsx` (title updated),
`tests/unit/ui/processing/styleByResult.test.tsx` (+2),
`tests/unit/features/layers/layerTableLifecycle.test.ts` (+6, 3 existing cases de-vacuumed).

### TDD evidence

**RED 1 — `WriteOutcome.statements`**

```
$ npx vitest run tests/unit/insights/computedColumns.test.ts
 FAIL … > records a COMMIT that FAILED, and the rollback after it
   TypeError: Cannot read properties of undefined (reading 'slice')
 FAIL … > reports an empty list when the rows never reached the engine
   AssertionError: expected undefined to deeply equal []
 Tests  10 failed | 13 passed (23)
```

**GREEN 1** — `Tests 23 passed (23)`.

**RED 2 — the write step's log entries, both destinations**

```
$ npx vitest run tests/unit/features/processing/{runQueue,derivedRun,measureSolidsRun,validateSolidsRun}.test.ts
 × registers the source, drops it when the parse is done, and publishes      (measureSolidsRun)
 × registers the source, drops it when the parse is done, and publishes      (validateSolidsRun)
 × logs the COPY's write statement by statement (§6.4)                       (derivedRun)
 × logs the statements a FAILED write got through, rollback included         (derivedRun)
 × runs one at a time, records phases and publishes a done card              (runQueue)
 Tests  5 failed | 114 passed (119)
```

**GREEN 2** — `tests/unit/features/processing` + `tests/unit/insights`: `50 files | 990 passed`.

**RED 3 — the reveal channel** (module does not exist)

```
$ npx vitest run tests/unit/ui/table/revealColumns.test.tsx
 Failed to resolve import "../../../../src/ui/table/revealColumns"
 Test Files  1 failed (1)   Tests  no tests
```

**GREEN 3** — `Tests 15 passed (15)`.

**RED 3b — the card's request.** The channel and the grid were red by non-existence; the
`RunFooter` call needed its own red, so the one line was removed with `perl -0pi` and the case run:

```
$ npx vitest run tests/unit/ui/processing/ToolView.test.tsx -t "scroll the run"
 × asks the grid to scroll the run's columns into view (§6.2)
   AssertionError: expected [] to deeply equal [ { …(2) } ]
```

The line was restored from a scratchpad copy and the file re-checked (`grep` for
`requestColumnReveal` → the import and the call). The case then failed once more in the FULL file
and passed alone — a leftover retained request from the two earlier Open-table cases was drained
into the new listener. That is the channel working as specified, and the fix is the suite's
`afterEach` calling `clearColumnReveals()`; **GREEN 3b** `41 passed`.

**RED 4 — A8**

```
$ npx vitest run tests/unit/ui/drawer/columnPolicy.test.ts tests/unit/ui/table/DataGrid.test.tsx
 × explains how the synthetic roof area differs from the computed one
 × uses readable unit titles only for generated derived columns
 Tests  2 failed | 30 passed (32)
```

**GREEN 4** — `tests/unit/ui`: `96 files | 1010 passed`.

**RED 5 — the version-aware sweep**

```
$ npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts
 × does not rebuild a streaming layer whose version has not moved
 × skips it again once that build has SETTLED
 × rebuilds after a FAILED build, with no new stream commit
 Tests  3 failed | 30 passed (33)
```

The other three new cases ("DOES rebuild when the version moved", "forgets a removed layer's
version", "refreshStreamingTable does not let the next sweep skip a rebuild") passed against the
unconditional sweep by construction — they are the regression pins for what must NOT change.
**GREEN 5** — `Tests 33 passed (33)`, and `tests/unit/features tests/unit/insights tests/unit/ui`
→ `211 files | 2801 passed`.

**RED 6 — the vector Style-by-result guard**

```
$ npx vitest run tests/unit/ui/processing/styleByResult.test.tsx
 × colours NOTHING on a vector layer whose run was undone
   AssertionError: expected { attribute: 'bld_buildings_n', …(1) } to be undefined
 Tests  1 failed | 19 passed (20)
```

(The stale twin was already green — the existing guard covers it — and is kept as a pin, exactly
as Task 26 found for the median path.) **GREEN 6** — `tests/unit/ui/processing`: `247 passed`.

## Files changed

Source: `src/insights/computedColumns.ts`, `src/features/processing/runQueue.ts`,
`src/features/processing/deriveLayer.ts`, `src/features/layers/layerTableLifecycle.ts`,
`src/ui/table/revealColumns.ts` (new), `src/ui/table/DataGrid.tsx`,
`src/ui/processing/RunFooter.tsx`, `src/ui/drawer/columnPolicy.ts`.

Tests: `tests/unit/insights/computedColumns.test.ts`,
`tests/unit/features/processing/{runQueue,derivedRun,measureSolidsRun,validateSolidsRun}.test.ts`,
`tests/unit/features/layers/layerTableLifecycle.test.ts`,
`tests/unit/ui/table/{revealColumns.test.tsx (new),DataGrid.test.tsx}`,
`tests/unit/ui/drawer/columnPolicy.test.ts`,
`tests/unit/ui/processing/{ToolView,styleByResult}.test.tsx`.

## How each controller requirement was met

1. **Residual C5 — successful vs pending versions.** `builtVersions` is written ONLY in
   `enqueueAt`'s settle when `outcome.ok`; `pendingVersions` is written at enqueue and dropped when
   the build settles either way (and on rejection). `tableIsCurrent` is the sweep's test, so a
   build in flight also gates a duplicate enqueue — required, not merely test-convenient: the table
   panel and the toolbox can both open inside one FIFO slot. Tests: "does not rebuild a streaming
   layer whose version has not moved" (pending gate, nothing settled), "skips it again once that
   build has SETTLED" (the pending→built handover), "rebuilds after a FAILED build, with no new
   stream commit" (failed → reopen → retry → and only THEN does a third consumer skip it), plus
   "DOES rebuild when the version moved while nothing was looking" and "forgets a removed layer's
   version, so a re-add rebuilds". The lifecycle mock now returns a real `LayerTableOutcome` with a
   `buildOutcome` control, and the settle is awaited with `await vi.advanceTimersByTimeAsync(0)`
   under fake timers.
2. **Residual C10 — the COMMIT and the ROLLBACK.** `issued.push("COMMIT")` sits immediately before
   `step("COMMIT")`; `rollback()` records `"ROLLBACK"` only when `cleanup` reports it was sent.
   Failure-path assertions on BOTH writes: `computedColumns.test.ts` has the failed-UPDATE case, a
   dedicated failed-COMMIT case (`statements.slice(-2) === ["COMMIT","ROLLBACK"]`), and the
   engine-died case asserting `statements` does NOT contain the skipped ROLLBACK;
   `derivedRun.test.ts` has "logs the statements a FAILED write got through, rollback included"
   with `failing = "COMMIT"`, so the derived path pins the same residual.
3. **Residual C9 — ONE recorder.** `logWriteStatements` is a module function in `runQueue.ts`; the
   This-layer write calls it directly and the New-layer branch hands the same closure to
   `prepareDerivedCityLayer` as `recordWrite`. `derivedRun.test.ts` asserts a New-layer run's log
   carries `BEGIN TRANSACTION`, an `ADD COLUMN IF NOT EXISTS` and `COMMIT`, after its
   `Creating the new layer's table` entry.
4. **Residuals C8 + C11 — retention and supersession.** Listener returns a boolean; `pending` is a
   `Map` keyed by layer, written before the offer and deleted on acknowledgement. The A→B case is
   pinned twice: "forgets a SUPERSEDED request even when the new one is taken at once" (live grid
   honours B, a later drain offers nothing) and "replaces a pending request that nothing has taken
   yet". `DataGrid` drains on `[reveal, columns, rows]`, pinned by "waits for the columns to arrive
   before it scrolls" (empty grid → no `<th>` → request kept) and "leaves ANOTHER layer's request
   outstanding for the grid that switches to it" (grid switching). Plus "ignores a column this grid
   is not showing" (the request survives for someone else) and "scrolls to the FIRST requested
   column".
5. **Residual C7 — every test runnable as committed.** `revealColumns.test.tsx` is at the brief's
   path with complete fixtures; `DataGrid` is imported and rendered there, `Element.prototype.
scrollIntoView` is installed in a `beforeEach` (jsdom has none) and typed through a local
   `ScrollIntoView` alias so `tsc -b` is clean; `clearColumnReveals()` runs in every relevant
   `afterEach`. `DataGrid.tsx` imports `useRef` as well as `useCallback` and `useEffect`.
   `computedColumns.test.ts`'s new describe has its OWN `beforeEach` installing plain-ok
   `runQuery`/`ddl`/`registerBuffer` rather than inheriting the previous describe's last
   `mockImplementation` (`beforeEach` added to the `vitest` import). Every suite named here was
   EXECUTED, not only written.
6. **Task 26's flagged gap.** Done as commit `3ea5a53`, with the note check in the same shape the
   median path uses (`note === "Undone"` ADDED to `stale` / `status !== "done"`, not replacing
   them), and two cases — undone (red first) and stale (pin).
7. **Copy and process.** A8 is verbatim (asserted whole in `DataGrid.test.tsx`); the log label shape
   is `Writing results (n/N)`; the other log entry labels are the descriptive ones already shipped.
   No `vi.mock(".../insights/duckdb")` factory needed a new export — no module under test imports
   anything new from it — and the two factories I touched at all (none) are unchanged; the
   `layerTables` factory in the lifecycle suite gained a return VALUE, not an export. The full suite
   ran in the background with `& wait $!; echo "suite: $?"` → `suite: 0`.

## Deviations from the brief (each named; requirements win)

1. **`enqueuedVersions` → `builtVersions` + `pendingVersions`** (requirement 1 makes a single
   enqueue-time map wrong). Closure-local, so no interface changed.
2. **`cleanup` returns a boolean** and a `rollback()` helper records the statement. The brief pushes
   `"ROLLBACK"` unconditionally, which would have claimed a rollback on the engine-death path where
   `cleanup` sends nothing — and `computedColumns.test.ts` already pinned that no ROLLBACK is sent
   there.
3. **`issued.push("COMMIT")` before the call**, not only on success (requirement 2 / residual C10).
4. **`requestColumnReveal` writes `pending` before the offer** (residual C11); the brief writes it
   only after every listener declined.
5. **Five commits, not one** (allowed: "one leftover per commit is fine"), with requirement 6 as its
   own.
6. **`recordWrite?` is NEW here.** The dispatch calls it "Task 21's hook"; Task 21's report does not
   mention it and `deriveLayer.ts` had no such input at `ca4cb79`. This task adds it.
7. **The brief's failure test asserts `read_json_auto`** in its comment; the shipped code uses
   `read_json` with declared columns (finding D9). The assertion itself (`__vals_run_1.json`) is
   unaffected; the comment was corrected.
8. **Three existing lifecycle cases had to change**, and two of them were passing vacuously: the
   panel-OPENS and TOOLBOX-OPENS sweeps now bump the stream version while the consumer is shut —
   which is what their own names claim — and "stops sweeping on uninstall" got a version bump so it
   still fails if the sweep runs.
9. **`measureSolidsRun` / `validateSolidsRun`'s exact label lists** became "the first three, then
   every remaining entry starts with `Writing results (`" — the write's statement count is a
   property of the columns, not of the log's contract.
10. **`ToolView.test.tsx`'s `afterEach` gained `clearColumnReveals()`.** Not in the brief; without
    it the new case reads the previous cases' retained requests. That leak is the channel's
    documented behaviour, not a bug.

## Self-review / concerns

- **Engine death mid-write reports nothing.** `raced(writing, null)` rejects before `written`
  exists, so neither destination's `recordWrite`/`logWriteStatements` runs for an
  `EngineDeadError`. Accepted: there is no outcome to read, and the card already says
  "Analytics engine stopped". A reviewer who wants those statements would have to move the record
  inside `writeComputedColumns`' own state, which is a bigger change than §6.4 asks for.
- **`logWriteStatements` mutates the caller's `log` array** and the caller patches. Both call sites
  do patch (the This-layer write, and the `recordWrite` closure). A third caller that forgot the
  patch would lose the entries until the next patch; the function is module-private and its doc says
  so.
- **The reveal channel is module state with no cross-page reset.** `clearColumnReveals` exists for
  tests only; in the app a request for a layer the user then REMOVES stays pending until some grid
  declines it forever (harmless — a listener only ever acknowledges its own layer). A
  layer-removal hook would be the tidy answer and is not in this task's scope.
- **`scrollIntoView` is called unguarded.** jsdom has no implementation, so every suite that
  renders `DataGrid` with a pending reveal must stub it; only the new suite does, because only it
  creates a pending reveal. If a future suite renders a grid while a request is outstanding it will
  throw — which is the right way to find out.
- **`rows` in the drain effect's deps** re-drains on every page change of a grid whose reveal is
  already consumed; `drainColumnReveals` over an empty map is a no-op, so the cost is one
  `Array.from([])`.
- **`builtVersions` can be written by a build that a newer enqueue has already superseded** (an
  older `.then` resolving last). `enqueueLayerTable` is FIFO, so it does not happen in practice, and
  the failure mode if it ever did is one extra rebuild, never a skipped one.
- **No browser check.** The three user-visible surfaces are a `title` string, extra rows in the
  existing run-log list (same `LogEntry` shape, same renderer) and a `scrollIntoView` on a header —
  no CSS, no markup, no new control, so there is nothing to verify against a peer in
  `flatControls.css`. The scroll itself cannot be exercised in jsdom (it has no layout); its
  arguments and its target element are asserted instead.
- **`Writing results` with no number still exists** in two places: the vector merge (no SQL at all)
  and a write whose buffer registration failed. Both are honest — there is no statement to name —
  but a reader comparing two cards will see two different shapes.

## Addendum — the vacuous test, found in self-review (`6df91b1`)

`"forgets a removed layer's version, so a re-add rebuilds"` as first written proved nothing: the
re-add's `enqueued === ["L1"]` comes from the add branch, which has **no** version gate and fires
whether or not the maps were cleared, and the trailing `setOpen(true)` carried no assertion. That is
why it was green during RED 5.

Rewritten so the only observable that discriminates is exercised: L1 is BUILT at version 3 and
settled, removed, then re-added while the stream still sits at 3 and with `buildOutcome` set to a
FAILURE. The add's own build clears the pending entry; a `builtVersions` number left over from the
removed layer would then make the following sweep skip forever. The assertion is
`expect(enqueued).toEqual(["L1", "L1"])` — the add plus the sweep's retry.

Proved to bite by mutation: with `builtVersions.delete(id)` and `pendingVersions.delete(id)`
commented out,

```
$ npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts
 × forgets a removed layer's version, so a re-add rebuilds
   AssertionError: expected [ 'L1' ] to deeply equal [ 'L1', 'L1' ]
 Tests  1 failed | 32 passed (33)
```

Both lines restored (`git diff` of `layerTableLifecycle.ts` against `93e7a0e` is empty) and the file
is green again: `Tests 33 passed (33)`.

Also folded into this commit: `tests/unit/ui/processing/derivedCard.test.tsx`'s `afterEach` now
calls `clearColumnReveals()`. It clicks Open table twice and so leaves retained requests behind —
harmless today (nothing there renders a grid, and the channel's module state is per test FILE), but
it is the same leak that bit `ToolView.test.tsx`, so it is closed rather than left as a trap.

Gates re-run after this commit: `npx tsc -b --noEmit` clean, `npx vp check`
**0 errors / 56 warnings in 592 files**, and the full suite once more in the background —
`suite: 0`, `Test Files 282 passed | 4 skipped (286)`, `Tests 3763 passed | 97 skipped (3860)`.

One report wording correction from the same review: requirement 7 should read "no
`vi.mock(".../insights/duckdb")` factory was touched at all — no module under test imports anything
new from it; the ONE `layerTables` factory that changed (the lifecycle suite's) gained a return
VALUE, not an export."

## Fix round 1 (pair 27+28 review)

Two commits on top of `910a06c`, no trailers, nothing pushed, `scripts/smoke/processing-m3.md`
untouched:

- `e33317e` `fix: an engine death under the write keeps the statements it issued`
- `6f60fc1` `test: the superseded reveal is proved by a DECLINED A and an acknowledged B`

### Important 1 — an engine death under the write lost the whole SQL record

The review is right and the original report's "accepted" note is withdrawn: `raced(writing, null)`
rejects with the write's own promise still PENDING (duckdb-wasm strands the statement its worker
died under, so `writeComputedColumns` never settles at all), and a record read off the outcome
therefore never arrives — although BEGIN, the ALTERs and the UPDATE had all been sent.

Fixed by reporting each statement AS it is issued, with the caller holding the mirror:

- `src/insights/computedColumns.ts`: `WriteInput.onStatement?: (sql: string) => void`, and ONE
  private `record(sql)` that pushes into `issued` **and** calls the callback. Every entry point to
  the record goes through it — the loop, the `COMMIT` (still recorded immediately before it is
  sent) and `rollback()` (still only when `cleanup` really sent it) — so `WriteOutcome.statements`
  and the live report are fed from a single place and cannot disagree.
- `src/features/processing/runQueue.ts`: the This-layer write passes
  `onStatement: (sql) => issuedByWrite.push(sql)` and wraps the race in
  `.catch((error: unknown) => { logWriteStatements(log, issuedByWrite, …); patch(id, { log }); throw error; })`.
  The `log`-only patch is accepted even for a run the death watcher has ALREADY failed — `patch`
  refuses a second _status_, not a record — which is why the entries are written here rather than in
  `execute`'s outer catch (that one returns early on `failedAlready`).
- `src/features/processing/deriveLayer.ts`: the same mirror and the same `.catch`, reporting through
  `input.recordWrite?.(issuedByWrite, …)` before rethrowing — so the New-layer destination keeps the
  identical promise.

The resolved paths are unchanged: they still log `written.statements`, which is the same list.

**RED** (both destinations, before the change):

```
$ npx vitest run tests/unit/features/processing/runQueue.test.ts tests/unit/features/processing/derivedRun.test.ts
 × keeps the COPY's issued statements when the engine dies under the write
   AssertionError: expected undefined to be 'BEGIN TRANSACTION'
 × keeps the statements it issued when the ENGINE dies under the write
   AssertionError: expected [] to deeply equal [ 'BEGIN TRANSACTION', …(2) ]
 Tests  2 failed | 112 passed (114)
```

Both cases hold the UPDATE open on a promise that is NEVER resolved (`gate = { needle: "UPDATE",
promise: never.promise }`), then `killEngine()` — which is exactly how the strand behaves — and
assert the run failed with "Analytics engine stopped" AND that its log carries
`BEGIN TRANSACTION`, the `ALTER … ADD COLUMN IF NOT EXISTS` and the `UPDATE`, with **no** COMMIT and
**no** ROLLBACK (neither was ever sent: the commit was never reached, and the rollback is skipped
for a database that is gone). **GREEN:** `tests/unit/features/processing` + `tests/unit/insights`
→ `50 files | 992 passed`.

### Important 2 — the pending-A → acknowledged-B test was vacuous

Rewritten to the only shape that detects the bug: ONE listener that DECLINES A (so A stays pending),
then `mockReturnValue(true)` and B delivered — acknowledged immediately, which is the early-return
path — then `drainColumnReveals` must offer NOTHING.

Proved by mutation: `requestColumnReveal` reverted to the brief's shape (`pending.set` after the
decline loop, no delete on acknowledgement):

```
$ npx vitest run tests/unit/ui/table/revealColumns.test.tsx
 × forgets a SUPERSEDED request even when the new one is taken at once
   AssertionError: expected "vi.fn()" to be called 2 times, but got 3 times
 Tests  1 failed | 14 passed (15)
```

The third call is A coming back — the regression itself. Implementation restored with
`git checkout` (`git diff` of `revealColumns.ts` is empty); `Tests 15 passed (15)`.

The suite also gained a listener registry (`listen()` + an `afterEach` that drops every
subscription): the first mutation run cascaded into six unrelated failures because a case that
FAILS never reaches its own `stop()`, and the leftover acknowledging listener then took every later
request. With the registry the mutation fails exactly one case, which is what makes the evidence
above readable. "replaces a pending request that nothing has taken yet" is kept — it does not detect
C11 (the review is right) and is not claimed to; it pins the plain overwrite.

### Not done, as instructed

No production `scrollIntoView?.()` guard, and the two un-numbered `Writing results` entries (the
vector publication and a failed buffer registration, neither of which issues SQL) are left as they
are.

Task 28's cross-task note needs no further action from me: its "statement by statement" claim is now
unconditionally true, including on the death path.

### Gates

```
$ npx tsc -b --noEmit                                → 0
$ npx vp check   → Found 0 errors and 56 warnings in 592 files      (baseline held)
$ npx vitest run > …/m3-task27-fix1.log 2>&1 & wait $!; echo "suite: $?"
     suite: 0 — Test Files 282 passed | 4 skipped (286), Tests 3769 passed | 97 skipped (3866)
```
