# Task 11 — Tool view, run footer, recent runs, log view (spec §6)

Branch `develop`, four commits on top of `63eb06e`:

- `a1b1e39` fix(processing): the Tools button reveals the Tools tab instead of closing it
- `bbba686` feat(processing): the tool form and its run footer (spec §6)
- `c9be262` feat(processing): recent-run rows and the run log (spec §5, §6.4)
- `2df6d33` fix(processing): the panel's compact actions match their peers
  (the self-review pass: `docs/ui-consistency.md` sizing, the pending-count
  label, the card acting on the run's frozen target, Cancel run disabled while
  already cancelling)

`index.html`, `src/app/launchScreen.ts` and `tests/unit/app/launchScreen.test.ts`
were left alone; every commit staged by path. Nothing pushed.

## Implemented

### Commit 1 — the Task 4 review findings (A, B, C)

- **A.** `processingStore` gained `activeTab: "tools" | "details"` and `setTab`.
  `ProcessingPanel` reads them instead of its own `useState` (the
  "selection cleared → back to Tools" effect and the emphasis dot are unchanged).
  `setOpen(true)`, `openTool` and `openLog` all put the Tools tab up.
  `ToolsButton` now implements spec §4.1's four branches in order: closed →
  open on Tools; open + collapsed → expand; open + Details showing → `setTab("tools")`;
  open + Tools visibly active → close. The collapse is tested BEFORE the tab,
  because a collapsed panel hides both tabs and the click asked for this one.
  - The un-collapse could not go into `openTool`/`openLog` themselves: nothing
    under `features/` may import from `ui/`, and `rightCollapsed` is the shell's
    state. It lives in a new `src/ui/processing/revealTools.ts`
    (`revealTools`, `openToolView`, `openRunLog`), and every UI call site —
    `CatalogueView`'s rows, `RecentRuns`' Log and Edit & run, `RunFooter`'s Log —
    goes through it. The un-collapse is covered in `CatalogueView.test.tsx`,
    `RecentRuns.test.tsx` and `ToolsButton.test.tsx`.
- **B.** `tests/unit/features/selection/useEscapeClearsSelection.test.tsx`: the
  misnamed case is now "clears the selection for a CLOSED toolbox left on a tool
  view" (and also asserts the view is untouched), plus a new
  "closes an open scene sheet before it touches the tool form" case. The hook
  already ordered sheet before form, so that case is a regression pin, not a fix.
- **C.** `processing.css`'s undefined `--font-label` is `--font-mono`; the unused
  `.processing-catalogue` class and `data-extension` attribute are gone from
  `CatalogueView`; the close button's `title` that duplicated its `aria-label`
  is gone from `ProcessingPanel`.

### Commit 2 — the form and the footer

- `src/ui/processing/useToolForm.ts` — the brief's hook, plus `requestFromRun`
  (added in commit 3's edit to the same file) and the `OUTPUT_COLUMNS` map.
- `src/ui/processing/runFormat.ts` — pure `seconds`, `plural`, `phaseLine`,
  `clockTime`, `SCOPE_WORD`, `STATUS_WORD` and `formatRunLog`.
- `src/ui/processing/ToolView.tsx` — a `<form>` (so Enter in a field runs it) with
  two `<fieldset disabled>` sections, so §6.1's "the form locks" is one attribute.
- `src/ui/processing/RunFooter.tsx` — one region that is in turn the Run button,
  the progress block (indeterminate bar, phase line with ticks, elapsed timer on a
  250 ms interval, Cancel run), the §6.2 result card (line, detail, "Wrote N
  columns to <target>.", note, Open table / Style by result / Undo / Log / Run
  again) and the §6.3 failure ("✕ Failed after X s", the first error line, Retry,
  Log). A `queued` run shows "Queued behind <tool>" and Cancel run.
- CSS for all of it, on the existing control tokens.

### Commit 3 — the history and the log

- `RecentRuns.tsx` — the §5 rows: dot (`data-status`), "<tool> · <target>[ ←
  <source>] · <elapsed> · <status>", the summary or first error line, and only
  the actions that mean something: Log always, Undo on a done+undoable+not-stale
  run, Re-run on a stale one, Retry on a failure, Cancel while in flight, and
  Edit & run (writes the run back into the tool's draft, then opens the form).
- `LogView.tsx` — §6.4's header as a definition list, each `LogEntry` as label +
  `<pre>` SQL + "0.4 s · 1,116 rows", the warnings, the error, Copy (from the pure
  `formatRunLog`) and a Back chevron to whichever view opened it. A run that has
  left the history reads "This run is no longer in the history".

## Deliberate departures from the brief

1. **Run stays enabled while another run executes.** The brief's
   `canRun && !busy` would disable Run and then print "Queued behind the running
   tool" under a button that queued nothing. Spec §6.1 says the opposite: "a
   second Run from any tool queues it and the footer says 'Queued behind Measure
   solids'". So `submitRun` is allowed to produce the `queued` record, and
   `useToolForm` returns `queuedBehind` — the NAME of the running run's tool,
   which the brief's fixed string could not carry. Test: "names the running tool
   a queued run waits behind".
2. **An empty prefix is a legal prefix.** The brief's `PREFIX_RE` rejects `""`
   and checks the regex before the collisions, so the brief's own second test
   ("empty prefix → 'height*m' collides") could not pass against it. The regex is
   `/^(?:[a-z]a-z0-9*]\*)?$/i`; the source-collision check is what refuses the
   empty prefix, with exactly the spec's message.
3. **The prefix error is printed once.** Spec §6 puts Run's reason under the
   button, but the prefix error is already on screen inline under the field it
   belongs to (with `role="alert"`), and the same sentence twice reads as two
   problems. `footerReason` suppresses it; every other reason (eligibility,
   scope) still prints under Run. Pinned by the two prefix tests using
   `getByText`, which would fail on a duplicate.
4. **"Matching" carries no count while nothing is filtered.** `useLayerCounts`
   answers the ALL count for `matching` when `query.applied === null` (its SQL has
   no WHERE), so the brief's `counts.matching === null` test for "no filter" does
   not hold against the real hook — as the brief itself anticipated. `noFilter`
   comes from `layerQuery(state, id).applied === null`, and the disabled radio
   reads just "Matching" rather than repeating the All number.
5. **Undo does not get its own footer state.** `undoRun` patches
   `{ undoable: false, note: "Undone" }` on a record that stays `done`, so the
   card stays, loses its Undo button and gains the muted "Undone" line. Verified
   in the browser.
6. **One extra spec reason.** §7's common rules disable Run with "Nothing to run
   on (0 buildings)" for a scope that resolves to zero features; `scopeReason`
   carries it.

## Tests

`npx vitest run tests/unit/ui/processing tests/unit/features/processing` →
**12 files, 103 tests, all passing.** After the review pass (commit `2df6d33`),
`npx vitest run tests/unit/ui/processing` → 6 files, 45 tests, all passing.
`npx vitest run tests/unit/features/selection tests/unit/ui/shell tests/unit/ui/table`
→ 18 files, 248 tests, all passing. **Full suite** (`npx vitest run`, in the
background) → **229 files passed / 1 skipped, 2,750 tests passed / 20 skipped**.
One caveat on ordering: that full run started before commit `2df6d33`'s four
files landed; those files are `ToolView.tsx`, `RunFooter.tsx`, `processing.css`
and `ToolView.test.tsx`, all covered by the post-fix focused run above, and
nothing outside `src/ui/processing/` changed in it. `npx tsc -b --noEmit` clean
after every commit.
Pre-commit `vp check --fix` ran on every commit; hooks were not bypassed.

New/changed test files:

- `tests/unit/ui/processing/ToolView.test.tsx` (9 cases): the TARGET/OUTPUT
  render and the exact `submitRun` request; the blocked-Run reason; the
  source-attribute collision; the non-name prefix; the replace warning and the
  running → done → failed footers with `cancelRun`/`undoRun`; Open table and
  Style by result; "Queued behind Measure solids"; the form lock + Run again; the
  streaming note.
- `tests/unit/ui/processing/RecentRuns.test.tsx` (8 cases): the empty line; a done
  row's dot/head/second line/Undo/Log; "← source"; Retry's rebuilt request;
  Cancel while running (and no Undo then); the stale row's Re-run; Edit & run's
  draft + un-collapse; newest first.
- `tests/unit/ui/processing/LogView.test.tsx` (6 cases): the header, statement and
  warning; Copy's clipboard text; Back to the opening view; the missing-run line;
  two `formatRunLog` cases.
- `ToolsButton.test.tsx`, `ProcessingPanel.test.tsx`, `CatalogueView.test.tsx`,
  `useEscapeClearsSelection.test.tsx` extended as described above.

### TDD evidence

- Commit 1 RED: `expected undefined to be "tools"` and
  `TypeError: useProcessingStore.getState(...).setTab is not a function`
  (5 failing / 17 passing) before `activeTab` existed; green after.
- Commit 2: **the initial ToolView assertions were NOT captured red.** The test
  file was written first, but its first execution was against the finished
  `useToolForm` / `runFormat` / `RunFooter` / `ToolView` (7 passed, 2 failed), so
  the "fails because the placeholder has no form" step exists only as intent, not
  as evidence. The `⚠ ` / `✓ ` marks were likewise split into their own
  `aria-hidden` spans pre-emptively, from reading the spec strings against the
  JSX, never from a failure. The ONE observed RED in this commit is a real
  finding and was fixed because of it: `Found multiple elements with the text:
Use letters, digits and underscores, starting with a letter` (and the same for
  the collision message) — the prefix error was printed twice, inline and under
  Run, which is departure 3. 9/9 green after.
- Commit 3 RED: 11 failing / 3 passing — the three that passed were the
  `formatRunLog` cases, whose implementation had landed in commit 2's
  `runFormat.ts`. One RED was a real finding: "offers Cancel while a run is
  queued or running" failed with `expected <button> to be null`, because the
  Undo button was gated on `run.undoable` alone rather than on §5's "only for a
  DONE run that is still undoable". 14/14 green after the fix.

## Browser check (~8 min, dev server already on 5173)

Delft sample loaded (1,115 buildings, streaming FCB layer), Tools → Height from
extent → Run:

- The form rendered "All 1,115 buildings" checked, "Matching" disabled with the
  "No filter applied" tooltip, "Selected 0" disabled with "Nothing selected on
  this layer", and `extent_height_m, extent_zmin_m, extent_zmax_m` in mono.
- Run finished into the card: "✓ 1,115 buildings measured · 0.5 s" and "Wrote 3
  columns to delft.city.jsonl.", with Open table / Style by result / Undo / Log /
  Run again. The replace warning ("3 of these columns exist; they will be
  replaced.") appeared in the form as soon as the columns existed.
- **Open table** activated the layer and opened the drawer. The three new columns
  are on the table and appear at the END of the column picker, after the source
  attributes — but the Records view's DEFAULT visible set does not include them,
  so they are not in the header until the user ticks them. Spec §6.2 asks for
  them "appended after the existing ones and scrolled into view"; that is the
  drawer's own column-selection work, not this task's, and is listed as a concern
  below.
- **Style by result** opened the STYLE section (the rule-draft prefill is Task 13).
- **Undo** rolled the run back: the card kept its line, lost Undo and gained
  "Undone", and both the column picker entries and the form's replace warning
  went away — so the table columns and the provenance registry both came back.
- **Log** showed the full §6.4 header ("All · 1,115 buildings (frozen at
  11:11:36)", output columns, started/elapsed/status) and the two statements
  with their timings ("Reading extents … 0.0 s · 2,231 rows", "Writing results …
  0.4 s · 2,231 rows"). Back returned to the tool view; Back again to the
  catalogue, where Recent runs listed "Height from extent · delft.city.jsonl ·
  0.5 s · done" with "1,115 buildings measured · 0.5 s", Log and Edit & run.
- 0 console errors over the whole session.

## Files changed

- `src/features/processing/processingStore.ts`
- `src/ui/processing/{ProcessingPanel,ToolsButton,CatalogueView,ToolView,RunFooter,RecentRuns,LogView}.tsx`
- `src/ui/processing/{revealTools.ts,useToolForm.ts,runFormat.ts,processing.css}`
- `tests/unit/ui/processing/{ToolView,RecentRuns,LogView,ToolsButton,ProcessingPanel,CatalogueView}.test.tsx`
- `tests/unit/features/selection/useEscapeClearsSelection.test.tsx`

## Self-review

`docs/ui-consistency.md` read and diffed against the new CSS; three changes came
out of it, all in the last (uncommitted at review time, then amended) pass:

- The card, history-row and Copy action buttons were 11px; the panel's existing
  compact peers (`.processing-back`, `.processing-search`, `.processing-tab`) are
  12px, and the doc forbids shrinking a compact control's typography arbitrarily.
  They are 12px now, still at `--control-height-compact`.
- Those button groups were 6px apart; the doc asks for 8px between related
  controls. (The scope radios stay at 6px: they are radio ROWS inside one field,
  not sibling controls, and the brief specifies 6.)
- The progress bar's 2px radius is the only non-`--control-radius` radius; per the
  doc's "any intentional exception must have a concrete interaction reason
  documented beside its CSS", the reason is now a comment above the rule (a 3px
  bar at 8px would be a lozenge).
- The back chevron is a literal `‹`, matching `src/ui/table/Pagination.tsx`'s
  first/previous/next buttons rather than inventing an `ActionIcon` glyph; there
  is no back or chevron icon in `ActionIcon`.

- Controls against their peers: every button is a plain `<button>` on
  `flatControls`' tokens. The one filled button is `.processing-run` at
  `var(--control-height)` using app.css's shared `--accent-fill` /
  `--on-accent` pair (not a hardcoded lime), with `!important` only because
  `body button` sets the fill that way. Secondary card and row actions are
  `--control-height-compact` at 11px, matching the panel's other inline actions.
  Fields are compact height; the back chevron is a 30×30 transparent icon button
  like `.processing-tab--close`, with the same justification comment.
- No `title` duplicating an `aria-label` anywhere new; the `title`s that exist
  are the spec's disabled-radio reasons on their `<label>`s.
- Reduced motion: both the progress bar's segment and the running dot's pulse
  are static under `prefers-reduced-motion: reduce`.
- Theming: only tokens, no literal colours; `--bg-raised` for the log's `<pre>`.
- No `@navaramap/*` or `@duckdb/duckdb-wasm` import anywhere in this task's
  files; the engine is reached only through `runQueue` and `insights/*`.

## Concerns

1. **The drawer does not surface the new columns by default** (browser check
   above). Spec §6.2's "appended after the existing ones and scrolled into view"
   is unmet — the columns exist and are pickable, but the Records view's default
   column set is computed elsewhere. If no later task owns it, it needs one.
2. **Sub-100 ms statements read "0.0 s"** in the log. That is `seconds()`'s one
   decimal, shared with the card, where a tenth is the right resolution. A log
   that wants milliseconds needs its own formatter.
3. **`useToolForm` subscribes to the whole `layers` and `tables` maps**, so the
   form re-renders on any layer change. Acceptable at this size; if the panel
   ever feels slow, `eligibleTargets` is the memo to narrow.
4. **`latestRun` matches on tool + target only.** Two runs of the same tool on
   the same layer therefore share one footer, which is what §6.2's "Run again"
   wants, but it means switching the target select swaps the card under the user.
   That reads correctly to me; worth a second opinion.
5. **Recent runs shows the summary on an undone run**, not "Undone" — spec §5
   says the second line is the summary or the first error line, so this is
   spec-literal, but the undone state is then visible only through Undo's
   absence. The footer card does say "Undone".
6. **"This run is no longer in the history" is invented copy.** The spec has no
   line for a log opened on a run the 20-run cap evicted; this is the one string
   in the task that is not verbatim.
7. **LoD, PARAMETERS and "Write to" are absent** — deliberately: Height from
   extent has no LoD and no parameters (§7.4), and the New-layer destination is
   not in M1's scope. `useToolForm` has the seams (`draft.lod`, `draft.params`,
   `OUTPUT_COLUMNS` taking `params`) for the tools that need them.

---

## Fix round 1 (2026-09-11)

Nine commits on `develop`, on top of `997c869`, every one staged by path, no
trailers, hooks never bypassed, nothing pushed:

- `67042c6` fix(processing): Retry re-runs the failed run's frozen request
- `3da51b4` refactor(processing): one builder for Height from extent's column names
- `9f9bc75` fix(processing): one .processing-back rule, on the compact control token
- `6344ac2` fix(processing): the phase line is a polite live region; log keys survive a repeat
- `001d012` fix(processing): the done card locks the form and Run again only unlocks it
- `d36d83b` fix(processing): the queue note only speaks for a queued run, and outranks the draft's reason
- `2b77efd` fix(processing): the Layer select lists only targets the tool can run on
- `bb564cc` test(processing): the Matching scope with a filter applied
- `757baab` fix(processing): a queued footer never falls through to the draft's reason

`npx tsc -b --noEmit` clean before every commit and at the end.
`.github/hooks/` and `docs/design-history/` left untracked and unstaged.

### Finding 1 — Retry called the form's `run()`

`src/ui/processing/RunFooter.tsx:166-172`: the failed card's Retry is now
`onClick={() => submitRun(requestFromRun(run))}` (§6.3 "Retry re-runs with the
same parameters"), with the imports at `RunFooter.tsx:10-15`. The `onRun` prop
was Retry's only consumer — every other Run button is a `type="submit"` inside
the form — so it is gone from `Props` and from `ToolView`'s call site.

Test: `ToolView.test.tsx` → "retries a failed run with its FROZEN parameters,
not the draft". It drives the prefix to `"1 bad"` first, so a Retry wired to the
draft is not merely wrong but DEAD.

- RED `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`:
  `AssertionError: expected "vi.fn()" to be called with arguments: [...]
Number of calls: 0` — exactly the dead-button symptom.
- GREEN same command: 11 passed.

### Finding 2 + 8 — "Queued behind X" before anything is queued, and precedence

`src/ui/processing/ToolView.tsx:47-58`: the footer's note is now
`latestRun?.status === "queued" ? queueNote : footerReason`, where `queueNote`
is non-null only when
`latestRun?.status === "queued"`. While another tool's run executes and this
form has queued nothing, Run stays enabled and the footer says nothing; once
this form's run IS queued, the queue note is the only thing the footer says
(a reason left over from the draft would read as "and it will fail too"). The
precedence is one expression with the rule in a comment above it.

Tests: `ToolView.test.tsx` → "says nothing about a queue before anything is
queued", "lets a queued run's note win over the reason Run was blocked" and
"keeps a stale reason out of the queued footer even before anything runs" (the
existing "names the running tool a queued run waits behind" and "names the
reason Run is blocked under the button" pin the other two corners).

The third case is a second red found in review after the first fix landed: with
`queueNote ?? footerReason`, a run QUEUED while nothing is running yet (the
hand-off between one run finishing and the next starting) has a null
`queuedBehind`, so the draft's reason fell through into the queued footer —
exactly what §6.1's queue note is supposed to replace. RED
`TestingLibraryElementError: Unable to find an element with the text: Queued`;
fixed in `757baab` by making the precedence a ternary on the status rather than
a nullish fallback. GREEN `npx vitest run tests/unit/ui/processing
tests/unit/features/processing`: 116 tests.

- RED `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`, 2 failures:
  `expected document not to contain element, found <p class="processing-note">
Queued behind Measure solids</p>`, and `Unable to find an element with the
text: Queued behind Measure solids` (the queued footer was printing the stale
  "Nothing selected on this layer" instead).
- GREEN `npx vitest run tests/unit/ui/processing`: 7 files, 52 tests.

### Finding 3 — the §6.2 lock/unlock ruling

`src/ui/processing/ToolView.tsx:22-41`: a view-local
`dismissedRunId` (`useState<string | null>`); `latestRun` is `f.latestRun`
unless its id is the dismissed one, and `locked` is now
`running | queued | cancelling | done`. A FAILED card never locks (§6.3 offers
Retry and Log only, and Retry repeats the frozen request, so the user is free to
edit and run afresh). `RunFooter.tsx`: "Run again" is a `type="button"` calling
the new `onRunAgain` prop, never disabled and never submitting; the `reason`
line under the done card went with the disabled state it explained.

Test: `ToolView.test.tsx` → "locks the form while the run is in flight and while
its card shows, and Run again only unlocks it" (the rewrite of the old "locks
the form while its run is in flight and offers Run again after") plus a new
"leaves the form editable under a FAILED card (§6.3 offers Retry and Log only)".
The rewritten case asserts, in order: fieldsets disabled while running;
fieldsets STILL disabled while the done card shows; Run again does not call
`submitRun`; the fieldsets unlock with the same values; the "Run" button is back
and "Run again" is gone; and the unlocked Run is the ordinary one.

- RED: `expect(element).toBeDisabled() — Received element is not disabled:
<input aria-label="Prefix" value="extent_" />` at the "while the done card
  shows" assertion.
- GREEN `npx vitest run tests/unit/ui/processing`: 7 files, 50 tests.

### Finding 4 — `OUTPUT_COLUMNS` duplicated the executor's names

`src/features/processing/tools/heightFromExtent.ts:45-56`: new
`outputColumnNames(prefix): [string, string, string]`, consumed by
`rollUpExtents` (`:112`, destructured, so `noUncheckedIndexedAccess` stays
happy) and by the executor's column list (`:159-162`).
`src/ui/processing/useToolForm.ts:46-48`: `OUTPUT_COLUMNS["height-from-extent"]`
is `(p) => outputColumnNames(p)`. The three literal lists are one.

Two tests chain the equality end to end:

- `tests/unit/ui/processing/useToolForm.test.tsx` → "promises exactly the names
  the Height from extent executor writes" (`OUTPUT_COLUMNS` ≡ builder, for
  `"extent_"` and for the empty prefix).
- `tests/unit/features/processing/heightFromExtent.test.ts` → "writes the
  columns the form promised, from the ONE builder" (the executor's real
  `ToolResult.columns` names AND the keys of a written row ≡ builder, through
  the file's existing fake `ToolContext`).

- RED both files: `TypeError: outputColumnNames is not a function`. Honest
  caveat: equality-by-coincidence cannot be made to fail, so the RED here is
  "the single source does not exist yet", which is the actual defect.
- GREEN `npx vitest run tests/unit/features/processing tests/unit/ui/processing`:
  13 files, 107 tests.

### Finding 5 — `eligibleTargets` ignored tool eligibility

`src/ui/processing/useEligibilityContext.ts` now holds three things: the pure
`eligibilityContextFor(target, tables, hasVectorLayer, status)`, a
`useEligibilityInputs()` that subscribes to the stores once, and the original
`useEligibilityContext` hook, which is now a two-line wrapper (`CatalogueView`
is untouched).

`src/ui/processing/useToolForm.ts:88-127`: `candidates` keeps the old list
(tables in `ready`), and `eligibleTargets = candidates.filter(l =>
toolEligibility(tool, eligibilityContextFor({kind:"city", layer: l}, …)).ok)`.
The default target falls back through `eligibleTargets → candidates`, so an
UNIMPLEMENTED tool (every layer fails) still opens on a layer rather than on a
blank select. `src/ui/processing/ToolView.tsx:59-67`: the select's option list
is `eligibleTargets` plus the draft target when it is not among them, so §5's
"a disabled row still opens the tool view" keeps a visible value and Run's
reason keeps a subject.

Test: new `tests/unit/ui/processing/useToolForm.test.tsx` →
"offers only the layers the tool can target, not every ready table" and
"keeps an ineligible target the user already chose, and says why".
The only implemented M1 tool cannot fail per layer (no reader, no extension,
city target, and candidates are already `ready`), so the file mocks
`toolRegistry` to flip `measure-solids` to `implemented: true` and seeds two
ready layers that differ only in `reader` / `source`.

- RED (filter): `AssertionError: expected [ 'Delft', 'Rotterdam' ] to deeply
equal [ 'Delft' ]`.
- RED (option list, after the filter landed): the second case went red with the
  select blank, which is what added the `targetOptions` fallback.
- GREEN `npx vitest run tests/unit/ui/processing tests/unit/features/processing`:
  114 tests.

### Finding 6 — positive "Matching" radio test

`tests/unit/ui/processing/ToolView.test.tsx` → "offers Matching with its count
once a filter is applied, and runs on it": applies a real filter through
`useQueryStore.setFilter` + `applyFilter`, asserts the radio reads
"Matching 312" and is enabled, clicks it, and asserts the submitted request
carries `scope: "matching"`. `useQueryStore` is now reset in `afterEach`
(this file is the first to apply a filter).

No RED, and none was faked: this is a coverage pin for behaviour that was
already correct, not a bug fix. GREEN on first run, 55 tests in
`tests/unit/ui/processing`.

### Finding 7 — the duplicate `.processing-back` rule

`src/ui/processing/processing.css`: the two rules are one, at `:196`. `30px`
became `var(--control-height-compact)` for width, height and the `!important`
min-height (the token IS 30px, so the merge is pixel-identical there). The
first rule's `padding: 0 10px` and `font-size: 12px` were already overridden by
the second and are gone; its `margin-bottom: 8px` is dropped deliberately —
inside `.processing-tool__head` (a flex row with `align-items: center`) the
margin box is what gets centred, so it was pushing the chevron 4 px above the
title. No test: a CSS dedupe has no behavioural surface in jsdom.

### Finding 9 — live region and list keys

`src/ui/processing/RunFooter.tsx:59-64`: the phase line is
`<p className="processing-phases" aria-live="polite">`.
**Departure from the brief, deliberate:** the elapsed ticker beside it is NOT a
live region. It updates every 250 ms; inside a polite region it would queue an
announcement four times a second and talk over the phase changes the region
exists to deliver. The reason is a comment above the element.

`src/ui/processing/LogView.tsx:105-109`: warnings are keyed
`${warning}-${i}` (content alone collided when a tool warns the same thing
twice). Both lists carry the comment the brief asked for: they are append-only
records of a FINISHED run, never reordered or filtered, so the index is a stable
part of the key, and the label / text alone is not unique.

Tests: `ToolView.test.tsx` → "announces the running phase in a polite live
region"; `LogView.test.tsx` → "lists a warning the run raised twice, without
colliding keys" (renders both and asserts React logged no `same key` error).

- RED: the live-region case failed on the missing attribute; the key case failed
  with `expected 'Encountered two children with the sam…' not to match
/same key/`.
- GREEN `npx vitest run tests/unit/ui/processing`: 7 files, 49 tests.

### Test summary

`npx vitest run tests/unit/ui/processing tests/unit/features/processing
tests/unit/ui/shell tests/unit/features/selection tests/unit/insights`
→ **35 files, 488 tests, all passing** (116 in the two processing folders after
the last commit). `npx tsc -b --noEmit` clean.
Node 24 via the mise shims for every run.

Full suite (`npx vitest run`, after the last commit `757baab`) →
**231 files passed / 1 skipped, 2,777 tests passed / 20 skipped**, exit 0.

### Concerns

1. **"Edit & run" from Recent runs lands on a LOCKED form.** §5 says it "opens
   the tool view prefilled so parameters can be changed", but if the run it came
   from is the latest DONE run of that tool on that target, the done card is up
   and the fieldsets are disabled until the user presses Run again. The
   controller's ruling makes `dismissedRunId` ToolView-local on purpose, so
   `RecentRuns` cannot clear it. Implemented as ruled; flagging it as the one
   place where the ruling and §5 rub. The one-line fix, if wanted later, is to
   lift the dismissal into `processingStore` (`dismissedRuns: Record<ToolId,
string>`) and have `openTool` from a done run pre-dismiss it.
2. **The dismissal does not survive navigation.** Leaving the tool view and
   coming back re-shows the card and re-locks the form. Accepted by the ruling
   and noted in the code comment; same store-level fix as above if it ever
   annoys.
3. **`useToolForm` now runs `toolEligibility` once per candidate layer per
   render.** It is pure and cheap and the memo's deps are all stable references
   (`getDuckDBStatus()` returns a module-level value), but the memo recomputes
   on any table change, as `candidates` already did.
4. **Finding 5's test mocks the registry to make `measure-solids`
   implemented.** That is the only way to exercise a per-layer eligibility
   failure in M1; when M2 lands the real tool the mock should be deleted and the
   test pointed at it.
5. **The elapsed timer is not announced** (finding 9 above), by choice.
6. **A UI module now pulls a tool module's registration side effect.**
   `useToolForm.ts` imports `tools/heightFromExtent.ts` for `outputColumnNames`
   (the brief's instruction), and that module's `registerExecutor(...)` runs at
   module scope. `tools/index.ts`'s header still claims `./register` is "the one
   place that imports the tool modules for their side effect", which is no
   longer true. Harmless — the assignment is idempotent and `./register` does it
   anyway — but either that comment should be updated or the column builders
   should move to an engine-free sibling (`tools/columns.ts`) that both the
   executor and the form import.
7. **No browser re-verification this round.** Every change is covered by jsdom
   tests and none of them touches Navara, WebGL or the DuckDB engine; the CSS
   change is a byte-identical merge apart from the dropped `margin-bottom`,
   which is worth a glance at the tool view's header in a real browser.

### Addendum — controller rulings on concerns 1 and 4 (2026-09-11)

Two further commits, same rules (staged by path, no trailers, hooks run, nothing
pushed):

- `de65b8b` refactor(processing): the tool definition owns its output column names
- `eb241cf` fix(processing): the dismissed result card lives in the store, so Edit & run opens an unlocked form

#### Ruling 2 (concern 4) — the builder leaves the executor module

`src/features/processing/types.ts:35-46`: `ToolDefinition` gains an optional
`outputColumns?: (prefix, params) => string[]`, documented as the one answer two
places need at different times.
`src/features/processing/toolRegistry.ts:59`: the `height-from-extent`
definition carries it — one line, pure data.
`src/features/processing/tools/heightFromExtent.ts:45-56`: the exported
`outputColumnNames` is gone; a module-private `columnNames(prefix)` reads
`toolById("height-from-extent").outputColumns?.(prefix, {}) ?? []`, used by the
roll-up (`:112`, three `!`s that are `noUncheckedIndexedAccess` on a list this
module defines the shape of) and by the executor's column list (`:160`).
`src/ui/processing/useToolForm.ts`: the `OUTPUT_COLUMNS` map is deleted; the
form's `columns` is `tool.outputColumns?.(draft.prefix, draft.params) ?? []` and
`requestFromRun` reads `toolById(run.toolId).outputColumns?.(...)` with
`run.columns` as the fallback. **`useToolForm` no longer imports any module
under `tools/`**, so concern 4's side-effect edge is gone and
`tools/index.ts`'s "`./register` is the one place" comment is true again.

Total: 15 added lines across `types.ts` + `toolRegistry.ts`, well inside the
~20-line stop condition.

Test: the fix-round equality case moved out of `useToolForm.test.tsx` into
`tests/unit/features/processing/heightFromExtent.test.ts` → "writes exactly the
names the tool DEFINITION promises the form" (the registry builder's names are
asserted literally, then the executor's real `ToolResult.columns` and the keys
of a written row are asserted equal to them). `useToolForm.test.tsx` is now only
the Layer-select file and its header says so.

RED evidence (a refactor of an invariant that was already covered, so the red
was produced deliberately by deleting the new single source): with
`toolRegistry.ts:59` commented out, `npx vitest run
tests/unit/features/processing/heightFromExtent.test.ts` → **6 failed**, all
`TypeError: toolById(...).outputColumns is not a function` — the executor, the
roll-up and the equality case all lose their names together, which is the point
of collapsing them onto one field. GREEN after restoring the line:
`npx vitest run tests/unit/ui/processing tests/unit/features/processing` → 115.

#### Ruling 1 (concern 1) — the dismissal moves to the store

`src/features/processing/processingStore.ts`: new state
`dismissedRunIds: ReadonlyArray<string>` (newest first, capped at the same
`MAX_RUNS` as the history it shadows) and `dismissRun(id)`, which is idempotent
(a repeat dismissal writes nothing, so no needless render). It is in `initial`,
so `resetForTest` clears it.

`src/ui/processing/ToolView.tsx:22-30`: the local `useState` is gone; the view
subscribes to `dismissedRunIds` and hides `latestRun` when its id is in there.
"Run again" calls `dismissRun(latestRun.id)`. The dismissal now survives
navigating away and back — this supersedes fix round 1's "the card may return"
clause and closes concern 2 as well.

`src/ui/processing/RecentRuns.tsx:104-107`: "Edit & run" calls `dismissRun(run.id)`
after writing the draft and before `openToolView`, so the form it opens is
unlocked — concern 1 closed.

Tests, red first:

- `tests/unit/features/processing/processingStore.test.ts` → "remembers a
  dismissed result card, once, and forgets it on reset" (records newest-first,
  a repeat does not duplicate, `resetForTest` empties it).
  RED: `AssertionError: expected undefined to deeply equal []`.
- `tests/unit/ui/processing/ToolView.test.tsx` → the "Run again" case now also
  asserts `useProcessingStore.getState().dismissedRunIds` contains the run id.
  RED: `the given combination of arguments (undefined and string) is invalid`.
- `tests/unit/ui/processing/RecentRuns.test.tsx` → "opens the tool view
  prefilled through Edit & run" now also asserts the run was dismissed.
  RED: same shape.

GREEN `npx vitest run tests/unit/ui/processing tests/unit/features/processing`
→ 116; `npx vitest run tests/unit/ui tests/unit/features/processing
tests/unit/features/selection` → **862 passing**. `npx tsc -b --noEmit` clean.

Full suite after `eb241cf` (`npx vitest run`) → **231 files passed / 1 skipped,
2,777 tests passed / 20 skipped**, exit 0. Working tree clean apart from the two
untracked directories left alone by instruction.

#### Concern list after the addendum

Concerns 1, 2 and 4 of fix round 1 are CLOSED by the two rulings. Still standing:
3 (eligibility runs per candidate layer per render — pure, cheap, stable memo
deps), 5 (the elapsed ticker is deliberately not announced), the
`measure-solids` registry mock in `useToolForm.test.tsx` (delete it when M2
ships the real tool), and no browser re-verification this round. One new, minor:
`dismissedRunIds` is capped at 20 like the history, so a card dismissed more
than 20 dismissals ago could in principle reappear for a run still in the
history — harmless, and pressing Run again dismisses it once more.

---

## Fix round 2 (2026-09-11)

Two commits on `develop`, on top of Task 12's `73eb8d6` (nothing rebased,
nothing pushed, staged by path, no trailers, hooks run):

- `1b97e0f` fix(processing): a dismissal only hides a done card, and Edit & run clears the pair's latest
- `e658bf2` test(processing): a dismissed run's card appears only once the run is done

`npx tsc -b --noEmit` clean. Untracked `.github/hooks/` and `docs/design-history/`
left alone.

### The two defects, and the one mechanism behind both

Fix round 1's addendum put the dismissal in the store keyed by RUN ID, and then
used it in two places that do not agree on which run matters:

- `ToolView` suppressed ANY dismissed run, whatever its status. A dismissal left
  behind by an earlier "Run again" (or written by "Edit & run") therefore
  cancelled §6.1's lock for a run that was queued, running or cancelling: the
  progress block and Cancel run vanished and Run came back while the engine was
  still working. That is the re-review's Important finding.
- `RecentRuns`' "Edit & run" dismissed the run of the ROW CLICKED, but the form
  watches the LATEST run of the (tool, target) pair. Editing an older row left
  the newer done card — and its lock — over the form it had just opened.

Both are the same mistake from two ends: the dismissed id has to name the card
the VIEW would show, and it must not speak for a run that is still in flight.

### The fix

- `src/features/processing/processingStore.ts`: new action
  `dismissDoneRun(toolId, targetLayerId)`. `runs` is newest first, so the first
  match IS the latest run of the pair; it delegates to `dismissRun` only when
  that run's status is `"done"`. A latest run in flight dismisses nothing — §6.1
  locks the form while it runs and no dismissal may take its progress block or
  its Cancel away. `dismissRun(id)` is unchanged (still what "Run again" calls,
  where the run in hand IS the done one).
- `src/ui/processing/ToolView.tsx:22-37`: the suppression is now gated on
  status — `f.latestRun.status === "done" && dismissed.includes(f.latestRun.id)`.
  Queued / running / cancelling always render their own footer and always lock,
  dismissed or not; a failed card still never locks.
- `src/ui/processing/RecentRuns.tsx:104-112`: "Edit & run" writes the draft and
  then calls `dismissDoneRun(run.toolId, run.targetLayerId)` instead of
  `dismissRun(run.id)`.

### Tests (red first, per the ruling's a / b / c)

- (a) `ToolView.test.tsx` → "never lets a dismissal suppress a run that is still
  in flight": seeds a RUNNING run, dismisses its id, and asserts the progressbar
  and "Cancel run" are present, the Prefix field is disabled and no "Run" button
  exists.
  RED: `TestingLibraryElementError: Unable to find an accessible element with
the role "progressbar"` — the dismissal had replaced the whole progress block
  with the idle footer.
- (b) `RecentRuns.test.tsx` → "clears the LATEST done card of the pair, not only
  the row clicked": two done runs for the same tool and target, Edit & run on
  the OLDER row.
  RED: `AssertionError: expected [ 'older' ] to deeply equal [ 'newer' ]`.
- (c) `RecentRuns.test.tsx` → "dismisses nothing when the pair's latest run is
  still in flight".
  RED: `AssertionError: expected [ 'done' ] to deeply equal []`.
- Plus `processingStore.test.ts` → "dismisses the latest DONE run of a pair, and
  never one in flight", which also pins the corner the two view tests do not
  reach: a done run on ANOTHER target is untouched. Honest note: this one is a
  coverage pin written after the helper existed — the behaviour's red is (b) and
  (c) above — not a faked red.

GREEN `npx vitest run tests/unit/ui/processing tests/unit/features/processing`
→ **122 passing**. Full suite after `e658bf2` (`npx vitest run`) →
**231 files passed / 1 skipped, 2,788 tests passed / 20 skipped**, exit 0.

### Concerns

Unchanged from the addendum; nothing new. Still standing: eligibility
recomputed per candidate layer per render (pure, stable memo deps); the elapsed
ticker deliberately outside the live region; the `measure-solids` registry mock
in `useToolForm.test.tsx` (delete it when M2 ships the real tool); no browser
re-verification in any of these rounds; `dismissedRunIds` capped at 20 like the
history. One observation rather than a concern: `dismissRun` is now reached
from "Run again" — which is correct, it renders only on a done card, so the run
in hand IS the done record — and from `dismissDoneRun`. A future third caller
should prefer `dismissDoneRun` unless it likewise holds the done record.

Test (a) was extended after the fix (no red; behaviour already correct) to walk
the status transition: with the id dismissed, the run in flight keeps its
progress block, and once it is patched to `done` the card it would have shown is
suppressed and the form comes back. That is ruling §1 stated as a sequence — the
dismissal waits for the run to finish, then hides the card.
