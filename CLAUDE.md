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
npx tsc -b --noEmit  # Type check only (plain `tsc --noEmit` is a no-op: root tsconfig has no files, only project references)
npx vitest run       # Run tests once
```

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Code Review Process

When completing a major feature or milestone, use the `feature-dev:code-reviewer` agent with high effort to review changes. Run the review BEFORE committing. Address critical issues before pushing.

## Commit Convention

- Use small, incremental commits (one feature/fix per commit)
- Prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Run `npx tsc -b --noEmit` before committing to catch type errors (plain `tsc --noEmit` is a no-op here)
- The pre-commit hook runs `vp check --fix` (lint + format)

## Project Philosophy

- **Breaking changes are acceptable.** This is an experimental project — prioritize well-organized code and good UI/UX over backward compatibility. No migration shims or backward-compat hacks needed.

## Known Issues

- `three: "latest"` and `@takram/three-geospatial: "latest"` in package.json are unpinned — should pin to compatible versions.
- The vite-plus test runner has a bug that breaks `describe` for files importing from `"vite-plus/test"`; all test files were migrated to import from `"vitest"` instead (2026-07-28) and `npx vitest run` is green (0 failed files). Do not reintroduce `"vite-plus/test"` imports in new test files.
- @takram/three-atmosphere is integrated using a synthetic `worldToECEFMatrix` (built from site lat/lon) that maps local-origin camera coordinates to ECEF for the atmosphere shader, without moving meshes. Sky, Stars, SunLight, Clouds, and AerialPerspective only render when a valid CRS/lat-lon is available. Post-processing uses EffectComposer with SMAA (Canvas antialias is disabled). Future: may consider mixed lighting via LightingMask (option C) for more physically correct results.

## Milestones

See `docs/roadmap.md` for full milestone tracking. Current state:

- M1-M5: Complete
- M5b (multi-layer + per-layer rules): Complete
- M6.4 (left sidebar + toolbar pick mode): Complete
- M6.3 (per-layer LoD selection): Complete
- M6.1 (R3F migration): Complete. Atmosphere sky/sun/clouds/aerial-perspective integrated with EffectComposer + SMAA.
- M6.2 (view alignment + fly-to): Complete
