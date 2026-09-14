### Task 25: Engine death off the table FIFO

**Files:**

- Modify: `src/insights/duckdb.ts`, `src/insights/layerTables.ts` (`retryEngine`).
- Modify: `src/features/processing/runQueue.ts` (`undoRun`).
- Test: create `tests/unit/features/processing/engineDeath.test.ts`; add to `tests/unit/insights/duckdbEngine.test.ts` (its `bootEngine()` harness gains a `hangWhen` hook) and to `tests/unit/insights/layerTablesBuild.test.ts` (which already owns `retryEngine`).
- **The index lists `tests/unit/features/processing/runQueue.test.ts` here** for "its `onEngineDeath` stub becomes a real listener set". Verified on `develop` @ `55e4e00`: that factory ALREADY registers into a real `deathListeners` set (`runQueue.test.ts`'s `const deathListeners = new Set<() => void>();` and the `onEngineDeath: vi.fn((listener) => { deathListeners.add(listener); … })` beside it), so the ledger's concern is already met and this task changes nothing there. Confirm with `grep -rn "onEngineDeath: vi.fn(() => () => {})" tests/` — any suite that still has the inert stub AND drives a death gets the same set in this commit.

**Interfaces:** No new exports and no mock sweep. `runQuery`, `ddl`, `queryDuckDB`, `registerBuffer`, `readFile` and `dropBuffer` race their in-flight await against the module-local death and return their ordinary failure value. `retryEngine` captures `getEngineGeneration()` **after `bootEngine()` has started** — a boot bumps the generation itself (`duckdb.ts:405`, `doInit`'s `const gen = ++generation`, which runs synchronously before its first await), so a number taken BEFORE the call would differ from the live one after every successful boot and the retry would abandon the rebuild it exists for. `undoRun`'s post-commit `EngineDeadError` catch short-circuits before the model publication, the provenance rollback and the `"Undone"` card.

**Intent:** Closes the M2 roadmap's "runQuery callers outside the queue never settle", its "retryEngine carries no generation check", and the parked `undoRun` residual — with one change in the primitive rather than three copies of `layerTables`' shadowing. `dropBuffer` is on the list because both `release()` paths await it from a `finally` inside a FIFO slot. The regression a reviewer must see: a never-settling request, killed by a death, leaves the export dialog, the layer counts and the median with a MESSAGE, and the run queue still reads `"Analytics engine stopped"` by the `EngineDeadError` path — because the inner listener resolves a microtask while `raced`'s rejects synchronously. **The `undoRun` test needs a controllable death.** `runQueue.test.ts` mocks `insights/duckdb`, and its `onEngineDeath` stub is inert (`() => () => {}`), so nothing can drive the post-commit path; the factory's `onEngineDeath` must become a real listener set the test fires, in this task's commit. A reviewer rejects it for changing a run's failure text, for adding a fourth copy of the race, or for a test that resolves the blocked request itself.

- [ ] **Step 1: Write the failing test for the primitives**

These cases exercise the REAL `duckdb.ts` against a fake `@duckdb/duckdb-wasm`, and `tests/unit/insights/duckdbEngine.test.ts` already has the harness for exactly that: `bootEngine()` builds a module instance whose `AsyncDuckDB` connects to a recording fake connection. Extend that harness rather than writing a second one.

First the hook, inside `bootEngine`. Its `connection.query` currently begins:

```ts
  const connection = {
    query: async (statement: string) => {
      sql.push(statement);
      if (failMatch(statement)) throw new Error(EXTENSION_REFUSED);
```

Add a HANG alongside the existing FAIL — a statement that matches never settles, which is exactly what duckdb-wasm does to a request caught by the worker's death:

```ts
  let hangMatch: (sql: string) => boolean = () => false;
  /** Never-settling promises the harness hands out. Held so a case can assert
   *  it never resolved them itself — the death, and only the death, ends them. */
  const forever = <T>(): Promise<T> => new Promise<T>(() => {});

  const connection = {
    query: async (statement: string) => {
      sql.push(statement);
      if (hangMatch(statement)) return await forever<unknown>();
      if (failMatch(statement)) throw new Error(EXTENSION_REFUSED);
```

with the same three VFS methods on the fake `AsyncDuckDB`, which it does not have today:

```ts
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return connection;
      }
      async registerFileBuffer(name: string) {
        return hangMatch(`register:${name}`) ? await forever<void>() : undefined;
      }
      async copyFileToBuffer(name: string) {
        return hangMatch(`read:${name}`)
          ? await forever<Uint8Array>()
          : new Uint8Array();
      }
      async dropFile(name: string) {
        return hangMatch(`drop:${name}`) ? await forever<void>() : undefined;
      }
    },
```

and `hangWhen` beside `failWhen` on the returned `EngineHarness`:

```ts
interface EngineHarness {
  readonly engine: typeof import("../../../src/insights/duckdb");
  readonly sql: string[];
  readonly failWhen: (match: (sql: string) => boolean) => void;
  /**
   * Make matching work NEVER SETTLE, the way duckdb-wasm strands a request its
   * worker died under (`onError` clears the pending map without rejecting).
   * Statements match on their SQL; the three VFS calls match on
   * `register:<name>` / `read:<name>` / `drop:<name>`.
   */
  readonly hangWhen: (match: (key: string) => boolean) => void;
}
```

Then the cases, as a new `describe` in the same file:

```ts
describe("a primitive caught by the engine's death", () => {
  it("settles `runQuery` with the ordinary failure message", async () => {
    const h = await bootEngine();
    h.hangWhen((key) => key === "SELECT 1");
    // NEVER resolved by this test — the whole point is that the death, and
    // nothing else, is what ends the await.
    const pending = h.engine.runQuery("SELECT 1");
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Analytics engine stopped",
    });
  });

  it("settles `ddl` the same way, since it IS `runQuery`", async () => {
    const h = await bootEngine();
    h.hangWhen((key) => key.startsWith("CREATE"));
    const pending = h.engine.ddl("CREATE TABLE t (a INT)");
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toMatchObject({ ok: false });
  });

  it("settles `queryDuckDB` with its own contract, null", async () => {
    // Swallow-to-null is already this function's contract; its two legacy
    // callers (`stacItems`, the old stats path) hang the same way without it.
    const h = await bootEngine();
    h.hangWhen((key) => key === "SELECT 1");
    const pending = h.engine.queryDuckDB("SELECT 1");
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toBeNull();
  });

  it("settles `registerBuffer` false", async () => {
    const h = await bootEngine();
    h.hangWhen((key) => key === "register:x.json");
    const pending = h.engine.registerBuffer("x.json", new Uint8Array([1]));
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toBe(false);
  });

  it("settles `readFile` null", async () => {
    const h = await bootEngine();
    h.hangWhen((key) => key === "read:y.parquet");
    const pending = h.engine.readFile("y.parquet");
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toBeNull();
  });

  it("settles `dropBuffer`, which a run's `finally` awaits inside the FIFO", async () => {
    // The easiest one to miss: its body is `await db.dropFile(name).catch(…)`,
    // which swallows a REJECTION and does nothing about a promise that never
    // settles — and `readSource.release()` and `VectorTableHandle.release()`
    // both await it from a `finally` INSIDE the run's queue slot. A death
    // during cleanup would strand the queue for the life of the page.
    const h = await bootEngine();
    h.hangWhen((key) => key === "drop:x.json");
    const pending = h.engine.dropBuffer("x.json");
    h.engine.markEngineDead("worker gone");
    await expect(pending).resolves.toBeUndefined();
  });

  it("lets `EngineDeadError` still win inside `raced` (§6.1's sentence)", async () => {
    // `markEngineDead` dispatches its listeners SYNCHRONOUSLY in registration
    // order. In `raced(runQuery(sql), signal)` the inner listener registers
    // FIRST and RESOLVES a promise (a microtask); the outer one REJECTS
    // `raced`'s promise synchronously — so a run still reads "Analytics engine
    // stopped" by the `EngineDeadError` path and not by the `ok: false` one.
    // Pinned rather than asserted in prose.
    const h = await bootEngine();
    const { raced, EngineDeadError } =
      await import("../../../src/insights/engineAwait");
    h.hangWhen((key) => key === "SELECT 1");
    const pending = raced(h.engine.runQuery("SELECT 1"), null);
    h.engine.markEngineDead("worker gone");
    await expect(pending).rejects.toBeInstanceOf(EngineDeadError);
  });

  it("still returns the not-running message when the engine was ALREADY dead", async () => {
    // `onEngineDeath` fires once per engine and drops its waiters, so a race
    // STARTED after the death hears nothing — which is why every primitive
    // also has to answer immediately on its own. That guard is unchanged.
    const h = await bootEngine();
    h.engine.markEngineDead("worker gone");
    await expect(h.engine.runQuery("SELECT 1")).resolves.toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
  });
});
```

**`engineAwait` must be imported through the same module instance**, which is why the `raced` case uses a dynamic `await import` after `bootEngine()`'s `vi.resetModules()`: a top-level import would hold `onEngineDeath` from a DIFFERENT module registry and hear no death at all.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/duckdbEngine.test.ts
```

Expected: FAIL — every case times out, because the awaits never settle. That timeout IS the bug.

- [ ] **Step 3: Add ONE module-local race inside `duckdb.ts`**

In `src/insights/duckdb.ts`, beside `markEngineDead` and `onEngineDeath` — they are already in this module, so there is no import cycle with `engineAwait.ts` and no second copy of the race:

```ts
/** Spec §6.1's sentence for work the engine's death took. Local, because this
 *  module cannot import `engineAwait` (which imports IT). */
const ENGINE_STOPPED = "Analytics engine stopped";

/**
 * Settle an in-flight engine await when the worker dies under it.
 *
 * THE HAZARD, precisely: duckdb-wasm's own `onError` does
 * `this._pendingRequests.clear()` without rejecting, and once the worker is
 * gone `postTask` logs and returns `undefined` — so a request caught by the
 * death never settles at all. `layerTables.ts` already solves this for its own
 * calls by shadowing each primitive with `racedWithDeath`; putting the race in
 * the PRIMITIVE fixes every other caller at once, with no call-site edit, no
 * new export and no mock-factory sweep — and every future caller by default,
 * which is what a hazard with no visible symptom needs.
 *
 * It returns the primitive's ORDINARY failure value, so the six callers that
 * already handle a failure (the export dialog and writer, the layer counts, the
 * grid query, the map-filter sync, the Stats tab, `RunFooter`'s median) settle
 * with a message instead of hanging, unchanged.
 *
 * Note what this does NOT change: `raced`'s own death listener is registered
 * AFTER this one (its promise argument is evaluated first), and `markEngineDead`
 * dispatches synchronously in registration order — so in `raced(runQuery(sql))`
 * the inner listener resolves a microtask while the outer REJECTS
 * synchronously, and `EngineDeadError` still wins. The run queue's behaviour is
 * therefore unchanged, and Task 25's test pins that ordering.
 */
function settleOnDeath<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const stop = onEngineDeath(() => {
      resolve(fallback);
    });
    promise.then(
      (value) => {
        stop();
        resolve(value);
      },
      () => {
        stop();
        resolve(fallback);
      },
    );
  });
}
```

Then wrap each primitive's ONE await. `runQuery`:

```ts
export async function runQuery(sql: string): Promise<QueryOutcome> {
  if (!conn || status.state !== "ready") {
    return { ok: false, message: NOT_RUNNING };
  }
  try {
    const { columns, rows } = toRows(await conn.query(sql));
    return { ok: true, columns, rows };
  } catch (error) {
    return { ok: false, message: formatDuckDBError(error) };
  }
}
```

becomes

```ts
export async function runQuery(sql: string): Promise<QueryOutcome> {
  if (!conn || status.state !== "ready") {
    return { ok: false, message: NOT_RUNNING };
  }
  const live = conn;
  return await settleOnDeath(
    (async (): Promise<QueryOutcome> => {
      try {
        const { columns, rows } = toRows(await live.query(sql));
        return { ok: true, columns, rows };
      } catch (error) {
        return { ok: false, message: formatDuckDBError(error) };
      }
    })(),
    { ok: false, message: ENGINE_STOPPED },
  );
}
```

(`const live = conn` because `markEngineDead` nulls `conn` before the await resumes, and the inner function would otherwise re-read a null.) `ddl` is `runQuery`, so it inherits this untouched.

`queryDuckDB`:

```ts
export async function queryDuckDB(sql: string): Promise<QueryResult | null> {
  if (!conn || status.state !== "ready") return null;
  try {
    return toRows(await conn.query(sql));
  } catch {
    return null;
  }
}
```

becomes

```ts
export async function queryDuckDB(sql: string): Promise<QueryResult | null> {
  if (!conn || status.state !== "ready") return null;
  const live = conn;
  return await settleOnDeath(
    (async (): Promise<QueryResult | null> => {
      try {
        return toRows(await live.query(sql));
      } catch {
        return null;
      }
    })(),
    // Swallow-to-null is already this function's contract; its two legacy
    // callers (`stacItems`, the old stats path) hang the same way without it.
    null,
  );
}
```

`registerBuffer` (`duckdb.ts:724-739`) becomes — the `const live = db` for the reason `runQuery` has its `const live = conn`, and its doc comment kept verbatim:

```ts
export async function registerBuffer(
  name: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!db || status.state !== "ready") return false;
  const live = db;
  return await settleOnDeath(
    (async (): Promise<boolean> => {
      try {
        await live.registerFileBuffer(name, bytes);
        return true;
      } catch (error) {
        console.warn(`DuckDB could not register "${name}":`, error);
        return false;
      }
    })(),
    false,
  );
}
```

`readFile` (`:746-756`) becomes:

```ts
export async function readFile(name: string): Promise<Uint8Array | null> {
  if (!db || status.state !== "ready") return null;
  const live = db;
  return await settleOnDeath(
    (async (): Promise<Uint8Array | null> => {
      try {
        return await live.copyFileToBuffer(name);
      } catch (error) {
        console.warn(`DuckDB could not read "${name}":`, error);
        return null;
      }
    })(),
    null,
  );
}
```

and `dropBuffer`:

```ts
export async function dropBuffer(name: string): Promise<void> {
  if (!db) return;
  await db.dropFile(name).catch(() => {});
}
```

becomes

```ts
export async function dropBuffer(name: string): Promise<void> {
  if (!db) return;
  // On the list for the reason that is easiest to miss: the `.catch` swallows a
  // REJECTION and does nothing about a promise that never settles — and both
  // `release()` paths await this from a `finally` INSIDE the run's FIFO slot.
  await settleOnDeath(
    db.dropFile(name).catch(() => undefined),
    undefined,
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights
```

Expected: PASS, and every existing `duckdb` suite unchanged — the wrappers only add a branch that nothing but a death takes.

- [ ] **Step 5: Write the failing test for `retryEngine`'s generation check**

`tests/unit/insights/layerTablesBuild.test.ts` already owns `retryEngine` (four cases) AND already mocks the engine's generation (`engineGeneration`, `getEngineGeneration: vi.fn(() => engineGeneration)`), so the new case goes there. Add, beside `"retryEngine does nothing while the engine is STILL down"`:

```ts
it("retryEngine REBUILDS across an ordinary boot — a boot is not a death", async () => {
  // THE REGRESSION THIS PAIR EXISTS FOR. A real boot bumps the generation
  // itself, synchronously, before its first await (`doInit`'s
  // `const gen = ++generation`, `duckdb.ts:405`) — so a check that captured
  // the number BEFORE `bootEngine()` would see it move on every successful
  // Retry and skip every parked rebuild, leaving those layers table-less for
  // the session with no error anywhere.
  engineReady = false;
  await enqueueLayerTable("L1", readerSource());
  expect(stateOf("L1")).toMatchObject({ state: "failed" });
  sql.length = 0;

  engineReady = true;
  await retryEngine();

  expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
});

it("…and ABANDONS them when a DEATH moved the engine under the boot", async () => {
  // `bootEngine` takes ~5 s for a 36 MB wasm module, and a worker can die
  // inside that window. Rebuilding into an engine that has already gone
  // writes `ready` entries over the invalidation — the exact state the
  // catalogue would then offer tools against.
  engineReady = false;
  await enqueueLayerTable("L1", readerSource());
  sql.length = 0;

  // The boot runs (and bumps the generation, as a boot does); a death lands
  // DURING it and bumps it again. Only that second move is a reason to stop.
  engineReady = true;
  bootAlso = () => {
    engineGeneration += 1;
  };
  await retryEngine();

  expect(sql).toEqual([]);
  expect(getLayerTable("L1")).toBeNull();
});

it("still re-parks the source when it abandons, so the NEXT Retry works", async () => {
  // The generation check returns BEFORE `pendingSources.clear()`, which is
  // the whole reason the two guards are in that order: a death during the
  // boot must not cost the user their parked source.
  engineReady = false;
  await enqueueLayerTable("L1", readerSource());
  engineReady = true;
  bootAlso = () => {
    engineGeneration += 1;
  };
  await retryEngine();

  // Second Retry, same engine this time.
  bootAlso = () => {};
  await retryEngine();
  expect(getLayerTable("L1")).toMatchObject({ table: "layer_1" });
});
```

with the existing `initDuckDB` mock made to behave like a real boot, so the first case is a real test of the check rather than of a stub that stands still. Find:

```ts
    initDuckDB: vi.fn(async () => {
```

and make its body begin:

```ts
    initDuckDB: vi.fn(async () => {
      // A REAL boot bumps the generation SYNCHRONOUSLY, before its first await
      // (`doInit`, `duckdb.ts:405`) — so it has already happened by the time
      // `retryEngine` reads the number. That ordering is exactly what the
      // check is written against, so the mock reproduces it.
      engineGeneration += 1;
      // The boot's first await. Everything after it happens DURING the boot,
      // which is where a worker death would land — `bootAlso` is how a case
      // puts one there, and a bump before this line would be part of the boot
      // rather than a death inside it.
      await Promise.resolve();
      bootAlso();
```

with the fixture beside `engineGeneration`:

```ts
/** What a case wants the BOOT itself to do — used to move the engine
 *  generation a SECOND time, under `retryEngine`'s await. */
let bootAlso: () => void = () => {};
```

reset to `() => {}` in the suite's `beforeEach`. The suite's four existing `retryEngine` cases are the regression guard for the bump: they rebuild across a boot and must stay green. They should be — a build captures its engine at ENQUEUE and RE-captures it after its own `initDuckDB()` await (`layerTables.ts:954`, `:1084`), so a bump inside the boot is never compared against a number taken before it. If one of them does go red, the mock is too eager and not the code: bump only on the `not ready → ready` transition, which is what the real memo does (`initDuckDB` re-runs `doInit` only when `initPromise` is null, `duckdb.ts:526-531`).

- [ ] **Step 6: Write the failing test for `undoRun`'s post-commit death**

Create `tests/unit/features/processing/engineDeath.test.ts`. It needs a controllable death AND a real `computedColumns` (the Undo's statements are what the death interrupts), so the factories are written out rather than shared:

```ts
/**
 * The last group-D residual: what `undoRun` does when the engine dies at its
 * post-commit re-DESCRIBE.
 *
 * It currently falls THROUGH the `EngineDeadError` and publishes the restored
 * model, the provenance rollback and the "Undone" card — for a transaction that
 * never committed, because the database went with it. `execute`'s equivalent
 * catch is right to abandon its DESCRIBE (its COMMIT went through and its
 * columns are on a table that exists); this one is not the same situation.
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

const { submitRun, undoRun } =
  await import("../../../../src/features/processing/runQueue");
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

beforeEach(() => {
  delete EXECUTORS["roof-metrics"];
  sql.length = 0;
  hang = null;
  liveColumns = ["id", "feature_id"];
  deathListeners.clear();
  useLayerStore.setState({ layers: [layer()] });
  useComputedColumnStore.setState({ byLayer: {} });
  useProcessingStore.getState().resetForTest();
  registerExecutor("height-from-extent", async () => ({
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([["a", { extent_height_m: 9 }]]),
    measured: 1,
    skipped: [],
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("undoRun when the engine dies at the post-commit re-DESCRIBE", () => {
  it("publishes NOTHING: not the model, not the provenance, not the card", async () => {
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(attributesOf("a")["extent_height_m"]).toBe(9);

    // The undo's TRANSACTION goes through; the re-DESCRIBE after it is the
    // await the death takes.
    hang = "DESCRIBE";
    const undoing = undoRun(id);
    await vi.waitFor(() =>
      expect(sql.some((s) => s.startsWith("DESCRIBE"))).toBe(true),
    );
    for (const listener of [...deathListeners]) listener();
    await undoing;

    // The model keeps the run's values — nothing was restored, because nothing
    // can be verified as restored, and the table the restore describes is gone.
    expect(attributesOf("a")["extent_height_m"]).toBe(9);
    expect(computedColumnsOf("L1").has("extent_height_m")).toBe(true);
    expect(runById(id)?.note).not.toBe("Undone");
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
```

**`runQueue.test.ts` needs nothing for this**, and that is worth verifying rather than assuming: the ledger's concern was an inert `onEngineDeath` stub, and on `develop` @ `55e4e00` that factory already registers into a real `deathListeners` set. Check it by reading those two blocks, and run `grep -rn "onEngineDeath: vi.fn(() => () => {})" tests/` — any suite that still has the inert stub AND drives a death gets the same set in this commit.

- [ ] **Step 7: Short-circuit `undoRun`'s post-commit death**

In `src/features/processing/runQueue.ts`, find:

```ts
if (undone.ok) {
  try {
    await raced(refreshLayerTableColumns(run.targetLayerId), null);
  } catch (error) {
    // Past the COMMIT, exactly as in `execute`: the Undo went through, so a
    // DESCRIBE that will never answer is abandoned rather than allowed to
    // withhold the restore below.
    if (!(error instanceof EngineDeadError)) throw error;
  }
}
return undone;
```

and replace with:

```ts
if (undone.ok) {
  try {
    await raced(refreshLayerTableColumns(run.targetLayerId), null);
  } catch (error) {
    if (!(error instanceof EngineDeadError)) throw error;
    // NOT a fall-through any more. `execute`'s equivalent catch is right to
    // abandon the DESCRIBE — its COMMIT went through and its columns are on
    // a table that exists. Here the database itself is gone: the restored
    // values describe a table nobody can read, and publishing the model,
    // the provenance rollback and the "Undone" card would tell the user
    // their layer had been put back when the layer's table no longer
    // exists. The death watcher's own card is the truth (§6.1's "Analytics
    // engine stopped"), and the run keeps its `undoable: false` from it.
    return null;
  }
}
return undone;
```

`null` is already the "publish nothing" signal at this call site (`if (out === null) return;` in `undoRun`), so no other line changes.

- [ ] **Step 8: Give `retryEngine` its generation check**

In `src/insights/layerTables.ts`, find:

```ts
export async function retryEngine(): Promise<void> {
  // `bootEngine`, NOT this module's raced `initDuckDB`: both callers are
  // `void retryEngine()` (`App.tsx`), so a rejection here would be an unhandled
  // one — and there is nothing for a death to release anyway. Every build this
  // function starts is raced on its own, inside the queue, where a release
  // actually frees something.
  await bootEngine();
  if (getDuckDBStatus().state !== "ready") return;
```

and replace with:

```ts
export async function retryEngine(): Promise<void> {
  // `bootEngine`, NOT this module's raced `initDuckDB`: both callers are
  // `void retryEngine()` (`App.tsx`), so a rejection here would be an unhandled
  // one — and there is nothing for a death to release anyway. Every build this
  // function starts is raced on its own, inside the queue, where a release
  // actually frees something.
  //
  // STARTED FIRST, AND THE GENERATION READ AFTER. A boot bumps the counter
  // itself — `doInit` opens with `const gen = ++generation` (`duckdb.ts:405`),
  // which runs synchronously, before its first await and therefore before this
  // line — so the number below is the engine this retry is FOR, whether
  // `bootEngine()` started a new one or handed back the memo of a live one. A
  // number captured BEFORE the call would differ after every real boot, and
  // the retry would skip the rebuilds it exists for, leaving those layers
  // table-less for the session with no error anywhere.
  const booting = bootEngine();
  const engine = getEngineGeneration();
  await booting;
  // Only a LATER move — a worker that died inside the ~5 s boot window, or an
  // engine replaced under it — is a reason to stop. Rebuilding into an engine
  // that has already gone writes `ready` entries over the invalidation, which
  // is the exact state the catalogue would then offer tools against. The
  // builds below each check `engineGone()` for themselves, but the retry's own
  // `pendingSources.clear()` below them is not undone by that.
  if (getEngineGeneration() !== engine) return;
  if (getDuckDBStatus().state !== "ready") return;
```

**The order of the two guards matters.** The generation check comes FIRST and returns before `pendingSources` is cleared, so a death during the boot leaves every parked source parked and the next Retry has something to retry — which is the whole reason `retryEngine` keeps them.

- [ ] **Step 9: Run everything and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights tests/unit/features/processing
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task25.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS throughout (`suite: 0`), and **no run's failure text changes** — `engineStopped.test.tsx` and `runQueue.test.ts`'s death cases are the regression to watch.

```bash
git add src/insights/duckdb.ts src/insights/layerTables.ts \
  src/features/processing/runQueue.ts tests/
git commit -m "fix: every engine await settles when the worker dies"
```
