# DuckDB-wasm integration: per-layer tables, query table, map sync, export

Issue: https://github.com/MultiRoofs/roofy/issues/12
Date: 2026-09-04
Status: design approved for planning (probes complete)

## 1. Goal

Make DuckDB-wasm a first-class part of the viewer, with the `cityjson`
community extension loaded and `spatial` / `three_d` available on demand:

1. Every city-model layer is loaded into its own DuckDB table.
2. The table panel becomes a real query surface over that table: pagination
   (page size up to 1000), sort by column, and a structured WHERE-style filter.
3. A toggle applies the filter to the 3D map (only matching objects drawn).
4. An export dialog writes the layer, or the filtered subset of it, to a chosen
   format with a chosen LoD, object types and attributes.

Breaking changes are acceptable (project philosophy). The in-memory table
branches and the single global `city_objects` table are removed, not kept.

## 2. Facts the design rests on (all verified 2026-09-04)

Engine and extensions:

- The installed `@duckdb/duckdb-wasm@1.33.1-dev20.0` bundles DuckDB 1.4.4, for
  which NO `cityjson` wasm artifact exists: today's `INSTALL cityjson FROM
community` always fails and the app has silently run on its fallback.
- `@duckdb/duckdb-wasm@1.33.1-dev64.0` (npm `next`) bundles DuckDB **1.5.5**.
  The community repo serves `cityjson` v0.4.0 (`a1455e1`, 34 functions),
  `three_d` v0.2.0 (`679ee09`, 51 functions) and core `spatial` for
  `v1.5.5/wasm_eh`, all three loading together. Browser-smoked in a real
  Chrome tab with the app's exact boot sequence (jsDelivr bundle, blob-wrapped
  worker, no COOP/COEP): version 1.5.5, platform `wasm_eh`, extension load
  3.5 s cold / 0.26 s warm, `read_cityjson` over a `registerFileBuffer` buffer
  returns one row per CityObject, `COPY TO csv` + `copyFileToBuffer` works,
  zero console errors.
- npm `latest` (dev57, DuckDB 1.5.4) must NOT be used: its community slot
  serves a stale 4-function `cityjson` with a different schema and a `three_d`
  that breaks `LOAD spatial`, all without any error.
- `parquet` and `json` are bundled in the wasm binary and autoload without
  network. `cityjson` is fetched from the community repo on every session
  (2.6 MB raw, ~1 MB brotli); offline it will not load, and the app keeps its
  "analytics optional" posture for that case.
- `COPY … TO (FORMAT cityjson | cityjsonseq | flatcitybuf)` writes **0 bytes**
  in wasm, silently. `cityparquet_write` and `COPY TO parquet | csv | json`
  work. (Upstream bug for the maintainer to file; not worked around here
  beyond not offering those formats.)
- apache-arrow pinned by dev64: 17.0.0.

Readers (probed under Node with the same `wasm_eh` binary; reads over
`registerFileBuffer` share the code path with the browser runtime):

- `read_cityjson`, `read_cityjsonseq`, `read_flatcitybuf` all read a
  `registerFileBuffer` buffer (including a 7.6 MB `.fcb`). No reader gunzips,
  by name or by magic: the app's gunzip stays load-bearing.
- Re-registering a name replaces its bytes. A `dropFile`d name still resolves
  to zero bytes and fails with a misleading JSON parse error, so a VFS name is
  dropped only after everything that referenced it is gone, and names are
  never reused.
- Schema (v1.5.5, identical across the three readers): `id, feature_id,
object_type, parents VARCHAR[], children VARCHAR[], children_roles VARCHAR[],
address STRUCT[], bbox STRUCT, geometry_lod<L> BLOB,
geometry_properties_lod<L> STRUCT, material_lod<L>, texture_lod<L>,
template STRUCT, other`, then one inferred column per attribute (`DOUBLE`,
  `BIGINT`, `BOOLEAN`, `VARCHAR`, `DATE`, `TIMESTAMP WITH TIME ZONE` seen).
- `id` **is** `CityObject.id`, character for character; one row per
  CityObject (a BuildingPart is its own row). `feature_id` is the root object
  of the feature (a part carries its Building's id). Absent `parents` /
  `children` are SQL NULL, never `[]`.
- In 3D BAG (delft.fcb) geometry lives on the **BuildingPart** rows: 1115
  Buildings have only lod0, 1116 BuildingParts carry lod1.2/1.3/2.2.
- Dropping `geometry_*`, `geometry_properties_*`, `material_*`, `texture_*`,
  `template` keeps 53 of 70 columns on delft.fcb and cuts table memory 2.45×
  (13.1 vs 32.1 MiB for 2231 rows, ~1 s to build either way).
- Cells read through `getChild(col).get(i)`: LIST → arrow `Vector`, STRUCT →
  `StructRow`, BIGINT → JS `BigInt` (breaks `JSON.stringify`), DATE and
  TIMESTAMP → epoch-ms numbers. `to_json(col)` yields a plain `Utf8` (NULL
  stays null); `col::VARCHAR` yields DuckDB's own formatting.
- Bad column / type-family errors surface at bind time, bad literals at run
  time; all messages are one useful first line plus a `LINE 1:` caret block.
- CityParquet export: `exp.<module>` must be an ordinary table named for a
  CityGML module (`building, bridge, tunnel, construction, transportation,
vegetation, relief, water_body, land_use, city_furniture, generics`); a
  filtered `CREATE TABLE exp.building AS SELECT … WHERE …` works, then
  `PRAGMA cityparquet_init('exp')`, `PRAGMA cityparquet_validate('exp')`
  (advisory: the writer never refuses), `SELECT * FROM cityparquet_write('exp',
'pkg', crs => 'EPSG:NNNN')` returns one row per written file. Attributes may
  be dropped to zero; one `geometry_lodX_Y` is fine **but its
  `geometry_properties_lodX_Y` sidecar is mandatory**; `id, feature_id,
parents, children` must be present. Directory argument without a trailing
  slash. `metadata.json` is a STAC Item describing exactly what was written.
- `cityparquet_read` and `cityjson_geoparquet_geo` are unusable in wasm.
- `cityparquet_write` browser-verified 2026-09-04 (Chrome 151, same boot):
  a filtered CTAS source, `PRAGMA cityparquet_init` as a SEPARATE statement,
  then the write returns `building.parquet | written | n | bytes` and
  `metadata.json | …`; `copyFileToBuffer` returns the bytes (PAR1 magic, a
  real STAC Item). The write's result rows name the files; `globFiles` works
  in the browser too but lists never-created names, so it is used for cleanup
  only. TRAP: a MISSING VFS name reads back as ONE garbage byte with NO error
  (`copyFileToBuffer`, `read_blob` alike); a genuinely empty file reads 0.
  Every read-back is therefore validated by content (PAR1 magic for parquet,
  `JSON.parse` for JSON, a header line for CSV) before it is offered as a
  download.
- The city-format `COPY` sink bypasses DuckDB's VFS entirely ("no file", not
  "empty file": the output name shows the missing-file signature), while the
  same extension writes fine through `cityparquet_write`. That is the upstream
  pointer for the report.
- `spatial` does NOT autoload in wasm (explicit INSTALL/LOAD, 5 s / 23.6 MB);
  `three_d` loads in 0.3 s / 0.5 MB. `HUGEINT`/`DECIMAL` cells arrive as
  strings through Arrow, which `castText` (`::VARCHAR`) makes uniform.

## 3. Architecture

```
useLayerFileLoader ──addLayer──▶ layerStore
        │ (bytes / model / residents)
        ▼
analytics/layerTables.ts  ── one FIFO queue ──▶ analytics/duckdb.ts (engine, extensions)
        │ registry: layerId → { table, sourceFile, reader, columns, rowCount }
        ▼
features/query/queryStore.ts  (per-layer: filter AST, sort, page, pageSize, syncToMap)
        │                                  │
        ▼                                  ▼
ui/table/* (grid, filter bar,          scene/handleSync (visibleObjectIds →
   pagination, export button)           handle.setVisibleObjectIds)
        │
        ▼
ui/table/ExportDialog ──▶ analytics/export.ts (COPY / cityparquet_write → Blob)
```

### 3.1 Engine (`src/analytics/duckdb.ts`)

- `@duckdb/duckdb-wasm@1.33.1-dev64.0`, pinned exactly (already bumped in
  the worktree). Bundles still come from jsDelivr; nothing is vendored
  (Cloudflare 25 MiB asset limit).
- `cityjson` is loaded at init as today. `DuckDBStatus.ready` carries
  `extensions: Readonly<Record<ExtensionName, ExtensionStatus>>` with
  `ExtensionName = "cityjson" | "spatial" | "three_d"` and
  `ExtensionStatus = { state: "unloaded" | "loading" | "loaded" } |
{ state: "failed"; error: string }`.
- `ensureExtension(name): Promise<boolean>` loads `spatial` / `three_d`
  lazily on first call (memoised). Nothing in this issue's features needs
  them; they are made loadable for analysis features to come.
- `queryDuckDB` keeps its swallow-to-null contract for existing callers
  (`StatsTab`, `stacItems`). New sibling `runQuery(sql): Promise<QueryOutcome>`,
  `QueryOutcome = { ok: true; columns; rows } | { ok: false; message }` where
  `message` is DuckDB's first error line (the `LINE 1:` caret block stripped
  by `formatDuckDBError`). All new code uses `runQuery`.
- New VFS primitives exported: `registerBuffer(name, bytes)`,
  `dropBuffer(name)`, `readFile(name): Promise<Uint8Array>` (wrapping
  `copyFileToBuffer`), `ddl(sql)` (run for effect).
- `initDuckDB` failure terminates the Worker it created (no zombie worker
  beside the retry's) and resets the memoised promise so a Retry can call it
  again. StatusBar labels: `Ready` / `No ext` / `Loading` / `Failed`; the
  status tooltip lists `PRAGMA platform` (`wasm_eh` vs `wasm_mvp` get
  different artefacts) and `SELECT extension_name, extension_version FROM
duckdb_extensions() WHERE loaded`, because the community slot for a DuckDB
  version can be rebuilt under us (the duckdb-wasm pin is what pins the
  extension build) and a schema drift must be diagnosable from the UI.

### 3.2 Per-layer tables (`src/analytics/layerTables.ts`, new)

```ts
interface LayerTable {
  readonly table: string; // "layer_3": module counter, never the layer id
  readonly sourceName: string | null; // VFS name used for the source, or null
  readonly source: SourceProvider | null; // re-registers bytes for export; null = fallback
  readonly reader: "read_cityjson" | "read_cityjsonseq" | null; // null = flat fallback
  readonly columns: ReadonlyArray<ColumnInfo>; // DESCRIBE after creation
  readonly lods: ReadonlyArray<string>; // from geometry_lod* names; [] for fallback
  readonly rowCount: number;
}
interface ColumnInfo {
  readonly name: string;
  readonly type: string; // DuckDB column_type verbatim
  readonly kind: "scalar" | "castText" | "nested" | "blob";
}
```

`classifyColumnType(type)` (pure): ends with `[]` or starts with `STRUCT(` /
`MAP(` → `nested`; `BLOB` → `blob`; `VARCHAR`, `BOOLEAN`, `DOUBLE`, `FLOAT`,
`REAL`, `INTEGER`, `SMALLINT`, `TINYINT`, `UINTEGER`, `USMALLINT`, `UTINYINT`
→ `scalar`; everything else (`BIGINT`, `HUGEINT`, `DECIMAL`, `DATE`,
`TIMESTAMP…`, `TIME`, `INTERVAL`, `UUID`, …) → `castText`.

Sources, decided by the loader at add time (the loader is where the bytes are):

| Layer source                           | DuckDB source                                   | reader                           |
| -------------------------------------- | ----------------------------------------------- | -------------------------------- |
| CityJSON / CityJSONSeq file drop       | decoded bytes → `registerBuffer`                | read_cityjson / read_cityjsonseq |
| CityJSON / CityJSONSeq URL (incl. .gz) | the gunzipped bytes `loadFromUrl` already holds | same                             |
| CityGML (file, URL, zip)               | flat rows from the parsed `CityModel`           | null                             |
| CityParquet (file, folder, URL)        | flat rows from the parsed `CityModel`           | null                             |
| FlatCityBuf streaming (file or URL)    | flat rows from resident records                 | null                             |

Rationale: registering bytes means URL layers are never downloaded twice, and
`read_cityjson` over a remote URL (never exercised in wasm, CORS-dependent) is
never used. `shouldUseSourceUrlPath` is deleted; the streaming gate is
`Layer.isStreaming`. `loadFromUrl` returns `{ model, bytes, encoding }`;
`decodeModelBytes` already yields the decompressed text, which is re-encoded
once (`TextEncoder`) for the VFS, and the JS copy is released after
registration.

Table creation (reader-backed): `DESCRIBE SELECT * FROM <reader>('<file>')`,
then

```sql
CREATE TABLE "layer_3" AS
SELECT "id", "feature_id", "object_type", … -- every column NOT matching
       -- ^(geometry|geometry_properties|material|texture)_lod\d+(_\d+)?$ or template (the reader's LoD-suffixed columns only; a user attribute such as material_roof is kept)
FROM read_cityjson('layer_3.city.json')
```

Source bytes are dropped from the VFS right after the table is materialised
(`dropBuffer`), so memory per layer is the attribute table alone; geometry WKB
is never materialised for browsing. For export, the bytes are re-registered
from a per-layer `SourceProvider` (`() => Promise<Uint8Array>`): a dropped
`File` is re-read from disk (a `File` is a reference, not a copy), a URL is
re-fetched through the same gunzip-aware `HttpClient` (browser cache usually
serves it); both return DECODED bytes (gunzipped, the text re-encoded as
UTF-8), the same bytes the table was built from. A restored snapshot's file
layer is already "unavailable" and has no provider, so its export button is
disabled with that reason; a restored URL layer re-fetches. The provider lives in the registry entry, not in the layer store
(a function is not snapshot state). Browser-verified 2026-09-04: a table
built by `CREATE TABLE … AS SELECT … FROM read_cityjson('f')` survives
`dropFile('f')` (counts, structs, blobs and attributes all read back).

Flat fallback (no reader): rows built from the model or resident records and
loaded via `registerBuffer` + `read_json_auto`, with column names ALIGNED to
the reader's: `id, feature_id, object_type, parents, children` (NULL when
empty), then attributes (object-valued ones JSON-stringified). `feature_id` is
the root ancestor's id, computed by walking `parents` (cycle-safe, in
`src/domain/citymodel/featureId.ts`, pure). The old `lod` / `surface_count`
columns are dropped (app-side derivations, not data). One vocabulary for the
filter builder and export on every layer.

Lifecycle:

- `enqueueLayerTable(layerId, source)` on add; `dropLayerTable(layerId)` on
  remove (`DROP TABLE`, then `dropBuffer` of any still-registered source);
  a streaming layer re-enqueues on stream version change, debounced 500 ms,
  only while the table panel is open; opening the export dialog on a
  streaming layer re-enqueues once so the export never reads a stale
  resident set.
- One async FIFO queue: a drop enqueued behind a create waits for it, so a
  removal cannot race an in-flight `CREATE`. A layer removed while still queued
  is skipped. Rebuilds replace the table under the same name (`CREATE OR
REPLACE`) and re-register the same VFS name.
- Table and VFS names come from a module counter, never reused.
- Creation failures are recorded on the entry (`{ state: "failed", message }`),
  shown in the panel, never thrown into the loader: a DuckDB failure must not
  fail a layer add.
- A Zustand `layerTableStore` mirrors `{ layerId → "queued" | "building" |
{ state: "ready", …LayerTable } | { state: "failed", message } }` so React
  subscribes; the queue and registry are plain module state.
- `App.tsx` loses its DuckDB load effect and the `duckdbModelLoaded` /
  `duckdbTableLoaded` flags. `StatsTab` reads readiness from the store and
  queries the active layer's table with `object_type` (today it reads a
  `type` column from `city_objects`, which does not exist in the reader
  schema).

### 3.3 Query model (`src/features/query/`, engine-free) and SQL builders

```ts
type FilterOp =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull"
  | "in";
interface FilterCondition {
  id: string;
  column: string;
  op: FilterOp;
  value: string | number | boolean | ReadonlyArray<string>;
}
interface FilterGroup {
  logic: "AND" | "OR";
  conditions: ReadonlyArray<FilterCondition>;
}
interface LayerQuery {
  filter: FilterGroup; // the DRAFT edited in the bar
  applied: FilterGroup | null; // what the grid and the map currently use
  sort: { column: string; dir: "asc" | "desc" } | null;
  page: number;
  pageSize: 100 | 500 | 1000;
  syncToMap: boolean;
}
```

`queryStore`: `Record<layerId, LayerQuery>` with defaults; actions per field;
`applyFilter(layerId)` copies draft → applied and resets `page` to 0. Session
only (deliberately not in the v3 snapshot, like `activeGeoLayerId`). Apply is
an explicit action, never per keystroke: applying can rebuild geometry.

`src/analytics/sql.ts` (pure, unit-tested):

- `quoteIdent(name)` (`"` doubled); `quoteLiteral(value)` (`'` doubled,
  numbers must be finite, booleans `TRUE`/`FALSE`). DATE/TIMESTAMP columns get
  a string literal and DuckDB casts.
- `compileFilter(group, columns): { ok: true; where: string | null } |
{ ok: false; message }`. A condition naming an unknown column, or an
  operator its kind cannot take (`contains` on a non-text column, any
  comparison on `nested`/`blob`), is rejected at compile time with a sentence.
  `contains`/`startsWith`/`endsWith` compile to `LIKE … ESCAPE '\'` with
  `%`/`_`/`\` escaped in the needle.
- `projectColumn(col)`: `scalar` → `"c"`; `castText` → `"c"::VARCHAR AS "c"`;
  `nested` → `to_json("c") AS "c"`; `blob` → excluded from the grid.
- `buildPageSql(table, columns, applied, sort, page, pageSize)`: `ORDER BY
"c" dir NULLS LAST` (sort only on `scalar`/`castText`), `LIMIT pageSize
OFFSET page*pageSize`.
- `buildCountSql(table, where)`.
- `buildFeatureIdsSql(table, where)`: `SELECT "id" FROM t WHERE
COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM t
WHERE <where>)` — matches are expanded to their whole feature so a Building
  whose attributes match keeps its BuildingPart geometry. Always the positive
  `IN` form with `COALESCE` on both sides: a single NULL `feature_id` would
  make a `NOT IN` predicate NULL and hide nothing.
- `buildDistinctSql(table, column)`.
- `buildExportSql(...)`: see 3.6.

### 3.4 Table panel (`src/ui/table/`)

DuckDB-only. Structure: `TablePanel` (shell: resize handle, header, body,
footer) → `FilterBar` (condition rows: column select, operator select, value
input; AND/OR toggle; Apply / Clear; inline error `role="alert"` for compile
or DuckDB messages) → `DataGrid` (sticky header, sortable columns, row click
→ selection as today, selected rows highlighted, `—` for null) →
`Pagination` (page size 100/500/1000, prev/next, "rows a–b of N", and
"filtered from M" when a filter is applied).

Header: layer name, "Sync selection" (existing behaviour, renamed from "Sync
scene"), "Filter map" toggle (3.5, disabled with a title on streaming layers),
Export button, collapse chevron. The `IntersectionObserver` infinite scroll
goes away. `TablePanel.tsx` splits into these components plus a
`useLayerQuery(layerId)` hook that owns the generation counter (a stale
response never overwrites a newer one) and reads `layerTableStore` +
`queryStore`.

States: DuckDB failed (error + Retry); table queued/building (spinner); build
failed (message); no active layer; zero rows. With a filter applied and
"Filter map" on, a zero-row result says "0 of N rows match; the map shows
nothing while Filter map is on" so an empty globe reads as intended, not as a
rendering bug. Default panel height rises to
320 px; the resize clamp becomes 120–800 px.

### 3.5 Sync filter to map

`LayerQuery.syncToMap` on → after each successful Apply (and on toggle-on),
run `buildFeatureIdsSql` for the applied filter and write
`layerStore.setVisibleObjectIds(layerId, ids | null)`. `null` means no
filter; an EMPTY set means "hide everything" and is distinct from null.
Toggle off, Clear filter, layer table rebuild or failure → `null`.

Plugin change (submodule, committed and pushed first):

- `buildCityMeshArrays(model, layerId, originOffset, selectedLod, hiddenTypes,
appearance, surfaceColors, visibleObjectIds: ReadonlySet<string> | null =
  null)`: `visibleObjectIds` is the EIGHTH parameter — `appearance` has been
  the sixth since the texture/material work, and `surfaceColors` became the
  seventh with the Roofy brand's `colors` seam (plugin `ec65845`, which
  `origin/develop` pinned); both are passed positionally by `cityModelMesh.ts`,
  `fcb.worker.ts` and every test that names a theme or a palette. An object is
  emitted iff not hidden by type AND (visibleObjectIds is null OR has(id)). The
  `objectKeys` slot invariant is preserved (a filtered object still takes its
  index). The id test is RAW — no ancestor walk — because the caller's SQL has
  already expanded every match to its whole feature (`buildFeatureIdsSql`), so
  the set it hands over already names the parts as well as the roots; walking
  parents here would be the same expansion done twice, in a hot geometry loop,
  against a model the plugin does not index.
- `CityModelMesh.setVisibleObjectIds(ids)` on the same `rebuildGeometry` seam
  as `setHiddenTypes`; exposed on `CityModelHandle` and the registry;
  `handleSync` pushes it on identity change, like `hiddenTypes`.
- `Layer.visibleObjectIds: ReadonlySet<string> | null` is session-only (not
  in the snapshot; `addLayer` defaults it to null; a rebuilt table resets it).
- Streaming layers: the toggle is disabled with the reason "Map filtering is
  not available for streaming layers yet" (the id set would have to travel to
  the FCB worker and be re-applied per cell; deferred).

### 3.6 Export (`src/analytics/export.ts` + `src/ui/table/ExportDialog.tsx`)

Dialog (portal modal, `useModalChrome`), opened from the table header for the
active layer:

- **Scope**: whole layer / current filter (default: filter when one is
  applied). Both are feature-scoped: `WHERE "feature_id" IN (SELECT
"feature_id" FROM … WHERE <pred>)`, never a bare row predicate.
- **Object types**: multi-select of the layer's TOP-LEVEL types (the
  `object_type` of rows whose `parents IS NULL`), all on by default; a
  feature is exported iff its root's type is selected. Parts follow their root.
- **Attributes**: multi-select of the table's attribute columns (everything
  after the fixed prefix), default all.
- **LoD**: one of `LayerTable.lods` (reader-backed layers; default the
  layer's `selectedLod`). Hidden for fallback layers.
- **Format**:
  - `CityParquet package (.zip)` — reader-backed layers only: 1. `CREATE SCHEMA "exp_<n>"`. 2. Re-register the source bytes from the `SourceProvider` under a fresh
    VFS name. For each CityGML module present: `CREATE TABLE "exp_<n>".<module> AS
SELECT id, feature_id, object_type, parents, children, children_roles,
bbox, geometry_lod<L>, geometry_properties_lod<L>, <attributes>
FROM <reader>('<sourceFile>', lod := '<L>') WHERE <feature predicate>
AND <module predicate>`. Module is decided by
    `cityGmlModuleOf(objectType)` (pure, `src/analytics/cityGmlModule.ts`):
    Building* → building, Bridge* → bridge, Tunnel\* → tunnel,
    OtherConstruction → construction, Road/Railway/TransportSquare/Waterway
    → transportation, PlantCover/SolitaryVegetationObject → vegetation,
    TINRelief → relief, WaterBody → water*body, LandUse → land_use,
    CityFurniture → city_furniture, everything else → generics. The module
    predicate is `feature_id IN (SELECT id FROM t WHERE parents IS NULL AND
object_type IN (<types of that module>))`. 3. `PRAGMA cityparquet_init('exp*<n>')`; `PRAGMA cityparquet*validate`       → findings count shown as a warning in the dialog, not a refusal.
    4.`SELECT \* FROM cityparquet_write('exp*<n>', 'exp*<n>', crs =>
    'EPSG:<code>')`(code from the layer's`referenceSystem`); each result
       row's file is pulled with `readFile`and zipped with`fflate`
       (`zipSync`, already a dep) as `<layer>.cityparquet.zip`.
    5. `DROP SCHEMA … CASCADE`, drop the VFS files (source and outputs).
       Always, in `finally`.
       Browser-smoke gate: step 4's multi-file write under `exp*<n>/…`names must
       be verified in Chrome before this format ships; if the browser VFS refuses
       it, the fallback is one`COPY (SELECT …) TO 'x.parquet'`per module plus an
       app-written`metadata.json` — decided by the smoke, not guessed.
  - `Parquet`, `CSV`, `JSON` — every layer: `COPY (SELECT id, feature_id,
object_type, <attributes> FROM "<table>" WHERE <feature predicate>) TO
'exp_<n>.<ext>' (FORMAT …)` then `readFile`. Nested columns are exported
    as-is for Parquet and via `to_json` for CSV/JSON.
- Download through the existing `Blob` + anchor pattern
  (`RuleBuilderTab.handleExport`), factored into `src/platform/download.ts`
  and reused there.
- Busy state with a cancel-safe `finally`; errors inline with DuckDB's message.

CityJSON, CityJSONSeq and FlatCityBuf appear in the format list DISABLED,
with the title "Not available in the browser build of the cityjson extension
(writes an empty file)", so the user learns the capability exists. Root cause
to pin for the upstream report (the extension maintainer is the project
owner): the hypothesis is that the writer opens its output through a
non-DuckDB file API (std::ofstream → Emscripten MEMFS) so the bytes never
reach DuckDB's VFS; browser-confirmed 2026-09-04 that no VFS file is created
at all (missing-file signature), for all three formats, with and without a
pre-registered empty buffer. Fallback layers (no reader) offer the
attribute formats only, and the dialog says why ("this layer has no CityJSON
source in DuckDB; geometry formats need one").

### 3.7 Persistence

Snapshot schema stays at v3. Nothing new is persisted: filter, sort, page,
sync-to-map and `visibleObjectIds` are session state. Layer tables are rebuilt
on restore by the same add path.

## 4. Testing

- Unit (jsdom, default `npx vitest run`): `sql.ts` (quoting, every operator,
  projection by kind, paging, feature-id expansion, export SQL);
  `classifyColumnType`; `featureId`; `cityGmlModuleOf`; `formatDuckDBError`;
  `queryStore`; `layerTables` queue ordering and lifecycle with a mocked
  engine; `FilterBar`, `Pagination`, `TablePanel` states with `runQuery`
  mocked; `layerStore.setVisibleObjectIds`; `handleSync` push; export
  orchestration with mocked engine (SQL sequence, zip contents, cleanup on
  failure); the seven test files that mock the DuckDB module extended with
  every new export.
- Plugin unit: `buildCityMeshArrays` with a visible set (slot invariant, AND
  with hiddenTypes, empty set hides all, null passes all);
  `CityModelMesh.setVisibleObjectIds` rebuild via the existing mesh tests.
- Integration (opt-in, `environment: node`, behind `DUCKDB_INTEGRATION=1`,
  outside the default run because it needs network for the 36 MB bundle and
  the extension): real DuckDB 1.5.5 + cityjson over the fixtures: table
  creation from registered bytes, page/count/ids SQL, both export routes
  producing bytes that read back, and one test asserting that the set of
  `id` values `read_cityjson` returns for `two-buildings.city.json` equals the
  key set of `parseCityJSON`'s `objects` (BuildingParts included), because
  the map sync joins on it and a mismatch would silently hide everything.
- Browser smoke (CDP script recipe from the scratchpad, kept under
  `scripts/smoke/` if it earns its place): app boots, status Ready, a dropped
  file appears in the table, a filter applies, map sync hides objects, each
  export format downloads and re-opens.

## 5. Delivery constraints

- Submodule: `origin/main` of the plugin repo is ahead of the parent's pin
  (947c980 → b7d15c1, a Navara 0.1.1 bump the app is not on). Plugin changes
  go on a `duckdb-integration` branch cut from 947c980, pushed, and the parent
  gitlink points at that branch's head; never a push onto `main` from the
  detached pin.
- Lockfile: the committed `package-lock.json` already disagrees with local
  npm 11.12 (a no-op install produced a 1678-line diff). Regenerate it once
  with the duckdb-wasm bump, run `pnpm install` in the submodule afterwards,
  and verify `npm ci` in a fresh clone of the pushed commit before pushing
  further (CI runs `npm ci`).
- Every new export from `src/analytics/duckdb.ts` is added to the seven test
  files that `vi.mock` it (`tests/unit/app/appCatalogEntry`, `appRestoreShare`,
  `appEngineBoot`, `appCityParquetLayers`, `tests/unit/features/stac/stacItems`,
  `tests/unit/analytics/duckdbStatus`, `streamingDuckdb`).
- The `analytics/duckdb.ts` module is the ONLY importer of
  `@duckdb/duckdb-wasm`; `layerTables`, `export` and `sql` take the engine
  through that module's functions so they can be unit-tested with a mock.

## 6. Out of scope

Geometry-backed predicates and analysis (`ST_3DVolume`, footprint area via
`spatial`/`three_d`) are NOT possible on the attribute-only table: they need
either geometry columns materialised (memory, see §2) or a computed-columns
feature that reads the re-registered source on demand. The extensions are
integrated as loadable capabilities in v1; the roadmap entry says so. Known
`three_d` traps for that follow-up: `ST_3DFromWKB` throws on a MultiPolygon Z
row and one such row poisons a column query (use `ST_3DTryFromWKB`);
`ST_3DVolume` raises "solid is not manifold" on an unguarded aggregate (guard
with `ST_3DValidationReport(...).is_valid`).

Streaming-layer map filtering; persisting filters in snapshots/share links; a
free-text SQL console; spatial/three_d-backed analysis features (the
extensions are made loadable, not used); CityJSON/CityJSONSeq/FCB export until
the upstream writer works in wasm; CityParquet-sourced layers as reader-backed
tables (`cityparquet_read` is unusable in wasm; `read_parquet` over the
package files is a follow-up).
