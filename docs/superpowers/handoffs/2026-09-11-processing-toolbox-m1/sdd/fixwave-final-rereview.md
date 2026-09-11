### Finding Verdicts

**[F1 — Canonical spelling and Undo ownership]** — ADDRESSED. `src/features/processing/runQueue.ts:188` canonicalises output columns and row keys before SQL, model merging and provenance updates. Ownership comparisons ignore case at line 624; completed `run.columns` use canonical names at line 666. The added unit and real-DuckDB tests cover the mixed-case replacement.

**[F2 — Preserve terminal outcomes after layer removal]** — ADDRESSED. `src/features/processing/runQueue.ts:251` rejects status-bearing patches after failed/cancelled outcomes. Final publication checks the stored status before retaining Undo or emitting a notice (line 677). Running → failed, cancelling → cancelled and cancelling → done-with-note remain permitted. Undo and stale marking remain permitted at lines 788 and 875 because they carry no status. Deferred-refresh and scope-query regressions cover the reported races.

**[F3 — Export computed attributes into CityParquet]** — ADDRESSED. `src/insights/sql.ts:709` separates computed attributes and joins their layer-table values by object `id`; an empty computed list emits no join. Source attributes retain their reader path, and parts receive their own values. Plumbing reaches the builder through `src/ui/table/ExportDialog.tsx:364` and `src/insights/export.ts:572`. `tests/integration/duckdb/layerTables.test.ts:789` checks both joined rows and values read from the written package.

**[F5 — Restore Run after editing a failed request]** — ADDRESSED. `src/features/processing/processingStore.ts:172` dismisses failed cards on draft edits; line 199 supports explicit dismissal of done or failed runs. `src/ui/processing/ToolView.tsx:32` suppresses those dismissed cards, while in-flight cards retain their lock and progress controls. Recent runs uses the updated action at `src/ui/processing/RecentRuns.tsx:112`.

**[F6 — Mark failures unseen unless Tools is visible]** — ADDRESSED. `src/features/processing/processingStore.ts:119` requires open Tools, the Tools tab and an expanded panel. Visibility setters clear the indicator appropriately. `src/ui/shell/shellStore.ts:145` mirrors collapse changes into the feature store, preserving the UI → features import direction.

**[F7 — Refresh the roadmap]** — ADDRESSED. `docs/roadmap.md:626` removes resolved carryovers and records the required remaining work, including engine-death recovery. CityParquet computed export is correctly omitted from deferred work.

**[F5 concern — Dismissing the destination pair’s failed card on target change]** — ACCEPTABLE. Target selection explicitly edits the tool’s shared draft (`src/ui/processing/ToolView.tsx:118`, `src/ui/processing/useToolForm.ts:181`). Applying dismissal to the resulting pair follows the brief’s “any form field” rule and permits submitting that changed request. It hides only the footer card; the failed run, error, Log and Retry remain in Recent runs. Merely opening the form does not dismiss it.

The report names the covering tests and provides failure excerpts and GREEN results matching the diff. It includes full-suite output of **2,834 passed** and reports **31 passed** for opt-in DuckDB integration (`fixwave-final-report.md:337`). F3 explicitly discloses that its RED evidence was reconstructed after implementation, contrary to the required red-first sequence. No tests were rerun for this review.

### New Breakage in the Fix Diff

None. No new user-visible copy violations, prohibited DuckDB imports or non-Vitest test imports were introduced.

### Out-of-Scope Observations

None.

### Verdict

**Fix wave:** All findings addressed, no new Critical/Important breakage — no open findings.
