# CityParquet loading — design

**Date**: 2026-08-07
**Status**: approved autonomously (user asleep; every decision recorded in §Decisions for morning review)
**Spec sources**: `../cityparquet-paper/documents/docs` (CityParquet 0.1.0-draft), `../cityparquet-paper/cityparquet-rs` (reference implementation), real packages at `../cityparquet-paper/benchmarking/data/cityparquet/`.

## Goal

Load CityParquet datasets into the viewer as first-class city-model layers:

- **Remote URL**: a single `.parquet` object table, a package directory (with `metadata.json`), or a **wildcard** over object storage (`gs://`, `s3://`, and the `https://storage.googleapis.com/...` spelling).
- **Local**: a single `.parquet` file, or a **folder** chosen via the file picker (a CityParquet dataset is a directory, like a shapefile).

Out of scope for v1 (documented, deliberate): appearance (materials/textures), geometry templates, the experimental `CityParquetArrowNative-v1` encoding, streaming/partial reads, authenticated buckets.

## Format facts the design rests on

(Verified against the spec docs, `cityparquet-rs`, and the real `delft` package with a working Node spike.)

- A dataset is a **directory**: per-CityGML-module object tables (`building.parquet`, `transportation.parquet`, …), optional sidecars (`materials`/`textures`/`geometry_templates.parquet`), and a required STAC Item `metadata.json` whose assets (role `cityparquet-objects`) are the authoritative file inventory.
- Geometry is **little-endian ISO WKB** in absolute world coordinates (no transform/quantization): MultiPolygonZ 1006 for MultiSurface/CompositeSurface, **PolyhedralSurfaceZ 1015** for Solid, GeometryCollectionZ 1007 of PolyhedralSurfaceZ for Multi/CompositeSolid. One geometry column per LoD: `geometry_lod<M>_<m>`.
- Semantics ride `geometry_properties_lod*` (STRUCT): `type` (dispatch on this, never WKB shape), `surfaces` (JSON array), `face_semantics` (flat, one entry per WKB face), `shells` (per-solid face counts).
- **CRS is PROJJSON in the parquet footer key-value key `city`** (`city.crs`); `city.attributes` separates attribute columns from reserved ones; `city.columns[].encoding` declares WKB vs arrow-native; `city.primary_column` names the main geometry.
- `object_type` stores CityGML 3.0 class names — four differ from CityJSON (`Storey`, `HollowSpace`, `Square`, `GenericOccupiedSpace`) and files written by the DuckDB extension may use the CityJSON spelling; readers tolerate both.
- Columns use ZSTD + `DELTA_BYTE_ARRAY` (id/feature_id) + `BYTE_STREAM_SPLIT` (bbox) + dictionary (`object_type`).
- Plain HTTPS cannot list a directory; `gs://`/`s3://` wildcards list through the storage APIs. The 3DBAG cloud deployment is `gs://cityparquet/3dbag_tiled/<tile>/building.parquet` × 1000 tiles.

## Approaches considered

1. **Static whole-load via an engine-free parser (hyparquet) in `@cityjson/navara-cityparquet`** — parse fetched parquet bytes into the existing `CityModel` domain type; rendering, LoD switching, rules, picking, DuckDB analytics, and persistence all come free through the existing static-layer path (`CityJSONPlugin.addCityModel`). **Chosen.**
2. DuckDB-wasm decode (app-side) — no new dependency, but couples _rendering_ to DuckDB init (today it is optional analytics that can fail gracefully), makes the parser untestable under Node/vitest, and fights the Arrow value-mapping for nested structs. Kept as the analytics path only.
3. A streaming plugin mirroring FlatCityBuf — the only route to the full 1000-tile 3DBAG at once, but the cost is enormous (worker protocol, tile grid, settle/commit machinery) and CityParquet has no spatial index contract beyond bbox row-group stats. Deferred; the static path plus wildcard caps covers the realistic "load a handful of tiles" use today.

### Why hyparquet

Spiked against the real `delft/building.parquet` (2.4 MB, ZSTD, all encodings): footer `city` metadata, dictionary columns, list/struct columns, BYTE_STREAM_SPLIT bbox, and WKB blobs (`utf8: false`) all decode correctly under Node. One gap: hyparquet 1.28.1 supports `DELTA_BYTE_ARRAY` only in DataPage V2, while arrow-rs writes V1 pages — a **3-line wiring fix** (its `delta.js` already implements the decoder). hyparquet is MIT with **zero runtime dependencies**, so we **vendor the patched source** into the plugin package rather than juggling npm `patch-package` + `pnpm patch` across the app/submodule package-manager split. `hyparquet-compressors` (MIT; fzstd, hysnappy) stays a normal dependency for ZSTD/snappy.

## Architecture

```
packages/cityjson-navara-plugins/packages/navara-cityparquet/   (engine-free; no /plugin needed)
  src/vendor/hyparquet/     # vendored 1.28.1 + 3-line DELTA_BYTE_ARRAY patch (documented in VENDORED.md)
  src/wkb.ts                # LE ISO-WKB decoder: 1001-1007 + 1015 → faces (rings of Vec3), closing vertex stripped
  src/footer.ts             # parquet KV footer → CityFooterMetadata (version, crs→EPSG, primary_column, columns[], attributes)
  src/tableReader.ts        # hyparquet orchestration: schema probe, column projection, utf8:false, row objects
  src/decodeTable.ts        # rows → CityObject[]: object_type mapping, attributes, parents/children,
                            #   per-LoD surfaces from WKB faces + face_semantics/surfaces, bbox
  src/packageAssembly.ts    # STAC metadata.json manifest parse + multi-table/multi-file merge → CityModel
  src/index.ts              # barrel: parseCityParquetTable, assembleCityParquetModel, manifest helpers, types
  tests/                    # vitest under Node, using the committed fixture package + hand-built WKB bytes

src/features/cityparquet/                                        (app side)
  sourceClassify.ts         # URL → {kind: "table" | "package-dir" | "wildcard" | "storage-dir"} | null
  objectStorage.ts          # gs://, s3://, storage.googleapis.com: listing (GCS JSON API / S3 ListObjectsV2 XML),
                            #   glob → RegExp, https translation, pagination, MAX_FILES cap
  loadCityParquet.ts        # fetch orchestration (HttpClient.fetchBytes envelopes) → package assembly → CityModel
```

Data flow (remote): classify URL → resolve file list (direct / metadata.json assets / storage listing + glob) → fetch whole files → `assembleCityParquetModel` → `CityModel` → `addLayer` → existing `syncLayers` → `CityJSONPlugin.addCityModel` renders with ENU georeferencing, geoid offset, rules, picking — untouched.

Data flow (local): SourcePicker folder input (`webkitdirectory`) or `.parquet` file → same assembly from `File` bytes.

### Integration points (all small)

| File                                              | Change                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `navara-core/src/citymodel/supportedEncodings.ts` | add `"cityparquet"` to the encoding union (appended last — STAC asset preference order keeps preferring cityjson/fcb) |
| `src/domain/citymodel/detectEncoding.ts`          | `.parquet` → `"cityparquet"` before the cityjson fallback                                                             |
| `src/features/layers/useLayerFileLoader.ts`       | third arm in `addLayerFromFile`/`addLayerFromUrl`; new `addLayerFromFiles(files)` for folder picks                    |
| `src/ui/layers/SourcePicker.tsx`                  | ACCEPT += `.parquet`; “Choose folder” button (`webkitdirectory`); multi-file drop for a package                       |
| `src/app/App.tsx` restore branch                  | mirror the loader’s classification (kept in lockstep like the fcb branch)                                             |
| `src/analytics/duckdb.ts` / App DuckDB effect     | cityparquet stays on the in-memory analytics path (`loadCityModelFromMemory`); `loadModelIntoDuckDB` union unchanged  |
| `navara-cityparquet/package.json`                 | real deps + `./plugin`-free exports; placeholder export removed; `navaraPackageWiring.test.ts` updated                |

### Parsing rules (mirroring `cityparquet-rs` decode/export)

- Decode **every** `geometry_lod*` column present; each WKB face becomes one `Surface { type, rings, attributes, lod }` with `lod` parsed from the column suffix (`lod2_2` → `"2.2"`). Existing `LodSelector`/`computeAvailableLods` then work unchanged.
- Surface `type` comes from `face_semantics[i]` → `surfaces[j].type` mapped into `BuildingSurfaceType` (unknown semantic types → `"unknown"`); the surface object's other members become surface attributes.
- Dispatch on `geometry_properties.type`; tolerate the legacy bare `geometry` column quartet (treated as unknown-LoD, `lod: null`) since the current Rust writer still emits it in some paths.
- `object_type`: reverse-map the four CityGML spellings to CityJSON; pass anything else through.
- Attributes: columns listed in `city.attributes`; `ex_` prefix restored to `+`; `other_attributes` JSON merged; Date/Timestamp → ISO strings; `arrow.json` cells parsed.
- `parents`/`children` columns fill `CityObject.parents/children` (drives the existing attribute-inheritance display).
- `bbox` struct → `CityObject.bbox`; model bbox = union; missing bbox → computed from decoded rings.
- CRS: `city.crs` PROJJSON must carry `id: {authority: "EPSG", code}` → `referenceSystem` OGC URI. Missing/non-EPSG → reject (the CRS gate, same as every other format). Multi-file merges require all files to agree on the EPSG code.
- Unknown `city.columns[].encoding` token (e.g. arrow-native) → reject the layer with a clear message (per spec guidance: never guess from Arrow shape).
- `template` instances, `material_lod*`, `texture_lod*`, sidecars: **skipped** in v1. Objects whose only geometry is a template render nothing (their attributes still show).
- Duplicate object ids across merged files: first wins, one console.warn with a count.

### Remote source semantics

| Input                                             | Behaviour                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://…/building.parquet`                      | fetch that one table; footer metadata suffices (no `metadata.json` needed)                                                                                                |
| `https://…/dataset/` or `…/metadata.json`         | fetch `metadata.json`, load every asset with role `cityparquet-objects` (fallback: parquet media-type/extension assets minus `cityparquet-sidecar`), merge                |
| `gs://bucket/prefix/*/building.parquet` (any `*`) | list via GCS JSON API (`storage/v1/b/{bucket}/o?prefix=<literal-prefix>`, paginated), glob-match, fetch matches via `storage.googleapis.com/{bucket}/{name}`              |
| `s3://bucket/key…` (incl. `*`)                    | list via `https://{bucket}.s3.amazonaws.com/?list-type=2&prefix=…` (ListObjectsV2 XML, paginated); public buckets only; CORS/region caveats surfaced in the error message |
| `gs://`/`s3://` without wildcard                  | single object → translated https fetch; trailing `/` → list the prefix and load `metadata.json`/`*.parquet` found directly under it                                       |
| `https://storage.googleapis.com/bucket/…*…`       | treated as `gs://`                                                                                                                                                        |
| any other https wildcard                          | rejected: “Plain https URLs cannot be listed — use gs:// or s3://, or point at metadata.json.”                                                                            |

**Caps**: wildcard/directory expansion is capped at **64 object tables** (clear error asking to narrow the glob — full 1000-tile 3DBAG is a streaming problem, not a whole-load one). Sidecar files matched by a user's glob are skipped with a warn, not an error.

### Local folder picking

A second hidden input with `webkitdirectory` behind a “Choose folder” button (works in Chromium + Firefox; no File System Access API dependency). Files are filtered to `metadata.json` + `*.parquet`; sidecar names are excluded from the object-table set. Multi-file drag-drop of the same set is accepted; single `.parquet` file selection/drop also works. Directory _drop_ (webkitGetAsEntry traversal) is a stretch goal, not required.

### Persistence / share links

No schema change. URL-sourced layers (single, directory, wildcard, gs/s3) persist the input string verbatim in `modelRef.url` and re-expand on restore; file/folder layers restore through the existing “unavailable — choose file” banner (folder re-link is limited to re-picking a single `.parquet`; documented limitation).

### Error handling

All failures surface as the loader hook's error string (existing `loadError` slot): HTTP envelope errors reuse the friendly branches; listing failures name the store and suggest CORS as the likely cause; CRS/encoding rejections name the file. A per-file failure inside a multi-file load fails the whole layer (no partial city models silently missing tiles).

### Testing

- **Fixture**: `fixtures/two-buildings-cityparquet/` generated with the Rust CLI from `fixtures/two-buildings.city.json` (23 KB; committed). Round-trip test: parse the package and compare object ids, types, parent/child links, LoDs, semantic surface types, and ring coordinates (±1e-6) against `parseCityJSON` of the source — the strongest possible correctness oracle.
- **Unit**: WKB decoder against hand-built byte arrays (all 8 type codes, holes, shells, truncation errors); footer parsing; glob→RegExp; GCS/S3 listing against mocked fetch responses (incl. pagination); source classification; loader branching; SourcePicker folder selection (testing-library); App restore classification.
- **Integration**: delft package (2.4 MB, not committed — test skips if the path is absent) for scale sanity: 2231 rows, 4 LoDs, EPSG 7415.
- **Browser smoke** at the end: load the fixture package and the delft package through the real UI.

## Decisions (for morning review)

| #   | Decision                                                               | Rationale / alternative rejected                                                                                                                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Static whole-load path, not streaming                                  | Whole architecture reuse; streaming machinery cost is huge; format has no index contract. Revisit if full 3DBAG-scale is needed.                                    |
| D2  | Parser lives engine-free in `@cityjson/navara-cityparquet`             | The placeholder package exists for exactly this; Node-testable like navara-core; no engine binding needed since `CityJSONPlugin` renders the resulting `CityModel`. |
| D3  | hyparquet, vendored at 1.28.1 with a 3-line DELTA_BYTE_ARRAY(V1) patch | Proven by spike on real data; MIT, zero deps. Vendoring beats dual npm/pnpm patch tooling. Follow-up: upstream the fix and un-vendor.                               |
| D4  | DuckDB-wasm not used for decoding                                      | Rendering must not depend on DuckDB init state; Node-untestable. Analytics still work via the existing in-memory path.                                              |
| D5  | 64-file cap on wildcard/directory expansion                            | Whole-load memory bound; clear error over silent OOM.                                                                                                               |
| D6  | Fail the whole layer on any per-file error                             | A city model silently missing tiles is worse than an error.                                                                                                         |
| D7  | v1 skips materials/textures/templates + arrow-native encoding          | Viewer renders semantic vertex colours only; spec calls arrow-native experimental and says don't guess.                                                             |
| D8  | CRS gate: PROJJSON must resolve to an EPSG code                        | Matches the app-wide "no unresolvable CRS" rule.                                                                                                                    |
| D9  | Folder picking via `webkitdirectory`, not File System Access API       | Cross-browser (Firefox included), no new permission surface.                                                                                                        |
| D10 | Fixture generated by the Rust reference CLI and committed              | Reference implementation as ground truth; round-trip oracle against the CityJSON parser.                                                                            |
| D11 | s3:// support is public-bucket, default-endpoint only                  | No credentials UI in scope; error messages explain CORS/region limits.                                                                                              |
| D12 | Legacy bare `geometry` column tolerated as `lod: null`                 | The current Rust writer still emits it; spec-pure files unaffected.                                                                                                 |
