### Spec Compliance

Matches Task 2’s implementation requirements:

- Public `Surface.geometryType` is optional, nullable and readonly. The required local annotation in `buildSurface` matches the brief.
- `buildSurface` copies `geom.type`, independently of semantics. All five geometry cases, including every nested MultiSolid/CompositeSolid face, reach this builder.
- CityParquet explicitly writes `null`; no app fixtures change.
- FlatCityBuf’s `parseCityObject` path produces tagged worker-side surfaces, consistent with decision (a).
- The parent pointer references the appended submodule commit.

The report supplies red-first failures and passing verification. Commit push/order and historical test execution cannot be independently established from the diff; no git commands or tests were rerun.

### Strengths

Small, centralized change preserves existing traversal and avoids geometry rescans. The five tests exercise real parser behavior, cover all five geometry types, and verify LoD/type pairing without mocks.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

- [geometryType.test.ts](/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/geometryType.test.ts:66): MultiSolid and CompositeSolid each contain only one member, shell and face. Adding multiple members and shells would strengthen regression coverage for “every surface”; the inspected traversal is correct.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation satisfies the task brief and controller rulings without expanding scope. The remaining test improvement is nonblocking.
