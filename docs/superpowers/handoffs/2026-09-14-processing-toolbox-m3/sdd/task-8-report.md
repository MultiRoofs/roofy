# Task 8 report — Switch Measure solids on

Commits (on `develop`, **not pushed**, no trailers of any kind):

- `287baf7` `fix: only an implemented tool warns about re-reading a large source` — controller requirement 3,
  separated because it is a real bug on its own (before the flip, the UNIMPLEMENTED Measure solids form already
  printed §6's workload note).
- `3ba9942` `feat: switch Measure solids on` — the flip, the hook, the PARAMETERS section and every test migration,
  in ONE commit as the M2 ruling requires.
- `40215da` `test: §6's LoD default has two halves, and Measure solids pins both` — requirement 4's other half,
  added after the post-implementation advisor pass pointed out that `lod: "2.2"` over a layer with no
  `selectedLod` proves "the highest qualifying one" and nothing about "the layer's selected LoD when it qualifies".

## Implemented

**`287baf7`**

- **`src/ui/processing/useToolForm.ts`**: new exported pure `toolWorkloadNote(tool, table)` —
  `!tool.implemented || !tool.needsReader || table === null → null`, else `sourceWorkloadNote(table)`. The hook's
  inline expression now calls it. The §6 doc comment moved onto the function.

**`3ba9942`**

- **`src/ui/processing/SolidParams.tsx`** (new): §7.2's six measure checkboxes, `{ params, onChange }`, no store —
  `RoofMetricsParams.tsx`'s shape verbatim, minus the slider (§7.2 has no threshold). Normalises on the way in
  through `solidParams` and writes the WHOLE bag back, so "untick everything" is reachable. §7.2's parentheticals
  are the labels' `title`s. `<prefix>valid` is deliberately not a checkbox.
- **`src/ui/processing/useLodOptions.ts`**: the `tool.id !== "roof-metrics"` early return became two branches —
  roof (unchanged strings) and `measure-solids` → `solidLodOptions(target)`, noun `with a solid`, empty reason
  `No solid geometry in this layer`. Header comment rewritten to state the unimplemented rule without naming the
  two tools that no longer illustrate it.
- **`src/ui/processing/ToolView.tsx`**: `SolidParams` import and a second `PARAMETERS` fieldset dispatched on
  `toolId === "measure-solids"`, identical in shape to the roof one (same `processing-section`, same
  `processing-group__label`, same `paramsError` alert).
- **`src/features/processing/toolRegistry.ts`**: `measure-solids` → `implemented: true` (and the Task-8 note
  above it removed).

## Tested + results

New:

- `tests/unit/ui/processing/SolidParams.test.tsx` (4): the six labels with the mockup's four ticked; the whole
  normalised bag written back in §7.2's order; the empty state Run refuses; §7.2's two hovers.
- `tests/unit/ui/processing/solidsEnabled.test.tsx` (6), against the REAL registry: §6's LoD options with FEATURE
  counts (`2.2 (1 building with a solid)` — B1 counted through its part, B3's MultiSurface not a solid, B2's solid
  at 1.2) and no "Not available yet"; §6's empty state (residual A3 fix below); the PARAMETERS section plus the
  promised column list; the unticked-everything block with `Pick at least one measure` and `solid_valid` still
  promised; the frozen `submitRun` request (normalised params, default LoD 2.2, typed columns); the workload note
  for a 180 MB source.
- `tests/unit/ui/processing/useToolForm.test.tsx` (+4, in `287baf7`): `toolWorkloadNote` over a 180 MB
  `LayerTable` — the sentence for an implemented `needsReader` definition, `null` for an explicitly UNIMPLEMENTED
  one, `null` for a tool that never re-reads, `null` with no ready table.

Migrated / strengthened:

- `tests/unit/features/processing/eligibility.test.ts`: the unimplemented-tool case now states its own fact
  (`{ ...toolById("measure-solids"), implemented: false }`); the reader-reason case drops its `implemented: true`
  spread and pins the REAL entry over CityGML, CityParquet **and** a streaming FlatCityBuf (full sentence, not just
  `.ok`); the restored-dropped-file case likewise; one new case pins the `three_d`-failed reason.
- `tests/unit/ui/processing/lodSelect.test.tsx`: the view-level unimplemented case became a `renderHook`
  `useLodOptions` case over an explicitly unimplemented definition and a REAL roof layer (`{ options: [], noun: "",
emptyReason: null }`); its honest view-level half now lives in `solidsEnabled.test.tsx`.
- `tests/unit/features/processing/solidParams.test.ts`: "is still NOT implemented — Task 8 flips it" → "is
  implemented, which is what makes the form reachable at all" (`roofMetricsParams.test.ts:143`'s shape).
- `tests/unit/ui/processing/useToolForm.test.tsx`: the `toolRegistry` mock that FAKED `implemented: true` for
  Measure solids is deleted — its own stated removal condition ("stays until a reader- or extension-needing tool
  ships") is met by this commit, and leaving it would have made the suite assert against an invented registry.
  Header comment rewritten; both cases pass against the real one.
- `tests/unit/ui/processing/CatalogueView.test.tsx`: one comment corrected ("Every tool but Height from extent,
  Roof metrics **and Measure solids**…"). No assertion changed.

Results (Node 24 shims):

- `npx vitest run tests/unit/ui/processing tests/unit/features/processing` → 29 files, **392 passed** (375 at
  `a61d327` + 15, then + 2 in `40215da`).
- `npx vitest run tests/unit/ui tests/unit/features/processing` → 103 files, 1107 passed (before `40215da`).
- FULL app suite once, background to a file: `250 passed | 4 skipped (254)`, `3119 passed | 70 skipped (3189)`,
  `suite: 0` (`/tmp/m3-task8-suite.log`), measured at `3ba9942`. Task 7's baseline was 248 files / 3104 passed
  (3102 at `696c17c` plus `a61d327`'s two cases): **+2 files, +15 tests**, exactly the 4 + 4 + 6 + 1 written for
  those two commits. `40215da` adds two more passing cases to one existing file; the full suite was not re-run for
  it (nothing under `src/` moved — the whole `tests/unit/ui/processing` + `tests/unit/features/processing`
  selection, `tsc -b` and `vp check` were).
- `npx tsc -b --noEmit` → clean at every commit. `npx vp check` → **0 errors / 56 warnings** (baseline held).
- MUTATION check on `40215da`: replacing `useToolForm`'s default with `lods.options[0]?.lod ?? null` (dropping the
  selected-LoD half) fails exactly the new case — `× defaults to the layer's SELECTED LoD when that one qualifies`,
  `1 failed | 7 passed (8)` — and nothing else. Reverted immediately.

## TDD evidence

RED 1 (`287baf7`, behavioural — the helper was extracted first as a pure refactor and the two suites stayed green,
so the failure is the MISSING CONJUNCT, not a missing import):

```
$ npx vitest run tests/unit/ui/processing/useToolForm.test.tsx
 FAIL  … > §6's workload note > says nothing for an UNIMPLEMENTED tool, whatever the source weighs
AssertionError: expected 'Re-reads a 180 MB source; this can ta…' to be null
 Test Files  1 failed (1)   Tests  1 failed | 7 passed (8)
```

GREEN 1 — after `if (!tool.implemented || …)`: `tests/unit/ui/processing + features/processing` → 27 files,
379 passed.

RED 2 (`3ba9942`):

```
$ npx vitest run tests/unit/ui/processing/SolidParams.test.tsx tests/unit/ui/processing/solidsEnabled.test.tsx
 FAIL  tests/unit/ui/processing/SolidParams.test.tsx
Error: Failed to resolve import "../../../../src/ui/processing/SolidParams". Does the file exist?
 FAIL  … > is no longer 'Not available yet' and offers §6's LoD options
TestingLibraryElementError: Unable to find an accessible element with the role "combobox" and name "LoD"
 FAIL  … > renders the PARAMETERS section and lists the promised columns
TestingLibraryElementError: Unable to find an accessible element with the role "checkbox" and name "Volume (m³)"
 FAIL  … > freezes the normalised parameters, the LoD and the typed columns
AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]
 FAIL  … > shows the workload note for a large source
TestingLibraryElementError: Unable to find an element with the text: Re-reads a 180 MB source; …
 Test Files  2 failed (2)   Tests  6 failed (6)
```

(The rendered DOM in the failure output ends in `<p class="processing-note">Not available yet</p>` — the exact
state the flip removes.)

GREEN 2 — after `SolidParams.tsx`, the `useLodOptions` branch, the `ToolView` dispatch and `implemented: true`:
`Test Files 2 passed (2) — Tests 10 passed (10)`, then 390 across the two processing trees, then the full suite.

## Files changed

- `src/ui/processing/useToolForm.ts` (`287baf7`)
- `src/ui/processing/SolidParams.tsx` (new), `src/ui/processing/useLodOptions.ts`,
  `src/ui/processing/ToolView.tsx`, `src/features/processing/toolRegistry.ts`
- `tests/unit/ui/processing/{SolidParams,solidsEnabled}.test.tsx` (new)
- `tests/unit/ui/processing/{useToolForm,lodSelect,CatalogueView}.test.tsx`,
  `tests/unit/features/processing/{eligibility,solidParams}.test.ts`

## How each controller requirement was met

1. **Residual A3.** `solidsEnabled.test.tsx`'s empty-state case mirrors `lodSelect.test.tsx`'s roof case exactly:
   the option is asserted through `[...select.options].map(o => o.textContent)` on the disabled select, and the
   footer reason through `getByText("No solid geometry in this layer", { selector: "p" })` (the footer renders it
   as `<p class="processing-note">`, `RunFooter.tsx:391`). No unscoped `getByText` for that sentence anywhere.
2. **Migrated, not retargeted.** Both suites keep the invariant on `{ ...toolById("measure-solids"), implemented:
false }` — a fact the test states itself. `lodSelect`'s moved from the VIEW (which reads the registry by id and
   cannot be handed a definition) to `renderHook(() => useLodOptions(tool, target))`, over a real roof layer, so
   "a real layer with real geometry still gets nothing" is what it proves. Nothing was retargeted at
   `validate-solids`. Same commit as the flip. A THIRD suite needed the same treatment and the grep found it:
   `solidParams.test.ts`'s "is still NOT implemented" pin, now the positive.
3. **Workload-note gate.** `toolWorkloadNote` in `useToolForm.ts` carries all three conditions, and the hook is its
   only caller. Tested on definitions rather than on registry ids, for requirement 2's own reason — the seam exists
   precisely so the rule can be stated on an explicitly unimplemented tool instead of on `validate-solids`, which
   Task 10 flips. Positive and negative both asserted over the same 180 MB table, so neither is vacuous; the
   end-to-end positive is `solidsEnabled`'s last case.
4. **`useLodOptions`.** `solidLodOptions(target)`, noun `with a solid`, empty reason `No solid geometry in this
layer`; Run disabled with that reason (asserted). The default is `useToolForm`'s existing rule, unchanged, and
   BOTH halves are now pinned on this tool (`40215da`): `selectedLod: "1.2"` — which qualifies through B2's solid
   and is not the highest — defaults to and submits 1.2; `selectedLod: "0"` and the no-selection case both fall
   back to 2.2. The mutation above shows the first case is what separates them.
5. **Real per-layer reasons.** Pinned in `eligibility.test.ts` against the REAL registry entry (no `implemented:
true` spread left on it): the reader sentence for CityGML, CityParquet and a streaming FlatCityBuf — full
   string, where the streaming half used to assert only `.ok === false` — the restored-dropped-file sentence, and
   a new case for the `three_d` failed download. `!implemented` no longer outranks any of them.
6. **Mocks.** `solidsEnabled.test.tsx`'s `vi.mock(".../insights/duckdb")` factory carries all 17 exports (byte-
   identical to `lodSelect.test.tsx`'s, which loads the same module graph). No other factory needed a change, and
   no new `duckdb.ts` export was added by this task. Verified by the run, not by inspection.

## Self-review

- `SolidParams.tsx` reuses `.processing-checks` — the same class, the same grid and the same 12 px label row as
  `RoofMetricsParams`' six checkboxes — so the Soft Utility tokens apply by construction and no new CSS was added.
  Per the controller, no browser smoke here (Task 29 does it); `npm run build` was not run and no dev-server-facing
  file (vite config, `.env`, index.html) was touched.
- `useLodOptions`'s roof branch is character-for-character the old body; only its guard changed from an early
  return to an `if`. The `useMemo` dependency list is untouched — `tool.id` is already in it, and
  `solidLodOptions` reads the same `target.model` / `isStreaming` / `version` inputs `roofLodOptions` does.
- The `ToolView` PARAMETERS blocks are two sibling conditionals, not a nested branch: the third tool is one more
  block, as the module's comment promises.
- `toolWorkloadNote` is exported from a hook module. That is a seam, not an abstraction: one caller, four lines, no
  state, and it exists so the §6 rule can be tested on a definition. If a reviewer prefers it inline, the conjunct
  is the change that matters and the tests would move to `validate-solids` until Task 10.
- Deleting `useToolForm.test.tsx`'s registry mock is the one edit beyond the brief's file list (the advisor pass
  flagged it). The mock existed only to invent a shipped reader-needing tool; this commit ships one, and both cases
  pass against the real registry. Its renders now show the empty, disabled LoD select over `objects: {}`, which is
  correct and which neither case asserts against.
- Grepped `measure-solids|Measure solids|Not available yet|implemented` across `tests/` before writing: the four
  test files above were the only ones whose TRUTH changed. `CatalogueView`'s `getAllByText("Not available yet")`
  still matches (validate-solids and the three spatial tools), `extensionChip`'s `retries("three_d")` is still 2
  (the Retry link is per tool with the extension, not per implemented tool), and `runQueue.test.ts`'s "Not
  available yet" is the no-executor path, unrelated.
- No trailers. `.github/hooks/`, `docs/design-history/` and `.superpowers/` left untracked and unstaged. Nothing
  pushed. Hooks ran on both commits (pre-commit `vp staged`); none bypassed. The plan file was not edited.

## Deviations from the brief (requirements win, as instructed)

1. **TWO commits, not one.** The brief's Step 8 is a single commit; the workload-note gate (requirement 3) is a
   separate behavioural fix that stands on its own before the flip, and "one change per commit" is a global
   constraint. The flip itself, `useLodOptions`, the section and every test migration are still one commit.
2. **`toolWorkloadNote` extracted** rather than the conjunct added inline — so requirement 3's test could state the
   rule on an explicitly unimplemented definition, which is requirement 2's own reasoning applied to requirement 3.
3. **Three extra test files touched** beyond the brief's two: `solidParams.test.ts` (a fourth suite pinning
   `implemented: false`, which the brief did not list and which the flip falsifies), `useToolForm.test.tsx` (the
   stale registry mock) and `CatalogueView.test.tsx` (one comment).
4. **`eligibility.test.ts` goes further than the brief's Step 6**: requirement 5 asked for the real per-layer
   reasons, so the two measure-solids cases dropped their `implemented: true` spreads and gained the CityParquet,
   full-streaming-sentence and `three_d`-failed assertions.
5. **No browser check** (the brief's Step 7 second half) — the controller assigns it to Task 29.

## Concerns for later tasks

- **Task 10 inherits three migrations.** `validate-solids` is now the LAST `needsLod` tool that is unimplemented,
  so when it flips: `useLodOptions` needs its branch in the same commit (the same noun/reason question §6 answers
  for it), and nothing else should need retargeting — the unimplemented invariants now live on self-declaring
  definitions in `eligibility.test.ts`, `lodSelect.test.tsx` and `useToolForm.test.tsx` and will survive it.
- **`extensionChip.test.tsx:355`'s comment** still reads "all three spatial tools are still `implemented: false`" —
  true today, false after Task 16/17/19. Left alone deliberately; it is accurate at this commit.
- **The catalogue row for Measure solids is now ENABLED** wherever a CityJSON/CityJSONSeq layer has a live source,
  which means Task 29's smoke is the first time a real 3D BAG-sized layer reaches the executor's unbounded
  contributor-id `IN` list that Task 7's report flags.
- **COMMANDER RULING WANTED — the LoD select now draws a geometry verdict on an INELIGIBLE target.**
  `ToolView.tsx` renders the LoD field on `needsLod && implemented` alone, independent of `f.eligibility.ok`. So a
  streaming FlatCityBuf target (where `hasSolidAt` returns `() => false` BY CONSTRUCTION — the resident record
  carries no geometry type) or a CityParquet one (`geometryType: null` by decision (a)) now opens the Measure
  solids form with a disabled select reading "No solid geometry in this layer" above a footer reading the true
  reason ("Needs a CityJSON or CityJSONSeq source; this layer was loaded from …"). Design decision (a) accepted
  CityParquet's `null` tags precisely because "eligibility refuses it first … so no user-visible verdict changes" —
  that premise holds for the RUN and for the catalogue row, but not for the form's select. For FCB it is a verdict
  on data the app never inspected, which is §6's own prohibition wearing a different hat. `useToolForm.test.tsx`'s
  "keeps an ineligible target the user already chose, and says why" case renders exactly this state today (over an
  empty model) and passes, because it asserts only the footer.
  **Not changed here**, deliberately: the one-line fix is `f.tool.needsLod && f.tool.implemented &&
f.eligibility.ok` on `ToolView.tsx`'s LoD block, and it changes what Roof metrics shows on an engine-failed or
  table-failed target too — a §6 reading, not a Task 8 edit. Worth deciding before Task 10 (Validate solids hits
  the identical path) and worth naming in Task 29's smoke: open Measure solids on an FCB layer.

---

## Fix round 1 (review: Needs fixes — one Important, one Minor; both done)

Commits, on top of `9b822e5` (Task 7's fix round), on `develop`, not pushed, no trailers:

- `1d3cf4c` `fix: a tool refused on a layer claims nothing about its geometry` — the Important finding.
- `a7ce037` `test: each measure's hover is pinned to its own checkbox` — the Minor finding.

### What changed (`1d3cf4c`)

Two gates, because the reviewer's sentence has two halves — the CONTROL and the ANSWER behind it:

- **`src/ui/processing/useToolForm.ts`**: `targetCtx` and `eligibility` (both pure) moved up to just after
  `target` is resolved, and the LoD answer is now `eligibility.ok ? lodAnswer : NO_LOD`. `useLodOptions` is still
  called UNCONDITIONALLY — the substitution is on its result, not on the call — so the hook order is unchanged.
  With the answer emptied, `emptyReason` is `null`, so §6's geometry sentence cannot reach Run's reason, the
  disabled select's option, or the draft's default LoD (which becomes `null` for a refused target; Run is disabled
  by the eligibility reason anyway, and switching back to an eligible layer re-applies §6's default).
- **`src/ui/processing/useLodOptions.ts`**: `NO_LOD` is now exported, with a doc comment saying why — "no answer at
  all", as distinct from "no LoD qualifies", which is a verdict.
- **`src/ui/processing/ToolView.tsx`**: the LoD field renders on
  `f.tool.needsLod && f.tool.implemented && f.eligibility.ok`, with a comment naming the case.

Deliberately NOT changed: `eligibility.ts`'s priority order, the PARAMETERS sections (they claim nothing about the
data — they are the tool's own settings, and §6 shows them on a disabled form), and the workload note (already
gated on `implemented`; it is a fact about the SOURCE, and an ineligible reader-needing target has no ready
source-bearing table to produce one from in the refused cases).

### Tests

- `tests/unit/ui/processing/solidsEnabled.test.tsx` (+2, real registry, real `ToolView`): a **streaming
  FlatCityBuf** target and a **CityParquet** target (`geometryType: null` surfaces, decision (a)'s own shape).
  Each asserts no LoD combobox, `queryByText(/No solid geometry/)` null anywhere in the form, Run disabled, and the
  EXACT §5 sentence retained ("… loaded from a streaming FlatCityBuf" / "… loaded from CityParquet"). The fixture
  grew three options (`untagged`, `encoding`, `reader`, `isStreaming`); the eligible-but-no-solids case is
  untouched and still asserts the option AND the `{ selector: "p" }` reason.
- `tests/unit/ui/processing/lodSelect.test.tsx` (+1): **Roof metrics** at the same shared gate, refused by a FAILED
  ENGINE (the reason that can reach a tool needing no reader) — no LoD control, no `/No roof surfaces/` anywhere,
  "Not available while DuckDB is unavailable" shown, Run disabled. The suite's duckdb mock is driven through
  `vi.mocked(getDuckDBStatus).mockReturnValue(...)`, and a `beforeEach` re-sets the ready status because
  `vi.clearAllMocks()` clears calls but NOT a `mockReturnValue`.
- `tests/unit/ui/processing/SolidParams.test.tsx` (`a7ce037`): the hover case now reads each title off the LABEL
  ENCLOSING its own checkbox (Volume ↔ "Only for a closed, valid solid", Height ↔ "Ridge minus ground at this
  LoD"), so swapped hints fail, plus one negative (Envelope area carries no `title` at all).

### TDD evidence

The gate was written first, then STASHED to a patch and reverted (`git diff > /tmp/claude-gate.patch;
git checkout src/ui/processing/{ToolView,useLodOptions,useToolForm}.ts`) so the three new cases could be watched
failing against the shipped code:

```
$ npx vitest run tests/unit/ui/processing/{solidsEnabled,lodSelect,SolidParams}.test.tsx
     × claims NOTHING about a streaming target's geometry
     × claims NOTHING about a CityParquet target's geometry
     × drops the LoD control entirely when the tool is REFUSED on this target
 FAIL … > drops the LoD control entirely when the tool is REFUSED on this target
AssertionError: expected <select aria-label="LoD">…(2)</select> to be null
 FAIL … > claims NOTHING about a streaming target's geometry
AssertionError: expected <select aria-label="LoD" …(1)>…(1)</select> to be null
 FAIL … > claims NOTHING about a CityParquet target's geometry
AssertionError: expected <select aria-label="LoD" …(1)>…(1)</select> to be null
 Test Files  2 failed | 1 passed (3)   Tests  3 failed | 23 passed (26)
```

Each failure is the right one: the refused Measure solids forms rendered the DISABLED select (one option — the
geometry verdict), and refused Roof metrics rendered its real two-option select. `git apply /tmp/claude-gate.patch`
→ `Test Files 3 passed (3) — Tests 26 passed (26)`.

(The hover strengthening passed before and after, as a test-only sharpening must: it pins an association the
component already had, and `a7ce037` is committed as `test:` for that reason.)

### Verification

- `npx vitest run tests/unit/ui tests/unit/features` → 166 files, **1881 passed**.
- FULL app suite once, background to a file: `251 passed | 4 skipped (255)`, `3131 passed | 70 skipped (3201)`,
  `suite: 0` (`/tmp/m3-task8-fix1-suite.log`). `9b822e5` stood at 3128; **+3**, exactly the three new cases.
- `npx tsc -b --noEmit` → clean. `npx vp check` → **0 errors / 56 warnings** (baseline held).
- Hooks ran on both commits; nothing bypassed, nothing pushed, `.github/hooks/`, `docs/design-history/` and
  `.superpowers/` still untracked and unstaged. No file of another task's was touched.

### On the review's one unverifiable claim

The reviewer noted that the aggregate diff cannot establish commit membership. For the record: `git show --stat
3ba9942` lists exactly the eleven files of the flip (registry, `useLodOptions`, `ToolView`, `SolidParams.tsx`, and
the six test files plus the new suite), and `287baf7` (the workload gate) and `40215da` (the LoD-default pin) are
separate; `git log --oneline a61d327..40215da` shows the order. Nothing about the flip landed outside `3ba9942`.

### Concerns after this round

- The gate makes a refused target's draft carry `lod: null`. Nothing reads it while Run is disabled, and Task 20's
  New-layer destination adds no LoD reader — but a future feature that persists a draft across targets should treat
  a null LoD as "not yet answered", not as "none qualifies".
- Task 10 inherits the gate for free (`validate-solids` renders through the same `ToolView` block); the two view
  tests above are the pattern for it.
