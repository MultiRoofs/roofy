# Architecture Notes

The decision records and known engine issues that used to live in `CLAUDE.md`. They are kept
here so the project instructions stay short; read the relevant bullet before touching the
scene/engine code, streaming, CityParquet, the STAC browser or the CityGML archive path.
New records go here, not in `CLAUDE.md`.

## Key Architecture Decisions

- **Real georeferencing**: every layer (and every streaming cell) gets its own ENU frame at its centre (`makeEnuFrame`), and **every vertex is transformed exactly** — source (x, y, z) → proj4 → lng/lat → + `heightOffset` → geodetic-to-ECEF → inverse ENU frame — by `projectPositionsToEnu` in `@cityjson/navara-core`. Source-CRS deltas are _not_ ENU metres (projection scale factor + grid convergence), so treating them as such would mis-place and slightly rotate anything more than a few hundred metres from the origin. ENU is x=east/y=north/z=up, identical to CityJSON, so there is no axis swap and no shared scene origin; the old origin-offset + `-π/2` rotation + `sceneTransform` sign convention are gone. The per-vertex cost is paid once per geometry build (LoD change, or a worker decoding a cell), never per frame. A mesh's ENU→ECEF frame is passed as `matrixWorld` in the engine's `addMesh` config; local vertices stay small.
- **CRS gate**: a layer whose CRS cannot be resolved to a proj4 def is rejected at load, and there is no planar/local viewing mode — but resolution is WORLDWIDE, not list-bound: the bundled list carries only the Dutch grids (28992/7415), and `ensureProjDefAsync` (navara-core) fetches any other EPSG code's def from epsg.io at load time (best-effort service, like the geoid; offline the fixed list is all there is). The async fetch happens in `ensureModelCrsLoadable` (`src/features/layers/ensureCrs.ts`), called on every static-model load path BEFORE the model reaches the layer store, so a refusal is a load error with a sentence, not a dead layer in the scene sync; the engine's sync gate (`resolveMetricEpsg`) is unchanged and still the authority. The METRIC gate is unchanged too: epsg.io extends coverage, not permission — a degree-based CRS is still refused. `parseEpsgCode` accepts the OGC URL form, the v1.0 URN form (`urn:ogc:def:crs:EPSG::3414`) and bare `EPSG:NNNN`. CityJSON **1.x and 2.x** both parse — the catalog is full of v1.0-era files (Singapore hdb.json) and rejecting them bought nothing. The two v1.0 differences are both normalised at the parser boundary: `transform` may be absent (identity is assumed, vertices are real floats) and `lod` is a bare NUMBER (stringified on parse — passed through raw it survives the first render, then the first LoD-dropdown pick compares `2 !== "2"` and silently blanks the layer). One deliberate exception to the worldwide resolution: **FCB streaming admission still uses the sync fixed-list gate** — the worker owns its own proj4 registry in its own realm, so extending it means shipping the resolved def string in the `open` message, not just fetching it main-thread; until then a non-Dutch `.fcb` fails closed with the same sentence as before.
- **Vertical datum**: source z is an orthometric height above a local datum (NAP for EPSG:7415), not an ellipsoidal height, so `heightOffset` metres are added during the ENU transform. It is sampled from a real geoid model — `geoidHeightAt(lng, lat)` in `@cityjson/navara-core` reads EGM2008 undulation from the Re:Earth Terrain service (global, keyless, Terrain-RGB tiles) — because `ellipsoidal = orthometric + undulation`. Static layers render at 0 and are re-placed when the sample resolves (`CityModelMesh.setHeightOffset`); streaming layers await the sample in `openStream` before the first cell, so the worker bakes every cell in the right frame. `addCityModel`/`openStream` accept an explicit `heightOffset` that wins outright. See Known Issues.
- **Attribution is a licence obligation.** `src/ui/viewport/AttributionOverlay.tsx` renders `GEOID_ATTRIBUTION` from `@cityjson/navara-core` **unconditionally** (the geoid is sampled for every georeferenced layer): CC BY 4.0 Mapterhorn, ODbL OpenStreetMap, and the Re:Earth/NGA credit. Only the Google Tiles credit is conditional. Never drop or gate the geoid lines.
- **The basemap catalogue is DATA, and stays engine-free.** `src/scene/basemaps.ts` is unit-tested under Node, where `@navaramap/three` cannot be imported at all, so an entry that needs an engine VALUE names it as a marker string and `NavaraViewport.addBasemap` — the engine-binding site — resolves it. The one such entry today is `elevation-heatmap`: a `raster-dem` source carrying `elevationDecoder: "terrarium"` (resolved to `TERRARIUM_ELEVATION_DECODER()`) plus an optional `layer` block (`elevationHeatmap`: min/max height, log ramp) that `addBasemap` merges into the `raster` layer descriptor. Its DEM is the same Re:Earth service the terrain mesh and the geoid already use, read as data rather than drawn as imagery. `addBasemap` also writes `view.globe.elevationColormap` (the one globe setter probed CLEAN on 0.0.5 — Known Issue (i)) with the RdYlBu ramp from Navara's own ElevationHeatmapMaterial docs, because the engine's default ramp is near-monochrome blue; the write lives at the basemap seam, never in theme code. Historical note: this option was hidden 2026-08-06 on a "fetches zero terrarium tiles" verdict that was a MEASUREMENT artifact — in-page probes (fetch patches, `performance` resource entries) read false zeros for tile fetches the CDP network log shows in the hundreds (the same probe read the draped Esri basemap as zero in the live app; which conditions hide a fetch from in-page observation was not pinned down — judge fetching at the network layer). Re-verified 2026-08-11 in the live app at the network layer and by pixels (A/B against "None" at the same camera; atmosphere haze over relief mimics a ramp well enough to have produced two wrong verdicts).
- **Picking is our own raycast**: `PickStrategy = "own-raycast"` (`@cityjson/navara-cityjson/src/pickStrategy.ts`, `DEFAULT_PICK_STRATEGY`). Navara's `PickableMeshWrapper` carries one uniform batch id per mesh and cannot express per-surface ids, so the plugins raycast the engine's pick ray (`getPickRay`, ECEF) against their own geometry to resolve object **and** surface.
- **Geospatial layers are the MIRROR IMAGE of city layers, on every axis.** They live in their own `geoLayerStore` (a geo layer has no `CityModel`, no LoD ladder, no rules, no surfaces), the ENGINE draws them, and the app owns no geometry for them — so each half of the app works the opposite way round from the city path. **Picking**: the engine's own click pick — the `featureClick` event (named `pick` before 0.1.0; `featureHover`/`featureEnter`/`featureLeave` also exist now but are deliberately NOT subscribed, since each costs a GPU pick per frame and re-bakes the draped atlases) — is the only way to hit one, and it carries a per-feature `batchId` — exactly the granularity the city path could never get out of it (see the raycast bullet above). `NavaraViewport` therefore subscribes `featureClick` but only ever STASHES the result: it carries no gesture (and on 0.0.5 fired for terrain and basemap tiles too; 0.1.1 renders only pickable meshes into its own pick scene, so a click on bare ground now arrives as a `featureClick` with a null result, handled the same way), so the following `click` decides, against the live geo registry, and **a city hit always wins** (our raycast is exact geometry at the exact pixel; the engine's pick is a colour read that also answers for a draped fill under the building). The ORDER is load-bearing and engine-guaranteed: `PickHelper` binds its `pointerup` listener before the view's own and its pick is synchronous, so `featureClick` always precedes the `click` of the same gesture. Since 0.1.1 the engine gates BOTH at the same travel tolerance (`CLICK_PIXEL_TOLERANCE` = 5 px, 30 for touch; the `click` event is a gesture now, never emitted after a camera drag), which `CLICK_DRAG_TOLERANCE_PX` mirrors — so the 0.0.5 asymmetry (zero-tolerance pick vs a 3 px gate, where a 1 px jitter cleared a geo selection while still selecting a city object) is gone, and `createClickGate` survives as defence in depth (a `pointercancel` cancels it). The whole engine event surface is POINTER events (`pointerdown`/`pointermove`/`pointerup`/`pointerleave`/`pointercancel`, touch included) and the engine `Object.assign`s `map` onto the very DOM `PointerEvent` it received, which is why the container's sky detector listens to `pointermove`, not `mousemove` — the compatibility mouse event is a different object and the identity test would read every move as "sky". Draped (`clampToGround`) fills paint OVER city meshes inside their footprint — the engine's stencil-volume drape composites against the globe, and the technique is unchanged between 0.0.5 and 0.1.1 — while the city raycast still wins the click there (browser-verified 2026-09-04). **Styling**: per layer, not per rule — colour, point size (PIXELS, `sizeInMeters: false`; Navara's `PointMaterial` defaults it to true, which turns a POI into a blot or a speck depending on altitude), line width and fill opacity, normalised through the one total door in `features/geoLayers/geoLayerStyle.ts` and converted to the engine's `0xRRGGBB` only at the description boundary. The style is theme-AGNOSTIC on purpose: a geo layer is drawn on the globe over imagery whose brightness has nothing to do with the chrome. It persists in the snapshot (v3) alongside `visible`/`opacity`. The CONTROLS, though, are NOT on the layer row: they live in the right InspectorPanel's geo view (`ui/inspector/GeoLayerInspector.tsx`), which follows `geoLayerStore.activeGeoLayerId`, and each is gated by KIND — opacity for `geojson` and `raster-xyz`, the four style fields for `geojson` alone, so a `3d-tiles` layer's panel is information ONLY (its appearance comes from the tiles' own materials — the descriptor still carries `opacity`, the UI just offers no handle on it; a raster sheet likewise has no colour of ours to set) — six controls in a 240 px row had to hide behind a disclosure and still trebled its height, and putting them where the city tabs already are gives both kinds of layer one mental model (click a row on the left, configure it on the right). **Highlight**: a selected feature is recoloured through the engine's `FeatureEvaluator` on that layer, one evaluator per feature set — and clearing means returning the layer's own colour EXPLICITLY, because an omitted key does not reset a previous override. **Reconciliation** (`geoLayerSync.ts`): `Layer.update()` REPLACES the whole description, so a visibility/opacity/style change re-sends a description rebuilt from scratch, never a patch; a `config` change is an honest rebuild of the source/layer pair; and the layer is always deleted before its source, which is reference-counted. An add the engine refuses is `console.error`'d and left absent so the next pass retries — one bad URL must not take the viewport down. **UI**: the Add Layer dialog opens on the **Geospatial** tab by default (`initialTab ?? "geo"`), the layer panel has a city section and a geospatial section each with its own add button, the Rules tab names and lets you pick its target CITY layer (rules never apply to geo layers), the legend groups its entries by layer, and the attribute overlay has a geo mode that shows the picked feature's GeoJSON `properties`. A geo row is CLICKABLE and slim — identity and actions only (visibility, rename, "Zoom to layer", remove) — and clicking it sets `activeGeoLayerId`, which is what swaps the inspector to `GeoLayerInspector`; the two sides are mutually exclusive, so a city row click or a city object pick hands the inspector back (`setActiveGeoLayer(null)`) and picking a geo feature in the viewport activates its layer. `activeGeoLayerId` is session state and is deliberately NOT persisted — a restored snapshot opens on the city tabs, not on whatever was last configured. "Zoom to layer" shows only for GeoJSON and 3D Tiles rows, because a raster-xyz template names no extent to fly to; the button resolves the layer's bounds (fetching the GeoJSON or `tileset.json` once, cached by URL) and calls `CitySceneHandle.fitBounds`. Browser-verified 2026-08-10 end to end (drape, pick, recolour, style edit, city-wins, save/restore) — but that smoke predates the row→inspector move, so it covers the DRAWING and PICKING paths, not the current UI: the inspector-hosted controls, the row click that activates a layer and the zoom button are unit-tested only and not yet browser-smoked.
- **Engine-binding isolation**: `@navaramap/*` imports live **only** in named engine-binding modules — `navara-cityjson/src/{CityJSONPlugin,CityModelMeshDesc,CityMeshArraysDesc,plugin}.ts` and `navara-flatcitybuf/src/{FlatCityBufPlugin,engineRays,plugin}.ts`. Everything else takes descriptors, pick rays and mesh factories as injected seams. This is structural, not stylistic: `NODE_IMPORT_SAFE=false` — importing `@navaramap/three` under Node crashes at module scope. Plugin tests import the specific engine-free module, never the package barrel. The engine-bound entry points are the `/plugin` subpath exports, kept out of the main barrels.
- **One lighting calibration: the engine's forward-lit default, at exposure 10.** `NavaraViewport` states `view.lit = true` right after `addDefaultPhotorealScene()` (`applyForwardLighting`) and never writes the aerial-perspective pass, which stays at its `irradiance: false` default and only hazes what the lights produced. The scene's `SunLightDesc` (direction and colour from the atmosphere, cascaded shadow maps from `@navaramap/three-csm`) and `SkyLightProbeDesc` (the ambient term, sampled from the atmosphere) shade every LIT material in the forward pass: the terrain, the draped basemap, Google's tiles, and the city meshes. `DEFAULT_EXPOSURE` stays 10, the value the engine's own forward-lit samples sit at — browser-verified on the Delft sample at a fixed camera (2026-09-06): sun-facing walls light, the rest grey, roofs and ground carrying each other's shadows. The history matters because it was a hard rule until issue #13. From the Navara migration to 2026-09-06 the app ran the DEFERRED calibration — `view.lit = false` with the pass in `irradiance` mode re-lighting the G-buffer albedo from the atmosphere, city meshes as unlit `MeshBasicMaterial` — and it produced the flat, shadowless city the issue shows, for two reasons found in the engine source: (1) both city-mesh descriptors extended the plain `MeshDesc`, whose `getPassKey()` answers `"opaque"`, a forward scene the engine draws AFTER copying the G-buffer out, so the buildings' normals never reached the irradiance term at all (every wall was flat albedo whatever the sun did — the opaque scene is lit by the scene lights like every other, so this was a G-buffer problem, not a lighting one); and (2) the irradiance term reads the normal buffer only, and no built-in effect reads the shadow G-buffer the lit pipeline writes, so cast shadows are structurally unreachable in that calibration — the engine's own realistic-atmosphere guide says as much ("excludes cast shadows from the forward pass"). The descriptors now extend `MeshDescWithSelectiveEffect` (MRT scene whenever a G-buffer is allocated, which the aerial-perspective effect always requires), and the calibration moved to the one the engine's own mesh descriptors use. What the deferred mode still offers and this one does not: cloud shadows on the ground (`CloudsEffectDesc` composites its shadow term through the irradiance path; `cloudsEnabled` defaults to false). Consequences kept deliberately: the app adds **no** scene lights of its own (the old ambient fill and its slider are gone — the sky probe IS the ambient term, and a second lighting pass over lit materials at exposure 10 is exactly the 2026-08-04 overbright diagnosis); the default basemap is Esri World Imagery (OSM's near-white sheet reads as blown paper at this exposure); and a theme darkens with `sunIntensity`, `skyLightProbeIntensity` and `exposure` (`sceneThemePolicy`), never by writing the aerial-perspective pass — `apAlbedoScale` is gone with the mode it scaled. The cascaded shadow maps' tuning is the quality table in `src/scene/shadowQuality.ts` (one row per level — low/medium/high = 1024/2048/4096 maps with `shadowBias × map size` held constant at −0.001 × 2048, `shadowNormalBias: 0`, `shadowMargin: 500`; the level lives in `renderDebugStore.shadowQuality`, default medium), pushed with every `castShadow` write and re-written whole on a level change (the engine re-allocates the maps on a live `shadowMapSize` write, probed). It replaced a single `SUN_SHADOW_TUNING` of 2048 at −0.0005 after a low-sun screenshot showed every roof and wall striped with shadow acne: the bias's metre equivalent had been halved by the margin change and a ~12° sun exceeds it; doubling the bias per texel is the medium row, a finer map at the same bias-per-texel the high row. The bias is one value for all four cascades and is worth the cascade's depth range times 0.0005 in metres; the margin (the engine's 5 km is room for a mountain outside the frustum) sets that range, and 500 m brought the nearest cascade from 8.3 km to 3.8 km of depth — about two metres of bias at street level instead of four, no acne — while the far cascades stay at tens of kilometres, so at the layer-fit view (2.2 km up) buildings shadow the ground but not each other, and no bias fixes that (1e-4 and 2e-5 were swept: both just bring the roof acne back; a per-cascade bias would need the engine to expose one). Checked at street level and at the layer-fit view, a low sun over a far cascade untested. Why a depth bias at all: the engine defaults left every lit face in a checker of self-shadowing on this data, and a NORMAL bias (the textbook cure) made every mis-wound roof solid dark, because it pushes the lookup along the VERTEX normal — which real CityJSON points into the building on the faces `orientExteriorRing` gets wrong (see the double-sided bullet) — while a depth bias moves every fragment towards the sun regardless of winding. Draped GeoJSON fills, which used to paint over city meshes inside their footprint (the `draped` scene was drawn after the buildings), are now occluded by the buildings above them, since the MRT scene is drawn after `draped`. **The second #13 report (2026-09-06, "facades opposite the sun as bright as the sunlit ones") was headroom, not lighting.** Probed live over CDP: the compiled city program is a stock lit Lambert with the CSM define and the cascaded no-loop direct term, the flat per-triangle normals give N·L 0.74 on a roof, 0.67 on a west wall and 0 on an east wall at the sample's sun, and rendering with the sky probe zeroed gave black shade sides and white sun sides — so the direct term reaches every wall. What flattened the picture: the palette is display colours (wall #d9dcd4 = 0.85 linear), so at exposure 10 a sunlit wall rendered at the same value as the sunlit ground (≈220) and every roof clipped, and the six-fold difference between a west and a south wall came out as 185 vs 138. The fix is `PHOTOREAL_ALBEDO = 0.5` as a neutral `tintRGB` on the photoreal style — `material.color` multiplies the vertex colours before the lighting equation, so it is an albedo, hues survive — measured at the 200 m camera as west/south/east wall and roof red of 155/107/86/231 against a 226 ground (tint 1.0: 185/138/117/251, 0.7: 170/121/101/242, 0.4: 145/97/77/223). Lowering the exposure instead would drag the globe (calibrated by the engine for its imagery) down with the buildings. At the auto-fit default view (heading 0, pitch −60, 2.2 km, 12:00 UTC) the camera sees roofs and south walls, all sun-facing, and the shaded east walls are edge-on, so what that view gains is headroom and unclipped roofs, not new shading. The photoreal OUTLINE that the first #13 pass added (an unlit dark ink line, `edges` on the photoreal style) was removed on 2026-09-08 at the maintainer's call: with the faces lit it read as a wire over the photograph by day and glowed white over black buildings at night (unlit line at exposure 10). Only the stylised themes draw edges now; the edge-line normal fix in the plugin still matters for them.
- **Attributes are INHERITED for display.** CityJSON splits a building in two: the `Building` carries the semantics and no geometry, the `BuildingPart` carries the geometry and no attributes (measured on the Delft sample: 66 Buildings all with attributes, 66 BuildingParts all without). Picking is geometric, so a click always lands on the part — reading attributes off the picked object alone showed "No attributes" for every building in the dataset. `src/domain/citymodel/inheritedAttributes.ts` fills the gaps from the nearest ancestor (own values win, cycle-safe) and names the source so the UI can say where a value came from. Presentation ONLY: the parsed model, rules, DuckDB and the table still read the real thing. Used by the attribute overlay and the inspector, on both the static and streaming paths — a FlatCityBuf `ResidentObjectRecord` splits the same way, hence the structural `AttributeCarrier` parameter.
- **Streaming LoD is GLOBAL, camera-sync is PER-LAYER.** A streaming layer's LoD ladder is discovered from the cells the worker decodes (`onLadder`), so it is empty at load time and a per-layer dropdown would be empty exactly when first looked at — `StreamingLodControl` offers the union of discovered LoDs plus `Auto` and applies to every streaming layer; `LodSelector` now renders only for static layers. `Layer.cameraSync` is per-layer instead, because freezing one extract while panning another is the point of having it; it reaches `FcbStreamLayerHandle.setCameraSync` through `syncStreamState`'s memo.
- **City meshes render DOUBLE-SIDED, deliberately.** Front-face culling deletes real geometry from real CityJSON: the spec asks for outward-facing exterior shells but files vary, and `orientExteriorRing` (navara-core's `buildCityMeshArrays`) makes it worse on the shapes that matter — it decides orientation by whether a face's normal points away from the object's bbox CENTRE, which is right for a convex block and wrong for every concave one (an L-shape's inner walls, a courtyard, anything under an overhang legitimately face their own centroid, so the heuristic reverses them). Measured on the Delft sample at a fixed camera with the backdrop off: ~1.1% of the viewport was building pixels that only appear double-sided (3400 px, against 56 the other way). Both mesh classes in `navara-cityjson` must agree, or a building renders differently as a file than as a stream — which is why there is now ONE material factory, `createCityMaterial` (`MeshLambertMaterial`, vertex colours, `DoubleSide`), used by both classes and the textured-group builder; three flips a back face's normal in the fragment shader, so a mis-wound wall is still lit from the side the camera sees. Every material it makes goes through the `ShadowMaterialHooks` seam (register on create, unregister BEFORE dispose on every LoD swap, appearance switch and cell eviction — the registry also drops an entry on the material's own `dispose` event, so the explicit release is about rolling the shader patch back on a live material in a deterministic order, not about a leak), which the descriptors fill with `ViewContext.applyShadowMaterial`/`removeShadowMaterial` — a material the cascaded-shadow registry has never seen receives no shadow, whatever `receiveShadow` says. The theme's edge `LineSegments` child rides into the MRT scene with its parent and therefore carries a finite unit `normal` attribute: the line material compiles from the `basic` shader the engine patches to always write the normal G-buffer, and an absent attribute would write NaN there (Known Issue (e)'s mechanism). Photoreal now draws those edges too, so `buildCityEdgeSegments` (one O(triangles) Map pass plus a second position buffer per mesh) runs for every static layer and every streaming cell in the default theme — instant on the Delft sample's 109 k triangles, not measured on a large stream. Fixing the winding properly needs solid-orientation analysis (ray parity per shell), not a centroid guess — and even then a viewer of third-party data would not be safe to cull.
- **Appearances (textures and materials) are parsed into the domain model and drawn per layer, never per rule.** `@cityjson/navara-core` reads CityJSON `appearance` (materials, textures, `vertices-texture`) through an `AppearanceMerger` that folds each unit's LOCAL tables — a static file has one, every CityJSONSeq/FlatCityBuf feature carries its own with local indices — into one deduplicated model-wide table (Rotterdam: ~10 k per-feature entries → 148 images) and rewrites indices as it goes; a `Surface` then carries `material[theme]` (index) and `texture[theme]` (index + one resolved UV per ring vertex, in lock-step with `rings`), and `CityModel.appearance` lists the themes some surface actually uses. Appearance is TOLERANT by rule: a malformed entry reads as untextured, never as a parse error. `buildCityMeshArrays` takes an `AppearanceTheme` (`{kind:"texture"|"material", name}`): a material theme swaps the semantic base colours for the material's diffuse colour (sRGB→linear; rules still override exactly as before), a texture theme writes surfaces SORTED by image into contiguous `textureGroups` and emits per-vertex `uvs`, reversing each UV ring by the same decision as its vertex ring (`orientExteriorRing`, hole rewinding). The mesh classes draw one city material (`createCityMaterial`, a lit Lambert) per group (three iterates `geometry.groups` for both drawing and raycasting, and the engine's MRT patch leaves `map` intact), load images through an injectable `TextureSource` (`texturedMaterials.ts`; Node tests inject a fake) and **white out a group's vertex colours only once its image is ready**, so highlights still tint a textured face and a missing image degrades to the plain look — the consequence, stated in the Rules tab, is that rule colours show only on untextured faces while a texture theme is active. Image paths resolve against the DATASET's url (`textureBaseUrl` = the layer's `modelRef` url; a local file has none, so its relative images stay unresolved with one warning), never against the app origin. The UI is one `AppearanceSelector` beside the LoD dropdown (`Layer.appearanceThemes` / `selectedAppearance`, default = the file's default texture theme, else its first texture theme, else a material theme; persisted in the v3 snapshot as `appearance`). Streaming mirrors the static path one seam over: the worker keeps one merger per open file (layer-wide indices), bakes the theme into each cell and ships the image definitions a cell uses plus the themes seen so far; `FcbStreamLayerHandle.setAppearance` is a forced SWAP commit (like a hidden-type change, because the theme is baked into vertex order), themes are learned like the LoD ladder (`streamStore.appearanceThemes`; a fresh open adopts the first texture theme when it appears), and one per-layer `TextureCache` (`layerTextures.ts`) is shared by every cell so an image two cells use loads once. UV origin: the spec is silent, three's default (`flipY`, bottom-left) is right — browser-verified on Rotterdam 2026-09-03 (facades upright) for both `.jsonl` and `.fcb`. Not drawn in v1: material transparency/specular/emissive (parsed, unused), per-ring texture indices (the exterior ring's wins), `borderColor`; an interior ring spelled `[null]` costs the whole surface its texture. **CityParquet** reads the `material_lod*`/`texture_lod*` JSON columns paired with each geometry column by suffix and the `textures.parquet`/`materials.parquet` sidecars by `id` (dataset-global, so one merger context serves every table of a package; UV pairs are inline, one per WKB ring vertex, a closing duplicate tolerated); every loader arm that can LIST a package (manifest, bucket prefix, bucket glob, picked folder) fetches the sidecars beside the object tables, a lone table has no siblings to look for and stays plain, and an unreadable sidecar is one warning, never a failed load. **CityGML** indexes every `app:Appearance` in the document once: textures by the ring `gml:id`s their `app:textureCoordinates` name (one UV per `posList` vertex, closing duplicate included — which is what `parseLinearRing` keeps too), materials by target id matched against the polygon and then its containers (composite surface, solid, boundary surface, building); `xlink:href` reuse of surface data and of `TexCoordList`s lands the same deduplicated image under the other theme, `app:TexCoordGen` and `GeoreferencedTexture` targets stay untextured, and a ZIP of several files merges the tables through core's `mergeModelAppearances` (its images live inside the archive and are therefore unresolvable — a documented gap). Browser-verified 2026-09-03: `.jsonl`, `.fcb` and a CityParquet package all draw Rotterdam's facades; the CityGML sample loads with its four themes and fetches its images (its 5 m house was too small to pixel-check on the software renderer).
- **The brand is Roofy, and its tokens are owned by ONE file; the plugins take its colours as a parameter.** `src/app/brand.css` (the Claude Design kit, mirrored verbatim in `public/brand/brand.css` for docs and slides — change one, change both) is imported BEFORE `app.css` and owns surfaces, text, borders, the four brand hues, the `--layer-*` legend colours (nature lime, energy amber, water blue, social orange — the mark's own four colours), the three type stacks (`--font-display` Outfit, `--font-ui` IBM Plex Sans, `--font-mono` IBM Plex Mono, self-hosted via `@fontsource` imports in `main.tsx`; the variable Outfit registers as `"Outfit Variable"`, which is why the stack names it first) and the radius scale. `app.css` only DERIVES: `--accent` is `--brand-primary` (lime, darkening to lime-700 on the light sheet), `--accent-fill`/`--on-accent` are the filled button (lime-500 with dark ink in BOTH themes — lime text on white does not hold contrast, so `--accent-text` is lime-900 there), `--tertiary` the brand blue, `--danger` the brand orange, `--warn` the amber. The logo is `src/ui/RoofyLockup.tsx`, an inline SVG whose fills are the `--layer-*` tokens, so it follows the theme toggle with no JS. **The plugins do not know the brand.** `CityJSONPluginOptions.colors` and `FlatCityBufPluginOptions.colors` (a `CityColors` — highlight, hover and the semantic surface palette; per-plugin default, overridable per layer through `AddCityModelOptions.colors`/`OpenStreamOptions.colors`; omitted keeps the plugins' historical amber and red-roof defaults) are the seam, and `src/scene/cityColors.ts` is the app's one answer, handed to both constructors in `NavaraViewport`: selection lime-500, hover lime-300 (lime-100 washes to white under the exposure-10 atmosphere), roofs in the darker brand orange, windows in the brand blue, theme-agnostic like the geo styles. The option is named `colors`, not `appearance`, because `appearance` is the CityJSON theme (textures and materials) the data carries; the palette is what the plugin draws where the data colours nothing, so `buildCityMeshArrays` takes it as a seventh parameter beside the theme. `GEO_HIGHLIGHT_COLOR_HEX` and the inspector's surface dots derive from the same constant, so a picked feature, a picked surface and the legend agree. The values are chosen for NO COLLISION: no highlight, hover or base surface colour is byte-equal to a rule preset, the new-rule default or the default geo colour (a selected ruled surface must still look selected, and a base roof equal to a preset makes the preset a no-op) — which is why the "Large roofs" preset and the new-rule default sit on lime-700 while the selection owns lime-500. Storage keys (`roofy-theme`, `roofy:snapshot:*`) and the debug global (`__roofyRenderDebug`) were renamed with the brand on 2026-09-05, deliberately breaking; Urbis-era saves are simply not listed. The Cloudflare Worker is still named `multiroof-viewer` (`wrangler.jsonc`, the workflows): renaming it changes the deploy URLs and is a Cloudflare-side change, not a rename in this repo.
- **Per-layer rules**: unchanged. Static layers compile to a `SurfaceStyleEvaluator` (`handle.setStyle`); streaming layers send rules to the worker (`handle.setRules`), which bakes vertex colours per cell.
- **"Color by" (12.3): one effective rule list, two consumers.** `colorBy` (`"surface" | "rules" | "single"`) is the ONE mode; the pre-12.3 `rulesEnabled` flag is gone from the in-memory `Layer` (still written/read in snapshots and share links, so old documents restore). `effectiveRules(layer)` — `features/rules/colorBy.ts`, memoised on rules-identity + the mode + the two colours — is the ONE array both renderers draw from: `"surface"` → `[]`, `"single"` → one zero-condition catch-all, `"rules"` → the enabled user rules then a trailing unmatched catch-all. Zero-condition rules evaluate true on the static path AND in the FCB worker (browser-probed before any of this was written), which is why no plugin change was needed. Synthetic rules exist only inside the effective list — `isSyntheticRule` tells a consumer apart, and a serialised one would be the same fact written twice; `effectiveRulesEnabled` (the boolean that goes with it) is always passed beside the array. `firstMatchingRule(attributes, metrics, rules)` reports a match by rule IDENTITY, never by colour.
- **Geo "Color by attribute" (12.3) paints per feature through the SAME evaluator path as the highlight.** The engine's `featureClick` pick carries a `batchId` re-minted on every feature-set recreation (never cache one), and `FeatureEvaluator.evaluate`'s callback receives `info.properties` with distinct per-feature values for point/polyline/polygon sets (browser-probed). `applyFeatureColors` (`scene/geoLayerSync.ts`) is the ONE function that paints a feature: highlight when picked, else the category colour when the layer colours by an attribute, else the base colour — deselection restores the category, and feature-set recreation re-applies. Categories are the first 8 distinct values in first-seen order on `CATEGORY_PALETTE_HEX` plus a fixed OTHER bucket (`CATEGORY_OTHER_HEX`) for everything past the eighth. Stroke colour is DEFERRED: the engine's `PolygonMaterial.outlineShow/outlineColor/outlineWidth` renders nothing (probed, byte-identical frames) and does not survive a `Layer.update()` re-description, so the single `color` stays for fills and lines.
- **Streaming**: camera-driven commits are triggered by Navara `movestart`/`move`/`moveend` on `view.camera` (never a render-loop timer). The settle controller commits on **`moveend`**, not `idle` — `idle` also fires for non-camera changes and would flush a debounce a `moveend` already armed. Each resident cell is its own mesh in its own ENU frame.
- **One viewport per process**: `@navaramap/three` keeps its tile worker pool in a module-level singleton, so a second `view.init()` before the first `dispose()` throws. `NavaraViewport` serialises engine lifetimes through a module-level slot (StrictMode-safe) and enforces at most one mounted viewport.
- **CitySceneHandle**: `fitAll`, `fitLayer`, `fitBounds`, `alignView`, `getCameraState`, `setCameraState`, `flyTo` — camera state is geographic `{lng, lat, height, heading, pitch, roll}`, and `flyTo(target, durationMs?)` takes a POINT and a height only (the address search's door; orientation stays the active view mode's decision; the engine call underneath is `view.flyTo(camPos, { duration })`, whose promise since 0.1.0 resolves at the END of the flight — every programmatic move returns it into `withSettleSuppressed`, so the streaming settle gate holds for the whole animation and the owed commit lands `FLYTO_QUIET_MS` after touchdown) — where `fitBounds` takes caller-supplied `GeodeticBounds` (same framing and settle suppression as `fitLayer`, plus a finite-value gate, because the box comes from outside the engine's registries): it is the geo-layer zoom, whose extents the APP computes in the engine-free `features/geoLayers/geoLayerBounds.ts` (GeoJSON coordinate walk; a 3D Tiles root bounding volume — region/sphere/box; raster-xyz has no intrinsic extent, so it has none), because Navara (0.0.5, and still 0.1.1) exposes no bounds API for the geo layers it draws — plus a `ready` promise that resolves after `view.init()` and a `getStreamingPlugin()` promise so early `.fcb` opens queue instead of dereferencing null.
- **Persistence**: snapshot version 4 (`activeLayer` = `{ kind, index }`, the index within `snapshot.layers` or `snapshot.geoLayers`); share links stay version 3 because the hash carries no active-layer field. A v3 snapshot migrates in `persistence/migrateSnapshot.ts` (the version bump plus "first layer active"); v1/v2 are still rejected with an explanatory message because their cameras were scene-space tuples that cannot be converted. `handleRestore` keeps `(string | null)[]` arrays aligned with the snapshot's layer lists so a skipped placeholder never shifts the saved index.
- **ONE active layer, ONE selection (Milestone 12).** `src/features/workspace/workspaceStore.ts` owns the single `activeLayerId` for city, streaming and geo layers alike; the layer and geo-layer stores carry no active id. Rule 1 is enforced in the store's own `setActiveLayerId` (a selection on another layer is cleared before the write), so no caller can bypass it; `activateLayer` in `layerCoordination.ts` is the documented entry point and never moves the camera. `installWorkspaceInvariants` (installed once by `App`) subscribes to the layer, geo-layer and selection stores: the first layer of an empty workspace becomes active, a removed active layer hands over to a surviving neighbour in unified order (city rows first, then geo), a selection whose owner is removed or hidden is cleared, and a selection activates its owner. Switching pick mode converts the selection (surface → owning object) instead of wiping it; Escape clears it unless a modal is open. Never write `useWorkspaceStore.setActiveLayerId` from a component that has not read the rule above — it is the same call either way, but the intent belongs in `activateLayer`.
- **The camera fits ONCE, when the first content of a scene lands.** `NavaraViewport` mints its fit token only when the workspace goes from no layers to some (city + geo rows, `previousLayerCountRef`) and, for streams, only when both live registries are empty; adding a second layer of any kind never flies the camera (`Zoom to layer` is the explicit move). Since 12.2 both producers answer to workspace ROWS, not live registries: a stream fits iff, at registration, the layer store holds exactly its own row and the geo store is empty; the first-geo fit is an `App` effect on the unified order going 0 → 1 with a geo layer (skipped while `isAutoFitSuppressed()`), which awaits the scene gate — retrying once, because React StrictMode's mount/unmount pass rejects the first gate — re-checks the single-row predicate after every await, and calls `fitBounds` when `resolveGeoLayerBounds` returns bounds (a URL-backed GeoJSON costs one fetch of the document, shared with `Zoom to layer`). Restore sets `previousWorkspaceSizeRef` itself so a saved camera is never overwritten by the edge.
- **The shell keeps one viewer canvas (Milestone 12).** `shellStore` owns session-only panel sizes, collapse state, the map-column drawer, and per-layer section requests. `ViewerShell` keeps the map mounted while panels resize/collapse and while the drawer expands; the expanded drawer mirrors the current viewport attribution in its own footer. After entering the viewer, removing the last layer or choosing New workspace retains the canvas and presents File / URL / Catalog actions. First-run landing remains available before entering the viewer, and load errors remain visible in the retained viewer. The header contains workspace actions and Preferences; scene controls live on the map. `ResizeHandle` supports pointer dragging and keyboard arrows, Page Up/Down, Home/End with bounded absolute sizes and ARIA values. Interface appearance remains system / light / dark under `roofy-theme-preference`.
- **The STAC catalog browser reads a bucket, not an API.** `STAC_CATALOG_URL` is hardcoded to `https://storage.googleapis.com/city3d-stac/catalog.json` — a public static file with no per-deployment variation, and deliberately **no `VITE_` override**, because `.env` is dotenvx-encrypted and a build-time var here would inline ciphertext (the Maps-key footgun). The root is a link document carrying none of the metadata a card shows, so `stacClient` crawls one `collection.json` per `rel:"child"` at concurrency 6; a per-collection failure is logged and skipped, only an unreachable root is fatal. **Items never come from the catalog's own `rel:"item"` links — those 404** — and there is no `/search` endpoint: the only source is the collection's stac-geoparquet mirror (`items-geoparquet`, matched by media type or `collection-mirror` role, present on ~31 of the 53 collections; the rest are listed and marked "No items indexed"). That file is ≤ ~2.24 MB, so it is fetched WHOLE and handed to the app's existing DuckDB-wasm via `queryParquetBuffer` — no httpfs, no range reads — with the SELECT list built per file from a `DESCRIBE` probe, since the mirrors are independently generated and one missing column must not cost a whole collection. Loadability is decided by calling `detectEncoding` itself (`stacAssets`), never a parallel media-type table, so the Add button cannot drift out of agreement with what `addLayerFromUrl` will actually do; `.zip` CityGML archives are the one deliberate exception (loadable — see the ZIP bullet below), while `.7z`/`.tar` stay download-only. Entry points are the landing "Browse catalog" button and the Add Layer dialog's "Catalog" tab (which widens the modal via `.modal-wide`); `onAddUrl` is `(url) => Promise<AddUrlResult>` (`{ok:true} | {ok:false, message}`) all the way down the layer-add chain so the browser can report a failed add inline (`role="alert"`) — with the LOADER'S OWN SENTENCE per item, because "Unsupported CityJSON version 1.0" and "the host blocks browser access" demand different next moves and a canned "try again" serves neither — and stay open for the next one. The sentence is read synchronously via the loader hook's `lastError()` (a ref mirror of its error state), since the caller that just awaited the add cannot see the fresh state value from its closure.
- **STAC-sourced `.city.json.gz` layers are reader-backed from the gunzipped bytes `loadFromUrl` returns.** Remote loading is gzip-aware — `HttpClient.fetchBytes` returns the same envelope as `fetchText` (so every friendly HTTP-error branch survives), `decodeModelBytes` gunzips on magic bytes rather than on the extension, and `detectEncoding` strips one trailing `.gz` — because 3D BAG, the largest CORS-clean collection, serves `.city.json.gz`. Such a layer is reader-backed like any other CityJSON URL, and there is nothing special-cased about it: `loadFromUrl` returns the GUNZIPPED bytes, and those are what `addCityLayer` hands DuckDB, so `read_cityjson` reads a plain CityJSON buffer and never sees a gzip stream (it cannot read one, by name or by magic — which is exactly why the decode happens before the bytes reach it). The per-layer table, the `SourceProvider` and the whole build are the ones described in the DuckDB bullet below; `loadModelIntoDuckDB`, `loadCityModelFromMemory` and `shouldUseSourceUrlPath` are all gone, along with the single shared table they served.
- **CityParquet is a STATIC whole-load layer, decoded by an engine-free parser in the plugin package.** Fetched bytes become the same normalised `CityModel` the CityJSON path produces (`parseCityParquetManifest` → `assembleCityParquetModel`), so rendering, LoD switching, rules, picking, persistence and the inspector's attribute inheritance all arrive for free through `CityJSONPlugin.addCityModel` — nothing about CityParquet reaches the engine. Decoding deliberately does **not** go through DuckDB: rendering must not depend on DuckDB init state (today an optional analytics component that can fail gracefully), and a DuckDB decoder would be untestable under Node. Analytics therefore take the **flat fallback** (`{ kind: "model" }` — rows built app-side from the parsed `CityModel` and loaded through `read_json_auto`), because `cityparquet_read` is unusable in the wasm build: the layer gets its own table like every other, just without a reader or a source behind it, so no CityParquet package can be exported back out. See the DuckDB bullet below. This is NOT the route a `.city.json.gz` layer takes — that one is reader-backed from gunzipped bytes. A large multi-file load decodes **sequentially on the UI thread** (fetching is pooled, decoding is not), which is the same character the static CityJSON path already has; a worker or a streaming CityParquet layer is future work, and `MAX_CITYPARQUET_FILES` is what keeps that pause bounded.
- **hyparquet 1.28.1 is VENDORED into `navara-cityparquet/src/vendor/hyparquet/`, patched.** Upstream implements `DELTA_BYTE_ARRAY` only in the DataPage **V2** reader, and `cityparquet-rs` writes through arrow-rs, which emits **V1** pages with `DELTA_BYTE_ARRAY` string columns — so an unpatched reader throws on every real file. A package-manager patch would have to be declared and kept in sync across the repo's npm/pnpm split (app root vs submodule) and fails as a runtime decode error, not an install error; one vendored copy is the same bytes for every consumer. Two upstream quirks are worked around from the OUTSIDE, not by editing the vendor: a partial `parsers` option silently drops the parsers it does not name (so `tableReader.ts` spreads `DEFAULT_PARSERS` and passes a COMPLETE object), and that complete override is also what disables hyparquet's geoparquet auto-conversion, which would otherwise hand back the LoD0 footprint column as GeoJSON instead of WKB. `src/vendor/hyparquet/VENDORED.md` carries the exact diff, the un-vendor condition and the re-vendoring procedure — read it before touching that directory.
- **What a CityParquet URL MEANS is decided by one pure function.** `src/features/cityparquet/sourceClassify.ts` maps a string to a source with no I/O, so the loader, the Add-Layer dialog's enable logic and the tests cannot disagree: a single `.parquet` table; an https **package directory** (a `metadata.json` STAC Item whose `cityparquet-objects` assets are the authoritative inventory); or, on `gs://`/`s3://` only, a glob or a prefix expanded by the bucket's ANONYMOUS listing API. Plain-https wildcards are **rejected with a sentence** rather than silently unsupported — the shape is recognisably CityParquet, the host just exposes no listing API — which is why the classifier throws and `isCityParquetUrl` is the total wrapper that still routes such a URL into the CityParquet arm so the user sees that message. Expansion is capped at **64 object tables** (`MAX_CITYPARQUET_FILES`) on **every** arm — glob, listing, a manifest's declared hrefs and a picked folder alike, because the cap is a whole-LOAD memory bound and a manifest is a list someone else wrote (3D BAG's root package declares up to a thousand); a full tiled dataset is a streaming problem, not a whole-load one, and the cap is reported, never silently applied. A `.parquet.gz` classifies as a **table** even though the format defines no gzipped spelling — precisely because it defines none: owning it here sends the bytes to the reader, whose "could not be read as Parquet" is the honest report, instead of leaking the URL to the CityJSON loader to be called bad JSON. CRS comes from the footer's `city.crs` PROJJSON and only when its authority is **EPSG** — anything else fails the existing CRS gate. Out of scope in v1, deliberately: appearance (materials/textures), geometry templates, the experimental `CityParquetArrowNative-v1` encoding (rejected by name, never guessed from Arrow shape), partial reads and authenticated buckets.
- **A `.zip` of CityGML is loadable, decided by MAGIC BYTES, and one zip is one layer.** The STAC browser's Add button and the URL/file loaders agree because both changed together: `stacAssets` marks `.zip` loadable (label "CityGML archive (ZIP)"), and `loadFromUrl`/`addLayerFromFile` sniff `PK\x03\x04` on the fetched bytes (never the extension) before the encoding switch, so every friendly HTTP/CORS/404 sentence survives. `src/domain/citymodel/cityGmlArchive.ts` (fflate, a direct dep) reads the archive in TWO passes — list entries inflating nothing, then inflate only the selection — because a real PLATEAU archive is 251 entries / 4.4 GB uncompressed; entries are capped at 32 (reported, never silent), `.gml`/`.citygml` are content and `.xml` is a fallback only when no `.gml` exists (PLATEAU ships 33 `.xml` sidecars beside its 251 `.gml`), and several entries merge into one `CityModel` only when CRS agrees and no id collides — otherwise a sentence names the reason. `.7z`/`.tar` stay download-only (no decompressor). Coverage honesty: most catalog zip items still fail for PRE-EXISTING reasons (the American host sends no CORS, PLATEAU's EPSG:6697 is degree-based and refused by the metric gate, Montreal's mirror carries stale signed URLs); the German Länder items work end-to-end because `normalizeSrsName` now maps AdV `ETRS89_UTM32/33` URNs to EPSG:25832/25833 (horizontal only — the `*…` suffix names the vertical datum, which the geoid path already owns).
- **Every city layer gets its OWN DuckDB table, built from bytes, and the source is dropped.** `insights/layerTables.ts` owns a registry plus ONE async FIFO queue: `addCityLayer` (the single door every static add goes through — a dropped file, a picked folder, a URL, a restore, a share link, a re-link) enqueues a build, and `layerTableLifecycle.ts` diffs the layer store to drop tables and to enqueue a STREAMING layer's (whose rows arrive cell by cell, so it rebuilds on commits, debounced 500 ms, only while a CONSUMER of the table is looking — the table panel, the processing toolbox, or a run of that layer still in flight; the export dialog forces one rebuild when it opens). The single global `city_objects` table is gone, and with it `shouldUseSourceUrlPath`/`loadModelIntoDuckDB`/`loadCityModelFromMemory`/`loadResidentObjectsIntoDuckDB` — one shared table meant a second layer silently replaced the first one's analytics. A build AWAITS `initDuckDB()` before touching DuckDB and parks its source if the engine is not up (the boot is ~5 s and a restored snapshot lands inside it); `retryEngine()` rebuilds the parked ones. A reader-backed layer hands DuckDB the DECODED BYTES the loader already holds (`loadFromUrl` returns `{model, bytes, encoding}`), never a URL: `read_cityjson` over http is unexercised in wasm and CORS-dependent, and registering bytes means a URL layer is never downloaded twice — `registerBuffer` CONSUMES its array (the worker transfer detaches it), so a re-registration goes through the entry's `SourceProvider`. The build drops `geometry_*`/`geometry_properties_*`/`material_*`/`texture_*`/`template` (53 of 70 columns on Delft, 2.45x less table memory) and then drops the source buffer — probed: a materialised table survives `dropFile`, while the DROPPED NAME resolves to ZERO BYTES forever and fails with a misleading JSON parse error, so VFS names come from a module counter and are NEVER reused. LoDs are DERIVED from the reader's own column names (`{label, suffix}`) and a suffix is never rebuilt from a label: 3D BAG spells LoD 0 `geometry_lod0_0`. CityGML, its ZIP, CityParquet and streaming residents take the FLAT FALLBACK: rows built app-side and loaded through `read_json_auto`, with the column names ALIGNED to the reader's (`id, feature_id, object_type, parents, children, bbox`, `parents`/`children` NULL rather than `[]`, `bbox` the reader's own `STRUCT(xmin, ymin, zmin, xmax, ymax, zmax)` of DOUBLEs built from `CityObject.bbox` — NULL for an object with no geometry — so a tool reading `"bbox"."zmin"` binds on every layer kind, `feature_id` from `domain/citymodel/featureId.ts`, with `read_json_auto` pinned to `sample_size = -1, field_appearance_threshold = 0, map_inference_threshold = -1` — the defaults collapse rows whose keys vary into ONE `MAP(VARCHAR, JSON)` column, measured — and an `ALTER COLUMN … TYPE` per fixed column afterwards, because an all-NULL list column infers as JSON and a DATE-shaped id as DATE) so `parents IS NULL` is the feature-root test on every layer. **Every SQL string is a pure function** in `insights/sql.ts`, unit-tested against exact strings; `compileFilter` refuses an unknown column, an impossible operator, an empty needle or a non-numeric value BEFORE the query is sent, and `ORDER BY` is table-qualified so a `castText` column sorts on the base column rather than its `::VARCHAR` alias. The map filter (`Layer.visibleObjectIds`, pushed by `handleSync` to the plugin's `setVisibleObjectIds`) expands matches to whole FEATURES — a Building carries the attributes, its BuildingPart the geometry — with `COALESCE("feature_id","id")` on both sides of a POSITIVE `IN`, because one NULL `feature_id` makes a `NOT IN` predicate NULL and hides nothing; `null` means no filter and an EMPTY set means "nothing matched, draw nothing". Streaming layers cannot be map-filtered yet (the id set would have to travel to the FCB worker). Export goes through DuckDB's own writers — `COPY TO parquet|csv|json` (with `ARRAY true` for JSON, and no `::VARCHAR` cast: that one is the grid's), and for a package one read of the source into a scratch schema, a CTAS per CityGML module, `cityparquet_init` as its own statement, then `cityparquet_write` zipped with `fflate` — and **never** `FORMAT cityjson|cityjsonseq|flatcitybuf`, whose sinks bypass DuckDB's VFS entirely (no file is created at all; the same extension writes fine through `cityparquet_write`, which is the upstream pointer). Those three are shown DISABLED in the dialog so the capability is discoverable. **Every read-back is validated BY CONTENT** — `PAR1` magic, `JSON.parse`, a newline-terminated CSV header — because a MISSING VFS name reads back as ONE GARBAGE BYTE with no error at all, while a genuinely empty file reads 0; DuckDB's `glob()` lists names that were never created, so it is fit only for a cleanup check and never for discovery, and the write's own result rows are what name the output. Filter, sort, page, sync-to-map and `visibleObjectIds` are SESSION state: snapshot schema stays v3.

## Known Issues

- **`ViewContext.applyShadowMaterial` is fire-and-forget.** It emits `shadowApplied`; `SunLightDesc.onCreate` is the only listener and it calls `this._instance?.setupMaterialForCSM(m)`. A material registered before the photoreal scene's sun descriptor exists (or after it is destroyed) is silently dropped, and `MaterialStates.setup` never sets `needsUpdate`, so a material that already compiled keeps its stock program. That program loops all four cascade lights (colour ≈1.7 + 1 + 1 + 1, one direction), so the direct term comes out about 4.6× too bright while the cascade shadow maps still read: sunlit and oblique facades pinned near white, cast shadows still visible — measured live by swapping in an unregistered clone (sunlit wall 220, shaded 155–175, roofs washed pink). No app flow reproduces it today (`applyForwardLighting` runs after `addDefaultPhotorealScene`, the plugin registers every material the moment it creates it, and the shadow toggle keeps the CSM define), but any reorder of the scene setup would produce exactly the "no shading" symptom, brighter. Check `material.userData.defines.CSM === 1` on a live city material before suspecting the lighting.
- **A loaded layer once drew nothing in the colour pass while still casting shadows** (2026-09-06, headless SwiftShader, one page load out of many): the status bar reported the triangles, the mesh was visible with a compiled program and no diagnostics, the ground carried its cast shadows, and the buildings themselves were absent for the page's whole life; a reload rendered normally. Not reproduced since; noted so the next sighting is not mistaken for a lighting regression.
- **Navara is beta** (`@navaramap/* 0.1.1`; the GitHub releases page is the changelog). `three` and `postprocessing` are pinned exactly (0.183.2 / 6.39.0) to satisfy its peer ranges; bump them only together with a Navara upgrade. The 0.1.1 upgrade (2026-09-04) absorbed four breaking changes on the app side — pointer events + `featureClick`, `flyTo` options object + promise, degree-based geodetic helpers, a 5 px click tolerance — and adopted `view.lit = false` (see the lighting bullet); each upstream item below is re-marked with what the upgrade found. Upstream bugs found during the migration, all worked around locally and worth reporting: (a) the engine inlines a **second** copy of three r185 via `@navaramap/font` and its worker chunk — unfixable by dedupe, so never rely on `instanceof` across the font/label subsystem and treat `window.__THREE__` as unreliable (0.1.1: the "Multiple instances of Three.js" warning still logs — persists); (b) `view.registerMesh()` throws if called before `await view.init()` (`addPlugin()` must still come before init; not re-probed on 0.1.1, the session sequencer never exercises it); (c) the engine emits no pointer events for a cursor over the sky (`convertToMapEvent` returns null and the emit is skipped — persists on 0.1.1, read in source), so `NavaraViewport` also listens on the DOM container to clear hover/cursor state; (d) the tile worker pool is a module-level singleton, so at most one viewport can exist per page; (e) [0.1.1: G-buffer attachments are now DYNAMIC — allocated as the union of the active effects' `static requiredBuffers` (`AerialPerspectiveEffectDesc` declares `["normal"]` and re-binds `ctx.getNormalTexture()` every frame, so a custom effect that reads a buffer must declare it, and `getNormalTexture()` can be `undefined`); the terrain dependency below still stands; since issue #13 the app runs forward-lit and no app effect reads the normal buffer, so the NaN would no longer black the frame — the terrain stays for relief and shadows] the globe contributes NO normals to the MRT normal attachment unless a terrain (or hillshade) layer supplies them, and the `useNormal` view option that would is absent from 0.0.5's `Options`. Without one, a **raster basemap** on the globe made every texel of that attachment read back as half-float NaN (`0x7e00`) — `packNormalToVec2` divides by the L1 norm, so one zero normal poisons the shared buffer — which made the aerial-perspective pass's irradiance term NaN and the whole frame black. FIXED by adding the terrain layer (`terrain.ts`, `requestVertexNormals: true`), which is why `useNormalBuffer: true` is safe now and why removing terrain would re-break the lighting; (f) [persists in 0.1.1, read in source] `EffectDesc.onDestroy()` removes a pass from the composer without disposing it, and the clouds composite through the aerial-perspective pass's `atmosphere.overlay` — so `handle.delete()` alone leaves the clouds frozen in the sky. `disposeCloudsPass` calls `Clouds.dispose()` first; (g) [persists in 0.1.1, read in source] the `ThreeView` constructor branches on `canvas` ALONE, so a view built with `container` but no `canvas` appends its own `<div id="navara-root" style="width:100vw;height:100vh">` to `document.body`, re-parents the canvas out of it during init, and leaves the empty div there until `dispose()` — a second full viewport of document height that made the whole PAGE scroll. `NavaraViewport` therefore creates the canvas itself and passes both `canvas` and `container`; (k) [did NOT reproduce in the one photoreal→cyber→photoreal round trip smoked on 0.1.1 with Positron; still undiagnosed] **a raster basemap re-added a SECOND time through the theme path renders nothing** — `addSource`/`addLayer` both succeed (fresh source and layer ids, no console error, frame alive at 60 fps) but the globe shows bare terrain. Browser-reproduced 2026-08-06 on UNMODIFIED `develop` with photoreal→cartoon→photoreal→cartoon: the first Positron entry drapes correctly, the second leaves a featureless globe. It is NOT the number of swaps — the basemap PICKER swaps rasters repeatedly in one session without a hitch (osm→dark→positron→dark all verified) — so the trigger is something the theme commit does alongside the swap. This is why the cyber theme's new `carto-dark` sheet is intermittent on a second entry; the theme is otherwise correct and a reload restores it. Not diagnosed further — and note it did NOT reproduce on 2026-08-06 with the elevation-heatmap basemap picked: photoreal→cyber→photoreal→cyber→photoreal drew CARTO's dark sheet on both cyber entries and restored the heatmap both times, so the trigger remains unidentified rather than universal; (h) a `geojson` source with `tiled: true` (the documented GeoJSON-VT index for large files) renders **nothing** — no error, no features (browser-verified). `geoLayerDescriptions.ts` emits only the bare `{ type: "geojson", url | data }` form, the one the engine's own examples use; re-test before reintroducing `tiled`; (i) writing the globe's live setters (`view.globe.color`, `view.globe.wireframe`) kills the frame — and colours passed to `skyBox`/`glowGlobe` mesh descs must be engine `Color` INSTANCES (they call `.toArray()`; a bare hex makes `addMesh` throw and the half-registered desc can freeze frame presentation). The scene themes therefore never touch the globe setters (`sceneThemePolicy` pins this with a test) and manufacture colours by cloning `view.globe.color`. **`wireframe` was RETESTED on 2026-08-06** against current code (the two frame-killers it was first convicted alongside — bare-hex mesh colours and the albedoScale-only AP update, (j) — are both fixed), twice and in isolation: through the wireframe theme's entry path, and as a bare `view.globe.wireframe = true` with nothing else changed. **Verdict: still poisoned, and the failure mode is worse than "black"** — frame PRESENTATION freezes on the spot (the canvas keeps showing the last frame while the app's own render loop still reports 60 fps, so hiding a layer or flying the camera changes nothing on screen), no exception and no console error, writing `false` back does NOT recover it, and only a reload does. The globe cannot join the hidden-line drawing on 0.0.5; the wireframe theme buys its ground back with exposure/albedo instead. `view.globe.color` was NOT re-probed and stays banned on the earlier evidence. `view.globe.elevationColormap` (same family) WAS probed the same way and is **clean** — a hand-built `ColorMap` applied with the frame presenting and the irradiance intact — and since 2026-08-11 `addBasemap` writes it (a hand-built RdYlBu `ColorMap`, the docs' own LUT) whenever the elevation-heatmap basemap is added, re-verified live: ramp applied, frame presenting, camera flights and basemap round-trips still draw (`TURBO_COLOR_MAP` remains unexported in 0.0.5, which is why the ramp is hand-built); (j) [persists in 0.1.1, read in `AerialPerspectiveEffectDesc`] an effect update's `onUpdateConfig` does `Object.assign(this.config, e)` — top-level keys are REPLACED in the stored config even when the live instance applies per-field, and an internal pass rebuild reconstructs from that config. Any `aerialPerspective.update` must therefore carry the FULL `{ irradiance, useNormalBuffer, albedoScale }` calibration, never `albedoScale` alone — moot since issue #13, because the app no longer writes the pass at all, but binding for whoever does next; (l) [persists in 0.1.1: both bundles import only `three` and `@navaramap/engine*` and carry the `postprocessing@6.39.3` region; the cyber halo re-verified 2026-09-04] the engine INLINES its own copy of `postprocessing` (6.39.3) into its bundle — the peer dep is declared but never imported — and `EffectDesc.insertPass` picks the pass to hand the composer with `instanceof` against the engine's own Pass classes, so a pass built from the app's `postprocessing` import matches nothing and `addEffect` SUCCEEDS while inserting nothing: a silent no-op with no error anywhere. A custom effect must therefore wrap the app-built effect in the ENGINE'S exported `Effect` class (verified structural-only, no instanceof inside it) — see `src/scene/bloomEffect.ts` (`cityBloom`, the cyber theme's halo), and re-verify the halo renders on any Navara or `postprocessing` bump.
- **Vertical placement depends on a third-party service, and is EGM2008-accurate, not NAP-exact.** `geoidHeightAt()` fetches from `terrain.reearth.land`, which is **best effort with no SLA**. On any failure (offline dev, service down, unexpected tile encoding) it resolves `0` with one `console.warn` per layer and the model renders at its old, geoid-separation-low position — visibly sunk against photoreal terrain, not missing. Even on success the GEOID residual is decimetre-level (EGM2008 vs the national datum, and Terrain-RGB quantises to 0.1 m) — verified end-to-end 2026-08-06: the browser decodes N = 43.90 m at Delft byte-identically to ground truth, and building shells wrap Google's independently-georeferenced photogrammetry to ~1 m. But building bases can still visibly float or sink a few metres against the **quantized-mesh terrain skin**, because Mapterhorn derives from a ~30 m global DSM that averages streets, canal walls and vegetation in cities (the z12 tile over Delft spans 36.5–57.3 m ellipsoidal where street level is ~44 m). That is the terrain data's urban accuracy, not a bug in the height pipeline; do not "fix" the offset to make bases touch this terrain, and do not treat placed heights as survey-grade.
- Vertex normals are computed in source-CRS space by `buildCityMeshArrays` and are **not** recomputed after the ENU projection, so shading carries a slight distortion from the projection's scale factor and convergence. Shared by the static and streaming paths; visually negligible at city scale, but it is a known limitation, not an oversight.
- **A streaming commit is bounded for LIVENESS, never for performance.** `LEVEL_SWAP_TIMEOUT_MS = 1500` was a performance deadline and was removed on 2026-08-05: a layer's SECOND commit is always a LoD swap (the first runs with an unlearned ladder, so it resolves to `all`), and on any host where that full-cover swap exceeded 1.5 s the timeout path returned _before_ recording `_lastLod`/`_level` — so the next settle recomputed the same equally-slow plan. Once triggered it was permanent: nothing loaded on camera movement again. The replacement is `COMMIT_FETCH_TIMEOUT_MS = 30_000`, ~3x the slowest healthy commit measured, which exists only so a silent range read cannot leave the status on "fetching" forever; it records nothing, so the next settle retries in full. Cancelling work the user has moved on from is `abortInFlight()` + the worker epoch, not a timer.
- Measure and box-select are **disabled**, not implemented: `ViewerToolbar` still offers the modes and `pickEventHandlers` still routes them (picking turns off), but nothing draws a rubber band or a measurement. Pending re-implementation against Navara.
- The vite-plus test runner has a bug that breaks `describe` for files importing from `"vite-plus/test"`; all test files were migrated to import from `"vitest"` instead (2026-07-28) and `npx vitest run` is green (0 failed files). Do not reintroduce `"vite-plus/test"` imports in new test files.
- **The DuckDB status pill holds a SNAPSHOT.** `App` reads `getDuckDBStatus()` once, after `retryEngine()` resolves, and keeps it in React state — but `ensureExtension` publishes a fresh status every time it loads `spatial` or `three_d`, and nothing re-reads it. Nothing calls `ensureExtension` today, so the pill is never wrong; the first analysis feature that loads an extension lazily will leave the tooltip listing the boot-time extensions and omitting the one it just fetched — exactly the drift the tooltip exists to make visible. The fix is a `subscribeDuckDBStatus(listener)` in `duckdb.ts` which `publishReady` notifies, with `App` subscribing rather than snapshotting.
- **A streamed LOCAL CityParquet folder restores from one table only.** A picked folder over 128 MiB of object tables streams from its `{blobs}` (`src/features/cityparquet/streamDecision.ts`), but its snapshot records only `{type:"file", fileName}` and re-linking an unavailable layer (`App.tsx` `handleResolveUnavailableLayer`) accepts ONE file, so the re-linked layer is that table alone. URL sources are unaffected: their `modelRef` is the URL, and every restore re-runs the static/stream decision.
- **`spatial` and `three_d` are loadable but have nothing to operate on.** The layer table is attribute-only; a geometry predicate needs either geometry columns materialised (the memory the design exists to avoid) or a computed-columns feature that reads the re-registered source. Neither extension autoloads in wasm, and `spatial` is a CORE extension — `INSTALL spatial` (~5 s / 23.6 MB), never `FROM community`, which is what `cityjson` and `three_d` use. Two `three_d` traps for that follow-up: `ST_3DFromWKB` throws on a MultiPolygon Z row and ONE such row poisons a whole column query (use `ST_3DTryFromWKB`), and `ST_3DVolume` raises "solid is not manifold" on an unguarded aggregate (guard with `ST_3DValidationReport(...).is_valid`).

## Milestone records moved from CLAUDE.md

Milestone tracking lives in `docs/roadmap.md`; this entry was recorded only in `CLAUDE.md` and is kept here so nothing is lost.

- Navara 0.0.5 → 0.1.1 (beta) upgrade, issue #14 (2026-09-04): Complete — breaking changes absorbed at the engine seam, `view.lit = false` adopted; `three`/`postprocessing` pins and the geo-layer `featureHover` events deliberately left for later. Browser-smoked under `lit = false` on 2026-09-05: photoreal, cartoon, wireframe and cyber all render as designed; cyber A/B'd against a 0.0.5 `develop` checkout — identical on Delft, and the tiny two-buildings fixture washes out in cyber on both versions (pre-existing, see the fog-light comment in `sceneThemePolicy.ts`). Google 3D Tiles remain unsmoked (no API key on the dev host). CARTO tiles now carry an "API KEY REQUIRED" watermark — a provider change, not ours.

## `src/insights/`, not `src/analytics/`

The DuckDB layer lived in `src/analytics/` until 2026-09-06, when a dev session
came up blank with only this in the console:

    http://localhost:5174/src/analytics/layerTables.ts net::ERR_BLOCKED_BY_CLIENT

`ERR_BLOCKED_BY_CLIENT` is the browser refusing to issue the request — a
content blocker matched the `analytics` path segment and stopped it before it
reached Vite. The dev server was serving the file correctly the whole time
(HTTP 200, 96 kB via `curl`), and a clean Chrome profile with no blocker
rendered the app fine. Because Vite serves unbundled ES modules by their real
filesystem paths in dev, one refused module aborts the import graph and the app
renders nothing at all.

The exact rule was not identified: the browser was Comet, whose bundled list
is not inspectable, and no bare `/analytics/*` rule appears in EasyPrivacy,
uBlock's privacy list or AdGuard's spyware list (95 more specific `analytics/`
rules do). The blocked request is the evidence, not a matched rule.

`insights` was checked against those same three lists before the rename: all 10
hits are specific paths (`/_vercel/insights/script.js`, `/insights/reportEvent/*`,
`/insights-emitter/*`) and none matches `/src/insights/…`. That is the best
available assurance, not a guarantee — a blocker with its own list could still
object, in which case rename again rather than reaching for an exception.

Production was never affected: the built assets carry hashed names
(`index-*.js`) and no `/analytics/` URL survives bundling. So this was a
dev-only trap, but it hits every contributor whose browser blocks trackers, and
a per-browser blocker exception has to be redone on every machine.

The same reasoning bars `ads/` and `tracking/` as directory names. Prose is
fine — the UI still says "the analytics engine is not running"; only the URL
path is visible to a blocker.

## Milestone 12 reconciliation (2026-09-07)

- City filters are coordinated for the lifetime of App, independently of whether the drawer is mounted. Applying a filter updates whole-feature map membership and removes excluded selection; clearing invalidates pending queries. Streaming filters remain table-only over currently loaded records. Paging, sorting, chosen columns and selected-only views do not change map membership.
- Records default to root Buildings, with Raw objects available explicitly. Roof area, mean slope and part counts resolve descendant geometry for static and resident records. Derived column keys avoid collisions with source attributes; Raw retains literal source values. Missing geometry/resident descendants produce unavailable metrics. Exact Raw object navigation temporarily targets the requested object without destroying the applied filter.
- Vector records use a prepared GeoJSON clone carrying stable feature identity. Unique source IDs retain their type; missing/duplicate IDs use document position. Renderer metadata preserves any colliding source property and is removed from public attributes/exports. Selection identity is independent of reminted GPU batch IDs; GeoJSON preparation rejects stale results after relink, removal or retry. Filtering, category colours and selection highlighting share the feature evaluator, including explicit visibility restoration after Clear. Geo feature hover events remain unsubscribed.
- Legend units follow the rendered content: surfaces for city palettes, first-matching roof surfaces for rules, and features for vector categories. Streaming legend counts are explicitly currently loaded; unavailable surface metrics are not presented as zero.
- Sun & shade and Scene settings are exclusive nonmodal map sheets. Escape closes a sheet before clearing selection and restores trigger focus. Solar instants remain UTC; the explicit Amsterdam/UTC/browser display timezone survives save/share. Seasonal presets preserve the local clock time. Shadow quality is a validated browser preference in the existing rendering store.
- Programmatic camera actions remain inside `withSettleSuppressed`. Selected-building fits combine descendant bounds and resident height offsets. Status coordinates are WGS84 longitude/latitude with ellipsoidal height; they are not source-CRS or orthometric coordinates. Terrain and unconditional geoid attribution remain part of the viewport.

Browser acceptance procedure: `scripts/smoke/ui-redesign.md`. The reconciliation ledger records test results and final visual checks. User-owned design/product files are preserved separately from these implementation notes.

## Processing toolbox seam (M13.1, 2026-09-11)

The toolbox (spec `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md`)
writes a tool's results back as attribute columns of a layer that already
exists. Five seams carry that, and each one is a decision rather than an
implementation detail.

**One FIFO per shared table.** A run does not talk to DuckDB directly; it goes
through `runOnTableQueue` (`src/insights/layerTables.ts`), the same queue that
serialises a table's build and rebuild. A run therefore cannot interleave with
the rebuild of the table it is writing, and two runs on one layer execute in
submission order. The queue is also why a run's scope is FROZEN at Run (the
selection's object ids, the applied `FilterGroup`) and resolved at the head:
the ids the user saw when they pressed Run are the ids the run uses.

**The write is one transaction with a per-run backup table.**
`writeComputedColumns` (`src/insights/computedColumns.ts`) issues
`BEGIN TRANSACTION` → `CREATE TABLE __undo_<runId> AS SELECT "id", <replaced…>`
(only when the run replaces columns that already exist, and only for the ids it
touches) → `ALTER TABLE … ADD COLUMN IF NOT EXISTS` per output column →
`UPDATE … FROM read_json_auto(<registered buffer>) AS v WHERE t."id" = v."id"`
→ `COMMIT`. A failure anywhere rolls the whole thing back, so a half-written
column cannot exist, and Undo is `buildRestoreSql` from the backup plus a
`DROP COLUMN IF EXISTS` for the columns the run created.

**Computed attributes are merged into the model and pushed to the engine.**
The columns are not only a table fact: `runQueue` calls
`useLayerStore.getState().mergeAttributes(layerId, merge)` and the new model
reaches the plugin through its `setModel`, which is what lets the Details panel
and the rule evaluator see `extent_height_m` at all. This is also the boundary
of M13.1: nothing merges into a streaming (FCB) layer's model, because an FCB
layer has no resident `model.objects` — see the roadmap's 13.1 entry.

**Provenance lives outside `Layer`.** `useComputedColumnStore`
(`src/insights/computedColumns.ts`) maps layer id → column → `Provenance`, and
`formatProvenance` renders the one sentence the badge's tooltip shows
("Height from extent · All 2 buildings · 2026-09-11 16:58"). Keeping it out of
`Layer` is what keeps results out of snapshots — they are session state by
spec — and what lets the badge tell a tool's column from the app's own derived
ones (`Roof area`, `Mean slope`, `Parts`), which carry the generic
"Computed by Roofy" text instead.

### What real DuckDB 1.5.5 actually does (probes, 2026-09-11)

`tests/integration/duckdb/computedColumns.test.ts`
(`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`) answers the
three questions the design left open. All three came back green, so the
sequence above stands as written.

- **DDL inside the transaction is accepted.** `BEGIN` → `ALTER TABLE … ADD
COLUMN IF NOT EXISTS` → `UPDATE … FROM read_json_auto(…)` → `COMMIT` all
  succeed and the values land; so does the `CREATE TABLE … AS SELECT` backup in
  the same transaction on a second run over the same columns, and so does the
  restore + `DROP COLUMN` undo. No statement had to move outside the
  transaction.
- **`read_json_auto` infers, and every inference casts into `DOUBLE`.** A
  column that is NULL in EVERY row is inferred **`JSON`** (not `SQLNULL`), and
  assigning it into a `DOUBLE` column is accepted with NULLs landing — at 2
  rows and at 20,481. A column that is NULL through the whole default sample
  (20,480 rows) with one `12.5` just past it is still inferred `JSON`, is
  accepted, and the late value lands as `12.5`: there is no sample-size cliff
  for the all-NULL case. A whole-number height (`12`) is inferred **`BIGINT`**
  and assigns into `DOUBLE` unchanged.
- **A BigInt stringified by the replacer casts implicitly, and loses
  precision.** Two rows of `"12345678901234567890"` are inferred **`VARCHAR`**,
  the implicit cast into `DOUBLE` succeeds with no error, and the stored value
  is `12345678901234567000` — the double's precision, not the integer's. Past
  the sample size the inference flips (20,480 numeric rows plus one such string
  at row 20,481 infers **`DOUBLE`**) and the out-of-sample string still casts
  to the same `12345678901234567000`. So the replacer never fails a write; what
  it can do, silently, is round a value no `DOUBLE` could hold anyway.
- **Reads inside the open write transaction are not blocked.** The table
  panel's own `buildCountSql` and `buildPageSql` both answer between the
  `UPDATE` and the `COMMIT`, see the transaction's own writes, and the `COMMIT`
  still succeeds with the values intact. The node bindings are blocking, so
  this probe is _interleaved statements inside the open transaction on one
  connection_, not isolation between two connections — which is exactly the
  app's shape: ONE DuckDB connection, no other `BEGIN` user anywhere in `src/`,
  and runs serialised on the table FIFO. The concurrency argument is
  "no interference", and it is the accepted one for M1.

### `--font-mono` is the brand's label style, not a monospace family

The spec asks for the Details COMPUTED sub-heading and the catalogue's group
labels to be "mono labels". `src/app/brand.css` deliberately defines
`--font-mono: var(--font-ui)` — one family across headings, controls and data —
so a "mono label" in this app is the STYLE (uppercase, tracked,
`var(--font-mono)`), which is exactly what the catalogue's `ROOF` /
`3D MEASUREMENTS` / `CROSS-LAYER` headings already render. A literal monospace
face here would be the single element outside the brand's family, and CLAUDE.md
makes the brand tokens the only source. If this is ever revisited it is one
token change in `brand.css`, not a per-component override.

### M13.2 (2026-09-12)

**The engine status is published, not polled (M13.2).** `duckdb.ts` keeps a
listener set and a version counter; `setStatus` is the one writer and every
transition — `initializing`, `ready`, `failed`, and each lazy extension's
`loading`/`loaded`/`failed` — goes through it. React reads the value through
`useDuckDBStatus()`, a `useSyncExternalStore` whose SNAPSHOT is the version
counter rather than the status object. The status object itself would be a
valid snapshot — `getDuckDBStatus()` returns the module's stored reference —
but the app's test mock factories return a fresh literal per call, which React
rejects as uncached; a counter cannot be written that way by accident.
`App` no longer mirrors the status in
`useState`. That mirror was also subtly wrong: `retryEngine()` on an engine
that is already `ready` does not re-run `doInit`, so App's optimistic
`setDuckdbStatus({ state: "initializing" })` made a healthy engine read
"Loading" whenever the user retried a failed TABLE.

**Listeners are isolated, and every engine has a number.** Both dispatches —
`setStatus` and the death notification inside `markEngineDead`
(`src/insights/duckdb.ts:113-134`, `:150-186`) — iterate a COPY of their
listener set and call each listener inside its own `try`/`catch`. The copy
freezes the membership of the dispatch in flight, so a listener that subscribes
or unsubscribes from inside its own notification changes who hears the NEXT
transition and never the one in flight. The per-listener catch is because a
subscriber is an OBSERVER of engine work: `setStatus` is called from inside
`doInit` (the `initializing` publish sits before its `try`), so an escaping
exception would abort the boot with the status stranded at `initializing`, and
one thrown from the `failed` publish would jump over the Worker terminate and
the memo reset in the catch and strand a wasm heap no Retry could reach — and
either way every listener queued behind the thrower would be skipped. Beside
the status there is one `generation` counter (`duckdb.ts:109`), bumped by every
boot AND every death and exported as `getEngineGeneration()`. Async work that
can outlive the engine it was started for compares it before it writes module
state or publishes a status, so the corpse's news is never mistaken for the
live engine's; `onEngineDeath` is the separate signal for the same problem, and
it drops each listener AS it fires (one notification per engine — `layerTables`
re-arms from inside the dispatch, `layerTables.ts:453-465`).

**A tool's extension loads inside the run, in its own phase.** A run whose tool
declares an `extension` calls `ensureExtension` under `phase: "extension"`
(`src/features/processing/runQueue.ts:608-640`) before its scope is resolved
(`resolveScope` at `:652`), and a failed load fails the run before the executor
sees it. Two placement decisions: the phase sits AFTER the cheap pre-flight
refusals — a missing layer, a rebuilt table, a column that has come to belong
to the file, an unimplemented tool — so a run that cannot succeed never
triggers a 24 MB download; and it sits INSIDE `runOnTableQueue`, so that
download blocks table builds for its duration. The second is the deliberate
trade: loading outside the queue would take the phase out of §6.1's sequence
and would let the run start against a table being rebuilt underneath it.
`ensureExtension` cannot be aborted (one memoised INSTALL/LOAD per extension),
so a Cancel pressed during the download is honoured on the far side of it. No
tool in M13.2 declares an extension; the seam exists so M13.3's `three_d` and
`spatial` tools are a registry entry and an executor, nothing more.

**A dead worker is detected, announced and contained — and not recovered
from.** `doInit` creates the Worker itself, so `duckdb.ts` attaches its own
`error`/`messageerror` listeners beside the ones `AsyncDuckDB.attach`
registers (`duckdb.ts:410-414`). Those listeners call `markEngineDead` — which
drops the connection, clears the boot memo and the extension memos and publishes
`failed` through the same `setStatus` writer — and then terminate the worker
themselves (`:402-409`), in that order and outside `markEngineDead`, because once
the connection is dropped the handler's closure is the last hand on a Worker
holding a 36 MB wasm heap and the cleared boot memo means a Retry builds a
second one. A failed QUERY is not
the signal: duckdb-wasm's own worker error handler clears its pending-request
map WITHOUT rejecting the promises, so a query in flight when the worker dies
never settles, and `postTask` on a detached worker logs and returns `undefined`
rather than rejecting. That is also why every engine await in `execute` is
`raced` against the death signal as well as against the run's `AbortSignal`
(`runQueue.ts:156-199`): a signal fires once, so a run cancelled while the
engine was alive has already spent its abort and the death a moment later still
has to release the await. Containment then falls out of code that already
exists: `runQuery` refuses on a non-`ready` status, and `eligibility.ts` already
disables every tool row with "Not available while DuckDB is unavailable". Every
layer table that was not already `failed` is invalidated to `failed` with the
message "Analytics engine stopped" (`layerTables.ts:422-430`), keyed on the
DEATH signal rather than on a status value or a `ready` → `failed` transition —
a boot that never came up publishes the same `failed` and must not condemn
tables a working engine built, and a worker that dies while the status is
`initializing` publishes `failed` from there, which no transition watcher would
see. Builds are loyal to an engine generation: a build captures
`getEngineGeneration()` and abandons (leaving the engine-stopped failure)
rather than writing state about a database that is gone. Undo is taken away
session-wide through one `engineStopped` flag on the processing store rather
than per run, because every backup table died with the database. What is
deliberately NOT built is §6.1's recovery: the status bar's Retry reboots the
engine but `retryEngine` revives only what it parked in `pendingSources`
(sources refused while the engine was coming UP), so the invalidated tables
stay `failed` and every tool stays disabled — with the honest table reason —
until the page is reloaded.

**Everything on the table FIFO races the death; what is left is off it.** The
queue is the thing worth protecting — one stranded await there stops every later
run AND every later table build for the life of the page — so every engine await
reached from it goes through `engineAwait.ts`. `layerTables` wraps the
primitives themselves rather than the call sites (`runQuery`, `ddl`,
`registerBuffer`, `dropBuffer`, `initDuckDB` are local `racedWithDeath`
functions), which is what makes a build's `CREATE`, its `DESCRIBE`, its buffer
cleanup and `refreshLayerTableColumns` raced for free; a build reads the
resulting `EngineDeadError` as "the database is gone" and abandons its entry to
the invalidation. The run queue races its own awaits against the death AND the
run's `AbortSignal`, and its two housekeeping paths — `discardUndo`'s
`DROP TABLE` (nothing awaits it, but the queue does) and `undoRun`'s transaction
— are raced with no signal, because no user cancels either.

What is NOT raced is the work that does not touch the queue: the `runQuery`
callers outside it await a promise that never settles after a death, and simply
stay pending — the export dialog and the export writer, the layer counts and the
grid's own query, the map-filter sync, the Stats tab, Style by result's median.
Each holds only its own caller's UI (a spinner that never resolves), and the
tools are disabled by then anyway; a shared seam for them is future work rather
than a hole in the FIFO. `retryEngine` awaits `bootEngine()` unraced on purpose:
both callers are `void retryEngine()`, so a rejection there would be an
unhandled one, and there is nothing for a death to release — every build it
starts is raced on its own, inside the queue, where a release frees something.
It guards on a DROP landing since it began (`droppedSince`), which covers a
rebuild or a removal but not a reboot.

**Roof metrics is computed app-side, in JS, and measures only what it writes.**
Roof area, inclination and azimuth are derived from ring geometry and exist
nowhere in DuckDB, so the tool issues exactly ONE statement — "which rows are
in scope, and which feature does each belong to" — and does everything else in
memory (`src/features/processing/tools/roofMetrics.ts`). The table is the
authority on rows; `roofGeometrySource.ts` is the authority on geometry, and it
has two halves on purpose: `roofLodOptions` fills the LoD select from surface
TAGS alone (`type`, `lod`, and a streaming record's `geometryLods` plus the LoD
on each pre-computed roof metric) and never calls `computeRoofMetrics`, while
`RoofGeometrySource.roofSurfacesAt` measures on demand, memoised per (object,
LoD), so a run touches only its scoped features' contributors at the one LoD it
was given. Features roll up in batches of `ROOF_BATCH_FEATURES` (500) that
yield a MACROTASK and then check the run's `AbortSignal` through
`ToolContext.throwIfCancelled`. That buys responsiveness and an early exit, not
cancellation correctness — the queue already refuses to publish an aborted run,
so a Cancel during a long compute was always honoured; it just had to wait for
the whole computation first.

**§7's contributor rule is about GEOMETRY, not about roofs.** "If any part of
the feature has geometry [at the chosen LoD], the PARTS are the contributors" —
so a Building with a roof at 2.2 whose BuildingPart has only WALLS at 2.2
selects the part and is then skipped for having no roof. Using the root's roof
instead would report exactly the 3D BAG double-storage the rule exists to
avoid. `hasGeometryAt` is therefore a question about surfaces of EVERY semantic
type, and the FCB resident records carry `geometryLods` beside their LoD-tagged
`roofMetrics` for this reason alone. The same rule fills the LoD select's
per-LoD feature counts, so the select cannot promise a building the run then
skips. Rows are written twice over, by role
(`tools/roofMetrics.ts:170-206`): the ROOT row of a feature gets the feature's
roll-up over its contributors — which may be the parts' surfaces and not the
root's own — while each PART row gets the roll-up of its own surfaces alone.

**The drawer's "Roof area" and the computed `roof_area_m2` can disagree, and
both are right.** A feature that has its own roof geometry AND a part with
geometry reads one number in the inspector's Summary (the drawer's synthetic
`Roof area` / `Mean slope` / `Parts`, unchanged by this milestone) and another
in the COMPUTED group, because the contributor rule above ignores the root's
own geometry as soon as a part has any. On the `two-buildings` fixture the
inspector says 112.0 m² / 30.0° for `NL.IMBAG.Pand.0001` where the computed
columns say 20 m² / 0°. Nothing in the UI explains that yet; it is on the
roadmap's carried list rather than papered over here.

**Two roof aggregations, on purpose.** `domain/roofMetrics/aggregate.ts` keeps
the Details panel's area-weighted CIRCULAR mean azimuth with its hard-coded 1°
flat threshold, and its area-weighted mean slope and surface count agree with
§7. What it cannot give the toolbox is §7's azimuth (the largest non-flat
surface), the user's own threshold, or NULL where a measure could not be
evaluated — so `domain/roofMetrics/roofRollUp.ts` exists beside it rather than
replacing it.

**Style by result gates on values, not on a count.** `RunSummary` carries
`firstColumnNonNull`, computed centrally in `summarise` (`runQueue.ts:265-281`)
from the run's FIRST output column — the one §6.2's button offers. The button
is disabled with "All values are empty" on `firstColumnNonNull === 0`, which is
NOT `measured === 0`: a Roof metrics run with only Dominant azimuth ticked over
flat roofs measures every building and writes NULL to all of them. A stale run
is disabled too, and outranks empty, because its table was rebuilt underneath
it and no median can be trusted at all.

**A streaming run's card says what it ran over.** A run on an FCB layer adds one
detail line, "Over the resident set: the buildings loaded when the run started."
(`runQueue.ts:237-255`), because the scope was the resident features and a
camera settle can change which those are. The values themselves still live only
in the table — see the roadmap's carried list.

**The toolbox is a streaming-table CONSUMER, exactly like the grid.** A
streaming layer's rows arrive cell by cell, so its DuckDB table is rebuilt on a
commit only while somebody is reading it — and the toolbox is somebody: a run's
scope, its counts, its LoD options and its "currently loaded" note all come off
that table. The gate in `layerTableLifecycle.ts` is therefore
`tablePanelOpen || processingOpen || runInFlightFor(layerId)`, and opening the
toolbox sweeps every streaming layer the way opening the panel does. Without the
toolbox in that gate, Tools opened over a collapsed grid read "All 0 buildings"
with Run disabled on a layer with 1,115 residents (verified in the browser,
2026-09-12), and a run after a pan measured rows the camera had replaced. A run
that is `done` is deliberately NOT a reader: its card describes the table that
exists, and a rebuild on its behalf would only retire it as stale. The cost
carried rather than fixed is that the sweep is unconditional — reopening either
consumer rebuilds even when the stream's version has not moved, which retires a
finished card as "stale: layer reloaded". A version-aware sweep (skip a layer
whose stream version equals the version at its last enqueued build) would fix
that for both consumers at once.

**`median()` over a DECIMAL column does not come back as a number.** Measured
against real DuckDB 1.5.5 through the node bindings: an uncast decimal literal
(`10.0` in a `VALUES` list) infers DECIMAL, and `median()` over that column
arrives as a raw `Uint32Array` rather than a JS number
(`tests/integration/duckdb/computedColumns.test.ts:555-559`). Style by result
reads its threshold straight out of that cell, so the probe — and
`writeComputedColumns` — pin the column to DOUBLE; a future query that medians a
column of unknown type must CAST first rather than trust the binding.

### M13.3 (2026-09-13)

The toolbox's last milestone: the five remaining tools, the New layer
destination, and the engine-death and Style-by-result threads 13.1 and 13.2
left on the carried list. Each seam below is a decision with a cost if it is
wrong, not a detail.

**Four seams the milestone's own review moved, and what each one now promises.**
(1) THE SCOPED REREAD: `buildProxySql`'s footprint arm restricts the reader to
the LAYER TABLE's own ids on scope "All" too — as a subquery, not a 100k-id
literal — because §6.1's id join is one-way (it asks only whether every id it
requested still comes back), so a source file that GAINED buildings would
otherwise reach §7.6's per-area counts with features the layer never had.
(2) THE TYPED REPLACEMENT: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is a no-op on
an existing column, TYPE included, so `typeMigrations` names every replaced column
whose declared type differs and the write DROPS and re-adds it inside its own
transaction; the backup then covers the WHOLE column, because a drop takes every
row's value and not only the scoped ones, and Undo puts the original type back
before restoring. A derived copy's INHERITED columns go through the same path
(`existingTypes` is wider than `existing` for exactly that reason).
(3) POLYGON-ONLY ELIGIBILITY: "Needs areas (polygons)" stays a statement about a
layer with NO polygon in it — one polygon makes a MIXED layer eligible — and the
execution preflight then drops the features that are not areas
(`reprojectGeoLayer(…, { areasOnly: true })`), counted under their own skip cause.
§7.6's "every target feature is written" gives the dropped ones §6.2's NULL, so no
point is ever written a building count.
(4) THE BOUNDED DISTANCE JOIN: candidates are prefiltered by the building proxy's
own box grown by the limit (an extent test, computed once per building) and the
source's `fid`/`props` are joined back only after the nearest candidate has been
picked, so the partitioned sort carries a feature key, an index and a distance
and nothing else. `ST_Distance_GEOS` and the source-order tie rule are unchanged.

**Every `Surface` carries the CityJSON geometry type it came from.**
`Surface.geometryType?: CityJSONGeometryType | null`
(`navara-core/src/citymodel/types.ts:131`), set once in `buildSurface`'s object
literal from the geometry being walked
(`navara-core/src/citymodel/cityjson/parseHelpers.ts:195`) — one edit site
covering all five surface-producing cases, and `parseCityObject` is the funnel
for CityJSON, CityJSONSeq and FlatCityBuf alike. It is what makes "has a SOLID
at LoD X" answerable from tags alone (`solidLodOptions` / `hasSolidAt` in
`src/features/processing/solidGeometrySource.ts`, over `SOLID_GEOMETRY_TYPES`
from `solidRollUp.ts`), which is the only way to answer it: the LoD select is
drawn before any source is re-read, and nothing may walk a whole layer's
geometry synchronously. The field is OPTIONAL as well as nullable, so the 21
files of hand-built `Surface` literals stayed untouched. CityParquet's and
CityGML's independently built surfaces carry no tag — neither has a
geometry-type source — which reads as "unknown", i.e. "not a solid", and matches
the eligibility reason those layers already get.

**"Reading source" is a phase, and it holds the bytes for as long as the reader
statements need them.**
`readSource({ runId, table, lod, signal })`
(`src/features/processing/sourceRead.ts:210`) mints a VFS name, calls the
table's `SourceProvider` for a FRESH array, registers it, and returns the
reader `FROM` clause plus the LoD geometry column; the executor calls
`release()` in a `finally`. THE LIFETIME IS THE READER STATEMENTS, not the run:
the bytes live from the registration until the last statement that reads the
reader relation has answered, and every executor releases them there — before
the per-feature roll-up, the write and the publication, all of which work on rows
the engine has already returned. The `finally` is the guarantee for the paths
that never get that far (a failure, a cancel, a death), and `release()` is
idempotent so the happy path's early drop is not undone. The shape is copied from
`export.ts`'s working precedent, for the reason that early drop exists — a
300 MB CityJSON must not sit in the wasm heap for the length of a compute. The
LoD label → column mapping comes from `LayerTable.lods` (`{ label, suffix }`),
never from string surgery: `"0.0"` and `"0"` are different columns and only the
file knows which it has (`lodZeroLabel` in `buildingProxy.ts` looks the label up
the same way). The PHASE is entered in `runQueue.ts:1303`, before `resolveScope`
at `:1307` and not with the registration it names: `resolveScope` issues a
statement of its own, and a run that waited for it in the phase it was already
in would show "queued" while holding the FIFO.

**The solids SQL is guarded by what the engine does, statement by statement.**
`buildSolidMeasureSql` and `buildSolidValidationSql`
(`src/features/processing/solidSql.ts:120`, `:140`) read EVERY validation-report
field as `CASE WHEN s IS NOT NULL THEN r.<field> END` and the volume as
`CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END`, and never
select `r.code` or `r.message`. That is not defensive style, it is D1 below:
`ST_3DValidationReport` over a runtime-NULL solid returns UNINITIALISED memory.
Solid detection keys on the CityJSON geometry type — the model's tag and the
reader's `geometry_properties_lod*.type` — and never on
`cityjson_wkb_geometry_type`, because a CompositeSolid's WKB type name is
"GeometryCollection Z" (D4) and keying on it would skip every CompositeSolid as
"not a solid". Scope-wide source identity is checked with a separate cheap
id-only statement (`buildSourceIdsSql`), compared against the ids the
executor's own scope-rows read returned — never against `ctx.featureIds`, which
is `null` for scope "all".

**ONE Style-by-result descriptor, not a branch per tool.**
`ToolDefinition.styleByResult: StyleByResult | null`
(`src/features/processing/types.ts:49`, `:179`); `RunFooter` reads the
descriptor, picks the column with `pick(written)`, resolves the operator and
value through `resolveStyleOperator` / `resolveStyleValueSource` (both may be
functions of the picked column) and opens either a rule draft or the vector
layer's Color by attribute. There is no tool-specific BRANCHING in `RunFooter` —
it reads `run.toolId` to look the definition up, and never to decide anything:
the descriptor is what keeps the seven tools' differences out of the one
component.

**One cross-layer run shape: the city table is the compute ground, the vector
layer is a per-run table.** Every cross-layer run occupies the CITY layer's slot
on the one table FIFO and computes over the city table, whatever the destination.
The vector layer becomes `__src_<runId>` (`vectorTableName` /
`createVectorTable`, `src/features/processing/vectorTable.ts`), built from an
app-made NDJSON of reprojected features — the shape `computedColumns.ts` already
uses for the write — and dropped in a `finally` on every exit path: done,
failed, cancelled, engine death. Reprojection is app-side (`reprojectGeoLayer`,
`vectorSource.ts:445`) through `crsFromGeodetic`
(`src/scene/cursorCrsReadout.ts:53`), the app's single proj4 door, after
`ensureModelCrsLoadable` (`features/layers/ensureCrs.ts`), because
`crsFromGeodetic`'s own guard is synchronous and returns `null` for a definition
proj4 has not loaded yet.
`ST_Transform` exists in the wasm build and is deliberately not used, so the CRS
answer lives in one place and the offline story does not depend on whether
`spatial` ships PROJ data. A building reaches a 2-D predicate through a PROXY
(`buildProxySql` / `buildFeatureProxySql`, `buildingProxy.ts`): an LoD 0
footprint where the layer has one, otherwise the bbox rectangle or its centre,
with `ST_Force2D` applied per row because `ST_Union_Agg` keeps Z (D7) and
`ST_IsEmpty` folded over the union because an empty aggregate is
`GEOMETRYCOLLECTION EMPTY`, not NULL (D8) — `g IS NULL` is the ONE "no proxy"
signal the three cross-layer tools read. Distance uses `ST_Distance_GEOS`, not
`ST_Distance`, because the core function returns 0 for any polygon↔polygon pair
on this build (D10). A vector TARGET's results are merged into the layer's
`config.preparedData` through `mergeGeoFeatureProperties` over the pure
`mergeGeoDocumentProperties` (`features/geoLayers/geoLayerStore.ts`); provenance
goes in `useComputedColumnStore` under the geo layer's id, and a vector run is
retired by a rebuild of the SOURCE city table (the run is keyed by its
`computeLayerId`) and its Undo revoked by an engine death like every other.
Copied-field TYPES travel inside the frozen `params` as `fieldTypes`
(`crossLayerParams.ts:53`), so `tool.outputColumns(run.prefix, run.params)` is
exact for every tool and the write declares its columns rather than inferring
them (D9).

**A derived layer is cut from the parent's TABLE, prepared in the run's own FIFO
slot and published in one step.** `prepareDerivedCityLayer`
(`src/features/processing/deriveLayer.ts:191`) issues
`CREATE TABLE … AS SELECT * FROM <parent> WHERE COALESCE("feature_id","id") IN
(…)`, which works for every parent kind and brings the parent's computed columns
across with their values, and returns a plan whose `publish()` is one
synchronous step (`adoptLayerTable`, the provenance copy,
`addLayer({ insertAfterId })`, `activateLayer`). `enqueueLayerTable` is unusable
here and that is a hard fact: it goes through the same queue the run is already
inside, so calling it would deadlock. Reader-backedness is then metadata plus a
filter — the copy keeps the parent's `source` / `reader` / `extension` / `lods`
and sets `LayerTable.sourceFeatureIds` (`deriveLayer.ts:395`), which TWO
independent readers of the parent's source must AND in: `resolveScope`'s "all"
branch (`scope.ts:125`, which turns `featureIds: null` into the derived table's
own row ids, so `readSource`, every executor and `buildProxySql` need no change
at all) and `buildCityParquetSourceSql`'s `where` (`insights/sql.ts:810`, the
export path, which re-reads the PARENT file). Miss one and the copy quietly
reads its parent whole. A derived VECTOR layer is a plain GeoJSON layer
(`prepareDerivedVectorLayer`, `:488`) holding every area of its target, because
§6 is explicit that Aggregate's copy keeps all target areas while the scope
selects only the buildings counted. `src/app/snapshotLayers.ts` is the ONE
derived-layer filter, for BOTH doors out of the workspace — the saved snapshot
and the share link — and it computes the active-layer index from the same
filtered arrays, because a filter and a per-kind index done in two places drift
into a restore that opens the wrong layer. The accepted deviation is the
streaming one: `STREAMING_NO_NEW_LAYER` (`deriveLayer.ts:54`) refuses the
destination on an FCB target, because a resident record carries no boundaries
and the copy would render nothing.

**The engine-death race lives in the PRIMITIVE.** `settleOnDeath`
(`src/insights/duckdb.ts:237`) wraps `runQuery` (and `ddl` through it),
`queryDuckDB`, `registerBuffer`, `readFile` and `dropBuffer`: each races its
in-flight await against this module's own death signal and returns its ordinary
failure value. duckdb-wasm's `onError` clears its pending requests WITHOUT
rejecting them, so a request caught by the death never settles at all;
`layerTables.ts` had solved that for itself by shadowing each primitive
(`racedWithDeath`), but `computedColumns.ts`, `export.ts` and every off-queue
caller imported the unraced originals. One change in the primitive fixes them
all, with no call-site edit, no new export and no mock-factory sweep — and every
future caller by default, which is what a hazard with no visible symptom needs.
The run queue is unchanged and provably so: `markEngineDead` dispatches
listeners synchronously in registration order, and in `raced(runQuery(sql))` the
argument is evaluated first, so the primitive's listener resolves a microtask
while `raced`'s own listener REJECTS synchronously and `EngineDeadError` still
wins. `retryEngine` (`layerTables.ts:842` — it lives there, not in `duckdb.ts`)
now binds its generation AFTER the boot starts:
`const booting = bootEngine(); const engine = getEngineGeneration(); await
booting;`. `doInit` bumps the counter synchronously before its first await, so
the number read after the call is the engine this retry is FOR, whether the boot
is new or the memo of a live one; a number captured BEFORE the call would differ
after every real boot and the retry would skip the rebuilds it exists for,
leaving those layers table-less for the session with no error anywhere. The
generation guard returns BEFORE `pendingSources.clear()`, so a worker that dies
inside the boot window leaves every parked source parked for the next Retry. A
post-COMMIT death inside `undoRun` leaves the card "done" with no Undo — the
session's `engineStopped` flag governs, and the watcher never patches a done run.

**The palette rotates, and `Color by` waits for Save.** `RULE_PALETTE_HEX`
(`src/scene/cityColors.ts:102`) is eight colours beginning with the existing
new-rule default, and `nextRuleColor(rules)`
(`src/features/rules/nextRuleColor.ts:13`) returns the first no enabled rule is
using; both the editor's "+ Add rule" and Style by result call it. Being a RULE
palette its first member may coincide with a rule preset; what no member may
coincide with is the chrome, which is the collision test's subject (Single colour
and Unmatched included). `RunFooter` no longer writes `colorBy` when it opens a
draft, so a layer on Surface type or Single colour does not repaint to the
unmatched colour before the user presses Save. At Save a RESULT draft switches
the mode from ANY mode, while a rule typed by hand keeps `ensureRulesMode`'s
surface-only flip. The asymmetry is a ruling (Codex round-2 finding C6), kept as
stated rather than smoothed over in either direction.

**The streaming sweep compares versions, and a failed build does not count.**
`layerTableLifecycle.ts` keeps `builtVersions` beside `pendingVersions`
(`:105-132`) and skips a layer whose current stream version equals either.
Splitting the two is the point: a failed rebuild can leave the previous ready
table in place, and recording the version as built there would make every later
consumer opening skip that layer indefinitely — so the pending entry is cleared
on failure and only a successful build promotes the version. This closes the cost
M13.2 carried: reopening the toolbox over an unchanged stream no longer retires a
finished result card as "stale: layer reloaded".

#### What real DuckDB 1.5.5 actually does (probes, 2026-09-12/13)

Ten facts, each pinned by a probe in `tests/integration/duckdb/`
(`solids.test.ts`, `crossLayer.test.ts`, `computedColumns.test.ts`;
`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`). Several are
traps rather than surprises, and the consequence in the code is named for each.

- **D1. `ST_3DValidationReport(s)` on a runtime-NULL solid returns UNINITIALISED
  memory**, not NULL: `is_valid` flipped between runs on the same row, the counts
  were garbage, and reading `message` once crashed the wasm instance.
  Consequence: every report field is read under `CASE WHEN s IS NOT NULL`, the
  volume under `CASE WHEN s IS NOT NULL AND r.is_valid`, and `r.code` / `r.message`
  are never selected (`solidSql.ts:123-150`).
- **D2. `ST_3DValidationReport` and `ST_GeomFromGeoJSON` each have two
  overloads**, so a bare `NULL` literal is a Binder error — for
  `ST_GeomFromGeoJSON` only while the `json` extension is still UNLOADED, which
  is the same order-dependence D7 records (once `read_json` has autoloaded it the
  call binds and returns NULL). A probe-level consequence: the tests cast
  (`NULL::SOLID_3D`, `NULL::VARCHAR`).
- **D3. The validation report struct has 13 fields**, including
  `orientation_error_count` (1 on `NL.IMBAG.Pand.0001`). It is the thirteenth the
  design did not know about; `buildSolidValidationSql` selects it as `ori_n`.
- **D4. A CompositeSolid's WKB type name is "GeometryCollection Z"**, not
  "PolyhedralSurface Z", and `ST_3DTryFromWKB` parses it (valid, 2 shells, 12
  faces, volume 2). Consequence: solid detection keys on the CityJSON geometry
  type — `Surface.geometryType` in the model, `geometry_properties_lod*.type` in
  the reader, both through `SOLID_GEOMETRY_TYPES` — and never on
  `cityjson_wkb_geometry_type`.
- **D5. `ST_NDims` does not exist in this `spatial` build; `ST_HasZ` does.** A
  probe-level consequence: Z is asserted with `ST_HasZ` in `crossLayer.test.ts`.
- **D6. `ST_Within` is interior-only.** §7.5's "within (boundary included)" is
  therefore `ST_CoveredBy`, pinned with a boundary point and used by both
  predicates that need it (`joinByLocation.ts:110`, `aggregatePerArea.ts:109`).
- **D7. `ST_GeomFromGeoJSON(NULL)` raises only while the `json` extension is
  unloaded** — it returns NULL once `read_json` has autoloaded it, so the trap is
  order-dependent and the probe pins both states on their own connection. That
  half is probe-level: the app never calls `ST_GeomFromGeoJSON` at all (the
  vector table reads app-made WKT through `ST_GeomFromText`, because the WKT is
  already in the target's CRS — `vectorTable.ts:96-101`). The half with a code
  consequence is the other one: `ST_Centroid` and `ST_Union_Agg` KEEP Z, only
  `ST_Force2D` drops it, so `buildProxySql` wraps each row's geometry in
  `ST_Force2D` where a 2-D output contract exists.
- **D8. `ST_Union_Agg` over an empty set returns `GEOMETRYCOLLECTION EMPTY`, not
  NULL.** Consequence: `buildFeatureProxySql` folds the union in
  `CASE WHEN ST_IsEmpty(…) THEN NULL END`, which makes `g IS NULL` the one "no
  proxy" signal. Two facts found beside it: the reader names LoD "0" as
  `geometry_lod0_0` (so a label is looked up in `LayerTable.lods`, never
  re-spelled — `lodZeroLabel`), and DuckDB PRUNES an unreferenced projection, so
  a probe that means to force a parse must reference the parsed value
  (`ST_Area(g)`, not the id alone).
- **D9. `read_json_auto` infers JSON for a VARCHAR that first appears after
  20,480 NULLs, and stores the two-character string `""`** — non-empty late text
  is quoted too. Consequence: the write reads the values file with the DECLARED
  column types (`read_json(…, columns = {…})`, `computedColumns.ts:93`), so
  inference never decides a column's type. This corrected every tool's write, not
  only the cross-layer ones.
- **D10. Core `ST_Distance` returns 0 for ANY polygon↔polygon pair on this
  build, and `ST_DWithin` is TRUE for the same pair at any threshold** — the two
  are different failures with one cause. `ST_Distance` gives a NUMBER that is
  wrong (a whole layer would read "0 m" under a card saying it was measured);
  `ST_DWithin` gives a BOOLEAN false positive — the probe has two polygons 40 m
  apart answering `true` at a 39 m threshold, so it is not even usable as a
  filter. Consequence: Distance to nearest uses `ST_Distance_GEOS`, verified
  present in the `wasm_eh` binary and correct on every probed pairing
  (`distanceToNearest.ts`), and nothing anywhere reaches for `ST_DWithin` —
  including the candidate prefilter the fix wave added, which is an EXTENT test
  (`ST_Intersects_Extent(ST_Expand(g, limit), geom)`) and conservative by
  construction: a pair within `limit` metres cannot fall outside a box grown by
  `limit`.
- **D11. DuckDB's `TRY()` does NOT catch a `three_d` "Invalid Error", and
  `ST_3DSurfaceArea` raises one on a solid with a degenerate (zero-area) face.**
  `TRY` is a real 1.5.5 expression — it swallows a CAST error — but the
  extension's error propagates straight through it, and one such row aborted a
  whole Delft LoD 2.2 run at the M13.3 gate. Probed against a solid built in the
  suite: only `ST_3DSurfaceArea` raises; `ST_3DFootprintArea`, `ST_3DZMin` and
  `ST_3DZMax` all answer normally on the same row. Consequence: the measure
  statement guards the surface area on the validation report's own
  `degenerate_face_count = 0` and leaves the other three unguarded, so a
  degenerate solid loses its area and keeps its real footprint and height. The
  guard is NOT `r.is_valid`: an unclosed solid with no degenerate face still
  answers with its envelope (388 m² on `invalid-solid.city.json`), which §7.2's
  caveat rule depends on.

Two facts from earlier milestones that M3 had to honour again: `mode()` is
non-deterministic on ties, so the most-frequent value is
`GROUP BY … ORDER BY "n" DESC, "v" ASC LIMIT 1` over feature roots with NULLs
excluded (`buildMostFrequentSql`, `insights/sql.ts:472`), and `median()` over a
DECIMAL column arrives as a `Uint32Array`, so every median CASTs to DOUBLE
first.

**The gate's last two rulings (2026-09-14).** A run may change a computed
column's TYPE only when it covers EVERY row of that column: the migration is a
`DROP COLUMN` + `ADD COLUMN <declared type>` inside the write transaction, and
on a scoped run it would have left the out-of-scope buildings NULL in the table
while the model and the provenance still held the earlier run's values — so a
scoped re-type is refused at the head and in the form with **[adapted copy
A20]** `The existing <column> is <TYPE>; run on All buildings to change its
type`, and a re-typed column is a NEW column (§7: "in a new column they are
NULL"), so the rows the run skipped read NULL in the model and the provenance
too, and Undo restores the original type and values from the backup. And a
vector SOURCE is identity-checked the way a vector target is: `Join` and
`Distance` capture the source document's `preparedData` identity at Run and
re-check it at the publication boundary for both destinations, failing with
§6.1's "Layer changed while running; run again" when the layer was relinked
under the run, with the per-run vector table dropped and the FIFO released.
Two more adapted strings shipped with the fix wave: **A18** `solids with
degenerate faces (no area)` (the caveat for a solid whose `ST_3DSurfaceArea`
raises — engine fact D11: DuckDB's `TRY()` does not catch `three_d`'s errors,
so the guard is the validation report's `degenerate_face_count`), and **A19**
the skip sentence for a usable geometry set aside for its KIND (a point or a
line in an areas-only source).

Browser acceptance procedure: `scripts/smoke/processing-m1.md` (M13.1),
`scripts/smoke/processing-m2.md` (M13.2) and `scripts/smoke/processing-m3.md`
(M13.3).

## Geographic PLATEAU CityParquet (2026-09-21)

The Nishitokyo `building.parquet` dataset uses EPSG:6697 (JGD2011 geographic
coordinates with JGD2011 gravity-related heights). It downloads and decodes
successfully, but the viewer's metric CRS gate previously rejected it.
The WKB and row bounds store **longitude, latitude, height**, despite the EPSG
CRS authority's latitude-first axis order; the source CityJSON transform in the
footer is provenance and must not be applied to these already-decoded coordinates.

`normalizeCityParquetCrs` runs after package assembly for both URL and local-file
loads. It converts EPSG:6697 horizontally into the WGS84 UTM zone selected from
the package bounds (Nishitokyo: EPSG:32654). All ring vertices and object bounds
are converted, including geometryless parents; model bounds are recomputed.
Heights, LoDs, IDs, semantics, attributes and appearance are retained. Other CRSs
keep the existing admission checks. This deliberately supports this known
compound CRS rather than assuming every geographic CRS uses orthometric metres.

The horizontal conversion uses the metre-level JGD2011/WGS84 null-datum
approximation. Vertical values remain unchanged and use the renderer's existing
EGM2008 geoid approximation, not a Japan-specific vertical datum transformation.
The normalized model advertises its metric CRS; the layer's original source URL
or files remain the reload source. This also keeps app-side area/slope/distance
calculations in metres instead of merely allowing degree coordinates past the gate.

## Multiple display LoDs (2026-09-21)

Static city layers now select a set of LoDs and render only each city object's
highest available selected representation. New loads select every available
LoD; an empty selection intentionally draws no labelled geometry. In the
Nishitokyo fixture this keeps 468 objects at LoD 2 and 84,394 at LoD 1 instead
of silently hiding the objects without LoD 2. Selection is per CityObject,
including independently modelled BuildingParts; it does not merge geometry
or infer equivalent representations across parent/child objects.

The core mesh builder and static plugin's `lod`/`setLod` accept a readonly
array in addition to their existing string/null contract. Arrays choose the
best selected LoD per object. Strings still mean exact LoD, and null retains
the plugin's legacy unfiltered behavior. Object and surface picking indices
remain tied to the original model, including objects excluded by selection.

The app stores `selectedLods` separately from streaming's single `selectedLod`.
It is persisted in workspaces and URL shares, restored on file relinking,
and copied to derived layers. Older workspace single-LoD choices remain exact.
Export and analysis retain their explicit single-LoD controls. Streaming
FlatCityBuf's zoom-driven/manual policy is unchanged.

### A LoD change rebuilds only when some object's drawn LoD changes

`CityModelMesh.setLod` always records the new selection (every later rebuild —
hidden types, id filter, appearance, placement — reads it) but calls
`rebuildGeometry` only when `sameLodGeometry` (navara-core `lodSelection.ts`)
finds an object whose drawn LoD differs. The store hands `setLod` a fresh array
on every checkbox toggle, so the old identity check rebuilt every time:
Nishitokyo `[2,1,0] → [2,1]` changes no object's winner yet re-triangulated all
1.9 M triangles (~2.7 s, M4 Max, dev build).

- The builder and the comparison share `selectedSurfaceLod`; never give the
  comparison its own copy of the winner rule, or a skip silently draws stale
  geometry. `lodSelection.test.ts` checks the helper against the real builder
  for every pair of a set of selections.
- A legacy string is the one-element selection (it draws exactly the same
  surfaces). `null` equals only `null`: it also draws unlabelled surfaces.
- Hidden and id-filtered objects are compared too. Skipping them would save a
  rare rebuild but couple the comparison to the filters; revealing an object
  rebuilds with the recorded selection anyway.
- Cost: equal LoD sets answer without visiting objects; otherwise one pass over
  the surfaces' LoD labels, no geometry copied. Real Nishitokyo
  (`plateau/nishitokyo-shi/building.parquet`, same SHA as the capture;
  1,913,792 triangles; Linux, Node 24, not a browser): `[2,1,0] → [2,1]`
  141 ms and no rebuild, against 11.2 s for the same rebuild forced;
  reordering 0.1 ms; `[2] → [2,1]` still rebuilds (10.7 s). The synthetic
  before/after (6.0 s → 95 ms) agrees. Logs:
  `docs/performance/cityparquet-2026-09-21/lod-switch-*.jsonl`; rerun with
  `npx vitest run -c scripts/performance/vitest.config.ts lod-switch`
  (`AUDIT_FILE=<nishitokyo parquet>` for the real dataset).
- Streaming layers (`FcbStreamLayerHandle.setLod`) are untouched.

### The geoid height correction moves vertices; it does not rebuild

The mesh is built at height offset 0 and the geoid sample lands later, on
every load. `setHeightOffset` used to rebuild the whole mesh for it —
Nishitokyo 2.7 s on the M4 Max (dev build), 9.25 s on the Linux host (Node) —
and now calls `raisePositionsInEnu` (navara-core `geo/raiseEnu.ts`) on the
existing position buffer: 0.27 s on the same host and file, no rebuild.

- Why not just move the frame: the origin rises `dh` along its normal, each
  vertex along its OWN normal, and those fan out — a frame-only shift is
  `≈ N·d/R` off (6 cm at 10 km, 89 mm at a 21 km corner for N = 37 m).
  In the (unchanged-rotation) frame the move is `p + dh·(Rᵀn − ẑ)`.
- `n` must be the geodetic normal: the ellipsoid gradient at the FOOT point.
  The gradient at the raised vertex is µm off (Codex review: 16 Float32 steps
  on a coordinate 1 m from the origin). The foot is found without trig
  (height from the ellipsoid equation, one step down the approximate normal).
- Accuracy: within two Float32 roundings of a fresh `projectPositionsToEnu`
  (one for the stored input, one for the store; floored at 1e-8 m each for the
  double rounding of ECEF) for building heights. The foot-point step leaves
  ~dh·e²·(h/a)² — 4e-8 m at 5 km above the ellipsoid, nothing at city heights. `raiseEnu.test.ts` holds the oracle; the mesh test
  compares against a mesh built at the new offset over a 10 km span.
- Unchanged by the move: normals (they turn by ~N/R ≈ 1e-5 rad, which no
  lighting shows), colours, picking indices, UVs, texture groups. Refreshed:
  position upload, bounding sphere (Navara culls on it), a cached bounding box,
  edge lines. Later rebuilds (LoD, hidden types, appearance) project into the
  new frame as before.
- Streaming layers place per cell in the worker and are untouched.
- Logs: `docs/performance/cityparquet-2026-09-21/geoid-nishitokyo-*.jsonl`
  (same `lod-switch` benchmark; its `setHeightOffset(0 -> 37)` step).
