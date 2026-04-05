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

- Roof normalization pipeline
- Derived metrics such as slope, aspect, and area
- Rule builder for user-defined colorization
- Visual legend and filter integration

Exit criteria:

- A user can classify roofs with geometry-driven rules
- Styled output is explainable and reproducible

## Milestone 3: Solar and Shading

Goal: make time-based rooftop exploration part of the core experience.

Deliverables:

- Datetime controls
- Sun position integration
- Scene lighting and shadow updates
- Preset scenarios for common dates and times

Exit criteria:

- A user can change datetime and clearly see the scene respond
- The current datetime is preserved in saved state

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
