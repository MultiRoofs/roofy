# Task 19 — Aggregate buildings per area — report

**Status:** DONE. Four commits on `develop` (base `91779a7`), not pushed, no trailers, hooks run every time.

```
0105058 feat: Aggregate buildings per area summarises buildings inside each area
ea3d077 feat: Style by result colours a vector layer by the run's first column
e66f708 test: the default count-only aggregate statement against a real DuckDB
819563f fix: an aggregate's count reaches the feature properties as a plain number
```

## Implemented

### `src/features/processing/tools/aggregatePerArea.ts` (new)

- `buildAggregateSql(input)` — ONE statement, §7.5's direction reversed:
  - `b` — `buildFeatureProxySql`'s per-FEATURE proxy relation (`f`, `g`), with
    the frozen scope ids applied to BOTH the browsing table and the reader
    relation (round-1 finding 2 is in `buildingProxy.ts` already and is reached
    by passing `ids`);
  - `v` — the VALUE relation, ROOT rows only
    (`WHERE "id" = COALESCE("feature_id","id")`, plus the scope's ids), one alias
    per DISTINCT source column, each read as `TRY_CAST(<col> AS DOUBLE)`;
  - `p` — `b LEFT JOIN v ON v."f" = b."f"`, so a feature with no value keeps its
    proxy row;
  - `m` — `FROM <areas> s LEFT JOIN p ON p."g" IS NOT NULL AND <predicate>`,
    projecting `s."sid"` plus `p.* EXCLUDE ("g")`. The areas are the LEFT side,
    which is what keeps an area with no buildings (count 0, sums NULL);
  - the outer `SELECT` — the aggregates qualified with `m` (`COUNT(m."f")` for
    count, `SUM`/`AVG`/`MIN`/`MAX` over the value alias), `GROUP BY m."sid"
ORDER BY m."sid"`, plus THREE uncorrelated scalar sub-selects over the same
    CTEs: `multi_n` (buildings whose `COUNT(DISTINCT "sid") > 1`),
    `buildings_total` (`COUNT(DISTINCT "f")` over `m`) and `no_proxy_n`
    (`COUNT(*) FROM p WHERE p."g" IS NULL`). So the whole compute is one
    statement.
  - `within` → `ST_CoveredBy` (boundary-inclusive, D6); `intersects` and
    `centreWithin` → `ST_Intersects`; `centreWithin` FORCES the centre proxy and
    drops the reader clause.
- `aggregatePerArea: ToolExecutor` — owns its own `"source"` phase, because the
  reprojected side is the TARGET's areas and only the executor knows that:
  `ensureModelCrsLoadable(ctx.layer.model)` (awaited — `crsFromGeodetic`'s guard
  is synchronous), `epsgForLayer`, `reprojectGeoLayer(target.layer.config
.preparedData, epsg, {checkpoint})`, §7.6's `"The layer has no areas"` for an
  empty preflight, §7.5's `"N areas skipped: invalid geometry"` warning,
  `createVectorTable({runId, preflight, query, control, signal})`; then
  `readSource` on the footprint path, `ctx.phase("compute")`, §6.1's id join (see
  requirement 1), the compute through `readerQuery` on the footprint path and
  `ctx.query` otherwise, an eager reader release once the parse is done, and both
  handles released in a `finally` on every exit.
- The result: every target feature initialised to NULL and the evaluated rows
  overlaid, each value through `num()` so a BIGINT `COUNT` reaches the feature
  properties as a plain number (deviation 8); `measured` = the distinct
  buildings aggregated over; `skipped` = `{cause: "no geometry", count}`; `line` =
  `"<areas> areas aggregated over <buildings> buildings"`; `caveats` = one
  `{cause: "buildings counted in more than one area", count}` when it happened.
- `registerExecutor("aggregate-per-area", aggregatePerArea)`; `tools/register.ts`
  imports it.

### `src/features/processing/toolRegistry.ts`

`implemented: true` for `aggregate-per-area`, in the same commit as the executor.
The `styleByResult` descriptor (`kind: "attribute"`, `pick: firstWritten`) was
already there from Task 9/15 and is unchanged — only the flip was needed.

### `src/ui/processing/RunFooter.tsx` — Task 9's `kind: "attribute"` branch, completed

New module-level `styleGeoLayerByAttribute(run, layerId, column)`: re-reads the
run (`stale` / `status !== "done"` → abandon), finds the layer in
`useGeoLayerStore` narrowed to `kind === "geojson"` (gone → silent return),
reads `config.preparedData ?? config.data` and writes
`style.colorByAttribute = {attribute: column.name, categories: categoriesFor(document, column.name)}`
through `updateGeoLayer` (the WHOLE style, as `GeoLayerPatch.style` requires),
then `requestSection(layerId, "style")` LAST.

`start()` dispatches on `descriptor.kind === "attribute"` at the TOP of its async
body — **before** `readStyleValue` and before the city-layer lookups. That
placement is the fix, not a style choice: the old stub sat after
`useLayerStore.getState().layers.some(l => l.id === layerId)`, and a vector
target's id is not in that store, so the branch was unreachable for the only tool
that has the descriptor. No engine round trip happens on this path.

## Tested + results

New:

- `tests/unit/features/processing/aggregatePerArea.test.ts` (24 cases) — the SQL
  as a string (8) and the executor over a fake `ToolContext` whose `query`
  answers PER STATEMENT (16), with the REAL `readerQuery`/`assertSourceIds`
  (`importActual` + delegating spies, Task 16's precedent) and the REAL
  `reprojectGeoLayer` (proj4 replaced by a deterministic affine). Only
  `readSource`, `createVectorTable` and `ensureModelCrsLoadable` are stubbed.
- `tests/unit/features/processing/aggregatePerAreaRun.test.ts` (6 cases) — the
  REAL executor on the real queue, the real table FIFO, the real `readSource` and
  `createVectorTable` and §7.6's real publication: the happy path (both handles
  registered and dropped, the `DROP TABLE`, no `ALTER TABLE`/`BEGIN` on the city
  table, a free FIFO), a Cancel and an engine DEATH under a held aggregate
  statement, §6.1's id-join failure, and requirement 2 end to end.

Additions:

- `tests/integration/duckdb/crossLayer.test.ts` (+3 cases, 36 total) — the
  builder's own text against real DuckDB 1.5.5.
- Migrations forced by the flip (all in the executor's commit):
  `register.test.ts` (EXECUTORS pin), `eligibility.test.ts` (the four patched
  definitions become the REAL entry; "keeps the real Aggregate row at 'Not
  available yet' until Task 19" becomes "accepts the real Aggregate entry on a
  ready vector target", `ok: true`), `CatalogueView.test.tsx`,
  `extensionChip.test.tsx`, `ToolView.test.tsx`, `useToolForm.test.tsx` (its
  whole `toolRegistry` patch mock retired — the set is empty now).
- `tests/unit/ui/processing/styleByResult.test.tsx` (+1 case) — §7.6's Style by
  result through the REAL footer AND the REAL style section.

Results:

```
npx vitest run tests/unit/features/processing   → 30 files, 566 passed
npx vitest run tests/unit/features/processing tests/unit/ui/processing
  → 45 files, 766 passed (before the fix commit's two cases)
npx vitest run tests/unit/ui             → 92 files, 932 passed
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
  → 36 passed
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
  → 4 files, 94 passed (before the count-only probe; 95 with it)
npx vitest run > /tmp/m3-task19-suite.log 2>&1 & wait $!   → suite: 0
  → 271 files passed | 4 skipped; 3530 passed | 95 skipped
  (run twice: once before the fix commit — 3529 — and once after it)
npx tsc -b --noEmit → clean
npx vp check → 0 errors and 56 warnings   (baseline)
```

## TDD evidence

**RED 1 — the unit suite before the module existed:**

```
$ npx vitest run tests/unit/features/processing/aggregatePerArea.test.ts
Failed to resolve import ".../src/features/processing/tools/aggregatePerArea"
 Test Files  1 failed (1)      Tests  no tests
```

**GREEN** after the executor: `Tests 22 passed (22)`.

**RED 2 — the DOUBLE cast, found by the engine probe.** The first run of the new
engine cases failed on the SUM alone:

```
- "bld_sum_roof_area_m2": 70          (expected)
+ "bld_sum_roof_area_m2": "\"700\""   (received)
```

A `VALUES` fixture's `50.0` is DECIMAL, and a SUM over DECIMAL comes back as a
scaled HUGEINT. `numericColumnsOf` offers DECIMAL and every integer type, so this
is reachable from a real layer, and the column has already been declared DOUBLE
by `aggregateColumns`. A unit assertion was added FIRST and watched fail —

```
$ npx vitest run tests/unit/features/processing/aggregatePerArea.test.ts
 × reads the value as a DOUBLE, which is the type the column was declared
      Tests  1 failed | 22 passed (23)
```

— then `TRY_CAST(<col> AS DOUBLE)` went into the `v` CTE (TRY\_, because a frozen
bag can name a column a rebuild has since made text; §6.2's rule for a value
that could not be read is NULL, not a failed run). `Tests 23 passed` and
`36 passed` on the engine.

**RED 3 — the flip.** With `implemented: true` and nothing else changed:

```
$ npx vitest run tests/unit/features/processing tests/unit/ui/processing
 FAIL eligibility.test.ts > keeps the real Aggregate row at 'Not available yet' until Task 19
 FAIL CatalogueView.test.tsx > lists the three groups and marks unavailable tools with a reason
 FAIL ToolView.test.tsx > an unimplemented tool promises nothing > prints no column list …
 FAIL extensionChip.test.tsx > puts §5's download reason on a SHIPPED spatial tool's own row
      Tests  4 failed | 762 passed (766)
```

All four migrated in the SAME commit (no commit leaves the suite red):
`766 passed`.

**RED 4 — Style by result's attribute branch:**

```
$ npx vitest run tests/unit/ui/processing/styleByResult.test.tsx
 × opens §7.6's STYLE section on the FIRST output column, categories filled
   expected { layerId: "dc46f6c0…", section: "style" }   received null
      Tests  1 failed | 10 passed (11)
```

— the unreachable-branch defect, exactly. GREEN after the early dispatch and the
new helper: `Tests 11 passed (11)`.

**RED 5 — the BIGINT count.** Raised in review, and the seam was checked FIRST:
`insights/duckdb.ts:656-667` (`toRows`) already narrows a BigInt to a Number, so
the failure is not reachable through the real engine today — but the VECTOR path
has no values file and no replacer behind it, and the executor was borrowing that
promise rather than keeping the one its own DOUBLE columns make. A stub answering
`2n` showed it:

```
$ npx vitest run tests/unit/features/processing/aggregatePerArea.test.ts
 × publishes a COUNT as a plain number, whatever the engine handed back
   expected { bld_buildings_n: 2n, …(1) } to deeply equal { bld_buildings_n: 2, …(1) }
      Tests  1 failed | 23 passed (24)
```

GREEN after `values[column.name] = num(row[column.name])`, and the run suite's
engine mock now answers BIGINT counts too, so the PUBLICATION is pinned as well
(mutation-checked: reverting the coercion fails three cases across the two
files).

**Mutation check on requirement 2.** The NULL-init loop was removed and both of
its tests failed, so neither passes by accident:

```
 × writes NULL over an area preflight could not use, never stale values
 × writes NULL over an area whose geometry became unusable
      Tests  2 failed | 27 passed (29)
```

## Files changed

```
src/features/processing/tools/aggregatePerArea.ts            (new)
src/features/processing/tools/register.ts
src/features/processing/toolRegistry.ts
src/ui/processing/RunFooter.tsx
tests/unit/features/processing/aggregatePerArea.test.ts      (new)
tests/unit/features/processing/aggregatePerAreaRun.test.ts   (new)
tests/unit/features/processing/register.test.ts
tests/unit/features/processing/eligibility.test.ts
tests/unit/ui/processing/CatalogueView.test.tsx
tests/unit/ui/processing/ToolView.test.tsx
tests/unit/ui/processing/extensionChip.test.tsx
tests/unit/ui/processing/useToolForm.test.tsx
tests/unit/ui/processing/styleByResult.test.tsx
tests/integration/duckdb/crossLayer.test.ts
```

## Deviations from the brief (the requirements won)

1. **§6.1's id join is DONE, not skipped.** The brief's Step 3 stated
   `assertSourceIds` was "deliberately not used" and its Step 1 test asserted
   `expect(assertSourceIds).not.toHaveBeenCalled()`. Controller requirement 1 and
   Strand B round-2 finding 1 say the opposite, and the requirements win: on the
   footprint path the executor reads its OWN scope rows
   (`buildScopeRowsSql(ctx.table.table, ctx.featureIds)`) and the reader's ids
   (`buildSourceIdsSql`), and calls `assertSourceIds` BEFORE the compute — Task
   16/17's shape verbatim, imported rather than re-spelled. The brief's test case
   was inverted, and six parameterised cases were added (a missing ROOT and a
   missing PART, under All / Selected / Matching) plus the end-to-end one in
   `aggregatePerAreaRun.test.ts`. The two bbox proxies issue neither statement
   and call neither door (asserted: `sql` has length 1).
2. **The multi-membership caveat's `cause` carries the NOUN.** Requirement 3
   spells the cause as `"counted in more than one area"`, but `summarise`
   (`runQueue.ts:373`) renders `` `${count} ${cause}` `` — so that spelling would
   print "14 counted in more than one area". The brief's spelling
   (`"buildings counted in more than one area"`, singular-picked) is what
   produces §7.6's own sentence "14 buildings counted in more than one area",
   which is the string the requirement itself names, so the brief's form is used.
3. **The skipped cause is `"no geometry"`.** Requirement 4 describes it as "no
   proxy geometry"; the spec's skip-cause STRING is "no geometry" (spec lines
   537, 600, 618) and Join already uses it. "no proxy geometry" is the spec's
   description of the condition (§6.2's value rule), not the rendered cause, so
   the shared string is kept — one cause spelling across the toolbox.
4. **`signal` is passed to `createVectorTable`.** The brief passed only
   `control`. Every engine await reached from the table FIFO is raced against the
   abort AND the death (Global Constraints), and `createVectorTable`'s
   `registerBuffer` is one; without the signal the race would be death-only.
   Asserted in the unit suite.
5. **`TRY_CAST(... AS DOUBLE)` in the value relation** — see RED 2. Not in the
   brief.
6. **Extra test file** `aggregatePerAreaRun.test.ts` is not in the brief's list;
   it is requirement 6's "cancel/death/cleanup through the real queue".
7. **Extra engine case** for the DEFAULT count-only statement (no `v` CTE), which
   is the statement most runs will send and which the brief's single case did not
   cover.
8. **The written values go through `num()`.** Not in the brief; Join's
   precedent (`num(row[column.name]) ?? 0` on its match count) and RED 5's
   reasoning. Every column this tool declares is a DOUBLE, so coercing is
   keeping a promise rather than changing a value: `num(2n)` is `2`, a null
   stays null, and the sums and means are already numbers.
9. **`ToolView.test.tsx`'s "an unimplemented tool promises nothing"** had to
   change meaning rather than be deleted: no registry entry is
   `implemented: false` any more. The block now asserts that Aggregate prints its
   column list and its geometry verdict, and its header points at the two suites
   that still pin the guard on a PATCHED definition (`useToolForm.test.tsx`,
   `lodSelect.test.tsx`) — so the global constraint keeps its coverage.

## How each controller requirement was met

1. **Scope-wide source identity (B1).** As in deviation 1: the footprint path
   reads its own scope rows off the table and the reader's ids, and compares them
   through the REAL `assertSourceIds` before the compute — never `ctx.featureIds`
   (null on scope "all"), never off the aggregate's own result (whose rows are
   AREAS). Six unit cases (missing root / missing part × All / Selected /
   Matching) assert `SOURCE_IDS_DIFFER`, that the aggregate statement never ran,
   and that both handles were released; the run-level suite pins the same through
   the real queue. The bbox proxies read the browsing table only and check
   nothing. The AREAS get no identity check of their own — they come from the
   vector table this executor just built, and the target document's identity is
   Task 18's check immediately before the publication.
2. **Every target feature is written (round-1 B12).** `blank` (every output
   column → NULL) is set for `geoRecordId(record)` of EVERY `target.records`
   entry first; the statement's rows are then overlaid. Two tests, both
   mutation-verified: the unit case (an area whose geometry preflight could not
   use comes back all-NULL, and the card counts the EVALUATED areas — "1 area
   aggregated over 4 buildings") and the end-to-end case in the run suite (the
   first run populates both areas, the layer's prepared document then loses z2's
   geometry, and the second run writes NULL over z2's previous `0` rather than
   leaving it under the new run's provenance).
3. **Membership.** Nothing de-duplicates the `s LEFT JOIN p` — a building counts
   for every area it satisfies the predicate with, pinned on the real engine with
   two zones sharing the edge `x = 5` and a building spanning it (`count` 2 and 1,
   its value summed into both, `multi_n: 1`, `buildings_total: 2`). `within` is
   `ST_CoveredBy`; `centreWithin` forces the centre proxy. The buildings side is
   `buildFeatureProxySql`'s per-FEATURE relation and the values come from the
   ROOT rows only — the engine fixture has a part (`b1p`) carrying the same
   value, and the sum answers 70 rather than 120. ONE caveat carries the
   multi-membership count.
4. **Card.** `line` = `"<areas> areas aggregated over <buildings> buildings"`
   (`toLocaleString`, so "1,204"), singular-picked on both halves. The caveat
   renders between the line and the skipped count (`summarise`'s order), and
   `skipped` is `{cause: "no geometry", count}` for the buildings with no proxy.
   The areas preflight dropped are §7.5's warning on the run
   ("1 area skipped: invalid geometry"), which is what §7.6 adopts.
5. **Style by result.** Task 9's `kind: "attribute"` branch is complete (see
   Implemented) and tested through the REAL footer and the REAL `StyleSection`:
   the click writes `colorByAttribute` with the FIRST output column and the
   categories `categoriesFor` reads off `preparedData` (`3 → PALETTE[0]`,
   `7 → PALETTE[1]`), `requestedSection` is `{layerId, section: "style"}`, no rule
   draft is written and `runQuery` is never called; then the real style section
   renders with the select on `bld_buildings_n` and a swatch per category.
6. **The flip and its consequences.** `implemented: true` lands in the executor's
   commit, with the EXECUTORS pin (`register.test.ts`), the real-registry row
   reasons (`Needs a vector layer` on a city-only workspace, in both
   `eligibility.test.ts` and, rendered, `CatalogueView.test.tsx` +
   `extensionChip.test.tsx`; A3 `Add a city model layer to aggregate`, A4's two
   `This vector layer is still loading` / `could not be loaded`, and §7.6's
   `The layer has no areas` from the executor), and the engine suite running the
   BUILDER's own text under `DUCKDB_INTEGRATION=1` — including the
   boundary-both-areas case and the all-NULL `mean` area (`bld_buildings_n: 1`,
   `bld_mean_roof_area_m2: null`). Both handles are released in a `finally`;
   cancel, engine death and cleanup go through the real queue in
   `aggregatePerAreaRun.test.ts` (both VFS names dropped,
   `DROP TABLE IF EXISTS "__src_<id>"`, no `BEGIN`, nothing published, a free
   FIFO).
7. **Mock factories.** The two new suites' `insights/duckdb` factories carry the
   full export list their module graphs read (`vectorTable` and `sourceRead` both
   reach it); `vectorTable` and `sourceRead` themselves are mocked as
   `importActual` + overrides, so no export can go missing. `layerTables` is NOT
   mocked in either file (the run suite uses the real registry and FIFO). Every
   user-visible string is copied verbatim from the spec or from the plan's copy
   table (A12's `The layer has no areas`, A17's row copy is Task 15's).

## Self-review

- `buildings_total` is `COUNT(DISTINCT "f")` over `m`, so it counts the buildings
  that fell in AT LEAST ONE area — not every scoped building. That is the reading
  of "aggregated over 1,204 buildings" I committed to: a building outside every
  area contributed to nothing. The brief's own fixtures assume the same
  (2 + 2 − 1 = 3).
- `epsgForLayer` returning null is folded into §7.6's `"The layer has no areas"`,
  which is the same outcome the QUEUE gives a vector SOURCE for a city layer with
  no usable CRS ("every area failed to reproject"). A city layer always has a
  recognised metric CRS (the loader refuses the others), so the branch is not
  reachable in practice.
- `ctx.phase("source")` then `ctx.phase("compute")`: the queue puts a
  non-`needsReader` run in `compute` before the executor runs, so the progress
  block shows Computing for one frame before Reading source. Join has the same
  shape and it is honest — the executor really is reading a source.
- The three card scalars are read off `out.rows[0]`. They are uncorrelated
  sub-selects, so every row carries the same value; a statement that answered no
  rows at all (a target whose every area was dropped — impossible, preflight
  already refused that) would read 0 everywhere, which is what an empty run is.
- `query: (label, statement) => ctx.query(label, statement)` rather than
  `ctx.query`: `typescript(unbound-method)` flags the detached method and the
  56-warning baseline is a gate. Measured (57 → 56).
- The BIGINT coercion is defence in depth, not a bug fix against observed
  behaviour: `toRows` narrows at the seam today. It is in the executor because
  the vector publication has nothing else between the engine and the feature
  properties, unlike the city path's typed values file.
- Duplicate output names (two rows resolving to one column) are refused by
  `crossLayerParamsError`; a hand-edited frozen bag carrying them would emit two
  identical aliases and the later would win in the row map. Not defended against
  — the same position every other executor takes on a bag validation refuses.
- No browser check was run (the host is headless and the change is panel-level;
  the footer and the style section are both driven by their real components in
  jsdom). The brief's Step 6 suggests one for the catalogue rows — worth a
  commander smoke if one is being done anyway.

## Concerns (for the commander, not fixed here)

- **`solidSql.ts` is still where `buildScopeRowsSql` / `buildSourceIdsSql` live.**
  Task 16's report already flagged the misleading name; this is the third tool
  importing them from a module named for the solids tools. A rename to something
  neutral is a one-commit sweep, not this task's file.
- **The unbounded `IN` list** on a Selected/Matching scope now reaches FOUR
  relations here (the proxy's table or reader, the value relation, and the two
  identity statements). Task 7's parked concern (c), same park.
- **A DECIMAL or BIGINT source column is now cast to DOUBLE** for the aggregate.
  That is the declared output type, but it means a `min`/`max` over a HUGEINT
  column loses precision above 2^53. The alternative (declaring the output type
  from the source column) would make `aggregateColumns` context-dependent, which
  Decisions item 6 (iii) deliberately refused.
- **Task 22's insertion point is untouched**: Aggregate's publication is still
  Task 18's one contiguous vector block, so Strand C finding 1's requirement (the
  New-layer dispatch goes BEFORE it) is unaffected by anything here.
