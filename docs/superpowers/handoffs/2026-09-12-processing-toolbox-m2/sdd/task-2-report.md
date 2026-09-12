# Task 2 report — The "Loading extension" phase in the run queue (M13.2)

Branch `develop`, base HEAD `c22cb02`. One commit: `788f9da feat(processing): a run loads its tool's extension in its own phase`.

## What was implemented

`src/features/processing/runQueue.ts`

1. The module's `../../insights/duckdb` import now also pulls `ensureExtension`, `getDuckDBStatus` and `isExtensionLoaded`. No new `@duckdb/duckdb-wasm` importer: the engine is still reached only through `insights/duckdb.ts`.
2. Two new module-level helpers beside `failedAlready`, verbatim from the brief:
   - `extensionReason(name)` — DuckDB's own recorded reason for a failed load, or `null` (reads `getDuckDBStatus()`, only meaningful in the `"ready"` state).
   - `extensionFailure(name)` — spec §6.3's sentence. Offline (`navigator.onLine === false`, advisory): "The <name> extension could not be loaded; it needs a network connection." Online: "The <name> extension could not be loaded: <DuckDB's reason>", degrading to "…could not be loaded." when nothing was recorded.
3. Inside `execute`, between the `if (!executor)` refusal and `resolveScope`, the §6.1 phase: `const tool = toolById(request.toolId)`; when `tool.extension !== null && !isExtensionLoaded(tool.extension)` the card goes to `status: "running", phase: "extension"`, `ensureExtension` is awaited, a Cancel that arrived during the download is honoured on the far side of the await, and a failed load pushes `"<name>: <reason>"` onto the run's warnings (when there is a reason) before failing the run with `extensionFailure`. Nothing is written: the executor is never reached.
4. The duplicate `const tool = toolById(request.toolId);` in the publication block (formerly `:591`) was deleted and the publication block now reads the binding declared for the phase — same `try` scope, same tool, and two bindings of one name in one function body is a `tsc` error.

`tests/unit/features/processing/runQueue.test.ts`

- Added `const { ensureExtension, isExtensionLoaded, getDuckDBStatus } = await import("../../../../src/insights/duckdb");` to the file's top-level-await import block (the `vi.mock` factory already stubbed all three from Task 1, so no factory change was needed).
- `beforeEach` now resets all three: `mockClear()` **before** setting the value on each, so the "never called" assertion cannot inherit the previous test's call, plus a fully-formed `state: "ready"` status with every `ExtensionName` key.
- `afterEach` gained `delete EXECUTORS["measure-solids"]` beside the `height-from-extent` line, so the Task 9 `register.test.ts` pin cannot be polluted.
- New suite `describe("the Loading extension phase (spec §6.1)")`, three tests, verbatim from the brief.

## Tests and results

Three new tests, all passing:

1. _loads the tool's extension under its own phase before computing_ — `ensureExtension` is called with `"three_d"`, the store sees `"extension"` before `"compute"`, and the run reaches `done`.
2. _skips the phase when the extension is already loaded_ — `isExtensionLoaded` true ⇒ `ensureExtension` never called.
3. _fails the run when the extension cannot be loaded, and writes nothing_ — the executor never ran, `error` is `"The three_d extension could not be loaded: HTTP 404"`, `warnings` contains `"three_d: HTTP 404"`, `undoable` is `false`.

Focused suite `tests/unit/features/processing`: **6 files, 84 tests passed** (81 before, so no existing test moved).

## TDD evidence

RED — after writing only the tests:

```
$ npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Loading extension"
 ❯ tests/unit/features/processing/runQueue.test.ts (36 tests | 2 failed | 33 skipped)
     × loads the tool's extension under its own phase before computing
     × fails the run when the extension cannot be loaded, and writes nothing

 FAIL … > loads the tool's extension under its own phase before computing
 AssertionError: expected "vi.fn()" to be called with arguments: [ 'three_d' ]
 Number of calls: 0
   ❯ …:1279  expect(ensureExtension).toHaveBeenCalledWith("three_d");

 FAIL … > fails the run when the extension cannot be loaded, and writes nothing
 AssertionError: expected true to be false // Object.is equality
   ❯ …:1336  expect(ran).toBe(false);

 Tests  2 failed | 1 passed | 33 skipped (36)
```

Both failed for the intended reason: no phase existed, so `ensureExtension` was never consulted and the third test's run went straight into the executor (`ran === true`; the run still reached `failed`, but from the executor's own `throw new Error("unreachable")`, not from a refused load).

**Test 2 passed on RED, and that is expected**, not a broken red: it is a no-call guard (`expect(ensureExtension).not.toHaveBeenCalled()`) over a branch that did not yet exist. Its value is a regression pin for the _skip_, and it only becomes meaningful once tests 1 and 3 prove the branch exists.

GREEN — after the `runQueue.ts` change, nothing else touched:

```
$ npx vitest run tests/unit/features/processing
 Test Files  6 passed (6)
      Tests  84 passed (84)
```

Gates before the commit:

```
$ npx tsc -b --noEmit      # exit 0, no "Cannot redeclare block-scoped variable 'tool'"
$ npx vp check             # Found 0 errors and 56 warnings in 511 files  (baseline, none added)
```

`vp check` first reported one formatting issue in the appended test block; `npx vp check --fix` applied it (whitespace only) and the focused suite was re-run green afterwards. The pre-commit hook ran `vp staged` clean.

## Full suite

Run once, at the end, in the background (`npx vp test run`, log at `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite.log`, background task exit code **0**):

```
 Test Files  233 passed | 2 skipped (235)
      Tests  2847 passed | 31 skipped (2878)
   Duration  60.36s
```

No regression anywhere in the app suite.

## Files changed

- `/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts` (+84 / −2)
- `/data2/hideba/multiroof-viewer/tests/unit/features/processing/runQueue.test.ts` (+117)

## Self-review

- **Placement.** The phase is after every cheap refusal and inside `runOnTableQueue`, exactly as the brief argues: an unimplemented tool, a removed layer, a rebuilt table or a file-owned column all refuse before anything downloads, and the load cannot interleave with a table rebuild.
- **`patch` ordering.** The warnings patch carries no `status`, so it is accepted; the `status: "failed"` patch that follows is accepted because the run is still `"running"`. A run the target-removal watcher already failed keeps its own reason — `patch` refuses the second status, and the extra warning is harmless.
- **Type fit.** `ToolDefinition["extension"]` is `ToolExtension | null` with `ToolExtension = "spatial" | "three_d"`, so the brief's literal-union parameters fit without widening. `status.extensions[name]` is a literal-keyed `Record<ExtensionName, …>`, so `noUncheckedIndexedAccess` adds no `undefined` — the `entry &&` guard is for the non-`"ready"` `null` only.
- **Cosmetic, left verbatim as the brief specifies:** the §6.3 doc block sits directly above `extensionReason`, so two adjacent `/** */` blocks stack there and the §6.3 rationale is not attached to `extensionFailure`, the function it describes. Deliberate — the brief's code was to be used verbatim. Easy to re-order later if a reviewer dislikes it.
- **Untouched as instructed:** `heightFromExtent`, the phase vocabulary, `phaseLine` / `runFormat.ts`, and all UI. No M2 tool declares an extension (`roof-metrics` and `height-from-extent` are both `extension: null`), so the branch is dead in production today and exercised only by these tests — which is the point: M3's `three_d`/`spatial` tools become a registry change.

## Concerns / notes for later tasks

1. **The live ticker resets at the hand-off.** `execute` patches `startedAt: Date.now()` again when it flips to `phase: "compute"`, so a run that spent seconds in `extension` sees its live elapsed jump back to zero. Left in place deliberately, per the brief. The number the card _finally_ reports comes from `elapsed()` (measured from `started`, before the phase), so the reported total does include the download. The roadmap bullet "the run's live elapsed timer starts at submit but is measured from execute, so it can jump back" should be extended to name the extension phase — **Task 12**.
2. **The offline branch has no automated test.** `navigator.onLine` is `true` under jsdom and `undefined` under bare Node, so the offline sentence is unreachable from the unit suite without stubbing `navigator`. The brief did not ask for one and the detection is explicitly advisory; if the offline sentence is ever load-bearing for a spec check, it needs either a `vi.stubGlobal` test or a browser smoke.
3. **The load blocks the table queue.** Documented in the inserted comment as the deliberate trade. A first `three_d` load is a ~24 MB download, and for its duration no layer table can build or rebuild. If a streaming layer's settle backs up behind it in practice, that is the place to look — not a bug, a design choice recorded here so it is not rediscovered as one.
4. **No new mock-factory churn was needed**, but note for future tasks: every `vi.mock(".../insights/duckdb")` factory that is in the import path of `runQueue` must now export `isExtensionLoaded`, `ensureExtension` and `getDuckDBStatus` or the module import throws. All five existing factories (`runQueue`, `ToolView`, `useToolForm`, `insights/computedColumns`, `integration/duckdb/computedColumns`) already do, from Task 1.

---

# Fix round 1

Codex review returned **Needs fixes**. Rebased on top of Task 1's fix `cc1e345`. One commit: `689e75d fix(processing): one execution start per run, and cover the extension phase's async boundary`.

## Finding 1 — elapsed time resets during an active run (plan-mandated)

> "Loading sets `startedAt`, then computation replaces it. Because the footer calculates live elapsed time from that field, a lengthy download visibly drops back to zero at hand-off (runQueue.ts:505, :562; RunFooter.tsx:177)."

**Ruling applied: fixed now, not deferred.** One execution start timestamp for the whole run.

Change — `src/features/processing/runQueue.ts`:

- `execute()` :435 (new) — a single `patch(id, { startedAt: Date.now() })` immediately after the "cancelled while queued" guard, with a comment naming the footer's ticker, the fact that `elapsedMs` is measured from `started = performance.now()` at the same instant, and why `submitRun`'s stamp (the QUEUED stamp) is not the one the ticker reads.
- `execute()` :514 — the extension patch lost its `startedAt`: now `patch(id, { status: "running", phase: "extension" })`.
- `execute()` :566 — the compute patch lost its `startedAt`: now `{ status, phase: "compute", featureIds, scopeCount }`.

`startedAt` is therefore written exactly twice in a run's life and never at a phase change: once at `submitRun` (queued), once when execution begins. The live ticker is not live for a queued run (`RunFooter.useElapsed` only ticks for `running`/`cancelling`), so nothing else moved. `installTargetRemovalWatcher`'s `Date.now() - run.startedAt` and `LogView`'s "Started" / "frozen at" now all read the one execution stamp.

Covering test — `tests/unit/features/processing/runQueue.test.ts`, _"keeps ONE execution start across the extension hand-off"_: a deferred `ensureExtension`, `startedAt` captured while `phase === "extension"`, a real 10 ms delay (without it `Date.now()` cannot tell a second stamp from the first), then resolve and wait for `done`. Asserts `startedAt` is byte-identical across the hand-off **and** that the card's final `elapsedMs` is still ≥ 10 ms — the download is inside the reported total, which is the whole point of not simply dropping the stamp.

RED (tests written first, before touching `runQueue.ts`):

```
$ npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Loading extension"
 FAIL … > keeps ONE execution start across the extension hand-off
 AssertionError: expected 1789163498505 to be 1789163498444 // Object.is equality
   ❯ …:1338  expect(runById(id)?.startedAt).toBe(startedAt);
 Tests  1 failed | 6 passed | 33 skipped (40)
```

The stamp jumped forward 61 ms at the hand-off — exactly the reviewer's "drops back to zero".

GREEN, after the three edits above:

```
$ npx vitest run tests/unit/features/processing
 Test Files  6 passed (6)
      Tests  88 passed (88)
```

## Finding 2 — the async boundary lacked regression coverage

Three tests added, plus a small amount of shared scaffolding in the suite (`solidsRequest()`, `registerSolids()` returning a "did the tool run" probe, `recordPhases()`); the three original tests were rewritten onto the same helpers so the suite reads as one thing. The failure test also gained `expect(sql).toEqual([])` — "writes nothing" is now asserted, not just implied by the executor not running.

**(a) "holds the tool and the queue behind the load until it settles".** `ensureExtension` returns a deferred promise. While it is pending: the tool has not run, the run reads `running` / `phase: "extension"`, a **second** run submitted behind it is still `queued`, and not one statement has gone to the database (`sql` is empty). Resolving lets the first run finish and the second run reach `done`. This is the test for the comment's claim that the load sits inside `runOnTableQueue`.

**(b) "cancelled during the load, it writes nothing once the load settles".** Cancel while the load is pending (card → `cancelling`), then resolve the load. Asserts `cancelled`, the tool never ran, `sql` empty, `attributesOf("a").solid_volume_m3` undefined (the executor's rows are keyed on `"a"`, a real model object, so a write would be visible), the provenance registry empty, `undoable` false, `phase` null.

**(c) "tells an offline browser what it can act on, and still records DuckDB's reason".** `Object.defineProperty(navigator, "onLine", { value: false, configurable: true })` over jsdom's prototype getter, restored by `Reflect.deleteProperty(navigator, "onLine")` in the file's `afterEach`. With a recorded reason of `"Failed to fetch"`, the run's `error` is the offline sentence and its `warnings` still carry `"three_d: Failed to fetch"` — §6.4's record survives the substitution.

## Finding 3 (minor) — the skip test asserted no download, not no phase

_"skips the phase when the extension is already loaded"_ now records the run's phases through `recordPhases()` and asserts `expect(phases).not.toContain("extension")` alongside the existing `ensureExtension` never-called check. §6.1 skips the PHASE; the card must never show "Loading extension" for an extension that is already there.

## RED evidence for findings 2 and 3 — mutation testing

These three findings are **coverage gaps, not defects**: the behaviour they pin was already correct, so the tests pass against the code as committed in `788f9da` and there is no honest "red" to show by writing them alone (all six non-`startedAt` tests passed on the first run). Instead, each was proved to bite by breaking the behaviour it covers and watching exactly that test fail. Every mutation was applied to a copy-restored `runQueue.ts` and reverted immediately; `git diff --stat` was checked afterwards and the focused suite re-run green.

| Mutation                                                                                 | Expected to fail                        | Result                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M1 — delete the post-load `if (signal.aborted)` check                                    | (b) cancel                              | `× cancelled during the load, it writes nothing once the load settles` — 1 failed \| 6 passed             |
| M2 — force `const offline = false`                                                       | (c) offline                             | `× tells an offline browser what it can act on, and still records DuckDB's reason` — 1 failed \| 6 passed |
| M3 — drop the `!isExtensionLoaded(...)` guard                                            | finding 3                               | `× skips the phase when the extension is already loaded` — 1 failed \| 6 passed                           |
| M4 — `void ensureExtension(...)`, `const loaded = true` (start the load, don't await it) | (a) blocking, and everything downstream | 5 failed \| 2 passed, including `× holds the tool and the queue behind the load until it settles`         |

M4 is the strongest of the four: removing the `await` — the async boundary the reviewer named — breaks five of the seven tests. Before this round, the same mutation broke none of the blocking or cancel behaviour under test.

## Gates

```
$ npx vitest run tests/unit/features/processing     # 6 files, 88 tests passed (84 before)
$ npx tsc -b --noEmit                               # exit 0
$ npx vp check                                      # 0 errors, 56 warnings (baseline, none added)
```

`vp check` flagged formatting in the appended test block once; `vp check --fix` applied it (whitespace only) and the focused suite was re-run green afterwards. Pre-commit hook clean. Full suite: see below.

## Files changed in this round

- `/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts` — one `startedAt` patch added, two removed.
- `/data2/hideba/multiroof-viewer/tests/unit/features/processing/runQueue.test.ts` — three new tests, three rewritten onto shared helpers, one `afterEach` restore.

## Notes

- Concern 1 of the original report ("the live ticker resets at the hand-off → defer to Task 12") is **resolved in code**, not deferred. The roadmap bullet it referred to ("the run's live elapsed timer starts at submit but is measured from execute, so it can jump back") is now stale for the execution half: the timer no longer jumps at a phase change. Task 12 should retire or reword that bullet rather than extend it — a queued run still shows nothing ticking, which is the only remaining part of it.
- Concern 2 ("the offline branch has no automated test") is resolved by (c).
- The suite's three original tests are no longer byte-verbatim from the brief: they were rewritten onto `solidsRequest()` / `registerSolids()` / `recordPhases()` so seven tests do not repeat the same twelve-line request literal. The assertions are unchanged except for the two additions the review asked for (finding 3's phase check, and `sql` emptiness in the failure test).

## Full suite (fix round 1)

`npx vp test run`, once, in the background (log at `/tmp/claude-1020/-data2-hideba-multiroof-viewer/9d7538d6-bee9-4194-bf86-967da2bad364/scratchpad/full-suite-fix1.log`, exit code **0**):

```
 Test Files  233 passed | 2 skipped (235)
      Tests  2853 passed | 31 skipped (2884)
   Duration  61.35s
```

2847 → 2853 (the three new tests plus the three rewritten ones net out as +6 over the pre-round total of 2847; the suite's file and skip counts are unchanged). Removing `startedAt` from the two phase patches regressed nothing anywhere in the app.
