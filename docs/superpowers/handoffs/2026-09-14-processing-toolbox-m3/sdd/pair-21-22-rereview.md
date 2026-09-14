### Findings

- **Resolved — Failed/cancelled later runs blocking Undo.** `runQueue.ts` adds `USES_THE_COPY` and applies it to both target and source references. It includes queued/running/**cancelling**/done, matching the commander’s ruling. Added city and vector cases verify failed/cancelled references allow actual Undo; blocking cases cover active references.
- **Resolved — Recent runs’ Undo without a reason.** `RecentRuns.tsx` uses `newLayerUndoBlock` to disable Undo and supply the reason as its title, preserving engine-stopped precedence. Rendered tests use the real predicate and cover blocked and enabled actions.
- **Resolved — A7 captured with the run.** `queueRun` records `targetDerivedFrom` from either layer store; `LogView` and clipboard formatting consume that record. Tests cover retained ancestry without a live target, and the city follow-up case verifies capture during submission.
- **Resolved — Follow-up run on the copy.** The mock registry now resolves adopted tables. The added follow-up case reaches done, asserts writes target the copy’s table rather than the parent, and verifies the creating run’s Undo becomes blocked.
- **Resolved — Permanently held query in the death case.** Both city and vector death tests leave the original promise unresolved, then assert a subsequent run completes while `released` remains false. This establishes queue release within the mocked harness.

### Regressions

None identified in the supplied diff. Task 23’s vector copies retain the shared Undo rules and ancestry lookup through the geo store. Browser evidence and real FIFO/registry integration remain existing coverage limitations. No tests were rerun.

### Assessment — Task 22 quality: Approved

Both Important findings and all three scoped minor improvements are resolved, with no regression identified in this review.
