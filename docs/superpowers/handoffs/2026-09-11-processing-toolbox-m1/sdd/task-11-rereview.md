### Finding Verdicts

1. **Failed Retry submits the frozen request** — ADDRESSED. `src/ui/processing/RunFooter.tsx:170` calls `submitRun(requestFromRun(run))`; the invalid-draft regression is covered in `tests/unit/ui/processing/ToolView.test.tsx:361`.

2. **Queue messaging appears only for queued runs** — ADDRESSED. `src/ui/processing/ToolView.tsx:50` gates the note by status; `:204` preserves Run eligibility while another tool executes.

3. **Locking and store-level dismissal satisfy the amended ruling** — NOT ADDRESSED. `src/ui/processing/RecentRuns.tsx:106` dismisses only the clicked run, but `src/ui/processing/useToolForm.ts:172` selects the latest run for that tool/target. Editing an older run therefore still opens locked beneath a newer DONE card. Additionally, `src/ui/processing/ToolView.tsx:28` suppresses dismissed runs regardless of status, bypassing in-flight locking.

4. **One pure registry builder supplies output names, with equality coverage** — ADDRESSED. `src/features/processing/toolRegistry.ts:59`, `src/features/processing/tools/heightFromExtent.ts:55`, and `src/ui/processing/useToolForm.ts:139` share the builder. `tests/unit/features/processing/heightFromExtent.test.ts:200` compares the declaration, executor columns, and written row keys.

5. **Targets use per-layer eligibility and preserve a chosen ineligible target** — ADDRESSED. `src/ui/processing/useToolForm.ts:86` filters through `toolEligibility`; `src/ui/processing/useEligibilityContext.ts:39` provides the pure context builder; `src/ui/processing/ToolView.tsx:62` retains the chosen option.

6. **Positive Matching coverage with an applied filter** — ADDRESSED. `tests/unit/ui/processing/ToolView.test.tsx:215` applies a filter, selects enabled “Matching 312”, and verifies submission.

7. **Back-button rules merged and compact token used** — ADDRESSED. The single rule at `src/ui/processing/processing.css:196` uses `var(--control-height-compact)` for all three dimensions.

8. **Queued footer precedence is explicit and tested** — ADDRESSED. `src/ui/processing/ToolView.tsx:57` prevents draft-reason fallback, including when no predecessor is running; coverage starts at `tests/unit/ui/processing/ToolView.test.tsx:441`.

9. **Progress announcements and duplicate warning keys** — ADDRESSED. `src/ui/processing/RunFooter.tsx:62` announces phase changes politely; `src/ui/processing/LogView.tsx:109` distinguishes repeated warnings. Regression coverage appears in `tests/unit/ui/processing/LogView.test.tsx:65`.

The report names covering tests and includes failure/pass output, including the addendum’s processing-test result. The assertions support the addressed findings; the dismissal test at `tests/unit/ui/processing/RecentRuns.test.tsx:176` checks membership only, missing finding 3’s interaction failures. Tests were not rerun.

### New Breakage in the Fix Diff

- **Important — `src/ui/processing/RecentRuns.tsx:106`, `src/ui/processing/ToolView.tsx:28`:** Clicking **Edit & run** on the latest queued/running/cancelling run dismisses that active run. The form then unlocks, progress and cancellation controls disappear, and Run becomes available while the original run remains active. Dismissal must not suppress in-flight state.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** Findings remain open — **3**; the dismissal change also introduces Important breakage described above.
