# Roadmap

Status: Draft v0.1

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
- Three.js scene bootstrap
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

Status: Complete (R3F migration). Atmosphere/clouds deferred.

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
- Scene rendering uses R3F with proper lighting and shadows ✓

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

Start Milestone 1 with a minimal but disciplined shell:

1. Lock the repository structure and core module boundaries.
2. Scaffold the viewer shell with Vite, React, and Three.js.
3. Introduce the persistence interfaces before the first feature state is implemented.
4. Use a small representative CityJSON sample as the first end-to-end target, with CityJSONSeq close behind for analytics-oriented flows.
