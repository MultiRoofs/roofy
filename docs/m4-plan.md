# M4 Implementation Plan: Statistics and Saved Workspaces

Status: Complete

## Overview

M4 connects the viewer to analysis summaries and reproducible work sessions.
It is broken into four sub-milestones, each independently committable.

## Sub-Milestones

### M4.1: Local Workspace Save and Restore

**Goal**: A user can save their current workspace and restore it later.

**Architecture**:

- Define persistence interfaces in `src/persistence/types.ts`:
  - `ProjectSnapshot` — serializable state bundle (version, camera, datetime, rules, selection mode, model source reference)
  - `ProjectStateStore` — CRUD interface for snapshots
  - `CityModelReference` — how the snapshot refers to the loaded model (file name, URL, or encoding hint)
- Implement `LocalStorageProjectStateStore` in `src/persistence/localStorage.ts`
  - Stores snapshots as JSON in `localStorage` under a namespaced key
  - `save()` generates an ID (crypto.randomUUID), stores snapshot, returns ID
  - `load(id)` retrieves and deserializes
  - `list()` returns summary entries (id, savedAt, label)
  - `remove(id)` deletes
- Add a `ViewState` type capturing camera position/target, datetime, pick mode
- Serialize current state from Zustand stores (solar, rules, selection)
- Add save/restore UI: save button in toolbar, restore dialog on landing page
- On restore: load snapshot → set all store states → if model source is a URL, reload it

**What the snapshot captures**:
- `version`: Schema version string for forward compat
- `savedAt`: ISO 8601 timestamp
- `label`: User-provided or auto-generated name
- `modelRef`: `{ type: "url", url: string } | { type: "file", fileName: string }`
- `viewState`: `{ cameraPosition, cameraTarget, datetime }` 
- `rules`: Full rule array from ruleStore
- `rulesEnabled`: Global toggle
- `pickMode`: "object" | "surface"

**What it does NOT capture** (v1):
- The model data itself (too large for localStorage)
- Selection (transient)
- DuckDB query state

**Tests**: Unit tests for `LocalStorageProjectStateStore` (mock localStorage or use in-memory store), serialization round-trips.

---

### M4.2: Statistics Tab with CityModel-Derived Metrics

**Goal**: A user can see summary statistics for the loaded model and current selection.

**Architecture**:

- Create `src/analytics/computeStats.ts` — pure functions that compute statistics from a `CityModel`:
  - `computeModelStats(model)` → `ModelStats` (object count, total roof area, avg height, avg slope, roof count by orientation band)
  - `computeObjectStats(model, objectId)` → `ObjectStats` (per-building metrics)
- Create `src/analytics/types.ts` — `ModelStats`, `ObjectStats` types
- Add `StatsTab` to the inspector panel (new tab alongside object/surfaces/analysis/rules/solar)
- Two display modes:
  - **Model scope** (no selection): Show full-model aggregate stats
  - **Selection scope** (object selected): Show stats for the selected building + comparison to model average
- Statistics are computed on demand (not cached in a store) since the model is immutable after loading

**Example stats**:
- Building count / surface count
- Total roof area (m²)
- Average building height (m)
- Average roof slope (°)
- Roof count by orientation: N, NE, E, SE, S, SW, W, NW
- Min/max height

**Tests**: Unit tests for `computeModelStats` and `computeObjectStats` against the two-buildings fixture.

---

### M4.3: DuckDB-wasm with cityjson Extension

**Goal**: Validate and integrate DuckDB-wasm with the `cityjson` extension for analytical SQL queries.

**Architecture**:

- Create `src/analytics/duckdb.ts` — singleton DuckDB-wasm instance management:
  - `initDuckDB()` → initialize DuckDB-wasm, load the cityjson extension
  - `loadModelIntoTables(source)` → execute `read_cityjson()` / `read_cityjsonseq()` / `read_flatcitybuf()` to populate tables
  - `queryStats(sql)` → run arbitrary SQL and return results
- Create `building_metrics` and `roof_metrics` views/tables
- Add a DuckDB-powered stats section to the StatsTab (SQL-derived metrics)
- Vite config: add COOP/COEP headers for SharedArrayBuffer (required by DuckDB-wasm)

**Implementation status**: The `duckdb.ts` module is implemented with:
- Lazy singleton initialization via `initDuckDB()` (race-safe Promise caching)
- MVP bundle (no SharedArrayBuffer needed — avoids COOP/COEP header requirement)
- `getDuckDBStatus()` exposes a discriminated union: uninitialized / initializing / ready / failed
- `extensionLoaded` flag tracks whether the cityjson extension loaded successfully
- `queryDuckDB(sql)` returns null if DuckDB is not ready — safe to call anytime
- `loadModelIntoDuckDB(url, encoding)` creates a `city_objects` table from a URL source

**Risk**: The `cityjson` DuckDB extension may not have a WASM build in the community repository. If it fails:
- The module catches the error and sets `extensionLoaded: false`
- The M4.2 pure-function stats remain fully functional as the primary stats path
- Fallback for M5: populate DuckDB tables from in-memory CityModel data instead of using the extension readers

**Tests**: Status tracking and query-guard tests (DuckDB Worker initialization requires browser environment, so full init tests are deferred to browser integration testing).

---

### M4.4: Shareable URL for Lightweight View State

**Goal**: A user can share a URL that reconstructs their current view.

**Architecture**:

- Define `ShareableViewState` type — subset of state that makes sense to share:
  - Camera position and target
  - Datetime (ISO string)
  - Model source URL (if loaded from URL — local files cannot be shared)
  - Active rules (serialized compactly)
  - Pick mode
- Implement `UrlHashShareStateCodec` in `src/persistence/urlShare.ts`:
  - `encode(state) → string` — serialize to a compact JSON, base64url encode, put in URL hash
  - `decode(hash) → ShareableViewState` — reverse the encoding
- Add "Copy share link" button in toolbar (only enabled when model was loaded from URL)
- On app load: check `location.hash` for a share token → decode → load model from URL → apply view state

**Shareability constraints** (from design doc §17):
- If model came from a local file, sharing the URL won't fully work (no model source). Show a warning.
- Keep the hash payload small — omit large data, use compact keys.

**Tests**: Unit tests for encode/decode round-trip, edge cases (missing fields, invalid hash).

---

## Delivery Order

1. **M4.1** (save/restore) — foundational; defines the state shape everything builds on
2. **M4.2** (statistics tab) — high user impact, builds on existing roofMetrics
3. **M4.3** (DuckDB) — experimental, may be deferred if extension doesn't work
4. **M4.4** (URL sharing) — builds on M4.1's state shape

Each sub-milestone gets its own commit. Code review via codex before each commit.

## Handoff Notes

If this work is picked up by another contributor:

- All domain types and interfaces are in `src/persistence/types.ts` and `src/analytics/types.ts`
- The persistence layer uses dependency injection — `ProjectStateStore` is an interface, implementations are swappable
- Statistics are computed as pure functions, not stored in Zustand — they recompute on render from the immutable `CityModel`
- DuckDB integration is isolated in `src/analytics/duckdb.ts` — if it doesn't work, only that file and its consumers need to change
- URL sharing codec is self-contained in `src/persistence/urlShare.ts`
- All existing Zustand stores (solar, rules, selection) have `.getState()` and `.setState()` for imperative access from persistence code
