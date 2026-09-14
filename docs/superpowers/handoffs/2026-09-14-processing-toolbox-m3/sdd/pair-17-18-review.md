### Task 17

#### Spec Compliance

Implementation matches the requested distance semantics: `ST_Distance_GEOS` controls both the value and maximum-distance join; ties use source order; missing proxies are skipped separately from “none within”; results propagate to roots and parts. Scope-wide identity checks precede footprint computation, and nearest-id property validation includes skipped source records.

The registry is enabled, A11 and the no-id checkbox behavior have form coverage, and Style by result opens `< median`. Lifecycle tests exercise the real executor, queue, FIFO, reader and vector-table cleanup with only the engine seam mocked.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- **Make point-proxy parity explicit.** The [engine tests](/data2/hideba/multiroof-viewer/tests/integration/duckdb/crossLayer.test.ts:1196) establish nonzero polygon distances, collection behavior and NULL safety. However, the existing point→polygon test calls core `ST_Distance`, while the GEOS centre-proxy case uses a mixed collection. Add the same point→polygon fixture through `buildDistanceSql` to directly pin the controller’s requested parity.

### Task 18

#### Spec Compliance

The production changes implement prepared-data publication, verification before merging, rollback capture from the verified document, per-property restoration with `GEO_PROPERTY_ABSENT`, and ownership/source checks at the Undo FIFO head. B5’s three cases are transitioned.

Computed badges, Details grouping, prepared-data category values and GeoJSON export are wired correctly. The focused checks confirm one config replacement triggers one engine-pair rebuild, highlighting uses stable IDs, and App’s refresh reads the separate geo selection. Shared provenance helpers are ready for Task 22. Returning `unknown` preserves the intended contract without the redundant union.

Required regression coverage remains incomplete.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

- **Complete the required Undo scenarios.** In [crossLayerRun.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/crossLayerRun.test.ts:958), the purported “OTHER order” undoes B after already undoing A; it never tests B→A from a document containing both results. The relink test also relinks **before** calling `undoRun`, despite claiming a relink while Undo waits. Add independent A→B and B→A runs, and hold the FIFO, request Undo, relink, then release it. Assert surviving values, ownership and provenance. These are explicit controller requirements, and the current tests would miss moving identity validation outside the queued callback.

##### Minor (Nice to Have)

- **Strengthen exact-restoration and publication assertions.** [mergeGeoProperties.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/geoLayers/mergeGeoProperties.test.ts:68) compares only before/after config identities, so it cannot establish “exactly once.” Count config transitions. Its absent-property assertions would accept `{ column: undefined }`; assert key absence directly. Also check purity against the prepared input actually passed to the helpers.
- The new records/Details tests assert badges and labels, but not displayed computed values or computed-column filter/sort behavior. Add behavioral assertions for those surfaces.

### Cross-task

No production regression from Task 18 into Task 17 was found. City publication and Undo retain their existing behavior apart from the discriminator and extracted helpers; the previously deferred post-COMMIT engine-death issue remains unchanged.

Keep vector Undo revocation on engine restart: §6.1 explicitly disables Undo for every earlier run. Preserving vector Undo would require a revised product ruling. Source-city rebuild retirement remains the accepted decision.

No tests were rerun; reported suite results were not independently verified. Review used the supplied diff and permitted focused reads.

### Assessment

**Task 17 quality:** Approved — the implementation and behavioral coverage support the required semantics, with one small parity-test improvement.

**Task 18 quality:** Needs fixes — production logic appears sound, but the explicitly required Undo regression scenarios are not fully tested.
