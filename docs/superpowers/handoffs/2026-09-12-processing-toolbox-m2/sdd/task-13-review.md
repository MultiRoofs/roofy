### Spec Compliance

The diff enables only `roof-metrics`, removes both registry shims without other changes to those suites, and replaces obsolete eligibility expectations with the real registry. The other five tools remain unimplemented; existing M1 eligibility coverage is unchanged.

The new test verifies executor registration, an enabled catalogue row, LoD, a checked measure, output columns, and submission of the expected normalised parameters. It imports from `vitest`, supplies the checked DuckDB imports, and handles indexed mock access explicitly.

The shared 84px caption token applies consistently to Layer, Scope, Prefix, and the threshold slider while retaining existing control tokens. Browser verification documents both fixtures, both themes, and approximately 1000px width. Screenshot files exist, but sandbox failure prevented visual inspection. Suite, typecheck, and 56-warning lint results remain reported evidence; tests were not rerun.

### Strengths

- Small production change with precisely scoped registry enablement.
- Existing parameter and LoD suites now exercise the real registry.
- Shared caption sizing addresses alignment centrally, with a documented width tradeoff.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

None found within this task.

#### Minor (Nice to Have)

- `roofMetricsEnabled.test.tsx` should explicitly assert TARGET, PARAMETERS, OUTPUT, Layer, Scope, and Prefix rendering. Its current assertions cover representative controls but would miss some required form elements disappearing.
- Update the new test’s header: “every other Roof metrics suite enables the tool by hand” is now false.
- Correct the report’s claim that its first two eligibility cases prove precedence over competing failures: the unimplemented case uses an otherwise eligible context. Coverage was not weakened, but that claim overstates it.

The row-biased Style-by-result median belongs to the controller’s final wave, not this gate. The synthetic/computed roof-area difference is a documentation follow-up. The reported pre-existing shell overflow is likewise outside this change.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation delivers the scoped enablement and removes its scaffolding without an identified regression. Remaining concerns are minor test/documentation improvements and explicitly deferred work.
