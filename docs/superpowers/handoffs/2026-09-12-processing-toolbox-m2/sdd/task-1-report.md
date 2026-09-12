# Task 1 report — The DuckDB status subscription, and the hard rule that changes with it

Branch `develop`, based on `8102e78`. Status: **DONE**. Nothing is open: the pre-boot hazard
raised as concern 1 was fixed before review in `c22cb02` (see "Fix (pre-review)" at the end), and
the controller accepted the two documented one-line departures from the brief's verbatim code as
they stand. The brief's `useLayerCounts.test.tsx` carve-out was later WITHDRAWN by the controller
after the Codex review — see "Fix round 1", finding 2; every `vi.mock` of `insights/duckdb` in
`tests/` now carries the two keys.

## What was implemented

1. **`src/insights/duckdb.ts` became the publisher.** A module `statusListeners: Set<() => void>`
   and `statusVersion` counter, plus one internal `setStatus(next)` that assigns `status`,
   bumps the counter and notifies every listener. All four assignment sites now go through it:
   `doInit`'s `initializing`, `doInit`'s catch (`failed`), `publishReady()` (`ready`), and the
   new `"loading"` publish in `ensureExtension`. The `let status = { state: "uninitialized" }`
   initialiser stays a plain assignment (nothing can be listening at module evaluation).
   Two new exports: `subscribeDuckDBStatus(listener): () => void` and
   `getDuckDBStatusVersion(): number`.

2. **The `"loading"` transition is visible.** `ensureExtension` now sets
   `extensions[name] = { state: "loading" }` and publishes it (guarded on
   `status.state === "ready"`) _before_ awaiting `loadExtension`. It is deliberately NOT inside
   `loadExtension`, which `doInit` calls for `cityjson` before the first `publishReady()` — a
   publish there would mint a `ready` status mid-boot. The assignment inside `loadExtension`
   stays; the two are idempotent.

3. **`src/insights/useDuckDBStatus.ts` (new).** `useSyncExternalStore(subscribeDuckDBStatus,
getDuckDBStatusVersion, getDuckDBStatusVersion)` and then a plain `getDuckDBStatus()` read.
   It holds no copy. The snapshot is the version counter, not the status object, because 24 of
   the 26 test mock factories return a fresh literal per call and React rejects those as
   uncached snapshots.

4. **`App`'s mirror is gone.** `const duckdbStatus = useDuckDBStatus()` replaces
   `useState<DuckDBStatus>`; both `setDuckdbStatus` call sites in the boot effect and the whole
   optimistic pair in `handleRetryDuckDB` are deleted; both now just `void retryEngine()`.
   `retryEngine()` remains the door to the engine on boot and on Retry (CLAUDE.md, unchanged).

5. **The processing panel subscribes.** `useEligibilityInputs` returns
   `status: useDuckDBStatus()` instead of `getDuckDBStatus()`, and the head comment (which said
   the subscription "arrives with the executor (M2)") now states what the code does.

6. **CLAUDE.md:116 rewritten** to the owner-approved text, in the same commit as the code, and
   the story appended to the M13.1 section of `docs/architecture-notes.md`.

## TDD evidence

**RED (Step 2)** — `npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx`, with only the
test file present:

```
 FAIL  tests/unit/insights/useDuckDBStatus.test.tsx [ tests/unit/insights/useDuckDBStatus.test.tsx ]
Error: Failed to resolve import "../../../src/insights/useDuckDBStatus" from
"tests/unit/insights/useDuckDBStatus.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

Exactly the intended reason: the hook module does not exist, and `duckdb.ts` exports neither
new function.

**Second RED, after the hook and the publisher existed but before the `URL` stub was reordered**
(see "Deviation" below): `TypeError: URL is not a constructor` — 9 failed.

**Targeted RED for Step 4** — with the two `"loading"` publish lines temporarily removed from
`ensureExtension` (restored immediately afterwards), to prove that step is load-bearing rather
than incidentally green:

```
 × announces a lazy load: loading, then loaded
 × announces a lazy FAILURE: loading, then failed, with the reason
 × lets a FAILED load be retried — the memo is cleared, not sticky
 Tests  3 failed | 6 passed (9)
```

**GREEN** — `npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx`:
`Test Files 1 passed (1) / Tests 9 passed (9)`.

## Tests and results

| Command                                                                                                                    | Result                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx`                                                              | 1 file, **9 passed**                                                                                                 |
| `npx vitest run tests/unit/insights tests/unit/ui/processing tests/unit/ui/table tests/unit/app`                           | 44 files, **591 passed**                                                                                             |
| `npx vitest run tests/unit/features/processing tests/unit/features/query tests/unit/features/stac tests/unit/ui/inspector` | 15 files, **219 passed**                                                                                             |
| `npx tsc -b --noEmit`                                                                                                      | clean, no output                                                                                                     |
| `npx vp check`                                                                                                             | **0 errors, 56 warnings** (baseline)                                                                                 |
| `npx vitest run` (full, background)                                                                                        | 235 files, **233 passed / 2 skipped**; **2843 tests passed**, 31 skipped (the pre-existing opt-in integration skips) |

No `The result of getSnapshot should be cached` error appeared anywhere, which is the signal
that no mock factory was missed.

## Mock factories edited (26 in `e4682f8`; 27 after Fix round 1)

Two keys added immediately above the existing `getDuckDBStatus` key in each, scripted so the
indentation matches the file:

```
tests/integration/duckdb/computedColumns.test.ts      (file idiom: () => () => {} / () => 0)
tests/integration/duckdb/layerTables.test.ts          (file idiom: () => () => {} / () => 0)
tests/unit/app/appCatalogEntry.test.tsx
tests/unit/app/appCityParquetLayers.test.tsx
tests/unit/app/appEngineBoot.test.tsx
tests/unit/app/appGeoOnly.test.tsx
tests/unit/app/appProcessingToast.test.tsx
tests/unit/app/appRestoreShare.test.tsx
tests/unit/app/appViewerShell.test.tsx
tests/unit/features/processing/runQueue.test.ts
tests/unit/features/processing/scope.test.ts
tests/unit/features/query/mapFilterSync.test.ts
tests/unit/features/stac/stacItems.test.ts
tests/unit/insights/computedColumns.test.ts
tests/unit/insights/exportAttributes.test.ts
tests/unit/insights/exportCityParquet.test.ts
tests/unit/insights/layerTablesBuild.test.ts
tests/unit/insights/layerTablesQueue.test.ts
tests/unit/ui/inspector/StatsTabDuckdb.test.tsx
tests/unit/ui/processing/CatalogueView.test.tsx
tests/unit/ui/processing/ProcessingPanel.test.tsx
tests/unit/ui/processing/ToolView.test.tsx
tests/unit/ui/processing/useToolForm.test.tsx
tests/unit/ui/table/ExportDialog.test.tsx
tests/unit/ui/table/TablePanel.test.tsx
tests/unit/ui/table/useLayerQuery.test.tsx
```

The other 24 got `subscribeDuckDBStatus: vi.fn(() => () => {})` and
`getDuckDBStatusVersion: vi.fn(() => 0)`.

**Verification of the brief's list (controller ruling b).** `grep -rl 'insights/duckdb"' tests`
returns 30 files; `grep -rln 'vi\.mock(\s*"[^"]*insights/duckdb"' tests` returns 27. The four
extras over the brief's 26 were each checked by hand and correctly excluded:

- `tests/unit/insights/duckdbEngine.test.ts` — imports the REAL module and mocks the
  `@duckdb/duckdb-wasm` package (no `vi.mock` of `insights/duckdb`).
- `tests/unit/insights/duckdbStatus.test.ts` — imports the real module.
- `tests/unit/ui/StatusBarDuckdb.test.tsx` — `import type { DuckDBStatus }` only.
- `tests/unit/ui/table/useLayerCounts.test.tsx` — mocks `insights/duckdb` with a single
  `runQuery` key, no `getDuckDBStatus`, and renders nothing that reaches the hook. Left alone,
  as the brief instructs; the suite passes.

So the brief's list of 26 was right for `e4682f8`. The Codex review then withdrew the
`useLayerCounts.test.tsx` carve-out, which makes it 27 — see "Fix round 1", finding 2.

## Deviation from the brief (one, mechanical)

The brief's `beforeEach` stubs `URL` **before** `vi.resetModules()` + the two dynamic imports.
That fails: vitest's own module runner calls `new URL(...)` while resolving a dynamic import and
the object stub (`{...URL, createObjectURL, revokeObjectURL}`) is not constructible —
`TypeError: URL is not a constructor`, 9 failed. `tests/unit/insights/duckdbEngine.test.ts:74-78`
already documents this exact hazard and solves it the same way. The two stub statements were
therefore reordered so `URL` is stubbed after the imports, with a comment citing that precedent.
No assertion, fake or value was changed. This was judged an in-repo-precedented ordering fix
rather than a NEEDS_CONTEXT: nothing about `duckdb.ts` under jsdom is uncovered by the brief's
fake, and every transition the brief asserts is asserted unchanged.

One further micro-change, forced by the lint baseline: `setStatus` iterates
`Array.from(statusListeners)` rather than the brief's `[...statusListeners]`, because the spread
form trips `unicorn(no-useless-spread)` and pushed the warning count to 57 (baseline 56). The
copy itself is kept deliberately — a listener may unsubscribe from inside its own notification —
and a comment says so.

## Self-review findings

- **No second publisher and no second React copy.** `grep -rn "getDuckDBStatus\b" src/` leaves
  only `stacItems.ts:226`, `layerTables.ts:626,817,892` (imperative non-React guards, not
  component state) and the hook itself. `useState<DuckDBStatus>` no longer appears in `src/`.
- **Sole-importer rule intact.** `@duckdb/duckdb-wasm` is imported only by
  `src/insights/duckdb.ts`; the new test mocks the _package_, which is a test-side mock, not a
  second `src/` importer.
- **Controller ruling (c) honoured.** Neither the new App comment nor the architecture note
  claims the status-bar Retry reboots a ready engine; both state only that `initDuckDB` does not
  re-run a boot that already succeeded, which is why the old optimistic
  `setDuckdbStatus({state:"initializing"})` made a healthy engine read "Loading". Nothing
  mentions cancellation.
- `handleRetryDuckDB`'s surviving doc comment was re-read: it says `retryEngine` awaits
  `initDuckDB`, which clears its memo on failure, and then rebuilds refused tables. Still true.
- `useEligibilityInputs` calls the hook unconditionally inside its return expression; rules-of-
  hooks lint is clean.
- First paint now renders `uninitialized` for one frame before `doInit` publishes `initializing`
  (the boot effect runs after the first render). Previously the mount set `initializing`
  optimistically, also after first render — so the visible behaviour is unchanged.

## Concerns

- **Step 4 introduced a latent pre-boot hazard. FIXED in `c22cb02` — see "Fix (pre-review)".**
  The rest of this bullet is the history of why, as it stood when the concern was raised.
  `loadExtension` returns `false` at `if (!connection) return false` **before** its own
  `loading` write, so `ensureExtension` on a not-yet-booted engine used to be a complete no-op.
  It is not any more: the new `extensions[name] = { state: "loading" }` lands _before_ that
  check, and `loadExtension` then bails without writing `failed` — leaving `spatial`/`three_d`
  pinned at `loading` with nothing to move them, and the boot's own `publishReady()`
  subsequently publishing that stale `loading`. §6.1's chip would read "Loading the spatial
  extension…" indefinitely, until some later `ensureExtension` call happened to self-heal it.
  Unreachable in this milestone (`ensureExtension` still has no caller, and Task 2's caller runs
  inside `runOnTableQueue`, i.e. against a READY engine), so the brief's block was committed
  verbatim in `e4682f8` and the hazard raised rather than second-guessed. The controller ruled it
  fixed before review; `c22cb02` guards the write and its publish on `conn !== null`, the same
  condition `loadExtension` bails on, with a regression test.
- **App re-renders on every engine transition now**, including each lazy extension load, where
  before it re-rendered twice per boot. The transitions are rare (boot, at most two lazy loads
  per session) and `App` re-renders for far more than this already, so this is noted rather than
  mitigated.
- A design hook flagged `src/app/brand.css` (`design-system-font`: the brand's `Outfit` face is
  not declared in a DESIGN.md) on every edit in this session. That file is untouched by this
  task and `CLAUDE.md` makes `brand.css` the source of the brand's tokens, so nothing was
  changed and no ignore was persisted. It is left standing for the owner.

## Files changed

```
CLAUDE.md                                   (the hard rule, line 116)
docs/architecture-notes.md                  (M13.1 section: the M13.2 note)
src/insights/duckdb.ts                      (publisher: setStatus, subscribe, version, loading publish)
src/insights/useDuckDBStatus.ts             (new)
src/app/App.tsx                             (mirror deleted; both retry paths simplified)
src/ui/processing/useEligibilityContext.ts  (subscribed read + head comment)
tests/unit/insights/useDuckDBStatus.test.tsx (new, 9 tests)
26 test files                               (two mock keys each)
```

## Commits

`e4682f8` — feat(insights): publish the DuckDB status and read it through one hook

`c22cb02` — fix(insights): a pre-boot ensureExtension publishes nothing (the "Fix (pre-review)"
section below has its RED/GREEN evidence)

Two commits, on `develop` — 33 files (+383 / -31) and 2 files (+30 / -2) — staged by explicit
path; no trailers. Not pushed. The pre-commit hook (`vp staged`) ran clean. `.github/hooks/` and `docs/design-history/`
were left untracked and untouched.

---

## Fix (pre-review)

The controller ruled concern 1 fixed before review: `ensureExtension` on a not-yet-booted engine
must stay a no-op that publishes nothing.

**The fix.** The `loading` write Step 4 added to `ensureExtension` is now guarded on `conn !==
null` — the SAME condition `loadExtension` bails on — together with the `publishReady()` beside
it. Without a connection nothing is written and nothing is published, so no `loading` can outlive
a boot. `ensureExtension` still returns `false` in that case, exactly as before.

**RED** — the new test `publishes NOTHING when asked before the engine has booted` calls
`ensureExtension("spatial")` before `initDuckDB()` and asserts no listener fired, the version is
still 0, `getDuckDBStatus()` is still `{ state: "uninitialized" }`, and that a later successful
boot does not publish `spatial: loading`. Command:

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx
```

```
 FAIL  … > duckdb.ts publishes every transition > publishes NOTHING when asked before the engine has booted
AssertionError: expected 'loading' to be 'unloaded' // Object.is equality
Expected: "unloaded"
Received: "loading"
 ❯ tests/unit/insights/useDuckDBStatus.test.tsx:191:45
 Tests  1 failed | 9 passed (10)
```

The first three assertions passed even before the fix — the `loading` write alone does not bump
the version, because the `publishReady()` beside it is already guarded on `status.state ===
"ready"`. The leak the bug actually produced is the fourth: the stale `loading` riding into the
status the BOOT publishes. That is what went red, which is the intended reason.

**GREEN** — same command: `Test Files 1 passed (1) / Tests 10 passed (10)`.

**Re-verified after the fix:** `npx vitest run tests/unit/insights tests/unit/ui/processing
tests/unit/app` → 32 files, 440 passed. Full suite re-run (background):
`Test Files 233 passed | 2 skipped (235)`, `Tests 2844 passed | 31 skipped (2875)` — one more
test than the first run, which is the new regression test. `npx tsc -b --noEmit` clean.
`npx vp check` → 0 errors, 56 warnings (baseline).

Concerns 2 and 3 were accepted as-is by the controller at this point: the two documented
departures stand. (The `useLayerCounts.test.tsx` carve-out was withdrawn later, in "Fix round 1".)

**Commit:** `c22cb02` — fix(insights): a pre-boot ensureExtension publishes nothing
(`src/insights/duckdb.ts`, `tests/unit/insights/useDuckDBStatus.test.tsx`; staged by path, no
trailers, not pushed).

---

## Fix round 1 (Codex review: Needs fixes)

Worked on top of `788f9da` (Task 2's `runQueue.ts`); nothing rebased. Covering tests for the
whole round:

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx tests/unit/ui/table/useLayerCounts.test.tsx
```

### Finding 1 — a throwing subscriber could break engine work

**Change:** `src/insights/duckdb.ts:103-119` — `setStatus` now notifies each listener inside its
own `try`, reporting a throw with `console.error("A DuckDB status listener threw:", error)` (the
module's existing idiom, beside `console.error("DuckDB-wasm initialization failed:", err)`) and
carrying on to the next listener. The dispatch is still over a copy of the set.

**Covering tests** (`tests/unit/insights/useDuckDBStatus.test.tsx`), two new:

- `isolates a THROWING listener: the boot finishes and the others still hear it` — a throwing
  subscriber registered first, then a recording one; the boot must reach `ready` and the second
  subscriber must see both transitions, with the throw reported through `console.error`.
- `isolates a THROWING listener on the FAILURE path: the Worker still dies` — the fake now
  supports `failInstantiate`, which fails the boot AFTER the Worker exists (the pre-existing
  `failBundle` rejects in `selectBundle`, before one is created, so it cannot exercise the
  cleanup at all). Asserts `state === "failed"`, `terminations.count === 1` (the Worker was
  terminated) and that a following `initDuckDB()` reaches `ready` (the memo was reset).

**RED:**

```
 × isolates a THROWING listener: the boot finishes and the others still hear it
 × isolates a THROWING listener on the FAILURE path: the Worker still dies
Error: listener exploded
 ❯ setStatus src/insights/duckdb.ts:106:55
 ❯ doInit src/insights/duckdb.ts:232:3
 ❯ Module.initDuckDB src/insights/duckdb.ts:296:19
 Tests  2 failed | 10 passed (12)
```

Exactly the reviewer's mechanism: the exception escapes the `initializing` publish, which sits
BEFORE `doInit`'s try, so the boot aborts and the status is stranded.

**GREEN:** `Test Files 1 passed (1) / Tests 12 passed (12)`.

### Finding 2 — `useLayerCounts.test.tsx`'s factory (carve-out withdrawn)

**Change:** `tests/unit/ui/table/useLayerCounts.test.tsx:5-12` — the factory now exports
`subscribeDuckDBStatus: () => () => {}` and `getDuckDBStatusVersion: () => 0` beside `runQuery`,
in the file's own plain-arrow idiom, with a comment saying why every factory carries them.

**RED/GREEN:** none is reachable, and the report should not pretend otherwise. This file renders
only `useLayerCounts`, which never reaches the hook, so it passed before the change and passes
after (`14 passed` across the two covering files). The fix is uniformity: the next component that
file's suite happens to render would fail the WHOLE file. The message was verified rather than
guessed: dropping the key from `CatalogueView.test.tsx`'s factory (its suite does render the
hook) gives `Error: [vitest] No "subscribeDuckDBStatus" export is defined on the
"../../../../src/insights/duckdb" mock. Did you forget to return it from "vi.mock"?` — 8 of 8
tests failed — restored immediately afterwards. It is NOT React's "getSnapshot should be cached",
which the version-counter snapshot rules out whatever a mock returns; the test comment says the
verified message. Every `vi.mock` of `insights/duckdb` in `tests/` now carries both keys. Re-verified AFTER
`788f9da` landed (Task 2 could have added a factory), not reused from the earlier count:

```bash
for f in $(grep -rln 'vi\.mock(\s*"[^"]*insights/duckdb"' tests); do
  grep -q subscribeDuckDBStatus "$f" && grep -q getDuckDBStatusVersion "$f" || echo "MISSING $f"
done
# (no output) — 27 factories, all complete
```

### Finding 3 (minor) — the unmount test asserted nothing about cleanup

**Change:** `tests/unit/insights/useDuckDBStatus.test.tsx` — `stops listening when the component
unmounts` now wraps `subscribeDuckDBStatus` with `vi.spyOn`, keeps the real subscription and
records the unsubscribe React is handed. It asserts no unsubscribe has run while mounted, and
that every one has run exactly once after `view.unmount()`. The old "the module still works"
assertion is kept as the tail.

**Proof it is load-bearing** (the assertion passes against correct code, so it was verified by
breaking the hook instead): with `useDuckDBStatus` temporarily leaking its subscription
(`subscribeDuckDBStatus(listener); return () => {};`), the test fails —

```
 × stops listening when the component unmounts
AssertionError: expected false to be true // Object.is equality
```

— and passes again with the hook restored.

### Finding 4 (minor) — the copied-Set comment was inaccurate

**Change:** `src/insights/duckdb.ts:103-105`. The old comment claimed deleting an entry would
"silently skip the listener that happens to follow it", which is not how `Set` iteration behaves.
It now says what the copy actually buys: the dispatch's membership is frozen, so a listener that
subscribes or unsubscribes from inside its own notification changes who hears the NEXT
transition, never who hears the one in flight.

### Verification

| Command                                                               | Result                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npx vitest run …/useDuckDBStatus.test.tsx …/useLayerCounts.test.tsx` | 2 files, **14 passed**                                                                                  |
| `npx tsc -b --noEmit`                                                 | clean                                                                                                   |
| `npx vp check`                                                        | **0 errors, 56 warnings** (baseline; `vp check --fix` reformatted one long expectation in the new test) |
| `npx vitest run` (full)                                               | 235 files, **233 passed / 2 skipped**; **2849 passed**, 31 skipped                                      |

**Commit:** `cc1e345` — fix(insights): a status listener that throws cannot break engine work
(`src/insights/duckdb.ts`, `tests/unit/insights/useDuckDBStatus.test.tsx`,
`tests/unit/ui/table/useLayerCounts.test.tsx`; staged by path, no trailers, not pushed).
