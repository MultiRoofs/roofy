### Spec Compliance

The diff implements additive worker `error`/`messageerror` detection, failed status publication, exact run failure copy, and both disabled Undo buttons. Retry remains unchanged, consistent with the owner’s narrowed scope. However, containment leaves pending work suspended, and the watcher does not strictly detect `ready → failed`.

⚠️ The package contains commit subjects, not full messages, so trailer compliance cannot be verified. Reported test results were not rerun. (`.superpowers/sdd/2026-09-11-processing-toolbox-m2/review-75b2221..b64fd35.diff:3`)

### Strengths

- Detection uses the worker’s own events additively and correctly acknowledges that pending queries do not reject. Connections are cleared before publishing failure. (`src/insights/duckdb.ts:142`, `src/insights/duckdb.ts:315`)
- Installation/disposal follows the removal watcher’s pattern. Patching before abort preserves the engine-death reason through the existing terminal guard; the watcher itself performs no database cleanup. (`src/features/processing/runQueue.ts:247`, `src/features/processing/runQueue.ts:968`)
- Both Undo locations subscribe to the store flag and share the exact adapted copy. Keeping that flag set after Retry is correct: rebooting cannot restore lost backups. (`src/features/processing/processingStore.ts:230`, `src/ui/processing/RunFooter.tsx:311`, `src/ui/processing/RecentRuns.tsx:75`, `src/ui/processing/runFormat.ts:28`)
- Watcher tests exercise the actual processing queue and store, including queued/running records and installer disposal. (`tests/unit/features/processing/runQueue.test.ts:1494`)

### Issues

#### Critical (Must Fix)

None identified.

#### Important (Should Fix)

1. **Plan-mandated: abort does not release an in-flight database await.** The watcher aborts the controller, but scope queries, extension loading, and computed-column writes await promises without racing a death signal. During a write, execution remains at `await step(...)`; it never reaches the abort check, ROLLBACK, or cleanup. The shared table queue remains occupied even after Retry. A ROLLBACK started _after_ death would fail fast; the problem is reaching it. The new test resolves its held query after checking record statuses, masking this exact failure. Add a never-settling-query case that verifies execution releases without issuing cleanup against the dead engine. (`src/features/processing/runQueue.ts:516`, `src/features/processing/runQueue.ts:545`, `src/features/processing/runQueue.ts:992`, `src/insights/computedColumns.ts:175`, `src/insights/computedColumns.ts:185`, `tests/unit/features/processing/runQueue.test.ts:1520`)

2. **Plan-mandated: extension promises survive their dead engine.** `markEngineDead` resets extension status but leaves `extensionPromises` intact. A pending INSTALL/LOAD never settles, so its `.finally` never removes the memo. After successful Retry, `ensureExtension` returns that old pending promise indefinitely. Retire extension memos with the engine and prevent old continuations from mutating a replacement engine’s state. (`src/insights/duckdb.ts:142`, `src/insights/duckdb.ts:375`, `src/insights/duckdb.ts:401`)

3. **The watcher violates the required transition rule.** `sawReady` never resets. Following `ready → failed → initializing → failed`, it treats the failed retry boot as another engine death, potentially failing newly queued records and publishing another store update. Track the immediately preceding state and test that sequence. (`src/features/processing/runQueue.ts:971`)

4. **Plan-mandated: catalogue tools re-enable against missing tables after Retry.** The brief promises disabled tools until reload, but eligibility reads the rebooted engine’s `ready` state while existing table entries remain unchanged. `retryEngine` rebuilds only pending sources. Thus a previously eligible tool becomes available against a table absent from the replacement database. Containment needs an availability gate or table invalidation; rebuilding tables is not required to fix this. (`src/features/processing/eligibility.ts:45`, `src/ui/processing/useEligibilityContext.ts:44`, `src/insights/layerTables.ts:624`)

#### Minor (Nice to Have)

- **Death publication is not idempotent across initialization paths.** If an in-flight initialization rejects after the worker event, `doInit` publishes another failure and overwrites the original reason. The repeated-event test covers only repeated handler calls. Guard initialization completion against an already-retired engine. (`src/insights/duckdb.ts:340`, `tests/unit/insights/useDuckDBStatus.test.tsx:331`)

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The visible failure state and Undo behavior are implemented cleanly, but aborting does not release pending engine work, and stale extension memos survive reboot. The watcher also misses the explicitly required transition semantics; several defects originate in the prescribed plan rather than implementation drift.
