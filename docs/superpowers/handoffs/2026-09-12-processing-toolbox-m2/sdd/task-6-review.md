### Spec Compliance

The implementation matches the requested additive widening. Roof metrics retain existing fields and carry each surface’s `lod`; `geometryLods` collects all surface types, deduplicates in first-seen order, and stays per object without roll-up. Worker transport and resident caching preserve both fields.

The existing suite was extended, and the named fixtures plus `legendCounts.test.ts` were updated alongside the parent pointer bump. Changed plugin tests retain Vitest and engine-free imports.

Push ordering, commit trailers, and reported test results cannot be independently verified from the supplied diff. No tests were rerun.

### Strengths

- Small, focused production change with no reader modifications.
- Reuses the existing surface traversal.
- Preserves structural assertions and existing metric-value coverage.
- Explicitly tests geometry at a LoD containing walls but no roofs.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

None found.

#### Minor (Nice to Have)

- The new tests do not directly pin first-seen ordering: the multiple-LoD assertion sorts the result. Assert `["2.2", "1.2"]` directly and add an untagged roof assertion for `lod: null`.
- [layerRows.test.ts](/data2/hideba/multiroof-viewer/tests/unit/insights/layerRows.test.ts:42) still returns a cast `ResidentObjectRecord` without `geometryLods`. Adding the field would keep this fixture faithful to the widened contract.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation satisfies the task’s functional requirements and preserves existing consumers and record transport. Remaining findings concern test precision and fixture completeness, not production correctness.
