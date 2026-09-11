# Handoff: Processing toolbox, Milestone 1 (M13.1) — COMPLETE

Date: 2026-09-11 (evening). Branch: `develop` (pushed). Plugin submodule
pinned at `a890c63` (= `origin/main` of `cityjson-navara-plugins`).

This folder is the committed snapshot of the git-ignored SDD workspace
`.superpowers/sdd/2026-09-10-processing-toolbox-m1/`: the ledger with every
ruling (`sdd/progress.md`), the per-task implementer reports
(`sdd/task-N-report.md`, `sdd/fixwave-*-report.md`), the task briefs, and
every Codex `gpt-6-astra` review (`sdd/task-*-review*.md`,
`sdd/m1-review-{src,tests}.md`, `sdd/final-review.md`,
`sdd/fixwave-*-rereview.md`, `sdd/m2-plan-review.md`).

## Documents

- Spec (authority): `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`
- M1 plan (14 tasks, all complete): `docs/superpowers/plans/2026-09-10-processing-toolbox-m1.md`
- M2 plan (next; 12 tasks; 9 open questions for the human in its last
  section): `docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md`
- Roadmap entry: `docs/roadmap.md` Milestone 13 (13.1 implemented 2026-09-11;
  the "Carried to 13.2 / M2" list is the open-items record)
- Architecture: `docs/architecture-notes.md` "Processing toolbox seam (M13.1, 2026-09-11)"
- Browser smoke of spec §10 scenario 1: `scripts/smoke/processing-m1.md`
- Real-DuckDB probes (opt-in `DUCKDB_INTEGRATION=1`):
  `tests/integration/duckdb/computedColumns.test.ts` (+ CityParquet
  computed-column export in `layerTables.test.ts`)

## What happened after the morning handoff

1. Task 11 fix rounds 1–2, Task 12 review + fix round, Task 13 + 3 fix rounds,
   Task 14 (verification, probes, smoke, docs) — all reviewed by Codex.
2. Codex milestone review (source pass + tests pass): 6 MAJOR + 4 coverage
   gaps → fix wave 1 (cancel-before-COMMIT rollback, "Layer removed" cancels a
   running run, Retry reuses the frozen scope, case-insensitive column
   collisions + re-validation at the queue head, parts get their own extent,
   "Write to · This layer", "Cancel", draft rule name, collapse chevron,
   collapsed pills set the tab) → scoped re-review.
3. Codex final whole-branch review: 5 Important → final fix wave (canonical
   column spelling + case-insensitive Undo ownership, terminal-state guard in
   the queue's `patch`, CityParquet export of computed columns, failed-form
   recovery via dismissal, unseen-failure dot) → scoped re-review clean.
4. The M2 plan was written by an Opus planner and reviewed by Codex; the
   adjudication is in `sdd/progress.md` (last entries).

## Every ruling

`grep -n "Ruling" sdd/progress.md` — about thirty. Each carries "cost if
wrong". The ones a user will notice: unimplemented tools read "Not available
yet" over any eligibility reason; `colorBy: "rules"` is set eagerly by Style
by result; `--font-mono` is the brand's UI family so "mono labels" are the
brand's label style; the done card locks the form and "Run again" / "Edit &
run" / editing a field dismiss it; streaming (FCB) Details/rules entries and
runtime engine-death recovery are deferred to M2 as design tasks.

## Process facts (verified this session)

- Codex CLI `gpt-6-astra` works on this Linux host with `-s read-only` and
  file-path prompts (see `~/.claude/.../memory/host-tooling-quirks.md` item 13).
- The pre-push hook's `vp check` lints untracked files too; an unformatted
  draft doc blocks every push.
- Browser smoke: agent-browser + the Playwright Chromium
  (`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, headless,
  SwiftShader, `--remote-debugging-port=9333`, `agent-browser connect 9333`);
  the Playwright MCP has no Chromium here.
- Commit trailers: none (session ruling; the harness's Claude-Session line
  included).
- Two commander sessions overlapped once after a harness restart; the older
  one stood down. `ListAgents` before dispatching.

## Next

Answer the M2 plan's 9 open questions, then execute it with
superpowers:subagent-driven-development (Opus implementers, Codex reviews),
starting at Task 1 (the status subscription + the CLAUDE.md rule change).
