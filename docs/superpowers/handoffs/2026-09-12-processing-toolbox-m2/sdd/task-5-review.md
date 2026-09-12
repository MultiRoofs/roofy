### Spec Compliance

The diff preserves the required interfaces and function signature, has no imports in the implementation, and uses explicit Vitest imports. Array access is compatible with `noUncheckedIndexedAccess`; the existing aggregator is untouched.

Area sums, strict threshold classification, surface count, first-wins azimuth ties, empty-input handling, and ordinary single-surface behavior match the requirements. The division guards differ from the authoritative NULL rules.

### Strengths

- Clear, pure implementation with one pass and constant auxiliary space.
- Tests cover the main aggregation rules, threshold equality, ties, empty input, and zero-area surfaces.
- The final test arithmetic removes the identified lint warning. The reported 56-warning baseline was not independently rerun.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **NULL conditions are broader than specified.** [roofRollUp.ts:78](/data2/hideba/multiroof-viewer/src/domain/roofMetrics/roofRollUp.ts:78) guards both divisions with `areaM2 > 0`, whereas the semantic table specifies NULL when `area === 0`. A single surface with area `-2`, inclination `10`, and threshold `5` returns NULL share and slope instead of `0` and `10`. A NaN area also produces NULL for these fields while leaving `areaM2` as NaN. Use the authoritative zero-only condition and add focused negative-area and NaN-area regression cases; the brief’s sample implementation does not override the table.

#### Minor (Nice to Have)

- Add explicit single-surface assertions and verify azimuth at threshold equality, including a horizontal surface at threshold zero. Current tests exercise equality only through flat-area calculations.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The implementation is compact and matches the ordinary roof-metric cases, but its division guards violate the authoritative NULL conditions on numeric edge cases. Correct those guards and pin the behavior with focused tests.
