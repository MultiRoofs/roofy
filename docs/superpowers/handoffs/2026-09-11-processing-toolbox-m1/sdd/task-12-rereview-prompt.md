You are re-reviewing one task's fix round. A previous review produced findings; an implementer has attempted to fix them. Verdict each finding and inspect the fix diff — nothing else.

## The Task

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-12-brief.md (plus the dispatch addendum: computed columns are visible by default in the drawer). The spec is the authority: /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md (§6.2 Open table, §7 provenance, §8).

## The Findings Under Verification

- (1) Important: a customised column list never gains later computed columns (TablePanel.tsx:236/243). Ruled fix: Open table (RunFooter) appends the run's output columns to the layer's visible column order when one is set (no duplicates, idempotent), via a small pure helper next to defaultColumns; nothing when the list is null; tests for the helper and the click.
- (2) Important: "Computed" must read "COMPUTED" in the Details sub-heading (mono font, overriding workspace.css's sentence-case reset for this heading only) and in the rules optgroup label; assertions updated to the literal.
- (3) Minor: columnPolicy test exercises the base-name collision in buildings mode (appears once, last).
- NOT in scope (parked by the controller): streaming (FCB) layers' Details/rules entries.

## The Fix

Read the implementer's report (fix report appended at the end, "Fix round 1 (2026-09-11)"): /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-12-report.md
**Fix base:** eb241cf **Head:** 73eb8d6 **Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/review-eb241cf..73eb8d6.diff
Read the diff file once. Do not re-run git commands. Read-only on this checkout. Do not dispatch subagents.

## Scope

Verdict every finding. Inspect the fix diff for new problems the fix itself introduced. Anything entirely outside the fix diff goes under Out-of-Scope Observations (non-blocking). Binding constraints: every user-visible string verbatim from the spec; test files import from "vitest"; no @duckdb/duckdb-wasm import outside src/insights/duckdb.ts; noUncheckedIndexedAccess.

## Tests

The implementer re-ran the covering tests and appended results. Confirm the fix report names the covering tests and shows output; verify against the diff. Do not re-run the suite; a focused test file only if the code raises a specific doubt.

## Output Format (your entire reply is the report; no preamble)

### Finding Verdicts

For each finding, in order: **[one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line evidence.

### New Breakage in the Fix Diff

Severity and file:line, or "None".

### Out-of-Scope Observations

Non-blocking; or "None".

### Verdict

**Fix round:** [All findings addressed, no new Critical/Important breakage | Findings remain open] — list the open ones.
