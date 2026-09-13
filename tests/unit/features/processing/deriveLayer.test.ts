/**
 * §6's derived-layer NAMES and the PREPARATION of a derived city layer.
 *
 * Two halves, and only the second one needs an engine. The name rules are pure,
 * so their fixtures are name-only stand-ins: `nameTaken`/`disambiguate` read
 * exactly ONE field, and a test that built real records for them would be
 * asserting `addLayer`'s defaults, which is another suite's job.
 *
 * `prepareDerivedCityLayer` drives the stores and a fake database, so the
 * module is imported through `await import` — the mock factories below hold
 * this file's own `sql` and `adopted` fixtures, and a static import would run
 * them before those bindings exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GeoJsonLayer,
  GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

/** Every statement the preparation sent, in order. */
const sql: string[] = [];
/** Tables `adoptLayerTable` was handed, by layer id. */
const adopted = new Map<string, unknown>();
/** `onEngineDeath`'s waiters. ONE-SHOT, as in `duckdb.ts`. */
const deathListeners = new Set<() => void>();
/** The engine dies while the first statement containing this is in flight. */
let dieOn: string | null = null;

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (dieOn !== null && statement.includes(dieOn)) {
      dieOn = null;
      // Deleted as it fires, like `duckdb.ts`'s own one-shot death: a `raced`
      // STARTED after the death (the DROP below) must hear nothing.
      for (const listener of deathListeners) {
        deathListeners.delete(listener);
        listener();
      }
    }
    if (statement.includes('COALESCE("feature_id", "id") AS f')) {
      return { ok: true as const, columns: ["f"], rows: [{ f: "a" }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.add(listener);
      return () => deathListeners.delete(listener);
    }),
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
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  let n = 100;
  // ONE chain, exactly like the real queue — that is what makes the "takes no
  // slot of its own" case below a real regression: a nested enqueue would wait
  // for a slot the preparation is holding, and the case would time out.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    useLayerTableStore: store,
    getLayerTable: vi.fn(() => null),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    // Present so the case below can assert it was never called; the real one
    // would deadlock here.
    enqueueLayerTable: vi.fn(async () => {}),
    refreshLayerTableColumns: vi.fn(async () => {}),
    nextTableName: vi.fn(() => `layer_${++n}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
    }),
  };
});

const {
  derivedLayerName,
  disambiguate,
  nameTaken,
  prepareDerivedCityLayer,
  prepareDerivedVectorLayer,
} = await import("../../../../src/features/processing/deriveLayer");

const city = (name: string): Layer => ({ name }) as unknown as Layer;
const geo = (name: string): GeoLayer => ({ name }) as unknown as GeoLayer;

describe("derivedLayerName", () => {
  it("is spec §6's prefill for each of the seven tools", () => {
    expect(derivedLayerName("Delft", "roof-metrics", null)).toBe(
      "Delft · roof metrics",
    );
    expect(derivedLayerName("Delft", "measure-solids", null)).toBe(
      "Delft · solids",
    );
    expect(derivedLayerName("Delft", "validate-solids", null)).toBe(
      "Delft · validation",
    );
    expect(derivedLayerName("Delft", "height-from-extent", null)).toBe(
      "Delft · extent",
    );
    expect(derivedLayerName("Delft", "join-by-location", "Zones")).toBe(
      "Delft + Zones",
    );
    expect(derivedLayerName("Zones", "aggregate-per-area", "Delft")).toBe(
      "Zones · buildings",
    );
    expect(derivedLayerName("Delft", "distance-to-nearest", "Roads")).toBe(
      "Delft · nearest Roads",
    );
  });

  it("drops the source segment when no source is chosen yet", () => {
    // The form prefills on every render, including before the SOURCE select
    // has an answer. Run is already refused then (Task 11's source reason), so
    // the name only has to be printable and stable — not runnable.
    expect(derivedLayerName("Delft", "join-by-location", null)).toBe("Delft");
    expect(derivedLayerName("Delft", "distance-to-nearest", null)).toBe(
      "Delft · nearest",
    );
  });
});

describe("nameTaken", () => {
  it("compares trimmed and case-insensitively, across BOTH stores", () => {
    const layers = [city("Delft")];
    const geoLayers = [geo("Zones")];
    expect(nameTaken("Delft", layers, geoLayers)).toBe(true);
    expect(nameTaken("  delft ", layers, geoLayers)).toBe(true);
    expect(nameTaken("ZONES", layers, geoLayers)).toBe(true);
    expect(nameTaken("Delft · solids", layers, geoLayers)).toBe(false);
  });

  it("does not call an EMPTY name taken — that is the other error", () => {
    // Two messages, two causes: an empty name is A13, a duplicate is A14, and
    // a blank string matching a blank layer name would report the wrong one.
    expect(nameTaken("", [city("Delft")], [])).toBe(false);
    expect(nameTaken("   ", [city("Delft")], [])).toBe(false);
  });
});

describe("disambiguate", () => {
  it("leaves a free name alone and says it did not rename", () => {
    expect(disambiguate("Delft · solids", [city("Delft")], [])).toEqual({
      name: "Delft · solids",
      renamed: false,
    });
  });

  it("appends ' (2)' and reports the rename (§6, §10.12)", () => {
    expect(
      disambiguate("Delft · solids", [city("Delft · solids")], []),
    ).toEqual({ name: "Delft · solids (2)", renamed: true });
  });

  it("walks past a taken ' (2)' rather than colliding again", () => {
    expect(
      disambiguate(
        "Delft · solids",
        [city("Delft · solids"), city("Delft · solids (2)")],
        [],
      ),
    ).toEqual({ name: "Delft · solids (3)", renamed: true });
  });

  it("counts a GEO layer's name as taken, and trims before appending", () => {
    expect(
      disambiguate("  Zones · buildings  ", [], [geo("Zones · buildings")]),
    ).toEqual({ name: "Zones · buildings (2)", renamed: true });
  });
});

const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { GEO_STABLE_FEATURE_KEY, readGeoStableFeatureId } =
  await import("../../../../src/features/geoLayers/geoJsonRecords");
const { geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");
const { runQuery } = await import("../../../../src/insights/duckdb");
const tables = await import("../../../../src/insights/layerTables");
const { CancelledError, EngineDeadError } =
  await import("../../../../src/insights/engineAwait");

function parentLayer(): Layer {
  return useLayerStore.getState().layers[0]!;
}

function seedParent(): string {
  // The bboxes are REAL and SEPARATED: `b` sits 100 m away from `a`, so a copy
  // that kept the parent's envelope is visibly different from one that
  // computed its own (the "Zoom to layer" case below).
  return useLayerStore.getState().addLayer({
    name: "Delft",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [0, 0, 0, 110, 110, 9],
      objects: {
        a: {
          id: "a",
          objectType: "Building",
          attributes: { height: 9 },
          surfaces: [],
          bbox: [0, 0, 0, 10, 10, 9],
          children: ["a-1"],
          parents: [],
          lod: null,
        },
        "a-1": {
          id: "a-1",
          objectType: "BuildingPart",
          attributes: {},
          surfaces: [],
          bbox: [0, 0, 0, 10, 10, 9],
          children: [],
          parents: ["a"],
          lod: null,
        },
        b: {
          id: "b",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          bbox: [100, 100, 0, 110, 110, 6],
          children: [],
          parents: [],
          lod: null,
        },
      },
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
  });
}

const parentTable = () => ({
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: async () => new Uint8Array(),
  reader: "read_cityjson" as const,
  extension: "city.json" as const,
  sourceBytes: 1234,
  sourceFeatureIds: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [{ label: "2.2", suffix: "2_2" }],
  rowCount: 3,
});

async function prepare(
  rowIds: ReadonlyArray<string> | null,
  signal: AbortSignal = new AbortController().signal,
) {
  return await prepareDerivedCityLayer({
    runId: "run_7",
    parent: parentLayer(),
    parentTable: parentTable(),
    name: "Delft · extent",
    rowIds,
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([["a", { extent_height_m: 9 }]]),
    signal,
    // Straight at the mocked primitive, so the roots query gets the fake's
    // `AS f` answer and the CTAS is built from real ids. A fake that returned
    // `rows: []` for everything would make the CTAS `IN ()` and the assertion
    // below pass for the wrong reason.
    query: async (_label, statement) => await runQuery(statement),
  });
}

/** The same preparation, run INSIDE a slot of the (one-chain) table queue —
 *  which is where the run's own `execute` calls it from. */
async function prepareOnQueue(
  rowIds: ReadonlyArray<string> | null,
  signal?: AbortSignal,
) {
  return await tables.runOnTableQueue(() => prepare(rowIds, signal));
}

/** Lets the abandoned write finish pushing its statements, so a rejected
 *  preparation cannot leak SQL into the next case's cleared trace. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sql.length = 0;
  adopted.clear();
  dieOn = null;
  deathListeners.clear();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useComputedColumnStore.setState({ byLayer: {} });
  seedParent();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("prepareDerivedCityLayer", () => {
  it("cuts the copy from the PARENT'S TABLE, by feature ROOT", async () => {
    await prepareOnQueue(["a", "a-1"]);
    // Not `"id" IN (…)`: §6's copy holds the scoped FEATURES, and a feature is
    // its root plus its parts (Design decision (f)).
    expect(
      sql.some((s) =>
        /^CREATE TABLE "layer_\d+" AS SELECT \* FROM "layer_1" WHERE COALESCE\("feature_id", "id"\) IN \('a'\)$/.test(
          s,
        ),
      ),
    ).toBe(true);
    // NOT through the reader: re-reading a 300 MB CityJSON for rows the engine
    // already holds is a minute of parsing for nothing, and a CityGML parent
    // has no reader at all.
    expect(sql.some((s) => s.includes("read_cityjson("))).toBe(false);
  });

  it("publishes NOTHING before publish()", async () => {
    await prepare(["a", "a-1"]);
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("publishes the table, the row and the activation in ONE step", async () => {
    const parentId = parentLayer().id;
    const plan = await prepareOnQueue(["a", "a-1"]);
    const id = plan.publish();
    const layers = useLayerStore.getState().layers;
    expect(layers.map((l) => l.name)).toEqual(["Delft", "Delft · extent"]);
    expect(layers[1]?.derivedFrom).toEqual({
      layerId: parentId,
      layerName: "Delft",
      runId: "run_7",
    });
    expect(adopted.has(id)).toBe(true);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(id);
  });

  it("makes the copy reader-backed, filtered to the roots it was cut with", async () => {
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    expect(adopted.get(id)).toMatchObject({
      reader: "read_cityjson",
      extension: "city.json",
      lods: [{ label: "2.2", suffix: "2_2" }],
      sourceFeatureIds: ["a"],
    });
  });

  it("describes the copy's table WITH the columns just written into it", async () => {
    // The `ALTER`s have already changed the table's shape; an adopted `info`
    // carrying only the parent's list would hide the new columns from the
    // grid and let the NEXT run's Undo drop them as if it had created them.
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    const columns = (adopted.get(id) as { columns: Array<{ name: string }> })
      .columns;
    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "extent_height_m",
    ]);
  });

  it("copies only the SCOPED objects into the model, with the new values", async () => {
    const plan = await prepare(["a", "a-1"]);
    plan.publish();
    const model = useLayerStore.getState().layers[1]!.model;
    expect(Object.keys(model.objects).sort()).toEqual(["a", "a-1"]);
    expect(model.objects.a?.attributes).toMatchObject({
      height: 9,
      extent_height_m: 9,
    });
    // The PARENT is untouched: §6, "the run leaves the target untouched".
    expect(
      useLayerStore.getState().layers[0]!.model.objects.a?.attributes,
    ).toEqual({ height: 9 });
  });

  it("carries the parent's provenance across for inherited columns", async () => {
    const parentId = parentLayer().id;
    useComputedColumnStore.getState().setProvenance(parentId, "roof_area_m2", {
      runId: "run_1",
      toolName: "Roof metrics to attributes",
      summary: "All 2 buildings",
      at: 1,
      partial: null,
      previous: null,
    });
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    // §6: "inherited computed columns keep their provenance".
    expect(
      useComputedColumnStore.getState().byLayer[id]?.["roof_area_m2"]?.toolName,
    ).toBe("Roof metrics to attributes");
  });

  it("re-checks the name AT publication and appends ' (2)' (§10.12)", async () => {
    const plan = await prepare(["a", "a-1"]);
    // The rename lands while the run is queued — after `prepare`, before
    // `publish`. This is the whole reason the check is inside `publish()`.
    useLayerStore
      .getState()
      .updateLayer(parentLayer().id, { name: "Delft · extent" });
    const id = plan.publish();
    expect(useLayerStore.getState().layers.find((l) => l.id === id)?.name).toBe(
      "Delft · extent (2)",
    );
    // `plan.name` still says what was ASKED for, so the caller can tell the
    // two apart and put §10.12's sentence on the card.
    expect(plan.name).toBe("Delft · extent");
  });

  it("drops the half-built table on discard, and publishes nothing", async () => {
    const plan = await prepareOnQueue(["a", "a-1"]);
    await plan.discard();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("drops the table when a CANCEL lands before publication", async () => {
    // §6.1: "A cancel (or a failure) that lands BEFORE publication discards
    // every partial resource … and the run reads cancelled with nothing
    // changed." The cancel is seen by the raced write, which is the longest
    // await of the preparation and where a Cancel actually lands.
    // The CLASS, not just "it threw": `execute` reads a `CancelledError` as
    // "cancelled" and anything else as "failed" (`runQueue.ts`'s own write does
    // the same translation), so a generic Error here would make a cancelled
    // New-layer run read as a failed one with the word "Cancelled" on it.
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareOnQueue(["a", "a-1"], controller.signal),
    ).rejects.toBeInstanceOf(CancelledError);
    await settle();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("drops the table when the ENGINE DIES before publication", async () => {
    // The reason the write is `raced`: a transaction caught by the death never
    // answers, and this await is inside the shared FIFO slot. Unraced, the
    // queue would be held for the life of the page and nothing would be
    // dropped either.
    dieOn = "BEGIN TRANSACTION";
    await expect(prepareOnQueue(["a", "a-1"])).rejects.toBeInstanceOf(
      EngineDeadError,
    );
    await settle();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("copies the WHOLE parent table and keeps no filter for scope 'all'", async () => {
    await prepare(null);
    expect(
      sql.some((s) =>
        /^CREATE TABLE "layer_\d+" AS SELECT \* FROM "layer_1"$/.test(s),
      ),
    ).toBe(true);
  });

  it("gives the copy its OWN envelope, not the parent's", async () => {
    // `CityModelMesh.getBoundsGeodetic()` reads `model.bbox`
    // (`cityModelMesh.ts:675-687`), and that is what `fitLayer` — §6.2's "Zoom
    // to layer" — frames. A copy that kept `{ ...parent.model }`'s bbox would
    // fly the camera to the PARENT's extent: for a subset of one building in a
    // city, a view of the whole city with the layer somewhere in it.
    //
    // Each copy is located by the id `publish()` RETURNED, never by its index:
    // every publication is inserted directly under the parent, so the second
    // one pushes the first down the list.
    const subset = (await prepare(["a", "a-1"])).publish();
    const byId = (id: string) =>
      useLayerStore.getState().layers.find((l) => l.id === id);
    expect(byId(subset)?.model.bbox).toEqual([0, 0, 0, 10, 10, 9]);
    // Scope "all" copies every object, so the parent's own envelope IS the
    // copy's and no walk is needed.
    const whole = (await prepare(null)).publish();
    expect(byId(whole)?.model.bbox).toEqual([0, 0, 0, 110, 110, 9]);
    // And the subset is still the subset: proof the assertion above did not
    // read whichever layer happened to sit at an index.
    expect(byId(subset)?.model.bbox).toEqual([0, 0, 0, 10, 10, 9]);
  });

  it("copies a MANUAL LoD choice, mode included (§6.2)", async () => {
    // `addLayer` derives `selectedLod` from the model and hard-codes
    // `lodMode: "auto"`, and `setLayerLod` does not touch the mode
    // (`layerStore.ts:432-437`) — so a copy that set only the LoD would sit in
    // auto mode and re-derive it on the next model change. §6.2 asks for "an
    // independent COPY of the target's LoD choice".
    const parentId = parentLayer().id;
    useLayerStore.getState().setLayerLod(parentId, "1.2");
    useLayerStore.getState().setLodMode(parentId, "manual");
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    const copy = useLayerStore.getState().layers.find((l) => l.id === id);
    expect(copy?.selectedLod).toBe("1.2");
    expect(copy?.lodMode).toBe("manual");
  });

  it("takes no table-queue slot of its own — the run already holds one", async () => {
    // The deadlock Design decision (f) calls a hard fact: `enqueueLayerTable`
    // goes through the same `enqueue` the run is already inside, so a build
    // started here would wait for a slot this run is holding and the page
    // would freeze with no other symptom. Asserted BEHAVIOURALLY — the
    // preparation is run INSIDE a slot of the mocked queue (one chain, like
    // the real one) and must ask for neither a build nor a second slot. A
    // source-text assertion cannot be used: the module's own doc comment
    // contains the word `enqueueLayerTable`, which is where the rule is
    // written down.
    const plan = await tables.runOnTableQueue(() => prepare(["a", "a-1"]));
    expect(tables.enqueueLayerTable).not.toHaveBeenCalled();
    expect(vi.mocked(tables.runOnTableQueue)).toHaveBeenCalledTimes(1);
    // And the publication takes none either: it is one synchronous step.
    plan.publish();
    expect(tables.enqueueLayerTable).not.toHaveBeenCalled();
    expect(vi.mocked(tables.runOnTableQueue)).toHaveBeenCalledTimes(1);
    // The slot really was given back — a second one is reachable.
    await tables.runOnTableQueue(async () => undefined);
  });
});

/**
 * §6's OTHER copy: a derived VECTOR layer.
 *
 * "A derived vector layer is a plain GeoJSON layer" — no table, no model, no
 * engine. So none of the mocks above are reached by these cases; what is under
 * test is the document the copy carries and the row the store gains.
 */
function zonesDocument(): unknown {
  const feature = (name: string) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [[]] },
  });
  return {
    type: "FeatureCollection",
    features: [feature("North"), feature("South")],
  };
}

function zonesLayer(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    kind: "geojson",
    name: "Zones",
    config: { data: zonesDocument() },
  });
}

/** The layer as the store holds it, narrowed once — every read below wants
 *  `config.preparedData`, which only the GeoJSON arm has. */
function geoLayer(id: string): GeoJsonLayer {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer?.kind !== "geojson") throw new Error("not a geojson layer");
  return layer;
}

function preparedFeatures(
  layer: GeoJsonLayer,
): Array<{ properties: Record<string, unknown> }> {
  const doc = layer.config.preparedData as {
    features?: Array<{ properties: Record<string, unknown> }>;
  };
  return doc.features ?? [];
}

/** The stable id the store actually stamped on the Nth prepared feature —
 *  read BACK rather than assumed, because it is the key the run's rows are
 *  keyed by and the only honest source of it is the document itself. */
function stableIdOf(layer: GeoJsonLayer, index: number): string {
  const id = readGeoStableFeatureId(
    preparedFeatures(layer)[index]?.properties ?? {},
  );
  if (id === null) throw new Error("no stable id on the prepared feature");
  return id;
}

describe("prepareDerivedVectorLayer", () => {
  it("copies EVERY target area, not only the ones with a value (§6, §10.11)", async () => {
    const parentId = zonesLayer();
    const parent = geoLayer(parentId);
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
      // Only ONE area was counted; the other still belongs in the copy.
      rows: new Map([[stableIdOf(parent, 0), { bld_buildings_n: 2 }]]),
    });
    const id = plan.publish();
    const features = preparedFeatures(geoLayer(id));
    expect(features).toHaveLength(2);
    expect(features[0]?.properties["bld_buildings_n"]).toBe(2);
    expect(features[0]?.properties["name"]).toBe("North");
    // §6.2's value rule: an area that was not evaluated gets no value, and a
    // count that WAS evaluated and found nothing is 0 — which is the
    // executor's business, not the copy's.
    expect(Object.keys(features[1]?.properties ?? {})).not.toContain(
      "bld_buildings_n",
    );
    expect(geoLayer(id).derivedFrom).toEqual({
      layerId: parentId,
      layerName: "Zones",
      runId: "run_9",
    });
  });

  it("leaves the PARENT's document untouched", async () => {
    const parentId = zonesLayer();
    const parent = geoLayer(parentId);
    const before = JSON.stringify(parent.config);
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
      rows: new Map([[stableIdOf(parent, 0), { bld_buildings_n: 2 }]]),
    });
    plan.publish();
    const original = geoLayer(parentId);
    expect(
      Object.keys(preparedFeatures(original)[0]?.properties ?? {}),
    ).not.toContain("bld_buildings_n");
    // Byte-identical, config AND preparedData, and the record itself was never
    // replaced — §6's "the run leaves the target untouched".
    expect(JSON.stringify(original.config)).toBe(before);
    expect(original.config).toBe(parent.config);
    expect(original.derivedFrom).toBeNull();
  });

  it("gives the copy its OWN stable-id envelope and shows none of it", async () => {
    // The document handed to `addGeoLayer` is the PREPARED one, which already
    // carries the renderer's private key. Passed through as it stands, the
    // store's own normalisation would stamp a SECOND envelope over it and
    // record the first as the feature's "original value" — which
    // `publicGeoProperties` then hands back as a visible attribute, so the
    // copy's records grid, its Details, its export and its "Color by
    // attribute" list would all offer `__roofy_stable_feature_id`.
    const parentId = zonesLayer();
    const parent = geoLayer(parentId);
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
      rows: new Map([[stableIdOf(parent, 0), { bld_buildings_n: 2 }]]),
    });
    const records = geoRecords(geoLayer(plan.publish()).config.preparedData);
    expect(records).toHaveLength(2);
    expect(Object.keys(records[0] ?? {})).toEqual(["name", "bld_buildings_n"]);
    expect(Object.keys(records[1] ?? {})).toEqual(["name"]);
    expect(Object.keys(records[0] ?? {})).not.toContain(GEO_STABLE_FEATURE_KEY);
  });

  it("publishes nothing before publish(), and inserts under the parent", async () => {
    const first = zonesLayer();
    useGeoLayerStore.getState().addGeoLayer({
      kind: "raster-xyz",
      name: "Basemap",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
    const parent = geoLayer(first);
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    expect(useGeoLayerStore.getState().layers).toHaveLength(2);
    plan.publish();
    expect(useGeoLayerStore.getState().layers.map((l) => l.name)).toEqual([
      "Zones",
      "Zones · buildings",
      "Basemap",
    ]);
  });

  it("activates the copy and copies the parent's style and opacity", async () => {
    const parentId = zonesLayer();
    useGeoLayerStore.getState().updateGeoLayer(parentId, {
      opacity: 0.5,
      style: { ...geoLayer(parentId).style, color: "#123456" },
    });
    const parent = geoLayer(parentId);
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    const id = plan.publish();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(id);
    expect(geoLayer(id).opacity).toBe(0.5);
    expect(geoLayer(id).style.color).toBe("#123456");
    // An independent COPY: a later restyle of the parent leaves it alone.
    expect(geoLayer(id).style).not.toBe(parent.style);
  });

  it("carries the parent's computed columns over with their provenance", async () => {
    const parentId = zonesLayer();
    useComputedColumnStore.getState().setProvenance(parentId, "old_n", {
      runId: "run_0",
      toolName: "Aggregate buildings per area",
      summary: "All 2 buildings",
      at: Date.now(),
      partial: null,
      previous: null,
    });
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent: geoLayer(parentId),
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    const id = plan.publish();
    expect(
      useComputedColumnStore.getState().byLayer[id]?.["old_n"]?.toolName,
    ).toBe("Aggregate buildings per area");
  });

  it("re-checks the name at publication, like a city copy does", async () => {
    const parentId = zonesLayer();
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent: geoLayer(parentId),
      name: "Zones",
      columns: [],
      rows: new Map(),
    });
    expect(geoLayer(plan.publish()).name).toBe("Zones (2)");
  });

  it("discard() is a no-op that publishes nothing", async () => {
    const parentId = zonesLayer();
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent: geoLayer(parentId),
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    await plan.discard();
    expect(useGeoLayerStore.getState().layers).toHaveLength(1);
    // No table was ever cut for it, so nothing was dropped either.
    expect(sql).toHaveLength(0);
  });

  it("refuses a parent that is not a GeoJSON layer", async () => {
    // `ToolTarget`'s vector arm is already `GeoJsonLayer`, so this cannot be
    // reached from a run — but the signature takes the whole union, and a
    // raster parent would otherwise publish a layer with no document at all,
    // which the layer list reads as "needs re-link".
    const id = useGeoLayerStore.getState().addGeoLayer({
      kind: "raster-xyz",
      name: "Basemap",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
    await expect(
      prepareDerivedVectorLayer({
        runId: "run_9",
        parent: useGeoLayerStore.getState().layers.find((l) => l.id === id)!,
        name: "Basemap · buildings",
        columns: [],
        rows: new Map(),
      }),
    ).rejects.toThrow();
  });
});
