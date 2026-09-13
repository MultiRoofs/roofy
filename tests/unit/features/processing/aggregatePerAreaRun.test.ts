/**
 * Aggregate buildings per area driven through a REAL run: the real executor,
 * the real queue, the real table FIFO, the real `readSource`, the real
 * `createVectorTable` and §7.6's real publication into the feature properties.
 *
 * `aggregatePerArea.test.ts` covers the tool's own behaviour over a stubbed
 * `ToolContext`. What only this file can show is the CLEANUP contract, because
 * it is a property of the whole path rather than of the executor alone — and
 * here the direction is reversed: the per-run `__src_<id>` table is the
 * EXECUTOR's, not the queue's, so a Cancel or a death under the compute has to
 * find its `finally` rather than the queue's.
 *
 * The scaffolding is `joinByLocationRun.test.ts`'s, for the reason it gives:
 * only `insights/duckdb` is mocked and everything above it is the shipped code,
 * so the death is a real one-shot dispatch and `engineAwait`'s races have
 * something true to race.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** Every statement the engine was asked for, in order. */
const sql: string[] = [];
/** Every VFS name registered / dropped, in order. */
const registered: string[] = [];
const dropped: string[] = [];
let engineState: "ready" | "failed" = "ready";
const deathListeners = new Set<() => void>();
/** Statements starting with this prefix NEVER settle, which is what a dead
 *  worker leaves behind. */
let holdPrefix: string | null = null;
/** The ids the RE-READ SOURCE still holds — §6.1's id join, from the file. */
let sourceIds: string[] = ["B1", "B1P", "B2"];
/** The rows the aggregate statement answers with. */
let areaRows: Array<Record<string, unknown>> = [];

function die(): void {
  if (engineState === "failed") return;
  engineState = "failed";
  for (const listener of Array.from(deathListeners)) {
    deathListeners.delete(listener);
    listener();
  }
}

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (engineState !== "ready") {
      return {
        ok: false as const,
        message: "The analytics engine is not running",
      };
    }
    if (holdPrefix !== null && statement.startsWith(holdPrefix)) {
      return await new Promise<never>(() => {});
    }
    if (statement.startsWith("DESCRIBE")) {
      return {
        ok: true as const,
        columns: [],
        rows: [
          { column_name: "id", column_type: "VARCHAR" },
          { column_name: "feature_id", column_type: "VARCHAR" },
          // An LoD 0 rung, so §7.5's footprint proxy is on offer at all.
          { column_name: "geometry_lod0", column_type: "BLOB" },
        ],
      };
    }
    // BEFORE the count branch below: the aggregate statement carries COUNTs of
    // its own, and answering it with a row count would publish nothing.
    if (statement.startsWith("WITH b AS (")) {
      return { ok: true as const, columns: [], rows: areaRows };
    }
    if (statement.includes("COUNT(")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 2 }] };
    }
    // The scope rows off the layer TABLE.
    if (
      statement.startsWith(`SELECT "id", COALESCE("feature_id", "id") AS f`)
    ) {
      return {
        ok: true as const,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B1P", f: "B1" },
          { id: "B2", f: "B2" },
        ],
      };
    }
    // §6.1's id join, straight off the reader.
    if (statement.startsWith(`SELECT "id" FROM read_cityjson(`)) {
      return {
        ok: true as const,
        columns: ["id"],
        rows: sourceIds.map((id) => ({ id })),
      };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.add(listener);
      return () => deathListeners.delete(listener);
    }),
    getDuckDBStatus: vi.fn(() =>
      engineState === "ready"
        ? {
            state: "ready",
            extensions: {},
            loadedExtensions: [],
            platform: "wasm_eh",
          }
        : { state: "failed", error: "worker stopped" },
    ),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => true),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string) => {
      if (engineState !== "ready") return false;
      registered.push(name);
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

// Dynamic, and AFTER the mock state above: a static import is hoisted past
// those `let`s and the factory would read them in their temporal dead zone.
const { enqueueLayerTable, resetLayerTablesForTest, runOnTableQueue } =
  await import("../../../../src/insights/layerTables");
const { submitRun, cancelRun } =
  await import("../../../../src/features/processing/runQueue");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { aggregateColumns, aggregateParams } =
  await import("../../../../src/features/processing/crossLayerParams");
const { geoRecords } =
  await import("../../../../src/features/geoLayers/geoRecords");
const { SOURCE_IDS_DIFFER } =
  await import("../../../../src/features/processing/sourceRead");
// The real executor, registered by `tools/register` — which `runQueue` imports.
// Named here so the suite fails loudly if it ever stops being wired.
const { EXECUTORS } = await import("../../../../src/features/processing/tools");

function object(id: string, parents: string[] = []) {
  return {
    id,
    objectType: parents.length > 0 ? "BuildingPart" : "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [],
    parents,
    lod: null,
  };
}

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
    },
    bbox: null,
    objects: {
      B1: object("B1"),
      B1P: object("B1P", ["B1"]),
      B2: object("B2"),
    },
    vertexCount: 0,
  } as unknown as CityModel;
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

/** A reader-backed source: what the FOOTPRINT proxy needs to re-read. */
function readerBytes() {
  return {
    kind: "bytes" as const,
    bytes: new Uint8Array(4),
    reader: "read_cityjson" as const,
    extension: "city.json" as const,
    provider: async () => new Uint8Array(4),
  };
}

function ring(x: number): number[][] {
  return [
    [x, 52],
    [x + 1, 52],
    [x + 1, 53],
    [x, 52],
  ];
}

/** Two areas; the second one's geometry is taken away by `broken`. */
function addZones(broken = false): string {
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
            geometry: { type: "Polygon", coordinates: [ring(4)] },
          },
          {
            type: "Feature",
            id: "z2",
            properties: { zone: "B" },
            geometry: broken
              ? null
              : { type: "Polygon", coordinates: [ring(6)] },
          },
        ],
      },
    },
  });
}

/** The layer's CURRENT prepared document with the second area's geometry
 *  removed — its properties, a finished run's results included, untouched. */
function withoutGeometry(): unknown {
  const layer = useGeoLayerStore
    .getState()
    .layers.find((l) => l.kind === "geojson");
  if (layer === undefined || layer.kind !== "geojson") {
    throw new Error("the zones layer is gone");
  }
  const document = layer.config.preparedData as {
    type: string;
    features: Array<Record<string, unknown>>;
  };
  return {
    ...document,
    features: document.features.map((feature, i) =>
      i === 1 ? { ...feature, geometry: null } : feature,
    ),
  };
}

/** The layer's records, narrowed once. */
function zoneRecords(id: string): ReadonlyArray<Record<string, unknown>> {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer === undefined || layer.kind !== "geojson") {
    throw new Error("the zones layer is gone");
  }
  return geoRecords(layer.config.preparedData) as ReadonlyArray<
    Record<string, unknown>
  >;
}

/** §7.6's frozen bag for a FOOTPRINT aggregate that counts and sums. */
const PARAMS = {
  proxy: "footprint",
  predicate: "intersects",
  rows: [
    { op: "count", column: null },
    { op: "sum", column: "roof_area_m2" },
  ],
};

function submitAggregate(zones: string): string {
  return submitRun({
    toolId: "aggregate-per-area",
    targetLayerId: zones,
    sourceLayerId: "CITY",
    scope: "all",
    lod: null,
    params: PARAMS,
    prefix: "bld_",
    // What the FORM promised, from the registry's own answer.
    columns: [...aggregateColumns("bld_", aggregateParams(PARAMS))],
  });
}

/** One aggregate-statement row, the three card scalars included. */
function area(
  sid: string,
  values: Record<string, unknown>,
  card: {
    multi?: number | bigint;
    total?: number | bigint;
    noProxy?: number | bigint;
  } = {},
): Record<string, unknown> {
  return {
    sid,
    ...values,
    multi_n: card.multi ?? 0,
    buildings_total: card.total ?? 0,
    no_proxy_n: card.noProxy ?? 0,
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Let the loop turn until `ready()` holds, or give up after ~40 turns. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !ready(); i += 1) {
    for (let m = 0; m < 20; m += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The FIFO is free: a task queued now actually runs. */
async function queueIsFree(): Promise<boolean> {
  let ran = false;
  await runOnTableQueue(async () => {
    ran = true;
  });
  return ran;
}

async function seedCity(): Promise<void> {
  useLayerStore.setState({ layers: [cityLayer()] });
  await enqueueLayerTable("CITY", readerBytes());
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
}

/** The VFS name `readSource` mints for a run — `<table>_<runId>.<extension>`. */
const readerNameOf = (runId: string) => `layer_1_${runId}.city.json`;

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  engineState = "ready";
  holdPrefix = null;
  sourceIds = ["B1", "B1P", "B2"];
  // The COUNTs as BIGINTs, which is what `COUNT(m."f")` is: the publication
  // must put plain numbers on the feature properties whatever the engine hands
  // back, because a `2n` there would break a GeoJSON export of the layer.
  areaRows = [
    area(
      "id:string:z1",
      { bld_buildings_n: 2n, bld_sum_roof_area_m2: 90 },
      { total: 2n },
    ),
    area(
      "id:string:z2",
      { bld_buildings_n: 0n, bld_sum_roof_area_m2: null },
      { total: 2n },
    ),
  ];
  resetLayerTablesForTest();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useComputedColumnStore.setState({ byLayer: {} });
});

afterEach(() => {
  holdPrefix = null;
});

describe("a real Aggregate run", () => {
  it("is wired into the executor table", () => {
    expect(EXECUTORS["aggregate-per-area"]).toBeDefined();
  });

  it("publishes §7.6's columns and card line, releasing BOTH handles", async () => {
    await seedCity();
    const zones = addZones();
    const id = submitAggregate(zones);
    await until(() => runById(id)?.status === "done");

    expect(runById(id)).toMatchObject({ status: "done", undoable: true });
    expect(runById(id)?.summary?.line).toMatch(
      /^2 areas aggregated over 2 buildings · /,
    );
    // §7.6's publication: the feature PROPERTIES, one row per area — the empty
    // area's count is a real 0 and its sum is NULL.
    expect(zoneRecords(zones)[0]).toMatchObject({
      bld_buildings_n: 2,
      bld_sum_roof_area_m2: 90,
    });
    expect(typeof zoneRecords(zones)[0]?.["bld_buildings_n"]).toBe("number");
    expect(zoneRecords(zones)[1]).toMatchObject({
      bld_buildings_n: 0,
      bld_sum_roof_area_m2: null,
    });
    // Two handles, two owners, both gone: the per-run vector table (this
    // executor's own, unlike §7.5's) and the re-read bytes.
    expect(registered).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    // The CITY table is where it computed; nothing may land on it.
    expect(sql.some((s) => s.startsWith("ALTER TABLE"))).toBe(false);
    expect(sql.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(await queueIsFree()).toBe(true);
  });

  it("releases both handles and publishes NOTHING when the run is CANCELLED", async () => {
    await seedCity();
    // The aggregate statement never answers until the cancel reaches its race.
    holdPrefix = "WITH b AS (";
    const zones = addZones();
    const id = submitAggregate(zones);
    await until(() => sql.some((s) => s.startsWith("WITH b AS (")));

    cancelRun(id);
    await settle();

    expect(runById(id)?.status).toBe("cancelled");
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    // Nothing published, on either layer.
    expect(zoneRecords(zones)[0]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 2 }),
    );
    expect(sql.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(await queueIsFree()).toBe(true);
  });

  it("gives the slot back when the engine DIES under the aggregate", async () => {
    await seedCity();
    holdPrefix = "WITH b AS (";
    const zones = addZones();
    const id = submitAggregate(zones);
    await until(() => sql.some((s) => s.startsWith("WITH b AS (")));

    die();
    await settle();

    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Analytics engine stopped",
    });
    // The cleanup still RAN — a race started after the death hears nothing, and
    // every primitive answers immediately once the engine is gone.
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    expect(zoneRecords(zones)[0]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 2 }),
    );
    expect(await queueIsFree()).toBe(true);
  });

  it("fails with §6.1's sentence when the source lost a scoped row", async () => {
    await seedCity();
    // The file no longer holds the ROOT, which a footprint proxy measures
    // through its part and would otherwise never miss.
    sourceIds = ["B1P", "B2"];
    const id = submitAggregate(addZones());
    await until(() => runById(id)?.status === "failed");

    expect(runById(id)?.error).toBe(SOURCE_IDS_DIFFER);
    // BEFORE the compute, and with both handles released anyway.
    expect(sql.some((s) => s.startsWith("WITH b AS ("))).toBe(false);
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(await queueIsFree()).toBe(true);
  });

  it("writes NULL over an area whose geometry became unusable", async () => {
    // §7.6's "the target's every feature is written", end to end: the first run
    // populates both areas, the second runs over a document whose second area
    // has lost its geometry — and that area must come back NULL rather than
    // keep the FIRST run's number under the SECOND run's provenance.
    await seedCity();
    const zones = addZones();
    const first = submitAggregate(zones);
    await until(() => runById(first)?.status === "done");
    expect(zoneRecords(zones)[1]).toMatchObject({ bld_buildings_n: 0 });

    // z2's GEOMETRY is taken away — its properties, this run's results
    // included, stay exactly where they were.
    useGeoLayerStore
      .getState()
      .replaceGeoPreparedData(zones, withoutGeometry());
    areaRows = [
      area(
        "id:string:z1",
        { bld_buildings_n: 4, bld_sum_roof_area_m2: 120 },
        { total: 4 },
      ),
    ];
    const second = submitAggregate(zones);
    await until(() => runById(second)?.status === "done");

    expect(runById(second)?.summary?.line).toMatch(
      /^1 area aggregated over 4 buildings · /,
    );
    expect(runById(second)?.warnings).toContain(
      "1 area skipped: invalid geometry",
    );
    const records = zoneRecords(zones);
    expect(records[0]).toMatchObject({ bld_buildings_n: 4 });
    // NOT the first run's 0: the area preflight could not use is written NULL,
    // so the layer never shows a value this run does not stand behind.
    expect(records[1]).toMatchObject({ bld_buildings_n: null });
  });
});
