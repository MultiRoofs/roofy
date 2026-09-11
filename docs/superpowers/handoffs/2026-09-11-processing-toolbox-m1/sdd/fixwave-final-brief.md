# Final fix wave — findings of the whole-branch review (M13.1)

Spec: docs/superpowers/specs/2026-09-10-processing-toolbox-design.md. TDD, red first, per item. Each item is a controller ruling; the reviewer's words are quoted.

## F1 (Important) — mixed-case replacement breaks model consistency and Undo ownership

"SQL collision detection treats identifiers case-insensitively, but model attributes, provenance, and ownership comparisons still use exact spelling. Run with `extent_`, then `EXTENT_`: DuckDB replaces the same columns, while the model and registry acquire separate keys and the earlier run retains Undo. Undoing that earlier run can drop columns owned by the newer run." (`src/features/processing/runQueue.ts` ~512, ~522, ~550)
REQUIRED: before writing, resolve each output column name to the CANONICAL spelling — the table's existing column name when one matches case-insensitively (from the layer table's `columns`), else the name as typed — and use that canonical name everywhere downstream: the SQL, the rows' keys, `mergeAttributes`, the provenance registry, the run record's `columns`, and the Undo-ownership comparison (which must compare case-insensitively). Tests: (a) unit — a run with `EXTENT_` after `extent_` writes/merges/registers under the existing spelling and takes Undo away from the earlier run, whose Undo no longer drops the newer run's columns; (b) if cheap, one real-DuckDB case in `tests/integration/duckdb/computedColumns.test.ts` (ADD COLUMN IF NOT EXISTS with a differently-cased name is a no-op and the UPDATE hits the existing column).

## F2 (Important) — layer removal overwritten by a late completion (ledger residual)

"Removal during the schema refresh sets 'Layer removed', but the continuation unconditionally publishes done, restores Undo availability, and emits a success notice. A failed scope query can likewise replace the removal reason." (`runQueue.ts` ~390, ~578, watcher ~724)
REQUIRED (one guard, not N): the queue's local `patch(id, p)` helper (`runQueue.ts:180`) refuses to move a run OUT of a terminal state — once `failed` or `cancelled`, a later patch to `running`/`done`/`failed`-with-another-error is ignored (return without writing; the terminal error and elapsed stay). Additionally: a run that ended "Layer removed" gets `discardUndo(id)` and never `pushNotice`s its summary (guard the notice on the run's status being `done` AFTER the final patch, read back from the store). Tests: (a) deferred gate on `refreshLayerTableColumns` (or the last await before the done patch), remove the layer, resolve → the run reads failed "Layer removed", `undoable` false, no `__undo` table kept, no notice; (b) scope query rejects after removal → still "Layer removed"; (c) the guard does not block the normal running → done path or cancelling → cancelled.

## F3 (Important, with a STOP condition) — CityParquet export lacks computed columns (§8 "computed columns are included … in CityParquet as attributes")

"The export selects requested attributes directly from the original CityJSON reader. Computed columns exist only in the current layer table/model, so requesting `extent_height_m` produces a missing-column error." (`src/insights/sql.ts` ~699, ~704; `src/insights/export.ts` ~561)
REQUIRED: the CityParquet export's SQL joins the layer table's attribute columns to the reader's geometry-bearing rows by object id (`"id"`), so computed columns (present in the layer table, absent from the reader) export as attributes with the root's and each part's own values; source attributes keep coming from wherever they come today. Test: the existing export SQL builder test extended with a computed column in the requested list → the SQL selects it from the layer table via the join, and no "missing column" path. STOP CONDITION: if this needs more than ~150 lines or a design decision the builder does not settle (e.g. the reader and the table disagree on ids, or the export streams without a table), do NOT implement — write a short note in the report describing the join you would build and why you stopped; the controller moves it to the M2 plan.

## F5 (Important) — a failed run leaves no visible way to submit an edited request

"The failed form is editable, but its footer offers only Retry and Log. Recent runs' 'Edit & run' cannot restore the ordinary Run button because dismissal only applies to successful runs." (`RunFooter.tsx` ~337, `ToolView.tsx` ~32, `processingStore.ts` ~146)
REQUIRED: (a) `dismissDoneRun(toolId, targetLayerId)` becomes `dismissFinishedRun` (or gains the case): it dismisses the pair's latest run when it is `done` OR `failed`; in-flight runs are still never dismissed. (b) ToolView's suppression applies to a dismissed run whose status is done or failed (the idle footer with Run then shows; the failed card is gone). (c) Editing any form field (`setDraft`) while the latest run of the pair is `failed` and not dismissed dismisses that failed card, so the Run button reappears on the first edit; Retry stays reachable from Recent runs. Tests: Edit & run on a failed run → Run button visible, fieldsets enabled; editing the prefix under a failed card → the card is replaced by the idle footer and Run submits the edited request; a running run is unaffected.

## F6 (Minor, address) — a failure while Tools is not visible is not marked unseen

"`!s.open` does not mean Tools is visible. A failure while Details is selected, or while the panel is collapsed, can receive no amber indicator." (`processingStore.ts` ~164)
REQUIRED: `unseenFailure` is raised unless the Tools tab is actually visible: the toolbox is open AND `activeTab === "tools"` AND the right panel is not collapsed. The panel's collapsed state lives in `useShellStore` (`rightCollapsed`) — read it at the moment of the patch (`useShellStore.getState()` is acceptable here if `features/` may not import `ui/`: check the existing import direction; if `features/` must not import `ui/shell`, mirror the collapsed flag into the processing store from the shell's setter, or clear `unseenFailure` where the Tools tab actually becomes visible instead). Tests for: failure while Details is active → unseen; failure while collapsed → unseen; opening/expanding Tools clears it.

## F7 (docs) — roadmap refresh

`docs/roadmap.md` Milestone 13 "Carried to 13.2 / M2": remove the items fixed since (draft rule name prefilled; §6.1 source-column re-validation at the head; the collapse chevron; and whatever F1/F2/F5/F6 fix); add the open items: runtime engine-death recovery (§6.1 "Analytics engine stopped", table rebuild, Undo invalidation) deferred to M2 as a design task; CityParquet export of computed columns if F3 stopped; a stale/undone run during a pending Style by result median; cancel waits for the running statement; write-step SQL absent from the log; Open table does not scroll new columns into view; queued Matching ids resolved at the head (ruled). Keep it short.

## Not in this wave (do not touch)

Runtime engine-death recovery (F4, deferred to the M2 plan); streaming Details/rules; palette rotation; the M2 plan file `docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md` (another agent is writing it — never stage it).
