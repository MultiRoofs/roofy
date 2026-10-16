# Review phases 0 to 2 — implementation plan

> For agentic workers: implement task by task, TDD (red, green, refactor), one commit per task,
> plugins first and then the pointer bump. A Fable review closes each phase.

**Goal:** carry out phases 0, 0b, 1 and 2 of the 2026-10-15 review: measure first, take the cheap
wins and correctness fixes, then one source contract and one layer handle, then columnar data,
an indexed cell format, a style lookup texture and GPU picking.

**Spec:** the review, `/mnt/project-files/roofy/roofy-review-2026-10-15.md` (sections 3 to 9) and its
reports in `review-2026-10-15/`. Decisions taken on 2026-10-16: phases 0 to 2 now; every other
recommendation in section 10 accepted; **the persistence layer is an abstraction whose backend can
change** (localStorage today, a server or something else later).

## Global constraints

- `CLAUDE.md` hard rules hold throughout; where a task changes one (render loop, picking, the
  city material), the same commit updates the rule and `docs/architecture-notes.md`.
- Exact pins: `@navaramap/*`, `three`, `postprocessing`, `@types/three`, `@duckdb/duckdb-wasm`,
  any `@maplibre/maplibre-gl-style-spec` or `apache-arrow` added. `three` is never bumped with Navara.
- `packages/core`-style boundary: `navara-core` stays engine-free and DOM-free.
- `npm install` with npm 11.19.0 (`npx -y npm@11.19.0 install`), or the lockfile churns.
- Before each push: `npx vp check`, `npx tsc -b --noEmit`, `npx vp test run`; in the submodule
  `pnpm typecheck` and `pnpm vitest run`.
- Real data in tests where the claim is about data (Delft fixture, `fixtures/delft.fcb`, the
  CityParquet fixtures); synthetic fixtures only for edge cases.

## Review focus

1. A layer saved before a change restores after it (snapshot migration, persisted format).
2. Engine-owned animation (clouds, precipitation, terrain arrival) still repaints under
   render on demand; a still camera produces no frames.
3. Hover over a streamed layer during a drag does no work; a click still selects.
4. A 3DBAG rule on a building attribute colours the BuildingPart's roofs.
5. A CityParquet package written by cityparquet-rs keeps its `other` attributes and extension
   namespaces when loaded.

---

## Phase 0 — measuring stick, quick wins, correctness

### Task 0.1: browser performance harness
**Files:** `src/features/debug/perfProbe.ts` (new, dev hook `window.__roofyPerf`),
`scripts/performance/browser-harness.mjs` (new), `docs/performance/2026-10-16-baseline/README.md`.
- Probe: frame count from `postRender`, `renderer.info.render.{calls,triangles}`, uploaded buffer
  bytes (wrapped `bufferData`/`bufferSubData`/`texSubImage2D`), long tasks (PerformanceObserver),
  fetched bytes (Resource Timing), an idle-frame counter over N seconds.
- Harness: drives Chromium over CDP (the smoke driver's pattern) through a fixed camera path
  (load, still 10 s, orbit, zoom in, pan, zoom out, hover sweep) on Delft static, `delft.fcb` and a
  CityParquet fixture, writing one JSONL per run. Numbers on this host are SwiftShader: counts and
  bytes are comparable, timings are not.
- Test: unit tests for the probe's counters (wrapped GL object), no browser in CI.

### Task 0.2: Navara 0.2.1
Plugins: peers and devs to exact `0.2.1`; app: the three `@navaramap/*` to `0.2.1`, pointer bump.
Fix the comments the review lists (settleController, NavaraViewport setCamera notes,
cameraControls, bloomEffect, CLAUDE.md rule rationale, architecture-notes quirk table).

### Task 0.3: render on demand
`animation: false`; `requestRender` (`view.forceUpdate()`) on every app-side write the engine
cannot see (colour/texture writes, matrix patches, theme, effect params); continuous only while
the sun animates. FPS readout becomes "last frame ms". Tests: a viewport-level unit test that the
view is constructed with `animation: false` and that each app write path calls `requestRender`;
harness: idle frames over 10 s near 0.

### Task 0.4: the geo-layer loop
`geoLayerSync.ts`: evaluate on `featureCreated`; on `featureUpdated` only when the style version
changed; never `forceUpdate()` from inside the handler. Test: a fake engine emitting
`featureUpdated` after each `forceUpdate` settles after one round.

### Task 0.5: hover
One resolve per animation frame, none while a button is held; `setHighlight` no longer re-runs
rule evaluation (cached style colours are reused). Tests: pointer-move bursts coalesce; drags
resolve nothing; highlight does not call the rule evaluator.

### Task 0.6: readouts out of App
Cursor and frame readouts into a small store read by `StatusBar`; `memo` the viewport; hoist
inline callbacks. Test: a cursor update does not re-render the viewport (render counter).

### Task 0.7: rule attribute inheritance (3DBAG)
`ruleColors.ts` evaluates against the surface's attributes, then its object's, then its parents'
up to the root. Test on the Delft fixture: `b3_h_dak_max > 0` matches roof surfaces (0 today).

### Task 0.8: hole-aware roof area
`metrics.ts` subtracts interior rings. Test: `holes.city.json` 64 m² not 80; Delft LoD 2.2 total
drops by 9,791 m² (2.75 %).

### Task 0.9: CityParquet reader MUSTs
`other` (not `other_attributes`), extension namespaces from `city.extensions` with the `_`
escape reversed, `address` and `children_roles` read, families from `feature_id`. Implicit
geometry is read into the model here and drawn in Task 2.7. Tests against cityparquet-rs-written
fixtures (copied from cityparquet / duckdb-3d develop), comparing whole objects with
`cityparquet export` output.

### Task 0.10: `geometry_properties` into `ST_3DTryFromWKB`
`solidSql.ts` passes the sidecar (the two-argument overload). Test: generated SQL.

### Task 0.11: vendor today's extensions
`public/duckdb-ext/v1.5.5/wasm_eh/{cityjson,three_d,parquet,spatial}.duckdb_extension.wasm`
plus `manifest.json` (sha256, footer fields), a lockstep check script, `custom_extension_repository`
pointed same-origin, no `INSTALL … FROM community`. Behaviour unchanged. Test: the lockstep check
in `vp test`; the manifest matches the files.

### Task 0.12: DuckDB table builds
One `CREATE TABLE AS` with a `COLUMNS(c -> …)` lambda instead of `DESCRIBE` + CTAS; a size guard
for `read_cityjson` above 150 MB; static CityParquet tables as `read_parquet` views. Tests:
generated SQL and the guard.

## Phase 0b — develop extensions

### Task 0b.1: develop `cityjson` and `three_d`
Vendor duckdb-cityjson develop (at or after `294a595`) and duckdb-3d develop builds for v1.5.5
wasm_eh; audit `columnKind.ts` and the layer tables for the schema changes (reserved per-LoD
names, `_name`, JSON-typed attributes, `geometry_properties.type`, null typing); re-enable the
three export formats; `cityparquet_read` replaces the JSON round trip where it applies.
`allowUnsignedExtensions` stays on until the community publishes fixed builds.

## Phase 1 — one door, one handle, persistence

### Task 1.1: persistence abstraction
`src/persistence/storage/`: `StorageBackend` (async `get/put/delete/list` by namespace and key,
JSON-free bytes or strings), `LocalStorageBackend`, `MemoryBackend`; `SnapshotRepository`
(implements `ProjectStateStore`) over a backend with a `SnapshotCodec` (serialise, version,
migrate) kept apart from storage; `PreferenceStore` (sync reads from a hydrated cache, async
writes) for theme, shadow quality and walkthrough. Every `localStorage` call outside the backend
goes. Tests: the repository against `MemoryBackend`; a contract test suite every backend runs.

### Task 1.2: `CityFormat` registry
`src/domain/citymodel/formats/`: one `CityFormat` per encoding (`id`, `sniff`, `resolve`,
`adapter`, `table`), `detectFormat`. The chosen format is persisted with the layer
(`CityModelReference.encoding`). Tests: sniffing the fixtures; a restored layer keeps an override.

### Task 1.3: `openCityLayer`
One door used by file drop, the Add dialog, URL, STAC, restore and share. URL probing
(HEAD, CORS, ranges) lives in `resolve`. Tests: each door calls it with the same descriptor.

### Task 1.4: `CityLayerHandle` and `CityLayerState`
One handle over `CityModelHandle` and `FcbStreamLayerHandle`, with `SourceCapabilities`
(`access`, `spatialIndex`, `collections`, `appearance`) and `coverage`; capabilities replace the
`isStreaming` switches; one reconciler. Tests per replaced switch family (fit, table, details,
export, summary, LoD rule).

### Task 1.5: package re-cut
`navara-stream` (worker core, residency, cells, one worker entry loading adapters by id) out of
`navara-flatcitybuf`; the CityParquet adapter next to its reader; `navara-flatcitybuf` keeps only
its adapter. Tests move with their code.

## Phase 2 — data and render core

### Task 2.1: `FeatureTable`, `SurfaceGeometry`, `InstanceTable`, `CityBatch`
Types and builders in `navara-core` (section 4.2 of the review); builders from `CityModel`, the
FCB typed views and CityParquet columns. Tests: Delft builds a table equal in content to the
object graph; byte counts exact.

### Task 2.2: attributes for styling from the table
Parent inheritance as a column view, roof metrics cached once per build. Tests: as 0.7/0.8, now
columnar.

### Task 2.3: indexed, quantised cells
Indexed per surface, int16 positions per cell, oct normals, Uint16 indices, one `featureId`
attribute, bounding spheres from the worker; unique-vertex projection; static layers split into
cells. Tests: byte counts on Delft; positions within quantisation error of today's.

### Task 2.4: lookup-texture shader spike, then the style texture
Spike: the patch composes with the shadow (`onBeforeCompile`) and G-buffer chains on 0.2.1
(browser check). Then object and surface lookup textures, flags (selected, hovered, hidden,
textured), one shared material per layer. Tests: restyle writes texels, not vertex colours.

### Task 2.5: `LayerStyle`, `compileStyle`, `StyleTarget`
MapLibre expressions (`@maplibre/maplibre-gl-style-spec`, exact pin); presets (today's rules as a
`case`); targets for city, GeoJSON, 3D Tiles, Google; snapshot v6 with a v5 migration that keeps
renderings. Tests: compile and evaluate on Delft; migration round trip.

### Task 2.6: GPU picking
A custom `PickableMesh` writing `featureId + idBase` if the engine can give id ranges, else a
worker-built BVH. Tests: picks resolve to the same object as the CPU raycast on Delft.

### Task 2.7: implicit geometry
`InstanceTable` drawn with instancing. Tests: the railway implicit fixture places as many
instances as `ST_3DPlaceImplicit` expects.
