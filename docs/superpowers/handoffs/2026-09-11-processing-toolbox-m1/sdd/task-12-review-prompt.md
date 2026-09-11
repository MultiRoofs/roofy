You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-12-brief.md
Dispatch addendum from the controller (part of the requirements): computed columns must be in the drawer's DEFAULT visible column set (spec §8 "on by default in the column chooser"; §6.2 "Open table opens the drawer on the target with the new columns appended after the existing ones").
The spec is the authority: /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md (§7 common rules on provenance, §8).

Global constraints from the spec/design that bind this task:

- `src/insights/duckdb.ts` is the ONLY importer of `@duckdb/duckdb-wasm`; every module takes the engine through its exports. No new duckdb.ts exports in this milestone.
- Test files import from `"vitest"`, never `"vite-plus/test"`.
- UI: Soft Utility tokens from `src/app/flatControls.css` (`--control-radius` 8px, `--control-height` 38px, `--control-height-compact` 30px). Reuse `ActionIcon`.
- Copy: every user-visible string comes from the spec verbatim. Spec §7: provenance tooltip "Measure solids · LoD 2.2 · 2026-09-10 14:02"; partial: "312 of 1,204 buildings in this run; the rest from Measure solids · 13:40". Spec §8: Details lists computed columns "under a mono sub-heading COMPUTED, each with the badge and provenance tooltip"; table: "columns appear after the file's columns, badge in the header cell, on by default in the column chooser"; rules: "the attribute select lists computed columns in a COMPUTED optgroup; presets are unchanged".
- Features, not rows: a BuildingPart never counts as a building.
- Nothing new is persisted (snapshot schema v4 untouched).
- `tsconfig` has `noUncheckedIndexedAccess`.

## What the Implementer Claims They Built

Read the implementer's report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-12-report.md

## Diff Under Review

**Base:** 2df6d33
**Head:** e3cf64f
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-10-processing-toolbox-m1/review-2df6d33..e3cf64f.diff

Read the diff file once — it contains the commit list, a stat summary, and the full diff with surrounding context, and it is your view of the change. The diff's context lines ARE the changed files: do not read a changed file separately unless a hunk you must judge is cut off mid-function — and say so in your report. Do not re-run git commands. Do not crawl the broader codebase. Inspect code outside the diff only to evaluate a concrete risk you can name — one focused check per named risk, and name both the risk and what you checked in your report. Cross-cutting changes are legitimate named risks: if the diff changes a function or API contract or shared mutable state, checking the call sites is the right method.

Your review is read-only on this checkout. Do not mutate the working tree, the index, HEAD, or branch state in any way.

## Do Not Trust the Report

Treat the implementer's report as unverified claims about the code. Verify the claims against the diff. Design rationales in the report are claims too. Judge the code on its merits — a stated rationale never downgrades a finding's severity. Two implementer concerns you must weigh explicitly: (a) the Details sub-heading renders "Computed" (sentence case, matching the viewer shell's peers) instead of the spec's "COMPUTED"; (b) a user-customised column list does not gain later computed columns; (c) streaming layers get the table badge but no Details/rules entries.

## Tests

The implementer already ran the tests and reported results with TDD evidence. Do not re-run the suite. Run a test only when reading the code raises a specific doubt that no existing run answers — and then a focused test file only. Warnings or other noise in the implementer's reported test output are findings.

## Part 1: Spec Compliance

Compare the diff against What Was Requested: Missing (skipped, missed, claimed without implementing), Extra (unrequested features, over-engineering), Misunderstood (right feature built the wrong way). If a requirement cannot be verified from this diff alone, report it as a ⚠️ item.

## Part 2: Code Quality

Separation of concerns, error handling, DRY without premature abstraction, edge cases; do the new tests verify real behaviour, not mocks; file responsibilities; growth of already-large files contributed by this change.

Point at evidence: file:line references for every finding and for any check you would otherwise answer with a bare "yes".

## Calibration

Important means this task cannot be trusted until it is fixed: incorrect or fragile behaviour, a missed requirement, or maintainability damage you would block a merge over. "Coverage could be broader" and polish are Minor. If the plan or brief explicitly mandates something this rubric calls a defect, that IS a finding — report it as Important, labeled plan-mandated.

## Output Format (your entire reply is the report; no preamble)

### Spec Compliance

- ✅ Spec compliant | ❌ Issues found: [with file:line]
- ⚠️ Cannot verify from diff: [...]

### Strengths

### Issues

#### Critical (Must Fix)

#### Important (Should Fix)

#### Minor (Nice to Have)

For each issue: file:line, what's wrong, why it matters, how to fix.

### Assessment

**Task quality:** [Approved | Needs fixes]
**Reasoning:** [1-2 sentences]
