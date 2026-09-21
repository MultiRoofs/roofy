# CityParquet performance baseline — 2026-09-21

See [the Chrome DevTools MCP follow-up](devtools-followup.md) for a second browser load and measured LoD-switch costs, including a full rebuild when no object's effective LoD changes.

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

- https://cityparquet.open3d.city/data/plateau/nishitokyo/building.parquet — SHA-256 `f3c3a7a5e62f77dfd1484a3b5f6054c109d272ccb5360c87c2a3fa11036dd869`
- https://cityparquet.open3d.city/data/plateau/yokohama/building.parquet — SHA-256 `af97ac05425146027f0b21463cf3e800541aaa98b906d0116e7bef0c08b40369`

The automated retained harness reproduces **Node CPU stages only**. Browser timings, frame counters, database timings and CPU trace were a one-off manual audit with agent-browser `profiler start` / `profiler stop`, performance marks around the loader/add/table-ready milestones, a Long Task observer, 100 ms heap sampling, and the WebGL/rAF counters described above. Browser instrumentation and the temporary trace-reduction script are not retained as a runnable regression harness; the raw local trace and compact evidence are retained. A repeatable browser harness is a follow-up before comparing an optimization's browser timing to this baseline.

Keep downloaded public building fixtures at `/tmp/nishitokyo-building.parquet` and `/tmp/yokohama-building.parquet`. The benchmark does not download data or modify source files.

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
