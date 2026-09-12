# Task 7 report — One geometry source for both layer kinds, and LoD counts that measure nothing

Status: COMPLETE. Commit `b2ea5e7` on `develop` (not pushed).

## Implemented

`src/features/processing/roofGeometrySource.ts` (new, engine-free — no `@navaramap/*` import):

- `RoofGeometrySource { has, hasGeometryAt, roofSurfacesAt }` and
  `roofGeometrySource(layer)`. Two branches behind one interface:
  - **streaming**: the resident records from `getResidentModel(layer.id, 0)`.
    `hasGeometryAt` reads `ResidentObjectRecord.geometryLods`; `roofSurfacesAt`
    filters the worker's pre-computed `roofMetrics` by `lod` and drops
    `elevationM` (a `RoofSurfaceMetric` has four fields). Nothing is measured.
  - **static**: `layer.model.objects[id].surfaces`. `hasGeometryAt` is
    `surface.lod === lod` over surfaces of EVERY semantic type (§7's contributor
    question); `roofSurfacesAt` calls `computeRoofMetrics` only for
    `type === "RoofSurface" && lod === lod`, memoised per `(id, lod)`.
  - `has` distinguishes "unknown object" from "nothing at this LoD" in both.
- `featureIdsByObject(layer)` — every object id to its root feature id, via
  `parentsIndexOf`/`rootFeatureId`, over the resident set or the model.
- `LodOption { lod, features }` and `roofLodOptions(layer)` — TAGS ONLY
  (`Surface.type`/`Surface.lod`, or `geometryLods` + the LoD already on each
  `ResidentRoofMetrics`). `computeRoofMetrics` is never called. The same
  geometry-keyed contributor rule as execution: at each LoD, if any non-root
  member has ANY geometry there the parts are the contributors and the root's
  own surfaces are ignored; otherwise the root is the sole contributor. A rung
  with zero features is not offered; a null `Surface.lod` contributes to no
  rung. Sorted highest detail first, matching `computeAvailableLods`.

Names produced for Tasks 9 and 11 are verbatim as briefed: `roofGeometrySource`,
`RoofGeometrySource`, `roofLodOptions`, `LodOption { lod, features }`, plus
`featureIdsByObject`.

## Symbol verification (all consumed names exist as briefed)

- `RoofSurfaceMetric` — `src/domain/roofMetrics/roofRollUp.ts` (Task 5).
- `ResidentObjectRecord` / `ResidentRoofMetrics` — declared in the submodule's
  `navara-flatcitybuf/src/workerProtocol.ts`, re-exported from the package
  barrel (`export * from "./workerProtocol"`), which is engine-free; imported as
  `@cityjson/navara-flatcitybuf`, the same path `src/insights/layerRows.ts` and
  `src/ui/details/useResolvedSubject.ts` already use. `geometryLods:
ReadonlyArray<string>` and `roofMetrics: ReadonlyArray<ResidentRoofMetrics>`
  (with `lod: string | null`) are present from Task 6's pointer bump.
- `computeRoofMetrics` — exported from `@cityjson/navara-core`'s barrel.
- `getResidentModel(layerId, version)` — `src/features/streaming/residentModel.ts`;
  `version` is a subscription marker the function ignores, so `0` is correct
  here (documented in the module comment).
- `parentsIndexOf` / `rootFeatureId` — `src/domain/citymodel/featureId.ts`.
- `Surface` / `BuildingSurfaceType` — `"RoofSurface"` is a literal of the union,
  so the static filter typechecks.

No brief symbol turned out to be missing or misnamed.

## Deviations from the brief's code (two, both non-behavioural)

1. Dropped the three `as Readonly<Record<string, ResidentObjectRecord>>` /
   `as Readonly<Record<string, ObjectLike>>` casts: `ResidentModel.objects` and
   `CityModel.objects` already have those types, so the assertions were no-ops
   (and a lint-warning risk). Replaced with plain typed locals.
2. Dropped `if (!object) continue;` in `lodTagsByObject`'s static loop:
   `Object.entries` yields `CityObject`, never `undefined`
   (`noUncheckedIndexedAccess` does not apply to `Object.entries`), so the guard
   was unreachable.

Everything else is the brief's code verbatim.

## Tests — `tests/unit/features/processing/roofGeometrySource.test.ts`

11 tests (the brief said "12"; the file it specifies contains 11 `it` blocks —
a miscount in the brief, not a missing test):

- `roofLodOptions`: counts features per LoD with parts folded in; **"applies the
  CONTRIBUTOR rule, so a displaced root roof does not count"**; **"counts the
  ROOT when no part has geometry at that LoD"**; "measures NOTHING — it reads
  the surfaces' tags only"; no option for a wall-only layer; reads a streaming
  layer's resident records.
- `roofGeometrySource`: `hasGeometryAt` from tags for every semantic type;
  unknown object vs. empty object; "measures only the object and LoD it is asked
  for, once" (the `computeRoofMetrics` spy asserts one call, then none on repeat
  and none at an LoD the object has nothing at); streaming metrics filtered by
  LoD with the spy still at zero.
- `featureIdsByObject`: part to its building, root to itself.

The review residual is covered by the two bolded named tests.

The CPU-contract spy is a `vi.mock("@cityjson/navara-core")` wrapper around the
real `computeRoofMetrics` that records each call's `surface.lod`; every
`roofLodOptions` assertion checks `measured` is empty.

## TDD evidence

- RED: `npx vitest run tests/unit/features/processing/roofGeometrySource.test.ts`
  → `Failed to resolve import ".../src/features/processing/roofGeometrySource".
Does the file exist?` — 1 test file failed, no tests ran. Failure is the
  intended one (module absent).
- GREEN: same command after writing the module → `Test Files 1 passed (1) /
Tests 11 passed (11)`.
- Re-run after `vp fmt` → still 11 passed.
- `npx tsc -b --noEmit` → clean (exit 0), before and after formatting.
- `npx vp check` → **0 errors and 56 warnings in 517 files** — exactly the
  baseline; the new files add no warning.
- Full suite (once, at the end, in the background): `npx vp test run` ->
  `Test Files 237 passed | 2 skipped (239)` / `Tests 2908 passed | 31 skipped
(2939)`, EXIT=0. Log:
  `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite.log`.

## Files changed

- `src/features/processing/roofGeometrySource.ts` (new)
- `tests/unit/features/processing/roofGeometrySource.test.ts` (new)

Nothing else touched: no edits in `src/insights/layerTables.ts`, `duckdb.ts` or
`runQueue.ts`; `.github/hooks/`, `docs/design-history/` and `.superpowers/`
(other than this report) left alone. The pre-commit hook ran normally (no
`--no-verify`). Post-commit sanity: `git status --short src/features/processing
tests/unit/features/processing` is empty (the hook's `vp check --fix` left no
unstaged rewrite) and `git log -1 --format=%B` is exactly the one subject line
(no trailer).

## Self-review

- Engine-free: the only package imports are `@cityjson/navara-core` (engine-free
  by contract) and a TYPE-only import from `@cityjson/navara-flatcitybuf`, which
  erases at build time. No `@navaramap/*`.
- The memo returns the cached array even when empty (`cache.get(key)` yields
  `[]`, which is truthy), so a repeated ask for an object with no roof at that
  LoD still costs nothing beyond a map lookup.
- `roofLodOptions` and `roofSurfacesAt` cannot disagree about who contributes:
  both ask "does a non-root member have geometry at this LoD" of the same tag
  source. Task 9 must apply the contributor rule with `hasGeometryAt`, which is
  the same predicate the counts used.
- A streaming layer's `layer.model.objects` is an empty stub and is never read
  on that branch.

## Concerns (none blocking; nothing changed for them)

1. `roofLodOptions` sorts by `Number.parseFloat(lod)`. A non-numeric LoD label
   would sort as `NaN` and land in an arbitrary position. This is the brief's
   code and matches `computeAvailableLods`' assumption; untested here.
2. `roofLodOptions` is O(rungs x features x members) with a `filter` allocation
   per feature per rung. Fine for the counts it does (tags only, no geometry),
   but on a very large static model opened repeatedly it is worth memoising at
   the call site (Task 11's select), not inside this module.
3. `getResidentModel(layer.id, 0)` is captured once per `roofGeometrySource(…)`
   call, so a source built before a cell commits will not see the new residents.
   That is the intended freeze for a run (spec §6.1's frozen parameters), but
   Task 11's select must rebuild its options on the resident version it
   subscribes to, or the counts will go stale as the user pans.
4. The brief's expected test count ("12 tests") is wrong; the file it dictates
   has 11. No test was dropped.
5. `roofLodOptions` calls `getResidentModel` twice (once through
   `lodTagsByObject`, once through `featureIdsByObject`). The handle memoises on
   its commit counter, so both see the same snapshot unless a cell lands between
   the two calls. Harmless for a count, but Task 11 calls this from a React
   subscriber and should build the options once per version.

## Handoff note for Tasks 9 and 11

A test that imports `roofGeometrySource` must `vi.mock` the app's
`src/features/streaming/residentModel` (as this test does) or supply a stream
store: `residentModel.ts` imports `streamStore` at module scope.
