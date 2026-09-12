# Handoff: Processing toolbox, Milestone 2 (M13.2) — COMPLETE

Date: 2026-09-12. Branch: `develop` (pushed). Plugin submodule pinned at
`ea8fa64` (= `origin/main` of `cityjson-navara-plugins`).

This folder is the committed snapshot of the git-ignored SDD workspace
`.superpowers/sdd/2026-09-11-processing-toolbox-m2/`: the ledger with every
ruling (`sdd/progress.md` — the human's four decisions are its first
rulings), the task briefs, the per-task implementer reports
(`sdd/task-N-report.md`, `sdd/fixwave-1-report.md`), and every Codex
`gpt-6-astra` review (`sdd/task-*-review*.md`, `sdd/m2-review-{src,tests}.md`,
`sdd/fixwave-1-rereview.md`, `sdd/final-review.md`, `sdd/final-fix-*` if any).

## Documents

- Spec (authority): `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`
- M2 plan (15 tasks, all complete; "Decisions recorded" holds the owner's answers):
  `docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md`
- Roadmap: `docs/roadmap.md` Milestone 13 (13.2 implemented 2026-09-12;
  "Carried to 13.3 / M3" is the open-items record)
- Architecture: `docs/architecture-notes.md` "M13.2 (2026-09-12)"
- Browser smoke (scenarios 4 and 6 as narrowed): `scripts/smoke/processing-m2.md`
- Real-DuckDB probes (opt-in `DUCKDB_INTEGRATION=1`): `tests/integration/duckdb/`
- M1 handoff: `docs/superpowers/handoffs/2026-09-11-processing-toolbox-m1/`

## What shipped

The DuckDB status publisher + `useDuckDBStatus()` (CLAUDE.md ONE-writer rule
rewritten, owner-approved); the "Loading extension" run phase; capability
chips with Retry (incl. offline boot); engine death = features unavailable
(worker error detection, an independent death signal raced with every engine
await in the run queue and the table builds, table invalidation, builds loyal
to an engine generation, Undo disabled, no recovery by the owner's decision);
Roof metrics to attributes (pure roll-up, submodule LoD-tagged resident
metrics, a geometry source for static and streaming layers with the
geometry-keyed contributor rule, params + registry, a bounded-batch executor,
the LoD select, the PARAMETERS section); the Style-by-result gate on the first
written column's values, the median over root rows, the resident-set card line.

## Known open items (roadmap "Carried to 13.3 / M3")

FCB attribute write-back (future consideration, owner's words); `runQuery`
callers outside the queue never settle after an engine death; `retryEngine`'s
boot wait is unraced and carries no generation check; "Retry fails again while
offline" not verifiable in the smoke harness; palette rotation; the drawer's
synthetic vs computed roof area explanation; M1 items (write-step SQL in the
log, scroll-into-view, queued Matching ids resolved at the head); the app
shell's horizontal overflow below ~1024px (pre-existing); `useLodOptions`
answers only for roof-metrics (M3's solids tool must extend it).

## Process facts

Same as M1's handoff (Codex `gpt-6-astra` read-only reviews with file-path
prompts, launched detached with `setsid nohup` because the harness's
low-memory watchdog kills tracked background tasks; agent-browser + the
Playwright Chromium for smokes; no commit trailers; `ListAgents` before
dispatching). New: `agent-browser set viewport` breaks Navara's canvas; CDP
`Object.defineProperty(navigator, "onLine", …)` before boot emulates the
offline boot; Playwright's offline emulation does not reach the DuckDB worker.

## Next

M3 planning (Measure/Validate solids with `three_d`, cross-layer tools with
`spatial`, New layer destination) with superpowers:writing-plans, reviewed by
Codex before execution.
