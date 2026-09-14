# Task 3 report — `solidLodOptions`, and the contributor walk both LoD answers share

**Status: DONE.** One commit on `develop`: `e162753` `feat: answer "has a solid at this LoD" from surface tags`.

## Implemented

Exactly the brief's seven steps, no more.

1. **`src/features/processing/roofGeometrySource.ts`** — the two-question tags walk (`lodTagsByObject`, returning `{ geometry, roof }`) is split in two, as the brief's "the refactor splits the tags walk in two, and that is deliberate" prescribes:
   - `geometryLodsByObject(layer)` (exported; the plan's "New exported names" contract, plan line 681) — TAGS ONLY, every LoD each object has ANY geometry at. Static: `surface.lod`. Streaming: the resident record's `geometryLods`.
   - `roofLodsByObject(layer)` (module-private) — the LoDs each object has a `RoofSurface` at; streaming reads the pre-computed `roofMetrics`' own LoD.
   - `lodOptionsBy(layer, qualifies)` (exported) — §7's contributor rule, the FEATURE counting and the highest-detail-first ordering, with `qualifies` applied **per contributor, after** the contributors have been chosen by ANY geometry at the LoD. The doc comment carries the brief's warning verbatim about why the qualifier is never the contributor selector (the 3D BAG double count).
   - `roofLodOptions(layer)` is now a one-line wrapper: `lodOptionsBy(layer, (id, lod) => roof.get(id)?.has(lod) ?? false)`.
   - `LodOption.features`' doc comment, which sat directly above the replaced block and said "FEATURES with at least one ROOF surface at this LoD", now names the kind the tool needs and both callers — it would otherwise have lied for the solid caller from this commit onward.
2. **`src/features/processing/solidGeometrySource.ts`** (new) — `hasSolidAt(layer)` builds a per-object LoD set once and then answers O(1); `solidLodOptions(layer) = lodOptionsBy(layer, hasSolidAt(layer))`. `SOLID_TYPES` is `new Set<CityJSONGeometryType>(["Solid", "MultiSolid", "CompositeSolid"])`. A streaming layer returns `() => false` / `[]`. The static/streaming split for solids lives in this file only.

**The positive test, explicitly.** `hasSolidAt` reads `surface.lod !== null && geometryType != null && SOLID_TYPES.has(geometryType)`. The `!= null` is a **TypeScript narrowing guard** in front of a positive set-membership test (`Surface.geometryType` is `CityJSONGeometryType | null | undefined`), not the forbidden `!== null` / `!== undefined` solid criterion: the decision is made entirely by `SOLID_TYPES.has`, so an absent tag (hand-built literal, CityGML surface) and an explicit `null` (CityParquet) both fall out `false`, as do `"MultiSurface"`, `"CompositeSurface"` and every other CityJSON geometry type. This is exactly why solid detection keys on the CityJSON geometry-type TAG Task 2 added and never on WKB (plan finding **D4**: a CompositeSolid's WKB type name is `"GeometryCollection Z"`).

**Not touched:** `src/ui/processing/useLodOptions.ts` (line 49 still calls `roofLodOptions(target)`). Wiring `solidLodOptions` into it belongs to Task 8's single commit, together with the `implemented` flip.

## TDD evidence

### RED — before any source change

Both new tests were written first (Step 1's file and Step 5's `lodOptionsBy` describe plus the widened destructure), then run:

```
$ npx vitest run tests/unit/features/processing/solidGeometrySource.test.ts \
    tests/unit/features/processing/roofGeometrySource.test.ts
```

```
 FAIL  tests/unit/features/processing/solidGeometrySource.test.ts [ … ]
Error: Failed to resolve import "../../../../src/features/processing/solidGeometrySource"
  from "tests/unit/features/processing/solidGeometrySource.test.ts". Does the file exist?

 FAIL  …/roofGeometrySource.test.ts > lodOptionsBy > applies `qualifies` AFTER the contributor rule, never as the selector
TypeError: lodOptionsBy is not a function

 FAIL  …/roofGeometrySource.test.ts > lodOptionsBy > measures nothing
TypeError: lodOptionsBy is not a function

 Test Files  2 failed (2)
      Tests  2 failed | 11 passed (13)
```

Failing for the intended reasons: the solid module does not exist, `lodOptionsBy` is not exported — and the **11 existing roof cases passed unchanged**, which is the baseline the refactor had to preserve.

### GREEN — after Steps 3 and 4

```
$ npx vitest run tests/unit/features/processing/solidGeometrySource.test.ts \
    tests/unit/features/processing/roofGeometrySource.test.ts \
    tests/unit/ui/processing/lodSelect.test.tsx
 Test Files  3 passed (3)
      Tests  32 passed (32)
```

(Re-run after the formatter reflowed the two test files: same 3 files / 32 tests passed.)

## Verification

| Gate                                         | Command                                                   | Result                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint baseline (captured **before** any edit) | `npx vp check`                                            | `Found 0 errors and 56 warnings in 531 files`                                                                                                                                                                                                                                     |
| Lint after                                   | `npx vp check`                                            | `Found 0 errors and 56 warnings in 533 files` — and a per-rule `diff` of the baseline and after logs (`await-thenable` 3, `no-base-to-string` 9, `no-floating-promises` 7, `no-redundant-type-constituents` 3, `unbound-method` 12) is **IDENTICAL**. No new warning of any kind. |
| Types                                        | `npx tsc -b --noEmit`                                     | exit 0                                                                                                                                                                                                                                                                            |
| Full app suite (background, to a file)       | `npx vitest run > /tmp/m3-task3-suite.log 2>&1 & wait $!` | `suite: 0` — `Test Files 244 passed \| 4 skipped (248)`, `Tests 3004 passed \| 67 skipped (3071)`                                                                                                                                                                                 |

One interruption worth recording: the first `vp check` after the edits **failed on formatting** in the two test files (the brief's `await import(...)` destructure and the appended describe). `npx vp check --fix` reflowed them, the focused suites were re-run green, and the second `vp check` is the 0/56 above — so the pre-commit `vp staged` had nothing left to rewrite under the commit.

## Files changed

- `/data2/hideba/multiroof-viewer/src/features/processing/roofGeometrySource.ts` (modified)
- `/data2/hideba/multiroof-viewer/src/features/processing/solidGeometrySource.ts` (new)
- `/data2/hideba/multiroof-viewer/tests/unit/features/processing/roofGeometrySource.test.ts` (modified)
- `/data2/hideba/multiroof-viewer/tests/unit/features/processing/solidGeometrySource.test.ts` (new)

Nothing else staged: `git status` after the commit still shows only the pre-existing untracked `.github/hooks/` and `docs/design-history/`; `.superpowers/` is untouched by the commit. No submodule change (Task 2 already landed the tag; pointer is `82949ed`). The plan was not edited.

## Self-review

- **Completeness.** All four prescribed files; all four prescribed exports (`geometryLodsByObject`, `lodOptionsBy`, `hasSolidAt`, `solidLodOptions`) with the signatures from the brief's Interfaces block. Every one of the brief's ten new test cases is present and green (`hasSolidAt` 3, `solidLodOptions` 5, `lodOptionsBy` 2).
- **Behaviour preserved byte-for-byte for the roof tests.** `git show HEAD -- tests/.../roofGeometrySource.test.ts` is exactly two hunks: the destructure gains `lodOptionsBy`, and a new `describe` is appended. **No existing assertion, fixture or comment was edited** — which is what makes this a refactor rather than a rewrite. The counting loop in `lodOptionsBy` is the old body with `tags.get(id)?.geometry` → `geometry.get(id)` and the roof predicate → `qualifies`; the sort, the null-LoD exclusion and the `count > 0` filter are unchanged.
- **Tags only.** Neither new function imports or reaches `computeRoofMetrics`, and nothing walks a ring. Both "measures nothing" tests (the roof file's existing one and the new `lodOptionsBy` one) assert it through the module's real `computeRoofMetrics` spy, so it is an executable fact rather than a comment.
- **Tests assert behaviour.** Every assertion is on a returned value (`hasSolidAt`'s boolean, `solidLodOptions`' option array), never on a mock's call log — except the two deliberate `measured` assertions, which are the CPU contract itself. `residentModel` is mocked only as a data source, which is the existing pattern in the sibling suite.
- **Names / YAGNI.** No helper, option, flag or abstraction beyond the brief. `roofLodsByObject` is module-private because nothing outside needs it. `geometryLodsByObject` is exported although only `lodOptionsBy` calls it today — that is the plan's contract (line 681), not an invention; it is the map the next qualifier-based LoD answer reads.
- **Copy / UI / SQL.** None reached: no user-visible string, no component, no SQL, no persisted field, no `duckdb.ts` export, so the mock-factory sweeps and the snapshot rules do not apply.
- **Commit hygiene.** One commit, `feat:` prefix, no trailer of any kind (verified with `git log -1 --format='%B' | cat -A`), hooks ran normally (not bypassed), nothing pushed.

## Concerns

1. **A streaming `roofLodOptions` now calls `getResidentModel` three times** (`roofLodsByObject`, `geometryLodsByObject`, `featureIdsByObject`) where it previously called it twice, and a static one walks the model twice instead of once. This is the brief's explicitly accepted cost ("Reading the model twice for `roofLodOptions` is a second O(surfaces) pass with no measurement in it, behind the `useMemo` in `useLodOptions`") — recorded as plan-accepted, not as something left undone. `getResidentModel` returns the live resident snapshot cheaply and the extra pass measures nothing.
2. **`geometryLodsByObject` has no external caller yet.** Exported per the plan's contract; if no later task consumes it, a follow-up could drop the `export` keyword without touching a line of logic.
3. **Task 8 still owns the wiring.** `useLodOptions` does not yet know `solidLodOptions`, so nothing user-visible changes in this commit — deliberate, per the rule that a tool flips `implemented` in the same commit that extends `useLodOptions`.
4. **No `CompositeSolid`/`MultiSolid` fixture reaches the parser in this task's tests.** `hasSolidAt`'s three-way membership is pinned on hand-built surfaces; that the parser actually stamps those two type names is Task 2's tested ground, and the real-engine side is Task 1's `fixtures/composite-solid.city.json` (finding D4).
