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
 *
 * A vector TARGET's WRITE is refused here with "Not available yet": Task 18
 * publishes it into the feature properties and flips the two cases this file
 * names for it.
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
/** When set, the scope's COUNT statement waits here — so a test can read the
 *  card while scope resolution is holding the FIFO. */
let scopeGate: { promise: Promise<void>; open: () => void } | null = null;

function makeGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function freshTable(name: string, columns: string[]) {
  return {
    table: name,
    sourceName: null,
    source: null,
    reader: null,
    extension: null,
    sourceBytes: null,
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
      if (scopeGate) await scopeGate.promise;
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
const {
  submitRun,
  cancelRun,
  installStaleWatcher,
  installTargetRemovalWatcher,
} = await import("../../../../src/features/processing/runQueue");
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
    // §7.5 reprojects the source INTO this layer's CRS, so the model needs one
    // for `epsgForLayer` to answer with.
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
    },
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
  for (let round = 0; round < 6; round += 1) {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  sql.length = 0;
  featureTotal = 2;
  scopeGate = null;
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
  it("retires a cross-layer run when the table it computed over is rebuilt", async () => {
    // A CITY target with a VECTOR source: `computeLayerId` is the target here,
    // and this is the case a cross-layer run can actually finish in until Task
    // 18 lands the vector write.
    const zones = addZones();
    registerExecutor("join-by-location", async (run) => ({
      columns: [{ name: `${run.prefix}n`, type: "DOUBLE" as const }],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const dispose = installStaleWatcher();
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

  it("keys a vector-target run on the SOURCE city layer, not on its target", async () => {
    // The watcher reads the COMPUTE layer out of the frozen request, and for a
    // vector-target run that is the SOURCE city layer — the run's record knows
    // only the vector target's id, which no table build ever names.
    //
    // The run is forced to "done" through the store rather than reaching it,
    // because this task refuses a vector target's WRITE ("Not available yet")
    // and only Task 18 lets such a run finish. When it does, this case becomes
    // an ordinary end-to-end one; the fact under test does not change.
    const zones = addZones();
    capturing();
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
    useProcessingStore.getState().patchRun(id, { status: "done" });
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

  // Task 18 publishes a vector target's results into its feature properties,
  // which is what lets an Aggregate run reach "done" on its own. Flip the case
  // above to an end-to-end one then, and delete this note.
  it.todo(
    "retires a vector-target run that reached done through the vector write (Task 18)",
  );
});

describe("the per-run vector table", () => {
  it("is created in the source phase and dropped when the run is done", async () => {
    const zones = addZones();
    const box = capturing();
    // The table is named after THIS run — the ids are minted per queue, not
    // per test, so the name is read off the id rather than spelled out.
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
    expect(box.seen?.source).toMatchObject({
      kind: "vector",
      table: `__src_${id}`,
      propertyKeys: ["zone"],
      skipped: 0,
    });
    expect(
      sql.some((s) =>
        s.startsWith(`CREATE OR REPLACE TABLE "__src_${id}" AS SELECT`),
      ),
    ).toBe(true);
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
  });

  it("drops the table when the run FAILS, not only when it succeeds", async () => {
    const zones = addZones();
    registerExecutor("join-by-location", async () => {
      throw new Error("Binder Error: no function ST_Intersects");
    });
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
    expect(runById(id)?.status).toBe("failed");
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
  });

  it("refuses a source whose every feature is unusable, by name", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: null },
            { type: "Feature", properties: {}, geometry: null },
          ],
        },
      },
    });
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
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "No usable areas in Zones",
    });
  });

  it("tells §7.7's all-skipped source apart from §7.5's, by tool", async () => {
    // §7.7's source is any geometry type, so "No usable AREAS" would be a
    // sentence about a rule that tool does not have.
    const roads = useGeoLayerStore.getState().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: null }],
        },
      },
    });
    capturing();
    registerExecutor("distance-to-nearest", async (run) => ({
      columns: [{ name: `${run.prefix}distance_m`, type: "DOUBLE" as const }],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const id = submitRun({
      toolId: "distance-to-nearest",
      targetLayerId: "CITY",
      sourceLayerId: roads,
      scope: "all",
      lod: null,
      params: {},
      prefix: "roads_",
      columns: [{ name: "roads_distance_m", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.error).toBe("The source layer has no features");
  });

  it("refuses an EMPTY source with §7.5's other sentence", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
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
    expect(runById(id)?.error).toBe("The source layer has no features");
  });

  it("records the skipped areas as a warning the log shows", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: null },
            {
              type: "Feature",
              id: "z2",
              properties: { zone: "B" },
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
          ],
        },
      },
    });
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
    expect(runById(id)?.warnings).toContain("1 area skipped: invalid geometry");
  });

  it("shows Reading source while the SCOPE query is still in flight", async () => {
    // §6.1's phases are discrete and in order, and the scope query is work the
    // run does under the phase it has already entered — a vector run that
    // waited for it in "queued" would tell the user nothing was happening
    // while it held the FIFO. Same rule as the reader branch's.
    const zones = addZones();
    capturing();
    scopeGate = makeGate();
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
    expect(sql.some((s) => s.includes("COUNT(DISTINCT"))).toBe(true);
    expect(runById(id)).toMatchObject({ status: "running", phase: "source" });
    scopeGate.open();
    await settle();
    expect(runById(id)?.status).toBe("done");
  });

  it("cancels inside the source phase, before the executor ever runs", async () => {
    // §6.1's Cancel during "Reading source". The cancel is delivered the
    // instant the phase opens — through the store the footer's Cancel button
    // reads — so it lands INSIDE the phase rather than before the run started.
    const zones = addZones();
    const box = capturing();
    let id = "";
    const stop = useProcessingStore.subscribe((state) => {
      const run = state.runs.find((r) => r.id === id);
      if (run?.phase === "source") cancelRun(id);
    });
    id = submitRun({
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
    stop();
    expect(runById(id)?.status).toBe("cancelled");
    expect(box.seen).toBeNull();
    expect(sql.some((s) => s.startsWith("CREATE OR REPLACE TABLE"))).toBe(
      false,
    );
  });
});
