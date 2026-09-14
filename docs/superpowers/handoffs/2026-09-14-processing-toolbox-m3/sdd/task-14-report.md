# Task 14 — The building proxy — report

Branch `develop`, base `8e87e49`, three commits (no trailers):

- `23bdcbb` feat: one building-geometry proxy for every cross-layer tool
- `553549b` feat: the run log names the building geometry and records list parameters
- `480b069` test: the per-row bbox proxies run against the real engine too

Not pushed.

## Implemented

`src/features/processing/buildingProxy.ts` (new, pure, no engine import):

- `BuildingProxy = "footprint" | "rectangle" | "centre"`, `ProxyOption`, `ProxySqlInput`.
- `lodZeroLabel(table)` — the file's OWN LoD 0 LABEL off `table.lods` (`parseFloat(label) === 0`), never a suffix.
- `footprintAvailable(table)` — the ONE predicate the radio, `defaultProxy` and `proxyOptions` share (LoD 0 rung AND a reader).
- `proxyOptions`, `defaultProxy` (footprint, else CENTRE), `proxyLogLabel`, `proxyDistanceNote` (§7.7's slash list collapsed to the used proxy).
- `buildProxySql` — `(id, f, g)` per TABLE ROW. Footprint reads the reader `from` + LoD 0 column under a NULL guard and `ST_Force2D`; the bbox proxies read the table's `bbox` struct under `CASE WHEN "bbox"."xmin" IS NULL`. `whereIds` applies the frozen ids to BOTH the reader and the table relation. Throws when a footprint is asked for with no reader/column.
- `buildFeatureProxySql` — `(f, g)` per FEATURE. Footprint: §7's contributor rule as a `BOOL_OR(… ) OVER (PARTITION BY "f")` window plus `ST_Union_Agg(…) FILTER (WHERE "g" IS NOT NULL AND ("id" <> "f") = "parts")`, wrapped in an outer `CASE WHEN ST_IsEmpty("u") THEN NULL ELSE "u" END`. Bbox: `MIN`/`MAX` over every row of the feature (§7's "combined extent"), then `ST_MakeEnvelope` / `ST_Point`.

`src/ui/processing/runFormat.ts`: `buildingGeometryLine(run)` (frozen `params.proxy` → `proxyLogLabel`, em dash for no proxy or an unknown value) and `paramValue(value)` (object/list as JSON). `formatRunLog` uses both; `src/ui/processing/LogView.tsx` uses the same two, so Copy and screen cannot drift.

## Deviations from the brief (each forced, each named)

1. **`ST_Force2D` on the footprint branch** (controller requirement 3; the brief's SQL had none). Applied per ROW inside `buildProxySql`, so `ST_Union_Agg` runs on 2-D inputs and BOTH relations carry one contract; the bbox branches are unwrapped because `ST_MakeEnvelope`/`ST_Point` are already 2-D. The module doc names the consumers that rely on it (Task 16's `ST_CoveredBy`/`ST_Intersects`/`ST_Area(ST_Intersection)`, Task 17's `ST_Distance`, Task 19's predicates over the source city) and states the predicates accept Z, so the wrap is an output contract, not correctness. Task 16's only text assertion (`toContain('ST_GeomFromWKB("geometry_lod0")')`) still holds.
2. **The outer `ST_IsEmpty` CASE on the footprint aggregate** — found by the probe, not by reasoning. On real DuckDB 1.5.5 `ST_Union_Agg(g) FILTER (WHERE FALSE)` returns `GEOMETRYCOLLECTION EMPTY`, **not NULL**. The brief's own expectation (`{ f: "b2", a: null }`) was therefore wrong, and without the CASE a building with no footprint would reach Tasks 16/17/19 as "a proxy that matches nothing" (§6.2's 0) instead of "no proxy" (§6.2's NULL). Pinned as its own assertion in the probe. The unit test's exact string was updated after watching it go red.
3. **`footprintAvailable` exported** (requirement 4) — the brief inlined the predicate twice.
4. **Probe shape** (requirement 5): the two bbox proxies run over the REAL `two-buildings.city.json` at LoD 2.2, and the footprint proxy over a synthetic in-test CityJSON 2.0 with `MultiSurface` at `lod "0"`, registered as bytes. The brief's VALUES-based bbox case is kept (the fixture has no NULL-bbox row, and the NULL branch has nowhere else to live); the brief's VALUES-based footprint case is replaced by the reader-based one, which is strictly stronger (real `read_cityjson` + real MultiPolygon Z WKB).
5. **Naming.** The controller's context paragraph said `"extent-rect" | "extent-centre"`; the PLAN (line 461), the brief and Tasks 15/16/17/19 all say `"rectangle" | "centre"` (Task 15's `PROXIES` list and its `toMatchObject({ proxy: "centre" })` expectations). I kept the plan's literals — changing them would break every downstream task's text. Flagging it as instructed.
6. The LogView additions use `upsertRun` (that file's own precedent) rather than the brief's `setState({ runs })`, and add one case for an unknown `params.proxy`.

## Engine facts learned (worth carrying to Tasks 15–19)

- `ST_Union_Agg` over an empty filtered set → `GEOMETRYCOLLECTION EMPTY`, not NULL.
- The reader NORMALISES the LoD: a document saying `"lod": "0"` produces the column `geometry_lod0_0` (label "0.0"), and `lod => '0'` and `lod => '0.0'` both bind. This is exactly why `lodZeroLabel` returns the label from `table.lods` and nothing re-spells a suffix.
- `read_cityjson(…, lod => X)` returns a row for an object with no geometry at that LoD, with NULL `geometry_lod*` AND a NULL `bbox`.
- DuckDB prunes an unreferenced projection: `SELECT f FROM (<footprint over a solid LoD>)` does NOT raise; `SELECT f, ST_Area(g)` does. The probe selects the geometry.
- `two-buildings.city.json` at LoD 2.2: root `…0001` bbox 85000–85010 × 446000–446008, part1 85012–85016 × 446000–446005 (combined 16 × 8 = 128 m², centre 85008/446004), `…0002` 15 × 12 = 180 m², centre 85027.5/446006.

## Tested + results

TDD, red first, each RED captured:

1. `npx vitest run tests/unit/features/processing/buildingProxy.test.ts` → **RED**: `Error: Failed to resolve import ".../src/features/processing/buildingProxy". Does the file exist?`
2. `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts` → **RED** on the same missing import (`Test Files 1 failed (1) / Tests no tests`).
3. Module written → unit **GREEN** (19 passed); integration **RED** on the real engine: `expected { a: null, has_z: null } / received { a: 0, has_z: false }` for the feature with no LoD 0 geometry → the `ST_IsEmpty` fix → then **RED** again on `expected [Function] to throw` (projection pruning) → probe selects `ST_Area(g)` → **GREEN, 23 passed**.
4. The unit test's exact string then went **RED** (`× unions the PART rows' footprints`) against the new SQL; updated → **GREEN, 19 passed**.
5. `npx vitest run tests/unit/ui/processing/LogView.test.tsx` with the appended cases → **RED**: `× names the proxy the run used`, `× prints a structured parameter as JSON` (2 failed | 9 passed) → `runFormat`/`LogView` written → **GREEN**.

Verification gates:

- `npx vitest run tests/unit/ui/processing tests/unit/features/processing` → 38 files, 562 passed | 1 todo.
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts` → 23 passed.
- `npx tsc -b --noEmit` → exit 0.
- `npx vp check` → **Found 0 errors and 56 warnings in 558 files** (baseline held).
- Full app suite, once, backgrounded to a file: `npx vitest run > /tmp/m3-task14-suite.log 2>&1 & wait $!` → `suite: 0`; **259 passed | 4 skipped (263) files, 3294 passed | 78 skipped | 1 todo**. Run after the two `feat:` commits, i.e. over every source file this task changes; the later `480b069` is test-only (integration, opt-in, not in the default suite) and was gated by its own `DUCKDB_INTEGRATION=1` run (23 passed), `vp check` (0/56) and `tsc -b` instead of a second full suite.

## Files changed

- `src/features/processing/buildingProxy.ts` (new, 241 lines)
- `src/ui/processing/runFormat.ts`, `src/ui/processing/LogView.tsx`
- `tests/unit/features/processing/buildingProxy.test.ts` (new)
- `tests/unit/ui/processing/LogView.test.tsx` (+47)
- `tests/integration/duckdb/crossLayer.test.ts` (+~270: the LoD 0 document, the registration/drop, three cases, the per-row bbox assertions)

Nothing staged from `.github/hooks/`, `docs/design-history/`, `.superpowers/`; the plan is untouched.

## How each controller requirement was met

1. **Frozen ids on the footprint branch (round-1 B2).** The brief carries it (its own "restricts the READER relation to the frozen ids" case); `whereIds` is applied to the reader relation in `buildProxySql`, unit-asserted for both builders, and probed on the real engine with three buildings scoped to two — `P3` is absent from the result. The bbox side is probed scoped to one of the two fixture buildings.
2. **Contributor rule on the footprint only (round-1 B3).** The brief carries it. The window + FILTER implement it; the reader probe asserts **16 m² (the part), not 100 (the root) and not their union**, and the bbox probe asserts the WHOLE-feature combined extent (128 m² = root ∪ part boxes), which is §7's "combined extent" and deliberately not contributor-filtered.
3. **Z.** `ST_Force2D` wraps the footprint parse; doc comment names the consumers and says the wrap is a contract, not correctness. Probed behaviourally: the proxy's `ST_HasZ` is `false` while the same WKB unwrapped is `true`.
4. **LoD 0 only, and the predicate exported.** `lodZeroLabel` + `footprintAvailable(table)` (exported, unit-tested for all four combinations); footprint SQL throws if a caller ignores it; the probe pins that the builder's own text raises `Unsupported geometry type in WKB` on a solid LoD.
5. **Probe.** `buildProxySql`'s own rectangle and centre text (which the feature roll-up composes only on the footprint path, so it would otherwise never reach the engine, and which Task 16 reaches for) is run per row over the fixture table in `480b069`: root 10 × 8 = 80, part 4 × 5 = 20, lone building 15 × 12 = 180, with each row's own centre. Extended `tests/integration/duckdb/crossLayer.test.ts` inside the existing `describe` (one harness per file, per that file's comment): bbox proxies over the real fixture, footprint over the synthetic LoD 0 CityJSON registered as bytes, plus the retained VALUES case for the NULL-bbox branch. Run with `DUCKDB_INTEGRATION=1`.
6. **Mocks and copy.** `LogView.test.tsx` has no `vi.mock`; `crossLayer.test.ts`'s existing `insights/duckdb` factory needed no change (`buildingProxy` imports only `insights/sql` plus a type-only `LayerTable`, both erased/engine-free). Every user-visible string is the spec's: `Footprint (LoD 0)`, `Extent rectangle`, `Extent centre`, `LoD 0 footprints are not in this layer; the bounding-box centre is used.` (spec lines 663–667) and `2D distance to the building footprint / extent / centre` (spec 744–745). `Building geometry` is a descriptive log label, per the accepted ruling.

## Self-review / concerns

- **`ST_IsEmpty` on a NULL `u`**: `CASE WHEN ST_IsEmpty(NULL)` is NULL → the ELSE branch → `g` NULL. Correct either way; the aggregate cannot actually be NULL here.
- **An empty union of real geometries** (degenerate polygons) now reads as "no proxy" rather than "a proxy matching nothing". I believe that is right — the suite's own `ST_GeomFromGeoJSON` case makes the same argument — but Tasks 16/17/19 should keep treating `g IS NULL` as the single "no proxy" test and never add an `ST_IsEmpty` test of their own.
- **`buildProxySql`'s `(id, f, g)` relation is used only as `buildFeatureProxySql`'s inner relation today.** It stays exported because the plan's interface names it and Task 16 refers to its footprint arm.
- The reader's `bbox` is per-LoD (NULL for an object with no geometry at the requested LoD); the bbox proxies read the LAYER TABLE's `bbox`, not the reader's, so this does not reach them — but a future task that builds a bbox proxy from a reader relation should know.
- Three commits rather than the brief's one; the second bundles `paramValue` with the log row because both are the same §6.4 header render path and share one test file.
