# Task 10 report — Validate solids

Commits (on `develop`, **not pushed**, no trailers of any kind):

- `d9dfee2` `refactor: the D4 solid test names the two columns it reads, not one tool's row type`
- `bb1178c` `feat: Validate solids reports closed, manifold, oriented and the counts behind them`
  (the executor, the registry flip, `useLodOptions`, the PARAMETERS note and every test — ONE commit,
  as requirement 5 requires.)

## Implemented

**`d9dfee2`** — `src/features/processing/solidRollUp.ts`: `isMeasurableSolid`'s parameter widened from
`SolidRow` to a new exported structural `SolidClassification` (`{ geometry_type: string | null; parsed: boolean }`).
`SolidRow` satisfies it, so Measure solids is unchanged; Validate solids' own row type satisfies it too. D4's rule
is ONE test over ONE shape rather than one copy per tool's row type. Doc comment extended with §7.3's
"Outcomes per object follow §7.2".

**`bb1178c`**

- **`src/features/processing/tools/validateSolids.ts`** (new): the executor, `VALIDATE_BATCH_FEATURES = 500`,
  `registerExecutor("validate-solids", validateSolids)`. Private `ReportRow` (the READER's column names),
  `ValidationRollUp`, `toReportRow`, `rollUpReports`, `valuesOf`. THREE statements, Measure solids' shape:
  the layer table's scoped rows → `buildSourceIdsSql` through `readerQuery` ("Checking source ids") +
  `assertSourceIds` over EVERY scoped row → `buildSolidValidationSql` over the contributors ("Validating solids")
  - the second `assertSourceIds` over the contributors. `ctx.phase("compute")` once the handle is open;
    `handle.release()` after the parse AND in a `finally`.
- **`src/features/processing/tools/register.ts`**: `import "./validateSolids";` appended.
- **`src/features/processing/toolRegistry.ts`**: `outputColumns: (prefix) => validationColumns(prefix)`,
  `implemented: true`, `validationColumns` added to the `./solidParams` import. No `validateParams` /
  `normaliseParams` (a comment says why). `styleByResult` untouched — Task 9's descriptor already stood.
- **`src/ui/processing/useLodOptions.ts`**: the solids branch is now
  `tool.id === "measure-solids" || tool.id === "validate-solids"`, with the comment the brief asks for.
- **`src/ui/processing/ToolView.tsx`**: a third PARAMETERS fieldset, dispatched on `toolId === "validate-solids"`,
  holding one `<p className="processing-note">` with the accepted [adapted copy A6] string
  `Validity is always written as <prefix>valid.` (literal `<prefix>`, escaped as `&lt;prefix&gt;`). No
  `paramsError` block: §7.3 has nothing to validate.

## Tested + results

New:

- **`tests/unit/features/processing/validateSolids.test.ts`** (27 cases, stubbed `ToolContext`): the seven columns
  in §7.3's order plus the phase and the three statement labels; the user's prefix; flags AND / counts SUM over
  the contributors with the root carrying the feature roll-up and each part its own; three-valued AND in BOTH row
  orders; a withheld (NULL) flag counted as "with issues"; §7.3's "NULL in every column" outcome with both skip
  causes; both halves of the D4 detector (a PARSED `CompositeSurface` and an unparsed `Solid`); `CompositeSolid`
  counted as a solid; the card line and its empty half; `1,079 valid` grouping; the real statement asserted
  (`ST_3DValidationReport`, `CASE WHEN s IS NOT NULL THEN r.is_closed END`, no `ST_3DVolume`, no `r.code`/
  `r.message`); contributor-only parsing beside the no-`WHERE` identity statement; the FIVE id cases of
  requirement 1 (partial answer; missing ROOT under "all" and under a frozen list; missing NON-CONTRIBUTOR under
  both); the report dropping a contributor the id check saw; the reader-failure sentence with the engine's words
  in the log; a Binder error rethrown as itself; the release on a cancel; an empty scope issuing no reader
  statement; the no-LoD refusal; NULL-not-0 for an unanswered count and a genuine zero kept.
- **`tests/unit/features/processing/validateSolidsRun.test.ts`** (4 cases, REAL executor + REAL queue +
  REAL `readSource`, `measureSolidsRun.test.ts`'s scaffolding): the source registered and dropped, the seven
  values on the model, `summary.line` matching `^2 valid · ` and containing no "measured", and §6.4's log reading
  `Reading features · Checking source ids · Validating solids · Writing results`; §7.3's two-count card end to end
  (`1 valid · 1 with issues · …`); the cancel; the engine death.

Extended:

- `tests/unit/ui/processing/solidsEnabled.test.tsx` (+5, against the REAL registry): the shared LoD answer and
  §7.3's seven promised columns; the one-note PARAMETERS section with no checkbox and Run enabled; the frozen
  request (`params: {}`, `lod: "2.2"`, the seven typed columns); the streaming target that gets NO LoD control and
  no geometry verdict (the `eligibility.ok` gate, requirement 5); §6's empty state and Run's reason.
  File header rewritten — the suite is now both solids tools.
- `tests/unit/features/processing/runQueue.test.ts` (+1): §7.3's card verbatim through `summarise` —
  `"1,079 valid · 125 with issues · 2.4 s"`.
- `tests/unit/features/processing/register.test.ts`: the EXECUTORS pin gains `"validate-solids"`.
- `tests/unit/ui/processing/CatalogueView.test.tsx`: one comment corrected (no assertion changed).

Results (Node 24 shims):

- `npx vitest run tests/unit/features/processing/validateSolids.test.ts` → **27 passed**.
- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` → 33 files, **447 passed**.
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts` → **19 passed** (Task 6's
  real-engine pins of `buildSolidValidationSql` still hold; no new integration case — the statement this task
  issues is Task 6's, character for character, and is already pinned there).
- FULL app suite once, background to a file: `Test Files 254 passed | 4 skipped (258)`,
  `Tests 3179 passed | 71 skipped (3250)`, `suite: 0` (`/tmp/m3-task10-suite.log`).
  **Baseline measured on this same checkout** (the two new files moved aside and every modification stashed):
  `252 passed | 4 skipped (256)` / `3142 passed | 71 skipped (3213)` (`/tmp/m3-task10-baseline.log`).
  Delta **+2 files, +37 tests** — exactly 27 + 4 + 5 + 1. (Task 8's report quoted 251/3131; that measurement
  predates `ac744af`…`6a8275a`, hence the separate baseline run.)
- `npx tsc -b --noEmit` → clean at `bb1178c`. It was NOT run on `d9dfee2`'s tree in isolation: the `tsc` run made
  right after that widening reported errors only in the not-yet-created `validateSolids` module's two test
  importers (`TS2307`), and the widening's only change is one parameter whose sole caller passes a `SolidRow`.
  `npx vp check` → **0 errors / 56 warnings** (baseline held, verified after both commits).

## TDD evidence

RED — before any source existed, with the three new/extended suites:

```
$ npx vitest run tests/unit/features/processing/{validateSolids,validateSolidsRun,register,runQueue}.test.ts \
    tests/unit/ui/processing/solidsEnabled.test.tsx
 ❯ tests/unit/features/processing/validateSolids.test.ts (0 test)
 ❯ tests/unit/features/processing/validateSolidsRun.test.ts (0 test)
 ❯ tests/unit/features/processing/register.test.ts (1 test | 1 failed)
 ❯ tests/unit/ui/processing/solidsEnabled.test.tsx (15 tests | 5 failed)
Error: Failed to resolve import ".../tools/validateSolids" from "…/validateSolids.test.ts". Does the file exist?
AssertionError: expected [ 'height-from-extent', …(2) ] to deeply equal [ 'height-from-extent', …(3) ]
TestingLibraryElementError: Unable to find an accessible element with the role "combobox" and name "LoD"
 Test Files  4 failed | 1 passed (5)   Tests  6 failed | 75 passed (81)
```

The rendered DOM in the view failures ends in `<p class="processing-note">Not available yet</p>` — the exact
state the flip removes.

GREEN — after the executor, the wiring, the flip and the PARAMETERS note:
`npx vitest run tests/unit/features/processing tests/unit/ui/processing` → 33 files, 445 passed (447 after the two
extra roll-up cases below).

MUTATIONS (each applied, run, reverted):

1. Requirement 1's scope-wide identity check removed (`assertSourceIds(rows.map(…), …)` → `void present;`):
   `Tests 5 failed | 20 passed (25)` — the partial answer, both missing-ROOT cases and both
   missing-NON-CONTRIBUTOR cases.
2. The executor's `finally { await handle.release(); }` emptied, both suites:
   ```
        × fails with §6.1's id sentence on a PARTIAL answer from the source
        × fails when the REPORT drops a contributor the id check saw
        × gives a reader failure §6.1's own sentence, engine words to the log
        × releases the bytes when the run is cancelled mid-way
        × releases the source and publishes NOTHING when cancelled mid-read
        × releases the source and publishes NOTHING when the engine dies mid-read
        Tests  6 failed | 23 passed (29)
   ```
3. D4's type half dropped (`filter(isMeasurableSolid)` → `filter((r) => r.parsed)`):
   `× skips a row that PARSED but is not a solid in the CityJSON model`, `1 failed | 24 passed (25)`.
4. The per-count NULL rule dropped (`sum` starting at `0` and accumulating `?? 0`):
   `× gives NULL, not 0, for a count NO contributor supplied`, `1 failed | 26 passed (27)`.
   That case and its companion (`keeps a genuine zero a zero`) were WRITTEN AFTER the first GREEN, because the
   first pass had no case that separated "no contributor answered" from "every contributor answered 0" —
   requirement 3's per-measure NULL rule was untested until then.

The `runQueue.test.ts` summarise case was **green on first run**: Task 7's `summarise` edit already renders
`line` and the caveats, and no case combined the two. It is a pin of §7.3's exact card, not a red-first case,
and it is reported as such rather than dressed up.

## Files changed

- `src/features/processing/solidRollUp.ts` (`d9dfee2`)
- `src/features/processing/tools/validateSolids.ts` (new), `src/features/processing/tools/register.ts`,
  `src/features/processing/toolRegistry.ts`, `src/ui/processing/useLodOptions.ts`, `src/ui/processing/ToolView.tsx`
- `tests/unit/features/processing/validateSolids.test.ts` (new),
  `tests/unit/features/processing/validateSolidsRun.test.ts` (new)
- `tests/unit/features/processing/{register,runQueue}.test.ts`,
  `tests/unit/ui/processing/{solidsEnabled,CatalogueView}.test.tsx`

## How each controller requirement was met

1. **Scope-wide source identity (residual A1).** `requested` is `rows.map(r => r.id)` — the ids this run's OWN
   `buildScopeRowsSql` read returned, every scoped row, roots and non-contributors included. `ctx.featureIds` is
   used ONLY as the two statements' scope filter, never as `requested`. `returned` is the id set of the dedicated,
   id-only `buildSourceIdsSql` statement issued through `readerQuery` BEFORE the expensive parse. Five tests: a
   missing ROOT and a missing NON-CONTRIBUTING part, each under scope "all" and under a frozen `featureIds`, plus
   the partial-answer case; plus a pin that the identity statement carries NO `WHERE` under "all" (the evidence
   that `ctx.featureIds` was not smuggled in as `requested`). The contributor-level `assertSourceIds` after the
   report is kept as the second, cheap threshold, with its own case. Mutation 1 shows all five are load-bearing.
2. **D1.** Every report field arrives through Task 6's `buildSolidValidationSql`, unchanged — not one character of
   it moved, and the statement is asserted in the executor's own suite
   (`CASE WHEN s IS NOT NULL THEN r.is_closed END`, `ST_3DTryFromWKB`, no `ST_3DVolume`, no `r.code`, no
   `r.message`). Validity is READ (`is_valid`), never re-derived from `parsed` or from the other three flags; a
   comment in `toReportRow` says so. `parsed` is used only as half of D4's solid test.
3. **§7.3's outcomes.** "Not a solid" is `isMeasurableSolid` — the CityJSON `geometry_type` in D4's
   `SOLID_GEOMETRY_TYPES` **and** the parse — applied INSIDE `rollUpReports`, so the feature roll-up and each
   part's own one-row roll-up are both correct by construction. No geometry (§7's rule found no contributor) and
   not a solid (contributors, none of them solids) both give `null` → NULL in all seven columns and a skip.
   A parsed solid always gets all four flags and all three counts. Roll-up: flags a three-valued AND decided
   after the loop (order-independent, asserted in both orders), counts SUM over the contributors that answered and
   NULL when none did. Root row = the feature roll-up; every other row = its own.
4. **The card.** `line` is `` `${valid.toLocaleString("en-US")} valid` `` and the ONE caveat is
   `{ cause: "with issues", count }`; `measured` is `valid + withIssues`, which is what the provenance summary and
   §6.2's object count read. Pinned three ways: on the result (`"2 valid"` + one caveat, and `"1,079 valid"` for
   the grouping), through `summarise` (`"1,079 valid · 125 with issues · 2.4 s"`), and end to end through the real
   queue (`^1 valid · 1 with issues · `, with `not.toContain("measured")`).
5. **The flip.** `implemented: true`, `outputColumns` and the `useLodOptions` extension are in ONE commit with the
   PARAMETERS note and every test. The note is the accepted [adapted copy A6] string with the literal `<prefix>`
   placeholder; the section has no checkbox and Run is enabled (asserted). The LoD field inherits Task 8's
   `f.eligibility.ok` gate — `ToolView.tsx` was not touched there — and the streaming case in
   `solidsEnabled.test.tsx` asserts it for this tool. **No test pinned `validate-solids` as unimplemented**:
   `grep -rn "validate-solids\|Validate solids" tests/ src/` before starting found only Task 9's
   `styleByResult.test.tsx` / `RulesEditor.test.tsx` cases (which build their own run records and never read
   `implemented`) and comments; `grep -rn "Not available yet" tests/` found `eligibility.test.ts` (already on an
   explicitly unimplemented `{ ...toolById("measure-solids"), implemented: false }` after Task 8),
   `runQueue.test.ts`'s no-executor path, `CatalogueView.test.tsx`'s
   `getAllByText(…).length > 0` (still true — three spatial tools remain) and `extensionChip.test.tsx`'s comment
   about the SPATIAL tools. Only `CatalogueView`'s comment needed correcting. The full suite confirms it.
6. **Phase and release.** `ctx.phase("compute")` is called as soon as `readSource` returns the handle — Task 7's
   accepted reading, asserted as `phases === ["compute"]`. `handle.release()` runs after the parse and in a
   `finally` on every exit path; six cases cover it (success, the two id failures, the reader failure, an explicit
   cancel, and — through the real executor + the real queue in `validateSolidsRun.test.ts` — a Cancel and an
   engine death mid-parse, each asserting the VFS name dropped, nothing published, `undoable: false` and the FIFO
   moving on). Mutation 2 shows all six.
7. **Mocks and wiring.** `validateSolids.test.ts`'s `vi.mock(".../insights/duckdb")` factory carries all 17
   exports (it is loaded because `sourceRead` is `importActual`'d); `validateSolidsRun.test.ts`'s is
   `measureSolidsRun.test.ts`'s, which already exports everything that graph imports. No `duckdb.ts` export was
   added by this task, so no sweep was needed. The executor is wired in `register.ts` and the EXECUTORS pin
   updated to the four shipped executors in import order.

## Brief / requirements conflicts (resolved in favour of the requirements, as instructed)

1. **The brief's reader rows do not exist.** Its `reportRow` uses `closed`, `manifold`, `oriented`, `valid`,
   `open_edges_n`, `nonmanifold_edges_n`, `degenerate_faces_n`, and its SQL assertion is
   `toContain("r.is_closed AS closed")`. Task 6's `buildSolidValidationSql` — pinned character for character
   against real DuckDB 1.5.5 as `VALIDATE_SQL` in `tests/integration/duckdb/solids.test.ts` — emits
   `id, f, geometry_type, parsed, is_valid, is_closed, is_manifold, is_oriented, open_n, nm_n, deg_n, ori_n`.
   Requirement 2 pins that builder, so the test rows and `toReportRow` use the READER's names and §7.3's output
   names are applied only in `valuesOf`. The SQL assertion became
   `toContain("CASE WHEN s IS NOT NULL THEN r.is_closed END")`, which also pins D1's guard.
2. **The brief's detector is `parsed` alone.** Requirement 3 wins: `isMeasurableSolid` (type AND parse). This is
   the `d9dfee2` widening, and mutation 3 shows the type half is load-bearing.
3. **TWO statements (brief) vs. scope-wide identity (requirement 1).** THREE, as Task 7 landed: the brief's
   `assertSourceIds(contributorIds, …)` off the report statement can only ever see the contributors, which is
   exactly what Strand A round-2 finding 1 rejects. Every brief case gained a `sourceIds([…])` second answer, and
   the SQL assertions moved from `statements[1]` to `statements[2]`. Cost, stated plainly: a second
   `read_cityjson` pass over the registered bytes, identical to Measure solids'.
4. **The brief's `layerWith` heuristic** (`id.includes("P") → "BuildingPart"`, and no `parents`) was replaced by
   Task 7's shape: a part is a part because it NAMES ITS PARENT, which is what `featureIdsByObject` actually
   reads.
5. **TWO commits, not one.** The `isMeasurableSolid` widening is a self-contained change to a shared module and
   stands green on its own; "one change per commit" is a global constraint. The flip, `useLodOptions`, the
   PARAMETERS section and every test are still ONE commit, as requirement 5 requires.

## Self-review

- **The report counts are BIGINT in the engine and `number` here.** `open_edge_count` and its two siblings are
  BIGINT, and `num()` tests for `"number"`. I checked rather than assumed: `runQuery`'s `toRows`
  (`src/insights/duckdb.ts:656-671`) narrows every BigInt to a Number on the way out, so no `bigint` can reach the
  executor; the integration harness narrows the same way, which is why `open_n: 2` reads as a JS number there.
  The reason is written into the module header, because if that narrowing ever moved, every count would silently
  become NULL. No `::DOUBLE` was added to the SQL (requirement 2 pins it) and no dead `bigint` branch was added
  to `num`.
- **`ori_n` (`orientation_error_count`) is read by the statement and written to no column, deliberately.** §7.3
  names seven columns and it is not one of them; Task 6's comment invites a later use. I did not invent an eighth
  column or a warning for it. It is in `reportRow`'s fixture because the row the reader hands the executor really
  does carry it.
- A NULL verdict over parsed contributors counts as "with issues" rather than vanishing, which keeps
  `measured === valid + withIssues` an invariant. Unreachable through the guarded SQL (a parsed solid's report is
  never NULL) — the comment says so, and the case exists because the arithmetic must hold anyway.
- `rollUpReports` filters to solids ITSELF rather than trusting the call site, so the per-member
  `rollUpReports([own])` call is correct by construction — the same property Task 7 gave `rollUpSolids`.
- An empty scope issues ONE statement and no source read work at all (tested); the queue's "nothing to write" path
  then finishes the run as done.
- The `ToolView` PARAMETERS blocks are now three sibling conditionals, not a nested branch — the module's own
  comment promises exactly that. No new CSS: `processing-section`, `processing-group__label` and
  `processing-note` are the existing tokens, and the note is the same element `RunFooter` uses for its reasons.
- `useLodOptions`'s solids branch is character-for-character the old body; only its guard changed. Its `useMemo`
  dependency list already carries `tool.id`.
- No browser smoke (Task 29 owns it); `npm run build` was not run and no dev-server-facing file was touched.
- No new lint warning (56, unchanged). No trailers. `.github/hooks/`, `docs/design-history/` and `.superpowers/`
  left untracked and unstaged. Nothing pushed. Hooks ran on both commits (pre-commit `vp staged`); none bypassed.
  The plan file was not edited.

## Concerns for later tasks

- **The contributor-id `IN (…)` list is still unbounded on scope "all"**, exactly as in Measure solids: a
  100k-building run puts every contributor id into the report statement and thence into §6.4's log. Task 7's
  report flags it and the reviewer parked it as the commander's large-layer smoke item; this tool doubles the
  number of places it appears. Worth naming in Task 29's smoke.
- **Two reader passes per run**, again as in Measure solids (the id-only identity statement plus the report). The
  only shape that removes it without weakening the join would change Task 6's engine-pinned statement.
- **`extensionChip.test.tsx:355`'s comment** still reads "all three spatial tools are still `implemented: false`" —
  accurate at this commit, false after Task 16/17/19. Left alone.
- **Every `needsLod` tool is now implemented.** `useLodOptions`'s "an unimplemented tool gets nothing" rule is
  still stated and still tested, but only on explicitly unimplemented definitions
  (`lodSelect.test.tsx`'s `renderHook` case) — there is no registry entry left to illustrate it. That is the
  intended end state of Task 8's migration; a future reviewer should not "simplify" the rule away because no
  shipped tool exercises it.
