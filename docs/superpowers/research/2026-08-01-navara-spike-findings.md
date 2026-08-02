# Navara MRT / custom-mesh-pick spike — findings (Task B1)

Date: 2026-08-02 (planned 2026-08-01)
Engine: `@navaramap/three@0.0.5`, `@navaramap/three-default-plugin@0.0.5`,
`@navaramap/three-default-descs@0.0.5`, `three@0.183.2`, `postprocessing@6.39.0`
Spike code: `spike.html`, `src/spike/navaraMrtSpike.ts` (deleted in Task C21).

---

## 0. Verdicts (the only part later tasks quote)

| Verdict                   | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `MRT_VERTEX_COLORS_OK`    | **true**                                                                   |
| `PICK_PATH`               | **`"own-raycast"`**                                                        |
| `PROD_BUNDLE_OK`          | **true**                                                                   |
| `NODE_IMPORT_SAFE`        | **false** (`NODE_IMPORT_SAFE=false jl(...).cpus is not a function`)        |
| `CAMERA_BURST_SHAPE`      | **one `movestart` … N `move` … one `moveend` per gesture** (incl. inertia) |
| `PROGRAMMATIC_MOVE_EMITS` | **split: `flyTo` = yes, `setCamera` = no, `resize` = no**                  |

No verdict failed in a way that requires a re-plan. One **new** risk was found that
is not in the plan: the engine ships a second, inlined copy of three (§7).

---

## 1. Real export names (Step 2)

Node cannot import any `@navaramap/*` package (§8), so the export lists were read
from `dist/index.js`'s final `export { … }` statement and `dist/index.d.ts`.

`@navaramap/three` — 174 runtime exports. Confirmed present:
`default` (= `ThreeView`), `MeshDesc`, `MeshDescWithSelectiveEffect`,
`InstancedMeshDesc`, `LightDesc`, `EffectDesc`, `BaseDesc`, `BaseHandle`,
`ViewContext`, `Plugin`, `EventHandler`, `PickableMesh`, `PickableMeshWrapper`,
`PickableInstancedMeshWrapper`, `PickableMultiInstancedMeshWrapper`,
`isPickableMesh`, `getPickRay`, `geodeticToVector3`, `vector3ToGeodetic`,
`eastNorthUpToFixedFrame`, `northEastDownToFixedFrame`, `northUpEastToFixedFrame`,
`northWestUpToFixedFrame`, `degreeToRadian`, `radianToDegree`,
`setupMaterialForMRT`, `overrideMaterialsForMRT`, `setupRTEBeforeRender`,
`calcCameraPosition`, `calcModelMatrixRTE`, `composeWorldMatrixForRTE`,
`encodePositionRTE`, `RTE_ONE_UNIFORM`, `STBN_URL`, `ATMOSPHERE_TEXTURE_URLS`,
`getWGS84SemiMajorAxis`, `getWGS84Flattening`, `getWGS84EccentricitySquared`,
`convertWorldToScreen`, `convertScreenToWorld`, `Color`, `Layer`, `Source`,
`TileMesh`, `AttributionPlugin`.

`@navaramap/three-default-descs` — 89 exports, all _descriptor_ classes:
`BoxMeshDesc`, `SphereMeshDesc`, `CylinderMeshDesc`, `PlaneMeshDesc`,
`GLTFModelDesc`, `SkyMeshDesc`, `StarsDesc`, `SunLightDesc`, `SkyLightProbeDesc`,
`AmbientLightDesc`, `SMAAEffectDesc`, `ToneMappingEffectDesc`,
`AerialPerspectiveEffectDesc`, `CloudsEffectDesc`, … .

`@navaramap/three-default-plugin` — exactly one export: `DefaultPlugin`.

### Corrections to the brief's assumed API (all load-bearing for B6/B7/C8/C11)

1. **`MeshDesc` is exported by `@navaramap/three`, not by `@navaramap/three-default-descs`.**
   `three-default-descs` only exports concrete descriptors.
2. **`registerMesh()` must be called AFTER `await view.init()`.** The descriptor
   registries are constructed inside `init()`; calling `view.registerMesh()`
   before it throws `TypeError: Cannot read properties of undefined (reading 'mesh')`.
   (`addPlugin()` is the opposite — it must be called _before_ `init()`.)
3. **`ThreeView` `Options` has no `useNormal` field.** Relevant real fields:
   `container`, `canvas`, `pixelRatio`, `picking?: boolean` (default `true`),
   `shadow`, `animation`, `multisampling`, `halfFloat`, `logarithmicDepthBuffer`,
   `atmosphere?: { atmosphereAssetsUrl?, stbnUrl?, date? }`, `idleThreshold`
   (default 100 ms), `cacheBytes`, `defaultAttribution`.
4. **`PickableMeshWrapper`'s constructor is `(object: Object3D, ctx: ViewContext)`** —
   there is no `{ layerId, properties }` options object. Registration is separate:
   `this.ctx.registerPickableMesh(this.id, wrapper)`.
5. **`getPickRay(windowLike, camera, screenPos)`**, where `windowLike` is
   `{ width, height, pixelRatio }` (CSS px; the function multiplies by
   `pixelRatio` itself), `camera` is `view.camera.raw` (a `PerspectiveCamera`),
   and `screenPos` is a `Vector2` in **CSS pixels**. Returns a three `Ray` in
   **ECEF**. (At `devicePixelRatio = 1` the CSS-px and device-px calls are
   identical; both were exercised and both resolved — see §3.)
6. **Camera events live on `view.camera`, not on `view`.**
   `ThreeViewCamera extends EventHandler<{movestart, move, moveend, frustumChanged}>`.
   `view` itself owns `resize`, `idle`, `pick`, `click`, `mousedown/up/move`,
   `preUpdate/postUpdate/preRender/postRender`, `layer`.
7. **Mesh placement**: the ENU→ECEF frame is passed as a top-level `matrixWorld`
   in the `addMesh` config (`view.addMesh({ spike: {...}, matrixWorld })`), which
   `MeshDesc.applyTransform` copies straight into `mesh.matrixWorld` and sets
   `matrixAutoUpdate = matrixWorldAutoUpdate = false`. Mesh world space **is
   ECEF**; local vertex positions stay small, so float32 precision is fine.

---

## 2. MRT + per-vertex colours (Steps 4 and 6) — `MRT_VERTEX_COLORS_OK = true`

One `Mesh` with **one** `MeshStandardMaterial({ vertexColors: true, flatShading: true })`
and a per-vertex `color` attribute (triangle 1 = `(1,0,0)`, triangle 2 = `(0,1,0)`)
renders as two distinctly coloured, lit triangles through the whole Navara
pipeline (MRT G-buffer → aerial perspective → tone mapping → SMAA).

No `ShaderMaterial` / `setupMaterialForMRT()` / `getPassKey() === "mrt"` override
was needed. The descriptor uses the **default** pass key `"opaque"`; `"mrt"` is
the _selective-effect_ scene, not a prerequisite for G-buffer participation.

Objective pixel evidence (sampled from the PNGs, sRGB 8-bit):

| sample point              | dev server (`:5173`) | preview of `dist` (`:4173`) |
| ------------------------- | -------------------- | --------------------------- |
| red triangle (605, 430)   | `rgb(229, 107, 91)`  | `rgb(229, 107, 91)`         |
| green triangle (668, 420) | `rgb(143, 206, 113)` | `rgb(143, 206, 113)`        |
| red triangle (612, 85)    | `rgb(229, 109, 92)`  | `rgb(229, 109, 92)`         |
| green triangle (662, 78)  | `rgb(143, 206, 114)` | `rgb(143, 206, 114)`        |

Screenshots: `docs/superpowers/research/assets/2026-08-01-navara-spike-dev.png`
and `…-preview.png` (byte-identical renders).

The globe is black in both shots because the spike adds no imagery/terrain source —
that is expected, not a failure. The triangles are lit (not flat `#f00`/`#0f0`),
so `SunLight` + the standard-material lighting chain are active.

**Consequence:** every later task that says "standard material" stands. The
documented `ShaderMaterial` + `setupMaterialForMRT()` fallback is **not** needed.

---

## 3. Picking (Step 5) — `PICK_PATH = "own-raycast"`

### Path A — `PickableMeshWrapper` (fails the per-surface criterion)

Setup: one `PickableMeshWrapper(mesh, ctx)` registered with
`ctx.registerPickableMesh(this.id, wrapper)`; the geometry additionally carried a
per-triangle `batchId` attribute `[0,0,0,1,1,1]` (the brief's assumption).

Measured (dev, and reproduced identically against the production preview):

```
click on red   triangle -> pick { properties: null, batchId: 4666372 }
click on green triangle -> pick { properties: null, batchId: 4666372 }
window.__spikeWrapperBatchId === 4666372
```

Both triangles return **the same** `batchId` — the wrapper's own id — so
`PickableMeshWrapper` cannot carry `(objectIndex, surfaceIndex)`.

Root cause, confirmed in `@navaramap/three/dist/index.js`: the wrapper allocates
**one** id in its constructor (`this.batchId = ctx.genGlobalBatchId() ?? 0`) and
injects a **uniform**-based fragment snippet
(`gl_FragColor = vec4(nvr_batchIdToColor(nvr_uBatchId), 1.0)`). The engine _does_
have a per-vertex variant (`attribute float batchId; varying float nvr_vBatchId`),
but it is wired only into `PickableInstancedMeshWrapper` (per **instance**), and
the per-vertex injector is not exported. A geometry `batchId` attribute on a
`PickableMeshWrapper` is simply ignored.

Also note `properties` came back `null` and `layerId` `undefined`: the wrapper's
batch id is not known to the WASM core, so `readPropertyByGlobalBatchId` misses
and `ThreeView.onPick` emits the fallback shape.

### Path B — `getPickRay` + three `Raycaster` (works, exactly)

```
__spikeRaycast(605, 430) -> { cssPx: {objectIndex:0, surfaceIndex:0, distance:431.8988336501837},
                              devicePx: {objectIndex:0, surfaceIndex:0, …}, dpr: 1 }
__spikeRaycast(668, 420) -> { cssPx: {objectIndex:1, surfaceIndex:7, distance:434.1976156831055},
                              devicePx: {objectIndex:1, surfaceIndex:7, …}, dpr: 1 }
```

Identical values on the dev server and on the production preview. The ray is
consistent with the scene to ~1e-3: for a screen point aimed at the mesh origin,
`getPickRay` returned direction `(-0.8702, -0.0663, -0.4882)` while the normalised
camera→mesh vector is `(-0.8700, -0.0663, -0.4877)`; camera and mesh are both in
ECEF (`camera.raw.position === camera.positionECEF`), 433.93 m apart.

**Verdict `PICK_PATH = "own-raycast"`.** Transcribe into
`PickStrategy = "own-raycast"` (Task B6) and pass it to
`new CityJSONPlugin({ pickStrategy })` / `new FlatCityBufPlugin({ pickStrategy })`
(B7/C11). Both branches still ship and are unit-tested per plan; the
`"pickable-wrapper"` branch is the per-object (not per-surface) fallback.

### Path A2 (bonus, not a verdict value) — own `PickableMesh` with per-vertex `batchId`

Because path A's limitation is purely the uniform, the spike also implemented
`PickableMesh` directly (`onBeforePicking`/`onAfterPicking`/`getRenderable`) over a
second mesh, allocating two ids from `ctx.genGlobalBatchId()` and injecting the
per-vertex variant by hand via `onBeforeCompile`.

```
ids allocated: { red: 15896338, green: 12351242 }
click red   -> batchId 15896337   (OFF BY ONE)
click green -> batchId 12351242   (exact)
```

So a GPU per-surface pick **is** achievable in principle, but the float
`varying` + `floor/mod` decode is precision-fragile at 24-bit ids (one of two
samples came back off by one). Making it reliable would need `flat` interpolation
or an integer attribute, i.e. real engine work. **Recommendation: keep
`own-raycast`; do not adopt A2 in this plan.** Record it as the upgrade path if
CPU raycast cost ever becomes a problem at city scale.

---

## 4. Production bundle (Step 6) — `PROD_BUNDLE_OK = true`

`npm run build` exits 0 (`tsc -b` clean, 977 modules, 4.77 s). `dist/spike.html`
is emitted, and every engine asset is hashed and copied by Vite automatically:

```
dist/assets/navara_wasm_bg-Ciu-R6gb.wasm            4,654.34 kB
dist/assets/navara_wasm_worker_bg-BZjLKf4i.wasm     1,809.50 kB
dist/assets/navara_wasm_api_bg-Ddx24MG4.wasm        1,754.97 kB
dist/assets/scattering-CCKbhVfn.exr                 4,088.74 kB
dist/assets/higher_order_scattering-DESNvLXy.exr    3,583.04 kB
dist/assets/single_mie_scattering-DSDvMnqN.exr      1,949.39 kB
dist/assets/transmittance-euSPPNgD.exr                 27.95 kB
dist/assets/stbn-CqLOkRpq.bin                       1,048.57 kB
dist/assets/shape-C0zrEmxc.bin / shape_detail / local_weather / turbulence / stars.bin
dist/assets/fontWorker-OwvKiQ8o-CS2KpVAh.js           129.89 kB
dist/assets/index-TKhRxurv-EzFtaRYd.js                322.01 kB   (engine worker chunk)
dist/assets/draco_decoder-*.wasm                      192 / 286 kB
dist/assets/spike-qWj6NYLp.js                       8,298.35 kB (gzip 2,646 kB)
```

`vite preview --port 4173` then serves a page that is pixel-identical to dev
(§2), resolves both raycasts (§3), and emits pick events. The only failing
request in the whole session is `GET /favicon.ico 404` (the repo has no favicon);
**no `.wasm` 404, no missing worker chunk, no atmosphere-asset failure.**

### Bundling fixes actually required (input to Tasks B8 and C4b)

Exactly **one** change to `vite.config.ts`, and it is only about the spike page
being a second HTML entry:

```ts
build: {
  rollupOptions: {
    input: {
      index: resolve(import.meta.dirname, "index.html"),
      spike: resolve(import.meta.dirname, "spike.html"),   // removed in C21
    },
  },
},
```

Everything that was _expected_ to be needed was **not** needed — record this,
it saves B8 a round of guessing:

- **No `optimizeDeps.exclude` entry for any `@navaramap/*` package.** The engine
  prebundles cleanly (dev) and bundles cleanly (build).
- **No `assetsInclude: ["**/\*.wasm"]`.** The engine references every asset as
`new URL("assets/…", import.meta.url)`, which Vite resolves and emits natively
in both dev and build. There is no manual `publicDir` copy step.
- **No `atmosphereAssetsUrl` / `stbnUrl` hosting is required.** Those options
  exist to _override_ the package-bundled EXR/BIN textures; leaving them unset
  makes the engine use its own `dist/assets/atmosphere/*` and
  `dist/assets/noise/stbn.bin`, which Vite emits into `dist/assets/`. Nothing
  needs to be uploaded or served from a CDN. (Total atmosphere/cloud/noise
  payload ≈ 13.6 MB — a hosting/latency consideration, not a correctness one.)
- **No `build.assetsInlineLimit` change.**

Caveat for C4b: the engine's own worker chunk (`assets/index-TKhRxurv.js`) is a
**pre-built** ESM file shipped inside the package and referenced by URL. It is
copied verbatim; Vite never transforms it. It is instantiated once per worker in
the pool (observed ~120 fetches from the HTTP cache) — noisy in the network panel
but harmless.

---

## 5. Camera event trace (Step 7)

Measured with real CDP `Input.dispatchMouseEvent` gestures on the canvas.
`t` is `performance.now()` in ms. **Caveat:** this host has no GPU, so Chrome ran
ANGLE/SwiftShader at ~2–3 fps. `move` fires once per rendered frame while the
camera changes, so the **counts and intervals below are frame-rate bound** (on
real hardware expect ~60 `move`/s). The **shape** — how many `movestart`/`moveend`
per gesture, and which APIs emit at all — is frame-rate independent and is what
C7/C20 must key off.

### (a) One drag with inertia (mousedown, 5 moves, mouseup)

```
[{"t":11742,"e":"movestart"},
 {"t":12179,"e":"move"}, … 17 × "move" … {"t":18309,"e":"move"},
 {"t":18640,"e":"moveend"},
 {"t":18911,"e":"idle"}]
```

- Exactly **one** `movestart` and **one** `moveend` for the whole gesture.
- `move` kept firing for ≈ 6.9 s **after** pointer-up — inertia is inside the
  same `movestart…moveend` burst, it does not open a second burst.
- `idle` arrived **271 ms** after `moveend` (`idleThreshold` default 100 ms plus
  ~1 frame at this frame rate).
- No `frustumChanged` during a pure orbit/pan.

### (b) `view.flyTo({lng:4.30, lat:52.05, height:2000, heading:30, pitch:-45, roll:0})`

```
[{"t":38107,"e":"movestart"},
 {"t":38446,"e":"move"}, … 16 × "move" … {"t":42820,"e":"move"},
 {"t":43098,"e":"moveend"},
 {"t":43399,"e":"idle"}]
```

Same shape as a user gesture: one `movestart`, N `move`, one `moveend`, then
`idle` 301 ms later. **`flyTo` is indistinguishable from a drag at the event level.**

### (c) `view.setCamera({lng, lat, height, heading, pitch, roll})` — twice

```
run 1: [{"t":57131,"e":"idle"}]   camera actually moved to height 299.998
run 2: [{"t":72565,"e":"idle"}]   camera actually moved to height 899.995, heading 44.89
```

**`setCamera` emits no `movestart`/`move`/`moveend` at all** — only the ambient
`idle` that follows any state change. Verified twice, with the camera confirmed
to have moved.

### (d) `resize` (1280×657 → 1000×700)

```
[{"t":65994,"e":"resize"},{"t":65996,"e":"frustumChanged"},{"t":66451,"e":"idle"}]
```

`resize` (on `view`) then `frustumChanged` (on `view.camera`) 2 ms later, then
`idle` 455 ms later. No `movestart`/`moveend`.

### Conclusions for Tasks C7 and C20

- **`CAMERA_BURST_SHAPE` = one `movestart` … one `moveend` per user gesture**,
  with inertia contained inside the burst. C7's assumed cadence mapping stands.
  A settle controller can commit on `moveend` (or on `idle`, ~270–460 ms later).
- **`PROGRAMMATIC_MOVE_EMITS` is split and must be handled as such:**
  - `flyTo` **does** emit a full `movestart…moveend` burst → **C7 needs its
    `suppress(fn)` bracket**, and any C7 test list must cover "flyTo emits a
    burst that must not be treated as a user gesture".
  - `setCamera` **does not** emit anything → **Task C20's camera restore
    (`setCameraState` → `view.setCamera`) needs no bracket**; a restored camera
    cannot trigger a streaming commit through the camera events. (It will still
    produce an `idle`, so anything that commits on `idle` alone _would_ fire —
    C7 should therefore key its user-gesture path off `moveend`, not `idle`.)
  - `resize` emits `resize` + `frustumChanged`, never `move*` — safe.

### Incidental finding (worth knowing when writing browser tests)

A bare `mousemove` with **no button pressed**, dispatched onto the canvas, moved
the camera ≈ 3 km (lng 4.3571 → 4.3159, lat 52.0101 → 52.0282). Every pick test
in this spike therefore dispatches only `mousePressed` + `mouseReleased`.
Also note Navara's `PickHelper` only fires a pick on `mouseup` when **no**
`mousemove` occurred since `mousedown`.

---

## 6. Node import (Step 8) — `NODE_IMPORT_SAFE = false`

```
$ node -e "const t0=Date.now(); import('@navaramap/three').then(m=>console.log('NODE_IMPORT_SAFE=true keys='+Object.keys(m).length+' ms='+(Date.now()-t0))).catch(e=>console.log('NODE_IMPORT_SAFE=false '+e.message));"
NODE_IMPORT_SAFE=false jl(...).cpus is not a function
```

Importing the ESM entry directly fails the same way
(`ESM_FAIL Gf(...).cpus is not a function`), so this is **not** a
CJS/ESM-resolution artefact of `package.json` lacking an `exports` map (it does
lack one: `main` → `dist/index.umd.cjs`, `module` → `dist/index.js`). The failure
is a genuine module-scope side effect: a bundled platform-detect helper evaluates

```js
t.exports.cpus =
  t.exports.platform === "browser"
    ? self.navigator.hardwareConcurrency
    : Gf().cpus().length;
```

at import time, and the `os` shim it bundles has no `cpus`.

**Consequence:** the Global-Constraints engine-binding-module split is a **hard**
requirement, not a stylistic one. Any plugin unit test that transitively imports
`@navaramap/*` dies at import time, before a fake can be injected. Test files must
import the engine-free module directly (`../src/cityModelRegistry`), never the
package barrel. Same applies to `@navaramap/three-default-plugin`;
`@navaramap/three-default-descs` fails for a different reason (it does
`import pkg from "@navaramap/three"` and Node resolves that to the UMD/CJS build).

---

## 7. NEW RISK — the engine ships a second, inlined copy of three (r185)

Console, in **both** dev and production preview, on every load:

```
THREE.WARNING: Multiple instances of Three.js being imported.
```

This is **not** fixable by `resolve.dedupe: ["three"]`, because the second copy is
not an import — it is **inlined into the published artefact**. Evidence, from the
shipped files:

- `node_modules/@navaramap/three/dist/index.js` contains a full three core with
  the revision string hard-coded to `"185"`:
  `typeof window < "u" && (window.__THREE__ ? cu("WARNING: Multiple instances of Three.js being imported.") : window.__THREE__ = "185")`.
  The same bundle _also_ imports `Camera`, `Vector3`, … from the peer `"three"`.
- `node_modules/@navaramap/three/dist/assets/index-TKhRxurv.js` (the pre-built
  worker chunk, 322 kB) contains its own inlined three r185.
- `@navaramap/three-default-plugin`'s prebundle embeds a third copy inside a
  worker source string.
- Origin: `@navaramap/font@0.0.5` depends on `three@0.185.1` and resolves to a
  nested `node_modules/@navaramap/font/node_modules/three@0.185.1`, which its
  build inlined. (`stats-gl` also carries a nested `three@0.170.0`, but nothing
  loads it in the spike.)

**Measured impact: the public API surface is fine.** With the spike importing
`three@0.183.2` directly:

```
{"spikeRevision":"183","windowThree":"183",
 "cameraIsPerspectiveCamera":true,"cameraIsObject3D":true,
 "meshIsObject3D":true,"meshParentIsObject3D":true}
```

`view.camera.raw instanceof PerspectiveCamera` (our three) is **true**, our
`Mesh` renders in the engine's scene, is picked by the engine's pick pass, and
raycasts correctly. So descriptor registration, mesh interop and material
interop all operate on the deduped `0.183.2`.

**What is still at risk (carry into M7.3+ / Task B8 / C24):**

1. Bundle weight: an extra ~0.6 MB of three ships inside `spike-*.js`
   (8.3 MB raw / 2.6 MB gzip for the engine-only page).
2. Any subsystem the engine implements against its inlined r185 — text/SDF label
   meshes and the font worker — is a separate three realm. Never `instanceof`
   across that boundary. We do not use labels today.
3. `window.__THREE__` is whichever copy loaded first, so that global is not a
   reliable version probe.
4. This should be reported upstream (`reearth/navara`): `three` is declared a
   peer dependency of `@navaramap/three` but is partly inlined via
   `@navaramap/font`.

---

## 8. Tooling note (affects every later browser check)

`agent-browser` (v0.24.1) could not drive this page on this host:

- Chrome needs `--no-sandbox` here (`AGENT_BROWSER_ARGS`), and even then every
  new `agent-browser` CLI invocation resolved its "active page" to a fresh
  `about:blank` instead of the page `open` had navigated — `eval`, `get`, and
  `tab list` all reported `about:blank` while `console` still streamed the live
  page's logs. `agent-browser batch` did not help. `eval` also runs in an
  **isolated world**, so page globals (`window.__spike*`) are invisible to it
  regardless.

All measurements in this document were therefore taken with a ~150-line raw CDP
driver (`scratchpad/cdp.mjs`) launching the Playwright-installed Chromium
directly (`--headless=new --no-sandbox --enable-unsafe-swiftshader`) and using
`Runtime.evaluate` (main world), `Input.dispatchMouseEvent` (trusted events),
`Emulation.setDeviceMetricsOverride` (resize) and `Page.captureScreenshot`.
Scenarios produced: page load, main-world reads, real click gestures, a real
drag-with-inertia gesture, programmatic `flyTo`/`setCamera`, and a real resize.
Scenarios _not_ produced: touch/pinch gestures, wheel zoom, multi-tab.

Recommendation for later tasks: keep a small CDP driver in the toolbox rather
than relying on `agent-browser` for anything that must read page state.

---

## 9. Green bar at the end of B1

```
npx tsc -b --noEmit   -> clean
npx vitest run        -> 58 test files, 637 tests, all passing
npm run build         -> exit 0
```
