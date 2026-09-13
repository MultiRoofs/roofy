/**
 * Spec §6.1's second publication: destination "New layer".
 *
 * The compute is the SAME compute — same table, same frozen ids, same executor
 * — so what is under test here is only the branch at the write: what exists
 * before `publish()`, what exists after, and what a cancel or a failure on
 * either side of it leaves behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { RunRecord } from "../../../../src/features/processing/types";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** Every statement the run sent, in order. */
const sql: string[] = [];
/** Tables the mocked `adoptLayerTable` was handed, by layer id. */
const adopted = new Map<string, unknown>();
/** Holds the first statement containing `needle` until `promise` resolves. */
let gate: { needle: string; promise: Promise<void> } | null = null;
/** Any statement containing this substring comes back as a database error. */
let failing: string | null = null;
/** `onEngineDeath`'s waiters. ONE-SHOT, as in `duckdb.ts`. */
const deathListeners = new Set<() => void>();

/** Kill the engine the way `markEngineDead` does: every waiter once, then gone. */
function killEngine(): void {
  for (const listener of deathListeners) {
    deathListeners.delete(listener);
    listener();
  }
}

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (gate && statement.includes(gate.needle)) await gate.promise;
    if (failing !== null && statement.includes(failing)) {
      return { ok: false as const, message: "Database was closed" };
    }
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: 1 }] };
    }
    // The roots query `deriveLayer` sends before its CTAS.
    if (statement.includes('COALESCE("feature_id", "id") AS f FROM')) {
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
    // A REAL registry, not a stub: the death cases below need the signal
    // `engineAwait.raced` races against, and a listener the mock threw away
    // would leave `raced` waiting for a statement that never answers.
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

const parentTable = {
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: null,
  reader: "read_cityjson" as const,
  extension: "city.json" as const,
  sourceBytes: 99,
  sourceFeatureIds: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [{ label: "2.2", suffix: "2_2" }],
  rowCount: 2,
};

vi.mock("../../../../src/insights/layerTables", async () => {
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  // The real queue is ONE chain, and "prepared inside the run's own slot" is
  // a claim about it, so the mock keeps the chain and loses only the builds.
  let chain: Promise<unknown> = Promise.resolve();
  let n = 100;
  return {
    useLayerTableStore: store,
    getLayerTable: vi.fn((layerId: string) =>
      layerId === "L1" ? parentTable : null,
    ),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    refreshLayerTableColumns: vi.fn(async () => {}),
    nextTableName: vi.fn(() => `layer_${++n}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
      store.setState((s) => ({
        tables: { ...s.tables, [layerId]: { state: "ready", info } },
      }));
    }),
  };
});

const {
  submitRun,
  cancelRun,
  undoRun,
  newLayerUndoBlock,
  installStaleWatcher,
} = await import("../../../../src/features/processing/runQueue");
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { installWorkspaceInvariants } =
  await import("../../../../src/features/workspace/layerCoordination");

/** A tool that writes one column to the two rows the fake table holds. */
function fakeExecutor() {
  registerExecutor("height-from-extent", async () => ({
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([
      ["a", { extent_height_m: 9 }],
      ["b", { extent_height_m: 4 }],
    ]),
    measured: 2,
    skipped: [],
  }));
}

function newLayerRequest(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "height-from-extent" as const,
    targetLayerId: "L1",
    sourceLayerId: null,
    scope: "all" as const,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    destination: "new" as const,
    newLayerName: "Delft · extent",
    ...overrides,
  };
}

function model(): CityModel {
  const object = (id: string, parents: string[]) => ({
    id,
    objectType: parents.length === 0 ? "Building" : "BuildingPart",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [] as string[],
    parents,
    lod: null,
  });
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: { a: object("a", []), b: object("b", []) },
    vertexCount: 0,
  } as unknown as CityModel;
}

function layer(): Layer {
  return {
    id: "L1",
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  delete EXECUTORS["roof-metrics"];
  sql.length = 0;
  adopted.clear();
  gate = null;
  failing = null;
  deathListeners.clear();
  useLayerStore.setState({ layers: [layer()] });
  useWorkspaceStore.setState({ activeLayerId: "L1" });
  useComputedColumnStore.setState({ byLayer: {} });
  useProcessingStore.getState().resetForTest();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("destination: New layer", () => {
  it("leaves the TARGET's table untouched and creates the copy", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    // Not one ALTER against layer_1: §6, "the run creates a derived layer and
    // leaves the target untouched".
    expect(sql.some((s) => s.startsWith('ALTER TABLE "layer_1"'))).toBe(false);
    expect(
      sql.some((s) =>
        /^CREATE TABLE "layer_\d+" AS SELECT \* FROM "layer_1"/.test(s),
      ),
    ).toBe(true);
    const layers = useLayerStore.getState().layers;
    expect(layers.map((l) => l.name)).toEqual(["Delft", "Delft · extent"]);
    expect(runById(id)?.newLayerId).toBe(layers[1]?.id);
  });

  it("inserts the copy under its parent, with its provenance inherited", async () => {
    // §6: "inherited computed columns keep their provenance", and §6.2's row
    // sits directly under the layer it was cut from.
    useComputedColumnStore.getState().setProvenance("L1", "old_m", {
      runId: "run_0",
      toolName: "Measure solids",
      summary: "All 1 building",
      at: Date.now(),
      partial: null,
      previous: null,
    });
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    expect(useLayerStore.getState().layers[1]?.id).toBe(newId);
    expect(useLayerStore.getState().layers[1]?.derivedFrom).toEqual({
      layerId: "L1",
      layerName: "Delft",
      runId: id,
    });
    expect(
      useComputedColumnStore.getState().byLayer[newId]?.["old_m"]?.toolName,
    ).toBe("Measure solids");
    expect(adopted.has(newId)).toBe(true);
  });

  it("names the copy on the card, in §6.2's words", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    // The seconds are real wall clock, so only the SHAPE is asserted.
    expect(runById(id)?.summary?.line).toMatch(
      /^Created Delft · extent · 1 building · \d+\.\d s$/,
    );
  });

  it("gives the copy's new columns the run's own provenance", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    expect(
      useComputedColumnStore.getState().byLayer[newId]?.["extent_height_m"]
        ?.toolName,
    ).toBe("Height from extent");
    // The copy holds exactly the scoped features, so the tooltip must not read
    // "1 of 2" about a layer of 1.
    expect(
      useComputedColumnStore.getState().byLayer[newId]?.["extent_height_m"]
        ?.partial,
    ).toBeNull();
  });

  it("activates the copy (§6.2)", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(
      runById(id)?.newLayerId,
    );
  });

  it("re-checks the name at publication and says so (§10 scenario 12)", async () => {
    // A layer took the name while the run was in flight — here simply by
    // existing: the FORM refused it, publication cannot.
    useLayerStore.setState((s) => ({
      layers: [...s.layers, { ...layer(), id: "L2", name: "Delft · extent" }],
    }));
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    expect(
      useLayerStore.getState().layers.find((l) => l.id === newId)?.name,
    ).toBe("Delft · extent (2)");
    expect(runById(id)?.summary?.line).toContain("Created Delft · extent (2)");
    // [adapted copy A15].
    expect(runById(id)?.note).toBe(
      'Renamed to "Delft · extent (2)": a layer already had that name',
    );
  });

  it("a cancel BEFORE publication leaves nothing behind", async () => {
    fakeExecutor();
    // Hold the CTAS, cancel while it is in flight.
    const held = deferred<void>();
    gate = { needle: "CREATE TABLE", promise: held.promise };
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("CREATE TABLE"))).toBe(true),
    );
    cancelRun(id);
    gate = null;
    held.resolve(undefined);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(runById(id)?.newLayerId).toBeNull();
    // Every partial resource discarded (§6.1).
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
  });

  it("a FAILURE during the copy fails the run and drops the half-built table", async () => {
    fakeExecutor();
    failing = "CREATE TABLE";
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
  });

  it("the engine's DEATH before publication publishes nothing", async () => {
    // §6.1's other way to lose the race, and the one that cannot be awaited:
    // duckdb-wasm strands the requests in flight, so the preparation's own
    // `raced` is what ends the run.
    fakeExecutor();
    const held = deferred<void>();
    gate = { needle: "CREATE TABLE", promise: held.promise };
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("CREATE TABLE"))).toBe(true),
    );
    killEngine();
    gate = null;
    held.resolve(undefined);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Analytics engine stopped");
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(runById(id)?.newLayerId).toBeNull();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
  });

  it("Undo REMOVES the layer and takes its columns with it (§6.2)", async () => {
    // The workspace invariants are INSTALLED here: publication activated the
    // copy, and Undo removes it — so the door Undo uses has to be the one the
    // layer list's own Remove uses (`layerStore.removeLayer`), or the active
    // layer is left pointing at a row that is gone and nothing corrects it.
    const dispose = installWorkspaceInvariants();
    try {
      fakeExecutor();
      const id = submitRun(newLayerRequest());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      const newId = runById(id)?.newLayerId ?? "";
      expect(useWorkspaceStore.getState().activeLayerId).toBe(newId);
      await undoRun(id);
      expect(useLayerStore.getState().layers).toHaveLength(1);
      expect(useComputedColumnStore.getState().byLayer[newId]).toBeUndefined();
      expect(runById(id)?.note).toBe("Undone");
      expect(runById(id)?.undoable).toBe(false);
      // Handed back to the parent, by the same invariant a manual Remove goes
      // through.
      expect(useWorkspaceStore.getState().activeLayerId).toBe("L1");
    } finally {
      dispose();
    }
  });

  it("offers Undo IMMEDIATELY after publication", async () => {
    // The regression this is written against: `newLayerUndoBlock` compares the
    // copy's provenance against the run ids it carried AT publication, and
    // that set is built from `useComputedColumnStore.getState()`. Read as a
    // snapshot taken BEFORE the provenance was published, the set is empty —
    // so every column of the copy looks like one it grew afterwards and Undo
    // is disabled before the user has seen the card.
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBeNull();
    expect(runById(id)?.undoable).toBe(true);
    // And it really undoes: the block is not the only thing between the user
    // and their layer.
    await undoRun(id);
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });

  it("blocks Undo once a later run has used the derived layer", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const done = runById(id) as RunRecord;
    const newId = done.newLayerId ?? "";
    // A later run TARGETING the copy. It need not have finished: §6.2 says
    // "queued, running or done".
    useProcessingStore.getState().upsertRun({
      ...done,
      id: "run_later",
      targetLayerId: newId,
      status: "queued",
      newLayerId: null,
    });
    expect(newLayerUndoBlock(done)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    await undoRun(id);
    expect(useLayerStore.getState().layers).toHaveLength(2);
  });

  it("blocks Undo once the copy has computed columns of its OWN", async () => {
    // §6.2's other half: "and has no computed columns of its own". A column
    // whose provenance names a run the copy did not carry at publication is
    // one it grew afterwards.
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const done = runById(id) as RunRecord;
    const newId = done.newLayerId ?? "";
    useComputedColumnStore.getState().setProvenance(newId, "later_m", {
      runId: "run_later",
      toolName: "Measure solids",
      summary: "All 1 building",
      at: Date.now(),
      partial: null,
      previous: null,
    });
    expect(newLayerUndoBlock(done)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    await undoRun(id);
    expect(useLayerStore.getState().layers).toHaveLength(2);
  });

  it("keeps its Undo when a LATER This-layer run writes the same column", async () => {
    // The steal rule is about the layer a run WROTE to. A New-layer run's
    // `targetLayerId` is the parent it copied FROM, and it wrote nothing
    // there — so the parent's next run must not take its Undo away.
    fakeExecutor();
    const created = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(created)?.status).toBe("done"));
    const onParent = submitRun(
      newLayerRequest({ destination: "layer", newLayerName: null }),
    );
    await vi.waitFor(() => expect(runById(onParent)?.status).toBe("done"));
    expect(runById(created)?.undoable).toBe(true);
  });

  it("is never marked stale by a rebuild of its PARENT", async () => {
    // §6: "a derived layer is independent of its parent from publication on".
    //
    // The PARENT's entry has to be SEEDED first, or this case passes for the
    // wrong reason: `installStaleWatcher` fires on `ready → ready` with a new
    // table name or on `building → ready`, and with no previous entry at all
    // `before` is undefined and neither test holds — so the assertion would
    // still pass with the `run.newLayerId === null` guard reverted.
    const tables = await import("../../../../src/insights/layerTables");
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: parentTable } },
    });
    fakeExecutor();
    const dispose = installStaleWatcher();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    tables.useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        L1: { state: "ready", info: { ...parentTable, table: "layer_77" } },
      },
    }));
    expect(runById(id)?.stale).toBe(false);
    dispose();
  });

  it("…and the guard is what does it: a THIS-LAYER run on the parent goes stale", async () => {
    // The other half of the same assertion. Without it the case above could
    // pass because the watcher never fires at all.
    const tables = await import("../../../../src/insights/layerTables");
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: parentTable } },
    });
    fakeExecutor();
    const dispose = installStaleWatcher();
    const id = submitRun(
      newLayerRequest({ destination: "layer", newLayerName: null }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    tables.useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        L1: { state: "ready", info: { ...parentTable, table: "layer_77" } },
      },
    }));
    expect(runById(id)?.stale).toBe(true);
    dispose();
  });

  it("adopting the copy's table does not trip the stale watcher either", async () => {
    // `installStaleWatcher` fires on a table-NAME change or a
    // `building → ready` transition; `adoptLayerTable` writes `ready` where
    // there was nothing, so `before` is undefined and neither test holds.
    // Asserted rather than assumed (plan self-review §4).
    fakeExecutor();
    const dispose = installStaleWatcher();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.stale).toBe(false);
    dispose();
  });

  it("refuses a destination the tool does not offer, at the head", async () => {
    // Task 20's pre-flight, still standing: `aggregate-per-area` has no
    // `"new"` until Task 23.
    fakeExecutor();
    const id = submitRun(
      newLayerRequest({ toolId: "aggregate-per-area" as const }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Not available yet");
  });

  it("restores the destination and the name onto the RECORD", async () => {
    // §6.1's frozen parameters, on the card so "Edit & run" can reopen the
    // form on the run the user is editing (§6.3).
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.destination).toBe("new");
    expect(runById(id)?.newLayerName).toBe("Delft · extent");
  });
});
