/**
 * The engine module's contracts that hold WITHOUT a live DuckDB: the error
 * formatter, and every entry point's "not initialized" answer. Anything that
 * needs a real database is covered by the opt-in integration suite.
 */
import { describe, it, expect, vi } from "vitest";
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
} from "../../../src/analytics/duckdb";

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
      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);

    // Imported BEFORE `URL` is stubbed: vitest's own module runner calls
    // `new URL(...)` while resolving a dynamic import, and the object stub
    // below is not constructible.
    const engine = await import("../../../src/analytics/duckdb");
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
