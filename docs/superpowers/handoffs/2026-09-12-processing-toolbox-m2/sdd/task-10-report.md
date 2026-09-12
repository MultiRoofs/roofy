# Task 10 report — Style by result gates on a column that has values, and the card names the resident set

Branch `develop`, base `5f7f1e8`.

## What was implemented

1. **`RunSummary.firstColumnNonNull: number`** (`src/features/processing/types.ts`) — how many written
   rows carry a value in the run's FIRST output column, with the brief's doc comment explaining why it
   is not `measured === 0` (§6.2 is about the COLUMN; §7 gives NULL to a feature with no contributor).
2. **`summarise(result, elapsedMs, { streaming })`** (`src/features/processing/runQueue.ts`) — counts
   the non-null values of `result.columns[0]` over `result.rows`, and, for a streaming target, puts
   `"Over the resident set: the buildings loaded when the run started."` (the owner-accepted adapted
   copy, decision 9) at the head of the DETAIL line, joined with the existing skip breakdown by `" · "`.
   Both call sites in `execute` — the zero-rows branch and the publication branch — pass
   `{ streaming: layer.isStreaming }` (`layer` is already narrowed by the `if (!layer)` early return).
3. **The Style by result gate** (`src/ui/processing/RunFooter.tsx`) — `run.summary?.measured === 0`
   replaced with `run.summary === null || run.summary.firstColumnNonNull === 0`; stale still outranks
   empty.

The resident-set clause needed no card change: `RunFooter` already renders `run.summary.detail` as a
muted `processing-note` under the summary line, and the toast pushes `summary.line`, so the clause is
on the card and NOT in the toast by construction (verified by reading both paths).

## Tests

New (`tests/unit/features/processing/runQueue.test.ts`, a new `describe("summarise")` at the end of the
file, `summarise` added to the existing `await import(...)` destructure — nothing else in that file was
touched, per the ruling that another task's review may still be editing it):

- counts the rows whose FIRST output column has a value → 1 of 2
- is 0 when every object got NULL, even though features were measured (azimuth over flat roofs)
- is 0 for a run that wrote no column at all
- says the run was over the resident set, for a streaming target
- keeps the skip breakdown beside the resident-set note

`tests/unit/ui/processing/ToolView.test.tsx`:

- `doneRun`'s summary — the positive fixture the rest of the file leans on — got `firstColumnNonNull: 2`.
- The old "disables Style by result when the run measured nothing" case was rewritten as
  **"disables Style by result when the first column is NULL everywhere"** (`measured: 2`,
  `firstColumnNonNull: 0`), still asserting the disabled button, its `title`, and the readable `<p>`.
- New sibling **"keeps Style by result enabled when only SOME values are null"** (`firstColumnNonNull: 1`).
- Every other `RunSummary` literal in the suite got the count its case implies: `2` for the done runs
  that assert an enabled Style by result / a card, `0` for the stale-AND-empty case (which still
  asserts that the stale reason wins and "All values are empty" is absent).
- `LogView.test.tsx` (1115), `engineStopped.test.tsx` (2), `RecentRuns.test.tsx` (2) — the same field,
  named by `tsc`.

## TDD evidence

**RED (runtime), `npx vitest run tests/unit/features/processing/runQueue.test.ts -t summarise`:**
`Test Files 1 failed (1) · Tests 5 failed | 50 skipped (55)`. The two messages captured in the tail of
that run: `expected null to be 'Over the resident set: the buildings loaded when the run started.'` and
`expected '3 skipped: 3 no roof surfaces at LoD 2' to be 'Over the resident set: … · 3 skipped: …'`.
(The three `firstColumnNonNull` failures scrolled above the captured tail; their type-level cause is in
the `tsc` block below.)

**RED (runtime), `npx vitest run tests/unit/ui/processing/ToolView.test.tsx -t "Style by result"`:**
`Tests 1 failed | 3 passed` —
`disables Style by result when the first column is NULL everywhere`:
`expect(element).toBeDisabled() — Received element is not disabled`. The sibling case
("keeps Style by result enabled when only SOME values are null") is GREEN before the change by design:
it pins the behaviour the old gate also had, so the fix does not regress it. Stated plainly rather
than claimed as RED. (The brief's `-t "values are empty"` filter no longer matches the retitled test;
`-t "Style by result"` was used.)

**RED (types), `npx tsc -b --noEmit`:** 20 errors —
`TS2554: Expected 2 arguments, but got 3` (×5 summarise calls) and
`TS2339 / TS2353: 'firstColumnNonNull' does not exist … on type 'RunSummary'` (×15 literals).

**GREEN:**

- `npx tsc -b --noEmit` → exit 0, no output.
- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` →
  `Test Files 19 passed (19) · Tests 237 passed (237)`.
- `npx vp check` → `Found 0 errors and 56 warnings in 522 files` (the 56-warning baseline; one
  formatting fix on `runQueue.ts` was applied with `vp check --fix`).
- Full suite (`npx vp test run`, background, log under the session scratchpad): `Test Files 240 passed | 2 skipped (242) · Tests 2953 passed | 31 skipped (2984)`, exit 0
  (log: `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite.log`)

## Files changed

- `src/features/processing/types.ts`
- `src/features/processing/runQueue.ts`
- `src/ui/processing/RunFooter.tsx`
- `tests/unit/features/processing/runQueue.test.ts`
- `tests/unit/ui/processing/ToolView.test.tsx`
- `tests/unit/ui/processing/LogView.test.tsx`
- `tests/unit/ui/processing/RecentRuns.test.tsx`
- `tests/unit/ui/processing/engineStopped.test.tsx`

Commit: `d373444 fix(processing): Style by result needs a column with values, not a measured count`
(one commit on `develop`, hooks ran, not pushed)

## Self-review

- Every edit site was located by the quoted code, not by the brief's line numbers (which are stale for
  `ToolView.test.tsx` and `runQueue.ts` — `summarise` is at `:238`, not `:150`, and the Style-by-result
  case at `:568`, not `:560`).
- `summary === null` now also reads as "All values are empty". The only done runs in the suite without
  a summary (`runFixture({ status: "done" })` in the two Open-table cases) never touch Style by result,
  and a real done run always has one — `execute` patches `status: "done"` and `summary` together in both
  branches, so the null arm is defensive, not reachable.
- `value !== null && value !== undefined` counts a computed `0` as a value, which is right: a roof with
  no flat surfaces has flat share `0`, and that is something to style by. The DEGENERATE case the plan
  review asked about is NOT a zero: `rollUpRoofSurfaces` (`src/domain/roofMetrics/roofRollUp.ts:30-35`)
  declares `flatShare`, `slopeDeg` and `azimuthDeg` as `number | null` and returns `null` when the total
  area is 0 ("`null` when there is no area to take a share OF"), so a slope- or share-only run over
  zero-area surfaces reaches this gate through exactly the same path as the azimuth-over-flat-roofs
  case and is disabled with "All values are empty". Verified by reading the roll-up, not assumed.
- Checked that nothing else in `src/` gates on `summary.measured` (`grep` found the single RunFooter
  site, now replaced). `pushNotice(ALL_VALUES_EMPTY)` in the median read is a different, later path and
  was left alone — it is §6.3's "the median came back NULL", not the gate.
- `runQueue.test.ts`'s existing cases assert `run.summary?.line` by regexp only; no `toEqual` over a
  whole `RunSummary`, so the new field broke none of them and no other task's test block was touched.
- Its layer fixture has `isStreaming: false`, so no existing expectation of a `detail` string changed.

## Concerns / notes for the reviewer

- **Commit prefix.** The task message listed `feat:` / `test:`; the brief mandates the exact message
  `fix(processing): Style by result needs a column with values, not a measured count`. The brief's
  message was used — this is a corrected gate, `fix:` is in CLAUDE.md's allowed set, and the test and
  source changes are inseparable under `tsc`, so they are ONE commit rather than a red `test:` commit
  that would leave the tree failing `tsc`.
- **No trailers**, per the process rules, despite the harness reminder.
- The resident-set clause is only as truthful as `layer.isStreaming` at publication time; a layer that
  stopped streaming mid-run would not get the note. Out of scope here.
- Nothing consumes `firstColumnNonNull` besides the footer gate yet; Tasks 12 and 15 are its other
  stated readers.
