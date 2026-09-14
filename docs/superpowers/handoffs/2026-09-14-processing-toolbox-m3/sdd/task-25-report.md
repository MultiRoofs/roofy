# Task 25 — Engine death off the table FIFO — report

Branch `develop`, five commits on top of `45baa29`. Nothing pushed.

## Commits

| sha       | subject                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `8d29218` | `fix: every engine primitive settles when the worker dies under it`                |
| `6ead95b` | `fix: retryEngine abandons a rebuild only when a death moved the engine`           |
| `e4dd0ee` | `fix: undoRun publishes nothing when the engine dies past its COMMIT`              |
| `6c24bcf` | `test: the off-queue engine callers settle with their own message`                 |
| `878d003` | `docs: undoRun's death comment names the flag the session's Undo really goes with` |

No trailers of any kind. `.github/hooks/`, `docs/design-history/` and `.superpowers/` left untracked. Hooks ran on every commit (never bypassed).

## Implemented

1. **`src/insights/duckdb.ts`** — one module-local `settleOnDeath<T>(promise, fallback)` beside `markEngineDead`/`onEngineDeath` (no new export, so no mock-factory sweep), wrapping the ONE await of each of the six primitives: `runQuery` (→ `{ok:false, message:"Analytics engine stopped"}`), `ddl` (inherits, it _is_ `runQuery`), `queryDuckDB` (→ `null`), `registerBuffer` (→ `false`), `readFile` (→ `null`), `dropBuffer` (→ returns). Each wrapper captures `const live = conn`/`const live = db` first, because `markEngineDead` nulls both before the inner await resumes.
2. **`src/insights/layerTables.ts`** — `retryEngine` now does `const booting = bootEngine(); const engine = getEngineGeneration(); await booting;` and returns when `getEngineGeneration() !== engine`, **before** `pendingSources.clear()`.
3. **`src/features/processing/runQueue.ts`** — `undoRun`'s post-COMMIT `EngineDeadError` catch `return null`s instead of falling through, so no `mergeAttributes`, no `rollBackProvenance`, no `undoState.delete`, no `"Undone"` card.
4. **Tests** — `duckdbEngine.test.ts` harness gains `hangWhen` plus the three VFS methods on the fake `AsyncDuckDB` and an 8-case `describe`; `layerTablesBuild.test.ts` gains `bootAlso`/`booted` and three `retryEngine` cases; new `tests/unit/features/processing/engineDeath.test.ts`; dying-engine guards added to `ExportDialog.test.tsx`, `useLayerCounts.test.tsx`, `styleByResult.test.tsx` and `exportCityParquet.test.ts`.

## TDD evidence

**RED 1 — primitives** (`npx vitest run tests/unit/insights/duckdbEngine.test.ts`, before the `duckdb.ts` change):

```
Tests  6 failed | 17 passed (23)
Error: Test timed out in 5000ms.   (runQuery, ddl, queryDuckDB, registerBuffer, readFile, dropBuffer)
```

The two cases that already passed are exactly the two that must not change: the `raced(...)` ordering pin and the already-dead guard — empirical proof the run queue's `EngineDeadError` path is untouched.

**GREEN 1** — `npx vitest run tests/unit/insights` → `17 files, 333 passed`.

**RED 2 — `retryEngine`.** The brief's first form of the `initDuckDB` mock (bump on EVERY call) turned 42 of the suite's 57 cases red, because a build captures `engine` at enqueue and a bump inside its own `await initDuckDB()` then reads as `engineGone()`. That is the brief's own "the mock is too eager, not the code" note: the real `initDuckDB` re-runs `doInit` only when `initPromise` is null. Modelled the memo with a `booted` flag; the suite then showed the intended single failure:

```
Tests  1 failed | 56 passed (57)
FAIL … > …and ABANDONS them when a DEATH moved the engine under the boot
AssertionError: expected [ …(3) ] to deeply equal []      // it rebuilt into the dead engine
```

**GREEN 2** — after the `retryEngine` change: `npx vitest run tests/unit/insights` → `336 passed`.

**RED 3 — `undoRun`** (`npx vitest run tests/unit/features/processing/engineDeath.test.ts`):

```
Tests  1 failed | 1 passed (2)
AssertionError: expected undefined to be 9      // the model HAD been restored
 ❯ engineDeath.test.ts:273  expect(attributesOf("a")["extent_height_m"]).toBe(9);
```

The failing assertion is the publication itself, not the gate — i.e. the death really landed after the Undo's COMMIT (see requirement 2 below). **GREEN 3** — `npx vitest run tests/unit/features/processing` → `33 files, 646 passed`.

## Verification

- `npx tsc -b --noEmit` → exit 0.
- `npx vp check` → **0 errors and 56 warnings** (the baseline). An intermediate run read 62: six `unicorn(no-useless-spread)` warnings from `for (const l of [...deathListeners])`. Fixed to `Array.from(...)` (the spelling `duckdb.ts` and `runQueue.test.ts` already use); the engineDeath one was folded into `e4dd0ee` by amend.
- Full app suite, once, in the background: `npx vitest run > …/m3-task25.log 2>&1 & wait $!` → `suite: 0`, `280 passed | 4 skipped (284) files`, `3701 passed | 96 skipped` tests.

## How each controller requirement was met

1. **Retry generation (round-1 C1).** The brief carries the post-boot binding and I verified the chain it rests on before building on it: `bootEngine` is `initDuckDB` aliased (`layerTables.ts:39`), `initDuckDB` calls `doInit()` with **no** await before it (`duckdb.ts:526-531`), and `doInit` opens with `const gen = ++generation` (`:405`) — so the bump is synchronous and a capture after `bootEngine()` starts reads the engine this retry is for. The first new case (`REBUILDS across an ordinary boot`) asserts a parked table is rebuilt after a boot that bumped the generation; a pre-boot capture fails it.
2. **Residual C9 — the post-COMMIT timing.** The brief's own test would have been green against unfixed code: it gates on `sql.some(startsWith("DESCRIBE"))` while the forward run's own post-COMMIT DESCRIBE is still in the trace, so the death lands during `undoComputedColumns` and the PRE-commit catch answers it. The test now clears the trace immediately before `undoRun`, gates on **`sql` containing `"COMMIT"` AND a DESCRIBE after it** (the Undo's own — `undoComputedColumns` sends `COMMIT` as its own statement, `computedColumns.ts:267`), and only then delivers the death. Asserted: model keeps `extent_height_m = 9`, provenance still holds the column, `note !== "Undone"`, and the shared FIFO released (`runOnTableQueue(async () => "free")` resolves).
3. **Design (h) exactly.** One race, inside the six primitives, in `duckdb.ts`; no new export; each returns its ordinary failure value; `dropBuffer` included. The ordering is pinned by `lets EngineDeadError still win inside raced (§6.1's sentence)`, which passed _before_ the change and still passes after — the run queue's path is provably unchanged, and the whole `runQueue`/`engineStopped` suite is green.
4. **Off-queue callers.** Guards added through the **real** caller modules with the engine mock made to behave like the new primitive (the request never answers; the death settles it with `"Analytics engine stopped"`): the export dialog (`role="alert"` shows the sentence instead of a silently disabled Export), the export writer (`runExport` rejects with it), the layer counts (`{all: null, loading: false, message: "Analytics engine stopped"}`) and `RunFooter`'s median (`pushNotice` with it, and no rule draft). Each of those four factories' `onEngineDeath` became a real listener set in the same commit, per the brief's rule. The other three named callers (the grid query, the map-filter sync, the Stats tab) get the same settle from the primitive and share the identical `ok: false` handling; they are not separately covered.
5. **`undoRun` stops short.** Covered above; the second case in the same file is the regression guard that a DESCRIBE which simply answers still publishes the restore, the rollback and the card.
6. **Process.** Full suite once, in the background, with `& wait $!; echo "suite: $?"`. Every touched `vi.mock(".../insights/duckdb")` factory still exports what its module graph imports (each suite run green individually and in the full run). No new status writer: `settleOnDeath` only reads `onEngineDeath`; `setStatus` is still the one writer.

## Self-review

- `settleOnDeath` leaks nothing: on a normal settle it calls `stop()`; on a death `markEngineDead` deletes each listener as it dispatches, and the later (never-arriving) settle would only re-delete and re-resolve, both no-ops.
- `const live = conn` / `const live = db` is load-bearing — without it the inner closure re-reads the field `markEngineDead` has already nulled.
- The `undoRun` short circuit leaves `undoState` in place and does not patch the card; that is deliberate, and the test confirms the truth the user sees comes from the death watcher instead (`engineStopped === true`, which takes every Undo away for the session).
- Requirement 5's phrase "the record reads failed with 'Analytics engine stopped'" does **not** match the code for this case, and the test asserts the code: `installEngineWatcher` only patches runs whose status is `queued`/`running`/`cancelling` (`runQueue.ts:2216-2228`), and the run being undone is `done`. What a death does to a done run is `markEngineStopped()`. The test drives both halves of a real death (one-shot listeners _and_ the `failed` status publish) so this is asserted rather than assumed.

## Concerns / residuals

- The comment shipped in `e4dd0ee` claimed the run "keeps its `undoable: false`" from the death watcher, which contradicts the very thing the test asserts (the watcher never touches a `done` run). Corrected in `878d003` — comment only, no behaviour, hooks ran.
- **`ensureExtension`'s in-flight `INSTALL`/`LOAD` is the same class as the one below**: `markEngineDead` clears `extensionPromises` so the NEXT call re-installs, but the await already in flight still never settles. Not in design (h)'s six; naming it beside the other residual.
- **`queryParquetBuffer` is still unraced** at its two direct VFS awaits (`database.registerFileBuffer(...)` and the `finally`'s `database.dropFile(...)`) — it bypasses `registerBuffer`/`dropBuffer`. Design (h) names six primitives and I did not widen it. Its only caller is the STAC item index, off the FIFO; a death mid-registration would still strand that one await. Worth a follow-up line in the ledger.
- The four caller guards are **green on write** (the callers' `ok: false` handling already existed; the behaviour change is in the primitive, whose red/green is in `duckdbEngine.test.ts`). They are regression guards for the contract, not red-first cases — stating it plainly rather than dressing them up.
- Fidelity nit: `bootAlso` bumps the generation but leaves `booted = true`, where a real death also clears `initPromise` so the next Retry genuinely re-boots. The third case's outcome is identical either way, so it was left alone.
- `layerTablesBuild.test.ts`'s `initDuckDB` mock now models `duckdb.ts`'s memo (`booted`). It is a closer fake than before, but it is a fake: if `initDuckDB`'s memo semantics ever change, this is the thing that quietly stops describing them.

## Fix round 1 (review of pair 25+26)

Worked on top of `6df91b1` (Tasks 26 and 27 landed after the first batch). Two commits, no trailers, nothing pushed, no other task's files touched beyond the one folded-in Task 26 minor:

| sha       | subject                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `c8ac596` | `test: the grid query, the map-filter sync and the Stats tab settle on a death`    |
| `c35a6a0` | `test: an undone run stays done, and the rule palette dodges Single and Unmatched` |

### Important — the three missing caller-settlement cases

Each boots the module's own duckdb mock with a never-settling primitive and delivers a real death through a real `onEngineDeath` listener set (the three factories' inert `() => () => {}` stubs were replaced), then asserts the CONSUMER's observable state:

- **(a) the grid query** — `tests/unit/ui/table/useLayerQuery.test.tsx`, `releases its loading state with §6.1's sentence when the engine dies`: `loading` is observed `true` with the request in flight, and after the death the hook's `message` reads `"Analytics engine stopped"` and `loading` is `false`.
- **(b) the map-filter sync** — `tests/unit/features/query/mapFilterSync.test.ts`, `SETTLES, and clears the filter, when the engine dies under the query`: `await syncFilterToMap(id)` returns at all (the await IS the no-hang assertion) and the layer's `visibleObjectIds` is back to `null` — the module's documented `ok: false` behaviour ("clear rather than leave a stale set"), with a stale `["OLD"]` set seeded first to prove it.
- **(c) the Stats tab** — `tests/unit/ui/inspector/StatsTabDuckdb.test.tsx`, `STOPS WAITING when the engine dies under the type breakdown`: the "DuckDB Analytics" section is asserted ABSENT with the read in flight, and present with "Rows loaded" and an empty breakdown after the death.

**One divergence, reported rather than papered over:** the review's phrasing for (c) ("the spinner ends and the failure message shows") does not match the component. `StatsTab` has neither — `duckdbStats` is `null` until the read answers (so the section's ABSENCE is the waiting state, and its appearance is the release) and a `!ok` result renders an empty `typeBreakdown` with no message anywhere (`StatsTab.tsx:62-83`). The test asserts the code's behaviour and the case's comment says so explicitly. If a message is wanted there it is a product change, not a test.

**RED evidence for all three (genuine this round).** With the fakes changed to model the UNFIXED primitive — the death is heard by a listener that settles nothing, i.e. the request stays stranded — all three fail:

```
FAIL tests/unit/features/query/mapFilterSync.test.ts > SETTLES, and clears the filter, when the engine dies under the query
Error: Test timed out in 5000ms.
FAIL tests/unit/ui/inspector/StatsTabDuckdb.test.tsx > STOPS WAITING when the engine dies under the type breakdown
FAIL tests/unit/ui/table/useLayerQuery.test.tsx > releases its loading state with §6.1's sentence when the engine dies
Tests  3 failed | 42 passed (45)
```

Restored, the same three files run `45 passed (45)`.

### Minors

- `engineDeath.test.ts` now also asserts `runById(id)?.status === "done"` after the post-COMMIT death (the commander's ruling), with the comment naming why: the engine watcher only patches runs that are `queued`/`running`/`cancelling`.
- `cityColors.test.ts` gains `never collides with Single or Unmatched, the two modes it shares a layer with`, comparing every `RULE_PALETTE_HEX` entry against both `SINGLE_COLOR_HEX` and `UNMATCHED_COLOR_HEX` (the existing `CHROME` list covers highlight, hover and the surface palette, not these two).

### Verification

- `npx tsc -b --noEmit` → 0.
- `npx vp check` → **0 errors and 56 warnings** (baseline held; `Array.from` used for every listener sweep).
- Full app suite once, background, to a file: `suite: 0`, `282 passed | 4 skipped (286)` files, `3767 passed | 97 skipped` tests.
