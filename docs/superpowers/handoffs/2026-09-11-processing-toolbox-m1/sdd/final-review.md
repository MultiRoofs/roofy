### Strengths

- Clear separation between tool definitions, scope resolution, execution, transactional writes, provenance, and UI state.
- The shared table FIFO and pre-COMMIT cancellation check provide a sound foundation. The fix wave also correctly addresses part-specific extents, source-column collision checks, and frozen Retry inputs.
- Computed attributes reach the static model through the existing `setModel` seam without adding snapshot state or bypassing engine bindings.
- Tests include meaningful transaction, rollback, scope, and geometry-preservation assertions, supplemented by real-DuckDB probes. The reports record 2,817 passing tests, 29 skipped, clean TypeScript checks, and successful targeted browser checks.
- Both supplied diffs and all required reference files were read in chunks to the end. Tests were not rerun during this read-only review.

### Issues

#### Critical (Must Fix)

None identified.

#### Important (Should Fix)

1. **Mixed-case replacement breaks model consistency and Undo ownership.**  
   **File:** `src/features/processing/runQueue.ts:512`, `:522`, `:550`  
   SQL collision detection now correctly treats identifiers case-insensitively, but model attributes, provenance, and ownership comparisons still use exact spelling. Run with `extent_`, then `EXTENT_`: DuckDB replaces the same columns, while the model and registry acquire separate keys and the earlier run retains Undo. Undoing that earlier run can drop columns owned by the newer run.  
   **Fix:** Resolve output names to their existing canonical spelling before writing, merging, registering provenance, and comparing Undo ownership. Add a real-DuckDB replacement/Undo regression covering both prefix spellings. This is an incomplete aspect of the earlier collision fix.

2. **Layer removal can still be overwritten by a late completion.**  
   **File:** `src/features/processing/runQueue.ts:390`, `:578`  
   Removal during the schema refresh sets “Layer removed”, but the continuation unconditionally publishes `done`, restores Undo availability, and emits a success notice. A failed scope query can likewise replace the removal reason. This confirms the residual explicitly carried forward in the ledger.  
   **Fix:** Preserve the removal terminal state after awaited operations and before publication; discard associated Undo resources. Test removal while schema refresh is pending and while scope resolution returns an error.

3. **CityParquet cannot export the newly computed attributes.**  
   **File:** `src/insights/sql.ts:699`, `:704`; `src/insights/export.ts:561`  
   The export selects requested attributes directly from the original CityJSON reader. Computed columns exist only in the current layer table/model, so requesting `extent_height_m` produces a missing-column error instead of the §8 export result.  
   **Fix:** Join current layer attributes to the geometry-bearing source by object ID, retaining feature scope and part values. Add an actual computed-column CityParquet export/readback test.  
   **Focused outside-diff check:** CityParquet computed-attribute export, following `exportCityParquet` into its SQL builder.

4. **The required runtime engine-failure recovery is missing.**  
   **File:** `src/insights/duckdb.ts:388`; `src/insights/layerTables.ts:624`; `src/features/processing/runQueue.ts:607`  
   Query failures return errors without transitioning a dead engine through the required recovery lifecycle. Existing Retry handles initialization and parked sources; it does not implement §6.1’s runtime shutdown handling, failure of running/queued runs with “Analytics engine stopped”, rebuilding all layer tables while preserving computed values, and invalidating lost Undo backups.  
   **Fix:** Implement this through the existing DuckDB status owner and table lifecycle, with explicit queue notification and Undo invalidation. Test worker failure after a successful computation and subsequent recovery.  
   **Focused outside-diff check:** Runtime engine failure and `retryEngine` recovery. The plan does not adequately cover this required spec behavior.

5. **A failed run leaves no clickable way to submit an edited request.**  
   **File:** `src/ui/processing/RunFooter.tsx:337`; `src/ui/processing/ToolView.tsx:32`; `src/features/processing/processingStore.ts:146`  
   The failed form is editable, but its footer offers only Retry and Log. Retry correctly uses the original request. Recent runs’ “Edit & run” cannot restore the ordinary Run button because dismissal only applies to successful runs. A user correcting a failed prefix therefore keeps retrying the old request through the visible action.  
   **Fix:** Make “Edit & run” restore an idle form for failed runs while preserving frozen Retry behavior and all in-flight locks. Test editing a failed request and submitting the changed values through the visible Run button.

#### Minor (Nice to Have)

1. **An outstanding style request survives result invalidation.**  
   **File:** `src/ui/processing/RunFooter.tsx:92`, `:104`  
   Async invalidation tracks run identity and layer existence, but not the same run becoming stale or being undone. A delayed median can consequently open a draft for an invalidated result.  
   **Fix:** Revalidate the current run, table identity, and output availability before publishing the draft; add delayed-query tests for Undo and rebuild.

2. **Failures hidden behind Details or a collapsed panel are not marked unseen.**  
   **File:** `src/features/processing/processingStore.ts:164`  
   `!s.open` does not mean Tools is visible. A failure while Details is selected, or while the panel is collapsed, can receive no amber indicator.  
   **Fix:** Base acknowledgement on actual Tools visibility and test both hidden states.

### Deferred/parked triage

- **Must fix:** The layer-removal residual at `progress.md:135`. The code contradicts the explicit ruling that a removed layer’s run must remain failed; see Important 2.
- **Must fix:** The remaining mixed-case replacement behavior under the earlier M5 collision finding. Source protection is fixed, but replacement still permits destructive Undo ownership conflicts; see Important 1.
- **All remaining deferred/parked items: may ship.** This includes queued Matching resolution, streaming Details/rules, write SQL logging, automatic table scrolling, palette rotation, and the remaining small typing, allocation, accessibility, and coverage improvements. Already-fixed deferred items need no further dispatch. The accepted brand-font and eager Rules-mode rulings are not reopened.

### Recommendations

Complete the five Important fixes before merge, with regression tests exercising their actual failure paths. Extend the acceptance coverage to computed CityParquet export and runtime engine recovery; the current green reports do not establish those behaviors.

Keep the accepted roadmap limitations explicit. Distinguish the native real-DuckDB probes from browser-WASM validation when reporting coverage.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The core implementation is well structured and substantially tested, but replacement/Undo consistency, removal handling, export, engine recovery, and failed-form recovery still have significant gaps. The acknowledged roadmap deferrals do not otherwise block M1.
