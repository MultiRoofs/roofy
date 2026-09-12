You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate.

## What Was Requested

Read the task brief: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-5-brief.md
Spec §7 common rules and §7.1 of /data2/hideba/multiroof-viewer/docs/superpowers/specs/2026-09-10-processing-toolbox-design.md; the plan's Design decision (c) table "The six measures" in /data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md is the semantic authority: area sums; flat = strict `inclinationDeg < threshold`; flat share = flat/area (NULL when area 0); mean slope area-weighted over ALL surfaces (NULL when area 0); dominant azimuth = azimuth of the largest-area NON-flat surface, ties to the first, NULL when every surface is flat; surface count; every value NULL when there are no surfaces.
Global constraints: pure module with no imports; signatures `RoofSurfaceMetric`, `RoofRollUp`, `rollUpRoofSurfaces(surfaces, flatThresholdDeg)` verbatim (Tasks 7 and 9 consume them); tests import from "vitest"; noUncheckedIndexedAccess; lint baseline 56 warnings.

## What the Implementer Claims They Built

Read: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/task-5-report.md

## Diff Under Review

**Base:** bc61764 **Head:** 82b10c2
**Diff file:** /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-11-processing-toolbox-m2/review-bc61764..82b10c2.diff
Read the diff file once. Do not re-run git commands. Read-only; no subagents.

## Do Not Trust the Report

Verify against the diff and the semantic table above. Check every NULL rule and the strict threshold against the table; check tie-breaking; check numeric edge cases (negative or NaN areas, an inclination exactly at the threshold, an empty array, a single surface).

## Tests

Do not re-run the suite; a focused test file only when the code raises a specific doubt.

## Output Format (your entire reply is the report; no preamble)

### Spec Compliance

### Strengths

### Issues

#### Critical (Must Fix)

#### Important (Should Fix)

#### Minor (Nice to Have)

### Assessment

**Task quality:** [Approved | Needs fixes]
**Reasoning:** [1-2 sentences]
