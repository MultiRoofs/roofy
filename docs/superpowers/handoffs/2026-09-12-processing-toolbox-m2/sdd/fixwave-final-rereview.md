### Finding Verdicts

**[I1 — Toolbox participates in streaming-table builds]** — ADDRESSED. `src/features/layers/layerTableLifecycle.ts:135` implements the three-way gate; `:157` rechecks it when the debounce fires; `:247` subscribes to toolbox opening and invokes the shared sweep. Tests cover toolbox-only commits, subsequent rebuilds, closed consumers, and in-flight runs. The literal combined stale-card test was not added, but `tests/unit/features/processing/runQueue.test.ts:1198` covers rebuild→stale, and `scripts/smoke/processing-m2.md:41` records that chain with the table panel closed.

The unconditional sweep is acceptable under the controller’s explicit instruction to mirror panel opening and M1’s rebuild→computed-column-loss rule. Reopening Tools can retire an unchanged stream’s finished result; that is a documented cost, not an additional blocking defect under this ruling. These changes rebuild tables from residents; they do not trigger streaming commits or alter moveend, settle suppression, or the 30-second liveness bound.

**[I2 — Undo and backup cleanup abandon safely on engine death]** — NOT ADDRESSED. The FIFO-liveness portion is fixed: `src/features/processing/runQueue.ts:434` races backup DROP, and `:951` races the Undo transaction. The two never-settling regressions verify queue release and mid-transaction nonpublication.

However, `src/insights/computedColumns.ts:244` still awaits each statement without a death race; `:140` likewise awaits rollback without one. Racing the enclosing promise releases its caller but does not unwind the inner operation. More directly, `runQueue.ts:972` catches death during refresh and deliberately proceeds to model/provenance publication at `:989` and the “Undone” patch at `:1005`, contradicting the brief’s explicit no-publication-on-death requirement. Neither regression covers that path. There is no `finally` in `undoRun` or `undoComputedColumns`; an outer race cannot make an inner cleanup execute.

**[m1 — Failure reason becomes keyboard-visible]** — ADDRESSED. `src/ui/processing/processing.css:180` enables wrapping, `:193` uses zero flex basis with `min-width: 0`, and the focus-within rule reveals the description below both controls. `src/ui/processing/CatalogueView.tsx:172` retains the description markup; `tests/unit/ui/processing/extensionChip.test.tsx:398` checks its text, accessibility visibility, and shared wrapper. The smoke record reports stable row/Retry positions and the intended wrapper-height increase.

**[m2 — Architecture notes acknowledge protected table builds]** — ADDRESSED. `docs/architecture-notes.md:291` replaces the obsolete table-build-hang claim, describes raced builds and cleanup, and names remaining off-queue callers and `retryEngine`’s boot wait.

The implementer report names covering tests and gives RED/GREEN result summaries, plus full-suite output totals: **243 files passed, 2 skipped; 2,994 tests passed, 32 skipped**, and **32 integration tests passed** (`fixwave-final-report.md:279`). The diff contains the reported eleven added tests: nine lifecycle and two queue regressions. These are reported summaries, not reproduced raw logs; no tests were rerun.

### New Breakage in the Fix Diff

**Important — `src/features/processing/runQueue.ts:973`: publication after engine death.** When Undo commits and the engine dies during column refresh, the new catch swallows `EngineDeadError`, then restores model attributes, changes provenance, and marks the card “Undone.” Return without publication on this death path and add a never-settling refresh regression asserting the watcher’s card/model state remains intact.

### Out-of-Scope Observations

The smoke record’s previously observed stream-planning failure and the report’s unrelated formatting failures remain outside this fix review.

### Verdict

**Fix wave:** Findings remain open
