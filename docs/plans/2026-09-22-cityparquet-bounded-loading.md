# CityParquet Bounded Loading (performance task 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Large CityParquet sources (Yokohama: 335 MB building table, 610 MB package) stream by viewport through range reads in a worker, with bounded residency, instead of being read whole on the main thread and crashing the tab.

**Architecture:** A second worker speaking the EXISTING streaming worker protocol (`navara-flatcitybuf/src/workerProtocol.ts`), so `FcbStreamLayerHandle`, `CellCache`, `planCommit`, the settle gate, picking, the inspector's resident records and the resident DuckDB table are reused unchanged. The FlatCityBuf worker is first split into a format-agnostic core (bucket → bake → post, recolor, surfaces, evict, rollback) plus a FlatCityBuf source adapter; the CityParquet worker is the same core plus a CityParquet source adapter (range-read footer, a row-level `bbox` index, row-range reads of only the geometry columns ≤ the requested LoD with `useOffsetIndex`, per-object highest-available LoD, EPSG:6697 → one fixed UTM zone per open). Small sources keep today's static path.

**Tech Stack:** TypeScript, Vite module workers, vendored hyparquet 1.28.1 (`asyncBufferFromUrl`, `parquetMetadataAsync`, `parquetReadObjects` with `rowStart/rowEnd/useOffsetIndex`), proj4, Vitest (Node for plugins, jsdom for the app).

**Spec:** the performance handoff (task list: 1 LoD no-op skip — done `e59dcf2`; 2 geoid in-place — done `ad23f36`; **3 bounded loading — this plan**; 4 on-demand attributes; 5 object families; 6 direct geographic→ENU) and `docs/performance/cityparquet-2026-09-21/README.md`.

## Global Constraints

- Follow `CLAUDE.md`: TDD red-green-refactor; submodule-first commits (`git -C packages/cityjson-navara-plugins push origin main`, then pointer bump); `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit prefixes; never run bare `vite`/`vp dev`; test files import from `"vitest"`.
- `@navaramap/*` imports only in the named engine-binding modules. Worker graphs import only `@cityjson/navara-core`, `@cityjson/navara-cityparquet`, their own package, `proj4`, hyparquet (vendored) and `hyparquet-compressors`.
- Plugin tests import specific engine-free modules, never a package barrel that pulls `@navaramap/three`.
- Every streaming-layer behaviour that exists for FlatCityBuf today (settle gate on `moveend`, 30 s commit timeout as a liveness bound, residency budgets `RESIDENT_TRIANGLE_BUDGET = 4M` / `RESIDENT_BYTE_BUDGET = 512 MiB`, abort on gesture start) applies unchanged to CityParquet streams.
- Keep requested visibility, geometry residency and database availability separate. Task 3 accepts ONE known coupling: a streamed CityParquet layer's DuckDB table is the existing `resident` source (resident rows only). This is stated in the UI copy and in `docs/architecture-notes.md`, and removed by task 5.
- Status must distinguish full-dataset from resident: a streamed layer shows `N of M loaded` where `M` is the dataset's object count (sum of object-table `num_rows`).
- Never recreate the missing-building bug: a CityParquet stream reads every geometry column whose LoD ≤ the requested rung and bakes each object at its highest available LoD among them (`buildCityMeshArrays` array path).
- Measured facts this plan relies on (2026-09-22, local Yokohama file, see `docs/performance/cityparquet-2026-09-21/`):
  - host `cityparquet.open3d.city` answers `206` to `Range`, preflight allows `range`, exposes `Content-Length, Content-Range`;
  - 1 000-row read of `id, bbox, geometry_lod1_0, geometry_lod0_0`: 21.1 MB without `useOffsetIndex`, **2.47 MB with it**;
  - full `bbox` column read: 22.2 MB, ~4 s in Node;
  - rows are spatially clustered (1 024-row runs: median extent 0.15 % of the dataset area);
  - Yokohama building table is now 334 860 819 bytes, SHA-256 `dd432a1e41ea854a474dd5030d92cdf1a40fb20abd11ec30bb3d4b42d549dfdd` (the handoff's capture differs).
- Streaming threshold: `CITYPARQUET_STREAM_THRESHOLD_BYTES = 128 * 1024 * 1024` over the sum of object-table sizes. Nishitokyo (83 MB package, 30.7 MB building table) stays static; Yokohama streams.
- **Bounded reads (Codex plan review, Critical).** Two gates, both on rows READ (hits plus merge gaps), not hits: (1) the adapter's `probe` answers `index.readCost(footprint)`, so the existing planner gate `VIEWPORT_FEATURE_BUDGET = 20000` (`constants.ts`, `planCommit` → too-far) refuses heavy viewports; (2) because a fetch queries the union of the requested cells (larger than the probed footprint), the adapter's `select` refuses before reading anything when `index.readCost(queryBBox) > MAX_FETCH_READ_ROWS = 60_000`, throwing an error with code `"budget"` (the handle reports the failed commit; nothing is read). Row ranges merge only across gaps of ≤ `MERGE_GAP_ROWS = 1024` rows. The HTTP range buffer REJECTS a `200` answer to a ranged request larger than 4 MiB (no silent whole-file download) and never caches slices; `cachedAsyncBuffer` is not used. Decoding is per range batch (one `ReadBatch` at a time), never a whole query's rows at once.
- **Families, not rows.** CityParquet rows are grouped into families: a root row (no `parents`) and the contiguous following rows that have `parents`. The index, the query, the read ranges and the cell ownership all work on families, so a Building and its parts are always read, baked and evicted together. Rows with a non-finite or missing bbox are excluded from the index and counted in the header (`invalidBBoxRows`).
- **Complete cells.** The worker core queries the UNION of the requested cells' extents, not the viewport footprint, so every requested cell is baked complete (today's FlatCityBuf code queries the footprint and caches partially filled boundary cells — fixed for both formats in Task 1).
- **LoD rule under streaming.** The CityParquet adapter reports the schema's geometry LoDs in every cell's `lodsSeen`, so the ladder knows all rungs from the first commit; `bakeLod(null)` means "every known LoD, highest available per object", never "all surfaces".

## What task 3 deliberately does NOT do

- Nishitokyo keeps its ~9 s main-thread static load (decode in a worker for the static path is a follow-up outside the six tasks).
- No appearance (textures/materials) under CityParquet streaming: the stream bakes plain semantic colours and reports no appearance themes. Static CityParquet keeps appearance.
- No attribute deferral (task 4), no per-family selection (task 5), no degree-space rendering (task 6).

## File Structure

Plugins (`packages/cityjson-navara-plugins/packages/`):

| File                                                       | Responsibility                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `navara-flatcitybuf/src/streamWorkerCore.ts` (new)         | Format-agnostic worker message handling: open bookkeeping, grid + placement, `fetch` bucket/bake/post with rollback, `recolor`, `surfaces`, `evict`, `cancel`, `close`. Takes a `StreamSourceAdapter`. |
| `navara-flatcitybuf/src/streamSourceAdapter.ts` (new)      | The adapter interface + `StreamHeader` type.                                                                                                                                                           |
| `navara-flatcitybuf/src/fcbSourceAdapter.ts` (new)         | FlatCityBuf adapter: `openFcb`, `checkAdmission`, `headerModel`, `select` → decoded feature models, appearance merger. Code moved out of `fcb.worker.ts`.                                              |
| `navara-flatcitybuf/src/fcb.worker.ts` (shrinks)           | `installStreamWorker(self, createFcbSourceAdapter())`.                                                                                                                                                 |
| `navara-flatcitybuf/src/cityparquet.worker.ts` (new)       | `installStreamWorker(self, createCityParquetSourceAdapter())`.                                                                                                                                         |
| `navara-flatcitybuf/src/workerClient.ts`                   | Constructor takes a `WorkerFormat` (`"flatcitybuf" \| "cityparquet"`) and picks the worker URL.                                                                                                        |
| `navara-flatcitybuf/src/workerProtocol.ts`                 | `open` gains `{ urls: string[] }` / `{ blobs: Blob[] }` sources and `format`.                                                                                                                          |
| `navara-flatcitybuf/src/streamRegistry.ts`                 | `OpenStreamOptions.format`, multi-source `source`, `createClient(format)`.                                                                                                                             |
| `navara-cityparquet/src/vendor/hyparquet/index.d.ts`       | Type the APIs used: `asyncBufferFromUrl`, `FileMetaData.row_groups`, `rowStart/rowEnd/useOffsetIndex`.                                                                                                 |
| `navara-cityparquet/src/rangeSource.ts` (new)              | `AsyncBuffer` from a URL (hyparquet `asyncBufferFromUrl` + `AbortSignal`) or a `Blob` (`blob.slice(s,e).arrayBuffer()`), with a byte counter for tests.                                                |
| `navara-cityparquet/src/rowIndex.ts` (new)                 | Row-level bbox index over one or more tables: per-row `Float64Array` bounds, 1 024-row runs with merged bounds, `query(bbox) → RowRange[]`, `count(bbox)`.                                             |
| `navara-cityparquet/src/geographicToProjected.ts` (new)    | The ONE function that turns decoded source coordinates into the stream's metric CRS (EPSG:6697 → fixed UTM zone; metric EPSG passthrough). Task 6 replaces this seam.                                  |
| `navara-cityparquet/src/streamReader.ts` (new)             | `openCityParquetStream(sources) → { header, index, readRows(ranges, maxLod, signal) }` using `readCityParquetRows` + `decodeTableObjects`.                                                             |
| `navara-cityparquet/src/tableReader.ts`                    | Extract `readCityParquetRows({file, metadata, footer, geometryColumns, rowStart, rowEnd, maxLod})` from `readCityParquetTable` (which keeps its signature).                                            |
| `navara-flatcitybuf/src/cityParquetSourceAdapter.ts` (new) | Adapter over `openCityParquetStream`: header/admission, `probe` = `index.count`, `select` = feature-grouped models for the rows in the bbox.                                                           |

App (`src/`):

| File                                                                     | Responsibility                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/cityparquet/streamDecision.ts` (new)                       | `decideCityParquetMode(source) → {mode:"static"} \| {mode:"stream", sources}` from manifest `file:size` / HEAD `Content-Length` / `File.size`. |
| `src/features/layers/useLayerFileLoader.ts`                              | Route CityParquet URL / files / folder through `decideCityParquetMode`; stream → `openStreamingLayer({format:"cityparquet", …})`.              |
| `src/features/streaming/openStreamingLayer.ts`                           | Accept `format` and multi-source; stub model `sourceEncoding` per format.                                                                      |
| `src/features/streaming/useTotalObjectCount.ts` + `src/ui/StatusBar.tsx` | `N of M loaded` for streamed layers with a known total.                                                                                        |
| `src/features/streaming/streamStore.ts`                                  | Store `header.featuresCount` (already on the header) for the total.                                                                            |

Tests: mirror each file under `packages/*/tests/` and `tests/unit/…`. New fixture: `navara-cityparquet/tests/fixtures/multigroup-cityparquet/` (see Task 3).

---

### Task 1: Split the FlatCityBuf worker into a core and a FlatCityBuf adapter (pure refactor)

**Files:**

- Create: `navara-flatcitybuf/src/streamSourceAdapter.ts`, `navara-flatcitybuf/src/streamWorkerCore.ts`, `navara-flatcitybuf/src/fcbSourceAdapter.ts`
- Modify: `navara-flatcitybuf/src/fcb.worker.ts` (becomes a 5-line entry)
- Test: `navara-flatcitybuf/tests/streamWorkerCore.test.ts` (new); existing `fcbWorkerCache.test.ts`, `fcbWorkerTraversal.test.ts` must pass unchanged

**Interfaces:**

- Produces:

  ```ts
  // streamSourceAdapter.ts
  export interface StreamHeader {
    // what the app reads: extent, epsg, referenceSystem (+ counts)
    readonly version: string;
    readonly featuresCount: number | undefined;
    readonly extent: BBox3 | undefined; // in the stream's METRIC CRS
    readonly referenceSystem: string | undefined;
    readonly epsg: number | null; // metric EPSG the cells are built in
  }
  export interface OpenedSource {
    readonly header: StreamHeader;
    readonly admission: AdmissionError | null;
  }
  export interface StreamSourceAdapter {
    open(req: OpenRequest): Promise<OpenedSource>;
    probe(
      bbox: readonly [number, number, number, number],
      signal: AbortSignal,
    ): Promise<number>;
    /** Decoded features (one CityModel per feature: an object plus its parts)
     *  whose objects intersect `bbox`, in the header's metric CRS. `lod` is
     *  the requested rung: the adapter may skip geometry above it. */
    select(
      bbox: readonly [number, number, number, number],
      opts: { lod: string | null; signal: AbortSignal },
    ): AsyncIterable<CityModel>;
    /** Layer-wide appearance built so far (FlatCityBuf merges per feature);
     *  `undefined` when the format carries none. */
    appearance(): CityAppearance | undefined;
    /** How `fetch` bakes `lod`: FlatCityBuf keeps today's exact-LoD filter
     *  (`lod`), CityParquet bakes the highest available ≤ lod (an array). */
    bakeLod(
      lod: string | null,
      lodsSeen: ReadonlyArray<string>,
    ): string | readonly string[] | null;
    close(): void;
  }
  // streamWorkerCore.ts
  export function installStreamWorker(
    ctx: {
      postMessage(m: WorkerResponse, t?: Transferable[]): void;
      onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
    },
    adapter: StreamSourceAdapter,
  ): void;
  ```

  `AdmissionError` moves from `fcbSource.ts` to `streamSourceAdapter.ts` (re-exported from `fcbSource.ts` for existing importers). `FcbHeaderModel` becomes a type alias of `StreamHeader`.

- [ ] **Step 1: Write the failing core test.** `streamWorkerCore.test.ts` drives `installStreamWorker` with a FAKE adapter (two features in two cells, EPSG:28992 extent) and a fake `ctx` that records posted messages. Cover: `open` posts `opened` with the adapter's header/admission; `probe` posts `probed` with the adapter's count; `fetch` posts one `cell` per requested non-empty cell then `done`, with `assertCellGeometry` passing and `objects` records per object; a fetch aborted by a second fetch posts `error {aborted:true}` and leaves no cell in the worker cache (a following `surfaces` for its object answers `not-found`); `evict` then `surfaces` answers `not-found`; `recolor` posts `recolored` for cached cells only.
- [ ] **Step 2: Run** `cd packages/cityjson-navara-plugins && pnpm vitest run packages/navara-flatcitybuf/tests/streamWorkerCore.test.ts` — FAIL (module missing).
- [ ] **Step 3: Move code.** Cut the generic parts of `fcb.worker.ts` (`CachedCell`, `CellPlacement`, `cells`, `appearanceThemesSeen`, `cellTextures`, `distinctLods`, the whole `fetch`/`recolor`/`surfaces`/`evict`/`cancel`/`close` handling, rollback) into `streamWorkerCore.ts`. `open` in the core calls `adapter.open`, then — if admitted — builds `grid = makeGrid(header.extent)` and `placement` exactly as today. `fetch` iterates `adapter.select(...)` instead of the FCB cursor, keeps the 64-feature yield, calls `buildCityMeshArrays(cellModel, key, origin, adapter.bakeLod(msg.lod, distinctLods(cellModel)), hiddenTypes, msg.appearance ?? null, surfaceColors)`. Move the FCB-only open/probe/select/appearance-merger code into `fcbSourceAdapter.ts` (`bakeLod` returns `lod` unchanged). `fcb.worker.ts` becomes:
  ```ts
  /// <reference lib="webworker" />
  import { installStreamWorker } from "./streamWorkerCore";
  import { createFcbSourceAdapter } from "./fcbSourceAdapter";
  installStreamWorker(self as unknown as Worker, createFcbSourceAdapter());
  ```
- [ ] **Step 4: Run** the new test and the whole package: `pnpm vitest run packages/navara-flatcitybuf` — all PASS, including the untouched `fcbWorkerCache` / `fcbWorkerTraversal` suites. `pnpm typecheck` clean.
- [ ] **Step 5: Commit** (submodule): `refactor(navara-flatcitybuf): split the stream worker into a format-agnostic core and a FlatCityBuf adapter`.
- [ ] **Step 6: Failing test — complete boundary cells.** In `streamWorkerCore.test.ts`: a `fetch` whose `bbox` covers only the west half of cell K (with K in `cells`) must still bake the objects owned by K in its east half (fake adapter records the bbox it was asked for; assert it equals the union of `cellBounds(grid, key, level)` over `cells`, clamped to the grid extent). Run — FAIL.
- [ ] **Step 7: Implement** in the core: `const queryBBox = unionOfCellBounds(grid, msg.cells, msg.level)` (add `cellBounds` to `tileGrid.ts` if absent) and pass it to `adapter.select`/`adapter.probe` users; `msg.bbox` remains only a diagnostic. Run package tests — PASS (update any FCB traversal assertion that pinned the old footprint query, with a comment citing this fix). Commit: `fix(navara-flatcitybuf): a fetch bakes every requested cell complete, not only its part inside the view`.
- [ ] **Step 8:** `bucketFeatures` takes the model's `sourceEncoding` instead of hard-coding `"flatcitybuf"`, and gains `ownership: "object" | "feature"` (default `"object"` = today). `"feature"` assigns every object of a model to the cell owning the MODEL's bbox (the family union). Test both; commit.

### Task 2: Worker format seam in the client, protocol and registry

**Files:**

- Modify: `navara-flatcitybuf/src/workerClient.ts`, `workerProtocol.ts`, `streamRegistry.ts`, `FlatCityBufPlugin.ts`, `index.ts`
- Create: `navara-flatcitybuf/src/cityparquet.worker.ts` (placeholder adapter that answers `open` with admission `{code:"unsupported", message:"CityParquet streaming is not available yet"}` — replaced in Task 5)
- Test: `workerClient.test.ts`, `streamRegistry.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export type WorkerFormat = "flatcitybuf" | "cityparquet";
  export type StreamSource =
    | { readonly url: string }
    | { readonly blob: Blob }
    | { readonly urls: ReadonlyArray<string> }
    | { readonly blobs: ReadonlyArray<Blob> };
  // workerProtocol open:  { type: "open"; id; source: StreamSource } & OpenExtras
  // OpenStreamOptions: + readonly format?: WorkerFormat  (default "flatcitybuf"); source: StreamSource
  // StreamLayerRegistryDeps.createClient: (format: WorkerFormat) => WorkerClient
  // new WorkerClient(format: WorkerFormat = "flatcitybuf")
  ```
  The `open` request changes shape from `{url}|{blob}` fields to one `source` field; `fcbSourceAdapter.open` accepts only `{url}` or `{blob}` and admits `{urls|blobs}` of length 1 by unwrapping, refusing longer with admission code `"multi-source"`.
  `AdmissionCode` gains `"unsupported" | "multi-source" | "mixed-crs" | "no-range"`. `StreamHeader` gains `readonly objectsCount?: number` (individual CityObjects in the dataset — CityParquet sets it to the sum of `num_rows`; FlatCityBuf leaves it undefined because `featuresCount` counts features) and `readonly lods?: ReadonlyArray<string>` (the source's known LoDs, when the format knows them up front).
  **Open is idempotent per source:** the registry opens twice (once to learn the extent, once with the resolved geoid offset — `streamRegistry.ts` `openStream`). The core keys the opened adapter by a source key (`url(s)` joined, or Blob identity) and a second `open` for the same source only re-establishes placement/palette without calling `adapter.open` again. Test: two opens of the same source call `adapter.open` once.
- [ ] **Step 1: Failing tests.** `workerClient.test.ts`: with a stubbed global `Worker` capturing the constructor URL, `new WorkerClient("cityparquet")` constructs a URL ending `cityparquet.worker.ts`; default ends `fcb.worker.ts`. `streamRegistry.test.ts`: `openStream({format:"cityparquet", …})` calls `createClient("cityparquet")`; omitted format calls `createClient("flatcitybuf")`; the `open` request carries `source`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Two literal `new Worker(new URL("./fcb.worker.ts", import.meta.url), {type:"module"})` / `new Worker(new URL("./cityparquet.worker.ts", import.meta.url), {type:"module"})` branches (Vite needs literal specifiers). Registry passes `opts.format ?? "flatcitybuf"` to `createClient` and `source` into `open`. `textures.baseUrl` stays `"url" in source ? source.url : null`.
- [ ] **Step 4: Run** package tests + typecheck — PASS.
- [ ] **Step 5: Commit** (submodule): `feat(navara-flatcitybuf): a stream opens with a worker format and one or more sources`.

### Task 3: Multi-row-group fixture, hyparquet typings and range sources

**Files:**

- Create: `navara-cityparquet/tests/fixtures/multigroup-cityparquet/building.parquet` + `metadata.json` (generated), provenance section in `navara-cityparquet/tests/fixtures/README.md`
- Create: `navara-cityparquet/src/rangeSource.ts`; Modify: `navara-cityparquet/src/vendor/hyparquet/index.d.ts`
- Test: `navara-cityparquet/tests/rangeSource.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface RangeBuffer extends AsyncBuffer {
    readonly bytesRead: () => number;
    /** The signal every subsequent `slice` is fetched under — set per request
     *  by the worker (`fetch`/`probe`), so an abort cancels in-flight range
     *  reads and a later request is not poisoned by an earlier abort. */
    setSignal(signal: AbortSignal | undefined): void;
  }
  export function asyncBufferFromBlob(blob: Blob): RangeBuffer;
  /** Own implementation (not hyparquet's `asyncBufferFromUrl`, which accepts a
   *  200 by downloading and retaining the whole file): HEAD for the length
   *  (fallback: `Range: bytes=0-0` and read `Content-Range`), then one ranged
   *  GET per slice; a `200` to a ranged GET of more than 4 MiB throws
   *  `RangeNotSupportedError`; no slice is cached. */
  export function asyncBufferFromHttp(
    url: string,
    opts?: { byteLength?: number; fetch?: typeof fetch },
  ): Promise<RangeBuffer>;
  export class RangeNotSupportedError extends Error {}
  ```
- [ ] **Step 1: Generate the fixture** from the existing EPSG:7415 `two-buildings-cityparquet/building.parquet` with pyarrow + shapely: 20 copies `k = 0..19` of its rows, each copy translated by `k * 50 m` east IN THE WKB GEOMETRY (shapely `wkb.loads` → `affinity.translate` → `wkb.dumps(output_dimension=3)`) and in `bbox`, with ids, `feature_id`, `parents` and `children` rewritten to `<id>_k` so families stay consistent and adjacent; rewrite the footer's extent-bearing metadata to the new extent; copy all other `city`/`geo` key-value metadata verbatim; write with `row_group_size=8`, `data_page_size=256` (several pages per row group for the geometry columns) and `write_page_index=True`. Script committed as `navara-cityparquet/tests/fixtures/multigroup-cityparquet/make_fixture.py`; run with `uv run --with pyarrow --with shapely python make_fixture.py`. The script asserts `num_row_groups >= 5`, ≥ 2 pages per geometry column chunk, and an offset index on every column chunk. A second fixture `multigroup-noindex-cityparquet/` is the same data written with `write_page_index=False` (to test the fallback).
- [ ] **Step 2: Failing tests.** `rangeSource.test.ts`: `asyncBufferFromBlob(new Blob([bytes]))` returns identical bytes for `slice(10, 20)` and counts 10 bytes; `parquetReadObjects({file: blobBuffer, rowStart: 18, rowEnd: 21, columns:["id","geometry_lod2_0"], useOffsetIndex: true})` (a PARTIAL range inside one row group) returns those 3 ids and reads fewer bytes than the same call without `useOffsetIndex`; on the no-index fixture the same call still returns the right rows. `asyncBufferFromHttp` with an injected `fetch`: issues `Range: bytes=s-(e-1)`; a `200` for a 5 MiB range throws `RangeNotSupportedError`; after `setSignal(aborted)` a slice rejects with `AbortError`, and after `setSignal(fresh)` the next slice succeeds (abort then retry).
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** (own `fetch` per slice with the current signal; extend `index.d.ts` with `asyncBufferFromUrl`, `AsyncBuffer`, `FileMetaData.row_groups: {num_rows: bigint | number; columns: {meta_data?: {path_in_schema: string[]; statistics?: unknown}; offset_index_offset?: bigint; offset_index_length?: number}[]}[]`, and `rowStart`, `rowEnd`, `useOffsetIndex` on `parquetReadObjects` options). **Step 5: Run** — PASS; typecheck. **Step 6: Commit** (submodule): `feat(navara-cityparquet): range-read sources and a multi-row-group fixture`.

### Task 4: Family index, projected coordinates and the stream reader

**Files:**

- Create: `navara-cityparquet/src/familyIndex.ts`, `geographicToProjected.ts`, `streamReader.ts`; Modify: `tableReader.ts` (extract `readCityParquetRows`), `decodeTable.ts` (optional row metadata out), `index.ts` (export the new modules and `asyncBufferFromBlob`/`asyncBufferFromHttp`/`RangeNotSupportedError`)
- Test: `navara-cityparquet/tests/familyIndex.test.ts`, `geographicToProjected.test.ts`, `streamReader.test.ts`

**Interfaces:**

- Produces:
  ```ts
  // familyIndex.ts — families = a root row plus the contiguous following rows with `parents`
  export interface FamilyRange {
    readonly table: number;
    readonly start: number;
    readonly end: number;
  } // rows, end exclusive
  export interface FamilyIndex {
    readonly rowCount: number; // valid rows
    readonly invalidBBoxRows: number; // excluded: non-finite / missing bbox
    readonly extent: BBox3; // projected, finite, non-degenerate (else open refuses)
    /** Ranges covering every family whose union bbox intersects `bbox`,
     *  merged across gaps ≤ MERGE_GAP_ROWS (1024). */
    query(bbox: readonly [number, number, number, number]): FamilyRange[];
    /** Rows `query(bbox)` would read, gaps included — the probe's answer. */
    readCost(bbox: readonly [number, number, number, number]): number;
  }
  export function buildFamilyIndex(
    tables: ReadonlyArray<FamilyColumns>,
  ): FamilyIndex;
  export interface FamilyColumns {
    // one entry per table, built per row group into packed arrays
    readonly minX: Float64Array;
    readonly minY: Float64Array;
    readonly minZ: Float64Array;
    readonly maxX: Float64Array;
    readonly maxY: Float64Array;
    readonly maxZ: Float64Array;
    readonly isRoot: Uint8Array; // 1 where `parents` is null/empty
  }
  // geographicToProjected.ts — the ONE seam task 6 replaces
  export interface CoordinateTarget {
    readonly sourceEpsg: number;
    readonly epsg: number;
    toTarget(x: number, y: number): [number, number];
  }
  export function coordinateTargetFor(
    sourceEpsg: number,
    lngLatCentre: readonly [number, number] | null,
  ): CoordinateTarget; // 6697 → 326xx/327xx; metric → identity; else NonMetricCrsError
  export function projectCityObjects(
    objects: Record<string, CityObject>,
    target: CoordinateTarget,
  ): void; // in place: rings + bbox
  // streamReader.ts
  export interface StreamRow {
    readonly table: number;
    readonly row: number;
    readonly familyRoot: string;
  }
  export interface ReadBatch {
    readonly objects: Record<string, CityObject>;
    readonly rows: ReadonlyMap<string, StreamRow>;
  }
  export interface CityParquetStream {
    readonly header: {
      version: string;
      objectsCount: number;
      extent: BBox3;
      epsg: number;
      referenceSystem: string;
      lods: string[];
      invalidBBoxRows: number;
    };
    readonly index: FamilyIndex;
    /** One batch per FamilyRange; `rows` keys are object ids (task 4 of the
     *  roadmap reuses them for attribute lookups). */
    readRows(
      ranges: ReadonlyArray<FamilyRange>,
      maxLod: string | null,
      signal: AbortSignal,
    ): AsyncIterable<ReadBatch>;
  }
  export function openCityParquetStream(
    buffers: ReadonlyArray<RangeBuffer>,
    opts?: { lngLatCentre?: readonly [number, number] },
  ): Promise<CityParquetStream>;
  ```
  Opening reads, per table, the footer (`parquetMetadataAsync`) and then `bbox` + `parents` **one row group at a time**, packing into the `Float64Array`/`Uint8Array` columns (never a whole-table array of JS row objects). It enforces one source EPSG across all tables (else throws `AdmissionRefused("mixed-crs")`), and a finite, non-degenerate projected extent. `readRows` reads `id, feature_id, object_type, parents, children, bbox`, the footer's attribute columns, `other_attributes`, and every geometry column (+ props) with LoD ≤ `maxLod` (all when `null`), with `rowStart/rowEnd/useOffsetIndex: true`, sets each buffer's signal from its argument, checks `signal.aborted` between row groups and every 256 decoded rows, and applies `projectCityObjects`. The UTM zone is chosen once at open (from `lngLatCentre`, else the source extent centre).
- [ ] **Step 1: Failing tests.** `familyIndex.test.ts`: synthetic tables (3 clusters, families of 1–4 rows, some rows with NaN bbox) → `query` covers every intersecting family whole (no family split across a range boundary), never an out-of-bounds row, and `readCost` equals the rows those ranges span; invalid rows are counted and never returned alone; a box hitting one row every 1 100 rows across 50 000 rows yields ranges whose total length is ≤ hits × largest family + merges (no whole-table range). `geographicToProjected.test.ts`: 6697 centre (139.6, 35.45) → EPSG:32654, agrees with proj4 to 1e-6 m; 7415 → identity; 4326 → throws. `streamReader.test.ts` on the multigroup fixture via `asyncBufferFromBlob`: header `objectsCount` = row count, `lods` = the schema's geometry LoDs, extent = merged row bboxes; `readRows(index.query(box around copy k=9))` yields exactly copy 9's objects (all family members) with rings and a `rows` entry each; `maxLod:"1"` reads fewer bytes than `null` and yields no LoD-2 surfaces; a two-table open with different EPSGs throws `mixed-crs`; aborting mid-iteration rejects with `AbortError`, and a following `readRows` with a fresh signal succeeds.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; typecheck. **Step 5: Commit** (submodule): `feat(navara-cityparquet): a family-indexed CityParquet stream reader with one projected CRS per open`.

### Task 5: The CityParquet worker adapter

**Files:**

- Create: `navara-flatcitybuf/src/cityParquetSourceAdapter.ts`; Modify: `navara-flatcitybuf/src/cityparquet.worker.ts`, `navara-flatcitybuf/package.json` (dependency `"@cityjson/navara-cityparquet": "file:../navara-cityparquet"`)
- Test: `navara-flatcitybuf/tests/cityParquetSourceAdapter.test.ts`, plus a conformance block in `streamWorkerCore.test.ts` run against both adapters

**Interfaces:**

- Consumes: `openCityParquetStream`, `asyncBufferFromHttp`, `asyncBufferFromBlob` (Task 3–4); `StreamSourceAdapter` (Task 1); `StreamSource` (Task 2).
- Produces: `createCityParquetSourceAdapter(): StreamSourceAdapter`. `probe(bbox)` = `index.readCost(bbox)`. `select` yields one `CityModel` per family (`StreamRow.familyRoot`), `bbox` = the family union, `sourceEncoding: "cityparquet"`; the core buckets CityParquet models with `ownership: "feature"` (adapter property `ownership`). `bakeLod(lod)` returns every header LoD `≤ lod` (every header LoD when `lod === null`), descending — highest available per object, never "all surfaces". The core adds `header.lods` to every posted cell's `lodsSeen`. Admission: `null` when the reader opened, the CRS is metric or 6697, and the extent is valid; `{code:"non-metric-crs"}`, `{code:"mixed-crs"}`, `{code:"degenerate-extent"}`, `{code:"no-range"}` (the server refused ranges) otherwise. Worker memory: the adapter holds the index (Yokohama: 6 × 8 B + 1 B per row ≈ 43 MB) and nothing per fetch beyond the batch being decoded; resident cell models are the core's `cells` map, released by `evict`.
- [ ] **Step 1: Failing tests.** Adapter on the fixture blob: `open` header `epsg === 7415`, `objectsCount` = rows, `lods` from the schema; `probe(box)` equals `index.readCost(box)`; `select(box, {lod:"1"})` yields one model per family whose union bbox intersects the box, parts together with their root; `bakeLod("2")` on a header with LoDs 0–3 → `["2","1","0"]`, `bakeLod(null)` → `["3","2","1","0"]`. Core with this adapter: a family whose parts' bboxes straddle a cell boundary lands entirely in one cell; evicting that cell removes the whole family. Conformance: the same `fetch` scenario from Task 1's test runs against the real CityParquet adapter on the fixture and posts cells that pass `assertCellGeometry` and cover every object in the requested cells.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; `cityparquet.worker.ts` = `installStreamWorker(self, createCityParquetSourceAdapter())`. Run `pnpm install` in the submodule, then at the app root `npm install` (lockfile coupling — see memory note) and confirm `git diff package-lock.json` only touches the flatcitybuf entry. **Step 4: Run** package tests + typecheck — PASS. **Step 5: Commit** (submodule), then push the submodule.

### Task 6: App routing — stream large CityParquet sources

**Files:**

- Create: `src/features/cityparquet/streamDecision.ts`; Modify: `src/features/layers/useLayerFileLoader.ts`, `src/features/streaming/openStreamingLayer.ts`, `src/features/cityparquet/loadCityParquet.ts` (export `cityParquetTargets(source)` = today's `targetsFor` result incl. manifest sizes)
- Test: `tests/unit/features/cityparquet/streamDecision.test.ts`, `tests/unit/features/layers/useLayerFileLoader.test.ts`, `tests/unit/features/streaming/openStreamingLayer.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export const CITYPARQUET_STREAM_THRESHOLD_BYTES = 128 * 1024 * 1024;
  export type CityParquetMode =
    | { readonly mode: "static" }
    | {
        readonly mode: "stream";
        readonly source: StreamSource;
        readonly totalBytes: number;
      };
  export async function decideCityParquetMode(
    input:
      | {
          kind: "url";
          url: string;
          http: HttpClient;
          headLength: (url: string) => Promise<number | null>;
        }
      | { kind: "files"; files: ReadonlyArray<File> },
  ): Promise<CityParquetMode>;
  ```
  URL table → `headLength(url)`; package-dir → sum of manifest `file:size` of object tables (falls back to `headLength` per table when absent) — so `parseCityParquetManifest` must KEEP `file:size` per object table (extend `CityParquetManifest` with `sizes: Record<href, number>`); `storage-*` → the listing's object sizes (extend `listStorageObjects` results with `size`); files → `File.size` sum. When no size is available, read the table's footer through `asyncBufferFromHttp` and use the sum of its row groups' `total_compressed_size` — "unknown" never silently routes a huge table into the static path; a failure to learn any size (no HEAD, no ranges) stays static, as today. Sidecars never stream (textures are not streamed in task 3). `openStreamingLayer` gains `format?: WorkerFormat` (default `"flatcitybuf"`) and `source: StreamSource`; the stub model's `sourceEncoding` is `format === "cityparquet" ? "cityparquet" : "flatcitybuf"`. `modelRef` is unchanged (`{type:"url", url}` / `{type:"file"}`), so save/share/restore re-run the decision. Known limitation carried forward: relinking a saved LOCAL multi-file layer accepts one file (`App.tsx` `handleResolveUnavailableLayer`), so a streamed local folder restores only from its first table — recorded in the architecture notes, not fixed here.
- [ ] **Step 1: Failing tests.** Decision: a 335 MB HEAD → stream with `{url}`; a manifest summing 610 MB → stream with `{urls:[…object tables…]}` (sidecars excluded); 83 MB → static; unknown → static; files 200 MB → stream `{blobs}`. Loader: `addLayerFromUrl("…/yokohama-shi/")` with a fake decision `stream` calls `openStreamingLayer` with `format:"cityparquet"` and never calls `loadCityParquetFromUrl`; `static` keeps today's path (existing tests unchanged).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (`headLength` in the app = `fetch(url, {method:"HEAD"})` → `Content-Length`, wrapped in `browserPlatform`; tests inject). **Step 4: Run** app tests + `npx tsc -b --noEmit` — PASS. **Step 5: Commit** (app, with the submodule pointer bump from Tasks 1–5).

### Task 7: "N of M loaded" for streamed layers

**Files:**

- Modify: `src/features/streaming/useTotalObjectCount.ts`, `src/ui/StatusBar.tsx`, `src/app/App.tsx` (prop), `src/ui/layers/DetailsSection.tsx` (resident line)
- Test: `tests/unit/features/streaming/useTotalObjectCount.test.ts`, `tests/unit/ui/StatusBar.test.tsx`

**Interfaces:**

- Produces: `useTotalObjectCount(): { loaded: number; total: number | null }` — `total` is the sum over layers of (static: object count; streamed: `header.objectsCount`), `null` when any streamed layer's `objectsCount` is undefined (every FlatCityBuf layer today). StatusBar renders `· 12.3K of 884K loaded objects` when `total !== null && total !== loaded`, else today's `· N loaded objects`.
- [ ] **Step 1: Failing tests** for both. **Step 2: Run** — FAIL. **Step 3: Implement.** Copy: DetailsSection for a streamed layer shows `Showing the objects in view — 12,301 of 884,106 loaded. The table and statistics cover loaded objects only.` **Step 4:** `useObjectSurfaces` (`src/features/streaming/useResidentSurfaces.ts`) re-fetches when the layer's stream version changes (a LoD refetch changes the resident surfaces) — failing test first. **Step 5: Run** — PASS. **Step 6: Commit.**

### Task 8: Real-data validation, docs and review

- [ ] **Step 1: Node benchmark** `scripts/performance/cityparquet-stream.test.ts` (with `/// <reference types="node" />`): open the local Yokohama file through `asyncBufferFromBlob` + `openCityParquetStream`, record open time, bytes read, index size and peak RSS/heap during the open; then `readRows(index.query(1 km box around Yokohama station ≈ 139.622, 35.466))` bytes/time/objects/peak heap; then a pan sequence of 10 boxes with the core's cell budget applied, recording retained worker-side model count; the same through the real HTTP URL behind `AUDIT_HTTP=1`. Log JSONL to `docs/performance/cityparquet-2026-09-21/stream-*.jsonl`.
- [ ] **Step 2: Browser smoke** (CDP recipe in memory `host-tooling-quirks` / scratchpad `cdp-smoke.mjs`): share link to `https://cityparquet.open3d.city/data/plateau/yokohama-shi/building.parquet`, camera over Yokohama station at 1 500 m; wait for `of 884` in `.statusbar`; record time-to-first-resident, JS heap, console errors; screenshot. Pass = no tab crash, objects render, heap well under the static failure.
- [ ] **Step 3: Docs.** `docs/architecture-notes.md`: "CityParquet streams through the FlatCityBuf worker protocol" (why, the threshold, the LoD rule, the resident-table coupling and that task 5 removes it, the UTM seam for task 6, no appearance in streams). `docs/performance/cityparquet-2026-09-21/README.md`: results.
- [ ] **Step 4: Review.** Codex `gpt-6-astra` milestone review of `git diff <start>..develop` (app) and the submodule range; address Critical/Important; push.

---

## Roadmap for tasks 4–6 (planned after task 3 lands; each gets its own plan + Codex review)

**Task 4 — attributes on demand: RUN, and REFUSED (2026-09-23).** The gate above was executed against the real Yokohama and Nishitokyo tables, and it refused the build — so nothing in the paragraph this replaces was ever implemented, and none of it should be built from. The footer's attribute columns are **0.25 %** of what a Yokohama fetch reads (0.79 MB of 318.93 MB; **0.62 %** at rung 0) and **0.99 %** on Nishitokyo (**2.35 %** at rung 0), all under the gate's own 5 % threshold at every rung; a resident record already holds only NON-NULL attributes, which is exactly one key on this data; and a ONE-row attribute read costs **0.40 MB over 23 range requests — the same as a 2000-row read**, because offset indexes and pages are the granularity, so a per-object fetch is strictly worse and a wider attribute table makes it worse still. A streamed CityParquet layer therefore reads its attribute columns WITH its geometry. Full numbers and method: `docs/plans/2026-09-22-cityparquet-on-demand-attributes.md`, the "Task 4" section of `docs/performance/cityparquet-2026-09-21/README.md`, and the "Attributes travel WITH the geometry" bullet in `docs/architecture-notes.md`.

**Task 5 — object families and per-family tables.** Package manifests list one table per family (Yokohama: building, bridge, water_body, city_furniture, transportation, vegetation). A package layer defaults to the building table (Building + parts + installations); the other families appear in Object Visibility with a table button. Adding a family to a live stream needs either a reopen of the stream with the new source list (simple; the handle's grid/header are immutable) or a new `addSource` worker message plus a header/extent update path — decide in the task-5 plan (default: reopen, keeping camera and selection). DuckDB: one table per family per layer (`layer_N_building`, …) from the family's non-geometry columns via the task-4 bulk winner, independent of residency; the table panel gains a family selector and `useQueryStore`/computed-column keys become `layerId + family`. Removes task 3's resident-table coupling.

**Task 6 — direct geographic → ENU.** Keep METRIC indexing (grid, footprint, planner, family index) separate from geographic render coordinates. The render path converts EPSG:6697 lon/lat doubles into a local metric frame (ENU of the cell/layer) BEFORE triangulation — degree-space deltas distort triangulation as well as normals — and computes normals and edge creases there. Streamed layers already compute metrics in the worker, which can use the same local frame; static layers need both the original geographic doubles (render) and a metric model (analysis), or a per-object metric view computed on demand — decide in the task-6 plan. Gate: an A/B on Nishitokyo proving render-path time drops and positions agree within 1 cm.
