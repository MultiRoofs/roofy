You are re-reviewing a FIX WAVE: the source fixes for a milestone review's findings. Verdict each finding and inspect the fix diff — nothing else.

## Context

Spec (authority): /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md (§4.2, §6, §6.1–6.3, §7 common rules, §7.4, §8). Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.

## The Findings Under Verification

Read the brief, which quotes each finding and states the controller's required change: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/fixwave-1-brief.md — items M1, M2, M4, M5, M6, m8, m10, m11, S1, S2. Plus the test items forwarded afterwards: T1 (runQueue.test.ts Undo-takeover race test must gate on run 2 actually starting), T2 (part-extent test with differing parts + a bbox-less part), T3 (queue-level Retry test proving the ORIGINAL selected ids are reused after the selection changed), T4 (cancel test gating the UPDATE, asserting ROLLBACK, no COMMIT, unchanged table/model/provenance), T5 (ToolView error test uses the production formatter via vi.importActual). Plus two closing items: requestFromRun removed (dead code); a post-wave browser re-check appended to scripts/smoke/processing-m1.md.
Parked by the controller (do not re-open): matching ids resolved at the queue head; write-step SQL in the log; scroll-into-view; streaming Details/rules; case-sensitive registry/model keying after a mixed-case replace (recorded); no statement-level DuckDB cancel; the removal watcher covering the target only.

## The Fix

Read the implementer's report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/fixwave-1-report.md
**Fix base:** 95256ec **Head:** 2a8fa2f **Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/review-95256ec..2a8fa2f.diff
Read the diff file (it is large; read it in sequential chunks to the end). Do not re-run git commands. Read-only on this checkout. Do not dispatch subagents.

## Scope

Verdict every item (M1, M2, M4, M5, M6, m8, m10, m11, S1, S2, T1–T5, the two closing items). Inspect the fix diff for new problems it introduced — especially: the layer-removal watcher's installation/disposal and its interaction with the queue head's own "Layer removed" check; the abort check before COMMIT (ROLLBACK issued exactly once, backup table dropped, no double patch of the run); retryRun's snapshot copy and undo bookkeeping; the case-insensitive collision check against the registry; part rows' own extents vs the feature accounting. Anything entirely outside the fix diff → Out-of-Scope Observations (non-blocking). Binding: every user-visible string verbatim from the spec; no @duckdb/duckdb-wasm import outside src/insights/duckdb.ts; test files import from "vitest".

## Tests

The implementer re-ran the covering tests and the full suite and reported results with RED/GREEN per item; confirm the report names them and shows output; verify against the diff. Do not re-run the suite; a focused test file only if the code raises a specific doubt.

## Output Format (your entire reply is the report; no preamble)

### Finding Verdicts

For each item, in order: **[id — one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line evidence.

### New Breakage in the Fix Diff

Severity (Critical/Important/Minor) and file:line, or "None".

### Out-of-Scope Observations

Non-blocking; or "None".

### Verdict

**Fix wave:** [All findings addressed, no new Critical/Important breakage | Findings remain open] — list the open ones.
