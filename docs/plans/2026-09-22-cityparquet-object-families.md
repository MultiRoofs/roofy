# CityParquet Object Families and Per-Family Tables (performance task 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CityParquet package is a set of object families (building, bridge, water_body, transportation, vegetation, city_furniture). A streamed layer renders the families the user asked for — Building by default — and every family has its own queryable table that reads straight from the FILE, so the table panel, filters, statistics and export stop depending on what geometry happens to be resident.

**Architecture:** DuckDB itself reads the Parquet. The source is registered once per family (`registerFileURL` for a URL, `registerFileHandle` + `BROWSER_FILEREADER` for a local File) and the family's "table" is a **view** — `CREATE OR REPLACE VIEW <name> AS SELECT <kept columns> FROM read_parquet('<registered>')`. Measured on the real 884 106-row Yokohama building table over HTTP in this build: view creation 26 ms, a filtered count 34 ms, a 100-row page 793 ms, a page at offset 500 000 1.5 s, no materialisation and no measurable JS heap growth; materialising the same 15 columns instead costs 961 ms and 247 MB of DuckDB memory. Families are listed from the manifest; enabling or disabling one reopens the stream under the same layer id.

**Tech Stack:** TypeScript, DuckDB-wasm 1.5.5 (`registerFileURL`/`registerFileHandle` + `read_parquet`), the streaming worker protocol, Vitest (jsdom for the app, Node for plugins), the opt-in real-DuckDB integration suite.

**Spec:** the performance handoff, task 5 ("Default to Building, including associated parts/installations. If buildings are absent, select available families. Other families load when enabled. Opening a family's table can load attributes without rendering its geometry. Add a table button beside each Object Visibility entry. Prefer one DuckDB instance with per-layer/per-family tables or views and a table selector. Keep loading, available, loaded, and visible states explicit.") plus the shipped `docs/plans/2026-09-22-cityparquet-bounded-loading.md`. Reviews that shaped it: `.superpowers/sdd/notes/codex-plan5-review.txt` (first revision) and the spike results above.

## Global Constraints

- `CLAUDE.md` in full: TDD; submodule commits first, then the pointer bump; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit prefixes; never bare `vite`/`vp dev`; tests import from `"vitest"`; `@navaramap/*` only in engine-binding modules; **`src/insights/duckdb.ts` stays the ONLY module importing `@duckdb/duckdb-wasm`** — the new registration calls live there and everything else goes through its exported functions.
- Every task 3 bound stays (`VIEWPORT_FEATURE_BUDGET` 20 000, `MAX_FETCH_READ_ROWS` 60 000, `MAX_FETCH_READ_BYTES` 96 MiB, `WORKER_RETAINED_BYTE_BUDGET` 512 MiB + `retainedBytes` metered, families read/baked/evicted together, unlabelled geometry as the lowest rung).
- **Loading / available / opened / visible stay distinct** (handoff): a family is _available_ (in the manifest), its geometry is _opened_ (streaming) or not, its table is _absent / creating / ready / failed_, and its objects are _visible_ (hidden types, filters). No UI conflates them, and the copy never implies a table covers only resident rows once it is file-backed.
- **Ruling R-B′ (supersedes R-B): the family table is a DuckDB VIEW over `read_parquet` of the registered source.** The earlier plan's chunked `INSERT` machinery is dropped: it existed only because I believed this build had no `registerFileURL`, which the Codex review corrected and the spike disproved. A view has no materialisation cost, cannot drift from the file, needs no JSON encoding, no explicit type map, no whole-set `feature_id` pass (the file has a `feature_id` column) and does not occupy the table FIFO for minutes. Cost if wrong: a 100-row page costs ~0.8 s and a deep page ~1.5 s against ~0.1 s from a materialised table; if paging proves too slow the same code can `CREATE TABLE … AS SELECT` instead — record that as the escape hatch, with the measured numbers.
- **Ruling R-A′ (family identity vs source identity): a family has BOTH.** Its _source identity_ is the resolved URL (or the File handle) — unique, used for registration and caching. Its _family key_ is the manifest asset key when present, else the href basename (`building.parquet` → `building`), used for labels and for the Building default. Two tables that produce the same key (`east/building.parquet`, `west/building.parquet`) keep distinct source identities and get disambiguated labels. Cost if wrong: odd labels for unconventional packages; nothing breaks.
- **Ruling R-C′ (table keying): keyed by `${layerId}::${family}`, and every consumer that OWNS a table records `{layerId, familyKey, tableName}`.** The Codex review showed a resolver alone is not enough: `mapFilterSync` and `runQueue` enumerate table/query keys as layer ids, and a processing run that resolves "the active family" would retarget when the user switches family. So: (a) the registry is keyed by the composite; (b) enumeration sites take the layer id from a parsed key, never the raw key; (c) processing runs, exports and computed columns freeze the triple at start and keep using it.
- **Ruling R-D (default families): Building only when the package has a building table, else every available family.** A single-table source is a one-family package. Static (below-threshold) packages are OUT OF SCOPE and keep today's behaviour — all tables merged into one layer with one table; the architecture notes must say this milestone is streamed-only.
- **Ruling R-E′ (changing families): a serialised, transactional reopen.** `openStreamingLayer` gains an optional `id`; `reopenStreamingLayer` runs under a per-layer generation guard: mark the layer reopening → `plugin.remove(layerId)` (never `handle.delete()` alone, which leaves the registry entry and makes the next open fail on the duplicate id) → open with the new source list → register. A failure leaves the layer row with an explicit `stream: failed` state and a Retry, and the enabled set rolls back. Concurrent toggles are queued per layer; a completion for a superseded generation is disposed (`handle.delete()`), never registered.
- **Ruling R-G (bbox CRS): the family view exposes the file's own `bbox` (EPSG:6697 degrees for PLATEAU), not the layer's projected metres.** The table info records the source CRS, and the tools that need metric bounds (join-by-location, distance-to-nearest, aggregate-per-area) refuse a streamed CityParquet layer with a clear message until task 6 makes the coordinate story coherent. This is not a regression: streamed CityParquet layers are new in task 3. Cost if wrong: those three tools stay unavailable for one more milestone.
- **Resident rebuilds must not fight the file-backed view** (Codex Critical): `layerTableLifecycle`'s resident rebuild, its commit/panel/toolbox triggers and `ExportDialog`'s forced rebuild are disabled for layers whose table is file-backed, including pending debounce timers.
- **Known limits to record:** ids are assumed unique across families (the scene cannot disambiguate a duplicate; the static path already merges first-wins with a warning); map filtering stays disabled for all streaming layers; `hiddenTypes` remains a CityJSON-type list, so a family's types can still be individually hidden (a family is opened, a type is visible — reported separately).

## File Structure

| File                                                                                                                                                   | Responsibility                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `navara-cityparquet/src/packageAssembly.ts`                                                                                                            | `CityParquetManifest.families: {key, href, size}[]` (R-A′), asset key preferred over basename.                                                                                                                                                                                                                                                   |
| `navara-cityparquet/src/streamReader.ts`                                                                                                               | `header.tables: {name, rowCount}[]` so counts can be per family.                                                                                                                                                                                                                                                                                 |
| `src/insights/duckdb.ts`                                                                                                                               | `registerParquetUrl(name, url)` / `registerParquetFile(name, file)` / `dropRegisteredFile(name)` — the only place touching duckdb-wasm's registration API.                                                                                                                                                                                       |
| `src/insights/familyViews.ts` (new)                                                                                                                    | `ensureFamilyView({layerId, family, source})`: register (once per source identity) → `DESCRIBE SELECT * FROM read_parquet(…)` → drop geometry/material/texture/template/address columns (`columnKind.isDroppedColumn`, extended for a bare `geometry`) → `CREATE OR REPLACE VIEW`; returns a `LayerTableInfo` adopted through `adoptLayerTable`. |
| `src/insights/layerTables.ts`                                                                                                                          | Composite keying + `parseTableKey`, `resolveActiveTable(layerId)`, `dropLayerTables(layerId)`; `LayerTableInfo` gains `fileBacked: boolean`, `familyKey`, `sourceCrs`.                                                                                                                                                                           |
| `src/features/layers/layerTableLifecycle.ts`                                                                                                           | Skip resident rebuilds for file-backed tables (Codex Critical); drop every family's view with the layer.                                                                                                                                                                                                                                         |
| `src/features/layers/familyStore.ts` (new)                                                                                                             | Per layer: available families, enabled set, active family, per-family stream/table state, the reopen queue and generation.                                                                                                                                                                                                                       |
| `src/features/streaming/openStreamingLayer.ts`                                                                                                         | Optional `id`; `reopenStreamingLayer` (R-E′) with rollback and a failed/retry state.                                                                                                                                                                                                                                                             |
| `src/features/cityparquet/{streamDecision,addCityParquetLayer}.ts`                                                                                     | Carry families (key, href, url/File, size) into the layer; open only the enabled ones.                                                                                                                                                                                                                                                           |
| `src/ui/layers/{LayerTypeToggles,DetailsSection}.tsx`                                                                                                  | A Families block: per family a geometry toggle, a state chip (available / opening / N loaded / failed+retry) and a table button.                                                                                                                                                                                                                 |
| `src/ui/table/{TablePanel,useLayerQuery,useLayerCounts}.tsx?`, `src/features/query/queryStore.ts`                                                      | Family selector; query state per composite key; the "buildings" view offered only for Building-bearing families.                                                                                                                                                                                                                                 |
| `src/features/processing/runQueue.ts`, `src/ui/table/ExportDialog.tsx`, `src/features/query/mapFilterSync.ts`, `src/insights/useEligibilityContext.ts` | Enumerate by parsed layer id; freeze `{layerId, familyKey, tableName}` where they own a table (R-C′).                                                                                                                                                                                                                                            |
| `src/features/streaming/useTotalObjectCount.ts`, `src/ui/StatusBar.tsx`                                                                                | "N of M" counts the OPENED families; the details panel states opened vs available.                                                                                                                                                                                                                                                               |

---

### Task 1: Manifest families and per-table counts

**Files:** `navara-cityparquet/src/{packageAssembly,streamReader}.ts` + tests.
**Interfaces:** `CityParquetFamily {key, href, size}`; `CityParquetManifest.families`; `CityParquetStreamHeader.tables: {name, rowCount}[]`; the adapter must copy the new header fields through (`cityParquetSourceAdapter` rebuilds the header — the Codex review flagged it drops unknown fields).

- [ ] **Step 1: failing tests** — asset key preferred over basename; duplicate keys keep distinct hrefs; sidecars excluded; sizes carried; `header.tables` row counts sum to `objectsCount`; the adapter's posted header carries `tables`.
- [ ] **Steps 2–5:** red → implement → green → commit (submodule).

### Task 2: Register a Parquet source and create a family view

**Files:** `src/insights/duckdb.ts`, `src/insights/familyViews.ts` (new), `src/insights/columnKind.ts` (drop a bare `geometry`), `src/insights/layerTables.ts` (composite keys, `fileBacked`); tests under `tests/unit/insights/` plus a real-DuckDB case in `tests/integration/duckdb/`.

**Interfaces:**

```ts
// duckdb.ts (the only duckdb-wasm importer)
export async function registerParquetUrl(
  name: string,
  url: string,
): Promise<Outcome>;
export async function registerParquetFile(
  name: string,
  file: File,
): Promise<Outcome>;
export function dropRegisteredFile(name: string): Promise<void>;
// familyViews.ts
export async function ensureFamilyView(input: {
  layerId: string;
  family: string;
  source: { url: string } | { file: File };
  sourceCrs: string | null;
}): Promise<LayerTableOutcome>;
export function layerTableKey(layerId: string, family: string | null): string;
export function parseTableKey(key: string): {
  layerId: string;
  family: string | null;
};
```

The view keeps identity + attribute columns and drops geometry/properties/material/texture/template/address. Registration is idempotent per source identity; dropping a layer drops its views and registrations.

- [ ] **Step 1: failing tests.** Integration (opt-in, real duckdb-wasm): a view over the two-buildings fixture parquet has the expected columns and row count, `SELECT … WHERE` works, geometry columns are absent, `CREATE OR REPLACE` is idempotent, and dropping removes view + registration. Unit: key round-trip; `resolveActiveTable`; existing single-table consumers unchanged for a layer with no families.
- [ ] **Steps 2–5:** red → implement → green → commit (app).

### Task 3: Families in the layer, defaults, and a transactional reopen

**Files:** `src/features/layers/familyStore.ts` (new), `src/features/streaming/openStreamingLayer.ts`, `src/features/cityparquet/{streamDecision,addCityParquetLayer}.ts`, `src/scene/NavaraViewport.tsx` (handle-generation aware reconciliation), `src/features/layers/layerTableLifecycle.ts` (skip resident rebuilds for file-backed tables); tests under `tests/unit/`.

- [ ] **Step 1: failing tests.** Building-only default; no-building package opens all; enabling a family reopens with both sources and keeps layer id, camera, rules, hidden types, selection and tables; a failed reopen rolls the enabled set back and shows `failed` + Retry; two rapid toggles serialise and leak no worker (the superseded completion is disposed); a file-backed table is never rebuilt from residents (including after a commit, panel open or Export).
- [ ] **Steps 2–5:** red → implement → green → commit (app).

### Task 4: The UI — families, per-family tables, honest counts

**Files:** `src/ui/layers/{LayerTypeToggles,DetailsSection}.tsx` (+ CSS), `src/ui/table/{TablePanel,useLayerQuery,useLayerCounts}`, `src/features/query/queryStore.ts`, `src/features/streaming/useTotalObjectCount.ts`, `src/ui/StatusBar.tsx`, plus the ownership fixes in `runQueue`/`ExportDialog`/`mapFilterSync`/`useEligibilityContext` (R-C′); tests under `tests/unit/ui/` and `tests/unit/features/`.

- [ ] **Step 1: failing tests.** The families block lists every available family with its state and a table button; the button creates the view if needed and focuses the table panel on it; a family's table shows rows for objects that are NOT resident; switching family keeps per-family query state; a running processing job keeps its frozen table after a family switch; "N of M" counts opened families; the copy states opened vs available and no longer says the table covers loaded objects only.
- [ ] **Steps 2–5:** red → implement → green → commit (app).

### Task 5: Validation, docs, review

- [ ] **Step 1: browser validation on the real package** (`https://cityparquet.open3d.city/data/plateau/yokohama-shi/`): only Building streams; open the Building family's table and page/filter it while objects outside the viewport are absent from the scene; enable `bridge` and confirm the reopen keeps the camera; open the bridge table without its geometry ever being visible; record timings, JS heap, DuckDB memory (`duckdb_memory()`), console and a screenshot.
- [ ] **Step 2: local-file package** (a folder of the Nishitokyo package, forced over the threshold or with the threshold lowered in a test): `registerFileHandle` path works, views build, disabling a family and re-enabling it works without re-picking files.
- [ ] **Step 3: docs** — architecture notes (families, view-over-`read_parquet` with the spike numbers and the materialisation escape hatch, the reopen protocol, composite keys and frozen ownership, the bbox-CRS ruling and which tools are refused, streamed-only scope) and the perf README.
- [ ] **Step 4: Codex `gpt-6-astra` milestone review**; address Critical/Important; push.
