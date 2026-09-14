You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-14-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (c), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 14).
Spec sections: §7 (contributors; "joined fields, nearest id and distance: evaluated ONCE on the feature's proxy geometry (the union of its parts' footprints, or the feature's combined extent)"), §7.5 (Building geometry radio: "Footprint (LoD 0)" when the target has LoD 0 geometry and a reader; "Extent rectangle" and "Extent centre" always; the muted line), §7.7 (the "2D distance to the building footprint / extent / centre" sentence), §6.4 (the log names the proxy used) in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): footprint filtered to the frozen ids (whereIds); §7 contributor rule on the footprint path (parts with LoD 0 displace the root); bbox proxies whole-feature; ST_Force2D on the footprint arm (bbox arms already 2-D); footprints only from the LoD 0 reader column (via LayerTable.lods; the reader names it geometry_lod0_0); the probe runs the builder text for all three proxies; log labels descriptive, the §7.7 note sentences verbatim; engine finding: an empty ST_Union_Agg returns GEOMETRYCOLLECTION EMPTY → wrapped to NULL (Tasks 16/17/19 test g IS NULL as the one "no proxy" signal) — accepted; proxy literals "footprint" | "rectangle" | "centre" per the plan.

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-14-report.md

## Diff Under Review

**Base:** 8e87e49 **Head:** 480b069
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-8e87e49..480b069.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether the footprint relation's per-feature union is over CONTRIBUTORS' LoD 0 parts only when any part has LoD 0 geometry (a root with LoD 0 and a part with LoD 0 → the part only); whether a feature whose proxy is NULL is distinguishable from one absent from the scope; whether the log row prints the proxy on every cross-layer run header (once, not per statement). Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the three SQL shapes against the probe, the contributor rule and ids filter in the footprint arm, the ST_IsEmpty → NULL wrap, the Force2D placement, that footprintAvailable(table) is the one predicate the form will use, and that unit tests pin the exact statements while the probe pins the engine's answers (areas, the part-not-root case, the empty union).

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
