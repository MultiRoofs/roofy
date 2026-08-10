# MultiRoof Viewer

Use a deployed app at **[https://viewer.open3d.city](https://viewer.open3d.city)**

MultiRoof Viewer is a planned web application for exploring and analyzing 3D city models in support of the MultiRoofs project. The product focus is rooftop-centric urban planning: visualization, rooftop suitability analysis, solar and shading exploration, and browser-based statistics for planners and researchers.

## Current Status

This repository is in project-initialization mode. The current deliverables are architecture, scope, and setup documents. Application code has not been started yet.

## Product Goals

- Visualize 3D city model data, starting with CityJSON-family encodings.
- Analyze rooftop suitability for use cases such as solar, green roofs, water retention, and other urban planning scenarios.
- Let users colorize buildings and roofs with user-defined rules based on geometry or attributes.
- Simulate sun and shade for a chosen date and time.
- Run lightweight statistical analysis in the browser.
- Save the current workspace state and share it as a URL when possible.

## Data Model Direction

Use `citymodel` as the domain term for the conceptual 3D city model, and treat file formats as encodings of that model.

Initial encoding priority:

1. CityJSON
2. CityJSONSeq
3. FlatCityBuf

## Initial Technology Direction

- React for the application shell and UI.
- Three.js for 3D scene rendering.
- `three-geospatial` for geospatial data representation and spatial reference handling.
- DuckDB-wasm for in-browser analytical queries.
- DuckDB `cityjson` extension as the preferred path for loading CityJSON, CityJSONSeq, and FlatCityBuf into analytical tables.
- Vite for build, development, lint, and formatting workflows.
- A Tauri-ready architecture so a native application can be added later without a full rewrite.

## Design Principles

- Browser-first for v1, with no required backend and no login.
- Clear separation between rendering, analytics, persistence, and UI concerns.
- Typed persistence interfaces with dependency injection, even if v1 only uses in-memory or local storage implementations.
- Test-driven development: write a failing unit test first, implement the smallest fix, then refactor.
- Future-friendly platform boundaries so the same core logic can later support both web and desktop shells.

## Documents

- [Design Doc](docs/design-doc.md)
- [Roadmap](docs/roadmap.md)
- [Repository Setup](docs/repository-setup.md)
- [Testing Strategy](docs/testing-strategy.md)
- [Agent Guide](agents.md)
