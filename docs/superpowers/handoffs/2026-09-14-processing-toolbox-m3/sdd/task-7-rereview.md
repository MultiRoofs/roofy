### Findings

- **Resolved — all-NULL areas rolling up to zero.** In `solidRollUp.ts`, envelope and footprint now start at `null` and accumulate only non-NULL values. The diff adds tests for all-NULL areas, mixed NULL/numeric areas, genuine zero, and NULL output through the executor.
- **Resolved — cancellation/death coverage through the executor and queue.** `measureSolidsRun.test.ts` uses the real executor, processing queue, and `readSource`, with mocked engine and table FIFO. Cancellation occurs during a gated measure query; engine death interrupts a query left unresolved. Both cases assert source-drop invocation, no publication, and successful subsequent execution. Cancellation cleanup is tested after the pending query settles. The mocked `dropBuffer` resolves immediately, so these tests do not independently prove cleanup against a hanging drop operation.
- **Volume claim is correct.** Although volume starts at `0`, any NULL contributor sets it to `null`; subsequent numeric contributors cannot change it back. Therefore all-NULL volume remains NULL. With no measurable contributors, the function returns `null` before accumulation.

### Regressions

None identified in the scoped diff. The only production behavior change is the area accumulation fix. Tests were not rerun.

### Assessment — Task quality: Approved

The fix resolves the area NULL contract and adds meaningful executor-through-queue cancellation and death coverage without an identified regression.
