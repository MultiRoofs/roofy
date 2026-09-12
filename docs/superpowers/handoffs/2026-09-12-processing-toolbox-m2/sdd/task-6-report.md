# Task 6 report — LoD-tag the resident roof metrics, expose the resident geometry LoDs

**Status: COMPLETE.**

- Submodule commit: `ea8fa64` — `feat(flatcitybuf): tag resident roof metrics by LoD and report every surface's LoD` (pushed to `origin/main`, `a890c63..ea8fa64`).
- Parent pointer-bump commit: `5fd607f` — `chore(plugins): flatcitybuf resident records carry surface LoDs` (on `develop`, NOT pushed, as instructed).

## What was implemented

### `packages/navara-flatcitybuf/src/workerProtocol.ts`

- New exported `ResidentRoofMetrics extends RoofMetrics { readonly lod: string | null }`, with the brief's doc comment, declared directly above `ResidentObjectRecord`.
- `ResidentObjectRecord.roofMetrics` widened from `ReadonlyArray<RoofMetrics>` to `ReadonlyArray<ResidentRoofMetrics>`.
- New required `ResidentObjectRecord.geometryLods: ReadonlyArray<string>` with the brief's doc comment, beside `roofMetrics`.

No barrel change was needed: `navara-flatcitybuf/src/index.ts` already does `export * from "./workerProtocol"`, so `ResidentRoofMetrics` is reachable from `@cityjson/navara-flatcitybuf` for Task 7. (Checked explicitly — this was the one thing the brief did not cover.)

### `packages/navara-flatcitybuf/src/objectRecords.ts`

- `roofMetrics` is now `.map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }))`.
- The former standalone attribute-key loop is now the ONE pass that also collects `lods` (a `Set<string>`, `if (surface.lod) lods.add(surface.lod)` — so `null`/`""` are dropped and duplicates collapse, insertion order preserved).
- `geometryLods: [...lods]` added to the `records.push({ … })` literal beside `roofMetrics`.

### Test files updated (not replaced)

- `packages/navara-flatcitybuf/tests/objectRecords.test.ts` — `RESIDENT_OBJECT_RECORD_KEYS` gained `"geometryLods"`; the metric key-set assertion gained `"lod"`; the `computeRoofMetrics` equality case now compares against `roofs.map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }))`. Every other case left untouched. Three new cases appended in a `describe("toObjectRecords, per-LoD")` block, exactly as the brief specifies (`taggedSurface` / `modelWith` helpers).
- `packages/navara-flatcitybuf/tests/streamLayer.test.ts` — `objectRecord()` helper literal gained `geometryLods: []` (uncast, `tsc` required it).
- `packages/navara-flatcitybuf/tests/residentModel.test.ts` — the `entry()` helper's record literal gained `geometryLods: []`. This one is `as unknown as CellEntry`-cast so `tsc` did NOT demand it; added deliberately so the fixture stays a complete, honest `ResidentObjectRecord` and does not silently rot if the cast is ever removed. One line, no behaviour change.

### Parent repo

`npx tsc -b --noEmit` was the authoritative list. It named THREE files, not the two the brief anticipated:

- `tests/unit/insights/computeStats.test.ts` — three roof-metric literals gained `lod: "2.2"`; the two inline `ResidentObjectRecord` literals gained `geometryLods: ["2.2"]` and `geometryLods: []`. The four assertions the brief flagged (`roofSurfaceCount`, `totalRoofArea`, `avgRoofSlope`, `avgRoofAzimuth`) are unchanged and still pass — the field is additive.
- `tests/unit/ui/drawer/layerSummary.test.ts` — the `record(...)` helper's defaults gained `geometryLods: []` (hygiene; the helper is `as unknown as`-cast so `tsc` did not require it), and the `P1`/`P2` `roofMetrics` entries gained `lod: "2.2"` (these DID fail, via the `Partial<ResidentObjectRecord>` options parameter).
- `tests/unit/ui/viewport/legendCounts.test.ts` (**not in the brief**) — the second, uncast resident-model literal at ~line 196 needed both `lod: "2.2"` on its single roof metric and `geometryLods: ["2.2"]`. The first literal in that file sets `roofMetrics: undefined` and is passed `as never`, so it was untouched.

**No READER site errored.** `computeStats.ts`, `layerSummary.ts`, `legendCounts.ts`, `useResolvedSubject.ts`, `DetailsPanel.tsx` and `derivedBuildingColumns.ts` all compiled untouched — confirming the type was written as an extension, not a replacement, which is the brief's stated check.

## TDD evidence

RED (submodule, before any `src/` change, with only the test file edited):

```
pnpm vitest run packages/navara-flatcitybuf/tests/objectRecords.test.ts
 Test Files  1 failed (1)
      Tests  5 failed | 7 passed (12)
```

The five failures, all for the intended reason:

1. `precomputes roof metrics …` — metric objects lacked `lod`.
2. `carries only the documented ResidentObjectRecord fields` — `Object.keys(r)` missing `geometryLods`, metric keys missing `lod`.
3. `tags each roof metric with its OWN surface's LoD` — `[undefined, undefined]` instead of `["1.2", "2.2"]`.
4. `reports the LoDs of EVERY surface` — `TypeError: records[0].geometryLods is not iterable`.
5. `de-duplicates the LoD list` — `expected undefined to deeply equal [ '2.2' ]`.

GREEN after Steps 3+4: `Test Files 1 passed (1) / Tests 12 passed (12)`.

## Verification results

Submodule (`cd packages/cityjson-navara-plugins`):

| check                                                                     | result                           |
| ------------------------------------------------------------------------- | -------------------------------- |
| `pnpm vitest run packages/navara-flatcitybuf/tests/objectRecords.test.ts` | 12 passed                        |
| `pnpm typecheck` (`tsc -b`)                                               | clean, exit 0                    |
| `pnpm vitest run packages/navara-flatcitybuf`                             | 22 files, 341 passed             |
| `pnpm vitest run` (full)                                                  | 61 files, 840 passed / 1 skipped |

Parent (`export PATH="$HOME/.local/share/mise/shims:$PATH"`):

| check                                       | result                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `npx tsc -b --noEmit`                       | clean, exit 0                                                            |
| `npx vp check`                              | **0 errors and 56 warnings in 515 files** — exactly the baseline         |
| `npx vitest run` on the three touched files | 3 files, 28 passed                                                       |
| `npx vp test run` (full, background)        | **236 files passed / 2 skipped, 2894 tests passed / 31 skipped, exit 0** |

The parent pre-commit hook (`vp staged` → `vp check --fix`) ran on the commit. Verified after the fact with `git show HEAD -- tests/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`: the committed content is exactly the patches I wrote — the hook rewrote nothing. Hooks were not bypassed.

## Files changed

Submodule (`ea8fa64`, 5 files):

- `packages/navara-flatcitybuf/src/workerProtocol.ts`
- `packages/navara-flatcitybuf/src/objectRecords.ts`
- `packages/navara-flatcitybuf/tests/objectRecords.test.ts`
- `packages/navara-flatcitybuf/tests/streamLayer.test.ts`
- `packages/navara-flatcitybuf/tests/residentModel.test.ts`

Parent (`5fd607f`, 4 entries):

- `packages/cityjson-navara-plugins` (gitlink `a890c63` → `ea8fa64`)
- `tests/unit/insights/computeStats.test.ts`
- `tests/unit/ui/drawer/layerSummary.test.ts`
- `tests/unit/ui/viewport/legendCounts.test.ts`

`.github/hooks/` and `docs/design-history/` remain untracked and untouched, as instructed.

## Self-review

- **Submodule branch hygiene.** The working tree was detached at `a890c63` while the local `main` branch was 18 commits BEHIND at `95cad82`. I ran `git checkout main && git pull --ff-only origin main` FIRST, before any edit — fast-forwarded `95cad82..a890c63`, confirmed `git rev-parse HEAD` = `a890c63` = `origin/main`, working tree clean. Had I edited first, the checkout would have carried the edits onto the wrong base. The pointer bump is therefore a real branch commit, not a detached one.
- **Prettier trap, caught and reverted.** I ran the parent's `npx prettier --write` over the four submodule files as a formatting precaution. It reformatted 96 lines of `streamLayer.test.ts` that have nothing to do with this change (the submodule is not managed by the parent's prettier config). I reverted that file with `git checkout --` and re-applied only the one-line `geometryLods: []` insertion via a scripted exact-string replace. The final submodule diff is 120 insertions / 4 deletions across 5 files, all of it this change. `objectRecords.test.ts` was checked line by line (`git show ea8fa64 -- …` head and tail) and contains only my edits: prettier's effect there was line-wrapping only, no token changes — it broke the now-5-element metric key array onto separate lines (the style the rest of the file uses) and wrapped the `toEqual(roofs.map(...))` argument; the three appended cases are the brief's text verbatim.
- **Committed by path, never `-A`.** `git status --short` in the submodule showed exactly the five intended files before the commit; no `dist-types/` or `.tsbuildinfo` churn leaked in.
- **Key order.** `geometryLods` sits immediately after `roofMetrics` in both the interface and the emitted record literal; `RESIDENT_OBJECT_RECORD_KEYS` sorts before comparing, so ordering is not load-bearing, but the two now read the same.
- **`geometryLods` semantics match the brief exactly**: distinct, non-null, first-seen order, over ALL surfaces regardless of semantic type. The de-dup test pins the `Set`, the wall test pins "not only roofs", the `null` surface in the third case pins the falsy guard.
- **No behavioural change to any consumer.** The widening is purely additive; every parent edit is a test literal.

## Concerns / notes for Task 7

1. **`geometryLods` is populated from the UNFILTERED cell model**, so it lists every LoD the object has anywhere in the file — which is the point, but Task 7 must not assume it reflects what is currently _rendered_ (the mesh is LoD-filtered downstream in `fcb.worker.ts`).
2. **Worker-protocol version.** `ResidentObjectRecord` is a structured-clone payload crossing the worker boundary. Both sides ship from the same submodule commit, so there is no skew here, but the record now carries two more fields per object on every `fetch`/`recolor` — a handful of short strings, negligible, but it is a protocol widening and is not versioned. Noting it rather than acting on it: the brief did not ask for a version bump and nothing in the repo versions this payload today.
3. **`residentModel.test.ts` fixture** is still `as unknown as CellEntry`-cast, so it will not catch the NEXT required field either. Out of scope to de-cast here.
4. **Scratchpad path deviation.** The orchestrator named `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-.../scratchpad/`; this session's actual scratchpad is `…/9d7538d6-bee9-4194-bf86-967da2bad364/scratchpad/`. The full-suite log is at `/tmp/claude-1020/-data2-hideba-multiroof-viewer/9d7538d6-bee9-4194-bf86-967da2bad364/scratchpad/parent-full-suite.log`.
5. **Parent not pushed**, per instruction. The submodule IS pushed, so the gitlink `ea8fa64` resolves for anyone who pulls `develop` once it is pushed.
