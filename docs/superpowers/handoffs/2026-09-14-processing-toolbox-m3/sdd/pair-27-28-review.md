### Task 27

#### Spec Compliance

Mostly compliant: both city write destinations share the recorder; failed COMMIT is recorded before invocation; ROLLBACK appears only when issued. A8 is verbatim, the vector undone guard is present, and DataGrid drains on `[reveal, columns, rows]`.

The sweep distinguishes pending and successful builds and retries failures. A changed version during a pending build remains eligible for rebuilding; no starvation found. Subscription cleanup prevents listener accumulation across grid switches. Existing Height/Roof log expectations remain compatible.

#### Issues

##### Critical (Must Fix)

None.

##### Important (Should Fix)

- **Engine death loses the write’s entire SQL record.** In [runQueue.ts](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:1830) and [deriveLayer.ts](/data2/hideba/multiroof-viewer/src/features/processing/deriveLayer.ts:278), the outer death race rejects before the recorder receives `written.statements`. An engine dying during UPDATE therefore leaves no BEGIN/ALTER/UPDATE entries, although those statements were issued. This contradicts §6.4’s failure-record requirement; the report’s claimed acceptance is not a supplied controller ruling. Preserve issued statements independently of successful outcome delivery and assert both destinations’ logs on death.

- **The required pending-A → acknowledged-B regression test is vacuous.** In [revealColumns.test.tsx](/data2/hideba/multiroof-viewer/tests/unit/ui/table/revealColumns.test.tsx), “forgets a SUPERSEDED request…” subscribes an acknowledging listener, consuming A before B arrives. The second replacement test declines both requests. Neither detects the original bug. Keep A pending by declining it, acknowledge B immediately, then assert a drain delivers nothing. The implementation itself handles this correctly.

##### Minor (Nice to Have)

No production `scrollIntoView?.()` guard is justified by jsdom’s missing implementation. The two unnumbered entries are appropriate: vector publication and failed buffer registration issue no SQL.

Tests generally assert observable logs, store changes and DOM targets, although jsdom cannot verify actual scrolling. No tests were rerun.

### Task 28

#### Spec Compliance

The change is documentation-only, adds the roadmap entry, Carried to M4 list, architecture section and fixture entries, and leaves `CLAUDE.md` unchanged. It correctly describes Retry’s generation capture **after boot starts** and makes no completed browser-smoke claim.

Code spot-checks covered more than eight cited names: `buildSurface`, `readSource`, both solids builders, `resolveScope`, `buildCityParquetSourceSql`, `buildVectorTableSql`, `buildFeatureProxySql`, `retryEngine`, `nextRuleColor`, `snapshotLayers` and the predicate/distance builders.

The carried list covers the named deferrals. Completeness against the separate external per-task ledger cannot be established from the supplied files.

#### Issues

##### Critical (Must Fix)

None.

##### Important (Should Fix)

- **The death-handling summary overclaims and misidentifies the remaining awaits.** [roadmap.md:660](/data2/hideba/multiroof-viewer/docs/roadmap.md:660) says every engine await settles; line 701 says nothing hangs, immediately before listing exceptions. Also, `queryParquetBuffer`’s unraced operations are **registration and cleanup**, not registration and read: its query delegates to raced `queryDuckDB`. Narrow the success claim to the six covered primitives and correct the carried item. “Return a message” also overstates the Stats/map-filter behavior demonstrated by the included tests.

- **D10 states the wrong result for `ST_DWithin`.** [architecture-notes.md:643](/data2/hideba/multiroof-viewer/docs/architecture-notes.md:643) says both functions return `0`. The probe asserts `ST_DWithin` incorrectly returns **true** for polygons 40 m apart with a 39 m threshold. Distinguish that boolean false positive from `ST_Distance`’s zero-distance defect. The documented `ST_Distance_GEOS` remedy is correct.

##### Minor (Nice to Have)

- [architecture-notes.md:472](/data2/hideba/multiroof-viewer/docs/architecture-notes.md:472): replace “No `toolId` appears” with “No tool-specific branching”: `RunFooter` uses `run.toolId` for registry lookups.
- Qualify D2’s GeoJSON NULL-binding statement with the unloaded-JSON condition already explained correctly in D7.
- The source-byte lifetime description alternates between “one run” and early release after parsing. Describe the actual lifetime: through the reader statements, released before roll-up.

### Cross-task

Task 28’s unconditional statement-by-statement logging claim inherits Task 27’s engine-death omission. Correct it alongside the implementation. Commits `c8ac596`/`c35a6a0` were treated as the approved Task 25 fixes.

### Assessment

**Task 27 quality:** Needs fixes — the main implementation is sound, but death-path logging and the explicitly required supersession regression test remain incomplete.

**Task 28 quality:** Needs fixes — the documentation substantially matches the implementation, but several factual claims require correction.
