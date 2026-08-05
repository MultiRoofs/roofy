# CLAUDE.md

## Project Overview

MultiRoof Viewer is a browser-based 3D city model viewer and rooftop analysis tool for the MultiRoofs European project. It visualizes CityJSON/CityJSONSeq/FlatCityBuf data with rule-based colorization, solar/shading analysis, and layer management, rendered on a real globe with photorealistic terrain.

## Tech Stack

- **Build**: Vite (via vite-plus) + React 19 + TypeScript
- **3D**: Navara — `@navaramap/three` (`ThreeView`), `@navaramap/three-default-plugin`, `@navaramap/three-default-descs`, all pinned **exactly** at `0.0.5`. No React Three Fiber, no drei, no `@takram/*`, no `3d-tiles-renderer`.
- **Three.js backend**: `three@0.183.2` + `postprocessing@6.39.0` + `@types/three@0.183.1`, all pinned exactly to satisfy Navara's peer ranges deterministically.
- **CityJSON plugins**: `@cityjson/navara-core`, `@cityjson/navara-cityjson`, `@cityjson/navara-flatcitybuf`, `@cityjson/navara-cityparquet` — a **git submodule** at `packages/cityjson-navara-plugins` (private, SSH-only: `git@github.com:HideBa/cityjson-navara-plugins.git`). pnpm workspace, consumed by the app via `file:` deps plus a Vite alias + tsconfig `paths` pointing at the packages' `src/` (so editing a plugin hot-reloads the app).
- **Geospatial**: proj4 (CRS), WGS84 ENU frames + EGM2008 geoid sampling from `@cityjson/navara-core`
- **State**: Zustand stores (layerStore, selectionStore, solarStore, streamStore, tilesStore, atmosphereStore, renderDebugStore)
- **Analytics**: DuckDB-wasm with cityjson extension
- **Testing**: Vitest + @testing-library/react

## Project Structure

```
src/
  app/          # App shell, CSS (App.tsx owns the viewport ref + toasts)
  main.tsx      # Entry point
  domain/       # Format-agnostic domain types
    citymodel/  # types.ts (re-export of core's vocabulary), detectEncoding,
                #   loadCityModel, citygml/ parser
    selection/  # Selection types (object/surface, ToolMode)
    geometry/   # derived.ts
    roofMetrics/# aggregate.ts (the metric maths lives in navara-core)
  features/     # Zustand stores and feature hooks
    layers/     # Layer store (multi-layer, per-layer rules, LoD) + file loader
    selection/  # Selection store
    solar/      # Solar position store
    rules/      # Rule presets + types.ts (re-export of core's rule schema)
    streaming/  # FCB streaming STORE + open wrapper + React hooks only —
                #   the streaming engine lives in @cityjson/navara-flatcitybuf
    tiles/      # Google Photorealistic 3D Tiles store
    atmosphere/ # Atmosphere/sky settings store
    debug/      # Render debug store
    theme/      # Dark/light theme toggle
  scene/        # Navara viewport and its supporting modules (no JSX scene graph)
    NavaraViewport.tsx  # Imperative ThreeView host: engine lifecycle, plugins,
                        #   events, CitySceneHandle
    handleSync.ts       # Zustand store -> plugin handle reconciliation
    navaraSession.ts    # Engine session/lifetime helpers
    geographicCamera.ts # {lng,lat,height,heading,pitch,roll} camera maths
    pickEventHandlers.ts# Pointer routing (tool modes, drag gate, sky moves)
    cursorCrsReadout.ts # ECEF -> source CRS readout under the cursor
    googleTiles.ts      # Google Photorealistic 3D Tiles layer
    sunWriter.ts        # Solar state -> engine sun/atmosphere
    timeAnimation.ts    # Time-of-day animation loop
    ViewAlignButtons.tsx
  ui/           # React UI components
    sidebar/    # LeftSidebar, LodSelector
    toolbar/    # ViewerToolbar
    inspector/  # InspectorPanel + tabs (Analysis, RuleBuilder, Solar, Stats)
    layers/     # LayerPanel, GoogleTilesPanel
    table/      # TablePanel
    viewport/   # LegendOverlay, AttributionOverlay, AttributePanel,
                #   AdvancedSettingsPanel
    StatusBar.tsx, ErrorBoundary.tsx
  persistence/  # Save/restore/share (localStorage, URL hash) — schema v3
  analytics/    # DuckDB-wasm, stats computation
  platform/     # Browser/Tauri adapter interfaces
packages/
  cityjson-navara-plugins/      # git submodule, pnpm workspace
    packages/navara-core/       # Engine-free: domain types, CityJSON parsers,
                                #   ENU frames, geoid, rules, styling, metrics
    packages/navara-cityjson/   # Static CityJSON layers (CityJSONPlugin)
    packages/navara-flatcitybuf/# Streaming FCB layers + worker
    packages/navara-cityparquet/# CityParquet (placeholder)
tests/
  unit/         # Unit tests (mirrors src/ structure)
  integration/  # End-to-end pipeline tests
fixtures/       # Test data (two-buildings.city.json/jsonl, delft.fcb)
docs/           # roadmap.md + superpowers/{specs,plans,research}
```

## Key Architecture Decisions

- **Real georeferencing**: every layer (and every streaming cell) gets its own ENU frame at its centre (`makeEnuFrame`), and **every vertex is transformed exactly** — source (x, y, z) → proj4 → lng/lat → + `heightOffset` → geodetic-to-ECEF → inverse ENU frame — by `projectPositionsToEnu` in `@cityjson/navara-core`. Source-CRS deltas are _not_ ENU metres (projection scale factor + grid convergence), so treating them as such would mis-place and slightly rotate anything more than a few hundred metres from the origin. ENU is x=east/y=north/z=up, identical to CityJSON, so there is no axis swap and no shared scene origin; the old origin-offset + `-π/2` rotation + `sceneTransform` sign convention are gone. The per-vertex cost is paid once per geometry build (LoD change, or a worker decoding a cell), never per frame. A mesh's ENU→ECEF frame is passed as `matrixWorld` in the engine's `addMesh` config; local vertices stay small.
- **CRS gate**: a layer whose CRS cannot be resolved to a proj4 def is rejected at load. There is no planar/local viewing mode.
- **Vertical datum**: source z is an orthometric height above a local datum (NAP for EPSG:7415), not an ellipsoidal height, so `heightOffset` metres are added during the ENU transform. It is sampled from a real geoid model — `geoidHeightAt(lng, lat)` in `@cityjson/navara-core` reads EGM2008 undulation from the Re:Earth Terrain service (global, keyless, Terrain-RGB tiles) — because `ellipsoidal = orthometric + undulation`. Static layers render at 0 and are re-placed when the sample resolves (`CityModelMesh.setHeightOffset`); streaming layers await the sample in `openStream` before the first cell, so the worker bakes every cell in the right frame. `addCityModel`/`openStream` accept an explicit `heightOffset` that wins outright. See Known Issues.
- **Attribution is a licence obligation.** `src/ui/viewport/AttributionOverlay.tsx` renders `GEOID_ATTRIBUTION` from `@cityjson/navara-core` **unconditionally** (the geoid is sampled for every georeferenced layer): CC BY 4.0 Mapterhorn, ODbL OpenStreetMap, and the Re:Earth/NGA credit. Only the Google Tiles credit is conditional. Never drop or gate the geoid lines.
- **Picking is our own raycast**: `PickStrategy = "own-raycast"` (`@cityjson/navara-cityjson/src/pickStrategy.ts`, `DEFAULT_PICK_STRATEGY`). Navara's `PickableMeshWrapper` carries one uniform batch id per mesh and cannot express per-surface ids, so the plugins raycast the engine's pick ray (`getPickRay`, ECEF) against their own geometry to resolve object **and** surface.
- **Engine-binding isolation**: `@navaramap/*` imports live **only** in named engine-binding modules — `navara-cityjson/src/{CityJSONPlugin,CityModelMeshDesc,CityMeshArraysDesc,plugin}.ts` and `navara-flatcitybuf/src/{FlatCityBufPlugin,engineRays,plugin}.ts`. Everything else takes descriptors, pick rays and mesh factories as injected seams. This is structural, not stylistic: `NODE_IMPORT_SAFE=false` — importing `@navaramap/three` under Node crashes at module scope. Plugin tests import the specific engine-free module, never the package barrel. The engine-bound entry points are the `/plugin` subpath exports, kept out of the main barrels.
- **Per-layer rules**: unchanged. Static layers compile to a `SurfaceStyleEvaluator` (`handle.setStyle`); streaming layers send rules to the worker (`handle.setRules`), which bakes vertex colours per cell.
- **Streaming**: camera-driven commits are triggered by Navara `movestart`/`move`/`moveend` on `view.camera` (never a render-loop timer). The settle controller commits on **`moveend`**, not `idle` — `idle` also fires for non-camera changes and would flush a debounce a `moveend` already armed. Each resident cell is its own mesh in its own ENU frame.
- **One viewport per process**: `@navaramap/three` keeps its tile worker pool in a module-level singleton, so a second `view.init()` before the first `dispose()` throws. `NavaraViewport` serialises engine lifetimes through a module-level slot (StrictMode-safe) and enforces at most one mounted viewport.
- **CitySceneHandle**: `fitAll`, `fitLayer`, `alignView`, `getCameraState`, `setCameraState` — camera state is geographic `{lng, lat, height, heading, pitch, roll}` — plus a `ready` promise that resolves after `view.init()` and a `getStreamingPlugin()` promise so early `.fcb` opens queue instead of dereferencing null.
- **Persistence**: snapshot/share version 3. Older snapshots and share links are rejected with an explanatory message; there is no migration shim.

## Commands

```bash
npm run dev          # Start dev server
npm run build        # TypeScript check + Vite build
npm run test         # Run vitest
npx tsc -b --noEmit  # Type check only (plain `tsc --noEmit` is a no-op: root tsconfig has no files, only project references)
npx vitest run       # Run app tests once
```

Plugin submodule (pnpm — Corepack refuses to run pnpm from the app root, which pins npm, so **always `cd` into the submodule**; never `pnpm -C` from the root):

```bash
cd packages/cityjson-navara-plugins
pnpm install         # required again after ANY app-side `npm install`
pnpm typecheck       # tsc -b
pnpm vitest run      # plugin tests (run a subset by path, not --project)
pnpm build           # pnpm -r build — always topological, never a bare --filter
```

- After **any** app-side `npm install`, re-run `pnpm install` inside the submodule: npm rewrites the linked packages' `node_modules` and destroys pnpm's workspace links.
- The submodule's root `vitest.config.ts` is load-bearing (it blocks vitest's findUp inheritance of the app config) — never delete it.
- Every plugin package depending on `@cityjson/navara-core` must carry `"three": "0.183.2"` in devDependencies, or pnpm degrades the workspace link to a packed `file:` snapshot.
- Singleton-registry libraries (`proj4`, `three`, `@navaramap/*`) are in the app's `resolve.dedupe`; core declares them as peerDependencies. Any new such library gets the same treatment.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

Navara needs real WebGL + WASM, so end-to-end checks are browser smokes, not jsdom tests. On a headless host without a GPU (SwiftShader, ~2–3 fps) event _shapes_ are reliable but frame counts are not; a bare no-button mousemove over the canvas moves the camera, so dispatch pressed/released events only.

## Code Review Process

When completing a major feature or milestone, use the `feature-dev:code-reviewer` agent with high effort to review changes. Run the review BEFORE committing. Address critical issues before pushing.

## Commit Convention

- Use small, incremental commits (one feature/fix per commit)
- Prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Run `npx tsc -b --noEmit` before committing to catch type errors (plain `tsc --noEmit` is a no-op here)
- The pre-commit hook runs `vp check --fix` (lint + format) — parent repo only; the submodule has no hooks, so run its lint/typecheck by hand.
- **Submodule-first protocol**: commit inside `packages/cityjson-navara-plugins` first, push it (`git -C packages/cityjson-navara-plugins push origin main`), then stage the submodule pointer bump plus any app-side files in the parent repo and commit that.
- Never `git mv` across the app/submodule boundary — it deletes the parent's gitlink. Use plain `mv` plus per-repo `git add`/`git rm`.

## Project Philosophy

- **Breaking changes are acceptable.** This is an experimental project — prioritize well-organized code and good UI/UX over backward compatibility. No migration shims or backward-compat hacks needed.

## Known Issues

- **Navara is alpha** (`@navaramap/* 0.0.5`, no public changelog). `three` and `postprocessing` are pinned exactly (0.183.2 / 6.39.0) to satisfy its peer ranges; bump them only together with a Navara upgrade. Upstream bugs found during the migration, all worked around locally and worth reporting: (a) the engine inlines a **second** copy of three r185 via `@navaramap/font` and its worker chunk — unfixable by dedupe, so never rely on `instanceof` across the font/label subsystem and treat `window.__THREE__` as unreliable; (b) `view.registerMesh()` throws if called before `await view.init()` (`addPlugin()` must still come before init); (c) the engine emits no pointer events for a cursor over the sky, so `NavaraViewport` also listens on the DOM container to clear hover/cursor state; (d) the tile worker pool is a module-level singleton, so at most one viewport can exist per page.
- **Vertical placement depends on a third-party service, and is EGM2008-accurate, not NAP-exact.** `geoidHeightAt()` fetches from `terrain.reearth.land`, which is **best effort with no SLA**. On any failure (offline dev, service down, unexpected tile encoding) it resolves `0` with one `console.warn` per layer and the model renders at its old, geoid-separation-low position — visibly sunk against photoreal terrain, not missing. Even on success the residual is decimetre-level: EGM2008 is a global model and NAP is a national one, and Terrain-RGB quantises to 0.1 m. That is well inside this viewer's tolerance; do not treat placed heights as survey-grade.
- Vertex normals are computed in source-CRS space by `buildCityMeshArrays` and are **not** recomputed after the ENU projection, so shading carries a slight distortion from the projection's scale factor and convergence. Shared by the static and streaming paths; visually negligible at city scale, but it is a known limitation, not an oversight.
- **Streaming commits have no deadline, deliberately.** `LEVEL_SWAP_TIMEOUT_MS` was removed on 2026-08-05: a layer's SECOND commit is always a LoD swap (the first runs with an unlearned ladder, so it resolves to `all`), a full-cover swap takes longer than 1.5 s, and the timeout path returned before recording `_lastLod`/`_level` — so every later camera-driven commit recomputed the same doomed swap and the layer livelocked. Cancellation is `abortInFlight()` + the worker epoch, not a timer. See `docs/superpowers/reviews/2026-08-03-uxfix-report.md` § Wave 3.
- Measure and box-select are **disabled**, not implemented: `ViewerToolbar` still offers the modes and `pickEventHandlers` still routes them (picking turns off), but nothing draws a rubber band or a measurement. Pending re-implementation against Navara.
- The vite-plus test runner has a bug that breaks `describe` for files importing from `"vite-plus/test"`; all test files were migrated to import from `"vitest"` instead (2026-07-28) and `npx vitest run` is green (0 failed files). Do not reintroduce `"vite-plus/test"` imports in new test files.

## Milestones

See `docs/roadmap.md` for full milestone tracking. Current state:

- M1-M5: Complete
- M5b (multi-layer + per-layer rules): Complete
- M6.1-M6.4 (scene quality, LoD, sidebar/toolbar, view alignment): Complete
- M7.1 (CityGML parser — buildings): Complete
- **Milestone 8 (Navara engine migration): complete through its internal phases M7.1–M7.7, pending final review.** That phase numbering belongs to `docs/superpowers/plans/2026-08-01-navara-migration.md` and is unrelated to Milestone 7 (CityGML).
