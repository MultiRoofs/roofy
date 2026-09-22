# CityParquet Object Families and Per-Family Tables (performance task 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CityParquet package is a set of object families (building, bridge, water_body, transportation, vegetation, city_furniture). A streamed layer renders the families the user asked for — Building by default — and every family has its own DuckDB table read from the FILE, all rows and all non-geometry columns, so the table, filters, statistics and export no longer depend on what geometry happens to be resident.

**Architecture:** The manifest keeps a family per object table (its href basename). A streamed layer opens only the enabled families' tables; enabling or disabling one reopens the stream under the SAME layer id, keeping camera, selection, rules, hidden types and tables. A family's DuckDB table is built by streaming the file's identity + attribute columns through the existing CityParquet row-range reader in bounded chunks and inserting them chunk by chunk — never a whole-file download, never `registerFileURL` (which this duckdb-wasm build does not have). Table state becomes keyed by `${layerId}::${family}` with one active family per layer, so today's single-table consumers keep working through one resolver.

**Tech Stack:** TypeScript, DuckDB-wasm (`read_json_auto` + `INSERT`), vendored hyparquet row-range reads, the streaming worker protocol, Vitest (Node for plugins, jsdom for the app).

**Spec:** the performance handoff, task 5 ("Default to Building, including associated parts/installations. If buildings are absent, select available families. Other families load when enabled. Opening a family's table can load attributes without rendering its geometry. Add a table button beside each Object Visibility entry. Prefer one DuckDB instance with per-layer/per-family tables or views and a table selector. Keep loading, available, loaded, and visible states explicit.") plus the shipped `docs/plans/2026-09-22-cityparquet-bounded-loading.md`.

## Global Constraints

- `CLAUDE.md` applies in full: TDD; submodule commits first, then the pointer bump; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit prefixes; never bare `vite`/`vp dev`; tests import from `"vitest"`; `@navaramap/*` only in engine-binding modules; `src/insights/duckdb.ts` stays the ONLY module importing `@duckdb/duckdb-wasm`; worker graphs import only navara-core, navara-cityparquet, their own package, proj4, vendored hyparquet, hyparquet-compressors.
- Every task 3 bound stays: `VIEWPORT_FEATURE_BUDGET` 20 000, `MAX_FETCH_READ_ROWS` 60 000, `MAX_FETCH_READ_BYTES` 96 MiB, `WORKER_RETAINED_BYTE_BUDGET` 512 MiB with `retainedBytes` metered main-side, families read/baked/evicted together, unlabelled geometry as the lowest rung.
- **A family table is built without ever holding the file.** Rows come from the row-range reader in chunks of `FAMILY_TABLE_CHUNK_ROWS = 25_000`; each chunk is registered, inserted and dropped before the next is read; geometry columns are never projected. Peak extra heap during a build must stay comparable to one chunk, and the build must be abortable.
- **Loading / available / loaded / visible stay explicit** (handoff): a family is _available_ (in the manifest), its geometry is _opened_ (streaming) or not, its table is _queued/building/ready/failed_, and its objects are _visible_ (hidden types, filters). No UI may conflate them.
- **Ruling R-A (family identity): the object table's href basename** (`building.parquet` → `building`), because the manifest keeps nothing else — asset keys are dropped today and `city3d:co_types` never reaches the reader. `parseCityParquetManifest` starts returning `families: {key, href, size}[]`; the display name is the key with `_` → space and title case. Cost if wrong: a package whose file names are not family names shows odd labels; nothing breaks.
- **Ruling R-B (transport for tables): chunked INSERT from the CityParquet reader**, not DuckDB httpfs and not a whole-file `registerFileBuffer`. duckdb-wasm here has no `registerFileURL`, and a 335 MB family would reintroduce exactly the memory failure task 3 removed. Cost if wrong: a columnar engine reading the file directly might be faster; revisit if a table build becomes the bottleneck.
- **Ruling R-C (table keying): `${layerId}::${family}`, with one active family per layer.** Existing single-table consumers (`mapFilterSync`, `runQueue`, `useEligibilityContext`, export, stats) go through one resolver that maps a layer id to its active family key, so their call sites keep their shape. Cost if wrong: the resolver hides which family a consumer meant; the alternative (touching every consumer) is a far larger blast radius for this milestone.
- **Ruling R-D (default families): Building only, when the package has a building table**; otherwise every available family, so a package without buildings still shows something. A single-table source (`…/building.parquet`) is a one-family package. Static (below-threshold) packages keep today's behaviour — all tables merged into one layer and one table — and are explicitly out of scope.
- **Ruling R-E (changing families): reopen the stream under the same layer id.** `openStreamingLayer` gains an optional `id`; a new `reopenStreamingLayer` closes the handle, opens a new one with the new source list and re-registers it, without touching `layerStore`, `queryStore`, selection or the DuckDB tables. The viewport's stream memos must be cleared so rules/LoD/hidden types are re-seeded on the new handle. Cost if wrong: a reopen costs one index rebuild per opened family (~7 s for Yokohama's building table) where an `addSource` protocol message would not; the protocol and the handle's immutable grid/header stay simple.
- **Ruling R-F (`feature_id` under chunking): take it from the reader's `familyRoot`**, not from a whole-set computation. `layerRows`'s `rootFeatureId` needs every row at once, which chunking forbids; the reader already knows each row's family root (task 3's `StreamRow.familyRoot`). Cost if wrong: a file whose parts are not contiguous with their root would mis-root; the reader's family grouping already assumes contiguity and counts what it rejects.
- **Known limit to record, not fix:** object ids are assumed unique across families (today's static path already merges first-wins with a warning). Per-family tables make a cross-family duplicate ambiguous in the scene; the build logs a count and the architecture notes state it.

## File Structure

| File                                                                                                       | Responsibility                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navara-cityparquet/src/packageAssembly.ts`                                                                | `CityParquetManifest.families: {key, href, size}[]` (R-A), derived from the object tables it already returns.                                                                                                                                                                                        |
| `navara-cityparquet/src/streamReader.ts`                                                                   | `header.tables: {name, rowCount}[]` (per-family totals for counts); `readAllRows({columns:"attributes", chunkRows, signal})` — an async iterable of `{rows, firstRow, lastRow}` chunks of identity + attribute columns (never geometry), each row carrying its `familyRoot`.                         |
| `src/insights/familyTables.ts` (new)                                                                       | Builds one family's DuckDB table from `readAllRows` chunks: explicit `columns={…}` from the footer + `FLAT_COLUMN_TYPES`, `CREATE OR REPLACE TABLE … AS SELECT` for the first chunk, `INSERT INTO … BY NAME` for the rest, re-checking supersede/engine-death between chunks; reports progress rows. |
| `src/insights/layerTables.ts`                                                                              | Keying by `${layerId}::${family}` (R-C) plus `resolveActiveTable(layerId)`; `adoptLayerTable` reused for family tables; drop-all-for-layer on removal.                                                                                                                                               |
| `src/features/layers/familyStore.ts` (new)                                                                 | Per layer: available families (key, label, href, size, rowCount when known), enabled set, active family for the table panel.                                                                                                                                                                         |
| `src/features/streaming/openStreamingLayer.ts`                                                             | Optional `id`; `reopenStreamingLayer(plugin, layerId, source)` (R-E).                                                                                                                                                                                                                                |
| `src/features/cityparquet/addCityParquetLayer.ts` / `streamDecision.ts`                                    | Carry the family list into the decision; open only enabled families (R-D).                                                                                                                                                                                                                           |
| `src/ui/layers/LayerTypeToggles.tsx` / `DetailsSection.tsx`                                                | A families block above object types: per family a visibility toggle and a table button (`ActionIcon`, `--control-height-compact`), with loading/available/loaded/visible states distinct.                                                                                                            |
| `src/ui/table/TablePanel.tsx`, `src/features/query/queryStore.ts`, `useLayerQuery.ts`, `useLayerCounts.ts` | A family selector; query state keyed per `${layerId}::${family}`; the "buildings" view stays Building-only and is disabled for other families.                                                                                                                                                       |
| `src/features/streaming/useTotalObjectCount.ts`, `src/ui/StatusBar.tsx`                                    | "N of M" counts the OPENED families; the layer details line names the package total and what is open.                                                                                                                                                                                                |

---

### Task 1: Manifest families, per-table counts, and a chunked attribute reader

**Files:** modify `navara-cityparquet/src/{packageAssembly,streamReader}.ts`; tests alongside.

**Interfaces:**

```ts
export interface CityParquetFamily { readonly key: string; readonly href: string; readonly size: number | null }
// CityParquetManifest gains: readonly families: ReadonlyArray<CityParquetFamily>
// CityParquetStreamHeader gains: readonly tables: ReadonlyArray<{ name: string; rowCount: number }>
export interface AttributeChunk { readonly rows: ReadonlyArray<Record<string, unknown>>; readonly firstRow: number; readonly lastRow: number; readonly table: number }
readAllRows(opts: { chunkRows?: number; signal: AbortSignal }): AsyncIterable<AttributeChunk>;
```

`readAllRows` projects `id, feature_id, object_type, parents, children, bbox`, the footer's attribute columns and `other_attributes` — never a geometry column — row group by row group, `chunkRows` default 25 000, applying the existing byte estimate per read and the per-buffer signal; each row carries `familyRoot` (R-F) so the app can set `feature_id` without a whole-set pass.

- [ ] **Step 1: failing tests.** On the multigroup fixture: `families` from a manifest with several object tables (keys are basenames, sizes carried, sidecars excluded); `header.tables` row counts sum to `objectsCount`; `readAllRows` yields every row exactly once in row order across chunk boundaries, reads no geometry bytes (counting buffer, compare against a geometry read), respects `chunkRows`, and aborts mid-iteration with `AbortError`.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run — PASS; `pnpm typecheck`. **Step 5:** commit (submodule).

### Task 2: Build a family's DuckDB table from the file, in chunks

**Files:** create `src/insights/familyTables.ts`; modify `src/insights/layerTables.ts` (keying + resolver), `src/insights/layerRows.ts` (a chunk-shaped row builder that takes `familyRoot`); tests under `tests/unit/insights/` and `tests/integration/duckdb/`.

**Interfaces:**

```ts
export const FAMILY_TABLE_CHUNK_ROWS = 25_000;
export function layerTableKey(layerId: string, family: string | null): string; // `${layerId}` when family is null
export function resolveActiveTable(layerId: string): LayerTableInfo | null; // active family's table
export async function buildFamilyTable(input: {
  layerId: string;
  family: string;
  chunks: AsyncIterable<AttributeChunk>;
  columns: Readonly<Record<string, string>>; // explicit DuckDB types, from the footer + FLAT_COLUMN_TYPES
  onProgress?: (rows: number) => void;
  signal: AbortSignal;
}): Promise<LayerTableOutcome>;
```

First chunk: `CREATE OR REPLACE TABLE <t> AS SELECT * FROM read_json_auto('<t>.0.json', columns={…}, …)`. Later chunks: `INSERT INTO <t> BY NAME SELECT * FROM read_json_auto('<t>.N.json', columns={…}, …)`. Explicit full `columns` (a partial map drops the rest — see `layerTables.ts`'s note) so no chunk can drift the schema. Each chunk: `registerBuffer` → statement → `dropBuffer`, then re-check supersede/engine-death; abort leaves no half-built table (reuse `discardHalfBuilt`).

- [ ] **Step 1: failing tests.** Integration (real duckdb-wasm, as `tests/integration/duckdb/layerTables.test.ts` does): three chunks whose rows have a column missing in chunk 2 still produce one table with every row and the declared types; `bbox` is the 6-field DOUBLE struct; `feature_id` comes from `familyRoot`; an aborted build leaves no table; two families of one layer produce two tables and `resolveActiveTable` returns the active one; dropping the layer drops both. Unit: `layerTableKey`/`resolveActiveTable` and every existing consumer path (`mapFilterSync`, `runQueue`'s `getLayerTable`, `useEligibilityContext`, export) resolves as before for a layer with no families.
- [ ] **Step 2–5:** as above; commit (app).

### Task 3: Family state, default Building, and reopening a stream

**Files:** create `src/features/layers/familyStore.ts`; modify `src/features/streaming/openStreamingLayer.ts`, `src/features/cityparquet/{streamDecision,addCityParquetLayer}.ts`, `src/scene/NavaraViewport.tsx` (memo clearing on reopen); tests under `tests/unit/`.

**Interfaces:**

```ts
export interface LayerFamily {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly url: string | null;
  readonly size: number | null;
  readonly rowCount: number | null;
}
// familyStore: families(layerId), enabled(layerId): Set<string>, active(layerId): string | null,
//              setEnabled(layerId, key, on), setActive(layerId, key)
export async function reopenStreamingLayer(
  plugin: StreamPlugin,
  layerId: string,
  source: StreamSource,
): Promise<void>;
// openStreamingLayer(input & { id?: string })
```

Default enabled set (R-D): `["building"]` when a building table exists, else every family. `decideCityParquetMode` carries the families so the decision and the layer agree. Toggling a family: update the store, rebuild the source list, `reopenStreamingLayer`; the layer row, camera, selection, rules, hidden types, query state and tables survive.

- [ ] **Step 1: failing tests.** The Yokohama-shaped manifest opens only `building.parquet` by default; a package without buildings opens all; enabling `bridge` reopens with two urls and keeps layer id, rules, hidden types and the stream store's registration (new handle, same id); disabling the last family is refused (or empties the layer explicitly — pick and test one); a reopen clears the viewport's stream memo so the new handle is re-seeded.
- [ ] **Step 2–5:** as above; commit (app).

### Task 4: The UI — families in Object Visibility, a table per family

**Files:** `src/ui/layers/{LayerTypeToggles,DetailsSection}.tsx` (+ its CSS), `src/ui/table/TablePanel.tsx`, `src/features/query/queryStore.ts`, `src/ui/table/{useLayerQuery,useLayerCounts}.ts`, `src/features/streaming/useTotalObjectCount.ts`, `src/ui/StatusBar.tsx`; tests under `tests/unit/ui/`.

- [ ] **Step 1: failing tests.** The details panel lists every available family with its state (not opened / opening / N loaded) and a table button; the button opens the table panel on that family and builds its table if needed; toggling a family's geometry calls the reopen; the table panel's selector switches tables and keeps per-family query state; the "buildings" view is offered only for a Building-bearing family; the status bar's "N of M" counts opened families; the details copy no longer says the table covers loaded objects only (it is file-backed now) and instead states what is opened vs available.
- [ ] **Step 2–5:** as above, following `docs/ui-consistency.md` (reuse `.layer-types-item`, `ActionIcon`, `--control-height-compact`, 8 px spacing); commit (app).

### Task 5: Validation, docs, review

- [ ] **Step 1:** Node benchmark: build the Yokohama building family's table end to end (884 106 rows) through `readAllRows` + `buildFamilyTable` against real duckdb-wasm — record bytes read, wall time, peak heap and the row count; then `SELECT count(*)`, a filter on `measuredHeight`, and a bbox range query. Log to `/tmp`, copy the summary into `docs/performance/cityparquet-2026-09-21/`.
- [ ] **Step 2:** Browser smoke: open the Yokohama package URL (not the single table), confirm only Building streams, enable `bridge` and confirm the reopen keeps the camera and adds geometry, open a family table from Object Visibility, and confirm the table shows rows for objects that are not resident. Screenshot + console.
- [ ] **Step 3:** Docs: architecture notes (families, the chunked table build and why not httpfs/whole-file, the reopen, the keying, the id-collision limit) and the perf README (Task 1's numbers).
- [ ] **Step 4:** Codex `gpt-6-astra` milestone review; address Critical/Important; push.
