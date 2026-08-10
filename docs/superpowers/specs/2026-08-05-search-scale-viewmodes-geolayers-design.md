# Address search, scale bar, view modes, geospatial layers — design

**Date:** 2026-08-05
**Status:** approved for implementation (commander/executor; nothing committed until the user reviews)

Four features, two executor waves. Wave 1: address search + scale bar + view modes (header/camera
cluster). Wave 2: multi-format geospatial layers (layers cluster). Split because both waves touch
`NavaraViewport.tsx` and the toolbar/panel files — parallel executors would collide.

Engine facts these designs rest on (audited against the installed 0.0.5 `.d.ts`):

- No native scene mode, no orthographic camera, no pitch clamp. The controller knob is
  `view.camera.options = { enableSpin?, enableTilt?, enableZoom?, ... }` (all-optional partial).
- `view.flyTo(cameraPosition, durationMs?)` animates and emits the full
  `movestart..moveend` chain; `view.setCamera(...)` is instant and emits **nothing**.
- `camera.zoom` is the fractional Web-Mercator zoom, computed engine-side from ellipsoid height,
  FOV and viewport — the intended scale input. `camera.positionGeographic` throws before the
  first rendered frame (already handled in `getCameraState`).
- Sources/layers are core API (no plugin): `geojson`, `raster-tile`, `3d-tiles` sources with
  `vector`, `raster`, `3d-tiles` layers. `Layer.update()` REPLACES the whole description;
  `Source.update()` merges; `Source.delete()` is refcounted (layer first, then source —
  `removeSourceLayer` + `discardOrphanSource` in `NavaraViewport.tsx` already encode this).
- No engine geocoder. No WMS/WMTS/KML/CZML/COG/TileJSON in core.

---

## 1. Address search (wave 1)

**Provider: Photon (`https://photon.komoot.io/api/?q=…&limit=6&lang=en`), not raw Nominatim.**
The public Nominatim usage policy explicitly forbids auto-complete; Photon is OSM-based, keyless,
and built for search-as-you-type. The result is GeoJSON `FeatureCollection` with
`geometry.coordinates [lng, lat]`, `properties.{name, city, state, country, osm_key, osm_value,
extent?}` (`extent` = `[minLng, maxLat, maxLng, minLat]`).

- `src/features/geocode/photon.ts` (engine-free): `searchAddresses(query, signal): Promise<GeocodeResult[]>`
  with `GeocodeResult = { label, lng, lat, extent? }`; label composed from
  name/city/state/country, deduped. Empty query → `[]` without a request.
- `src/features/geocode/useAddressSearch.ts`: debounce 300 ms, minimum 3 characters,
  `AbortController` cancels the in-flight request on every keystroke (stale responses must never
  overwrite fresher ones), tracks `{results, loading, error}`.
- **UI** `src/ui/toolbar/AddressSearch.tsx`: a search box in the header (left of the sun
  control): magnifier icon collapsed → expands to an input; dropdown listbox of results;
  keyboard: ArrowUp/Down + Enter select, Escape closes; click-outside closes. Proper combobox
  ARIA (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox"/"option"`).
- **On select:** fly the camera. `CitySceneHandle` gains
  `flyTo(target: { lng, lat, heightM }, durationMs?)` implemented with `view.flyTo` (animated —
  emits camera events, so streaming commits and the pose readout react for free). Height: if the
  result has an `extent`, height ≈ its diagonal in metres (via `boundsDiagonalMetres`-style
  maths in `geographicCamera.ts`, clamped to [400 m, 50 km]); otherwise 1500 m. Pitch −60°,
  heading 0 — except in 2D mode where the current mode pins pitch (see §3; just fly lng/lat and
  let the mode's clamp handle orientation).
- **Attribution:** the dropdown footer credits "Search © OpenStreetMap contributors via Photon" —
  data attribution stays inside the search UI, not the map overlay (it applies only while
  searching).
- Failures (offline, 429): inline "Search unavailable" line in the dropdown; never a toast loop.

## 2. Map scale (wave 1)

- Widen the existing camera-pose publisher (`src/scene/cameraPose.ts`, currently
  `{heading, pitch}`) to also carry `lat` and `zoom` (`view.camera.zoom`). Same publish beat
  (`movestart|move|moveend` throttled + `postRender` seed) — no new subscription machinery.
  All consumers of `CameraPose` update (compass already reads heading).
- `src/scene/mapScale.ts` (engine-free, unit-tested): `metresPerPixel(lat, zoom, dpr?)` =
  `156543.03392 * cos(lat°) / 2**zoom`; `pickScaleBar(mpp, maxWidthPx)` returns
  `{ widthPx, label }` choosing the largest 1–2–5·10ⁿ metre length whose bar fits in
  `maxWidthPx` (label in m below 1 km, km at or above).
- `src/ui/viewport/ScaleBar.tsx`: bottom-left above the attribution overlay; a classic bar with
  end ticks + label; `title` notes it is the scale at screen centre (a tilted 3D view has no
  single scale). Hidden when `zoom` is `undefined` (pre-first-frame). Re-renders off
  `useCameraPose` only.

## 3. View modes 2D / 2.5D / 3D (wave 1)

No native mode exists, so a mode is a **camera policy**: controller flags + a one-shot camera
move + the app's own soft pitch clamp (`cameraControls.ts` already implements clamping — the
mode narrows its constants).

- `src/features/viewMode/viewModeStore.ts`: `ViewMode = "2d" | "2.5d" | "3d"`, default `"3d"`,
  action `setViewMode`. Persisted as optional `viewMode` in snapshot v3 (`normalizeLayers`-style
  default on absence).
- Policy table (single source of truth, engine-free module `src/scene/viewModePolicy.ts`):
  - `3d`: `enableSpin: true, enableTilt: true`; pitch clamp = existing MIN/MAX; no camera move.
  - `2.5d`: `enableSpin: true, enableTilt: false`; on entry fly (600 ms) to pitch −60°, keep
    lng/lat/height/heading; clamp pitch to exactly −60° in the app's own tilt controls.
  - `2d`: `enableSpin: false, enableTilt: false`; on entry fly to pitch −89.9° (exact −90°
    breaks heading derivation — `geographicCamera.ts` documents this), heading 0; tilt/rotate
    UI (tilt buttons, compass-reset is idempotent anyway) disabled with a title explaining why.
- `NavaraViewport` applies the policy in an effect on the store value:
  `view.camera.options = { enableSpin, enableTilt }` + the entry move via `view.flyTo`.
  Camera state restored from a snapshot applies BEFORE the mode effect runs its entry move —
  entry move only fires on user-initiated mode _changes_, not on mount with a restored mode
  (guard with a "was mounted" ref).
- **UI** `src/ui/toolbar/ViewModeToggle.tsx`: three-segment control `2D | 2.5D | 3D` in the
  header next to the view-align cluster; `aria-pressed` per segment.
- View-align buttons (T/F/R/Bo/Bk/L) in 2D: only Top stays enabled.

## 4. Geospatial layers + sectioned Layers pane (wave 2)

**Scope v1: GeoJSON (file or URL), raster XYZ tiles (URL template), Cesium 3D Tiles
(tileset.json URL).** All three are core sources — no new engine surface. Explicitly out:
WMS/WMTS/KML/CZML/COG (absent from the engine) and MVT vector tiles (needs per-source-layer
styling UI; the `vector-tile` source exists, so it is a clean follow-up).

- **Store** `src/features/geoLayers/geoLayerStore.ts` (zustand, separate from the city-model
  `layerStore` — different lifecycle: no CityModel, no rules, no LoD):
  `GeoLayer = { id, name, kind: "geojson" | "raster-xyz" | "3d-tiles", visible, opacity,
config }` with per-kind config:
  `geojson`: `{ data?: FeatureCollection, url?: string }` (file loads parse to inline `data`);
  `raster-xyz`: `{ urlTemplate, minZoom?, maxZoom?, tms? }`;
  `3d-tiles`: `{ url }`.
  Actions: `addGeoLayer`, `removeGeoLayer`, `updateGeoLayer` (visible/opacity/name).
- **Scene sync** `src/scene/geoLayerSync.ts` (new module, same memo-reconciler pattern as
  `handleSync.ts`): builds one source+layer pair per GeoLayer via the existing
  `SourceLayerHandles`/`removeSourceLayer`/`discardOrphanSource` helpers (export them from
  `NavaraViewport.tsx` or lift into a small module). Descriptions:
  - geojson → `addSource({type:"geojson", data|url, tiled: true})` +
    `addLayer({type:"vector", source, point: {...}, polyline: {...}, polygon: {...}})` with one
    fixed default style (theme-aware accent colour, `clampToGround: true`, point size 24 px);
  - raster-xyz → `addSource({type:"raster-tile", url, minZoom, maxZoom, tms})` +
    `addLayer({type:"raster", source, raster: { opacity, show }})`;
  - 3d-tiles → `addSource({type:"3d-tiles", url})` + `addLayer({type:"3d-tiles", source,
model: { castShadow: false, receiveShadow: true, maxSse: 16 }})`.
    Visibility/opacity changes go through `Layer.update()` — which REPLACES the description, so
    the sync module always rebuilds the FULL layer description from the store record (never a
    partial patch). Add failures surface as the layer row's error state, not a crash.
- **Layers pane sections** (`LayerPanel.tsx`): two titled sections — **"3D City Models"**
  (existing list, unchanged behaviour) and **"Geospatial Layers"** (new rows: visibility eye,
  name (rename on double-click), kind badge, opacity slider for raster, del). One shared
  "+ Add Layer" button; `AddLayerDialog` gains a second tab "Geospatial": URL field that
  classifies by shape (`{z}`/`{x}`/`{y}` template → raster-xyz; endswith `tileset.json` →
  3d-tiles; else GeoJSON URL) with an explicit kind override select, plus drag-drop/browse
  accepting `.geojson`/`.json` files (parsed, validated to be a Feature/FeatureCollection).
  The existing city-model tab remains the default.
- **Persistence:** snapshot v3 gains optional `geoLayers?: GeoLayerSnapshot[]` (config + name +
  visible + opacity; inline GeoJSON `data` is NOT persisted — too big for localStorage; a
  file-loaded GeoJSON layer restores as an "unavailable" row exactly like city-model file
  layers, re-linkable via the dialog). Share links: omitted, same lightweight-subset convention
  as `hiddenTypes`.
- **Attribution:** user-supplied sources carry no automatic credit; the row's title shows the
  source URL so provenance is inspectable. (Engine `AttributionPlugin` stays unused — the app's
  overlay is the single attribution surface, per CLAUDE.md.)

## Testing

- Wave 1: photon.ts label/dedupe/URL building + abort behaviour (mock fetch);
  useAddressSearch debounce/cancel (fake timers); mapScale unit table (equator/60°N, 1-2-5
  progression, km/m labels); viewModePolicy table; viewModeStore + snapshot round-trip;
  AddressSearch component (type → dropdown → Enter flies via injected handle) and
  ViewModeToggle component tests.
- Wave 2: geoLayerStore actions; classification of URL shapes; geoLayerSync reconciliation
  against a fake view (add/remove/visible/opacity → full-description update); GeoJSON file
  validation; persistence round-trip incl. the not-persisted inline data rule; LayerPanel
  section rendering.
- Browser smoke (commander): search "Delft", pick result, camera lands; scale bar changes with
  zoom and roughly halves per zoom step; 2D locks tilt (drag attempts), 2.5D keeps rotation;
  add an XYZ layer (OSM tile template) + a GeoJSON URL and toggle/opacity them.

## Out of scope

MVT styling UI, WMS/WMTS/KML/CZML/COG adapters, picking/attributes for geo layers, per-geo-layer
attribution management, geocoder provider fallback chain.
