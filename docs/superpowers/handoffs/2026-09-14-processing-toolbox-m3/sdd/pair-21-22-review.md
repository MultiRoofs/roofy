### Task 21

#### Spec Compliance

Matches the task’s implementation requirements:

- CTAS copies the **parent table**, filtered by feature roots; reader metadata carries `sourceFeatureIds`.
- The model keeps scoped roots and parts without filtering LoDs, retains attributes, and merges results without modifying the parent.
- Subset bounds are recomputed; the bounds test locates copies by publication id. Both `selectedLod` and `lodMode` are copied.
- `derivedFrom` is required, with the fixture sweep present.
- Adoption seeds both registry and ready state without enqueueing. Lifecycle guards exclude derived layers; first-ready watcher coverage exists.
- Inherited provenance is copied under the new id; the `partial` expression uses coverage counts.

The focused browsing check confirms that a flat parent’s `reader: null` does not prevent browsing the adopted copy.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- **Strengthen the behavioral coverage.** [deriveLayer.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/deriveLayer.test.ts:82) replaces the FIFO and adoption machinery. Its model fixtures contain empty surfaces, so they do not demonstrate preservation of actual geometry at multiple LoDs. Add a multi-LoD root-and-part fixture and a preparation/publication case using the real table queue and registry.
- **The shared-counter test does not establish its title’s claim.** [layerTablesBuild.test.ts](/data2/hideba/multiroof-viewer/tests/unit/insights/layerTablesBuild.test.ts:1397) calls `nextTableName()` twice without interleaving an ordinary build. A separate counter would pass those assertions.

### Task 22

#### Spec Compliance

The critical dispatch requirement is satisfied: the New-layer branch follows the executor and abort check, **before both vector publication and the city write**, and returns without reaching either. The six city tools enable `"new"`; Aggregate remains guarded.

The implementation also preserves the three-argument Style-by-result signature, restores destination/name through Edit & run, looks up the published name in both stores, uses the nullable feature-count contract, and renders A15. Card actions target the copy; App consumes the shell’s zoom request.

The copy’s own provenance uses its new id, and Undo’s baseline is captured from fresh state. Undo removes by stored layer id outside the FIFO, so renaming the copy does not change which layer is removed.

The **no-discard catch around publication is a sound deviation**: pre-publication cancellation discards the preparation, while post-publication bookkeeping cannot drop its live table through `discard()`.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

1. **Failed and cancelled later runs incorrectly block Undo.** [runQueue.ts](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:840) checks target/source references without filtering status. A later run rejected before computation—or cancelled while queued—therefore prevents removing an otherwise untouched copy through Undo. This contradicts §6.2’s explicit “queued, running or done” condition. The brief-inherited implementation does not override the specification. Filter the qualifying statuses and test both target and source cases.

2. **Recent runs offers an Undo that silently refuses.** The diff updates [RecentRuns.tsx](/data2/hideba/multiroof-viewer/src/ui/processing/RecentRuns.tsx) only for Edit & run; the new block presentation is confined to RunFooter. The queue refusal [sets `error` on the done record](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:1864), leaving the history action without the required explanation. §5 explicitly ties Recent runs’ Undo to §6.2, so this is not exempt as a separate surface. Apply the same disabled state and reason there, with a rendered history-row regression.

##### Minor (Nice to Have)

- **A7 disappears when the derived target is removed.** [LogView.tsx](/data2/hideba/multiroof-viewer/src/ui/processing/LogView.tsx:49) obtains ancestry from the live layer store. Reopening a retained run’s log after removing that target loses “Derived from …”. Capture this historical context with the run.
- **Integration coverage remains incomplete.** [derivedRun.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/derivedRun.test.ts:107) drives real processing code and application stores, but mocks the table FIFO/registry and executor. Its registry cannot resolve the published copy, so it cannot demonstrate a subsequent run on that copy. The death test also releases the held query immediately, weakening proof that a permanently stranded query releases the queue. No browser evidence establishes actual copy framing or the five-action layout.

### Cross-task

The preparation/publication interfaces align, and neither inherited nor newly published provenance is written onto the parent.

App’s explicit serialization list omits `derivedFrom`, **but that does not omit the derived layer itself**. Layer exclusion, export filtering, and layer-list markers remain Task 24 work; complete write-SQL logging remains Task 27 work. These are later-task dependencies, not failures of this paired task gate.

No tests were rerun; findings follow from the supplied diff and the four permitted focused checks.

### Assessment

**Task 21 quality:** Approved — the required implementation is coherent, with remaining improvements in test strength.

**Task 22 quality:** Needs fixes — publication and destination routing are sound, but Undo eligibility and its history presentation contradict the specification.
