### Task 29: Milestone gate — verification, browser smoke, review

**Files:** Create `scripts/smoke/processing-m3.md`. Modify whatever the gate finds.

**Interfaces:** None.

**Intent:** The evidence, not the claim. `npx vp check` at 0 errors / 56 warnings; `npx tsc -b --noEmit` clean; the full app suite and the plugin suite green; `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` green. Then the browser smoke on a hand-launched Chromium via `agent-browser connect`, dev server on a free port through `npm run dev`, never 5173, never `agent-browser set viewport`: scenario 2 (Measure solids at LoD 2.2 on `two-buildings` — one feature measured, one skipped "not a solid" by §7's contributor rule — then on `invalid-solid` for the NULL volume and `solid_valid = false`, plus the draft rule and the map unchanged until Save), scenario 3 (a GeoJSON polygon over one building: Join copies its properties and leaves the other NULL with "1 outside every area"; Aggregate writes `buildings_n = 1` and it shows in the records panel), scenario 5's second half (two runs with the same prefix: the second's Undo restores the first's values and the first loses its Undo), scenario 8 (the remote `https://storage.googleapis.com/cityjson/delft.city.jsonl`: volume summed from parts, height as the combined extent, a selected part running on its whole building, the building count unchanged, and Aggregate counting each Building once), and scenarios 10, 11, 12 (the derived city layer, the derived vector layer, and the `" (2)"` rename at publication). Every deviation is recorded in the file, not smoothed over. Finally the Codex `gpt-6-astra` milestone review over the whole branch diff, with its critical findings addressed before the merge.

- [ ] **Step 1: The four automated gates, in order, with their output kept**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vp check                       # expect: 0 errors, 56 warnings
npx tsc -b --noEmit                # expect: silent
# Both suites in the BACKGROUND with their output to a file, per the M2
# process rule, each waited on so its exit status is the recorded result.
npx vitest run > /tmp/m3-gate-app.log 2>&1 &
wait $!; echo "app suite: $?"
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb \
  > /tmp/m3-gate-duckdb.log 2>&1 &
wait $!; echo "duckdb suite: $?"
```

Expected: `app suite: 0` and `duckdb suite: 0`. Both numbers go into the smoke file's "Last run" table; a non-zero one is a gate failure and stops the milestone here.

and the submodule's own two, which the parent's hooks do NOT run:

```bash
cd packages/cityjson-navara-plugins
pnpm typecheck
pnpm vitest run
```

A warning count above 56 is a gate failure, not a note: fix it before going on. Paste the four numbers into the smoke file's "Last run" table.

- [ ] **Step 2: Launch the browser and the dev server**

On this headless host `agent-browser`'s managed Chrome dies, so Chromium is launched BY HAND and connected to (memory: `agent-browser connect 9333`). Run the whole scenario in ONE shell call per scenario; never `agent-browser set viewport`; dispatch only PRESSED/RELEASED pointer events over the canvas.

```bash
# A free port — 5173 is taken by other sessions on this host.
npm run dev -- --port 5210 --strictPort --host 127.0.0.1 &
# Chromium with a real GL stack, on a debugging port agent-browser can find.
<path-to-playwright-chromium> --headless=new --remote-debugging-port=9333 \
  --use-gl=swiftshader --no-sandbox about:blank &
agent-browser connect 9333
```

Read `scripts/smoke/processing-m2.md`'s "Last run" table first: it records the exact binary, flags and port that worked on this host on 2026-09-12, and the two console lines every run of this recipe produces (the dotenvx `.env` warning and THREE's multiple-instances warning) which are NOT the toolbox's business.

- [ ] **Step 3: Scenario 2 — Measure solids, on `two-buildings` and on `invalid-solid`**

§10.2 asks for both halves of §7.2 — a measured solid and an invalid one — and `two-buildings` can only show the first. `NL.IMBAG.Pand.0001` has a MultiSurface PART at LoD 2.2, so by §7's contributor rule the PART is the contributor and the whole FEATURE is skipped "not a solid": its root's invalid Solid is never measured, and there is no "invalid solid shows NULL volume" to see on that layer. That is why Task 1 authors `fixtures/invalid-solid.city.json`, and why this step is two loads.

**First, `fixtures/two-buildings.city.json`.** Open Tools → Measure solids. Check, and record each answer:

1. The LoD select offers `2.2` with the solids noun (**[adapted copy A1]**) and a count of **1** — `0002` qualifies, `0001` does not (its contributor is the MultiSurface part).
2. All four primary measures are ticked, the two elevations are not.
3. Run. The card reads `1 building measured · 1 skipped · …`.
4. Open table: `NL.IMBAG.Pand.0002` has volume **2178** and `solid_valid` **true**, with envelope, footprint and height alongside. `NL.IMBAG.Pand.0001` has NO values at all — it was skipped, not measured with a caveat.
5. The skip's cause is `not a solid`, and the skipped counts add up. `NL.IMBAG.Pand.0001-part1` does not appear as a row of its own: §7 counts FEATURES, and the part is its building's contributor.
6. Style by result: the rule editor opens on a DRAFT on `solid_volume_m3`, and **the map does not change**. Screenshot before and after Save.
7. Save: the map recolours.

**Then `fixtures/invalid-solid.city.json`**, which is §10.2's other half — one Building, no parts, an unclosed Solid at LoD 2.2:

8. The LoD select offers `2.2` with a count of 1.
9. Run. `solid_volume_m3` is **NULL** and `solid_valid` is **false**, while `solid_envelope_m2` (**388**), `solid_footprint_m2` (**80**) and `solid_height_m` (**8.4**, from zmin 0 / zmax 8.4) all have values — §7.2's caveat rule: an invalid solid is still measured for everything but volume.
10. The card carries the caveat segment for it (`1 invalid solid (no volume)`), NOT a skipped count: a caveat and a skip are different states and this is the case that tells them apart.

- [ ] **Step 4: Scenario 3 — the two cross-layer directions**

Drop a GeoJSON polygon covering ONE of the two buildings (write it to the scratch directory first; a `FeatureCollection` with one `Polygon` and a `name` property is enough).

1. **Join attributes by location**, footprint proxy: the covered building gets the polygon's `name`; the other is NULL; the card says `1 outside every area`.
2. **Aggregate buildings per area** with the city layer as SOURCE: the polygon gets `bld_buildings_n = 1`, and it shows in the vector layer's **records panel** with the computed badge, in **Details** for the picked feature, and in **Color by attribute**'s select.

- [ ] **Step 5: Scenario 5's second half — two runs, one prefix**

Run Measure solids on **All**, then again on **Selected** with the SAME prefix, with `NL.IMBAG.Pand.0002` selected — it is the layer's one qualifying feature (step 3), so a run scoped to `0001` would measure nothing and the case would pass for the wrong reason. Check: the second run's card offers Undo and the FIRST card's Undo is gone; pressing the second's Undo restores the first run's values for the selected building (not NULL, and not the second run's values).

- [ ] **Step 6: Scenario 8 — the Delft CityJSONSeq, by URL**

Add `https://storage.googleapis.com/cityjson/delft.city.jsonl` by URL. Check:

1. Measure solids at LoD 2.2 on a FILTERED scope: each Building's `solid_volume_m3` is the SUM of its parts' volumes, and `solid_height_m` is the COMBINED extent (max ridge − min ground), never a sum of part heights.
2. Select a PART and choose scope Selected: the run covers its whole Building.
3. The table's building count is unchanged by any of it.
4. Aggregate over a polygon counts each Building **once**, whatever its part count.

- [ ] **Step 7: Scenarios 10, 11 and 12 — the New layer destination**

10. Measure solids on scope **Matching** with the name `Delft · solids`: a new layer of exactly the matching buildings appears **directly under Delft**, active, with the columns in its table and in Details; **Delft's own table has no new columns**; the card's Zoom to layer flies to it; **Undo removes it**; Save warns `1 derived layer is not saved; export it to keep it`; its Export offers CityParquet and the file holds only its own buildings; and **Measure solids runs on the derived layer** (its table is reader-backed through Delft's source) — that last clause is the one that proves `sourceFeatureIds` reached `readSource`.
11. Aggregate with destination New layer on scope **Selected (2)**: the new vector layer holds **every** area of the target, `bld_buildings_n` (§10.11 writes the suffix `buildings_n` as shorthand; the default prefix is `bld_`) counts only the 2 selected buildings, and the target itself is unchanged.
12. Add a layer named `Delft · solids` by hand, then run Measure solids with the same default name: the form flags the duplicate. Rename to `Delft · solids 2` and Run; **while it is queued**, rename the manual layer to `Delft · solids 2`. The run publishes as `Delft · solids 2 (2)` and the card says so (**[adapted copy A15]**).

- [ ] **Step 8: Write `scripts/smoke/processing-m3.md`**

Copy `scripts/smoke/processing-m2.md`'s structure exactly — a "Last run" table (Date, Branch + SHA, Browser, Driver, Dev server, DuckDB, Result), then one section per scenario with the RECIPE and the OBSERVED values, then a deviations list. Record every deviation rather than smoothing it over; the streaming New-layer refusal is already a known one (scenario 10's streaming variant is **unmet**, by design — Task 20's A2 reason), and anything else the gate finds joins it and goes into Task 28's roadmap list in this task's commit.

- [ ] **Step 9: The Codex milestone review**

```bash
git diff main...develop | codex exec -m gpt-6-astra \
  "Review the piped diff for correctness, regressions and missing tests"
```

Host quirk (memory): codex-cli can hang here. If it does, the fallback reviewer is `claude -p --model opus` over the same piped diff. Address every CRITICAL finding before the merge; record the rest in the handoff rather than in the code.

- [ ] **Step 10: Commit**

```bash
git add scripts/smoke/processing-m3.md docs/roadmap.md
git commit -m "docs: record the milestone 13.3 browser smoke and gate results"
```

## Decisions recorded (2026-09-12)

The repo owner answered the plan's questions at the plan gate, before Task 1. Each answer is binding; the ledger carries them as its first rulings. **There is no longer a "Questions for the repo owner" section** — every question in it has an answer here, and no task may reopen one or gate work on one.

1. **The streaming New-layer deviation — accepted.** The New layer radio is DISABLED for a streaming (FlatCityBuf) target with **[adapted copy A2]**; scenario 10's streaming variant is recorded as unmet at the Task 29 gate. No worker-protocol change in M3.
2. **[adapted copy] A1–A10 — all accepted as proposed** (A1 turned out to be spec-verbatim: §6 already reads "2.2 (1,115 buildings with a solid)").
3. **A distinct rule palette — accepted** (**[adapted copy A9]**), under `cityColors.ts`'s collision rule: `#7cb518` (unchanged first), then `#2563eb`, `#c2410c`, `#7e22ce`, `#0f766e`, `#be185d`, `#b45309`, `#15803d`. Task 26 pins them and extends the collision test; a hex that fails the collision case is replaced and the swap noted at review.
4. **Aggregate's scope radios stay under TARGET** with the muted line (A12 below); **a derived reader-backed layer's Export includes CityParquet** (Task 24's `where` clause); **a small CompositeSolid fixture IS added** — `fixtures/composite-solid.city.json`, authored in Task 1 with its provenance row in `fixtures/README.md` (Task 28), and Task 1 probes the parse, the validity report and `ST_3DVolume` on it. Task 7's roll-up rests on that probed fact and its own unit tests stay app-side.
5. **Further [adapted copy] the expansion raised — all ACCEPTED as proposed**, and all seven are now rows in the front matter's copy table: **A11** `A distance limit must be a positive number` (§6 states the rule, no sentence); **A12** `Scope applies to the source layer's buildings.` (the muted line under Aggregate's radios); **A13** `Name the new layer` (an empty Name at Run); **A14** `A layer is already called that` (a duplicate Name at Run); **A15** `Renamed to "<name>": a layer already had that name` (the card line for the " (2)" rule, §10.12 says only "the card says so"); **A16** the plural Save toast `2 derived layers are not saved; export them to keep them` (§8 gives the singular only); **A17** `Choose a column to summarise` (Aggregate's blocking error beside a row whose operator needs a column and has none, and that row's own placeholder option — §7.6 requires the select and words no message for an unfilled one, and §7.7's accepted `Choose the property to copy` is the same sentence about a property). `Pick at least one measure` is REUSED verbatim for Join's "nothing to write" and Aggregate's empty aggregate list.
6. **Rulings the commander made where two expansion planners diverged** (recorded here so no task re-litigates them): (i) `ToolResult` gains ONE optional caveat channel, declared in Task 7 (the first task that needs it) as `line?: string` and `caveats?: ReadonlyArray<SkipCount>`; `summarise` renders each caveat in the `"<count> <cause>"` form, BETWEEN the measured count and the skipped count — §6.2's own card order (`312 buildings · 37 invalid solids (no volume) · 2.4 s`), which is why a cause carries no number of its own. Tasks 10, 16, 17 and 19 use the same fields and Task 11 declares nothing new on `ToolResult`. (ii) `StyleByResult.operator` and `.value` are declared in Task 9 as `T | ((picked: OutputColumn) => T)` with `resolveStyleOperator`/`resolveStyleValueSource` beside the type; Task 16 only supplies a descriptor. (iii) `ToolDefinition.outputColumns(prefix, params)` stays TWO-argument; a cross-layer tool's copied-field TYPES travel INSIDE the frozen `params` as `fieldTypes` (Task 15's `resolveCrossLayerParams` embeds the source's property types, and `normaliseParams` freezes them), so `RunFooter`'s `tool.outputColumns(run.prefix, run.params)` is exact for every tool and `joinColumns(prefix, params)` loses the third argument. (iv) Task 18 exports the pure document-level merge helper — `mergeGeoDocumentProperties(document, byStableId)`, which the store action `mergeGeoFeatureProperties` wraps — and Task 23 imports and calls it; there is no second copy of the merge. (v) Aggregate's count column is `${prefix}buildings_n` (`bld_buildings_n` with the default prefix); scenario 11's bare `buildings_n` is read as shorthand — cost if wrong: one string. (vi) `Surface.geometryType` is OPTIONAL (`geometryType?: CityJSONGeometryType | null`): absent and `null` both read "unknown", and 21 files of hand-built `Surface` literals stay untouched.

## Self-review

### 1. Spec coverage

| Spec                                                                 | Task                                               |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| §2 engine facts (three_d, spatial, the wasm build)                   | 1 (probes)                                         |
| §3 Source, Destination, derived layer vocabulary                     | 11, 20, 21                                         |
| §6 TARGET's source select                                            | 15                                                 |
| §6 LoD select for the solids tools, counts, empty state, default     | 3, 8, 10                                           |
| §6 PARAMETERS validation (every message)                             | 6, 8, 15                                           |
| §6 OUTPUT "Write to", Name, uniqueness, the " (2)" rule              | 20, 22                                             |
| §6 "What a derived layer is" (all three parent kinds)                | 21, 23; streaming REFUSED per Decisions item 1     |
| §6 extension note                                                    | shipped M2                                         |
| §6 workload note ("Re-reads a 180 MB source…")                       | 5 — the M2 self-review's named gap, closed         |
| §6.1 the "Reading source" phase and its three failure sentences      | 5                                                  |
| §6.1 frozen parameters incl. the destination and name                | 20                                                 |
| §6.1 the single PUBLICATION step and its cancel boundary             | 22                                                 |
| §6.1 removing the target OR the source cancels                       | 11                                                 |
| §6.1 "Analytics engine stopped" off the FIFO                         | 25                                                 |
| §6.2 the done card for both destinations, Zoom to layer              | 22                                                 |
| §6.2 Style by result for all seven tools, map unchanged until Save   | 9, 26                                              |
| §6.2 Undo of a New-layer run and its block reason                    | 22                                                 |
| §6.2 "Open table … scrolled into view"                               | 27                                                 |
| §6.2 caveat vs skipped, the NULL/0/boolean value rule                | 7, 10, 16, 17, 19                                  |
| §6.4 the log as a reproducible record (the proxy row, the write SQL) | 14, 27                                             |
| §7 features-not-rows, contributors, roll-ups                         | 7, 10, 16, 17, 19                                  |
| §7 provenance, the badge, "the rest from …"                          | shipped M1; extended to vector layers in 18        |
| §7 "a table rebuild loses computed columns and marks the run stale"  | shipped M2; the false positive fixed in 27         |
| §7.1 Roof metrics                                                    | shipped M2; the synthetic-column explanation in 27 |
| §7.2 Measure solids                                                  | 6, 7, 8                                            |
| §7.3 Validate solids                                                 | 10                                                 |
| §7.4 Height from extent                                              | shipped M1                                         |
| §7.5 Join attributes by location, CRS and preflight                  | 12, 13, 14, 15, 16                                 |
| §7.6 Aggregate buildings per area, Vector results                    | 15, 18, 19, 23                                     |
| §7.7 Distance to nearest                                             | 15, 17                                             |
| §8 Details, Table, Rules, Export for computed columns                | shipped M1; vector in 18                           |
| §8 Persistence: the snapshot omits a derived layer; the Save toast   | 24                                                 |
| §9 the deferred list                                                 | no task — verified nothing in the index touches it |
| §10 scenarios 2, 3, 5, 8, 10, 11, 12                                 | 29                                                 |
| §10 scenarios 1, 4, 6, 7, 9                                          | shipped in M1 and M2; no M3 task re-opens them     |

**Known gaps, each deliberate, each named and each ACCEPTED by the owner:** the New-layer destination on a STREAMING target (Decisions recorded item 1, with §9's deferral behind it); the FCB attribute write-back (repo owner, 2026-09-11, future consideration — so a streaming run's values still reach the table only, which §7.1 and §8 do ask for); and everything §9 defers. Nothing else in §5-§8 is unaccounted for.

### 2. Placeholder scan

This document is COMPLETE and executable. It carries the header, Global Constraints, the verified facts, the type ledger (both blocks), the copy table, the file map, the design decisions, the recorded owner decisions — and **all 29 task bodies, each with Files, Interfaces, Intent, numbered checkbox steps with the actual code and commands, and its commit**. Three expansion planners wrote those bodies in parallel from the Interfaces blocks and this pass reconciled the seams where they diverged; the rulings are recorded in "Decisions recorded" item 6 and applied everywhere they bite. An executor reading only their own task has everything that task needs.

Scanned across the whole document: no "TBD", no "TODO", no "similar to Task N", no "add appropriate error handling", no "…rest of", no type or function named in one place and left undefined in another, and no commit command carrying an attribution trailer (`Co-Authored-By`, `Claude-Session`) — the Global Constraints forbid them. Every copy string is either verbatim with its spec section or tagged **[adapted copy]** with an ACCEPTED row (A1-A17) behind it, and no task body still describes a string as an open owner question. Every engine fact is either probed (and pinned by Task 1) or cited with file:line.

### 3. Type consistency

Checked end to end against the ledger:

- `OutputColumn` / `ColumnType` — declared in `computedColumns.ts` (existing); Task 4 makes `outputColumns` return it, and Tasks 6, 15, 16, 17, 19 produce it. `ToolView`'s hard-coded `"DOUBLE"` has exactly one remover (Task 4) and no reintroducer.
- `StyleByResult` — Task 9 declares the WHOLE type, including `operator` and `value` as `T | ((picked: OutputColumn) => T)` and the two resolvers `resolveStyleOperator` / `resolveStyleValueSource` beside it (Decisions item 6 (ii)). `pick(written: ReadonlyArray<OutputColumn>) => OutputColumn | null`: Tasks 8, 10, 16, 17, 19 supply one descriptor each; Task 16 is the only one that passes functions, and it changes neither the type nor `RunFooter`. `RunFooter` is the resolvers' only caller.
- `ToolResult.line?: string` / `ToolResult.caveats?: ReadonlyArray<SkipCount>` — Task 7 declares BOTH and makes the ONE `summarise` edit (Decisions item 6 (i)); Task 11 declares nothing and re-edits nothing. `line` is set by Tasks 10, 16 and 19 and by nobody else — it is the tool's OWN first phrase where "N buildings measured" is wrong, never an extra count in front of it, which is why Task 17 deliberately sets none (§7.7's card line IS the default). `caveats` is set by Tasks 10, 16, 17 and 19. A caveat is `{ cause, count }`, never a pre-rendered string: `summarise` prints `"<count> <cause>"`, so a cause carries no number and the singular/plural noun is picked by the same count.
- `ToolDefinition.outputColumns(prefix, params)` — exactly TWO arguments, for all seven tools (Decisions item 6 (iii)). Join's copied-field types reach it through `params.fieldTypes`, embedded by Task 15's `resolveCrossLayerParams` and frozen with the bag; `joinColumns(prefix, params)` reads them back, Task 16's executor types its columns from the SAME place, and `RunFooter`'s `tool.outputColumns(run.prefix, run.params)` is exact with no live store read.
- `Surface.geometryType?: CityJSONGeometryType | null` — OPTIONAL as well as nullable (Decisions item 6 (vi)). Task 2 declares; Task 3 is the one consumer; the 21 files of hand-built `Surface` literals are untouched; `decodeTable.ts` still writes `null` explicitly.
- `derivedLayerName(targetName, toolId, sourceName)` — THREE parameters everywhere (the ledger, Task 20's implementation, and every caller in Tasks 20-23 and the two UI sites), because §6's `"Delft + Zones"` and `"Delft · nearest Roads"` carry the source's name.
- `ToolContext` — Task 11 adds `target` and `source` and keeps `layer`/`table` with their existing meaning, so `heightFromExtent.ts` and `roofMetrics.ts` compile untouched; Tasks 7, 10, 16, 17, 19 read the new fields.
- `FrozenRequest.computeLayerId` — Task 11 declares; every queue-internal `targetLayerId` read moves to it in the same task; no later task reintroduces one.
- `LayerTable.extension` / `.sourceBytes` (Task 5) and `.sourceFeatureIds` (Task 21) — three readers of the parent's source (`readSource`, `resolveScope`, `buildCityParquetSourceSql`) and Task 24 is where the third lands.
- `lodOptionsBy(layer, qualifies)` — Task 3 declares with the contributor-vs-qualifier doc comment; `roofLodOptions` and `solidLodOptions` are its only callers.
- `ProjectedFeature` / `VectorPreflight` — Task 12 declares (including `propertyTypes`); Tasks 13, 16, 17, 19 consume. `geoPropertyTypes` is the one type-inference rule, shared by the form (Task 15) and preflight (Task 12).
- `BuildingProxy` / `buildProxySql` — Task 14 declares; Tasks 15, 16, 17, 19 consume; the log label has one producer.
- `DerivedPlan` / `prepareDerivedCityLayer` / `prepareDerivedVectorLayer` — Tasks 21 and 23 declare; Task 22 is the only caller of `publish()`/`discard()`. `derivedLayerName(targetName, toolId, sourceName)` — THREE parameters, the source name included, because §6's `"Delft + Zones"` and `"Delft · nearest Roads"` carry it — plus `nameTaken` and `disambiguate` are declared in `deriveLayer.ts` by **Task 20**, which is the task that CREATES the module; Tasks 21 and 23 MODIFY it. There is no forward reference and exactly one creator.
- `Layer.derivedFrom` — Task 21 declares as REQUIRED and budgets the test sweep; Tasks 22, 23, 24 read it; `App.tsx:1061-1078` never writes it.
- `mergeGeoFeatureProperties` / `replaceGeoPreparedData` / `mergeGeoDocumentProperties` / `restoreGeoDocumentProperties` — Task 18 declares all four; Task 19 calls the store action, Task 23 calls the exported pure `mergeGeoDocumentProperties`, and `undoRun` is `restoreGeoDocumentProperties`' only caller. There is exactly ONE merge implementation (Decisions item 6 (iv)). `UndoState`'s vector arm carries `previousValues: GeoPreviousValues` — per feature, per COLUMN, with `GEO_PROPERTY_ABSENT` for a property that was not there — and NOT a `preparedData` document snapshot, because §6.2 steals a run's Undo only where two runs share a column.
- `GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>` — Task 11 declares it in `geoLayerStore.ts` and both `ToolTarget`'s and `ToolSource`'s vector arms are that type, because every consumer reads `layer.config.preparedData`, which only the geojson arm has. `execute` narrows once, where `target` is resolved, so nothing downstream casts; `useToolForm`'s local alias is deleted in Task 15. `prepareDerivedVectorLayer` keeps the wider `parent: GeoLayer` on purpose and narrows in its body (`parent.kind === "geojson" ? parent.config.preparedData : undefined`), which is what lets Task 23's tests hand it a bare layer.
- `classifySourceFailure` / `assertSourceIds` / `readerQuery` — Task 5 declares all three in `sourceRead.ts` beside the three §6.1 sentences, so the id-join THRESHOLD (every requested id, never "no match at all") and the source-failure classification exist once. Tasks 7 and 10 consume all three; Tasks 16 and 17 consume `readerQuery` and `assertSourceIds` on the footprint path; Task 19 consumes `readerQuery` only, because its rows are AREAS and there is no returned building-id set to join. No executor re-decides either rule. `sourceRead.ts`'s two extra imports are TYPE-ONLY (`QueryOutcome`, `ToolContext`) and therefore erased; its one new VALUE import is `getDuckDBStatus`, which is what tells a dead engine apart from a refused allocation on `registerBuffer`'s single `false` — the same distinction `vectorTable.ts` makes.
- `YieldControl` / `reprojectGeoLayer` / `encodeProjectedFeatures` — Task 12 declares the first two and Task 13 the third; both walks are ASYNC and yield in bounded batches, calling `control.checkpoint()` (the run's `ctx.throwIfCancelled`) before each yield, and every call site awaits them. `createVectorTable`'s input carries the same optional `control`.
- `RunUndo` — Task 22 declares it as a NESTED union (`{ kind: "columns"; state: UndoState } | { kind: "layer"; … }`), never an intersection: `{ kind: "columns" } & UndoState` is `never` once `UndoState` discriminates on its own `kind`. Task 18 tags the existing city literal `kind: "city"` and adds the vector one; Task 22 wraps BOTH `undoState.set` sites and `discardUndo` checks the outer kind before the inner.
- `publishProvenance` / `stealUndo` — module-private in `runQueue.ts`, lifted out of the city path by Task 18 and called by Task 22's New-layer branch, so the provenance rule and the Undo-steal rule each have one copy.
- `subscribeColumnReveal` / `drainColumnReveals` / `clearColumnReveals` — Task 27 declares all three; the listener returns a BOOLEAN (true = honoured), and the channel retains the latest request per layer until one is acknowledged, because `DataGrid` renders no `<th>` until its first page lands.
- `STREAMING_NO_NEW_LAYER` — [adapted copy A2], declared ONCE in `deriveLayer.ts` by Task 20 and imported by `ToolView.tsx`, `useToolForm.ts` and the queue's head guard, so the disabled radio, the form's `runReason` and the run's refusal cannot drift.
- `newLayerUndoBlock` / `summariseCreated` — Task 22 declares both in `runQueue.ts`; `summariseCreated`'s `features` is `number | null`, and a vector copy passes `null` so §7.6's own head segment survives.
- `nextRuleColor` / `RULE_PALETTE_HEX` — Task 26 declares; `RulesEditor` and `RunFooter` are the two callers.
- `RunSummary.nonNullByColumn: Readonly<Record<string, number>>` — Task 9 replaces `firstColumnNonNull` with it and sweeps the `tests/` fixtures in its own commit, because the styled column is `pick(written)` and for Validate solids that is the LAST one. Tasks 16, 17, 19 and 22 write summary fixtures in the map form. `buildMedianSql` keeps its name and signature and gains the CAST to DOUBLE in the same task; `sqlQuery.test.ts`'s two expectations move with it.
- `LayerTable` literals — Task 5's `extension` / `sourceBytes` land first (Task 9's `addLayer` helper already carries them), and Task 21's `sourceFeatureIds` is swept across the 17 files its Step 4 names, `styleByResult.test.tsx` included. No literal carries a field before the task that adds it.

### 4. What I could not verify, and an expansion planner should check first

- **The CompositeSolid case.** No fixture had one, so Task 1 AUTHORS `fixtures/composite-solid.city.json` and probes it (Decisions recorded item 4). `ST_3DVolume`'s behaviour on a multi-shell solid stays an assumption in Task 7's roll-up until that probe has actually run under `DUCKDB_INTEGRATION=1`; Task 1 is first in the order for exactly this reason.
- **The exact `spatial` statement timings** in the browser. The 24 MB download was measured warm under node; §5's "about 24 MB, once per session" is the spec's own number and the chip already says it.
- **Whether `installStaleWatcher` fires on a DERIVED layer's first table entry.** It keys on a table-name change or `building → ready` (`runQueue.ts:1153-1176`); `adoptLayerTable` writes a `ready` entry with no prior `building` state, which should not trip it — Task 21 asserts that rather than assuming it.
- **How many `tests/` files carry a hand-built `Layer` literal.** Task 21 greps before it starts; the number decides whether `derivedFrom` lands in one commit or two.
- **The browser's behaviour for a BOOLEAN `=` rule in the editor's value input.** The schema, the evaluator and the input's coercion all check out by reading (`dist/index.js:1194-1196`, `RulesEditor.tsx:755-774`); Task 9 pins it with a test and Task 29 sees it on screen.
- **The footprint path's id join on scope "all".** Tasks 16 and 17 call `assertSourceIds(ctx.featureIds ?? [], …)`, and `ctx.featureIds` is `null` for a whole-layer run — so a source that lost objects is caught for a Selected or Matching run and NOT for an "All buildings" one. That is `assertSourceIds`' own documented vacuous case and the same limit §6.1 already states (a source whose content moved under the same ids is undetectable), but it is a real hole and it is written down rather than papered over. Closing it would cost a second statement to list the table's row ids.
- **Whether `readerQuery` should also wrap the AGGREGATE statement's id accounting.** Task 19 uses `readerQuery` but calls no `assertSourceIds`: its rows are the TARGET's areas, so there is no returned building-id set to join the requested one against. A building the file lost is simply absent from the counts. Flagged rather than invented — detecting it needs the proxy relation to distinguish "the reader had no row" from "the row had no LoD 0 geometry", which is a change to `buildFeatureProxySql`'s shape.
- **Line numbers drift.** Every citation was read on `develop` @ `55e4e00`. Treat one that does not match as a cue to re-read.
- **What the second reconciliation changed, for the reviewer's eye.** The front matter now carries every name the three amendment strands added; Tasks 16, 17 and 19 were rewired onto Task 5's source doors (a real code change, not a note); Task 5's `registerBuffer === false` now tells a dead engine from a refused allocation; Task 15's `workloadNote` keeps Task 5's `needsReader` guard, widened to the footprint proxy (new logic, so it lands with its own case in `useToolForm.test.tsx` — footprint shows §6's note, extent rectangle does not); Task 18 tags the city `undoState` literal so Task 22's wrapping edit has something to quote; Task 9's `runQuery` mock records its statements so Task 16's new footer case can read them. Each is small, each is named here, and each is the kind of thing a reviewer should look at first.

## Review residuals (resolve at pre-flight, before each affected task)

The Codex `gpt-6-astra` plan review ran as three strand passes, twice (round 1: 48 findings, all addressed in amendment round 1; round 2: the findings below). The loop is capped at two amendment rounds, so these are carried HERE and resolved at pre-flight: before each affected task is dispatched, the commander either makes the targeted plan edit or carries the finding verbatim into the implementer's dispatch as a requirement, and the task reviewer checks it. Each resolution is a ledger line. Round-1 findings that the round-2 pass marked "Resolved" are closed; the tables in each strand file record that disposition.

Commander's rulings on the residuals that needed a call (recorded in the ledger with their cost):

- **Scope-wide source identity (A1, B1).** The executors compare the reader's returned ids against the ids their own scope-rows read returned — every scoped row, roots and non-contributors included, before the roll-up — never against `ctx.featureIds` (null on "all"). Aggregate validates its source-city read the same way. Self-review §4's "unchanged-id limitation" sentence is corrected: a changed id set is DETECTED, not tolerated.
- **Style-by-result Save from `Color by = Single colour` (C6).** A Style-by-result draft's Save switches the layer to `Color by = Rules` from ANY mode (that is what the user asked to see); a manual rule's Save keeps the existing `ensureRulesMode` behaviour (only `"surface"` flips). Recorded as an M3 decision, not a deviation. Cost if wrong: one flag on the draft.
- **Mixed GeometryCollections (B10).** Implemented, not skipped: the reviewer probed DuckDB 1.5.5 parsing a mixed point/line collection with the expected distance; Task 12 converts every collection and Task 17's engine test pins it.
- **The New-layer branch precedes every This-layer publication (C1, CRITICAL).** Task 22's destination dispatch is inserted BEFORE Task 18's vector publication and the city write path alike; Task 23 tests that Aggregate → New layer leaves the original document unchanged. This is a targeted plan edit made before Task 20 is dispatched.
- **Everything else** is applied as written by the reviewer unless the code contradicts it at pre-flight.

### Strand A (Tasks 1–10) — round 2

Four remaining findings in the [plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md):

1. **MAJOR — Tasks 7/10, lines 5918–5939 and 8558–8577:** Identity checks still cover only contributors. A missing root or non-contributing scoped object escapes detection, contrary to the final ruling in `progress.md:28`. Validate every ID returned by the scope-row query against source IDs, while retaining contributor-only measurement. Add missing-root and missing-non-contributor tests.

2. **MAJOR — Task 5, lines 3267–3289:** The new static `engineAwait` import loads the DuckDB mock before `registerBuffer`, `dropBuffer` and `getDuckDBStatus` initialize. The suite fails during collection. Confirmed with the installed Vitest mock transformer. Dynamically import the exception classes after mock-variable initialization, or initialize those variables through `vi.hoisted`.

3. **MAJOR — Task 8, lines 6421–6427:** `getByText("No solid geometry in this layer")` matches both the disabled option and the footer reason. The test fails with multiple matches. Assert the option separately and use `{ selector: "p" }` for the reason, matching the existing roof-LoD test.

4. **MAJOR — Task 9, lines 6855–6873 and 7568–7581:** The SQL test migration is incomplete. The appended tests never import `buildMostFrequentSql`; additionally, checkout `ToolView.test.tsx:555–557` still expects the uncast median statement. Add the import and update that expectation in Task 9’s commit.

Round-1 reconciliation; numbers below refer to the original findings:

| #   | Status                 | Current plan evidence                                                                                               |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Partly**             | 5939, 8577: partial contributor loss detected; scope-wide ruling still missing.                                     |
| 2   | **Resolved**           | 3961–3968: `instanceof`, preserving exception identity. New test regression above.                                  |
| 3   | **Resolved**           | 4075–4089: raced registration and late-success cleanup.                                                             |
| 4   | **Resolved**           | 4007–4026, 5922, 8562: shared reader classification and logged detail.                                              |
| 5   | **Resolved**           | 4249, 4261–4267, 6661–6673, 8721–8735: narrowed lookup and valid JSX.                                               |
| 6   | **Resolved**           | 7690–7702, 7739–7750: resolved value type and resolver imports.                                                     |
| 7   | **Resolved**           | 1275–1489, 1985, 2030–2035: complete fixtures, corrected property lookup, staging.                                  |
| 8   | **Resolved**           | 2927–2945: roof-bearing fixture.                                                                                    |
| 9   | **Resolved**           | 3387–3388, 4153, 4203–4223, 6094–6100: corrected fixtures and waits.                                                |
| 10  | **Resolved**           | 5281–5293, 8090–8100, 8284–8287: captured SQL and meaningful assertions.                                            |
| 11  | **Resolved**           | 6676–6723: explicit unimplemented definitions.                                                                      |
| 12  | **Resolved**           | 7092–7095, 7381–7382, 16838–16935: seeded runs, evaluator arguments, editor Save and deferred Join coverage.        |
| 13  | **Partly**             | 7580: CAST implemented; existing expectation migration remains incomplete.                                          |
| 14  | **Resolved**           | 8649–8650, 8336–8355: valid count uses `line`; complete summary asserted.                                           |
| 15  | **Resolved by ruling** | Labels retained at 5924/8564; `progress.md:22` accepts them. No spec sentence requires particular statement labels. |

Citation spot-checks matched: plugin `types.ts:105–118`, `parseHelpers.ts:177–189`, `decodeTable.ts:725–733`; app `layerTables.ts:166–182`, `420–436`, `591–628`; `duckdb.ts:724–743`; `columnKind.ts:90–120`; `export.ts:558–578`. The previously incorrect fixture citation now correctly specifies 16 bytes.

The binding no-recovery ruling still deviates from §6.1’s table-rebuild promise; streaming-copy and FCB write-back rulings likewise remain accepted deviations. These decisions are not reopened.

Fix first

### Strand B (Tasks 11–19) — round 2

**Fixes remain before execution.** Line numbers below refer to the [reviewed plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md).

1. **MAJOR — Tasks 16–19, lines 16705–16718, 17547–17554, 20024–20030:** Source-ID validation still contradicts the latest ruling. Join/Distance compare against `ctx.featureIds ?? []`, making All unchecked; Aggregate omits validation. Moreover, the final join restores browsing-table IDs, masking a missing part when another contributor survives. Compare raw reader IDs against independently read scoped table IDs, before feature roll-up. Test missing roots and parts under All, Selected and Matching. Correct Self-review 28624–28625: changed IDs are **not** §6.1’s unchanged-ID limitation.

2. **MAJOR — Task 18, lines 18473–18509:** Queued vector Undo rechecks only layer existence/kind. While it waits, another run can overwrite the same column and revoke its Undo; the captured callback nevertheless erases that newer result. Recheck current `undoable`, retained Undo state and source-document identity inside the FIFO callback. Test overlapping publication while Undo waits, plus relinking.

3. **MAJOR — Task 18, lines 18275–18370:** Publication validates/captures `target.records` before asynchronous computation, then merges into the live document without checking identity. Relinking during computation can overwrite newly introduced source properties and record incorrect previous values. Verify the captured source identity immediately before publication; refuse changed sources and capture rollback values from the verified document.

4. **MAJOR — Tasks 15/18, lines 14289–14307, 13457–13465, 17813–17816, 17953–17964:** Compilation/test defects remain:
   - Registry uses `CrossLayerContext` without importing it.
   - `joinParams` equality expectation omits the newly required `fieldTypes: {}`.
   - Repeated `getState().layers[0]` expressions neither preserve union narrowing nor establish indexed-element existence.

   Add the import, update the expectation, and narrow a captured layer variable before accessing `preparedData`.

5. **MAJOR — Tasks 11/18, lines 9230–9247, 9338–9360, 9797–9810, 18308:** Task 11’s unconditional vector refusal makes its own empty-result “done” test fail. Task 18 removes that refusal but leaves the earlier refusal test expecting failure. Specify both test transitions explicitly so each task’s verification gate passes.

6. **MAJOR — Task 15, lines 15351–15356, 15505–15507, 15594:** When every SOURCE option is disabled, the default source becomes null and its reason disappears. Distance can expose Run with no source; Join shows unrelated parameter errors. Preserve a disabled fallback for explanation and require a non-null source before enabling Run. Test first opening with only loading, failed or empty sources.

7. **MAJOR — Tasks 12/16/17, lines 11187–11202, 16635–16639, 17494:** Frozen-field validation uses keys from **kept geometries only**. An unchanged document with the requested field present solely on a skipped feature incorrectly fails “Layer changed while running”. Validate field existence against all live source records; keep geometry filtering separate. Test this legitimate skipped-feature case.

8. **MAJOR — Tasks 12/13, lines 11135–11141, 11757–11792:** Batching remains unbounded within one large feature: WKT assembly, `JSON.stringify`, encoding and final chunk copying can block Cancel. The final allocation also retains all encoded chunks while copying them, contrary to the memory commentary. Bound work by coordinates/bytes, including serialization and copying; test timer-delivered cancellation on one very large feature.

9. **MAJOR — Task 16, lines 16013, 16480–16481, 16941–16952:** The new engine test has a false expectation. Against this checkout’s **DuckDB 1.5.5**, the specified polygon pair returns `within: true, covered: true`. Keep the accepted `ST_CoveredBy` choice; correct the expectation and explanation. Use a boundary point to demonstrate the predicate distinction.

10. **MAJOR — Task 12, lines 10258, 11094–11121:** Mixed GeometryCollections remain skipped despite §7.7’s “any geometry type”. The limitation is disclosed, but “not probed” does not implement the requirement. Add mixed-collection WKT and an engine test. A local DuckDB 1.5.5 probe successfully parsed a mixed point/line collection and returned the expected distance, 5.

11. **MINOR — Task 15, lines 15024–15087:** Aggregate validation now blocks incomplete rows, but errors remain detached from the offending row. Duplicate output names are also not flagged on the second row as §6 requires. Render row-specific errors, associate them with their controls, and test mixed-validity and duplicate rows.

12. **MINOR — Task 13, line 11317:** `getDuckDBStatus` is cited at `duckdb.ts:196`, which is commentary for engine-death subscriptions. Its declaration is at **240**. Correct the citation.

Round-1 finding disposition:

| Finding | Status   | Current fix / remaining issue                                                                                  |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 1       | Resolved | 14021–14037 preserves the explicit proxy without table context.                                                |
| 2       | Resolved | 12783–12786 applies footprint scope IDs.                                                                       |
| 3       | Resolved | 12833 selects part contributors before root fallback.                                                          |
| 4       | Resolved | Boundary-inclusive predicate supplied; new test defect is finding 9 above.                                     |
| 5       | Partly   | 10964–10982 validates structure; 11118 still rejects mixed collections.                                        |
| 6       | Partly   | 10933–10940 yields during coordinates; serialization remains unbounded.                                        |
| 7       | Partly   | 16635 and 18275 add checks; findings 3 and 7 remain.                                                           |
| 8       | Resolved | 18225–18235, 18346–18366 retain per-column previous values.                                                    |
| 9       | Partly   | 18484 adds FIFO serialization; ownership/document revalidation remains missing.                                |
| 10      | Resolved | 18721–18773 refreshes selection properties by stable ID.                                                       |
| 11      | Resolved | 18647–18680 updates prepared-data category generation too.                                                     |
| 12      | Resolved | 20038–20056 initializes every target feature before overlaying results.                                        |
| 13      | Partly   | 14178 blocks incomplete aggregates; row-local errors remain absent.                                            |
| 14      | Partly   | 15182–15194 orders readiness reasons correctly; default-source handling loses them.                            |
| 15      | Resolved | 9386–9401 introduces the narrowed alias; 15588–15592 retains workload notes.                                   |
| 16      | Partly   | Original fixture/import repairs landed; finding 4 identifies remaining executable-test defects.                |
| 17      | Resolved | 11842–11852 distinguishes confirmed engine failure from registration failure.                                  |
| 18      | Resolved | Log-label ruling accepted; 11960–11974 fixes Distance’s empty-source copy. A17 is expressly accepted at 28533. |

Citation spot-checks also verified [CRS conversion](/data2/hideba/multiroof-viewer/src/scene/cursorCrsReadout.ts:35), [CRS loading](/data2/hideba/multiroof-viewer/src/features/layers/ensureCrs.ts:32), [buffer registration](/data2/hideba/multiroof-viewer/src/insights/duckdb.ts:724), [death racing](/data2/hideba/multiroof-viewer/src/insights/engineAwait.ts:104), [SQL quoting](/data2/hideba/multiroof-viewer/src/insights/sql.ts:28), [stable-ID highlighting](/data2/hideba/multiroof-viewer/src/scene/geoLayerSync.ts:236), and [prepared-document rendering](/data2/hideba/multiroof-viewer/src/scene/geoLayerDescriptions.ts:55). Those references match; the earlier incorrect renderer citation is repaired.

The reconciled result, styling, two-argument column-builder and shared-merge interfaces agree. Accepted copy and predicate rulings are not reopened. The inherited M2 no-recovery ruling differs from §6.1’s recovery sentence; that remains an accepted deviation, not a new request for approval.

Fix first

### Strand C (Tasks 20–29) — round 2

Plan references below are to [the amended plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md). This was a static review; no implementation tests were run.

| Round-1 finding                 | Status             | Amended-plan evidence                                                                                                        |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Retry generation             | Partly             | Correct implementation at 26878; front matter 1140 and documentation 28302 still prescribe pre-boot capture.                 |
| 2. Impossible Undo intersection | Resolved           | Nested union at 23760; both publication sites wrapped at 23789, 23807.                                                       |
| 3. Stale provenance snapshot    | Resolved           | Fresh store read at 23637 before collecting run IDs.                                                                         |
| 4. Streaming retarget           | Resolved           | Form refusal at 21123–21128 and Task 20 execution preflight.                                                                 |
| 5. Bounds and LoD               | Partly             | Bounds at 22751 and complete LoD state at 22857; amended bounds test is incorrect at 22493.                                  |
| 6. Vector name/count            | Partly             | Both-store lookup at 23611 and count correction in Task 23, 25200 onward; destination remains unreachable.                   |
| 7. Ordinary-layer log menu      | Resolved           | Explicit preservation of `undefined` at 25570.                                                                               |
| 8. Retained column reveal       | Partly             | Acknowledgement protocol at 27939–27975; stale pending-request regression remains.                                           |
| 9. Derived write logging        | Partly             | Recorder wired at 27691–27722; failed COMMIT logging remains incomplete.                                                     |
| 10. Stale palette callback      | Resolved           | Click-time store read at 27387–27395. Its regression test still needs repair.                                                |
| 11. Incomplete tests/hooks      | Partly             | Several repairs landed, but missing helpers/imports and an incorrect test path remain below.                                 |
| 12. Source-string FIFO test     | Resolved           | Behavioral queue test at 22514 onward.                                                                                       |
| 13. Invalid-solid fixture       | Resolved           | Task 29, 28415 onward, separates the skipped-part case from the invalid-solid fixture.                                       |
| 14. Log-label copy              | Resolved by ruling | Labels remain at 22648 and 22684; M3 ledger ruling 22 explicitly permits descriptive log labels. No §6.4 sentence is broken. |
| 15. Background suites           | Partly             | App suites backgrounded; Task 29’s full plugin suite remains foreground at 28439.                                            |

1. **CRITICAL — Tasks 22–23, 23561–23580, 25156–25200:** The New-layer branch is inserted into the **city write path**, after Task 18’s vector publication and unconditional return (18311–18410). Aggregate therefore modifies the original vector layer and never reaches `prepareDerivedVectorLayer`; the later vector discrimination also contradicts the narrowed target type. Move destination dispatch before either This-layer publication. Test that Aggregate/New layer leaves the original document unchanged.

2. **MAJOR — Task 20, 21106–21107, 21147–21154:** Cross-strand form integration uses an obsolete city-only contract. Task 15 deliberately makes `target === null` for vector targets (15285), so Aggregate receives an empty suggested name. The replacement `runReason` also drops Task 15’s `targetReason` and `sourceReason` (15529–15530). Use `targetName` and preserve both validation gates.

3. **MAJOR — Task 22, 24451–24462:** The prescribed replacement restores `start(run, column: string)`, but Task 9 defines `start(run, column: OutputColumn, descriptor: StyleByResult)` at 7761. The replacement either cannot match or breaks the revised callers/body. Change only the layer-ID expression within Task 9’s actual signature.

4. **MAJOR — Task 24, 25886–25904:** Only workspace-save serialization filters derived layers. Existing `App.tsx:1498` share serialization includes every URL-backed city layer; derived cities inherit the parent’s `modelRef`. Sharing consequently restores the full parent under the derived name, violating §8’s exclusion from share links. Filter derived layers in the share path and test the decoded share payload.

5. **MAJOR — Task 27, 28173–28194:** `enqueuedVersions` records success before the build succeeds. A failed rebuild can retain the previous ready table (`layerTables.ts:1178–1193`), but subsequent consumer openings now skip that version indefinitely. Track successful versions separately from pending builds; clear pending state on failure. Test failed rebuild → reopen consumer → successful retry without another stream commit.

6. **MAJOR — Task 26, 26922, 27274:** Save delegates entirely to `ensureRulesMode`, which changes only `"surface"`. A Style-by-result draft saved while `"single"` remains visually inactive, contrary to §6.2’s Rules behavior. Switch mode when saving a result draft while preserving manual-rule semantics. Otherwise explicitly record this additional spec deviation; it is absent from the listed M3 rulings.

7. **MAJOR — Tasks 24, 26–27, 25931, 27406–27416, 28009–28046:** The executable-test claim remains false. `tests/unit/insights/sql.test.ts` does not exist—Task 9 explicitly identifies the correct suite. `renderEditor()` and `colorInput()` are undefined, and the palette test presses Save without naming the rule. DataGrid uses `useRef` but the import instructions add only `useCallback` and `useEffect`. Supply complete test code, the real test path, required form input, and all imports.

8. **MAJOR — Task 21, 22484–22494:** The amended bounds test checks the wrong layer. Each publication inserts immediately after the parent, so publishing `whole` puts it at index 1 and moves the subset to index 2. The assertion expects whole-parent bounds from the subset. Locate each copy using the ID returned by `publish()`.

9. **MAJOR — Task 25, 26774–26779:** The post-COMMIT death regression does not establish its claimed timing. `sql.some(DESCRIBE)` can match the forward run’s earlier refresh, so death may occur before Undo reaches its post-COMMIT refresh. Clear the trace before Undo and wait for a dedicated refresh gate after observing Undo’s COMMIT.

10. **MAJOR — Task 27, 27614:** Failed COMMIT returns omit the attempted COMMIT and subsequent rollback: COMMIT is outside the statement loop, and the instructions append it only on success. Record it immediately before invocation; record rollback only when actually issued. Add failure-path assertions, including derived writes.

11. **MINOR — Task 27, 27950–27954:** A newly acknowledged reveal returns without deleting an older pending request for that layer. A later drain can scroll back to the previous run’s columns. Replace pending state before delivery and delete it on acknowledgement; test pending A → immediately honoured B → drain.

12. **MINOR — Tasks 28–29/front matter, 1140, 28302, 28439, 28578:** Documentation contradicts the corrected Retry implementation, the plugin suite still violates the background-only rule, and “Nothing else … is unaccounted for” omits the accepted no-recovery deviation. Correct the boot-order description, background the plugin suite with exit-status collection, and list the deviation accurately.

The binding streaming restriction contradicts §6’s promised static streaming snapshot; the binding M2 no-recovery ruling contradicts §6.1’s promise that Retry rebuilds tables. Those decisions remain accepted, not reopened; the latter needs inclusion in the final coverage accounting.

Citation spot-checks matched `layerTables.ts:80–98`, `:420–436`, `:767–857`; `duckdb.ts:150–187`, `:681–697`, `:724–745`; and `layerStore.ts:327`. The previously incorrect optional-ID fact is corrected. The incorrect test-file reference and nonexistent helper references are reported in finding 7.

Fix first
