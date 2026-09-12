### Finding Verdicts

**(1) Engine awaits release after death** — **NOT ADDRESSED.** The simple death cases are fixed, but `releasedOnDeath` falls back to an unguarded `await promise` when Cancel arrives while the engine is ready (`src/features/processing/runQueue.ts:152–157`). If the worker then dies during that write or DESCRIBE, the already-aborted signal cannot fire again: the card fails, but `execute` still blocks the FIFO forever. The added tests exercise death without an earlier Cancel. ROLLBACK suppression is implemented at `src/insights/computedColumns.ts:138`.

**(2) Dead-engine continuations cannot mutate or publish current state** — **NOT ADDRESSED.** Clearing extension memos and identity-based deletion are implemented, and the stale initialization catch preserves the death reason (`src/insights/duckdb.ts:152–156`, `:398–400`, `:470`). However, `doInit` assigns `platform` and `loadedExtensions` before checking generation (`:389–391`); `ensureExtension` likewise assigns `loadedExtensions` before its check (`:463–464`). A metadata read released after death/Retry can overwrite the new engine’s shared metadata, which a subsequent `publishReady()` publishes (`:201–206`). Await into locals, check generation, then assign. The rejecting-init Minor is addressed.

**(3) Watch only the immediately preceding ready → failed transition** — **ADDRESSED.** `previous` is seeded at installation and updated on every publication before testing the transition (`src/features/processing/runQueue.ts:1052–1058`). The added regression explicitly exercises ready → failed → initializing → failed (`tests/unit/features/processing/runQueue.test.ts:1695`).

**(4) Invalidated tables remain failed after Retry** — **NOT ADDRESSED.** The subscriber immediately invalidates ready/building/queued entries and removes registry entries (`src/insights/layerTables.ts:417–437`), but does not supersede their queued or active builds. A build queued behind the dying run subsequently overwrites failed with building, calls `initDuckDB()`, and can publish ready (`:838–863`, `:917–918`). Active-build failure paths can also restore a captured ready entry or park a source for Retry (`:940–967`). This defeats the required persistent invalidation. The added test covers one completed ready table, without Retry or pending builds (`tests/unit/insights/layerTablesBuild.test.ts:984`).

### New Breakage in the Fix Diff

- **Important — Cancel followed by death strands the FIFO.** The new live-engine fallback introduces the unprotected wait described in finding 1. Death needs an independently observable signal even after user cancellation.
- **Minor — Subscriber installation lacks hot-reload cleanup.** `src/insights/layerTables.ts:432` discards the unsubscribe function; reevaluation with the DuckDB module retained leaves the previous subscription installed. Capture it and dispose it on hot reload. The updated test mock does install the subscriber, but `resetLayerTablesForTest()` also leaves its previous-state tracker unchanged (`:439–447`).

Ordinary live-engine cancellation semantics remain intact: the write’s pre-COMMIT check handles cancellation, and successful completion records “finished before the cancel arrived” (`src/features/processing/runQueue.ts:718–731`, `:837`). “Layer removed” retains precedence through the terminal guard and completion readback (`:313–317`, `:844–853`).

No second DuckDB-status publisher or new non-`duckdb.ts` import of `@duckdb/duckdb-wasm` appears in the diff.

The report’s “Fix round 1” records covering-test results and the final **235 files passed / 2 skipped; 2881 tests passed / 31 skipped**. The added tests match the reported simple scenarios, but do not cover the gaps above. Tests were not rerun.

### Out-of-Scope Observations

The report’s existing concerns about never-settling table-build queries and non-processing query callers remain outside this fix review. Preventing pending builds from overwriting the **new invalidation**, however, belongs to finding 4.

### Verdict

**Fix round:** Findings remain open
