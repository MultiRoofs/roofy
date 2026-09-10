# Processing toolbox: spatial operations across layers

Issue: https://github.com/MultiRoofs/roofy/issues/10
Date: 2026-09-10
Status: feature specification, approved in chat 2026-09-10; mockup and
implementation plan follow this document.

This is a FEATURE specification: what the user sees, where each control
sits, which options exist, and what happens after a run. It names engine
facts only where they decide what can honestly be offered. Code structure
belongs to the implementation plan.

## 1. Goal

Give Roofy a QGIS-style processing toolbox: a searchable catalogue of
tools, each with a parameter form, a run with progress and cancel, a log and
a history. Every tool runs entirely in the browser on DuckDB-wasm with the
`cityjson`, `spatial` and `three_d` extensions. A run produces either

- **new attribute columns on an existing layer** (v1), or
- **a new vector layer** (v2, see §9).

The user picks a tool, picks the target layer and scope, fills the
parameters, runs, and gets attributes that behave like any other attribute:
shown in Details, filterable and sortable in the table, exportable, and
usable in colour rules.

## 2. Facts the design rests on

All verified in `2026-09-04-duckdb-integration-design.md` §2 and the
current code (2026-09-10), except where marked "probe".

- Prerequisite, already satisfied on `develop`: `@duckdb/duckdb-wasm` pinned
  exactly at `1.33.1-dev64.0` (DuckDB 1.5.5, `wasm_eh`), the only build for
  which `cityjson` v0.4.0, `three_d` v0.2.0 and core `spatial` load
  together. Any other version silently serves incompatible artefacts; a
  bump is its own change and re-verifies the three extensions first.
- Every city layer already has a DuckDB table (`layer_N`) holding `id`,
  `feature_id`, `object_type`, `parents`, `children`, one column per
  attribute, and the `bbox` struct. Geometry columns are NOT kept; the
  source bytes are dropped after the table is built and can be
  re-registered on demand through the layer's source provider (the same
  door the export dialog uses). A layer restored from a snapshot of a
  dropped FILE has no provider; a URL layer re-fetches.
- Only CityJSON and CityJSONSeq layers have a DuckDB reader. CityGML,
  CityParquet and streaming FlatCityBuf layers have a flat attribute table
  built app-side and no reader, so no geometry can be re-read for them.
- Streaming layers' tables hold the currently resident objects only.
- `read_cityjson(path, lod => 'X')` yields per LoD a WKB blob plus a
  `geometry_properties` sidecar. LoD 0 footprints are MultiPolygon Z, which
  `spatial` parses. Solid LoDs are PolyhedralSurface Z, which `spatial`
  cannot parse and only `three_d` can (`ST_3DTryFromWKB`, never
  `ST_3DFromWKB`: one MultiPolygon Z row poisons a whole column query;
  `ST_3DVolume` raises on a non-manifold solid unless guarded by
  `ST_3DValidationReport(...).is_valid`).
- `three_d` v0.2.0 provides volume, surface area, footprint area,
  z-min/z-max, closed/manifold/oriented checks and a validation report,
  3D distance, centroid and bounds. `spatial` provides the 2D predicates,
  measures and `ST_GeomFromGeoJSON`.
- `spatial` is a CORE extension: `INSTALL spatial` is a one-time ~24 MB
  download per session (about 5 s warm network); `three_d` and `cityjson`
  come from the community repository (about 1 MB each). Neither loads at
  boot today; `ensureExtension` exists and has no caller. Offline, none of
  them can load.
- `COPY ... TO (FORMAT cityjson | cityjsonseq | flatcitybuf)` writes 0 bytes
  in wasm; `parquet`, `csv`, `json` and `cityparquet_write` work. A new
  layer can therefore only come out as GeoJSON (via `ST_AsGeoJSON`) or as a
  CityParquet package through the app's own reader (probe, v2).
- Vector (GeoJSON) layers have NO DuckDB table today and are held in
  WGS84; city layers are in a metric EPSG CRS. The app already carries
  proj4 with the CRS definitions it uses for placement, so a vector layer
  can be reprojected app-side into the city layer's CRS before it is
  registered. `ST_Transform` in the wasm `spatial` build is unverified
  (probe); the design does not depend on it.
- DuckDB-wasm exposes `cancelSent()` on a connection: cancel is
  best-effort and asynchronous.
- Roof metrics (area, inclination, azimuth, elevation per roof surface)
  are computed client-side today and exist nowhere in DuckDB; the table
  shows three synthetic columns (roof area, mean slope, parts) computed per
  rendered page, which cannot be filtered, sorted or exported.
- The right panel today follows the selection and is absent when nothing
  is selected. There is no job, progress or reusable toast infrastructure.

## 3. Vocabulary

- **Tool**: one operation with a parameter form (e.g. Measure solids).
- **Group**: a heading in the catalogue (Roof, 3D measurements,
  Cross-layer).
- **Target**: the layer whose attributes the run writes.
- **Source**: a second layer a cross-layer tool reads from.
- **Scope**: which target objects a run touches: All, Matching (the
  drawer's applied filter), Selected.
- **Run**: one execution of one tool with fixed parameters; has a status,
  a log, a result summary and (when it wrote columns) an undo.
- **Computed column**: an attribute column written by a run; carries
  provenance (tool, parameters, run time) and a "computed" badge.

## 4. Where the toolbox lives

### 4.1 Header button

A ghost button **Tools** (wrench icon + text) in the header's right group,
between **Share** and **Preferences**. Clicking it opens the Tools tab in the
right panel; clicking again while Tools is showing closes the tab. While a
run is queued or running, the button carries a small lime activity dot; a
failed run the user has not yet seen turns the dot amber until the Tools
tab is opened.

### 4.2 Right panel tabs

With the toolbox open, the right panel gains a tab strip under its header:

```
┌ Right panel ───────────────────────────────┐
│ [Tools]  [Details · Building …25028]    ⟩  │
│ ───────────────────────────────────────────│
│ (tab body)                                 │
```

- **Tools** is present whenever the toolbox is open. Closing it (the tab's
  × or the header button) restores today's behaviour: the panel follows
  the selection and is absent without one.
- **Details** is present only while a selection exists, titled as today.
  Picking a feature while Tools is showing does NOT switch the tab; the
  Details tab title updates and gets a subtle emphasis so the user knows
  it changed. Clearing the selection removes the Details tab.
- Width, resize handle, collapse chevron and the collapsed pill are
  unchanged. Collapsed with the toolbox open, the pill reads "Tools" (or
  "Tools · running" during a run) beside the existing Details pill.
- Escape closes sheets first, then a tool form (back to the catalogue),
  then the selection, as the existing Escape order, with the tool form
  inserted after sheets.

The toolbox does not persist in snapshots. A reload opens with the
toolbox closed.

## 5. Catalogue view

```
┌ Tools ──────────────────────────────────── × ┐
│ [🔍 Search tools…                          ] │
│                                              │
│ ROOF                                         │
│ ▸ Roof metrics to attributes                 │
│   Roof area, slope, azimuth per building     │
│                                              │
│ 3D MEASUREMENTS                              │
│ ▸ Measure solids                        (3D) │
│   Volume, envelope, footprint, height        │
│ ▸ Validate solids                       (3D) │
│   Closed, manifold, oriented, report         │
│ ▸ Height from extent                         │
│   Vertical extent from the bounding box      │
│                                              │
│ CROSS-LAYER                                  │
│ ▸ Join attributes by location      (Spatial) │
│ ▸ Aggregate buildings per area     (Spatial) │
│ ▸ Distance to nearest              (Spatial) │
│                                              │
│ RECENT RUNS                                  │
│ ● Measure solids · Delft · 2.4 s · done      │
│   1,204 measured · 37 skipped   [Log] [Undo] │
│ ○ Join attributes · Delft ← Zones · failed   │
│   Binder Error: column "zone" …  [Log] [Retry]│
└──────────────────────────────────────────────┘
```

- **Search** filters tool rows by name and description as the user types;
  group headings with no matches hide. Empty result: "No tool matches
  'buffer'. Footprint operations arrive in a later release."
- **Group headings** are mono labels. Capability chips sit on the TOOL
  rows that need them, not on the group: **3D** for `three_d`, **Spatial**
  for `spatial`. The chip's tooltip says whether the extension is loaded,
  and if not, what loading costs: "Loads the spatial extension on first
  run (about 24 MB, once per session)". When the extension cannot be
  fetched (the boot-time check failed, or a load attempt failed) the chip
  turns muted and only the tools that need it are disabled with the
  reason "The spatial extension could not be downloaded; check the
  connection and retry" and a Retry link that attempts the load again.
  Height from extent and Roof metrics need no extension and stay enabled
  offline.
- **Tool rows**: name in the panel's body size, one-line description
  muted. A row is disabled, with its reason as a second muted line and a
  tooltip, when the ACTIVE layer cannot be its target. Reasons (exact
  copy):
  - "Needs a city model layer" (active layer is vector, raster or tiles)
    for Roof and 3D tools; "Needs a vector layer" for Aggregate buildings
    per area.
  - "Needs a CityJSON or CityJSONSeq source; this layer was loaded from
    CityGML" (or CityParquet / a streaming FlatCityBuf) for Measure
    solids, Validate solids and the footprint proxy of cross-layer tools.
  - "The source file is no longer available; add the layer again" for a
    restored dropped-file layer.
  - "Add a vector layer to join with" when no vector layer exists.
  - "Not available while DuckDB is unavailable" with the status bar's
    Retry when the engine failed, and "This layer's table could not be
    built" (with the table's own error) when the layer's table is in its
    failed state, which is also what a `cityjson` extension failure at
    boot produces for reader-backed layers.
    A disabled row still opens the tool view (so the user can read the
    parameters and switch the target layer); only Run is blocked, with the
    same reason under the button.
- Clicking a row opens the tool view (§6).
- **Recent runs** lists this session's runs, newest first, at most 20.
  Each row: status dot (lime done, amber failed, grey cancelled, pulsing
  lime running, hollow queued), tool name, target (and "← source" for
  cross-layer), elapsed time, status word; a second line with the summary
  or the first error line; actions **Log**, **Undo** (only for a done run
  that is still undoable, §6.2), **Retry** (failed: the same frozen
  parameters, §6.1) or **Cancel** (queued or running), and **Edit & run**
  which opens the tool view prefilled so parameters can be changed. The
  list is empty-state text "Runs you start appear here" until the first
  run. Batch runs (one tool over several layers) are deferred; a user runs
  the tool once per layer and the history keeps each run.

## 6. Tool view

```
┌ Tools ──────────────────────────────────── × ┐
│ ‹ Measure solids                       (3D)  │
│ Volume, envelope area, footprint area and    │
│ height of each building's solid.             │
│                                              │
│ TARGET                                       │
│ Layer      [Delft                        ▾]  │
│ LoD        [2.2 (1,116 objects)          ▾]  │
│ Scope      (•) All 1,204 buildings           │
│            ( ) Matching 312                  │
│            ( ) Selected 2                    │
│                                              │
│ PARAMETERS                                   │
│ [x] Volume (m³)          [x] Envelope area   │
│ [x] Footprint area (m²)  [x] Height (m)      │
│ [ ] Ground elevation     [ ] Ridge elevation │
│                                              │
│ OUTPUT                                       │
│ Column prefix  [solid_          ]            │
│ Columns: solid_volume_m3, solid_envelope_m2, │
│ solid_footprint_m2, solid_height_m,          │
│ solid_valid                                  │
│ ⚠ 3 of these columns exist; they will be     │
│   replaced.                                  │
│                                              │
│ Loads the three_d extension on first run     │
│ (about 1 MB, once per session).              │
│                                              │
│                        [Cancel]  [ Run ]     │
└──────────────────────────────────────────────┘
```

Common structure for every tool:

- **Back chevron** returns to the catalogue; the form's draft is kept per
  tool for the session, so returning restores it.
- **TARGET**: a layer select listing only layers the tool can target
  (defaults to the active layer, or the first eligible one), and the
  scope radios with live counts in the same words the drawer header uses
  ("1,204 buildings", "312 matching", "2 selected"). Scope counts
  FEATURES (a Building with its parts is one), exactly as the drawer
  counts them. Matching is disabled with "No filter applied" when the
  target has no applied filter; Selected is disabled with "Nothing
  selected on this layer" when the selection belongs to another layer or
  is empty. Streaming targets show, under the radios, "Runs over the 1,240
  currently loaded buildings, not the whole dataset." Changing the target
  does not change the active layer.
- **LoD** (tools that read geometry): a select of the LoDs at which the
  target has geometry of the kind the tool needs, each with the count of
  features that have it: "2.2 (1,116 buildings with a solid)". Eligibility
  and counts come from the in-memory model (every surface is tagged with
  its LoD and its geometry type), so they are known before any source is
  re-read, on every layer kind. When no LoD qualifies the select shows
  "No solid geometry in this layer" and Run is disabled with that reason.
  Default: the layer's selected LoD when it qualifies, else the highest
  qualifying one.
- **PARAMETERS**: tool-specific (§7). Validation is inline and blocks
  Run: at least one measure or aggregate must be ticked ("Pick at least
  one measure"); two aggregates resolving to the same column name are
  flagged on the second; a proxy/predicate pair that cannot combine
  ("Largest overlap needs a footprint or rectangle") disables the option
  with that text; a distance limit must be a positive number.
- **OUTPUT**: column prefix (tool default; letters, digits, underscore,
  must start with a letter; validation message inline), the resolved
  column list in mono, always shown before Run, and a replace warning
  listing which columns already exist. A column written by an earlier run
  may be replaced (its previous values are kept for Undo, §6.2). A column
  that came from the file is never replaced: the prefix input errors with
  "'height' belongs to the source data; choose another prefix". Copied
  field names that collide after slugifying ("Zone Name" and "zone_name")
  are flagged on the second with "resolves to the same column".
- **Extension note** when the tool's extension is not yet loaded, and a
  **workload note** when the target's source is large: "Re-reads a 180 MB
  source; this can take a minute and needs memory" above 100 MB.
- **Footer**: Cancel (ghost) returns to the catalogue; **Run** (filled
  lime, 38 px). Run is disabled with its reason under the button when the
  target is ineligible or a field is invalid. Keyboard: Enter in a text
  field runs when valid.

### 6.1 Running

Run replaces the footer with a progress block; the form locks (fields
disabled, values visible):

```
│ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮░░░░░░░░░░░░  Computing…   │
│ Loading extension ✓ · Reading source ✓ ·     │
│ Computing … · Writing results                │
│ 4.1 s                          [ Cancel ]    │
```

- DuckDB reports no progress; the bar is indeterminate within a phase and
  the phases are discrete: Loading extension (skipped once loaded),
  Reading source (registering bytes; skipped for tools that need none),
  Computing, Writing results. Elapsed time ticks.
- **Frozen parameters.** Pressing Run freezes everything the run needs:
  target and source layer identities, the LoD, the resolved set of feature
  ids the scope names (so a later filter or selection change does not
  move the goalposts), the fields to copy, and the resolved output
  columns. A queued run re-validates these just before it starts: a
  missing layer, a missing source field, a rebuilt table or a column that
  now belongs to the file fails the run with that reason instead of
  running on changed ground.
- **Cancel** asks the engine to cancel, marks the run "cancelling", and
  resolves in one of two ways. Results are computed into a scratch table
  and written to the layer in one final transaction; a cancel that lands
  BEFORE that commit discards the scratch table and the run reads
  cancelled with no change to the layer. A cancel that lands AFTER the
  commit cannot unwrite it: the run reads done with the note "finished
  before the cancel arrived" and offers Undo. The card never claims a
  cancel it could not deliver.
- One run executes at a time; a second Run from any tool queues it and the
  footer says "Queued behind Measure solids". Queued runs can be
  cancelled instantly.
- The user can leave the tool view, switch tabs, pick, filter and pan
  while a run executes. The header dot shows activity.
- Removing the target or the source layer during a run cancels it
  ("Layer removed"). A table rebuild of a streaming layer that is the
  target OR the source of a running run cancels it with "Layer changed
  while running; run again".
- **Source problems** are failures with their own first line: "Could not
  re-read the source (network or decompression error)", "The source no
  longer reads as the loaded layer (object ids differ); add the layer
  again" (detected by the id join, the only check possible: a URL whose
  content changed but still carries the same ids is not detected), "Not
  enough memory to read the source". If the DuckDB engine itself dies, the running run and
  every queued run fail with "Analytics engine stopped", the status bar
  shows its Failed state, and Retry there restarts the engine and rebuilds
  the layer tables; computed columns are lost (their runs read stale).

### 6.2 Done

The footer becomes a result card, and a toast repeats its first line:

```
│ ✓ 1,204 buildings measured · 37 skipped      │
│   (invalid solid) · 2.4 s                    │
│   Wrote 5 columns to Delft.                  │
│ [Open table] [Style by result] [Undo] [Log]  │
│                              [ Run again ]   │
```

- **Open table** opens the drawer on the target with the new columns
  appended after the existing ones and scrolled into view.
- **Style by result** opens the target's STYLE section with Color by =
  Rules and the rule editor open on a DRAFT rule. The map does NOT change
  until the user presses Save in the editor, as with any rule. The draft's
  attribute is the first column the run actually wrote, in the order §7
  lists for that tool (an unticked measure is never chosen); the operator
  is tool-specific (§7); the value is prefilled from the data (median for
  a numeric column, the most frequent value for a text column, `false`
  for a validity flag) and the colour is the next palette colour. The
  button is absent when the run wrote no styleable column (for example
  "count only" with the match count off) and disabled with "All values
  are empty" when the chosen column is NULL for every object in the run.
- **Undo** restores the layer to its state before the run: columns the
  run created are dropped; columns it replaced get their previous values
  back (the run keeps a copy of the replaced values until it is undone or
  leaves the history). Undo is available while the run is the LATEST run
  that touched each of its columns; a later run over any of them takes
  Undo away from the earlier one (the later run's own Undo still works).
  Undo asks no confirmation.
- **Log** opens the log view (§6.4).
- **Run again** unlocks the form with the same values.

Skipped objects are explained in the card in a second muted line by cause
("37 invalid solid · 12 no geometry at LoD 2.2 · 3 outside every area").
The value rule is: NULL means "could not be evaluated" (no geometry at the
LoD, invalid solid, no proxy geometry, reprojection failed); a count that
WAS evaluated and found nothing is 0 (a building outside every area has
`zones_matches_n = 0`, an area with no buildings has `buildings_n = 0`).
Boolean outputs are true or false when evaluated and NULL when not.

### 6.3 Failed

```
│ ✕ Failed after 1.2 s                         │
│   Binder Error: Referenced column "zone_id"  │
│   not found in FROM clause                   │
│ [Retry] [Log]                                │
```

The first error line, as the export dialog shows DuckDB errors. Retry
re-runs with the same parameters. Extension load failures say what failed
to load and, for the offline case, that it needs a network connection.
Nothing is written on failure.

### 6.4 Log view

A full-height view replacing the tab body: run header (tool, target
layer, source layer, scope with its frozen count, LoD, building geometry
proxy actually used, every parameter, the resolved output columns with
units, started, elapsed, status), then the SQL statements issued in order
with their timings and row counts, then warnings ("ST_3DVolume skipped 37
invalid solids"), then the error if any. This header is the reproducible
record of the run: a planner can read it back and rerun by hand. A
**Copy** button copies the whole log as text. Back chevron returns to
where the user came from.

## 7. The tools

Common rules for attribute-writing tools:

- Output columns are DOUBLE, BOOLEAN or VARCHAR; names are lower snake
  case with a unit suffix (`_m`, `_m2`, `_m3`, `_deg`, `_n` for counts).
- **Features, not rows.** The unit every tool counts, scopes and reports
  is the FEATURE: a root object (a Building) together with its parts. The
  scope names features; a selected or filtered PART resolves to its
  owning feature (as the map filter already does). The run writes both
  the root row and the part rows. A part is never counted as a building,
  in any count or aggregate, in any tool. Values in a replaced column
  outside the scope keep their existing value; in a new column they are
  NULL. A scope that resolves to zero features disables Run with "Nothing
  to run on (0 buildings)".
- **Contributors.** At the chosen LoD, if any part of the feature has
  geometry, the PARTS are the contributors and the root's own geometry at
  that LoD is ignored (3D BAG stores the same building on both); otherwise
  the root is the sole contributor. A feature with no contributor gets
  NULL in every output and is skipped "no geometry".
- **Roll-ups from contributors to the feature**, per measure. A
  contributor that cannot be parsed is left out; an INVALID solid still
  contributes the measures that do not need validity (§7.2). A feature
  with no remaining contributor for a measure gets NULL for it:
  - volume: sum over contributors, but NULL for the feature when any
    contributor's volume is NULL (a partial volume would mislead);
  - envelope area, footprint area, roof areas, surface counts: sum over
    contributors;
  - validity flags (closed, manifold, oriented, valid): AND over
    contributors; diagnostic counts (open edges and the like): sum;
  - height: combined extent, max ridge over parts minus min ground over
    parts (never the sum or max of part heights);
  - ground elevation: min over parts; ridge elevation: max over parts;
  - mean slope: area-weighted over all roof surfaces of the feature;
  - flat share: summed flat area over summed roof area;
  - dominant azimuth: azimuth of the largest non-flat roof surface of the
    feature;
  - joined fields, nearest id and distance: evaluated ONCE on the
    feature's proxy geometry (the union of its parts' footprints, or the
    feature's combined extent), then copied to root and parts alike.
    The Details panel shows the feature's value on the building and each
    part's own value on the part.
- Every computed column is registered with provenance and appears with the
  "computed" badge in the table header, the Details attribute list (with
  the provenance tooltip "Measure solids · LoD 2.2 · 2026-09-10 14:02"),
  the rule editor's attribute select and the export column list. Exports
  include computed columns like any other. A column's provenance is the
  LATEST run that wrote it; when that run covered only part of the layer
  the tooltip adds "312 of 1,204 buildings in this run; the rest from
  Measure solids · 13:40" so mixed values are never silent.
- When a table is rebuilt by the app (a streaming layer's residents
  change), computed columns are lost and their runs read "stale: layer
  reloaded" in Recent runs, with Re-run offered.

### 7.1 Roof metrics to attributes (group Roof)

Materialises the roof metrics the app already computes client-side.
Needs no extension and no source; works on every city layer kind
including streaming (resident set) and CityGML.

- Parameters: LoD (default the layer's selected LoD); measures as
  checkboxes: total roof area (m²), flat roof area (m²), flat share (0-1,
  slope under a threshold), mean slope (deg, area-weighted), dominant
  azimuth (deg, of the largest non-flat surface), roof surface count;
  flat threshold slider 0-15 deg, default 5.
- Output prefix `roof_`: `roof_area_m2`, `roof_flat_m2`, `roof_flat_share`,
  `roof_slope_deg`, `roof_azimuth_deg`, `roof_surfaces_n`.
- Features without roof surfaces at the LoD get NULL and are counted as
  skipped ("no roof surfaces at LoD 1.2").
- The drawer's three synthetic columns (roof area, mean slope, parts)
  stay as they are; the computed columns sit beside them with the badge.
  Style by result: rule on `roof_area_m2 >` median.

### 7.2 Measure solids (group 3D measurements, needs three_d and a reader)

- Parameters: LoD (only LoDs with solid geometry, per §6; default the
  selected LoD when eligible); measures: volume (m³),
  envelope area (m²), footprint area (m²), height (m, ridge minus
  ground), ground elevation (m), ridge elevation (m). Always written:
  `<prefix>valid` BOOLEAN.
- Outcomes per object, each guarded so one bad object never fails the
  run:
  - no geometry at the LoD: every output NULL; skipped "no geometry";
  - geometry the solid parser cannot read (a MultiPolygon at a solid LoD,
    corrupt WKB): every output NULL, `valid` NULL; skipped "not a solid";
  - parsed but invalid (open, non-manifold, misoriented): volume NULL,
    `valid` false; envelope area, footprint area, height, ground and
    ridge still computed (they do not need a closed solid); reported
    "invalid solid";
  - valid: everything computed, `valid` true.
- Prefix default `solid_`. Style by result: rule on `solid_volume_m3 >`
  median.

### 7.3 Validate solids (group 3D measurements, needs three_d and a reader)

- Parameters: LoD.
- Output prefix `solid_`: `solid_closed`, `solid_manifold`,
  `solid_oriented`, `solid_valid` (BOOLEAN), `solid_open_edges_n`,
  `solid_nonmanifold_edges_n`, `solid_degenerate_faces_n`.
- Outcomes per object follow §7.2: no geometry or unparseable geometry
  gives NULL in every column (skipped "no geometry" / "not a solid"); a
  parsed solid always gets all four flags and all three counts, valid or
  not. Feature roll-up per §7: flags AND, counts sum.
- Card: "1,079 valid · 125 with issues"; Style by result opens a rule on
  `solid_valid = false`.

### 7.4 Height from extent (group 3D measurements, no extension)

- Uses the bbox column already in every table; works on every layer kind
  including streaming and CityGML. Parameters: none beyond target and
  scope.
- Output: `extent_height_m`, `extent_zmin_m`, `extent_zmax_m`.
- The description says exactly what it is: "The vertical extent of each
  building's geometry (highest minus lowest coordinate), across all LoDs
  in the file. Includes chimneys and antennas; not a roof or terrain
  height." Measure solids' height is the same kind of extent at one LoD;
  neither is a defined roof height.
- Style by result: rule on `extent_height_m >` median.

### 7.5 Join attributes by location (group Cross-layer, needs spatial)

Copies attributes of the vector feature each building falls in (zoning,
district, noise band, flood zone) onto the building.

- TARGET: a city layer. SOURCE: a vector layer select listing GeoJSON
  layers whose features are polygons or multipolygons (a point or line
  layer is listed disabled with "Needs areas (polygons)"; raster and tiles
  layers never appear). An empty source disables Run with "The source
  layer has no features".
- **CRS and preflight.** The source is WGS84 and is reprojected app-side
  into the target's CRS before it is registered (a city layer always has a
  recognised metric CRS; the loader refuses others). Preflight, run in the
  Reading source phase: source features with null, empty or unparseable
  geometry are skipped and counted ("4 areas skipped: invalid geometry");
  a feature whose coordinates fail to reproject is skipped the same way;
  if every source feature is skipped the run fails with "No usable areas
  in Zones".
- All 2D operations work on the target's proxy geometry in the target's
  CRS; the log names the proxy used.
- PARAMETERS:
  - **Building geometry**: radio, the eligible options depend on the
    target: "Footprint (LoD 0)" when the target has LoD 0 geometry and a
    reader; "Extent rectangle" and "Extent centre" always (from bbox).
    Default: footprint when available, otherwise extent centre. A muted
    line explains the choice: "LoD 0 footprints are not in this layer; the
    bounding-box centre is used."
  - **Predicate**: intersects (default; touching a boundary counts),
    within (the whole proxy inside the area, boundary included), "centre
    within" (forces the centre proxy; a centre exactly on a shared
    boundary matches both areas and the tie rule below applies).
  - **Fields to copy**: a checklist of the source layer's properties
    (all on by default; type shown; a search box when more than 12).
  - **When several areas match**: first (by source order, the tie rule
    everywhere), largest overlap (footprint or rectangle proxies only;
    equal overlaps fall back to first), "count only" (writes no fields
    and forces the match count on).
  - **Also write the match count** checkbox (`<prefix>matches_n`, 0 when
    no area matches, NULL when the building had no proxy geometry).
- OUTPUT prefix defaults to the source layer name slugified (`zones_`).
- Card: "1,143 buildings joined · 61 outside every area · 2.9 s"; Style by
  result: rule on the first copied text field `=` its most frequent value;
  if no text field was copied, on `<prefix>matches_n >` 0.
- Copied values keep their type: numbers as DOUBLE, booleans, everything
  else as VARCHAR; nested objects are JSON text. A building with no match
  gets NULL in every copied field.

### 7.6 Aggregate buildings per area (group Cross-layer, needs spatial)

The reverse direction: summarises buildings inside each vector feature.

- TARGET: a vector polygon layer (the attributes go onto its features;
  point and line layers are disabled with "Needs areas (polygons)").
  SOURCE: a city layer with the same building-geometry proxy choice and
  predicate as §7.5. CRS: the roles are reversed here, so the TARGET
  areas (WGS84) are reprojected app-side into the SOURCE city layer's
  metric CRS for the computation, and the areas' stored WGS84 geometry is
  never modified; preflight and skip counts as in §7.5 apply to the areas.
  An empty target (no usable areas) disables Run with "The layer has no
  areas". Scope applies to the SOURCE buildings (All / Matching /
  Selected of the city layer); the target's every feature is written.
- Membership: a building counts for every area its proxy satisfies the
  predicate with (a building on a boundary counts in both areas); the
  card says so when it happens ("14 buildings counted in more than one
  area"). Buildings are features (§7 rules): parts never count.
- PARAMETERS: aggregates as rows, each an aggregate select (count, sum,
  mean, min, max) and, except for count, a numeric column select of the
  source layer (computed columns included, so "sum of roof_area_m2 per
  zone" is one run after §7.1). "+ Add aggregate". Default row: count.
  NULL source values are left out of sum, mean, min and max; an area
  whose buildings are all NULL gets NULL; count is 0 for an empty area.
- OUTPUT: one column per row, named `<prefix><agg>_<column>` (`buildings_n`
  for count), prefix default `bld_`.
- **Vector results** are written onto the vector layer's feature
  properties, which is what the app holds for a vector layer: they show
  in the vector layer's records panel with the computed badge and
  provenance, in Details for a picked feature, in the layer's Color by
  attribute categories, and in a GeoJSON export of the layer (a vector
  layer's Export offers GeoJSON with properties, added by this feature).
  The records panel's client-side filter and sort work on them. Undo
  restores the previous properties exactly (§6.2). The vector layer's
  DuckDB table is created for the run and dropped after it; the
  properties are the durable copy. Session only, like everything else.
- Card: "6 areas aggregated over 1,204 buildings"; Style by result opens
  the vector layer's STYLE section with Color by attribute set to the
  first output column (categories prefilled from its values).

### 7.7 Distance to nearest (group Cross-layer, needs spatial)

- TARGET: a city layer. SOURCE: a vector layer of any geometry type
  (points, lines or polygons; CRS handling as §7.5).
- An empty source (no usable geometry after preflight) disables Run with
  "The source layer has no features", as in §7.5.
- PARAMETERS: building geometry proxy (as §7.5); **Max search distance**
  (m, positive number, default 500; beyond it the distance is NULL and the
  building is counted as "none within 500 m"); **Also write the nearest
  feature's id** checkbox with a property select beside it: the select
  defaults to the GeoJSON feature `id` when the source has one; when it
  has none, the checkbox is off by default and ticking it requires
  choosing a property ("Choose the property to copy").
- The distance is the 2D distance in metres, in the target's CRS, between
  the chosen building proxy and the nearest source geometry (0 when they
  touch or overlap). Ties go to the first source feature in source order.
  The description and the log say "2D distance to the building footprint /
  extent / centre" accordingly.
- OUTPUT prefix from the source layer name: `roads_distance_m`,
  `roads_nearest_id`.
- Card: "1,204 buildings measured · 12 none within 500 m"; Style by
  result: rule on `<prefix>distance_m <` median.

## 8. Where results appear and how they behave

- **Details panel**: computed columns are listed in the attributes section
  under a mono sub-heading COMPUTED, each with the badge and provenance
  tooltip; a Building shows the aggregated value, a part its own.
- **Table**: columns appear after the file's columns, badge in the header
  cell, on by default in the column chooser, sortable and filterable like
  any other. The "Filter map" toggle works on them, so "show buildings with
  `solid_volume_m3 > 5000`" is the ordinary filter path.
- **Rules**: the attribute select lists computed columns in a COMPUTED
  optgroup; presets are unchanged.
- **Legend and tooltip**: unchanged; a rule on a computed column shows as
  any rule.
- **Export**: computed columns are included in every attribute format and
  in CityParquet as attributes.
- **Persistence**: nothing new is saved in v4 snapshots or share links.
  A restored workspace opens with no computed columns and an empty Recent
  runs list; a rule that references an attribute the layer no longer has
  shows the existing "attribute not found, matches nothing" behaviour
  with the generic hint "This attribute is not in the layer's data. If a
  tool computed it, run the tool again." (provenance is not persisted, so
  the hint cannot name the tool).
- **Selection and filters** are never changed by a run.

## 9. Deferred (with the slot they will occupy)

- **Footprint operations to a new layer** (group Footprint, needs spatial):
  buffer, convex hull, centroid, extent boxes, dissolve by attribute. Output
  a new vector layer named in the OUTPUT section ("Delft buffer 10 m"),
  added to the layer list as a GeoJSON layer, styled with the next palette
  colour, session only. Requires the LoD 0 footprint or the extent proxy.
- **Field calculator** (group Attributes, next milestone): add, edit or
  delete an attribute with a DuckDB expression over the layer's columns,
  with a column picker, function list and preview of the first rows. It
  is the toolbox's answer to the SQL console the DuckDB spec excluded.
- **City-to-city joins** (both layers in a metric CRS, reprojected to the
  target's).
- **Replay of runs on restore** (snapshot records tool, parameters and
  target; restore re-executes) once results prove worth the slower
  restore.
- **Computing on layers without a reader** (CityGML, CityParquet,
  streaming) by building WKB from the in-memory model app-side.

## 10. Acceptance scenarios

1. Load `fixtures/two-buildings.city.json`; open Tools; every tool row is
   enabled except the cross-layer ones, which read "Add a vector layer to
   join with". Run Height from extent: two rows measured, three columns
   appear in the table and in Details with the badge; Undo removes them.
2. Same layer, Measure solids at LoD 2 with all measures: volume and
   validity per building; an invalid solid shows NULL volume and
   `solid_valid = false`; the card reports the skipped count; Style by
   result opens a rule draft on `solid_volume_m3`, the map is unchanged
   until Save, and recolours after it.
3. Add a GeoJSON polygon layer covering one of the two buildings; Join
   attributes by location with the footprint proxy copies its properties
   onto that building and leaves the other NULL with "1 outside every
   area"; Aggregate buildings per area writes `buildings_n = 1` onto the
   polygon and it shows in the vector layer's records panel.
4. Streaming layer (delft.fcb): Measure solids is disabled with the
   FlatCityBuf reason; Roof metrics to attributes and Height from extent
   run over the resident set and the card says so; moving the camera far
   enough to rebuild the table marks the run stale.
5. Start a run, click Cancel before it commits: the run lands as
   cancelled and no column exists. Cancel after the commit: the run reads
   done with the "finished before the cancel arrived" note and Undo
   restores the layer. Start two runs: the second reads "Queued behind …"
   and runs after the first. Run Measure solids on All, then on Selected
   with the same prefix: the second run's Undo restores the first run's
   values for the selected buildings and the first run loses its Undo.
6. Disconnect the network, reload: the tools with a Spatial or 3D chip are
   disabled with the download reason and a Retry; Roof metrics and Height
   from extent still run. Reconnect, Retry: the chip loads and the tools
   enable.
7. Save the workspace, reload, restore: no computed columns, empty Recent
   runs; a saved rule on `solid_volume_m3` shows the generic hint.
8. Load the Delft sample (`delft.city.jsonl`, a CityJSONSeq whose
   BuildingParts carry the solids): Measure solids at LoD 2.2 on a
   filtered scope writes volume to each Building as the sum of its parts
   and height as the combined extent; selecting a part and choosing scope
   Selected runs on its whole building; the table's building count is
   unchanged, and Aggregate buildings per area counts each Building once.
9. Escape order: with a sheet open, a tool form open and a selection:
   Escape closes the sheet, then returns to the catalogue, then clears the
   selection.

## 11. Mockup

`design/processing-toolbox-wireframe.html`: a greybox of the running
viewer shell (traced from screenshots of the dev server with the Delft
fixture loaded; the older `design/wireframe.html` is not the current
layout) with the toolbox surfaces rendered in the Soft Utility tokens from
`src/app/brand.css` and `src/app/flatControls.css`. A state strip switches
between: catalogue, Measure solids form, running, done (with the table
drawer and Details showing computed columns), Join attributes by location
form, failed, log, and the collapsed-panel pill. Static HTML, mock data,
no engine.
