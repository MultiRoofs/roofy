# Navara Migration — Design

**Date:** 2026-08-01
**Status:** Approved (sections reviewed individually with HideBa)
**Scope:** Replace the Three.js + React Three Fiber rendering layer of multiroof-viewer with the Navara map engine, and create a CityJSON plugin monorepo (`cityjson-navara-plugins`, consumed as a git submodule).

## 1. Context

multiroof-viewer currently renders city models with React Three Fiber, drei OrbitControls, `@takram/three-atmosphere`/`three-clouds` (via a synthetic `worldToECEFMatrix` hack), `3d-tiles-renderer` for Google Photorealistic tiles, and a `postprocessing` EffectComposer stack. Rendering coupling is concentrated in 13 files, dominated by `src/scene/CitySceneR3F.tsx` (~1900 lines). The rest of the app talks to rendering only through the 5-method `CitySceneHandle` and Zustand stores.

Navara (`@navaramap/*`, v0.0.5 on npm, peer deps `three >= 0.183`, `postprocessing >= 6.38`) is a Rust/WASM globe engine with a Three.js render backend (`ThreeView`), built-in atmosphere/sun/terrain/3D-Tiles/GPU-picking, MRT G-buffer rendering, RTE float precision, and an extensible plugin + descriptor system. It has **no React wrapper** (fully imperative), **no CityJSON/CityJSONSeq/FlatCityBuf sources**, and **no per-surface/per-vertex styling** (its `FeatureEvaluator` styles per feature).

## 2. Decisions (user-approved)

1. **Big-bang replace.** Delete the R3F stack; build the Navara scene behind the same `CitySceneHandle` contract. Breaking changes are acceptable; each milestone is committed working.
2. **Parity scope.** Must survive: FCB camera-driven streaming + LoD ladder; Google Photorealistic tiles (via Navara's native `3d-tiles` source). Dropped/deferred: measure tool, box-select, lens flare/vignette extras.
3. **Rendering approach A: custom `MeshDesc` plugins** carrying the existing renderer-agnostic geometry pipeline (`buildCityMeshArrays` typed arrays: position/normal/color/objectIndex/surfaceIndex). 3D Tiles conversion remains a possible future plugin, not part of this migration.
4. **Self-contained plugins.** Parsers, geometry building, streaming engine, picking, and styling hooks move into the plugin monorepo. multiroof-viewer keeps stores, rules, UI, analytics, persistence.
5. **Monorepo layout:** submodule at `packages/cityjson-navara-plugins`; npm scope `@cityjson` (existing scope, already home to `@cityjson/flatcitybuf`).

## 3. Plugin monorepo: `cityjson-navara-plugins`

Currently a blank repo (one commit, Node `.gitignore`, private, `main`). Scaffold from scratch:

- **Tooling:** pnpm workspaces, TypeScript project references, tsup builds (ESM, d.ts), vitest, MIT license, no turborepo initially (plain pnpm `-r` scripts).
- **Packages:**

| Package                        | Contents                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@cityjson/navara-core`        | Format-agnostic domain moved from the app: CityJSON types + CityJSON/CityJSONSeq parsers (`src/domain/citymodel`), geometry building (`buildCityMeshArrays`, triangulation, normals, `computeOriginOffset`), CRS/proj4 EPSG defs (`crsProjDefs`), surface semantics/color map, picking index types, per-surface styling-hook types (`SurfaceStyleEvaluator`) |
| `@cityjson/navara-cityjson`    | Navara `Plugin` subclass + `CityModelMeshDesc`: descriptor registration, load API for CityJSON/CityJSONSeq, ENU globe placement, MRT opt-in, `PickableMeshWrapper` integration, per-surface pick resolution, `setStyle(evaluator)` vertex recoloring, highlight API (base → rule → highlight color layering)                                                 |
| `@cityjson/navara-flatcitybuf` | Streaming plugin: ports `tileGrid`, `cellCache`, `levelPolicy`, `throttleGates`, worker protocol + `fcb.worker`, `bucketFeatures`/`objectRecords`/`residentModel`; camera-driven commit loop rewired to Navara camera events; per-cell mesh handles. Depends on the existing `@cityjson/flatcitybuf` parser                                                  |
| `@cityjson/navara-cityparquet` | Placeholder scaffold only (package.json + empty entry), implemented later                                                                                                                                                                                                                                                                                    |

- **Consumption by the app:** git submodule at `packages/cityjson-navara-plugins` (SSH remote — repo is private and `gh` is unavailable); app `package.json` uses `file:` deps into the built packages; a Vite alias maps package names to plugin `src/` during dev for HMR. Plugin repo is buildable and testable standalone.

### Plugin public API sketch

```ts
// @cityjson/navara-cityjson
class CityJSONPlugin extends Plugin<ThreeView, ViewContext> {
  async init(view, ctx): Promise<void>; // registers CityModelMeshDesc et al.
  addCityModel(
    model: CityModel,
    opts: { id: string; crs: CrsInfo; lod?: string },
  ): CityModelHandle;
}

interface CityModelHandle {
  readonly id: string;
  setVisible(v: boolean): void;
  setLod(lod: string): void; // rebuilds geometry filtered by LoD
  setStyle(evaluator: SurfaceStyleEvaluator | null): void; // per-surface rule colors
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  resolvePick(pick: PickedFeature | ScreenPoint): Selection | null;
  getBoundsGeodetic(): GeodeticBounds; // for fitLayer/fitAll
  triangleCount(): number;
  delete(): void;
}

type SurfaceStyleEvaluator = (
  surface: SurfaceInfo,
  object: CityObjectInfo,
) => Color | null;
```

`@cityjson/navara-flatcitybuf` exposes the same `CityModelHandle` shape per streaming layer plus streaming controls (open URL, LoD mode, budget/cache config) and status callbacks (resident cells, holes, loading), preserving the store-mirroring semantics and the B1–B5 race-fix behaviors (content-changed cell resync via source identity, stale-recolor guards, cache rollback restore, swap budget, empty-cell hole tracking) — these behaviors are ported as tests first.

## 4. App-side architecture

### 4.1 NavaraViewport

`src/scene/CitySceneR3F.tsx`, `PostProcessingEffects.tsx`, `SceneEffectComposer.tsx`, `syncEffectComposerCameraSettings.ts`, `GoogleTilesLayer.tsx`, `TileCreasedNormalsPlugin.ts`, `highlightMesh.ts`, `applyRuleColors.ts`, `resolvePicking.ts`, `surfaceColors.ts`, `buildCityMesh.ts` are deleted (logic that survives moves to the plugin repo). Replacement: **`src/scene/NavaraViewport.tsx`** — a React component that:

- creates `ThreeView({ container, useNormal: true, shadow: true })` + `DefaultPlugin` + `CityJSONPlugin` + `FlatCityBufPlugin` in a mount effect; `await view.init()`; `view.dispose()` on unmount (guarding React StrictMode double-mount);
- calls `defaultPlugin.addDefaultPhotorealScene()` and adds the Google Photorealistic 3D Tiles as a native `3d-tiles` source + `model` layer (replacing `GoogleTilesLayer`);
- syncs stores → engine with focused effects: layers list → `addCityModel`/`delete`/`setVisible`/`setLod`; rules → compiled `SurfaceStyleEvaluator` → `handle.setStyle`; selection/hover → `handle.setHighlight`; solar datetime → `view.atmosphere.date` (time animation drives `date` from a `preUpdate` hook, not React state);
- wires `view.on("pick"/"mousemove"/"click")` → `handle.resolvePick` → `selectionStore` (hover/select/toggleSelect unchanged), plus cursor CRS readout via `vector3ToGeodetic` + proj4 inverse;
- exposes `CitySceneHandle` via `forwardRef` (same five methods, same call sites in `App.tsx`).

### 4.2 Camera & persistence (breaking)

`ViewState.cameraPosition/cameraTarget` tuples are replaced by geographic camera state `{ lng, lat, height, heading, pitch, roll }` mapped to `view.setCamera()`/`view.camera` getters; `fitAll`/`fitLayer` compute a geodetic union bbox from handles and use `flyTo`; `alignView` sets heading/pitch presets. Old saved snapshots/share links are invalidated (no migration shim, per project philosophy) — snapshot version is bumped and old versions are rejected with a clear message.

### 4.3 Coordinates

Real georeferencing replaces the origin-offset + synthetic-ECEF hack:

- Per layer: model CRS bbox center → proj4 → lat/lng/height → `geodeticToVector3` + `eastNorthUpToFixedFrame` = mesh matrix; vertices stay local-ENU-meters relative to that origin (float precision preserved; Navara's RTE handles globe scale).
- ENU is x=east/y=north/z=up, matching CityJSON's z-up directly — the `-π/2` mesh rotation and `src/features/streaming/sceneTransform.ts` sign-convention module are retired; any remaining scene↔CRS conversion lives in `@cityjson/navara-core` next to the geometry builder.
- Multi-layer alignment: the first layer's geodetic origin is _not_ shared; each layer gets its own ENU frame (globe placement makes shared origins unnecessary).
- **CRS gate:** layers whose CRS cannot be resolved to a proj4 def cannot be georeferenced and are rejected at load with a clear error (today's non-CRS "local" viewing mode is dropped; Navara has no planar mode).

### 4.4 Solar

`solarStore` keeps datetime state and roof metrics; sun-position math (suncalc + `sunDirectionThreeJs`) is replaced by `view.atmosphere` (`date`, `getSunDirection`, `getSunElevation`, `sunChanged` event). `reprojectToLatLon` (proj4) is kept for deriving site lat/lon. `suncalc` dependency is removed if no remaining consumer.

### 4.5 Dependency changes

Removed: `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `@takram/three-atmosphere`, `@takram/three-clouds`, `@takram/three-geospatial`, `3d-tiles-renderer`, and `suncalc` (per §4.4, once no consumer remains). Added: `@navaramap/three`, `@navaramap/three-default-plugin`, `@cityjson/navara-*` (file:). Kept and **pinned**: `three` (≥ 0.183, per peer range), `postprocessing` (≥ 6.38) — this also resolves the "unpinned three" known issue.

## 5. Data flow summary

```
open file ──► CityJSONPlugin.addCityModel / FlatCityBufPlugin.openStream
                     │ (parse + buildCityMeshArrays in plugin/worker)
layerStore ──sync──► CityModelHandle (visible / lod / delete)
ruleStore-per-layer ─compile─► SurfaceStyleEvaluator ──► handle.setStyle
selectionStore ◄─ resolvePick ◄─ view "pick"/pointer events
selectionStore ──► handle.setHighlight (vertex-color layering)
solar datetime ──► view.atmosphere.date ──► sun/sky/shadows (engine-native)
persistence ◄──► CitySceneHandle.get/setCameraState (geographic)
```

## 6. Testing

- **Plugin repo:** all worker-safe/pure tests move with their code (geometry arrays, rule colors incl. the sRGB→linear parity test, streaming grid/cache/policy/protocol, B1–B5 regression tests rewritten against the new handle model). Descriptor classes get unit tests with mocked `view`/`ctx` where feasible.
- **App:** persistence round-trip tests updated for geographic camera state; store→handle sync effects tested with a mocked plugin handle interface; `layerSceneMap.test.ts` is retired with the file it tests.
- **Smoke:** Navara needs real WebGL + WASM; end-to-end verification (load fixture, pick, recolor, stream) is done via `agent-browser` against `npm run dev` at each milestone, per repo convention.

## 7. Milestones

Each committed working; code review (feature-dev:code-reviewer, high effort) before commit at major milestones per CLAUDE.md.

- **M7.1** Scaffold plugin monorepo (workspaces, tsup, vitest, CI, license) + add submodule at `packages/cityjson-navara-plugins` + app wiring (file: deps, Vite alias).
- **M7.2** Move domain/geometry into `@cityjson/navara-core` (app temporarily re-exports to stay green; tests move along).
- **M7.3** `@cityjson/navara-cityjson` plugin + `NavaraViewport` rendering a static CityJSON layer on the globe (photoreal scene, camera handle, fitAll/fitLayer).
- **M7.4** Picking → selection → highlight; rule compilation → `setStyle`; LoD selection; legend/inspector re-verified.
- **M7.5** `@cityjson/navara-flatcitybuf` streaming plugin (camera-event-driven commits, footprint math, worker port, B1–B5 tests).
- **M7.6** Solar/atmosphere date wiring + shadows, Google 3D Tiles layer, geographic camera persistence (save/restore/share).
- **M7.7** Delete dead R3F/@takram/3d-tiles-renderer code and deps, pin versions, update CLAUDE.md/roadmap/docs.

## 8. Risks & open questions

- **Alpha engine (0.0.5):** no public changelog for npm packages; API may shift. Mitigation: pin exact versions; plugin repo isolates engine-facing code.
- **MRT + per-vertex colors:** custom materials must integrate with Navara's G-buffer (`setupMaterialForMRT()`); vertex-color rendering under MRT is undocumented → validate in an M7.3 spike before building the full descriptor.
- **Picking granularity:** `PickedFeature` gives `batchId`/`properties`/`layerId`; per-surface resolution relies on our own objectIndex/surfaceIndex attributes — if `PickableMeshWrapper` can't carry them, fall back to `getPickRay` + our own raycast (validate in the M7.3/M7.4 spike).
- **Bundling:** WASM/worker/`atmosphereAssetsUrl`/`stbnUrl` asset serving under Vite is undocumented — resolve in M7.1/M7.3.
- **Camera-settle signal for streaming:** replace OrbitControls `change` with `moveend`/`idle` events; verify cadence matches `throttleGates` assumptions in M7.5.
- **No planar mode:** non-georeferenceable datasets become unloadable (accepted; CRS-gated features already dominate).

## 9. Non-goals

Measure tool, box-select, vignette/lens-flare parity, CityParquet implementation, 3D-Tiles-conversion plugin, backward-compatible snapshots, React wrapper for Navara.
