### Spec Compliance

Partially compliant. The diff contains both complete CityJSON 2.0 fixtures, matching the brief’s geometry, nesting, transforms and attributes. Their required invalid-solid measures and CompositeSolid validity, two shells and volume 2 are asserted. README deferral to Task 28 is correct.

Both suites use the required opt-in gate and dynamic harness import, preserving offline collection. The installer is additive; the focused harness check found no changed behavior for the existing suites or evident cross-describe state sharing.

The literal SQL approach follows Task 1’s contract, with builder-output verification explicitly deferred. However, the requirement to assert every engine fact is not fulfilled.

### Strengths

- Tests query the real engine and assert returned values and errors, without mocks.
- D1’s `CASE WHEN s IS NOT NULL THEN r.<field> END` correctly distinguishes unparseable geometry from invalid solids. The mixed-row measure and validation queries exercise that workaround.
- D2’s overload ambiguity and D6’s boundary-point distinction are explicitly tested.
- D4’s essential finding—CompositeSolid uses `GeometryCollection Z` yet parses and measures successfully—is pinned.
- The report supplies red/green, offline, regression, lint and type-check evidence. No tests were rerun for this review.

### Issues

#### Critical (Must Fix)

None identified.

#### Important (Should Fix)

1. **Several required engine facts and reported findings have no committed probe.**  
   In [solids.test.ts](/data2/hideba/multiroof-viewer/tests/integration/duckdb/solids.test.ts), `orientation_error_count` is never selected: D3 is entirely unpinned. `ST_3DArea` equivalence and `ST_3DBounds`’ fields/invalid-solid behavior are also untested. In [crossLayer.test.ts](/data2/hideba/multiroof-viewer/tests/integration/duckdb/crossLayer.test.ts), no query exercises `ST_Centroid`, `ST_Union_Agg`, `ST_Force2D`, the stated FeatureCollection reader shape, or `ST_Transform`’s existence. Z parsing is tested, but the listed operations’ acceptance of Z geometries is not. D5 tests the replacement functions without asserting `ST_NDims`’ absence. Add focused probes; function-name presence and report prose do not establish these behaviors.

2. **The CityJSONSeq “identically” test establishes only that some solid parses.**  
   [solids.test.ts:283](/data2/hideba/multiroof-viewer/tests/integration/duckdb/solids.test.ts:283) selects only `id` and `parsed`, then checks for a nonempty result containing any successful parse. It cannot catch different measures, validation flags, NULL handling or feature IDs. Run the same guarded measure/validation shapes through both readers and compare complete expected rows.

3. **NULL and validation assertions leave the central D1 contract incomplete.**  
   [solids.test.ts:219](/data2/hideba/multiroof-viewer/tests/integration/duckdb/solids.test.ts:219) checks only validity and envelope for the unparseable row; the validation case checks only two of seven NULL outputs. Invalid manifold/orientation flags and degenerate counts are selected but not asserted. Moreover, `MEASURE_SQL` still reads raw `r.is_valid` in its volume condition despite documenting that every report-field read is guarded. Guard that condition explicitly and assert every output for valid, invalid and unparseable rows. Avoid `Number(value)` alone for expected zeroes: `Number(null)` also passes.

#### Minor (Nice to Have)

- Cross-layer predicate, overlap and distance tests depend on the vector table created inside another `it`. Move shared table creation into setup so individual tests work with name filtering.
- The largest-overlap test claims tie coverage but contains no equal-overlap case; its comment also understates A’s overlap width as 10 instead of 60. Add an actual tie assertion or narrow the claim.
- D4’s reported 12 faces and additional report fields are not asserted, although its task-required validity, shells and volume are.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The fixtures, gating and core engine probes are sound, and the D1 workaround is appropriate. Missing behavior assertions prevent this suite from serving as the complete engine contract required by the dispatch.
