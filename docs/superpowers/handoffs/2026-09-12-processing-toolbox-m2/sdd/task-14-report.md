# Task 14 report — Documentation

Commit: `819309c docs: record M13.2's seams, and refresh the carried-forward list`
(one commit, `develop`, staged by path, no trailers; amended once to fix the two
factual slips listed at the end of the deviations). `npx vp check` before the
commit: **0 errors, 56 warnings in 528 files** (baseline). Not pushed. No code,
no tests, no CLAUDE.md touched; `.github/hooks/`, `docs/design-history/` and
`.superpowers/` left untracked/alone.

## What was written

### `docs/architecture-notes.md` — new `### M13.2 (2026-09-12)` heading

Inserted immediately BEFORE Task 1's status paragraph (which had landed after
the `### --font-mono` heading and was therefore nested under it), so all M13.2
material now shares one heading; Task 1's text is untouched, and the section's
last line is still `Browser acceptance procedure: scripts/smoke/processing-m1.md`.
Eight new paragraphs after Task 1's:

| Paragraph                                                                                                                      | Source of the facts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listeners are isolated, and every engine has a number**                                                                      | `duckdb.ts:113-134` (`setStatus`: copy + per-listener try/catch, with its own comment on the `doInit` boot/terminate hazard), `:150-186` (`markEngineDead`'s death dispatch, same shape), `:109` + `:154` + `:363` (the generation, bumped by boot and death), `getEngineGeneration()` doc comment, `layerTables.ts:453-465` (re-arm from inside the dispatch, because `onEngineDeath` drops each listener as it fires)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **A tool's extension loads inside the run, in its own phase**                                                                  | `runQueue.ts:608-640` (the phase, its two placement comments, the un-abortable `ensureExtension` and the far-side Cancel), `resolveScope` call at `:652` (verified the phase precedes scope resolution)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **A dead worker is detected, announced and contained — and not recovered from**                                                | `duckdb.ts:410-414` (own `error`/`messageerror` on the worker `doInit` created), `:150-186` (`markEngineDead`: drop `db`/`conn`, clear `initPromise` + `extensionPromises`, publish `failed`) and `:402-409` (the handler's `stopEngine` terminates the worker AFTER `markEngineDead`, deliberately outside it), the `markEngineDead` doc comment (duckdb-wasm clears pending requests without rejecting; `postTask` returns `undefined`), `runQueue.ts:156-199` (`raced` against the death signal AND the abort, with the "a signal fires once" reason), `duckdb.ts:549/595/637/683/703` (`runQuery` & co. refuse on non-`ready`), `eligibility.ts:46` ("Not available while DuckDB is unavailable"), `layerTables.ts:422-430` + `:414-421` (invalidation to `failed` "Analytics engine stopped", keyed on the death signal, with the `initializing`-death argument), `:897-1033` (builds carry `getEngineGeneration()` and abandon), `processingStore.ts:71/237` (`engineStopped`, session-wide), `layerTables.ts:725-735` + `:400-412` (`retryEngine` revives only `pendingSources`; entries stay failed until reload) |
| **The death path's known gaps, recorded rather than fixed**                                                                    | ledger "Task 4: minor (deferred → docs/roadmap)" line, re-verified: `refreshLayerTableColumns` (`layerTables.ts:348-372`) re-reads the registry but has no generation check; `retryEngine` (`:725-`) has none either (grep for `generation` in both bodies: none); `runQuery` callers outside `execute` — export dialog, `useLayerCounts` — do not race the death signal (only the run queue's `raced` uses `onEngineDeath` to release an engine await; `layerTables.ts:40` imports it for the invalidation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Roof metrics is computed app-side, in JS, and measures only what it writes**                                                 | `tools/roofMetrics.ts:1-51` (one statement, table = rows authority, source = geometry authority, `ROOF_BATCH_FEATURES = 500`), `:243-258` (macrotask yield then `throwIfCancelled`), `roofGeometrySource.ts:2-20` (the CPU contract and the two halves)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **§7's contributor rule is about GEOMETRY, not about roofs** + root/part rows                                                  | `roofGeometrySource.ts:19-20`, `:177-192` (tags-only LoD counts under the same rule), `tools/roofMetrics.ts:170-206` (root row = feature roll-up over contributors; each part row = its own surfaces' roll-up), submodule `geometryLods` per Task 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **The drawer's "Roof area" and the computed `roof_area_m2` can disagree**                                                      | Task 13 report, Concern 2 (fixture `NL.IMBAG.Pand.0001`: inspector 112.0 m² / 30.0°, computed 20 m² / 0°), explained by the contributor rule above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Two roof aggregations, on purpose** / **Style by result gates on values** / **A streaming run's card says what it ran over** | `domain/roofMetrics/aggregate.ts` vs `roofRollUp.ts`; `runQueue.ts:265-281` (`firstColumnNonNull` from the FIRST output column) with `RunFooter.tsx:253-261` (stale outranks empty); `runQueue.ts:237-255` (`RESIDENT_SET_NOTE`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### `docs/roadmap.md` — Milestone 13

- Added a **"Milestone 13.2 implemented 2026-09-12"** paragraph: the tool and
  its form (LoD select with per-LoD counts, six measures all ticked by default,
  0–15° slider default 5° strict `<` — verified in `roofMetricsParams.ts:43-98`
  and `roofRollUp.ts:65`), app-side compute on every city layer kind including
  streaming, the "Loading extension" phase, the published status + capability
  chips with Retry, and engine death detected/contained with recovery
  deliberately absent. Browser evidence is stated as Task 13 measured it
  (`two-buildings` + Delft, 1,115 buildings, 9.2 s, light and dark, 1000 px).
- Replaced "Carried to 13.2 / M2" with **"Carried to 13.3 / M3"**, one line per
  item: the FCB write-back deferral-with-a-design (owner's future
  consideration), no-recovery after a death, the three death-path gaps, the
  median-over-rows bias, palette rotation, eager `Color by = Rules`, the
  stale/undone median in flight, the drawer-vs-computed roof area with no UI
  explanation, the five (not six) unimplemented tools + the unreachable
  extension chip copy, the `useLodOptions` note for M3, cancel granularity
  (statement for SQL, 500-feature batch for Roof metrics' compute), write-step
  SQL absent from the log, no scroll-into-view, queued "Matching" ids resolved
  at the head, the corrupt-bbox honesty, and the pre-existing app-shell
  overflow below ~1024px.

## Deviations from the task brief (code won; flagged for the controller)

1. **The elapsed-timer bullet was DELETED, not extended.** The brief asks to
   extend it with the extension→compute re-stamp; `runQueue.ts:532-542` now says
   "ONE execution start for the whole run, stamped here and never again", and
   ledger line 36 records the ruling that Task 2's fix round closed the M1
   "timer jumps back" minor with it. Keeping or extending the bullet would
   document a behaviour that no longer exists.
2. **The "§6.1 re-validation of an output column" item the brief says to remove
   was not in the list.** `roadmap.md:615-648` never carried it; nothing deleted
   on that account. (`runQueue.ts` does re-validate; the roadmap simply never
   claimed otherwise.)
3. **`scripts/smoke/processing-m2.md` is NOT cited** — it does not exist yet
   (Task 15's deliverable). The roadmap cites the browser facts Task 13 actually
   measured instead. Task 15 should add the smoke-file reference.
4. **The batch yield is described as responsiveness, not cancellation
   correctness.** The brief's phrase "the only way a long, query-free executor
   can be cancelled at all" contradicts `roofMetrics.ts:21-26` ("RESPONSIVENESS
   and an early EXIT, nothing more: the queue already refuses to publish an
   aborted run"); the controller's phrasing was used.
5. **Dates are 2026-09-12** (controller), not the brief's 09-11.
6. **Items the controller did not enumerate were KEPT, not dropped**, because
   each is still true in the code and the heading promises "things a user can
   notice today": eager `colorBy: "rules"` (`RunFooter.tsx:142`, set before any
   Save), the stale/undone run whose in-flight median still opens a draft (the
   token guards cover a newer click, unmount and dismissal only — no stale or
   undo re-check after the await, `RunFooter.tsx:95-146`), palette rotation
   (`NEW_RULE_COLOR_HEX`, one constant), cancel granularity, the corrupt bbox
   (left as written — the Height-from-extent code behind it was not re-read this
   session, so the line is unchanged per the brief's "leave anything you cannot
   verify"), and the unimplemented-tool row precedence (count corrected to five:
   `toolRegistry.ts` has 5 × `implemented: false`). Prune any the controller
   does not want.
7. **Median-over-rows is listed as carried, not as fixed**: `RunFooter.tsx:53`
   still issues `SELECT median(<col>) FROM <table>` with no `WHERE`, and the
   controller did not confirm the M2-gate fix.

## CLAUDE.md

Not touched, and nothing in it is false. The "ONE writer of the DuckDB status"
rule at `CLAUDE.md:116` already carries Task 1's rewrite (`duckdb.ts` publishes;
`useDuckDBStatus()` is React's one door) — the session's git-status snapshot
showed the pre-Task-1 text, which was stale. The `retryEngine()` rule at `:117`
is still accurate: it rebuilds the sources parked while the engine was coming
up, which is exactly why the tables killed by a DEAD worker are not rebuilt (now
documented in both docs).

## Not verified, and therefore left out

- Whether the FCB attribute-overlay design in the plan's "Future consideration"
  section is still current in the submodule — the roadmap line only records the
  owner's ruling and points at the plan.
- The offline advisory sentence's real-browser behaviour (no automated test is
  possible under jsdom; Task 2's concern). Not claimed anywhere.
- Engine-death detection in a real browser (Task 4's last deferred minor: a
  worker kill via CDP). The docs say what the code does, not that a browser
  confirmed it.
- The corrupt-bbox bullet (see deviation 6) and the exact wording of the
  "Matching ids at the head" and "no scroll-into-view" bullets were carried over
  from M1 verbatim rather than re-derived from code.

## Amend (two slips fixed after the first commit)

1. The death paragraph said `markEngineDead` terminates the worker. It does not:
   `duckdb.ts:402-409`'s `stopEngine` calls `markEngineDead` and THEN
   `created.terminate()`, deliberately outside it (the code's own comment: once
   the connection is dropped the handler's closure is the last hand on a 36 MB
   wasm heap). Reworded.
2. The known-gaps paragraph said both `refreshLayerTableColumns` and
   `retryEngine` re-read the registry after their round trip. Only the former
   does (`layerTables.ts:360-365`); `retryEngine` guards on a drop landing since
   it began (`droppedSince`, `:748-749`). Split.

Re-checked (`0 errors / 56 warnings`) and `git commit --amend --no-edit` through
the pre-commit hook; the message is still trailer-free.
