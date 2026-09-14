### Findings

1. **Resolved — Proxy preference lost on predicate switching.** In `useToolForm.ts`, `keepsProxy` restores the draft’s proxy when write-back leaves the effective proxy unchanged, while allowing explicit radio changes. Added `ToolView` tests exercise footprint → centre within → within and verify Run submits footprint; a separate test verifies rectangle selection persists.

2. **Resolved — Field search hiding the collision sentence.** In `CrossLayerParams.tsx`, search retains fields with `fieldErrors.has(k)`. Section-error suppression now counts only fields present in `sourcePropertyKeys`. The added thirteen-field test verifies the nonmatching offending checkbox remains associated with its collision sentence while ordinary nonmatches disappear.

### Regressions

None identified in the supplied diff. The proxy preservation excludes layer resets and single-layer tools; explicit proxy selection remains covered.

### Assessment — Task quality: Approved

Both scoped regressions are resolved with targeted regression coverage for the implemented Join form; this was a read-only review with no suite rerun.
