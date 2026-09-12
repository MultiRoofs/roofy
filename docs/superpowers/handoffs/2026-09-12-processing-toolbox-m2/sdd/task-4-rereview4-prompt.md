You are re-reviewing one task's FOURTH fix round (a fresh implementer). Verdict each item and inspect the fix diff — nothing else.

## The Task

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-4-brief.md. Your round-3 re-review: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-4-rereview3.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.

## The Items Under Verification (controller's ruled mechanism)

- (i) the layerTables invalidation keys on duckdb.ts's engine-death signal (onEngineDeath, re-armed per engine), so a death during initialization also invalidates every ready/building/queued entry.
- (ii) a build's head guard abandons when the entry is already failed "Analytics engine stopped" (the invalidation is the source of truth for queued builds), a death was signalled since enqueue, or the engine generation moved once bound.
- (iii) a pre-ready build binds its generation when initDuckDB resolves and abandons (engine-stopped failure, not a park) when a death occurred since enqueue; parking stays for a boot that never came up without a death.
- (iv) abandon() checks superseded() first — removal owns the entry.
- (v) the replacement test's DESCRIBE needle is distinct per build.
  Tests required: two pre-boot builds, death while the second is queued → second ends failed engine-stopped without initDuckDB/`building`; a build awaiting initDuckDB when the worker dies → failed, not parked; removal + death during a failing build's cleanup → no failed entry recreated.

## The Fix

Read the report (section "## Fix round 4 (fresh implementer)"): /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-4-report.md
**Fix base:** b2ea5e7 **Head:** 52e4e19
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/review-b2ea5e7..52e4e19.diff
Read the diff file once (in chunks). Do not re-run git commands. Read-only; no subagents.

## Scope

Verdict every item. Inspect the fix diff for new problems (the re-arming of a one-shot death signal: can a death be missed between fire and re-arm; the "death since enqueue" flag's lifetime per build; the 26 mock edits). Anything outside the fix diff → Out-of-Scope Observations (the reviewer's earlier out-of-scope items stay out of scope).

## Tests

The implementer re-ran the covering tests and appended results; confirm the report shows them; verify against the diff. Do not re-run the suite.

## Output Format (your entire reply is the report; no preamble)

### Finding Verdicts

**[one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line evidence.

### New Breakage in the Fix Diff

### Out-of-Scope Observations

### Verdict

**Fix round:** [All findings addressed, no new Critical/Important breakage | Findings remain open]
