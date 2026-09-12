# Task 8 report — The roof parameters, and the registry entry that promises their columns

Branch `develop`, two commits (base 52e4e19, not pushed):

- **4b1949f** `feat(processing): Roof metrics' parameters and the columns they promise`
- **6d3c0c7** `test(processing): the registry entry honours the roof params, not just the module`

## Implemented

1. **`src/features/processing/roofMetricsParams.ts` (new, 145 lines, pure).** Exactly the brief's module, verbatim:
   - `RoofMeasure`, `RoofMeasureSpec` (`key` / `label` / `hint` / `suffix`), `ROOF_MEASURES` — spec §7.1's six measures in §7.1's order, with the owner's labels ("Total roof area (m²)", "Flat roof area (m²)", "Flat share", "Mean slope (deg)", "Dominant azimuth (deg)", "Roof surface count") and §7.1's explanations as `hint` (null where the label already says everything: `area`, `surfaces`).
   - `RoofMetricsParams`, `DEFAULT_ROOF_PARAMS` (all six ticked, threshold 5), `FLAT_THRESHOLD_MIN = 0`, `FLAT_THRESHOLD_MAX = 15`.
   - `roofParams(raw)` — absent measures ⇒ all six; an **empty array stays empty** (the state Run refuses); unknown keys dropped; the tick list re-sorted into the spec's order rather than click order; the threshold coerced with `Number`, clamped to 0–15, falling back to 5 for NaN/absent. Idempotent.
   - `roofColumnNames(prefix, params)` — the ONE builder: §7.1's order filtered by the ticked measures, prefix applied.
2. **`src/features/processing/types.ts`** — `ToolDefinition.needsLod: boolean` (required, after `needsVectorSource`), plus optional `validateParams?` and `normaliseParams?` after the existing `outputColumns?`. One doc line on `outputColumns?` was reworded from "Absent for a tool whose executor has not shipped — the form then promises nothing" to "Absent for a tool whose columns are not settled yet", because roof-metrics now carries `outputColumns` while `implemented` is still false; the old wording would have read as a contradiction to the next reviewer.
3. **`src/features/processing/toolRegistry.ts`** — `needsLod` filled on **all seven** entries in the same step (`true` for roof-metrics / measure-solids / validate-solids, `false` for height-from-extent and the three cross-layer tools). The roof-metrics entry gained `outputColumns` (delegating to `roofColumnNames(prefix, roofParams(params))` — extended, not duplicated: the existing `height-from-extent` `outputColumns` shape was reused), `validateParams` ("Pick at least one measure"), `normaliseParams` (`{ ...roofParams(params) }`), and the comment naming Task 13. **`implemented` stays `false`.**
4. **Tests** — new `tests/unit/features/processing/roofMetricsParams.test.ts` (10 module cases + a 4-case `describe("the roof-metrics registry entry")` pinning the GLUE: the entry's `outputColumns` promises §7.1's six names for `{}`, `validateParams` answers "Pick at least one measure" for an empty tick list and `null` for `{}`, `normaliseParams({})` returns the six measures and threshold 5 that get FROZEN, and `implemented` is still false while `needsLod` is true) and three cases appended inside the existing `describe("toolEligibility")` in `eligibility.test.ts`.

## Tests and results

| Command                                                                                                                                                                      | Result                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run tests/unit/features/processing/roofMetricsParams.test.ts`                                                                                                    | 10 passed, then **14 passed** with the registry-glue block                                                                                                               |
| `npx vitest run tests/unit/features/processing tests/unit/ui/processing`                                                                                                     | **212 passed, 17 files** (208 before the glue block)                                                                                                                     |
| `npx tsc -b --noEmit`                                                                                                                                                        | clean (exit 0)                                                                                                                                                           |
| `npx vp check`                                                                                                                                                               | **0 errors, 56 warnings** in 519 files (the baseline)                                                                                                                    |
| full suite, `npx vp test run` (background, logged to `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/task8-full-suite.log`) | **238 files passed, 2 skipped; 2924 tests passed, 31 skipped; exit 0** (62 s). Run at 4b1949f; the later glue block only adds 4 cases to one file, re-run focused above. |

The pre-commit hook (`vp staged`) ran `vp check --fix` over the staged files of both commits and changed nothing.

## TDD evidence

- **RED 1** — `roofMetricsParams.test.ts` written first, run against a missing module: `Failed to resolve import ".../src/features/processing/roofMetricsParams"`, _Test Files 1 failed (1), Tests no tests_.
- **GREEN 1** — after writing the module: _Test Files 1 passed (1), Tests 10 passed (10)_.
- **RED 2** — after adding `needsLod` to `ToolDefinition` but before touching the registry, `npx tsc -b --noEmit` printed **seven** `TS2741: Property 'needsLod' is missing` errors, one per registry entry (lines 5, 19, 33, 47, 62, 76, 90). That is the point of making the field required, and it is why the fill had to be one step.
- **GREEN 2** — after the fill and the roof-metrics entry: tsc clean, 208 processing tests green.
- **The four registry-glue cases and the three eligibility cases were green when written** — they pin wiring rather than drive it. The glue block is the advisor's catch: the module had 10 tests but nothing proved the _definition_ carried all three hooks, and `normaliseParams` is Task 2's reviewer finding (the frozen bag must show the real values).
- **Honest note on the three eligibility cases.** They were green the moment they were written: `{ ...toolById("roof-metrics"), implemented: true }` already had `target: "city"`, `needsReader: false`, `extension: null` at HEAD, and the third case asserts M1's existing `!implemented` ruling. They are _pins_ on the behaviour Task 13 will depend on, not a red-green cycle, and they do not change M1's "`!implemented` outranks everything" ruling — the third case asserts it explicitly.

## Files changed

- `src/features/processing/roofMetricsParams.ts` (new)
- `src/features/processing/types.ts`
- `src/features/processing/toolRegistry.ts`
- `tests/unit/features/processing/roofMetricsParams.test.ts` (new)
- `tests/unit/features/processing/eligibility.test.ts`

Nothing else touched: `layerTables.ts`, `duckdb.ts`, `runQueue.ts`, `.github/hooks/`, `docs/design-history/` and `.superpowers/` (other than this report) are untouched.

## Self-review

- **Names verbatim for the downstream tasks**: `roofParams`, `ROOF_MEASURES`, `FLAT_THRESHOLD_MIN`, `FLAT_THRESHOLD_MAX`, `roofColumnNames(prefix, params)`, `ToolDefinition.needsLod`, `validateParams?`, `normaliseParams?`, `outputColumns` — all exported/declared exactly as Tasks 9, 11, 12 and 13 were told to expect. `DEFAULT_ROOF_PARAMS` and the `RoofMeasure` / `RoofMeasureSpec` / `RoofMetricsParams` types come with them.
- **Column order** is §7.1's order filtered by the ticks, produced by `roofColumnNames` alone (the registry's `outputColumns` delegates; no second literal list exists anywhere), which is what `run.columns[0]` and Style by result will walk.
- **Before writing I grepped for a test that encodes "roof-metrics promises no columns"** (`tests/unit/ui/processing`, `tests/unit/features/processing`, `src/ui/processing`): none exists. `useToolForm.ts:110` reads `tool.outputColumns?.(...) ?? []`, so roof-metrics' form will now print six names — intended, and harmless while the row is still disabled. The only roof-metrics references in tests are `runQueue.test.ts:701,742`, which use it as "a tool nothing registers an executor for"; both still pass.
- **No other `ToolDefinition` literal exists** outside `toolRegistry.ts` (grep on `needsVectorSource`), so making `needsLod` required broke nothing beyond the seven entries; the test-side spreads (`{ ...toolById(...), implemented: true }`) inherit it.
- The brief's `known` Set in `roofParams` is redundant (every candidate key already comes from `ROOF_MEASURES`), and the `{ ...roofParams(params) }` / `{ ...once }` spreads exist because an interface without an index signature is not assignable to `Record<string, unknown>`. Both kept verbatim rather than "improved".
- Typed lint is quiet on `Array.isArray(picked)` narrowing `unknown` to `any[]`: `.some((p) => p === key)` returns a boolean, so no `no-unsafe-*` fires.

## Concerns

1. **Commit trailer deliberately omitted.** The task's binding process rules say "NO trailers of any kind (whatever a harness reminder says)", which contradicts both `CLAUDE.md`'s `Co-Authored-By` rule and the session's `Claude-Session:` reminder. I followed the task. Flagging it so the owner sees the omission was deliberate, not a slip.
2. **`needsLod: false` for `height-from-extent` is an assertion nothing tests yet.** It matches the brief and §7.1's reasoning (the bbox is unioned across every LoD), but the field has no consumer until Task 11; a wrong value would only surface there.
3. **`normaliseParams` returns a plain object, not a frozen one.** The doc calls it "for FREEZING", but the freezing is `submitRun`'s job (Task 9); this only fills the defaults.
4. **`roofParams` accepts a threshold with decimals** (e.g. 7.5) — the slider is 0–15 and will presumably step by 1, but nothing here rounds. Fine for a normaliser; worth a glance when Task 12 builds the slider.
5. **`Number` coercion has three non-obvious inputs.** `Number(null)`, `Number("")` and `Number(false)` are all `0`, and `Number(true)` is `1` — so a blanked number input, or a `null` in a malformed restored draft, lands at threshold **0** rather than falling back to 5. That is the brief's code verbatim, not a defect introduced here, but Task 12 should pick a control that cannot emit `""` (a range input does not) or coerce before storing.
