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
/** Holds every statement containing `needle` until `promise` settles, so a
 *  load can be caught in flight by the worker's death. */
let holdQuery: { needle: string; promise: Promise<void> } | null = null;
/** Holds `instantiate` the same way, so a BOOT can be caught in flight. */
let holdInstantiate: Promise<void> | null = null;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = () => {
      r();
    };
  });
  return { promise, resolve };
}

/** Fails the boot AFTER the Worker exists, which is the only way to watch
 *  `doInit`'s catch terminate it. */
let failInstantiate = false;
const terminations = { count: 0 };

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
      queries.push(sql);
      const held = holdQuery;
      if (held && sql.includes(held.needle)) await held.promise;
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
      async instantiate() {
        if (holdInstantiate) await holdInstantiate;
        if (failInstantiate) throw new Error("wasm refused");
      }
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

/** Every worker `doInit` constructed, so a test can kill the live one and can
 *  tell a Retry's fresh worker from the one that died. */
const workers: FakeWorker[] = [];

// jsdom has neither of these, and `doInit` uses both to wrap the CDN worker.
// The listener surface is real because `doInit` registers its own `error` and
// `messageerror` handlers on the worker it builds, and the only way to assert
// what happens when the engine dies is to fire one.
class FakeWorker {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor() {
    workers.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage() {}
  terminate() {
    terminations.count += 1;
  }
  /** What the browser does when the worker script dies. */
  die(message: string) {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ type: "error", message });
    }
  }
}

/** The worker the current engine is talking to. */
function liveWorker(): FakeWorker {
  const worker = workers.at(-1);
  if (!worker) throw new Error("no Worker was constructed");
  return worker;
}

type DuckdbModule = typeof import("../../../src/insights/duckdb");
type HookModule = typeof import("../../../src/insights/useDuckDBStatus");
let duckdb: DuckdbModule;
let hook: HookModule;

beforeEach(async () => {
  queries.length = 0;
  refuse.clear();
  failBundle = false;
  failInstantiate = false;
  holdQuery = null;
  holdInstantiate = null;
  terminations.count = 0;
  workers.length = 0;
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
  // Belt and braces for the `console.error` spies below: an assertion that
  // fails before their own `mockRestore()` would otherwise leave console.error
  // silenced for every test after it.
  vi.restoreAllMocks();
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

  it("isolates a THROWING listener: the boot finishes and the others still hear it", async () => {
    // A subscriber is an observer. `setStatus` is called from `doInit` — the
    // `initializing` publish is BEFORE its try — so an exception escaping a
    // listener would abort the boot with the status stranded at
    // `initializing`, and would also skip every listener after the thrower.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    duckdb.subscribeDuckDBStatus(() => {
      throw new Error("listener exploded");
    });
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    stop();
    expect(seen).toEqual(["initializing", "ready:unloaded"]);
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    expect(
      errors.mock.calls.some((call) =>
        call.some(
          (arg) => arg instanceof Error && arg.message === "listener exploded",
        ),
      ),
    ).toBe(true);
    errors.mockRestore();
  });

  it("isolates a THROWING listener on the FAILURE path: the Worker still dies", async () => {
    // The same exception on the `failed` publish would jump over the Worker
    // terminate and the memo reset in `doInit`'s catch, leaving a zombie wasm
    // heap and a rejected-once memo no Retry could clear.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    failInstantiate = true;
    duckdb.subscribeDuckDBStatus(() => {
      throw new Error("listener exploded");
    });
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("failed");
    expect(terminations.count).toBe(1);
    // …and the memo was still reset, so a Retry really retries.
    failInstantiate = false;
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    errors.mockRestore();
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

  it("publishes failed when the worker dies, and keeps the reason", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { seen, stop } = record();
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    liveWorker().die("Uncaught RuntimeError: memory access out of bounds");
    stop();
    expect(seen).toEqual(["initializing", "ready:unloaded", "failed"]);
    const status = duckdb.getDuckDBStatus();
    expect(status.state).toBe("failed");
    if (status.state !== "failed") throw new Error("unreachable");
    // The status bar prints this after "The analytics engine is not running"
    // (`TablePanel.tsx`), so it has to be the engine's own words.
    expect(status.error).toContain("memory access out of bounds");
    // The corpse holds a 36 MB wasm heap and nothing else can reach it any
    // more: `markEngineDead` drops the module's `db`, so this listener is the
    // last hand on the Worker. Same reason `doInit`'s catch terminates.
    expect(terminations.count).toBe(1);
    errors.mockRestore();
  });

  it("fails every statement fast once the engine is dead", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await duckdb.initDuckDB();
    liveWorker().die("worker gone");
    const outcome = await duckdb.runQuery("SELECT 1");
    // `runQuery` guards on the status, so nothing is posted to a worker that
    // is not there — which matters, because `postTask` would neither reject
    // nor resolve.
    expect(outcome).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
    });
    errors.mockRestore();
  });

  it("announces the death ONCE, however many events arrive", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await duckdb.initDuckDB();
    const { seen, stop } = record();
    liveWorker().die("first");
    liveWorker().die("second");
    stop();
    expect(seen).toEqual(["failed"]);
    const status = duckdb.getDuckDBStatus();
    if (status.state !== "failed") throw new Error("unreachable");
    expect(status.error).toContain("first");
    errors.mockRestore();
  });

  it("does not hand a REVIVED engine the dead one's extension load", async () => {
    // `ensureExtension` memoises one promise per extension. The load that was
    // in flight when the worker died can never settle on its own, so a Retry
    // that inherited that memo would leave the chip on "Loading…" for the rest
    // of the session and never issue a second INSTALL.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await duckdb.initDuckDB();
    const first = deferred();
    holdQuery = { needle: "INSTALL spatial", promise: first.promise };
    const stranded = duckdb.ensureExtension("spatial");
    await vi.waitFor(() => expect(queries).toContain("INSTALL spatial"));

    liveWorker().die("worker gone");
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");

    holdQuery = null;
    queries.length = 0;
    expect(await duckdb.ensureExtension("spatial")).toBe(true);
    expect(queries).toContain("INSTALL spatial");

    // The stranded load now settles — as a FAILURE, which is the observable
    // case: its continuation belongs to an engine that no longer exists and
    // must not write over the live one's state or publish anything.
    refuse.add("spatial");
    const { seen, stop } = record();
    first.resolve();
    await stranded;
    stop();
    expect(seen).toEqual([]);
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    errors.mockRestore();
  });

  it("keeps the DEATH's reason when the boot it interrupted fails later", async () => {
    // The boot is in flight when the worker dies. Its `instantiate` then
    // rejects, and `doInit`'s catch would publish "wasm refused" over the
    // death — a second `failed`, with a reason that is an effect of the crash
    // rather than the crash.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred();
    holdInstantiate = gate.promise;
    failInstantiate = true;
    const booting = duckdb.initDuckDB();
    await vi.waitFor(() => expect(workers).toHaveLength(1));

    const { seen, stop } = record();
    liveWorker().die("Uncaught RuntimeError: memory access out of bounds");
    gate.resolve();
    await booting;
    stop();

    expect(seen).toEqual(["failed"]);
    const status = duckdb.getDuckDBStatus();
    if (status.state !== "failed") throw new Error("unreachable");
    expect(status.error).toContain("memory access out of bounds");
    errors.mockRestore();
  });

  it("lets a Retry re-run the boot after a death — the memo is cleared", async () => {
    // `initDuckDB` hands back its memo forever unless something clears it, so
    // without the reset in `markEngineDead` the status bar's Retry would
    // resolve instantly against the boot that succeeded before the crash.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await duckdb.initDuckDB();
    liveWorker().die("worker gone");
    await duckdb.initDuckDB();
    expect(duckdb.getDuckDBStatus().state).toBe("ready");
    // A SECOND worker, not the corpse a memo would have handed back.
    expect(workers).toHaveLength(2);
    errors.mockRestore();
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
    // The unsubscribe is OBSERVED, not inferred: the hook hands
    // `subscribeDuckDBStatus` straight to `useSyncExternalStore`, so wrapping
    // the function is the only place the teardown is visible from outside.
    const real = duckdb.subscribeDuckDBStatus;
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const spy = vi
      .spyOn(duckdb, "subscribeDuckDBStatus")
      .mockImplementation((listener: () => void) => {
        const stop = real(listener);
        const wrapped = vi.fn(() => {
          stop();
        });
        stops.push(wrapped);
        return wrapped;
      });

    const view = render(<Probe />);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((s) => s.mock.calls.length === 0)).toBe(true);
    await act(async () => {
      await duckdb.initDuckDB();
    });

    view.unmount();
    // Every subscription the hook opened was closed again.
    expect(stops.every((s) => s.mock.calls.length === 1)).toBe(true);
    spy.mockRestore();

    // …and with nobody listening the module goes on working: this transition
    // needs no act() wrapper because it can no longer schedule a React update.
    await duckdb.ensureExtension("spatial");
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
  });
});
