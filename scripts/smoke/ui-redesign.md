# UI redesign browser acceptance

Run against the app started with `npm run dev`. Use a real Chromium browser with WebGL and WASM; jsdom does not verify the renderer. Compare with the approved interactive prototype (states 1–9). Repeat layout checks at 1440×900 and 1280×720 in light and dark interface themes.

## Test data

- Static city: Delft CityJSONSeq sample, or `fixtures/two-buildings.city.json` for a small deterministic case.
- Streaming: `fixtures/delft.fcb` served by the development server.
- Vector: a GeoJSON FeatureCollection with at least 25 features, numeric and text attributes, nulls, duplicate/missing feature IDs, and a property named `id` distinct from the GeoJSON feature ID. Include polygons, lines and points.
- Raster or tiles: a layer without records, to verify capability wording and active-layer isolation.

## Scenarios

1. **Initial and empty viewer.** Load the first city layer. Verify one layer list and a useful map, with no empty selection panel. Choose New workspace after entering the viewer; the empty card offers File, URL and Catalog. Add another layer. The same canvas element must survive ordinary workspace and panel actions.
2. **Selection.** Select a building and a roof surface. Check the layer/building/surface identity trail, table highlight, clear-selection action and root/part geometry totals. Collapse and reopen Details without clearing selection. Raw object opens the exact object and provides Return to filtered records.
3. **Layer switching.** Switch between city, vector and raster layers with the drawer open. Layer controls and records must retarget together; a raster must never show stale city rows. Row clicks do not move the camera. Explicit Zoom to layer and Zoom to selection do.
4. **Classification.** Apply Flat roofs, inspect a roof, and compare rendered colours, legend rows/counts and Rule match. Edit, cancel, reorder and disable rules. Adding a rule from Surface type must produce visible styling. Vector categories and selection highlights restore correctly after deselection and source preparation.
5. **Filters.** Apply a numeric filter using an attribute present in the dataset (Delft uses `b3_h_dak_max > 15`). Verify map membership and matching building count, excluded-selection clearing, and clearable row/map indicators with the drawer closed. Clear restores the map. For FCB verify Table only before Apply and currently loaded counts; filtering must not hide streaming geometry. Repeat vector filtering and clearing with the drawer closed.
6. **Records and export.** Expand parts, switch Buildings/Raw objects, choose columns, and page with 20/50/100 plus first/last. Select a record, move to another page, then Show selected records. Check Summary All/Matching, unavailable metrics, and All/Matching/Selected export contents and count units. Vector GeoJSON/CSV must preserve source properties without internal selection metadata.
7. **Sun and scene.** Open Sun & shade while a roof is selected. Change date/time/timezone, a seasonal preset, playback and shadows. Open Scene settings and verify exclusive sheets, internal scrolling, basemap/rendering controls and the weather-effect note. Map clicks remain usable; Escape closes the sheet before clearing selection and returns focus.
8. **Space constraints.** Resize both side panels and drawer by pointer and keyboard; verify ARIA values, minimums and maximums. Collapse panels into presentation state. Expand the drawer, verify attribution remains visible, then Show map with the same canvas. Controls, layer navigation and credits remain reachable at both viewport sizes.
9. **Capability/error states.** Check a source without a table, vector loading/fetch failure/Retry, an unavailable file, no matching records and source removal/relink. Never show another layer’s rows or silently invent zero for unavailable metrics.

## Evidence

Record the test date, build/working-tree state, viewport sizes, screenshots, browser console errors, and any remaining limitations in the redesign reconciliation ledger. Keep screenshots tied to the tested final source state; hot module replacement can replace a canvas during code edits, so identity checks must run while source writes are paused.

## Latest execution — 2026-09-08

Local reconciliation verification used Chromium with SwiftShader at both target sizes and themes. Static Delft filtering returned40/1,115 buildings; vector filtering returned14/25 features; streaming Delft returned40 table matches while retaining8,325 roof surfaces on the map. Expanded/normal drawer, selected records, Summary All/Matching, scene sheets, attribution clearance and canvas identity passed the checks recorded in the ignored progress ledger. Full suite:2,531 passed,17 skipped; final affected suites:59 passed. Build and TypeScript passed; lint0 errors.

The slow software renderer initially presented an empty FCB resident set; after settling it loaded2,231 objects, with1,115 buildings in the table. Wait for resident data before assessing filter results. Browser state affected by development HMR was discarded through a fresh reload. Automated capability/error tests supplement the live smoke; this is not a claim that every error combination was visited at every size/theme. External Codex review remains blocked by automatic approval review's source-egress rejection.

Final closeout additionally verified37 ExportDialog tests and the explicit streaming-export scope note. Summary and expanded credits received final compact typography/contrast polish, checked through browser computed styles.
