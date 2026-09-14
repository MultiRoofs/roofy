You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-9-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (e), (i) (only the parts Task 9 owns — Color by = Rules stays eager until Task 26), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 9).
Spec sections: §6.2 (Style by result: the first column the run actually wrote, in the tool's order; disabled with "All values are empty"; the map unchanged until Save; per-tool rules: §7.1–§7.7's Style-by-result sentences), §7 (features not rows → the median and the most-frequent value over ROOT rows) in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): residual A4 (buildMostFrequentSql imported in sqlQuery.test.ts; ToolView.test.tsx's median expectation updated; the real-engine DECIMAL probe of buildMedianSql added and run); runs seeded into useProcessingStore for the runById guard; evaluateRule(attributes, metrics, rule); the boolean = rule pinned end to end; the footer mostFrequent case deferred to Task 16; RunSummary.nonNullByColumn for every written column, the button disabled when the PICKED column's count is 0, stale outranks empty; Color by = Rules still eager; descriptors for all seven tools (the brief's Step 6 — accepted; validate-solids and join columns are typed DOUBLE in writtenColumns until Tasks 10/15 land — harmless, name-based pick); no toolId branch in RunFooter.

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-9-report.md

## Diff Under Review

**Base:** a7ce037 **Head:** 6a8275a
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-a7ce037..6a8275a.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether every existing Style-by-result behaviour (extent > median, roof_area_m2 > median, All values are empty, stale outranks empty, the token/alive checks) is preserved through the descriptor path; whether the median CAST changed the M2 root-row restriction; whether the function-form resolvers are exhaustively typed (a plain value vs a function) under noUncheckedIndexedAccess. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the descriptor type expresses solid_valid = false (BOOLEAN literal), < median, and the function forms; that buildMostFrequentSql is root-rows-only and ties are deterministic; that summarise computes nonNullByColumn for every column; that RunFooter has no toolId branch; and that the tests drive the real footer with seeded runs.

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
