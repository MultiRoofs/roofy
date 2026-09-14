### Spec Compliance

Most Task 7 requirements are met:

- Contributors are selected by **any geometry at the LoD**; solid classification separately requires successful parsing and a permitted CityJSON geometry type.
- Identity checks cover every scoped row, including displaced roots and non-contributors, under both “all” and frozen scopes.
- Root rows receive feature roll-ups; parts receive their own values. Volume propagation, combined height, elevation extrema and order-independent validity AND are implemented.
- Caveats appear between measured and skipped counts. Existing roof and extent tests retain their card-line assertions.
- Registration and the EXECUTORS pin are updated; the diff leaves `implemented` unchanged.
- Static tracing through the real queue confirms cancellation/death exceptions reach the executor’s `finally`; source release is idempotent and death-raced.

One per-measure NULL rule remains incorrect. Tests were not rerun.

### Strengths

- Shared, pure contributor and roll-up functions avoid executor registration side effects.
- Missing-root and missing-non-contributor tests cover both scope forms; a separate test protects the post-measure identity threshold.
- Fixture-derived tags exercise the MultiSurface-part displacement rule and the distinct invalid-solid outcome.
- Tests assert output values, counts, SQL scope and rendered summaries, rather than merely mock invocation.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

- **All-NULL area measures become zero.** In [solidRollUp.ts](/data2/hideba/multiroof-viewer/src/features/processing/solidRollUp.ts), envelope and footprint start at `0` and accumulate `value ?? 0`. A measurable contributor whose area is NULL therefore produces an evaluated-looking zero when every contributor lacks that measure. This contradicts §7’s requirement that a feature with no remaining contributor **for a measure** receives NULL. Track whether each area has any non-NULL value; preserve genuine zero values. Add cases for all-NULL areas and mixed NULL/numeric areas.

#### Minor (Nice to Have)

- **Cleanup coverage stops short of the real executor through the queue.** The cancellation case in [measureSolids.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/measureSolids.test.ts) throws an ordinary error at the first checkpoint. The added queue test substitutes an extent executor returning canned caveats. Neither exercises Measure solids cancellation or death during a pending reader query. Static cleanup wiring looks correct, but regression tests should assert buffer release, no publication and FIFO progress through those actual paths.

- **The unbounded contributor `IN (...)` is a real scaling exposure, still parked for gate smoke.** [measureSolids.ts](/data2/hideba/multiroof-viewer/src/features/processing/tools/measureSolids.ts) serializes every contributor even for “all”; the queue retains the full SQL in its log. At 100k contributors, statement construction, engine parsing and log handling grow with the entire ID list. No measured failure is established here; retain the commander’s large-layer smoke item.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The core executor and accepted controller rulings are implemented coherently. Fix the area roll-ups’ NULL-to-zero conversion to satisfy the explicit per-measure result contract.
