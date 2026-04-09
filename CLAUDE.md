# CLAUDE.md

## Project Overview

MultiRoof Viewer is a browser-based 3D city model viewer and rooftop analysis tool for the MultiRoofs European project. It visualizes CityJSON/CityJSONSeq/FlatCityBuf data with rule-based colorization, solar/shading analysis, and layer management.

## Tech Stack

- **Build**: Vite (via vite-plus) + React 19 + TypeScript
- **3D**: React Three Fiber + Three.js + @react-three/drei
- **Geospatial**: @takram/three-geospatial (core), @takram/three-atmosphere, @takram/three-clouds
- **State**: Zustand stores (layerStore, selectionStore, solarStore)
- **Analytics**: DuckDB-wasm with cityjson extension
- **Testing**: Vitest + @testing-library/react

## Project Structure

```
src/
  app/          # App shell, CSS, entry point
  domain/       # Format-agnostic domain types and parsers
    citymodel/  # CityJSON/CityJSONSeq/FlatCityBuf parsers
    selection/  # Selection types (object/surface)
    roofMetrics/# Roof area, slope, azimuth computation
  features/     # Zustand stores and feature hooks
    layers/     # Layer store (multi-layer, per-layer rules, LoD)
    selection/  # Selection store
    solar/      # Solar position (suncalc + proj4)
    rules/      # Rule types, presets, evaluation
    theme/      # Dark/light theme toggle
  scene/        # React Three Fiber scene components
    CitySceneR3F.tsx  # Main R3F scene (Canvas, lighting, mesh management)
    buildCityMesh.ts  # CityModel → BufferGeometry (two-pass, LoD filtering)
    highlightMesh.ts  # Selection/hover highlight
    applyRuleColors.ts# Rule-based vertex coloring
  ui/           # React UI components
    sidebar/    # Left sidebar (LeftSidebar, LodSelector)
    toolbar/    # ViewerToolbar
    inspector/  # Right panel (InspectorPanel, tabs)
    layers/     # LayerPanel
    viewport/   # LegendOverlay
  persistence/  # Save/restore/share (localStorage, URL hash)
  analytics/    # DuckDB-wasm, stats computation
  platform/     # Browser/Tauri adapter interfaces
tests/
  unit/         # Unit tests (mirrors src/ structure)
  integration/  # End-to-end pipeline tests
fixtures/       # Test data (two-buildings.city.json/jsonl)
docs/           # Design doc, roadmap, plans
```

## Key Architecture Decisions

- **Meshes at origin**: City model vertices are origin-offset (bbox center subtracted) for float precision. Camera/controls operate near origin. `fitCamera` uses extents only, not absolute coords.
- **Per-layer rules**: Each layer has its own colorization rules. The old global ruleStore was deleted.
- **LoD per surface**: Each `Surface` is tagged with its source geometry's LoD string. `buildCityMesh` filters by `selectedLod`.
- **R3F scene**: CityScene uses React Three Fiber with drei OrbitControls. Picking uses R3F pointer events on a `<group>`, not manual canvas listeners.
- **CitySceneHandle**: Imperative API (fitAll, fitLayer, alignView, getCameraState, setCameraState) exposed via forwardRef for App.tsx to call.

## Commands

```bash
npm run dev          # Start dev server
npm run build        # TypeScript check + Vite build
npm run test         # Run vitest
npx tsc --noEmit     # Type check only
npx vitest run       # Run tests once
```

## Code Review Process

When completing a major feature or milestone, use the `feature-dev:code-reviewer` agent with high effort to review changes. Run the review BEFORE committing. Address critical issues before pushing.

## Commit Convention

- Use small, incremental commits (one feature/fix per commit)
- Prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Run `npx tsc --noEmit` before committing to catch type errors
- The pre-commit hook runs `vp check --fix` (lint + format)

## Known Issues

- 21 test files fail due to vite-plus vitest runner bug (imports from `"vite-plus/test"` break `describe`). Tests importing from `"vitest"` work fine.
- `three: "latest"` and `@takram/three-geospatial: "latest"` in package.json are unpinned.
- @takram/three-atmosphere and @takram/three-clouds are installed but not yet wired into the scene (EastNorthUpFrame ECEF positioning conflicts with local-origin mesh approach). The scene currently uses simple directional lighting.

## Milestones

See `docs/roadmap.md` for full milestone tracking. Current state:

- M1-M5: Complete
- M5b (multi-layer): Complete
- M6 (scene quality + UI): In progress — layout, LoD, R3F migration done; atmosphere integration needs different approach
