You are a Senior Code Reviewer with expertise in software architecture, design patterns, and best practices. Your job is the FINAL whole-branch review of a completed milestone against its spec and plan, identifying issues before merge.

## What Was Implemented

Roofy's processing toolbox, Milestone 2 (M13.2): the DuckDB status publisher + `useDuckDBStatus()` (the CLAUDE.md ONE-writer rule rewritten, owner-approved); the "Loading extension" run phase; capability chips that follow the extension state with Retry (incl. offline boot); engine death = features unavailable (worker error detection, an independent death signal raced with every engine await in the run queue AND the table builds, table invalidation, builds loyal to an engine generation, Undo disabled; NO recovery by the owner's decision); Roof metrics to attributes as the second tool (pure roll-up, submodule LoD-tagged resident metrics, a geometry source for static and streaming layers with the geometry-keyed contributor rule, params + registry, a bounded-batch executor, the LoD select, the PARAMETERS section, switched on with a browser pass); the Style-by-result gate on the first written column's values, the median over root rows, the resident-set card line; docs and a smoke record.

## Requirements

- Spec (authority): /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md — §5, §6, §6.1, §6.2, §7, §7.1, §8, §10 scenarios 4 and 6.
- Owner decisions that narrow the spec (binding): "Decisions recorded" + "Future consideration" in /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md (no engine recovery; FCB write-back deferred; adapted copy; all six measures on; strict threshold).
- Plan: the same file (Global Constraints; Tasks 1–15; "Review residuals").
- Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md (as rewritten).
- The M2 ledger of rulings, parked findings and deferred minors: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/progress.md — triage that list: which deferred/parked items MUST be fixed before merge, which may ship as roadmap items. A ruling is a decision the human will read; flag it only when the code contradicts the ruling or the ruling breaks §7.1 / scenario 4 / a hard rule.
- Already reviewed by you and fixed (do not repeat unless the fix is wrong): the source-pass and tests-pass findings in `m2-review-src.md` / `m2-review-tests.md` and the fix wave in `fixwave-1-report.md` (same directory).

## Git Range to Review

**Base:** 0519873 **Head:** 4076ec5
Diff files (read in sequential chunks to the end; do not run git commands):

- /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/final-diff-src.diff — src/, CLAUDE.md and the plugin submodule
- /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/final-diff-tests.diff — tests/, scripts/smoke/, docs/architecture-notes.md, docs/roadmap.md
  Read-only on this checkout. Inspect files outside the diff only for a concrete named risk (one focused check per risk, named). Do not dispatch subagents; if the diff is too large for one pass, review it in passes yourself and say so.

## What to Check

Plan alignment (all M2 functionality present; deviations justified); code quality (separation of concerns, error handling, type safety, edge cases); architecture (the publisher/subscription, the death signal + generation, the FIFO, the geometry source, the executor's batching; hard rules: duckdb.ts sole importer, ONE publisher, retryEngine() the door, @navaramap imports only in engine-binding modules, nothing persisted, brand tokens); testing (real behaviour, not mocks; the real-DuckDB probes; all passing per the reports); production readiness (docs; no obvious bugs). Every user-visible string verbatim from the spec or the recorded adapted copy.

## Calibration

Categorize by actual severity. Acknowledge what was done well. Flag significant plan deviations specifically. If you find issues with the plan or spec itself, say so.

## Output Format (your entire reply is the report; no preamble)

### Strengths

### Issues

#### Critical (Must Fix)

#### Important (Should Fix)

#### Minor (Nice to Have)

For each issue: file:line, what's wrong, why it matters, how to fix.

### Deferred/parked triage

For each ledger item you judge must be fixed before merge: the item and why. One line for the rest: "may ship".

### Recommendations

### Assessment

**Ready to merge?** [Yes | No | With fixes]
**Reasoning:** [1-2 sentences]
