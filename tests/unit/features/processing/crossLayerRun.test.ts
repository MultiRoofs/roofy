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
 * A vector TARGET's WRITE is §7.6's publication into the feature properties:
 * the run merges its results onto the target layer's `preparedData`, records
 * its provenance under the GEO layer's id, and keeps an Undo of its OWN columns
 * per feature.
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
    sourceFeatureIds: null,
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
  // A derived layer's table is minted and adopted from INSIDE the run's own
  // FIFO slot (Task 21), so `runQueue`'s module graph imports both names and a
  // factory without them throws at import.
  const adopted = new Map<string, unknown>();
  let mockTableCounter = 100;
  return {
    useLayerTableStore: store,
    nextTableName: vi.fn(() => `layer_${++mockTableCounter}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
    }),
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
  undoRun,
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
type GeoJsonLayer =
  import("../../../../src/features/geoLayers/geoLayerStore").GeoJsonLayer;
const { geoRecordId, geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");
const { computedColumnsOf, useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");

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
    derivedFrom: null,
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

/** The vector layer, NARROWED once: `layers[0]` read twice keeps neither the
 *  union narrowing nor the proof that the element is there. */
function zonesLayer(id: string): GeoJsonLayer {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer === undefined || layer.kind !== "geojson") {
    throw new Error(`no GeoJSON layer ${id}`);
  }
  return layer;
}

/** What the records panel would show for the vector layer right now. */
function zoneRecords(id: string) {
  return geoRecords(zonesLayer(id).config.preparedData);
}

/** An executor that writes one column onto EVERY area of the vector target,
 *  keyed by the STABLE FEATURE ID — which is what the merge matches on. */
function areaWriter(column: string, value: number) {
  return async (
    run: import("../../../../src/features/processing/types").RunRecord,
    ctx: Ctx,
  ) => ({
    columns: [{ name: column, type: "DOUBLE" as const }],
    rows: new Map(
      ctx.target.kind === "vector"
        ? ctx.target.records.map((record) => [
            geoRecordId(record),
            { [column]: value },
          ])
        : [],
    ),
    measured: 2,
    skipped: [],
    line: run.prefix,
  });
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
  useComputedColumnStore.setState({ byLayer: {} });
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.targetName).toBe("Zones");
    expect(runById(id)?.sourceName).toBe("Delft");
  });

  it("writes into the feature properties and never into the city table", async () => {
    // §7.6: the durable copy of a vector layer's results is its FEATURE
    // PROPERTIES. The city layer is where the run COMPUTED, and nothing at all
    // may land on its table — no ALTER, no UPDATE, no transaction.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 4));
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)).toMatchObject({ status: "done", undoable: true });
    expect(zoneRecords(zones)[0]).toMatchObject({ zone: "A", bld_n: 4 });
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    // Null-coalesced: the run now SUCCEEDS (§7.6 publishes into the feature
    // properties), so there is no error string to search.
    expect(runById(id)?.error ?? "").not.toContain(
      "belongs to the source data",
    );
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
    // End to end: the run reaches "done" through §7.6's vector publication.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 4));
    const dispose = installStaleWatcher();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
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

  it("takes the Undo of a vector-target run it retires", async () => {
    // The retired card describes a compute table that no longer exists, so its
    // Undo goes with it — and pressing Undo afterwards changes nothing, which
    // is what `undoable: false` has to mean for a vector target too.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 4));
    const dispose = installStaleWatcher();
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_n", type: "DOUBLE" }],
    });
    await settle();
    layerTables.useLayerTableStore.setState({
      tables: { CITY: { state: "building" } },
    });
    layerTables.useLayerTableStore.setState({
      tables: {
        CITY: { state: "ready", info: freshTable("layer_9", ["id"]) },
      },
    });
    expect(runById(id)?.undoable).toBe(false);
    await undoRun(id);
    await settle();
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_n: 4 });
    dispose();
  });
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.warnings).toContain("1 area skipped: invalid geometry");
  });

  it("keeps a mixed layer's NON-AREAS out of §7.5's source table (S3)", async () => {
    // S3: one polygon makes a mixed polygon/point layer eligible for Join —
    // the form says "Needs areas (polygons)" only when there is none — and the
    // whole layer used to reach the compute, so `ST_CoveredBy` could pick a
    // coincident POINT as the nearest "area". The point is skipped at the
    // queue head instead, counted, and named on the card.
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "p1",
              properties: { zone: "point" },
              geometry: { type: "Point", coordinates: [4.5, 52.5] },
            },
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
    const box = capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.status).toBe("done");
    // The cause is its OWN sentence: a point is valid geometry, so calling it
    // "invalid geometry" would send the user looking for a broken ring.
    expect(runById(id)?.warnings).toContain("1 feature skipped: not an area");
    expect(runById(id)?.warnings).not.toContain(
      "1 area skipped: invalid geometry",
    );
    const source = box.seen?.source;
    expect(source?.kind).toBe("vector");
    expect(source?.kind === "vector" ? source.skipped : null).toBe(1);
    // The layer's FIELDS are untouched: a geometry the tool cannot use does not
    // revoke a property the checklist offered.
    expect(source?.kind === "vector" ? [...source.propertyKeys] : null).toEqual(
      ["zone"],
    );
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
      destination: "layer",
      newLayerName: null,
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
      destination: "layer",
      newLayerName: null,
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

describe("a vector target's publication", () => {
  /** The request every case here submits; only the columns and the prefix
   *  differ. */
  function aggregate(
    zones: string,
    column: string,
    prefix = "bld_",
  ): Parameters<typeof submitRun>[0] {
    return {
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      destination: "layer",
      newLayerName: null,
      params: {},
      prefix,
      columns: [{ name: column, type: "DOUBLE" as const }],
    };
  }

  it("merges the results into the layer's properties and offers Undo", async () => {
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_buildings_n", 3));
    const id = submitRun(aggregate(zones, "bld_buildings_n"));
    await settle();
    expect(runById(id)).toMatchObject({ status: "done", undoable: true });
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_buildings_n: 3 });
    expect(zoneRecords(zones)[1]).toMatchObject({ bld_buildings_n: 3 });
    // §7: provenance under the GEO layer's id, in the one registry.
    expect(computedColumnsOf(zones).has("bld_buildings_n")).toBe(true);
    expect(runById(id)?.columns).toEqual(["bld_buildings_n"]);

    await undoRun(id);
    await settle();
    expect(zoneRecords(zones)[0]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 3 }),
    );
    expect(zoneRecords(zones)[0]).toMatchObject({ zone: "A" });
    expect(computedColumnsOf(zones).has("bld_buildings_n")).toBe(false);
    expect(runById(id)?.note).toBe("Undone");
    expect(runById(id)?.undoable).toBe(false);
  });

  /** Two INDEPENDENT runs over the same vector layer, writing DISJOINT
   *  columns. §6.2 steals Undo only where two runs share a column, so both are
   *  done and both undoable, and the document carries BOTH results — which is
   *  the state each order of Undo has to be tested from. */
  async function twoDisjointRuns(
    zones: string,
  ): Promise<{ a: string; b: string }> {
    registerExecutor("aggregate-per-area", areaWriter("bld_buildings_n", 3));
    const a = submitRun(aggregate(zones, "bld_buildings_n"));
    await settle();
    registerExecutor("aggregate-per-area", areaWriter("bld_sum_m2", 90));
    const b = submitRun(aggregate(zones, "bld_sum_m2"));
    await settle();
    expect(runById(a)).toMatchObject({ status: "done", undoable: true });
    expect(runById(b)).toMatchObject({ status: "done", undoable: true });
    expect(zoneRecords(zones)[0]).toMatchObject({
      bld_buildings_n: 3,
      bld_sum_m2: 90,
    });
    expect([...computedColumnsOf(zones)].sort()).toEqual([
      "bld_buildings_n",
      "bld_sum_m2",
    ]);
    return { a, b };
  }

  /** The record's own STRING keys, so "the property is gone" is asserted as
   *  absence and not as `{ column: undefined }`, which the grid and the export
   *  would both still show. */
  function keysOfFirst(zones: string): ReadonlyArray<string> {
    return Object.keys(zoneRecords(zones)[0] ?? {});
  }

  it("undoes A then B, each leaving the other run's column alone", async () => {
    const zones = addZones();
    const { a, b } = await twoDisjointRuns(zones);

    await undoRun(a);
    await settle();
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_sum_m2: 90, zone: "A" });
    expect(keysOfFirst(zones)).not.toContain("bld_buildings_n");
    // Ownership and provenance move with the values, and only for A.
    expect(runById(a)).toMatchObject({ undoable: false, note: "Undone" });
    expect(runById(b)?.undoable).toBe(true);
    expect([...computedColumnsOf(zones)]).toEqual(["bld_sum_m2"]);

    await undoRun(b);
    await settle();
    expect(keysOfFirst(zones)).not.toContain("bld_sum_m2");
    expect(zoneRecords(zones)[0]).toMatchObject({ zone: "A" });
    expect(runById(b)).toMatchObject({ undoable: false, note: "Undone" });
    expect([...computedColumnsOf(zones)]).toEqual([]);
  });

  it("undoes B then A, from the SAME document that carries both results", async () => {
    // The other order, and NOT from the state a previous Undo left: this is
    // the case a whole-document restore gets wrong, because B's snapshot was
    // taken before A had written anything.
    const zones = addZones();
    const { a, b } = await twoDisjointRuns(zones);

    await undoRun(b);
    await settle();
    expect(zoneRecords(zones)[0]).toMatchObject({
      bld_buildings_n: 3,
      zone: "A",
    });
    expect(keysOfFirst(zones)).not.toContain("bld_sum_m2");
    expect(runById(b)).toMatchObject({ undoable: false, note: "Undone" });
    expect(runById(a)?.undoable).toBe(true);
    expect([...computedColumnsOf(zones)]).toEqual(["bld_buildings_n"]);

    await undoRun(a);
    await settle();
    expect(keysOfFirst(zones)).not.toContain("bld_buildings_n");
    expect(zoneRecords(zones)[0]).toMatchObject({ zone: "A" });
    expect(runById(a)).toMatchObject({ undoable: false, note: "Undone" });
    expect([...computedColumnsOf(zones)]).toEqual([]);
  });

  it("restores a property the run REPLACED rather than dropping it", async () => {
    // `zone` belongs to the file, so a run may not write it — but a SECOND run
    // over a column the first run created replaces a value that was there, and
    // its Undo must put that value back rather than remove the key.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 3));
    const first = submitRun(aggregate(zones, "bld_n"));
    await settle();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 7));
    const second = submitRun(aggregate(zones, "bld_n"));
    await settle();
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_n: 7 });
    // The first run's Undo was stolen: only one run owns a column (§6.2).
    expect(runById(first)?.undoable).toBe(false);

    await undoRun(second);
    await settle();
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_n: 3 });
  });

  it("refuses an output that would overwrite one of the layer's OWN properties", async () => {
    // §6.1's "belongs to the source data", for a vector target: the document
    // already carries `zone`, and no run may write over it under a computed
    // badge. The city branch has had this since M1; this is its vector half.
    const zones = addZones();
    capturing();
    const id = submitRun(aggregate(zones, "zone", ""));
    await settle();
    expect(runById(id)?.error).toBe(
      "'zone' belongs to the source data; choose another prefix",
    );
  });

  it("re-runs over a column a previous run created, which is not the file's", async () => {
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 3));
    const first = submitRun(aggregate(zones, "bld_n"));
    await settle();
    expect(runById(first)?.status).toBe("done");
    const second = submitRun(aggregate(zones, "bld_n"));
    await settle();
    expect(runById(second)?.error).toBeNull();
    expect(runById(second)?.status).toBe("done");
  });

  it("fails rather than overwrite a document that was replaced while it ran", async () => {
    // §6.1's "Layer changed while running; run again", for the vector target:
    // a re-link during the compute re-mints every stable id and may bring
    // properties of its own — merging this run's results into it would write
    // over the file's own values and record rollback values for a document
    // that is gone.
    const zones = addZones();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerExecutor("aggregate-per-area", async (run, ctx) => {
      await held;
      return areaWriter("bld_n", 3)(run, ctx);
    });
    const id = submitRun(aggregate(zones, "bld_n"));
    await settle();
    expect(runById(id)?.status).toBe("running");
    useGeoLayerStore.getState().relinkGeoJsonLayer(zones, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "z1",
          properties: { zone: "C" },
          geometry: null,
        },
      ],
    });
    release();
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Layer changed while running; run again",
    });
    expect(zoneRecords(zones)[0]).toEqual(
      expect.not.objectContaining({ bld_n: 3 }),
    );
    expect(computedColumnsOf(zones).has("bld_n")).toBe(false);
  });

  it("refuses a queued Undo whose column a later run has already overwritten", async () => {
    // The Undo waits on the SAME FIFO as the runs, and re-checks at the head:
    // by then the later run has taken its Undo (§6.2), and restoring would
    // erase a result that is on screen.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 3));
    const first = submitRun(aggregate(zones, "bld_n"));
    await settle();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 7));
    const second = submitRun(aggregate(zones, "bld_n"));
    // Pressed while the second run is still queued behind the first: the Undo
    // reaches the head AFTER it.
    const undoing = undoRun(first);
    await settle();
    await undoing;
    expect(runById(second)?.status).toBe("done");
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_n: 7 });
    expect(runById(first)?.note).not.toBe("Undone");
  });

  it("refuses an Undo whose layer is re-linked WHILE it waits on the queue", async () => {
    // The identity check has to happen at the HEAD, inside the queued
    // callback: the Undo is requested against a document that is still the
    // one it wrote, and the re-link lands while it waits. A check made when
    // Undo was PRESSED would pass here and then put this run's values into a
    // file the user has replaced.
    const zones = addZones();
    registerExecutor("aggregate-per-area", areaWriter("bld_n", 3));
    const id = submitRun(aggregate(zones, "bld_n"));
    await settle();
    // A predecessor holds the FIFO, so the Undo queues behind it.
    const gate = makeGate();
    const holding = layerTables.runOnTableQueue(() => gate.promise);
    const undoing = undoRun(id);
    await settle();
    // Still exactly as the run left it: the Undo has not reached the head.
    expect(zoneRecords(zones)[0]).toMatchObject({ bld_n: 3 });
    useGeoLayerStore.getState().relinkGeoJsonLayer(zones, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "z1",
          properties: { zone: "C" },
          geometry: null,
        },
      ],
    });
    gate.open();
    await holding;
    await undoing;
    await settle();
    // The NEWER document is untouched, and the card refuses in the existing
    // shape: no Undo left, and nothing claiming it was undone.
    expect(zoneRecords(zones)[0]).toMatchObject({ zone: "C" });
    expect(Object.keys(zoneRecords(zones)[0] ?? {})).not.toContain("bld_n");
    expect(runById(id)?.undoable).toBe(false);
    expect(runById(id)?.note).not.toBe("Undone");
  });

  it("is a DONE run with no Undo when the tool matched no feature", async () => {
    const zones = addZones();
    registerExecutor("aggregate-per-area", async (run) => ({
      columns: [{ name: `${run.prefix}n`, type: "DOUBLE" as const }],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const id = submitRun(aggregate(zones, "bld_n"));
    await settle();
    expect(runById(id)).toMatchObject({ status: "done", undoable: false });
    expect(computedColumnsOf(zones).has("bld_n")).toBe(false);
  });
});
