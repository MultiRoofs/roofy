1. **CRITICAL — Task 25, lines 22929–22940:** The Retry guard rejects normal boots: `duckdb.ts:405` increments `generation` on **every boot**, so comparing against the pre-boot generation skips rebuilding parked tables. Bind to the generation after boot starts; distinguish successful boot from subsequent death/replacement. Test with the real boot-generation behavior.

2. **CRITICAL — Task 22, lines 20106–20130:** `({ kind: "columns" } & UndoState)` is impossible: Task 18’s `UndoState` already discriminates on `"city" | "vector"`. Use a nested payload (`{ kind: "columns"; state: UndoState }`) and explicitly update every publication, discard and Undo branch.

3. **MAJOR — Task 22, lines 19986–20011:** `registry` is a stale Zustand snapshot. After `setProvenance`, its `byLayer` excludes this run’s new entries; `runIds` therefore omits the creating run and `newLayerUndoBlock` immediately blocks Undo. Re-read the store after writing provenance. Assert immediate Undo for both destinations’ layer kinds.

4. **MAJOR — Task 20, lines 17755–17763, 17952–17963:** Disabling the streaming radio does not invalidate an already-selected `"new"` destination. Choose New layer on a static target, then retarget to streaming: Run remains possible, and the queue checks only tool capability. Validate the streaming restriction in both `runReason` and execution preflight.

5. **MAJOR — Tasks 21–22, lines 19143–19161, 19242–19273:** The derived model retains the parent’s bounding box, and publication copies `selectedLod` without `lodMode`. A small subset can zoom to the parent extent and lose a manual LoD choice. Recompute subset bounds and copy the complete LoD state; test a spatially separated subset and manual LoD.

6. **MAJOR — Tasks 22–23, lines 19978–19981, 20014–20016, 20073–20091, 21374–21417:** Vector publication still looks up the published name only in the city store, and the summary labels the **source building count** as the created layer’s feature count. A disambiguated vector name is consequently missing from the card/note. Read the correct store and report the copied target areas separately from scoped source buildings.

7. **MAJOR — Task 24, line 21735:** Passing `onShowRunLog={onShowRunLog ?? null}` converts an ordinary layer’s `undefined` into the “render disabled item” value. Every ordinary layer gets Show run log. Preserve `undefined`; pass `null` only for derived layers whose log expired.

8. **MAJOR — Task 27, lines 23743–23762, 23790–23808:** Reveal requests are consumed before the intended headers necessarily exist. An already-mounted grid for another layer, an outstanding query, or newly appended columns loses the request permanently. Retain requests by layer until a matching rendered header acknowledges them. Test actual grid switching and asynchronous column arrival.

9. **MAJOR — Tasks 21 and 27, lines 19116–19136, 23590–23630:** Derived-city writes discard `WriteOutcome.statements`; Task 27 logs only the This-layer write. New-layer logs omit their ALTER/UPDATE/COMMIT sequence despite §6.4. Share the write-log recorder and route preparation’s write outcomes through it, including failures.

10. **MAJOR — Task 26, line 23378:** `openAddForm` becomes dependent on `layer.rules`, but its existing callback dependencies remain `[layerId, setDraft]` (`RulesEditor.tsx:241–247`). Subsequent manual drafts reuse stale rules and colours. Add the dependency or read current rules when clicked; test consecutive Save → Add rule operations.

11. **MAJOR — Tasks 24–27, lines 21619, 21848–21910, 22512, 23198–23260, 23459–23480:** Tests/implementation are not complete as claimed: `baseProps` does not exist in the cited suite; `cardFor` has no definition in the plan; failure hooks and primitive wrappers are placeholders. Snapshot fixtures cast to `never`, then access `.name`; the null-active test expects index zero while implementation returns `undefined`. Supply complete, typed fixtures, imports, hooks and wrapper bodies; reconcile the assertion.

12. **MAJOR — Task 21, lines 18955–18969, 19051–19053:** The source-string test rejects `"enqueueLayerTable"`, which the prescribed implementation itself contains in a comment. Replace it with a behavioral FIFO regression that completes preparation without nested enqueueing.

13. **MAJOR — Task 29, lines 24214–24218:** The smoke contradicts §7’s contributor rule. Building `0001` has a MultiSurface part at LoD 2.2, so that part supersedes its root’s invalid Solid: it cannot count as a qualifying solid feature or produce the asserted root validity/envelope values. Expect one qualifying solid feature and a skipped first building; add a separate invalid-solid fixture without overriding part geometry.

14. **MINOR — Task 21, lines 19076, 19113:** “Selecting the copy’s features” and “Creating the new layer’s table” are user-visible log labels absent from the spec and A1–A16. Use the approved phase labels.

15. **MINOR — Tasks 21/29, lines 18472–18475, 24181–24184:** Full-suite commands run in the foreground despite the explicit background-only constraint. Supply background commands plus exit-status collection before proceeding.

Citation checks: verified `layerTables.ts:80–98`, `:420–436`, `:767–857`; `duckdb.ts:150–187`, `:681–697`, `:724–745`; `runQueue.ts:932–1006`, `:1153–1176`; and App’s snapshot serialization. The front matter at plan line 134 misstates `layerStore.ts:327`: it uses `input.id ?? crypto.randomUUID()`, not unconditional UUID creation.

Fix first
