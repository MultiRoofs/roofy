You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 21 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-21-brief.md
Task 22 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-22-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (f), (g), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 21 and 22).
Spec sections: §3 (Destination, derived layer), §6 OUTPUT ("What a derived layer is": the copy holds the SCOPED features with geometry at every LoD, all attributes, inherited computed columns keeping provenance; reader-backed via the parent source filtered to the ids; independent of its parent from publication on; name re-check at publication " (2)" and the card says so), §6.1 (publication as the LAST step, the cancel boundary), §6.2 (the done card for a New-layer run: "Created Delft · solids · 312 buildings · …", Zoom to layer, Open table, Style by result on the copy; Undo removes the layer, blocked with "Used by a later run; remove the layer from the layer list instead"; "Edit {SPEC_SECTIONS} run"), §6.4 (the log header, A7), §10 scenarios 10 and 12 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 21: the copy is cut from the parent TABLE (CTAS by feature roots) with sourceFeatureIds as reader metadata; nextTableName/adoptLayerTable inside the FIFO slot, no nested enqueue (behavioural test); Layer.derivedFrom REQUIRED (22-file sweep as a chore commit); subset bbox recomputed, selectedLod + lodMode copied; bounds test locates copies by publish() id; the stale watcher does not fire on the copy's first ready entry; publish() last, discard() never after publish(); the runQueue partial: line. Task 22: C1 CRITICAL — the New-layer dispatch sits BEFORE both This-layer publications (verify the exact position and that no This-layer write can run for a "new" run); C3 start(run, column: OutputColumn, descriptor) with only the layer-id expression changed; C2 RunRecord.destination/newLayerName restored by Edit {REQUIREMENTS} run; C6 name lookup in both stores, summariseCreated features number|null; destinations gains "new" on the six city tools, Aggregate keeps ["layer"] with the head guard; Undo removes the layer OUTSIDE the FIFO; newLayerUndoBlock from a fresh getState; Zoom to layer via shellStore.requestZoom served by App; A7 log row; A15 card line; the implementer's deviations: no try/catch around publication (discard unreachable after publish) — assess; RecentRuns' Undo row shows no block reason (the queue refuses silently) — assess against §6.2; newLayerUndoBlock counts failed/cancelled later runs (brief-inherited) — assess.

## What the Implementers Claim They Built

Task 21 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-21-report.md
Task 22 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-22-report.md

## Diff Under Review

**Base:** 48884b9 **Head:** a16b25d (Task 21's commits first, then Task 22's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-48884b9..a16b25d.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether a "new" run on a CityGML/CityParquet parent (flat table, no reader) still produces a browsable copy with reader: null; whether the copy's provenance copy + the run's own provenance are both under the NEW id and none leaks to the parent; whether Undo of a New-layer run after the user renamed the copy still removes the right layer; whether App's explicit serialisation list still omits derivedFrom (not persisted by construction). Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 21: the CTAS text, the root-id filter, the model subset (parts included, every LoD), bbox recomputation, adoptLayerTable seeding ready, the FIFO behaviour. For 22: the branch point position, target table untouched, the rename at publication and its card line, cancel/death before publish leaving nothing visible, the Undo block cases, Edit {VERIFY} run, the card actions pointing at the copy, and that the tests drive the REAL queue and stores.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 21

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 22

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 21 quality:** [Approved | Needs fixes] — one sentence
**Task 22 quality:** [Approved | Needs fixes] — one sentence
