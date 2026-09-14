### Task 5: The "Reading source" phase

**Files:**

- Create: `src/features/processing/sourceRead.ts`
- Modify: `src/insights/layerTables.ts` (the `LayerTable` interface and its two builders), `src/features/processing/runQueue.ts` (the phase a reader-backed run starts in), `src/ui/processing/useToolForm.ts`, `src/ui/processing/ToolView.tsx`, and the **16 test files carrying a `LayerTable` literal** (named in Step 6; `grep -rln 'rowCount:' tests` on `develop` @ `55e4e00`). **Not** the `vi.mock(".../insights/layerTables")` factories: this task adds FIELDS to a type, not EXPORTS to a module — the factory sweep is Task 21's.
- Test: `tests/unit/features/processing/sourceRead.test.ts`, plus one case appended to `tests/unit/features/processing/runQueue.test.ts` and one to `tests/unit/ui/processing/ToolView.test.tsx`

**Interfaces:**

- Consumes: `LayerTable`, `SourceProvider`, `LodColumn { label, suffix }`, `registerBuffer`/`dropBuffer`/`getDuckDBStatus` (`duckdb.ts:196`, `:724-743`), `raced`/`racedWithDeath`/`CancelledError`/`EngineDeadError` (`engineAwait.ts:70-106`), `quoteLiteral` (`sql.ts:39-48`); type-only `QueryOutcome` and `ToolContext`.
- Produces:

```ts
// src/insights/layerTables.ts — LayerTable gains:
//   extension: ReaderExtension | null
//   sourceBytes: number | null          // byteLength at build, or null

// src/features/processing/sourceRead.ts
export interface ReadSourceHandle {
  /** e.g. `read_cityjson('layer_3_run_7.city.json', lod => '2.2')` */
  readonly from: string;
  readonly geometryColumn: string; // "geometry_lod2_2"
  readonly propertiesColumn: string; // "geometry_properties_lod2_2"
  release(): Promise<void>; // dropBuffer; idempotent, never throws
}
export function sourceWorkloadNote(table: LayerTable): string | null;
export async function readSource(input: {
  readonly runId: string;
  readonly table: LayerTable;
  readonly lod: string; // the LoD LABEL ("2.2"), never a suffix
  readonly signal: AbortSignal;
}): Promise<ReadSourceHandle>;
/** §6.1's sentence for an error raised while re-reading the source — at the
 *  fetch, at the hand-off, or INSIDE the reader statement — or null when the
 *  error is not a source problem and must travel as it is. A `CancelledError`
 *  and an `EngineDeadError` come back UNCHANGED. */
export function classifySourceFailure(error: unknown): Error | null;
/** §6.1's id join: throws `SOURCE_IDS_DIFFER` when the reader did not answer
 *  for every id the run asked about. */
export function assertSourceIds(
  requested: ReadonlyArray<string>,
  returned: ReadonlySet<string>,
): void;
/** `ctx.query` for a statement that reads the RE-READ SOURCE: §6.1's sentence
 *  on a source failure, the engine's own words into `ctx.warn`, and anything
 *  that is not a source problem rethrown untouched. */
export async function readerQuery(
  ctx: Pick<ToolContext, "query" | "warn">,
  label: string,
  sql: string,
): Promise<Extract<QueryOutcome, { readonly ok: true }>>;
```

`runQueue` starts a `needsReader` run in the `"source"` phase instead of `"compute"`; the executor calls `ctx.phase("compute")` once its handle is open. `useToolForm` gains `workloadNote`, rendered by `ToolView` beside the extension note.

**Three §6.1 sentences also land here, as exported constants**, and so do the two functions that decide WHEN to raise them (`classifySourceFailure`, `assertSourceIds`). `readSource` itself can raise two of the sentences; the third is the _executor's_ to raise, because §6.1 says the id mismatch is "detected by the id join, the only check possible" and `readSource` has no `query` door — but the CHECK is written once, here, beside its sentence, and Tasks 7 and 10 call it rather than each re-deciding what "the id join failed" means. Putting all of it in this module is what stops a later task inventing a fourth wording or a second threshold:

```ts
export const SOURCE_READ_FAILED =
  "Could not re-read the source (network or decompression error)";
export const SOURCE_IDS_DIFFER =
  "The source no longer reads as the loaded layer (object ids differ); add the layer again";
export const SOURCE_OUT_OF_MEMORY = "Not enough memory to read the source";
```

**`release()` races the death.** Its body is `dropBuffer`, whose own body is `await db.dropFile(name).catch(() => {})` (`duckdb.ts:740-745`) — a swallowed rejection says nothing about a promise that never settles, and duckdb-wasm's `onError` clears pending requests WITHOUT rejecting them. This `release()` is awaited from a `finally` INSIDE the run's FIFO slot, so a death during the cleanup would strand the shared queue for the life of the page. `racedWithDeath` is the ONE abort+death race (Global Constraints) and this is exactly its case; Task 25 later puts the same race inside the primitive, which makes this belt-and-braces rather than dead.

**Why `LayerTable` gains two fields.** The extension is today reconstructible only by parsing `sourceName` (`` `${table}.${extension}` ``, `layerTables.ts:596`) — precisely the fragility `export.ts` routed around by making its CALLER pass `sourceExtension: string` (`export.ts:386-403`). The byte count exists nowhere: §6's workload note needs it before any run, and the array it would be measured from has been detached since build time, so it is captured at build and kept.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/sourceRead.test.ts`:

```ts
/**
 * §6.1's "Reading source" phase: the ONE door a reader-backed tool uses to get
 * geometry back into DuckDB.
 *
 * Copied from `export.ts:558-578`, which is the working precedent — fresh bytes
 * from the provider, ONE `registerBuffer`, a `FROM` clause carrying the file's
 * OWN LoD label, and the buffer dropped the moment the parse is done. A 300 MB
 * CityJSON must not sit in the wasm heap for the length of a compute.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerTable } from "../../../../src/insights/layerTables";
// The REAL classes, because the module tells a cancellation from a read
// failure with `instanceof` and both of them extend `Error` with the name
// `"Error"` (`engineAwait.ts:33, 44`) — a `.name` check would read every
// cancellation as a source failure. `engineAwait.ts` imports only
// `onEngineDeath` from `insights/duckdb`, which the factory below fakes, so
// this is a static import of an engine-free module.
import {
  CancelledError,
  EngineDeadError,
} from "../../../../src/insights/engineAwait";

const registerBuffer = vi.fn(async () => true);
const dropBuffer = vi.fn(async () => {});
/** The engine's own status, module-level so a case can move it: a refused
 *  `registerBuffer` means "too large" only while the engine is still ready. */
const READY_STATUS = { state: "ready", extensions: {} } as const;
const getDuckDBStatus = vi.fn(
  (): { state: string; extensions: Record<string, unknown> } => READY_STATUS,
);
/** Every death listener `raced` installs, so a test can fire one. */
const deathListeners: Array<() => void> = [];

vi.mock("../../../../src/insights/duckdb", () => ({
  registerBuffer,
  dropBuffer,
  runQuery: vi.fn(async () => ({ ok: false, message: "not used here" })),
  ddl: vi.fn(async () => ({ ok: false, message: "not used here" })),
  readFile: vi.fn(async () => null),
  getDuckDBStatus,
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn((listener: () => void) => {
    deathListeners.push(listener);
    return () => {
      const i = deathListeners.indexOf(listener);
      if (i >= 0) deathListeners.splice(i, 1);
    };
  }),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  formatDuckDBError: (e: unknown) => String(e),
  initDuckDB: vi.fn(async () => {}),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const {
  SOURCE_IDS_DIFFER,
  SOURCE_OUT_OF_MEMORY,
  SOURCE_READ_FAILED,
  assertSourceIds,
  classifySourceFailure,
  readSource,
  readerQuery,
  sourceWorkloadNote,
} = await import("../../../../src/features/processing/sourceRead");

/** A reader-backed table, as `buildFromReader` publishes one. */
function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_3",
    sourceName: "layer_3.city.json",
    source: async () => new Uint8Array([1, 2, 3]),
    reader: "read_cityjson",
    extension: "city.json",
    sourceBytes: 3,
    columns: [],
    lods: [
      { label: "2.2", suffix: "2_2" },
      { label: "0", suffix: "0" },
    ],
    rowCount: 2,
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  registerBuffer.mockImplementation(async () => true);
  getDuckDBStatus.mockImplementation(() => READY_STATUS);
  deathListeners.length = 0;
});

describe("readSource", () => {
  it("registers a FRESH array under a per-run VFS name and builds the FROM", async () => {
    const bytes: Uint8Array[] = [];
    const handle = await readSource({
      runId: "run_7",
      table: table({
        source: async () => {
          const fresh = new Uint8Array([9, 9]);
          bytes.push(fresh);
          return fresh;
        },
      }),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    // A name per RUN, not per layer: `registerBuffer` DETACHES what it is
    // given and a name read after `dropBuffer` still resolves, to garbage —
    // so a run never reuses a name another read may have dropped.
    expect(registerBuffer).toHaveBeenCalledWith(
      "layer_3_run_7.city.json",
      bytes[0],
    );
    expect(handle.from).toBe(
      "read_cityjson('layer_3_run_7.city.json', lod => '2.2')",
    );
  });

  it("names the LoD columns from `LodColumn.suffix`, never from the label", () => {
    // `"0"` and `"0.0"` are DIFFERENT columns and only the file knows which it
    // has (`columnKind.ts:85-95`). Re-spelling the label would address a
    // column that does not exist, and the run would fail on a Binder Error.
    return readSource({
      runId: "run_1",
      table: table({ lods: [{ label: "0", suffix: "0_0" }] }),
      lod: "0",
      signal: new AbortController().signal,
    }).then((handle) => {
      expect(handle.geometryColumn).toBe("geometry_lod0_0");
      expect(handle.propertiesColumn).toBe("geometry_properties_lod0_0");
      // The TABLE's own name is `layer_3` (see `table()` above), so the VFS
      // name is `layer_3_run_1` — it is minted from the table, never from the
      // layer's position in the list.
      expect(handle.from).toBe(
        "read_cityjson('layer_3_run_1.city.json', lod => '0')",
      );
    });
  });

  it("uses the CityJSONSeq reader and extension when that is what the layer has", async () => {
    const handle = await readSource({
      runId: "run_2",
      table: table({ reader: "read_cityjsonseq", extension: "city.jsonl" }),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    expect(handle.from).toBe(
      "read_cityjsonseq('layer_3_run_2.city.jsonl', lod => '2.2')",
    );
  });

  it("drops the buffer once, idempotently, and never throws from release()", async () => {
    const handle = await readSource({
      runId: "run_3",
      table: table(),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    dropBuffer.mockRejectedValueOnce(new Error("gone"));
    await handle.release();
    await handle.release();
    // A `finally` calls it on every exit path, including after a failure that
    // already dropped it. One drop, no throw.
    expect(dropBuffer).toHaveBeenCalledTimes(1);
    expect(dropBuffer).toHaveBeenCalledWith("layer_3_run_3.city.json");
  });

  it("settles release() when the engine dies mid-drop, instead of hanging", async () => {
    const handle = await readSource({
      runId: "run_4",
      table: table(),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    // duckdb-wasm's onError clears pending requests WITHOUT rejecting them, so
    // an unraced drop in a `finally` inside the FIFO slot would strand the
    // shared queue for the life of the page.
    dropBuffer.mockImplementationOnce(() => new Promise<void>(() => {}));
    const done = handle.release();
    for (const listener of [...deathListeners]) listener();
    await expect(done).resolves.toBeUndefined();
  });

  it("reports §6.1's read failure when the provider throws", async () => {
    await expect(
      readSource({
        runId: "run_5",
        table: table({
          source: async () => {
            throw new Error("NetworkError: failed to fetch");
          },
        }),
        lod: "2.2",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(SOURCE_READ_FAILED);
  });

  it("reports §6.1's memory failure when an allocation fails or the hand-off is refused", async () => {
    await expect(
      readSource({
        runId: "run_6",
        table: table({
          source: async () => {
            throw new RangeError("Array buffer allocation failed");
          },
        }),
        lod: "2.2",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(SOURCE_OUT_OF_MEMORY);

    registerBuffer.mockImplementation(async () => false);
    await expect(
      readSource({
        runId: "run_6b",
        table: table(),
        lod: "2.2",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(SOURCE_OUT_OF_MEMORY);
    // Nothing was registered, so nothing is left in the VFS.
    expect(dropBuffer).not.toHaveBeenCalled();
  });

  it("tells a DEAD engine apart from a refused allocation on the same `false`", async () => {
    // `registerBuffer` answers `false` for both (`duckdb.ts:728`), and the
    // hand-off races the ABORT signal only — so a death never rejects it. The
    // status is the only thing that separates §6.1's memory sentence from
    // "Analytics engine stopped", and reading it the other way round tells the
    // user their file is too large when the engine has simply gone.
    registerBuffer.mockImplementation(async () => false);
    getDuckDBStatus.mockImplementation(() => ({
      state: "failed",
      extensions: {},
    }));
    await expect(
      readSource({
        runId: "run_6c",
        table: table(),
        lod: "2.2",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(EngineDeadError);
    expect(dropBuffer).not.toHaveBeenCalled();
  });

  it("refuses a LoD the table does not have, and a table with no reader", async () => {
    await expect(
      readSource({
        runId: "run_7",
        table: table(),
        lod: "1.3",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(SOURCE_READ_FAILED);
    await expect(
      readSource({
        runId: "run_8",
        table: table({ reader: null, source: null, extension: null }),
        lod: "2.2",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(SOURCE_READ_FAILED);
  });

  it("cancels while the provider is in flight, before anything is registered", async () => {
    // IDENTITY, not a message: `raced` rejects with `new CancelledError()`,
    // whose message is EMPTY and whose `.name` is "Error". A `/cancelled/i`
    // match would never fire and a `.name === "CancelledError"` check would
    // read this as a source failure.
    const controller = new AbortController();
    const pending = readSource({
      runId: "run_9",
      table: table({ source: () => new Promise<Uint8Array>(() => {}) }),
      lod: "2.2",
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(registerBuffer).not.toHaveBeenCalled();
  });

  it("lets the engine's DEATH through the provider await as itself", async () => {
    const pending = readSource({
      runId: "run_9b",
      table: table({ source: () => new Promise<Uint8Array>(() => {}) }),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    for (const listener of [...deathListeners]) listener();
    await expect(pending).rejects.toBeInstanceOf(EngineDeadError);
    expect(registerBuffer).not.toHaveBeenCalled();
  });

  it("cancels DURING the hand-off, and drops a registration that lands late", async () => {
    // `registerBuffer` awaits the worker, and duckdb-wasm's `onError` clears
    // its pending requests WITHOUT rejecting them — so this await is raced
    // like every other. The hand-off that succeeds AFTER the race was lost
    // would otherwise leave a multi-megabyte buffer in the wasm heap under a
    // name nobody holds.
    let settle: (ok: boolean) => void = () => {};
    registerBuffer.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = readSource({
      runId: "run_9c",
      table: table(),
      lod: "2.2",
      signal: controller.signal,
    });
    // WAIT FOR THE HAND-OFF TO BE IN FLIGHT. `raced(registration, signal)` is
    // entered in the same continuation as `registerBuffer`, so once this has
    // passed the abort lands INSIDE that race. A bare `await Promise.resolve()`
    // fires a tick too early and would test `raced`'s already-aborted fast
    // path instead.
    await vi.waitFor(() => expect(registerBuffer).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    settle(true);
    await vi.waitFor(() =>
      expect(dropBuffer).toHaveBeenCalledWith("layer_3_run_9c.city.json"),
    );
  });

  it("lets the engine's DEATH through the hand-off as itself", async () => {
    registerBuffer.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const pending = readSource({
      runId: "run_9d",
      table: table(),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    // Again: wait until the hand-off's race is ACTUALLY installed. `raced`
    // removes its listeners on settle and `onEngineDeath` drops its waiters as
    // it fires (`engineAwait.ts`: "a `raced` STARTED after the death hears
    // nothing"), so firing between the two races would reach neither and this
    // promise would never settle.
    await vi.waitFor(() => expect(registerBuffer).toHaveBeenCalled());
    for (const listener of [...deathListeners]) listener();
    await expect(pending).rejects.toBeInstanceOf(EngineDeadError);
  });

  it("exports the id-mismatch sentence for the executor's id join to raise", () => {
    // §6.1: "detected by the id join, the only check possible". `readSource`
    // has no query door, so the join is the executor's — the WORDS live here,
    // with the other two, so nothing invents a fourth.
    expect(SOURCE_IDS_DIFFER).toBe(
      "The source no longer reads as the loaded layer (object ids differ); add the layer again",
    );
  });
});

describe("assertSourceIds", () => {
  it("passes when the reader answered for every id that was asked about", () => {
    expect(() =>
      assertSourceIds(["a", "b"], new Set(["a", "b", "c"])),
    ).not.toThrow();
    // Nothing was asked, so nothing can be missing.
    expect(() => assertSourceIds([], new Set())).not.toThrow();
  });

  it("fails on a PARTIAL answer, not only on an empty one", () => {
    // The bug this replaces: "no match at all" let a source that had lost
    // half its objects publish half a run, with the missing features written
    // as "not a solid" — a verdict on geometry nobody looked at.
    expect(() => assertSourceIds(["a", "b"], new Set(["a"]))).toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(() => assertSourceIds(["a"], new Set())).toThrow(SOURCE_IDS_DIFFER);
  });
});

describe("classifySourceFailure", () => {
  it("returns a cancellation and a death UNCHANGED", () => {
    const cancelled = new CancelledError();
    const dead = new EngineDeadError();
    expect(classifySourceFailure(cancelled)).toBe(cancelled);
    expect(classifySourceFailure(dead)).toBe(dead);
  });

  it("is §6.1's memory sentence for an allocation failure, wherever it came from", () => {
    expect(
      classifySourceFailure(new RangeError("Array buffer allocation failed"))
        ?.message,
    ).toBe(SOURCE_OUT_OF_MEMORY);
    // The engine's own wording, as `formatDuckDBError` leaves it.
    expect(
      classifySourceFailure(
        new Error("Out of Memory Error: failed to allocate block"),
      )?.message,
    ).toBe(SOURCE_OUT_OF_MEMORY);
  });

  it("is §6.1's read sentence for a reader, IO or decompression failure", () => {
    for (const message of [
      "Invalid Input Error: Malformed JSON in file",
      "IO Error: Could not read from file",
      "Serialization Error: unexpected end of gzip stream",
    ]) {
      expect(classifySourceFailure(new Error(message))?.message).toBe(
        SOURCE_READ_FAILED,
      );
    }
  });

  it("is NULL for an error that is OUR SQL's fault, so it travels as itself", () => {
    // A Binder, Catalog or Parser error means the statement this app built is
    // wrong. Dressing it as "network or decompression error" would send the
    // user to check their connection over a bug in the app.
    expect(
      classifySourceFailure(new Error("Binder Error: no such column")),
    ).toBeNull();
    expect(
      classifySourceFailure(
        new Error(
          "Catalog Error: Scalar Function with name st_3dvolume does not exist!",
        ),
      ),
    ).toBeNull();
  });
});

describe("readerQuery", () => {
  /** `ctx.query`'s own contract: it THROWS on a failed statement. */
  const ctxWith = (error: unknown) => {
    const warnings: string[] = [];
    return {
      warnings,
      ctx: {
        query: async () => {
          throw error;
        },
        warn: (text: string) => warnings.push(text),
      },
    };
  };

  it("returns the rows of a statement that worked", async () => {
    const warnings: string[] = [];
    const out = await readerQuery(
      {
        query: async () => ({
          ok: true as const,
          columns: ["id"],
          rows: [{ id: "a" }],
        }),
        warn: (text: string) => warnings.push(text),
      } as never,
      "Measuring solids",
      "SELECT 1",
    );
    expect(out.rows).toEqual([{ id: "a" }]);
    expect(warnings).toEqual([]);
  });

  it("turns a reader failure into §6.1's sentence, engine words to the log", async () => {
    const { ctx, warnings } = ctxWith(
      new Error("IO Error: Could not read from file"),
    );
    await expect(
      readerQuery(ctx as never, "Measuring solids", "SELECT 1"),
    ).rejects.toThrow(SOURCE_READ_FAILED);
    expect(warnings).toEqual(["IO Error: Could not read from file"]);
  });

  it("rethrows a cancellation, a death and OUR own SQL errors untouched", async () => {
    const cancelled = ctxWith(new CancelledError());
    await expect(
      readerQuery(cancelled.ctx as never, "Measuring solids", "SELECT 1"),
    ).rejects.toBeInstanceOf(CancelledError);
    const dead = ctxWith(new EngineDeadError());
    await expect(
      readerQuery(dead.ctx as never, "Measuring solids", "SELECT 1"),
    ).rejects.toBeInstanceOf(EngineDeadError);
    const ours = ctxWith(new Error("Binder Error: no such column"));
    await expect(
      readerQuery(ours.ctx as never, "Measuring solids", "SELECT 1"),
    ).rejects.toThrow(/Binder Error/);
    // Nothing was translated, so nothing was worth repeating into the log.
    expect([...cancelled.warnings, ...dead.warnings, ...ours.warnings]).toEqual(
      [],
    );
  });
});

describe("sourceWorkloadNote", () => {
  it("is silent under §6's 100 MB threshold, and for an unknown size", () => {
    expect(sourceWorkloadNote(table({ sourceBytes: 99_000_000 }))).toBeNull();
    expect(sourceWorkloadNote(table({ sourceBytes: null }))).toBeNull();
  });

  it("is §6's sentence, with the REAL number, above it", () => {
    expect(sourceWorkloadNote(table({ sourceBytes: 180_000_000 }))).toBe(
      "Re-reads a 180 MB source; this can take a minute and needs memory",
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/sourceRead.test.ts
```

Expected: FAIL — the module does not exist, and `LayerTable` has no `extension` or `sourceBytes`.

- [ ] **Step 3: Add the two fields to `LayerTable`**

In `src/insights/layerTables.ts`, inside `interface LayerTable`, after the `reader` field:

```ts
  /**
   * The VFS spelling the reader expects, or null for a fallback table.
   *
   * It is reconstructible today only by parsing `sourceName`
   * (`` `${table}.${extension}` ``), which is exactly the fragility
   * `export.ts` routed around by making its CALLER pass `sourceExtension`
   * (`CityParquetExportRequest`). Stated once, here, so a second reader of the
   * source does not have to guess.
   */
  readonly extension: ReaderExtension | null;
  /**
   * The source's size in bytes at BUILD time, or null when there was none.
   *
   * Captured before `registerBuffer` detaches the array, because after that
   * the number exists nowhere: spec §6's workload note ("Re-reads a 180 MB
   * source…") has to be shown BEFORE any run, and re-obtaining the bytes to
   * measure them is the very cost the note warns about.
   */
  readonly sourceBytes: number | null;
```

- [ ] **Step 4: Fill them in at the two build sites**

In `buildFromReader`, find:

```ts
const sourceName = `${table}.${source.extension}`;
const registered = await registerBuffer(sourceName, source.bytes);
```

and replace with:

```ts
const sourceName = `${table}.${source.extension}`;
// BEFORE the register: `registerBuffer` transfers the array to the worker and
// DETACHES it, after which `byteLength` is 0.
const sourceBytes = source.bytes.byteLength;
const registered = await registerBuffer(sourceName, source.bytes);
```

and in the same function's returned object, after `reader: source.reader,`:

```ts
      extension: source.extension,
      sourceBytes,
```

In `buildFromRows`, in its returned object, beside `reader: null` (a fallback table has no reader and no source of its own):

```ts
      extension: null,
      sourceBytes: null,
```

- [ ] **Step 5: Write `sourceRead.ts`**

Create `src/features/processing/sourceRead.ts`:

```ts
/**
 * Spec §6.1's "Reading source" phase: re-registering a reader-backed layer's
 * bytes so a run can read GEOMETRY, and dropping them the moment the parse is
 * done.
 *
 * `export.ts:558-578` is the working precedent and the shape is copied from it:
 * a FRESH array from the provider → ONE `registerBuffer` → a `FROM` clause →
 * `dropBuffer` as soon as the one statement has parsed, with the same call in a
 * `finally` for every other exit. A 300 MB CityJSON must not sit in the wasm
 * heap for the length of a compute, which is what §6's workload note is warning
 * the user about.
 *
 * THE LOD LABEL → COLUMN MAPPING COMES FROM `LodColumn`, NEVER FROM STRING
 * SURGERY. `read_cityjson(name, lod => 'X')` requires the file's OWN label
 * ('2.2', never '2') and names the column the label with "." → "_". `"0"` and
 * `"0.0"` are different columns and only the file knows which it has, so the
 * suffix is read off the table's `lods` and never derived.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts`.
 */
import {
  dropBuffer,
  getDuckDBStatus,
  registerBuffer,
} from "../../insights/duckdb";
import {
  CancelledError,
  EngineDeadError,
  raced,
  racedWithDeath,
} from "../../insights/engineAwait";
import { quoteLiteral } from "../../insights/sql";
import type { LayerTable } from "../../insights/layerTables";
import type { QueryOutcome } from "../../insights/duckdb";
// TYPE-ONLY, and therefore erased: this module reaches no queue at runtime.
import type { ToolContext } from "./runQueue";

/** Spec §6.1's three source-failure first lines, verbatim, in one place. */
export const SOURCE_READ_FAILED =
  "Could not re-read the source (network or decompression error)";
/**
 * Raised by the EXECUTOR, not by `readSource`: §6.1 says the mismatch is
 * "detected by the id join, the only check possible", and the join needs a
 * query door this module does not have. The words live here with the other
 * two so no tool invents a fourth wording.
 */
export const SOURCE_IDS_DIFFER =
  "The source no longer reads as the loaded layer (object ids differ); add the layer again";
export const SOURCE_OUT_OF_MEMORY = "Not enough memory to read the source";

/** §6's threshold for the workload note: "above 100 MB". */
const WORKLOAD_NOTE_BYTES = 100_000_000;

export interface ReadSourceHandle {
  /** e.g. `read_cityjson('layer_3_run_7.city.json', lod => '2.2')` */
  readonly from: string;
  readonly geometryColumn: string;
  readonly propertiesColumn: string;
  /** `dropBuffer`; idempotent, never throws. Call it from a `finally`. */
  release(): Promise<void>;
}

/**
 * Spec §6: "a workload note when the target's source is large: 'Re-reads a
 * 180 MB source; this can take a minute and needs memory' above 100 MB".
 *
 * Null when the size is unknown — a layer whose table was built from rows has
 * no source to re-read, and inventing a number for it would be worse than
 * saying nothing.
 */
export function sourceWorkloadNote(table: LayerTable): string | null {
  const bytes = table.sourceBytes;
  if (bytes === null || bytes <= WORKLOAD_NOTE_BYTES) return null;
  const mb = Math.round(bytes / 1_000_000);
  return `Re-reads a ${mb} MB source; this can take a minute and needs memory`;
}

/** Is this the failure of an allocation rather than of a fetch? */
function isMemoryFailure(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /out of memory|allocation failed|Array buffer allocation/i.test(
    message,
  );
}

/**
 * An error the APP built the statement wrong with, rather than one the SOURCE
 * caused.
 *
 * DuckDB names its own categories and `formatDuckDBError` keeps the first line
 * whole (`duckdb.ts:263-273`), so the prefix survives to here. A Binder,
 * Catalog or Parser error is this app's SQL being wrong; telling the user to
 * "check the connection" over it would send them to fix their network because
 * we misspelled a column.
 */
const OUR_FAULT = /^(Binder|Catalog|Parser|Syntax) Error/i;

/**
 * Anything the reader, the decompressor or the file itself raised. DuckDB's
 * own categories for a source it cannot read, plus the shapes a provider's
 * fetch/gunzip produces.
 *
 * `Conversion Error` is IN, deliberately: in a statement whose only inputs are
 * the reader's own columns, it is the file handing back a value the reader
 * cannot turn into the type it declared — a bad WKB blob, a malformed
 * coordinate — and not a cast this app wrote.
 */
const SOURCE_FAULT =
  /invalid input|io error|serialization error|conversion error|decompress|gzip|zstd|json/i;

/**
 * Spec §6.1's source-failure sentence for an error raised while re-reading the
 * source, or `null` when the error is not a source problem and must travel as
 * it is.
 *
 * ONE classifier for BOTH stages. The fetch is the obvious one, but the READER
 * STATEMENT is where the parse and the wasm allocation actually happen: a
 * 300 MB CityJSON that gunzips to garbage or exhausts the heap fails THERE, and
 * without this the user would read DuckDB's own words where §6.1 promises a
 * sentence. The executors call it around their reader statement; `readSource`
 * calls it around the fetch and the hand-off.
 *
 * A `CancelledError` and an `EngineDeadError` come back UNCHANGED — `instanceof`
 * and never `.name`, because both classes extend `Error` without setting one
 * (`engineAwait.ts:33, 44`), so a `.name` test reads every cancellation as a
 * read failure. Neither is a failure of the source: the queue's own catch turns
 * them into "cancelled" and §6.1's "Analytics engine stopped".
 */
export function classifySourceFailure(error: unknown): Error | null {
  if (error instanceof CancelledError || error instanceof EngineDeadError) {
    return error;
  }
  if (isMemoryFailure(error)) return new Error(SOURCE_OUT_OF_MEMORY);
  const message = error instanceof Error ? error.message : String(error);
  if (OUR_FAULT.test(message)) return null;
  return SOURCE_FAULT.test(message) ? new Error(SOURCE_READ_FAILED) : null;
}

/**
 * Spec §6.1's id join — "the only check possible" — as ONE rule both solids
 * tools obey.
 *
 * The threshold is EVERY id, not "no match at all". A contributor is chosen
 * because the loaded MODEL says it has geometry at this LoD, and the reader
 * returns a row per object of the file; so an id that does not come back means
 * the file no longer holds that object, which is precisely §6.1's "no longer
 * reads as the loaded layer". Accepting a partial answer would publish the
 * missing features as "not a solid" — a verdict on geometry nobody looked at.
 *
 * What §6.1 excludes is still excluded: a URL whose CONTENT changed under the
 * same ids answers for every id and is not detected. That is the spec's own
 * stated limit, not a gap here.
 */
export function assertSourceIds(
  requested: ReadonlyArray<string>,
  returned: ReadonlySet<string>,
): void {
  for (const id of requested) {
    if (!returned.has(id)) throw new Error(SOURCE_IDS_DIFFER);
  }
}

/**
 * `ctx.query` for a statement that reads the RE-READ SOURCE.
 *
 * Both solids tools issue exactly one such statement and both owe §6.1 the
 * same three things: its sentence when the SOURCE failed, the engine's own
 * words kept in the log, and an error that is the APP's fault rethrown as
 * itself. Written once, here, beside the classifier — a second copy in the
 * second tool is how the two would come to disagree.
 *
 * The `ToolContext` import is TYPE-ONLY and therefore erased, so this module
 * still pulls in no queue at runtime.
 */
export async function readerQuery(
  ctx: Pick<ToolContext, "query" | "warn">,
  label: string,
  sql: string,
): Promise<Extract<QueryOutcome, { readonly ok: true }>> {
  try {
    const out = await ctx.query(label, sql);
    // A type guard, not logic: `ctx.query` throws on a failed statement.
    if (!out.ok) throw new Error(out.message);
    return out;
  } catch (error) {
    const failure = classifySourceFailure(error);
    // `null` is "not a source problem" and `failure === error` is a
    // cancellation or a death: both travel exactly as they are.
    if (failure === null || failure === error) throw error;
    // §6.4 keeps the reproducible record — the same shape the extension phase
    // already uses, which logs DuckDB's reason while the card shows §5's
    // sentence (`runQueue.ts:596-601`).
    ctx.warn(error instanceof Error ? error.message : String(error));
    throw failure;
  }
}

export async function readSource(input: {
  readonly runId: string;
  readonly table: LayerTable;
  /** The LoD LABEL ("2.2"), never a suffix. */
  readonly lod: string;
  readonly signal: AbortSignal;
}): Promise<ReadSourceHandle> {
  const { table, runId, lod, signal } = input;
  const { reader, extension, source } = table;
  // Eligibility guarantees all three for a `needsReader` tool
  // (`eligibility.ts:55-69`), so this is a narrowing, not a policy — but it
  // fails with §6.1's own sentence rather than with a TypeError.
  if (reader === null || extension === null || source === null) {
    throw new Error(SOURCE_READ_FAILED);
  }
  const column = table.lods.find((l) => l.label === lod);
  if (column === undefined) throw new Error(SOURCE_READ_FAILED);

  // A name per RUN. `registerBuffer` detaches what it is given and a name read
  // after `dropBuffer` still RESOLVES, to garbage (`duckdb.ts:717-722`), so a
  // run never addresses a name another read may have dropped.
  const name = `${table.table}_${runId}.${extension}`;

  let bytes: Uint8Array;
  try {
    // `raced` against the run's signal: a Cancel pressed during a 300 MB fetch
    // rejects with `CancelledError`, which is what makes the card read
    // "cancelled" rather than "failed".
    bytes = await raced(source(), signal);
  } catch (error) {
    // A cancellation and a death come back from the classifier UNCHANGED, so
    // the queue's catch still reads them as "cancelled" and §6.1's "Analytics
    // engine stopped". Everything a PROVIDER can raise is a read failure by
    // definition — it only fetches and decompresses — so the `null` case
    // (an error the classifier does not recognise) falls back to §6.1's read
    // sentence here rather than travelling raw.
    throw classifySourceFailure(error) ?? new Error(SOURCE_READ_FAILED);
  }

  // RACED, like every other engine await. `registerBuffer` posts to the worker
  // and waits, and duckdb-wasm's `onError` clears its pending requests WITHOUT
  // rejecting them — so an unraced hand-off inside the run's FIFO slot strands
  // the shared queue for the life of the page. Task 25 puts the same race
  // inside the primitive; this is the one call that cannot wait for it,
  // because Task 8 switches a tool that goes through here ON before then.
  const registration = registerBuffer(name, bytes);
  let registered: boolean;
  try {
    registered = await raced(registration, signal);
  } catch (error) {
    // The hand-off may still SUCCEED after the race was lost — a cancel does
    // not reach the worker. Drop what lands, or a multi-megabyte buffer sits
    // in the wasm heap under a name nobody holds. Fire-and-forget and
    // swallowed: the caller is already leaving with the real error.
    void registration.then(
      (ok) => {
        if (ok) void racedWithDeath(dropBuffer(name)).catch(() => {});
      },
      () => {},
    );
    throw classifySourceFailure(error) ?? new Error(SOURCE_READ_FAILED);
  }
  if (!registered) {
    // The hand-off was REFUSED (not lost), and `false` means two different
    // things: `registerBuffer` returns it for a DEAD engine as well as for a
    // refused allocation (`duckdb.ts:728` — `if (!db || status.state !==
    // "ready") return false;`), and `raced(…, signal)` above races the ABORT
    // signal only, so a death does not reject it. Telling the user the source
    // was too large when the engine had stopped is the wrong sentence, so the
    // status decides — the same distinction `vectorTable.ts` makes on the same
    // `false`.
    if (getDuckDBStatus().state !== "ready") throw new EngineDeadError();
    throw new Error(SOURCE_OUT_OF_MEMORY);
  }

  let released = false;
  return {
    from: `${reader}(${quoteLiteral(name)}, lod => ${quoteLiteral(column.label)})`,
    geometryColumn: `geometry_lod${column.suffix}`,
    propertiesColumn: `geometry_properties_lod${column.suffix}`,
    async release() {
      if (released) return;
      released = true;
      // RACED, and swallowed. `dropBuffer`'s body swallows a REJECTION but
      // says nothing about a promise that never settles, and duckdb-wasm's
      // `onError` clears its pending requests WITHOUT rejecting them. This is
      // awaited from a `finally` inside the run's FIFO slot, so a death here
      // would strand the shared queue for the life of the page.
      await racedWithDeath(dropBuffer(name)).catch(() => {});
    },
  };
}
```

- [ ] **Step 6: Sweep the `LayerTable` literals**

The two new fields are REQUIRED, which is the point: every place that builds a `LayerTable` now has to say whether it has a source. Find them and fix them:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx tsc -b --noEmit 2>&1 | grep -E "extension|sourceBytes" | cut -d'(' -f1 | sort -u
```

The starting list, from `grep -rn 'rowCount:' src tests`, is: `tests/unit/features/query/mapFilterSync.test.ts`, `tests/unit/features/processing/scope.test.ts`, `tests/unit/features/processing/runQueue.test.ts`, `tests/unit/features/processing/roofMetricsRun.test.ts`, `tests/unit/ui/table/ExportDialog.test.tsx`, `tests/unit/ui/table/useLayerCounts.test.tsx`, `tests/unit/ui/table/useLayerQuery.test.tsx`, `tests/unit/ui/table/TablePanel.test.tsx`, `tests/unit/ui/inspector/StatsTabDuckdb.test.tsx`, `tests/unit/ui/processing/CatalogueView.test.tsx`, `tests/unit/ui/processing/useToolForm.test.tsx`, `tests/unit/ui/processing/ToolView.test.tsx`, `tests/unit/ui/processing/extensionChip.test.tsx`, `tests/unit/ui/processing/engineStopped.test.tsx`, `tests/unit/ui/processing/roofLayerFixture.tsx`, `tests/unit/insights/layerTablesBuild.test.ts`. (`src/ui/inspector/StatsTab.tsx` has its OWN interface with a `rowCount`; it is not a `LayerTable` and must not gain the fields.)

In each, beside `rowCount:`, add:

```ts
          extension: null,
          sourceBytes: null,
```

except where the fixture describes a reader-backed layer, where the honest pair is the reader's own spelling — in `tests/unit/ui/processing/roofLayerFixture.tsx` and `tests/unit/ui/processing/useToolForm.test.tsx`'s `readyTable(true)`:

```ts
          extension: "city.json",
          sourceBytes: null,
```

In `tests/unit/insights/layerTablesBuild.test.ts`, the reader build's `toMatchObject` ("publishes the table with its column kinds, LoDs and row count", around `:286`) additionally asserts the two new fields. That suite's source is the MOCKED `new Uint8Array(16)` its `PROVIDER`/`bytes` fixture hands in (`:187, :192`), not `fixtures/two-buildings.city.json` — the whole engine is a `vi.mock` there — so the honest byte count is **16**, and asserting it is what proves the capture happens BEFORE `registerBuffer` detaches the array:

```ts
      extension: "city.json",
      sourceBytes: 16,
```

and the flat-fallback build's assertion (the `toMatchObject` with `reader: null, source: null`, around `:975`) gains `extension: null, sourceBytes: null`.

- [ ] **Step 7: Start a reader-backed run in the `"source"` phase**

In `src/features/processing/runQueue.ts`, find:

```ts
patch(id, {
  status: "running",
  phase: "compute",
  featureIds: scope.featureIds,
  scopeCount: scope.count,
});
```

and replace with:

```ts
patch(id, {
  status: "running",
  // §6.1's phases are discrete and in order: "Reading source (registering
  // bytes; skipped for tools that need none), Computing". A tool that
  // re-reads its source starts there and calls `ctx.phase("compute")` once
  // its handle is open; a tool that needs no source never shows the phase
  // at all (`roofMetrics.ts` and `heightFromExtent.ts` go straight to
  // Computing). Deciding it here rather than inside the executor is what
  // stops the progress block flashing "Computing" for one frame before a
  // 300 MB read.
  phase: tool.needsReader ? "source" : "compute",
  featureIds: scope.featureIds,
  scopeCount: scope.count,
});
```

and append to `tests/unit/features/processing/runQueue.test.ts`:

```ts
it("hands a reader-backed executor the Reading source phase, not Computing", async () => {
  // §6.1: the phases are discrete and in order — "Loading extension (skipped
  // once loaded), Reading source (registering bytes; skipped for tools that
  // need none), Computing". A run that re-reads a 300 MB source must not show
  // "Computing" for the length of the read.
  //
  // `three_d` reads as ALREADY LOADED, so the extension phase is skipped
  // outright: this suite's `beforeEach` leaves `isExtensionLoaded` false and
  // `ensureExtension` resolving false, which would fail a `measure-solids` run
  // with the offline sentence before any executor ran.
  vi.mocked(isExtensionLoaded).mockReturnValue(true);
  let phaseOnEntry: string | null = null;
  registerExecutor("measure-solids", async (record) => {
    // The record as the queue left it the instant before the call.
    phaseOnEntry = runById(record.id)?.phase ?? null;
    return { columns: [], rows: new Map(), measured: 0, skipped: [] };
  });
  const first = submitRun(request({ toolId: "measure-solids" }));
  await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
  expect(phaseOnEntry).toBe("source");

  // And the tool that needs no source still starts in Computing.
  let heightPhase: string | null = null;
  registerExecutor("height-from-extent", async (record) => {
    heightPhase = runById(record.id)?.phase ?? null;
    return { columns: [], rows: new Map(), measured: 0, skipped: [] };
  });
  const second = submitRun(request({ toolId: "height-from-extent" }));
  await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));
  expect(heightPhase).toBe("compute");
});
```

(`request`, `runById`, `isExtensionLoaded` and `registerExecutor` are the suite's own helpers/imports. There is NO `flush()` in this suite — every case settles with `await vi.waitFor(() => expect(runById(id)?.status).toBe("done"))`, and this one does the same. `measure-solids` is already in its `afterEach` cleanup list.)

- [ ] **Step 8: Show the workload note in the form**

In `src/ui/processing/useToolForm.ts`, add the import:

```ts
import { sourceWorkloadNote } from "../../features/processing/sourceRead";
```

and, immediately after the `extensionNote` block:

```ts
// §6: "a workload note when the target's source is large". Only for a tool
// that RE-READS the source — a tool computing from the table or the model
// pays none of this cost, and a warning about a read that will not happen is
// a false alarm.
//
// `tableInfo?.state`, not `tableInfo !== null`: `tableInfo` is
// `tables[target.id]` under an indexed lookup (`useToolForm.ts:132-133`), so
// its type carries `undefined` as well as `null` and the line above it uses
// the same truthy shape.
const workloadNote =
  tool.needsReader && tableInfo?.state === "ready"
    ? sourceWorkloadNote(tableInfo.info)
    : null;
```

and add `workloadNote,` to the returned object beside `extensionNote`.

In `src/ui/processing/ToolView.tsx`, after the extension-note block, insert the `{…}` block below — the `<>` and `</>` are only there to keep the snippet valid on its own (a bare `{…}` in a code fence is a BLOCK statement, and the formatter rewrites it into one with a stray `;` inside the JSX). They are not part of the edit:

```tsx
<>
  {f.workloadNote !== null && (
    <p className="processing-note">{f.workloadNote}</p>
  )}
</>
```

and append to `tests/unit/ui/processing/ToolView.test.tsx`:

```ts
it("warns about a large source only for a tool that re-reads it", () => {
  // §6, verbatim, with the REAL number: "Re-reads a 180 MB source; this can
  // take a minute and needs memory".
  const id = addCityLayer();
  useLayerTableStore.setState((s) => {
    const entry = s.tables[id];
    if (entry?.state !== "ready") return s;
    return {
      tables: {
        ...s.tables,
        [id]: {
          ...entry,
          info: { ...entry.info, sourceBytes: 180_000_000 },
        },
      },
    };
  });
  render(<ToolView toolId="height-from-extent" />);
  // `needsReader: false` — no read, no note.
  expect(screen.queryByText(/Re-reads a/)).toBeNull();
});
```

(The positive half of this belongs to Task 8, where `measure-solids` is switched on and its form renders at all.)

- [ ] **Step 9: Confirm the `layerTables` mock factories need nothing**

This task adds two `LayerTable` FIELDS and no new `layerTables` EXPORT, so the six `vi.mock(".../insights/layerTables")` factories are unaffected. Verify rather than assume:

```bash
grep -rl "insights/layerTables" tests/ | xargs grep -l "vi.mock"
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx tsc -b --noEmit
npx vp check
# Global Constraints: a full-suite run goes to a FILE in the BACKGROUND.
npx vitest run tests/unit > /tmp/m3-t5-unit.log 2>&1 &
wait
tail -5 /tmp/m3-t5-unit.log
```

Expected: PASS (report the exit status), and `vp check` still at 0 errors / 56 warnings.

- [ ] **Step 10: Commit**

```bash
git add src/features/processing/sourceRead.ts src/insights/layerTables.ts \
  src/features/processing/runQueue.ts src/ui/processing/useToolForm.ts \
  src/ui/processing/ToolView.tsx tests/unit/features/processing/sourceRead.test.ts \
  tests/unit/features/processing/runQueue.test.ts \
  tests/unit/ui/processing/ToolView.test.tsx
# plus the literal sweep from Step 6 — add exactly the files `tsc` named:
git add $(git diff --name-only -- tests/)
git commit -m "feat: a run can re-read its layer's source in its own phase"
```

---
