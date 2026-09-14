You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-{N}-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions {DECISIONS}, the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task {N}).
Spec sections: {SPEC_SECTIONS} in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): {REQUIREMENTS}

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-{N}-report.md

## Diff Under Review

**Base:** {BASE} **Head:** {HEAD}
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-{BASE}..{HEAD}.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): {RISKS}. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. {VERIFY}

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
