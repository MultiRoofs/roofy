Plan references below are to [the amended plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md). This was a static review; no implementation tests were run.

| Round-1 finding                 | Status             | Amended-plan evidence                                                                                                        |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Retry generation             | Partly             | Correct implementation at 26878; front matter 1140 and documentation 28302 still prescribe pre-boot capture.                 |
| 2. Impossible Undo intersection | Resolved           | Nested union at 23760; both publication sites wrapped at 23789, 23807.                                                       |
| 3. Stale provenance snapshot    | Resolved           | Fresh store read at 23637 before collecting run IDs.                                                                         |
| 4. Streaming retarget           | Resolved           | Form refusal at 21123–21128 and Task 20 execution preflight.                                                                 |
| 5. Bounds and LoD               | Partly             | Bounds at 22751 and complete LoD state at 22857; amended bounds test is incorrect at 22493.                                  |
| 6. Vector name/count            | Partly             | Both-store lookup at 23611 and count correction in Task 23, 25200 onward; destination remains unreachable.                   |
| 7. Ordinary-layer log menu      | Resolved           | Explicit preservation of `undefined` at 25570.                                                                               |
| 8. Retained column reveal       | Partly             | Acknowledgement protocol at 27939–27975; stale pending-request regression remains.                                           |
| 9. Derived write logging        | Partly             | Recorder wired at 27691–27722; failed COMMIT logging remains incomplete.                                                     |
| 10. Stale palette callback      | Resolved           | Click-time store read at 27387–27395. Its regression test still needs repair.                                                |
| 11. Incomplete tests/hooks      | Partly             | Several repairs landed, but missing helpers/imports and an incorrect test path remain below.                                 |
| 12. Source-string FIFO test     | Resolved           | Behavioral queue test at 22514 onward.                                                                                       |
| 13. Invalid-solid fixture       | Resolved           | Task 29, 28415 onward, separates the skipped-part case from the invalid-solid fixture.                                       |
| 14. Log-label copy              | Resolved by ruling | Labels remain at 22648 and 22684; M3 ledger ruling 22 explicitly permits descriptive log labels. No §6.4 sentence is broken. |
| 15. Background suites           | Partly             | App suites backgrounded; Task 29’s full plugin suite remains foreground at 28439.                                            |

1. **CRITICAL — Tasks 22–23, 23561–23580, 25156–25200:** The New-layer branch is inserted into the **city write path**, after Task 18’s vector publication and unconditional return (18311–18410). Aggregate therefore modifies the original vector layer and never reaches `prepareDerivedVectorLayer`; the later vector discrimination also contradicts the narrowed target type. Move destination dispatch before either This-layer publication. Test that Aggregate/New layer leaves the original document unchanged.

2. **MAJOR — Task 20, 21106–21107, 21147–21154:** Cross-strand form integration uses an obsolete city-only contract. Task 15 deliberately makes `target === null` for vector targets (15285), so Aggregate receives an empty suggested name. The replacement `runReason` also drops Task 15’s `targetReason` and `sourceReason` (15529–15530). Use `targetName` and preserve both validation gates.

3. **MAJOR — Task 22, 24451–24462:** The prescribed replacement restores `start(run, column: string)`, but Task 9 defines `start(run, column: OutputColumn, descriptor: StyleByResult)` at 7761. The replacement either cannot match or breaks the revised callers/body. Change only the layer-ID expression within Task 9’s actual signature.

4. **MAJOR — Task 24, 25886–25904:** Only workspace-save serialization filters derived layers. Existing `App.tsx:1498` share serialization includes every URL-backed city layer; derived cities inherit the parent’s `modelRef`. Sharing consequently restores the full parent under the derived name, violating §8’s exclusion from share links. Filter derived layers in the share path and test the decoded share payload.

5. **MAJOR — Task 27, 28173–28194:** `enqueuedVersions` records success before the build succeeds. A failed rebuild can retain the previous ready table (`layerTables.ts:1178–1193`), but subsequent consumer openings now skip that version indefinitely. Track successful versions separately from pending builds; clear pending state on failure. Test failed rebuild → reopen consumer → successful retry without another stream commit.

6. **MAJOR — Task 26, 26922, 27274:** Save delegates entirely to `ensureRulesMode`, which changes only `"surface"`. A Style-by-result draft saved while `"single"` remains visually inactive, contrary to §6.2’s Rules behavior. Switch mode when saving a result draft while preserving manual-rule semantics. Otherwise explicitly record this additional spec deviation; it is absent from the listed M3 rulings.

7. **MAJOR — Tasks 24, 26–27, 25931, 27406–27416, 28009–28046:** The executable-test claim remains false. `tests/unit/insights/sql.test.ts` does not exist—Task 9 explicitly identifies the correct suite. `renderEditor()` and `colorInput()` are undefined, and the palette test presses Save without naming the rule. DataGrid uses `useRef` but the import instructions add only `useCallback` and `useEffect`. Supply complete test code, the real test path, required form input, and all imports.

8. **MAJOR — Task 21, 22484–22494:** The amended bounds test checks the wrong layer. Each publication inserts immediately after the parent, so publishing `whole` puts it at index 1 and moves the subset to index 2. The assertion expects whole-parent bounds from the subset. Locate each copy using the ID returned by `publish()`.

9. **MAJOR — Task 25, 26774–26779:** The post-COMMIT death regression does not establish its claimed timing. `sql.some(DESCRIBE)` can match the forward run’s earlier refresh, so death may occur before Undo reaches its post-COMMIT refresh. Clear the trace before Undo and wait for a dedicated refresh gate after observing Undo’s COMMIT.

10. **MAJOR — Task 27, 27614:** Failed COMMIT returns omit the attempted COMMIT and subsequent rollback: COMMIT is outside the statement loop, and the instructions append it only on success. Record it immediately before invocation; record rollback only when actually issued. Add failure-path assertions, including derived writes.

11. **MINOR — Task 27, 27950–27954:** A newly acknowledged reveal returns without deleting an older pending request for that layer. A later drain can scroll back to the previous run’s columns. Replace pending state before delivery and delete it on acknowledgement; test pending A → immediately honoured B → drain.

12. **MINOR — Tasks 28–29/front matter, 1140, 28302, 28439, 28578:** Documentation contradicts the corrected Retry implementation, the plugin suite still violates the background-only rule, and “Nothing else … is unaccounted for” omits the accepted no-recovery deviation. Correct the boot-order description, background the plugin suite with exit-status collection, and list the deviation accurately.

The binding streaming restriction contradicts §6’s promised static streaming snapshot; the binding M2 no-recovery ruling contradicts §6.1’s promise that Retry rebuilds tables. Those decisions remain accepted, not reopened; the latter needs inclusion in the final coverage accounting.

Citation spot-checks matched `layerTables.ts:80–98`, `:420–436`, `:767–857`; `duckdb.ts:150–187`, `:681–697`, `:724–745`; and `layerStore.ts:327`. The previously incorrect optional-ID fact is corrected. The incorrect test-file reference and nonexistent helper references are reported in finding 7.

Fix first
