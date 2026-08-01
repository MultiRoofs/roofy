# Navara API Research Report (2026-08-01)

Source: https://navara-docs.netlify.app (full crawl). Docs repo: `eukarya-inc/navara-developer-docs`. Examples: https://navara-preview.netlify.app/. npm packages verified live at **v0.0.5**; peer deps `three >= 0.183.0`, `postprocessing >= 6.38.0`.

## What Navara is

Headless GIS core in Rust/WASM (Bevy ECS internally; terrain meshing and batch processing in Web Workers), rendering delegated to a Three.js backend. WASM modules: `navara_wasm` (full engine), `navara_wasm_api` (stateless math), `navara_wasm_worker`. API tiers: Tier 0 stable = `ThreeView` (camera/layers/fonts/events); Tier 1 = `ViewContext` plugin API (scenes, renderer, passes, buffers); Tier 2 (renderer injection / custom render loop) is **planned, not available**.

npm packages (`@navaramap` scope):

- `@navaramap/three` — `ThreeView` core; re-exports all `navara_three_api` GIS utilities
- `@navaramap/three-default-plugin` — `DefaultPlugin` registering all built-in descriptors
- `@navaramap/three-default-descs` — individual descriptor classes, importable à la carte
- `@navaramap/three-plugins` — `PersonViewPlugin`, `OverlayPlugin`, `CesiumIonPlugin`, `TileJsonPlugin`
- `@navaramap/three-api` — standalone GIS math (needs `initNavaraApi()` when used without engine)

Rendering model: **MRT G-buffer** (color, normal, effect ID, emissive). Built-in Three materials are auto-patched; custom `ShaderMaterial` must call `setupMaterialForMRT()`. Post-processing = ordered effect-descriptor pass pipeline on `postprocessing`. **RTE (relative-to-eye)** rendering for globe-scale float precision; utilities `encodePositionRTE()`, `calcModelMatrixRTE()`, `composeWorldMatrixForRTE()`, `calcCameraPosition()`.

## Bootstrap

```ts
import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const plugin = new DefaultPlugin();
const view = new ThreeView<DefaultDescriptions>({ useNormal: true });
view.addPlugin(plugin); // MUST be before init(); after init() it errors
await view.init(); // runs all plugin init() in parallel
plugin.addDefaultPhotorealScene(); // sky, stars, sunlight, atmospheric effects in one call
view.atmosphere.date = new Date("2026-07-16T01:00:00Z"); // use Z suffix (UTC)
view.toneMappingExposure = 10;
```

`ThreeView` constructor options: `container` (HTMLElement), `canvas` (HTMLCanvasElement|OffscreenCanvas, created if omitted), `pixelRatio`, `disableAutoResize` (false), `debug`, `atmosphere: { atmosphereAssetsUrl, stbnUrl, date }`, `backgroundColor` (0x0a0a0f), `multisampling` (0), `halfFloat` (true), `logarithmicDepthBuffer` (true), `shadow` (false, **init-time only**), `animation` (false = render-on-change; `idle` event after `idleThreshold` ms, default 100), `picking` (**true**), `mobileOptimization`, `cacheBytes`, `lodFog`, `dynamicSse`, `memoryBudget`, `waterTexture`, plus globe options (`maxSse` 2.0, `segments` 64, `useNormal` false, `color`, `hideUnderground` true, `wireframe`, `transparent`, `opacity`). `init({ canvas? })`; `dispose()`.

## Sources & Layers (Tier 0)

Sources: `geojson`, `vector-tile`, `raster-tile`, `raster-dem` (with `elevationDecoder`, e.g. `JAPAN_GSI_ELEVATION_DECODER()`), `quantized-mesh`, `3d-tiles`. Sources appear **closed** — no documented custom-source extension point. Optional `crs` string on `geojson`/`3d-tiles` sources (accepted values undocumented). No planar/non-globe mode.

```ts
const src = view.addSource({ type: "raster-tile", url: ".../{z}/{x}/{y}.png", maxZoom: 23 });
view.addLayer({ type: "raster", source: src });
view.addLayer({ type: "terrain", source: demSource, terrain: { castShadow: true, receiveShadow: true } });
view.addLayer({ type: "3d-tiles", source: tilesSource, model: { ... } }); // ModelMaterial
```

`Layer.update()` is full-config overwrite. Layer feature events: `featureCreated`, `featureUpdated` (+ `featureRemoved`, `featureVisibilityChanged` on 3d-tiles).

Materials: vector `point|billboard|text|polyline|polygon`; raster `raster|hillshade|elevationHeatmap`; terrain `terrain`; 3d-tiles `model`. `PolygonMaterial`: `color` (required), `opacity`, `transparent`, `show`, `height`, `extrudedHeight`, `clampToGround`, `perPositionHeight`, `castShadow`/`receiveShadow`, PBR knobs, emissive, outlines (GeoJSON only), `effectIds`. `ModelMaterial`: `color`, `opacity`, `metalness`, `roughness`, `castShadow`/`receiveShadow`, `maxSse`, `clampToGround`, `height`, `pointSize`, emissive, animation, `effectIds`, `showBoundingBox`, `creaseNormalAngle`, `normals`, `depthWrite`.

**`FeatureEvaluator`** (data-driven styling, per **feature** only — not per surface/vertex): delivered via `featureCreated`/`featureUpdated`; `readFeatureProperties(cb)`, `readFilteredFeatureProperties()`, `evaluate(cb)` returning `{ color, show, height, extrudedHeight, text, width, size, opacity, declutterPriority, image }`.

`Color` class (sRGB): `setRGB`, `setRGBLinear`, `setHex`, `setStyle`, `toArray`, `toHex`, `srgb()`, `.raw` (THREE.Color). `ColorMap`: `new ColorMap("sequential"|"diverging", name, lut)`, `linear(v)`, `quantize(n)`, `ticks(range,n)`, `createImage()` (legend canvas), `flatten()`.

## Descriptors (Tier 1 extension point)

Two-tier scene model: **Layers** (geographic sources) vs **Descriptors** (arbitrary 3D objects/effects/lights). Register **before init**: `view.registerMesh(name, DescClass)`, `view.registerLight(...)`, `view.registerEffect(...)`. Then:

```ts
import { BoxMeshDesc } from "@navaramap/three-default-descs";
view.registerMesh("box", BoxMeshDesc);
const handle = view.addMesh<BoxMeshDesc>({
  box: { width: 100, height: 100, depth: 100 },
});
// handle: BaseHandle<T> — partial update(), visible, delete(), ref (underlying descriptor/Three object)
```

The material key (`box`) selects the descriptor type. `addEffect()`, `addLight()` likewise.

Base classes:

- `MeshDesc<Config, UpdateConfig, InstanceObj>` — implement `createMesh()`
- `InstancedMeshDesc<TGeometry, TMaterial, Config, UpdateConfig, ChildConfig>` — `createGeometry()`, `createMaterial()`, `getChildConfigs()`, `getInstanceColor()`; instance ops `add()`, `removeAt()`, `updateAt()`, `replaceAll()`
- `EffectDesc<...>` — `createPass()`; static `key`, `insertAfter`, `insertBefore`; `find<T>("effectKey")`
- `LightDesc<...>` — `createLight()`

`BaseDesc` generics: `Config` (extends `BaseDescConfig`: `id?`, `visible?`), `UpdateConfig`, `Instance`, `CustomEvent`. Lifecycle: constructor → `onCreate()` (abstract; must set `this._instance` and add to appropriate scene) → `onUpdateConfig()` → `onDestroy()` (call `super.onDestroy()`); optional per-frame `update()`. Descriptors access `this.view` and `this.ctx`. `getPassKey()` override selects render target: **opaque / transparent / mrt / draped**.

**Picking for custom meshes**: wrap with `PickableMeshWrapper` (standard materials) or `PickableInstancedMeshWrapper`; custom shaders implement `PickableMesh` ("encode batch IDs as RGB in fragment shader during picking passes").

## Plugin authoring

```ts
abstract class Plugin<TView = unknown, TCtx = unknown> {
  abstract init(view: TView, ctx: TCtx): Promise<void>;
}
```

`view.addPlugin(p)` before `view.init()`; all plugin `init()`s run in parallel during `view.init()`. Patterns: registration-only; high-level API plugin (store view, expose post-init helpers); plugins shipping custom descriptors. `DefaultPlugin` is just pattern (a) for the 40 built-in descriptors.

Default descriptor keys — meshes: `rain, snow, sky, skyBox, stars, box, sphere, glowGlobe, cylinder, tube, plane, gltfModel, splat, axesHelper, arrowHelper, arcLines, smoothLines, boxes, spheres, planes, cylinders, gltfModels`; effects: `aerialPerspective, rainDrop, selectiveBloom, selectiveOutline, clouds, fogLight, lensFlare, ssao, ssr, depthOfField, colorGradingLUT, toneMapping, smaa, fxaa`; lights: `sun, ambient, skyLightProbe, lightProbe`.

## Coordinates (navara_three_api, re-exported from @navaramap/three)

- `geodeticToVector3(lle)` — lat/lng **radians**, height m → ECEF `Vector3`; `vector3ToGeodetic(xyz)`; `degreeToRadian()`/`radianToDegree()`
- `eastNorthUpToFixedFrame(originECEF)` / `northEastDownToFixedFrame(...)` — ENU local-frame matrix for placing local-coordinate meshes:

```ts
const origin = geodeticToVector3(lle);
const enuMatrix = eastNorthUpToFixedFrame(origin);
mesh.matrix.copy(enuMatrix); // mesh vertices are local ENU meters (x=east, y=north, z=up)
```

- `convertScreenToWorld()` / `convertWorldToScreen()`; `getPickRay()`, `getRayPlaneIntersection()`, `getHeightFromEllipsoid()`; `EllipsoidGeodesic` class; RTE helpers above.
- Internal world space: **ECEF meters, WGS84 ellipsoid**.

## Camera

`view.camera` (`ThreeViewCamera`): read-only `positionECEF {x,y,z}`, `positionGeographic {lng,lat,height}`, `orientation {heading,pitch,roll}` (degrees), `fovy`; setters `fov` (1–180), `near`, `far`; `options: CameraOptions` (spin speed, zoom range, inertia, `enableSpin`, `enableZoom`, `enableTilt`). Camera events: `movestart`, `move`, `moveend`, `frustumChanged` (`on/off/once`). View methods: `setCamera({lng,lat,height,heading,pitch,roll})` immediate; `flyTo()` animated (exact options undocumented); `lookAt()`, `moveCamera()`, `cameraFollow()`, `cameraFreeLook()`. Built-in controls — no OrbitControls.

Render-loop hooks: `view.on("preUpdate"|"postUpdate"|"preRender"|"postRender")`; `idle` event; per-frame descriptor `update()`. Terrain sampling: `sampleTerrainHeight()` (sync, undefined until loaded), `observeTerrainHeightAt()`. Memory: `memoryStats()`, `workerMemoryStats()`, runtime `cacheBytes`.

## Picking / events

`view.on(...)`: pointer `mousedown/mouseup/mousemove/mouseenter/mouseleave`, `click` (includes ECEF via `event.map`), `resize`, `idle`, `layer`. **`pick` event** (needs `picking: true`, default): `PickedFeature | null` with `batchId`, `properties`, `layerId`. Position picking: `pickTerrainPosition()` (terrain depth only), `pickDepthPosition()` (combined depth of all rendered geometry). No documented hover-highlight API (only `selectiveOutline`/`selectiveBloom` via `effectIds`); no documented sub-feature (per-surface) pick mapping.

## Atmosphere / sun / shadows

`view.atmosphere` (`Atmosphere`): `date` (UTC caveat); read-only ECEF `sunDirection`/`moonDirection`; `getSunDirection()`, `getMoonDirection()`, `isAtNight(pos)`, `getSunElevation(location)` (deg), `getSolarTime(location)` (0–24h), `setSolarTime(location, hours)`, `setDateAt()`, `setElevationAt()`, `setDateFromCameraAt()`, `setElevationFromCameraAt()`; event `sunChanged`. Sun drives `SunLightDesc`, `SkyMeshDesc`, `StarsDesc`, `SkyLightProbeDesc`, `AerialPerspectiveEffectDesc`, `CloudsEffectDesc` automatically. Shadows: `shadow: true` at construction (init-only) + `castShadow`/`receiveShadow` on materials; clouds can cast shadows; aerial perspective "irradiance" option shows cloud shadows (may affect transparent materials). `AtmosphereOptions` wants `atmosphereAssetsUrl` + `stbnUrl` (hosting details undocumented).

`OverlayPlugin` (DOM anchored to world positions): `setPositions([{id,lng,lat,alt}])`, `onUpdate(fn)` per frame with `ProjectedPosition {x,y,distance}` via `OverlayState.projected` Map, `moveOverlayElement(el,x,y)`, `maxDistance` (100 km default), `dispose()`.

## Gaps / unknowns (validate during implementation)

1. No CityJSON/CityJSONSeq/FlatCityBuf sources; sources not extensible — custom MeshDesc plugin is the path.
2. No per-surface/per-vertex styling API; vertex-color rendering under MRT undocumented — needs spike.
3. `crs` option values/registration undocumented; no planar mode.
4. No React integration; imperative only (ref + effect create/dispose pattern).
5. No bundler/WASM/worker/asset (`atmosphereAssetsUrl`, `stbnUrl`) setup docs for Vite.
6. Tier 2 (renderer injection/custom loop) unavailable.
7. Pick payload is engine-managed (`batchId`/`properties`/`layerId`); sub-feature mapping and hover-highlight are DIY.
8. Undocumented: `flyTo()` options, layer ordering, raycasting custom meshes outside pick pipeline, licensing, engine source repo, `sampleTerrainHeight` on non-terrain meshes.
9. No package changelog for npm packages (docs changelog tracks Re:Earth Visualizer; core ~alpha).
