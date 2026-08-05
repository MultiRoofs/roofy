# Post-Navara UX fix pass — report

**Date:** 2026-08-03
**Branch:** `develop`
**Scope:** five maintainer-reported UX defects found on real hardware after the
Navara engine migration (Milestone 8).
**Status:** all five addressed. `npx tsc -b --noEmit`, `npx vitest run` (56
files / 659 tests), `npm run build` and `npx vp check` are all green (0 errors).
No submodule changes were needed — every fix is app-side.

| #   | Issue                               | Outcome                                                                               |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Black globe, no base map            | Fixed. Basemap store + picker + Navara raster layer; OSM by default; credits wired.   |
| 2   | Page scrolls while the wheel zooms  | Fixed. Non-passive `wheel`/`touchmove` `preventDefault` on the container + CSS belts. |
| 3   | Solar controls in the wrong place   | Moved. Clock cluster now in the toolbar; `SolarTab` slimmed to presets + readout.     |
| 4   | No clouds                           | Added. The default photoreal scene never adds them; appearance unverifiable headless. |
| 5   | Panel close leaves the canvas stale | Fixed. ResizeObserver on the container drives `view.resize`; picking re-verified.     |

Commits (oldest first):

| SHA       | Subject                                                                |
| --------- | ---------------------------------------------------------------------- |
| `64eb0e7` | feat: drape a selectable raster basemap over the globe                 |
| `50d4002` | fix: stop the page scrolling while the wheel zooms the viewport        |
| `4bf4b7f` | feat: add the volumetric clouds effect the photoreal scene omits       |
| `29d959a` | fix: resize the engine when its container resizes, not only the window |
| `d930901` | feat: move the solar clock into the toolbar                            |

---

## Engine ground truth established for this pass

Read out of `@navaramap/three@0.0.5` and `@navaramap/three-default-plugin@0.0.5`
(the shipped bundles, not the docs), because three of the five fixes turn on it:

1. **`addDefaultPhotorealScene()` adds no imagery.** Its whole body is
   `sky`, `stars`, `skyLightProbe`, `sun`, `aerialPerspective`, `lensFlare`
   (desktop only), `toneMapping`, and `smaa`/`fxaa`. There is no terrain layer,
   no raster layer and **no clouds effect**. That is issues 1 and 4 in one
   finding — and it is what the B1 spike already observed without acting on it
   ("the globe is black in both shots because the spike adds no imagery/terrain
   source").
2. **`DefaultPlugin.init()` DOES register `registerEffect("clouds", …)`**, so
   `view.addEffect({ clouds: … })` is available after `view.init()`; the
   descriptor simply is never instantiated by the convenience method.
3. **Auto-resize is window-only.** With `disableAutoResize` false the engine
   runs `window.addEventListener("resize", this._handleResize)` plus a
   `(resolution: Ndppx)` media-query listener, and `_handleResize` reads
   `container.offsetWidth/offsetHeight`. Nothing observes the container itself,
   so a layout change that leaves the window alone is invisible to it. That is
   issue 5.
4. **The engine's wheel listener does not cancel the default action.** Its
   input binder registers `t.addEventListener("wheel", f)` where `f` only calls
   `core.input({ type: "wheel", … })`. Its `touchstart`/`touchend`/`touchmove`
   handlers DO call `preventDefault()`; `wheel` does not. That is issue 2.
5. **`view.resize(w, h, pixelRatio)` passes `pixelRatio ?? 1` to the WASM
   core** — so omitting the third argument silently halves the effective
   resolution on a HiDPI display.

---

## Issue 1 — no base map

### What was wrong

Navara renders a globe, and nothing was ever draped on it. The app added
Google Photorealistic 3D Tiles when a key was configured and otherwise showed
the bare ellipsoid, which is black.

### What was done

- **`src/scene/basemaps.ts`** — engine-free catalogue (pure data, unit-tested
  under Node, same discipline as `googleTiles.ts`):

  | id               | label              | source                                                                                          | maxZoom | attribution                                                             |
  | ---------------- | ------------------ | ----------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
  | `none`           | None               | —                                                                                               | —       | —                                                                       |
  | `osm`            | OpenStreetMap      | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`                                                | 19      | © OpenStreetMap contributors                                            |
  | `esri-imagery`   | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 19      | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community |
  | `carto-positron` | CartoDB Positron   | `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`                                       | 19      | © CARTO, © OpenStreetMap contributors                                   |

  Note the Esri axis order is `{z}/{y}/{x}`, not the usual `{z}/{x}/{y}`; a
  unit test pins it, because swapping them fetches the wrong place silently.

- **`src/features/basemap/basemapStore.ts`** — one field, shaped exactly like
  `tilesStore`. **Default `osm`**, deliberately not `none`.
- **`NavaraViewport`** — an effect keyed on `basemapId` that does
  `view.addSource(option.source)` then `view.addLayer({ type: "raster", source })`,
  and on cleanup deletes the **layer first, then the source** (`Source.delete()`
  is documented as a no-op while a layer still references it). Failure is
  reported and swallowed: a backdrop that will not load must not take the
  viewer down, exactly like the Google tiles path.
- **UI** — `BasemapPanel` (a labelled `<select>`) sits directly above the
  Google 3D Tiles row in the left sidebar, because the two answer the same
  question; the same picker is mirrored in the advanced-settings panel next to
  the Google toggle.
- **Attribution (licence obligation).** `AttributionOverlay` takes a
  `basemapAttribution` array and renders it through the existing `linkify`, so
  "© OpenStreetMap contributors" in a basemap credit links the OSM copyright
  page just as the geoid line does. The credit follows what the ENGINE has, not
  what the user picked: a basemap the engine refused credits nobody. The geoid
  lines remain unconditional. Lines are DEDUPED in source order — the geoid
  credit already names OpenStreetMap, so an OSM or CARTO basemap would
  otherwise print it twice, which reads as a bug rather than a stronger credit.
  Esri's line is the service's own `copyrightText` verbatim; the imagery is a
  composite and a shortened "© Esri" under-credits everyone but Esri.

### Evidence

- **218 OSM tile responses, all HTTP 200**, issued from the engine's tile
  worker (the main thread's `performance.getEntriesByType("resource")` sees
  none of them — CDP `Network` with `Target.setAutoAttach` does). Zoom levels 0
  through 18 were fetched.
- Switching options: **154 Esri/CARTO tile responses, all 200**; the overlay
  text changed in lockstep —
  `© OpenStreetMap contributors…` → `Source: Esri, Vantor, Earthstar
Geographics, and the GIS User Community…` → `© CARTO / © OpenStreetMap
contributors…` → (None) only the geoid lines.
- Screenshots: `2026-08-03-uxfix-05-osm-globe.png`,
  `…-06-esri-globe.png`, `…-07-carto-globe.png`, `…-08-none-globe.png`. The
  "None" shot is the black globe returning, which is the control.
- 15 jsdom tests (`basemaps.test.ts`, `BasemapPanel.test.tsx`, the
  `NavaraViewport basemap` suite, the extended `AttributionOverlay` suite).

---

## Issue 2 — the page scrolled while the wheel zoomed

### What was wrong

See engine finding 4: the engine consumes the wheel delta but never cancels the
browser's default scroll, so both happened at once.

### What was done

A non-passive `wheel` listener on the viewport container calling
`preventDefault()`, in the bubble phase — the engine's own listener (bound to
its canvas, a descendant) has already run and fed the core by then, so the zoom
is untouched. `touchmove` gets the same treatment for the same reason. The
listener is installed with `[]` deps, not `[engineReady]`: the page must not
scroll while the engine is still booting either.

CSS belts: `overscroll-behavior: none` on the body, `overscroll-behavior:
contain` on `.viewport`, and `touch-action: none` on `.navara-viewport__canvas`
— scoped to the canvas host and NOT to `.viewport`, so the overlays stacked on
top of it (legend, attribute panel, advanced settings) still scroll on touch.

### Evidence

With a deliberately 3000 px-tall spacer appended to the body (so the page was
genuinely scrollable — `scrollHeight` 4514 vs `innerHeight` 757):

- four wheel notches over the canvas → `window.scrollY === 0`, and all four
  events arrived at `window` with `defaultPrevented: true`; the camera visibly
  zoomed out (`2026-08-03-uxfix-03-before-wheel.png` vs `…-04-after-wheel.png`);
- three wheel notches over the left sidebar → `defaultPrevented: false` on all
  three and `window.scrollY === 480`, i.e. normal page scrolling is untouched.

Plus two jsdom tests asserting `defaultPrevented` for `wheel` and `touchmove`.

---

## Issue 3 — solar controls in the wrong place

### Decision (disclosed as requested)

The primary clock moved to the toolbar and the inspector tab was **slimmed, not
kept as a duplicate**. Two live editors for one `solarStore.datetime` disagree
with each other the moment the animation runs (the loop publishes ~10×/s), and
there is nothing the panel could offer that the header does not.

- **Toolbar (`SolarControls`)**: date field, time field, play/pause, speed
  select (1× / 60× / 6min/s / 1hr/s), "now". Rendered immediately after the
  existing sun pill, which stays as the read-only summary.
- **`SolarTab`**: keeps the seasonal × time-of-day preset grid and the
  altitude/azimuth/horizon readout, and carries a one-line note saying where
  the clock went.
- All store wiring is unchanged — the same fields, so the atmosphere push, the
  animation loop, persistence and share links are untouched.
- The pill still requires a resolved sun position; the CONTROLS do not, so a
  model whose site has not resolved yet can still be dated.
- Below 1100 px the date field and speed select hide rather than pushing the
  right-hand action buttons off the toolbar.

### Evidence

Browser: setting the toolbar date to 2026-06-21 and the time to 12:00 moved the
sun pill to `Sun Jun 21, 12:00 PM` and re-lit the scene
(`2026-08-03-uxfix-02-noon-toolbar-clock.png`). 9 new jsdom tests
(`SolarControls.test.tsx`) cover local-time formatting, date/time edits that do
not disturb each other, play/pause, speed, "now", following a datetime the
animation loop published, and the toolbar rendering the cluster.

---

## Issue 4 — no clouds (and the honest limits)

### What was done

The viewport now calls `view.addEffect({ clouds: { coverage } })` itself, gated
on the two flags that already existed and had been inert since the migration:
`renderDebugStore.cloudsEnabled` (default **on**) and `postProcessingEnabled`.
Coverage changes are pushed into the **live** pass with `handle.update(...)`
rather than rebuilding it — a rebuild per slider step would re-load the pass's
3D textures. A pass the engine refuses is reported and skipped.

### Evidence, and what it does NOT prove

**Proven:** the pass is really created and really destroyed. When the toggle is
on, the browser fetches the clouds pass's own assets —
`assets/cloud/local_weather.png`, `assets/cloud/shape.bin`,
`assets/cloud/shape_detail.bin`, `assets/cloud/turbulence.png` and
`assets/noise/stbn.bin` (all 200) — and fetches them **again** after an off/on
cycle, which is only possible if the descriptor was torn down and rebuilt.
No console errors, no page errors.

**Not proven: appearance.** This host has no GPU. Under SwiftShader
(`--enable-unsafe-swiftshader`, ~1–3 fps) the whole scene renders **heavily
posterised** — see `2026-08-03-uxfix-13-clouds-on.png` and `…-14-clouds-off.png`,
where terrain and imagery come out as near-binary black/white. That artifact is
present with _every_ basemap and also with `None`, so it is a software-rasteriser
problem and not something these changes introduced — but it means the two
clouds screenshots are indistinguishable and no visual claim can be made from
them. Attempts to frame the horizon (tilt + long zoom-out) put the camera
somewhere useless at this frame rate and were discarded rather than shipped as
misleading evidence.

**Therefore:** clouds are wired, toggleable and demonstrably instantiated;
whether they _look_ right needs one look on real hardware. Same caveat applies
to the sun disc — the sky and sun light are added by
`addDefaultPhotorealScene()` (unchanged) and were not separately assessable
here.

---

## Issue 5 — closing a panel left the canvas stale

### What was wrong

See engine finding 3. The app shell is a CSS grid whose viewport column is
`1fr`, so the container _did_ resize correctly when a panel collapsed — the
engine simply never noticed, because it only watches `window`.

### What was done

A `ResizeObserver` on the container calling
`view.resize(clientWidth, clientHeight, view.pixelRatio)`. The pixel ratio is
explicit (engine finding 5). Zero-sized containers are ignored rather than
resized to a degenerate aspect. The observer is disconnected on teardown, and
guarded behind a `typeof ResizeObserver` check.

### Evidence

Toggling the inspector, then the sidebar, at a 1440×900 window:

| state            | canvas CSS px | drawing buffer | container  |
| ---------------- | ------------- | -------------- | ---------- |
| both panels open | 880 × 685     | 880 × 685      | 880 × 685  |
| inspector closed | 1200 × 685    | 1200 × 685     | 1200 × 685 |
| both closed      | 1440 × 685    | 1440 × 685     | 1440 × 685 |

`2026-08-03-uxfix-11-both-panels-closed.png` shows the canvas filling the
shell with no blank strip. Picking was re-checked after the resize: a pointer
move over the resized canvas produced a valid source-CRS readout
(`XYZ 85017.3, 445994.6, -41.1` in EPSG:7415), so the container-derived pick
sizing is consistent with the new canvas — the offset risk called out in the
brief is closed by the same fix.

3 jsdom tests cover the observed element, the pixel ratio argument, the
zero-size guard and the disconnect.

---

## Review round (2026-08-03, after "approved with findings")

| Finding                                         | Commit    | Resolution                                                                                                     |
| ----------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Esri under-credited                          | `73e3612` | Full `copyrightText` shipped verbatim; OSM/CARTO re-checked, correct as they were.                             |
| 6. "© OpenStreetMap contributors" printed twice | `73e3612` | Credits deduped in source order; every distinct obligation still rendered and linked.                          |
| 7. Source leaked when `addLayer` throws         | `9ebaf3b` | `discardOrphanSource` in both `addBasemap` and the pre-existing `addGoogleTiles`; tests assert the delete.     |
| 8. `BasemapHandles = GoogleTilesHandles`        | `9ebaf3b` | Renamed to a shared `SourceLayerHandles`.                                                                      |
| 2. Wrong claim about the engine's `touchstart`  | `c26ea34` | Corrected: the engine DOES preventDefault all three touch events; the belt is a pre-init/outside-canvas guard. |
| 3. Wrong mechanism for the stale pick           | `c26ea34` | Corrected: the ray comes from `view.screenSize`, which only `resize()` updates.                                |
| 4. Unused exports (2 new lint warnings)         | `c26ea34` | `toLocalDateStr`/`toLocalTimeStr` unexported; `vp check` back to the pre-wave 9 warnings.                      |
| 5. Dead CSS from the `SolarTab` slimming        | `c26ea34` | `.solar-input`, `.solar-input:focus`, `.solar-time-label` and the light-theme `.solar-input` rule removed.     |
| 10. `overscroll-behavior` on the body           | `c26ea34` | Moved to `.viewport`; the landing page keeps pull-to-refresh (verified: body `auto`, viewport `contain`).      |
| 9. Narrow-viewport date UX                      | —         | Skipped per verdict (disclosed, acceptable).                                                                   |
| OSM-default policy                              | —         | Not changed; captured as a follow-up under Known limits.                                                       |

Re-verified in the browser after the round: 161 tile responses all 200; the
overlay shows exactly one OSM span with OSM active, the full Esri source line
with Esri active, and `© CARTO` + one OSM span with CARTO active, with the
geoid's own `…, ODbL` line (a different string) surviving all three; the wheel
over the canvas is still cancelled with `scrollY` 0; no page errors. Screenshot
`2026-08-03-uxfix-18-attribution-deduped.png`.

---

## Verification method

- **jsdom / vitest** for all store and UI logic, with the engine mocked (the
  engine cannot be imported under Node — `NODE_IMPORT_SAFE = false` — and jsdom
  has no WebGL). `ResizeObserver` is stubbed in the viewport suite so a
  container resize can be simulated without a window resize.
- **Real browser via raw CDP.** `agent-browser` still does not work on this
  host, so the existing driver (`c26-cdp.mjs`: Playwright Chromium 1228,
  `--headless=new --no-sandbox --enable-unsafe-swiftshader`,
  `Target.setAutoAttach` so worker network traffic is visible) drove
  `npm run dev` at `localhost:5173` with `fixtures/two-buildings.city.json`.
- Screenshots live in `docs/superpowers/research/assets/2026-08-03-uxfix-*.png`.

## Known limits / follow-ups

- **SwiftShader posterisation** (above) makes this host unusable for judging
  colour fidelity of imagery, sky or clouds. One look on real hardware is
  needed to close issue 4 visually — and to confirm the basemap's tone mapping
  looks right, since raster imagery is being lit and tone-mapped like any other
  surface.
- **The OSM default rides on the OSMF tile policy, and should not for long.**
  `tile.openstreetmap.org` is a donation-funded service whose Tile Usage Policy
  forbids heavy or systematic use and requires an identifying User-Agent, which
  a browser app cannot set. It is the right default for a research viewer with
  a handful of users, and a liability the moment this has real ones: a 3D globe
  fetches many more tiles per session than a 2D map, and the fixture session
  measured here issued 218 in a couple of minutes. Follow-up when usage grows:
  move the default to CARTO (whose basemaps are explicitly free for
  non-commercial use at low volume) or to a keyed provider behind an env var,
  the way the Google tiles already are, and leave OSM as an explicit choice.
- **The basemap selection is not persisted.** It is not in the snapshot/share
  schema (v3), so a restored workspace comes back on the default. Adding it
  means a schema bump, which is out of scope for a defect pass.
- **No terrain layer.** The basemap drapes on the ellipsoid; there is no
  `raster-dem`/`quantized-mesh` terrain, so the ground is flat. That is
  unchanged from before this pass and is a separate feature.
- **Google tiles and the basemap are independent.** Both can be on; the tiles
  cover the basemap where they have coverage, which is why "None" is offered.

---

# Wave 2

**Date:** 2026-08-03
**Branch:** `develop`
**Scope:** three further maintainer-reported defects, all of them consequences
of the same thing wave 1 only half-finished — settings that exist in the UI but
not in the engine.
**Status:** all three addressed. `npx tsc -b --noEmit` clean, `npx vitest run`
57 files / 685 tests passing, `npm run build` exit 0, `npx vp check` 0 errors /
9 warnings (unchanged from before the wave). No submodule changes.

| #   | Issue                                | Outcome                                                                                                                                                     |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Advanced Settings toggles do nothing | Fixed. Six controls wired to real engine handles, three deleted for want of one, two new engine-backed knobs.                                               |
| 2   | The scene looks dark                 | Fixed. `toneMappingExposure` 1 → 10, an ambient fill light, and a midday-UTC default clock. **+26.9 % mean canvas luminance** on the same scene and camera. |
| 3   | The right-pane Solar tab             | Removed. Presets grid + sun readout moved into a popover on the toolbar's solar cluster; dead CSS deleted.                                                  |

| SHA       | Subject                                                           |
| --------- | ----------------------------------------------------------------- |
| `c369aa6` | fix: give every advanced setting a live engine counterpart        |
| `774dac2` | feat: rebuild the Advanced Settings panel over the wired controls |
| `9094862` | refactor: retire the Solar inspector tab into the toolbar cluster |
| `ad5fa31` | fix: start the scene clock at midday UTC, not at the wall clock   |

---

## Issue 1 — the Advanced Settings panel was mostly decorative

### Full inventory, before

Read from `AdvancedSettingsPanel.tsx` and grepped for every consumer of the
store field behind it. "Wired" means some code outside the panel read it.

| Control            | Store                               | Wired before?                                | Action                                                |
| ------------------ | ----------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| Post Processing    | `renderDebugStore`                  | Partly — only as a gate on the clouds effect | **Kept**, now the real master over the post chain     |
| Clouds             | `renderDebugStore`                  | Yes (`view.addEffect`/`delete`, wave 1)      | Kept                                                  |
| Cloud coverage     | `atmosphereStore`                   | Yes (`handle.update`, wave 1)                | Kept; now disabled with the Clouds toggle             |
| Aerial Perspective | `renderDebugStore`                  | **No**                                       | **Wired** to the photoreal `aerialPerspective` handle |
| Lens Flare         | `atmosphereStore`                   | **No**                                       | **Wired** to the photoreal `lensFlare` handle         |
| Google 3D Tiles    | `tilesStore`                        | Yes (wave 1)                                 | Kept                                                  |
| Basemap            | `basemapStore`                      | Yes (wave 1)                                 | Kept                                                  |
| Sun Shadows        | `renderDebugStore`                  | **No**                                       | **Wired** to `sun.update({ sun: { castShadow } })`    |
| City Shadows       | `renderDebugStore`                  | **No**                                       | **Deleted** (see below)                               |
| Double Sided       | `renderDebugStore`                  | **No**                                       | **Deleted**                                           |
| City Material      | `renderDebugStore`                  | **No**                                       | **Deleted**                                           |
| — (new)            | `renderDebugStore.exposure`         | —                                            | **Added**, drives `view.toneMappingExposure`          |
| — (new)            | `renderDebugStore.ambientIntensity` | —                                            | **Added**, drives `view.addLight({ ambient })`        |

So of eleven controls, four reached the engine and seven did not.

### The missing seam

`DefaultPlugin.addDefaultPhotorealScene()` **returns** handles for `sky`,
`stars`, `skyLightProbe`, `sun`, `aerialPerspective`, `lensFlare`,
`toneMapping` and `antialiasing`. `NavaraViewport` threw them away
(`afterInit: () => void defaultPlugin.addDefaultPhotorealScene()`), so after
init the app had no reference to anything the default scene had built and could
only add _new_ effects — which is exactly why "Clouds" (an `addEffect` of its
own) was the one visual toggle that worked.

The handles are captured now. The post chain is driven through
`BaseHandle.visible`, which maps onto the `postprocessing` pass's own enable
flag (`Pass.visible` in `@navaramap/three`), and the sun through its own config
update. Deliberate asymmetries, both documented in the source:

- **Sun shadows use `sun.update({ sun: { castShadow } })`, never `visible`** —
  hiding the light would take the scene's only key light with it.
- **Tone mapping is NOT part of the "Post Processing" master.** It is what maps
  HDR radiance to display range; hiding it blows the frame to white rather than
  showing what the other passes contribute.

### The three deletions (disclosed)

`cityShadowsEnabled`, `cityDoubleSided` and `cityMaterialMode` describe the city
mesh's `MeshStandardMaterial` — `castShadow`/`receiveShadow`, `side`, and
standard-vs-basic. That material is constructed in
`packages/cityjson-navara-plugins/.../cityModelMesh.ts` and `cityMesh.ts`, and
`CityModelHandle` (the app's whole contract with it) exposes no material
surface at all. Wiring them means either a submodule API change — out of scope
for this pass, and the brief expected no submodule changes — or reaching into
another package's `object3d` from the app, which is worse than not having the
toggle. They are deleted, and `renderDebugStore.ts` carries the reasoning so
nobody re-adds them as booleans.

### Evidence (real engine, CDP)

`window.__multiroofRenderDebug` (the dev-only store handle) drives the store;
every assertion below is a **pixel** measurement of the resulting frame, because
the store was never the thing in doubt.

| Toggle                      | Camera        | Pixels changed  | Region                                                                                     | Reversible                         |
| --------------------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| Sun Shadows off → on        | default (top) | 5 887 / 421 200 | bbox `531,218 → 670,284` = exactly the two buildings; their mean luminance 233.79 ↔ 214.78 | yes, pixel-exact (5 887 both ways) |
| Ambient Light 0 → 0.6       | default (top) | 3 490           | bbox `532,218 → 670,280` = the buildings only; mean 221.91 → 226.05 (+4.14)                | yes                                |
| Aerial Perspective off → on | horizon       | 161 804         | whole canvas; mean over the changed pixels 190.45 ↔ 43.74                                  | yes (163 354 back)                 |
| Post Processing off → on    | horizon       | 163 520         | whole canvas                                                                               | yes                                |
| Aerial Perspective off → on | default (top) | **43**          | —                                                                                          | —                                  |

The last row is the honest one: at the default near-top-down fit camera there
is no sky and almost no air column in frame, so the aerial-perspective pass has
nothing to contribute and the toggle is very nearly a no-op _for that view_.
It is unmistakably live at a horizon camera. The ambient light's effect being
confined to the building pixels is likewise correct rather than suspicious: the
raster basemap is drawn unlit, so a light in the scene can only touch the city
meshes.

Panel control inventory read back out of the live DOM after the rebuild:

```
Exposure | Ambient Light | Sun Shadows | Post Processing | Clouds |
Aerial Perspective | Lens Flare | Cloud Coverage | Google 3D Tiles |
advanced-basemap
```

Screenshots: `2026-08-03-w2-advanced-settings-panel.png`,
`2026-08-03-w2-aerial-{off,on}.png`, `2026-08-03-w2-sun-shadows-{off,on}.png`.

### jsdom coverage

`tests/unit/scene/navaraViewport.test.tsx` gained a
`NavaraViewport render settings` suite (8 tests). The mocked
`addDefaultPhotorealScene()` now returns mutable handle objects, and every
assertion reads **engine** state — a handle's `visible`, a `sun.update()` call,
`view.toneMappingExposure`, an `addLight` config. That is the point: the old
panel tests asserted store contents and stayed green through the entire period
the feature was dead.

---

## Issue 2 — the scene was much darker than Navara's samples

### Three causes, in order of size

1. **`view.toneMappingExposure` was never set.** three's default is `1`.
   Navara's own getting-started sets `10`
   (`docs/superpowers/research/2026-08-01-navara-api-report.md` §Bootstrap, and
   the B1 spike used the same value). The atmosphere feeds the tone mapper
   physically-scaled radiance, so at exposure 1 the whole frame sits in the
   bottom of the curve — dim, flat and blue-grey, which is what was reported.
2. **No ambient term.** `addDefaultPhotorealScene()` supplies a
   `skyLightProbe`, which is _directional_ sky irradiance; a surface facing away
   from both sun and sky still falls to near-black. Navara's own
   basic-visualization snippet adds `view.addLight({ ambient: {} })` for exactly
   this — see `docs/superpowers/research/2026-08-01-navara-api-report.md`
   §Bootstrap, the same section the exposure value comes from, which also lists
   `ambient` among the default light descriptor keys
   (`sun, ambient, skyLightProbe, lightProbe`). Added at intensity 0.6,
   slider-controlled, and genuinely removed at 0 rather than set to zero
   intensity.
3. **The scene clock started at `new Date()`.** The engine's atmosphere follows
   `solarStore.datetime`, so opening the viewer in the evening rendered a night
   scene. The M7.5 browser smoke already tripped over this and shifted the
   page's `Date` to take its screenshots (spike findings §M7.5, finding 6) —
   that was a workaround for a real first-run defect. The default is now
   today at **12:00 UTC**.

### Quantitative before/after

Same session, same fixture (`fixtures/two-buildings.city.json`), same camera,
same OSM basemap, canvas rect `240,44 720×585`, Rec.709 luma over sRGB 8-bit.
Both states were held for 10 s and screenshotted **twice**; each pair differs by
**0 pixels**, so the delta below is the settings and not tile loading.

| State                                                | mean luminance | darkest pixel |
| ---------------------------------------------------- | -------------- | ------------- |
| **Before** — `exposure 1`, no ambient (what shipped) | **189.51**     | 54.6          |
| **After** — `exposure 10`, ambient 0.6               | **240.49**     | 101.4         |
| After, re-applied later in the same session          | 239.20         | 101.4         |

**Δ mean luminance = +50.98 (+26.9 %)**, and the darkest pixel in the canvas
nearly doubles (54.6 → 101.4) — the shadows lift, which is the specific
complaint.

`2026-08-03-brightness-before.png` / `2026-08-03-brightness-after.png`.

Monotonic exposure sweep on a second (horizon) camera, for the record:
`e=1` 115.6 → `e=2` 131.1 → `e=3` 138.6 → `e=5` 147.1 → `e=10` 157.0.

Ambient on its own: `2026-08-03-brightness-ambient-{off,on}.png`, 3 490 pixels,
all of them the buildings, +4.14 mean.

### The clock, measured rather than argued

A second run with the page's `Date` shifted +10 h (`CLOCK_OFFSET_MS`), i.e. a
user opening the viewer at **22:27 UTC / 00:27 local**:

| Scene clock                                                                             | Sun readout                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------- |
| **New default** — 2026-08-03 14:00 local (12:00 UTC)                                    | **Altitude 55.3°, S (185°), above horizon**  |
| **Old default** — the wall clock, via the toolbar's own "Now" button → 2026-08-04 00:27 | **Altitude −18.5°, N (340°), below horizon** |

−18.5° is astronomical night. That is what the previous default handed a user
who opened the app in the evening.
`2026-08-03-brightness-clock-{default-noon,wall-night}.png`.

Note the frame's _mean_ luminance barely moves between those two (239.78 vs
239.65): the OSM raster basemap is drawn unlit and dominates this camera, so
only the 33.8 k pixels of buildings, sky and the toolbar clock actually change.
The sun-altitude readout is the load-bearing measurement here, not the mean.

---

## Issue 3 — the right-pane Solar tab is gone

The previous wave moved the clock into the header and left the tab holding a
nine-button preset grid, a read-only altitude/azimuth readout, and a note saying
where the clock had gone. A tab of the **selection** inspector whose content is
scene-wide state, one third of which is a signpost to somewhere else.

- `src/ui/inspector/SolarTab.tsx` deleted; `InspectorPanel`'s `Tab` union, tab
  strip and render branch with it.
- `src/ui/toolbar/SolarPresetMenu.tsx` added: a popover off the solar cluster
  holding the same preset grid, the same "Now", and the sun readout. Dismisses
  on Escape and on an outside click; stays open on an inside click.
- The readout no longer vanishes when there is no site — it says
  "Load a model to read the sun" instead of rendering an empty section.
- Dead CSS removed this time: `.solar-control-row`, `.solar-slider` (the
  advanced panel had already stopped using them when its sliders were renamed)
  and `.inspector-note`, whose only consumer was the tab's signpost.

### Evidence

- Inspector tab strip read from the live DOM: `Object,Surfaces,Analysis,Rules,Stats`.
- Popover content read from the live DOM:
  `PRESETS | Summer Morning … Winter Evening | Now | SUN POSITION | Altitude | 55.3° | Azimuth | S (185°) | Status | Above horizon`.
- Clicking **Winter Morning** moved the scene clock to `2026-12-21 09:00` and
  the engine's sun to `Altitude 0.5°, SE (131°)` — so the preset really reaches
  the atmosphere, not just the store.
  `2026-08-03-w2-solar-popover.png`, `2026-08-03-w2-solar-preset-winter-morning.png`.
- `tests/unit/ui/toolbar/SolarPresetMenu.test.tsx` (8 tests) plus an
  `offers no Solar tab` assertion pinning the exact tab list.

---

## Verification method (wave 2)

- Raw CDP driver (`scratchpad/c26-cdp.mjs` from wave 1), Playwright Chromium
  1228, `--headless=new --no-sandbox --enable-unsafe-swiftshader`, 1280×800,
  DPR 1, against `npm run dev` on `localhost:5175`. `agent-browser` still cannot
  drive pages on this host.
- Four sessions: toggle sweep + UI inventory; exposure ladder at a horizon
  camera; the stable brightness A/B; the `+10 h` clock session.
- Luminance and pixel-diff statistics computed from the PNGs with a small
  decoder (`scratchpad/lum.mjs`, `scratchpad/diffbox.mjs`) — Rec.709 luma,
  per-channel diff threshold 3/255, plus a bounding box of the changed pixels.
- **Zero page errors and zero console errors** across every session
  (`window.__errors` empty; only the known DuckDB-extension and
  missing-Google-key warnings).

## Known limits / follow-ups (wave 2)

- **Exposure 10 is Navara's number, not a measured optimum for this content.**
  On this fixture at noon the city meshes read pale (roof pixels around 222–226
  of 255) — brighter than before, but close to the top of the curve. Navara's
  samples pair exposure 10 with photoreal terrain, whereas this app drapes an
  unlit OSM raster that the same exposure multiplies straight through. The
  slider now exists precisely so this can be judged on real hardware; SwiftShader
  posterises, so this host cannot settle it. **Re-check on a GPU before treating
  10 as final.**
- **Aerial Perspective is nearly inert at the default fit camera** (43 pixels).
  Not a bug — there is no air column in frame — but a user toggling it from the
  default view will see nothing. Worth a tooltip if it is ever reported.
- **Sun Shadows off makes the buildings _darker_ on this host** (233.79 →
  214.78 over the affected pixels), which is the opposite of the naive
  expectation. Reproducible and exactly reversible, so the wiring is right; the
  cause is inside `SunLightDesc`'s CSM path and was not chased.
- **The render settings are not persisted.** Exposure, ambient and the toggles
  are not in the snapshot/share schema (v3), so a restored workspace comes back
  on the defaults. Same reasoning as the basemap in wave 1: adding them is a
  schema bump.
- **Midday UTC is a compromise.** It guarantees daylight across Europe, Africa
  and the Americas — the project's reference site is Delft — but a user in
  Japan opening the viewer at local noon still gets a scene clock nine hours
  behind them. "Now" is one click away in the toolbar.

---

## Wave 2 fix round (2026-08-03, after "approved with findings")

| Finding                                     | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. "Reset Rendering" placement incoherent   | Moved out of the Backdrop section into a panel **footer** (its own row, above the scroll boundary), relabelled **"Reset render settings"**, and **widened** to reset `atmosphereStore` as well as `renderDebugStore` — lens flare and cloud coverage live there for purely historical reasons and are two of the controls the button now spans. The backdrop is deliberately still untouched (a basemap is what you look AT, not how it is rendered) and the button's `title` says so. `atmosphereStore` gained `DEFAULT_ATMOSPHERE_STATE` + `reset` to match its sibling. |
| 2. Stale `SolarTab` doc references          | `src/scene/sunWriter.ts` and `tests/unit/scene/navaraViewportSolar.test.tsx` now name the toolbar's `SolarPresetMenu`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3. `afterInit` lacked the `cancelled` guard | `photorealRef.current` is only published when the queued init body is still live, like every other write out of it. Without it a late-resolving `session.ready` could install a dead session's handles — under StrictMode, over the live view's.                                                                                                                                                                                                                                                                                                                           |
| 4. `SolarPresetMenu` focus management       | Focus moves to the first control in the dialog on open and returns to the trigger on Escape; `aria-modal="true"` on the dialog and `aria-haspopup="dialog"` on the trigger.                                                                                                                                                                                                                                                                                                                                                                                                |
| 5. Missing dispose-lifecycle test           | `stops pushing settings once the engine is gone`: unmount, then flip four render-debug fields — no `sun.update`, no `addLight`/`update`, `toneMappingExposure` unchanged, handles untouched.                                                                                                                                                                                                                                                                                                                                                                               |
| Ambient-light claim uncited                 | Issue 2, cause 2 now cites `2026-08-01-navara-api-report.md` §Bootstrap (the `view.addLight({ ambient: {} })` snippet, and the `sun, ambient, skyLightProbe, lightProbe` key list).                                                                                                                                                                                                                                                                                                                                                                                        |

Test count after the round: **57 files / 689 tests**, all passing (four new
tests: two focus/ARIA on the popover, one backdrop-survives on the panel, one
dispose-lifecycle on the viewport; the old "atmosphere survives the reset"
assertion was rewritten in place into "both stores reset", per the widened
scope, so the total rises by four rather than five).
`npx tsc -b --noEmit` clean, `npm run build` exit 0, `npx vp check` 0 errors /
9 warnings.

Re-verified in the real browser after the round (same CDP driver, dev server,
`fixtures/two-buildings.city.json`):

- Footer action reads `Reset render settings`, `insideBody: false` (it is
  outside `.advanced-settings-body`, so it cannot scroll into a section), and
  its title is "Restore the default lighting and post-processing settings. The
  basemap and Google 3D Tiles choices are left alone."
- Every knob dirtied (`exposure 2`, ambient 0, all four switches off) then
  reset: store back to defaults, and the panel reads `Exposure 10.0`,
  `Ambient Light 0.60`, Lens Flare checked, `Cloud Coverage 30%` — while
  `basemap` stays `osm` and Google 3D Tiles stays on. Screenshot
  `2026-08-03-w2-panel-footer-reset.png`.
- Popover: opening moves focus to `Summer Morning`, the dialog reports
  `aria-modal="true"` and the trigger `aria-haspopup="dialog"`; Escape closes it
  and focus returns to `Solar presets`.
- `window.__errors` empty — no page errors.

---

## Wave 3 (2026-08-05) — "FlatCityBuf doesn't load when I move the camera"

User report, verbatim: _"FlatCityBuf doesn't load when I move the camera. Only
when I switch LoD, it loads once."_

### Diagnosis — three prime suspects, all disproved by trace

The obvious reading is that the camera never tells the streaming driver
anything. `settleController` commits on `moveend`, and B1 §5 had **never
traced a wheel zoom** (its own §8 says so), so a silent wheel would have
explained the symptom exactly. It was traced, on the real app, with the raw CDP
driver (Playwright Chromium 1228, `--headless=new --no-sandbox
--enable-unsafe-swiftshader`, 1280×800, `fixtures/delft.fcb` through the file
input, post-processing/clouds/aerial/shadows off to lift the host from ~1 fps to
~5 fps). Temporary instrumentation logged every camera event with the
controller's internal `holds`/`armed`/`inBurst`, every `commitAll`, every
`planCommit` outcome and every fetch outcome.

| Suspect                                                 | Verdict                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Wheel zoom emits no `movestart`/`moveend`**        | **FALSE.** A wheel notch emits a COMPLETE `movestart … move … moveend` burst, one per notch, ~250 ms apart. Recorded as `WHEEL_BURST_SHAPE` in B1 §5(e).   |
| **B. A suppression hold leaks and gates every gesture** | **FALSE.** `holds` was `0` on every one of the ~120 camera events traced, across the auto-fit, three gestures and a `setCamera`.                           |
| **C. `attach()` bound the wrong event source**          | **FALSE.** A second listener registered independently on `view.camera` saw exactly the events the controller saw; `COMMIT-ALL` fired on wheel AND on drag. |

The settle machine is **not** the bug, and the "arm on `move`/`frustumChanged`
too" change that was proposed for it would have been a regression — arming on
`move` re-introduces exactly the mid-drag commit §5(a) exists to prevent.

### Root cause — the level-swap deadline livelocks the layer

The commit fires; it then dies downstream, in `FcbStreamLayerHandle.commit`.
Traced, on a wheel zoom, from a layer that had just finished its auto-fit load:

```
COMMIT-ALL  layers:1
SWAP-WHY    levelChanged:false  lodChanged:TRUE
            lod {"kind":"exact","lod":"1.2"}   prevLod {"kind":"all"}
            ladder "0|1.2|1.3|2.2"  cellSizeM 400  level 2  prevLevel 2
PLAN        kind:"commit"  isSwap:TRUE  toFetch:16  desired:16  probeCount:1077
FETCH-DONE  outcome:"timeout"  fetched:0  raced:true
-> status "error" / "Level swap timed out; kept the previous level"
-> handle.version stays 1, triangleCount stays 217777 — NOTHING loaded
```

Three facts compose into a permanent stall:

1. **A layer's second commit is ALWAYS a swap.** The first commit runs with an
   empty ladder, so `resolveLod` returns `{kind:"all"}` and that is recorded as
   the previous LoD; the ladder is only LEARNED from the `lodsSeen` of the cells
   that first commit returns. From the second commit on the same camera resolves
   to an exact label, so `lodChanged` is true and `planCommit` calls it a swap.
2. **A full-cover swap is not a 1500 ms operation.** The measured one is 16
   cells / 1077 features of `delft.fcb`.
3. **The timeout path returned before recording anything.** `_lastLod`,
   `_level` and `_lastCommit` are written only at the end of a _successful_
   commit, so the next settle recomputed the identical doomed swap. Every
   camera-driven commit from then on died on the deadline: the layer
   **livelocked**.

That is the whole report. The LoD half too: `onLodChanged` is the one path that
forces a commit whose cover the worker has usually already decoded, so it can
beat the deadline, succeed, and finally write `_lastLod` — the layer "loads
once" and then sticks again at the next level change.

`CLAUDE.md` had this half-recorded as a tuning note ("on a SwiftShader host the
first post-fit commit blows the deadline **and recovers on the next settle**").
It does not recover. There is no next settle that differs.

### Fix

**The swap deadline is removed** (`LEVEL_SWAP_TIMEOUT_MS`, its `Promise.race`,
its cancel/evict/rollback branch and its error status). It could not be repaired
by tuning:

- Its failure mode, "keep the previous level", was **visually identical to
  simply waiting** — `commitSwap` runs only after the fetch resolves, so the old
  level is on screen for the duration either way. The deadline bought nothing
  and cost convergence.
- Cancellation was never its job anyway: `abortInFlight()` fires on the first
  camera event of the next gesture, bumps the worker epoch, and makes the
  in-flight result both cancelled at the worker and unadoptable here
  (`isStale`). That is the mechanism built for "the user has moved on", and it
  is untouched.

One adjacent defect found while verifying the LoD half in the browser and fixed
with it: a streaming layer's **manual** LoD `<select>` was reading
`Layer.availableLods`, which is derived from `Layer.model` — an empty stub for a
streaming layer — so it offered `All` and nothing else, i.e. a manual mode with
no LoD to pin. It now reads `streamStore.ladder`, the same learned list the Auto
read-out beside it already used.

### Tests

- `navara-flatcitybuf/tests/streamLayer.test.ts` — _"a swap fetch slower than
  the retired 1500 ms deadline still commits, so the layer cannot livelock"_:
  commit 1 fetches under `lod: null`, the ladder is learned, commit 2 is the
  swap and is delayed to 1900 ms; it must fetch under `"1.2"`, be adopted, and
  **converge** (commit 3 from the same camera is an ordinary hysteresis skip,
  not a third doomed swap). Verified to FAIL against the pre-fix source
  (`1 failed | 36 passed`) and pass after.
- Same file — _"a slow FIRST fetch still commits"_, the M7.5 auto-fit case, kept.
- `navara-flatcitybuf/tests/settleController.test.ts` — _"commits ONCE for a
  multi-notch wheel zoom, after the last notch"_, pinning the newly measured
  burst shape: four notches, each a full burst 250 ms apart, produce exactly one
  `onSettle` and one `onFirstChange`.
- `tests/unit/ui/sidebar/LodSelector.test.tsx` — _"offers the LEARNED ladder,
  not the layer store's empty availableLods"_.

### Browser verification (post-fix, same driver and fixture)

| Step                          | `handle.version` | resident                | outcome                                                            |
| ----------------------------- | ---------------- | ----------------------- | ------------------------------------------------------------------ |
| auto-fit settle               | 1                | 16 cells / 217 777 tris | baseline (fetched under `lod: all`)                                |
| **wheel zoom, 4 notches**     | **1 → 2**        | 16 cells / 39 152 tris  | swap completed, `status idle`, no error — used to be `error`       |
| **drag-pan**                  | **2 → 3**        | 12 cells / level 3      | new cover fetched (`Objects 2155 → 846`, the pan leaves the file)  |
| **LoD switch to 2.2 (UI)**    | **1 → 2**        | 217 777 → 109 073 tris  | manual select now offers `0 / 1.2 / 1.3 / 2.2`                     |
| **`setCamera` restore (C20)** | **3 → 3**        | unchanged               | only `view:idle` emitted, **no commit** — the property still holds |
| **wheel zoom after restore**  | **3 → 4**        | level 2 / 36 048 tris   | organic movement still commits after a programmatic one            |

Zero page errors and zero console exceptions across every session (only the
host's known `favicon.ico`, DuckDB-extension and missing-Google-key noise).
Screenshots: `docs/superpowers/research/assets/2026-08-05-fcb-camera-0{1..5}-*.png`.

### Known limits / follow-ups (wave 3)

- **A layer still fetches its first cover twice.** Commit 1 has no ladder, so it
  pulls every LoD (217 777 triangles for 1077 features — every LoD stacked, and
  visibly so); commit 2 swaps to the resolved label. The FCB header carries no
  LoD list, so the ladder can only be learned from cells. Seeding it from a
  cheap first probe would remove both the wasted fetch and the stacked-LoD first
  frame; it is a worker-protocol change and was left out of this fix.
- **`SETTLE_MS = 350` vs `idleThreshold = 100`.** `idle` flushes an armed
  debounce, so on fast hardware a commit can start ~100 ms after `moveend`,
  while the engine may still emit a trailing `move` — which reopens a burst and
  calls `abortInFlight()` on the commit that just started. It self-corrects (the
  following `moveend` re-arms), and it was not observed on this host, but it is
  the next thing to look at if "sometimes needs a second nudge" is ever reported.
- **Frame rate still not representative.** Every measurement here is from a
  GPU-less SwiftShader host at ~5 fps. The shapes measured (burst structure, swap
  livelock, restore-no-commit) are frame-rate independent; the timings are not.
