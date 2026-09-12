/**
 * Roof metrics driven through a REAL run: the queue, the write, the model
 * merge, scoped replacement, Undo, cancellation and the streaming
 * invalidation. The pure roll-ups are covered in `roofMetricsTool.test.ts`;
 * this file is about what a user has afterwards.
 *
 * The scaffolding is `runQueue.test.ts`'s — the same duckdb and `layerTables`
 * mocks, the same gate and the same `request` helper — because the queue this
 * runs on is the same queue. What differs is the executor: this file registers
 * the REAL one, over a real parsed model, and `@cityjson/navara-core` is spied
 * on (never replaced) so a test can watch the CPU work batch by batch.
 *
 * The rebuilt-table case here is NOT the one `runQueue.test.ts` already has:
 * that one fails a run whose fake executor never started, this one fails the
 * SECOND roof run while the first is inside the real executor's own read.
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
/** VFS registrations `writeComputedColumns` made. */
const registered: string[] = [];
/** What the mocked registry hands back for "L1". */
let tableInfo: {
  table: string;
  sourceName: null;
  source: null;
  reader: null;
  columns: Array<{ name: string; type: string; kind: "scalar" }>;
  lods: [];
  rowCount: number | null;
} = freshTable();

function freshTable() {
  return {
    table: "layer_1",
    sourceName: null,
    source: null,
    reader: null,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" as const },
      { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    ],
    lods: [] as [],
    rowCount: 3 as number | null,
  };
}

/** The layer's FEATURE count, as the mocked COUNT(DISTINCT …) answers it. */
let featureTotal = 1;
/** Rows the feature-expansion query returns for an id scope. */
let scopeRows: Array<{ id: string; f: string }> = [];
/** Holds the first statement containing `needle` until `promise` resolves. */
let gate: { needle: string; promise: Promise<void> } | null = null;
/** Any statement containing this substring comes back as a database error. */
let failing: string | null = null;
/** The columns the fake database holds, tracked from the ALTERs it is sent. */
let liveColumns: string[] = ["id", "feature_id"];
/** What they were when the open transaction began, for its ROLLBACK. */
let columnsAtBegin: string[] | null = null;
/** Whoever `subscribeDuckDBStatus` handed a listener to, so a test can publish
 *  a transition the way `duckdb.ts` does. */
const statusListeners = new Set<() => void>();
/** Whoever asked to hear about the engine DYING — a signal of its own, because
 *  a run's abort cannot fire twice and a death can follow a cancel. */
const deathListeners = new Set<() => void>();

/**
 * The static layer's geometry is the parsed model, so the resident set is not
 * consulted — but `roofGeometrySource` imports it, and a stub keeps the
 * streaming store out of a test that is about a static layer.
 */
vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => ({
    objects: {},
    cellCount: 0,
    featureCount: 0,
    surfaceAttrKeys: [],
  })),
}));

/** Surfaces measured so far, and a hook fired after each one. */
let measuredSurfaces = 0;
let onMeasured: ((count: number) => void) | null = null;
/**
 * The REAL `computeRoofMetrics`, counted.
 *
 * Not a replacement: the areas and slopes asserted below are the ones the app
 * computes. The count is how the batch boundary becomes observable — the
 * source memoises per (object, LoD), so one call is one feature measured.
 */
vi.mock("@cityjson/navara-core", async () => {
  const actual = await vi.importActual<typeof import("@cityjson/navara-core")>(
    "@cityjson/navara-core",
  );
  return {
    ...actual,
    computeRoofMetrics: vi.fn(
      (surface: Parameters<typeof actual.computeRoofMetrics>[0]) => {
        measuredSurfaces += 1;
        onMeasured?.(measuredSurfaces);
        return actual.computeRoofMetrics(surface);
      },
    ),
  };
});

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (gate && statement.includes(gate.needle)) await gate.promise;
    if (failing !== null && statement.includes(failing)) {
      return { ok: false as const, message: "Database was closed" };
    }
    // DuckDB's DDL is transactional, and a cancelled write leans on exactly
    // that: the ROLLBACK is what takes the added columns (and the backup
    // table) away again. A fake that kept them would let a broken write look
    // clean.
    if (statement === "BEGIN TRANSACTION") columnsAtBegin = [...liveColumns];
    if (statement === "ROLLBACK" && columnsAtBegin !== null) {
      liveColumns = columnsAtBegin;
      columnsAtBegin = null;
    }
    if (statement === "COMMIT") columnsAtBegin = null;
    // The registry's column list is what decides CREATE vs REPLACE on the next
    // run, so the fake database has to actually change shape.
    const added =
      /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(statement);
    if (added?.[1] && !liveColumns.includes(added[1]))
      liveColumns.push(added[1]);
    const dropped = /^ALTER TABLE "[^"]+" DROP COLUMN IF EXISTS "([^"]+)"/.exec(
      statement,
    );
    if (dropped?.[1]) liveColumns = liveColumns.filter((c) => c !== dropped[1]);
    if (statement.includes("COUNT(DISTINCT")) {
      return { ok: true as const, columns: ["n"], rows: [{ n: featureTotal }] };
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
      state: "ready",
      extensions: {},
      loadedExtensions: [],
      platform: null,
    })),
    isExtensionLoaded: vi.fn(() => false),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) => String(e),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
    initDuckDB: vi.fn(async () => {}),
  };
});

vi.mock("../../../../src/insights/layerTables", async () => {
  // `create` is imported HERE rather than at the top of the file: the factory
  // runs while the module graph is still being built, when a top-level import
  // binding is not yet initialised.
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  // The real queue is one FIFO chain, and the "second run waits" test is a test
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
      // The real one round-trips a DESCRIBE through WASM. The delay is what makes
      // "inside the queued task" observable: a refresh left outside it lands
      // after the next run has already read the columns.
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
const { ensureExtension, isExtensionLoaded, getDuckDBStatus } =
  await import("../../../../src/insights/duckdb");
const { submitRun, cancelRun, undoRun, installStaleWatcher } =
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
const { roofMetrics, ROOF_BATCH_FEATURES } =
  await import("../../../../src/features/processing/tools/roofMetrics");

type Resettable = { __resetQueue: () => void };

/**
 * A planar quad at `lod` whose TRUE area is `area` and whose tilt is exactly
 * `slopeDeg`.
 *
 * The ring is a rectangle in 3D: one edge along +x of length `w`, the other of
 * length `hypot(1, dz)` rising by `dz` over one metre of +y. Newell's area is
 * therefore `w * hypot(1, dz)`, which `w` is chosen to make `area`, and the
 * inclination is `atan(dz)` — no pitched-square shortcut, so a 30 m² roof at
 * 10 degrees really is 30 m² at 10 degrees.
 */
function roofSurface(lod: string, area: number, slopeDeg = 0) {
  const dz = Math.tan((slopeDeg * Math.PI) / 180);
  const w = area / Math.hypot(1, dz);
  return {
    type: "RoofSurface",
    rings: [
      [
        [0, 0, 3],
        [w, 0, 3],
        [w, 1, 3 + dz],
        [0, 1, 3 + dz],
      ],
    ],
    attributes: {},
    lod,
  };
}

function object(
  id: string,
  objectType: string,
  surfaces: unknown[],
  parents: string[] = [],
  children: string[] = [],
) {
  return {
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  };
}

function cityModel(objects: Record<string, unknown>): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects,
  } as unknown as CityModel;
}

/**
 * B1 (Building, its OWN 99 m² roof at 2.2) + P1 (roof 30 m² at 10°) + P2 (roof
 * 10 m², flat); B2 (Building, roof 12 m² flat at 2.2, NO parts); B3 (Building,
 * roof at 1.2 only).
 *
 * B1's two parts are UNEQUAL, so a sum can be told from a max, and B1's own
 * roof is far larger than their sum, so §7's contributor rule can be told from
 * a read of the root. B2 is in the layer but outside the Selected scope below, so a
 * replacement can be shown to leave a NON-NULL value alone; B3 is the skip.
 */
function model(): CityModel {
  return cityModel({
    B1: object("B1", "Building", [roofSurface("2.2", 99)], [], ["P1", "P2"]),
    P1: object("P1", "BuildingPart", [roofSurface("2.2", 30, 10)], ["B1"]),
    P2: object("P2", "BuildingPart", [roofSurface("2.2", 10)], ["B1"]),
    B2: object("B2", "Building", [roofSurface("2.2", 12)]),
    B3: object("B3", "Building", [roofSurface("1.2", 5)]),
  });
}

/** `count` root-only buildings, each with one flat roof at 2.2. */
function wideModel(count: number): CityModel {
  const objects: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    objects[`F${i}`] = object(`F${i}`, "Building", [roofSurface("2.2", 8)]);
  }
  return cityModel(objects);
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
    availableLods: ["2.2", "1.2"],
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

function attributesOf(objectId: string): Record<string, unknown> {
  return (useLayerStore.getState().layers[0]?.model.objects[objectId]
    ?.attributes ?? {}) as Record<string, unknown>;
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

/** One run request, with the height-from-extent tool's real shape. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "height-from-extent" as const,
    targetLayerId: "L1",
    scope: "all" as const,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    ...overrides,
  };
}

beforeEach(() => {
  // The REAL executor, registered per test: `afterEach` takes it off again,
  // and the module's own load-time registration happens only once.
  registerExecutor("roof-metrics", roofMetrics);
  measuredSurfaces = 0;
  onMeasured = null;
  sql.length = 0;
  registered.length = 0;
  featureTotal = 1;
  scopeRows = [];
  gate = null;
  failing = null;
  liveColumns = ["id", "feature_id"];
  columnsAtBegin = null;
  statusListeners.clear();
  deathListeners.clear();
  tableInfo = freshTable();
  useSelectionStore.getState().clear();
  useLayerStore.setState({ layers: [layer()] });
  useProcessingStore.getState().resetForTest();
  useComputedColumnStore.setState({ byLayer: {} });
  vi.mocked(tables.refreshLayerTableColumns).mockClear();
  // The extension phase reads all three. `mockClear` before the value, so a
  // test that asserts "never called" cannot inherit the previous test's call.
  vi.mocked(isExtensionLoaded).mockClear().mockReturnValue(false);
  vi.mocked(ensureExtension).mockClear().mockResolvedValue(false);
  vi.mocked(getDuckDBStatus)
    .mockClear()
    .mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "unloaded" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
});

afterEach(() => {
  (tables as unknown as Resettable).__resetQueue();
  delete EXECUTORS["roof-metrics"];
});

/** Every row of the fake table, which is what `scopeRows` answers with. */
const ALL_ROWS = [
  { id: "B1", f: "B1" },
  { id: "P1", f: "B1" },
  { id: "P2", f: "B1" },
  { id: "B2", f: "B2" },
  { id: "B3", f: "B3" },
];

/** The roof request, with the shape `submitRun` wants. */
function roofRequest(overrides: Record<string, unknown> = {}) {
  return request({
    toolId: "roof-metrics",
    lod: "2.2",
    prefix: "roof_",
    // Already NORMALISED, as `ToolView` freezes them: the spec's order, and a
    // threshold inside the slider's range.
    params: {
      measures: ["area", "flatArea", "surfaces"],
      flatThresholdDeg: 5,
    },
    columns: [
      { name: "roof_area_m2", type: "DOUBLE" as const },
      { name: "roof_flat_m2", type: "DOUBLE" as const },
      { name: "roof_surfaces_n", type: "DOUBLE" as const },
    ],
    ...overrides,
  });
}

describe("a Roof metrics run", () => {
  beforeEach(() => {
    featureTotal = 3;
    scopeRows = ALL_ROWS;
  });

  it("sums UNEQUAL parts onto the building and leaves each part its own", async () => {
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    // §7's contributor rule: B1's PARTS contribute, its own 99 m² roof is
    // ignored. 30 + 10 = 40, and a max or a root read would not give 40.
    expect(attributesOf("B1").roof_area_m2).toBeCloseTo(40, 6);
    expect(attributesOf("P1").roof_area_m2).toBeCloseTo(30, 6);
    expect(attributesOf("P2").roof_area_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B1").roof_surfaces_n).toBe(2);
    expect(attributesOf("B2").roof_area_m2).toBeCloseTo(12, 6);
    // B3 has no roof at 2.2: NULL, and one skip naming the LoD.
    expect(attributesOf("B3").roof_area_m2).toBeNull();
    expect(runById(id)!.summary!.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
    expect(runById(id)!.summary!.line).toMatch(
      /^2 buildings measured · 1 skipped · /,
    );
    // §6.4: the log carries the run's one statement, under its own label —
    // and the TOOL issues exactly that one (the write's is the queue's).
    expect(runById(id)!.log.map((entry) => entry.label)).toContain(
      "Reading features",
    );
    expect(
      sql.filter((q) => q.includes('COALESCE("feature_id", "id") AS f')),
    ).toHaveLength(1);
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(true);
  });

  it("replaces inside the scope only, with a THRESHOLD that changes the value", async () => {
    // Run 1, All, threshold 5: P1 (10°) is not flat, P2 (0°) is.
    const first = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);

    // Run 2, Selected on B1's family, threshold 15 (the slider's top): now P1
    // counts as flat too, so B1's flat area MUST move from 10 to 40. B2 is
    // outside the scope and its value is NON-NULL, so §7's "values in a
    // replaced column outside the scope keep their existing value" has
    // something real to preserve.
    useSelectionStore.getState().select({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
    scopeRows = ALL_ROWS.filter((r) => r.f === "B1");
    const second = submitRun(
      roofRequest({
        scope: "selected",
        params: {
          measures: ["area", "flatArea", "surfaces"],
          flatThresholdDeg: 15,
        },
      }),
    );
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));

    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(40, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
    // §6.2: the later run takes the earlier one's Undo.
    expect(runById(first)?.undoable).toBe(false);
    expect(runById(second)?.undoable).toBe(true);

    await undoRun(second);
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
  });

  it("publishes NOTHING when the Cancel lands during the read", async () => {
    // The gate holds the executor's OWN read — the statement no other run
    // issues under scope "all" — so the run is demonstrably inside
    // `roofMetrics` when Cancel is pressed, not still queued.
    const held = deferred<void>();
    gate = { needle: "AS f FROM", promise: held.promise };
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.phase).toBe("compute"));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("AS f FROM"))).toBe(true),
    );
    cancelRun(id);
    held.resolve();

    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(attributesOf("B1").roof_area_m2).toBeUndefined();
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(false);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("stops at the next batch when the Cancel lands during the compute", async () => {
    // A scope two batches wide, cancelled the moment the FIRST batch's last
    // feature is measured. The bound is what makes that a stopping point: the
    // second batch must not start, and nothing may be published.
    const features = ROOF_BATCH_FEATURES * 2;
    useLayerStore.setState({
      layers: [{ ...layer(), model: wideModel(features) }],
    });
    featureTotal = features;
    scopeRows = Array.from({ length: features }, (_, i) => ({
      id: `F${i}`,
      f: `F${i}`,
    }));
    let id = "";
    onMeasured = (count) => {
      if (count === ROOF_BATCH_FEATURES) cancelRun(id);
    };
    id = submitRun(roofRequest({ scope: "all" }));

    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    // One batch of real CPU work, and not one feature more.
    expect(measuredSurfaces).toBe(ROOF_BATCH_FEATURES);
    expect(attributesOf("F0").roof_area_m2).toBeUndefined();
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(false);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("fails a queued run whose table was rebuilt while the first one ran", async () => {
    // The re-validation at the HEAD of the queue is the boundary the code
    // supports: run 1 is held inside the real executor's read, and a streaming
    // settle replaces the table before run 2 reaches the head.
    const held = deferred<void>();
    gate = { needle: "AS f FROM", promise: held.promise };
    const first = submitRun(roofRequest({ scope: "all" }));
    const second = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("AS f FROM"))).toBe(true),
    );
    tableInfo = { ...freshTable(), table: "layer_2" };
    held.resolve();

    await vi.waitFor(() => expect(runById(second)?.status).toBe("failed"));
    expect(runById(second)?.error).toBe(
      "Layer changed while running; run again",
    );
    expect(runById(first)?.status).toBe("done");
    // The second run never got as far as its own read.
    expect(sql.filter((q) => q.includes("AS f FROM"))).toHaveLength(1);
  });

  it("marks a finished run stale when the layer's table is rebuilt after it", async () => {
    // The watcher fires on a TRANSITION, so the store needs the table it is
    // transitioning FROM before the run starts.
    tables.useLayerTableStore.setState({
      tables: { L1: { state: "ready", info: tableInfo } },
    } as never);
    const stop = installStaleWatcher();
    try {
      const id = submitRun(roofRequest({ scope: "all" }));
      await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
      expect(runById(id)?.stale).toBe(false);
      tables.useLayerTableStore.setState({
        tables: {
          L1: { state: "ready", info: { ...tableInfo, table: "layer_9" } },
        },
      } as never);
      await vi.waitFor(() => expect(runById(id)?.stale).toBe(true));
      expect(runById(id)?.undoable).toBe(false);
    } finally {
      stop();
    }
  });
});
