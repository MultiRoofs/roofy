/**
 * Validate solids driven through a REAL run: the real executor, the real queue,
 * the real `readSource`, and the two ways a run is taken away from it while its
 * READER STATEMENT is still in flight — a Cancel and the engine's death.
 *
 * `validateSolids.test.ts` covers the tool's own behaviour over a stubbed
 * `ToolContext`. What only this file can show is the CLEANUP contract, because
 * it is a property of the whole path and not of the executor alone: the source
 * bytes are dropped from the wasm heap on every exit, nothing is published for
 * a run that did not finish, and the shared table FIFO is handed on rather than
 * left holding a task that will never settle. A 300 MB buffer stranded under a
 * name nobody holds, or a queue that stops moving, are both invisible to a unit
 * test of the executor and both fatal to the page.
 *
 * The scaffolding is `measureSolidsRun.test.ts`'s — the same duckdb and
 * `layerTables` mocks, the same READER-BACKED table, the same gate on the
 * parse, the same FIFO chain — because the queue and the source read are the
 * same for both solids tools. What differs is the statement the gate catches
 * and the columns the run publishes.
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
/** Every VFS name registered, and every one dropped — the cleanup contract. */
const registered: string[] = [];
const dropped: string[] = [];
/** How many times the layer's bytes were fetched from its provider. */
let sourceReads = 0;

/** Rows the reader's id-join statement answers with. */
let sourceIdRows: Array<{ id: string }> = [];
/** Rows the guarded validation statement answers with. */
let reportRows: Array<Record<string, unknown>> = [];

function freshTable() {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    // READER-BACKED: `readSource` needs all four, and a fresh array per call
    // because `registerBuffer` detaches what it is given.
    source: async () => {
      sourceReads += 1;
      return new Uint8Array([1, 2, 3, 4]);
    },
    reader: "read_cityjson" as const,
    extension: "city.json" as const,
    sourceBytes: 4,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" as const },
      { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    ],
    lods: [{ label: "2.2", suffix: "2_2" }],
    rowCount: 2 as number | null,
  };
}

let tableInfo: ReturnType<typeof freshTable> = freshTable();

/** The layer's FEATURE count, as the mocked COUNT(DISTINCT …) answers it. */
let featureTotal = 2;
/** Rows the scope-rows statement returns. */
let scopeRows: Array<{ id: string; f: string }> = [];
/** Holds the first statement containing `needle` until `promise` resolves. */
let gate: { needle: string; promise: Promise<void> } | null = null;
/** The columns the fake database holds, tracked from the ALTERs it is sent. */
let liveColumns: string[] = ["id", "feature_id"];
const statusListeners = new Set<() => void>();
const deathListeners = new Set<() => void>();

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (gate && statement.includes(gate.needle)) await gate.promise;
    const added =
      /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(statement);
    if (added?.[1] && !liveColumns.includes(added[1]))
      liveColumns.push(added[1]);
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: featureTotal }] };
    }
    // The GUARDED validation statement, told apart from the id join by its
    // parse.
    if (statement.includes("ST_3DTryFromWKB")) {
      return { ok: true as const, columns: [], rows: reportRows };
    }
    // §6.1's id join: ids only, straight off the reader.
    if (statement.startsWith('SELECT "id" FROM read_cityjson(')) {
      return { ok: true as const, columns: ["id"], rows: sourceIdRows };
    }
    if (statement.includes("AS f FROM")) {
      return { ok: true as const, columns: ["id", "f"], rows: scopeRows };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string) => {
      registered.push(name);
      return true;
    }),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
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
  // The real queue is ONE FIFO chain, and "the next task still runs" is a test
  // OF that chain — so the mock keeps it, and only loses the table building.
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
    refreshLayerTableColumns: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      tableInfo = {
        ...tableInfo,
        columns: liveColumns.map((name) => ({
          name,
          type: "VARCHAR",
          kind: "scalar" as const,
        })),
      };
    }),
    __resetQueue: () => {
      chain = Promise.resolve();
      store.setState({ tables: {} });
    },
  };
});

const tables = await import("../../../../src/insights/layerTables");
const { getDuckDBStatus } = await import("../../../../src/insights/duckdb");
const { submitRun, cancelRun, installEngineWatcher } =
  await import("../../../../src/features/processing/runQueue");
const { registerExecutor, EXECUTORS } =
  await import("../../../../src/features/processing/tools");
const { runById, useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { computedColumnsOf, useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
const { validateSolids } =
  await import("../../../../src/features/processing/tools/validateSolids");

type Resettable = { __resetQueue: () => void };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function solidObject(id: string) {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces: [
      {
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod: "2.2",
        geometryType: "Solid",
      },
    ],
    bbox: null,
    children: [],
    parents: [],
    lod: null,
  };
}

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: { B1: solidObject("B1"), B2: solidObject("B2") },
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
    selectedLod: "2.2",
    availableLods: ["2.2"],
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

function attributesOf(objectId: string): Record<string, unknown> {
  return (useLayerStore.getState().layers[0]?.model.objects[objectId]
    ?.attributes ?? {}) as Record<string, unknown>;
}

/** The VFS name `readSource` mints for a run — `<table>_<runId>.<extension>`. */
const sourceNameOf = (runId: string) => `layer_1_${runId}.city.json`;

/** One Validate solids request, as `ToolView` freezes it — no parameters. */
function solidRequest(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "validate-solids" as const,
    targetLayerId: "L1",
    sourceLayerId: null,
    scope: "all" as const,
    lod: "2.2",
    params: {},
    prefix: "solid_",
    destination: "layer" as const,
    newLayerName: null,
    columns: [
      { name: "solid_closed", type: "BOOLEAN" as const },
      { name: "solid_manifold", type: "BOOLEAN" as const },
      { name: "solid_oriented", type: "BOOLEAN" as const },
      { name: "solid_valid", type: "BOOLEAN" as const },
      { name: "solid_open_edges_n", type: "DOUBLE" as const },
      { name: "solid_nonmanifold_edges_n", type: "DOUBLE" as const },
      { name: "solid_degenerate_faces_n", type: "DOUBLE" as const },
    ],
    ...overrides,
  };
}

/** The validation statement's answer for one valid solid — Task 6's spelling. */
const solidAnswer = (id: string) => ({
  id,
  f: id,
  geometry_type: "Solid",
  parsed: true,
  is_valid: true,
  is_closed: true,
  is_manifold: true,
  is_oriented: true,
  open_n: 0,
  nm_n: 0,
  deg_n: 0,
  ori_n: 0,
});

/** The worker died: the death subscribers first, then the status. */
function killEngine(reason = "worker gone"): void {
  for (const listener of Array.from(deathListeners)) listener();
  vi.mocked(getDuckDBStatus).mockReturnValue({
    state: "failed",
    error: reason,
  });
  for (const listener of statusListeners) listener();
}

function reviveEngine(): void {
  vi.mocked(getDuckDBStatus).mockReturnValue({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "loaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  });
  for (const listener of statusListeners) listener();
}

beforeEach(() => {
  // The REAL executor, registered per test; `afterEach` takes it off again.
  registerExecutor("validate-solids", validateSolids);
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  sourceReads = 0;
  featureTotal = 2;
  scopeRows = [
    { id: "B1", f: "B1" },
    { id: "B2", f: "B2" },
  ];
  sourceIdRows = [{ id: "B1" }, { id: "B2" }];
  reportRows = [solidAnswer("B1"), solidAnswer("B2")];
  gate = null;
  liveColumns = ["id", "feature_id"];
  statusListeners.clear();
  deathListeners.clear();
  tableInfo = freshTable();
  useSelectionStore.getState().clear();
  useLayerStore.setState({ layers: [layer()] });
  useProcessingStore.getState().resetForTest();
  useComputedColumnStore.setState({ byLayer: {} });
  reviveEngine();
});

afterEach(() => {
  (tables as unknown as Resettable).__resetQueue();
  delete EXECUTORS["validate-solids"];
});

describe("a Validate solids run", () => {
  it("registers the source, drops it when the parse is done, and publishes", async () => {
    const id = submitRun(solidRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    expect(sourceReads).toBe(1);
    expect(registered).toContain(sourceNameOf(id));
    // §6's whole reason for the phase: the bytes do not outlive the parse.
    expect(dropped).toContain(sourceNameOf(id));
    expect(attributesOf("B1")).toMatchObject({
      solid_closed: true,
      solid_manifold: true,
      solid_oriented: true,
      solid_valid: true,
      solid_open_edges_n: 0,
      solid_nonmanifold_edges_n: 0,
      solid_degenerate_faces_n: 0,
    });
    // §7.3's card, through the real `summarise`: the valid count is the line
    // and "N buildings measured" never appears.
    expect(runById(id)!.summary!.line).toMatch(/^2 valid · /);
    expect(runById(id)!.summary!.line).not.toContain("measured");
    // §6.4: the reproducible record names all three statements.
    expect(runById(id)!.log.map((entry) => entry.label)).toEqual([
      "Reading features",
      "Checking source ids",
      "Validating solids",
      "Writing results",
    ]);
  });

  it("prints §7.3's two-count card when a building has issues", async () => {
    reportRows = [
      solidAnswer("B1"),
      {
        ...solidAnswer("B2"),
        is_valid: false,
        is_closed: false,
        open_n: 2,
        ori_n: 1,
      },
    ];
    const id = submitRun(solidRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)!.summary!.line).toMatch(/^1 valid · 1 with issues · /);
    expect(attributesOf("B2")).toMatchObject({
      solid_closed: false,
      solid_valid: false,
      solid_open_edges_n: 2,
    });
  });

  it("releases the source and publishes NOTHING when cancelled mid-read", async () => {
    const held = deferred<void>();
    gate = { needle: "ST_3DTryFromWKB", promise: held.promise };
    const id = submitRun(solidRequest());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("ST_3DTryFromWKB"))).toBe(true),
    );
    expect(registered).toContain(sourceNameOf(id));

    cancelRun(id);
    held.resolve();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));

    // The `finally` ran: a multi-megabyte buffer does not outlive a cancelled
    // run any more than it outlives a finished one.
    expect(dropped).toContain(sourceNameOf(id));
    // Nothing published: no column on the table, no model attribute, no
    // provenance and no Undo to offer.
    expect(sql.some((q) => q.startsWith("ALTER TABLE"))).toBe(false);
    expect(attributesOf("B1").solid_valid).toBeUndefined();
    expect([...computedColumnsOf("L1")]).toEqual([]);
    expect(runById(id)?.undoable).toBe(false);

    // And the FIFO moved on: the next run reaches the engine instead of
    // queueing behind a slot nobody released.
    gate = null;
    const next = submitRun(solidRequest({ prefix: "other_" }));
    await vi.waitFor(() => expect(runById(next)?.status).toBe("done"));
    expect(dropped).toContain(sourceNameOf(next));
  });

  it("releases the source and publishes NOTHING when the engine dies mid-read", async () => {
    const stop = installEngineWatcher();
    const never = deferred<void>();
    gate = { needle: "ST_3DTryFromWKB", promise: never.promise };
    const id = submitRun(solidRequest());
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("ST_3DTryFromWKB"))).toBe(true),
    );
    expect(registered).toContain(sourceNameOf(id));

    killEngine();
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));

    expect(runById(id)?.error).toBe("Analytics engine stopped");
    // The release is raced against the death too, so it SETTLES rather than
    // hanging on a worker that is gone — which is what frees the FIFO.
    await vi.waitFor(() => expect(dropped).toContain(sourceNameOf(id)));
    expect(sql.some((q) => q.startsWith("ALTER TABLE"))).toBe(false);
    expect(attributesOf("B1").solid_valid).toBeUndefined();
    expect([...computedColumnsOf("L1")]).toEqual([]);

    // The queue is free: after the status bar's Retry, the next run gets in.
    gate = null;
    reviveEngine();
    const next = submitRun(solidRequest({ prefix: "other_" }));
    await vi.waitFor(() => expect(runById(next)?.status).toBe("done"));
    stop();
  });
});
