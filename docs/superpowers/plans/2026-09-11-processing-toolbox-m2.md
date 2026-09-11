# Processing Toolbox — Milestone 2 (M13.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship **Roof metrics to attributes** as the toolbox's second working tool (spec §7.1: LoD select, six measure checkboxes, flat-threshold slider, feature roll-ups, skip accounting, Style by result on `roof_area_m2`), plus the two seams the rest of the catalogue waits on — a **"Loading extension" run phase** backed by `ensureExtension`, and a **DuckDB status subscription** so the capability chips and their **Retry** link re-render when an extension's state moves.

**Architecture:** Three independent strands, in this order. (1) `src/insights/duckdb.ts` gains a listener list and publishes every status transition; a new `src/insights/useDuckDBStatus.ts` hook (`useSyncExternalStore` over a version counter) becomes the ONE React door to the value, and `App`'s `useState` mirror is deleted. (2) `runQueue.execute` gains an extension step before the scope is resolved: a tool with `extension !== null` that is not already loaded runs `ensureExtension` under `phase: "extension"`, and a failed load fails the run; the catalogue's chips read the published state and offer Retry. (3) Roof metrics is computed **app-side** from the layer's surfaces (static: `CityObject.surfaces`; streaming: the resident records, which this milestone LoD-tags in the plugin submodule), rolled up per FEATURE by a pure domain module, and written through M1's existing rows path — no SQL compute, so the "Reading source" phase stays skipped.

**Tech Stack:** React 19 (`useSyncExternalStore`), Zustand, DuckDB-wasm reached only through `src/insights/duckdb.ts`, Vitest + @testing-library/react (jsdom), plugin submodule `@cityjson/navara-flatcitybuf` (pnpm).

**Spec:** `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md` — §5 (chips, tooltips, failure copy, Retry), §6 (LoD select, PARAMETERS validation, extension note, workload note), §6.1 (phases), §6.2 (Style by result), §6.3 (extension failure copy), §7 (common rules, contributors, roll-ups), §7.1 (Roof metrics), §8, §10 scenarios 4 and 6. Read it before any task.

**Predecessor:** `docs/superpowers/plans/2026-09-10-processing-toolbox-m1.md` and its ledger `.superpowers/sdd/2026-09-10-processing-toolbox-m1/progress.md`. M1's rulings that still bind are repeated in Global Constraints; nothing in this plan re-litigates them.

## Global Constraints

Carried from M1 (unchanged, and every one still applies):

- Never run bare `vite`/`vp dev`; use `npm run dev`, `npm run build`, `npx vp check`, `npx vitest run`, `npx tsc -b --noEmit`.
- `src/insights/duckdb.ts` is the ONLY importer of `@duckdb/duckdb-wasm`. Every NEW export from `duckdb.ts` must be added to every `vi.mock(".../insights/duckdb", …)` factory. **This milestone adds two** (`subscribeDuckDBStatus`, `getDuckDBStatusVersion`) — Task 1 lists all 26 files and does it.
- Test files import from `"vitest"`, never `"vite-plus/test"`.
- Submodule-first: commit inside `packages/cityjson-navara-plugins` first, push it (`git -C packages/cityjson-navara-plugins push origin main`), then commit the pointer bump plus the parent-side fixture fixes in the parent. Always `cd` into the submodule for pnpm; never `pnpm -C`. Task 5 is the only submodule task, and the milestone review (Task 14) reads the submodule diff too.
- Commits: small, prefixed `feat:` / `fix:` / `test:` / `docs:` / `refactor:` / `chore:`; commit directly on `develop`. **No attribution trailers** (the M1 sessions' standing ruling; the harness's `Claude-Session:` line included).
- UI: Soft Utility tokens from `src/app/flatControls.css` (`--control-radius` 8px, `--control-height` 38px, `--control-height-compact` 30px). Verify new controls against peers in the browser.
- Copy: every user-visible string comes from the spec verbatim. Where the spec has no string for a roof-specific case, this plan proposes one and marks it **[adapted]**; the collected list is in "Open questions for the human" at the end.
- Features, not rows (spec §7): a BuildingPart never counts as a building; roll-ups are per feature (`COALESCE("feature_id","id")`).
- Nothing new is persisted (snapshot schema v4 untouched).
- Pre-commit hook runs `vp staged`; pre-push runs `vp check`, `tsc -b --noEmit`, `vp test run`. Do not bypass hooks.
- `!implemented` outranks every eligibility reason (M1 ruling, `eligibility.ts:44`). Roof metrics flips to `implemented: true` in **Task 12**, after its executor, LoD select and parameters exist; only then can its row show a per-layer reason.

New in M2:

- **The "ONE writer of the DuckDB status" hard rule CHANGES in Task 1.** `App` stops owning a `useState` copy; `duckdb.ts` owns the value AND publishes it, and React reads it through `useDuckDBStatus()`. Task 1 edits `CLAUDE.md:116` and adds the story to `docs/architecture-notes.md` in the SAME commit as the code. No other task may add a second reader of `getDuckDBStatus()` into component state.
- `retryEngine()` stays the door to the ENGINE (CLAUDE.md:117). The chip's **Retry** is a different door: it calls `ensureExtension(name)` directly. Never wire the chip to `retryEngine`.
- The extension load runs INSIDE `runOnTableQueue` (it is part of `execute`), so a first `spatial` load blocks table builds for its ~24 MB download, once per session. Accepted deliberately: the alternative — loading before the queue — loses the phase's place in §6.1's sequence and lets a run start against a table that is being rebuilt. Say so in the architecture note.
- `ensureExtension` is NOT abortable. Every call site checks `signal.aborted` after it resolves.
- Roof metrics computes app-side. It issues exactly ONE SQL statement (the id/feature read) and never re-reads geometry, so `needsReader` stays `false` and the "Reading source" phase stays skipped.
- Out of scope, and no task may add them: destination **New layer**, **Measure solids**, **Validate solids**, the cross-layer tools, LoD for non-roof tools, rule-colour palette rotation, the field calculator. Two further exclusions are DEFERRALS with a written design and an open question each, not silent gaps: the FCB **attribute write-back** (Design decision (b), open question 10) and **engine-death recovery** (§6.1's "Analytics engine stopped", the "Deferred with design notes" section, open question 11).
- **No unimplemented tool may claim a fact about the user's data.** A tool with `implemented === false` renders no LoD control, no column list and no geometry verdict — only its name, description, chip and "Not available yet". Inventing "No solid geometry in this layer" for a tool that never inspected the geometry is a lie the UI must not tell.
- **Nothing walks a whole layer's geometry synchronously.** LoD eligibility and counts read surface TAGS only (`type`, `lod`) and call no metric function; a run measures only the scoped features' contributors at the chosen LoD, in batches of **500 features** that yield to the event loop and check `signal.aborted` between them.

---

## Facts about the current code (verified 2026-09-11 on `develop` @ `3e42958`)

Every line below was read on this checkout. File:line citations are exact.

### The executor contract (M1's seam)

- `src/features/processing/runQueue.ts:85-108` — `ToolContext` is `{ table: LayerTable; layer: Layer; featureIds: ReadonlyArray<string> | null; signal: AbortSignal; query(label, sql): Promise<QueryOutcome>; phase(p: RunPhase): void; warn(text: string): void }`. `ToolResult` is `{ columns: ReadonlyArray<OutputColumn>; rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>; measured: number; skipped: ReadonlyArray<SkipCount> }`. `ToolExecutor = (run: RunRecord, ctx: ToolContext) => Promise<ToolResult>`.
- `ctx.featureIds` are **ROW ids**, already expanded to whole features by `resolveScope` (`src/features/processing/scope.ts:126-137` uses `buildFeatureRowsSql`), or `null` for "every row" (`scope.ts:117-124`).
- `ctx.query` logs the statement, patches the run's log, and **throws** on a failed query (`runQueue.ts:483-501`). An executor's `if (!out.ok) throw` is a type guard, not error handling (`heightFromExtent.ts:168-169`).
- `runQueue.ts:510-514` — `record` is re-read from the store immediately before `executor(record, ctx)`, so the executor is handed the live `RunRecord` (`run.lod`, `run.params`, `run.prefix` are the frozen request's values). The result is then passed through `canonicalise(result, table.columns)`: **the table's spelling of a column wins**, so an executor never has to worry about the case an earlier run used.
- `runQueue.ts:517-540` — a `ToolResult` with `rows.size === 0` is a DONE run with a summary and **no** Undo, not a failure.
- `runQueue.ts:542-573` — the write path: `writeComputedColumns({ runId, table, columns, rows, existing, signal })`. `existing` is matched case-insensitively against `table.columns`.
- `runQueue.ts:575-589` — publication merges into `layer.model.objects` via `useLayerStore.getState().mergeAttributes(layer.id, merge)`; **an object id the table has and the model does not is written to DuckDB and skipped here** (`runQueue.ts:578-581`). This is why a streaming run's values reach the table but not Details.
- `runQueue.ts:150-169` — `summarise` builds "N buildings measured · M skipped · T s" plus the detail line "M skipped: a · b".
- `runQueue.ts:443-451` — `EXECUTORS[request.toolId]` missing ⇒ the run fails "Not available yet". `runQueue.ts:419-442` — the §6.1 source-column re-validation **is implemented** (case-insensitive, names the table's spelling). `runQueue.ts:453` — `resolveScope` is called immediately after; **the extension step goes between the executor lookup and `resolveScope`**.
- `src/features/processing/tools/index.ts:12-16` — `EXECUTORS: Partial<Record<ToolId, ToolExecutor>>` and `registerExecutor(id, executor)`. `tools/register.ts:10` currently holds one line, `import "./heightFromExtent";`. `Object.keys(EXECUTORS)` therefore follows **import order in `register.ts`**.

### The tool definition and the form

- `src/features/processing/types.ts:18-49` — `ToolDefinition` fields: `id, name, group, description, longDescription, extension, needsReader, target, needsVectorSource, defaultPrefix, outputColumns?, implemented`. `outputColumns?: (prefix: string, params: Readonly<Record<string, unknown>>) => string[]` (types.ts:43-46). **There is no `needsLod` and no `validateParams` yet.**
- `src/features/processing/toolRegistry.ts:5-18` — the `roof-metrics` entry exists with `extension: null`, `needsReader: false`, `target: "city"`, `defaultPrefix: "roof_"`, `implemented: false`, and **no** `outputColumns`.
- `src/features/processing/processingStore.ts:14-20` — `ToolDraft = { targetLayerId: string | null; scope: Scope; lod: string | null; prefix: string; params: Readonly<Record<string, unknown>> }`. A fresh draft is `{ …, lod: null, prefix: tool.defaultPrefix, params: {} }` (`useToolForm.ts:82-89`). `setDraft` (`processingStore.ts:172-183`) also dismisses a FAILED card for the same (tool, target), so editing a parameter hands the Run button back.
- `src/ui/processing/useToolForm.ts:57-72` — `eligibleTargets` filters `candidates` (layers whose table is `ready`, `useToolForm.ts:53-56`) through `toolEligibility` with a per-layer `eligibilityContextFor`.
- `useToolForm.ts:110` — `const columns = tool.outputColumns?.(draft.prefix, draft.params) ?? []`.
- `useToolForm.ts:131-152` — `prefixError`, then `scopeReason`, then `runReason = !eligibility.ok ? eligibility.reason : (prefixError ?? scopeReason)`. **There is no params validation slot.**
- `src/ui/processing/ToolView.tsx:111-181` is the TARGET fieldset (Layer select at `:113-126`, Scope radios, the streaming note at `:174-179`); `:182-229` is the OUTPUT fieldset. **There is no LoD field and no PARAMETERS section.**
- `ToolView.tsx:74-85` — `run()` calls `submitRun({ toolId, targetLayerId, scope, lod: f.draft.lod, params: f.draft.params, prefix: f.draft.prefix, columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const })) })` (`ToolView.tsx:83`). The `DOUBLE` is hard-coded; all six roof columns are DOUBLE, so it holds. **Do not refactor it in M2.**
- `src/ui/processing/RunFooter.tsx:239` — Style by result styles `run.columns[0]`, "the first column the run wrote, in the tool's own order". `:249-254` — the button is disabled with `"stale: layer reloaded"` (outranks) or `"All values are empty"` when `run.summary?.measured === 0`. `:47-55` reads the median with `median(<column>)`.
- `src/ui/processing/runFormat.ts:8-16` — `PHASES` already contains `{ key: "extension", label: "Loading extension" }`; `phaseLine` (`:32-43`) ticks earlier phases and shows a skipped one as done.

### The DuckDB status surface

- `src/insights/duckdb.ts:24` — `export type ExtensionName = "cityjson" | "spatial" | "three_d"`. `:28-34` — `ExtensionStatus = { state: "unloaded" | "loading" | "loaded" } | { state: "failed"; error: string }`. `:41-52` — `DuckDBStatus` is `uninitialized | initializing | ready{extensions, loadedExtensions, platform} | failed{error}`.
- `duckdb.ts:85` — `let status: DuckDBStatus = { state: "uninitialized" }`. It is assigned at exactly **four** places: `:85` (initial), `:199` (`doInit` → `initializing`), `:242` (`doInit`'s catch → `failed`), and inside `publishReady()` at `:102-109`. **Nothing notifies anybody**; every reader polls `getDuckDBStatus()` (`:91-93`), which returns the module's STORED object — the same reference between transitions, and a new one only when `publishReady` mints it.
- `duckdb.ts:139-154` — `loadExtension(name)` sets `extensions[name] = { state: "loading" }` and then `loaded`/`failed`. It does **not** call `publishReady`, so the `"loading"` transition is never visible to a reader. It is also called for `cityjson` from `doInit` at `:236`, **before** the first `publishReady()` at `:239` — so a publish placed inside `loadExtension` would mint a `ready` status mid-boot. The publish must live in `ensureExtension`, guarded on `status.state === "ready"`.
- `duckdb.ts:275-296` — `ensureExtension(name)`: returns `true` immediately when already `loaded`; memoises one in-flight promise per extension and deletes it in `finally`, so a **failed** load can be retried by calling it again; re-reads `duckdb_extensions()` on success; calls `publishReady()` only `if (status.state === "ready")`. Returns `false` on failure, never throws. **It has no caller today.**
- `duckdb.ts:95-97` — `isExtensionLoaded(name)` is the cheap "already loaded" test.
- `src/app/App.tsx:286-288` — `const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({ state: "uninitialized" })`. Written at `:911` and `:917` (boot) and `:940-941` (Retry). Read at `:2290`, handed to `<DataDrawer duckdbStatus={…} onRetryDuckDB={…}/>` → `TablePanel` (`src/ui/table/TablePanel.tsx:49,56,268,557,570`).
- `src/insights/layerTables.ts:624-626` — `retryEngine()` awaits `initDuckDB()` and returns early unless the status is `ready`. Because `initDuckDB` (`duckdb.ts:261-266`) only re-runs `doInit` when `initPromise` is null, a Retry on a **ready** engine does not touch the status — App's current `setDuckdbStatus({state:"initializing"})` at `:940` makes the UI flash "Loading" for an engine that never left `ready`. Deleting the mirror fixes that.
- `src/ui/processing/useEligibilityContext.ts:5-9` carries the comment that says the subscription "arrive[s] with the executor (M2), and the status read moves with them". `:36` — `status: getDuckDBStatus()` is the plain read to replace. `:48-63` — `eligibilityContextFor` derives `extensionState: { spatial, three_d }` from `status.state === "ready" ? status.extensions : null`, defaulting to `"unloaded"`.
- `src/features/processing/eligibility.ts:73-81` — the extension reason already exists: `` `The ${tool.extension} extension could not be downloaded; check the connection and retry` ``, fired only on `extensionState[tool.extension] === "failed"`, and only AFTER the `!tool.implemented` check at `:44`.
- `src/ui/processing/CatalogueView.tsx:32-37` — `CHIP_TITLE` is a flat record with only the "not loaded yet" cost sentence. `:103-107` — the chip is rendered INSIDE the row's `<button>` (`:94-113`), so a Retry `<button>` cannot be nested there.

### Roof surfaces, LoDs and the two model kinds

- `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts:105-118` — `Surface` carries `type: BuildingSurfaceType` (`"RoofSurface"` at `:89`, alongside `WallSurface`, `GroundSurface` and six others) and `lod: string | null` (`:113`). `:125-143` — `CityObject` carries `surfaces`, `bbox`, `children`, `parents`, `lod`. **A surface's `lod` tag is what makes "does this object have GEOMETRY at LoD X" answerable without measuring anything** — §7's contributor rule asks exactly that, about surfaces of every type, not only roofs.
- `packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics/types.ts:6-15` — `RoofMetrics = { areaSqM; inclinationDeg; azimuthDeg; elevationM }`, all `number`.
- `.../navara-core/src/roofMetrics/metrics.ts:132-145` — `computeRoofMetrics(surface: Surface): RoofMetrics`, pure, exported from the package barrel (`navara-core/src/index.ts:148`). It reads `surface.rings[0]` only and returns all-zeros for a degenerate ring.
- `src/features/layers/layerStore.ts:261-269` — `computeAvailableLods(model)` is `{ surface.lod for every surface of every object }`, sorted `parseFloat` descending. `layerStore.ts:51-52` — `Layer.selectedLod: string | null`, `Layer.availableLods`.
- `src/domain/citymodel/featureId.ts:19-29,46-56` — `parentsIndexOf(objects)` and `rootFeatureId(id, parents)` are the SHARED vocabulary the reader's `feature_id` and the app-side fallback rows both use (`src/insights/layerRows.ts:21,162,183`). Cycle-safe; follows the first parent.
- **Streaming layers have an empty model.** `src/features/streaming/openStreamingLayer.ts:109-115` builds `const model: CityModel = { sourceEncoding: "flatcitybuf", …, objects: {}, vertexCount: 0 }`. `ctx.layer.model.objects` is `{}` for every FCB layer.
- The resident set is reachable from anywhere on the main thread: `src/features/streaming/residentModel.ts:46-53` — `getResidentModel(layerId, version): ResidentModel` reads `useStreamStore.getState().streams[layerId]?.handle`. `ResidentModel.objects` is `Record<string, ResidentObjectRecord>`; `version` is a **subscription marker** for React callers (`residentModel.ts:40-44`), bumped on every commit (`src/features/streaming/streamStore.ts:86,153`).
- `packages/…/navara-flatcitybuf/src/workerProtocol.ts:39-51` — `ResidentObjectRecord = { id; objectType; attributes; bbox; lod: string | null; surfaceCount; roofMetrics: ReadonlyArray<RoofMetrics>; footprintAreaSqM; volumeCuM; parents; children }`.
- **`roofMetrics` is NOT LoD-tagged and NOT LoD-filtered.** `packages/…/navara-flatcitybuf/src/objectRecords.ts:33-35` computes it as `obj.surfaces.filter((s) => s.type === "RoofSurface").map(computeRoofMetrics)`, and `fcb.worker.ts:408` calls `toObjectRecords(cellModel)` on the **unfiltered** cell model — `msg.lod` only filters the mesh arrays built at `fcb.worker.ts:356-364`. `record.lod` is the CityObject's lod, not the surfaces'. Task 5 fixes this.
- Readers of `record.roofMetrics` that a widened element type must not break: `src/ui/viewport/legendCounts.ts:94-103`, `src/ui/details/useResolvedSubject.ts:125`, `src/ui/details/DetailsPanel.tsx:263-268`, `src/insights/computeStats.ts:142,231`, `src/ui/drawer/derivedBuildingColumns.ts:19-20`. All of them read `areaSqM`/`inclinationDeg`/`azimuthDeg` or pass the array where `ReadonlyArray<RoofMetrics>` is expected — a widening (`RoofMetrics & { lod }`) is assignable to all of them.
- **`src/domain/roofMetrics/aggregate.ts` agrees with §7 on two measures and not on the rest.** `aggregateRoofMetrics` (`:39-58`) DOES compute an area-weighted mean inclination (`:50-54`) and DOES count surfaces as `metrics.length` — the same answers §7 wants for `roof_slope_deg` and `roof_surfaces_n`. What it cannot give M2: (a) `computeAverageAzimuth` (`:12-35`) is an area-weighted **circular mean**, not §7's "azimuth of the largest non-flat surface"; (b) its flat cut-off is a hard-coded `FLAT_THRESHOLD_DEG = 1` (`:8`), not the user's slider; (c) it returns `0` where §7 needs `null` ("NULL means could not be evaluated"), and it has no notion of flat area or flat share. Those three are why `roofRollUp.ts` exists rather than a wrapper. Leave `aggregate.ts` untouched — `src/ui/details/subject.ts:228` depends on its current behaviour.
- The table's three synthetic columns are `__roofy_roof_area`, `__roofy_mean_slope`, `__roofy_parts` (`src/ui/drawer/columnPolicy.ts:4-6`, values at `:91-95`, computed by `src/ui/drawer/derivedBuildingColumns.ts:30-66`). §7.1: they **stay as they are**; the computed columns sit beside them. No task touches them.

### Tests that M2 must move

- `tests/unit/features/processing/register.test.ts:18` — `expect(Object.keys(EXECUTORS)).toEqual(["height-from-extent"])`. Task 8 updates it.
- `tests/unit/ui/processing/useToolForm.test.tsx:54-71` — a registry mock that flips `measure-solids` to `implemented: true`, because "the only implemented M1 tool can never fail per layer". **This mock must STAY.** Roof metrics has `needsReader: false` and `extension: null` and (per Design decision (b)) is eligible on streaming too, so among the ready-table `candidates` it can no more discriminate than Height from extent can. Task 10 adds a comment saying why it survived.
- 26 test files carry a `vi.mock(".../insights/duckdb", …)` factory with a `getDuckDBStatus` key; Task 1 lists them.
- `tests/unit/ui/processing/CatalogueView.test.tsx:11-33` is the factory shape to copy: a flat object of `vi.fn`s.
- `tests/unit/app/appEngineBoot.test.tsx:99-113` mocks duckdb and asserts **nothing** about the status (`:226-343` are all about the streaming boot gate), so deleting App's mirror does not break it — it only needs the two new keys.

### UI tokens and peers

- `src/app/flatControls.css:237-284` styles **every** `input[type="range"]` in the app (3 px track, 12 px lime thumb, focus ring, disabled 0.4). A plain range input inside the processing panel is already on the tokens; no new slider CSS is needed, only layout.
- The slider peer to match: `src/ui/viewport/SunShadeSheet.tsx:142-165` — a `<label>` wrapping the caption, the `<input type="range">` with `aria-label`, and a muted ticks row under it.
- `src/ui/processing/processing.css:208-241` — `.processing-section` (a bare `<fieldset>`), `.processing-field` (a `64px 1fr` grid), `.processing-radios` (column flex, 6 px gap, 12 px labels), `.processing-chip` (`:162-169`, lime pill). `.processing-tool-row` (`:119-134`) is a full-width column flex button with `background/border/min-height` forced off.

### Docs state

- `docs/architecture-notes.md:107-147` — "Processing toolbox seam (M13.1, 2026-09-11)". Its last paragraph (`:136-138`) states the FCB merge boundary; M2 extends the section rather than starting a new one.
- `docs/roadmap.md:605-640` — the Milestone 13 entry and its "Carried to 13.2 / M2" list. **The list is stale**: it claims "§6.1 re-validation of an output column that has come to belong to the file itself is not implemented", which `runQueue.ts:419-442` contradicts. Task 13 refreshes it.
- `scripts/smoke/processing-m1.md` is the smoke recipe + record format to copy (last run 2026-09-11 @ `8ef02cd`, `agent-browser connect 9333` against a hand-launched Chromium).

---

## File map

**Create:**

| Path                                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/insights/useDuckDBStatus.ts`               | The ONE React door to the engine status: `useSyncExternalStore` over `subscribeDuckDBStatus` + `getDuckDBStatusVersion`. No copy in state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/domain/roofMetrics/roofRollUp.ts`          | Pure: `RoofSurfaceMetric`, `RoofRollUp`, `rollUpRoofSurfaces(surfaces, flatThresholdDeg)`. §7's six measures for ONE set of surfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/features/processing/roofMetricsParams.ts`  | Pure: `RoofMeasure`, `ROOF_MEASURES` (key, label, suffix, in §7.1 order), `RoofMetricsParams`, `roofParams(raw)`, `roofColumnNames(prefix, params)`, `DEFAULT_ROOF_PARAMS`, the threshold bounds. The ONE answer for the registry, the executor, the frozen request and the form.                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/features/processing/roofGeometrySource.ts` | `roofGeometrySource(layer)` (`has`/`hasGeometryAt`/`roofSurfacesAt`, memoised, measuring on demand), `featureIdsByObject(layer)`, `roofLodOptions(layer)` (tags only). The static/streaming split lives here and nowhere else.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/features/processing/tools/roofMetrics.ts`  | The executor: one SQL read, §7's geometry-keyed contributor rule, §8's root/part split, batches of `ROOF_BATCH_FEATURES`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/ui/processing/useLodOptions.ts`            | Hook: the LoD options for a tool + target, subscribed to the stream's commit version; empty for an unimplemented tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/ui/processing/RoofMetricsParams.tsx`       | The PARAMETERS section for `roof-metrics`: six checkboxes + the flat-threshold slider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `scripts/smoke/processing-m2.md`                | The browser smoke recipe and its record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Tests                                           | `tests/unit/insights/useDuckDBStatus.test.tsx`, `tests/unit/domain/roofRollUp.test.ts`, `tests/unit/features/processing/roofMetricsParams.test.ts`, `tests/unit/features/processing/roofGeometrySource.test.ts`, `tests/unit/features/processing/roofMetricsTool.test.ts`, `tests/unit/features/processing/roofMetricsRun.test.ts`, `tests/unit/ui/processing/extensionChip.test.tsx`, `tests/unit/ui/processing/roofLayerFixture.tsx`, `tests/unit/ui/processing/lodSelect.test.tsx`, `tests/unit/ui/processing/RoofMetricsParams.test.tsx`, `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`; plugin-side `packages/.../navara-flatcitybuf/tests/objectRecords.test.ts` |

**Modify:**

| Path                                                                                    | Change                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/insights/duckdb.ts`                                                                | `setStatus` notifier, `subscribeDuckDBStatus`, `getDuckDBStatusVersion`, publish the `"loading"` transition from `ensureExtension`.                   |
| `src/app/App.tsx`                                                                       | Delete the `duckdbStatus` `useState`; use `useDuckDBStatus()`; simplify `handleRetryDuckDB`.                                                          |
| `src/ui/processing/useEligibilityContext.ts`                                            | `useDuckDBStatus()` instead of the plain read; rewrite the stale comment.                                                                             |
| `src/features/processing/runQueue.ts`                                                   | The `"extension"` phase step and `extensionFailure`; `ToolContext.throwIfCancelled`; `summarise` gains `firstColumnNonNull` and the streaming clause. |
| `src/ui/processing/CatalogueView.tsx`                                                   | Per-state chip tooltip, muted chip, the Retry link (row restructured so the link is not nested in a button).                                          |
| `src/ui/processing/RunFooter.tsx`                                                       | Style by result gates on `firstColumnNonNull`, not on `measured`.                                                                                     |
| `src/ui/processing/processing.css`                                                      | `.processing-tool-row-wrap`, `.processing-chip[data-state]`, `.processing-retry`, `.processing-checks`, `.processing-slider`.                         |
| `src/features/processing/types.ts`                                                      | `ToolDefinition.needsLod`, `validateParams?`, `normaliseParams?`; `RunSummary.firstColumnNonNull`.                                                    |
| `src/features/processing/toolRegistry.ts`                                               | `needsLod` on all seven; `outputColumns` + `validateParams` + `normaliseParams` on `roof-metrics` (Task 7), then `implemented: true` (Task 12).       |
| `src/features/processing/tools/register.ts`                                             | `import "./roofMetrics";`                                                                                                                             |
| `src/ui/processing/useToolForm.ts`                                                      | `lodOptions`/`lodNoun`/`lodReason`, the effective `draft.lod`, `paramsError`, `extensionNote`, `runReason` precedence.                                |
| `src/ui/processing/ToolView.tsx`                                                        | The LoD field in TARGET; the PARAMETERS fieldset; the extension note; `run()` freezes the normalised params.                                          |
| `packages/…/navara-flatcitybuf/src/workerProtocol.ts`, `objectRecords.ts`               | `ResidentRoofMetrics` (LoD-tagged) and `ResidentObjectRecord.geometryLods`.                                                                           |
| `tests/unit/ui/drawer/layerSummary.test.ts`, `tests/unit/insights/computeStats.test.ts` | The hand-built resident-record literals the two new fields break (Task 5).                                                                            |
| `CLAUDE.md:116`                                                                         | The amended status rule.                                                                                                                              |
| `docs/architecture-notes.md`                                                            | Five new paragraphs in the M13.1 section.                                                                                                             |
| `docs/roadmap.md:605-640`                                                               | Add 13.2; refresh the stale carried list.                                                                                                             |
| 26 test files                                                                           | The two new duckdb mock keys (listed in Task 1).                                                                                                      |
| `tests/unit/features/processing/register.test.ts`                                       | The `EXECUTORS` pin.                                                                                                                                  |
| `tests/unit/ui/processing/ToolView.test.tsx`                                            | The "All values are empty" setup moves to `firstColumnNonNull`.                                                                                       |
| `tests/unit/features/processing/eligibility.test.ts`                                    | Roof metrics' eligibility on streaming and vector targets.                                                                                            |

---

## Design decisions

These three are settled here, before Task 1, because every later task builds on them.

### (a) The status subscription vs CLAUDE.md's "ONE writer"

**Decision: `duckdb.ts` publishes; React reads through `useSyncExternalStore`; `App`'s `useState` mirror is deleted; the hard rule is rewritten in the same commit.**

The rule exists to stop two components disagreeing about the engine's state. Today it is honoured by making `App` the only component with a copy and passing that copy down. That shape cannot express a lazy extension load: `App` never learns about one (nothing calls `setDuckdbStatus` from `ensureExtension`), so routing the chips through `App`'s state would still need a subscription — and would then have TWO mechanisms. The subscription is unavoidable; the only question is whether the `useState` copy survives it, and once `duckdb.ts` publishes, that copy is the redundant one.

**Mechanism.** In `duckdb.ts`:

- a module `listeners = new Set<() => void>()` and `let statusVersion = 0`;
- one internal `setStatus(next: DuckDBStatus): void` that assigns `status`, increments `statusVersion` and calls every listener. **All four** assignment sites go through it: `doInit`'s `initializing` (`:199`), `doInit`'s catch (`:242`), `publishReady` (`:102-109`), and the `"loading"` transition Step 4 adds inside `ensureExtension`. The `let status = { state: "uninitialized" }` initialiser at `:85` stays a plain assignment (nothing can be listening yet).
- `export function subscribeDuckDBStatus(listener: () => void): () => void`;
- `export function getDuckDBStatusVersion(): number`.

**Why a version counter and not `getDuckDBStatus` as the snapshot.** In PRODUCTION either works: `getDuckDBStatus()` returns the module's stored object, the same reference between transitions, which is a perfectly cached snapshot. The reason is the TESTS. `useSyncExternalStore` calls `getSnapshot` on every render and compares with `Object.is`, and 24 of the 26 `vi.mock` factories spell the status as `vi.fn(() => ({ state: … }))` — a **fresh object literal per call** (`CatalogueView.test.tsx:12`, `appEngineBoot.test.tsx:101`, …). Those would throw React's "The result of getSnapshot should be cached to avoid an infinite loop" in every test that renders `App` or a processing view, and the fix would be hoisting a const in 24 files rather than adding a key. A `number` snapshot is stable whatever a mock returns. That is a test-ergonomics decision, not a correctness one, and it is written down here so nobody later "simplifies" it back and is surprised. The hook is:

```ts
export function useDuckDBStatus(): DuckDBStatus {
  useSyncExternalStore(
    subscribeDuckDBStatus,
    getDuckDBStatusVersion,
    getDuckDBStatusVersion,
  );
  return getDuckDBStatus();
}
```

It holds no copy: the store's value is read fresh on every render, and the version only decides _when_ to render.

**The rule's new text** (`CLAUDE.md:116`):

> - ONE writer of the DuckDB status: `duckdb.ts` owns the value and publishes every transition (`setStatus`). React reads it through `useDuckDBStatus()` (`src/insights/useDuckDBStatus.ts`, a `useSyncExternalStore` over `subscribeDuckDBStatus` + `getDuckDBStatusVersion`) — never into component state, and nothing else publishes.

**Bonus correctness, worth stating in the note:** `retryEngine()` on a _ready_ engine does not re-run `doInit` (`duckdb.ts:261-266`), so App's current optimistic `setDuckdbStatus({state:"initializing"})` at `App.tsx:940` shows "Loading" for an engine that never left `ready`. The hook cannot do that.

**Approved.** The M2 plan review (`.superpowers/sdd/2026-09-10-processing-toolbox-m1/m2-plan-review.md`) accepts the single-owner subscription rule change, on condition that `retryEngine()` stays the door for boot and the engine Retry and that the sole-importer rule is untouched — both hold. It is therefore no longer an open question; Task 1 commits the `CLAUDE.md` edit with the code.

**Cost if wrong:** two extra exports and one hard-rule edit to revert; the status still has exactly one owner either way.

### (b) Roof metrics on streaming (FCB) layers

**Decision: streaming targets are IN for computing and writing. The FCB attribute WRITE-BACK into the model (which is what puts a run's values in Details, the rule editor and a colour rule) is DEFERRED past M2 by an explicit, renewed scope ruling — not by calling it "an unchanged seam".**

Spec §7.1 says the tool "works on every city layer kind including streaming (resident set)", and §10 scenario 4 is an acceptance scenario about it. `getResidentModel(layerId, 0).objects` (`residentModel.ts:46-53`) hands any caller the resident `ResidentObjectRecord`s, each with roof metrics the worker already computed — so the compute half is one adapter.

**Two blockers in the record, and why both are worth one submodule commit.** `record.roofMetrics` is built from **all** of `obj.surfaces` regardless of LoD (`objectRecords.ts:33-35`, on the unfiltered `cellModel` at `fcb.worker.ts:408`), and `record.lod` labels the _object_, not the surfaces — so a LoD select fed by it would sum areas across every LoD in the file. And the record carries no way to answer §7's contributor question, "does this object have GEOMETRY (of any kind) at this LoD", because non-roof surfaces are dropped entirely; `surfaceCount` is a total with no LoD breakdown. Task 5 fixes both, additively: `roofMetrics` becomes `ReadonlyArray<ResidentRoofMetrics>` (`RoofMetrics` widened with the surface's `lod`), and the record gains `geometryLods: ReadonlyArray<string>`, the distinct non-null `Surface.lod` values over ALL of the object's surfaces. Every existing READER (`legendCounts.ts:94-103`, `useResolvedSubject.ts:125`, `DetailsPanel.tsx:263-268`, `computeStats.ts:142,231`, `derivedBuildingColumns.ts:19-20`) is unaffected by a widening; existing hand-built record LITERALS in tests are not, and Task 5 updates the two files that have them.

**The deferral, stated plainly.** The M1 ledger parked the FCB Details/rules write-back **to M2**, and §7.1 and §8 do ask for it. This plan does **not** deliver it, because the milestone's scope as set by the user is "Roof metrics + lazy extension loading + the status subscription". The mechanism: `runQueue.ts:575-589` merges a run's values into `layer.model.objects` and skips any id the model lacks, and an FCB layer's `model.objects` is `{}` (`openStreamingLayer.ts:113`). Closing it means giving the FCB plugin an attribute-overlay seam — resident records (and the worker's cache, so a re-fetched cell keeps the values) carrying app-written attributes, plus an `Undo` path that removes them — and then teaching `mergeAttributes`/`DetailsPanel`/the rule evaluator to read it. That is its own change, in the submodule, with its own worker-protocol version. **Open question 10 asks the human whether to pull it into M2 or schedule it as M3.** Until then, a streaming run's values live in the table (grid, filter, sort, export) and nowhere else, exactly as Height from extent's already do — and the gate records it as an unmet part of §7.1/§8 rather than as a closed seam. A camera settle rebuilds the table and the run reads "stale: layer reloaded", which is what §7's last bullet and scenario 4 ask for.

**Evicted residents.** A frozen row whose object is no longer resident when the run executes is in neither map. It is counted under `no roof surfaces at LoD X` — honest (there is, now, no geometry to measure) and it keeps the skip causes adding up to the skipped count as §6.2 requires. No second cause is invented.

**Cost if wrong:** one submodule commit to revert plus the `isStreaming` branches in `roofGeometrySource.ts`. If the human would rather keep M2 out of the submodule, Task 5 is dropped and Roof metrics needs an eligibility reason for streaming targets (proposed, **[adapted]**: "Roof surfaces are not tagged by LoD for a streaming layer"), with §7.1 and scenario 4 on the deviation list. That is strictly worse; it is recorded only so the choice is visible.

### (c) Where the metrics are computed, and from which fields

**Decision: entirely app-side, from `Surface.type === "RoofSurface"` + `Surface.lod` + `computeRoofMetrics(surface)` (static) or the LoD-tagged resident `roofMetrics` (streaming). The only SQL is the id/feature read. `computeRoofMetrics` is called ONLY for the surfaces a run actually needs — the scoped features' contributors at the chosen LoD — never for a whole layer and never to populate a dropdown.**

Verified: surfaces carry both the semantic type and the LoD tag (`navara-core/src/citymodel/types.ts:105-118`), and `computeRoofMetrics` (`metrics.ts:132-145`) already yields area, inclination and azimuth per surface. Nothing about a roof is in DuckDB (spec §2's last-but-two bullet), so a SQL compute would mean re-reading geometry the tool does not need — hence `needsReader: false`, no `registerBuffer`, and the "Reading source" phase stays skipped (`phaseLine` renders a skipped phase as done, `runFormat.ts:32-43`).

**How the executor gets its rows.** Exactly as `heightFromExtent` does: `ctx.featureIds` are ROW ids or `null`, and the executor asks the TABLE which rows exist and which feature each belongs to —

```sql
SELECT "id", COALESCE("feature_id", "id") AS f FROM <table> [WHERE "id" IN (…)]
```

The table is the authority on the rows to write; the model/resident map is the authority on the geometry. A row with no entry in the geometry map simply has no surfaces.

**Contributors and roll-ups (§7), spelled out.** §7's sentence is: "At the chosen LoD, if any part of the feature has **geometry**, the PARTS are the contributors and the root's own geometry at that LoD is ignored (3D BAG stores the same building on both); otherwise the root is the sole contributor." **Geometry, not roof surfaces.** The distinction is load-bearing and is the plan's first correction: a Building with a roof at LoD 2.2 whose BuildingPart has only WALLS at 2.2 selects the PART as its contributor, and the feature is then skipped for having no roof — the root's roof is not silently used instead. Getting this wrong measures the 3D BAG double-storage this rule exists to avoid. So, for each feature `f` and the chosen `lod`:

1. `geometryLods(id)` — the distinct non-null `Surface.lod` values over ALL of the object's surfaces, whatever their semantic type. For a resident record this is the new `geometryLods` field (Task 5).
2. If any **non-root** member has `lod ∈ geometryLods(id)`, the contributors are exactly those non-root members that do; otherwise the root is the sole contributor (and only if IT has geometry at the LoD — a feature with geometry nowhere at this LoD has no contributor at all).
3. `roofSurfacesAt(id, lod)` — measured on demand, only for the contributors chosen above.
4. The **root row** is written the roll-up over the contributors' roof surfaces; **every other row** is written the roll-up over its OWN roof surfaces at that LoD (§8: "a Building shows the aggregated value, a part its own"). This is `heightFromExtent.ts:130-138`'s shape exactly.
5. A feature whose contributors yield no roof surfaces gets NULL in every column and is counted skipped, cause `` `no roof surfaces at LoD ${lod}` `` — whether that is because it has no geometry at the LoD or because the geometry it has carries no roof.

**The six measures** (§7.1 order, which is also `run.columns[0]` order for Style by result):

| Column             | Roll-up                                                                                        | NULL when                             |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| `roof_area_m2`     | Σ `areaSqM`                                                                                    | no surfaces                           |
| `roof_flat_m2`     | Σ `areaSqM` where `inclinationDeg < threshold`                                                 | no surfaces                           |
| `roof_flat_share`  | `flat / area`                                                                                  | no surfaces, or `area === 0`          |
| `roof_slope_deg`   | Σ(`inclinationDeg` × `areaSqM`) / Σ `areaSqM` — area-weighted, §7                              | no surfaces, or `area === 0`          |
| `roof_azimuth_deg` | `azimuthDeg` of the largest-area surface with `inclinationDeg >= threshold`; ties to the first | no surfaces, or every surface is flat |
| `roof_surfaces_n`  | count of surfaces                                                                              | no surfaces                           |

The threshold is **strict** (`inclinationDeg < flatThresholdDeg`), matching §7.1's word "under": a surface at exactly the threshold is not flat, and is therefore a candidate for the dominant azimuth. The visible consequence is at the slider's bottom stop — at 0° a perfectly horizontal roof counts as NOT flat and `roof_flat_m2` is 0, which is the honest reading of "slope under 0 degrees" and is why the default is 5. `roof_slope_deg` is over **all** roof surfaces and is unaffected by the threshold. All six columns are `DOUBLE` (`roof_surfaces_n` included — `ToolView.tsx:83` hard-codes it and a count in a DOUBLE column is what M1 already writes for extents).

**Cost if wrong:** the roll-up is one pure function with one test file; the contributor rule is one branch.

---

### Task 1: The DuckDB status subscription, and the hard rule that changes with it

**Files:**

- Create: `src/insights/useDuckDBStatus.ts`
- Modify: `src/insights/duckdb.ts` (the four `status =` sites, `publishReady`, `ensureExtension`), `src/app/App.tsx:286-288, 908-920, 933-942, 2290`, `src/ui/processing/useEligibilityContext.ts:1-37`, `CLAUDE.md:116`, `docs/architecture-notes.md` (append to the M13.1 section)
- Modify (mechanical, two keys each): the 26 test files listed in Step 6
- Test: `tests/unit/insights/useDuckDBStatus.test.tsx`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `duckdb.ts`: `export function subscribeDuckDBStatus(listener: () => void): () => void` and `export function getDuckDBStatusVersion(): number`.
  - `src/insights/useDuckDBStatus.ts`: `export function useDuckDBStatus(): DuckDBStatus`.
  - Task 3 consumes `useDuckDBStatus` through `useEligibilityInputs`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/insights/useDuckDBStatus.test.tsx`. This is the ONE unit test that runs the REAL `duckdb.ts` — it is the module under test, and mocking it would test nothing. The engine underneath it is a controlled fake at the PACKAGE boundary, so every transition the test asserts is one `duckdb.ts` really performed: `initializing` → `ready`, then a lazy `loading` → `loaded`, then a lazy `loading` → `failed`.

```tsx
/**
 * `useDuckDBStatus` is the ONE React door to the engine's status (CLAUDE.md),
 * and `duckdb.ts` is the ONE publisher. Both are exercised for real here: the
 * fake sits at the `@duckdb/duckdb-wasm` boundary, so `doInit`, `loadExtension`
 * and `ensureExtension` all run their own code and every transition asserted
 * below is one the module actually published.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/** SQL the fake connection saw, which extensions it refuses, and whether the
 *  bundle selection itself fails (the boot-failure path). */
const queries: string[] = [];
const refuse = new Set<string>();
let failBundle = false;

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
      queries.push(sql);
      const named = /^(?:INSTALL|LOAD)\s+(\w+)/.exec(sql);
      if (named && refuse.has(named[1]!)) {
        throw new Error(`Extension "${named[1]!}" not found\nLINE 1: ${sql}`);
      }
      // `readPlatform` and `readLoadedExtensions` are best-effort and both
      // tolerate this shape (`getChild(...)?.get(0)`, `numRows`).
      return { getChild: () => null, numRows: 0 };
    }
  }
  return {
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return new FakeConnection();
      }
    },
    ConsoleLogger: class {},
    LogLevel: { WARNING: 2 },
    getJsDelivrBundles: () => ({}),
    selectBundle: async () => {
      if (failBundle) throw new Error("no bundle for this platform");
      return {
        mainWorker: "https://example.test/duckdb-worker.js",
        mainModule: "https://example.test/duckdb.wasm",
      };
    },
  };
});

// jsdom has neither of these, and `doInit` uses both to wrap the CDN worker.
class FakeWorker {
  terminate() {}
}

type DuckdbModule = typeof import("../../../src/insights/duckdb");
type HookModule = typeof import("../../../src/insights/useDuckDBStatus");
let duckdb: DuckdbModule;
let hook: HookModule;

beforeEach(async () => {
  queries.length = 0;
  refuse.clear();
  failBundle = false;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  // `duckdb.ts` is a module singleton: a fresh copy per test is the only way
  // to observe a BOOT, which happens exactly once per module instance.
  vi.resetModules();
  duckdb = await import("../../../src/insights/duckdb");
  hook = await import("../../../src/insights/useDuckDBStatus");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every state the module published, in order, for one test. */
function record(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const stop = duckdb.subscribeDuckDBStatus(() => {
    const status = duckdb.getDuckDBStatus();
    const suffix =
      status.state === "ready" ? `:${status.extensions.spatial.state}` : "";
    seen.push(`${status.state}${suffix}`);
  });
  return { seen, stop };
}

describe("duckdb.ts publishes every transition", () => {
  it("announces the boot: initializing, then ready", async () => {
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    stop();
    expect(seen).toEqual(["initializing", "ready:unloaded"]);
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    expect(queries).toContain("INSTALL cityjson FROM community");
  });

  it("announces a FAILED boot: initializing, then failed, once", async () => {
    // The fake's `selectBundle` is the first thing `doInit` awaits, so
    // rejecting it exercises the catch without touching the Worker shim.
    failBundle = true;
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    stop();
    expect(seen).toEqual(["initializing", "failed"]);
    const status = duckdb.getDuckDBStatus();
    expect(status.state).toBe("failed");
    if (status.state !== "failed") throw new Error("unreachable");
    expect(status.error).toContain("no bundle");
    // `doInit`'s catch clears the memo, so a Retry really retries.
    failBundle = false;
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
  });

  it("announces a lazy load: loading, then loaded", async () => {
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    await duckdb.ensureExtension("spatial");
    stop();
    expect(seen).toEqual(["ready:loading", "ready:loaded"]);
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
  });

  it("announces a lazy FAILURE: loading, then failed, with the reason", async () => {
    refuse.add("spatial");
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    const ok = await duckdb.ensureExtension("spatial");
    stop();
    expect(ok).toBe(false);
    expect(seen).toEqual(["ready:loading", "ready:failed"]);
    const status = duckdb.getDuckDBStatus();
    expect(status.state).toBe("ready");
    if (status.state !== "ready") throw new Error("unreachable");
    const spatial = status.extensions.spatial;
    expect(spatial.state).toBe("failed");
    if (spatial.state !== "failed") throw new Error("unreachable");
    // `formatDuckDBError` keeps the first line and drops the `LINE 1:` echo.
    expect(spatial.error).toBe('Extension "spatial" not found');
  });

  it("de-duplicates concurrent loads into ONE install", async () => {
    await duckdb.initDuckDB();
    queries.length = 0;
    await Promise.all([
      duckdb.ensureExtension("spatial"),
      duckdb.ensureExtension("spatial"),
      duckdb.ensureExtension("spatial"),
    ]);
    expect(queries.filter((q) => q === "INSTALL spatial")).toHaveLength(1);
  });

  it("lets a FAILED load be retried — the memo is cleared, not sticky", async () => {
    refuse.add("spatial");
    await duckdb.initDuckDB();
    expect(await duckdb.ensureExtension("spatial")).toBe(false);
    refuse.delete("spatial");
    const { seen, stop } = record();
    expect(await duckdb.ensureExtension("spatial")).toBe(true);
    stop();
    expect(seen).toEqual(["ready:loading", "ready:loaded"]);
  });

  it("sends nothing to a listener that has unsubscribed", async () => {
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    stop();
    await duckdb.ensureExtension("spatial");
    expect(seen).toEqual([]);
    // …while a listener that stayed DOES hear the same transition.
    const after = record();
    await duckdb.ensureExtension("three_d");
    after.stop();
    expect(after.seen.length).toBeGreaterThan(0);
  });
});

function Probe() {
  const status = hook.useDuckDBStatus();
  const extra =
    status.state === "ready" ? `/${status.extensions.spatial.state}` : "";
  return <span data-testid="state">{`${status.state}${extra}`}</span>;
}

describe("useDuckDBStatus", () => {
  it("renders the state the module has, and re-renders on every transition", async () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("uninitialized");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    expect(screen.getByTestId("state").textContent).toBe("ready/unloaded");
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(screen.getByTestId("state").textContent).toBe("ready/loaded");
  });

  it("stops listening when the component unmounts", async () => {
    const view = render(<Probe />);
    await act(async () => {
      await duckdb.initDuckDB();
    });
    view.unmount();
    // No act() wrapper and no warning: nothing is subscribed any more, so this
    // transition must not schedule a React update at all.
    await duckdb.ensureExtension("spatial");
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx
```

Expected: FAIL — `Failed to resolve import "../../../src/insights/useDuckDBStatus"`, and `subscribeDuckDBStatus`/`getDuckDBStatusVersion` are not exported by `duckdb.ts`. The two transition suites will also fail because no listener is ever called.

- [ ] **Step 3: Publish every transition from `duckdb.ts`**

In `src/insights/duckdb.ts`, immediately after `let status: DuckDBStatus = { state: "uninitialized" };` (`:85`), add:

```ts
/**
 * The status is a VALUE React subscribes to, so every transition has to be
 * announced. `statusVersion` — not the status object — is what
 * `useSyncExternalStore` snapshots. In PRODUCTION either would do:
 * `getDuckDBStatus()` returns this module's STORED object, the same reference
 * between transitions. The counter is for the TESTS, where 24 of the 26 mock
 * factories spell the status as `vi.fn(() => ({ … }))` — a fresh literal per
 * call, which React rejects as an uncached snapshot. A number cannot be spelled
 * that way by accident.
 */
let statusVersion = 0;
const statusListeners = new Set<() => void>();

/** The ONE writer. Every `status = …` in this module goes through it. */
function setStatus(next: DuckDBStatus): void {
  status = next;
  statusVersion += 1;
  for (const listener of [...statusListeners]) listener();
}

export function subscribeDuckDBStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getDuckDBStatusVersion(): number {
  return statusVersion;
}
```

Then route the three remaining assignments through it:

- `publishReady()` (`:102-109`) — replace `status = { … }` with `setStatus({ state: "ready", extensions: { ...extensions }, loadedExtensions, platform });`
- `doInit` (`:199`) — `setStatus({ state: "initializing" });`
- `doInit`'s catch (`:242`) — `setStatus({ state: "failed", error: message });`

Leave the `let status = { state: "uninitialized" }` initialiser alone: nothing can be listening at module evaluation.

- [ ] **Step 4: Make the `"loading"` transition visible**

`loadExtension` sets `extensions[name] = { state: "loading" }` (`duckdb.ts:142`) but nothing publishes it, so §6.1's chip can never say an extension is loading. The publish must NOT go inside `loadExtension`: `doInit` calls it for `cityjson` at `:236`, **before** the first `publishReady()` at `:239`, and a publish there would mint a `ready` status in the middle of the boot. Put it in `ensureExtension` instead — replace the body's opening (`duckdb.ts:275-282`) with:

```ts
export async function ensureExtension(name: ExtensionName): Promise<boolean> {
  if (extensions[name].state === "loaded") return true;
  const existing = extensionPromises.get(name);
  if (existing) return await existing;
  const promise = (async () => {
    // The "loading" state has to reach the catalogue's chip (spec §5), and
    // `loadExtension` cannot announce it itself — `doInit` calls that function
    // for `cityjson` before the status is `ready` at all, so a publish inside
    // it would announce a half-built engine.
    extensions = { ...extensions, [name]: { state: "loading" } };
    if (status.state === "ready") publishReady();
    const ok = await loadExtension(name);
    if (ok) loadedExtensions = await readLoadedExtensions();
    if (status.state === "ready") publishReady();
    return ok;
  })().finally(() => extensionPromises.delete(name));
  extensionPromises.set(name, promise);
  return await promise;
}
```

(The `loading` assignment inside `loadExtension` stays; it is idempotent with this one.)

- [ ] **Step 5: Write the hook**

Create `src/insights/useDuckDBStatus.ts`:

```ts
/**
 * The ONE React door to the DuckDB engine's status.
 *
 * `duckdb.ts` owns the value and publishes every transition; this hook decides
 * when a component re-renders and reads the value fresh. It deliberately holds
 * NO copy — a component with `useState<DuckDBStatus>` is a second writer, which
 * is the thing the hard rule in CLAUDE.md forbids.
 *
 * The snapshot is the VERSION COUNTER, not the status. `useSyncExternalStore`
 * compares snapshots with `Object.is` on every render; the real
 * `getDuckDBStatus()` would pass that test on its own (it returns the module's
 * stored object, unchanged between transitions), but 24 of the app's test mock
 * factories return a fresh literal per call and React would reject those as
 * uncached snapshots and loop. A number cannot be spelled that way by accident,
 * and the value is one plain read away.
 */
import { useSyncExternalStore } from "react";
import {
  getDuckDBStatus,
  getDuckDBStatusVersion,
  subscribeDuckDBStatus,
  type DuckDBStatus,
} from "./duckdb";

export function useDuckDBStatus(): DuckDBStatus {
  useSyncExternalStore(
    subscribeDuckDBStatus,
    getDuckDBStatusVersion,
    getDuckDBStatusVersion,
  );
  return getDuckDBStatus();
}
```

- [ ] **Step 6: Add the two new keys to every duckdb mock factory**

The global constraint: a new `duckdb.ts` export goes into every `vi.mock(".../insights/duckdb", …)` factory. Add these two lines beside the existing `getDuckDBStatus` key:

```ts
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
```

The 26 files (all of them already have a `getDuckDBStatus` key, so the insertion point is unambiguous):

```
tests/integration/duckdb/computedColumns.test.ts
tests/integration/duckdb/layerTables.test.ts
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

Two of them (`tests/integration/duckdb/*.test.ts`) spell every key as a shared `unreachable` stub; follow the file's own idiom there (`subscribeDuckDBStatus: () => () => {}`, `getDuckDBStatusVersion: () => 0` — a subscription in an integration test must not throw, so `unreachable` is wrong for these two).
`tests/unit/ui/table/useLayerCounts.test.tsx` mocks `duckdb` **without** a `getDuckDBStatus` key and renders no component that reaches the hook; leave it alone.

- [ ] **Step 7: Delete App's mirror**

In `src/app/App.tsx`:

- Replace `const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({ state: "uninitialized" });` (`:286-288`) with `const duckdbStatus = useDuckDBStatus();`
- Swap the import at `:50` — `import { useDuckDBStatus } from "../insights/useDuckDBStatus";` replaces `import { getDuckDBStatus } from "../insights/duckdb";` (keep the `DuckDBStatus` type import if `TablePanel`'s prop type needs it locally; it does not — the type flows through the hook).
- Boot effect (`:908-920`): delete both `setDuckdbStatus` lines. The comment about announcing the attempt first is now wrong; replace it with:

```ts
// `retryEngine`, not `initDuckDB`: it awaits the same (memoised) boot and
// then rebuilds any table that was refused while the engine was still
// coming up. A layer added during the boot — a restored snapshot, a share
// link, a quick drop — must not need the user to notice and re-add it.
//
// Nothing sets the status here any more: `doInit` publishes `initializing`
// synchronously on the first call and `ready`/`failed` when it lands, and
// `useDuckDBStatus` renders each of them. The old optimistic
// `setDuckdbStatus({ state: "initializing" })` was also WRONG on the Retry
// path — `initDuckDB` does not re-run a boot that already succeeded, so a
// Retry aimed at a failed TABLE made a healthy engine read "Loading".
void retryEngine();
```

- `handleRetryDuckDB` (`:933-942`) becomes:

```ts
const handleRetryDuckDB = useCallback(() => {
  void retryEngine();
}, []);
```

keeping its existing doc comment minus the sentence about setting the status.

- `:2290` is unchanged — `duckdbStatus={duckdbStatus}` now reads the hook's value.

- [ ] **Step 8: Move the processing panel's read onto the hook**

In `src/ui/processing/useEligibilityContext.ts`, replace the `getDuckDBStatus` import (`:17-18`) with `import { useDuckDBStatus } from "../../insights/useDuckDBStatus";` plus `import type { DuckDBStatus } from "../../insights/duckdb";`, change `:36` to `return { tables, hasVectorLayer, status: useDuckDBStatus() };`, and replace the head comment's first paragraph (`:5-9`) with:

```
 * The status is SUBSCRIBED (`useDuckDBStatus`), not polled. A lazy extension
 * load moves it without touching a layer's table, so the catalogue's chips and
 * the extension-failure reason would otherwise go on showing the state the
 * panel happened to open with.
```

- [ ] **Step 9: Run the new test, then the suite**

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx
npx vitest run tests/unit/app tests/unit/ui/processing tests/unit/ui/table tests/unit/insights
```

Expected: PASS. A `The result of getSnapshot should be cached` error anywhere means a mock factory was missed — re-check Step 6.

- [ ] **Step 10: Amend the hard rule and write the story**

`CLAUDE.md:116` — replace the line with:

```markdown
- ONE writer of the DuckDB status: `duckdb.ts` owns the value and publishes every transition (`setStatus`). React reads it through `useDuckDBStatus()` (`src/insights/useDuckDBStatus.ts`, a `useSyncExternalStore` over `subscribeDuckDBStatus` + `getDuckDBStatusVersion`) — never into component state, and nothing else publishes.
```

`docs/architecture-notes.md` — append to the "Processing toolbox seam (M13.1, 2026-09-11)" section:

```markdown
**The engine status is published, not polled (M13.2).** `duckdb.ts` keeps a
listener set and a version counter; `setStatus` is the one writer and every
transition — `initializing`, `ready`, `failed`, and each lazy extension's
`loading`/`loaded`/`failed` — goes through it. React reads the value through
`useDuckDBStatus()`, a `useSyncExternalStore` whose SNAPSHOT is the version
counter rather than the status object. The status object itself would be a
valid snapshot — `getDuckDBStatus()` returns the module's stored reference —
but the app's test mock factories return a fresh literal per call, which React
rejects as uncached; a counter cannot be written that way by accident.
`App` no longer mirrors the status in
`useState`. That mirror was also subtly wrong: `retryEngine()` on an engine
that is already `ready` does not re-run `doInit`, so App's optimistic
`setDuckdbStatus({ state: "initializing" })` made a healthy engine read
"Loading" whenever the user retried a failed TABLE.
```

- [ ] **Step 11: Verify and commit**

```bash
npx vp check && npx tsc -b --noEmit && npx vitest run
git add src/insights/duckdb.ts src/insights/useDuckDBStatus.ts src/app/App.tsx \
  src/ui/processing/useEligibilityContext.ts CLAUDE.md docs/architecture-notes.md \
  tests/unit/insights/useDuckDBStatus.test.tsx tests/unit tests/integration
git commit -m "feat(insights): publish the DuckDB status and read it through one hook"
```

---

### Task 2: The "Loading extension" phase in the run queue

**Files:**

- Modify: `src/features/processing/runQueue.ts` (between the executor lookup at `:443-451` and `resolveScope` at `:453`)
- Test: `tests/unit/features/processing/runQueue.test.ts`

**Interfaces:**

- Consumes: `isExtensionLoaded(name)` and `ensureExtension(name)` from `src/insights/duckdb.ts` (existing exports); `getDuckDBStatus()` for the recorded load error.
- Produces: nothing new for later tasks. Roof metrics has `extension: null` and never enters this branch — the branch exists for M3's `three_d`/`spatial` tools, and this task is what makes them a one-line registry change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/features/processing/runQueue.test.ts`. Use `measure-solids` as the fake extension tool: `toolById("measure-solids").extension === "three_d"` (`toolRegistry.ts:26`) and `execute` only consults `EXECUTORS`, never `implemented` — so registering an executor for it is enough, with no registry mock.

```ts
describe("the Loading extension phase (spec §6.1)", () => {
  it("loads the tool's extension under its own phase before computing", async () => {
    const phases: Array<string | null> = [];
    const unsub = useProcessingStore.subscribe((s) => {
      const run = s.runs[0];
      if (run && phases[phases.length - 1] !== run.phase)
        phases.push(run.phase);
    });
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(true);
    registerExecutor("measure-solids", async () => ({
      columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      rows: new Map([["b1", { solid_volume_m3: 1 }]]),
      measured: 1,
      skipped: [],
    }));

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    unsub();

    expect(ensureExtension).toHaveBeenCalledWith("three_d");
    expect(phases).toContain("extension");
    expect(phases.indexOf("extension")).toBeLessThan(phases.indexOf("compute"));
    expect(runById(id)?.status).toBe("done");
  });

  it("skips the phase when the extension is already loaded", async () => {
    vi.mocked(isExtensionLoaded).mockReturnValue(true);
    registerExecutor("measure-solids", async () => ({
      columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      rows: new Map([["b1", { solid_volume_m3: 1 }]]),
      measured: 1,
      skipped: [],
    }));

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    expect(ensureExtension).not.toHaveBeenCalled();
  });

  it("fails the run when the extension cannot be loaded, and writes nothing", async () => {
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(false);
    vi.mocked(getDuckDBStatus).mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "failed", error: "HTTP 404" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
    let ran = false;
    registerExecutor("measure-solids", async () => {
      ran = true;
      throw new Error("unreachable");
    });

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));

    expect(ran).toBe(false);
    const run = runById(id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe(
      "The three_d extension could not be loaded: HTTP 404",
    );
    // §6.4: the engine's own reason survives in the log whichever sentence
    // the card shows — including the offline one, which replaces it.
    expect(run?.warnings).toContain("three_d: HTTP 404");
    expect(run?.undoable).toBe(false);
  });
});
```

`request(overrides)` is the file's own request builder (`runQueue.test.ts:268-279`; its defaults already target `"L1"` with scope `"all"`), and `vi.waitFor` is how every test in the file settles a run — there is no `settle()` helper, do not invent one. Add `ensureExtension`, `isExtensionLoaded` and `getDuckDBStatus` to the file's imports from `src/insights/duckdb`; `registerExecutor` and `EXECUTORS` are already imported (`:173-174`). The file's existing duckdb mock factory already stubs all three (`runQueue.test.ts:100`); if `isExtensionLoaded`/`ensureExtension` are plain `vi.fn`s there, they are already `vi.mocked`-able. Reset them in the suite's `beforeEach` (`runQueue.test.ts:281-296`) alongside the existing resets, and add `delete EXECUTORS["measure-solids"]` to the existing `afterEach` (`:297-300`) beside the `height-from-extent` line, so the `register.test.ts` pin (Task 8) is not polluted — Vitest isolates modules per file, so this is belt-and-braces.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Loading extension"
```

Expected: FAIL — `ensureExtension` is never called, `phases` never contains `"extension"`, and the third test's run reaches the executor and reads `done`.

- [ ] **Step 3: Add the phase step**

In `src/features/processing/runQueue.ts`, add to the imports from `../../insights/duckdb`: `ensureExtension`, `isExtensionLoaded`, `getDuckDBStatus`. Then insert this block between the `if (!executor) { … }` guard (ending `runQueue.ts:451`) and `const scope = await resolveScope({` (`:453`):

```ts
// Spec §6.1's first phase, "Loading extension (skipped once loaded)".
//
// It sits AFTER the cheap pre-flight refusals — a missing layer, a rebuilt
// table, a column that now belongs to the file, an unimplemented tool — so
// a run that cannot succeed never triggers a 24 MB download.
//
// It also sits INSIDE `runOnTableQueue`: the load blocks table builds for
// its duration, once per session. That is the deliberate trade. Loading
// outside the queue would take the phase out of §6.1's sequence and would
// let the run start against a table that is being rebuilt underneath it.
const tool = toolById(request.toolId);
if (tool.extension !== null && !isExtensionLoaded(tool.extension)) {
  patch(id, {
    status: "running",
    phase: "extension",
    startedAt: Date.now(),
  });
  const loaded = await ensureExtension(tool.extension);
  // `ensureExtension` cannot be aborted (it is one memoised INSTALL/LOAD
  // per extension), so a Cancel pressed during the download is honoured
  // here, on the far side of it.
  if (signal.aborted) {
    if (!failedAlready(id)) {
      patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
    }
    return;
  }
  if (!loaded) {
    // §6.4 makes the log the reproducible record of the run, so DuckDB's own
    // reason is kept there even when the card shows the offline sentence
    // instead — a bug report needs the engine's words, not only ours.
    const reason = extensionReason(tool.extension);
    if (reason !== null) {
      warnings.push(`${tool.extension}: ${reason}`);
      patch(id, { warnings: [...warnings] });
    }
    patch(id, {
      status: "failed",
      phase: null,
      error: extensionFailure(tool.extension),
      elapsedMs: elapsed(),
    });
    return;
  }
}
```

Note: `const tool = toolById(request.toolId)` is declared here; the publication block further down declares its own `const tool` (`runQueue.ts:591`) — rename that later one's reference or reuse this binding. **Reuse it**: delete the second declaration and let the publication block use this one. (It is the same tool, and two bindings with one name in one function body is a `tsc` error.)

**One consequence to leave in place and record.** `execute` patches `startedAt: Date.now()` again when it flips to `phase: "compute"` (`runQueue.ts:463-470`), so a run that spent seconds downloading an extension sees its live ticker jump back to zero at the hand-off. The roadmap already carries "the run's live elapsed timer starts at submit but is measured from execute, so it can jump back"; extend that bullet in Task 11 rather than changing the patch here — the elapsed number the CARD finally reports is computed from `started` (`runQueue.ts`'s `elapsed()`), which does include the download.

Add the message builder beside `failedAlready` (`runQueue.ts`, near `:400`):

```ts
/**
 * Spec §6.3: "Extension load failures say what failed to load and, for the
 * offline case, that it needs a network connection."
 *
 * The engine's own recorded reason is appended when there is one — it is the
 * same first-line treatment every other DuckDB error in this app gets — and an
 * offline browser is told the one thing it can act on instead, because
 * "HTTP request failed" is not a sentence a user can do anything with.
 */
/** DuckDB's own recorded reason for the failed load, or null. */
function extensionReason(name: "spatial" | "three_d"): string | null {
  const status = getDuckDBStatus();
  const entry = status.state === "ready" ? status.extensions[name] : null;
  return entry && entry.state === "failed" ? entry.error : null;
}

function extensionFailure(name: "spatial" | "three_d"): string {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    // Offline, the engine's own message is "fetch failed" or worse — true and
    // useless. The offline sentence is the one the user can act on; the
    // engine's is still RECORDED, as the warning the caller pushes.
    return `The ${name} extension could not be loaded; it needs a network connection.`;
  }
  const reason = extensionReason(name);
  return reason === null
    ? `The ${name} extension could not be loaded.`
    : `The ${name} extension could not be loaded: ${reason}`;
}
```

**[adapted]** — §6.3 specifies the shape of these sentences, not their words. See "Open questions for the human".

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts
npx tsc -b --noEmit
```

Expected: PASS, and no "Cannot redeclare block-scoped variable 'tool'".

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/runQueue.ts tests/unit/features/processing/runQueue.test.ts
git commit -m "feat(processing): a run loads its tool's extension in its own phase"
```

---

### Task 3: The capability chips tell the truth, and offer Retry

**Files:**

- Modify: `src/ui/processing/CatalogueView.tsx:27-37, 85-115`, `src/ui/processing/processing.css` (after `:169`)
- Test: `tests/unit/ui/processing/extensionChip.test.tsx`

**Interfaces:**

- Consumes: `useEligibilityContext` (Task 1 moved it onto the subscription); `ensureExtension` from `src/insights/duckdb.ts`; `toolEligibility`'s existing extension reason (`eligibility.ts:73-81`).
- Produces: nothing for later tasks.

**The Retry link is gated on the EXTENSION's state, not on the row's reason.** In M2 every extension tool is still `implemented: false`, so `toolEligibility` returns "Not available yet" and the download sentence never reaches a row (`eligibility.ts:44` outranks `:73-81`). The chip's tooltip is where the user reads it, and the Retry link must appear beside the row regardless — hence `canRetry = tool.extension !== null && extensionState[tool.extension] === "failed"` rather than a string comparison against the reason.

**The HTML problem, stated once.** `ToolRow` today renders the whole row as one `<button>` (`CatalogueView.tsx:94-113`) with the chip and the reason inside it. A Retry `<button>` cannot be nested in a `<button>`. The row is therefore wrapped in a `<div className="processing-tool-row-wrap">` and the Retry button becomes a SIBLING of the row button, after it. The row button keeps its name, description, chip and reason exactly as they are.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/extensionChip.test.tsx`. The engine is the SAME package-level fake as Task 1's — the real `duckdb.ts`, the real `useDuckDBStatus`, and states reached by really calling `initDuckDB()` and `ensureExtension()`. Simulating the publisher here would pass while the publisher was broken, which is the whole risk this task is about.

```tsx
/**
 * Spec §5: the chip's tooltip says whether the extension is loaded and, if
 * not, what loading costs; a failed extension mutes the chip, disables the
 * tools that need it with the download reason, and offers a Retry link that
 * attempts the load again.
 *
 * The engine underneath is a fake at the `@duckdb/duckdb-wasm` boundary, so
 * every state this file asserts was really published by `duckdb.ts` and
 * delivered by `useDuckDBStatus`. A hand-rolled fake publisher would go on
 * passing if either of them broke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

const refuse = new Set<string>();

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
      const named = /^(?:INSTALL|LOAD)\s+(\w+)/.exec(sql);
      if (named && refuse.has(named[1]!)) {
        throw new Error(`Extension "${named[1]!}" not found\nLINE 1: ${sql}`);
      }
      return { getChild: () => null, numRows: 0 };
    }
  }
  return {
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return new FakeConnection();
      }
    },
    ConsoleLogger: class {},
    LogLevel: { WARNING: 2 },
    getJsDelivrBundles: () => ({}),
    selectBundle: async () => ({
      mainWorker: "https://example.test/duckdb-worker.js",
      mainModule: "https://example.test/duckdb.wasm",
    }),
  };
});

class FakeWorker {
  terminate() {}
}

// `layerTables` is NOT mocked — the catalogue reads its store directly — but
// nothing here builds a table, so its queries never run.
const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const duckdb = await import("../../../../src/insights/duckdb");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function column(name: string): ColumnInfo {
  return { name, type: "VARCHAR", kind: "scalar" };
}

/** A ready city layer, so ONLY the extension can disable a cross-layer row. */
function addCityLayer(): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name: "Delft",
    model,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: "read_cityjson",
          columns: [column("id"), column("feature_id")],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** The chip for one extension. Both chips carry their label as their text. */
const chip = (label: "Spatial" | "3D") => screen.getAllByText(label)[0]!;

beforeEach(async () => {
  refuse.clear();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useLayerTableStore.setState({ tables: {} });
  addCityLayer();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().setActiveLayerId(null);
  vi.unstubAllGlobals();
});

describe("the capability chips (spec §5)", () => {
  it("offers the loading cost while the extension is unloaded", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "Loads the spatial extension on first run (about 24 MB, once per session)",
    );
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loads the three_d extension on first run (about 1 MB, once per session)",
    );
  });

  it("says so once the extension is loaded, and does so on a REAL load", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension is loaded",
    );
    // The other chip is untouched: one extension's state is not the other's.
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loads the three_d extension on first run (about 1 MB, once per session)",
    );
    expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(0);
  });

  it("mutes the chip and offers Retry when the REAL load fails", async () => {
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(chip("Spatial")).toHaveAttribute("data-state", "failed");
    // §5's sentence lives on the CHIP in M2: all three spatial tools are still
    // `implemented: false`, and `eligibility.ts:44` outranks the extension
    // reason, so the row's second line reads "Not available yet". The row-level
    // reason becomes reachable when a spatial tool ships (M13.3).
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension could not be downloaded; check the connection and retry",
    );
    // One per spatial tool: join-by-location, aggregate-per-area,
    // distance-to-nearest (`toolRegistry.ts:62-103`).
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
  });

  it("Retry asks the engine to load the extension again, and the chip follows", async () => {
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);

    // The network comes back, and the user presses Retry. Nothing here fakes a
    // status: the click calls `ensureExtension`, which really loads and really
    // publishes, and the chip re-renders because it is subscribed.
    refuse.clear();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
      // Let the click's un-awaited `ensureExtension` settle.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(0);
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension is loaded",
    );
  });

  it("shows the loading state while a load is in flight", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    let pending!: Promise<boolean>;
    await act(async () => {
      // Started but NOT awaited: `ensureExtension` publishes `loading`
      // synchronously before its first await resolves.
      pending = duckdb.ensureExtension("three_d");
    });
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loading the three_d extension…",
    );
    await act(async () => {
      await pending;
    });
    expect(chip("3D")).toHaveAttribute(
      "title",
      "The three_d extension is loaded",
    );
  });
});
```

If the "loading" assertion proves racy — `loadExtension`'s first `await connection.query(...)` may resolve within the same microtask drain — replace the fake connection's `query` with one that awaits a deferred the test resolves by hand, the same shape `runQueue.test.ts`'s `gate` uses. Do not weaken the assertion to a store read; the point is that the chip re-rendered.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/extensionChip.test.tsx
```

Expected: FAIL — the tooltip is the cost sentence in all states, there is no `data-state`, and no Retry button exists.

- [ ] **Step 3: Teach the chip its states**

In `src/ui/processing/CatalogueView.tsx`, replace `CHIP_TITLE` (`:32-37`) with a function over the state:

```tsx
type ExtensionName = "spatial" | "three_d";

const CHIP_COST: Readonly<Record<ExtensionName, string>> = {
  spatial:
    "Loads the spatial extension on first run (about 24 MB, once per session)",
  three_d:
    "Loads the three_d extension on first run (about 1 MB, once per session)",
};

/**
 * Spec §5: "The chip's tooltip says whether the extension is loaded, and if
 * not, what loading costs." The failed tooltip is the same sentence the
 * disabled rows carry, so the chip and the reason cannot disagree.
 */
function chipTitle(
  name: ExtensionName,
  state: "unloaded" | "loading" | "loaded" | "failed",
): string {
  if (state === "loaded") return `The ${name} extension is loaded`;
  if (state === "loading") return `Loading the ${name} extension…`;
  if (state === "failed") {
    return `The ${name} extension could not be downloaded; check the connection and retry`;
  }
  return CHIP_COST[name];
}
```

**[adapted]** — the loaded and loading sentences. See "Open questions for the human".

- [ ] **Step 4: Restructure the row and add Retry**

Replace `ToolRow` (`CatalogueView.tsx:85-115`) with:

```tsx
function ToolRow({
  tool,
  eligibility,
  extensionState,
}: {
  readonly tool: ToolDefinition;
  readonly eligibility: Eligibility;
  readonly extensionState: Readonly<
    Record<"spatial" | "three_d", "unloaded" | "loading" | "loaded" | "failed">
  >;
}) {
  const reason = eligibility.ok ? null : eligibility.reason;
  const ext = tool.extension;
  // §5's Retry belongs to the one reason it can act on. A row disabled for any
  // other reason — no city layer, a failed table — is not a download away from
  // working, and a Retry there would be a button that does nothing visible.
  const canRetry = ext !== null && extensionState[ext] === "failed";
  return (
    // A wrapper, because the Retry link is a BUTTON and the row is a button:
    // nesting them is invalid HTML and browsers un-nest it unpredictably.
    <div className="processing-tool-row-wrap">
      <button
        type="button"
        className="processing-tool-row"
        aria-disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => openToolView(tool.id)}
      >
        <span className="processing-tool-row__head">
          <span className="processing-tool-row__name">{tool.name}</span>
          {ext !== null && (
            <span
              className="processing-chip"
              data-state={extensionState[ext]}
              title={chipTitle(ext, extensionState[ext])}
            >
              {CHIP_LABEL[ext]}
            </span>
          )}
        </span>
        <span className="processing-tool-row__desc">{tool.description}</span>
        {reason !== null && (
          <span className="processing-tool-row__reason">{reason}</span>
        )}
      </button>
      {canRetry && (
        <button
          type="button"
          className="processing-retry"
          // `ensureExtension`, NOT `retryEngine`: the engine is up, one
          // extension is not. Rebooting DuckDB would rebuild every layer table
          // to fix a download. The result is not awaited — the status publishes
          // `loading` and then `loaded`/`failed`, and the chip follows.
          onClick={() => {
            void ensureExtension(ext);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

In `CatalogueView` itself, pass the state down: `<ToolRow key={tool.id} tool={tool} eligibility={toolEligibility(tool, ctx)} extensionState={ctx.extensionState} />` (`CatalogueView.tsx:70-74`). Add `import { ensureExtension } from "../../insights/duckdb";` at the top.

- [ ] **Step 5: Style the two new pieces**

Append to `src/ui/processing/processing.css` after the `.processing-chip` block (`:162-169`):

```css
/* One row and, when its extension failed, its Retry link beside it (spec §5).
   The wrapper carries the row's bottom margin so the link does not gain one. */
.processing-tool-row-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 4px;
}
.processing-tool-row-wrap .processing-tool-row {
  margin-bottom: 0;
}
/* A muted chip: still readable, visibly not a capability you have. */
.processing-chip[data-state="failed"] {
  background: var(--control-hover);
  color: var(--fg-muted);
}
.processing-chip[data-state="loading"] {
  opacity: 0.6;
}
/* A link, not a control: the row it sits beside is already a 2-line list item,
   and a 38px filled button next to it would read as the row's primary action. */
.processing-retry {
  flex-shrink: 0;
  align-self: center;
  padding: 2px 8px !important;
  min-height: 0 !important;
  background: transparent !important;
  border: none !important;
  color: var(--accent);
  font-size: 12px;
  text-decoration: underline;
}
.processing-retry:hover {
  background: var(--control-hover) !important;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS, including the existing `CatalogueView.test.tsx` (the row button keeps its role, name and reason text).

- [ ] **Step 7: Commit**

```bash
git add src/ui/processing/CatalogueView.tsx src/ui/processing/processing.css \
  tests/unit/ui/processing/extensionChip.test.tsx
git commit -m "feat(processing): the capability chips follow the extension and offer Retry"
```

---

### Task 4: The pure roof roll-up

**Files:**

- Create: `src/domain/roofMetrics/roofRollUp.ts`
- Test: `tests/unit/domain/roofRollUp.test.ts`

**Interfaces:**

- Consumes: nothing (pure; no imports at all).
- Produces:
  - `export interface RoofSurfaceMetric { readonly lod: string | null; readonly areaSqM: number; readonly inclinationDeg: number; readonly azimuthDeg: number }`
  - `export interface RoofRollUp { readonly areaM2: number; readonly flatM2: number; readonly flatShare: number | null; readonly slopeDeg: number | null; readonly azimuthDeg: number | null; readonly surfaces: number }`
  - `export function rollUpRoofSurfaces(surfaces: ReadonlyArray<RoofSurfaceMetric>, flatThresholdDeg: number): RoofRollUp | null`
- Task 6 produces `RoofSurfaceMetric[]`; Task 8 consumes `rollUpRoofSurfaces`.

**Do not touch `src/domain/roofMetrics/aggregate.ts`.** Its `computeAverageAzimuth` is a circular area-weighted mean over a hard-coded 1° threshold (`aggregate.ts:8,12-35`) and `aggregateRoofMetrics` returns `0` for an empty set — neither is §7's rule, and `src/ui/details/subject.ts:228` still depends on the old behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/roofRollUp.test.ts`:

```ts
/**
 * Spec §7's roll-ups, for ONE set of roof surfaces (a contributor set, or one
 * part's own surfaces). Pure, so every rule is asserted here rather than
 * through a run.
 */
import { describe, expect, it } from "vitest";
import {
  rollUpRoofSurfaces,
  type RoofSurfaceMetric,
} from "../../../src/domain/roofMetrics/roofRollUp";

const s = (
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
  lod: string | null = "2.2",
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

describe("rollUpRoofSurfaces", () => {
  it("is null for no surfaces at all — the caller counts that as skipped", () => {
    expect(rollUpRoofSurfaces([], 5)).toBeNull();
  });

  it("sums areas and counts surfaces", () => {
    const out = rollUpRoofSurfaces([s(10, 30, 180), s(6, 0, 0)], 5)!;
    expect(out.areaM2).toBe(16);
    expect(out.surfaces).toBe(2);
  });

  it("counts a surface under the threshold as flat, and one AT it as not", () => {
    const out = rollUpRoofSurfaces([s(10, 4.9, 0), s(6, 5, 90)], 5)!;
    expect(out.flatM2).toBe(10);
    expect(out.flatShare).toBeCloseTo(10 / 16, 10);
  });

  it("weights the mean slope by area, over ALL surfaces", () => {
    // The threshold must not touch this: §7 says "area-weighted over all roof
    // surfaces of the feature".
    const out = rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 5)!;
    expect(out.slopeDeg).toBeCloseTo((30 * 40) / 40, 10);
    expect(
      rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 0)!.slopeDeg,
    ).toBeCloseTo(30, 10);
  });

  it("takes the azimuth of the LARGEST NON-FLAT surface, not a mean", () => {
    const out = rollUpRoofSurfaces(
      [s(5, 35, 10), s(20, 30, 200), s(100, 1, 999)],
      5,
    )!;
    expect(out.azimuthDeg).toBe(200);
  });

  it("breaks an azimuth tie on the first surface in order", () => {
    const out = rollUpRoofSurfaces([s(9, 20, 45), s(9, 20, 315)], 5)!;
    expect(out.azimuthDeg).toBe(45);
  });

  it("has no azimuth when every surface is flat", () => {
    const out = rollUpRoofSurfaces([s(10, 0, 0), s(4, 2, 90)], 5)!;
    expect(out.azimuthDeg).toBeNull();
    expect(out.flatShare).toBe(1);
    expect(out.slopeDeg).toBeCloseTo((10 * 0 + 4 * 2) / 14, 10);
  });

  it("has no share and no slope when the surfaces are all zero-area", () => {
    // `computeRoofMetrics` returns all-zeros for a degenerate ring, so this is
    // real data, not a hypothetical. A 0/0 would be NaN in the column.
    const out = rollUpRoofSurfaces([s(0, 0, 0), s(0, 0, 0)], 5)!;
    expect(out.areaM2).toBe(0);
    expect(out.flatM2).toBe(0);
    expect(out.flatShare).toBeNull();
    expect(out.slopeDeg).toBeNull();
    expect(out.surfaces).toBe(2);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/domain/roofRollUp.test.ts
```

Expected: FAIL — `Failed to resolve import ".../roofRollUp"`.

- [ ] **Step 3: Write it**

Create `src/domain/roofMetrics/roofRollUp.ts`:

```ts
/**
 * Spec §7's roll-ups for one set of roof surfaces.
 *
 * "One set" is deliberately vague about WHOSE: the caller decides whether these
 * are a feature's contributor surfaces or one part's own (spec §8, "a Building
 * shows the aggregated value, a part its own"), and the maths is identical.
 *
 * NOT `src/domain/roofMetrics/aggregate.ts`. That module's azimuth is an
 * area-weighted CIRCULAR MEAN with a hard-coded 1° flat threshold, which is
 * what the Details panel has always shown. §7 asks for something different and
 * simpler — "the azimuth of the largest non-flat roof surface" — at the
 * threshold the user chose. Two answers to one question is the bug here; two
 * functions with different questions is not.
 *
 * Pure: no imports, no engine, no store.
 */

/** One roof surface, already measured, tagged with the LoD it came from. */
export interface RoofSurfaceMetric {
  readonly lod: string | null;
  readonly areaSqM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
}

/** The six measures of spec §7.1, before they are named and filtered. */
export interface RoofRollUp {
  readonly areaM2: number;
  readonly flatM2: number;
  /** `null` when there is no area to take a share OF. */
  readonly flatShare: number | null;
  /** Area-weighted over ALL surfaces; `null` when the total area is 0. */
  readonly slopeDeg: number | null;
  /** Of the largest non-flat surface; `null` when every surface is flat. */
  readonly azimuthDeg: number | null;
  readonly surfaces: number;
}

/**
 * `null` means "nothing to measure" — the caller writes NULL in every column
 * and counts the feature as skipped (§7.1's "no roof surfaces at LoD 1.2").
 *
 * The threshold is STRICT (`inclinationDeg < flatThresholdDeg`), matching
 * §7.1's word "under". A surface at exactly the threshold is therefore NOT
 * flat, and is a candidate for the dominant azimuth. The visible consequence is
 * at the slider's bottom stop: at 0 a perfectly horizontal roof counts as not
 * flat and the flat area is 0, which is what "slope under 0 degrees" means and
 * is why the default is 5. The non-strict reading (`<=`) would make 0 mean
 * "exactly horizontal counts", a different and unasked-for rule.
 */
export function rollUpRoofSurfaces(
  surfaces: ReadonlyArray<RoofSurfaceMetric>,
  flatThresholdDeg: number,
): RoofRollUp | null {
  if (surfaces.length === 0) return null;

  let areaM2 = 0;
  let flatM2 = 0;
  let weightedSlope = 0;
  let dominant: RoofSurfaceMetric | null = null;

  for (const surface of surfaces) {
    areaM2 += surface.areaSqM;
    weightedSlope += surface.inclinationDeg * surface.areaSqM;
    if (surface.inclinationDeg < flatThresholdDeg) {
      flatM2 += surface.areaSqM;
      continue;
    }
    // Strictly greater, so a tie keeps the FIRST surface in source order —
    // the tie rule this spec uses everywhere.
    if (dominant === null || surface.areaSqM > dominant.areaSqM) {
      dominant = surface;
    }
  }

  return {
    areaM2,
    flatM2,
    flatShare: areaM2 > 0 ? flatM2 / areaM2 : null,
    slopeDeg: areaM2 > 0 ? weightedSlope / areaM2 : null,
    azimuthDeg: dominant === null ? null : dominant.azimuthDeg,
    surfaces: surfaces.length,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/unit/domain/roofRollUp.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/roofMetrics/roofRollUp.ts tests/unit/domain/roofRollUp.test.ts
git commit -m "feat(domain): the spec's roof roll-ups as one pure function"
```

---

### Task 5: LoD-tag the resident roof metrics, and expose the resident geometry LoDs (plugin submodule)

**Files:**

- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/workerProtocol.ts:39-51`
- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/objectRecords.ts:22-62`
- Modify (it EXISTS — extend it, do not replace it): `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/objectRecords.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/streamLayer.test.ts:152-165` (its `objectRecord` helper builds a required-field record)
- Then, in the PARENT repo and in the same pointer-bump step: `tests/unit/ui/drawer/layerSummary.test.ts:79-86`, `tests/unit/insights/computeStats.test.ts:147-179` (and any other hand-built `ResidentObjectRecord` literal `tsc` names)

**Interfaces:**

- Produces, from `@cityjson/navara-flatcitybuf`:
  - `export interface ResidentRoofMetrics extends RoofMetrics { readonly lod: string | null }`
  - `ResidentObjectRecord.roofMetrics: ReadonlyArray<ResidentRoofMetrics>`
  - `ResidentObjectRecord.geometryLods: ReadonlyArray<string>` — the distinct non-null `Surface.lod` values over **all** of the object's surfaces, in the order first seen.
- Task 6 consumes both.

**Why two fields and not one.** §7's contributor rule asks "does this object have GEOMETRY at this LoD" — of any semantic type. `roofMetrics` answers only for roofs; a wall-only BuildingPart at LoD 2.2 has no roof metric and would look like an object with nothing there, which is precisely the case finding 1 is about. `surfaceCount` is a total with no LoD breakdown. `geometryLods` is the smallest honest answer: a handful of short strings per record, computed in the same loop that already visits every surface for `attrKeys` (`objectRecords.ts:36-38`).

**This is a breaking change for WRITERS, not readers.** Widening `roofMetrics`'s element type and adding a required field keeps every consumer working (they read `areaSqM`/`inclinationDeg`/`azimuthDeg`, or pass the array where `ReadonlyArray<RoofMetrics>` is wanted). It does NOT keep hand-built record literals compiling, and two test files have them. Those edits belong to this change; a `tsc` error there is expected, not a sign the type was written wrong.

- [ ] **Step 1: EXTEND the existing suite — do not create it**

`packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/objectRecords.test.ts` **already exists** and is the structural pin on this record. Two of its cases reject both additions on purpose and must be UPDATED, not deleted:

- `"carries only the documented ResidentObjectRecord fields — no ring geometry"` asserts `Object.keys(r).sort()` against a `RESIDENT_OBJECT_RECORD_KEYS` constant, and asserts each roof metric's keys are exactly `["areaSqM", "azimuthDeg", "elevationM", "inclinationDeg"]`. Add `"geometryLods"` to the record's key list and `"lod"` to the metric's.
- `"precomputes roof metrics for every RoofSurface, matching computeRoofMetrics"` asserts `r.roofMetrics` **equals** `roofs.map(computeRoofMetrics)`. That equality now fails on the added key; change it to compare against `roofs.map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }))`, which keeps the property the test is for (the values come from `computeRoofMetrics`, in surface order) and adds the tag.

Keep every other case untouched — the footprint, volume, bbox-skip, parents/children and surface-attribute-key cases are unrelated to this change and are the file's real coverage.

Then append the three new cases:

```ts
/** A unit square at height `z`, of `type`, tagged with `lod`. */
function taggedSurface(type: string, lod: string | null, z: number) {
  return {
    type,
    rings: [
      [
        [0, 0, z],
        [1, 0, z],
        [1, 1, z],
        [0, 1, z],
      ],
    ],
    attributes: {},
    lod,
  };
}

function modelWith(surfaces: ReadonlyArray<unknown>): CityModel {
  return {
    sourceEncoding: "flatcitybuf",
    metadata: {},
    bbox: [0, 0, 0, 1, 1, 9],
    vertexCount: 0,
    objects: {
      b1: {
        id: "b1",
        objectType: "Building",
        attributes: {},
        surfaces,
        bbox: [0, 0, 0, 1, 1, 9],
        children: [],
        parents: [],
        lod: "2.2",
      },
    },
  } as unknown as CityModel;
}

describe("toObjectRecords, per-LoD", () => {
  it("tags each roof metric with its OWN surface's LoD", () => {
    // `toObjectRecords` runs on the UNFILTERED cell model (`fcb.worker.ts` —
    // `msg.lod` filters the mesh, not the parse), so one object contributes
    // roof surfaces at every LoD it has, and `record.lod` (the OBJECT's)
    // cannot tell them apart.
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("RoofSurface", "1.2", 3),
        taggedSurface("RoofSurface", "2.2", 9),
      ]),
    );
    expect(records[0]!.roofMetrics.map((m) => m.lod)).toEqual(["1.2", "2.2"]);
    expect(records[0]!.roofMetrics[0]!.areaSqM).toBeCloseTo(1, 6);
  });

  it("reports the LoDs of EVERY surface, not only the roofs", () => {
    // The case §7's contributor rule turns on: geometry at 2.2 that is not a
    // roof still makes this object a contributor at 2.2.
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("WallSurface", "2.2", 9),
        taggedSurface("RoofSurface", "1.2", 3),
      ]),
    );
    expect([...records[0]!.geometryLods].sort()).toEqual(["1.2", "2.2"]);
    expect(records[0]!.roofMetrics.map((m) => m.lod)).toEqual(["1.2"]);
  });

  it("de-duplicates the LoD list and drops untagged surfaces", () => {
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("RoofSurface", "2.2", 9),
        taggedSurface("WallSurface", "2.2", 9),
        taggedSurface("WallSurface", null, 9),
      ]),
    );
    expect(records[0]!.geometryLods).toEqual(["2.2"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/cityjson-navara-plugins
pnpm vitest run packages/navara-flatcitybuf/tests/objectRecords.test.ts
```

Expected: FAIL — `Property 'lod' does not exist on type 'RoofMetrics'`, `geometryLods` is `undefined`, and the two updated key assertions fail on the missing keys.

- [ ] **Step 3: Widen the record type**

In `packages/navara-flatcitybuf/src/workerProtocol.ts`, above `ResidentObjectRecord` (`:39`):

```ts
/**
 * A resident roof surface's metrics plus the LoD of the surface itself.
 *
 * `toObjectRecords` runs on the whole cell model, so an object with geometry at
 * several LoDs contributes roof surfaces at all of them;
 * `ResidentObjectRecord.lod` is the OBJECT's LoD and cannot tell them apart. A
 * widening of `RoofMetrics`, so every existing reader keeps working untouched.
 */
export interface ResidentRoofMetrics extends RoofMetrics {
  readonly lod: string | null;
}
```

and inside `ResidentObjectRecord`, change `:46` and add a field beside it:

```ts
  readonly roofMetrics: ReadonlyArray<ResidentRoofMetrics>;
  /**
   * Distinct non-null `Surface.lod` values over ALL of this object's surfaces,
   * whatever their semantic type, in the order first seen.
   *
   * The main thread's spec §7 contributor rule asks "does this feature's part
   * have GEOMETRY at the chosen LoD" — a wall-only part counts. `roofMetrics`
   * cannot answer that and `surfaceCount` has no LoD breakdown, so the answer
   * is carried explicitly. Short: a handful of labels per record.
   */
  readonly geometryLods: ReadonlyArray<string>;
```

- [ ] **Step 4: Fill both fields in the one loop that already visits the surfaces**

In `packages/navara-flatcitybuf/src/objectRecords.ts`, replace `:33-38`:

```ts
const roofMetrics = obj.surfaces
  .filter((s) => s.type === "RoofSurface")
  .map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }));

// ONE pass over the surfaces for both the attribute keys the cell reports
// and the LoD labels the contributor rule needs.
const lods = new Set<string>();
for (const surface of obj.surfaces) {
  for (const key of Object.keys(surface.attributes)) attrKeys.add(key);
  if (surface.lod) lods.add(surface.lod);
}
```

and add `geometryLods: [...lods],` to the `records.push({ … })` literal (`:47-59`), beside `roofMetrics`. The replacement absorbs the old standalone attribute-key loop; delete that.

- [ ] **Step 5: Run the plugin's checks and commit the submodule**

`geometryLods` is REQUIRED, so every hand-built `ResidentObjectRecord` in the submodule breaks too. The one the reviewer found is `packages/navara-flatcitybuf/tests/streamLayer.test.ts:152-165`'s `objectRecord(id, objectType)` helper — add `geometryLods: []` to its literal. Sweep for others before the gate:

```bash
cd packages/cityjson-navara-plugins
grep -rn "roofMetrics:" packages/navara-flatcitybuf --include=*.ts | grep -v "src/objectRecords.ts"
pnpm typecheck          # the authoritative list; fix every site it names
pnpm vitest run packages/navara-flatcitybuf
git add packages/navara-flatcitybuf/src/workerProtocol.ts \
  packages/navara-flatcitybuf/src/objectRecords.ts \
  packages/navara-flatcitybuf/tests/objectRecords.test.ts \
  packages/navara-flatcitybuf/tests/streamLayer.test.ts
git commit -m "feat(flatcitybuf): tag resident roof metrics by LoD and report every surface's LoD"
git push origin main
```

- [ ] **Step 6: Bump the pointer AND fix the parent's record literals**

The parent's `tsc` will now reject every hand-built `ResidentObjectRecord`. Two files have them:

- `tests/unit/ui/drawer/layerSummary.test.ts:79-86` — the `P1`/`P2` records' `roofMetrics` entries need `lod` (use `"2.2"`, the object lod the `record(...)` helper already sets), and the helper needs a `geometryLods` default. Fix the `record(...)` helper once rather than every literal.
- `tests/unit/insights/computeStats.test.ts:147-179` — two inline records: add `geometryLods: ["2.2"]` / `geometryLods: []` and a `lod` on each `roofMetrics` entry. The assertions (`roofSurfaceCount`, `totalRoofArea`, `avgRoofSlope`, `avgRoofAzimuth`) are unaffected: the new field is additive.

```bash
cd /data2/hideba/multiroof-viewer
npx tsc -b --noEmit     # lists every literal that still needs the two fields
npx vitest run tests/unit/ui/viewport tests/unit/ui/details tests/unit/ui/drawer \
  tests/unit/insights tests/unit/features/streaming
git add packages/cityjson-navara-plugins tests/unit/ui/drawer/layerSummary.test.ts \
  tests/unit/insights/computeStats.test.ts
git commit -m "chore(deps): bump the plugin pin for LoD-tagged resident roof metrics"
```

A `tsc` error at one of the five READER sites (`legendCounts.ts:94-103`, `useResolvedSubject.ts:125`, `DetailsPanel.tsx:263-268`, `computeStats.ts:142,231`, `derivedBuildingColumns.ts:19-20`) would mean the type was written as a REPLACEMENT rather than an extension — re-check Step 3. An error at a test LITERAL is expected and is this step's work.

---

### Task 6: One geometry source for both layer kinds, and LoD counts that measure nothing

**Files:**

- Create: `src/features/processing/roofGeometrySource.ts`
- Test: `tests/unit/features/processing/roofGeometrySource.test.ts`

**Interfaces:**

- Consumes: `RoofSurfaceMetric` (Task 4); `ResidentObjectRecord`/`ResidentRoofMetrics` (Task 5); `computeRoofMetrics` from `@cityjson/navara-core`; `getResidentModel` (`residentModel.ts:46`); `parentsIndexOf`/`rootFeatureId` (`featureId.ts:19,46`).
- Produces:
  - `export interface RoofGeometrySource { has(objectId: string): boolean; hasGeometryAt(objectId: string, lod: string): boolean; roofSurfacesAt(objectId: string, lod: string): ReadonlyArray<RoofSurfaceMetric> }`
  - `export function roofGeometrySource(layer: Layer): RoofGeometrySource`
  - `export function featureIdsByObject(layer: Layer): ReadonlyMap<string, string>`
  - `export interface LodOption { readonly lod: string; readonly features: number }`
  - `export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption>`
- Task 8 consumes the source; Task 10 consumes `roofLodOptions`.

**The CPU contract, which is the reason this module has the shape it has.**

- `roofLodOptions` reads **tags only** — `Surface.type` and `Surface.lod` for a static layer, the already-computed `ResidentRoofMetrics.lod` plus `geometryLods` for a streaming one. It calls `computeRoofMetrics` **never**. Opening the LoD select must not measure a roof.
- `roofLodOptions` applies the **same contributor rule as execution** (§7, geometry-keyed): at each LoD, a feature whose PART has geometry there is counted from its parts only, so a root roof displaced by a wall-only part does NOT make the feature count. A select that promised "2 buildings with roof surfaces" and a run that then measured one would be the same bug twice, in the two places a user compares.
- `roofSurfacesAt(id, lod)` measures on demand and memoises per `(id, lod)`, so a run touches only the features in its scope, at the one LoD it was given, once each.
- `hasGeometryAt(id, lod)` is §7's contributor question, about surfaces of every semantic type, and is also tags only.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/roofGeometrySource.test.ts`:

```ts
/**
 * The one place that knows where a layer's geometry lives — the parsed model
 * for a static layer, the resident set for a streaming one — and the one place
 * that decides how much of it is measured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";

const residents: {
  objects: Record<string, unknown>;
  cellCount: number;
  featureCount: number;
  surfaceAttrKeys: string[];
} = { objects: {}, cellCount: 0, featureCount: 0, surfaceAttrKeys: [] };

vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => residents),
}));

/** Counts the calls the CPU contract is about. */
const measured: string[] = [];
vi.mock("@cityjson/navara-core", async () => {
  const actual = await vi.importActual<typeof import("@cityjson/navara-core")>(
    "@cityjson/navara-core",
  );
  return {
    ...actual,
    computeRoofMetrics: vi.fn((surface: { lod: string | null }) => {
      measured.push(String(surface.lod));
      return actual.computeRoofMetrics(
        surface as Parameters<typeof actual.computeRoofMetrics>[0],
      );
    }),
  };
});

const { featureIdsByObject, roofGeometrySource, roofLodOptions } =
  await import("../../../../src/features/processing/roofGeometrySource");

/** A unit square of `type` at `lod`; area 1, inclination 0. */
const surface = (type: string, lod: string) => ({
  type,
  rings: [
    [
      [0, 0, 3],
      [1, 0, 3],
      [1, 1, 3],
      [0, 1, 3],
    ],
  ],
  attributes: {},
  lod,
});

/**
 * TWO roof-bearing features, not one:
 *  - B1 (Building) roof at 2.2, with part B1P (roof + wall at 2.2)
 *  - B4 (Building) roof at 2.2, no parts
 *  - B2 (Building) roof at 1.2, no parts
 *  - B3 (Building) WALL only at 2.2 — geometry, but no roof
 */
function staticLayer(): Layer {
  const object = (
    id: string,
    objectType: string,
    surfaces: unknown[],
    parents: string[] = [],
    children: string[] = [],
  ) => ({
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  });
  return {
    id: "L1",
    name: "roofs",
    isStreaming: false,
    selectedLod: "2.2",
    availableLods: ["2.2", "1.2"],
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        B1: object(
          "B1",
          "Building",
          [surface("RoofSurface", "2.2")],
          [],
          ["B1P"],
        ),
        B1P: object(
          "B1P",
          "BuildingPart",
          [surface("RoofSurface", "2.2"), surface("WallSurface", "2.2")],
          ["B1"],
        ),
        B4: object("B4", "Building", [surface("RoofSurface", "2.2")]),
        B2: object("B2", "Building", [surface("RoofSurface", "1.2")]),
        B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
      },
    },
  } as unknown as Layer;
}

afterEach(() => {
  residents.objects = {};
  measured.length = 0;
});

describe("roofLodOptions", () => {
  it("counts FEATURES per LoD, parts folded into their building", () => {
    // 2.2: B1 (through its part, which has a roof there) and B4 — TWO
    // features. 1.2: B2.
    expect(roofLodOptions(staticLayer())).toEqual([
      { lod: "2.2", features: 2 },
      { lod: "1.2", features: 1 },
    ]);
  });

  it("applies the CONTRIBUTOR rule, so a displaced root roof does not count", () => {
    // B1's part keeps its wall at 2.2 but loses its roof. §7 still makes the
    // PART the contributor (it has geometry there), so B1 has no roof at 2.2
    // and must not appear in the count — the same answer the run will give.
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("WallSurface", "2.2")];
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 1 }, // B4 only
      { lod: "1.2", features: 1 },
    ]);
    expect(measured).toEqual([]);
  });

  it("counts the ROOT when no part has geometry at that LoD", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("RoofSurface", "1.2")];
    // At 2.2 the part contributes nothing, so B1 falls back to its own roof.
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 2 }, // B1 (root) and B4
      { lod: "1.2", features: 2 }, // B1 (through its part) and B2
    ]);
  });

  it("measures NOTHING — it reads the surfaces' tags only", () => {
    roofLodOptions(staticLayer());
    expect(measured).toEqual([]);
  });

  it("offers no LoD for a layer whose only geometry is walls", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as { objects: Record<string, unknown> }
    ).objects;
    for (const id of ["B1", "B1P", "B4", "B2"]) delete objects[id];
    expect(roofLodOptions(layer)).toEqual([]);
  });

  it("reads a streaming layer's RESIDENT records, which are pre-measured", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
        ],
      },
      r2: {
        id: "r2",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    expect(roofLodOptions(layer)).toEqual([{ lod: "2", features: 1 }]);
    expect(measured).toEqual([]);
  });
});

describe("roofGeometrySource", () => {
  it("answers hasGeometryAt from TAGS, for surfaces of every type", () => {
    const source = roofGeometrySource(staticLayer());
    // The case §7's contributor rule turns on.
    expect(source.hasGeometryAt("B3", "2.2")).toBe(true);
    expect(source.roofSurfacesAt("B3", "2.2")).toEqual([]);
    expect(source.hasGeometryAt("B2", "2.2")).toBe(false);
    expect(source.hasGeometryAt("B2", "1.2")).toBe(true);
  });

  it("distinguishes an object it has never heard of from one with nothing", () => {
    const source = roofGeometrySource(staticLayer());
    expect(source.has("B3")).toBe(true);
    expect(source.has("gone")).toBe(false);
    expect(source.hasGeometryAt("gone", "2.2")).toBe(false);
    expect(source.roofSurfacesAt("gone", "2.2")).toEqual([]);
  });

  it("measures only the object and LoD it is asked for, once", () => {
    const source = roofGeometrySource(staticLayer());
    const first = source.roofSurfacesAt("B1P", "2.2");
    expect(first).toHaveLength(1);
    expect(first[0]!.areaSqM).toBeCloseTo(1, 6);
    expect(measured).toEqual(["2.2"]);
    source.roofSurfacesAt("B1P", "2.2");
    source.roofSurfacesAt("B1P", "2.2");
    expect(measured).toEqual(["2.2"]); // memoised
    source.roofSurfacesAt("B1P", "1.2");
    expect(measured).toEqual(["2.2"]); // nothing of B1P's is tagged 1.2
  });

  it("filters a streaming record's pre-measured metrics by LoD", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["1.2", "2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
          {
            lod: "1.2",
            areaSqM: 3,
            inclinationDeg: 0,
            azimuthDeg: 0,
            elevationM: 1,
          },
        ],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    const source = roofGeometrySource(layer);
    expect(source.roofSurfacesAt("r1", "2")).toEqual([
      { lod: "2", areaSqM: 12, inclinationDeg: 30, azimuthDeg: 180 },
    ]);
    expect(source.hasGeometryAt("r1", "1.2")).toBe(true);
    expect(measured).toEqual([]);
  });
});

describe("featureIdsByObject", () => {
  it("resolves a part to its building and a root to itself", () => {
    const features = featureIdsByObject(staticLayer());
    expect(features.get("B1")).toBe("B1");
    expect(features.get("B1P")).toBe("B1");
    expect(features.get("B4")).toBe("B4");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/features/processing/roofGeometrySource.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write it**

Create `src/features/processing/roofGeometrySource.ts`:

```ts
/**
 * Where a layer's geometry is, for BOTH kinds of city layer — and how much of
 * it any one question is allowed to touch.
 *
 * A static layer's geometry is parsed into `layer.model.objects[id].surfaces`,
 * each surface carrying its semantic type and the LoD it came from. A STREAMING
 * layer's `model` is a stub with no objects (`openStreamingLayer.ts`); its
 * geometry is the resident set, whose records carry roof metrics the worker
 * already computed (LoD-tagged) plus `geometryLods`, the LoDs of ALL their
 * surfaces.
 *
 * THE CPU CONTRACT, and the reason the halves are separate functions:
 *
 *  - `roofLodOptions` fills a dropdown. It reads TAGS ONLY and never calls
 *    `computeRoofMetrics`. Opening a select must not triangulate a city.
 *  - `RoofGeometrySource.roofSurfacesAt` measures, on demand, memoised per
 *    (object, LoD) — so a run touches only its scoped features' contributors at
 *    the one LoD it was given, once each.
 *  - `RoofGeometrySource.hasGeometryAt` is §7's contributor question, about
 *    surfaces of EVERY semantic type, and is also tags only.
 */
import { computeRoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../domain/citymodel/types";
import type { RoofSurfaceMetric } from "../../domain/roofMetrics/roofRollUp";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../domain/citymodel/featureId";
import { getResidentModel } from "../streaming/residentModel";
import type { Layer } from "../layers/layerStore";

/** Whatever the layer's objects are, reduced to what the feature index needs. */
interface ObjectLike {
  readonly parents?: ReadonlyArray<string>;
}

/**
 * The resident objects, or the model's.
 *
 * The `0` is not a version we are pinning: `getResidentModel`'s second
 * parameter is a SUBSCRIPTION MARKER for React callers and the function itself
 * ignores it (`residentModel.ts`). This reads whatever is resident when it is
 * called, which is what every caller here wants.
 */
function objectsOf(layer: Layer): Readonly<Record<string, ObjectLike>> {
  return layer.isStreaming
    ? (getResidentModel(layer.id, 0).objects as Readonly<
        Record<string, ObjectLike>
      >)
    : (layer.model.objects as Readonly<Record<string, ObjectLike>>);
}

export interface RoofGeometrySource {
  /** Is this object in the layer at all? (Distinct from "has nothing here".) */
  has(objectId: string): boolean;
  /** Spec §7's contributor question: ANY surface, of any type, tagged `lod`. */
  hasGeometryAt(objectId: string, lod: string): boolean;
  /** This object's ROOF surfaces at `lod`, measured on first ask. */
  roofSurfacesAt(
    objectId: string,
    lod: string,
  ): ReadonlyArray<RoofSurfaceMetric>;
}

export function roofGeometrySource(layer: Layer): RoofGeometrySource {
  const cache = new Map<string, ReadonlyArray<RoofSurfaceMetric>>();

  if (layer.isStreaming) {
    const objects = getResidentModel(layer.id, 0).objects as Readonly<
      Record<string, ResidentObjectRecord>
    >;
    return {
      has: (id) => objects[id] !== undefined,
      hasGeometryAt: (id, lod) =>
        objects[id]?.geometryLods.includes(lod) ?? false,
      roofSurfacesAt: (id, lod) => {
        const key = `${id} ${lod}`;
        const hit = cache.get(key);
        if (hit) return hit;
        // Nothing is MEASURED here: the worker computed these when the cell
        // landed. This is a filter, and the memo only saves the allocation.
        const out = (objects[id]?.roofMetrics ?? [])
          .filter((m) => m.lod === lod)
          .map((m) => ({
            lod: m.lod,
            areaSqM: m.areaSqM,
            inclinationDeg: m.inclinationDeg,
            azimuthDeg: m.azimuthDeg,
          }));
        cache.set(key, out);
        return out;
      },
    };
  }

  const objects = layer.model.objects;
  const surfacesOf = (id: string): ReadonlyArray<Surface> =>
    objects[id]?.surfaces ?? [];
  return {
    has: (id) => objects[id] !== undefined,
    hasGeometryAt: (id, lod) => surfacesOf(id).some((s) => s.lod === lod),
    roofSurfacesAt: (id, lod) => {
      const key = `${id} ${lod}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const out = surfacesOf(id)
        .filter((s) => s.type === "RoofSurface" && s.lod === lod)
        .map((s) => {
          const metrics = computeRoofMetrics(s);
          return {
            lod: s.lod,
            areaSqM: metrics.areaSqM,
            inclinationDeg: metrics.inclinationDeg,
            azimuthDeg: metrics.azimuthDeg,
          };
        });
      cache.set(key, out);
      return out;
    },
  };
}

/** Every object of the layer to the id of the FEATURE it belongs to. */
export function featureIdsByObject(layer: Layer): ReadonlyMap<string, string> {
  const objects = objectsOf(layer);
  const parents = parentsIndexOf(objects);
  const out = new Map<string, string>();
  for (const id of Object.keys(objects))
    out.set(id, rootFeatureId(id, parents));
  return out;
}

/** One row of the LoD select (spec §6). */
export interface LodOption {
  readonly lod: string;
  /** FEATURES with at least one ROOF surface at this LoD, parts folded in. */
  readonly features: number;
}

/** Per object: the LoDs it has ANY geometry at, and the LoDs it has a ROOF at. */
interface LodTags {
  readonly geometry: ReadonlySet<string>;
  readonly roof: ReadonlySet<string>;
}

/** TAGS ONLY: `Surface.type`/`Surface.lod`, or the record's two LoD lists. */
function lodTagsByObject(layer: Layer): ReadonlyMap<string, LodTags> {
  const out = new Map<string, LodTags>();
  if (layer.isStreaming) {
    const objects = getResidentModel(layer.id, 0).objects as Readonly<
      Record<string, ResidentObjectRecord>
    >;
    for (const [id, record] of Object.entries(objects)) {
      const roof = new Set<string>();
      for (const metric of record.roofMetrics) {
        if (metric.lod !== null) roof.add(metric.lod);
      }
      out.set(id, { geometry: new Set(record.geometryLods), roof });
    }
    return out;
  }
  for (const [id, object] of Object.entries(layer.model.objects)) {
    if (!object) continue;
    const geometry = new Set<string>();
    const roof = new Set<string>();
    for (const s of object.surfaces) {
      if (s.lod === null) continue;
      geometry.add(s.lod);
      if (s.type === "RoofSurface") roof.add(s.lod);
    }
    out.set(id, { geometry, roof });
  }
  return out;
}

/**
 * Spec §6: "a select of the LoDs at which the target has geometry of the kind
 * the tool needs, each with the count of FEATURES that have it, parts folded
 * into their building".
 *
 * TAGS ONLY. A static layer's answer is `surface.type` and `surface.lod`; a
 * streaming layer's is `geometryLods` plus the LoD already on each pre-computed
 * roof metric. No geometry is measured, because this fills a dropdown.
 *
 * THE SAME CONTRIBUTOR RULE AS THE RUN (§7). At each LoD, a feature whose PART
 * has geometry there is answered from its parts alone — a root roof displaced
 * by a wall-only part does not make the feature count, exactly as it will not
 * make it measurable. A select that promised "2 buildings with roof surfaces"
 * over a run that then measured one would be the same bug printed twice, in the
 * two places the user compares.
 *
 * Sorted highest detail first, matching `computeAvailableLods` and the
 * streaming ladder so no two LoD lists in the app read in opposite directions.
 * A surface with a null LoD contributes to no option: there is no rung to
 * offer the user for it.
 */
export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  const tags = lodTagsByObject(layer);
  const featureOf = featureIdsByObject(layer);

  // Every rung anyone mentions, and the members of every feature.
  const rungs = new Set<string>();
  const members = new Map<string, string[]>();
  for (const [id, tag] of tags) {
    for (const lod of tag.geometry) rungs.add(lod);
    const feature = featureOf.get(id) ?? id;
    const list = members.get(feature);
    if (list) list.push(id);
    else members.set(feature, [id]);
  }

  const options: LodOption[] = [];
  for (const lod of rungs) {
    let count = 0;
    for (const [featureId, ids] of members) {
      const parts = ids.filter((id) => id !== featureId);
      const partContributors = parts.filter((id) =>
        tags.get(id)?.geometry.has(lod),
      );
      const contributors =
        partContributors.length > 0
          ? partContributors
          : ids.filter(
              (id) => id === featureId && tags.get(id)?.geometry.has(lod),
            );
      if (contributors.some((id) => tags.get(id)?.roof.has(lod))) count += 1;
    }
    if (count > 0) options.push({ lod, features: count });
  }

  return options.sort(
    (a, b) => Number.parseFloat(b.lod) - Number.parseFloat(a.lod),
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/unit/features/processing/roofGeometrySource.test.ts
npx tsc -b --noEmit
```

Expected: PASS (12 tests), with `measured` empty in every LoD-options assertion.

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/roofGeometrySource.ts \
  tests/unit/features/processing/roofGeometrySource.test.ts
git commit -m "feat(processing): one geometry source for static and streaming roof metrics"
```

---

### Task 7: The roof parameters, and the registry entry that promises their columns

**Files:**

- Create: `src/features/processing/roofMetricsParams.ts`
- Modify: `src/features/processing/types.ts:18-49`, `src/features/processing/toolRegistry.ts:5-18` (and one line on each of the other six entries)
- Test: `tests/unit/features/processing/roofMetricsParams.test.ts`, and an addition to `tests/unit/features/processing/eligibility.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `roofMetricsParams.ts`: `export type RoofMeasure = "area" | "flatArea" | "flatShare" | "slope" | "azimuth" | "surfaces"`; `export interface RoofMeasureSpec { readonly key: RoofMeasure; readonly label: string; readonly hint: string | null; readonly suffix: string }`; `export const ROOF_MEASURES: ReadonlyArray<RoofMeasureSpec>`; `export interface RoofMetricsParams { readonly measures: ReadonlyArray<RoofMeasure>; readonly flatThresholdDeg: number }`; `export const DEFAULT_ROOF_PARAMS: RoofMetricsParams`; `export const FLAT_THRESHOLD_MIN = 0`; `export const FLAT_THRESHOLD_MAX = 15`; `export function roofParams(raw: Readonly<Record<string, unknown>>): RoofMetricsParams`; `export function roofColumnNames(prefix: string, params: RoofMetricsParams): string[]`.
  - `types.ts`: `ToolDefinition.needsLod: boolean` (required, on all seven entries); `ToolDefinition.validateParams?`; `ToolDefinition.normaliseParams?`.
- Tasks 8, 10, 11 and 12 all consume these.

**`implemented` stays `false` here.** The registry entry gains its columns and its validation, but the tool is NOT switched on until its executor (Task 8), its LoD select (Task 10) and its parameters (Task 11) exist — Task 12 is the single step that flips it and proves the form works. Enabling it earlier would put a runnable Run button in front of a form with no parameters and no LoD.

**The default is all six measures ON.** The spec does not say, and the mockup has no Roof metrics form state (`design/processing-toolbox-wireframe.html` shows only the catalogue row). Three reasons for ON: §7.1 calls the tool one that "materialises the roof metrics the app already computes", and a half-materialised default contradicts that; §7.1's own Style-by-result rule is "`roof_area_m2 >` median", which only holds if area is written by default; and Measure solids' mockup ticks its four primary measures and leaves only its two _elevation_ extras off — roof metrics has no such secondary tier. Confirmed by the reviewer; recorded in "Open questions for the human".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/roofMetricsParams.test.ts`:

```ts
/**
 * ONE answer to "which columns will this run write, and in what order".
 * The registry promises them before any run exists, the form prints them, and
 * the executor writes them; three literal lists is how a form comes to promise
 * a name a run never writes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOF_PARAMS,
  ROOF_MEASURES,
  roofColumnNames,
  roofParams,
} from "../../../../src/features/processing/roofMetricsParams";

describe("roofParams", () => {
  it("reads an EMPTY draft as every measure at the default threshold", () => {
    // `useToolForm` mints a fresh draft with `params: {}`, and the form's
    // column list is printed from it before the user touches anything.
    expect(roofParams({})).toEqual(DEFAULT_ROOF_PARAMS);
    expect(DEFAULT_ROOF_PARAMS.measures).toHaveLength(6);
    expect(DEFAULT_ROOF_PARAMS.flatThresholdDeg).toBe(5);
  });

  it("keeps the user's ticks, in the spec's order rather than click order", () => {
    expect(roofParams({ measures: ["slope", "area"] }).measures).toEqual([
      "area",
      "slope",
    ]);
  });

  it("keeps an EMPTY tick list empty — that is the state Run refuses", () => {
    expect(roofParams({ measures: [] }).measures).toEqual([]);
  });

  it("drops a measure key it does not know", () => {
    expect(roofParams({ measures: ["area", "volume"] }).measures).toEqual([
      "area",
    ]);
  });

  it("clamps the threshold into 0-15 and falls back for a non-number", () => {
    expect(roofParams({ flatThresholdDeg: 12 }).flatThresholdDeg).toBe(12);
    expect(roofParams({ flatThresholdDeg: -3 }).flatThresholdDeg).toBe(0);
    expect(roofParams({ flatThresholdDeg: 99 }).flatThresholdDeg).toBe(15);
    expect(roofParams({ flatThresholdDeg: "5" }).flatThresholdDeg).toBe(5);
    expect(roofParams({ flatThresholdDeg: Number.NaN }).flatThresholdDeg).toBe(
      5,
    );
  });

  it("is idempotent, so freezing a normalised bag changes nothing", () => {
    const once = roofParams({ measures: ["azimuth"], flatThresholdDeg: 9 });
    expect(roofParams({ ...once })).toEqual(once);
  });
});

describe("roofColumnNames", () => {
  it("is spec §7.1's list, in spec §7.1's order", () => {
    expect(roofColumnNames("roof_", DEFAULT_ROOF_PARAMS)).toEqual([
      "roof_area_m2",
      "roof_flat_m2",
      "roof_flat_share",
      "roof_slope_deg",
      "roof_azimuth_deg",
      "roof_surfaces_n",
    ]);
  });

  it("prints only the ticked measures, still in the spec's order", () => {
    expect(
      roofColumnNames("roof_", {
        measures: ["surfaces", "area"],
        flatThresholdDeg: 5,
      }),
    ).toEqual(["roof_area_m2", "roof_surfaces_n"]);
  });

  it("honours a different prefix", () => {
    expect(
      roofColumnNames("dak_", { measures: ["area"], flatThresholdDeg: 5 }),
    ).toEqual(["dak_area_m2"]);
  });

  it("has one spec entry per measure, and no duplicate suffix or label", () => {
    expect(new Set(ROOF_MEASURES.map((m) => m.suffix)).size).toBe(
      ROOF_MEASURES.length,
    );
    expect(new Set(ROOF_MEASURES.map((m) => m.label)).size).toBe(
      ROOF_MEASURES.length,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/features/processing/roofMetricsParams.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the params module**

Create `src/features/processing/roofMetricsParams.ts`:

```ts
/**
 * Roof metrics' parameters, and the column names they resolve to (spec §7.1).
 *
 * It is a module of its OWN, outside `tools/`, because four places need the
 * same answer at four different times and none of them may pull in a tool
 * module's `registerExecutor` side effect: the registry (`outputColumns` and
 * `normaliseParams`, pure data), the form (which prints the names before any
 * run exists), `submitRun` (which FREEZES the normalised bag) and the executor
 * (which writes the columns).
 *
 * Everything here is pure.
 */

export type RoofMeasure =
  | "area"
  | "flatArea"
  | "flatShare"
  | "slope"
  | "azimuth"
  | "surfaces";

export interface RoofMeasureSpec {
  readonly key: RoofMeasure;
  /** The checkbox's label. */
  readonly label: string;
  /**
   * The explanation §7.1 carries that the label trims, as the label's
   * `title`. Null where the label already says everything.
   */
  readonly hint: string | null;
  /** Appended to the prefix: `roof_` + `area_m2`. */
  readonly suffix: string;
}

/**
 * Spec §7.1's measures, in spec §7.1's order — which is also the order of
 * `roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg,
 * roof_azimuth_deg, roof_surfaces_n` and therefore the order §6.2's Style by
 * result walks to find "the first column the run actually wrote".
 */
export const ROOF_MEASURES: ReadonlyArray<RoofMeasureSpec> = [
  {
    key: "area",
    label: "Total roof area (m²)",
    hint: null,
    suffix: "area_m2",
  },
  {
    key: "flatArea",
    label: "Flat roof area (m²)",
    hint: "Surfaces with a slope under the flat threshold",
    suffix: "flat_m2",
  },
  {
    key: "flatShare",
    label: "Flat share",
    hint: "0-1: the flat area over the total roof area",
    suffix: "flat_share",
  },
  {
    key: "slope",
    label: "Mean slope (deg)",
    hint: "Area-weighted over every roof surface",
    suffix: "slope_deg",
  },
  {
    key: "azimuth",
    label: "Dominant azimuth (deg)",
    hint: "Of the largest non-flat surface",
    suffix: "azimuth_deg",
  },
  {
    key: "surfaces",
    label: "Roof surface count",
    hint: null,
    suffix: "surfaces_n",
  },
];

export interface RoofMetricsParams {
  readonly measures: ReadonlyArray<RoofMeasure>;
  /** Spec §7.1: "flat threshold slider 0-15 deg, default 5". */
  readonly flatThresholdDeg: number;
}

export const FLAT_THRESHOLD_MIN = 0;
export const FLAT_THRESHOLD_MAX = 15;
const FLAT_THRESHOLD_DEFAULT = 5;

/**
 * All six ticked. The spec does not state a default; the tool's own job —
 * "materialises the roof metrics the app already computes" — plus §7.1's own
 * Style-by-result rule (`roof_area_m2 >` median, which needs area written)
 * make every measure the honest default.
 */
export const DEFAULT_ROOF_PARAMS: RoofMetricsParams = {
  measures: ROOF_MEASURES.map((m) => m.key),
  flatThresholdDeg: FLAT_THRESHOLD_DEFAULT,
};

/**
 * A draft's untyped `params` bag as this tool's parameters.
 *
 * A draft starts as `{}` (`useToolForm`), so "absent" has to mean "the
 * defaults" or the form would open promising no columns. An EMPTY array is NOT
 * absent: it is the state the user reaches by unticking everything, and
 * `validateParams` refuses Run for it rather than silently writing all six.
 *
 * Idempotent, because `submitRun` freezes the NORMALISED bag (so the run log
 * shows the measures and threshold that were actually used, not an empty
 * object) and the form then re-normalises what it stored.
 */
export function roofParams(
  raw: Readonly<Record<string, unknown>>,
): RoofMetricsParams {
  const known = new Set<string>(ROOF_MEASURES.map((m) => m.key));
  const picked = raw["measures"];
  const measures = Array.isArray(picked)
    ? // Re-ordered into the spec's order, not the user's click order: the
      // column order and Style by result's first column both depend on it.
      ROOF_MEASURES.map((m) => m.key).filter(
        (key) => picked.some((p) => p === key) && known.has(key),
      )
    : DEFAULT_ROOF_PARAMS.measures;

  // `Number(undefined)` is NaN, so an absent threshold falls to the default
  // through the same branch as a junk one.
  const rawThreshold = Number(raw["flatThresholdDeg"]);
  const flatThresholdDeg = Number.isFinite(rawThreshold)
    ? Math.min(FLAT_THRESHOLD_MAX, Math.max(FLAT_THRESHOLD_MIN, rawThreshold))
    : FLAT_THRESHOLD_DEFAULT;

  return { measures, flatThresholdDeg };
}

/** The columns this run will write, prefix applied, in the spec's order. */
export function roofColumnNames(
  prefix: string,
  params: RoofMetricsParams,
): string[] {
  const ticked = new Set(params.measures);
  return ROOF_MEASURES.filter((m) => ticked.has(m.key)).map(
    (m) => `${prefix}${m.suffix}`,
  );
}
```

- [ ] **Step 4: Widen `ToolDefinition`**

In `src/features/processing/types.ts`, inside `ToolDefinition` (after `needsVectorSource` at `:33`):

```ts
  /**
   * Does the form offer a LoD select (spec §6)?
   *
   * True for the tools that read GEOMETRY at one level of detail. False for
   * Height from extent (the bbox is unioned across every LoD in the file) and
   * for the cross-layer tools, whose building geometry is a PROXY radio rather
   * than a LoD. An UNIMPLEMENTED tool never renders the control whatever this
   * says — it has no source of truthful counts (see `useLodOptions`).
   */
  readonly needsLod: boolean;
```

and after `outputColumns` (`:46`):

```ts
  /**
   * Spec §6: "Validation is inline and blocks Run". The message, or null when
   * the parameters are runnable. Absent for a tool with no parameters.
   */
  readonly validateParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => string | null;

  /**
   * The draft's parameter bag with every default filled in, for FREEZING.
   *
   * Spec §6.1 freezes "everything the run needs", and §6.4 makes the log "the
   * reproducible record of the run: a planner can read it back and rerun by
   * hand". A draft the user never touched is `{}`, so without this the log
   * would print "Parameters: —" for a run that used six measures and a 5°
   * threshold. Absent for a tool with no parameters.
   */
  readonly normaliseParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
```

- [ ] **Step 5: Fill in the registry**

In `src/features/processing/toolRegistry.ts`, add `needsLod` to every entry: `true` for `roof-metrics`, `measure-solids` and `validate-solids`; `false` for `height-from-extent`, `join-by-location`, `aggregate-per-area` and `distance-to-nearest`. Then replace the `roof-metrics` entry (`:5-18`) with:

```ts
  {
    id: "roof-metrics",
    name: "Roof metrics to attributes",
    group: "roof",
    description: "Roof area, slope, azimuth per building",
    longDescription:
      "Writes the roof metrics Roofy already computes as attributes of each building.",
    extension: null,
    needsReader: false,
    target: "city",
    needsVectorSource: false,
    needsLod: true,
    defaultPrefix: "roof_",
    outputColumns: (prefix, params) =>
      roofColumnNames(prefix, roofParams(params)),
    validateParams: (params) =>
      roofParams(params).measures.length === 0
        ? "Pick at least one measure"
        : null,
    normaliseParams: (params) => ({ ...roofParams(params) }),
    // Task 12 flips this, once the executor, the LoD select and the parameters
    // all exist. Until then the row reads "Not available yet" and a run of it
    // fails with the same words rather than hanging.
    implemented: false,
  },
```

with `import { roofColumnNames, roofParams } from "./roofMetricsParams";` at the top.

- [ ] **Step 6: Extend the eligibility test**

Append to `tests/unit/features/processing/eligibility.test.ts`. Roof metrics is still `implemented: false`, and `eligibility.ts:44` outranks everything — so these two assert the rules that will apply the moment Task 12 flips it, over an enabled COPY of the definition:

```ts
/** The M2 registry entry, as Task 12 will switch it on. */
const enabledRoof = { ...toolById("roof-metrics"), implemented: true };

it("lets Roof metrics run on a streaming layer with no reader", () => {
  // Spec §7.1: "works on every city layer kind including streaming (resident
  // set) and CityGML". Nothing about it needs a reader or an extension.
  expect(
    toolEligibility(enabledRoof, {
      targetKind: "streaming",
      sourceEncoding: "flatcitybuf",
      hasReader: false,
      sourceAvailable: false,
      tableState: "ready",
      engineState: "ready",
      hasVectorLayer: false,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: true });
});

it("refuses Roof metrics on a vector layer", () => {
  expect(
    toolEligibility(enabledRoof, {
      targetKind: "vector",
      sourceEncoding: null,
      hasReader: false,
      sourceAvailable: false,
      tableState: "none",
      engineState: "ready",
      hasVectorLayer: true,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: false, reason: "Needs a city model layer" });
});

it("still reads 'Not available yet' until Task 12 switches it on", () => {
  expect(
    toolEligibility(toolById("roof-metrics"), {
      targetKind: "city",
      sourceEncoding: "cityjson",
      hasReader: true,
      sourceAvailable: true,
      tableState: "ready",
      engineState: "ready",
      hasVectorLayer: false,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: false, reason: "Not available yet" });
});
```

(Import `toolById` from `toolRegistry` if the file does not already.)

- [ ] **Step 7: Run everything that touches the registry**

```bash
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. `tsc` will name every registry entry still missing `needsLod` — that is the point of making it required.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/roofMetricsParams.ts src/features/processing/types.ts \
  src/features/processing/toolRegistry.ts \
  tests/unit/features/processing/roofMetricsParams.test.ts \
  tests/unit/features/processing/eligibility.test.ts
git commit -m "feat(processing): Roof metrics' parameters and the columns they promise"
```

---

### Task 8: The Roof metrics executor, in bounded batches

**Files:**

- Create: `src/features/processing/tools/roofMetrics.ts`
- Modify: `src/features/processing/runQueue.ts` (add `throwIfCancelled` to `ToolContext`), `src/features/processing/tools/register.ts:10`
- Test: `tests/unit/features/processing/roofMetricsTool.test.ts` (the pure halves), `tests/unit/features/processing/roofMetricsRun.test.ts` (lifecycle, in `runQueue.test.ts`'s style), `tests/unit/features/processing/register.test.ts:18`

**Interfaces:**

- Consumes: `ToolExecutor`/`ToolContext`/`ToolResult` (`runQueue.ts:85-108`); `rollUpRoofSurfaces` (Task 4); `roofGeometrySource`, `RoofGeometrySource` (Task 6); `roofParams`, `ROOF_MEASURES` (Task 7); `quoteIdent`, `quoteLiteral` from `src/insights/sql.ts`.
- Produces:
  - `runQueue.ts`: `ToolContext.throwIfCancelled(): void`.
  - `roofMetrics.ts`: `buildFeatureRowsReadSql(table, ids)`, `groupRowsByFeature(rows)`, `computeRoofRows(input): Promise<RoofComputeOutput>`, `ROOF_BATCH_FEATURES`, `roofMetrics: ToolExecutor`, and the registration.
- Task 9 consumes the executor's all-NULL case; Task 12 consumes the registration.

**The batch bound, stated.** `ROOF_BATCH_FEATURES = 500`. Between batches the executor yields with `await new Promise((r) => setTimeout(r, 0))` — a MACROTASK, so the event loop actually turns and the browser can paint and deliver the Cancel click. A microtask (`await Promise.resolve()`) would not: it runs before the loop turns. The abort is checked **after** the yield, not before it, because the click the yield exists to let through lands DURING the yield; checking first would run one more batch than necessary every time. 500 features is a few milliseconds of `computeRoofMetrics` on 3D BAG-shaped data and keeps the yield overhead under a percent on a 100k-feature layer; it is a constant in one place, so it is one edit if a real profile disagrees.

**What batching does and does not buy.** It does NOT make cancellation correct: `execute` already refuses to publish an aborted run (`runQueue.ts:515` re-checks `signal.aborted` immediately after the executor returns, and the catch reads `CancelledError` as "cancelled"), so a Cancel during a long compute was always honoured — it just had to wait for the whole computation first. What the yield buys is RESPONSIVENESS: the page keeps painting, the elapsed ticker keeps ticking, the Cancel button stays clickable, and the run stops at the next boundary instead of minutes later. `heightFromExtent` needs none of this and is unaffected.

**Why `throwIfCancelled` belongs on the context.** `CancelledError` is private to `runQueue.ts` (it is what tells `execute`'s catch "cancelled" rather than "failed"), and `ctx.query` is the only way an executor could reach it today. A tool that computes for seconds without querying can only stop at its own end. One method gives every future long executor the early exit.

- [ ] **Step 1: Write the failing tests for the pure halves**

Create `tests/unit/features/processing/roofMetricsTool.test.ts`:

```ts
/**
 * Spec §7.1's tool, and §7's contributor and roll-up rules through it.
 *
 * The pure halves are tested directly: `buildFeatureRowsReadSql` (the run's one
 * statement) and `computeRoofRows` (everything else). The executor itself is
 * glue over them, and Task 8's second file drives it through a real run.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildFeatureRowsReadSql,
  computeRoofRows,
} from "../../../../src/features/processing/tools/roofMetrics";
import type { RoofSurfaceMetric } from "../../../../src/domain/roofMetrics/roofRollUp";
import type { RoofGeometrySource } from "../../../../src/features/processing/roofGeometrySource";

const s = (
  lod: string,
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

/**
 * A source built from two plain maps: which LoDs each object has GEOMETRY at
 * (of any type), and which roof surfaces it has there. The separation IS the
 * rule under test.
 */
function source(
  geometry: Record<string, string[]>,
  roofs: Record<string, RoofSurfaceMetric[]>,
): RoofGeometrySource {
  return {
    has: (id) => id in geometry,
    hasGeometryAt: (id, lod) => (geometry[id] ?? []).includes(lod),
    roofSurfacesAt: (id, lod) =>
      (roofs[id] ?? []).filter((surface) => surface.lod === lod),
  };
}

describe("buildFeatureRowsReadSql", () => {
  it("reads every row when the scope named none", () => {
    expect(buildFeatureRowsReadSql("layer_1", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"',
    );
  });

  it("restricts to the frozen row ids, quoted", () => {
    expect(buildFeatureRowsReadSql("layer_1", ["b1", "o'x"])).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"' +
        ` WHERE "id" IN ('b1', 'o''x')`,
    );
  });
});

describe("computeRoofRows", () => {
  const rows = [
    { id: "B1", f: "B1" },
    { id: "B1P", f: "B1" },
    { id: "B2", f: "B2" },
  ];

  it("gives the ROOT the contributors' roll-up and a PART its own (§8)", async () => {
    const out = await computeRoofRows({
      rows,
      // The part has geometry at 2.2, so per §7 the PART is the contributor and
      // the root's own 2.2 surfaces are ignored (3D BAG stores both).
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        {
          B1: [s("2.2", 999, 0, 0)],
          B1P: [s("2.2", 10, 30, 180), s("2.2", 10, 0, 0)],
          B2: [s("2.2", 4, 45, 90)],
        },
      ),
      params: {
        measures: ["area", "flatShare", "azimuth"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B1P")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B2")).toEqual({
      roof_area_m2: 4,
      roof_flat_share: 0,
      roof_azimuth_deg: 90,
    });
    expect(out.measured).toBe(2);
    expect(out.skipped).toEqual([]);
  });

  it("selects a WALL-ONLY part as the contributor, and then finds no roof", async () => {
    // §7's rule is about GEOMETRY, not roofs: "if any part of the feature has
    // geometry, the PARTS are the contributors and the root's own geometry at
    // that LoD is ignored". A root roof beside a wall-only part is exactly the
    // 3D BAG double-storage the rule exists for, and measuring the root here
    // would report a roof the chosen contributor does not have.
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        { B1: [s("2.2", 40, 30, 180)], B1P: [], B2: [s("2.2", 4, 45, 90)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B2")).toEqual({ roof_area_m2: 4 });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("falls back to the ROOT when no part has geometry at the LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["1.2"], B2: [] },
        { B1: [s("2.2", 12, 20, 270)], B1P: [s("1.2", 99, 20, 0)], B2: [] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: 12 });
    // The part has nothing at 2.2 — its OWN value is NULL, and that does not
    // take the building's away.
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
  });

  it("sums UNEQUAL parts and weights the slope by their areas", async () => {
    const out = await computeRoofRows({
      rows: [
        { id: "B1", f: "B1" },
        { id: "P1", f: "B1" },
        { id: "P2", f: "B1" },
      ],
      source: source(
        { B1: ["2.2"], P1: ["2.2"], P2: ["2.2"] },
        {
          B1: [s("2.2", 500, 90, 0)],
          P1: [s("2.2", 30, 40, 180)],
          P2: [s("2.2", 10, 0, 0)],
        },
      ),
      params: {
        measures: ["area", "slope", "surfaces", "flatArea"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 40,
      roof_flat_m2: 10,
      roof_slope_deg: (30 * 40) / 40,
      roof_surfaces_n: 2,
    });
    expect(out.rows.get("P1")).toEqual({
      roof_area_m2: 30,
      roof_flat_m2: 0,
      roof_slope_deg: 40,
      roof_surfaces_n: 1,
    });
    expect(out.rows.get("P2")).toEqual({
      roof_area_m2: 10,
      roof_flat_m2: 10,
      roof_slope_deg: 0,
      roof_surfaces_n: 1,
    });
  });

  it("writes NULL everywhere and counts the feature skipped, by LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["1.2"], B1P: [], B2: [] },
        { B1: [s("1.2", 5, 0, 0)], B1P: [], B2: [] },
      ),
      params: {
        measures: ["area", "slope", "surfaces"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: null,
      roof_slope_deg: null,
      roof_surfaces_n: null,
    });
    expect(out.measured).toBe(0);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 2 },
    ]);
  });

  it("treats a row the source has never heard of as having nothing", async () => {
    // A streaming feature evicted between Run and the head of the queue. It is
    // in the frozen scope and in the table; it has no geometry NOW, which is
    // exactly what "no roof surfaces at LoD 2.2" says.
    const out = await computeRoofRows({
      rows,
      source: source({ B2: ["2.2"] }, { B2: [s("2.2", 4, 45, 90)] }),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("writes a row for every row the table gave it, and no others", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], ghost: ["2.2"] },
        { B1: [s("2.2", 1, 0, 0)], ghost: [s("2.2", 1, 0, 0)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect([...out.rows.keys()].sort()).toEqual(["B1", "B1P", "B2"]);
  });

  it("respects the threshold in flat area and in the dominant azimuth", async () => {
    const build = (flatThresholdDeg: number) =>
      computeRoofRows({
        rows: [{ id: "B2", f: "B2" }],
        source: source(
          { B2: ["2.2"] },
          { B2: [s("2.2", 10, 4, 45), s("2.2", 6, 9, 270)] },
        ),
        params: { measures: ["flatArea", "azimuth"], flatThresholdDeg },
        prefix: "roof_",
        lod: "2.2",
      });
    expect((await build(5)).rows.get("B2")).toEqual({
      roof_flat_m2: 10,
      roof_azimuth_deg: 270,
    });
    expect((await build(15)).rows.get("B2")).toEqual({
      roof_flat_m2: 16,
      roof_azimuth_deg: null,
    });
  });

  it("declares one DOUBLE column per ticked measure, in the spec's order", async () => {
    const out = await computeRoofRows({
      rows,
      source: source({}, {}),
      params: {
        measures: ["surfaces", "area", "slope"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.columns).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("calls onBatch between bounded batches, not per feature", async () => {
    const onBatch = vi.fn(async () => {});
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await computeRoofRows({
      rows: many,
      source: source({}, {}),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
      onBatch,
    });
    // 1200 features at 500 per batch: after the first and second batches.
    expect(onBatch).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as onBatch throws, instead of computing to the end", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await expect(
      computeRoofRows({
        rows: many,
        source: source({}, {}),
        params: { measures: ["area"], flatThresholdDeg: 5 },
        prefix: "roof_",
        lod: "2.2",
        onBatch: async () => {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
  });
});
```

Also update `tests/unit/features/processing/register.test.ts:17-19`:

```ts
it("registers exactly M2's executors, in `register.ts`'s import order", () => {
  expect(Object.keys(EXECUTORS)).toEqual([
    "height-from-extent",
    "roof-metrics",
  ]);
});
```

- [ ] **Step 2: Run and watch both fail**

```bash
npx vitest run tests/unit/features/processing/roofMetricsTool.test.ts \
  tests/unit/features/processing/register.test.ts
```

Expected: FAIL — the tool module does not exist, and `EXECUTORS` still holds one key.

- [ ] **Step 3: Give the context a cancellation check**

In `src/features/processing/runQueue.ts`, add to `ToolContext` (`:85-94`):

```ts
  /**
   * Throw if the user has cancelled — the ONE way a long, query-free executor
   * can be stopped.
   *
   * `ctx.query` already does this, which is enough for a tool whose work IS
   * queries — and `execute` already refuses to PUBLISH an aborted run right
   * after the executor returns. What a long, query-free executor lacks is the
   * early EXIT: without this it computes to the end and then discovers the run
   * was cancelled minutes ago. `CancelledError` is private to this module on
   * purpose: it is what makes `execute`'s catch read "cancelled" rather than
   * "failed", and an executor must not be able to fake either.
   */
  throwIfCancelled(): void;
```

and to the `ctx` literal (`:482-509`), beside `phase` and `warn`:

```ts
      throwIfCancelled() {
        if (signal.aborted) throw new CancelledError();
      },
```

- [ ] **Step 4: Write the executor**

Create `src/features/processing/tools/roofMetrics.ts`:

```ts
/**
 * Roof metrics to attributes (spec §7.1).
 *
 * NOTHING IS COMPUTED IN SQL. Roof area, inclination and azimuth are derived
 * from ring geometry, which exists nowhere in DuckDB (spec §2) and which the
 * app has already parsed. So this tool issues exactly ONE statement, and it is
 * a question about ROWS, not geometry:
 *
 *   which rows are in scope, and which FEATURE does each belong to?
 *
 * The table is the authority on that (it is what the write targets, and what
 * `feature_id` means); `RoofGeometrySource` is the authority on geometry, and
 * measures only what it is asked for. A row the source has never heard of
 * simply has nothing — which is true for a streaming feature that left the
 * resident set between Run and the head of the queue, and is reported as a
 * skip rather than as an error.
 *
 * `needsReader` is false and no source is registered, so §6.1's "Reading
 * source" phase is skipped and the run goes straight to Computing.
 *
 * BOUNDED WORK. Features are rolled up in batches of `ROOF_BATCH_FEATURES`,
 * and between batches the caller's `onBatch` runs — in the executor that is a
 * cancellation check plus a yield to the event loop, so a run over a large
 * layer neither freezes the page nor outruns the Cancel button.
 */

import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import type { OutputColumn } from "../../../insights/computedColumns";
import {
  rollUpRoofSurfaces,
  type RoofRollUp,
  type RoofSurfaceMetric,
} from "../../../domain/roofMetrics/roofRollUp";
import {
  ROOF_MEASURES,
  roofParams,
  type RoofMeasure,
  type RoofMetricsParams,
} from "../roofMetricsParams";
import {
  roofGeometrySource,
  type RoofGeometrySource,
} from "../roofGeometrySource";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** Features per batch. See the module comment: a bound, not a tuning knob. */
export const ROOF_BATCH_FEATURES = 500;

/** One table row: its own id, and the feature it belongs to. */
export interface FeatureRow {
  readonly id: string;
  readonly f: string;
}

/**
 * The run's one statement.
 *
 * `ids` are ROW ids — `resolveScope` has already expanded the user's selection
 * or filter to whole features — and `null` means every row.
 */
export function buildFeatureRowsReadSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f FROM ${quoteIdent(table)}` +
    where
  );
}

/** The scope's rows, grouped by feature, in first-seen order. */
export function groupRowsByFeature(
  rows: ReadonlyArray<FeatureRow>,
): ReadonlyArray<readonly [string, ReadonlyArray<FeatureRow>]> {
  const members = new Map<string, FeatureRow[]>();
  for (const row of rows) {
    const list = members.get(row.f);
    if (list) list.push(row);
    else members.set(row.f, [row]);
  }
  return [...members.entries()];
}

/** One measure of one roll-up, or null when it could not be evaluated. */
function valueOf(measure: RoofMeasure, rollUp: RoofRollUp): number | null {
  switch (measure) {
    case "area":
      return rollUp.areaM2;
    case "flatArea":
      return rollUp.flatM2;
    case "flatShare":
      return rollUp.flatShare;
    case "slope":
      return rollUp.slopeDeg;
    case "azimuth":
      return rollUp.azimuthDeg;
    case "surfaces":
      return rollUp.surfaces;
  }
}

export interface RoofComputeInput {
  readonly rows: ReadonlyArray<FeatureRow>;
  readonly source: RoofGeometrySource;
  readonly params: RoofMetricsParams;
  readonly prefix: string;
  readonly lod: string;
  /** Run between batches. Throwing from it aborts the whole computation. */
  readonly onBatch?: () => Promise<void>;
}

export interface RoofComputeOutput {
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Record<string, number | null>>;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

/**
 * Spec §7's contributor rule and roll-ups, over the rows the table gave us.
 *
 * CONTRIBUTORS (§7, verbatim): "At the chosen LoD, if any part of the feature
 * has GEOMETRY, the PARTS are the contributors and the root's own geometry at
 * that LoD is ignored (3D BAG stores the same building on both); otherwise the
 * root is the sole contributor." GEOMETRY — of any semantic type. A root with
 * a roof and a part with only walls selects the PART, and the feature is then
 * skipped for having no roof. Using the root's roof instead would report the
 * very double-storage this rule exists to avoid.
 *
 * WHAT EACH ROW GETS (§8): the ROOT row carries the feature's roll-up; every
 * other row carries its OWN. A part stamped with its building's total is a
 * measurement of something the user never selected.
 *
 * COUNTING (§7): per FEATURE. A building with one measurable contributor is
 * one building measured, whatever its other parts lack.
 */
export async function computeRoofRows(
  input: RoofComputeInput,
): Promise<RoofComputeOutput> {
  const ticked = ROOF_MEASURES.filter((m) =>
    input.params.measures.includes(m.key),
  );
  const columns: OutputColumn[] = ticked.map((m) => ({
    name: `${input.prefix}${m.suffix}`,
    type: "DOUBLE",
  }));

  const values = (rollUp: RoofRollUp | null): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const measure of ticked) {
      out[`${input.prefix}${measure.suffix}`] =
        rollUp === null ? null : valueOf(measure.key, rollUp);
    }
    return out;
  };

  const rows = new Map<string, Record<string, number | null>>();
  let measured = 0;
  let skipped = 0;
  let sinceYield = 0;

  for (const [featureId, memberRows] of groupRowsByFeature(input.rows)) {
    const parts = memberRows.filter((row) => row.id !== featureId);
    const partContributors = parts.filter((row) =>
      input.source.hasGeometryAt(row.id, input.lod),
    );
    const contributors =
      partContributors.length > 0
        ? partContributors
        : memberRows.filter(
            (row) =>
              row.id === featureId &&
              input.source.hasGeometryAt(row.id, input.lod),
          );

    const surfaces: RoofSurfaceMetric[] = [];
    for (const row of contributors) {
      surfaces.push(...input.source.roofSurfacesAt(row.id, input.lod));
    }
    const featureRollUp = rollUpRoofSurfaces(
      surfaces,
      input.params.flatThresholdDeg,
    );
    if (featureRollUp === null) skipped += 1;
    else measured += 1;

    for (const row of memberRows) {
      rows.set(
        row.id,
        row.id === featureId
          ? values(featureRollUp)
          : values(
              rollUpRoofSurfaces(
                [...input.source.roofSurfacesAt(row.id, input.lod)],
                input.params.flatThresholdDeg,
              ),
            ),
      );
    }

    sinceYield += 1;
    if (sinceYield >= ROOF_BATCH_FEATURES && input.onBatch) {
      sinceYield = 0;
      await input.onBatch();
    }
  }

  return {
    columns,
    rows,
    measured,
    skipped:
      skipped > 0
        ? [{ cause: `no roof surfaces at LoD ${input.lod}`, count: skipped }]
        : [],
  };
}

export const roofMetrics: ToolExecutor = async (run, ctx) => {
  // The form guarantees a LoD (Run is refused with "No roof surfaces in this
  // layer" when none qualifies), so this is unreachable through the UI. It is
  // here because a skip cause reading "no roof surfaces at LoD null" would be
  // worse than a failure.
  if (run.lod === null) throw new Error("No roof surfaces in this layer");

  ctx.phase("compute");
  const out = await ctx.query(
    "Reading features",
    buildFeatureRowsReadSql(ctx.table.table, ctx.featureIds),
  );
  // A type guard, not logic: the context throws on a failed query.
  if (!out.ok) throw new Error(out.message);
  // The query above can take a while on a large scope, and a Cancel pressed
  // during it should not be answered by starting the compute.
  ctx.throwIfCancelled();

  const computed = await computeRoofRows({
    rows: out.rows.map((row) => ({ id: String(row.id), f: String(row.f) })),
    source: roofGeometrySource(ctx.layer),
    params: roofParams(run.params),
    prefix: run.prefix,
    lod: run.lod,
    onBatch: async () => {
      // YIELD FIRST, then check. A MACROTASK, so the event loop actually turns:
      // the page can paint and the Cancel click can land — and it lands DURING
      // this await, which is why the check comes after it. `await
      // Promise.resolve()` is a microtask and would yield to nothing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      ctx.throwIfCancelled();
    },
  });

  return {
    columns: computed.columns,
    rows: computed.rows,
    measured: computed.measured,
    skipped: computed.skipped,
  };
};

registerExecutor("roof-metrics", roofMetrics);
```

- [ ] **Step 5: Wire the registration**

`src/features/processing/tools/register.ts` — append after `import "./heightFromExtent";`:

```ts
import "./roofMetrics";
```

The import ORDER is the assertion in `register.test.ts`: `EXECUTORS` is a plain object, so `Object.keys` follows insertion order, which follows this file.

- [ ] **Step 6: Write the lifecycle tests**

Create `tests/unit/features/processing/roofMetricsRun.test.ts` by **copying `tests/unit/features/processing/runQueue.test.ts`'s header verbatim** (`:1-235`: the `sql`/`registered` arrays, `freshTable`, `featureTotal`, `scopeRows`, `gate`, `failing`, `liveColumns`, the `vi.mock` of `insights/duckdb` and of `insights/layerTables`, the dynamic imports, `deferred`, `computedAlready`, `request`, `attributesOf`, and its `beforeEach`/`afterEach`) plus Task 1's two new duckdb keys. Then change three things:

1. `model()` returns the roof fixture below instead of the single empty `a`.
2. `layer()` gains `selectedLod: "2.2"` and `availableLods: ["2.2", "1.2"]`.
3. `afterEach` also does `delete EXECUTORS["roof-metrics"]`, and the suite imports `"../../../../src/features/processing/tools/register"` for its side effect (this file is about the REAL executor).

The gate is `{ needle, promise }` (`runQueue.test.ts:53-54,65`), armed as `gate = { needle: "…", promise: held.promise }` where `held = deferred<void>()`; it is released with `held.resolve()`. **There is no `gate?.resolve()`.**

```ts
/**
 * Roof metrics driven through a REAL run: the queue, the write, the model
 * merge, scoped replacement, Undo, cancellation and the streaming
 * invalidation. The pure roll-ups are covered in `roofMetricsTool.test.ts`;
 * this file is about what a user has afterwards.
 */

/** A unit square of `type` at `lod`, scaled so its area is `area`. */
function square(type: string, lod: string, area: number, slope = 0) {
  const w = Math.sqrt(area);
  // `slope` is baked by lifting one edge: inclination is only asserted through
  // the roll-up, so a 0/45 pair is enough to make the threshold matter.
  const dz = slope === 0 ? 0 : w;
  return {
    type,
    rings: [
      [
        [0, 0, 3],
        [w, 0, 3],
        [w, w, 3 + dz],
        [0, w, 3 + dz],
      ],
    ],
    attributes: {},
    lod,
  };
}

/**
 * B1 (Building) + P1 (roof 30 m², pitched 45°) + P2 (roof 10 m², flat);
 * B2 (Building, roof 12 m² flat at 2.2, NO parts);
 * B3 (Building, roof at 1.2 only).
 *
 * B1's two parts are UNEQUAL, so a sum can be told from a max; B2 is in the
 * layer but outside the Selected scope below, so a replacement can be shown to
 * leave a NON-NULL value alone; B3 is the skip.
 */
function model(): CityModel {
  const object = (
    id: string,
    objectType: string,
    surfaces: unknown[],
    parents: string[] = [],
    children: string[] = [],
  ) => ({
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  });
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object(
        "B1",
        "Building",
        [square("RoofSurface", "2.2", 99)],
        [],
        ["P1", "P2"],
      ),
      P1: object(
        "P1",
        "BuildingPart",
        [square("RoofSurface", "2.2", 30, 45)],
        ["B1"],
      ),
      P2: object(
        "P2",
        "BuildingPart",
        [square("RoofSurface", "2.2", 10)],
        ["B1"],
      ),
      B2: object("B2", "Building", [square("RoofSurface", "2.2", 12)]),
      B3: object("B3", "Building", [square("RoofSurface", "1.2", 5)]),
    },
  } as unknown as CityModel;
}

/** Every row of the fake table, which is what `scopeRows` answers with. */
const ALL_ROWS = [
  { id: "B1", f: "B1" },
  { id: "P1", f: "B1" },
  { id: "P2", f: "B1" },
  { id: "B2", f: "B2" },
  { id: "B3", f: "B3" },
];

/** The roof request, with the shape `submitRun` wants. */
function roofRequest(overrides: Record<string, unknown> = {}) {
  return request({
    toolId: "roof-metrics",
    lod: "2.2",
    prefix: "roof_",
    params: {
      measures: ["area", "flatArea", "surfaces"],
      flatThresholdDeg: 5,
    },
    columns: [
      { name: "roof_area_m2", type: "DOUBLE" as const },
      { name: "roof_flat_m2", type: "DOUBLE" as const },
      { name: "roof_surfaces_n", type: "DOUBLE" as const },
    ],
    ...overrides,
  });
}

describe("a Roof metrics run", () => {
  beforeEach(() => {
    featureTotal = 3;
    scopeRows = ALL_ROWS;
  });

  it("sums UNEQUAL parts onto the building and leaves each part its own", async () => {
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    // §7's contributor rule: B1's PARTS contribute, its own 99 m² roof is
    // ignored. 30 + 10 = 40, and a max or a root read would not give 40.
    expect(attributesOf("B1").roof_area_m2).toBeCloseTo(40, 6);
    expect(attributesOf("P1").roof_area_m2).toBeCloseTo(30, 6);
    expect(attributesOf("P2").roof_area_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B1").roof_surfaces_n).toBe(2);
    expect(attributesOf("B2").roof_area_m2).toBeCloseTo(12, 6);
    // B3 has no roof at 2.2: NULL, and one skip naming the LoD.
    expect(attributesOf("B3").roof_area_m2).toBeNull();
    expect(runById(id)!.summary!.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
    expect(
      sql.some((q) => q.includes('COALESCE("feature_id", "id") AS f')),
    ).toBe(true);
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(true);
  });

  it("replaces inside the scope only, with a THRESHOLD that changes the value", async () => {
    // Run 1, All, threshold 5: P1 (45°) is not flat, P2 (0°) is.
    const first = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);

    // Run 2, Selected on B1's family, threshold 50: now P1 counts as flat too,
    // so B1's flat area MUST move from 10 to 40. B2 is outside the scope and
    // its value is NON-NULL, so §7's "values in a replaced column outside the
    // scope keep their existing value" has something real to preserve.
    useSelectionStore.getState().select({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
    scopeRows = ALL_ROWS.filter((r) => r.f === "B1");
    const second = submitRun(
      roofRequest({
        scope: "selected",
        params: {
          measures: ["area", "flatArea", "surfaces"],
          flatThresholdDeg: 50,
        },
      }),
    );
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));

    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(40, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
    // §6.2: the later run takes the earlier one's Undo.
    expect(runById(first)?.undoable).toBe(false);
    expect(runById(second)?.undoable).toBe(true);

    await undoRun(second);
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
  });

  it("publishes NOTHING when the Cancel lands during the compute", async () => {
    // The gate holds the executor's OWN read — the statement no other run
    // issues — so the run is demonstrably inside `roofMetrics` when Cancel is
    // pressed, not still queued.
    const held = deferred<void>();
    gate = { needle: "AS f FROM", promise: held.promise };
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.phase).toBe("compute"));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("AS f FROM"))).toBe(true),
    );
    cancelRun(id);
    held.resolve();

    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(attributesOf("B1").roof_area_m2).toBeUndefined();
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(false);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("fails rather than writing when the table was rebuilt under it", async () => {
    // Held at the FEATURE COUNT, which `resolveScope` issues at the head of
    // the queue — before the table name is re-checked for the write.
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    tableInfo = { ...tableInfo, table: "layer_2" }; // a streaming rebuild
    held.resolve();

    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Layer changed while running; run again");
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("marks a finished run stale when the layer's table is rebuilt after it", async () => {
    const stop = installStaleWatcher();
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    useLayerTableStore.setState({
      tables: {
        L1: { state: "ready", info: { ...tableInfo, table: "layer_9" } },
      },
    });
    await vi.waitFor(() => expect(runById(id)?.stale).toBe(true));
    stop();
  });
});
```

Two details the copy has to get right. `tableInfo` is the file's mutable table fixture (`freshTable()`, reset in `beforeEach`), and the `layerTables` mock reads it — reassigning it IS the rebuild. `installStaleWatcher` and `useLayerTableStore` come from the same imports `runQueue.test.ts`'s own stale-watcher case uses; copy that case's setup rather than inventing a second pattern. If the rebuilt-table case turns out to be covered identically by the existing suite for Height from extent, keep only the roof-specific ones and say so in the file's header comment — duplicated coverage is worse than a named gap.

- [ ] **Step 7: Run everything**

```bash
npx vitest run tests/unit/features/processing
npx tsc -b --noEmit
```

Expected: PASS, including the updated `EXECUTORS` pin.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/tools/roofMetrics.ts \
  src/features/processing/tools/register.ts src/features/processing/runQueue.ts \
  tests/unit/features/processing/roofMetricsTool.test.ts \
  tests/unit/features/processing/roofMetricsRun.test.ts \
  tests/unit/features/processing/register.test.ts
git commit -m "feat(processing): Roof metrics computes the six columns in bounded batches"
```

---

### Task 9: Style by result gates on a column that has values, and the card names the resident set

**Files:**

- Modify: `src/features/processing/types.ts` (`RunSummary`), `src/features/processing/runQueue.ts` (`summarise` and its one call site), `src/ui/processing/RunFooter.tsx:249-254`
- Test: `tests/unit/features/processing/runQueue.test.ts` (the `summarise` unit tests), `tests/unit/ui/processing/ToolView.test.tsx:575-600`

**Interfaces:**

- Produces:
  - `RunSummary.firstColumnNonNull: number` — how many WRITTEN ROWS have a non-null value in the run's first output column.
  - `summarise(result: ToolResult, elapsedMs: number, options: { readonly streaming: boolean }): RunSummary`.
- Task 11 and Task 14 rely on the gate; nothing else consumes the new field.

**Why `measured === 0` is the wrong gate.** M1 ruled it as the synchronous stand-in for §6.2's "disabled with 'All values are empty' when the chosen column is NULL for every object in the run", and for Height from extent the two coincide: every measured feature gets a height. Roof metrics breaks the equivalence. A run with **only** Dominant azimuth ticked over a layer of perfectly flat roofs measures every building (`measured > 0`) and writes `roof_azimuth_deg = NULL` everywhere — `§7`'s "no remaining contributor for a measure gets NULL for it". Style by result would then open a rule editor on a column with no median, and `readMedian` would toast DuckDB's NULL instead of the sentence the spec names. Same for `roof_slope_deg` and `roof_flat_share` over zero-area surfaces (`computeRoofMetrics` returns all-zeros for a degenerate ring).

The count is computed centrally in `summarise`, from `result.columns[0]` and `result.rows`, so it is right for every tool present and future without asking executors to remember it.

**The resident-set qualifier (§10 scenario 4: "the card says so").** Today the "Runs over the N currently loaded buildings" sentence appears only in the FORM (`ToolView.tsx:174-179`). Scenario 4 asks for it on the result too, and the card is where a run is read afterwards. `summarise` takes `{ streaming }` and puts an extra clause at the head of the DETAIL line. **[adapted]** copy: `"Over the resident set: the buildings loaded when the run started."`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/features/processing/runQueue.test.ts`'s `summarise` describe (or add one if there is none):

```ts
describe("summarise", () => {
  const result = (
    rows: Array<[string, Record<string, unknown>]>,
    columns: string[],
  ) => ({
    columns: columns.map((name) => ({ name, type: "DOUBLE" as const })),
    rows: new Map(rows),
    measured: rows.length,
    skipped: [],
  });

  it("counts the rows whose FIRST output column has a value", () => {
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: 180 }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.firstColumnNonNull).toBe(1);
  });

  it("is 0 when every object got NULL, even though features were measured", () => {
    // Azimuth-only over perfectly flat roofs: §7 gives NULL for the measure,
    // and §6.2's Style by result must read "All values are empty".
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: null }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.measured).toBe(2);
    expect(summary.firstColumnNonNull).toBe(0);
  });

  it("is 0 for a run that wrote no column at all", () => {
    const summary = summarise(result([], []), 1000, { streaming: false });
    expect(summary.firstColumnNonNull).toBe(0);
  });

  it("says the run was over the resident set, for a streaming target", () => {
    const summary = summarise(
      result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started.",
    );
  });

  it("keeps the skip breakdown beside the resident-set note", () => {
    const summary = summarise(
      {
        ...result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
        skipped: [{ cause: "no roof surfaces at LoD 2", count: 3 }],
      },
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started. · " +
        "3 skipped: 3 no roof surfaces at LoD 2",
    );
  });
});
```

And in `tests/unit/ui/processing/ToolView.test.tsx`, use the file's own helpers — `runFixture` (`:140-168`), `doneRun(layerId, patch)` (`:171-182`) and `act(() => useProcessingStore.getState().upsertRun(…))`, which is how every Style-by-result case there already sets a run up. **There is no `renderDoneRun`.**

First, `doneRun`'s own summary is the POSITIVE fixture the rest of the file leans on, so give it a positive count rather than defaulting it to zero (`:174-179`):

```ts
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
      // Both buildings got a height: this is the summary of a run that CAN be
      // styled, which is what every case built on `doneRun` assumes.
      firstColumnNonNull: 2,
    },
```

Then rewrite the existing "All values are empty" case (`:560-589`) so the run MEASURED things and still wrote nothing, and add its sibling:

```tsx
it("disables Style by result when the first column is NULL everywhere", () => {
  const layerId = addCityLayer();
  render(<ToolView toolId="height-from-extent" />);
  act(() =>
    useProcessingStore.getState().upsertRun(
      doneRun(layerId, {
        summary: {
          line: "2 buildings measured · 0.1 s",
          detail: null,
          // MEASURED, and still nothing to style: §6.2's condition is about
          // the COLUMN, not the count. A Roof metrics run with only Dominant
          // azimuth ticked over flat roofs lands exactly here.
          measured: 2,
          skipped: [],
          firstColumnNonNull: 0,
        },
      }),
    ),
  );
  const button = screen.getByRole("button", { name: "Style by result" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "All values are empty");
  // The reason has to be READABLE, not only a tooltip on a disabled control
  // (which no keyboard or screen-reader user ever reaches) — the same muted
  // note the Run button's reason gets.
  expect(
    screen.getByText("All values are empty", { selector: "p" }),
  ).toBeInTheDocument();
});

it("keeps Style by result enabled when only SOME values are null", () => {
  const layerId = addCityLayer();
  render(<ToolView toolId="height-from-extent" />);
  act(() =>
    useProcessingStore.getState().upsertRun(
      doneRun(layerId, {
        summary: {
          line: "2 buildings measured · 0.1 s",
          detail: null,
          measured: 2,
          skipped: [],
          firstColumnNonNull: 1,
        },
      }),
    ),
  );
  expect(screen.getByRole("button", { name: "Style by result" })).toBeEnabled();
});
```

`tsc` will then name every other `RunSummary` literal in the suite that lacks the field — the `runFixture({ summary: … })` calls around `:387`, `:437`, `:462`, `:483`, `:522` and `:568`. Give each the count its case implies: a card showing a done run with values gets a positive number, and only a genuinely empty one gets `0`. Do not default them all to zero — several of those cases assert an ENABLED Style by result.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts -t summarise
npx vitest run tests/unit/ui/processing/ToolView.test.tsx -t "values are empty"
```

Expected: FAIL — `firstColumnNonNull` is not a property of `RunSummary`, and `summarise` takes two arguments.

- [ ] **Step 3: Carry the count on the summary**

In `src/features/processing/types.ts`, inside `RunSummary` (`:75-82`):

```ts
  /**
   * How many written rows have a value in the run's FIRST output column.
   *
   * Spec §6.2 disables Style by result "when the chosen column is NULL for
   * every object in the run", and the chosen column is `columns[0]`. It is not
   * the same as `measured === 0`: a run with only Dominant azimuth ticked over
   * flat roofs measures every building and writes NULL to all of them (§7,
   * "a feature with no remaining contributor for a measure gets NULL for it").
   */
  readonly firstColumnNonNull: number;
```

- [ ] **Step 4: Compute it, and the streaming clause, in `summarise`**

In `src/features/processing/runQueue.ts`, replace `summarise` (`:150-169`):

```ts
/** Spec §10 scenario 4: a streaming run's card says what it ran over. */
const RESIDENT_SET_NOTE =
  "Over the resident set: the buildings loaded when the run started.";

export function summarise(
  result: ToolResult,
  elapsedMs: number,
  options: { readonly streaming: boolean },
): RunSummary {
  const skippedTotal = result.skipped.reduce((a, s) => a + s.count, 0);
  const parts = [
    plural(result.measured, "building measured", "buildings measured"),
  ];
  if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
  parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);

  const detailParts: string[] = [];
  if (options.streaming) detailParts.push(RESIDENT_SET_NOTE);
  if (skippedTotal > 0) {
    detailParts.push(
      `${fmt(skippedTotal)} skipped: ${result.skipped
        .map((s) => `${fmt(s.count)} ${s.cause}`)
        .join(" · ")}`,
    );
  }

  // The FIRST written column is the one §6.2's Style by result offers; a run
  // that wrote none has nothing to style either way.
  const first = result.columns[0]?.name ?? null;
  let firstColumnNonNull = 0;
  if (first !== null) {
    for (const values of result.rows.values()) {
      const value = values[first];
      if (value !== null && value !== undefined) firstColumnNonNull += 1;
    }
  }

  return {
    line: parts.join(" · "),
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    measured: result.measured,
    skipped: result.skipped,
    firstColumnNonNull,
  };
}
```

Update the two call sites in `execute` (the zero-rows branch at `runQueue.ts:517-540` and the publication branch) to pass `{ streaming: layer.isStreaming }`.

- [ ] **Step 5: Move the gate in the footer**

In `src/ui/processing/RunFooter.tsx`, replace the `styleReason` ternary (`:249-254`):

```tsx
// §6.2: "disabled with 'All values are empty' when the chosen column is
// NULL for every object in the run". The RUN knows that — `summarise`
// counted it — and `measured === 0` does not: a run with only Dominant
// azimuth ticked over flat roofs measures every building and writes NULL
// to all of them. A STALE run is disabled too, and OUTRANKS empty: its
// table was rebuilt under it, so no median can be trusted at all.
const styleReason = run.stale
  ? STALE_LAYER_RELOADED
  : run.summary === null || run.summary.firstColumnNonNull === 0
    ? ALL_VALUES_EMPTY
    : null;
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. `tsc` names every `RunSummary` literal in the tests that still lacks `firstColumnNonNull` — add `firstColumnNonNull: 0` (or a value the assertion wants) to each.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/types.ts src/features/processing/runQueue.ts \
  src/ui/processing/RunFooter.tsx tests/unit/features/processing/runQueue.test.ts \
  tests/unit/ui/processing/ToolView.test.tsx
git commit -m "fix(processing): Style by result needs a column with values, not a measured count"
```

---

### Task 10: The LoD select

**Files:**

- Create: `src/ui/processing/useLodOptions.ts`, `tests/unit/ui/processing/roofLayerFixture.tsx`
- Modify: `src/ui/processing/useToolForm.ts` (the draft normalisation at `:79-93`, `runReason` at `:150-152`, the return at `:165-182`), `src/ui/processing/ToolView.tsx` (a field inside the TARGET fieldset, between the Layer select ending `:126` and the Scope block at `:127`)
- Test: `tests/unit/ui/processing/lodSelect.test.tsx`

**Interfaces:**

- Consumes: `roofLodOptions`, `LodOption` (Task 6); `ToolDefinition.needsLod` (Task 7).
- Produces:
  - `useLodOptions.ts`: `export interface LodChoices { readonly options: ReadonlyArray<LodOption>; readonly noun: string; readonly emptyReason: string | null }`; `export function useLodOptions(tool: ToolDefinition, target: Layer | null): LodChoices`.
  - `roofLayerFixture.tsx`: `export function roofModel(options?: { roofs?: boolean }): CityModel`; `export function addRoofLayer(options?: { selectedLod?: string | null; roofs?: boolean }): string` — adds the layer, activates it and registers a `ready` table entry. Task 11 imports both.
  - `useToolForm` gains `lodOptions`, `lodNoun`, `lodReason`, and its returned `draft.lod` is the EFFECTIVE LoD.
- Task 11 consumes the fixture and `f.paramsError`'s place in `runReason`; Task 12 consumes the rendered select.

**An unimplemented tool renders NO LoD control and claims nothing.** `useLodOptions` returns the empty `LodChoices` for any tool with `implemented === false`, and `ToolView` renders the field only when `tool.needsLod && tool.implemented`. Measure solids and Validate solids have no source of truthful counts in M2, and a select reading "No solid geometry in this layer" over a layer full of solids is a fabricated fact. Their rows already say the true thing — "Not available yet".

**Copy.** §6's option pattern is "2.2 (1,115 buildings with a solid)" and its empty state is "No solid geometry in this layer". Roof metrics needs the roof-shaped versions: **[adapted]** `"2.2 (1,115 buildings with roof surfaces)"` and `"No roof surfaces in this layer"`. Both accepted by the reviewer; both listed in "Open questions for the human".

**Why the default is computed and not written.** `useToolForm` must not `setDraft` from a render. It already normalises a stale `targetLayerId` by returning a corrected draft rather than writing one (`useToolForm.ts:90-92`); the LoD takes the same road.

- [ ] **Step 1: Write the shared fixture**

Create `tests/unit/ui/processing/roofLayerFixture.tsx`. Both form suites and the activation suite import it; their `vi.mock` blocks cannot be shared (they are per-file), but the data and the store setup can.

```tsx
/**
 * The layer the Roof metrics form suites run against: FOUR features — two
 * roof-bearing at LoD 2.2, one at 1.2, and one with geometry but no roof —
 * over FIVE rows. Shared because three suites assert counts over it and a
 * second copy would drift.
 */
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useLayerTableStore } from "../../../../src/insights/layerTables";

/** A unit square of `type` at `lod`: area 1, inclination 0, azimuth 0. */
const surface = (type: string, lod: string) => ({
  type,
  rings: [
    [
      [0, 0, 3],
      [1, 0, 3],
      [1, 1, 3],
      [0, 1, 3],
    ],
  ],
  attributes: {},
  lod,
});

const object = (
  id: string,
  objectType: string,
  surfaces: unknown[],
  parents: string[] = [],
  children: string[] = [],
) => ({
  id,
  objectType,
  attributes: {},
  surfaces,
  bbox: null,
  children,
  parents,
  lod: null,
});

/** FEATURES: B1 (+part B1P), B4, B2, B3. ROWS: those five ids. */
export const ROOF_FIXTURE_ROWS = 5;
/** Features with a roof at 2.2 (B1 through its part, and B4). */
export const ROOF_FIXTURE_FEATURES_22 = 2;
/** Features with a roof at 1.2 (B2). */
export const ROOF_FIXTURE_FEATURES_12 = 1;

/**
 * `roofs: false` turns every RoofSurface into a WallSurface, which is how a
 * test reaches §6's "no LoD qualifies" state without an empty layer.
 */
export function roofModel(options: { roofs?: boolean } = {}): CityModel {
  const roof = options.roofs === false ? "WallSurface" : "RoofSurface";
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object("B1", "Building", [surface(roof, "2.2")], [], ["B1P"]),
      B1P: object(
        "B1P",
        "BuildingPart",
        [surface(roof, "2.2"), surface("WallSurface", "2.2")],
        ["B1"],
      ),
      B4: object("B4", "Building", [surface(roof, "2.2")]),
      B2: object("B2", "Building", [surface(roof, "1.2")]),
      // Geometry, no roof at any LoD — the contributor rule's other side, and
      // the reason the 2.2 count is 2 rather than 3.
      B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
    },
  } as unknown as CityModel;
}

function column(name: string): ColumnInfo {
  return { name, type: "VARCHAR", kind: "scalar" };
}

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** Adds the layer, makes it active, and gives it a READY table. */
export function addRoofLayer(
  options: {
    selectedLod?: string | null;
    roofs?: boolean;
    isStreaming?: boolean;
  } = {},
): string {
  const input: LayerInput = {
    name: "roofs",
    model: roofModel(options),
    modelRef: { type: "url", url: "https://x/roofs.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: options.isStreaming ?? false,
  };
  const id = useLayerStore.getState().addLayer(input);
  if (options.selectedLod !== undefined) {
    useLayerStore.setState((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, selectedLod: options.selectedLod ?? null } : l,
      ),
    }));
  }
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: "roofs.city.json",
          source: null,
          reader: "read_cityjson",
          columns: [column("id"), column("feature_id")],
          lods: [],
          rowCount: ROOF_FIXTURE_ROWS,
        },
      },
    },
  });
  return id;
}
```

`ColumnInfo` lives in `src/insights/columnKind.ts` (that is where `ToolView.test.tsx:18` imports it from) and requires `kind`; `"scalar"` is the value every plain column uses there. Confirm both before writing the file: `grep -n "interface ColumnInfo" -A6 src/insights/columnKind.ts`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/ui/processing/lodSelect.test.tsx`. The scaffolding is `ToolView.test.tsx`'s (`:1-90` for the mocks and `:201-222` for the reset), plus Task 1's two duckdb keys and one registry mock. **The `counts` object must be mutable and aligned with the fixture** — `ToolView.test.tsx` declares it at `:58-66` and resets it in `beforeEach`; four features means `all: 4`.

```tsx
/**
 * Spec §6's LoD select for Roof metrics: the options, their FEATURE counts,
 * the default, the empty state, and the tools that get no select at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../src/insights/duckdb", () => ({
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const counts = {
  all: 4 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

/**
 * Roof metrics is `implemented: false` until Task 12. `TOOLS` is an array of
 * plain readonly object literals, so a getter spy has nothing to attach to —
 * the registry is MOCKED instead, the same way `useToolForm.test.tsx:54-71`
 * already enables `measure-solids`. Task 12 deletes this block and reruns
 * these assertions against the real registry.
 */
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const TOOLS = actual.TOOLS.map((t) =>
    t.id === "roof-metrics" ? { ...t, implemented: true } : t,
  );
  return {
    ...actual,
    TOOLS,
    toolById: (id: string) => {
      const tool = TOOLS.find((t) => t.id === id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      return tool;
    },
  };
});

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { addRoofLayer } = await import("./roofLayerFixture");

beforeEach(() => {
  counts.all = 4;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
});

describe("the LoD select (spec §6)", () => {
  it("lists each LoD with its FEATURE count, highest detail first", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    const select = screen.getByRole("combobox", {
      name: "LoD",
    }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "2.2 (2 buildings with roof surfaces)",
      "1.2 (1 building with roof surfaces)",
    ]);
  });

  it("defaults to the layer's selected LoD when it qualifies", () => {
    addRoofLayer({ selectedLod: "1.2" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
  });

  it("defaults to the highest qualifying LoD when the layer's does not qualify", () => {
    addRoofLayer({ selectedLod: "0" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("2.2");
  });

  it("shows the empty state and blocks Run when no LoD qualifies", () => {
    addRoofLayer({ roofs: false });
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText("No roof surfaces in this layer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("does not offer a LoD for a tool that reads no geometry at one level", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
  });

  it("does not offer a LoD, or any geometry verdict, for an UNIMPLEMENTED tool", () => {
    // Measure solids has `needsLod: true` and no source of counts in M2. A
    // select reading "No solid geometry in this layer" over a layer full of
    // solids would be a fact the app never checked.
    addRoofLayer();
    render(<ToolView toolId="measure-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
  });

  it("submits the chosen LoD with the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByRole("combobox", { name: "LoD" }), {
      target: { value: "1.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]![0]!.lod).toBe("1.2");
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/lodSelect.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: LoD`.

- [ ] **Step 4: Write the hook**

Create `src/ui/processing/useLodOptions.ts`:

```ts
/**
 * Spec §6's LoD select, for one tool on one target.
 *
 * A hook rather than a pure function because a STREAMING target's options come
 * from the resident set, which changes on every camera settle — the
 * `useStreamStore` selector below is what subscribes the form to that
 * (`residentModel.ts` documents the version parameter as exactly this
 * subscription marker). A static layer's options never move, and the hook
 * memoises on the model's identity.
 *
 * AN UNIMPLEMENTED TOOL GETS NOTHING. Measure solids and Validate solids need
 * "does this object have a SOLID at this LoD", which nothing in M2 can answer;
 * printing "No solid geometry in this layer" for them would be a verdict on the
 * user's data that the app never reached. Their rows already say the true
 * thing — "Not available yet" — and their forms show no LoD control at all.
 */
import { useMemo } from "react";
import type { Layer } from "../../features/layers/layerStore";
import type { ToolDefinition } from "../../features/processing/types";
import {
  roofLodOptions,
  type LodOption,
} from "../../features/processing/roofGeometrySource";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface LodChoices {
  readonly options: ReadonlyArray<LodOption>;
  /** The tail of an option's label: "2.2 (1,115 buildings <noun>)". */
  readonly noun: string;
  /** Spec §6: the empty select's text, and Run's reason. Null when it fits. */
  readonly emptyReason: string | null;
}

const NO_LOD: LodChoices = { options: [], noun: "", emptyReason: null };

export function useLodOptions(
  tool: ToolDefinition,
  target: Layer | null,
): LodChoices {
  // Subscribes the form to the stream's commits; 0 for a static layer.
  const version = useStreamStore((s) =>
    target === null ? 0 : (s.streams[target.id]?.version ?? 0),
  );
  const model = target?.model ?? null;
  const isStreaming = target?.isStreaming ?? false;
  return useMemo(() => {
    if (!tool.needsLod || !tool.implemented || target === null) return NO_LOD;
    if (tool.id !== "roof-metrics") return NO_LOD;
    const options = roofLodOptions(target);
    return {
      options,
      noun: "with roof surfaces",
      emptyReason:
        options.length === 0 ? "No roof surfaces in this layer" : null,
    };
    // `version` and `model` are the two things that can change the answer: a
    // streaming commit, or a layer whose model was replaced (`mergeAttributes`
    // mints a new one). `target` itself changes identity on every layer patch,
    // so it is deliberately not a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tool.needsLod,
    tool.implemented,
    tool.id,
    target?.id,
    isStreaming,
    model,
    version,
  ]);
}
```

`streamStore.ts` loads under jsdom on this path — `tests/unit/ui/sidebar/LeftPanel.test.tsx` and `tests/unit/features/streaming/streamStore.test.ts` already import it, and it pulls in no `@navaramap/*` barrel. If the project's lint forbids the disable comment, list `target` in the deps and accept the extra recomputation: `roofLodOptions` is a tag walk, and `useToolForm` already recomputes eligibility per render.

- [ ] **Step 5: Fold the LoD into the form's draft**

Order matters here, because `lod` depends on `target`, which depends on the draft. Rename the existing `const draft: ToolDraft = …` ternary's result to `base` (`useToolForm.ts:81-92`, otherwise unchanged), keep `const target = layers.find((l) => l.id === base.targetLayerId) ?? null;` (`:93`), then add below it:

```ts
const lods = useLodOptions(tool, target);
// Spec §6: "Default: the layer's selected LoD when it qualifies, else the
// highest qualifying one." Computed, never written: a `setDraft` from a
// render is a side effect, and the stored draft is the USER's choice — one
// that stops qualifying (they switched target) must not be overwritten in
// the store, only overridden here.
const qualifies = (lod: string | null): boolean =>
  lod !== null && lods.options.some((o) => o.lod === lod);
const defaultLod = qualifies(target?.selectedLod ?? null)
  ? (target?.selectedLod ?? null)
  : (lods.options[0]?.lod ?? null);
const lod = qualifies(stored?.lod ?? null) ? (stored?.lod ?? null) : defaultLod;
const draft: ToolDraft = { ...base, lod };
```

Every line below `:93` already refers to `draft` by that name. Then extend `runReason` (`:150-152`):

```ts
// Precedence, top to bottom: what the TOOL cannot do here (eligibility),
// what the TARGET cannot offer (no qualifying LoD), then the things the user
// can fix in the form — the prefix, the parameters (Task 11), the scope.
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ?? prefixError ?? scopeReason);
```

and add to the returned object (`:165-182`):

```ts
    lodOptions: lods.options,
    lodNoun: lods.noun,
    lodReason: lods.emptyReason,
```

Import `useLodOptions` at the top.

- [ ] **Step 6: Render it**

In `src/ui/processing/ToolView.tsx`, insert between the Layer `<label>` (ends `:126`) and the Scope `<div>` (`:127`):

Insert the CONTENTS of this fragment (the `{…}` expression, not the `<>` wrapper — that is only here so the snippet is valid JSX on its own and formatters leave it alone):

```tsx
<>
  {f.tool.needsLod && f.tool.implemented && (
    <label className="processing-field">
      <span>LoD</span>
      {f.lodOptions.length === 0 ? (
        // §6: "When no LoD qualifies the select shows [the empty text]
        // and Run is disabled with that reason." A disabled select with
        // one unselectable option, not a hidden field: the user has to
        // see WHICH requirement this layer fails.
        <select aria-label="LoD" disabled value="">
          <option value="">{f.lodReason}</option>
        </select>
      ) : (
        <select
          aria-label="LoD"
          value={f.draft.lod ?? ""}
          onChange={(e) => f.setDraft({ lod: e.target.value })}
        >
          {f.lodOptions.map((option) => (
            <option key={option.lod} value={option.lod}>
              {`${option.lod} (${plural(option.features, "building", "buildings")} ${f.lodNoun})`}
            </option>
          ))}
        </select>
      )}
    </label>
  )}
</>
```

`plural` is already imported (`ToolView.tsx:14`).

- [ ] **Step 7: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS, `ToolView.test.tsx` included (Height from extent has `needsLod: false`).

- [ ] **Step 8: Commit**

```bash
git add src/ui/processing/useLodOptions.ts src/ui/processing/useToolForm.ts \
  src/ui/processing/ToolView.tsx tests/unit/ui/processing/lodSelect.test.tsx \
  tests/unit/ui/processing/roofLayerFixture.tsx
git commit -m "feat(processing): the tool form offers the LoDs the target actually has"
```

---

### Task 11: The PARAMETERS section — six checkboxes, a threshold slider, one validation

**Files:**

- Create: `src/ui/processing/RoofMetricsParams.tsx`
- Modify: `src/ui/processing/ToolView.tsx` (the import, a new fieldset between TARGET ending `:181` and OUTPUT starting `:182`, the extension note, and `run()`'s frozen params), `src/ui/processing/useToolForm.ts` (`paramsError`, `extensionNote`, `runReason`), `src/ui/processing/processing.css`
- Modify (comment only): `tests/unit/ui/processing/useToolForm.test.tsx:53-55`
- Test: `tests/unit/ui/processing/RoofMetricsParams.test.tsx`

**Interfaces:**

- Consumes: `ROOF_MEASURES`, `roofParams`, `FLAT_THRESHOLD_MIN`, `FLAT_THRESHOLD_MAX` (Task 7); `ToolDefinition.validateParams`/`normaliseParams` (Task 7); `addRoofLayer` (Task 10).
- Produces: `useToolForm` gains `paramsError: string | null` and `extensionNote: string | null`; `RoofMetricsParams` is a `{ params, onChange }` component, so a second parameterised tool in M3 is a sibling file and one more line in `ToolView`.

**The slider's peer.** `src/app/flatControls.css:237-284` styles **every** `input[type="range"]` in the app, so the control is already on the tokens — no thumb or track CSS may be added here. The layout peer is the Sun & shade sheet's "Time of day" slider (`src/ui/viewport/SunShadeSheet.tsx:142-165`): a `<label>` wrapping the caption, the input with an `aria-label`, and a small muted row under it. Verify the two side by side in the browser at Task 14.

**The `measure-solids` registry mock in `useToolForm.test.tsx` STAYS.** M1 deferred "delete it once a second real tool exists", but Roof metrics is not that tool: it has `needsReader: false` and `extension: null` and is eligible on streaming targets too, so among the ready-table `candidates` (`useToolForm.ts:53-56`) it can no more discriminate one layer from another than Height from extent can. Only a reader-needing or extension-needing tool can, and the first of those is M3's.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/RoofMetricsParams.test.tsx`. Copy `lodSelect.test.tsx`'s ENTIRE header verbatim — the three `vi.mock` blocks (duckdb with Task 1's two keys, `runQueue`, `useLayerCounts` with the mutable `counts` object at `all: 4`), the `toolRegistry` mock that enables `roof-metrics`, every dynamic import including `addRoofLayer` from `./roofLayerFixture`, and its `beforeEach`/`afterEach` reset pair. Then:

```tsx
describe("Roof metrics PARAMETERS (spec §6, §7.1)", () => {
  it("opens with all six measures ticked and the threshold at 5", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      expect(screen.getByLabelText(label)).toBeChecked();
    }
    expect(
      (screen.getByLabelText("Flat threshold") as HTMLInputElement).value,
    ).toBe("5");
  });

  it("prints the columns of the ticked measures, in the spec's order", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.click(screen.getByLabelText("Mean slope (deg)"));
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
  });

  it("blocks Run with 'Pick at least one measure' when nothing is ticked", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getAllByText("Pick at least one measure").length,
    ).toBeGreaterThan(0);
  });

  it("carries the measures and the threshold into the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.params).toEqual({
      measures: ["area", "flatArea", "slope", "azimuth", "surfaces"],
      flatThresholdDeg: 12,
    });
    expect(request.columns.map((c) => c.name)).toEqual([
      "roof_area_m2",
      "roof_flat_m2",
      "roof_slope_deg",
      "roof_azimuth_deg",
      "roof_surfaces_n",
    ]);
  });

  it("freezes the NORMALISED parameters even when the user changed nothing", () => {
    // §6.4: the log is "the reproducible record of the run". An untouched
    // draft is `{}`, and a log reading "Parameters: —" for a run that used six
    // measures and a 5° threshold is not a record of anything.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]![0]!.params).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });

  it("shows the threshold's current value beside the slider", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "0" },
    });
    expect(screen.getByText("0°")).toBeInTheDocument();
  });

  it("explains each measure where the user can read it", () => {
    // §7.1 carries explanations the labels trim ("0-1", "area-weighted", "of
    // the largest non-flat surface"); they land as the label's tooltip.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByLabelText("Flat share").closest("label"),
    ).toHaveAttribute("title", "0-1: the flat area over the total roof area");
    expect(
      screen.getByLabelText("Mean slope (deg)").closest("label"),
    ).toHaveAttribute("title", "Area-weighted over every roof surface");
    expect(
      screen.getByLabelText("Dominant azimuth (deg)").closest("label"),
    ).toHaveAttribute("title", "Of the largest non-flat surface");
  });

  it("offers no PARAMETERS section for a tool that has none", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByText("PARAMETERS")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/RoofMetricsParams.test.tsx
```

Expected: FAIL — no checkbox with any of those labels.

- [ ] **Step 3: Write the section**

Create `src/ui/processing/RoofMetricsParams.tsx`:

```tsx
/**
 * Spec §7.1's parameters: six measure checkboxes and the flat-threshold slider.
 *
 * A component of its own, taking `{ params, onChange }` and touching no store,
 * so §6's "PARAMETERS: tool-specific" stays one conditional in `ToolView`
 * rather than a growing branch inside the form. The next parameterised tool is
 * a sibling file and one more line there.
 *
 * The slider is a bare `input[type="range"]`: `flatControls.css` styles every
 * range input in the app (3 px track, 12 px lime thumb, focus ring), so adding
 * any here would put this one control off the tokens. Its layout follows the
 * Sun & shade sheet's "Time of day" slider — caption, input, a muted value.
 */
import {
  FLAT_THRESHOLD_MAX,
  FLAT_THRESHOLD_MIN,
  ROOF_MEASURES,
  roofParams,
  type RoofMeasure,
} from "../../features/processing/roofMetricsParams";

export function RoofMetricsParams({
  params,
  onChange,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
}) {
  // Normalised on the way in, so an untouched draft (`params: {}`) renders the
  // defaults, and written back WHOLE on every change — the draft then holds an
  // explicit list, which is what makes "untick everything" a state the form can
  // reach at all.
  const current = roofParams(params);
  const ticked = new Set<RoofMeasure>(current.measures);

  const toggle = (key: RoofMeasure) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({
      ...current,
      measures: ROOF_MEASURES.map((m) => m.key).filter((k) => next.has(k)),
    });
  };

  return (
    <>
      <div className="processing-checks">
        {ROOF_MEASURES.map((measure) => (
          // §7.1's parenthetical explanations, which the labels trim, live
          // here: a tooltip the label carries rather than a second muted line
          // under every checkbox.
          <label key={measure.key} title={measure.hint ?? undefined}>
            <input
              type="checkbox"
              checked={ticked.has(measure.key)}
              onChange={() => toggle(measure.key)}
            />
            {measure.label}
          </label>
        ))}
      </div>
      <label className="processing-slider">
        <span>Flat threshold</span>
        <input
          aria-label="Flat threshold"
          type="range"
          min={FLAT_THRESHOLD_MIN}
          max={FLAT_THRESHOLD_MAX}
          step="1"
          value={current.flatThresholdDeg}
          onChange={(e) =>
            onChange({ ...current, flatThresholdDeg: Number(e.target.value) })
          }
        />
        <span className="processing-slider__value">
          {current.flatThresholdDeg}°
        </span>
      </label>
    </>
  );
}
```

- [ ] **Step 4: Validate, and note the extension, in the form**

In `src/ui/processing/useToolForm.ts`, after `prefixError` (`:131-135`):

```ts
// Spec §6: "Validation is inline and blocks Run" — the message comes from the
// tool's own definition, so the rule and the columns it governs live together.
const paramsError = tool.validateParams?.(draft.params) ?? null;
// §6: "Extension note when the tool's extension is not yet loaded."
const ext = tool.extension;
const extensionNote =
  ext !== null && targetCtx.extensionState[ext] !== "loaded"
    ? `Loads the ${ext} extension on first run (about ${ext === "spatial" ? "24 MB" : "1 MB"}, once per session).`
    : null;
```

Put `paramsError` into the precedence chain from Task 10:

```ts
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ?? prefixError ?? paramsError ?? scopeReason);
```

and return both new values beside `prefixError`.

(§6's example sentence ends with a full stop; §5's chip tooltip does not. Each is verbatim to its own section.)

- [ ] **Step 5: Render the fieldset, the note, and freeze the normalised params**

In `src/ui/processing/ToolView.tsx`:

Add the import beside the others at the top:

```tsx
import { RoofMetricsParams } from "./RoofMetricsParams";
```

Between `</fieldset>` (`:181`) and the OUTPUT `<fieldset>` (`:182`):

Again, insert the fragment's CONTENTS, not the `<>` wrapper:

```tsx
<>
  {toolId === "roof-metrics" && (
    <fieldset className="processing-section" disabled={locked}>
      <legend className="processing-group__label">PARAMETERS</legend>
      <RoofMetricsParams
        params={f.draft.params}
        onChange={(params) => f.setDraft({ params })}
      />
      {f.paramsError !== null && (
        <p className="processing-error" role="alert">
          {f.paramsError}
        </p>
      )}
    </fieldset>
  )}
</>
```

At the end of the OUTPUT fieldset, after the replace warning (`:227`):

```tsx
<>
  {/* §6: "Extension note when the tool's extension is not yet loaded" — the
      same sentence the catalogue's chip shows as its tooltip, here as a line
      the user does not have to hover to read. */}
  {f.extensionNote !== null && (
    <p className="processing-note">{f.extensionNote}</p>
  )}
</>
```

And in `run()` (`:74-85`), freeze the NORMALISED bag:

```tsx
      params: f.tool.normaliseParams?.(f.draft.params) ?? f.draft.params,
```

- [ ] **Step 6: Style the two new blocks**

Append to `src/ui/processing/processing.css` after `.processing-radios label` (`:236-241`):

```css
/* §6's two-column checkbox grid. It drops to one column in a narrow panel
   rather than clipping a label — the panel is resizable. */
.processing-checks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px 12px;
  margin-bottom: 10px;
}
.processing-checks label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
/* Caption, slider, value — the Sun & shade sheet's shape. The input itself is
   styled once for the whole app in flatControls.css; nothing here touches it. */
.processing-slider {
  display: grid;
  grid-template-columns: 84px 1fr 28px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.processing-slider > span:first-child {
  color: var(--fg-muted);
}
.processing-slider__value {
  text-align: right;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: Record why the `measure-solids` mock survived**

In `tests/unit/ui/processing/useToolForm.test.tsx`, replace the comment at `:53-55` with:

```ts
/** Measure solids is still M3's, and it is still the only tool whose
 *  eligibility can fail on one ready layer and pass on another (it needs a
 *  reader). M2's Roof metrics needs neither a reader nor an extension and runs
 *  on streaming targets too, so it cannot discriminate the ready-table
 *  `candidates` any more than Height from extent can — this mock stays until a
 *  reader- or extension-needing tool ships. */
```

- [ ] **Step 8: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/processing/RoofMetricsParams.tsx src/ui/processing/ToolView.tsx \
  src/ui/processing/useToolForm.ts src/ui/processing/processing.css \
  tests/unit/ui/processing/RoofMetricsParams.test.tsx \
  tests/unit/ui/processing/useToolForm.test.tsx
git commit -m "feat(processing): Roof metrics' measures and flat threshold in the tool form"
```

---

### Task 12: Switch the tool on

**Files:**

- Modify: `src/features/processing/toolRegistry.ts` (the `roof-metrics` entry's `implemented`)
- Modify: `tests/unit/ui/processing/lodSelect.test.tsx`, `tests/unit/ui/processing/RoofMetricsParams.test.tsx` (drop the registry shim), `tests/unit/features/processing/eligibility.test.ts` (the "still reads Not available yet" test), `tests/unit/ui/processing/CatalogueView.test.tsx` if it used Roof metrics as its disabled-row example
- Test: `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`

This task exists on its own because it is the moment the tool becomes reachable, and it is the one a reviewer should be able to reject without rejecting any of the machinery. Everything it needs — executor, registration, LoD select, parameters, validation — landed in Tasks 8, 10 and 11.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`. Copy `lodSelect.test.tsx`'s header **minus the `toolRegistry` mock** — that omission is the point of this file: it is the only suite that sees the real registry. It renders both `CatalogueView` and `ToolView`, so it needs `useShellStore` in the reset too (the catalogue's row click reaches it through `openToolView`).

```tsx
/**
 * The tool is ON: the catalogue row is enabled against the REAL registry, its
 * executor is wired, and the form it opens is usable end to end. No registry
 * mock — every other Roof metrics suite enables the tool by hand, and this one
 * is what proves the flip actually happened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// …the three vi.mock blocks from lodSelect.test.tsx, verbatim, WITHOUT the
// toolRegistry one…

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { EXECUTORS } = await import("../../../../src/features/processing/tools");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { addRoofLayer } = await import("./roofLayerFixture");
// The side-effect module, so `EXECUTORS` is populated the way a real session
// populates it (`runQueue.ts` imports it; nothing here imports the tool).
await import("../../../../src/features/processing/tools/register");

beforeEach(() => {
  counts.all = 4;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
  useShellStore.getState().requestSection(null);
});

describe("Roof metrics to attributes, switched on", () => {
  it("is registered as an executor", () => {
    expect(EXECUTORS["roof-metrics"]).toBeTypeOf("function");
  });

  it("has an enabled catalogue row on a ready city layer", () => {
    addRoofLayer();
    render(<CatalogueView />);
    const row = screen
      .getByText("Roof metrics to attributes")
      .closest("button")!;
    expect(row).toHaveAttribute("aria-disabled", "false");
    expect(row.textContent).not.toContain("Not available yet");
  });

  it("opens a form that can actually be run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toBeEnabled();
    expect(screen.getByLabelText("Total roof area (m²)")).toBeChecked();
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(vi.mocked(submitRun)).toHaveBeenCalledTimes(1);
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.toolId).toBe("roof-metrics");
    expect(request.lod).toBe("2.2");
    expect(request.params).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/roofMetricsEnabled.test.tsx
```

Expected: FAIL — the row is `aria-disabled="true"` with "Not available yet", there is no LoD combobox, and Run is disabled with the same reason. (`EXECUTORS["roof-metrics"]` already passes: Task 8 wired the executor; `implemented` is a registry flag, not a registration.)

- [ ] **Step 3: Flip it**

In `src/features/processing/toolRegistry.ts`, on the `roof-metrics` entry: `implemented: true`, and delete the comment Task 7 left there.

- [ ] **Step 4: Remove the scaffolding the shim was standing in for**

- `tests/unit/ui/processing/lodSelect.test.tsx` and `RoofMetricsParams.test.tsx`: delete the `vi.mock(".../toolRegistry", …)` block that enabled `roof-metrics`, and nothing else — their imports, `counts` object and reset pair stay. Both suites must pass unchanged against the real registry; if either needs another edit, the flip did not deliver what the mock was standing in for.
- `tests/unit/features/processing/eligibility.test.ts`: delete the "still reads 'Not available yet' until Task 12 switches it on" test, and replace `enabledRoof` with `toolById("roof-metrics")` in the two that used it.
- `tests/unit/ui/processing/CatalogueView.test.tsx`: if its "a disabled row still opens the tool view" case used Roof metrics, repoint it at `measure-solids`, which is still unimplemented.

- [ ] **Step 5: Run the whole suite**

```bash
npx vitest run
npx tsc -b --noEmit
npx vp check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/processing/toolRegistry.ts tests/unit
git commit -m "feat(processing): switch Roof metrics to attributes on"
```

---

### Task 13: Documentation

**Files:**

- Modify: `docs/architecture-notes.md` (the "Processing toolbox seam (M13.1, 2026-09-11)" section), `docs/roadmap.md:605-640`

No tests: this task changes no behaviour. It is its own task because a reviewer should be able to reject the prose without rejecting the code.

- [ ] **Step 1: Extend the architecture note**

Append to the "Processing toolbox seam" section, after Task 1's status paragraph:

```markdown
**A tool's extension loads inside the run, in its own phase (M13.2).** A run
whose tool declares an `extension` calls `ensureExtension` under
`phase: "extension"` before its scope is resolved, and a failed load fails the
run before the executor sees it. Two placement decisions: it sits AFTER the
cheap pre-flight refusals, so a run that cannot succeed never triggers a 24 MB
download; and it sits INSIDE `runOnTableQueue`, so that download blocks table
builds for its duration. The second is the deliberate trade — loading outside
the queue would take the phase out of §6.1's sequence and would let the run
start against a table being rebuilt underneath it. `ensureExtension` cannot be
aborted, so a Cancel pressed during the download is honoured on the far side of
it. No tool in M13.2 declares an extension; the seam exists so M13.3's three_d
and spatial tools are a registry entry and an executor, nothing more.

**Roof metrics is computed app-side, in JS, and measures only what it writes
(M13.2).** Roof area, inclination and azimuth are derived from ring geometry
and exist nowhere in DuckDB, so the tool issues exactly ONE statement — "which
rows are in scope, and which feature does each belong to" — and does everything
else in memory. The table is the authority on rows; `roofGeometrySource.ts` is
the authority on geometry, and it has two halves on purpose: `roofLodOptions`
fills the LoD select from surface TAGS alone (`type`, `lod`) and never calls
`computeRoofMetrics`, while `roofSurfacesAt` measures on demand, memoised per
(object, LoD), so a run touches only its scoped features' contributors at the
one LoD it was given. Features roll up in batches of 500 that yield a macrotask
and check the run's `AbortSignal` through the new `ToolContext.throwIfCancelled`
— the only way a long, query-free executor can be cancelled at all.

**§7's contributor rule is about GEOMETRY, not about roofs.** "If any part of
the feature has geometry [at the chosen LoD], the PARTS are the contributors" —
so a Building with a roof at 2.2 whose BuildingPart has only WALLS at 2.2
selects the part and is then skipped for having no roof. Using the root's roof
instead would report exactly the 3D BAG double-storage the rule exists to
avoid. The FCB records carry `geometryLods` (all surfaces' LoDs, any type)
beside their LoD-tagged `roofMetrics` for this reason alone.

**Two roof aggregations, on purpose.** `domain/roofMetrics/aggregate.ts` keeps
the Details panel's area-weighted CIRCULAR mean azimuth with its hard-coded 1°
flat threshold, and its area-weighted mean slope and surface count agree with
§7. What it cannot give the toolbox is §7's azimuth (the largest non-flat
surface), the user's own threshold, or NULL where a measure could not be
evaluated — so `domain/roofMetrics/roofRollUp.ts` exists beside it rather than
replacing it.

**Style by result gates on values, not on a count.** `RunSummary` carries
`firstColumnNonNull`, computed centrally in `summarise` from the run's first
output column. §6.2 disables the button "when the chosen column is NULL for
every object in the run", which is NOT `measured === 0`: a Roof metrics run
with only Dominant azimuth ticked over flat roofs measures every building and
writes NULL to all of them.
```

- [ ] **Step 2: Refresh the roadmap**

In `docs/roadmap.md`, add after the 13.1 paragraph (`:605-613`):

```markdown
**Milestone 13.2 implemented 2026-09-11** — **Roof metrics to attributes** as
the second tool (LoD select with per-LoD feature counts, six measure
checkboxes, the flat-threshold slider, §7's geometry-keyed contributor rule and
roll-ups, skip accounting by LoD, Style by result on `roof_area_m2`), computed
app-side on every city layer kind including streaming; the "Loading extension"
run phase with `ensureExtension` and the spec's failure copy; and a published
DuckDB status, so the catalogue's capability chips track an extension's state
and offer Retry. Acceptance scenarios 4 and 6, as far as this milestone
reaches, are smoked in `scripts/smoke/processing-m2.md`.
```

Then **fix the stale carried list** (`:615-640`). Remove the item claiming "§6.1 re-validation of an output column that has come to belong to the file itself is not implemented" (`runQueue.ts:419-442` does it), and remove any other item fix wave 1 closed — check each against the code before deleting it, and leave anything you cannot verify. Extend the existing elapsed-timer bullet so it names the new case: "…so it can jump back once — and again at the hand-off from Loading extension to Computing, which re-stamps `startedAt`; the elapsed the finished card reports is measured from the run's real start and does include the download." Then add:

```markdown
- **Streaming (FCB) runs still write to the table only, and that is now a
  DEFERRAL with a design, not a gap.** A streaming layer's `model.objects` is
  empty, so a run's values show in the grid, the filter and exports but not in
  Details, the rule editor or a colour rule — which §7.1 and §8 do ask for.
  Closing it means an attribute-overlay seam in the FCB plugin and worker (so a
  re-fetched cell keeps the values) plus an Undo path; see the M2 plan's Design
  decision (b) and its open question 10.
- **Engine-death recovery (§6.1) is specified but not implemented.** If the
  DuckDB worker dies, the running and queued runs do not fail with "Analytics
  engine stopped", the status bar does not turn Failed, and earlier runs' Undo
  is not disabled with "Unavailable after an engine restart". The mechanism is
  sketched in the M2 plan's "Deferred with design notes"; open question 11.
- **No tool needs an extension yet**, so the muted chip, its Retry link and the
  extension-failure run copy are covered by unit tests and cannot be reached
  through the UI until a three_d or spatial tool ships (13.3). While those
  tools stay `implemented: false`, "Not available yet" outranks the download
  reason on the row, so that sentence is only ever seen as the chip's tooltip.
- The chip tooltips for the loaded and loading states, the LoD option noun
  ("with roof surfaces"), the empty-LoD text, the extension-failure sentences,
  the measure labels, the Roof metrics long description and the card's
  resident-set clause are ADAPTED from the spec's patterns, not verbatim spec
  copy — see the M2 plan's "Open questions for the human".
- Roof metrics' six measures are all ticked by default (the spec states no
  default), and its flat threshold is STRICT, so at 0° a horizontal roof counts
  as not flat.
```

- [ ] **Step 3: Commit**

```bash
npx vp check
git add docs/architecture-notes.md docs/roadmap.md
git commit -m "docs: record M13.2's seams, and refresh the carried-forward list"
```

---

### Task 14: Milestone gate — verification, browser smoke, review

**Files:**

- Create: `scripts/smoke/processing-m2.md`
- Modify: nothing else, unless the gate finds something

- [ ] **Step 1: The full local gate**

```bash
npx vp check
npx tsc -b --noEmit
npx vitest run
cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run
```

All four must pass with no skips added. Record the suite's passing count.

- [ ] **Step 2: Launch the browser**

Follow `scripts/smoke/processing-m1.md`'s "Running it" section verbatim (dev server through `npm run dev -- --port 5199 --host 127.0.0.1`, note the port it actually prints; a hand-launched Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` on `--remote-debugging-port=9333`; `agent-browser connect 9333`). Run the whole scenario in ONE shell call, and dispatch only pressed/released pointer events over the canvas.

- [ ] **Step 3: Scenario 4, as far as M13.2 reaches**

Spec §10 scenario 4: "Streaming layer (delft.fcb): Measure solids is disabled with the FlatCityBuf reason; Roof metrics to attributes and Height from extent run over the resident set and the card says so; moving the camera far enough to rebuild the table marks the run stale."

Record what was observed against each check:

1. Load `fixtures/delft.fcb`. Open Tools.
2. **Measure solids** reads `"Not available yet"`, **not** the FlatCityBuf reason — `!implemented` outranks eligibility (`eligibility.ts:44`). A **DEVIATION**, not a failure; it resolves in 13.3.
3. **Roof metrics to attributes** is enabled. Open it: the LoD select offers the stream's rungs with feature counts, the streaming note reads "Runs over the N currently loaded buildings, not the whole dataset.", and the columns line reads the six names.
4. Run it. The card reports N buildings measured, the detail line opens with "Over the resident set: the buildings loaded when the run started." and, if any, continues with "M skipped: M no roof surfaces at LoD X".
5. Open table: the six columns carry the computed badge, sort and filter. **Details shows none of them** — the deferred FCB write-back; record it as an unmet part of §7.1/§8 and point at open question 10.
6. Pan far enough to rebuild the table; the run's card reads "stale: layer reloaded" and Style by result is disabled with it.
7. Also load `fixtures/two-buildings.city.json` and run Roof metrics at LoD 2.2. The fixture's `NL.IMBAG.Pand.0001` has a BuildingPart with one RoofSurface at 2.2 and the root has two, so §7's contributor rule means the building's `roof_area_m2` is the PART's area alone. Check it against the part's own row — they must be equal, and neither may equal the root's two-surface sum. `NL.IMBAG.Pand.0002` has no part and gets its own. Style by result opens a draft rule on `roof_area_m2 >` the median, and the map does not change until Save.
8. Task 9's gate needs a run whose first column is NULL for every object, and a threshold slider cannot guarantee that (15° does not make an arbitrary roof flat). Use a KNOWN FLAT-ROOF layer instead. Look for one in `fixtures/` first — load each candidate and read the table's `__roofy_mean_slope` column, which is 0 for a flat roof; if none is flat, author a two-building CityJSON with horizontal RoofSurfaces in the run's scratch directory and load it from disk, recording in the recipe how it was made (a smoke fixture, not a repo one). On that layer, untick everything except **Dominant azimuth** and run: every surface is flat, `roof_azimuth_deg` is NULL everywhere, and **Style by result must be disabled with "All values are empty"** rather than opening an editor on a column with no median. Then tick **Total roof area** too and re-run: the first written column is `roof_area_m2`, which has values, and the button is enabled again.

- [ ] **Step 4: Scenario 6, split into what is reachable and what is not**

Spec §10 scenario 6: "Disconnect the network, reload: the tools with a Spatial or 3D chip are disabled with the download reason and a Retry; Roof metrics and Height from extent still run. Reconnect, Retry: the chip loads and the tools enable."

**Reachable — the warm-engine offline case.** Prerequisites, recorded in the smoke file: the page is already loaded, DuckDB-wasm has booted from the CDN, the `cityjson` extension is loaded, and the layer's table is READY. Then:

1. Take the network down (DevTools offline, or `agent-browser`'s CDP `Network.emulateNetworkConditions` with `offline: true`).
2. Run **Roof metrics** and **Height from extent**. Both complete: neither needs the network, and Roof metrics does not even re-read the source.
3. The Spatial and 3D chips still show the cost tooltip; their rows read "Not available yet" — `!implemented` outranks the download reason, so **the download sentence lives on the chip's tooltip and on no row** until 13.3. Record that deviation.

**NOT reachable in M13.2 — the cold offline reload the scenario actually describes.** Label it UNMET in the smoke file with its reasons: `doInit` fetches the worker and the wasm module from jsDelivr (`duckdb.ts:214-227`) and then installs `cityjson` from the community repo, so an offline reload gives a FAILED engine, not a ready one with two unloaded extensions; a reader-backed table cannot be built without `cityjson`; and no shipped tool calls `ensureExtension`, so nothing in the UI can drive an extension into its `failed` state. Scenario 6 becomes fully verifiable when a three_d or spatial tool ships (13.3) **and** the engine's assets are cacheable offline — the second is not in any milestone yet, and the smoke file should say so.

**Verified by unit test only**, and named as such in the record: the muted chip, the download reason as a tooltip, the Retry link calling `ensureExtension`, the re-render on a state change (`tests/unit/ui/processing/extensionChip.test.tsx`), the real publish sequence (`tests/unit/insights/useDuckDBStatus.test.tsx`) and the run-level failure copy (`tests/unit/features/processing/runQueue.test.ts`).

- [ ] **Step 5: The UI consistency check**

With the tool form open on Roof metrics, open the Sun & shade sheet beside it and compare the two sliders: track, thumb, focus ring and disabled opacity must be identical (both come from `flatControls.css:237-284`). Check the checkbox grid against the Scope radios above it (12 px labels, 6 px gaps) and at the panel's narrowest drag — it must fall to one column, not clip. Screenshot both.

- [ ] **Step 6: A performance sanity check on the real fixture**

Open Roof metrics on the largest layer to hand (delft.fcb with a wide camera, or `delft.city.jsonl` if it is loaded) and confirm: opening the LoD select is instant (it reads tags), and a run over All keeps the page responsive — the elapsed ticker keeps ticking and Cancel lands within a second. If either stalls, `ROOF_BATCH_FEATURES` is the one constant to lower; record the number you settled on.

- [ ] **Step 7: Write the record**

Create `scripts/smoke/processing-m2.md` on `processing-m1.md`'s shape: a one-paragraph intro naming the scenarios, a "Last run" table (Date, Branch @ SHA, Browser, Driver, Dev server, DuckDB, Result), the "Running it" recipe including the offline prerequisites from Step 4, then a numbered section per scenario with **what was observed** beside each check and an explicit DEVIATION / NOT REACHABLE label where this milestone cannot deliver the sentence as worded.

- [ ] **Step 8: Codex review**

The diff must include the submodule's own change, which `git diff main...develop` does not show as content — run both:

```bash
git diff main...develop | codex exec -m gpt-6-astra \
  "Review the piped diff for correctness, regressions and missing tests"
git -C packages/cityjson-navara-plugins diff <previous-pin>..HEAD | \
  codex exec -m gpt-6-astra \
  "Review this plugin diff for correctness, regressions and missing tests"
```

**Every MAJOR finding must be resolved before the merge**, as M1's gate required; MINORs are ruled on and recorded. If Codex is unavailable, `claude -p --model opus` is the fallback (see the memory note on codex-cli hangs on this host). Record each finding's ruling in the milestone ledger.

- [ ] **Step 9: Commit and push**

```bash
git add scripts/smoke/processing-m2.md
git commit -m "docs(smoke): record the M13.2 browser smoke"
git push origin develop
```

The pre-push hook runs `vp check`, `tsc -b --noEmit` and `vp test run` (about 40 s). Do not bypass it.

---

## Deferred with design notes

Two things the spec asks for that M13.2 does not build. Neither is a silent gap: each has a mechanism written down here, a roadmap entry (Task 13) and an open question for the human. If either is pulled into M2, it becomes a task between Tasks 12 and 13.

### Engine-death recovery (spec §6.1)

> "If the DuckDB engine itself dies, the running run and every queued run fail with 'Analytics engine stopped', the status bar shows its Failed state, and Retry there restarts the engine and rebuilds every layer table from the in-memory models. Computed columns live in the model too (§8), so they come back on both ordinary and derived layers; what is lost is the copies kept for Undo, so every earlier run shows Undo disabled with 'Unavailable after an engine restart'."

Today nothing detects a dead worker. `duckdb.ts` catches failures inside `doInit` only; a worker that dies AFTER a successful boot leaves `status` reading `ready` and every subsequent query rejecting with whatever the wasm layer says. M13.2's status publication is a prerequisite for the fix but is not the fix.

The mechanism, in the order it would be built:

1. **Detect it in `duckdb.ts`**, the only module that may touch the worker. Subscribe to the `Worker`'s `error` and `messageerror` events when it is created (`duckdb.ts:214-227`), and add a `markEngineDead(reason)` that calls `setStatus({ state: "failed", error: reason })`, clears `db`/`conn`/`initPromise` and resets the `extensions` map to `unloaded`. A query that rejects with the wasm layer's "worker terminated" shape calls it too, because a worker can die without firing `error`.
2. **Fail the runs.** `runQueue` already has the installer pattern for this (`installTargetRemovalWatcher`, `installStaleWatcher`): a third watcher subscribes to the status and, on a transition INTO `failed`, patches every `queued`/`running`/`cancelling` run to `failed` with `"Analytics engine stopped"`, aborts their controllers, and calls `discardUndo` on every run in the history.
3. **Disable the Undos.** A run whose backup table lived in the dead database can never restore anything. Add `RunRecord.undoUnavailableReason: string | null`, set it to `"Unavailable after an engine restart"` for every done run at the same moment, and render it in `RunFooter` and `RecentRuns` exactly as `stale` is rendered.
4. **Retry.** `retryEngine()` already awaits a fresh `initDuckDB` (the memo is cleared) and rebuilds parked tables. What it does NOT do is rebuild tables that were `ready` before the death — they are in the registry, not in `pendingSources`. It would need to re-enqueue every registered layer from its `LayerTableSource`, which for a model-backed layer is `flatRowsFromModel(layer.model)` and therefore carries the computed columns back (§8), and for a reader-backed one is the provider.
5. **Tests.** A `markEngineDead` unit test in `useDuckDBStatus.test.tsx`'s fake-engine style; a runQueue watcher test for the two patched runs; a `retryEngine` test that a `ready` table is rebuilt.

Sized at roughly one Task-1-shaped task plus one runQueue task. **Open question 11** asks whether to pull it into M2.

### The FCB attribute write-back (spec §7.1, §8)

Design decision (b) has the full argument. The mechanism, in outline: `ResidentObjectRecord` gains an app-written attribute overlay; the worker's cell cache keeps it so a re-fetched cell does not drop the values; `FcbStreamLayerHandle` gains `mergeAttributes(map)` and `removeAttributes(names)`; `runQueue`'s publication branch calls that instead of skipping ids the model lacks; `DetailsPanel`, the rule evaluator and `derivedBuildingColumns` read the overlay. It is a worker-protocol change, so it is one submodule commit plus one app commit, with its own tests on both sides. **Open question 10.**

---

## Self-review

**1. Spec coverage.**

| Spec                                                           | Where                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 chip tooltip by state                                       | Task 3                                                                                                                                                                                 |
| §5 muted chip, download reason, Retry link                     | Task 3 (reason already shipped in M1, `eligibility.ts:73-81`; reachable on the chip's tooltip only until 13.3)                                                                         |
| §6 LoD select, counts, default, empty state                    | Task 10 (options from Task 6)                                                                                                                                                          |
| §6 PARAMETERS, "Pick at least one measure"                     | Task 11 (rule from Task 7)                                                                                                                                                             |
| §6 extension note                                              | Task 11, Steps 4-5                                                                                                                                                                     |
| §6 workload note ("Re-reads a 180 MB source…")                 | **Not implemented, deliberately.** It fires "when the target's source is large", and no M2 tool re-reads a source. It belongs with the first reader-backed tool (M3). Listed as a gap. |
| §6.1 "Loading extension (skipped once loaded)"                 | Task 2                                                                                                                                                                                 |
| §6.1 frozen parameters                                         | Task 7 (`normaliseParams`) + Task 11, Step 5                                                                                                                                           |
| §6.1 engine death, "Analytics engine stopped"                  | **Deferred with a written mechanism** — "Deferred with design notes", open question 11                                                                                                 |
| §6.2 Style by result on `roof_area_m2`, "All values are empty" | Task 9 (the gate) + Task 7's column order                                                                                                                                              |
| §6.3 extension-failure copy, offline case                      | Task 2, `extensionFailure`                                                                                                                                                             |
| §6.4 the log as a reproducible record                          | Task 7's `normaliseParams` is what puts the real measures and threshold in it                                                                                                          |
| §7 features-not-rows, contributors (GEOMETRY), roll-ups        | Tasks 4, 6 and 8                                                                                                                                                                       |
| §7.1 parameters, outputs, skip reason, Style by result         | Tasks 7, 8, 11                                                                                                                                                                         |
| §7.1 "the drawer's three synthetic columns stay as they are"   | Nothing touches `columnPolicy.ts:4-6` — verified, no task                                                                                                                              |
| §7.1/§8 streaming results in Details and rules                 | **Deferred with a written mechanism** — Design decision (b), open question 10                                                                                                          |
| §8 "a Building shows the aggregated value, a part its own"     | Task 8's root/part split                                                                                                                                                               |
| §10 scenario 4                                                 | Task 14, Step 3 (two recorded deviations: the Measure solids reason, and Details on a streaming layer)                                                                                 |
| §10 scenario 6                                                 | Task 14, Step 4, split into the warm-engine offline case (verifiable) and the cold reload (UNMET, with its prerequisites)                                                              |

**Known gaps, all deliberate and all named:** §6's workload note; §6's New-layer destination and everything downstream of it; §7.2–§7.7's tools; the FCB attribute write-back; engine-death recovery. The last two carry design notes and open questions 10 and 11 — and they DO block in the sense that a "yes" to either adds tasks to this plan before it can be called a faithful implementation of §7.1 and §6.1. Nothing in Tasks 1–14 depends on either answer, so execution can begin either way; what changes is where the milestone ends.

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N", no "write tests for the above". Every implementation step carries real code. **The test steps are not uniformly complete, and here is exactly where they are not:**

- Written out in full, runnable as given: Task 1 (the engine fake and every case), Task 3 (same fake, full scaffolding), Task 4, Task 6, Task 7, Task 8's pure suite, Task 10's fixture and suite.
- Written as a DIFF against an existing file, which the executor must open: Task 5 (two assertions in `objectRecords.test.ts` and one helper in `streamLayer.test.ts`), Task 9 (`ToolView.test.tsx`'s `doneRun` and the two Style-by-result cases), Task 11's `measure-solids` comment, Task 12's shim removal. Each names the file and the line range.
- Written as "copy this header, then these cases": Task 8's lifecycle suite (from `runQueue.test.ts:1-235`), Task 11 (from `lodSelect.test.tsx`) and Task 12 (the same, minus one block). The alternative — pasting a 90-line mock header three more times — is duplication a reviewer would reject next, but it does mean **those three files are not literally paste-ready**; the executor assembles them.
- Left to the executor's judgement, deliberately: the smoke's flat-roof fixture (Task 14 Step 3 case 8) says how to find or make one but cannot name a file that exists; Task 8's lifecycle suite says to drop the rebuilt-table case if the existing suite already covers it identically.

**3. Type consistency.** Checked end to end:

- `RoofSurfaceMetric` — declared Task 4, produced Task 6, consumed Tasks 8 and 10. Four fields, one file, throughout.
- `rollUpRoofSurfaces(surfaces, flatThresholdDeg) → RoofRollUp | null` — Task 4 declares; Task 8 is its only caller; Task 8's `valueOf` switch covers all six `RoofMeasure` keys with no default, so a seventh measure is a `tsc` error.
- `RoofGeometrySource` — Task 6 declares `has`/`hasGeometryAt`/`roofSurfacesAt`; Task 8's pure suite builds one from two plain maps and the executor gets one from `roofGeometrySource(ctx.layer)`. `roofLodOptions(layer)` takes the layer, not the source, and both apply the same contributor rule.
- `roofParams` / `roofColumnNames` / `ROOF_MEASURES` (now with `hint`) — Task 7 declares; the registry, the executor, the form component and `normaliseParams` all go through them, so the printed column list, the frozen params, the written columns and Style by result's first column cannot disagree. `roofParams` is asserted idempotent, which is what makes freezing a normalised bag safe.
- `LodOption { lod, features }` — Task 6 declares; Task 10's `LodChoices` and `ToolView` consume.
- `ToolDefinition.needsLod` (required), `validateParams?`, `normaliseParams?` — Task 7 adds all three and fills `needsLod` on **all seven** entries in the same step.
- `RunSummary.firstColumnNonNull` and `summarise(result, elapsedMs, { streaming })` — Task 9 adds both; `runQueue`'s two call sites and `RunFooter` are the only consumers, and `tsc` names every test literal that needs the field.
- `ToolContext.throwIfCancelled()` — Task 8 adds it to the interface and to the one `ctx` literal; only `roofMetrics.ts` calls it.
- `subscribeDuckDBStatus` / `getDuckDBStatusVersion` — Task 1 declares in `duckdb.ts`; `useDuckDBStatus.ts` is the only consumer; 26 mock factories gain both keys.
- `ResidentRoofMetrics` and `ResidentObjectRecord.geometryLods` — Task 5 declares; Task 6 consumes; Task 5's Steps 1 and 5 fix the four known producers (`objectRecords.test.ts`'s two assertions, `streamLayer.test.ts`'s helper, and whatever `pnpm typecheck` adds), and Step 6 the two parent-side ones.
- `extensionReason` / `extensionFailure` / `RESIDENT_SET_NOTE` are local to `runQueue.ts` and referenced from no other task.
- Task 2 folds the second `const tool` in `runQueue.ts`'s publication block into the one it declares — flagged in its step, because two bindings of one name in one function body is a compile error.

**What I could not verify, and an executor should check first.** These are the plan's remaining unknowns, each named where it occurs rather than asserted away:

- **`ColumnInfo`'s exact shape.** Task 10's fixture writes `{ name, type, kind: "scalar" }` from `src/insights/columnKind.ts`, copied from `ToolView.test.tsx:18,93-95`. I read that call site, not the interface. Step 1 says to `grep` it first.
- **`useLayerStore.removeAllLayers()` and `useProcessingStore.resetForTest()`** are used in the new suites' `afterEach` because `ToolView.test.tsx:207-222` uses them; I did not re-read their signatures.
- **The "loading" chip assertion may be racy.** `ensureExtension` publishes `loading` before its first await, but whether a render lands between that and the fake's resolution depends on microtask ordering. Task 3 says what to do if it does not (a deferred inside the fake connection) and forbids weakening the assertion to a store read.
- **`ROOF_BATCH_FEATURES = 500`** is a reasoned guess, not a measurement. Task 14 Step 6 is where it gets one.
- **Line numbers move.** Every `file:line` here was read on `develop` @ `3e42958`; two fix waves landed while this plan was being written, and the executor should treat a citation that does not match as a cue to re-read, not as a licence to improvise.
- **The existing plugin suite's other cases** (footprint, volume, bbox-skip, surface-attribute keys) were read once and assumed unaffected by an additive field. `pnpm vitest run packages/navara-flatcitybuf` at Task 5 Step 5 is the check.

## Review residuals (resolve at M2 pre-flight, before Task 1)

The executor of Task 1 resolves this list first, as part of the SDD pre-flight scan, and records each resolution in the M2 ledger.

The plan review loop was capped at two rounds; these are the findings the second re-review (`.superpowers/sdd/2026-09-10-processing-toolbox-m1/m2-plan-rereview2.md`) left open. Line references are into this plan.

- **The chip suite shares a loaded singleton across cases** (plan `1077-1079`, `1136-1148`, `1172-1224`). `duckdb.ts` is a module singleton, so the successful `spatial` load in "says so once the extension is loaded" makes every later failure and Retry case return immediately as `loaded` — `ensureExtension` short-circuits on `extensions[name].state === "loaded"`. Fix: reset modules and re-import the complete consumer/store graph per case (the `beforeEach` pattern Task 1's own suite uses), and use a controlled deferred inside the fake connection to hold the load open for the "loading" assertion (plan `1244-1270`) rather than relying on microtask ordering.

- **The lifecycle fixture's geometry and threshold contradict its assertions** (plan `3600-3618`, `3663`, `3718-3720`, `3741-3762`). `square(..., 30, 45)` lifts one edge by the full width, so the pitched surface's area is `30√2`, not 30 — every sum asserted against 40 is wrong. And `roofParams` clamps `flatThresholdDeg` to `FLAT_THRESHOLD_MAX = 15`, so the "threshold 50" run is a threshold-15 run and its 45° roof stays non-flat, leaving the replacement expectation impossible. Fix: construct a TRUE 30 m² roof at a shallow pitch (for example ~10°, with the ring scaled so the projected area is exactly 30), and make the threshold comparison 5 versus 15 — under 5 it is not flat, under 15 it is.

- **The lifecycle scaffolding still cannot support its cases** (plan `3584-3588`, `3793-3825`). Four defects: the cited `runQueue.test.ts:1-235` stops short of `deferred`, `computedAlready`, `request` and the `beforeEach`/`afterEach` resets, which extend through line 301 — copy through 301. `delete EXECUTORS["roof-metrics"]` in `afterEach` throws away the module's one-time registration, so only the first case has an executor — register the real executor in each `beforeEach` instead. Reassigning `tableInfo` after the preflight has already read the table name triggers no further rebuild check — test the rebuild at the boundary the code actually supports (the head-of-queue re-validation at `runQueue.ts:342-350`). And the stale-watcher case asserts a transition with no prior table-store entry to transition FROM — seed the watcher's initial state before the run. Fix all four, and add cancellation coverage that lands after at least one real CPU batch (a scope large enough to cross `ROOF_BATCH_FEATURES`), asserting that no subsequent batch runs and nothing is published.

- **The empty-LoD assertion has multiple matches** (plan `4442-4448`, `4592-4594`, `4623-4624`). `screen.getByText("No roof surfaces in this layer")` matches both the disabled combobox's only `<option>` and the footer's Run reason, so it throws on multiplicity rather than asserting either. Fix: scope the queries — assert the disabled combobox's option (`within(select).getByRole("option")`) and the footer's reason (`{ selector: "p" }`, as `ToolView.test.tsx` already does for "All values are empty") separately.

- **Surviving false cancellation and Retry explanations, and overclaimed review conclusions** (plan `1368-1371`, `5256-5258`, `3541-3557`, `5483-5503`). Three corrections. The prescribed App comment at `1368-1371` still implies `retryEngine()` on a healthy engine did something the hook now prevents — it says the old optimistic write "was WRONG on the Retry path", which reads as a behaviour change rather than a display fix; state only that the status is no longer written from the component. The prescribed architecture note at `5256-5258` and the Task 8 preamble at `3541-3557` still carry the rationale that `throwIfCancelled` is what makes cancellation correct — `execute` already refuses to publish an aborted run (`runQueue.ts:515`), so the method buys an early exit and responsiveness, nothing more; make both passages say that and only that. And the self-review's "runnable as given" list at `5483-5503` names suites (Task 1's, Task 3's, Task 8's pure suite) whose scaffolding the residuals above show is not in fact complete, and asserts type consistency for symbols verified only at a call site — rewrite both claims to match what was actually checked.

## Open questions for the human

Items 1-9 are strings or defaults this plan PROPOSES because the spec does not state them; the reviewer accepted each, and every one is a one-line change if the answer differs — none of them stops an executor from starting. Items 10 and 11 are SCOPE questions, and they DO need an answer: each names work the spec asks for that this plan defers, and a "yes" to either adds tasks before the milestone can be called complete. Tasks 1-14 do not depend on either answer, so the two can be settled while execution runs.

1. **LoD option noun.** §6's pattern is "2.2 (1,115 buildings with a solid)". Proposed: **"2.2 (1,115 buildings with roof surfaces)"**. _(Reviewer: accept.)_
2. **Empty LoD text.** §6's is "No solid geometry in this layer". Proposed: **"No roof surfaces in this layer"**. _(Reviewer: accept.)_
3. **Chip tooltips for the states §5 does not spell out.** Loaded → **"The spatial extension is loaded"**; loading → **"Loading the spatial extension…"**. The failed tooltip reuses the spec's disabled-row reason verbatim. _(Reviewer: accept.)_
4. **Extension-failure run copy.** Online → **"The three_d extension could not be loaded: HTTP 404"** (DuckDB's own first line appended); offline → **"The three_d extension could not be loaded; it needs a network connection."**, detected with `navigator.onLine === false`, which is advisory (a captive portal reports online). _(Reviewer: keep the advisory sentence and retain the engine error in the log.)_
5. **Measure checkbox labels, and where §7.1's explanations go.** §7.1 lists the measures in running prose. Labels: **"Total roof area (m²)", "Flat roof area (m²)", "Flat share", "Mean slope (deg)", "Dominant azimuth (deg)", "Roof surface count"**. The explanations the labels trim are now PLACED, per the reviewer: each checkbox's `<label>` carries them as its `title` (`RoofMeasureSpec.hint`, Task 7) — **"Surfaces with a slope under the flat threshold"**, **"0-1: the flat area over the total roof area"**, **"Area-weighted over every roof surface"**, **"Of the largest non-flat surface"**; area and count need none. A tooltip rather than a second muted line under every row, because six explanatory lines would be longer than the section they explain. Say if you want them visible instead.
6. **All six measures ticked by default.** _(Reviewer: all six on.)_
7. **The flat threshold is strict** (`inclinationDeg < threshold`), so at 0° a horizontal roof is NOT flat and `roof_flat_m2` is 0. _(Reviewer: strict `<`, matching "under".)_
8. **The Roof metrics long description** — "Writes the roof metrics Roofy already computes as attributes of each building." — is M1's invention, not spec copy (§5 gives only the one-line description). Keep, or replace?
9. **The card's resident-set clause** (§10 scenario 4's "the card says so"): **"Over the resident set: the buildings loaded when the run started."**
10. **The FCB attribute write-back: pull into M2, or defer to M3?** §7.1 and §8 ask for a streaming run's values in Details, the rule editor and colour rules; the M1 ledger parked it _to M2_; this plan defers it again and writes down the mechanism ("Deferred with design notes"). Deferring ships Roof metrics on streaming layers with table-only results — the same shape Height from extent already has. Pulling it in adds a submodule task (worker-protocol change: an attribute overlay on the resident records and the cell cache, plus `mergeAttributes`/`removeAttributes` on the handle) and one app task.
11. **Engine-death recovery (§6.1): pull into M2, or schedule?** The M1 ledger assigned the design to M2 and this plan supplies the design without building it. Roughly one `duckdb.ts`-shaped task (worker `error`/`messageerror` detection, `markEngineDead`) plus one `runQueue` task (a third installer watcher, `undoUnavailableReason`, and `retryEngine` rebuilding already-`ready` tables).
