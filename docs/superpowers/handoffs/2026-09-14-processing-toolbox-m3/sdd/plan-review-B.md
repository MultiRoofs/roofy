1. **MAJOR — Task 15, lines 12059–12068:** Registry normalization always changes footprint/rectangle to centre because `BAG_ONLY.table` is null. The submitted run therefore differs from the validated form. Preserve an explicitly supplied proxy when context has no table; test the actual frozen request after clicking Run.

2. **MAJOR — Tasks 14/19, lines 10906–10916, 16562–16581:** The footprint branch ignores `input.ids`. Aggregate consequently counts buildings outside Selected/Matching scope; filtering numeric values does not filter membership. Apply the frozen IDs to the footprint relation. Add an engine test with two buildings but only one selected.

3. **MAJOR — Task 14, lines 10938–10955:** The plan explicitly discards §7’s contributor rule, incorrectly claiming unioning root and parts always gives the same geometry. Roots can differ from their parts. Select LoD 0 part contributors when present, otherwise the root; test differing root/part footprints.

4. **MAJOR — Tasks 16/19, lines 13862, 14310–14315, 16524–16531:** `within` uses `ST_Within` even for a centre on an area boundary, excluding a match the spec includes. Probe and use a boundary-inclusive covering predicate; test boundary centres and degenerate extents through the real engine.

5. **MAJOR — Tasks 12/13, lines 9447–9495, 10049–10059:** Preflight checks nesting/nonemptiness but accepts malformed lines and polygon rings. Their WKT can abort the entire table creation instead of skipping the offending feature. Valid GeometryCollections are also labelled unparseable. Validate geometry structure and support valid collections for Distance; test mixed valid/invalid input and all-invalid input.

6. **MAJOR — Tasks 12/13, lines 9498–9520, 9990–10005:** Reprojection synchronously walks every coordinate, then encoding builds per-feature strings, a joined string and a byte buffer. Large layers block rendering and Cancel while retaining multiple copies. Implement bounded batches with event-loop yields and cancellation checks, including within very large features; add a cancellation stress test.

7. **MAJOR — Tasks 11/13/18, lines 8515–8532, 10147–10189, 15504–15543:** Queue-head validation does not recheck frozen vector-source fields, and source-owned output collisions are checked only for city targets. A queued run can silently copy null after a field disappears or overwrite a newly introduced vector source property. Revalidate both against the live documents before computing/publishing; test changes while queued.

8. **MAJOR — Task 18, lines 15539–15562, 15624–15664:** Undo stores and restores the entire document, but steals Undo only for overlapping columns. Run count A, then sum B: undoing A removes B’s results while B remains recorded. Restore only the affected properties, including previous absence, merged into the current document. Test both Undo orders for disjoint outputs.

9. **MAJOR — Task 18, lines 15645–15664:** Vector Undo explicitly bypasses the FIFO. It can change a source or target document underneath an active cross-layer run, invalidating its captured records and preflight. Serialize Undo with processing and revalidate its layer/document identity at execution.

10. **MAJOR — Task 18, lines 15425–15443, 15694–15765:** Publishing replaces `config`, which makes existing `src/app/App.tsx:768–795` clear the picked geo feature. This violates §8 and prevents Details from showing the new values. Preserve selection across property-only updates, refresh its properties by stable ID, and maintain the corresponding engine highlight. Test publication and Undo with a selected area.

11. **MAJOR — Task 18, lines 15779–15796:** Only the attribute-key list becomes prepared-data-aware. Existing `GeoStyleControls.tsx:220–260` still builds categories from raw `config.data` or the fetched document. Computed attributes appear in the select but produce incorrect categories. Update category generation too; assert actual computed values and colours.

12. **MAJOR — Task 19, lines 16646–16659, 16695–16703:** Skipped target areas never receive output rows. On rerun, they retain stale computed values although §7.6 requires every target feature to be written. Initialize all target stable IDs with null outputs, then overlay successfully evaluated results; test a previously populated area whose geometry becomes unusable.

13. **MAJOR — Task 15, lines 11985–12005, 12198–12205:** A count row plus a sum row without a column passes validation; the sum silently disappears. Validate every aggregate row before constructing columns, and put the blocking error beside the offending row. Add a mixed-validity form test.

14. **MAJOR — Task 15, lines 13285–13304, 13454–13466:** Vector SOURCE readiness is not checked. Loading sources receive polygon/empty reasons, and an empty Join source can receive “Needs areas (polygons)” instead of its specified empty-source reason. Apply preparation and emptiness checks before geometry-kind eligibility, using the accepted copy.

15. **MAJOR — Tasks 11/15/18/19, lines 8367–8389, 13084–13110, 13504–13539, 15540, 16649:** Two interface breaks prevent typechecking: vector `ToolTarget.layer` remains the full `GeoLayer` union despite unconditional `preparedData` access; Task 15’s replacement hook drops Task 5’s `workloadNote`, still consumed by `ToolView`. Narrow vector layers consistently and retain the workload-note implementation and return field.

16. **MAJOR — Tasks 15/18, lines 11269–11333, 15135, 15875–15897:** The proposed tests are not executable as supplied. `CrossLayerContext` is unimported, and `ctx` reads `TYPES` before initialization. The named export suite does not exist, and the appended test supplies neither imports nor `addZones`. Provide complete tests at the actual suite path, `tests/unit/features/geoLayers/geoExport.test.ts`; remove “or whichever file” hand-waving.

17. **MAJOR — Task 13, lines 10050–10056:** The cited engine fact is wrong: `duckdb.ts:728–735` returns false for **any** registration exception, not only engine death. Allocation/registration failures therefore incorrectly report “Analytics engine stopped”. Distinguish confirmed death from ordinary registration failure and test both.

18. **MINOR — Tasks 13/15/16/19, lines 9941, 12797, 12977, 14437, 16680:** Unapproved visible copy includes “Reading source layer”, “Centre within uses the extent centre whatever the proxy above says.”, “Choose a property…”, “Joining attributes” and “Aggregating buildings per area”. Replace each with applicable verbatim spec/A1–A16 copy; also correct Distance’s all-invalid-source branch at 10161–10164.

Citation checks covered `runQueue.ts:75–136`, `geoLayerStore.ts:89–101` and `278–309`, `cursorCrsReadout.ts:35–79`, `geoLayerSync.ts:524`, `geoRecords.ts:5–37`, and the DuckDB harness APIs. An additional wrong citation appears at plan lines **140, 909 and 15168**: `geoLayerSync.ts:245` reads a colour attribute; the prepared-document engine read is `geoLayerDescriptions.ts:55–57`. Correct that reference. The other incorrect source claim and nonexistent test path are covered above.

Fix first
