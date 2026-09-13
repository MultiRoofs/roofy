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
import type { GeoJsonLayer } from "../../../../src/features/geoLayers/geoLayerStore";
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
    // The PARENT, plus every copy publication has adopted — a derived layer is
    // an ordinary target from publication on (§6), and a registry that could
    // not resolve it made "run a tool on the copy" untestable here.
    getLayerTable: vi.fn((layerId: string) =>
      layerId === "L1" ? parentTable : (adopted.get(layerId) ?? null),
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
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { geoRecordId } =
  await import("../../../../src/features/geoLayers/geoRecords");
const { withDestinations } = await import("./toolDestinations");
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
  useGeoLayerStore.setState({ layers: [] });
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

  it("logs the COPY's write statement by statement (§6.4)", async () => {
    // The write happens INSIDE `prepareDerivedCityLayer`, so only the
    // preparation knows its statements. Without the shared recorder a
    // New-layer run's log would stop at `CREATE TABLE` — the one run §6.4's
    // "the SQL statements issued in order" was not true for.
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const write = (runById(id)?.log ?? []).filter((e) =>
      e.label.startsWith("Writing results ("),
    );
    expect(write.length).toBeGreaterThan(0);
    const statements = write.map((e) => e.sql);
    expect(statements[0]).toBe("BEGIN TRANSACTION");
    expect(statements).toContain("COMMIT");
    expect(
      statements.some((s) => s?.includes("ADD COLUMN IF NOT EXISTS")),
    ).toBe(true);
    // The copy's own CREATE is still there, and BEFORE the write.
    const labels = (runById(id)?.log ?? []).map((e) => e.label);
    expect(labels.indexOf("Creating the new layer's table")).toBeLessThan(
      labels.findIndex((l) => l.startsWith("Writing results (")),
    );
  });

  it("logs the statements a FAILED write got through, rollback included", async () => {
    // §6.3 shows the error; §6.4 still has to say what was attempted — and a
    // COMMIT that failed is exactly what a bug report needs to carry.
    fakeExecutor();
    failing = "COMMIT";
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    const statements = (runById(id)?.log ?? [])
      .filter((e) => e.label.startsWith("Writing results ("))
      .map((e) => e.sql);
    expect(statements).toContain("COMMIT");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(useLayerStore.getState().layers).toHaveLength(1);
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
    let released = false;
    void held.promise.then(() => {
      released = true;
    });
    gate = { needle: "CREATE TABLE", promise: held.promise };
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("CREATE TABLE"))).toBe(true),
    );
    killEngine();
    // NEVER released. duckdb-wasm strands the requests that were in flight
    // when its worker died, and the whole point of `raced` is that nothing
    // waits for one: clearing the gate only frees LATER statements, so the
    // CTAS below is still hanging when the run has already ended.
    gate = null;
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Analytics engine stopped");
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(runById(id)?.newLayerId).toBeNull();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
    // The FIFO is free — which is the fact the race exists for. A later run
    // queued behind a stranded statement would never reach its own head, and
    // this assertion is what would time out.
    const after = submitRun(newLayerRequest({ newLayerName: "Delft · after" }));
    await vi.waitFor(() => expect(runById(after)?.status).toBe("done"));
    // …and the first statement is STILL hanging while that happened, which is
    // what makes the line above about the death race and not about a gate
    // somebody quietly opened.
    expect(released).toBe(false);
  });

  it("is an ORDINARY target from publication on: a run computes over ITS table", async () => {
    // §6: "the copy is a layer like any other". The registry resolves it, so a
    // follow-up This-layer run reads the COPY's table and writes there — and
    // the parent, which the first run left untouched, stays untouched.
    fakeExecutor();
    const created = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(created)?.status).toBe("done"));
    const newId = runById(created)?.newLayerId ?? "";
    const copyTable = (adopted.get(newId) as { table: string }).table;
    sql.length = 0;

    const follow = submitRun(
      newLayerRequest({
        targetLayerId: newId,
        destination: "layer",
        newLayerName: null,
      }),
    );
    await vi.waitFor(() => expect(runById(follow)?.status).toBe("done"));
    expect(sql.some((q) => q.startsWith(`ALTER TABLE "${copyTable}"`))).toBe(
      true,
    );
    expect(sql.some((q) => q.startsWith('ALTER TABLE "layer_1"'))).toBe(false);
    // [adapted copy A7]: the follow-up run's own log header names where the
    // layer it ran on came from, captured at Run off the layer row.
    expect(runById(follow)?.targetDerivedFrom).toEqual({
      layerId: "L1",
      layerName: "Delft",
      runId: created,
    });
    // And §6.2's block is now real rather than seeded: a DONE later run over
    // the copy is exactly what it counts.
    expect(newLayerUndoBlock(runById(created) as RunRecord)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
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

  it("blocks Undo for a later run that reads the copy as its SOURCE", async () => {
    // §6.2 counts the copy being "the target OR source of any later run": a
    // Join reading the derived layer is using it just as much as one writing
    // to it, and removing it underneath would strand that run's provenance.
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const done = runById(id) as RunRecord;
    const newId = done.newLayerId ?? "";
    useProcessingStore.getState().upsertRun({
      ...done,
      id: "run_later",
      targetLayerId: "L1",
      sourceLayerId: newId,
      status: "running",
      newLayerId: null,
    });
    expect(newLayerUndoBlock(done)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
  });

  it.each([
    ["failed", "target"],
    ["failed", "source"],
    ["cancelled", "target"],
    ["cancelled", "source"],
  ] as const)(
    "keeps Undo when the later run %s before touching the copy (as its %s)",
    async (status, role) => {
      // §6.2's condition is "(queued, running or done)", and neither of these
      // ever wrote anything: a run refused at the head for a bad prefix, or
      // cancelled while it waited its turn, must not cost the user a layer
      // they can otherwise still remove with one press.
      fakeExecutor();
      const id = submitRun(newLayerRequest());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      const done = runById(id) as RunRecord;
      const newId = done.newLayerId ?? "";
      useProcessingStore.getState().upsertRun({
        ...done,
        id: "run_later",
        targetLayerId: role === "target" ? newId : "L1",
        sourceLayerId: role === "source" ? newId : null,
        status,
        newLayerId: null,
      });
      expect(newLayerUndoBlock(done)).toBeNull();
      await undoRun(id);
      expect(useLayerStore.getState().layers).toHaveLength(1);
    },
  );

  it("blocks Undo while the later run is still CANCELLING — it may yet publish", async () => {
    // §6.1's "finished before the cancel arrived": a run in `cancelling` has
    // been asked to stop and may still commit, so it counts with `running`.
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const done = runById(id) as RunRecord;
    useProcessingStore.getState().upsertRun({
      ...done,
      id: "run_later",
      targetLayerId: done.newLayerId ?? "",
      status: "cancelling",
      newLayerId: null,
    });
    expect(newLayerUndoBlock(done)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
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
    // Task 20's pre-flight, still standing — and now with nothing in the
    // shipped registry that lacks `"new"`, so the definition is STAGED rather
    // than the rule losing its test (see `toolDestinations.ts`).
    fakeExecutor();
    await withDestinations("height-from-extent", ["layer"], async () => {
      const id = submitRun(newLayerRequest());
      await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
      expect(runById(id)?.error).toBe("Not available yet");
    });
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

/**
 * §7.6's reversed direction, with §6's New-layer destination: the TARGET is a
 * vector layer, so the copy is a GeoJSON one and the "target untouched" promise
 * is about a document rather than a table (§10 scenario 11).
 */
function zonesDocument(): unknown {
  const area = (name: string) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [[]] },
  });
  return {
    type: "FeatureCollection",
    features: [area("North"), area("South")],
  };
}

/** The Zones layer, and an Aggregate executor that writes one value onto its
 *  FIRST area only — §6's "the copy holds ALL target areas" is the rule the
 *  second area is here to catch. */
function seedAggregate(): string {
  const zones = useGeoLayerStore.getState().addGeoLayer({
    kind: "geojson",
    name: "Zones",
    config: { data: zonesDocument() },
  });
  registerExecutor("aggregate-per-area", async (_run, ctx) => {
    // ONE statement, so a cancel or a death can be landed while the executor
    // is still in flight (the vector preparation itself awaits nothing).
    await ctx.query("Aggregating buildings per area", AGGREGATE_SQL);
    // §7.6's reversed direction: the TARGET is the vector layer, and its
    // records are keyed by the GeoJSON stable feature id.
    if (ctx.target.kind !== "vector") throw new Error("wrong target kind");
    const first = ctx.target.records[0];
    if (first === undefined) throw new Error("the target has no areas");
    return {
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
      rows: new Map([[geoRecordId(first), { bld_buildings_n: 2 }]]),
      measured: 1,
      skipped: [],
      // §7.6's own head segment, which is what §6.2's "Created <name>" line
      // keeps for a vector copy.
      line: "1 area aggregated over 1 building",
    };
  });
  return zones;
}

const AGGREGATE_SQL = "SELECT 1 /* aggregate */";

function aggregateRequest(
  zones: string,
  overrides: Record<string, unknown> = {},
) {
  return newLayerRequest({
    toolId: "aggregate-per-area" as const,
    targetLayerId: zones,
    sourceLayerId: "L1",
    prefix: "bld_",
    newLayerName: "Zones · buildings",
    columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
    ...overrides,
  });
}

function geoLayerById(id: string): GeoJsonLayer {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer?.kind !== "geojson") throw new Error("not a geojson layer");
  return layer;
}

function areasOf(id: string): Array<{ properties: Record<string, unknown> }> {
  const doc = geoLayerById(id).config.preparedData as {
    features?: Array<{ properties: Record<string, unknown> }>;
  };
  return doc.features ?? [];
}

describe("destination: New layer, with a VECTOR target", () => {
  it("creates a GeoJSON copy of the target and leaves it untouched (§10.11)", async () => {
    const zones = seedAggregate();
    const before = JSON.stringify(geoLayerById(zones).config);
    const beforeConfig = geoLayerById(zones).config;
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const layers = useGeoLayerStore.getState().layers;
    expect(layers.map((l) => l.name)).toEqual(["Zones", "Zones · buildings"]);
    expect(runById(id)?.newLayerId).toBe(layers[1]?.id);
    // No city layer was created, and the source city layer is untouched.
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(sql.some((s) => s.startsWith("CREATE TABLE"))).toBe(false);
    expect(sql.some((s) => s.startsWith('ALTER TABLE "layer_1"'))).toBe(false);
    // C1: the ORIGINAL's document is byte-identical and its record was never
    // replaced — §6's "the run creates a derived layer and leaves the target
    // untouched", which for a vector target is a document, not a table.
    expect(JSON.stringify(geoLayerById(zones).config)).toBe(before);
    expect(geoLayerById(zones).config).toBe(beforeConfig);
    expect(geoLayerById(zones).derivedFrom).toBeNull();
    expect(Object.keys(areasOf(zones)[0]?.properties ?? {})).not.toContain(
      "bld_buildings_n",
    );
    // The provenance is the COPY's, and none of it is on the parent.
    const newId = runById(id)?.newLayerId ?? "";
    expect(
      useComputedColumnStore.getState().byLayer[newId]?.["bld_buildings_n"]
        ?.toolName,
    ).toBe("Aggregate buildings per area");
    expect(useComputedColumnStore.getState().byLayer[zones]).toBeUndefined();
    expect(geoLayerById(newId).derivedFrom).toEqual({
      layerId: zones,
      layerName: "Zones",
      runId: id,
    });
  });

  it("copies EVERY area, whatever the scope selected on the SOURCE (§6)", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const areas = areasOf(runById(id)?.newLayerId ?? "");
    expect(areas).toHaveLength(2);
    expect(areas[0]?.properties["name"]).toBe("North");
    expect(areas[0]?.properties["bld_buildings_n"]).toBe(2);
    // The area the run never evaluated is in the copy, without a value.
    expect(areas[1]?.properties["name"]).toBe("South");
    expect(Object.keys(areas[1]?.properties ?? {})).not.toContain(
      "bld_buildings_n",
    );
  });

  it("inserts the copy under its parent and activates it (§6.2)", async () => {
    const zones = seedAggregate();
    useGeoLayerStore.getState().addGeoLayer({
      kind: "raster-xyz",
      name: "Basemap",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(useGeoLayerStore.getState().layers.map((l) => l.name)).toEqual([
      "Zones",
      "Zones · buildings",
      "Basemap",
    ]);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(
      runById(id)?.newLayerId,
    );
  });

  it("names the copy on the card and keeps §7.6's own line whole", async () => {
    // NOT "Created Zones · buildings · 1 building · …": that count is the
    // SOURCE's scoped buildings and the copy holds AREAS. §7.6's head segment
    // already says both ("6 areas aggregated over 1,204 buildings"), so it
    // survives intact — asserted against the SAME tool's This-layer card
    // rather than against a copy of Task 19's wording.
    const zones = seedAggregate();
    const created = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(created)?.status).toBe("done"));
    const onLayer = submitRun(
      aggregateRequest(zones, { destination: "layer", newLayerName: null }),
    );
    await vi.waitFor(() => expect(runById(onLayer)?.status).toBe("done"));

    const prefix = "Created Zones · buildings · ";
    const line = runById(created)?.summary?.line ?? "";
    expect(line).toMatch(
      /^Created Zones · buildings · 1 area aggregated over 1 building · \d+\.\d s$/,
    );
    // The seconds are real wall clock on both cards, so they are dropped
    // before the two are compared.
    const withoutSeconds = (text: string) =>
      text.split(" · ").slice(0, -1).join(" · ");
    expect(withoutSeconds(line.slice(prefix.length))).toBe(
      withoutSeconds(runById(onLayer)?.summary?.line ?? ""),
    );
  });

  it("reads the name publication actually gave the copy", async () => {
    // The same " (2)" re-check a city copy gets (§10.12) — and the card's name
    // is read back from the GEO store, which is where a vector copy's row is.
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones, { newLayerName: "Zones" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.summary?.line).toContain("Created Zones (2)");
    expect(runById(id)?.note).toBe(
      'Renamed to "Zones (2)": a layer already had that name',
    );
    expect(geoLayerById(runById(id)?.newLayerId ?? "").name).toBe("Zones (2)");
  });

  it("a cancel BEFORE publication leaves nothing behind", async () => {
    const zones = seedAggregate();
    const held = deferred<void>();
    gate = { needle: "/* aggregate */", promise: held.promise };
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("/* aggregate */"))).toBe(true),
    );
    cancelRun(id);
    gate = null;
    held.resolve(undefined);
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(useGeoLayerStore.getState().layers).toHaveLength(1);
    expect(runById(id)?.newLayerId).toBeNull();
    expect(useComputedColumnStore.getState().byLayer).toEqual({});
  });

  it("the engine's DEATH before publication publishes nothing", async () => {
    const zones = seedAggregate();
    const held = deferred<void>();
    let released = false;
    void held.promise.then(() => {
      released = true;
    });
    gate = { needle: "/* aggregate */", promise: held.promise };
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() =>
      expect(sql.some((s) => s.includes("/* aggregate */"))).toBe(true),
    );
    killEngine();
    // NEVER released, as on the city side: the stranded statement is the
    // hazard, and the FIFO has to come back without it.
    gate = null;
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Analytics engine stopped");
    expect(useGeoLayerStore.getState().layers).toHaveLength(1);
    expect(runById(id)?.newLayerId).toBeNull();
    const after = submitRun(aggregateRequest(zones, { newLayerName: "After" }));
    await vi.waitFor(() => expect(runById(after)?.status).toBe("done"));
    expect(released).toBe(false);
  });

  it("offers Undo immediately, and Undo removes the derived VECTOR layer", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBeNull();
    await undoRun(id);
    expect(useGeoLayerStore.getState().layers.map((l) => l.name)).toEqual([
      "Zones",
    ]);
    expect(useComputedColumnStore.getState().byLayer[newId]).toBeUndefined();
    expect(runById(id)?.note).toBe("Undone");
    expect(runById(id)?.undoable).toBe(false);
  });

  it("blocks Undo while a later run is still RUNNING against the copy", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    // §6.2 counts a later run "(queued, running or done)", so the later run is
    // HELD before it writes anything: the copy still carries only this run's
    // own column, which makes this case about the run-history scan and the
    // next one about the copy's own columns — two rules, two tests.
    const held = deferred<void>();
    gate = { needle: "/* aggregate */", promise: held.promise };
    const later = submitRun(
      aggregateRequest(newId, { destination: "layer", newLayerName: null }),
    );
    await vi.waitFor(() =>
      expect(sql.filter((s) => s.includes("/* aggregate */"))).toHaveLength(2),
    );
    expect(
      useComputedColumnStore.getState().byLayer[newId]?.["bld_buildings_n"]
        ?.runId,
    ).toBe(id);
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    await undoRun(id);
    expect(useGeoLayerStore.getState().layers).toHaveLength(2);
    expect(runById(id)?.error).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    gate = null;
    held.resolve(undefined);
    await vi.waitFor(() => expect(runById(later)?.status).toBe("done"));
    // And still blocked once it has finished.
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
  });

  it.each([
    ["failed", "target"],
    ["cancelled", "source"],
  ] as const)(
    "keeps a VECTOR copy's Undo when the later run %s (as its %s)",
    async (status, role) => {
      // The status rule is one rule for both kinds of copy: the scan is over
      // the run history, which knows nothing about where the layer lives.
      const zones = seedAggregate();
      const id = submitRun(aggregateRequest(zones));
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      const done = runById(id) as RunRecord;
      const newId = done.newLayerId ?? "";
      useProcessingStore.getState().upsertRun({
        ...done,
        id: "run_later",
        targetLayerId: role === "target" ? newId : zones,
        sourceLayerId: role === "source" ? newId : null,
        status,
        newLayerId: null,
      });
      expect(newLayerUndoBlock(done)).toBeNull();
      const before = useGeoLayerStore.getState().layers.length;
      await undoRun(id);
      expect(useGeoLayerStore.getState().layers).toHaveLength(before - 1);
    },
  );

  it("blocks a VECTOR copy's Undo for a later run that READS it", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const done = runById(id) as RunRecord;
    useProcessingStore.getState().upsertRun({
      ...done,
      id: "run_later",
      targetLayerId: "L1",
      sourceLayerId: done.newLayerId ?? "",
      status: "queued",
      newLayerId: null,
    });
    expect(newLayerUndoBlock(done)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
  });

  it("blocks Undo once the copy has computed columns of its OWN", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    useComputedColumnStore.getState().setProvenance(newId, "other_n", {
      runId: "run_elsewhere",
      toolName: "Aggregate buildings per area",
      summary: "All 1 building",
      at: Date.now(),
      partial: null,
      previous: null,
    });
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    await undoRun(id);
    expect(useGeoLayerStore.getState().layers).toHaveLength(2);
  });
});
