/**
 * The per-run vector table's LIFECYCLE, through the real run queue and the
 * REAL table FIFO.
 *
 * `crossLayerRun.test.ts` mocks `insights/layerTables` for its registry, which
 * means its queue is a stand-in and its engine deaths are inert. The guarantees
 * this file is about are guarantees ABOUT that queue — that a run holding
 * `__src_<id>` gives the slot back whatever happens to it, and that the bytes
 * and the table go with it — so here only `insights/duckdb` is mocked and
 * everything above it is the shipped code: `runOnTableQueue`, the registry, the
 * death watch, `engineAwait`'s races, `writeComputedColumns`.
 *
 * The mocked engine is a real enough one for these questions: statements can be
 * HELD (a promise that never settles, which is what duckdb-wasm leaves behind
 * when its worker dies) and the death is a real one-shot dispatch, so
 * `racedWithDeath` has something true to race.
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
/** The engine's one-shot death listeners — the real contract: fired once per
 *  engine and dropped AS they fire. */
const deathListeners = new Set<() => void>();
/** Statements starting with this prefix NEVER settle, which is what a dead
 *  worker leaves behind (`duckdb-wasm` clears its pending requests without
 *  rejecting them). */
let holdPrefix: string | null = null;

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
    // Once the engine is gone every primitive answers IMMEDIATELY — that is
    // what makes a race started after the death safe (`engineAwait`'s one
    // limit). Only the await already in flight hangs.
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
          { column_name: "geometry_lod2_2", column_type: "BLOB" },
        ],
      };
    }
    if (statement.includes("COUNT(")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 1 }] };
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
const {
  enqueueLayerTable,
  resetLayerTablesForTest,
  runOnTableQueue,
  getLayerTable,
} = await import("../../../../src/insights/layerTables");
const { submitRun, cancelRun } =
  await import("../../../../src/features/processing/runQueue");
type Ctx = import("../../../../src/features/processing/runQueue").ToolContext;
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { readSource } =
  await import("../../../../src/features/processing/sourceRead");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
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

/** A reader-backed source: the only kind whose run ALSO holds a re-read
 *  buffer, which is the case where two handles are open at once. */
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

function makeGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
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

function submitJoin(sourceLayerId: string): string {
  return submitRun({
    toolId: "join-by-location",
    targetLayerId: "CITY",
    sourceLayerId,
    scope: "all",
    lod: null,
    params: {},
    prefix: "zones_",
    destination: "layer" as const,
    newLayerName: null,
    columns: [{ name: "zones_n", type: "DOUBLE" }],
  });
}

async function seedCity(reader = false): Promise<void> {
  useLayerStore.setState({ layers: [cityLayer()] });
  await enqueueLayerTable(
    "CITY",
    reader ? readerBytes() : ({ kind: "resident", records: () => [] } as never),
  );
  // The build's own statements and buffers are not what these cases are about.
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  engineState = "ready";
  holdPrefix = null;
  resetLayerTablesForTest();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  delete EXECUTORS["join-by-location"];
});

afterEach(() => {
  delete EXECUTORS["join-by-location"];
});

describe("the vector table's lifecycle on the real FIFO", () => {
  it("releases the table, the bytes and the slot when the run is CANCELLED after the CREATE", async () => {
    await seedCity();
    const zones = addZones();
    const held = makeGate();
    let entered = false;
    registerExecutor("join-by-location", async (_run, ctx: Ctx) => {
      entered = true;
      await held.promise;
      ctx.throwIfCancelled();
      return { columns: [], rows: new Map(), measured: 0, skipped: [] };
    });
    const id = submitJoin(zones);
    await until(() => entered);
    // The CREATE has run and the table is this run's to hold.
    expect(
      sql.some((s) => s.startsWith(`CREATE OR REPLACE TABLE "__src_${id}"`)),
    ).toBe(true);

    cancelRun(id);
    held.open();
    await settle();

    expect(runById(id)?.status).toBe("cancelled");
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    // Once when the CREATE had parsed, once in the run's `finally`.
    expect(dropped.filter((n) => n === `__src_${id}.json`)).toHaveLength(2);
    // Nothing published: no write transaction was ever opened.
    expect(sql.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(sql.some((s) => s.startsWith("ALTER TABLE"))).toBe(false);
    expect(await queueIsFree()).toBe(true);
  });

  it("gives the slot back when the engine DIES under the CREATE", async () => {
    await seedCity();
    const zones = addZones();
    registerExecutor("join-by-location", async () => ({
      columns: [],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    // The statement never settles — duckdb-wasm drops a pending request without
    // rejecting it — so only the death can release this await.
    holdPrefix = `CREATE OR REPLACE TABLE "__src_`;
    const id = submitJoin(zones);
    await until(() =>
      sql.some((s) => s.startsWith(`CREATE OR REPLACE TABLE "__src_${id}"`)),
    );

    die();
    await settle();

    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "Analytics engine stopped",
    });
    // The cleanup still RAN — a race started after the death hears nothing, and
    // every primitive answers immediately once the engine is gone.
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    expect(dropped).toContain(`__src_${id}.json`);
    expect(await queueIsFree()).toBe(true);
  });

  it("gives the slot back when the engine dies under the CLEANUP itself", async () => {
    await seedCity();
    const zones = addZones();
    registerExecutor("join-by-location", async () => ({
      columns: [],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    // The run succeeds; its `finally` then issues the DROP, which is the
    // statement that never answers. An unraced await here would hold the shared
    // queue for the life of the page.
    holdPrefix = `DROP TABLE IF EXISTS "__src_`;
    const id = submitJoin(zones);
    await until(() => sql.includes(`DROP TABLE IF EXISTS "__src_${id}"`));

    // The state this case is actually about, pinned BEFORE the death: the run
    // is inside its finalizer, the DROP is in flight and will never answer, and
    // the only buffer drop so far is the one the CREATE's parse earned.
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    const droppedBeforeDeath = dropped.filter(
      (n) => n === `__src_${id}.json`,
    ).length;
    expect(droppedBeforeDeath).toBe(1);
    expect(runById(id)?.status).toBe("done");

    die();
    await settle();

    // `release` carried on past the death of its first half: the SECOND drop —
    // the finalizer's own — is the one that could only have happened after the
    // race was resolved by the death.
    expect(dropped.filter((n) => n === `__src_${id}.json`)).toHaveLength(
      droppedBeforeDeath + 1,
    );
    expect(await queueIsFree()).toBe(true);
  });

  it("releases BOTH the re-read buffer and the vector table when a run holds each", async () => {
    await seedCity(true);
    const zones = addZones();
    let readerName = "";
    registerExecutor("join-by-location", async (run, ctx: Ctx) => {
      const lod = ctx.table.lods[0]?.label ?? "2.2";
      const handle = await readSource({
        runId: run.id,
        table: ctx.table,
        lod,
        signal: ctx.signal,
      });
      readerName = `${ctx.table.table}_${run.id}.city.json`;
      try {
        throw new Error("Binder Error: no function ST_Intersects");
      } finally {
        await handle.release();
      }
    });
    const id = submitJoin(zones);
    await settle();

    expect(runById(id)?.status).toBe("failed");
    // Two different names, two different owners, both gone.
    expect(registered).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerName]),
    );
    expect(dropped).toEqual(
      expect.arrayContaining([`__src_${id}.json`, readerName]),
    );
    expect(sql).toContain(`DROP TABLE IF EXISTS "__src_${id}"`);
    // And the layer's own table is untouched by either cleanup.
    expect(getLayerTable("CITY")?.table).toBe("layer_1");
    expect(await queueIsFree()).toBe(true);
  });
});
