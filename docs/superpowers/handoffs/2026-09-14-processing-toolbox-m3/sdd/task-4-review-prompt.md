You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-4-brief.md
The plan's front matter that binds it (Global Constraints, the verified engine and code facts, the "New exported names" ledger, the design decisions (e), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the residual items that name Task 4).
Spec sections: §6 (OUTPUT: "the resolved column list in mono, always shown before Run"), §6.2 (Style by result picks "the first column the run ACTUALLY wrote"), §7 (output column types DOUBLE/BOOLEAN/VARCHAR) in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements for this task (residuals carried into the dispatch, rulings): `outputColumns(prefix, params)` stays TWO-argument and returns `OutputColumn[]` (`{name, type}`); the ToolView hard-coded "DOUBLE" has exactly one remover; no on-screen behaviour change; the Run test uses the roof-bearing fixture; the implementer split heightFromExtent's `columnNames()` into typed `outputColumns(prefix)` + a one-line `columnNames(prefix)` (outside the brief's file list, judged necessary — assess); `roofMetrics.ts` still states `type: "DOUBLE"` inline for its ToolResult.columns (implementer flagged, left as out of scope — assess whether that is a second type-deciding site the plan meant to remove).

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-4-report.md

## Diff Under Review

**Base:** 208503d **Head:** 07ad329
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-208503d..07ad329.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether every caller of outputColumns (useToolForm, ToolView, runQueue's freeze, RunFooter, the executors) now reads `.name` where it needs a string, and whether any remaining caller still treats the result as string[]; whether the provenance store leak the implementer fixed in useToolForm.test.tsx hides a real leak in production. Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify every claim against the diff. Check the registry entries for both implemented tools return the exact types the spec gives (all DOUBLE for extent and roof metrics), that the frozen run record's `columns` stays string[] of names (RunRecord is unchanged by this task), and that the tests assert the typed shape end to end (registry → form column list → submitted run).

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
