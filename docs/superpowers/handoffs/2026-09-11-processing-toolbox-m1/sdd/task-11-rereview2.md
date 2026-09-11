### Finding Verdicts

**Finding 3: older-run editing and status-blind dismissal** — ADDRESSED. `src/ui/processing/RecentRuns.tsx:97` writes the draft before calling `dismissDoneRun` at line 111; `src/features/processing/processingStore.ts:148` selects the latest matching pair and line 151 dismisses it only when done.

**Important breakage: Edit & run unlocks an active run** — ADDRESSED. `src/ui/processing/ToolView.tsx:34` suppresses only dismissed DONE cards; line 42 preserves queued/running/cancelling locks and excludes failed cards. `src/features/processing/processingStore.ts:151` prevents active-run dismissal.

The report names covering tests matching the diff, supplies RED errors for cases a/b/c, and reports GREEN output: 122 targeted tests and 2,788 full-suite tests passing. The added transition assertion verifies dismissal takes effect upon DONE. Tests were not rerun.

### New Breakage in the Fix Diff

None.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage — no open findings.
