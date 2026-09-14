### Task 22: The destination branch, publication and Undo

**Files:**

- Modify: `src/features/processing/runQueue.ts`, `src/features/processing/types.ts` (`RunRecord.destination`, `RunRecord.newLayerId`), `src/features/processing/toolRegistry.ts` (`destinations` gains `"new"` on **every implemented tool with `target: "city"`** — Roof metrics, Measure solids, Validate solids, Height from extent, Join, Distance; Aggregate is Task 23's), `src/ui/processing/RunFooter.tsx`, `src/ui/processing/LogView.tsx`, `src/ui/processing/runFormat.ts`.
- **Also modify (now in the File map too):** `src/ui/shell/shellStore.ts` and `src/app/App.tsx` — §6.2's new **Zoom to layer** action has no reachable door. Zooming is `sceneRef.current?.fitLayer(id)` inside `App` (`handleZoomToLayer`, `App.tsx:1999-2005`), prop-drilled to the layer list; `RunFooter` cannot reach it. The addition is one request field on the shell store, exactly mirroring `requestedSection` (`shellStore.ts:52-54, 184-199`), and one consuming effect in `App`.
- Test: `tests/unit/features/processing/derivedRun.test.ts`, `tests/unit/ui/processing/derivedCard.test.tsx`.

**Interfaces:**

- Consumes: `DerivedPlan`, `prepareDerivedCityLayer`, `disambiguate`, `derivedLayerName` (Task 20/21); `ToolDestination` (Task 20); `Layer.derivedFrom` (Task 21).
- Produces:

  ```ts
  // src/features/processing/types.ts — RunRecord gains:
  //   destination: ToolDestination
  //   newLayerId: string | null     // the layer the run CREATED, once published

  // src/features/processing/runQueue.ts
  /** §6.2's block on undoing a New-layer run, or null when Undo is available. */
  export function newLayerUndoBlock(run: RunRecord): string | null;
  /** §6.2's New-layer card line: "Created Delft · solids · 312 buildings · … · 2.4 s".
   *  `features` is the count the COPY holds, or `null` for a copy whose own
   *  head segment already names what it holds (§7.6's "6 areas aggregated over
   *  1,204 buildings" — the buildings there are the SOURCE's). */
  export function summariseCreated(
    result: ToolResult,
    elapsedMs: number,
    layerName: string,
    features: number | null,
    options: { readonly streaming: boolean },
  ): RunSummary;

  // src/ui/shell/shellStore.ts
  //   ShellState gains:   requestedZoom: string | null
  //   ShellActions gains: requestZoom(layerId: string | null): void
  ```

  The done card's New-layer branch with `Zoom to layer`, and **every action reading `run.newLayerId ?? run.targetLayerId`**; the Undo block reason `Used by a later run; remove the layer from the layer list instead`; the log header's **[adapted copy A7]** row.

**Intent:** §6.1's cancel contract made real: compute is identical for both destinations (same table, same ids, same executor), and the branch is only at the write — `writeComputedColumns` against the target, or `prepare…` then `publish()` as the LAST step. A cancel or failure before `publish()` discards everything and reads cancelled with nothing changed; after it, §6.1's "finished before the cancel arrived". The name is re-checked at publication inside the same FIFO slot (scenario 12), and `undoRun` removes the layer OUTSIDE the slot. A reviewer rejects it for a second code path through an executor, for a partially visible derived layer, or for a `removeLayer` inside the queue.

**One more string with no entry in the copy table.** §10 scenario 12 ends "the run publishes as 'Delft · solids 2 (2)' and the card says so", and neither §6 nor §6.2 gives the sentence. The owner accepted it at the plan gate as **[adapted copy A15]**: `Renamed to "Delft · solids 2 (2)": a layer already had that name`, rendered as the card's `note` beside §6.1's existing "finished before the cancel arrived" (Decisions recorded, item 5).

- [ ] **Step 1: Write the failing test for the destination branch**

Create `tests/unit/features/processing/derivedRun.test.ts`. `deriveLayer` is NOT mocked: what this suite tests is the queue and the preparation together.

```ts
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
  });

  it("activates the copy (§6.2)", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(
      runById(id)?.newLayerId,
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

  it("Undo REMOVES the layer and takes its columns with it (§6.2)", async () => {
    fakeExecutor();
    const id = submitRun(newLayerRequest());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const newId = runById(id)?.newLayerId ?? "";
    await undoRun(id);
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(useComputedColumnStore.getState().byLayer[newId]).toBeUndefined();
    expect(runById(id)?.note).toBe("Undone");
    expect(runById(id)?.undoable).toBe(false);
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
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/derivedRun.test.ts
```

Expected: FAIL — `newLayerUndoBlock is not a function`, and the first case fails because the run still wrote `ALTER TABLE "layer_1"`.

- [ ] **Step 3: Put the destination on the record**

In `src/features/processing/types.ts`, find:

```ts
  /** Set when the run finished before the cancel arrived (spec §6.1). */
  readonly note: string | null;
}
```

and insert ABOVE `readonly note`:

```ts
  /** Spec §6's OUTPUT destination, frozen at Run. */
  readonly destination: ToolDestination;
  /**
   * The layer this run CREATED, once it has been published; null for every
   * This-layer run and for a New-layer run that has not reached its
   * publication step.
   *
   * §6.2's card reads `newLayerId ?? targetLayerId` for Open table, Style by
   * result and Zoom to layer, so the actions point at the COPY rather than at
   * the untouched target; `undoRun` reads it to know that Undo means "remove
   * the layer".
   */
  readonly newLayerId: string | null;
}
```

In `src/features/processing/runQueue.ts`, `queueRun`'s record literal — find:

```ts
    prefix: request.prefix,
    columns: request.columns.map((c) => c.name),
    status: "queued",
```

and insert between:

```ts
    prefix: request.prefix,
    columns: request.columns.map((c) => c.name),
    destination: request.destination,
    newLayerId: null,
    status: "queued",
```

- [ ] **Step 4: Write the destination branch in `execute`**

In `src/features/processing/runQueue.ts`, add the imports:

```ts
import {
  derivedLayerName,
  prepareDerivedCityLayer,
  type DerivedPlan,
} from "./deriveLayer";
```

Then find the write's opening:

```ts
patch(id, { phase: "write" });
// Which of THIS run's columns the table already has — matched the way
```

and insert the branch between the two lines:

```ts
patch(id, { phase: "write" });

// §6.1's OTHER publication. The compute above is identical for both
// destinations — same table, same frozen ids, same executor — and the
// branch is HERE, at the write, and nowhere else: a second path through
// the executors would be the place the two destinations silently diverge.
if (request.destination === "new") {
  let plan: DerivedPlan | null = null;
  try {
    plan = await prepareDerivedCityLayer({
      runId: id,
      parent: layer,
      parentTable: table,
      // The frozen name (§6.1), with the prefill as the fallback for a
      // request built without one. The source's name comes off the RECORD
      // (`runById`), which is where Task 11 put it — `execute` holds the
      // source's id, not its name.
      name:
        request.newLayerName ??
        derivedLayerName(
          layer.name,
          request.toolId,
          runById(id)?.sourceName ?? null,
        ),
      rowIds: scope.featureIds,
      columns: result.columns,
      rows: result.rows,
      signal,
      query: ctx.query,
    });
    // §6.1: "a cancel (or a failure) that lands BEFORE publication
    // discards every partial resource … and the run reads cancelled with
    // nothing changed". This is the LAST moment that is true.
    if (signal.aborted) throw new CancelledError();
    const newLayerId = plan.publish();
    // BOTH stores. A derived CITY layer's row is in `layerStore`; a derived
    // VECTOR layer's (Task 23) is in `geoLayerStore`, and reading only the
    // city one gave `undefined` — so a name that publication had to
    // disambiguate never reached the card or A15's note, and §10 scenario
    // 12 failed silently on exactly the case it is about.
    const name =
      useLayerStore.getState().layers.find((l) => l.id === newLayerId)?.name ??
      useGeoLayerStore.getState().layers.find((l) => l.id === newLayerId)
        ?.name ??
      plan.name;

    // The copy's own new columns, with the run's real provenance — through
    // the SAME publisher both This-layer paths use (Task 18's
    // `publishProvenance`), so there is one rule for what a badge says. The
    // INHERITED entries were copied inside `publish()`.
    //
    // The scope is handed over with `total: scope.count`: the copy holds
    // exactly the scoped features, so the run covered ALL of it and the
    // tooltip must not read "312 of 1,115" about a layer of 312.
    publishProvenance(id, newLayerId, result, tool.name, request, {
      featureIds: scope.featureIds,
      count: scope.count,
      total: scope.count,
    });

    // RE-READ, and this is the bug it is written against: `getState()`
    // returns a SNAPSHOT, and every `setProvenance` above replaced
    // `byLayer` with a new object. A set built from a snapshot taken
    // BEFORE them holds none of this run's entries, so `newLayerUndoBlock`
    // would see every column of the copy as one it "grew afterwards" and
    // disable Undo the instant the card appeared.
    const carried = useComputedColumnStore.getState().byLayer[newLayerId] ?? {};
    undoState.set(id, {
      kind: "layer",
      layerId: newLayerId,
      table: table.table,
      // Everything the copy carried the moment it was published — the
      // inherited runs plus this one. Anything that appears later is a
      // column of its OWN, and blocks the Undo.
      runIds: new Set(Object.values(carried).map((p) => p.runId)),
    });

    const summary = summariseCreated(result, elapsed(), name, scope.count, {
      streaming: layer.isStreaming,
    });
    const notes = [
      // [adapted copy A15] — §10 scenario 12's "the card says so".
      name === plan.name
        ? null
        : `Renamed to "${name}": a layer already had that name`,
      // §6.1: a cancel that lost the race is told, not hidden.
      signal.aborted ? "finished before the cancel arrived" : null,
    ].filter((n): n is string => n !== null);
    patch(id, {
      status: "done",
      phase: null,
      elapsedMs: elapsed(),
      summary,
      log: [...log],
      columns: result.columns.map((c) => c.name),
      newLayerId,
      undoable: true,
      note: notes.length === 0 ? null : notes.join(" · "),
    });
    if (runById(id)?.status !== "done") {
      discardUndo(id);
      return;
    }
    useProcessingStore.getState().pushNotice(summary.line);
  } catch (error) {
    // NOTHING published: the partial table (and nothing else — no store
    // write happened) goes. `execute`'s catch then reads the error as a
    // cancel or a failure exactly as it does for a This-layer run.
    await plan?.discard();
    throw error;
  }
  return;
}

// Which of THIS run's columns the table already has — matched the way
```

- [ ] **Step 5: Add `summariseCreated`, the Undo union and `newLayerUndoBlock`**

1. Beside `summarise`, in `src/features/processing/runQueue.ts`:

```ts
/**
 * Spec §6.2's New-layer card: "Created Delft · solids · 312 buildings · 37
 * invalid solids (no volume) · 2.4 s".
 *
 * It DELEGATES to {@link summarise} and replaces the head segment rather than
 * rebuilding the line, so the caveat and skipped segments stay in one place: a
 * tool that adds one gets it on both destinations for free. The count is the
 * FEATURES the copy holds (the frozen scope), not the measured count — the
 * sentence is about the layer that now exists.
 *
 * `features === null` keeps the tool's own head segment instead, for a copy
 * whose head already names what it holds: §7.6's card is "6 areas aggregated
 * over 1,204 buildings", where the 6 are the target AREAS the copy holds and
 * the 1,204 are the SOURCE's buildings. Replacing that with a building count
 * would put the source's number on the created layer — the one number on the
 * card that would be about another layer. Both branches are spec-verbatim
 * fragments: §6.2's "Created <name>" and, for the second, §7.6's own line.
 */
export function summariseCreated(
  result: ToolResult,
  elapsedMs: number,
  layerName: string,
  features: number | null,
  options: { readonly streaming: boolean },
): RunSummary {
  const base = summarise(result, elapsedMs, options);
  const segments = base.line.split(" · ");
  return {
    ...base,
    line:
      features === null
        ? [`Created ${layerName}`, ...segments].join(" · ")
        : [
            `Created ${layerName}`,
            plural(features, "building", "buildings"),
            ...segments.slice(1),
          ].join(" · "),
  };
}
```

2. The Undo state becomes a union — a NESTED one. Find:

```ts
const undoState = new Map<string, UndoState>();
```

and replace with:

```ts
/**
 * What Undo MEANS for a run, which is a question about its DESTINATION (§6.2).
 *
 * "This layer": columns the run created are dropped and columns it replaced
 * get their previous values back — from a backup table for a city target, from
 * the captured `preparedData` for a vector one. That is {@link UndoState},
 * which Task 18 already discriminates on `kind: "city" | "vector"`.
 * "New layer": the whole Undo is removing the layer — nothing was written to
 * the target, so there is no backup and nothing to restore.
 *
 * NESTED, not intersected: `{ kind: "columns" } & UndoState` is `never`,
 * because `UndoState`'s own `kind` is already `"city" | "vector"` and no value
 * can carry both. So the destination's discriminant wraps the target's, and
 * the two questions stay separable — "what does Undo mean here" and "what kind
 * of thing does it put back".
 */
type RunUndo =
  | { readonly kind: "columns"; readonly state: UndoState }
  | {
      readonly kind: "layer";
      readonly layerId: string;
      /** The PARENT's table, for the record — nothing reads it to undo. */
      readonly table: string;
      /**
       * Provenance run ids the copy carried at publication: the inherited ones
       * plus this run's. A column whose provenance names any OTHER run is one
       * the derived layer grew afterwards, which §6.2 blocks the Undo on.
       */
      readonly runIds: ReadonlySet<string>;
    };

const undoState = new Map<string, RunUndo>();
```

and wrap BOTH existing `undoState.set(id, { … })` calls — Task 18 left one in the city path and one in the vector path, and each keeps its literal unchanged inside `state`:

```ts
    undoState.set(id, {
      kind: "city",
      table: table.table,
```

becomes

```ts
    undoState.set(id, {
      kind: "columns",
      state: {
        kind: "city",
        table: table.table,
```

(closing one brace more at the end of the literal), and identically for the vector one:

```ts
  undoState.set(id, {
    kind: "vector",
    layerId: target.layer.id,
```

becomes

```ts
  undoState.set(id, {
    kind: "columns",
    state: {
      kind: "vector",
      layerId: target.layer.id,
```

`tsc` is the check that neither was missed: `RunUndo` has no member that accepts a bare `UndoState`.

3. `discardUndo` learns the outer union. After Task 18 it reads:

```ts
function discardUndo(id: string): void {
  const state = undoState.get(id);
  if (!state) return;
  undoState.delete(id);
  // A VECTOR run's Undo holds no database resource at all — its copy is one
  // JavaScript object, which the Map delete above has already released.
  if (state.kind !== "city") return;
  const backup = state.backupTable;
  if (!backup) return;
```

and becomes:

```ts
function discardUndo(id: string): void {
  const state = undoState.get(id);
  if (!state) return;
  undoState.delete(id);
  // A New-layer run's Undo holds no backup table — its whole undo is removing
  // the layer, and the layer's own table goes with it through
  // `layerTableLifecycle`'s removal branch. There is nothing to drop here.
  if (state.kind === "layer") return;
  // A VECTOR run's Undo holds no database resource at all — its copy is one
  // JavaScript object, which the Map delete above has already released.
  if (state.state.kind !== "city") return;
  const backup = state.state.backupTable;
  if (!backup) return;
```

4. The block predicate, exported for the card and used by the Undo itself:

```ts
/** Spec §6.2's reason a finished New-layer run can no longer be undone. */
const USED_BY_LATER_RUN =
  "Used by a later run; remove the layer from the layer list instead";

/**
 * §6.2: "Undo of a New-layer run is available only while the derived layer is
 * untouched as data: it has not been the target or source of any later run
 * (queued, running or done) and has no computed columns of its own. Renaming
 * or restyling it does not block Undo."
 *
 * Null for a This-layer run — that Undo has its own rules — and null when the
 * block does not apply, so the card can use it directly as its disabled reason.
 */
export function newLayerUndoBlock(run: RunRecord): string | null {
  const layerId = run.newLayerId;
  if (layerId === null) return null;
  const used = useProcessingStore
    .getState()
    .runs.some(
      (other) =>
        other.id !== run.id &&
        (other.targetLayerId === layerId || other.sourceLayerId === layerId),
    );
  if (used) return USED_BY_LATER_RUN;
  const state = undoState.get(run.id);
  // No recorded state (an engine restart, an eviction): the card's `undoable`
  // is the authority and this adds no reason of its own. `kind !== "layer"` is
  // the same silence for a This-layer run, whose Undo has its own rules.
  if (state === undefined || state.kind !== "layer") return null;
  const grown = Object.values(
    useComputedColumnStore.getState().byLayer[layerId] ?? {},
  ).some((p) => !state.runIds.has(p.runId));
  return grown ? USED_BY_LATER_RUN : null;
}
```

5. `undoRun` branches on the DESTINATION first, and the rest of its body reads the inner state. After Task 18 it opens:

```ts
export async function undoRun(id: string): Promise<void> {
  const run = runById(id);
  const state = undoState.get(id);
  if (!run || !run.undoable || !state) return;
  if (state.kind === "vector") {
```

and becomes:

```ts
export async function undoRun(id: string): Promise<void> {
  const run = runById(id);
  const state = undoState.get(id);
  if (!run || !run.undoable || !state) return;
  // §6.2: "Undo (removes the new layer; asks no confirmation)". Nothing was
  // written to the target, so there is no transaction to reverse — and no
  // reason to take a FIFO slot for it either.
  if (state.kind === "layer") {
    const blocked = newLayerUndoBlock(run);
    if (blocked !== null) {
      patch(id, { error: blocked });
      return;
    }
    // OUTSIDE the queue, and that is a hard fact rather than a preference:
    // `removeLayer` reaches `layerTableLifecycle`'s removal branch, which
    // calls `dropLayerTable` — and that ENQUEUES. Removing from inside a FIFO
    // slot would deadlock exactly as `enqueueLayerTable` would (Design
    // decision (g)).
    useLayerStore.getState().removeLayer(state.layerId);
    useComputedColumnStore.getState().clearLayer(state.layerId);
    undoState.delete(id);
    patch(id, { undoable: false, note: "Undone" });
    return;
  }
  // Everything below is Task 18's body, unchanged except that the state it
  // reads is now one level in. ONE new binding rather than a rename at every
  // site, so the diff is the wrapper and not the Undo.
  const undo = state.state;
  if (undo.kind === "vector") {
```

and every remaining `state.` in the function body becomes `undo.` — `undo.layerId`, `undo.previousPreparedData`, `undo.created`, `undo.replaced`, `undo.table`, `undo.backupTable`, `undo.ids`, `undo.previousModelValues`. `tsc` names each one: `RunUndo`'s `"columns"` member has none of those fields.

6. **The Undo-steal rule must skip a New-layer run.** A publication takes Undo away from any earlier done run over the same layer that shares a column — but a New-layer run's `targetLayerId` is the PARENT, which it never wrote to, so a later This-layer run on the parent would steal an Undo whose whole meaning is "remove the copy". After Task 18 the rule lives in ONE helper, `stealUndo`. Find:

```ts
    if (
      other.id !== runId &&
      other.targetLayerId === layerId &&
      other.undoable &&
```

and replace with:

```ts
    if (
      other.id !== runId &&
      other.targetLayerId === layerId &&
      // A NEW-LAYER run wrote nothing to this layer — its `targetLayerId` is
      // the parent it copied FROM. Its Undo removes the copy, and no write
      // here can make that stale (§6.2's own block is the run-history scan
      // in `newLayerUndoBlock`).
      other.newLayerId === null &&
      other.undoable &&
```

7. **`installStaleWatcher` must skip one too.** §6: "A derived layer is independent of its parent from publication on: a parent table rebuild, filter, edit or removal never marks it stale." After Task 11 the match reads the COMPUTE layer. Find:

```ts
  if (computeLayerId === layerId && run.status === "done" && !run.stale) {
```

and replace with:

```ts
  if (
    computeLayerId === layerId &&
    // §6: a rebuild of the PARENT says nothing about the copy — "a derived
    // layer is independent of its parent from publication on". The copy's
    // own table is adopted, never rebuilt, so no rebuild of it can reach
    // here either.
    run.newLayerId === null &&
    run.status === "done" &&
    !run.stale
  ) {
```

- [ ] **Step 6: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/derivedRun.test.ts tests/unit/features/processing/runQueue.test.ts
```

Expected: PASS. `runQueue.test.ts`'s `request()` fixture needs `destination: "layer", newLayerName: null` (Task 20 already added it) and its `RunRecord` fixtures `destination: "layer", newLayerId: null`.

- [ ] **Step 7: Write the failing test for the New-layer card**

Create `tests/unit/ui/processing/derivedCard.test.tsx`:

```tsx
/**
 * §6.2's done card for a New-layer run: the "Created …" line, the five actions
 * pointing at the COPY rather than at the untouched target, and Zoom to layer.
 *
 * The footer is rendered on its own, not through `ToolView`: what is under
 * test is the card, and a form around it would make every case depend on the
 * eligibility of a tool it is not about.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

vi.mock("../../../../src/insights/duckdb", () => ({
  formatDuckDBError: (e: unknown) => String(e),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {},
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  runQuery: vi.fn(async () => ({ ok: true, columns: ["m"], rows: [{ m: 7 }] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/runQueue")
  >("../../../../src/features/processing/runQueue");
  return {
    // The BLOCK is real: what the card is asserting is §6.2's rule, and a
    // stubbed predicate would let the card claim any reason it liked.
    newLayerUndoBlock: actual.newLayerUndoBlock,
    submitRun: vi.fn(() => "run_1"),
    retryRun: vi.fn(() => "run_2"),
    cancelRun: vi.fn(),
    undoRun: vi.fn(async () => {}),
  };
});

const { RunFooter } = await import("../../../../src/ui/processing/RunFooter");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { undoRun } =
  await import("../../../../src/features/processing/runQueue");
const { useRuleDraftStore } =
  await import("../../../../src/features/rules/ruleDraftStore");

/** A done New-layer run whose copy is the layer "NEW". */
function createdRun(patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L",
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m"],
    destination: "new",
    newLayerId: "NEW",
    status: "done",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 300,
    summary: {
      line: "Created Delft · extent · 2 buildings · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
      // Task 9 replaced `firstColumnNonNull` with a per-column map; Style by
      // result reads it to decide whether the chosen column is all-NULL.
      nonNullByColumn: { extent_height_m: 2 },
    },
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
    ...patch,
  };
}

/** Both layers in the store, and a ready table for the copy, so Open table
 *  has somewhere to go. Only the two ids matter to the card. */
function addLayers(): void {
  useLayerStore.setState({
    layers: [
      { id: "L", name: "Delft" } as never,
      { id: "NEW", name: "Delft · extent" } as never,
    ],
  });
  useLayerTableStore.setState({
    tables: {
      NEW: {
        state: "ready",
        info: {
          table: "layer_2",
          sourceName: null,
          source: null,
          reader: null,
          extension: null,
          sourceBytes: null,
          sourceFeatureIds: null,
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [] });
  useLayerTableStore.setState({ tables: {} });
  useWorkspaceStore.getState().setActiveLayerId(null);
  useQueryStore.setState({ queries: {} });
  useRuleDraftStore.setState({ drafts: {} });
  useShellStore.getState().requestZoom(null);
});

describe("the New-layer result card", () => {
  it("reads §6.2's Created line and offers five actions", () => {
    render(
      <RunFooter
        run={createdRun({ undoable: true })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.getByText("Created Delft · extent · 2 buildings · 0.3 s"),
    ).toBeTruthy();
    // §6.2 lists five for a New-layer run, Zoom to layer first.
    for (const name of [
      "Zoom to layer",
      "Open table",
      "Style by result",
      "Undo",
      "Log",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("points Open table at the COPY, never at the untouched target", () => {
    addLayers();
    render(
      <RunFooter
        run={createdRun()}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(useWorkspaceStore.getState().activeLayerId).toBe("NEW");
  });

  it("opens the Style-by-result draft on the COPY, not on the target", async () => {
    // The THIRD of the card's three copy-pointing actions (Open table and Zoom
    // are above). It is also the only one that goes through the click handler's
    // `runById` guard — §7's "a run that went stale or was undone while the
    // read was in flight" — so the record must be in the STORE and not only in
    // the prop, or the draft is silently never written and this case would pass
    // against an empty draft store.
    addLayers();
    const run = createdRun();
    useProcessingStore.getState().upsertRun(run);
    render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await waitFor(() => {
      expect(
        useRuleDraftStore.getState().drafts["NEW"]?.form?.conditions?.[0]
          ?.field,
      ).toBe("extent_height_m");
    });
    expect(useRuleDraftStore.getState().drafts["L"]).toBeUndefined();
  });

  it("asks the shell to zoom to the COPY", () => {
    render(
      <RunFooter
        run={createdRun()}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));
    expect(useShellStore.getState().requestedZoom).toBe("NEW");
  });

  it("does NOT say 'Wrote N columns to Delft' — nothing was written there", () => {
    render(
      <RunFooter
        run={createdRun()}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(screen.queryByText(/Wrote 1 column to Delft/)).toBeNull();
  });

  it("shows A15's rename note when publication renamed the layer", () => {
    render(
      <RunFooter
        run={createdRun({
          note: 'Renamed to "Delft · extent (2)": a layer already had that name',
        })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.getByText(
        'Renamed to "Delft · extent (2)": a layer already had that name',
      ),
    ).toBeTruthy();
  });

  it("disables Undo with §6.2's reason once a later run used the copy", () => {
    useProcessingStore
      .getState()
      .upsertRun(
        createdRun({ id: "run_later", targetLayerId: "NEW", newLayerId: null }),
      );
    const run = createdRun({ undoable: true });
    render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo.getAttribute("title")).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    fireEvent.click(undo);
    expect(vi.mocked(undoRun)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing/derivedCard.test.tsx
```

Expected: FAIL — no `Zoom to layer` button, and the card still prints "Wrote 1 column to Delft.".

- [ ] **Step 9: Add the shell's zoom request**

In `src/ui/shell/shellStore.ts`, beside `requestedSection`. Find:

```ts
  /** Set by `requestSection`; consumed (and cleared) by `ActiveLayerPanel`
   *  once it has opened and scrolled to the section. */
  readonly requestedSection: { layerId: string; section: PanelSection } | null;
}
```

and insert above the closing brace:

```ts
  /**
   * A layer the UI has asked the viewport to fly to; consumed (and cleared) by
   * `App`, which is the only place that holds the scene handle.
   *
   * §6.2's New-layer card offers "Zoom to layer", and the card is three
   * components deep in the RIGHT panel while the zoom is `sceneRef.fitLayer`
   * in `App`. One request field, exactly like `requestedSection` above, rather
   * than a callback prop-drilled through the toolbox.
   */
  readonly requestedZoom: string | null;
}
```

the action, beside `requestSection`'s declarations:

```ts
  /** Ask `App` to fly to this layer; `null` clears a consumed request. */
  requestZoom(layerId: string | null): void;
```

the initial state (`requestedSection: null,` gains `requestedZoom: null,`), and the implementation beside `requestSection`'s:

```ts
  requestZoom(layerId) {
    set({ requestedZoom: layerId });
  },
```

In `src/app/App.tsx`, consume it beside the existing `handleZoomToLayer`. Find:

```ts
const handleFitActiveLayer = useCallback(() => {
  if (activeLayer !== null) handleZoomToLayer(activeLayer);
}, [activeLayer, handleZoomToLayer]);
```

and insert under it:

```ts
// §6.2's "Zoom to layer" on a New-layer result card. The scene handle lives
// here and nowhere else, so the toolbox asks through the shell store and
// this effect consumes the request and clears it — the same shape
// `ActiveLayerPanel` uses for `requestedSection`.
const requestedZoom = useShellStore((s) => s.requestedZoom);
useEffect(() => {
  if (requestedZoom === null) return;
  const target = unifiedLayerItems.find(
    (item) => item.layer.id === requestedZoom,
  );
  if (target !== undefined) handleZoomToLayer(target);
  useShellStore.getState().requestZoom(null);
}, [requestedZoom, unifiedLayerItems, handleZoomToLayer]);
```

(`unifiedLayerItems` is whatever `App` already passes to `LayerList` as its rows — the `ActiveLayer` list. Use the identifier that is actually there; the point is that `handleZoomToLayer` takes an `ActiveLayer`, not an id.)

- [ ] **Step 10: Give `RunFooter` its New-layer branch**

In `src/ui/processing/RunFooter.tsx`:

1. Import the block predicate and the shell's request:

```ts
import {
  cancelRun,
  retryRun,
  undoRun,
} from "../../features/processing/runQueue";
```

becomes

```ts
import {
  cancelRun,
  newLayerUndoBlock,
  retryRun,
  undoRun,
} from "../../features/processing/runQueue";
```

2. Inside the `status === "done"` branch, the two ids the whole card reads. Find:

```ts
  if (run !== null && status === "done") {
    // §6.2/§7: the draft styles the FIRST column the run wrote, in the tool's
    // own order (`extent_height_m` for Height from extent, §7.4).
    const styleColumn = run.columns[0];
```

and insert above `const styleColumn`:

```ts
// §6.2: for a New-layer run every action points at the COPY — "Open table
// (the drawer on the new layer), Style by result (the new layer's STYLE
// section)" — and not at the target, which the run left untouched.
const cardLayerId = run.newLayerId ?? run.targetLayerId;
const created = run.newLayerId !== null;
```

3. The "Wrote N columns to <target>" line becomes the destination's. Find:

```tsx
<p className="processing-note">
  Wrote {plural(run.columns.length, "column", "columns")} to {run.targetName}.
</p>
```

and replace with:

```tsx
{
  /* §6.2's This-layer card names what it wrote and where. A New-layer
              run wrote nothing to the target: its own "Created …" line already
              names the layer, and repeating a target that did not change would
              be the one sentence on the card that is false. */
}
{
  !created && (
    <p className="processing-note">
      Wrote {plural(run.columns.length, "column", "columns")} to{" "}
      {run.targetName}.
    </p>
  );
}
```

4. Zoom to layer, first in the action row (§6.2 lists it first). Find:

```tsx
          <div className="processing-card__actions">
            <button
              type="button"
              onClick={() => {
                // The run's own target is the frozen truth (§6.1); the form's
```

and insert the new button directly after the opening `<div>`:

```tsx
          <div className="processing-card__actions">
            {created && (
              <button
                type="button"
                onClick={() => {
                  activateLayer(cardLayerId);
                  useShellStore.getState().requestZoom(cardLayerId);
                }}
              >
                Zoom to layer
              </button>
            )}
```

5. Every `run.targetLayerId` inside the card becomes `cardLayerId`. Three sites: the Open table handler's `activateLayer(run.targetLayerId)` and its two `layerQuery(…, run.targetLayerId)` / `setColumns(run.targetLayerId, next)` calls. Replace each with `cardLayerId`.

6. Style by result reads the copy too. `useStyleByResult`'s `start` uses `run.targetLayerId`. Find:

```ts
  const start = useCallback((run: RunRecord, column: string) => {
    // The run's own target is the frozen truth (§6.1), as for Open table.
    const layerId = run.targetLayerId;
```

and replace with:

```ts
  const start = useCallback((run: RunRecord, column: string) => {
    // The run's own target is the frozen truth (§6.1), as for Open table —
    // except for a New-layer run, whose results live in the COPY (§6.2).
    const layerId = run.newLayerId ?? run.targetLayerId;
```

7. Undo gains §6.2's block. Find:

```tsx
{
  run.undoable && (
    <button
      type="button"
      disabled={engineStopped}
      title={engineStopped ? UNDO_ENGINE_STOPPED : undefined}
      onClick={() => void undoRun(run.id)}
    >
      Undo
    </button>
  );
}
```

and replace with:

```tsx
{
  run.undoable && (
    <button
      type="button"
      disabled={engineStopped || undoBlock !== null}
      title={engineStopped ? UNDO_ENGINE_STOPPED : (undoBlock ?? undefined)}
      onClick={() => void undoRun(run.id)}
    >
      Undo
    </button>
  );
}
```

with, beside `cardLayerId` above:

```ts
// §6.2's block on a derived layer that has since been used. Null for a
// This-layer run, whose Undo has its own rules.
const undoBlock = newLayerUndoBlock(run);
```

- [ ] **Step 11: Turn six tools' `"new"` destination on, and add A7 to the log**

1. In `src/features/processing/toolRegistry.ts`, change

```ts
    destinations: ["layer"],
```

to

```ts
    destinations: ["layer", "new"],
```

on **`roof-metrics`, `measure-solids`, `validate-solids`, `height-from-extent`, `join-by-location` and `distance-to-nearest`** — every implemented tool whose `target` is `"city"`. `aggregate-per-area` keeps `["layer"]`; Task 23 flips it.

2. **[adapted copy A7]** in the log header. In `src/ui/processing/LogView.tsx`, find:

```tsx
  const params = Object.entries(run.params);
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Tool", toolById(run.toolId).name],
    ["Target layer", run.targetName],
```

and replace with:

```tsx
  const params = Object.entries(run.params);
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Tool", toolById(run.toolId).name],
    ["Target layer", targetLayerLine(run)],
```

where `targetLayerLine` is a PURE helper in `src/ui/processing/runFormat.ts` (whose own header promises "Pure formatting … kept out of the components so the strings can be asserted without rendering" — so it takes the parent, it does not look it up):

```ts
/**
 * §6.4's `Target layer` row.
 *
 * A DERIVED layer's name says nothing about where its rows came from, and
 * §6.4's header is "the reproducible record of the run: a planner can read it
 * back and rerun by hand" — so the parent travels with it. [adapted copy A7].
 *
 * `derivedFrom` is passed IN rather than read from the layer store: this
 * module is pure, and the name it carries is the copy recorded at publication,
 * so the line stays right after the parent is renamed or removed.
 */
export function targetLayerLine(
  run: RunRecord,
  derivedFrom: DerivedFrom | null,
): string {
  return derivedFrom === null
    ? run.targetName
    : `${run.targetName} · Derived from ${derivedFrom.layerName}`;
}
```

with `import type { DerivedFrom } from "../../features/layers/layerStore";` at the top. `formatRunLog` takes the same second argument:

```ts
export function formatRunLog(run: RunRecord): string {
```

becomes

```ts
export function formatRunLog(
  run: RunRecord,
  derivedFrom: DerivedFrom | null,
): string {
```

and

```ts
lines.push(`Target layer: ${run.targetName}`);
```

becomes

```ts
lines.push(`Target layer: ${targetLayerLine(run, derivedFrom)}`);
```

`LogView` does the ONE lookup and hands it to both. Above the `rows` array:

```tsx
const derivedFrom =
  useLayerStore.getState().layers.find((l) => l.id === run.targetLayerId)
    ?.derivedFrom ?? null;
```

then `["Target layer", targetLayerLine(run, derivedFrom)]` and, in the Copy handler, `formatRunLog(run, derivedFrom)`. Its one other caller — `tests/unit/ui/processing/LogView.test.tsx` — passes `null`.

- [ ] **Step 12: Run everything, then the whole suite**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task22.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS; `tsc` clean; `vp check` 0 errors / 56 warnings; `suite: 0`. Every `RunRecord` fixture in `tests/` needs `destination: "layer", newLayerId: null` — `tsc` names them (`ToolView.test.tsx`, `RecentRuns.test.tsx`, `LogView.test.tsx`, `engineStopped.test.tsx`, `runQueue.test.ts`, `roofMetricsRun.test.ts`).

- [ ] **Step 13: Commit**

```bash
git add src/features/processing/runQueue.ts \
  src/features/processing/types.ts \
  src/features/processing/toolRegistry.ts \
  src/ui/processing/RunFooter.tsx \
  src/ui/processing/LogView.tsx \
  src/ui/processing/runFormat.ts \
  src/ui/shell/shellStore.ts \
  src/app/App.tsx \
  tests/
git commit -m "feat: a run can write its results to a new derived layer"
```
