/**
 * The engine module's contracts that hold WITHOUT a live DuckDB: the error
 * formatter, and every entry point's "not initialized" answer. Anything that
 * needs a real database is covered by the opt-in integration suite.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ddl,
  dropBuffer,
  ensureExtension,
  formatDuckDBError,
  getDuckDBStatus,
  isExtensionLoaded,
  readFile,
  registerBuffer,
  runQuery,
} from "../../../src/insights/duckdb";

describe("formatDuckDBError", () => {
  it("keeps the first useful line and strips the LINE/caret block", () => {
    const raw = new Error(
      'Binder Error: Referenced column "nope" not found!\n\nLINE 1: SELECT "nope" FROM t\n               ^',
    );
    expect(formatDuckDBError(raw)).toBe(
      'Binder Error: Referenced column "nope" not found!',
    );
  });

  it("keeps a multi-sentence first paragraph intact", () => {
    const raw = new Error(
      "Binder Error: LOD '1.2' not found in file. Available LODs: 2.2\n\nLINE 1: SELECT 1\n        ^",
    );
    expect(formatDuckDBError(raw)).toBe(
      "Binder Error: LOD '1.2' not found in file. Available LODs: 2.2",
    );
  });

  it("falls back to a sentence for an empty message", () => {
    expect(formatDuckDBError(new Error(""))).toBe("The query failed.");
  });

  it("stringifies a non-Error", () => {
    expect(formatDuckDBError("boom")).toBe("boom");
  });
});

describe("init failure", () => {
  it("terminates the Worker it created and lets a retry re-run init", async () => {
    // A fresh module registry, because `initDuckDB` memoises and this suite's
    // other tests share the singleton.
    vi.resetModules();

    const terminate = vi.fn();
    let instantiateCalls = 0;
    vi.doMock("@duckdb/duckdb-wasm", () => ({
      selectBundle: vi.fn(async () => ({
        mainModule: "m.wasm",
        mainWorker: "https://cdn.test/w.js",
      })),
      getJsDelivrBundles: vi.fn(() => ({})),
      ConsoleLogger: class {},
      LogLevel: { WARNING: 2 },
      AsyncDuckDB: class {
        async instantiate() {
          instantiateCalls += 1;
          throw new Error("wasm refused");
        }
      },
    }));
    class FakeWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);

    // Imported BEFORE `URL` is stubbed: vitest's own module runner calls
    // `new URL(...)` while resolving a dynamic import, and the object stub
    // below is not constructible.
    const engine = await import("../../../src/insights/duckdb");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => {},
    });
    await engine.initDuckDB();

    expect(engine.getDuckDBStatus().state).toBe("failed");
    // The Worker must not outlive the failed init: a Retry creates a second
    // one, and a zombie beside it holds a 36 MB wasm heap forever.
    expect(terminate).toHaveBeenCalledTimes(1);

    // The memo was cleared, so this really re-runs rather than handing back
    // the already-settled promise.
    await engine.initDuckDB();
    expect(instantiateCalls).toBe(2);
    expect(terminate).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
    vi.doUnmock("@duckdb/duckdb-wasm");
    vi.resetModules();
  });
});

/** A fake Arrow table. The engine reads only `numRows`, `schema.fields` and
 *  `getChild(name).get(i)`, so that is all this supplies. */
function arrow(rows: ReadonlyArray<Record<string, unknown>>) {
  return {
    numRows: rows.length,
    schema: { fields: Object.keys(rows[0] ?? {}).map((name) => ({ name })) },
    getChild: (name: string) => ({ get: (i: number) => rows[i]?.[name] }),
  };
}

interface EngineHarness {
  readonly engine: typeof import("../../../src/insights/duckdb");
  /** Every statement the engine sent, in order. */
  readonly sql: string[];
  /** Make matching statements throw, e.g. the next INSTALL. */
  readonly failWhen: (match: (sql: string) => boolean) => void;
  /**
   * Make matching work NEVER SETTLE, the way duckdb-wasm strands a request its
   * worker died under (`onError` clears the pending map without rejecting).
   * Statements match on their SQL; the three VFS calls match on
   * `register:<name>` / `read:<name>` / `drop:<name>`.
   */
  readonly hangWhen: (match: (key: string) => boolean) => void;
}

const EXTENSION_REFUSED = "Catalog Error: extension is not available";

/**
 * A module instance whose `AsyncDuckDB` connects to a fake connection that
 * RECORDS its SQL. It is the only way to pin the INSTALL spellings: `spatial`
 * is a CORE extension and `INSTALL spatial FROM community` fails outright
 * against a real DuckDB, so a regression here is invisible until a browser.
 */
async function bootEngine(): Promise<EngineHarness> {
  vi.resetModules();

  const sql: string[] = [];
  // What `duckdb_extensions()` reports; a successful LOAD adds to it, the way
  // a real database would.
  const loaded = new Set<string>(["parquet"]);
  let failMatch: (sql: string) => boolean = () => false;
  let hangMatch: (sql: string) => boolean = () => false;
  /** Never-settling promises the harness hands out. Held so a case can assert
   *  it never resolved them itself — the death, and only the death, ends them. */
  const forever = <T>(): Promise<T> => new Promise<T>(() => {});

  const connection = {
    query: async (statement: string) => {
      sql.push(statement);
      if (hangMatch(statement)) return await forever<unknown>();
      if (failMatch(statement)) throw new Error(EXTENSION_REFUSED);
      const load = /^LOAD (\w+)$/.exec(statement);
      if (load) loaded.add(load[1]!);
      if (statement === "PRAGMA platform") {
        return arrow([{ platform: "wasm_eh" }]);
      }
      if (statement.startsWith("SELECT extension_name")) {
        return arrow(
          [...loaded].map((name) => ({
            extension_name: name,
            extension_version: "1.0",
          })),
        );
      }
      return arrow([]);
    },
  };

  vi.doMock("@duckdb/duckdb-wasm", () => ({
    selectBundle: vi.fn(async () => ({
      mainModule: "m.wasm",
      mainWorker: "https://cdn.test/w.js",
    })),
    getJsDelivrBundles: vi.fn(() => ({})),
    ConsoleLogger: class {},
    LogLevel: { WARNING: 2 },
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return connection;
      }
      async registerFileBuffer(name: string) {
        return hangMatch(`register:${name}`)
          ? await forever<void>()
          : undefined;
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
  }));
  vi.stubGlobal(
    "Worker",
    class {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    },
  );

  // Imported before `URL` is stubbed, and unstubbed again the moment init is
  // done — see the init-failure test for why the object stub cannot be live
  // across a dynamic import.
  const engine = await import("../../../src/insights/duckdb");
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  await engine.initDuckDB();
  vi.unstubAllGlobals();

  sql.length = 0; // Init's own statements are not what these tests are about.
  return {
    engine,
    sql,
    failWhen: (match) => (failMatch = match),
    hangWhen: (match) => (hangMatch = match),
  };
}

describe("ensureExtension", () => {
  afterEach(() => {
    vi.doUnmock("@duckdb/duckdb-wasm");
    vi.resetModules();
  });

  it("installs spatial as a CORE extension, never FROM community", async () => {
    const { engine, sql } = await bootEngine();

    expect(await engine.ensureExtension("spatial")).toBe(true);
    expect(sql.slice(0, 2)).toEqual(["INSTALL spatial", "LOAD spatial"]);
    expect(sql.join(" | ")).not.toContain("FROM community");
    expect(engine.isExtensionLoaded("spatial")).toBe(true);

    // The tooltip list is re-read, so it names what was just loaded.
    const status = engine.getDuckDBStatus();
    expect(status.state).toBe("ready");
    if (status.state !== "ready") throw new Error("unreachable");
    expect(status.loadedExtensions.map((e) => e.name)).toContain("spatial");
    expect(status.extensions.spatial).toEqual({ state: "loaded" });
  });

  it("installs three_d from the community repo", async () => {
    const { engine, sql } = await bootEngine();

    expect(await engine.ensureExtension("three_d")).toBe(true);
    expect(sql.slice(0, 2)).toEqual([
      "INSTALL three_d FROM community",
      "LOAD three_d",
    ]);
  });

  it("costs one INSTALL for two concurrent calls", async () => {
    const { engine, sql } = await bootEngine();

    const [a, b] = await Promise.all([
      engine.ensureExtension("spatial"),
      engine.ensureExtension("spatial"),
    ]);

    expect([a, b]).toEqual([true, true]);
    expect(sql.filter((s) => s.startsWith("INSTALL"))).toEqual([
      "INSTALL spatial",
    ]);
    // And a third call after the fact is answered from the recorded state.
    expect(await engine.ensureExtension("spatial")).toBe(true);
    expect(sql.filter((s) => s.startsWith("INSTALL"))).toHaveLength(1);
  });

  it("records a failure in the status and retries on the next call", async () => {
    const { engine, sql, failWhen } = await bootEngine();
    failWhen((s) => s === "INSTALL spatial");
    const before = engine.getDuckDBStatus();

    expect(await engine.ensureExtension("spatial")).toBe(false);

    const failedStatus = engine.getDuckDBStatus();
    expect(failedStatus.state).toBe("ready");
    if (failedStatus.state !== "ready") throw new Error("unreachable");
    expect(failedStatus.extensions.spatial).toEqual({
      state: "failed",
      error: EXTENSION_REFUSED,
    });
    // Republished, not mutated: the status is a value React subscribes to.
    expect(failedStatus).not.toBe(before);
    expect(engine.isExtensionLoaded("spatial")).toBe(false);

    // The memo is per-attempt, so the next call really re-installs.
    failWhen(() => false);
    expect(await engine.ensureExtension("spatial")).toBe(true);
    expect(sql.filter((s) => s === "INSTALL spatial")).toHaveLength(2);
  });
});

describe("a primitive caught by the engine's death", () => {
  afterEach(() => {
    vi.doUnmock("@duckdb/duckdb-wasm");
    vi.resetModules();
  });

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

describe("engine entry points before init", () => {
  it("starts uninitialized with no extension loaded", () => {
    expect(getDuckDBStatus().state).toBe("uninitialized");
    expect(isExtensionLoaded("cityjson")).toBe(false);
    expect(isExtensionLoaded("spatial")).toBe(false);
  });

  it("runQuery reports a message rather than throwing", async () => {
    const outcome = await runQuery("SELECT 1");
    expect(outcome).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
  });

  it("ddl reports the same message", async () => {
    const outcome = await ddl("CREATE TABLE t (a INTEGER)");
    expect(outcome.ok).toBe(false);
  });

  it("registerBuffer answers false and dropBuffer is a no-op", async () => {
    expect(await registerBuffer("x.json", new Uint8Array([1, 2]))).toBe(false);
    await expect(dropBuffer("x.json")).resolves.toBeUndefined();
  });

  it("readFile answers null", async () => {
    expect(await readFile("x.parquet")).toBeNull();
  });

  it("ensureExtension answers false without a database", async () => {
    expect(await ensureExtension("spatial")).toBe(false);
  });
});
