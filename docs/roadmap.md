# Roadmap

Status: Living document — last revised 2026-08-03, after Milestone 8 (Navara engine
migration). Milestones 0–6 and 8 are delivered; Milestone 7 (CityGML) is partially
delivered (M7.1 only). Per-milestone status is recorded in each section below.

## Delivery Strategy

The safest path is to deliver the product in vertical slices. Each milestone should end with something demonstrable, not just internal plumbing.

Across all milestones, engineering work should follow a red-green-refactor cycle with unit tests leading implementation for pure logic and adapters.

## Milestone 0: Foundation

Goal: align on scope, architecture, and repository conventions before app code starts.

Deliverables:

- Product and architecture documentation
- Proposed repository structure
- Persistence and sharing strategy
- Milestone plan and feature sequencing

Exit criteria:

- Core scope is agreed
- Initial stack is agreed
- Internal boundaries are documented

## Milestone 1: Core Viewer

Goal: open a city model and provide a usable 3D exploration workflow.

Deliverables:

- Vite and React application shell
- Three.js scene bootstrap (superseded by Milestone 8: Navara)
- City model ingestion starting with CityJSON
- Camera controls, selection, and inspection panel
- Basic city-model metadata display
- Selection modes: object-level and surface-level picking
- Single-object selection with visual highlight

Deferred to later milestones:

- Multi-select (Shift+click to add to selection)
- Derived geometry summary in inspector (footprint area, roof area, volume)
- Layers tab in inspector panel
- Box Select and Measure tools
- Cursor position display (world coordinates from raycasting)
- FPS counter in status bar

Exit criteria:

- A user can load and inspect a sample city-model fixture end to end ✓
- Selection and attribute inspection are stable enough for demos ✓

Status: Complete. Integration tests verify the full pipeline with fixtures/two-buildings.city.json.

## Milestone 2: Roof Intelligence

Goal: turn raw city-model geometry into planning-relevant rooftop insight.

Deliverables:

- Roof metrics pipeline: surface area, azimuth, inclination for RoofSurface polygons
- Rule builder with AND/OR conditions, typed comparisons (>, <, = on boolean/string/numeric)
- Rule-based colorization applied to roof surfaces on the 3D mesh
- Visual legend overlay with toggle, auto-shown when a rule is active
- Analysis tab in inspector with user-selectable scope (surface vs building aggregate)
- Rule builder UI integrated into inspector panel

Deferred to later milestones:

- Additional metrics: elevation, solar score, usable area, normal vector display
- Preset/built-in rules (e.g. "Roof suitability" template)
- Layer concept: grouping multiple files into named layers with per-layer rule scope
- Bottom panel for rules/statistics (keep in inspector for M2)
- Compound rule presets and rule import/export

Exit criteria:

- A user can classify roofs with geometry-driven rules
- Styled output is explainable and reproducible

Status: Complete. All six deliverables implemented: roof metrics pipeline, rule builder with AND/OR conditions, rule-based colorization, visual legend overlay, analysis tab with scope toggle, and rule builder UI. Unit tests cover metrics, aggregation, rule evaluation, and rule store.

## Milestone 3: Solar and Shading

Goal: make time-based rooftop exploration part of the core experience.

Deliverables:

- Datetime controls
- Sun position integration
- Scene lighting and shadow updates
- Preset scenarios for common dates and times

Exit criteria:

- A user can change datetime and clearly see the scene respond ✓
- The current datetime is preserved in saved state (pending M4 persistence)

Status: Complete. Solar pipeline integration tests verify the CRS → lat/lon → sun position → Three.js light chain. All three encoding formats (CityJSON, CityJSONSeq, FlatCityBuf) support solar via the shared CRS metadata.

## Multi-Format Ingestion (cross-cutting, delivered alongside M3)

Goal: support all three planned city-model encodings.

Deliverables:

- CityJSON (.city.json) parser — local file drop ✓
- CityJSON Text Sequences (.city.jsonl) parser — local file drop ✓
- FlatCityBuf (.fcb) loader — HTTP URL via @cityjson/flatcitybuf WASM bindings ✓
- Shared parsing helpers extracted for reuse across formats ✓
- Format detection by file extension in the app shell ✓

Notes:

- All parsers produce the same normalized CityModel type
- FlatCityBuf uses HTTP range requests (cloud-optimized), so loading is URL-based rather than file-based
- The WASM bindings return Map objects which are converted to plain objects before parsing

## Milestone 4: Statistics and Saved Workspaces

Goal: connect the viewer to analysis summaries and reproducible work sessions.

Deliverables:

- DuckDB-wasm analytical tables
- Summary metrics and selection-aware stats
- Local workspace save and restore
- Shareable URL for lightweight view state

Exit criteria:

- A user can answer simple quantitative questions from within the tool
- A saved workspace can be restored locally
- A shared URL can recreate a view when the city-model source is accessible

## Milestone 5: Hardening and Platform Readiness

Goal: make the application stable enough for broader project use and future desktop packaging.

Deliverables:

- Performance improvements for larger datasets
- Error handling and unsupported-data UX
- Adapter boundaries for future Tauri integration
- Documentation for pilot workflows and known limits

Exit criteria:

- The application is stable for repeated demo and pilot use
- Core modules are not tightly coupled to browser-only APIs

Status: In progress. Completed: error boundaries and validation (M5.1), mesh building performance optimization (M5.2), platform adapter interfaces for Tauri (M5.3), pilot workflow documentation (M5.4). Remaining: further performance profiling with large real-world datasets.

## Milestone 5b: Multi-Layer and Per-Layer Rules

Goal: support multiple data sources as named layers with per-layer rule-based colorization and theme toggle.

Deliverables:

- Layer store with per-layer CityModel, visibility, and rule management
- Layer management UI (add, remove, rename, visibility toggle)
- Per-layer rule scoping (replaces global ruleStore)
- Multi-layer rendering with per-layer picking and highlighting
- Multi-layer persistence (snapshots and URL sharing with backward compat)
- Dark/light theme toggle with CSS variables and renderer sync

Status: Complete. Committed in 6 incremental commits.

## Milestone 6: Scene Quality and UI Refinements

Goal: improve scene rendering quality, add geospatial accuracy, LoD control, and refine the UI layout.

### M6.4: Left Layer Panel and Pick Mode to Toolbar

Goal: move layer management to a collapsible, resizable left sidebar and pick mode buttons to the toolbar.

Deliverables:

- Collapsible, resizable left sidebar (default 240px, range 180-480px)
- Layer panel moved from inspector tab to left sidebar
- Pick mode (object/surface) and fit-all buttons moved to toolbar
- Remove ToolRail component

Status: Complete.

### M6.3: LoD Selection Per Layer

Goal: let users choose which LoD to render per layer, defaulting to the highest available.

Deliverables:

- Tag each Surface with its source LoD in the parser
- Per-layer LoD selection in layerStore (selectedLod, availableLods)
- LoD filtering in buildCityMesh
- LoD selector UI in the layer panel (shown even with one LoD)
- Mesh rebuild on LoD change

Status: Complete.

### M6.1: React Three Fiber Migration with three-geospatial

Goal: migrate from vanilla Three.js to R3F, integrate three-geospatial for geospatially accurate rendering with sky and atmosphere.

Deliverables:

- Migrate CityScene to R3F declarative components ✓
- R3F pointer events for multi-layer picking ✓
- drei OrbitControls with damping ✓
- drei Sky for atmosphere (replaced by directional lighting after ENU issues) ✓
- Preserve all existing functionality (picking, highlighting, rule colors, persistence) ✓

Deferred:

- @takram/three-atmosphere and @takram/three-clouds integration. Packages are installed but EastNorthUpFrame places meshes at ECEF coordinates (millions of meters from origin) which breaks the local-origin camera/controls model. A future approach should either: (a) implement a globe-scale view mode where OrbitControls target is in ECEF space, or (b) use the atmosphere shaders without ENU framing by passing sun direction directly.

Status: Complete (R3F migration). Atmosphere/clouds deferred. Superseded by Milestone 8: the R3F scene was replaced by the Navara engine, which provides the atmosphere natively.

### M6.2: View Alignment Buttons and Per-Layer Fly-To

Goal: provide camera view alignment and per-layer navigation.

Original goal was a TransformControls gizmo for the orbit target. Redesigned to view alignment buttons after user feedback.

Deliverables:

- View alignment buttons (Top, Front, Right, Bottom, Back, Left) as viewport overlay
- Per-layer fly-to button in LayerPanel that centers camera on that layer's bbox
- fitLayer and alignView methods on CitySceneHandle

Status: Complete.

Exit criteria:

- A user can manage layers in a left sidebar, select LoD per layer, and navigate views via alignment buttons ✓
- A user can fly to any layer by clicking the crosshair icon ✓
- Scene rendering uses R3F with proper lighting and shadows ✓ (superseded by Milestone 8: Navara)

## Milestone 7: CityGML 2.0/3.0 Support

Goal: extend format support beyond CityJSON to include CityGML, the OGC standard XML encoding for 3D city models.

### M7.1: CityGML Parser — Buildings

Deliverables:

- CityGML 2.0 and 3.0 XML parsing via fast-xml-parser (DOM-based)
- Automatic version detection from namespace URIs
- Semantic surface extraction (RoofSurface, WallSurface, GroundSurface, etc.)
- Fallback geometry extraction from lod*Solid/lod*MultiSurface for objects without semantic surfaces
- LoD detection from element names (lod1Solid → "1", lod2MultiSurface → "2")
- CRS extraction and normalization to OGC URI format
- Lenient parsing: skips malformed elements, logs warnings
- File detection for .gml and .citygml extensions
- Local file upload and remote URL loading

Status: Complete.

Current limitations (documented for future work):

- **Building types only**: Only Building and BuildingPart are parsed. Other CityGML types (Transportation, Vegetation, WaterBody, LandUse, Relief, CityFurniture) will be added in M7.2.
- **DOM-based parser**: Uses fast-xml-parser which loads the entire XML document into memory. For files >100MB, a SAX streaming parser (e.g. sax-wasm) should be implemented.
- **XLink resolution**: Solid geometry that uses xlink:href references to polygons defined elsewhere is skipped. Only inline polygons in semantic surfaces are extracted.
- **DuckDB analytics via the flat fallback**: CityGML (and a ZIP of it) has no DuckDB reader, so its layer's table is built app-side from the parsed model and loaded through `read_json_auto` — browsable, filterable and exportable as attributes, but with no `read_cityjson` source behind it and so no CityParquet package to export. See Milestone 11.
- **Axis order**: Coordinates are passed through as-is, relying on CRS metadata. No axis-order normalization for CRS with lat/lon order.

### M7.2: Non-Building CityGML Types (Planned)

Deliverables:

- Transportation, Vegetation, WaterBody, LandUse, Relief, CityFurniture parsing
- Extended semantic surface type mapping
- Object type filtering in the layer panel

### M7.3: Streaming Parser for Large Files (Planned)

Deliverables:

- SAX-based streaming parser (sax-wasm) for CityGML files >100MB
- Progress reporting during parse
- Memory-efficient incremental object emission

## Milestone 8: Navara Engine Migration (plan phases M7.1–M7.7)

Goal: replace the bespoke React Three Fiber scene with the Navara engine, moving all
format-agnostic CityJSON domain code into a reusable plugin monorepo consumed as a git
submodule (`packages/cityjson-navara-plugins`).

Tracked in detail in the Navara-migration plan (2026-08-01). That plan
numbers its own phases M7.1–M7.7; those labels belong to the plan's internal numbering and
are unrelated to Milestone 7 (CityGML) above. Phase status:

- M7.1 (plugin monorepo scaffold + submodule + app wiring): Complete
- M7.2 (format-agnostic domain moved into @cityjson/navara-core; app re-exports at the old
  paths): Complete — the re-export shims were themselves deleted in M7.7, except two kept
  deliberately as app vocabulary (`domain/citymodel/types.ts`, `features/rules/types.ts`)
- M7.3 (plugin + viewport rendering a static CityJSON layer): Complete
- M7.4 (picking, cursor readout, rules, highlight, LoD): Complete — verified end-to-end
  in the browser on the real engine (logged in the Navara spike findings, 2026-08-01)
- M7.5 (@cityjson/navara-flatcitybuf streaming plugin): Complete — browser-proven against
  a real remote `.fcb` (range requests, resident-cell counts, level swaps)
- M7.6 (solar, Google 3D Tiles, geographic persistence): Complete
- M7.7 (teardown, dependency pinning, docs): Complete

Delivered:

- `cityjson-navara-plugins` monorepo (git submodule at `packages/cityjson-navara-plugins`):
  `@cityjson/navara-core`, `@cityjson/navara-cityjson`, `@cityjson/navara-flatcitybuf`, and
  `@cityjson/navara-cityparquet` (scaffold only — see Dropped)
- `NavaraViewport` replacing `CitySceneR3F`, behind the same `CitySceneHandle` contract
- Real ENU georeferencing per layer: an exact per-vertex source-CRS→ENU transform plus
  EGM2008 geoid-sampled vertical placement, with a CRS gate that refuses non-metric or
  unrecognised CRS at load
- Picking, per-surface rule colouring, highlight and LoD selection on the plugin handles
  (`PickStrategy = "own-raycast"` — the engine's `PickableMeshWrapper` carries a per-mesh
  uniform id and cannot express per-surface granularity)
- FlatCityBuf viewport streaming driven by Navara camera events, with the B1–B5 race fixes
  (stale-commit ordering, rule-change recolour, worker eviction, budget/hole handling,
  fetch rollback) carried over as tests
- Engine-native atmosphere, sun and shadows; Google Photorealistic 3D Tiles as a native
  `3d-tiles` layer, with mandatory attribution for both Google and the geoid service
- Geographic camera persistence: snapshot/share v3 stores `{lng, lat, height, heading,
pitch, roll}`; v1/v2 snapshots are rejected outright (pre-v3 share links decode to null)
- R3F, `@takram/*`, `@takram/3d-tiles-renderer` and `suncalc` removed; `three@0.183.2` and
  `postprocessing@6.39.0` pinned exactly

Dropped in this migration (spec §9 non-goals):

- Measure tool and box-select. `ViewerToolbar` still offers the modes and `pickEventHandlers`
  still routes them (picking turns off), but nothing draws a rubber band or a measurement —
  they are disabled, not implemented, pending re-implementation against Navara.
- Vignette and lens-flare parity with the old post-processing stack
- Non-georeferenced ("local") viewing mode — every layer must georeference or it is refused
- CityParquet implementation: `@cityjson/navara-cityparquet` stays a scaffold
- A 3D-Tiles-conversion plugin
- Backward-compatible snapshots and share links (project philosophy: breaking changes are fine)
- A React wrapper for Navara — `NavaraViewport` stays a thin imperative host

Deferred during execution (known, non-blocking; recorded here so they are not lost):

- The Advanced Settings panel's rendering/debug toggles — post-processing, clouds, aerial
  perspective, lens flare, sun shadows, city shadows, double-sided, city material mode — are
  still unwired under `NavaraViewport`: `renderDebugStore` and `atmosphereStore` have no
  reader outside the panel itself. Wire them to the engine or delete them. (The Google 3D
  Tiles toggle in the same panel _is_ wired.)
- ~~`LEVEL_SWAP_TIMEOUT_MS = 1500` wants a GPU-backed measurement~~ — **removed**
  2026-08-05. On any host where a full-cover swap exceeded 1.5 s it stalled the layer
  permanently (uxfix report § Wave 3). Cancelling work the user has moved on from is
  `abortInFlight()` plus the worker epoch, not a timer.
- **The streaming fetch bound wants the same real-hardware measurement the old one did.**
  `COMMIT_FETCH_TIMEOUT_MS = 30_000` replaced it as a _liveness_ bound, sized at ~3x the
  slowest healthy commit seen on a GPU-less host. Residual caveats, all needing a run on
  real hardware and a large dataset: (a) 30 s may be too tight for a genuinely huge first
  cover on a slow connection — expiry there would loop retry-and-stall rather than stall
  outright; (b) it bounds the fetch only, not the probe, so a stuck `probe` still hangs a
  commit; (c) it does not abort the HTTP request, only stops waiting on it, so a stalled
  connection is left to the browser.
- A layer still fetches its first cover TWICE: commit 1 has no LoD ladder (the FCB header
  carries none), so it pulls every LoD, and commit 2 swaps to the resolved label. Seeding
  the ladder from a cheap first probe would remove both the wasted fetch and the
  stacked-LoD first frame.
- Hover raycasting is now nearest-hit across all handles per mousemove, on a plain
  `Raycaster.intersectObject` with no BVH. Acceptable today; if it bites with several large
  layers, the candidates are a BVH in the plugin or throttling hover picks.

Exit criteria:

- A user can load CityJSON, CityJSONSeq and streaming FlatCityBuf layers onto the globe, pick
  and recolour them, animate the sun, and save/restore/share a viewpoint ✓
- `npx tsc -b --noEmit`, `npx vitest run`, `pnpm vitest run` (submodule) and `npm run build`
  are all green ✓ — re-verified 2026-08-03 at `ccaf2ce`: tsc clean, app 53 files / 618 tests,
  plugins 42 files / 572 tests, build succeeds

Status: Implementation complete through phase M7.7. **The final review has not run yet** — the
plan's last task (C26, a whole-branch review) is outstanding, so no reviewer has yet looked at
the migration as a single diff. Per-task reviews were run and closed throughout.

## Milestone 9: CityParquet Loading (Complete)

Goal: load CityParquet packages as ordinary static city-model layers, from a URL, from an
object-storage bucket, or from local files.

Deliverables:

- Engine-free reader in `@cityjson/navara-cityparquet` — footer `city` metadata, table
  decode, WKB geometry, STAC-Item package assembly — producing the same normalised
  `CityModel` the CityJSON path produces ✓
- Vendored, patched hyparquet 1.28.1 (`DELTA_BYTE_ARRAY` in DataPage V1; geoparquet
  auto-conversion disabled from outside via a complete `parsers` override). See
  `src/vendor/hyparquet/VENDORED.md` ✓
- URL sourcing in `src/features/cityparquet/` — single `.parquet` table, https package
  directory, and `gs://`/`s3://` wildcard or prefix expanded by anonymous bucket listing
  (capped at 64 tables); plain-https wildcards rejected with an explanation ✓
- Local `.parquet` file drop, multi-file drop, and folder picking (`webkitdirectory`) ✓
- `.parquet` data assets offered by the STAC catalog browser ✓
- Errors surface inline on the landing page and as toasts in the viewer shell ✓
- CRS from the footer's `city.crs` PROJJSON, EPSG authority only — the existing CRS gate
  rejects anything else ✓
- Analytics via the existing in-memory path (`loadCityModelFromMemory`); decoding never
  depends on DuckDB ✓

Out of scope in v1, deliberately: appearance (materials/textures), geometry templates, the
experimental `CityParquetArrowNative-v1` encoding, partial/streaming reads, authenticated
buckets.

Status: Complete. Browser-smoked 2026-08-08 against the fixture package served over http —
package-directory URL and single-`.parquet` URL both add as layers and render georeferenced
on the globe, picking resolves objects with inherited attributes labelled by source, the LoD
selector offers the package's `2.2` and `0`, a 404 URL surfaces a toast, and a saved
workspace restores both URL layers. Verification green: `npx tsc -b --noEmit`, app 105 files
/ 1295 tests, submodule typecheck + 52 files / 719 tests + `pnpm build`.

Known limitation, not a defect: `gs://` against the public `cityparquet` bucket maps to the
right https URL and issues the request, but the bucket serves no `Access-Control-Allow-Origin`
header, so the browser blocks it and the app reports the CORS-aware network error. Object
storage support is only as usable as the bucket's CORS configuration.

## Milestone 10: GIS Layers — Styling, Selection and Attributes (Complete)

Goal: make the geospatial layers the app can already draw (GeoJSON, XYZ raster tiles,
Cesium 3D Tiles — added earlier as an unrecorded increment) into first-class, inspectable,
styleable layers rather than write-only decoration.

Deliverables:

- Add Layer dialog opens on the **Geospatial** tab, and the layer panel's city and
  geospatial sections each carry their own add button ✓
- Rules tab names its target city layer and offers a picker; the legend groups its entries
  by layer, so a multi-layer session can tell whose rule coloured what ✓
- Per-layer geospatial style — colour, point size (pixels), line width, fill opacity —
  normalised through one total door (`features/geoLayers/geoLayerStyle.ts`), applied by
  rebuilding the engine description, and persisted in the snapshot alongside
  `visible`/`opacity` ✓ (edited in the layer row's Style block as shipped; the controls
  moved to the inspector in the follow-up below)
- Geo feature selection: `geoSelection` in the selection store, fed by the engine's own
  `pick` pass (stashed on `pick`, resolved on the `click` that follows), with a city hit
  winning outright and the store's invariant clearing the other side ✓
- Selected feature highlighted through the engine's `FeatureEvaluator`, one evaluator per
  feature set, clearing by restoring the layer's own colour explicitly ✓
- Attribute overlay gains a geo mode showing the picked feature's GeoJSON `properties` ✓

Status: Complete. Browser-smoked 2026-08-10 (headless Chrome over CDP, SwiftShader) against
`us-states.json` draped over the Delft fixture session: the dialog opens on Geospatial, the
GeoJSON drapes, a click resolves Nebraska (`density 23.97`) into the attribute panel and
recolours only that feature, a colour edit re-renders the layer AND leaves the highlight
standing, clicking a city building takes the selection back and clears the geo highlight,
and reload + restore brings the layer back in its edited colour. Verification green:
`npx tsc -b --noEmit`, app 110 files / 1443 tests.

Answered by the smoke, and worth recording: the engine's `pick` pass DOES fire for a draped
GeoJSON feature with no `pickable` flag on the descriptor — `geoLayerDescriptions.ts` sets
none and relies on the engine default, which the review flagged as unproven under Node.

Follow-up increment, 2026-08-11 — geo-layer zoom and inspector-hosted config:

- **Zoom to layer.** A geo layer could be added and then never found: the engine draws it
  but Navara 0.0.5 exposes no bounds API for it, so the app now computes the extent itself
  in the engine-free `features/geoLayers/geoLayerBounds.ts` (GeoJSON coordinate walk; a 3D
  Tiles root bounding volume — region, sphere or box; results cached by URL) and flies to it
  through the new generic `CitySceneHandle.fitBounds(bounds: GeodeticBounds)`. The button
  shows for GeoJSON and 3D Tiles rows only — an XYZ raster template names no extent ✓
- **Geo layers join the selection model.** `geoLayerStore.activeGeoLayerId` (session-only,
  not persisted) makes a geo row clickable and swaps the right InspectorPanel to
  `ui/inspector/GeoLayerInspector.tsx` — the layer's info, opacity and vector style, moved
  out of the row, which is now identity and actions only. A city row click or a city object
  pick hands the inspector back; picking a geo feature in the viewport activates its layer ✓

Verification green: `npx tsc -b --noEmit`, app 112 files / 1479 tests.

Deferred, deliberately: a geospatial-only session is still impossible — the landing page
offers no geospatial door, so the viewer shell only mounts once a city layer exists (the
shell gates on city layers alone), which also means neither the zoom button nor the geo
inspector is reachable in a geo-only workspace. A follow-up candidate, out of scope for
both plans.

## Milestone 11: DuckDB Integration — Per-Layer Tables, Query Table, Map Filter, Export (Complete)

- 11.1 Engine: `@duckdb/duckdb-wasm@1.33.1-dev64.0` (DuckDB 1.5.5), per-extension
  status, `ensureExtension` for `spatial`/`three_d`, `runQuery` with DuckDB's own
  error message, VFS primitives, init retry.
- 11.2 One table per city layer (`insights/layerTables.ts`), reader-backed from
  bytes or a flat fallback from the parsed model / resident records; one FIFO
  queue; `addCityLayer` as the single static add path.
- 11.3 Table panel: pagination (100/500/1000), sort, structured WHERE filter,
  DuckDB-only, states for engine-down / queued / building / failed / empty.
- 11.4 "Filter map": the applied filter's feature-expanded ids reach the plugin
  through `Layer.visibleObjectIds` and `CityModelMesh.setVisibleObjectIds`.
- 11.5 Export: Parquet / CSV / JSON via `COPY`, and a CityParquet package via
  `cityparquet_write` + `fflate`, every read-back validated by content.

Delivered ON TOP of the Navara 0.1.1 state and the Roofy rebrand: `origin/develop`
had already merged both, and this milestone was merged onto them rather than
beside them — so the plugin's `setVisibleObjectIds` sits on 0.1.1, not on the
0.0.5 line the branch started from, and it takes its place beside the plugins'
`colors` seam: `buildCityMeshArrays` carries `surfaceColors` seventh and
`visibleObjectIds` EIGHTH.

`spatial` and `three_d` are integrated as LOADABLE CAPABILITIES only. They have
nothing to operate on in v1: the layer table is attribute-only, and a geometry
predicate needs either geometry columns materialised (the memory cost the
design exists to avoid) or a computed-columns feature that reads the
re-registered source on demand. `spatial` does not autoload in wasm and is a
CORE extension (`INSTALL spatial`, ~5 s / 23.6 MB — not `FROM community`).
Known `three_d` traps for that follow-up: `ST_3DFromWKB` throws on a
MultiPolygon Z row and one such row poisons a whole column query (use
`ST_3DTryFromWKB`); `ST_3DVolume` raises "solid is not manifold" on an
unguarded aggregate (guard with `ST_3DValidationReport(...).is_valid`).

Deferred: streaming-layer map filtering; persisting filters in snapshots and
share links; a free-text SQL console; geometry-backed analysis on
`spatial`/`three_d`; CityJSON/CityJSONSeq/FCB export until the upstream wasm
writer stops bypassing the VFS; CityParquet-sourced layers as reader-backed
tables (`cityparquet_read` is unusable in wasm).

Also deferred, and it becomes a real bug the moment the first of those analysis
features lands: the DuckDB status pill holds a SNAPSHOT. `App` reads
`getDuckDBStatus()` once, after `retryEngine()` resolves, and keeps it in React
state — but `ensureExtension` publishes a fresh status every time it loads
`spatial` or `three_d`, and nothing re-reads it. Today nothing calls
`ensureExtension`, so the pill is never wrong; a feature that loads an
extension lazily will leave the tooltip listing the extensions from boot and
omitting the one it just fetched — exactly the drift the tooltip exists to make
visible. The fix is a `subscribeDuckDBStatus(listener)` in `duckdb.ts` which
`publishReady` notifies, with `App` subscribing rather than snapshotting.

## Milestone 12: UI Redesign — One Active Layer, One Selection (Implemented; local verification)

Approved design: `docs/superpowers/specs/2026-09-06-ui-redesign-design.md`
(from the interactive prototype required by `docs/ui-redesign-handoff.md`).
Plan: `docs/superpowers/plans/2026-09-06-ui-redesign.md`. Breaking UI changes,
no compatibility shims; saved workspaces migrate to schema v4.

- 12.1 Shared context (COMPLETE, bc2d1d9..f06e325): selection belongs to
  exactly one layer; activating another layer, hiding or removing the owner
  clears it; an applied static-city/vector filter also clears excluded selections; picking a feature
  activates its layer; Escape clears. Attribute overlay, `Sync selection`,
  the inspector's rule-target override, the status-bar table entrance and
  the fit-all flight on every added layer are removed. Persistence v4 with an
  explicit v3 migration (`persistence/migrateSnapshot.ts`).
- 12.2 Shell and layers (COMPLETE, 2026-09-07): header (workspace, Save, Share, Preferences), full-
  height left and right panels, the data drawer under the map column only,
  collapse and resize; one layer list for every layer type with one Add
  layer dialog (File / URL / Catalog, detection with correction); the active
  layer's configuration (Style / Filter / Details) under the list.
  Landed with: a geospatial-only workspace enters the viewer and its first
  content fits once; the interface appearance is a System / Light / Dark
  preference (new storage key, everyone starts on System); failed adds are
  rows with Retry; the old toolbar, sidebar, layer panel and geo inspector
  are deleted. The 12.5 scene sheet also gets the pending Shadow quality
  control (see the 12.5 add-on).
- 12.3 Styling and inspection (COMPLETE, 2026-09-07): Rules under the active
  layer's Style as `Color by` (surface type / rules / single colour) with
  presets first, per-layer drafts, an editable unmatched colour; vector
  layers colour by attribute (typed categorical palette, a fixed Other
  bucket, first-eight + overflow); a legend grouped by layer whose heading
  opens the layer's Style and that grows to presentation size when both
  side panels are collapsed; the right details panel (identity trail,
  summary, rule match by identity, raw attributes with search, parts,
  geometry, multi-selection aggregates, geo feature) replacing the
  inspector and its Analysis tab; `Layer.rulesEnabled` deleted (colorBy is
  the one answer). Remaining engine limitations: raster colormap (deferred),
  stroke colour for vectors (the engine's polygon outline probed and does
  not render — deferred), and a streaming SURFACE pick shows identity and
  attributes without its roof metrics (the ring fetch is not wired; a
  streaming BUILDING summary is complete).
- 12.4 Linked data and filtering (IMPLEMENTED, 2026-09-08): Records / Summary drawer follows the active city or vector layer; building rows include derived roof metrics and part expansion, Raw objects, columns, counts, selected-only and export scopes. Static city and GeoJSON filters update map membership automatically, with clearable indicators outside the drawer. Streaming filters remain table-only over currently loaded records. Summary, details and legends aggregate real root/part geometry and distinguish unavailable values.
- 12.5 Scene controls (IMPLEMENTED, 2026-09-08): Select Feature / Surface, compact camera controls and explicit layer/selection fit; exclusive nonmodal Sun & shade and Scene settings sheets; timezone-aware civil-time editing, seasonal presets and playback; persisted Shadow quality; interface appearance under Preferences. Weather and presentation looks retain their explanatory labels. Sheets scroll within the available map height, preserving camera and attribution access.
- 12.6 Verification (LOCAL GATE, 2026-09-08): full suite 2,531 passed / 17 skipped before final wording and CSS polish; subsequent focused regression checks recorded in the reconciliation ledger. Browser checks cover city/vector records, filtering, selection, sheet interactions, resizing, expanded attribution and light/dark desktop/laptop layouts. See `scripts/smoke/ui-redesign.md` for reproducible scenarios and the reconciliation ledger for exact evidence and limitations. External Codex CLI review was rejected by automatic approval review because it would send source to an external service; local review completed. No commit or push performed.

## Milestone 13: Processing Toolbox — Spatial Operations Across Layers (Specified)

Goal: a QGIS-style processing toolbox (issue #10) that runs spatial operations
in the browser on DuckDB-wasm with the `cityjson`, `spatial` and `three_d`
extensions, writing results back as attribute columns of an existing layer.

Feature specification (reviewed by Codex `gpt-6-astra`, two rounds):
`docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`. Mockup:
`design/processing-toolbox-wireframe.html`.

Deliverables (v1):

- A **Tools** header button opening a Tools tab in the right panel: searchable
  catalogue, per-tool parameter form (target layer, scope All / Matching /
  Selected, LoD, parameters, output prefix), one run at a time with phases,
  best-effort cancel with a defined commit boundary, result card, log and a
  session history with Undo that restores previous values.
- Tools: Roof metrics to attributes (no extension); Measure solids, Validate
  solids (`three_d`, CityJSON/CityJSONSeq sources only), Height from extent
  (bbox, every layer kind); Join attributes by location, Aggregate buildings
  per area, Distance to nearest (`spatial`, vector layer reprojected app-side
  with proj4 into the city layer's CRS).
- Computed columns carry provenance and a badge in Details, the table, the
  rule editor and exports. Features (Building plus parts) are the unit of
  every count and roll-up; parts never count as buildings.
- Results are session only; snapshots are unchanged (v4).

Deferred (named slots in spec §9): footprint operations to a new vector
layer, field calculator (next milestone), city-to-city joins, replay of runs
on restore, geometry for layers without a reader.

Status: specified 2026-09-10. **Milestone 13.1 implemented 2026-09-11** — the
first vertical slice: the Tools button and panel, the catalogue, the tool form
with frozen scope, the run queue with phases and cancel, the result card, the
run log and session history with Undo, one tool (**Height from extent**), and
the results surfacing in the table (badge + provenance), in Details (COMPUTED
group) and in the rule editor (COMPUTED optgroup) with Style by result.
Acceptance scenario 1 was smoked in a real browser: `scripts/smoke/processing-m1.md`.
The seam and the DuckDB probe results are in `docs/architecture-notes.md`
("Processing toolbox seam (M13.1, 2026-09-11)").

**Milestone 13.2 implemented 2026-09-12** — **Roof metrics to attributes** as
the second tool: an LoD select with per-LoD feature counts, six measure
checkboxes (all ticked by default), a flat-threshold slider (0–15°, default 5°,
strict `<`), §7's geometry-keyed contributor rule and roll-ups, skip accounting
by LoD, and Style by result on `roof_area_m2` — computed app-side in JS, on
every city layer kind including streaming. With it: the "Loading extension" run
phase (`ensureExtension` inside the table FIFO, with the spec's failure copy),
and a PUBLISHED DuckDB status (`useDuckDBStatus()`), so the catalogue's
capability chips track an extension's state and offer Retry. A dead DuckDB
worker is now DETECTED (its own `error`/`messageerror` event, published as
`failed`): every queued and running run fails with §6.1's "Analytics engine
stopped", every layer table is invalidated with the same message, every Undo is
disabled, and the tool rows go dark with the existing "Not available while
DuckDB is unavailable". §6.1's RECOVERY is deliberately not built — see the
carried list. Verified in a real browser on the `two-buildings` fixture and on a
Delft FCB layer (1,115 buildings, 9.2 s) in light and dark at 1000 px width. The
M13.2 seams are in `docs/architecture-notes.md` ("Processing toolbox seam …
M13.2 (2026-09-12)").

**Milestone 13.3 implemented 2026-09-13** — the toolbox is finished. Five more
tools ship: **Measure solids** and **Validate solids** (`three_d`, over the
reader's own LoD geometry, with `ST_3DTryFromWKB`, `ST_3DValidationReport` and
`ST_3DVolume` guarded exactly as the real engine requires) and the three
cross-layer tools — **Join attributes by location**, **Aggregate buildings per
area** and **Distance to nearest** (`spatial`, with the vector layer reprojected
app-side through proj4 and registered as a per-run table). With them, three
seams the toolbox needed: a **"Reading source"** run phase that re-registers a
reader-backed layer's bytes for the length of one run and drops them again,
typed output columns, and ONE Style-by-result descriptor on the tool definition
instead of a branch per tool. Aggregate's count column is `bld_buildings_n`
(`<prefix>buildings_n`) and its scope radios sit under TARGET, with a muted line
saying the scope applies to the source layer's buildings.

The **New layer** destination ships for every implemented tool: a run can write
its results to a derived layer instead of to its target. A derived city layer is
cut from its parent's TABLE and keeps its parent's reader, so it is
reader-backed — every tool, proxy and export format the parent supports,
CityParquet included, works on the copy — and a derived vector layer is a plain
GeoJSON layer holding every area of its target. It is prepared inside the run's
own queue slot and published in one step, so a cancel before that leaves nothing
behind; its row is marked "Derived · not saved in workspaces", and both doors out
of the workspace — the saved snapshot and the share link — omit it, with the
active-layer index repointed at the filtered list. A derived layer dropped from a
SHARE link gets no notice: §8 words that sentence for Save only.

Also closed, all carried from 13.1 and 13.2: every await on one of `duckdb.ts`'s
SIX raced primitives now settles when the worker dies — the race moved INTO the
primitives, so the export dialog, the layer counts, the grid query, the
map-filter sync, the Stats tab and the result card's median all stop waiting
instead of hanging, with no call-site edit. What each of them then SHOWS differs
and is the call site's own business: the export dialog and the median report the
engine's sentence, while the map-filter sync clears the filter and the Stats tab
simply stops waiting. Two awaits are deliberately still outside the race and are
in the carried list below. `retryEngine` now checks the engine generation across
its boot; `undoRun`
no longer publishes a restore whose database is gone; rule drafts rotate an
eight-colour palette and no longer set `Color by = Rules` before the user presses
Save (at Save a result draft switches the mode from ANY mode, while a rule typed
by hand keeps the editor's surface-only flip); the write step's SQL reaches the
run log statement by statement; Open table scrolls the new columns into view; the
drawer's synthetic "Roof area" header explains how it differs from the computed
`roof_area_m2`; and the streaming-table sweep compares stream versions, so
reopening the toolbox stops retiring a finished result card as stale.

Two things a user meets that are deviations rather than details — the New layer
destination is REFUSED on a streaming (FlatCityBuf) target, and a dead DuckDB
worker is contained but still not recovered from — are in the carried list below.
Browser acceptance is the milestone gate's own record:
`scripts/smoke/processing-m3.md`. The M13.3 seams are in
`docs/architecture-notes.md` ("Processing toolbox seam … M13.3 (2026-09-13)").

The gate's own review found five things the milestone then fixed, and four of
them change what a run computes. The all-scope FOOTPRINT reread is restricted to
the layer table's own row ids, so a source file that gained buildings cannot
reach §7.6's per-area counts with features the layer never had. A replaced
computed column whose DECLARED TYPE differs is migrated inside the write's
transaction (the whole column backed up, dropped and re-added), and Undo puts the
original type back before restoring the values. §7.5's and §7.6's area tools drop
the features of a MIXED layer that are not areas, counted under their own skip
cause, so a Join cannot pick a coincident point as an area and an Aggregate never
writes a building count onto one. And the distance join is bounded: candidates
are prefiltered by the building's proxy box grown by the limit, and the source's
properties are read only for the nearest candidate. Measure solids also guards
`ST_3DSurfaceArea` on the validation report's degenerate-face count — it RAISES
on such a solid and one row used to abort a whole Delft LoD 2.2 run.

Three smaller gate findings closed with it: a caveat or skip cause now reads
singular at a count of one ("1 invalid solid (no volume)", not "1 invalid
solids"); Style by result is DISABLED on an undone card, where it was live and
inert; and a VECTOR layer taking the focus no longer clears a CITY layer's
selection, which is what made §10.11's "Selected" Aggregate scope unreachable
through the UI (§6: changing the target does not change what a run is scoped to).
Two user-visible strings are new and have no row in the plan's copy table —
`solids with degenerate faces (no area)` and `<n> features skipped: not an area`,
both written to §7.2's and §7.5's own patterns — and are proposed as adapted copy
A18 and A19.

Carried to M4 — things a user can notice today:

- **The New layer destination is refused on a STREAMING target**, with "New
  layer is not available for a streaming layer: its loaded buildings carry no
  geometry to copy." A streaming layer's resident records carry no boundaries, so
  the copy §6 describes could hold attributes but render nothing; building
  geometry from resident records is a worker-protocol change, which §9 defers
  ("Computing on layers without a reader"). Scenario 10's streaming variant is
  therefore unmet.
- **Streaming (FCB) runs still write to the table only** — unchanged since 13.2,
  and still the repo owner's "future consideration". A streaming layer's
  `model.objects` is empty, so a run's values show in the grid, the filter and
  exports but not in Details, the rule editor or a colour rule, which §7.1 and §8
  do ask for. Closing it means an attribute-overlay seam in the FCB plugin and
  worker plus an Undo path (M2 plan, Design decision (b) and its "Future
  consideration" section).
- **A dead DuckDB worker is contained but still not recovered from.** Retry in
  the status bar reboots the engine and rebuilds only the sources parked while it
  was coming up, so a table that was `ready` when the worker died stays `failed`
  and every tool stays disabled until the page is reloaded. What 13.3 fixed is
  that nothing HANGS on that death any more, not that the session comes back.
  Accepted as a deviation from §6.1's promise that Retry rebuilds tables, first
  in M2 and again here. What 13.3 fixed is that no await on one of the six raced
  primitives hangs on that death; the two below still can.
- **Two engine awaits are still unraced against that death**:
  `queryParquetBuffer`'s VFS REGISTRATION and CLEANUP (its query itself delegates
  to the raced `queryDuckDB`), and `ensureExtension`'s in-flight INSTALL/LOAD.
  Both sit outside the six primitives the race covers, so a parquet read or an
  extension download caught by a worker death still never settles.
- **A run over scope "All" builds an unbounded `IN (…)` list of contributor ids**
  — on the solids path and on the cross-layer footprint path. Watched at the
  milestone gate on the Delft sample; pushing contributor selection into SQL is
  the fix if it bites a 100k-feature layer. The same gate MEASURED it on 1,115
  buildings: a 40,830-character measure statement and a 78,204-character write,
  both planned in well under a second, so nothing observed argues for doing it
  now.
- **Removing a layer does not clear its computed-column provenance** — only the
  rebuild path calls `clearLayer`, so the session store keeps provenance for a
  layer that is gone. Pre-existing, not introduced by the toolbox.
- **"Show run log" on a derived layer's row goes dark once its run leaves the
  20-run session history.** The ancestry itself is kept on the layer record; the
  log it would open is not.
- Cancel is best-effort at statement granularity for SQL — it is seen between
  statements, so a long one runs to completion — and at a batch boundary inside
  the app-side computes (Roof metrics' roll-up, the vector reprojection and its
  NDJSON encoding).
- A queued run's "Matching" ids are resolved at the HEAD of the queue, from the
  filter frozen at Run. Ruled correct; recorded because the log header shows
  `scopeCount 0` until then.
- A corrupt bbox with `zmin > zmax` writes a negative height and reports it
  honestly rather than guarding.
- Everything §9 defers: footprint operations to a new vector layer, the field
  calculator, city-to-city joins, replay of runs on restore, and computing on
  layers without a reader.
- Smaller items each task's reviewer deferred to the final review are recorded
  per task in the milestone's SDD ledger (the M3 progress ledger, which lives
  outside the repository).
- **The app shell overflows horizontally below ~1024px** (`body.scrollWidth`
  1024 at `innerWidth` 1000), clipping the right edge of the right panel with
  the panel collapsed too. Pre-existing and unrelated to the toolbox.

## Open follow-ups

Named here because they belong to no milestone above and would otherwise live
only in a plan nobody re-reads.

### A restored selection of a non-resident streamed object never resolves

A share link or a saved workspace that names an object of a STREAMED layer
which is not resident — its cell has not been fetched, because the restored
camera does not cover it — leaves `useResolvedBuilding` at `loading: true`
indefinitely. Nothing ever completes it: residency arrives only when the
camera visits that cell, so the inspector shows a spinner for a selection the
workspace itself recorded. **This is a correctness bug, not a performance
task.**

It is also the one place a per-object lookup has positive value, and the fix
is small because the machinery already exists: each object family publishes a
DuckDB VIEW over its own file (`src/insights/familyViews.ts`), so
`SELECT … FROM <family view> WHERE id = ?` answers for any row of the file,
resident or not — provided the view is ready when the selection restores.

Found by the task-4 measurement of 2026-09-23, which refused the on-demand
attribute fetch it was gating (`docs/plans/2026-09-22-cityparquet-on-demand-attributes.md`).
Deliberately NOT implemented there: resolving a non-resident object is a
different feature from avoiding an attribute read, and it belongs in a plan of
its own — "resolve a non-resident selection from its family view" — never as a
revival of the deferred-attribute idea, which the measurement closed.

### The winding heuristic needs a real inside/outside test, not a bbox centre

`orientExteriorRing` (`navara-core/src/geometry/buildCityMeshArrays.ts`) decides
a face's orientation with one bit: does the face's centroid sit on the far side
of the object's bbox CENTRE from where its normal points. That is right only
while the box puts the face clearly on ONE side of its centre, and four shapes
fail it — a null `bbox` (a CityParquet child row), a valid but z-degenerate or
near-flat box (a table whose only geometry is LoD 0 footprints has one
legitimately), geometry the read kept sitting on the wrong side of a box
dominated by geometry the read dropped (a roof at 8 m inside a 0..40 m row box
inverts, at exactly `boxHeight / 2`), and a face that legitimately faces its own
centroid (an L-shape's inner walls, a courtyard). All four are measured and
described in `docs/architecture-notes.md`'s Winding bullet, and the first three
are pinned in `navara-core/tests/geo/geodeticRingsToEnu.test.ts`.

**A real inside/outside test closes all four at once** — a signed-volume test
over the object's shell, or consistency of orientation across a closed shell
(propagate from one face whose direction is known, or flip the whole shell if
its signed volume is negative) — where widening the bbox heuristic closes none
of them properly. The cost of leaving it is bounded: the city material is
`DoubleSide`, so what a wrong normal costs is the normal G-buffer, and any
effect reading it.

Found by the fix-round-2 review of the geographic → ENU milestone
(2026-09-23), which measured every sub-case. Deliberately NOT fixed there:
`projectCityObjects` seeds the static path from the same box, so these are the
heuristic's standing limit rather than that milestone's regression, and a real
orientation test is a change to every format's bake — its own plan.

## Cross-Cutting Workstreams

- Data quality and semantic assumptions
- Performance profiling and progressive loading
- Test-driven development discipline and fixture quality
- UX clarity for non-expert users
- Documentation and reproducibility

## Main Risks

- Browser performance may become a bottleneck before analytics scope is complete.
- Some desired sharing flows may require a backend earlier than expected.
- Rooftop suitability rules may need iterative validation with domain experts.

## Recommended Immediate Next Step

Milestone 8 (Navara) is implemented through phase M7.7 and the verification bar is green.
The next steps, in order:

1. Land the Navara migration: run the outstanding whole-branch review over
   `git diff main...HEAD` plus the submodule log, address any critical findings, then merge
   `develop` and push the pinned submodule pointer.
2. Close Milestone 8's deferred items (listed in that section): wire or delete the Advanced
   Settings rendering/debug toggles, and seed a streaming layer's LoD ladder before its
   first commit.
3. Decide whether to restore the two features dropped in the migration — the measure tool and
   box-select — against Navara, or remove their `ViewerToolbar` entries.
4. Resume Milestone 7 (CityGML) at M7.2 (non-building city object types), then M7.3
   (SAX streaming parser for files >100 MB).
