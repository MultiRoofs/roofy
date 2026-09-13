/**
 * The last group-D residual: what `undoRun` does when the engine dies at its
 * post-commit re-DESCRIBE.
 *
 * It used to fall THROUGH the `EngineDeadError` and publish the restored model,
 * the provenance rollback and the "Undone" card — for a transaction that never
 * committed, because the database went with it. `execute`'s equivalent catch is
 * right to abandon its DESCRIBE (its COMMIT went through and its columns are on
 * a table that exists); this one is not the same situation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { Layer } from "../../../../src/features/layers/layerStore";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** Every statement the run and the undo sent, in order. */
const sql: string[] = [];
/** Holds the first statement containing `needle` for ever. */
let hang: string | null = null;
/** Whoever asked to hear about the engine dying. */
const deathListeners = new Set<() => void>();
/** …and whoever subscribed to the STATUS, which a real death also publishes. */
const statusListeners = new Set<() => void>();
/** What `getDuckDBStatus` answers. `markEngineDead` publishes `failed`. */
let engineState: "ready" | "failed" = "ready";
/** The columns the fake database holds, tracked from the ALTERs it is sent. */
let liveColumns: string[] = ["id", "feature_id"];

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (hang !== null && statement.includes(hang)) {
      // NEVER settles — duckdb-wasm's own behaviour for a request its worker
      // died under. Only `raced`'s death listener ends it.
      await new Promise<void>(() => {});
    }
    const added =
      /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(statement);
    if (added?.[1] && !liveColumns.includes(added[1]))
      liveColumns.push(added[1]);
    const dropped = /^ALTER TABLE "[^"]+" DROP COLUMN IF EXISTS "([^"]+)"/.exec(
      statement,
    );
    if (dropped?.[1]) liveColumns = liveColumns.filter((c) => c !== dropped[1]);
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 1 }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn((listener: () => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    onEngineDeath: vi.fn((listener: () => void) => {
      deathListeners.add(listener);
      return () => deathListeners.delete(listener);
    }),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    getDuckDBStatus: vi.fn(() => ({
      state: engineState,
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

const tableInfo = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  extension: null,
  sourceBytes: null,
  sourceFeatureIds: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [] as [],
  rowCount: 1,
};

vi.mock("../../../../src/insights/layerTables", async () => {
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  let chain: Promise<unknown> = Promise.resolve();
  return {
    useLayerTableStore: store,
    getLayerTable: vi.fn(() => tableInfo),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    // The REAL one round-trips a DESCRIBE; here it is one statement the fake
    // records, so `hang` can catch it.
    refreshLayerTableColumns: vi.fn(async (layerId: string) => {
      const duck = await import("../../../../src/insights/duckdb");
      await duck.runQuery(`DESCRIBE "layer_1" -- ${layerId}`);
    }),
    nextTableName: vi.fn(() => "layer_9"),
    adoptLayerTable: vi.fn(() => {}),
  };
});

const { submitRun, undoRun, installEngineWatcher } =
  await import("../../../../src/features/processing/runQueue");
const { runOnTableQueue } =
  await import("../../../../src/insights/layerTables");
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { computedColumnsOf, useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");

function layer(): Layer {
  return {
    id: "L1",
    name: "Delft",
    model: {
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
    } as unknown as CityModel,
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

const attributesOf = (objectId: string): Record<string, unknown> =>
  (useLayerStore.getState().layers[0]?.model.objects[objectId]?.attributes ??
    {}) as Record<string, unknown>;

function request() {
  return {
    toolId: "height-from-extent" as const,
    targetLayerId: "L1",
    sourceLayerId: null,
    scope: "all" as const,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    destination: "layer" as const,
    newLayerName: null,
  };
}

/**
 * The death, BOTH halves of it: `markEngineDead` fires its one-shot listeners
 * AND publishes `failed`, and the run queue reads the second through its own
 * watcher. A test that fired only the listeners would be asserting against half
 * an event.
 */
function killEngine(): void {
  for (const listener of Array.from(deathListeners)) {
    deathListeners.delete(listener);
    listener();
  }
  engineState = "failed";
  for (const listener of Array.from(statusListeners)) listener();
}

let disposeWatcher: () => void = () => {};

beforeEach(() => {
  delete EXECUTORS["roof-metrics"];
  sql.length = 0;
  hang = null;
  engineState = "ready";
  liveColumns = ["id", "feature_id"];
  deathListeners.clear();
  statusListeners.clear();
  useLayerStore.setState({ layers: [layer()] });
  useComputedColumnStore.setState({ byLayer: {} });
  useProcessingStore.getState().resetForTest();
  disposeWatcher = installEngineWatcher();
  registerExecutor("height-from-extent", async () => ({
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([["a", { extent_height_m: 9 }]]),
    measured: 1,
    skipped: [],
  }));
});

afterEach(() => {
  disposeWatcher();
  vi.clearAllMocks();
});

describe("undoRun when the engine dies at the post-commit re-DESCRIBE", () => {
  it("publishes NOTHING: not the model, not the provenance, not the card", async () => {
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(attributesOf("a")["extent_height_m"]).toBe(9);

    // CLEARED FIRST, so the gate below cannot be satisfied by the forward run's
    // own post-commit DESCRIBE: the death has to land on the UNDO's, which is
    // the only one that can reach the branch under test. Without this the death
    // arrives while the Undo transaction is still in flight, the PRE-commit
    // catch answers it, and the case would pass against unfixed code.
    sql.length = 0;
    hang = "DESCRIBE";
    const undoing = undoRun(id);
    await vi.waitFor(() => {
      expect(sql).toContain("COMMIT");
      expect(sql.some((s) => s.startsWith("DESCRIBE"))).toBe(true);
    });
    killEngine();
    await undoing;

    // The model keeps the run's values — nothing was restored, because nothing
    // can be verified as restored, and the table the restore describes is gone.
    expect(attributesOf("a")["extent_height_m"]).toBe(9);
    expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    expect(runById(id)?.note).not.toBe("Undone");
    // …and the record is left exactly as the run finished it. The engine
    // watcher fails runs that are still queued, running or cancelling; a `done`
    // one it does not touch, so nothing rewrites this card's status either.
    expect(runById(id)?.status).toBe("done");
    // The card's own truth is the death watcher's: §6.1 takes every Undo away
    // for the session, because every backup table died with the database.
    expect(useProcessingStore.getState().engineStopped).toBe(true);
    // And the shared FIFO is FREE. An Undo that sat on the never-settling
    // DESCRIBE inside its queue slot would hold it for the life of the page.
    await expect(runOnTableQueue(async () => "free")).resolves.toBe("free");
  });

  it("still publishes normally when the DESCRIBE simply answers", async () => {
    // The regression guard: the short circuit must fire on a DEATH only.
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    await undoRun(id);
    expect(attributesOf("a")["extent_height_m"]).toBeUndefined();
    expect(computedColumnsOf("L1").has("extent_height_m")).toBe(false);
    expect(runById(id)?.note).toBe("Undone");
  });
});
