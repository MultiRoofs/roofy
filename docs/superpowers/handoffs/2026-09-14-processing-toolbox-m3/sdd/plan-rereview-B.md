**Fixes remain before execution.** Line numbers below refer to the [reviewed plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md).

1. **MAJOR — Tasks 16–19, lines 16705–16718, 17547–17554, 20024–20030:** Source-ID validation still contradicts the latest ruling. Join/Distance compare against `ctx.featureIds ?? []`, making All unchecked; Aggregate omits validation. Moreover, the final join restores browsing-table IDs, masking a missing part when another contributor survives. Compare raw reader IDs against independently read scoped table IDs, before feature roll-up. Test missing roots and parts under All, Selected and Matching. Correct Self-review 28624–28625: changed IDs are **not** §6.1’s unchanged-ID limitation.

2. **MAJOR — Task 18, lines 18473–18509:** Queued vector Undo rechecks only layer existence/kind. While it waits, another run can overwrite the same column and revoke its Undo; the captured callback nevertheless erases that newer result. Recheck current `undoable`, retained Undo state and source-document identity inside the FIFO callback. Test overlapping publication while Undo waits, plus relinking.

3. **MAJOR — Task 18, lines 18275–18370:** Publication validates/captures `target.records` before asynchronous computation, then merges into the live document without checking identity. Relinking during computation can overwrite newly introduced source properties and record incorrect previous values. Verify the captured source identity immediately before publication; refuse changed sources and capture rollback values from the verified document.

4. **MAJOR — Tasks 15/18, lines 14289–14307, 13457–13465, 17813–17816, 17953–17964:** Compilation/test defects remain:
   - Registry uses `CrossLayerContext` without importing it.
   - `joinParams` equality expectation omits the newly required `fieldTypes: {}`.
   - Repeated `getState().layers[0]` expressions neither preserve union narrowing nor establish indexed-element existence.

   Add the import, update the expectation, and narrow a captured layer variable before accessing `preparedData`.

5. **MAJOR — Tasks 11/18, lines 9230–9247, 9338–9360, 9797–9810, 18308:** Task 11’s unconditional vector refusal makes its own empty-result “done” test fail. Task 18 removes that refusal but leaves the earlier refusal test expecting failure. Specify both test transitions explicitly so each task’s verification gate passes.

6. **MAJOR — Task 15, lines 15351–15356, 15505–15507, 15594:** When every SOURCE option is disabled, the default source becomes null and its reason disappears. Distance can expose Run with no source; Join shows unrelated parameter errors. Preserve a disabled fallback for explanation and require a non-null source before enabling Run. Test first opening with only loading, failed or empty sources.

7. **MAJOR — Tasks 12/16/17, lines 11187–11202, 16635–16639, 17494:** Frozen-field validation uses keys from **kept geometries only**. An unchanged document with the requested field present solely on a skipped feature incorrectly fails “Layer changed while running”. Validate field existence against all live source records; keep geometry filtering separate. Test this legitimate skipped-feature case.

8. **MAJOR — Tasks 12/13, lines 11135–11141, 11757–11792:** Batching remains unbounded within one large feature: WKT assembly, `JSON.stringify`, encoding and final chunk copying can block Cancel. The final allocation also retains all encoded chunks while copying them, contrary to the memory commentary. Bound work by coordinates/bytes, including serialization and copying; test timer-delivered cancellation on one very large feature.

9. **MAJOR — Task 16, lines 16013, 16480–16481, 16941–16952:** The new engine test has a false expectation. Against this checkout’s **DuckDB 1.5.5**, the specified polygon pair returns `within: true, covered: true`. Keep the accepted `ST_CoveredBy` choice; correct the expectation and explanation. Use a boundary point to demonstrate the predicate distinction.

10. **MAJOR — Task 12, lines 10258, 11094–11121:** Mixed GeometryCollections remain skipped despite §7.7’s “any geometry type”. The limitation is disclosed, but “not probed” does not implement the requirement. Add mixed-collection WKT and an engine test. A local DuckDB 1.5.5 probe successfully parsed a mixed point/line collection and returned the expected distance, 5.

11. **MINOR — Task 15, lines 15024–15087:** Aggregate validation now blocks incomplete rows, but errors remain detached from the offending row. Duplicate output names are also not flagged on the second row as §6 requires. Render row-specific errors, associate them with their controls, and test mixed-validity and duplicate rows.

12. **MINOR — Task 13, line 11317:** `getDuckDBStatus` is cited at `duckdb.ts:196`, which is commentary for engine-death subscriptions. Its declaration is at **240**. Correct the citation.

Round-1 finding disposition:

| Finding | Status   | Current fix / remaining issue                                                                                  |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 1       | Resolved | 14021–14037 preserves the explicit proxy without table context.                                                |
| 2       | Resolved | 12783–12786 applies footprint scope IDs.                                                                       |
| 3       | Resolved | 12833 selects part contributors before root fallback.                                                          |
| 4       | Resolved | Boundary-inclusive predicate supplied; new test defect is finding 9 above.                                     |
| 5       | Partly   | 10964–10982 validates structure; 11118 still rejects mixed collections.                                        |
| 6       | Partly   | 10933–10940 yields during coordinates; serialization remains unbounded.                                        |
| 7       | Partly   | 16635 and 18275 add checks; findings 3 and 7 remain.                                                           |
| 8       | Resolved | 18225–18235, 18346–18366 retain per-column previous values.                                                    |
| 9       | Partly   | 18484 adds FIFO serialization; ownership/document revalidation remains missing.                                |
| 10      | Resolved | 18721–18773 refreshes selection properties by stable ID.                                                       |
| 11      | Resolved | 18647–18680 updates prepared-data category generation too.                                                     |
| 12      | Resolved | 20038–20056 initializes every target feature before overlaying results.                                        |
| 13      | Partly   | 14178 blocks incomplete aggregates; row-local errors remain absent.                                            |
| 14      | Partly   | 15182–15194 orders readiness reasons correctly; default-source handling loses them.                            |
| 15      | Resolved | 9386–9401 introduces the narrowed alias; 15588–15592 retains workload notes.                                   |
| 16      | Partly   | Original fixture/import repairs landed; finding 4 identifies remaining executable-test defects.                |
| 17      | Resolved | 11842–11852 distinguishes confirmed engine failure from registration failure.                                  |
| 18      | Resolved | Log-label ruling accepted; 11960–11974 fixes Distance’s empty-source copy. A17 is expressly accepted at 28533. |

Citation spot-checks also verified [CRS conversion](/data2/hideba/multiroof-viewer/src/scene/cursorCrsReadout.ts:35), [CRS loading](/data2/hideba/multiroof-viewer/src/features/layers/ensureCrs.ts:32), [buffer registration](/data2/hideba/multiroof-viewer/src/insights/duckdb.ts:724), [death racing](/data2/hideba/multiroof-viewer/src/insights/engineAwait.ts:104), [SQL quoting](/data2/hideba/multiroof-viewer/src/insights/sql.ts:28), [stable-ID highlighting](/data2/hideba/multiroof-viewer/src/scene/geoLayerSync.ts:236), and [prepared-document rendering](/data2/hideba/multiroof-viewer/src/scene/geoLayerDescriptions.ts:55). Those references match; the earlier incorrect renderer citation is repaired.

The reconciled result, styling, two-argument column-builder and shared-merge interfaces agree. Accepted copy and predicate rulings are not reopened. The inherited M2 no-recovery ruling differs from §6.1’s recovery sentence; that remains an accepted deviation, not a new request for approval.

Fix first
