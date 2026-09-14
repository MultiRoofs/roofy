# Task 21 — Derived city layers — report

**Status:** DONE. Three commits on `develop`, base `48884b9`, nothing pushed, no trailers of any
kind (`git log -3 --format=%B` checked), hooks not bypassed, the plan untouched. Nothing staged
from `.github/hooks/`, `docs/design-history/` or `.superpowers/`; `git status --short` is clean
apart from those two untracked directories.

- `10b16f5` `chore: every layer records whether it was derived`
- `0307e11` `feat: prepare a derived city layer's model, table and row as one publication`
- `8a4baf7` `fix: a cancelled write in a derived layer's preparation throws CancelledError`

## Implemented

### `src/features/layers/layerStore.ts` (the `chore:` commit)

- `export interface DerivedFrom { layerId; layerName; runId }`.
- `Layer.derivedFrom: DerivedFrom | null` — **REQUIRED**, not optional. Not added to `App.tsx`'s
  explicit serialisation list (a derived layer is omitted from the snapshot by construction).
- `addLayer`'s input: `"derivedFrom"` joins `"isStreaming"` in the `Omit` union, plus optional
  `derivedFrom?: DerivedFrom | null` (defaults `null`) and `insertAfterId?: string`.
- The one `set` call now builds a **named, `: Layer`-annotated** record (so a future required field
  is a compile error here) and splices it in after `insertAfterId`; an id that is not in the list
  appends. `insertAfterId` is destructured OUT of the input before the spread, so it never lands on
  the record.

### `src/insights/layerTables.ts`

- `LayerTable.sourceFeatureIds: ReadonlyArray<string> | null` (required); `null` at both build
  sites (`buildFromReader`'s return and the flat-fallback return).
- `nextTableName()` — `` `layer_${++counter}` `` from the SAME module counter the builds use.
- `adoptLayerTable(layerId, info)` — seeds `registry` + the store as `ready`, synchronously, with
  no `enqueue`, no DESCRIBE, no source parking.

### `src/features/processing/scope.ts`

`resolveScope`'s "all" branch now asks a table that carries `sourceFeatureIds` for its own ROW ids
(`SELECT "id" FROM <table>`), refuses an empty one with the existing "Nothing to run on
(0 buildings)" sentence, and reports `total: cut.length` (the list it was cut with). An ordinary
table still answers `featureIds: null`. Signature and return type unchanged.

### `src/features/processing/runQueue.ts` — ONE line (plus its comment)

`partial: scope.featureIds === null || scope.count >= scope.total ? null : …` inside
`publishProvenance`. Nothing else; Task 22 owns the destination branch.

### `src/features/processing/deriveLayer.ts`

`DerivedPlan` and `prepareDerivedCityLayer({runId, parent, parentTable, name, rowIds, columns,
rows, signal, query})`:

- roots query (`SELECT DISTINCT COALESCE("feature_id","id") AS f … WHERE "id" IN (…)`) through the
  run's own `query`, so both statements reach §6.4's log; an empty answer throws "Layer changed
  while running; run again" rather than sending `IN ()`;
- `CREATE TABLE <new> AS SELECT * FROM <parent table>[ WHERE COALESCE("feature_id","id") IN (…)]`;
- `writeComputedColumns` into the COPY with `existing: new Set()`, `raced` against the engine's
  death; any failure on either statement drops the table and rethrows — a CANCELLED write rethrows
  `CancelledError`, exactly as `execute`'s own write does, so Task 22's catch reads it as
  "cancelled" and not as "failed: Cancelled";
- the model subset (scoped roots + parts, the run's values merged into `attributes`) with its OWN
  `bbox` from `selectedObjectBounds`, falling back to the parent's when the subset unions to
  nothing; scope "all" keeps the parent's envelope;
- the `LayerTable` copy: parent's `sourceName`/`source`/`reader`/`extension`/`sourceBytes`/`lods`
  verbatim, `columns` = parent's minus the run's (case-insensitive) plus the run's, `rowCount` the
  subset's rows, `sourceFeatureIds: roots`;
- `publish()` (synchronous): `adoptLayerTable` → copy the parent's provenance entries under the new
  id → `disambiguate` the name → `addLayer({ id, insertAfterId: parent.id, derivedFrom, rules
copied, colour mode/colours/appearance copied })` → `setLayerLod` + `setLodMode` (the parent's
  COMPLETE LoD state) → `activateLayer`. Returns the new layer id;
- `discard()` = the same raced, swallowed `DROP TABLE IF EXISTS`.

The module's header doc was corrected: the name rules are still pure, the preparation is not.

### `src/features/layers/layerTableLifecycle.ts`

Both streaming-rebuild paths skip a derived layer: the add branch (`… && layer.derivedFrom ===
null`) and `sweepStreamingLayers` (`if (!layer.isStreaming || layer.derivedFrom !== null) continue`).

## Tested + results

New/extended suites:

- `tests/unit/insights/layerTablesBuild.test.ts` +2 (the counter, the adopted READY entry in BOTH
  the store and the registry).
- `tests/unit/features/layers/layerStore.test.ts` +4 (`derivedFrom` recorded/`null`, the splice,
  the append fallback, `insertAfterId` not leaking onto the record).
- `tests/unit/features/processing/scope.test.ts` +3 (derived "all" → row ids and the exact
  statement, ordinary "all" → null, empty derived table refused).
- `tests/unit/features/processing/deriveLayer.test.ts` +15 (8 name cases kept → 23 total).
- `tests/unit/features/layers/layerTableLifecycle.test.ts` +1 (derived layer never enqueued, by the
  subscription OR the consumer sweep).
- `tests/unit/features/processing/runQueue.test.ts` +1 (the stale watcher and a first `ready`
  entry).

### TDD evidence

**RED 1 — `Layer.derivedFrom` and `insertAfterId`**

```
$ npx vitest run tests/unit/features/layers/layerStore.test.ts
 FAIL … > records its parent, and every other layer records none
   AssertionError: expected undefined to be null
 FAIL … > is INSERTED directly under its target, not appended (§6.2)
   AssertionError: expected [ …(3) ] to deeply equal [ …(3) ]
 FAIL … > does not leak `insertAfterId` onto the record
   AssertionError: expected [ 'name', 'model', 'modelRef', …(18) ] to not include 'insertAfterId'
 Tests  3 failed | 24 passed (27)
```

(The fourth case — "appends when `insertAfterId` names a layer that is not there" — passes against
the append-only store, which is the point: the fallback is the OLD behaviour.)

**GREEN 1** — `Tests 27 passed (27)`.

**RED 2 — `nextTableName` / `adoptLayerTable`**

```
$ npx vitest run tests/unit/insights/layerTablesBuild.test.ts
 FAIL … > mints a name from the SAME counter an ordinary build uses
   TypeError: nextTableName is not a function
 FAIL … > seeds a READY entry that nothing will rebuild
   TypeError: adoptLayerTable is not a function
 Tests  2 failed | 52 passed (54)
```

**GREEN 2** — `Tests 54 passed (54)`.

**RED 3 — scope "all" on a derived table**

```
$ npx vitest run tests/unit/features/processing/scope.test.ts
 FAIL … > resolves to the table's OWN row ids, not to null
   AssertionError: expected { ok: true, featureIds: null, …(2) } to deeply equal { ok: true, …(3) }
 FAIL … > refuses an EMPTY derived table rather than sending `IN ()`
   AssertionError: expected { ok: true, featureIds: null, …(2) } to deeply equal { ok: false, …(1) }
 Tests  2 failed | 13 passed (15)
```

**GREEN 3** — `scope.test.ts` + `runQueue.test.ts` green; the whole
`tests/unit/features/processing` directory `31 files | 580 passed`.

**RED 4 — `prepareDerivedCityLayer`**

```
$ npx vitest run tests/unit/features/processing/deriveLayer.test.ts
 TypeError: prepareDerivedCityLayer is not a function   (× 15)
 Tests  15 failed | 8 passed (23)
```

**GREEN 4** — `Tests 23 passed (23)`.

**RED 5 — the lifecycle and a derived layer**

```
$ npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts
 FAIL … > never rebuilds a DERIVED layer's table from a resident set
   AssertionError: expected [ 'L1', 'L2' ] to not include 'L2'
 Tests  1 failed | 26 passed (27)
```

**GREEN 5** — `Tests 27 passed (27)`.

**RED 6 — the stale watcher, by FALSIFICATION.** `installStaleWatcher` is already correct by
construction (a first entry has `before === undefined`, so `rebuilt` is false), so the new case
went green on the first run. It was proved to bite by mutating the watcher:

```
# rebuilt = … || before?.state === "building" || before === undefined
 FAIL … > leaves a run alone when a FIRST ready entry appears — an adoption, not a rebuild
   AssertionError: expected true to be false
# reverted
 Tests  71 passed (71)
```

The mutation was reverted; `git diff` of `runQueue.ts` against the chore commit is the one
`partial` hunk only (checked in the diff, quoted in the commit).

**RED 7 — a cancelled write's ERROR CLASS** (found in self-review, on the advisor's prompt). The
two rejection assertions were `rejects.toThrow()`, which any `Error` satisfies. Tightened to the
class each path must produce, and the cancel case went red:

```
$ npx vitest run tests/unit/features/processing/deriveLayer.test.ts
 FAIL … > drops the table when a CANCEL lands before publication
   AssertionError: expected Error: Cancelled to be an instance of CancelledError
 Tests  1 failed | 22 passed (23)
```

`raced(writing, null)` does NOT watch the signal (that is deliberate — it races the DEATH), so a
cancel is seen by `writeComputedColumns`' own pre-COMMIT check and comes back as
`{ ok: false, cancelled: true, message: "Cancelled" }`. The preparation threw `new Error(message)`
for it, which `execute`'s catch classifies as a FAILURE. Fixed with `runQueue.ts`'s own two-line
translation (`throw written.cancelled ? new CancelledError() : new Error(written.message)`).

**GREEN 7** — `Tests 23 passed (23)`; full suite `suite: 0` again before the `fix:` commit.

### Gates

```
$ npx tsc -b --noEmit                                    → 0
$ npx vp check       → Found 0 errors and 56 warnings in 579 files   (baseline held)
$ npx vitest run > /tmp/m3-task21-sweep.log 2>&1 & wait $!   → suite: 0   (before the chore commit)
     Test Files 273 passed | 4 skipped (277) · Tests 3558 passed | 96 skipped (3654)
$ npx vitest run > /tmp/m3-task21.log 2>&1 & wait $!         → suite: 0   (before the feat commit)
     Test Files 273 passed | 4 skipped (277) · Tests 3580 passed | 96 skipped (3676)
$ npx vitest run > /tmp/m3-task21-fix.log 2>&1 & wait $!     → suite: 0   (before the fix commit)
     Test Files 273 passed | 4 skipped (277) · Tests 3580 passed | 96 skipped (3676)
```

`tsc -b --noEmit` and `vp check` (0/56) were re-run after the fix as well.

`vp check` momentarily read **57** warnings: `[...deathListeners]` in the new duckdb mock tripped
`unicorn(no-useless-spread)`. Fixed (the Set is iterated and each listener deleted as it fires,
which is also closer to `duckdb.ts`'s own one-shot death) rather than accepted; the final number is 56.

## Files changed

`chore:` commit (25 files): `src/features/layers/layerStore.ts`;
`tests/unit/features/layers/layerStore.test.ts` (+4 cases) and the `derivedFrom: null` sweep across
**22** fixture files plus `layerTableLifecycle.test.ts` (see "Deviations" 1).

`fix:` commit (2 files): `src/features/processing/deriveLayer.ts` (+ the `CancelledError` import)
and `tests/unit/features/processing/deriveLayer.test.ts` (both rejection assertions tightened from
`toThrow()` to the CLASS).

`feat:` commit (33 files): `src/insights/layerTables.ts`,
`src/features/processing/deriveLayer.ts`, `src/features/processing/scope.ts`,
`src/features/processing/runQueue.ts`, `src/features/layers/layerTableLifecycle.ts`; the **7** of the 9
`vi.mock(".../insights/layerTables")` factories that needed the two new names explicitly
(`addCityLayer`, `useLayerFileLoader`, `measureSolidsRun`, `validateSolidsRun`, `roofMetricsRun`,
`runQueue`, `crossLayerRun`; the other two — `appCityParquetLayers` and `layerTableLifecycle` —
spread `importOriginal` and inherit them); the `sourceFeatureIds: null` sweep across 23 `LayerTable`
literal sites in `tests/`; and the five test files listed above.

## How each controller requirement was met

1. **Residual C8.** The bounds case publishes the subset, keeps the id `publish()` returned,
   publishes the whole copy, keeps ITS id, and reads both through
   `layers.find(l => l.id === id)`. It then re-asserts the subset's bbox AFTER the second
   publication, which is the assertion the index-based version got wrong (the second copy is
   spliced in at index 1 and pushes the first to index 2).
2. **Round-1 C5.** `model.bbox` is `selectedObjectBounds({objects}, Object.keys(objects))` for a
   subset — the fixture's `b` sits 100 m from `a`, so `[0,0,0,10,10,9]` vs the parent's
   `[0,0,0,110,110,9]` is a real discrimination — and the parent's own bbox for scope "all".
   `publish()` copies `selectedLod` AND `lodMode`, pinned by "copies a MANUAL LoD choice, mode
   included".
3. **Residual C12.** No source-string assertion anywhere. The regression is behavioural: the
   preparation runs INSIDE a slot of the mocked one-chain queue, `enqueueLayerTable` is asserted
   never called, `runOnTableQueue` is asserted called exactly once across preparation AND
   publication, and a FOLLOWING `runOnTableQueue` task is awaited at the end — which is what a
   nested enqueue would hang.
4. **`Layer.derivedFrom` is REQUIRED.** `grep -rn "): Layer\b" tests/` first (45 helpers), then
   `tsc` named the real list. The sweep is its own `chore:` commit, ahead of the feature commit.
   The field is NOT in `App.tsx`'s serialisation list — by construction: `App.tsx` is not among the
   files this task changed.
5. **Mock factories.** `grep -rln 'vi.mock(.*insights/layerTables' tests/` returns **9**, not the 7
   the requirement quotes (`measureSolidsRun.test.ts` and `validateSolidsRun.test.ts` are the extra
   two — both authored by earlier M3 tasks). All 9 are covered: 7 gained the two names explicitly,
   2 inherit them through `importOriginal`. `runQueue.test.ts` and `roofMetricsRun.test.ts` back
   them with the module-level `adopted` map and `mockTableCounter`, reset in `beforeEach`; the
   other five use the same two lines with a factory-local map. The new `deriveLayer.test.ts` duckdb
   factory exports everything the tree under test imports (the suite passes, which is the proof).
6. **`runQueue.ts` is one line.** See the diff quoted above — nothing else in that file changed.
7. **Log labels** are the plan's descriptive ones ("Selecting the copy's features", "Creating the
   new layer's table"); both are honest names for the statement they carry. Every full-suite run
   was backgrounded with `& wait $!; echo "suite: $?"` to a file.
8. **`publish()` and `discard()` are the only visible effects.** "publishes NOTHING before
   publish()" pins the store and `adopted` after a completed preparation. Three end-to-end paths go
   through a slot of the (one-chain) mocked FIFO: SUCCESS (table adopted, row spliced under the
   parent, layer activated), CANCEL-before-publish (an aborted signal reaches the raced write →
   rejects → DROP, nothing published) and DEATH-before-publish (the fake engine dies during
   `BEGIN TRANSACTION`; the raced write rejects with `EngineDeadError` → DROP, nothing published).
   Plus `discard()` itself on a healthy preparation.

## Deviations from the brief (each named)

1. **The `Layer` fixture sweep is 22 files, not 12, and one more file needed it for a BEHAVIOURAL
   reason.** The plan's "20 of the 32 end in `as Layer` and need nothing" is false for two kinds of
   cast: a fixture that spreads `...patch: Partial<Layer>` gets `derivedFrom?: … | undefined`
   (TS2322), and `as Layer` over a literal missing a required field is TS2352 ("neither type
   sufficiently overlaps"). `tsc` named all 22. Separately,
   `tests/unit/features/layers/layerTableLifecycle.test.ts`'s `layer()` fixture is an `as Layer`
   cast that COMPILES without the field — but the new guard compares `layer.derivedFrom === null`,
   and `undefined` would have made every existing streaming-enqueue case in that file fail. It
   carries `derivedFrom: null` too. **Code contradicts the brief here; the code wins.**
2. **`LayerTable` literals in `tests/` needed `sourceFeatureIds: null` in 23 places** (the brief
   lists 17 files). Four of them are the loosely-typed `tableInfo` fakes inside mock factories,
   which `tsc` does NOT name: `runQueue`, `roofMetricsRun`, `measureSolidsRun`,
   `validateSolidsRun`. Without them `resolveScope` reads `undefined`, `undefined !== null` is
   true, and every run in those suites took the derived branch and failed. Found by running the
   suites, fixed in the fixtures rather than by loosening the `cut !== null` test the plan
   prescribes (the field is required and non-optional, so `undefined` is only ever a fixture bug).
3. **`derivedFrom.layerName` is read from the store at `publish()` time** (with `parent.name` as
   the fallback for a parent that has been removed), not captured at prepare time. The field's own
   doc comment says "a COPY of the parent's name AT PUBLICATION", and the brief's code captured it
   one step earlier; both satisfy every test, and this matches the comment.
4. **The bounds test is the C8 version** (ids, not indices) — requirement 1.
5. **Two cases the brief does not list** (cancel-before-publish, death-before-publish) — requirement
   8 — and one in `runQueue.test.ts` for the stale watcher, which the brief's Step 1 deferred to
   Task 22. The controller requirement outranks the brief there.
6. **No `sourceRead.ts` edit.** The plan's doc comment lists "`readSource`'s reader `FROM`" as one
   of the three readers that must AND the filter in; in the shipped code that AND-in IS
   `resolveScope`'s answer — `ctx.featureIds` → `buildSourceIdsSql({ from, ids })` /
   `buildScopeRowsSql` in every executor — which is exactly why the plan also says "every executor,
   `buildProxySql` and `buildSolidMeasureSql` need no change at all". Nothing in `sourceRead.ts`
   reads a `LayerTable`. Stated here so a reviewer does not go looking.

## Self-review / concerns

- **`rowCount` for a subset is a count of ROWS, not features** (`input.rowIds.length`), while the
  parent's `rowCount` is also rows — so the grid's "N rows" stays consistent. It is not the
  feature count the cards use; nothing reads it as one today.
- **A derived layer of a derived layer** would copy `sourceFeatureIds` from … no: the copy's
  `sourceFeatureIds` is always the roots THIS cut used, so a grandchild's filter is its own, narrower
  list, and its `source` is still the original parent's. That is correct, and untested here because
  nothing can create a derived layer until Task 22.
- **`publish()` writes no provenance for the run's OWN columns** — deliberate (Task 22 owns
  `tool.name` and the scope sentence, through `publishProvenance`). Until then a derived layer's new
  columns carry no badge; only this task's tests can see that.
- **`discard()` after `publish()` would drop a live table.** Nothing calls it that way, and Task 22
  must keep it that way (the plan's contract is "publish LAST, discard only on the failure path").
  Not defended in code, because a guard would hide a caller bug rather than fix it.
- **The `adopted` map in `runQueue.test.ts` / `roofMetricsRun.test.ts` has no assertion yet** — it
  exists for Task 22, as the brief asks. It is written to by the factory, so it is not dead.
- **A malformed derived table would be adopted anyway.** `adoptLayerTable` does no DESCRIBE, so the
  `columns` list is whatever the caller computed. That is the plan's decision (publication is
  synchronous); the "describes the copy's table WITH the columns just written into it" case is what
  keeps the caller honest.
- **No browser check.** Nothing in this task is reachable from the UI: no tool declares
  `destinations: ["new"]`, so `prepareDerivedCityLayer` has no caller until Task 22, and no CSS,
  markup or copy changed. The one user-visible surface this task touches at all — the layer list's
  order — changes only for a caller that passes `insertAfterId`, and there is none yet.
