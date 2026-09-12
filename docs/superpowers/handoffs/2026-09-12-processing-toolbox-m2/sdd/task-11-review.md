### Spec Compliance

The diff implements the accepted roof copy, feature counts, scoped empty-state assertions, unimplemented-tool suppression, registry mock, and required shared fixture. The select reuses the Layer field’s markup; stream versions invalidate options, and submission uses the effective `draft.lod`.

The target-change default requirement is not fully met. Tests and lint were not rerun; the reported results remain unverified.

### Strengths

- Geometry options reuse Task 7’s source without performing measurements.
- Empty options disable Run with the specified explanation.
- Tests distinguish feature counts from row counts and cover singular/plural wording.
- DuckDB mocks include the additional lifecycle exports; tests import from `vitest`.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Switching targets carries the previous target’s LoD instead of applying the new default.** In [useToolForm.ts](/data2/hideba/multiroof-viewer/src/ui/processing/useToolForm.ts:107), any qualifying stored LoD wins. The existing `setDraft` wrapper copies the effective draft when changing `targetLayerId`, and the store preserves it unchanged. Consequently, switching from a layer defaulting to `2.2` to one selected at `1.2`, with both options available, leaves `2.2` selected—even without an explicit LoD choice. Reset or associate the choice with its target, including automatic target replacement, and add a regression test asserting both the displayed and submitted LoD.

#### Minor (Nice to Have)

- The new tests cover initial defaults but no stream-version updates. Add coverage for changing option counts and losing the currently selected qualifying LoD.
- Required browser comparison was deferred. Matching markup reduces risk, but both-theme and narrow-layout verification remains outstanding for activation.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** Most task requirements are implemented cleanly, but target changes can silently retain the wrong default LoD. The roof-only hook guard is acceptable for M2: `needsLod` alone cannot distinguish roof geometry from solids, so M3 should add tool-specific providers when enabling those tools.
