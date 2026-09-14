You are RE-REVIEWING one small fix (round 3) of Roofy's processing toolbox Milestone 3 gate. Scoped: only whether your last re-review's F5 regression (a same-object re-pick after activating the vector layer left the vector active) is resolved without breaking the earlier rule (hover and tool-mode updates must NOT re-activate the city layer).

Your last re-review: /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/final-fixwave-rereview.md
The implementer's report ("Round 3"): /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/fixwave-1-report.md
The diff (base c5af99f, head bac1a42): /data2/hideba/multiroof-viewer/.superpowers/sdd/2026-09-12-processing-toolbox-m3/review-c5af99f..bac1a42.diff — read it once. Read-only; no git commands; no subagents; do not re-run the suite. One named check outside the diff if needed: whether any other subscriber of the selection store could be affected by the new `selectionVersion` field (e.g. a snapshot or a persisted shape).
Output: "### Findings" (Resolved/Partly/Unresolved with evidence), "### Regressions" (or none), "### Assessment — Approved | Needs fixes" with one sentence.
