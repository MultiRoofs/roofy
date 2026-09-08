# UI redesign reconciliation

The user requested completion of all UI corrections after comparing the implementation with the approved interactive prototype at `http://127.0.0.1:8787/index.html#s=1` (2026-09-07).

The binding design remains `docs/superpowers/specs/2026-09-06-ui-redesign-design.md`, with recorded engine limitations. The earlier completion claim covers slices 12.1–12.3 only; the current branch starts at `804c9d2`. This plan completes missing work and corrects defects in those completed slices.

The controller directs and independently reviews. The implementer model is `gpt-5.6-terra`, as explicitly selected by the user. Keep the existing modified `index.html` and untracked `.impeccable/`, `DESIGN.md`, `PRODUCT.md` intact. No submodule changes, hook bypass, or push before final verification. The ledger remains `.superpowers/sdd/2026-09-06-ui-redesign/progress.md`.

## Sequence and gates

- [x] A: completed-slice fidelity: compact layer rows, readable palette/legend, rule draft protection, visible clear-selection action, details overflow correction.
- [x] B: scene homes and sheets, camera cluster, sun/timezone, shadow quality, viewport overlays.
- [x] C1: linked Records drawer, automatic filtering, vector records/filter capability, counts, columns, parts, selected/export scopes.
- [x] C2: All/Matching Summary, legend counts, root/part aggregation in details, Raw object navigation.
- [x] D: final UI polish, local review, automated/browser acceptance and docs. Both viewport sizes and themes checked; exact live coverage and the blocked external review are recorded below and in the ledger.

TDD for new behavior and regressions; visual changes verified in the browser. Each task receives a code review before the next source-writing task begins. Required checks: scoped format/lint, TypeScript, relevant tests, then the full app suite at final gate. Verify actual rendered controls rather than accepting test counts as proof of design fidelity. Record unsupported engine capabilities precisely, and do not represent them with inert controls or fabricated values.

## Task B brief

# Task B — restore the prototype's scene homes

Scope: the visually missing map control layout and functioning scene sheets, as a separately reviewable continuation of slice 12.5. Do not claim all of Milestone 12 complete; 12.4 drawer/data work remains separate. Preserve engine behavior and source files belonging to other sessions.

## Authority and integration

Read binding spec Map/Scene and prototype `/tmp/roofy-ui-prototype.rExpRq/index.html` (or artifact.html). User wants fidelity to http://127.0.0.1:8787/index.html#s=1. Use existing brand tokens, no mock data. Existing camera methods in NavaraViewport already bracket moves with withSettleSuppressed. Current headers/temp menus are not the final design. Follow the user-selected gpt-5.6-terra model.

## Deliverable

1. Workspace-only header: remove SceneControlsTemp mount and sceneControls prop. Keep Save, Share, labelled Preferences and panel toggles. Remove obsolete temp component after updating tests.
2. Map top-left `SelectModeControl`: SELECT mono caption and Feature / Surface buttons with icons + text and aria-pressed; map to object/surface existing pick modes + select tool. Surface disabled for non-city active layer, with explanatory title; don't wipe an existing selection solely for switching modes. AddressSearch stays accessible nearby without overlapping Select.
3. Map top-right `SceneButtons`: Sun & shade and Scene settings icon+text glass buttons. One sheet at a time, anchored beneath them; nonmodal, no backdrop, no outside/map click dismissal, explicit close. Widths 320/340; max height within map with internal scrolling at 1280x720 including drawer open. Changing sheet does not clear selection. Escape first closes sheet, focuses trigger, retains selection; next Escape clears selection. Fix useEscapeClearsSelection to respect an open sheet before clearing (do not rely on handler registration order). Modals retain priority. Cover with tests.
4. CameraCluster bottom-right above scale/attribution: zoom +/-, north, Fit (active layer only), Top-down / Angled / Free 3D with existing viewMode store, Zoom to selection only while a selection exists. Expose existing zoomIn/zoomOut/resetNorth/flyTo via CitySceneHandle and move presentational controls out of NavaraViewport into App overlay. Preserve viewport node and engine lifecycle; no @navaramap imports in UI. Existing camera callbacks already enforce settle suppression; fit actions must do so too. Remove tilt +/- UI in favor of modes. Selection fit must use real selected bounds (include building children; surface fits its owning object), not whole-layer bounds disguised as selection. `geodeticBoundsFromBBox` exists/exported from navara-cityjson; use model/stream resident object bbox + CRS safely and existing vertical-offset/placement if available. Do not edit submodule. If geospatial selection cannot resolve geometry from current batch identity, explicitly disable with reason instead of faking bounds. Explain any unresolved bounds capability in report.
5. SunShadeSheet: date input, large mono HH:mm, Time of day slider 0..24h in ten-minute steps, timezone select Europe/Amsterdam / UTC / Browser with actual offset, play/pause + 1x/10x/60x, Today / Summer solstice / Winter solstice / Equinox, engine altitude and azimuth, Shadows switch. Reuse existing solar store, add timezone optional persistence under schema v4; timezone display changes preserve the instant, date/time edits apply in selected timezone with DST behavior covered by tests. No external dependencies needed (Intl available). Keep map picks usable while open.
6. SceneSettingsSheet consolidates existing stores: BASEMAP (existing BasemapPanel), CONTEXT (GoogleTilesPanel; retain terrain, no dead terrain toggle), RENDERING (exposure, existing passes, bloom if supported, Sun shadows, Shadow quality), SCENE APPEARANCE (weather existing rain/snow/clouds/lens flare; visual effect note), collapsed PRESENTATION LOOKS (existing photoreal/cartoon/cyber/wireframe with explicit override note). Preserve working controls currently in RenderingPanel/WeatherMenu, allowing a collapsed diagnostics subsection for query-box/reset if needed. Don't invent unsupported fog/background/terrain switches. Shadow quality uses renderDebugStore.shadowQuality + setShadowQuality ONLY; Low/Medium/High, disabled with sun shadows off, explanatory cost hint (High 64MB/cascade x4, Low faster/coarser); restore preference across reload via existing snapshot preference pattern or focused local preference storage with tests. Legend warning when Cyber active. Remove legacy menu/panel modules only after migrating their behavior and updating tests.
7. Scale bar bottom-right, clear of camera cluster and attribution; attribution remains unconditionally rendered with full existing required credits and readable glass, wrapping within map width. No hardcoded mock attribution omissions.

## Validation and reporting

TDD for new behavior (sheet exclusivity/map click/Escape selection preservation, active-layer fit, selected bounds, mode disable, shadows control persistence/timezone). Run relevant suites, tsc, scoped vp check; then full suite once green. Controller runs independent live browser review at 1440x900 and 1280x720 in both themes, with selection and sheet open. Record actual remaining limitations; never describe planned capabilities as complete. No commits or pushes until controller review. Update ledger with reconciliation result.

## Controller rulings after independent plan review

- Add `CitySceneHandle.zoomIn/zoomOut/resetNorth` and `fitObjects(layerId, objectIds)` explicitly. Selected city framing belongs in NavaraViewport beside fitLayer/fitBounds. Recursively union the selected object(s) plus descendant bboxes (cycle/dedup guard), convert using the actual EPSG, and add live/stream `InteractionHandle.heightOffset?.()` so framing agrees with rendered geoid-corrected geometry. No submodule edits are needed. Do not disguise a failed selection fit as fitLayer; report unavailability. Update typed mock handles.
- SceneSheet state is one central discriminated union ('sun'|'settings'|null), not independent booleans. The Escape hook checks this state after modal priority and before text-entry/selection handling, closes it and preserves selection; keep trigger focus restoration centralized or in the owning SceneButtons effect. Map clicks do not close the sheet.
- Timezone default is Europe/Amsterdam. Old v4 documents lacking the optional field restore to that default; invalid persisted values normalize to default. Add optional timezone to snapshot capture/restore AND share capture/restore so a shared sun experiment keeps its timezone. Changing timezone retains the instant. For civil-time edits: spring-gap times are rejected with a short inline explanation; fall-back ambiguity chooses the earlier occurrence. Implement a pure tested Intl-based conversion; date/season presets preserve clock time in the chosen zone.
- Shadow-quality preference has one browser preference storage owner using a dedicated validated storage key, initialized on store load and updated by setShadowQuality (try/catch for unavailable localStorage). Reset writes the default too. Do not bump workspace schema for it or add a duplicate shadow-quality store. Tests cover persisted read, invalid storage fallback, setter persistence, reset.
- Before deleting legacy menus, include a migration mapping in report proving every working old store action has a new reachable home. Preserve diagnostics/reset in collapsed Diagnostics if needed. Drop App advancedSettingsOpen and its legacy RenderingPanel mount after migration.
- Final overlay layout: camera cluster at right above scale; scale bottom-right above the complete attribution badge; legend bottom-left with Hide/Show below. Attribution wraps within map and must not cover camera/legend actions. Top map controls use a wrapping layout when the remaining map is narrow, and sheets internally scroll to fit the map at laptop height with the drawer open. Keep the engine canvas DOM identity unchanged.

## Tasks C1/C2 brief

# Slice 12.4 implementation brief — Linked data and filtering

## Scope and confirmed baseline

Implement the approved bottom drawer as the sole data UI for the active city layer. It stays below the map column (`ViewerShell` already supplies this), never spans the left/right panels, and retargets with the workspace active layer. The current `TablePanel` is a useful records/query base but is not the target UI: it has only one grid, a collapsible filter bar, an obsolete `Filter map` checkbox, no Summary/Raw/column modes, no selected-record scope, and 100/500/1000 paging.

The design requires: layer title; Records/Summary tabs; total/matching/selected counts with city versus streaming wording; Show selected records; Export; Expand/Show map/Close; a focused filter handoff from `FilterSection`; Buildings/Raw objects modes; chosen columns; 20/50/100 paging; summary All/Matching; and the existing per-layer loading/error/no-table states. The expanded drawer must mirror the licence attribution; do not gate `AttributionOverlay` itself.

Existing working tree edits are unrelated in-progress 12.3 work; do not overwrite them.

## Existing code to reuse

- Shell: `src/ui/shell/ViewerShell.tsx`, `shellStore.ts`. `drawerOpen`, `drawerHeight`, `drawerExpanded`, `openDrawer()`, `closeDrawer()`, `setDrawerExpanded()` and the top `ResizeHandle` are already available. `ViewerShell` applies `.drawer-expanded` and hides the map through CSS when a drawer exists. App currently mounts `TablePanel` only when `drawerOpen`.
- Active target: `useActiveCityLayer()` in `src/features/workspace/activeLayer.ts`. It returns `null` for geo layers; do not fall back to another city layer.
- Table lifecycle: `useLayerTableStore`, `useLayerQuery`, `LayerTable` in `src/insights/layerTables.ts`. `TablePanel` owns the `setTablePanelOpen(true/false)` effect; retain that ownership in `DataDrawer`, because it gates streaming table rebuilds.
- Query plumbing: `queryStore.ts` stores one session-only query per layer and has `setFilter/applyFilter/clearFilter/toggleSort/setPage/setPageSize/resetQuery`. `useLayerQuery.ts` supplies current page rows, projected grid columns, filtered and unfiltered counts, stale-result generation protection, and page clamping. `FilterBar` already provides typed operators and applies only explicitly. `compileFilter`, `buildPageSql`, `buildCountSql`, `gridColumns`, `buildFeatureScopeWhere`, `buildFeatureIdsSql`, and `buildRootTypeWhere` are in `src/insights/sql.ts`.
- Table row vocabulary is stable for reader and fallback tables: `id`, `feature_id`, `object_type`, `parents`, `children`, then source attributes (`src/insights/layerRows.ts`). Root/building semantics are `parents IS NULL`; feature-wide operations use `COALESCE(feature_id,id)`. Do not assume `feature_id` is always non-null.
- Global selection: `useSelectionStore` uses `Selection` `{kind:"object"|"surface", layerId, objectId, ...}`. `select`, `toggleSelect`, and `clear` are the only table selection APIs needed. Convert surface selections to their `objectId` for selected-record membership. `toggleSelect` already constrains a multi-selection to one layer.
- Export: `ExportDialog` and `runExport` already use the applied query and feature scoping. It presently only offers all/filter scope and type/attribute choices. Add Selected scope as a `COALESCE(feature_id,id) IN (...)` predicate merged safely with the applied filter; do not export only a child row when the selected object is a root/feature.
- Existing static/streaming pure stats are `computeModelStats` / `computeModelStatsFromRecords` in `src/insights/computeStats.ts`; old `StatsTab.tsx` is deliberately unmounted and is reference material only. It does not satisfy filtered Summary scope.
- `FilterSection.tsx` already summarizes `query.applied` and opens the drawer. Replace its direct `clearMapFilter` call with the new single filter action or preserve a single central flow; it should request filter focus when opening the drawer.

## Required data/API changes

1. Replace `syncToMap` in `LayerQuery` with:

   ```ts
   view: "buildings" | "raw";
   showSelectedOnly: boolean;
   columns: readonly string[] | null;
   ```

   Default Buildings, false, null (= drawer default column policy). Change `PageSize` and `PAGE_SIZES` to `20 | 50 | 100`, default 20. Reset page to 0 when view, selected-only, chosen columns, filter, sort, or page size changes. Keep state keyed by layer and session-only.

2. Make filtering normative: applying/clearing a non-streaming city query always syncs map membership; no checkbox/UI decision remains. Streaming never syncs and says `Table only` / `currently loaded`. Centralize the full transaction so every clearing path (filter bar, left section, row/map chip) updates query and map consistently.

3. Extend `mapFilterSync.ts` (or introduce a narrowly named filter coordinator called by query-store actions) to derive current visible IDs from the applied predicate and remove current selections for that layer whose owning feature is excluded. Match selection object ids against the returned object-id set, which includes all rows in retained features. Preserve other layers only as a defensive behavior; the global selection invariant normally allows one owner. Toast once: `1 selected building was excluded by the filter` (pluralize). Generation guards must cover selection changes too, so a late query cannot clear a selection after a newer Apply/Clear.

4. Build a pure query/view helper rather than overload every consumer of `useLayerQuery`: it must compose (a) applied filter, (b) Buildings roots or Raw all rows, (c) selected-record feature scope, (d) visible selected columns, and then issue page/count SQL. Buildings are root rows (`parents IS NULL`) but parts shown by expansion must query through the root/feature relation, not assume a nonexistent singular parent field: the actual fallback column is `parents VARCHAR[]`; reader tables follow the same vocabulary. Verify on a reader table whether parent values are LISTs. A separate child expansion query is safer than trying to flatten parts into the page rows.

5. `useLayerCounts(layerId)` should be one hook for header, filter chips, legend counts, and ExportDialog. It must expose: total root count for Buildings scope, matching root count, selected feature count for this layer, plus readiness/error/loading. Counts must be feature/building counts, never total object rows/parts. For streaming, label every count `currently loaded`; matching is table-only. Avoid a hook that derives `selected` from table rows only, because selection can be off-page.

6. Summary needs a new data path. Static all-scope can reuse `computeModelStats`, but it counts all CityObjects today and does not correctly express root-building/part semantics for the design. Filtered and raw fallback/streaming scopes must be table/resident-record based. Create an explicit aggregate model/query (e.g. `layerSummary.ts` + `useLayerSummary`) that counts roots and parts separately and produces histogram/breakdown rows from the selected All/Matching scope. Do not present zero for unavailable roof metrics or columns; show unavailable/unknown where a table cannot supply it. Streaming summary is over resident records only.

## UI/module plan

Create `src/ui/drawer/`:

- `DataDrawer.tsx`: owns active-city resolution, tab state per layer (or reset safely when layer changes), lifecycle gate, header/counts/actions, expanded attribution mirror, all existing DuckDB/table state handling, and `ExportDialog`. Expand toggles `shellStore.drawerExpanded`; its header action says `Show map` in expanded state. Close should also clear expanded state to prevent reopening expanded unexpectedly.
- `RecordsView.tsx`: filter bar (always visible), streaming Table-only pill, view tabs, Columns popover, selected-only toggle, grid/part expansion and pagination. `DataGrid` should gain optional visible columns and row-expander slots or be split into a simple reusable grid plus records-specific body. Keep sticky header, sort only scalar/castText columns, and selection click semantics.
- `SummaryView.tsx`: All/Matching switch, definition grid/histograms/bars, selection-specific footnote, and explicit streaming scope phrase.
- `useLayerCounts.ts`, `useDrawerQuery.ts`/`useLayerSummary.ts`, and pure SQL/model helpers under `src/insights/` or `src/ui/drawer/` according to whether they are engine-free. Avoid importing DuckDB WASM anywhere except `src/insights/duckdb.ts`.

Modify:

- `src/app/App.tsx`: mount `DataDrawer` in place of `TablePanel`.
- `src/features/query/{types,queryStore,mapFilterSync}.ts`: query shape, centralized map application and excluded-selection behavior.
- `src/ui/layers/{FilterSection,LayerRow}.tsx` and `src/ui/viewport/FilterChip.tsx` (new): applied-filter wording/count/clear and focused Edit-in-table path. Ensure streaming chip says table-only.
- `src/ui/table/{DataGrid,Pagination,ExportDialog}.tsx`: selected/view/columns support, 20/50/100 + first/last pagination, selected export scope. Keep `FilterBar` reusable.
- `src/ui/viewport/LegendOverlay.tsx`: consume `useLayerCounts` only after it is efficient and failure-tolerant; count fetches must not cause a render/query loop.
- `src/ui/details/GeometrySection.tsx`, `MultiSelectionSummary.tsx`, and resolving helpers as the accompanying completion item C below.
- `src/app/app.css`: drawer/header/tab/grid/summary states, expanded full map column, and attribution mirror using existing tokens.

Default Columns: implement a pure stable policy based on actual column names: default on `id`, `function`, `roofType`, `measuredHeight`, `yearOfConstruction`, `status`, recognized roof area/mean slope fields, and `parts` only if represented; structural `bbox`, `parents`, `children`, geometry LoD, `object_type`, `feature_id` default off. The present normalized flat schema does **not** create `parts`, `roof area`, or `mean slope` columns by itself, so absence must simply omit them. Columns should never include blob columns; retain stable source-table order.

## Selection/details completion item C (same slice)

The current 12.3 details implementation is wrong for the common Delft shape: root Building has children and geometry/roofs are on BuildingParts.

- `MultiSelectionSummary` calls `computeTotalRoofArea` on selected roots, so its roof area is 0 for those buildings. Change it to consume `ResolvedBuilding`/the same resolved roof aggregation used by `buildingSummary`, including streaming resident records, rather than independently recomputing roots.
- `GeometrySection` currently scans only `object.surfaces`, so roof/wall/ground/vertices are 0 for root-with-parts. Give it the resolved building/object-plus-parts geometry aggregate. Its `Type` is currently `CityObject.objectType` (semantic type such as Building), not CityJSON geometry type; label it `Object type` unless a real geometry type is available, and only label a separately derived value `Geometry type`.
- Wire Geometry's Raw object button to open the drawer, set view `raw`, turn off selected-only, and navigate/select the exact object. It must work even if the raw object is a child part; then request/filter/page it into view rather than silently claiming the row is visible.
- Test a root with no own surfaces and roofs/walls/vertices on two children, then the equivalent resident/streaming record arrangement. This is a functional correctness prerequisite, not cosmetic polish.

## Main hazards

- Existing map filtering is opt-in (`syncToMap`) and `TablePanel` only re-runs it while mounted. After removal, Apply/Clear must act while the drawer is open and filter indicators must remain correct while it is closed.
- `buildFeatureIdsSql` deliberately expands matched predicates to whole feature rows. Reuse that semantic for selected/export scope; a bare `id IN (...)` can separate attributes from part geometry.
- `parents` is an array, not a `parent` column. Root test is strictly `parents IS NULL`; `children` is also an array. Do not infer parenthood from `object_type`.
- A streaming table is replaced as cells settle. Preserve last-good display, use table identity/generation guards, and never call it whole-dataset data. Selected-only may be empty because a prior selected record is no longer resident; say so honestly.
- All selected IDs may be off the current page. Selected toggle must query all pages; header count must not depend on the displayed rows. Surface selections count as their owning building once.
- Filtered Summary cannot use an unfiltered `CityModel` computation. Raw reader datasets may lack metrics, and fallback rows serialize nested values; capability/unknown states are needed.
- Keep `AttributionOverlay` unconditional in the map. Expanded drawer mirrors its attribution; it does not replace/remove it.

## Tests and acceptance checks

Unit/component tests:

- Query-store defaults/migrations within session, view/columns/selected-only reset page; page sizes 20/50/100; filter clear removes map IDs and state.
- SQL composition: roots vs raw, applied filter + selected feature scope, list-based parents/children, selected child/root/surface identity, stable column projection, no blob/unknown-column SQL.
- `mapFilterSync`: non-streaming apply writes IDs and clears excluded selected roots/parts with correct singular/plural toast; clear restores `null`; stale apply cannot overwrite/clear after a later clear/apply. Streaming never writes map IDs.
- `useLayerCounts`: roots not parts, matching counts, off-page selection, streaming wording, failed/unknown counts.
- Drawer: active-layer retarget, active geo/no city capability, filter focus request from left section, tabs, selected toggle, raw-object request, expand/show-map/close, attribution mirror, errors/loading/no records. Test `setTablePanelOpen` cleanup.
- Records: part expansion, row select/shift add, header sort, column chooser, first/prev/next/last, no-matching Clear action.
- Summary: All/Matching data and no false 0 metrics; streaming resident wording.
- Export: All/Matching/Selected counts agree with drawer and selected scope includes full features/parts.
- Item C: two child-part fixture for multi-summary and GeometrySection plus streaming/resident counterpart.

Real-browser smoke with the known live DuckDB/Delft sample at 1440x900 and 1280x720:

1. Apply `measuredHeight > 15`: matching grid/header/left/map chips agree, excluded selected building clears with toast, Close drawer still leaves a clearable filter; clear restores map.
2. Repeat on FCB: header says `currently loaded`, Table-only is visible before Apply, map remains unchanged.
3. Select a record off page, Show selected records finds it; sorting/paging do not change map membership. Switch Buildings/Raw and expand parts.
4. Check Summary All/Matching and a root-with-parts building; right-panel geometry/multi values include child geometry. Raw object opens exact raw row.
5. Expand drawer: map hides, Show map returns it, attribution remains visible/mirrored.

## Suggested two reviewable tasks

1. **12.4A — Query correctness and linked Records:** query-store migration, automatic city map sync + exclusion clearing, query/count helpers, `useLayerCounts`, `DataDrawer/RecordsView`, filters/chips, selected/raw/columns/parts/paging, Export selected scope, Raw object handoff. This establishes the shared semantics and can ship with Summary temporarily unavailable.
2. **12.4B — Summary, legend counts, and details C:** filtered All/Matching summary pipeline and visualizations, `LegendOverlay` counts, expanded attribution finishing, root-with-parts/streaming aggregation fixes in Geometry and multi-selection, full browser acceptance pass.

The plan file has only the 12.4 outline, not a detailed task ledger. Add these two tasks and the binding rulings above to `docs/superpowers/plans/2026-09-06-ui-redesign.md` before implementation, after resolving tests against the current 12.3 state.

## Controller rulings after review

- Building counts must actually count root Buildings, excluding BuildingParts and other root object types. Do not label a count of every parentless object as buildings. Raw view counts objects. A city layer with no Buildings needs an explicit usable Raw objects state.
- Export Selected is the selected feature scope independent of the currently applied filter (especially streaming, whose selections can sit outside a table-only filter). All ignores the filter; Matching applies it. Labels/counts/predicates must agree. Never intersect Selected with Matching implicitly.
- Roof area/mean slope/parts are promised default building fields: derive these from resolved model/resident metrics where available rather than silently omit them solely because flat-table columns lack synthetic names. Do not invent zero for truly unavailable metrics. Table, Summary, details and legend must share consistent root/part aggregation.
- Legend row counts are not interchangeable with layer building totals: surface rows count surfaces; rule rows count first-match roof surfaces, including unmatched; vector categories count features. Use the same effective color semantics/typed categories as rendering. Streaming counts explicitly mean currently loaded. Maintain one source for layer totals without abusing it for unrelated row units.
- Geo vector filters/records are required when attributes exist (spec normative rule 3). Design a minimal real vector path using cached GeoJSON and stable feature identity in cooperation with geoLayerSync; never cache reminted batch IDs. Raster/tiles show precise no-records states. A vector cannot silently display a city's table or claim all vector filters are unsupported.

## Final implementation record (2026-09-08)

B, C1 and C2 are integrated in the main working tree. The final implementation uses `TablePanel` for the shared drawer header/lifecycle and `DataDrawer` as its app entry; `GeoRecordsPanel` owns the vector view. This avoids duplicating drawer ownership. City derived column names are collision-safe, and vector renderer identity lives in a private prepared-data envelope with symbol-based table row identity; source attributes and exports remain unchanged. Applied filters are coordinated outside the drawer lifecycle.

Controller review rejected incomplete intermediate reports and required actual browser fixes for selected bounds, descendant geometry, raw-column reset, derived tooltips, vector membership/count identity, compact table controls, and attribution/camera clearance. These corrections are integrated. Explicit existing deferrals remain streaming map filtering, raster colormaps, vector polygon outlines, streaming surface ring metrics, measure/box tools and GPU vector hover.

External Codex CLI review is blocked by automatic approval review's source-egress rejection. Local code review and verification continue; no hooks were bypassed and no source was committed or pushed. User-owned `index.html`, `.impeccable/`, `DESIGN.md` and `PRODUCT.md` remain intact.

Final local closeout: Summary typography/segmented scope, expanded attribution link contrast, nonwrapping filter chips and streaming-export scope note corrected after controller browser review. ExportDialog regression suite37/37; final TypeScript and diff-whitespace checks pass. Full-suite and build results above remain supplemented by these focused final checks.
