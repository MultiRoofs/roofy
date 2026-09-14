You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 17 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-17-brief.md
Task 18 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-18-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (c), (e), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 17 and 18).
Spec sections: §7.7 (Distance to nearest: any source geometry type; max search distance; nearest id; 2D distance; ties; the card "1,204 buildings measured · 12 none within 500 m"; Style by result < median), §7.6 "Vector results" (records panel badge + provenance, Details for a picked feature, Color by attribute categories, GeoJSON export, client-side filter/sort, Undo restores the previous properties exactly, the vector table created per run and dropped, session only), §8 (Persistence: nothing new persisted), §6.1 ("Layer changed while running; run again"), §6.2 (Undo) in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 17: scope-wide identity (Task 16's shape); nearestIdProperty re-validated over ALL live records; mixed-collection distance pinned; g IS NULL = no proxy (skipped, not none-within); ENGINE FINDING D10: core ST_Distance/ST_DWithin return 0 for any polygon↔polygon pair on DuckDB 1.5.5 — Ruling: ST_Distance_GEOS (verify the builder, its NULL-safety, and that the engine cases pin a non-zero polygon-proxy distance and the point-proxy parity); A11; line/caveat card; implemented: true; cancel/death/cleanup through the real queue. Task 18: B5 refusal lifted + Task 11's three cases flipped; B3 source-document identity verified before merging (fail with §6.1's sentence on a relink) and rollback from the verified doc; B2 queued Undo re-checks undoable/retained state/identity at the FIFO head; per-property Undo (both orders for disjoint columns); narrowed GeoJsonLayer reads; picked feature refreshed by stable id, highlight kept; GeoStyleControls categories from preparedData; ONE config replacement per run; preparedData never persisted; publishProvenance/stealUndo/rollBackProvenance ready for Task 22; the implementer's deviations: pure functions return unknown (lint baseline); concerns: markEngineStopped revokes a vector Undo that needs no engine (assess — Ruling pending your view), a SOURCE city table rebuild retires a vector run (accepted, computeLayerId keying).

## What the Implementers Claim They Built

Task 17 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-17-report.md
Task 18 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-18-report.md

## Diff Under Review

**Base:** 60920dc **Head:** 91779a7 (Task 17's commits first, then Task 18's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-60920dc..91779a7.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether ST_Distance_GEOS behaves on collections and on a NULL side (the engine cases); whether the vector publication's config replacement leaves the engine pair rebuilt exactly once; whether a city-target run's Undo path is untouched by the UndoState union; whether the export's GeoJSON carries the computed properties and NOT the internal stable-id key; whether App's selection refresh cannot fire for city layers. Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 17: the SQL against the probe, the tie rule, the NULL/none-within/no-proxy accounting, the id checkbox defaults, the card. For 18: the merge/restore purity (GEO_PROPERTY_ABSENT), the identity checks at publish and at the Undo head, the badge/Details/categories/export surfaces with real values, and that the tests drive the REAL queue and store where the brief says so.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 17

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 18

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 17 quality:** [Approved | Needs fixes] — one sentence
**Task 18 quality:** [Approved | Needs fixes] — one sentence
