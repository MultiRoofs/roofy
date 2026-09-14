### Findings

- **S1 — Resolved:** `buildingProxy.ts` adds the parent-table ID restriction before footprint proxies; unit and engine tests exclude gained building P3 and assert its area counts zero.
- **S2 — Partly:** Transactional type migration, inherited-column handling, and original-type Undo are implemented and tested. Partial migrations still leave database values, model attributes, and provenance inconsistent; see regressions.
- **S3 — Resolved:** `vectorSource.ts` filters non-areas with counted skips; Join’s queue preflight and Aggregate’s target preflight enable it. Form tests retain mixed-layer eligibility, as ruled.
- **S4 — Resolved:** `distanceToNearest.ts` adds expanded-envelope filtering and selects winners before fetching properties, retaining GEOS distance and source-order ties. The long-line risk is safe: envelope overlap admits false positives; the distance predicate rejects them without excluding an eligible nearest source.
- **M1 — Resolved:** `aggregatePerAreaRun.test.ts` adds Selected(2), six valid areas, real executor/builders, exact counts including zeros, excluded-building SQL assertions, and unchanged-parent assertions; engine responses remain mocked.
- **M2 — Resolved:** `deriveLayer.test.ts` adds multi-LoD root/parts geometry and attribute assertions, excludes siblings, prepares through the FIFO, then invokes real Measure solids using the copy’s reader/table.
- **M3 — Resolved:** `derivedRun.test.ts` adds cancellation inside both publication branches with the required note and working Undo, plus pending vector-parent relink refusal and successor progress.
- **M4 — Partly:** Diff context shows issued-statement capture in both production write paths. The report names pre-existing death-during-UPDATE tests, but their assertions are absent from the supplied diff; verification remains incomplete within the permitted scope.
- **5 — Resolved:** `crossLayerRun.test.ts` now asserts `done`, null error, the vector property, and no city transaction/ALTER/UPDATE.
- **6 — Resolved:** Engine tests cover multiple contributing footprints, root fallback, and MIN/MAX across mixed-NULL, all-NULL, and empty memberships.
- **7 — Resolved:** Queue tests hold a predecessor, remove the source while queued, assert refusal, and finish a successor for Join, Distance, and Aggregate’s reversed direction.
- **8 — Resolved:** `layerTablesBuild.test.ts` interleaves name allocation with two builds and checks distinct names and both ready entries.
- **9 — Resolved:** `validateSolids.test.ts` reverses scope and report rows together, asserting FALSE dominance and diagnostic sums.
- **10 — Resolved:** The encoding test uses a tiny final feature to isolate assembly checkpoints; Join/Distance add timer-delivered cancellation tests.
- **11 — Partly:** The wave changes only prototype cleanup in `revealColumns.test.tsx`; it supplies no pending-A → acknowledged-B regression-test evidence. The earlier claimed fix cannot be verified from this diff.
- **12 — Resolved:** Join/Distance reset provenance and assert none after failed/cancelled runs; reveal tests restore the original prototype descriptor.
- **Task 28 docs — Resolved:** Documentation narrows death-handling claims, corrects registration/cleanup and per-site outcomes, distinguishes D10’s boolean defect, qualifies D2, corrects `toolId` wording and byte lifetime, and records S1–S4.
- **F1 — Partly:** Surface area uses the required `degenerate_face_count` guard; tests pin D11, caveats, and preserved scenario-2B envelope. Footprint remains unguarded contrary to the explicit ruling. The report claims four degenerate shapes, but the diff supplies only the collapsed-quad fixture.
- **F2 — Resolved:** Shared `causeOf()` singularizes caveats and skips; assertions cover singular/plural output, with roof/extent producers unchanged.
- **F3 — Resolved:** `RunFooter.tsx` disables undone styling with title `Undone`; tests preserve styling for the late-cancel note.
- **F4 — Resolved under ruling:** The report documents the permitted unreproduced disposition and inspected paths; the added test couples provenance clearing and stale marking across rebuild transitions.
- **F5 — Partly:** Vector activation now preserves city selection and enables the Selected path, but unrelated selection-store updates reactivate the city layer.

### Regressions

- **S2: Partial type migration creates contradictory data.** DROP/ADD clears out-of-scope database values, while [model publication](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:1904) updates only result rows and provenance still retains “the rest from” history. Correct the partial-migration policy and keep all representations consistent.
- **F5: Hover changes the active layer without a pick.** [Reconciliation subscribes to every selection-store update](/data2/hideba/multiroof-viewer/src/features/workspace/layerCoordination.ts:137), including [hover and tool-mode changes](/data2/hideba/multiroof-viewer/src/features/selection/selectionStore.ts:105). Select city → activate vector → hover reactivates city. Restrict activation to actual selection changes.
- **No additional S2 Undo regression confirmed:** Whole-table backups also restore unchanged-type columns, but later overlapping toolbox writes revoke the earlier Undo through `stealUndo`.

### Assessment — Fix wave 1: Needs fixes

Fix the S2 consistency and F5 activation regressions, reconcile F1 with the ruling, and supply the missing M4/11 verification evidence.
