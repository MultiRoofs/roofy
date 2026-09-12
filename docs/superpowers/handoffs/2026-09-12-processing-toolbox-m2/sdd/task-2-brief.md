### Task 2: The "Loading extension" phase in the run queue

**Files:**

- Modify: `src/features/processing/runQueue.ts` (between the executor lookup at `:443-451` and `resolveScope` at `:453`)
- Test: `tests/unit/features/processing/runQueue.test.ts`

**Interfaces:**

- Consumes: `isExtensionLoaded(name)` and `ensureExtension(name)` from `src/insights/duckdb.ts` (existing exports); `getDuckDBStatus()` for the recorded load error.
- Produces: nothing new for later tasks. Roof metrics has `extension: null` and never enters this branch — the branch exists for M3's `three_d`/`spatial` tools, and this task is what makes them a one-line registry change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/features/processing/runQueue.test.ts`. Use `measure-solids` as the fake extension tool: `toolById("measure-solids").extension === "three_d"` (`toolRegistry.ts:26`) and `execute` only consults `EXECUTORS`, never `implemented` — so registering an executor for it is enough, with no registry mock.

```ts
describe("the Loading extension phase (spec §6.1)", () => {
  it("loads the tool's extension under its own phase before computing", async () => {
    const phases: Array<string | null> = [];
    const unsub = useProcessingStore.subscribe((s) => {
      const run = s.runs[0];
      if (run && phases[phases.length - 1] !== run.phase)
        phases.push(run.phase);
    });
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(true);
    registerExecutor("measure-solids", async () => ({
      columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      rows: new Map([["b1", { solid_volume_m3: 1 }]]),
      measured: 1,
      skipped: [],
    }));

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    unsub();

    expect(ensureExtension).toHaveBeenCalledWith("three_d");
    expect(phases).toContain("extension");
    expect(phases.indexOf("extension")).toBeLessThan(phases.indexOf("compute"));
    expect(runById(id)?.status).toBe("done");
  });

  it("skips the phase when the extension is already loaded", async () => {
    vi.mocked(isExtensionLoaded).mockReturnValue(true);
    registerExecutor("measure-solids", async () => ({
      columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      rows: new Map([["b1", { solid_volume_m3: 1 }]]),
      measured: 1,
      skipped: [],
    }));

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    expect(ensureExtension).not.toHaveBeenCalled();
  });

  it("fails the run when the extension cannot be loaded, and writes nothing", async () => {
    vi.mocked(isExtensionLoaded).mockReturnValue(false);
    vi.mocked(ensureExtension).mockResolvedValue(false);
    vi.mocked(getDuckDBStatus).mockReturnValue({
      state: "ready",
      extensions: {
        cityjson: { state: "loaded" },
        spatial: { state: "unloaded" },
        three_d: { state: "failed", error: "HTTP 404" },
      },
      loadedExtensions: [],
      platform: "wasm_eh",
    });
    let ran = false;
    registerExecutor("measure-solids", async () => {
      ran = true;
      throw new Error("unreachable");
    });

    const id = submitRun(
      request({
        toolId: "measure-solids",
        lod: "2.2",
        prefix: "solid_",
        columns: [{ name: "solid_volume_m3", type: "DOUBLE" as const }],
      }),
    );
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));

    expect(ran).toBe(false);
    const run = runById(id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe(
      "The three_d extension could not be loaded: HTTP 404",
    );
    // §6.4: the engine's own reason survives in the log whichever sentence
    // the card shows — including the offline one, which replaces it.
    expect(run?.warnings).toContain("three_d: HTTP 404");
    expect(run?.undoable).toBe(false);
  });
});
```

`request(overrides)` is the file's own request builder (`runQueue.test.ts:268-279`; its defaults already target `"L1"` with scope `"all"`), and `vi.waitFor` is how every test in the file settles a run — there is no `settle()` helper, do not invent one. Add `ensureExtension`, `isExtensionLoaded` and `getDuckDBStatus` to the file's imports from `src/insights/duckdb`; `registerExecutor` and `EXECUTORS` are already imported (`:173-174`). The file's existing duckdb mock factory already stubs all three (`runQueue.test.ts:100`); if `isExtensionLoaded`/`ensureExtension` are plain `vi.fn`s there, they are already `vi.mocked`-able. Reset them in the suite's `beforeEach` (`runQueue.test.ts:281-296`) alongside the existing resets, and add `delete EXECUTORS["measure-solids"]` to the existing `afterEach` (`:297-300`) beside the `height-from-extent` line, so the `register.test.ts` pin (Task 9) is not polluted — Vitest isolates modules per file, so this is belt-and-braces.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts -t "Loading extension"
```

Expected: FAIL — `ensureExtension` is never called, `phases` never contains `"extension"`, and the third test's run reaches the executor and reads `done`.

- [ ] **Step 3: Add the phase step**

In `src/features/processing/runQueue.ts`, add to the imports from `../../insights/duckdb`: `ensureExtension`, `isExtensionLoaded`, `getDuckDBStatus`. Then insert this block between the `if (!executor) { … }` guard (ending `runQueue.ts:451`) and `const scope = await resolveScope({` (`:453`):

```ts
// Spec §6.1's first phase, "Loading extension (skipped once loaded)".
//
// It sits AFTER the cheap pre-flight refusals — a missing layer, a rebuilt
// table, a column that now belongs to the file, an unimplemented tool — so
// a run that cannot succeed never triggers a 24 MB download.
//
// It also sits INSIDE `runOnTableQueue`: the load blocks table builds for
// its duration, once per session. That is the deliberate trade. Loading
// outside the queue would take the phase out of §6.1's sequence and would
// let the run start against a table that is being rebuilt underneath it.
const tool = toolById(request.toolId);
if (tool.extension !== null && !isExtensionLoaded(tool.extension)) {
  patch(id, {
    status: "running",
    phase: "extension",
    startedAt: Date.now(),
  });
  const loaded = await ensureExtension(tool.extension);
  // `ensureExtension` cannot be aborted (it is one memoised INSTALL/LOAD
  // per extension), so a Cancel pressed during the download is honoured
  // here, on the far side of it.
  if (signal.aborted) {
    if (!failedAlready(id)) {
      patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
    }
    return;
  }
  if (!loaded) {
    // §6.4 makes the log the reproducible record of the run, so DuckDB's own
    // reason is kept there even when the card shows the offline sentence
    // instead — a bug report needs the engine's words, not only ours.
    const reason = extensionReason(tool.extension);
    if (reason !== null) {
      warnings.push(`${tool.extension}: ${reason}`);
      patch(id, { warnings: [...warnings] });
    }
    patch(id, {
      status: "failed",
      phase: null,
      error: extensionFailure(tool.extension),
      elapsedMs: elapsed(),
    });
    return;
  }
}
```

Note: `const tool = toolById(request.toolId)` is declared here; the publication block further down declares its own `const tool` (`runQueue.ts:591`) — rename that later one's reference or reuse this binding. **Reuse it**: delete the second declaration and let the publication block use this one. (It is the same tool, and two bindings with one name in one function body is a `tsc` error.)

**One consequence to leave in place and record.** `execute` patches `startedAt: Date.now()` again when it flips to `phase: "compute"` (`runQueue.ts:463-470`), so a run that spent seconds downloading an extension sees its live ticker jump back to zero at the hand-off. The roadmap already carries "the run's live elapsed timer starts at submit but is measured from execute, so it can jump back"; extend that bullet in Task 12 rather than changing the patch here — the elapsed number the CARD finally reports is computed from `started` (`runQueue.ts`'s `elapsed()`), which does include the download.

Add the message builder beside `failedAlready` (`runQueue.ts`, near `:400`):

```ts
/**
 * Spec §6.3: "Extension load failures say what failed to load and, for the
 * offline case, that it needs a network connection."
 *
 * The engine's own recorded reason is appended when there is one — it is the
 * same first-line treatment every other DuckDB error in this app gets — and an
 * offline browser is told the one thing it can act on instead, because
 * "HTTP request failed" is not a sentence a user can do anything with.
 */
/** DuckDB's own recorded reason for the failed load, or null. */
function extensionReason(name: "spatial" | "three_d"): string | null {
  const status = getDuckDBStatus();
  const entry = status.state === "ready" ? status.extensions[name] : null;
  return entry && entry.state === "failed" ? entry.error : null;
}

function extensionFailure(name: "spatial" | "three_d"): string {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    // Offline, the engine's own message is "fetch failed" or worse — true and
    // useless. The offline sentence is the one the user can act on; the
    // engine's is still RECORDED, as the warning the caller pushes.
    return `The ${name} extension could not be loaded; it needs a network connection.`;
  }
  const reason = extensionReason(name);
  return reason === null
    ? `The ${name} extension could not be loaded.`
    : `The ${name} extension could not be loaded: ${reason}`;
}
```

**[adapted copy]**, decided — §6.3 specifies what these sentences must convey, not their words. Decision 4.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts
npx tsc -b --noEmit
```

Expected: PASS, and no "Cannot redeclare block-scoped variable 'tool'".

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/runQueue.ts tests/unit/features/processing/runQueue.test.ts
git commit -m "feat(processing): a run loads its tool's extension in its own phase"
```

---
