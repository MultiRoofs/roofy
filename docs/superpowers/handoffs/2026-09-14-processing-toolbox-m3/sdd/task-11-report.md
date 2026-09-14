# Task 11 report — The run queue learns a SOURCE layer and a VECTOR target

**Status:** DONE. One commit on `develop`: `e4b8989` `feat: a run can name a source layer and target a vector layer` (no trailers, hooks run, not pushed).

## Implemented

- `src/features/processing/types.ts` — `ToolDefinition.needsVectorSource: boolean` REPLACED by `sourceKind: "city" | "vector" | null`, with the brief's doc comment verbatim.
- `src/features/processing/toolRegistry.ts` — every `needsVectorSource` line replaced: `null` for roof-metrics / measure-solids / validate-solids / height-from-extent, `"vector"` for join-by-location and distance-to-nearest, `"city"` for aggregate-per-area.
- `src/features/geoLayers/geoLayerStore.ts` — `export type GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>;` declared directly under the `GeoLayer` union, with the brief's comment.
- `src/features/processing/runQueue.ts`
  - imports: `type ColumnType` added to the `computedColumns` list; NEW imports of `useGeoLayerStore` / `type GeoJsonLayer` and `geoRecords` / `type GeoRecord`.
  - `RunRequest.sourceLayerId: string | null`; `FrozenRequest.computeLayerId: string` (+ reworded `tableName` doc).
  - NEW exported `ToolTarget` and `ToolSource` unions; `ToolContext` gains `target` and `source` and the `table`/`layer` doc that names the vector-target case.
  - `submitRun` computes `computeLayerId` once (`tool.target === "vector" ? sourceLayerId ?? targetLayerId : targetLayerId`) and keys `snapshotScopeInputs` and the frozen `tableName` on it; `retryRun` re-reads the table by `frozen.computeLayerId`.
  - NEW module-private `layerNameOf(id | null)` and `layerExists(id)` reading BOTH stores; `queueRun` now populates `targetName`, `sourceLayerId` and `sourceName` from them (the old single-store `layer` lookup is gone).
  - `execute`'s head block, in order: `tool` hoisted → §5's no-source refusal (`Add a vector layer to join with` / `Add a city model layer to aggregate`) → §6.1 "Layer removed" for BOTH ids → compute layer → compute table → `tableName` re-check → `target` resolution (city, or a narrowed `geojson` geo layer + `geoRecords(config.preparedData)`) → `source` (city arm only; the vector arm is Task 13) → the "belongs to the source data" pre-flight gated on `target.kind === "city"` (its local `source` renamed `clash` to free the name) → executor lookup. The later duplicate `const tool = toolById(...)` was deleted.
  - `ctx` literal gains `target` and `source`; the executor call is split into `raw` + the vector-target refusal (`Not available yet`, before `canonicalise` and before the write) + `canonicalise(raw, table.columns)`.
  - `installTargetRemovalWatcher` unions both stores' ids, keeps a run only when the target AND (if any) the source are present, and subscribes to / disposes both stores.
  - `installStaleWatcher` matches on `frozenById.get(run.id)?.computeLayerId ?? run.targetLayerId`.
- `src/features/processing/eligibility.ts` — `EligibilityContext` gains `hasCityLayer` and `vectorPreparation`; the vector-target branch grows the two A4 sentences; `needsVectorSource` check becomes `sourceKind === "vector"` and gains the A3 `sourceKind === "city"` mirror.
- `src/ui/processing/useEligibilityContext.ts` — `EligibilityInputs.hasCityLayer` (from `useLayerStore`), `eligibilityContextFor(target, inputs)` takes the record, and reads `preparation` off a geo target's geojson config.
- `src/ui/processing/useToolForm.ts` — `const inputs = useEligibilityInputs(); const { tables } = inputs;`, both call sites pass `inputs`, memo deps `[candidates, inputs, tool]` with the brief's comment.
- `src/ui/processing/ToolView.tsx` — **not in the brief's file list**; `submitRun` there needs `sourceLayerId: null` or `RunRequest` does not typecheck. Added with a one-line comment pointing at Task 15. See "Deviations".
- `src/ui/processing/RecentRuns.tsx` / `LogView.tsx` — no production edit needed, as the brief said.

## Tested + results

New file `tests/unit/features/processing/crossLayerRun.test.ts` (13 cases, 1 `it.todo`) — a NEW `layerTables` mock factory, so Task 21's sweep count goes 6 → 7.

Additions: `runQueue.test.ts` (+3 cases in a new `describe`, plus `sourceLayerId: null` in its `request()` helper), `eligibility.test.ts` (+5 cases, the two new fields in `base` and in the two hand-built literals), `RecentRuns.test.tsx` (+1 case), and `sourceLayerId: null` in the `roofRequest` / `solidRequest` helpers of `roofMetricsRun.test.ts`, `measureSolidsRun.test.ts`, `validateSolidsRun.test.ts`.

- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` → **34 files, 469 passed, 1 todo**.
- Full app suite (background, to `/tmp/m3-task11-suite.log`): `suite: 0` — **255 files passed, 4 skipped; 3201 tests passed, 74 skipped, 1 todo**.
- `npx tsc -b --noEmit` → clean.
- `npx vp check` → **0 errors / 56 warnings** (baseline confirmed against HEAD by stashing: HEAD is also 0/56).

## TDD evidence

RED, before any production change (`/tmp/m3-task11-red.log`):

```
$ npx vitest run tests/unit/features/processing/crossLayerRun.test.ts
Tests  9 failed | 3 passed | 1 todo (13)
```

Failures were assertion failures, not the TS error the brief predicted (vitest strips types):

- `records the source's name…` — `expected null to be '<uuid>'` (`queueRun` hard-coded `sourceLayerId: null`).
- `fails a frozen source that has been removed…` — run was `done`, not `failed · Layer removed`.
- `cancels a RUNNING run when the source layer goes away mid-compute` — same.
- `computes over the SOURCE city layer's table…` — `ctx.target` undefined.
- `reports the VECTOR layer's name as the target…` — `targetName` was `"?"`.
- `refuses the WRITE until Task 18…` — run failed with `This layer's table could not be built` (the queue resolved a table for the VECTOR id).
- `re-validates the SOURCE city table at the head…` — same wrong reason.
- `refuses a vector-target run with no source layer…` — got `Layer removed` instead of `Add a city model layer to aggregate`.
- `keys a vector-target run on the SOURCE city layer…` — `stale` stayed `false`.

The 3 that passed on arrival passed vacuously (they assert a refusal does NOT happen, or a city-target path that already worked). The `RecentRuns` case is green on arrival by design — the brief says so explicitly: the production code needed no edit and the test is the proof the field now arrives; it pins the component's `target ← source` rendering; that `queueRun` populates the field is pinned by `crossLayerRun.test.ts`'s first case.

GREEN, after the implementation: the two commands above, both clean.

## Files changed

```
src/features/geoLayers/geoLayerStore.ts
src/features/processing/eligibility.ts
src/features/processing/runQueue.ts
src/features/processing/toolRegistry.ts
src/features/processing/types.ts
src/ui/processing/ToolView.tsx
src/ui/processing/useEligibilityContext.ts
src/ui/processing/useToolForm.ts
tests/unit/features/processing/crossLayerRun.test.ts      (new)
tests/unit/features/processing/eligibility.test.ts
tests/unit/features/processing/measureSolidsRun.test.ts
tests/unit/features/processing/roofMetricsRun.test.ts
tests/unit/features/processing/runQueue.test.ts
tests/unit/features/processing/validateSolidsRun.test.ts
tests/unit/ui/processing/RecentRuns.test.tsx
```

## How each controller requirement was met

1. **Residual B5.** The vector-target refusal is unconditional and sits BEFORE the empty-result "done" branch, exactly where the brief places it, so a vector target never reaches a write. The brief's stale-watcher test (which expected `done` on an Aggregate run) was therefore rewritten as two cases: `retires a cross-layer run when the table it computed over is rebuilt` runs a CITY target with a VECTOR source to `done` (the only shape that can finish this task), and `keys a vector-target run on the SOURCE city layer, not on its target` forces the refused Aggregate run to `done` through the store and asserts the watcher still finds it via `computeLayerId` — with a comment naming Task 18 as the point at which it becomes an ordinary end-to-end case. `refuses the WRITE until Task 18 publishes into the feature properties` expects `failed · Not available yet` and that no `ALTER TABLE` / `BEGIN TRANSACTION` reached the city table. An `it.todo("retires a vector-target run that reached done through the vector write (Task 18)")` marks the flip. No test is left failing.
2. **Residual B15.** Both vector arms are `GeoJsonLayer` (the exported `Extract<GeoLayer, { kind: "geojson" }>`), never `GeoLayer`. `execute` narrows once (`!geo || geo.kind !== "geojson"` → "Layer removed"), and `config.preparedData` is read only on that narrowed value; nothing downstream casts.
3. **`ToolResult` UNCHANGED.** Not one character. See "Deviations" — the brief's Step 3 asked for a reworded `rows` doc comment, the requirement said unchanged, and the requirement won. `summarise` was not touched either; the brief specified no source-layer wording for it, and the two `summarise` cases added to `runQueue.test.ts` only PIN Task 7's behaviour.
4. **Head anchors.** The pre-flight code refers to the local `target`, never `ctx.target` (`ctx` does not exist yet at that point). `useGeoLayerStore` was **not** already imported in `runQueue.ts` — I checked (`grep -n "geoLayer" src/features/processing/runQueue.ts` → no match) and added the import as the brief's Step 5 instructs.
5. **Eligibility order.** Unchanged and pinned: `!implemented` → engine failed → target kind (with A4 inside the vector arm) → `needsReader`/reader → `sourceAvailable` → `sourceKind === "vector"` (A-none) / `sourceKind === "city"` (A3) → extension failed → table failed. New pins: the A3 reason, both A4 reasons, `vectorPreparation: "loading"` outranking `hasCityLayer: false`, `Needs a vector layer` for Aggregate on a city target, and `keeps the real Aggregate row at 'Not available yet' until Task 19` (the real registry entry on a ready vector target).
6. **Mock factories.** `crossLayerRun.test.ts` is a NEW `insights/layerTables` factory (6 → 7) and a new `insights/duckdb` factory. Both export exactly what the module graph under test imports — verified by the suite passing; the duckdb factory carries the same 16-export set `runQueue.test.ts` mocks. No existing factory needed a new export: `geoLayerStore` / `geoRecords` / `geoJsonRecords` import nothing from `insights/` at runtime (only a `type` import of `ColumnInfo`), so pulling them into `runQueue.ts` did not widen any mock's surface — confirmed by the full suite.

## Deviations (requirements or reality over the brief)

1. **`ToolResult` left byte-identical.** The brief's Step 3 re-declares the whole interface with a reworded `rows` comment ("keyed by OBJECT ID for a city target, and by the GeoJSON stable feature id … for a vector target"). Controller requirement 3 says `ToolResult` is UNCHANGED, and requirements win. The same fact is stated in the new `ToolTarget` doc comment instead, so Task 18's implementer still finds it. Note the brief's Step 3 title ("and `ToolResult` gains its two card fields") was already stale: Task 7 shipped `line`/`caveats` and the `summarise` edit, as the brief's own preamble says.
2. **`src/ui/processing/ToolView.tsx` edited, though the brief's file and `git add` lists omit it.** `RunRequest.sourceLayerId` is required, so the app's one production `submitRun` call site does not compile without it. Added as `sourceLayerId: null` with a comment pointing at Task 15.
3. **Three more test helpers swept.** The brief mentions only `runQueue.test.ts`'s `submitRun` literals; `tsc` also named `roofRequest()` / `solidRequest()` in `roofMetricsRun.test.ts`, `measureSolidsRun.test.ts` and `validateSolidsRun.test.ts`. All four helpers took `sourceLayerId: null` in this commit, so `develop` never compiles half-way.
4. **Requirement 4's premise about `useGeoLayerStore` was wrong** (it was not imported). Handled as above.
5. **Stale-watcher test shape.** Described under requirement 1.
6. **Two small test-authoring fixes** the brief's code would have failed lint/typecheck on: the new `runQueue.test.ts` case captures its context in a BOX (a plain `let` narrows to `never` at the assertions, because the assignment is inside the executor closure), and the `target` assertion casts to `| undefined` before the optional chain (`eslint(no-unsafe-optional-chaining)` is an ERROR here, and the 56-warning baseline is a gate).

## Self-review

- Every queue-internal read of `targetLayerId` that was really "the table I compute over" now reads `computeLayerId` (scope snapshot, frozen `tableName`, layer lookup, table lookup, rebuild check, stale watcher). The reads that legitimately stay on `targetLayerId` are all on the city-target-only paths: the `computedColumnsOf` pre-flight (inside `target.kind === "city"`), the Undo-stealing scan, `refreshLayerTableColumns`, `mergeAttributes` and the provenance rollback. For every one-layer tool the two ids are identical, so nothing existing moved.
- `retryRun` spreads the frozen request, so `computeLayerId` and `sourceLayerId` survive a Retry; only `tableName` is re-read, now by the compute id.
- The §5 no-source refusal is checked before the removal pre-flight on purpose: with a null source there is no compute ground at all, and resolving a city table for a vector layer id would report "Layer removed" about a layer that is on screen. Pinned by `refuses a vector-target run with no source layer`.
- A `join-by-location` run with a vector source gets `ctx.source === null` in this task (Task 13 builds the `__src_<runId>` arm); only the `"city"` arm is populated, and the type says so.
- Nothing persisted changed; `ToolDraft` is untouched (Task 15).

## Concerns / notes for the next tasks

- **Task 18** must (a) delete the `target.kind !== "city"` refusal in `execute`, (b) flip `crossLayerRun.test.ts`'s `refuses the WRITE until Task 18…` to the publication assertion, (c) turn `keys a vector-target run on the SOURCE city layer, not on its target` into an end-to-end case by removing its forced `patchRun(id, { status: "done" })`, and (d) resolve the `it.todo`. All four are named in the file.
- The vector-target run's PUBLICATION path (`mergeAttributes`, provenance, `refreshLayerTableColumns`, Undo) still keys on `run.targetLayerId` — correct today because only a city target reaches it, but Task 18 owns making those branches vector-aware.
- `useToolForm`'s `eligibleTargets` memo now recomputes every render (`inputs` is a fresh object), as the brief intends and comments. It is a handful of pure calls over the ready layers.
- `eligibilityContextFor` still only reads a `kind: "city"` target from `useToolForm`'s two call sites, so `vectorPreparation` is exercised by the catalogue's `useEligibilityContext` and by unit tests; Task 15's form gives it a second production reader.
