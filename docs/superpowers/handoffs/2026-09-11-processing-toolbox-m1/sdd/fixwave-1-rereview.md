### Finding Verdicts

- **[M1 — Cancel before COMMIT rolls back]** — ADDRESSED. `src/insights/computedColumns.ts:184` checks the signal, issues one ROLLBACK and returns cancelled; transactional rollback removes the backup. `src/features/processing/runQueue.ts:495` maps this to cancellation.
- **[M2 — Target removal terminates its runs]** — NOT ADDRESSED. Installation and disposal are implemented (`src/app/App.tsx:850`, `src/features/processing/runQueue.ts:724`), but subsequent scope failure or successful publication can overwrite the watcher’s terminal state (`runQueue.ts:390`, `runQueue.ts:581`). See below.
- **[M4 — Retry preserves the original snapshot]** — ADDRESSED. `src/features/processing/runQueue.ts:211` requeues the stored request under a new ID and refreshes the table identity; snapshot eviction accompanies undo cleanup at `runQueue.ts:257`. Both UI entry points call `retryRun`.
- **[M5 — Case-insensitive source collisions]** — ADDRESSED. Both form and queue compare table and registry names case-insensitively (`src/ui/processing/useToolForm.ts:124`, `src/features/processing/runQueue.ts:356`); replacement classification follows suit at `runQueue.ts:469`.
- **[M6 — Parts receive their own extents]** — ADDRESSED. `src/features/processing/tools/heightFromExtent.ts:140` distinguishes root roll-up from part extent; accounting remains per feature.
- **[m8 — Collapsed pills select their respective tabs]** — ADDRESSED. `src/ui/shell/ViewerShell.tsx:35` selects the tab before expansion; both pills use it.
- **[m10 — OUTPUT displays its destination]** — ADDRESSED. `src/ui/processing/ToolView.tsx:189` renders “Write to” and the checked, disabled “This layer (…)” radio.
- **[m11 — Progress and queued buttons read Cancel]** — ADDRESSED. `src/ui/processing/RunFooter.tsx:203` and `:223` retain the accessible label while displaying “Cancel”.
- **[S1 — Style draft has a saveable name]** — ADDRESSED. `src/ui/processing/RunFooter.tsx:134` initializes the name from the column.
- **[S2 — Toolbox-only panel can collapse]** — ADDRESSED. `src/ui/header/WorkspaceHeader.tsx:198` enables the chevron when the toolbox is open.
- **[T1 — Undo race waits for run 2]** — ADDRESSED. `tests/unit/features/processing/runQueue.test.ts:797` clears prior SQL before submission, waits for the gated COMMIT and asserts run 2 is running.
- **[T2 — Differing parts and bbox-less part]** — ADDRESSED. `tests/unit/features/processing/heightFromExtent.test.ts:103` checks distinct root/part values, NULL values and feature accounting.
- **[T3 — Queue Retry uses original selected IDs]** — ADDRESSED. `tests/unit/features/processing/runQueue.test.ts:481` changes selection after failure and checks the retried SQL and executor inputs.
- **[T4 — Cancel gates UPDATE and verifies unchanged state]** — ADDRESSED. `tests/unit/features/processing/runQueue.test.ts:845` gates UPDATE and asserts ROLLBACK, no COMMIT, unchanged columns, absent model value and empty provenance.
- **[T5 — Error test uses production formatter]** — ADDRESSED. `tests/unit/ui/processing/ToolView.test.tsx:24` imports the formatter through `vi.importActual`; the error test uses it at `:600`.
- **[Closing — Remove requestFromRun]** — ADDRESSED. The deletion hunk at `src/ui/processing/useToolForm.ts:37` removes the function, helper and unused imports; no references remain in the checked source/tests.
- **[Closing — Append browser re-check]** — ADDRESSED. `scripts/smoke/processing-m1.md:272` records the post-wave browser setup and five passing checks.

The implementer report names the covering tests and includes RED/GREEN or mutation-failure evidence and output summaries. Its “Final checks” reports **232 files passed, 2 skipped; 2817 tests passed, 29 skipped**, followed by closing-item validation. These are reported results, not independently rerun. The diff’s test imports use `vitest`; it introduces no forbidden DuckDB import.

### New Breakage in the Fix Diff

- **Important — `src/features/processing/runQueue.ts:724`, interacting with `:578–590`:** Remove the target while `refreshLayerTableColumns` is pending. The new watcher marks the still-running card failed with “Layer removed” and aborts it. When refresh resolves, execution unconditionally patches it back to **done**, enables Undo and publishes a success notice for the removed layer. The same overwrite can occur when removal lands during COMMIT. The catch-only `failedAlready` guard cannot protect this successful continuation. Preserve the removal outcome and clean up unusable undo resources.

- **Minor — `src/features/processing/runQueue.ts:400`, interacting with `:390–396`:** Removal during scope resolution is protected only when resolution succeeds. If the pending scope query returns a failure, its message overwrites “Layer removed” before the new abort guard executes. Check the watcher’s terminal state immediately after awaiting scope resolution.

### Out-of-Scope Observations

None.

### Verdict

**Fix wave:** Findings remain open — **M2**.
