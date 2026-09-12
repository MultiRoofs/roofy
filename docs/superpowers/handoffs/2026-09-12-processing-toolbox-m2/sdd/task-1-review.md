### Spec Compliance

The implementation substantially follows Task 1: it centralizes publication, removes App’s mirror, subscribes eligibility inputs, preserves `retryEngine()`, and updates the hard rule. The pre-boot guard and regression test implement `c22cb02`’s required fix (`src/insights/duckdb.ts:325`; `tests/unit/insights/useDuckDBStatus.test.tsx:175`).

Two focused checks covered surviving mirror readers and omitted DuckDB mocks. App still passes the hook’s value downstream; no surviving setter was found (`src/app/App.tsx:285`, `src/app/App.tsx:2285`). One mock violates the controller’s explicit EVERY-factory requirement, detailed below.

⚠️ Reported test/typecheck results and commit metadata are not independently established by the diff. No tests or git commands were rerun. Browser rendering and server hydration were not verified.

### Strengths

- The hook uses stable module functions and a numeric snapshot, with a server snapshot supplied. It reads the owned value without creating component state (`src/insights/useDuckDBStatus.ts:25`).
- Publication assigns the value and increments the version before notifying subscribers; unsubscribe removes the registered callback (`src/insights/duckdb.ts:102`, `src/insights/duckdb.ts:111`).
- The package-boundary fake exercises real boot and extension logic. Tests cover ordered publications, failures, retry, concurrent-load deduplication, and pre-boot behavior; they import from `vitest` and restore globals (`tests/unit/insights/useDuckDBStatus.test.tsx:8`, `tests/unit/insights/useDuckDBStatus.test.tsx:17`, `tests/unit/insights/useDuckDBStatus.test.tsx:80`).
- Eligibility now subscribes unconditionally, and App’s updated comments correctly describe Retry without claiming ready-engine reboot or cancellation behavior (`src/ui/processing/useEligibilityContext.ts:35`; `src/app/App.tsx:904`).

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

1. **Plan-mandated: subscriber exceptions can break engine operations.**  
   `src/insights/duckdb.ts:108` invokes listeners without isolation. One throwing listener skips subsequent subscribers and propagates into initialization or extension loading. The initial publication occurs before `doInit`’s `try`, so an exception aborts boot while status remains `initializing` (`src/insights/duckdb.ts:232`). A throw during failure publication also prevents worker cleanup and memo reset (`src/insights/duckdb.ts:275`). Catch/report errors per listener while continuing notification, and add a regression proving observer failure cannot interrupt engine work.

2. **The omitted mock violates the controller’s EVERY-factory requirement.**  
   `tests/unit/ui/table/useLayerCounts.test.tsx:5` exports only `runQuery`; both `subscribeDuckDBStatus` and `getDuckDBStatusVersion` are missing. The brief’s carve-out and report’s claimed acceptance conflict with the explicit review instruction, which takes precedence. Add the two exports even though this test currently does not reach the hook.

#### Minor (Nice to Have)

1. **The unmount test does not assert subscription cleanup.**  
   `tests/unit/insights/useDuckDBStatus.test.tsx:229` only checks that an extension loads after unmount. A leaked listener could still pass; absence of a warning is not asserted either. Observe the hook’s unsubscribe callback directly.

2. **The copied-Set explanation is inaccurate.**  
   `src/insights/duckdb.ts:105` says self-unsubscription would skip the following listener during Set iteration. Deleting the current entry does not do that. Describe the copy as fixing notification membership for the current dispatch instead.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The main subscription design and pre-boot correction are implemented well. Listener exceptions can disrupt engine lifecycle, and one mock misses an explicit controller requirement.
