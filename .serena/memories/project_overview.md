# MultiRoof Viewer — Project Overview

## Purpose
MultiRoof Viewer is a web-based viewer and analysis workspace for 3D city models, built for the MultiRoofs project at TU Delft. The focus is urban rooftop analysis for planning, simulation, and communication.

## Current Phase
Milestone 1 (M1): Core Viewer. Foundation (M0) is complete — CityJSON parsing, domain types, Three.js scene, and file loading are implemented. Remaining M1 work: object picking/selection, attribute inspection panel, and metadata display.

## Tech Stack
- **UI**: React
- **3D Rendering**: Three.js + `three-geospatial`
- **Analytics**: DuckDB-wasm with `cityjson` extension
- **Build**: Vite
- **Testing**: Vitest + jsdom + @testing-library/react + @testing-library/jest-dom
- **Linting**: ESLint (typescript-eslint, react-hooks, react-refresh)
- **Formatting**: Prettier
- **Language**: TypeScript (strict mode, ES2022 target)
- **Future**: Tauri-compatible architecture for desktop shell

## Data Model
- Use `citymodel` as the domain term (not a specific encoding name).
- Encoding priority: CityJSON > CityJSONSeq > FlatCityBuf
- Aligned with CityGML conceptual model.

## Architecture
Browser-first, no backend, no login in v1. Separated concerns:
- `src/domain/` — domain types and parsing (citymodel, cityjson)
- `src/scene/` — Three.js scene rendering
- `src/analytics/` — DuckDB-wasm queries
- `src/persistence/` — persistence interfaces (DI-based)
- `src/features/` — feature modules
- `src/app/` — application shell (App.tsx)
- `src/platform/` — platform-specific code (web vs Tauri)
- `src/shared/` — shared utilities
- `tests/unit/` — unit tests (mirrors src structure)
- `tests/integration/` — integration tests
