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

## Direct geographic → ENU (task 6) — 2026-09-23

A streamed EPSG:6697 table stops being reprojected twice. Its rows are indexed
in a closed-form BUCKET frame (arithmetic, no proj4) and its rings stay
lon/lat/h until the worker converts them straight into the owning CELL's ENU
frame, before triangulation. Design, and the three coordinate spaces that keeps
apart, in `docs/architecture-notes.md` ("Three coordinate spaces for a streamed
geographic source"). The static path is UNCHANGED and still normalises to UTM.

**Conditions.** Node 24 on the Linux host, `NODE_OPTIONS="--max-old-space-size=4096
--expose-gc"`, the 334,860,819-byte `plateau/yokohama-shi/building.parquet` as a
local lazy `Blob`. BEFORE = `stream-node-yokohama.jsonl` (2026-09-22, one run).
AFTER = `stream-node-yokohama-after-task6.jsonl`, THREE runs concatenated, taken
under a load average near 30 caused by a foreign job on the same host — hence
the spread, which is why the range is published beside the median. Both sides
ran with `--expose-gc`; these figures must NOT be compared with the original
M4 Max baseline further down this file.

| Stage (local Blob, Node)               |                   Before |              After (3 runs) |                Median |
| -------------------------------------- | -----------------------: | --------------------------: | --------------------: |
| `open` (footer + 884,106-row index)    |                 8,417 ms |    6,069 / 6,289 / 6,573 ms |  **6,289 ms** (−25 %) |
| `pan-open` (re-open for the pan phase) |                 6,682 ms |    3,355 / 4,121 / 4,375 ms |  **4,121 ms** (−38 %) |
| 1 km read, every LoD (worst case)      |                 2,524 ms |    1,766 / 2,054 / 2,612 ms |  **2,054 ms** (−19 %) |
| 1 km read at LoD 2                     |                 2,190 ms |    1,299 / 1,525 / 1,581 ms |  **1,525 ms** (−30 %) |
| 10 × 1 km pan steps through the worker |                36,270 ms | 25,332 / 26,148 / 29,386 ms | **26,148 ms** (−28 %) |
| Bytes read: open / 1 km / LoD 2        | 24.49 / 12.83 / 12.35 MB |                   identical |                     — |

Over HTTP against the published URL (`AUDIT_HTTP=1`, same code, same 100/327/247
ranged requests and the same bytes): `open` 16,296 → 9,638 ms, 1 km read at
every LoD 6,135 → 4,684 ms, at LoD 2 4,820 → 3,885 ms, the pan phase
53,569 → 40,030 ms.

The header now reports `epsg: null` with a frame descriptor
(`{kind: "local-metric", lngDeg: 139.5947, latDeg: 35.4529}`) and an extent in
bucket metres (±11.75 km × ±15.50 km) where it used to report EPSG:32654 and
UTM eastings/northings.

**Retention is unchanged, and an earlier reading of it was an artefact.** An
intermediate measurement recorded `retainedDeltaMB` at `open` jumping 41.8 →
436.4 MB. That run was made WITHOUT `--expose-gc`, so the harness's `gc()` was a
no-op and the figure was live garbage, not the index: a deliberate no-gc control
run on the same code reads 244.3 MB. With `--expose-gc` the three runs read
**34.9 / 44.9 / 49.6 MB** against the before-run's 41.8 MB — the same packed
`Float64Array` index, as expected. `peakHeapMB` at `open` likewise moved with
the runs (before 612.6; after 411.7 / 435.3 / 608.7) rather than in one
direction. No retention claim is made beyond "unchanged".

**Browser smoke** (`geographic-enu-browser-smoke-yokohama.{json,png}`, and
`…-unselected.png` for the like-for-like frame). Chrome 147 headless with
SwiftShader over the Vite dev server, `develop` 4b79580, the real Yokohama table
streamed by share link at the pre-task-6 screenshot's camera
(139.622 E, 35.4625 N, 900 m, pitch −65).

- **Same place.** Against `stream-browser-smoke-yokohama.png` (2026-09-22,
  before the milestone): identical street grid, the same diagonal railway
  corridor, the same circular building at lower right, the same water at the
  right edge, the roofs on the same footprints. **21 resident cells in both.**
- **The geoid still applies.** Roof polygons coincide with their aerial-imagery
  footprints to a pixel or two. At this camera a 37 m vertical error — the
  EGM2008 undulation here — would displace a roof about 37·cos(65°) ≈ 16 m
  ≈ 9 px from its own footprint, and nothing of the sort is visible.
- **Picking and the inspector work.** The first pick hit a building and the
  Details panel read roof area 3,689.7 m², height 36.7 m, LoD 2, bounding box
  2675.7, 1744.4, 0.0 → 2752.1, 1833.6, 38.5 (bucket metres, as the header's
  extent now is). The fetch-bbox overlay names the frame: "Local metric frame ·
  139.5947°E, 35.4529°N, 2,292 m × 1,029 m".
- **No console errors** — the same two pre-existing warnings as the reference
  run (duplicate three.js, no Google Maps key).
- **Counts differ slightly, by design.** 4,508 objects / 12,568 roof surfaces,
  where the reference loaded 4,450 / 12,756. Two different transforms need not
  select identical rows for one axis-aligned box; the milestone's tests assert
  conservative COVERAGE, not equality.
- **OPEN QUESTION: a commit that times out never recovers, and the pattern is
  bimodal rather than noisy.** The successful run's first commit landed in
  28.9 s, just inside the plugin's 30 s `COMMIT_FETCH_TIMEOUT_MS` liveness
  bound. Tallying every commit observed on this host:

  |                                                                           |                                        landed | expired |
  | ------------------------------------------------------------------------- | --------------------------------------------: | ------: |
  | commits that had NOT already seen a timeout                               | **2 of 2** (21.0 s, 28.9 s, reference camera) |       0 |
  | RETRIES after one expired (forced camera settles, a full fresh 30 s each) |                                   **0 of 20** |      20 |

  Those 20 include 8 at the SAME reference camera the 2 successes used, plus 12
  at 600 m/−50° and 350 m/−40° where the LoD ladder asks for heavier geometry.
  Load produces a distribution around a threshold, not 0/20 against 2/2 at one
  camera, so something is carried over. The Node HTTP figures above show the
  READ path is 30–40 % faster than before with identical bytes, so this is not
  a task-6 read regression — but "host, not code" is more than the data
  supports and is not claimed.

  The suspect is the worker's abort. `streamWorkerCore` looks structurally
  clean (each `fetch` makes its OWN `AbortController`, `cancel` only aborts the
  current one, the cell cache is rolled back), but an `AbortSignal` cannot
  interrupt the SYNCHRONOUS hyparquet decode already running on the worker's
  one thread: a timed-out commit's work keeps going, the retry's message queues
  behind it, and every retry therefore starts already behind — a compounding
  stall rather than plain slowness. Unproven. The path is shared with
  FlatCityBuf, so it is probably pre-existing; confirming that needs the
  pre-task-6 tree re-smoked, which this milestone did not do. Worth one run on
  a quiet machine, and worth asking whether a timed-out commit should schedule
  its own retry instead of waiting for a camera settle that may never come.

Reproduce:

```sh
# Node, local Blob (the committed AFTER log):
NODE_OPTIONS="--max-old-space-size=4096 --expose-gc" \
  AUDIT_LOG=docs/performance/cityparquet-2026-09-21/stream-node-yokohama-after-task6.jsonl \
  npx vitest run --config scripts/performance/vitest.config.ts \
  scripts/performance/cityparquet-stream.test.ts

# Over the published URL:
AUDIT_HTTP=1 NODE_OPTIONS="--max-old-space-size=4096 --expose-gc" \
  npx vitest run --config scripts/performance/vitest.config.ts \
  scripts/performance/cityparquet-stream.test.ts
```

### Follow-up: the winding reference and the flatness convention (2026-09-23)

Two fixes after the milestone review changed what reaches the normal buffer —
`orientExteriorRing` now refuses an orientation reference weaker than
`2.5e-4 ×` the bbox diagonal (submodule `b5c27ae`), and `geodeticRingsToEnu`
seeds each object's ENU box from its FULL geodetic row extent rather than the
tight box of the surfaces that survived LoD filtering (`2f62b9e`), which is
what stopped a multi-polygon LoD 0 PLATEAU footprint inverting its highest
polygon — and a third gave flatness a name (`FLAT_INCLINATION_DEG = 0.1`,
`58e5671`), so a horizontal roof's Main orientation reads "Flat" instead of
"N (0°)". Each is pinned by unit tests; what no unit test can see is what the
GPU then does with them — the normal G-buffer, the shading, the picture — so it
was also smoked: `winding-flatness-browser-smoke-yokohama.{json,png}` plus
`-picked.png`, `-lod0.png` and `-lowsun.png`.

The frame matches both earlier smokes to the object: 4,508 objects, 12,568
roof surfaces, 21 resident cells. The **normal G-buffer was read back**, not
inferred — `view.buffers.normal` is `true`, the MRT attachment is texture
index 1, and at LoD 2 **531,200 of 531,216** written pixels store a normal
facing the eye ray (16 do not), at LoD 0 **362,576 of 362,576** do, with roof
pixels reading a view-space normal of (0.00, 0.42, 0.906) — world up, at the
camera's 25° off-axis angle. The JSON states the caveat that goes with it:
because the city material is `DoubleSide`, three flips the fragment normal by
`faceDirection` BEFORE the engine's MRT write, so the buffer shows the shaded
normal and cannot by itself discriminate a winding; the winding is measured
by a per-triangle census of the live meshes' flat face normals, which reads
roofs up / grounds down at LoD 2 and **99.94 % agreement on one direction**
across 16,058 horizontal LoD 0 footprint faces.

## Task 4 (on-demand attributes): measured 2026-09-23, not built

The handoff's task 4 — "on-demand attributes for clicked objects", behind a
gate of "two separate benchmarks on the real Yokohama file"
(`docs/plans/2026-09-22-cityparquet-bounded-loading.md`, § "Roadmap for
tasks 4–6") — was measured on 2026-09-23. **The gate refused the build.** A
streamed CityParquet layer therefore keeps reading its attribute columns WITH
its geometry, and `docs/plans/2026-09-22-cityparquet-on-demand-attributes.md`
records the decision in full. This section is the evidence.

**Method.** The per-column figures come from each file's Parquet footer — the
sum of `total_compressed_size` over every row group, per top-level column —
classified exactly as the reader classifies them (`tableReader.ts`:
`IDENTITY_COLUMNS` = `id, feature_id, object_type, parents, children, bbox`;
geometry = the `geometry`/`geometry_properties`/`material`/`texture` family;
attributes = the rest). The read figures come from the package's own vendored
hyparquet (`navara-cityparquet/src/vendor/hyparquet`) — the same primitive
`readRows` calls the streaming reader makes — driven through a counting
`AsyncBuffer` over real ranged HTTP, so they count the requests the proposed
transport would have paid. The package's built `dist/` is stale (it reports
`epsg: 32654` and carries no `tables` field), so the vendored reader was used
directly rather than the package entry point. The scripts lived in the
session's scratchpad and were not committed; this paragraph is enough to
reproduce them.

**Yokohama** (`…/plateau/yokohama-shi/building.parquet`, 319.35 MB, 884,106
rows, 14 row groups, 37 columns):

| kind      | compressed  |      share |
| --------- | ----------- | ---------: |
| geometry  | 262.55 MB   |    82.32 % |
| identity  | 55.59 MB    |    17.43 % |
| attribute | **0.79 MB** | **0.25 %** |

Attribute share of a full projection, per bake rung: rung 0 **0.62 %**, rung 1
0.27 %, rung 2 0.25 %, rungs 3–4 0.25 %. `measuredHeight` alone is 0.74 MB —
94 % of the attribute bytes; the other six footer attributes total 13.8 KB
across 884,106 rows. The footer declares `measuredHeight`, `creationDate`,
`class`, `function`, `yearOfConstruction`, `height`, `averageHeight`.

**Nishitokyo** (29.29 MB, 84,862 rows): identity 5.27 MB, attributes
**0.29 MB** — rung 0 **2.35 %**, rung 1 1.02 %, rungs 2–4 **0.99 %**.

**The click-path read the plan specified** (Yokohama, `id` plus the seven
footer attributes, `useOffsetIndex: true`):

| read                                     | ranged bytes | HTTP requests | warm ms | decoded |
| ---------------------------------------- | -----------: | ------------: | ------: | ------: |
| 1 row (`rowStart 500000, rowEnd 500001`) |      416,154 |            23 | 468–510 |   183 B |
| 1 row, another row group (100,000)       |      411,641 |            23 | 468–713 |   183 B |
| **2000 rows** (500,000–502,000)          |  **416,154** |        **23** |     662 |  355 KB |

**One row costs exactly what two thousand rows cost.** Offset indexes and
PAGES are the granularity, not rows. The cold first call was 3,554 ms; the
table above is warm. Decoded attributes are 182 B per row, with a mean of
**1.00** non-null attribute value per row over 2,000 sampled rows (only
`measuredHeight`) — because `readAttributes` (`decodeTable.ts`) skips null
cells, so a record holds exactly one attribute key on this data: six of
Yokohama's seven declared columns are all-null.

**The conclusion, stated for what it is: an on-demand per-object attribute
fetch was REFUSED BY MEASUREMENT, not deferred.** The plan's own gate (Task 1
Step 3) named 5 % of a fetch's bytes as the threshold below which "deferral
buys little"; both real datasets are under it at every rung, and the record
heap difference is nil because a null cell never becomes a key. Per click the
proposed transport would have spent 0.40 MB over 23 range requests — about
what reading those attributes for two thousand objects costs — to deliver
182 B containing one useful number. The finding is structural rather than a
PLATEAU artefact: a **wider** attribute table makes the per-row read worse,
because each extra column adds another offset-index fetch plus another whole
page per click.

The one case a per-object lookup would genuinely pay is a different feature
and a correctness bug rather than a performance task: a restored selection of
a NON-resident streamed object never resolves. It is recorded under "Open
follow-up" in `docs/roadmap.md`.

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
