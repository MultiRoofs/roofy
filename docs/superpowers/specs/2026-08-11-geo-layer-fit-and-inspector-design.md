# Geo-layer fit-to-layer button + inspector-hosted config — Design

Date: 2026-08-11
Status: Approved (brainstormed and approved in-session)

## Problem

Two UX gaps in the recently added geospatial layer support (Milestone 10):

1. **No zoom-to-layer.** City layers have a crosshair "Zoom to layer" button in their
   `LayerPanel` row (`onFlyToLayer` → `CitySceneHandle.fitLayer`). Geo layers have no
   equivalent, and no bounds exist anywhere for them: the store records carry no extent,
   and Navara 0.0.5 exposes no `getBounds`/`fitBounds` on `Layer`/`Source`.
2. **Wrong home for style config.** Geo layer style (color, point size, line width, fill
   opacity) is edited inline in the `GeoLayerRow` via a `<details>` block, while the
   city-layer mental model is: click a layer row → the selection-driven **right
   InspectorPanel** shows that layer's config/info. Geo rows are deliberately
   non-clickable today (`app.css` comment: "there is no 'active' geospatial layer").

## Decisions made with the user

- Geo layer config/info + style controls move to the **right InspectorPanel**, driven by
  a new active-geo-layer selection. The Style block leaves the row.
- Zoom-to-layer covers **GeoJSON and 3D Tiles**. Raster-xyz gets no button — an XYZ tile
  template carries no intrinsic extent.

## Feature A: Zoom-to-layer for geo layers

### Extent resolution (engine-free)

New module `src/features/geoLayers/geoLayerBounds.ts` (no `@navaramap/*` imports,
Node-testable):

- `geoJsonBounds(data: unknown): GeodeticBounds | null` — walks
  Feature / FeatureCollection / bare geometry coordinate arrays (Point, MultiPoint,
  LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection), unions
  lng/lat. `minHeight`/`maxHeight` are 0 (coordinate z is ignored — `cameraForBounds`
  tolerates flat bounds). Returns `null` for empty/invalid input. Antimeridian-crossing
  data produces a naive min/max box — documented limitation, out of scope.
- `tilesetBounds(tileset: unknown): GeodeticBounds | null` — reads the root
  `boundingVolume` of a 3D Tiles `tileset.json`:
  - `region`: `[west, south, east, north, minH, maxH]` in radians → degrees, heights
    kept.
  - `box` / `sphere`: ECEF center → geodetic (small self-contained WGS84 conversion in
    this module), expanded by the volume's radius (sphere radius, or half-diagonal of
    the box) converted to degrees via metres-per-degree at that latitude.
- `resolveGeoLayerBounds(layer: GeoLayer, fetchFn?: typeof fetch): Promise<GeodeticBounds | null>` —
  - geojson with inline `data`: synchronous `geoJsonBounds`.
  - geojson with `url`: fetch the URL, parse JSON, `geoJsonBounds`.
  - 3d-tiles: fetch `config.url` (the tileset.json), `tilesetBounds`.
  - raster-xyz: resolves `null` by contract.
  - Network results are cached in a module-level `Map<string, Promise<GeodeticBounds | null>>`
    keyed by URL; a rejected/`null` resolution is NOT cached (retry on next click).
  - `fetchFn` is an injected seam for tests; defaults to global `fetch`.

`GeodeticBounds` is imported from `@cityjson/navara-cityjson` (engine-free type, already
used by `src/scene/geographicCamera.ts`).

### Camera primitive

`CitySceneHandle` (src/scene/NavaraViewport.tsx) gains:

```ts
fitBounds: (bounds: GeodeticBounds) => void;
```

Implementation mirrors `fitLayer`: guard on view + finite bounds, then
`withSettleSuppressed(() => view.flyTo(framedForMode(bounds)))`. No geo knowledge inside
the viewport. The three app-test scene-handle stubs
(`appEngineBoot.test.tsx`, `appCityParquetLayers.test.tsx`, `appRestoreShare.test.tsx`)
gain the method. CLAUDE.md's `CitySceneHandle` surface list is updated.

### Wiring + UI

- `App.tsx`: `handleFlyToGeoLayer(id)` — look the layer up in `useGeoLayerStore`,
  `await resolveGeoLayerBounds(layer)`, then `sceneRef.current?.fitBounds(bounds)`;
  on `null`/rejection show the existing toast with
  "Could not determine the layer's extent".
- `LayerPanel` → `GeoLayerRow` thread `onFlyToGeoLayer?: (id: string) => void`.
- `GeoLayerRow` renders the same crosshair button as city rows, only for
  `kind === "geojson" | "3d-tiles"`. The inline SVG in the city row is extracted into a
  shared `ZoomToLayerIcon` component in `src/ui/layers/` (alongside `TrashIcon`,
  `VisibilityIcon`) and both call sites use it.

## Feature B: Geo layer config in the InspectorPanel

### Active-geo-layer state

`src/features/geoLayers/geoLayerStore.ts` gains (mirroring `layerStore.activeLayerId`):

- `readonly activeGeoLayerId: string | null` (initial `null`).
- `setActiveGeoLayer(id: string | null)`.
- `removeGeoLayer` clears it if the removed layer was active (no repoint — geo has no
  "always one active" invariant); `removeAllGeoLayers` clears it.
- NOT persisted (matches city behavior; `restoreSnapshot` untouched).

Mutual exclusivity is coordinated at the interaction sites, not in the stores:

- Clicking a geo row: `setActiveGeoLayer(id)` **and** leaves `layerStore.activeLayerId`
  alone (it keeps its city fallback role).
- Clicking a city row: `setActiveLayer(id)` **and** `setActiveGeoLayer(null)`.
- Picking a geo feature in the viewport already writes
  `selectionStore.geoSelection`; the same App-side path additionally calls
  `setActiveGeoLayer(geoLayerId)` so the inspector follows viewport picks. Picking a
  city object clears `geoSelection` already (selection store mutual exclusivity); the
  pick path also clears the active geo layer.

### InspectorPanel geo mode

When `activeGeoLayerId` resolves to a live geo layer, `InspectorPanel` renders a new
`GeoLayerInspector` body **instead of** the city tab strip + tab body. New component
`src/ui/inspector/GeoLayerInspector.tsx`:

- **Info**: layer name, kind badge (reuse `KIND_BADGE`/`KIND_LABEL` — exported from
  `GeoLayerRow` or moved to a small shared module), source line (`sourceOf` equivalent).
- **Opacity** slider (geojson + raster-xyz, as today).
- **Style** controls for geojson only: color, point size, line width, fill opacity —
  the exact controls that today live in `GeoLayerRow`'s `<details>` block, including the
  `colorInputValue` shorthand-hex expansion and the empty-string mid-edit guards.
  All writes go through `updateGeoLayer(id, { style: { ...style, ...patch } })`
  (fresh whole style object, as today).
- 3d-tiles shows info only.

When no geo layer is active, the inspector behaves exactly as today.

### GeoLayerRow slims down

The row keeps: visibility toggle, rename, kind badge, **zoom button (new)**, remove,
and the re-link block. It loses: the `<details>` Style block and the opacity slider
(both now inspector-hosted). The row becomes clickable (`setActiveGeoLayer(layer.id)`),
gets an active-highlight class following the `.layer-active` pattern, and the
`app.css` comment declaring geo rows non-clickable is replaced.

## Persistence

No schema change. `GeoLayerSnapshot.style` (v3, optional) already round-trips. Active
ids (city and geo alike) are not persisted.

## Testing strategy (TDD — red, green, refactor per unit)

- `tests/unit/features/geoLayers/geoLayerBounds.test.ts` — geometry walking across all
  GeoJSON types, invalid/empty → null, tileset region/box/sphere, resolver with injected
  fetch (per-kind routing, URL caching, no-cache-on-failure, raster → null).
- `tests/unit/scene/navaraViewport.test.tsx` — `fitBounds` routes through
  `flyTo` + settle suppression; ignores calls with no view.
- `tests/unit/features/geoLayers/geoLayerStore.test.ts` — active-id lifecycle
  (set, clear on remove/removeAll, unaffected by unrelated updates).
- `tests/unit/ui/layers/LayerPanelSections.test.tsx` — zoom button present for
  geojson/3d-tiles rows and absent for raster; geo row click activates the layer; city
  row click deactivates geo; style controls and opacity slider are GONE from the row.
  (The existing row style-control tests migrate to the new inspector test file.)
- `tests/unit/ui/inspector/GeoLayerInspector.test.tsx` — geo mode rendering per kind,
  style edits write fresh style objects, opacity edits, mid-edit empty guard, shorthand
  hex expansion.
- `tests/unit/ui/inspector/InspectorPanel.test.tsx` — panel switches to geo mode when a
  geo layer is active and back when cleared.
- App handle stubs updated with `fitBounds`.

## Out of scope (deliberate)

- Antimeridian-crossing GeoJSON extents (naive min/max box).
- User-entered bounds for raster-xyz layers.
- Persisting active layer ids.
- Geo layer rules/theming (phase E deferral stands).
- Streaming/partial GeoJSON fetch — the fit fetch reads the whole file, same as the
  engine already does to draw it.

## Docs to update

- `CLAUDE.md`: `CitySceneHandle` surface list; the "Geospatial layers are the MIRROR
  IMAGE" paragraph (styling now inspector-hosted, active geo layer exists, zoom button).
- `docs/roadmap.md` if it tracks Milestone 10 follow-ups.
