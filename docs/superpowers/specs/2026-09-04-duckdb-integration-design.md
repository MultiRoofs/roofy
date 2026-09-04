# DuckDB-wasm integration: per-layer tables, query table, filter→map sync, export

Issue: https://github.com/MultiRoofs/roofy/issues/12
Date: 2026-09-04
Status: design, pending review

## Goal

Make DuckDB-wasm a real part of the viewer instead of an optional side-car:

1. Every city-model layer gets its own DuckDB table.
2. The table panel becomes a paginated (≤ 1000 rows/page), sortable, filterable
   query view over the active layer's table, with DuckDB's own error text shown.
3. A "Sync filter to map" toggle hides every object the filter excludes from the
   3D scene.
4. An "Export layer" dialog writes the active layer out (LoD, attributes, object
   types, format) through DuckDB's `COPY` and the `cityjson` extension's writers.

## Findings that shape the design

- **The installed `@duckdb/duckdb-wasm@1.33.1-dev20.0` bundles DuckDB core
  1.4.4, for which no `cityjson` community build exists** (404 at every 1.4.x
  slot). That is the whole reason the status bar reads "No ext" today. The
  `next` dist-tag `1.33.1-dev64.0` bundles core **1.5.5**, whose community slot
  carries `cityjson` **0.4.0** (2.6 MB, signed): `read_cityjson`,
  `read_cityjsonseq`, `read_flatcitybuf`, `COPY … (FORMAT cityjson |
cityjsonseq | flatcitybuf)`, `cityjson_geoparquet_geo`, and the `cityparquet_*`
  pragmas/table functions. The `latest` tag (core 1.5.4) only gets 0.2.0 — two
  readers, no writers, no FCB — so `next` is the version that matches the issue.
  Both use `apache-arrow ^17`, same as today, so the Arrow-major footgun does not
  apply. The extension repo **freezes a build per DuckDB version**, so the
  duckdb-wasm pin is what pins the extension version.
- `three_d` 0.2.0 (490 KB) and `spatial` (6 MB zstd, autoloads on first `ST_*`
  call) are both available at 1.5.5.
- **Extension table schema** (reserved columns, then one typed column per
  attribute): `id, feature_id, object_type, parents[], children[],
children_roles[], address, bbox STRUCT, geometry_lodX_Y BLOB,
geometry_properties_lodX_Y STRUCT, material_lodX_Y, texture_lodX_Y, template,
other JSON`. There is **no `lod` column** (LoD rides the column name) and no
  `type` column (it is `object_type`). `feature_id` is the top-level feature
  grouping key: a `BuildingPart` shares its `Building`'s `feature_id`.
- The COPY writers **require** `id`, `feature_id`, `object_type`; hierarchy and
  `geometry_lod*`/`geometry_properties*` are optional; every other column is
  written as an attribute (`bbox`, `other`, `address`, `template` are recognised
  and dropped). Metadata/CRS is discovered when the SELECT names exactly one
  reader; a SELECT from a **table** needs `metadata_from '<path>'` or explicit
  `crs`. **The wide CityParquet layout round-trips directly**, so
  `read_parquet` over CityParquet files yields the same schema without the
  extension.
- **CityParquet has no COPY format.** `cityparquet_write(schema, dir)` writes a
  **directory**; directory writes under the wasm VFS are unverified.
- Today's app: one global `city_objects` table, `CREATE OR REPLACE`d for the
  active layer only, never dropped; the load effect depends on the whole
  `layers` array so every rule edit reloads DuckDB; `queryDuckDB` swallows
  errors (`catch { return null }`); the table panel is infinite-scroll with
  `PAGE_SIZE = 100`, has sort, no WHERE; the "Sync scene" checkbox syncs
  _selection_; DuckDB never sees a **dropped file's** bytes (the loader keeps
  only the parsed `CityModel`); a `.city.json.gz` URL cannot be read by
  `read_cityjson` remotely; the only geometry-hiding primitive is
  `hiddenTypes` (type-keyed, geometry rebuild through `buildCityMeshArrays`);
  rules provably cannot hide (RGB-only evaluator on an opaque material).

## Decisions

### D1. Bump duckdb-wasm to `1.33.1-dev64.0` (core 1.5.5), load `cityjson` and `three_d`

Pinned exactly, as today. Init loads `cityjson` (required for the extension
path; failure → the fallback path below, and the status bar says _why_:
"cityjson extension unavailable for DuckDB <version>"), then `three_d`
best-effort (so a raw filter can use `ST_3DVolume(geometry_lod2_2) > 500`).
`spatial` is not loaded eagerly; DuckDB autoloads it on the first `ST_*` call.
Bundles keep coming from jsDelivr (Cloudflare 25 MiB asset limit); no COOP/COEP.

### D2. DuckDB reads the bytes the app already fetched — never a URL

Every static load (URL or dropped file, gzip or not) already has the decoded
bytes in hand. The loader hands them to the analytics side, which registers
them in DuckDB's VFS (`registerFileBuffer("layer/<layerId>/<name>")`) and
runs `CREATE TABLE <t> AS SELECT * FROM read_cityjson('<vfs path>')` (or
`read_cityjsonseq`; `read_parquet([...], union_by_name=true)` for CityParquet
tables, which needs no extension). This removes the URL/file split, the gzip
special case, CORS as a DuckDB concern, and the double download.

The source bytes are **released right after the table exists**: at load the
registry runs `cityjson_metadata(path)` and `cityjson_geoparquet_geo(path)`
once, caches the CRS string and the two footer strings in the layer's table
entry, and `dropFile`s the source, so a 200 MB file does not stay resident in
the worker for the layer's lifetime. Export then passes `crs => '<cached>'`
(explicit options outrank `metadata_from` per the extension docs). What this
gives up is appearance-definition round-tripping: **v1 export does not carry
materials/textures** (the `material_/texture_` columns are dropped from the
export SELECT), which is recorded in the export dialog as a note. (Browser
spike C8 verifies a table survives `dropFile`; if it does not, the bytes stay
and the memory cost is documented instead.)

Streaming (FCB) layers keep today's resident-cells path (`read_flatcitybuf`
over a whole remote 3D BAG tile set is a streaming problem, not a table load)
and are reloaded on `activeStreamVersion` while active. CityGML layers (and any
layer when the extension failed to load) take the **row fallback**: rows are
built from the in-memory `CityModel` and inserted via `read_json_auto`, now
emitting the **same reserved column names** as the extension (`id`,
`feature_id` = root ancestor, `object_type`, `parents`, `children`) so one
schema serves the UI, filter builder and export. Fallback tables carry no
geometry, which caps their export formats (see D6).

Source attribute keys colliding with reserved column names are prefixed
`attr_` rather than dropped.

### D3. One table per layer, reconciled by a registry, not by App's effect

`src/analytics/layerTables.ts` owns a module registry + a small zustand store
(`layerTableStore`): `layerId → { state: pending | loading | ready | failed,
tableName, columns: {name, type}[], hasGeometry, lods: string[],
objectTypes: {type, count}[], sourcePath?, error? }`. Table names are
`layer_<sanitised id>`. A `useLayerTables` hook reconciles the layer list:
load a table for each new layer (when DuckDB is ready — bytes are parked in the
registry until then), `DROP TABLE` + `dropFile` on removal, reload a streaming
layer on resident version change. The effect keys on layer **identity**, so
rule edits and visibility toggles no longer touch DuckDB. `App`'s
`duckdbModelLoaded`/`duckdbTableLoaded` flags and the global `city_objects`
table go away; `StatsTab` and `TablePanel` read the active layer's entry.

`queryDuckDB` grows a sibling `queryDuckDBOrThrow` that surfaces DuckDB's
message; the old null-returning wrapper stays for callers that want silence.

### D4. Table panel: pages, sort, filter, per-layer query state

A new zustand store `tableQueryStore` keyed by layer id holds `{ conditions,
logic: AND|OR, rawWhere, sort: {column, dir} | null, page, pageSize,
syncToMap }` — session state, not persisted. Switching layers keeps each
layer's query.

- **Pagination**: page controls (first/prev/next/last, "page n of N", total
  count) with a page-size picker `100 | 250 | 500 | 1000` (default 100; 1000
  is the hard maximum). The count query runs once per (filter) change.
- **Sort**: unchanged behaviour, now driven from the store.
- **Filter builder**: rows of `column · operator · value` with an AND/OR
  toggle. Operators: `= ≠ > ≥ < ≤`, `contains`, `starts with`, `in (a, b, c)`,
  `is null`, `is not null`. An "Advanced" disclosure exposes a raw SQL `WHERE`
  text field (DuckDB's own dialect, so `ST_3DVolume(...)` works). Both compile
  to a WHERE string in a pure, unit-tested `buildWhereClause` (identifier
  quoting, literal escaping, numeric vs string by column type). "Apply" runs
  the query; a DuckDB error renders inline under the builder (`role="alert"`)
  with the engine's sentence.
- **Columns shown**: geometry group columns (`geometry_*`,
  `geometry_properties_*`, `material_*`, `texture_*`, `template`, `address`,
  `bbox`, `other`) are hidden from the grid by default behind a "Show geometry
  columns" toggle; they remain filterable.
- Row click → selection, and the existing "Sync selection" checkbox, are kept.

### D5. "Sync filter to map" = per-object hide, static layers only

A new `Layer.hiddenObjectIds: ReadonlySet<string> | null` sits beside
`hiddenTypes` and flows through the same seam: `buildCityMeshArrays(…,
hiddenTypes, hiddenObjectIds)` skips an object whose **id** is in the set (keys
are still pushed first, so indices stay stable) → `CityModelMesh.
setHiddenObjectIds` (set-equality check, `rebuildGeometry`) →
`CityModelHandle` + `AddCityModelOptions` → `cityModelRegistry` →
`handleSync` (identity-compared memo) → `layerStore.setHiddenObjectIds`.

When the toggle is on and a filter is applied, the panel runs

```sql
SELECT id FROM <t> AS o
WHERE NOT EXISTS (SELECT 1 FROM <t> AS m
                  WHERE m.feature_id = o.feature_id AND (<filter>))
```

so a filter on `Building` attributes keeps the `BuildingPart`s that carry the
geometry, and stores the result as the layer's hidden set. `NOT EXISTS` (not
`NOT IN`) because a single NULL `feature_id` would otherwise make the whole
predicate NULL and hide nothing; a row whose own `feature_id` is NULL is
matched on its own `id` (`COALESCE(feature_id, id)` on both sides). Turning the toggle
off, clearing the filter, or a failed query clears the set. Not persisted
(snapshot schema stays v3). **Streaming layers**: the toggle is disabled with
a tooltip — hiding by id there means posting an id set over the worker
protocol on every commit, which is a follow-up (recorded in the roadmap).

### D6. Export dialog

Toolbar/layer-panel entry "Export layer…" for the active city layer, backed by
`src/analytics/exportLayer.ts` (pure SQL builder, unit-tested) plus a thin
`runExport` that does `COPY … TO '<vfs out>'` → `copyFileToBuffer` → Blob
download (the `RuleBuilderTab` precedent) → `dropFile`.

Options, all read from the layer's table entry:

- **Object types**: checklist with counts (default all). Filtering is by
  feature: `feature_id IN (SELECT feature_id FROM t WHERE object_type IN (…))`,
  so choosing `Building` keeps its parts.
- **LoD**: checklist of the table's `geometry_lod*` suffixes (default all);
  unchecked LoDs drop their `geometry_/geometry_properties_/material_/texture_`
  columns from the SELECT.
- **Attributes**: checklist of attribute columns (default all). Reserved
  columns are always kept for city formats; for CSV/JSON/Parquet the user's
  attribute list plus `id, feature_id, object_type` is written.
- **Apply current table filter**: checkbox, shown when a filter is applied.
- **Format**: `CityJSON (.city.json)`, `CityJSONSeq (.city.jsonl)`,
  `FlatCityBuf (.fcb)`, `Parquet (CityParquet-layout table)`, `CSV`, `JSON`.
  City formats need `hasGeometry && extensionLoaded` (fallback tables offer
  CSV/JSON/Parquet only). City writers get `crs => '<cached CRS>'` (D2); the
  Parquet writer stamps `KV_METADATA {geo, city}` from the footer strings
  cached at load, with the `geo` JSON's column list **pruned to the geometry
  columns actually selected** (an unchecked LoD must not be named in the
  footer), and `geo` omitted entirely when the cached value is NULL (the
  all-solid case — `KV_METADATA` cannot omit a key, so the option list is built
  without it).
- **CityParquet package (directory via `cityparquet_write`)** is a spike task:
  if a directory write + `globFiles` works in the browser, it is offered as a
  `.zip` (fflate, already a dependency); if not, it is left out and the
  single-file Parquet option is what ships, with the reason recorded here.

## Out of scope (recorded, not forgotten)

- Hiding by id for streaming layers (worker-protocol id set).
- `read_flatcitybuf` with bbox pushdown as a streaming table source.
- Computed/virtual columns in the grid (e.g. `ST_3DVolume`); today only the
  raw WHERE can use `three_d`.
- Persisting table filters in snapshots/share links.
- A multi-layer (cross-table) query console.

## Testing

- Pure builders (`buildWhereClause`, `buildPageQuery`, `buildHiddenIdsQuery`,
  `buildExportQuery`, table-name sanitising, column classification) are unit
  tests without DuckDB (docs/testing-strategy.md line 24).
- Registry reconciliation is tested with a mocked DuckDB seam (an injected
  `exec`/`register`/`drop` object), as the store logic is what matters.
- `buildCityMeshArrays` hidden-id filtering, `CityModelMesh.setHiddenObjectIds`
  set-equality, `handleSync` memo, and `layerStore.setHiddenObjectIds` get unit
  tests in their packages.
- The table panel and export dialog are tested with `@testing-library/react`
  against the mocked query seam.
- End-to-end (extension actually loads at 1.5.5, COPY round-trips, hidden
  objects vanish) is a browser smoke via `agent-browser` against
  `fixtures/two-buildings.city.json` and `fixtures/delft.fcb`, recorded in the
  PR description.
