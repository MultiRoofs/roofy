# Task 5 report — The pure roof roll-up (M13.2)

Status: **COMPLETE**

## What was implemented

One pure module and its test file. No other file in the repo was touched;
`src/domain/roofMetrics/aggregate.ts` and `src/ui/details/subject.ts` are
untouched, as the brief requires.

`src/domain/roofMetrics/roofRollUp.ts` (new, no imports at all):

- `export interface RoofSurfaceMetric { lod: string | null; areaSqM: number; inclinationDeg: number; azimuthDeg: number }`
- `export interface RoofRollUp { areaM2; flatM2; flatShare: number | null; slopeDeg: number | null; azimuthDeg: number | null; surfaces: number }`
- `export function rollUpRoofSurfaces(surfaces: ReadonlyArray<RoofSurfaceMetric>, flatThresholdDeg: number): RoofRollUp | null`

The three names and the signature are verbatim from the brief and the plan's
Task 5 "Produces" block, so Tasks 7 and 9 can consume them unchanged.

Semantics implemented (spec §7/§7.1 and the plan's "The six measures" table at
`docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md:249-260`):

| Measure      | Rule                                                                                                                                        | NULL when                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `areaM2`     | Σ `areaSqM`                                                                                                                                 | — (function returns `null` for no surfaces) |
| `flatM2`     | Σ `areaSqM` where `inclinationDeg < threshold` (STRICT)                                                                                     | —                                           |
| `flatShare`  | `flatM2 / areaM2`                                                                                                                           | `areaM2 === 0`                              |
| `slopeDeg`   | Σ(`inclinationDeg` × `areaSqM`) / Σ `areaSqM`, over ALL surfaces regardless of the threshold                                                | `areaM2 === 0`                              |
| `azimuthDeg` | `azimuthDeg` of the largest-area surface with `inclinationDeg >= threshold`; ties keep the FIRST in source order (comparison is strict `>`) | every surface is flat                       |
| `surfaces`   | `surfaces.length`                                                                                                                           | —                                           |

Whole-function `null` = "nothing to measure" (`surfaces.length === 0`), which the
caller turns into NULL in every column plus a skipped count.

**Brief vs. plan table:** no conflict found. The brief's prose, the brief's code
and the plan's Design decision (c) table agree on every one of the six measures,
on the strict threshold, and on all four NULL rules. Nothing to report under the
"authority" clause.

## Tests and results

`tests/unit/domain/roofRollUp.test.ts` (new), transcribed verbatim from the
brief — 8 `it` blocks, one per rule:

1. `[]` → `null`.
2. Area sum and surface count.
3. Strict threshold: 4.9° flat at threshold 5, exactly 5° NOT flat; flat share.
4. Area-weighted mean slope over all surfaces, asserted twice — at threshold 5
   and at threshold 0 — so the threshold provably does not touch it.
5. Dominant azimuth = largest NON-flat surface (a 100 m² flat surface with a
   nonsense azimuth is correctly ignored).
6. Azimuth tie → first surface in order.
7. All-flat set → `azimuthDeg` null, `flatShare` 1, slope still area-weighted.
8. All-zero-area set → `flatShare` and `slopeDeg` null (no NaN in the column),
   `areaM2`/`flatM2` 0, `surfaces` 2.

Results (Node 24 via mise shims):

- Focused file: `Test Files 1 passed (1) / Tests 8 passed (8)`.
- Full app suite, run in the background at the end:
  `Test Files 236 passed | 2 skipped (238) / Tests 2889 passed | 31 skipped (2920)`,
  exit 0. (Logged to the scratchpad; run twice, identical result — see
  "TDD evidence" for why.)
- `npx tsc -b --noEmit`: clean.
- `npx vp check`: **0 errors**, 57 warnings (see Concerns — baseline is 56).

Note: the brief's Step 4 says "Expected: PASS (9 tests)". The brief's own test
code contains 8 `it` blocks, so 8 is correct and the "9" is a typo in the brief.
No test is missing: every rule listed in §7.1 and in the plan's table has an
assertion above.

## TDD evidence

RED (test written first, implementation file absent):

```
$ npx vitest run tests/unit/domain/roofRollUp.test.ts
Error: Failed to resolve import "../../../src/domain/roofMetrics/roofRollUp" from
  "tests/unit/domain/roofRollUp.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: /data2/hideba/multiroof-viewer/tests/unit/domain/roofRollUp.test.ts:10:7
 Test Files  1 failed (1)
      Tests  no tests
```

Failure is for the intended reason (module does not exist yet), not a typo in
the test.

GREEN (after creating `src/domain/roofMetrics/roofRollUp.ts`, no test edits):

```
$ npx vitest run tests/unit/domain/roofRollUp.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  1.67s
```

The full suite was run twice. The first run's window may have overlapped a
`git stash -u` / `git stash pop` used to measure the pre-change lint-warning
baseline, so it was re-run on the stable tree to make the evidence
unambiguous; both runs reported 2889 passed / 0 failed, exit 0. The stash was
popped successfully. To be explicit about a side effect worth disclosing: the
`-u` flag swept the two untracked directories I was told to leave alone,
`.github/hooks/` and `docs/design-history/`, into the stash along with my two new
files, and the pop restored all four. The pop consumed the stash entry with no
conflict and no report of an unmerged path, which is the evidence it applied
cleanly; neither directory's contents were edited by me at any point. `git
status` afterwards showed exactly the expected
tree (the two new files plus the pre-existing untracked `.github/hooks/` and
`docs/design-history/`); the seven `stash@{n}` entries in the list are
pre-existing from earlier sessions, none of them mine.

## Files changed

- Created: `/data2/hideba/multiroof-viewer/src/domain/roofMetrics/roofRollUp.ts`
- Created: `/data2/hideba/multiroof-viewer/tests/unit/domain/roofRollUp.test.ts`

One commit on `develop`: **`f9ce722`** — `feat(domain): the spec's roof roll-ups
as one pure function` (2 files changed, 160 insertions). `git add` by path,
prefix `feat:`, message body empty — no trailers of any kind (verified with
`git log --format='%B' -1`). The pre-commit hook (`vp staged` →
`vp check --fix`) ran; the commit's content is byte-identical to what I wrote as
far as I can infer (formatting is part of `vp check`, which was already at 0
errors on these files before staging) — I did not diff the committed blobs
against my originals, so this is an inference, not an observation. Hooks not
bypassed, nothing
pushed; the working tree after the commit is clean apart from the pre-existing
untracked directories. `.github/hooks/`, `docs/design-history/`
and `.superpowers/` were left alone.

## Self-review

- **Signatures** match the brief and the plan character for character, including
  `ReadonlyArray<RoofSurfaceMetric>` and the `| null` return, so Task 7's
  producer and Task 9's consumer need no adapter.
- **Purity**: the module has zero imports; nothing engine-, store- or
  DOM-shaped. It is safe under Node and safe for the plugin-side test rules.
- **`lod` is carried but unused** by the roll-up. That is intended: Task 7 tags
  each surface with the LoD it came from and filters by LoD _before_ calling in,
  so the roll-up never needs to. Keeping the field on the interface is what lets
  the caller do the filtering without a second type.
- **Strict-threshold consistency**: `flatM2` uses `< threshold` and the dominant
  azimuth takes the `continue`'s complement, so a surface is counted as flat in
  exactly the cases it is excluded from the azimuth candidates — the two rules
  cannot drift apart.
- **Tie rule**: `surface.areaSqM > dominant.areaSqM` (strict) keeps the first of
  equals, matching the spec's tie rule, and the test pins it.
- **NaN avoidance**: `areaM2 > 0` guards both divisions, so an all-zero-area
  feature (which `computeRoofMetrics` really does produce for a degenerate ring)
  writes NULL, never NaN, into a DOUBLE column.
- **`noUncheckedIndexedAccess`**: the module never indexes an array (it uses
  `for...of` and a running `dominant`), so there is no unchecked-index hazard;
  `tsc -b --noEmit` is clean.
- **Not touched**: `aggregate.ts`'s circular-mean azimuth and its `0`-for-empty
  behaviour are unchanged, so `src/ui/details/subject.ts:228` keeps the answer
  it has always shown. Two functions, two different questions, as the brief's
  module docstring explains.

## Concerns

1. **Lint warnings 56 → 57.** The brief's test line 63,
   `expect(out.slopeDeg).toBeCloseTo((10 * 0 + 4 * 2) / 14, 10);`, trips
   `oxc(erasing-op)` ("this expression will always evaluate to zero") on the
   `10 * 0` term. I verified this against the baseline by stashing the change
   (`0 errors and 56 warnings in 513 files`) and re-running with it
   (`0 errors and 57 warnings in 515 files`) — the single new warning is this
   line and nothing else. It is a _warning_, the 0-error gate holds, and the
   `10 * 0` is deliberately written out so the area-weighted formula is legible
   in the assertion. I kept the brief's code verbatim rather than paraphrase
   test arithmetic or add a suppression comment; if a reviewer wants the warning
   count back at baseline, changing that term to `0 * 10`-free arithmetic (e.g.
   `(4 * 2) / 14`) is a one-line follow-up that costs the formula's readability.

   **RESOLVED by controller ruling** (the 56-warning baseline is a gate and the
   brief's verbatim arithmetic does not override it). Follow-up commit
   **`82b10c2`** — `test: keep the roof roll-up's weighted-mean assertion off the
erasing-op lint` — replaces that line with the literal plus a comment
   spelling out the weighted sum, so the formula stays readable without an
   erasing operation:

   ```ts
   // Area-weighted over both: (10 m² × 0°) + (4 m² × 2°) = 8, over 14 m².
   expect(out.slopeDeg).toBeCloseTo(8 / 14, 10);
   ```

   Re-verified after the change: `npx vp check` → `Found 0 errors and 56
warnings in 515 files` (exactly the baseline), `npx tsc -b --noEmit` clean,
   focused file 8/8, full suite re-run green. One `test:` commit, staged by
   path, empty message body (no trailers), hooks not bypassed, not pushed.

2. **Test file location.** The brief puts the test at
   `tests/unit/domain/roofRollUp.test.ts`, while the mirror convention (and the
   sibling module's test) would put it at
   `tests/unit/domain/roofMetrics/roofRollUp.test.ts`, beside
   `aggregate.test.ts`. I followed the brief — the import depth
   (`../../../src/...`) is written for the brief's path, and the plan repeats
   the same path — but flag the inconsistency: if it should be moved, the move
   is one `git mv` plus one `../` in the import.
3. **No consumer yet.** Nothing imports `roofRollUp.ts` until Task 7/9 land, so
   the module is currently dead code in the app bundle. Expected for a
   task-sliced plan; noting it only so a tree-shaking or "unused export" check
   in the interim is not mistaken for a defect.
