# Task 12 — App-side reprojection and preflight — report

**Status:** DONE. Commit `292a840` on `develop` (`feat: reproject a vector layer app-side, with a counted preflight`), no trailers, hooks not bypassed, nothing pushed.

## Implemented

`src/features/processing/vectorSource.ts` (new, engine-free, no `insights/duckdb`, no second proj4 import):

- `reprojectGeoLayer(document, epsg, control?) → Promise<VectorPreflight>` — async, bounded batches, one `crsFromGeodetic` call per position, 2-D WKT (third ordinate dropped).
- `ProjectedFeature` = `{ idx (source order, gaps kept), stableId, featureId, properties, wkt }`.
- `VectorPreflight` = `{ features, skipped, propertyKeys, propertyTypes, polygonOnly }`.
- `YieldControl { checkpoint?() }` — called immediately before every yield, allowed to throw (`ctx.throwIfCancelled`), never caught or translated.
- `geoPropertyTypes(records)` — the ONE type rule (number anywhere → DOUBLE; else all-boolean → BOOLEAN; else VARCHAR; all-null → VARCHAR), shared by the form and preflight, and agreeing with `geoRecordColumns` about DOUBLE.
- `documentPropertyKeys(document)` — every LIVE feature's property keys, kept or skipped (residual B7's door).
- `documentGeometryKinds(document)` — geometry `type` strings, a collection reporting its MEMBERS.
- `documentHasFeatureIds(document)` / `documentHasFeatures(document)` — the two questions the form asks before any run (the plan's type ledger places both in this file; Task 15's step 5 will find them present).

## Tested

`tests/unit/features/processing/vectorSource.test.ts` — 35 tests, all passing. `crsFromGeodetic` mocked with the affine `x = lng*1000, y = lat*1000`, longitude 999 as the unprojectable sentinel, call counting through a `vi.hoisted` cell.

Coverage: polygon/multipolygon (holes, Z dropped), point/multipoint/line/multiline, stable id, feature id (string, numeric → text, absent → null), null/empty/unknown geometry skipped and counted, unprojectable coordinate skipped, non-finite and non-numeric positions skipped, source-order `idx` gaps, every-feature-skipped, non-GeoJSON document, bare `Feature`, property keys/types over all live features, envelope never exposed, structure rules (1-position line, 3-position ring, unclosed ring, malformed hole, empty multi-geometries), mixed document, GeometryCollections (same-family, mixed, nested, malformed member), the batched walk (checkpoint between feature batches, macrotask yield, yield inside one large feature, timer-delivered cancellation inside one 200k-position ring), `geoPropertyTypes`, `documentPropertyKeys`, `documentGeometryKinds`, `documentHasFeatureIds`, `documentHasFeatures`.

### TDD evidence

RED (test written first, module absent):

```
$ npx vitest run tests/unit/features/processing/vectorSource.test.ts
Failed to resolve import "../../../../src/features/processing/vectorSource" …
 Test Files  1 failed (1) | Tests  no tests
```

GREEN (after writing the module):

```
$ npx vitest run tests/unit/features/processing/vectorSource.test.ts
 Test Files  1 passed (1)
      Tests  35 passed (35)
```

Gates:

```
$ npx tsc -b --noEmit            → tsc: 0
$ npx vp check                   → Found 0 errors and 56 warnings in 553 files   (baseline held)
$ npx vitest run > /tmp/m3-task12-suite.log 2>&1 & wait $!  → suite: 0
  Test Files  256 passed | 4 skipped (260)
  Tests  3236 passed | 74 skipped | 1 todo (3311)
```

## Engine probe run for this task (throwaway, not committed)

Against this checkout's DuckDB 1.5.5 + `spatial` through the node blocking bindings (the same bundles `tests/integration/duckdb/harness.ts` uses), to settle requirement 2 before writing the WKT:

```
parse GC / parse MIXED       → round-trips verbatim
ST_Intersects(GC, poly)      → true
ST_CoveredBy(poly, GC)       → false (disjoint case), true (contained case)
ST_Area(ST_Intersection(GC, poly)) → 25 ; ST_Area(GC) → 150
ST_Centroid(GC)              → POINT (12.222…, 4.444…)
ST_Distance(GC, POINT)       → 20 ; ST_Distance(MIXED point/line, POINT (0 10)) → 5
ST_Union_Agg(GC)             → MULTIPOLYGON (…)
nested GEOMETRYCOLLECTION    → parses
```

No operation §7.5-§7.7 performs raises on a GeometryCollection, so the literal requirement (every collection → `GEOMETRYCOLLECTION (…)`) is safe for Tasks 16/17. Task 17's engine test can pin the distance 5.

## Files changed

- `src/features/processing/vectorSource.ts` (new, 522 lines)
- `tests/unit/features/processing/vectorSource.test.ts` (new, 763 lines)

Nothing else staged (`.github/hooks/`, `docs/design-history/`, `.superpowers/` left untracked).

## How each controller requirement was met

1. **B8 (bounded work).** The coordinate budget is spent POSITION by position (`spend` in `positionList`/`Point`), so `COORDINATE_BUDGET` 20,000 yields a macrotask inside a single ring; `FEATURE_BATCH` 500 bounds the other direction. Every yield calls `control.checkpoint()` first. Test `"stops inside ONE very large feature when Cancel lands on a timer"`: a `setTimeout(…, 0)` flips `cancelled`, the checkpoint throws, the walk rejects and the mocked `crsFromGeodetic` was called fewer than the ring's 200,000 times — proof it stopped INSIDE the feature. **Scope note:** `JSON.stringify`, `TextEncoder` and the final buffer copy the residual also names live in Task 13's `encodeProjectedFeatures` (`vectorTable.ts`), not in this module — this task owns only WKT assembly. The "must not retain every encoded chunk while copying" half must be carried into Task 13's dispatch; it cannot be satisfied here.
2. **B10 (GeometryCollections).** No skip branch: every collection converts to `GEOMETRYCOLLECTION (member, …)` with members rendered by the same recursion — same-family, mixed and nested alike. **This overrides the brief**, whose deviation 4 and test collapsed a same-family collection to `MULTIPOLYGON` and skipped a mixed one; both tests were rewritten. Justified by the probe above: nothing is re-spelt as a multi-geometry it is not, and DuckDB answers every operation on the collection. An EMPTY `geometries: []` is still skipped-and-counted, and one malformed member skips the whole feature. `polygonOnly` asks the FAMILY recursively, so a collection of areas still reads as areas.
3. **B7 (frozen-field check).** `propertyKeys`/`propertyTypes` are now computed over EVERY live feature's public properties, kept or skipped, and `documentPropertyKeys(document)` exports the same rule for a check against the live document at the queue head. **This overrides the brief**, whose `VectorPreflight.propertyKeys` was kept-only and whose test asserted a skipped feature's `ghost` key "never reaches the checklist" — that is exactly the false "Layer changed while running" the residual names, since Tasks 16/17 validate against `source.propertyKeys`. Geometry filtering (the `skipped` count) and property discovery are now separate passes over the same walk. Test: `"lists EVERY live feature's property keys…"` plus the `documentPropertyKeys` suite.
4. **Structure validation.** Point = 2 finite numbers (`Number.isFinite` on both, so a NaN never becomes `NaN NaN` WKT); LineString ≥ 2; ring ≥ 4 AND last position equal to first (shell and holes alike, compared after projection); Polygon ≥ 1 ring; Multi\* recurse and refuse an empty parts array; null/empty/unparseable/unknown type → skipped and counted; any unprojectable position skips the whole feature; the third ordinate is dropped everywhere.
5. **`ensureModelCrsLoadable` / one proj4 door.** `reprojectGeoLayer` takes an EPSG code, not a `CityModel`, so it cannot perform that await — the module header states the caller contract in capitals (Tasks 13 and 19 await it in the `"source"` phase), exactly as the brief intends. `crsFromGeodetic` is the only projection call; no `proj4` and no `@cityjson/navara-core` import was added.
6. **Pure/engine-free.** Imports are `ColumnType` (type-only), `publicGeoProperties`/`readGeoStableFeatureId`, `GeoRecord` (type-only) and `crsFromGeodetic`. No `insights/duckdb`, no `@navaramap/*`, no store, no DOM. The suite mocks only `cursorCrsReadout`.

## Self-review

- Commit message carries no trailer (`git log -1 --format=%B` is one line). Only the two intended files staged.
- `noUncheckedIndexedAccess`: `parts[0]`/`parts[parts.length-1]` are compared as `string | undefined` (a one-element ring cannot reach the closed check, which needs ≥ 4), `value[0]`/`value[1]` are read as `unknown` and narrowed.
- Lint baseline held at 0 errors / 56 warnings; no new warning.
- `MULTIPOINT` is rendered with bare positions (`MULTIPOINT (x y, x y)`), which DuckDB parses (probed).
- Ordinates round to 4 decimals via `Number(v.toFixed(4))`, which also removes exponent notation.
- `featuresOf` filters `features[]` to objects before indexing, so a literal `null` entry in a hand-built collection is neither kept nor counted and would shift later `idx` values. Unreachable on `normalizeGeoJsonDocument` output (its `clone` turns every entry into a record carrying an `index:N` envelope), and the brief made the same assumption — left as is, noted so it is not filed as a finding.
- `ToolSource`'s vector variant on `develop` (`runQueue.ts:146-156`, Task 11) already spells `propertyKeys` without a "kept features" claim and documents `propertyTypes` as "the SOURCE's property types, as preflight inferred them" — both read correctly under the all-features semantics; no edit was needed there.
- The `skipped` count is per FEATURE, never per part — §7.5's sentences are `features.length`/`skipped` arithmetic only; no sentence is formatted here.

## Concerns for the commander / reviewer

1. **Two brief tests were deliberately inverted** (same-family collection WKT; skipped feature's property key). Both are requirement-driven (B10, B7) and are called out above. Task 15's fields checklist and Tasks 16/17's head validation both read the all-features keys, which is now consistent with the form's own `geoPropertyTypes(geoRecords(document))`.
2. **Task 13 must still absorb the other half of residual B8** (bounded `JSON.stringify`/encoding and a final copy that releases chunks as it goes, e.g. `chunks[i] = undefined` or shift-and-copy). Nothing in this task can enforce it.
3. Task 17's engine test should pin the mixed-collection distance (5) against the `GEOMETRYCOLLECTION` WKT this module now emits; the probe above is throwaway, not a committed test.
4. `documentPropertyKeys` is exported but unconsumed until Tasks 15–17; the frozen-field fix is effective through `VectorPreflight.propertyKeys` alone, with `documentPropertyKeys` available where a check wants the LIVE document rather than what preflight read.

---

## Fix round 1 (review of `292a840`)

Worked on top of `develop` HEAD `665ddf8` (Task 13 landed in between and consumes this module; its public API is unchanged by these fixes and its suites stay green).

### Important — B8: WKT assembly is now bounded too

**Commit `3caefd5` — `fix: the WKT assembly is bounded by the same budget as the coordinates`.**

The reviewer was right: projection yielded every 20,000 coordinates, but `ringsOf` then joined a whole 200,000-element array synchronously, and the line/multi/collection branches joined unbounded arrays of parts. Three changes:

1. **The joins are gone.** `positionList` now accumulates its text POSITION BY POSITION (`text = \`${text}, ${point}\``, a V8 rope, O(1) per step) and returns a string instead of an array; it tracks `first`/`last`separately for the closure rule.`ringsOf`, `MultiLineString`, `MultiPolygon`and`collectionShape`accumulate their parts the same way. No`Array#join` over feature-sized data remains.
2. **Every copy the assembly makes is charged to the same budget.** New `spendText(text, …)` spends `ceil(text.length / TEXT_PER_COORDINATE)` (20 chars ≈ one position) and the new `wrap(keyword, body, …)` helper charges each `KEYWORD (body)` step. So wrapping a 4 MB ring costs ~200,000 units, exhausts the budget and yields — assembly is interruptible exactly where the megabytes are copied.
3. **`yieldToLoop` now checkpoints on BOTH sides of the macrotask**, matching `vectorTable.ts`'s `pause` (Task 13): a Cancel delivered by a timer can only land while the walk is parked, so a checkpoint taken solely before the yield reads state one batch stale.

New test `"stops during ASSEMBLY, after the feature's last coordinate is projected"`: one 200,001-position ring; the checkpoint arms a `setTimeout` only once `proj.calls >= ring.length` (i.e. projection for that feature is finished) and throws once it fires. It can only pass if assembly itself yields and the post-park checkpoint sees the cancel. It is caught by hand rather than with `rejects` so a failure does not print a multi-megabyte diff.

RED, re-run with the COMMITTED test file against `292a840`'s module (`git show 292a840:src/features/processing/vectorSource.ts` swapped in, then `git checkout --` to restore):

```
$ npx vitest run tests/unit/features/processing/vectorSource.test.ts -t "ASSEMBLY"
 ❯ tests/unit/features/processing/vectorSource.test.ts (37 tests | 1 failed | 36 skipped)
AssertionError: expected undefined to be 'cancelled' // Object.is equality
 ❯ tests/unit/features/processing/vectorSource.test.ts:722:48
      Tests  1 failed | 36 skipped (37)
```

(The first RED run used a `rejects.toThrow` form; it printed the whole resolved 4 MB preflight as a diff, which is why the committed test catches by hand.)

GREEN (after):

```
$ npx vitest run tests/unit/features/processing/vectorSource.test.ts
 Test Files  1 passed (1) | Tests  36 passed (36)
$ npx vitest run tests/unit/features/processing/       → 21 files, 382 passed | 1 todo  (Task 13's suites included)
$ npx tsc -b --noEmit                                   → 0
```

The module header was corrected in the same commit (both-sided checkpoint; assembly charged to the budget).

### Minor — the rounding-dependent closure is pinned

**Commit `db31a62` — `test: a ring that closes only after rounding is accepted, shell and hole`.** A shell whose last position is `4.00000001` and a HOLE whose last position is `4.20000001` both round to the first position's projected text, so the polygon is kept with `skipped: 0` and the exact WKT asserted. Behaviour-pinning, so it passed on the first run — proved discriminating by mutation: replacing `ordinate`'s `Number(value.toFixed(4))` with `String(value)` makes it fail (`expected 1 to be +0`, i.e. the feature is skipped). The mutation was reverted immediately; `positionList`'s doc comment now states the rule and why the projected text is the honest thing to compare.

### Minor — `documentHasFeatures` no longer copies

**Commit `8204de0` — `refactor: documentHasFeatures probes the feature array instead of copying it`.** It now narrows the document itself, answers `true` on a bare `Feature`, and otherwise returns `document.features.some(isRecord)` — short-circuiting on the first feature object, with no filtered copy. The comment's "one array length per layer" claim is replaced with what it actually does. Tests extended with `null`, a bare `Feature`, and a collection of junk entries (`[null, 7]` → false).

### Verification for the round

```
$ npx vp check            → Found 0 errors and 56 warnings in 555 files      (baseline held)
$ npx tsc -b --noEmit     → 0
$ npx vitest run > /tmp/m3-task12-fix1-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  257 passed | 4 skipped (261)
  Tests  3263 passed | 75 skipped | 1 todo (3339)
```

Files changed this round: `src/features/processing/vectorSource.ts`, `tests/unit/features/processing/vectorSource.test.ts`. Nothing else staged; no push; hooks ran on every commit.

### Notes

- `vectorSource`'s `YieldControl` contract is now "checkpoint on both sides of every yield", which is what `vectorTable.ts` already did — the two modules' walks behave identically for a caller passing `ctx.throwIfCancelled`.
- `${text}, ${point}` builds a V8 ConsString, so the copy `spendText` charges does not physically happen at each wrap; the wraps are charged AS IF they copied, which is what makes the walk yield where a naive `join` would have blocked. The reviewer's actual hazard — a synchronous join over 200,000 parts with no checkpoint in it — is gone.
- The only synchronous step left that a checkpoint cannot split is a single rope flattening when the finished WKT is first read (one `memcpy`), the same class as Task 13's accepted per-feature `JSON.stringify`.
