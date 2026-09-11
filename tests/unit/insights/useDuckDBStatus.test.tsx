/**
 * `useDuckDBStatus` is the ONE React door to the engine's status (CLAUDE.md),
 * and `duckdb.ts` is the ONE publisher. Both are exercised for real here: the
 * fake sits at the `@duckdb/duckdb-wasm` boundary, so `doInit`, `loadExtension`
 * and `ensureExtension` all run their own code and every transition asserted
 * below is one the module actually published.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/** SQL the fake connection saw, which extensions it refuses, and whether the
 *  bundle selection itself fails (the boot-failure path). */
const queries: string[] = [];
const refuse = new Set<string>();
let failBundle = false;

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
      queries.push(sql);
      const named = /^(?:INSTALL|LOAD)\s+(\w+)/.exec(sql);
      if (named && refuse.has(named[1]!)) {
        throw new Error(`Extension "${named[1]!}" not found\nLINE 1: ${sql}`);
      }
      // `readPlatform` and `readLoadedExtensions` are best-effort and both
      // tolerate this shape (`getChild(...)?.get(0)`, `numRows`).
      return { getChild: () => null, numRows: 0 };
    }
  }
  return {
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return new FakeConnection();
      }
    },
    ConsoleLogger: class {},
    LogLevel: { WARNING: 2 },
    getJsDelivrBundles: () => ({}),
    selectBundle: async () => {
      if (failBundle) throw new Error("no bundle for this platform");
      return {
        mainWorker: "https://example.test/duckdb-worker.js",
        mainModule: "https://example.test/duckdb.wasm",
      };
    },
  };
});

// jsdom has neither of these, and `doInit` uses both to wrap the CDN worker.
class FakeWorker {
  terminate() {}
}

type DuckdbModule = typeof import("../../../src/insights/duckdb");
type HookModule = typeof import("../../../src/insights/useDuckDBStatus");
let duckdb: DuckdbModule;
let hook: HookModule;

beforeEach(async () => {
  queries.length = 0;
  refuse.clear();
  failBundle = false;
  vi.stubGlobal("Worker", FakeWorker);
  // `duckdb.ts` is a module singleton: a fresh copy per test is the only way
  // to observe a BOOT, which happens exactly once per module instance.
  vi.resetModules();
  duckdb = await import("../../../src/insights/duckdb");
  hook = await import("../../../src/insights/useDuckDBStatus");
  // Stubbed AFTER the dynamic imports (as `duckdbEngine.test.ts` does, for the
  // same reason): vitest's own module runner calls `new URL(...)` while
  // resolving an import, and this object stub is not constructible.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every state the module published, in order, for one test. */
function record(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const stop = duckdb.subscribeDuckDBStatus(() => {
    const status = duckdb.getDuckDBStatus();
    const suffix =
      status.state === "ready" ? `:${status.extensions.spatial.state}` : "";
    seen.push(`${status.state}${suffix}`);
  });
  return { seen, stop };
}

describe("duckdb.ts publishes every transition", () => {
  it("announces the boot: initializing, then ready", async () => {
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    stop();
    expect(seen).toEqual(["initializing", "ready:unloaded"]);
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    expect(queries).toContain("INSTALL cityjson FROM community");
  });

  it("announces a FAILED boot: initializing, then failed, once", async () => {
    // The fake's `selectBundle` is the first thing `doInit` awaits, so
    // rejecting it exercises the catch without touching the Worker shim.
    failBundle = true;
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    stop();
    expect(seen).toEqual(["initializing", "failed"]);
    const status = duckdb.getDuckDBStatus();
    expect(status.state).toBe("failed");
    if (status.state !== "failed") throw new Error("unreachable");
    expect(status.error).toContain("no bundle");
    // `doInit`'s catch clears the memo, so a Retry really retries.
    failBundle = false;
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
  });

  it("announces a lazy load: loading, then loaded", async () => {
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    await duckdb.ensureExtension("spatial");
    stop();
    expect(seen).toEqual(["ready:loading", "ready:loaded"]);
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
  });

  it("announces a lazy FAILURE: loading, then failed, with the reason", async () => {
    refuse.add("spatial");
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    const ok = await duckdb.ensureExtension("spatial");
    stop();
    expect(ok).toBe(false);
    expect(seen).toEqual(["ready:loading", "ready:failed"]);
    const status = duckdb.getDuckDBStatus();
    expect(status.state).toBe("ready");
    if (status.state !== "ready") throw new Error("unreachable");
    const spatial = status.extensions.spatial;
    expect(spatial.state).toBe("failed");
    if (spatial.state !== "failed") throw new Error("unreachable");
    // `formatDuckDBError` keeps the first line and drops the `LINE 1:` echo.
    expect(spatial.error).toBe('Extension "spatial" not found');
  });

  it("de-duplicates concurrent loads into ONE install", async () => {
    await duckdb.initDuckDB();
    queries.length = 0;
    await Promise.all([
      duckdb.ensureExtension("spatial"),
      duckdb.ensureExtension("spatial"),
      duckdb.ensureExtension("spatial"),
    ]);
    expect(queries.filter((q) => q === "INSTALL spatial")).toHaveLength(1);
  });

  it("lets a FAILED load be retried — the memo is cleared, not sticky", async () => {
    refuse.add("spatial");
    await duckdb.initDuckDB();
    expect(await duckdb.ensureExtension("spatial")).toBe(false);
    refuse.delete("spatial");
    const { seen, stop } = record();
    expect(await duckdb.ensureExtension("spatial")).toBe(true);
    stop();
    expect(seen).toEqual(["ready:loading", "ready:loaded"]);
  });

  it("publishes NOTHING when asked before the engine has booted", async () => {
    // `loadExtension` bails on a null connection before it writes anything, so
    // a pre-boot `ensureExtension` has always been a no-op — and it has to STAY
    // one. A `loading` written here has nothing to move it: the boot's own
    // `publishReady()` would then publish it, and §6.1's chip would read
    // "Loading the spatial extension…" for the rest of the session.
    const { seen, stop } = record();
    expect(await duckdb.ensureExtension("spatial")).toBe(false);
    stop();
    expect(seen).toEqual([]);
    expect(duckdb.getDuckDBStatusVersion()).toBe(0);
    expect(duckdb.getDuckDBStatus()).toEqual({ state: "uninitialized" });

    // …and no `loading` survives into the status the boot publishes.
    await duckdb.initDuckDB();
    const status = duckdb.getDuckDBStatus();
    if (status.state !== "ready") throw new Error("unreachable");
    expect(status.extensions.spatial.state).toBe("unloaded");
  });

  it("sends nothing to a listener that has unsubscribed", async () => {
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    stop();
    await duckdb.ensureExtension("spatial");
    expect(seen).toEqual([]);
    // …while a listener that stayed DOES hear the same transition.
    const after = record();
    await duckdb.ensureExtension("three_d");
    after.stop();
    expect(after.seen.length).toBeGreaterThan(0);
  });
});

function Probe() {
  const status = hook.useDuckDBStatus();
  const extra =
    status.state === "ready" ? `/${status.extensions.spatial.state}` : "";
  return <span data-testid="state">{`${status.state}${extra}`}</span>;
}

describe("useDuckDBStatus", () => {
  it("renders the state the module has, and re-renders on every transition", async () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("uninitialized");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    expect(screen.getByTestId("state").textContent).toBe("ready/unloaded");
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(screen.getByTestId("state").textContent).toBe("ready/loaded");
  });

  it("stops listening when the component unmounts", async () => {
    const view = render(<Probe />);
    await act(async () => {
      await duckdb.initDuckDB();
    });
    view.unmount();
    // No act() wrapper and no warning: nothing is subscribed any more, so this
    // transition must not schedule a React update at all.
    await duckdb.ensureExtension("spatial");
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
  });
});
