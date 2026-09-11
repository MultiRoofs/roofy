### Finding Verdicts

1. **Failed/NULL medians no longer create drafts, but first-line error reporting remains incomplete** — NOT ADDRESSED. `src/ui/processing/RunFooter.tsx:107` reports errors and returns; `:115` reports NULL as “All values are empty” and returns. However, `:110` uses `formatDuckDBError`, which joins multiple error lines (`src/insights/duckdb.ts:117–123`). The test supplies only a single-line error (`tests/unit/ui/processing/ToolView.test.tsx:553`).

2. **Removed targets are revalidated after the await** — ADDRESSED. `src/ui/processing/RunFooter.tsx:103–106` silently abandons removed layers before notices, drafts or navigation.

3. **Double-click protection works, but card dismissal does not invalidate the completion** — NOT ADDRESSED. The button disables while pending (`src/ui/processing/RunFooter.tsx:269`), and actual unmount invalidates the token (`:82–87`). However, Run again changes `run` to null without unmounting `RunFooter` (`src/ui/processing/ToolView.tsx:32–37`, `:209–215`), allowing the old completion to write a draft and navigate. The test uses `cleanup()` instead of exercising Run again (`tests/unit/ui/processing/ToolView.test.tsx:619`).

4. **Repeated-toast test dismisses the first toast before repeating it** — ADDRESSED. `tests/unit/app/appProcessingToast.test.tsx:138–158` advances fake timers, asserts absence, then pushes and verifies the identical notice.

5. **Disabled reason is visible and retains its title** — ADDRESSED. `src/ui/processing/RunFooter.tsx:270` retains the title; `:285–286` renders the exact “All values are empty” text as a muted note.

6. **Base and head warning counts are evidenced and equal** — ADDRESSED. `.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-13-report.md:275–277` records 56 warnings at both `fd13eda` and this round’s head.

The report names the covering tests and includes passing output: 8 files / 69 tests (`task-13-report.md:221–254`, `:317–327`). The diff contains those cases, but lacks multiline-error and actual card-dismissal coverage.

### New Breakage in the Fix Diff

- **Important — `src/ui/processing/RunFooter.tsx:82–87`: incomplete lifecycle invalidation.** Start Style by result, click Run again while the query awaits, then resolve it: the retained hook accepts the stale token and opens STYLE. Invalidate on result/run changes and reset pending for the replacement context. The existing `finally` correctly resets pending on current-token exits and avoids updates after actual unmount.
- **Minor — `src/ui/processing/RunFooter.tsx:46–49`, `:110`: unspecified fallback copy.** A missing/not-ready table produces “The query failed.” through the formatter. That string is absent from the specification; being existing application copy does not satisfy the binding verbatim-copy requirement.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** Findings remain open — findings **1** and **3**, plus the unspecified fallback string.
