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
- **No DuckDB integration**: CityGML data is not imported into the DuckDB analytics engine (CityJSON only for now).
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

Tracked in detail in `docs/superpowers/plans/2026-08-01-navara-migration.md`. That plan
numbers its own phases M7.1–M7.7; those labels belong to the plan's internal numbering and
are unrelated to Milestone 7 (CityGML) above. Phase status:

- M7.1 (plugin monorepo scaffold + submodule + app wiring): Complete
- M7.2 (format-agnostic domain moved into @cityjson/navara-core; app re-exports at the old
  paths): Complete — the re-export shims were themselves deleted in M7.7, except two kept
  deliberately as app vocabulary (`domain/citymodel/types.ts`, `features/rules/types.ts`)
- M7.3 (plugin + viewport rendering a static CityJSON layer): Complete
- M7.4 (picking, cursor readout, rules, highlight, LoD): Complete — verified end-to-end
  in the browser on the real engine; log in
  `docs/superpowers/research/2026-08-01-navara-spike-findings.md` §10
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

Spec: `docs/superpowers/specs/2026-08-07-cityparquet-loading-design.md`.
Plan: `docs/superpowers/plans/2026-08-07-cityparquet-loading.md`.

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

Spec: `docs/superpowers/specs/2026-08-10-gis-layers-and-per-layer-styles-design.md`.
Plan: `docs/superpowers/plans/2026-08-10-gis-layers-per-layer-styles.md`.

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

Follow-up increment, 2026-08-11 — geo-layer zoom and inspector-hosted config
(plan: `.superpowers/sdd/2026-08-11-geo-layer-fit-and-inspector/`):

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
