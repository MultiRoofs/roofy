# Fix wave 1 — Codex milestone review findings (M13.1)

Every item below is a controller ruling; the reviewer's wording is quoted, the required change follows. Spec: docs/superpowers/specs/2026-09-10-processing-toolbox-design.md. TDD, red first, per item.

## MAJOR

M1. `src/features/processing/runQueue.ts` (~384) — "Cancel during writing still commits because `writeComputedColumns` receives no abort signal (§6.1)." REQUIRED: `writeComputedColumns` (src/insights/computedColumns.ts) takes the run's `AbortSignal`; immediately before issuing COMMIT it checks `signal.aborted` and, if set, issues ROLLBACK and returns a "cancelled" outcome (nothing written; backup table dropped). The queue maps that to status cancelled. An abort that arrives after COMMIT keeps the existing "finished before the cancel arrived" note. No engine-level cancel (out of scope). Tests: unit (mock runQuery/ddl sequence shows ROLLBACK and no COMMIT when aborted before commit) and the queue's cancelled path.

M2. `runQueue.ts` (~604) — "Removing a target never aborts its running operation (§6.1)." REQUIRED: a one-time installer in runQueue (pattern: `installRuleDraftInvariants` in src/features/rules/ruleDraftStore.ts, called from the same place in the app shell where that one is installed) subscribes to `useLayerStore`; when a layer that is the target of a queued/running/cancelling run leaves the store, abort that run's controller and patch it `failed` with the spec's exact error "Layer removed" (elapsedMs set). Tests: queued run + layer removed → failed "Layer removed"; running run + layer removed → controller aborted and the run ends "Layer removed" (not done).

M4. `src/ui/processing/useToolForm.ts` (~55) — "Retry discards frozen IDs and snapshots the current selection/filter (§6.3)." REQUIRED: runQueue keeps each run's frozen `ScopeSnapshot` (a module-level Map<runId, snapshot>, or on the record if the type allows — prefer the Map, nothing persists) and exports `retryRun(runId): string | null` that resubmits the failed run's request WITH its stored snapshot (the new run gets a new id; the map entry is copied). `RunFooter`'s Retry and `RecentRuns`' Retry and Re-run call `retryRun(run.id)`; `requestFromRun` remains for Edit & run's draft only. Tests: Retry of a failed `selected`-scope run after the selection changed resolves the ORIGINAL ids.

M5. `useToolForm.ts` (~147) — "Case-sensitive collision checks permit `EXTENT_` to overwrite source `extent_height_m` because DuckDB identifiers are case-insensitive; the writer never revalidates provenance (§6)." REQUIRED: (a) collision and "existing" checks compare lower-cased names; (b) at the queue head (where the table is re-validated) the run re-checks that none of its output columns collides, case-insensitively, with a column that is NOT in the computed-column registry for that layer, failing with the spec's prefix message `'<col>' belongs to the source data; choose another prefix`. Tests for both.

M6. `src/features/processing/tools/heightFromExtent.ts` (~125) — "Every part receives the whole feature's extent, so Details shows incorrect individual part measurements (§7 common rules, §8 'a Building shows the aggregated value, a part its own')." REQUIRED: `rollUpExtents` writes the feature roll-up (max zmax − min zmin over root and parts) to the ROOT row, and each PART row its own extent (its own zmax − zmin, zmin, zmax); a part with no bbox gets NULL in all three; the feature's skip/measured accounting is unchanged (per feature). Update the existing tests and add one with a root + two parts where the values differ.

## MINOR (address)

m8. `src/ui/shell/ViewerShell.tsx` (~128) — "Both collapsed pills only expand the panel; clicking Details can reveal Tools and vice versa (§4.2)." REQUIRED: the Details pill sets the processing store's active tab to "details" before expanding; the Tools pill sets "tools". Test.

m10. `src/ui/processing/ToolView.tsx` (~178) — "OUTPUT omits 'Write to' and 'This layer (…)' (§6)." REQUIRED: OUTPUT starts with a field "Write to" holding one radio "This layer (<target name>)", checked and disabled (New layer is a later milestone; do not render it). Test asserts the radio text.

m11. `src/ui/processing/RunFooter.tsx` (~213) — "'Cancel run' deviates from the spec's verbatim 'Cancel'." REQUIRED: the progress block's and the queued footer's button read "Cancel"; keep aria-label "Cancel run" if a test or a11y needs to distinguish it from the idle footer's Cancel (which returns to the catalogue). Update tests.

## From the browser smoke (Task 14 report, scripts/smoke/processing-m1.md)

S1. Style by result's draft cannot be saved without typing a name. REQUIRED: prefill the draft's `name` with the attribute name (e.g. `extent_height_m`). Test.

S2. The right panel's collapse chevron is disabled when nothing is selected, so the collapsed "Tools" pill (§4.2) is unreachable in a toolbox-only session. REQUIRED: the chevron is enabled whenever the toolbox is open (processing store `open`), not only with a selection. Test.

## Not in this wave (parked/deferred by the controller — do not touch)

M3 matching ids resolved at the head (ruling stands); m7 write-step SQL in the log; m9 scroll-into-view; streaming Details/rules.
