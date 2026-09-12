### Task 4: The engine's death is detected, announced, and stops every run

**Files:**

- Modify: `src/insights/duckdb.ts:201-248` (the worker the boot creates), `src/features/processing/runQueue.ts` (a third installer watcher, beside `installTargetRemovalWatcher` at `:811-847`), `src/features/processing/processingStore.ts` (the `engineStopped` flag), `src/ui/processing/RunFooter.tsx:310-314`, `src/ui/processing/RecentRuns.tsx:75-79`, `src/app/App.tsx:850` (install the watcher)
- Test: `tests/unit/insights/useDuckDBStatus.test.tsx` (the publish), `tests/unit/features/processing/runQueue.test.ts` (the watcher), `tests/unit/ui/processing/ToolView.test.tsx` and a new `tests/unit/ui/processing/engineStopped.test.tsx` (the disabled Undo and the disabled rows)

**Interfaces:**

- Consumes: `setStatus` and the listener set (Task 1); `installTargetRemovalWatcher`'s shape (`runQueue.ts:811-847`); `toolEligibility`'s existing `engineState === "failed"` branch (`eligibility.ts:45-47`).
- Produces:
  - `duckdb.ts`: `markEngineDead(reason: string): void` (exported for the watcher's test, and called from the worker's own event handlers).
  - `processingStore.ts`: `engineStopped: boolean` and `markEngineStopped(): void`.
  - `runQueue.ts`: `installEngineWatcher(): () => void`.
- Nothing later in the plan depends on this task; it is placed here because it belongs to the same seam as Tasks 1-3 (the published status) and because the roof tool's tasks should not have to reason about a dead engine.

**Scope, decided by the repo owner: detection and containment, NO recovery.** Spec §6.1 asks for the failure path AND a Retry that "restarts the engine and rebuilds every layer table from the in-memory models". The second half is not built. The status bar's existing Retry (`TablePanel.tsx:565-578` → `App.tsx`'s `handleRetryDuckDB` → `retryEngine`) is **left exactly as it is**: it reboots the engine, and because `retryEngine` only rebuilds tables it parked in `pendingSources` (`layerTables.ts:624-660`), tables that were `ready` when the worker died are not rebuilt. Their layers therefore stay table-less and every tool stays disabled until the page is reloaded. That is the deliberate shape; the task and the docs step both say so, and the gate records it as a deviation from §6.1.

**What can actually be detected, verified on the checkout.** This is the fact the whole task turns on, and it is worse than it looks:

- `doInit` creates the Worker itself (`duckdb.ts:224`, `worker = new Worker(workerUrl)`) and hands it to `new duckdb.AsyncDuckDB(logger, worker)` (`:227`). duckdb-wasm's `attach(worker)` registers its own `message`, `error` and `close` listeners with `addEventListener` (`node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs`, `attach(e){this._worker=e,this._worker.addEventListener("message",…),addEventListener("error",…),addEventListener("close",…)}`). `addEventListener` is additive, so **our own `error`/`messageerror` listeners on the same worker object coexist with duckdb-wasm's** — no monkey-patching, no library fork.
- **A query will NOT tell us.** duckdb-wasm's `onError` handler does `console.error(...); this._pendingRequests.clear()` — it CLEARS the pending map without rejecting the promises, so an in-flight `conn.query()` after a worker error **never settles**. And once the worker is gone, `postTask` logs `"cannot send a message since the worker is not set!"` and `return`s `undefined` rather than rejecting. So "a query rejection whose message identifies a terminated worker" is not a signal this library offers. The worker's own `error` event is the only reliable one, and it is why the watcher must ABORT a running run's controller rather than wait for its query.
- **Containment is already half built.** `runQuery` returns `{ ok: false, message: NOT_RUNNING }` whenever `status.state !== "ready"` (`duckdb.ts:389-391`), so the moment `markEngineDead` publishes `failed`, every subsequent statement fails fast instead of hanging.
- **The catalogue needs no new copy.** `toolEligibility` already returns `{ ok: false, reason: "Not available while DuckDB is unavailable" }` for `engineState === "failed"` (`eligibility.ts:45-47`), and `eligibilityContextFor` reads `engineState` straight off the published status (`useEligibilityContext.ts:58`). Task 1's subscription is what makes that re-render. Nothing to write, only to test.

- [ ] **Step 1: Write the failing test for the publish**

Append to `tests/unit/insights/useDuckDBStatus.test.tsx`, inside the existing `describe("duckdb.ts publishes every transition", …)`. The `FakeWorker` there is a bare class; give it the `addEventListener`/`dispatchEvent` surface so the test can kill it:

```ts
class FakeWorker {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage() {}
  terminate() {}
  /** What the browser does when the worker script dies. */
  die(message: string) {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ type: "error", message });
    }
  }
}

/** The last worker `doInit` constructed, so a test can kill it. */
let lastWorker: FakeWorker | null = null;
```

with `vi.stubGlobal("Worker", class extends FakeWorker { constructor() { super(); lastWorker = this; } })` in the `beforeEach` (and `lastWorker = null` beside it). Then:

```ts
it("publishes failed when the worker dies, and keeps the reason", async () => {
  const { seen, stop } = record();
  await duckdb.initDuckDB();
  expect(duckdb.getDuckDBStatus().state).toBe("ready");
  lastWorker!.die("Uncaught RuntimeError: memory access out of bounds");
  stop();
  expect(seen).toEqual(["initializing", "ready:unloaded", "failed"]);
  const status = duckdb.getDuckDBStatus();
  expect(status.state).toBe("failed");
  if (status.state !== "failed") throw new Error("unreachable");
  // The status bar prints this after "The analytics engine is not running"
  // (`TablePanel.tsx:568-572`), so it has to be the engine's own words.
  expect(status.error).toContain("memory access out of bounds");
});

it("fails every statement fast once the engine is dead", async () => {
  await duckdb.initDuckDB();
  lastWorker!.die("worker gone");
  const outcome = await duckdb.runQuery("SELECT 1");
  // `runQuery` guards on the status, so nothing is posted to a worker that
  // is not there — which matters, because `postTask` would neither reject
  // nor resolve.
  expect(outcome).toEqual({
    ok: false,
    message: "The analytics engine is not running.",
  });
});

it("announces the death ONCE, however many events arrive", async () => {
  await duckdb.initDuckDB();
  const { seen, stop } = record();
  lastWorker!.die("first");
  lastWorker!.die("second");
  stop();
  expect(seen).toEqual(["failed"]);
  const status = duckdb.getDuckDBStatus();
  if (status.state !== "failed") throw new Error("unreachable");
  expect(status.error).toContain("first");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/insights/useDuckDBStatus.test.tsx -t "worker dies"
```

Expected: FAIL — the status stays `ready` after `die()`; nothing is published.

- [ ] **Step 3: Detect and announce the death**

In `src/insights/duckdb.ts`, beside `setStatus` (Task 1's block):

```ts
/**
 * The engine's worker has died. Publish it, and make sure nothing tries to
 * talk to the corpse.
 *
 * WHY AN EVENT AND NOT A FAILED QUERY. duckdb-wasm's own worker error handler
 * does `this._pendingRequests.clear()` — it drops the pending promises without
 * rejecting them, so a query in flight when the worker dies NEVER SETTLES; and
 * once the worker is gone `postTask` logs and returns `undefined` rather than
 * rejecting. There is no rejection to listen for. The worker's `error` event,
 * on the worker THIS module constructed, is the only honest signal.
 *
 * Idempotent: a dying worker can fire more than once, and a second `failed`
 * status would re-render every subscriber for no news.
 */
export function markEngineDead(reason: string): void {
  if (status.state === "failed") return;
  // Cleared BEFORE the publish, so a listener that reacts synchronously cannot
  // find a connection that is about to be dropped. `runQuery` then refuses on
  // `status.state !== "ready"` (see below) rather than posting into the void.
  db = null;
  conn = null;
  // A retry must genuinely re-run `doInit` rather than be handed the memo of
  // the boot that succeeded before the worker died.
  initPromise = null;
  extensions = {
    cityjson: { state: "unloaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  };
  loadedExtensions = [];
  setStatus({ state: "failed", error: reason });
  console.error("DuckDB-wasm worker stopped:", reason);
}
```

and in `doInit`, immediately after `worker = new Worker(workerUrl);` (`:224`) — **before** `new duckdb.AsyncDuckDB(logger, worker)`, so our listener is registered whatever the library does next:

```ts
// ADDITIVE: `AsyncDuckDB.attach` registers its own "message"/"error"/
// "close" listeners with addEventListener, so these two sit beside them
// rather than replacing them.
worker.addEventListener("error", (event) => {
  markEngineDead(event.message || "The analytics engine's worker stopped.");
});
worker.addEventListener("messageerror", () => {
  markEngineDead("The analytics engine sent a message that could not be read.");
});
```

`runQuery` already refuses on a non-`ready` status (`duckdb.ts:389-391`); no change there.

- [ ] **Step 4: Write the failing test for the runs**

Append to `tests/unit/features/processing/runQueue.test.ts`. Its duckdb mock has no status publisher, so the watcher is driven by making `getDuckDBStatus` return `failed` and calling the module's notify — simplest and honest: give the file a mutable status plus a listener set in its factory.

```ts
// In the duckdb mock factory, beside the other keys:
//   getDuckDBStatus: vi.fn(() => engineStatus),
//   subscribeDuckDBStatus: vi.fn((l: () => void) => {
//     statusListeners.add(l);
//     return () => statusListeners.delete(l);
//   }),
//   getDuckDBStatusVersion: vi.fn(() => statusVersion),
// with, above it:
//   let engineStatus: unknown = { state: "ready", extensions: {}, loadedExtensions: [], platform: null };
//   let statusVersion = 0;
//   const statusListeners = new Set<() => void>();
// and a helper the tests call:
function killEngine(reason = "worker gone"): void {
  engineStatus = { state: "failed", error: reason };
  statusVersion += 1;
  for (const listener of [...statusListeners]) listener();
}

describe("the engine watcher (spec §6.1)", () => {
  it("fails the queued AND the running run when the engine stops", async () => {
    const stop = installEngineWatcher();
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    registerExecutor("height-from-extent", async () => {
      throw new Error("the executor must never be reached");
    });
    const running = submitRun(request());
    const queued = submitRun(request({ prefix: "other_" }));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    expect(runById(queued)?.status).toBe("queued");

    killEngine();

    // §6.1's exact sentence, on BOTH runs.
    expect(runById(running)?.status).toBe("failed");
    expect(runById(running)?.error).toBe("Analytics engine stopped");
    expect(runById(queued)?.status).toBe("failed");
    expect(runById(queued)?.error).toBe("Analytics engine stopped");
    expect(useProcessingStore.getState().engineStopped).toBe(true);

    held.resolve();
    stop();
  });

  it("leaves a run that already finished alone, but takes its Undo away", async () => {
    const stop = installEngineWatcher();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.undoable).toBe(true);

    killEngine();

    // The RUN is untouched — it succeeded, and its columns are still in the
    // table and the model. Only the flag changes, and the UI reads that.
    expect(runById(id)?.status).toBe("done");
    expect(runById(id)?.undoable).toBe(true);
    expect(useProcessingStore.getState().engineStopped).toBe(true);
    stop();
  });

  it("does not issue a DROP for a backup table that died with the engine", async () => {
    const stop = installEngineWatcher();
    registerExecutor("height-from-extent", async (run) => ({
      columns: [{ name: `${run.prefix}height_m`, type: "DOUBLE" as const }],
      rows: new Map([["a", { extent_height_m: 4 }]]),
      measured: 1,
      skipped: [],
    }));
    const id = submitRun(request());
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    sql.length = 0;

    killEngine();
    await Promise.resolve();

    expect(sql.filter((q) => q.startsWith("DROP TABLE"))).toEqual([]);
    expect(runById(id)).not.toBeNull();
    stop();
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts -t "engine watcher"
```

Expected: FAIL — `installEngineWatcher` is not exported and `engineStopped` is not on the store.

- [ ] **Step 6: Carry the flag on the store**

In `src/features/processing/processingStore.ts`, add to `ProcessingState` (beside `unseenFailure`):

```ts
  /**
   * The analytics engine has stopped and is not coming back this session
   * (spec §6.1, minus its restart).
   *
   * It is ONE flag rather than a field per run because it is one fact about
   * the session: every backup table lived in the database that died, so no
   * run's Undo can restore anything, whatever its own `undoable` says. The
   * cards read this beside `undoable`; nothing clears it, because the status
   * bar's Retry reboots the engine without rebuilding the tables the backups
   * described.
   */
  readonly engineStopped: boolean;
```

`engineStopped: false` in `initial`, an action

```ts
  markEngineStopped(): void;
```

implemented as `markEngineStopped: () => set({ engineStopped: true })`, and `resetForTest` already spreads `initial`, so it clears.

- [ ] **Step 7: Install the watcher**

In `src/features/processing/runQueue.ts`, beside `installTargetRemovalWatcher` (`:811-847`) and following its shape exactly — a module-level `disposeEngineWatcher`, a `dispose` that nulls it, and one immediate call so an engine that is ALREADY dead at install time is acted on:

```ts
let disposeEngineWatcher: (() => void) | null = null;

/**
 * Spec §6.1: "If the DuckDB engine itself dies, the running run and every
 * queued run fail with 'Analytics engine stopped'."
 *
 * The running run is ABORTED rather than awaited, because there may be nothing
 * to await: duckdb-wasm drops the promises of requests that were in flight when
 * its worker died (its own `onError` clears the pending map without rejecting),
 * so a run waiting on a query would otherwise hang for the life of the page.
 *
 * Undo is taken from every earlier run through the store's `engineStopped`
 * flag, not by patching each card: the backup tables lived in the database that
 * just died. `discardUndo` is deliberately NOT called — its `DROP TABLE` would
 * be posted at an engine that cannot answer, and there is nothing left to drop.
 */
export function installEngineWatcher(): () => void {
  disposeEngineWatcher?.();

  let stopped = false;
  const reactToStatus = () => {
    if (stopped) return;
    if (getDuckDBStatus().state !== "failed") return;
    stopped = true;
    for (const run of useProcessingStore.getState().runs) {
      if (
        run.status !== "queued" &&
        run.status !== "running" &&
        run.status !== "cancelling"
      ) {
        continue;
      }
      patch(run.id, {
        status: "failed",
        phase: null,
        error: "Analytics engine stopped",
        elapsedMs: Math.max(0, Date.now() - run.startedAt),
      });
      controllers.get(run.id)?.abort();
    }
    useProcessingStore.getState().markEngineStopped();
  };

  const unsubscribe = subscribeDuckDBStatus(reactToStatus);
  reactToStatus();

  const dispose = () => {
    unsubscribe();
    if (disposeEngineWatcher === dispose) disposeEngineWatcher = null;
  };
  disposeEngineWatcher = dispose;
  return dispose;
}
```

Add `subscribeDuckDBStatus` to the module's imports from `../../insights/duckdb`. In `src/app/App.tsx`, install it beside the removal watcher (`:850`): `useEffect(() => installEngineWatcher(), []);`, importing it from the same module the other two come from.

- [ ] **Step 8: Write the failing test for the UI**

Create `tests/unit/ui/processing/engineStopped.test.tsx`, on `lodSelect.test.tsx`'s scaffolding (its three `vi.mock` blocks, imports and reset pair) with the duckdb mock's status switched to `failed`:

```tsx
/**
 * Spec §6.1 after the engine dies: the tools go dark with the reason the
 * catalogue already has, and no card offers an Undo it cannot perform.
 */
describe("after the analytics engine stops", () => {
  it("disables every tool row with the existing reason", () => {
    // `eligibility.ts:45-47` already answers this for `engineState: "failed"`;
    // what is new is that the panel HEARS about it (Task 1's subscription).
    addRoofLayer();
    render(<CatalogueView />);
    const row = screen
      .getByText("Roof metrics to attributes")
      .closest("button")!;
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row.textContent).toContain(
      "Not available while DuckDB is unavailable",
    );
  });

  it("disables the result card's Undo and says why", () => {
    const layerId = addRoofLayer();
    useProcessingStore.getState().markEngineStopped();
    render(<ToolView toolId="roof-metrics" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(doneRoofRun(layerId, { undoable: true })),
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute(
      "title",
      "Unavailable: the analytics engine stopped",
    );
  });

  it("disables Recent runs' Undo for the same reason", () => {
    const layerId = addRoofLayer();
    useProcessingStore.getState().markEngineStopped();
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(doneRoofRun(layerId, { undoable: true })),
    );
    render(<CatalogueView />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute(
      "title",
      "Unavailable: the analytics engine stopped",
    );
  });

  it("leaves Undo alone while the engine is alive", () => {
    const layerId = addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(doneRoofRun(layerId, { undoable: true })),
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
});
```

`doneRoofRun(layerId, patch)` is this file's local `doneRun` equivalent: copy `ToolView.test.tsx:140-182`'s `runFixture`/`doneRun` pair and point `toolId` at `"roof-metrics"` with `columns: ["roof_area_m2"]`. The first case needs the duckdb mock's `getDuckDBStatus` to return `{ state: "failed", error: "worker gone" }`; the last three need it `ready` — make it a mutable module `let` the tests set, as `runQueue.test.ts` does with its own fixtures.

- [ ] **Step 9: Disable the two Undo buttons**

**[adapted copy]** — `"Unavailable: the analytics engine stopped"`. §6.1's own sentence is "Unavailable after an engine restart", which assumes the restart this milestone does not perform; saying "after a restart" when nothing restarted would describe an event the user never saw.

In `src/ui/processing/RunFooter.tsx`, replace the Undo block (`:310-314`):

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

with, at the top of the module,

```tsx
/**
 * §6.1's reason, adapted. The spec says "Unavailable after an engine restart",
 * which assumes a restart; this milestone detects the death and does not
 * restart, so the sentence names what actually happened.
 */
const UNDO_ENGINE_STOPPED = "Unavailable: the analytics engine stopped";
```

and, in the component, `const engineStopped = useProcessingStore((s) => s.engineStopped);`.

The same two lines in `src/ui/processing/RecentRuns.tsx:75-79` (its condition already gates on `run.status === "done" && run.undoable && !run.stale`; keep it and add `disabled`/`title`), importing the constant from `RunFooter` or, better, moving it to `src/ui/processing/runFormat.ts` beside the other shared copy so neither component owns the other's string.

- [ ] **Step 10: Run everything**

```bash
npx vitest run tests/unit/insights tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/insights/duckdb.ts src/features/processing/runQueue.ts \
  src/features/processing/processingStore.ts src/ui/processing/RunFooter.tsx \
  src/ui/processing/RecentRuns.tsx src/ui/processing/runFormat.ts src/app/App.tsx \
  tests/unit/insights/useDuckDBStatus.test.tsx \
  tests/unit/features/processing/runQueue.test.ts \
  tests/unit/ui/processing/engineStopped.test.tsx
git commit -m "feat(insights): a dead DuckDB worker stops every run and every Undo"
```

---
