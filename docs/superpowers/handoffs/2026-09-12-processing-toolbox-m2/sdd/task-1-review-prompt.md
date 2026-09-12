You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-1-brief.md
The plan's design decision this task implements (approved by the repo owner): section "### (a) The status subscription" and "Decisions recorded" in /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md. Spec: /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md (§5 chips, §6.1).
Controller rulings that are requirements: locate edit sites by code, not the plan's line numbers; EVERY vi.mock of insights/duckdb exports the two new functions plus whatever the module under test imports; comments/docs must not claim the status-bar Retry reboots a ready engine, nor that cancellation depends on this task; a pre-boot ensureExtension publishes nothing (the pre-review fix c22cb02).

Global constraints that bind: CLAUDE.md hard rules as rewritten in this diff — duckdb.ts the ONLY importer of @duckdb/duckdb-wasm (tests may mock the package); ONE writer: duckdb.ts owns the value and publishes every transition through setStatus, React reads through useDuckDBStatus() only, nothing else publishes, never into component state; retryEngine() stays the door; test files import from "vitest"; noUncheckedIndexedAccess; no trailers.

## What the Implementer Claims They Built

Read the implementer's report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-1-report.md

## Diff Under Review

**Base:** 8102e78 **Head:** c22cb02
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/review-8102e78..c22cb02.diff
Read the diff file once (in chunks; it is 33+ files, mostly two-line mock edits). Do not re-run git commands; do not crawl the codebase — inspect outside the diff only for a concrete named risk (one focused check per risk, named in the report). Named risks worth one check each: any remaining reader of App's deleted status mirror; any vi.mock of insights/duckdb NOT in the diff whose module under test now imports the hook (grep). Read-only on this checkout; no subagents.

## Do Not Trust the Report

Verify claims against the diff; rationales never downgrade a finding.

## Tests

The implementer ran the tests and reported results with TDD evidence; do not re-run the suite. A focused test file only when the code raises a specific doubt.

## Part 1: Spec Compliance — Missing / Extra / Misunderstood; ⚠️ for what the diff alone cannot show.

## Part 2: Code Quality — useSyncExternalStore correctness (snapshot stability, subscribe/unsubscribe, server snapshot), the publisher (every status assignment routed, listener exceptions, version monotonic), the hook's consumers (App, status bar, useEligibilityContext), the package-level fake's fidelity, test hygiene.

Cite file:line for every finding.

## Calibration

Important = incorrect/fragile behaviour, a missed requirement, or maintainability damage you would block a merge over; polish is Minor; plan-mandated defects are Important, labeled plan-mandated.

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
