# Task 24 — A derived layer in the layer list, the snapshot and the export — report

**Status:** DONE. Five commits on `develop`, base `64873a2`, nothing pushed, **no trailers of any
kind** (`git log -5 --format=%B | grep -iE "co-authored|claude-session"` → none), hooks never
bypassed, `core.hooksPath` untouched, the plan untouched. Nothing staged from `.github/hooks/`,
`docs/design-history/` or `.superpowers/` — `git status --short` is clean apart from those two
untracked directories.

- `220376a` `feat: a derived layer's row names its parent, its run log and that it is not saved`
- `4465b64` `feat: a derived layer is omitted from the snapshot and from a share link`
- `b6a1649` `test: LeftPanel's layer fixture carries the required derivedFrom field`
- `f8e1c70` `feat: a derived layer's CityParquet export carries only its own features`
- `45baa29` `docs: the share filter's comment states what the URL filter does not cover`

**Bisect note:** `220376a` is RED on its own — it fails `tests/unit/ui/sidebar/LeftPanel.test.tsx`
(8 of 10 cases, see the TDD evidence below), and `b6a1649` is the repair. Interactive rebase is
unsupported on this host, so the fix is a follow-up commit rather than a fix-up; the pre-push hook
would refuse `220376a` without `b6a1649`, and the two must travel together.

## Implemented

### 1. The row (`220376a`)

- **`src/features/layers/layerPresentation.ts`** — `LayerStateInput.derivedFrom?: { layerName } |
null` (structurally typed, not `DerivedFrom`: this module words a sentence and needs one field
  of it). `layerStateLine` keeps its two refusals (`error`, then `unavailable`) and then appends
  `· Derived from <name>` ONCE, after the per-kind sentence, which moved into a new private
  `kindStateLine`. The switch body is byte-identical.
- **`src/ui/layers/LayerRow.tsx`** — two props: `derived?: boolean` and
  `onShowRunLog?: (() => void) | null`. The marker renders as a THIRD child of
  `.layer-row-body`, and `onShowRunLog={onShowRunLog}` is passed to `LayerRowMenu` **verbatim, no
  `?? null`** (with the comment saying why).
- **`src/ui/layers/LayerRowMenu.tsx`** — the same three-state prop and the `Show run log` item
  after `Open table`: absent for `undefined`, present-and-`disabled` for `null`.
- **`src/app/app.css`** — `.layer-row-derived` beside `.layer-row-state-line`.
- **`src/ui/layers/LayerList.tsx`** — `derivedFrom` fed into BOTH the `city` and the `vector`
  `LayerStateInput`, and `derived` / `onShowRunLog` onto the row, off ONE binding
  (`const derivedFrom = item.layer.derivedFrom` — no branch, because `Layer` and `GeoLayer` carry
  the same shape, and no non-null assertion). `runById` from `features/processing/processingStore`,
  `openRunLog` from `ui/processing/revealTools`.

### 2. The snapshot and the share link (`4465b64`)

- **`src/app/snapshotLayers.ts`** (new) — `snapshotLayers({layers, geoLayers, activeLayerId})`
  returns `{ layers, geoLayers, activeLayer, derivedCount }`, generic over `{ id, derivedFrom }`,
  and `derivedNotSavedNote(count)`. The active index is searched in the FILTERED arrays, so a
  derived active layer is simply not found and the reference is omitted.
- **`src/app/App.tsx`** — `handleSave`: the `resolveActiveLayer` binding and the hand-written
  `indexOf` ternary are GONE, replaced by one `snapshotLayers` call; `layers:` and `geoLayers:`
  map over `selection.layers` / `selection.geoLayers`; the success toast appends
  `derivedNotSavedNote(selection.derivedCount)` when it is non-null. `handleShare`: the layer
  array now goes through `snapshotLayers(...).layers` as well as the existing
  `modelRef.type === "url"` filter (which does not stand in for it). The stale "The ACTIVE layer names the snapshot" paragraph went
  with the binding it described; the `label` comment beneath it stayed. The `resolveActiveLayer`
  IMPORT stays — `App.tsx:2039` (the zoom request) still calls it.

### 3. The export (`f8e1c70`)

- **`src/insights/sql.ts`** — `buildCityParquetSourceSql` gains a REQUIRED
  `sourceFeatureIds: ReadonlyArray<string> | null`, ANDed into the `WHERE` beside the existing
  scope clause as a plain `COALESCE("feature_id", "id") IN (...)` (not a second
  `buildFeatureScopeWhere`, which subqueries the layer TABLE — correct for the user's filter,
  circular here). An EMPTY list is spelled `FALSE`, mirroring `buildCityParquetModuleSql`'s answer
  for an empty module, because `IN ()` is a syntax error.
- **`src/insights/export.ts`** — `CityParquetExportRequest.sourceFeatureIds` and the one line that
  passes it to the builder.
- **`src/ui/table/ExportDialog.tsx`** — `sourceFeatureIds: table.sourceFeatureIds` on the
  CityParquet request literal.

No change was needed to make a derived layer's Export OFFER CityParquet (Decisions recorded item
4): `canCityParquet` reads `table.reader`/`source`/`lods` + `epsg`, and Task 21's derived
`LayerTable` copies all four from the parent — so the format is already listed. A flat parent's
copy (`reader: null`) already falls to the attribute formats. Both are now covered by tests rather
than assumed.

## Tested + results

New:

- `tests/unit/ui/layers/derivedLayerRow.test.tsx` — 8 cases (4 state-line, including the "outranked
  by `error` AND by `unavailable`" pair, + 4 row/menu).
- `tests/unit/app/derivedSnapshot.test.tsx` — 10 pure cases (the brief's 5 + a GEO index case, an
  identity case, + 3 for the toast sentence).
- `tests/unit/app/appDerivedLayers.test.tsx` — 5 cases through the REAL `App` (see requirement 1).

Extended: `tests/unit/insights/sqlExport.test.ts` (+5), `tests/unit/insights/exportCityParquet.test.ts`
(+1), `tests/unit/ui/table/ExportDialog.test.tsx` (+2), `tests/unit/ui/layers/LayerList.test.tsx`
and `tests/unit/ui/sidebar/LeftPanel.test.tsx` (`derivedFrom: null` on the two `as Layer`
fixtures), `tests/integration/duckdb/layerTables.test.ts` (+2 `sourceFeatureIds: null`).

### Gates

```
$ npx tsc -b --noEmit                       → clean (rc 0)
$ npx vp check   → Found 0 errors and 56 warnings in 587 files      (baseline held)
$ npx vitest run > …/m3-task24-b.log 2>&1 &  wait $!; echo "suite: $?"
  suite: 0
  Test Files  279 passed | 4 skipped (283)
  Tests  3684 passed | 96 skipped (3780)          (was 3641 at Task 23)
```

Focused, while iterating: `tests/unit/ui/layers tests/unit/features/layers` → 25 files / 427
passed; `tests/unit/app tests/unit/persistence` → 22 files / 212 passed;
`tests/unit/insights tests/unit/ui/table` → 30 files / 482 passed.

## TDD evidence

**RED 1 — the state line and the row**, before any production change:

```
$ npx vitest run tests/unit/ui/layers/derivedLayerRow.test.tsx
 × adds §6.2's 'Derived from' tail after the LoD
     AssertionError: expected '312 buildings · LoD 2.2' to be '312 buildings · LoD 2.2 · Derived fro…'
 × adds the tail to a derived VECTOR layer too
     AssertionError: expected '6 features' to be '6 features · Derived from Zones'
 × marks itself 'Derived · not saved in workspaces' (§6, §8)
     Unable to find an element with the text: Derived · not saved in workspaces
 × offers 'Show run log' and calls it
     Unable to find an accessible element with the role "button" and name "Show run log"
 × disables 'Show run log' when the run has left the history
     Unable to find an accessible element with the role "button" and name "Show run log"
 Tests  5 failed | 3 passed (8)
```

(The three that pass are the ordinary-layer cases — which is the point: they must keep passing.)

**GREEN 1** — `tests/unit/ui/layers tests/unit/features/layers` → `427 passed (427)`.

One authoring fix on the way, worth recording because the BRIEF's code has it too: the brief's
cases inline a full `{ layerId, layerName, runId }` literal into `LayerStateInput.derivedFrom`,
which is `{ layerName }` — TypeScript's excess-property check rejects that (TS2353, four sites,
named by `tsc -b` and by `vp check`). Fixed by binding two real `DerivedFrom` constants and
passing those, which also makes the case say something stronger: the record `LayerList` actually
holds is assignable to the structural field.

**RED 2 — the snapshot and the share link:**

```
$ npx vitest run tests/unit/app/derivedSnapshot.test.tsx tests/unit/app/appDerivedLayers.test.tsx
 Error: Failed to resolve import "../../../src/app/snapshotLayers" …   (the pure file)
 × omits it from the snapshot and repoints the active index
     AssertionError: expected [ 'Delft', 'Delft · solids', …(1) ] to deeply equal [ 'Delft', 'Rotterdam' ]
 × omits a derived GEO layer too, and counts both kinds in the toast
     AssertionError: expected [ 'Zones', 'Zones · buildings' ] to deeply equal [ 'Zones' ]
 × says §8's singular sentence for one skipped layer
     Unable to find an element with the text: /Workspace saved.*1 derived layer is not saved…/
 × mints a link that does not carry it — decoded
     AssertionError: expected [ 'Delft', 'Delft · solids', …(1) ] to deeply equal [ 'Delft', 'Rotterdam' ]
 Tests  4 failed | 1 passed (5)
```

The share failure is Strand C round-2 finding 4 reproduced exactly: the derived layer inherits its
parent's `modelRef`, passes `modelRef.type === "url"`, and lands in the hash. The one case that
passed is "leaves the ordinary toast alone when nothing was skipped" — the regression guard.

**GREEN 2** — `tests/unit/app tests/unit/persistence` → `212 passed (212)`.

**RED 3 — the export, at all THREE seams** (builder, writer, dialog), before any production change:

```
$ npx vitest run tests/unit/insights/sqlExport.test.ts \
    tests/unit/insights/exportCityParquet.test.ts tests/unit/ui/table/ExportDialog.test.tsx
 × ANDs the layer's own feature ids into the where clause
 × combines it with a user filter rather than replacing it
 × quotes an id that carries a quote, rather than breaking the statement
 × carries a DERIVED layer's own feature ids into the one source read      ← export.ts
 × carries a DERIVED layer's own feature ids into the CityParquet request  ← ExportDialog
     AssertionError: expected undefined to deeply equal [ 'a', 'b' ]
 × sends null for an ordinary layer, so the export reads the whole source
     AssertionError: expected undefined to be null
 Tests  6 failed | 85 passed (91)
```

**GREEN 3** — `tests/unit/insights tests/unit/ui/table` → `482 passed (482)`.

**The full suite caught a fourth thing, and that is `b6a1649`.** The first full-suite run after
commit 2 came back `Test Files 1 failed` / `Tests 8 failed`:

```
 FAIL tests/unit/ui/sidebar/LeftPanel.test.tsx  (8 of 10)
 TypeError: Cannot read properties of undefined (reading 'runId')
  ❯ StoreLayerRow src/ui/layers/LayerList.tsx:276:33
```

`LeftPanel.test.tsx`'s `layer()` fixture is an `as Layer` cast over a spread of
`Partial<Layer>`, which COMPILES without the required `derivedFrom` and is `undefined` at runtime —
so every seeded layer read as derived and then dereferenced a run that was never looked up. Fixed
in the FIXTURE, not by loosening the row's `!== null` to `== null`: the field is required and
`undefined` is only ever a fixture bug (Task 21's precedent, and the same trap it hit in
`layerTableLifecycle.test.ts`). `LayerList.test.tsx`'s identical fixture was repaired in commit 1
before it could bite. Both are the only two `as Layer` fixtures that reach `LayerList`
(`grep -rln "LayerList\|LeftPanel" tests/`).

**The re-run after the fixture fix is the one quoted under Gates: `suite: 0`, 3684 passed.**

## Files changed

```
src/app/App.tsx
src/app/app.css
src/app/snapshotLayers.ts                       (new)
src/features/layers/layerPresentation.ts
src/insights/export.ts
src/insights/sql.ts
src/ui/layers/LayerList.tsx
src/ui/layers/LayerRow.tsx
src/ui/layers/LayerRowMenu.tsx
src/ui/table/ExportDialog.tsx
tests/integration/duckdb/layerTables.test.ts
tests/unit/app/appDerivedLayers.test.tsx        (new)
tests/unit/app/derivedSnapshot.test.tsx         (new)
tests/unit/insights/exportCityParquet.test.ts
tests/unit/insights/sqlExport.test.ts
tests/unit/ui/layers/LayerList.test.tsx
tests/unit/ui/layers/derivedLayerRow.test.tsx   (new)
tests/unit/ui/sidebar/LeftPanel.test.tsx
tests/unit/ui/table/ExportDialog.test.tsx
```

## How each controller requirement was met

1. **Residual C4 — the SHARE path.** `handleShare` routes `allLayers` through the SAME
   `snapshotLayers` call the save uses, BEFORE the existing URL filter (order matters: a derived
   city layer inherits its parent's `modelRef` and would otherwise pass). The test decodes the
   real payload: it clicks `Share this view`, reads the `Share link` field, slices from the `#`
   and runs it back through `readShareHash` — then asserts `layers.map(l => l.name)` is
   `["Delft", "Rotterdam"]` (no derived name) and that `DELFT_URL` appears exactly ONCE (the
   parent is not restored a second time under the copy's name).
   **The requirement's third clause does not apply to this path, and the code wins:**
   `ShareableViewState` is v3 and carries NO active-layer reference at all — its own doc comment
   says the share schema and the snapshot schema were "allowed to diverge: snapshot v4 added
   `activeLayer`, and a hash carries no such field". Adding one would bump the hash schema, which
   the Global Constraints forbid ("Nothing new is persisted"). So the share reads
   `snapshotLayers(...).layers` only, with a comment saying why, and the active-index assertion
   lives on the SAVE case, where the field exists. Flagged here as instructed.
2. **Task 23's note — the GEO path.** `geoLayers: selection.geoLayers.map(geoLayerSnapshot)`.
   The regression is pinned end-to-end: a derived geo layer added through the real
   `addGeoLayer({ insertAfterId, derivedFrom })` no longer reaches the snapshot (before this task
   it landed as an empty re-linkable row — the RED output above). The toast counts BOTH kinds:
   the same case has one derived city layer and one derived geo layer and asserts
   `2 derived layers are not saved; export them to keep them` [A16]; a third case asserts §8's
   singular verbatim; a fourth asserts the unchanged toast when nothing was skipped.
3. **Residual C7 — real paths, typed fixtures, the null-active case.** Every file exists:
   `derivedLayerRow.test.tsx` uses the REAL `LayerRow.test.tsx` helpers (`cityItem`, `handlers`,
   `renderRow`, `openMenu`; there is no `baseProps` anywhere in this task). `derivedSnapshot.test.tsx`
   declares a real `interface Row { id; name; derivedFrom: DerivedFrom | null }` — no `as never`.
   The null-active case asserts `expect(out.activeLayer).toBeUndefined()`, the plan's corrected
   expectation, and says in a comment why a future `?? 0` must not slip in.
   **One path in the requirement is wrong and the code wins:** the SQL suite for
   `buildCityParquetSourceSql` is **`tests/unit/insights/sqlExport.test.ts`**, not
   `sqlQuery.test.ts` — `grep -rn buildCityParquetSourceSql tests/` puts its existing 7 cases
   there, and `sqlQuery.test.ts` never imports it. C7's intent (a real path, not an invented one)
   is met at the real one.
4. **`onShowRunLog={onShowRunLog}`.** Passed verbatim from `LayerRow` to `LayerRowMenu`, with a
   comment naming the `?? null` regression. `LayerList` produces `undefined` for
   `derivedFrom === null`, `null` when `runById(...)` is null, and the callback otherwise. The
   ordinary-layer case asserts BOTH that the marker is absent and that the menu has no such button.
5. **Nothing new persisted.** `snapshotLayers` is pure and returns the caller's OWN records (pinned
   by "hands the caller the SAME records it was given"), and `App` maps each into the explicit
   field list it always had — so `derivedFrom` cannot reach the snapshot. Asserted:
   `snapshot.layers.every(l => !("derivedFrom" in l))`. A restored workspace cannot contain a
   derived layer because none is written; `geoLayerSnapshot` was already pinned against the field
   by Task 23.
6. **Mock factories and the background suite.** The two `vi.mock` factories in the new
   `appDerivedLayers.test.tsx` (`insights/duckdb`, `streaming/openStreamingLayer`) are copied
   verbatim from `appRestoreShare.test.tsx`, which exercises the same tree; the suite passing is
   the proof they export what `App` imports. No `insights/layerTables` factory was touched.
   `exportCityParquet.test.ts`'s existing factory needed nothing (the new field is on the request,
   not on a module). Both full-suite runs were backgrounded to a file with
   `& wait $!; echo "suite: $?"`.

## Deviations from the brief (each named; the code and the requirements won)

1. **The marker's PLACEMENT and its CSS.** The brief puts the marker inside `.layer-row-state` and
   styles it `display: block; font-size: 0.72rem`. `.layer-row-state` is a flex ROW shared with the
   filter chip, so `display: block` is inert there and the sentence would be squeezed onto the
   state line beside "312 buildings · LoD 2.2 · Derived from Delft"; and `0.72rem` is the layer
   NAME's size, LARGER than the state line's `0.68rem`, which reads as a promotion rather than a
   caveat. It is instead a third child of `.layer-row-body` (the flex COLUMN), styled with
   `.layer-row-state`'s own tokens — `0.68rem`, `0.85rem` line-height, `var(--fg-muted)`, plus the
   ellipsis trio the state line uses. No new colour, no new size, and only a derived row grows the
   third line. The tests do not depend on placement.
2. **`LayerStateInput.derivedFrom` needs a bound `DerivedFrom` in tests**, not an inline literal —
   see "RED 1" above. The brief's own snippet does not compile.
3. **Two test files, not one, for the snapshot.** The brief's `derivedSnapshot.test.tsx` stays PURE
   (the pure decision should not pay for an App mount); the real-`App` save and share cases are
   `tests/unit/app/appDerivedLayers.test.tsx`. Requirement 1 demands a decoded SHARE payload, which
   needs the shell mounted, and folding that into the pure file would have made every pure case
   import a mocked viewport.
4. **`sqlExport.test.ts`, not `sql.test.ts` / `sqlQuery.test.ts`** — deviation 3 of requirement 3
   above. `tests/unit/insights/sql.test.ts` does not exist (which is what C7 said).
5. **An EMPTY `sourceFeatureIds` is spelled `FALSE`, with its own case.** The brief leaves it
   silent. `IN ()` is a DuckDB syntax error that would take a whole export down; the same file
   already answers an empty module list with `FALSE` (`buildCityParquetModuleSql`). Unreachable
   today (Task 21 refuses a cut with no roots), and now cheap to keep unreachable.
6. **A quote-carrying id has a case.** The ids are the parent file's own feature ids, so
   `quoteLiteral` doing its job is worth one assertion rather than an assumption.
7. **Three extra `snapshotLayers` cases** beyond the brief's five: a GEO active index (the brief
   only exercises the city arm of the same ternary), and the identity case (the filter is the only
   thing the function may do to a row).
8. **`b6a1649` is a fourth commit the brief does not list** — the `LeftPanel` fixture repair the
   full suite found. One change per commit, so it is its own.

## Self-review

- **The `Show run log` item is decided at RENDER time**, by a non-reactive `runById` read. That is
  what the plan prescribes, and it is right for the case that matters (a layer whose run aged out
  long ago). The window it misses: a row that is already on screen when its run falls off the
  20-run history keeps an enabled item until something else re-renders the row, and clicking it
  calls `openLog` for a run the log view will not find. Subscribing the row to the run store
  instead would re-render every row on every run-state change, which is a worse trade for a
  20-run eviction; left as the plan has it, flagged here.
- **The state line and the marker say overlapping things** ("· Derived from Delft" and "Derived ·
  not saved in workspaces"). Both are spec'd — §6.2 words the first, §8 the second — so both are
  rendered; the second is the one with the consequence in it.
- **`snapshotLayers` filters on `derivedFrom == null` (loose)**, so a fixture carrying `undefined`
  is treated as NOT derived — the safe direction for a snapshot (it saves a layer rather than
  silently dropping one). `LayerList`'s check is strict `!== null` for the opposite reason: there,
  `undefined` would DEREFERENCE, which is exactly the failure the LeftPanel fixture produced and
  which a loose check would have hidden. The asymmetry is deliberate, not an oversight.
- **The share path passes `geoLayers: []` and `activeLayerId: null`.** A hash carries neither, and
  handing the real values in would read as though the answer were used. The comment says so.
- **`derivedCount` counts layers, not "layers the user can see"** — a derived layer that is hidden
  or unavailable still counts. That matches §8's sentence, which is about what the save could not
  carry.
- **No `partialRestore` interaction was added**: a partial restore whose workspace also holds a
  derived layer gets both sentences, in that order. Untested (it needs a restore AND a derived
  layer); the composition is a single template literal.
- **The export's three seams are now each pinned separately** — the builder's SQL, `runExport`'s
  actual `CREATE TABLE … "src"` statement, and the dialog's request — because "an export that
  ignores the filter" is a named rejection reason and a builder test alone would not have caught a
  missing `sourceFeatureIds:` line in `ExportDialog.tsx`.
- **The three-line row cannot clip.** Checked rather than assumed: `.layer-row` (`app.css:3326`)
  declares `display: flex; align-items: flex-start` and padding, with NO `height` and no fixed row
  height on the list, so the row grows to its content and the marker cannot be cut off.
- **The marker's copy is SPEC-VERBATIM**, not an invention and not an `[adapted copy]`:
  `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md:336` reads `the layer list marks
it "Derived · not saved in workspaces"`, and the plan's copy table carries it at line 1197 with
  the source `§6, §8`. The state-line tail is §6.2's own sentence (spec:469). Nothing in this task
  words a string of its own.
- **One comment was imprecise and is fixed in `45baa29`.** The share filter's comment said the
  derived filter "has to come FIRST"; the two filters actually commute — what is true is that the
  URL filter does not stand in for it. Reworded, comment-only, tests re-run.
- **No browser pass.** The host is headless. Two things worth a look when someone can drive
  `agent-browser`: the three-line derived row at the narrowest panel width (the marker ellipsises
  rather than wrapping — worth an eye, though it cannot clip), and the `Show run log` item sitting
  between `Open table` and `Rename` in the overflow menu.

## Concerns (for the commander, not fixed here)

- **A derived layer is silently dropped from a share link with NO notice.** §8 gives Save a
  sentence and says nothing about Share, so nothing is shown — a user who shares a workspace with a
  derived layer in it gets a link that quietly holds one layer fewer. `derivedNotSavedNote` is
  right there and the share dialog has room; it needs a copy decision, not code.
- **The run-log item's staleness window**, above.
- **A derived layer of a CityGML/CityParquet parent still carries `sourceFeatureIds`** but has
  `reader: null`, so `buildCityParquetSourceSql` is never reached for it — correct, and the reason
  the field lives on `LayerTable` rather than being threaded from `deriveLayer`. Nothing to do;
  stated so a reviewer does not go looking for a missing branch.
- **`LayerRow.test.tsx`'s own `cityItem` still omits `derivedFrom`** — harmless, because that suite
  never passes `derived` and the row only reads the prop. Left alone rather than swept, so the two
  suites' fixtures stay independent (the new file copies the shape, as the brief asks).

---

## Fix round 1 (review `pair-23-24-review.md`, 2026-09-13)

**Status:** both findings addressed. Two commits on top of `878d003` (Task 25's HEAD, which landed
after the original five), nothing pushed, no trailers (`git log -2 --format=%B | grep -iE
"co-authored|claude-session"` → none), hooks never bypassed, `core.hooksPath` untouched, no other
task's files touched.

- `6069e8e` `fix: a derived row's Show run log follows the run history it names`
- `561049a` `test: a derived layer's real-engine package keeps its roots' parts and drops the sibling`

### Important — "Show run log" remains enabled after its run leaves history

The reviewer is right, and my own self-review named the same window without fixing it. `runById` is
a one-shot `getState()` read, so a mounted derived row kept its callback after eviction and the
click opened the missing-history view.

**Fix (`src/ui/layers/LayerList.tsx`).** `StoreLayerRow` now SUBSCRIBES, with a selector that
returns a **boolean**:

```ts
const hasRunLog = useProcessingStore((s) =>
  derivedFrom === null ? false : s.runs.some((r) => r.id === derivedFrom.runId),
);
```

and `onShowRunLog` reads `hasRunLog` instead of calling `runById`. The three states are unchanged
(`undefined` → no item, `false` → disabled item, `true` → the callback). The `runById` import is
gone from this module; the function itself stays exported for its other callers.

Why a boolean and not the record: zustand compares the selector's RESULT with `Object.is`, so a row
whose answer did not change is not re-rendered by a run update — every `patchRun` during a live run
would otherwise re-render every derived row (and returning the `RunRecord` would re-render on every
patch of that one run). An ordinary row's selector short-circuits to `false` and can never change.

**RED, before the change:**

```
$ npx vitest run tests/unit/ui/layers/LayerList.test.tsx
 × DISABLES it when the run is evicted under a mounted row
     Error: expect(element).toBeDisabled()
 Tests  1 failed | 29 passed (30)
```

Three cases added to `tests/unit/ui/layers/LayerList.test.tsx` (a MOUNTED `LayerList`, as the
review asks, not a row with a prop handed to it):

- `offers it while the run is still there` — the enabled baseline, so the eviction case is a real
  transition and not a test that would pass against a missing item.
- `DISABLES it when the run is evicted under a mounted row` — the regression. It goes through the
  store's OWN eviction path (`upsertRun` twenty times; `MAX_RUNS` is 20 and the newest 20 are
  kept), asserts the run really is gone from `runs`, and then asserts the item is disabled WITHOUT
  remounting or reopening the menu.
- `gives an ordinary row no item at all, whatever the history holds` — a run in the history must
  not grow an item on a layer that is not derived.

The fixture is `({ id }) as RunRecord`, with a comment: the row asks the history exactly one
question, so a fourth copy of the full record would be noise.

**GREEN:** `tests/unit/ui/layers tests/unit/ui/sidebar` → 17 files / 250 passed.

### Minor — a combined real-engine derived-export case

Added to `tests/integration/duckdb/layerTables.test.ts`:
`cuts a DERIVED layer's package to its own features, PARTS included`. It is the only place the
derived filter meets a real reader, and it is the assertion neither the SQL-text nor the request
test can make.

The case builds the copy's table the way `prepareDerivedCityLayer` does (a CTAS from the PARENT's
table cut by feature root, plus a run column written into the copy), then runs the app's own
`buildCityParquetSourceSql` with `sourceFeatureIds`, and asserts, against DuckDB 1.5.5 + the real
`cityjson` extension:

- the reader's rows are the named root **and its BuildingPart** — the failure mode a row-level
  `"id" IN (…)` would produce is losing the part, i.e. the copy's geometry;
- the sibling root is absent;
- the copy's computed value is on **every** row of the feature (the join and the derived filter
  coexist — `id` through `USING`, `feature_id` on the reader's side only);
- `cityparquet_write`'s `building.parquet` holds those same two rows and values, so the promise is
  about the written package and not only about the scratch table.

`${EXPORT_BASE}_cutpkg` joins `WRITTEN_DIRS` so the on-disk safety net cleans it up.

**Run for real, not just typechecked:**

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/layerTables.test.ts
  Test Files  1 passed (1)      Tests  22 passed (22)
```

**Mutation-checked** — `sourceFeatureIds: [DERIVED_ROOT]` swapped for `null`:

```
 × cuts a DERIVED layer's package to its own features, PARTS included
     AssertionError: expected [ 'NL.IMBAG.Pand.0001', …(2) ] to deeply equal [ 'NL.IMBAG.Pand.0001', …(1) ]
  Tests  1 failed | 21 passed (22)
```

Reverted immediately; back to 22 passed.

**One deviation from the review's shape, with a reason.** It asks for "two roots with parts among a
parent of three". No fixture in the repo has three roots — `two-buildings.city.json` has three ROWS
(two roots, one of them with a part), and `composite-solid.city.json` / `invalid-solid.city.json`
have one object each. Adding a city fixture means a provenance row in `fixtures/README.md`, which
is Task 28's file, for a Minor. The case therefore cuts to ONE root of the two, which is the root
that HAS a part — and every assertion the review asks for still discriminates: parts kept, sibling
excluded, computed values carried, written package checked. Flagged so the reviewer does not read
the smaller shape as an oversight.

### Gates (fix round 1)

```
$ npx tsc -b --noEmit                       → clean
$ npx vp check   → Found 0 errors and 56 warnings in 588 files      (baseline held)
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb  → 22 passed
$ npx vitest run > …/m3-task24-fix1.log 2>&1 &  wait $!; echo "suite: $?"
  suite: 0
  Test Files  280 passed | 4 skipped (284)
  Tests  3704 passed | 97 skipped (3801)
```

(The skip count is 97, not 96: the new integration case is skipped in the default run like the rest
of its suite, and 22 of them pass under `DUCKDB_INTEGRATION=1`.)

### Residual concerns after fix round 1

- **The silent share drop stands** (§8 words a Save sentence and nothing for Share). Still a copy
  decision, not code — and the reviewer accepted the omission as following the ruling.
- **Task 23's own Minor is not mine to close** (scenario 11's real Selected-(2) computation and the
  relink-during-computation case in `derivedRun.test.ts`) — that suite is Task 23's file.
- **The subscription's re-render claim is reasoned, not measured.** A render-count assertion would
  need instrumenting `LayerRow`; the boolean selector makes it true by construction, and the three
  cases pin the BEHAVIOUR the boolean exists for.
