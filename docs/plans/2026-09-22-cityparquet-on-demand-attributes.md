# CityParquet On-Demand Attributes (performance task 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A streamed CityParquet layer reads only the columns it needs to draw and style the viewport; everything else about an object arrives when the user clicks it, from that object's own row, without re-reading geometry.

**Architecture:** The stream reader already knows every resident object's `StreamRow {table,row}` (task 3). The worker stops projecting the footer's attribute columns into a fetch, keeping identity (`id, feature_id, object_type, parents, children, bbox`), geometry ≤ the requested rung and the columns the active rules reference; it keeps `id → StreamRow` for resident objects. A new `attributes` request reads one object's attribute columns with `rowStart = row, rowEnd = row + 1, useOffsetIndex: true` and answers the main thread, which caches the result per layer in a bounded LRU keyed by object id plus source identity. The inspector renders the object immediately (selection and highlight are id-only) and fills the attribute section when the answer lands.

**Tech Stack:** TypeScript, the existing streaming worker protocol, vendored hyparquet row-range reads, Vitest (Node for plugins, jsdom for the app).

**Spec:** the performance handoff (task 4: "on-demand attributes for clicked objects"; "Retain a compact mapping from picked object to source file, row group, and row position. Highlight immediately on click. Fetch only the required attribute columns from the known source location. Use a bounded cache and avoid redundant requests. Ensure source identity/version remains valid for cached locations.") and `docs/plans/2026-09-22-cityparquet-bounded-loading.md` (task 3, shipped).

## Global Constraints

- Follow `CLAUDE.md`: TDD red-green-refactor; submodule-first commits, then the pointer bump; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit prefixes; never bare `vite`/`vp dev`; test files import from `"vitest"`; `@navaramap/*` only in the named engine-binding modules; worker graphs import only navara-core, navara-cityparquet, their own package, proj4, vendored hyparquet and hyparquet-compressors.
- Every bound task 3 established stays: probe `readCost` vs `VIEWPORT_FEATURE_BUDGET = 20000`; `MAX_FETCH_READ_ROWS = 60_000` and `MAX_FETCH_READ_BYTES = 96 MiB` refusals via `code: "budget"`; `WORKER_RETAINED_BYTE_BUDGET = 512 MiB` LRU; `retainedBytes` metered on the main thread; families read, baked and evicted together; unlabelled geometry is the lowest rung.
- **An attribute read is bounded too:** one row, attribute columns only, `useOffsetIndex`, and the same byte estimate the fetch path uses — refuse (and report) rather than read unbounded bytes.
- **Nothing may become silently unavailable.** Whatever a streamed layer's DuckDB table, rules, filters and legend showed before this change must either still be there or be explicitly reported as "not loaded yet" in the UI. See the ruling below on the resident table.
- **Ruling (transport): use the CityParquet reader, not DuckDB httpfs.** The handoff asks for a benchmark of DuckDB-wasm `read_parquet` over an HTTP-registered file versus a worker row-location read. This plan chooses the worker reader without that benchmark: it is already range-bounded, cancellable, byte-estimated and works identically for `{url}` and local `{blob}` sources, whereas duckdb-wasm's HTTP path is unverified in this build, would not serve local files, and would add a second reader for the same bytes. Cost if wrong: a later task may still add a DuckDB path for BULK family scans (task 5), where a columnar engine may beat row reads; this ruling only settles the single-object lookup.
- **Ruling (resident table): a streamed CityParquet layer's DuckDB table carries identity + rule-referenced columns until task 5.** Task 3 already ties that table to resident rows; this task narrows its columns. The UI must say so (see Task 4 below), and task 5 replaces the whole arrangement with per-family tables read from the file. Cost if wrong: for one milestone, a streamed layer's table panel and attribute filters see fewer columns than the file has.

## File Structure

| File                                                         | Responsibility                                                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navara-cityparquet/src/streamReader.ts`                     | `readAttributes(rows, signal)`: one batch read of the attribute columns for a small set of `StreamRow`s (grouped by table + row group, each row its own range), with the existing byte estimate applied. |
| `navara-cityparquet/src/streamReader.ts` (open)              | `header.attributeColumns: string[]` — the footer's attribute column names, so the app can show what exists but is not loaded.                                                                            |
| `navara-flatcitybuf/src/streamSourceAdapter.ts`              | Adapter gains `attributes?(ids: string[], signal): Promise<Record<string, Record<string, unknown>>>` and `ruleColumns?(rules): string[]` (formats without either keep today's behaviour).                |
| `navara-flatcitybuf/src/cityParquetSourceAdapter.ts`         | Projects identity + geometry + rule columns on `select`; keeps `id → StreamRow` for objects it emitted; implements `attributes`.                                                                         |
| `navara-flatcitybuf/src/streamWorkerCore.ts`                 | `attributes` request handling: resolve ids through the adapter, answer `attributeData`; unknown id → `code:"not-found"`.                                                                                 |
| `navara-flatcitybuf/src/workerProtocol.ts`                   | `{type:"attributes", id, objectIds}` → `{type:"attributeData", id, attributes}`; `ResidentObjectRecord.attributesComplete: boolean`.                                                                     |
| `navara-flatcitybuf/src/streamLayer.ts`                      | `fetchAttributes(objectId)` with an in-flight map, a bounded LRU (`ATTRIBUTE_CACHE_LIMIT = 512`) keyed by object id, cleared on `close`/reopen (source identity changes with the stream).                |
| `src/features/streaming/useObjectAttributes.ts` (new)        | Hook returning `{status, attributes}` where status is `complete`, `loading` or `error`, for a selected object of a streaming layer; cancels on change; never blocks the render of what is already known. |
| `src/ui/details/DetailsPanel.tsx` + `LayerAttributesSection` | Render known attributes at once; show a compact "Loading attributes…" row while the rest arrives, and an error row with a retry when it fails.                                                           |
| `src/ui/layers/DetailsSection.tsx`                           | One line stating that a streamed layer's table holds identity and styling columns until an object is opened (the ruling above).                                                                          |

## Task 1: Measure first — what does deferring attributes actually save?

**Files:** `scripts/performance/cityparquet-stream.test.ts` (extend), log to `/tmp` by default.

- [ ] **Step 1:** add a measurement phase to the benchmark: for the 1 km Yokohama viewport, read the same family ranges three ways — (a) today's projection (identity + attributes + geometry ≤ rung), (b) identity + geometry only, (c) attribute columns only for the same rows — recording bytes, ms and the decoded record heap for each.
- [ ] **Step 2:** run it once against `/data2/hideba/roofy-perf-data/yokohama-building.parquet` and record the numbers in the report and in `docs/performance/cityparquet-2026-09-21/README.md`.
- [ ] **Step 3: decide and record.** If (c) is under 5 % of (a)'s bytes AND the record heap difference is under 10 %, deferral buys little for this dataset: implement it anyway (the handoff asks for it, and wide attribute tables exist), but say so plainly in the architecture notes and skip any further optimisation. If it is more, note the saving. Either way the rest of the plan proceeds — this step exists so the docs never claim a saving that was not measured.

## Task 2: Reader — one-row attribute reads and the column list

**Files:** `navara-cityparquet/src/streamReader.ts`; tests `navara-cityparquet/tests/streamReader.test.ts`.

**Interfaces:**

```ts
readonly header: { …task 3 fields…; attributeColumns: ReadonlyArray<string> };
readAttributes(rows: ReadonlyArray<StreamRow>, signal: AbortSignal): Promise<Map<string, Record<string, unknown>>>; // keyed by object id
```

Reads `id` plus the footer's attribute columns and `other_attributes` (never a geometry column), one range per row, grouped per table, `useOffsetIndex: true`, the byte estimate applied (refuse above the budget with `code:"budget"`), the buffer's signal set per call, abort checked between rows.

- [ ] **Step 1: Failing tests.** On the multigroup fixture: `readAttributes` for three known rows returns their attributes and nothing else (no `surfaces`, no geometry bytes read — assert with the counting buffer that bytes read are far below a geometry read of the same rows); an unknown row (out of range) throws; an aborted signal rejects with `AbortError`; `header.attributeColumns` lists the footer's columns.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. **Step 5:** Commit (submodule).

## Task 3: Worker — project less, answer `attributes`

**Files:** `navara-flatcitybuf/src/{workerProtocol,streamSourceAdapter,cityParquetSourceAdapter,streamWorkerCore}.ts`; tests in the same package.

**Interfaces:** as in the File Structure table. `ruleColumns(rules)` extracts the attribute names a rule set references (reuse whatever core's rule evaluation already exposes; if nothing does, add a small pure helper in navara-core with its own tests — rules are `{attribute, op, value}`-shaped). The fetch projection becomes identity + geometry ≤ rung + `ruleColumns(msg.rules)`; a rules change already forces a refetch (`setRules` → swap), so a rule that names a new column gets its data.

- [ ] **Step 1: Failing tests.** (a) a fetch with no rules reads none of the footer's attribute columns (counting buffer) and its records carry `attributesComplete: false` with only identity attributes; (b) a fetch whose rules reference `measuredHeight` reads that column and the rule colours are identical to a full-projection bake; (c) `attributes` for a resident id answers its full attributes; (d) `attributes` for an unknown id answers `code:"not-found"`; (e) an `attributes` request for an id whose cell the worker LRU has dropped still answers (the row map outlives the cell — keep a bounded id → StreamRow map, `ATTRIBUTE_ROW_MAP_LIMIT = 200_000`, and say what happens past it).
- [ ] **Step 2–5:** as above; commit (submodule).

## Task 4: App — fill the inspector when the answer lands

**Files:** `src/features/streaming/useObjectAttributes.ts` (new), `src/ui/details/DetailsPanel.tsx`, `src/ui/details/useResolvedSubject.ts`, `src/ui/layers/DetailsSection.tsx`, `src/features/streaming/streamStore.ts` (expose `handle.fetchAttributes`); tests under `tests/unit/`.

- [ ] **Step 1: Failing tests.** Selecting an object of a streamed CityParquet layer renders its identity immediately and shows a loading row for attributes; when the fetch resolves the attributes appear; a second selection of the same object makes no second request (cache); an error shows a retry that re-requests; switching selection cancels the previous request's effect (no state write after unmount). `useResolvedBuilding`'s existing `loading` (family members missing) stays distinct from attribute loading.
- [ ] **Step 2–5:** as above; commit (app, with the submodule pointer bump).

## Task 5: Validation, docs, review

- [ ] **Step 1:** Node benchmark: click-path latency for a single object (`readAttributes` for one row) over the local file and, behind `AUDIT_HTTP=1`, the real URL; record bytes and ms.
- [ ] **Step 2:** Browser smoke (recipe in `docs/performance/cityparquet-2026-09-21/README.md` and the session's `cdp-smoke.mjs`): stream Yokohama, click a building, confirm the inspector shows it at once and the attributes fill in; record the console and a screenshot.
- [ ] **Step 3:** Docs: extend the CityParquet section of `docs/architecture-notes.md` (what is projected, what is deferred, the row map and its limit, the cache and its key, the resident-table ruling) and the perf README (Task 1's measurement + the click latency).
- [ ] **Step 4:** Codex `gpt-6-astra` milestone review of the whole range; address Critical/Important; push.
