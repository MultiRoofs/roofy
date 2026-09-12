### Task 1: The DuckDB status subscription, and the hard rule that changes with it

**Files:**

- Create: `src/insights/useDuckDBStatus.ts`
- Modify: `src/insights/duckdb.ts` (the four `status =` sites, `publishReady`, `ensureExtension`), `src/app/App.tsx:286-288, 908-920, 933-942, 2290`, `src/ui/processing/useEligibilityContext.ts:1-37`, `CLAUDE.md:116`, `docs/architecture-notes.md` (append to the M13.1 section)
- Modify (mechanical, two keys each): the 26 test files listed in Step 6
- Test: `tests/unit/insights/useDuckDBStatus.test.tsx`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `duckdb.ts`: `export function subscribeDuckDBStatus(listener: () => void): () => void` and `export function getDuckDBStatusVersion(): number`.
  - `src/insights/useDuckDBStatus.ts`: `export function useDuckDBStatus(): DuckDBStatus`.
  - Task 3 consumes `useDuckDBStatus` through `useEligibilityInputs`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/insights/useDuckDBStatus.test.tsx`. This is the ONE unit test that runs the REAL `duckdb.ts` — it is the module under test, and mocking it would test nothing. The engine underneath it is a controlled fake at the PACKAGE boundary, so every transition the test asserts is one `duckdb.ts` really performed: `initializing` → `ready`, then a lazy `loading` → `loaded`, then a lazy `loading` → `failed`.

```tsx
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
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  // `duckdb.ts` is a module singleton: a fresh copy per test is the only way
  // to observe a BOOT, which happens exactly once per module instance.
  vi.resetModules();
  duckdb = await import("../../../src/insights/duckdb");
  hook = await import("../../../src/insights/useDuckDBStatus");
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
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx
```

Expected: FAIL — `Failed to resolve import "../../../src/insights/useDuckDBStatus"`, and `subscribeDuckDBStatus`/`getDuckDBStatusVersion` are not exported by `duckdb.ts`. The two transition suites will also fail because no listener is ever called.

- [ ] **Step 3: Publish every transition from `duckdb.ts`**

In `src/insights/duckdb.ts`, immediately after `let status: DuckDBStatus = { state: "uninitialized" };` (`:85`), add:

```ts
/**
 * The status is a VALUE React subscribes to, so every transition has to be
 * announced. `statusVersion` — not the status object — is what
 * `useSyncExternalStore` snapshots. In PRODUCTION either would do:
 * `getDuckDBStatus()` returns this module's STORED object, the same reference
 * between transitions. The counter is for the TESTS, where 24 of the 26 mock
 * factories spell the status as `vi.fn(() => ({ … }))` — a fresh literal per
 * call, which React rejects as an uncached snapshot. A number cannot be spelled
 * that way by accident.
 */
let statusVersion = 0;
const statusListeners = new Set<() => void>();

/** The ONE writer. Every `status = …` in this module goes through it. */
function setStatus(next: DuckDBStatus): void {
  status = next;
  statusVersion += 1;
  for (const listener of [...statusListeners]) listener();
}

export function subscribeDuckDBStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getDuckDBStatusVersion(): number {
  return statusVersion;
}
```

Then route the three remaining assignments through it:

- `publishReady()` (`:102-109`) — replace `status = { … }` with `setStatus({ state: "ready", extensions: { ...extensions }, loadedExtensions, platform });`
- `doInit` (`:199`) — `setStatus({ state: "initializing" });`
- `doInit`'s catch (`:242`) — `setStatus({ state: "failed", error: message });`

Leave the `let status = { state: "uninitialized" }` initialiser alone: nothing can be listening at module evaluation.

- [ ] **Step 4: Make the `"loading"` transition visible**

`loadExtension` sets `extensions[name] = { state: "loading" }` (`duckdb.ts:142`) but nothing publishes it, so §6.1's chip can never say an extension is loading. The publish must NOT go inside `loadExtension`: `doInit` calls it for `cityjson` at `:236`, **before** the first `publishReady()` at `:239`, and a publish there would mint a `ready` status in the middle of the boot. Put it in `ensureExtension` instead — replace the body's opening (`duckdb.ts:275-282`) with:

```ts
export async function ensureExtension(name: ExtensionName): Promise<boolean> {
  if (extensions[name].state === "loaded") return true;
  const existing = extensionPromises.get(name);
  if (existing) return await existing;
  const promise = (async () => {
    // The "loading" state has to reach the catalogue's chip (spec §5), and
    // `loadExtension` cannot announce it itself — `doInit` calls that function
    // for `cityjson` before the status is `ready` at all, so a publish inside
    // it would announce a half-built engine.
    extensions = { ...extensions, [name]: { state: "loading" } };
    if (status.state === "ready") publishReady();
    const ok = await loadExtension(name);
    if (ok) loadedExtensions = await readLoadedExtensions();
    if (status.state === "ready") publishReady();
    return ok;
  })().finally(() => extensionPromises.delete(name));
  extensionPromises.set(name, promise);
  return await promise;
}
```

(The `loading` assignment inside `loadExtension` stays; it is idempotent with this one.)

- [ ] **Step 5: Write the hook**

Create `src/insights/useDuckDBStatus.ts`:

```ts
/**
 * The ONE React door to the DuckDB engine's status.
 *
 * `duckdb.ts` owns the value and publishes every transition; this hook decides
 * when a component re-renders and reads the value fresh. It deliberately holds
 * NO copy — a component with `useState<DuckDBStatus>` is a second writer, which
 * is the thing the hard rule in CLAUDE.md forbids.
 *
 * The snapshot is the VERSION COUNTER, not the status. `useSyncExternalStore`
 * compares snapshots with `Object.is` on every render; the real
 * `getDuckDBStatus()` would pass that test on its own (it returns the module's
 * stored object, unchanged between transitions), but 24 of the app's test mock
 * factories return a fresh literal per call and React would reject those as
 * uncached snapshots and loop. A number cannot be spelled that way by accident,
 * and the value is one plain read away.
 */
import { useSyncExternalStore } from "react";
import {
  getDuckDBStatus,
  getDuckDBStatusVersion,
  subscribeDuckDBStatus,
  type DuckDBStatus,
} from "./duckdb";

export function useDuckDBStatus(): DuckDBStatus {
  useSyncExternalStore(
    subscribeDuckDBStatus,
    getDuckDBStatusVersion,
    getDuckDBStatusVersion,
  );
  return getDuckDBStatus();
}
```

- [ ] **Step 6: Add the two new keys to every duckdb mock factory**

The global constraint: a new `duckdb.ts` export goes into every `vi.mock(".../insights/duckdb", …)` factory. Add these two lines beside the existing `getDuckDBStatus` key:

```ts
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
```

The 26 files (all of them already have a `getDuckDBStatus` key, so the insertion point is unambiguous):

```
tests/integration/duckdb/computedColumns.test.ts
tests/integration/duckdb/layerTables.test.ts
tests/unit/app/appCatalogEntry.test.tsx
tests/unit/app/appCityParquetLayers.test.tsx
tests/unit/app/appEngineBoot.test.tsx
tests/unit/app/appGeoOnly.test.tsx
tests/unit/app/appProcessingToast.test.tsx
tests/unit/app/appRestoreShare.test.tsx
tests/unit/app/appViewerShell.test.tsx
tests/unit/features/processing/runQueue.test.ts
tests/unit/features/processing/scope.test.ts
tests/unit/features/query/mapFilterSync.test.ts
tests/unit/features/stac/stacItems.test.ts
tests/unit/insights/computedColumns.test.ts
tests/unit/insights/exportAttributes.test.ts
tests/unit/insights/exportCityParquet.test.ts
tests/unit/insights/layerTablesBuild.test.ts
tests/unit/insights/layerTablesQueue.test.ts
tests/unit/ui/inspector/StatsTabDuckdb.test.tsx
tests/unit/ui/processing/CatalogueView.test.tsx
tests/unit/ui/processing/ProcessingPanel.test.tsx
tests/unit/ui/processing/ToolView.test.tsx
tests/unit/ui/processing/useToolForm.test.tsx
tests/unit/ui/table/ExportDialog.test.tsx
tests/unit/ui/table/TablePanel.test.tsx
tests/unit/ui/table/useLayerQuery.test.tsx
```

Two of them (`tests/integration/duckdb/*.test.ts`) spell every key as a shared `unreachable` stub; follow the file's own idiom there (`subscribeDuckDBStatus: () => () => {}`, `getDuckDBStatusVersion: () => 0` — a subscription in an integration test must not throw, so `unreachable` is wrong for these two).
`tests/unit/ui/table/useLayerCounts.test.tsx` mocks `duckdb` **without** a `getDuckDBStatus` key and renders no component that reaches the hook; leave it alone.

- [ ] **Step 7: Delete App's mirror**

In `src/app/App.tsx`:

- Replace `const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({ state: "uninitialized" });` (`:286-288`) with `const duckdbStatus = useDuckDBStatus();`
- Swap the import at `:50` — `import { useDuckDBStatus } from "../insights/useDuckDBStatus";` replaces `import { getDuckDBStatus } from "../insights/duckdb";` (keep the `DuckDBStatus` type import if `TablePanel`'s prop type needs it locally; it does not — the type flows through the hook).
- Boot effect (`:908-920`): delete both `setDuckdbStatus` lines. The comment about announcing the attempt first is now wrong; replace it with:

```ts
// `retryEngine`, not `initDuckDB`: it awaits the same (memoised) boot and
// then rebuilds any table that was refused while the engine was still
// coming up. A layer added during the boot — a restored snapshot, a share
// link, a quick drop — must not need the user to notice and re-add it.
//
// Nothing sets the status here any more: `doInit` publishes `initializing`
// synchronously on the first call and `ready`/`failed` when it lands, and
// `useDuckDBStatus` renders each of them. The old optimistic
// `setDuckdbStatus({ state: "initializing" })` was also WRONG on the Retry
// path — `initDuckDB` does not re-run a boot that already succeeded, so a
// Retry aimed at a failed TABLE made a healthy engine read "Loading".
void retryEngine();
```

- `handleRetryDuckDB` (`:933-942`) becomes:

```ts
const handleRetryDuckDB = useCallback(() => {
  void retryEngine();
}, []);
```

keeping its existing doc comment minus the sentence about setting the status.

- `:2290` is unchanged — `duckdbStatus={duckdbStatus}` now reads the hook's value.

- [ ] **Step 8: Move the processing panel's read onto the hook**

In `src/ui/processing/useEligibilityContext.ts`, replace the `getDuckDBStatus` import (`:17-18`) with `import { useDuckDBStatus } from "../../insights/useDuckDBStatus";` plus `import type { DuckDBStatus } from "../../insights/duckdb";`, change `:36` to `return { tables, hasVectorLayer, status: useDuckDBStatus() };`, and replace the head comment's first paragraph (`:5-9`) with:

```
 * The status is SUBSCRIBED (`useDuckDBStatus`), not polled. A lazy extension
 * load moves it without touching a layer's table, so the catalogue's chips and
 * the extension-failure reason would otherwise go on showing the state the
 * panel happened to open with.
```

- [ ] **Step 9: Run the new test, then the suite**

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx
npx vitest run tests/unit/app tests/unit/ui/processing tests/unit/ui/table tests/unit/insights
```

Expected: PASS. A `The result of getSnapshot should be cached` error anywhere means a mock factory was missed — re-check Step 6.

- [ ] **Step 10: Amend the hard rule and write the story**

The rewrite is **approved by the repo owner (2026-09-11)**, so this is an edit to make, not a proposal to raise. `CLAUDE.md:116` — replace the line with:

```markdown
- ONE writer of the DuckDB status: `duckdb.ts` owns the value and publishes every transition (`setStatus`). React reads it through `useDuckDBStatus()` (`src/insights/useDuckDBStatus.ts`, a `useSyncExternalStore` over `subscribeDuckDBStatus` + `getDuckDBStatusVersion`) — never into component state, and nothing else publishes.
```

`docs/architecture-notes.md` — append to the "Processing toolbox seam (M13.1, 2026-09-11)" section:

```markdown
**The engine status is published, not polled (M13.2).** `duckdb.ts` keeps a
listener set and a version counter; `setStatus` is the one writer and every
transition — `initializing`, `ready`, `failed`, and each lazy extension's
`loading`/`loaded`/`failed` — goes through it. React reads the value through
`useDuckDBStatus()`, a `useSyncExternalStore` whose SNAPSHOT is the version
counter rather than the status object. The status object itself would be a
valid snapshot — `getDuckDBStatus()` returns the module's stored reference —
but the app's test mock factories return a fresh literal per call, which React
rejects as uncached; a counter cannot be written that way by accident.
`App` no longer mirrors the status in
`useState`. That mirror was also subtly wrong: `retryEngine()` on an engine
that is already `ready` does not re-run `doInit`, so App's optimistic
`setDuckdbStatus({ state: "initializing" })` made a healthy engine read
"Loading" whenever the user retried a failed TABLE.
```

- [ ] **Step 11: Verify and commit**

```bash
npx vp check && npx tsc -b --noEmit && npx vitest run
git add src/insights/duckdb.ts src/insights/useDuckDBStatus.ts src/app/App.tsx \
  src/ui/processing/useEligibilityContext.ts CLAUDE.md docs/architecture-notes.md \
  tests/unit/insights/useDuckDBStatus.test.tsx tests/unit tests/integration
git commit -m "feat(insights): publish the DuckDB status and read it through one hook"
```

---
