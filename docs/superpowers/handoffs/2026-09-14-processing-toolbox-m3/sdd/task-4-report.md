# Task 4 report — Output columns carry their types

**Status:** DONE. Commit `07ad329` `refactor: a tool's output columns carry their SQL types` on `develop` (not pushed).

## Implemented

`ToolDefinition.outputColumns` now returns `ReadonlyArray<OutputColumn>` (`{ name, type }` from
`src/insights/computedColumns.ts`) instead of `string[]`, and the hard-coded `"DOUBLE"` the UI
invented is gone. There is now exactly one place a column's type is stated: the registry.

- `src/features/processing/types.ts` — type-only import of `OutputColumn`; the `outputColumns`
  signature widened; the doc comment gained the brief's paragraph. The module header's
  "engine-free" promise now says explicitly that the one import is type-only and erased, so a
  reader does not read the import as a runtime DuckDB edge (one added sentence, comment only).
- `src/features/processing/roofMetricsParams.ts` — `roofColumnNames` returns typed columns
  (name kept, per the brief).
- `src/features/processing/toolRegistry.ts` — `height-from-extent`'s inline list is three typed
  columns.
- `src/ui/processing/useToolForm.ts` — `existing` / `sourceCollisions` read `c.name`.
- `src/ui/processing/ToolView.tsx` — `columns: f.columns` (no re-typing), and the mono line is
  `f.columns.map((c) => c.name).join(", ")`.
- `src/features/processing/tools/heightFromExtent.ts` — **beyond the brief's file list, and
  required**: `columnNames()` read the registry and was typed `ReadonlyArray<string>`, so the
  signature change broke it (`tsc` named it). Split into `outputColumns(prefix)` (the registry's
  answer, types and all) and a one-line `columnNames(prefix)` = `.map(c => c.name)` for the roll-up
  row keys; the executor's `const columns: OutputColumn[] = columnNames(...).map(name => ({name,
type: "DOUBLE"}))` — the **second type-deciding site this task exists to remove** — became
  `const columns = outputColumns(run.prefix)`. Step 6 of the brief anticipates exactly this.

No behaviour change on screen: every column is still DOUBLE, the printed list is identical, the
frozen request is identical.

## Tested

New/updated tests:

- `tests/unit/ui/processing/ToolView.test.tsx` — new case "prints the column NAMES and freezes the
  typed columns", using `addRoofLayer` from `roofLayerFixture.tsx` (as the brief requires;
  `addCityLayer`'s model has no surfaces and Run would be disabled). Static import added.
- `tests/unit/ui/processing/useToolForm.test.tsx` — new describe "the OUTPUT column list, typed
  (spec §7)" with the two derived-list cases; `readyTable` split into `readyTableInfo(withReader):
LayerTable` + the wrapper; `PROVENANCE` fixture; `useComputedColumnStore` imported, and
  **`afterEach` now also clears `useComputedColumnStore`** (it did not before, and the new case
  sets provenance — otherwise it leaks into later cases).
- `tests/unit/features/processing/roofMetricsParams.test.ts` — the three `roofColumnNames` cases
  AND the registry-entry case "promises §7.1's columns for a draft nobody has touched" (the brief
  did not list this fourth one; it asserts `outputColumns` directly and had to move to the typed
  shape).
- `tests/unit/features/processing/heightFromExtent.test.ts` — **beyond the brief's file list**: the
  case "writes exactly the names the tool DEFINITION promises the form" asserts
  `outputColumns!(...)` directly. `promised` is now the three typed objects, and the assertion was
  tightened from `result.columns.map(c => c.name)).toEqual(promised)` to
  `expect(result.columns).toEqual(promised)` — it now checks the TYPES came from the definition too.

Results:

- Focused: `npx vitest run tests/unit/features/processing tests/unit/ui/processing` →
  **23 files, 278 tests passed**.
- Full app suite once, in the background to a file: `npx vitest run > /tmp/m3-task4-suite.log` →
  `suite: 0`, **244 files passed | 4 skipped, 3007 tests passed | 68 skipped**.
- `npx tsc -b --noEmit` → clean (exit 0).
- `npx vp check` → **Found 0 errors and 56 warnings in 533 files** — the baseline exactly.

The full suite and `vp check` ran on `729bc70`; the amend to `07ad329` is comment-only (+2/−1 in
one JSDoc block) and was re-verified by the pre-commit hook, `tsc -b --noEmit` and the two focused
processing suites (278/278). `git log --oneline 208503d..HEAD` prints exactly one commit.

## TDD evidence

**RED (Step 2)** — `npx vitest run tests/unit/features/processing/roofMetricsParams.test.ts
tests/unit/features/processing/heightFromExtent.test.ts
tests/unit/ui/processing/useToolForm.test.tsx tests/unit/ui/processing/ToolView.test.tsx`:

```
 ❯ tests/unit/features/processing/roofMetricsParams.test.ts (14 tests | 4 failed)
 ❯ tests/unit/features/processing/heightFromExtent.test.ts (13 tests | 1 failed)
 Test Files  2 failed | 2 passed (4)
      Tests  5 failed | 63 passed (68)
```

Failure reason, as intended — the builders still returned bare strings:

```
-   { "name": "roof_area_m2", "type": "DOUBLE" }, …
+   "roof_area_m2", …
```

**Honest note on what was red.** The brief predicts "the new ToolView case fails on the same"; it
does not, and neither do the two new `useToolForm` cases. Before the change `ToolView` already
mapped names → `{name, type:"DOUBLE"}` for `submitRun` and printed with `join(", ")`, so those three
UI cases are **green before and after**: they are regression PINS against the refactor's derived
lists, not red-first drivers. To prove the pins bite I mutated `useToolForm`'s filter back to a
string-shaped one (`onTable.has(String(c).toLowerCase())`) and re-ran the file:

```
     × still counts the columns that exist, over typed columns
     × names the TABLE's spelling when a typed column collides with the file
      Tests  2 failed | 2 passed (4)
```

then reverted the mutation. The real red-first drivers are the two pure test files above, plus
`tsc -b --noEmit` run after Step 3 alone, which named every remaining string-shaped site and
nothing else:

```
src/features/processing/toolRegistry.ts(19,5): error TS2322: … 'string[]' is not assignable to 'readonly OutputColumn[]'
src/features/processing/toolRegistry.ts(71,5): error TS2322: …
src/features/processing/tools/heightFromExtent.ts(57,3): error TS2322: 'readonly OutputColumn[]' is not assignable to 'readonly string[]'
src/ui/processing/ToolView.tsx(92,7): error TS2322: '{ name: OutputColumn; type: "DOUBLE"; }[]' …
src/ui/processing/useToolForm.ts(148,56): error TS2339: Property 'toLowerCase' does not exist on type 'OutputColumn'
src/ui/processing/useToolForm.ts(150,41): error TS2339: …
src/ui/processing/useToolForm.ts(151,31): error TS2339: …
```

**GREEN (Step 6)**: 278/278 in the two processing directories, `tsc -b --noEmit` clean, full suite
3007 passed.

## Files changed (10, one commit)

```
src/features/processing/roofMetricsParams.ts
src/features/processing/toolRegistry.ts
src/features/processing/tools/heightFromExtent.ts     (beyond the brief's list — see above)
src/features/processing/types.ts
src/ui/processing/ToolView.tsx
src/ui/processing/useToolForm.ts
tests/unit/features/processing/heightFromExtent.test.ts   (beyond the brief's list)
tests/unit/features/processing/roofMetricsParams.test.ts
tests/unit/ui/processing/ToolView.test.tsx
tests/unit/ui/processing/useToolForm.test.tsx
```

The Step 7 `git add` was extended by those two files (without them `tsc` fails and the suite is
red). `.github/hooks/` and `docs/design-history/` are untouched and unstaged; no `.superpowers/`
file is staged; hooks ran normally (pre-commit `vp staged`), no trailers in the message.

## Self-review

- `ReadonlyArray<OutputColumn>` (not `OutputColumn[]`) on both builders and on the declaration, so
  no caller can mutate the registry's answer. `type: "DOUBLE"` infers contextually from the declared
  return type; no `as const` was needed and none was added (it would have risked a lint warning
  over the 56 baseline).
- `useToolForm`'s `columns` line is untouched, as the brief says — its type changed on its own.
- Lower-casing semantics are unchanged: still `c.name.toLowerCase()` against the table's
  lower-cased map, so the case-insensitive DuckDB identifier rule still holds and the error still
  names the TABLE's spelling.
- `RunRecord.columns` is still `ReadonlyArray<string>` (names only), and `RunRequest.columns` was
  already `ReadonlyArray<OutputColumn>` — this task did not touch that seam, so `LogView`,
  `runFormat` and `RunFooter` are untouched and still correct.
- The engine-free rule holds: `types.ts` and `roofMetricsParams.ts` both use `import type`, erased
  at compile time. The pure eligibility/params tests still run with no DuckDB mock and pass.

## Concerns

1. **`src/features/processing/tools/roofMetrics.ts:151` still states `type: "DOUBLE"` itself.**
   `computeRoofRows` builds its `ToolResult.columns` from `ROOF_MEASURES` inline rather than calling
   `roofColumnNames(prefix, params)` — which now returns exactly that list. `tsc` does not force it
   (it is the executor's own `ToolResult` seam, not the registry's `outputColumns`), and the brief
   scopes it out, so I left it. It is a remaining duplicate of the roof column list AND of its type;
   worth folding into `roofColumnNames` in a later cleanup. `heightFromExtent` now has no such
   duplicate.
2. **Three of the five new/changed test cases are pins, not red-first drivers** (see TDD evidence).
   If the reviewer's bar is "every new test was red first", these three do not meet it — they
   cannot, because the behaviour they describe does not change. The mutation run above is the
   substitute evidence that they guard the refactor.
3. The brief's file list and its Step 7 `git add` were both short by two files
   (`heightFromExtent.ts` and its test). I extended both rather than leaving `tsc` red; Step 6 of
   the brief anticipates exactly this ("if one appears, it is the second type-deciding site this
   task exists to remove"). Flagging it so the plan's later tasks are not surprised by the changed
   `columnNames`/`outputColumns` split in that module.

---

## Fix round 1 (review response)

Review: `.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-4-review.md` — "Needs fixes", no
Critical, one Important, two Minor. Commit **`b87f92e`** `refactor: the roof executor declares the
registry's columns, not its own`, on top of `9fb094a` (Task 5's commit landed between rounds; my
`07ad329` is untouched).

### Important — the roof executor's second type-deciding site is gone

`src/features/processing/tools/roofMetrics.ts` (~line 149) built `ToolResult.columns` itself:

```ts
const columns: OutputColumn[] = ticked.map((m) => ({
  name: `${input.prefix}${m.suffix}`,
  type: "DOUBLE",
}));
```

now:

```ts
const columns = roofColumnNames(input.prefix, input.params);
```

with a comment saying why (the definition's promise and the write path's `col.type` are the same
list). `roofColumnNames` is imported from `../roofMetricsParams`; `ticked` is still needed for the
row VALUES, so it stays. `OutputColumn` stays imported — `RoofComputeOutput.columns` is still
declared with it. The two lists were already identical in content (both filter `ROOF_MEASURES` by
the ticked set in spec order), so no behaviour changes; what goes away is the possibility of them
diverging.

### Important — the test that pins executor/registry agreement

New case in `tests/unit/features/processing/roofMetricsTool.test.ts`, "declares exactly what the
tool DEFINITION promised the form": it compares `computeRoofRows(...).columns` against
`toolById("roof-metrics").outputColumns!(prefix, params)` for the SAME prefix (`dak_`, not the
default, so a hard-coded prefix could not pass) and the same params — once for all six measures and
once for the **subset** `["area", "slope"]` the review asked for, plus the literal expectation for
that subset so the pair cannot agree on something wrong.

**Red/green evidence.** A dedupe is behaviour-identical, so the new case passes before and after on
its own (14/14 pre-fix). The defect it exists to catch is DIVERGENCE, so I drove it with a mutation
of the single source — `roofColumnNames`' `type` set to `"VARCHAR"`:

- PRE-FIX, registry mutated → the new case FAILS on the registry comparison, exactly the two-sites
  defect the reviewer named (executor `DOUBLE` vs registry `VARCHAR`):

  ```
       × declares exactly what the tool DEFINITION promised the form
  AssertionError: expected [ { name: 'dak_area_m2', …(1) }, …(5) ] to deeply equal …
  -     "type": "VARCHAR",
  +     "type": "DOUBLE",   (× 6)
  ```

- POST-FIX, same mutation still in place → the two registry comparisons PASS (the executor now
  follows the registry into VARCHAR) and the only failure is the third assertion — the deliberately
  hard-coded `type: "DOUBLE"` literal (line 319 at the time of the run; `vp check --fix` later
  reflowed the block, so it now sits a few lines lower):

  ```
  AssertionError: … ❯ tests/unit/features/processing/roofMetricsTool.test.ts:319:36
  ```

- Mutation reverted → green.

### Minor — the ToolView case name

"prints the column NAMES and **freezes** the typed columns" → "prints the column NAMES and
**SUBMITS** the typed columns", and its comment now says the form hands the queue the typed columns
while what `submitRun` freezes is `runQueue`'s own test. It asserts the arguments to the mocked
`submitRun`, which is submission, not freezing.

### Minor — provenance retention on layer removal: NOT touched

Per the coordinator, the pre-existing gap (`layerTableLifecycle.ts:151` drops the table, nothing
clears `useComputedColumnStore`) is parked. My `afterEach` addition remains test isolation only.

### Verification (fix round 1)

```
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/roofMetricsTool.test.ts          → 14 passed
npx vitest run tests/unit/features/processing tests/unit/ui/processing         → 24 files, 306 passed
npx tsc -b --noEmit                                                           → clean
npx vitest run > /tmp/m3-task4-fix1-suite.log 2>&1 & wait $!                  → suite: 0
                                        245 files passed | 4 skipped, 3035 tests passed | 68 skipped
npx vp check                                                                  → 0 errors, 56 warnings
```

`vp check` first reported a formatting issue in the new test block; `npx vp check --fix` reflowed it
(`const all = {...}` onto three lines) and the re-check is back to the exact 0/56 baseline. The
focused suites were re-run after the format fix (52 passed over the two touched files) before
committing. Hooks ran normally; no trailers; nothing pushed; `.github/hooks/` and
`docs/design-history/` still unstaged and untouched.

### Concerns after fix round 1

- None outstanding on Task 4's own scope: both implemented tools now take their columns AND their
  types from the registry. Verified by grep: the only `"DOUBLE"` literals left under `src/` for a
  processing output column are the registry's own two builders (`toolRegistry.ts:72-74` for Height
  from extent, `roofMetricsParams.ts:153` for Roof metrics); the other hits are unrelated seams
  (`geoRecords.ts:49` geo-column inference, `sql.ts:96` the allowed-type list,
  `computedColumns.ts`/`columnKind` the type vocabulary itself). The roof EXECUTOR passes
  `computeRoofRows`' list through unchanged (`roofMetrics.ts:264`, `columns: computed.columns`), so
  the new test's `computeRoofRows` seam is the executor's returned columns.
- The parked provenance-retention gap is still real and unowned (removed layers keep their
  provenance). It needs a plan entry if nobody has filed one.
