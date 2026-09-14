You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 27 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-27-brief.md
Task 28 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-28-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (j), and the front matter's engine facts, the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 27 and 28).
Spec sections: §6.2 ("Open table … scrolled into view"; Undo), §6.4 (the log as a reproducible record: the SQL statements issued in order), §7 (a table rebuild marks the run stale; the synthetic drawer columns stay), §7.1 (the drawer's Roof area vs roof_area_m2), §8; copy A8 and A10 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 27: the write step's SQL logged as `Writing results (n/N)` entries through ONE shared recorder used by the This-layer write AND the derived write (Task 21's recordWrite?, created here), COMMIT recorded before invocation and ROLLBACK only when issued, failure paths asserted; the reveal channel retains the latest request per layer until a rendered header acknowledges it (listener returns boolean), replaces pending, deletes on ack, DataGrid drains on [reveal, columns, rows]; A8 verbatim on the synthetic Roof area header; the version-aware sweep tracks builtVersions vs pendingVersions (a failed rebuild clears pending; an unchanged version enqueues nothing); the vector Style-by-result undone guard folded in; flagged by the implementer: an unguarded scrollIntoView (jsdom stub) — assess whether production needs `el.scrollIntoView?.()`; two 'Writing results' entries still un-numbered — assess. Task 28: docs only — roadmap 13.3 entry + Carried to M4; architecture notes M13.3 section with D1–D10 and their guards; fixtures README rows; CLAUDE.md unchanged (confirmed); the docs match the CORRECTED retryEngine (generation bound after the boot starts); every claim must be true of the code (spot-check at least eight file/function names the notes cite). Commits c8ac596/c35a6a0 in the range are Task 25's approved fix.

## What the Implementers Claim They Built

Task 27 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-27-report.md
Task 28 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-28-report.md

## Diff Under Review

**Base:** ca4cb79 **Head:** 910a06c (Task 27's commits first, then Task 28's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-ca4cb79..910a06c.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether the shared recorder changed the M1 log shape for Height from extent / Roof metrics runs (their existing log tests); whether the version-aware sweep can starve a legitimately changed stream (a version that moved during a pending build); whether the reveal channel leaks listeners across grid switches. Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 27: the recorder's statement list on success and failure (COMMIT present on a failed COMMIT, ROLLBACK only when issued), the reveal A→B case, the sweep's three cases, A8's exact text, the undone guard. For 28: eight+ spot-checks of names/paths against the code; every D-fact's consequence stated correctly; the carried list complete against the ledger.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 27

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 28

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 27 quality:** [Approved | Needs fixes] — one sentence
**Task 28 quality:** [Approved | Needs fixes] — one sentence
