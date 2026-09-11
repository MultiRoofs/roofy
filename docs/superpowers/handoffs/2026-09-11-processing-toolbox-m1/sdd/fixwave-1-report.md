# Fix wave 1 — implementation report (M13.1)

Branch `develop`, base `95256ec`. Every item below was done red-first: the test
(or the amended assertion) was written, run, and watched fail for the intended
reason before the change that makes it pass.

Environment for every run: `export PATH="$HOME/.local/share/mise/shims:$PATH"`,
then `npx vitest run <paths>` from the repo root.

## Commits, in order

| SHA       | Subject                                                                           | Item   |
| --------- | --------------------------------------------------------------------------------- | ------ |
| `55ec9fa` | fix(processing): a part's height is its own extent, the building's is the roll-up | M6     |
| `f5e7a28` | test(processing): a bbox-less PART is NULL beside its measured siblings           | T2     |
| `29f16a0` | fix(processing): the run footer's button reads "Cancel", as the spec writes it    | m11    |
| `6017357` | fix(processing): OUTPUT opens with "Write to · This layer (…)"                    | m10    |
| `ea5ed1c` | fix(processing): Style by result's draft arrives named after its column           | S1     |
| `28abcb4` | fix(shell): the details chevron is live while the toolbox holds the panel         | S2     |
| `630172f` | fix(shell): a collapsed pill expands the panel on the tab it names                | m8     |
| `9cda7e7` | fix(processing): a cancel during the write rolls back instead of committing       | M1, T4 |
| `bbb7c92` | fix(processing): Retry repeats the run the queue froze, ids and all               | M4, T3 |
| `a3bad44` | fix(processing): removing a layer stops the run that targets it                   | M2     |
| `3869c98` | fix(processing): collisions are checked the way DuckDB reads names                | M5     |
| `add54eb` | test(processing): the undo-race test waits for the SECOND run, not the log        | T1     |
| `5668b08` | test(processing): the error-notice test uses the real DuckDB formatter            | T5     |

---

## M1 — a cancel during the write must not commit

**Changed**

- `src/insights/computedColumns.ts:110` — `WriteInput.signal?: AbortSignal`, with
  the reason it is read exactly once.
- `src/insights/computedColumns.ts:114-120` — `WriteOutcome`'s failure variant gains
  `cancelled?: true`.
- `src/insights/computedColumns.ts:171-195` — COMMIT moved OUT of the statement
  loop; `signal.aborted` is checked immediately before it and issues ROLLBACK,
  returning `{ ok: false, cancelled: true, message: "Cancelled" }`. A failing
  COMMIT still rolls back and reports its message.
- `src/features/processing/runQueue.ts:484` — the run's `signal` is handed to
  `writeComputedColumns`; `runQueue.ts:495-497` maps a cancelled outcome to
  `CancelledError` (status `cancelled`), anything else to an error.

No separate `DROP TABLE` for the backup: the CTAS is inside the transaction and
DuckDB's DDL is transactional, so the ROLLBACK is what removes it — the same
mechanism the pre-existing failure path already relied on. The unit test asserts
ROLLBACK is the LAST statement, so "the backup table is gone" is pinned.

**Tests**

- `tests/unit/insights/computedColumns.test.ts` — "rolls back instead of
  committing when the run was cancelled"; "commits a write whose cancel arrived
  after the last statement".
- `tests/unit/features/processing/runQueue.test.ts` — "a cancel during the write
  › rolls the transaction back and publishes nothing" (T4: gates the UPDATE,
  cancels while it is pending, releases it, then asserts ROLLBACK issued, COMMIT
  not issued, the fake table's columns unchanged, no model attribute, an empty
  provenance registry, status `cancelled`, no error). The queue's duckdb fake now
  honours ROLLBACK (restores the columns recorded at BEGIN), so "nothing was
  published" is a claim the test can check.

**RED** `npx vitest run tests/unit/insights/computedColumns.test.ts` →
`AssertionError: expected { ok: true, backupTable: '__undo_r3' } to deeply equal
{ ok: false, cancelled: true, …(1) }`, 1 failed | 15 passed.
For the queue test, with `src/insights/computedColumns.ts` and
`src/features/processing/runQueue.ts` stashed:
`npx vitest run …/runQueue.test.ts -t "cancel during the write"` →
`AssertionError: expected 'done' to be 'cancelled'`, 1 failed | 21 skipped.

**GREEN** `npx vitest run tests/unit/insights/ tests/unit/features/processing/` →
22 files, 341 passed.

---

## M2 — removing a target stops its run

**Changed**

- `src/features/processing/runQueue.ts:294-304` — `failedAlready(id)`: the one
  thing that can fail a run from outside is the removal watcher, and its reason
  outranks the plain cancel its abort would otherwise produce.
- `src/features/processing/runQueue.ts:401` and `:597` — the two overwrite sites
  (the pre-executor abort check and the catch) now defer to it.
- `src/features/processing/runQueue.ts:700-760` — `installTargetRemovalWatcher()`:
  a single-live installer (disposes an earlier install, the
  `installRuleDraftInvariants` shape) that subscribes to `useLayerStore`, ignores
  writes that did not change the layer LIST, and for every queued / running /
  cancelling run whose `targetLayerId` is gone patches
  `{ status: "failed", phase: null, error: "Layer removed", elapsedMs }` and THEN
  aborts its controller (the patch is synchronous, the executor's rejection is a
  microtask — so the order is unambiguous).
- `src/app/App.tsx:75` / `:850` — installed once, next to
  `installRuleDraftInvariants`, as the brief directs.

**Tests** `tests/unit/features/processing/runQueue.test.ts` —
"fails a QUEUED run whose target was removed, before it can start" (executor
never called), "aborts a RUNNING run whose target was removed and says why"
(the executor's own signal is aborted, the card reads failed/"Layer removed"
after the rejection lands, and no transaction was opened), "leaves finished runs
and other layers' runs alone".

**RED** `npx vitest run …/runQueue.test.ts -t "TargetRemoval"` →
`TypeError: installTargetRemovalWatcher is not a function`, 3 failed | 24 skipped.

**GREEN** `npx vitest run tests/unit/app tests/unit/features/processing` →
14 files, 144 passed.

---

## M4 — Retry repeats the FROZEN request

**Changed**

- `src/features/processing/runQueue.ts:126-138` — `frozenById`, a module
  `Map<runId, FrozenRequest>`; nothing persists, and an entry is deleted in
  `submitRun`'s eviction diff beside `discardUndo` (`runQueue.ts:255-262`), so a
  card and its frozen request leave together.
- `src/features/processing/runQueue.ts:190-232` — `submitRun` (`:190`) freezes and calls
  the new `queueRun`; `retryRun(runId): string | null` re-queues the stored
  request with its ORIGINAL snapshot and a freshly read `tableName` (a Re-run
  after a rebuild must target the table that is there now, or it would refuse
  itself with "Layer changed while running").
- `src/ui/processing/RunFooter.tsx:353` — Retry calls `retryRun(run.id)`.
- `src/ui/processing/RecentRuns.tsx:56` — Retry and Re-run call `retryRun(run.id)`.
- `src/ui/processing/useToolForm.ts:47-60` — `requestFromRun` stays, its doc
  corrected: it is the record-only view and is NOT on the retry path.

**Tests**

- `tests/unit/features/processing/runQueue.test.ts` — "retries a failed run on the
  ids it froze, not on today's selection" (T3: a `selected`-scope run over `a`
  fails, the selection moves to `other`, `retryRun` resolves `"id" IN ('a')`, the
  executor sees `["a"]`, and the new id differs); "has nothing to retry for a run
  it never froze".
- `tests/unit/ui/processing/ToolView.test.tsx` — "retries a failed run with its
  FROZEN parameters, not the draft" now asserts `retryRun("r1")` and that
  `submitRun` was not called.
- `tests/unit/ui/processing/RecentRuns.test.tsx` — Retry and Re-run assert
  `retryRun("r1")`. All three runQueue mock factories export `retryRun`.

**RED** `npx vitest run …/runQueue.test.ts -t "retr"` →
`TypeError: retryRun is not a function`, 2 failed | 22 skipped.

**GREEN** `npx vitest run tests/unit/ui/processing/` → 7 files, 72 passed;
`npx vitest run …/runQueue.test.ts` → 24 passed.

---

## M5 — collisions read the way DuckDB reads names

**Changed**

- `src/ui/processing/useToolForm.ts:151-169` — (a) the "existing" and source
  collision checks compare lower-cased; the map keeps the TABLE's spelling, which
  is what the error names (`'extent_height_m' belongs to the source data; choose
another prefix`).
- `src/features/processing/runQueue.ts:344-369` — (b) at the queue head, after the
  table re-validation and before the executor, the run's output columns are
  re-checked case-insensitively against the table's columns MINUS the layer's
  computed-column registry; a hit fails the run with the spec's prefix message
  naming the table's spelling.
- `src/features/processing/runQueue.ts:465-475` — the write's `existing` set is
  built case-insensitively from the RESULT's columns. Without it, (a)+(b) leave a
  hole: `EXTENT_height_m` over a COMPUTED `extent_height_m` passes both checks,
  the form says "will be replaced", and a case-sensitive `existing` would classify
  it as created — so this run's Undo would `DROP COLUMN` a column it never made.

**Tests**

- `tests/unit/ui/processing/ToolView.test.tsx` — "rejects a prefix that collides
  in DuckDB's eyes, whatever its case".
- `tests/unit/features/processing/runQueue.test.ts` — "refuses at the head a
  column that now belongs to the source data" (executor not called, no
  transaction); "replaces a COMPUTED column whose case differs, rather than
  creating it" (the backup CTAS is issued).
- Same file: a `computedAlready(column)` helper. Three existing tests put a
  column on the fake table and ran over it without registering provenance —
  under the new head check that IS a source column, so they now say what they
  meant ("a run over a column an earlier run wrote") through the registry.

**RED** `npx vitest run …/ToolView.test.tsx -t "DuckDB's eyes"` → `Unable to find
an element with the text: 'extent_height_m' belongs to the source data; …`,
1 failed | 32 skipped. `npx vitest run …/runQueue.test.ts -t "source data"` →
`AssertionError: expected 'done' to be 'failed'`; `-t "case differs"` →
`AssertionError: expected false to be true`.

**GREEN** `npx vitest run tests/unit/ui/processing tests/unit/features/processing
tests/unit/insights` → 29 files, 421 passed.

---

## M6 — a part's own extent

**Changed** `src/features/processing/tools/heightFromExtent.ts:11-21` (the header
paragraph that claimed every member row gets the feature's values) and `:84-160`:
`rollUpExtents` keeps the per-feature roll-up for the ROOT row (`row.id === row.f`,
which is how `buildExtentSql`'s `COALESCE("feature_id", "id")` answers), gives each
PART its own `zmax - zmin` / `zmin` / `zmax`, NULLs all three for a member with no
bbox, and counts measured/skipped per FEATURE exactly as before.

**Tests** `tests/unit/features/processing/heightFromExtent.test.ts` — "gives the
ROOT the feature's roll-up and each PART its own extent" (T2: a root plus two
parts whose extents differ from it and from each other, plus a bbox-less part
asserted NULL) and "nulls a PART with no bbox without skipping its feature".

**RED** `npx vitest run …/heightFromExtent.test.ts` → 2 failed | 11 passed, e.g.
`expected { extent_height_m: 8.5, … } to deeply equal { extent_height_m: 5, … }`
for the part row. The T2 extension was re-checked against the pre-fix source
(`git show HEAD~1:…/heightFromExtent.ts`): both tests fail, 2 failed | 11 passed.

**GREEN** `npx vitest run …/heightFromExtent.test.ts` → 13 passed.

---

## m8 — each collapsed pill opens its own tab

**Changed** `src/ui/shell/ViewerShell.tsx:33-40` — `expandOnTab(tab)` sets the
processing store's tab and then un-collapses; `:128-155` — the Tools pill passes
`"tools"`, the Details pill `"details"`.

**Test** `tests/unit/ui/shell/ViewerShell.test.tsx` — "each pill expands the panel
on the tab it names".

**RED** `npx vitest run …/ViewerShell.test.tsx -t "pill expands"` →
`AssertionError: expected 'tools' to be 'details'`, 1 failed | 24 skipped.
**GREEN** `npx vitest run tests/unit/ui/shell/` → 4 files, 63 passed.

---

## m10 — OUTPUT starts with "Write to"

**Changed** `src/ui/processing/ToolView.tsx:183-201` — a `Write to` field before
Prefix, holding one radio (`role="radiogroup"`, `aria-label="Write to"`) reading
`This layer (<target name>)`, `checked readOnly disabled`. New layer is a later
milestone and is not rendered.

**Test** `tests/unit/ui/processing/ToolView.test.tsx` — "opens OUTPUT with Write
to, on the target, with no other destination" (checked, disabled, and no
`New layer` radio).

**RED** → `Unable to find an accessible element with the role "radio" and name
"This layer (Delft)"`, 1 failed | 31 skipped. **GREEN** 7 files, 72 passed, no
React controlled-input warning.

---

## m11 — the button reads "Cancel"

**Changed** `src/ui/processing/RunFooter.tsx:203-212` and `:223-229` — the
progress block's and the queued footer's buttons read `Cancel` with
`aria-label="Cancel run"` (which is how every existing test reaches them, and
what distinguishes them from the idle footer's Cancel).

**Tests** the two existing ToolView cases now assert
`expect(screen.getByRole("button", { name: "Cancel run" })).toHaveTextContent(/^Cancel$/)`.

**RED** `npx vitest run …/ToolView.test.tsx` → 2 failed | 29 passed
(`expect(element).toHaveTextContent()`). **GREEN** 7 files, 71 passed.

---

## S1 — Style by result's draft is saveable

**Changed** `src/ui/processing/RunFooter.tsx:129-143` — the draft's `name` is the
column it styles (`extent_height_m`) instead of `""`.

**Test** `tests/unit/ui/processing/ToolView.test.tsx` — "opens STYLE on a rule
DRAFT over the run's first column" now expects that name.

**RED** `npx vitest run …/ToolView.test.tsx -t "rule DRAFT"` → 1 failed | 31
skipped. **GREEN** 7 files, 72 passed.

---

## S2 — the collapse chevron in a toolbox-only session

**Changed** `src/ui/header/WorkspaceHeader.tsx:18-27` (the doc paragraph),
`:77` (`toolboxOpen` from the processing store) and `:198`
(`disabled={!hasSelection && !toolboxOpen}`).

**Test** `tests/unit/ui/header/WorkspaceHeader.test.tsx` — "stays live with the
toolbox open and nothing selected"; the suite's `beforeEach` now resets the
processing store, which this header reads.

**RED** `npx vitest run …/WorkspaceHeader.test.tsx` → 1 failed | 23 passed
(the button is disabled, so the click changes nothing). **GREEN** 3 files, 34
passed.

---

## T1 — the undo-race test waits for the second run

**Changed** `tests/unit/features/processing/runQueue.test.ts` ("does not undo a
run whose Undo was taken away while the undo queued"): the recorded SQL is
cleared BEFORE run 2 is submitted (run 1's own COMMIT was still in it, so the
wait returned instantly), the wait is on run 2's gated COMMIT, and the test now
asserts `runById(second)?.status === "running"` before pressing Undo.

**Evidence** with the head re-validation in `undoRun` removed (`const current =
runById(id); if (!current?.undoable || !undoState.has(id)) return null;`), the
test fails: `AssertionError: expected true to be false` — the restore from
`__undo_run_1` is issued. With the guard back: 29 passed. (Removing only the
`current?.undoable` half is not enough: `undoState.has(id)` is the other half of
the same guard, and the two have to go together.)

**On the finding's severity.** "Passes hollow" was overstated. I ran the OLD
wait against the same guard-removed build and it ALSO failed — the undo is
queued behind run 2 in the FIFO either way, so the race was still exercised.
What the old wait could not do was prove WHEN the Undo was pressed; the
strengthened version asserts run 2 is `running` at that moment, which is the
thing the test claims to be about. The change is right, the finding was
imprecise rather than hollow.

---

## T5 — the error-notice test uses the production formatter

**Changed** `tests/unit/ui/processing/ToolView.test.tsx` — the local
`formattedDuckDBError` replica is deleted; the duckdb mock factory takes the one
pure export from the real module via `vi.importActual` and the test imports
`formatDuckDBError` from the mocked module. Everything else stays faked.

**Evidence** with `formatDuckDBError` in `src/insights/duckdb.ts` changed to keep
only the first kept line, "says why when the median query fails, and opens no
draft" fails (1 failed | 32 passed); the old replica would not have noticed.
Restored: 33 passed.

---

## Final checks

- `npx tsc -b --noEmit` — clean (run before every commit, and at the end).
- `npx vp check` — `Found 0 errors and 56 warnings in 509 files` (the
  pre-existing baseline; none added).
- Full suite, `npx vitest run` (background, log at
  `…/scratchpad/full-suite.txt`) — `Test Files 232 passed | 2 skipped (234)`,
  `Tests 2817 passed | 29 skipped (2846)`, 61 s. The milestone's baseline was
  2801 passing; the 16 new ones are this wave's.
- Working tree clean apart from the untracked `.github/hooks/` and
  `docs/design-history/`, which were left alone. Nothing pushed.

## Files changed

`src/features/processing/runQueue.ts`,
`src/features/processing/tools/heightFromExtent.ts`,
`src/insights/computedColumns.ts`, `src/ui/processing/ToolView.tsx`,
`src/ui/processing/RunFooter.tsx`, `src/ui/processing/RecentRuns.tsx`,
`src/ui/processing/useToolForm.ts`, `src/ui/shell/ViewerShell.tsx`,
`src/ui/header/WorkspaceHeader.tsx`, `src/app/App.tsx`,
`tests/unit/features/processing/runQueue.test.ts`,
`tests/unit/features/processing/heightFromExtent.test.ts`,
`tests/unit/insights/computedColumns.test.ts`,
`tests/unit/ui/processing/ToolView.test.tsx`,
`tests/unit/ui/processing/RecentRuns.test.tsx`,
`tests/unit/ui/processing/useToolForm.test.tsx`,
`tests/unit/ui/shell/ViewerShell.test.tsx`,
`tests/unit/ui/header/WorkspaceHeader.test.tsx`.

## Concerns

1. ~~`requestFromRun` has no caller left in `src/`.~~ **Closed** by the
   controller's ruling: removed in `c92e751`, with its only helper
   (`asColumns`) and the two type imports that served it. No test referenced
   it; `retryRun`'s coverage is untouched.
2. **The app's own bookkeeping is still keyed case-SENSITIVELY.** With M5 in
   place, a run with prefix `EXTENT_` over a computed `extent_height_m` correctly
   REPLACES the table column (one column, in DuckDB's eyes), but everything the
   app keys by column NAME now holds two entries:
   `useComputedColumnStore` keeps both `extent_height_m` and `EXTENT_height_m`
   (two badges, and the older entry never expires), and `mergeAttributes` /
   `previousModelValues` (`runQueue.ts:503-517`) write the new spelling into the
   model beside the stale old one — so that run's Undo restores the `EXTENT_`
   key and leaves the `extent_` value behind. Same root cause, three symptoms.
   The brief asked only for the checks, so this is recorded, not fixed; the fix
   is to key the registry and the model merge by the TABLE's spelling.
3. **`writeComputedColumns` reads the signal once, before COMMIT.** There is no
   statement-level cancel in DuckDB, so a cancel arriving during a long UPDATE
   still waits for that UPDATE to finish before the ROLLBACK goes out. The card
   says `cancelling` throughout, which is what §6.1 describes, but the wait is
   real on a large layer.
4. **The target-removal watcher covers the TARGET only.** §6.1 also names the
   SOURCE layer; no M1 tool has one, so there is nothing to watch yet.
5. **M5(b) hardens a pre-existing trap rather than creating one.** Verified
   premise: `flatRowsFromModel` (`src/insights/layerRows.ts:153-166`) builds the
   table's rows from `object.attributes`, which carry the computed values after
   a run's `mergeAttributes`. `installStaleWatcher` calls `clearLayer` on every
   rebuild — so after a streaming settle (or §6.1's engine restart) the rebuilt
   table HAS `extent_height_m` while the registry is empty, and that column then
   reads as the source's. The form already refused the prefix in that state;
   with (b), Re-run refuses it at the head too, with the same sentence. Not
   introduced by this wave and out of its scope, but it is the case where the
   new message will be seen most.
6. ~~The "Write to" radio was not checked in a real browser.~~ **Closed** —
   see the re-check below.

---

## Closing items (after the first report)

### 1. `requestFromRun` removed — `c92e751`

`refactor(processing): drop requestFromRun, which nothing calls any more`.
`src/ui/processing/useToolForm.ts` loses the function, its `asColumns` helper
and the now-unused `RunRecord` / `RunRequest` type imports. Nothing referenced
it (`grep -rn "requestFromRun\|asColumns" src tests` → only its own
definition). `npx tsc -b --noEmit` clean, `npx vp check` 0 errors / 56
warnings, `npx vitest run tests/unit/ui/processing` → 7 files, 73 passed.

### 2. Browser re-check of spec §10 scenario 1 — `2a8fa2f`

`docs(smoke): record the post fix-wave browser re-check`, appended to
`scripts/smoke/processing-m1.md` as "Post fix-wave re-check — 2026-09-11".
Driven with `agent-browser connect 9333` against a hand-launched Playwright
Chromium (SwiftShader, 2 fps) on the dev server already running at
`http://127.0.0.1:5200`; `fixtures/two-buildings.city.json` through the file
input. The Chromium I launched was killed afterwards (`pgrep -fa
remote-debugging-port=9333` → nothing); the dev server was left running.

**5 of 5 checks pass.**

1. `Write to · This layer (two-buildings.city.json)`, the input reporting
   `{checked: true, disabled: true}` and no `New layer` radio.
2. The progress block's button reads `Cancel` (accessible name still
   `Cancel run`), sampled at 1.2 / 2.5 / 5.5 / 7.3 s, then the card
   `✓ 2 buildings measured · 10.9 s · Wrote 3 columns to …`.
3. Style by result opens the draft named `extent_height_m` with
   `extent_height_m > 8.4`; the editor's Save commits it and the legend goes
   `Unmatched 4` → `extent_height_m 1 | Unmatched 3`. The last full run's
   "the draft cannot be added without a name" deviation is closed.
4. Undo removes `EXTENT_HEIGHT_M` / `EXTENT_ZMIN_M` / `EXTENT_ZMAX_M` from the
   drawer header; the card reads `Undone`.
5. With nothing selected the collapse chevron is enabled, the single collapsed
   pill reads `Tools`, and clicking it restores the panel with the Tools tab
   `aria-selected="true"`. With a building selected both pills show and the
   Details pill expands onto the DETAILS tab — m8's other half. The last full
   run's "a toolbox-only session cannot reach the Tools pill" deviation is
   closed.

Two driver notes recorded in the smoke file, neither an app problem:
`agent-browser find role button click --name "Add"` matches `Add layer`
(prefix matching — use a `@ref` or `eval`), and a SECOND upload of the same
fixture in one session fails with a stale-`File` read error and adds a failed
layer entry beside the loaded one.
