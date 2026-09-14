### Spec Compliance

Task 14 meets its requirements and controller rulings:

- Footprints read the supplied LoD 0 reader column, apply frozen row IDs, and use `ST_Force2D` before aggregation.
- The footprint window and aggregate filter select parts when any part has LoD 0 geometry, displacing the root. Bbox proxies aggregate the whole feature’s extent.
- The outer `ST_IsEmpty` guard converts empty unions to NULL while retaining the feature row. The probe distinguishes this from an out-of-scope feature’s absence.
- `footprintAvailable(table)` is exported and shared by options and defaults for Task 15’s form consumption. Labels, fallback copy, proxy literals and distance-note sentences match the binding requirements.
- Screen and copied logs share the formatter and print building geometry once in the run header. The focused outside-diff check confirmed header rendering is separate from the statement loop.

### Strengths

The SQL builders remain pure and reuse existing quoting helpers. Exact-string unit tests pin the statements, while real-engine probes execute both builders across all three proxies and assert geometric results.

The probes specifically establish the 16 m² part-only footprint, whole-feature bbox areas and centres, scope exclusion, Z removal, and the empty-union engine behavior. These are meaningful behavioral assertions, independent of mocked query answers.

No tests were rerun; the reported execution results were assessed alongside the supplied test changes.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

- Extend the [footprint engine probe](/data2/hideba/multiroof-viewer/tests/integration/duckdb/crossLayer.test.ts:780) with multiple contributing parts and a root whose parts have no LoD 0 geometry. The current behavioral case proves root displacement, but unioning multiple parts and successful root fallback are covered only by the SQL shape.
- Correct the comment immediately above the outer-CASE explanation in [buildingProxy.ts](/data2/hideba/multiroof-viewer/src/features/processing/buildingProxy.ts:201): it still says an aggregate over an empty filtered set is NULL, contradicting the engine finding documented directly below.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation satisfies the task’s SQL, contributor, scope, copy and logging contracts, with substantive real-engine coverage. The remaining observations concern additional regression coverage and one stale comment.
