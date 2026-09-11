1. **MAJOR** — `src/features/processing/runQueue.ts:384`: Cancel during writing still commits because `writeComputedColumns` receives no abort signal (§6.1). Fix: check cancellation between write steps and before COMMIT, rolling back; expose engine cancellation through `duckdb.ts`.
2. **MAJOR** — `src/features/processing/runQueue.ts:604`: Removing a target never aborts its running operation (§6.1). Focused check: `layerTableLifecycle.ts` only schedules table removal. Fix: subscribe to layer removal and cancel affected runs with “Layer removed”.
3. **MAJOR** — `src/features/processing/runQueue.ts:304`: Matching IDs resolve at execution time, so an earlier queued write can change which features match the frozen filter (§6.1). Fix: resolve and retain actual scope IDs when Run is pressed.
4. **MAJOR** — `src/ui/processing/useToolForm.ts:55`: Retry discards frozen IDs and snapshots the current selection/filter, potentially processing different buildings (§6.3). Fix: retain and reuse the failed run’s frozen scope.
5. **MAJOR** — `src/ui/processing/useToolForm.ts:147`: Case-sensitive collision checks permit `EXTENT_` to overwrite source `extent_height_m` because DuckDB identifiers are case-insensitive; the writer never revalidates provenance (§6). Fix: compare normalized names and reject source collisions again immediately before writing.
6. **MAJOR** — `src/features/processing/tools/heightFromExtent.ts:125`: Every part receives the whole feature’s extent, so Details shows incorrect individual part measurements (§7 common rules, §8). Fix: write aggregated extents to roots and each part’s own extent to part rows.
7. **MINOR** — `src/features/processing/runQueue.ts:391`: The write log records `sql: null`, omitting transaction, backup, ALTER and UPDATE statements (§6.4). Fix: record each issued statement with timing and row count.
8. **MINOR** — `src/ui/shell/ViewerShell.tsx:128`: Both collapsed pills only expand the panel; clicking Details can reveal Tools and vice versa (§4.2). Fix: set the corresponding active tab before expanding.
9. **MINOR** — `src/ui/processing/RunFooter.tsx:286`: Open table appends columns but never scrolls them into view (§6.2). Fix: request horizontal scrolling to the first output column after rendering.
10. **MINOR** — `src/ui/processing/ToolView.tsx:178`: OUTPUT omits “Write to” and “This layer (…)", leaving the destination unstated (§6). Fix: show the sole supported destination.
11. **MINOR** — `src/ui/processing/RunFooter.tsx:213`: “Cancel run” deviates from the spec’s verbatim “Cancel”. Fix: use “Cancel” for running and queued actions.

Focused checks also found no static-model-merge rebuild in `layerTableLifecycle.ts` and no cancellation safeguard in `duckdb.ts:389`. App tests were outside this pass; the included plugin tests were substantive.

Not yet — cancellation, frozen scopes, source-column protection and part values violate the required behavior.
