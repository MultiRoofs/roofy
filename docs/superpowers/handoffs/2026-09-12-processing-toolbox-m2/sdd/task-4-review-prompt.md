You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-4-brief.md
Spec §6.1's engine-death bullet of /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md, as narrowed by the repository owner (plan "Decisions recorded"): NO recovery — status failed; catalogue rows disabled through the existing "Not available while DuckDB is unavailable"; queued AND running runs fail with the spec's exact "Analytics engine stopped"; every Undo disabled with the adapted "Unavailable: the analytics engine stopped"; the status bar's Retry unchanged (it reboots the engine, does not rebuild tables).
Controller rulings (requirements): detection only through the worker's own error/messageerror events (duckdb-wasm does not reject pending queries on worker death — the planner verified this; if the diff claims otherwise, check); listeners added additively; the watcher follows the target-removal watcher's installer pattern and reacts to ready → failed only; no DROP TABLE against a dead engine; the queue's terminal-state guard is relied on; edits located by code. Accepted implementer decisions: the handlers terminate the dead worker; the watcher ignores a boot that never came up.
Global constraints: CLAUDE.md hard rules (duckdb.ts sole importer; ONE publisher, React reads via useDuckDBStatus() only; retryEngine() the door — unchanged); tests import from "vitest"; noUncheckedIndexedAccess; user-visible strings verbatim from the spec or the recorded adapted copy; no trailers.

## What the Implementer Claims They Built

Read the implementer's report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-4-report.md (commit ids in it are the pre-rewrite ones fc88aa7/c4e6beb; the same diffs are now 5bad30e/b64fd35).

## Diff Under Review

**Base:** 75b2221 **Head:** b64fd35
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/review-75b2221..b64fd35.diff
Read the diff file once. Do not re-run git commands; inspect outside the diff only for a concrete named risk (one focused check per risk, named). Read-only; no subagents.

## Do Not Trust the Report

Verify against the diff. Named risks worth one check each: does `markEngineDead` interact safely with an in-flight `doInit`/`ensureExtension` (double publish, memo state); does the running run's abort reach `writeComputedColumns`' ROLLBACK path against a dead engine without hanging (a query against a dead worker never resolves — does anything await it after death?); does the flag reset on a later successful Retry, and should it (Undo tables are gone regardless).

## Tests

Do not re-run the suite; a focused test file only when the code raises a specific doubt.

## Part 1: Spec Compliance — Missing / Extra / Misunderstood; ⚠️ for what the diff alone cannot show.

## Part 2: Code Quality — detection fidelity, the watcher (installation/disposal, idempotence, ordering vs the removal watcher), the run failure path (running run: abort + terminal patch + no notice + no discardUndo), the store flag and its UI reads, test rigor (through the real queue and store, not mocks), test noise.

Cite file:line for every finding.

## Calibration

Important = incorrect/fragile behaviour, a missed requirement, or maintainability damage; polish is Minor; plan-mandated defects are Important, labeled plan-mandated.

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
