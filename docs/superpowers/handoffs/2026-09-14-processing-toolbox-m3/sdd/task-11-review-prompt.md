You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-11-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (c), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 11).
Spec sections: §3 (Target, Source), §5 (disabled reasons: "Needs a vector layer", "Add a vector layer to join with", priority order), §6 (TARGET/SOURCE selects), §6.1 ("Layer removed" for target OR source; frozen request), §7.5–§7.7 (target/source roles), §7.6 (a vector TARGET: scope applies to the SOURCE buildings), copy A3/A4 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): residual B5: a vector-target WRITE is refused "Not available yet" at the head in this task (Task 18 lifts it; three named cases to flip, incl. an it.todo); B15: the vector arms are GeoJsonLayer (narrowed), never the GeoLayer union; ToolResult byte-identical and summarise untouched; FrozenRequest.computeLayerId keys the pre-flights/watchers on the SOURCE city layer for a vector target; the removal watcher subscribes to both stores; the stale watcher keys on computeLayerId; the "belongs to the source data" pre-flight gated on a city target; eligibility order preserved with A3/A4 in place; aggregate-per-area still reads "Not available yet"; ToolView gained sourceLayerId: null on RunRequest (accepted — compile necessity); useGeoLayerStore import added.

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-11-report.md

## Diff Under Review

**Base:** 25df384 **Head:** e4b8989
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-25df384..e4b8989.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether every existing city-target path (extent, roof, both solids tools) is unchanged through the generalised ToolContext (target/source beside layer/table); whether a removal of the SOURCE geo layer while a run is queued/running cancels it with "Layer removed" through the REAL queue; whether the vector-target head refusal leaves the FIFO released and the card "failed". Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check ToolTarget/ToolSource shapes against the ledger, computeLayerId use at every pre-flight and watcher, that RunRecord.sourceLayerId/sourceName are frozen at Run, that eligibilityContextFor takes the inputs record the ledger states, that A3/A4 are verbatim and in the spec order, and that the tests drive the REAL queue for the refusal, the source removal and the stale key.

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
