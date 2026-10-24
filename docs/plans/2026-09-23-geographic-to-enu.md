# Direct Geographic → ENU (performance task 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISED 2026-09-23 after the Codex plan review** (`.superpowers/sdd/notes/codex-plan6.txt`). The first draft normalised the whole model into ONE local ENU frame. That is unsafe: `computeInclination` reads the z axis as up and `computeAzimuth` reads x/y as east/north (`navara-core/src/roofMetrics/metrics.ts`), so a frame that spans a city tilts against local vertical — at 15 km, "up" drops ~17.7 m and a roof's apparent inclination shifts ~0.135°, silently changing elevations, roof classifications and rule colours. Stream CELLS are 50–400 m (`BASE_CELL_M = 100`), where the same error is ~3 mm and ~0.002° — nothing. **So this milestone converts the STREAMED path only**; the static path keeps today's UTM normalisation, and doing it properly there needs per-object metric anchoring in core, which is a separate milestone (recorded at the end).

**Goal:** A streamed PLATEAU (EPSG:6697) source stops being reprojected twice. Today every vertex goes lon/lat → UTM with proj4 when it is read, then UTM → lon/lat → ECEF → ENU with proj4 again when it is baked. Both passes disappear: lon/lat is already geodetic, so a vertex reaches its local ENU frame by arithmetic alone.

**Architecture:** Three coordinate spaces, named and kept apart (the review's Critical 2):

1. **Bucket space** — one closed-form local metric transform about the dataset centre, used by the family index, the tile grid, the camera footprint (`toSourceXY`) and cell centres (`toLngLat`). It is an INDEX, not geometry: it only has to be invertible and used identically everywhere. Formula and radii are pinned in the plan so every user computes the same numbers.
2. **Render space** — each cell's own ENU frame. A vertex goes lon/lat/h → ECEF → cell ENU by arithmetic, BEFORE triangulation, so normals and edge creases are computed where they are drawn. No proj4 anywhere in the read or bake path.
3. **Analysis** — the per-cell ENU frame doubles as the metric frame for that cell's records (area, slope, azimuth, volume are frame-independent scalars at cell size). Record bboxes travel in bucket space so the main thread can merge and fit them.
   Ownership is decided FIRST, in bucket space, from the file's geographic bbox; only then are a family's rings converted into the owning cell's frame.

**Tech Stack:** TypeScript, navara-core's `geodeticToEcef`/`makeEnuFrame`/`raisePositionsInEnu`, the CityParquet reader and stream worker, Vitest (Node for plugins, jsdom for the app), the real-data benchmarks under `scripts/performance/`.

**Spec:** the performance handoff, task 6 ("The agreed future direction is direct geographic-to-ENU render conversion, while retaining an explicit metric-coordinate path for analysis. Preserve vertical-datum correctness and precision.") and the roadmap paragraph in `docs/plans/2026-09-22-cityparquet-bounded-loading.md`.

## Global Constraints

- `CLAUDE.md` in full: TDD; submodule commits first, then the pointer bump; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit prefixes; never bare `vite`/`vp dev`; tests import from `"vitest"`; `@navaramap/*` only in the named engine-binding modules; plugin tests import specific engine-free modules.
- **Vertical datum is untouched.** The geoid offset keeps arriving asynchronously and is applied with task 2's `raisePositionsInEnu` (proven to within two Float32 roundings). No second vertical path.
- **Analysis stays level.** Metrics are computed in the cell's own ENU frame, where the curvature error is ~3 mm / 0.002° at 400 m. They are NOT computed in a frame that spans the dataset. Areas and distances lose UTM's scale factor (≈0.99979868 at 139.6°E/35.5°N — about 2.01 m per 10 km and 0.040% of area) and azimuths lose its ≈0.813° grid convergence: these are CHANGED NUMBERS, not just more precise ones, and the docs must say so plainly.
- **Only EPSG:6697 changes.** Projected sources (RD New, UTM CityJSON/CityParquet, FlatCityBuf) keep today's proj4 path untouched. "Normalise projected sources to ENU at load as well, so rebuilds pay zero" is a follow-up, not this task.
- **One transform for buckets, pinned exactly.** `x = (λ − λ0)·π/180·N(φ0)·cos φ0`, `y = (φ − φ0)·π/180·M(φ0)`, with `N` and `M` the WGS84 prime-vertical and meridional radii at the dataset centre `φ0`; the inverse is the algebraic inverse. Every one of the four users calls the same function. It is NOT ENU and must never be treated as ENU: over 30 km it differs from true ENU by tens of metres, which is irrelevant for buckets and fatal for geometry.
- **Coverage, not equality.** Two different transforms need not select identical rows for an axis-aligned box, so the tests assert CONSERVATIVE coverage (every object the old path returned for a view is still returned), not row-for-row equality. Boundary-straddling families and oblique city-edge views are explicit cases.
- **Gate (binding):** render positions are compared in COMMON ECEF (frame × local position), matched per SOURCE VERTEX (not by triangle-buffer order), against an independent double-precision reference: ≤ 1 cm everywhere. Do NOT compare UTM distances — they legitimately differ (above). Performance: Yokohama's stream open and a 1 km read, before and after, same host and Node.
- **The geoid rebuild stays correct.** `buildArrays` applies the current height offset on every rebuild; with projection skipped, a newly built cell whose layer already has a non-zero offset must still be raised through `raisePositionsInEnu` with the CURRENT frame. Moving only the frame is ~8.7 cm off at 15 km for N = 37 m. Tests: a non-zero offset at construction, async arrival, repeated changes, and a rebuild after each.
- **`epsg: null` needs a positive contract.** The worker protocol carries a SERIALISABLE tagged frame descriptor (functions cannot cross `postMessage`); each side rebuilds its transforms from it. Unknown/foot CRS rejection and FlatCityBuf admission are unchanged.

## What this milestone touches (streamed 6697 only)

| Consumer                                                                | Today                                                                 | After                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `streamReader` open + `familyIndex`                                     | proj4 per row to UTM (~4 s of Yokohama's 7.2 s open)                  | bucket transform, arithmetic only                                                             |
| `readRows` → `projectCityObjects`                                       | proj4 per vertex to UTM                                               | rings stay geographic doubles; no conversion here                                             |
| the worker's bake (`streamWorkerCore`)                                  | `buildCityMeshArrays` then `projectPositionsToEnu` (proj4 per vertex) | rings → cell ENU by arithmetic BEFORE triangulation; no `projectPositionsToEnu`               |
| `objectRecords` metrics                                                 | computed in UTM                                                       | computed in the cell's ENU frame (level; ~3 mm at 400 m)                                      |
| record bboxes / `residentModel`                                         | source CRS (UTM)                                                      | bucket space, with the frame descriptor carried                                               |
| `streamRegistry` CRS gate, worker `placement`, `header.epsg`            | proj4 converter from a metric EPSG                                    | a serialisable frame descriptor; `epsg: null` allowed for this mode                           |
| `streamQueryBox`, `NavaraViewport.fitObjects`, the query-region overlay | convert via the layer EPSG                                            | convert via the frame descriptor; the overlay names the bucket frame instead of "CRS unknown" |
| static CityParquet, CityJSON, CityGML, FlatCityBuf                      | proj4                                                                 | UNCHANGED                                                                                     |

## File Structure

| File                                                                                                                      | Responsibility                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `navara-core/src/geo/localMetricFrame.ts` (new)                                                                           | the pinned bucket transform + its inverse, and its serialisable descriptor                                       |
| `navara-core/src/geo/sourceToEnu.ts`                                                                                      | export `geodeticToEnu`; add `geodeticRingsToEnu(objects, frame)` for bulk in-place conversion                    |
| `navara-cityparquet/src/{streamReader,familyIndex,geographicToProjected}.ts`                                              | index and read in bucket space; keep rings geographic; a `"geographic"` coordinate target beside today's UTM one |
| `navara-flatcitybuf/src/{streamSourceAdapter,cityParquetSourceAdapter,streamWorkerCore,streamRegistry,workerProtocol}.ts` | the frame descriptor on the wire; ownership in bucket space; per-cell ENU bake; metrics in the cell frame        |
| `src/features/streaming/*`, `src/scene/{streamQueryBox,NavaraViewport}.tsx`                                               | consume the descriptor instead of an EPSG                                                                        |

---

### Task 1: A real EPSG:6697 fixture, and the bucket transform

**Files:** `navara-cityparquet/tests/fixtures/plateau-6697-cityparquet/` (+ `make_fixture.py`, README provenance); `navara-core/src/geo/localMetricFrame.ts` + tests.

No 6697 fixture exists (flagged in the families milestone), so nothing here is TDD-able without one. Generate it from the 7415 fixture with pyproj (7415 → 6697), rewriting the footer PROJJSON and the `geo` metadata, keeping WKB order lon/lat/h; place it in Japan (the CRS's area of use) and make it span far enough to exercise two cells. Keep the datum-transform provenance honest in the README.

- [ ] **Step 1: failing tests** for `makeLocalMetricFrame`: the pinned formula against a hand-computed value; `toLngLat(toMetric(p)) === p` to 1e-9°; the descriptor round-trips through `structuredClone` and rebuilds an identical transform; a point 15 km out differs from true ENU by tens of metres (pin the number so nobody mistakes it for ENU).
- [ ] **Steps 2–4:** generate the fixture (its script asserts the CRS, lon/lat-looking bbox and that the existing reader still decodes it); implement the frame; commit (submodule).

### Task 2: Index and read in bucket space, keep rings geographic

**Files:** `navara-cityparquet/src/{streamReader,familyIndex,geographicToProjected}.ts` + tests.

- [ ] **Step 1: failing tests.** On the 6697 fixture: `openCityParquetStream` builds its index with NO proj4 call (spy) and its extent is the bucket-space extent; `index.query` covers every family the UTM index returned for the same geographic box (conservative coverage, not row equality); `readRows` yields rings still in lon/lat/h; a projected (7415) source is byte-identical to today.
- [ ] **Steps 2–5:** red → implement → green → commit (submodule).

### Task 3: The worker bakes each cell in its own ENU frame

**Files:** `navara-flatcitybuf/src/{workerProtocol,streamSourceAdapter,cityParquetSourceAdapter,streamWorkerCore}.ts`, `navara-core/src/geo/sourceToEnu.ts` + tests.

Ownership is decided in bucket space from the family's geographic bbox; the family's rings are then converted into the owning cell's ENU frame and triangulated there; `objectRecords` metrics are computed in that frame; record bboxes are emitted in bucket space; the cell message carries the frame descriptor.

- [ ] **Step 1: failing tests.** A baked cell's vertices match the old UTM+ENU path to ≤ 1 cm in COMMON ECEF, matched per source vertex; no proj4 in the bake (spy); a family straddling a cell boundary lands whole in one cell and is not dropped by the resident-key check; metrics for the same building computed in two different cells agree to 1 mm / 0.01°; a non-zero `heightOffset` at build time raises the new positions (`raisePositionsInEnu`), including on a LoD rebuild; FlatCityBuf's path is untouched.
- [ ] **Steps 2–5:** red → implement → green → commit (submodule).

### Task 4: The app and the registry speak the frame descriptor

**Files:** `navara-flatcitybuf/src/streamRegistry.ts`, `src/features/streaming/*`, `src/scene/{streamQueryBox,NavaraViewport}.tsx` (incl. `fitObjects`), the query-region overlay + tests.

- [ ] **Step 1: failing tests.** `openStream` admits a source whose `header.epsg` is null but which carries a frame descriptor, and still refuses an unknown/foot CRS; the camera footprint, cell centres and the index agree (one transform); zoom-to-selection frames an object of such a layer (`fitObjects`); the query-region overlay names the bucket frame; counts and picking are unchanged; a FlatCityBuf layer is unaffected.
- [ ] **Steps 2–5:** red → implement → green → commit (app + pointer bump).

### Task 5: Validation, docs, review

- [ ] **Step 1: the gate** on real Yokohama: stream open and a 1 km read, before and after (same host, Node); plus the ≤ 1 cm ECEF comparison over a sample of cells. JSONL under `docs/performance/`.
- [ ] **Step 2: browser smoke:** Yokohama renders in the same place as the pre-task-6 screenshot, the geoid still applies, picking, the inspector and a family table still work.
- [ ] **Step 3: docs.** Architecture notes: the three spaces and why they are separate; the pinned bucket formula; why the static path is NOT converted (the curvature numbers); the changed metric definitions (no UTM scale factor or convergence) stated as changed, not "more accurate".
- [ ] **Step 4: Codex `gpt-6-astra` milestone review**; address Critical/Important; push.

## Deferred, with reasons

- **The static path keeps UTM normalisation.** Converting it needs metrics anchored per object rather than per model, because a dataset-wide ENU frame tilts (≈2 m of apparent elevation at Nishitokyo's edges, 0.045°). That is a core change to `roofMetrics`/`footprint`/volume call sites and deserves its own milestone. Until then static 6697 layers pay the ~1.5–2.4 s normalisation and the ~2.2–3.5 s render projection they pay today.
- **Projected sources (RD New, UTM, FlatCityBuf) keep proj4.** Normalising them to ENU at load would save every rebuild's projection pass; same prerequisite as above.
- **Geographic table tools.** The family tables still hold geographic bboxes, so join-by-location, distance-to-nearest and aggregate-per-area stay refused (task 5's ruling). Making them work means a frame-aware spatial path in SQL, not part of this milestone.
