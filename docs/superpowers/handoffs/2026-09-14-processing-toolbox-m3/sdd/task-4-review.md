### Spec Compliance

Mostly compliant. `outputColumns(prefix, params)` remains two-argument and returns `ReadonlyArray<OutputColumn>`. Both implemented tools declare the correct ordered names, all `DOUBLE`. ToolView removes its hard-coded type exactly once, retains the mono column list, and submits the typed objects unchanged.

The caller check found no remaining string-array misuse. `RunRecord.columns` remains names-only: the queue maps `.name` both when creating the record and after execution, preserving RunFooter’s first-written-column behavior.

### Strengths

- The extent helper split is necessary and appropriately scoped: it preserves string row keys while removing the executor’s duplicate type assignment.
- Tests cover exact typed registry output, selected measures, custom prefixes, replacement warnings, source-column spelling, and submitted columns.
- The Run test uses the required roof-bearing fixture. Its submission assertion checks meaningful behavior at the queue boundary.
- Type-only imports preserve runtime engine independence.
- The reported TDD evidence correctly distinguishes failing contract tests from UI regression tests that already passed. No tests were rerun.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Roof output types still have two deciding sites.** [roofMetrics.ts:149](/data2/hideba/multiroof-viewer/src/features/processing/tools/roofMetrics.ts:149) independently constructs `ToolResult.columns` with `type: "DOUBLE"`, duplicating the newly typed `roofColumnNames`. This contradicts the brief’s explicit single-source requirement and the report’s completion claim. Replace that construction with `roofColumnNames(input.prefix, input.params)` and assert executor/registry agreement, including a selected-measure subset. The brief’s file list does not justify leaving this duplication while removing the equivalent extent duplication.

#### Minor (Nice to Have)

- **The test cleanup also bypasses a pre-existing production retention gap.** Clearing `byLayer` is valid test isolation, but production layer removal does not clear provenance: [layerTableLifecycle.ts:151](/data2/hideba/multiroof-viewer/src/features/layers/layerTableLifecycle.ts:151) drops the table, while the sole `clearLayer` caller handles rebuilds in [runQueue.ts:1153](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:1153). Removed-layer provenance therefore remains retained. Track this separately; Task 4 did not introduce it.
- The test titled “freezes the typed columns” verifies arguments to mocked `submitRun`, not actual freezing. Rename it to describe submission. The unchanged queue’s names-only conversion is verified by inspection.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The contract migration and behavior-preserving caller updates are sound, but the remaining roof executor type declaration leaves an explicit Task 4 requirement unfinished. Reusing the typed roof builder should close the gap with a small change.
