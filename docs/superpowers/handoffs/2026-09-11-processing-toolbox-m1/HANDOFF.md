# Handoff: Processing toolbox, Milestone 1 (M13.1)

Date: 2026-09-11. Branch: `develop` (pushed). Plugin submodule pinned at
`a890c63` (= `origin/main` of `cityjson-navara-plugins`).

This folder is a committed snapshot of the execution ledger and the
per-task implementer reports from the (git-ignored) SDD workspace
`.superpowers/sdd/2026-09-10-processing-toolbox-m1/`. If that workspace still
exists on the machine, it also holds the task briefs and the review diffs;
if not, regenerate briefs with the superpowers script
`subagent-driven-development/scripts/task-brief <plan> <N>`.

## Documents

- Spec (authority): `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`
- Plan (this milestone, 14 tasks): `docs/superpowers/plans/2026-09-10-processing-toolbox-m1.md`
- Mockup: `design/processing-toolbox-wireframe.html`
- Roadmap entry: `docs/roadmap.md` Milestone 13
- Ledger with every ruling and deferred finding: `sdd/progress.md` (here)
- Implementer reports: `sdd/task-N-report.md` (here)

## State of the 14 tasks

| Task                                                  | Status                                                           | Commits                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| 1 types/registry/eligibility                          | complete, reviewed                                               | 14701ca                                              |
| 2 processingStore                                     | complete, reviewed                                               | 12a602e (+ d6ebf06 fixes)                            |
| 3 Tools button (map header)                           | complete, reviewed                                               | 2d55992                                              |
| 4 Tools tab, catalogue, pills, Escape                 | complete, reviewed                                               | d6ebf06, 7b128d2                                     |
| 5 bbox on flat rows                                   | complete, reviewed                                               | 8bfd3c1, eb9a5b4                                     |
| 6 runOnTableQueue                                     | complete, controller-reviewed                                    | af6534e                                              |
| 7 setModel + mergeAttributes                          | complete, reviewed                                               | plugin a890c63; app a4c1218                          |
| 8 computedColumns write-back                          | complete, reviewed                                               | d673991                                              |
| 9 scope + run queue                                   | complete after 1 fix round, re-review clean                      | b8d9f85, dc088cd, 17a6b9f, 0dd69e4, fd8a6f8, 63eb06e |
| 10 Height from extent                                 | complete, reviewed                                               | 66d5f89, 368de10                                     |
| 11 tool view, footer, recent runs, log                | implemented, **review returned Needs fixes, fix round NOT done** | a1b1e39, bbba686, c9be262, 2df6d33                   |
| 12 computed badges (table, Details, rules)            | implemented, **review NOT run**                                  | e3cf64f                                              |
| 13 toast + Style by result draft                      | not started                                                      |                                                      |
| 14 milestone gate (smoke, docs, Codex review, probes) | not started                                                      |                                                      |

Also on develop: chore `0d035ea` fixed two pre-existing pre-push blockers.

The feature already works end to end in the browser (verified by the
Task 11 and Task 12 implementers on the Delft sample): Tools → Height from
extent → Run → result card → Open table (three badged columns) → Details
COMPUTED group → rules attribute select "Computed" optgroup → Undo.

## What the next agent must do, in order

1. **Task 11 fix round 1** (findings from the review, see `sdd/progress.md`
   lines tagged "Task 11: review Needs fixes"):
   - Failed card's Retry must call `submitRun(requestFromRun(run))` (frozen
     parameters), not the form's `run()`.
   - "Queued behind X" only when `latestRun.status === "queued"`.
   - Ruling on §6.2: the form stays locked while the latest run's done/failed
     card shows; Retry re-runs the frozen request; "Run again" unlocks the
     form with the same values without submitting.
   - Export the output-column name builder from
     `src/features/processing/tools/heightFromExtent.ts` and consume it in
     `src/ui/processing/useToolForm.ts` (`OUTPUT_COLUMNS`); add an equality test.
   - `eligibleTargets` must filter with `toolEligibility` per layer, not only
     "table ready".
   - Minors: positive "Matching" radio test; duplicate `.processing-back`
     rules and the 30 px magic number in `processing.css`; queued footer reason
     precedence; `aria-live` on the progress block; warnings keyed by index.
     Then a scoped re-review of the fix diff.
2. **Task 12 review** (diff `2df6d33..e3cf64f`; brief = plan Task 12 + the
   dispatch note that computed columns are visible by default in the drawer).
   Implementer concerns to weigh: sub-heading renders "Computed" (peers are
   sentence case in the viewer shell) rather than the brief's "COMPUTED";
   a user-customised column list does not gain later computed columns;
   streaming layers get the table badge but no Details/rules entries
   (nothing merges into an FCB layer's model).
3. **Task 13** per the plan (toast via `noticeSeq`; Style by result opens
   STYLE with Color by = Rules and a DRAFT rule on the first written column,
   operator `>`, median value, next palette colour; disabled with
   "All values are empty" when nothing was measured).
4. **Task 14** per the plan: full verification, browser smoke = spec §10
   scenario 1 recorded in `scripts/smoke/processing-m1.md`, docs
   (`architecture-notes.md`, roadmap 13.1 status), the real-DuckDB probes
   listed below, then the Codex review, address CRITICAL/MAJOR, push.
5. Final whole-branch review (superpowers `requesting-code-review`), one fix
   wave, then Milestone 2 planning (`docs/superpowers/plans/…-m2.md`: Roof
   metrics to attributes + lazy extension loading + status subscription).

## Probes owed at the gate (real DuckDB 1.5.5, `DUCKDB_INTEGRATION=1` harness)

- `writeComputedColumns`: ALTER TABLE ADD COLUMN followed by UPDATE … FROM
  read_json_auto inside ONE transaction is accepted by DuckDB-wasm.
- `read_json_auto` type inference for an all-NULL output column and for a
  BigInt stringified by the replacer, assigned into a DOUBLE column.
- The transaction runs on the shared connection while other readers
  (table page, counts) may query mid-transaction; confirm no interference.

## Process to keep

- Commander/reviewer + Opus implementers, one implementer at a time
  (concurrent commits collide on the index and the formatter hook);
  reviewers run in parallel. Task reviewer prompt, re-review prompt and
  scripts live in the superpowers `subagent-driven-development` skill.
- Every milestone ends with a Codex review of `git diff <start>..HEAD`
  plus the spec, model `gpt-6-astra`:
  `codex exec -m gpt-6-astra --skip-git-repo-check -s read-only "…" < input.md`.
  No `timeout` binary on this Mac.
- TDD, red first; every user-visible string verbatim from the spec.
- Commit on `develop`, prefixes `feat:/fix:/test:/docs:/chore:`, no
  attribution trailers (session ruling), push after each reviewed task.

## Environment gotchas

- Run vitest under Node 24: `export PATH="$HOME/.local/share/mise/shims:$PATH"`
  first. The default Node 26 fabricates jsdom `localStorage` failures.
- `git status` takes ~15 s (fsmonitor); subagents that run the full vitest
  suite in the foreground have stalled the harness watchdog. Let the
  pre-push hook run the suite; run focused files while iterating.
- `index.html`, `src/app/launchScreen.ts` and
  `tests/unit/app/launchScreen.test.ts` carry someone else's uncommitted
  launch-screen work. Never stage/format/revert them. To push while they
  are dirty: `git stash push -u -m wip && git push origin develop; git stash pop`.
- Never bare `vite`; use `npm run dev`. Browser checks via the Playwright
  MCP tools work; picking a building with a synthetic click does not (use
  the table row click).
- `tsconfig` has `noUncheckedIndexedAccess`: plan test snippets need `?.`
  on array indexing.
- The SDD workspace is git-ignored; this folder is its committed copy.
