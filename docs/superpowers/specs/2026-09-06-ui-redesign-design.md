# Roofy UI redesign — approved design

**Status:** approved by the maintainer on 2026-09-06 from the interactive
prototype built under `docs/ui-redesign-handoff.md` §1–2 (prototype directory
`/tmp/roofy-ui-prototype.rExpRq`, published for review as a Claude artifact).
This document is the durable record the handoff requires: the agreed layout,
interaction rules, removals and deferred capabilities. Implementation follows
`docs/superpowers/plans/2026-09-06-ui-redesign.md`.

The visual identity does not change: tokens in `src/app/brand.css`, rules in
`DESIGN.md`. Where this document and `DESIGN.md` disagree on a measure (panel
widths, overlay placement) this document wins; on identity (colour, type,
radius, elevation) `DESIGN.md` wins.

The review accepted the prototype's defaults for its open questions: the left
panel is one scrolling column (layer list above the active layer's
configuration), surface picking is a map control (Feature / Surface), the
left FILTER section summarises and hands off to the table's filter bar, layer
statistics live in the drawer's Summary tab, and every removal below stands.

## Design model (from the brief)

| Subject   | Home                                                    |
| --------- | ------------------------------------------------------- |
| Workspace | Header                                                  |
| Scene     | Map controls + Scene settings sheet + Sun & shade sheet |
| Layer     | Left panel (list + active layer) + bottom drawer        |
| Selection | Right panel                                             |

One `activeLayerId`. One `selection = { layerId, featureIds[], surfaceId? }`.
Every panel that concerns a layer is titled with that layer's name.

## Shell layout

CSS grid on `#roofy`:

```
header      44px   (brand toolbar)
body        1fr    = [left panel | map column | right panel]
status      28px
proto strip 32px
```

Map column = `[map 1fr / drawer auto]` stacked. The drawer lives UNDER THE
MAP ONLY; the left and right panels run the full body height. This is the
laptop rule from the brief: opening the drawer never buries the layer list.

Widths: left panel 300px (min 240, max 420, drag handle on its right edge);
right panel 340px (min 280, max 480, drag handle on its left edge). At a
viewport narrower than 1360px the defaults become 272px and 320px. Panels
collapse: the left panel collapses to a 40px rail (icon button "Layers" with
a count badge, and the active layer's type icon) so layer navigation stays
reachable; the right panel collapses to nothing but leaves a glass pill
"Details · Building …25028" on the map's right edge whenever a selection
exists. Header buttons `⟨` / `⟩` (aria-label "Collapse layers panel" /
"Collapse details panel") toggle; Escape closes sheets first, then clears
selection, then nothing.

Body min-width 1024px; below that the shell scrolls horizontally (desktop-first
per PRODUCT.md). Verify at 1440×900 and 1280×720.

### Header (Workspace)

Left: Roofy lockup (`RoofyLockup`, 20px mark beside 15px type), then a workspace button
"Delft rooftop study ▾" (Outfit 500) opening a menu: Rename, New workspace,
Open… (list of saved: "Delft rooftop study", "Rotterdam pilot"), Duplicate,
Delete. Right: ghost buttons with icon + text: "Save" (shows "Saved · 2 min
ago" as muted text beside it after a click), "Share" (opens the share
dialog: URL field, Copy, "Include camera / Include filters / Include
selection" checkboxes), "Preferences" (gear; opens a popover with:
**Interface appearance** System / Light / Dark segmented; **Units**
Metric / Imperial; **Reduce motion** switch). No theme toggle in the header:
appearance lives in Preferences. Left/right panel collapse buttons sit at the
header's inner edges.

### Left panel (Layer)

Top block, "LAYERS" mono label with a ghost "+ Add layer" button on the
right. One list for every layer type. Row anatomy (36px, 6px radius, hairline
on hover, lime wash + lime hairline when active):

```
[eye] [type icon] Name                    [filter chip] [⋯]
                  state line (muted, 11px)
```

Type icons: city model (building), streaming city model (building with a
pulse dot), vector (polygon), raster (grid), 3D tiles (cube). State line
examples: "1,204 buildings · LoD 2.2", "Streaming · 1,240 loaded",
"6 areas", "Raster · 0.5 m", "Error · could not parse". The filter chip is a
small outlined pill "Filtered 312" (or "Table filter" for streaming) with a
tooltip and an `×` that clears the filter. The overflow menu: Zoom to layer,
Open table, Rename, Duplicate, Remove. Clicking the row activates the layer
and NEVER moves the camera. Hidden layers render at 55% opacity on the map
row and are removed from the map; hiding the layer that owns the selection
clears the selection. The list is not draggable and shows no order controls
(order does not drive rendering in the engine).

Below the list, separated by a hairline: **the active layer's configuration**,
scrollable independently, titled with the layer name in Outfit 500 16px, the
type in muted text under it, and an action row of ghost buttons:
"Zoom to layer", "Open table" (label becomes "Close table" when open).
Then three disclosure sections (mono labels, chevrons, remember open state
per layer): **STYLE**, **FILTER**, **DETAILS**.

**STYLE (city model).** A "Color by" select: `Surface type` (default),
`Rules`, `Single colour`. Under it the affected-unit line in muted text, e.g.
"Delft · Color roof surfaces by rules". For `Rules`: a row of preset chips
(Flat roofs, South-facing, Steep roofs, Large roofs, Solar suitable; each
with a swatch and a tooltip description); the rule list (rows: swatch, name,
condition in mono, visibility, edit, delete; drag handle for precedence);
under the list one line "First matching rule wins. Unmatched roofs:
[swatch] Unassigned grey" where the unmatched swatch is editable; "+ Add
rule" opens an inline rule editor (Name, Attribute select incl. roof metrics
`roof.area`, `roof.inclination`, `roof.azimuth` and attributes
`measuredHeight`, `yearOfConstruction`, `roofType`, `function`; Operator;
Value; Colour; Save / Cancel). Drafts are kept per layer: switching layers
and back restores an unsaved rule editor. For `Surface type`: the palette
rows Roof / Wall / Ground with their swatches (read-only in v1). For `Single
colour`: a colour input.

**STYLE (vector).** Fill colour, stroke colour, fill opacity slider, and a
"Color by attribute" select (`None`, `zone`) that, when set, lists the
categories with swatches (Residential amber, Mixed terracotta, Campus blue,
Industrial grey) and feeds the legend. No rules for vectors: a muted line
"Rules are available for city models." Raster: opacity, colormap select.
Streaming city model: same as city model.

**FILTER.** Summary of the active filter for this layer: "measuredHeight >
15 m" in mono, "312 of 1,204 buildings match", buttons "Edit in table" (opens
the drawer with the filter bar focused) and "Clear filter". When none: muted
"No filter. Filters apply to the map and the table together." For the
streaming layer the summary says "Table only — map filtering for streaming
layers is not available yet." Raster/vector-without-attributes: "This layer
cannot be filtered."

**DETAILS.** Key-value rows in the data face: Source (file name or URL),
Format ("CityJSON 2.0", "FlatCityBuf", "GeoJSON", "GeoTIFF"), CRS
("EPSG:7415"), Extent, Objects (counts by type: Building 1,204 · BuildingPart
388), **LoD** segmented (1.2 / 2.2 / 3.0 — only the available ones enabled),
**Appearance** select (`Untextured` / `Textured (2 themes)`) for city
models, **Object types** checkboxes (Building, Bridge, …), and for streaming:
**Streaming** rows (LoD to stream, cells resident 14, "Refresh visible").
Metadata disclosure with raw `metadata` JSON in a mono block.

### Map (Scene)

The Navara viewport fills the map area. Picking: a city hit always wins over
a geo hit (engine `featureClick` only, no hover picking for geo layers). In
`Feature` select mode a click selects the owning building (a click on a
BuildingPart selects its parent building; parts are inspected in the details
panel); in `Surface` mode a click selects one surface of a city model.
Highlight and hover colours stay the plugins' `colors` seam (selection lime
500, hover lime 300). Hidden layers are removed from the scene; a filtered
layer renders only its matching features through `Layer.visibleObjectIds`.

Camera modes are the engine's: `Top-down` (2D), `Angled` (2.5D), `Free 3D`
(3D). Every programmatic move (`Zoom to layer`, `Zoom to selection`, `Fit`)
returns the engine's fly-to promise into `withSettleSuppressed`. Adding a
layer no longer triggers an automatic fit-all flight, except the first layer
of an empty workspace.

Map overlays (glass, strong hairline, 9px radius):

- Top-left: **Select** control — mono label "SELECT" then a segmented
  `Feature | Surface` (icons + text). `Surface` is disabled with a tooltip
  "Surface picking is not available for planning areas" when the active
  layer is not a city model; picking a vector feature in Surface mode picks
  the feature. Beside it, when the active layer has a filter: a chip
  "Delft · 312 of 1,204 shown · Clear" (`Clear` is a button).
- Top-right: text-with-icon glass buttons "Sun & shade" and "Scene settings";
  each opens a nonmodal sheet anchored under it; only one sheet at a time.
- Right edge, vertically centred: camera cluster — `+`, `−`, north (resets
  rotation), "Fit" (zooms to the active layer; tooltip "Zoom to layer"),
  then a segmented view mode `Top-down | Angled | Free 3D` (icons; text
  tooltip). Below it, only when a selection exists: "Zoom to selection".
- Bottom-left: **Legend** card, grouped by layer: each group heading is a
  button (layer name, chevron) that opens that layer's STYLE section (and
  activates the layer); rows are swatch + label + count. Surface-type
  default shows Roof / Wall / Ground; rules show each rule and "Unmatched";
  vector shows fill or the category list. Hidden layers do not appear. A
  small "Hide legend" glass toggle; when both side panels are collapsed the
  legend grows to a presentation size (14px rows) — this is the projector
  state.
- Bottom-right: the attribution badge, ALWAYS visible: "Geoid: EGM2008 via
  Re:Earth Terrain · © Mapterhorn · Basemap © Esri" in 10px mono muted on
  glass, links underlined; and a scale bar above it.
- Bottom-centre: hover tooltip (glass, 12px) "Building …25028 · 14.2 m" /
  "Roof surface 3 · 5° · 118 m²" / "Wippolder · Residential".
- Empty workspace (no layers): a centred glass card "Add a layer to start"
  with the one filled lime button "Add layer" and the three routes as text
  (File · URL · Catalog).

**Sun & shade sheet** (nonmodal, 320px, docked top-right under its button):
date input, time slider 00:00–24:00 in 10-minute steps with the time shown
large in mono, timezone line "Europe/Amsterdam · CEST (UTC+2)" with a
select (Europe/Amsterdam, UTC, Browser), play/pause + speed (1×/10×/60×),
preset chips "Today", "Summer solstice", "Winter solstice", "Equinox",
readouts "Altitude 47° · Azimuth 203°", "Shadows" switch. The map, picking
and the right panel keep working while it is open.

**Scene settings sheet** (nonmodal, 340px): sections BASEMAP (None / Esri
imagery / OpenStreetMap; attribution updates), CONTEXT (Google Photorealistic
3D Tiles switch, Terrain switch), RENDERING (Exposure slider, Aerial
perspective switch, Bloom switch, Shadows quality select), SCENE APPEARANCE
(Background: Day sky / Dusk / Night — explicitly "not the interface theme";
Weather effect: None / Rain / Snow / Fog with the note "Visual effect only,
not weather data"), and a collapsed disclosure **PRESENTATION LOOKS** with
"Cyber" as a switch and the note "Overrides basemap and classification
colours while on." When on, the legend shows a warning chip "Cyber look
active — colours overridden".

### Right panel (Selection)

Rendered only when the selection is non-empty (`display:none` otherwise;
the map column takes the space). Header: identity trail as breadcrumbs,
"Delft → Building …25028 → Roof surface 12", where the layer crumb activates
the layer, the building crumb narrows the selection to the building, and the
last crumb is the current subject; a copy-id icon button and a "Clear
selection" ghost button (`×`) on the right. Under it the full id in mono
(`NL.IMBAG.Pand.0503100000025028`, wrapping).

Sections (mono labels):

- **SUMMARY** — for a building: Roof area (sum, m²), Mean roof slope, Main
  orientation (compass word + degrees), Height (measuredHeight), Roof type,
  Parts (n) — as a 2-column definition grid. For a roof surface: Area,
  Slope, Azimuth, Type (RoofSurface), Belongs to (building link). For a
  vector feature: Name, Zone, Area (ha). For a multi-selection (n
  buildings): the count as the heading "3 buildings selected", a line
  "Aggregates over the 3 selected buildings", then Roof area (total), Height
  (mean · min–max), Roof types (counts), and a list of the ids with an `×`
  to drop one.
- **RULE MATCH** — when the layer is coloured by rules: "Colours by: Flat
  roofs (slope < 10°)" with the swatch, or "Unmatched — no rule applies".
- **ATTRIBUTES** — the raw attributes as a two-column table (key mono, value
  data face), untouched names, no guessed units beyond what the attribute
  carries. Search field when > 8 rows.
- **PARTS** — for buildings with parts: rows "Part 1 · 12.4 m · 3 roof
  surfaces" that expand to the part's attributes; clicking a part's roof
  surface row selects that surface (switches to surface subject).
- **GEOMETRY** — LoD, geometry type, surfaces (roof / wall / ground counts),
  vertices, bounding box (mono), "Raw object" button → opens the drawer in
  Raw objects view scrolled to this object.

Selecting a feature activates its layer, clears any other layer's selection,
highlights the map, and highlights the row in the drawer (scrolling to it
only if the drawer is open and the row is on the current page; otherwise the
drawer header shows "2 selected · not on this page · Show selected"). Shift-
click adds to the selection within the same layer; shift-click on another
layer's feature replaces the selection and activates that layer (a toast
"Selection moved to Planning areas" explains it). A surface selection
highlights its building's row. Selecting a row in the table selects the
building on the map and never moves the camera.

### Bottom drawer (Layer data)

Opens through "Open table" (active layer action row, layer overflow menu,
"Raw object" in the right panel). Heights: default 280px (220px when the
viewport is < 800px tall), drag handle on its top edge (min 160), **Expand**
button makes it take the whole map column (the map is hidden and a glass
"Show map" button appears in the drawer header); **Close** hides it. Header:

```
Delft   [Records] [Summary]        1,204 buildings · 312 matching · 2 selected   [Show selected records] [Export] [Expand] [×]
```

The title is the active layer's name; the tabs are Records / Summary; counts
carry units and scope. For streaming: "1,240 buildings currently loaded ·
402 matching (table only) · 0 selected". "Show selected records" is a toggle
that restricts the grid to the selected rows (all pages), badge with the
count; it never touches the map. Sorting and paging never change map
membership.

**Records tab.** A filter bar: Field select, Operator select, Value input,
"Apply", "Clear"; for the streaming layer a "Table only" pill sits before
Apply with the tooltip "This filter applies to the table only. Map filtering
for streaming layers is not available yet." Applying a filter on a city model
filters the map together with the table, and drops any selected feature the
filter excludes (toast "1 selected building was excluded by the filter").
View toggle `Buildings | Raw objects`; a "Columns" button opens a chooser
(checkboxes; default on: id, function, roofType, measuredHeight, yearOf-
Construction, status, roof area, mean slope, parts; default off: bbox,
parents, children, geometry LoD, object type). Grid: 20 rows per page,
sticky header (mono 11px uppercase 0.06em), tabular numerals, row click
selects (shift adds), selected rows lime wash, hovered rows raised tone;
building rows with parts show a chevron that expands indented part rows
(parts are never counted as buildings). Raw objects view lists every
CityObject flat with Type and Parent columns and counts "1,592 objects".
Footer: pagination "Page 3 of 61 · rows 41–60" with first/prev/next/last,
page-size select (20/50/100).

States: loading (skeleton rows + "Loading records…"), no matching records
("No buildings match measuredHeight > 80 m" with "Clear filter"), no tabular
capability ("AHN4 height is a raster layer. Raster layers have pixels, not
records." with "Open Scene settings" for colormap), error ("Could not read
Rijswijk.city.json: unexpected end of JSON input" with "Retry" and "Remove
layer"). Never show another layer's rows.

**Summary tab.** Layer-level statistics for the active layer, scoped
"1,204 buildings" or, with a filter, "312 matching buildings" with a switch
`All | Matching`: count cards? NO cards — a definition grid: Buildings, Parts,
Roof surfaces, Total roof area, Mean height, Height distribution (an inline
bar histogram with 8 bins, mono axis), Roof type breakdown (horizontal bars),
Year of construction (bins). Streaming: "over 1,240 currently loaded
buildings — not the whole dataset". Selection-specific metrics are NOT here
(they are in the right panel); a muted footnote says so.

**Export dialog** (modal, 14px radius, modal shadow): Scope radios "All
buildings (1,204)" / "Matching (312)" / "Selected (2)" — same numbers as the
header; Format select (CityJSON, CityJSONSeq, CityParquet, CSV, GeoJSON…
disabled ones say why); "Include parts" and "Attributes only" checkboxes;
Export (filled) / Cancel. Progress while DuckDB writes, then a toast
"Exported delft-matching-312.city.json".

### Status bar

Mono 11px: left "Navara · 2.1 fps · 1,204 + 1,240 objects on screen"; centre
"52.0116° N, 4.3571° E · 38 m"; right: "Streaming: 14 cells resident ·
settled" with a dot. No table entrance, no theme toggle.

### Add layer dialog

Tabs **File | URL | Catalog**. File: a drop zone (dashed strong hairline,
20px radius) + "Choose file"; after a drop or a chosen file the detection line
"Detected: CityJSON 2.0 — [Change…]" where Change opens a format select.
URL: input + Detect; same detection line; for `.fcb` it says "FlatCityBuf ·
streams as the camera moves". Catalog: an Open3D City list of three
collections with name, extent text, feature count, "Add" per row. "Add layer"
(filled) / Cancel. Adding creates a layer row in loading state that resolves
after ~1.5 s. A geospatial-only add (GeoJSON) opens the viewer just the same.

## Interaction rules (normative)

1. `activate(layerId)` — sets the active layer; if the selection belongs to
   another layer, clears it; the drawer (if open) re-targets to this layer
   including its own filter, page and view; drafts restore per layer.
   Never moves the camera.
2. `pick(layerId, featureId, surfaceId?, additive?)` — city hit beats vector
   hit; activates the owning layer; replaces the selection unless additive
   within the same layer; updates map highlight, right panel, table
   highlight together.
3. `setFilter(layerId, filter)` — city/vector: map membership and records
   change together, excluded selections are dropped (toast); streaming:
   records only, chip says "Table only". `clearFilter` from row chip, map
   chip, FILTER section or filter bar.
4. `hide(layerId)` / `remove(layerId)` — clears that layer's selection; if
   the active layer is removed, the next layer in list order (or the
   previous if it was last) becomes active; with none left, the empty
   workspace shows.
5. Selection is single-layer; `Escape` clears it; the right panel hides
   when it is empty.
6. `Zoom to layer` / `Zoom to selection` / `Fit` are the only camera moves
   outside direct manipulation.
7. Sun time changes re-draw shadows and keep the selection.
8. Legend heading → `activate(layer)` + open STYLE + scroll it into view.
9. Show selected records → view only; sorting/paging → view only.

## Acceptance scenarios (from the handoff, verified in the real browser)

1. Initial viewer: visible layer list, useful map area, no empty selection
   panel.
2. Feature and surface selection: one details panel, explicit identity
   trail, matching table highlight, a clear-selection action.
3. Layer switching: layer controls, table and selection stay consistent
   across city and vector layers.
4. Classification: apply Flat roofs, see a legend that matches the render,
   inspect a roof without losing the styling context.
5. Filtering: matching records and map features, drawer closed, the active
   filter still visible and clearable; the streaming layer's filter is
   labelled Table only before it is applied.
6. Data exploration: parts and raw objects, Records / Summary, a selection
   outside the current page through Show selected records, an explicit
   export scope.
7. Sun exploration: change the time while the map and the selected roof stay
   usable.
8. Space constraints: open, resize and collapse panels at 1440×900 and
   1280×720; layer navigation stays reachable; the expanded table works.
9. Capability and empty states: vector styling, a layer without a table,
   loading and error feedback, no matching records; never another layer's
   stale content.

## Notes for implementation

- The schematic prototype drew shadows and an oblique skew; production uses
  the engine's camera modes (`Top-down` = 2D, `Angled` = 2.5D, `Free 3D` =
  3D) and the existing sun writer. Counts in the prototype were mock data.
- "Zoom to layer" keeps the engine's fly-to promise inside
  `withSettleSuppressed` (hard rule). Adding a layer no longer triggers an
  automatic fit-all flight; the first layer of an empty workspace may.
- Saved workspaces and share links: the persisted schema moves to v4. v3
  documents migrate where the data still has a home (layers, rules, camera,
  theme); state that no longer exists (inspector tab, rule target override,
  table sync flag) is dropped explicitly in the migration, never silently.
  Unsupported older versions get a message with a recovery path.
- Streaming layers: a filter is `Table only` until map filtering exists for
  them; the wording "currently loaded" is mandatory wherever their counts
  appear.
- The geoid attribution badge stays over the map in every state, including
  the expanded table, which mirrors it in the drawer footer.

## Decisions (approved 2026-09-06)

- D1. Four homes, one active layer, one selection: Workspace in the header,
  Scene on the map (overlays + two nonmodal sheets), Layer in the left panel
  plus the bottom drawer, Selection in the right panel.
- D2. The bottom drawer spans the map column only. The left and right panels
  run full height, so opening the table never buries the layer list (the
  laptop rule). The drawer has an explicit Expand state that hides the map
  instead of shrinking every panel.
- D3. The right panel exists only while a selection exists. The floating
  attributes overlay is removed; the identity trail
  (`Delft → Building …25028 → Roof surface 12`) replaces it.
- D4. Rules move from the inspector into the active layer's STYLE section as
  `Color by: Rules`, with presets as the readable path and rule authoring as
  the advanced path. The independent Rules target selector is removed:
  Style, Filter, Details and the drawer all follow the active layer. Drafts
  are kept per layer.
- D5. One layer list for every type (city model, streaming, vector, raster,
  tiles) with one Add layer entry (File / URL / Catalog + format detection
  and a correction control). Dense per-row controls (LoD, appearance,
  streaming) move into DETAILS.
- D6. Map controls: a labelled Select control (Feature / Surface; Surface
  disabled for incompatible layers), a camera cluster (zoom, north, fit,
  Top-down / Angled / Free 3D), explicit Zoom to layer / Zoom to selection.
  A layer click never moves the camera.
- D7. Filtering: a layer filter affects map and records together for city
  models and vectors; the "Filter map" checkbox is removed. Streaming layers
  get an explicit "Table only" label before Apply and "currently loaded"
  wording. The active filter stays visible (row chip, map chip, FILTER
  section) with a Clear action when the drawer is closed.
- D8. Map and table always share the selection ("Sync selection" removed).
  Row selection never flies the camera. "Show selected records" is a table
  view. Counts read total · matching · selected with units; Export offers
  the same three scopes with the same numbers.
- D9. Building-oriented records by default with parts by expansion and a
  Raw objects view; structural columns behind a column chooser; raw
  attribute names preserved, no guessed units.
- D10. Scene settings (basemap, Google 3D, terrain, rendering, scene
  background, weather as a visual effect) are separate from layer styling.
  Interface light/dark lives under Preferences → Interface appearance.
  Cyber moves under a collapsed "Presentation looks" disclosure with an
  explicit override note.
- D11. Sun & shade is a nonmodal sheet with date, time, explicit timezone,
  playback and seasonal presets; the map and selection stay usable.
- D12. Projector state: both side panels collapsed, legend grows to a
  presentation size; the attribution badge stays.

## Removals (approved 2026-09-06)

- Floating attributes overlay over the map.
- "Sync selection" control.
- Rules target selector in the inspector.
- "Filter map" checkbox.
- Status-bar entrance to the table (replaced by Open table in layer controls).
- Disabled Measure and Box select toolbar buttons (removed from the primary
  UI until implemented).
- Header theme toggle (moves into Preferences).
- Cyber as a top-level scene theme (moves under Presentation looks).
- Weather menu as a top-level control (moves into Scene settings as a visual
  effect).

## Deferred capabilities

- Map filtering for streaming layers.
- Rules for vector layers.
- Measure and box select.
- Mobile layout (desktop-first per PRODUCT.md).
- Workspace Duplicate / Delete, layer Duplicate (revisit in 12.5).
- Preferences → Units and Reduce motion (dropped: metric only; reduced motion
  is honoured by CSS `prefers-reduced-motion`).
- Raster colormap selection (no engine support today).
- Streaming "Refresh visible" (12.5).
- Expressive scene backgrounds (Day sky / Dusk / Night) — no engine support.
