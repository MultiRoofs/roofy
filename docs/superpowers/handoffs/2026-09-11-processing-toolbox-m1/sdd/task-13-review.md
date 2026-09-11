### Spec Compliance

- ✅ Toast subscribes to `noticeSeq`, uses the existing toast function, and returns subscription cleanup (`src/app/App.tsx:862`).
- ✅ Successful styling reads the median through `runQuery`, quotes identifiers, creates the required draft with `NEW_RULE_COLOR_HEX`, sets Rules mode before Save, and requests STYLE (`src/ui/processing/RunFooter.tsx:46`, `:59`, `:70`).
- ✅ Uses the first string column with an undefined guard; disables on `summary.measured === 0` with the exact “All values are empty” text (`src/ui/processing/RunFooter.tsx:148`, `:194`).
- ❌ Median failures silently become zero, contrary to the data-derived median requirement (`src/ui/processing/RunFooter.tsx:48`; `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md:442`, `:639`).
- ✅ Open table retains target activation and column appending. ⚠️ Scrolling the new columns into view cannot be verified from this diff (`src/ui/processing/RunFooter.tsx:173`).
- ✅ Added code uses the DuckDB wrapper and existing session draft store, without introducing persistence or a status writer (`src/ui/processing/RunFooter.tsx:23`, `:59`; `src/features/rules/ruleDraftStore.ts:66`).
- ⚠️ Browser editor/Save behaviour remains unverified; the report records the browser check as skipped (`.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-13-report.md:183`). Repository-wide mock completeness cannot be established from this scoped diff.

### Strengths

- SQL identifiers are escaped, and row access respects `noUncheckedIndexedAccess` (`src/ui/processing/RunFooter.tsx:51`, `:53`).
- The asynchronous operation is isolated from rendering and writes the draft before navigation (`src/ui/processing/RunFooter.tsx:43`, `:59`, `:72`).
- The styling test checks SQL and actual store state, including the complete draft, rather than only asserting mocked navigation (`tests/unit/ui/processing/ToolView.test.tsx:470`).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Failed median reads produce a misleading rule.** Missing tables, failed queries, NULL and invalid results all open a normal-looking `> 0` draft without explanation (`src/ui/processing/RunFooter.tsx:48`). Focused failure-contract check: `runQuery` already returns query errors as outcomes (`src/insights/duckdb.ts:388`), so this discards available error information. Preserve the existing draft/navigation on failure and report the failure instead of inventing a median.

- **Layer removal during the await is not checked.** After the query resolves, the handler unconditionally writes a draft and requests STYLE for the captured ID (`src/ui/processing/RunFooter.tsx:59`). Focused navigation check: `requestSection` unconditionally activates that ID and records its section (`src/ui/shell/shellStore.ts:173`). Revalidate the target after awaiting and abandon the operation if it disappeared; test removal with a deferred query.

- **Double clicks can overwrite subsequent editing.** The button remains enabled while its query runs (`src/ui/processing/RunFooter.tsx:197`, `:201`). Two pending calls each replace the whole draft when they complete (`:59`); a delayed second completion can erase edits made after the first opens STYLE. Guard concurrent requests and stale completions, with a deferred-query regression test.

#### Minor (Nice to Have)

- **Repeated-toast test does not verify repetition.** Both notices fire while the first toast is still visible; checking its presence and the store counter also passes if the second notice is ignored (`tests/unit/app/appProcessingToast.test.tsx:138`). Advance fake timers to dismiss the first toast, then verify the identical notice appears again.
- **Disabled-state explanation is only a title.** Keyboard users cannot focus the disabled button to discover the reason (`src/ui/processing/RunFooter.tsx:197`). Provide the same text visibly or through an accessible description.
- **Reported validation contains unresolved noise.** The report lists 56 check warnings without evidence establishing their claimed baseline (`.superpowers/sdd/2026-09-10-processing-toolbox-m1/task-13-report.md:137`). This does not establish a new regression, but it is not clean validation output.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The happy-path wiring matches the controller rulings, but median failures fabricate a result and asynchronous completions lack lifecycle and concurrency guards. These can produce incorrect drafts or navigation during ordinary interaction.
