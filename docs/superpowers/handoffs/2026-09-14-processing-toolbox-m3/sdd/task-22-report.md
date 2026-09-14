# Task 22 — The destination branch, publication and Undo — report

**Status:** DONE. Four commits on `develop`, base `8a4baf7`, nothing pushed, no trailers of any
kind, hooks never bypassed, `core.hooksPath` untouched. Nothing staged from `.github/hooks/`,
`docs/design-history/` or `.superpowers/`; the plan is untouched.

- `9e7cda2` `feat: a run can write its results to a new derived layer`
- `04bd65c` `feat: a New-layer result card points at the copy and can zoom to it`
- `0a23089` `feat: the run log names the parent a derived target was cut from`
- `a16b25d` `fix: the New-layer card's actions abandon a copy that Undo has removed`

## Implemented

### `src/features/processing/types.ts`

`RunRecord` gains THREE required fields (the brief's Interfaces block lists two; controller
requirement C2 adds `newLayerName` and wins):

- `destination: ToolDestination` — §6's OUTPUT, frozen at Run.
- `newLayerName: string | null` — §6's Name field as frozen, so "Edit & run" can restore it.
- `newLayerId: string | null` — the layer the run CREATED, once published.

### `src/features/processing/toolRegistry.ts`

`destinations: ["layer", "new"]` on the six implemented CITY tools — `roof-metrics`,
`measure-solids`, `validate-solids`, `height-from-extent`, `join-by-location`,
`distance-to-nearest`. `aggregate-per-area` keeps `["layer"]` (Task 23 flips it).

### `src/features/processing/runQueue.ts`

- **The destination dispatch, at C1's position.** Inserted immediately after
  `const raw = await executor(...)` and `if (signal.aborted) throw new CancelledError();` —
  BEFORE Task 18's vector publication block and before the city write. A `"new"` run whose
  target is not a city layer is refused there with `"Not available yet"` rather than falling
  through (Task 23 replaces that arm); it is unreachable today because the head guard already
  refuses a `"new"` destination a tool does not offer.
- The branch canonicalises against the PARENT table's columns, treats an empty result as a
  done-with-nothing run (no publication), enters `phase: "write"`, calls
  `prepareDerivedCityLayer`, re-checks the abort, `publish()`, reads the published name back
  from BOTH stores, `publishProvenance` with `total: scope.count`, re-reads
  `useComputedColumnStore.getState()` for the `runIds` set, records the `"layer"` Undo,
  `summariseCreated`, the A15 note (+ §6.1's cancel note), the `done` patch with `newLayerId`,
  the read-back guard and the toast.
- `summariseCreated(result, elapsedMs, layerName, features, options)` — delegates to `summarise`
  and replaces the head segment; `features === null` keeps the tool's own head (Task 23).
- `RunUndo` is the NESTED union `{kind:"columns", state: UndoState} | {kind:"layer", …}`; both
  existing `undoState.set` literals are wrapped in `state`, `discardUndo` returns early for
  `"layer"` and reads `state.state` otherwise, and `undoRun`'s This-layer body binds
  `const undo = state.state` once.
- `newLayerUndoBlock(run)` — exported; `USED_BY_LATER_RUN` is §6.2's sentence. Null for a
  This-layer run, for a missing Undo state, and when the block does not apply.
- `undoRun` gains the `"layer"` branch FIRST: it re-checks the block, then
  `removeLayer` + `clearLayer` OUTSIDE `runOnTableQueue` (removal enqueues a table drop, and
  enqueueing from inside a slot deadlocks — design decision (g)), then `note: "Undone"`.
- `stealUndo` skips a run with `other.newLayerId !== null` — a New-layer run's `targetLayerId`
  is the parent it never wrote to.
- `installStaleWatcher` skips a run with `run.newLayerId !== null` — §6's "a derived layer is
  independent of its parent from publication on".
- One behaviour-preserving extraction: `doneWithNothing(result, streaming)`, the three identical
  copies of the empty-result publication (vector, city, New-layer) collapsed into one closure
  inside `execute`.

### `src/ui/processing/RecentRuns.tsx`

"Edit & run" restores `destination: run.destination` and `newLayerName: run.newLayerName`.
("Run again" needed nothing: it only dismisses the card, and the DRAFT already holds both.)

### `src/ui/shell/shellStore.ts` + `src/app/App.tsx`

`ShellState.requestedZoom: string | null` and `requestZoom(layerId: string | null)`, mirroring
`requestedSection`. `App` consumes it in one effect beside `handleFitActiveLayer`, resolving the
id with `resolveActiveLayer(requestedZoom, layers, geoLayers)` (there is no `unifiedLayerItems`
in `App` — see Deviations) and clearing the request whether or not the layer was found.

### `src/ui/processing/RunFooter.tsx`

`cardLayerId = run.newLayerId ?? run.targetLayerId`, `created = run.newLayerId !== null`,
`undoBlock = newLayerUndoBlock(run)`. A `Zoom to layer` button FIRST in the action row for a
created run (activate + `requestZoom`); `Open table` and its two query-store calls read
`cardLayerId`; `useStyleByResult`'s `start` reads `run.newLayerId ?? run.targetLayerId` — ONLY
the layer-id expression changed, the Task 9 signature
`start(run, column: OutputColumn, descriptor: StyleByResult)` is untouched (C3); the
"Wrote N columns to <target>." line is suppressed for a created run; Undo is disabled with
`undoBlock` as its title. `Zoom to layer` and `Open table` both check `cardLayerAlive()` first
(the fourth commit): §6.2's Undo removes the copy and leaves the card standing with
`newLayerId` still on the frozen record, and `setActiveLayerId` does not validate — the
invariant that hands the active layer over watches the LAYER stores, not that write — so the
click would have left the workspace pointing at a row that is gone. Abandoned silently, the
same answer `useStyleByResult` already gives for its own awaited gap.

### `src/ui/processing/runFormat.ts` + `src/ui/processing/LogView.tsx`

`targetLayerLine(run, derivedFrom)` — **[adapted copy A7]**, `"<target> · Derived from <parent>"`
— pure, taking the `DerivedFrom` rather than looking it up. `formatRunLog(run, derivedFrom)`
takes the same second argument. `LogView` does the ONE lookup
(`layers.find(l => l.id === run.targetLayerId)?.derivedFrom ?? null`) and hands it to the row
and to Copy.

## Tested + results

New suites:

- `tests/unit/features/processing/derivedRun.test.ts` — **19 cases**, through the real queue and
  the real `deriveLayer` (only `duckdb` and `layerTables` are mocked, the latter keeping ONE
  FIFO chain).
- `tests/unit/ui/processing/derivedCard.test.tsx` — **10 cases**, `RunFooter` rendered on its own,
  with the REAL `newLayerUndoBlock` through `importActual`.
- `tests/unit/app/appZoomRequest.test.tsx` — **2 cases**, the full `App` with a mocked
  `NavaraViewport` whose handle records `fitLayer`.

Extended: `runQueue.test.ts` (the two destination guards rewritten, `withNewLayer` deleted with
its `TOOLS` import — it staged a destination the registry now ships), `LogView.test.tsx` (+3),
`RecentRuns.test.tsx` (+1), `shellStore.test.ts` (+1 case, +1 field in the defaults assertion),
`outputDestination.test.tsx` (7 staging wrappers unwrapped, the gate case moved to
`aggregate-per-area`, +1 assertion that the radio is now live), `ToolView.test.tsx` (the OUTPUT
case's `toBeDisabled` → `toBeEnabled`), and the mechanical `destination`/`newLayerName`/
`newLayerId` sweep across 10 `RunRecord` fixtures.

Requirement 5's list, and where each case lives (all in `derivedRun.test.ts` unless noted):

| Required                                        | Case                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success: target untouched, copy has the columns | `leaves the TARGET's table untouched and creates the copy`, `gives the copy's new columns the run's own provenance`                                                                                                                                                   |
| inherited provenance, inserted under the parent | `inserts the copy under its parent, with its provenance inherited`                                                                                                                                                                                                    |
| activated                                       | `activates the copy (§6.2)`                                                                                                                                                                                                                                           |
| rename at publication (" (2)" + A15)            | `re-checks the name at publication and says so (§10 scenario 12)`                                                                                                                                                                                                     |
| cancel-before-publish                           | `a cancel BEFORE publication leaves nothing behind`                                                                                                                                                                                                                   |
| death-before-publish                            | `the engine's DEATH before publication publishes nothing`                                                                                                                                                                                                             |
| failure-before-publish                          | `a FAILURE during the copy fails the run and drops the half-built table`                                                                                                                                                                                              |
| Undo removes the layer                          | `Undo REMOVES the layer and takes its columns with it (§6.2)` — which also INSTALLS `installWorkspaceInvariants` and asserts the active layer is handed back to the parent, proving Undo uses the same `layerStore.removeLayer` door the layer list's own Remove uses |
| Undo blocked by a later run                     | `blocks Undo once a later run has used the derived layer`                                                                                                                                                                                                             |
| Undo blocked by the copy's own columns          | `blocks Undo once the copy has computed columns of its OWN`                                                                                                                                                                                                           |
| Edit & run restoring destination/name           | `restores the destination and the name onto the RECORD` + `RecentRuns.test.tsx` → `reopens a New-layer run on New layer, under the name it published`                                                                                                                 |
| Zoom to layer requesting the fit                | `derivedCard.test.tsx` → `asks the shell to zoom to the COPY`; `appZoomRequest.test.tsx` → `flies to the layer the shell asked for, and clears the request`                                                                                                           |

### Gates

```
$ npx tsc -b --noEmit                                   → 0
$ npx vp check                → Found 0 errors and 56 warnings in 582 files   (baseline held)
$ npx vitest run > …/m3-task22.log 2>&1 & wait $!; echo "suite: $?"
  suite: 0
  Test Files  276 passed | 4 skipped (280)
  Tests  3616 passed | 96 skipped (3712)      (was 3580 passed at Task 21)
```

(Run once before the third commit at 3615 and once more, after the fourth, at 3616; all four
gates were re-run after the fix.)

`vp check` momentarily read **57**: `query: ctx.query` in the new branch tripped
`typescript(unbound-method)` (`ToolContext.query` is declared as a method). Fixed by passing the
`query` closure `execute` already holds — the same function — not accepted.

## TDD evidence

**RED 1 — the destination branch** (before any production change):

```
$ npx vitest run tests/unit/features/processing/derivedRun.test.ts
 Test Files  1 failed (1)      Tests  17 failed | 2 passed (19)
```

Every `destination: "new"` case failed with `expected 'failed' to be 'done'` — the head's
`"Not available yet"` guard, because no tool shipped `"new"` yet; `newLayerUndoBlock` was
`undefined` at import. The two that passed are the ones that assert the OLD behaviour
(`aggregate-per-area` refused at the head, and a This-layer run going stale).

**GREEN 1** — after types + record + the branch + `summariseCreated` + the Undo union +
`newLayerUndoBlock` + the registry flip: `Tests 1 failed | 18 passed`, the one failure being

```
 FAIL … > is never marked stale by a rebuild of its PARENT
 AssertionError: expected true to be false
```

which is exactly the `installStaleWatcher` guard the brief's step 5.7 asks for. With it:
`Tests 19 passed (19)`, and `tests/unit/features/processing` → `32 files | 615 passed`.

**RED 2 — "Edit & run" restores the destination.** The production line was written first here,
so it was FALSIFIED: `destination: run.destination` reverted to the literal, the new case
watched to fail, then restored.

```
 × reopens a New-layer run on New layer, under the name it published
 AssertionError: expected { targetLayerId: 'L1', …(7) } to match object { destination: 'new', …(1) }
 -   "destination": "new",   +   "destination": "layer",
```

**RED 3 — the New-layer card:**

```
$ npx vitest run tests/unit/ui/processing/derivedCard.test.tsx
 Tests  9 failed (9)
 TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Zoom to layer"
 TypeError: useShellStore.getState(...).requestZoom is not a function
 AssertionError: expected 'L' to be 'NEW'
```

**GREEN 3** — after `shellStore`, `App` and `RunFooter`: `Tests 9 passed (9)`.

**RED 4 — `App`'s consuming effect, by FALSIFICATION.** `appZoomRequest.test.tsx` was written
after the effect, so the effect was deleted and the cases watched to fail:

```
 × flies to the layer the shell asked for, and clears the request
   AssertionError: expected "vi.fn()" to be called with arguments: [ 'city-1' ]
 × clears a request for a layer that is no longer there
   AssertionError: expected 'gone' to be null
 Tests  2 failed (2)
```

The effect was restored immediately; `git diff` of `App.tsx` carries only the one hunk.

**RED 5 — A7's log row:**

```
$ npx vitest run tests/unit/ui/processing/LogView.test.tsx
 × names the parent a DERIVED target was cut from — [adapted copy A7]
   Unable to find an element with the text: Delft · solids · Derived from Delft
 × carries [adapted copy A7]'s parent into the Copy text too
   AssertionError: expected 'Tool: Height from extent\nTarget laye…' to contain 'Target layer: Delft · Derived from De…'
 Tests  2 failed | 12 passed (14)
```

**GREEN 5** — after `targetLayerLine` + `formatRunLog`'s second argument + `LogView`'s one
lookup: `Tests 14 passed (14)`.

**RED 6 — the card's actions after Undo** (found in self-review, on the advisor's prompt):

```
$ npx vitest run tests/unit/ui/processing/derivedCard.test.tsx
 × does nothing once Undo has REMOVED the copy the actions point at
   AssertionError: expected 'NEW' to be null
 Tests  1 failed | 9 passed (10)
```

**GREEN 6** — after `cardLayerAlive()`: `Tests 10 passed (10)`. Two test-authoring fixes went
with it and are about the fixture, not the behaviour: `asks the shell to zoom to the COPY` now
calls `addLayers()` (it was asserting a click on a layer that was never in the store), and the
suite's `afterEach` closes the drawer a previous case opened.

## Files changed

```
src/app/App.tsx
src/features/processing/runQueue.ts
src/features/processing/toolRegistry.ts
src/features/processing/types.ts
src/ui/processing/LogView.tsx
src/ui/processing/RecentRuns.tsx
src/ui/processing/RunFooter.tsx
src/ui/processing/runFormat.ts
src/ui/shell/shellStore.ts
tests/unit/app/appZoomRequest.test.tsx                      (new)
tests/unit/features/workspace — untouched (the invariants are only INSTALLED by derivedRun)
tests/unit/features/processing/derivedRun.test.ts           (new)
tests/unit/ui/processing/derivedCard.test.tsx               (new)
tests/unit/features/processing/{aggregatePerArea,distanceToNearest,joinByLocation,
  processingStore,runQueue}.test.ts
tests/unit/ui/processing/{LogView,RecentRuns,ToolView,ToolsButton,engineStopped,
  outputDestination,styleByResult}.test.tsx
tests/unit/ui/shell/{ViewerShell,shellStore}.test.*
```

## How each controller requirement was met

1. **C1 (CRITICAL).** The dispatch is ONE branch point, `if (request.destination === "new")`,
   immediately after the executor returns and its abort check — textually above
   `if (target.kind === "vector") {` and far above the city write. A `"new"` run can reach
   neither This-layer publication: the non-city arm refuses rather than falling through. The
   head's `"Not available yet"` guard is KEPT and still fires for a tool whose `destinations`
   lack `"new"` (`aggregate-per-area`); A2's streaming refusal is untouched. Task 20's staging
   test was UPDATED, not deleted: `refuses a New-layer request for a tool that does not offer
it` now asks `aggregate-per-area` (the head checks the destination before the missing-source
   refusal), and the A2 case dropped its `withNewLayer` wrapper so it proves the SHIPPED
   registry. `outputDestination.test.tsx`'s gate case moved to `aggregate-per-area` for the
   same reason, and its seven `height-from-extent` staging wrappers were unwrapped.
2. **C3.** `useStyleByResult`'s `start` keeps Task 9's
   `(run: RunRecord, column: OutputColumn, descriptor: StyleByResult)`; the one line changed is
   `const layerId = run.newLayerId ?? run.targetLayerId;`. The brief's step 10.6 quotes the
   obsolete `(run, column: string)` shape and was not applied.
3. **C2.** `RunRecord` gains `destination` and `newLayerName` (frozen in `queueRun` off the
   request) as well as `newLayerId`. "Edit & run" restores both into the draft, pinned by a new
   `RecentRuns.test.tsx` case. "Run again" needed no change: it calls `dismissRun` and leaves
   the draft, which already holds the user's destination and name — stated here because the
   requirement names it.
4. **Round-1 C6.** The published name is read from `useLayerStore` and then from
   `useGeoLayerStore`, falling back to `plan.name`; `summariseCreated(…, features, …)` takes the
   count as a parameter and the city path passes `scope.count` (the copy's own features), with
   `null` documented as Task 23's vector answer.
5. **The publication order.** `publish()` is the LAST step inside the FIFO slot and the only
   `discard()` the caller owns is the one between `prepareDerivedCityLayer` returning and
   `publish()` — there is NO try/catch around the publication, so `discard()` is syntactically
   unreachable after `publish()` (see Deviations 1). Failures inside the preparation drop its
   own table (Task 21). `removeLayer` runs outside `runOnTableQueue`. Every test in requirement
   5's list exists, in the table above; all of them run through the real queue with the mocked
   one-chain `runOnTableQueue`.
6. **Mock factories and process.** Three `vi.mock(".../features/processing/runQueue")` factories
   (`ToolView`, `styleByResult`, `engineStopped`) gained the REAL `newLayerUndoBlock` through
   `importActual` — a stub would let the card claim any reason it liked. The `duckdb` factory in
   `derivedRun.test.ts` keeps a real one-shot `onEngineDeath` registry (Task 21's pattern), which
   is what makes the death case non-vacuous; the `layerTables` factory exports
   `nextTableName` and `adoptLayerTable` beside the four the queue already used. Log ENTRY
   labels are Task 21's descriptive ones, unchanged. The full suite ran ONCE in the background
   with `& wait $!; echo "suite: $?"`.

## Deviations from the brief (each named)

1. **No try/catch around the publication.** The brief's step 4 wraps `publish()`,
   `publishProvenance`, the `patch` and `pushNotice` in a `try { … } catch { await
plan?.discard(); throw }` — so anything throwing AFTER `publish()` would drop the table of a
   layer the user can already see, which requirement 5 forbids. Replaced by the plain
   `if (signal.aborted) { await plan.discard(); throw new CancelledError(); }` before
   `publish()`, and nothing after it that can reach `discard()`.
2. **The destination branch sits above the vector publication, not inside the city write path**
   (C1), so it carries its own `canonicalise` and empty-result handling rather than inheriting
   the city path's. The empty-result block was extracted into one `doneWithNothing` closure
   instead of being copied a third time.
3. **`RunRecord` gains three fields, not two** (C2) — the brief's Interfaces block omits
   `newLayerName`.
4. **`App` has no `unifiedLayerItems`.** The brief's own parenthesis anticipates this; the
   effect uses `resolveActiveLayer(requestedZoom, layers, geoLayers)`, both arrays already being
   subscribed at `App.tsx:376/386`.
5. **`query`, not `ctx.query`,** is handed to `prepareDerivedCityLayer` — same function, and the
   context read costs a `+1` lint warning off a hard baseline.
6. **A death-before-publish case was added** (not in the brief's file) because requirement 5
   lists it; it needed the `onEngineDeath` registry the brief's mock discarded.
7. **`withNewLayer` was deleted from `runQueue.test.ts`** and unwrapped seven times in
   `outputDestination.test.tsx`: it staged `"new"` on `height-from-extent`, which the registry
   now ships, so the tests were describing a fact that is no longer a fact.
8. **Two obsolete assertions were rewritten, not deleted:** `ToolView.test.tsx`'s OUTPUT case
   (`New layer offered but staged off` → `offered beside it`, `toBeDisabled` → `toBeEnabled`)
   and `outputDestination.test.tsx`'s gate case (moved to the one tool that is still
   `["layer"]`).

## Self-review

- The city and vector publications are byte-for-byte what they were apart from (a) the
  `undoState.set` literals moving one level into `state:`, (b) the empty-result block becoming
  a call, and (c) `stealUndo`'s and `installStaleWatcher`'s one-line guards. `tsc` is the proof
  that neither `undoState.set` was missed: `RunUndo` has no member accepting a bare `UndoState`.
- The stale-watcher guard was proved to BITE rather than assumed: the case failed before it and
  passed after, and the This-layer half beside it (`…and the guard is what does it`) proves the
  watcher fires at all.
- `newLayerUndoBlock` is null for a This-layer run at the FIRST line, so the footer's
  unconditional call costs one property read on every done card and the block cannot leak into
  a rule it is not about (pinned by `leaves a THIS-LAYER run's Undo alone`).
- The `runIds` set is built from a FRESH `getState()` after `publishProvenance`, and
  `offers Undo IMMEDIATELY after publication` is written against the snapshot bug (round-1 C3);
  it also undoes for real, so a passing block is not the only thing asserted.
- A15's note and §6.1's "finished before the cancel arrived" note are joined with `" · "` rather
  than one overwriting the other — both are true at once when a cancel loses the race to a
  publication that also had to rename.
- `summariseCreated` splits `base.line` on `" · "` and drops only the head segment, so a layer
  name containing `" · "` (which every §6 prefill does) survives — asserted by the `Created
Delft · extent · 1 building · …` shape.
- `derivedCard.test.tsx`'s `addLayers` casts two id/name stubs through `as never`: only the ids
  reach the card, and a full `Layer` fixture would assert `addLayer`'s defaults, which is
  another suite's job.
- The `impeccable` design hook flagged two pre-existing `Outfit` font findings in
  `src/app/brand.css` — a file this task never touched and the brand's own token file per
  CLAUDE.md. Left standing, nothing suppressed. No CSS was added: `Zoom to layer` is the same
  bare `<button>` inside `.processing-card__actions` as its four peers, so it inherits
  `flatControls.css`'s radius, height and spacing exactly.

## Concerns (for the commander, not fixed here)

- **`newLayerUndoBlock` counts FAILED and CANCELLED runs too.** Its doc quotes §6.2's "(queued,
  running or done)" but the `runs.some(...)` scan has no status filter, so a run that failed at
  the head against the copy — a bad prefix, a removed source — blocks its Undo for ever. The
  brief's own code is identical, so this is inherited rather than introduced; changing it is a
  one-line status filter and a spec reading the commander may want to make explicitly.
- **`RecentRuns`' Undo button has no block UI.** The history row still offers Undo on a
  New-layer run a later run has used; `undoRun`'s own guard refuses it and writes
  `patch(id, { error: blocked })`, which a DONE row does not render (`secondLine` shows the
  summary). The press is safe but silent. §6.2 describes the CARD, so this was left alone; a
  later task could give the row the same `newLayerUndoBlock` title the card has.
- **`RunFooter`'s `undoBlock` is a non-reactive `getState()` read.** It is recomputed on every
  render, and `ToolView` subscribes to `s.runs`, so a later run submitted while the card is on
  screen does re-render it — but nothing guarantees that, and a block that appeared while the
  footer was idle would not disable the button until the next render. The queue-side refusal is
  the authority either way.
- **A New-layer run evicted from the history keeps its layer.** `discardUndo` for a `"layer"`
  state deletes the Map entry and nothing else — which is right (the layer is legitimately
  there), but it means the copy can never be undone, only removed from the layer list. That is
  §6.2's own fallback sentence, so it reads correctly; noted because it is the one asymmetry
  with the city Undo, whose backup table is actually dropped.
- **No browser pass.** The `New layer` radio is live in the shipped app for the first time, and
  §6.2's card now has a fifth button, but this host is headless and the run needs a real DuckDB
  boot plus a city model to reach a done card. Task 20's report deferred the browser check to
  this task; I am deferring it again, explicitly, to whoever can drive `agent-browser` with a
  real layer. The three things to look at: the `Zoom to layer` button's spacing against its four
  peers at 400 px, the copy's row appearing directly under its parent in the layer list, and
  whether `fitLayer` on a freshly published copy actually frames it (the mesh is built by
  `handleSync` on the next layer-sync pass, and a `fitLayer` that races it may no-op).
- **`aggregate-per-area` is the last `["layer"]` entry.** `withNewLayer` survives in
  `outputDestination.test.tsx` for exactly its two cases; Task 23 deletes the helper with it.

---

## Fix round 1 (pair 21+22 review)

**Status:** all review items addressed — both Important findings and both Minors. Four commits on
`develop`, based on `9ce66fb` (Task 23's derived VECTOR layers landed after my commits), nothing
pushed, no trailers, hooks never bypassed, `core.hooksPath` untouched. `git status` was clean at
the start apart from the two untracked directories I never stage, and is again now.

```
0c7ca2c fix: a failed or cancelled later run no longer blocks a derived layer's Undo
eb8554b fix: the history row's Undo says why a derived layer can no longer be removed
b3300e2 fix: a run's log keeps its target's ancestry after the layer is removed
64873a2 test: a follow-up run on a published copy, and a death that never frees its query
```

### Important 1 — the Undo block's status filter

`newLayerUndoBlock`'s run-history scan now qualifies on STATUS. The set is named and documented
rather than inlined:

```ts
const USES_THE_COPY: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "queued",
  "running",
  "cancelling",
  "done",
]);
```

`failed` and `cancelled` are out — a run refused at the head, or cancelled while it waited its
turn, never wrote anything and never will, so it cannot cost the user a layer they could
otherwise remove with one press. `cancelling` is IN although §6.2 does not name it: it is a
running run that has been asked to stop and may still commit (§6.1's "finished before the cancel
arrived"), so treating it as gone would let Undo remove a layer a live run is mid-publication
over. That reading is the one judgement call in this round and it is spelled out in the code.

The "has computed columns of its own" half is untouched.

**RED** (before the filter), `tests/unit/features/processing/derivedRun.test.ts`:

```
 × keeps Undo when the later run failed before touching the copy (as its target)
 × keeps Undo when the later run failed before touching the copy (as its source)
 × keeps Undo when the later run cancelled before touching the copy (as its target)
 × keeps Undo when the later run cancelled before touching the copy (as its source)
 × keeps a VECTOR copy's Undo when the later run failed (as its target)
 × keeps a VECTOR copy's Undo when the later run cancelled (as its source)
 AssertionError: expected 'Used by a later run; remove the layer…' to be null
 Tests  6 failed | 32 passed (38)
```

**GREEN** — `Tests 38 passed (38)`. Six new cases in all, four of them an `it.each` over
(status × role) for a CITY copy and two for a VECTOR copy; each one also calls `undoRun` and
asserts the layer really goes, so a passing predicate is not the only thing under test. Two more
cases were added on the blocking side, because the review's "test both target and source cases"
cuts both ways and only the TARGET half was covered before:

- `blocks Undo for a later run that reads the copy as its SOURCE` (city, `running`)
- `blocks a VECTOR copy's Undo for a later run that READS it` (`queued`)
- `blocks Undo while the later run is still CANCELLING — it may yet publish`

Task 23's own `blocks Undo while a later run is still RUNNING against the copy` is unaffected and
still green.

### Important 2 — the history row's Undo

`RecentRuns.tsx`'s `RunRow` now computes `newLayerUndoBlock(run)` exactly as `RunFooter` does, and
its Undo button takes `disabled={engineStopped || undoBlock !== null}` with
`title={engineStopped ? UNDO_ENGINE_STOPPED : (undoBlock ?? undefined)}`. The engine-stopped
reason it already had is unchanged and still outranks the block, which is right: a dead engine is
the more fundamental refusal.

**RED**, `tests/unit/ui/processing/RecentRuns.test.tsx`:

```
 × refuses a New-layer Undo the queue would refuse, and says why
   Received element is not disabled: <button ...>
 Tests  1 failed | 14 passed (15)
```

**GREEN** — `Tests 15 passed (15)`. Two rendered history-row cases: the blocked one (disabled,
§6.2's sentence as the title, `undoRun` never called) and its opposite
(`leaves a New-layer Undo alone while nothing has used the copy` — enabled, and the click reaches
`undoRun`). The file's `vi.mock` of `runQueue` gained the REAL `newLayerUndoBlock` through
`importActual`, the same treatment the card's suite and `ToolView`/`styleByResult`/`engineStopped`
already have — a stubbed predicate would let the row claim any reason it liked.

### Minor 1 — A7 survives the target's removal

`RunRecord` gains `targetDerivedFrom: DerivedFrom | null`, frozen in `queueRun` beside
`targetName` by a new module-private `derivedFromOf(layerId)` that reads BOTH stores. §6.4 is a
historical document: a header that looked the ancestry up when the log was opened lost
`Derived from <parent>` as soon as the target was removed — for a run the history deliberately
keeps — and would have renamed it behind the run's back when the parent was renamed.

Consequences, all in the same commit: `targetLayerLine(run)` and `formatRunLog(run)` drop their
second argument and read the record (the "pure, passed in" rationale is gone now that the record
carries it); `LogView` drops the lookup and both store imports, including Task 23's geo arm —
one capture at Run covers both kinds, so the derived-vector case is no longer a second code path.
The `targetDerivedFrom: null` sweep touched 11 `RunRecord` fixtures, which `tsc` named.

**RED**, `tests/unit/ui/processing/LogView.test.tsx` — 9 failures, the A7 pair plus every
`formatRunLog` call site whose second argument had gone. **GREEN** — `Tests 15 passed (15)`.
The two A7 cases now seed NO layer at all and assert `useLayerStore.getState().layers` is empty
before rendering, which is the regression stated as an assertion: with the old lookup they fail.

### Minor 2 — the integration coverage

- The `layerTables` mock's `getLayerTable` resolves **adopted** tables
  (`layerId === "L1" ? parentTable : (adopted.get(layerId) ?? null)`), so a published copy is a
  real target. New case
  `is an ORDINARY target from publication on: a run computes over ITS table`: a follow-up
  This-layer run on the copy writes `ALTER TABLE "<copy table>"` and never
  `ALTER TABLE "layer_1"`, its own record carries A7's ancestry
  (`{layerId: "L1", layerName: "Delft", runId: <creating run>}` — the both-store capture, proved
  end to end rather than by a seeded field), and `newLayerUndoBlock` on the first run then returns
  the block from a REAL done later run instead of a hand-seeded one.
- Both death cases (city and vector) now **never release** the held query: `gate = null` frees
  only LATER statements, so the CTAS that the death caught is still hanging when the run has
  already ended. Each case then submits a second run and asserts it reaches `done` — which would
  time out if the stranded statement still held the FIFO — and asserts `released === false` (a
  flag set from `held.promise.then`), so the line above is about the death race and not about a
  gate somebody quietly opened.

### Gates

```
$ npx tsc -b --noEmit                                   → 0
$ npx vp check                → Found 0 errors and 56 warnings in 583 files   (baseline held)
$ npx vitest run > …/m3-task22-fix1.log 2>&1 & wait $!; echo "suite: $?"
  suite: 0
  Test Files  276 passed | 4 skipped (280)
  Tests  3653 passed | 96 skipped (3749)
```

### Files changed in this round

```
src/features/processing/runQueue.ts      (USES_THE_COPY, derivedFromOf, targetDerivedFrom)
src/features/processing/types.ts         (RunRecord.targetDerivedFrom)
src/ui/processing/RecentRuns.tsx         (the Undo block)
src/ui/processing/runFormat.ts           (targetLayerLine/formatRunLog read the record)
src/ui/processing/LogView.tsx            (no store lookup, two imports dropped)
tests/unit/features/processing/derivedRun.test.ts          (+7 cases, mock registry, death cases)
tests/unit/ui/processing/RecentRuns.test.tsx               (+2 cases, real block in the mock)
tests/unit/ui/processing/LogView.test.tsx                  (A7 off the record)
+ the mechanical `targetDerivedFrom: null` sweep across 11 RunRecord fixtures
```

### Notes and remaining concerns

- **Task 23's suites are green and untouched.** Its `withDestinations` helper, its derived-vector
  cases and its own `newLayerUndoBlock` case all still pass; the status filter applies to both
  layer kinds through the one predicate, which is what the vector `it.each` proves.
- **`cancelling` counts as using the copy.** §6.2's list is "(queued, running or done)"; this is
  the one place the implementation is wider than the sentence, for the reason given above. If the
  commander reads §6.2 as exhaustive, it is a one-element change to the set.
- **The browser pass is still outstanding** — third deferral, unchanged: the copy's framing by
  `fitLayer`, the five-action row at 400 px, and the copy's row position under its parent. The
  history row's new disabled Undo joins that list (it reuses the card's exact markup, so the
  risk is presentational only).
- **`RunFooter` and `RecentRuns` now both call `newLayerUndoBlock` on render.** Neither is
  reactive to `undoState`, which is a module Map — the store subscriptions they already have
  (`s.runs` for the row, `s.engineStopped` plus the `run` prop for the card) are what re-render
  them. The queue-side refusal in `undoRun` remains the authority either way.
