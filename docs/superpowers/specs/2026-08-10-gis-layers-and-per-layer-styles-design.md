# GIS Layer Support & Per-Layer Styles — Design

**Date:** 2026-08-10
**Status:** Approved for planning (autonomous session; decisions documented for user review)

## User requests (verbatim intent)

1. When the user clicks "add layer" for geospatial data, the Add Layer dialog should open on the **Geospatial data** tab by default, not the 3D city model tab.
2. Clicking a geospatial feature should **show its attributes**.
3. Style/rules must be **per layer, not global**: selecting a layer targets the style editor at that layer.
4. General geospatial layers must be **stylable** too.
5. Geospatial features must be **click-selectable** like city objects.

Breaking changes are explicitly allowed.

## Current state (from exploration, 2026-08-10, post force-push develop)

- **Rules are already per-layer** end to end: `Layer.rules`/`rulesEnabled` on `layerStore`, all six mutators take `layerId`, `handleSync.syncStyles` compiles per layer, streaming workers get per-layer `Rule[]`, snapshots and share links carry per-layer rules. What is global is only the _presentation_: `InspectorPanel` resolves `displayLayer = selectedLayer ?? activeLayer ?? layers[0]` and the Rules tab never says which layer it is editing; a click in another layer silently retargets it. `LegendOverlay` computes a `layerName` and never renders it. `reorderRules` exists in the store but has no UI.
- **Geo layers** (`geoLayerStore`: geojson | raster-xyz | 3d-tiles) are a parallel subsystem with **no style fields** (hardcoded `GEO_ACCENT_COLOR = 0xff5a3c`, point 24 px, line 2 px; only `opacity`, whose slider renders for raster only), **no active-layer concept, no picking, no attributes** — all deliberately deferred by the 2026-08-05 spec.
- **The engine closes the gap**: `@navaramap/three@0.0.5` GPU-picks its native layers (`view.on("pick")` → `FeatureInfo {batchId, properties, layerId}`, where `properties` are the feature's own GeoJSON properties) and supports per-feature data-driven styling (`FeatureEvaluator.evaluate(cb)` overriding layer defaults + `layer.forceUpdate()`). City meshes are **absent** from the engine pick pass (own-raycast strategy), so engine picks fire only for engine-native layers — complementary paths, needing gesture-level coordination only.
- `AddLayerDialog` default tab is one hardcoded `useState<SourceTab>("city")` (line 65), pinned by `AddLayerDialogGeospatial.test.tsx:63`.

## Design

### A. Add Layer dialog: geospatial-first entry

- `AddLayerDialog` gains `initialTab?: SourceTab`.
- The main **“+ Add Layer”** button opens on **`geo`** (the user's requested default).
- Each `LayerPanel` section header (City Layers / Geospatial Layers) gains its own small **“+ Add”** button that opens the dialog on the matching tab, so intent is explicit in both directions and city-model users lose nothing.
- Update the pinned test; add tests for both entry points.

### B. Per-layer rules: make the target explicit (city layers)

Store needs no changes. UI changes:

- **Rules tab header names its target layer** and offers a dropdown over all city layers; default target = the current `displayLayer` resolution; picking a layer row in `LayerPanel` (active layer) retargets the tab as today, but now _visibly_.
- The dropdown choice is UI-local state that follows `displayLayer` unless the user explicitly picked a different layer in the dropdown during this Inspector session (explicit pick wins until the active layer changes again — simple, no new store field).
- **LegendOverlay groups rules by layer** and renders the layer name it already computes.
- Out of scope (documented, not built): rule reorder UI, cross-layer rule copy. First-match-wins priority stays.

### C. Per-layer style for geospatial layers

- `GeoLayer` gains a required `style: GeoLayerStyle` (defaulted at creation), kind-relevant fields:
  ```ts
  type GeoLayerStyle = {
    color: string; // CSS hex, e.g. "#ff5a3c" (vector kinds)
    pointSizePx: number; // geojson points
    lineWidthPx: number; // geojson lines + polygon handling per current descriptor shape
    fillOpacity: number; // 0..1, geojson polygons (raster keeps the existing `opacity` field)
  };
  ```
  Defaults come from today's constants in `geoLayerDescriptions.ts` (which stay as the single source of the default values).
- `updateGeoLayer` accepts `style` in its patch; every action **replaces** the style object (identity-compare convention, same as `config`).
- `geoLayerDescriptions.geoLayerDescription` reads the record's style instead of module constants (constants become defaults only). Hex→number conversion lives in the descriptor module (engine accepts `number` for color fields on layer descs).
- `geoLayerSync`: `style` joins the `LiveGeoLayer` memo and the change test; a style change triggers `Layer.update()` with a full rebuilt description (existing full-replacement discipline).
- **UI**: `GeoLayerRow` gains a style popover for vector (geojson) layers — color swatch, point size, line width, fill opacity — and the existing opacity slider extends to geojson (it now honestly maps to style). Raster/3D-tiles rows keep opacity only.
- **Persistence**: `GeoLayerSnapshot` gains optional `style`; `normalizeGeoLayers` validates/defaults it (values reach the engine). Snapshot version stays 3 — the field is additive-optional and old snapshots normalize to defaults.

### D. Geo feature selection + attributes

- **Selection state**: `selectionStore` gains a parallel field:
  ```ts
  type GeoFeatureSelection = {
    geoLayerId: string; // geoLayerStore id
    batchId: number; // engine batch id (per-feature)
    properties: Readonly<Record<string, unknown>>;
  };
  geoSelection: GeoFeatureSelection | null;
  ```
  Invariant: city `selections` and `geoSelection` are mutually exclusive — `select`/`toggleSelect`/`selectMany` clear `geoSelection`; `selectGeoFeature` clears `selections`; `clear` clears both. The existing `Selection` union is untouched (no ripple through `sameSelection`/`narrowToMode`).
- **Engine-id mapping**: `geoLayerSync`'s `GeoLayerHandle` seam gains `id` (the engine layer id); `LiveGeoLayer` records it; a lookup resolves engine layerId → `GeoLayer.id`. NavaraViewport's real handles already wrap engine `Layer` objects that expose `id`.
- **Gesture coordination** (pure, tested in `pickEventHandlers`): the engine `pick` event fires on mouseup, before our own-raycast click handler. The viewport stashes the latest engine pick; the click handler resolves the gesture with a pure function:
  - own-raycast **hit** → city selection wins (geo selection cleared by the store invariant);
  - own-raycast **miss** + stashed engine pick resolves to a known geo layer → select that geo feature;
  - both miss → clear all (current behavior).
    The stash is consumed per gesture (cleared after the click resolves) so a stale pick cannot leak into the next click. Picking respects the current tool mode exactly as city picking does (`acceptsPointer`).
- **Highlight**: on `addPair`, subscribe `featureCreated`/`featureUpdated` on the engine layer handle (subscription on the handle, not per description, because `Layer.update()` recreates features); a `syncGeoHighlight(geoSelection, live)` pass calls `evaluator.evaluate(info => info.batchId === selected ? {color: HIGHLIGHT_COLOR} : {})` and `layer.forceUpdate()` when the selection (or its clearing) changes. Highlight color = the existing selection accent used by city meshes, converted for the engine.
- **Attributes**: `AttributePanel` learns a second, simpler mode — when `geoSelection` is present, render its flat `properties` through the already-extracted `AttributeTable` (no inheritance, no CityObject shim). `App.tsx` passes `geoSelection` + the geo layer name down. Empty properties render a friendly "No attributes" line, same as city objects.
- Hover for geo features: **out of scope** (the engine pick pass runs on mouseup only; there is no cheap hover query).

### E. Rules for GeoJSON layers (stretch — last phase, cuttable)

- `GeoJsonLayer` (only that kind) gains `rules: ReadonlyArray<Rule>` + `rulesEnabled: boolean` (default `[]`/`true`), reusing the existing serializable `Rule` schema — conditions resolve against feature `properties` only (no roof metrics; `matchRule` is called with empty metrics).
- Rendering path: the same `featureCreated`/`featureUpdated` subscription evaluates `matchRule(rules, properties)` → hex → engine color; selection highlight wins over rule color.
- UI: the Rules tab's layer dropdown includes GeoJSON layers; for them, condition fields come from sampled feature properties (first N features of the loaded data), presets are hidden (roof-shaped), and the color/condition editor is reused as-is.
- Persistence: additive-optional on `GeoLayerSnapshot`, normalized like style.
- If this phase is cut for time, the spec's C+D still deliver "style per geo layer" (uniform) and full selection/attributes; E upgrades styling to data-driven.

## Error handling

- A geo pick whose engine layerId maps to no known geo layer (basemap tiles, Google tiles, 3D-tiles kind) is ignored — no selection change beyond the normal miss path.
- Style values are validated at the persistence boundary (`normalizeGeoLayers`): non-hex color, non-finite numbers → defaults, layer still restores.
- Rule evaluation errors on geo features must not throw inside engine callbacks — `matchRule` is total; the evaluator wraps in the same discipline as the city evaluator.

## Testing strategy

TDD (red → green → refactor) per step. All engine interaction is tested through the existing structural seams (`GeoLayerView`, fake handles) under Node; the pure gesture resolution and style mapping get direct unit tests; UI via @testing-library. A final browser smoke (agent-browser / CDP on 9333) verifies: geo tab default, adding a GeoJSON URL, clicking a feature shows attributes + highlight, editing a geo layer's color re-renders, city and geo selection exclusivity.

## Out of scope

- Geo feature hover highlight; measure/box-select for geo features.
- Rule reorder UI; cross-layer rule copy; multi-feature geo selection.
- Styling raster/3D-tiles beyond opacity; per-feature styling of 3D Tiles.
- Share-link inclusion of geo layers (stays excluded as today).
