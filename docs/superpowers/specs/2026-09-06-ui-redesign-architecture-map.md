# Roofy / multiroof-viewer — Architecture Map

Repo: `/data2/hideba/multiroof-viewer-redesign`
Branch: `redesign`, at `origin/develop` `5e672cc` ("chore: format parseCityGML with the pinned toolchain").
Stack: React 19 + Zustand 5 + Vite 8 + Vitest 4; renderer = `@navaramap/three` ("Navara") driven through four
workspace plugin packages under `packages/cityjson-navara-plugins/packages/*`
(`navara-core`, `navara-cityjson`, `navara-cityparquet`, `navara-flatcitybuf`).
Analytics = DuckDB-WASM. All paths below are absolute-from-repo-root; every reference is `path:line`.

Top-level source layout:

- `src/app/` — shell (`App.tsx`, `app.css`, `brand.css`)
- `src/features/<domain>/` — Zustand stores + domain logic (no React rendering)
- `src/scene/` — engine seam: `NavaraViewport.tsx` plus pure store→engine reconcilers
- `src/ui/` — all React components (toolbar, sidebar, layers, inspector, table, viewport overlays, stac)
- `src/domain/` — engine-free model/geometry/selection types
- `src/insights/` — DuckDB, per-layer tables, SQL, export, stats
- `src/persistence/` — snapshot capture/restore, localStorage, share URL
- `src/platform/` — browser/download shims

---

## 1. Zustand stores

All stores are plain `create<T>()` (no middleware, no persist, no devtools). None are reset automatically;
tests reset with `useXStore.setState({...})` (see §11).

### 1.1 `src/features/layers/layerStore.ts` — city (CityJSON/CityGML/CityParquet/FCB) layers

Exports:

- `interface Layer` — `src/features/layers/layerStore.ts:17`. Full field list (all `readonly`):
  - `id: string` :18
  - `name: string` :19
  - `model: CityModel` :20 (a **stub** — bbox only, empty objects — for a streaming layer)
  - `modelRef: CityModelReference` :21 (persistence re-link descriptor, see §5)
  - `visible: boolean` :22
  - `rules: ReadonlyArray<Rule>` :23
  - `rulesEnabled: boolean` :24
  - `selectedLod: string | null` :25
  - `availableLods: ReadonlyArray<string>` :26
  - `lodMode: "auto" | "manual"` :37 — **static layers only** since the global streaming-LoD control
  - `cameraSync: boolean` :51 — streaming only; `false` freezes the resident extract
  - `isStreaming: boolean` :56 — the ONLY discriminator for an FCB streaming layer (there is no `kind`/`encoding` field on `Layer`; encoding lives on `modelRef`, §5)
  - `hiddenTypes: ReadonlyArray<string>` :67 — geometry-level type hiding; replaced wholesale (identity is the change test)
  - `visibleObjectIds: ReadonlySet<string> | null` :79 — **session-only**, driven by the table's "Filter map"; empty set ≠ null
  - `availableObjectTypes: ReadonlyArray<string>` :88 — empty for streaming (use `useStreamStore.types`)
  - `appearanceThemes: ReadonlyArray<AppearanceTheme>` :95 — empty for streaming
  - `selectedAppearance: AppearanceTheme | null` :103
- `interface LayerStoreState` :106 — `{ layers: ReadonlyArray<Layer>; activeLayerId: string | null }` (:107, :108)
- `interface LayerStoreActions` :111 — `addLayer` :112 (returns the id; input `Omit<Layer, …>` plus optional `id`/`isStreaming`/`hiddenTypes`/`selectedAppearance`), `removeLayer` :146, `updateLayer(id, patch: Partial<Pick<Layer,"name"|"visible">>)` :147, `setActiveLayer(id: string|null)` :151, `removeAllLayers` :152, `setLayerLod` :153, `setLodMode` :154, `setLayerAppearance` :157, `setCameraSync` :160, `setHiddenTypes` :163, `setVisibleObjectIds` :166, and per-layer rule actions `addRule` :172, `updateRule` :174, `deleteRule` :178, `reorderRules` :179, `toggleRulesEnabled` :180, `clearRules` :181
- `type LayerStore = LayerStoreState & LayerStoreActions` :184
- Pure helpers: `computeAvailableLods(model)` :190, `computeAvailableObjectTypes(model)` :208, `computeAppearanceThemes(model)` :220, `defaultAppearanceTheme(model)` :239
- `export const useLayerStore` :252

No selector hooks are exported — every consumer calls `useLayerStore((s) => …)` inline.

**What "active layer" means today.** `activeLayerId` (`:108`) is a single nullable id on the layer store. It is:

- seeded on the first add and never re-pointed while any layer exists: `activeLayerId: state.activeLayerId ?? id` — `src/features/layers/layerStore.ts:300`
- on remove of the active layer it falls back to the **last** layer in the array, not the neighbour: `:308-312`
- cleared by `removeAllLayers` :322
- set explicitly only by `setActiveLayer` :320

Every read of `activeLayerId` (exhaustive):

- `src/app/App.tsx:247` (subscribe), `:276`/`:279` (stream status/message for the status bar), `:649` (unavailable-layer re-link target), `:694` (effect dep), `:1309` (fallback active layer for toolbar/zoom)
- `src/ui/inspector/InspectorPanel.tsx:129`, resolved at `:148`
- `src/ui/layers/LayerPanel.tsx:75`, compared at `:122` (`isActive` row class)
- `src/ui/table/TablePanel.tsx:53-54`
- `src/ui/StatusBar.tsx:50-51`
  Note the repeated idiom `layers.find((l) => l.id === activeLayerId) ?? layers[0]` in **five** places
  (`App.tsx:649`, `App.tsx:1309`, `InspectorPanel.tsx:148`, `TablePanel.tsx:54`, `StatusBar.tsx:51`) — there is no
  shared `useActiveLayer()` selector.

There is a **second, parallel active id**: `activeGeoLayerId` on the geo store (§1.2), which the inspector
treats as an override that replaces the entire city view (`InspectorPanel.tsx:287`).

### 1.2 `src/features/geoLayers/geoLayerStore.ts` — GeoJSON / XYZ raster / 3D Tiles

Exports: `type GeoLayerKind = "geojson" | "raster-xyz" | "3d-tiles"` :24; configs `GeoJsonLayerConfig` :35,
`RasterXyzLayerConfig` :43, `Tiles3dLayerConfig` :52, union `GeoLayerConfig` :57; `GeoLayerBase` :62 (`id`,
`name`, `visible`, `opacity`, `style: GeoLayerStyle`); **`type GeoLayer`** :83 — discriminated on `kind`,
each arm pairing `kind` with its `config`; `GeoLayerInput` :101 (distributive `Omit<L,"id"|"visible"|"opacity"|"style">`);
`GeoLayerPatch` :114 (`name?`, `visible?`, `opacity?`, `style?` — no `config`); `DEFAULT_GEO_LAYER_OPACITY = 1` :128;
`isGeoLayerUnavailable(layer)` :145; `interface GeoLayerState` :153 (`layers` :154, `activeGeoLayerId` :159);
`interface GeoLayerActions` :162 — `addGeoLayer` :164 (returns id), `removeGeoLayer` :165, `removeAllGeoLayers` :166,
`setActiveGeoLayer` :167, `updateGeoLayer` :168, `relinkGeoJsonLayer(id, data)` :178; `useGeoLayerStore` :201.

Style type: `src/features/geoLayers/geoLayerStyle.ts` — `GeoLayerStyle` with `color`, `pointSizePx`,
`lineWidthPx`, `fillOpacity`; `DEFAULT_GEO_LAYER_STYLE`, `normalizeGeoLayerStyle`.

Reads of `activeGeoLayerId`: `InspectorPanel.tsx:137` (+ resolve :139, render branch :287),
`GeoLayerRow.tsx:43` / `:46` (`isActive`). Written by `setActiveGeoLayer` only.

### 1.3 `src/features/selection/selectionStore.ts`

- `interface SelectionState` :17 — `mode: PickMode` :18, `toolMode: ToolMode` :19,
  `selections: ReadonlyArray<Selection>` :20, `hovered: Selection | null` :21,
  `geoSelection: GeoFeatureSelection | null` :27 (**mutually exclusive** with `selections`)
- `interface SelectionActions` :30 — `select(sel|null)` :32, `toggleSelect(sel)` :34, `selectMany(sel[])` :36,
  `selectGeoFeature(sel|null)` :38, `hover(sel|null)` :39, `setMode(PickMode)` :40, `setToolMode(ToolMode)` :41,
  `clear()` :42
- private `selectionEquals` :47; `useSelectionStore` :56
- Invariants: `select` clears `geoSelection` :65; `toggleSelect` filters to the **same layer** :77-80;
  `selectMany` keeps only `selections[0].layerId` :89-93; `selectGeoFeature(sel)` clears city selections :101;
  `setMode` **wipes** selections + hover + geo :108.

### 1.4 `src/features/query/queryStore.ts` — per-layer table query (session only)

- `interface QueryStoreState` :19 — `queries: Record<string, LayerQuery>` :20
- `interface QueryStoreActions` :23 — `setFilter` :24, `applyFilter` :28, `clearFilter` :29, `setSort` :30,
  `toggleSort` :31, `setPage` :33, `setPageSize` :34, `setSyncToMap` :35, `resetQuery` :36
- `layerQuery(state, layerId): LayerQuery` :43 — the defaulted accessor every consumer uses
- `useQueryStore` :63. `applyFilter` maps an empty draft to `applied: null` :73.

### 1.5 `src/features/streaming/streamStore.ts` — per-layer FCB stream mirror

- `type StreamStatus` re-export :38
- `interface StreamState` :40 — `handle: FcbStreamLayerHandle` :45, `disposers` :57, `grid: Grid` :62,
  `header: FcbHeaderModel` :63, `level: number|null` :66, `ladder` :67, `ladderVersion` :68, `types` :73,
  `typesVersion` :74, `appearanceThemes` :78, `status: StreamStatus` :79, `message: string|null` :80,
  `version: number` :86 (bumped per cell commit — the only field a commit touches)
- `interface StreamStoreState` :89 — `streams: Record<string, StreamState>` :90
- `interface StreamStoreActions` :93 — `register` :94, `unregister` :95, `get` :96, `bumpVersion` :97,
  `setStatus` :98, `setLadder` :107, `setTypes` :111, `setAppearanceThemes` :112, `setLevel` :121
- `useStreamStore` :126. Module docstring :12-26 explains the deliberate split from `layerStore` (commit
  frequency vs. re-render cost) — a hot constraint for any re-architecture.

Related streaming stores:

- `src/features/streaming/streamLod.ts` — `StreamLodSelection` :31, `StreamLodStore` :39
  (`selection`, `setMode` :44, `setLod` :45), `AUTO_SELECTION` :48, `useStreamLodStore` :50,
  `LadderLike` :78, `unionLadder(streams)` :91, `AutoLodSource` :112, `autoLodDescription(streams)` :133,
  `describeLodSelection(sel)` :148. **Streaming LoD is GLOBAL** while static LoD is per-layer (:15-21).
- `src/features/streaming/queryRegionStore.ts` — `QueryRegionStoreState.regions` :22,
  `setRegion` :26, `clearRegion` :28, `clear` :30, `useQueryRegionStore` :35. Only populated while the
  Advanced-Settings stream-query-box toggle is on.

### 1.6 `src/features/stac/stacStore.ts` — the published-catalog browser

- `type StacFetchStatus = "idle" | "loading" | "ready" | "error"` :35
- `interface StacItemsEntry { status: StacFetchStatus; error: string | null; items: readonly StacItemRecord[] }` :39-45
  (one collection's item index, with an independent lifecycle :37-38)
- `interface StacStoreState` :47-54 — `collectionsStatus: StacFetchStatus` :48,
  `collectionsError: string | null` :49, `collections: readonly StacCollectionCard[]` :51
  (sorted by the fetcher, not here), `itemsByCollection: Readonly<Record<string, StacItemsEntry>>` :53
  (keyed by collection id; an absent key means "never asked")
- `interface StacStoreActions` :56-75 — `loadCollections(): void` :64 (no-op while loading or cached;
  re-crawls after an error), `retryCollections(): void` :66, `loadItems(card: StacCollectionCard): void` :74
  (also the per-collection retry path)
- `type StacStore = StacStoreState & StacStoreActions` :77; `type StacState = StacStore` :83 (alias)
- private helpers `messageOf(error)` :88, `LOADING_ENTRY` :94, `isSettledOrBusy(status)` :102
- `export const useStacStore` :106 (initial `{collectionsStatus:"idle", collectionsError:null, collections:[], itemsByCollection:{}}` :107-110)

**Note: there is no selection or paging state here** — the catalog browser is fetch-cache only. Neighbouring
modules: `stacClient.ts`, `stacItems.ts`, `stacAssets.ts`, `stacGeo.ts`, `stacNormalize.ts`, `stacTypes.ts`.
Consumers: `src/ui/stac/{StacBrowser,StacBrowserDialog,CollectionCard,StacItemMap}.tsx` plus the
`"stac"` tab of `AddLayerDialog` and the landing page's catalog entry (`App.tsx:1481-1511`, `:1555`).

### 1.7 `src/features/cityparquet/*`

Not a store — loaders: `loadCityParquet.ts`, `objectStorage.ts` (IndexedDB object cache),
`sourceClassify.ts` (URL → CityParquet vs. other). Feeds `useLayerFileLoader`.

### 1.8 `src/features/tiles/tilesStore.ts` (Google Photorealistic 3D Tiles)

`TilesState { enabled: boolean }` :19-21, `TilesActions { setEnabled }` :23-25, `useTilesStore` :29,
default `enabled: true` :30.

### 1.9 `src/features/atmosphere/atmosphereStore.ts`

`type Precipitation = "none" | "rain" | "snow"` :26; `AtmosphereState` :28 —
`cloudCoverage` :29, `lensFlareEnabled` :30, `precipitation` :31; `AtmosphereActions` :34 —
`setCoverage` :35, `setLensFlareEnabled` :36, `setPrecipitation` :37, `reset` :38;
`DEFAULT_ATMOSPHERE_STATE` :43 (`0.3` / `true` / `"none"`); `useAtmosphereStore` :51.

### 1.10 `src/features/debug/renderDebugStore.ts`

`DEFAULT_EXPOSURE = 10` :38, `EXPOSURE_RANGE = {min:0.5,max:30,step:0.5}` :42;
`RenderDebugState` :44 — `postProcessingEnabled` :49, `cloudsEnabled` :50, `aerialPerspectiveEnabled` :51,
`sunShadowsEnabled` :52, `exposure` :54, `streamQueryBoxEnabled` :66;
`RenderDebugActions` :69 (`setPostProcessingEnabled` … `setStreamQueryBoxEnabled`, `reset` :76);
`DEFAULT_RENDER_DEBUG_STATE` :81; `useRenderDebugStore` :99; dev-only global `window.__roofyRenderDebug` :118-126.

### 1.11 `src/features/sceneTheme/sceneThemeStore.ts`

`type SceneTheme = "photoreal" | "cartoon" | "cyber" | "wireframe"` :19; `SCENE_THEMES` :23;
`DEFAULT_SCENE_THEME = "photoreal"` :32; `SceneThemeState { theme }` :34; `setSceneTheme` :39 (no-op on same value :52);
`useSceneThemeStore` :44.

### 1.12 `src/features/viewMode/viewModeStore.ts`

`type ViewMode = "2d" | "2.5d" | "3d"` :15; `VIEW_MODES` :19; `DEFAULT_VIEW_MODE = "3d"` :23;
`ViewModeState { mode }` :25; `setViewMode` :30 (no-op on same value :41); `useViewModeStore` :35.

### 1.13 `src/features/solar/solarStore.ts`

`SunPosition` :20 (`altitudeDeg`, `azimuthDeg`, `direction`), `LatLon` :32,
`SolarState` :37 — `datetime` :38, `latLon` :39, `sunPosition` :40, `timeAnimating` :41, `timeSpeed` :42;
`SolarActions` :45 — `setDatetime`, `setLatLon`, `setSunPosition`, `setTimeAnimating`, `setTimeSpeed`;
`sunPositionFromEnu(dir)` :63; `defaultSolarDatetime(now?)` :101 (today at 12:00 **UTC**); `useSolarStore` :115.
Companion: `src/features/solar/solarClock.ts`, `src/scene/timeAnimation.ts`, `src/scene/sunWriter.ts`.

### 1.14 `src/features/basemap/basemapStore.ts`

`HeatmapSettings` :27 (`minHeight`, `maxHeight`, `logarithmic`), `HEATMAP_SETTINGS_DEFAULTS` :33,
`BasemapState { basemapId, heatmap }` :39, `setBasemapId` :45, `setHeatmap(patch)` :53 (refuses min≥max :75),
`useBasemapStore` :58. Basemap catalogue: `src/scene/basemaps.ts` (`BasemapId`, `DEFAULT_BASEMAP_ID`,
`ELEVATION_HEATMAP_DEFAULTS`).

### 1.15 `src/features/theme/useTheme.ts` — UI (light/dark) theme

NOT a Zustand store: a React hook. `type Theme = "dark" | "light"` :11; storage key `"roofy-theme"` :13;
`getInitialTheme()` :15 (localStorage → `prefers-color-scheme`); `useTheme(): {theme, toggleTheme}` :23,
writes `document.documentElement[data-theme]` :27. Owned by `App.tsx` and threaded as props — it is the one
piece of global UI state that is **not** in a store.

---

## 2. Selection flow, end to end

### 2.1 Engine → intent: `src/scene/pickEventHandlers.ts` (pure, engine-free)

- `type PickIntent = {kind:"hover"|"select", selection: Selection|null} | {kind:"toggle", selection: Selection}` :36
- `interface PickPointerEvent { type: "move"|"click"; shiftKey: boolean }` :47
- `interface RaycastResolver { id; resolveRaycast(ray): RaycastHit|null; resolvePick(pick): Selection|null }` :55
- `interface SelectionActionsSubset { hover; select; toggleSelect }` :65 — deliberately excludes `setMode`/`selectMany`/`clear`
- `resolveNearestHit(handles, ray): Selection | null` :88 — asks EVERY handle, keeps the globally nearest by
  `RaycastHit.distance`, then only the winner interprets its own hit (:105-119, forwards `cellKey` verbatim)
- `acceptsPointer(toolMode, type): boolean` :130 — `measure` swallows everything; `box-select` allows `move` only
- `sameSelection(a, b): boolean` :144
- `canvasPointOf(event): ScreenPoint` :168 (uses `offsetX/offsetY`, falls back to `clientX/clientY`)
- `CLICK_DRAG_TOLERANCE_PX = 5` :200; `interface ClickGate` :202; `createClickGate(tolerancePx?)` :223
- `narrowToMode(selection, mode): Selection | null` :255 — **object vs surface** collapse. Handles always resolve
  at SURFACE granularity; `mode === "object"` rewrites to `{kind:"object", layerId, objectId}` :261-265
- `pickIntentFor(event, selection): PickIntent` :275 — shift+click on a hit ⇒ `toggle`; shift+click on empty ⇒ `select(null)`
- `applyPickIntent(intent, store)` :286
- `interface EnginePickStash { engineLayerId: unknown; batchId: number; properties }` :316
- `geoSelectionFromStash(stash, resolveGeoLayerId): GeoFeatureSelection | null` :332

**Geo features** are picked on a different path: the engine's own `featureClick` event is stashed
(`EnginePickStash`), and the following `click` asks `geoSelectionFromStash` with the viewport's
engine-id → geo-layer-id map. City picks use own-raycast (`PICK_PATH = "own-raycast"`, see
`pickEventHandlers.ts:490-492` and `resolvePickedFeature` :494, which is kept but unwired for city picks).

### 2.2 Store → engine highlight: `src/scene/handleSync.ts`

- `interface InteractionHandle` :239 — `id`, `setHighlight(sel[], hovered?)` :241, `resolvePick` :244,
  `resolveRaycast` :247, `getBoundsGeodetic()` :248, `triangleCount()` :249, `heightOffset?()` :255
- `interactionHandles(layers, live, streams?)` :426 — **visible** layers only (picking / fit / triangle count)
- `allInteractionHandles(layers, live, streams?)` :443 — includes hidden layers; what `syncHighlight` must use
- `type HighlightMemo = WeakMap<InteractionHandle, string>` :532; `highlightKey` :547 keyed per-handle on
  only that handle's own selections + hover
- `syncHighlight(handles, selections, hovered?, memo?)` :582 — pushes the WHOLE selection array to every
  handle; each mesh filters to its own `layerId` (`CityModelMesh.setHighlight`)
- `layerHeightOffset(layerId, live, streams?)` :460

### 2.3 Selection consumers

- **`src/ui/inspector/InspectorPanel.tsx`** — props `{ selections: ReadonlyArray<Selection>; onClose: () => void }` :47-50.
  - `selection = selections[0]` :141, `isMultiSelect = selections.length > 1` :142
  - `selectedLayer` from `selection.layerId` :145; `activeLayer` from `activeLayerId` :148;
    **`displayLayer = selectedLayer ?? activeLayer`** :149 — the panel follows the selection, falling back to active
  - `ruleTargetOverride` :155 — `useState<string|null>(null)`, **reset whenever `displayLayer.id` changes** :158-160;
    `ruleTargetLayer = layers.find(l => l.id === ruleTargetOverride) ?? displayLayer` :162.
    It exists because rules are per-layer while the rest of the panel follows the selection, so the Rules tab
    can be pointed at a _different_ layer than the one being inspected. It is passed down as
    `layerOptions` + `onSelectLayer={setRuleTargetOverride}` :334-338.
  - Streaming path: `residentModel` via `getResidentModel(layerId, version)` :176-179;
    `useObjectSurfaces(handle, objectId)` :240 gated on `activeTab === "surfaces" || "analysis"` :239
  - Tabs `type Tab = "object"|"surfaces"|"analysis"|"rules"|"stats"` :44; strip at :295-326
  - **Geo override**: `activeGeoLayer` non-null replaces the entire tab strip and body with
    `<GeoLayerInspector layer={activeGeoLayer}/>` :287-292
  - Internal components: `SurfacesFetchGate` :411, `MultiSelectView` :435, `ObjectTab` :550, `SurfacesTab` :626,
    `AttrRow` :673, `formatValue` :684; helpers `aggregate` :516, `formatAgg` :530, `formatAggNullable` :535
- **`src/ui/viewport/AttributePanel.tsx`** — floating overlay, props :27-43
  `{ objects: ReadonlyArray<CityObject>; objectsById?: Record<string,CityObject>; geoFeature?: GeoFeatureAttributes|null }`;
  exported `interface GeoFeatureAttributes { layerName; properties }` :22.
  Renders `GeoAttributes` :218 when no city object is selected, `SingleAttributes` :187 / `MultiAttributes` :235
  otherwise, all through one `AttributeTable` :140. **Duplicates** InspectorPanel's Object-tab attribute
  rendering and its own aggregation (`AggMode` :12, `formatAggregate` :301) — a second, independently-implemented
  copy of `resolveInheritedAttributes` display.
- **`src/ui/inspector/GeoLayerInspector.tsx`** — `GeoLayerInspector({ layer }: { layer: GeoLayer })` :21.
  Reads only `useGeoLayerStore((s) => s.updateGeoLayer)` :22; `editStyle(patch)` merges the whole style :26.
  Sections: identity (name/kind/source) :31-52, opacity slider for `raster-xyz`/`geojson` :61-80,
  vector style fields (color/pointSizePx/lineWidthPx/fillOpacity) for `geojson` :92-163.
  Driven by `activeGeoLayerId`, **not** by `geoSelection`.
- **`src/ui/table/TablePanel.tsx` "Sync selection"** — `const [syncSelection, setSyncSelection] = useState(true)` :63
  and a **second, local selection** `tableSelection: ReadonlySet<string>` :64.
  - `selectedIds` :96 = scene selection object-ids when syncing, else the local set
  - `handleRowClick(objectId, shiftKey)` :104 — when syncing, `useSelectionStore.getState().toggleSelect/select`
    with `{kind:"object", layerId, objectId}` :121-125; when not syncing, mutates `tableSelection` :107-118
  - `handleUnselectAll` :129 — `useSelectionStore.getState().clear()` or `setTableSelection(new Set())`
  - Checkbox UI at :179-186.

---

## 3. The table / query stack

### 3.1 `src/ui/table/*`

- **`TablePanel.tsx`** — `MIN_TABLE_HEIGHT = 120` :32, `MAX_TABLE_HEIGHT = 800` :33,
  `DEFAULT_TABLE_HEIGHT = 320` :34; `interface TablePanelProps { duckdbStatus: DuckDBStatus; onRetryDuckDB: () => void; onCollapse: () => void; onHeightChange: (height:number)=>void }` :39-44;
  `export function TablePanel(props)` :46. Internals:
  - picks its layer from `activeLayerId` :53-55 (same `?? layers[0]` idiom)
  - `useLayerQuery(layerId)` :57, `useQueryStore` :58, `useSelectionStore((s)=>s.selections)` :61
  - `setExportOpen(false)` on layer change :73-75
  - **registers panel-open with the table registry**: `useLayerTableStore.getState().setTablePanelOpen(true)` on
    mount / `false` on unmount :79-82 — this is what makes a streaming layer's table rebuild on settle
  - map-filter effect :87-90 → `syncFilterToMap(layerId)` on `[layerId, query.applied, query.syncToMap, view.table]`
  - header: title + `(N rows)` unfiltered count :161-177; **"Sync selection"** checkbox :179-186;
    **"Filter map"** checkbox :188-210 (disabled when no layer, `isStreaming`, or table not ready;
    `STREAMING_FILTER_REASON` :36-37); Filter toggle :212-219; Export :221-228; Clear selection :230-236;
    collapse chevron :240-253
  - body states, in order :278-343: duckdb `initializing` → engine-down (Retry) → `no-layer` → `queued`/`building`
    → `failed` → grid (+ `pageError` :155)
  - `<FilterBar>` :260-272, `<DataGrid>` :328-340, `<Pagination>` :347-357, `<ExportDialog>` :361-369
  - `epsgOf(referenceSystem)` :378; `TableResizeHandle` :385 (drag → `onHeightChange`, clamped to MIN/MAX)
- **`useLayerQuery.ts`** — `interface LayerQueryView` :30 with
  `status: "no-layer"|"queued"|"building"|"failed"|"ready"` :33, `message` :36, `table: LayerTable|null` :37,
  `columns: ReadonlyArray<ColumnInfo>` :41, `rows` :42, `totalRows: number|null` :52,
  `unfilteredRows: number|null` :54, `loading` :55, `reload()` :56;
  `export function useLayerQuery(layerId: string | null): LayerQueryView` :67.
  Generation counter :82/:113/:177; per-layer reset on layer change :132-137; page clamp writes back to
  `queryStore.setPage` :201-206; three parallel queries (page, filtered count, unfiltered count) :161-176.
- **`FilterBar.tsx`** — `interface FilterBarProps { columns; filter: FilterGroup; onChange; onApply; onClear; error: string|null; disabled: boolean }` :36-55; `export function FilterBar(props)` :57.
- **`DataGrid.tsx`** — `interface DataGridProps { columns; rows; sort; selectedIds: ReadonlySet<string>; onSort; onRowClick(rowId, shiftKey); emptyMessage? }` :26-37;
  `export const DataGrid = memo(function DataGrid(...))` :48; `rowIdOf(row, index)` :15; `sortable(column)` :22.
- **`Pagination.tsx`** — `interface PaginationProps { page; pageSize; totalRows; unfilteredRows; filtered; onPage; onPageSize }` :13-21; `export function Pagination(props)` :23.
- **`ExportDialog.tsx`** — `type Format = "cityparquet"|"parquet"|"csv"|"json"` :53; `FORMAT_LABELS` :55,
  `EXTENSIONS` :62, `DISABLED_FORMATS = ["CityJSON","CityJSONSeq","FlatCityBuf"]` :79, `FIXED_COLUMNS` :45.
  Props (used at `TablePanel.tsx:361-369`): `layerId`, `layerName`, `table: LayerTable`, `epsg: number|null`,
  `selectedLod`, `isStreaming`, `onClose`. Calls `refreshStreamingTable` :25 before writing a streaming layer.
- **`tableText.ts`** — `formatCount(n)` :38, `rangeLabel(page,pageSize,totalRows)` :50, `formatCell(value)` :83,
  `rawCellTitle(value)` :97, `emptyGridMessage(filtered, syncToMap, unfilteredRows)` :141,
  `OP_LABELS` :173, `operatorsFor(column)` :197, `valueText(value)` :208, `normalizeFilterForApply(filter)` :227.
- **`exportFileName.ts`** — `exportFileName(...)`.

### 3.2 `src/insights/*`

- **`duckdb.ts`** — `type ExtensionName = "cityjson"|"spatial"|"three_d"` :24; `type ExtensionStatus` :28;
  `interface LoadedExtension` :36; **`type DuckDBStatus = {state:"uninitialized"} | {state:"initializing"} | {state:"ready", extensions, loadedExtensions, platform} | {state:"failed", error}`** :41-52;
  `interface QueryResult` :54; `type QueryOutcome = {ok:true,columns,rows} | {ok:false,message}` :62;
  `getDuckDBStatus()` :91, `isExtensionLoaded(name)` :95, `formatDuckDBError(error)` :114, `initDuckDB()` :261,
  `ensureExtension(name)` :275, `queryDuckDB(sql)` :300, `queryParquetBuffer(...)` :342, `runQuery(sql)` :388,
  `ddl(sql)` :402, `registerBuffer(...)` :431, `dropBuffer(name)` :447, `readFile(name)` :454.
  Singleton module state :76-89 — **the engine is a module singleton, not a store**; the _status_ is owned by
  `App.tsx` React state (§6).
- **`layerTables.ts`** — `type SourceProvider` :75, `type ReaderExtension` :87, `type LayerTableSource` :89
  (`bytes` | `model` | `resident`), **`interface LayerTable { table; sourceName; source; reader; columns; lods; rowCount }`** :122-138,
  `type LayerTableState = queued|building|ready(+rebuilding?)|failed` :140-158,
  `interface LayerTableStoreState { tables; tablePanelOpen }` :160-168,
  `interface LayerTableStoreActions { setTablePanelOpen }` :170, `useLayerTableStore` :174,
  `getLayerTable(layerId)` :322, `resetLayerTablesForTest()` :342, `retryEngine()` :570,
  `type LayerTableOutcome` :690, `enqueueLayerTable(...)` :712, `dropLayerTable(layerId)` :889.
  Module registry + FIFO queue at :195ff; table names are `layer_<n>` :123.
- **`sql.ts`** — `type CompileResult` :23, `quoteIdent` :28, `quoteLiteral` :39, `READ_JSON_OPTIONS` :79,
  `escapeLikeNeedle` :85, **`compileFilter(group, columns)`** :303, `projectColumn` :331, `gridColumns` :346,
  `buildPageSql(table, columns, where, sort, page, pageSize)` :395, `buildCountSql(table, where)` :415,
  `buildFeatureScopeWhere` :429, **`buildFeatureIdsSql(table, where)`** :446 (the map-filter query),
  `buildRootTypesSql` :464, `buildRootTypeWhere` :487, `type AttributeExportFormat` :499,
  `exportColumnNames` :555, `buildAttributeExportSql` :572, `CITYPARQUET_REQUIRED_COLUMNS` :623,
  `CITYPARQUET_SOURCE_TABLE` :634, `buildCityParquetSourceSql` :667, `buildCityParquetModuleSql` :696.
- **`export.ts`** — `interface AttributeExportRequest` :32, `interface ExportResult` :49,
  `type ExportContentFormat` :65, `type ReadbackOutcome` :67, `validateExportBytes` :85,
  `resetExportCounterForTests()` :148, `interface CityParquetExportRequest` :386,
  `type ExportRequest = AttributeExportRequest | CityParquetExportRequest` :666, `runExport(request)` :668.
- **`computeStats.ts`** — `computeModelStats(model)` :113, `computeModelStatsFromRecords(...)` :137,
  `computeObjectStats(...)` :201, `computeObjectStatsFromRecord(...)` :224.
  Types in `src/insights/types.ts`: `OrientationCount` :5, `ModelStats` :10, `ObjectStats` :22.
- **`columnKind.ts`** — `type ColumnKind = "scalar"|"castText"|"nested"|"blob"` :32, `interface ColumnInfo` :34,
  `classifyColumnType(type)` :56, `isTextColumn(column)` :67, `isDroppedColumn(name)` :78,
  `interface LodColumn` :90, `lodsFromColumnNames(...)` :104.
- **`layerRows.ts`** — `interface FlatRow` :23, `FLAT_PREFIX_COLUMNS` :32, `flatRowsFromModel` :124,
  `flatRowsFromRecords` :143, `encodeRowsAsJson` :169.
- **`cityGmlModule.ts`** — `type CityGmlModule` :13, `CITY_GML_MODULES` :28, `cityGmlModuleOf` :64,
  `groupTypesByModule` :78.

### 3.3 `Layer.visibleObjectIds` → the plugin

Chain: table "Filter map" checkbox (`TablePanel.tsx:188-210`) → `useQueryStore.setSyncToMap`
→ effect `TablePanel.tsx:87-90` → **`syncFilterToMap(layerId)`** (`src/features/query/mapFilterSync.ts:107`)
→ `compileFilter` + `buildFeatureIdsSql` → `useLayerStore.getState().setVisibleObjectIds(layerId, ids)`
(`mapFilterSync.ts:167`; empty set is written, only `null` means "no filter" :165-166)
→ `syncLayers` diff (`src/scene/handleSync.ts:167-170`) →
**`handle.setVisibleObjectIds(ids)`** — the plugin API name.
Plugin side: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts:86`
(`setVisibleObjectIds(ids: ReadonlySet<string> | null): void`),
`…/cityModelRegistry.ts:169-170`, `…/cityModelMesh.ts:459`.
Generation guard + clear paths: `clearMapFilter(layerId)` `mapFilterSync.ts:50`,
`forgetMapFilter(layerId)` :64, `idText(value)` :95.
**Streaming layers have no equivalent** — the "Filter map" checkbox is disabled for them (`TablePanel.tsx:195-199`).

### 3.4 Filter model types

`src/features/query/types.ts`: `type FilterOp` :12 (`= != < <= > >= contains startsWith endsWith isNull isNotNull in`),
`type FilterValue = string|number|boolean|ReadonlyArray<string>` :26,
`interface FilterCondition { id; column; op; value }` :28,
`interface FilterGroup { logic: "AND"|"OR"; conditions }` :35 (flat, no nesting :36-38),
`type PageSize = 100|500|1000` :43, `PAGE_SIZES` :45,
`interface LayerQuery { filter; applied; sort; page; pageSize; syncToMap }` :47-60,
`EMPTY_FILTER` :62, `DEFAULT_LAYER_QUERY` :67, `isNullaryOp(op)` :77.

### 3.5 "Show selected" / status-bar entrance

There is no "Show selected" control in the current table — the two checkboxes are **"Sync selection"**
(`TablePanel.tsx:179-186`, local `syncSelection` state, default `true`) and **"Filter map"**
(:188-210, backed by `queryStore.syncToMap`). Selected rows are highlighted via `DataGrid.selectedIds`.
The **status bar** is the table's entrance: `StatusBar.tsx:63-75` renders a `table-toggle-btn` labelled
"Table" when `onToggleTable` is supplied, `active` when `tableOpen` — wired from `App.tsx` (§6).

---

## 4. Rules

### 4.1 Shape and location

Rules live **on the Layer**, not in a rules store: `Layer.rules: ReadonlyArray<Rule>` and
`Layer.rulesEnabled: boolean` (`src/features/layers/layerStore.ts:23-24`). All mutation goes through the
layer-store actions `addRule` / `updateRule` / `deleteRule` / `reorderRules` / `toggleRulesEnabled` / `clearRules`
(`:172-181`, implementations `:379-432`). `src/features/rules/` contains only `types.ts` (a re-export) and
`presets.ts` — **there is no `rulesStore.ts`**.

### 4.2 Types (`src/features/rules/types.ts` re-exports from `@cityjson/navara-core`)

Definitions at `packages/cityjson-navara-plugins/packages/navara-core/src/rules/types.ts`:

- `type ConditionOperator = ">" | "<" | "=" | ">=" | "<="` :10
- `interface Condition { field: string; operator: ConditionOperator; value: number|string|boolean }` :12-16
- `type LogicMode = "AND" | "OR"` :18
- `interface Rule { id; name; color /* CSS hex */; conditions: ReadonlyArray<Condition>; logic: LogicMode; enabled: boolean }` :20-28
  Evaluation order: array position, first match wins (:5-7).
  Evaluators live in core too: `compileRuleEvaluator`, `evaluateRule`, `matchRule`.

### 4.3 Presets — `src/features/rules/presets.ts`

`interface RulePreset { label; description; create(): Rule }` :16-20;
`RULE_PRESETS: ReadonlyArray<RulePreset>` :22 — five entries:
"Flat roofs" :24 (`inclinationDeg < 10`, `#3b82f6`), "South-facing" :36 (`#f0a800`),
"Steep roofs" :52 (`inclinationDeg > 45`, `#f2683c`), "Large roofs" :64 (`areaSqM > 50`, `#7cb518`),
"Solar suitable" :76 (`#ffc530`). Each `create()` mints a fresh UUID.

### 4.4 `src/ui/inspector/RuleBuilderTab.tsx`

- `interface RuleBuilderTabProps { model: CityModel; layerId: string; layerOptions: ReadonlyArray<{id;name}>; onSelectLayer: (id:string)=>void }` :31-36
- `METRIC_FIELDS = ["areaSqM","inclinationDeg","azimuthDeg","elevationM"]` :39-44 — **the roof-metrics fields
  available to rules**, matching `RoofMetrics` exactly
  (`packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics/types.ts:6-15`:
  `areaSqM`, `inclinationDeg`, `azimuthDeg`, `elevationM`)
- `OPERATORS: ConditionOperator[] = [">","<","=",">=","<="]` :46
- `export function RuleBuilderTab(props)` :48. Reads `layer` from the store :54; the **layer `<select>`** at
  :125-137 calls `onSelectLayer` (i.e. `InspectorPanel.setRuleTargetOverride`) — the tab is CONTROLLED
- Extra field sources: `collectAttributeFields(model)` :456 (static — object + surface attribute keys) /
  `collectAttributeFieldsFromResidentModel(model)` :477 (streaming); `allFields = [...METRIC_FIELDS, ...attributeFields]` :88
- Texture-theme warning `textureThemeActive` :62, note at :140-146
- Sub-components: `RuleRow` :259, `RuleForm` :309 (`interface RuleFormProps` :302); import/export of rules as
  JSON via `downloadText` :90-118

### 4.5 Rule colours → the plugins

Two different calls, chosen by `Layer.isStreaming`:

- **Static** — `syncStyles(layers, live)` (`src/scene/handleSync.ts:207`): memoised on
  `(rules identity, rulesEnabled)` :218-223, then `compileRuleEvaluator(layer.rules, layer.rulesEnabled)` :229
  and **`entry.handle.setStyle(evaluator)`** :231. Streaming layers are skipped :212.
- **Streaming** — `syncStreamState(layer, handle, memos, themeStyle?)` (`handleSync.ts:355`):
  **`handle.setRules(layer.rules, layer.rulesEnabled)`** :370 — the raw `Rule[]` wire payload, baked in the
  FCB worker. A compiled `SurfaceStyleEvaluator` must never reach a streaming handle (:197-205, :263-266).
  Interface declarations: `StreamInteractionHandle.setRules` `handleSync.ts:273`;
  static `CityModelHandle.setStyle` in `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts`.

### 4.6 `src/ui/viewport/LegendOverlay.tsx`

`export function LegendOverlay()` :16 — **takes NO props**. It reads `useLayerStore((s) => s.layers)` :17
directly and derives `groups` :23-30 = layers with `visible && rulesEnabled`, each mapped to its `enabled`
rules, empty groups dropped. Returns `null` when `groups.length === 0` :32. Local `visible` toggle state :18.
Markup: `.legend-overlay` / `.legend-toggle` / `.legend-card` / `.legend-title` / `.legend-group` /
`.legend-group-name` / `.legend-item` / `.legend-dot` :35-79. Keys are `${layerId}:${rule.id}` :67 because
rule ids are only unique within a layer.

---

## 5. Persistence (`src/persistence/*`)

### 5.1 The v3 schema — `src/persistence/types.ts`

- `SNAPSHOT_VERSION = "3"` :383
- **`interface ProjectSnapshot`** :385-404:
  - `version: string` :388
  - `savedAt: string` (ISO 8601) :389
  - `label: string` :390
  - `layers?: ReadonlyArray<LayerSnapshot>` :391
  - `geoLayers?: ReadonlyArray<GeoLayerSnapshot>` :401 (optional means "none"; **share links never carry these** :398-399)
  - `viewState: ViewState` :402
  - `pickMode: PickMode` :403
- `interface ViewState` :318-341 — `camera: GeographicCamera` :319, `datetime: string` :320,
  `viewMode?: ViewMode` :330, `sceneTheme?: SceneTheme` :340
- `interface GeographicCamera { lng; lat; height; heading; pitch; roll }` :305-316 — structurally identical to
  `src/scene/geographicCamera.ts`'s `GeographicCameraState`, deliberately declared twice (:294-298)
- `interface LayerSnapshot` :55-76 — `name`, `modelRef: CityModelReference`, `rules`, `rulesEnabled`, `visible`,
  `selectedLod?`, `lodMode?`, `hiddenTypes?`, `appearance?: AppearanceTheme|null`, `stream?: StreamSourceSnapshot`
- `type CityModelReference = UrlModelRef | FileModelRef` :38 (`{type:"url", url}` :28 / `{type:"file", fileName}` :33)
- `type StreamSourceSnapshot = {kind:"url", url} | {kind:"file", fileName}` :51-53 — **this, not a field on
  `Layer`, is where the streaming source/"encoding" is recorded for persistence**
- `interface GeoLayerSnapshot { name; kind; visible; opacity; style?; config }` :152-175 —
  **never carries inline GeoJSON `data`** (:148-150); built by `geoLayerSnapshot(layer)` :178
- `interface SnapshotSummary { id; savedAt; label }` :427; `interface ProjectStateStore { save; load; list; remove }` :433

**What is NOT persisted**: selection/`selections`, `hovered`, `geoSelection`, `activeLayerId`,
`activeGeoLayerId`, `visibleObjectIds`, the whole `queryStore` (`src/features/query/types.ts:4-9`),
UI light/dark theme (that has its own `roofy-theme` localStorage key, `src/features/theme/useTheme.ts:13`),
sidebar/inspector/table collapse state and table height (all `useState` in `App.tsx`, §6),
basemap/tiles/atmosphere/renderDebug/streamLod. Only `viewMode` and `sceneTheme` of the scene settings survive.

### 5.2 Normalisation and validation (no true migrations)

- `normalizeLayers(raw: RawLayersDocument): NormalizedLayerSnapshot[]` :126 — defaults `lodMode` → `"auto"`,
  `hiddenTypes` → `[]`, flags `unavailable: true` for a `stream.kind === "file"` layer :132-134.
  Supporting types `RawLayerSnapshot` :90, `RawLayersDocument` :97, `NormalizedLayerSnapshot` :102.
- `normalizeGeoLayers(raw)` :221 — validates kind/config, drops unusable rows, keeps re-linkable GeoJSON rows
- `normalizeViewMode(mode)` :351, `normalizeSceneTheme(theme)` :362 — default+validate
- `normalizeGeoLayerStyle` (from `geoLayerStyle.ts`) applied per-field :239

**Migrations from v1/v2: there are none, by design.** `class UnsupportedSnapshotVersionError` :414 is thrown by
`restoreSnapshot` for any `version !== "3"`. Reason (:406-412, :299-303): v1/v2 stored
`cameraPosition`/`cameraTarget` as Three.js scene-space tuples relative to an origin-offset mesh frame that no
longer exists, so a migrated camera could only be silently wrong.

### 5.3 Capture / restore

- `src/persistence/captureSnapshot.ts` — `interface CaptureInput { label; layers; geoLayers?; camera: GeographicCamera; datetime: Date; pickMode; viewMode?; sceneTheme? }` :20-37;
  `captureSnapshot(input): ProjectSnapshot` :39. Writes `viewMode` only when ≠ `"3d"` :45-47 and `sceneTheme`
  only when ≠ `"photoreal"` :49-51; omits `geoLayers` when empty :59-61. **Takes no store imports** (:4-5).
- `src/persistence/restoreSnapshot.ts` — `restoreSnapshot(snapshot): ViewState` :19.
  Version gate first :22-24; then writes **only** `useSelectionStore.setState({mode, selections:[], hovered:null, geoSelection:null})` :30-35
  and `useSolarStore.setDatetime(dt)` :40. It deliberately does **not** write viewMode/sceneTheme —
  it returns them normalised :49-53 and `App.tsx` applies them before the camera (:43-48).
- `src/persistence/localStorage.ts` — `class LocalStorageProjectStateStore implements ProjectStateStore` :38.

### 5.4 Share URL hash — `src/persistence/urlShare.ts`

- `interface ShareableLayerState { name; modelUrl; rules; rulesEnabled; visible }` :18-24 — **URL-backed layers only**
- `interface ShareableViewState { v: 3; layers; cam: GeographicCamera; dt: string; pm: PickMode }` :36-52
- `SHARE_PREFIX = "share="` :58, `SHARE_VERSION = 3` :61; base64url helpers `toBase64Url` :63 / `fromBase64Url` :67
- `encodeShareState(state): string` :72 → `"share=" + base64url(JSON)`; the `v` is stamped here :75
- `class UnsupportedShareLinkError extends Error` :109 (carries `found: number|null`)
- `type ShareHashResult = {kind:"none"} | {kind:"unsupported", error} | {kind:"ok", state}` :138-141
- `readShareHash(hash): ShareHashResult` :145 — prefix check :147, JSON parse :150, version guard :164,
  structural camera guard :172, `dt` guard :173, layers defaulted to `[]` :178
- `buildShareUrl(state): string` :185 — `${origin}${pathname}#${encodeShareState(state)}`
- UI: `src/ui/ShareDialog.tsx`.

### 5.5 Where restore happens in `App.tsx`

See §6.4 for the exact line numbers of the share-hash effect, the snapshot restore handler and the
"unavailable layer" re-link prompt.

---

## 6. App shell

### 6.1 `src/app/App.tsx` — two branches from one component

`export function App({ persistenceStore = defaultStore, platform = browserPlatform }: AppProps)` :153
(`interface AppProps` :148-151). Constants: `ENGINE_BOOT_TIMEOUT_MS = 15_000` :99,
`EXPLANATION_TOAST_MS = 8000` :103, `STATUS_TOAST_MS = 3000` :104, `SAMPLE_DATA_URL` :85,
`defaultStore = new LocalStorageProjectStateStore()` :84.
Helper types/functions in-file: `streamSourceSnapshot(modelRef)` :109, `readAppearanceTheme(raw)` :123,
`interface UnavailableLayer` :132-146, `UnavailableLayersBanner` (~:1584), `SnapshotList` (~:1636).

**The branch** is `if (hasLayers || engineBooting)` :1308 → viewer shell (`return` :1325);
otherwise the landing page `<main className="app-shell">` :1436.

### 6.2 All `useState` in App (the shell's UI state — none of it persisted)

`triangleCount` :157, `inspectorOpen` (default `true`) :158, `leftSidebarCollapsed` :159,
`leftSidebarWidth` (240) :160, `savedSnapshots` :161, `unavailableLayers` :162,
`duckdbStatus` :165 (**DuckDB status is owned here**, `{state:"uninitialized"}` initial),
`tableOpen` (false) :168, `tableHeight` (`DEFAULT_TABLE_HEIGHT`) :169, `toast` :170,
`advancedSettingsOpen` :171, `catalogOpen` :181, `shareUrl` :186, `fps` :187, `cursorPosition` :188,
`engineBooting` :204. Refs: `sceneRef: CitySceneHandle|null` :191, `bootHoldsRef` :208,
`toastTimerRef` :220, `sceneGateRef` :295, `toastedLoadErrorRef` :466, `geoSelectionConfigRef` :515.

### 6.3 Layout: grid classes and mounted components

```
const shellClasses = ["viewer-shell",
                      !inspectorOpen && "panel-collapsed",
                      leftSidebarCollapsed && "left-collapsed"].filter(Boolean).join(" ")   // :1312-1318
const gridStyle = { "--left-panel-w": `${leftSidebarWidth}px`,
                    ...(tableOpen ? { "--table-h": `${tableHeight}px` } : {}) }             // :1320-1323
<div className={shellClasses} style={gridStyle}>                                            // :1326
```

Mount order inside the shell:
| line | component | props |
|---|---|---|
| :1327 | `ViewerToolbar` | see §6.6 |
| :1345 | `LeftSidebar` | `width={leftSidebarWidth}`, `onWidthChange={setLeftSidebarWidth}`, `collapsed={leftSidebarCollapsed}`, `onAddFile={handlePickedFile}`, `onAddFiles={handlePickedFiles}`, `onAddUrl={handleAddUrl}`, `loading`, `onFlyToLayer={(id)=>sceneRef.current?.fitLayer(id)}`, `onFlyToGeoLayer={handleFlyToGeoLayer}` |
| :1357 | `<div className="viewport">` | wrapper |
| :1358 | `NavaraViewport` | `ref={attachScene}`, `onTriangleCount={setTriangleCount}`, `onFps={setFps}`, `onCursorPosition={setCursorPosition}`, `onLayerError={handleLayerError}` |
| :1365 | `LegendOverlay` | (none) |
| :1366 | `AttributePanel` | `objects={selectedObjects}`, `objectsById={selectedObjectsById}`, `geoFeature={geoFeature}` |
| :1371 | `RenderingPanel` | mounted only when `advancedSettingsOpen`; `onClose` |
| :1376 | `InspectorPanel` | mounted only when `inspectorOpen`; `selections={selections}`, `onClose={() => setInspectorOpen(false)}` |
| :1383 | `TablePanel` | mounted only when `tableOpen`; `duckdbStatus`, `onRetryDuckDB={handleRetryDuckDB}`, `onCollapse={() => setTableOpen(false)}`, `onHeightChange={setTableHeight}` |
| :1392 | `StatusBar` | `objectCount={totalObjects}`, `triangleCount`, `selectedCount={selections.length}`, `duckdbStatus`, `fps`, `cursorPosition`, `tableOpen`, `onToggleTable={() => setTableOpen(o => !o)}`, `streamStatus`/`streamMessage` (only when `activeLayer?.isStreaming`) |
| :1409 | `UnavailableLayersBanner` | when `unavailableLayers.length > 0` |
| :1420 | `ShareDialog` | when `shareUrl !== null`; `key={shareUrl}`, `url`, `onClose`, `copyToClipboard={copyShareText}` |
| :1429 | `{toast && <div className="toast">{toast}</div>}` | toast system |

Landing branch: `.app-shell` :1436, `.landing-theme-toggle` :1437, `.hero` :1441 (`RoofyLockup` :1446),
`UnavailableLayersBanner` :1455, `.entry-section`/`.entry-paths` :1464-1465 with two `.entry-path` sections —
`SourcePicker` :1472 and the catalog entry :1481-1511 — `.sample-footnote` :1512, `SnapshotList` :1526,
`.loading-indicator` :1535, `{loadError && <p className="error-message">}` :1541, toast :1548,
`StacBrowserDialog` :1555.

### 6.4 Effects and handlers of note

- toast: `showToast(message, ms)` :226 (one `toastTimerRef`, so a new message cannot be cleared by the old
  timer); unmount cleanup :238-243
- catalog invariant effect :265-267
- load-error → toast effect :481-490 (`toastedLoadErrorRef` dedupe)
- geo/city active-layer cross-talk: `geoSelection → setActiveGeoLayer(id)` :505-507;
  `selections.length > 0 → setActiveGeoLayer(null)` :508-510
- geo-selection invalidation on layer removal/config change :536-542 (with `geoSelectionConfigRef` :515-524)
- snapshots list: `refreshSnapshots` :544, effect :549-551
- **DuckDB ownership**: mount effect :556-571 — `setDuckdbStatus({state:"initializing"})` :562, then
  `retryEngine().then(() => setDuckdbStatus(getDuckDBStatus()))` :567-569, and
  `return installLayerTableLifecycle()` :570. Retry handler `handleRetryDuckDB` :582-585.
  The status is React state in `App` and is threaded to `TablePanel` and `StatusBar` as a prop; the engine
  itself is a module singleton in `src/insights/duckdb.ts`.
- engine boot gate: `awaitSceneHandle()` :307, cancel-on-unmount :345, `attachScene` callback ref :350,
  `resolveStreamPlugin()` :371, `applyCameraWhenReady` :410, `withEngineBooting(source, open)` :436
- loading: `useLayerFileLoader({ resolveStreamPlugin })` :452-460 →
  `{ addLayerFromFile, addLayerFromFiles, addLayerFromUrl, loading, error: loadError, lastError, clearError }`
- `handleFile` :587, `handleFiles` :602, `handleUrl` :618, `handlePickedFile` :1126,
  `handlePickedFiles` :1133, `handlePickedUrl` :1140, `handleAddUrl` :1151
- `handleSave` :627 — reads camera via `sceneRef.current?.getCameraState()` :628, maps every layer to a
  `LayerSnapshot` :654-665, `geoLayers: …map(geoLayerSnapshot)` :668
- **`handleRestore(id)` :696-925** — the full sequence:
  1. `suppressAutoFit()` :703 (released in `finally` :913-914)
  2. `persistenceStore.load(id)` :705, `restoreSnapshot(snapshot)` :711 (throws
     `UnsupportedSnapshotVersionError` for any non-v3)
  3. `useViewModeStore.setViewMode(viewState.viewMode ?? "3d")` :716 — **before** layers and camera,
     because entering a mode flies the camera; then
     `useSceneThemeStore.setSceneTheme(viewState.sceneTheme ?? "photoreal")` :720-722
  4. tear-down: `closeAllStreamingLayers(getStreamPlugin())` :727, `removeAllLayers()` :728,
     `setUnavailableLayers([])` :729, `removeAllGeoLayers()` :737
  5. geo layers re-added from `normalizeGeoLayers(snapshot.geoLayers)` :738-740
  6. `normalizeLayers({ layers: snapshotLayers as unknown as RawLayerSnapshot[] })` :754-756
  7. per-layer loop :767-866, **each with its own `try/catch`** (:862-865, `failedCount`): - fields defaulted :769-783, including `readAppearanceTheme(sl.appearance)` :783 - **unavailable placeholder branch** :785-801 — when `modelRef.type === "file"` **or**
     `sl.unavailable`, an `UnavailableLayer` (`{id: crypto.randomUUID(), name, fileName, rules,
rulesEnabled, visible, lodMode, selectedLod, hiddenTypes, appearance}`) is pushed to
     `newUnavailable` :788-799 and the layer is **not** added - **fcb branch** :806-819 — `detectEncoding(modelRef.url) === "flatcitybuf"` →
     `withEngineBooting(... openStreamingLayer({plugin: await resolveStreamPlugin(), ...}))` - **cityparquet branch** :820-838 — `isCityParquetUrl(modelRef.url)` (deliberately not
     `detectEncoding`, :821-825) → `loadCityParquetFromUrl` + `ensureModelCrsLoadable` + `addCityLayer` - **plain branch** :839-858 — `loadFromUrl` + `ensureModelCrsLoadable` + `addCityLayer` with
     `modelTableSource({model, bytes, encoding, refetch: urlSourceProvider(url)})` - `if (lodMode === "manual") setLodMode(layerId, "manual")` :859-861
  8. `setUnavailableLayers(newUnavailable)` :867; toasts :869-885
     (`hasUrlLayer` / `newUnavailable.length` / `failedCount` decide the sentence)
  9. camera last: `applyCameraWhenReady(viewState.camera)` :894, only when at least one layer landed :892
     So **a restore mints placeholder rows** — the `UnavailableLayersBanner` (`App.tsx:1409`/:1455) is part of
     the restore contract, and `handleResolveUnavailableLayer` :1191 is what re-links one.
- **share-hash restore effect :984-1120** — `readShareHash(location.hash)` :988;
  `"unsupported"` → `history.replaceState` + explanatory toast :992-996; `"ok"` →
  `history.replaceState` :1000, `suppressAutoFit()` :1010, per-layer loop :1020-1077 branching on
  `detectEncoding(...) === "flatcitybuf"` :1028 / `isCityParquetUrl(...)` :1041 / plain `loadFromUrl` :1057;
  `useSelectionStore.setState({mode: shared.pm, selections: [], hovered: null})` :1079-1083;
  datetime :1084-1087; failure toast :1092-1097; `applyCameraWhenReady(shared.cam)` :1108
- `handleClose` :1163 — `closeAllStreamingLayers` + `removeAllLayers` :1164-1165, resets counters,
  `setTableOpen(false)` :1171, `clearSelection()` :1175, `setActiveGeoLayer(null)` :1181
- `handleResolveUnavailableLayer` :1191, `handleDismissUnavailableLayer` :1216
- `handleFitAll` :1220 → `sceneRef.current?.fitAll()`; `handleFlyToGeoLayer` :1227 →
  `resolveGeoLayerBounds` + `sceneRef.current?.fitBounds(bounds)` :1237
- `handleLayerError` :1258, `handleLoadSample` :1265
- selected-object resolution for `AttributePanel` :1270-1284; `geoFeature` :1290-1300

### 6.5 Sidebar and layer rows

**`src/ui/sidebar/LeftSidebar.tsx`** — `MIN_WIDTH = 180` :14, `MAX_WIDTH = 480` :15;
`interface LeftSidebarProps { width; onWidthChange; collapsed; onAddFile; onAddFiles; onAddUrl; loading; onFlyToLayer?; onFlyToGeoLayer? }` :17-29;
`export function LeftSidebar(props)` :31. Returns `null` when `collapsed` :91.
Markup: `<aside className="left-sidebar" style={{width}}>` :94 → `.left-sidebar-content` :95 containing
**`<BasemapPanel/>` :96, `<GoogleTilesPanel/>` :97, `<LayerPanel .../>` :98** — then
`.left-sidebar-handle` :107 (pointer-drag resize :54-89).

**`src/ui/layers/LayerPanel.tsx`** — `interface LayerPanelProps { onAddFile; onAddFiles; onAddUrl; loading; onFlyToLayer?; onFlyToGeoLayer? }` :47-56;
`export function LayerPanel(props)` :58. Local state: `renamingId` :83, `renameValue` :84,
`addDialogTab: SourceTab | null` :88.
Two sections:

1. `3D City Models ({layers.length})` heading :106-119 with a `+` opening the dialog on the `"city"` tab :115
2. `Geospatial Layers ({geoLayers.length})` heading :286-299 with a `+` opening on `"geo"` :295,
   rows via `<GeoLayerRow>` :307, empty text :301-304
   Plus `<StreamingLodControl/>` :281 (between the two sections) and the shared
   `+ Add Layer` button :319-326 (opens on `"geo"` :323), and `<AddLayerDialog>` :328-337.

**City layer row anatomy** (`:121-275`), left to right:

- container `div.layer-item` + `layer-active` (`layer.id === activeLayerId` :122) + `layer-hidden` :127;
  **row click** :128-133 sets `setActiveLayer(layer.id)` **and** `setActiveGeoLayer(null)`
- `button.layer-vis-btn` :135-147 → `updateLayer(id, {visible: !visible})`, icon `VisibilityIcon`
- name: `input.layer-name-input` while renaming :150-161 (Enter commits, Escape cancels) or
  `span.layer-name` with `onDoubleClick` to start rename :163-172
- `span.layer-badge-streaming` "STREAM" :175-182 when `layer.isStreaming`
- `<LayerObjectCount layer/>` :184 (component :364; static = `Object.keys(model.objects).length`,
  streaming = `getResidentModel(...).featureCount` with a resident-cache tooltip)
- streaming branch :192-215: `<AppearanceSelector layerId themes={streamThemes[id]} selected texturesResolvable/>`
  - `button.layer-sync-btn` toggling `setCameraSync` (label `SYNC`/`FROZEN`) :200-214
- static branch :216-232: `<LodSelector layerId availableLods selectedLod isStreaming lodMode/>` :218
  - `<AppearanceSelector .../>` :225
- `div.layer-actions` :234-268: "Zoom to layer" `<ZoomToLayerIcon/>` → `onFlyToLayer(layer.id)` :242-245;
  "Remove layer" `<TrashIcon/>` → `closeStreamingLayer(getStreamPlugin(), layer.id)` **then**
  `removeLayer(layer.id)` :256-264
- `<LayerTypeToggles layer/>` :273 — last, because it wraps to a full-width block

Geo layer row: `src/ui/layers/GeoLayerRow.tsx` (`isActive` from `activeGeoLayerId` :43-46) — identity +
actions only; drawing config lives in `GeoLayerInspector` (§2.3).

### 6.6 Every prop `ViewerToolbar` receives (`App.tsx:1327-1343`)

`pickMode={mode}`, `toolMode={toolMode}`, `onSetPickMode={setMode}`, `onSetToolMode={setToolMode}`,
`onClose={handleClose}`, `onToggleInspector={() => setInspectorOpen(o => !o)}`,
`onToggleLeftSidebar={() => setLeftSidebarCollapsed(o => !o)}`, `onFitAll={handleFitAll}`,
`onSave={handleSave}`, `onShare={handleShare}`, `canShare={hasUrlLayers}`, `theme={theme}`,
`onToggleTheme={toggleTheme}`, `advancedSettingsOpen={advancedSettingsOpen}`,
`onToggleAdvancedSettings={() => setAdvancedSettingsOpen(o => !o)}`.
`interface ViewerToolbarProps` at `src/ui/toolbar/ViewerToolbar.tsx:38-54`; the component **reads no store
at all** (:10). Its own children: `RoofyLockup` :80, sidebar toggle :83, pick-mode group :98-169
(box-select :132 and measure :154 are hard-`disabled`, `NAVARA_DEAD_TOOL_TITLE` :35), fit-all :172,
`<ViewModeToggle/>` :186, `<SceneThemeMenu/>` :189, `<SolarMenu/>` :197, `<WeatherMenu/>` :202,
advanced-settings gear :206-219, `<ThemeToggleButton/>` :221, save :223, share :241, inspector toggle :256,
close :268.

### 6.7 Add-layer routes and detection

**`src/ui/layers/AddLayerDialog.tsx`** — `interface AddLayerDialogProps { onClose; onAddFile; onAddFiles; onAddUrl; loading; initialTab? }` :37-51;
**`export type SourceTab = "city" | "geo" | "stac"`** :63 (default `"geo"` :74);
`export function AddLayerDialog(props)` :65. React portal to `document.body` :130/:243;
`useModalChrome(dialogRef, onClose)` :77 (Escape / focus trap / restore / scroll lock);
backdrop `mousedown` close :82-94; `swallowDrag` :98-101.
Three tab panels :202-239:

- `"stac"` → `<StacBrowser onAddUrl={onAddUrl}/>` :212 — deliberately does **not** close the dialog
- `"city"` → `<SourcePicker variant="panel" onFile={handleFile} onFiles={handleFiles} onUrl={handleUrl} loading/>` :220-226 — each closes the dialog
- `"geo"` → `<GeospatialSourceForm onAdded={onClose}/>` :237 — writes to `geoLayerStore` directly, no app loading path

**`src/ui/layers/SourcePicker.tsx`** — `ACCEPT = ".json,.city.json,.jsonl,.city.jsonl,.fcb,.gml,.citygml,.parquet"` :27,
`export const SUPPORTED_FORMATS` :32; `interface SourcePickerProps { onFile; onFiles?; onUrl; loading; variant?: "hero"|"panel"; showFormatHint? }` :35-63;
`export function SourcePicker(props)` :65. Drag depth counter :92, `isFileDrag` :94,
`containsDirectory(dt)` :101 (a dropped **folder** is refused with a hint :170-175),
`emitFiles(files, alwaysGroup?)` :145 (group ⇒ `onFiles`, else `onFile`), `handleDrop` :157,
`handleFolderChange` :184 (`webkitdirectory` input :266-272, always groups), `handleBrowse` :194,
`handleSubmit` :204 (URL form). Markup: `.source-picker.source-picker-${variant}` :216, `.drop-zone` :218,
`.file-label-row` with "Browse files" :235 / "Choose folder" :245, `.fcb-url-form` :283.

**Detection** (routing, not in the picker):

- `detectEncoding(nameOrUrl): CityModelEncoding` — `src/domain/citymodel/detectEncoding.ts:30`
- `isCityParquetUrl(raw)` / `classifyCityParquetUrl(raw)` / `type CityParquetSource` /
  `class UnlistableUrlError` — `src/features/cityparquet/sourceClassify.ts:244 / :177 / :33 / :64`
- `classifyGeoUrl(url): GeoLayerKind`, `geoLayerNameFromUrl`, `geoLayerFromUrl`,
  `parseGeoJsonText` — `src/features/geoLayers/classifyGeoSource.ts:39 / :53 / :84 / :121`
- `useLayerFileLoader(options)` — `src/features/layers/useLayerFileLoader.ts:151`
  (`interface LayerOverrides` :49, `interface LayerFileLoader` :99, `interface LayerFileLoaderOptions` :134);
  `addLayerFromFile` :186, `addLayerFromFiles` :290, `addLayerFromUrl` :329
- `addCityLayer(input)` — `src/features/layers/addCityLayer.ts:130` (`AddCityLayerInput` :32,
  `urlSourceProvider` :50, `fileSourceProvider` :67, `modelTableSource` :87)

---

## 7. Scene controls

All of these read/write stores directly and take (almost) no props — the toolbar and sidebar are pure
containers.

### 7.1 `src/ui/toolbar/SolarMenu.tsx`

`export function SolarMenu()` :66 — no props. Drives **`useSolarStore`** only: `datetime`/`setDatetime` :67-68,
`timeAnimating`/`setTimeAnimating` :69-70, `timeSpeed`/`setTimeSpeed` :71-72, `sunPosition` (read-only
readout) :73. Local `open` popover state :75. `PRESET_DATES` :45, `PRESET_TIMES` :51 (a date×time grid of
preset buttons :277-291, plus a "Now" button :293). Markup: `.toolbar-solar-menu` trigger :137 (the clock is on
its face), popover `.toolbar-solar-popover.solar-menu-popover` :170, `.solar-menu-summary` :178,
`.solar-scrubber-row` day/time/speed sliders :186-252, `.solar-scrubber-actions` :253,
`.solar-presets` :277, `.solar-now-btn` :293.
**`sunWriter`** (`src/scene/sunWriter.ts`) is the other half: `interface Xyz` :29,
`siteEnuFrame(latLon): EnuFrame` :41, `sunPositionFromEcef(frame, ecef): SunPosition` :46. The atmosphere
owns sun position and publishes an **ECEF** unit vector; `NavaraViewport` subscribes and calls this to convert
to local **ENU**, then `useSolarStore.setSunPosition(...)`. `useSolarStore.setLatLon` is pushed by
`NavaraViewport` from the live layer handles' geodetic bounds. Animation loop: `src/scene/timeAnimation.ts`;
clock maths `src/features/solar/solarClock.ts`.

### 7.2 `src/ui/toolbar/SceneThemeMenu.tsx` + `src/scene/sceneThemePolicy.ts`

`export function SceneThemeMenu()` :46 — reads `useSceneThemeStore` `theme` :47 / `setSceneTheme` :48; renders a
radio list from `SCENE_THEMES` inside `.toolbar-theme-menu` :94 / `.scene-theme-popover` :118 /
`.scene-theme-list` :128.
**The four themes** are `"photoreal" | "cartoon" | "cyber" | "wireframe"`
(`src/features/sceneTheme/sceneThemeStore.ts:19`); photoreal is the default and pushes nothing.
Policy exports (`src/scene/sceneThemePolicy.ts`):

- `interface ThemeEnvironment` :43 — `skyVisible` :46, `starsBoost` :49, `skyBoxColors` :56, `glowGlobe` :63,
  `fogLights` :79, `bloom` :110, `globeWireframe` :117, `globeColor` :120,
  `toneMappingMode: "AGX"|"LINEAR"|null` :123, `exposure` :126, `sunIntensity` :132,
  `skyLightProbeIntensity` :134, `lensFlareOff` :144
- `type ThemeBloom` :149
- `interface SceneThemePolicy { meshStyle: ThemeStyle; basemapOverride: BasemapId|null; googleTilesOff: boolean; environment: ThemeEnvironment }` :151-165
- `sceneThemePolicy(theme)` :449, `isBasemapOverridden(theme)` :458, `areGoogleTilesOverridden(theme)` :462,
  `THEME_OVERRIDE_HINT = "Overridden by the scene theme"` :467
  **What Cyber overrides** (`POLICIES.cyber` :318-…): `meshStyle: CYBER_STYLE` :319;
  **`basemapOverride: "carto-dark"`** :322 (takes the basemap picker out of the user's hands);
  **`googleTilesOff: true`** :323; environment — `skyVisible: false` :326,
  `starsBoost {pointSize: 2.5, intensity: 30}` :331, `skyBoxColors {day 0x142a66, night 0x080f2b, sun 0x3350aa}` :335-339,
  `glowGlobe {0x00e5ff, opacity 0.55}` :340, `fogLights {count 16, magenta/cyan, radius 150, …}` :351-…,
  plus bloom/exposure/sun-intensity values. Themes never write another store (`sceneThemeStore.ts:12-15`) —
  they are a presentation overlay, which is why `BasemapPanel`/`GoogleTilesPanel` show `THEME_OVERRIDE_HINT`
  rather than mutating their own stores.

### 7.3 `src/ui/toolbar/WeatherMenu.tsx` + atmosphere store

`export function WeatherMenu()` :35 — no props. Reads **both** `useAtmosphereStore`
(`cloudCoverage`/`setCoverage` :36-37, `lensFlareEnabled`/`setLensFlareEnabled` :38-39,
`precipitation`/`setPrecipitation` :40-41) **and** `useRenderDebugStore`
(`postProcessingEnabled` :42, `cloudsEnabled`/`setCloudsEnabled` :45-46 — the clouds pass switch lives in the
render-debug store, not the atmosphere store). Markup `.toolbar-weather-menu` :87,
`.weather-menu-popover` :107, `.weather-menu-hint` :179 (explains dead controls when post-processing is off).

### 7.4 `src/ui/viewport/RenderingPanel.tsx` ("Advanced Settings")

`interface RenderingPanelProps { onClose: () => void }` :39-41; `export function RenderingPanel({onClose})` :43.
Reads `useRenderDebugStore` (`sunShadowsEnabled` :56, `exposure`/`setExposure` :60-61, `reset` :68) and
`useAtmosphereStore.reset` :69 — **one footer action resets both stores**. Mounted by `App.tsx:1371-1373`
inside `.viewport`, gated on `advancedSettingsOpen` (toolbar gear, `ViewerToolbar.tsx:206-219`).

### 7.5 `src/ui/layers/BasemapPanel.tsx` + `src/ui/layers/GoogleTilesPanel.tsx`

Both live **in the left sidebar, above the layer panel**: `LeftSidebar.tsx:96` and `:97`.

- `BasemapPanel()` :41 — `useBasemapStore` `basemapId`/`setBasemapId` :42-43, plus
  `heatmap`/`setHeatmap` :97-98 for the elevation-heatmap sub-controls;
  `overridden = useSceneThemeStore((s) => isBasemapOverridden(s.theme))` :44
- `GoogleTilesPanel()` :18 — `enabled = useTilesStore((s)=>s.enabled) && HAS_API_KEY` :21,
  `setEnabled` :22, `overridden` from `areGoogleTilesOverridden` :25

### 7.6 `src/ui/viewport/CameraControls.tsx` + `src/ui/toolbar/ViewModeToggle.tsx`

- `interface CameraControlsProps { onResetNorth; onZoomIn; onZoomOut; onTiltUp; onTiltDown }` :32-41;
  `export function CameraControls(props)` :43; also reads `useViewModeStore((s)=>s.mode)` :59 to disable tilt
  in 2D. **Mounted inside `NavaraViewport` itself** (`NavaraViewport.tsx:3554-3560`), not by `App` — the five
  callbacks are the viewport's own local camera functions (`resetNorth`, `zoomIn`, `zoomOut`, `tiltUp`,
  `tiltDown`), **not** methods on the `CitySceneHandle`. Their pure maths is in
  `src/scene/cameraControls.ts`: `ZOOM_IN_FACTOR = 0.67` :40, `ZOOM_OUT_FACTOR` :43, `TILT_STEP_DEG = 10` :45,
  `MIN_PITCH_DEG = -89` :57, `MAX_PITCH_DEG = -5` :58, `interface PitchLimits` :64,
  `DEFAULT_PITCH_LIMITS` :70, `normaliseHeading` :128, `zoomedCamera` :221, `tiltedCamera` :253,
  `northedCamera` :269, `compassRotationDeg` :287, `formatBearing` :294, `cardinalFor` :303, `formatTilt` :310.
- `export function ViewModeToggle()` :31 — no props; `useViewModeStore` `mode` :32 / `setViewMode` :33;
  segmented control `.view-mode-toggle` :36. It does **not** call the viewport handle: the viewport watches
  `viewModeStore` and applies `src/scene/viewModePolicy.ts` (controller flags + entry flight) itself.
  So: `fitAll` and `flyTo` are handle calls; `setViewMode` is a store write.

### 7.7 `src/ui/viewport/AddressSearch.tsx`

`interface AddressSearchProps { onFlyTo: (target: FlyToTarget, durationMs?: number) => void }` :37-42;
`export function AddressSearch({onFlyTo})` :44. **Mounted inside `NavaraViewport`** (`:3549`), wired directly
to the viewport's own `flyTo` — it never goes through `App`. Geocoding: `src/features/geocode/photon.ts`
and `src/features/geocode/useAddressSearch.ts`. Height selection constants in `geographicCamera.ts`:
`DEFAULT_SEARCH_HEIGHT_M = 1500` :215, `MIN_SEARCH_HEIGHT_M = 400` :218, `MAX_SEARCH_HEIGHT_M = 50_000` :221,
`cameraHeightForExtent` :232; viewport-side `SEARCH_PITCH_DEG = -60` (`NavaraViewport.tsx:290`) and
`SEARCH_FLIGHT_MS = 1200` :294.

---

## 8. The viewport imperative handle

`src/scene/NavaraViewport.tsx`:

```ts
export interface CitySceneHandle {
  // :187
  fitAll: () => void; // :188
  fitLayer: (layerId: string) => void; // :189
  fitBounds: (bounds: GeodeticBounds) => void; // :194
  alignView: (direction: ViewDirection) => void; // :195
  getCameraState: () => GeographicCameraState | null; // :196
  setCameraState: (state: GeographicCameraState) => void; // :197
  flyTo: (target: FlyToTarget, durationMs?: number) => void; // :208
  readonly ready: Promise<void>; // :212
  getStreamingPlugin(): Promise<FlatCityBufPlugin>; // :222
}
```

There is **no `setViewMode`** on the handle — the view mode is a store the viewport watches
(`src/features/viewMode/viewModeStore.ts`, applied via `src/scene/viewModePolicy.ts`).
`useImperativeHandle` at `:3497-3532`; `ready` is a **getter** reading `readyRef` :3518-3520 because the
lifecycle cleanup re-arms the gate.

`export interface NavaraViewportProps { onTriangleCount; onFps?; onCursorPosition?; onLayerError? }` :225-232.
`export const NavaraViewport = forwardRef<CitySceneHandle, NavaraViewportProps>(...)` :1205.
Supporting types: `ViewDirection` (`src/scene/geographicCamera.ts:29`),
`GeographicCameraState` :37, `FlyToTarget { lng; lat; heightM }` :206,
`GeodeticBounds` (from `@cityjson/navara-cityjson`).
Camera helpers: `unionGeodeticBounds` :111, `boundsDiagonalMetres` :192, `fitDistanceMetres` :270,
`cameraForBounds` :292, `alignCameraForBounds` :342, `METRES_PER_DEGREE_LAT` :49.
Module invariants: `engineSlot` :259 serialises engine lifetimes across mounts; `mountedViewports` :267 —
**at most ONE `NavaraViewport` may be mounted at a time** (worker-pool singleton). Other constants:
`SUN_SHADOW_TUNING` :524, `POSE_PUBLISH_MS = 100` :283, `PRECIPITATION_HEIGHT_M = 150` :272.

**Auto-fit on layer add** — `NavaraViewport.tsx:2380`: after `syncLayers`, if `liveRef.current.size > before`
then `setFitToken(t => t + 1)`; a separate effect :2393-2407 consumes the token exactly once
(`handledFitTokenRef` :2400) and calls `fitAll()` :2406 **unless** `isAutoFitSuppressed()` :2405.
Suppression API: `src/scene/autoFitSuppression.ts` — `suppressAutoFit(): () => void` :47 (depth counter :32),
`isAutoFitSuppressed()` :58. Used by `App.handleRestore` :703 and by the share-hash effect :1010.
Overlays rendered by the viewport itself :3534-3578: `.navara-viewport` / `.navara-viewport__canvas` /
`.navara-viewport__error`, `<AddressSearch>` :3549, `<CameraControls>` :3554, `<StreamQueryBoxOverlay>` :3564,
`<ScaleBar>` :3568, `<AttributionOverlay>` :3573.

---

## 9. Streaming (FlatCityBuf) specifics

### 9.1 How a streaming layer differs in the layer store

There is **no `kind` and no `encoding` field on `Layer`** — the discriminator is the boolean
`Layer.isStreaming` (`src/features/layers/layerStore.ts:56`), set at add time from
`addLayer({ isStreaming: true })` (:133-135, applied :285). Consequences encoded in the store:

- `model` is a **stub** (bbox only, empty `objects`) :20 + :92-94
- `appearanceThemes: []` :260-262 and `availableObjectTypes: []` :293-295 — both are _learned_
  (`useStreamStore.appearanceThemes` / `.types`)
- `selectedLod`/`lodMode` are ignored for streaming; the LoD comes from the **global** `useStreamLodStore`
  (`src/features/streaming/streamLod.ts:15-21`)
- `cameraSync` :51 is the one per-layer streaming control
- `visibleObjectIds` has no streaming equivalent, so "Filter map" is disabled (`TablePanel.tsx:195-199`)
- persistence records the source separately as `LayerSnapshot.stream: StreamSourceSnapshot`
  (`src/persistence/types.ts:51-53`, :75)

### 9.2 Store state (see §1.5 for the full field list)

`StreamState.status: StreamStatus` (`"idle"|"probing"|"fetching"|"too-far"|"error"` — see
`src/ui/StatusBar.tsx:143-175`), `message`, `level` (the tile level the last commit **settled** on),
`ladder`/`ladderVersion`, `types`/`typesVersion`, `appearanceThemes`, `grid`, `header`, `handle`, `disposers`,
and `version` (bumped per cell commit — the resident-count trigger).
Resident counts are **not** in the store: `getResidentModel(layerId, version)`
(`src/features/streaming/residentModel.ts:46`) returns `{ objects, featureCount, cellCount, surfaceAttrKeys }`,
memoised on `version`. Consumers: `LayerPanel.LayerObjectCount` (`LayerPanel.tsx:364-384`),
`useTotalObjectCount()` (`src/features/streaming/useTotalObjectCount.ts:30` — static objects + resident
features), `InspectorPanel` :176-179, `RuleBuilderTab` :83-87.
Also: `useObjectSurfaces(handle, objectId)` + `type SurfacesFetchState`
(`src/features/streaming/useResidentSurfaces.ts:34 / :21`);
`presentStreamStatus` / `streamToneDotClass` / `StreamStatusTone` / `StreamStatusPresentation`
(`src/features/streaming/streamStatusPresentation.ts:31 / :62 / :18 / :20`).

### 9.3 Lifecycle

`src/features/streaming/openStreamingLayer.ts` — `interface OpenStreamingLayerInput` :40,
`openStreamingLayer(input)` :61, `closeStreamingLayer(plugin, layerId)` :186,
`closeAllStreamingLayers(plugin)` :213.
`src/features/streaming/streamPlugin.ts` — `interface StreamPlugin` :37, `setStreamPlugin` :48,
`getStreamPlugin` :53, `requireStreamPlugin` :67 (a module-level singleton the viewport registers).

### 9.4 `src/ui/layers/StreamingLodControl.tsx`

`export function StreamingLodControl()` :29 — **no props**. Reads `useLayerStore` `layers`/`setLayerLod`/
`setLodMode` :30-32 and `useStreamStore.streams` :33; it is the UI for the **global** stream LoD
(`unionLadder` over every open stream, and `autoLodDescription` for the auto read-out).
Mounted at `LayerPanel.tsx:281`, inside the "3D City Models" section, below the city rows. Renders nothing
when no stream is open. CSS section "STREAMING LAYER CONTROLS" `src/app/app.css:4462`.

### 9.5 `src/ui/viewport/StreamQueryBoxOverlay.tsx`

`export function StreamQueryBoxOverlay(): ReactElement | null` :27 — no props. Reads
`useRenderDebugStore((s)=>s.streamQueryBoxEnabled)` :28, `useQueryRegionStore((s)=>s.regions)` :29 and
`useLayerStore((s)=>s.layers)` :36 for names. Mounted inside `NavaraViewport` :3564. The blue ground outline
itself is a `smoothLines` mesh added/removed by the viewport's query-box effect; the store is only populated
while the diagnostic is on (`src/features/streaming/queryRegionStore.ts:12-15`).
CSS section "STREAMING FETCH-BBOX READOUT" `src/app/app.css:3491`.

### 9.6 Streaming sync surface

`interface StreamInteractionHandle extends InteractionHandle` (`src/scene/handleSync.ts:272`) adds
`setRules` :273, `setLod(mode, lod)` :274, `setVisible` :275, `setCameraSync` :278, `setThemeStyle` :282,
`setHiddenTypes` :285, `setAppearance` :288, `onCommit(cb)` :292, `lastQueryRegion()` :305,
`onQueryRegion(cb)` :306.
`interface StreamSyncMemo` :314; `syncStreamState(layer, handle, memos, themeStyle?)` :355.

---

## 10. Types index

- **`Layer`** — `src/features/layers/layerStore.ts:17-104` (every field listed in §1.1)
- **`Selection`** — `src/domain/selection/types.ts:24` =
  `ObjectSelection {kind:"object"; layerId; objectId}` :11-15 | `SurfaceSelection {kind:"surface"; layerId; objectId; surfaceIndex}` :17-22.
  Also `type PickMode = "object" | "surface"` :8, `type ToolMode = "select" | "box-select" | "measure"` :9,
  `interface GeoFeatureSelection { geoLayerId; batchId; properties }` :35-41 — deliberately **not** part of
  the `Selection` union (:26-34).
- **`GeoLayer`** — `src/features/geoLayers/geoLayerStore.ts:83-95` (discriminated union over
  `"geojson" | "raster-xyz" | "3d-tiles"`, each with its own `config`), on top of
  `GeoLayerBase {id; name; visible; opacity; style}` :62-76. Configs :35 / :43 / :52.
  `GeoLayerStyle` in `src/features/geoLayers/geoLayerStyle.ts`.
- **Rules** — `Rule`, `Condition`, `ConditionOperator`, `LogicMode`:
  `packages/cityjson-navara-plugins/packages/navara-core/src/rules/types.ts:10-28`, re-exported from
  `src/features/rules/types.ts:14-19`. `RoofMetrics` (the metric fields rules can name):
  `packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics/types.ts:6-15`.
- **Query/filter** — `src/features/query/types.ts` (§3.4)
- **Persistence** — `src/persistence/types.ts` (§5.1)
- **Insights** — `ColumnInfo`/`ColumnKind`/`LodColumn` `src/insights/columnKind.ts:34/:32/:90`;
  `LayerTable`/`LayerTableState` `src/insights/layerTables.ts:122/:140`;
  `DuckDBStatus`/`QueryOutcome` `src/insights/duckdb.ts:41/:62`;
  `ModelStats`/`ObjectStats`/`OrientationCount` `src/insights/types.ts:10/:22/:5`
- **Scene** — `CitySceneHandle` `src/scene/NavaraViewport.tsx:187`;
  `LiveLayer`/`CityModelRegistry`/`InteractionHandle`/`StreamInteractionHandle`/`StreamSyncMemo`/`HighlightMemo`
  `src/scene/handleSync.ts:40/:81/:239/:272/:314/:532`;
  `PickIntent`/`RaycastResolver`/`SelectionActionsSubset`/`ClickGate`/`EnginePickStash`
  `src/scene/pickEventHandlers.ts:36/:55/:65/:202/:316`;
  `SceneThemePolicy`/`ThemeEnvironment` `src/scene/sceneThemePolicy.ts:151/:43`

---

## 11. Tests

Runner: Vitest 4 in `jsdom` (`vitest.config.ts` — `environment: "jsdom"`,
`setupFiles: ["./vitest.setup.ts"]`, `include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`).
`vitest.setup.ts` is one line: `import "@testing-library/jest-dom/vitest";`.
Layout mirrors `src/`: `tests/unit/{app,domain,features,insights,persistence,platform,scene,ui}` and
`tests/integration/` (`duckdb/harness.ts`, `layerTables.test.ts`, `fcbStreaming.test.ts`,
`loadCityJSONSeq.test.ts`, `loadToInspect.test.ts`). ~150 test files.

**UI test pattern** (e.g. `tests/unit/ui/table/TablePanel.test.tsx`):

- `@testing-library/react` `render`/`screen`, `@testing-library/user-event`
- `beforeEach` resets every touched store with `setState` — the canonical block
  (`tests/unit/ui/table/TablePanel.test.tsx:129-132`):
  `useLayerStore.setState({ layers: [], activeLayerId: null })`,
  `useLayerTableStore.setState({ tables: {}, tablePanelOpen: false })`,
  `useQueryStore.setState({ queries: {} })`, `useSelectionStore.setState({ selections: [] })`.
  **There is no SHARED store-reset helper** — each test file writes its own `setState` block. Two files
  define a local one (`resetStores()` at `tests/unit/app/appEngineBoot.test.tsx:389`, used at :395/:398;
  `resetPhotorealHandles()` at `tests/unit/scene/navaraViewport.test.tsx:191`), and `src/` exports two
  registry resets: `resetLayerTablesForTest()` (`src/insights/layerTables.ts:342`) and
  `resetExportCounterForTests()` (`src/insights/export.ts:148`).
- Fixtures are local factories, e.g. a `layer()` builder per file.

**What is mocked for `NavaraViewport`** — every `tests/unit/app/*.test.tsx` mocks the whole module with a
`forwardRef` stub that publishes a fake `CitySceneHandle` through `useImperativeHandle`
(`tests/unit/app/appEngineBoot.test.tsx:71-94` is the reference implementation).
**Paraphrased** for brevity — read :71-94 for the verbatim form, which uses arrow-property members
(`fitAll: () => {}`) and a `viewportPublishesHandle` flag (:69) so the timeout case can publish `null`:

```tsx
vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(
        ref,
        () =>
          ({
            fitAll() {},
            fitLayer() {},
            fitBounds() {},
            alignView() {},
            getCameraState: () => null,
            setCameraState() {},
            ready: Promise.resolve(),
            getStreamingPlugin: async () => streamPluginStub,
          }) as unknown as CitySceneHandle,
        [],
      );
      return <div data-testid="navara-viewport" />;
    },
  ),
}));
```

Alongside it the app tests also mock `src/insights/duckdb` (`appEngineBoot.test.tsx:97`),
`src/features/streaming/openStreamingLayer` (:120), `src/ui/stac/StacBrowserDialog`
(`appCatalogEntry.test.tsx:93`) and partially mock `src/insights/layerTables`
(`appCityParquetLayers.test.tsx:148`, via `importOriginal`).
jsdom shims applied per file: `window.matchMedia` (`appRestoreShare.test.tsx:53-64`) because `useTheme`
reads it on first render. `appRestoreShare.test.tsx` additionally drives a controllable `ready` gate
(:80-97) and asserts on `isAutoFitSuppressed()` (:44).
Files covering the areas this map touches:
`tests/unit/features/layers/layerStore.test.ts`, `layerStoreVisibleIds.test.ts`,
`tests/unit/features/selection/selectionStore.test.ts`, `tests/unit/features/query/{queryStore,mapFilterSync}.test.ts`,
`tests/unit/scene/{handleSync,handleSyncVisibleIds,handleSyncAppearance,pickEventHandlers,sceneThemePolicy,viewModePolicy}.test.ts`,
`tests/unit/scene/navaraViewport*.test.tsx` (6 files),
`tests/unit/persistence/{snapshotV3,captureRestore,urlShare,localStorage,geoLayerSnapshot,layerAppearanceSnapshot}.test.ts`,
`tests/unit/ui/inspector/*`, `tests/unit/ui/table/*`, `tests/unit/ui/layers/*`, `tests/unit/ui/toolbar/*`,
`tests/unit/ui/viewport/*`, `tests/unit/app/*`.

**Browser smoke** — `scripts/smoke/`:

- `driver.mjs` — a persistent Chrome DevTools Protocol driver with a tiny HTTP command port:
  `node driver.mjs <cdpPort> <httpPort> <appUrl>`; commands `/eval`, `/click {x,y}`, `/key {key}`,
  `/shot {path}`, `/dump` (console + exceptions + network), `/clearlog`, `/quit`.
- `px.mjs` — a minimal PNG decoder + region probe (`node px.mjs <a.png> <b.png> <x> <y> <w> <h>`) for
  screenshot diffing.
- `duckdb-table-and-export.md` — the written smoke script for the table/export flow.
  These are **manual**, not wired into `npm test` (`package.json` `test: "vp test run"`).

---

## 12. CSS

`src/app/brand.css` is loaded first (`App.tsx:3`), then `src/app/app.css` (:4). Brand tokens (`--layer-*`,
the lockup, light-theme flips) live in `brand.css`; `app.css` derives the surface/text tokens from them.

### 12.1 Layout grid

```css
.viewer-shell {
  /* app.css:602 */
  display: grid;
  grid-template-rows: var(--toolbar-h) 1fr var(--table-h, 0) var(--statusbar-h); /* :604 */
  grid-template-columns: var(--left-panel-w) 1fr var(--panel-w); /* :605 */
  grid-template-areas:
    "toolbar  toolbar  toolbar"
    "left     viewport panel"
    "table    table    table"
    "status   status   status"; /* :606-610 */
  height: 100vh;
}
.viewer-shell.panel-collapsed {
  grid-template-columns: var(--left-panel-w) 1fr 0;
} /* :616 */
.viewer-shell.left-collapsed {
  grid-template-columns: 0 1fr var(--panel-w);
} /* :620 */
.viewer-shell.left-collapsed.panel-collapsed {
  grid-template-columns: 0 1fr 0;
} /* :624 */
```

Default token values (`:54-57`): `--toolbar-h: 2.75rem`, `--statusbar-h: 1.75rem`,
`--left-panel-w: 240px`, `--panel-w: 320px`. `--left-panel-w` and `--table-h` are overwritten inline by
`App.tsx:1320-1323`; **`--table-h` is only set when `tableOpen`**, and the grid falls back to `0` otherwise.
`grid-area` assignments: `.toolbar` :633, `.left-sidebar` :716, `.viewport` :752, `.inspector` :1224,
`.statusbar` :1398, `.table-panel` :3181.
The landing branch uses `.app-shell` instead (capped at 960px, `:161` note).

### 12.2 Section map of `src/app/app.css` (4871 lines; `/* ═══ TITLE ═══ */` banners)

| start line | section                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1          | DESIGN TOKENS (derived from brand.css)                                                                                             |
| 60         | LIGHT THEME                                                                                                                        |
| 107        | RESET & BASE                                                                                                                       |
| 201        | LANDING PAGE (incl. `/* ---- the two entry paths ---- */` :253)                                                                    |
| 598        | **VIEWER SHELL — CSS Grid layout**                                                                                                 |
| 628        | TOOLBAR                                                                                                                            |
| 707        | TOOL RAIL                                                                                                                          |
| 711        | LEFT SIDEBAR (basemap picker :763)                                                                                                 |
| 747        | VIEWPORT (`.navara-viewport` :774, canvas :781, attributions :806)                                                                 |
| 831        | SELECTION TOOLTIP                                                                                                                  |
| 865        | HOVER TOOLTIPS — icon-only buttons                                                                                                 |
| 970        | ADVANCED SETTINGS PANEL                                                                                                            |
| 1062       | SOLAR SCRUBBER                                                                                                                     |
| 1219       | INSPECTOR PANEL (attribute sections :1298, section `+` :1324, surface breakdown :1361)                                             |
| 1393       | STATUS BAR                                                                                                                         |
| 1472       | PICK MODE TOGGLE                                                                                                                   |
| 1489       | M2: ANALYSIS TAB                                                                                                                   |
| 1529       | M2: RULE BUILDER (preset grid :1801, import/export :1830)                                                                          |
| 1861       | M2: LEGEND OVERLAY (per-layer group :1914)                                                                                         |
| 1946       | SOLAR PRESETS (toolbar popover)                                                                                                    |
| 1999       | TOOLBAR SOLAR CLUSTER (weather popover :2053, scene theme picker :2078, theme-override hint :2149, inspector-tab tightening :2159) |
| 2165       | M5: ERROR BOUNDARY (inline boundary :2249)                                                                                         |
| 2282       | M5: LOADING INDICATOR                                                                                                              |
| 2314       | M5: TOAST                                                                                                                          |
| 2345       | M5b: UNAVAILABLE LAYERS                                                                                                            |
| 2406       | LAYER PANEL (type toggles :2602, geospatial section :2672, geo style in inspector :2761)                                           |
| 2882       | THEME TOGGLE                                                                                                                       |
| 2907       | TOOLBAR INLINE SEPARATOR                                                                                                           |
| 2918       | STATUS BAR ADDITIONS                                                                                                               |
| 2936       | BOX SELECT OVERLAY (dead code — the tool is disabled)                                                                              |
| 2948       | MEASURE LABEL (dead code — the tool is disabled)                                                                                   |
| 2965       | ATTRIBUTE PANEL (floating overlay)                                                                                                 |
| 3136       | AGGREGATION MODE SELECT                                                                                                            |
| 3176       | TABLE PANEL (bottom database view)                                                                                                 |
| 3491       | STREAMING FETCH-BBOX READOUT                                                                                                       |
| 3552       | SOURCE PICKER (shared: landing hero + Add Layer dialog; panel skin :3636)                                                          |
| 3728       | MODAL (Add Layer dialog)                                                                                                           |
| 3859       | SHARE DIALOG                                                                                                                       |
| 3962       | STAC CATALOG BROWSER                                                                                                               |
| 4282       | CAMERA CONTROLS — compass + zoom/tilt cluster                                                                                      |
| 4462       | STREAMING LAYER CONTROLS                                                                                                           |
| 4511       | ADDRESS SEARCH (scene overlay, top-left)                                                                                           |
| 4669       | VIEW MODE TOGGLE (toolbar)                                                                                                         |
| 4708       | SCALE BAR (viewport overlay)                                                                                                       |

Key class names by owner: `.viewer-shell` / `.app-shell` (App), `.toolbar` + `.tb-btn` + `.toolbar-sep` +
`.toolbar-spacer` (ViewerToolbar), `.left-sidebar` + `.left-sidebar-content` + `.left-sidebar-handle`
(LeftSidebar), `.attr-section` + `.attr-section-title` + `.layer-item` + `.layer-active` + `.layer-hidden`
(LayerPanel), `.viewport` + `.navara-viewport` (App/NavaraViewport), `.inspector` + `.inspector-header` +
`.inspector-tabs` + `.inspector-tab` + `.inspector-body` + `.inspector-placeholder` (InspectorPanel),
`.table-panel` + `.table-panel-header` + `.table-panel-body` + `.data-table` + `.table-pagination`
(table), `.statusbar` + `.status-item` + `.status-dot` + `.status-value` (StatusBar),
`.attribute-panel` (AttributePanel), `.legend-overlay` (LegendOverlay), `.toast` (App).
Tooltips are attribute-driven: `data-tooltip` / `data-tooltip-pos` / `data-tooltip-align` (CSS at :865).

---

## Coupling hot spots

Where a "one active layer + one selection" model fights the code as it stands today.

1. **Two competing "active layer" ids in two stores.** `layerStore.activeLayerId`
   (`src/features/layers/layerStore.ts:108`) and `geoLayerStore.activeGeoLayerId` (`geoLayerStore.ts:159`)
   are independent, and the inspector treats the geo one as an override that **replaces the entire city
   view** (`InspectorPanel.tsx:287`). Two effects in `App.tsx` (:505-507, :508-510) and the row click in
   `LayerPanel.tsx:128-133` hand-maintain the "only one at a time" invariant across three call sites.

2. **Five copies of the active-layer resolution.** `layers.find(l => l.id === activeLayerId) ?? layers[0]`
   at `App.tsx:649`, `App.tsx:1309`, `InspectorPanel.tsx:148`, `TablePanel.tsx:54`, `StatusBar.tsx:51`.
   The `?? layers[0]` fallback means "active" silently differs from `activeLayerId` whenever the id is stale,
   and the store's own removal rule re-points to the **last** layer (`layerStore.ts:308-311`), not the
   neighbour — so the panels can disagree for a frame.

3. **The table keeps its OWN selection.** `TablePanel` has `syncSelection` (default `true`) and a private
   `tableSelection: ReadonlySet<string>` (`TablePanel.tsx:63-64`). With sync off there are two live
   selections in the app that never reconcile; with sync on, a row click writes
   `{kind:"object", layerId, objectId}` into the global store (:121-125) and `Clear selection` calls
   `useSelectionStore.clear()` (:130), silently clearing the viewport too.

4. **The inspector's `ruleTargetOverride` is a second, hidden "active layer".**
   `InspectorPanel.tsx:155-162` lets the Rules tab point at a layer that is neither selected nor active,
   and resets it whenever `displayLayer.id` changes (:158-160). Any unification of "the layer I am working
   on" has to decide whether this override survives, and `RuleBuilderTab` is fully controlled on it
   (`RuleBuilderTab.tsx:125-137`).

5. **`AttributePanel` duplicates the Inspector's Object tab.** Both resolve inherited attributes and both
   implement their own aggregation over a multi-selection: `AttributePanel.tsx:235-299` + `formatAggregate`
   :301 vs. `InspectorPanel.tsx:435-514` + `aggregate` :516 / `formatAgg` :530. Two independent renderings
   of the same selection, mounted simultaneously (`App.tsx:1366` and `:1377`), with different
   default `AggMode` (`"avg"` vs `"sum"`).

6. **The status bar is the table's only entrance.** `StatusBar.tsx:63-75` renders the Table toggle, but
   `tableOpen` lives in `App` (:168) and the CSS grid row only exists while `--table-h` is set
   (`App.tsx:1322`, `app.css:604`). Any re-architecture that moves the table has to move both the
   entrance and the grid-row variable, and `TablePanel`'s mount is also what tells the table registry that a
   streaming layer's table is worth rebuilding (`TablePanel.tsx:79-82` → `setTablePanelOpen`).

7. **`fitAll` on layer add lives inside the viewport.** `NavaraViewport.tsx:2380` bumps a fit token whenever
   the live-handle count grows, and :2406 calls `fitAll()`. The only escape hatch is a **module-level**
   suppression counter (`src/scene/autoFitSuppression.ts:32/:47`) because a restore runs from the landing
   page before any viewport exists (:16-25). A model where the shell decides framing would have to replace
   this, and the two current callers (`App.tsx:703`, `App.tsx:1010`) are the whole contract.

8. **Selection semantics are asymmetric and lossy.** `toggleSelect` silently drops selections from other
   layers (`selectionStore.ts:76-80`); `selectMany` keeps only `selections[0].layerId` (:89-93);
   `setMode` (object↔surface) **wipes** the selection, hover and geo selection (:108); a geo pick and a city
   pick are mutually exclusive (:65, :101). So "multi-select" is really "multi-select within one layer",
   and switching pick granularity is destructive.

9. **Per-layer map filters can be live simultaneously.** `queryStore.queries` is keyed by layer id
   (`queryStore.ts:20`) and each carries its own `syncToMap`, but only the **active** layer's table is
   visible in the panel (`TablePanel.tsx:53-55`). N layers can have N `visibleObjectIds` sets applied to the
   scene with no UI listing them, and `mapFilterSync` has its own per-layer generation counter
   (`mapFilterSync.ts:31`) plus three entry points (Apply, toggle, table rebuild).

10. **Streaming vs. static split runs through every control.** LoD is per-layer for static
    (`Layer.selectedLod`) and **global** for streaming (`useStreamLodStore`, `streamLod.ts:15-21`);
    rules reach the plugin by two different calls (`setStyle` vs `setRules`, `handleSync.ts:231` / `:370`);
    object types come from `Layer.availableObjectTypes` or `useStreamStore.types`; appearance themes from
    `Layer.appearanceThemes` or `StreamState.appearanceThemes`; object counts from `model.objects` or
    `getResidentModel`. `LayerPanel.tsx:192-232` branches the whole row on `isStreaming`. Any unified
    "layer" abstraction has to absorb five separate either/ors.

11. **`streamStore` is deliberately separate for render-cost reasons.** `src/features/streaming/streamStore.ts:12-26`
    documents that folding commit state into `layerStore` would re-render `NavaraViewport`, `InspectorPanel`,
    `TablePanel` and `App` on **every camera settle**, and would materialise `layer.model`. A
    re-architecture that normalises stores must preserve this split (the test asserts reference equality).

12. **The viewport owns three overlays the shell cannot reach.** `AddressSearch` (:3549),
    `CameraControls` (:3554) and `ScaleBar` (:3568) are mounted _inside_ `NavaraViewport` and wired to its
    private camera functions, not to `CitySceneHandle`. Moving them into the shell means widening the handle.
    Related: at most **one** `NavaraViewport` may exist at a time (`NavaraViewport.tsx:255-267`), so a
    multi-view layout is an engine-level change, not a layout change.

13. **DuckDB status is React state in `App`, the engine is a module singleton.** `App.tsx:165` +
    the mount effect :556-571 + `handleRetryDuckDB` :582 own the status, threaded as a prop to `TablePanel`
    and `StatusBar`; `src/insights/duckdb.ts:76-89` holds the real state. Anything that moves the table out
    of `App`'s subtree has to move the status with it or promote it to a store.

14. **Persistence knows nothing about the UI shell.** The v3 snapshot carries no
    `activeLayerId`, no selection, no sidebar/inspector/table state and no table height
    (`src/persistence/types.ts:385-404`), and v1/v2 are rejected outright (:414). Adding any of those to a
    re-architected shell is a **schema change**, and the codebase's stated policy is "no migration shims".

---

## Addendum — canonical definitions outside `src/`

- `type StreamStatus = "idle" | "probing" | "fetching" | "too-far" | "error"` —
  `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/streamLayer.ts:126-127`
  (re-exported through `src/features/streaming/streamStore.ts:38`).
  `interface StreamLayerEvents` (`onStatus`/`onCommit`/`onLadder`/`onTypes`/…) is at `streamLayer.ts:130`.
- `setVisibleObjectIds(ids: ReadonlySet<string> | null): void` —
  `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts:86`,
  implemented at `…/cityModelMesh.ts:459`, exposed at `…/cityModelRegistry.ts:169-170`.
- `Rule` / `Condition` / `ConditionOperator` / `LogicMode` —
  `packages/cityjson-navara-plugins/packages/navara-core/src/rules/types.ts:10-28`
  (barrel export at `…/navara-core/src/index.ts:154`).
- `RoofMetrics { areaSqM; inclinationDeg; azimuthDeg; elevationM }` —
  `packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics/types.ts:6-15`.
- `compileRuleEvaluator`, `evaluateRule`, `matchRule`, `appearanceThemesEqual`,
  `toplevelCityObjectType`, `computeFootprintArea` — all from `@cityjson/navara-core`.

---

## Coverage caveat — where this map thins out

Read in full: every Zustand store, `handleSync.ts`, `pickEventHandlers.ts`, `selection/types.ts`,
`persistence/types.ts`, `captureSnapshot.ts`, `restoreSnapshot.ts`, `InspectorPanel.tsx`,
`AttributePanel.tsx`, `GeoLayerInspector.tsx`, `RuleBuilderTab.tsx`, `LegendOverlay.tsx`, `TablePanel.tsx`,
`useLayerQuery.ts`, `tableText.ts`, `DataGrid.tsx`, `Pagination.tsx`, `mapFilterSync.ts`, `StatusBar.tsx`,
`LeftSidebar.tsx`, `LayerPanel.tsx`, `AddLayerDialog.tsx`, `SourcePicker.tsx`, `ViewerToolbar.tsx`,
`autoFitSuppression.ts`, and `App.tsx` lines 1-1160 + 1160-1440.

**Grepped or sampled, not read line by line** — verify before relying on internals:

- `src/scene/NavaraViewport.tsx` (3581 lines): read :185-300, :2370-2410, :3490-3582. Lines
  ~300-1200 (engine boot, plugin registration, basemap/terrain/tiles sync) and ~1400-3490
  (atmosphere, post-processing, streaming effects, pick wiring, pose publishing) are **unread**.
- `src/ui/toolbar/SolarMenu.tsx` — signatures and class names only; the scrubber/preset logic body is unread.
- `src/ui/stac/StacBrowser.tsx` (570), `StacItemMap.tsx` (436), `StacBrowserDialog.tsx`,
  `CollectionCard.tsx` — not read.
- `src/features/layers/useLayerFileLoader.ts` (406) — export list only; the per-format dispatch is unread.
- `src/insights/{layerTables.ts (947), sql.ts (712), export.ts (672)}` — export lists and selected type
  declarations only.
- `src/ui/table/{FilterBar,ExportDialog}.tsx` — props and constants only; bodies unread.
- `src/ui/viewport/{RenderingPanel,CameraControls,AddressSearch,ScaleBar,AttributionOverlay}.tsx`,
  `src/ui/layers/{BasemapPanel,GoogleTilesPanel,GeoLayerRow,GeospatialSourceForm,LayerTypeToggles}.tsx`,
  `src/ui/sidebar/{LodSelector,AppearanceSelector}.tsx`, `src/ui/toolbar/{WeatherMenu,SceneThemeMenu,ViewModeToggle}.tsx`
  — signatures and store reads only.
- `src/scene/{geoLayerSync,sceneThemePolicy,viewModePolicy,cameraControls,geographicCamera,basemaps,
googleTiles,terrain,bloomEffect,streamQueryBox,navaraSession,timeAnimation,cityColors}.ts`
  — export lists; only `sceneThemePolicy`'s cyber entry was read closely.
- `src/domain/citymodel/*` (parsers), `src/features/cityparquet/*` (loaders) — names only.
- Tests: patterns confirmed from `tests/unit/ui/table/TablePanel.test.tsx`, `tests/unit/app/*.tsx`;
  the other ~145 files were listed, not read.
