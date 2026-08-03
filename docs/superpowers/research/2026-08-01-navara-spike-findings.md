# Navara MRT / custom-mesh-pick spike — findings (Task B1)

Date: 2026-08-02 (planned 2026-08-01)
Engine: `@navaramap/three@0.0.5`, `@navaramap/three-default-plugin@0.0.5`,
`@navaramap/three-default-descs@0.0.5`, `three@0.183.2`, `postprocessing@6.39.0`
Spike code: `spike.html`, `src/spike/navaraMrtSpike.ts` (deleted in Task C21).

---

## 0. Verdicts (the only part later tasks quote)

| Verdict                   | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| `MRT_VERTEX_COLORS_OK`    | **true**                                                                      |
| `PICK_PATH`               | **`"own-raycast"`**                                                           |
| `PROD_BUNDLE_OK`          | **true**                                                                      |
| `NODE_IMPORT_SAFE`        | **false** (`NODE_IMPORT_SAFE=false jl(...).cpus is not a function`)           |
| `CAMERA_BURST_SHAPE`      | **one `movestart` … N `move` … one `moveend` per gesture** (incl. inertia)    |
| `PROGRAMMATIC_MOVE_EMITS` | **split: `flyTo` = yes, `setCamera` = no, `resize` = no**                     |
| `WORKER_URL_FORM_OK`      | **true** — Task C4b, see §11 (not a B1 verdict; recorded here so C5 finds it) |

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

---

## 10. M7.4 browser smoke log (Task B16)

Interactive smoke of the whole M7.3 + M7.4 surface on the **real engine**:
`npm run dev` (port 5177) + the raw CDP driver
(`scratchpad/cdp3.mjs` — B11b's `cdp2.mjs` plus `move` / `clickAt` with
modifier masks, `drag` and `wheel`), Playwright Chromium
`--headless=new --no-sandbox --enable-unsafe-swiftshader`, 1280x800, DPR 1.
`agent-browser` remains unusable on this host (§8). The fixture is loaded
through the app's own `input[type=file]` via `DOM.setFileInputFiles`.

Geometry of the page under test: canvas at `(240, 44) 720x585` — the left
sidebar and the toolbar are both visible, so every pointer result below is also
a test that canvas-relative coordinates are computed correctly.

Rules were added **through the UI** (Inspector -> Rules -> the "Flat roofs"
preset button); the app exposes no store hook on `window` other than
`__multiroofRenderDebug`, and none was added for this.

### Results

| #   | Check                                                                     | Verdict                                          | Evidence                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fixture renders, no page exceptions, no failed requests                   | **PASS**                                         | `Objects 3 / Triangles 37`; `Runtime.exceptionThrown` empty across every run; only non-200 ever seen is `/favicon.ico`                                                    |
| 2   | Hover tints ONE building amber, the other untouched                       | **PASS**                                         | roof B `(124,43,39) -> (145,107,45)`; roof A unchanged. `…-hover.png`                                                                                                     |
| 3   | Click selects the object; attribute panel + inspector name it             | **PASS**                                         | `Selected 1`, inspector `ID NL.IMBAG.Pand.0002 / Type Building / LoD 2.2`; clicking building A instead reports its own attributes (`gabled`, 1923). `…-object-select.png` |
| 4   | Cursor readout is source-CRS metres, not lat/lon                          | **PASS**                                         | `XYZ 85027.4, 446005.5, 13.7` — RD New / EPSG:7415                                                                                                                        |
| 5   | Object-mode shift-click multi-selects across objects                      | **PASS**                                         | `Selected 2`, and BOTH buildings paint orange                                                                                                                             |
| 6   | Surface mode picks ONE face, not the solid                                | **PASS**                                         | roof face highlighted `(118,70,31)`, the wall below stays base `(3,5,12)`. `…-surface-select.png`                                                                         |
| 7   | Surface-mode shift-click reports two selections                           | **PASS**                                         | `Selected 2`; inspector switches to the 2-object aggregate view                                                                                                           |
| 7b  | …and paints both faces                                                    | **FAIL (pre-existing, not a Navara regression)** | see "Carry-forward" below. `…-surface-multi.png`                                                                                                                          |
| 8   | Rules repaint matching faces, walls keep base colors                      | **PASS**                                         | all three roofs `(104,29,27) -> (22,68,120)` = `#3b82f6`; every wall pixel unchanged. `…-rules-legend.png`                                                                |
| 9   | Legend lists the active rule + color                                      | **PASS**                                         | `RULES / Flat roofs`, swatch `rgb(59,130,246)`; toolbar pill `Rules 1 active`                                                                                             |
| 10  | Rules toggle off restores base colors, on repaints                        | **PASS**                                         | off -> pixel-exact base; legend disappears; on -> blue again                                                                                                              |
| 11  | LoD switch changes geometry + triangle count, and switching back restores | **PASS**                                         | `Triangles 37 -> 36 -> 37`; 583 px changed between 2.2 and 1.2 (bbox x531-593, y240-276); 2.2 -> 2.2 diff is **0 px**. `…-lod-1-2.png`                                    |
| 12  | Layer visibility toggle                                                   | **PASS**                                         | `Triangles 37 -> 0 -> 37`, viewport goes black and back. `…-layer-hidden.png`                                                                                             |
| 13  | `agent-browser errors` equivalent (console exceptions) empty              | **PASS**                                         | only the two known benign warnings: "Multiple instances of Three.js" (§ two-copies finding) and the DuckDB cityjson extension 404 (offline host)                          |

LoD switching needed a **two-LoD fixture**, which `fixtures/two-buildings.city.json`
is not (every geometry is `lod 2.2`). A throwaway copy with a bbox-box `lod 1.2`
`Solid` added per object was generated into the scratchpad for that check only —
nothing was committed to `fixtures/`.

### Additional checks carried forward from earlier reviews

1. **`vector3ToGeodetic` radians assumption — CONFIRMED CORRECT.** Seven probe
   points across the model, each compared against the fixture's own coordinates:

   | screen                  | readout                   | fixture object (true extent)      |
   | ----------------------- | ------------------------- | --------------------------------- |
   | (550, 250)              | `85004.7, 446005.5, 7.8`  | Pand.0001 — x 85000-85010, z<=8.4 |
   | (586, 268)              | `85013.8, 446001.7, 5.0`  | Pand.0001-part1 — x 85012-85016   |
   | (618, 240)              | `85021.9, 446003.7, 13.7` | Pand.0002 — x 85020-85035         |
   | (640, 234)              | `85027.4, 446005.5, 13.7` | Pand.0002                         |
   | (660, 232)              | `85032.4, 446006.0, 13.7` | Pand.0002                         |
   | (400, 500) / (850, 150) | _(cleared)_               | nothing drawn there               |

   Every horizontal pair lands inside the correct footprint and increases
   monotonically west -> east. A radians/degrees mix-up would put the readout on
   another continent, so this is settled. **Height caveat:** the vertical
   component scatters by up to ~1.8 m against the known roof heights (roof B
   reads 13.7 for a true 12.1; part reads 5.0 for a true 3.2; roof A reads 7.8
   for a true 8.4 — the sign is not constant, so it is scatter, not an offset).
   At the ~200 m fit distance that is <1% of range and it shrinks when zoomed in
   (a wall sample from 20x closer read `1.8`), which is the signature of
   `pickDepthPosition`'s depth-buffer reconstruction on a software rasteriser,
   not of the `heightOffset` arithmetic. **The geoid round trip is in fact
   verified here, not merely assumed:** every smoke run fetched the undulation
   successfully (`200` for both `terrain.reearth.land/mapbox/geoid/tilejson.json`
   and the EGM08 tile, and **no** `[geoid] Could not sample…` fallback warning),
   so the ~43.9 m Delft offset was genuinely added at placement and subtracted
   again by `layerHeightOffset` in the readout — and the result still lands
   within ~2 m of the file's own orthometric z. A one-sided error would read
   ~56 m or ~-32 m; neither appeared. Non-gating; re-measure the residual scatter
   on real GPU hardware.

2. **`pickDepthPosition` coordinate space with the sidebar visible — PASS.** The
   canvas starts at `x=240, y=44`, i.e. it is nowhere near the page origin. The
   table above is the proof: a handler using `clientX/clientY` instead of
   `canvasPointOf` would read the depth 240 px right and 44 px down of the
   cursor, which for every one of those probes is empty space (readout would go
   null) or a different building. `canvasPointOf` is correct.

3. **Hover perf on SwiftShader — no stalls (known-limitation check, not a gate).**
   `requestAnimationFrame` deltas, same session, same camera:

   | window                               | n   | mean     | p50   | p95   | max   |
   | ------------------------------------ | --- | -------- | ----- | ----- | ----- |
   | idle, 6 s                            | 31  | 188.0 ms | 186.3 | 224.1 | 256.5 |
   | 40-step hover sweep across the model | 40  | 198.5 ms | 196.6 | 241.3 | 241.4 |

   ~5 fps either way (the host has no GPU — §8), and the sweep's **max frame
   time is lower than idle's**: hovering across every object costs ~5% of an
   already software-bound frame and produces no spike. No console output during
   the sweep. Frame _counts_ on this host mean nothing; the absence of an
   outlier does.

4. **Sky-clear — PASS, and the DOM sky-detector is what does it.** The default
   fit camera (pitch -60) has no sky in frame at all, so this needed a camera
   with the model _and_ sky visible: `Front` align + 12 wheel notches in, which
   puts the horizon at y~345 with building B spanning y 270-415 across it.
   - cursor at `(700, 395)` — building B, **below** the horizon: `XYZ 85025.8,
446000.2, 1.8` and building B repaints (26 835 px). `…-sky-hover.png`
   - cursor at `(400, 150)` — **sky**: readout `null` **and** building B reverts
     pixel-exactly to base. `…-sky-cleared.png`
   - back to `(700, 395)`: identical to the hover shot, byte for byte.

   This is precisely the branch B15 added: over the sky the engine emits no
   `mousemove` at all (`convertMouseEventToMapEvent` returns null), and the
   container's own DOM listener clears hover + readout instead of freezing them.
   Two further observations from the same session: (a) a **near-horizon camera
   makes the engine silent over the model too** — in the un-zoomed `Front` view,
   hovering the building silhouette produces no hover and no readout, because
   the rays there are within a pixel or two of the ellipsoid tangent; the app
   fails _safe_ (clears) rather than freezing. (b) Moving the pointer off the
   canvas onto the align buttons fires the container's `mouseleave` and clears
   both — the other half of the B15 fix, observed incidentally.

5. **Measure / box-select toolbar buttons — now DISABLED** (orchestrator ruling
   for this task). Under `NavaraViewport` both tool modes are gated by
   `acceptsPointer` but have no consumer at all, so choosing either one only
   turned picking off. Both buttons now render `disabled` with the tooltip
   `"… — temporarily unavailable during the Navara migration"`; verified in the
   browser (`[{title:"Box select — temporarily unavailable during the Navara
migration", disabled:true}, {title:"Measure distance — …", disabled:true}]`)
   and pinned by `tests/unit/ui/viewerToolbar.test.tsx` (6 tests). `.tb-btn` had
   **no** `:disabled` rule at all — box-select's old `pickMode === "surface"`
   gating was invisible — so `app.css` gained `opacity .35 / cursor
not-allowed` and a `:hover:not(:disabled)` guard; confirmed in the browser
   via `getComputedStyle`. `…-toolbar-disabled.png`

6. **hi-DPI / retina — UNVERIFIABLE on this host.** The headless run is DPR 1
   and there is no display to emulate a real device pixel ratio against;
   `Emulation.setDeviceMetricsOverride` can fake `devicePixelRatio` but not the
   backing store WebGL actually allocates, so a pass there would prove nothing
   about `view.pixelRatio` in `getPickRay`. Left open for a run on real
   hardware.

### Carry-forward: two surfaces of the SAME object highlight as one

Confirmed in the browser (check 7b): shift-clicking a roof face and then a wall
face of the same building leaves `Selected 2` in the status bar and the 2-object
aggregate in the inspector, but only the **last** face is painted — the first
reverts to its base color.

Cause, in `packages/navara-cityjson/src/surfaceColorLayers.ts` -> `paintLayers`:

```ts
const selectedByIdx = new Map<number, Selection>();
for (const sel of selections) {
  const idx = objectKeys.indexOf(sel.objectId);
  if (idx >= 0) selectedByIdx.set(idx, sel); // <- second surface evicts the first
}
```

The map is keyed by **object** index, so two selections on one object collapse to
one. Selections on _different_ objects are unaffected (check 5 passes).

**This is pre-existing, not a migration regression:** the retired R3F path had
the identical line (`src/scene/highlightMesh.ts:53`, `const selectedSet = new
Map<number, Selection>()`), and `selectionStore.toggleSelect` has always been
able to hold two surfaces of one object. It is left as a carry-forward rather
than fixed inside a docs task: the fix is a submodule change (`Map<number,
Selection[]>` + `sels.some(s => matchesSurface(s, sIdx))`) and therefore its own
commit under the submodule-first protocol.

### Milestone code review — one critical finding, fixed

The `feature-dev:code-reviewer` pass over the cumulative Part B diff (required by
CLAUDE.md at a milestone boundary) turned up one critical defect:
`CitySceneHandle.ready` could **hang forever**. Every `return` inside
`NavaraViewport`'s queued init body is guarded by `cancelled`, and the effect
cleanup did not settle the gate — so unmounting while `session.ready` was still
pending left the promise permanently unsettled. Reachable today via `App.tsx`'s
`handleClose` (closing the file unmounts the viewport), and it becomes an
observable hang the moment Task C20 replaces its 100 ms `setTimeout` with
`await sceneRef.current.ready`.

The reviewer's suggested one-liner — reject in the cleanup — was **verified
wrong** before being applied: under StrictMode the discarded first pass's cleanup
rejects the gate the second pass then tries to resolve, and the existing
"builds exactly ONE engine across a StrictMode double mount" test goes red
(reproduced, then reverted). The gate must therefore be **settled _and_
re-armed**, and read through `readyRef` at use time rather than captured in the
effect closure (StrictMode re-enters the _same_ closure). `CitySceneHandle.ready`
is now a getter over the live gate.

Re-verified in the browser afterwards, since this is engine-lifecycle code:
load → pick → **Close file** (viewport unmounts, `canvas` count 0, no error
panel) → load again → engine back up, `Triangles 37`, picking and the CRS
readout working, zero page exceptions.

### Screenshots

All under `docs/superpowers/research/assets/`, all from the runs above.

| Asset                                     | Shows                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `2026-08-02-b16-m74-hover.png`            | Hover: building B amber, building A untouched                                         |
| `2026-08-02-b16-m74-object-select.png`    | Object pick: whole solid orange, inspector naming `NL.IMBAG.Pand.0002`                |
| `2026-08-02-b16-m74-surface-select.png`   | Surface pick: only the roof face orange, wall still base                              |
| `2026-08-02-b16-m74-surface-multi.png`    | Shift multi-surface: `Selected 2`, but only the last face painted (the carry-forward) |
| `2026-08-02-b16-m74-rules-legend.png`     | "Flat roofs" rule applied + legend overlay                                            |
| `2026-08-02-b16-m74-lod-1-2.png`          | The two-LoD scratchpad fixture switched to LoD 1.2                                    |
| `2026-08-02-b16-m74-sky-hover.png`        | Front+zoom camera, cursor on the building below the horizon: readout live             |
| `2026-08-02-b16-m74-sky-cleared.png`      | Same camera, cursor on the sky: hover and readout both gone                           |
| `2026-08-02-b16-m74-layer-hidden.png`     | Layer visibility off — empty viewport, `Triangles 0`                                  |
| `2026-08-02-b16-m74-toolbar-disabled.png` | The greyed-out box-select / measure buttons                                           |

### Green bar at the end of B16

```
npx tsc -b --noEmit                              -> clean
npx vitest run                                   -> 67 test files, 760 tests, all passing
(cd packages/cityjson-navara-plugins && pnpm vitest run) -> 22 files, 267 tests, all passing
npm run build                                    -> exit 0
```

---

## 11. C4b worker bundling — `WORKER_URL_FORM_OK = true`

Date: 2026-08-02. Decision gate that runs **before** Task C5 moves
`src/features/streaming/fcb.worker.ts` into `@cityjson/navara-flatcitybuf`.
B1 §4 proved the _engine's_ prebuilt assets survive a production bundle; it said
nothing about **our own** worker source living inside a plugin package and being
instantiated from the app across the `resolve.alias` boundary.

| Verdict                | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| `WORKER_URL_FORM_OK`   | **true**                                                          |
| Required config change | **none** (beyond listing the temporary spike HTML entry)          |
| C5 packaging decision  | keep the worker **in the package**, consumed via the source alias |

### What was tested

A throwaway worker at
`packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/spike/ping.worker.ts`
plus `spike/pingClient.ts` using the exact C5 URL form:

```ts
new Worker(new URL("./ping.worker.ts", import.meta.url), { type: "module" });
```

exported from the package barrel, imported by the app as
`import { ping } from "@cityjson/navara-flatcitybuf"` from
`src/spike/workerBundlingSpike.ts` / `worker-spike.html`. All four files, the
barrel line, and the temporary `build.rollupOptions.input` entry were removed
again at the end of the task — nothing but this section is committed.

The spike was run **twice**: once dependency-free (the brief's version, pure
module resolution), then a second time with the two import shapes C5's real
worker actually has — a **relative sibling** inside the package (`../constants`)
and a **cross-package bare specifier** that only resolves through the app's
alias (`@cityjson/navara-core`). The second run is the load-bearing one.

### Results

| Run                       | `window.__workerSpike`                                       | Worker target URL                                                                                                |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| dev, no imports           | `{"ok":true,"pong":42}`                                      | `/packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/spike/ping.worker.ts?worker_file&type=module` |
| preview, no imports       | `{"ok":true,"pong":42}`                                      | `/assets/ping.worker-CNkn7j8g.js` (200, 372 B transferred)                                                       |
| **dev, with imports**     | `{"ok":true,"pong":42,"sibling":100,"crossPackage":"0.0.0"}` | same dev URL form                                                                                                |
| **preview, with imports** | `{"ok":true,"pong":42,"sibling":100,"crossPackage":"0.0.0"}` | `/assets/ping.worker-C07tPBcS.js` (200, 405 B transferred)                                                       |

`sibling=100` is `BASE_CELL_M` from `../constants`; `crossPackage="0.0.0"` is
`NAVARA_CORE_VERSION` from the aliased `@cityjson/navara-core`. Both crossed the
alias boundary **into the worker**, in dev and in the production bundle.

Zero page exceptions, zero `Runtime.exceptionThrown`, zero
`Network.loadingFailed` in every run. The only non-200 anywhere is the repo's
long-standing `GET /favicon.ico 404`. No MIME error: the built chunk is served
`text/javascript`, and the dev worker module is served with `?worker_file&type=module`.

### Emitted output (production)

```
dist/worker-spike.html                    0.37 kB
dist/assets/workerSpike-CL4e8Szv.js       0.60 kB   (page entry)
dist/assets/ping.worker-C07tPBcS.js       0.10 kB   (hashed worker chunk)
```

and the page entry rewrites the call site to the hashed asset:

```js
new Worker(new URL(`/assets/ping.worker-C07tPBcS.js`, `` + import.meta.url), {
  type: "module",
});
```

### Things that were expected to be needed and were NOT

- **No `worker: { format: "es" }`.** See the caveat below — Vite emits the
  worker as an **IIFE** even though the call site says `{ type: "module" }`, and
  that is fine.
- **No `optimizeDeps.exclude` entry** for `@cityjson/navara-*`. The source alias
  keeps the packages out of pre-bundling already.
- **No alias change.** The existing `@cityjson/navara-flatcitybuf` → `src/index.ts`
  alias is exactly right; a `dist/` alias would have failed (see the tsup caveat).
- The only `vite.config.ts` edit was adding `worker-spike.html` to
  `build.rollupOptions.input` — required solely because that option is already
  explicit in this repo, so unlisted HTML pages are skipped. It is the same
  bookkeeping B1 §4 recorded for `spike.html`, not a worker fix, and it was
  reverted.

### Caveat 1 — the emitted worker chunk is IIFE, not ESM

Vite's default `worker.format` is `"iife"`, so the built chunk is
`(function(){…})();` with every import inlined and constant-folded. It loads
fine under `{ type: "module" }` because an IIFE is a valid module script with no
imports left in it. The app's **existing** `fcb.worker.ts` is emitted the same
way today (`dist/assets/fcb.worker-C-xemPGH.js`, 327 kB, 0 top-level imports),
so C5 is not changing the format of anything.

The consequence to remember: a worker in IIFE format **cannot code-split and
cannot keep a live dynamic `import()`**. If C5's worker ever needs one (e.g. lazy
WASM glue that must stay a real import), switch `worker: { format: "es" }` in
`vite.config.ts` — this spike shows nothing else stands in the way.

### Caveat 2 (IMPORTANT for C5) — the package's own `dist/` does NOT carry the worker

`pnpm build` (tsup) leaves the specifier **verbatim** in `dist/index.js`:

```js
const worker = new Worker(new URL("./ping.worker.ts", import.meta.url), { … });
```

and emits **no** `dist/ping.worker.*` next to it. tsup/esbuild does not implement
Vite's `new URL(…, import.meta.url)` worker convention. So:

- The app is safe **because it consumes the package through `resolve.alias` →
  `src/index.ts`**, where Vite sees the `.ts` and does the right thing.
- Any future consumer importing the **published** package would 404 on a `.ts`
  URL. If the package ever has to ship a usable `dist`, that is fallback (c) from
  the C4b brief — a pre-built worker asset from tsup — and it is a separate task.
  C5 does not need it.

### Type checking

Both repos' type checks stay clean with the worker in the package:
`npx tsc -b --noEmit` (app) and `pnpm typecheck` (submodule) both exit 0.
The submodule's `tsconfig.base.json` already has `"lib": ["ES2022", "DOM",
"DOM.Iterable", "WebWorker"]`, so `self.onmessage` inside the worker and
`new Worker(...)` in the client both typecheck in the same package with no
per-file tsconfig split. C5 needs no tsconfig work.

### Decision for Task C5

Proceed as planned: move `fcb.worker.ts` into
`packages/navara-flatcitybuf/src/` and instantiate it with
`new Worker(new URL("./fcb.worker.ts", import.meta.url), { type: "module" })`.
No `createWorker` injection seam (fallback b) and no pre-built asset
(fallback c) are needed. Keep the app on the **source alias** — that is the
precondition the verdict depends on.

### Tooling note

`agent-browser` still cannot drive pages on this host (B1 §8). Verified with a
raw CDP driver (Playwright's Chromium 1228 at
`~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`, `--headless=new
--no-sandbox`), attaching with `Target.setAutoAttach` so the **worker** target
and its errors are visible too — that is how the worker's real URL above was
captured.

---

## M7.5 closer — FCB streaming browser smoke (Task C14, 2026-08-03)

Raw CDP driver again (`agent-browser` still cannot drive pages here — B1 §8):
Playwright Chromium 1228, `--headless=new --no-sandbox
--enable-unsafe-swiftshader`, `Target.setAutoAttach` so the FCB **worker's**
range requests are visible (main-thread `performance.getEntriesByType` never
sees them — it reported 0 while the worker had issued 57). Clean clicks are
`mousePressed`+`mouseReleased` with no move between; camera gestures are
button-down drags. ~3–4 fps, so every wait is generous.

**Source:** no public `.fcb` URL exists — the plan's
`https://storage.googleapis.com/cityjson/delft.fcb` 404s. The smoke streamed
the repo's own `fixtures/delft.fcb` over the dev server
(`http://127.0.0.1:<port>/fixtures/delft.fcb`), which answers `206 Partial
Content` with `Content-Range`, so it is a real HTTP range-read path.

| screenshot                                        | what it shows                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `2026-08-03-c14-m75-01-landing.png`               | Landing page, no viewport mounted                                                        |
| `2026-08-03-c14-m75-02-globe-booting.png`         | `.fcb` submitted → globe up with **zero layers** (`engineBooting`)                       |
| `2026-08-03-c14-m75-03-cells-streamed.png`        | First cells resident after a zoom settle                                                 |
| `2026-08-03-c14-m75-04-top-cells.png`             | Top view: streamed cells with semantic surface colours                                   |
| `2026-08-03-c14-m75-05-pick.png`                  | Pick on a streamed building → inspector `NL.IMBAG.Pand.0503100000025028-0`, 294 surfaces |
| `2026-08-03-c14-m75-06-after-pan.png`             | Pan → 2123 features resident, 36.9K triangles, **same** building still highlighted       |
| `2026-08-03-c14-m75-07-rule-recolor.png`          | "Flat roofs" preset recolours every streamed cell, highlight survives                    |
| `2026-08-03-c14-m75-08-rule-after-pan.png`        | Cells arriving after the rule render in the rule colour                                  |
| `2026-08-03-c14-m75-09-lod.png`                   | LoD read-out (auto ↔ manual), `LoD 1.2 / 400 m cells`                                    |
| `2026-08-03-c14-m75-10-first-open-no-gesture.png` | After the review fixes: the whole of Delft resident with **no camera gesture at all**    |
| `2026-08-03-c14-m75-11-first-open-top.png`        | Same run, top view — `Objects 2231` in the toolbar badge                                 |

Console over the whole session: no errors or exceptions, only `favicon.ico`
404s. 57 range requests total across three settles — tens, not hundreds.

### Findings

1. **A streaming layer's bounds must not wait for its first commit.**
   `getBoundsGeodetic()` returned `null` until a cell was resident, but cells
   only arrive once the camera is close enough for the cover to fit the cell
   budget — so "Fit all" was a no-op on the globe and the data was
   unreachable. Fixed in the plugin (`e280907`): the FCB header extent is
   reported from `openStream` onwards; `null` now means _deleted_.
2. **A newly opened streaming layer needs its own auto-fit.** The viewport's
   fit-once effect keyed on `liveRef` growing, and streaming layers never
   enter `liveRef`. Added to the streaming reconciliation effect.
3. **A suppressed programmatic move left a commit owed.** `suppressSettle`
   swallows every camera event of the flight, so the auto-fit landed on Delft
   and fetched nothing: the viewport sat framed and empty until the user
   nudged the camera. Fixed in the plugin (`4fd5afe`) —
   `suppressSettleThenCommit` queues one commit for the moment the suppression
   window closes.
4. **The level-swap deadline was being applied to a layer's FIRST commit.**
   `planCommit` calls every initial load a swap (`prevLevel` is null), so the
   first fetch ran under `LEVEL_SWAP_TIMEOUT_MS = 1500` — with nothing to keep
   and nothing to roll back to, timing out just produced an empty layer and
   `Level swap timed out; kept the previous level`. The auto-fit frames the
   whole file, so the initial cover IS the whole file (1115 features, 7.6 MB in
   ~1 MB ranges) and takes ~10 s on this 3–4 fps host. Fixed in the plugin
   (`97afdbd`): race only when there is a previous level to fall back to. With
   both fixes the first open reaches `Objects 2231 / Triangles 217.8K` with no
   camera input whatsoever.
5. **`Objects` counted only `layer.model.objects`,** which is an empty stub for
   a streaming layer — the toolbar badge and status bar read `Objects 0` next
   to 2123 rendered buildings. Now unions the resident feature counts
   (`useTotalObjectCount`).
6. The engine's default photoreal sun follows the real clock, so a run at
   local night renders an almost-black scene regardless of the model. The
   driver shifts the page's `Date` to put Delft in daylight.
7. Timing: the first open is fully resident in ~25 s here, not the brief's
   ~5 s. That is the SwiftShader host decoding 1115 features — the range reads
   themselves are only 19 requests.
