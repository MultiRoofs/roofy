# CityParquet performance baseline — 2026-09-21

See [the Chrome DevTools MCP follow-up](devtools-followup.md) for a second browser load and measured LoD-switch costs, including a full rebuild when no object's effective LoD changes.

## Bounded loading (task 3) — 2026-09-22

Large CityParquet sources (object tables over 128 MiB) now stream by viewport through the FlatCityBuf worker protocol; design and limits in `docs/architecture-notes.md` ("CityParquet streams through the FlatCityBuf worker protocol"). The baseline below is unchanged and still describes the static path, which Nishitokyo (under the threshold) keeps.

**Fixture.** `/data2/hideba/roofy-perf-data/yokohama-building.parquet`, 334,860,819 bytes, SHA-256 `dd432a1e41ea854a474dd5030d92cdf1a40fb20abd11ec30bb3d4b42d549dfdd`, from the moved URL `…/plateau/yokohama-shi/building.parquet` (same `Content-Length` as served on 2026-09-22). Its size and SHA differ from the 2026-09-21 capture listed under Reproduction (334.83 MB, `af97ac…`); the numbers in this section are for this file. Linux host, Node 24.21, `--max-old-space-size=4096 --expose-gc`. Heap/RSS peaks come from a 50 ms sampler (lower bounds); retained sizes are after a forced GC and include `ArrayBuffer` memory, where the packed index lives.

**Hardware, and what may not be compared.** Everything in this section ran on the Linux host described above — a headless machine with a software GL stack. The ORIGINAL baseline further down this file (Findings, Environment and scope, Source sizes, Reproduction) was captured on an **Apple M4 Max with a hardware GPU**, on a different Node. Absolute timings must NOT be compared across the two sets: only the relations inside one set mean anything. The task 4 run whose 7.2 s open is quoted below was on this same Linux host, the same Node and the same local `Blob`, so that one figure is comparable with the 8.4 s beside it.

**Units.** Heap and RSS are binary MiB/GiB; bytes read over the wire are decimal MB/GB. That matches how each is reported by its source (`process.memoryUsage()` vs a byte counter) and is the convention of both the prose and the JSONL.

| Node, local file (lazy `Blob` slices)        |                                                               Measurement |
| -------------------------------------------- | ------------------------------------------------------------------------: |
| `openCityParquetStream`                      |        8.4 s (7.2 s in the task 4 run); 24.49 MB read = 7.3 % of the file |
| Index                                        |          884,106 rows, 0 invalid bboxes, EPSG:6697 → EPSG:32654, LoDs 0–4 |
| Retained after open (heap + ArrayBuffers)    |                                                                  +41.8 MB |
| Peak during open                             |                      heap 613 MB, RSS 812 MB (transient row-group decode) |
| 1 km box at Yokohama station, every LoD      | `readCost` 6,199 rows in 3 ranges; 12.83 MB read; 2.5 s; peak heap 499 MB |
| Same box, LoD ≤ 2 (the ladder's middle rung) |                                                      12.35 MB read; 2.2 s |
| Row range with `useOffsetIndex` (task 3)     |    1,000 rows of id + bbox + LoD 0/1 geometry: 2.47 MB vs 21.1 MB without |
| Previous whole-file path                     |                      reader OOM at a 4 GiB heap (below); browser tab lost |

**Pan through the real worker core.** Ten 1 km views, 600 m apart, from Yokohama station towards Kannai, driven through `installStreamWorker` + the CityParquet adapter in-process, with the planner's rules (probe vs 20,000, `chooseLevel`, `lodForCellSize`) and the plugin's resident `CellCache` budgets (4 M triangles / 512 MiB), evictions sent to the worker as the plugin sends them. Every view probed 4,120–16,988 rows (all under budget) and committed at level 7 (400 m cells), LoD 2.

| Pan (local file)                |                                                                             Measurement |
| ------------------------------- | --------------------------------------------------------------------------------------: |
| Per view (probe + fetch + bake) |                                 2.0–6.2 s; 3–10 missing cells fetched; 6.6–20.3 MB read |
| Cumulative                      |                                  36.3 s; 133.8 MB read (40 % of the file) over 10 views |
| Resident after 10 views         | 67 cells, 724,810 triangles, 91.2 MB of cell geometry; no eviction (under both budgets) |
| Peak                            |                 heap 990 MB, RSS 1.39 GB (whole process, both streams of this run open) |
| Retained after the pan + GC     |                                                       heap 353 MB + ArrayBuffers 118 MB |

The worker retains a whole `CityModel` per cached cell on top of the geometry the cache meters: 67 cells were 91.2 MB of budget-counted geometry but ~353 MB of retained heap after a GC (~5 MB a cell, 4–5× the metered bytes). **Fixed after the milestone review** (Critical): every `cell` message now carries a structural `retainedBytes` estimate that the main thread ADDS to the geometry bytes it meters, and the worker enforces its own `WORKER_RETAINED_BYTE_BUDGET` (512 MiB) LRU cap as a backstop — so a pan with every object type hidden, which used to cost zero metered bytes a cell, is bounded like any other. The refreshed numbers are in "After the milestone-review fixes" below.

Bytes re-read across views are expected: nothing is cached below the cell cache, and a view's fetch reads whole families of the union of its missing cells.

### After the milestone-review fixes (2026-09-22, same Linux host)

One refreshed local run of the same benchmark (`/tmp/stream-refresh2.jsonl`, not committed — the committed JSONL is the pre-fix evidence), with `retainedBytes` metering, the worker LRU backstop and the planned-byte gate in place.

| Refreshed local run          |                                                                                                          Measurement |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------: |
| Open                         |                                                7.2 s; 24.49 MB read (unchanged); +68.7 MB retained; peak heap 581 MB |
| 1 km box, every LoD          |                           planned 2.45 MB vs the 96 MiB gate; 12.83 MB actually read; 2.2 s — nowhere near a refusal |
| 1 km box, LoD ≤ 2            |                                                                                planned 2.36 MB; 12.35 MB read; 1.9 s |
| Pan, resident after 10 views | 67 cells, 724,810 triangles; **359.3 MB metered** (was 91.2 MB), of which 268.1 MB is the worker's retained estimate |
| Pan, retained after GC       |                                                                    heap 352.9 MB + ArrayBuffers 117.7 MB (unchanged) |
| Pan, evictions               |                                     still 0 in 10 views — but now at 70 % of `RESIDENT_BYTE_BUDGET` rather than 18 % |
| Pan total                    |                                                     35.2 s; 133.8 MB read (unchanged: the gate refuses nothing here) |

Two things this says:

- **The retained-bytes estimate is the right size.** 268.1 MB estimated for 67 cells (~4.0 MB a cell) against 352.9 MB of heap actually retained after a forced GC — about 76 % of it, inside the ±50 % the formula claims. The gap is attribute VALUES, which the structural estimate does not walk. Metered residency is now 4× what it was, so the 512 MiB budget is reached after roughly 14 views of this pan instead of never; with every object type hidden (zero triangles, zero transferred bytes) it is reached at the same point, which is the case the review named.
- **The byte gate refuses nothing normal.** A 1 km Yokohama viewport plans 2.45 MB against a 96 MiB limit — a factor of 40 of headroom. The gate is there for the shape of file the row gates cannot see (see `estimateReadBytes`'s note on why it is deliberately asymmetric).

**Over HTTP** (`AUDIT_HTTP=1`, `https://cityparquet.open3d.city/data/plateau/yokohama-shi/building.parquet`, Cloudflare, from the Linux host): identical bytes; open 16.3 s in 100 range requests; the 1 km read 6.1 s in 327 requests (every LoD) and 4.8 s in 247 (LoD ≤ 2); the pan 53.6 s, 3.0–9.2 s a view, peak heap 1.16 GB, no transport anomalies. One earlier HTTP run failed at view 6 with the reader's "could not be read as Parquet while reading its rows" and was not reproduced; its cause was not captured (the benchmark logs transport anomalies since). `wrapHyparquet` passes only aborts and range refusals through, so any other transport failure (a thrown fetch, a 5xx, a short body) reaches the user as that corrupt-file sentence — a follow-up.

**Browser smoke** (`stream-browser-smoke-yokohama.{json,png}`; Chrome 147 headless, SwiftShader, Vite dev server, develop 145d19a; share link, camera over Yokohama station at 900 m, pitch −65°): first resident objects 43 s after navigation (engine boot, geoid and the index open included); settled at "4.5K of 884.1K loaded objects", 21 resident cells; JS heap 175 MB; longest task 1.9 s; no console errors beyond the known Three.js duplicate and missing Google tiles key warnings.

The `useOffsetIndex` row-range figure (2.47 MB vs 21.1 MB) is from the plan's own measurement — `docs/plans/2026-09-22-cityparquet-bounded-loading.md`, Global Constraints — not from the JSONL committed here, which records whole phases rather than that single 1,000-row probe.

Logs: `stream-node-yokohama.jsonl`, `stream-http-yokohama.jsonl` (one record per phase and per pan view). `AUDIT_LOG` defaults to `/tmp`, so a plain rerun leaves those files alone; pass the path explicitly to refresh them.

```sh
# A run that does not touch the committed evidence:
NODE_OPTIONS="--max-old-space-size=4096 --expose-gc" \
  npx vitest run -c scripts/performance/vitest.config.ts cityparquet-stream
# Refreshing the committed evidence (name the log):
NODE_OPTIONS="--max-old-space-size=4096 --expose-gc" \
  AUDIT_LOG=docs/performance/cityparquet-2026-09-21/stream-node-yokohama.jsonl \
  npx vitest run -c scripts/performance/vitest.config.ts cityparquet-stream
# AUDIT_FILE=<parquet> for another local file; AUDIT_HTTP=1 (AUDIT_URL=…) for the
# network path — its log defaults to stream-http-yokohama.jsonl when named.
```

## Object families (task 5) — 2026-09-23

A streamed CityParquet layer now opens only the object families the user asked
for (Building by default), and each family's DuckDB table is a VIEW over
`read_parquet` of its own file rather than a copy of the resident rows. Design
and limits in `docs/architecture-notes.md` ("Object families, each with a table
over its own file").

**Conditions.** Chrome 147 headless with SwiftShader (software GL) over a Vite
dev server on the Linux host, `develop` 26be3ac. These figures must NOT be
compared with the ORIGINAL M4 Max baseline further down this file (Findings,
Environment and scope, Source sizes, Reproduction); only the relations inside
this section mean anything.

**The spike that chose a view over a materialised table** (browser, DuckDB-wasm
1.5.5, the real 884,106-row `plateau/yokohama-shi/building.parquet` over HTTP;
15 of its 37 columns kept). Log: `duckdb-read-parquet-spike.json`.

| Operation on the 884,106-row table | View over `read_parquet` | Materialised table |
| ---------------------------------- | -----------------------: | -----------------: |
| Publish the table                  |                    26 ms |             961 ms |
| Filtered count (7,809 rows)        |                    34 ms |              10 ms |
| First 100-row page                 |                   793 ms |              97 ms |
| A deep page                        |                 1,503 ms |                  — |
| DuckDB memory held                 |           none (no copy) |             247 MB |

The browser's JS heap read 115 MB in both arms — the view materialises nothing,
so there is no copy to measure.
Paging is the view's cost and the whole of it, which is the trade the milestone
took: a view cannot drift from the file, and the escape hatch (`CREATE TABLE …
AS SELECT`) is one statement away at those two costs.

**Real-package validation.** The package at
`https://cityparquet.open3d.city/data/plateau/yokohama-shi/`, loaded in the
browser; evidence in `families-browser-validation-yokohama.json` and its
screenshot.

- The families block lists all six available families. Building reads
  **884,106 loaded**; Bridge, Water Body, City Furniture, Transportation and
  Vegetation all read **Not opened** — five of the package's six object tables
  are never streamed.
- The Table button of the CLOSED Bridge family opened its table with **1,797
  rows read from the file**, and Bridge geometry stayed closed throughout: the
  handoff's "attributes without rendering geometry". The grid's columns include
  `ADDRESS`, `CHILDREN_ROLES` and `OTHER` — `address` is KEPT, which the plan's
  prose said was dropped.
- The table panel's family selector lists all six families.
- The status bar read "4.5K of 884.1K loaded objects" — M is the OPENED
  families' rows, not the package's. JS heap 189 MB, 21 resident cells, no
  console errors.
- The bbox column is in the file's CRS (EPSG:6697, degrees), which is why the
  three metric tools refuse these layers until performance task 6.

## Findings

The full Yokohama building table exhausts a 4 GiB V8 heap **inside `readCityParquetTable`**, before WKB decoding, CRS normalization, mesh building, or DuckDB ingestion. The isolated process reports `Allocation failed - JavaScript heap out of memory` (preserved in `yokohama-full-reader-stderr.txt`); its last completed stage is the file read. This establishes a reader memory failure independently of Navara and the GPU. It strongly supports, but does not directly prove, the cause of the earlier browser tab loss.

The smaller Nishitokyo model loads successfully. Its main costs are CPU coordinate transformations, geometry building/rebuilding, and expanded in-memory data. The browser trace exposes an additional full mesh rebuild when the asynchronous geoid-height correction arrives. Steady-state rendering at the tested camera and resolution reaches the display's approximately 60 Hz pacing; turning off shadows and effects reduces draw calls but does not improve frame pacing in this case.

No viewer behavior or optimization was changed for this investigation. The added benchmark is opt-in and excluded from the ordinary unit suite.

## Environment and scope

- Apple M4 Max, 36 GiB RAM; Node 24.18.1; Chromium 147 through an isolated agent-browser session.
- Browser reports `ANGLE Metal Renderer: Apple M4 Max`, confirming hardware GPU rendering rather than a software renderer.
- Running Vite development viewer, current uncommitted multi-LoD/CRS changes included. These are **not production-build timings**.
- Canvas session viewport: 1280 × 577 CSS pixels. Stationary fitted Nishitokyo view, default scene context. Rendering measurements repeated without simultaneous benchmark processes.
- Browser load: one traced remote URL load through `loadCityParquetFromUrl` and `addCityLayer`, invoking the existing scene and table lifecycles. Invocation bypassed form typing, not the ingestion pipeline. The welcome overlay was dismissed before the final rendering comparison.
- Stage timings: three fresh Node processes for the full Nishitokyo table; single runs at increasing Yokohama row limits. Real reader, decoder, normalization, mesh builder, ENU projection, geometry wrapper, and attribute serialization functions. No GPU or DuckDB in these Node runs.
- Subset reader mirrors the production column projection and raw-WKB parsers, but supplies a row limit. It still reads the entire local file into a buffer; it is **not** a network streaming prototype. Row groups can be decoded beyond the requested rows. Subsets take the beginning of the table and do not represent the detailed LoD 3/4 regions.
- Node RSS is process-wide resident memory, including runtime/buffers, not browser JS heap or GPU memory. Stage-boundary heap readings are not precise instantaneous peaks. No forced GC. The benchmark releases intermediate references before normalization; garbage-collection timing still varies.

## Source sizes

| Building table | Compressed file | Parquet uncompressed column bytes | Records | Row groups |
| -------------- | --------------: | --------------------------------: | ------: | ---------: |
| Nishitokyo     |        30.71 MB |                         139.78 MB |  84,862 |          2 |
| Yokohama       |       334.83 MB |                       1,534.20 MB | 884,106 |         14 |

Uncompressed Parquet bytes do not include the overhead of JS rows, nested arrays, coordinate triples, model copies, triangulation temporaries, or mesh buffers. See `*-storage.json` for per-column sizes. Both sources are building tables, not the whole multi-type package.

## Browser loading result: Nishitokyo

| Milestone / observation                                          |                                 Measurement |
| ---------------------------------------------------------------- | ------------------------------------------: |
| Network request to resource completion                           | 5.83 s; response was not from browser cache |
| Loader returns normalized model, measured from load start        |                                      9.17 s |
| Layer add returns, measured from load start                      |                                      9.23 s |
| Table ready observed, measured from load start                   |                                     15.53 s |
| Longest main-thread task                                         |                                      6.52 s |
| Later task containing the height correction rebuild              |                                      2.72 s |
| Sampled inclusive time in `setHeightOffset` / rebuild            |                                      2.55 s |
| Sampled inclusive time in `projectPositionsToEnu`, across builds |                                      3.49 s |
| Sampled inclusive time in geographic-to-UTM normalization        |                                      1.56 s |
| Sampled main-thread garbage collection                           |                                      0.69 s |
| Highest timer-sampled browser heap                               |                                     2.07 GB |
| Browser-reported JS heap limit                                   |                                     4.40 GB |

The 100 ms memory sampler cannot run during a main-thread stall, so its maximum is a lower bound. Table-ready time includes overlapping scene work and event-loop delay; it is **not** database query duration. We did not instrument a reliable first-city-pixel milestone. Inclusive CPU sample durations overlap and must not be summed. They are estimated from V8 sampling, not instrumented function wall times.

The trace and code agree on two geometry builds: initial construction and `setHeightOffset` after the geoid sample. `setHeightOffset` calls `rebuildGeometry`, which retriangulates, projects the expanded vertices, allocates new attributes and a base-color copy, then disposes the old geometry. The old/new buffers can coexist during this operation.

Raw local Chrome trace: `/tmp/roofy-nishitokyo-load-trace.json` (263 MB, deliberately not checked into the repository). Compact evidence is in `browser-trace-summary.json` and the browser result JSON files.

## Isolated CPU stages: Nishitokyo

Median of three fresh processes; timings include normal garbage collection.

| Stage                                        | Median |
| -------------------------------------------- | -----: |
| Parquet decompression / row assembly         | 1.12 s |
| WKB to city objects                          | 0.45 s |
| Bounds / vertex-count assembly               | 0.07 s |
| Geographic coordinates → UTM model           | 2.40 s |
| Triangulation / mesh arrays                  | 1.48 s |
| UTM mesh vertices → ENU                      | 2.24 s |
| Three.js geometry wrapping / bounding sphere | 0.06 s |
| Attribute row preparation                    | 0.22 s |
| Attribute JSON encoding                      | 0.25 s |

End-to-end process stage time ranged from 8.09–9.50 s, excluding network, GPU upload, geoid rebuild, styling copies and DuckDB. Individual stage medians need not add up to the median total. These Node results must not be added to the browser timings.

The selected mesh contains 1,913,792 triangles. Its five primary typed arrays total **252,620,544 bytes**, approximately 132 bytes per triangle. This excludes the base-color copy, textures, temporary triangulation structures, and GPU-side allocations. Full retained CityModel geometry includes all source LoDs: 824,261 surfaces and 3,970,085 ring vertices.

See `stages.jsonl` and `stage-summary.json` for memory, sample ranges, and Yokohama subset measurements.

## Yokohama scale test

| Records processed     |             CPU pipeline elapsed |                        Peak process RSS |
| --------------------- | -------------------------------: | --------------------------------------: |
| 10,000                |                           1.28 s |                                1.25 GiB |
| 65,536                |                           5.02 s |                                2.41 GiB |
| 131,072               |                          12.73 s |                                3.39 GiB |
| 884,106 (reader only) | Failed before row read completed | V8 OOM at ~4,095 MB heap with 4 GiB cap |

The full-reader worker failed after about 11 seconds including runner startup. Subset RSS includes the full compressed file buffer. RSS and the capped V8 heap are different measures and should not be compared as the same budget. The 131,072-record subset covers only 14.8% of the rows, mostly LoD 0/1. No linear extrapolation to full-city geometry memory is claimed.

## Database measurement

Separate warm-engine browser run using the displayed Nishitokyo model:

| Operation                                 |   Time |
| ----------------------------------------- | -----: |
| Prepare attribute rows                    | 154 ms |
| Encode 45.85 MB JSON                      | 175 ms |
| Register buffer with worker               |  15 ms |
| `read_json_auto` + create temporary table | 762 ms |
| Verify count = 84,862                     | 2.5 ms |

The temporary table and file were removed afterward. This isolates the main ingestion operations; it excludes normal registry bookkeeping, fixed-column coercions, and column-description queries. It is one warm-engine run, not a cold DuckDB startup benchmark. Avoiding JSON is worth investigating, but it is not the dominant measured problem here.

## Rendering measurement

Five seconds per condition, 1.5 seconds settling, same stationary camera. All runs observed 301 animation callbacks over approximately 5.01 s.

| Setting                            | p95 animation-frame interval | WebGL draw calls per callback |
| ---------------------------------- | ---------------------------: | ----------------------------: |
| Default                            |                      16.7 ms |                           356 |
| Shadows disabled                   |                      16.7 ms |                           235 |
| Shadows + post-processing disabled |                      16.7 ms |                           209 |

Draw counts include the whole scene (terrain, imagery and effect passes), not only city geometry. Counters wrap WebGL draw methods in the test browser. Animation-frame pacing is not a GPU timer; these results show no frame-pacing improvement under these settings at this resolution, not unlimited GPU headroom. Higher resolutions, camera motion, and full-Yokohama rendering remain unmeasured. Actual GPU command duration/VRAM allocation was not captured.

## Prioritized next experiments

1. **Bound the reader and resident model.** Row-group/range loading with backpressure, cancellation and eviction is required before a full-city test is viable. Merely iterating row groups but retaining every decoded object still grows without bound. The full reader OOMs even when no renderer/database is involved.
2. **Avoid the extra geoid-triggered triangulation.** Measure a placement/reprojection-only update or resolve the height sample alongside loading, preserving vertical-datum correctness. The trace attributes 2.55 s to the current second build. This is an opportunity, not a promised 2.55 s saving.
3. **Remove the geographic → UTM → geographic round trip from rendering.** Keep source doubles and produce local ENU render positions directly. Keep metric analysis needs explicit, rather than applying a degree-based approximation. Coordinate conversion took ~4.64 s combined in the isolated median stages; direct projection still has a cost and requires correctness checks.
4. **Workers and transferable buffers.** Move decode/triangulate/project work off the main thread. This addresses the measured multi-second stalls; it does not by itself reduce total memory or computation.
5. **Read only needed types/LoD columns.** Metadata-first Building-family selection and demand loading of other families are useful, but Yokohama's building file alone already fails. Preserve highest-selected-LoD fallback per object and parent/part relationships. Test actual transferred bytes and row-group pruning, not just displayed counts.
6. **Spatial chunks and buffer retention policy.** Enable culling and partial rebuilds. Measure indexed/packed attributes and geometry caching against picking, semantic boundaries, styles and normals before changing layouts. The primary Nishitokyo attributes alone are 253 MB.
7. **Optimize attribute ingestion after the above.** Test Arrow/direct Parquet attribute ingestion and per-family tables/views. Compare peak memory and time against the measured JSON path.

A follow-up should report bytes fetched, peak memory, time to first useful city geometry, table-ready time, longest main-thread task, frame pacing and geometry/count correctness for the same datasets. Set performance budgets after adding a production-build baseline and a representative lower-powered device; do not infer them from this M4 Max alone.

## Reproduction

Source files captured for this audit:

- https://cityparquet.open3d.city/data/plateau/nishitokyo-shi/building.parquet (moved from `…/plateau/nishitokyo/` by 2026-09-22; same SHA) — SHA-256 `f3c3a7a5e62f77dfd1484a3b5f6054c109d272ccb5360c87c2a3fa11036dd869`
- https://cityparquet.open3d.city/data/plateau/yokohama-shi/building.parquet (moved from `…/plateau/yokohama/`) — SHA-256 at capture `af97ac05425146027f0b21463cf3e800541aaa98b906d0116e7bef0c08b40369`; the copy downloaded from the moved URL on 2026-09-22 is 334,860,819 bytes, SHA-256 `dd432a1e41ea854a474dd5030d92cdf1a40fb20abd11ec30bb3d4b42d549dfdd`

The automated retained harness reproduces **Node CPU stages only**. Browser timings, frame counters, database timings and CPU trace were a one-off manual audit with agent-browser `profiler start` / `profiler stop`, performance marks around the loader/add/table-ready milestones, a Long Task observer, 100 ms heap sampling, and the WebGL/rAF counters described above. Browser instrumentation and the temporary trace-reduction script are not retained as a runnable regression harness; the raw local trace and compact evidence are retained. A repeatable browser harness is a follow-up before comparing an optimization's browser timing to this baseline.

Keep downloaded public building fixtures at `/tmp/nishitokyo-building.parquet` and `/tmp/yokohama-building.parquet` for this profile benchmark (`cityparquet-stream` defaults to `/data2/hideba/roofy-perf-data/yokohama-building.parquet`; `lod-switch` takes `AUDIT_FILE`). The benchmark does not download data or modify source files.

```sh
AUDIT_DATASET=nishitokyo AUDIT_LOG=/tmp/nishitokyo-profile.jsonl \
  npx vitest run --config scripts/performance/vitest.config.ts

AUDIT_DATASET=yokohama AUDIT_ROWS=65536 AUDIT_LOG=/tmp/yokohama-subset.jsonl \
  npx vitest run --config scripts/performance/vitest.config.ts
```

To reproduce the reader-only failure in an isolated worker, the following intentionally caps the heap. Expect an OOM/nonzero exit; it does not load the dataset into the viewer:

```sh
ulimit -c 0
AUDIT_DATASET=yokohama AUDIT_STOP_AFTER_READ=1 \
  AUDIT_LOG=/tmp/yokohama-reader.jsonl NODE_OPTIONS=--max-old-space-size=4096 \
  npx vitest run --config scripts/performance/vitest.config.ts
```

Benchmark projection mirrors the current private reader projection; review it if the production schema-selection code changes. Logs append one JSON record per completed stage, allowing a failed process's last completed boundary to be identified.

Benchmark maintenance note: lint validation subsequently corrected the subset reader’s appearance-column field mapping (`material`/`texture` to `materialName`/`textureName`). Historical subset measurements omitted those appearance columns; they are therefore not an exact production-projection baseline. Full-file Nishitokyo and the full-Yokohama reader-only OOM used the production reader and are unaffected. Future subset runs use the corrected projection.
