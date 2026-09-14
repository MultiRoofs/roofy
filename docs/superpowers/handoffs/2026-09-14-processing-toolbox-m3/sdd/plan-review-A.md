1. **MAJOR — Tasks 7/10, lines 4234–4236, 5075–5078, 7376–7377:** Source identity validation accepts any nonempty overlap. A changed source missing some contributors silently publishes incomplete results. Compare expected IDs against returned IDs and fail with `SOURCE_IDS_DIFFER` on missing IDs; test partial overlap, not only zero matches.

2. **MAJOR — Task 5, lines 3296–3316:** Cancellation/death exceptions are identified by `.name`, but the checkout’s `CancelledError` and `EngineDeadError` inherit `"Error"`. Both become source-read failures. Import the classes and use `instanceof`; assert exception identity in tests.

3. **MAJOR — Task 5, line 3312:** `registerBuffer` is awaited without cancellation/death protection while holding the FIFO. Task 25’s later hardening cannot make Task 8’s earlier enabled tool safe. Race registration using the shared helper, clean up a late successful registration, and test cancellation/death during registration.

4. **MAJOR — Tasks 5/7/10, lines 3264–3269, 5066–5078, 7367–7377:** Source-error classification covers fetching but excludes the reader statement, where parsing and WASM allocation occur. Those failures expose raw engine errors instead of §6.1’s source-failure sentences. Share classification across both stages, preserving cancellation/death and retaining engine detail in the log.

5. **MAJOR — Tasks 5/8/10, lines 3461–3466, 5790–5806, 7513–7526:** All three JSX insertions contain `);` inside a JSX expression. TypeScript parsing confirms syntax errors. Remove those semicolons. Also change Task 5’s line 3452 guard to `tableInfo?.state === "ready"`; the existing indexed lookup can return `undefined`.

6. **MAJOR — Task 9, lines 6586–6593, 6629–6643, 6658–6662, 6722:** `readStyleValue` accepts `StyleByResult["value"]`, which includes a function, then accesses `.kind`/`.value` directly. It does not compile. Accept resolved `StyleValueSource` and explicitly import both resolver functions used by the footer.

7. **MAJOR — Task 1, lines 1112, 1381–1393, 1630–1635, 1678–1679:** The CompositeSolid fixture is left as “Author it,” without executable fixture contents, and omitted from staging. Separately, the LEFT JOIN probe selects nonexistent `s.name`; its table stores `props`. Supply and stage the fixture; select `s.props->>'name' AS name`.

8. **MAJOR — Task 4, lines 2573–2602:** The new Run test uses `ToolView.test.tsx`’s `addCityLayer()`, whose model has no surfaces. Roof metrics therefore has no qualifying LoD and Run is disabled. Supply a roof-bearing fixture before asserting the submitted typed columns.

9. **MAJOR — Tasks 5/7, lines 2965–2979, 3363–3367, 3407–3434, 5225–5227:** Several tests cannot pass: the source fixture names `layer_3`, not expected `layer_1`; `layerTablesBuild.test.ts:293` uses mocked **16-byte** input, not the claimed real 3,880-byte fixture; `flush()` does not exist; and the phase test’s extension mock returns false. Correct the fixtures, use `vi.waitFor`, and arrange successful extension loading.

10. **MAJOR — Tasks 7/10, lines 4474–4480, 4717, 6948–6954, 7149:** Query mocks declare only `(label)`, but assertions index argument `[1]`; their inferred tuples reject that access. Declare `(label, sql)` explicitly. The Validate assertion also passes vacuously on `"undefined"`—assert the actual validation statement.

11. **MAJOR — Task 8, lines 5780–5818:** Enabling Measure solids leaves existing tests asserting it is unimplemented: `eligibility.test.ts:27` and `lodSelect.test.tsx:177–185`. Include their migration in this commit, preserving the unimplemented-tool invariant using an explicitly unimplemented test definition.

12. **MAJOR — Task 9, lines 6019–6270, 6672–6673:** Style tests never insert their runs into the processing store, so the new `runById` guard rejects every draft. The text test additionally depends on Join’s missing-until-Task-15 `outputColumns`. `evaluateRule` is called with two reversed arguments; its real signature is `(attributes, metrics, rule)`. Seed/reset runs, provide the descriptor’s typed columns locally, and exercise the real editor’s boolean Save path.

13. **MAJOR — Task 9, lines 941, 6640–6642:** The required median cast is never implemented. Checkout `sql.ts:438–439` contains `median(column)`, without `CAST(... AS DOUBLE)`. Change that builder while retaining its root-row restriction, and probe the builder itself over DECIMAL data.

14. **MAJOR — Task 10, lines 7434–7447:** The executor ignores the agreed `ToolResult.line` channel and emits both counts as caveats. The card becomes “1,204 buildings measured · 1,079 valid · 125 with issues…”. Set `line` to the valid count and keep only “with issues” as a caveat; assert the final summary sentence.

15. **MINOR — Tasks 7/10, lines 5067, 7368:** User-visible log labels `"Measuring solids"` and `"Validating solids"` appear in neither the spec nor A1–A16. Use the approved `"Computing"` label.

Citation spot-checks matched: plugin `types.ts:105–118`, `parseHelpers.ts:177–189`, `layerTables.ts:166–182` and `420–436`, `duckdb.ts:724–745`, `columnKind.ts:90–120`, and `export.ts:558–578`. The incorrect test citation is reported in finding 9.

Fix first
