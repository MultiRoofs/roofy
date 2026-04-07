# agents.md

## Purpose

This file is the contributor guide for human and AI collaborators working in this repository.

## Current Phase

Milestone 1 (Core Viewer) and Milestone 2 (Roof Intelligence) are complete. Milestone 3 (Solar and Shading) is in progress: sun position from suncalc, CRS→WGS84 reprojection via proj4, datetime Zustand store, directional light following sun position with shadow maps, Solar inspector tab with presets, and toolbar datetime pill are implemented. Quality review and integration testing remain.

## Project Context

MultiRoof Viewer is being designed as a web-based viewer and analysis workspace for 3D city models in support of the MultiRoofs project. The product focus is urban rooftop analysis for planning, simulation, and communication.

## Product Direction

- visualize 3D city model data, starting with CityJSON-family encodings
- analyze rooftop suitability and derived roof metrics
- support rule-based colorization from geometry or attributes
- provide solar and shading exploration with datetime controls
- calculate browser-based statistics with DuckDB-wasm
- save local workspace state and support lightweight URL sharing
- require no login in v1

## Stack Direction

- React
- Three.js
- `three-geospatial`
- DuckDB-wasm
- DuckDB `cityjson` extension for loading city-model encodings into analytical tables
- Vite
- Tauri-compatible architecture for a future desktop shell

## Terminology

Use `citymodel` as the conceptual domain name.

- `CityJSON`, `CityJSONSeq`, and `FlatCityBuf` are encodings of city-model information.
- Avoid naming core domain modules after a single encoding unless the code is intentionally format-specific.
- Initial encoding priority:
  1. CityJSON
  2. CityJSONSeq
  3. FlatCityBuf

This keeps the codebase aligned with the broader CityGML conceptual model and leaves room for future CityGML/XML-related support.

## Engineering Workflow

Follow strict test-driven development for implementation work:

1. Write a focused unit test first.
2. Run it and confirm it fails for the right reason.
3. Implement the smallest change needed to make it pass.
4. Refactor while keeping tests green.
5. Repeat in small increments.

Expectations:

- Prefer unit tests for pure logic, parsing, rules, analysis, and persistence adapters.
- Do not skip the failing-test step unless there is a concrete reason it is impossible.
- Keep tests readable and behavior-oriented.
- Add regression tests for every bug fix.
- When introducing an interface or abstraction, add tests around the behavior that the abstraction protects.

## Code Review Workflow

After completing a meaningful unit of work (e.g. a new module, feature, or bug fix batch), request a code review before committing:

1. Use the `codex` skill (or dispatch a `superpowers:code-reviewer` agent) to review all changed files.
2. The reviewer should check: code quality, architecture alignment, test coverage, type safety, and adherence to the conventions in this file.
3. Fix all Critical and Important issues before committing.
4. Minor issues may be deferred but should be tracked.
5. Commit only after the review pass is clean.

This applies to both human and AI contributors. The goal is to catch regressions, style drift, and architectural violations early.

## Architecture Guardrails

- Keep the app browser-first in v1.
- Separate ingestion, rendering, analysis, persistence, and UI concerns.
- Normalize source model data before downstream analysis.
- Put persistence behind explicit TypeScript interfaces and dependency injection.
- Treat local save and URL sharing as separate concerns.
- Isolate platform-specific code so web and future Tauri flows can share core logic.

## Repository Expectations

- Major architectural changes should update the docs in `docs/`.
- Avoid putting domain logic directly in view components.
- Avoid coupling DuckDB queries to Three.js scene code.
- Validate DuckDB browser-extension compatibility early before depending on it deeply in user-facing flows.
- Keep CRS and coordinate-transform assumptions documented.
- Prefer small, testable modules over one large viewer monolith.

## Source of Truth

Read these files before making structural decisions:

- `README.md`
- `docs/design-doc.md`
- `docs/roadmap.md`
- `docs/repository-setup.md`
- `docs/testing-strategy.md`

## UI/UX Design Reference

The `design/` folder contains the wireframe and layout mockups for the viewer UI. Open `design/wireframe.html` in a browser to see the interactive wireframe with three states: Landing, Viewer (M1), and Full Layout (M2–M4). Screenshot references are also included. Consult these before making UI layout or component decisions.

## Notes

`claude.md` should remain a symbolic link to this file so both entry points stay aligned.

Initial external references:

- DuckDB `cityjson` extension
- Delft CityJSONSeq sample fixture: `https://storage.googleapis.com/cityjson/delft.city.jsonl`
