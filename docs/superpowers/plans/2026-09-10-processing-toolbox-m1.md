# Processing Toolbox — Milestone 1 (M13.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec acceptance scenario 1 end to end: a Tools button in the map header, a Tools tab in the right panel with the catalogue, the shared tool form, the single-flight run lifecycle (queued, running, done, failed, cancelled, log, Recent runs, Undo), computed columns written to the DuckDB table AND the in-memory model with provenance badges in the table, Details and rules, and **Height from extent** as the one working tool.

**Architecture:** A new `src/features/processing/` feature (Zustand store for panel state and run history, a tool registry with pure eligibility rules, a single-flight run queue that executes tool executors against the layer's DuckDB table) plus `src/ui/processing/` (Tools button, right-panel Tools tab with catalogue, tool form, run states, log). Computed columns are written by `insights/computedColumns.ts` (SQL against the layer table, a per-run backup table for Undo) and merged into the layer's `CityModel` through a new `layerStore.mergeAttributes` action; the plugin gets a `setModel` seam so rules recolour without rebuilding geometry.

**Tech Stack:** React 19, Zustand, DuckDB-wasm through `src/insights/duckdb.ts` only, Vitest + @testing-library/react (jsdom), plugin submodule `@cityjson/navara-cityjson` (pnpm).

**Spec:** `docs/superpowers/specs/2026-09-10-processing-toolbox-design.md` (§4, §5, §6, §7 common rules, §7.4, §8, §10 scenario 1). Read it before any task.

## Global Constraints

- Never run bare `vite`/`vp dev`; use `npm run dev`, `npm run build`, `npx vp check`, `npx vitest run`, `npx tsc -b --noEmit`.
- `src/insights/duckdb.ts` is the ONLY importer of `@duckdb/duckdb-wasm`. Every NEW export from `duckdb.ts` must be added to every `vi.mock(".../insights/duckdb", ...)` factory (18 files, listed in Task 7). This milestone adds none, so nothing to do unless a task says otherwise.
- ONE writer of the DuckDB status (`App` state, value owned by `duckdb.ts`). This milestone does not load extensions.
- Test files import from `"vitest"`, never `"vite-plus/test"`.
- Submodule-first: commit inside `packages/cityjson-navara-plugins` first, push it (`git -C packages/cityjson-navara-plugins push origin main`), then commit the pointer bump in the parent. Always `cd` into the submodule for pnpm; never `pnpm -C`.
- Commits: small, prefixed `feat:` / `fix:` / `test:` / `docs:` / `refactor:`; commit directly on `develop`. No attribution trailers.
- UI: Soft Utility tokens from `src/app/flatControls.css` (`--control-radius` 8px, `--control-height` 38px, `--control-height-compact` 30px). Reuse `ActionIcon`. Verify new controls against peers in the browser.
- Copy: every user-visible string comes from the spec verbatim (§5 reasons, §6 labels, §6.2 card, §7.4 outputs).
- Features, not rows (spec §7): a BuildingPart never counts as a building; roll-ups are per feature (`COALESCE("feature_id","id")`).
- Nothing new is persisted (snapshot schema v4 untouched).
- Pre-commit hook runs `vp staged`; pre-push runs `vp check`, `tsc -b --noEmit`, `vp test run`. Do not bypass hooks.

## Facts about the current code (verified 2026-09-10)

- Active layer: `src/features/workspace/workspaceStore.ts` holds `activeLayerId: string | null` and `setActiveLayerId`. `src/features/workspace/activeLayer.ts` exports `type ActiveLayer = { kind: "city"; layer: Layer } | { kind: "geo"; layer: GeoLayer }`, `resolveActiveLayer(activeLayerId, layers, geoLayers)` and the hook `useActiveLayer(): ActiveLayer | null`. Activation goes through `activateLayer(id)` in `src/features/workspace/layerCoordination.ts`.
- `src/features/layers/layerPresentation.ts`: `type LayerKind = "city" | "streaming" | "vector" | "raster" | "tiles"`, `layerKindOf(item: ActiveLayer): LayerKind`. `CityModel.sourceEncoding` is `"cityjson" | "cityjsonseq" | "flatcitybuf" | "citygml" | "cityparquet"`.
- `src/features/layers/layerStore.ts`: `Layer` has `id, name, model: CityModel, visible, rules, colorBy, selectedLod, availableLods, isStreaming, hiddenTypes, visibleObjectIds, ...`; store state `{ layers: ReadonlyArray<Layer> }`; actions include `updateLayer(id, patch)`, `setVisibleObjectIds`, `addRule`.
- `src/insights/layerTables.ts`: `useLayerTableStore` state `{ tables: Record<layerId, LayerTableState>, tablePanelOpen }`; `LayerTableState = {state:"queued"} | {state:"building"} | {state:"ready"; info: LayerTable; rebuilding?: boolean} | {state:"failed"; message}`; `LayerTable = { table: string; sourceName; source: SourceProvider | null; reader: "read_cityjson" | "read_cityjsonseq" | null; columns: ReadonlyArray<ColumnInfo>; lods: ReadonlyArray<LodColumn>; rowCount: number | null }`; `getLayerTable(layerId): LayerTable | null`. The module has ONE async FIFO used for CREATE/REPLACE (`enqueue` helper around lines 180–320).
- `src/insights/duckdb.ts`: `runQuery(sql): Promise<QueryOutcome>` with `QueryOutcome = { ok: true; columns: string[]; rows: Record<string, unknown>[] } | { ok: false; message: string }`; `ddl(sql)` same shape; `registerBuffer(name, bytes): Promise<boolean>` (consumes the bytes); `dropBuffer(name)`; `getDuckDBStatus()`; `isExtensionLoaded(name)`.
- `src/insights/sql.ts`: `quoteIdent(name)`, `quoteLiteral(value)`, `buildFeatureIdsSql(table, where)`, `buildCountSql(table, where)`, `compileFilter(group, columns)`. `src/insights/layerRows.ts` builds the flat fallback rows (`id, feature_id, object_type, parents, children` + attributes) loaded via `read_json_auto`.
- Selection: `src/features/selection/selectionStore.ts` state `{ mode, toolMode, selections: ReadonlyArray<Selection>, hovered, geoSelection }`, `Selection = { kind: "object"; layerId; objectId } | { kind: "surface"; layerId; objectId; surfaceIndex }`.
- Query: `src/features/query/queryStore.ts` `layerQuery(state, layerId): LayerQuery` with `applied: FilterGroup | null`. Counts: `src/ui/table/useLayerCounts.ts` `useLayerCounts(layerId): { all, matching, selected, loading, message }` (numbers or null).
- Shell: `src/ui/shell/shellStore.ts` (`rightCollapsed`, `setRightCollapsed`, `openDrawer`, `requestSection(layerId, "style" | "filter" | "details")`). `src/ui/shell/ViewerShell.tsx` props `right: ReactNode | null` (null = no right column) and `rightTitle: string`; the collapsed pill is `<button className="details-pill">Details · {rightTitle}</button>`.
- App: `src/app/App.tsx` builds the map tool header at lines ~2197–2227 (`<div className="map-tool-header">` → `<div className="map-tool-header__editing">` holding `<SelectModeControl …/>` then `<AddressSearch …/>`, then `<SceneButtons …/>`), and the right panel at ~2241–2246 (`right={selections.length > 0 || geoSelection !== null ? <DetailsPanel onClose={clearSelection}/> : null}`, `rightTitle={selectionTitle(...)}`). The single toast is `useState<string | null>` at App.tsx ~282 with `toastTimerRef`; find its setter (search `setToast(`) and reuse it.
- Icons: `src/ui/ActionIcon.tsx` has a `name` union (`"draw" | "camera" | "table" | "addLayer" | "feature" | "surface" | "filter" | "columns" | "export" | "expand" | "restore" | "clear"`) and a `paths` record of 24×24 stroke paths.
- CSS: `.map-tool-header`, `.map-tool-header__editing`, `.map-mode-control` live in `src/app/flatControls.css` (lines ~520–592). `body button` has no min-height; compact fields are `var(--control-height-compact)`. Pressed look: `button[aria-pressed="true"]` gets `--control-selected`. Details panel classes: `.details-panel`, `.details-header`, `.details-body`, `.details-section`, `.details-section-title` (app.css ~6180–6240). Tab idiom: `.data-drawer-tabs` / `.data-drawer-tab[aria-selected="true"]` in `src/ui/drawer/drawer.css`.
- Tests: jsdom, `tests/unit/**`, `@testing-library/react` with `afterEach(cleanup)`. Store test pattern: `tests/unit/features/drawing/drawStore.test.ts`. Component test pattern: `tests/unit/ui/MapModeControl.test.tsx`.
- Escape: `src/features/selection/useEscapeClearsSelection.ts` closes a scene sheet first, then clears the selection.
- Plugin: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelMesh.ts` `CityModelMesh` keeps `this.model` from construction and `repaint()` reads `this.model.objects[objectId]` for rule evaluation; `CityModelHandle` (in `types.ts` of the same package) is built in `cityModelRegistry.ts` lines ~160–175 by delegating to the mesh. The app's `LiveLayer` and `syncLayers` are in `src/scene/handleSync.ts`.
- `ComputedAttributeBadge` (`src/ui/table/ComputedAttributeBadge.tsx`) is a no-prop badge already used by `DataGrid.tsx` and `ColumnsPanel.tsx` for the synthetic columns.

## File map

Create:

- `src/features/processing/types.ts` — tool and run types.
- `src/features/processing/toolRegistry.ts` — the seven tool definitions (only `height-from-extent` implemented in M1).
- `src/features/processing/eligibility.ts` — pure eligibility with the spec's reasons.
- `src/features/processing/processingStore.ts` — panel state, drafts, runs, notices.
- `src/features/processing/scope.ts` — resolve a scope to frozen feature ids.
- `src/features/processing/runQueue.ts` — single-flight execution, phases, cancel, publication, undo.
- `src/features/processing/tools/heightFromExtent.ts` — the tool executor.
- `src/insights/computedColumns.ts` — write-back SQL and the computed-column registry store.
- `src/ui/processing/ToolsButton.tsx`, `ProcessingPanel.tsx`, `CatalogueView.tsx`, `ToolView.tsx`, `RunFooter.tsx`, `RecentRuns.tsx`, `LogView.tsx`, `processing.css`.
- Tests under `tests/unit/features/processing/`, `tests/unit/insights/computedColumns.test.ts`, `tests/unit/ui/processing/`.

Modify:

- `src/ui/ActionIcon.tsx` (add `tools`), `src/app/App.tsx` (button, right panel, toast, Escape), `src/features/selection/useEscapeClearsSelection.ts`, `src/ui/shell/ViewerShell.tsx` (Tools pill), `src/insights/layerRows.ts` (bbox), `src/insights/layerTables.ts` (`runOnTableQueue`), `src/features/layers/layerStore.ts` (`mergeAttributes`), `src/scene/handleSync.ts` (push model), `src/ui/table/DataGrid.tsx` (badge on computed columns), `src/ui/details/LayerAttributesSection.tsx` (COMPUTED group), `docs/architecture-notes.md`.
- Submodule: `navara-cityjson/src/types.ts`, `cityModelMesh.ts`, `cityModelRegistry.ts` (`setModel`).

---

### Task 1: Types, tool registry and eligibility (pure)

**Files:**

- Create: `src/features/processing/types.ts`, `src/features/processing/toolRegistry.ts`, `src/features/processing/eligibility.ts`
- Test: `tests/unit/features/processing/eligibility.test.ts`

**Interfaces:**

- Produces: `ToolId`, `ToolDefinition`, `TOOLS`, `toolById(id)`, `Scope`, `RunRecord`, `RunStatus`, `RunPhase`, `LogEntry`, `RunSummary`, `SkipCount`, `Eligibility`, `toolEligibility(tool, ctx)`.

- [ ] **Step 1: Write the types**

`src/features/processing/types.ts`:

```ts
/**
 * Processing toolbox vocabulary (spec §3). Engine-free: nothing here imports
 * DuckDB, Navara or React.
 */
export type ToolGroup = "roof" | "3d" | "cross-layer";

export type ToolId =
  | "roof-metrics"
  | "measure-solids"
  | "validate-solids"
  | "height-from-extent"
  | "join-by-location"
  | "aggregate-per-area"
  | "distance-to-nearest";

export type ToolExtension = "spatial" | "three_d";

export interface ToolDefinition {
  readonly id: ToolId;
  readonly name: string;
  readonly group: ToolGroup;
  /** One line under the name in the catalogue. */
  readonly description: string;
  /** Longer sentence at the top of the tool view. */
  readonly longDescription: string;
  /** Extension the run needs, or null. */
  readonly extension: ToolExtension | null;
  /** Needs a CityJSON / CityJSONSeq source to re-read geometry. */
  readonly needsReader: boolean;
  /** Which kind of layer the run WRITES to. */
  readonly target: "city" | "vector";
  /** Needs a second, vector layer as the source. */
  readonly needsVectorSource: boolean;
  readonly defaultPrefix: string;
  /** False until a later milestone ships the executor. */
  readonly implemented: boolean;
}

export type Scope = "all" | "matching" | "selected";

export type RunPhase = "extension" | "source" | "compute" | "write";

export type RunStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "done"
  | "failed"
  | "cancelled";

export interface LogEntry {
  readonly label: string;
  readonly sql: string | null;
  readonly ms: number;
  readonly rows: number | null;
}

export interface SkipCount {
  readonly cause: string;
  readonly count: number;
}

export interface RunSummary {
  /** First line of the result card, e.g. "2 buildings measured · 2.4 s". */
  readonly line: string;
  /** Second muted line, or null. */
  readonly detail: string | null;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

export interface RunRecord {
  readonly id: string;
  readonly toolId: ToolId;
  readonly targetLayerId: string;
  readonly targetName: string;
  readonly sourceLayerId: string | null;
  readonly sourceName: string | null;
  readonly scope: Scope;
  /** Frozen at Run: the number of FEATURES the scope names. */
  readonly scopeCount: number;
  /** Frozen feature ids, or null for "all". */
  readonly featureIds: ReadonlyArray<string> | null;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  /** Resolved output column names, in the tool's order. */
  readonly columns: ReadonlyArray<string>;
  readonly status: RunStatus;
  readonly phase: RunPhase | null;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly summary: RunSummary | null;
  readonly error: string | null;
  readonly log: ReadonlyArray<LogEntry>;
  readonly warnings: ReadonlyArray<string>;
  /** Undo still restores the layer to its pre-run state. */
  readonly undoable: boolean;
  /** The layer's table was rebuilt after the run (spec §7). */
  readonly stale: boolean;
  /** Set when the run finished before the cancel arrived (spec §6.1). */
  readonly note: string | null;
}

export type Eligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };
```

- [ ] **Step 2: Write the registry**

`src/features/processing/toolRegistry.ts`:

```ts
import type { ToolDefinition, ToolId } from "./types";

/** Spec §5 catalogue, in display order. Names and descriptions verbatim. */
export const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    id: "roof-metrics",
    name: "Roof metrics to attributes",
    group: "roof",
    description: "Roof area, slope, azimuth per building",
    longDescription:
      "Writes the roof metrics Roofy already computes as attributes of each building.",
    extension: null,
    needsReader: false,
    target: "city",
    needsVectorSource: false,
    defaultPrefix: "roof_",
    implemented: false,
  },
  {
    id: "measure-solids",
    name: "Measure solids",
    group: "3d",
    description: "Volume, envelope, footprint, height",
    longDescription:
      "Volume, envelope area, footprint area and height of each building's solid.",
    extension: "three_d",
    needsReader: true,
    target: "city",
    needsVectorSource: false,
    defaultPrefix: "solid_",
    implemented: false,
  },
  {
    id: "validate-solids",
    name: "Validate solids",
    group: "3d",
    description: "Closed, manifold, oriented, report",
    longDescription:
      "Checks whether each building's solid is closed, manifold and oriented, with the counts behind the verdict.",
    extension: "three_d",
    needsReader: true,
    target: "city",
    needsVectorSource: false,
    defaultPrefix: "solid_",
    implemented: false,
  },
  {
    id: "height-from-extent",
    name: "Height from extent",
    group: "3d",
    description: "Vertical extent from the bounding box",
    longDescription:
      "The vertical extent of each building's geometry (highest minus lowest coordinate), across all LoDs in the file. Includes chimneys and antennas; not a roof or terrain height.",
    extension: null,
    needsReader: false,
    target: "city",
    needsVectorSource: false,
    defaultPrefix: "extent_",
    implemented: true,
  },
  {
    id: "join-by-location",
    name: "Join attributes by location",
    group: "cross-layer",
    description: "Copy area attributes onto the buildings inside them",
    longDescription:
      "Copies attributes of the vector feature each building falls in (zoning, district, noise band, flood zone) onto the building.",
    extension: "spatial",
    needsReader: false,
    target: "city",
    needsVectorSource: true,
    defaultPrefix: "",
    implemented: false,
  },
  {
    id: "aggregate-per-area",
    name: "Aggregate buildings per area",
    group: "cross-layer",
    description: "Count and summarise buildings inside each area",
    longDescription:
      "Summarises the buildings inside each vector feature: count, and sums or means of a numeric column.",
    extension: "spatial",
    needsReader: false,
    target: "vector",
    needsVectorSource: false,
    defaultPrefix: "bld_",
    implemented: false,
  },
  {
    id: "distance-to-nearest",
    name: "Distance to nearest",
    group: "cross-layer",
    description: "Distance from each building to the nearest feature",
    longDescription:
      "The 2D distance from each building to the nearest feature of a vector layer, with the feature's id.",
    extension: "spatial",
    needsReader: false,
    target: "city",
    needsVectorSource: true,
    defaultPrefix: "",
    implemented: false,
  },
];

export const GROUP_LABELS: Readonly<Record<ToolDefinition["group"], string>> = {
  roof: "ROOF",
  "3d": "3D MEASUREMENTS",
  "cross-layer": "CROSS-LAYER",
};

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

/** Search filter (spec §5): name or description, case-insensitive. */
export function filterTools(
  tools: ReadonlyArray<ToolDefinition>,
  query: string,
): ReadonlyArray<ToolDefinition> {
  const q = query.trim().toLowerCase();
  if (q === "") return tools;
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q),
  );
}
```

- [ ] **Step 3: Write the failing eligibility test**

`tests/unit/features/processing/eligibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  toolEligibility,
  type EligibilityContext,
} from "../../../../src/features/processing/eligibility";
import { toolById } from "../../../../src/features/processing/toolRegistry";

const base: EligibilityContext = {
  targetKind: "city",
  sourceEncoding: "cityjsonseq",
  hasReader: true,
  sourceAvailable: true,
  tableState: "ready",
  engineState: "ready",
  hasVectorLayer: true,
  extensionState: { spatial: "loaded", three_d: "loaded" },
};

describe("toolEligibility", () => {
  it("accepts an implemented tool on a ready city layer", () => {
    expect(toolEligibility(toolById("height-from-extent"), base)).toEqual({
      ok: true,
    });
  });

  it("rejects an unimplemented tool with the release note", () => {
    expect(toolEligibility(toolById("measure-solids"), base)).toEqual({
      ok: false,
      reason: "Not available yet",
    });
  });

  it("needs a city model layer for roof and 3D tools", () => {
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        targetKind: "vector",
      }),
    ).toEqual({ ok: false, reason: "Needs a city model layer" });
  });

  it("names the encoding when a reader is missing", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        hasReader: false,
        sourceEncoding: "citygml",
      }),
    ).toEqual({
      ok: false,
      reason:
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityGML",
    });
    expect(
      toolEligibility(tool, {
        ...base,
        hasReader: false,
        sourceEncoding: "flatcitybuf",
        targetKind: "streaming",
      }).ok,
    ).toBe(false);
  });

  it("reports an unavailable restored file", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(toolEligibility(tool, { ...base, sourceAvailable: false })).toEqual({
      ok: false,
      reason: "The source file is no longer available; add the layer again",
    });
  });

  it("asks for a vector layer for cross-layer tools", () => {
    const tool = { ...toolById("join-by-location"), implemented: true };
    expect(toolEligibility(tool, { ...base, hasVectorLayer: false })).toEqual({
      ok: false,
      reason: "Add a vector layer to join with",
    });
  });

  it("reports the engine and the table", () => {
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        engineState: "failed",
      }),
    ).toEqual({
      ok: false,
      reason: "Not available while DuckDB is unavailable",
    });
    expect(
      toolEligibility(toolById("height-from-extent"), {
        ...base,
        tableState: "failed",
      }),
    ).toEqual({ ok: false, reason: "This layer's table could not be built" });
  });

  it("reports a missing extension download", () => {
    const tool = { ...toolById("join-by-location"), implemented: true };
    expect(
      toolEligibility(tool, {
        ...base,
        extensionState: { spatial: "failed", three_d: "loaded" },
      }),
    ).toEqual({
      ok: false,
      reason:
        "The spatial extension could not be downloaded; check the connection and retry",
    });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/unit/features/processing/eligibility.test.ts`
Expected: FAIL (module `eligibility` not found).

- [ ] **Step 5: Implement eligibility**

`src/features/processing/eligibility.ts`:

```ts
import type { Eligibility, ToolDefinition } from "./types";

export type EncodingName =
  | "cityjson"
  | "cityjsonseq"
  | "flatcitybuf"
  | "citygml"
  | "cityparquet";

export interface EligibilityContext {
  /** `layerKindOf` of the target, or "none" when no layer is active. */
  readonly targetKind:
    | "city"
    | "streaming"
    | "vector"
    | "raster"
    | "tiles"
    | "none";
  readonly sourceEncoding: EncodingName | null;
  readonly hasReader: boolean;
  /** False for a restored dropped-file layer (no source provider). */
  readonly sourceAvailable: boolean;
  readonly tableState: "queued" | "building" | "ready" | "failed" | "none";
  readonly engineState: "uninitialized" | "initializing" | "ready" | "failed";
  readonly hasVectorLayer: boolean;
  readonly extensionState: Readonly<
    Record<"spatial" | "three_d", "unloaded" | "loading" | "loaded" | "failed">
  >;
}

const ENCODING_LABEL: Readonly<Record<EncodingName, string>> = {
  cityjson: "CityJSON",
  cityjsonseq: "CityJSONSeq",
  flatcitybuf: "a streaming FlatCityBuf",
  citygml: "CityGML",
  cityparquet: "CityParquet",
};

/** Spec §5: the disabled-row reasons, in priority order. Pure. */
export function toolEligibility(
  tool: ToolDefinition,
  ctx: EligibilityContext,
): Eligibility {
  if (!tool.implemented) return { ok: false, reason: "Not available yet" };
  if (ctx.engineState === "failed") {
    return { ok: false, reason: "Not available while DuckDB is unavailable" };
  }
  if (tool.target === "city") {
    if (ctx.targetKind !== "city" && ctx.targetKind !== "streaming") {
      return { ok: false, reason: "Needs a city model layer" };
    }
  } else if (ctx.targetKind !== "vector") {
    return { ok: false, reason: "Needs a vector layer" };
  }
  if (tool.needsReader && !ctx.hasReader) {
    const label = ctx.sourceEncoding
      ? ENCODING_LABEL[ctx.sourceEncoding]
      : "an unknown source";
    return {
      ok: false,
      reason: `Needs a CityJSON or CityJSONSeq source; this layer was loaded from ${label}`,
    };
  }
  if (tool.needsReader && !ctx.sourceAvailable) {
    return {
      ok: false,
      reason: "The source file is no longer available; add the layer again",
    };
  }
  if (tool.needsVectorSource && !ctx.hasVectorLayer) {
    return { ok: false, reason: "Add a vector layer to join with" };
  }
  if (
    tool.extension !== null &&
    ctx.extensionState[tool.extension] === "failed"
  ) {
    return {
      ok: false,
      reason: `The ${tool.extension} extension could not be downloaded; check the connection and retry`,
    };
  }
  if (ctx.tableState === "failed") {
    return { ok: false, reason: "This layer's table could not be built" };
  }
  return { ok: true };
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run tests/unit/features/processing/eligibility.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/types.ts src/features/processing/toolRegistry.ts src/features/processing/eligibility.ts tests/unit/features/processing/eligibility.test.ts
git commit -m "feat(processing): tool registry, run types and eligibility rules"
```

---

### Task 2: processingStore (panel state, drafts, runs, notices)

**Files:**

- Create: `src/features/processing/processingStore.ts`
- Test: `tests/unit/features/processing/processingStore.test.ts`

**Interfaces:**

- Consumes: `RunRecord`, `ToolId`, `Scope` from Task 1.
- Produces: `useProcessingStore` with state `{ open, view, search, drafts, runs, notice, noticeSeq }` and actions listed below. Later tasks call `getState().upsertRun(run)`, `patchRun(id, patch)`, `pushNotice(text)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/features/processing/processingStore.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../../../src/features/processing/processingStore";
import type { RunRecord } from "../../../../src/features/processing/types";

function run(id: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    toolId: "height-from-extent",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m"],
    status: "queued",
    phase: null,
    startedAt: 0,
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
    ...patch,
  };
}

afterEach(() => useProcessingStore.getState().resetForTest());

describe("processingStore", () => {
  it("opens on the catalogue and toggles closed", () => {
    const s = useProcessingStore.getState();
    expect(s.open).toBe(false);
    s.setOpen(true);
    expect(useProcessingStore.getState().view).toEqual({ kind: "catalogue" });
    useProcessingStore.getState().toggle();
    expect(useProcessingStore.getState().open).toBe(false);
  });

  it("keeps a draft per tool and restores it on return", () => {
    const s = useProcessingStore.getState();
    s.openTool("height-from-extent");
    const draft: ToolDraft = {
      targetLayerId: "L1",
      scope: "selected",
      lod: null,
      prefix: "h_",
      params: {},
    };
    s.setDraft("height-from-extent", draft);
    s.back();
    expect(useProcessingStore.getState().view).toEqual({ kind: "catalogue" });
    s.openTool("height-from-extent");
    expect(useProcessingStore.getState().drafts["height-from-extent"]).toEqual(
      draft,
    );
  });

  it("keeps runs newest first, capped at 20", () => {
    const s = useProcessingStore.getState();
    for (let i = 0; i < 22; i += 1) s.upsertRun(run(`r${i}`));
    const runs = useProcessingStore.getState().runs;
    expect(runs).toHaveLength(20);
    expect(runs[0].id).toBe("r21");
    s.patchRun("r21", { status: "done" });
    expect(useProcessingStore.getState().runs[0].status).toBe("done");
  });

  it("counts unseen failures until the panel opens", () => {
    const s = useProcessingStore.getState();
    s.upsertRun(run("r1", { status: "failed", error: "boom" }));
    expect(useProcessingStore.getState().unseenFailure).toBe(true);
    s.setOpen(true);
    expect(useProcessingStore.getState().unseenFailure).toBe(false);
  });

  it("publishes a notice with a sequence number", () => {
    const s = useProcessingStore.getState();
    s.pushNotice("done");
    const { notice, noticeSeq } = useProcessingStore.getState();
    expect(notice).toBe("done");
    expect(noticeSeq).toBe(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/features/processing/processingStore.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

`src/features/processing/processingStore.ts`:

```ts
import { create } from "zustand";
import type { RunRecord, Scope, ToolId } from "./types";

export type ProcessingView =
  | { readonly kind: "catalogue" }
  | { readonly kind: "tool"; readonly toolId: ToolId }
  | {
      readonly kind: "log";
      readonly runId: string;
      readonly from: ProcessingView;
    };

/** The form's draft (spec §6: kept per tool for the session). */
export interface ToolDraft {
  readonly targetLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const MAX_RUNS = 20;

interface ProcessingState {
  readonly open: boolean;
  readonly view: ProcessingView;
  readonly search: string;
  readonly drafts: Readonly<Partial<Record<ToolId, ToolDraft>>>;
  /** Newest first. */
  readonly runs: ReadonlyArray<RunRecord>;
  /** A failed run the user has not looked at yet (spec §4.1 amber dot). */
  readonly unseenFailure: boolean;
  /** One-line toast text; `noticeSeq` increments so App can subscribe. */
  readonly notice: string | null;
  readonly noticeSeq: number;
}

interface ProcessingActions {
  setOpen(open: boolean): void;
  toggle(): void;
  openTool(toolId: ToolId): void;
  openLog(runId: string): void;
  back(): void;
  setSearch(search: string): void;
  setDraft(toolId: ToolId, draft: ToolDraft): void;
  upsertRun(run: RunRecord): void;
  patchRun(id: string, patch: Partial<RunRecord>): void;
  pushNotice(text: string): void;
  resetForTest(): void;
}

const initial: ProcessingState = {
  open: false,
  view: { kind: "catalogue" },
  search: "",
  drafts: {},
  runs: [],
  unseenFailure: false,
  notice: null,
  noticeSeq: 0,
};

export const useProcessingStore = create<ProcessingState & ProcessingActions>(
  (set, get) => ({
    ...initial,
    setOpen: (open) =>
      set((s) => ({
        open,
        view: open ? s.view : { kind: "catalogue" },
        unseenFailure: open ? false : s.unseenFailure,
      })),
    toggle: () => get().setOpen(!get().open),
    openTool: (toolId) => set({ open: true, view: { kind: "tool", toolId } }),
    openLog: (runId) =>
      set((s) => ({ open: true, view: { kind: "log", runId, from: s.view } })),
    back: () =>
      set((s) =>
        s.view.kind === "log"
          ? { view: s.view.from }
          : { view: { kind: "catalogue" } },
      ),
    setSearch: (search) => set({ search }),
    setDraft: (toolId, draft) =>
      set((s) => ({ drafts: { ...s.drafts, [toolId]: draft } })),
    upsertRun: (run) =>
      set((s) => {
        const rest = s.runs.filter((r) => r.id !== run.id);
        return {
          runs: [run, ...rest].slice(0, MAX_RUNS),
          unseenFailure:
            s.unseenFailure || (run.status === "failed" && !s.open),
        };
      }),
    patchRun: (id, patch) =>
      set((s) => ({
        runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        unseenFailure:
          s.unseenFailure || (patch.status === "failed" && !s.open),
      })),
    pushNotice: (text) =>
      set((s) => ({ notice: text, noticeSeq: s.noticeSeq + 1 })),
    resetForTest: () => set({ ...initial }),
  }),
);

export function runById(id: string): RunRecord | null {
  return useProcessingStore.getState().runs.find((r) => r.id === id) ?? null;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/unit/features/processing/processingStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/processingStore.ts tests/unit/features/processing/processingStore.test.ts
git commit -m "feat(processing): panel, draft and run history store"
```

---

### Task 3: Tools button in the map header

**Files:**

- Modify: `src/ui/ActionIcon.tsx` (add `"tools"`), `src/app/App.tsx` (map tool header), `src/app/flatControls.css`
- Create: `src/ui/processing/ToolsButton.tsx`, `src/ui/processing/processing.css`
- Test: `tests/unit/ui/processing/ToolsButton.test.tsx`

**Interfaces:**

- Consumes: `useProcessingStore` (Task 2).
- Produces: `<ToolsButton />` (no props).

- [ ] **Step 1: Add the icon**

In `src/ui/ActionIcon.tsx` add `| "tools"` to the name union and this entry to `paths`:

```ts
  tools:
    "M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2.1 2.1 0 0 1-3-3l8.4-8.4ZM14.7 6.3 17.5 3.5m2.2 7.8 2.8-2.8",
```

- [ ] **Step 2: Write the failing test**

`tests/unit/ui/processing/ToolsButton.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolsButton } from "../../../../src/ui/processing/ToolsButton";
import { useProcessingStore } from "../../../../src/features/processing/processingStore";

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
});

describe("ToolsButton", () => {
  it("toggles the toolbox and reflects it as pressed", () => {
    render(<ToolsButton />);
    const button = screen.getByRole("button", { name: "Tools" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(useProcessingStore.getState().open).toBe(true);
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a lime dot while a run is queued or running and amber for an unseen failure", () => {
    const { rerender } = render(<ToolsButton />);
    expect(screen.queryByTestId("tools-activity")).toBeNull();
    useProcessingStore.setState({
      runs: [
        {
          id: "r1",
          toolId: "height-from-extent",
          targetLayerId: "L1",
          targetName: "Delft",
          sourceLayerId: null,
          sourceName: null,
          scope: "all",
          scopeCount: 1,
          featureIds: null,
          lod: null,
          params: {},
          prefix: "extent_",
          columns: [],
          status: "running",
          phase: "compute",
          startedAt: 0,
          elapsedMs: 0,
          summary: null,
          error: null,
          log: [],
          warnings: [],
          undoable: false,
          stale: false,
          note: null,
        },
      ],
    });
    rerender(<ToolsButton />);
    expect(screen.getByTestId("tools-activity")).toHaveAttribute(
      "data-tone",
      "running",
    );
    useProcessingStore.setState({ runs: [], unseenFailure: true });
    rerender(<ToolsButton />);
    expect(screen.getByTestId("tools-activity")).toHaveAttribute(
      "data-tone",
      "failed",
    );
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run tests/unit/ui/processing/ToolsButton.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the button and its CSS**

`src/ui/processing/ToolsButton.tsx`:

```tsx
import { ActionIcon } from "../ActionIcon";
import { useProcessingStore } from "../../features/processing/processingStore";
import "./processing.css";

/** Spec §4.1: the scene toolbar's entry point. */
export function ToolsButton() {
  const open = useProcessingStore((s) => s.open);
  const active = useProcessingStore((s) =>
    s.runs.some(
      (r) =>
        r.status === "queued" ||
        r.status === "running" ||
        r.status === "cancelling",
    ),
  );
  const unseenFailure = useProcessingStore((s) => s.unseenFailure);
  const tone = active ? "running" : unseenFailure ? "failed" : null;
  return (
    <button
      type="button"
      className="tools-button"
      aria-pressed={open}
      aria-label="Tools"
      title="Tools"
      onClick={() => useProcessingStore.getState().toggle()}
    >
      <ActionIcon name="tools" />
      <span className="tools-button__label">Tools</span>
      {tone !== null && (
        <span
          className="tools-button__dot"
          data-tone={tone}
          data-testid="tools-activity"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
```

`src/ui/processing/processing.css` (start of the file; later tasks append):

```css
/* Processing toolbox (spec §4–§6). Soft Utility tokens from flatControls.css. */
.tools-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height-compact);
  padding: 0 10px;
  font-size: 12px;
}
.tools-button__dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lime-500);
  box-shadow: 0 0 0 2px var(--bg-panel);
}
.tools-button__dot[data-tone="failed"] {
  background: var(--brand-secondary);
}
@media (max-width: 1279px) {
  .tools-button__label {
    display: none;
  }
}
```

Check that `--lime-500` and `--brand-secondary` exist in `src/app/brand.css` (they do: `#a7e32b` and `#ffc530`). Note: `aria-label="Tools"` keeps the accessible name stable when the label is hidden below 1280 px (spec §4.1).

- [ ] **Step 5: Mount it in App.tsx**

In `src/app/App.tsx`, import `ToolsButton` from `"../ui/processing/ToolsButton"` and insert it between `SelectModeControl` and `AddressSearch` inside `<div className="map-tool-header__editing">`:

```tsx
      <SelectModeControl … />
      <ToolsButton />
      <AddressSearch onFlyTo={handleFlyToAddress} />
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run tests/unit/ui/processing/ToolsButton.test.tsx tests/unit/app` and `npx tsc -b --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 7: Browser check**

Run `npm run dev` (never bare vite), open the app, click "try the Delft sample". Confirm: the Tools button sits after the Mode select at the same 30 px height, shows the pressed look when clicked, and the dot is hidden. Compare with the Mode select and the search button for radius and height.

- [ ] **Step 8: Commit**

```bash
git add src/ui/ActionIcon.tsx src/ui/processing/ToolsButton.tsx src/ui/processing/processing.css src/app/App.tsx tests/unit/ui/processing/ToolsButton.test.tsx
git commit -m "feat(processing): Tools button in the scene toolbar"
```

---

### Task 4: Right-panel Tools tab, catalogue view, pill and Escape order

**Files:**

- Create: `src/ui/processing/ProcessingPanel.tsx`, `src/ui/processing/CatalogueView.tsx`, `src/ui/processing/useEligibilityContext.ts`
- Modify: `src/app/App.tsx` (right panel), `src/ui/shell/ViewerShell.tsx` (Tools pill), `src/features/selection/useEscapeClearsSelection.ts`, `src/ui/processing/processing.css`
- Test: `tests/unit/ui/processing/CatalogueView.test.tsx`, `tests/unit/ui/processing/ProcessingPanel.test.tsx`, extend `tests/unit/features/selection/useEscapeClearsSelection.test.ts` if it exists (else create it)

**Interfaces:**

- Consumes: `TOOLS`, `GROUP_LABELS`, `filterTools`, `toolEligibility`, `useProcessingStore`, `useActiveLayer`, `layerKindOf`, `useLayerTableStore`, `getDuckDBStatus`.
- Produces: `<ProcessingPanel details={ReactNode | null} detailsTitle={string} />`; `useEligibilityContext(target: ActiveLayer | null): EligibilityContext`; `<CatalogueView />`. Task 11 replaces the placeholder `ToolView`.

- [ ] **Step 1: Write the eligibility-context hook**

`src/ui/processing/useEligibilityContext.ts`:

```ts
import { useLayerTableStore } from "../../insights/layerTables";
import { getDuckDBStatus } from "../../insights/duckdb";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { layerKindOf } from "../../features/layers/layerPresentation";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import type { EligibilityContext } from "../../features/processing/eligibility";

/** Reads the stores the spec §5 reasons depend on, for ONE candidate target. */
export function useEligibilityContext(
  target: ActiveLayer | null,
): EligibilityContext {
  const tables = useLayerTableStore((s) => s.tables);
  const hasVectorLayer = useGeoLayerStore((s) =>
    s.layers.some((l) => l.kind === "geojson"),
  );
  const status = getDuckDBStatus();
  const tableState =
    target?.kind === "city"
      ? (tables[target.layer.id]?.state ?? "none")
      : "none";
  const info =
    target?.kind === "city" && tables[target.layer.id]?.state === "ready"
      ? tables[target.layer.id]
      : null;
  const ready = info !== null && info.state === "ready" ? info.info : null;
  const ext = status.state === "ready" ? status.extensions : null;
  const extState = (name: "spatial" | "three_d") =>
    ext ? ext[name].state : "unloaded";
  return {
    targetKind: target ? layerKindOf(target) : "none",
    sourceEncoding:
      target?.kind === "city" ? target.layer.model.sourceEncoding : null,
    hasReader: ready !== null && ready.reader !== null,
    sourceAvailable: ready !== null && ready.source !== null,
    tableState,
    engineState: status.state,
    hasVectorLayer,
    extensionState: {
      spatial: extState("spatial"),
      three_d: extState("three_d"),
    },
  };
}
```

`getDuckDBStatus()` is a plain read (not reactive); the table store subscription re-renders the hook whenever a table changes, which is enough for this milestone (no lazy extension loads yet; M2 adds the status subscription).

- [ ] **Step 2: Write the failing catalogue test**

`tests/unit/ui/processing/CatalogueView.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../src/insights/duckdb", () => ({
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { parseCityJSON } =
  await import("../../../../src/domain/citymodel/parsers");
const fs = await import("node:fs");

function addDelftLikeLayer(): string {
  const text = fs.readFileSync("fixtures/two-buildings.city.json", "utf8");
  const model = parseCityJSON(text);
  const id = useLayerStore.getState().addLayer({
    name: "two-buildings",
    model,
    modelRef: { kind: "file", name: "two-buildings.city.json" },
  });
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useLayerTableStore.setState({ tables: {} });
});

describe("CatalogueView", () => {
  it("lists the three groups and marks unavailable tools with a reason", () => {
    addDelftLikeLayer();
    render(<CatalogueView />);
    expect(screen.getByText("ROOF")).toBeInTheDocument();
    expect(screen.getByText("3D MEASUREMENTS")).toBeInTheDocument();
    expect(screen.getByText("CROSS-LAYER")).toBeInTheDocument();
    const height = screen.getByRole("button", { name: /Height from extent/ });
    expect(height).not.toHaveAttribute("aria-disabled", "true");
    const join = screen.getByRole("button", {
      name: /Join attributes by location/,
    });
    expect(join).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getAllByText("Add a vector layer to join with").length,
    ).toBeGreaterThan(0);
  });

  it("filters by search and shows the empty message", () => {
    addDelftLikeLayer();
    render(<CatalogueView />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tools" }), {
      target: { value: "buffer" },
    });
    expect(
      screen.getByText(
        "No tool matches 'buffer'. Footprint operations arrive in a later release.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("ROOF")).toBeNull();
  });

  it("opens the tool view on click, even for a disabled row", () => {
    addDelftLikeLayer();
    render(<CatalogueView />);
    fireEvent.click(screen.getByRole("button", { name: /Join attributes/ }));
    expect(useProcessingStore.getState().view).toEqual({
      kind: "tool",
      toolId: "join-by-location",
    });
  });

  it("shows the empty history text", () => {
    addDelftLikeLayer();
    render(<CatalogueView />);
    expect(screen.getByText("Runs you start appear here")).toBeInTheDocument();
  });
});
```

If `addLayer`'s input shape differs (check `LayerStoreActions.addLayer` in `layerStore.ts` and how `tests/unit/features/layers/*.test.ts` build a layer), adapt the helper to the real signature; the assertions stay.

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run tests/unit/ui/processing/CatalogueView.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement CatalogueView**

`src/ui/processing/CatalogueView.tsx`:

```tsx
import { useMemo } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import {
  GROUP_LABELS,
  TOOLS,
  filterTools,
} from "../../features/processing/toolRegistry";
import { toolEligibility } from "../../features/processing/eligibility";
import type {
  ToolDefinition,
  ToolGroup,
} from "../../features/processing/types";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { useEligibilityContext } from "./useEligibilityContext";
import { RecentRuns } from "./RecentRuns";

const GROUP_ORDER: ReadonlyArray<ToolGroup> = ["roof", "3d", "cross-layer"];

const CHIP_TITLE: Readonly<Record<"spatial" | "three_d", string>> = {
  spatial:
    "Loads the spatial extension on first run (about 24 MB, once per session)",
  three_d:
    "Loads the three_d extension on first run (about 1 MB, once per session)",
};

export function CatalogueView() {
  const search = useProcessingStore((s) => s.search);
  const active = useActiveLayer();
  const ctx = useEligibilityContext(active);
  const visible = useMemo(() => filterTools(TOOLS, search), [search]);

  return (
    <div className="processing-catalogue">
      <input
        type="search"
        className="processing-search"
        aria-label="Search tools"
        placeholder="Search tools…"
        value={search}
        onChange={(e) =>
          useProcessingStore.getState().setSearch(e.target.value)
        }
      />
      {visible.length === 0 ? (
        <p className="processing-empty">
          No tool matches '{search.trim()}'. Footprint operations arrive in a
          later release.
        </p>
      ) : (
        GROUP_ORDER.map((group) => {
          const tools = visible.filter((t) => t.group === group);
          if (tools.length === 0) return null;
          return (
            <section key={group} className="processing-group">
              <h3 className="processing-group__label">{GROUP_LABELS[group]}</h3>
              {tools.map((tool) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  eligibility={toolEligibility(tool, ctx)}
                />
              ))}
            </section>
          );
        })
      )}
      <RecentRuns />
    </div>
  );
}

function ToolRow({
  tool,
  eligibility,
}: {
  readonly tool: ToolDefinition;
  readonly eligibility: ReturnType<typeof toolEligibility>;
}) {
  const disabled = !eligibility.ok;
  return (
    <button
      type="button"
      className="processing-tool-row"
      aria-disabled={disabled}
      title={disabled ? eligibility.reason : undefined}
      onClick={() => useProcessingStore.getState().openTool(tool.id)}
    >
      <span className="processing-tool-row__head">
        <span className="processing-tool-row__name">{tool.name}</span>
        {tool.extension !== null && (
          <span
            className="processing-chip"
            data-extension={tool.extension}
            title={CHIP_TITLE[tool.extension]}
          >
            {tool.extension === "spatial" ? "Spatial" : "3D"}
          </span>
        )}
      </span>
      <span className="processing-tool-row__desc">{tool.description}</span>
      {disabled && (
        <span className="processing-tool-row__reason">
          {eligibility.reason}
        </span>
      )}
    </button>
  );
}
```

`RecentRuns` is created in Task 11; for this task create a minimal `src/ui/processing/RecentRuns.tsx` that renders the empty state only:

```tsx
import { useProcessingStore } from "../../features/processing/processingStore";

export function RecentRuns() {
  const runs = useProcessingStore((s) => s.runs);
  return (
    <section className="processing-group">
      <h3 className="processing-group__label">RECENT RUNS</h3>
      {runs.length === 0 ? (
        <p className="processing-empty">Runs you start appear here</p>
      ) : null}
    </section>
  );
}
```

Append to `processing.css`:

```css
.processing-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}
.processing-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--border);
}
.processing-tab {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: var(--control-radius) var(--control-radius) 0 0;
}
.processing-tab[aria-selected="true"] {
  color: var(--fg);
  border-bottom: 2px solid currentColor;
}
.processing-tab__emphasis {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--lime-500);
}
.processing-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 16px;
}
.processing-search {
  width: 100%;
  min-height: var(--control-height-compact);
  margin-bottom: 12px;
}
.processing-group {
  margin-bottom: 16px;
}
.processing-group__label {
  margin: 0 0 6px;
  font: 500 11px/1.4 var(--font-label, var(--font-ui));
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.processing-tool-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 2px;
  padding: 8px 10px;
  margin-bottom: 4px;
  text-align: left;
  background: transparent !important;
}
.processing-tool-row:hover {
  background: var(--control-hover) !important;
}
.processing-tool-row[aria-disabled="true"] .processing-tool-row__name,
.processing-tool-row[aria-disabled="true"] .processing-tool-row__desc {
  opacity: 0.55;
}
.processing-tool-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.processing-tool-row__name {
  font-size: 13px;
  color: var(--fg);
}
.processing-tool-row__desc,
.processing-tool-row__reason,
.processing-empty {
  font-size: 11px;
  color: var(--fg-muted);
}
.processing-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  background: var(--lime-100);
  color: var(--lime-900);
}
```

- [ ] **Step 5: Implement ProcessingPanel with the tab strip**

`src/ui/processing/ProcessingPanel.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import { CatalogueView } from "./CatalogueView";
import { ToolView } from "./ToolView";
import { LogView } from "./LogView";
import "./processing.css";

interface Props {
  /** The Details panel when a selection exists, else null. */
  readonly details: ReactNode | null;
  readonly detailsTitle: string;
}

/**
 * Spec §4.2: with the toolbox open the right panel carries a tab strip,
 * Tools and (only with a selection) Details. Picking never switches the tab;
 * the Details tab gets an emphasis dot until the user looks at it.
 */
export function ProcessingPanel({ details, detailsTitle }: Props) {
  const view = useProcessingStore((s) => s.view);
  const [tab, setTab] = useState<"tools" | "details">("tools");
  const [emphasis, setEmphasis] = useState(false);
  const hasDetails = details !== null;

  useEffect(() => {
    if (!hasDetails) {
      setTab("tools");
      setEmphasis(false);
      return;
    }
    if (tab === "tools") setEmphasis(true);
    // Only the title changing should re-emphasise; `tab` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDetails, detailsTitle]);

  const showDetails = hasDetails && tab === "details";
  return (
    <aside className="processing-panel" aria-label="Tools panel">
      <div className="processing-tabs" role="tablist" aria-label="Right panel">
        <button
          type="button"
          role="tab"
          className="processing-tab"
          aria-selected={!showDetails}
          onClick={() => setTab("tools")}
        >
          Tools
        </button>
        {hasDetails && (
          <button
            type="button"
            role="tab"
            className="processing-tab"
            aria-selected={showDetails}
            onClick={() => {
              setTab("details");
              setEmphasis(false);
            }}
          >
            {emphasis && !showDetails && (
              <span className="processing-tab__emphasis" aria-hidden="true" />
            )}
            Details · {detailsTitle}
          </button>
        )}
        <button
          type="button"
          className="processing-tab processing-tab--close"
          aria-label="Close tools"
          onClick={() => useProcessingStore.getState().setOpen(false)}
        >
          ×
        </button>
      </div>
      {showDetails ? (
        details
      ) : (
        <div className="processing-body">
          {view.kind === "catalogue" && <CatalogueView />}
          {view.kind === "tool" && <ToolView toolId={view.toolId} />}
          {view.kind === "log" && <LogView runId={view.runId} />}
        </div>
      )}
    </aside>
  );
}
```

For this task create placeholders that Task 11 replaces: `src/ui/processing/ToolView.tsx` exporting `ToolView({ toolId }: { readonly toolId: ToolId })` that renders `<p className="processing-empty">{toolById(toolId).name}</p>` with a back button calling `useProcessingStore.getState().back()`, and `src/ui/processing/LogView.tsx` exporting `LogView({ runId }: { readonly runId: string })` rendering `<p className="processing-empty">Log {runId}</p>`.

Add `.processing-tab--close { margin-left: auto; }` to the CSS.

- [ ] **Step 6: Wire the right panel, the pill and the title in App.tsx and ViewerShell**

In `App.tsx`, read `const toolboxOpen = useProcessingStore((s) => s.open);` near the other store reads, and replace the `right=`/`rightTitle=` props:

```tsx
const detailsNode =
  selections.length > 0 || geoSelection !== null ? (
    <DetailsPanel onClose={clearSelection} />
  ) : null;
const detailsTitle = selectionTitle(selections, geoSelection !== null);
…
right={
  toolboxOpen ? (
    <ProcessingPanel details={detailsNode} detailsTitle={detailsTitle} />
  ) : (
    detailsNode
  )
}
rightTitle={detailsTitle}
rightMode={toolboxOpen ? "tools" : "details"}
```

In `ViewerShell.tsx` add the prop `readonly rightMode?: "tools" | "details"` and render the collapsed pills as:

```tsx
{
  right !== null && rightCollapsed && (
    <div className="details-pills">
      {rightMode === "tools" && (
        <button
          type="button"
          className="details-pill"
          onClick={() => useShellStore.getState().setRightCollapsed(false)}
        >
          Tools{toolsRunning ? " · running" : ""}
        </button>
      )}
      {hasSelection && (
        <button
          type="button"
          className="details-pill"
          onClick={() => useShellStore.getState().setRightCollapsed(false)}
        >
          Details · {rightTitle}
        </button>
      )}
    </div>
  );
}
```

where `toolsRunning` comes from `useProcessingStore((s) => s.runs.some((r) => r.status === "running" || r.status === "queued" || r.status === "cancelling"))` and `hasSelection` is a new boolean prop `readonly hasSelection: boolean` passed by App as `selections.length > 0 || geoSelection !== null`. Keep the existing single-pill markup when `rightMode` is `"details"` (that is the default). Add CSS `.details-pills { position: absolute; right: .75rem; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }` and make `.details-pill` inside it `position: static; transform: none;` (read `.details-pill` at app.css ~772 first; if it already uses `position:absolute; top:50%`, override inside `.details-pills .details-pill`).

Also: the Tools button must open the panel even when the right column is collapsed (spec §4.1). In `processingStore.setOpen`, when `open` becomes true call `useShellStore.getState().setRightCollapsed(false)` — import `useShellStore` from `../../ui/shell/shellStore` inside `processingStore.ts` (the shell store has no dependency back, so no cycle). Add a test to `processingStore.test.ts`: collapse the panel, `setOpen(true)`, expect `rightCollapsed` false.

- [ ] **Step 7: Escape order**

In `useEscapeClearsSelection.ts`, after the scene-sheet check and before the text-entry check, insert:

```ts
const processing = useProcessingStore.getState();
if (processing.open && processing.view.kind !== "catalogue") {
  processing.back();
  return;
}
```

with `import { useProcessingStore } from "../processing/processingStore";`. Spec §4.2: sheets, then the tool form (back to the catalogue), then the selection.

Test (`tests/unit/features/selection/useEscapeClearsSelection.test.ts`, extend or create following the existing pattern for the sheet case): open a tool (`useProcessingStore.getState().openTool("height-from-extent")`), select an object, dispatch `keydown` Escape on `window`; expect the view to be `{ kind: "catalogue" }` and the selection untouched; dispatch again; expect the selection cleared.

- [ ] **Step 8: Panel test**

`tests/unit/ui/processing/ProcessingPanel.test.tsx` (same duckdb mock block as the catalogue test):

```tsx
it("shows the Details tab only with a selection and never switches to it by itself", () => {
  const { rerender } = render(
    <ProcessingPanel details={null} detailsTitle="Selection" />,
  );
  expect(screen.queryByRole("tab", { name: /Details/ })).toBeNull();
  rerender(
    <ProcessingPanel
      details={<div>details body</div>}
      detailsTitle="Building …12869"
    />,
  );
  const details = screen.getByRole("tab", {
    name: /Details · Building …12869/,
  });
  expect(details).toHaveAttribute("aria-selected", "false");
  expect(screen.queryByText("details body")).toBeNull();
  fireEvent.click(details);
  expect(screen.getByText("details body")).toBeInTheDocument();
});

it("closes through the × and returns the panel to the selection", () => {
  render(<ProcessingPanel details={null} detailsTitle="Selection" />);
  fireEvent.click(screen.getByRole("button", { name: "Close tools" }));
  expect(useProcessingStore.getState().open).toBe(false);
});
```

- [ ] **Step 9: Run tests, tsc, browser check**

Run: `npx vitest run tests/unit/ui/processing tests/unit/features/processing tests/unit/features/selection tests/unit/app` and `npx tsc -b --noEmit`.
Browser (`npm run dev`, Delft sample): click Tools → right panel shows the catalogue with the three groups and the reasons; pick a building → a Details tab appears with the dot, the Tools tab stays; click × → the panel shows Details as before; collapse the panel with Tools open → two pills.

- [ ] **Step 10: Commit**

```bash
git add src/ui/processing src/app/App.tsx src/ui/shell/ViewerShell.tsx src/app/app.css src/features/selection/useEscapeClearsSelection.ts src/features/processing/processingStore.ts tests/unit
git commit -m "feat(processing): Tools tab with catalogue, collapsed pills and Escape order"
```

---

### Task 5: `bbox` column on the flat fallback rows

**Files:**

- Modify: `src/insights/layerRows.ts` (`flatRowsFromModel`, and the resident-record variant if it builds rows from `ResidentObjectRecord`; check whether the record carries a bbox and, if not, leave that path returning `bbox: null`)
- Test: `tests/unit/insights/layerRows.test.ts` (extend the existing file if present, else create)

**Interfaces:**

- Produces: every flat row has `bbox: { xmin, ymin, zmin, xmax, ymax, zmax } | null`, so `read_json_auto` infers the same STRUCT the reader writes (spec §7.4).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  flatRowsFromModel,
  FLAT_PREFIX_COLUMNS,
} from "../../../src/insights/layerRows";
import { parseCityJSON } from "../../../src/domain/citymodel/parsers";

describe("flatRowsFromModel bbox", () => {
  it("carries each object's extent as a struct with the reader's field names", () => {
    const model = parseCityJSON(
      readFileSync("fixtures/two-buildings.city.json", "utf8"),
    );
    const rows = flatRowsFromModel(model);
    const withGeometry = rows.find((r) => r.bbox !== null);
    expect(withGeometry).toBeDefined();
    const bbox = withGeometry!.bbox as Record<string, number>;
    expect(Object.keys(bbox)).toEqual([
      "xmin",
      "ymin",
      "zmin",
      "xmax",
      "ymax",
      "zmax",
    ]);
    expect(bbox.zmax).toBeGreaterThan(bbox.zmin);
    expect(FLAT_PREFIX_COLUMNS).toContain("bbox");
  });
});
```

If `parseCityJSON` lives elsewhere (check `src/domain/citymodel/index.ts` or how `tests/integration` builds a model), import from there.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/insights/layerRows.test.ts`
Expected: FAIL (`bbox` undefined / not in prefix columns).

- [ ] **Step 3: Implement**

In `layerRows.ts`:

```ts
export interface BboxStruct {
  readonly xmin: number;
  readonly ymin: number;
  readonly zmin: number;
  readonly xmax: number;
  readonly ymax: number;
  readonly zmax: number;
}

export function bboxStruct(
  bbox:
    | readonly [number, number, number, number, number, number]
    | null
    | undefined,
): BboxStruct | null {
  if (!bbox) return null;
  const [xmin, ymin, zmin, xmax, ymax, zmax] = bbox;
  return { xmin, ymin, zmin, xmax, ymax, zmax };
}
```

Add `"bbox"` to `FLAT_PREFIX_COLUMNS` (after `"children"`) so a source attribute named `bbox` is dropped and reported like the other reserved names, add `readonly bbox: BboxStruct | null;` to `FlatRow`, and in `flatRowsFromModel` push `bbox: bboxStruct(obj.bbox)`. For the resident path, `ResidentObjectRecord` (from `@cityjson/navara-flatcitybuf`) — read its type; if it has `bbox`, map it the same way, otherwise `bbox: null`.

- [ ] **Step 4: Run the layerRows and layerTables tests**

Run: `npx vitest run tests/unit/insights`
Expected: PASS. If a table-build test asserts the exact column list of the flat table, update it to include `bbox`.

- [ ] **Step 5: Commit**

```bash
git add src/insights/layerRows.ts tests/unit/insights/layerRows.test.ts
git commit -m "feat(insights): bbox struct on flat fallback rows"
```

---

### Task 6: `runOnTableQueue` — one FIFO for table builds and tool runs

**Files:**

- Modify: `src/insights/layerTables.ts`
- Test: `tests/unit/insights/layerTablesQueue.test.ts` (extend)

**Interfaces:**

- Produces: `export function runOnTableQueue<T>(task: () => Promise<T>): Promise<T>` — appends to the SAME `chain` the builds use (advisor rule: a run's `ALTER`/`UPDATE` must never interleave with a `CREATE OR REPLACE` of the same table).

- [ ] **Step 1: Write the failing test** (append to `layerTablesQueue.test.ts`, using its existing mock setup)

```ts
it("runOnTableQueue runs after work already queued and before work queued later", async () => {
  const order: string[] = [];
  const gate = deferred<void>(); // if the file has no helper: { promise, resolve } built from new Promise
  const first = runOnTableQueue(async () => {
    await gate.promise;
    order.push("first");
  });
  const second = runOnTableQueue(async () => {
    order.push("second");
    return 42;
  });
  gate.resolve();
  await expect(second).resolves.toBe(42);
  await first;
  expect(order).toEqual(["first", "second"]);
});

it("runOnTableQueue propagates a rejection without stalling the queue", async () => {
  await expect(
    runOnTableQueue(async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  await expect(runOnTableQueue(async () => "next")).resolves.toBe("next");
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/unit/insights/layerTablesQueue.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** — directly under `enqueue` in `layerTables.ts`:

```ts
/** Public door onto the ONE queue for work that must not interleave with a
 *  table build: a processing run's ALTER/UPDATE on a layer table. */
export function runOnTableQueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(task);
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git commit -am "feat(insights): runOnTableQueue shares the table FIFO with tool runs"`.

---

### Task 7: Model write-back seam — `layerStore.mergeAttributes`, plugin `setModel`, `syncLayers` push

**Files:**

- Submodule: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts` (`CityModelHandle.setModel`), `cityModelMesh.ts` (`setModel`), `cityModelRegistry.ts` (delegate); test `packages/cityjson-navara-plugins/packages/navara-cityjson/tests/cityModelMesh.setModel.test.ts` (follow the existing mesh tests' fixture pattern in that folder)
- App: `src/features/layers/layerStore.ts`, `src/scene/handleSync.ts`; tests `tests/unit/features/layers/layerStoreMergeAttributes.test.ts`, extend `tests/unit/scene/handleSync.test.ts` (or the file that tests `syncLayers`)

**Interfaces:**

- Produces: `mergeAttributes(layerId: string, byObjectId: ReadonlyMap<string, Readonly<Record<string, unknown>>>): void` on the layer store (a NEW `model` object with new `objects` entries for the touched ids; untouched objects keep identity); `CityModelHandle.setModel(model: CityModel): void` (swaps the model the mesh evaluates rules against and repaints; geometry untouched); `LiveLayer.model` tracked by identity and pushed by `syncLayers`.

- [ ] **Step 1: Plugin — failing test**

```ts
import { describe, expect, it } from "vitest";
// import the same fixture/mesh construction the neighbouring cityModelMesh tests use
it("setModel swaps the model rules evaluate against and repaints", () => {
  const { mesh, model } = buildMeshFixture(); // the folder's existing helper
  const objectId = Object.keys(model.objects)[0];
  let seen: unknown = null;
  mesh.setStyle((attributes) => {
    seen = attributes["computed_x"];
    return null;
  });
  expect(seen).toBeNull();
  const next = {
    ...model,
    objects: {
      ...model.objects,
      [objectId]: {
        ...model.objects[objectId],
        attributes: { ...model.objects[objectId].attributes, computed_x: 7 },
      },
    },
  };
  mesh.setModel(next);
  expect(seen).toBe(7);
});
```

Adapt the evaluator's signature to `SurfaceStyleEvaluator` as declared in the package (read `surfaceColorLayers.ts` line ~80 to see the arguments it is called with).

- [ ] **Step 2: Run inside the submodule** — `cd packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/tests/cityModelMesh.setModel.test.ts` → FAIL.

- [ ] **Step 3: Implement in the plugin**

`cityModelMesh.ts`, next to `setStyle`:

```ts
  /** Swap the model whose ATTRIBUTES rules read, without touching geometry.
   *  The app merges computed attributes into a new immutable model; the
   *  mesh's arrays index objects by id, so only the lookup changes. */
  setModel(model: CityModel): void {
    if (model === this.model) return;
    this.model = model;
    this.repaint();
  }
```

(`this.model` is assigned in the constructor from `options.model`; if it is declared `readonly`, drop the modifier.) In `types.ts` add to `CityModelHandle`: `/** Swap the model rules evaluate against (attributes only). */ setModel(model: CityModel): void;`. In `cityModelRegistry.ts` add `setModel: (model: CityModel) => mesh.setModel(model),` to the handle literal. Search the package and the app for other objects implementing `CityModelHandle` (test doubles in `tests/`, `src/scene/*` fakes) and add a no-op `setModel` to each so `tsc` stays green.

- [ ] **Step 4: Run plugin tests and typecheck** — `pnpm vitest run packages/navara-cityjson` and `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit in the submodule and push**

```bash
cd packages/cityjson-navara-plugins
git add packages/navara-cityjson
git commit -m "feat(navara-cityjson): CityModelHandle.setModel swaps attributes without rebuilding"
git push origin HEAD:main
cd ../..
```

If the submodule is on a detached HEAD, create the commit on a branch first (`git switch -c processing-setmodel`) and push that branch; the parent's pointer bump records the SHA either way. Do not push onto `main` from a detached pin if the DuckDB spec's delivery note (branch `duckdb-integration`) still applies — check `git -C packages/cityjson-navara-plugins status` and `git log --oneline -3` first, and push to the branch the pin is on.

- [ ] **Step 6: App — failing store test**

`tests/unit/features/layers/layerStoreMergeAttributes.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { parseCityJSON } from "../../../../src/domain/citymodel/parsers";

afterEach(() => useLayerStore.getState().removeAllLayers());

describe("mergeAttributes", () => {
  it("writes attributes onto the named objects in a new model and keeps the others by identity", () => {
    const model = parseCityJSON(
      readFileSync("fixtures/two-buildings.city.json", "utf8"),
    );
    const id = useLayerStore.getState().addLayer({
      name: "t",
      model,
      modelRef: { kind: "file", name: "t.city.json" },
    });
    const [a, b] = Object.keys(model.objects);
    useLayerStore
      .getState()
      .mergeAttributes(id, new Map([[a, { extent_height_m: 9.5 }]]));
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(layer.model).not.toBe(model);
    expect(layer.model.objects[a].attributes.extent_height_m).toBe(9.5);
    expect(layer.model.objects[a].attributes.function ?? null).toBe(
      model.objects[a].attributes.function ?? null,
    );
    expect(layer.model.objects[b]).toBe(model.objects[b]);
  });

  it("removes an attribute when the value is undefined (Undo of a new column)", () => {
    const model = parseCityJSON(
      readFileSync("fixtures/two-buildings.city.json", "utf8"),
    );
    const id = useLayerStore.getState().addLayer({
      name: "t",
      model,
      modelRef: { kind: "file", name: "t.city.json" },
    });
    const [a] = Object.keys(model.objects);
    useLayerStore.getState().mergeAttributes(id, new Map([[a, { x: 1 }]]));
    useLayerStore
      .getState()
      .mergeAttributes(id, new Map([[a, { x: undefined }]]));
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect("x" in layer.model.objects[a].attributes).toBe(false);
  });
});
```

Use the real `addLayer` input shape (see how existing layerStore tests call it).

- [ ] **Step 7: Implement `mergeAttributes`**

In `layerStore.ts` add to `LayerStoreActions`:

```ts
  /** Merge computed attributes into the layer's model. `undefined` deletes
   *  a key. Produces a NEW model and new objects for the touched ids only. */
  mergeAttributes(
    layerId: string,
    byObjectId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ): void;
```

and the implementation:

```ts
  mergeAttributes: (layerId, byObjectId) =>
    set((state) => ({
      layers: state.layers.map((layer) => {
        if (layer.id !== layerId || byObjectId.size === 0) return layer;
        const objects: Record<string, CityObject> = { ...layer.model.objects };
        for (const [id, patch] of byObjectId) {
          const obj = objects[id];
          if (!obj) continue;
          const attributes: Record<string, unknown> = { ...obj.attributes };
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete attributes[key];
            else attributes[key] = value;
          }
          objects[id] = { ...obj, attributes };
        }
        return { ...layer, model: { ...layer.model, objects } };
      }),
    })),
```

Import `CityObject` from the app's `domain/citymodel/types` re-export.

- [ ] **Step 8: Push the model through `syncLayers`**

In `handleSync.ts`: add `model?: CityModel;` to `LiveLayer` (identity of the model last pushed; `undefined` = the add-time model), seed it on add (`model: layer.model`), and in the per-layer loop:

```ts
if (entry.model !== layer.model) {
  entry.model = layer.model;
  entry.handle.setModel(layer.model);
}
```

Extend the `syncLayers` unit test: a fake handle records `setModel` calls; after `mergeAttributes` the next `syncLayers` pass calls it once with the new model, and a pass with no change calls it zero times. Then bump the submodule pointer.

- [ ] **Step 9: Run everything and commit in the parent**

Run: `npx tsc -b --noEmit && npx vitest run tests/unit/features/layers tests/unit/scene`
Expected: PASS.

```bash
git add packages/cityjson-navara-plugins src/features/layers/layerStore.ts src/scene/handleSync.ts tests/unit
git commit -m "feat(layers): mergeAttributes writes computed attributes into the model; scene pushes setModel"
```

---

### Task 8: Computed columns — SQL builders, write-back with backup, undo, registry

**Files:**

- Create: `src/insights/computedColumns.ts`
- Test: `tests/unit/insights/computedColumns.test.ts`

**Interfaces:**

- Consumes: `runQuery`, `ddl`, `registerBuffer`, `dropBuffer` from `duckdb.ts`; `quoteIdent`, `quoteLiteral` from `sql.ts`.
- Produces:
  - `type ColumnType = "DOUBLE" | "BOOLEAN" | "VARCHAR"`; `interface OutputColumn { name: string; type: ColumnType }`.
  - `buildAddColumnSql(table, col)`, `buildBackupSql(table, backupTable, columns, ids | null)`, `buildUpdateFromValuesSql(table, valuesTable, columns)`, `buildRestoreSql(table, backupTable, columns)`, `buildNullifySql(table, columns, ids | null)` — pure.
  - `writeComputedColumns(input: { runId; table: string; columns: OutputColumn[]; rows: ReadonlyMap<string, Record<string, unknown>>; existing: ReadonlySet<string> }): Promise<{ ok: true; backupTable: string | null } | { ok: false; message: string }>` — ONE transaction: backup existing columns for the touched ids, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, register the rows as JSON, `UPDATE … FROM read_json_auto`, drop the values buffer.
  - `undoComputedColumns(input: { table; backupTable: string | null; created: string[]; replaced: string[]; ids: string[] | null }): Promise<QueryOutcome>` — restore replaced values from the backup, drop created columns, drop the backup table.
  - `useComputedColumnStore`: `{ byLayer: Record<layerId, Record<column, Provenance>> }` with `Provenance = { runId; toolName; summary: string; at: number; partial: { count: number; total: number } | null; previous: Provenance | null }`; actions `setProvenance(layerId, column, p)`, `removeColumns(layerId, columns)`, `clearLayer(layerId)`; selector `computedColumnsOf(layerId): ReadonlySet<string>`.

- [ ] **Step 1: Failing tests (SQL builders first)**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/insights/duckdb", () => ({
  runQuery: vi.fn(async (sql: string) => ({ ok: true, columns: [], rows: [] })),
  ddl: vi.fn(async (sql: string) => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {},
    loadedExtensions: [],
    platform: null,
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

const cc = await import("../../../src/insights/computedColumns");
const duck = await import("../../../src/insights/duckdb");

describe("computed column SQL", () => {
  it("adds a column idempotently", () => {
    expect(
      cc.buildAddColumnSql("layer_1", {
        name: "extent_height_m",
        type: "DOUBLE",
      }),
    ).toBe(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
    );
  });
  it("backs up replaced columns for the touched ids only", () => {
    expect(
      cc.buildBackupSql("layer_1", "__undo_r1", ["a", "b"], ["x", "y'z"]),
    ).toBe(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a", "b" FROM "layer_1" WHERE "id" IN ('x', 'y''z')`,
    );
    expect(cc.buildBackupSql("layer_1", "__undo_r1", ["a"], null)).toBe(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a" FROM "layer_1"`,
    );
  });
  it("updates from the registered values", () => {
    expect(
      cc.buildUpdateFromValuesSql("layer_1", "__vals_r1.json", ["a", "b"]),
    ).toBe(
      `UPDATE "layer_1" SET "a" = v."a", "b" = v."b" FROM read_json_auto('__vals_r1.json') AS v WHERE "layer_1"."id" = v."id"`,
    );
  });
  it("restores and nullifies", () => {
    expect(cc.buildRestoreSql("layer_1", "__undo_r1", ["a"])).toBe(
      `UPDATE "layer_1" SET "a" = u."a" FROM "__undo_r1" AS u WHERE "layer_1"."id" = u."id"`,
    );
    expect(cc.buildNullifySql("layer_1", ["a"], ["x"])).toBe(
      `UPDATE "layer_1" SET "a" = NULL WHERE "id" IN ('x')`,
    );
  });
});

describe("writeComputedColumns", () => {
  it("issues backup, add, update inside one transaction and registers the rows", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r1",
      table: "layer_1",
      columns: [
        { name: "a", type: "DOUBLE" },
        { name: "b", type: "BOOLEAN" },
      ],
      rows: new Map([
        ["x", { a: 1.5, b: true }],
        ["y", { a: null, b: false }],
      ]),
      existing: new Set(["a"]),
    });
    expect(result).toEqual({ ok: true, backupTable: "__undo_r1" });
    expect(calls[0]).toBe("BEGIN TRANSACTION");
    expect(calls).toContain(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a" FROM "layer_1" WHERE "id" IN ('x', 'y')`,
    );
    expect(calls).toContain(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "b" BOOLEAN',
    );
    expect(calls.at(-1)).toBe("COMMIT");
    const registered = vi.mocked(duck.registerBuffer).mock.calls[0];
    expect(registered[0]).toBe("__vals_r1.json");
    expect(JSON.parse(new TextDecoder().decode(registered[1]))).toEqual([
      { id: "x", a: 1.5, b: true },
      { id: "y", a: null, b: false },
    ]);
    expect(duck.dropBuffer).toHaveBeenCalledWith("__vals_r1.json");
  });

  it("rolls back and reports the first failing statement", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return sql.startsWith("UPDATE")
        ? { ok: false, message: "Binder Error: x" }
        : { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r2",
      table: "layer_1",
      columns: [{ name: "a", type: "DOUBLE" }],
      rows: new Map([["x", { a: 1 }]]),
      existing: new Set(),
    });
    expect(result).toEqual({ ok: false, message: "Binder Error: x" });
    expect(calls).toContain("ROLLBACK");
  });
});

describe("computed column registry", () => {
  it("records provenance per layer and column and clears it", () => {
    const p = {
      runId: "r1",
      toolName: "Height from extent",
      summary: "All · 2 buildings",
      at: 1,
      partial: null,
      previous: null,
    };
    cc.useComputedColumnStore
      .getState()
      .setProvenance("L1", "extent_height_m", p);
    expect([...cc.computedColumnsOf("L1")]).toEqual(["extent_height_m"]);
    cc.useComputedColumnStore
      .getState()
      .removeColumns("L1", ["extent_height_m"]);
    expect(cc.computedColumnsOf("L1").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/unit/insights/computedColumns.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/insights/computedColumns.ts`:

```ts
import { create } from "zustand";
import {
  ddl,
  dropBuffer,
  registerBuffer,
  runQuery,
  type QueryOutcome,
} from "./duckdb";
import { quoteIdent, quoteLiteral } from "./sql";

export type ColumnType = "DOUBLE" | "BOOLEAN" | "VARCHAR";
export interface OutputColumn {
  readonly name: string;
  readonly type: ColumnType;
}

const EMPTY = new Set<string>();

export function buildAddColumnSql(table: string, col: OutputColumn): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(col.name)} ${col.type}`;
}

function idList(ids: ReadonlyArray<string>): string {
  return ids.map((id) => quoteLiteral(id)).join(", ");
}

export function buildBackupSql(
  table: string,
  backupTable: string,
  columns: ReadonlyArray<string>,
  ids: ReadonlyArray<string> | null,
): string {
  const cols = ['"id"', ...columns.map(quoteIdent)].join(", ");
  const where = ids === null ? "" : ` WHERE "id" IN (${idList(ids)})`;
  return `CREATE TABLE ${quoteIdent(backupTable)} AS SELECT ${cols} FROM ${quoteIdent(table)}${where}`;
}

export function buildUpdateFromValuesSql(
  table: string,
  valuesFile: string,
  columns: ReadonlyArray<string>,
): string {
  const sets = columns
    .map((c) => `${quoteIdent(c)} = v.${quoteIdent(c)}`)
    .join(", ");
  return `UPDATE ${quoteIdent(table)} SET ${sets} FROM read_json_auto(${quoteLiteral(valuesFile)}) AS v WHERE ${quoteIdent(table)}."id" = v."id"`;
}

export function buildRestoreSql(
  table: string,
  backupTable: string,
  columns: ReadonlyArray<string>,
): string {
  const sets = columns
    .map((c) => `${quoteIdent(c)} = u.${quoteIdent(c)}`)
    .join(", ");
  return `UPDATE ${quoteIdent(table)} SET ${sets} FROM ${quoteIdent(backupTable)} AS u WHERE ${quoteIdent(table)}."id" = u."id"`;
}

export function buildNullifySql(
  table: string,
  columns: ReadonlyArray<string>,
  ids: ReadonlyArray<string> | null,
): string {
  const sets = columns.map((c) => `${quoteIdent(c)} = NULL`).join(", ");
  const where = ids === null ? "" : ` WHERE "id" IN (${idList(ids)})`;
  return `UPDATE ${quoteIdent(table)} SET ${sets}${where}`;
}

export interface WriteInput {
  readonly runId: string;
  readonly table: string;
  readonly columns: ReadonlyArray<OutputColumn>;
  /** id → { column → value }. Every column present in every row (null allowed). */
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Column names that already exist on the table (they get backed up). */
  readonly existing: ReadonlySet<string>;
}

export type WriteOutcome =
  | { readonly ok: true; readonly backupTable: string | null }
  | { readonly ok: false; readonly message: string };

async function step(
  sql: string,
  use: "ddl" | "query" = "query",
): Promise<QueryOutcome> {
  return use === "ddl" ? ddl(sql) : runQuery(sql);
}

/** Spec §6.1: results land in ONE transaction; a failure leaves the layer as it was. */
export async function writeComputedColumns(
  input: WriteInput,
): Promise<WriteOutcome> {
  const ids = [...input.rows.keys()];
  const replaced = input.columns
    .map((c) => c.name)
    .filter((n) => input.existing.has(n));
  const backupTable = replaced.length > 0 ? `__undo_${input.runId}` : null;
  const valuesFile = `__vals_${input.runId}.json`;
  const payload = ids.map((id) => ({ id, ...input.rows.get(id) }));
  const bytes = new TextEncoder().encode(
    JSON.stringify(payload, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
  if (!(await registerBuffer(valuesFile, bytes))) {
    return {
      ok: false,
      message: "Could not hand the results to the analytics engine",
    };
  }
  const statements: Array<[string, "ddl" | "query"]> = [
    ["BEGIN TRANSACTION", "query"],
  ];
  if (backupTable)
    statements.push([
      buildBackupSql(input.table, backupTable, replaced, ids),
      "ddl",
    ]);
  for (const col of input.columns)
    statements.push([buildAddColumnSql(input.table, col), "ddl"]);
  statements.push([
    buildUpdateFromValuesSql(
      input.table,
      valuesFile,
      input.columns.map((c) => c.name),
    ),
    "query",
  ]);
  statements.push(["COMMIT", "query"]);
  try {
    for (const [sql, use] of statements) {
      const out = await step(sql, use);
      if (!out.ok) {
        await step("ROLLBACK");
        return { ok: false, message: out.message };
      }
    }
    return { ok: true, backupTable };
  } finally {
    await dropBuffer(valuesFile);
  }
}

export interface UndoInput {
  readonly table: string;
  readonly backupTable: string | null;
  readonly created: ReadonlyArray<string>;
  readonly replaced: ReadonlyArray<string>;
  readonly ids: ReadonlyArray<string> | null;
}

/** Spec §6.2: restore replaced values, drop created columns, drop the backup. */
export async function undoComputedColumns(
  input: UndoInput,
): Promise<QueryOutcome> {
  const statements: string[] = ["BEGIN TRANSACTION"];
  if (input.backupTable && input.replaced.length > 0) {
    statements.push(
      buildRestoreSql(input.table, input.backupTable, input.replaced),
    );
  }
  for (const c of input.created)
    statements.push(
      `ALTER TABLE ${quoteIdent(input.table)} DROP COLUMN IF EXISTS ${quoteIdent(c)}`,
    );
  if (input.backupTable)
    statements.push(`DROP TABLE IF EXISTS ${quoteIdent(input.backupTable)}`);
  statements.push("COMMIT");
  for (const sql of statements) {
    const out = await runQuery(sql);
    if (!out.ok) {
      await runQuery("ROLLBACK");
      return out;
    }
  }
  return { ok: true, columns: [], rows: [] };
}

export interface Provenance {
  readonly runId: string;
  readonly toolName: string;
  /** e.g. "LoD 2.2 · All 1,115 buildings". */
  readonly summary: string;
  readonly at: number;
  /** Set when the run covered part of the layer (spec §7 provenance tooltip). */
  readonly partial: { readonly count: number; readonly total: number } | null;
  /** The provenance this run replaced, for the "the rest from …" tooltip. */
  readonly previous: Provenance | null;
}

interface ComputedColumnState {
  readonly byLayer: Readonly<
    Record<string, Readonly<Record<string, Provenance>>>
  >;
}
interface ComputedColumnActions {
  setProvenance(layerId: string, column: string, p: Provenance): void;
  removeColumns(layerId: string, columns: ReadonlyArray<string>): void;
  clearLayer(layerId: string): void;
}

export const useComputedColumnStore = create<
  ComputedColumnState & ComputedColumnActions
>((set) => ({
  byLayer: {},
  setProvenance: (layerId, column, p) =>
    set((s) => ({
      byLayer: {
        ...s.byLayer,
        [layerId]: { ...(s.byLayer[layerId] ?? {}), [column]: p },
      },
    })),
  removeColumns: (layerId, columns) =>
    set((s) => {
      const next = { ...(s.byLayer[layerId] ?? {}) };
      for (const c of columns) delete next[c];
      return { byLayer: { ...s.byLayer, [layerId]: next } };
    }),
  clearLayer: (layerId) =>
    set((s) => {
      const byLayer = { ...s.byLayer };
      delete byLayer[layerId];
      return { byLayer };
    }),
}));

export function computedColumnsOf(layerId: string): ReadonlySet<string> {
  const cols = useComputedColumnStore.getState().byLayer[layerId];
  return cols ? new Set(Object.keys(cols)) : EMPTY;
}

export function provenanceOf(
  layerId: string,
  column: string,
): Provenance | null {
  return useComputedColumnStore.getState().byLayer[layerId]?.[column] ?? null;
}
```

Check `quoteLiteral` accepts a string and doubles `'` (sql.ts); if it is typed narrower, add a string overload rather than a local copy.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add src/insights/computedColumns.ts tests/unit/insights/computedColumns.test.ts && git commit -m "feat(insights): computed columns write-back with backup, undo and provenance registry"`.

---

### Task 9: Scope resolution and the single-flight run queue

**Files:**

- Create: `src/features/processing/scope.ts`, `src/features/processing/runQueue.ts`, `src/features/processing/tools/index.ts`
- Test: `tests/unit/features/processing/scope.test.ts`, `tests/unit/features/processing/runQueue.test.ts`

**Interfaces:**

- Consumes: `runOnTableQueue` (Task 6), `writeComputedColumns`/`undoComputedColumns`/`useComputedColumnStore` (Task 8), `useLayerStore.mergeAttributes` (Task 7), `useProcessingStore` (Task 2), `buildFeatureIdsSql`/`compileFilter` (sql.ts), `layerQuery` (queryStore), `useSelectionStore`, `getLayerTable`, `useLayerTableStore`.
- Produces:
  - `resolveScope(input: { layerId; table: LayerTable; scope: Scope }): Promise<{ ok: true; featureIds: string[] | null; count: number } | { ok: false; message: string }>` — `all` → `null` + feature count; `matching` → the ids from `buildFeatureIdsSql(table, where)`; `selected` → the selection's object ids expanded to their features by `buildFeatureIdsSql` with `"id" IN (...)`.
  - `interface ToolContext { readonly table: LayerTable; readonly layer: Layer; readonly featureIds: ReadonlyArray<string> | null; readonly signal: AbortSignal; query(label: string, sql: string): Promise<QueryOutcome>; phase(p: RunPhase): void; warn(text: string): void }`.
  - `interface ToolResult { readonly columns: ReadonlyArray<OutputColumn>; readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>; readonly measured: number; readonly skipped: ReadonlyArray<SkipCount> }`.
  - `type ToolExecutor = (run: RunRecord, ctx: ToolContext) => Promise<ToolResult>`; `EXECUTORS: Partial<Record<ToolId, ToolExecutor>>` in `tools/index.ts` (Task 10 registers `height-from-extent`).
  - `submitRun(request: RunRequest): string` (returns the run id; queued immediately), `cancelRun(id)`, `undoRun(id): Promise<void>`, `RunRequest = { toolId; targetLayerId; scope; lod; params; prefix; columns: OutputColumn[] }`.

- [ ] **Step 1: scope test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../src/insights/duckdb", () => ({
  /* the same 12-key mock as Task 8 */
}));
const duck = await import("../../../../src/insights/duckdb");
const { resolveScope } =
  await import("../../../../src/features/processing/scope");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");

const table = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [{ name: "status", type: "VARCHAR", kind: "scalar" as const }],
  lods: [],
  rowCount: 3,
};

afterEach(() => {
  useSelectionStore.getState().clear();
  vi.clearAllMocks();
});

describe("resolveScope", () => {
  it("all: null ids and the feature count", async () => {
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["n"],
      rows: [{ n: 2 }],
    });
    expect(await resolveScope({ layerId: "L1", table, scope: "all" })).toEqual({
      ok: true,
      featureIds: null,
      count: 2,
    });
    expect(vi.mocked(duck.runQuery).mock.calls[0][0]).toContain(
      'COUNT(DISTINCT COALESCE("feature_id", "id"))',
    );
  });
  it("matching: the applied filter's feature ids", async () => {
    useQueryStore.getState().setFilter("L1", {
      logic: "AND",
      conditions: [{ id: "c1", column: "status", op: "=", value: "ok" }],
    });
    useQueryStore.getState().applyFilter("L1");
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id"],
      rows: [{ id: "a" }, { id: "a-part" }],
    });
    const out = await resolveScope({ layerId: "L1", table, scope: "matching" });
    expect(out).toEqual({ ok: true, featureIds: ["a", "a-part"], count: 1 });
  });
  it("matching without a filter is refused", async () => {
    expect(
      await resolveScope({ layerId: "L2", table, scope: "matching" }),
    ).toEqual({ ok: false, message: "No filter applied" });
  });
  it("selected: the selection expanded to features", async () => {
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L1", objectId: "a-part" }]);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id"],
      rows: [{ id: "a" }, { id: "a-part" }],
    });
    const out = await resolveScope({ layerId: "L1", table, scope: "selected" });
    expect(out).toEqual({ ok: true, featureIds: ["a", "a-part"], count: 1 });
    expect(vi.mocked(duck.runQuery).mock.calls[0][0]).toContain(
      `"id" IN ('a-part')`,
    );
  });
  it("selected on another layer is refused", async () => {
    useSelectionStore
      .getState()
      .selectMany([{ kind: "object", layerId: "L9", objectId: "z" }]);
    expect(
      await resolveScope({ layerId: "L1", table, scope: "selected" }),
    ).toEqual({ ok: false, message: "Nothing selected on this layer" });
  });
});
```

Adapt `setFilter`/`applyFilter` names to the real `queryStore` actions (read its 15 actions). Count of FEATURES for `matching`/`selected` is derived in JS: the number of distinct ids among the returned rows that have no parent in the returned set is not knowable from ids alone, so return the ids and compute `count` as the number of distinct `feature_id` values by selecting `COALESCE("feature_id","id") AS f` alongside `id` (two columns: `id`, `f`); the test rows above then become `{ id: "a", f: "a" }, { id: "a-part", f: "a" }`. Update the test accordingly and build the SQL with `buildFeatureIdsSql`'s WHERE plus the extra projection — add a sibling `buildFeatureRowsSql(table, where)` in `sql.ts` returning `SELECT "id", COALESCE("feature_id","id") AS f FROM t WHERE COALESCE("feature_id","id") IN (SELECT COALESCE("feature_id","id") FROM t WHERE <where>)`.

- [ ] **Step 2: implement `scope.ts`**

```ts
import { runQuery } from "../../insights/duckdb";
import {
  buildFeatureRowsSql,
  compileFilter,
  quoteIdent,
  quoteLiteral,
} from "../../insights/sql";
import type { LayerTable } from "../../insights/layerTables";
import { layerQuery, useQueryStore } from "../query/queryStore";
import { useSelectionStore } from "../selection/selectionStore";
import type { Scope } from "./types";

export type ScopeResolution =
  | {
      readonly ok: true;
      readonly featureIds: ReadonlyArray<string> | null;
      readonly count: number;
    }
  | { readonly ok: false; readonly message: string };

export async function resolveScope(input: {
  layerId: string;
  table: LayerTable;
  scope: Scope;
}): Promise<ScopeResolution> {
  const t = quoteIdent(input.table.table);
  if (input.scope === "all") {
    const out = await runQuery(
      `SELECT COUNT(DISTINCT COALESCE("feature_id", "id")) AS n FROM ${t}`,
    );
    if (!out.ok) return { ok: false, message: out.message };
    return { ok: true, featureIds: null, count: Number(out.rows[0]?.n ?? 0) };
  }
  let where: string;
  if (input.scope === "matching") {
    const applied = layerQuery(useQueryStore.getState(), input.layerId).applied;
    if (applied === null) return { ok: false, message: "No filter applied" };
    const compiled = compileFilter(applied, input.table.columns);
    if (!compiled.ok) return { ok: false, message: compiled.message };
    if (compiled.where === null)
      return { ok: false, message: "No filter applied" };
    where = compiled.where;
  } else {
    const ids = useSelectionStore
      .getState()
      .selections.filter((s) => s.layerId === input.layerId)
      .map((s) => s.objectId);
    if (ids.length === 0)
      return { ok: false, message: "Nothing selected on this layer" };
    where = `"id" IN (${[...new Set(ids)].map((id) => quoteLiteral(id)).join(", ")})`;
  }
  const out = await runQuery(buildFeatureRowsSql(input.table.table, where));
  if (!out.ok) return { ok: false, message: out.message };
  const featureIds = out.rows.map((r) => String(r.id));
  const count = new Set(out.rows.map((r) => String(r.f))).size;
  if (featureIds.length === 0)
    return { ok: false, message: "Nothing to run on (0 buildings)" };
  return { ok: true, featureIds, count };
}
```

- [ ] **Step 3: runQueue test** (`tests/unit/features/processing/runQueue.test.ts`; duckdb mocked as above; `layerTables` mocked so `getLayerTable` returns a ready table and `runOnTableQueue` runs the task immediately; `computedColumns` NOT mocked — its SQL goes to the duckdb mock)

```ts
it("runs one at a time, records phases and publishes a done card", async () => {
  registerExecutor("height-from-extent", async (run, ctx) => {
    ctx.phase("compute");
    await ctx.query("read extents", "SELECT 1");
    return {
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    };
  });
  const id = submitRun({
    toolId: "height-from-extent",
    targetLayerId: "L1",
    scope: "all",
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" }],
  });
  expect(runById(id)?.status).toBe("queued");
  await waitFor(() => expect(runById(id)?.status).toBe("done"));
  const run = runById(id)!;
  expect(run.summary?.line).toMatch(/^1 building measured · /);
  expect(run.log.map((l) => l.label)).toContain("read extents");
  expect(run.undoable).toBe(true);
  expect(
    useLayerStore.getState().layers[0].model.objects.a.attributes
      .extent_height_m,
  ).toBe(4);
  expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
});

it("queues a second run behind the first", async () => {
  /* two submits; the second's status stays "queued" until the first resolves a deferred; then "running" */
});

it("a cancel before publication leaves nothing behind", async () => {
  /* executor awaits ctx.signal; cancelRun(id); expect status "cancelled", no write SQL issued, no merge */
});

it("a failing executor lands as failed with the message and no write", async () => {
  /* executor throws new Error("Binder Error: x") → status failed, error "Binder Error: x" */
});

it("undo restores the layer and marks the run", async () => {
  /* after a done run: undoRun(id) → undoComputedColumns SQL issued (ALTER … DROP COLUMN), mergeAttributes with undefined, provenance removed, run.undoable false */
});

it("a table rebuild marks the layer's runs stale", async () => {
  /* useLayerTableStore.setState with a new info.table name for L1 → run.stale true */
});
```

Write each skeleton as a real test (the comments describe the assertions; use a `deferred()` helper and `@testing-library/react`'s `waitFor` or a small `until(fn)` poller).

- [ ] **Step 4: implement `runQueue.ts`**

```ts
import {
  getLayerTable,
  runOnTableQueue,
  useLayerTableStore,
} from "../../insights/layerTables";
import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import {
  undoComputedColumns,
  useComputedColumnStore,
  writeComputedColumns,
  type OutputColumn,
} from "../../insights/computedColumns";
import { useLayerStore, type Layer } from "../layers/layerStore";
import { useProcessingStore, runById } from "./processingStore";
import { resolveScope } from "./scope";
import { toolById } from "./toolRegistry";
import { EXECUTORS } from "./tools";
import type {
  LogEntry,
  RunPhase,
  RunRecord,
  RunSummary,
  Scope,
  SkipCount,
  ToolId,
} from "./types";
import type { LayerTable } from "../../insights/layerTables";

export interface RunRequest {
  readonly toolId: ToolId;
  readonly targetLayerId: string;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  readonly columns: ReadonlyArray<OutputColumn>;
}

export interface ToolContext {
  readonly table: LayerTable;
  readonly layer: Layer;
  readonly featureIds: ReadonlyArray<string> | null;
  readonly signal: AbortSignal;
  query(label: string, sql: string): Promise<QueryOutcome>;
  phase(p: RunPhase): void;
  warn(text: string): void;
}

export interface ToolResult {
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

export type ToolExecutor = (
  run: RunRecord,
  ctx: ToolContext,
) => Promise<ToolResult>;

class CancelledError extends Error {}

const controllers = new Map<string, AbortController>();
const undoState = new Map<
  string,
  {
    table: string;
    backupTable: string | null;
    created: string[];
    replaced: string[];
    ids: string[] | null;
    previousModelValues: Map<string, Record<string, unknown>>;
  }
>();
let counter = 0;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

export function summarise(result: ToolResult, elapsedMs: number): RunSummary {
  const skippedTotal = result.skipped.reduce((a, s) => a + s.count, 0);
  const parts = [
    plural(result.measured, "building measured", "buildings measured"),
  ];
  if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
  parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);
  const detail =
    skippedTotal > 0
      ? `${fmt(skippedTotal)} skipped: ${result.skipped.map((s) => `${fmt(s.count)} ${s.cause}`).join(" · ")}`
      : null;
  return {
    line: parts.join(" · "),
    detail,
    measured: result.measured,
    skipped: result.skipped,
  };
}

export function submitRun(request: RunRequest): string {
  const layer = useLayerStore
    .getState()
    .layers.find((l) => l.id === request.targetLayerId);
  const tool = toolById(request.toolId);
  const id = `run_${++counter}`;
  const record: RunRecord = {
    id,
    toolId: request.toolId,
    targetLayerId: request.targetLayerId,
    targetName: layer?.name ?? "?",
    sourceLayerId: null,
    sourceName: null,
    scope: request.scope,
    scopeCount: 0,
    featureIds: null,
    lod: request.lod,
    params: request.params,
    prefix: request.prefix,
    columns: request.columns.map((c) => c.name),
    status: "queued",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
  };
  useProcessingStore.getState().upsertRun(record);
  const controller = new AbortController();
  controllers.set(id, controller);
  void runOnTableQueue(() => execute(id, request, controller.signal)).catch(
    () => {},
  );
  void tool;
  return id;
}

const patch = (id: string, p: Partial<RunRecord>) =>
  useProcessingStore.getState().patchRun(id, p);

async function execute(
  id: string,
  request: RunRequest,
  signal: AbortSignal,
): Promise<void> {
  const started = performance.now();
  const log: LogEntry[] = [];
  const warnings: string[] = [];
  const elapsed = () => Math.round(performance.now() - started);
  if (signal.aborted) {
    patch(id, { status: "cancelled", elapsedMs: 0 });
    return;
  }
  const layer = useLayerStore
    .getState()
    .layers.find((l) => l.id === request.targetLayerId);
  const table = getLayerTable(request.targetLayerId);
  if (!layer) {
    patch(id, { status: "failed", error: "Layer removed" });
    return;
  }
  if (!table) {
    patch(id, {
      status: "failed",
      error: "This layer's table could not be built",
    });
    return;
  }
  const executor = EXECUTORS[request.toolId];
  if (!executor) {
    patch(id, { status: "failed", error: "Not available yet" });
    return;
  }

  const scope = await resolveScope({
    layerId: layer.id,
    table,
    scope: request.scope,
  });
  if (!scope.ok) {
    patch(id, { status: "failed", error: scope.message, elapsedMs: elapsed() });
    return;
  }
  patch(id, {
    status: "running",
    phase: "compute",
    featureIds: scope.featureIds,
    scopeCount: scope.count,
    startedAt: Date.now(),
  });

  const ctx: ToolContext = {
    table,
    layer,
    featureIds: scope.featureIds,
    signal,
    async query(label, sql) {
      if (signal.aborted) throw new CancelledError();
      const t0 = performance.now();
      const out = await runQuery(sql);
      log.push({
        label,
        sql,
        ms: Math.round(performance.now() - t0),
        rows: out.ok ? out.rows.length : null,
      });
      patch(id, { log: [...log] });
      if (!out.ok) throw new Error(out.message);
      return out;
    },
    phase(p) {
      patch(id, { phase: p });
    },
    warn(text) {
      warnings.push(text);
      patch(id, { warnings: [...warnings] });
    },
  };

  try {
    const record = runById(id)!;
    const result = await executor(record, ctx);
    if (signal.aborted) throw new CancelledError();
    patch(id, { phase: "write" });
    const existing = new Set(table.columns.map((c) => c.name));
    const t0 = performance.now();
    const written = await writeComputedColumns({
      runId: id,
      table: table.table,
      columns: result.columns,
      rows: result.rows,
      existing,
    });
    log.push({
      label: "Writing results",
      sql: null,
      ms: Math.round(performance.now() - t0),
      rows: result.rows.size,
    });
    if (!written.ok) throw new Error(written.message);
    // Publication: model + provenance + registry, then the card.
    const previousModelValues = new Map<string, Record<string, unknown>>();
    const merge = new Map<string, Record<string, unknown>>();
    for (const [objectId, values] of result.rows) {
      const obj = layer.model.objects[objectId];
      if (!obj) continue;
      const prev: Record<string, unknown> = {};
      for (const col of result.columns)
        prev[col.name] = obj.attributes[col.name];
      previousModelValues.set(objectId, prev);
      merge.set(objectId, values);
    }
    useLayerStore.getState().mergeAttributes(layer.id, merge);
    const tool = toolById(request.toolId);
    const total = table.rowCount ?? result.rows.size;
    for (const col of result.columns) {
      const previous =
        useComputedColumnStore.getState().byLayer[layer.id]?.[col.name] ?? null;
      useComputedColumnStore.getState().setProvenance(layer.id, col.name, {
        runId: id,
        toolName: tool.name,
        summary: `${request.lod ? `LoD ${request.lod} · ` : ""}${scopeLabel(request.scope, scope.count)}`,
        at: Date.now(),
        partial:
          scope.featureIds === null ? null : { count: result.rows.size, total },
        previous,
      });
    }
    // Any earlier run that wrote one of these columns loses its Undo (spec §6.2).
    for (const r of useProcessingStore.getState().runs) {
      if (
        r.id !== id &&
        r.targetLayerId === layer.id &&
        r.undoable &&
        r.columns.some((c) => result.columns.some((n) => n.name === c))
      ) {
        patch(r.id, { undoable: false });
      }
    }
    undoState.set(id, {
      table: table.table,
      backupTable: written.backupTable,
      created: result.columns
        .map((c) => c.name)
        .filter((n) => !existing.has(n)),
      replaced: result.columns
        .map((c) => c.name)
        .filter((n) => existing.has(n)),
      ids: scope.featureIds === null ? null : [...result.rows.keys()],
      previousModelValues,
    });
    // Refresh the table's column list so the grid and the next run see the new columns.
    await refreshTableColumns(layer.id);
    const summary = summarise(result, elapsed());
    patch(id, {
      status: "done",
      phase: null,
      elapsedMs: elapsed(),
      summary,
      log: [...log],
      undoable: true,
      note: signal.aborted ? "finished before the cancel arrived" : null,
    });
    useProcessingStore.getState().pushNotice(summary.line);
  } catch (e) {
    if (e instanceof CancelledError || signal.aborted) {
      patch(id, {
        status: "cancelled",
        phase: null,
        elapsedMs: elapsed(),
        log: [...log],
      });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    patch(id, {
      status: "failed",
      phase: null,
      elapsedMs: elapsed(),
      error: message,
      log: [...log],
    });
  } finally {
    controllers.delete(id);
  }
}

function scopeLabel(scope: Scope, count: number): string {
  const n = plural(count, "building", "buildings");
  return scope === "all"
    ? `All ${n}`
    : scope === "matching"
      ? `Matching ${n}`
      : `Selected ${n}`;
}

export function cancelRun(id: string): void {
  const run = runById(id);
  if (!run) return;
  const controller = controllers.get(id);
  if (run.status === "queued") {
    controller?.abort();
    patch(id, { status: "cancelled" });
    return;
  }
  if (run.status === "running") {
    patch(id, { status: "cancelling" });
    controller?.abort();
  }
}

export async function undoRun(id: string): Promise<void> {
  const run = runById(id);
  const state = undoState.get(id);
  if (!run || !run.undoable || !state) return;
  const out = await runOnTableQueue(() =>
    undoComputedColumns({
      table: state.table,
      backupTable: state.backupTable,
      created: state.created,
      replaced: state.replaced,
      ids: state.ids,
    }),
  );
  if (!out.ok) {
    patch(id, { error: out.message });
    return;
  }
  useLayerStore
    .getState()
    .mergeAttributes(run.targetLayerId, state.previousModelValues);
  const reg = useComputedColumnStore.getState();
  reg.removeColumns(run.targetLayerId, state.created);
  for (const col of state.replaced) {
    const p = reg.byLayer[run.targetLayerId]?.[col];
    if (p?.previous) reg.setProvenance(run.targetLayerId, col, p.previous);
    else reg.removeColumns(run.targetLayerId, [col]);
  }
  undoState.delete(id);
  await refreshTableColumns(run.targetLayerId);
  patch(id, { undoable: false, note: "Undone" });
}

/** The registry's `columns` come from DESCRIBE at build time; re-describe after a write. Implemented in layerTables.ts as `refreshLayerTableColumns(layerId)` (Task 9 step 5). */
async function refreshTableColumns(layerId: string): Promise<void> {
  const { refreshLayerTableColumns } =
    await import("../../insights/layerTables");
  await refreshLayerTableColumns(layerId);
}

/** Spec §7: a rebuilt table loses computed columns; mark the layer's runs stale. */
export function installStaleWatcher(): () => void {
  let previous = useLayerTableStore.getState().tables;
  return useLayerTableStore.subscribe((s) => {
    const next = s.tables;
    for (const [layerId, state] of Object.entries(next)) {
      const before = previous[layerId];
      const rebuilt =
        state.state === "ready" &&
        before?.state === "ready" &&
        before.info !== state.info &&
        before.info.table !== state.info.table;
      if (
        rebuilt ||
        (state.state === "ready" && before?.state === "building")
      ) {
        for (const r of useProcessingStore.getState().runs) {
          if (r.targetLayerId === layerId && r.status === "done" && !r.stale)
            patch(r.id, { stale: true, undoable: false });
        }
        useComputedColumnStore.getState().clearLayer(layerId);
      }
    }
    previous = next;
  });
}
```

`tools/index.ts`:

```ts
import type { ToolExecutor } from "../runQueue";
import type { ToolId } from "../types";
export const EXECUTORS: Partial<Record<ToolId, ToolExecutor>> = {};
export function registerExecutor(id: ToolId, executor: ToolExecutor): void {
  EXECUTORS[id] = executor;
}
```

(`runQueue.ts` imports `EXECUTORS` from `./tools` and `tools/index.ts` imports only the TYPE from `../runQueue`, so there is no runtime cycle.)

- [ ] **Step 5: `refreshLayerTableColumns` in layerTables.ts**

Export `refreshLayerTableColumns(layerId): Promise<void>`: if the registry has a ready entry, run `DESCRIBE "<table>"` through `runQuery`, map to `ColumnInfo` with `classifyColumnType` (the same code the build uses; extract a helper if it is inline), and publish a new `info` object with the new `columns` (same `table` name, so the stale watcher does not fire; the watcher compares `table` names, and `rebuilding` transitions only). Add a unit test in `layerTablesBuild.test.ts`: after a mocked DESCRIBE returning one extra column, the store's `info.columns` includes it and `info.table` is unchanged.

- [ ] **Step 6: Wire the stale watcher** — call `installStaleWatcher()` once in `App.tsx` next to `installLayerTableLifecycle()` (return the unsubscribe from the same effect).

- [ ] **Step 7: Run** — `npx vitest run tests/unit/features/processing tests/unit/insights` → PASS; `npx tsc -b --noEmit` clean.

- [ ] **Step 8: Commit** — `git add src/features/processing src/insights/layerTables.ts src/insights/sql.ts src/app/App.tsx tests/unit && git commit -m "feat(processing): scope resolution and single-flight run queue with undo and stale tracking"`.

---

### Task 10: Height from extent executor (spec §7.4)

**Files:**

- Create: `src/features/processing/tools/heightFromExtent.ts`
- Modify: `src/features/processing/tools/index.ts` (register)
- Test: `tests/unit/features/processing/heightFromExtent.test.ts`

**Interfaces:**

- Consumes: `ToolContext`, `ToolResult`, `registerExecutor`.
- Produces: `heightFromExtent: ToolExecutor`; `rollUpExtents(rows): { rows, measured, skipped }` (pure, exported for tests). Columns `<prefix>height_m`, `<prefix>zmin_m`, `<prefix>zmax_m`, all `DOUBLE`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  rollUpExtents,
  buildExtentSql,
} from "../../../../src/features/processing/tools/heightFromExtent";

describe("height from extent", () => {
  it("selects the bbox fields per row within the scope", () => {
    expect(buildExtentSql("layer_1", null)).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, "bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM "layer_1"`,
    );
    expect(buildExtentSql("layer_1", ["a", "b"])).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, "bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM "layer_1" WHERE "id" IN ('a', 'b')`,
    );
  });

  it("rolls parts up to the feature: max zmax minus min zmin, written to root and parts", () => {
    const out = rollUpExtents(
      [
        { id: "B", f: "B", zmin: 1, zmax: 5 },
        { id: "B-1", f: "B", zmin: 0.5, zmax: 9 },
        { id: "C", f: "C", zmin: null, zmax: null },
      ],
      "extent_",
    );
    expect(out.rows.get("B")).toEqual({
      extent_height_m: 8.5,
      extent_zmin_m: 0.5,
      extent_zmax_m: 9,
    });
    expect(out.rows.get("B-1")).toEqual({
      extent_height_m: 8.5,
      extent_zmin_m: 0.5,
      extent_zmax_m: 9,
    });
    expect(out.rows.get("C")).toEqual({
      extent_height_m: null,
      extent_zmin_m: null,
      extent_zmax_m: null,
    });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```ts
import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

export interface ExtentRow {
  readonly id: string;
  readonly f: string;
  readonly zmin: number | null;
  readonly zmax: number | null;
}

export function buildExtentSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((i) => quoteLiteral(i)).join(", ")})`;
  return `SELECT "id", COALESCE("feature_id", "id") AS f, "bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM ${quoteIdent(table)}${where}`;
}

export function rollUpExtents(rows: ReadonlyArray<ExtentRow>, prefix: string) {
  const byFeature = new Map<string, { zmin: number; zmax: number } | null>();
  const members = new Map<string, string[]>();
  for (const r of rows) {
    members.set(r.f, [...(members.get(r.f) ?? []), r.id]);
    if (r.zmin === null || r.zmax === null) {
      if (!byFeature.has(r.f)) byFeature.set(r.f, null);
      continue;
    }
    const cur = byFeature.get(r.f) ?? null;
    byFeature.set(
      r.f,
      cur
        ? { zmin: Math.min(cur.zmin, r.zmin), zmax: Math.max(cur.zmax, r.zmax) }
        : { zmin: r.zmin, zmax: r.zmax },
    );
  }
  const out = new Map<string, Record<string, number | null>>();
  let measured = 0;
  let skipped = 0;
  for (const [f, ext] of byFeature) {
    if (ext) measured += 1;
    else skipped += 1;
    for (const id of members.get(f) ?? []) {
      out.set(id, {
        [`${prefix}height_m`]: ext ? ext.zmax - ext.zmin : null,
        [`${prefix}zmin_m`]: ext ? ext.zmin : null,
        [`${prefix}zmax_m`]: ext ? ext.zmax : null,
      });
    }
  }
  const skippedCounts: SkipCount[] =
    skipped > 0 ? [{ cause: "no geometry", count: skipped }] : [];
  return { rows: out, measured, skipped: skippedCounts };
}

export const heightFromExtent: ToolExecutor = async (run, ctx) => {
  ctx.phase("compute");
  const out = await ctx.query(
    "Reading extents",
    buildExtentSql(ctx.table.table, ctx.featureIds),
  );
  const rows: ExtentRow[] = out.rows.map((r) => ({
    id: String(r.id),
    f: String(r.f),
    zmin: r.zmin === null || r.zmin === undefined ? null : Number(r.zmin),
    zmax: r.zmax === null || r.zmax === undefined ? null : Number(r.zmax),
  }));
  const rolled = rollUpExtents(rows, run.prefix);
  return {
    columns: [
      `${run.prefix}height_m`,
      `${run.prefix}zmin_m`,
      `${run.prefix}zmax_m`,
    ].map((name) => ({ name, type: "DOUBLE" as const })),
    rows: rolled.rows,
    measured: rolled.measured,
    skipped: rolled.skipped,
  };
};

registerExecutor("height-from-extent", heightFromExtent);
```

Import `./tools/heightFromExtent` once from `src/features/processing/tools/index.ts`'s consumer — simplest: add `import "./heightFromExtent";` at the bottom of `tools/index.ts` is a cycle; instead create `src/features/processing/tools/register.ts` with `import "./heightFromExtent";` and import that file from `runQueue.ts` (`import "./tools/register";`). A DuckDB STRUCT cell may arrive as an object rather than flattened; the SQL projects the fields, so `r.zmin` is a number or null.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add src/features/processing/tools tests/unit/features/processing/heightFromExtent.test.ts && git commit -m "feat(processing): Height from extent tool"`.

---

### Task 11: Tool view, run footer, recent runs, log view (spec §6)

**Files:**

- Replace placeholders: `src/ui/processing/ToolView.tsx`, `src/ui/processing/LogView.tsx`, `src/ui/processing/RecentRuns.tsx`
- Create: `src/ui/processing/RunFooter.tsx`, `src/ui/processing/useToolForm.ts`
- Modify: `src/ui/processing/processing.css`
- Test: `tests/unit/ui/processing/ToolView.test.tsx`, `tests/unit/ui/processing/RecentRuns.test.tsx`, `tests/unit/ui/processing/LogView.test.tsx`

**Interfaces:**

- Consumes: `useProcessingStore`, `toolById`, `toolEligibility` + `useEligibilityContext`, `useLayerCounts(layerId)`, `useLayerStore`, `getLayerTable`/`useLayerTableStore`, `submitRun`, `cancelRun`, `undoRun`, `resolveActiveLayer`, `useShellStore.openDrawer`/`requestSection`, `activateLayer`.
- Produces: `useToolForm(toolId)` returning `{ draft, setDraft, eligibleTargets: Layer[], target: Layer | null, counts, columns: string[], existing: string[], sourceCollisions: string[], prefixError: string | null, canRun: boolean, runReason: string | null, latestRun: RunRecord | null }`.

- [ ] **Step 1: `useToolForm`**

```ts
import { useMemo } from "react";
import { useLayerStore, type Layer } from "../../features/layers/layerStore";
import { useLayerTableStore } from "../../insights/layerTables";
import { useLayerCounts } from "../table/useLayerCounts";
import {
  computedColumnsOf,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import { toolEligibility } from "../../features/processing/eligibility";
import type { ToolId } from "../../features/processing/types";
import { useEligibilityContext } from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";

/** Output column names per tool; M1 knows one tool, later milestones extend this map. */
export const OUTPUT_COLUMNS: Readonly<
  Partial<
    Record<
      ToolId,
      (prefix: string, params: Readonly<Record<string, unknown>>) => string[]
    >
  >
> = {
  "height-from-extent": (p) => [`${p}height_m`, `${p}zmin_m`, `${p}zmax_m`],
};

const PREFIX_RE = /^[a-z][a-z0-9_]*$/i;

export function useToolForm(toolId: ToolId) {
  const tool = toolById(toolId);
  const active = useActiveLayer();
  const layers = useLayerStore((s) => s.layers);
  const tables = useLayerTableStore((s) => s.tables);
  const drafts = useProcessingStore((s) => s.drafts);
  const runs = useProcessingStore((s) => s.runs);
  useComputedColumnStore((s) => s.byLayer); // subscribe: the replace warning depends on it
  const eligibleTargets = useMemo(
    () => layers.filter((l) => tables[l.id]?.state === "ready"),
    [layers, tables],
  );
  const stored = drafts[toolId];
  const defaultTarget =
    active?.kind === "city" &&
    eligibleTargets.some((l) => l.id === active.layer.id)
      ? active.layer.id
      : (eligibleTargets[0]?.id ?? null);
  const draft: ToolDraft = stored ?? {
    targetLayerId: defaultTarget,
    scope: "all",
    lod: null,
    prefix: tool.defaultPrefix,
    params: {},
  };
  const target = layers.find((l) => l.id === draft.targetLayerId) ?? null;
  const counts = useLayerCounts(target?.id ?? null);
  const targetCtx = useEligibilityContext(
    target ? { kind: "city", layer: target } : null,
  );
  const eligibility = toolEligibility(tool, targetCtx);
  const columns = (OUTPUT_COLUMNS[toolId] ?? (() => []))(
    draft.prefix,
    draft.params,
  );
  const tableInfo =
    target && tables[target.id]?.state === "ready" ? tables[target.id] : null;
  const tableColumns =
    tableInfo && tableInfo.state === "ready"
      ? tableInfo.info.columns.map((c) => c.name)
      : [];
  const computed = target ? computedColumnsOf(target.id) : new Set<string>();
  const existing = columns.filter((c) => tableColumns.includes(c));
  const sourceCollisions = existing.filter((c) => !computed.has(c));
  const prefixError = !PREFIX_RE.test(draft.prefix)
    ? "Use letters, digits and underscores, starting with a letter"
    : sourceCollisions.length > 0
      ? `'${sourceCollisions[0]}' belongs to the source data; choose another prefix`
      : null;
  const scopeReason =
    draft.scope === "matching" && counts.matching === null
      ? "No filter applied"
      : draft.scope === "selected" && !(counts.selected && counts.selected > 0)
        ? "Nothing selected on this layer"
        : null;
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (prefixError ?? scopeReason);
  const latestRun =
    runs.find((r) => r.toolId === toolId && r.targetLayerId === target?.id) ??
    null;
  const busy = runs.some(
    (r) => r.status === "running" || r.status === "cancelling",
  );
  return {
    tool,
    draft,
    eligibleTargets,
    target,
    counts,
    columns,
    existing,
    prefixError,
    eligibility,
    canRun: runReason === null && target !== null,
    runReason,
    latestRun,
    busy,
    setDraft: (patch: Partial<ToolDraft>) =>
      useProcessingStore.getState().setDraft(toolId, { ...draft, ...patch }),
  };
}
```

`useLayerCounts` returns `matching: null` when no filter is applied? Check `useLayerCounts.ts`: if it returns the `all` count when no filter is applied, derive `noFilter` from `layerQuery(state, id).applied === null` instead (import `useQueryStore` and `layerQuery`).

- [ ] **Step 2: Failing ToolView test** (duckdb mocked; `runQueue` mocked with `vi.mock("../../../../src/features/processing/runQueue", () => ({ submitRun: vi.fn(() => "run_1"), cancelRun: vi.fn(), undoRun: vi.fn(async () => {}) }))`; `useLayerCounts` mocked to return `{ all: 2, matching: null, selected: 0, loading: false, message: null }`; a layer + ready table seeded as in the catalogue test)

```tsx
it("renders TARGET, scope counts, OUTPUT columns and runs with the draft", () => {
  render(<ToolView toolId="height-from-extent" />);
  expect(
    screen.getByRole("heading", { name: "Height from extent" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(layerId);
  expect(screen.getByRole("radio", { name: "All 2 buildings" })).toBeChecked();
  expect(screen.getByRole("radio", { name: /Matching/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /Selected/ })).toBeDisabled();
  expect(
    screen.getByText("extent_height_m, extent_zmin_m, extent_zmax_m"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(submitRun).toHaveBeenCalledWith(
    expect.objectContaining({
      toolId: "height-from-extent",
      targetLayerId: layerId,
      scope: "all",
      prefix: "extent_",
      columns: [
        { name: "extent_height_m", type: "DOUBLE" },
        { name: "extent_zmin_m", type: "DOUBLE" },
        { name: "extent_zmax_m", type: "DOUBLE" },
      ],
    }),
  );
});

it("rejects a prefix that collides with a source attribute", () => {
  // seed the table columns with "height_m"
  render(<ToolView toolId="height-from-extent" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
    target: { value: "" },
  });
  // empty prefix → "height_m" collides with the source column
  expect(
    screen.getByText(
      "'height_m' belongs to the source data; choose another prefix",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
});

it("shows the replace warning for computed columns and the running / done / failed footers", () => {
  // seed computed column "extent_height_m" in useComputedColumnStore and the table columns
  render(<ToolView toolId="height-from-extent" />);
  expect(
    screen.getByText("1 of these columns exist; they will be replaced."),
  ).toBeInTheDocument();
  useProcessingStore.getState().upsertRun(
    runFixture({
      status: "running",
      phase: "compute",
      targetLayerId: layerId,
    }),
  );
  expect(screen.getByText(/Computing/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Cancel run" }),
  ).toBeInTheDocument();
  useProcessingStore.getState().patchRun("r1", {
    status: "done",
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
    },
    undoable: true,
  });
  expect(screen.getByText("2 buildings measured · 0.3 s")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  useProcessingStore
    .getState()
    .patchRun("r1", { status: "failed", error: "Binder Error: x" });
  expect(screen.getByText("Binder Error: x")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement `ToolView`**

```tsx
import { useProcessingStore } from "../../features/processing/processingStore";
import { submitRun } from "../../features/processing/runQueue";
import type { ToolId } from "../../features/processing/types";
import { useToolForm } from "./useToolForm";
import { RunFooter } from "./RunFooter";

const fmt = (n: number | null) =>
  n === null ? "?" : n.toLocaleString("en-US");

export function ToolView({ toolId }: { readonly toolId: ToolId }) {
  const f = useToolForm(toolId);
  const locked =
    f.latestRun !== null &&
    (f.latestRun.status === "running" ||
      f.latestRun.status === "queued" ||
      f.latestRun.status === "cancelling");
  const run = () => {
    if (!f.target || !f.canRun) return;
    submitRun({
      toolId,
      targetLayerId: f.target.id,
      scope: f.draft.scope,
      lod: f.draft.lod,
      params: f.draft.params,
      prefix: f.draft.prefix,
      columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const })),
    });
  };
  return (
    <form
      className="processing-tool"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <div className="processing-tool__head">
        <button
          type="button"
          className="processing-back"
          aria-label="Back to tools"
          onClick={() => useProcessingStore.getState().back()}
        >
          ‹
        </button>
        <h2 className="processing-tool__title">{f.tool.name}</h2>
        {f.tool.extension && (
          <span className="processing-chip">
            {f.tool.extension === "spatial" ? "Spatial" : "3D"}
          </span>
        )}
      </div>
      <p className="processing-tool__desc">{f.tool.longDescription}</p>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">TARGET</legend>
        <label className="processing-field">
          <span>Layer</span>
          <select
            aria-label="Layer"
            value={f.target?.id ?? ""}
            onChange={(e) => f.setDraft({ targetLayerId: e.target.value })}
          >
            {f.eligibleTargets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="processing-field">
          <span>Scope</span>
          <div
            className="processing-radios"
            role="radiogroup"
            aria-label="Scope"
          >
            <label>
              <input
                type="radio"
                name="scope"
                checked={f.draft.scope === "all"}
                onChange={() => f.setDraft({ scope: "all" })}
              />
              All {fmt(f.counts.all)} buildings
            </label>
            <label
              title={
                f.counts.matching === null ? "No filter applied" : undefined
              }
            >
              <input
                type="radio"
                name="scope"
                disabled={f.counts.matching === null}
                checked={f.draft.scope === "matching"}
                onChange={() => f.setDraft({ scope: "matching" })}
              />
              Matching {fmt(f.counts.matching)}
            </label>
            <label
              title={
                !f.counts.selected
                  ? "Nothing selected on this layer"
                  : undefined
              }
            >
              <input
                type="radio"
                name="scope"
                disabled={!f.counts.selected}
                checked={f.draft.scope === "selected"}
                onChange={() => f.setDraft({ scope: "selected" })}
              />
              Selected {fmt(f.counts.selected)}
            </label>
          </div>
          {f.target?.isStreaming && (
            <p className="processing-note">
              Runs over the {fmt(f.counts.all)} currently loaded buildings, not
              the whole dataset.
            </p>
          )}
        </div>
      </fieldset>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">OUTPUT</legend>
        <label className="processing-field">
          <span>Prefix</span>
          <input
            type="text"
            aria-label="Prefix"
            value={f.draft.prefix}
            onChange={(e) => f.setDraft({ prefix: e.target.value })}
            aria-invalid={f.prefixError !== null}
          />
        </label>
        {f.prefixError && (
          <p className="processing-error" role="alert">
            {f.prefixError}
          </p>
        )}
        <p className="processing-note">Columns:</p>
        <p className="processing-columns">{f.columns.join(", ")}</p>
        {f.existing.length > 0 && f.prefixError === null && (
          <p className="processing-warning">
            ⚠ {f.existing.length} of these columns exist; they will be replaced.
          </p>
        )}
      </fieldset>
      <RunFooter
        run={f.latestRun}
        canRun={f.canRun && !f.busy}
        reason={
          f.runReason ?? (f.busy ? "Queued behind the running tool" : null)
        }
        onRun={run}
        targetLayerId={f.target?.id ?? null}
      />
    </form>
  );
}
```

`RunFooter.tsx` renders by `run?.status`: none/cancelled/undone → Cancel (ghost, `back()`) + Run (filled, `disabled={!canRun}`, reason under it); `queued` → "Queued behind …" + Cancel; `running`/`cancelling` → indeterminate bar (`<div className="processing-progress" role="progressbar" aria-busy="true">`), phase line "Loading extension ✓ · Reading source ✓ · Computing … · Writing results" with ticks for phases before the current one (M1 runs skip `extension` and `source`, show them ticked as "skipped"), elapsed timer (`useEffect` + `setInterval` 250 ms from `run.startedAt`), button "Cancel run" → `cancelRun(run.id)`; `done` → the card (§6.2): line, detail, "Wrote N columns to <target>.", buttons **Open table** (`activateLayer(targetLayerId)` then `useShellStore.getState().openDrawer()`), **Style by result** (`useShellStore.getState().requestSection(targetLayerId, "style")`; the rule draft prefill is Task 13), **Undo** (`undoRun(run.id)`, only when `run.undoable`), **Log** (`openLog(run.id)`), and **Run again** (filled; calls `onRun`); `failed` → "✕ Failed after X s", the error line, **Retry** (`onRun`) and **Log**. The `note` field renders as a muted line when set.

`RecentRuns.tsx` lists `runs` (newest first) with the dot (`data-status`), tool name, target (and "← source"), elapsed, status word, second line (summary or error), and buttons **Log**, **Undo** (undoable only), **Retry** (failed) or **Cancel** (queued/running), **Edit & run** (`openTool(toolId)` — the draft is already the last one). Stale runs read "stale: layer reloaded" with a Re-run.

`LogView.tsx`: header definition list (tool, target layer, source layer "—", scope "All · 1,115 buildings (frozen at 14:02:11)", LoD, building geometry "—", parameters, output columns with units, started, elapsed, status), then each `LogEntry` as label + `<pre>` SQL + "0.412 s · 1,116 rows", warnings, error, **Copy** (`navigator.clipboard.writeText(text)`; the text is assembled by a pure `formatRunLog(run): string` exported for the test), back chevron.

- [ ] **Step 4: CSS** — append rules for `.processing-tool`, `.processing-tool__head` (flex, gap 8), `.processing-tool__title` (Outfit 500 16px), `.processing-back` (30×30 ghost), `.processing-section` (border 0, padding 0, margin 0 0 14px), `.processing-field` (grid `64px 1fr`, gap 8, align-items center, margin-bottom 8; `select`/`input` full width at `--control-height-compact`), `.processing-radios` (column, gap 6, `label` flex gap 6, 12px), `.processing-note`/`.processing-columns` (11px muted; columns in `var(--font-mono)`), `.processing-error` (`--brand-accent`), `.processing-warning` (`--brand-secondary` text), `.processing-footer` (sticky bottom, border-top hairline, padding 10px 0, flex end, gap 8; Run = `min-height: var(--control-height)`, `background: var(--lime-500) !important; color: #1a2200 !important`), `.processing-progress` (3px bar with an animated 30% segment; `@media (prefers-reduced-motion: reduce)` static), `.processing-card` (lime hairline, 8px radius, padding 10), `.processing-run` rows for RecentRuns with `.processing-run__dot[data-status]` colours (done lime-500, failed brand-secondary, cancelled fg-dim, running pulsing lime, queued hollow).

- [ ] **Step 5: Run tests, tsc, browser** — `npx vitest run tests/unit/ui/processing && npx tsc -b --noEmit`; then `npm run dev`, Delft sample: Tools → Height from extent → Run: the footer shows the phases, then the card; Recent runs lists it; Undo works; the drawer (Open table) shows three new columns.

- [ ] **Step 6: Commit** — `git add src/ui/processing tests/unit/ui/processing && git commit -m "feat(processing): tool form, run footer, recent runs and log view"`.

---

### Task 12: Computed badges in the table and Details, and the COMPUTED groups (spec §8)

**Files:**

- Modify: `src/ui/table/DataGrid.tsx` (header badge when the column is in `computedColumnsOf(layerId)`), `src/ui/table/ColumnsPanel.tsx` (same), `src/ui/details/LayerAttributesSection.tsx` (split into ATTRIBUTES and a COMPUTED sub-heading with badge + provenance tooltip), `src/ui/layers/RulesEditor.tsx` (COMPUTED optgroup in the attribute select)
- Test: extend `tests/unit/ui/table/DataGrid.test.tsx` (or the grid's test file), `tests/unit/ui/details/*LayerAttributesSection*.test.tsx`, `tests/unit/ui/layers/RulesEditor*.test.tsx`

**Interfaces:**

- Consumes: `useComputedColumnStore`, `computedColumnsOf`, `provenanceOf`, `ComputedAttributeBadge`.
- Produces: `formatProvenance(p: Provenance): string` in `computedColumns.ts` → `"Measure solids · LoD 2.2 · 2026-09-10 14:02"` plus `" · 312 of 1,204 buildings in this run; the rest from <previous toolName> · <time>"` when partial.

- [ ] **Step 1: Failing tests**
  - DataGrid: seed `useComputedColumnStore` with `{ L1: { extent_height_m: provenance } }`, render the grid with a column `extent_height_m` for layer `L1`, expect `screen.getByRole("img", { name: "Computed by Roofy" })` inside that header cell and its `title` to equal `formatProvenance(p)`.
  - LayerAttributesSection: with attributes `{ function: "x", extent_height_m: 4.2 }` and the registry seeded, expect a heading "COMPUTED" containing `extent_height_m` with the badge, and `function` NOT under it.
  - RulesEditor: with the layer's model carrying `extent_height_m` on an object and the registry seeded, expect the attribute `<select>` to have an `<optgroup label="Computed">` containing `extent_height_m`.

- [ ] **Step 2: Implement**
  - `computedColumns.ts`: `export function formatProvenance(p: Provenance): string` (date via `new Date(p.at)` formatted `YYYY-MM-DD HH:mm` local).
  - `ComputedAttributeBadge`: add an optional `title?: string` prop (default the current text) so the provenance can replace the generic sentence.
  - DataGrid / ColumnsPanel: read `useComputedColumnStore((s) => s.byLayer[layerId])` and render `<ComputedAttributeBadge title={formatProvenance(p)} />` beside the header label for those columns (keep the existing badge for the synthetic `__roofy_*` columns).
  - LayerAttributesSection: partition `Object.entries(attributes)` by membership in the registry; render the existing list for the rest and, when the computed set is non-empty, `<h4 className="details-section-title">COMPUTED</h4>` + rows with the badge and `title`.
  - RulesEditor: after `orderFields`, split into `computed` (in the registry for this layer) and `rest`; render `<optgroup label="Computed">` after the existing options.

- [ ] **Step 3: Run** the three test files + `npx tsc -b --noEmit` → PASS. **Step 4: Commit** `git commit -am "feat(processing): computed badges and COMPUTED groups in table, Details and rules"`.

---

### Task 13: Toast, Open table and Style by result wiring

**Files:**

- Modify: `src/app/App.tsx` (subscribe to `noticeSeq`), `src/ui/processing/RunFooter.tsx` (Style by result prefill), `src/features/layers/layerStore.ts` only if no draft-rule mechanism exists (see below)
- Test: `tests/unit/app/appProcessingToast.test.tsx`, extend `tests/unit/ui/processing/ToolView.test.tsx`

- [ ] **Step 1: Toast** — in `App.tsx`, inside the effect that installs listeners:

```ts
const unsubNotice = useProcessingStore.subscribe((s, prev) => {
  if (s.noticeSeq !== prev.noticeSeq && s.notice) showToast(s.notice);
});
```

where `showToast` is the existing function that sets the toast state and (re)arms `toastTimerRef` (find it by searching `setToast(` in App.tsx; if the logic is inline, extract `showToast(text)` first). Test: render `App` with the existing mocks (copy `appViewerShell.test.tsx`'s setup), call `useProcessingStore.getState().pushNotice("2 buildings measured · 0.3 s")` inside `act`, expect the text in the document.

- [ ] **Step 2: Style by result** — spec §6.2: open STYLE with Color by = Rules and the rule editor open on a DRAFT whose attribute is the first column the run wrote, operator `>`, value the column's median, next palette colour. Read how `RulesEditor` opens its inline editor and keeps per-layer drafts (spec §12.x "Drafts are kept per layer"; search `draft` in `RulesEditor.tsx`/`StyleSection.tsx`). If a store-level draft exists (e.g. `ruleDraftStore` or a `draft` field in `shellStore`), write `{ attribute, op: ">", value: median, color }` there and call `updateLayer(id, { colorBy: "rules" })` + `requestSection(id, "style")`. If no store-level draft exists, add `pendingRuleDraft: { layerId; attribute; op; value; color } | null` with `setPendingRuleDraft` to `shellStore` and make `RulesEditor` consume-and-clear it on mount/update (one `useEffect`). The median: `SELECT median("<col>") AS m FROM "<table>"` via `runQuery` at click time (a small async before navigating). Palette colour: the next unused entry of the rule preset palette (find the palette array `RulesEditor`/`presets.ts` use). The button is disabled with "All values are empty" when the run's `summary.measured === 0`.

Test: click **Style by result** on a done run → `layerStore` has `colorBy: "rules"`, `shellStore.requestedSection` is `{ layerId, section: "style" }`, and the pending draft (or the editor) holds `attribute: "extent_height_m"`, `op: ">"`.

- [ ] **Step 3: Run, tsc, browser** — the toast appears after a run; Style by result lands on STYLE with the editor open; Save recolours the map. **Step 4: Commit** `git commit -am "feat(processing): result toast and Style by result draft"`.

---

### Task 14: Milestone gate — smoke, docs, Codex review

- [ ] **Step 1: Full verification** — `npx vp check && npx tsc -b --noEmit && npx vitest run` (app) and `cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run` (plugins). All green.

- [ ] **Step 2: Browser smoke = spec §10 scenario 1** on `npm run dev` with `fixtures/two-buildings.city.json` (drop it) AND the Delft sample: Tools button after Mode; catalogue reasons (cross-layer rows disabled with "Add a vector layer to join with"); Height from extent → Run → two rows measured; three columns in the table with the badge; Details shows COMPUTED; a rule on `extent_height_m` recolours after Save; Undo removes the columns and the attributes; Escape order (sheet → form → selection); collapsed pills. Record the outcome in `scripts/smoke/processing-m1.md` (steps + observed results + date).

- [ ] **Step 3: Docs** — `docs/architecture-notes.md`: one entry on the processing seam (the shared table FIFO, the write-back transaction + backup table for Undo, computed attributes merged into the model and pushed with `setModel`, provenance registry outside `Layer`); `docs/roadmap.md` Milestone 13: mark 13.1 implemented with the date. Commit `docs:`.

- [ ] **Step 4: Codex review of the milestone diff**

```bash
S=/private/tmp/…/scratchpad   # the session scratchpad
{ echo "=== SPEC ==="; cat docs/superpowers/specs/2026-09-10-processing-toolbox-design.md; echo "=== DIFF since 0d787fb ==="; git diff 0d787fb..HEAD -- . ':!package-lock.json'; echo "=== SUBMODULE DIFF ==="; git -C packages/cityjson-navara-plugins diff <pinned-before>..HEAD; } > $S/m1-review-input.md
cd $S && codex exec -m gpt-6-astra --skip-git-repo-check -s read-only "Review the piped milestone diff against the piped spec (sections 4, 5, 6, 7 common rules, 7.4, 8 and acceptance scenario 1). Report correctness bugs, spec deviations, missing tests, and hard-rule violations from CLAUDE.md (duckdb.ts sole importer, one status writer, submodule-first). Number findings, tag CRITICAL/MAJOR/MINOR, give file:line and a concrete fix. Be terse." < m1-review-input.md > m1-review.md
```

Address every CRITICAL and MAJOR before declaring the milestone done; record MINORs left open in the roadmap entry.

- [ ] **Step 5: Push** — `git push origin develop` (and the submodule branch) after the findings are addressed.
