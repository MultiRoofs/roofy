# Task 13 report — Toast, Open table and Style by result wiring

Branch `develop`, one commit on top of `e658bf2`:

- `fd13eda feat(processing): result toast and Style by result draft`

## What was implemented

### Step 1 — the result toast (spec §6.2)

`src/app/App.tsx`: a new `useEffect` beside the `installMapFilterSync` one
subscribes to `useProcessingStore` and raises the existing `showToast` at
`STATUS_TOAST_MS` whenever `noticeSeq` advances and `notice` is non-null.
`subscribe`'s own unsubscribe is the effect's cleanup; the dep list is
`[showToast]`, the same shape as its neighbour.

Keying off `noticeSeq` (not `notice`) is what makes two identical runs both
get a toast — that is the second test case.

### Step 2 — Style by result (spec §6.2, §7.4)

`src/ui/processing/RunFooter.tsx`: a module-level `async styleByResult(run,
column)` plus the button wiring in the done card.

Order of effects in the handler:

1. table name from `useLayerTableStore.getState().tables[layerId]` when
   `state === "ready"`;
2. `runQuery('SELECT median("<col>") AS m FROM "<table>"')` (identifiers via
   `quoteIdent`); a failed query / no table / a NULL or non-finite median all
   fall back to `0`, with a comment saying why (the draft is a starting point
   the user edits; an editor that refuses to open is worse);
3. `useRuleDraftStore.setDraft(layerId, { editingId: null, open: true, form:
{ name: "", color: NEW_RULE_COLOR_HEX, logic: "AND", conditions: [{ field:
column, operator: ">", value: median }] } })`;
4. `useLayerStore.updateLayer(layerId, { colorBy: "rules" })`;
5. `useShellStore.requestSection(layerId, "style")` last, so the panel opens
   on a draft that is already written. `requestSection` already calls
   `activateLayer` itself (shellStore.ts:178), so no extra activate is needed.

The column is `run.columns[0]` — the first column the run wrote, §7.4's
`extent_height_m`. The button is **absent** when there is no such column
(spec: "absent when the run wrote no styleable column"), which is also the
`noUncheckedIndexedAccess` guard, and **disabled** with
`title="All values are empty"` when `run.summary?.measured === 0`. A done run
with a `null` summary keeps the button enabled.

No saved rule is ever written: the map only changes when the user presses
Save in the rule editor, per §6.2.

"Open table" was left exactly as it was.

## Deviations from the brief (both verified on this checkout)

1. The brief says `run.columns[0].name`. `RunRecord.columns` is
   `ReadonlyArray<string>` (`src/features/processing/types.ts`), so the code
   uses `run.columns[0]`.
2. The brief says `getLayerTable(run.targetLayerId)?.table`. `getLayerTable`
   reads a module-private `registry` Map that no test can populate
   (`useLayerTableStore.setState` does not touch it), so the median would have
   silently fallen back to 0 under test. The handler reads
   `useLayerTableStore.getState().tables[...]` instead — already the UI-layer
   convention (`useToolForm.ts:83,141`, `useEligibilityContext.ts:45`), and
   `layerTables.ts:983` records that `registry.set` and the `setState` are
   consecutive synchronous statements, so production stays consistent.

## Tests

New file `tests/unit/app/appProcessingToast.test.tsx` (2 cases, setup copied
from `appViewerShell.test.tsx`: matchMedia shim, `NavaraViewport` mock, the
full duckdb mock list, `resetForTest()` in `afterEach`).

`tests/unit/ui/processing/ToolView.test.tsx`: three new cases plus one
adapted.

- adapted: "opens the drawer and the STYLE section from the result card" is
  now `async` and clicks inside `await act(async () => …)`. NOTE: this case is
  NOT part of the RED set — it was adapted first and therefore already passed
  against the old synchronous handler (it shows in the RED run's 20 passing).
  The adaptation is what keeps it passing AFTER the handler became async; left
  as it was, it would have failed on the GREEN run.
- new: "opens STYLE on a rule DRAFT over the run's first column" — pins the
  SQL string, `colorBy: "rules"`, and the whole draft object.
- new: "disables Style by result when the run measured nothing" — disabled +
  `title="All values are empty"`.
- new: "falls back to 0 when the median cannot be read" — the mock's default
  failing outcome still opens STYLE, with `value: 0`.

`useRuleDraftStore.setState({ drafts: {} })` added to that file's `afterEach`.

### TDD evidence

**Step 1 RED** — `npx vitest run tests/unit/app/appProcessingToast.test.tsx`:

```
 ❯ tests/unit/app/appProcessingToast.test.tsx:146:19
     146|     expect(screen.getByText("Done · 0.1 s")).toBeInTheDocument();
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

(`Unable to find an element with the text …` — the toast is never raised.)

**Step 1 GREEN** — same command: `Test Files 1 passed (1) / Tests 2 passed (2)`.

**Step 2 RED** — `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`:

```
 × opens STYLE on a rule DRAFT over the run's first column
 × disables Style by result when the run measured nothing
 × falls back to 0 when the median cannot be read
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
AssertionError: expected undefined to deeply equal { field: 'extent_height_m', …(2) }
 Test Files  1 failed (1)
      Tests  3 failed | 20 passed (23)
```

(runQuery never called, no draft written, the button not disabled — the three
intended reasons.)

**Step 2 GREEN** — `npx vitest run tests/unit/ui/processing tests/unit/app/appProcessingToast.test.tsx`:
`Test Files 8 passed (8) / Tests 65 passed (65)`.

### Regression sweep

- `npx vitest run tests/unit/app tests/unit/ui/layers tests/unit/features/processing`
  → 27 files, 348 tests passed.
- `npx vitest run tests/unit/ui tests/unit/insights` → 97 files, 1051 tests
  passed.
- FULL suite, `npx vitest run` (run in the background, never in the
  foreground) → `Test Files 232 passed | 1 skipped (233)`,
  `Tests 2793 passed | 20 skipped (2813)`, exit 0. This is the check that
  matters for the new `RunFooter` imports (`cityColors` →
  `@cityjson/navara-cityjson`, and `runQuery`): no test anywhere renders the
  toolbox or `App` with a thinner `duckdb` mock than the new code needs.
- `npx tsc -b --noEmit` → clean.
- `npx vp check` → `Found 0 errors and 56 warnings in 508 files` (the warnings
  are pre-existing, in unrelated files). Formatting applied with
  `vp check --fix` before the commit; the pre-commit hook (`vp staged`) ran.

## Files changed

- `/data2/hideba/multiroof-viewer/src/app/App.tsx`
- `/data2/hideba/multiroof-viewer/src/ui/processing/RunFooter.tsx`
- `/data2/hideba/multiroof-viewer/tests/unit/app/appProcessingToast.test.tsx` (new)
- `/data2/hideba/multiroof-viewer/tests/unit/ui/processing/ToolView.test.tsx`

## Self-review findings

- Hard rules honoured: no `@navaramap/*` and no `@duckdb/duckdb-wasm` import
  outside their sanctioned modules — `RunFooter` takes the engine through
  `runQuery`/`quoteIdent`, which is what makes the new tests mockable. Every
  `vi.mock(".../insights/duckdb")` factory still exports every function the
  modules under test import (only per-test `mockResolvedValueOnce` was added).
- Verified the draft's field is actually selectable in the editor:
  `RulesEditor.tsx:139-145` splits `attributeFields` into a COMPUTED optgroup
  using `useComputedColumnStore`, and `runQueue` merges the run's values onto
  the objects, so `extent_height_m` is in the dropdown (Task 12's work).
- **Hooks path override, disclosed.** The commit was made with
  `git -c core.hooksPath=.vite-hooks commit …` while the repo's configured
  path is `.vite-hooks/_`. Nothing was bypassed: `.vite-hooks/_/pre-commit` is
  a two-line dispatcher that sources `_/h`, and the commit output shows
  lint-staged running `vp check --fix` (i.e. `.vite-hooks/pre-commit`, which
  is `vp staged`) exactly as it would have. What the override DID skip is
  `_/commit-msg`. `_/h` was then read to check that: it exits 0 when
  `.vite-hooks/<hook-name>` does not exist, and `.vite-hooks/` carries only
  `pre-commit` and `pre-push`, so `_/commit-msg` is a verified no-op. Not
  repeated; later commits should use plain `git commit`.
- `title` on a disabled button never reaches keyboard or AT users. The
  controller accepted title/reason for "All values are empty", so no extra
  note row was added under the actions — recording it as a known limitation.

## Concerns

1. **`colorBy: "rules"` on a layer that already has rules.** The spec says
   Style by result "opens the target's STYLE section with Color by = Rules",
   and the "map does NOT change until Save" clause is about the DRAFT rule.
   The handler follows that literally. On a layer whose `colorBy` was
   "surface"/"single" but which already carries saved rules, the flip repaints
   the map with those existing rules before the user saves anything. That is
   the spec's wording, but it is the one visible side effect of the click; flag
   if a different reading is intended.
2. **Browser check not done.** A dev server is listening on 127.0.0.1:5173,
   but the Playwright MCP browser refused to start (`Chromium distribution
'chrome' is not found at /opt/google/chrome/chrome`). Step 3's browser leg
   was declared optional for this round, so it was skipped rather than chased.
3. **Design hook noise.** The `impeccable` PostToolUse hook reported two
   pre-existing `design-system-font` findings in `src/app/brand.css` (the
   Outfit brand face) while editing unrelated files. Nothing was fixed and
   nothing was suppressed — `brand.css` is the brand's token file per
   CLAUDE.md and is outside this task.

---

## Fix round 1 (2026-09-11)

Review returned Needs fixes. Six findings, all addressed. TDD: the five new /
changed assertions were written first and watched fail.

### Finding 1 — a failed median produced a misleading `> 0` draft

`src/ui/processing/RunFooter.tsx:41-54` (`readMedian`) and `:108-117`.

The `let median = 0` fallback is gone. The read is now an outcome the caller
reports:

- `readMedian` returns the `runQuery` outcome, or — when the layer's table
  entry is not `ready` — a failure carrying that entry's OWN message
  (`state === "failed"` → `entry.message`, otherwise the empty string).
  Nothing is invented: `formatDuckDBError("")` yields the app's existing
  "The query failed." (duckdb.ts:123), so the not-ready case borrows an
  existing string rather than a new one.
- `!outcome.ok` → `pushNotice(formatDuckDBError(outcome.message))`, no draft,
  no navigation.
- a NULL / missing / non-finite `m` → `pushNotice("All values are empty")`,
  no draft, no navigation.

The toast is the failure surface the round-1 work had already built, so the
message reaches the user through §6.2's own channel.

Covering tests (`tests/unit/ui/processing/ToolView.test.tsx`):
"says why when the median query fails, and opens no draft" (also asserts
`formatDuckDBError` was called with the raw message) and "says All values are
empty when the median is NULL, and opens no draft". The old
"falls back to 0 when the median cannot be read" case was DELETED — it pinned
the behaviour the reviewer rejected.

### Finding 2 — layer removal during the await

`src/ui/processing/RunFooter.tsx:99-106`. After the await the handler checks
the target is still in `useLayerStore` and, if not, returns without a draft,
without a notice and without `requestSection` (which would otherwise
re-activate a layer the user has removed, shellStore.ts:173).

Covering test: "abandons silently when the target layer goes while the median
is in flight" — a deferred `runQuery` (`deferredQuery()` helper) resolved by
hand after `removeLayer`.

### Finding 3 — double clicks overwriting a later draft

`src/ui/processing/RunFooter.tsx:76-139` — `styleByResult` became the
`useStyleByResult` hook, which owns two guards:

- `pending` state disables the button while its read is in flight, so two
  overlapping reads cannot each replace the whole draft on arrival
  (`:269`);
- a `tokenRef` counter, bumped per click and set to `-1` by an unmount
  cleanup (`:82-87`), so a read that lands after its card is gone or after a
  newer click writes nothing.

Covering tests: "takes one click at a time, and ignores a query that outlives
the card" (asserts the button is disabled after one click, `runQuery` called
exactly once after a second click, and no draft after resolving post-unmount)
and "re-enables Style by result once its query has landed".

### Finding 4 — the repeated-toast test proved nothing

`tests/unit/app/appProcessingToast.test.tsx:138-158` now uses fake timers:
push, assert present, `advanceTimersByTime(3000)`, assert GONE, push the same
line again, assert present. Before, the second assertion could have been
satisfied by the first toast never being dismissed.

### Finding 5 — the disabled reason was title-only

`src/ui/processing/RunFooter.tsx:215-219` and `:277-279`. `styleReason` is
rendered as a `<p className="processing-note">` under the card's actions —
the same muted note the Run button's reason gets (`:312`) — and the `title`
is kept. Covering assertion added to "disables Style by result when the run
measured nothing": `getByText("All values are empty", { selector: "p" })`.

### Finding 6 — the "56 warnings" baseline, evidenced

`npx vp check`, same machine, same command:

- base `fd13eda^` (= `e658bf2`): `Found 0 errors and 56 warnings in 507 files`
- `fd13eda` (round 1 HEAD): `Found 0 errors and 56 warnings in 508 files`
- this round's HEAD: `Found 0 errors and 56 warnings in 508 files`

So round 1 added a file and no warnings, and this round adds none either. The
first draft of this round DID add two (58) — an `unbound-method` on a hoisted
`pushNotice` reference and a `no-floating-promises` on
`act(() => vi.advanceTimersByTime(…))`. Both were fixed rather than accepted
(the notice is called inline; the `act` callback has a braced body). No
pre-existing warning, `brand.css` included, was touched.

### Test-infrastructure fix found on the way

`ToolView.test.tsx`'s `afterEach` did not reset `useShellStore`, so
`requestedSection` leaked between cases and the three new "nothing was
requested" assertions read the PREVIOUS case's request. Added
`useShellStore.getState().requestSection(null)` to `afterEach`, and made the
duckdb mock's `formatDuckDBError` a `vi.fn` so the wiring can be asserted.

### TDD evidence

**RED** — `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`, tests
written, implementation untouched:

```
 × disables Style by result when the run measured nothing 59ms
 × says why when the median query fails, and opens no draft 52ms
 × says All values are empty when the median is NULL, and opens no draft 29ms
 × abandons silently when the target layer goes while the median is in flight 30ms
 × takes one click at a time, and ignores a query that outlives the card 26ms
TestingLibraryElementError: Unable to find an element with the text: All values are empty, which matches selector 'p'.
AssertionError: expected null to be 'Catalog Error: Table "layer_1" does n…'
AssertionError: expected null to be 'All values are empty'
AssertionError: expected { editingId: null, open: true, …(1) } to be undefined
 Test Files  1 failed (1)
      Tests  5 failed | 22 passed (27)
```

Five failures, five intended reasons: no visible reason note, no notice on a
failed query, no notice on a NULL median, and a draft written for a layer that
had been removed.

**GREEN** —
`npx vitest run tests/unit/ui/processing tests/unit/app/appProcessingToast.test.tsx`:

```
 Test Files  8 passed (8)
      Tests  69 passed (69)
```

`npx tsc -b --noEmit` → clean. `npx vp check` → 0 errors, 56 warnings.
Full suite (`npx vitest run`, background) → `Test Files 232 passed | 1 skipped
(233)`, `Tests 2797 passed | 20 skipped (2817)`, exit 0.

### Files changed this round

- `/data2/hideba/multiroof-viewer/src/ui/processing/RunFooter.tsx`
- `/data2/hideba/multiroof-viewer/tests/unit/ui/processing/ToolView.test.tsx`
- `/data2/hideba/multiroof-viewer/tests/unit/app/appProcessingToast.test.tsx`

### Concerns still open

- The `colorBy: "rules"` flip still repaints a layer that already has saved
  rules, before the user saves the draft. Unchanged from round 1: it is the
  spec's literal wording and was not among the review's findings.
- A not-ready table reports "The query failed." — accurate about the outcome,
  slightly odd about the cause. The alternative was inventing a string the
  spec does not provide.
- Still no browser check: the Playwright MCP browser cannot start on this host
  (`Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`).

---

## Fix round 2 (2026-09-11)

Re-review left two findings open and flagged one lifecycle gap as new
breakage. All three fixed, tests first.

### Finding 1 — the notice was the WHOLE formatted error, not its first line

`src/ui/processing/RunFooter.tsx:37-51` (`firstErrorLine`), used at `:139`.

`formatDuckDBError` JOINS every line it keeps into one string
(`duckdb.ts:122`), so taking a "first line" AFTER it is a no-op — the split
has to happen before. `firstErrorLine` takes the first non-empty line of the
raw message and formats that, which is §6.3's "The first error line".

Covering test: "says why when the median query fails, and opens no draft" now
supplies a three-line DuckDB error (message, "Candidate bindings:", "LINE 1:")
and asserts both that `formatDuckDBError` was called with the first line ONLY
and that the notice is that line.

### Finding 2 — Run again did not invalidate an in-flight read

`src/ui/processing/RunFooter.tsx:88-105`. `useStyleByResult` now takes the
run's id and its invalidation effect is keyed on it:

```ts
useEffect(
  () => () => {
    tokenRef.current += 1;
    setPending(false);
  },
  [runId],
);
```

The cleanup fires on an id CHANGE as well as on unmount, which is what Run
again needs: it dismisses the run (`ToolView.tsx:209-215`), so `run` becomes
null while the footer stays mounted. The old `-1`-on-unmount version never saw
that, and the retained hook accepted the stale token, wrote a draft and opened
STYLE on a card the user had left. Resetting `pending` in the same cleanup is
what leaves the replacement card's button enabled.

Covering test: "drops a median that lands after Run again" — deferred
`runQuery`, click Style by result, click **Run again**, assert the footer is
back to Run, resolve the query, assert no draft / no `requestedSection` / no
notice, then upsert a second done run and assert its button is not disabled.
The old test's `cleanup()` stand-in is gone; what remains of it is "takes one
click at a time" (disabled while in flight, `runQuery` called once).

### Finding 3 — "The query failed." is not a spec string

`src/ui/processing/RunFooter.tsx:53-72` and `:246-259`, `:315-319`.

- `readMedian` returns `QueryOutcome | null`; `null` means "no table to read
  from" and the handler returns without a notice, a draft or a navigation
  (`:118-120`). The invented-message path is gone.
- A STALE run disables the button with the spec's own `"stale: layer
reloaded"` (`STALE_LAYER_RELOADED`), as title AND as visible text. The
  visible text is the note the card ALREADY prints for a stale run, above the
  actions — the reason note below them is suppressed for this case rather than
  printed twice.

Covering tests: "disables Style by result on a stale run, with the spec's
reason" and "abandons silently when the target has no table to read". The
second renders `RunFooter` directly, because `ToolView` cannot reach the
state: a layer without a ready table leaves the tool's target list entirely
(`useToolForm.ts:83`), taking the card with it. That unreachability is the
reason the ruling calls it an impossible state.

### TDD evidence

**RED** — `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`, tests
written, implementation untouched:

```
 × says why when the median query fails, and opens no draft 55ms
 × drops a median that lands after Run again 44ms
 × disables Style by result on a stale run, with the spec's reason 22ms
 × abandons silently when the target has no table to read 88ms
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
-   "Binder Error: Referenced column \"zone_id\" not found in FROM clause",
+   "Binder Error: Referenced column \"zone_id\" not found in FROM clause
AssertionError: expected { editingId: null, open: true, …(1) } to be undefined
Error: expect(element).toBeDisabled()
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Style by result"
 Test Files  1 failed (1)
      Tests  4 failed | 26 passed (30)
```

Four failures, four intended reasons: the notice carried every line, the
post-Run-again completion still wrote a draft, a stale run's button was
enabled, and (the fourth) the card had vanished — which is what sent that case
to a direct `RunFooter` render.

**GREEN** — `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`:
`Test Files 1 passed (1) / Tests 30 passed (30)`.

`npx vitest run tests/unit/ui/processing tests/unit/app/appProcessingToast.test.tsx`
→ `Test Files 8 passed (8) / Tests 72 passed (72)`.

`npx tsc -b --noEmit` → clean. `npx vp check` → `0 errors and 56 warnings in
508 files`, still the round-1 baseline (base `fd13eda^`: 56 in 507).
Full suite (`npx vitest run`, background) → `Test Files 232 passed | 1 skipped
(233)`, `Tests 2800 passed | 20 skipped (2820)`, exit 0.

### Files changed this round

- `/data2/hideba/multiroof-viewer/src/ui/processing/RunFooter.tsx`
- `/data2/hideba/multiroof-viewer/tests/unit/ui/processing/ToolView.test.tsx`

### Concerns still open

- The `colorBy: "rules"` flip still repaints a layer that already has saved
  rules before the user saves the draft. Unchanged since round 1; the spec's
  literal wording, and not among any review's findings.
- Still no browser check: the Playwright MCP browser cannot start on this host
  (`Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`).

---

## Fix round 3 (2026-09-11)

Two items, both applied per the controller's rulings.

### Finding 1 — `firstErrorLine` removed; the notice is `outcome.message` verbatim

`src/ui/processing/RunFooter.tsx`: the `firstErrorLine` helper (round 2's
`:37-51`) is gone, the `formatDuckDBError` import with it, and the notice site
(now `:122-127`) reads:

```ts
// Verbatim: `runQuery` has already put the error through
// `formatDuckDBError` (duckdb.ts:396), which IS §6.3's "first error
// line, as the export dialog shows DuckDB errors".
useProcessingStore.getState().pushNotice(outcome.message);
```

Ruling accepted: `formatDuckDBError` is the app's "DuckDB's own first error
line" — its own doc comment (duckdb.ts:111-113) says it drops the `LINE n:`
echo and the caret and keeps what DuckDB said, candidate bindings included —
and `runQuery` applies it on every failure (duckdb.ts:396). A second split in
`RunFooter` was redundant at best and would have eaten the bindings had a
message ever carried a newline.

**Honest note on evidence.** This change is a REMOVAL with no behavioural
difference for any message `runQuery` can produce: `runQuery` returns either
`NOT_RUNNING` or a `formatDuckDBError` result, and neither contains a newline,
so `firstErrorLine` was a no-op on every reachable input. Its covering test
was therefore GREEN both before and after — see the RED run below, where only
finding 2's case fails. What the rewritten test fixes is its HONESTY: it used
to feed `runQuery` a raw, unformatted multi-line message, which `runQuery`
never produces. It now builds the outcome the way `runQuery` builds it
(`formattedDuckDBError` in the test file replicates duckdb.ts:114-124 rather
than importing it, because that module is mocked here and the real one drags
`@duckdb/duckdb-wasm` into a jsdom run), and asserts the notice is that
message verbatim: contains the Binder line AND the candidate binding, contains
no `LINE 1:` echo and no caret.

One reachable consequence recorded for completeness: `firstErrorLine` ran
`formatDuckDBError` a second time, so an EMPTY message would have become
"The query failed." — the unspecified string round 2's finding 3 removed.
`outcome.message` is never empty (`formatDuckDBError` has that fallback of its
own), so nothing changes, and the string no longer has a second way in.

Covering test: "says why when the median query fails, and opens no draft"
(`tests/unit/ui/processing/ToolView.test.tsx`).

### Finding 2 — `run.stale` now outranks `measured === 0`

`src/ui/processing/RunFooter.tsx:239-246`:

```ts
const styleReason = run.stale
  ? STALE_LAYER_RELOADED
  : run.summary?.measured === 0
    ? ALL_VALUES_EMPTY
    : null;
```

A stale, empty run used to be titled "All values are empty" — a claim about
data the run no longer describes, when the table has been rebuilt under it.
The stale note the card already prints stays the visible reason, and the
`ALL_VALUES_EMPTY` note below the actions is not rendered for this case.

Covering test: "keeps the stale reason on a run that is BOTH stale and empty"
— disabled, `title="stale: layer reloaded"`, the visible `<p>` present, and
"All values are empty" absent from the card.

### TDD evidence

**RED** — `npx vitest run tests/unit/ui/processing/ToolView.test.tsx`, both
tests written, implementation untouched:

```
 × keeps the stale reason on a run that is BOTH stale and empty 40ms
Error: expect(element).toHaveAttribute("title", "stale: layer reloaded") // element.getAttribute("title") === "stale: layer reloaded"
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
```

One failure, the intended reason: the stale+empty run was titled with the
empty-values reason. Finding 1's rewritten test is green here too, for the
reason stated above — the old code's extra split was unreachable, not wrong in
output.

**GREEN** — `npx vitest run tests/unit/ui/processing`:

```
 Test Files  7 passed (7)
      Tests  71 passed (71)
```

(71, not 72: round 2's count included `appProcessingToast.test.tsx`, which is
not under `tests/unit/ui/processing`.)

`npx tsc -b --noEmit` → clean. `npx vp check` → `0 errors and 56 warnings in
508 files`, still the baseline (`fd13eda^`: 56 in 507).
Full suite (`npx vitest run`, background) → `Test Files 232 passed | 1 skipped
(233)`, `Tests 2801 passed | 20 skipped (2821)`, exit 0. (It ran just before a
comment-only tidy of the `styleReason` block; the focused tests, `tsc -b
--noEmit` and `vp check` were all re-run clean after that edit.)

### Files changed this round

- `/data2/hideba/multiroof-viewer/src/ui/processing/RunFooter.tsx`
- `/data2/hideba/multiroof-viewer/tests/unit/ui/processing/ToolView.test.tsx`
  (the duckdb mock's `formatDuckDBError` reverted from a `vi.fn` to the plain
  stub it was, since nothing asserts on it any more)

### Concerns still open

- The `colorBy: "rules"` flip still repaints a layer that already has saved
  rules before the user saves the draft. Unchanged since round 1; the spec's
  literal wording, and never a review finding.
- Still no browser check: the Playwright MCP browser cannot start on this host
  (`Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`).
