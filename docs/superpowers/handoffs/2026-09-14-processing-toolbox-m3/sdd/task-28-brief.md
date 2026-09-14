### Task 28: Documentation

**Files:**

- Modify: `docs/roadmap.md` (Milestone 13: the 13.3 entry, and the "Carried to 13.3 / M3" list emptied of everything this milestone closed), `docs/architecture-notes.md` (an M13.3 section), `fixtures/README.md` (Task 1's TWO new fixtures), `CLAUDE.md` (**only** if a hard rule changed — none is expected).
- Test: none. `npx vp check` formats the tables.

**Interfaces:** None.

**Intent:** The roadmap records what a user can notice, including the deviations: the streaming New-layer refusal, the FCB write-back still out, and whatever the gate finds unmet. The architecture note carries the five M3 seams that are decisions rather than details — the surface geometry tag, the "Reading source" door, the per-run vector table and its `finally`, the derived layer's single publication and `sourceFeatureIds`, and the primitive-level death race — each citing the code. A reviewer rejects it for a roadmap claim the gate did not verify, or for a CLAUDE.md edit with no rule behind it.

**Order.** This task is written BEFORE Task 29 runs and finished AFTER it: the deviations paragraph can only be filled in once the gate has found them. Write everything that does not depend on the smoke first, commit, and amend the deviation lines in Task 29's own commit if the gate changes them. Do not guess a smoke result.

- [ ] **Step 1: Write the roadmap's 13.3 entry**

In `docs/roadmap.md`, directly after the 13.2 paragraph that ends "…(`Processing toolbox seam … M13.2 (2026-09-12)`).", insert:

```markdown
**Milestone 13.3 implemented 2026-09-12** — the toolbox is finished. Five more
tools: **Measure solids** and **Validate solids** (`three_d`, over the reader's
own LoD geometry, with `ST_3DTryFromWKB` and `ST_3DVolume` guarded exactly as
the real engine requires) and the three cross-layer tools — **Join attributes by
location**, **Aggregate buildings per area** and **Distance to nearest**
(`spatial`, with the vector layer reprojected app-side through proj4 and
registered as a per-run table). With them, three seams the toolbox needed: a
**"Reading source"** run phase that re-registers a reader-backed layer's bytes
for the length of one statement, typed output columns, and ONE Style-by-result
descriptor on the tool definition instead of a branch per tool.

The **New layer** destination ships for every implemented tool: a run can write
its results to a derived layer instead of to its target. A derived city layer is
cut from its parent's TABLE and keeps its parent's reader, so it is
reader-backed — every tool, proxy and export format the parent supports works on
the copy — and a derived vector layer is a plain GeoJSON layer. It is prepared
inside the run's own queue slot and published in one step, so a cancel before
that leaves nothing behind; its row is marked "Derived · not saved in
workspaces", and the snapshot omits it entirely (with the active-layer index
repointed at the filtered list).

Also closed, all of them carried from 13.1 and 13.2: every engine await now
settles when the worker dies — the race moved INTO `duckdb.ts`'s primitives, so
the export dialog, the layer counts, the grid query, the map-filter sync, the
Stats tab and the result card's median return a message instead of hanging, with
no call-site edit; `retryEngine` checks the engine generation across its boot;
`undoRun` no longer publishes a restore whose database is gone; rule drafts
rotate an eight-colour palette and no longer set `Color by = Rules` before the
user presses Save; the write step's SQL reaches the run log statement by
statement; Open table scrolls the new columns into view; the drawer's synthetic
roof-area header explains how it differs from the computed `roof_area_m2`; and
the streaming-table sweep compares stream versions, so reopening the toolbox
stops retiring a finished result card as stale.

Acceptance scenarios 2, 3, 5, 8, 10, 11 and 12 were smoked in a real browser:
`scripts/smoke/processing-m3.md`. The M13.3 seams are in
`docs/architecture-notes.md` ("Processing toolbox seam … M13.3 (2026-09-12)").

Carried past 13.3 — things a user can notice today:

- **The New layer destination is refused on a STREAMING target**, with "New
  layer is not available for a streaming layer: its loaded buildings carry no
  geometry to copy." `ResidentObjectRecord` carries no boundaries, so the copy
  §6 describes could hold attributes but render nothing; building geometry from
  resident records is a worker-protocol change, which §9 defers ("Computing on
  layers without a reader"). Scenario 10's streaming variant is therefore unmet.
- **Streaming (FCB) runs still write to the table only** — unchanged, and still
  the repo owner's "future consideration" (M2 plan, Design decision (b)).
- **A dead DuckDB worker is contained but still not recovered from.** Retry
  reboots the engine and rebuilds only the sources parked while it was coming
  up; a table that was `ready` when the worker died stays `failed` until the
  page is reloaded. What 13.3 fixed is that nothing HANGS on that death any
  more, not that the session comes back.
- Everything §9 defers: footprint operations to a new layer, the field
  calculator, city-to-city joins, replay of runs on restore, and computing on
  layers without a reader.
```

- [ ] **Step 2: Empty the carried list of what 13.3 closed**

In the same section, the "Carried to 13.3 / M3" list is now a record of what 13.2 left, not of what is open. Strike through each item this milestone closed, in the style the list already uses for the fixed median (`~~…~~ — fixed at the M2 gate: …`):

- `Two known gaps left in that death path …` → `~~Two known gaps left in that death path~~ — both closed in 13.3: the race moved into `duckdb.ts`'s primitives (`runQuery`, `ddl`, `queryDuckDB`, `registerBuffer`, `readFile`, `dropBuffer`), and `retryEngine`captures`getEngineGeneration()` before its boot.`
- `No rule-colour palette rotation` → `~~No rule-colour palette rotation~~ — closed in 13.3: `RULE_PALETTE_HEX`(eight colours, beginning with the existing new-rule default) and`nextRuleColor(rules)`, used by both the editor's "+ Add rule" and Style by result.`
- `Style by result sets Color by = Rules eagerly` → `~~…~~ — closed in 13.3: `RunFooter`no longer writes`colorBy`; `ensureRulesMode()` at Save is the one writer.`
- and the same treatment for every other item 13.3 closed (the write-step SQL, scroll-into-view, the synthetic roof-area explanation, the stale-on-sweep false positive). **Leave the FCB write-back and the unrecovered engine as they are** — both are still true.

Read the whole list before editing: an item struck through that is still true is the one thing a reviewer must reject this task for.

- [ ] **Step 3: Write the architecture note**

In `docs/architecture-notes.md`, after the `### M13.2 (2026-09-12)` section, add `### M13.3 (2026-09-12)` with the five seams that are DECISIONS, each citing its code:

```markdown
### M13.3 (2026-09-12)

Five seams from the toolbox's last milestone. Each is a decision with a cost if
it is wrong, not a detail.

**Every `Surface` carries the CityJSON geometry type it came from.**
`Surface.geometryType?: CityJSONGeometryType | null`
(`navara-core/src/citymodel/types.ts`), set once in `buildSurface`'s literal from
the geometry being walked (`cityjson/parseHelpers.ts`) — one edit site covering
all five surface-producing cases, and `parseCityObject` is the funnel for
CityJSON, CityJSONSeq and FlatCityBuf alike. It is what makes "has a SOLID at
LoD X" answerable from tags alone, which is the only way to answer it: the LoD
select is drawn before any source is re-read, and nothing may walk a whole
layer's geometry synchronously. CityParquet's independently built surfaces carry
`null` (it has no geometry-type information), which reads as "not a solid" and
matches the eligibility reason a CityParquet layer already gets.

**"Reading source" is a phase, and it holds the bytes for one statement.**
`readSource({ runId, table, lod, signal })`
(`src/features/processing/sourceRead.ts`) mints a VFS name, calls the table's
`SourceProvider` for a FRESH array, registers it, and returns the reader `FROM`
clause plus the LoD column names; the run calls `release()` in a `finally`. The
shape is copied from `export.ts`'s working precedent, including the `dropBuffer`
the moment the parse is done — a 300 MB CityJSON must not sit in the wasm heap
for the length of a compute. The LoD label → column mapping comes from
`LayerTable.lods` (`{ label, suffix }`), never from string surgery: `"0.0"` and
`"0"` are different columns and only the file knows which it has.

**A cross-layer run's vector source is a per-run table, dropped in a `finally`.**
`__src_<runId>`, built from an app-made NDJSON of reprojected features
(`vectorTable.ts`) — the shape `computedColumns.ts` already uses for the write —
and dropped on every exit path: done, failed, cancelled, engine death.
Reprojection is app-side through `crsFromGeodetic` (`scene/cursorCrsReadout.ts`),
the app's single proj4 door; `ST_Transform` exists in the wasm build and is
deliberately not used, so the CRS answer lives in one place and the offline
story does not depend on whether `spatial` ships PROJ data.

**A derived layer is prepared inside the run's own FIFO slot and published in one
step.** `prepareDerivedCityLayer` (`features/processing/deriveLayer.ts`) cuts the
copy from the parent's TABLE — `CREATE TABLE … AS SELECT * FROM <parent> WHERE
COALESCE("feature_id","id") IN (…)`, which works for every parent kind and brings
the parent's computed columns across with their values — and returns a plan whose
`publish()` is one synchronous step (`adoptLayerTable`, the provenance copy,
`addLayer({ insertAfterId })`, `activateLayer`). `enqueueLayerTable` is unusable
here and that is a hard fact: it goes through the same `enqueue` the run is
already inside, so calling it would deadlock. Reader-backedness is then metadata
plus a filter — the copy keeps the parent's `source`/`reader`/`extension`/`lods`
and sets `LayerTable.sourceFeatureIds`, which THREE independent readers of the
parent's source must AND in (`readSource`'s `FROM`, `resolveScope`'s "all",
`buildCityParquetSourceSql`'s `where`) or the copy quietly reads its parent
whole.

**The engine-death race lives in the PRIMITIVE.** `duckdb.ts`'s `runQuery`,
`ddl`, `queryDuckDB`, `registerBuffer`, `readFile` and `dropBuffer` race their
in-flight await against this module's own death signal and return their ordinary
failure value. duckdb-wasm's `onError` clears its pending requests WITHOUT
rejecting them, so a request caught by the death never settles at all;
`layerTables.ts` had solved that for itself by shadowing each primitive, but
`computedColumns.ts`, `export.ts` and every off-queue caller imported the
unraced originals. One change in the primitive fixes them all, with no call-site
edit and no mock-factory sweep — and every future caller by default, which is
what a hazard with no visible symptom needs. The run queue is unchanged and
provably so: `markEngineDead` dispatches listeners synchronously in registration
order, so in `raced(runQuery(sql), signal)` the inner listener resolves a
microtask while `raced`'s rejects synchronously, and `EngineDeadError` still
wins.
```

- [ ] **Step 4: Check the two conditional files**

```bash
git -C . log --oneline develop --not main -- fixtures/ | head
```

Task 1 adds TWO fixtures. Add a row for each to `fixtures/README.md`, in the table's existing shape — name, what it is, what it is FOR, size — plus the provenance line both share: hand-authored for this repo, no third-party source.

- `fixtures/composite-solid.city.json` (Decisions recorded item 4): a minimal CityJSON 2.0 Building whose LoD 2.2 geometry is a CompositeSolid of two unit cubes sharing a face. FOR: the `three_d` CompositeSolid probe and Task 7's roll-up test.
- `fixtures/invalid-solid.city.json`: one Building, no parts, whose LoD 2.2 Solid is NOT closed (two open edges). FOR: every "invalid solid" expectation — Task 7's tests and scenario 2 of the browser smoke. It exists because `two-buildings.city.json` cannot serve: its `NL.IMBAG.Pand.0001` has a MultiSurface PART at LoD 2.2, so by §7's contributor rule the PART is the contributor and the whole FEATURE is skipped "not a solid" — its root's invalid Solid is never measured.

Re-read `CLAUDE.md`'s Hard Rules against this milestone's diff. **No edit is expected**: every M3 constraint is a plan-level rule, and the two that look like candidates are already covered — "`src/insights/duckdb.ts` is the ONLY module that may import `@duckdb/duckdb-wasm`" is unchanged by Task 25 (the race is INSIDE that module), and "Nothing walks a whole layer's geometry synchronously" is unchanged by Task 3 (the tag is read, not the geometry). If a rule genuinely changed, the edit needs its story in `architecture-notes.md` first — that is the file's own rule.

- [ ] **Step 5: Format and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vp check
```

Expected: clean, with the markdown tables reformatted if the editor left them ragged.

```bash
git add docs/roadmap.md docs/architecture-notes.md
git commit -m "docs: record milestone 13.3's seams and what it leaves open"
```
