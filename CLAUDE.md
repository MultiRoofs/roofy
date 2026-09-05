# CLAUDE.md

## Project Overview

**Roofy** (GitHub `MultiRoofs/roofy`, deployed at roofy.open3d.city) is a browser-based 3D city model viewer and rooftop analysis tool for the MultiRoofs European project. It renders CityJSON / CityJSONSeq / FlatCityBuf / CityParquet / CityGML data on a real globe (Navara engine) with rule-based colorization, solar analysis, geospatial overlay layers and DuckDB analytics.

Keep this file short: commands, workflow, hard rules. Decision records and engine quirks live in `docs/architecture-notes.md`; milestones in `docs/roadmap.md`. Add to those, not here.

## Tech Stack

- **Build**: Vite (via vite-plus `vp`) + React 19 + TypeScript. `.env` is dotenvx-encrypted.
- **3D**: `@navaramap/three`, `@navaramap/three-default-plugin`, `@navaramap/three-default-descs` pinned exactly at `0.1.1` (beta; the GitHub releases page is the only changelog). `three@0.183.2`, `postprocessing@6.39.0`, `@types/three@0.183.1` pinned exactly to match its peer ranges; a `three` bump is its own change, never folded into a Navara bump. No React Three Fiber, no drei.
- **CityJSON plugins**: `@cityjson/navara-{core,cityjson,flatcitybuf,cityparquet}` — git submodule at `packages/cityjson-navara-plugins` (pnpm workspace, public repo), consumed via `file:` deps plus a Vite alias + tsconfig `paths` into the packages' `src/` (editing a plugin hot-reloads the app).
- **Geospatial**: proj4, WGS84 ENU frames + EGM2008 geoid sampling from `@cityjson/navara-core`.
- **State**: Zustand stores under `src/features/*`.
- **Analytics**: DuckDB-wasm with the cityjson extension.
- **Catalog mini-map**: `maplibre-gl@^6`, driven imperatively, worker pinned by hand in `StacItemMap.tsx`.
- **Testing**: Vitest + @testing-library/react.

## Project Structure

```
src/
  app/          # App shell (App.tsx owns the viewport ref + toasts)
  domain/       # Format-agnostic types: citymodel (parsers, detectEncoding,
                #   cityGmlArchive), selection, geometry, roofMetrics
  features/     # Zustand stores + hooks: layers, geoLayers, selection, solar,
                #   rules, streaming (FCB store), stac, cityparquet (sourcing),
                #   tiles, atmosphere, debug, theme
  scene/        # Navara viewport (NavaraViewport.tsx) and imperative modules:
                #   handleSync, geoLayerSync, pickEventHandlers, basemaps,
                #   googleTiles, sunWriter, bloomEffect, sceneThemePolicy
  ui/           # React UI: sidebar, toolbar, inspector, layers, stac, table,
                #   viewport overlays, StatusBar, ErrorBoundary
  persistence/  # Save/restore/share (localStorage, URL hash) — schema v3
  analytics/    # DuckDB-wasm, stats
  platform/     # Browser/Tauri adapters
packages/cityjson-navara-plugins/packages/
  navara-core/        # Engine-free: types, parsers, ENU frames, geoid, rules
  navara-cityjson/    # Static CityJSON layers (CityJSONPlugin)
  navara-flatcitybuf/ # Streaming FCB layers + worker
  navara-cityparquet/ # Engine-free CityParquet reader (vendored patched hyparquet)
tests/unit, tests/integration   # mirrors src/
fixtures/                       # two-buildings.city.json/jsonl, delft.fcb
docs/                           # roadmap, design-doc, architecture-notes, testing-strategy
```

## Commands

App root (npm):

```bash
npm run dev          # dev server, via dotenvx
npm run build        # tsc -b + vite build, via dotenvx
npx vp check         # format + lint + type-aware lint (what the pre-push hook runs)
npx vp test run      # all app tests once (also: npx vitest run)
npx tsc -b --noEmit  # type check (plain `tsc --noEmit` is a no-op here)
```

Plugin submodule (pnpm — always `cd` into it, never `pnpm -C` from the root):

```bash
cd packages/cityjson-navara-plugins
pnpm install         # required again after ANY app-side `npm install`
pnpm typecheck       # tsc -b
pnpm vitest run      # plugin tests (subset by path, not --project)
pnpm build           # topological; never a bare --filter
```

Deploys: `deploy.yml` ships the Cloudflare Worker on push to `main`; `preview.yml` uploads an undeployed preview version for every PR and every push to `develop` (see `docs/repository-setup.md`).

Browser smokes use `agent-browser` (Navara needs real WebGL + WASM, so jsdom cannot cover the viewport). On this headless host: launch Chromium yourself, `agent-browser connect <port>`, run the whole scenario in one shell call; dispatch only pressed/released pointer events over the canvas.

## Development Workflow

- **TDD, red-green-refactor.** Write the failing test first, watch it fail for the intended reason, make it pass with the smallest change, then refactor. Regression tests for bug fixes come before the fix. Details in `docs/testing-strategy.md`.
- **Branching.** Commit directly on `develop` and push freely; no feature branch or PR is needed. The maintainer merges `develop` into `main` after a batch of changes.
- **Commits.** Small and incremental, one change per commit, prefixed `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`. Include `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Submodule-first.** Commit inside `packages/cityjson-navara-plugins` first and push it (`git -C packages/cityjson-navara-plugins push origin main`), then commit the pointer bump plus app-side files in the parent. Never `git mv` across the app/submodule boundary (it deletes the gitlink); use plain `mv` and per-repo `git add`/`git rm`.
- **Git hooks** (vite-plus, in `.vite-hooks/`, installed by `npm install` via `vp config`): pre-commit runs `vp staged` (`vp check --fix` on staged files); pre-push runs `vp check`, `tsc -b --noEmit` and `vp test run` (about 40 s). Parent repo only; run the submodule's typecheck and tests by hand. Do not bypass the hooks to save time.
- **Milestone review.** When a milestone is finished, have it reviewed by Codex CLI with model `gpt-6-astra` before merging, for example:

  ```bash
  git diff main...develop | codex exec -m gpt-6-astra "Review the piped diff for correctness, regressions and missing tests"
  ```

  Address critical findings before the merge. If Codex is unavailable, `claude -p --model opus` is the fallback reviewer.

## Hard Rules

Each of these has a story in `docs/architecture-notes.md`; the rule here is the short form.

- Never run bare `vite` / `vp dev` / `vp build`: `.env` is dotenvx-encrypted and a bare run inlines ciphertext as env values. Always go through the npm scripts.
- `@navaramap/*` imports live only in the named engine-binding modules (`CityJSONPlugin`, `CityModelMeshDesc`, `CityMeshArraysDesc`, `FlatCityBufPlugin`, `engineRays`, `plugin.ts`). Importing `@navaramap/three` under Node crashes at module scope, so plugin tests import specific engine-free modules, never a package barrel.
- At most one Navara viewport per page (module-level tile worker pool). `NavaraViewport` serialises engine lifetimes; keep it that way.
- `AttributionOverlay` renders the geoid attribution unconditionally. It is a licence obligation; never drop or gate it.
- Never write `view.globe.color` or `view.globe.wireframe` (frame presentation freezes, only a reload recovers). `view.globe.elevationColormap` is the one clean globe setter. Mesh-desc colours must be engine `Color` instances.
- `aerialPerspective.update` must carry the full `{ irradiance, useNormalBuffer, albedoScale }` calibration, never a single field.
- Custom effects must wrap the app-built effect in the engine's exported `Effect` class (the engine inlines its own `postprocessing`; anything else is a silent no-op) and declare any G-buffer they read in `static requiredBuffers` (attachments are allocated on demand since 0.1.1). Re-verify the bloom halo on any Navara or `postprocessing` bump.
- Keep the terrain layer: it supplies the normals the aerial-perspective pass needs; without it the frame goes black.
- One lighting calibration: the aerial-perspective pass in irradiance mode with `view.lit = false` at exposure 10. City meshes are unlit (`MeshBasicMaterial`, vertex colours), double-sided, with no app-added scene lights. Both mesh classes in `navara-cityjson` must agree.
- Appearances (textures/materials) are drawn per layer through `AppearanceTheme`, never per rule; a malformed appearance entry reads as untextured, never as a parse error.
- The brand's tokens live in `src/app/brand.css` (mirrored in `public/brand/brand.css`; change both), imported before `app.css`, which only derives from them. The plugins do not know the brand: highlight, hover and the surface palette reach them through the `colors` option (`src/scene/cityColors.ts` is the app's one answer, handed to both plugin constructors), and no highlight, hover or base surface colour may equal a rule preset or the default geo colour.
- Geo-layer picking uses the engine's `featureClick` event only; `featureHover`/`featureEnter`/`featureLeave` stay unsubscribed (a GPU pick per frame). A city hit always wins over a geo hit.
- Every programmatic camera move returns the engine's `flyTo` promise into `withSettleSuppressed`, so the streaming settle gate holds for the whole flight.
- Streaming commits trigger on `moveend`, never `idle` or a render-loop timer. The 30 s commit timeout is a liveness bound; do not reintroduce a performance deadline.
- Keep the maplibre worker pin (`setWorkerUrl` in `StacItemMap.tsx`) on any maplibre upgrade, and re-verify footprints in a real browser.
- Do not "fix" building bases to touch the terrain skin: the geoid path is correct, the terrain data is coarse.
- Test files import from `"vitest"`, never `"vite-plus/test"`.
- The submodule's root `vitest.config.ts` is load-bearing; never delete it. Every plugin package depending on `navara-core` carries `"three": "0.183.2"` in devDependencies.
- Singleton-registry libraries (`proj4`, `three`, `@navaramap/*`) go in the app's `resolve.dedupe`; core declares them as peerDependencies.
- Measure and box-select are disabled, not implemented (toolbar entries remain).

## Project Philosophy

Experimental project: breaking changes are fine, no migration shims. Prefer well-organised code and good UX over backward compatibility.
