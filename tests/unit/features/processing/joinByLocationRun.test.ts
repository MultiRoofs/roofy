/**
 * Join attributes by location driven through a REAL run: the real executor, the
 * real queue, the real table FIFO, the real `readSource` and the real
 * `createVectorTable`.
 *
 * `joinByLocation.test.ts` covers the tool's own behaviour over a stubbed
 * `ToolContext`. What only this file can show is the CLEANUP contract, because
 * it is a property of the whole path rather than of the executor alone: a
 * footprint join holds TWO handles at once — the re-read source's bytes and the
 * per-run `__src_<id>` table — and both must go on every exit, with the shared
 * FIFO handed on rather than left holding a task that will never settle.
 *
 * The scaffolding is `vectorTableLifecycle.test.ts`'s, for the same reason it
 * gave: only `insights/duckdb` is mocked and everything above it is the shipped
 * code, so the death is a real one-shot dispatch and `engineAwait`'s races have
 * something true to race. What differs is the EXECUTOR — that suite registers a
 * stand-in, and this one runs the real one.
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
 *  worker leaves behind (`duckdb-wasm` clears its pending requests without
 *  rejecting them). */
let holdPrefix: string | null = null;
/** The ids the RE-READ SOURCE still holds — §6.1's id join, from the file. */
let sourceIds: string[] = ["B1", "B1P", "B2"];
/** The rows the join statement answers with. */
let joinRows: Array<Record<string, unknown>> = [];

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
    // BEFORE the count branch below: the join statement carries a windowed
    // `COUNT("idx")` of its own, and answering it with a row count would make
    // every building read as "outside every area".
    if (statement.startsWith("WITH b AS (")) {
      return { ok: true as const, columns: [], rows: joinRows };
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
const { joinColumns, joinParams } =
  await import("../../../../src/features/processing/crossLayerParams");
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
        ],
      },
    },
  });
}

/** §7.5's frozen bag for a FOOTPRINT join that copies one field. */
const PARAMS = {
  proxy: "footprint",
  predicate: "intersects",
  fields: ["zone"],
  tie: "first",
  writeMatchCount: true,
  fieldTypes: { zone: "VARCHAR" },
};

function submitJoin(sourceLayerId: string): string {
  return submitRun({
    toolId: "join-by-location",
    targetLayerId: "CITY",
    sourceLayerId,
    scope: "all",
    lod: null,
    params: PARAMS,
    prefix: "zones_",
    // What the FORM promised, from the registry's own answer.
    columns: [...joinColumns("zones_", joinParams(PARAMS))],
  });
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
  joinRows = [
    {
      id: "B1",
      f: "B1",
      no_proxy: false,
      matches_n_feature: 1,
      zones_zone: "A",
      zones_matches_n: 1,
    },
    {
      id: "B1P",
      f: "B1",
      no_proxy: false,
      matches_n_feature: 1,
      zones_zone: "A",
      zones_matches_n: 1,
    },
    {
      id: "B2",
      f: "B2",
      no_proxy: false,
      matches_n_feature: 0,
      zones_zone: null,
      zones_matches_n: 0,
    },
  ];
  resetLayerTablesForTest();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
});

afterEach(() => {
  holdPrefix = null;
});

describe("a real Join run", () => {
  it("is wired into the executor table", () => {
    expect(EXECUTORS["join-by-location"]).toBeDefined();
  });

  it("writes the copied column and §7.5's card line, releasing BOTH handles", async () => {
    await seedCity();
    const id = submitJoin(addZones());
    await until(() => runById(id)?.status === "done");

    expect(runById(id)).toMatchObject({ status: "done" });
    // §7.5's own sentence: one building joined, one outside every area — two
    // FEATURES out of three rows.
    expect(runById(id)?.summary?.line).toMatch(
      /^1 building joined · 1 outside every area · /,
    );
    // The publication reached the model, on the part as well as the root.
    const objects = useLayerStore.getState().layers[0]?.model.objects ?? {};
    expect(objects["B1"]?.attributes["zones_zone"]).toBe("A");
    expect(objects["B1P"]?.attributes["zones_zone"]).toBe("A");
    expect(objects["B2"]?.attributes["zones_matches_n"]).toBe(0);
    // Two handles, two owners, both gone: the re-read bytes and the per-run
    // vector table.
    expect(registered).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    expect(await queueIsFree()).toBe(true);
  });

  it("releases both handles and publishes NOTHING when the run is CANCELLED", async () => {
    await seedCity();
    // The join statement never answers until the cancel reaches its race.
    holdPrefix = "WITH b AS (";
    const id = submitJoin(addZones());
    await until(() => sql.some((s) => s.startsWith("WITH b AS (")));

    cancelRun(id);
    await settle();

    expect(runById(id)?.status).toBe("cancelled");
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    // Nothing published: no write transaction was ever opened.
    expect(sql.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(sql.some((s) => s.startsWith("ALTER TABLE"))).toBe(false);
    expect(await queueIsFree()).toBe(true);
  });

  it("gives the slot back when the engine DIES under the join statement", async () => {
    await seedCity();
    holdPrefix = "WITH b AS (";
    const id = submitJoin(addZones());
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
    expect(sql.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(await queueIsFree()).toBe(true);
  });

  it("fails with §6.1's sentence when the source lost a scoped row", async () => {
    await seedCity();
    // The file no longer holds the ROOT, which the footprint join measures
    // through its part and would otherwise never miss.
    sourceIds = ["B1P", "B2"];
    const id = submitJoin(addZones());
    await until(() => runById(id)?.status === "failed");

    expect(runById(id)?.error).toBe(SOURCE_IDS_DIFFER);
    // BEFORE the compute, and with both handles released anyway.
    expect(sql.some((s) => s.startsWith("WITH b AS ("))).toBe(false);
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerNameOf(id)]),
    );
    expect(await queueIsFree()).toBe(true);
  });
});
