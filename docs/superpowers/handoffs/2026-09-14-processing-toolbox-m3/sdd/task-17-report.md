# Task 17 — Distance to nearest — report

Branch `develop`, base `60920dc`, four commits (no trailers, not pushed):

- `540589b` feat: Distance to nearest measures the 2D distance to a vector layer
- `451ab08` test: a cancelled or engine-killed Distance run releases its reader and its vector table
- `f32504a` fix: the distance is measured with the function that answers between polygons
- `9475bef` test: Style by result opens the nearer half of a Distance run

> **Read the "Engine finding D7" section first.** Core `ST_Distance` is **0
> between any two polygons** on this checkout's DuckDB 1.5.5, which the plan's
> §7.7 SQL (and Task 1's `MIN(ST_Distance)` probe, which used a POINT) rests on.
> The builder measures with `ST_Distance_GEOS`. Nothing else in M3 is affected.

## Implemented

`src/features/processing/tools/distanceToNearest.ts` (new):

- `buildDistanceSql(input)` — §7.5's shape line for line, so the two executors
  read side by side: `b` (`buildFeatureProxySql`'s `(f, g)`), `j` (LEFT JOIN to
  `__src_<runId>` with **the max search distance in the `ON`**, carrying
  `no_proxy`, `idx`, `fid`, `props` and `ST_Distance_GEOS(...) AS "d"`), `r`
  (`ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY "d" ASC NULLS LAST, "idx" ASC
NULLS LAST)`), `m` (`rn = 1`), then back to the table's rows by
  `COALESCE(t."feature_id", t."id") = m."f"` so root and parts carry the
  feature's answer. The nearest id is `m."fid"` (§7.7's default, the GeoJSON
  feature id `encodeProjectedFeatures` wrote) or `m."props"->>'<key>'`; the
  frozen ids restrict BOTH relations. No `HAVING`, no `arg_min`, no second
  `CASE` for "beyond the limit".
- `distanceToNearest: ToolExecutor` — refuses a non-vector source with §5's own
  sentence; re-validates the frozen `nearestIdProperty` against
  `source.propertyKeys` (every LIVE feature's keys, kept and skipped alike) with
  §6.1's sentence; opens `readSource` for the footprint proxy under
  `ctx.phase("source")` and releases it as soon as the parse is done AND in a
  `finally`; issues the scope-rows + reader-ids statements and `assertSourceIds`
  BEFORE the compute on that path only; rolls the per-ROW result up per FEATURE
  key `f`; batches of `DISTANCE_BATCH_ROWS` (500) with a macrotask yield then
  `throwIfCancelled`; returns `line` = "<n> buildings measured", the caveat
  `{cause: "none within <max> m", count}` and `skipped` =
  `{cause: "no geometry", count}`.
- `registerExecutor("distance-to-nearest", distanceToNearest)`; `tools/register.ts`
  imports it.

`src/features/processing/toolRegistry.ts`: `implemented: true` for
`distance-to-nearest`, in the executor's own commit. Its `styleByResult`
descriptor (`<` + median, `pick` = the `…distance_m` column) was already there
from Task 9 and needed no change — checked and now pinned through the real
footer. No change to `types.ts`, `crossLayerParams.ts`, `RunFooter.tsx` or any
resolver: `distanceParams`/`distanceColumns` (Task 15) and `proxyDistanceNote`
(Task 14) were exactly what the executor needed.

## Engine finding D7 (new, 2026-09-13) — core `ST_Distance` is 0 between polygons

Probed on this checkout's real engine (node harness, DuckDB 1.5.5 + core
`spatial`), against the disjoint pair A `POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))`
and B `POLYGON ((50 0, 150 0, 150 100, 50 100, 50 0))`, whose true distance is
40:

| expression                                                             | core `ST_Distance` | `ST_Distance_GEOS`    |
| ---------------------------------------------------------------------- | ------------------ | --------------------- |
| A ↔ B                                                                  | **0** (wrong)      | 40                    |
| `ST_MakeEnvelope(5,5,5,5)` ↔ B (a one-coordinate building's rectangle) | **0** (wrong)      | 45                    |
| A ↔ `GEOMETRYCOLLECTION (POLYGON(B), POINT)`                           | **0** (wrong)      | 40                    |
| A ↔ `POINT (50 5)`                                                     | 40                 | 40                    |
| A ↔ `LINESTRING (50 0, 50 100)`                                        | 40                 | 40                    |
| A ↔ a polygon inside it / touching it                                  | 0                  | 0                     |
| `ST_Distance_GEOS(NULL::GEOMETRY, …)`                                  | —                  | NULL (does not raise) |

`ST_DWithin` has the same defect (`ST_DWithin(A, B, 39)` → `true`);
`ST_DWithin_GEOS` is correct (`39` → false, `41` → true).

**Why it is decisive here.** Two of §7.7's three proxies ARE polygons (the
extent rectangle and the `ST_Force2D`'d LoD 0 footprint union) and §7.7's source
is "any geometry type", so with the plan's `ST_Distance` a run against a polygon
source would have written `0` for every building in the layer — silently, under
a card saying "1,204 buildings measured". It also defeats the max search
distance (everything is within it) and the tie rule (every distance is 0, so
`idx` always wins). Task 1's `MIN(ST_Distance)` probe did not catch it because
its probe geometry was `ST_Point(200, 50)`.

**Availability of the fix in the shipped build.** `ST_Distance_GEOS` is present
in the published `wasm_eh` binary the app downloads — verified by fetching
`https://extensions.duckdb.org/v1.5.5/wasm_eh/spatial.duckdb_extension.wasm`
(23.6 MB, HTTP 200) and finding the exact symbol in it (as are `ST_ShortestLine`,
`ST_CoveredBy` and `ST_Union_Agg`, which Join already depends on). A browser
confirmation is still worth a line in Task 29's gate smoke.

**Scope.** Join (§7.5) and Aggregate (§7.6) use `ST_Intersects`, `ST_CoveredBy`
and `ST_Area(ST_Intersection(…))` — all correct in the same probe
(`ST_Intersects(A, B)` is `false`, as it should be). **Nothing about Task 16 or
Task 19 needs reopening.** The only other place a distance is measured is Task
1's probe case, which is now annotated as trusted only because its proxy is a
point.

## Tested + results

- `tests/unit/features/processing/distanceToNearest.test.ts` (new, 30 cases):
  the SQL text (6) and the executor over a fake `ToolContext` (24), with the
  REAL `readerQuery`/`assertSourceIds` (only `readSource` stubbed) and a
  per-statement `query` so the identity check cannot pass by accident.
- `tests/unit/features/processing/distanceToNearestRun.test.ts` (new, 5 cases):
  the real executor on the real queue and the real table FIFO over a LINE source
  — the happy path's publication and card line, a Cancel and an engine DEATH
  under a held distance statement, and §6.1's id-join failure; each asserting
  both handles dropped, `DROP TABLE IF EXISTS "__src_<id>"`, no `BEGIN`/`ALTER
TABLE` and a free FIFO.
- `tests/integration/duckdb/crossLayer.test.ts` (+4 cases, 33 total): D7's
  defect and the correct answers beside it; `buildDistanceSql`'s own statement
  per FEATURE (0 on overlap, 50 with the winner's `fid`, the tie to source
  order, the limit at 40 m, `no_proxy`); the FOOTPRINT proxy read through
  `read_cityjson` against a distant area (196 m / 90 m / NULL); and §7.7's mixed
  `GEOMETRYCOLLECTION (POINT …, LINESTRING …)` at 5 m, built through the real
  `encodeProjectedFeatures` + `buildVectorTableSql`.
- Migrations forced by the flip: `register.test.ts` (EXECUTORS pin),
  `eligibility.test.ts` (the real Distance row: §5's sentence, then `ok: true`),
  `CatalogueView.test.tsx` (Distance's real row title and reason),
  `ToolView.test.tsx` (the unimplemented-tool guard moves to Aggregate, with a
  vector layer so it stays honest; Distance becomes the shipped control),
  `useToolForm.test.tsx` (Distance leaves the patched set; two new Run-reason
  cases), `styleByResult.test.tsx` (the §7.7 footer case),
  `extensionChip.test.tsx` (comment).

Results:

```
npx vitest run tests/unit/features/processing tests/unit/ui/processing
  → 44 files, 733 passed | 1 todo
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
  → 33 passed
npx vitest run > /tmp/m3-task17-suite.log 2>&1 & wait $!   (background, once,
  after the last commit)
  → suite: 0 — 265 files passed | 4 skipped; 3467 passed | 92 skipped | 1 todo
npx vp check → 0 errors and 56 warnings   (baseline)
npx tsc -b --noEmit → clean
```

## TDD evidence

**RED.** `distanceToNearest.test.ts` written first, against no module:

```
npx vitest run tests/unit/features/processing/distanceToNearest.test.ts
 FAIL  Error: Failed to resolve import
   "../../../../src/features/processing/tools/distanceToNearest" … Does the file exist?
 Test Files  1 failed (1) | Tests  no tests
```

**GREEN** after the executor: `Tests 30 passed (30)`.

**RED → GREEN on the wire.** `register.test.ts` first:

```
-   "distance-to-nearest",     (expected, missing from EXECUTORS)
 Test Files  1 failed (1) | Tests  1 failed (1)
```

then `import "./distanceToNearest";` in `register.ts` → `1 passed`.

**RED → GREEN on the flip.** With `implemented: true` and nothing else changed:

```
npx vitest run tests/unit/features/processing tests/unit/ui/processing
 FAIL ToolView.test.tsx > an unimplemented tool promises nothing >
   prints no column list and no geometry verdict
 AssertionError: expected <p class="processing-note"></p> to be null
   + "LoD 0 footprints are not in this layer; the bounding-box centre is used."
 Tests  1 failed | 724 passed
```

— exactly the guard the constraint exists for, now pointing at the wrong tool.
Migrated to Aggregate in the same commit → `43 files, 728 passed`.

**RED on the ENGINE, which is how D7 was found.** The first run of the new
builder case, with the brief's `ST_Distance`:

```
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
 FAIL > runs buildDistanceSql's OWN statement, per FEATURE, over the vector table
-     "roads_distance_m": 50,      "roads_nearest_id": "b",
+     "roads_distance_m": 0,       "roads_nearest_id": "a",
 Tests  1 failed | 30 passed
```

A scratch probe suite (deleted before any commit) then isolated it to
polygon↔polygon and cleared `ST_Distance_GEOS`; the table above is that probe's
output, and `crossLayer.test.ts` now carries it as a permanent case. GREEN after
the switch: `Tests 33 passed (33)`.

**Mutation checks on the two suites written after their code** (both are
pinning suites; each was falsified deliberately and reverted):

- `useToolForm.test.tsx`'s two Run-reason cases: dropping `paramsError ??` from
  `useToolForm.ts`'s `runReason` chain → `2 failed | 27 passed`.
- `distanceToNearestRun.test.ts`: disabling the caveat in the executor →
  `expected '2 buildings measured · 0.0 s' to match /^2 buildings measured · 1
none within…/`, `1 failed | 4 passed`.

## Files changed

- `src/features/processing/tools/distanceToNearest.ts` (new)
- `src/features/processing/tools/register.ts`
- `src/features/processing/toolRegistry.ts` (one line: `implemented: true`)
- `tests/unit/features/processing/distanceToNearest.test.ts` (new)
- `tests/unit/features/processing/distanceToNearestRun.test.ts` (new)
- `tests/unit/features/processing/register.test.ts`
- `tests/unit/features/processing/eligibility.test.ts`
- `tests/unit/ui/processing/ToolView.test.tsx`
- `tests/unit/ui/processing/useToolForm.test.tsx`
- `tests/unit/ui/processing/CatalogueView.test.tsx`
- `tests/unit/ui/processing/styleByResult.test.tsx`
- `tests/unit/ui/processing/extensionChip.test.tsx` (comment)
- `tests/integration/duckdb/crossLayer.test.ts`

## How each controller requirement was met

1. **Scope-wide source identity (B1 + ruling).** Task 16's shape exactly: on the
   footprint path only, the executor reads its OWN scope rows off the table
   (`buildScopeRowsSql(ctx.table.table, ctx.featureIds)`) and the reader's ids
   (`buildSourceIdsSql`), both imported from `solidSql.ts` rather than
   re-spelled, and calls `assertSourceIds(scopeIds, readerIds)` BEFORE the
   compute. `ctx.featureIds ?? []` appears nowhere. Six parameterised cases — a
   missing ROOT and a missing PART under All (`featureIds: null`), Selected and
   Matching — each asserting `SOURCE_IDS_DIFFER` through the REAL
   `assertSourceIds`, that the distance statement never ran, and that the reader
   was released; plus the end-to-end case in `distanceToNearestRun.test.ts`. The
   two bbox proxies read the browsing table only, so they issue neither
   statement and call neither door (asserted: `sql` has length 1, both spies
   untouched).
2. **B7.** The frozen-property check reads `source.propertyKeys`, which Task 12
   builds from EVERY live feature's properties, kept or skipped. Three cases: a
   property carried only by a SKIPPED feature (built through the real
   `reprojectGeoLayer`, `preflight.skipped === 1`) runs normally; a property
   that truly disappeared fails with "Layer changed while running; run again"
   verbatim, with no statement sent; and a changed source is not minded at all
   when the id comes from the feature id (`fid`) or is not written.
3. **B10.** `crossLayer.test.ts` runs MY builder's text (`DUCKDB_INTEGRATION=1`)
   over a per-run table built by the real `encodeProjectedFeatures` +
   `buildVectorTableSql` from a single feature whose WKT is
   `GEOMETRYCOLLECTION (POINT (20 20), LINESTRING (3 4, 10 10))` — the text
   `vectorSource.test.ts` pins Task 12 emitting. The centre proxy of a
   `(-1,-1)-(1,1)` extent is `(0, 0)`, and the answer is the reviewer's probed
   **5** (the linestring's `(3 4)` vertex), with the nearest id read from the
   collection's own property.
4. **Semantics (§7.7).** 2-D distance in the target's CRS between the proxy and
   the nearest source geometry (engine-pinned: 0 on overlap, 50 to the nearer
   area, 196/90 for reader-read footprints); ties → the first source feature by
   `idx` (engine-pinned on a proxy exactly 50 m from both areas: A, `idx` 0);
   beyond the max → no join row at all, so `d` is NULL and the feature is
   counted "none within <max> m" (engine-pinned at a 40 m limit); `g IS NULL` →
   NULL and skipped, never counted as none-within; evaluated once per feature
   and copied to root and parts (engine-pinned on `B1`/`B1P` and `B2`/`B2P`);
   the log label is `proxyDistanceNote(proxy)` ("2D distance to the building
   centre" asserted). The nearest-id default, A11 and "Choose the property to
   copy" are the FORM's (Task 15) and unchanged; both now reach **Run's own
   reason** through the REAL registry entry, asserted as `<p>` in
   `useToolForm.test.tsx` and falsified by the mutation check above.
5. **Card, flip, registration, cleanup.** `line` = `"<n> buildings measured"`
   (`toLocaleString`), one caveat `{cause: "none within 500 m", count}`, then
   skipped; `summarise` renders "2 buildings measured · 1 none within 500 m ·
   0.0 s" through the real queue. `implemented: true` lands in the executor's
   commit, with the real-registry row reasons pinned in `eligibility.test.ts`
   and `CatalogueView.test.tsx`, the EXECUTORS list pinned in
   `register.test.ts`, and the `styleByResult` descriptor pinned end to end.
   The vector table is dropped by the queue's `finally` (exercised); the reader
   handle is released eagerly and in the executor's own `finally`. Every
   `vi.mock(".../insights/duckdb")` factory written here carries the full export
   list its module graph reads (copied verbatim from Join's two suites).

## Deviations from the brief (the requirements, and the engine, won)

- **`ST_Distance` → `ST_Distance_GEOS`** (finding D7 above). The brief pins the
  function name; requirement 4 pins the semantics, and the brief's function
  produces 0 for two of the three proxies. The unit suite asserts the core
  spelling and `ST_DWithin` are ABSENT from the statement so nobody simplifies
  back.
- **Identity.** The brief's `assertSourceIds(ctx.featureIds ?? [], <ids from the
result>)` is residual B1's rejected shape; replaced by the scope-rows +
  reader-ids pair before the compute, and the brief's two mock-call assertions
  became behavioural ones through the real function.
- **Mocks.** The brief mocked `readerQuery`/`assertSourceIds` wholesale; this
  suite `importActual`s them and wraps them in delegating spies, and its `query`
  answers PER STATEMENT (the brief's single-answer context would let the
  identity check pass by accident).
- **`line` is set explicitly**, not left to `summarise`'s default as the brief's
  `expect(out.line).toBeUndefined()` had it — requirement 5 names the field.
  This is belt-and-braces, not a semantic disagreement with the brief:
  `summarise`'s default already renders §7.7's exact sentence, so the card is
  identical either way, and it is asserted end to end through the real queue.
- **`DISTANCE_BATCH_ROWS` is 500**, not the brief's 5000: the Global
  Constraint's batch size and the same as every other executor. The yield is
  Join's shape (macrotask first, then `throwIfCancelled`), and the handle is
  released eagerly after the compute as well as in the `finally`.
- **Skip cause is `"no geometry"`**, the string Join and Height from extent use,
  not requirement 4's prose "no proxy geometry" (the brief's own code says the
  same); a second spelling for one skip is the drift the round-2 review flagged.
- **Extra file.** `distanceToNearestRun.test.ts` is not in the brief's file list;
  it is requirement 5's cancel/death/cleanup through the real queue.

## Self-review

- The three statement labels are "Reading features", "Checking source ids" and
  `proxyDistanceNote(proxy)` — the first two are Task 7's own, the third is
  §7.7's own sentence, so §6.4's log reads the same for a footprint distance run
  as for a solids run.
- `buildDistanceSql` and `buildJoinSql` are deliberately parallel; the only
  structural difference is the absence of Join's `COUNT("idx") OVER (…)` and
  `overlap`, which §7.7 has no use for. A reviewer can diff them.
- `ctx.phase("compute")` is called even when no reader was opened — a no-op in
  practice (the queue already put a vector-source run in `compute`), kept for
  the same reason Join keeps it.
- A run whose statement returns no rows returns an empty map and the queue's own
  "nothing to write" branch handles it.
- `ST_Distance_GEOS` in a LEFT JOIN's `ON` is a nested loop: N buildings × M
  source features GEOS calls. Fine for §7.7's own example (1,204 × a road
  layer); worth a look if someone runs 100k × 10k. `ST_DWithin_GEOS` in the `ON`
  would let the optimiser bound it, at the cost of two functions that could
  disagree at the boundary — noted, not taken.

## Concerns / notes for the commander

- **D7 belongs in the ledger and in Task 28's documentation**, beside Task 1's
  D1–D6. I did not edit the plan or the docs (out of scope for this task).
- **Task 29's gate smoke should measure one real distance in the browser** —
  the `wasm_eh` binary carries the symbol (verified by grepping the published
  extension), but nothing in this repo has yet CALLED a GEOS function under
  duckdb-wasm. If `ST_Distance_GEOS` were somehow unavailable there, the run
  would fail with a Catalog Error rather than answer wrongly, which is the safe
  direction.
- **Task 19 (Aggregate) is unaffected** but should not copy a distance measure
  from anywhere; its predicates are the correct ones.
- **The first commit's pre-commit hook ran on an empty staged set.** I passed
  `-c core.hooksPath=.husky` on the first `git commit` (a wrong path — the repo
  uses `.vite-hooks/_`), so no hook ran; I amended immediately with the real
  hooks, and lint-staged then reported "could not find any staged files" because
  an amend with nothing newly staged has none. The mitigation: the THIRD commit
  (`f32504a`) staged `distanceToNearest.ts` and `distanceToNearest.test.ts` —
  the two files of the first commit that carry logic — so `vp staged` did run on
  them. The registry one-liner, `register.ts` and the five migrated test files
  were covered only by whole-repo `npx vp check` (0 errors / 56 warnings) plus
  `npx tsc -b --noEmit`, both run before and after, with formatting applied by
  `vp check --fix`. The three later commits ran the hook normally. No hook was
  bypassed deliberately and none was skipped with `--no-verify`.
- The unbounded `IN` list on a Selected/Matching scope (Task 7's parked concern
  (c)) applies here too: the frozen ids reach three relations. Same park.
- `buildScopeRowsSql`/`buildSourceIdsSql` still live in `solidSql.ts`; Task 16's
  note that they deserve a neutral home stands, and Distance is now a second
  non-solid caller.
