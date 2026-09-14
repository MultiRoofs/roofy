### Spec Compliance

The implementation matches Task 11 and its controller rulings:

- `ToolTarget`/`ToolSource` match the reconciled ledger, including narrowed `GeoJsonLayer` arms and `propertyTypes`.
- `computeLayerId` correctly anchors scope, table snapshots, retry, head checks and stale detection.
- Source identity and name are captured at Run. Removal checks cover both identities and subscribe to both stores.
- A3/A4 are verbatim and preserve eligibility precedence. Aggregate remains “Not available yet”.
- `ToolResult` and `summarise` are untouched. The four existing city executors retain their layer/table semantics.
- Vector writes fail before publication, leave the card failed and release the FIFO. The three Task 18 test transitions are documented.

### Strengths

The change preserves the existing execution and publication paths while separating compute and write targets clearly. Tests exercise the real processing queue and geo store; the table FIFO and engine are mocked. The vector stale-key test transparently seeds `done`, as required by the temporary write refusal.

Reported validation includes passing processing/full suites, clean TypeScript and the unchanged lint baseline. No tests were rerun.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

- Strengthen [crossLayerRun.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/crossLayerRun.test.ts) with a following run that reaches `done` after vector refusal and source removal. Current assertions verify failure states but do not directly pin FIFO release. Also hold a predecessor while removing a queued source to distinguish immediate watcher cancellation from the head pre-flight.

### Assessment

**Task quality:** Approved  
**Reasoning:** The production changes satisfy the task’s contracts and preserve existing city-target behavior. The remaining test enhancement is nonblocking; inspection confirms the failure paths release the queue and preserve “Layer removed”.
