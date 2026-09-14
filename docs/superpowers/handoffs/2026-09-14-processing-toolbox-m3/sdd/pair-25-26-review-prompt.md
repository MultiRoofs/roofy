You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 25 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-25-brief.md
Task 26 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-26-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (h), (i), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 25 and 26).
Spec sections: §6.1 ("Analytics engine stopped"; Undo after an engine death), §6.2 (Style by result: "The map does NOT change until the user presses Save in the editor, as with any rule"; "the next palette colour"; Undo semantics), §5/§8 (nothing new persisted); CLAUDE.md's duckdb.ts rules (sole importer, ONE status writer, retryEngine is the door) and the brand's colour collision rule in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 25: design (h) — the six primitives race the death INSIDE duckdb.ts and return their ordinary failure values, no new export/no mock sweep; the run queue's EngineDeadError ordering pinned; retryEngine binds its generation AFTER the boot starts and an ordinary reboot still rebuilds parked tables; undoRun's post-COMMIT death short-circuits publication (C9 timing: trace cleared before Undo, a dedicated refresh gate) — Ruling: the card stays done with no Undo (engineStopped flag), not a failed record; off-queue callers (export dialog/writer, counts, median) settle through their real modules; residuals ruled to the roadmap: queryParquetBuffer's VFS awaits and ensureExtension's in-flight INSTALL/LOAD. Task 26: RULE_PALETTE_HEX (#7cb518 then #2563eb #c2410c #7e22ce #0f766e #be185d #b45309 #15803d) + nextRuleColor, both defaultRuleFormValues and Style by result use it; the collision test extended incl. no overlap with CATEGORY_PALETTE_HEX; RunFooter no longer writes colorBy at draft open; C6 ruling — a Style-by-result draft's Save switches to Rules from ANY mode, a manual rule keeps ensureRulesMode; C10 openAddForm reads current rules at click time; C7 complete tests; the undone-run median guard; DEVIATION to assess: StyleSection's editor gate widened to colorBy === "rules" || draftOpen so the draft is visible/saveable before the mode flips (outside the brief's file list). Note commits 6069e8e and 561049a in the range are Task 24's approved fix.

## What the Implementers Claim They Built

Task 25 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-25-report.md
Task 26 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-26-report.md

## Diff Under Review

**Base:** 45baa29 **Head:** ca4cb79 (Task 25's commits first, then Task 26's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-45baa29..ca4cb79.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether racing inside the primitives changed any behaviour for a HEALTHY engine (timing, ordering, a resolved value) — the M1/M2 suites must be untouched; whether markEngineDead's synchronous listener order still lets raced() win (the pinned test); whether the widened StyleSection gate can show an editor for a non-rules layer without a draft (must not); whether the palette colours are byte-distinct from every reserved colour. Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 25: each primitive's failure value on death, the retryEngine generation test proving an ordinary reboot rebuilds, the C9 timing in the undoRun test, the six callers' settlement. For 26: the rotation (first unused palette colour; wrap), no map change before Save for surface and single, the mode flip at Save for a Style-by-result draft only, the click-time rules read, the collision test, the undone guard.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 25

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 26

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 25 quality:** [Approved | Needs fixes] — one sentence
**Task 26 quality:** [Approved | Needs fixes] — one sentence
