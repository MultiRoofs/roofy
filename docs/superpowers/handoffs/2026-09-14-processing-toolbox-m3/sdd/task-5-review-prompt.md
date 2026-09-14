You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-5-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (b), (h), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 5).
Spec sections: §2 (source re-registration through the provider), §6 (the workload note "Re-reads a 180 MB source; this can take a minute and needs memory" above 100 MB), §6.1 (the "Reading source" phase and its three failure sentences; "the only check possible is that the object ids match") in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): residual A2 (vi.hoisted mock init — the implementer reproduced and fixed it); registerBuffer === false split into EngineDeadError (status not ready) vs SOURCE_OUT_OF_MEMORY; every engine await in the phase raced with raced() (abort + death) and a late registration dropped; assertSourceIds(requested, returned) documented as taking the executor's OWN scope-rows ids; classifySourceFailure covers fetch AND reader statement, Binder/Catalog/Parser/Syntax errors travel as themselves, engine detail to ctx.warn; LayerTable.extension + sourceBytes captured at build (~16 LayerTable-literal test files updated; no layerTables mock factory change); the LoD label → column suffix from LayerTable.lods only; the VFS name released in a finally; the implementer's deviations: two more reader-backed fixtures got extension: "city.json", one assertion moved from extension<compute to extension<source for measure-solids; concern: the workload note is reachable for an unimplemented needsReader tool (commander ruling: gated on implemented in Task 8, not here).

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-5-report.md

## Diff Under Review

**Base:** 07ad329 **Head:** 9fb094a
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-07ad329..9fb094a.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether export.ts's existing re-registration and layerTables' build still agree on the VFS naming and the DETACHED-bytes contract (a provider returning the same array twice); whether the "source" phase sits AFTER the extension phase and the pre-flight refusals and BEFORE resolveScope as §6.1 orders, and inside runOnTableQueue; whether a run with needsReader false never enters the phase. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the phase ordering in runQueue, the release-in-finally on every exit path (success, cancel, death, failure), the three failure sentences verbatim, the byte count read BEFORE registerBuffer detaches the array, that a label with no LodColumn entry is an error not a guess, and that the tests assert behaviour through the real runQueue where the brief says so.

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
