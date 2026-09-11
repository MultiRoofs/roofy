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
