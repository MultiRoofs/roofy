### Strengths

- The publisher/subscription design follows the rewritten ONE-writer rule, with isolated listeners and generation guards.
- Roof metrics has clear separation between geometry access, pure roll-up, parameter normalization and bounded execution. Static and streaming inputs share the geometry-keyed contributor rule.
- The previous findings are addressed: table-build death races, offline-boot extension publication, root-only median, realistic resident fixtures and macrotask cancellation coverage.
- Reported gates are strong: 2,983 application tests passed, 840 plugin tests passed, 32 real-DuckDB probes passed, clean type-checking and unchanged lint baseline. These are reported results; I did not rerun them.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

1. **Streaming processing depends on opening the table panel.**  
   [layerTableLifecycle.ts:86](/data2/hideba/multiroof-viewer/src/features/layers/layerTableLifecycle.ts:86), [useToolForm.ts:115](/data2/hideba/multiroof-viewer/src/ui/processing/useToolForm.ts:115)

   Streaming commits rebuild tables only while `tablePanelOpen` is true. Tools reads its scope from that table, while its LoD options read current residents. Consequently, opening Tools directly can show zero buildings and disable Run; after closing the table and panning, processing can use outdated rows against newer geometry. Result staleness also depends on a table rebuild.

   This violates §7.1/scenario 4 independently of the approved FCB write-back deferral. The smoke record documents the prerequisite but incorrectly dismisses it as “not a bug.” The plan missed this lifecycle integration.

   **Fix:** make processing an explicit consumer of streaming-table freshness, synchronize table and geometry snapshots before execution, and invalidate affected results when residents change. Test initial loading and subsequent panning with the table panel closed.

2. **Undo and backup cleanup still have engine waits that can strand the FIFO.**  
   [runQueue.ts:426](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:426), [runQueue.ts:937](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:937)

   `discardUndo()` queues an unprotected `runQuery()`, and `undoRun()` awaits `undoComputedColumns()` without a death race. Its transaction awaits raw engine queries. If the worker dies during either operation, the shared FIFO can remain occupied indefinitely. Disabling Undo after death does not release an Undo already running.

   **Fix:** apply the independent death race to these FIFO-owned operations, handle death without further SQL or model publication, and add regressions that leave the underlying request permanently unresolved while proving the next queued task settles. This completes the queue protection; it does not require engine recovery.

#### Minor (Nice to Have)

1. **The promised keyboard-visible failure tooltip is still missing.**  
   [CatalogueView.tsx:170](/data2/hideba/multiroof-viewer/src/ui/processing/CatalogueView.tsx:170), [processing.css:202](/data2/hideba/multiroof-viewer/src/ui/processing/processing.css:202)

   The Task 3 ruling required an accessible description **and** a focus-visible tooltip. The description is present, but remains permanently clipped; native `title` does not provide a reliable keyboard-visible explanation. Sighted keyboard users therefore miss the download reason.

   **Fix:** reveal the explanation on keyboard focus while retaining `aria-describedby`.

2. **Architecture documentation still describes the fixed table-build hang as outstanding.**  
   [architecture-notes.md:291](/data2/hideba/multiroof-viewer/docs/architecture-notes.md:291)

   It says wiring death races into table builds is future work and only the run queue races death. This contradicts the final implementation and could misdirect maintenance.

   **Fix:** document the completed build protection and distinguish the remaining unprotected callers.

### Deferred/parked triage

- **Task 15 scenario-4 acceptance must be corrected:** requiring the table panel to populate processing scope masks a §7.1/scenario-4 failure. Fix the lifecycle integration and repeat that scenario without the prerequisite.
- **Task 4’s never-settling-wait deferral must exclude FIFO-owned Undo/cleanup:** those remaining queue waits require the protection described above.
- **Remaining deferred/parked items: may ship**—including non-queue export/count waits, unchanged Retry/no recovery, FCB write-back, defensive area handling, optional test cases, nonnumeric LoD ordering, M3-only concerns, tooltip polish, report/documentation corrections and the explicitly unmet offline-Retry browser check. Previously fixed ledger findings remain closed.

### Recommendations

Add focused regressions for the two important issues, then repeat the streaming smoke with the table closed. Preserve the distinction between injected offline status and actual worker-network failure when reporting scenario 6.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The milestone is substantially implemented and well tested, but streaming processing still lacks independent table freshness, and two FIFO operations remain vulnerable to engine death. Both require fixes before merge.
