You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-16-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (c), (e), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 16).
Spec sections: §7 (joined fields evaluated ONCE on the proxy, copied to root and parts), §7.5 (all of it: CRS/preflight, proxy, predicates incl. "within (boundary included)" and "centre within" with the tie rule, fields, multi-match rules, match count, prefix from the source name slugified, the card "1,143 buildings joined · 61 outside every area · 2.9 s", Style by result on the first copied TEXT field = most frequent value else matches_n > 0, value types), §6.1 ("Layer changed while running; run again"), §6.2 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): B1 scope-wide identity via the scope-rows read on the footprint path (bbox proxies read the table only); B7 frozen-field re-validation over ALL live source records; B9 ST_CoveredBy for within with a boundary-POINT engine test; centre within forces the centre proxy in the SQL (the form's displayed/frozen params are Task 15's fix round); multi-match first/largest/count-only per §7.5; matches_n 0 vs NULL (no proxy = g IS NULL); copied values typed by fieldTypes; line/caveat card; the function-form descriptor + the end-to-end mostFrequent footer case; Task 9's synthetic mock retired; implemented: true with real-registry row reasons; cancel/death/cleanup through the real queue; the builder text probed on the engine; batch 500.

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-16-report.md

## Diff Under Review

**Base:** f256428 **Head:** b208f1b
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-f256428..b208f1b.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether the largest-overlap SQL ties resolve to idx order and whether an equal-overlap case is probed; whether a copied VARCHAR field's NULL vs empty string survives the write (read_json_auto inference on the values file — the M1 facts); whether the executor writes root AND part rows with the same joined values; whether the vector table and reader handle are BOTH released on the cancel/death paths. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the predicate SQL for each of the three predicates, the tie rule, the count-only forcing, the NULL rules, the identity check inputs, the frozen-field check over all records, the prefix default (slugified source name), the card line, the descriptor's two branches through the real footer, and that the tests assert values through the real queue where the brief says so.

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
