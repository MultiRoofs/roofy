# Task 11 — The LoD select — report

Commit: `29f1b75 feat(processing): the tool form offers the LoDs the target actually has`
(one commit, on `develop`, not pushed).

## Implemented

- **`src/ui/processing/useLodOptions.ts` (new).** `LodChoices { options, noun,
emptyReason }` and `useLodOptions(tool, target)`. It subscribes to
  `useStreamStore`'s per-layer `version` so a streaming target's options are
  recomputed on every commit (Task 7's `roofLodOptions` reads the resident
  snapshot at call time), memoises on `tool.needsLod / tool.implemented /
tool.id / target?.id / isStreaming / model / version`, and returns the empty
  `LodChoices` for any tool that is not `roof-metrics`, is not `needsLod`, is
  `implemented: false`, or has no target. Roof copy (owner-accepted adaptation
  of §6's solid wording): noun `"with roof surfaces"`, empty reason
  `"No roof surfaces in this layer"`.
- **`src/ui/processing/useToolForm.ts`.** The existing draft ternary became
  `base`; `target` now resolves from `base.targetLayerId`; `useLodOptions` is
  called unconditionally right after it, and the EFFECTIVE LoD is _computed_
  (never `setDraft` from a render) as: the stored LoD if it still qualifies,
  else the layer's `selectedLod` if it qualifies, else the highest qualifying
  option, else `null`. `draft = { ...base, lod }`, so every line below is
  unchanged. `runReason` precedence is now
  `eligibility → lods.emptyReason → prefixError → scopeReason` (Task 12 inserts
  `paramsError` between the prefix and the scope). The hook returns
  `lodOptions`, `lodNoun`, `lodReason`.
- **`src/ui/processing/ToolView.tsx`.** A `processing-field` label named "LoD"
  inside the TARGET fieldset, between the Layer select and Scope, rendered only
  when `f.tool.needsLod && f.tool.implemented`. With options it is an ordinary
  select whose option text is
  `` `${lod} (${plural(features, "building", "buildings")} ${lodNoun})` ``; with
  none it is a _disabled_ select carrying one unselectable option that reads the
  empty reason, and the same sentence is the footer's Run reason.
- **`tests/unit/ui/processing/roofLayerFixture.tsx` (new, shared with Tasks 12
  and 13).** `roofModel({ roofs })`, `addRoofLayer({ selectedLod, roofs,
isStreaming })` and the exported constants `ROOF_FIXTURE_ROWS` (5),
  `ROOF_FIXTURE_FEATURES_22` (2), `ROOF_FIXTURE_FEATURES_12` (1). Four features
  over five object ids: B1 with roof-bearing part B1P at 2.2, B4 at 2.2, B2 at
  1.2, B3 wall-only at 2.2. `roofs: false` turns every RoofSurface into a
  WallSurface, which is how the "no LoD qualifies" state is reached without an
  empty layer. Typed `ColumnInfo` from `src/insights/columnKind.ts` with
  `kind: "scalar"` (verified: the interface requires `name`, `type`, `kind`).

## Tests

`tests/unit/ui/processing/lodSelect.test.tsx` (new, 7 cases):

1. lists each LoD with its FEATURE count, highest detail first —
   `["2.2 (2 buildings with roof surfaces)", "1.2 (1 building with roof surfaces)"]`
   (singular/plural both exercised; B3 excluded by the contributor rule).
2. defaults to the layer's selected LoD when it qualifies (`1.2`).
3. defaults to the highest qualifying LoD when the layer's does not (`0` → `2.2`).
4. the empty state blocks Run — **queries scoped per the plan's review
   residual**: the disabled combobox's option list is asserted through
   `select.options`, and the footer reason through
   `getByText(..., { selector: "p" })`. One unscoped `getByText` would match both
   nodes and throw.
5. no LoD control for a tool that needs none (`height-from-extent`).
6. no LoD control **and no geometry verdict** for an unimplemented tool
   (`measure-solids`): no combobox, no `/No solid geometry/`, and the footer says
   "Not available yet" — the residual's "`needsLod` drives it" verified, since
   Measure solids _has_ `needsLod: true`.
7. the chosen LoD reaches `submitRun` (`objectContaining({ lod: "1.2" })`).

Deviations from the brief's literal test code, both deliberate:

- added `getEngineGeneration` / `onEngineDeath` to the duckdb `vi.mock` (the
  brief's block omitted them; both are imported by modules under test and every
  peer suite carries them). Task 12 copies this header verbatim, so it inherits
  the fix.
- case 7 asserts with `expect.objectContaining` instead of
  `mock.calls[0]![0]!.lod`, matching `ToolView.test.tsx`'s house style and
  avoiding two new non-null assertions.
- case 4 scoped (above); case 6 gained the "Not available yet" assertion.

`residentModel` is **not** mocked: it imports only `streamStore` plus a type, the
fixture's layers are static, so `getResidentModel` is never reached.

## Results / TDD evidence

- **RED** (`npx vitest run tests/unit/ui/processing/lodSelect.test.tsx`, after
  the fixture existed so the failure could not be an import error):
  `Tests 5 failed | 2 passed (7)`, every failure
  `TestingLibraryElementError: Unable to find an accessible element with the role
"combobox" and name "LoD"`. The two passes are the negative cases (5 and 6),
  which are true before the field exists — case 6's "Not available yet" already
  held from Task 8's registry.
- **GREEN** (`npx vitest run tests/unit/ui/processing`): `Test Files 10 passed
(10)`, `Tests 94 passed (94)` — `ToolView.test.tsx` and `useToolForm.test.tsx`
  included, unchanged.
- `npx tsc -b --noEmit`: clean.
- `npx vp check`: 0 errors, **56 warnings** (baseline), all 665 files formatted.
  One formatting fix was applied by `--fix` to `useToolForm.ts` (the `lod`
  ternary reflowed) before the commit.
- Full suite once, in the background: see "Full suite" below.

## Files changed

- `src/ui/processing/useLodOptions.ts` (new)
- `src/ui/processing/useToolForm.ts`
- `src/ui/processing/ToolView.tsx`
- `tests/unit/ui/processing/lodSelect.test.tsx` (new)
- `tests/unit/ui/processing/roofLayerFixture.tsx` (new)

No CSS change was needed: `.processing-field select` already carries
`width: 100%`, `min-width: 0` and `min-height: var(--control-height-compact)`,
so the LoD select is token-identical to the Layer select above it.

## Self-review

- The default is computed, not written: nothing in this change calls `setDraft`
  from a render, and a stored LoD that stops qualifying is overridden for this
  render only, never overwritten in the store.
- `useLodOptions` is called unconditionally and in a fixed position, so hook
  order is stable across every branch of the form.
- The empty state cannot leak a run: with no options `draft.lod` is `null` _and_
  `runReason` is the empty reason, so Run is disabled.
- Counts traced by hand and confirmed by the test: at 2.2, B1 answers through
  its part B1P (the §7 contributor rule), B4 answers for itself, B3 is excluded
  (geometry, no roof), B2 has nothing at 2.2 → 2; at 1.2 only B2 → 1.
- `plural` gives the singular "1 building" for the 1.2 row, which is why the
  fixture keeps a one-feature LoD.
- The reason precedence puts the LoD verdict above the prefix and the scope, and
  `ToolView`'s existing suppression (footer stays silent when the reason _is_ the
  inline prefix error) is untouched.

## Concerns / notes for later tasks

1. **A mock-world artifact, not a production one.** `useLodOptions` answers only
   for `roof-metrics`; `ToolView` renders the field on `needsLod &&
implemented`. `useToolForm.test.tsx` mocks the registry to make
   `measure-solids` implemented, so in _that suite's_ DOM Measure solids now
   renders a disabled select with a single empty option. Nothing asserts on it
   and no real registry entry can reach that state (after Task 13 the only
   implemented `needsLod` tool is Roof metrics). A tighter render guard
   (`|| lodReason !== null`) was considered and rejected: the only test that
   could cover it would have to flip a second tool in the registry mock that
   Task 13 deletes. **M3 must extend `useLodOptions` in the same commit that
   flips `implemented` on a solids tool**, or that empty select becomes real.
2. **No browser check.** Roof metrics is still `implemented: false`, so the new
   control is unreachable in the running app until Task 13 flips it. The markup
   and tokens are the Layer select's, byte for byte. Task 13 is the right place
   for the browser verification CLAUDE.md's UI-consistency section asks for.
3. The exported fixture constants `ROOF_FIXTURE_FEATURES_22 / _12` are declared
   for Tasks 12–13 as the brief specifies but are not yet consumed: the copy
   assertions here use the literal sentences on purpose, so a drift in the
   number _and_ in the wording both fail loudly.
4. The registry mock block in `lodSelect.test.tsx` carries the brief's comment
   naming Task 13 as its deleter; the `measure-solids` mock in
   `useToolForm.test.tsx` was left alone (the brief does not ask for its
   removal, and it is that suite's only tool with a per-layer failing
   eligibility).

## Full suite

`npx vp test run`, logged to
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/task-11-full-suite.log`
(the caller's scratchpad path, created for this run):

`Test Files 241 passed | 2 skipped (243)`, `Tests 2960 passed | 31 skipped
(2991)`, exit code 0, 63.8 s. No regression anywhere in the app suite.

## Fix round 1

Codex review: **Needs fixes** (one finding plus one minor). Commit
`95f053a fix(processing): a new target takes its own default LoD, never the old one's`,
on top of Task 12's `b1f7856`.

### Finding 1 (blocking) — switching targets carried the previous target's LoD

The reviewer's scenario, verbatim in behaviour: two layers that both offer 2.2
and 1.2, the first defaulting to 2.2, the second with `selectedLod: "1.2"`.
Because `useToolForm.ts:107` accepted _any_ qualifying stored LoD and
`setDraft` copied the whole effective draft, switching target left 2.2 selected
and submitted — a statement about layer A made about layer B, with no user
choice behind it.

**Ruling implemented:** a target change resets `lod` to `null`, so the §6
default rule re-applies to the NEW target (its `selectedLod` when it qualifies,
else the highest qualifying option). An explicit LoD survives only while the
same target is chosen. Both target-change doors are closed:

- `src/ui/processing/useToolForm.ts:218-231` — the returned `setDraft` wrapper
  now detects a retarget (`patch.targetLayerId` present and different from
  `draft.targetLayerId`) and injects `lod: null` _before_ spreading the patch,
  so a caller that deliberately changes both at once still gets the LoD it
  asked for. This is the explicit-select path
  (`ToolView.tsx:127`).
- `src/ui/processing/useToolForm.ts:93-96` — the automatic-replacement branch
  (`stored` names a layer that is gone) now builds
  `{ ...stored, targetLayerId: defaultTarget, lod: null }`.
- `src/ui/processing/useToolForm.ts:113` — the effective LoD now reads
  `base.lod`, not `stored?.lod`. Without this the replacement branch's reset
  would be handed straight back, since the raw store value is untouched (the
  hook still never writes from a render).

`RecentRuns`' "Edit & run" writes the store directly with the run's own
`{ targetLayerId, lod }` pair, so it is unaffected: a matched pair, and if that
layer has since gone the replacement branch drops the LoD, which is correct.

### Minor (folded in) — stream-version coverage

`useLodOptions`' `useStreamStore` version subscription was implemented in Task
11 but only argued in a comment. It now has a test: a commit that changes the
resident roofs re-renders the option counts, and a selected LoD the commit takes
away falls back to the default, in the select and in the submitted request.

### Tests

`tests/unit/ui/processing/lodSelect.test.tsx` grew four cases (7 → 11):

1. _applies the NEW target's default when the target changes_ — the reviewer's
   scenario; asserts the displayed value AND `submitRun`'s `lod` (with its
   `targetLayerId`).
2. _applies the new target's default when the stored target is GONE_ — a stored
   draft naming `"gone"` with `lod: "2.2"` against a single layer selected at
   1.2; displayed and submitted LoD are both 1.2.
3. _keeps an explicit LoD across an edit that is not a target change_ — the
   other side of the reset, so it cannot be "fixed" by resetting on every edit.
4. _follows a streaming target's commits, and drops a LoD they take away_ — the
   minor above.

`tests/unit/ui/processing/roofLayerFixture.tsx` gained what cases 1 and 4 need,
without changing what Tasks 12–13 call: an optional `name` (default `"roofs"`),
and the table entry is now MERGED into `useLayerTableStore` instead of replacing
the map, so two roof layers can be ready at once. A streaming header mock
(`getResidentModel` → a mutable `residents` object) sits at the top of the suite;
Task 12's copy of the header predates it and needs nothing.

### RED / GREEN evidence

- **RED** (`npx vitest run tests/unit/ui/processing/lodSelect.test.tsx` before
  touching `useToolForm.ts`): `Tests 2 failed | 9 passed (11)` — the two
  target-change cases, both
  `Expected the element to have value: 1.2 / Received: 2.2`
  at `lodSelect.test.tsx:237` and `:257`. Exactly the reviewer's defect, and the
  two cases that were _meant_ to pass already did: case 3 (no over-reset) and
  case 4 (the stream subscription was already live).
- **GREEN** (`npx vitest run tests/unit/ui/processing`): `Test Files 11 passed
(11)`, `Tests 106 passed (106)` — `ToolView.test.tsx`, `useToolForm.test.tsx`
  and Task 12's `RoofMetricsParams.test.tsx` included, all unchanged.
- `npx tsc -b --noEmit`: clean. `npx vp check`: 0 errors, **56 warnings**
  (baseline), all 667 files formatted (`--fix` reflowed two files before the
  commit: the new `setDraft` body and one line of the test).
- Full suite once, `npx vp test run` → `Test Files 242 passed | 2 skipped (244)`,
  `Tests 2972 passed | 31 skipped (3003)`, exit code 0. Log:
  `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/task-11-fix1-full-suite.log`.
- Concerns 1–4 above are unchanged by this round. Concern 3 still stands as
  written: `ROOF_FIXTURE_FEATURES_22` / `_12` remain unconsumed, declared for
  Task 13.
- A→B→A loses the explicit choice made on A. That is the ruling as stated —
  "an explicit LoD choice survives only while the same target is chosen" — not an
  oversight.
