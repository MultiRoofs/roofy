### Task 23

#### Spec Compliance

Meets the task requirements. New-layer dispatch precedes both This-layer publications. The vector copy uses Task 18’s merge helper, retains every target area, strips the stable-id envelope before normalization, and leaves the parent document unchanged.

Publication copies provenance under the new id, checks names against both stores, reports A15 renaming, and preserves Aggregate’s summary by passing a null feature count. Placement and activation match the existing unified layer order and selection-clearing rules. Undo removes the geo copy and clears its provenance; later-use and additional-column blocks are covered.

Tests assert real store and document outcomes, including byte-identical parent configuration, cancellation, engine death, placement, activation, and Undo.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- The new queue tests use a substitute Aggregate executor. They verify publication behavior, but do not execute scenario 11’s actual Selected (2) computation across six areas. Add that combined case, plus a relink-during-computation case for the new document-identity guard. [derivedRun.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/derivedRun.test.ts)

### Task 24

#### Spec Compliance

Save and share use the same `snapshotLayers` filter. Save omits both city and geo copies and computes active indices after filtering. Tests inspect saved snapshots and decode the actual share payload. Singular/plural Save copy matches §8/A16. Ordinary URL-backed layer serialization remains unchanged; omitting a share notice follows the ruling.

Restore constructs ordinary layers with null ancestry. Migration itself preserves unknown fields, but App’s explicit city restoration fields and geo normalization prevent those fields from becoming live ancestry.

The marker, state-line tail, and three menu prop states are implemented. Reader-backed copies retain CityParquet eligibility; `sourceFeatureIds` reaches the reader’s root filter through dialog → exporter → SQL, while computed attributes remain joined from the copy’s table. Tests use the corrected real paths.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

- **“Show run log” remains enabled after its run leaves history.** `StoreLayerRow` reads `runById` without subscribing to history changes. A mounted row can retain its callback after eviction; opening its menu does not refresh the parent’s decision, and clicking leads to the missing-history view. This violates the required disabled state. Subscribe using a selector returning whether this specific run exists; an unchanged boolean avoids rerendering rows on every run update. Add a mounted `LayerList` test that evicts the run and checks the item becomes disabled. Current tests supply `null` directly and cannot catch this. [LayerList.tsx:273](/data2/hideba/multiroof-viewer/src/ui/layers/LayerList.tsx:273)

##### Minor (Nice to Have)

- Export tests separately check the derived WHERE and computed-column join. A combined real-engine case asserting retained roots, their parts, excluded siblings, and computed values would strengthen coverage beyond SQL-text and request assertions. [sqlExport.test.ts](/data2/hideba/multiroof-viewer/tests/unit/insights/sqlExport.test.ts)

### Cross-task

Task 24 closes Task 23’s temporary persistence and row-marker gaps for vector copies. The already-approved Task 22 fixes remain consistent with both tasks. No additional cross-task regression found.

Static review only; no tests were rerun.

### Assessment

**Task 23 quality:** Approved — the implementation satisfies its requirements with meaningful behavioral coverage.

**Task 24 quality:** Needs fixes — persistence and export are sound, but run-log availability must react to history eviction.
