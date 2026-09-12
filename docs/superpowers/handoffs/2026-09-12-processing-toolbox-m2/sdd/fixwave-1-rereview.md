### Finding Verdicts

- **[F1 — Build and cleanup waits release on engine death] — ADDRESSED.** `src/insights/layerTables.ts:80` wraps all build/cleanup engine primitives, including column refresh; abandonment catches cover boot and cleanup rejection at `:1200`. `src/insights/engineAwait.ts:65` preserves the original race: listeners are disposed on fulfillment, rejection, cancellation and death; an already-aborted signal installs none. The module imports only the engine facade, and `runQueue.ts:40` uses the shared implementation without changing execution behavior.

- **[F2 — Offline boot exposes failed extensions and Retry] — ADDRESSED.** `src/insights/duckdb.ts:346` checks guarded `navigator.onLine === false` once, immediately before ready publication at `:495`. Both unloaded lazy extensions receive the exact download sentence from `:323`. No automatic online-event clearing was added. Retry retains `ensureExtension`; subsequent load failures preserve the user-facing download reason through the existing chip rendering.

- **[F3 — Style median excludes part rows] — ADDRESSED.** `src/insights/sql.ts:439` applies `feature_id IS NULL OR feature_id = id`; `src/ui/processing/RunFooter.tsx:52` uses it. The convention is supported by `src/domain/citymodel/featureId.ts:6,46`, the flat-row writers at `src/insights/layerRows.ts:162,183`, and the reader schema documented in `docs/superpowers/specs/2026-09-04-duckdb-integration-design.md:61`. The real-DuckDB unequal-part probe at `tests/integration/duckdb/computedColumns.test.ts:545` verifies row median **10** versus root median **6**; `ToolView.test.tsx:553` pins the footer’s filtered query.

- **[T1 — Unresolved statement regression proves FIFO release] — ADDRESSED.** `tests/unit/insights/layerTablesBuild.test.ts:1161` leaves the held CREATE promise unresolved, enqueues another build before death, and verifies engine-stopped failure, registry removal, no further SQL and settlement of the queued build. The report records timeout RED and covering GREEN results.

- **[T2 — Offline chip and recovery tests] — ADDRESSED.** `tests/unit/ui/processing/extensionChip.test.tsx:237,279` exercises real `duckdb.ts` publication through the hook, asserting both failed chips, exact reasons, Retry controls, extension-free eligibility and recovery only after Retry. The existing online baseline remains. The report records both RED failures and 8/8 GREEN.

- **[T3 — Streaming resident-set execution and staleness] — ADDRESSED.** `tests/unit/features/processing/roofMetricsRun.test.ts:454` registers the real executor; cases at `:706,788` use an empty model and LoD-tagged resident records, verify root/part output rows, one measured feature, resident-set summary and stale/non-undoable state after replacement. The real streaming branch at `src/features/processing/roofGeometrySource.ts:67` executes. Resident storage, DuckDB and table rebuilding are boundary mocks; this is not an FCB browser smoke. Literal stale rendering is separately pinned at `tests/unit/ui/processing/RecentRuns.test.tsx:144`. The report names mutation checks and 9/9 GREEN.

- **[T4 — Macrotask cancellation prevents the second batch] — ADDRESSED.** `tests/unit/features/processing/roofMetricsRun.test.ts:651` schedules Cancel with `setTimeout(0)` at the batch boundary and asserts exactly one batch measured, no attributes/provenance and no transaction. The report records the yield/check-order mutation failure.

- **[T5 — Zero-threshold horizontal roof behavior] — ADDRESSED.** `tests/unit/domain/roofRollUp.test.ts:41` asserts zero flat area/share and dominant azimuth **135°** at threshold zero; the threshold-boundary case also checks azimuth. The report records the `<` → `<=` mutation failure and 9/9 GREEN.

- **[T6 — Roadmap reflects the fixes] — ADDRESSED.** `docs/roadmap.md:653` records the root-only median correction; `:673` distinguishes reachable offline chips/Retry from deferred extension-failure run copy.

The report names covering tests, supplies failure excerpts and GREEN/mutation summaries, and reports **2983 passed, 32 skipped**, plus **11/11** opt-in DuckDB tests (`fixwave-1-report.md:210–219`). These agree with the diff’s additions; tests were not rerun.

### New Breakage in the Fix Diff

None.

### Out-of-Scope Observations

`retryEngine()`’s unraced `bootEngine()` wait (`src/insights/layerTables.ts:773`) preserves base behavior and the owner’s explicit unchanged-Retry decision. This is appropriate for this wave: it holds no FIFO task and avoids introducing an unhandled death rejection into `void` callers. Its existing boot-death hang and missing generation check remain outside scope.

### Verdict

**Fix wave:** All findings addressed, no new Critical/Important breakage — open items: none.
