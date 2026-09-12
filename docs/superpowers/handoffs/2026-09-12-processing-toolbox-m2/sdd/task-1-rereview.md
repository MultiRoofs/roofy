### Finding Verdicts

**(1) Listener exceptions are isolated** — ADDRESSED. `src/insights/duckdb.ts:106–120` catches each listener separately and continues notification. `tests/unit/insights/useDuckDBStatus.test.tsx:208–249` proves successful boot, later-listener notification, failed-boot Worker termination, and retry.

**(2) Missing mock exports added** — ADDRESSED. `tests/unit/ui/table/useLayerCounts.test.tsx:11–12` supplies both subscription exports.

**(3) Unmount cleanup directly asserted** — ADDRESSED. `tests/unit/insights/useDuckDBStatus.test.tsx:292–317` wraps real subscriptions, requires at least one subscription, and asserts every unsubscribe runs exactly once.

**(4) Copied-Set comment corrected** — ADDRESSED. `src/insights/duckdb.ts:103–105` accurately describes frozen membership for the current dispatch.

### New Breakage in the Fix Diff

None. Both throwing-listener tests suppress `console.error`, preventing added output noise. `afterEach` restores spies after React cleanup; the package factory and plain fake classes remain unaffected.

`task-1-report.md:290–327,383–388` names both covering files and records passing results: 12 status tests and 14 tests across both files, consistent with the diff’s two added tests. It also records full-suite results. Tests were not rerun.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage
