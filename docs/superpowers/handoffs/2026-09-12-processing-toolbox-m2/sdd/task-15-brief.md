### Task 15: Milestone gate — verification, browser smoke, review

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
5. Open table: the six columns carry the computed badge, sort and filter. **Details shows none of them** — the FCB write-back the repo owner ruled a future consideration; record it as an unmet part of §7.1/§8.
6. Pan far enough to rebuild the table; the run's card reads "stale: layer reloaded" and Style by result is disabled with it.
7. Also load `fixtures/two-buildings.city.json` and run Roof metrics at LoD 2.2. The fixture's `NL.IMBAG.Pand.0001` has a BuildingPart with one RoofSurface at 2.2 and the root has two, so §7's contributor rule means the building's `roof_area_m2` is the PART's area alone. Check it against the part's own row — they must be equal, and neither may equal the root's two-surface sum. `NL.IMBAG.Pand.0002` has no part and gets its own. Style by result opens a draft rule on `roof_area_m2 >` the median, and the map does not change until Save.
8. Task 10's gate needs a run whose first column is NULL for every object, and a threshold slider cannot guarantee that (15° does not make an arbitrary roof flat). Use a KNOWN FLAT-ROOF layer instead. Look for one in `fixtures/` first — load each candidate and read the table's `__roofy_mean_slope` column, which is 0 for a flat roof; if none is flat, author a two-building CityJSON with horizontal RoofSurfaces in the run's scratch directory and load it from disk, recording in the recipe how it was made (a smoke fixture, not a repo one). On that layer, untick everything except **Dominant azimuth** and run: every surface is flat, `roof_azimuth_deg` is NULL everywhere, and **Style by result must be disabled with "All values are empty"** rather than opening an editor on a column with no median. Then tick **Total roof area** too and re-run: the first written column is `roof_area_m2`, which has values, and the button is enabled again.

- [ ] **Step 4: Scenario 6, split into what is reachable and what is not**

Spec §10 scenario 6: "Disconnect the network, reload: the tools with a Spatial or 3D chip are disabled with the download reason and a Retry; Roof metrics and Height from extent still run. Reconnect, Retry: the chip loads and the tools enable."

**Reachable — the warm-engine offline case.** Prerequisites, recorded in the smoke file: the page is already loaded, DuckDB-wasm has booted from the CDN, the `cityjson` extension is loaded, and the layer's table is READY. Then:

1. Take the network down (DevTools offline, or `agent-browser`'s CDP `Network.emulateNetworkConditions` with `offline: true`).
2. Run **Roof metrics** and **Height from extent**. Both complete: neither needs the network, and Roof metrics does not even re-read the source.
3. The Spatial and 3D chips still show the cost tooltip; their rows read "Not available yet" — `!implemented` outranks the download reason, so **the download sentence lives on the chip's tooltip and on no row** until 13.3. Record that deviation.

**NOT reachable in M13.2 — the cold offline reload the scenario actually describes.** Label it UNMET in the smoke file with its reasons: `doInit` fetches the worker and the wasm module from jsDelivr (`duckdb.ts:214-227`) and then installs `cityjson` from the community repo, so an offline reload gives a FAILED engine, not a ready one with two unloaded extensions; a reader-backed table cannot be built without `cityjson`; and no shipped tool calls `ensureExtension`, so nothing in the UI can drive an extension into its `failed` state. Scenario 6 becomes fully verifiable when a three_d or spatial tool ships (13.3) **and** the engine's assets are cacheable offline — the second is not in any milestone yet, and the smoke file should say so.

**Verified by unit test only**, and named as such in the record: the muted chip, the download reason as a tooltip, the Retry link calling `ensureExtension`, the re-render on a state change (`tests/unit/ui/processing/extensionChip.test.tsx`), the real publish sequence (`tests/unit/insights/useDuckDBStatus.test.tsx`) and the run-level failure copy (`tests/unit/features/processing/runQueue.test.ts`).

- [ ] **Step 5: The two deviations, recorded as such**

Neither is a bug; both are the repo owner's rulings, and the smoke file names them so the next reader does not rediscover them as defects.

1. **§7.1/§8 on a streaming layer: results in the table only.** The FCB attribute write-back is a **future consideration** (decision 11). Observed at Step 3 case 5.
2. **§6.1 engine death: contained, not recovered.** Task 4 fails the runs and disables the Undos; the status bar's Retry reboots the engine but does not rebuild the tables that were `ready` when the worker died, so tools stay disabled until the page is reloaded (decision 12). Verified by unit test only — killing a real worker in the smoke is out of reach without devtools surgery, so the smoke records the DESIGN and points at `tests/unit/features/processing/runQueue.test.ts`'s engine-watcher cases and `tests/unit/ui/processing/engineStopped.test.tsx`.

- [ ] **Step 6: The UI consistency check**

With the tool form open on Roof metrics, open the Sun & shade sheet beside it and compare the two sliders: track, thumb, focus ring and disabled opacity must be identical (both come from `flatControls.css:237-284`). Check the checkbox grid against the Scope radios above it (12 px labels, 6 px gaps) and at the panel's narrowest drag — it must fall to one column, not clip. Screenshot both.

- [ ] **Step 7: A performance sanity check on the real fixture**

Open Roof metrics on the largest layer to hand (delft.fcb with a wide camera, or `delft.city.jsonl` if it is loaded) and confirm: opening the LoD select is instant (it reads tags), and a run over All keeps the page responsive — the elapsed ticker keeps ticking and Cancel lands within a second. If either stalls, `ROOF_BATCH_FEATURES` is the one constant to lower; record the number you settled on.

- [ ] **Step 8: Write the record**

Create `scripts/smoke/processing-m2.md` on `processing-m1.md`'s shape: a one-paragraph intro naming the scenarios, a "Last run" table (Date, Branch @ SHA, Browser, Driver, Dev server, DuckDB, Result), the "Running it" recipe including the offline prerequisites from Step 4, then a numbered section per scenario with **what was observed** beside each check and an explicit DEVIATION / NOT REACHABLE label where this milestone cannot deliver the sentence as worded.

- [ ] **Step 9: Codex review**

The diff must include the submodule's own change, which `git diff main...develop` does not show as content — run both:

```bash
git diff main...develop | codex exec -m gpt-6-astra \
  "Review the piped diff for correctness, regressions and missing tests"
git -C packages/cityjson-navara-plugins diff <previous-pin>..HEAD | \
  codex exec -m gpt-6-astra \
  "Review this plugin diff for correctness, regressions and missing tests"
```

**Every MAJOR finding must be resolved before the merge**, as M1's gate required; MINORs are ruled on and recorded. If Codex is unavailable, `claude -p --model opus` is the fallback (see the memory note on codex-cli hangs on this host). Record each finding's ruling in the milestone ledger.

- [ ] **Step 10: Commit and push**

```bash
git add scripts/smoke/processing-m2.md
git commit -m "docs(smoke): record the M13.2 browser smoke"
git push origin develop
```

The pre-push hook runs `vp check`, `tsc -b --noEmit` and `vp test run` (about 40 s). Do not bypass it.

---

## Future consideration: the FCB attribute write-back

One thing the spec asks for that M13.2 does not build, and that the repo owner has ruled a **future consideration** rather than M2 work: §7.1 and §8's promise that a STREAMING run's values reach Details, the rule editor and colour rules. Streaming COMPUTE is in (Task 6 LoD-tags the resident roof metrics; Task 7 reads them), and the results land in the layer's table; what does not follow is the model merge.

The mechanism, for whoever picks it up: `runQueue.ts:575-589` merges a run's values into `layer.model.objects` and skips any id the model lacks, and an FCB layer's `model.objects` is `{}` (`openStreamingLayer.ts:113`). Closing it means an app-written attribute overlay on `ResidentObjectRecord`, kept in the worker's cell cache so a re-fetched cell does not drop the values, plus `mergeAttributes`/`removeAttributes` on `FcbStreamLayerHandle`; `runQueue`'s publication branch then calls that instead of skipping, and `DetailsPanel`, the rule evaluator and `derivedBuildingColumns` read the overlay. It is a worker-protocol change: one submodule commit plus one app commit, with tests on both sides.

Until then a streaming run's values live in the table (grid, filter, sort, export) and nowhere else — the same shape Height from extent already has — and Task 14's roadmap step and Task 15's gate both record it as an unmet part of §7.1/§8.

## Self-review

**1. Spec coverage.**

| Spec                                                           | Where                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 chip tooltip by state                                       | Task 3                                                                                                                                                                                 |
| §5 muted chip, download reason, Retry link                     | Task 3 (reason already shipped in M1, `eligibility.ts:73-81`; reachable on the chip's tooltip only until 13.3)                                                                         |
| §6 LoD select, counts, default, empty state                    | Task 11 (options from Task 7)                                                                                                                                                          |
| §6 PARAMETERS, "Pick at least one measure"                     | Task 12 (rule from Task 8)                                                                                                                                                             |
| §6 extension note                                              | Task 12, Steps 4-5                                                                                                                                                                     |
| §6 workload note ("Re-reads a 180 MB source…")                 | **Not implemented, deliberately.** It fires "when the target's source is large", and no M2 tool re-reads a source. It belongs with the first reader-backed tool (M3). Listed as a gap. |
| §6.1 "Loading extension (skipped once loaded)"                 | Task 2                                                                                                                                                                                 |
| §6.1 frozen parameters                                         | Task 8 (`normaliseParams`) + Task 12, Step 5                                                                                                                                           |
| §6.1 engine death, "Analytics engine stopped"                  | Task 4 — detection, the failed runs and the disabled Undos. Its RECOVERY half (Retry rebuilding every table) is deliberately not built; the gate records the deviation.                |
| §6.2 Style by result on `roof_area_m2`, "All values are empty" | Task 10 (the gate) + Task 8's column order                                                                                                                                             |
| §6.3 extension-failure copy, offline case                      | Task 2, `extensionFailure`                                                                                                                                                             |
| §6.4 the log as a reproducible record                          | Task 8's `normaliseParams` is what puts the real measures and threshold in it                                                                                                          |
| §7 features-not-rows, contributors (GEOMETRY), roll-ups        | Tasks 5, 7 and 9                                                                                                                                                                       |
| §7.1 parameters, outputs, skip reason, Style by result         | Tasks 8, 9, 12                                                                                                                                                                         |
| §7.1 "the drawer's three synthetic columns stay as they are"   | Nothing touches `columnPolicy.ts:4-6` — verified, no task                                                                                                                              |
| §7.1/§8 streaming results in Details and rules                 | **Future consideration** (repo owner, 2026-09-11) — Design decision (b) and the section of that name                                                                                   |
| §8 "a Building shows the aggregated value, a part its own"     | Task 9's root/part split                                                                                                                                                               |
| §10 scenario 4                                                 | Task 15, Step 3 (two recorded deviations: the Measure solids reason, and Details on a streaming layer)                                                                                 |
| §10 scenario 6                                                 | Task 15, Step 4, split into the warm-engine offline case (verifiable) and the cold reload (UNMET, with its prerequisites)                                                              |

**Known gaps, all deliberate, all decided and all named:** §6's workload note (no M2 tool re-reads a source); §6's New-layer destination and everything downstream of it; §7.2-§7.7's tools; the FCB attribute write-back (a future consideration, decision 11); and §6.1's engine-death RECOVERY — Task 4 builds the detection and containment the repo owner asked for, and deliberately not the Retry-rebuilds-every-table half (decision 12). Nothing is left open: each has an owner's ruling behind it, and Task 15's gate records the two that are visible deviations from the spec.

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N", no "write tests for the above". Every implementation step carries real code. **The test steps are not uniformly complete, and here is exactly where they are not:**

- Written out in full, runnable as given: Task 1 (the engine fake and every case), Task 3 (same fake, full scaffolding), Task 5, Task 7, Task 8, Task 9's pure suite, Task 11's fixture and suite.
- Written as a DIFF against an existing file, which the executor must open: Task 6 (two assertions in `objectRecords.test.ts` and one helper in `streamLayer.test.ts`), Task 10 (`ToolView.test.tsx`'s `doneRun` and the two Style-by-result cases), Task 12's `measure-solids` comment, Task 13's shim removal. Each names the file and the line range.
- Written as "copy this header, then these cases": Task 9's lifecycle suite (from `runQueue.test.ts:1-235`), Task 12 (from `lodSelect.test.tsx`) and Task 13 (the same, minus one block). The alternative — pasting a 90-line mock header three more times — is duplication a reviewer would reject next, but it does mean **those three files are not literally paste-ready**; the executor assembles them.
- Left to the executor's judgement, deliberately: the smoke's flat-roof fixture (Task 15 Step 3 case 8) says how to find or make one but cannot name a file that exists; Task 9's lifecycle suite says to drop the rebuilt-table case if the existing suite already covers it identically.

**3. Type consistency.** Checked end to end:

- `RoofSurfaceMetric` — declared Task 5, produced Task 7, consumed Tasks 9 and 11. Four fields, one file, throughout.
- `rollUpRoofSurfaces(surfaces, flatThresholdDeg) → RoofRollUp | null` — Task 5 declares; Task 9 is its only caller; Task 9's `valueOf` switch covers all six `RoofMeasure` keys with no default, so a seventh measure is a `tsc` error.
- `RoofGeometrySource` — Task 7 declares `has`/`hasGeometryAt`/`roofSurfacesAt`; Task 9's pure suite builds one from two plain maps and the executor gets one from `roofGeometrySource(ctx.layer)`. `roofLodOptions(layer)` takes the layer, not the source, and both apply the same contributor rule.
- `roofParams` / `roofColumnNames` / `ROOF_MEASURES` (now with `hint`) — Task 8 declares; the registry, the executor, the form component and `normaliseParams` all go through them, so the printed column list, the frozen params, the written columns and Style by result's first column cannot disagree. `roofParams` is asserted idempotent, which is what makes freezing a normalised bag safe.
- `LodOption { lod, features }` — Task 7 declares; Task 11's `LodChoices` and `ToolView` consume.
- `ToolDefinition.needsLod` (required), `validateParams?`, `normaliseParams?` — Task 8 adds all three and fills `needsLod` on **all seven** entries in the same step.
- `RunSummary.firstColumnNonNull` and `summarise(result, elapsedMs, { streaming })` — Task 10 adds both; `runQueue`'s two call sites and `RunFooter` are the only consumers, and `tsc` names every test literal that needs the field.
- `ToolContext.throwIfCancelled()` — Task 9 adds it to the interface and to the one `ctx` literal; only `roofMetrics.ts` calls it.
- `subscribeDuckDBStatus` / `getDuckDBStatusVersion` — Task 1 declares in `duckdb.ts`; `useDuckDBStatus.ts` is the only consumer; 26 mock factories gain both keys.
- `ResidentRoofMetrics` and `ResidentObjectRecord.geometryLods` — Task 6 declares; Task 7 consumes; Task 6's Steps 1 and 5 fix the four known producers (`objectRecords.test.ts`'s two assertions, `streamLayer.test.ts`'s helper, and whatever `pnpm typecheck` adds), and Step 6 the two parent-side ones.
- `extensionReason` / `extensionFailure` / `RESIDENT_SET_NOTE` are local to `runQueue.ts` and referenced from no other task.
- Task 2 folds the second `const tool` in `runQueue.ts`'s publication block into the one it declares — flagged in its step, because two bindings of one name in one function body is a compile error.

**What I could not verify, and an executor should check first.** These are the plan's remaining unknowns, each named where it occurs rather than asserted away:

- **`ColumnInfo`'s exact shape.** Task 11's fixture writes `{ name, type, kind: "scalar" }` from `src/insights/columnKind.ts`, copied from `ToolView.test.tsx:18,93-95`. I read that call site, not the interface. Step 1 says to `grep` it first.
- **`useLayerStore.removeAllLayers()` and `useProcessingStore.resetForTest()`** are used in the new suites' `afterEach` because `ToolView.test.tsx:207-222` uses them; I did not re-read their signatures.
- **The "loading" chip assertion may be racy.** `ensureExtension` publishes `loading` before its first await, but whether a render lands between that and the fake's resolution depends on microtask ordering. Task 3 says what to do if it does not (a deferred inside the fake connection) and forbids weakening the assertion to a store read.
- **`ROOF_BATCH_FEATURES = 500`** is a reasoned guess, not a measurement. Task 15 Step 6 is where it gets one.
- **Line numbers move.** Every `file:line` here was read on `develop` @ `3e42958`; two fix waves landed while this plan was being written, and the executor should treat a citation that does not match as a cue to re-read, not as a licence to improvise.
- **The existing plugin suite's other cases** (footprint, volume, bbox-skip, surface-attribute keys) were read once and assumed unaffected by an additive field. `pnpm vitest run packages/navara-flatcitybuf` at Task 6 Step 5 is the check.

## Review residuals (resolve at M2 pre-flight, before Task 1)

The executor of Task 1 resolves this list first, as part of the SDD pre-flight scan, and records each resolution in the M2 ledger.

The plan review loop was capped at two rounds; these are the findings the second re-review (`.superpowers/sdd/2026-09-10-processing-toolbox-m1/m2-plan-rereview2.md`) left open. Line references are into this plan.

- **The chip suite shares a loaded singleton across cases** (plan `1077-1079`, `1136-1148`, `1172-1224`). `duckdb.ts` is a module singleton, so the successful `spatial` load in "says so once the extension is loaded" makes every later failure and Retry case return immediately as `loaded` — `ensureExtension` short-circuits on `extensions[name].state === "loaded"`. Fix: reset modules and re-import the complete consumer/store graph per case (the `beforeEach` pattern Task 1's own suite uses), and use a controlled deferred inside the fake connection to hold the load open for the "loading" assertion (plan `1244-1270`) rather than relying on microtask ordering.

- **The lifecycle fixture's geometry and threshold contradict its assertions** (plan `3600-3618`, `3663`, `3718-3720`, `3741-3762`). `square(..., 30, 45)` lifts one edge by the full width, so the pitched surface's area is `30√2`, not 30 — every sum asserted against 40 is wrong. And `roofParams` clamps `flatThresholdDeg` to `FLAT_THRESHOLD_MAX = 15`, so the "threshold 50" run is a threshold-15 run and its 45° roof stays non-flat, leaving the replacement expectation impossible. Fix: construct a TRUE 30 m² roof at a shallow pitch (for example ~10°, with the ring scaled so the projected area is exactly 30), and make the threshold comparison 5 versus 15 — under 5 it is not flat, under 15 it is.

- **The lifecycle scaffolding still cannot support its cases** (plan `3584-3588`, `3793-3825`). Four defects: the cited `runQueue.test.ts:1-235` stops short of `deferred`, `computedAlready`, `request` and the `beforeEach`/`afterEach` resets, which extend through line 301 — copy through 301. `delete EXECUTORS["roof-metrics"]` in `afterEach` throws away the module's one-time registration, so only the first case has an executor — register the real executor in each `beforeEach` instead. Reassigning `tableInfo` after the preflight has already read the table name triggers no further rebuild check — test the rebuild at the boundary the code actually supports (the head-of-queue re-validation at `runQueue.ts:342-350`). And the stale-watcher case asserts a transition with no prior table-store entry to transition FROM — seed the watcher's initial state before the run. Fix all four, and add cancellation coverage that lands after at least one real CPU batch (a scope large enough to cross `ROOF_BATCH_FEATURES`), asserting that no subsequent batch runs and nothing is published.

- **The empty-LoD assertion has multiple matches** (plan `4442-4448`, `4592-4594`, `4623-4624`). `screen.getByText("No roof surfaces in this layer")` matches both the disabled combobox's only `<option>` and the footer's Run reason, so it throws on multiplicity rather than asserting either. Fix: scope the queries — assert the disabled combobox's option (`within(select).getByRole("option")`) and the footer's reason (`{ selector: "p" }`, as `ToolView.test.tsx` already does for "All values are empty") separately.

- **Surviving false cancellation and Retry explanations, and overclaimed review conclusions** (plan `1368-1371`, `5256-5258`, `3541-3557`, `5483-5503`). Three corrections. The prescribed App comment at `1368-1371` still implies `retryEngine()` on a healthy engine did something the hook now prevents — it says the old optimistic write "was WRONG on the Retry path", which reads as a behaviour change rather than a display fix; state only that the status is no longer written from the component. The prescribed architecture note at `5256-5258` and the Task 9 preamble at `3541-3557` still carry the rationale that `throwIfCancelled` is what makes cancellation correct — `execute` already refuses to publish an aborted run (`runQueue.ts:515`), so the method buys an early exit and responsiveness, nothing more; make both passages say that and only that. And the self-review's "runnable as given" list at `5483-5503` names suites (Task 1's, Task 3's, Task 9's pure suite) whose scaffolding the residuals above show is not in fact complete, and asserts type consistency for symbols verified only at a call site — rewrite both claims to match what was actually checked.

## Decisions recorded (2026-09-11)

Every question this plan raised has been answered by the repo owner. Nothing below is open; each line is the decision, and the task that carries it. A string marked **[adapted copy]** is NOT verbatim spec — it is a decided sentence written to the spec's pattern, tagged so a reviewer knows not to look for it in §5-§8.

1. **LoD option noun** — **[adapted copy]** "2.2 (1,115 buildings with roof surfaces)", to §6's "…with a solid" pattern. Task 11.
2. **Empty LoD text** — **[adapted copy]** "No roof surfaces in this layer", to §6's "No solid geometry in this layer". Task 11.
3. **Chip tooltips for the states §5 leaves unstated** — **[adapted copy]** loaded: "The spatial extension is loaded"; loading: "Loading the spatial extension…". The failed tooltip is §5's own disabled-row reason, verbatim. Task 3.
4. **Extension-failure run copy** — **[adapted copy]** online: "The three_d extension could not be loaded: &lt;DuckDB's first error line&gt;"; offline: "The three_d extension could not be loaded; it needs a network connection.", detected with `navigator.onLine === false`. The advisory sentence stands AND the engine's own reason is kept in the run's log as a warning, so a bug report has both. Task 2.
5. **Measure labels, and where §7.1's explanations go** — labels "Total roof area (m²)", "Flat roof area (m²)", "Flat share", "Mean slope (deg)", "Dominant azimuth (deg)", "Roof surface count"; the explanations the labels trim are **[adapted copy]** hover text on each checkbox's `<label>` ("Surfaces with a slope under the flat threshold", "0-1: the flat area over the total roof area", "Area-weighted over every roof surface", "Of the largest non-flat surface"), carried as `RoofMeasureSpec.hint`. Tasks 8 and 12.
6. **All six measures ticked by default.** Tasks 8 and 12.
7. **The flat threshold is strict** (`inclinationDeg < flatThresholdDeg`), matching §7.1's "under": at 0° a horizontal roof is NOT flat and `roof_flat_m2` is 0. Tasks 5 and 9.
8. **The Roof metrics long description stays** — "Writes the roof metrics Roofy already computes as attributes of each building." **[adapted copy]**: M1 wrote it; §5 gives only the one-line catalogue description. Task 8's registry entry keeps it unchanged.
9. **The card's resident-set clause** — **[adapted copy]** "Over the resident set: the buildings loaded when the run started.", the head of a streaming run's detail line (§10 scenario 4's "the card says so"). Task 10.
10. **The CLAUDE.md "ONE writer" rule rewrite** — APPROVED. `duckdb.ts` publishes; `useDuckDBStatus()` is React's one door; `App`'s mirror goes; `retryEngine()` and the sole-importer rule are untouched. Design decision (a); Task 1 commits the rule edit with the code.
11. **The FCB attribute write-back** — NOT in M2; a **future consideration**. Streaming COMPUTE stays (Task 6's LoD tagging, Task 7's source). Design decision (b), the "Future consideration" section, Task 14's roadmap step and Task 15's deviation list.
12. **Engine death** — detection and containment, **NO recovery**. Task 4. The Undo reason is **[adapted copy]** "Unavailable: the analytics engine stopped", because §6.1's own "Unavailable after an engine restart" describes a restart this milestone does not perform. The status bar's Retry is left exactly as it is: it reboots the engine without rebuilding the tables that were `ready` when the worker died, so tools stay disabled until the page is reloaded.
