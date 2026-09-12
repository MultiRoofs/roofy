### Finding Verdicts

**(i) Invalidation follows engine death, including initialization deaths** — ADDRESSED. `src/insights/layerTables.ts:422` invalidates every nonfailed entry; `:452` subscribes through `onEngineDeath` and re-arms synchronously before invalidation.

**(ii) Queued builds abandon on invalidation, death since enqueue, or generation change** — ADDRESSED. All three checks precede `building` and `initDuckDB` at `src/insights/layerTables.ts:981`. The regression at `tests/unit/insights/layerTablesBuild.test.ts:1234` checks no intermediate `building`, no initialization calls after death, and no second-table SQL.

**(iii) Pre-ready builds distinguish death from unsuccessful boot** — ADDRESSED. The post-initialization guard precedes parking at `src/insights/layerTables.ts:1011`; successful initialization binds the generation at `:1033`. The regression at `tests/unit/insights/layerTablesBuild.test.ts:1277` verifies engine-stopped failure and nothing revived by Retry.

**(iv) Removal owns the entry during abandonment** — ADDRESSED. `src/insights/layerTables.ts:959` checks `superseded()` before writing failed state. The cleanup regression at `tests/unit/insights/layerTablesBuild.test.ts:1312` observes intermediate store values, preventing a transient recreated entry from passing unnoticed.

**(v) Replacement-test DESCRIBE identifies its own build** — ADDRESSED. `tests/unit/insights/layerTablesBuild.test.ts:1175` uses the `layer_2` reader prefix for both the hold and the wait.

### New Breakage in the Fix Diff

No new Critical/Important breakage found.

Re-arming has no asynchronous gap: `duckdb.ts:163` dispatches a snapshot and removes each listener before calling it; the callback immediately registers its successor. Each build captures its own immutable death count (`layerTables.ts:927`), so earlier deaths do not permanently poison later builds.

The 26 other mock edits only add inert subscriptions returning disposers; no assertions or existing behavior are removed.

The round-four report’s Gates section records **1222 focused tests passed**, **74 additional tests passed / 31 skipped**, clean typechecking, **0 lint errors / 56 warnings**, and **2911 passed / 31 skipped** overall. The diff contains the three required regression cases and the corrected replacement test. Tests were not rerun.

### Out-of-Scope Observations

Previously reported never-settling table-build/query awaits and unguarded `refreshLayerTableColumns`/`retryEngine` continuations remain outside this review.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage
