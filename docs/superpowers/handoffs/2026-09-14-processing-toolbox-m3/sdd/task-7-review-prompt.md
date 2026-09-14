You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-7-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (b), (e), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 7).
Spec sections: §6.1 (phases; "the only check possible is that the object ids match"), §6.2 (card lines: caveat vs skipped; "37 invalid solids (no volume)"; "12 skipped: 9 no geometry at LoD 2.2 · 3 not a solid"), §7 (contributors keyed on GEOMETRY at the LoD; roll-ups: volume sum but NULL if any contributor NULL, sums, validity AND, height = combined extent, ground min, ridge max; root row = feature roll-up, part row = its own), §7.2 (outcomes per object) in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): scope-wide source identity via assertSourceIds(scope-row ids, reader ids) — the implementer added a cheap id-only reader statement (buildSourceIdsSql) so MEASURE_SQL stays contributor-only (commander accepted); D1 (no validity re-derived from parsed); D4 (not-a-solid keys on geometry_type ∈ SOLID types; two-buildings at 2.2 = 1 measured (0002) + 1 skipped not a solid (0001, MultiSurface part is the contributor)); invalid-solid fixture drives the invalid outcome (volume NULL, valid false, other measures present, caveat "invalid solids (no volume)"); roll-ups per §7; ToolResult.line/caveats + summarise renders caveats between measured and skipped; ctx.phase("compute") once the handle is open (accepted reading); release in finally on every exit path; register + EXECUTORS pin; implemented stays false; three-valued valid AND is order-independent (a61d327).

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-7-report.md

## Diff Under Review

**Base:** 5aea39a **Head:** a61d327
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-5aea39a..a61d327.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether summarise's caveat rendering changed any M1/M2 card line (roof/extent runs have no caveats — verify the tests still pin their lines); whether the unbounded `IN (...)` contributor list on scope "all" is a real hazard for a 100k-feature layer (name it; the commander parked it for the gate smoke); whether release() runs on the cancel and death paths through the REAL runQueue. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the contributor selection (parts with ANY geometry at the LoD displace the root), the root/part row split, that volume is NULL for the feature when any contributor's volume is NULL, the height = max ridge − min ground app-side, the skip/caveat accounting per FEATURE, the identity check covers every scoped row (missing root, missing non-contributor, under "all" and under a frozen list), and that the tests drive the REAL executor through the queue where the brief says so.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. The implementer's report carries the TDD evidence; judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Spec Compliance

### Strengths

### Issues

#### Critical (Must Fix)

#### Important (Should Fix)

#### Minor (Nice to Have)

### Assessment

**Task quality:** [Approved | Needs fixes]
**Reasoning:** [1-2 sentences]
