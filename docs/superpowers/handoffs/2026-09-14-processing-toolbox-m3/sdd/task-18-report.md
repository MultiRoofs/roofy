# Task 18 report — Vector results surface everywhere a city layer's do

**Status:** DONE. Four commits on `develop` (not pushed), no trailers, hooks run every time.

```
a91c594 feat: a vector layer's feature properties can carry a run's results
93a790e feat: a vector-target run publishes into the feature properties and can be undone
6024fac feat: a vector layer's computed properties badge, show in Details and colour the map
91779a7 fix: a picked vector feature survives a run and shows its computed values
```

## Implemented

### `src/features/geoLayers/geoLayerStore.ts`

- EXPORTED pure `mergeGeoDocumentProperties(document, byStableId)` — copy-on-write per feature, matched on `readGeoStableFeatureId`, `null` when nothing changed, never mutating its input (Task 23 imports it).
- EXPORTED `GEO_PROPERTY_ABSENT` (`unique symbol`), `type GeoPreviousValues`, and pure `restoreGeoDocumentProperties(document, previous)` — per-feature, per-column restore into the CURRENT document, the ABSENT sentinel deleting the key, `null` when nothing changed.
- Store actions `mergeGeoFeatureProperties(layerId, byStableId)` and `replaceGeoPreparedData(layerId, data)`, both through the existing `replaceLayer` (so a no-op leaves the record AND the array identity alone), both writing `config.preparedData` and never `config.data` (§8: nothing new persisted).

**Deviation from the brief (lint baseline wins):** both pure functions return `unknown`, not `unknown | null`. `typescript(no-redundant-type-constituents)` flags `unknown | null` as a warning and the 56-warning baseline is a gate; measured directly (58 → 56). The NULL contract is documented on both functions and every caller compares against it.

### `src/features/geoLayers/geoJsonRecords.ts`

- `findGeoFeatureProperties(document, stableId)` — the one reader §8 needs, returning `publicGeoProperties` of the matching feature or `null`.

### `src/features/processing/runQueue.ts`

- `UndoState` is now a discriminated union. The city arm gains `kind: "city"`; the vector arm carries `layerId`, `previousValues` (`GeoPreviousValues`), `created`, `replaced` and a `source: GeoSourceIdentity` (`{ data, url, preparationEpoch }`) with module-private `geoSourceIdentity` / `sameGeoSource`.
- `discardUndo` returns early for a non-city state (a vector Undo holds no database resource; the city DROP is still the raced, unawaited one).
- §6.1's "belongs to the source data" pre-flight gains the vector `else` arm: the document's own public property keys, minus the registry's own columns, case-insensitively.
- Task 11's `"Not available yet"` refusal is REPLACED by §7.6's publication: verify → canonicalise against the verified document's keys → empty-result `done` → `phase: "write"` → created/replaced split → per-feature/per-column rollback capture → ONE `mergeGeoFeatureProperties` → log entry → `publishProvenance` → `stealUndo` → `undoState.set` → `done` card + notice.
- Three shared helpers extracted so each rule has ONE copy: `publishProvenance(runId, layerId, result, toolName, request, scope)`, `stealUndo(runId, layerId, result)`, `rollBackProvenance(layerId, created, replaced)`. The city path calls all three; the city write path is otherwise byte-for-byte what it was.
- `undoRun` grows the vector branch at the top: `runOnTableQueue`, re-check at the head, restore this run's own columns into the CURRENT document, `rollBackProvenance`, `note: "Undone"`.

### UI

- `GeoRecordsPanel` passes `layerId={layer.id}` to `DataGrid` (which already reads `byLayer[layerId]` and badges from it).
- `GeoFeatureDetails` splits the attribute list by the registry and renders a `role="group" aria-label="Computed attributes"` COMPUTED block with `ComputedAttributeBadge title={formatProvenance(...)}`, matching `LayerAttributesSection` exactly.
- `GeoStyleControls`: BOTH halves of "Color by attribute" read `preparedData ?? data` — the key list (filtering `GEO_STABLE_FEATURE_KEY`) and `categoriesFor` inside `pickAttribute`'s `apply`, which now narrows the live record to `kind === "geojson"` before reading it.
- `src/features/geoLayers/geoSelectionRefresh.ts` (new, pure) + `App.tsx`'s geo-selection effect, which now asks it and moves `geoSelectionConfigRef` with an accepted refresh.

## Tested + results

New: `tests/unit/features/geoLayers/mergeGeoProperties.test.ts` (9), `tests/unit/features/geoLayers/geoSelectionRefresh.test.ts` (7), `tests/unit/ui/table/geoComputedBadge.test.tsx` (2), `tests/unit/ui/details/GeoFeatureDetails.test.tsx` (2, not in the brief's list — the COMPUTED group had no test at all and TDD needed one).
Additions: `tests/unit/features/geoLayers/geoExport.test.ts` (+1), `tests/unit/ui/layers/StyleSection.test.tsx` (+1), `tests/unit/features/processing/crossLayerRun.test.ts` (three cases flipped, +9 cases in a new `describe("a vector target's publication")`, the `it.todo` replaced by a real case).

- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` → 44 files, 744 passed.
- `npx vitest run tests/unit/ui tests/unit/features/geoLayers tests/unit/scene` → 133 files, 1582 passed.
- Full app suite ONCE, background to `/tmp/m3-task18-suite.log`: `suite: 0` — **269 files passed, 4 skipped; 3499 tests passed, 92 skipped, 0 todo** (was 3201 passed / 1 todo at Task 11).
- `npx tsc -b --noEmit` → clean.
- `npx vp check` → **0 errors / 56 warnings** (baseline held; the two warnings the brief's `unknown | null` signatures introduced were measured and removed, see the deviation above).

## TDD evidence

RED 1 — the store test before any production change:

```
$ npx vitest run tests/unit/features/geoLayers/mergeGeoProperties.test.ts
TypeError: useGeoLayerStore.getState(...).mergeGeoFeatureProperties is not a function
TypeError: restoreGeoDocumentProperties is not a function
 Test Files  1 failed (1)      Tests  9 failed (9)
```

GREEN after the store actions + pure functions: `Tests 9 passed (9)`.

RED 2 — the queue cases before touching `runQueue.ts` (`/tmp/m3-task18-red-queue.log`):

```
$ npx vitest run tests/unit/features/processing/crossLayerRun.test.ts
 Test Files  1 failed (1)      Tests  12 failed | 18 passed (30)
```

The 12 were the three flipped cases plus the nine new ones: the flipped write case got `status: "failed" / "Not available yet"` where it now expects `done + undoable` and the merged value; the flipped stale case failed because the run never reached `done` on its own; the publication, both Undo-order cases, the replaced-value case, the vector "belongs to the source data" refusal, the re-link-during-compute failure, the two queued-Undo refusals and the empty-result `done` all failed as unimplemented.

GREEN after the queue work: `Tests 30 passed (30)`. (Two assertions in that file needed authoring fixes after the behaviour landed and are called out under Self-review.)

RED 3 — the UI/selection tests before the UI changes:

```
$ npx vitest run tests/unit/ui/layers/StyleSection.test.tsx tests/unit/ui/table/geoComputedBadge.test.tsx \
    tests/unit/ui/details/GeoFeatureDetails.test.tsx tests/unit/features/geoLayers/geoExport.test.ts
 × puts a run's column in the COMPUTED group with its provenance
 × leaves a same-named property of the FILE's own where it is
 × badges a column the registry knows, and not the file's own
 × offers a computed property and colours by its real values (§7.6)
      Tests  4 failed | 28 passed (32)

$ npx vitest run tests/unit/features/geoLayers/geoSelectionRefresh.test.ts
 Test Files  1 failed (1)      Tests  no tests   (the module does not exist)
```

GREEN after the UI changes and `geoSelectionRefresh.ts`: `Tests 29 passed (29)` and `Tests 7 passed (7)`.

The geo-export case was GREEN on arrival: `mergeGeoDocumentProperties` had already landed in the first commit, and the export reads `preparedData` through `publicGeoProperties` already. It is kept as the pin that a merged property reaches the written GeoJSON and the envelope key still does not.

## Files changed

```
src/app/App.tsx
src/features/geoLayers/geoJsonRecords.ts
src/features/geoLayers/geoLayerStore.ts
src/features/geoLayers/geoSelectionRefresh.ts            (new)
src/features/processing/runQueue.ts
src/ui/details/GeoFeatureDetails.tsx
src/ui/layers/GeoStyleControls.tsx
src/ui/table/GeoRecordsPanel.tsx
tests/unit/features/geoLayers/geoExport.test.ts
tests/unit/features/geoLayers/geoSelectionRefresh.test.ts  (new)
tests/unit/features/geoLayers/mergeGeoProperties.test.ts   (new)
tests/unit/features/processing/crossLayerRun.test.ts
tests/unit/ui/details/GeoFeatureDetails.test.tsx           (new)
tests/unit/ui/layers/StyleSection.test.tsx
tests/unit/ui/table/geoComputedBadge.test.tsx              (new)
```

## How each controller requirement was met

1. **Residual B5 — the refusal is lifted and all three named cases flipped.**
   - `refuses the WRITE until Task 18 publishes into the feature properties` → `writes into the feature properties and never into the city table`: `done + undoable`, `zone: "A", bld_n: 4` on the first record, and still no `ALTER TABLE` and no `BEGIN TRANSACTION`. It registers a STABLE-ID-keyed executor (`areaWriter`), because `capturing()` keys its row `"a"` and would have asserted nothing about the merge.
   - `keys a vector-target run on the SOURCE city layer, not on its target`: the forced `patchRun(id, { status: "done" })` is gone; the run reaches `done` end to end and the assertion `stale === true` is unchanged.
   - The `it.todo` is replaced by a real case, `takes the Undo of a vector-target run it retires`: the retired card reads `undoable: false` and a later `undoRun` is a no-op (the value stays). It asserts only what the stale watcher already does — nothing about provenance after a rebuild, which nobody ruled on.
   - One pre-existing assertion in that file needed adapting: `does not test a vector target's columns against the CITY table's columns` did `expect(runById(id)?.error).not.toContain(...)` and `error` is now `null` (the run succeeds), which chai rejects; it is null-coalesced with a comment.
2. **Residual B3 — identity verified immediately before merging.** The publication re-reads the geo layer by id: missing or no longer GeoJSON → `"Layer removed"`; `config.preparedData !== target.layer.config.preparedData` → §6.1's `"Layer changed while running; run again"`, before `canonicalise` and before any write. `records`, `existingProperties`, the created/replaced split and the `before` map are ALL derived from the verified document, so rollback values describe exactly what is overwritten (`GEO_PROPERTY_ABSENT` per missing column). Test: `fails rather than overwrite a document that was replaced while it ran` holds the executor, relinks, releases → `failed` with that sentence, no `bld_n` on the new document, no provenance under the geo id.
3. **Residual B2 — the queued vector Undo is on the FIFO and re-checks at the head.** `undoRun`'s vector branch runs inside `runOnTableQueue`. At the head it checks, in order: `runById(id)?.undoable` and `undoState.has(id)` → silent return (the city Undo's existing refusal shape, and the card already reads `undoable: false`); then layer gone / not GeoJSON / `!sameGeoSource(verified, state.source)` → drop the retained state and `patch(undoable: false)`, since nothing can ever put it back. Tests: `refuses a queued Undo whose column a later run has already overwritten` (Undo pressed while the second run is still queued → the newer `bld_n: 7` survives, no `"Undone"`) and `refuses an Undo whose layer was re-linked while it waited` (finding 2's "plus relinking": the relinked document is untouched). **Note on the identity used:** `preparedData` identity is deliberately NOT the test, because a later run's DISJOINT merge legitimately moves it — that would break requirement 4. The source triple `{ data, url, preparationEpoch }` is, which is the same predicate `refreshedGeoSelection` uses and matches finding 2's words ("source-document identity").
4. **Undo restores only the affected properties, both orders.** `restoreGeoDocumentProperties` touches only the keys in `previousValues` and merges into the CURRENT document. Pinned twice: at unit level (`undoes ONE run's columns and leaves the other run's alone`, both orders) and end to end through the real queue (`undoes one run without taking a later run's disjoint columns`, which undoes the first, asserts the second's `bld_sum_m2: 90` survives and stays undoable, then undoes the second from that state). `restores a property the run REPLACED rather than dropping it` covers the non-absent branch through the queue.
5. **Residual B4 part — narrowed captured variables.** `execute`'s publication narrows once into `const verified: GeoJsonLayer` and reads `preparedData`/`id` only off it; `undoRun`'s vector branch does the same. The brief's own TEST code carried the repeated `getState().layers[0]` union reads finding 4 named — those are gone too: `mergeGeoProperties.test.ts` has `geoLayer(id)` / `prepared(id)`, `crossLayerRun.test.ts` has `zonesLayer(id)` / `zoneRecords(id)`, `geoComputedBadge.test.tsx` has `zonesLayer(id)`. No `as { config: { preparedData: unknown } }` casts anywhere.
6. **Round-1 B10/B11.** B11: `App.tsx`'s effect delegates to `refreshedGeoSelection`, which returns the SAME selection when the config did not move, a REFRESHED one (properties re-read by stable id) after a property-only change, and `null` for a removal, a re-link, a bumped `preparationEpoch` or a feature that is gone; the effect then advances `geoSelectionConfigRef` so it does not re-fire. The engine highlight is kept without any extra work — verified in `geoLayerSync.ts:236-240`, which highlights by `highlightedStableFeatureId` whenever the selection carries one and only falls back to the batch id otherwise. B10: `GeoStyleControls` builds BOTH the key list and the CATEGORIES from `preparedData`; the StyleSection case asserts the offered option list (`None, zone, name, bld_buildings_n`, envelope key absent) and the real categories with palette colours (`3 → PALETTE[0]`, `7 → PALETTE[1]`).
7. **The remaining constraints.** ONE config replacement per run (a single `mergeGeoFeatureProperties` call; pinned by `replaces the CONFIG exactly once, so the engine rebuilds once`). `preparedData` is the only field written, and it is the documented never-persisted one — no snapshot/persistence file was touched. The export additions went into `tests/unit/features/geoLayers/geoExport.test.ts`. No `vi.mock` factory needed a new export: the modules this task pulled into the graph (`geoLayerStore`, `geoRecords`, `geoJsonRecords`, `geoSelectionRefresh`, `computedColumns`) import nothing from `insights/duckdb` or `insights/layerTables` beyond what `runQueue` already did — confirmed by the full suite (the new `crossLayerRun.test.ts` imports of `computedColumns` and `geoRecords` run against the existing factories unchanged). The vector Undo's DROP is death-raced by construction: it has no backup table, and `discardUndo`'s raced DROP is reached only by the city arm.

## Self-review

- The city write path is unchanged apart from the two loops becoming calls and the `kind: "city"` tag; `refreshLayerTableColumns`, the backup DROP, the cancel-during-write race and the `note: "finished before the cancel arrived"` are all where they were. The vector path deliberately has NO such note: `execute` throws `CancelledError` the moment the executor returns aborted and there is no await after it, so the field could never be set.
- The vector branch re-derives `records` from the verified document rather than reusing `target.records`. When the identity check passes the two are equal by construction; deriving again is what makes the rollback capture provably about the document being written.
- A row keyed by a stable id the document does not have is merged into nothing but still publishes provenance for its column (this is what `capturing()` does in the older cases). That is the exact vector analogue of the city path's "an id the table has and the model does not", which is also written to DuckDB and skipped in the model merge. Its Undo is consistent: every column for that id was captured ABSENT, so the restore removes nothing and the provenance is rolled back. Left as is deliberately — changing it is a spec question, not this task's.
- `stealUndo` still matches on `other.targetLayerId === layerId`, which is right for both kinds: a vector run's `targetLayerId` IS the geo layer.
- Two test-authoring fixes after GREEN, both about assertion shape and not behaviour: the null-coalesced `error` noted under requirement 1, and `toEqual({ zone: "C" })` → `toMatchObject` + `not.objectContaining` because `geoRecords` rows carry the `GEO_RECORD_ID` symbol.
- `GeoFeatureDetails`' second case counts `getAllByText("bld_buildings_n")` rather than `getByText`, because `SummarySection` also lists the first three properties.
- The impeccable design hook flagged two pre-existing `Outfit` font findings in `src/app/brand.css` — a file this task never touched, and the brand's own token file per CLAUDE.md. Left standing, nothing suppressed.

## Concerns (for the commander, not fixed here)

- **`markEngineStopped` revokes a vector run's Undo too.** The engine's death takes Undo from every run through the store flag, on the grounds that the backup TABLES died with the database. A vector run's Undo is one JavaScript object and needs no engine, so it is revoked for nothing. Out of this task's scope (the flag is store-wide and city-shaped); worth a line in a later task or the residuals.
- **A retired vector run loses an Undo that would still work.** `installStaleWatcher` keys on `computeLayerId` (Task 11), so a rebuild of the SOURCE city table retires a vector-target run and takes its Undo (`undoable: false` + `discardUndo`). For a city run that is right — the table and its backup are gone. For a vector run the results are still on the document and `previousValues` is still valid, so the Undo would function; only the card's "computed over a resident set that no longer exists" claim justifies retiring it. `takes the Undo of a vector-target run it retires` pins the behaviour AS IT IS rather than as a judgement; whether a vector run should keep its Undo across a source-table rebuild is a spec question for the commander.
- **Task 22's insertion point.** `publishProvenance` / `stealUndo` / `rollBackProvenance` are module-private and ready for Task 22 as Strand C's finding 3 asks. Strand C's finding 1 (CRITICAL) says Task 22's destination dispatch must be inserted BEFORE this vector publication: the publication is one contiguous `if (target.kind === "vector") { … return; }` block starting immediately after `if (signal.aborted) throw new CancelledError();`, so the New-layer branch goes between those two lines and reaches neither this block nor the city write.
- **The vector "belongs to the source data" pre-flight reads `target.records`** (the pre-compute capture), because it runs before the executor by design — §6.1 refuses early. A source re-linked AFTER that point is caught by the publication's identity check instead, which fails the run rather than letting a clash through.
- The `it.todo` is gone, not merely satisfied: its title ("retires a vector-target run that reached done through the vector write") is now literally what the un-forced stale case does, and the new case beside it pins the Undo half. Nothing in the file is left marked for a later task.

---

## Fix round 1 (pair 17+18 review)

**Status:** all review items addressed. ONE commit, test-only — no production change was needed or made.

```
2218ca3 test: both Undo orders, a relink at the Undo's head, and point-proxy distance parity
```

Work was done on top of `819563f` (Task 19 landed after my commits and flipped Aggregate ON through this vector publication path). `git status` was clean apart from the two untracked directories I never stage.

### Important — the two required Undo scenarios

**(a) Two INDEPENDENT runs, both orders, from a document carrying BOTH results.**
The old single case undid A and then undid B _from the state A's Undo had already left_, so B→A was never tested. Replaced by a shared `twoDisjointRuns(zones)` helper (run A writes `bld_buildings_n`, run B writes `bld_sum_m2`; it asserts both are `done + undoable`, that the document carries both values, and that both columns are in the registry) plus two cases that each start from that state:

- `undoes A then B, each leaving the other run's column alone`
- `undoes B then A, from the SAME document that carries both results`

Each step asserts the surviving VALUES, the KEY absence of the undone column (`keysOfFirst`, so `{ column: undefined }` cannot pass), OWNERSHIP (`undoable` on both cards, `note: "Undone"` on the one that ran) and PROVENANCE (`[...computedColumnsOf(zones)]` exactly, after every step).

**(b) Relink WHILE the Undo waits on the queue.**
The old case relinked before calling `undoRun`, which a check made at press time would also have caught. Replaced by `refuses an Undo whose layer is re-linked WHILE it waits on the queue`: a predecessor task holds the mocked FIFO (`layerTables.runOnTableQueue(() => gate.promise)`), `undoRun(id)` is requested behind it, the document is asserted still to carry `bld_n: 3` (the Undo has not reached the head), the layer is then relinked, the gate opens and both promises are awaited. Asserts the newer document is untouched (`zone: "C"`, no `bld_n` key), `undoable: false` and no `"Undone"` note.

MUTATION-CHECKED: with `sameGeoSource` short-circuited to never refuse, this case is the ONE that fails (`1 failed | 30 passed`), which is exactly the "identity validation moved outside the queued callback" regression the reviewer asked for. The check was reverted immediately.

### Minors

- **Config transitions counted.** `configTransitions(id, run)` subscribes to the geo store and records every DISTINCT config the layer wears while the action runs, SEEDED with the config it already has (zustand notifies on every `set`, including one whose reducer returned the same array, so an empty start counted a no-op as a transition). `replaces the CONFIG exactly once` now asserts `toHaveLength(1)` over a merge that writes BOTH features and that the one transition IS the layer's current config; `ignores a stable id the layer does not have` asserts `toHaveLength(0)`.
- **Key absence, not `undefined`.** Every "the property is gone" assertion in `mergeGeoProperties.test.ts` and the new queue cases now reads `Object.keys(record)` and asserts `not.toContain(name)`.
- **Purity against the input actually passed.** New case `leaves the PREPARED input it was handed exactly as it was`: hands `mergeGeoDocumentProperties` the store's own `preparedData` (envelope and all), compares a `JSON.stringify` snapshot before and after, and asserts the copy-on-write property directly — the untouched feature keeps its identity, the merged one does not. `restoreGeoDocumentProperties`' both-orders case also snapshots its input and asserts neither call mutated it.
- **Records panel behaviour.** New case `shows a merged run's VALUES, and sorts and filters by that column`: two areas, the column merged through `mergeGeoFeatureProperties` (not hand-written into the fixture), provenance registered. It asserts the displayed cells (`["7", "3"]`), then clicks the column's own `Sort bld_buildings_n ascending` button and asserts the row order flips, then applies a `> 5` filter through the query store and asserts one row survives.
- **Details values.** The COMPUTED-group case now asserts the VALUE (`3`) renders inside the group, not only the label and the badge.
- **RTL cleanup.** `vitest.setup.ts` installs only `@testing-library/jest-dom/vitest`, so there is no auto-cleanup and a second `render` in the same file leaves the first grid in the body — which is what made the first draft of the records case query two tables at once. Both new UI files now call `cleanup()` in `afterEach`, with a comment saying why. No other file was touched.

### Task 17's minor (folded in, shared file)

`tests/integration/duckdb/crossLayer.test.ts` gains `answers the POINT→polygon pair the same through buildDistanceSql as core ST_Distance`: a bbox centred exactly on `(200, 50)` measured through `buildDistanceSql` with the `centre` proxy against the file's existing two-area `VECTOR_TABLE`, beside the core `ST_Distance(ST_Point(200, 50), …)` answer in the same case. Both give 50 and both name area `b`, which pins GEOS/core parity for the one pairing core is trusted for.

### Verification

- `npx vitest run tests/unit/features/processing/crossLayerRun.test.ts` → 31 passed.
- `npx vitest run tests/unit/features/geoLayers/mergeGeoProperties.test.ts` → 10 passed.
- `npx vitest run tests/unit/features/processing tests/unit/features/geoLayers tests/unit/ui` → 134 files, 1623 passed (Task 19's suites included and green).
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts` → 37 passed.
- Full app suite ONCE, background to `/tmp/m3-task18-fix1-suite.log`: `suite: 0` — **271 files passed, 4 skipped; 3533 passed, 96 skipped, 0 todo**.
- `npx tsc -b --noEmit` clean; `npx vp check` **0 errors / 56 warnings**.

### Notes

- No production file changed in this round: every finding was about coverage, and each new case passes against the code as it stands (the relink case was mutation-checked to prove it is not vacuous).
- The reviewer's ruling that vector Undo stays revoked on engine restart (§6.1) and that source-city rebuild retirement is accepted is noted; the two matching entries under Concerns above are therefore closed, not open questions.
