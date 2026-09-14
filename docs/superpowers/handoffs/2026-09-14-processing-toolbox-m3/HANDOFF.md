# Handoff: Processing toolbox, Milestone 3 (M13.3) — COMPLETE

Date: 2026-09-14. Branch: `develop` (pushed). Plugin submodule pinned at
`82949ed` (= `origin/main` of `cityjson-navara-plugins`).

This folder is the committed snapshot of the git-ignored SDD workspace
`.superpowers/sdd/2026-09-12-processing-toolbox-m3/`: the ledger with every
ruling (`sdd/progress.md` — the owner's scope and copy decisions are its first
rulings), the task briefs, the per-task implementer reports
(`sdd/task-N-report.md`, `sdd/fixwave-1-report.md`), and every Codex
`gpt-6-astra` review: the three plan-review strand passes and their round-2
re-reviews, the per-task and per-pair reviews and re-reviews, the milestone
review (`sdd/m3-review-{src,tests}.md`), the fix-wave re-review, and the final
whole-branch review (`sdd/final-review.md`).

## Documents

- Spec (authority): `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`
- M3 plan (29 tasks, all complete; "Decisions recorded" holds the owner's answers;
  "Review residuals" is the pre-flight list the execution resolved):
  `docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md`
- Roadmap: `docs/roadmap.md` Milestone 13 (13.3 implemented 2026-09-13;
  "Carried to M4" is the open-items record)
- Architecture: `docs/architecture-notes.md` "M13.3 (2026-09-13)" (nine seams
  and the engine facts D1–D11)
- Browser smoke: `scripts/smoke/processing-m3.md` (scenarios 2, 3, 5, 8, 10,
  11, 12 plus the re-smoke of F1/F5 after the fix wave)
- Real-DuckDB probes (opt-in `DUCKDB_INTEGRATION=1`): `tests/integration/duckdb/`
  (`solids.test.ts`, `crossLayer.test.ts`, `computedColumns.test.ts`,
  `layerTables.test.ts`)
- Fixtures added: `fixtures/invalid-solid.city.json`, `fixtures/composite-solid.city.json`
- Earlier handoffs: `docs/superpowers/handoffs/2026-09-11-processing-toolbox-m1/`,
  `docs/superpowers/handoffs/2026-09-12-processing-toolbox-m2/`

## What shipped

Every catalogue tool runs: Measure solids and Validate solids (`three_d`,
reader-backed layers, the surface geometry-type tag in the plugin, the
"Reading source" phase, the guarded one-statement SQL); Join attributes by
location, Aggregate buildings per area, Distance to nearest (`spatial`,
app-side reprojection with preflight, the per-run vector table, the building
proxy, vector results in the feature properties with badge/Details/colour/
export/Undo); the New layer destination for every tool (city copies cut from
the parent table by feature roots and reader-backed by metadata, vector copies
as plain GeoJSON, name re-check " (2)", Undo removes the layer, omitted from
snapshots and share links, the Save toast); ONE Style-by-result descriptor per
tool with a rule palette and Color by = Rules at Save; engine death off the
table FIFO (the six primitives race the death signal; retryEngine's generation
bound after the boot; undoRun's post-COMMIT death contained); the M1/M2
leftovers (write SQL in the log, Open table scroll-into-view, the roof-area
tooltip, the version-aware streaming sweep).

## Known open items (roadmap "Carried to M4")

See `docs/roadmap.md`; the ledger's `grep "carried\|PARKED\|parked"` gives
the ruling behind each: the unbounded contributor id list on scope All
(measured at 1,115 features: 40 KB statement, 16 s run — acceptable now, pushes
into SQL at 100k), provenance not cleared on layer removal (pre-existing),
`queryParquetBuffer`'s registration/cleanup and `ensureExtension`'s in-flight
INSTALL/LOAD unraced, the FCB attribute write-back (future consideration),
New layer on a streaming target (deviation, owner-approved), F4 (an unreproduced
provenance-clear without the stale mark; the invariant is pinned), a derived
layer dropped from a share link without notice.

## Process facts

As M1/M2 (Codex `gpt-6-astra` read-only reviews with file-path prompts,
launched detached with `setsid nohup` and a 3-attempt retry wrapper for
"model at capacity"; agent-browser + the Playwright Chromium for smokes; no
commit trailers; `ListAgents` before dispatching). New this milestone: from
Task 17 the owner asked for PAIRED reviews (two tasks, one Codex review, one
fix round); `TRY()` exists in DuckDB 1.5.5 but does not catch three_d's errors;
a `pkill -f`/`pgrep -f` pattern that also appears elsewhere in the same Bash
command kills the tool's own shell; `sed 's#…#…#'` breaks on `#` hex colours
— render prompts with a script.

## Next

Milestone 4 planning against the roadmap's "Carried to M4" list and spec §9's
deferred slots (footprint operations to a new layer, the field calculator,
city-to-city joins, replay on restore, computing on layers without a reader).
