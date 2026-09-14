### Findings

- **Resolved — independent Undo orders.** `crossLayerRun.test.ts` adds separate A→B and B→A cases using `twoDisjointRuns`; both begin with both results present and check surviving values, removed keys, Undo ownership, and registry membership after each step.
- **Resolved — relink while Undo waits.** The replacement test holds the FIFO with `gate.promise`, requests Undo, relinks, then releases the gate. It asserts the replacement document survives and the card loses Undo without claiming `"Undone"`.
- **Resolved — config transition count.** `configTransitions` subscribes before publication; assertions require exactly one transition for a two-feature merge and zero for an unmatched ID.
- **Resolved — key absence.** Restoration assertions now use `Object.keys(...).not.toContain(...)`, rejecting keys retained with `undefined`.
- **Resolved — prepared-input purity.** Merge snapshots the actual `preparedData` input and checks copy-on-write identities; restoration snapshots the shared input across both independent calls.
- **Resolved — displayed values and filter/sort.** Records assertions verify `["7", "3"]`, ascending `["3", "7"]`, and filtering `> 5` to `["7"]`; Details asserts `3` inside the computed group.
- **Resolved — Task 17 point→polygon parity.** The added integration case measures the same point and source through core `ST_Distance` and `buildDistanceSql` with `centre`, requiring distance `50` and nearest ID `"b"`.

### Regressions

None found in the test-only diff. One inaccurate new comment says B’s snapshot predates A’s write, although the helper completes A before submitting B; the assertions remain valid. Reported test results were not independently verified; no suite was rerun.

### Assessment — Task 18 quality: Approved

The fix resolves the scoped coverage gaps, with no functional regression identified.
