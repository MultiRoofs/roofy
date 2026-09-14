You are reviewing TWO consecutive tasks' implementations in one pass (the repo owner asked for paired reviews): first whether each matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.

## What Was Requested

Task 23 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-23-brief.md
Task 24 brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-24-brief.md
The plan's front matter that binds both (Global Constraints, verified facts, the "New exported names" ledger, design decisions (c), (f), (g), the copy table): /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md (read the front matter — everything before "## Tasks" — in chunks; then the "Review residuals" section at the very end for the items naming Tasks 23 and 24).
Spec sections: §6 ("What a derived layer is": a derived vector layer is a plain GeoJSON layer; the Aggregate copy holds ALL target areas; export formats per parent kind incl. CityParquet for a reader-backed copy), §6.2 (the row state line "312 buildings · LoD 2.2 · Derived from Delft", "Show run log", "Derived · not saved in workspaces"), §8 Persistence (the snapshot omits a derived layer entirely; the Save toast "1 derived layer is not saved; export it to keep it"; A16 plural; nothing in v4 snapshots or share links), §10 scenarios 10, 11, 12 in /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md.
Global constraints: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/global-constraints.md. Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md.
Controller requirements and rulings for these tasks: Task 23: Aggregate → New layer leaves the original document byte-identical (C1's test); Task 18's mergeGeoDocumentProperties reused (no second merge); publicGeoDocument strips the stable-id envelope (the brief's path leaked \_\_roofy_stable_feature_id — accepted deviation); summariseCreated features null for vector; name lookup in both stores + A15; GeoLayerBase.derivedFrom, GeoLayerInput Omit, addGeoLayer insertAfterId; Undo removes the geo copy / blocked; Aggregate destinations gains "new". Task 24: snapshotLayers.ts is the ONE filter + active-index decision for the workspace save AND the share (C4) covering city AND geo derived layers; A16 toast singular/plural; LayerRow marker, state line, three-state Show run log (undefined vs null preserved); the export offers CityParquet for a reader-backed copy via the sourceFeatureIds WHERE in sql.ts → export.ts → ExportDialog; real test paths (the SQL suite is sqlExport.test.ts — the plan's sqlQuery.test.ts never imports the builder; accepted); the share hash carries no active index by design (v3) — the index assertion lives on the save case (accepted); Ruling: a derived layer dropped from a share link gets NO notice (§8 words the sentence for Save only). Concerns to assess: Show run log decided at render time (a row on screen keeps an enabled item when its run expires).

## What the Implementers Claim They Built

Task 23 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-23-report.md
Task 24 report: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/task-24-report.md

## Diff Under Review

**Base:** a16b25d **Head:** 45baa29 (Task 23's commits first, then Task 24's; the commit list at the top of the diff file says which is which)
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-a16b25d..45baa29.diff
Read the diff file once, in chunks. Do not re-run git commands; inspect files outside the diff only for a concrete named risk (one focused check per risk, and name it): whether a RESTORED workspace (restoreSnapshot/migrateSnapshot) can ever contain a derived layer or a derivedFrom field; whether the share path's layer filtering changed what an ordinary URL-backed layer serialises; whether the CityParquet export of a derived layer reads only the copy's feature roots (the WHERE) and still exports the copy's computed columns; whether Task 23's geo activation/placement matches how a geo layer becomes active today. Note commits 0c7ca2c..64873a2 inside the range are Task 22's already-approved fix round.. Read-only on this checkout; no subagents.

## Do Not Trust the Reports

Verify every claim against the diff. For 23: the original untouched, the copy complete, provenance under the new id, activation/placement, rename, cancel/death, Undo cases. For 24: the one filter decision applied at both sites, the decoded share payload, the toast text, the row surfaces, the export WHERE, and typed fixtures at real paths.

## Tests

Do not re-run the suite; run a focused test file only when the code raises a specific doubt no existing run answers. Judge whether the tests assert BEHAVIOUR (not mocks) and are complete.

## Output Format (your entire reply is the report; no preamble)

### Task 23

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Task 24

#### Spec Compliance

#### Issues

##### Critical (Must Fix)

##### Important (Should Fix)

##### Minor (Nice to Have)

### Cross-task

(anything one task broke or left inconsistent in the other)

### Assessment

**Task 23 quality:** [Approved | Needs fixes] — one sentence
**Task 24 quality:** [Approved | Needs fixes] — one sentence
