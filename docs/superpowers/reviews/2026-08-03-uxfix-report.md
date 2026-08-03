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

  | id               | label              | source                                                                                          | maxZoom | attribution                           |
  | ---------------- | ------------------ | ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------- |
  | `none`           | None               | —                                                                                               | —       | —                                     |
  | `osm`            | OpenStreetMap      | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`                                                | 19      | © OpenStreetMap contributors          |
  | `esri-imagery`   | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 19      | © Esri                                |
  | `carto-positron` | CartoDB Positron   | `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`                                       | 19      | © CARTO, © OpenStreetMap contributors |

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
  lines remain unconditional.

### Evidence

- **218 OSM tile responses, all HTTP 200**, issued from the engine's tile
  worker (the main thread's `performance.getEntriesByType("resource")` sees
  none of them — CDP `Network` with `Target.setAutoAttach` does). Zoom levels 0
  through 18 were fetched.
- Switching options: **154 Esri/CARTO tile responses, all 200**; the overlay
  text changed in lockstep —
  `© OpenStreetMap contributors…` → `© Esri…` → `© CARTO© OpenStreetMap contributors…`
  → (None) only the geoid lines.
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
- **The basemap selection is not persisted.** It is not in the snapshot/share
  schema (v3), so a restored workspace comes back on the default. Adding it
  means a schema bump, which is out of scope for a defect pass.
- **No terrain layer.** The basemap drapes on the ellipsoid; there is no
  `raster-dem`/`quantized-mesh` terrain, so the ground is flat. That is
  unchanged from before this pass and is a separate feature.
- **Google tiles and the basemap are independent.** Both can be on; the tiles
  cover the basemap where they have coverage, which is why "None" is offered.
