# Final fix wave — implementation report (M13.1)

Branch `develop`, base `2a8fa2f`. F1, F2, F5 and F6 were done red-first: the
test (or the amended assertion) was written, run, and watched fail for the
intended reason before the change that makes it pass. **F3 was not** — the tests
and the fix were written together and the red run was reconstructed afterwards
against the pre-fix builder; the F3 section says so and quotes the real output.
No trailers on any commit.

Environment for every run: `export PATH="$HOME/.local/share/mise/shims:$PATH"`,
then `npx vitest run <paths>` from the repo root.

## Commits, in order

| SHA       | Subject                                                                           | Item  |
| --------- | --------------------------------------------------------------------------------- | ----- |
| `1622b78` | fix(processing): a run writes under the table's own spelling of its columns       | F1    |
| `c8172e5` | fix(processing): a run that has already ended keeps its own reason                | F2    |
| `d036f85` | fix(processing): a failed run leaves a way to submit an edited request            | F5    |
| `7f915c1` | fix(processing): the amber dot lights unless Tools is actually visible            | F6    |
| `87b751f` | fix(insights): CityParquet exports computed columns as attributes                 | F3    |
| `3e42958` | test(insights): pin DuckDB's case-insensitive identifiers against the real engine | F1(b) |
| `91dba71` | docs(roadmap): refresh Milestone 13's carried list after the fix waves            | F7    |
| `11f2b32` | test(insights): the written CityParquet package carries the computed column       | F3    |

---

## F1 — mixed-case replacement breaks model consistency and Undo ownership

**Changed**

- `src/features/processing/runQueue.ts:188-230` — new pure `canonicalise(result,
columns)`: it maps every output column name to the TABLE's spelling when the
  table already has that column case-insensitively, else leaves the name as
  typed, and renames the ROWS' keys the same way (the JSON `read_json_auto`
  reads must carry the canonical keys too).
- `src/features/processing/runQueue.ts:512-514` — the executor's result goes
  through it immediately: `const result = canonicalise(await executor(record,
ctx), table.columns)`. Everything downstream then reads canonical names for
  free — the SQL, `existing`, `writeComputedColumns`, `previousModelValues`,
  `mergeAttributes`, `setProvenance` and `undoState.created/replaced`.
- `src/features/processing/runQueue.ts:618-628` — the Undo-ownership loop
  compares column names with `toLowerCase()` on both sides, so an earlier run
  recorded under a different spelling still loses its Undo.
- `src/features/processing/runQueue.ts:663-666` — the done patch now writes
  `columns: result.columns.map(c => c.name)`. The record's `columns` were set at
  queue time from the REQUEST (the typed spelling), and `RunFooter` reads
  `run.columns[0]` for Style by result and `run.columns.length` for "Wrote N
  columns".

**Tests**

- `tests/unit/features/processing/runQueue.test.ts` — "writes a
  differently-cased run under the column's own spelling" (run 1 `extent_`, run 2
  `EXTENT_`; asserts no statement contains `"EXTENT_height_m"`, one registry
  entry owned by run 2, one model attribute key, run 2's `columns`, run 1
  `undoable: false`, run 2 `undoable: true`).
- `tests/integration/duckdb/computedColumns.test.ts` — "probe 1c: identifiers
  differing only in case › adds nothing for a differently-cased name and updates
  the column there" (the premise the fix rests on, against real DuckDB 1.5.5).

**RED**

`npx vitest run tests/unit/features/processing/runQueue.test.ts -t "differently-cased"`
→ 1 failed / 29 skipped:

```
AssertionError: expected true to be false
 ❯ runQueue.test.ts:801  expect(sql.some((s) => s.includes('"EXTENT_height_m"'))).toBe(false)
```

(The run sent `ALTER TABLE … ADD COLUMN IF NOT EXISTS "EXTENT_height_m"` and the
registry, the model and the record all acquired the second spelling.)

**GREEN**

`npx vitest run tests/unit/features/processing/runQueue.test.ts` → 30 passed.
`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts`
→ 10 passed (the new probe included).

---

## F2 — layer removal overwritten by a late completion

**Changed**

- `src/features/processing/runQueue.ts:240-262` — the queue's local `patch(id, p)`
  refuses ANY patch that carries a status when the run is already `failed` or
  `cancelled`. A patch without a status (a late `log`, a `warnings` append) still
  lands. One guard, so every one of the run's ends is protected at once.
- `src/features/processing/runQueue.ts:530-532` — the "nothing to write" done
  path pushes its notice only when the run actually reads `done`.
- `src/features/processing/runQueue.ts:671-681` — after the final done patch the
  status is READ BACK from the store; a run that did not reach `done`
  `discardUndo(id)`s (its backup is unreachable from a card that offers no Undo)
  and returns before `pushNotice`.

**Tests** (`tests/unit/features/processing/runQueue.test.ts`, in
`describe("installTargetRemovalWatcher")`)

- "keeps 'Layer removed' when the run finishes after the removal" — the mocked
  `refreshLayerTableColumns` is deferred, the layer is removed while it is held,
  then released. Asserts `failed` / "Layer removed" / `undoable: false` / no
  notice / `DROP TABLE IF EXISTS "__undo_<id>"` reaches the SQL log.
- "keeps 'Layer removed' when the scope query then fails" — a new `failing`
  knob on the duckdb mock makes `COUNT(DISTINCT …)` return a database error; it
  is gated, the layer is removed mid-flight, then it resolves. Asserts the
  reason stays "Layer removed" and the executor never ran.
- "still lets a run reach done, and a cancelled one stay cancelled" — the guard
  does not touch the ordinary transitions (running → done with `undoable: true`;
  running → cancelling → cancelled through a gated `BEGIN TRANSACTION`).

**RED**

`npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Layer removed"`
→ 2 failed:

```
AssertionError: expected 'done' to be 'failed'          (the late continuation published done)
AssertionError: expected 'Database was closed' to be 'Layer removed'
```

**GREEN**

`npx vitest run tests/unit/features/processing/runQueue.test.ts` → 33 passed.
(The third test needed one fix of its own: the first run's `BEGIN TRANSACTION`
was still in the shared log, so the wait returned before the second run started.
`sql.length = 0` before submitting it.)

---

## F3 — CityParquet export lacks computed columns (IMPLEMENTED, not stopped)

The STOP condition did not trigger: the change is ~35 lines of builder plus the
plumbing, and the two design questions it might have raised were already
settled by the existing code — `buildFeatureScopeWhere` ALREADY scopes the
reader's rows through a subquery over the layer table's `feature_id`/`id`, so
the export presupposes the ids agree, and the CityParquet path is a scratch
TABLE (`CREATE TABLE … AS SELECT`), not a stream.

**Changed**

- `src/insights/sql.ts:656` — `CITYPARQUET_COMPUTED_ALIAS = "computed"`.
- `src/insights/sql.ts:689-740` — `buildCityParquetSourceSql` gains a required
  `computedAttributes`. Those names are removed from the reader's select list
  (even if the caller also put them in `attributes`) and appended after it; when
  the list is non-empty the statement gains
  `LEFT JOIN (SELECT "id", …computed FROM <layer table>) AS "computed" USING ("id")`.
  A DERIVED table joined with `USING` rather than the layer table itself: the
  derived side carries `id` and the computed columns only, so `feature_id`
  stays unambiguous, `USING` leaves ONE `id`, and the feature-scope `WHERE`
  needs no qualifying. With no computed column requested the statement is
  byte-for-byte what it has always been.
- `src/insights/export.ts:395-398, 572` — `CityParquetExportRequest.computedAttributes`
  (required, so a caller cannot silently omit it) and it is passed through.
- `src/ui/table/ExportDialog.tsx:23, 364-371, 404, 446` — the chosen attributes
  are partitioned with `computedColumnsOf(layerId)`; `layerId` joins the
  callback's dependency list.

**Tests**

- `tests/unit/insights/sqlExport.test.ts` — "takes a computed column from the
  layer table, joined by object id" (exact string); "keeps the scope WHERE
  readable beside the computed join"; "names a computed column once, even when
  the attribute list repeats it". The four pre-existing exact-string cases are
  unchanged apart from `computedAttributes: []`.
- `tests/unit/insights/exportCityParquet.test.ts` — "joins a computed column in
  from the layer table (§8)" (the request→SQL plumbing).
- `tests/integration/duckdb/layerTables.test.ts` — "joins a computed column into
  the CityParquet source read": a real copy of the layer table gains
  `extent_height_m`, the built statement runs against **real DuckDB 1.5.5**
  WITH a feature-scope `WHERE` beside the join, and every scratch row carries
  its own value. This is what pins that the join and the predicate coexist.
  The same test then runs the rest of the package sequence over that scratch
  table — `buildCityParquetModuleSql`, `PRAGMA cityparquet_init`,
  `cityparquet_write` — and reads `extent_height_m` back out of the written
  `building.parquet`, so §8's promise ("in CityParquet as attributes") is
  checked on the PACKAGE, not only on the scratch table.

**RED — captured RETROACTIVELY; the red step was skipped in sequence**

Honest note: for F3 alone I wrote the tests and the builder change and only then
ran vitest, so there was no failing run at the time. The evidence below was
captured afterwards by restoring the pre-fix builder over the new tests
(vitest does not typecheck, so the old builder simply ignores
`computedAttributes` and emits no join), then restoring it:

```
git checkout 87b751f^ -- src/insights/sql.ts
npx vitest run tests/unit/insights/sqlExport.test.ts tests/unit/insights/exportCityParquet.test.ts

  × takes a computed column from the layer table, joined by object id
  × keeps the scope WHERE readable beside the computed join
  × names a computed column once, even when the attribute list repeats it
  × joins a computed column in from the layer table (§8)
  AssertionError: expected 'CREATE TABLE "exp_1_src"."src" AS SEL…' to contain 'LEFT JOIN (SELECT "id", "extent_heigh…'
  AssertionError: expected 'CREATE TABLE "exp_src_4"."src" AS SEL…' to be 'CREATE TABLE "exp_src_4"."src" AS SEL…'
  AssertionError: expected 'CREATE TABLE "e"."src" AS SELECT "id"…' to contain 'LEFT JOIN (SELECT "id", "extent_heigh…'
  AssertionError: expected 'CREATE TABLE "e"."src" AS SELECT "id"…' to be 'CREATE TABLE "e"."src" AS SELECT "id"…'
  Tests  4 failed | 43 passed (47)

git checkout 87b751f -- src/insights/sql.ts   # working tree back at HEAD
```

The other five items (F1, F2, F5, F6, and F1's integration probe) were done red
first, in sequence, with the failures quoted in their own sections.

**GREEN**

`npx vitest run tests/unit/insights tests/unit/ui/table` → 28 files, 432 passed.
`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/layerTables.test.ts`
→ 21 passed.

---

## F5 — a failed run leaves no visible way to submit an edited request

**Changed**

- `src/features/processing/processingStore.ts:79-92, 199-207` — `dismissDoneRun`
  becomes `dismissFinishedRun` and dismisses the pair's latest run when it is
  `done` OR `failed`. A run in flight is still never dismissed.
- `src/features/processing/processingStore.ts:172-183` — `setDraft` dismisses
  the pair's latest run when it is `failed`: the first edit of any field hands
  the Run button back. Only `failed` — a done card locks the form, and nothing
  in flight may lose its progress block.
- `src/ui/processing/ToolView.tsx:27-38` — the dismissal suppresses a `done` OR
  `failed` latest run.
- `src/ui/processing/RecentRuns.tsx:106-114` — "Edit & run" calls
  `dismissFinishedRun`.

**Tests**

- `tests/unit/features/processing/processingStore.test.ts` — "dismisses the
  latest FINISHED run of a pair, and never one in flight" (extended with the
  failed case); "dismisses a failed card on the first edit of the tool's draft";
  "leaves a run in flight alone when the draft is edited".
- `tests/unit/ui/processing/ToolView.test.tsx` — "hands Run back on the first
  edit under a FAILED card" (Retry present → edit the prefix → Retry gone, Run
  submits `prefix: "h_"`); "shows the idle footer for a failed run Edit & run
  dismissed" (Run present, both fieldsets enabled).
- `tests/unit/ui/processing/RecentRuns.test.tsx` — "clears a FAILED card too, so
  the form it opens can be submitted".

**RED**

`npx vitest run tests/unit/features/processing/processingStore.test.ts tests/unit/ui/processing/ToolView.test.tsx tests/unit/ui/processing/RecentRuns.test.tsx`
→ 5 failed:

```
TypeError: store.dismissFinishedRun is not a function
AssertionError: expected [] to deeply equal [ 'r1' ]     (setDraft under a failed card)
AssertionError: expected [] to deeply equal [ 'r1' ]     (Edit & run on a failed row)
AssertionError: expected <button type="button"></button> to be null   (Retry still there after the edit)
TypeError: useProcessingStore.getState(...).dismissFinishedRun is not a function
```

**GREEN**

`npx vitest run tests/unit/features/processing tests/unit/ui/processing` →
13 files, 154 passed.

One pre-existing test had to be adapted, not deleted: "retries a failed run with
its FROZEN parameters, not the draft" drifted the prefix UNDER the failed card,
which now dismisses it. The drift is seeded BEFORE the card arrives instead, so
the test still pins exactly what it pinned (Retry repeats the frozen request by
id; `submitRun` is never called).

---

## F6 — a failure while Tools is not visible is not marked unseen

`features/` never imports `ui/` (grep: no `from "../../ui/…"` anywhere under
`src/features/`), and `ui/shell/shellStore.ts` already imports two feature
stores. So the collapse is MIRRORED from the shell rather than read from it.

**Changed**

- `src/features/processing/processingStore.ts:48-57, 106, 112-120` (unchanged) — new
  `panelCollapsed` state (default `false`), a `setPanelCollapsed` action, and
  one predicate `toolsVisible(s) = s.open && s.activeTab === "tools" &&
!s.panelCollapsed`.
- `src/features/processing/processingStore.ts:125-164` — `setOpen`, `setTab`,
  `setPanelCollapsed`, `openTool` and `openLog` each clear `unseenFailure` only
  when Tools actually becomes visible. (`openTool`/`openLog` are always paired
  with `revealTools()`, whose `setRightCollapsed(false)` mirrors in and clears
  it a moment later for the collapsed case.)
- `src/features/processing/processingStore.ts:184-192, 208-227` — `upsertRun`
  and `patchRun` raise `unseenFailure` on a failed status unless
  `toolsVisible(s)`.
- `src/ui/shell/shellStore.ts:1, 145-153` — `setRightCollapsed` and
  `toggleRightCollapsed` (the only two writers of `rightCollapsed`; the resize
  handler does not touch it) push the value into the processing store.

**Tests**

- `tests/unit/features/processing/processingStore.test.ts` — "marks a failure
  unseen while the Details tab is up" (raised via `patchRun`, cleared by
  `setTab("tools")`); "marks a failure unseen while the right panel is
  collapsed" (cleared by `setPanelCollapsed(false)`); "leaves a failure seen
  when the Tools tab is actually showing".
- `tests/unit/ui/shell/shellStore.test.ts` — "mirrors the collapse into the
  processing store, both ways".

**RED**

`npx vitest run tests/unit/features/processing/processingStore.test.ts tests/unit/ui/shell/shellStore.test.ts`
→ 3 failed:

```
AssertionError: expected false to be true         (Details tab: no dot)
TypeError: s.setPanelCollapsed is not a function
AssertionError: expected undefined to be true     (no mirror)
```

**GREEN**

`npx vitest run tests/unit/features/processing tests/unit/ui/processing tests/unit/ui/shell`
→ 17 files, 221 passed. `npx vitest run tests/unit/app tests/unit/ui` → 89
files, 867 passed (nothing leaned on the old unconditional clear in `setOpen`).

---

## F7 — roadmap refresh

`docs/roadmap.md:615-647`. Removed: the draft rule name clause, §6.1's
source-column re-validation at the head, the collapse chevron, and the "Run
again dismisses the done card" note that F5 superseded. Added: runtime
engine-death recovery as an M2 design task, the stale/undone run during a
pending Style by result median, cancel's statement granularity, the write step's
SQL missing from the log, "Open table" not scrolling the new columns into view,
and the queued "Matching" resolution the reviewer ruled correct. CityParquet is
NOT listed — F3 shipped.

---

## Final verification

- `npx tsc -b --noEmit` — clean (run before every commit).
- `npx vp check` — **0 errors, 56 warnings** in 509 files (the baseline; none
  added).
- Full suite: `npx vitest run` — see below.
- Opt-in integration (network, DuckDB 1.5.5 + `cityjson` community extension):
  `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` — 31 passed
  (21 + 10), both new cases included.
- `grep -rn "setDraft(" src/` — the processing store's `setDraft` has exactly
  two callers, `useToolForm.ts:181` (the form's own onChange handlers) and
  `RecentRuns.tsx:100` ("Edit & run"). Nothing calls it on mount, so F5's
  auto-dismissal cannot make a failed card vanish as a form opens.

```
npx vitest run   (background, /tmp/…/scratchpad/full-suite.log, exit 0)

 Test Files  232 passed | 2 skipped (234)
      Tests  2834 passed | 31 skipped (2865)
   Duration  61.29s
```

Baseline was 2817 tests; this wave adds 17 (2834). The 31 skipped are the two
opt-in DuckDB integration files, which were run separately with
`DUCKDB_INTEGRATION=1` and passed.

## Files changed

```
docs/roadmap.md
src/features/processing/processingStore.ts
src/features/processing/runQueue.ts
src/insights/export.ts
src/insights/sql.ts
src/ui/processing/RecentRuns.tsx
src/ui/processing/ToolView.tsx
src/ui/shell/shellStore.ts
src/ui/table/ExportDialog.tsx
tests/integration/duckdb/computedColumns.test.ts
tests/integration/duckdb/layerTables.test.ts
tests/unit/features/processing/processingStore.test.ts
tests/unit/features/processing/runQueue.test.ts
tests/unit/insights/exportCityParquet.test.ts
tests/unit/insights/sqlExport.test.ts
tests/unit/ui/processing/RecentRuns.test.tsx
tests/unit/ui/processing/ToolView.test.tsx
tests/unit/ui/shell/shellStore.test.ts
```

Untouched as instructed: `.github/hooks/`, `docs/design-history/`,
`docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md`, `.superpowers/`.
Nothing pushed.

## Concerns

1. **F5, target switch.** Changing the TARGET select while a failed card stands
   goes through `setDraft` with the NEW target, so it dismisses the failed card
   of the pair the user is switching TO (if there is one), not the one on
   screen. The card on screen then disappears anyway because the view follows
   the new pair. This is within "editing any form field", but it is a second
   effect worth knowing.
2. **F6, mirror drift in tests.** `resetForTest()` resets `panelCollapsed` to
   `false` without touching the shell's `rightCollapsed`, and a test that sets
   shell state through `useShellStore.setState` bypasses the two setters. No
   production path does either (the resize handler never writes
   `rightCollapsed`), and the next call to a setter re-syncs.
3. **F3's red step was skipped and reconstructed.** See the F3 RED section. The
   evidence is real (captured by restoring the pre-fix builder over the new
   tests) but it was taken after the fix, not before it.
4. **F3, id agreement.** The join assumes the reader's `id` and the layer
   table's `id` name the same objects. That assumption predates this change —
   the scope predicate already relies on it — but a source whose content
   changed under the same URL would now silently produce NULL computed values
   instead of a missing-column error. `LEFT JOIN` was chosen deliberately: an
   INNER join would DROP geometry rows, which is worse.
5. **F2, `failedAlready`.** The catch path's `failedAlready(id)` guard is now
   redundant with the `patch` guard, as is the `if (!runById(id)) discardUndo(id)`
   line before `refreshLayerTableColumns`. Both were left in place rather than
   removed — they are correct, and removing them is a separate refactor.
