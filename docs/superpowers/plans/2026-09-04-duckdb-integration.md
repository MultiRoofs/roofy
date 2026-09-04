# DuckDB-wasm Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DuckDB-wasm a first-class part of the viewer — one table per city layer, a real query surface (paging, sort, structured filter) in the table panel, a toggle that applies the filter to the 3D map, and an export dialog that writes the layer or its filtered subset to Parquet/CSV/JSON or a CityParquet package.

**Architecture:** `analytics/duckdb.ts` stays the ONLY importer of `@duckdb/duckdb-wasm` and grows per-extension status, `runQuery`, and VFS primitives. `analytics/layerTables.ts` owns a registry plus one async FIFO queue that turns a layer's bytes (reader-backed) or its parsed objects (flat fallback) into a `layer_<n>` table; `features/query/queryStore.ts` holds the per-layer filter/sort/page; `analytics/sql.ts` compiles both into SQL strings that are pure functions of their inputs; `ui/table/*` renders the result; `layerStore.visibleObjectIds` + a new plugin setter apply the filter to geometry; `analytics/export.ts` writes files back out through the same engine.

**Tech Stack:** `@duckdb/duckdb-wasm@1.33.1-dev64.0` (DuckDB 1.5.5, `wasm_eh`), the `cityjson` community extension v0.4.0, React 19 + Zustand, Vitest + @testing-library/react, `fflate` for zipping, and the `@cityjson/navara-cityjson` plugin submodule for the geometry filter.

**Spec:** `docs/superpowers/specs/2026-09-04-duckdb-integration-design.md`

## Global Constraints

- `@duckdb/duckdb-wasm` is pinned EXACTLY to `1.33.1-dev64.0`. Never `latest` (dev57 / DuckDB 1.5.4) — its community slot serves a stale 4-function `cityjson` and a `three_d` that breaks `LOAD spatial`, silently.
- `src/analytics/duckdb.ts` is the ONLY module UNDER `src/` that may `import … from "@duckdb/duckdb-wasm"`. `layerTables`, `export`, `sql` and every UI module take the engine through that module's exported functions so they can be mocked with `vi.mock`. (The opt-in integration harness under `tests/integration/duckdb/` loads the NODE bindings directly — a different entry point, and the reason the rule is scoped to `src/`.)
- `COPY … TO (FORMAT cityjson | cityjsonseq | flatcitybuf)` writes **0 bytes** in wasm, silently. Those three formats are NEVER offered in the export dialog.
- `cityparquet_read` and `cityjson_geoparquet_geo` are unusable in wasm. Never call them.
- A `dropFile`d VFS name still resolves to ZERO BYTES and fails with a misleading JSON parse error. VFS names are minted from a module counter and **never reused**.
- **A MISSING VFS name reads back as ONE GARBAGE BYTE with NO error** (`copyFileToBuffer` and `read_blob` alike); a genuinely empty file reads 0 bytes. Every read-back is therefore validated BY CONTENT — `PAR1` magic for Parquet, `JSON.parse` for JSON, a newline-terminated header line for CSV — before it is offered as a download.
- `spatial` does NOT autoload in wasm and is a CORE extension, not a community one: `INSTALL spatial` (no `FROM community`) then `LOAD spatial`, ~5 s / 23.6 MB. `cityjson` and `three_d` come `FROM community`.
- `HUGEINT` and `DECIMAL` cells arrive through Arrow as STRINGS, which is why they classify `castText` (`::VARCHAR` makes every such column uniform) and why no formatter may assume a number.
- `globFiles` works in the browser but lists names that were never created, so it is used for cleanup only — never to discover what a write produced.
- Reader schema (identical for `read_cityjson` / `read_cityjsonseq` / `read_flatcitybuf` on 1.5.5): `id, feature_id, object_type, parents VARCHAR[], children VARCHAR[], children_roles VARCHAR[], address STRUCT[], bbox STRUCT, geometry_lod<L> BLOB, geometry_properties_lod<L> STRUCT, material_lod<L>, texture_lod<L>, template STRUCT, other`, then one inferred column per attribute. `id` IS `CityObject.id`; `feature_id` is the root object of the feature. Absent `parents`/`children` are SQL NULL, never `[]`.
- Every new export from `src/analytics/duckdb.ts` must reach the test files that `vi.mock` it. Seven exist today; Task 4 brings SIX of them up to the new surface — `tests/unit/app/appCatalogEntry.test.tsx`, `tests/unit/app/appRestoreShare.test.tsx`, `tests/unit/app/appEngineBoot.test.tsx`, `tests/unit/app/appCityParquetLayers.test.tsx`, `tests/unit/features/stac/stacItems.test.ts`, `tests/unit/analytics/duckdbStatus.test.ts` — and DELETES the seventh, `tests/unit/analytics/streamingDuckdb.test.ts`, whose subject is removed.
- Plugin (submodule) changes go on a `duckdb-integration` branch cut from the parent's current pin `947c980`, are pushed, and the parent gitlink points at that branch's head. NEVER push onto the plugin repo's `main` from the detached pin.
- Snapshot schema stays at **v3**. Filter, sort, page, sync-to-map and `visibleObjectIds` are SESSION state and are never persisted.
- Tests import from `"vitest"`, never `"vite-plus/test"`. React tests use `@testing-library/react`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
  ```
- The pre-commit hook runs `vp check --fix` in the parent repo. The submodule has no hooks — run its checks by hand.
- After ANY app-side `npm install`, re-run `pnpm install` inside `packages/cityjson-navara-plugins`.
- Type-check with `npx tsc -b --noEmit` (plain `tsc --noEmit` is a no-op here).

---

## File Structure

**New — engine-free pure modules**

- `src/analytics/columnKind.ts` — the DuckDB column vocabulary: `ColumnKind`, `ColumnInfo`, `classifyColumnType`, `isTextColumn`, `isDroppedColumn`, `lodColumnSuffix`, `lodsFromColumnNames`.
- `src/domain/citymodel/featureId.ts` — `rootFeatureId`, the cycle-safe walk up `parents` that gives the flat fallback the same `feature_id` the reader produces.
- `src/analytics/cityGmlModule.ts` — `CityGmlModule`, `cityGmlModuleOf`, `groupTypesByModule`.
- `src/features/query/types.ts` — `FilterOp`, `FilterValue`, `FilterCondition`, `FilterGroup`, `LayerQuery`, `PageSize`, `PAGE_SIZES`, `EMPTY_FILTER`, `DEFAULT_LAYER_QUERY`, `isNullaryOp`.
- `src/analytics/sql.ts` — every SQL string this feature emits, as pure functions.
- `src/analytics/layerRows.ts` — the flat-fallback row builders (`CityModel` / `ResidentObjectRecord` → rows → JSON bytes).

**New — stateful**

- `src/features/query/queryStore.ts` — Zustand, `Record<layerId, LayerQuery>`, session only.
- `src/analytics/layerTables.ts` — registry + FIFO queue + `useLayerTableStore`.
- `src/features/layers/addCityLayer.ts` — `addLayer` + `enqueueLayerTable` in one call, used by every static add site.
- `src/features/layers/layerTableLifecycle.ts` — `installLayerTableLifecycle()`: store subscriptions for drops, streaming re-enqueues and the panel gate.
- `src/features/query/mapFilterSync.ts` — `syncFilterToMap(layerId)`.
- `src/analytics/export.ts` — `runExport`.
- `src/platform/download.ts` — `downloadBlob` / `downloadText`, factored out of `RuleBuilderTab`.

**New — UI**

- `src/ui/table/useLayerQuery.ts`, `src/ui/table/FilterBar.tsx`, `src/ui/table/DataGrid.tsx`, `src/ui/table/Pagination.tsx`, `src/ui/table/ExportDialog.tsx`.

**Modified**

- `src/analytics/duckdb.ts` — per-extension status, `ensureExtension`, `runQuery`/`ddl`/`formatDuckDBError`, `registerBuffer`/`dropBuffer`/`readFile`, init retry. Loses `shouldUseSourceUrlPath`, `loadModelIntoDuckDB`, `loadCityModelFromMemory`, `loadResidentObjectsIntoDuckDB`.
- `src/ui/StatusBar.tsx` — new labels + extension tooltip.
- `src/app/App.tsx` — loses the DuckDB load effect and the `duckdbModelLoaded` / `duckdbTableLoaded` flags; installs the layer-table lifecycle; routes its four direct `addLayer` calls through `addCityLayer`.
- `src/domain/citymodel/loadCityModel.ts` — `loadFromUrl` returns `LoadedModel`; new `fetchModelBytes`.
- `src/features/layers/useLayerFileLoader.ts` — hands bytes/model to `addCityLayer`.
- `src/features/layers/layerStore.ts` — `Layer.visibleObjectIds` + `setVisibleObjectIds`.
- `src/scene/handleSync.ts` — pushes `visibleObjectIds`.
- `src/ui/table/TablePanel.tsx` — split into shell + the four new components, DuckDB-only.
- `src/ui/inspector/StatsTab.tsx`, `src/ui/inspector/InspectorPanel.tsx` — stats read the per-layer table.
- `src/ui/inspector/RuleBuilderTab.tsx` — uses `downloadText`.
- `src/app/app.css` — table panel rework.

**Submodule (`packages/cityjson-navara-plugins`)**

- `packages/navara-core/src/geometry/buildCityMeshArrays.ts` — 7th parameter `visibleObjectIds`.
- `packages/navara-cityjson/src/cityModelMesh.ts` / `types.ts` / `cityModelRegistry.ts` — `setVisibleObjectIds`.

---

## Task 1: Dependency bump and lockfile regeneration

**Files:**

- Modify: `package-lock.json` (regenerated)
- Modify: `packages/cityjson-navara-plugins/pnpm-lock.yaml` (regenerated if it moves)

**Interfaces:**

- Consumes: nothing.
- Produces: `@duckdb/duckdb-wasm@1.33.1-dev64.0` installed (DuckDB 1.5.5) with `apache-arrow@17.0.0`; a `package-lock.json` that `npm ci` accepts.

- [ ] **Step 1: Confirm the pinned version in `package.json` is exact**

Run: `grep -n '"@duckdb/duckdb-wasm"' package.json`
Expected: `"@duckdb/duckdb-wasm": "1.33.1-dev64.0",` — an exact pin, no `^` or `~`. If a range crept in, edit it to the exact string.

- [ ] **Step 2: Regenerate the lockfile**

```bash
npm install
```

- [ ] **Step 3: Verify the installed engine really is 1.5.5-era**

```bash
node -e "console.log(require('./node_modules/@duckdb/duckdb-wasm/package.json').version, require('./node_modules/apache-arrow/package.json').version)"
```

Expected: `1.33.1-dev64.0 17.0.0`

- [ ] **Step 4: Restore the submodule's pnpm links**

```bash
cd packages/cityjson-navara-plugins && pnpm install
git -C packages/cityjson-navara-plugins status --short
```

(npm's install above rewrote the linked packages' `node_modules`; without this the submodule's workspace links are gone.)

If `pnpm-lock.yaml` moved, it must be dealt with INSIDE the submodule before
anything else — a dirty submodule turns the parent's gitlink into a
`-dirty` hash that nobody else can check out:

```bash
# Either commit it there (it is a real change, on the plugin branch)…
git -C packages/cityjson-navara-plugins add pnpm-lock.yaml
# …or discard it, if the diff is only the churn of a local resolver:
git -C packages/cityjson-navara-plugins checkout -- pnpm-lock.yaml
```

Never leave the submodule with uncommitted changes at the end of this task.

- [ ] **Step 5: Type-check both repos**

```bash
npx tsc -b --noEmit
cd packages/cityjson-navara-plugins && pnpm typecheck
```

Expected: both clean.

- [ ] **Step 6: Run the existing test suite as a baseline**

Run: `npx vitest run`
Expected: 0 failed files. Record the pass count — later tasks compare against it.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: pin duckdb-wasm 1.33.1-dev64.0 and regenerate the lockfile

DuckDB 1.5.5 is the first wasm build the community repo serves a cityjson
artifact for; 1.4.4 (dev20) had none, so INSTALL cityjson FROM community
always failed and the app silently ran on its fallback.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 2: DuckDB engine — per-extension status, runQuery, VFS primitives

**Files:**

- Modify: `src/analytics/duckdb.ts`
- Test: `tests/unit/analytics/duckdbEngine.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces (the module's new public surface — every later task imports from here):

```ts
export type ExtensionName = "cityjson" | "spatial" | "three_d";

export type ExtensionStatus =
  | { readonly state: "unloaded" | "loading" | "loaded" }
  | { readonly state: "failed"; readonly error: string };

export interface LoadedExtension {
  readonly name: string;
  readonly version: string;
}

export type DuckDBStatus =
  | { readonly state: "uninitialized" }
  | { readonly state: "initializing" }
  | {
      readonly state: "ready";
      readonly extensions: Readonly<Record<ExtensionName, ExtensionStatus>>;
      readonly loadedExtensions: ReadonlyArray<LoadedExtension>;
      /** `PRAGMA platform` — "wasm_eh" or "wasm_mvp". The two get DIFFERENT
       *  extension artefacts, so it belongs in any bug report. */
      readonly platform: string | null;
    }
  | { readonly state: "failed"; readonly error: string };

export interface QueryResult {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
}

export type QueryOutcome =
  | {
      readonly ok: true;
      readonly columns: string[];
      readonly rows: Record<string, unknown>[];
    }
  | { readonly ok: false; readonly message: string };

export function getDuckDBStatus(): DuckDBStatus;
export function isExtensionLoaded(name: ExtensionName): boolean;
export function initDuckDB(): Promise<void>;
export function ensureExtension(name: ExtensionName): Promise<boolean>;
export function formatDuckDBError(error: unknown): string;
export function runQuery(sql: string): Promise<QueryOutcome>;
export function ddl(sql: string): Promise<QueryOutcome>;
export function registerBuffer(
  name: string,
  bytes: Uint8Array,
): Promise<boolean>;
export function dropBuffer(name: string): Promise<void>;
export function readFile(name: string): Promise<Uint8Array | null>;
// unchanged, kept for StatsTab's legacy path until Task 20 and for stacItems:
export function queryDuckDB(sql: string): Promise<QueryResult | null>;
export function queryParquetBuffer(
  fileName: string,
  buffer: Uint8Array,
  sql: string,
): Promise<QueryResult | null>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/duckdbEngine.test.ts`:

```ts
/**
 * The engine module's contracts that hold WITHOUT a live DuckDB: the error
 * formatter, and every entry point's "not initialized" answer. Anything that
 * needs a real database is covered by the opt-in integration suite.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ddl,
  dropBuffer,
  ensureExtension,
  formatDuckDBError,
  getDuckDBStatus,
  isExtensionLoaded,
  readFile,
  registerBuffer,
  runQuery,
} from "../../../src/analytics/duckdb";

describe("formatDuckDBError", () => {
  it("keeps the first useful line and strips the LINE/caret block", () => {
    const raw = new Error(
      'Binder Error: Referenced column "nope" not found!\n\nLINE 1: SELECT "nope" FROM t\n               ^',
    );
    expect(formatDuckDBError(raw)).toBe(
      'Binder Error: Referenced column "nope" not found!',
    );
  });

  it("keeps a multi-sentence first paragraph intact", () => {
    const raw = new Error(
      "Binder Error: LOD '1.2' not found in file. Available LODs: 2.2\n\nLINE 1: SELECT 1\n        ^",
    );
    expect(formatDuckDBError(raw)).toBe(
      "Binder Error: LOD '1.2' not found in file. Available LODs: 2.2",
    );
  });

  it("falls back to a sentence for an empty message", () => {
    expect(formatDuckDBError(new Error(""))).toBe("The query failed.");
  });

  it("stringifies a non-Error", () => {
    expect(formatDuckDBError("boom")).toBe("boom");
  });
});

describe("init failure", () => {
  it("terminates the Worker it created and lets a retry re-run init", async () => {
    // A fresh module registry, because `initDuckDB` memoises and this suite's
    // other tests share the singleton.
    vi.resetModules();

    const terminate = vi.fn();
    let instantiateCalls = 0;
    vi.doMock("@duckdb/duckdb-wasm", () => ({
      selectBundle: vi.fn(async () => ({
        mainModule: "m.wasm",
        mainWorker: "https://cdn.test/w.js",
      })),
      getJsDelivrBundles: vi.fn(() => ({})),
      ConsoleLogger: class {},
      LogLevel: { WARNING: 2 },
      AsyncDuckDB: class {
        async instantiate() {
          instantiateCalls += 1;
          throw new Error("wasm refused");
        }
      },
    }));
    class FakeWorker {
      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => {},
    });

    const engine = await import("../../../src/analytics/duckdb");
    await engine.initDuckDB();

    expect(engine.getDuckDBStatus().state).toBe("failed");
    // The Worker must not outlive the failed init: a Retry creates a second
    // one, and a zombie beside it holds a 36 MB wasm heap forever.
    expect(terminate).toHaveBeenCalledTimes(1);

    // The memo was cleared, so this really re-runs rather than handing back
    // the already-settled promise.
    await engine.initDuckDB();
    expect(instantiateCalls).toBe(2);
    expect(terminate).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
    vi.doUnmock("@duckdb/duckdb-wasm");
    vi.resetModules();
  });
});

describe("engine entry points before init", () => {
  it("starts uninitialized with no extension loaded", () => {
    expect(getDuckDBStatus().state).toBe("uninitialized");
    expect(isExtensionLoaded("cityjson")).toBe(false);
    expect(isExtensionLoaded("spatial")).toBe(false);
  });

  it("runQuery reports a message rather than throwing", async () => {
    const outcome = await runQuery("SELECT 1");
    expect(outcome).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
  });

  it("ddl reports the same message", async () => {
    const outcome = await ddl("CREATE TABLE t (a INTEGER)");
    expect(outcome.ok).toBe(false);
  });

  it("registerBuffer answers false and dropBuffer is a no-op", async () => {
    expect(await registerBuffer("x.json", new Uint8Array([1, 2]))).toBe(false);
    await expect(dropBuffer("x.json")).resolves.toBeUndefined();
  });

  it("readFile answers null", async () => {
    expect(await readFile("x.parquet")).toBeNull();
  });

  it("ensureExtension answers false without a database", async () => {
    expect(await ensureExtension("spatial")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/duckdbEngine.test.ts`
Expected: FAIL — `formatDuckDBError`, `runQuery`, `ddl`, `registerBuffer`, `dropBuffer`, `readFile`, `ensureExtension` and `isExtensionLoaded` are not exported.

- [ ] **Step 3: Replace the status/init section of `src/analytics/duckdb.ts`**

Replace the `Types`, `Singleton state` and `Initialization` sections (everything from `export type DuckDBStatus` down to the end of `initDuckDB`) with:

```ts
export type ExtensionName = "cityjson" | "spatial" | "three_d";

/** Per-extension load state. `cityjson` is loaded at init; `spatial` and
 *  `three_d` stay `"unloaded"` until `ensureExtension` asks for them. */
export type ExtensionStatus =
  | { readonly state: "unloaded" | "loading" | "loaded" }
  | { readonly state: "failed"; readonly error: string };

/** One row of `duckdb_extensions() WHERE loaded`, for the status tooltip. The
 *  community slot for a DuckDB version can be REBUILT under us — the
 *  duckdb-wasm pin is what pins the extension build — so a schema drift has to
 *  be diagnosable from the UI without a console. */
export interface LoadedExtension {
  readonly name: string;
  readonly version: string;
}

export type DuckDBStatus =
  | { readonly state: "uninitialized" }
  | { readonly state: "initializing" }
  | {
      readonly state: "ready";
      readonly extensions: Readonly<Record<ExtensionName, ExtensionStatus>>;
      readonly loadedExtensions: ReadonlyArray<LoadedExtension>;
      /**
       * `PRAGMA platform` — "wasm_eh" or "wasm_mvp", or null if it could not
       * be read.
       *
       * In the status because the two platforms are served DIFFERENT extension
       * artefacts from the community repo, so "which build am I actually
       * running" is unanswerable without it — and that is the first question a
       * schema-drift report has to answer.
       */
      readonly platform: string | null;
    }
  | { readonly state: "failed"; readonly error: string };

export interface QueryResult {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
}

/** A query's outcome WITH its failure message — the contract every new caller
 *  uses. {@link queryDuckDB} keeps its swallow-to-null shape for the two
 *  legacy callers (`stacItems`, the old stats path). */
export type QueryOutcome =
  | {
      readonly ok: true;
      readonly columns: string[];
      readonly rows: Record<string, unknown>[];
    }
  | { readonly ok: false; readonly message: string };

const NOT_RUNNING = "The analytics engine is not running.";

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let extensions: Record<ExtensionName, ExtensionStatus> = {
  cityjson: { state: "unloaded" },
  spatial: { state: "unloaded" },
  three_d: { state: "unloaded" },
};
let loadedExtensions: ReadonlyArray<LoadedExtension> = [];
let platform: string | null = null;
let status: DuckDBStatus = { state: "uninitialized" };
let initPromise: Promise<void> | null = null;
/** One in-flight load per extension, so N concurrent `ensureExtension` calls
 *  cost one INSTALL. */
const extensionPromises = new Map<ExtensionName, Promise<boolean>>();

export function getDuckDBStatus(): DuckDBStatus {
  return status;
}

export function isExtensionLoaded(name: ExtensionName): boolean {
  return extensions[name].state === "loaded";
}

/** Publish the current extension map into the `ready` status object — the
 *  status is a VALUE React subscribes to, so a lazy load has to mint a new
 *  one rather than mutate the old. */
function publishReady(): void {
  status = {
    state: "ready",
    extensions: { ...extensions },
    loadedExtensions,
    platform,
  };
}

/** DuckDB's own first error line. Its messages are one useful line plus a
 *  `LINE 1: …` echo and a caret; the echo is the SQL we just sent and the
 *  caret is meaningless outside a terminal, so both are dropped. */
export function formatDuckDBError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const kept: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^LINE \d+:/.test(trimmed)) break;
    if (trimmed !== "") kept.push(trimmed);
  }
  const message = kept.join(" ");
  return message === "" ? "The query failed." : message;
}

/** `spatial` is a CORE extension — `INSTALL spatial FROM community` fails
 *  outright — while `cityjson` and `three_d` come from the community repo.
 *  Neither `spatial` nor `three_d` autoloads in wasm. */
function installStatement(name: ExtensionName): string {
  return name === "spatial"
    ? "INSTALL spatial"
    : `INSTALL ${name} FROM community`;
}

async function loadExtension(name: ExtensionName): Promise<boolean> {
  const connection = conn;
  if (!connection) return false;
  extensions = { ...extensions, [name]: { state: "loading" } };
  try {
    await connection.query(installStatement(name));
    await connection.query(`LOAD ${name}`);
    extensions = { ...extensions, [name]: { state: "loaded" } };
    return true;
  } catch (error) {
    const message = formatDuckDBError(error);
    extensions = { ...extensions, [name]: { state: "failed", error: message } };
    console.warn(`DuckDB extension "${name}" did not load:`, message);
    return false;
  }
}

/** `PRAGMA platform` — "wasm_eh" or "wasm_mvp". Which one a session got
 *  decides WHICH extension artefacts the community repo served it, so a
 *  schema-drift report is unactionable without it. Best effort. */
async function readPlatform(): Promise<string | null> {
  const connection = conn;
  if (!connection) return null;
  try {
    const result = await connection.query("PRAGMA platform");
    const value = result.getChild("platform")?.get(0);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** The extensions actually loaded, for the status tooltip. Best effort: a
 *  database that cannot answer this is still perfectly usable. */
async function readLoadedExtensions(): Promise<ReadonlyArray<LoadedExtension>> {
  const connection = conn;
  if (!connection) return [];
  try {
    const result = await connection.query(
      "SELECT extension_name, extension_version FROM duckdb_extensions() WHERE loaded",
    );
    const out: LoadedExtension[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const name = result.getChild("extension_name")?.get(i);
      const version = result.getChild("extension_version")?.get(i);
      if (typeof name === "string") {
        out.push({ name, version: typeof version === "string" ? version : "" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function doInit(): Promise<void> {
  status = { state: "initializing" };

  // Held OUTSIDE the try so the catch can terminate it. A failed init used to
  // leave its Worker running — and `initDuckDB` clears its memo on failure, so
  // a Retry starts a SECOND one beside the zombie, each holding a wasm heap.
  let worker: Worker | null = null;

  try {
    // Bundles come from jsDelivr, not from our own dist/: the mvp wasm alone
    // is 38 MB, which is over Cloudflare Workers' 25 MiB per-asset limit —
    // self-hosting it made the app undeployable there. DuckDB analytics
    // already needs the network at runtime regardless (the cityjson
    // community extension below is fetched from DuckDB's CDN), and this
    // whole module degrades gracefully offline, so the CDN is not a new
    // point of failure. `selectBundle` picks eh over mvp where the browser
    // supports wasm exceptions; neither needs COOP/COEP.
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());

    // The worker script is cross-origin, which `new Worker(url)` forbids —
    // wrap it in a same-origin blob that importScripts the real one.
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      }),
    );
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const instance = new duckdb.AsyncDuckDB(logger, worker);
    await instance.instantiate(bundle.mainModule);

    db = instance;
    conn = await db.connect();

    // `cityjson` at init, because every layer table wants it. `spatial` and
    // `three_d` are lazy (`ensureExtension`): nothing in this feature needs
    // them, and `spatial` alone is a 23 MB download.
    await loadExtension("cityjson");
    platform = await readPlatform();
    loadedExtensions = await readLoadedExtensions();
    publishReady();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = { state: "failed", error: message };
    // Kill the Worker BEFORE clearing the memo: the reset below is what makes
    // a Retry re-run this function, and a retry must not stack a second
    // 36 MB wasm heap beside one nobody can reach any more.
    worker?.terminate();
    db = null;
    conn = null;
    // RESET, so a Retry button can call `initDuckDB()` again rather than being
    // handed the same rejected-once memo forever.
    initPromise = null;
    console.error("DuckDB-wasm initialization failed:", err);
  }
}

/**
 * Initialize DuckDB-wasm. Safe to call multiple times — returns the same
 * promise while initializing or once initialized. A FAILED init clears the
 * memo, so the next call genuinely retries.
 */
export function initDuckDB(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

/**
 * Load `spatial` or `three_d` on demand, memoised per extension.
 *
 * Nothing in the query/filter/export features needs either one; they are made
 * loadable for the analysis features to come, and a failed load is a `false`
 * plus a recorded status, never a throw.
 */
export async function ensureExtension(name: ExtensionName): Promise<boolean> {
  if (extensions[name].state === "loaded") return true;
  const existing = extensionPromises.get(name);
  if (existing) return await existing;
  const promise = (async () => {
    const ok = await loadExtension(name);
    if (status.state === "ready") publishReady();
    return ok;
  })().finally(() => extensionPromises.delete(name));
  extensionPromises.set(name, promise);
  return await promise;
}
```

- [ ] **Step 4: Add the query and VFS primitives**

Immediately after `queryParquetBuffer` in the same file, add:

```ts
/** One Arrow table as plain rows. BigInt is narrowed to Number because a
 *  `COUNT(*)` comes back as one and `JSON.stringify` throws on it. */
function toRows(
  result: Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>,
): QueryResult {
  const columns = result.schema.fields.map((f) => f.name);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const val = result.getChild(col)?.get(i);
      row[col] = typeof val === "bigint" ? Number(val) : val;
    }
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * Run `sql` and report EITHER rows OR the reason it failed.
 *
 * The whole point next to {@link queryDuckDB}: a filter bar that shows
 * "Binder Error: Referenced column \"nope\" not found!" teaches the user what
 * to fix, where a null teaches nothing. All new code uses this.
 */
export async function runQuery(sql: string): Promise<QueryOutcome> {
  if (!conn || status.state !== "ready") {
    return { ok: false, message: NOT_RUNNING };
  }
  try {
    const { columns, rows } = toRows(await conn.query(sql));
    return { ok: true, columns, rows };
  } catch (error) {
    return { ok: false, message: formatDuckDBError(error) };
  }
}

/** {@link runQuery} for a statement run for EFFECT (CREATE, DROP, COPY,
 *  PRAGMA). Same outcome shape, so a caller can report the message. */
export async function ddl(sql: string): Promise<QueryOutcome> {
  return await runQuery(sql);
}

/**
 * Register `bytes` in DuckDB's virtual file system under `name`.
 *
 * **CONSUMES `bytes`.** The array is handed over AS IS, deliberately not
 * copied: duckdb-wasm's async bindings post the buffer to their worker in the
 * TRANSFER list (`postTask(task, [buffer.buffer])`), which DETACHES the
 * caller's `ArrayBuffer` — the whole backing buffer, even for a partial view.
 * After this call the caller's array has length 0 and must never be read,
 * re-registered or handed to a second consumer; a caller that needs the bytes
 * again must obtain a FRESH array (see `SourceProvider`). That is the intent,
 * not a hazard to route around: a layer's source bytes are released from the
 * JS heap the moment the table is materialised, which is the whole reason the
 * VFS copy is dropped straight afterwards.
 *
 * `queryParquetBuffer` `.slice()`s instead, because ITS callers deliberately
 * re-use one buffer across two queries — see its own doc comment.
 *
 * A name is NEVER reused: a `dropFile`d name still resolves, to zero bytes,
 * and fails with a misleading JSON parse error.
 */
export async function registerBuffer(
  name: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!db || status.state !== "ready") return false;
  try {
    await db.registerFileBuffer(name, bytes);
    return true;
  } catch (error) {
    console.warn(`DuckDB could not register "${name}":`, error);
    return false;
  }
}

/** Drop a VFS entry. Never throws: a drop that fails must not discard a
 *  result already produced, and the name is dead either way. */
export async function dropBuffer(name: string): Promise<void> {
  if (!db) return;
  await db.dropFile(name).catch(() => {});
}

/** A file DuckDB wrote (a `COPY` target, a `cityparquet_write` output) as
 *  bytes, or null when there is no database or no such file. */
export async function readFile(name: string): Promise<Uint8Array | null> {
  if (!db || status.state !== "ready") return null;
  try {
    return await db.copyFileToBuffer(name);
  } catch (error) {
    console.warn(`DuckDB could not read "${name}":`, error);
    return null;
  }
}
```

- [ ] **Step 5: Rewrite `queryDuckDB` over the shared row reader**

Replace the body of `queryDuckDB` with:

```ts
export async function queryDuckDB(sql: string): Promise<QueryResult | null> {
  if (!conn || status.state !== "ready") return null;
  try {
    return toRows(await conn.query(sql));
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run the new test**

Run: `npx vitest run tests/unit/analytics/duckdbEngine.test.ts`
Expected: PASS — the four `formatDuckDBError` cases, the init-failure case
(worker terminated, retry re-runs) and the six "not initialized" guards.

- [ ] **Step 7: Fix the two now-broken status readers**

`src/ui/StatusBar.tsx` and `src/app/App.tsx` still read `status.extensionLoaded`, which no longer exists. Leave `App.tsx` for Task 18; for now make `StatusBar` compile by replacing `duckdbDotClass` / `duckdbLabel` with the Task 3 versions — do that in Task 3 and, for THIS task only, verify the type error is confined to those two files:

Run: `npx tsc -b --noEmit 2>&1 | head -20`
Expected: errors only in `src/ui/StatusBar.tsx` and `src/app/App.tsx`, both about `extensionLoaded`.

- [ ] **Step 8: Commit (with Task 3, which fixes the readers)**

Do not commit yet — Task 3 restores a compiling tree. Proceed straight to Task 3.

---

## Task 3: StatusBar labels and extension tooltip

**Files:**

- Modify: `src/ui/StatusBar.tsx`
- Modify: `src/app/App.tsx` (the `extensionLoaded` read inside the DuckDB effect, minimally)
- Test: `tests/unit/ui/StatusBarDuckdb.test.tsx` (create)

**Interfaces:**

- Consumes: `DuckDBStatus`, `ExtensionStatus`, `LoadedExtension` from Task 2.
- Produces: `duckdbLabel(status): string` and `duckdbTooltip(status): string` exported from `src/ui/StatusBar.tsx` for the test.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/StatusBarDuckdb.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { duckdbLabel, duckdbTooltip } from "../../../src/ui/StatusBar";
import type { DuckDBStatus } from "../../../src/analytics/duckdb";

const ready = (cityjson: "loaded" | "failed"): DuckDBStatus => ({
  state: "ready",
  platform: "wasm_eh",
  extensions: {
    cityjson:
      cityjson === "loaded"
        ? { state: "loaded" }
        : { state: "failed", error: "HTTP 404" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions:
    cityjson === "loaded"
      ? [
          { name: "cityjson", version: "0.4.0" },
          { name: "parquet", version: "v1.5.5" },
        ]
      : [{ name: "parquet", version: "v1.5.5" }],
});

describe("duckdbLabel", () => {
  it("says Ready when the cityjson extension loaded", () => {
    expect(duckdbLabel(ready("loaded"))).toBe("Ready");
  });

  it("says No ext when the engine came up without cityjson", () => {
    expect(duckdbLabel(ready("failed"))).toBe("No ext");
  });

  it("says Loading while initializing", () => {
    expect(duckdbLabel({ state: "initializing" })).toBe("Loading");
  });

  it("says Failed when the engine never started", () => {
    expect(duckdbLabel({ state: "failed", error: "no wasm" })).toBe("Failed");
  });
});

describe("duckdbTooltip", () => {
  it("names the platform and lists every loaded extension with its version", () => {
    expect(duckdbTooltip(ready("loaded"))).toBe(
      "Platform wasm_eh. Loaded extensions: cityjson 0.4.0, parquet v1.5.5",
    );
  });

  it("names the cityjson failure when there is one", () => {
    expect(duckdbTooltip(ready("failed"))).toBe(
      "cityjson did not load: HTTP 404. Platform wasm_eh. Loaded extensions: parquet v1.5.5",
    );
  });

  it("says so when the platform could not be read", () => {
    expect(
      duckdbTooltip({ ...ready("loaded"), platform: null } as DuckDBStatus),
    ).toBe(
      "Platform unknown. Loaded extensions: cityjson 0.4.0, parquet v1.5.5",
    );
  });

  it("reports the engine failure verbatim", () => {
    expect(duckdbTooltip({ state: "failed", error: "no wasm" })).toBe(
      "The analytics engine failed to start: no wasm",
    );
  });

  it("says so while still starting", () => {
    expect(duckdbTooltip({ state: "initializing" })).toBe(
      "The analytics engine is starting…",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/StatusBarDuckdb.test.tsx`
Expected: FAIL — `duckdbLabel` / `duckdbTooltip` are not exported.

- [ ] **Step 3: Rewrite the two helpers in `src/ui/StatusBar.tsx`**

Replace `duckdbDotClass` and `duckdbLabel` with:

```ts
function duckdbDotClass(status: DuckDBStatus): string {
  if (status.state === "ready") {
    return status.extensions.cityjson.state === "loaded"
      ? "dot-ready"
      : "dot-partial";
  }
  if (status.state === "initializing") return "dot-loading";
  return "dot-failed";
}

/** Exported for its unit test — the four words are the whole of what the user
 *  sees about the analytics engine. */
export function duckdbLabel(status: DuckDBStatus): string {
  if (status.state === "ready") {
    return status.extensions.cityjson.state === "loaded" ? "Ready" : "No ext";
  }
  if (status.state === "initializing") return "Loading";
  return "Failed";
}

/**
 * What the status pill's `title` says.
 *
 * It names `PRAGMA platform` and lists `duckdb_extensions()` because BOTH
 * decide which artefacts this session actually got: `wasm_eh` and `wasm_mvp`
 * are served different builds, and the community slot for a DuckDB version can
 * be REBUILT under us (the duckdb-wasm pin is what pins the extension build).
 * A schema drift ("id is suddenly missing") has to be diagnosable from the UI,
 * not only from a console nobody opens.
 */
export function duckdbTooltip(status: DuckDBStatus): string {
  if (status.state === "uninitialized") {
    return "The analytics engine has not started.";
  }
  if (status.state === "initializing") {
    return "The analytics engine is starting…";
  }
  if (status.state === "failed") {
    return `The analytics engine failed to start: ${status.error}`;
  }
  const listed =
    status.loadedExtensions.length === 0
      ? "no extensions loaded"
      : status.loadedExtensions
          .map((e) => (e.version === "" ? e.name : `${e.name} ${e.version}`))
          .join(", ");
  const cityjson = status.extensions.cityjson;
  const prefix =
    cityjson.state === "failed"
      ? `cityjson did not load: ${cityjson.error}. `
      : "";
  const platform = status.platform === null ? "unknown" : status.platform;
  return `${prefix}Platform ${platform}. Loaded extensions: ${listed}`;
}
```

- [ ] **Step 4: Use the tooltip on the pill**

In the render, replace the DuckDB status item with:

```tsx
{
  duckdbStatus && duckdbStatus.state !== "uninitialized" && (
    <div className="status-item" title={duckdbTooltip(duckdbStatus)}>
      <span className={`status-dot ${duckdbDotClass(duckdbStatus)}`} />
      <span className="status-label">DuckDB</span>
      <span className="status-value">{duckdbLabel(duckdbStatus)}</span>
    </div>
  );
}
```

- [ ] **Step 5: Make `App.tsx` compile again**

In `src/app/App.tsx`'s DuckDB load effect, replace

```ts
const extensionLoaded =
  "extensionLoaded" in duckdbStatus && duckdbStatus.extensionLoaded;
```

with

```ts
const extensionLoaded =
  duckdbStatus.state === "ready" &&
  duckdbStatus.extensions.cityjson.state === "loaded";
```

(The whole effect is deleted in Task 18; this keeps the tree compiling in between.)

- [ ] **Step 6: Run the tests and the type check**

```bash
npx vitest run tests/unit/ui/StatusBarDuckdb.test.tsx tests/unit/analytics/duckdbEngine.test.ts
npx tsc -b --noEmit
```

Expected: PASS, and a clean type check.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/duckdb.ts src/ui/StatusBar.tsx src/app/App.tsx tests/unit/analytics/duckdbEngine.test.ts tests/unit/ui/StatusBarDuckdb.test.tsx
git commit -m "$(cat <<'EOF'
feat(analytics): per-extension DuckDB status, runQuery and VFS primitives

runQuery reports DuckDB's own first error line (the LINE/caret echo stripped)
so a filter bar can say what is wrong; registerBuffer/dropBuffer/readFile are
the VFS seam the layer tables and the exporter share. A failed init now clears
its memo so a retry really retries, and the status pill's tooltip lists
duckdb_extensions() because the community slot can be rebuilt under us.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 4: Bring the seven DuckDB-mocking test files up to the new surface

**Files:**

- Modify: `tests/unit/app/appCatalogEntry.test.tsx`
- Modify: `tests/unit/app/appRestoreShare.test.tsx`
- Modify: `tests/unit/app/appEngineBoot.test.tsx`
- Modify: `tests/unit/app/appCityParquetLayers.test.tsx`
- Modify: `tests/unit/features/stac/stacItems.test.ts`
- Modify: `tests/unit/analytics/duckdbStatus.test.ts`
- Delete: `tests/unit/analytics/streamingDuckdb.test.ts`

**Interfaces:**

- Consumes: Task 2's exports.
- Produces: a mock factory literal (below) that every one of the six surviving files uses, so no later task has to touch them again.

**Why the interim state is safe.** Between this task and Task 18, `App.tsx`
still imports `loadModelIntoDuckDB`, `loadCityModelFromMemory`,
`loadResidentObjectsIntoDuckDB` and `shouldUseSourceUrlPath`, which these
factories no longer export — so under these mocks they are `undefined`. Nothing
CALLS them: App's DuckDB effect returns at
`if (duckdbStatus.state !== "ready")`, and every surviving mock reports
`"uninitialized"`. The only tests that ever reached the ready branch are the two
`extensionReady` ones deleted in Step 5. The real module still exports all four
until Task 18, so the app itself compiles and runs throughout.

**The canonical mock literal.** Every file below gets exactly this object (paths adjusted for depth), even where a given test never calls half of it — a `vi.mock` factory REPLACES the module, so an export the app imports but the factory omits arrives as `undefined` and throws at call time:

```ts
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
```

- [ ] **Step 1: Delete the obsolete streaming-DuckDB test**

`tests/unit/analytics/streamingDuckdb.test.ts` tests `shouldUseSourceUrlPath` and `loadResidentObjectsIntoDuckDB`, both of which Task 18 deletes. Its subject is gone, not moved.

```bash
git rm tests/unit/analytics/streamingDuckdb.test.ts
```

- [ ] **Step 2: Rewrite `tests/unit/analytics/duckdbStatus.test.ts`**

Replace the whole file with:

```ts
/**
 * DuckDB-wasm initialization needs a browser Worker, so these tests verify the
 * module's status tracking and query guards without attempting a real init.
 * The engine's error formatting and VFS guards live in duckdbEngine.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  getDuckDBStatus,
  queryDuckDB,
  queryParquetBuffer,
} from "../../../src/analytics/duckdb";

describe("DuckDB status", () => {
  it("starts in uninitialized state", () => {
    expect(getDuckDBStatus().state).toBe("uninitialized");
  });

  it("queryDuckDB returns null when not initialized", async () => {
    expect(await queryDuckDB("SELECT 1")).toBeNull();
  });

  it("queryParquetBuffer returns null when not initialized", async () => {
    const result = await queryParquetBuffer(
      "x.parquet",
      new Uint8Array(8),
      "SELECT 1",
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Update `tests/unit/features/stac/stacItems.test.ts`**

Replace its `vi.mock` factory (lines ~16–22) with:

```ts
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  // Defaults to READY, because that is the state every other test in this
  // file assumes; the one test that cares overrides it per call.
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(),
}));
```

Then grep the file for `{ state: "ready", extensionLoaded: true }` and `{ state: "uninitialized" }` overrides inside tests and replace any `extensionLoaded: true` with the `extensions`/`loadedExtensions` pair above.

- [ ] **Step 4: Update the three simple App mocks**

In `tests/unit/app/appCatalogEntry.test.tsx`, `tests/unit/app/appEngineBoot.test.tsx` and `tests/unit/app/appRestoreShare.test.tsx`, replace each `vi.mock("../../../src/analytics/duckdb", () => ({ … }))` factory body with the canonical literal:

```ts
vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));
```

- [ ] **Step 5: Update `tests/unit/app/appCityParquetLayers.test.tsx`'s mock only**

Replace its factory with the same literal, but keep its `extensionReady` switch on `getDuckDBStatus`:

```ts
vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() =>
    extensionReady
      ? {
          state: "ready",
          extensions: {
            cityjson: { state: "loaded" },
            spatial: { state: "unloaded" },
            three_d: { state: "unloaded" },
          },
          loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
          platform: "wasm_eh",
        }
      : { state: "uninitialized" },
  ),
  isExtensionLoaded: vi.fn(() => extensionReady),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));
```

Delete the ENTIRE `describe("App DuckDB load — CityParquet layers")` block —
both its tests reference `loadModelIntoDuckDB` / `loadCityModelFromMemory`,
which no longer exist — together with:

- the `loadModelIntoDuckDB` and `loadCityModelFromMemory` `vi.fn` declarations
  and their `mockClear()` calls in `beforeEach`;
- **`let urlPath`**, which that describe was the only reader of. Left behind, it
  is a write-only `let` that trips `no-unused-vars` — and `vp check --fix`
  cannot delete a variable for you, so the pre-commit hook would simply block
  the commit.

`extensionReady` stays (the mock's ternary still reads it) but nothing sets it
true any more, which is correct: the four surviving tests never need a ready
engine. Also update the file's module doc comment, whose third bullet ("The
DuckDB effect must not offer a CityParquet layer to the cityjson extension…")
describes a test that is gone — Task 18 adds the layer-table equivalent.

Keep the four restore/share routing tests untouched.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: 0 failed files; the pass count is Task 1's baseline minus the tests deleted in Steps 1 and 5.

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "$(cat <<'EOF'
test: point the DuckDB module mocks at the new engine surface

A vi.mock factory REPLACES the module, so every export the app imports has to
appear in all six factories or it arrives undefined. streamingDuckdb.test.ts
goes: its subject (shouldUseSourceUrlPath, loadResidentObjectsIntoDuckDB) is
deleted, not moved.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 5: Column vocabulary — `classifyColumnType` and the LoD column maths

**Files:**

- Create: `src/analytics/columnKind.ts`
- Test: `tests/unit/analytics/columnKind.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type ColumnKind = "scalar" | "castText" | "nested" | "blob";

export interface ColumnInfo {
  readonly name: string;
  /** DuckDB's `column_type` verbatim, e.g. "VARCHAR[]", "TIMESTAMP WITH TIME ZONE". */
  readonly type: string;
  readonly kind: ColumnKind;
}

export function classifyColumnType(type: string): ColumnKind;
export function isTextColumn(column: ColumnInfo): boolean;
export function isDroppedColumn(name: string): boolean;
export function lodColumnSuffix(lod: string): string;
export function lodsFromColumnNames(names: ReadonlyArray<string>): string[];
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/columnKind.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyColumnType,
  isDroppedColumn,
  isTextColumn,
  lodColumnSuffix,
  lodsFromColumnNames,
} from "../../../src/analytics/columnKind";

describe("classifyColumnType", () => {
  it("calls a list, a struct and a map nested", () => {
    expect(classifyColumnType("VARCHAR[]")).toBe("nested");
    expect(classifyColumnType("STRUCT(xmin DOUBLE, ymin DOUBLE)")).toBe(
      "nested",
    );
    expect(classifyColumnType("MAP(VARCHAR, VARCHAR)")).toBe("nested");
    expect(classifyColumnType("STRUCT(a INTEGER)[]")).toBe("nested");
  });

  it("calls BLOB blob", () => {
    expect(classifyColumnType("BLOB")).toBe("blob");
  });

  it("calls the JS-safe scalars scalar", () => {
    for (const t of [
      "VARCHAR",
      "BOOLEAN",
      "DOUBLE",
      "FLOAT",
      "REAL",
      "INTEGER",
      "SMALLINT",
      "TINYINT",
      "UINTEGER",
      "USMALLINT",
      "UTINYINT",
    ]) {
      expect(classifyColumnType(t)).toBe("scalar");
    }
  });

  it("sends HUGEINT and DECIMAL to castText — Arrow hands them back as STRINGS", () => {
    // Not a nicety: an unguarded `toFixed` on one of these throws, and a
    // formatter that assumed a number would blank the whole column.
    expect(classifyColumnType("HUGEINT")).toBe("castText");
    expect(classifyColumnType("DECIMAL(38,10)")).toBe("castText");
  });

  it("calls everything else castText — the types JS cannot render faithfully", () => {
    for (const t of [
      "BIGINT",
      "HUGEINT",
      "DECIMAL(18,3)",
      "DATE",
      "TIMESTAMP",
      "TIMESTAMP WITH TIME ZONE",
      "TIME",
      "INTERVAL",
      "UUID",
    ]) {
      expect(classifyColumnType(t)).toBe("castText");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyColumnType("  varchar  ")).toBe("scalar");
    expect(classifyColumnType("varchar[]")).toBe("nested");
  });
});

describe("isTextColumn", () => {
  it("is true only for a VARCHAR scalar", () => {
    expect(isTextColumn({ name: "a", type: "VARCHAR", kind: "scalar" })).toBe(
      true,
    );
    expect(isTextColumn({ name: "a", type: "DOUBLE", kind: "scalar" })).toBe(
      false,
    );
    expect(isTextColumn({ name: "a", type: "VARCHAR[]", kind: "nested" })).toBe(
      false,
    );
  });
});

describe("isDroppedColumn", () => {
  it("drops geometry, its sidecar, materials, textures and template", () => {
    for (const n of [
      "geometry_lod2_2",
      "geometry_properties_lod2_2",
      "material_lod1_2",
      "texture_lod2_2",
      "template",
    ]) {
      expect(isDroppedColumn(n)).toBe(true);
    }
  });

  it("keeps the identity, structural and attribute columns", () => {
    for (const n of [
      "id",
      "feature_id",
      "object_type",
      "parents",
      "children",
      "children_roles",
      "address",
      "bbox",
      "other",
      "b3_h_dak_max",
    ]) {
      expect(isDroppedColumn(n)).toBe(false);
    }
  });
});

describe("LoD column maths", () => {
  it("spells an LoD as DuckDB spells it in a column name", () => {
    expect(lodColumnSuffix("2.2")).toBe("2_2");
    expect(lodColumnSuffix("0")).toBe("0");
  });

  it("reads the LoD ladder back off the geometry columns, sorted and deduped", () => {
    expect(
      lodsFromColumnNames([
        "id",
        "geometry_lod2_2",
        "geometry_properties_lod2_2",
        "geometry_lod1_2",
        "geometry_lod1_3",
      ]),
    ).toEqual(["1.2", "1.3", "2.2"]);
  });

  it("is empty for a table with no geometry columns", () => {
    expect(lodsFromColumnNames(["id", "object_type"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/columnKind.test.ts`
Expected: FAIL — cannot resolve `src/analytics/columnKind`.

- [ ] **Step 3: Write the implementation**

Create `src/analytics/columnKind.ts`:

```ts
/**
 * What a DuckDB column NAME and TYPE mean to this app.
 *
 * Two separate jobs, together because both are "read the reader's vocabulary":
 *
 *  - `classifyColumnType` decides how a value has to travel from Arrow to the
 *    grid. duckdb-wasm hands a cell back through `getChild(col).get(i)`, and
 *    that is where the trouble is: a LIST arrives as an Arrow `Vector`, a
 *    STRUCT as a `StructRow`, a BIGINT as a JS `BigInt` (which breaks
 *    `JSON.stringify` outright), a DATE or TIMESTAMP as epoch milliseconds, and
 *    a HUGEINT or DECIMAL as a STRING. So
 *    nested columns are projected through `to_json` and everything JS renders
 *    unfaithfully is cast to VARCHAR in SQL, where DuckDB's own formatting is
 *    the answer. Only the types JS can hold exactly travel raw.
 *  - `isDroppedColumn` names the reader columns a BROWSING table never wants:
 *    geometry WKB and its sidecar, per-LoD material/texture indices, and the
 *    geometry-template struct. Dropping them keeps 53 of 70 columns on the
 *    Delft sample and cuts table memory 2.45x (13.1 vs 32.1 MiB for 2231 rows).
 *
 * Pure, no engine import, no I/O.
 */

export type ColumnKind = "scalar" | "castText" | "nested" | "blob";

export interface ColumnInfo {
  readonly name: string;
  /** DuckDB's `column_type` verbatim, e.g. "VARCHAR[]", "DECIMAL(18,3)". */
  readonly type: string;
  readonly kind: ColumnKind;
}

/** The types a JS value holds EXACTLY, so they can cross unchanged. */
const SCALAR_TYPES = new Set([
  "VARCHAR",
  "BOOLEAN",
  "DOUBLE",
  "FLOAT",
  "REAL",
  "INTEGER",
  "SMALLINT",
  "TINYINT",
  "UINTEGER",
  "USMALLINT",
  "UTINYINT",
]);

export function classifyColumnType(type: string): ColumnKind {
  const t = type.trim().toUpperCase();
  if (t.endsWith("[]") || t.startsWith("STRUCT(") || t.startsWith("MAP(")) {
    return "nested";
  }
  if (t === "BLOB") return "blob";
  if (SCALAR_TYPES.has(t)) return "scalar";
  return "castText";
}

/** Whether LIKE-family operators may be offered for this column. */
export function isTextColumn(column: ColumnInfo): boolean {
  return (
    column.kind === "scalar" && column.type.trim().toUpperCase() === "VARCHAR"
  );
}

const DROPPED = /^(geometry_|geometry_properties_|material_|texture_)/;

/** Whether a reader column is left out of a layer's browsing table. */
export function isDroppedColumn(name: string): boolean {
  return name === "template" || DROPPED.test(name);
}

/** "2.2" -> "2_2": how the reader spells an LoD inside a column name. */
export function lodColumnSuffix(lod: string): string {
  return lod.replace(/\./g, "_");
}

/** The LoD ladder a reader's column list implies, sorted ascending. */
export function lodsFromColumnNames(names: ReadonlyArray<string>): string[] {
  const lods = new Set<string>();
  for (const name of names) {
    const match = /^geometry_lod(.+)$/.exec(name);
    if (match?.[1] !== undefined) lods.add(match[1].replace(/_/g, "."));
  }
  return [...lods].sort((a, b) => parseFloat(a) - parseFloat(b));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/columnKind.test.ts`
Expected: PASS — all `classifyColumnType`, `isTextColumn`, `isDroppedColumn`
and LoD-column cases green.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/columnKind.ts tests/unit/analytics/columnKind.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): the DuckDB column vocabulary as pure functions

classifyColumnType decides how a cell travels: nested columns go through
to_json, BIGINT/DATE/TIMESTAMP through ::VARCHAR (a BigInt breaks
JSON.stringify and epoch-ms is not a date), only the exactly-holdable scalars
travel raw. isDroppedColumn names the geometry/material/texture/template
columns a browsing table never wants — 2.45x less table memory on Delft.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 6: `rootFeatureId` — the flat fallback's `feature_id`

**Files:**

- Create: `src/domain/citymodel/featureId.ts`
- Test: `tests/unit/domain/citymodel/featureId.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type ParentsIndex = ReadonlyMap<string, ReadonlyArray<string>>;
export function parentsIndexOf(
  objects: Readonly<
    Record<string, { readonly parents?: ReadonlyArray<string> } | undefined>
  >,
): ParentsIndex;
export function rootFeatureId(id: string, parents: ParentsIndex): string;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/citymodel/featureId.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../../../src/domain/citymodel/featureId";

describe("rootFeatureId", () => {
  const index = parentsIndexOf({
    B1: { parents: [] },
    "B1-0": { parents: ["B1"] },
    "B1-0-a": { parents: ["B1-0"] },
    Tree: { parents: [] },
  });

  it("is the object's own id when it has no parents", () => {
    expect(rootFeatureId("B1", index)).toBe("B1");
    expect(rootFeatureId("Tree", index)).toBe("Tree");
  });

  it("walks a part up to its Building", () => {
    expect(rootFeatureId("B1-0", index)).toBe("B1");
  });

  it("walks a whole chain, not just one step", () => {
    expect(rootFeatureId("B1-0-a", index)).toBe("B1");
  });

  it("stops at a parent that is not in the model", () => {
    const orphan = parentsIndexOf({ P: { parents: ["Missing"] } });
    expect(rootFeatureId("P", orphan)).toBe("Missing");
  });

  it("is cycle-safe", () => {
    const cyclic = parentsIndexOf({
      A: { parents: ["B"] },
      B: { parents: ["A"] },
    });
    expect(rootFeatureId("A", cyclic)).toBe("B");
  });

  it("returns the id unchanged for an object the index never saw", () => {
    expect(rootFeatureId("Nope", index)).toBe("Nope");
  });

  it("treats a missing parents array as no parents", () => {
    const index2 = parentsIndexOf({ X: {} });
    expect(rootFeatureId("X", index2)).toBe("X");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/domain/citymodel/featureId.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/domain/citymodel/featureId.ts`:

```ts
/**
 * The `feature_id` the DuckDB cityjson reader would have produced, computed
 * app-side for the layers that have no reader (CityGML, CityParquet, a
 * streaming layer's resident records).
 *
 * The reader's own definition: `id` is the CityObject's id and `feature_id`
 * names the ROOT object of the feature — a BuildingPart carries its Building's
 * id. Everything downstream depends on the two paths agreeing: the filter's
 * feature expansion, the export scope predicate and the map-filter id set are
 * all written once, against one vocabulary.
 *
 * Pure. Cycle-safe, because a malformed file may say A is a child of B and B
 * of A, and a viewer of third-party data must not hang on it.
 */

export type ParentsIndex = ReadonlyMap<string, ReadonlyArray<string>>;

/** The parent lookup for a model's (or a resident set's) objects. */
export function parentsIndexOf(
  objects: Readonly<
    Record<string, { readonly parents?: ReadonlyArray<string> } | undefined>
  >,
): ParentsIndex {
  const index = new Map<string, ReadonlyArray<string>>();
  for (const [id, obj] of Object.entries(objects)) {
    if (obj) index.set(id, obj.parents ?? []);
  }
  return index;
}

/**
 * The id of `id`'s root ancestor — itself when it has no parents.
 *
 * The FIRST parent is followed: CityJSON allows several, but a second parent
 * is a cross-reference rather than containment, and a feature has one root by
 * definition. A parent the index never saw is the answer (it is as far up as
 * this model goes); a cycle stops at the id that would repeat.
 */
export function rootFeatureId(id: string, parents: ParentsIndex): string {
  const seen = new Set<string>([id]);
  let current = id;
  for (;;) {
    const parent = parents.get(current)?.[0];
    if (parent === undefined || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
    if (!parents.has(current)) return current;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/domain/citymodel/featureId.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/citymodel/featureId.ts tests/unit/domain/citymodel/featureId.test.ts
git commit -m "$(cat <<'EOF'
feat(citymodel): rootFeatureId, the reader's feature_id computed app-side

The flat-fallback layers (CityGML, CityParquet, streaming residents) must
publish the same feature_id the DuckDB reader does, or the filter's feature
expansion, the export scope and the map-filter id set stop agreeing. Follows
the FIRST parent (a second is a cross-reference, not containment) and is
cycle-safe, because a viewer of third-party data must not hang on a bad file.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 7: `cityGmlModuleOf` — which CityParquet object table a type belongs in

**Files:**

- Create: `src/analytics/cityGmlModule.ts`
- Test: `tests/unit/analytics/cityGmlModule.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type CityGmlModule =
  | "building"
  | "bridge"
  | "tunnel"
  | "construction"
  | "transportation"
  | "vegetation"
  | "relief"
  | "water_body"
  | "land_use"
  | "city_furniture"
  | "generics";

export const CITY_GML_MODULES: ReadonlyArray<CityGmlModule>;
export function cityGmlModuleOf(objectType: string): CityGmlModule;
export function groupTypesByModule(
  types: ReadonlyArray<string>,
): ReadonlyArray<{
  readonly module: CityGmlModule;
  readonly types: ReadonlyArray<string>;
}>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/cityGmlModule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  cityGmlModuleOf,
  groupTypesByModule,
} from "../../../src/analytics/cityGmlModule";

describe("cityGmlModuleOf", () => {
  it("maps every Building* type to building", () => {
    expect(cityGmlModuleOf("Building")).toBe("building");
    expect(cityGmlModuleOf("BuildingPart")).toBe("building");
    expect(cityGmlModuleOf("BuildingInstallation")).toBe("building");
    expect(cityGmlModuleOf("BuildingRoom")).toBe("building");
  });

  it("maps the other prefixed families", () => {
    expect(cityGmlModuleOf("Bridge")).toBe("bridge");
    expect(cityGmlModuleOf("BridgePart")).toBe("bridge");
    expect(cityGmlModuleOf("Tunnel")).toBe("tunnel");
    expect(cityGmlModuleOf("TunnelConstructiveElement")).toBe("tunnel");
  });

  it("maps the exact-name types", () => {
    expect(cityGmlModuleOf("OtherConstruction")).toBe("construction");
    expect(cityGmlModuleOf("Road")).toBe("transportation");
    expect(cityGmlModuleOf("Railway")).toBe("transportation");
    expect(cityGmlModuleOf("TransportSquare")).toBe("transportation");
    expect(cityGmlModuleOf("Waterway")).toBe("transportation");
    expect(cityGmlModuleOf("PlantCover")).toBe("vegetation");
    expect(cityGmlModuleOf("SolitaryVegetationObject")).toBe("vegetation");
    expect(cityGmlModuleOf("TINRelief")).toBe("relief");
    expect(cityGmlModuleOf("WaterBody")).toBe("water_body");
    expect(cityGmlModuleOf("LandUse")).toBe("land_use");
    expect(cityGmlModuleOf("CityFurniture")).toBe("city_furniture");
  });

  it("sends anything unrecognised to generics", () => {
    expect(cityGmlModuleOf("GenericCityObject")).toBe("generics");
    expect(cityGmlModuleOf("Zonkity")).toBe("generics");
  });
});

describe("groupTypesByModule", () => {
  it("groups in CITY_GML_MODULES order, keeping the caller's type order", () => {
    expect(
      groupTypesByModule([
        "SolitaryVegetationObject",
        "Building",
        "Bridge",
        "PlantCover",
      ]),
    ).toEqual([
      { module: "building", types: ["Building"] },
      { module: "bridge", types: ["Bridge"] },
      {
        module: "vegetation",
        types: ["SolitaryVegetationObject", "PlantCover"],
      },
    ]);
  });

  it("omits a module nothing maps to", () => {
    expect(groupTypesByModule(["Building"])).toEqual([
      { module: "building", types: ["Building"] },
    ]);
  });

  it("is empty for no types", () => {
    expect(groupTypesByModule([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/cityGmlModule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/analytics/cityGmlModule.ts`:

```ts
/**
 * Which CityParquet object table a CityObject type belongs in.
 *
 * `cityparquet_write` requires each table in the export schema to be an
 * ORDINARY table named for a CityGML module; a name outside this list is
 * refused. The mapping is the CityGML 3.0 module partition, and everything
 * unrecognised goes to `generics` rather than being dropped — an export that
 * silently loses objects is worse than one with a wide `generics` table.
 *
 * Pure, no engine import.
 */

export type CityGmlModule =
  | "building"
  | "bridge"
  | "tunnel"
  | "construction"
  | "transportation"
  | "vegetation"
  | "relief"
  | "water_body"
  | "land_use"
  | "city_furniture"
  | "generics";

/** Table order inside an exported package — stable, so a diff of two exports
 *  of the same data is empty. */
export const CITY_GML_MODULES: ReadonlyArray<CityGmlModule> = [
  "building",
  "bridge",
  "tunnel",
  "construction",
  "transportation",
  "vegetation",
  "relief",
  "water_body",
  "land_use",
  "city_furniture",
  "generics",
];

/** Families whose members all start with the same word (`BuildingPart`,
 *  `TunnelConstructiveElement`, …). Checked before the exact names. */
const PREFIXES: ReadonlyArray<readonly [string, CityGmlModule]> = [
  ["Building", "building"],
  ["Bridge", "bridge"],
  ["Tunnel", "tunnel"],
];

const EXACT: Readonly<Record<string, CityGmlModule>> = {
  OtherConstruction: "construction",
  Road: "transportation",
  Railway: "transportation",
  TransportSquare: "transportation",
  Waterway: "transportation",
  PlantCover: "vegetation",
  SolitaryVegetationObject: "vegetation",
  TINRelief: "relief",
  WaterBody: "water_body",
  LandUse: "land_use",
  CityFurniture: "city_furniture",
};

export function cityGmlModuleOf(objectType: string): CityGmlModule {
  for (const [prefix, module] of PREFIXES) {
    if (objectType.startsWith(prefix)) return module;
  }
  return EXACT[objectType] ?? "generics";
}

/**
 * The caller's types, partitioned into the tables they will be written to.
 *
 * Modules with no types are omitted — an empty `exp.bridge` would still be a
 * table `cityparquet_init` has to describe, and a package listing an object
 * table with zero rows reads as data loss.
 */
export function groupTypesByModule(
  types: ReadonlyArray<string>,
): ReadonlyArray<{
  readonly module: CityGmlModule;
  readonly types: ReadonlyArray<string>;
}> {
  const buckets = new Map<CityGmlModule, string[]>();
  for (const type of types) {
    const module = cityGmlModuleOf(type);
    const bucket = buckets.get(module);
    if (bucket) bucket.push(type);
    else buckets.set(module, [type]);
  }
  const out: Array<{ module: CityGmlModule; types: ReadonlyArray<string> }> =
    [];
  for (const module of CITY_GML_MODULES) {
    const bucket = buckets.get(module);
    if (bucket) out.push({ module, types: bucket });
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/cityGmlModule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/cityGmlModule.ts tests/unit/analytics/cityGmlModule.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): cityGmlModuleOf, the CityParquet object-table partition

cityparquet_write refuses a schema table whose name is not a CityGML module,
so the exporter has to decide which table each object type goes in. Anything
unrecognised lands in generics rather than being dropped: an export that
silently loses objects is worse than a wide generics table.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 8: The query model — types and the per-layer query store

**Files:**

- Create: `src/features/query/types.ts`
- Create: `src/features/query/queryStore.ts`
- Test: `tests/unit/features/query/queryStore.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
// src/features/query/types.ts
export type FilterOp =
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

export type FilterValue = string | number | boolean | ReadonlyArray<string>;

export interface FilterCondition {
  readonly id: string;
  readonly column: string;
  readonly op: FilterOp;
  readonly value: FilterValue;
}

export interface FilterGroup {
  readonly logic: "AND" | "OR";
  readonly conditions: ReadonlyArray<FilterCondition>;
}

export type PageSize = 100 | 500 | 1000;

export interface LayerQuery {
  /** The DRAFT edited in the filter bar. */
  readonly filter: FilterGroup;
  /** What the grid and the map currently use; null = no filter. */
  readonly applied: FilterGroup | null;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly page: number;
  readonly pageSize: PageSize;
  readonly syncToMap: boolean;
}

export const EMPTY_FILTER: FilterGroup;
export const DEFAULT_LAYER_QUERY: LayerQuery;
export const PAGE_SIZES: ReadonlyArray<PageSize>;
/** Ops that take no value at all. */
export function isNullaryOp(op: FilterOp): boolean;

// src/features/query/queryStore.ts
export interface QueryStoreState {
  readonly queries: Readonly<Record<string, LayerQuery>>;
}
export interface QueryStoreActions {
  setFilter: (layerId: string, filter: FilterGroup) => void;
  applyFilter: (layerId: string) => void;
  clearFilter: (layerId: string) => void;
  setSort: (layerId: string, sort: LayerQuery["sort"]) => void;
  toggleSort: (layerId: string, column: string) => void;
  setPage: (layerId: string, page: number) => void;
  setPageSize: (layerId: string, pageSize: PageSize) => void;
  setSyncToMap: (layerId: string, on: boolean) => void;
  resetQuery: (layerId: string) => void;
}
export type QueryStore = QueryStoreState & QueryStoreActions;
export const useQueryStore: UseBoundStore<StoreApi<QueryStore>>;
/** The layer's query, defaulted — never undefined. */
export function layerQuery(state: QueryStoreState, layerId: string): LayerQuery;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/query/queryStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  layerQuery,
  useQueryStore,
} from "../../../../src/features/query/queryStore";
import {
  DEFAULT_LAYER_QUERY,
  type FilterGroup,
} from "../../../../src/features/query/types";

const FILTER: FilterGroup = {
  logic: "AND",
  conditions: [{ id: "c1", column: "object_type", op: "=", value: "Building" }],
};

beforeEach(() => {
  useQueryStore.setState({ queries: {} });
});

describe("layerQuery", () => {
  it("defaults a layer nobody has touched", () => {
    expect(layerQuery(useQueryStore.getState(), "L1")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });

  it("defaults page size to 100 and applies nothing", () => {
    expect(DEFAULT_LAYER_QUERY.pageSize).toBe(100);
    expect(DEFAULT_LAYER_QUERY.applied).toBeNull();
    expect(DEFAULT_LAYER_QUERY.syncToMap).toBe(false);
  });
});

describe("applyFilter", () => {
  it("copies the draft to applied and resets the page", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", FILTER);
    s.setPage("L1", 4);
    expect(layerQuery(useQueryStore.getState(), "L1").applied).toBeNull();

    useQueryStore.getState().applyFilter("L1");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.applied).toEqual(FILTER);
    expect(q.page).toBe(0);
  });

  it("applies null when the draft has no conditions", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", { logic: "AND", conditions: [] });
    useQueryStore.getState().applyFilter("L1");
    expect(layerQuery(useQueryStore.getState(), "L1").applied).toBeNull();
  });

  it("does not leak into another layer", () => {
    useQueryStore.getState().setFilter("L1", FILTER);
    useQueryStore.getState().applyFilter("L1");
    expect(layerQuery(useQueryStore.getState(), "L2")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });
});

describe("clearFilter", () => {
  it("empties both the draft and the applied filter and resets the page", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", FILTER);
    useQueryStore.getState().applyFilter("L1");
    useQueryStore.getState().setPage("L1", 3);

    useQueryStore.getState().clearFilter("L1");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.applied).toBeNull();
    expect(q.filter.conditions).toEqual([]);
    expect(q.page).toBe(0);
  });
});

describe("toggleSort", () => {
  it("sorts ascending on the first click", () => {
    useQueryStore.getState().toggleSort("L1", "b3_h_dak_max");
    expect(layerQuery(useQueryStore.getState(), "L1").sort).toEqual({
      column: "b3_h_dak_max",
      dir: "asc",
    });
  });

  it("flips direction on the same column and resets the page", () => {
    useQueryStore.getState().setPage("L1", 5);
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "id");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.sort).toEqual({ column: "id", dir: "desc" });
    expect(q.page).toBe(0);
  });

  it("starts ascending again on a different column", () => {
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "object_type");
    expect(layerQuery(useQueryStore.getState(), "L1").sort).toEqual({
      column: "object_type",
      dir: "asc",
    });
  });
});

describe("paging", () => {
  it("clamps a negative page to zero", () => {
    useQueryStore.getState().setPage("L1", -2);
    expect(layerQuery(useQueryStore.getState(), "L1").page).toBe(0);
  });

  it("resets the page when the page size changes", () => {
    useQueryStore.getState().setPage("L1", 7);
    useQueryStore.getState().setPageSize("L1", 500);
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.pageSize).toBe(500);
    expect(q.page).toBe(0);
  });
});

describe("syncToMap and reset", () => {
  it("records the toggle", () => {
    useQueryStore.getState().setSyncToMap("L1", true);
    expect(layerQuery(useQueryStore.getState(), "L1").syncToMap).toBe(true);
  });

  it("resetQuery drops the layer's entry entirely", () => {
    useQueryStore.getState().setSyncToMap("L1", true);
    useQueryStore.getState().resetQuery("L1");
    expect(useQueryStore.getState().queries.L1).toBeUndefined();
    expect(layerQuery(useQueryStore.getState(), "L1")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/features/query/queryStore.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/features/query/types.ts`**

```ts
/**
 * The query a user builds over ONE layer's DuckDB table — engine-free, so the
 * SQL builders, the filter bar and the tests all read one vocabulary.
 *
 * SESSION state, deliberately: none of this is in the v3 snapshot or a share
 * link, for the same reason `activeGeoLayerId` is not. A restored workspace
 * opens on an unfiltered table, which is the honest starting point — a
 * restored filter would also have to restore the map filtering it drives, and
 * a saved predicate can name a column a re-linked file does not have.
 */

export type FilterOp =
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

export type FilterValue = string | number | boolean | ReadonlyArray<string>;

export interface FilterCondition {
  readonly id: string;
  readonly column: string;
  readonly op: FilterOp;
  readonly value: FilterValue;
}

export interface FilterGroup {
  /** One logic for the whole group. Nested groups are deliberately out of
   *  scope: a two-level builder in a 320 px panel costs more than it buys,
   *  and AND/OR over a flat list covers the questions this data invites. */
  readonly logic: "AND" | "OR";
  readonly conditions: ReadonlyArray<FilterCondition>;
}

export type PageSize = 100 | 500 | 1000;

export const PAGE_SIZES: ReadonlyArray<PageSize> = [100, 500, 1000];

export interface LayerQuery {
  /** The DRAFT edited in the bar — never itself queried. */
  readonly filter: FilterGroup;
  /** What the grid and the map currently use; `null` means no filter. Apply
   *  is an EXPLICIT act, never per keystroke: applying can rebuild geometry. */
  readonly applied: FilterGroup | null;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly page: number;
  readonly pageSize: PageSize;
  readonly syncToMap: boolean;
}

export const EMPTY_FILTER: FilterGroup = Object.freeze({
  logic: "AND",
  conditions: Object.freeze([]) as ReadonlyArray<FilterCondition>,
});

export const DEFAULT_LAYER_QUERY: LayerQuery = Object.freeze({
  filter: EMPTY_FILTER,
  applied: null,
  sort: null,
  page: 0,
  pageSize: 100 as PageSize,
  syncToMap: false,
});

/** Whether an operator takes no value — the bar hides its value input. */
export function isNullaryOp(op: FilterOp): boolean {
  return op === "isNull" || op === "isNotNull";
}
```

- [ ] **Step 4: Write `src/features/query/queryStore.ts`**

```ts
/**
 * One {@link LayerQuery} per layer, session only.
 *
 * Keyed by layer id rather than held on the layer, because none of it is
 * layer DATA: a layer that is removed and re-added is a different table, and
 * `resetQuery` is what the table lifecycle calls when a rebuild invalidates a
 * predicate written against the old columns.
 */

import { create } from "zustand";
import {
  DEFAULT_LAYER_QUERY,
  EMPTY_FILTER,
  type FilterGroup,
  type LayerQuery,
  type PageSize,
} from "./types";

export interface QueryStoreState {
  readonly queries: Readonly<Record<string, LayerQuery>>;
}

export interface QueryStoreActions {
  setFilter: (layerId: string, filter: FilterGroup) => void;
  /** Draft -> applied, page back to 0. An EMPTY draft applies `null`, so
   *  "Apply" on a cleared bar means "no filter" rather than "a filter that
   *  matches everything" — the two differ for the map sync. */
  applyFilter: (layerId: string) => void;
  clearFilter: (layerId: string) => void;
  setSort: (layerId: string, sort: LayerQuery["sort"]) => void;
  /** Header click: same column flips direction, a new column starts asc. */
  toggleSort: (layerId: string, column: string) => void;
  setPage: (layerId: string, page: number) => void;
  setPageSize: (layerId: string, pageSize: PageSize) => void;
  setSyncToMap: (layerId: string, on: boolean) => void;
  resetQuery: (layerId: string) => void;
}

export type QueryStore = QueryStoreState & QueryStoreActions;

/** The layer's query, defaulted. Never undefined, so no caller needs a
 *  fallback of its own (and none can invent a different default). */
export function layerQuery(
  state: QueryStoreState,
  layerId: string,
): LayerQuery {
  return state.queries[layerId] ?? DEFAULT_LAYER_QUERY;
}

function patch(
  state: QueryStoreState,
  layerId: string,
  next: (current: LayerQuery) => LayerQuery,
): QueryStoreState {
  return {
    queries: {
      ...state.queries,
      [layerId]: next(layerQuery(state, layerId)),
    },
  };
}

export const useQueryStore = create<QueryStore>((set) => ({
  queries: {},

  setFilter: (layerId, filter) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, filter }))),

  applyFilter: (layerId) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        applied: q.filter.conditions.length === 0 ? null : q.filter,
        page: 0,
      })),
    ),

  clearFilter: (layerId) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        filter: EMPTY_FILTER,
        applied: null,
        page: 0,
      })),
    ),

  setSort: (layerId, sort) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, sort, page: 0 }))),

  toggleSort: (layerId, column) =>
    set((s) =>
      patch(s, layerId, (q) => ({
        ...q,
        sort:
          q.sort?.column === column
            ? { column, dir: q.sort.dir === "asc" ? "desc" : "asc" }
            : { column, dir: "asc" },
        page: 0,
      })),
    ),

  setPage: (layerId, page) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, page: Math.max(0, page) }))),

  setPageSize: (layerId, pageSize) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, pageSize, page: 0 }))),

  setSyncToMap: (layerId, on) =>
    set((s) => patch(s, layerId, (q) => ({ ...q, syncToMap: on }))),

  resetQuery: (layerId) =>
    set((s) => {
      if (!(layerId in s.queries)) return s;
      const queries = { ...s.queries };
      delete queries[layerId];
      return { queries };
    }),
}));
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/unit/features/query/queryStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/query tests/unit/features/query
git commit -m "$(cat <<'EOF'
feat(query): per-layer filter/sort/page store, session only

Apply is an explicit action, never per keystroke: applying can rebuild
geometry. An EMPTY draft applies null rather than a match-everything
predicate, because the two differ for the map sync — null means "no filter",
an empty result set means "hide everything".

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 9: SQL builders, part 1 — quoting and `compileFilter`

**Files:**

- Create: `src/analytics/sql.ts`
- Test: `tests/unit/analytics/sqlFilter.test.ts`

**Interfaces:**

- Consumes: `ColumnInfo`, `isTextColumn` (Task 5); `FilterGroup`, `FilterCondition`, `FilterOp` (Task 8).
- Produces:

```ts
export type CompileResult =
  | { readonly ok: true; readonly where: string | null }
  | { readonly ok: false; readonly message: string };

export function quoteIdent(name: string): string;
export function quoteLiteral(value: string | number | boolean): string;
export function escapeLikeNeedle(needle: string): string;
export function compileFilter(
  group: FilterGroup,
  columns: ReadonlyArray<ColumnInfo>,
): CompileResult;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/sqlFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  compileFilter,
  escapeLikeNeedle,
  quoteIdent,
  quoteLiteral,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";
import type { FilterGroup } from "../../../src/features/query/types";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
  { name: "oorspronkelijkbouwjaar", type: "BIGINT", kind: "castText" },
  { name: "geconstateerd", type: "BOOLEAN", kind: "scalar" },
  { name: "geometry_lod2_2", type: "BLOB", kind: "blob" },
];

function group(
  conditions: FilterGroup["conditions"],
  logic: "AND" | "OR" = "AND",
): FilterGroup {
  return { logic, conditions };
}

describe("quoteIdent", () => {
  it("wraps in double quotes and doubles an embedded quote", () => {
    expect(quoteIdent("id")).toBe('"id"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe("quoteLiteral", () => {
  it("wraps a string in single quotes, doubling embedded ones", () => {
    expect(quoteLiteral("Building")).toBe("'Building'");
    expect(quoteLiteral("O'Hara")).toBe("'O''Hara'");
  });

  it("renders a finite number bare and a boolean as a keyword", () => {
    expect(quoteLiteral(10)).toBe("10");
    expect(quoteLiteral(-2.5)).toBe("-2.5");
    expect(quoteLiteral(true)).toBe("TRUE");
    expect(quoteLiteral(false)).toBe("FALSE");
  });

  it("throws on a non-finite number", () => {
    expect(() => quoteLiteral(Number.NaN)).toThrow();
    expect(() => quoteLiteral(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("escapeLikeNeedle", () => {
  it("escapes the wildcards and the escape character itself", () => {
    expect(escapeLikeNeedle("100%")).toBe("100\\%");
    expect(escapeLikeNeedle("a_b")).toBe("a\\_b");
    expect(escapeLikeNeedle("c:\\x")).toBe("c:\\\\x");
  });
});

describe("compileFilter", () => {
  it("is null for an empty group", () => {
    expect(compileFilter(group([]), COLUMNS)).toEqual({
      ok: true,
      where: null,
    });
  });

  it("compiles an equality on a text column", () => {
    expect(
      compileFilter(
        group([
          { id: "c1", column: "object_type", op: "=", value: "Building" },
        ]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"object_type" = 'Building'` });
  });

  it("compiles every comparison operator", () => {
    for (const op of ["=", "!=", "<", "<=", ">", ">="] as const) {
      expect(
        compileFilter(
          group([{ id: "c", column: "b3_h_dak_max", op, value: 10 }]),
          COLUMNS,
        ),
      ).toEqual({ ok: true, where: `"b3_h_dak_max" ${op} 10` });
    }
  });

  it("compiles a boolean literal", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: true }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"geconstateerd" = TRUE` });
  });

  it("compiles a castText column against a string literal and lets DuckDB cast", () => {
    expect(
      compileFilter(
        group([
          {
            id: "c",
            column: "oorspronkelijkbouwjaar",
            op: ">=",
            value: "1900",
          },
        ]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"oorspronkelijkbouwjaar" >= '1900'` });
  });

  it("compiles the LIKE family with an ESCAPE clause and an escaped needle", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "contains", value: "50%_a" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: true,
      where: `"id" LIKE '%50\\%\\_a%' ESCAPE '\\'`,
    });
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "startsWith", value: "NL." }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"id" LIKE 'NL.%' ESCAPE '\\'` });
    expect(
      compileFilter(
        group([{ id: "c", column: "id", op: "endsWith", value: "-0" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"id" LIKE '%-0' ESCAPE '\\'` });
  });

  it("compiles the null tests without a value", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "isNull", value: "" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"parents" IS NULL` });
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "isNotNull", value: "" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"parents" IS NOT NULL` });
  });

  it("compiles IN over a list", () => {
    expect(
      compileFilter(
        group([
          {
            id: "c",
            column: "object_type",
            op: "in",
            value: ["Building", "BuildingPart"],
          },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: true,
      where: `"object_type" IN ('Building', 'BuildingPart')`,
    });
  });

  it("joins with the group's logic", () => {
    const conditions = [
      { id: "c1", column: "object_type", op: "=" as const, value: "Building" },
      { id: "c2", column: "b3_h_dak_max", op: ">" as const, value: 10 },
    ];
    expect(compileFilter(group(conditions, "AND"), COLUMNS)).toEqual({
      ok: true,
      where: `"object_type" = 'Building' AND "b3_h_dak_max" > 10`,
    });
    expect(compileFilter(group(conditions, "OR"), COLUMNS)).toEqual({
      ok: true,
      where: `"object_type" = 'Building' OR "b3_h_dak_max" > 10`,
    });
  });

  it("rejects an unknown column with a sentence", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "nope", op: "=", value: "x" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: 'This layer has no column called "nope".',
    });
  });

  it("rejects a nested column outright", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "parents", op: "=", value: "B1" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message:
        '"parents" holds VARCHAR[] values, which cannot be compared — only IS NULL / IS NOT NULL work on it.',
    });
  });

  it("rejects a blob column outright", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geometry_lod2_2", op: "=", value: "x" }]),
        COLUMNS,
      ).ok,
    ).toBe(false);
  });

  it("rejects a text operator on a non-text column", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: "contains", value: "1" },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"contains" needs a text column; "b3_h_dak_max" is DOUBLE.',
    });
  });

  it("rejects IN without a list", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "object_type", op: "in", value: "Building" },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message:
        '"in" needs a list of values; "object_type" was given one value.',
    });
  });

  it("rejects an empty IN list", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "object_type", op: "in", value: [] }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"in" needs at least one value for "object_type".',
    });
  });

  it("rejects a non-finite number rather than emitting NaN into SQL", () => {
    expect(
      compileFilter(
        group([
          { id: "c", column: "b3_h_dak_max", op: ">", value: Number.NaN },
        ]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"b3_h_dak_max" needs a number; "NaN" is not one.',
    });
  });

  it("coerces a RAW STRING against a numeric column", () => {
    // The bar keeps what the user typed — "1." on the way to "1.5" would be
    // eaten by a parse-as-you-type input — so the coercion happens here.
    expect(
      compileFilter(
        group([{ id: "c", column: "b3_h_dak_max", op: ">", value: "1.5" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"b3_h_dak_max" > 1.5` });
  });

  it("refuses text against a numeric column, with a sentence", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "b3_h_dak_max", op: ">", value: "abc" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"b3_h_dak_max" needs a number; "abc" is not one.',
    });
  });

  it("refuses an EMPTY value rather than emitting \"col\" > ''", () => {
    for (const column of ["b3_h_dak_max", "id"]) {
      expect(
        compileFilter(
          group([{ id: "c", column, op: ">", value: "   " }]),
          COLUMNS,
        ),
      ).toEqual({
        ok: false,
        message: `"${column}" needs a value for this comparison.`,
      });
    }
  });

  it("reads true/false text against a BOOLEAN column", () => {
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: "true" }]),
        COLUMNS,
      ),
    ).toEqual({ ok: true, where: `"geconstateerd" = TRUE` });
    expect(
      compileFilter(
        group([{ id: "c", column: "geconstateerd", op: "=", value: "ja" }]),
        COLUMNS,
      ),
    ).toEqual({
      ok: false,
      message: '"geconstateerd" is a true/false column; "ja" is neither.',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/sqlFilter.test.ts`
Expected: FAIL — `src/analytics/sql` not found.

- [ ] **Step 3: Write `src/analytics/sql.ts`**

```ts
/**
 * Every SQL string this feature sends to DuckDB, as PURE functions of the
 * layer's columns and the user's query.
 *
 * Pure on purpose, and tested against exact strings: the alternative is SQL
 * assembled inside a React effect, where the only way to see what was actually
 * sent is to break in a browser. Identifiers come from a DESCRIBE (so they are
 * whatever a third party's file named its attributes) and literals come from a
 * text input, so both are quoted here and nowhere else.
 *
 * No engine import — every builder returns a string the caller hands to
 * `runQuery`/`ddl` from `analytics/duckdb.ts`.
 */

import { isTextColumn, type ColumnInfo } from "./columnKind";
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
  FilterValue,
} from "../features/query/types";

export type CompileResult =
  | { readonly ok: true; readonly where: string | null }
  | { readonly ok: false; readonly message: string };

/** A DuckDB identifier, `"` doubled. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A DuckDB literal.
 *
 * A number must be FINITE: `NaN`/`Infinity` stringify to tokens DuckDB parses
 * as identifiers, so the predicate would fail at bind time with a message
 * about a missing column — a lie about which part of the filter is wrong.
 */
export function quoteLiteral(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("not a finite number");
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replace(/'/g, "''")}'`;
}

/** `%`, `_` and the escape character itself, neutralised inside a LIKE
 *  needle. Without this, typing "50%" in a "contains" box matches everything
 *  starting "50". */
export function escapeLikeNeedle(needle: string): string {
  return needle.replace(/([\\%_])/g, "\\$1");
}

const COMPARISONS = new Set<FilterOp>(["=", "!=", "<", "<=", ">", ">="]);
const LIKE_OPS = new Set<FilterOp>(["contains", "startsWith", "endsWith"]);

/** The scalar types a comparison reads as a NUMBER. Everything else scalar is
 *  VARCHAR or BOOLEAN; everything else entirely is `castText`, which takes a
 *  string literal and lets DuckDB do the cast. */
const NUMERIC_TYPES = new Set([
  "DOUBLE",
  "FLOAT",
  "REAL",
  "INTEGER",
  "SMALLINT",
  "TINYINT",
  "UINTEGER",
  "USMALLINT",
  "UTINYINT",
]);

/**
 * The SQL literal for a comparison against `column`.
 *
 * The coercion lives HERE, not in the filter bar's input handler, and that is
 * the whole point: an input that parsed as it typed could not accept "1." on
 * the way to "1.5" (`Number("1.")` re-renders as "1", so the decimal point is
 * eaten as fast as it is typed) and could never hold "-" on the way to "-3".
 * `FilterCondition.value` therefore keeps the RAW string, and the column's own
 * type decides what it means at the moment the SQL is built.
 *
 * A value that arrives already typed — a number or a boolean, from a
 * programmatic caller or a restored draft — is honoured as-is.
 */
function literalFor(
  column: ColumnInfo,
  value: string | number | boolean,
): { ok: true; sql: string } | { ok: false; message: string } {
  const type = column.type.trim().toUpperCase();

  if (typeof value === "string" && value.trim() === "") {
    return {
      ok: false,
      message: `"${column.name}" needs a value for this comparison.`,
    };
  }

  if (typeof value === "boolean" || type === "BOOLEAN") {
    if (typeof value === "boolean")
      return { ok: true, sql: quoteLiteral(value) };
    const text = String(value).trim().toLowerCase();
    if (text === "true" || text === "false") {
      return { ok: true, sql: quoteLiteral(text === "true") };
    }
    return {
      ok: false,
      message: `"${column.name}" is a true/false column; "${String(value)}" is neither.`,
    };
  }

  if (column.kind === "scalar" && NUMERIC_TYPES.has(type)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        message: `"${column.name}" needs a number; "${String(value)}" is not one.`,
      };
    }
    return { ok: true, sql: quoteLiteral(n) };
  }

  // VARCHAR, and every `castText` type (BIGINT, DECIMAL, DATE, TIMESTAMP…):
  // a string literal, which DuckDB casts with its own knowledge of its own
  // date and numeric formats.
  return { ok: true, sql: quoteLiteral(String(value)) };
}

/**
 * Is this condition's value a LIST?
 *
 * A hand-written predicate, not a bare `Array.isArray`, because that one's
 * built-in signature is `arg is any[]` — it narrows the TRUE branch but leaves
 * `ReadonlyArray<string>` in the union on the FALSE branch, so `quoteLiteral`
 * (which takes a scalar) fails to typecheck. It also does not narrow the true
 * branch to `ReadonlyArray<string>`, so `.map` over it loses its element type.
 */
function isValueList(value: FilterValue): value is ReadonlyArray<string> {
  return Array.isArray(value);
}

function likePattern(op: FilterOp, needle: string): string {
  const escaped = escapeLikeNeedle(needle);
  if (op === "startsWith") return `${escaped}%`;
  if (op === "endsWith") return `%${escaped}`;
  return `%${escaped}%`;
}

/** One condition as SQL, or the sentence explaining why it cannot be. */
function compileCondition(
  condition: FilterCondition,
  byName: ReadonlyMap<string, ColumnInfo>,
): { ok: true; sql: string } | { ok: false; message: string } {
  const column = byName.get(condition.column);
  if (!column) {
    return {
      ok: false,
      message: `This layer has no column called "${condition.column}".`,
    };
  }
  const ident = quoteIdent(column.name);

  if (condition.op === "isNull") return { ok: true, sql: `${ident} IS NULL` };
  if (condition.op === "isNotNull") {
    return { ok: true, sql: `${ident} IS NOT NULL` };
  }

  // A LIST, STRUCT or BLOB has no ordering and no equality a user could mean;
  // the null tests above are the only honest questions to ask of one.
  if (column.kind === "nested" || column.kind === "blob") {
    return {
      ok: false,
      message: `"${column.name}" holds ${column.type} values, which cannot be compared — only IS NULL / IS NOT NULL work on it.`,
    };
  }

  if (LIKE_OPS.has(condition.op)) {
    if (!isTextColumn(column)) {
      return {
        ok: false,
        message: `"${condition.op}" needs a text column; "${column.name}" is ${column.type}.`,
      };
    }
    const needle =
      typeof condition.value === "string"
        ? condition.value
        : String(condition.value);
    return {
      ok: true,
      sql: `${ident} LIKE ${quoteLiteral(likePattern(condition.op, needle))} ESCAPE '\\'`,
    };
  }

  if (condition.op === "in") {
    if (!isValueList(condition.value)) {
      return {
        ok: false,
        message: `"in" needs a list of values; "${column.name}" was given one value.`,
      };
    }
    if (condition.value.length === 0) {
      return {
        ok: false,
        message: `"in" needs at least one value for "${column.name}".`,
      };
    }
    const list = condition.value.map((v) => quoteLiteral(v)).join(", ");
    return { ok: true, sql: `${ident} IN (${list})` };
  }

  if (!COMPARISONS.has(condition.op)) {
    return {
      ok: false,
      message: `"${condition.op}" is not an operator this filter understands.`,
    };
  }
  if (isValueList(condition.value)) {
    return {
      ok: false,
      message: `"${condition.op}" takes one value, not a list, for "${column.name}".`,
    };
  }
  const literal = literalFor(column, condition.value);
  if (!literal.ok) return { ok: false, message: literal.message };
  return { ok: true, sql: `${ident} ${condition.op} ${literal.sql}` };
}

/**
 * The group as one WHERE clause, or the first reason it cannot compile.
 *
 * Rejected AT COMPILE TIME, before the query is sent: an unknown column or a
 * type-family mismatch would otherwise come back as a DuckDB bind error whose
 * wording is about SQL rather than about the row the user was editing.
 *
 * The clause is returned WITHOUT outer parentheses. Callers that embed it
 * beside another predicate wrap it themselves — see {@link buildExportWhere}.
 */
export function compileFilter(
  group: FilterGroup,
  columns: ReadonlyArray<ColumnInfo>,
): CompileResult {
  if (group.conditions.length === 0) return { ok: true, where: null };
  const byName = new Map(columns.map((c) => [c.name, c]));
  const parts: string[] = [];
  for (const condition of group.conditions) {
    const compiled = compileCondition(condition, byName);
    if (!compiled.ok) return { ok: false, message: compiled.message };
    parts.push(compiled.sql);
  }
  return { ok: true, where: parts.join(` ${group.logic} `) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/sqlFilter.test.ts`
Expected: PASS — every quoting, operator and rejection case green.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/sql.ts tests/unit/analytics/sqlFilter.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): SQL quoting and compileFilter

Identifiers come from a DESCRIBE of a third party's file and literals from a
text input, so both are quoted in exactly one place. A condition naming an
unknown column, or an operator its column's kind cannot take, is refused
BEFORE the query is sent — a DuckDB bind error is worded about SQL, not about
the row the user was editing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 10: SQL builders, part 2 — projection, paging, counts, feature ids

**Files:**

- Modify: `src/analytics/sql.ts`
- Test: `tests/unit/analytics/sqlQuery.test.ts`

**Interfaces:**

- Consumes: Task 9's `quoteIdent` / `quoteLiteral`, `ColumnInfo`.
- Produces:

```ts
/** The SELECT expression for one column, or null when it is not shown. */
export function projectColumn(column: ColumnInfo): string | null;
/** The columns a grid can show, blobs dropped. */
export function gridColumns(
  columns: ReadonlyArray<ColumnInfo>,
): ReadonlyArray<ColumnInfo>;
export function buildPageSql(
  table: string,
  columns: ReadonlyArray<ColumnInfo>,
  where: string | null,
  sort: { readonly column: string; readonly dir: "asc" | "desc" } | null,
  page: number,
  pageSize: number,
): string;
export function buildCountSql(table: string, where: string | null): string;
export function buildFeatureIdsSql(table: string, where: string | null): string;
export function buildRootTypesSql(table: string): string;
/** `COALESCE("feature_id", "id") IN (SELECT … WHERE <where>)`, or null. */
export function buildFeatureScopeWhere(
  table: string,
  where: string | null,
): string | null;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/sqlQuery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildCountSql,
  buildFeatureIdsSql,
  buildFeatureScopeWhere,
  buildPageSql,
  buildRootTypesSql,
  gridColumns,
  projectColumn,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

describe("projectColumn", () => {
  it("passes a scalar through", () => {
    expect(projectColumn({ name: "id", type: "VARCHAR", kind: "scalar" })).toBe(
      '"id"',
    );
  });

  it("casts a castText column to VARCHAR under its own name", () => {
    expect(
      projectColumn({ name: "bouwjaar", type: "BIGINT", kind: "castText" }),
    ).toBe('"bouwjaar"::VARCHAR AS "bouwjaar"');
  });

  it("wraps a nested column in to_json under its own name", () => {
    expect(
      projectColumn({ name: "parents", type: "VARCHAR[]", kind: "nested" }),
    ).toBe('to_json("parents") AS "parents"');
  });

  it("drops a blob", () => {
    expect(
      projectColumn({ name: "geometry_lod2_2", type: "BLOB", kind: "blob" }),
    ).toBeNull();
  });
});

describe("gridColumns", () => {
  it("keeps everything but the blobs, in order", () => {
    const withBlob = [
      ...COLUMNS,
      { name: "g", type: "BLOB", kind: "blob" as const },
    ];
    expect(gridColumns(withBlob).map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "parents",
      "b3_h_dak_max",
    ]);
  });
});

describe("buildPageSql", () => {
  it("builds the whole statement, exactly", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        `"object_type" = 'Building'`,
        { column: "b3_h_dak_max", dir: "desc" },
        2,
        500,
      ),
    ).toBe(
      'SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE "object_type" = \'Building\' ORDER BY "b3_h_dak_max" DESC NULLS LAST LIMIT 500 OFFSET 1000',
    );
  });

  it("omits the WHERE and the ORDER BY when there are none", () => {
    expect(buildPageSql("layer_1", COLUMNS, null, null, 0, 100)).toBe(
      'SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" LIMIT 100 OFFSET 0',
    );
  });

  it("sorts ascending with NULLS LAST too", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "id", dir: "asc" },
        0,
        100,
      ),
    ).toContain('ORDER BY "id" ASC NULLS LAST');
  });

  it("refuses to sort on a nested column, dropping the ORDER BY", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "parents", dir: "asc" },
        0,
        100,
      ),
    ).not.toContain("ORDER BY");
  });

  it("refuses to sort on a column the table does not have", () => {
    expect(
      buildPageSql(
        "layer_1",
        COLUMNS,
        null,
        { column: "gone", dir: "asc" },
        0,
        100,
      ),
    ).not.toContain("ORDER BY");
  });

  it("selects 1 when every column is a blob, so the page query still binds", () => {
    expect(
      buildPageSql(
        "layer_1",
        [{ name: "g", type: "BLOB", kind: "blob" }],
        null,
        null,
        0,
        10,
      ),
    ).toBe('SELECT 1 FROM "layer_1" LIMIT 10 OFFSET 0');
  });
});

describe("buildCountSql", () => {
  it("counts everything", () => {
    expect(buildCountSql("layer_1", null)).toBe(
      'SELECT COUNT(*) AS "n" FROM "layer_1"',
    );
  });

  it("counts the filtered rows", () => {
    expect(buildCountSql("layer_1", `"object_type" = 'Building'`)).toBe(
      'SELECT COUNT(*) AS "n" FROM "layer_1" WHERE "object_type" = \'Building\'',
    );
  });
});

describe("buildFeatureIdsSql", () => {
  it("expands matches to their whole feature, COALESCEd on both sides", () => {
    expect(buildFeatureIdsSql("layer_1", `"b3_h_dak_max" > 10`)).toBe(
      'SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("returns every id when there is no filter", () => {
    expect(buildFeatureIdsSql("layer_1", null)).toBe(
      'SELECT "id" FROM "layer_1"',
    );
  });
});

describe("buildFeatureScopeWhere", () => {
  it("is null for no filter", () => {
    expect(buildFeatureScopeWhere("layer_1", null)).toBeNull();
  });

  it("is the positive IN form", () => {
    expect(
      buildFeatureScopeWhere("layer_1", `"object_type" = 'Building'`),
    ).toBe(
      'COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "object_type" = \'Building\')',
    );
  });
});

describe("buildRootTypesSql", () => {
  it("lists the TOP-LEVEL object types — the rows with no parents", () => {
    expect(buildRootTypesSql("layer_1")).toBe(
      'SELECT DISTINCT "object_type" AS "value" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1',
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/sqlQuery.test.ts`
Expected: FAIL — the builders are not exported.

- [ ] **Step 3: Append the builders to `src/analytics/sql.ts`**

```ts
// ---------------------------------------------------------------------------
// Browsing: projection, paging, counts, feature ids
// ---------------------------------------------------------------------------

/**
 * How one column reaches the grid.
 *
 * `scalar` crosses raw; `castText` is cast IN SQL because DuckDB knows its own
 * formatting for a DATE, a TIMESTAMP or a HUGEINT and JS does not (a BIGINT
 * arrives as a `BigInt`, which `JSON.stringify` refuses outright); `nested`
 * goes through `to_json`, which yields a plain `Utf8` and leaves NULL as null;
 * `blob` is not shown at all — geometry WKB in a table cell is noise.
 */
export function projectColumn(column: ColumnInfo): string | null {
  const ident = quoteIdent(column.name);
  switch (column.kind) {
    case "scalar":
      return ident;
    case "castText":
      return `${ident}::VARCHAR AS ${ident}`;
    case "nested":
      return `to_json(${ident}) AS ${ident}`;
    case "blob":
      return null;
  }
}

/** The columns a grid shows, in table order. */
export function gridColumns(
  columns: ReadonlyArray<ColumnInfo>,
): ReadonlyArray<ColumnInfo> {
  return columns.filter((c) => c.kind !== "blob");
}

/** ORDER BY is offered only for a column that HAS an order: a LIST or a
 *  STRUCT sorts by a rule nobody could predict from the header. */
function orderClause(
  columns: ReadonlyArray<ColumnInfo>,
  sort: { readonly column: string; readonly dir: "asc" | "desc" } | null,
): string {
  if (sort === null) return "";
  const column = columns.find((c) => c.name === sort.column);
  if (!column) return "";
  if (column.kind !== "scalar" && column.kind !== "castText") return "";
  // NULLS LAST in both directions: a page of nulls at the top of a descending
  // sort is the one thing nobody clicks a header to see.
  return ` ORDER BY ${quoteIdent(column.name)} ${sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`;
}

export function buildPageSql(
  table: string,
  columns: ReadonlyArray<ColumnInfo>,
  where: string | null,
  sort: { readonly column: string; readonly dir: "asc" | "desc" } | null,
  page: number,
  pageSize: number,
): string {
  const projections = columns
    .map(projectColumn)
    .filter((p): p is string => p !== null);
  // `SELECT 1` rather than `SELECT ` for a table of nothing but blobs: an
  // empty select list does not bind, and the row count still has to work.
  const select = projections.length === 0 ? "1" : projections.join(", ");
  const whereClause = where === null ? "" : ` WHERE ${where}`;
  const offset = Math.max(0, page) * pageSize;
  return `SELECT ${select} FROM ${quoteIdent(table)}${whereClause}${orderClause(columns, sort)} LIMIT ${pageSize} OFFSET ${offset}`;
}

export function buildCountSql(table: string, where: string | null): string {
  const whereClause = where === null ? "" : ` WHERE ${where}`;
  return `SELECT COUNT(*) AS "n" FROM ${quoteIdent(table)}${whereClause}`;
}

/**
 * The scope predicate every FEATURE-wise operation shares.
 *
 * Always the POSITIVE `IN` form, and `COALESCE` on BOTH sides: a single NULL
 * `feature_id` makes a `NOT IN` predicate NULL, which hides nothing and looks
 * like a filter that silently did not apply. The COALESCE is what lets a root
 * object (whose `feature_id` may be its own id, or NULL in a fallback table)
 * match its own parts.
 */
export function buildFeatureScopeWhere(
  table: string,
  where: string | null,
): string | null {
  if (where === null) return null;
  const t = quoteIdent(table);
  return `COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM ${t} WHERE ${where})`;
}

/**
 * The ids the map should draw for `where`.
 *
 * Matches are expanded to their whole FEATURE, because attributes and geometry
 * live on different rows in real data: a `Building` carries the semantics and
 * a `BuildingPart` carries the shape, so filtering on `b3_h_dak_max > 10` and
 * drawing only the matching rows would draw nothing at all.
 */
export function buildFeatureIdsSql(
  table: string,
  where: string | null,
): string {
  const t = quoteIdent(table);
  const scope = buildFeatureScopeWhere(table, where);
  return scope === null
    ? `SELECT "id" FROM ${t}`
    : `SELECT "id" FROM ${t} WHERE ${scope}`;
}

/**
 * The layer's TOP-LEVEL object types — what the export dialog offers.
 *
 * `parents IS NULL` is the test, not a type-name heuristic: the reader writes
 * SQL NULL (never `[]`) for an object with no parents, so this is exactly the
 * set of feature roots. Parts follow their root into the export.
 */
export function buildRootTypesSql(table: string): string {
  return `SELECT DISTINCT "object_type" AS "value" FROM ${quoteIdent(table)} WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1`;
}
```

- [ ] **Step 4: Run both SQL test files**

Run: `npx vitest run tests/unit/analytics/sqlQuery.test.ts tests/unit/analytics/sqlFilter.test.ts`
Expected: PASS — both SQL suites green.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/sql.ts tests/unit/analytics/sqlQuery.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): page/count/feature-id/distinct SQL builders

buildFeatureIdsSql expands matches to their whole feature, because attributes
and geometry live on different rows in real data — a Building carries the
semantics, its BuildingPart the shape, so drawing only the matching rows would
draw nothing. Always the positive IN form with COALESCE on both sides: one
NULL feature_id makes a NOT IN predicate NULL and hides nothing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 11: SQL builders, part 3 — the export statements

**Files:**

- Modify: `src/analytics/sql.ts`
- Test: `tests/unit/analytics/sqlExport.test.ts`

**Interfaces:**

- Consumes: Task 10's `buildFeatureScopeWhere`, Task 5's `lodColumnSuffix`.
- Produces:

```ts
export type AttributeExportFormat = "parquet" | "csv" | "json";

export function buildAttributeExportSql(input: {
  readonly table: string;
  /** In output order, the fixed prefix included. */
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  readonly format: AttributeExportFormat;
  readonly outFile: string;
}): string;

/** The fixed columns every CityParquet object table must carry. */
export const CITYPARQUET_REQUIRED_COLUMNS: ReadonlyArray<string>;

/** ONE read of the source into a scratch table, filtered to the export's
 *  feature scope. Every module table is then cut from this. */
export function buildCityParquetSourceSql(input: {
  /** A schema of its own, so `cityparquet_init` never sees the scratch table. */
  readonly scratchSchema: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly sourceFile: string;
  /** The materialised layer table, which BOTH predicates read. */
  readonly table: string;
  readonly lod: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
}): string;

/** One `exp.<module>` table, cut from the scratch table by root type. */
export function buildCityParquetModuleSql(input: {
  readonly schema: string;
  readonly module: string;
  readonly scratchSchema: string;
  readonly table: string;
  readonly moduleTypes: ReadonlyArray<string>;
}): string;

/** The scratch table's name inside its schema. */
export const CITYPARQUET_SOURCE_TABLE: "src";
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/sqlExport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

describe("buildAttributeExportSql", () => {
  it("wraps the filtered SELECT in COPY … TO, with the feature scope", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: `"b3_h_dak_max" > 10`,
        format: "csv",
        outFile: "exp_1.csv",
      }),
    ).toBe(
      'COPY (SELECT "id", "feature_id", "object_type", to_json("parents") AS "parents", "b3_h_dak_max" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)) TO \'exp_1.csv\' (FORMAT csv)',
    );
  });

  it("keeps a nested column NATIVE for parquet, which can hold a list", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        format: "parquet",
        outFile: "exp_2.parquet",
      }),
    ).toBe(
      'COPY (SELECT "id", "feature_id", "object_type", "parents", "b3_h_dak_max" FROM "layer_1") TO \'exp_2.parquet\' (FORMAT parquet)',
    );
  });

  it("uses to_json for JSON, and names the format", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        format: "json",
        outFile: "exp_3.json",
      }),
    ).toContain("(FORMAT json)");
  });

  it("drops a blob column from every format", () => {
    expect(
      buildAttributeExportSql({
        table: "layer_1",
        columns: [
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "geometry_lod2_2", type: "BLOB", kind: "blob" },
        ],
        where: null,
        format: "csv",
        outFile: "x.csv",
      }),
    ).toBe('COPY (SELECT "id" FROM "layer_1") TO \'x.csv\' (FORMAT csv)');
  });
});

describe("buildCityParquetSourceSql", () => {
  it("reads the source ONCE into a scratch schema, with the feature scope", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "exp_src_1",
        reader: "read_cityjson",
        sourceFile: "exp_1_src.city.json",
        table: "layer_1",
        lod: "2.2",
        attributes: ["b3_h_dak_max", "bouwjaar"],
        where: `"b3_h_dak_max" > 10`,
      }),
    ).toBe(
      'CREATE TABLE "exp_src_1"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod2_2", "geometry_properties_lod2_2", "b3_h_dak_max", "bouwjaar" FROM read_cityjson(\'exp_1_src.city.json\') WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("omits the WHERE entirely when the whole layer is exported", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "exp_src_2",
        reader: "read_cityjsonseq",
        sourceFile: "exp_2_src.city.jsonl",
        table: "layer_3",
        lod: "1.2",
        attributes: [],
        where: null,
      }),
    ).toBe(
      'CREATE TABLE "exp_src_2"."src" AS SELECT "id", "feature_id", "object_type", "parents", "children", "children_roles", "bbox", "geometry_lod1_2", "geometry_properties_lod1_2" FROM read_cityjsonseq(\'exp_2_src.city.jsonl\')',
    );
  });

  it("always keeps the geometry_properties sidecar beside the geometry", () => {
    expect(
      buildCityParquetSourceSql({
        scratchSchema: "e",
        reader: "read_cityjson",
        sourceFile: "s.json",
        table: "t",
        lod: "0",
        attributes: [],
        where: null,
      }),
    ).toContain('"geometry_lod0", "geometry_properties_lod0"');
  });
});

describe("buildCityParquetModuleSql", () => {
  it("cuts a module table from the scratch table by ROOT type", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "exp_1",
        module: "building",
        scratchSchema: "exp_src_1",
        table: "layer_1",
        moduleTypes: ["Building"],
      }),
    ).toBe(
      'CREATE TABLE "exp_1"."building" AS SELECT * FROM "exp_src_1"."src" WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\'))',
    );
  });

  it("lists every type of the module", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "exp_2",
        module: "vegetation",
        scratchSchema: "exp_src_2",
        table: "layer_3",
        moduleTypes: ["PlantCover", "SolitaryVegetationObject"],
      }),
    ).toBe(
      'CREATE TABLE "exp_2"."vegetation" AS SELECT * FROM "exp_src_2"."src" WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_3" WHERE "parents" IS NULL AND "object_type" IN (\'PlantCover\', \'SolitaryVegetationObject\'))',
    );
  });

  it("escapes a quote in a type name rather than breaking out of the literal", () => {
    expect(
      buildCityParquetModuleSql({
        schema: "e",
        module: "generics",
        scratchSchema: "es",
        table: "t",
        moduleTypes: ["O'dd"],
      }),
    ).toContain(`IN ('O''dd')`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/sqlExport.test.ts`
Expected: FAIL — the three builders are not exported.

- [ ] **Step 3: Append the export builders to `src/analytics/sql.ts`**

Add the import of `lodColumnSuffix` to the existing `./columnKind` import, then append:

```ts
// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type AttributeExportFormat = "parquet" | "csv" | "json";

/**
 * `COPY (SELECT …) TO '<file>' (FORMAT …)` for the attribute formats.
 *
 * Nested columns stay NATIVE for parquet — the format holds a list — and go
 * through `to_json` for CSV and JSON, where an Arrow list would otherwise
 * arrive as DuckDB's own bracket spelling in one case and as a nested document
 * in the other. Blobs are excluded from every format: {@link projectColumn}
 * already refuses them, and geometry belongs in the CityParquet route.
 *
 * NOT offered here, and never to be added without re-probing: `FORMAT cityjson
 * | cityjsonseq | flatcitybuf` write ZERO BYTES in wasm, silently.
 */
export function buildAttributeExportSql(input: {
  readonly table: string;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  readonly format: AttributeExportFormat;
  readonly outFile: string;
}): string {
  const projections = input.columns
    .map((column) =>
      input.format === "parquet" && column.kind === "nested"
        ? quoteIdent(column.name)
        : projectColumn(column),
    )
    .filter((p): p is string => p !== null);
  const select = projections.length === 0 ? "1" : projections.join(", ");
  const scope = buildFeatureScopeWhere(input.table, input.where);
  const whereClause = scope === null ? "" : ` WHERE ${scope}`;
  return `COPY (SELECT ${select} FROM ${quoteIdent(input.table)}${whereClause}) TO ${quoteLiteral(input.outFile)} (FORMAT ${input.format})`;
}

/**
 * The columns a CityParquet object table must carry, whatever else is dropped.
 *
 * Measured, not guessed (probe P6g): attributes may go to zero and one LoD is
 * fine, but `id, feature_id, parents, children` must be present, and a
 * `geometry_lodX_Y` without its `geometry_properties_lodX_Y` sidecar fails
 * validation. `object_type`, `children_roles` and `bbox` are kept because the
 * writer's `metadata.json` reports them and a package without them is poorer
 * for no saving.
 */
export const CITYPARQUET_REQUIRED_COLUMNS: ReadonlyArray<string> = [
  "id",
  "feature_id",
  "object_type",
  "parents",
  "children",
  "children_roles",
  "bbox",
];

/** The scratch table's name inside its own schema. */
export const CITYPARQUET_SOURCE_TABLE = "src";

/**
 * ONE read of the re-registered source, filtered to the export's feature scope.
 *
 * The source is read again (rather than the layer's browsing table being
 * reused) because that table has no geometry in it at all — the entire point of
 * dropping the BLOB columns — and a CityParquet package without geometry is not
 * a package. But it is read exactly ONCE: cutting each module table straight
 * from the reader would re-parse the whole file per module, so a package with
 * buildings, vegetation and city furniture in it would parse a 300 MB CityJSON
 * three times over.
 *
 * The scratch table lives in a SCHEMA OF ITS OWN, not beside the module tables:
 * `cityparquet_init` describes every table in the schema it is given, and a
 * table called `src` is not a CityGML module.
 *
 * No `lod := …` argument: the explicit column list already names exactly one
 * LoD's geometry pair, and that is the route probed end to end (P6b/P6c/P6g).
 * `lod :=` narrows the SCHEMA rather than the rows and would only add a
 * bind-time failure mode for an LoD spelled differently than the file spells it.
 */
export function buildCityParquetSourceSql(input: {
  readonly scratchSchema: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly sourceFile: string;
  readonly table: string;
  readonly lod: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
}): string {
  const suffix = lodColumnSuffix(input.lod);
  const select = [
    ...CITYPARQUET_REQUIRED_COLUMNS,
    `geometry_lod${suffix}`,
    `geometry_properties_lod${suffix}`,
    ...input.attributes,
  ]
    .map(quoteIdent)
    .join(", ");
  const scope = buildFeatureScopeWhere(input.table, input.where);
  const whereClause = scope === null ? "" : ` WHERE ${scope}`;
  return `CREATE TABLE ${quoteIdent(input.scratchSchema)}.${quoteIdent(CITYPARQUET_SOURCE_TABLE)} AS SELECT ${select} FROM ${input.reader}(${quoteLiteral(input.sourceFile)})${whereClause}`;
}

/**
 * One `exp.<module>` table, cut from the scratch table.
 *
 * The MODULE predicate asks which table a feature belongs in by its ROOT's
 * type, so a BuildingPart follows its Building rather than being classified on
 * its own. It reads the LAYER table (which has `parents` and `object_type` for
 * every object) while the rows come from the scratch table.
 */
export function buildCityParquetModuleSql(input: {
  readonly schema: string;
  readonly module: string;
  readonly scratchSchema: string;
  readonly table: string;
  readonly moduleTypes: ReadonlyArray<string>;
}): string {
  const t = quoteIdent(input.table);
  const types = input.moduleTypes.map((v) => quoteLiteral(v)).join(", ");
  const modulePredicate = `COALESCE("feature_id", "id") IN (SELECT "id" FROM ${t} WHERE "parents" IS NULL AND "object_type" IN (${types}))`;
  return `CREATE TABLE ${quoteIdent(input.schema)}.${quoteIdent(input.module)} AS SELECT * FROM ${quoteIdent(input.scratchSchema)}.${quoteIdent(CITYPARQUET_SOURCE_TABLE)} WHERE ${modulePredicate}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/sqlExport.test.ts`
Expected: PASS — both export builders green.

- [ ] **Step 5: Type-check**

Run: `npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/sql.ts tests/unit/analytics/sqlExport.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): export SQL — COPY for attributes, one source read per package

The CityParquet route reads the RE-REGISTERED source rather than the browsing
table, because the browsing table has no geometry in it by design — but exactly
ONCE, into a scratch table in a schema of its own, from which each module table
is cut. Cutting straight from the reader would re-parse the whole file per
module, and cityparquet_init describes every table in the schema it is given,
so `src` cannot live beside them. The feature ROOT's type decides which object
table a feature lands in. No `lod :=` — the explicit column list already names
one LoD's geometry pair, and that is the route probed end to end.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 12: Flat-fallback rows — `CityModel` and resident records to reader-shaped rows

**Files:**

- Create: `src/analytics/layerRows.ts`
- Test: `tests/unit/analytics/layerRows.test.ts`

**Interfaces:**

- Consumes: `rootFeatureId`, `parentsIndexOf` (Task 6).
- Produces:

```ts
export interface FlatRow {
  readonly id: string;
  readonly feature_id: string;
  readonly object_type: string;
  readonly parents: ReadonlyArray<string> | null;
  readonly children: ReadonlyArray<string> | null;
  readonly [attribute: string]: unknown;
}

/** The columns every flat table carries, in order, before its attributes. */
export const FLAT_PREFIX_COLUMNS: ReadonlyArray<string>;
export function flatRowsFromModel(model: CityModel): FlatRow[];
export function flatRowsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): FlatRow[];
export function encodeRowsAsJson(rows: ReadonlyArray<FlatRow>): Uint8Array;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/layerRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
  flatRowsFromRecords,
} from "../../../src/analytics/layerRows";
import type { CityModel } from "../../../src/domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";

function model(): CityModel {
  return {
    sourceEncoding: "citygml",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: {
        id: "B1",
        objectType: "Building",
        attributes: { bouwjaar: 1920, tags: { a: 1 } },
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: [],
        children: ["B1-0"],
        lod: null,
      },
      "B1-0": {
        id: "B1-0",
        objectType: "BuildingPart",
        attributes: {},
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: ["B1"],
        children: [],
        lod: "2",
      },
    },
  } as unknown as CityModel;
}

function record(over: Partial<ResidentObjectRecord>): ResidentObjectRecord {
  return {
    id: "R1",
    objectType: "Building",
    attributes: {},
    bbox: [0, 0, 0, 1, 1, 1],
    lod: "2.2",
    surfaceCount: 3,
    roofMetrics: [],
    footprintAreaSqM: 1,
    volumeCuM: 1,
    parents: [],
    children: [],
    ...over,
  } as ResidentObjectRecord;
}

describe("flatRowsFromModel", () => {
  const rows = flatRowsFromModel(model());

  it("emits one row per object, in model order", () => {
    expect(rows.map((r) => r.id)).toEqual(["B1", "B1-0"]);
  });

  it("names the columns the way the reader does", () => {
    expect(rows[0]).toMatchObject({
      id: "B1",
      feature_id: "B1",
      object_type: "Building",
    });
  });

  it("gives a part its root's feature_id", () => {
    expect(rows[1]!.feature_id).toBe("B1");
  });

  it("writes NULL, not [], for absent parents and children", () => {
    expect(rows[0]!.parents).toBeNull();
    expect(rows[0]!.children).toEqual(["B1-0"]);
    expect(rows[1]!.parents).toEqual(["B1"]);
    expect(rows[1]!.children).toBeNull();
  });

  it("carries scalar attributes through and JSON-stringifies object ones", () => {
    expect(rows[0]!.bouwjaar).toBe(1920);
    expect(rows[0]!.tags).toBe('{"a":1}');
  });

  it("drops the old app-side derivations", () => {
    expect(rows[0]!.lod).toBeUndefined();
    expect(rows[0]!.surface_count).toBeUndefined();
  });

  it("never lets an attribute shadow a prefix column", () => {
    const m = model();
    (m.objects.B1 as { attributes: Record<string, unknown> }).attributes = {
      id: "SPOOF",
      object_type: "SPOOF",
      ok: 1,
    };
    const [row] = flatRowsFromModel(m);
    expect(row!.id).toBe("B1");
    expect(row!.object_type).toBe("Building");
    expect(row!.ok).toBe(1);
  });
});

describe("flatRowsFromRecords", () => {
  it("produces the same column vocabulary from resident records", () => {
    const rows = flatRowsFromRecords([
      record({ id: "R1", children: ["R1-0"] }),
      record({ id: "R1-0", objectType: "BuildingPart", parents: ["R1"] }),
    ]);
    expect(rows).toEqual([
      {
        id: "R1",
        feature_id: "R1",
        object_type: "Building",
        parents: null,
        children: ["R1-0"],
      },
      {
        id: "R1-0",
        feature_id: "R1",
        object_type: "BuildingPart",
        parents: ["R1"],
        children: null,
      },
    ]);
  });

  it("is empty for no residents", () => {
    expect(flatRowsFromRecords([])).toEqual([]);
  });
});

describe("encodeRowsAsJson", () => {
  it("encodes an array read_json_auto can read back", () => {
    const bytes = encodeRowsAsJson(flatRowsFromRecords([record({})]));
    const text = new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual([
      {
        id: "R1",
        feature_id: "R1",
        object_type: "Building",
        parents: null,
        children: null,
      },
    ]);
  });

  it("survives a BigInt attribute rather than throwing", () => {
    const rows = flatRowsFromRecords([
      record({ attributes: { big: BigInt("9007199254740993") } }),
    ]);
    const text = new TextDecoder().decode(encodeRowsAsJson(rows));
    expect(JSON.parse(text)[0].big).toBe("9007199254740993");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/layerRows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/analytics/layerRows.ts`:

```ts
/**
 * The FLAT-FALLBACK table's rows: what a layer with no DuckDB reader
 * (CityGML, a zipped CityGML archive, CityParquet, a streaming layer's
 * resident cells) contributes instead.
 *
 * The column names are ALIGNED to the reader's — `id, feature_id, object_type,
 * parents, children`, then one column per attribute — because the filter
 * builder, the export scope and the map-filter id set are written once and
 * must mean the same thing on every layer. `parents`/`children` are NULL when
 * empty, exactly as the reader writes them, so `parents IS NULL` really is the
 * "is this a feature root" test on both kinds of table.
 *
 * The old `lod` and `surface_count` columns are gone: they were app-side
 * derivations, not data, and no other layer kind has them.
 *
 * Pure — no engine import, no store.
 */

import type { CityModel } from "../domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import { parentsIndexOf, rootFeatureId } from "../domain/citymodel/featureId";

export interface FlatRow {
  readonly id: string;
  readonly feature_id: string;
  readonly object_type: string;
  readonly parents: ReadonlyArray<string> | null;
  readonly children: ReadonlyArray<string> | null;
  readonly [attribute: string]: unknown;
}

export const FLAT_PREFIX_COLUMNS: ReadonlyArray<string> = [
  "id",
  "feature_id",
  "object_type",
  "parents",
  "children",
];

const RESERVED = new Set(FLAT_PREFIX_COLUMNS);

/** An object's attributes as columns. A key that collides with a prefix
 *  column is DROPPED, not renamed: a file whose attribute is called `id`
 *  would otherwise silently replace the identity every join depends on. */
function attributeColumns(
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (RESERVED.has(key)) continue;
    out[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : value;
  }
  return out;
}

function emptyToNull(
  list: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | null {
  return list === undefined || list.length === 0 ? null : list;
}

export function flatRowsFromModel(model: CityModel): FlatRow[] {
  const parents = parentsIndexOf(model.objects);
  const rows: FlatRow[] = [];
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    rows.push({
      ...attributeColumns(obj.attributes),
      id,
      feature_id: rootFeatureId(id, parents),
      object_type: obj.objectType,
      parents: emptyToNull(obj.parents),
      children: emptyToNull(obj.children),
    });
  }
  return rows;
}

export function flatRowsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): FlatRow[] {
  const byId: Record<string, { readonly parents?: ReadonlyArray<string> }> = {};
  for (const r of records) byId[r.id] = { parents: r.parents };
  const parents = parentsIndexOf(byId);
  return records.map((r) => ({
    ...attributeColumns(r.attributes),
    id: r.id,
    feature_id: rootFeatureId(r.id, parents),
    object_type: r.objectType,
    parents: emptyToNull(r.parents),
    children: emptyToNull(r.children),
  }));
}

/**
 * The rows as UTF-8 JSON for `registerBuffer` + `read_json_auto`.
 *
 * BigInt is stringified rather than allowed to throw: a CityParquet or CityGML
 * attribute can genuinely be a 64-bit integer, and `JSON.stringify` refuses
 * one outright — which would fail the whole layer's table for one cell.
 */
export function encodeRowsAsJson(rows: ReadonlyArray<FlatRow>): Uint8Array {
  const json = JSON.stringify(rows, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new TextEncoder().encode(json);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/layerRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/layerRows.ts tests/unit/analytics/layerRows.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): flat-fallback rows aligned to the reader's column names

A layer with no DuckDB reader still publishes id/feature_id/object_type/
parents/children with the reader's exact semantics — parents NULL rather than
[] when empty, so `parents IS NULL` is the feature-root test on every layer.
The old lod/surface_count columns go: app-side derivations, not data.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 13: `layerTables.ts` — building one table per layer

**Files:**

- Create: `src/analytics/layerTables.ts`
- Test: `tests/unit/analytics/layerTablesBuild.test.ts`

**Interfaces:**

- Consumes: `runQuery`, `ddl`, `registerBuffer`, `dropBuffer` (Task 2); `classifyColumnType`, `isDroppedColumn`, `lodsFromColumnNames`, `ColumnInfo` (Task 5); `flatRowsFromModel`, `flatRowsFromRecords`, `encodeRowsAsJson` (Task 12); `quoteIdent` (Task 9).
- Produces:

```ts
export type SourceProvider = () => Promise<Uint8Array>;

export type LayerTableSource =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      readonly reader: "read_cityjson" | "read_cityjsonseq";
      /** VFS file extension, e.g. "city.json" / "city.jsonl". */
      readonly extension: string;
      /** Re-registers the same DECODED bytes for an export; the originals are
       *  gone (registering consumed them). `null` when this layer's bytes
       *  cannot be obtained again — the CityParquet format is then refused
       *  with that reason. */
      readonly provider: SourceProvider | null;
    }
  | { readonly kind: "model"; readonly model: CityModel }
  | {
      readonly kind: "resident";
      readonly records: () => ReadonlyArray<ResidentObjectRecord>;
    };

export interface LayerTable {
  readonly table: string;
  readonly sourceName: string | null;
  /** Null for a fallback table AND for a reader-backed one whose bytes cannot
   *  be re-obtained. */
  readonly source: SourceProvider | null;
  readonly reader: "read_cityjson" | "read_cityjsonseq" | null;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly lods: ReadonlyArray<string>;
  readonly rowCount: number;
}

export type LayerTableState =
  | { readonly state: "queued" }
  | { readonly state: "building" }
  | {
      readonly state: "ready";
      readonly info: LayerTable;
      /** A REBUILD is in flight over this still-usable table. The grid keeps
       *  showing `info` throughout; a rebuild that fails leaves it in place. */
      readonly rebuilding?: boolean;
    }
  | { readonly state: "failed"; readonly message: string };

export interface LayerTableStoreState {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  readonly tablePanelOpen: boolean;
}
export interface LayerTableStoreActions {
  setTablePanelOpen: (open: boolean) => void;
}
export const useLayerTableStore: UseBoundStore<
  StoreApi<LayerTableStoreState & LayerTableStoreActions>
>;

export function enqueueLayerTable(
  layerId: string,
  source: LayerTableSource,
): Promise<void>;
/** Try the engine again, and rebuild every table that failed ONLY because it
 *  was not running yet. Resolves once those builds have settled. */
export function retryEngine(): Promise<void>;
export function getLayerTable(layerId: string): LayerTable | null;
/** Test-only: clears the registry, the queue memo and the counter. */
export function resetLayerTablesForTest(): void;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/layerTablesBuild.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every SQL statement the module sent, in order. */
const sql: string[] = [];
/** Every VFS registration, name -> byte length. */
const registered: Array<{ name: string; length: number }> = [];
const dropped: string[] = [];
/** `DESCRIBE` answers, keyed by the substring that identifies the query. */
let describeRows: Record<string, unknown>[] = [];
let countValue = 0;
/** SQL substrings that must FAIL, mapped to their message. */
let failures: Record<string, string> = {};
/** The engine's readiness, and a gate to hold `initDuckDB` open with. */
let engineReady = true;
let initGate: Promise<void> | null = null;

vi.mock("../../../src/analytics/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    for (const [needle, message] of Object.entries(failures)) {
      if (statement.includes(needle)) return { ok: false as const, message };
    }
    if (statement.startsWith("DESCRIBE")) {
      return { ok: true as const, columns: [], rows: describeRows };
    }
    if (statement.includes("COUNT(*)")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: countValue }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {
      if (initGate) await initGate;
    }),
    getDuckDBStatus: vi.fn(() =>
      engineReady
        ? {
            state: "ready",
            extensions: {
              cityjson: { state: "loaded" },
              spatial: { state: "unloaded" },
              three_d: { state: "unloaded" },
            },
            loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
            platform: "wasm_eh",
          }
        : { state: "uninitialized" },
    ),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string, bytes: Uint8Array) => {
      registered.push({ name, length: bytes.length });
      return true;
    }),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const {
  enqueueLayerTable,
  getLayerTable,
  resetLayerTablesForTest,
  retryEngine,
  useLayerTableStore,
} = await import("../../../src/analytics/layerTables");
import type { CityModel } from "../../../src/domain/citymodel/types";

const READER_DESCRIBE = [
  { column_name: "id", column_type: "VARCHAR" },
  { column_name: "feature_id", column_type: "VARCHAR" },
  { column_name: "object_type", column_type: "VARCHAR" },
  { column_name: "parents", column_type: "VARCHAR[]" },
  { column_name: "bbox", column_type: "STRUCT(xmin DOUBLE)" },
  { column_name: "geometry_lod1_2", column_type: "BLOB" },
  {
    column_name: "geometry_properties_lod1_2",
    column_type: "STRUCT(a INTEGER)",
  },
  { column_name: "geometry_lod2_2", column_type: "BLOB" },
  {
    column_name: "geometry_properties_lod2_2",
    column_type: "STRUCT(a INTEGER)",
  },
  { column_name: "material_lod2_2", column_type: "INTEGER[]" },
  { column_name: "texture_lod2_2", column_type: "INTEGER[]" },
  { column_name: "template", column_type: "STRUCT(a INTEGER)" },
  { column_name: "b3_h_dak_max", column_type: "DOUBLE" },
  { column_name: "bouwjaar", column_type: "BIGINT" },
];

function model(): CityModel {
  return {
    sourceEncoding: "citygml",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: {
        id: "B1",
        objectType: "Building",
        attributes: { bouwjaar: 1920 },
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: [],
        children: [],
        lod: null,
      },
    },
  } as unknown as CityModel;
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  describeRows = READER_DESCRIBE;
  countValue = 2231;
  failures = {};
  engineReady = true;
  initGate = null;
  resetLayerTablesForTest();
  useLayerTableStore.setState({ tables: {} });
});

describe("reader-backed layer table", () => {
  async function build(): Promise<void> {
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    });
  }

  it("registers the bytes under the table's own name", async () => {
    await build();
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
  });

  it("describes the reader, then creates the table WITHOUT geometry columns", async () => {
    await build();
    expect(sql[0]).toBe(
      "DESCRIBE SELECT * FROM read_cityjson('layer_1.city.json')",
    );
    expect(sql[1]).toBe(
      'CREATE OR REPLACE TABLE "layer_1" AS SELECT "id", "feature_id", "object_type", "parents", "bbox", "b3_h_dak_max", "bouwjaar" FROM read_cityjson(\'layer_1.city.json\')',
    );
  });

  it("counts the rows and drops the source buffer", async () => {
    await build();
    expect(sql[2]).toBe('SELECT COUNT(*) AS "n" FROM "layer_1"');
    expect(dropped).toEqual(["layer_1.city.json"]);
  });

  it("publishes the table with its column kinds, LoDs and row count", async () => {
    await build();
    const info = getLayerTable("L1");
    expect(info).toMatchObject({
      table: "layer_1",
      sourceName: "layer_1.city.json",
      reader: "read_cityjson",
      rowCount: 2231,
      lods: ["1.2", "2.2"],
    });
    expect(info!.columns).toEqual([
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "feature_id", type: "VARCHAR", kind: "scalar" },
      { name: "object_type", type: "VARCHAR", kind: "scalar" },
      { name: "parents", type: "VARCHAR[]", kind: "nested" },
      { name: "bbox", type: "STRUCT(xmin DOUBLE)", kind: "nested" },
      { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
      { name: "bouwjaar", type: "BIGINT", kind: "castText" },
    ]);
    expect(info!.source).toBeTypeOf("function");
  });

  it("mirrors the outcome into the store", async () => {
    const promise = enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(16),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    });
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "queued",
    });
    await promise;
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("records a CREATE failure instead of throwing, and still drops the buffer", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await expect(build()).resolves.toBeUndefined();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "failed",
      message: "Binder Error: nope",
    });
    expect(getLayerTable("L1")).toBeNull();
    expect(dropped).toEqual(["layer_1.city.json"]);
  });

  it("never reuses a VFS name across layers", async () => {
    await build();
    await enqueueLayerTable("L2", {
      kind: "bytes",
      bytes: new Uint8Array(8),
      reader: "read_cityjsonseq",
      extension: "city.jsonl",
      provider: async () => new Uint8Array(8),
    });
    expect(registered.map((r) => r.name)).toEqual([
      "layer_1.city.json",
      "layer_2.city.jsonl",
    ]);
  });
});

describe("waiting for the engine", () => {
  function readerSource() {
    return {
      kind: "bytes" as const,
      bytes: new Uint8Array(16),
      reader: "read_cityjson" as const,
      extension: "city.json",
      provider: async () => new Uint8Array(16),
    };
  }

  it("sends NOTHING until initDuckDB has resolved", async () => {
    // The window this closes: a snapshot restored at boot, or a file dropped
    // on the landing page, reaches the queue two seconds into a five-second
    // engine boot. Before this await, that layer's table failed for good.
    engineReady = false;
    let openGate!: () => void;
    initGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const build = enqueueLayerTable("L1", readerSource());
    await Promise.resolve();
    await Promise.resolve();
    expect(sql).toEqual([]);
    expect(registered).toEqual([]);

    engineReady = true;
    openGate();
    await build;

    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
  });

  it("records the not-running message and KEEPS the source when the engine never came up", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());

    expect(sql).toEqual([]);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "failed",
      message: "The analytics engine is not running.",
    });
  });

  it("retryEngine rebuilds what only the engine's absence had failed", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
    });

    engineReady = true;
    await retryEngine();

    // The SAME bytes: on the refused path `registerFileBuffer` was never
    // called, so the array was never transferred and never detached.
    expect(registered).toEqual([{ name: "layer_1.city.json", length: 16 }]);
    expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("retryEngine does nothing while the engine is STILL down", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", readerSource());
    sql.length = 0;

    await retryEngine();
    expect(sql).toEqual([]);
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
    });
  });

  it("does NOT retry a table that failed on its own merits", async () => {
    failures = { "CREATE OR REPLACE TABLE": "Binder Error: nope" };
    await enqueueLayerTable("L1", readerSource());
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "failed",
      message: "Binder Error: nope",
    });
    sql.length = 0;

    // A bad file is still a bad file with the engine up; re-running it would
    // only fail again, and `retryEngine` is about ONE cause.
    await retryEngine();
    expect(sql).toEqual([]);
  });
});

describe("flat-fallback layer table", () => {
  it("registers JSON rows and creates the table through read_json_auto", async () => {
    describeRows = [
      { column_name: "id", column_type: "VARCHAR" },
      { column_name: "feature_id", column_type: "VARCHAR" },
      { column_name: "object_type", column_type: "VARCHAR" },
      { column_name: "parents", column_type: "VARCHAR[]" },
      { column_name: "children", column_type: "VARCHAR[]" },
      { column_name: "bouwjaar", column_type: "BIGINT" },
    ];
    countValue = 1;
    await enqueueLayerTable("L1", { kind: "model", model: model() });

    expect(registered[0]!.name).toBe("layer_1.json");
    expect(sql[0]).toBe(
      "CREATE OR REPLACE TABLE \"layer_1\" AS SELECT * FROM read_json_auto('layer_1.json')",
    );
    // read_json_auto types an all-NULL `parents` as JSON, not VARCHAR[], so
    // the fallback schema would diverge from the reader's without these. Both
    // are no-ops when the inference was already right.
    expect(sql[1]).toBe(
      'ALTER TABLE "layer_1" ALTER COLUMN "parents" TYPE VARCHAR[]',
    );
    expect(sql[2]).toBe(
      'ALTER TABLE "layer_1" ALTER COLUMN "children" TYPE VARCHAR[]',
    );
    expect(sql[3]).toBe('DESCRIBE SELECT * FROM "layer_1"');
    expect(dropped).toEqual(["layer_1.json"]);

    const info = getLayerTable("L1");
    expect(info).toMatchObject({
      reader: null,
      source: null,
      lods: [],
      rowCount: 1,
    });
  });

  it("creates an EMPTY typed table when a streaming layer has no residents yet", async () => {
    describeRows = [
      { column_name: "id", column_type: "VARCHAR" },
      { column_name: "feature_id", column_type: "VARCHAR" },
      { column_name: "object_type", column_type: "VARCHAR" },
      { column_name: "parents", column_type: "VARCHAR[]" },
      { column_name: "children", column_type: "VARCHAR[]" },
    ];
    countValue = 0;
    await enqueueLayerTable("L9", { kind: "resident", records: () => [] });

    expect(registered).toEqual([]);
    expect(sql[0]).toBe(
      'CREATE OR REPLACE TABLE "layer_1" ("id" VARCHAR, "feature_id" VARCHAR, "object_type" VARCHAR, "parents" VARCHAR[], "children" VARCHAR[])',
    );
    expect(getLayerTable("L9")).toMatchObject({ rowCount: 0 });
  });

  it("reads the records lazily, at build time", async () => {
    const records = vi.fn(() => []);
    describeRows = [{ column_name: "id", column_type: "VARCHAR" }];
    const promise = enqueueLayerTable("L1", { kind: "resident", records });
    expect(records).not.toHaveBeenCalled();
    await promise;
    expect(records).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/layerTablesBuild.test.ts`
Expected: FAIL — `src/analytics/layerTables` not found.

- [ ] **Step 3: Write `src/analytics/layerTables.ts`**

```ts
/**
 * One DuckDB table per city layer: the registry, the build, and the Zustand
 * mirror React subscribes to.
 *
 * WHY BYTES AND NOT A URL. `read_cityjson('https://…')` has never been
 * exercised in wasm and is CORS-dependent; the loader already HOLDS the
 * decoded bytes for every URL layer, so handing DuckDB those means the file is
 * never downloaded twice and there is no second failure mode to diagnose.
 *
 * WHY THE SOURCE IS DROPPED. Right after the table is materialised the source
 * buffer leaves the VFS, so a layer costs the ATTRIBUTE table and nothing
 * else: dropping the geometry/material/texture/template columns already cuts
 * that 2.45x (13.1 vs 32.1 MiB for Delft's 2231 rows), and the WKB is never
 * materialised for browsing at all. Probed under Node with the wasm_eh binary:
 * a materialised table survives `dropFile` of its source intact, while the
 * dropped NAME resolves to zero bytes forever — hence names from a module
 * counter that are never reused. An export re-registers the bytes under a
 * FRESH name through the entry's {@link SourceProvider}.
 *
 * The queue and the registry are plain module state; only the per-layer STATE
 * is a store, because that is the only part React renders.
 */

import { create } from "zustand";
import type { CityModel } from "../domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import {
  classifyColumnType,
  isDroppedColumn,
  lodsFromColumnNames,
  type ColumnInfo,
} from "./columnKind";
import {
  ddl,
  dropBuffer,
  getDuckDBStatus,
  initDuckDB,
  registerBuffer,
  runQuery,
} from "./duckdb";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
  flatRowsFromRecords,
  type FlatRow,
} from "./layerRows";
import { buildCountSql, quoteIdent } from "./sql";

/**
 * Re-registers a layer's source bytes for an export.
 *
 * DECODED bytes in every case — gunzipped when the payload carried gzip magic,
 * passed straight through when it did not — because that is exactly what the
 * table was built from, and no DuckDB reader gunzips anything, by name or by
 * magic. A dropped `File` is a REFERENCE, not a copy, so re-reading it from
 * disk is free; a URL is re-fetched through the same gunzip-aware client (the
 * browser cache usually serves it).
 *
 * Every call returns a FRESH array. `registerBuffer` CONSUMES what it is given
 * (the worker transfer detaches it), and a provider may be called more than
 * once — two exports of one layer, or a retry after a failed write.
 *
 * Lives in the registry, never in the layer store — a function is not snapshot
 * state, which is also why a layer restored from a snapshot has to re-obtain
 * its bytes rather than inherit them.
 */
export type SourceProvider = () => Promise<Uint8Array>;

export type LayerTableSource =
  | {
      readonly kind: "bytes";
      /**
       * CONSUMED by the build: `registerBuffer` transfers this array to the
       * DuckDB worker and DETACHES it, so the caller hands over an array it
       * will not read again — never one it also keeps.
       *
       * Which makes this source object SINGLE-USE. The registry never retains
       * it (only the `provider`), and a re-enqueue must supply a fresh one —
       * `refreshStreamingTable` builds a `resident` source, and the export
       * calls the provider. Re-submitting the same `bytes` source twice
       * registers a detached, zero-length array and produces a table with no
       * rows and no error.
       */
      readonly bytes: Uint8Array;
      readonly reader: "read_cityjson" | "read_cityjsonseq";
      /** The VFS file extension, e.g. "city.json" / "city.jsonl". */
      readonly extension: string;
      /** `null` when the bytes cannot be obtained again — the table is still
       *  built and browsable, but a CityParquet export needs the source and is
       *  refused with that reason. Each call returns a FRESH array, because
       *  registering one consumes it and an export may re-register. */
      readonly provider: SourceProvider | null;
    }
  | { readonly kind: "model"; readonly model: CityModel }
  | {
      /** A THUNK, not an array: a streaming layer re-enqueues as cells land,
       *  and the records have to be read at BUILD time, not at enqueue time. */
      readonly kind: "resident";
      readonly records: () => ReadonlyArray<ResidentObjectRecord>;
    };

export interface LayerTable {
  /** "layer_3" — a module counter, never the layer id (which is a UUID and
   *  not a legal bare identifier). */
  readonly table: string;
  readonly sourceName: string | null;
  readonly source: SourceProvider | null;
  readonly reader: "read_cityjson" | "read_cityjsonseq" | null;
  readonly columns: ReadonlyArray<ColumnInfo>;
  /** From the reader's `geometry_lod*` names; `[]` for a fallback table. */
  readonly lods: ReadonlyArray<string>;
  readonly rowCount: number;
}

export type LayerTableState =
  | { readonly state: "queued" }
  | { readonly state: "building" }
  | {
      readonly state: "ready";
      readonly info: LayerTable;
      /**
       * A REBUILD is in flight over a table that still works.
       *
       * A streaming layer rebuilds on every settle, and the OLD table is
       * perfectly readable while the new one is built: dropping to "building"
       * would blank the grid several times a pan, and a rebuild that then
       * FAILED would leave a layer that had working analytics with none at
       * all. So the entry stays `ready` with the previous `info`, and only
       * swaps once the replacement exists.
       */
      readonly rebuilding?: boolean;
    }
  | { readonly state: "failed"; readonly message: string };

export interface LayerTableStoreState {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  /** The table panel is open, so a streaming layer's table is worth
   *  rebuilding as cells land. `layerTables` cannot see the UI, so the panel
   *  tells it. An export does NOT set a flag here: it forces ONE rebuild when
   *  its dialog opens (`refreshStreamingTable`) and then wants the table to
   *  hold still, not to move under the write. */
  readonly tablePanelOpen: boolean;
}

export interface LayerTableStoreActions {
  setTablePanelOpen: (open: boolean) => void;
}

export const useLayerTableStore = create<
  LayerTableStoreState & LayerTableStoreActions
>((set) => ({
  tables: {},
  tablePanelOpen: false,
  setTablePanelOpen: (open) => set({ tablePanelOpen: open }),
}));

function setState(layerId: string, state: LayerTableState | null): void {
  useLayerTableStore.setState((s) => {
    const tables = { ...s.tables };
    if (state === null) delete tables[layerId];
    else tables[layerId] = state;
    return { tables };
  });
}

// ---------------------------------------------------------------------------
// Module state: the registry, the counter and the one FIFO queue
// ---------------------------------------------------------------------------

const registry = new Map<string, LayerTable>();
/**
 * Per-layer cancellation, by SEQUENCE rather than by a flag.
 *
 * Every enqueue and every drop takes the next number off `seqCounter`, and a
 * queued build runs only if its own number is HIGHER than the last drop
 * recorded for its layer. A boolean set cannot express that: it also cancels
 * builds enqueued AFTER the drop, and clearing the flag at enqueue time —
 * which is what makes re-adding the same id work at all — silently un-cancels
 * a build the drop was meant to kill. The question is "which came first", so
 * the answer has to be a number.
 */
const cancelBefore = new Map<string, number>();
/**
 * The sequence number of the most recent ENQUEUE for a layer.
 *
 * Read by `dropLayerTable`'s queued task, which has to decide whether the
 * store entry it is about to clear belongs to the build it superseded or to a
 * newer one that has since claimed the same id (a remove-then-re-add of the
 * same file). Clearing the newer one's entry would blank a table that is
 * perfectly alive.
 */
const lastEnqueueSeq = new Map<string, number>();
/**
 * Sources whose build was refused because the ENGINE was not running.
 *
 * DuckDB takes ~5 s to come up (a 36 MB wasm module plus a 3.5 s `LOAD
 * cityjson`), and the most common first layer of a session lands inside that
 * window: a snapshot restored at boot, a share link, a file dropped on the
 * landing page. Without this that layer's table fails PERMANENTLY, and the
 * only way back is to remove and re-add the layer — which nobody would guess.
 *
 * Safe to keep. On this path `registerFileBuffer` was never called, so a
 * `bytes` source's array is intact rather than detached; a `model` or
 * `resident` source is a reference either way.
 */
const pendingSources = new Map<string, LayerTableSource>();
/** The message the engine itself uses for a query it cannot run. Repeated
 *  rather than imported because `duckdb.ts` keeps it private — but it must
 *  READ the same, or the panel says two different things about one cause. */
const ENGINE_NOT_RUNNING = "The analytics engine is not running.";
let seqCounter = 0;
let counter = 0;
let chain: Promise<void> = Promise.resolve();

export function getLayerTable(layerId: string): LayerTable | null {
  return registry.get(layerId) ?? null;
}

/** Append `task` to the single queue. One queue, not one per layer, so a drop
 *  enqueued behind a create can never race the `CREATE` it must follow. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

export function resetLayerTablesForTest(): void {
  registry.clear();
  cancelBefore.clear();
  lastEnqueueSeq.clear();
  pendingSources.clear();
  counter = 0;
  seqCounter = 0;
  chain = Promise.resolve();
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function columnsFromDescribe(
  rows: ReadonlyArray<Record<string, unknown>>,
): ColumnInfo[] {
  const out: ColumnInfo[] = [];
  for (const row of rows) {
    const name = row.column_name;
    const type = row.column_type;
    if (typeof name !== "string" || typeof type !== "string") continue;
    out.push({ name, type, kind: classifyColumnType(type) });
  }
  return out;
}

async function countRows(table: string): Promise<number> {
  const result = await runQuery(buildCountSql(table, null));
  if (!result.ok) return 0;
  const n = result.rows[0]?.n;
  return typeof n === "number" ? n : Number(n) || 0;
}

class BuildError extends Error {}

async function buildFromReader(
  table: string,
  source: Extract<LayerTableSource, { kind: "bytes" }>,
): Promise<LayerTable> {
  const sourceName = `${table}.${source.extension}`;
  const registered = await registerBuffer(sourceName, source.bytes);
  if (!registered) {
    throw new BuildError("The source bytes could not be handed to DuckDB.");
  }
  try {
    const described = await runQuery(
      `DESCRIBE SELECT * FROM ${source.reader}('${sourceName}')`,
    );
    if (!described.ok) throw new BuildError(described.message);

    const all = columnsFromDescribe(described.rows);
    const kept = all.filter((c) => !isDroppedColumn(c.name));
    if (kept.length === 0) {
      throw new BuildError("This file has no attribute columns to browse.");
    }
    const select = kept.map((c) => quoteIdent(c.name)).join(", ");
    const created = await ddl(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ${select} FROM ${source.reader}('${sourceName}')`,
    );
    if (!created.ok) throw new BuildError(created.message);

    return {
      table,
      sourceName,
      source: source.provider,
      reader: source.reader,
      columns: kept,
      lods: lodsFromColumnNames(all.map((c) => c.name)),
      rowCount: await countRows(table),
    };
  } finally {
    // ALWAYS, success or not: the table (if it was made) survives this, and a
    // failed build must not leave a multi-megabyte buffer in the VFS.
    await dropBuffer(sourceName);
  }
}

/** The columns an empty fallback table is declared with — the vocabulary every
 *  other layer publishes, so a streaming layer with no cells yet still has a
 *  browsable (empty) table rather than a failure. */
const EMPTY_FALLBACK_DDL =
  '("id" VARCHAR, "feature_id" VARCHAR, "object_type" VARCHAR, "parents" VARCHAR[], "children" VARCHAR[])';

async function buildFromRows(
  table: string,
  rows: ReadonlyArray<FlatRow>,
): Promise<LayerTable> {
  let sourceName: string | null = null;
  try {
    if (rows.length === 0) {
      const created = await ddl(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} ${EMPTY_FALLBACK_DDL}`,
      );
      if (!created.ok) throw new BuildError(created.message);
    } else {
      sourceName = `${table}.json`;
      const ok = await registerBuffer(sourceName, encodeRowsAsJson(rows));
      if (!ok) {
        throw new BuildError("The layer's rows could not be handed to DuckDB.");
      }
      const created = await ddl(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_json_auto('${sourceName}')`,
      );
      if (!created.ok) throw new BuildError(created.message);

      // `read_json_auto` infers from the DATA, and a layer of nothing but root
      // objects has `parents` NULL in every row — which it types as JSON, not
      // VARCHAR[]. That is a real divergence from the reader schema: a JSON
      // column classifies `castText` instead of `nested`, so the filter bar
      // would offer it comparisons it cannot honour and `parents IS NULL`
      // would stop meaning the same thing on the two kinds of table.
      //
      // Probed (2026-09-04, DuckDB 1.5.5): `sample_size = -1` and
      // `union_by_name` do NOT help — an all-NULL column stays JSON — and a
      // PARTIAL `columns = {...}` option DROPS every column it does not name,
      // which would throw the layer's attributes away. `ALTER COLUMN … TYPE`
      // is the route that works: it is a no-op when the inference was already
      // right, and it preserves both the list values and the NULLs.
      for (const column of ["parents", "children"]) {
        const altered = await ddl(
          `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(column)} TYPE VARCHAR[]`,
        );
        if (!altered.ok) throw new BuildError(altered.message);
      }
    }

    // DESCRIBE the TABLE, not the source: `read_json_auto` infers the types,
    // so the table is the only authority on what they came out as.
    const described = await runQuery(
      `DESCRIBE SELECT * FROM ${quoteIdent(table)}`,
    );
    if (!described.ok) throw new BuildError(described.message);

    return {
      table,
      sourceName: null,
      source: null,
      reader: null,
      columns: columnsFromDescribe(described.rows),
      lods: [],
      rowCount: await countRows(table),
    };
  } finally {
    if (sourceName !== null) await dropBuffer(sourceName);
  }
}

/**
 * Try the engine again, and rebuild whatever failed only for want of it.
 *
 * Two callers, and both matter: the table panel's Retry button, and the app's
 * own boot — because the engine becoming ready three seconds after a layer
 * landed must not require the user to notice and act. A table that failed for
 * any OTHER reason (a bad file, a missing column) is not retried here; it
 * failed on its merits and re-running it would just fail again.
 */
export async function retryEngine(): Promise<void> {
  await initDuckDB();
  if (getDuckDBStatus().state !== "ready") return;
  // Snapshot and CLEAR first: each `enqueueLayerTable` below can put its layer
  // straight back in (a second failure), and iterating a map being written to
  // is how one layer gets retried forever.
  const pending = [...pendingSources.entries()];
  pendingSources.clear();
  await Promise.all(
    pending.map(([layerId, source]) => enqueueLayerTable(layerId, source)),
  );
}

/**
 * `DROP TABLE` plus the VFS cleanup for one entry.
 *
 * Called from INSIDE the queue only — by a rebuild that has just published its
 * replacement, and by `dropLayerTable` (Task 14).
 */
async function retire(info: LayerTable): Promise<void> {
  await ddl(`DROP TABLE IF EXISTS ${quoteIdent(info.table)}`);
  // Belt and braces: the build already dropped this on the way out, and a
  // second drop of an absent name is harmless. A build that failed BETWEEN
  // registration and its own `finally` is the case this covers.
  if (info.sourceName !== null) await dropBuffer(info.sourceName);
}

/**
 * Build (or rebuild) `layerId`'s table.
 *
 * Resolves when the build has SETTLED, success or failure — a DuckDB failure
 * is recorded on the entry and shown in the panel, never thrown into the
 * loader: an analytics engine that could not start must not fail a layer add.
 */
export function enqueueLayerTable(
  layerId: string,
  source: LayerTableSource,
): Promise<void> {
  const seq = ++seqCounter;
  lastEnqueueSeq.set(layerId, seq);
  // A REBUILD keeps the table it is replacing ON SCREEN. Only a layer with no
  // table yet passes through "queued"/"building".
  const queuedOver = registry.get(layerId);
  setState(
    layerId,
    queuedOver
      ? { state: "ready", info: queuedOver, rebuilding: true }
      : { state: "queued" },
  );
  /** Has a drop superseded this build? Asked twice — once before it starts,
   *  once after it finishes — because a drop can arrive at any point in
   *  between. (`?? 0` is safe: `seqCounter` starts at 1.) */
  const superseded = () => seq <= (cancelBefore.get(layerId) ?? 0);

  return enqueue(async () => {
    // Checked SYNCHRONOUSLY, before the first await: a build still WAITING
    // when the drop arrived is skipped outright and never touches DuckDB.
    if (superseded()) return;
    // Re-read at RUN time, not at enqueue time: a drop or an earlier rebuild
    // may have landed in between.
    const previous = registry.get(layerId);
    if (!previous) setState(layerId, { state: "building" });

    // WAIT FOR THE ENGINE. `registerBuffer` and `ddl` both answer "not
    // running" while the status is anything but ready, and the boot takes ~5 s
    // — comfortably longer than a restored snapshot, a share link or a quick
    // file drop takes to reach this point. Without this await, the first layer
    // of a session reliably gets a table that failed for a reason that had
    // already stopped being true. `initDuckDB` never rejects (it records a
    // failure in the status), and it is memoised, so this is one await for the
    // first build and free for every one after.
    await initDuckDB();
    if (superseded()) return;
    if (getDuckDBStatus().state !== "ready") {
      // KEEP the source: `registerFileBuffer` was never called, so a `bytes`
      // array is still intact, and `retryEngine` can build this table without
      // the user re-adding the layer.
      pendingSources.set(layerId, source);
      if (previous) {
        // An engine that stopped being ready under a working table does not
        // take the table with it — same rule as a failed rebuild.
        setState(layerId, {
          state: "ready",
          info: previous,
          rebuilding: false,
        });
      } else {
        setState(layerId, { state: "failed", message: ENGINE_NOT_RUNNING });
      }
      return;
    }
    // Past this point the engine is up, so this attempt is not a candidate for
    // the retry queue any more.
    pendingSources.delete(layerId);
    // The name is minted INSIDE the queued task, so table numbering follows
    // build order rather than enqueue order and a cancelled build burns no
    // number at all.
    const table = `layer_${++counter}`;
    try {
      const info =
        source.kind === "bytes"
          ? await buildFromReader(table, source)
          : await buildFromRows(
              table,
              source.kind === "model"
                ? flatRowsFromModel(source.model)
                : flatRowsFromRecords(source.records()),
            );
      // NOTE what is NOT kept: `info` carries the PROVIDER, never the source
      // object, so the (now detached) `bytes` array and the `model`/`records`
      // closure are both released with the caller's reference. A rebuild
      // therefore always re-obtains its input rather than replaying a
      // consumed one.
      if (superseded()) {
        // The layer was REMOVED while this build ran. Publishing now would
        // write a `ready` entry over the `null` the drop already set — a store
        // entry for a layer that no longer exists, on the very object React
        // subscribes to — so tear the new table down instead and publish
        // nothing. Any `previous` is left alone: the drop's own queued task
        // is right behind us and will retire it.
        await retire(info);
        return;
      }
      registry.set(layerId, info);
      setState(layerId, { state: "ready", info });
      // AFTER the replacement exists, never before. Retiring first would leave
      // the layer with NO table for the length of the build — several times a
      // pan, on a streaming layer — and with none at all if the build failed.
      if (previous) await retire(previous);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The table could not be built.";
      console.warn(`DuckDB table for layer ${layerId} failed: ${message}`);
      if (superseded()) {
        // Same reason as the success path: the drop owns the store entry now,
        // and a failed build of a removed layer has nothing to report to a
        // panel that is no longer showing it.
        return;
      }
      if (previous) {
        // A failed REBUILD is not a failed layer: the old table was never
        // touched and still answers every query. The console carries the
        // reason; the panel keeps showing real data rather than an error over
        // a table that works.
        setState(layerId, {
          state: "ready",
          info: previous,
          rebuilding: false,
        });
      } else {
        registry.delete(layerId);
        setState(layerId, { state: "failed", message });
      }
    }
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/layerTablesBuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/layerTables.ts tests/unit/analytics/layerTablesBuild.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): one DuckDB table per city layer

Reader-backed layers hand DuckDB the decoded bytes the loader already holds
(never a URL: read_cityjson over http is unexercised in wasm and
CORS-dependent), then DROP the buffer — a materialised table survives that,
probed under Node, and the dropped name resolves to zero bytes forever, which
is why names come from a counter and are never reused. Everything else builds
flat rows aligned to the reader's column names. A build failure is recorded on
the entry, never thrown into the loader.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 14: `dropLayerTable` and the queue's ordering guarantees

**Files:**

- Modify: `src/analytics/layerTables.ts`
- Test: `tests/unit/analytics/layerTablesQueue.test.ts`

**Interfaces:**

- Consumes: Task 13's module state, including the file-local `retire(info)`.
- Produces:

```ts
export function dropLayerTable(layerId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/layerTablesQueue.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];
/** Resolvers for the gate below, so a build can be held mid-flight. */
let gate: { promise: Promise<void>; open: () => void } | null = null;
/** When set, the Nth CREATE (1-based) fails — for the rebuild-failure case. */
let failCreateNumber: number | null = null;
let createCount = 0;
/** The engine's readiness — the build task awaits `initDuckDB` and checks it. */
let engineReady = true;

function makeGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Let the queue's microtasks run.
 *
 * `enqueue` defers through `chain.then(task)`, so a task enqueued on this tick
 * has not STARTED yet when the caller's next statement executes. The
 * cancellation check happens at the top of the task, before its first await —
 * so "a drop that arrives while a build is in flight" and "a drop that arrives
 * while a build is still queued" are two genuinely different tests, and this
 * is what puts the first one in the first state.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

vi.mock("../../../src/analytics/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (statement.startsWith("CREATE OR REPLACE TABLE")) {
      createCount += 1;
      if (gate) await gate.promise;
      if (createCount === failCreateNumber) {
        return { ok: false as const, message: "Binder Error: rebuild failed" };
      }
    }
    if (statement.startsWith("DESCRIBE")) {
      return {
        ok: true as const,
        columns: [],
        rows: [{ column_name: "id", column_type: "VARCHAR" }],
      };
    }
    if (statement.includes("COUNT(*)")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 1 }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    getDuckDBStatus: vi.fn(() =>
      engineReady
        ? {
            state: "ready",
            extensions: {
              cityjson: { state: "loaded" },
              spatial: { state: "unloaded" },
              three_d: { state: "unloaded" },
            },
            loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
            platform: "wasm_eh",
          }
        : { state: "uninitialized" },
    ),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const {
  dropLayerTable,
  enqueueLayerTable,
  getLayerTable,
  resetLayerTablesForTest,
  retryEngine,
  useLayerTableStore,
} = await import("../../../src/analytics/layerTables");

const RESIDENT = { kind: "resident" as const, records: () => [] };
const ONE_ROW = {
  kind: "resident" as const,
  records: () => [
    {
      id: "R1",
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2",
      surfaceCount: 1,
      roofMetrics: [],
      footprintAreaSqM: 1,
      volumeCuM: 1,
      parents: [],
      children: [],
    },
  ],
} as never;

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  gate = null;
  failCreateNumber = null;
  createCount = 0;
  engineReady = true;
  resetLayerTablesForTest();
});

describe("dropLayerTable", () => {
  it("drops the table and forgets the layer", async () => {
    await enqueueLayerTable("L1", ONE_ROW);
    expect(getLayerTable("L1")).not.toBeNull();
    sql.length = 0;

    await dropLayerTable("L1");
    expect(sql).toEqual(['DROP TABLE IF EXISTS "layer_1"']);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("is a no-op for a layer that never had a table", async () => {
    await dropLayerTable("nobody");
    expect(sql).toEqual([]);
  });

  it("forgets a PENDING source, so a removed layer never returns on a retry", async () => {
    engineReady = false;
    await enqueueLayerTable("L1", ONE_ROW);
    await dropLayerTable("L1");

    engineReady = true;
    await retryEngine();
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("WAITS for an in-flight create rather than racing it", async () => {
    gate = makeGate();
    const build = enqueueLayerTable("L1", ONE_ROW);
    // Let the build actually START — past its cancellation check — before the
    // drop arrives. Without this the drop supersedes a build that never ran,
    // which is the OTHER test, below.
    await flushMicrotasks();
    const drop = dropLayerTable("L1");

    // The DROP has not been sent while the CREATE is still held.
    await flushMicrotasks();
    expect(sql.some((s) => s.startsWith("DROP TABLE"))).toBe(false);

    gate.open();
    await build;
    await drop;
    const createIdx = sql.findIndex((s) => s.startsWith("CREATE OR REPLACE"));
    const dropIdx = sql.findIndex((s) => s.startsWith("DROP TABLE"));
    // A build already in flight finishes — and then tears down what it made,
    // because the drop that arrived meanwhile means nobody wants it. Either
    // way the CREATE is never left standing.
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdx).toBeGreaterThan(createIdx);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
  });

  it("SKIPS a build whose layer was removed while it was still queued", async () => {
    gate = makeGate();
    const first = enqueueLayerTable("L1", ONE_ROW);
    const second = enqueueLayerTable("L2", ONE_ROW);
    // No flush: L2's build is still WAITING behind L1's when the drop lands.
    const drop = dropLayerTable("L2");

    gate.open();
    await Promise.all([first, second, drop]);

    expect(getLayerTable("L1")).not.toBeNull();
    expect(getLayerTable("L2")).toBeNull();
    // Only ONE table was ever created — L2's build never ran.
    expect(sql.filter((s) => s.startsWith("CREATE OR REPLACE")).length).toBe(1);
  });

  it("a build cancelled MID-FLIGHT publishes nothing and drops what it made", async () => {
    gate = makeGate();
    const build = enqueueLayerTable("L1", ONE_ROW);
    // Past the entry guard: this build WILL run to completion.
    await flushMicrotasks();
    const drop = dropLayerTable("L1");

    gate.open();
    await Promise.all([build, drop]);

    // Neither the registry nor — the point of this test — the STORE keeps an
    // entry for a layer that has been removed.
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toBeUndefined();
    // And the table the build did create was torn down, not orphaned.
    expect(sql).toContain('CREATE OR REPLACE TABLE "layer_1"');
    expect(sql).toContain('DROP TABLE IF EXISTS "layer_1"');
  });

  it("does NOT cancel a re-add enqueued AFTER the drop", async () => {
    await enqueueLayerTable("L1", ONE_ROW);
    const drop = dropLayerTable("L1");
    // The user removes a layer and immediately drops the same file back in.
    // A boolean cancellation flag gets this wrong in one direction or the
    // other; a sequence number does not.
    const readd = enqueueLayerTable("L1", ONE_ROW);
    await Promise.all([drop, readd]);

    // The drop's queued task runs BEFORE the re-add's and must not blank the
    // newcomer's entry on its way out — hence `lastEnqueueSeq`.
    expect(getLayerTable("L1")).not.toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toMatchObject({
      state: "ready",
    });
  });

  it("drops a still-registered source buffer as well", async () => {
    await enqueueLayerTable("L1", {
      kind: "bytes",
      bytes: new Uint8Array(4),
      reader: "read_cityjson",
      extension: "city.json",
      provider: async () => new Uint8Array(4),
    });
    dropped.length = 0;
    await dropLayerTable("L1");
    expect(dropped).toEqual(["layer_1.city.json"]);
  });
});

describe("rebuild", () => {
  it("replaces the table under a FRESH name and retires the old one AFTER the new one exists", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")!.table).toBe("layer_1");
    sql.length = 0;

    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")!.table).toBe("layer_2");

    const createIdx = sql.findIndex((s) =>
      s.startsWith('CREATE OR REPLACE TABLE "layer_2"'),
    );
    const dropIdx = sql.indexOf('DROP TABLE IF EXISTS "layer_1"');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    // Ordering is the point: the old table must survive until the new one is
    // real, or the layer has no analytics at all for the length of the build.
    expect(dropIdx).toBeGreaterThan(createIdx);
  });

  it("keeps the OLD table visible while the rebuild is in flight", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    gate = makeGate();
    const rebuild = enqueueLayerTable("L1", RESIDENT);

    // Not "building": the previous table still answers every query.
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: getLayerTable("L1"),
      rebuilding: true,
    });
    expect(getLayerTable("L1")!.table).toBe("layer_1");

    gate.open();
    await rebuild;
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: getLayerTable("L1"),
    });
    expect(getLayerTable("L1")!.table).toBe("layer_2");
  });

  it("a FAILED rebuild keeps the previous table, and never drops it", async () => {
    await enqueueLayerTable("L1", RESIDENT);
    const before = getLayerTable("L1")!;
    sql.length = 0;
    failCreateNumber = 2;

    await enqueueLayerTable("L1", RESIDENT);

    expect(getLayerTable("L1")).toBe(before);
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "ready",
      info: before,
      rebuilding: false,
    });
    expect(sql).not.toContain('DROP TABLE IF EXISTS "layer_1"');
  });

  it("a first build that fails IS a failed layer — there is nothing to fall back to", async () => {
    failCreateNumber = 1;
    await enqueueLayerTable("L1", RESIDENT);
    expect(getLayerTable("L1")).toBeNull();
    expect(useLayerTableStore.getState().tables.L1).toEqual({
      state: "failed",
      message: "Binder Error: rebuild failed",
    });
  });

  it("runs queued builds in the order they were enqueued", async () => {
    gate = makeGate();
    const a = enqueueLayerTable("A", RESIDENT);
    const b = enqueueLayerTable("B", RESIDENT);
    gate.open();
    await Promise.all([a, b]);
    expect(getLayerTable("A")!.table).toBe("layer_1");
    expect(getLayerTable("B")!.table).toBe("layer_2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/layerTablesQueue.test.ts`
Expected: FAIL — `dropLayerTable` is not exported, and the rebuild does not drop the previous table.

- [ ] **Step 3: Add the drop, and make a rebuild retire its predecessor**

In `src/analytics/layerTables.ts`, add after `enqueueLayerTable`. The `retire`
helper it uses already exists — Task 13 defines it, because the rebuild path
calls it too:

```ts
/**
 * Forget `layerId`'s table.
 *
 * Goes through the SAME queue as the builds, which is the whole reason there
 * is one: a removal that arrives while a create is in flight waits for it
 * instead of dropping a table that does not exist yet and then watching the
 * create put it back. A layer removed while its build is still QUEUED is
 * skipped outright — the table is never made.
 */
export function dropLayerTable(layerId: string): Promise<void> {
  // Everything enqueued for this layer BEFORE now is superseded; anything
  // enqueued after — a re-add of the same id — takes a higher number and runs.
  const seq = ++seqCounter;
  cancelBefore.set(layerId, seq);
  // A removed layer must not come back on the next `retryEngine()`.
  pendingSources.delete(layerId);
  setState(layerId, null);
  return enqueue(async () => {
    const info = registry.get(layerId);
    if (info) {
      registry.delete(layerId);
      await retire(info);
    }
    // Clear the store AGAIN, and this is not belt-and-braces. The synchronous
    // `setState(null)` above happens while a build may already be RUNNING; that
    // build's own guard stops it publishing, but a build that had ALREADY
    // published between the drop being issued and this task running would
    // otherwise leave a `ready` entry for a layer that no longer exists — a
    // leak on the one object React subscribes to.
    //
    // Unless a NEWER enqueue has claimed the id since (a remove-then-re-add of
    // the same file): that one's entry is alive and blanking it would empty a
    // table the user is looking at.
    if ((lastEnqueueSeq.get(layerId) ?? 0) <= seq) setState(layerId, null);
  });
}
```

`enqueueLayerTable` already reads `previous` and retires it AFTER a successful
build (Task 13, Step 3): a rebuild gets a FRESH name — names are never reused —
so the table it replaces has to be dropped explicitly or it stays resident
forever. Nothing more is needed there. VERIFY, by reading the function, that the
`retire(previous)` call really is inside the `try`, AFTER
`setState(layerId, { state: "ready", info })`, and that the `catch` restores the
previous entry rather than deleting it.

- [ ] **Step 4: Run both layerTables test files**

Run: `npx vitest run tests/unit/analytics/layerTablesBuild.test.ts tests/unit/analytics/layerTablesQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/layerTables.ts tests/unit/analytics/layerTablesQueue.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): layer-table drops and rebuilds share the build queue

One queue is the point: a removal enqueued behind a create waits for it rather
than dropping a table that does not exist yet and watching the create put it
back, and a layer removed while its build is still queued is skipped outright.
A rebuild mints a fresh name (names are never reused) and retires the table it
replaces.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 15: `loadFromUrl` returns the bytes it already decoded

**Files:**

- Modify: `src/domain/citymodel/loadCityModel.ts`
- Modify: `src/app/App.tsx` (two call sites), `src/features/layers/useLayerFileLoader.ts` (one)
- Modify: `tests/unit/domain/citymodel/loadCityModel.test.ts`, `tests/unit/domain/citymodel/loadCityModelGzip.test.ts`, `tests/unit/app/appCityParquetLayers.test.tsx`, `tests/unit/app/appRestoreShare.test.tsx`, `tests/unit/app/appCatalogEntry.test.tsx`, `tests/unit/app/appEngineBoot.test.tsx`, `tests/unit/features/layers/useLayerFileLoader.test.ts` (wherever `loadFromUrl` is stubbed or awaited)

**Interfaces:**

- Consumes: nothing new.
- Produces:

```ts
export interface LoadedModel {
  readonly model: CityModel;
  /** The DECODED source bytes, for the DuckDB reader path — the FETCHED array
   *  itself when the body was not gzipped, the re-encoded text when it was.
   *  Null when the source has no reader: a CityGML document, or a ZIP archive. */
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
}
export function loadFromUrl(
  url: string,
  http?: HttpClient,
): Promise<LoadedModel>;
/** The same fetch + gunzip, bytes only — the export SourceProvider's door.
 *  A FRESH array every call. */
export function fetchModelBytes(
  url: string,
  http?: HttpClient,
): Promise<Uint8Array>;
/** Gzip magic (`1f 8b`). Exported so callers can skip a re-encode they do not
 *  need: when this is false, the array they already hold IS the decoded one. */
export function isGzipBytes(bytes: Uint8Array): boolean;
```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/domain/citymodel/loadCityModel.test.ts`:

```ts
describe("loadFromUrl's LoadedModel envelope", () => {
  const cityjson = JSON.stringify({
    type: "CityJSON",
    version: "2.0",
    CityObjects: {},
    vertices: [],
  });

  function http(body: string) {
    return {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: body,
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(body),
      }),
    };
  }

  it("carries the decoded bytes and the encoding for a CityJSON URL", async () => {
    const loaded = await loadFromUrl("https://x/a.city.json", http(cityjson));
    expect(loaded.encoding).toBe("cityjson");
    expect(loaded.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(loaded.bytes!)).toBe(cityjson);
    expect(loaded.model.sourceEncoding).toBe("cityjson");
  });

  it("says cityjsonseq for a .jsonl URL", async () => {
    // `seqFixtureText` is the real two-buildings fixture this file already
    // reads at the top — a hand-written one-liner would be a second, weaker
    // idea of what CityJSONSeq looks like.
    const loaded = await loadFromUrl(
      "https://x/a.city.jsonl",
      http(seqFixtureText),
    );
    expect(loaded.encoding).toBe("cityjsonseq");
    expect(loaded.bytes).not.toBeNull();
    expect(Object.keys(loaded.model.objects).length).toBeGreaterThan(0);
  });

  it("carries NO bytes for a CityGML document — it has no DuckDB reader", async () => {
    const gml = `<?xml version="1.0"?><CityModel xmlns="http://www.opengis.net/citygml/2.0"></CityModel>`;
    const loaded = await loadFromUrl("https://x/a.gml", http(gml));
    expect(loaded.encoding).toBe("citygml");
    expect(loaded.bytes).toBeNull();
  });
});

describe("fetchModelBytes", () => {
  it("GUNZIPS by magic bytes, not by extension — no DuckDB reader gunzips", async () => {
    const body =
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}';
    const gz = new Uint8Array(
      await new Response(
        new Response(
          new TextEncoder().encode(body) as BodyInit,
        ).body!.pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    // The URL says ".city.json", the BYTES say gzip. The bytes win.
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: "",
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: gz,
      }),
    });
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("returns the FETCHED array untouched when the body was not gzipped", async () => {
    const raw = new TextEncoder().encode(
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}',
    );
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: "",
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: raw,
      }),
    });
    // Identity, not equality: a second copy of a 300 MB file is the cost this
    // avoids, and `registerBuffer` is about to consume whichever array it gets.
    expect(bytes).toBe(raw);
  });

  it("returns the decoded bytes for an export re-registration", async () => {
    const body =
      '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}';
    const bytes = await fetchModelBytes("https://x/a.city.json", {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: body,
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        bytes: new TextEncoder().encode(body),
      }),
    });
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("keeps the friendly 404 sentence", async () => {
    await expect(
      fetchModelBytes("https://x/a.city.json", {
        fetchText: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: "",
        }),
        fetchBytes: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          bytes: new Uint8Array(),
        }),
      }),
    ).rejects.toThrow(/File not found \(404\)/);
  });
});
```

Add `fetchModelBytes` to that file's import list.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/domain/citymodel/loadCityModel.test.ts`
Expected: FAIL — `loadFromUrl` resolves a `CityModel`, so `loaded.encoding` is undefined; `fetchModelBytes` is not exported.

- [ ] **Step 3: Promote the gzip test out of `decodeModelBytes`**

In `src/domain/citymodel/loadCityModel.ts`, replace the inline magic-byte test
at the top of `decodeModelBytes` with a named, exported predicate — three
callers now need the ANSWER without the decode:

```ts
/**
 * Does this payload carry gzip magic?
 *
 * Exported because it decides whether a caller needs a SECOND copy of the
 * bytes: when the answer is false, the array that was fetched or read IS the
 * decoded array, and `TextEncoder().encode(new TextDecoder().decode(bytes))`
 * would allocate a duplicate of a file that can be hundreds of megabytes for
 * no gain at all.
 */
export function isGzipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
  );
}

export async function decodeModelBytes(bytes: Uint8Array): Promise<string> {
  if (isGzipBytes(bytes)) {
    // Response (not Blob) as the byte source: in tests the Response and
    // DecompressionStream globals come from the same (Node) realm, whereas
    // jsdom's Blob.stream() would brand-check-fail against Node's streams.
    const body = new Response(bytes as BodyInit).body;
    if (!body) return new TextDecoder().decode(bytes);
    return await new Response(
      body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
  }
  return new TextDecoder().decode(bytes);
}
```

- [ ] **Step 4: Restructure `loadFromUrl` in `src/domain/citymodel/loadCityModel.ts`**

Replace the whole `loadFromUrl` with:

```ts
/**
 * A loaded model PLUS the bytes it was decoded from.
 *
 * The bytes travel because the analytics table wants them and the loader is
 * the only place that has them: registering the buffer DuckDB reads means a
 * URL layer is never downloaded twice, and `read_cityjson` over a remote URL
 * — never exercised in wasm, CORS-dependent — is never used at all.
 *
 * `bytes` is null exactly where there is no DuckDB reader for the format: a
 * CityGML document and a ZIP archive of them both take the flat fallback.
 */
export interface LoadedModel {
  readonly model: CityModel;
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
}

/** The fetch, its friendly failures, and the gunzip — shared by
 *  {@link loadFromUrl} and {@link fetchModelBytes}. Returns the RAW body, so
 *  the ZIP branch can still see its magic bytes. */
async function fetchRawBody(
  url: string,
  http: HttpClient,
): Promise<Uint8Array> {
  let response: {
    ok: boolean;
    status: number;
    statusText: string;
    bytes: Uint8Array;
  };
  try {
    response = await http.fetchBytes(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new Error(
        `Network error loading "${fileNameFromUrl(url)}". Check that the URL is correct and accessible (CORS may block cross-origin requests).`,
        { cause: err },
      );
    }
    throw new Error(`Failed to load: ${msg}`, { cause: err });
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `File not found (404) at "${fileNameFromUrl(url)}". Check the URL.`,
      );
    }
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`,
    );
  }
  return response.bytes;
}

async function decodeOrExplain(
  url: string,
  bytes: Uint8Array,
): Promise<string> {
  try {
    return await decodeModelBytes(bytes);
  } catch (err) {
    throw new Error(
      `Corrupt or truncated compressed data for "${fileNameFromUrl(url)}". The gzipped body could not be decompressed.`,
      { cause: err },
    );
  }
}

/**
 * Load a city model from a remote URL.
 *  - .fcb → NOT loaded here. FlatCityBuf files are streamed by viewport
 *    rather than loaded whole; this function throws a clear error instead.
 *  - .city.jsonl / .jsonl → CityJSONSeq (fetch + parse)
 *  - a body with ZIP magic → unzipped and parsed as CityGML, whatever the
 *    extension said (see cityGmlArchive.ts)
 *  - everything else → CityJSON (fetch + parse)
 *
 * The body is fetched as bytes and gunzipped when it carries gzip magic bytes,
 * so `*.city.json.gz` assets work whether the server hands back the compressed
 * file verbatim or already decompressed it via Content-Encoding.
 */
export async function loadFromUrl(
  url: string,
  http: HttpClient = defaultHttp,
): Promise<LoadedModel> {
  const encoding = detectEncoding(url);

  if (encoding === "flatcitybuf") {
    throw new Error(
      `FlatCityBuf (.fcb) files are loaded by viewport streaming, not as a single whole-file read, and that path is not wired up yet. Could not load "${fileNameFromUrl(url)}".`,
    );
  }

  const raw = await fetchRawBody(url, http);

  // BEFORE `decodeModelBytes` and before the encoding switch: a ZIP is a
  // CONTAINER, and only its bytes say so. Its magic is not gzip's, so
  // `decodeModelBytes` would TextDecode the archive into mojibake and hand
  // that to whichever parser the extension guessed.
  if (isZipBytes(raw)) {
    return {
      model: parseCityGmlArchive(raw, fileNameFromUrl(url)),
      bytes: null,
      encoding: "citygml",
    };
  }

  const gzipped = isGzipBytes(raw);
  const text = await decodeOrExplain(url, raw);
  // The FETCHED array when nothing was gunzipped — re-encoding the text would
  // allocate a second copy of the whole file for no gain. Safe to hand on:
  // `registerBuffer` consumes it, and nothing below reads `raw` again.
  const decodedBytes = gzipped ? new TextEncoder().encode(text) : raw;

  if (encoding === "cityjsonseq") {
    return {
      model: parseCityJSONSeq(text),
      bytes: decodedBytes,
      encoding: "cityjsonseq",
    };
  }

  if (encoding === "citygml") {
    return { model: parseCityGML(text), bytes: null, encoding: "citygml" };
  }

  let json: CityJSONRoot;
  try {
    json = JSON.parse(text) as CityJSONRoot;
  } catch {
    throw new Error(
      "Invalid JSON — the remote file could not be parsed. Check that it is valid CityJSON.",
    );
  }
  if (json.type !== "CityJSON") {
    throw new Error('Not a CityJSON file — expected "type": "CityJSON".');
  }
  if (!json.CityObjects || typeof json.CityObjects !== "object") {
    throw new Error('Invalid CityJSON — missing "CityObjects" property.');
  }
  if (!Array.isArray(json.vertices)) {
    throw new Error('Invalid CityJSON — missing or invalid "vertices" array.');
  }
  return {
    model: parseCityJSON(json),
    bytes: decodedBytes,
    encoding: "cityjson",
  };
}

/**
 * The DECODED source bytes for a URL, with none of the parsing.
 *
 * The export's `SourceProvider`: a layer's bytes are dropped from the VFS as
 * soon as its table is built, so a CityParquet export re-fetches them (the
 * browser cache usually serves it) rather than the app holding a copy of every
 * loaded file for the lifetime of the session.
 *
 * DECODED, always, and decided on the MAGIC BYTES rather than the extension —
 * a `.city.json` a server handed back gzipped comes out as text either way,
 * and it has to, because no DuckDB reader gunzips anything. These are the same
 * bytes the table was built from.
 *
 * A body that was NOT gzipped is returned AS IS: it already is the decoded
 * array, and a decode-then-re-encode round trip would allocate a second copy
 * of the whole file. Either way the caller gets a FRESH array, because
 * `registerBuffer` consumes what it is given and this may be called twice.
 */
export async function fetchModelBytes(
  url: string,
  http: HttpClient = defaultHttp,
): Promise<Uint8Array> {
  const raw = await fetchRawBody(url, http);
  if (!isGzipBytes(raw)) return raw;
  return new TextEncoder().encode(await decodeOrExplain(url, raw));
}
```

- [ ] **Step 5: Update the three production call sites**

`src/features/layers/useLayerFileLoader.ts`, in `addLayerFromUrl`:

```ts
const parsed = await loadFromUrl(url);
await ensureModelCrsLoadable(parsed.model);
return useLayerStore.getState().addLayer({
  name: fileNameFromUrl(url),
  model: parsed.model,
  modelRef: { type: "url", url },
  visible: true,
  rules: [],
  rulesEnabled: true,
});
```

`src/app/App.tsx`, in `handleRestore`'s else branch:

```ts
const parsed = await loadFromUrl(modelRef.url);
await ensureModelCrsLoadable(parsed.model);
layerId = useLayerStore.getState().addLayer({
  name,
  model: parsed.model,
  modelRef,
  visible,
  rules,
  rulesEnabled,
  hiddenTypes,
  selectedAppearance: appearance,
});
```

`src/app/App.tsx`, in the share-hash effect's else branch:

```ts
const parsed = await loadFromUrl(sl.modelUrl);
await ensureModelCrsLoadable(parsed.model);
useLayerStore.getState().addLayer({
  name,
  model: parsed.model,
  modelRef: { type: "url", url: sl.modelUrl },
  visible,
  rules,
  rulesEnabled,
});
```

(Task 16 replaces all three with `addCityLayer`; this step only keeps the tree compiling.)

- [ ] **Step 6: Update every test that stubs or awaits `loadFromUrl`**

Run: `grep -rn "loadFromUrl" tests/`

For each stub, wrap the model: `loadFromUrl.mockResolvedValue(jsonModel)` becomes

```ts
loadFromUrl.mockResolvedValue({
  model: jsonModel,
  bytes: new TextEncoder().encode("{}"),
  encoding: "cityjson",
});
```

For each direct `await loadFromUrl(...)` assertion in `tests/unit/domain/citymodel/loadCityModel.test.ts` and `loadCityModelGzip.test.ts`, read `.model` off the result (e.g. `const { model } = await loadFromUrl(url, http);` and assert against `model`).

- [ ] **Step 7: Run the affected suites and the type check**

```bash
npx vitest run tests/unit/domain/citymodel tests/unit/app tests/unit/features/layers
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add src/domain/citymodel/loadCityModel.ts src/app/App.tsx src/features/layers/useLayerFileLoader.ts tests/
git commit -m "$(cat <<'EOF'
feat(citymodel): loadFromUrl returns the bytes it already decoded

The analytics table wants the source bytes and the loader is the only place
that has them, so a URL layer is never downloaded twice and read_cityjson over
a remote URL — unexercised in wasm, CORS-dependent — is never used at all.
bytes is null exactly where there is no DuckDB reader: CityGML and its ZIP.
fetchModelBytes is the same fetch without the parse, for the export's
SourceProvider.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 16: `addCityLayer` — one door for every static add

**Files:**

- Create: `src/features/layers/addCityLayer.ts`
- Modify: `src/features/layers/useLayerFileLoader.ts`
- Modify: `src/app/App.tsx` (the four direct `addLayer` calls in `handleRestore` and the share effect)
- Test: `tests/unit/features/layers/addCityLayer.test.ts`

**Interfaces:**

- Consumes: `useLayerStore.addLayer`; `enqueueLayerTable`, `LayerTableSource` (Task 13); `fetchModelBytes` (Task 15).
- Produces:

```ts
export interface AddCityLayerInput {
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible?: boolean;
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly selectedAppearance?: AppearanceTheme | null;
  /** What DuckDB should build this layer's table from. */
  readonly duckdb: LayerTableSource;
}
export function addCityLayer(input: AddCityLayerInput): string;

/** The reader-backed source for decoded bytes, or the flat fallback when the
 *  format has no reader. `refetch` re-obtains the DECODED bytes for an export;
 *  `null` means they cannot be re-obtained and CityParquet is refused. */
export function modelTableSource(input: {
  readonly model: CityModel;
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
  readonly refetch: SourceProvider | null;
}): LayerTableSource;

/** The provider for a URL-backed layer — re-fetched and gunzipped. */
export function urlSourceProvider(url: string): SourceProvider;
/** The provider for a file-backed layer — a File is a REFERENCE, not a copy. */
export function fileSourceProvider(file: File): SourceProvider;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/layers/addCityLayer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueued: Array<{ layerId: string; source: unknown }> = [];
/** Set to make the next enqueue REJECT — the "a DuckDB failure must not fail a
 *  layer add" case needs a rejection, not a resolved false. */
let enqueueRejects = false;
vi.mock("../../../../src/analytics/layerTables", () => ({
  enqueueLayerTable: vi.fn(async (layerId: string, source: unknown) => {
    enqueued.push({ layerId, source });
    if (enqueueRejects) throw new Error("DuckDB is not running");
  }),
}));

const { addCityLayer, modelTableSource } =
  await import("../../../../src/features/layers/addCityLayer");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
import type { CityModel } from "../../../../src/domain/citymodel/types";

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {},
  } as unknown as CityModel;
}

beforeEach(() => {
  enqueued.length = 0;
  enqueueRejects = false;
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

describe("modelTableSource", () => {
  const refetch = async () => new Uint8Array(1);

  it("is reader-backed for CityJSON bytes", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjson",
        refetch,
      }),
    ).toMatchObject({
      kind: "bytes",
      reader: "read_cityjson",
      extension: "city.json",
    });
  });

  it("is reader-backed for CityJSONSeq bytes, with the seq reader", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjsonseq",
        refetch,
      }),
    ).toMatchObject({
      kind: "bytes",
      reader: "read_cityjsonseq",
      extension: "city.jsonl",
    });
  });

  it("falls back to the model for CityGML, which has no reader", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: null,
        encoding: "citygml",
        refetch,
      }),
    ).toMatchObject({ kind: "model" });
  });

  it("falls back to the model whenever there are no bytes", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: null,
        encoding: "cityjson",
        refetch,
      }),
    ).toMatchObject({ kind: "model" });
  });

  it("still builds a reader-backed table with NO provider — the table works, the package export will not", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjson",
        refetch: null,
      }),
    ).toMatchObject({ kind: "bytes", provider: null });
  });
});

describe("addCityLayer", () => {
  it("adds the layer and enqueues its table under the SAME id", () => {
    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "url", url: "https://x/a.city.json" },
      duckdb: { kind: "model", model: model() },
    });
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([id]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.layerId).toBe(id);
  });

  it("passes the layer settings straight through", () => {
    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "file", fileName: "delft.city.json" },
      visible: false,
      rulesEnabled: false,
      hiddenTypes: ["Building"],
      duckdb: { kind: "model", model: model() },
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(layer.visible).toBe(false);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.hiddenTypes).toEqual(["Building"]);
  });

  it("does not let a REJECTED table build reach the caller, or the layer", async () => {
    enqueueRejects = true;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "url", url: "https://x/a.city.json" },
      duckdb: { kind: "model", model: model() },
    });

    // The layer landed regardless: an analytics engine that cannot start must
    // not cost the user their model.
    expect(id).toBeTypeOf("string");
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([id]);
    expect(enqueued).toHaveLength(1);

    // And the rejection is SWALLOWED, not left floating: `addCityLayer`
    // catches it rather than firing `void` at a promise that will reject.
    await Promise.resolve();
    await Promise.resolve();
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/features/layers/addCityLayer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/layers/addCityLayer.ts`**

```ts
/**
 * The ONE door every static city layer goes through.
 *
 * `addLayer` alone is not enough any more: a layer without its DuckDB table is
 * a layer with no table panel, no filter and no export, and there are SIX
 * places that add one (a dropped file, a picked folder, a URL, a snapshot
 * restore, a share link, and a re-linked unavailable layer). Routing them all
 * through here is what makes "layer tables are rebuilt on restore by the same
 * add path" true rather than aspirational.
 *
 * Streaming layers do NOT come through here — they are added by
 * `openStreamingLayer`, and their table is enqueued by the lifecycle module
 * when it sees the new layer, because their rows arrive cell by cell.
 */

import type { AppearanceTheme } from "@cityjson/navara-core";
import type { CityModel } from "../../domain/citymodel/types";
import {
  decodeModelBytes,
  fetchModelBytes,
  isGzipBytes,
} from "../../domain/citymodel/loadCityModel";
import type { CityModelReference } from "../../persistence/types";
import {
  enqueueLayerTable,
  type LayerTableSource,
  type SourceProvider,
} from "../../analytics/layerTables";
import type { Rule } from "../rules/types";
import { useLayerStore } from "./layerStore";

export interface AddCityLayerInput {
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible?: boolean;
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly selectedAppearance?: AppearanceTheme | null;
  readonly duckdb: LayerTableSource;
}

/** Re-fetch a URL layer's DECODED bytes for an export — `fetchModelBytes`
 *  gunzips on the magic bytes, so this returns exactly what the table was
 *  built from. The browser cache usually serves the request, and the
 *  alternative — holding every loaded file in the JS heap for the session —
 *  is what the VFS drop exists to avoid. */
export function urlSourceProvider(url: string): SourceProvider {
  return () => fetchModelBytes(url);
}

/**
 * Re-read a dropped file, decoded the same way.
 *
 * A `File` is a REFERENCE to something on disk, not a copy in memory, so
 * keeping one costs nothing — but it does not survive a reload, which is why a
 * layer restored from a snapshot is presented as "unavailable" rather than
 * silently given a provider that cannot work.
 *
 * Reads afresh on every call (`registerBuffer` CONSUMES what it is given, and
 * a provider may be called more than once), and only re-encodes when the file
 * really was gzipped: for the ordinary case the bytes read from disk already
 * ARE the decoded bytes.
 */
export function fileSourceProvider(file: File): SourceProvider {
  return async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isGzipBytes(bytes)) return bytes;
    return new TextEncoder().encode(await decodeModelBytes(bytes));
  };
}

/**
 * What DuckDB should build this layer's table from.
 *
 * Reader-backed whenever we HAVE decoded bytes for a format the cityjson
 * extension reads; the flat fallback otherwise — CityGML (and its ZIP), and
 * anything whose bytes we never held.
 *
 * `bytes` is handed straight through, never copied: `registerBuffer` CONSUMES
 * it, so the caller passes an array it is finished with. `loadFromUrl` and the
 * file loader both hand over the array they fetched or read whenever it was
 * not gzipped, and allocate a second one only when a gunzip really happened.
 */
export function modelTableSource(input: {
  readonly model: CityModel;
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
  readonly refetch: SourceProvider | null;
}): LayerTableSource {
  if (input.bytes === null || input.encoding === "citygml") {
    return { kind: "model", model: input.model };
  }
  return input.encoding === "cityjsonseq"
    ? {
        kind: "bytes",
        bytes: input.bytes,
        reader: "read_cityjsonseq",
        extension: "city.jsonl",
        provider: input.refetch,
      }
    : {
        kind: "bytes",
        bytes: input.bytes,
        reader: "read_cityjson",
        extension: "city.json",
        provider: input.refetch,
      };
}

/**
 * Add a static city layer and start building its DuckDB table.
 *
 * The enqueue is FIRE AND FORGET on purpose: a DuckDB failure is recorded on
 * the table entry and shown in the panel, and must never fail a layer add.
 * `enqueueLayerTable` already settles rather than throwing for a build that
 * fails, so the `.catch` here is for the case it cannot handle — an engine
 * that is not running at all — and exists so a rejection cannot escape as an
 * unhandled promise.
 */
export function addCityLayer(input: AddCityLayerInput): string {
  const layerId = useLayerStore.getState().addLayer({
    name: input.name,
    model: input.model,
    modelRef: input.modelRef,
    visible: input.visible ?? true,
    rules: input.rules ?? [],
    rulesEnabled: input.rulesEnabled ?? true,
    hiddenTypes: input.hiddenTypes,
    selectedAppearance: input.selectedAppearance,
  });
  void enqueueLayerTable(layerId, input.duckdb).catch((error: unknown) => {
    console.warn(
      `DuckDB table for layer ${layerId} could not be started:`,
      error,
    );
  });
  return layerId;
}
```

- [ ] **Step 4: Route `useLayerFileLoader` through it**

In `src/features/layers/useLayerFileLoader.ts`, add the imports

```ts
import {
  addCityLayer,
  fileSourceProvider,
  modelTableSource,
  urlSourceProvider,
} from "./addCityLayer";
```

and widen the existing `loadCityModel` import to include `isGzipBytes`.

then replace each `useLayerStore.getState().addLayer({ … })`:

`addLayerFromFile`, the CityParquet arm — the parser produces the model and nothing else, so the flat fallback:

```ts
layerId = addCityLayer({
  name: file.name,
  model,
  modelRef: { type: "file", fileName: file.name },
  visible: overrides?.visible,
  rules: overrides?.rules,
  rulesEnabled: overrides?.rulesEnabled,
  hiddenTypes: overrides?.hiddenTypes,
  selectedAppearance: overrides?.selectedAppearance,
  duckdb: { kind: "model", model },
});
```

`addLayerFromFile`, the text arm — the bytes are already in hand, and a ZIP takes the fallback:

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const zipped = isZipBytes(bytes);
const gzipped = !zipped && isGzipBytes(bytes);
const text = zipped ? "" : await decodeModelBytes(bytes);
const parsed: CityModel = zipped
  ? parseCityGmlArchive(bytes, file.name)
  : parseText(file.name, text);
await ensureModelCrsLoadable(parsed);
const encoding = detectEncoding(file.name);
layerId = addCityLayer({
  name: file.name,
  model: parsed,
  modelRef: { type: "file", fileName: file.name },
  visible: overrides?.visible,
  rules: overrides?.rules,
  rulesEnabled: overrides?.rulesEnabled,
  hiddenTypes: overrides?.hiddenTypes,
  selectedAppearance: overrides?.selectedAppearance,
  duckdb: modelTableSource({
    model: parsed,
    // The array we ALREADY READ when nothing was gunzipped: a re-encode would
    // duplicate the whole file in the JS heap, and `registerBuffer` is about
    // to consume whichever array it gets.
    bytes:
      zipped || encoding === "citygml"
        ? null
        : gzipped
          ? new TextEncoder().encode(text)
          : bytes,
    encoding:
      encoding === "cityjsonseq"
        ? "cityjsonseq"
        : encoding === "citygml"
          ? "citygml"
          : "cityjson",
    refetch: fileSourceProvider(file),
  }),
});
```

`addLayerFromFiles` (a CityParquet package) — flat fallback:

```ts
const layerId = addCityLayer({
  name,
  model,
  modelRef: { type: "file", fileName: name },
  visible: overrides?.visible,
  rules: overrides?.rules,
  rulesEnabled: overrides?.rulesEnabled,
  hiddenTypes: overrides?.hiddenTypes,
  selectedAppearance: overrides?.selectedAppearance,
  duckdb: { kind: "model", model },
});
```

`addLayerFromUrl`, the CityParquet arm:

```ts
return addCityLayer({
  name: cityParquetLayerNameFromUrl(url),
  model,
  modelRef: { type: "url", url },
  duckdb: { kind: "model", model },
});
```

`addLayerFromUrl`, the general arm:

```ts
const parsed = await loadFromUrl(url);
await ensureModelCrsLoadable(parsed.model);
return addCityLayer({
  name: fileNameFromUrl(url),
  model: parsed.model,
  modelRef: { type: "url", url },
  duckdb: modelTableSource({
    model: parsed.model,
    bytes: parsed.bytes,
    encoding: parsed.encoding,
    refetch: urlSourceProvider(url),
  }),
});
```

- [ ] **Step 5: Route `App.tsx`'s four direct adds through it**

Import `addCityLayer`, `modelTableSource`, `urlSourceProvider` in `src/app/App.tsx` and replace:

`handleRestore`, the CityParquet arm:

```ts
const parsed = await loadCityParquetFromUrl(modelRef.url);
await ensureModelCrsLoadable(parsed);
layerId = addCityLayer({
  name,
  model: parsed,
  modelRef,
  visible,
  rules,
  rulesEnabled,
  hiddenTypes,
  selectedAppearance: appearance,
  duckdb: { kind: "model", model: parsed },
});
```

`handleRestore`, the general arm:

```ts
const parsed = await loadFromUrl(modelRef.url);
await ensureModelCrsLoadable(parsed.model);
layerId = addCityLayer({
  name,
  model: parsed.model,
  modelRef,
  visible,
  rules,
  rulesEnabled,
  hiddenTypes,
  selectedAppearance: appearance,
  duckdb: modelTableSource({
    model: parsed.model,
    bytes: parsed.bytes,
    encoding: parsed.encoding,
    refetch: urlSourceProvider(modelRef.url),
  }),
});
```

The share effect's two arms, identically (`visible`, `rules`, `rulesEnabled` only, no `hiddenTypes`/`appearance` — a share link carries neither):

```ts
const parsed = await loadCityParquetFromUrl(sl.modelUrl);
await ensureModelCrsLoadable(parsed);
addCityLayer({
  name,
  model: parsed,
  modelRef: { type: "url", url: sl.modelUrl },
  visible,
  rules,
  rulesEnabled,
  duckdb: { kind: "model", model: parsed },
});
```

```ts
const parsed = await loadFromUrl(sl.modelUrl);
await ensureModelCrsLoadable(parsed.model);
addCityLayer({
  name,
  model: parsed.model,
  modelRef: { type: "url", url: sl.modelUrl },
  visible,
  rules,
  rulesEnabled,
  duckdb: modelTableSource({
    model: parsed.model,
    bytes: parsed.bytes,
    encoding: parsed.encoding,
    refetch: urlSourceProvider(sl.modelUrl),
  }),
});
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npx vitest run tests/unit/features/layers tests/unit/app
npx tsc -b --noEmit
```

Expected: PASS and clean. (The App tests mock `analytics/duckdb`, not `analytics/layerTables`; the real `enqueueLayerTable` runs against the mocked engine and records a failed table, which nothing in those tests asserts on.)

- [ ] **Step 7: Commit**

```bash
git add src/features/layers/addCityLayer.ts src/features/layers/useLayerFileLoader.ts src/app/App.tsx tests/unit/features/layers/addCityLayer.test.ts
git commit -m "$(cat <<'EOF'
feat(layers): addCityLayer — one door for every static add

Six places add a static city layer (a dropped file, a picked folder, a URL, a
restore, a share link, a re-link) and a layer without its DuckDB table has no
table panel, no filter and no export. Routing all six through one call is what
makes "layer tables are rebuilt on restore by the same add path" true. The
enqueue is fire-and-forget: a DuckDB failure shows in the panel and must never
fail a layer add.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 17: The layer-table lifecycle — drops, streaming rebuilds, the panel gate

**Files:**

- Create: `src/features/layers/layerTableLifecycle.ts`
- Test: `tests/unit/features/layers/layerTableLifecycle.test.ts`

**Interfaces:**

- Consumes: `useLayerStore`, `useStreamStore`, `getResidentModel`, `enqueueLayerTable`, `dropLayerTable`, `useLayerTableStore`, `useQueryStore.resetQuery`.
- Produces:

```ts
/** How long a streaming layer's commits are coalesced before a rebuild. */
export const STREAM_REBUILD_DEBOUNCE_MS: 500;
/** Subscribe the table registry to the stores. Returns its own unsubscribe;
 *  call once from App's mount effect. */
export function installLayerTableLifecycle(): () => void;
/** The resident-record source for a streaming layer, exported for tests. */
export function residentTableSource(layerId: string): LayerTableSource;
/** Rebuild one streaming layer's table NOW, and resolve when it has settled.
 *  The export dialog's door: it must not write a stale resident set. */
export function refreshStreamingTable(layerId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/layers/layerTableLifecycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueued: string[] = [];
const dropped: string[] = [];
vi.mock("../../../../src/analytics/layerTables", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/analytics/layerTables")
    >();
  return {
    ...actual,
    enqueueLayerTable: vi.fn(async (layerId: string) => {
      enqueued.push(layerId);
    }),
    dropLayerTable: vi.fn(async (layerId: string) => {
      dropped.push(layerId);
    }),
  };
});

const {
  installLayerTableLifecycle,
  refreshStreamingTable,
  STREAM_REBUILD_DEBOUNCE_MS,
} = await import("../../../../src/features/layers/layerTableLifecycle");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function layer(over: Partial<Layer>): Layer {
  return {
    id: "L",
    name: "layer",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

let uninstall: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  enqueued.length = 0;
  dropped.length = 0;
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  uninstall = installLayerTableLifecycle();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("removals", () => {
  it("drops the table of a layer that disappeared", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useLayerStore.setState({ layers: [] });
    expect(dropped).toEqual(["A"]);
  });

  it("drops every table when the whole workspace is cleared", () => {
    useLayerStore.setState({
      layers: [layer({ id: "A" }), layer({ id: "B" })],
    });
    useLayerStore.getState().removeAllLayers();
    expect(dropped.sort()).toEqual(["A", "B"]);
  });

  it("forgets the layer's query along with its table", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useQueryStore.getState().setSyncToMap("A", true);
    useLayerStore.setState({ layers: [] });
    expect(useQueryStore.getState().queries.A).toBeUndefined();
  });

  it("does not drop a table for a layer that is merely renamed", () => {
    useLayerStore.setState({ layers: [layer({ id: "A" })] });
    useLayerStore.getState().updateLayer("A", { name: "renamed" });
    expect(dropped).toEqual([]);
  });
});

describe("streaming layers", () => {
  it("enqueues a table when a streaming layer appears (static ones are already enqueued by addCityLayer)", () => {
    useLayerStore.setState({
      layers: [layer({ id: "S", isStreaming: true }), layer({ id: "A" })],
    });
    expect(enqueued).toEqual(["S"]);
  });

  it("ignores a commit while the table panel is closed", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    enqueued.length = 0;
    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });

  it("rebuilds on a commit while the panel is open, debounced", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;

    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    useStreamStore.setState({ streams: { S: { version: 2 } as never } });
    useStreamStore.setState({ streams: { S: { version: 3 } as never } });
    expect(enqueued).toEqual([]);

    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
    expect(enqueued).toEqual(["S"]);
  });

  it("refreshStreamingTable rebuilds at once, with no panel and no debounce", async () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    enqueued.length = 0;
    await refreshStreamingTable("S");
    expect(enqueued).toEqual(["S"]);
  });

  it("rebuilds every streaming layer when the panel OPENS — their versions moved while it was shut", () => {
    useLayerStore.setState({
      layers: [
        layer({ id: "S1", isStreaming: true }),
        layer({ id: "S2", isStreaming: true }),
        layer({ id: "A" }),
      ],
    });
    enqueued.length = 0;
    useLayerTableStore.getState().setTablePanelOpen(true);
    expect(enqueued.sort()).toEqual(["S1", "S2"]);
  });

  it("cancels a pending rebuild on uninstall", () => {
    useLayerStore.setState({ layers: [layer({ id: "S", isStreaming: true })] });
    useLayerTableStore.getState().setTablePanelOpen(true);
    enqueued.length = 0;
    useStreamStore.setState({ streams: { S: { version: 1 } as never } });
    uninstall();
    vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS * 2);
    expect(enqueued).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/layers/layerTableLifecycle.ts`**

```ts
/**
 * What keeps the layer-table registry in step with the stores.
 *
 * A store SUBSCRIPTION rather than a React effect, and rather than calls
 * sprinkled through the removal paths, because there are three ways a layer
 * leaves — `removeLayer` from the sidebar, `removeAllLayers` from "Close file"
 * and from a restore — and covering them one at a time is how the second one
 * gets missed. Diffing the id list covers all of them and anything added later.
 *
 * Installed ONCE from `App`'s mount effect, not at module scope: tests import
 * this module, and a module-scope subscription would leak between them.
 *
 * It deliberately does NOT own the engine retry. `retryEngine` (in
 * `layerTables`) is driven by `App`, which is the only place that already
 * awaits the boot and re-reads the status — the DuckDB status is not a store,
 * so a subscription here would have to POLL for a transition App observes for
 * free.
 */

import { useStreamStore } from "../streaming/streamStore";
import { getResidentModel } from "../streaming/residentModel";
import { useQueryStore } from "../query/queryStore";
import {
  dropLayerTable,
  enqueueLayerTable,
  useLayerTableStore,
  type LayerTableSource,
} from "../../analytics/layerTables";
import { useLayerStore } from "./layerStore";

/**
 * How long a streaming layer's cell commits are coalesced before its table is
 * rebuilt. A commit lands on every camera settle, and a rebuild re-reads the
 * whole resident set — half a second is long enough that a pan costs one
 * rebuild rather than one per cell, and short enough that the grid catches up
 * before the user has read the row count.
 */
export const STREAM_REBUILD_DEBOUNCE_MS = 500;

/** A streaming layer's rows, read at BUILD time — the resident set is
 *  whatever has landed by then. */
export function residentTableSource(layerId: string): LayerTableSource {
  return {
    kind: "resident",
    // The `0` is NOT a version we are pinning. `getResidentModel`'s second
    // parameter is a SUBSCRIPTION MARKER for React callers — it exists so a
    // component that reads the resident model also subscribes to commits, and
    // the function itself does `void version` (the handle memoises on its own
    // commit counter). This is not a component: it reads whatever is resident
    // at the moment the queued build runs, which is exactly what it wants.
    records: () => Object.values(getResidentModel(layerId, 0).objects),
  };
}

/**
 * Rebuild one streaming layer's table immediately.
 *
 * The export dialog's door. The debounced rebuild above only runs while the
 * table panel is open, so a user who opens Export straight from a collapsed
 * panel would otherwise write whatever was resident the last time anyone
 * looked. Awaits the build so the caller can show a busy state; a failure is
 * recorded on the entry, as always, and never thrown.
 */
export async function refreshStreamingTable(layerId: string): Promise<void> {
  await enqueueLayerTable(layerId, residentTableSource(layerId));
}

export function installLayerTableLifecycle(): () => void {
  let knownLayerIds = new Set(useLayerStore.getState().layers.map((l) => l.id));
  let knownVersions = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // Only while somebody is LOOKING. A stream commits on every camera settle,
  // and rebuilding a table nothing is reading is pure cost. An EXPORT does not
  // widen this: it forces one rebuild when its dialog opens
  // (`refreshStreamingTable`) and then wants the table to hold still.
  const rebuildWanted = (): boolean =>
    useLayerTableStore.getState().tablePanelOpen;

  const scheduleRebuild = (layerId: string): void => {
    const existing = timers.get(layerId);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      layerId,
      setTimeout(() => {
        timers.delete(layerId);
        void enqueueLayerTable(layerId, residentTableSource(layerId));
      }, STREAM_REBUILD_DEBOUNCE_MS),
    );
  };

  const unsubscribeLayers = useLayerStore.subscribe((state) => {
    const ids = new Set(state.layers.map((l) => l.id));

    for (const id of knownLayerIds) {
      if (ids.has(id)) continue;
      const timer = timers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(id);
      }
      knownVersions.delete(id);
      // The query is written against THAT table's columns; a re-added layer is
      // a different table and must not inherit a predicate naming columns it
      // may not have.
      useQueryStore.getState().resetQuery(id);
      void dropLayerTable(id);
    }

    for (const layer of state.layers) {
      // A STATIC layer's table was enqueued by `addCityLayer`, which is the
      // only place that has its bytes. A STREAMING layer has none to give, so
      // it is enqueued here — empty at first, then rebuilt as cells land.
      if (!knownLayerIds.has(layer.id) && layer.isStreaming) {
        void enqueueLayerTable(layer.id, residentTableSource(layer.id));
      }
    }

    knownLayerIds = ids;
  });

  const unsubscribeStreams = useStreamStore.subscribe((state) => {
    for (const [layerId, stream] of Object.entries(state.streams)) {
      const version = stream?.version ?? 0;
      if (knownVersions.get(layerId) === version) continue;
      knownVersions.set(layerId, version);
      if (!knownLayerIds.has(layerId)) continue;
      if (rebuildWanted()) scheduleRebuild(layerId);
    }
  });

  let panelWasOpen = useLayerTableStore.getState().tablePanelOpen;
  const unsubscribePanel = useLayerTableStore.subscribe((state) => {
    if (state.tablePanelOpen === panelWasOpen) return;
    panelWasOpen = state.tablePanelOpen;
    if (!panelWasOpen) return;
    // Opening the panel: every streaming layer's version moved while it was
    // shut, and the tables it is about to show are stale by exactly that much.
    for (const layer of useLayerStore.getState().layers) {
      if (layer.isStreaming) {
        void enqueueLayerTable(layer.id, residentTableSource(layer.id));
      }
    }
  });

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeLayers();
    unsubscribeStreams();
    unsubscribePanel();
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/layers/layerTableLifecycle.ts tests/unit/features/layers/layerTableLifecycle.test.ts
git commit -m "$(cat <<'EOF'
feat(layers): subscribe the table registry to the layer and stream stores

Three paths remove a layer (removeLayer, removeAllLayers from Close file and
from a restore) and covering them one at a time is how the second gets missed,
so the lifecycle diffs the id list instead. Streaming layers get their table
here, rebuilt on commits only while the panel is open or an export is pending
— a stream commits on every camera settle, and rebuilding a table nobody is
reading is pure cost.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 18: Delete the old DuckDB loading path from `App.tsx` and `duckdb.ts`

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/analytics/duckdb.ts`
- Modify: `src/ui/table/TablePanel.tsx` (prop removal only)
- Modify: `src/ui/inspector/InspectorPanel.tsx`, `src/ui/inspector/StatsTab.tsx` (prop removal only)
- Modify: `tests/unit/app/appCityParquetLayers.test.tsx`

**Interfaces:**

- Consumes: `installLayerTableLifecycle` (Task 17), `useLayerTableStore` (Task 13).
- Produces: `shouldUseSourceUrlPath`, `loadModelIntoDuckDB`, `loadCityModelFromMemory`, `loadResidentObjectsIntoDuckDB` no longer exist. `TablePanel` loses `duckdbTableLoaded`; `InspectorPanel` and `StatsTab` lose `duckdbModelLoaded`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/app/appCityParquetLayers.test.tsx`, add this mock beside the existing ones (before the `await import` of `App`):

```ts
/** What the app asked DuckDB to build a table from, per layer. */
const enqueued: Array<{ layerId: string; kind: string }> = [];
vi.mock("../../../src/analytics/layerTables", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/analytics/layerTables")>();
  return {
    ...actual,
    enqueueLayerTable: vi.fn(
      async (layerId: string, source: { kind: string }) => {
        enqueued.push({ layerId, kind: source.kind });
      },
    ),
    dropLayerTable: vi.fn(async () => {}),
  };
});
```

Add `enqueued.length = 0;` to `beforeEach`, and add this `describe` block:

```ts
describe("DuckDB layer tables", () => {
  it("builds a CityParquet layer's table from the parsed MODEL — there is no reader for it", async () => {
    location.hash = shareHash([{ name: "pkg", modelUrl: PARQUET_URL }]);
    render(<App persistenceStore={storeWith(null)} />);
    await waitFor(() => expect(enqueued).toHaveLength(1));
    expect(enqueued[0]!.kind).toBe("model");
  });

  it("builds an ordinary CityJSON URL layer's table from the decoded BYTES", async () => {
    location.hash = shareHash([{ name: "delft", modelUrl: JSON_URL }]);
    render(<App persistenceStore={storeWith(null)} />);
    await waitFor(() => expect(enqueued).toHaveLength(1));
    expect(enqueued[0]!.kind).toBe("bytes");
  });
});
```

For the second case, `loadFromUrl`'s stub must carry bytes — set it in `beforeEach`:

```ts
loadFromUrl.mockResolvedValue({
  model: jsonModel,
  bytes: new TextEncoder().encode("{}"),
  encoding: "cityjson",
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/app/appCityParquetLayers.test.tsx`
Expected: FAIL — nothing enqueues yet from the share path (Task 16 wired it, so this may already pass for `kind`; if it does, it fails on the second case until the mock carries bytes).

- [ ] **Step 3: Delete the DuckDB load effect and its flags from `App.tsx`**

- Delete the whole `// Load active layer's model into DuckDB …` effect (the one whose dependency array is `[duckdbStatus, activeLayerId, layers, activeStreamVersion]`).
- Delete the `duckdbModelLoaded` and `duckdbTableLoaded` state declarations and every `setDuckdbModelLoaded` / `setDuckdbTableLoaded` call (including the two inside `handleClose`).
- Delete the now-unused imports `loadModelIntoDuckDB`, `loadCityModelFromMemory`, `loadResidentObjectsIntoDuckDB`, `shouldUseSourceUrlPath`, and `getResidentModel` if nothing else in the file uses it (grep first — `useTotalObjectCount` is separate). Add `retryEngine` from `../analytics/layerTables`; `initDuckDB` is no longer imported directly by `App.tsx`.
- Delete the `activeStreamVersion` selector if nothing else reads it (grep: it is also unused once the effect goes).
- Replace `<TablePanel duckdbTableLoaded={duckdbTableLoaded} … />` with `<TablePanel … />` (props: `onCollapse`, `onHeightChange`).
- Replace `<InspectorPanel … duckdbModelLoaded={duckdbModelLoaded} />` with the same element minus that prop.
- Add the lifecycle install beside the DuckDB init effect:

```ts
// Initialize DuckDB-wasm on mount, and subscribe the layer-table registry to
// the stores. One install, torn down with the app: the subscriptions are
// module-level machinery, not per-render state.
useEffect(() => {
  // BEFORE the await, not after: the cold boot takes ~3.5 s (a 36 MB wasm
  // module plus the community extension), and the status starts as
  // `uninitialized`, which the table panel renders as "the analytics engine is
  // not running" with a Retry button. Announcing the ATTEMPT first turns that
  // into "Loading" for the duration.
  setDuckdbStatus({ state: "initializing" });
  // `retryEngine`, not `initDuckDB`: it awaits the same (memoised) boot and
  // then rebuilds any table that was refused while the engine was still coming
  // up. A layer added during the boot — a restored snapshot, a share link, a
  // quick drop — must not need the user to notice and re-add it.
  void retryEngine().then(() => {
    setDuckdbStatus(getDuckDBStatus());
  });
  return installLayerTableLifecycle();
}, []);
```

- Keep the table panel's open flag in step with the registry, so a streaming layer rebuilds while it is on screen:

```ts
useEffect(() => {
  useLayerTableStore.getState().setTablePanelOpen(tableOpen);
}, [tableOpen]);
```

- [ ] **Step 4: Delete the four dead functions from `src/analytics/duckdb.ts`**

Delete `shouldUseSourceUrlPath`, `loadModelIntoDuckDB`, the whole `In-memory loading` section (`RESERVED_COLS`, `registerCityObjectRows`, `attributeRow`, `loadCityModelFromMemory`, `loadResidentObjectsIntoDuckDB`) and the now-unused imports `CityModel`, `CityModelReference`, `UrlModelRef`, `ResidentObjectRecord`. Update the module doc comment's last paragraph to:

```
 * Per-layer tables live in `analytics/layerTables.ts`, which reaches the
 * engine only through the functions exported here — this module is the ONLY
 * importer of `@duckdb/duckdb-wasm` in the app.
```

- [ ] **Step 5: Drop the props from the three UI files (compile-only for now)**

- `src/ui/table/TablePanel.tsx`: remove `duckdbTableLoaded` from `TablePanelProps` and from the component's parameters; leave the body's `if (duckdbTableLoaded)` branch replaced by an unconditional `true` for now — Task 21 rewrites the file wholesale.
- `src/ui/inspector/InspectorPanel.tsx`: remove `duckdbModelLoaded` from the props interface, the destructuring and the `<StatsTab … />` call.
- `src/ui/inspector/StatsTab.tsx`: remove `duckdbModelLoaded` from `StatsTabProps`, the destructuring, and the effect's dependency; leave the effect returning early (`setDuckdbStats(null); return;`) — Task 19 rewrites it.

- [ ] **Step 6: Move `duckdbLabel` / `duckdbTooltip` out of `StatusBar.tsx`**

Task 3 exported them from the component file for their test, which trips the
lint rule `react/only-export-components` (`vp check --fix` warns and cannot fix
it). They are pure functions of a status object with no JSX in them, so they
belong in a module of their own.

Create `src/ui/duckdbStatusText.ts` and move `duckdbLabel`, `duckdbTooltip` and
`duckdbDotClass` into it VERBATIM — the same bodies and the same doc comments,
plus the `DuckDBStatus` type import:

```ts
/**
 * The words the status bar says about the analytics engine.
 *
 * Split out of `StatusBar.tsx` because they are pure functions of a status
 * object and a file that exports a component must export only components
 * (`react/only-export-components`) — a lint rule that exists so a fast-refresh
 * boundary stays a component boundary.
 */

import type { DuckDBStatus } from "../analytics/duckdb";
```

Then, in `StatusBar.tsx`, delete the three functions and import them:

```ts
import { duckdbDotClass, duckdbLabel, duckdbTooltip } from "./duckdbStatusText";
```

Finally, point the test at the new module — in
`tests/unit/ui/StatusBarDuckdb.test.tsx`, change

```ts
import { duckdbLabel, duckdbTooltip } from "../../../src/ui/StatusBar";
```

to

```ts
import { duckdbLabel, duckdbTooltip } from "../../../src/ui/duckdbStatusText";
```

- [ ] **Step 7: Run the suite, the type check and the linter**

```bash
npx vitest run
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, clean, and no `only-export-components` warning for
`StatusBar.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx src/analytics/duckdb.ts src/ui tests/unit/app/appCityParquetLayers.test.tsx tests/unit/ui/StatusBarDuckdb.test.tsx
git commit -m "$(cat <<'EOF'
refactor: delete the single global city_objects table and its loaders

App's DuckDB effect rebuilt one shared table for whichever layer happened to be
active, so a second layer silently replaced the first one's analytics.
Per-layer tables replace it outright: shouldUseSourceUrlPath,
loadModelIntoDuckDB, loadCityModelFromMemory and loadResidentObjectsIntoDuckDB
are deleted, not deprecated.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 19: `StatsTab` reads the active layer's own table

**Files:**

- Modify: `src/ui/inspector/StatsTab.tsx`
- Modify: `src/ui/inspector/InspectorPanel.tsx` (pass `layerId`)
- Test: `tests/unit/ui/inspector/StatsTabDuckdb.test.tsx`

**Interfaces:**

- Consumes: `useLayerTableStore`, `getLayerTable` (Task 13); `runQuery` (Task 2); `quoteIdent` (Task 9).
- Produces: `StatsTabProps` becomes `{ model: CityModel; selection: Selection | null; layerId: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/inspector/StatsTabDuckdb.test.tsx`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { StatsTab } = await import("../../../../src/ui/inspector/StatsTab");
const { useLayerTableStore } = await import(
  "../../../../src/analytics/layerTables"
);
import type { CityModel } from "../../../../src/domain/citymodel/types";

const model = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
} as unknown as CityModel;

const READY = {
  state: "ready" as const,
  info: {
    table: "layer_7",
    sourceName: null,
    source: null,
    reader: null,
    columns: [{ name: "object_type", type: "VARCHAR", kind: "scalar" as const }],
    lods: [],
    rowCount: 3,
  },
};

beforeEach(() => {
  runQuery.mockReset();
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
});

afterEach(cleanup);

describe("StatsTab's DuckDB section", () => {
  it("queries the LAYER's own table, grouped by object_type", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["object_type", "n"],
      rows: [
        { object_type: "Building", n: 2 },
        { object_type: "BuildingPart", n: 1 },
      ],
    });
    useLayerTableStore.setState({ tables: { L1: READY } });

    render(<StatsTab model={model} selection={null} layerId="L1" />);

    expect(await screen.findByText("DuckDB Analytics")).toBeTruthy();
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "object_type", COUNT(*) AS "n" FROM "layer_7" GROUP BY 1 ORDER BY 2 DESC',
    );
    expect(await screen.findByText("Building")).toBeTruthy();
    expect(screen.getByText("Rows loaded")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows nothing DuckDB-ish while the table is still building", () => {
    useLayerTableStore.setState({ tables: { L1: { state: "building" } } });
    render(<StatsTab model={model} selection={null} layerId="L1" />);
    expect(screen.queryByText("DuckDB Analytics")).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("shows nothing DuckDB-ish for a layer with no table at all", () => {
    render(<StatsTab model={model} selection={null} layerId={null} />);
    expect(screen.queryByText("DuckDB Analytics")).toBeNull();
  });

  it("still renders the pure model statistics without a table", () => {
    render(<StatsTab model={model} selection={null} layerId={null} />);
    expect(screen.getByText("Statistics")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/inspector/StatsTabDuckdb.test.tsx`
Expected: FAIL — `StatsTab` has no `layerId` prop and still queries `city_objects`.

- [ ] **Step 3: Rewrite the DuckDB half of `src/ui/inspector/StatsTab.tsx`**

Replace the imports of `queryDuckDB` / `QueryResult` with:

```ts
import { runQuery } from "../../analytics/duckdb";
import { useLayerTableStore } from "../../analytics/layerTables";
import { quoteIdent } from "../../analytics/sql";
```

Replace `StatsTabProps` and the DuckDB effect with:

```ts
interface StatsTabProps {
  readonly model: CityModel;
  readonly selection: Selection | null;
  /** Whose DuckDB table to summarise — the layer the inspector is showing,
   *  which follows the SELECTION when there is one. `null` while no layer has
   *  a table, in which case the pure model statistics stand alone. */
  readonly layerId: string | null;
}

interface DuckDBStats {
  readonly rowCount: number;
  readonly typeBreakdown: ReadonlyArray<{ type: string; count: number }>;
}

export function StatsTab({ model, selection, layerId }: StatsTabProps) {
  const modelStats = useMemo(() => computeModelStats(model), [model]);

  const objectStats = useMemo(
    () => (selection ? computeObjectStats(model, selection.objectId) : null),
    [model, selection],
  );

  // Subscribed to the entry, not read imperatively: the table is built
  // asynchronously after the layer lands, so the panel has to re-render when
  // it becomes ready.
  const tableState = useLayerTableStore((s) =>
    layerId === null ? undefined : s.tables[layerId],
  );
  const table = tableState?.state === "ready" ? tableState.info : null;

  const [duckdbStats, setDuckdbStats] = useState<DuckDBStats | null>(null);

  useEffect(() => {
    if (table === null) {
      setDuckdbStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // `object_type`, not `type`: that is the column the cityjson reader
      // writes, and the one the flat fallback was aligned to. The old query
      // named `type`, which no layer table has ever had.
      const result = await runQuery(
        `SELECT "object_type", COUNT(*) AS "n" FROM ${quoteIdent(table.table)} GROUP BY 1 ORDER BY 2 DESC`,
      );
      if (cancelled) return;
      setDuckdbStats({
        rowCount: table.rowCount,
        typeBreakdown: result.ok ? extractTypeBreakdown(result.rows) : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [table]);
```

Replace `extractCount` / `extractTypeBreakdown` at the bottom with:

```ts
function extractTypeBreakdown(
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<{ type: string; count: number }> {
  return rows.map((row) => ({
    type:
      typeof row.object_type === "string"
        ? row.object_type
        : JSON.stringify(row.object_type ?? "unknown"),
    count: typeof row.n === "number" ? row.n : Number(row.n) || 0,
  }));
}
```

(`extractCount` is deleted — the row count comes off `LayerTable.rowCount`.)

- [ ] **Step 4: Pass the layer id from `InspectorPanel`**

In `src/ui/inspector/InspectorPanel.tsx`, the stats branch is guarded on
`model` — NOT on `displayLayer`, which is `Layer | undefined` — so leave the
two existing props exactly as they are and add ONE line. Reaching for
`displayLayer.model` here is a TS18048 ("possibly undefined") that the `model`
guard does not narrow:

```tsx
<StatsTab
  model={model}
  selection={selection}
  layerId={displayLayer?.id ?? null}
/>
```

(and delete the `duckdbModelLoaded={duckdbModelLoaded}` line, plus the prop on
`InspectorPanelProps` and its destructuring, if Task 18 has not already.)

- [ ] **Step 5: Run the tests and the type check**

```bash
npx vitest run tests/unit/ui/inspector
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/inspector/StatsTab.tsx src/ui/inspector/InspectorPanel.tsx tests/unit/ui/inspector/StatsTabDuckdb.test.tsx
git commit -m "$(cat <<'EOF'
fix(inspector): stats read the layer's own table, grouped by object_type

The old query read a `type` column from a global city_objects table. The
reader schema has no such column — it is `object_type` — so the breakdown had
been empty for every extension-backed layer, and with one shared table a
second layer replaced the first one's numbers outright.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 20: `useLayerQuery` — one page of one layer's table

**Files:**

- Create: `src/ui/table/useLayerQuery.ts`
- Test: `tests/unit/ui/table/useLayerQuery.test.tsx`

**Interfaces:**

- Consumes: `useLayerTableStore`, `LayerTable` (Task 13); `useQueryStore`, `layerQuery` (Task 8); `compileFilter`, `buildPageSql`, `buildCountSql`, `gridColumns` (Tasks 9–10); `runQuery` (Task 2).
- Produces:

```ts
export interface LayerQueryView {
  /** `"no-layer"` means NOTHING is selected. A selected layer whose registry
   *  entry has not been written yet is `"queued"`, never `"no-layer"`. */
  readonly status: "no-layer" | "queued" | "building" | "failed" | "ready";
  /** A build failure, a compile refusal or DuckDB's own message. */
  readonly message: string | null;
  readonly table: LayerTable | null;
  /** The columns the grid renders, blobs already dropped. */
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /** Rows matching the applied filter. */
  readonly totalRows: number;
  /** Rows in the table, filter or no filter. */
  readonly unfilteredRows: number;
  readonly loading: boolean;
  readonly reload: () => void;
}

export function useLayerQuery(layerId: string | null): LayerQueryView;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/table/useLayerQuery.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { useLayerQuery } =
  await import("../../../../src/ui/table/useLayerQuery");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    { name: "g", type: "BLOB", kind: "blob" as const },
  ],
  lods: [],
  rowCount: 42,
};

function Probe({ layerId }: { readonly layerId: string | null }) {
  const view = useLayerQuery(layerId);
  return (
    <div>
      <span data-testid="status">{view.status}</span>
      <span data-testid="rows">{view.rows.length}</span>
      <span data-testid="total">{view.totalRows}</span>
      <span data-testid="unfiltered">{view.unfilteredRows}</span>
      <span data-testid="cols">
        {view.columns.map((c) => c.name).join(",")}
      </span>
      <span data-testid="message">{view.message ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  runQuery.mockReset();
  runQuery.mockResolvedValue({ ok: true, columns: [], rows: [] });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useQueryStore.setState({ queries: {} });
});

afterEach(cleanup);

describe("useLayerQuery", () => {
  it("reports no-layer with nothing selected", () => {
    render(<Probe layerId={null} />);
    expect(screen.getByTestId("status").textContent).toBe("no-layer");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("reports QUEUED for a selected layer whose entry has not been written yet", () => {
    // `addCityLayer` adds the layer, THEN enqueues: there is a commit in
    // between with no registry entry, and "Select a layer…" must not flash
    // over a layer the user just dropped.
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("queued");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("mirrors the table's queued and building states without querying", () => {
    useLayerTableStore.setState({ tables: { L: { state: "queued" } } });
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("queued");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("surfaces a build failure's message", () => {
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("failed");
    expect(screen.getByTestId("message").textContent).toBe(
      "Binder Error: nope",
    );
  });

  it("runs the page and the count, and drops the blob column from the grid", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 42 }] }
        : { ok: true, columns: [], rows: [{ id: "B1" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("cols").textContent).toBe(
      "id,feature_id,object_type",
    );
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" LIMIT 100 OFFSET 0',
    );
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS "n" FROM "layer_1"',
    );
    expect(screen.getByTestId("rows").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("42");
    expect(screen.getByTestId("unfiltered").textContent).toBe("42");
  });

  it("re-queries with the applied filter, and counts filtered vs unfiltered", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 7 : 42 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );

    act(() => {
      useQueryStore.getState().setFilter("L", {
        logic: "AND",
        conditions: [
          { id: "c", column: "object_type", op: "=", value: "Building" },
        ],
      });
      useQueryStore.getState().applyFilter("L");
    });

    await waitFor(() =>
      expect(screen.getByTestId("total").textContent).toBe("7"),
    );
    expect(screen.getByTestId("unfiltered").textContent).toBe("42");
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "object_type" = \'Building\' LIMIT 100 OFFSET 0',
    );
  });

  it("reports a compile refusal WITHOUT sending a query", async () => {
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    runQuery.mockClear();

    act(() => {
      useQueryStore.getState().setFilter("L", {
        logic: "AND",
        conditions: [{ id: "c", column: "gone", op: "=", value: "x" }],
      });
      useQueryStore.getState().applyFilter("L");
    });

    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toBe(
        'This layer has no column called "gone".',
      ),
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("reports DuckDB's own message when the page query fails", async () => {
    runQuery.mockResolvedValue({ ok: false, message: "Conversion Error: bad" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toBe(
        "Conversion Error: bad",
      ),
    );
  });

  it("pages with the store's page and page size", async () => {
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    runQuery.mockClear();

    act(() => {
      useQueryStore.getState().setPageSize("L", 500);
      useQueryStore.getState().setPage("L", 2);
    });

    await waitFor(() =>
      expect(runQuery).toHaveBeenCalledWith(
        'SELECT "id", "feature_id", "object_type" FROM "layer_1" LIMIT 500 OFFSET 1000',
      ),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/table/useLayerQuery.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/table/useLayerQuery.ts`**

```ts
/**
 * One page of one layer's DuckDB table, kept in step with `queryStore`.
 *
 * The generation counter is the whole reason this is a hook and not three
 * effects: a filter change, a sort click and a page step can be in flight at
 * once, and DuckDB answers in whatever order it finishes. Without the counter
 * a slow first page overwrites a fast second one and the grid shows a page the
 * footer says it is not on.
 *
 * The filter is compiled BEFORE anything is sent, so a condition naming a
 * column the table does not have is a sentence in the bar rather than a bind
 * error in the console.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { runQuery } from "../../analytics/duckdb";
import type { ColumnInfo } from "../../analytics/columnKind";
import {
  useLayerTableStore,
  type LayerTable,
} from "../../analytics/layerTables";
import {
  buildCountSql,
  buildPageSql,
  compileFilter,
  gridColumns,
} from "../../analytics/sql";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";

export interface LayerQueryView {
  /** `"no-layer"` means NOTHING is selected. A selected layer whose registry
   *  entry has not been written yet is `"queued"`, never `"no-layer"`. */
  readonly status: "no-layer" | "queued" | "building" | "failed" | "ready";
  readonly message: string | null;
  readonly table: LayerTable | null;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly totalRows: number;
  readonly unfilteredRows: number;
  readonly loading: boolean;
  readonly reload: () => void;
}

const NO_ROWS: ReadonlyArray<Record<string, unknown>> = [];
const NO_COLUMNS: ReadonlyArray<ColumnInfo> = [];

function countOf(rows: ReadonlyArray<Record<string, unknown>>): number {
  const n = rows[0]?.n;
  return typeof n === "number" ? n : Number(n) || 0;
}

export function useLayerQuery(layerId: string | null): LayerQueryView {
  const tableState = useLayerTableStore((s) =>
    layerId === null ? undefined : s.tables[layerId],
  );
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );

  const [rows, setRows] =
    useState<ReadonlyArray<Record<string, unknown>>>(NO_ROWS);
  const [totalRows, setTotalRows] = useState(0);
  const [unfilteredRows, setUnfilteredRows] = useState(0);
  const [queryMessage, setQueryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const table = tableState?.state === "ready" ? tableState.info : null;
  const applied = query?.applied ?? null;
  const sort = query?.sort ?? null;
  const page = query?.page ?? 0;
  const pageSize = query?.pageSize ?? 100;

  useEffect(() => {
    if (table === null) {
      setRows(NO_ROWS);
      setTotalRows(0);
      setUnfilteredRows(0);
      setQueryMessage(null);
      return;
    }

    // Bumped FIRST, before any early return: a page query from the previous
    // effect run may still be in flight, and if this run bails on a compile
    // refusal without invalidating it, that older answer lands afterwards and
    // replaces the rows with a page the refused filter never asked for.
    const gen = ++generation.current;

    const compiled =
      applied === null
        ? ({ ok: true, where: null } as const)
        : compileFilter(applied, table.columns);
    if (!compiled.ok) {
      // Refused before anything was sent: nothing to cancel, and the grid
      // keeps the page it is already showing rather than blanking.
      setQueryMessage(compiled.message);
      setLoading(false);
      return;
    }

    setLoading(true);
    setQueryMessage(null);

    void (async () => {
      const columns = gridColumns(table.columns);
      const [pageResult, filteredCount, totalCount] = await Promise.all([
        runQuery(
          buildPageSql(
            table.table,
            columns,
            compiled.where,
            sort,
            page,
            pageSize,
          ),
        ),
        runQuery(buildCountSql(table.table, compiled.where)),
        compiled.where === null
          ? Promise.resolve(null)
          : runQuery(buildCountSql(table.table, null)),
      ]);
      if (gen !== generation.current) return;

      if (!pageResult.ok) {
        setQueryMessage(pageResult.message);
        setRows(NO_ROWS);
        setLoading(false);
        return;
      }
      setRows(pageResult.rows);
      const filtered = filteredCount.ok ? countOf(filteredCount.rows) : 0;
      setTotalRows(filtered);
      setUnfilteredRows(
        totalCount === null
          ? filtered
          : totalCount.ok
            ? countOf(totalCount.rows)
            : filtered,
      );
      setLoading(false);
    })();
  }, [table, applied, sort, page, pageSize, reloadToken]);

  if (layerId === null) {
    return {
      status: "no-layer",
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState === undefined) {
    // A layer IS selected; its registry entry has simply not been written yet.
    // `addCityLayer` adds the layer and enqueues the table in that order, so
    // there is a commit in between where the registry has nothing — and
    // "Select a layer to browse its table" over a layer the user just dropped
    // is a lie that flashes on every single add.
    return {
      status: "queued",
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState.state === "failed") {
    return {
      status: "failed",
      message: tableState.message,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  if (tableState.state !== "ready") {
    return {
      status: tableState.state,
      message: null,
      table: null,
      columns: NO_COLUMNS,
      rows: NO_ROWS,
      totalRows: 0,
      unfilteredRows: 0,
      loading: false,
      reload,
    };
  }
  return {
    status: "ready",
    message: queryMessage,
    table: tableState.info,
    columns: gridColumns(tableState.info.columns),
    rows,
    totalRows,
    unfilteredRows,
    loading,
    reload,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/ui/table/useLayerQuery.test.tsx`
Expected: PASS — every status, paging, filter and failure case green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/table/useLayerQuery.ts tests/unit/ui/table/useLayerQuery.test.tsx
git commit -m "$(cat <<'EOF'
feat(table): useLayerQuery — one page of one layer's table

A generation counter is why this is a hook and not three effects: a filter
change, a sort click and a page step can be in flight at once and DuckDB
answers in whatever order it finishes, so without it a slow first page
overwrites a fast second one. The filter is compiled before anything is sent,
so an unknown column is a sentence in the bar rather than a bind error.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 21: `FilterBar`

**Files:**

- Create: `src/ui/table/FilterBar.tsx`
- Test: `tests/unit/ui/table/FilterBar.test.tsx`

**Interfaces:**

- Consumes: `FilterGroup`, `FilterCondition`, `FilterOp`, `isNullaryOp` (Task 8); `ColumnInfo`, `isTextColumn` (Task 5).
- Produces:

```ts
export interface FilterBarProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  /** A compile refusal or DuckDB's own message; rendered role="alert". */
  readonly error: string | null;
  readonly disabled: boolean;
}
export function FilterBar(props: FilterBarProps): JSX.Element;
/** The operators a column's kind can take — exported for its test. */
export function operatorsFor(
  column: ColumnInfo | undefined,
): ReadonlyArray<FilterOp>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/table/FilterBar.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilterBar, operatorsFor } from "../../../../src/ui/table/FilterBar";
import type { ColumnInfo } from "../../../../src/analytics/columnKind";
import type { FilterGroup } from "../../../../src/features/query/types";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
];

const EMPTY: FilterGroup = { logic: "AND", conditions: [] };

function setup(over: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  const onChange = vi.fn();
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(
    <FilterBar
      columns={COLUMNS}
      filter={EMPTY}
      onChange={onChange}
      onApply={onApply}
      onClear={onClear}
      error={null}
      disabled={false}
      {...over}
    />,
  );
  return { onChange, onApply, onClear };
}

afterEach(cleanup);

describe("operatorsFor", () => {
  it("offers the LIKE family only for a VARCHAR column", () => {
    expect(operatorsFor(COLUMNS[0])).toContain("contains");
    expect(operatorsFor(COLUMNS[1])).not.toContain("contains");
  });

  it("offers only the null tests for a nested column", () => {
    expect(operatorsFor(COLUMNS[2])).toEqual(["isNull", "isNotNull"]);
  });

  it("offers nothing for no column", () => {
    expect(operatorsFor(undefined)).toEqual([]);
  });
});

describe("FilterBar", () => {
  it("adds a first condition defaulted to the first column", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions).toHaveLength(1);
    expect(next.conditions[0]!.column).toBe("id");
    expect(next.conditions[0]!.op).toBe("=");
  });

  it("renders one row per condition, with its column selected", () => {
    setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "b3_h_dak_max", op: ">", value: 10 }],
      },
    });
    const columnSelect = screen.getByLabelText("Filter column");
    expect((columnSelect as HTMLSelectElement).value).toBe("b3_h_dak_max");
    expect(
      (screen.getByLabelText("Filter operator") as HTMLSelectElement).value,
    ).toBe(">");
    expect(
      (screen.getByLabelText("Filter value") as HTMLInputElement).value,
    ).toBe("10");
  });

  it("hides the value input for a nullary operator", () => {
    setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "parents", op: "isNull", value: "" }],
      },
    });
    expect(screen.queryByLabelText("Filter value")).toBeNull();
  });

  it("resets the operator when a column change makes it illegal", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "contains", value: "NL" }],
      },
    });
    fireEvent.change(screen.getByLabelText("Filter column"), {
      target: { value: "parents" },
    });
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions[0]!.column).toBe("parents");
    expect(next.conditions[0]!.op).toBe("isNull");
  });

  it("removes a condition", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [
          { id: "c1", column: "id", op: "=", value: "a" },
          { id: "c2", column: "id", op: "=", value: "b" },
        ],
      },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove condition" })[0]!,
    );
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions.map((c) => c.id)).toEqual(["c2"]);
  });

  it("toggles the group logic from the BAR, with a single condition present", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "=", value: "a" }],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Match ALL conditions" }),
    );
    expect((onChange.mock.calls[0]![0] as FilterGroup).logic).toBe("OR");
  });

  it("offers no logic toggle when there is nothing to combine", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Match ALL conditions" }),
    ).toBeNull();
  });

  it("leads the second row with the group's logic as TEXT, not a second toggle", () => {
    setup({
      filter: {
        logic: "OR",
        conditions: [
          { id: "c1", column: "id", op: "=", value: "a" },
          { id: "c2", column: "id", op: "=", value: "b" },
        ],
      },
    });
    expect(screen.getByText("Where")).toBeTruthy();
    expect(screen.getByText("OR")).toBeTruthy();
    // ONE toggle for the group, however many rows.
    expect(
      screen.getAllByRole("button", { name: "Match ANY conditions" }),
    ).toHaveLength(1);
  });

  it("applies and clears", () => {
    const { onApply, onClear } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "=", value: "a" }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("cannot apply an empty filter", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows an error as an alert", () => {
    setup({ error: 'This layer has no column called "gone".' });
    expect(screen.getByRole("alert").textContent).toBe(
      'This layer has no column called "gone".',
    );
  });

  it("disables every control while disabled", () => {
    setup({ disabled: true });
    expect(
      (
        screen.getByRole("button", {
          name: "Add condition",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/table/FilterBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/table/FilterBar.tsx`**

```tsx
/**
 * The structured WHERE builder above the grid.
 *
 * A flat list of conditions with ONE logic for the group, and the AND/OR
 * toggle in the BAR rather than between the rows — the group has one logic, so
 * a per-row control would be N buttons that always agree, and the first row
 * could never carry one at all. Nested groups are deliberately out of scope: a
 * two-level builder in a 320 px panel costs more screen and more explaining
 * than the questions this data invites are worth.
 *
 * The operator list is narrowed by the column's KIND, so an impossible
 * predicate cannot be built in the first place — `compileFilter` still refuses
 * one (a restored draft, a rebuilt table with different columns), but the
 * common case is prevented rather than reported.
 */

import { useCallback } from "react";
import { isTextColumn, type ColumnInfo } from "../../analytics/columnKind";
import {
  isNullaryOp,
  type FilterCondition,
  type FilterGroup,
  type FilterOp,
} from "../../features/query/types";

const COMPARISON_OPS: ReadonlyArray<FilterOp> = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
];
const NULL_OPS: ReadonlyArray<FilterOp> = ["isNull", "isNotNull"];
const TEXT_OPS: ReadonlyArray<FilterOp> = [
  "contains",
  "startsWith",
  "endsWith",
];

const OP_LABELS: Readonly<Record<FilterOp, string>> = {
  "=": "=",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  isNull: "is empty",
  isNotNull: "is not empty",
  in: "is one of",
};

/** What a column can be asked. A LIST, STRUCT or BLOB has no ordering and no
 *  equality a user could mean, so only the null tests survive for it. */
export function operatorsFor(
  column: ColumnInfo | undefined,
): ReadonlyArray<FilterOp> {
  if (!column) return [];
  if (column.kind === "nested" || column.kind === "blob") return NULL_OPS;
  return isTextColumn(column)
    ? [...COMPARISON_OPS, ...TEXT_OPS, "in", ...NULL_OPS]
    : [...COMPARISON_OPS, "in", ...NULL_OPS];
}

/** A value the input can show. A list is joined for the "is one of" box. */
function valueText(value: FilterCondition["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? String(value) : String(value ?? "");
}

/**
 * What a text input contributes to the condition.
 *
 * The RAW STRING, for everything but "is one of" — and that is deliberate.
 * Parsing as the user types cannot work: `Number("1.")` is 1, so the decimal
 * point is deleted the instant it is typed and no fractional threshold can
 * ever be entered; `Number("-")` is NaN, so a negative number cannot be
 * started either. The column's type decides what the string MEANS at compile
 * time (`literalFor` in `analytics/sql.ts`), where nothing is being retyped
 * and a bad value can be refused with a sentence.
 *
 * "is one of" is the exception: a list is not something a single string can
 * hold, so the commas are split here.
 */
function parseValue(raw: string, op: FilterOp): FilterCondition["value"] {
  if (op === "in") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return raw;
}

export interface FilterBarProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly error: string | null;
  readonly disabled: boolean;
}

export function FilterBar({
  columns,
  filter,
  onChange,
  onApply,
  onClear,
  error,
  disabled,
}: FilterBarProps) {
  const byName = new Map(columns.map((c) => [c.name, c]));

  const replace = useCallback(
    (conditions: ReadonlyArray<FilterCondition>) =>
      onChange({ ...filter, conditions }),
    [filter, onChange],
  );

  const addCondition = useCallback(() => {
    const first = columns[0];
    if (!first) return;
    const op = operatorsFor(first)[0] ?? "isNull";
    replace([
      ...filter.conditions,
      { id: crypto.randomUUID(), column: first.name, op, value: "" },
    ]);
  }, [columns, filter.conditions, replace]);

  const patch = useCallback(
    (id: string, next: Partial<FilterCondition>) =>
      replace(
        filter.conditions.map((c) => (c.id === id ? { ...c, ...next } : c)),
      ),
    [filter.conditions, replace],
  );

  return (
    <div className="filter-bar">
      <div className="filter-bar-rows">
        {filter.conditions.map((condition, index) => {
          const column = byName.get(condition.column);
          const ops = operatorsFor(column);
          return (
            <div className="filter-row" key={condition.id}>
              {/* The row lead is TEXT: the group has ONE logic, and it is
                  toggled once, in the actions row below. */}
              <span className="filter-lead">
                {index === 0 ? "Where" : filter.logic}
              </span>

              <select
                className="filter-select"
                aria-label="Filter column"
                disabled={disabled}
                value={condition.column}
                onChange={(e) => {
                  const nextColumn = byName.get(e.target.value);
                  const allowed = operatorsFor(nextColumn);
                  patch(condition.id, {
                    column: e.target.value,
                    // A column change can make the current operator illegal
                    // (text -> list); fall back to the first one it allows.
                    op: allowed.includes(condition.op)
                      ? condition.op
                      : (allowed[0] ?? "isNull"),
                  });
                }}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                className="filter-select filter-select-op"
                aria-label="Filter operator"
                disabled={disabled}
                value={condition.op}
                onChange={(e) =>
                  patch(condition.id, { op: e.target.value as FilterOp })
                }
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>

              {!isNullaryOp(condition.op) && (
                <input
                  className="filter-value"
                  aria-label="Filter value"
                  disabled={disabled}
                  value={valueText(condition.value)}
                  placeholder={condition.op === "in" ? "a, b, c" : "value"}
                  onChange={(e) =>
                    patch(condition.id, {
                      value: parseValue(e.target.value, condition.op),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !disabled) onApply();
                  }}
                />
              )}

              <button
                type="button"
                className="filter-remove"
                aria-label="Remove condition"
                title="Remove this condition"
                disabled={disabled}
                onClick={() =>
                  replace(
                    filter.conditions.filter((c) => c.id !== condition.id),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="filter-bar-actions">
        <button
          type="button"
          className="tb-btn table-action-btn"
          disabled={disabled || columns.length === 0}
          onClick={addCondition}
        >
          Add condition
        </button>
        {filter.conditions.length >= 1 && (
          <button
            type="button"
            className="tb-btn table-action-btn filter-logic-btn"
            disabled={disabled}
            aria-label={`Match ${filter.logic === "AND" ? "ALL" : "ANY"} conditions`}
            title="Switch between matching all and any conditions"
            onClick={() =>
              onChange({
                ...filter,
                logic: filter.logic === "AND" ? "OR" : "AND",
              })
            }
          >
            {filter.logic === "AND" ? "Match all" : "Match any"}
          </button>
        )}
        <button
          type="button"
          className="tb-btn table-action-btn filter-apply"
          disabled={disabled || filter.conditions.length === 0}
          onClick={onApply}
        >
          Apply
        </button>
        <button
          type="button"
          className="tb-btn table-action-btn"
          disabled={disabled}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {error !== null && (
        <div className="filter-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/ui/table/FilterBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/table/FilterBar.tsx tests/unit/ui/table/FilterBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(table): structured filter bar

The operator list is narrowed by the column's kind, so an impossible predicate
cannot be built in the first place — a LIST or a STRUCT offers only the null
tests. compileFilter still refuses one (a draft that outlived a table rebuild),
but the common case is prevented rather than reported.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 22: `DataGrid` and `Pagination`

**Files:**

- Create: `src/ui/table/DataGrid.tsx`
- Create: `src/ui/table/Pagination.tsx`
- Test: `tests/unit/ui/table/DataGrid.test.tsx`
- Test: `tests/unit/ui/table/Pagination.test.tsx`

**Interfaces:**

- Consumes: `ColumnInfo` (Task 5); `PageSize`, `PAGE_SIZES` (Task 8).
- Produces:

```ts
// DataGrid.tsx
export interface DataGridProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSort: (column: string) => void;
  readonly onRowClick: (rowId: string, shiftKey: boolean) => void;
  /** What the grid says with no rows. Defaults to "No rows match this
   *  filter."; the panel overrides it when the map is being filtered too. */
  readonly emptyMessage?: string;
}
/** `React.memo`-wrapped: the panel re-renders far more often than the rows
 *  change, and this is up to 1000 rows of DOM. */
export const DataGrid: React.MemoExoticComponent<
  (props: DataGridProps) => JSX.Element
>;
/** A cell as display text; exported for its test. */
export function formatCell(value: unknown): string;
/** The UNROUNDED value, for the cell's `title`; exported for its test. */
export function rawCellTitle(value: unknown): string;

// Pagination.tsx
/** Row counts in a PINNED locale — `TablePanel` imports this one too, so a
 *  de_DE host cannot render "2.231" where a test expects "2,231". */
export function formatCount(n: number): string;
export interface PaginationProps {
  readonly page: number;
  readonly pageSize: PageSize;
  readonly totalRows: number;
  readonly unfilteredRows: number;
  readonly filtered: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (pageSize: PageSize) => void;
}
export function Pagination(props: PaginationProps): JSX.Element;
/** "1–100 of 2,231"; exported for its test. */
export function rangeLabel(
  page: number,
  pageSize: number,
  totalRows: number,
): string;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ui/table/DataGrid.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataGrid, formatCell } from "../../../../src/ui/table/DataGrid";
import type { ColumnInfo } from "../../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

const ROWS = [
  { id: "B1", object_type: "Building", b3_h_dak_max: 12.3456 },
  { id: "B2", object_type: "BuildingPart", b3_h_dak_max: null },
];

afterEach(cleanup);

describe("formatCell", () => {
  it("renders an em dash for null and undefined", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(undefined)).toBe("—");
  });

  it("rounds a fractional number and leaves an integer alone", () => {
    expect(formatCell(12.3456)).toBe("12.35");
    expect(formatCell(7)).toBe("7");
  });

  it("passes a string through and stringifies anything else", () => {
    expect(formatCell("Building")).toBe("Building");
    expect(formatCell(true)).toBe("true");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });

  it("leaves a NUMERIC STRING alone — HUGEINT and DECIMAL arrive as strings", () => {
    // `toFixed` on a string throws, and rounding a 38-digit DECIMAL to two
    // places would be a lie about the value DuckDB actually holds.
    expect(formatCell("170141183460469231731687303715884105727")).toBe(
      "170141183460469231731687303715884105727",
    );
    expect(formatCell("12.3456")).toBe("12.3456");
  });
});

describe("DataGrid", () => {
  function setup(over: Partial<Parameters<typeof DataGrid>[0]> = {}) {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        sort={null}
        selectedIds={new Set()}
        onSort={onSort}
        onRowClick={onRowClick}
        {...over}
      />,
    );
    return { onSort, onRowClick };
  }

  it("renders one header per column and one row per record", () => {
    setup();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("B1")).toBeTruthy();
    expect(screen.getByText("BuildingPart")).toBeTruthy();
  });

  it("shows an em dash for a null cell", () => {
    setup();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("rounds the cell TEXT but keeps the raw value on hover", () => {
    setup();
    const cell = screen.getByText("12.35");
    // The tooltip exists to reveal what the rounding hid; repeating the
    // rounded number in it makes the hover pointless.
    expect(cell.getAttribute("title")).toBe("12.3456");
  });

  it("reports a header click as a sort request", () => {
    const { onSort } = setup();
    fireEvent.click(screen.getByText("object_type"));
    expect(onSort).toHaveBeenCalledWith("object_type");
  });

  it("marks the sorted column with aria-sort", () => {
    setup({ sort: { column: "id", dir: "desc" } });
    const header = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.startsWith("id"))!;
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("does not offer sorting on a nested column", () => {
    const { onSort } = setup({
      columns: [{ name: "parents", type: "VARCHAR[]", kind: "nested" }],
      rows: [{ parents: '["B1"]' }],
    });
    fireEvent.click(screen.getByText("parents"));
    expect(onSort).not.toHaveBeenCalled();
  });

  it("reports a row click with its id and the shift key", () => {
    const { onRowClick } = setup();
    fireEvent.click(screen.getByText("B2"), { shiftKey: true });
    expect(onRowClick).toHaveBeenCalledWith("B2", true);
  });

  it("marks a selected row", () => {
    setup({ selectedIds: new Set(["B1"]) });
    const selected = document.querySelectorAll(".data-row-selected");
    expect(selected).toHaveLength(1);
  });

  it("says so when there are no rows", () => {
    setup({ rows: [] });
    expect(screen.getByText("No rows match this filter.")).toBeTruthy();
  });

  it("uses the caller's empty message when it supplies one", () => {
    setup({ rows: [], emptyMessage: "0 of 2,231 rows match" });
    expect(screen.getByText("0 of 2,231 rows match")).toBeTruthy();
  });
});
```

Create `tests/unit/ui/table/Pagination.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pagination, rangeLabel } from "../../../../src/ui/table/Pagination";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Pagination>[0]> = {}) {
  const onPage = vi.fn();
  const onPageSize = vi.fn();
  render(
    <Pagination
      page={0}
      pageSize={100}
      totalRows={2231}
      unfilteredRows={2231}
      filtered={false}
      onPage={onPage}
      onPageSize={onPageSize}
      {...over}
    />,
  );
  return { onPage, onPageSize };
}

describe("rangeLabel", () => {
  it("counts from one and stops at the total", () => {
    expect(rangeLabel(0, 100, 2231)).toBe("1–100 of 2,231");
    expect(rangeLabel(22, 100, 2231)).toBe("2,201–2,231 of 2,231");
  });

  it("says so for an empty result", () => {
    expect(rangeLabel(0, 100, 0)).toBe("0 rows");
  });
});

describe("Pagination", () => {
  it("shows the range", () => {
    setup();
    expect(screen.getByText("1–100 of 2,231")).toBeTruthy();
  });

  it("names the unfiltered total when a filter is applied", () => {
    setup({ totalRows: 12, filtered: true, unfilteredRows: 2231 });
    expect(screen.getByText("filtered from 2,231")).toBeTruthy();
  });

  it("disables Previous on the first page and Next on the last", () => {
    setup();
    expect(
      (
        screen.getByRole("button", {
          name: "Previous page",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    cleanup();
    setup({ page: 22 });
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("steps a page", () => {
    const { onPage } = setup({ page: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenNthCalledWith(1, 4);
    expect(onPage).toHaveBeenNthCalledWith(2, 2);
  });

  it("offers 100 / 500 / 1000 and reports the choice as a number", () => {
    const { onPageSize } = setup();
    const select = screen.getByLabelText("Rows per page") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "100",
      "500",
      "1000",
    ]);
    fireEvent.change(select, { target: { value: "1000" } });
    expect(onPageSize).toHaveBeenCalledWith(1000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/ui/table/DataGrid.test.tsx tests/unit/ui/table/Pagination.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/ui/table/DataGrid.tsx`**

```tsx
/**
 * The rows themselves: a sticky-header table over ONE page of results.
 *
 * No virtualisation and no infinite scroll — the page IS the window, capped at
 * 1000 rows, which a browser lays out without help. (The old
 * `IntersectionObserver` sentinel is gone with the in-memory paths it fed.)
 */

import { memo } from "react";
import type { ColumnInfo } from "../../analytics/columnKind";

/**
 * A cell as text.
 *
 * `String(unknown)` is not good enough: a value out of DuckDB or a CityJSON
 * file can be a plain object, which `String` renders as the useless
 * "[object Object]" — every distinct object displaying identically. Every
 * branch narrows first, so `String` only ever sees a primitive.
 *
 * The `typeof value === "number"` guard on the rounding branch is load-bearing:
 * HUGEINT and DECIMAL cells arrive through Arrow as STRINGS (and `castText`
 * columns arrive as `::VARCHAR` text by construction), so an unguarded
 * `toFixed` would throw on them — and rounding a 38-digit DECIMAL to two
 * places would misreport the value DuckDB actually holds.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/** The unrounded value, for the cell's `title`. Null renders as the same em
 *  dash the text does — there is nothing more to reveal about a null. */
export function rawCellTitle(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  return String(value);
}

/** The id a row is selected by. Every layer table has an `id` column, but a
 *  hand-built one may not, so the index is the fallback. */
function rowIdOf(row: Record<string, unknown>, index: number): string {
  const id = row.id;
  return typeof id === "string" ? id : formatCell(id ?? index);
}

/** Only a column with an ORDER can be sorted on — the same rule
 *  `buildPageSql` applies, so a header that looks clickable really is. */
function sortable(column: ColumnInfo): boolean {
  return column.kind === "scalar" || column.kind === "castText";
}

export interface DataGridProps {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly sort: {
    readonly column: string;
    readonly dir: "asc" | "desc";
  } | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSort: (column: string) => void;
  readonly onRowClick: (rowId: string, shiftKey: boolean) => void;
  readonly emptyMessage?: string;
}

/**
 * MEMOISED, and its props are memoised at the call site to match.
 *
 * The panel above re-renders on every hover, every camera settle and every
 * store touch; this component's output is up to 1000 rows x N columns of DOM,
 * and none of it changes on any of those. `React.memo` turns those into a
 * props comparison — provided nobody hands it a freshly built `Set` or array
 * each time, which is why `TablePanel` memoises `selectedIds`.
 */
export const DataGrid = memo(function DataGrid({
  columns,
  rows,
  sort,
  selectedIds,
  onSort,
  onRowClick,
  emptyMessage = "No rows match this filter.",
}: DataGridProps) {
  if (rows.length === 0) {
    return <div className="table-empty">{emptyMessage}</div>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => {
            const canSort = sortable(col);
            const sorted = sort?.column === col.name;
            return (
              <th
                key={col.name}
                className={`data-th ${sorted ? "sorted" : ""} ${canSort ? "" : "data-th-static"}`}
                title={`${col.name} (${col.type})`}
                onClick={canSort ? () => onSort(col.name) : undefined}
                aria-sort={
                  sorted
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <span>{col.name}</span>
                {sorted && (
                  <span className="sort-indicator">
                    {sort.dir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const rowId = rowIdOf(row, i);
          const isSelected = selectedIds.has(rowId);
          return (
            <tr
              key={`${rowId}:${i}`}
              className={`data-row ${isSelected ? "data-row-selected" : ""}`}
              onClick={(e) => onRowClick(rowId, e.shiftKey)}
            >
              {columns.map((col) => {
                const value = row[col.name];
                return (
                  <td
                    key={col.name}
                    className="data-td"
                    // The RAW value on hover: the cell TEXT rounds a float to
                    // two places, and a tooltip that repeats the rounding is a
                    // tooltip that hides the number the user hovered to see.
                    title={rawCellTitle(value)}
                  >
                    {formatCell(value)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});
```

- [ ] **Step 4: Write `src/ui/table/Pagination.tsx`**

```tsx
/**
 * The footer: which rows are on screen, how many there are, and the two steps.
 *
 * "filtered from N" is shown alongside the filtered count because the two
 * numbers answer different questions — how much matched, and how much there
 * is — and a single number that silently changes meaning when a filter is
 * applied is how a user comes to believe a filter deleted their data.
 */

import { PAGE_SIZES, type PageSize } from "../../features/query/types";

/**
 * Row counts, grouped, in ONE locale.
 *
 * Explicitly `en-US`, not the host's: a bare `toLocaleString()` renders 2231 as
 * "2.231" on a de_DE machine and "2 231" on fr_FR, so every test asserting
 * "2,231" would fail on a developer's laptop and pass in CI, or the reverse.
 * The app has no localisation for this to be consistent with, so the formatter
 * is pinned and SHARED — `TablePanel` imports this one rather than growing a
 * second.
 */
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/** "1–100 of 2,231". Counts from ONE: nobody reads a row range zero-based. */
export function rangeLabel(
  page: number,
  pageSize: number,
  totalRows: number,
): string {
  if (totalRows === 0) return "0 rows";
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalRows);
  return `${formatCount(first)}–${formatCount(last)} of ${formatCount(totalRows)}`;
}

export interface PaginationProps {
  readonly page: number;
  readonly pageSize: PageSize;
  readonly totalRows: number;
  readonly unfilteredRows: number;
  readonly filtered: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (pageSize: PageSize) => void;
}

export function Pagination({
  page,
  pageSize,
  totalRows,
  unfilteredRows,
  filtered,
  onPage,
  onPageSize,
}: PaginationProps) {
  const lastPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);

  return (
    <div className="table-pagination">
      <span className="table-range">
        {rangeLabel(page, pageSize, totalRows)}
      </span>
      {filtered && (
        <span className="table-range-muted">
          filtered from {formatCount(unfilteredRows)}
        </span>
      )}

      <div className="toolbar-spacer" />

      <label className="table-pagesize">
        <span>Rows per page</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="Previous page"
        title="Previous page"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        ‹
      </button>
      <button
        type="button"
        className="tb-btn table-action-btn"
        aria-label="Next page"
        title="Next page"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        ›
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/ui/table/DataGrid.test.tsx tests/unit/ui/table/Pagination.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/table/DataGrid.tsx src/ui/table/Pagination.tsx tests/unit/ui/table/DataGrid.test.tsx tests/unit/ui/table/Pagination.test.tsx
git commit -m "$(cat <<'EOF'
feat(table): paged data grid and footer

The page IS the window now — capped at 1000 rows, which a browser lays out
without help — so the IntersectionObserver sentinel goes with the in-memory
paths that fed it. The footer shows the filtered count AND the unfiltered
total: one number that silently changes meaning when a filter is applied is
how a user comes to believe a filter deleted their data.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 23: The `TablePanel` shell — DuckDB-only, with its states

**Files:**

- Modify: `src/ui/table/TablePanel.tsx` (rewritten)
- Modify: `src/app/App.tsx` (props), `src/app/app.css`
- Replace: `tests/unit/ui/table/TablePanel.test.tsx`

**Interfaces:**

- Consumes: `useLayerQuery` (Task 20), `FilterBar` (Task 21), `DataGrid`/`Pagination` (Task 22), `useQueryStore` (Task 8), `DuckDBStatus` (Task 2).
- Produces:

```ts
export interface TablePanelProps {
  readonly duckdbStatus: DuckDBStatus;
  readonly onRetryDuckDB: () => void;
  readonly onCollapse: () => void;
  readonly onHeightChange: (height: number) => void;
}
export function TablePanel(props: TablePanelProps): JSX.Element;
export const MIN_TABLE_HEIGHT: 120;
export const MAX_TABLE_HEIGHT: 800;
export const DEFAULT_TABLE_HEIGHT: 320;
```

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/ui/table/TablePanel.test.tsx` entirely:

```tsx
/**
 * The panel's STATES. Data itself is `useLayerQuery`'s test; this file is
 * about what the user sees when the engine is down, the table is still
 * building, the build failed, or nothing is selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { TablePanel } = await import("../../../../src/ui/table/TablePanel");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { DuckDBStatus } from "../../../../src/analytics/duckdb";

const READY_STATUS: DuckDBStatus = {
  state: "ready",
  extensions: {
    cityjson: { state: "loaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
  platform: "wasm_eh",
};

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [],
  rowCount: 2,
};

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "delft",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

function panel(status: DuckDBStatus = READY_STATUS) {
  const onRetry = vi.fn();
  render(
    <TablePanel
      duckdbStatus={status}
      onRetryDuckDB={onRetry}
      onCollapse={() => {}}
      onHeightChange={() => {}}
    />,
  );
  return { onRetry };
}

beforeEach(() => {
  runQuery.mockReset();
  runQuery.mockImplementation(async (sql: string) =>
    sql.includes("COUNT(*)")
      ? { ok: true, columns: ["n"], rows: [{ n: 2 }] }
      : {
          ok: true,
          columns: [],
          rows: [
            { id: "B1", object_type: "Building" },
            { id: "B2", object_type: "BuildingPart" },
          ],
        },
  );
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useQueryStore.setState({ queries: {} });
  useSelectionStore.setState({ selections: [] });
});

afterEach(cleanup);

describe("TablePanel states", () => {
  it("offers a Retry when the engine failed to start", () => {
    const { onRetry } = panel({ state: "failed", error: "no wasm" });
    expect(screen.getByText(/no wasm/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says so when no layer is selected", () => {
    panel();
    expect(
      screen.getByText("Select a layer to browse its table."),
    ).toBeTruthy();
  });

  it("does NOT offer a Retry while the engine is still starting", () => {
    // The cold boot is ~3.5 s. "The analytics engine is not running" with a
    // Retry button, for three and a half seconds of every session, is a lie.
    panel({ state: "initializing" });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/is not running/)).toBeNull();
  });

  it("shows a DuckDB page error in the BODY, with the filter bar closed", async () => {
    runQuery.mockResolvedValue({
      ok: false,
      message: "Conversion Error: could not convert",
    });
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    // The bar is collapsed by default, so its inline alert is off screen —
    // without the body copy the grid would simply go stale in silence.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Conversion Error: could not convert");
  });

  it("shows a spinner while the table is building", () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({ tables: { L: { state: "building" } } });
    panel();
    expect(screen.getByText("Building this layer's table…")).toBeTruthy();
  });

  it("shows the build failure and offers no grid", () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    panel();
    expect(screen.getByRole("alert").textContent).toContain(
      "Binder Error: nope",
    );
  });

  it("renders the layer's name and its rows once ready", async () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(await screen.findByText("B1")).toBeTruthy();
    expect(screen.getByText("delft")).toBeTruthy();
    expect(screen.getByText("1–2 of 2")).toBeTruthy();
  });

  it("selects a city object when a row is clicked with Sync selection on", async () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    fireEvent.click(await screen.findByText("B1"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "B1" },
    ]);
  });

  it("explains an EMPTY filtered result while Filter map is on", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 0 : 2231 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap("L", true);
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Nothing" },
      ],
    });
    useQueryStore.getState().applyFilter("L");

    panel();
    expect(
      await screen.findByText(
        "0 of 2,231 rows match; the map shows nothing while Filter map is on",
      ),
    ).toBeTruthy();
  });

  it("says the TABLE is empty when there is no filter at all", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 0 }] }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({
      layers: [layer({ isStreaming: true })],
      activeLayerId: "L",
    });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    // "No rows match this filter" over a table that has no rows — a streaming
    // layer whose first cells have not landed — is simply untrue.
    expect(await screen.findByText("This layer has no rows yet.")).toBeTruthy();
  });

  it("says only 'no rows match' when the map is NOT being filtered", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 0 : 2231 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Nothing" },
      ],
    });
    useQueryStore.getState().applyFilter("L");

    panel();
    expect(await screen.findByText("No rows match this filter.")).toBeTruthy();
  });

  it("disables the Filter map toggle for a streaming layer, and says why", () => {
    useLayerStore.setState({
      layers: [layer({ isStreaming: true })],
      activeLayerId: "L",
    });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    const toggle = screen.getByLabelText("Filter map") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.closest("label")!.title).toBe(
      "Map filtering is not available for streaming layers yet",
    );
  });

  it("tells the registry the panel is open, and shut on unmount", async () => {
    panel();
    await waitFor(() =>
      expect(useLayerTableStore.getState().tablePanelOpen).toBe(true),
    );
    cleanup();
    expect(useLayerTableStore.getState().tablePanelOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/table/TablePanel.test.tsx`
Expected: FAIL — `TablePanel` still takes `duckdbTableLoaded` and renders the old grid.

- [ ] **Step 3: Rewrite `src/ui/table/TablePanel.tsx`**

```tsx
/**
 * The bottom panel: one layer's DuckDB table, filtered, sorted and paged.
 *
 * DuckDB-ONLY. The in-memory fallbacks this file used to carry (a `CityModel`
 * walk, a resident-record walk) are gone with the single global table they
 * shadowed: every layer now has a table of its own, so a fallback would be a
 * second, differently-shaped answer to the same question — with different
 * column names, which is exactly how the old `type` vs `object_type` split
 * happened.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuckDBStatus } from "../../analytics/duckdb";
import { useLayerTableStore } from "../../analytics/layerTables";
import { useLayerStore } from "../../features/layers/layerStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import type { Selection } from "../../domain/selection/types";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
// ONE pinned `en-US` formatter for the whole panel — see Pagination.tsx.
import { formatCount, Pagination } from "./Pagination";
import { useLayerQuery } from "./useLayerQuery";

/** The panel's height limits. Raised from 100–600: a filter bar, a header row
 *  and a footer eat ~110 px before a single record is on screen. */
export const MIN_TABLE_HEIGHT = 120;
export const MAX_TABLE_HEIGHT = 800;
export const DEFAULT_TABLE_HEIGHT = 320;

const STREAMING_FILTER_REASON =
  "Map filtering is not available for streaming layers yet";

/**
 * What the grid says with no rows to show.
 *
 * Three different situations, three different sentences — "No rows match this
 * filter" over a table that HAS no rows is simply wrong, and an empty viewport
 * with no explanation reads as a rendering bug rather than as a filter doing
 * its job:
 *
 *  - no filter applied → the table itself is empty (a streaming layer whose
 *    first cells have not landed);
 *  - a filter applied, map sync off → the ordinary "nothing matched";
 *  - a filter applied, map sync ON → the same, plus why the globe went empty,
 *    with both numbers so "too narrow" is distinguishable from "broken".
 */
function emptyGridMessage(
  filtered: boolean,
  syncToMap: boolean,
  unfilteredRows: number,
): string {
  if (!filtered) return "This layer has no rows yet.";
  if (!syncToMap) return "No rows match this filter.";
  return `0 of ${formatCount(unfilteredRows)} rows match; the map shows nothing while Filter map is on`;
}

export interface TablePanelProps {
  readonly duckdbStatus: DuckDBStatus;
  readonly onRetryDuckDB: () => void;
  readonly onCollapse: () => void;
  readonly onHeightChange: (height: number) => void;
}

export function TablePanel({
  duckdbStatus,
  onRetryDuckDB,
  onCollapse,
  onHeightChange,
}: TablePanelProps) {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const layerId = activeLayer?.id ?? null;

  const view = useLayerQuery(layerId);
  const query = useQueryStore((s) =>
    layerId === null ? null : layerQuery(s, layerId),
  );
  const sceneSelections = useSelectionStore((s) => s.selections);

  const [syncSelection, setSyncSelection] = useState(true);
  const [tableSelection, setTableSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(false);

  // The registry cannot see the UI, and a streaming layer's table is only
  // worth rebuilding while somebody is looking at it.
  useEffect(() => {
    useLayerTableStore.getState().setTablePanelOpen(true);
    return () => useLayerTableStore.getState().setTablePanelOpen(false);
  }, []);

  // MEMOISED: a new Set on every render gives `DataGrid` a new prop identity,
  // which defeats the `React.memo` below — and this component re-renders on
  // every hover, every camera settle and every store touch, while the grid is
  // up to 1000 rows of DOM.
  const selectedIds = useMemo(
    () =>
      syncSelection
        ? new Set(sceneSelections.map((s) => s.objectId))
        : tableSelection,
    [syncSelection, sceneSelections, tableSelection],
  );

  const handleRowClick = useCallback(
    (objectId: string, shiftKey: boolean) => {
      if (!syncSelection) {
        setTableSelection((prev) => {
          const next = new Set(prev);
          if (shiftKey) {
            if (next.has(objectId)) next.delete(objectId);
            else next.add(objectId);
          } else {
            next.clear();
            next.add(objectId);
          }
          return next;
        });
        return;
      }
      if (layerId === null) return;
      const store = useSelectionStore.getState();
      const sel: Selection = { kind: "object", layerId, objectId };
      if (shiftKey) store.toggleSelect(sel);
      else store.select(sel);
    },
    [syncSelection, layerId],
  );

  const handleUnselectAll = useCallback(() => {
    if (syncSelection) useSelectionStore.getState().clear();
    else setTableSelection(new Set());
  }, [syncSelection]);

  const engineDown =
    duckdbStatus.state === "failed" || duckdbStatus.state === "uninitialized";

  return (
    <div className="table-panel">
      <TableResizeHandle onHeightChange={onHeightChange} />

      <div className="table-panel-header">
        <span className="table-panel-title">
          {activeLayer?.name ?? "Objects"}
          {view.status === "ready" && (
            <span className="table-count">
              {" "}
              ({formatCount(view.totalRows)} rows)
            </span>
          )}
        </span>

        <label className="table-sync-label">
          <input
            type="checkbox"
            checked={syncSelection}
            onChange={(e) => setSyncSelection(e.target.checked)}
          />
          <span>Sync selection</span>
        </label>

        <label
          className="table-sync-label"
          title={activeLayer?.isStreaming ? STREAMING_FILTER_REASON : undefined}
        >
          <input
            type="checkbox"
            aria-label="Filter map"
            disabled={
              activeLayer === undefined ||
              activeLayer.isStreaming ||
              view.status !== "ready"
            }
            checked={query?.syncToMap ?? false}
            onChange={(e) => {
              if (layerId !== null) {
                useQueryStore
                  .getState()
                  .setSyncToMap(layerId, e.target.checked);
              }
            }}
          />
          <span>Filter map</span>
        </label>

        <button
          type="button"
          className={`tb-btn table-action-btn ${filterOpen ? "active" : ""}`}
          onClick={() => setFilterOpen((o) => !o)}
          disabled={view.status !== "ready"}
        >
          Filter
        </button>

        <button
          className="tb-btn table-action-btn"
          title="Unselect all"
          onClick={handleUnselectAll}
        >
          Clear selection
        </button>

        <div className="toolbar-spacer" />

        <button
          className="tb-btn table-action-btn"
          title="Collapse table"
          onClick={onCollapse}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>

      {filterOpen &&
        view.status === "ready" &&
        query !== null &&
        layerId !== null && (
          <FilterBar
            columns={view.columns}
            filter={query.filter}
            error={view.message}
            disabled={false}
            onChange={(filter) =>
              useQueryStore.getState().setFilter(layerId, filter)
            }
            onApply={() => useQueryStore.getState().applyFilter(layerId)}
            onClear={() => useQueryStore.getState().clearFilter(layerId)}
          />
        )}

      <div className="table-panel-body">
        {engineDown ? (
          <div className="table-message" role="alert">
            <p>
              The analytics engine is not running
              {duckdbStatus.state === "failed"
                ? `: ${duckdbStatus.error}`
                : "."}
            </p>
            <button
              type="button"
              className="tb-btn table-action-btn"
              onClick={onRetryDuckDB}
            >
              Retry
            </button>
          </div>
        ) : view.status === "no-layer" ? (
          <div className="table-message">
            Select a layer to browse its table.
          </div>
        ) : view.status === "queued" || view.status === "building" ? (
          <div className="table-message">
            <span className="loading-spinner" />
            <span>Building this layer's table…</span>
          </div>
        ) : view.status === "failed" ? (
          <div className="table-message" role="alert">
            This layer's table could not be built: {view.message}
          </div>
        ) : (
          <>
            {/* The FilterBar carries this too — but the bar is COLLAPSED by
                default, so a DuckDB page error or a compile refusal would
                otherwise leave a stale grid with no explanation anywhere on
                screen. */}
            {view.message !== null && !filterOpen && (
              <div className="table-message" role="alert">
                {view.message}
              </div>
            )}
            <DataGrid
              columns={view.columns}
              rows={view.rows}
              sort={query?.sort ?? null}
              selectedIds={selectedIds}
              emptyMessage={emptyGridMessage(
                (query?.applied ?? null) !== null,
                query?.syncToMap ?? false,
                view.unfilteredRows,
              )}
              onSort={(column) => {
                if (layerId !== null) {
                  useQueryStore.getState().toggleSort(layerId, column);
                }
              }}
              onRowClick={handleRowClick}
            />
          </>
        )}
      </div>

      {view.status === "ready" && query !== null && layerId !== null && (
        <Pagination
          page={query.page}
          pageSize={query.pageSize}
          totalRows={view.totalRows}
          unfilteredRows={view.unfilteredRows}
          filtered={query.applied !== null}
          onPage={(page) => useQueryStore.getState().setPage(layerId, page)}
          onPageSize={(size) =>
            useQueryStore.getState().setPageSize(layerId, size)
          }
        />
      )}
    </div>
  );
}

function TableResizeHandle({
  onHeightChange,
}: {
  readonly onHeightChange: (height: number) => void;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const panel = (e.target as HTMLElement).closest(
        ".table-panel",
      ) as HTMLElement | null;
      if (!panel) return;
      const startHeight = panel.getBoundingClientRect().height;

      const onMouseMove = (me: MouseEvent) => {
        const delta = startY - me.clientY;
        onHeightChange(
          Math.max(
            MIN_TABLE_HEIGHT,
            Math.min(startHeight + delta, MAX_TABLE_HEIGHT),
          ),
        );
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onHeightChange],
  );

  return <div className="table-resize-handle" onMouseDown={handleMouseDown} />;
}
```

- [ ] **Step 4: Wire it in `App.tsx`**

Replace the table height default and the render:

```tsx
const [tableHeight, setTableHeight] = useState(DEFAULT_TABLE_HEIGHT);
```

```tsx
{
  tableOpen && (
    <TablePanel
      duckdbStatus={duckdbStatus}
      onRetryDuckDB={handleRetryDuckDB}
      onCollapse={() => setTableOpen(false)}
      onHeightChange={setTableHeight}
    />
  );
}
```

with, beside the other callbacks:

```ts
/**
 * Retry a failed DuckDB init.
 *
 * `retryEngine` awaits `initDuckDB` — which clears its memo on failure, so
 * this really re-runs rather than handing back the rejected-once promise — and
 * then REBUILDS every table that failed only because the engine was not
 * running. A Retry that fixed the status but left every table still reading
 * "The analytics engine is not running" would look like it had done nothing.
 */
const handleRetryDuckDB = useCallback(() => {
  setDuckdbStatus({ state: "initializing" });
  void retryEngine().then(() => setDuckdbStatus(getDuckDBStatus()));
}, []);
```

and import `DEFAULT_TABLE_HEIGHT` alongside `TablePanel`, plus `retryEngine` from `../analytics/layerTables`. Delete the `useLayerTableStore.getState().setTablePanelOpen(tableOpen)` effect added in Task 18 — the panel owns that now, and two writers of one flag is one too many.

- [ ] **Step 5: Add the CSS**

In `src/app/app.css`, inside the `TABLE PANEL` block: delete the `.scroll-sentinel` and `.table-loading` rules (the sentinel is gone) and append:

```css
.table-empty,
.table-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem;
  font-size: 0.7rem;
  color: var(--fg-muted);
  text-align: center;
}

.table-message[role="alert"] {
  color: var(--danger-text, var(--fg));
}

.table-message p {
  margin: 0;
}

/* Filter bar */

.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.filter-bar-rows {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.filter-lead {
  font-size: 0.65rem;
  color: var(--fg-label);
  min-width: 3rem;
  text-align: left;
}

.filter-logic-btn {
  color: var(--accent-text);
}

.filter-select,
.filter-value {
  font-size: 0.65rem;
  font-family: inherit;
  padding: 0.15rem 0.3rem;
  background: var(--bg-toolbar);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.filter-select-op {
  min-width: 6rem;
}

.filter-value {
  min-width: 9rem;
}

.filter-remove {
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0 0.2rem;
}

.filter-bar-actions {
  display: flex;
  gap: 0.35rem;
}

.filter-error {
  font-size: 0.65rem;
  color: var(--danger-text, var(--fg));
}

/* Footer */

.table-pagination {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.65rem;
  color: var(--fg-muted);
  flex-shrink: 0;
}

.table-range-muted {
  color: var(--fg-dim);
}

.table-pagesize {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.table-pagesize select {
  font-size: 0.65rem;
  background: var(--bg-toolbar);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.1rem 0.2rem;
}

.data-th-static {
  cursor: default;
}
```

- [ ] **Step 6: Run the suite and the type check**

```bash
npx vitest run
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/table/TablePanel.tsx src/app/App.tsx src/app/app.css tests/unit/ui/table/TablePanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(table): DuckDB-only table panel with filter, paging and states

The in-memory fallbacks go with the single global table they shadowed: every
layer now has one of its own, so a fallback would be a second,
differently-shaped answer to the same question — which is exactly how the
`type` vs `object_type` split happened. Engine-down, queued, building, failed,
no-layer and zero-rows each get a sentence.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 24: SUBMODULE — `buildCityMeshArrays` takes a visible-id set

**Files (all inside `packages/cityjson-navara-plugins`):**

- Modify: `packages/navara-core/src/geometry/buildCityMeshArrays.ts`
- Test: `packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export function buildCityMeshArrays(
  model: CityModel,
  _layerId: string,
  originOffset?: Vec3,
  selectedLod?: string | null,
  hiddenTypes?: ReadonlySet<string> | null,
  appearance?: AppearanceTheme | null,
  /** POSITION 7, after `appearance`. Only these object ids contribute
   *  triangles; `null` (the default) means every object does. */
  visibleObjectIds?: ReadonlySet<string> | null,
): CityMeshArrays;
```

- [ ] **Step 1: Cut the plugin branch from the parent's current pin**

```bash
git -C packages/cityjson-navara-plugins fetch origin
git -C packages/cityjson-navara-plugins checkout -b duckdb-integration 947c980
```

(`origin/main` is ahead of the pin — a Navara 0.1.1 bump the app is not on — so the branch is cut from `947c980`, the commit the parent's gitlink names, and never from `main`.)

- [ ] **Step 2: Write the failing test**

Append to `packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts`:

```ts
describe("buildCityMeshArrays visible-id filtering", () => {
  const tri = (z: number) =>
    makeSurface("RoofSurface", [
      [0, 0, z],
      [1, 0, z],
      [0, 1, z],
    ]);
  const typed = (id: string, objectType: string, z: number): CityObject => ({
    ...makeObject(id, [tri(z)]),
    objectType,
  });
  // `visibleModel`, not `model`: this file already has a top-level `model`, and
  // shadowing it inside the describe reads as the same fixture when it is not.
  const visibleModel = makeModel({
    b1: typed("b1", "Building", 0),
    b2: typed("b2", "Building", 1),
    tree: typed("tree", "SolitaryVegetationObject", 2),
  });
  const unfiltered = buildCityMeshArrays(visibleModel, "L", [0, 0, 0], null);

  it("passes everything through for a null set", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      null,
      null,
      null,
    );
    expect(arrays.triangleCount).toBe(unfiltered.triangleCount);
    expect([...arrays.positions]).toEqual([...unfiltered.positions]);
  });

  it("emits only the named objects", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      null,
      null,
      new Set(["b2"]),
    );
    expect(arrays.triangleCount).toBe(1);
    expect(arrays.positions[2]).toBe(1); // b2's triangle, at z = 1
  });

  it("hides EVERYTHING for an empty set — distinct from null", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      null,
      null,
      new Set<string>(),
    );
    expect(arrays.triangleCount).toBe(0);
    expect(arrays.objectKeys).toEqual(unfiltered.objectKeys);
  });

  it("keeps the objectKeys slot invariant — a filtered object still takes its index", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      null,
      null,
      new Set(["tree"]),
    );
    expect(arrays.objectKeys).toEqual(unfiltered.objectKeys);
    const treeIdx = unfiltered.objectKeys.indexOf("tree");
    for (const idx of arrays.objectIndices) expect(idx).toBe(treeIdx);
  });

  it("ANDs with hiddenTypes — a visible id that is a hidden type stays hidden", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      new Set(["Building"]),
      null,
      new Set(["b1", "tree"]),
    );
    expect(arrays.triangleCount).toBe(1);
    expect(arrays.positions[2]).toBe(2); // only the tree survives
  });

  it("ignores an id the model does not have", () => {
    const arrays = buildCityMeshArrays(
      visibleModel,
      "L",
      [0, 0, 0],
      null,
      null,
      null,
      new Set(["b1", "ghost"]),
    );
    expect(arrays.triangleCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts
```

Expected: FAIL — the 7th argument is ignored, so the "only the named objects" case still emits 3 triangles.

- [ ] **Step 4: Add the parameter**

In `packages/navara-core/src/geometry/buildCityMeshArrays.ts`, extend the signature (position 7, AFTER `appearance` — the existing five positional call sites in `cityModelMesh.ts`, `fcb.worker.ts` and ~20 tests all pass `appearance` sixth):

```ts
export function buildCityMeshArrays(
  model: CityModel,
  _layerId: string,
  originOffset: Vec3 = [0, 0, 0],
  selectedLod: string | null = null,
  hiddenTypes: ReadonlySet<string> | null = null,
  appearance: AppearanceTheme | null = null,
  visibleObjectIds: ReadonlySet<string> | null = null,
): CityMeshArrays {
```

and add the test inside pass 1, immediately after the `isHidden` line:

```ts
if (isHidden(obj.objectType, hiddenTypes)) continue;
// An ATTRIBUTE filter, ANDed with the type filter above: an object draws
// only if its type is not hidden AND (no id filter is set OR it is named).
// `null` and an EMPTY set are deliberately different — null is "no
// filter", an empty set is "nothing matched", and a filter that matched
// nothing must show nothing rather than everything.
if (visibleObjectIds !== null && !visibleObjectIds.has(id)) continue;
```

Extend the doc comment above the function with a paragraph after the `hiddenTypes` one:

```
 * `visibleObjectIds` is the ATTRIBUTE filter's geometry side: only the named
 * objects contribute triangles, `null` means no filter, and an EMPTY set means
 * nothing matched and nothing is drawn. Like `hiddenTypes`, a filtered object
 * still takes its `objectKeys` slot and its object index — object indices must
 * be identical to an unfiltered build, or every consumer that maps an index
 * back through `objectKeys` shifts by the number of filtered objects before it.
```

- [ ] **Step 5: Run the test and the package's own checks**

```bash
cd packages/cityjson-navara-plugins
pnpm vitest run packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts
pnpm typecheck
```

Expected: PASS and clean.

- [ ] **Step 6: Commit on the plugin branch**

```bash
git -C packages/cityjson-navara-plugins add packages/navara-core/src/geometry/buildCityMeshArrays.ts packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts
git -C packages/cityjson-navara-plugins commit -m "$(cat <<'EOF'
feat(core): buildCityMeshArrays takes a visible-object-id set

The geometry side of an attribute filter, ANDed with the type filter. null and
an EMPTY set are deliberately different: null is "no filter", an empty set is
"nothing matched", and a filter that matched nothing must draw nothing. The
objectKeys slot invariant holds — a filtered object still takes its index, or
every consumer that maps an index back through objectKeys shifts.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 25: SUBMODULE — `CityModelMesh.setVisibleObjectIds`

**Files (all inside `packages/cityjson-navara-plugins`):**

- Modify: `packages/navara-cityjson/src/cityModelMesh.ts`
- Modify: `packages/navara-cityjson/src/types.ts`
- Modify: `packages/navara-cityjson/src/cityModelRegistry.ts`
- Test: `packages/navara-cityjson/tests/cityModelMesh.test.ts`

**Interfaces:**

- Consumes: Task 24's 7th parameter.
- Produces:

```ts
// CityModelMeshOptions (cityModelMesh.ts) — NOT AddCityModelOptions: this
// option is reachable only by constructing a CityModelMesh directly (the app
// always goes through `setVisibleObjectIds` on the handle). Adding an add-time
// option later means threading it through AddCityModelOptions,
// cityModelRegistry's `addCityModel` AND `CityModelMeshDesc.createMesh`.
readonly visibleObjectIds?: ReadonlySet<string> | null;

// CityModelHandle (types.ts)
/** Rebuilds geometry with only these objects; `null` clears the filter. */
setVisibleObjectIds(ids: ReadonlySet<string> | null): void;

// CityModelMesh
setVisibleObjectIds(ids: ReadonlySet<string> | null): void;
```

- [ ] **Step 1: Write the failing test**

Append to `packages/navara-cityjson/tests/cityModelMesh.test.ts`, inside the same `describe` that owns `partOpts` (the hidden-types block):

```ts
it("setVisibleObjectIds rebuilds with only the named objects", () => {
  const m = new CityModelMesh(partOpts);
  expect(m.triangleCount()).toBe(6);
  const before = m.object3d.geometry;

  m.setVisibleObjectIds(new Set(["T1"]));
  expect(m.object3d.geometry).not.toBe(before);
  expect(m.triangleCount()).toBe(2);

  m.setVisibleObjectIds(null);
  expect(m.triangleCount()).toBe(6);
  m.dispose();
});

it("an EMPTY set draws nothing, and is not the same as null", () => {
  const m = new CityModelMesh(partOpts);
  m.setVisibleObjectIds(new Set());
  expect(m.triangleCount()).toBe(0);
  m.setVisibleObjectIds(null);
  expect(m.triangleCount()).toBe(6);
  m.dispose();
});

it("builds filtered from the constructor option", () => {
  const m = new CityModelMesh({
    ...partOpts,
    visibleObjectIds: new Set(["T1"]),
  });
  expect(m.triangleCount()).toBe(2);
  m.dispose();
});

it("drops a no-op setVisibleObjectIds instead of rebuilding the geometry", () => {
  const m = new CityModelMesh({
    ...partOpts,
    visibleObjectIds: new Set(["T1"]),
  });
  const geometry = m.object3d.geometry;
  m.setVisibleObjectIds(new Set(["T1"]));
  expect(m.object3d.geometry).toBe(geometry);
  m.setVisibleObjectIds(null);
  expect(m.object3d.geometry).not.toBe(geometry);
  m.dispose();
});

it("ANDs with hidden types", () => {
  const m = new CityModelMesh(partOpts);
  m.setHiddenTypes(["Building"]);
  m.setVisibleObjectIds(new Set(["B1", "T1"]));
  expect(m.triangleCount()).toBe(2); // only the tree
  m.dispose();
});

it("keeps style and highlight across the rebuild", () => {
  const m = new CityModelMesh(partOpts);
  m.setStyle((_surface, object) =>
    object.objectId === "T1" ? [0, 1, 0] : null,
  );
  m.setVisibleObjectIds(new Set(["T1"]));
  const colors = m.object3d.geometry.getAttribute("color");
  expect(colors.getY(0)).toBeGreaterThan(0.9);
  expect(m.resolveVertex(0)?.objectId).toBe("T1");
  m.dispose();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/tests/cityModelMesh.test.ts
```

Expected: FAIL — `setVisibleObjectIds` is not a function.

- [ ] **Step 3: Add the option, the field and the setter to `cityModelMesh.ts`**

Add to `CityModelMeshOptions`, next to `hiddenTypes`:

```ts
  /**
   * Only these objects contribute geometry; `null`/absent means every one
   * does. An EMPTY set draws nothing — see `setVisibleObjectIds`.
   *
   * NOT on `AddCityModelOptions`, deliberately: the app's filter arrives after
   * the layer exists, so the handle's setter is the only path it needs, and
   * this option is reachable only by constructing a mesh directly (which the
   * tests below do). Promoting it to an ADD-TIME option later means threading
   * it through `AddCityModelOptions`, `cityModelRegistry.addCityModel` and
   * `CityModelMeshDesc.createMesh` as well — the descriptor is what the engine
   * actually calls, and an option the desc drops is silently ignored.
   */
  readonly visibleObjectIds?: ReadonlySet<string> | null;
```

Add the field next to `private hiddenTypes`:

```ts
  private visibleObjectIds: ReadonlySet<string> | null;
```

Initialise it in the constructor, beside `this.hiddenTypes = new Set(options.hiddenTypes ?? []);`:

```ts
this.visibleObjectIds = options.visibleObjectIds ?? null;
```

Pass it as the 7th argument in `buildArrays`:

```ts
const arrays = buildCityMeshArrays(
  this.model,
  this.id,
  this.originOffset,
  this.lod,
  this.hiddenTypes.size > 0 ? this.hiddenTypes : null,
  this.appearance,
  this.visibleObjectIds,
);
```

Add the setter beside `setHiddenTypes`:

```ts
  /**
   * Draw only the named objects — the geometry side of the table panel's
   * attribute filter.
   *
   * A REBUILD, on the same seam `setLod` and `setHiddenTypes` use, and for the
   * same reason: a style evaluator writes RGB into an opaque material, so a
   * "filtered out" object would still occlude what is behind it and still
   * answer a raycast.
   *
   * `null` clears the filter. An EMPTY set is NOT the same thing — it means
   * the filter matched nothing, and nothing is what must be drawn.
   */
  setVisibleObjectIds(ids: ReadonlySet<string> | null): void {
    if (sameVisibleIds(ids, this.visibleObjectIds)) return;
    this.visibleObjectIds = ids;
    this.rebuildGeometry();
  }
```

and the comparison helper beside `sameTypes`:

```ts
/** Set equality that distinguishes `null` (no filter) from an empty set
 *  (a filter that matched nothing) — the two must never compare equal. */
function sameVisibleIds(
  a: ReadonlySet<string> | null,
  b: ReadonlySet<string> | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
```

- [ ] **Step 4: Publish it on the handle**

In `packages/navara-cityjson/src/types.ts`, add to `CityModelHandle` right after `setHiddenTypes`:

```ts
  /** Rebuilds geometry containing only these objects; `null` clears the
   *  filter, an EMPTY set draws nothing. ANDed with {@link setHiddenTypes}. */
  setVisibleObjectIds(ids: ReadonlySet<string> | null): void;
```

In `packages/navara-cityjson/src/cityModelRegistry.ts`, add to the handle literal after `setHiddenTypes`:

```ts
      setVisibleObjectIds: (ids: ReadonlySet<string> | null) =>
        mesh.setVisibleObjectIds(ids),
```

- [ ] **Step 5: Run the plugin tests and checks**

```bash
cd packages/cityjson-navara-plugins
pnpm vitest run
pnpm typecheck
```

Expected: PASS and clean.

- [ ] **Step 6: Commit and push the plugin branch**

```bash
git -C packages/cityjson-navara-plugins add packages/navara-cityjson/src packages/navara-cityjson/tests
git -C packages/cityjson-navara-plugins commit -m "$(cat <<'EOF'
feat(cityjson): CityModelMesh.setVisibleObjectIds

A rebuild on the same seam setLod and setHiddenTypes use: a style evaluator
writes RGB into an opaque material, so a "filtered out" object would still
occlude and still answer a raycast. null clears the filter; an empty set draws
nothing, and the two never compare equal.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
git -C packages/cityjson-navara-plugins push -u origin duckdb-integration
```

---

## Task 26: Parent — `Layer.visibleObjectIds` and the `handleSync` push

**Files:**

- Modify: `src/features/layers/layerStore.ts`
- Modify: `src/scene/handleSync.ts`
- Modify: `packages/cityjson-navara-plugins` (gitlink bump only)
- Modify: `tests/unit/scene/handleSync.test.ts` (its `fakeHandle` factory)
- Modify: `tests/unit/scene/handleSyncAppearance.test.ts` (both handle literals)
- Test: `tests/unit/features/layers/layerStoreVisibleIds.test.ts`
- Test: `tests/unit/scene/handleSyncVisibleIds.test.ts`

**Interfaces:**

- Consumes: Task 25's `CityModelHandle.setVisibleObjectIds`.
- Produces:

```ts
// layerStore.ts
export interface Layer {
  /** Only these objects are DRAWN; null means every one is. Session state —
   *  never in a snapshot. */
  readonly visibleObjectIds: ReadonlySet<string> | null;
  // …
}
export interface LayerStoreActions {
  setVisibleObjectIds: (layerId: string, ids: ReadonlySet<string> | null) => void;
  // …
}

// handleSync.ts — LiveLayer gains:
visibleObjectIds?: ReadonlySet<string> | null;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/features/layers/layerStoreVisibleIds.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function addLayer(): string {
  return useLayerStore.getState().addLayer({
    name: "l",
    model: model(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
  });
}

beforeEach(() => {
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

describe("Layer.visibleObjectIds", () => {
  it("defaults to null — no filter", () => {
    const id = addLayer();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!
        .visibleObjectIds,
    ).toBeNull();
  });

  it("setVisibleObjectIds replaces the set on that layer alone", () => {
    const a = addLayer();
    const b = addLayer();
    const ids = new Set(["B1"]);
    useLayerStore.getState().setVisibleObjectIds(a, ids);
    const layers = useLayerStore.getState().layers;
    expect(layers.find((l) => l.id === a)!.visibleObjectIds).toBe(ids);
    expect(layers.find((l) => l.id === b)!.visibleObjectIds).toBeNull();
  });

  it("keeps an EMPTY set — it means 'nothing matched', not 'no filter'", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set());
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!.visibleObjectIds
        ?.size,
    ).toBe(0);
  });

  it("clears back to null", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    useLayerStore.getState().setVisibleObjectIds(id, null);
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!
        .visibleObjectIds,
    ).toBeNull();
  });

  it("is a NO-OP when the set is already the one being set", () => {
    const id = addLayer();
    const ids = new Set(["B1"]);
    useLayerStore.getState().setVisibleObjectIds(id, ids);
    const state = useLayerStore.getState();

    useLayerStore.getState().setVisibleObjectIds(id, ids);
    // Reference equality of the whole state: a fresh `layers` array would
    // re-render every subscriber and re-run the viewport's sync effect, whose
    // test for this field is set IDENTITY — so a churned identical set would
    // rebuild the mesh's geometry for nothing.
    expect(useLayerStore.getState()).toBe(state);
    expect(useLayerStore.getState().layers).toBe(state.layers);
  });

  it("is a NO-OP for null over null — the common case, on every recompute", () => {
    const id = addLayer();
    const state = useLayerStore.getState();
    useLayerStore.getState().setVisibleObjectIds(id, null);
    expect(useLayerStore.getState()).toBe(state);
  });

  it("still replaces an EQUAL but distinct set — identity is the contract", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    const first = useLayerStore.getState().layers;
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    expect(useLayerStore.getState().layers).not.toBe(first);
  });
});
```

Create `tests/unit/scene/handleSyncVisibleIds.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { syncLayers } from "../../../src/scene/handleSync";
import type { LiveLayer } from "../../../src/scene/handleSync";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { CityModel } from "../../../src/domain/citymodel/types";

function fakeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setHiddenTypes: vi.fn(),
    setVisibleObjectIds: vi.fn(),
    setStyle: vi.fn(),
    setThemeStyle: vi.fn(),
    setAppearance: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: vi.fn(() => 0),
    delete: vi.fn(),
  };
}

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "l",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

describe("syncLayers pushes visibleObjectIds", () => {
  it("pushes a new set once, and not again on an unrelated re-sync", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();
    const ids = new Set(["B1"]);

    syncLayers(registry, [layer({ visibleObjectIds: ids })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(ids);

    handle.setVisibleObjectIds.mockClear();
    syncLayers(registry, [layer({ visibleObjectIds: ids })], live, () => {});
    expect(handle.setVisibleObjectIds).not.toHaveBeenCalled();
  });

  it("pushes a REPLACEMENT set — identity is the change test", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();

    syncLayers(
      registry,
      [layer({ visibleObjectIds: new Set(["B1"]) })],
      live,
      () => {},
    );
    handle.setVisibleObjectIds.mockClear();
    const next = new Set(["B1"]);
    syncLayers(registry, [layer({ visibleObjectIds: next })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(next);
  });

  it("pushes null when the filter is cleared", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();

    syncLayers(
      registry,
      [layer({ visibleObjectIds: new Set(["B1"]) })],
      live,
      () => {},
    );
    handle.setVisibleObjectIds.mockClear();
    syncLayers(registry, [layer({ visibleObjectIds: null })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/features/layers/layerStoreVisibleIds.test.ts tests/unit/scene/handleSyncVisibleIds.test.ts`
Expected: FAIL — `setVisibleObjectIds` is not on the store, and `syncLayers` never calls the handle's.

- [ ] **Step 3: Add the field and the action to `layerStore.ts`**

In `Layer`, after `hiddenTypes`:

```ts
  /**
   * Only these objects are DRAWN, or `null` for all of them — the table
   * panel's "Filter map" toggle, pushed to the plugin by `handleSync`.
   *
   * An EMPTY set is a real, distinct value: it means the filter matched
   * nothing, and nothing is what must be drawn. `null` means there is no
   * filter at all.
   *
   * SESSION state, like the query it comes from: never captured in a snapshot
   * or a share link, and reset to `null` whenever the layer's table is rebuilt.
   */
  readonly visibleObjectIds: ReadonlySet<string> | null;
```

Add `"visibleObjectIds"` to `addLayer`'s `Omit<…>` union, set `visibleObjectIds: null` in the object `addLayer` builds, and add the action:

```ts
  /** Replaces {@link Layer.visibleObjectIds} — never mutates it, because the
   *  sync layer's "did this change?" test is set IDENTITY. */
  setVisibleObjectIds: (
    layerId: string,
    ids: ReadonlySet<string> | null,
  ) => void;
```

```ts
  setVisibleObjectIds: (layerId, ids) =>
    set((state) => {
      // No-op on IDENTITY (null over null, or the same Set again). The map
      // filter recomputes on every Apply, every toggle and every table
      // rebuild, and the common answer is "still null" — without this guard
      // each of those mints a fresh `layers` array, re-renders every
      // subscriber, and re-runs `syncLayers`, whose test for this field is
      // reference identity: a churned identical set rebuilds the mesh's
      // geometry for nothing.
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer === undefined || layer.visibleObjectIds === ids) return state;
      return {
        layers: state.layers.map((l) =>
          l.id === layerId ? { ...l, visibleObjectIds: ids } : l,
        ),
      };
    }),
```

- [ ] **Step 4: Push it in `handleSync.ts`**

Add to `LiveLayer`, after `hiddenTypes`:

```ts
  /** The `visibleObjectIds` set last pushed, by IDENTITY — `layerStore`
   *  replaces it on every apply. `undefined` means "never pushed", which is
   *  why the first pass always pushes: unlike `hiddenTypes`, this is NOT an
   *  `addCityModel` option, so a handle built while a filter is on would
   *  otherwise draw everything. */
  visibleObjectIds?: ReadonlySet<string> | null;
```

and, in `syncLayers`, after the `hiddenTypes` block:

```ts
if (entry.visibleObjectIds !== layer.visibleObjectIds) {
  entry.visibleObjectIds = layer.visibleObjectIds;
  entry.handle.setVisibleObjectIds(layer.visibleObjectIds);
}
```

Do NOT seed `visibleObjectIds` in the add path's `entry` literal — leaving it `undefined` is what makes that first push happen.

- [ ] **Step 4b: Teach the EXISTING fake handles the new method**

That unconditional first push calls `entry.handle.setVisibleObjectIds(...)` on
every static handle, and the fakes in the two existing `handleSync` suites do
not have it — so without this every static-path test in the repo throws
`entry.handle.setVisibleObjectIds is not a function`.

In `tests/unit/scene/handleSync.test.ts`, add one line to `fakeHandle`'s
returned object, beside `setHiddenTypes`:

```ts
    setVisibleObjectIds: vi.fn(),
```

In `tests/unit/scene/handleSyncAppearance.test.ts`, add the same line to BOTH
handle literals (grep the file for `setHiddenTypes: vi.fn(),` — there are two).

Run: `npx vitest run tests/unit/scene`
Expected: PASS — the whole scene suite, not only the new file.

- [ ] **Step 5: Run the tests, both type checks, and bump the gitlink**

```bash
npx vitest run
npx tsc -b --noEmit
git add packages/cityjson-navara-plugins src/features/layers/layerStore.ts src/scene/handleSync.ts tests/unit/features/layers/layerStoreVisibleIds.test.ts tests/unit/scene/handleSyncVisibleIds.test.ts
```

Verify the gitlink really moved to the pushed branch head:

```bash
git diff --cached --submodule=short -- packages/cityjson-navara-plugins
git -C packages/cityjson-navara-plugins rev-parse HEAD
git -C packages/cityjson-navara-plugins rev-parse origin/duckdb-integration
```

Expected: the last two hashes match.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(layers): Layer.visibleObjectIds, pushed to the plugin by handleSync

Session state, never persisted — a saved predicate can name a column a
re-linked file does not have, and the filtering it drives would then be a
mystery. An empty set is a real value: the filter matched nothing. The first
sync always pushes, because unlike hiddenTypes this is not an addCityModel
option, so a handle built while a filter is on would otherwise draw everything.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 27: Wire the filter to the map

**Files:**

- Create: `src/features/query/mapFilterSync.ts`
- Modify: `src/ui/table/TablePanel.tsx` (the effect that drives it)
- Modify: `src/features/layers/layerTableLifecycle.ts` (clear on rebuild)
- Test: `tests/unit/features/query/mapFilterSync.test.ts`

**Interfaces:**

- Consumes: `buildFeatureIdsSql`, `compileFilter` (Tasks 9–10); `runQuery` (Task 2); `getLayerTable` (Task 13); `useLayerStore.setVisibleObjectIds` (Task 26); `layerQuery` (Task 8).
- Produces:

```ts
/** Recompute (or clear) a layer's drawn-object set from its applied filter.
 *  Resolves when the layer store has been written. */
export function syncFilterToMap(layerId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/query/mapFilterSync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { syncFilterToMap } =
  await import("../../../../src/features/query/mapFilterSync");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
import type { CityModel } from "../../../../src/domain/citymodel/types";

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [],
  rowCount: 3,
};

const FILTER = {
  logic: "AND" as const,
  conditions: [
    { id: "c", column: "object_type", op: "=" as const, value: "Building" },
  ],
};

function addLayer(): string {
  return useLayerStore.getState().addLayer({
    name: "l",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
  });
}

function visibleIds(layerId: string): ReadonlySet<string> | null {
  return (
    useLayerStore.getState().layers.find((l) => l.id === layerId)
      ?.visibleObjectIds ?? null
  );
}

beforeEach(() => {
  runQuery.mockReset();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
});

describe("syncFilterToMap", () => {
  it("does NOTHING when sync is off and the layer is already unfiltered", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    const state = useLayerStore.getState();

    await syncFilterToMap(id);
    // The common case, re-run on every Apply, toggle and table rebuild: no
    // query, and no store write that would re-render the viewport.
    expect(useLayerStore.getState()).toBe(state);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("writes null when sync is off", async () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("writes null when sync is on but no filter is applied", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap(id, true);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("queries the feature-expanded ids and writes them", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }, { id: "B1-0" }],
    });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id" FROM "layer_1" WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "object_type" = \'Building\')',
    );
    expect([...visibleIds(id)!]).toEqual(["B1", "B1-0"]);
  });

  it("writes an EMPTY set when nothing matched — hide everything", async () => {
    runQuery.mockResolvedValue({ ok: true, columns: ["id"], rows: [] });
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)!.size).toBe(0);
  });

  it("clears the filter on a query failure rather than leaving a stale set", async () => {
    runQuery.mockResolvedValue({ ok: false, message: "Binder Error: nope" });
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["OLD"]));
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
  });

  it("a SLOW earlier call cannot overwrite a faster later one", async () => {
    const id = addLayer();
    useLayerTableStore.setState({
      tables: { [id]: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    // The FIRST query is held; the second answers at once.
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    runQuery
      .mockImplementationOnce(async () => {
        await held;
        return { ok: true, columns: ["id"], rows: [{ id: "OLD" }] };
      })
      .mockImplementationOnce(async () => ({
        ok: true,
        columns: ["id"],
        rows: [{ id: "NEW" }],
      }));

    const first = syncFilterToMap(id);
    const second = syncFilterToMap(id);
    await second;
    releaseFirst();
    await first;

    // The stale answer is DISCARDED. Without the generation check it would
    // rebuild the mesh from a predicate the user had already replaced.
    expect([...visibleIds(id)!]).toEqual(["NEW"]);
  });

  it("clears when the layer has no table (a rebuild in flight)", async () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["OLD"]));
    useQueryStore.getState().setSyncToMap(id, true);
    useQueryStore.getState().setFilter(id, FILTER);
    useQueryStore.getState().applyFilter(id);

    await syncFilterToMap(id);
    expect(visibleIds(id)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/features/query/mapFilterSync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/query/mapFilterSync.ts`**

```ts
/**
 * The bridge from the table's applied filter to the geometry actually drawn.
 *
 * A separate module rather than a hook, because it is called from three
 * different beats — an Apply, the toggle going on, and a table rebuild — and
 * all three want the same "recompute or clear" decision made once.
 *
 * "Clear" is `null` on every failure path: a stale id set is worse than no
 * filter, because it looks like a filter that is working.
 */

import { runQuery } from "../../analytics/duckdb";
import { getLayerTable } from "../../analytics/layerTables";
import { buildFeatureIdsSql, compileFilter } from "../../analytics/sql";
import { useLayerStore } from "../layers/layerStore";
import { layerQuery, useQueryStore } from "./queryStore";

/**
 * One generation per layer, bumped on every call.
 *
 * The same reason `useLayerQuery` has one — an Apply, a toggle and a table
 * rebuild can all be in flight at once and DuckDB answers in whatever order it
 * finishes — but the stakes are higher here: the LOSER does not merely paint a
 * stale grid, it rebuilds the layer's GEOMETRY from a predicate the user has
 * already replaced. Bumped on the early paths too, so a clear that lands late
 * cannot undo the filter that overtook it.
 */
const generations = new Map<string, number>();

export async function syncFilterToMap(layerId: string): Promise<void> {
  const generation = (generations.get(layerId) ?? 0) + 1;
  generations.set(layerId, generation);
  const isCurrent = () => generations.get(layerId) === generation;

  const clear = () =>
    useLayerStore.getState().setVisibleObjectIds(layerId, null);

  const query = layerQuery(useQueryStore.getState(), layerId);
  if (!query.syncToMap || query.applied === null) {
    // The store's own identity guard already makes `clear()` free, but this is
    // the path taken on EVERY Apply, toggle and table rebuild for every layer
    // that is not being map-filtered — which is nearly all of them — so return
    // before touching the store at all.
    const current = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId);
    if (current === undefined || current.visibleObjectIds === null) return;
    clear();
    return;
  }

  const table = getLayerTable(layerId);
  if (table === null) {
    clear();
    return;
  }

  const compiled = compileFilter(query.applied, table.columns);
  if (!compiled.ok || compiled.where === null) {
    clear();
    return;
  }

  const result = await runQuery(
    buildFeatureIdsSql(table.table, compiled.where),
  );
  // A newer call overtook this one while the query ran. Its answer is the
  // current one; writing ours would rebuild the geometry from a predicate the
  // user has already moved on from.
  if (!isCurrent()) return;
  if (!result.ok) {
    clear();
    return;
  }

  const ids = new Set<string>();
  for (const row of result.rows) {
    if (typeof row.id === "string") ids.add(row.id);
  }
  // Written even when EMPTY — that is "the filter matched nothing", and the
  // mesh draws nothing for it. Only `null` means "no filter".
  useLayerStore.getState().setVisibleObjectIds(layerId, ids);
}
```

- [ ] **Step 4: Drive it from the panel**

In `src/ui/table/TablePanel.tsx`, add beside the other effects:

```ts
// The applied filter, the toggle and the table identity are the three things
// that can change what the map should draw. Re-running on the TABLE object
// (not just its name) is what clears a stale set after a rebuild.
useEffect(() => {
  if (layerId === null) return;
  void syncFilterToMap(layerId);
}, [layerId, query?.applied, query?.syncToMap, view.table]);
```

with `import { syncFilterToMap } from "../../features/query/mapFilterSync";`.

- [ ] **Step 5: Clear the set when a table is rebuilt or dropped**

In `src/features/layers/layerTableLifecycle.ts`, inside the removal loop, before `void dropLayerTable(id)` there is already a `resetQuery`. Add the map-filter reset for a REBUILD too, in the `enqueueLayerTable` call sites for streaming layers — simplest and total: reset in `scheduleRebuild` and in the panel-open loop, immediately before each enqueue:

```ts
useLayerStore.getState().setVisibleObjectIds(layerId, null);
```

(in `scheduleRebuild`, using its `layerId`; in the panel-open loop, using `layer.id`). A rebuilt table's ids are computed afresh by the panel's effect above; leaving the old ones in place would draw a filter from a table that no longer exists.

- [ ] **Step 6: Run the suite and the type check**

```bash
npx vitest run
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/query/mapFilterSync.ts src/ui/table/TablePanel.tsx src/features/layers/layerTableLifecycle.ts tests/unit/features/query/mapFilterSync.test.ts
git commit -m "$(cat <<'EOF'
feat(query): apply the table filter to the 3D map

One "recompute or clear" decision, called from three beats — an Apply, the
toggle going on, and a table rebuild. Every failure path writes null: a stale
id set is worse than no filter, because it looks like a filter that is working.
An empty result writes an EMPTY set, which draws nothing — that is what
"nothing matched" has to look like.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 28: `platform/download.ts` — the one Blob-and-anchor

**Files:**

- Create: `src/platform/download.ts`
- Modify: `src/ui/inspector/RuleBuilderTab.tsx`
- Test: `tests/unit/platform/download.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export function downloadBlob(blob: Blob, fileName: string): void;
export function downloadText(
  text: string,
  fileName: string,
  mimeType?: string,
): void;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/platform/download.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, downloadText } from "../../../src/platform/download";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubObjectUrl() {
  const createObjectURL = vi.fn(() => "blob:fake");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

describe("downloadBlob", () => {
  it("clicks an anchor carrying the blob URL and the file name", () => {
    const { createObjectURL, revokeObjectURL } = stubObjectUrl();
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
    } as unknown as HTMLAnchorElement;
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor as never);

    const blob = new Blob(["x"], { type: "text/plain" });
    downloadBlob(blob, "rules.json");

    expect(create).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.download).toBe("rules.json");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });
});

describe("downloadText", () => {
  it("wraps the text in a blob of the given type", () => {
    const { createObjectURL } = stubObjectUrl();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: vi.fn(),
    } as never);

    downloadText('{"a":1}', "rules.json", "application/json");

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    vi.unstubAllGlobals();
  });

  it("defaults to application/json", () => {
    const { createObjectURL } = stubObjectUrl();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: vi.fn(),
    } as never);

    downloadText("{}", "x.json");
    expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe(
      "application/json",
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/platform/download.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/platform/download.ts`**

```ts
/**
 * Hand the browser a file.
 *
 * Extracted from `RuleBuilderTab`, which was the app's only download until the
 * table panel got an exporter. A second hand-rolled anchor is how two
 * downloads end up disagreeing about revoking the object URL — the leak is
 * invisible until a session has exported a few hundred megabytes.
 *
 * `revokeObjectURL` immediately after `click()` is safe: the click has already
 * handed the URL to the browser's download machinery synchronously.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(
  text: string,
  fileName: string,
  mimeType = "application/json",
): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}
```

- [ ] **Step 4: Use it in `RuleBuilderTab`**

Replace `handleExport`'s body:

```ts
const handleExport = useCallback(() => {
  const currentRules =
    useLayerStore.getState().layers.find((l) => l.id === layerId)?.rules ?? [];
  downloadText(JSON.stringify(currentRules, null, 2), "rules.json");
}, [layerId]);
```

with `import { downloadText } from "../../platform/download";`.

- [ ] **Step 5: Run the tests and the type check**

```bash
npx vitest run tests/unit/platform tests/unit/ui/inspector
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add src/platform/download.ts src/ui/inspector/RuleBuilderTab.tsx tests/unit/platform/download.test.ts
git commit -m "$(cat <<'EOF'
refactor(platform): one Blob-and-anchor download helper

A second hand-rolled anchor is how two downloads end up disagreeing about
revoking the object URL, and that leak is invisible until a session has
exported a few hundred megabytes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 29: `analytics/export.ts` — the attribute formats

**Files:**

- Create: `src/analytics/export.ts`
- Test: `tests/unit/analytics/exportAttributes.test.ts`

**Interfaces:**

- Consumes: `ddl`, `readFile`, `dropBuffer` (Task 2); `buildAttributeExportSql` (Task 11); `ColumnInfo` (Task 5).
- Produces:

```ts
export interface AttributeExportRequest {
  readonly kind: "attributes";
  readonly format: AttributeExportFormat; // "parquet" | "csv" | "json"
  readonly table: string;
  /** In output order, the fixed prefix included. */
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  /** What the browser saves it as. */
  readonly fileName: string;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  /** Advisory notes for the dialog — never a refusal. */
  readonly warnings: ReadonlyArray<string>;
}

/** What a read-back is checked AS. Not the download's format — a CityParquet
 *  package's own files are parquet and json. */
export type ExportContentFormat = "parquet" | "csv" | "json";

export type ReadbackOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

/** Pure. Validates a VFS read-back BY CONTENT, because a MISSING name reads
 *  back as one garbage byte with no error at all. */
export function validateExportBytes(
  name: string,
  format: ExportContentFormat,
  bytes: Uint8Array | null,
): ReadbackOutcome;

/** Test-only: rewinds the VFS-name counter so a suite's expected names
 *  (`export_1.csv`, `exp_1`) are the ones actually produced. */
export function resetExportCounterForTests(): void;

export type ExportRequest = AttributeExportRequest | CityParquetExportRequest;
export function runExport(request: ExportRequest): Promise<ExportResult>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/exportAttributes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];
let ddlFailure: string | null = null;
/** `undefined` = "hand back something the format's validator accepts"; a
 *  Uint8Array or null overrides it for the failure cases. */
let fileBytes: Uint8Array | null | undefined = undefined;

/** What DuckDB really writes, in miniature — enough for the content checks. */
function sampleBytes(name: string): Uint8Array {
  if (name.endsWith(".parquet")) {
    return new TextEncoder().encode("PAR1......PAR1");
  }
  if (name.endsWith(".json")) return new TextEncoder().encode('[{"id":"B1"}]');
  return new TextEncoder().encode("id,object_type\nB1,Building\n");
}

vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async (statement: string) => {
    sql.push(statement);
    return { ok: true as const, columns: [], rows: [] };
  }),
  ddl: vi.fn(async (statement: string) => {
    sql.push(statement);
    return ddlFailure === null
      ? { ok: true as const, columns: [], rows: [] }
      : { ok: false as const, message: ddlFailure };
  }),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async (name: string) => {
    dropped.push(name);
  }),
  readFile: vi.fn(async (name: string) =>
    fileBytes === undefined ? sampleBytes(name) : fileBytes,
  ),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { resetExportCounterForTests, runExport, validateExportBytes } =
  await import("../../../src/analytics/export");
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  ddlFailure = null;
  fileBytes = undefined;
  // The counter is MODULE state: without this every test after the first
  // writes export_2, export_3 … and the exact-name assertions below — the
  // "never reuses a VFS name" one above all — check the wrong numbers.
  resetExportCounterForTests();
});

describe("validateExportBytes", () => {
  it("refuses null and a zero-length read", () => {
    expect(validateExportBytes("a.csv", "csv", null)).toEqual({
      ok: false,
      message: "DuckDB produced no output for a.csv",
    });
    expect(validateExportBytes("a.csv", "csv", new Uint8Array()).ok).toBe(
      false,
    );
  });

  it("refuses the ONE-BYTE missing-file signature for every format", () => {
    // A VFS name that was never created reads back as one garbage byte, with
    // no error anywhere. Length alone catches it before any format check.
    for (const format of ["parquet", "csv", "json"] as const) {
      expect(validateExportBytes("x", format, new Uint8Array([0x2a])).ok).toBe(
        false,
      );
    }
  });

  it("requires PAR1 magic for parquet", () => {
    expect(
      validateExportBytes(
        "a.parquet",
        "parquet",
        new TextEncoder().encode("PAR1xxxx"),
      ).ok,
    ).toBe(true);
    expect(
      validateExportBytes(
        "a.parquet",
        "parquet",
        new TextEncoder().encode("not a parquet file"),
      ),
    ).toEqual({
      ok: false,
      message: "DuckDB produced no output for a.parquet",
    });
  });

  it("requires JSON to parse", () => {
    expect(
      validateExportBytes("a.json", "json", new TextEncoder().encode("[{}]"))
        .ok,
    ).toBe(true);
    expect(
      validateExportBytes("a.json", "json", new TextEncoder().encode("[{")).ok,
    ).toBe(false);
  });

  it("requires CSV to carry a newline-terminated header line", () => {
    expect(
      validateExportBytes(
        "a.csv",
        "csv",
        new TextEncoder().encode("id,type\nB1,Building\n"),
      ).ok,
    ).toBe(true);
    // A header with no newline is a truncated write, not a one-column file.
    expect(
      validateExportBytes("a.csv", "csv", new TextEncoder().encode("id,type"))
        .ok,
    ).toBe(false);
    // A leading newline means the header itself is missing.
    expect(
      validateExportBytes("a.csv", "csv", new TextEncoder().encode("\nB1\n"))
        .ok,
    ).toBe(false);
  });

  it("hands the bytes back unchanged on success", () => {
    const bytes = new TextEncoder().encode("PAR1xxxx");
    expect(validateExportBytes("a.parquet", "parquet", bytes)).toEqual({
      ok: true,
      bytes,
    });
  });
});

describe("attribute export", () => {
  it("COPYs to a fresh VFS name, reads it back, and drops it", async () => {
    const result = await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      where: null,
      fileName: "delft.csv",
    });

    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(
      /^COPY \(SELECT "id", "feature_id", "object_type", "b3_h_dak_max" FROM "layer_1"\) TO 'export_1\.csv' \(FORMAT csv\)$/,
    );
    expect(dropped).toEqual(["export_1.csv"]);
    expect(result.fileName).toBe("delft.csv");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("uses the extension the format names", async () => {
    await runExport({
      kind: "attributes",
      format: "parquet",
      table: "layer_1",
      columns: COLUMNS,
      where: null,
      fileName: "delft.parquet",
    });
    expect(sql[0]).toContain("'export_1.parquet'");
    expect(sql[0]).toContain("(FORMAT parquet)");
  });

  it("carries the feature scope through for a filtered export", async () => {
    await runExport({
      kind: "attributes",
      format: "json",
      table: "layer_1",
      columns: COLUMNS,
      where: `"b3_h_dak_max" > 10`,
      fileName: "delft.json",
    });
    expect(sql[0]).toContain(
      'WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("never reuses a VFS name", async () => {
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      where: null,
      fileName: "a.csv",
    });
    sql.length = 0;
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      where: null,
      fileName: "b.csv",
    });
    expect(sql[0]).toContain("'export_2.csv'");
  });

  it("throws DuckDB's own message and still drops the file", async () => {
    ddlFailure = "IO Error: could not write";
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("IO Error: could not write");
    expect(dropped).toEqual(["export_1.csv"]);
  });

  it("explains an empty write rather than handing back a 0-byte file", async () => {
    fileBytes = new Uint8Array();
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.csv");
    expect(dropped).toEqual(["export_1.csv"]);
  });

  it("refuses the one-garbage-byte read of a file that was never created", async () => {
    // The whole reason the read-back is validated by CONTENT: this case comes
    // back with no error at all, and a 1-byte "CSV" would download happily.
    fileBytes = new Uint8Array([0x2a]);
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.csv");
  });

  it("refuses a parquet read-back without PAR1 magic", async () => {
    fileBytes = new TextEncoder().encode("this is not parquet");
    await expect(
      runExport({
        kind: "attributes",
        format: "parquet",
        table: "layer_1",
        columns: COLUMNS,
        where: null,
        fileName: "a.parquet",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.parquet");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/exportAttributes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/analytics/export.ts` (attribute half)**

```ts
/**
 * Writing a layer, or its filtered subset, back out.
 *
 * Everything goes through DuckDB's own writers and comes back through the VFS
 * as bytes — there is no app-side serialiser here, which is what keeps a CSV
 * of a DATE column formatted the way DuckDB formats it rather than the way JS
 * would.
 *
 * NOT offered, and not to be added without re-probing: the `FORMAT cityjson |
 * cityjsonseq | flatcitybuf` sinks bypass DuckDB's VFS entirely — no file is
 * created at all — while the same extension writes fine through
 * `cityparquet_write`. A format that produces nothing is worse than a format
 * that is absent, so those three are offered only as DISABLED options in the
 * dialog, and every read-back here is validated by CONTENT.
 */

import type { ColumnInfo } from "./columnKind";
import { ddl, dropBuffer, readFile } from "./duckdb";
import { buildAttributeExportSql, type AttributeExportFormat } from "./sql";

export interface AttributeExportRequest {
  readonly kind: "attributes";
  readonly format: AttributeExportFormat;
  readonly table: string;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  readonly fileName: string;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  /** Advisory, never a refusal — a validation finding, a module that wrote no
   *  rows. The dialog shows them beside the download. */
  readonly warnings: ReadonlyArray<string>;
}

const MIME: Readonly<Record<AttributeExportFormat, string>> = {
  parquet: "application/vnd.apache.parquet",
  csv: "text/csv",
  json: "application/json",
};

/** What a read-back is checked AS — not the download's format, since a
 *  CityParquet package's own files are parquet and json. */
export type ExportContentFormat = "parquet" | "csv" | "json";

export type ReadbackOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

const PAR1 = [0x50, 0x41, 0x52, 0x31]; // "PAR1"

/**
 * Is this really the file DuckDB was asked to write?
 *
 * The check is BY CONTENT, and that is not belt-and-braces: a VFS name that
 * was never created reads back as ONE GARBAGE BYTE with NO error — from
 * `copyFileToBuffer` and `read_blob` alike — while a genuinely empty file
 * reads back as zero. So "the writer silently wrote nothing" and "here is your
 * file" are indistinguishable by the call's own result, and only the bytes can
 * tell them apart. A one-byte "CSV" would otherwise download happily.
 *
 * Pure, so the three format rules are unit-tested without an engine.
 */
export function validateExportBytes(
  name: string,
  format: ExportContentFormat,
  bytes: Uint8Array | null,
): ReadbackOutcome {
  const fail: ReadbackOutcome = {
    ok: false,
    message: `DuckDB produced no output for ${name}`,
  };
  // Catches both the empty write and the missing-name signature before any
  // format-specific check has to think about a 1-byte buffer.
  if (bytes === null || bytes.length <= 1) return fail;

  if (format === "parquet") {
    for (let i = 0; i < PAR1.length; i++) {
      if (bytes[i] !== PAR1[i]) return fail;
    }
    return { ok: true, bytes };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail;
  }

  if (format === "json") {
    try {
      JSON.parse(text);
    } catch {
      return fail;
    }
    return { ok: true, bytes };
  }

  // CSV: a header line, terminated. A header with no newline is a truncated
  // write; a leading newline means the header itself never arrived.
  const newline = text.indexOf("\n");
  if (newline <= 0) return fail;
  return { ok: true, bytes };
}

/** VFS names are minted from a counter and never reused: a `dropFile`d name
 *  still resolves, to zero bytes, so a second export under an old name would
 *  hand back an empty file with no error anywhere. */
let exportCounter = 0;

function nextExportName(): string {
  return `export_${++exportCounter}`;
}

/**
 * Rewind the counter. TEST-ONLY.
 *
 * Module state survives between `it` blocks in one file, so without this the
 * second test in a suite writes `export_2.csv` and every exact-name assertion
 * after the first is checking the wrong number — including the one that exists
 * precisely to prove names are NOT reused, which would then be asserting the
 * wrong pair. Exported rather than papered over with a regex: the names are
 * part of the contract, and `export_\d+` would not notice a counter that had
 * stopped incrementing.
 */
export function resetExportCounterForTests(): void {
  exportCounter = 0;
}

async function exportAttributes(
  request: AttributeExportRequest,
): Promise<ExportResult> {
  const outFile = `${nextExportName()}.${request.format}`;
  try {
    const written = await ddl(
      buildAttributeExportSql({
        table: request.table,
        columns: request.columns,
        where: request.where,
        format: request.format,
        outFile,
      }),
    );
    if (!written.ok) throw new Error(written.message);

    const readback = validateExportBytes(
      outFile,
      request.format,
      await readFile(outFile),
    );
    if (!readback.ok) throw new Error(readback.message);

    return {
      blob: new Blob([readback.bytes as BlobPart], {
        type: MIME[request.format],
      }),
      fileName: request.fileName,
      warnings: [],
    };
  } finally {
    await dropBuffer(outFile);
  }
}

export type ExportRequest = AttributeExportRequest;

export async function runExport(request: ExportRequest): Promise<ExportResult> {
  return await exportAttributes(request);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/analytics/exportAttributes.test.ts`
Expected: PASS — `validateExportBytes` and the attribute-export cases.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/export.ts tests/unit/analytics/exportAttributes.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): Parquet/CSV/JSON export through DuckDB's own writers

No app-side serialiser, which is what keeps a CSV of a DATE column formatted
the way DuckDB formats it. A zero-length result is an ERROR rather than a
download: the cityjson/cityjsonseq/flatcitybuf writers produce exactly that in
wasm, silently, and a format that hands back an empty file is worse than one
that is absent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 30: `analytics/export.ts` — the CityParquet package

**Files:**

- Modify: `src/analytics/export.ts`
- Test: `tests/unit/analytics/exportCityParquet.test.ts`

**Interfaces:**

- Consumes: `registerBuffer`, `runQuery`, `ddl`, `readFile`, `dropBuffer` (Task 2); `buildCityParquetSourceSql`, `buildCityParquetModuleSql`, `quoteIdent` (Tasks 9 & 11); `groupTypesByModule` (Task 7); `SourceProvider` (Task 13); `validateExportBytes` (Task 29); `zipSync` from `fflate`.
- Produces:

```ts
export interface CityParquetExportRequest {
  readonly kind: "cityparquet";
  readonly table: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly source: SourceProvider;
  /** The VFS extension the re-registered source takes. */
  readonly sourceExtension: string;
  readonly lod: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
  /** The TOP-LEVEL types the user chose; parts follow their root. */
  readonly rootTypes: ReadonlyArray<string>;
  readonly epsg: number;
  readonly fileName: string;
}
export type ExportRequest = AttributeExportRequest | CityParquetExportRequest;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics/exportCityParquet.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

const sql: string[] = [];
const registered: string[] = [];
const dropped: string[] = [];
const readFiles: string[] = [];
let writeRows: Record<string, unknown>[] = [];
/** What `SELECT "severity", count(*) … FROM cityparquet_validation` answers. */
let validationRows: Record<string, unknown>[] = [];
let validationReadFails = false;
let failOn: string | null = null;
/** Override a single read-back to exercise the validators. */
let badFile: { name: string; bytes: Uint8Array | null } | null = null;

/** What the writer really produces, in miniature. */
function sampleBytes(path: string): Uint8Array {
  return path.endsWith(".parquet")
    ? new TextEncoder().encode("PAR1......PAR1")
    : new TextEncoder().encode('{"type":"Feature","id":"exp"}');
}

vi.mock("../../../src/analytics/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (failOn !== null && statement.includes(failOn)) {
      return { ok: false as const, message: "Binder Error: bad module" };
    }
    if (statement.includes("cityparquet_write")) {
      return { ok: true as const, columns: [], rows: writeRows };
    }
    if (statement.startsWith('SELECT "severity"')) {
      if (validationReadFails) {
        return {
          ok: false as const,
          message:
            "Catalog Error: Table with name cityparquet_validation does not exist!",
        };
      }
      return {
        ok: true as const,
        columns: ["severity", "n"],
        rows: validationRows,
      };
    }
    // The PRAGMA itself returns NO ROWS — it materialises a temp table.
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string) => {
      registered.push(name);
      return true;
    }),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async (name: string) => {
      readFiles.push(name);
      if (badFile !== null && name.endsWith(badFile.name)) return badFile.bytes;
      return sampleBytes(name);
    }),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const { resetExportCounterForTests, runExport } =
  await import("../../../src/analytics/export");

function request(over: Record<string, unknown> = {}) {
  return {
    kind: "cityparquet" as const,
    table: "layer_1",
    reader: "read_cityjson" as const,
    source: async () => new Uint8Array([9, 9]),
    sourceExtension: "city.json",
    lod: "2.2",
    attributes: ["b3_h_dak_max"],
    where: null,
    rootTypes: ["Building"],
    epsg: 7415,
    fileName: "delft.cityparquet.zip",
    ...over,
  };
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  readFiles.length = 0;
  validationRows = [];
  validationReadFails = false;
  failOn = null;
  badFile = null;
  // Module state; the `exp_<n>` names in the regexes below are per-run.
  resetExportCounterForTests();
  writeRows = [
    { file: "building.parquet", action: "written", rows: 765, bytes: 1539498 },
    { file: "metadata.json", action: "written", rows: 0, bytes: 6517 },
  ];
});

describe("CityParquet package export", () => {
  it("runs the whole sequence in order", async () => {
    await runExport(request());

    expect(sql[0]).toMatch(/^CREATE SCHEMA "exp_\d+_src"$/);
    expect(sql[1]).toMatch(/^CREATE SCHEMA "exp_\d+"$/);
    expect(sql[2]).toMatch(/^CREATE TABLE "exp_\d+_src"\."src" AS SELECT/);
    expect(sql[3]).toContain('."building" AS SELECT * FROM "exp_');
    expect(sql[4]).toMatch(/^PRAGMA cityparquet_init\('exp_\d+'\)$/);
    expect(sql[5]).toBe("DROP TABLE IF EXISTS cityparquet_validation");
    expect(sql[6]).toMatch(/^PRAGMA cityparquet_validate\('exp_\d+'\)$/);
    expect(sql[7]).toBe(
      'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1 ORDER BY 1',
    );
    expect(sql[8]).toMatch(
      /^SELECT \* FROM cityparquet_write\('exp_\d+', 'exp_\d+', crs => 'EPSG:7415'\)$/,
    );
  });

  it("re-registers the source under a FRESH name, reads it ONCE, and drops it", async () => {
    await runExport(
      request({ rootTypes: ["Building", "SolitaryVegetationObject"] }),
    );
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatch(/^exp_\d+_src\.city\.json$/);
    // Exactly ONE statement names the reader, however many modules there are:
    // re-reading per module would re-parse the whole file each time.
    expect(sql.filter((s) => s.includes("read_cityjson("))).toHaveLength(1);
    // And the bytes go as soon as the parse is done, not at the end.
    expect(dropped).toContain(registered[0]!);
  });

  it("puts the scratch table in a SEPARATE schema from the module tables", async () => {
    await runExport(request());
    const scratch = sql.find((s) => s.includes('."src" AS SELECT'))!;
    const module = sql.find((s) => s.includes('."building" AS SELECT'))!;
    expect(scratch).toMatch(/CREATE TABLE "exp_\d+_src"\."src"/);
    expect(module).toMatch(/CREATE TABLE "exp_\d+"\."building"/);
    // cityparquet_init describes every table in the schema it is handed, and
    // `src` is not a CityGML module.
    expect(module).not.toContain('"src" AS SELECT');
  });

  it("writes ONE table per CityGML module, cut from the scratch table", async () => {
    await runExport(
      request({ rootTypes: ["Building", "SolitaryVegetationObject"] }),
    );
    const creates = sql.filter(
      (s) => s.startsWith("CREATE TABLE") && !s.includes('."src"'),
    );
    expect(creates).toHaveLength(2);
    expect(creates[0]).toContain('."building" AS SELECT * FROM "exp_');
    expect(creates[1]).toContain('."vegetation" AS SELECT * FROM "exp_');
  });

  it("zips every file the write NAMED, pulled with readFile from the output dir", async () => {
    const result = await runExport(request());
    expect(readFiles).toHaveLength(2);
    expect(readFiles[0]).toMatch(/^exp_\d+\/building\.parquet$/);
    expect(readFiles[1]).toMatch(/^exp_\d+\/metadata\.json$/);

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
    ]);
    expect(result.fileName).toBe("delft.cityparquet.zip");
  });

  it("reports validation findings as a WARNING, never a refusal", async () => {
    validationRows = [
      { severity: "error", n: 2 },
      { severity: "warning", n: 1 },
    ];
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "cityparquet_validate reported 3 findings (2 error, 1 warning). The package was written anyway.",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("says so when the validation could not be RUN, and still writes", async () => {
    failOn = "PRAGMA cityparquet_validate";
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "Validation could not be run: Binder Error: bad module",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("says so when the findings could not be READ — never a silent skip", async () => {
    // The real shape of this failure: a PRAGMA that threw never created the
    // temp table, so the follow-up SELECT raises a Catalog Error (probe P6g).
    validationReadFails = true;
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "Validation could not be read: Catalog Error: Table with name cityparquet_validation does not exist!",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("drops the PREVIOUS run's findings table before validating", async () => {
    // The temp table lives on the CONNECTION, so a second export would
    // otherwise read the first one's findings as its own.
    await runExport(request());
    expect(sql).toContain("DROP TABLE IF EXISTS cityparquet_validation");
  });

  it("drops BOTH schemas, the source and every output — always", async () => {
    await runExport(request());
    expect(
      sql.some((s) => /^DROP SCHEMA IF EXISTS "exp_\d+" CASCADE$/.test(s)),
    ).toBe(true);
    expect(
      sql.some((s) => /^DROP SCHEMA IF EXISTS "exp_\d+_src" CASCADE$/.test(s)),
    ).toBe(true);
    expect(dropped).toContainEqual(
      expect.stringMatching(/^exp_\d+_src\.city\.json$/),
    );
    expect(dropped).toContainEqual(expect.stringMatching(/building\.parquet$/));
    expect(dropped).toContainEqual(expect.stringMatching(/metadata\.json$/));
  });

  it("cleans up after a failure and reports DuckDB's message", async () => {
    failOn = "CREATE TABLE";
    await expect(runExport(request())).rejects.toThrow(
      "Binder Error: bad module",
    );
    expect(
      sql.filter((s) => s.startsWith("DROP SCHEMA IF EXISTS")),
    ).toHaveLength(2);
    expect(dropped).toContainEqual(expect.stringMatching(/_src\.city\.json$/));
  });

  it("refuses when the write named no files", async () => {
    writeRows = [];
    await expect(runExport(request())).rejects.toThrow(
      "The CityParquet writer produced no files.",
    );
  });

  it("refuses a MISSING output — one garbage byte, no error — and cleans up", async () => {
    badFile = { name: "building.parquet", bytes: new Uint8Array([0x2a]) };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for exp_\d+\/building\.parquet/,
    );
    expect(sql.some((s) => s.startsWith("DROP SCHEMA"))).toBe(true);
  });

  it("refuses a parquet output without PAR1 magic", async () => {
    badFile = {
      name: "building.parquet",
      bytes: new TextEncoder().encode("not parquet at all"),
    };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for/,
    );
  });

  it("refuses a metadata.json that does not parse", async () => {
    badFile = {
      name: "metadata.json",
      bytes: new TextEncoder().encode("{ not json"),
    };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for/,
    );
  });

  it("takes the name from the FIRST string column, and strips a repeated dir prefix", async () => {
    // The column is called `file` today, but that is the extension's private
    // spelling; and the writer has been seen to report a path relative to the
    // database rather than a bare name, which would otherwise be read back as
    // `exp_1/exp_1/building.parquet` — the missing-file signature.
    writeRows = [
      { name: "exp_1/building.parquet", action: "written", rows: 1, bytes: 10 },
      { name: "metadata.json", action: "written", rows: 0, bytes: 10 },
    ];
    const result = await runExport(request());
    for (const path of readFiles) {
      expect(path).not.toMatch(/exp_\d+\/exp_\d+\//);
    }
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
    ]);
  });

  it("zips EVERY file the write named — a package missing one is not a package", async () => {
    writeRows = [
      { file: "building.parquet", action: "written", rows: 1, bytes: 10 },
      { file: "vegetation.parquet", action: "written", rows: 1, bytes: 10 },
      { file: "metadata.json", action: "written", rows: 0, bytes: 10 },
    ];
    const result = await runExport(
      request({ rootTypes: ["Building", "PlantCover"] }),
    );
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
      "vegetation.parquet",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/analytics/exportCityParquet.test.ts`
Expected: FAIL — `runExport` rejects an unknown `kind`.

- [ ] **Step 3: Append the CityParquet route to `src/analytics/export.ts`**

EXTEND the file's existing import block (do not add a second import from the
same module — `./duckdb` and `./sql` are already imported by Task 29's half):

```ts
import { zipSync } from "fflate";
import { groupTypesByModule } from "./cityGmlModule";
// existing `./duckdb` import, widened:
import { ddl, dropBuffer, readFile, registerBuffer, runQuery } from "./duckdb";
import type { SourceProvider } from "./layerTables";
// existing `./sql` import, widened:
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
  quoteIdent,
  type AttributeExportFormat,
} from "./sql";
```

and the request type plus the implementation:

```ts
/**
 * The file NAME out of one `cityparquet_write` result row.
 *
 * The FIRST string-valued column, not a column called `file`: the observed
 * shape is `file | action | rows | bytes`, but that column name is the
 * extension's, undocumented, and a rename would silently produce an empty zip
 * rather than an error. The first string in a row of (name, action, count,
 * count) is the name in any spelling of that tuple.
 *
 * A leading `<outDir>/` is stripped: the extension has been seen to report
 * both a bare name and a path relative to the database, and prefixing an
 * already-prefixed name yields `exp_1/exp_1/building.parquet`, which reads
 * back as the missing-file signature.
 */
function writtenFileName(
  row: Record<string, unknown>,
  outDir: string,
): string | null {
  for (const value of Object.values(row)) {
    if (typeof value !== "string" || value === "") continue;
    return value.startsWith(`${outDir}/`)
      ? value.slice(outDir.length + 1)
      : value;
  }
  return null;
}

/** How one of the writer's own output files is checked. Its package holds
 *  parquet object tables and a JSON STAC Item, nothing else. */
function contentFormatOf(fileName: string): ExportContentFormat {
  if (fileName.endsWith(".parquet")) return "parquet";
  if (fileName.endsWith(".csv")) return "csv";
  return "json";
}

export interface CityParquetExportRequest {
  readonly kind: "cityparquet";
  readonly table: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly source: SourceProvider;
  readonly sourceExtension: string;
  readonly lod: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
  readonly rootTypes: ReadonlyArray<string>;
  readonly epsg: number;
  readonly fileName: string;
}

/**
 * Everything `cityparquet_validate` had to say, as a line for the dialog.
 *
 * The pragma RETURNS NO ROWS: it MATERIALISES its findings into a temp table
 * called `cityparquet_validation`, which is then selected from (a PRAGMA cannot
 * be a subquery). Two consequences this function exists to handle:
 *
 *  - if the PRAGMA fails, that table is never created at all, and the follow-up
 *    SELECT fails with `Catalog Error: Table with name cityparquet_validation
 *    does not exist!` — observed in probe P6g on a schema missing `feature_id`;
 *  - the table persists on the connection, so a PREVIOUS export's findings would
 *    be read as this one's. It is dropped first.
 *
 * Nothing here is a refusal — the writer never refuses on a finding, so neither
 * do we — but a validation that could not be RUN or READ is reported, never
 * silently skipped: "no warnings" and "we never looked" must not look alike.
 */
async function validationWarnings(schema: string): Promise<string[]> {
  await ddl("DROP TABLE IF EXISTS cityparquet_validation");

  const validated = await ddl(`PRAGMA cityparquet_validate('${schema}')`);
  if (!validated.ok) {
    return [`Validation could not be run: ${validated.message}`];
  }

  const findings = await runQuery(
    'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1 ORDER BY 1',
  );
  if (!findings.ok) {
    return [`Validation could not be read: ${findings.message}`];
  }

  let total = 0;
  const parts: string[] = [];
  for (const row of findings.rows) {
    const n = Number(row.n ?? 0);
    total += n;
    parts.push(`${n} ${String(row.severity ?? "unknown")}`);
  }
  if (total === 0) return [];
  return [
    `cityparquet_validate reported ${total} findings (${parts.join(", ")}). The package was written anyway.`,
  ];
}

/** Remove one file the WRITER created (as opposed to a buffer we registered).
 *  `dropFile` over a writer-created path is not something the probes covered,
 *  so a failure is reported rather than swallowed — and never allowed to mask
 *  the export's own outcome, which is why it cannot throw. */
async function dropWrittenFile(path: string): Promise<void> {
  try {
    await dropBuffer(path);
  } catch (error) {
    console.warn(`Could not remove the exported file "${path}":`, error);
  }
}

/**
 * A CityParquet package, written by the extension and zipped here.
 *
 * The shape is dictated by what `cityparquet_write` actually accepts (probed
 * end to end): the export schema must hold ORDINARY tables named for CityGML
 * modules, the source has to be read again through the cityjson reader because
 * the browsing table has no geometry, and the write's own RESULT ROWS name the
 * files it produced — so nothing needs `globFiles`, which lists names that were
 * never created and is fit for cleanup only.
 *
 * The source is read exactly ONCE, into a scratch table in a SEPARATE schema:
 * `cityparquet_init` describes every table in the schema it is handed, so the
 * scratch table cannot live beside the module tables, and cutting each module
 * straight from the reader would re-parse the whole file per module.
 */
async function exportCityParquet(
  request: CityParquetExportRequest,
): Promise<ExportResult> {
  const base = nextExportName().replace("export_", "exp_");
  const schema = base;
  const scratchSchema = `${base}_src`;
  const outDir = base;
  const sourceName = `${base}_src.${request.sourceExtension}`;
  const writtenFiles: string[] = [];

  try {
    const modules = groupTypesByModule(request.rootTypes);
    if (modules.length === 0) {
      throw new Error("Choose at least one object type to export.");
    }

    const scratchCreated = await ddl(
      `CREATE SCHEMA ${quoteIdent(scratchSchema)}`,
    );
    if (!scratchCreated.ok) throw new Error(scratchCreated.message);
    const schemaCreated = await ddl(`CREATE SCHEMA ${quoteIdent(schema)}`);
    if (!schemaCreated.ok) throw new Error(schemaCreated.message);

    // A FRESH array from the provider: registering consumes it.
    const bytes = await request.source();
    if (!(await registerBuffer(sourceName, bytes))) {
      throw new Error("The layer's source could not be re-read for export.");
    }

    const sourceRead = await ddl(
      buildCityParquetSourceSql({
        scratchSchema,
        reader: request.reader,
        sourceFile: sourceName,
        table: request.table,
        lod: request.lod,
        attributes: request.attributes,
        where: request.where,
      }),
    );
    if (!sourceRead.ok) throw new Error(sourceRead.message);
    // The parse is done; the bytes are dead weight from here on.
    await dropBuffer(sourceName);

    for (const { module, types } of modules) {
      const created = await ddl(
        buildCityParquetModuleSql({
          schema,
          module,
          scratchSchema,
          table: request.table,
          moduleTypes: types,
        }),
      );
      if (!created.ok) throw new Error(created.message);
    }

    // ITS OWN STATEMENT, never batched with another: `cityparquet_init` is
    // what stamps the schema's `__cityparquet` bookkeeping, and a batched
    // PRAGMA is not reliably applied before the statement beside it runs.
    const initialised = await ddl(`PRAGMA cityparquet_init('${schema}')`);
    if (!initialised.ok) throw new Error(initialised.message);

    const warnings = await validationWarnings(schema);

    const written = await runQuery(
      `SELECT * FROM cityparquet_write('${schema}', '${outDir}', crs => 'EPSG:${request.epsg}')`,
    );
    if (!written.ok) throw new Error(written.message);

    // The write's own rows name the files. `globFiles` works in the browser but
    // lists names that were never created, so it is fit for cleanup and not for
    // discovery. The directory argument carries NO trailing slash: with one,
    // the writer produces a second, duplicated set of paths.
    const entries: Record<string, Uint8Array> = {};
    for (const row of written.rows) {
      const name = writtenFileName(row, outDir);
      if (name === null) continue;
      const path = `${outDir}/${name}`;
      writtenFiles.push(path);
      // EVERY named file must read back and validate: a package missing one of
      // its object tables — or carrying a `metadata.json` that does not parse —
      // is not a package, and the missing-name read gives back one garbage byte
      // with no error to warn us.
      const readback = validateExportBytes(
        path,
        contentFormatOf(name),
        await readFile(path),
      );
      if (!readback.ok) throw new Error(readback.message);
      entries[name] = readback.bytes;
    }
    if (Object.keys(entries).length === 0) {
      throw new Error("The CityParquet writer produced no files.");
    }

    return {
      blob: new Blob([zipSync(entries) as BlobPart], {
        type: "application/zip",
      }),
      fileName: request.fileName,
      warnings,
    };
  } finally {
    // ALWAYS: a half-built schema, a scratch copy of the whole model and a
    // multi-megabyte source buffer must not outlive a failed export.
    await ddl(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await ddl(`DROP SCHEMA IF EXISTS ${quoteIdent(scratchSchema)} CASCADE`);
    await dropBuffer(sourceName);
    for (const path of writtenFiles) await dropWrittenFile(path);
  }
}
```

Replace the union and the dispatcher at the bottom:

```ts
export type ExportRequest = AttributeExportRequest | CityParquetExportRequest;

export async function runExport(request: ExportRequest): Promise<ExportResult> {
  return request.kind === "cityparquet"
    ? await exportCityParquet(request)
    : await exportAttributes(request);
}
```

- [ ] **Step 4: Run both export test files**

Run: `npx vitest run tests/unit/analytics/exportAttributes.test.ts tests/unit/analytics/exportCityParquet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/export.ts tests/unit/analytics/exportCityParquet.test.ts
git commit -m "$(cat <<'EOF'
feat(analytics): CityParquet package export, zipped with fflate

The shape is dictated by what cityparquet_write actually accepts: ordinary
tables named for CityGML modules, and the source read AGAIN through the cityjson
reader (the browsing table has no geometry by design) — but read exactly ONCE,
into a scratch table in a schema of its own, because cutting each module
straight from the reader re-parses the whole file per module and
cityparquet_init describes every table in the schema it is handed.

The write's own result rows name the files (globFiles lists names that were
never created, so it is cleanup only), and every one of them is read back and
validated by content. cityparquet_validate returns NO rows — it materialises a
temp table on the CONNECTION, dropped first so a previous export's findings are
not read as this one's — and a validation that could not be run or read is
REPORTED, because "no warnings" and "we never looked" must not look alike. Both
schemas, the source buffer and every output go in a finally.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 31: `ExportDialog`

**Files:**

- Create: `src/ui/table/ExportDialog.tsx`
- Modify: `src/ui/table/TablePanel.tsx` (the Export button)
- Modify: `src/app/app.css`
- Test: `tests/unit/ui/table/ExportDialog.test.tsx`

**Interfaces:**

- Consumes: `useModalChrome`; `runExport`, `ExportResult` (Tasks 29–30); `downloadBlob` (Task 28); `compileFilter`, `buildRootTypesSql` (Tasks 9–10); `runQuery` (Task 2); `useLayerTableStore`, `LayerTable` (Task 13); `layerQuery` (Task 8); `extractCrsCode`.
- Produces:

```ts
export interface ExportDialogProps {
  readonly layerId: string;
  readonly layerName: string;
  readonly table: LayerTable;
  /** The EPSG code the package is written with, or null when the layer's
   *  reference system names none — the CityParquet format is then refused. */
  readonly epsg: number | null;
  /** The layer's currently selected LoD, the default for the picker. */
  readonly selectedLod: string | null;
  /** A streaming layer's table is only as fresh as its last rebuild, so
   *  opening this dialog forces one. */
  readonly isStreaming: boolean;
  readonly onClose: () => void;
}
export function ExportDialog(props: ExportDialogProps): JSX.Element;
/** The download's file name for a layer and a format; exported for its test. */
export function exportFileName(layerName: string, format: string): string;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/table/ExportDialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const runExport = vi.fn();
vi.mock("../../../../src/analytics/export", () => ({
  runExport: (request: unknown) => runExport(request),
}));

const downloadBlob = vi.fn();
vi.mock("../../../../src/platform/download", () => ({
  downloadBlob: (blob: Blob, name: string) => downloadBlob(blob, name),
  downloadText: vi.fn(),
}));

const refreshStreamingTable = vi.fn(async () => {});
vi.mock(
  "../../../../src/features/layers/layerTableLifecycle",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/features/layers/layerTableLifecycle")
    >()),
    refreshStreamingTable: (layerId: string) => refreshStreamingTable(layerId),
  }),
);

const { ExportDialog, exportFileName } =
  await import("../../../../src/ui/table/ExportDialog");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");

const READER_TABLE = {
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: async () => new Uint8Array([1]),
  reader: "read_cityjson" as const,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    { name: "parents", type: "VARCHAR[]", kind: "nested" as const },
    { name: "children", type: "VARCHAR[]", kind: "nested" as const },
    { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" as const },
  ],
  lods: ["1.2", "2.2"],
  rowCount: 10,
};

const FALLBACK_TABLE = {
  ...READER_TABLE,
  sourceName: null,
  source: null,
  reader: null,
  lods: [],
};

function open(over: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(
    <ExportDialog
      layerId="L"
      layerName="delft"
      table={READER_TABLE}
      epsg={7415}
      selectedLod="2.2"
      isStreaming={false}
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  runQuery.mockReset();
  runQuery.mockResolvedValue({
    ok: true,
    columns: ["value"],
    rows: [{ value: "Building" }, { value: "SolitaryVegetationObject" }],
  });
  runExport.mockReset();
  runExport.mockResolvedValue({
    blob: new Blob(["x"]),
    fileName: "delft.csv",
    warnings: [],
  });
  downloadBlob.mockReset();
  refreshStreamingTable.mockClear();
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
});

afterEach(cleanup);

describe("exportFileName", () => {
  it("names the file after the layer, extension swapped", () => {
    expect(exportFileName("delft.city.json", "csv")).toBe("delft.csv");
    expect(exportFileName("delft", "parquet")).toBe("delft.parquet");
    expect(exportFileName("delft.city.json", "cityparquet.zip")).toBe(
      "delft.cityparquet.zip",
    );
  });
});

describe("ExportDialog", () => {
  it("lists the layer's TOP-LEVEL object types, all selected", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT DISTINCT "object_type" AS "value" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1',
    );
    expect(
      (screen.getByLabelText("Building") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("lists the ATTRIBUTE columns only — never the fixed prefix", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.getByLabelText("b3_h_dak_max")).toBeTruthy();
    expect(screen.queryByLabelText("feature_id")).toBeNull();
    expect(screen.queryByLabelText("object_type")).toBeNull();
  });

  it("offers the layer's LoDs, defaulted to its selected one", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const lod = screen.getByLabelText("Level of detail") as HTMLSelectElement;
    expect([...lod.options].map((o) => o.value)).toEqual(["1.2", "2.2"]);
    expect(lod.value).toBe("2.2");
  });

  it("hides the LoD picker and every geometry format for a fallback table, and says why", async () => {
    open({ table: FALLBACK_TABLE, epsg: 7415 });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByLabelText("Level of detail")).toBeNull();
    expect(screen.getByLabelText("Parquet")).toBeTruthy();
    expect(screen.getByLabelText("CSV")).toBeTruthy();
    expect(screen.getByLabelText("JSON")).toBeTruthy();
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    expect(screen.queryByLabelText("CityJSON")).toBeNull();
    expect(
      screen.getByText(
        "This layer has no CityJSON source in DuckDB; geometry formats need one",
      ),
    ).toBeTruthy();
  });

  it("offers CityJSON, CityJSONSeq and FlatCityBuf DISABLED, with the reason", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    for (const label of ["CityJSON", "CityJSONSeq", "FlatCityBuf"]) {
      const radio = screen.getByLabelText(label) as HTMLInputElement;
      expect(radio.disabled).toBe(true);
      expect(radio.closest("label")!.title).toBe(
        "Not available in the browser build of the cityjson extension (writes an empty file)",
      );
    }
  });

  it("disables Export for a reader-backed layer whose bytes cannot be re-obtained", async () => {
    open({ table: { ...READER_TABLE, source: null } });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const button = screen.getByRole("button", {
      name: "Export",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Re-link the file to export this layer");
  });

  it("forces one table rebuild when it opens on a streaming layer", async () => {
    open({ table: FALLBACK_TABLE, isStreaming: true });
    await waitFor(() =>
      expect(refreshStreamingTable).toHaveBeenCalledWith("L"),
    );
  });

  it("does NOT rebuild for a static layer", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(refreshStreamingTable).not.toHaveBeenCalled();
  });

  it("defaults the scope to the whole layer when nothing is applied", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Whole layer") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Current filter") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("defaults the scope to the filter when one is applied", async () => {
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Current filter") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("runs an attribute export with the chosen columns and downloads it", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CSV"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const request = runExport.mock.calls[0]![0] as {
      kind: string;
      format: string;
      table: string;
      columns: Array<{ name: string }>;
      where: string | null;
      fileName: string;
    };
    expect(request.kind).toBe("attributes");
    expect(request.format).toBe("csv");
    expect(request.table).toBe("layer_1");
    expect(request.columns.map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "b3_h_dak_max",
    ]);
    expect(request.where).toBeNull();
    expect(request.fileName).toBe("delft.csv");
  });

  it("carries the compiled filter as the export scope", async () => {
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (runExport.mock.calls[0]![0] as { where: string | null }).where,
    ).toBe('"b3_h_dak_max" > 10');
  });

  it("runs a CityParquet export with the LoD, the EPSG and the chosen root types", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("SolitaryVegetationObject"));
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    const request = runExport.mock.calls[0]![0] as {
      kind: string;
      lod: string;
      epsg: number;
      rootTypes: string[];
      attributes: string[];
      reader: string;
      fileName: string;
    };
    expect(request.kind).toBe("cityparquet");
    expect(request.lod).toBe("2.2");
    expect(request.epsg).toBe(7415);
    expect(request.rootTypes).toEqual(["Building"]);
    expect(request.attributes).toEqual(["b3_h_dak_max"]);
    expect(request.reader).toBe("read_cityjson");
    expect(request.fileName).toBe("delft.cityparquet.zip");
  });

  it("refuses CityParquet without an EPSG code, with a sentence", async () => {
    open({ epsg: null });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    expect(
      screen.getByText(
        "This layer has no EPSG code, so a CityParquet package cannot be written.",
      ),
    ).toBeTruthy();
  });

  it("cannot export with no object types selected", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Building"));
    fireEvent.click(screen.getByLabelText("SolitaryVegetationObject"));
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the export's own error and stays open", async () => {
    runExport.mockRejectedValue(new Error("IO Error: could not write"));
    const { onClose } = open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "IO Error: could not write",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("falls back to an offered format when the table loses its reader", async () => {
    const { rerender } = render(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={READER_TABLE}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));

    // A streaming rebuild lands: the table comes back as a fallback.
    rerender(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={FALLBACK_TABLE}
        epsg={7415}
        selectedLod={null}
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    // A radio is still checked, and it is one the layer can actually serve.
    expect((screen.getByLabelText("Parquet") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("re-seeds the attribute list when the table's columns change", async () => {
    const { rerender } = render(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={READER_TABLE}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.getByLabelText("b3_h_dak_max")).toBeTruthy();

    rerender(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={{
          ...READER_TABLE,
          columns: [
            { name: "id", type: "VARCHAR", kind: "scalar" as const },
            { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
            { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
            { name: "bouwjaar", type: "BIGINT", kind: "castText" as const },
          ],
        }}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText("b3_h_dak_max")).toBeNull();
    expect(
      (screen.getByLabelText("bouwjaar") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("shows the export's warnings after a successful download", async () => {
    runExport.mockResolvedValue({
      blob: new Blob(["x"]),
      fileName: "delft.cityparquet.zip",
      warnings: ["cityparquet_validate reported 3 findings."],
    });
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      await screen.findByText("cityparquet_validate reported 3 findings."),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/ui/table/ExportDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/table/ExportDialog.tsx`**

```tsx
/**
 * Write the layer — or the rows the filter kept — out to a file.
 *
 * Everything is FEATURE-scoped, never a bare row predicate: a Building carries
 * the attributes and its BuildingPart carries the geometry, so exporting only
 * the rows a filter matched would routinely produce a file of semantics with
 * no shapes in it.
 *
 * CityJSON, CityJSONSeq and FlatCityBuf are deliberately absent: their wasm
 * writers produce ZERO BYTES, silently, and a format that hands back an empty
 * file is worse than one that is not offered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runQuery } from "../../analytics/duckdb";
import type { LayerTable } from "../../analytics/layerTables";
import { runExport, type ExportRequest } from "../../analytics/export";
import { buildRootTypesSql, compileFilter } from "../../analytics/sql";
import { FLAT_PREFIX_COLUMNS } from "../../analytics/layerRows";
import { refreshStreamingTable } from "../../features/layers/layerTableLifecycle";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { downloadBlob } from "../../platform/download";
import { useModalChrome } from "../useModalChrome";

/**
 * The columns that are never offered as "attributes".
 *
 * `id, feature_id, object_type, parents, children` plus `children_roles` and
 * `bbox` are identity and structure — the exporter always writes them, and
 * `CITYPARQUET_REQUIRED_COLUMNS` says so.
 *
 * `address` and `other` are here for the OPPOSITE reason: they are the
 * reader's own columns, not the file's attributes, and the CityParquet source
 * table does not carry them (the writer does not require them, and nobody
 * chose them). Leaving them in the attribute list would offer
 * `address STRUCT[]` as a tick-box and then feed it into a source SELECT that
 * has no business holding it.
 */
const FIXED_COLUMNS = new Set([
  ...FLAT_PREFIX_COLUMNS,
  "children_roles",
  "bbox",
  "address",
  "other",
]);

type Format = "cityparquet" | "parquet" | "csv" | "json";

const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  cityparquet: "CityParquet package (.zip)",
  parquet: "Parquet",
  csv: "CSV",
  json: "JSON",
};

const EXTENSIONS: Readonly<Record<Format, string>> = {
  cityparquet: "cityparquet.zip",
  parquet: "parquet",
  csv: "csv",
  json: "json",
};

/**
 * Shown, and greyed out, so the user learns the capability EXISTS and why they
 * cannot have it — an absent option teaches nothing and invites the same
 * question again next release.
 *
 * The sinks bypass DuckDB's VFS entirely: browser-confirmed 2026-09-04 that no
 * file is created at all (the missing-file signature), for all three formats,
 * with and without a pre-registered empty buffer, while the same extension
 * writes fine through `cityparquet_write`.
 */
const DISABLED_FORMATS: ReadonlyArray<string> = [
  "CityJSON",
  "CityJSONSeq",
  "FlatCityBuf",
];

const DISABLED_FORMAT_REASON =
  "Not available in the browser build of the cityjson extension (writes an empty file)";

const NO_EPSG_REASON =
  "This layer has no EPSG code, so a CityParquet package cannot be written.";

const NO_SOURCE_REASON =
  "This layer has no CityJSON source in DuckDB; geometry formats need one";

const RELINK_REASON = "Re-link the file to export this layer";

/** "delft.city.json" + "csv" -> "delft.csv": the layer's name with every
 *  extension it already carries replaced by the format's own. */
export function exportFileName(layerName: string, format: string): string {
  const stem = layerName.split(".")[0] || "export";
  return `${stem}.${format}`;
}

export interface ExportDialogProps {
  readonly layerId: string;
  readonly layerName: string;
  readonly table: LayerTable;
  readonly epsg: number | null;
  readonly selectedLod: string | null;
  readonly isStreaming: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({
  layerId,
  layerName,
  table,
  epsg,
  selectedLod,
  isStreaming,
  onClose,
}: ExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalChrome(dialogRef, onClose);

  const query = useQueryStore((s) => layerQuery(s, layerId));

  const attributeColumns = useMemo(
    () => table.columns.filter((c) => !FIXED_COLUMNS.has(c.name)),
    [table.columns],
  );

  /** A CityParquet package needs a reader (the geometry comes from the source,
   *  not the browsing table), an LoD, and an EPSG code for its CRS. */
  const canCityParquet =
    table.reader !== null &&
    table.source !== null &&
    table.lods.length > 0 &&
    epsg !== null;
  const formats: ReadonlyArray<Format> = canCityParquet
    ? ["cityparquet", "parquet", "csv", "json"]
    : ["parquet", "csv", "json"];
  /** A reader-backed layer whose bytes can no longer be obtained: the table is
   *  browsable, but nothing can be written from a source that is not there. */
  const relinkNeeded = table.reader !== null && table.source === null;

  const [rootTypes, setRootTypes] = useState<ReadonlyArray<string>>([]);
  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedAttributes, setSelectedAttributes] = useState<
    ReadonlySet<string>
  >(() => new Set(attributeColumns.map((c) => c.name)));

  // That initialiser runs ONCE. A streaming layer's table is rebuilt under
  // this dialog — `refreshStreamingTable` on open, and again on every commit
  // while the panel is up — and the new table can carry different columns, so
  // re-seed on the column list's identity. Without it the export writes a
  // column list belonging to a table that no longer exists.
  useEffect(() => {
    setSelectedAttributes(new Set(attributeColumns.map((c) => c.name)));
  }, [attributeColumns]);
  const [scope, setScope] = useState<"all" | "filter">(
    query.applied === null ? "all" : "filter",
  );
  const [chosenFormat, setChosenFormat] = useState<Format>("csv");
  // CLAMPED, not stored blind: `formats` SHRINKS when the table is rebuilt as
  // a fallback (a streaming layer's rebuild), and a `chosenFormat` of
  // "cityparquet" that is no longer offered would leave the dialog with no
  // radio checked and an Export button running a route this layer cannot serve.
  const format: Format = formats.includes(chosenFormat)
    ? chosenFormat
    : formats[0]!;
  const [lod, setLod] = useState<string>(
    selectedLod !== null && table.lods.includes(selectedLod)
      ? selectedLod
      : (table.lods[table.lods.length - 1] ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);

  // A streaming layer's table is only as fresh as its last rebuild, and the
  // panel gates those on being open. Opening this dialog is a promise that the
  // export reflects what is resident NOW, so force one rebuild; the new table
  // arrives as a new `table` prop and re-runs the type probe below.
  useEffect(() => {
    if (!isStreaming) return;
    void refreshStreamingTable(layerId);
  }, [isStreaming, layerId]);

  // The top-level types come from the table, not from the model: a streaming
  // layer has no model to ask, and the two could disagree.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await runQuery(buildRootTypesSql(table.table));
      if (cancelled || !result.ok) return;
      const types = result.rows
        .map((row) => row.value)
        .filter((v): v is string => typeof v === "string");
      setRootTypes(types);
      setSelectedTypes(new Set(types));
    })();
    return () => {
      cancelled = true;
    };
  }, [table.table]);

  const toggle = useCallback(
    (set: ReadonlySet<string>, value: string): ReadonlySet<string> => {
      const next = new Set(set);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    },
    [],
  );

  const handleExport = useCallback(async () => {
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      let where: string | null = null;
      if (scope === "filter" && query.applied !== null) {
        const compiled = compileFilter(query.applied, table.columns);
        if (!compiled.ok) throw new Error(compiled.message);
        where = compiled.where;
      }

      const attributes = attributeColumns
        .filter((c) => selectedAttributes.has(c.name))
        .map((c) => c.name);

      let request: ExportRequest;
      if (format === "cityparquet") {
        // A real guard, not `!`. `canCityParquet` gates the option, but the
        // TABLE can be rebuilt under an open dialog and come back as a
        // fallback with no reader and no source; a non-null assertion would
        // then send `undefined` into the exporter and fail somewhere deep in
        // the SQL, where the message means nothing to the user.
        const { reader, source } = table;
        if (reader === null || source === null || epsg === null) {
          throw new Error(
            "This layer no longer has a CityJSON source with an EPSG code, so a CityParquet package cannot be written. Pick another format.",
          );
        }
        request = {
          kind: "cityparquet",
          table: table.table,
          reader,
          source,
          sourceExtension:
            reader === "read_cityjsonseq" ? "city.jsonl" : "city.json",
          lod,
          attributes,
          where,
          rootTypes: rootTypes.filter((t) => selectedTypes.has(t)),
          epsg,
          fileName: exportFileName(layerName, EXTENSIONS.cityparquet),
        };
      } else {
        request = {
          kind: "attributes",
          format,
          table: table.table,
          columns: [
            ...table.columns.filter(
              (c) =>
                c.name === "id" ||
                c.name === "feature_id" ||
                c.name === "object_type",
            ),
            ...attributeColumns.filter((c) => selectedAttributes.has(c.name)),
          ],
          where,
          fileName: exportFileName(layerName, EXTENSIONS[format]),
        };
      }

      const result = await runExport(request);
      downloadBlob(result.blob, result.fileName);
      setWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      // Cancel-safe: a rejected export must still give the button back.
      setBusy(false);
    }
  }, [
    attributeColumns,
    epsg,
    format,
    layerName,
    lod,
    query.applied,
    rootTypes,
    scope,
    selectedAttributes,
    selectedTypes,
    table,
  ]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Export ${layerName}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2>Export {layerName}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body export-body">
          <fieldset className="export-group">
            <legend>Rows</legend>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Whole layer"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              <span>Whole layer</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Current filter"
                disabled={query.applied === null}
                checked={scope === "filter"}
                onChange={() => setScope("filter")}
              />
              <span>Current filter</span>
            </label>
          </fieldset>

          <fieldset className="export-group">
            <legend>Object types</legend>
            {rootTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  aria-label={type}
                  checked={selectedTypes.has(type)}
                  onChange={() => setSelectedTypes((s) => toggle(s, type))}
                />
                <span>{type}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="export-group export-group-scroll">
            <legend>Attributes</legend>
            {attributeColumns.map((column) => (
              <label key={column.name}>
                <input
                  type="checkbox"
                  aria-label={column.name}
                  checked={selectedAttributes.has(column.name)}
                  onChange={() =>
                    setSelectedAttributes((s) => toggle(s, column.name))
                  }
                />
                <span>{column.name}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="export-group">
            <legend>Format</legend>
            {formats.map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="export-format"
                  aria-label={FORMAT_LABELS[f]}
                  checked={format === f}
                  onChange={() => setChosenFormat(f)}
                />
                <span>{FORMAT_LABELS[f]}</span>
              </label>
            ))}
            {/* Only where a source exists to write geometry FROM: on a
                fallback layer the honest message is the sentence below, not a
                greyed-out option whose reason is a different one. */}
            {table.reader !== null &&
              DISABLED_FORMATS.map((label) => (
                <label key={label} title={DISABLED_FORMAT_REASON}>
                  <input
                    type="radio"
                    name="export-format"
                    aria-label={label}
                    disabled
                    checked={false}
                    onChange={() => {}}
                  />
                  <span>{label}</span>
                </label>
              ))}
          </fieldset>

          {table.reader === null && (
            <p className="export-note">{NO_SOURCE_REASON}</p>
          )}

          {table.lods.length > 0 && (
            <label className="export-field">
              <span>Level of detail</span>
              <select
                aria-label="Level of detail"
                value={lod}
                onChange={(e) => setLod(e.target.value)}
              >
                {table.lods.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}

          {table.reader !== null && epsg === null && (
            <p className="export-note">{NO_EPSG_REASON}</p>
          )}

          {warnings.map((warning) => (
            <p className="export-note" key={warning}>
              {warning}
            </p>
          ))}

          {error !== null && (
            <p className="export-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            title={relinkNeeded ? RELINK_REASON : undefined}
            disabled={busy || selectedTypes.size === 0 || relinkNeeded}
            onClick={() => void handleExport()}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Open it from the table header**

In `src/ui/table/TablePanel.tsx`, add `const [exportOpen, setExportOpen] = useState(false);`, an Export button beside the Filter one:

```tsx
<button
  type="button"
  className="tb-btn table-action-btn"
  disabled={view.status !== "ready"}
  onClick={() => setExportOpen(true)}
>
  Export
</button>
```

and, at the end of the panel's JSX:

```tsx
{
  exportOpen && view.table !== null && activeLayer !== undefined && (
    <ExportDialog
      layerId={activeLayer.id}
      layerName={activeLayer.name}
      table={view.table}
      epsg={epsgOf(activeLayer.model.metadata.referenceSystem)}
      selectedLod={activeLayer.selectedLod}
      isStreaming={activeLayer.isStreaming}
      onClose={() => setExportOpen(false)}
    />
  );
}
```

with, at the bottom of the file:

```ts
/** The layer's EPSG code as a number, or null. The CityParquet writer takes
 *  `crs => 'EPSG:NNNN'` and nothing else, so a layer whose reference system
 *  names no code cannot be written as a package. */
function epsgOf(referenceSystem: string | undefined): number | null {
  const code = extractCrsCode(referenceSystem);
  if (code === null) return null;
  const n = Number(code);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

and the imports `import { ExportDialog } from "./ExportDialog";` / `import { extractCrsCode } from "../toolbar/crsCode";`.

- [ ] **Step 5: Add the dialog's CSS**

Append to `src/app/app.css`:

```css
/* Export dialog */

.export-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.export-group {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
}

.export-group legend {
  font-size: 0.65rem;
  color: var(--fg-label);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.export-group label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
}

.export-group-scroll {
  max-height: 9rem;
  overflow-y: auto;
}

.export-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
}

.export-note {
  margin: 0;
  font-size: 0.65rem;
  color: var(--fg-muted);
}

.export-error {
  margin: 0;
  font-size: 0.7rem;
  color: var(--danger-text, var(--fg));
}
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npx vitest run
npx tsc -b --noEmit
```

Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/table/ExportDialog.tsx src/ui/table/TablePanel.tsx src/app/app.css tests/unit/ui/table/ExportDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(table): export dialog — scope, types, attributes, LoD and format

Everything is feature-scoped, never a bare row predicate: a Building carries
the attributes and its BuildingPart the geometry, so exporting only the rows a
filter matched would routinely produce a file of semantics with no shapes in
it. CityJSON/CityJSONSeq/FlatCityBuf are absent because their wasm writers
produce zero bytes silently, and CityParquet is offered only where there is a
reader, an LoD and an EPSG code.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 32: End-to-end browser smoke of the finished export dialog

**Files:**

- Create: `scripts/smoke/duckdb-table-and-export.md` (the recipe and its recorded run)

**Interfaces:**

- Consumes: the whole feature.
- Produces: nothing other tasks depend on.

**What this is NOT.** It is not a gate on `cityparquet_write`. That was settled
in a real Chrome tab (Chrome 151, 2026-09-04, the app's exact boot sequence): a
filtered CTAS source, `PRAGMA cityparquet_init` as its own statement, then the
write returned `building.parquet` and `metadata.json`, both retrievable through
`copyFileToBuffer` with `PAR1` magic and a real STAC Item — and a materialised
table survives `dropFile` of its source. The route in Task 30 is the verified
one. What is left is the ORDINARY end-to-end check that the finished UI does
what the parts do.

- [ ] **Step 1: Boot the app and load a reader-backed layer**

```bash
npm run dev
```

In another shell:

```bash
agent-browser open http://localhost:5173
agent-browser snapshot -i
```

Click "try the Delft sample" (`https://storage.googleapis.com/cityjson/delft.city.jsonl`
— CityJSONSeq, so the table is reader-backed via `read_cityjsonseq`). Wait for
the status bar to read `DuckDB Ready`, and hover it to confirm the tooltip names
`Platform wasm_eh` and `cityjson`.

- [ ] **Step 2: Browse, sort and page**

Click `Table` in the status bar. Confirm: the header shows the layer's name and
a row count; the grid has an `id`, `feature_id` and `object_type` column and NO
`geometry_*` column; clicking a header sorts (the arrow appears); the footer
reads `1–100 of N`; switching to 1000 rows per page and stepping Next changes
the range text.

```bash
agent-browser snapshot -i
```

- [ ] **Step 3: Filter, and filter the map**

Click `Filter`, add `object_type` `=` `Building`, click `Apply`. Confirm the
footer now reads `… filtered from N`. Tick `Filter map` and confirm the viewport
drops the objects that no longer match. Then edit the condition to a value
nothing matches, Apply, and confirm the grid says
`0 of N rows match; the map shows nothing while Filter map is on` rather than
going blank without explanation. Clear the filter and confirm the buildings
come back.

- [ ] **Step 4: Export each of the four formats**

For `CSV`, `JSON`, `Parquet` and `CityParquet package (.zip)` in turn: open
`Export`, pick the format, click Export, and confirm a file arrives. Confirm the
three city formats are visible but greyed out with the reason on hover.

```bash
agent-browser eval 'Array.from(document.querySelectorAll("input[name=export-format]")).map(i => [i.getAttribute("aria-label"), i.disabled])'
```

- [ ] **Step 5: Re-open every downloaded file**

```bash
cd ~/Downloads
head -c 4 delft.parquet          # expect: PAR1
python3 -c "import json,sys; print(len(json.load(open('delft.json'))))"
head -2 delft.csv
python3 -c "import zipfile; z=zipfile.ZipFile('delft.cityparquet.zip'); print(z.namelist()); print(z.read('metadata.json')[:80])"
```

Expected: `PAR1`; a positive row count; a header line plus one data row; a zip
naming at least one `*.parquet` and `metadata.json`, whose first bytes are a
JSON object.

- [ ] **Step 6: Check that no export left anything in the VFS**

`dropFile` over a file the WRITER created — as opposed to a buffer the app
registered — is not something the Node probes covered, and a leak here holds a
whole package in memory for the rest of the session.

```bash
agent-browser eval '
(async () => {
  const m = await import("/src/analytics/duckdb.ts");
  const r = await m.runQuery("SELECT * FROM globFiles(\x27exp_*\x27)");
  return JSON.stringify(r);
})()
'
```

Expected: `ok: true` with ZERO rows — after four exports nothing named `exp_*`
survives. (`globFiles` also lists names that were never created, so a non-empty
result is worth reading rather than trusting: anything it DOES list must at
least not read back as real bytes.)

- [ ] **Step 7: Check the console and record the run**

```bash
agent-browser console
```

Expected: no errors, and no `Could not remove the exported file` warnings.

Write `scripts/smoke/duckdb-table-and-export.md` with the recipe above, the
date, the Chrome version (`agent-browser eval 'navigator.userAgent'`), and one
line per step stating what was observed.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke/duckdb-table-and-export.md
git commit -m "$(cat <<'EOF'
test: browser smoke for the layer table, the map filter and all four exports

Navara needs real WebGL and WASM, so the end-to-end path is a browser smoke and
not a jsdom test. cityparquet_write itself was verified separately in Chrome
151 (filtered CTAS, init as its own statement, both output files retrievable
with PAR1 magic); this covers the finished UI over it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 33: Opt-in Node integration test against the real engine

**Files:**

- Create: `tests/integration/duckdb/layerTables.test.ts`
- Create: `tests/integration/duckdb/harness.ts`

**Interfaces:**

- Consumes: the SQL builders (Tasks 9–11), `classifyColumnType` (Task 5).
- Produces: nothing other tasks depend on.

**Why opt-in.** The default `npx vitest run` is jsdom and offline. This suite needs the real 36 MB wasm binary and fetches the `cityjson` community extension over the network, so it is gated behind `DUCKDB_INTEGRATION=1` and skipped otherwise. It exists to catch the one thing unit tests structurally cannot: a schema drift in the community extension build, which the duckdb-wasm pin pins but does not freeze.

- [ ] **Step 1: Write the harness**

Create `tests/integration/duckdb/harness.ts`:

```ts
/**
 * A real DuckDB 1.5.5 with the cityjson extension, under Node.
 *
 * The BLOCKING node bindings, not the app's async browser ones: the app's
 * module boots a `Worker` from a jsDelivr blob, which Node has no equivalent
 * for. Reads over `registerFileBuffer` share the code path with the browser
 * runtime, so what this suite proves about the SQL holds there too.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

export interface Harness {
  query(sql: string): Record<string, unknown>[];
  /** Register a file from `fixtures/`. */
  register(name: string, fixture: string): void;
  /** Register bytes built in the test itself. */
  registerBytes(name: string, bytes: Uint8Array): void;
  close(): void;
}

/* eslint-disable typescript/no-explicit-any */

export async function openDuckDB(): Promise<Harness> {
  const duckdb =
    require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs") as any;
  const dist = dirname(
    require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"),
  );
  const bundles = {
    mvp: {
      mainModule: resolve(dist, "./duckdb-mvp.wasm"),
      mainWorker: resolve(dist, "./duckdb-node-mvp.worker.cjs"),
    },
    eh: {
      mainModule: resolve(dist, "./duckdb-eh.wasm"),
      mainWorker: resolve(dist, "./duckdb-node-eh.worker.cjs"),
    },
  };

  const db = await duckdb.createDuckDB(
    bundles,
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const conn = db.connect();
  conn.query("INSTALL cityjson FROM community;");
  conn.query("LOAD cityjson;");

  return {
    query(sql) {
      const table = conn.query(sql);
      return table.toArray().map((row: { toJSON?: () => unknown }) => {
        const plain = (row.toJSON ? row.toJSON() : row) as Record<
          string,
          unknown
        >;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(plain)) {
          out[key] = typeof value === "bigint" ? Number(value) : value;
        }
        return out;
      });
    },
    register(name, fixture) {
      db.registerFileBuffer(
        name,
        new Uint8Array(readFileSync(resolve("fixtures", fixture))),
      );
    },
    registerBytes(name, bytes) {
      db.registerFileBuffer(name, bytes);
    },
    close() {
      conn.close();
    },
  };
}
```

- [ ] **Step 2: Write the suite**

Create `tests/integration/duckdb/layerTables.test.ts`:

```ts
// @vitest-environment node
/**
 * The SQL this app emits, run against a REAL DuckDB 1.5.5 with the real
 * cityjson extension.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 * Skipped otherwise, because it downloads a 36 MB binary and fetches the
 * community extension over the network — neither belongs in the default run.
 *
 * What only this suite can catch: the community slot for a DuckDB version can
 * be REBUILT under us (the duckdb-wasm pin pins the extension build, it does
 * not freeze it), and a column that changed name or type would sail through
 * every unit test in the repo.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Harness } from "./harness";
import {
  classifyColumnType,
  isDroppedColumn,
  lodsFromColumnNames,
} from "../../../src/analytics/columnKind";
import {
  buildCountSql,
  buildFeatureIdsSql,
  buildPageSql,
  buildRootTypesSql,
  compileFilter,
  quoteIdent,
} from "../../../src/analytics/sql";
import type { ColumnInfo } from "../../../src/analytics/columnKind";

const enabled = process.env.DUCKDB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("layer tables over real fixtures", () => {
  let db: Harness;
  let columns: ColumnInfo[];
  const TABLE = "layer_1";

  beforeAll(async () => {
    // DYNAMIC, inside `beforeAll`: the file is collected by the default run
    // (it matches `tests/**/*.test.ts`) and only `describe.skip` keeps it from
    // executing — a top-level import would still evaluate the harness, which
    // `require`s the DuckDB node bindings and resolves three wasm paths, in
    // every offline run of the suite.
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    db.register("two.city.json", "two-buildings.city.json");

    const described = db.query(
      "DESCRIBE SELECT * FROM read_cityjson('two.city.json')",
    );
    const all: ColumnInfo[] = described.map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      kind: classifyColumnType(String(row.column_type)),
    }));
    columns = all.filter((c) => !isDroppedColumn(c.name));
    const select = columns.map((c) => quoteIdent(c.name)).join(", ");
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(TABLE)} AS SELECT ${select} FROM read_cityjson('two.city.json')`,
    );
  }, 120_000);

  afterAll(() => db?.close());

  it("returns exactly the id set parseCityJSON produces — the map sync joins on it", async () => {
    // The whole map filter rests on this equality: `buildFeatureIdsSql` returns
    // reader `id` values, `setVisibleObjectIds` hands them to the mesh, and the
    // mesh looks them up in the PARSED model's object keys. A drift on either
    // side hides everything, silently and with no error to read.
    const { parseCityJSON } = await import("@cityjson/navara-core");
    const json = JSON.parse(
      readFileSync(resolve("fixtures", "two-buildings.city.json"), "utf8"),
    ) as Parameters<typeof parseCityJSON>[0];
    const parsed = new Set(Object.keys(parseCityJSON(json).objects));
    const fromReader = new Set(
      db
        .query(`SELECT "id" FROM ${quoteIdent(TABLE)}`)
        .map((row) => String(row.id)),
    );
    expect([...fromReader].sort()).toEqual([...parsed].sort());
  });

  it("still publishes the identity columns this app depends on", () => {
    const names = columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("feature_id");
    expect(names).toContain("object_type");
    expect(names).toContain("parents");
    expect(names).toContain("children");
  });

  it("drops every geometry, material, texture and template column", () => {
    for (const c of columns) {
      expect(c.name.startsWith("geometry_")).toBe(false);
      expect(c.name.startsWith("material_")).toBe(false);
      expect(c.name.startsWith("texture_")).toBe(false);
      expect(c.name).not.toBe("template");
    }
  });

  it("reads an LoD ladder off the reader's own column names", () => {
    const described = db.query(
      "DESCRIBE SELECT * FROM read_cityjson('two.city.json')",
    );
    const lods = lodsFromColumnNames(
      described.map((r) => String(r.column_name)),
    );
    expect(lods.length).toBeGreaterThan(0);
  });

  it("runs the page SQL and returns rows", () => {
    const rows = db.query(buildPageSql(TABLE, columns, null, null, 0, 100));
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0]!.id).toBe("string");
  });

  it("projects nested columns as JSON text, never as an Arrow vector", () => {
    const rows = db.query(buildPageSql(TABLE, columns, null, null, 0, 1));
    const parents = rows[0]!.parents;
    expect(parents === null || typeof parents === "string").toBe(true);
  });

  it("counts, filters and expands matches to whole features", () => {
    const total = db.query(buildCountSql(TABLE, null))[0]!.n as number;
    expect(total).toBeGreaterThan(0);

    const compiled = compileFilter(
      {
        logic: "AND",
        conditions: [
          { id: "c", column: "object_type", op: "=", value: "Building" },
        ],
      },
      columns,
    );
    expect(compiled.ok).toBe(true);
    const where = compiled.ok ? compiled.where : null;

    const filtered = db.query(buildCountSql(TABLE, where))[0]!.n as number;
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(total);

    const ids = db.query(buildFeatureIdsSql(TABLE, where));
    // Feature expansion can only ever ADD rows to the matched set.
    expect(ids.length).toBeGreaterThanOrEqual(filtered);
  });

  it("lists the top-level types with the parents IS NULL test", () => {
    const types = db.query(buildRootTypesSql(TABLE)).map((r) => r.value);
    expect(types).toContain("Building");
  });

  it("reads validation findings the way the exporter does", () => {
    // The exporter's route, against the real extension: the PRAGMA returns no
    // rows and materialises `cityparquet_validation`, which is then selected
    // from. If a future build made the pragma RETURN its findings instead,
    // every export would silently report "no warnings".
    db.query("CREATE SCHEMA exp_probe");
    db.query(
      `CREATE TABLE exp_probe.building AS SELECT * FROM ${quoteIdent(TABLE)} LIMIT 0`,
    );
    db.query("PRAGMA cityparquet_init('exp_probe')");
    const pragmaRows = db.query("PRAGMA cityparquet_validate('exp_probe')");
    expect(pragmaRows).toEqual([]);
    // The temp table exists and carries a `severity` column, which is what the
    // exporter groups by.
    const findings = db.query(
      'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1',
    );
    expect(Array.isArray(findings)).toBe(true);
    db.query("DROP SCHEMA exp_probe CASCADE");
  });

  it("types an ALL-NULL parents column as VARCHAR[] on the flat-fallback path", async () => {
    // The fallback's schema must match the reader's, and `read_json_auto`
    // types an all-NULL column as JSON. The ALTER in `buildFromRows` is what
    // fixes it — this asserts the SQL that task emits really does.
    const rows = [
      {
        id: "A",
        feature_id: "A",
        object_type: "Building",
        parents: null,
        children: null,
      },
      {
        id: "B",
        feature_id: "B",
        object_type: "Building",
        parents: null,
        children: null,
      },
    ];
    db.registerBytes(
      "flat.json",
      new TextEncoder().encode(JSON.stringify(rows)),
    );
    db.query(
      "CREATE OR REPLACE TABLE flat AS SELECT * FROM read_json_auto('flat.json')",
    );
    const inferred = db
      .query("DESCRIBE flat")
      .find((r) => r.column_name === "parents");
    expect(inferred?.column_type).toBe("JSON");

    for (const column of ["parents", "children"]) {
      db.query(`ALTER TABLE flat ALTER COLUMN "${column}" TYPE VARCHAR[]`);
    }
    const fixed = db
      .query("DESCRIBE flat")
      .find((r) => r.column_name === "parents");
    expect(fixed?.column_type).toBe("VARCHAR[]");
    expect(
      db.query("SELECT count(*) AS n FROM flat WHERE parents IS NULL")[0]!.n,
    ).toBe(2);
  });

  it("sorts with NULLS LAST without erroring on any scalar column", () => {
    for (const column of columns.filter(
      (c) => c.kind === "scalar" || c.kind === "castText",
    )) {
      expect(() =>
        db.query(
          buildPageSql(
            TABLE,
            columns,
            null,
            { column: column.name, dir: "desc" },
            0,
            5,
          ),
        ),
      ).not.toThrow();
    }
  });
});
```

- [ ] **Step 3: Make the default run skip it, and confirm**

`vitest.config.ts`'s `include` is `["tests/**/*.test.ts", "tests/**/*.test.tsx"]`, so the file IS collected — the `describe.skip` is what keeps it out of the default run, and the `// @vitest-environment node` pragma is what gives it a Node environment when it does run.

```bash
npx vitest run tests/integration/duckdb
```

Expected: the suite is reported as skipped, 0 failures, no network access.

- [ ] **Step 4: Run it for real, once**

```bash
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
```

Expected: PASS. If `INSTALL cityjson FROM community` fails, the machine is offline or the community slot for 1.5.5 has changed — record which in the task's notes rather than weakening an assertion.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/duckdb
git commit -m "$(cat <<'EOF'
test: opt-in Node integration suite over a real DuckDB 1.5.5 + cityjson

Gated behind DUCKDB_INTEGRATION=1 because it downloads a 36 MB binary and
fetches the community extension. It exists for the one failure unit tests
structurally cannot see: the community slot for a DuckDB version can be
rebuilt under us, and a column that changed name or type would sail through
every mocked test in the repo.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

---

## Task 34: Documentation and the final verification pass

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/roadmap.md`

**Interfaces:**

- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Replace CLAUDE.md's Analytics line and add the architecture bullet**

In the **Tech Stack** list, replace

```
- **Analytics**: DuckDB-wasm with cityjson extension
```

with

```
- **Analytics**: `@duckdb/duckdb-wasm@1.33.1-dev64.0` (DuckDB **1.5.5**, `wasm_eh`) with the `cityjson` community extension v0.4.0; `spatial` and `three_d` are loadable on demand via `ensureExtension` but have NOTHING TO OPERATE ON in v1 — the layer table is attribute-only, and a geometry predicate needs either materialised geometry columns (the memory the design exists to avoid) or a computed-columns feature that re-reads the source. Neither extension autoloads in wasm, and `spatial` is a CORE extension: `INSTALL spatial` (~5 s / 23.6 MB), never `FROM community`, which is what `cityjson` and `three_d` use. Two `three_d` traps for the follow-up: `ST_3DFromWKB` throws on a MultiPolygon Z row and ONE such row poisons a whole column query (use `ST_3DTryFromWKB`), and `ST_3DVolume` raises "solid is not manifold" on an unguarded aggregate (guard with `ST_3DValidationReport(...).is_valid`). Pinned EXACTLY — npm `latest` (dev57 / 1.5.4) serves a stale 4-function `cityjson` and a `three_d` that breaks `LOAD spatial`, silently, and 1.4.4 (dev20) has no `cityjson` wasm artifact at all.
```

Then add this bullet to **Key Architecture Decisions**, after the CityParquet one:

```
- **Every city layer gets its OWN DuckDB table, built from bytes, and the source is dropped.** `analytics/layerTables.ts` owns a registry plus ONE async FIFO queue: `addCityLayer` (the single door every static add goes through — a dropped file, a picked folder, a URL, a restore, a share link, a re-link) enqueues a build, and `layerTableLifecycle.ts` diffs the layer store to drop tables and to enqueue a STREAMING layer's (whose rows arrive cell by cell, so it rebuilds on commits, debounced 500 ms, only while the panel is open or an export is pending). The single global `city_objects` table is gone, and with it `shouldUseSourceUrlPath`/`loadModelIntoDuckDB`/`loadCityModelFromMemory`/`loadResidentObjectsIntoDuckDB` — one shared table meant a second layer silently replaced the first one's analytics. A reader-backed layer hands DuckDB the DECODED BYTES the loader already holds (`loadFromUrl` returns `{model, bytes, encoding}`), never a URL: `read_cityjson` over http is unexercised in wasm and CORS-dependent, and registering bytes means a URL layer is never downloaded twice. The build drops `geometry_*`/`geometry_properties_*`/`material_*`/`texture_*`/`template` (53 of 70 columns on Delft, 2.45x less table memory) and then drops the source buffer — probed: a materialised table survives `dropFile`, while the DROPPED NAME resolves to ZERO BYTES forever and fails with a misleading JSON parse error, so VFS names come from a module counter and are NEVER reused; an export re-registers the bytes under a fresh name through the entry's `SourceProvider` (a `File` is a reference, a URL is re-fetched). CityGML, its ZIP, CityParquet and streaming residents take the FLAT FALLBACK: rows built app-side and loaded through `read_json_auto`, with the column names ALIGNED to the reader's (`id, feature_id, object_type, parents, children`, `parents`/`children` NULL rather than `[]`, `feature_id` from `domain/citymodel/featureId.ts`) so `parents IS NULL` is the feature-root test on every layer and one filter vocabulary covers all of them. The old `lod`/`surface_count` columns are gone — app-side derivations, not data. **Every SQL string is a pure function** in `analytics/sql.ts`, unit-tested against exact strings; `compileFilter` refuses an unknown column or an impossible operator BEFORE the query is sent. The map filter (`Layer.visibleObjectIds`, pushed by `handleSync` to the plugin's new `setVisibleObjectIds`) expands matches to whole FEATURES — a Building carries the attributes, its BuildingPart the geometry — with `COALESCE("feature_id","id")` on both sides of a POSITIVE `IN`, because one NULL `feature_id` makes a `NOT IN` predicate NULL and hides nothing; `null` means no filter and an EMPTY set means "nothing matched, draw nothing". Streaming layers cannot be map-filtered yet (the id set would have to travel to the FCB worker). Export goes through DuckDB's own writers — `COPY TO parquet|csv|json`, and `cityparquet_write` for a package zipped with `fflate` — and **never** `FORMAT cityjson|cityjsonseq|flatcitybuf`, whose sinks bypass DuckDB's VFS entirely (no file is created at all; the same extension writes fine through `cityparquet_write`, which is the upstream pointer). Those three are shown DISABLED in the dialog so the capability is discoverable. **Every read-back is validated BY CONTENT** — `PAR1` magic, `JSON.parse`, a newline-terminated CSV header — because a MISSING VFS name reads back as ONE GARBAGE BYTE with no error at all, while a genuinely empty file reads 0; `globFiles` lists names that were never created, so it is fit for cleanup and not for discovery, and the write's own result rows are what name the output. Filter, sort, page, sync-to-map and `visibleObjectIds` are SESSION state: snapshot schema stays v3.
```

- [ ] **Step 2: Add the milestone to `docs/roadmap.md`**

House style, matched to Milestones 9 and 10: the heading carries the status in
parentheses, and the entry goes AFTER `## Milestone 10: GIS Layers …` and
BEFORE `## Cross-Cutting Workstreams` — not at the end of the file, where
`## Main Risks` and `## Recommended Immediate Next Step` live.

```markdown
## Milestone 11: DuckDB Integration — Per-Layer Tables, Query Table, Map Filter, Export (Complete)

- 11.1 Engine: `@duckdb/duckdb-wasm@1.33.1-dev64.0` (DuckDB 1.5.5), per-extension
  status, `ensureExtension` for `spatial`/`three_d`, `runQuery` with DuckDB's own
  error message, VFS primitives, init retry.
- 11.2 One table per city layer (`analytics/layerTables.ts`), reader-backed from
  bytes or a flat fallback from the parsed model / resident records; one FIFO
  queue; `addCityLayer` as the single static add path.
- 11.3 Table panel: pagination (100/500/1000), sort, structured WHERE filter,
  DuckDB-only, states for engine-down / queued / building / failed / empty.
- 11.4 "Filter map": the applied filter's feature-expanded ids reach the plugin
  through `Layer.visibleObjectIds` and `CityModelMesh.setVisibleObjectIds`.
- 11.5 Export: Parquet / CSV / JSON via `COPY`, and a CityParquet package via
  `cityparquet_write` + `fflate`, every read-back validated by content.

`spatial` and `three_d` are integrated as LOADABLE CAPABILITIES only. They have
nothing to operate on in v1: the layer table is attribute-only, and a geometry
predicate needs either geometry columns materialised (the memory cost the
design exists to avoid) or a computed-columns feature that reads the
re-registered source on demand. `spatial` does not autoload in wasm and is a
CORE extension (`INSTALL spatial`, ~5 s / 23.6 MB — not `FROM community`).
Known `three_d` traps for that follow-up: `ST_3DFromWKB` throws on a
MultiPolygon Z row and one such row poisons a whole column query (use
`ST_3DTryFromWKB`); `ST_3DVolume` raises "solid is not manifold" on an
unguarded aggregate (guard with `ST_3DValidationReport(...).is_valid`).

Deferred: streaming-layer map filtering; persisting filters in snapshots and
share links; a free-text SQL console; geometry-backed analysis on
`spatial`/`three_d`; CityJSON/CityJSONSeq/FCB export until the upstream wasm
writer stops bypassing the VFS; CityParquet-sourced layers as reader-backed
tables (`cityparquet_read` is unusable in wasm).
```

Also update the **Milestones** section of `CLAUDE.md`, appending:

```
- Milestone 11 (DuckDB integration — per-layer tables, query table, map filter, export): Complete
```

- [ ] **Step 3: Run every check, in both repos**

```bash
npx tsc -b --noEmit
npx vitest run
cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run
```

Expected: all clean, 0 failed files in both.

- [ ] **Step 4: Verify a fresh clone installs (CI runs `npm ci`)**

`--recursive` resolves the gitlink from GITHUB, not from this checkout, so this
only works once the plugin branch is published — which Task 25 already did
(`git push -u origin duckdb-integration`). Confirm that first, then clone into a
throwaway directory:

```bash
git -C packages/cityjson-navara-plugins rev-parse HEAD
git -C packages/cityjson-navara-plugins rev-parse origin/duckdb-integration
cd "$(mktemp -d)"
git clone --recursive /data2/hideba/multiroof-viewer-integration-of-duckdb-wasm-and-relevant-extensio ci-check
cd ci-check && npm ci
```

Expected: the two hashes match, the recursive clone resolves the submodule, and
`npm ci` completes with no `EUSAGE` lockfile-mismatch error. If `npm ci` fails,
re-run `npm install` in the worktree, commit the regenerated
`package-lock.json`, and repeat. If the SUBMODULE step fails, the branch was
never pushed — go back and push it before anything else.

- [ ] **Step 5: Commit the docs**

```bash
git add CLAUDE.md docs/roadmap.md
git commit -m "$(cat <<'EOF'
docs: record the DuckDB integration architecture and milestone 11

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S9dC69EMBn9vK84Mvd6KKp
EOF
)"
```

- [ ] **Step 6: Code review before the push**

CLAUDE.md requires it: "When completing a major feature or milestone, use the
`feature-dev:code-reviewer` agent with high effort to review changes. Run the
review BEFORE committing. Address critical issues before pushing."

Dispatch it over the WHOLE branch diff — parent and submodule — not the last
commit:

```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
git -C packages/cityjson-navara-plugins log --oneline 947c980..HEAD
```

Give the reviewer that diff plus this plan and the spec, at high effort. Address
every **Critical** finding with its own commit (prefixed `fix:`) before Step 7;
record anything deliberately not acted on, and why, in the PR description.

- [ ] **Step 7: Push**

```bash
git push
```

The submodule branch went up in Task 25, and Step 4 has just proved a recursive
clone of this commit resolves — so there is nothing left to push there. (If Task
25's push was somehow skipped, `git -C packages/cityjson-navara-plugins push -u
origin duckdb-integration` must go first: a parent gitlink naming an unpublished
commit leaves a repository nobody else can clone.)

---

## Self-Review

Run against the spec as it stands at 510 lines (re-read after the plan's first
draft; §2, §3.1, §3.2, §3.4, §3.6, §4 and §6 all moved).

### 1. Spec coverage

| Spec section  | Requirement                                                                                                                                   | Task(s)                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| §1.1          | Every city-model layer in its own DuckDB table                                                                                                | 12, 13, 14, 16, 17                                |
| §1.2          | Table panel: pagination ≤1000, sort, structured WHERE                                                                                         | 8, 9, 10, 20, 21, 22, 23                          |
| §1.3          | A toggle applies the filter to the 3D map                                                                                                     | 24, 25, 26, 27                                    |
| §1.4          | Export dialog: format, LoD, object types, attributes                                                                                          | 7, 11, 28, 29, 30, 31                             |
| §1 (breaking) | In-memory branches and `city_objects` REMOVED, not kept                                                                                       | 18, 23                                            |
| §2            | duckdb-wasm pinned to dev64 / DuckDB 1.5.5, arrow 17                                                                                          | 1                                                 |
| §2            | Never `latest`; the city-format writers never offered as usable                                                                               | Global Constraints; 11, 29, 31                    |
| §2            | A dropped VFS name never reused                                                                                                               | 13 (counter), 29, 30                              |
| §2            | Reader schema; `id`/`feature_id` semantics                                                                                                    | 6, 12, 13, 33                                     |
| §2            | Drop `geometry_*`/`material_*`/`texture_*`/`template`                                                                                         | 5, 13                                             |
| §2            | Cell types: `to_json`, `::VARCHAR`, BigInt                                                                                                    | 5, 10, 12                                         |
| §2            | **HUGEINT / DECIMAL arrive as STRINGS → `castText`, no `toFixed`**                                                                            | 5, 22                                             |
| §2            | CityParquet write: schema, module tables, init (own statement), validate, write                                                               | 7, 11, 30                                         |
| §2            | Directory argument with NO trailing slash                                                                                                     | 30                                                |
| §2            | **A MISSING VFS name reads back as ONE garbage byte, no error → validate by content**                                                         | 29 (`validateExportBytes`), 30                    |
| §2            | `globFiles` lists never-created names → cleanup only, never discovery                                                                         | 30                                                |
| §2            | `cityparquet_write` browser-verified; table survives `dropFile`                                                                               | 13 (doc), 30, 32                                  |
| §2            | `cityparquet_read` / `cityjson_geoparquet_geo` unusable                                                                                       | Global Constraints (never called)                 |
| §2            | **`spatial` does not autoload and is CORE (`INSTALL spatial`)**                                                                               | 2 (`installStatement`), 34                        |
| §3.1          | Per-extension status, `ensureExtension`, `runQuery`, `formatDuckDBError`                                                                      | 2                                                 |
| §3.1          | `registerBuffer`/`dropBuffer`/`readFile`/`ddl`                                                                                                | 2                                                 |
| §3.1          | **Init failure terminates the Worker, then resets the memo**                                                                                  | 2                                                 |
| §3.1          | StatusBar labels + **`PRAGMA platform`** + `duckdb_extensions()` tooltip                                                                      | 2, 3                                              |
| §3.2          | `LayerTable`/`ColumnInfo` shape, `classifyColumnType`                                                                                         | 5, 13                                             |
| §3.2          | Source table (file/URL/CityGML/CityParquet/streaming)                                                                                         | 15, 16, 17                                        |
| §3.2          | `shouldUseSourceUrlPath` deleted; `loadFromUrl` returns bytes                                                                                 | 15, 18                                            |
| §3.2          | Reader-backed creation SQL, then `dropBuffer`                                                                                                 | 13                                                |
| §3.2          | **A REBUILD keeps the old table until the new one exists; a FAILED rebuild keeps it for good**                                                | 13, 14                                            |
| §3.2          | **Cancellation is a monotonic SEQUENCE, not a flag: a drop supersedes only what was enqueued before it**                                      | 13, 14                                            |
| §3.2          | **A build cancelled MID-FLIGHT publishes nothing and retires its own table; the drop re-clears the store unless a newer enqueue owns the id** | 13, 14                                            |
| §3.2          | **A build AWAITS `initDuckDB` before touching DuckDB, and a source refused for want of the engine is kept and rebuilt by `retryEngine`**      | 13, 14, 18, 23                                    |
| §3.2          | **The flat fallback ALTERs `parents`/`children` to `VARCHAR[]` — `read_json_auto` types an all-NULL column as JSON**                          | 12, 13, 33                                        |
| §3.2          | **`registerBuffer` CONSUMES its array; no needless second copy anywhere**                                                                     | 2, 13, 15, 16                                     |
| §3.2          | **`SourceProvider` returns DECODED bytes for file AND url**                                                                                   | 15 (`fetchModelBytes`, gunzip test), 16           |
| §3.2          | **A restored file layer has no provider → export refused with that reason**                                                                   | 13/16 (`provider: null`), 31 (`RELINK_REASON`)    |
| §3.2          | Flat fallback aligned to the reader's names; `featureId.ts`                                                                                   | 6, 12, 13                                         |
| §3.2          | Lifecycle: enqueue/drop, FIFO, skip-if-removed, rebuild, counter                                                                              | 13, 14, 17                                        |
| §3.2          | **Streaming debounce gated on the PANEL; the export dialog forces one rebuild**                                                               | 17 (`refreshStreamingTable`), 31                  |
| §3.2          | Failures recorded, never thrown into the loader                                                                                               | 13, 16                                            |
| §3.2          | `layerTableStore` mirror                                                                                                                      | 13                                                |
| §3.2          | App loses its DuckDB effect and flags; StatsTab on `object_type`                                                                              | 18, 19                                            |
| §3.3          | Filter AST, `LayerQuery`, `queryStore`, session-only                                                                                          | 8                                                 |
| §3.3          | `quoteIdent`/`quoteLiteral`/`compileFilter`/LIKE escaping                                                                                     | 9                                                 |
| §3.3          | `projectColumn`, `buildPageSql`, `buildCountSql`                                                                                              | 10                                                |
| §3.3          | `buildFeatureIdsSql` with COALESCE + positive IN                                                                                              | 10, 27                                            |
| §3.3          | `buildDistinctSql` — deliberately NOT built (see the gaps note); `buildRootTypesSql` added for §3.6                                           | 10                                                |
| §3.4          | `TablePanel`→`FilterBar`→`DataGrid`→`Pagination`, `useLayerQuery`                                                                             | 20, 21, 22, 23                                    |
| §3.4          | Header: Sync selection, Filter map, Export, collapse                                                                                          | 23, 31                                            |
| §3.4          | IntersectionObserver removed; 320 px default, 120–800 clamp                                                                                   | 22, 23                                            |
| §3.4          | States: engine failed+Retry, queued/building, failed, no layer, zero rows                                                                     | 20, 23                                            |
| §3.4          | **`initializing` is published BEFORE the 3.5 s boot, so the panel never offers Retry over a healthy engine**                                  | 23                                                |
| §3.4          | **A DuckDB page error / compile refusal is shown in the panel BODY, not only in the collapsed bar**                                           | 23                                                |
| §3.4          | **Values are kept RAW in the condition and coerced at compile time — a fractional threshold can be typed**                                    | 9, 21                                             |
| §3.4          | **Zero rows + Filter map on → "0 of N rows match; the map shows nothing…"**                                                                   | 22 (`emptyMessage`), 23                           |
| §3.5          | `syncToMap` → ids → `setVisibleObjectIds`; null vs empty                                                                                      | 26, 27                                            |
| §3.5          | `buildCityMeshArrays` visible-id parameter, slot invariant                                                                                    | 24                                                |
| §3.5          | `CityModelMesh.setVisibleObjectIds` + handle + registry                                                                                       | 25                                                |
| §3.5          | `Layer.visibleObjectIds` session-only; `handleSync` push                                                                                      | 26                                                |
| §3.5          | **`setVisibleObjectIds` is a no-op on identity; the sync returns early when there is nothing to clear**                                       | 26, 27                                            |
| §3.5          | **`syncFilterToMap` carries a per-layer generation: a slow earlier query cannot rebuild the geometry over a newer one**                       | 27                                                |
| §3.5          | Streaming disabled with the exact reason string                                                                                               | 23                                                |
| §3.6          | Dialog: scope, object types, attributes, LoD, format                                                                                          | 31                                                |
| §3.6          | **The chosen format is clamped to what is offered, and the attribute list re-seeds when the table changes**                                   | 31                                                |
| §3.6          | CityParquet: schema, re-register, CTAS, init, validate, write, zip, cleanup                                                                   | 30                                                |
| §3.6          | **Every file the write names must be in the zip**                                                                                             | 30                                                |
| §3.6          | **The output name is the FIRST string column of the write's result row, with a repeated dir prefix stripped**                                 | 30                                                |
| §3.6          | **The source is read ONCE into a scratch schema; N modules is not N parses**                                                                  | 11, 30                                            |
| §3.6          | **`cityparquet_validate` returns no rows — the temp table is dropped first, and a run/read failure is a VISIBLE warning**                     | 30                                                |
| §3.6          | **`dropBuffer` over a writer-created file is unverified: try/catch + warn, checked by the smoke**                                             | 30, 32                                            |
| §3.6          | `cityGmlModuleOf`                                                                                                                             | 7                                                 |
| §3.6          | Parquet/CSV/JSON via `COPY`                                                                                                                   | 29                                                |
| §3.6          | **City formats shown DISABLED with the exact title**                                                                                          | 31                                                |
| §3.6          | **Fallback layers: attribute formats only, plus the "no CityJSON source" sentence**                                                           | 31                                                |
| §3.6          | `platform/download.ts` factored from `RuleBuilderTab`                                                                                         | 28                                                |
| §3.6          | Busy state, cancel-safe `finally`, inline errors                                                                                              | 30, 31                                            |
| §3.7          | Snapshot stays v3; nothing new persisted                                                                                                      | 8, 26 (no `persistence/types.ts` change at all)   |
| §4            | Unit tests for every pure module and store                                                                                                    | 5–14, 20–22, 26–31                                |
| §4            | Plugin unit tests                                                                                                                             | 24, 25                                            |
| §4            | Opt-in Node integration behind `DUCKDB_INTEGRATION`                                                                                           | 33                                                |
| §4            | **Reader `id` set == `parseCityJSON().objects` key set**                                                                                      | 33                                                |
| §4            | Browser smoke: boot, table, filter, map sync, all four exports                                                                                | 32                                                |
| §5            | Submodule branch from `947c980`, pushed, gitlink bump                                                                                         | 24, 25, 26, 34                                    |
| §5            | Lockfile regenerated; `npm ci` verified in a fresh clone                                                                                      | 1, 34                                             |
| §5            | The seven mocking test files                                                                                                                  | 4                                                 |
| §5            | `duckdb.ts` the only importer of `@duckdb/duckdb-wasm`                                                                                        | Global Constraints; 13, 29, 30 all import from it |
| §6            | `spatial`/`three_d` loadable but with nothing to operate on in v1                                                                             | 34                                                |
| §6            | The two `three_d` traps recorded for the follow-up                                                                                            | 34                                                |

**Gaps found and closed while writing (both drafts):**

- §3.6 needs the layer's TOP-LEVEL types, and §3.3 offers only
  `buildDistinctSql`. Task 10 adds `buildRootTypesSql(table)` and DROPS
  `buildDistinctSql`: §3.3 lists it for "value suggestions" in the filter bar,
  and §3.4's bar is a plain text input with no suggestions in it — so it would
  ship as an exported, unit-tested function with no caller, which is a
  liability rather than a head start.
- §3.6's scope predicate is written with a bare `feature_id`, while §3.3
  explains why `COALESCE("feature_id","id")` is required. Task 10's
  `buildFeatureScopeWhere` uses COALESCE everywhere; Task 11's CTAS builds on it.
- §3.2 says tables are "rebuilt on restore by the same add path", but `App.tsx`
  adds layers directly in four places the loader hook never sees. Task 16's
  `addCityLayer` is that path; Task 17's lifecycle covers the removals
  `removeLayer` alone would miss and the streaming adds that have no bytes.
- §3.2's streaming-rebuild gate is invisible to `layerTables`. The panel writes
  `setTablePanelOpen` (Task 23) and the export dialog forces one rebuild through
  `refreshStreamingTable` (Task 17/31) — no "export pending" flag, because an
  export wants the table to hold STILL once it starts.
- §3.2 says a rebuild "replaces the table", which the first draft did by
  retiring the old one FIRST — dropping a streaming layer to "building" several
  times a pan, and leaving a layer that HAD working analytics with none at all
  whenever a rebuild failed. Tasks 13/14 build first and retire only on success;
  a failed rebuild keeps the previous table with `rebuilding: false` and a
  console warning.
- §3.6's per-module CTAS reads the source once PER MODULE — N full parses of a
  file that can be hundreds of megabytes. Task 11 splits it into one scratch
  read plus N cheap cuts, the scratch table in a schema of its own because
  `cityparquet_init` describes every table in the schema it is handed.
- §3.4's filter bar parses its value input as the user types, which cannot
  work: `Number("1.")` is 1, so the decimal point is deleted the instant it is
  typed and no fractional threshold can be entered at all. Task 21 keeps the
  RAW string in the condition and Task 9's `literalFor` coerces from the
  column's type at compile time, where a bad value becomes a sentence rather
  than a silently altered number.
- §3.2's cancellation reads "a layer removed while still queued is skipped",
  which the first draft implemented as a `Set`. A set also cancels builds
  enqueued AFTER the drop, and clearing it at enqueue time un-cancels a build
  the drop was meant to kill; the question is "which came first", so Tasks
  13/14 answer it with a monotonic sequence number. The spec is silent on the
  harder half — a build that has already STARTED when the drop arrives — and
  the obvious reading (let it finish, let the drop clean up) LEAKS: the build
  publishes `{state:"ready"}` after the drop's `setState(null)`, leaving an
  entry for a removed layer on the very object React subscribes to. So the
  build asks again when it settles, retires its own table and publishes
  nothing, and the drop task clears the store a second time unless a newer
  enqueue has claimed the id.
- Nothing in §3.2 says the build waits for the ENGINE, and the first draft did
  not: the queued task went straight to `registerBuffer`/`ddl`, both of which
  answer "not running" until the status is ready. The boot is ~5 s and the most
  common first layer of a session — a snapshot restored at boot, a share link,
  a file dropped on the landing page — lands inside it, so that layer's table
  failed permanently for a reason that had already stopped being true. Task 13
  awaits the (memoised, never-rejecting) `initDuckDB` before minting a table
  name, keeps the refused source in `pendingSources`, and `retryEngine()` —
  called by App on boot AND by the panel's Retry — rebuilds them. A table that
  failed on its own merits is not retried.
- §3.2's flat fallback assumes `read_json_auto` reproduces the reader's schema.
  Probed 2026-09-04: an all-NULL `parents` types as JSON, `sample_size = -1`
  and `union_by_name` do not help, and a PARTIAL `columns = {…}` drops every
  column it does not name. Tasks 12/13 add two `ALTER COLUMN … TYPE VARCHAR[]`
  statements — verified idempotent, NULL- and value-preserving — with a Task 33
  probe over the real engine.
- §3.6 reads the validation findings with `SELECT count(*) FROM
cityparquet_validation`. Probes P6b/P6c/P6f/P6g and FUNCTIONS.md show the
  PRAGMA returns no rows and materialises a temp table instead — and that when
  the pragma FAILS the table is never created, so the follow-up SELECT raises a
  `Catalog Error`. Task 30 drops the table first (it lives on the connection and
  would otherwise carry a previous export's findings), groups by `severity`, and
  turns either failure into a visible warning.
- §3.5 writes the plugin signature as `(…, hiddenTypes, visibleObjectIds)`, but
  the shipped signature carries `appearance` at position 6 and ~20 call sites
  pass it positionally. Task 24 uses position 7.
- §3.6's source read is written with `lod := '<L>'`. Probe `p8.out` shows `lod :=`
  narrows the SCHEMA, keeps every row, and raises a Binder Error for an LoD the
  file lacks — so it works, but it is redundant beside an explicit column list
  that already names one LoD's geometry pair, and the explicit projection is the
  route probed end to end (p6b/p6c/p6g). Task 11 uses the projection alone and
  records why.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `FIXME`, "implement later", "fill in", "Similar to
Task", "as in Task" and bare trailing ellipses: none. Every code step carries
real code; the canonical DuckDB mock literal is written out in full in each of
the six files that need it (Task 4) rather than cross-referenced.

The one conditional branch the first draft carried — Task 32's
`cityparquet_write` fallback — is GONE: that gate has already passed in Chrome
151, so Task 32 is now an ordinary end-to-end smoke with no branch in it.

### 3. Type consistency

Every name that crosses a task boundary, re-checked after the edits:

- `ColumnInfo` / `ColumnKind` are defined once (Task 5) and imported by `sql.ts`
  (9–11), `layerTables.ts` (13), `useLayerQuery` (20), `FilterBar` (21),
  `DataGrid` (22), `export.ts` (29) and `ExportDialog` (31).
- `DuckDBStatus.ready` now carries `extensions`, `loadedExtensions` AND
  `platform`; every literal of that shape in the plan (Task 3's `ready()`, Task
  4's two mocks, Task 23's `READY_STATUS`) carries all three.
- `SourceProvider` is nullable in the same three places it can be absent:
  `LayerTableSource["bytes"].provider`, `LayerTable.source` and
  `modelTableSource`'s `refetch` (Tasks 13, 16); `ExportDialog` reads it as
  `table.source === null` (Task 31).
- `LayerTableStoreState` is `{ tables, tablePanelOpen }` in Task 13 and in every
  test's reset literal — no `exportPending` survives anywhere.
- `validateExportBytes(name, format, bytes)` and `ExportContentFormat` /
  `ReadbackOutcome` are declared in Task 29 and used by both routes (29, 30);
  `contentFormatOf` (Task 30) feeds it.
- `refreshStreamingTable(layerId)` is declared in Task 17 and consumed by Task
  31 (and mocked there by that exact name).
- `DataGridProps.emptyMessage` (Task 22) is supplied by `emptyGridMessage`
  (Task 23).
- `ExportDialogProps` gained `isStreaming`; `TablePanel` passes
  `activeLayer.isStreaming` (Task 31).
- `QueryOutcome` / `runQuery` / `ddl` / `registerBuffer` / `dropBuffer` /
  `readFile` / `formatDuckDBError` / `ensureExtension` / `isExtensionLoaded`
  are declared in Task 2, mocked with those names in Task 4, and consumed under
  those names in 13, 19, 20, 27, 29, 30, 31.
- `FilterGroup` / `FilterCondition` / `FilterOp` / `LayerQuery` / `PageSize` /
  `PAGE_SIZES` / `isNullaryOp` / `EMPTY_FILTER` / `DEFAULT_LAYER_QUERY` come
  from Task 8 and are used unchanged in 9, 20, 21, 22, 23, 27, 31.
- `layerQuery(state, layerId)` (Task 8) is the only defaulting accessor (20, 23,
  27, 31).
- `buildFeatureScopeWhere` and `buildRootTypesSql` (Task 10) are consumed by
  Tasks 11 and 31; `AttributeExportFormat` is declared once, in `sql.ts`.
- `ExportRequest` GROWS in Task 30; Task 29 declares it as the attribute member
  alone and Task 30 replaces the alias plus the dispatcher, so no task
  references a member that does not yet exist.
- `LoadedModel` (Task 15) is consumed by `modelTableSource` (Task 16) with the
  same three fields; `fetchModelBytes` is used only by `urlSourceProvider`.
- `Layer.visibleObjectIds` / `setVisibleObjectIds` (Task 26) match
  `CityModelHandle.setVisibleObjectIds` (Task 25) and
  `LiveLayer.visibleObjectIds` (Task 26).
- `flatRowsFromModel` / `flatRowsFromRecords` / `encodeRowsAsJson` /
  `FLAT_PREFIX_COLUMNS` (Task 12) are used with those names in 13 and 31.
- `installLayerTableLifecycle` (Task 17) is called from `App.tsx` in Task 18.
- `downloadBlob` / `downloadText` (Task 28) are used in 31 and in
  `RuleBuilderTab`.
- `DEFAULT_TABLE_HEIGHT` / `MIN_TABLE_HEIGHT` / `MAX_TABLE_HEIGHT` (Task 23) are
  the only height constants; `App.tsx` imports the default.
- `LayerTableState`'s ready member carries the optional `rebuilding` in Task 13's
  interface block, in its implementation, and in Task 14's three new assertions.
  Nothing else reads it: `useLayerQuery` (Task 20) and `StatsTab` (Task 19) both
  narrow on `state === "ready"` and take `info`, which is exactly what keeps the
  grid showing real rows through a rebuild.
- `buildCityParquetCtasSql` is GONE. The two builders that replace it —
  `buildCityParquetSourceSql` and `buildCityParquetModuleSql`, plus
  `CITYPARQUET_SOURCE_TABLE` — are declared in Task 11 and consumed only by
  Task 30, whose "Consumes" line names both. No reference to the old name
  survives anywhere in the plan.
- `isGzipBytes` is declared in Task 15 and imported by `addCityLayer` (Task 16)
  and by `useLayerFileLoader` (Task 16, Step 5); `decodeModelBytes` keeps its
  signature and simply calls it.
- `validationWarnings`, `dropWrittenFile` and `contentFormatOf` are file-local
  to `analytics/export.ts` (Task 30) and never exported.
- The "`registerBuffer` CONSUMES its array" contract is stated once, on the
  function (Task 2), and REFERENCED — not restated differently — on
  `LayerTableSource.bytes` and `SourceProvider` (Task 13), `modelTableSource`
  and both providers (Task 16), and `loadFromUrl`'s `bytes` field (Task 15).
- `pendingSources` and `ENGINE_NOT_RUNNING` are module state in
  `analytics/layerTables.ts` (Task 13); `retryEngine()` is its only reader,
  `dropLayerTable` (Task 14) its only other writer, and
  `resetLayerTablesForTest` clears it. `retryEngine` is exported in Task 13's
  Interfaces block and called from `App.tsx` in exactly two places — the mount
  effect (Task 18) and `handleRetryDuckDB` (Task 23) — which are also the two
  places `initDuckDB` used to be called from directly.
- `duckdbLabel` / `duckdbTooltip` / `duckdbDotClass` move to
  `src/ui/duckdbStatusText.ts` in Task 18; Task 3 introduces them in
  `StatusBar.tsx` and its test's import is updated in the same step that moves
  them, so no task references the old location afterwards.
- `cancelBefore` / `lastEnqueueSeq` / `seqCounter` replace the old `cancelled`
  Set outright: no reference to a cancellation Set survives in Task 13's
  implementation, Task 14's `dropLayerTable`, `resetLayerTablesForTest` or
  either test file. `superseded()` is asked TWICE in the build task — before
  its first await and after the build settles — `lastEnqueueSeq` is read only
  by the drop task, and all three maps are cleared by
  `resetLayerTablesForTest`.
- `isValueList`, `literalFor` and `NUMERIC_TYPES` are file-local to
  `analytics/sql.ts` (Task 9); `FilterValue` is imported there for the first.
  Task 21's `parseValue(raw, op)` dropped its `column` parameter, and its one
  caller passes two arguments.
- `buildDistinctSql` no longer exists anywhere: not in Task 10's Interfaces,
  its implementation, its test, the File Structure, or §3.3's builder list —
  the coverage table records it as deliberately absent.
- `writtenFileName(row, outDir)` is file-local to `analytics/export.ts` (Task 30) and is the ONLY place an output name is derived; nothing reads `row.file`
  by name any more.
- `resetExportCounterForTests` is declared in Task 29's Interfaces and called
  in BOTH export suites' `beforeEach` (Tasks 29 and 30).
- `DataGrid` is a `React.memo` component: Task 22's Interfaces block says so,
  `TablePanel` memoises `selectedIds` to match (Task 23), and both test files
  render it as an ordinary element, which `memo` does not change.
- `rawCellTitle` (Task 22) is exported beside `formatCell` and used only by
  `DataGrid`'s `<td title>`.
- `Harness` gains `registerBytes` (Task 33); the flat-fallback probe is its one
  caller, and the harness is imported DYNAMICALLY inside `beforeAll`.
- `formatCount` is declared once, in `Pagination.tsx` (Task 22), and imported by
  `TablePanel` (Task 23). No `toLocaleString()` call survives in either.
- `setVisibleObjectIds: vi.fn()` reaches the two PRE-EXISTING fake handles
  (Task 26, Step 4b) as well as the new suite's — the first push is
  unconditional, so every static-path test needs it.

No mismatches remain.
