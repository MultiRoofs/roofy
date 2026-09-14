### Task 11: The run queue learns a SOURCE layer and a VECTOR target

**Files:**

- Modify: `src/features/processing/runQueue.ts`, `src/features/processing/types.ts`, `src/features/processing/eligibility.ts`, `src/features/geoLayers/geoLayerStore.ts` (one exported type alias — see Step 3), `src/features/processing/processingStore.ts` (read only — `ToolDraft` gains its fields in Task 15), `src/features/processing/scope.ts` (read only — no change), `src/ui/processing/useEligibilityContext.ts`, `src/ui/processing/useToolForm.ts` (the two `eligibilityContextFor` call sites), `src/ui/processing/RecentRuns.tsx` and `src/ui/processing/LogView.tsx` (**no production edit needed** — both already read `run.sourceName`; this task's commit adds the tests that the field finally arrives)
- Test: `tests/unit/features/processing/crossLayerRun.test.ts`, additions to `tests/unit/features/processing/runQueue.test.ts` and `tests/unit/features/processing/eligibility.test.ts`, additions to `tests/unit/ui/processing/RecentRuns.test.tsx`

**Interfaces:**

- Consumes: `RunRequest`/`ToolContext`/`ToolResult`/`ToolExecutor` (`runQueue.ts:75-136`), `getLayerTable`/`LayerTable` (`layerTables.ts:166-182`), `useGeoLayerStore`/`GeoLayer` (`geoLayerStore.ts:89-101`), `geoRecords`/`GeoRecord` (`geoRecords.ts:5-37`), `resolveScope` (`scope.ts:90`, unchanged).
- Produces:

```ts
// src/features/geoLayers/geoLayerStore.ts — the union's geojson arm, named
// once. Every cross-layer reader of a vector layer reads `config.preparedData`,
// which only this arm has; the bare `GeoLayer` union does not typecheck there.
export type GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>;

export type ToolTarget =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly records: ReadonlyArray<GeoRecord>;
    };
export type ToolSource =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly table: string;
      readonly propertyKeys: ReadonlyArray<string>;
      /** The SOURCE's property types, as preflight inferred them — the ONE
       *  answer the form also used, so the columns the executor declares are
       *  the columns the frozen request promised (§7.5). */
      readonly propertyTypes: ReadonlyMap<string, ColumnType>;
      readonly skipped: number;
    };
export interface ToolContext {
  /** The layer whose TABLE the compute reads. For a vector-TARGET tool this is
   *  the SOURCE city layer; for every other tool it is `target.layer`. The two
   *  M2 executors read only these and are unaffected. */
  readonly layer: Layer;
  readonly table: LayerTable;
  readonly target: ToolTarget; // where the run WRITES
  readonly source: ToolSource | null;
  readonly featureIds: ReadonlyArray<string> | null; // ROW ids of `table`, or null
  readonly signal: AbortSignal;
  query(label: string, sql: string): Promise<QueryOutcome>;
  phase(p: RunPhase): void;
  warn(text: string): void;
  throwIfCancelled(): void;
}
// RunRequest gains:   sourceLayerId: string | null;
// FrozenRequest gains (module-private, computed ONCE in submitRun):
//   computeLayerId: string
//       = sourceLayerId for a vector-TARGET tool, else targetLayerId. It is the
//       layer whose TABLE the run reads and whose FIFO slot it holds, so EVERY
//       existing read of `targetLayerId` inside the queue moves to it: the scope
//       snapshot, the frozen `tableName`, the "Layer removed" / "Layer changed
//       while running" / source-column pre-flights, and the stale watcher. The
//       target-removal watcher checks BOTH ids (§6.1: removing the target OR the
//       source cancels the run).
// ToolDefinition: sourceKind: "city" | "vector" | null   REPLACES needsVectorSource
// EligibilityContext gains: hasCityLayer: boolean
//                           vectorPreparation: "loading" | "ready" | "failed" | "none"
// eligibilityContextFor(target: ActiveLayer | null, inputs: EligibilityInputs)
//   — the four positional arguments become the inputs record the hook already builds
```

- Tasks 13, 15, 16, 17, 18, 19, 20 and 22 all consume `ToolTarget`/`ToolSource`/`ToolContext`; Task 15 adds `ToolDraft.sourceLayerId` and the form that fills `RunRequest.sourceLayerId`.

**One deviation from the ledger, deliberate and named here.**

**`ToolResult` gains nothing in this task.** Task 7 already declared the whole caveat channel — `line?: string` and `caveats?: ReadonlyArray<SkipCount>` — and already made the one `summarise` edit that renders them (Decisions recorded item 6 (i)). The ledger's "`ToolResult` is UNCHANGED" note is corrected there, not here: this task neither re-declares a field nor touches `summarise`'s list-building blocks. It only PROVES the shape survives a cross-layer run, with the two `summarise` cases in Step 1.

**A vector TARGET's write is REFUSED in this task**, with "Not available yet", and Task 18 replaces the refusal with the publication into `config.preparedData`. The guard is not dead code: without it the write would run `writeComputedColumns` against `ctx.table`, which for a vector-target run is the SOURCE city layer's table — Zones' columns landing on Delft. Aggregate is the only vector-target tool and stays `implemented: false` until Task 19, so nothing reachable hits it.

**What `computeLayerId` is for, in one sentence.** There is ONE table FIFO (`layerTables.ts:417-419`), and a run holds it for its whole life; `computeLayerId` names the layer whose table that slot is protecting, which for Aggregate is the city layer it reads and not the vector layer it writes. Every queue-internal read of `targetLayerId` was really a read of "the table I compute over", and this task makes that visible.

**The source-data column pre-flight becomes city-only.** `runQueue.ts:542-560` compares the run's output columns against `table.columns`, which for a vector-target run is the SOURCE city table — a check about the wrong layer entirely (`bld_count_n` is going onto Zones' properties, and a city column of that name is irrelevant). It is gated on `target.kind === "city"`; the vector analogue (a public property key that is not in the registry) is Task 15's form validation plus Task 18's head re-check.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/crossLayerRun.test.ts`:

```ts
/**
 * A run with a SOURCE layer, and a run whose TARGET is a vector layer.
 *
 * The seam under test is `computeLayerId`: which layer's table the run reads,
 * which layer's FIFO slot it holds, and which of the two ids each pre-flight and
 * each watcher is about. Driven through `submitRun` and the processing store the
 * UI renders, exactly as `runQueue.test.ts` drives the queue — `layerTables` is
 * mocked for its registry and its FIFO (a real build needs a real DuckDB), and
 * the geo layer store is the REAL one, because a vector target's identity is
 * what this task resolves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** Every statement the run sent, in order. */
const sql: string[] = [];
/** What the mocked registry hands back, per layer id. */
let tables: Record<string, ReturnType<typeof freshTable>> = {};
/** The FEATURE count the mocked COUNT(DISTINCT …) answers. */
let featureTotal = 2;

function freshTable(name: string, columns: string[]) {
  return {
    table: name,
    sourceName: null,
    source: null,
    reader: null,
    columns: columns.map((c) => ({
      name: c,
      type: "VARCHAR",
      kind: "scalar" as const,
    })),
    lods: [] as [],
    rowCount: 2 as number | null,
  };
}

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: featureTotal }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    onEngineDeath: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    getDuckDBStatus: vi.fn(() => ({
      state: "ready",
      extensions: {},
      loadedExtensions: [],
      platform: null,
    })),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => true),
    formatDuckDBError: (e: unknown) => String(e),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
    initDuckDB: vi.fn(async () => {}),
  };
});

vi.mock("../../../../src/insights/layerTables", async () => {
  // `create` is imported HERE rather than at the top of the file: the factory
  // runs while the module graph is still being built.
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  let chain: Promise<unknown> = Promise.resolve();
  return {
    useLayerTableStore: store,
    getLayerTable: vi.fn((layerId: string) => tables[layerId] ?? null),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    refreshLayerTableColumns: vi.fn(async () => {}),
    __resetQueue: () => {
      chain = Promise.resolve();
      store.setState({ tables: {} });
    },
  };
});

const layerTables = await import("../../../../src/insights/layerTables");
const { submitRun, installStaleWatcher, installTargetRemovalWatcher } =
  await import("../../../../src/features/processing/runQueue");
type Ctx = import("../../../../src/features/processing/runQueue").ToolContext;
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");

type Resettable = { __resetQueue: () => void };

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {
      a: {
        id: "a",
        objectType: "Building",
        attributes: {},
        surfaces: [],
        bbox: null,
        children: [],
        parents: [],
        lod: null,
      },
    },
    vertexCount: 0,
  };
}

function cityLayer(): Layer {
  return {
    id: "CITY",
    name: "Delft",
    model: model(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: ["Building"],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
  };
}

/** A two-feature GeoJSON layer through the real store, so the stable-id
 *  envelope `geoRecords` reads is the one `normalizeGeoJsonDocument` stamps. */
function addZones(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [4, 52],
                  [5, 52],
                  [5, 53],
                  [4, 52],
                ],
              ],
            },
          },
          {
            type: "Feature",
            id: "z2",
            properties: { zone: "B" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [6, 52],
                  [7, 52],
                  [7, 53],
                  [6, 52],
                ],
              ],
            },
          },
        ],
      },
    },
  });
}

/** The one executor every test here registers: it records its context and
 *  writes one value per row so the run reaches the write. */
function capturing(): { seen: Ctx | null } {
  const box: { seen: Ctx | null } = { seen: null };
  const executor = async (
    run: import("../../../../src/features/processing/types").RunRecord,
    ctx: Ctx,
  ) => {
    box.seen = ctx;
    return {
      columns: [{ name: `${run.prefix}n`, type: "DOUBLE" as const }],
      rows: new Map([["a", { [`${run.prefix}n`]: 1 }]]),
      measured: 1,
      skipped: [],
    };
  };
  registerExecutor("aggregate-per-area", executor);
  registerExecutor("join-by-location", executor);
  return box;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

beforeEach(() => {
  sql.length = 0;
  featureTotal = 2;
  tables = {
    CITY: freshTable("layer_1", ["id", "feature_id"]),
  };
  (layerTables as unknown as Resettable).__resetQueue();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [cityLayer()] });
  useGeoLayerStore.setState({ layers: [] });
  delete EXECUTORS["aggregate-per-area"];
  delete EXECUTORS["join-by-location"];
  delete EXECUTORS["distance-to-nearest"];
});

afterEach(() => {
  delete EXECUTORS["aggregate-per-area"];
  delete EXECUTORS["join-by-location"];
  delete EXECUTORS["distance-to-nearest"];
});

describe("a run that names a source layer", () => {
  it("records the source's name, which is what Recent runs' '← source' reads", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.sourceLayerId).toBe(zones);
    expect(runById(id)?.sourceName).toBe("Zones");
  });

  it("fails a frozen source that has been removed, with §6.1's sentence", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    useGeoLayerStore.getState().removeGeoLayer(zones);
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Layer removed",
    });
  });

  it("cancels a RUNNING run when the source layer goes away mid-compute", async () => {
    const zones = addZones();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerExecutor("join-by-location", async (run) => {
      await held;
      return {
        columns: [{ name: `${run.prefix}n`, type: "DOUBLE" as const }],
        rows: new Map(),
        measured: 0,
        skipped: [],
      };
    });
    const dispose = installTargetRemovalWatcher();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.status).toBe("running");
    useGeoLayerStore.getState().removeGeoLayer(zones);
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Layer removed",
    });
    release();
    await settle();
    // The removal's reason outranks the cancel `execute` sees on the way out.
    expect(runById(id)?.error).toBe("Layer removed");
    dispose();
  });
});

describe("a run whose TARGET is a vector layer", () => {
  it("computes over the SOURCE city layer's table and names the vector target", async () => {
    const zones = addZones();
    const box = capturing();
    submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    const ctx = box.seen;
    expect(ctx?.table.table).toBe("layer_1");
    expect(ctx?.layer.id).toBe("CITY");
    expect(ctx?.target.kind).toBe("vector");
    expect(ctx?.target.kind === "vector" && ctx.target.layer.id).toBe(zones);
    // §7.6's target is written feature by feature, so the executor gets the
    // records the panel already builds rather than the raw document.
    expect(ctx?.target.kind === "vector" && ctx.target.records.length).toBe(2);
    expect(ctx?.source).toEqual({
      kind: "city",
      layer: ctx?.layer,
      table: ctx?.table,
    });
  });

  it("reports the VECTOR layer's name as the target, not the city layer's", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.targetName).toBe("Zones");
    expect(runById(id)?.sourceName).toBe("Delft");
  });

  it("refuses the WRITE until Task 18 publishes into the feature properties", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Not available yet",
    });
    // And NOTHING was written to the city layer's table, which is the bug the
    // guard exists for: no ALTER, no UPDATE, no transaction at all.
    expect(sql.some((s) => s.startsWith("ALTER TABLE"))).toBe(false);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("re-validates the SOURCE city table at the head, not the vector target", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    // A rebuild of the CITY table between Run and the head.
    tables.CITY = freshTable("layer_2", ["id", "feature_id"]);
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Layer changed while running; run again",
    });
  });

  it("does not test a vector target's columns against the CITY table's columns", async () => {
    // The city table happens to have a `bld_n` of its own. It is not the
    // target, so §6.1's "belongs to the source data" refusal must not fire.
    tables.CITY = freshTable("layer_1", ["id", "feature_id", "bld_n"]);
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.error).not.toContain("belongs to the source data");
  });

  it("fails when the vector TARGET is gone before the run starts", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    useGeoLayerStore.getState().removeGeoLayer(zones);
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Layer removed",
    });
  });

  it("refuses a vector-target run with no source layer, with §5's own reason", async () => {
    const zones = addZones();
    capturing();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: null,
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Add a city model layer to aggregate",
    });
  });
});

describe("the stale watcher", () => {
  it("retires a vector-target run when its SOURCE city table is rebuilt", async () => {
    const zones = addZones();
    registerExecutor("aggregate-per-area", async (run) => ({
      columns: [{ name: `${run.prefix}n`, type: "DOUBLE" as const }],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const dispose = installStaleWatcher();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    // An empty result is a DONE run (§6.1): nothing to write, nothing to undo.
    expect(runById(id)?.status).toBe("done");
    layerTables.useLayerTableStore.setState({
      tables: { CITY: { state: "building" } },
    });
    layerTables.useLayerTableStore.setState({
      tables: {
        CITY: { state: "ready", info: freshTable("layer_9", ["id"]) },
      },
    });
    expect(runById(id)?.stale).toBe(true);
    dispose();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/crossLayerRun.test.ts
```

Expected: FAIL — `submitRun` does not accept `sourceLayerId` (a TypeScript error in the test), and `ToolContext` has no `target`.

- [ ] **Step 3: `sourceKind` replaces `needsVectorSource`, and `ToolResult` gains its two card fields**

In `src/features/geoLayers/geoLayerStore.ts`, name the union's geojson arm once, directly under the `GeoLayer` declaration (`:89-101`):

```ts
/**
 * The union's GeoJSON arm.
 *
 * Every reader of a vector layer's CONTENT — the cross-layer run, the records
 * panel, the export, the style controls — reads `config.preparedData`, which
 * only this arm has; typing such a reader `GeoLayer` does not compile and casting
 * it would be a lie the compiler cannot check. `Extract` rather than a second
 * hand-written record, so a change to the arm cannot leave this behind.
 */
export type GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>;
```

(`useToolForm.ts` declares that alias locally today; Task 15 replaces its local copy with this import, so there is one spelling.)

In `src/features/processing/types.ts`, replace

```ts
  /** Needs a second, vector layer as the source. */
  readonly needsVectorSource: boolean;
```

with

```ts
  /**
   * The kind of SECOND layer the run reads (spec §3's "source"), or null.
   *
   * `"vector"` for the two city-target cross-layer tools; `"city"` for
   * Aggregate buildings per area, whose target is the vector layer and whose
   * buildings come from a city layer. It is ONE field rather than a boolean
   * plus a kind because every reason, every select and every pre-flight is a
   * statement about the same fact, and two fields is how they come to disagree.
   */
  readonly sourceKind: "city" | "vector" | null;
```

In `src/features/processing/toolRegistry.ts`, replace each entry's `needsVectorSource: false` with `sourceKind: null`, except: `join-by-location` and `distance-to-nearest` get `sourceKind: "vector"`, and `aggregate-per-area` gets `sourceKind: "city"` (it had `needsVectorSource: false` and a vector TARGET, which is exactly the case the boolean could not express).

In `src/features/processing/runQueue.ts`, extend `ToolResult` (`:124-131`) — the existing three fields keep their comments:

```ts
export interface ToolResult {
  readonly columns: ReadonlyArray<OutputColumn>;
  /**
   * Keyed by OBJECT ID for a city target, and by the GeoJSON stable feature id
   * (`geoJsonRecords.GEO_STABLE_FEATURE_KEY`'s `stableId`) for a vector target.
   * Every column present in every row.
   */
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** FEATURES measured, for the summary line. */
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
  /**
   * Spec §6.2: the card's OWN first phrase, when "N buildings measured" is not
   * what this tool measured — "1,143 buildings joined" (§7.5), "6 areas
   * aggregated over 1,204 buildings" (§7.6), "1,079 valid" (§7.3). Absent for
   * a tool whose line is the default, which Measure solids' is.
   */
  readonly line?: string;
  /**
   * §6.2's CAVEATS: objects that WERE evaluated, with something withheld —
   * "37 invalid solids (no volume)". Distinct from `skipped`, which is "could
   * not be evaluated" and NULL everywhere. Optional: the M1 and M2 executors
   * have none and say nothing.
   */
  readonly caveats?: ReadonlyArray<SkipCount>;
}
```

`line` and `caveats` are reproduced VERBATIM from Task 7 — this is a whole-interface replacement (it rewords `rows`), so the block has to carry them, but it must not change a character of either. And leave `summarise` alone: Task 7's edit already renders both.

- [ ] **Step 4: `RunRequest` gains the source, `FrozenRequest` gains the compute layer**

In `src/features/processing/runQueue.ts`, replace the `RunRequest` / `FrozenRequest` pair (`:75-90`):

```ts
export interface RunRequest {
  readonly toolId: ToolId;
  /** The layer the results are WRITTEN to (spec §3's "target"). */
  readonly targetLayerId: string;
  /** The second layer the run READS (spec §3's "source"), or null. */
  readonly sourceLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  readonly columns: ReadonlyArray<OutputColumn>;
}

/** A {@link RunRequest} plus everything `submitRun` froze for it. */
interface FrozenRequest extends RunRequest {
  readonly snapshot: ScopeSnapshot;
  /**
   * The layer whose TABLE the run reads and whose FIFO slot it holds.
   *
   * `sourceLayerId` for a vector-TARGET tool, else `targetLayerId`. EVERY read
   * of `targetLayerId` inside the queue is really a read of this — the scope
   * snapshot, the frozen `tableName`, the "Layer removed" / "Layer changed
   * while running" pre-flights and the stale watcher — because a vector layer
   * has no table to compute over (Design decision (c)). The target-removal
   * watcher is the exception: it checks BOTH ids, since §6.1 cancels a run when
   * either layer goes away.
   */
  readonly computeLayerId: string;
  /** The COMPUTE layer's table name at Run; a different one at the head is a
   *  rebuild. */
  readonly tableName: string | null;
}
```

Then `submitRun` and `retryRun` (`:326-354`):

```ts
export function submitRun(request: RunRequest): string {
  // For a vector-TARGET tool the compute ground is the SOURCE city layer: it
  // owns the table, the scope and the FIFO slot. `sourceLayerId` may be null
  // for a malformed request (the form's `canRun` blocks it); the head refuses
  // it with §5's own reason rather than resolving a table for a vector id.
  const computeLayerId =
    toolById(request.toolId).target === "vector"
      ? (request.sourceLayerId ?? request.targetLayerId)
      : request.targetLayerId;
  return queueRun({
    ...request,
    computeLayerId,
    snapshot: snapshotScopeInputs(computeLayerId),
    tableName: getLayerTable(computeLayerId)?.table ?? null,
  });
}
```

and in `retryRun`, `frozen.targetLayerId` becomes `frozen.computeLayerId`:

```ts
return queueRun({
  ...frozen,
  tableName: getLayerTable(frozen.computeLayerId)?.table ?? null,
});
```

- [ ] **Step 5: `queueRun` names both layers**

Still in `runQueue.ts`, add above `queueRun` (and import `useGeoLayerStore` and `geoRecords`/`GeoRecord` at the top — `features/` importing `features/` needs no new rule):

```ts
import {
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../geoLayers/geoLayerStore";
import { geoRecords, type GeoRecord } from "../geoLayers/geoRecords";
```

```ts
/**
 * A layer's name, whichever store it lives in.
 *
 * Two stores and one run: the target of an Aggregate run is a `GeoLayer` and
 * its source is a `Layer`, and the card, the history's "← source" line and
 * §6.4's log header all read the NAMES. `null` when the id names neither, which
 * the head's pre-flights then report as "Layer removed".
 */
function layerNameOf(layerId: string | null): string | null {
  if (layerId === null) return null;
  const city = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (city) return city.name;
  return (
    useGeoLayerStore.getState().layers.find((l) => l.id === layerId)?.name ??
    null
  );
}

/** Does either store still hold this id? §6.1's removal pre-flight. */
function layerExists(layerId: string): boolean {
  return (
    useLayerStore.getState().layers.some((l) => l.id === layerId) ||
    useGeoLayerStore.getState().layers.some((l) => l.id === layerId)
  );
}
```

and inside `queueRun` replace the three record fields (`:358-368`):

```ts
  const id = `run_${++counter}`;
  const record: RunRecord = {
    id,
    toolId: request.toolId,
    targetLayerId: request.targetLayerId,
    targetName: layerNameOf(request.targetLayerId) ?? "?",
    sourceLayerId: request.sourceLayerId,
    sourceName: layerNameOf(request.sourceLayerId),
```

(the `const layer = useLayerStore…find(…targetLayerId)` lookup above it goes away — `layerNameOf` replaces it.)

- [ ] **Step 6: `execute` resolves the compute layer, the target and the source**

In `runQueue.ts`, add `type ColumnType` to the existing `../../insights/computedColumns` import list (`runQueue.ts:45-51`, beside `type OutputColumn`), then add the two type exports beside `ToolContext`:

```ts
/**
 * Where a run WRITES (spec §3's "target").
 *
 * A city target carries its table, because the write is `ALTER TABLE` +
 * `UPDATE` over it. A vector target carries its RECORDS instead: a geo layer
 * has no table and no model, and what the app holds is the document — so the
 * executor is handed the same `GeoRecord` list the records panel builds, keyed
 * by the stable feature id the results come back under (Design decision (c)).
 *
 * The vector arm is `GeoJsonLayer`, not `GeoLayer`: every consumer reads
 * `layer.config.preparedData`, and the raster and tiles arms have no such field.
 * `execute` narrows once, at the resolution below, so nothing downstream casts.
 */
export type ToolTarget =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly records: ReadonlyArray<GeoRecord>;
    };

/**
 * The SECOND layer a cross-layer run reads, or null for a one-layer tool.
 *
 * A city source is by construction the COMPUTE layer (`submitRun` points
 * `computeLayerId` at it), so it is the same `layer`/`table` pair `ToolContext`
 * carries — spelled out because an executor should not have to know that. A
 * VECTOR source is the per-run `__src_<runId>` table plus what preflight
 * learned about it, and it is built in the `"source"` phase (Task 13).
 */
export type ToolSource =
  | { readonly kind: "city"; readonly layer: Layer; readonly table: LayerTable }
  | {
      readonly kind: "vector";
      readonly layer: GeoJsonLayer;
      readonly table: string;
      readonly propertyKeys: ReadonlyArray<string>;
      /** The SOURCE's property types, as preflight inferred them — the ONE
       *  answer the form also used, so the columns the executor declares are
       *  the columns the frozen request promised (§7.5). */
      readonly propertyTypes: ReadonlyMap<string, ColumnType>;
      readonly skipped: number;
    };
```

and extend `ToolContext` (`:97-122`) — `table`/`layer` keep their existing meaning, which is what leaves `heightFromExtent.ts` and `roofMetrics.ts` untouched:

```ts
export interface ToolContext {
  /**
   * The layer whose TABLE the compute reads. For a vector-TARGET tool this is
   * the SOURCE city layer; for every other tool it is `target.layer`. The two
   * M2 executors read only these and are unaffected.
   */
  readonly layer: Layer;
  readonly table: LayerTable;
  /** Where the run WRITES. */
  readonly target: ToolTarget;
  readonly source: ToolSource | null;
  /** The rows to compute for, or `null` for "every row". */
  readonly featureIds: ReadonlyArray<string> | null;
  readonly signal: AbortSignal;
  query(label: string, sql: string): Promise<QueryOutcome>;
  phase(p: RunPhase): void;
  warn(text: string): void;
  throwIfCancelled(): void; // (keep the existing doc comment verbatim)
}
```

In `execute`, the block from the layer lookup to the executor lookup becomes (keeping every existing comment on the pre-flights it belongs to):

```ts
const tool = toolById(request.toolId);
// §5's own reason, at the head: a vector-target tool with no source has no
// compute ground at all, and resolving a city table for a vector layer id
// would report "Layer removed" about a layer that is right there.
if (tool.sourceKind !== null && request.sourceLayerId === null) {
  patch(id, {
    status: "failed",
    error:
      tool.sourceKind === "vector"
        ? "Add a vector layer to join with"
        : "Add a city model layer to aggregate",
    elapsedMs: elapsed(),
  });
  return;
}
// §6.1: "Removing the target or the source layer during a run cancels it."
// Checked for BOTH ids, in whichever store each lives in.
if (
  !layerExists(request.targetLayerId) ||
  (request.sourceLayerId !== null && !layerExists(request.sourceLayerId))
) {
  patch(id, {
    status: "failed",
    error: "Layer removed",
    elapsedMs: elapsed(),
  });
  return;
}
const layer = useLayerStore
  .getState()
  .layers.find((l) => l.id === request.computeLayerId);
if (!layer) {
  patch(id, {
    status: "failed",
    error: "Layer removed",
    elapsedMs: elapsed(),
  });
  return;
}
const table = getLayerTable(request.computeLayerId);
if (!table) {
  patch(id, {
    status: "failed",
    error: "This layer's table could not be built",
    elapsedMs: elapsed(),
  });
  return;
}
if (request.tableName !== null && request.tableName !== table.table) {
  patch(id, {
    status: "failed",
    error: "Layer changed while running; run again",
    elapsedMs: elapsed(),
  });
  return;
}
// Where the run WRITES, which for Aggregate is not where it computes.
let target: ToolTarget;
if (tool.target === "city") {
  target = { kind: "city", layer, table };
} else {
  const geo = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === request.targetLayerId);
  if (!geo || geo.kind !== "geojson") {
    patch(id, {
      status: "failed",
      error: "Layer removed",
      elapsedMs: elapsed(),
    });
    return;
  }
  target = {
    kind: "vector",
    layer: geo,
    records: geoRecords(geo.config.preparedData),
  };
}
// A CITY source IS the compute layer — `submitRun` made it so — and a
// VECTOR source is built in the "source" phase (Task 13).
const source: ToolSource | null =
  tool.sourceKind === "city" ? { kind: "city", layer, table } : null;
// Spec §6.1: "a column that now belongs to the file fails the run with that
// reason". About the TARGET's own table, so it does not apply to a vector
// target, whose columns land on its feature properties (Task 18) and whose
// compute table belongs to another layer entirely.
if (target.kind === "city") {
  const owned = new Set(
    [...computedColumnsOf(request.targetLayerId)].map((c) => c.toLowerCase()),
  );
  const clash = target.table.columns.find(
    (c) =>
      !owned.has(c.name.toLowerCase()) &&
      request.columns.some(
        (out) => out.name.toLowerCase() === c.name.toLowerCase(),
      ),
  );
  if (clash) {
    patch(id, {
      status: "failed",
      // The TABLE's spelling: that is the column that belongs to the data.
      error: `'${clash.name}' belongs to the source data; choose another prefix`,
      elapsedMs: elapsed(),
    });
    return;
  }
}
const executor = EXECUTORS[request.toolId];
if (!executor) {
  /* unchanged */
}
```

(the later `const tool = toolById(request.toolId);` at `:581` is deleted — `tool` is now in scope from the top of this block.)

Then the context literal (`:644-673`) gains two fields:

```ts
const ctx: ToolContext = {
  table,
  layer,
  target,
  source,
  featureIds: scope.featureIds,
  signal,
  // …the four methods, unchanged…
};
```

and the executor call plus the vector guard (`:675-680`):

```ts
const record = runById(id);
if (!record) return;
const raw = await executor(record, ctx);
if (signal.aborted) throw new CancelledError();
if (target.kind !== "city") {
  // Task 18 publishes a vector target's results into its feature
  // properties. Until it does, the write must not run: `table` is the
  // SOURCE city layer's, so `writeComputedColumns` would put the vector
  // layer's columns on the city layer's table. Aggregate is the only
  // vector-target tool and is `implemented: false` until Task 19, so this
  // is a guard on an unreachable path, not a feature.
  patch(id, {
    status: "failed",
    phase: null,
    error: "Not available yet",
    elapsedMs: elapsed(),
  });
  return;
}
// The table's spelling wins from here on, so the SQL, the rows' keys, the
// model, the registry, the card and Undo all name the same column.
const result = canonicalise(raw, table.columns);
```

- [ ] **Step 7: Both watchers learn the second store and the compute layer**

In `installTargetRemovalWatcher`, replace the id set and the `continue` test:

```ts
const failRunsWithoutTarget = () => {
  // BOTH stores: §6.1's removal is about the target OR the source, and either
  // may be a geo layer.
  const layerIds = new Set([
    ...useLayerStore.getState().layers.map((l) => l.id),
    ...useGeoLayerStore.getState().layers.map((l) => l.id),
  ]);
  for (const run of useProcessingStore.getState().runs) {
    if (
      run.status !== "queued" &&
      run.status !== "running" &&
      run.status !== "cancelling"
    ) {
      continue;
    }
    if (
      layerIds.has(run.targetLayerId) &&
      (run.sourceLayerId === null || layerIds.has(run.sourceLayerId))
    ) {
      continue;
    }
    patch(run.id, {
      /* unchanged */
    });
    controllers.get(run.id)?.abort();
  }
};
```

and subscribe to both stores, disposing both:

```ts
const unsubscribeCity = useLayerStore.subscribe((state, previous) => {
  if (state.layers === previous.layers) return;
  failRunsWithoutTarget();
});
const unsubscribeGeo = useGeoLayerStore.subscribe((state, previous) => {
  if (state.layers === previous.layers) return;
  failRunsWithoutTarget();
});
failRunsWithoutTarget();

const dispose = () => {
  unsubscribeCity();
  unsubscribeGeo();
  if (disposeTargetWatcher === dispose) disposeTargetWatcher = null;
};
```

In `installStaleWatcher`, the run match reads the COMPUTE layer:

```ts
for (const run of useProcessingStore.getState().runs) {
  // The layer whose TABLE the run read, which for a vector-target run is
  // its SOURCE city layer. The record carries only the target's id, so
  // the compute id comes from what `submitRun` froze; a run whose frozen
  // request the history has dropped falls back to the target, which is
  // the compute layer for every one-layer tool.
  const computeLayerId =
    frozenById.get(run.id)?.computeLayerId ?? run.targetLayerId;
  if (computeLayerId === layerId && run.status === "done" && !run.stale) {
    patch(run.id, { stale: true, undoable: false });
    discardUndo(run.id);
  }
}
```

- [ ] **Step 8: Eligibility learns `sourceKind`, `hasCityLayer` and the vector target's load state**

In `src/features/processing/eligibility.ts`, extend the context:

```ts
  readonly hasVectorLayer: boolean;
  /** A city model layer exists somewhere in the workspace — Aggregate's
   *  mirror of `hasVectorLayer` (§5 gives the sentence for a vector source
   *  only; **[adapted copy A3]** gives this one). */
  readonly hasCityLayer: boolean;
  /**
   * A VECTOR target's document state. `"none"` when the target is not a vector
   * layer, or is one whose bytes did not survive a reload — that case is the
   * form's "The layer has no areas" (§7.6), not an eligibility refusal.
   */
  readonly vectorPreparation: "loading" | "ready" | "failed" | "none";
```

and replace the target-kind branch and the vector-source check:

```ts
if (tool.target === "city") {
  if (ctx.targetKind !== "city" && ctx.targetKind !== "streaming") {
    return { ok: false, reason: "Needs a city model layer" };
  }
} else {
  if (ctx.targetKind !== "vector") {
    return { ok: false, reason: "Needs a vector layer" };
  }
  // §7.5-§7.7 assume a loaded document: the predicates read its features and
  // the results are written onto its properties. **[adapted copy A4]**
  if (ctx.vectorPreparation === "loading") {
    return { ok: false, reason: "This vector layer is still loading" };
  }
  if (ctx.vectorPreparation === "failed") {
    return { ok: false, reason: "This vector layer could not be loaded" };
  }
}
```

```ts
if (tool.sourceKind === "vector" && !ctx.hasVectorLayer) {
  return { ok: false, reason: "Add a vector layer to join with" };
}
if (tool.sourceKind === "city" && !ctx.hasCityLayer) {
  // **[adapted copy A3]**
  return { ok: false, reason: "Add a city model layer to aggregate" };
}
```

In `src/ui/processing/useEligibilityContext.ts`, the inputs gain `hasCityLayer` and the pure function takes the record instead of four positionals:

```ts
export interface EligibilityInputs {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  readonly hasVectorLayer: boolean;
  readonly hasCityLayer: boolean;
  readonly status: DuckDBStatus;
}

export function useEligibilityInputs(): EligibilityInputs {
  const tables = useLayerTableStore((s) => s.tables);
  const hasVectorLayer = useGeoLayerStore((s) =>
    s.layers.some((l) => l.kind === "geojson"),
  );
  const hasCityLayer = useLayerStore((s) => s.layers.length > 0);
  return { tables, hasVectorLayer, hasCityLayer, status: useDuckDBStatus() };
}

export function eligibilityContextFor(
  target: ActiveLayer | null,
  inputs: EligibilityInputs,
): EligibilityContext {
  const { tables, hasVectorLayer, hasCityLayer, status } = inputs;
  const entry = target?.kind === "city" ? tables[target.layer.id] : undefined;
  const ready =
    entry !== undefined && entry.state === "ready" ? entry.info : null;
  const ext = status.state === "ready" ? status.extensions : null;
  const extState = (name: "spatial" | "three_d") =>
    ext ? ext[name].state : "unloaded";
  const geojson =
    target?.kind === "geo" && target.layer.kind === "geojson"
      ? target.layer.config
      : null;
  return {
    targetKind: target ? layerKindOf(target) : "none",
    sourceEncoding:
      target?.kind === "city" ? target.layer.model.sourceEncoding : null,
    hasReader: ready !== null && ready.reader !== null,
    sourceAvailable: ready !== null && ready.source !== null,
    tableState: entry?.state ?? "none",
    engineState: status.state,
    hasVectorLayer,
    hasCityLayer,
    vectorPreparation: geojson?.preparation ?? "none",
    extensionState: {
      spatial: extState("spatial"),
      three_d: extState("three_d"),
    },
  };
}

export function useEligibilityContext(
  target: ActiveLayer | null,
): EligibilityContext {
  return eligibilityContextFor(target, useEligibilityInputs());
}
```

with `import { useLayerStore } from "../../features/layers/layerStore";` added.

In `src/ui/processing/useToolForm.ts`, the two call sites take the record — and the `useMemo` dependency list follows it:

```ts
const inputs = useEligibilityInputs();
const { tables } = inputs;
```

```ts
const eligibleTargets = useMemo(
  () =>
    candidates.filter(
      (l) =>
        toolEligibility(
          tool,
          eligibilityContextFor({ kind: "city", layer: l }, inputs),
        ).ok,
    ),
  [candidates, inputs, tool],
);
```

```ts
const targetCtx = eligibilityContextFor(
  target ? { kind: "city", layer: target } : null,
  inputs,
);
```

(`inputs` is a fresh object each render, so the memo recomputes per render — the filter is a handful of pure calls over at most a few layers, and the alternative is five dependencies that drift.)

- [ ] **Step 9: Extend the existing suites**

In `tests/unit/features/processing/eligibility.test.ts`, add the two fields to `base`:

```ts
  hasVectorLayer: true,
  hasCityLayer: true,
  vectorPreparation: "none",
```

and append:

```ts
it("asks for a city layer for Aggregate buildings per area", () => {
  const tool = { ...toolById("aggregate-per-area"), implemented: true };
  expect(
    toolEligibility(tool, {
      ...base,
      targetKind: "vector",
      vectorPreparation: "ready",
      hasCityLayer: false,
    }),
  ).toEqual({ ok: false, reason: "Add a city model layer to aggregate" });
});

it("refuses a vector target whose document is still loading, or failed", () => {
  const tool = { ...toolById("aggregate-per-area"), implemented: true };
  expect(
    toolEligibility(tool, {
      ...base,
      targetKind: "vector",
      vectorPreparation: "loading",
    }),
  ).toEqual({ ok: false, reason: "This vector layer is still loading" });
  expect(
    toolEligibility(tool, {
      ...base,
      targetKind: "vector",
      vectorPreparation: "failed",
    }),
  ).toEqual({ ok: false, reason: "This vector layer could not be loaded" });
});

it("still refuses Aggregate on a city layer, with §5's own words", () => {
  const tool = { ...toolById("aggregate-per-area"), implemented: true };
  expect(toolEligibility(tool, base)).toEqual({
    ok: false,
    reason: "Needs a vector layer",
  });
});
```

In `tests/unit/features/processing/runQueue.test.ts`, every `submitRun({…})` literal gains `sourceLayerId: null` (`tsc` names them), and append:

```ts
it("hands a one-layer tool a city target, no source, and the same table", async () => {
  let seen: { target: unknown; source: unknown; table: string } | null = null;
  registerExecutor("height-from-extent", async (run, ctx) => {
    seen = {
      target: ctx.target,
      source: ctx.source,
      table: ctx.table.table,
    };
    return {
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { [`${run.prefix}height_m`]: 3 }]]),
      measured: 1,
      skipped: [],
    };
  });
  submitRun({
    toolId: "height-from-extent",
    targetLayerId: "L1",
    sourceLayerId: null,
    scope: "all",
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" }],
  });
  await settle();
  expect(seen?.table).toBe("layer_1");
  expect(seen?.source).toBeNull();
  expect((seen?.target as { kind: string }).kind).toBe("city");
});

// Task 7 shipped `line`, `caveats` and the `summarise` edit; this case pins
// that a cross-layer result (a custom line AND a caveat AND skips) still
// renders in §6.2's order. Nothing in this task changes `summarise`.
it("puts a tool's own line and its caveats on the card, before the skips", () => {
  expect(
    summarise(
      {
        columns: [{ name: "zones_matches_n", type: "DOUBLE" }],
        rows: new Map(),
        measured: 1143,
        skipped: [{ cause: "no geometry", count: 4 }],
        line: "1,143 buildings joined",
        caveats: [{ cause: "outside every area", count: 61 }],
      },
      2900,
      { streaming: false },
    ).line,
  ).toBe("1,143 buildings joined · 61 outside every area · 4 skipped · 2.9 s");
});

it("keeps the default line for a result that declares none", () => {
  expect(
    summarise(
      {
        columns: [],
        rows: new Map(),
        measured: 2,
        skipped: [],
      },
      2400,
      { streaming: false },
    ).line,
  ).toBe("2 buildings measured · 2.4 s");
});
```

(`registerExecutor` is already imported there; `summarise` too.)

In `tests/unit/ui/processing/RecentRuns.test.tsx`, append the row assertion — the production code needed no edit, so this is the proof that the field arrives:

```tsx
it("shows 'target ← source' for a cross-layer run", () => {
  useProcessingStore.setState({
    runs: [
      runFixture({
        toolId: "join-by-location",
        targetName: "Delft",
        sourceLayerId: "GEO",
        sourceName: "Zones",
      }),
    ],
  });
  render(<RecentRuns />);
  expect(screen.getByText(/Delft ← Zones/)).toBeInTheDocument();
});
```

(`runFixture(patch)` is that file's own factory, `RecentRuns.test.tsx:23`.)

- [ ] **Step 10: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, `tsc` clean, `vp check` at 0 errors / 56 warnings. `tsc` names every `submitRun` call site and every `EligibilityContext` literal that still lacks the new fields — which is the point of making them required.

- [ ] **Step 11: Commit**

```bash
git add src/features/processing/runQueue.ts src/features/processing/types.ts \
  src/features/processing/eligibility.ts src/features/processing/toolRegistry.ts \
  src/features/geoLayers/geoLayerStore.ts \
  src/ui/processing/useEligibilityContext.ts src/ui/processing/useToolForm.ts \
  tests/unit/features/processing/crossLayerRun.test.ts \
  tests/unit/features/processing/runQueue.test.ts \
  tests/unit/features/processing/eligibility.test.ts \
  tests/unit/ui/processing/RecentRuns.test.tsx
git commit -m "feat: a run can name a source layer and target a vector layer"
```

---
