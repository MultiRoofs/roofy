You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-13-brief.md
The spec is the authority: /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md (§6.2 Done: toast, Open table, Style by result; §7.4).
Controller rulings that are part of the requirements: (a) the draft's colour is the editor's default new-rule colour NEW_RULE_COLOR_HEX (the app has no rule-colour palette sequence); (b) "All values are empty" gates on summary.measured === 0; (c) colorBy "rules" is set eagerly (spec letter); (d) facts on this checkout: RunRecord.columns is ReadonlyArray<string>; the store-level rule draft is useRuleDraftStore.setDraft(layerId, {editingId:null, open:true, form}); STYLE via useShellStore.requestSection(layerId,"style"); the median through runQuery from src/insights/duckdb.ts with the table name from the layer-table store.

Global constraints that bind: `src/insights/duckdb.ts` is the ONLY importer of `@duckdb/duckdb-wasm`; every `vi.mock(".../insights/duckdb")` factory must export every function the module under test imports; test files import from "vitest"; every user-visible string verbatim from the spec ("All values are empty"); ONE writer of the DuckDB status; noUncheckedIndexedAccess; nothing new persisted.

## What the Implementer Claims They Built

Read the implementer's report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-13-report.md

## Diff Under Review

**Base:** e658bf2 **Head:** fd13eda
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/review-e658bf2..fd13eda.diff
Read the diff file once; its context lines are the changed files. Do not re-run git commands; do not crawl the codebase — inspect outside the diff only to evaluate a concrete named risk (one focused check per risk, named in the report). Read-only on this checkout. Do not dispatch subagents.

## Do Not Trust the Report

Verify claims against the diff; rationales never downgrade a finding.

## Tests

The implementer ran the tests and reported results with TDD evidence. Do not re-run the suite; a focused test file only when the code raises a specific doubt. Noise in reported test output is a finding.

## Part 1: Spec Compliance — Missing / Extra / Misunderstood; ⚠️ for what the diff alone cannot show.

## Part 2: Code Quality — separation of concerns, error handling (the async click handler: median failure, layer removed mid-await, double click), edge cases, tests verify real behaviour not mocks, file growth.

Cite file:line for every finding and every check.

## Calibration

Important = incorrect/fragile behaviour, a missed requirement, or maintainability damage you would block a merge over; polish is Minor; plan-mandated defects are Important, labeled plan-mandated.

## Output Format (your entire reply is the report; no preamble)

### Spec Compliance

- ✅ | ❌ with file:line; ⚠️ Cannot verify from diff

### Strengths

### Issues

#### Critical (Must Fix)

#### Important (Should Fix)

#### Minor (Nice to Have)

### Assessment

**Task quality:** [Approved | Needs fixes]
**Reasoning:** [1-2 sentences]
