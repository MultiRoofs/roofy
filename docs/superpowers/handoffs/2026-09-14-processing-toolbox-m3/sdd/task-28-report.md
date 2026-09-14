# Task 28 report — Documentation (M13.3)

Commit: `910a06c` — `docs: record milestone 13.3's seams and what it leaves open`
(no trailers of any kind; amended once from `752b67e` for the four corrections in
"Corrections after the self-review" below, so the branch carries ONE docs commit).
Files: `docs/roadmap.md`, `docs/architecture-notes.md`, `fixtures/README.md`.
No source or test file touched. `CLAUDE.md` NOT edited. Not pushed.

## Corrections after the self-review (all in `architecture-notes.md`)

1. **D7's consequence was mis-attributed** and is now split honestly. The
   `ST_GeomFromGeoJSON(NULL)` half is PROBE-LEVEL: the app never calls
   `ST_GeomFromGeoJSON` at all, and `vectorTable.ts:96-101` gives its own reason
   for `ST_GeomFromText` (the WKT is already in the target's CRS), which is not
   D7. The half with a code consequence is the Z half → per-row `ST_Force2D` in
   `buildProxySql`.
2. "because that guard is synchronous" read as `ensureModelCrsLoadable`'s guard;
   it is `crsFromGeodetic`'s. Pronoun fixed.
3. Two motives I had supplied rather than found are gone: the Style-by-result
   paragraph no longer speculates about what the alternative would cost, and the
   palette paragraph attributes the Save asymmetry to the ruling (Codex round-2
   C6) instead of explaining it.
4. Verified the two signatures I had taken from the plan: `readSource`'s
   parameter object IS `{ runId, table, lod, signal }` (`sourceRead.ts:210-215`),
   and `nextRuleColor` does filter on `rule.enabled !== false`
   (`nextRuleColor.ts:14-20`) — both statements stand as written.

`npx vp check --fix` run on each markdown file, then `npx vp check`:
**0 errors and 56 warnings in 592 files** — exactly the expected result. The
pre-commit hook (`vp staged`) ran green.

## Where the brief and the inputs disagreed — the inputs / the code won

The dispatch said "if the brief contradicts the inputs, the inputs win". Six
places where the brief's literal template was wrong and was NOT copied:

1. **`retryEngine`'s generation bind.** The brief's Step 2 replacement text says
   "`retryEngine` captures `getEngineGeneration()` **before** its boot" — the exact
   error residual C12 names. The code (`layerTables.ts:842-871`) is
   `const booting = bootEngine(); const engine = getEngineGeneration(); await
booting;` — bound AFTER the boot starts, because `doInit` bumps the counter
   synchronously before its first await. Written that way, with the reason and the
   cost of the pre-boot capture, plus the ordering fact that the generation guard
   returns BEFORE `pendingSources.clear()`. Also: `retryEngine` lives in
   `layerTables.ts`, not `duckdb.ts` — the note says so explicitly.
2. **`sourceFeatureIds` readers: TWO, not three.** The brief names
   `readSource`'s `FROM`, `resolveScope`'s "all" and
   `buildCityParquetSourceSql`'s `where`. Task 21's ledger line and the code say
   `readSource` needed no edit: `resolveScope`'s "all" branch (`scope.ts:125`)
   turns `featureIds: null` into the derived table's own row ids, so `readSource`,
   every executor and `buildProxySql` are filtered for free. The second reader is
   `buildCityParquetSourceSql`'s `where` (`insights/sql.ts:810`). Written as two.
3. **`nextRuleColor` is `src/features/rules/nextRuleColor.ts`**, not
   `cityColors.ts` (only `RULE_PALETTE_HEX` is in `cityColors.ts:102`).
4. **The sweep's maps are `builtVersions` + `pendingVersions`**
   (`layerTableLifecycle.ts:105-132`), not the plan's single `enqueuedVersions` —
   Codex round-2 C5's fix. The note names why the split exists (a failed rebuild
   must not pin the version).
5. **`snapshotLayers.ts` is `src/app/`**, and it is the ONE filter for BOTH doors
   (save + share) with the active-index decision in the same function.
6. **Dates are 2026-09-13** in both files (the controller's dispatch overrides the
   brief's 2026-09-12).

Two more corrections of my own, against the code:

- **`settleOnDeath` has five call sites, covering six primitives**: `runQuery`
  (and `ddl`, which delegates to it), `queryDuckDB`, `registerBuffer`, `readFile`,
  `dropBuffer`. Phrased that way rather than as "six wrapped functions".
- **Untagged surfaces are CityParquet's AND CityGML's** (ledger Task 2's accepted
  concern: CityGML app-side surfaces have no reader either). The brief named only
  CityParquet.

## No smoke claim was invented

`scripts/smoke/processing-m3.md` does not exist yet (Task 29 writes it). Per the
brief's Order note I wrote NO scenario list and no "verified in a real browser"
prose in the 13.3 entry. The roadmap says only "Browser acceptance is the
milestone gate's own record: `scripts/smoke/processing-m3.md`", and the notes'
existing acceptance-procedure line gained `processing-m3.md (M13.3)`. Task 29 can
add its verified/unmet scenarios in its own commit without rewriting anything.

## Structure choices

- **Carried list**: followed the dispatch ("the 'Carried to 13.3 / M3' list
  rewritten as 'Carried to M4' with what M3 closed removed and the inputs'
  carried items added") rather than the brief's Step 2 strikethroughs. A single
  `Carried to M4` list; closed items were deleted (including the already-struck
  M2 median), and what is still true was kept.
- **M13.2's prose was not rewritten.** Dated sections are records, the way M13.2
  left M13.1 intact. Each M13.3 paragraph instead names the M13.2 thread it
  closes ("This closes the cost M13.2 carried…", "`layerTables.ts` had solved
  that for itself…").

## Roadmap — the 13.3 entry (four paragraphs + the carried list)

Inserted directly after the 13.2 paragraph. User-visible decisions from the
inputs and where each landed:

| Inputs decision                                                                                                                      | Where |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| All five remaining tools shipped, with their extensions                                                                              | ¶1    |
| The "Reading source" phase, typed output columns, one Style-by-result descriptor                                                     | ¶1    |
| Aggregate's count column `bld_buildings_n`; scope radios under TARGET with the muted line (A12)                                      | ¶1    |
| New layer for every implemented tool; city copies cut from the parent TABLE, reader-backed; vector copies plain GeoJSON              | ¶2    |
| Derived export includes CityParquet (owner ruling)                                                                                   | ¶2    |
| One-step publication, cancel leaves nothing, "Derived · not saved in workspaces", snapshot AND share omit it, active index repointed | ¶2    |
| A derived layer dropped from a SHARE link gets no notice (§8 is Save's)                                                              | ¶2    |
| Engine death: every await settles; the six named consumers return a message                                                          | ¶3    |
| `retryEngine` checks the generation across its boot; `undoRun` no longer publishes a dead restore                                    | ¶3    |
| Palette rotation; `Color by` not set eagerly; Save switches from ANY mode, manual rules keep the surface-only flip                   | ¶3    |
| Write-step SQL in the log; scroll-into-view; the synthetic roof-area header; the version-aware sweep                                 | ¶3    |
| The two deviations a user meets, pointed at the carried list                                                                         | ¶4    |
| Where the seams are documented                                                                                                       | ¶4    |

Carried to M4 — every item under that heading in the inputs is present:

1. New layer refused on a streaming target (A2), scenario 10's streaming variant
   unmet, with the copy verbatim from `STREAMING_NO_NEW_LAYER`.
2. FCB write-back still table-only, still a future consideration.
3. Dead worker contained, not recovered from — plus the sentence C12 asked for:
   accepted as a deviation from §6.1's Retry promise, "first in M2 and again here".
4. `queryParquetBuffer`'s VFS awaits and `ensureExtension`'s in-flight INSTALL/LOAD
   unraced (outside the six primitives).
5. The unbounded contributor-id `IN (…)` list on scope "All" (solids + cross-layer
   footprint), watched at the gate, with the SQL-side fix named.
6. Provenance not cleared on layer REMOVAL (pre-existing; only the rebuild path
   calls `clearLayer`).
7. "Show run log" on a derived row dark once the run leaves the 20-run history
   (ancestry kept on the record).
8. "Minors deferred to the final review are recorded per task in the milestone's
   SDD ledger (… which lives outside the repository)" — worded so the unresolvable
   path is not presented as a repo file.
9. Everything §9 defers (footprint ops to a new vector layer, field calculator,
   city-to-city joins, replay on restore, computing without a reader).

Kept from the old list because still true: cancel granularity (broadened to name
the vector reprojection and NDJSON encoding batches beside Roof metrics'),
"Matching" ids resolved at the queue head, the corrupt-bbox negative height, the
sub-1024px shell overflow.

Deleted because M3 closed them: the two death-path gaps, the struck-through M2
median, palette rotation, eager `Color by`, the stale/undone median draft, the
unexplained synthetic roof area, "five remaining tools are `implemented: false`",
`useLodOptions` answering only for `roof-metrics`, the write-step SQL, and
scroll-into-view.

## Architecture notes — `### M13.3 (2026-09-13)`

Nine seams plus a `#### What real DuckDB 1.5.5 actually does (probes,
2026-09-12/13)` list, placed after the M13.2 section, in the M13.1/M13.2 voice
(each seam a decision with its reason and its cost). Every name was grepped
before it was written:

1. **`Surface.geometryType`** — `navara-core/src/citymodel/types.ts:131`,
   `cityjson/parseHelpers.ts:195`; `solidLodOptions`/`hasSolidAt`
   (`solidGeometrySource.ts`), `SOLID_GEOMETRY_TYPES` (`solidRollUp.ts`);
   optional so 21 literal files stayed untouched (plan (a) / ruling 6(vi));
   CityParquet and CityGML untagged.
2. **"Reading source" is a phase** — `sourceRead.ts:210`, release in a `finally`,
   `export.ts` precedent, `LayerTable.lods` `{label, suffix}` and `lodZeroLabel`;
   the phase enters at `runQueue.ts:1303`, BEFORE `resolveScope` at `:1307`
   (verified — the M13.2 note describes the opposite for its own era, which was
   Task 5's and Task 13's fix; the M13.2 text was left alone).
3. **The guarded solids SQL** — `solidSql.ts:120`/`:140`, D1's CASE guards, D4's
   type keying, `buildSourceIdsSql` for scope-wide identity vs the executor's own
   scope-rows read (residual A1/B1).
4. **One Style-by-result descriptor** — `types.ts:49`/`:179`,
   `resolveStyleOperator` / `resolveStyleValueSource`, no `toolId` in `RunFooter`.
5. **One cross-layer run shape** — `__src_<runId>` (`vectorTable.ts`) dropped in a
   `finally` on every exit path; app-side `reprojectGeoLayer`
   (`vectorSource.ts:445`) through `crsFromGeodetic`
   (`scene/cursorCrsReadout.ts:53`) after `ensureModelCrsLoadable`;
   `ST_Transform` deliberately unused; the building proxy (`buildProxySql` /
   `buildFeatureProxySql`) with D7's per-row `ST_Force2D` and D8's `ST_IsEmpty`
   → `g IS NULL`; D10's `ST_Distance_GEOS`; vector results in
   `config.preparedData` via `mergeGeoFeatureProperties` over
   `mergeGeoDocumentProperties`; vector runs retired by a SOURCE city-table
   rebuild (`computeLayerId` keying) and their Undo revoked on death; D9's
   `fieldTypes` in the frozen params.
6. **The derived layer** — `prepareDerivedCityLayer` (`deriveLayer.ts:191`), the
   CTAS by feature roots, `publish()` as one synchronous step, the
   `enqueueLayerTable` deadlock as a hard fact, `sourceFeatureIds` (`:395`) and
   its TWO readers, `prepareDerivedVectorLayer` (`:488`) holding every target
   area, `src/app/snapshotLayers.ts` as the one filter for both doors, and
   `STREAMING_NO_NEW_LAYER` (`:54`) as the accepted deviation.
7. **The death race in the PRIMITIVE** — `settleOnDeath` (`duckdb.ts:237`), the
   five call sites / six primitives, duckdb-wasm's non-rejecting `onError`, the
   `racedWithDeath` shadows that only covered `layerTables`, the synchronous
   registration-order argument for `EngineDeadError` still winning, the corrected
   `retryEngine`, and the post-COMMIT-death ruling (card stays "done", the
   session `engineStopped` flag governs).
8. **Palette + Color-by-at-Save** — `RULE_PALETTE_HEX` (`cityColors.ts:102`),
   `nextRuleColor` (`features/rules/nextRuleColor.ts:13`), the collision subject
   (chrome, incl. Single colour and Unmatched — commit `c35a6a0`), and the
   deliberate asymmetry between a result draft and a hand-typed rule.
9. **The version-aware sweep** — `builtVersions` + `pendingVersions`
   (`layerTableLifecycle.ts:105-132`) and why the split exists.

### D1–D10, each with its consequence in the code

| Fact                                                                                        | Consequence named in the note                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 uninitialised validation report on a NULL solid                                          | `solidSql.ts:123-150`'s `CASE WHEN s IS NOT NULL`; volume also on `r.is_valid`; `r.code`/`r.message` never selected                                             |
| D2 two overloads → bare NULL is a Binder error                                              | probe-level: the tests cast (`NULL::SOLID_3D`, `NULL::VARCHAR`)                                                                                                 |
| D3 13-field report incl. `orientation_error_count`                                          | `buildSolidValidationSql` selects it as `ori_n`                                                                                                                 |
| D4 CompositeSolid WKB = "GeometryCollection Z"                                              | detection keys on the CityJSON type through `SOLID_GEOMETRY_TYPES`, never `cityjson_wkb_geometry_type`                                                          |
| D5 no `ST_NDims`, `ST_HasZ` exists                                                          | probe-level: Z asserted with `ST_HasZ` in `crossLayer.test.ts`                                                                                                  |
| D6 `ST_Within` interior-only                                                                | `ST_CoveredBy` at `joinByLocation.ts:110` and `aggregatePerArea.ts:109`                                                                                         |
| D7 `ST_GeomFromGeoJSON(NULL)`; Z kept by `ST_Centroid`/`ST_Union_Agg`                       | the NULL half is probe-level (the app never calls `ST_GeomFromGeoJSON`); the Z half is per-row `ST_Force2D` in `buildProxySql`                                  |
| D8 empty `ST_Union_Agg` → `GEOMETRYCOLLECTION EMPTY`; `geometry_lod0_0`; projection pruning | `buildFeatureProxySql`'s `ST_IsEmpty` CASE → `g IS NULL`; `lodZeroLabel` looks the label up in `lods`; pruning is probe-level (`ST_Area(g)` to force the parse) |
| D9 `read_json_auto` quotes late text after 20,480 NULLs                                     | `read_json(…, columns = {…})` at `computedColumns.ts:93`                                                                                                        |
| D10 core `ST_Distance` returns 0 polygon↔polygon                                            | `ST_Distance_GEOS` at `distanceToNearest.ts:128-130`                                                                                                            |

Plus the two carried-in engine facts from the inputs: `mode()`'s tie
non-determinism → `buildMostFrequentSql`'s `ORDER BY "n" DESC, "v" ASC LIMIT 1`
over roots with NULLs excluded (`insights/sql.ts:472`), and the DECIMAL `median()`
`Uint32Array` → every median CASTs to DOUBLE. Log ENTRY labels being descriptive
by M1 precedent is recorded in the ledger and needed no new doc claim beyond what
M13.1's note already says about the log; the A1–A17 copy acceptance is a
plan-level record (the roadmap quotes the two sentences a user actually reads:
`STREAMING_NO_NEW_LAYER` and the Derived row marker).

## `fixtures/README.md`

The file is a bullet list, not a table (the brief said "table"), so both rows
follow `delft.fcb`'s shape: name, size, what it is, provenance, what it is FOR.

- `invalid-solid.city.json` (1.8 KB) — verified by comparison against
  `two-buildings.city.json`: it IS a copy of that fixture's
  `NL.IMBAG.Pand.0001` root (identical boundaries, semantics, the first nine
  vertices, the same `transform` and EPSG:7415) with the building's parts
  dropped, so "a copy … with the parts dropped" is stated as fact, not as
  "modelled on". Authored in-repo for the M13.3 work, no third-party source.
  FOR: `tests/integration/duckdb/solids.test.ts:591`,
  `tests/unit/features/processing/measureSolids.test.ts:677`, and scenario 2 of
  the browser smoke — with the reason `two-buildings` cannot serve (§7's
  contributor rule picks the MultiSurface part and skips the feature).
- `composite-solid.city.json` (1.3 KB) — `NL.TEST.Composite.0001`, a
  CompositeSolid of two unit cubes sharing a face (volume 2, 2 shells, 12
  faces — the probed numbers), EPSG:7415, identity scale. FOR the `three_d`
  CompositeSolid probe (`solids.test.ts:527`) and Task 7's roll-up test
  (`measureSolids.test.ts:552`).

Both fixture files are already committed (Task 1); only the README rows are new.

## `CLAUDE.md`: confirmed, no edit needed

Read the Hard Rules against this milestone's diff. The three candidates all hold
unchanged:

- "`src/insights/duckdb.ts` is the ONLY module under `src/` that may import
  `@duckdb/duckdb-wasm`" — Task 25 put the race INSIDE that module, added no
  export and edited no call site.
- "ONE writer of the DuckDB status" — `setStatus` is untouched; `settleOnDeath`
  publishes nothing.
- "`retryEngine()` is the door to the engine on boot and on Retry — not
  `initDuckDB()`. It awaits the same memoised boot AND rebuilds the tables that
  were refused while the engine was still coming up" — still an exact description
  of `layerTables.ts:842`; the generation bind is a detail below the rule.

The submodule change (`Surface.geometryType`) is in engine-free `navara-core`, so
the `@navaramap/*` import rule is untouched; persistence stays schema v4 (derived
layers are filtered out, nothing is added to the snapshot shape). No rule changed,
so no rule was added or edited — which is also what the brief expected.

## Nothing from the inputs left unplaced

Every engine fact D1–D10 and both carried-in facts are in the notes with a code
consequence. Every user-visible decision and every "Carried to M4" item is in the
roadmap or the notes, as tabulated above. The two items I placed as ledger/plan
records rather than doc claims, deliberately:

- **"Adapted copy A1–A17 accepted"** — a plan-level bookkeeping fact about
  wording provenance, not something a user can notice; the two strings a user
  actually reads are quoted in the roadmap. The plan's copy table is the record.
- **"Log ENTRY labels are descriptive (M1 precedent), not spec copy"** — a
  process ruling about which strings are spec-bound; no M3 seam turns on it and
  M13.1's note already describes the log. Recorded in the ledger.

## Open item for the gate (Task 29)

The roadmap points at `scripts/smoke/processing-m3.md`, and the notes' acceptance
line lists it. Task 29 creates that file and may amend the 13.3 entry's
deviation wording in its own commit if the gate finds something the carried list
does not name.
