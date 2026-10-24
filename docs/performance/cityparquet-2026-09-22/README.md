# CityParquet implementation verification — 2026-09-22

## Revision and scope

Fetched origin in the viewer and submodule. Local develop already matches origin/develop at e59dcf2; plugin main is ef8cb7b. No newer implementation branch was found in the fetched origin refs. Only the no-op LoD optimization has landed. The original handoff scoped the first agent to task 1; completion of that task is not completion of the whole performance strategy.

## Task audit

| Agreed work | Status | Evidence |
| --- | --- | --- |
| Skip rebuild when effective per-object LoD is unchanged | Implemented and verified | Shared selectedSurfaceLod/sameLodGeometry helpers; CityModelMesh.setLod preserves selection before skipping |
| Apply geoid height without retriangulation | Not implemented | CityModelMesh.setHeightOffset still calls rebuildGeometry |
| Metadata-first, bounded range/column/row-group loading with worker/backpressure/eviction | Not implemented | loadCityParquetFromUrl fetches complete tables; readCityParquetTable calls parquetReadObjects without row bounds |
| On-demand attributes with row-group locator | Not implemented | Reader includes footer attributes and other_attributes; addCityLayer immediately enqueues the table |
| Building-family-first loading, other types on demand, per-type table controls | Not implemented | Package targets fetched together, one DuckDB table per layer; visibility does not drive ingestion |
| Direct geographic-to-ENU rendering | Not implemented | normalizeCityParquetCrs produces UTM, renderer subsequently projects to ENU |

Independent review found no Critical/Important issues in the delivered LoD change. Minor benchmark cleanup issue: lod-switch.test.ts installs a prototype spy without restore/finally; process teardown currently contains it. No application changes were made in this audit.

## Browser profile

Chrome 153, 960 × 906 CSS pixels, Vite development server, no throttling. New isolated browser context. Invoked the actual CityParquet URL loader and addCityLayer; normal scene and database lifecycles followed. The original Nishitokyo URL returned HTTP 404 on this run. Served the retained 30,707,678-byte baseline file temporarily from localhost instead; removed the temporary file afterward. This isolates processing but is not a controlled end-to-end network comparison.

| Observation | New run | Previous DevTools run |
| --- | ---: | ---: |
| Normalized model returned | 3.63 s | 4.90 s |
| Database-ready observed | 10.59 s | 12.04 s |
| Longest main-thread task | 6.99 s | 7.20 s |
| Later long task | 2.99 s | 2.87 s |
| JS heap reading at ready | 2.08 GB | 2.03 GB |

84,862 objects loaded. Ready timing includes rendering contention and event-loop delay, not just database work. Heap is a point-in-time reading, not peak/resident memory. The original temporary mesh wrapper imported a different Vite timestamp module instance and recorded no events: therefore this run does not attribute the later load task to a specific mesh call. The persistent geoid rebuild is independently confirmed in source. Browser switching below used the actual timestamped runtime module and restored wrappers afterward.

DevTools trace completed, CLS 0.00; inline trace summary is retained in evidence.json. No raw trace export or precise GPU timing was captured. A displayed 60 FPS after loading is not a GPU bottleneck measurement.

## Real-data LoD verification

Browser transitions use the live layer store and end after two animation callbacks, not a verified presentation timestamp. Original selection restored.

| Transition | Mesh rebuild | Elapsed | Triangles |
| --- | ---: | ---: | ---: |
| [2,1,0] → [2,1] | None | 183 ms | 1,913,792 |
| [2,1] → [2] | 84 ms | 235 ms | 36,968 |
| [2] → [2,1,0] | 2,627 ms | 2,831 ms | 1,913,792 |

Previous no-op transition rebuilt for 2,651 ms and took 2,840 ms. The new fix removes that rebuild. Separately, the existing Node benchmark with AUDIT_FILE=/tmp/nishitokyo-building.parquet passed: no-op comparison 38.8 ms, zero rebuilds; forced equivalent rebuild 3,088.7 ms. These Node times must not be compared directly to browser timings. Full results in lod-switch-real.jsonl. Focused plugin tests: 3 files, 80 tests passed; real-file benchmark: 1 passed.

## Yokohama reproduction

Retained 334,831,616-byte baseline file. Ran the actual full readCityParquetTable in an isolated Vitest worker with NODE_OPTIONS=--max-old-space-size=4096 and core dumps disabled, stopping immediately after reading if successful. It failed with `Reached heap limit Allocation failed - JavaScript heap out of memory`; no parquet-read completion marker was recorded. Full harness ended after 9.85 s. See yokohama-reader.jsonl and yokohama-reader.log.

This reproduces the reader failure before WKB decoding, coordinate normalization, Navara construction, or DuckDB creation. It is a capped Node reproduction, not a new browser-crash measurement. No need to crash the user's browser to establish that the unchanged unbounded reader remains a blocker.

## Next implementation priority

The LoD fix is useful but does not address initial loading. Prioritize the bounded loader: metadata and requested columns first, bounded row-group batches, selected geometry only, worker decoding, bounded resident scene/cache and explicit cancellation. A worker alone will not fix unbounded memory. Validate full Yokohama with a memory budget and interactive progress before declaring the ingestion issue fixed. Eliminate geoid retriangulation next (or independently), then implement locator-based lazy attributes, type-driven loading/tables, and direct geographic rendering. Retain the existing LoD regression tests throughout.
