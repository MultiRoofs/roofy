# Task 2 report — Tag every surface with the geometry type it came from

**Status: COMPLETE.** Implemented exactly as the brief's six source steps specify; no deviations.

## What was implemented

1. `Surface` (`packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts`) gains
   `readonly geometryType?: CityJSONGeometryType | null` — **optional as well as nullable** — immediately
   after `lod`, with the brief's doc comment verbatim. The type import
   `import type { CityJSONGeometryType } from "./cityjson/types";` was added beside the existing
   `supportedEncodings` import. **Cycle check performed**: `cityjson/types.ts` imports nothing at all
   (its head is doc comment → `export interface CityJSONRoot`), so the new edge cannot cycle, and
   `npx vp check` stayed at the 0/56 baseline (no `import/no-cycle` warning added).

2. `buildSurface` (`.../navara-core/src/citymodel/cityjson/parseHelpers.ts`) sets `geometryType: geom.type`,
   with the field added to the local object's inline type annotation as
   `geometryType: CityJSONGeometryType` and `CityJSONGeometryType` added to the existing
   `import type { … } from "./types";`. `geom` is a `CityJSONSurfaceGeometry` whose `type` is
   `Exclude<CityJSONGeometryType, "GeometryInstance">`, so it is assignable with no cast — confirmed by
   a clean `tsc -b`.

3. `decodeTable.ts` (`.../navara-cityparquet/src/decodeTable.ts`) writes `geometryType: null` EXPLICITLY
   in the `surfaces.push({…})` literal after `lod: column.lod,` and before the `...extra` spread (`extra`
   carries only `material`/`texture`, so ordering is inert), with the brief's comment verbatim.

### Code facts verified against the brief before writing (none contradicted it)

- `extractSurfaces` (`parseHelpers.ts:232-288`) has exactly the five surface-producing cases the brief
  names — `MultiSurface`, `CompositeSurface`, `Solid`, `MultiSolid`, `CompositeSolid` — and every one
  reaches `buildSurface` through the single `visit` closure. `GeometryInstance` falls to `default: break`.
- `buildSurface`'s first parameter is already `geom: CityJSONSurfaceGeometry`; no signature changed.
- `parseCityObject` (`parseHelpers.ts:298-337`) walks **every** entry of `raw.geometry` (skipping only
  `GeometryInstance`) — it does not filter by LoD — which is what makes the test's two-geometry cases
  meaningful. `CityModel.objects` is `Readonly<Record<string, CityObject>>`, so the test's `objects["b"]`
  indexing is correct.
- `grep -rn "rings:" packages/*/src --include=*.ts` (non-test) confirms the submodule has exactly **two**
  `Surface` builders — `buildSurface` and `decodeTable.ts:729` — so no third producer silently drops the tag.

## Tests

New file: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/geometryType.test.ts`
(5 cases, verbatim from the brief): MultiSurface; CompositeSurface (nests identically to MultiSurface);
a Solid tagging every face through its shells; MultiSolid + CompositeSolid in one model; and LoD + type
read together over two geometries.

The CompositeSolid case is the load-bearing one for the later solids tasks: Task 1 found the WKB type
name for a CompositeSolid is `"GeometryCollection Z"`, so Tasks 3/8/10 must key on this tag, and this
test pins that the tag says `"CompositeSolid"`.

### TDD evidence

**RED** (test written before any source change):

```
$ export PATH="$HOME/.local/share/mise/shims:$PATH"
$ cd packages/cityjson-navara-plugins
$ pnpm vitest run packages/navara-core/tests/citymodel/geometryType.test.ts
 Test Files  1 failed (1)
      Tests  5 failed (5)
exit: 1
```

All five failed for the intended reason — the tag read `undefined`, e.g.

```
AssertionError: expected [ [ '2.2', undefined ], …(1) ] to deeply equal [ [ '2.2', 'Solid' ], …(1) ]
```

and the type error the brief predicts was also present:

```
$ pnpm typecheck
packages/navara-core/tests/citymodel/geometryType.test.ts(39,59): error TS2339: Property 'geometryType' does not exist on type 'Surface'.
packages/navara-core/tests/citymodel/geometryType.test.ts(86,43): error TS2339: Property 'geometryType' does not exist on type 'Surface'.
exit: 2
```

**GREEN** (after steps 3-5):

```
$ pnpm typecheck                     → typecheck exit: 0
$ pnpm vitest run                    → Test Files 62 passed (62) | Tests 845 passed | 1 skipped (846); suite exit: 0
$ pnpm vitest run …/geometryType.test.ts → Test Files 1 passed (1) | Tests 5 passed (5)
```

The submodule run was the **whole** suite, not only the two paths the brief's Step 6 names: a parser
emitting a new DEFINED field is exactly what a `toEqual` on parsed surfaces would reject (`toEqual`
tolerates `undefined` extras, not defined ones), and navara-cityjson / navara-flatcitybuf both consume
parsed surfaces through `parseCityObject`. **Nothing broke — no expected-object fixture needed changing
anywhere in the submodule.**

### App side (before the pointer bump)

```
$ npx tsc -b --noEmit                                        → tsc: 0
$ npx vitest run > /tmp/m3-task2-suite.log 2>&1 & wait $!    → suite: 0
   Test Files  243 passed | 4 skipped (247)
        Tests  2994 passed | 61 skipped (3055)
$ npx vp check                                               → Found 0 errors and 56 warnings in 531 files (baseline held, exit 0)
```

No app-side file changed: the field is optional, so the 21 hand-built `Surface` literals (10 app test
files, 11 submodule test files) and `src/domain/citymodel/citygml/parseCityGML.ts:231`'s
`const surface: Surface = { type, rings, attributes: {}, lod }` all still compile untouched — which is
the whole point of Decisions item 6 (vi).

## Files changed

Submodule (`packages/cityjson-navara-plugins`), 4 files, +123:

- `packages/navara-core/src/citymodel/types.ts` (+18)
- `packages/navara-core/src/citymodel/cityjson/parseHelpers.ts` (+7)
- `packages/navara-cityparquet/src/decodeTable.ts` (+7)
- `packages/navara-core/tests/citymodel/geometryType.test.ts` (new, +91)

Parent: the gitlink only.

## Commits

- Submodule `main`: **82949ed** `feat: tag each surface with its CityJSON geometry type` —
  **pushed** to `git@github.com:HideBa/cityjson-navara-plugins.git` (`ea8fa64..82949ed`, exit 0). Remote
  was already the SSH one; no change needed.
- Parent `develop`: **c6d3b9d** `chore: bump cityjson-navara-plugins for surface geometry types`
  (`ea8fa64` → `82949ed`, 1 file, +1/-1). **Not pushed** — the commander pushes after review.

No trailers on either message (verified with `git log --format=%B`). Hooks ran normally, nothing bypassed.
`.github/hooks/`, `docs/design-history/` and `.superpowers/` were left untracked and unstaged.

## Self-review of the diff

- The tag is set in exactly ONE place and read from `geom.type`, so it cannot disagree with the geometry
  it came from; no case in `extractSurfaces` was touched.
- `geometryType: CityJSONGeometryType` on the LOCAL annotation (non-optional) is right even though the
  interface field is optional: `buildSurface` always has a real value, so the local type is the stricter,
  honest one, and it is assignable to the optional interface field.
- CityParquet's `null` sits before `...extra` and `extra` never carries `geometryType` (it is built by
  `faceAppearance`, which returns `material`/`texture`), so the spread cannot clobber it.
- `Surface` is `readonly` throughout and the new field follows suit.
- Doc comments are verbatim from the brief; no invented copy, no user-visible string touched.

## Concerns / notes for later tasks

1. **CityGML builds `Surface` literals app-side and will carry no tag.**
   `src/domain/citymodel/citygml/parseCityGML.ts:231` constructs `Surface` field-by-field and omits
   `geometryType`, so every CityGML surface reads `undefined` → "not a solid". Deliberately out of scope
   (a CityGML layer has no reader, so the solids tools refuse it on eligibility first, `eligibility.ts:55-63`),
   but naming it so a later reader does not mistake it for an oversight. Tagging it would need CityGML's
   own `lod2Solid`/`lod2MultiSurface` element names mapped to the CityJSON union — a separate change.
2. **`absent` vs `null` is deliberately indistinguishable** to consumers. Task 3's `hasSolidAt` must ask
   `geometryType === "Solid" | "CompositeSolid" | "MultiSolid"` (a positive test), never `!== null`, or
   every hand-built literal and every CityGML surface would read as a solid.
3. **FlatCityBuf's tag does NOT reach the main thread, and does not need to.** `fcb.worker.ts:305` does
   call `parseCityObject`, so the `Surface` objects it builds carry the tag — but the `CityModel` stays
   worker-side: `post()` (`:395-425`) transfers typed arrays plus `toObjectRecords(cellModel)`'s
   `ResidentObjectRecord`s, never `Surface`s. The plan's "three formats get the tag for free" is therefore
   true of CityJSON and CityJSONSeq in-app, and true of FCB only inside the worker. Decision (a) makes
   this a non-issue this milestone (solids tools declare `needsReader: true` and a streaming layer never
   has a reader, `eligibility.ts:55-63`, so `ResidentObjectRecord` gains no field) — but a later task that
   wants a solids answer on a streaming layer must add the tag to `ResidentObjectRecord`, not assume it
   already crossed.
4. Nothing else in the submodule or the app reads `geometryType` yet, so this commit is behaviour-neutral
   for the running app: it only widens the data the next tasks will read.
