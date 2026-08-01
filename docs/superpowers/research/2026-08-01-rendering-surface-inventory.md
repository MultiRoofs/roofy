# Rendering Surface Inventory (2026-08-01)

Complete inventory of multiroof-viewer code affected by replacing Three.js + R3F with Navara. Only 13 files under `src/` import `three`/`@react-three/*`/`@takram/*`/`3d-tiles-renderer`/`postprocessing`.

## src/scene/

- **`CitySceneR3F.tsx`** (~1894 lines) — the whole viewport: `<Canvas>`, @takram `<Atmosphere>/<Sky>/<Stars>/<SunLight>/<SkyLight>`, `<GoogleTilesLayer>`, drei `<OrbitControls>`, picking `<group>`, ground mesh, measure-tool meshes, `<PostProcessingEffects>`. Exports `CityScene` (forwardRef), `CitySceneHandle`/`CitySceneProps`, plus test-only exports `resolveMeshOwner`, `disposeLayerState`, `teardownRemovedLayer`, `buildCellMesh`, `syncStreamingCells`, `applyVisibility`, `computeTriangleCount`.
  - GPU-state model (lines ~94–134): `Map<layerId, LayerSceneState>`; `LayerSceneState.cells: Map<CellKey, CellSceneState>` (one Mesh per streaming tile).
  - `buildWorldToECEFMatrix` (~196–218): synthetic ECEF placement for atmosphere from site lat/lon (@takram `Geodetic`, `Ellipsoid.WGS84.getEastNorthUpVectors`). Dies with real georeferencing.
  - Mesh lifecycle effect (~480–634): reconcile layers → meshes; shared `sceneOriginRef` origin-offset; fit camera on first load. Streaming layers get shell state (`model.objects` is `{}` by design); cells mirrored by separate effect (~653–691) keyed on narrow `streamVersionKey` selector.
  - Picking: R3F pointer events on `<group>` (~768–826) → `resolveFromEvent` (~1618) → `resolvePicking.resolveSelection` → `selectionStore.hover/select/toggleSelect` (shift multi-select). 66ms-throttled cursor CRS readout.
  - Box-select `computeBoxSelection` (~1736–1791) via `Vector3.project(camera)`; candidates from `getResidentModel` for streaming layers.
  - `CitySceneHandle` (~158–170, impl ~870–957): `fitAll()`, `fitLayer(layerId)`, `alignView(direction)`, `getCameraState()`, `setCameraState(pos, target)` — camera crosses as plain `readonly [number,number,number]` tuples.
  - `syncStreamingCells`/`buildCellMesh` (~1247–1400): the ONLY place streaming geometry becomes a Three Mesh — wraps `CellEntry.geometry` typed arrays into BufferGeometry (attributes `position, normal, color, objectIndex, surfaceIndex`), positions via `meshOffset(cellCentre(grid,key,0), sceneOrigin)`, tags `userData.layerId/cellKey`.
  - Rule recolor: sync for static layers (~1473–1508); `recolorStreamingCells` (~1539–1611) does async worker round trip with stale-response guards via `CellSceneState.sourceEntry` identity.
  - `computeTriangleCount` (~1432–1450) → StatusBar. Every mesh gets `rotation.x = -Math.PI/2` (Z-up→Y-up). Time animation (~456–477): per-frame `useFrame` → `atmosphereRef.current?.updateByDate(next)`.
- **`buildCityMesh.ts`** — `buildCityMeshArrays` (~111–248) + triangulation/normals are pure/worker-safe → `CityMeshArrays` (`Float32Array`/`Uint32Array`: positions, normals, baseColors, objectIndices, surfaceIndices) + `PickingIndex`. `buildCityMesh` (~68–91) is a thin BufferGeometry wrapper (only Three-specific part). `computeOriginOffset` (~490–497) pure.
- **`highlightMesh.ts`** — `applyHighlight`/`clearHighlight` mutate the `color` attribute in place (base → rule → highlight layering). BufferGeometry-coupled, concept portable.
- **`applyRuleColors.ts`** — `buildRuleColorsFromArrays` (worker-safe) is the logic; `buildRuleColors` thin wrapper. `srgbHexToLinear` matches `three.Color` sRGB→linear (parity test: `ruleColorsWorkerSafe.test.ts`).
- **`resolvePicking.ts`** — `resolveSelection` reads objectIndex/surfaceIndex attributes at a triangle-vertex index.
- **`surfaceColors.ts`** — wraps `shared/surfaceColorMap.ts` in `three.Color`.
- **`ViewAlignButtons.tsx`** — pure HTML overlay; calls `CitySceneHandle.alignView`. No Three imports (keep).
- **`GoogleTilesLayer.tsx`** — `3d-tiles-renderer/r3f` `<TilesRenderer>/<TilesPlugin>`; decomposes inverse worldToECEFMatrix; swaps tile materials to MeshBasicMaterial. Subsumed by Navara native 3d-tiles.
- **`TileCreasedNormalsPlugin.ts`** — `toCreasedNormals` on tile meshes (Navara ModelMaterial has `creaseNormalAngle`).
- **`PostProcessingEffects.tsx`** — @react-three/postprocessing (SMAA, ToneMapping, Vignette, LensFlare), @takram clouds `<Clouds>`, `<AerialPerspective>`/`<LightingMask>`; defines `LIGHTING_MASK_LAYER = 10` used on all lit meshes.
- **`SceneEffectComposer.tsx`**, **`syncEffectComposerCameraSettings.ts`** — EffectComposer wiring + camera near/far cache sync workaround.

## App contract

- `App.tsx:117` `sceneRef: RefObject<CitySceneHandle>`. `getCameraState`/`setCameraState` used by save (~264–301), restore (~303–452, with 100ms setTimeout for layer mount), share (~462–496), share-load (~573–576). `fitAll` → toolbar (~641–643, 696); `fitLayer` → LeftSidebar `onFlyToLayer` (713).
- `persistence/*` has ZERO Three imports; camera as tuples in `ViewState.cameraPosition/cameraTarget`.
- No UI panel imports Three — all consume stores/domain only.

## Stores

- `layerStore`: `Layer.model` (CityModel), `visible`, `rules`/`rulesEnabled`, `selectedLod`/`lodMode`, `isStreaming`. Pure Zustand.
- `selectionStore`: pure; `Selection`/`PickMode`/`ToolMode` from `domain/selection/types.ts`.
- `solarStore`: `sunDirectionThreeJs` (~86–107) suncalc → Y-up vector; `reprojectToLatLon` (~131–149) proj4 bbox center → lat/lon. `CitySceneR3F` drives atmosphere by `date`, not direction; `PostProcessingEffects` uses `api.sunDirection` for lens flare.

## Streaming (src/features/streaming/)

- Three-free: `tileGrid.ts` (makeGrid, keysCovering, cellCentre, meshOffset), `levelPolicy.ts`, `throttleGates.ts`, `cellCache.ts`, `bucketFeatures.ts`, `objectRecords.ts`, `residentModel.ts`, `constants.ts`, `workerClient.ts`, `workerProtocol.ts` (`CellGeometry` = same 5-attribute shape), `fcb.worker.ts`, `openStreamingLayer.ts`.
- Three-coupled: `useTileStreaming.ts` (OrbitControls `change` event as camera-settled signal via `useThree().controls`; drives planCommit/commitNormal/commitSwap → WorkerClient → `useStreamStore`), `viewportFootprint.ts` (Vector3/PerspectiveCamera frustum-corner ground intersection in source CRS).
- `sceneTransform.ts` — THE single place for scene↔CRS sign convention (`world = P + R·v`, `R·v = (v.x, v.z, -v.y)`); pure math, no Three import; must be re-derived for ENU (z-up ENU likely makes it identity-ish).
- Recent race fixes to preserve (as tests): B1 content-changed cell resync via `sourceEntry` identity; B2 stale rule colors on fetch-vs-rule-edit race; B3 worker cache rollback restores prior value; B4 swap budget enforcement; B5 empty-cell hole tracking.

## Dependencies

Rendering-related: `@react-three/drei` ^10.7.7, `@react-three/fiber` ^9.5.0, `@react-three/postprocessing` ^3.0.4, `@takram/three-atmosphere` ^0.18.0, `@takram/three-clouds` ^0.7.4, `@takram/three-geospatial` latest, `3d-tiles-renderer` ^0.4.24, `postprocessing` ^6.39.0, `three` latest, `@types/three` latest (dev). Unaffected: `@cityjson/flatcitybuf`, `@duckdb/duckdb-wasm`, `zustand`, `proj4`, `suncalc` (replaced by view.atmosphere).

## Tests

- `tests/unit/scene/`: buildCityMesh, buildCityMeshArrays, highlightMesh, ruleColorsWorkerSafe, resolveSelection, layerSceneMap (drives CitySceneR3F helpers with real three objects — retire with file), sceneEffectComposer, postProcessingEffects, googleTilesLayer.
- `tests/unit/features/streaming/`: sceneTransform, tileGrid, viewportFootprint, useTileStreaming, levelPolicy, cellCache.
- `tests/unit/features/solar/solarStore.test.ts`; `tests/unit/persistence/captureRestore.test.ts`, `snapshotV2.test.ts` (camera tuples).
- `tests/integration/`: loadToInspect, loadCityJSONSeq, fcbStreaming, solarPipeline (never import CitySceneR3F).
