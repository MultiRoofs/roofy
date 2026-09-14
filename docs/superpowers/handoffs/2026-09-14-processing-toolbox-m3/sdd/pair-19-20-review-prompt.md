You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 19 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-19-brief.md
Task 20 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-20-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (c), (e), (f), (g), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 19 and 20).
Spec sections: §7.6 (Aggregate: vector TARGET, scope on the SOURCE buildings, membership incl. boundaries and "14 buildings counted in more than one area", parts never count, aggregates rows, NULL rules, columns <prefix><agg>\_<column> and buildings_n, the card, Style by result → Color by attribute), §6 OUTPUT ("Write to": This layer / New layer, the Name field prefilled "<target> · <tool noun>" with the seven names, uniqueness trimmed/case-insensitive among all layers, empty/duplicate flagged at Run, re-check at publication " (2)", inherited computed columns replace warning "2 inherited computed columns will be replaced in the new layer", the streaming deviation), §6.1 (frozen destination/name), copy A2/A12/A13/A14/A17 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 19: scope-wide identity on the footprint path; EVERY target area written (NULL/0 for skipped or unusable areas — rerun leaves no stale values); membership per predicate, boundary counts in both, ONE multi-membership caveat; count column ${prefix}buildings_n (bld_buildings_n); card line; Style by result kind "attribute" completed (STYLE section, Color by attribute, categories from preparedData); implemented: true; real-registry reasons; cancel/death/cleanup through the real queue; engine test with boundary-both-areas and all-NULL mean; brief overrules accepted (id join on the footprint path; caveat cause carries the noun; shared "no geometry"). Task 20: C2 (prefill from targetName incl. Aggregate → "Zones · buildings"; targetReason/sourceReason kept in runReason); streaming retarget refused in runReason AND at the head with A2, not printed twice; A13/A14 at Run, uniqueness across BOTH stores; disambiguate exported for Task 22; the inherited-columns replace warning; ToolDefinition.destinations declared, NO tool has "new" yet (the radio tested through a test definition); deriveLayer.ts created with the name rules only; RunRequest.destination/newLayerName frozen; 13 test files swept for the two new required fields. Note commit 2218ca3 inside the range is Task 18's already-approved test-only fix.

## What the Implementers Claim They Built

Task 19 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-19-report.md
Task 20 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-20-report.md

## Diff Under Review

**Base:** 91779a7 **Head:** 48884b9 (Task 19's commits first, then Task 20's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-91779a7..48884b9.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether Aggregate's membership SQL counts a FEATURE once per area (parts never), and whether the mean/min/max ignore NULLs while count is 0 for an empty area — check the engine cases; whether Task 20's runReason insertion changed any existing precedence (LoD, params) for the single-layer tools; whether the head guard "Not available yet" for an implemented tool with an unshipped destination is an honest sentence (the implementer flagged it — say what Task 22 should do). Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 19: every target feature initialised then overlaid, the caveat count, the column naming with the default prefix, the Style by result attribute branch through the real style section. For 20: the seven names, the A13/A14 gates, the cross-store uniqueness, the streaming refusal at both sites, the replace warning scoped to inherited columns, and that the New layer radio is unreachable for every shipped tool.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 19

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 20

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 19 quality:** [Approved | Needs fixes] — one sentence
**Task 20 quality:** [Approved | Needs fixes] — one sentence
