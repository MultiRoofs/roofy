### Spec Compliance

Substantially implemented, with one binding requirement outstanding.

- Measure solids is enabled, and `useLodOptions` supplies `solidLodOptions`, `with a solid`, and the exact empty reason.
- Residual A3 is fixed: tests separately assert the disabled option and Run’s paragraph reason.
- `SolidParams` follows the `{ params, onChange }` sibling contract. Tests pin all six A5 labels, four defaults, both hover strings, normalized updates, and empty-measure validation.
- Both LoD default rules are covered. Unticking every measure disables Run with “Pick at least one measure”; `solid_valid` remains promised.
- Workload gating has positive and negative behavioral tests. `solidsEnabled.test.tsx` uses the real registry; the obsolete registry mock is removed from `useToolForm.test.tsx`.
- Focused checks found no change to Roof metrics’ LoD default, PARAMETERS gating, or extension note. ToolView remains the parameter-section dispatch point. Eligibility retains the required priority order, including `!implemented` first.

The aggregate diff contains the flip, hook extension, and explicit-unimplemented test migrations. It does **not** establish their individual commit membership; the claim that all landed in `3ba9942` remains report evidence rather than independently verified history.

### Strengths

- Reuses the existing parameter normalization, measure definitions, and checkbox styling.
- Tests exercise rendered controls, real geometry-tag counting, validation, and submitted request contents. Engine and queue mocks isolate appropriate boundaries.
- The reported selected-LoD mutation check meaningfully distinguishes the two default rules. No additional test run was needed for this review.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

**Suppress the LoD field on ineligible targets in this Task 8 fix round.** [ToolView.tsx:140](/data2/hideba/multiroof-viewer/src/ui/processing/ToolView.tsx:140) still gates solely on `needsLod && implemented`. Opening Measure solids on a streaming FlatCityBuf or CityParquet target consequently renders “No solid geometry in this layer” alongside the actual reader refusal, asserting absence where geometry-type information is unavailable.

Add `&& f.eligibility.ok`, as the commander ruled. Add real-registry view tests for both target kinds asserting no LoD control or geometry verdict, Run disabled, and the exact reader reason retained. Preserve the eligible-but-no-solids test and cover Roof metrics under failed eligibility at this shared gate. This defect becomes visible with Task 8’s flip and should **not wait for Task 10**.

#### Minor (Nice to Have)

The hover tests assert that both titles exist, but not their association with Volume and Height. Assert each checkbox’s enclosing label has its prescribed title so swapped hints cannot pass.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The implementation and behavioral coverage satisfy most of Task 8, but the missing eligibility gate violates an explicit controller ruling and exposes an unsupported geometry verdict. Resolve that gate and its regression coverage before accepting the task.
