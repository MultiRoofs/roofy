# Fix wave 1 — report

**Branch** `develop`. **Base** `c9346b3`. **Head** `1f20d46`. 14 commits, no trailers,
hooks never bypassed, not pushed. `.github/hooks/`, `docs/design-history/`,
`.superpowers/` and the scratchpad left unstaged; the plan untouched; the plugin
submodule untouched.

## Verification

| gate                                                           | result                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npx vitest run` (whole app, backgrounded and waited)          | 282 files passed / 4 skipped · **3,813 passed / 111 skipped** · exit **0** · 75.2 s |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | 4 files · **111 passed** · exit 0                                                   |
| `npx vp check`                                                 | **0 errors, 56 warnings**, 592 files — the expected counts                          |
| `npx tsc -b --noEmit`                                          | clean, exit 0                                                                       |

The default run's skipped count moved 97 → 111: that is the 14 integration cases
this wave added (solids +5, crossLayer +5, computedColumns +4), collected and
skipped without `DUCKDB_INTEGRATION=1`, and all 14 pass with it. Not a regression.

Node 24 throughout (`node -v` → v24.21.0; the vite-plus shim resolves to the mise
24.14.1 install for `npx`).

The +1 warning a new test introduced (`unbound-method` on a prototype read in
`revealColumns.test.tsx`) was removed by capturing the property DESCRIPTOR instead
of the method; the baseline is back at 56.

---

## Findings → commits

### Gate smoke defects

**F1 CRITICAL — `ST_3DSurfaceArea` aborts a whole run on a degenerate solid.**
`e8f3640 fix: a degenerate face withholds one solid's area instead of aborting the run`

Probe (in the integration suite, on a solid built in the test — a closed box plus
one quad whose four indices collapse onto two vertices):

- the report reads `is_valid false`, `degenerate_face_count 1`, `face_count 7`;
- **only `ST_3DSurfaceArea` RAISES** (`Invalid Error: ST_3DSurfaceArea: solid
contains degenerate faces`). `ST_3DFootprintArea`, `ST_3DZMin` and `ST_3DZMax`
  all answer normally on the same row, pinned over THREE degenerate shapes (a
  collapsed quad, a collapsed triangle, a collinear triangle) plus a
  repeated-ring CONTROL that is invalid but not degenerate — this wave claimed
  four degenerate shapes and shipped one; round 2 measured all four and corrected
  both the count and the fixture;
- **`TRY()` does not catch it** — D11 reconfirmed here: `TRY(CAST('x' AS INTEGER))`
  is NULL, `TRY(ST_3DSurfaceArea(s))` still raises;
- `invalid-solid.city.json` has `degenerate_face_count = 0`, so the guarded
  statement still returns its envelope **388** (scenario 2B is untouched — asserted,
  not assumed).

**Deviation from the ruling, evidence-based:** the ruling said "same for footprint".
The probe pins `ST_3DFootprintArea` as SAFE, so only `ST_3DSurfaceArea` is guarded
(`CASE WHEN s IS NOT NULL AND r.degenerate_face_count = 0 THEN …`). A degenerate
solid therefore keeps its real footprint and its real height and loses only the
area. One line to reverse if the commander prefers the conservative guard.

The statement also selects `CASE WHEN s IS NOT NULL THEN r.degenerate_face_count

> 0 END AS degenerate`, so `rollUpSolids`carries`hasDegenerate`and the executor
counts the caveat exactly the way it counts the withheld volume (only when the`envelope` measure was ticked). A degenerate building shows BOTH caveats.

**[adapted copy A18] — proposed, used tagged.** The ruling offered
`degenerate faces (no area)`. `summarise` renders `<count> <cause>` and the count
is of FEATURES, so that reads "12 degenerate faces (no area)" — a count of faces.
Used instead, parallel to `CAVEAT_INVALID_SOLIDS`:
`solids with degenerate faces (no area)` / singular `solid with degenerate faces
(no area)`. Both constants live in `solidRollUp.ts`, tagged `[adapted copy A18]`.

The Delft LoD 2.2 shape could not be re-run in the probe: the only Delft fixture
in the repo is `delft.fcb` (FlatCityBuf, no `read_cityjson` path), and the gate's
CityJSONSeq sample is remote. The in-test degenerate solid reproduces the exact
error string, which is what the guard is written against.

**F2 — "1 invalid solids (no volume)".**
`e26aa19 fix: a caveat or skip cause reads singular at a count of one`

`SkipCount` gained an optional `one`, and `summarise` is the ONE chooser — for the
head line's caveats and the muted skip line alike. Only Measure solids' two
caveats carry a count noun; `not a solid`, `no geometry at LoD 2.2`, `no geometry`,
`outside every area`, `none within 500 m` and Validate solids' `with issues` read
the same at any count and are unchanged, and so are the roof and extent lines
(their heads come from `plural` in the tools, untouched). Aggregate's overlap
caveat moved onto the same mechanism rather than keeping its own inline noun
ternary, so there is one rule and not two.

**F3 — Style by result live but inert on an UNDONE card.**
`b8d9f1e fix: Style by result is disabled on an undone card`

`RunFooter`'s `styleReason` now reads `Undone` — the record's own note, so no new
copy — and it OUTRANKS "All values are empty" for the same reason the stale reason
does. The muted line under the actions does not repeat it, because the card prints
the note above them. `UNDONE_NOTE` replaces the three hand-spelled `"Undone"`
literals in the file, so the disabling and the two click guards cannot drift.
Narrowness pinned: a card whose note is `finished before the cancel arrived` keeps
the button live.

**F4 MAJOR, observed once — UNREPRODUCED.**
`c549931 test: clearing a layer's provenance and marking its runs stale are one decision`

What I read, end to end:

- every `clearLayer` call in `src/` (two: `runQueue.ts:2082` in the New-layer
  Undo, and the stale watcher) and every `removeColumns` call (two, both in
  `rollBackProvenance`);
- `installStaleWatcher`: the stale marking and `clearLayer` sit in the SAME block,
  under one `if (!rebuilt) continue;` — they cannot decouple;
- every condition that can skip the marking while `clearLayer` still runs:
  `computeLayerId !== layerId` (only a vector-target run, whose provenance is on
  the OTHER layer), `newLayerId !== null` (a derived copy, independent of its
  parent by §6), `status !== "done"` (wrote nothing, or republishes afterwards),
  `run.stale` already true, and an evicted run (no card, and the rebuilt table has
  no columns either). None of them leaves the gate's state;
- the state transitions in `layerTables.ts` that reach the watcher: a rebuild over
  an existing table stays `ready` under the SAME info with `rebuilding: true`
  (neither half fires), a FAILED rebuild puts the same info back (neither),
  `{state:"building"}` is written only when there was no previous entry, and
  `adoptLayerTable` writes `ready` where the store held nothing (`before`
  undefined → not a rebuild);
- `useToolForm.ts:512`'s `sourceCollisions` — it reads `cityTable.columns` minus
  `computedColumnsOf(layerId)`, so the reported symptom needs the table to KEEP
  the columns while the provenance is gone, which no path above produces;
- the reveal channel (`requestColumnReveal`, the streaming sweep) — neither
  touches the provenance store.

The regression committed pins the INVARIANT whose violation the gate saw: a build
in flight and a failed rebuild move neither the stale mark nor the provenance, and
a rebuild under a new name moves both, read together in one assertion. Left for
the commander as unreproduced.

**F5 MAJOR — a Selected-scoped vector-target run was unreachable.**
`f97ce8c fix: a vector layer taking the focus keeps the city layer's selection`

Rule 1 (in `useWorkspaceStore.setActiveLayerId`) gained exactly one exemption,
`keepsCitySelection`: a VECTOR layer taking the focus does not clear a CITY
layer's selection. §6's "changing the target does not change the active layer" is
the basis, and the narrowness is the argument — a vector layer owns areas and
never buildings, so it can never be the owner of the selection it is handed the
focus over. City-over-city, vector-over-vector and any-layer-over-a-geo-selection
all still clear, each pinned by its own case.

Rule 2 was left alone deliberately: with select-then-activate now working,
§10.11's `Selected (2)` is reachable, and narrowing rule 2 would stop a map pick
from bringing the table drawer and the inspector to the layer it landed on. The
form side needed no change — `useLayerCounts(cityLayer.id)` already counts by the
selection's OWNER layer — and is pinned by a new `useToolForm` case (the Selected
radio is enabled, Run is not held by "Nothing selected on this layer").

### Source findings

**S1 — the all-scope footprint reread.**
`4714eb6 fix: scope All reads the layer's own rows, not every object the file now holds`

`buildProxySql`'s footprint arm restricts the reader to the layer table's ids on
`ids === null` too — `WHERE "id" IN (SELECT "id" FROM <table>)`, a subquery rather
than a literal list, so the widest scope stays the shortest statement (the gate
measured 36.6 chars per id). Engine regressions: the feature proxy over a file
that holds `P3` while the table does not returns only the table's features, and an
area drawn over `P3`'s footprint counts **0** buildings through the real
`buildAggregateSql`. Both verified RED against the unpatched builder. The bbox arms
select FROM the table already and are deliberately not wrapped.

**S2 — a replaced computed column keeps its old type.**
`cb10176 fix: a replaced computed column is re-typed to what the run declares`

New pure `typeMigrations(columns, existingTypes)`; `WriteInput` gained
`existingTypes` (lower-cased name → DuckDB's own `column_type`). The write backs
the column up, `DROP COLUMN`s it and re-adds it at the declared type, all inside
its transaction. **The backup widens to the WHOLE column** whenever a migration is
coming: a drop takes every row's value, not the scoped ones, so a scoped backup
would make Undo lose everything outside this run's scope. `UndoInput.migrated`
carries the ORIGINAL types and Undo puts the schema back BEFORE restoring the
values. The derived path passes the PARENT table's types with `existing` still
empty, which is exactly the inherited-column case (a New-layer Undo removes the
layer, so no backup is wanted but the type still has to be the run's).

Engine regressions in `tests/integration/duckdb/computedColumns.test.ts`: that
`ADD COLUMN IF NOT EXISTS` really does leave a DOUBLE column DOUBLE and store
`true` as `1`; DOUBLE→BOOLEAN with Undo restoring both the type and the
out-of-scope row's 42; BOOLEAN→DOUBLE→VARCHAR; and that the text write is REFUSED
outright without the migration (a conversion error that fails the transaction).
Column ORDER moves (the migrated column goes last) — nothing keys on ordinal
position: the grid orders by `table.columns` as DESCRIBEd, the CSV export by the
same list, and both are re-read by `refreshLayerTableColumns` after the write.
A source-attribute column is still never replaced (the head refusal at
`runQueue`'s prefix check is unchanged and its test still passes).

**One consequence, accepted rather than overlooked:** a PARTIAL re-run that changes
a column's type leaves the out-of-scope rows NULL in the new-typed column, while
the provenance tooltip still reads "312 of 1,115 buildings in this run; the rest
from <previous tool>". That is inherent — a DOUBLE cannot live in a BOOLEAN column,
so the earlier run's values have nowhere to go — and the alternative (refusing the
run) is worse than a stale clause in a tooltip. Undo is lossless either way,
because the backup covers the whole column.

One test-fixture correction this forced, and it is a real improvement: the
`runQueue` fake's `refreshLayerTableColumns` answered "VARCHAR" for every column,
so every DOUBLE output looked like a type change. It now tracks the type each
column was ADDED with, which is what a DESCRIBE reports.

**S3 — a mixed polygon/point layer.**
`8a7cc9c fix: a mixed layer's non-areas are skipped, not joined or counted`

The form was already right: "Needs areas (polygons)" is a statement about a layer
with NO polygon, and one polygon makes a mixed layer eligible (pinned by a new
case). The execution preflight is the fix:
`reprojectGeoLayer(doc, epsg, control, { areasOnly })` drops the features that are
not areas, counts them in `notAreas` (a subset of `skipped`), and the queue head
passes `SOURCE_NEEDS_AREAS.has(tool.id)` while Aggregate passes `true` for its
TARGET. §7.6's "every target feature is written" gives the dropped ones §6.2's
NULL, so no point is ever written a count. Both sites tested through a real run
and both verified RED with the flag off. A mixed GEOMETRYCOLLECTION (one point
inside it) is not an area either.

**[adapted copy A19] — proposed, used tagged.** §7.5 words one skip sentence,
`<n> areas skipped: invalid geometry`, and a point is perfectly valid geometry.
`preflightWarnings` (shared by the queue head and Aggregate, so the two cannot
word it differently) emits that sentence for the invalid ones and
`<n> features skipped: not an area` for the rest — §7.5's own
`<count> <noun> skipped: <cause>` pattern.

**S4 — the unbounded distance join.**
`c76a017 fix: the distance join is bounded by a box and reads properties last`

`b` now carries `ST_Expand("g", <limit>) AS "box"` (computed once per building,
not per candidate pair), the candidate CTE's ON clause puts the CHEAP
`ST_Intersects_Extent(b."box", s."geom")` before `ST_Distance_GEOS(…) <= limit`,
and the source's `fid`/`props` are joined back only onto the winner — so the
partitioned sort carries a feature key, a candidate index and a distance and
nothing else. A run that writes no id never joins the source a second time at all.
`ST_Distance_GEOS` and the `"d" ASC, "idx" ASC` tie rule are unchanged.

Measured on the real engine (2,000 × 2,000 points, one macrotask): distance-only
2,331 ms, extent prefilter 1,477 ms, and an `ST_Intersects` prefilter 3,805 ms —
which is why the prefilter is the EXTENT test. `ST_DWithin` was not considered: D10
makes it a false positive, not a filter. The prefilter is conservative by
construction (|qx−px| ≤ |q−p|), and the engine case pins it: the same answers on
the fixture, a source exactly AT the limit still found, and a far source that never
reaches the GEOS distance.

### Test findings

**M1 — scenario 11's Selected(2).**
`cf4f5b9 test: scenario 11's Selected(2) runs through the real Aggregate executor`

In `aggregatePerAreaRun.test.ts`, through the real executor, the real
`buildAggregateSql` and the real publication: six valid areas, two of four
buildings selected on the source city layer, the vector target activated (which
exercises F5's exemption), destination New layer. Asserts the frozen scope
(`["B1","B1P","B2"]`, count 2), that `'B3'` and `'B4'` appear in NO statement the
run issues, all six areas in the copy in the target's order with their exact
counts including the two zeros as plain numbers (never BigInts), and the parent's
document, properties and provenance untouched. The fake table's scope-rows branch
now filters by the statement's own id list, so a Selected scope can no longer
answer for the whole layer.

**M2 — a multi-LoD copy, and Measure solids on it.**
`06e443c test: a multi-LoD copy keeps its geometry, and Measure solids runs on it`

The `deriveLayer` fixture gained real `Surface` objects: the root at LoD 1.2 AND
2.2, its part at 2.2, and a SIBLING feature with a part of its own. Through the
real FIFO: the copy holds exactly the scoped feature, both of the root's rungs and
the part's one, the same `rings` arrays (not rebuilt ones), the file's attributes
plus the run's merged value, and the sibling and its part are gone — with the
parent asserted untouched. Then the REAL `measureSolids` runs over the published
copy: its table, its reader name, no sibling id in any statement, §7's contributor
rule picking the part at 2.2, and the roll-up on the feature root.

**M3 — the far side of the publication boundary, and a relinked parent.**
`e2bb706 test: the cancel that lands during publication, and a relinked vector parent`

For BOTH new-layer branches the Cancel is landed from a store subscription that
fires synchronously inside `publish()`'s own `addLayer` / `addGeoLayer` — which is
the only window a real click has, because the abort check sits immediately before
`publish()` with no await after it. Both finish `done` with
`finished before the cancel arrived`, leave the layer standing, drop no table, and
Undo removes it (and its provenance, on the vector side). The relink case: a new
`preparedData` object during the pending compute fails the run with §6.1's
sentence, with no copy, no provenance anywhere, the replacement document
byte-identical, and the FIFO moving on to a following successful run. (The FIFO
probe uses a fresh layer, because `replaceGeoPreparedData` puts a document back
verbatim without the stable-id envelope `addGeoLayer` mints — a fixture limit,
noted in the test.)

**M4 — death during UPDATE. VERIFIED, no change needed.**
Task 27's fix round covers both destinations and both assert the ORDERED SQL
survives in the log with no COMMIT and no ROLLBACK:
`runQueue.test.ts` "keeps the statements it issued when the ENGINE dies under the
write" (This layer) and `derivedRun.test.ts:323` "keeps the COPY's issued
statements when the engine dies under the write" (New layer).

**Minors 5–10 and 12.** `1b5c0dd test: close the milestone review's eight test minors`

- **5** `crossLayerRun.test.ts` — the vector-target success is asserted positively
  (`done`, `error` null, the value on the feature, and no BEGIN / ALTER / UPDATE
  over the city table). It needed a real area writer instead of `capturing()`,
  whose rows are keyed by a city id and merged nothing.
- **6** `crossLayer.test.ts` — the LoD 0 fixture gained a feature with TWO
  disjoint contributing parts (union 32, not one part's 16 and not the root's 100)
  and a feature whose part has LoD 2 geometry only (root fallback, 100). A new
  case runs min/max through `buildAggregateSql` over three membership shapes:
  MIXED (the NULL ignored, min 12 / max 50), ALL-NULL (count 2, extremes NULL) and
  EMPTY (count 0) — the count is what tells the last two apart.
- **7** `crossLayerRun.test.ts` — a predecessor HOLDS the FIFO, the source is
  removed while the run is queued behind it, the slot is released, and the run is
  refused at its head; a following run then finishes, which is the FIFO-progress
  half. Parameterised over Join and Distance, plus a case for Aggregate's reversed
  direction (the CITY source removed, nothing written onto the target). The older
  immediate-removal case is left in place — it is not wrong, only weaker.
- **8** `layerTablesBuild.test.ts` — name allocations interleaved with two real
  builds; five distinct names, neither live table's name handed out by the
  counter, both still `ready`.
- **9** `validateSolids.test.ts` — the SCOPE's rows are reversed with the report
  rows, and the summed diagnostic counts (7 open edges, 1 non-manifold) are
  asserted as well as the FALSE-dominates-NULL flags.
- **10** `vectorTable.test.ts` — the assembly checkpoint is armed after a TINY
  last feature (one point, under the byte budget, so its head and geometry take no
  checkpoint and the walk then breaks without one): every checkpoint after that
  read is inside the assembly, and exactly one is taken. `joinByLocation.test.ts`
  and `distanceToNearest.test.ts` gained timer-delivered cancellation during row
  processing, which a synchronous loop calling `throwIfCancelled` between batches
  cannot pass.
- **12** `joinByLocationRun.test.ts` and `distanceToNearestRun.test.ts` reset the
  computed-column store per case and assert it empty for a cancelled and for a
  failed run. `revealColumns.test.tsx` puts `Element.prototype.scrollIntoView`
  back (via its property DESCRIPTOR, which also keeps the lint baseline at 56).

### Documentation

`1f20d46 docs: correct the death-handling claims and D10, and record the gate's fixes`

- `docs/roadmap.md`: "every engine await settles" → every await on one of
  `duckdb.ts`'s **six raced primitives**; what the six call sites then SHOW is
  per-site (the export dialog and the median report the engine's sentence, the
  map-filter sync clears the filter, the Stats tab stops waiting) instead of "return
  a message"; "nothing HANGS" narrowed the same way in the carried item;
  `queryParquetBuffer`'s unraced operations corrected to **REGISTRATION and
  CLEANUP** (its query delegates to the raced `queryDuckDB`); the contributor-list
  item now carries the gate's measurement; and a new paragraph records S1–S4, F1,
  F2, F3, F5 and the two proposed adapted-copy strings.
- `docs/architecture-notes.md`: **D10** distinguishes `ST_Distance`'s wrong number
  from `ST_DWithin`'s boolean false positive (true for polygons 40 m apart at a
  39 m threshold) and names the new EXTENT prefilter as deliberately not
  `ST_DWithin`; **D11** added beside it (TRY does not catch a three_d Invalid Error;
  only `ST_3DSurfaceArea` raises on a degenerate face; the guard is the report's
  count and never `is_valid`); the source-byte lifetime restated as "through the
  reader statements, released before the roll-up"; **D2** qualified by the
  unloaded-json condition; "No `toolId` appears in `RunFooter`" → "no
  tool-specific BRANCHING" (it reads `run.toolId` for the registry lookup); and a
  four-part seam paragraph in the M13.3 section for S1–S4.

---

## For the commander

1. **[adapted copy A18]** `solids with degenerate faces (no area)` / singular
   `solid with degenerate faces (no area)` — F1's caveat, proposed in place of the
   ruling's `degenerate faces (no area)` because the count is of features and
   `summarise` prints the number in front of it.
2. **[adapted copy A19]** `<n> features skipped: not an area` — S3's skip cause,
   beside §7.5's own `<n> areas skipped: invalid geometry`. A point is valid
   geometry, so reusing that sentence would send a user looking for a broken ring.
3. **F1's guard covers `ST_3DSurfaceArea` only**, against the ruling's "same for
   footprint": the probe pins the footprint, ZMin and ZMax as safe on the same row
   over three degenerate shapes (round 2 corrects this count — see below).
   Reversing it is one `CASE WHEN` per measure.
4. **F4 is unreproduced.** The paths checked are listed above; the coupling the
   symptom would have to break is now pinned by a test.
5. **Two things need the next BROWSER gate.** F1: the fix is pinned on the exact
   error string against a real DuckDB 1.5.5, but scenario 8's LoD 2.2 pass is a
   smoke. F5: a city selection alive while a vector layer is active is a state
   jsdom cannot judge — the Inspector, Details and the table drawer under it want
   a real look, and §10.11's `Selected (2)` run wants driving end to end.
6. **`scripts/smoke/processing-m3.md` is now stale on F1–F5** — it still lists
   them as open defects. Out of this brief's scope and deliberately untouched; the
   next gate run owns it.

---

# Round 2 — the re-review's three required fixes

**Base** `1f20d46`. **Head** `0d6058a`. Three commits — `619cc39`, `54951d2`,
`0d6058a` — no trailers, hooks never bypassed, not pushed.
`scripts/smoke/processing-m3.md` belongs to another agent and was never opened;
every `git add` named its files explicitly, and that agent's own `06dc5a6`
landed between the second and third of mine and is untouched.

| gate                                                           | result                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npx vitest run` (whole app, backgrounded and waited)          | 282 files passed / 4 skipped · **3,823 passed / 113 skipped** · exit **0** · 75.5 s |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | 4 files · **113 passed** · exit 0                                                   |
| `npx vp check`                                                 | **0 errors, 56 warnings**, 592 files                                                |
| `npx tsc -b --noEmit`                                          | clean, exit 0                                                                       |

Skipped 111 → 113: round 2's two new engine cases, collected and skipped without
`DUCKDB_INTEGRATION=1` and passing with it.

## 1. S2 regression — a partial type migration

`619cc39 fix: a column's type changes only on a run that covers every row`

The ruling, implemented as ruled. A type change is allowed only when the run
covers EVERY row of the column; otherwise the run is refused.

- `migrationRefusal` (`src/insights/computedColumns.ts`) builds the sentence from
  `typeMigrations`, so the refusal and the write cannot come to disagree about
  what a migration is. **[adapted copy A20]**: `The existing <column> is <TYPE>;
run on All buildings to change its type` — the TABLE's spelling and DuckDB's
  own type, the two things the user goes and looks at, exactly as the "belongs to
  the source data" refusal already does.
- The HEAD refusal (`runQueue.ts`, after the scope query) fires when
  `target.kind === "city"`, the destination is not a new layer, and the scope is
  neither `all` nor a filter/selection that names every feature
  (`scope.count === scope.total`). **It sits after `resolveScope` and not beside
  the other pre-flight refusals because "covers every row" is not knowable before
  the count query** — `request.scope === "all"` is the ruling's own first clause
  and short-circuits it. The patch carries `phase: null`, like the other refusals
  that can fire once "Reading source" has opened.
- A NEW-layer run is exempt: its table is CUT to the scope, so every row of the
  copy is in the run by construction.
- The FORM (`useToolForm.ts` → `ToolView.tsx`) computes the same sentence from
  `cityTable.columns` and the scope's own count, blocks Run with it, and renders
  it in the replace-warning slot — in the warning's PLACE, since that slot is the
  one that talks about replacement. The footer does not echo it (the rule the
  prefix, parameter, name and destination reasons already follow). It is guarded
  on both counts being numbers, so nothing flashes while they load.

Tests (all red first):

- `tests/unit/insights/computedColumns.test.ts` — the sentence, the table's
  spelling, and silence on a same-typed replacement.
- `tests/unit/features/processing/runQueue.test.ts` — a scoped re-type refused
  with the verbatim sentence and **all three stories left alone** (no
  `BEGIN`/`ALTER`/`UPDATE`/backup in the issued SQL, the column still VARCHAR,
  `attributesOf("a")` empty, the earlier run still the provenance's owner); a
  scoped SAME-typed replacement still backing up `WHERE "id" IN ('a')` with no
  DROP; and a scoped run that happens to name every feature carrying the
  migration through. Wave 1's "re-types a replaced column and gives Undo its type
  back" already covers the All re-type and the original-type Undo (its
  `request()` is scope `all`).
- `tests/unit/ui/processing/useToolForm.test.tsx` — the refusal appears on
  Selected and not on All, takes the warning's place, disables Run, and is said
  once.

One fixture fix came with it: `roofMetricsRun.test.ts`'s fake typed every column
`VARCHAR` whatever the ALTER said, so its scoped re-run of a DOUBLE column looked
like a migration. It now records the type the ALTER declared and rolls it back
with the transaction — the same treatment `runQueue.test.ts`'s fake got in wave 1.

**Residual, verified and NOT fixed in round 2 — CLOSED in the final wave below,
under the commander's ruling (a re-typed column is a new column, so the skipped
rows read NULL everywhere).** Even on a full-coverage
re-type the DROP/ADD NULLs every row of the table, while publication
(`runQueue.ts`, the `merge` loop) writes model attributes only for the rows the
executor returned. An executor that omits a SKIPPED row from `rows` — Measure
solids does, at `tools/measureSolids.ts`'s `rollUp === null` arm — therefore
leaves that building's model attribute holding an earlier run's value while the
database says NULL. It is the same class as the regression just fixed, one size
smaller, and it is only reachable through a re-type (an ordinary replacement
leaves the skipped row's database value alone too, so the two agree). Closing it
means deciding what a migration does to the rows the new run did not measure —
clear their attributes, or clear the provenance's `previous` chain with them —
which is a design call, not an implementation detail, so it is left for the
commander rather than invented here.

## 2. F5 regression — hover re-activated the city layer

`54951d2 fix: only a pick coordinates the active layer, not a hover`

Rule 2 subscribed to every selection-store write, and that store carries the
hover, the pick mode and the tool mode beside the selection. `reconcileSelection`
now keeps the previous SELECTION IDENTITY — the selected `layerId`/`objectId`
pairs, or the geo feature's layer and stable id — and returns early when it has
not changed.

**Superseded in Round 3 below — the re-pick IS a pick, and the counter, not the
identity, is what tells it from a hover.** As written in round 2:

Ids only, deliberately: `setMode("object")` REBUILDS the selection array to
narrow surface picks to their objects, so a key including `kind` or
`surfaceIndex` (or the array's identity) would still fire on a pick-mode change —
which is the second half of the reported symptom. The cost is that re-picking the
very same object does not re-activate its layer, which is a no-op by any other
name. The previous key starts at `null`, so installing over a restored selection
still lets that selection name the active layer (wave 1's install-order test
still passes).

`tests/unit/features/workspace/layerCoordination.test.ts` — select city →
activate vector → hover, hover(null), `setToolMode`, `setMode` round trip: the
vector layer stays active and the selection survives; then a pick of a DIFFERENT
building hands the focus back to the city layer.

## 3. F1 — the probe now holds what the report claimed

`0d6058a test: three degenerate shapes raise, and a repeated face does not`

The footprint assertion the re-review reports missing was already there
(`tests/integration/duckdb/solids.test.ts`, "RAISES from ST_3DSurfaceArea only —
footprint, ZMin and ZMax answer": `footprint: 80, ground: 0, ridge: 6` on the
degenerate row). It is now made per shape and the fixture carries the shapes the
report claimed:

- **collapsed quad** `[0,1,1,0]`, **collapsed triangle** `[0,1,1]` and
  **collinear triangle** `[0,8,1]` (vertex 8 is the midpoint of the ground edge):
  each reports `degenerate_face_count = 1`, each RAISES from `ST_3DSurfaceArea`,
  and each answers `ST_3DFootprintArea` 80 m², `ST_3DZMin` 0 m, `ST_3DZMax` 6 m.
- **The fourth shape was WRONG in wave 1's report** (which claimed four
  degenerate shapes, named a duplicated ground ring among them, and shipped only
  the collapsed quad) **and is now a CONTROL.** A
  repeated ground ring is a face with real area: measured
  `degenerate_face_count = 0`, `is_valid false`, and `ST_3DSurfaceArea` answers
  for it. That is the evidence for reading the report's count and never
  `is_valid`, which would withhold the area of every §7.3 failure. Its footprint
  is 120 m², not 80 — the projection counts the repeated face — which is an
  ANSWER, and the point.

So the ruling's "same for footprint" is still declined, now on three shapes plus
a control rather than on one. Reversing it remains one `CASE WHEN` per measure.

## The two findings the re-review's assessment line also names

Neither is in the coordinator's required list and neither was coded for; the
evidence already in the tree, so a third round need not go looking:

- **M4** — death under the write, both production paths, both asserting the
  ISSUED statements: `tests/unit/features/processing/runQueue.test.ts:1242`
  ("keeps the statements it issued when the ENGINE dies under the write", which
  asserts the exact three-statement log with no COMMIT and no ROLLBACK) and
  `tests/unit/features/processing/derivedRun.test.ts:323` ("keeps the COPY's
  issued statements when the engine dies under the write").
- **Minor 11** — the pending-A → acknowledged-B shape:
  `tests/unit/ui/table/revealColumns.test.tsx:144`, "forgets a SUPERSEDED request
  even when the new one is taken at once" — A is DECLINED (so it is still
  pending), B is acknowledged immediately (the early-return path), and the drain
  that follows offers nothing.

---

# Final wave — the whole-branch review's two findings

**Base** `0d6058a`. **Head** `71db6e2`. Three commits, no trailers, hooks never
bypassed, not pushed, no other agent's files touched.

| gate                                                           | result                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npx vitest run` (whole app, backgrounded and waited)          | 282 files passed / 4 skipped · **3,842 passed / 113 skipped** · exit **0** · 75.4 s |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | 4 files · **113 passed** · exit 0                                                   |
| `npx vp check`                                                 | **0 errors, 56 warnings**, 592 files                                                |
| `npx tsc -b --noEmit`                                          | clean, exit 0                                                                       |

The skipped count is unchanged at 113: this wave adds no engine case, only unit
ones (14 in `crossLayerRun.test.ts`, 2 in `runQueue.test.ts`, 1 in
`deriveLayer.test.ts`).

## Review #2 — a relinked vector SOURCE

`d1a24e2 fix: a relinked vector source fails the run instead of publishing`
`71db6e2 fix: the source check covers the copy's preparation and a no-match run`

The areas are read ONCE, before the compute: reprojected into the target's CRS
and written to a per-run table. Everything the run produces is measured against
that snapshot, so a re-link in the meantime makes the results describe a Zones
the user can no longer see. Only vector TARGETS were identity-checked, and the
watcher sees removals only.

`vectorSourceMoved(source)` (`runQueue.ts`) compares the SAME identity the
target's check uses — `config.preparedData`, which re-linking replaces — and
returns §6.1's `Layer changed while running; run again`, or `Layer removed` when
the layer has gone. It is asked at each destination's own publication boundary:

- **This layer** — on the far side of the compute, **above** the "nothing
  matched" exit (a run that matched nothing against a replaced document has not
  succeeded either) and before anything is decided from the results. Nothing
  between that point and `writeComputedColumns` awaits, so it covers the write
  preparation as well; this is why the This-layer test lands its relink on the
  tick the executor returns rather than at a gate.
- **New layer** — immediately before `plan.publish()`, after the existing
  cancel check, with `plan.discard()` first: the copy's table is a private
  resource until publication, exactly as it is for a cancel there.

**Cleanup and the FIFO.** The per-run vector table is dropped by the `finally`
that every exit path already runs through (`runQueue.ts`'s
`await vectorSourceHandle?.release()`), and both executors release their reader
handle in their own `finally` BEFORE returning — `tools/joinByLocation.ts:312`
and `:385`, `tools/distanceToNearest.ts:294` and `:365` — so by the time the
check runs there is no handle left to leak. Every test asserts the `DROP TABLE
IF EXISTS "__src_<run>"` and runs a follow-up run to `done` on the freed queue.

Tests, `tests/unit/features/processing/crossLayerRun.test.ts`: Join × Distance ×
{This layer, New layer} for a relink DURING THE COMPUTE (the executor is held at
a gate) and on the tick the compute HANDS OVER to the write; Join × Distance ×
New layer for a relink INSIDE the copy's preparation (the fake is held at the
copy's `CREATE TABLE`); Join × Distance for a relink on a run that matched
NOTHING; and a control per destination proving a source that stood still still
publishes. Each failure case asserts no ALTER/UPDATE on the target table, no
transaction (This layer) or a dropped copy table (New layer), no new layer, no
provenance, the vector table released, and the next run reaching `done`.

## Review #1 / the S2 residual — a re-typed column is a NEW column

`68b31ea fix: a re-typed column reads NULL everywhere, not only in the table`

**The shipped design differs from the review's suggested fix, deliberately.**
The review asked for a lossless migration that preserves out-of-scope values,
or an atomic refusal. Round 2 had already taken the second half of that (a
scoped re-type is refused at the head), so what was left was the FULL-COVERAGE
case: the DROP/ADD empties the column for every row, and the rows the run
covered but SKIPPED (no geometry, not a solid, outside every area) then held
NULL in the table while their model attributes still carried the previous run's
values. The commander's ruling settles it the other way from "lossless": §7 says
of a new column that "in a new column they are NULL", and a re-typed column IS a
new column — so the NULL is the truth and it is published everywhere.

- `runQueue.ts`'s publication merges NULL into the model for every COVERED row
  with no value in `result.rows`, for the migrated columns only, and records the
  replaced value in `previousModelValues` so Undo puts it back with the rest.
- `deriveLayer.ts` does the same for a New-layer copy: it inherits the parent's
  columns WITH their values, so an inherited column its own write re-types must
  not go on showing the parent's number in the copy's model.
- A SAME-typed replacement is untouched — no schema change, so the skipped row's
  value is still in the table and the model must go on agreeing with it.
- Provenance needs no change: `partial` is already `null` whenever the scope
  covered everything, which is the migration's own precondition, so the tooltip
  never says "the rest from …" about values a DROP took away. Asserted.

Tests: `runQueue.test.ts` — "NULLs a SKIPPED row's attribute when the column is
re-typed (S2)" asserts the DROP, that the UPDATE never names the skipped
building, that the model reads `null` for it and `4` for the measured one, that
`partial` is null, and that **Undo restores both halves** (the measured row's
attribute removed, the skipped row's `9` back); "leaves a SKIPPED row alone when
the type does not change (S2)" is the narrowness. `deriveLayer.test.ts` — the
copy's part reads `null` while the parent keeps `Centrum`.
`tests/integration/duckdb/computedColumns.test.ts`'s probe 7 is the engine half,
re-framed: its `b2` is a covered-but-skipped row, NULL after the migration and
`42` again after the Undo, and it names the queue test as the model half.

## Open after this wave

Only what was already open: **F1** guards `ST_3DSurfaceArea` alone (three shapes
plus a control), **[adapted copy A18, A19, A20]** want the commander's blessing,
and **F1 + F5** want the next browser gate. The S2 residual and the vector-source
relink are closed.

---

# Round 3 — the F5 regression the last re-review found

**Base** `c5af99f`. **Head** `bac1a42`. One commit, no trailers, hooks never
bypassed, not pushed, no other agent's files touched.

| gate                                                  | result                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npx vitest run` (whole app, backgrounded and waited) | 282 files passed / 4 skipped · **3,847 passed / 113 skipped** · exit **0** · 75.1 s |
| `npx vp check`                                        | **0 errors, 56 warnings**, 592 files                                                |
| `npx tsc -b --noEmit`                                 | clean, exit 0                                                                       |

Skipped is unchanged at 113 — no engine case in this round.

`bac1a42 fix: a pick coordinates even when it lands on what is already selected`

**The regression.** Round 2 stopped a hover re-activating the city layer by
comparing what is SELECTED. That reading is wrong at one point, and the review
found it: clicking the building that is already selected is an honest pick — the
user is asking to be taken back to its layer — and it changes no id, so the
early return swallowed it. Select A → activate the vector layer → pick A again
left the vector layer active.

**The fix, per the ruling.** The selection store now carries its own signal for
a pick, `selectionVersion`: a monotonically increasing counter bumped by the
five actions that CHOOSE what is selected — `select` (a miss included),
`toggleSelect`, `selectMany`, `selectGeoFeature` and `clear` — and by nothing
else. `hover`, `setToolMode` and `setMode` do not touch it. Rule 2 compares that
counter and only that, from `null`, so installing over a restored selection
still lets the selection name the active layer.

Why not something already in the store: `setMode("object")` REBUILDS the
selections array (it narrows surface picks to their owning objects), so neither
the array's identity nor the state's answers the question — that write must be
ignored, and a repeated pick must not be. Only a counter separates the two, and
the store is where it belongs: `layerCoordination` cannot infer it from state it
is handed after the fact.

Tests:

- `tests/unit/features/workspace/layerCoordination.test.ts` — "a re-pick of the
  SAME object re-activates its layer (F5)" (the review's case, red first); "a
  re-pick through toggleSelect and selectMany coordinates too (F5)" (the other
  two ways a pick reaches the store, also red first); "a re-pick of the SAME geo
  feature re-activates its layer (F5)"; and round 2's hover / `setToolMode` /
  `setMode` case and different-object pick, both still green.
- `tests/unit/features/selection/selectionStore.test.ts` — the counter's own
  contract: the eight picks that bump it, including the repeat of the identical
  selection, and the four writes that do not (hover, hover(null), the tool mode,
  and the pick mode whose narrowing rebuilds the array).

**Verified, not changed.** Two places write the selection store directly rather
than through an action — `App.tsx:1651` (opening a shared workspace) and
`persistence/restoreSnapshot.ts:42` — so they do not bump the counter. Both
CLEAR the selection, so rule 2 has no owner to act on either way. Two callers of
the pick actions are not user picks: `App.tsx:808` re-selects the same geo
feature when a run's results land on it (guarded by an identity check, so it
fires only on a real change) and `query/mapFilterSync.ts:233` re-selects what a
filter retained (only when the selection actually shrank). Both coordinate, as
they did before round 2 — neither is on a timer or a store subscription loop.

**For the commander.** `docs/architecture-notes.md`'s Milestone 12 paragraph
describes the invariants as "a selection activates its owner", which is still
exactly right; nothing in the docs commit `c5af99f` describes the round-2
mechanism, so nothing there needs correcting. Should a future note spell the
rule out, it is now "a PICK activates its owner", counted by
`selectionVersion`.

## Open after this round

Unchanged, and nothing new: **F1** guards `ST_3DSurfaceArea` alone (three shapes
plus a control); **[adapted copy A18, A19, A20]** want the commander's blessing;
**F1 and F5** want the next browser gate.
