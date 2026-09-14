### Task 19

#### Spec Compliance

Meets the task-scoped requirements. Aggregate writes to the vector target, scopes the source buildings, validates footprint-source identity against independently read scoped rows, and initializes every target feature before overlaying evaluated results. Unusable areas receive NULLs; evaluated empty areas receive count 0.

The membership relation produces one row per feature, with root-only aggregate values. The default column is `bld_buildings_n`; the card and single multi-membership caveat follow the required wording. Style by result reaches the real STYLE section and populates attribute categories from `preparedData`.

Tests exercise real queue publication, cancellation, engine death, cleanup, source-ID failures, and stale-value replacement. Engine cases execute the actual SQL builder.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- **Complete aggregate-value coverage.** [crossLayer.test.ts](/data2/hideba/multiroof-viewer/tests/integration/duckdb/crossLayer.test.ts:1557) covers count, sum, mean, all-NULL values, and empty areas, but not min/max or mixed NULL/non-NULL values within one area. Add those assertions; the SQL appears correct, but the behavioral coverage is incomplete.
- **Correct the predicate comment.** [aggregatePerArea.ts](/data2/hideba/multiroof-viewer/src/features/processing/tools/aggregatePerArea.ts:105) repeats the explicitly corrected claim that a footprint sharing an edge necessarily makes `ST_Within` false. Keep `ST_CoveredBy`; describe the boundary-point distinction accurately.

### Task 20

#### Spec Compliance

Meets the staged task requirements. All seven prefills are correct, including `Zones · buildings`. A13/A14 validation compares trimmed, case-insensitive names across both stores. The inherited-column warning filters computed collisions; source-attribute collisions remain errors.

Destination and name are included in the request. The form and queue contain the A2 streaming refusal, and the footer suppresses its duplicate. Existing LoD, target/source, prefix, parameter, and scope precedence is preserved.

All seven shipped definitions declare only `["layer"]`; New layer is unreachable through their radios. Tests enable it temporarily on a test definition. `deriveLayer.ts` contains only the naming rules, with `disambiguate` exported for publication. The required-field fixture sweep is present.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- **Keep destination availability explicit in Task 22.** [runQueue.ts](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:830) reports “Not available yet” for an unshipped destination. This is honest about the requested operation, though ambiguous about the implemented tool. Task 22 should enable supported destinations while retaining the guard for Aggregate until Task 23, preserve A2, and update the staging test rather than remove destination validation wholesale.

### Cross-task

No regression found between these tasks. Task 20 preserves Aggregate’s reversed target/source contract and current publication path. Task 22 must dispatch New layer **before both** existing publication branches and restore destination/name through Edit & run.

The tests assert observable behavior beyond mock calls, with real-engine coverage for SQL. No tests or git commands were rerun. Neither implementation report supplies the required real-browser verification; visual integration remains unverified. Commit `2218ca3` was treated as the already-approved Task 18 test fix.

### Assessment

**Task 19 quality:** Approved — requirements are implemented with substantial behavioral coverage; remaining findings concern coverage and documentation.

**Task 20 quality:** Approved — naming, validation, and destination staging are correctly integrated without exposing unfinished publication machinery.
