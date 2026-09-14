# Task 5 report — The "Reading source" phase

**Status:** COMPLETE. One commit on `develop`: `9fb094a` `feat: a run can re-read its layer's source in its own phase` (parent `07ad329`). Not pushed.

## Implemented

1. **`src/features/processing/sourceRead.ts` (new, 300 lines).** `readSource({ runId, table, lod, signal })` → `ReadSourceHandle { from, geometryColumn, propertiesColumn, release() }`; the three §6.1 sentences as exported constants (`SOURCE_READ_FAILED`, `SOURCE_IDS_DIFFER`, `SOURCE_OUT_OF_MEMORY`); `classifySourceFailure`, `assertSourceIds`, `readerQuery`, `sourceWorkloadNote`. Shape copied from `export.ts:558-578`: fresh array from the provider → one `registerBuffer` under the per-run VFS name `` `${table.table}_${runId}.${extension}` `` → a `FROM` carrying the file's OWN LoD label → `dropBuffer` through `release()`. Column names come from `LayerTable.lods[].suffix`, never from string surgery on the label.
2. **`src/insights/layerTables.ts`.** `LayerTable` gains `extension: ReaderExtension | null` and `sourceBytes: number | null`. Filled in at both build sites: `buildFromReader` captures `source.bytes.byteLength` BEFORE `registerBuffer` detaches the array and returns `extension: source.extension`; `buildFromRows` returns `null, null`.
3. **`src/features/processing/runQueue.ts`.** `phase: tool.needsReader ? "source" : "compute"` at the one `patch` that starts the run.
4. **`src/ui/processing/useToolForm.ts` / `ToolView.tsx`.** `workloadNote` (gated `tool.needsReader && tableInfo?.state === "ready"`), rendered as a `processing-note` beside the extension note.
5. **The 16-literal sweep** (all 16 files the brief named, verified by `grep -rln "rowCount" tests/`).

## Tested + results

| Gate                                                                                                                                  | Result                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npx vitest run tests/unit/features/processing/sourceRead.test.ts`                                                                    | 25 passed                                                                  |
| affected suites (39 files: `features/processing`, `ui/processing`, `ui/table`, `layerTablesBuild`, `StatsTabDuckdb`, `mapFilterSync`) | 532 passed                                                                 |
| full app suite, background to `/tmp/m3-task5-suite.log`                                                                               | **245 files passed, 4 skipped; 3034 tests passed, 68 skipped; `suite: 0`** |
| `npx tsc -b --noEmit`                                                                                                                 | exit 0                                                                     |
| `npx vp check`                                                                                                                        | **0 errors and 56 warnings in 535 files** — baseline held                  |

## TDD evidence

**RED 1 — the new suite collects and fails only for the missing module** (this is also the proof for controller requirement 1):

```
$ npx vitest run tests/unit/features/processing/sourceRead.test.ts
 FAIL  tests/unit/features/processing/sourceRead.test.ts [ … ]
Error: Failed to resolve import "../../../../src/features/processing/sourceRead" …
 Test Files  1 failed (1)
      Tests  no tests
```

Not a `ReferenceError` — the `vi.hoisted` form collected cleanly.

**RED 1b — residual A2 reproduced and shown fixed.** I copied the suite to a throwaway file with the mock variables written as plain top-level `const`s (exactly the brief's Step 1 text) and ran it:

```
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
Caused by: ReferenceError: Cannot access 'registerBuffer' before initialization
 Test Files  1 failed (1)
      Tests  no tests
```

The residual is real on this checkout, and `vi.hoisted` is what removes it. The probe file was deleted.

**GREEN 1:** after writing `sourceRead.ts` and the two `LayerTable` fields — `Test Files 1 passed (1) / Tests 25 passed (25)`.

**RED 2 — the runQueue phase case.** With `phase: "compute"` restored in `runQueue.ts`:

```
AssertionError: expected 'compute' to be 'source' // Object.is equality
      Tests  1 failed | 57 skipped (58)
```

GREEN with `phase: tool.needsReader ? "source" : "compute"`.

**RED 3 — the ToolView workload-note case.** With the `tool.needsReader &&` guard removed from `useToolForm.ts`:

```
AssertionError: expected <p class="processing-note"></p> to be null
      Tests  1 failed | 37 skipped (38)
```

So the appended negative case genuinely pins the `needsReader` gate rather than passing trivially. GREEN with the guard in place.

## Files changed (22)

Source: `src/features/processing/sourceRead.ts` (new), `src/insights/layerTables.ts`, `src/features/processing/runQueue.ts`, `src/ui/processing/useToolForm.ts`, `src/ui/processing/ToolView.tsx`.

Tests: `tests/unit/features/processing/sourceRead.test.ts` (new, 25 cases), `tests/unit/features/processing/runQueue.test.ts`, `tests/unit/ui/processing/ToolView.test.tsx`, plus the 16-literal sweep — `features/query/mapFilterSync`, `features/processing/scope`, `features/processing/runQueue`, `features/processing/roofMetricsRun`, `ui/table/ExportDialog`, `ui/table/useLayerCounts`, `ui/table/useLayerQuery`, `ui/table/TablePanel`, `ui/inspector/StatsTabDuckdb`, `ui/processing/CatalogueView`, `ui/processing/useToolForm`, `ui/processing/ToolView`, `ui/processing/extensionChip`, `ui/processing/engineStopped`, `ui/processing/roofLayerFixture`, `insights/layerTablesBuild`.

Not staged: `.github/hooks/`, `docs/design-history/`, `.superpowers/` — all still untracked.

## The seven controller requirements

1. **Mock hoisting (residual A2).** Fixed with one `vi.hoisted(() => ({ registerBuffer, dropBuffer, getDuckDBStatus, READY_STATUS, deathListeners }))` block, with a comment in the file saying why. Verified empirically both ways (RED 1 and RED 1b above): the suite collects and all 25 cases run under Node 24 (`mise` shims on PATH).
2. **`registerBuffer === false` is split.** Read `duckdb.ts`'s `registerBuffer` directly: `if (!db || status.state !== "ready") return false;` and its `catch` also `return false` — so `false` really is ambiguous. `readSource` therefore does `if (getDuckDBStatus().state !== "ready") throw new EngineDeadError(); throw new Error(SOURCE_OUT_OF_MEMORY);`. Two cases pin it ("reports §6.1's memory failure…" and "tells a DEAD engine apart from a refused allocation on the same `false`"), and both assert `dropBuffer` was NOT called, since nothing was registered.
3. **Every engine await is `raced()`.** The provider fetch is `raced(source(), signal)`; the hand-off is `raced(registration, signal)`; `release()` is `racedWithDeath(dropBuffer(name)).catch(() => {})`. A registration that lands after the race was lost is dropped through a fire-and-forget `registration.then(ok => { if (ok) … dropBuffer })`. Four cases cover it: cancel during the fetch, death during the fetch, cancel during the hand-off (+ the late drop, asserted with `vi.waitFor`), and death during the hand-off. `raced` also races the death by construction, which is what makes the "death through the provider await" case pass without a second primitive.
4. **`assertSourceIds(requested, returned)` contract documented.** I did **not** copy the brief's doc comment: its "a contributor is chosen because the loaded MODEL says…" framing is the round-1 contributor-only wording that residual A1 overturned. The shipped comment states the ruled contract instead — `requested` is the id set the executor's OWN scope-rows read returned, every scoped row, roots and non-contributors included, taken BEFORE any per-feature roll-up; never `ctx.featureIds`, "which is `null` on scope 'all' and would leave the widest scope the only unchecked one"; never contributors alone. It keeps "every id, not 'no match at all'" and §6.1's stated content-changed-under-same-ids limit.
5. **`classifySourceFailure` covers both stages.** One function, called by `readSource` around the fetch and the hand-off and by `readerQuery` around the reader statement. `OUR_FAULT = /^(Binder|Catalog|Parser|Syntax) Error/i` returns `null` so the app's own SQL errors travel as themselves; `SOURCE_FAULT` returns §6.1's read sentence; allocation failures return the memory sentence; `CancelledError`/`EngineDeadError` come back by identity (`instanceof`, never `.name` — both classes leave `.name` as `"Error"`). Engine detail goes to `ctx.warn` in `readerQuery`, and only when the error was actually translated. I verified the `^` anchor is safe: `ctx.query` rethrows `new Error(out.message)` with DuckDB's message undecorated (`runQueue.ts`'s `ctx` object), so the category prefix is at position 0 — without that, a `Catalog Error … read_json …` would have fallen through to `SOURCE_FAULT`'s `json` alternative.
6. **The 16 literals, and no `layerTables` factory change.** `grep -rln "rowCount" tests/` returned exactly the brief's 16 files; all 16 now carry both fields, checked with `grep -L "sourceBytes" $(grep -rln "rowCount" tests/)` → **no output**. That check matters because `runQueue.test.ts` and `roofMetricsRun.test.ts` declare their mock registry with an inline type, not `LayerTable`, so `tsc` cannot see them (tsc named only 8 files). `grep -rn 'vi.mock("[^"]*insights/layerTables"'` → **6** factories, the documented baseline, and `git diff src/insights/layerTables.ts | grep '^+export'` → **nothing**: this task added fields to a type, no module export, so no factory needed a change. Confirmed rather than assumed.
7. **`insights/duckdb` mock factories.** The new suite's factory exports everything the module chain touches: `registerBuffer`, `dropBuffer`, `getDuckDBStatus`, `onEngineDeath`, plus `runQuery`, `ddl`, `readFile`, `getDuckDBStatusVersion`, `subscribeDuckDBStatus`, `getEngineGeneration`, `isExtensionLoaded`, `ensureExtension`, `formatDuckDBError`, `initDuckDB`, `queryDuckDB`, `queryParquetBuffer`. I then audited every touched file for a `vi.mock(".../insights/duckdb")` factory against the four names `sourceRead`/`engineAwait` need (a grep, not a green suite — vitest's mock proxy only throws on access): `mapFilterSync`, `scope`, `runQueue`, `roofMetricsRun`, `ExportDialog`, `useLayerQuery`, `TablePanel`, `StatsTabDuckdb`, `CatalogueView`, `useToolForm`, `ToolView`, `engineStopped`, `layerTablesBuild` all already carry all four. `useLayerCounts.test.tsx` lacks `registerBuffer`/`dropBuffer`, but its module under test (`useLayerCounts`) does not reach `sourceRead.ts`, so nothing it imports is missing — left alone rather than padded. `extensionChip.test.tsx` and `roofLayerFixture.tsx` mock `insights/duckdb` not at all and are unaffected.

## Self-review

- **One pre-existing test had to change, and it is a real consequence, not a workaround.** `runQueue.test.ts`'s "loads the tool's extension under its own phase before computing" asserted `phases.indexOf("extension") < phases.indexOf("compute")` for `measure-solids` — now a `needsReader` tool, so the phase after `extension` is `source`, its fake executor never announces `compute`, and `indexOf("compute")` became `-1`. Changed to `< phases.indexOf("source")` with a comment giving §6.1's order and saying Computing is the executor's to announce. The test's intent (the extension phase comes first) is preserved.
- **Two deviations from the brief's letter, both toward its own stated principle.**
  1. The brief enumerates only `roofLayerFixture.tsx` and `useToolForm.test.tsx`'s `readyTable(true)` as reader-backed fixtures, but its rule is "where the fixture describes a reader-backed layer, the honest pair is the reader's own spelling". Two more fixtures are reader-backed: `extensionChip.test.tsx` (`reader: "read_cityjson"`) and `ExportDialog.test.tsx`'s `READER_TABLE` (a real `sourceName` and provider). Both got `extension: "city.json"`; `ExportDialog`'s `FALLBACK_TABLE`, which spreads `READER_TABLE` and nulls the reader, explicitly overrides `extension: null`. Nothing in those paths reads `extension`, so no behaviour changed. `useToolForm`'s shared `readyTableInfo(withReader)` uses `extension: withReader ? "city.json" : null`, matching the conditional style of the three fields above it.
  2. Three `no-useless-spread` lint warnings appeared from the brief's `for (const listener of [...deathListeners]) listener();`, taking `vp check` to 59. Replaced with one `fireEngineDeath()` helper that drains with `deathListeners.splice(0)`. That is both lint-clean and truer to the primitive: `onEngineDeath` fires once and drops its waiters, and `raced`'s unsubscribe splices this same array, so a live iteration would skip listeners. Back to 0 errors / 56 warnings.
- The `import type { ToolContext } from "./runQueue"` is type-only and erased; `runQueue.ts` does not import `sourceRead.ts`, so there is no runtime cycle. `sourceRead.ts` imports no `@duckdb/duckdb-wasm` and reaches the engine only through `insights/duckdb.ts`.
- `readerQuery`'s `if (!out.ok) throw new Error(out.message)` is defensive (`ctx.query` already throws); the throw lands in its own `catch` and is classified like any other, which is the intended behaviour, not a leak.

## Concerns for the reviewer / later tasks

1. **The workload note is reachable for an unimplemented tool.** `ToolView` has no `implemented` early return — `CatalogueView`'s `ToolRow` calls `openToolView(tool.id)` on click even when `aria-disabled`, so today a user can open "Measure solids" and see the OUTPUT fieldset. Every `needsReader` tool is `implemented: false` until Task 8, so the note cannot fire in practice (and `sourceBytes` is null in every current fixture), but the Global Constraint "no unimplemented tool may claim a fact about the user's data" is adjacent. I followed the brief and did **not** gate on `tool.implemented`, on the precedent that the extension note is already ungated. If the reviewer wants it gated, it is one `&&` in `useToolForm.ts`.
2. **`sourceBytes` is `null` in every reader-backed test fixture.** That is what the brief specifies, but the field's doc says "null when there was none", so a reader-backed fixture with `sourceBytes: null` is strictly a fixture that declines to model the size. `layerTablesBuild.test.ts` is the one place the real number is asserted (16, from the mocked `new Uint8Array(16)` provider at `:187/:192`, verified on disk), which is what pins the capture-before-detach ordering.
3. **`assertSourceIds` has no caller yet** — by design; Tasks 7 and 10 call it with their scope-row ids. Its doc comment is the contract, and a reviewer of those tasks should check they pass the scope-rows set and not `ctx.featureIds`.
4. **`readerQuery`'s `label` parameter is passed straight through to `ctx.query`** and otherwise unused; it exists so the reader statement shows a descriptive log entry. Nothing to do, just noting it is not dead.
5. **No `ctx.phase("compute")` caller yet.** The run now sits in `"source"` for a reader-backed tool until an executor announces Computing. Tasks 7/10 must call `ctx.phase("compute")` once their handle is open, or a reader-backed run will show "Reading source" for the whole compute. The runQueue test's fake executors deliberately do not, which is why the extension-phase assertion above compares against `source`.

---

## Fix round 1

Review: `.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-5-review.md` — "Needs fixes", no Critical, one Important, two Minor. All three addressed. Worked on top of `b87f92e` (Task 4's fix, which landed after `9fb094a`); `git status` was clean apart from the two pre-existing untracked dirs.

**Commits (three, one change each, no trailers, not pushed):**

| Commit    | Message                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `647f61a` | `fix: a reader-backed run enters Reading source before its scope query`   |
| `10c1c73` | `docs: a refused hand-off is not a race the engine's death could win`     |
| `25aa419` | `test: the provider answers every read, against a hand-off that detaches` |

### Important — enter `source` before scope resolution

The reviewer is right, and the brief's own snippet was wrong: the single `patch` that set the phase sits after `await raced(resolveScope(...), signal)`, so while that statement was in flight a reader-backed run whose extension was already loaded still read `phase: null` / `status: "queued"`.

`runQueue.ts` now opens the phase on the far side of the pre-flight refusals and the extension load and **before** `resolveScope`:

```ts
if (tool.needsReader) patch(id, { status: "running", phase: "source" });
```

with a comment giving §6.1's order and stating that this is the PHASE only — the bytes are still registered by the executor through `readSource`, which needs the scope's ids. The later `patch` keeps `phase: tool.needsReader ? "source" : "compute"`, restated as "a reader-backed run STAYS in Reading source", so a non-reader tool's transition to Computing is unchanged and a reader-backed run does not fall out of the phase it just entered.

**Two real-queue tests added** (`tests/unit/features/processing/runQueue.test.ts`, in the `"the Reading source phase (spec §6.1)"` describe), both using the suite's own `gate` seam to hold the scope statement pending — `gate = { needle: "COUNT(DISTINCT", promise: held.promise }`:

1. `"opens Reading source BEFORE the scope query, not after it"` — `measure-solids` with `isExtensionLoaded` true; waits until the scope statement is in the log, then reads the record **while the gate still holds it** and asserts `phase === "source"` and `status === "running"`; releases and waits for `done`. The comment says explicitly why the executor-entry assertion cannot see this defect.
2. `"never opens the source phase for a tool that needs no source"` — `height-from-extent`; asserts `phase` is `null` while its scope query is pending, and that the recorded phase sequence contains `"compute"` and never `"source"`.

**RED, with the fix line removed:**

```
$ npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Reading source"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected null to be 'source' // Object.is equality
      Tests  1 failed | 2 passed | 57 skipped (60)
```

`expected null to be 'source'` is exactly the defect the reviewer described. **GREEN:** `npx vitest run tests/unit/features/processing/runQueue.test.ts` → `Tests 60 passed (60)`.

### Minor — the race explanation was wrong

`sourceRead.ts`'s `if (!registered)` comment and the matching test comment both said `raced(…, signal)` "races the ABORT signal only, so a death does not reject it". `raced` races the death too. The true reason the race cannot separate the two meanings of `false` is `engineAwait.ts`'s documented "ONE LIMIT, by construction": `onEngineDeath` fires once per engine and drops its waiters as it fires, so a hand-off **started** after the engine has already gone hears nothing and simply resolves `false`. Both comments now say that, and cite `engineAwait.ts` rather than asserting a property of `raced` it does not have. No behaviour changed — the `getDuckDBStatus().state !== "ready"` split is still correct, and for this reason. `grep -n "ABORT signal only\|abort only"` over both files → no output.

### Minor — repeated-read coverage

New case, `"calls the provider on EVERY read, against a hand-off that DETACHES"`. The `registerBuffer` mock now detaches the array it is handed the way the real hand-off does — `structuredClone(bytes.buffer, { transfer: [bytes.buffer] })` — records each `byteLength`, and the test reads the same layer twice under two run ids with one shared provider. It asserts `calls === 2`, `handed === [4, 4]` (the second `4` being the point: a LIVE array reached the second hand-off) and that the second read's `from` carries its own VFS name. The hoisted mock's signature gained `(_name: string, _bytes: Uint8Array)` so an implementation can read its argument.

**Proof the detaching mock has teeth** (throwaway copy of the suite whose provider returns one cached array, as a broken one would; deleted afterwards):

```
FAIL  …__detachprobe.test.ts > readSource > calls the provider on EVERY read, against a hand-off that DETACHES
Error: Could not re-read the source (network or decompression error)
 ❯ readSource src/features/processing/sourceRead.ts:270:43
      Tests  1 failed | 25 skipped (26)
```

The second hand-off of an already-detached buffer throws, `readSource` classifies it as §6.1's read failure, and the case fails hard — so the assertion is not vacuous.

### Gates, re-run after the fixes

| Gate                                                                     | Result                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `npx vitest run tests/unit/features/processing/sourceRead.test.ts`       | 26 passed                                                            |
| `npx vitest run tests/unit/features/processing/runQueue.test.ts`         | 60 passed                                                            |
| `npx vitest run tests/unit/features/processing tests/unit/ui/processing` | 24 files, 309 passed                                                 |
| full app suite → `/tmp/m3-task5-fix1-suite.log`                          | **245 files passed, 4 skipped; 3038 passed, 68 skipped; `suite: 0`** |
| `npx tsc -b --noEmit`                                                    | exit 0                                                               |
| `npx vp check`                                                           | **0 errors and 56 warnings in 535 files**                            |

`vp check` flagged formatting in one file after the edits; `npx vp check --fix` fixed it before the commits, and the pre-commit hook found nothing further. `git diff HEAD --quiet` → clean; `git status --short` shows only `.github/hooks/` and `docs/design-history/`, neither staged.

### Concerns after fix round 1

1. Unchanged from the first report and confirmed by the reviewer as Task 8's: the workload note is reachable for an `implemented: false` tool because `ToolView` has no early return. Not gated, per the commander's ruling.
2. Still no `ctx.phase("compute")` caller. The window a reader-backed run now spends in `"source"` is wider than before (it covers the scope query as well), so Tasks 7/10 announcing Computing once their handle is open matters more, not less.
3. `assertSourceIds` still has no caller; its doc comment is the scope-rows contract Tasks 7/10 must honour.
