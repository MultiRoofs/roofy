Four remaining findings in the [plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-12-processing-toolbox-m3.md):

1. **MAJOR — Tasks 7/10, lines 5918–5939 and 8558–8577:** Identity checks still cover only contributors. A missing root or non-contributing scoped object escapes detection, contrary to the final ruling in `progress.md:28`. Validate every ID returned by the scope-row query against source IDs, while retaining contributor-only measurement. Add missing-root and missing-non-contributor tests.

2. **MAJOR — Task 5, lines 3267–3289:** The new static `engineAwait` import loads the DuckDB mock before `registerBuffer`, `dropBuffer` and `getDuckDBStatus` initialize. The suite fails during collection. Confirmed with the installed Vitest mock transformer. Dynamically import the exception classes after mock-variable initialization, or initialize those variables through `vi.hoisted`.

3. **MAJOR — Task 8, lines 6421–6427:** `getByText("No solid geometry in this layer")` matches both the disabled option and the footer reason. The test fails with multiple matches. Assert the option separately and use `{ selector: "p" }` for the reason, matching the existing roof-LoD test.

4. **MAJOR — Task 9, lines 6855–6873 and 7568–7581:** The SQL test migration is incomplete. The appended tests never import `buildMostFrequentSql`; additionally, checkout `ToolView.test.tsx:555–557` still expects the uncast median statement. Add the import and update that expectation in Task 9’s commit.

Round-1 reconciliation; numbers below refer to the original findings:

| #   | Status                 | Current plan evidence                                                                                               |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Partly**             | 5939, 8577: partial contributor loss detected; scope-wide ruling still missing.                                     |
| 2   | **Resolved**           | 3961–3968: `instanceof`, preserving exception identity. New test regression above.                                  |
| 3   | **Resolved**           | 4075–4089: raced registration and late-success cleanup.                                                             |
| 4   | **Resolved**           | 4007–4026, 5922, 8562: shared reader classification and logged detail.                                              |
| 5   | **Resolved**           | 4249, 4261–4267, 6661–6673, 8721–8735: narrowed lookup and valid JSX.                                               |
| 6   | **Resolved**           | 7690–7702, 7739–7750: resolved value type and resolver imports.                                                     |
| 7   | **Resolved**           | 1275–1489, 1985, 2030–2035: complete fixtures, corrected property lookup, staging.                                  |
| 8   | **Resolved**           | 2927–2945: roof-bearing fixture.                                                                                    |
| 9   | **Resolved**           | 3387–3388, 4153, 4203–4223, 6094–6100: corrected fixtures and waits.                                                |
| 10  | **Resolved**           | 5281–5293, 8090–8100, 8284–8287: captured SQL and meaningful assertions.                                            |
| 11  | **Resolved**           | 6676–6723: explicit unimplemented definitions.                                                                      |
| 12  | **Resolved**           | 7092–7095, 7381–7382, 16838–16935: seeded runs, evaluator arguments, editor Save and deferred Join coverage.        |
| 13  | **Partly**             | 7580: CAST implemented; existing expectation migration remains incomplete.                                          |
| 14  | **Resolved**           | 8649–8650, 8336–8355: valid count uses `line`; complete summary asserted.                                           |
| 15  | **Resolved by ruling** | Labels retained at 5924/8564; `progress.md:22` accepts them. No spec sentence requires particular statement labels. |

Citation spot-checks matched: plugin `types.ts:105–118`, `parseHelpers.ts:177–189`, `decodeTable.ts:725–733`; app `layerTables.ts:166–182`, `420–436`, `591–628`; `duckdb.ts:724–743`; `columnKind.ts:90–120`; `export.ts:558–578`. The previously incorrect fixture citation now correctly specifies 16 bytes.

The binding no-recovery ruling still deviates from §6.1’s table-rebuild promise; streaming-copy and FCB write-back rulings likewise remain accepted deviations. These decisions are not reopened.

Fix first
