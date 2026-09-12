# M2 final fix wave — implementer report

Branch `develop`, five commits on top of `4076ec5`, nothing pushed.

| item  | commit                                                                                     |
| ----- | ------------------------------------------------------------------------------------------ |
| I1    | `e027894` fix(processing): the toolbox is a streaming-table consumer, like the grid        |
| I2    | `ad49481` fix(processing): the Undo and the discarded backup race the engine's death       |
| m1    | `4bed84c` fix(processing): focus reveals the extension failure reason on screen            |
| m2    | `552d0cc` docs: the death race covers the whole table FIFO, not only the run queue         |
| smoke | `cccf9a4` docs: the smoke record drops the table-panel prerequisite and records the re-run |

---

## I1 — streaming processing depended on the table panel being open

### What changed

`src/features/layers/layerTableLifecycle.ts`

- `runInFlightFor(layerId)` (`:96-114`): true while a run whose `targetLayerId`
  is this layer is `queued`, `running` or `cancelling`. A `done` run is
  deliberately not a reader — its card describes the table that exists, and a
  rebuild on its behalf only retires it as stale.
- `rebuildWanted(layerId)` (`:116-138`) is now
  `tablePanelOpen || useProcessingStore.getState().open || runInFlightFor(layerId)`.
  Both call sites pass the layer id: the commit gate (`:211`) and the fire-time
  re-check inside the debounce (`:157`).
- `sweepStreamingLayers()` (`:215-236`): the loop that was inline in the
  table-panel subscription, factored out and now shared.
- `unsubscribeProcessing` (`:247-256`): a second subscription on
  `useProcessingStore`, guarded on `state.open !== toolboxWasOpen`, running the
  same sweep the panel's opening runs. Disposed in the returned closure
  (`:265`).
- Import: `../processing/processingStore` (features → features; `processingStore`
  imports only `zustand` and `./types`, so no cycle — verified by `tsc -b` and by
  the whole suite).
- The two now-false comments were rewritten: `refreshStreamingTable`'s docblock
  ("the debounced rebuild only runs while the table panel is open") and the gate's
  own "Only while somebody is LOOKING … An EXPORT does not widen this".

### Covering tests — `tests/unit/features/layers/layerTableLifecycle.test.ts`

New `describe("the processing toolbox as a table consumer")`, eight cases:
rebuild on a commit with only the toolbox open; rebuild AGAIN on a later commit;
the sweep on the toolbox opening (with `clearMapFilter` for the streaming layers
only); a rebuild for a run still in flight with nothing open; NO rebuild for a
`done` run; NO rebuild for a run in flight over another layer; the fire-time gate
abandoning a rebuild when the toolbox closes inside the debounce window; no
double build when the toolbox reopens over an armed timer; and the sweep stopping
on uninstall.

`beforeEach` now calls `useProcessingStore.getState().resetForTest()` — without
it a leaked `open: true` would make every panel-closed case in the file pass for
the wrong reason.

### RED / GREEN

RED (before the source change): `5 failed | 21 passed (26)` — the four cases that
must build plus the reopen case, each `expected [] to deeply equal [ 'S' ]`. The
three "ignores …" cases passed already, which is what they should do both before
and after.

GREEN: `26 passed (26)`. The wider related set (`tests/unit/features/layers`,
`tests/unit/features/processing`, `tests/unit/insights`) went `38 files / 666
passed`.

### Not done, deliberately

The literal test (b) of the ruling wanted the stale card asserted in this file.
It is not asserted here: `installStaleWatcher` lives in `runQueue.ts`, which pulls
the real duckdb graph and `./tools/register`, and `enqueueLayerTable` is mocked in
the lifecycle file so no table ever transitions to `ready`. The lifecycle test
asserts the second build instead, and the building→`ready`→`stale` link is already
covered by `tests/unit/features/processing/runQueue.test.ts`'s
`describe("installStaleWatcher")`. The end-to-end chain was then driven for real
in the browser (below), where the card did turn `stale: layer reloaded` with the
table panel never opened.

---

## I2 — Undo and backup cleanup could strand the FIFO on engine death

### What changed

`src/features/processing/runQueue.ts`

- `discardUndo` (`:418-436`): the queued `DROP TABLE IF EXISTS` is now
  `raced(runQuery(…), null)`. Nothing awaits that drop, but the QUEUE does —
  which is exactly why it has to be raced.
- `undoRun` (`:936-1000`): inside the queued task, `undoComputedColumns` is
  awaited through `raced(…, null)`; an `EngineDeadError` returns `null`, so
  nothing is published — no `mergeAttributes`, no provenance edit, no "Undone" —
  because nothing was committed and there is nothing to roll back against a
  database that is gone. The card is left as the death watcher wrote it (the run
  itself succeeded; the session's Undo goes with `markEngineStopped`).
- The post-commit `refreshLayerTableColumns` is raced too, and its
  `EngineDeadError` is SWALLOWED rather than returned as a failure, mirroring
  `execute`'s own handling (`:816-822`): that Undo DID commit, so the model
  restore below it must still publish.
- A non-`EngineDeadError` still propagates from both, exactly as before.
- Incidental second fix: the real `refreshLayerTableColumns` already went through
  `layerTables`' raced primitives, so a death under the post-commit re-DESCRIBE
  made the OLD queued task REJECT — and every caller is `void undoRun(id)`, so
  that was an unhandled rejection in the UI. The catch closes it.

`src/insights/computedColumns.ts` — **verified, no change needed.**
`undoComputedColumns` already has the death half of the treatment
`writeComputedColumns` got: `cleanup()` (`:138-141`) refuses to send its
`ROLLBACK` unless `getDuckDBStatus().state === "ready"`, and each statement after
a death returns `ok: false` from `runQuery`'s own "not running" answer, so no
further SQL is sent. It takes no `AbortSignal` on purpose — no user cancels an
Undo — which is what the ruling's "no abort signal for these" asks for. The race
therefore belongs at the call site, which is where `writeComputedColumns`' own
race lives (`raced(writing, null)` in `execute`).

### Covering tests — `tests/unit/features/processing/runQueue.test.ts`

New `describe("the death race over the cleanup and the Undo")`, plus a
`fifoAccepts()` helper that puts a probe task on the mocked-but-real FIFO chain
and races it against a 50 ms timer, so a stranded queue fails fast and
unambiguously instead of timing out.

1. "frees the FIFO when the engine dies under a discarded backup's DROP" — two
   runs over the same column, `gate` holding `DROP TABLE IF EXISTS`, `killEngine()`,
   then `fifoAccepts()`.
2. "settles undoRun, publishes nothing and frees the FIFO when the engine dies
   under it" — `gate` holding `DROP COLUMN`, `undoRun` un-awaited, `killEngine()`,
   then `await undoing` must return; asserts the model still holds the run's value,
   the provenance is intact, `note` is null, `status` is still `done`,
   `engineStopped` is true, NO statement was posted after the death, and the FIFO
   accepts the next task.

### RED / GREEN

RED: both new cases failed for their own reason — (1)
`expected false to be true` from `fifoAccepts()` (the queue was occupied), (2)
`Test timed out in 5000ms` at `await undoing` (`undoRun` never settled).

GREEN: `57 passed (57)` in that file.

---

## m1 — the failure reason was not keyboard-visible

### What changed

`src/ui/processing/processing.css`

- `.processing-tool-row-wrap` gains `flex-wrap: wrap`, so the revealed sentence
  can take a line of its own instead of squeezing between the row and Retry.
- `.processing-tool-row-wrap .processing-tool-row` goes from `flex: 1 1 auto` to
  `flex: 1 1 0`. This was a real regression caught in the browser, not a
  refinement: with wrapping on, a row sized from its content no longer shrinks to
  make room for Retry, so the link was pushed onto its own line (measured: row
  `301×68` full width, Retry below it). Basis zero restores them side by side.
- `.processing-tool-row-wrap:focus-within .processing-sr-only` un-clips the
  element — `position: static`, `flex: 1 0 100%`, `order: 1`, `clip-path: none`,
  11 px muted, aligned to the row's 10 px inset. `:focus-within` on the WRAPPER
  rather than a sibling combinator because the two focusable elements sit on
  either side of that span and a sibling combinator only reaches forwards.

`src/ui/processing/CatalogueView.tsx` — comment only, pointing at the new rule.
No markup change: `aria-describedby`, the `title` and the clipped-not-hidden span
are all unchanged.

### Covering test — `tests/unit/ui/processing/extensionChip.test.tsx`

Extended "puts the failure reason where a keyboard can reach it": the element
`aria-describedby` names carries the reason text, is NOT `aria-hidden`, still has
`processing-sr-only`, and lives in the same `.processing-tool-row-wrap` as the
Retry link (which is what makes `:focus-within` reach it from either control).

### RED / GREEN — stated honestly

This assertion cannot go red: jsdom applies no CSS, and the element already
satisfied every DOM-level claim. The RED evidence for m1 is
`grep -n "focus-within\|focus-visible" src/ui/processing/processing.css` →
no match, exit 1. The GREEN evidence is the browser measurement in the re-run
below (1×1 clipped → 316×35 static on focus → 1×1 on blur, with the row and the
link not moving), plus `12 files / 111 passed` in `tests/unit/ui/processing`.

---

## m2 — architecture-notes described a fixed gap as outstanding

`docs/architecture-notes.md`

- The "known gaps" paragraph (was `:291-302`) is replaced by "Everything on the
  table FIFO races the death; what is left is off it". Every claim in it was
  checked against the code first:
  - `layerTables.ts:61-97` wraps the primitives themselves (`runQuery`, `ddl`,
    `registerBuffer`, `dropBuffer`, `initDuckDB` are local `racedWithDeath`
    functions), so a build's `CREATE`, its `DESCRIBE`, its buffer cleanup and
    `refreshLayerTableColumns` are raced for free; builds abandon on
    `EngineDeadError` (`:1214`, `:1270`).
  - The unraced `runQuery` callers were enumerated rather than guessed:
    `insights/export.ts`, `ui/table/ExportDialog.tsx`, `ui/table/useLayerCounts.ts`,
    `ui/table/useLayerQuery.ts`, `ui/drawer/SummaryView.tsx`, `ui/inspector/StatsTab.tsx`,
    `features/query/mapFilterSync.ts`, `ui/processing/RunFooter.tsx`. (The brief's
    text named the export dialog and the layer counts; the paragraph names them
    all, since the list is the point.) `features/processing/scope.ts`' queries are
    NOT in that list — they are covered by `execute`'s own `raced` around
    `resolveScope`.
  - `retryEngine` awaits `bootEngine()` unraced on purpose, with the reason the
    code's own comment gives; `droppedSince` is still its only guard. The stale
    `:348-372` / `:725-` / `:748-749` line references are gone.
- Two more edits in the same commit: the `layerTableLifecycle` clause in the
  "Every city layer gets its OWN DuckDB table" bullet now says "only while a
  CONSUMER of the table is looking", and a new M13.2 paragraph, "The toolbox is a
  streaming-table CONSUMER, exactly like the grid", records I1's decision, the
  browser evidence, and the carried cost (below).

---

## The smoke re-run — 2026-09-12, `develop` @ `552d0cc`

Dev server `npm run dev -- --port 5210 --strictPort --host 127.0.0.1`;
hand-launched Playwright Chromium 151 (`~/.cache/ms-playwright/chromium-1234`)
headless with SwiftShader on CDP 9333; `agent-browser connect 9333`. No
`set viewport`. Both the browser and the dev server were killed at the end (5210
and 9333 confirmed free, no `chrome-linux64/chrome` process left). Screenshot in
the session scratchpad (`…/scratchpad/smoke/m1-focus-reveal.png`).

**Scenario 4 with the table panel NEVER opened — PASS, and it is the proof of
I1.** `delft.fcb` added by URL, one address-search fly to "Delft Campus":
`2.2K loaded objects · 16 resident cells · Settled`, layer row `Streaming · 2,231
currently loaded`. Then straight to Tools with
`document.querySelectorAll('[class*=drawer]').length === 0`:

- `All 1,115 buildings`, `Matching`, `Selected 0`
- `2.2 (1,115 buildings with roof surfaces)` + the 1.3 and 1.2 rungs
- `Runs over the 1,115 currently loaded buildings, not the whole dataset.`
- Run enabled (`disabled: false`, no `aria-disabled`, no title)
- Run → `✓ 1,115 buildings measured · 11.4 s`, `Over the resident set: the
buildings loaded when the run started.`, `Wrote 6 columns to delft.fcb.`
- four Zoom-out clicks → the table rebuilt with the panel still shut and the card
  turned `stale: layer reloaded`, Undo gone, `Style by result` still offered.

Before this change every one of those lines read `0` and Run was disabled.

**m1's reveal — PASS, measured.** Cold boot with `navigator.onLine === false`
(the record's CDP recipe, which worked unchanged), one `two-buildings.city.json`
layer, Tools open: five `failed` chips, five Retry links. The description element:

| state           | rect   | position | clip-path    |
| --------------- | ------ | -------- | ------------ |
| nothing focused | 1×1    | absolute | `inset(50%)` |
| row focused     | 316×35 | static   | `none`       |
| Retry focused   | 316×35 | static   | `none`       |
| blurred again   | 1×1    | absolute | `inset(50%)` |

Text: `The three_d extension could not be downloaded; check the connection and
retry`. Row and Retry do not move (row `269×68` at the same origin, Retry at the
same `x`, before and after); the wrapper grows 68 → 107 px for the extra line. All
seven rows keep their shape (`316×51` without Retry, `269×68` with).

**Two driver findings, both now in the recipe.** The landing page's "Add layer"
button did nothing for `agent-browser find text … click` or `agent-browser click`
(three attempts, two page loads) and worked every time through a DOM `.click()` in
`eval`; the address-search suggestion is the opposite and needs a real click. And
the last run's "stream never plans" session reproduced (n = 2): the first add
showed `0 resident cells · Settled` at the whole-globe camera and stayed silent
through a successful fly; a reload plus a re-add gave `Zoom in to load` and
streamed on the first fly. The record's tell and recovery are confirmed.

---

## Final counts

- `npx tsc -b --noEmit` — clean (exit 0), run before each commit.
- `npx vp check src tests scripts` — **0 errors, 56 warnings** in 526 files, the
  baseline, before each commit.
- A bare `npx vp check` (whole repo) reports formatting issues in 58 files. Every
  one is an UNTRACKED file under `docs/superpowers/handoffs/2026-09-12-processing-toolbox-m2/`
  left by another session; none is mine, and I did not touch them. The pre-commit
  hook (`vp staged`) checks staged files only, so commits were clean; a pre-push
  `vp check` would fail on those files until their owner formats or removes them.
- Full app suite (`npx vp test run`, background, log at
  `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/fullsuite.log`
  — the path the brief named, which was writable): **243 files passed, 2 skipped;
  2994 tests passed, 32 skipped**; exit 0, 64.5 s. Baseline was 2983, and this wave
  adds 11 tests (9 lifecycle, 2 run queue).
- Real-DuckDB probes (`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`):
  **32 passed** — the 32 the default run skips. Worth running here because both
  `writeComputedColumns` and `undoComputedColumns` are exercised against DuckDB
  1.5.5 there.
- No submodule change, so the plugin suite (840) was not re-run.

## Files changed

- `src/features/layers/layerTableLifecycle.ts`
- `src/features/processing/runQueue.ts`
- `src/ui/processing/processing.css`
- `src/ui/processing/CatalogueView.tsx` (comment only)
- `tests/unit/features/layers/layerTableLifecycle.test.ts`
- `tests/unit/features/processing/runQueue.test.ts`
- `tests/unit/ui/processing/extensionChip.test.tsx`
- `docs/architecture-notes.md`
- `scripts/smoke/processing-m2.md`

Nothing in `packages/cityjson-navara-plugins` — no submodule commit needed.
`.github/hooks/`, `docs/design-history/` and `.superpowers/` untouched.

## Concerns

1. **The sweep is unconditional, and that is now reachable from the Tools
   button.** Opening a consumer rebuilds every streaming layer's table whether or
   not the stream's version has moved, and a rebuild retires a finished card as
   `stale: layer reloaded`. That was already true of the table panel (close it and
   reopen it and a done streaming run goes stale); the toolbox inherits it, which
   is worse in one way — the card that goes stale is in the panel the user just
   reopened. I implemented the ruling literally ("mirror" the panel) rather than
   fixing it, because a version-aware sweep changes the existing panel-open test
   the ruling told me to mirror. The follow-up is small and fixes both consumers:
   track the stream version at each enqueued build and skip a layer in the sweep
   whose current version equals it. Recorded in `architecture-notes.md`.
2. **A toolbox-driven rebuild can still retire an in-flight run at the head of the
   queue.** With the toolbox open, a commit now rebuilds the table, and a run
   queued behind that build fails its head-of-queue table check ("the table was
   rebuilt"). That is pre-existing designed behaviour and is the honest outcome —
   the frozen ids name rows that are gone — but the toolbox being in the gate makes
   it reachable more often than before. Nothing to fix in this wave; worth a
   sentence in M13.3 if users report it.
3. **Finding I1 named `src/ui/processing/useToolForm.ts:115` as well** — "Tools
   reads its scope from that table, while its LoD options read current residents".
   The ruling only addressed the table build, so the split source is untouched: the
   LoD counts still come from the live resident model and the scope from the table.
   With the rebuild now happening they agree in practice, but a commit landing
   inside the 500 ms debounce can still show LoD counts one commit ahead of the
   scope count. Not a wave item; flagging it because the finding mentioned it.
4. **m1's unit assertion cannot go RED** (jsdom applies no CSS). Stated in the m1
   section with the grep and the browser measurement standing in for it.
