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
//
// THE MOCK'S VARIABLES GO THROUGH `vi.hoisted`. This static import runs BEFORE
// the module body, so it pulls in the mocked `insights/duckdb` and runs the
// factory below while a plain `const registerBuffer = vi.fn()` would still be
// in its temporal dead zone — the suite would fail at COLLECTION with a
// ReferenceError. `vi.hoisted` is lifted above the imports, so the factory
// finds them initialised.
import {
  CancelledError,
  EngineDeadError,
} from "../../../../src/insights/engineAwait";

const {
  registerBuffer,
  dropBuffer,
  getDuckDBStatus,
  READY_STATUS,
  deathListeners,
} = vi.hoisted(() => {
  /** The engine's own status, module-level so a case can move it: a refused
   *  `registerBuffer` means "too large" only while the engine is still ready. */
  const ready = { state: "ready", extensions: {} } as const;
  return {
    // The parameters are declared so a case can replace the implementation
    // with one that reads the array it is handed — the detaching mock below.
    registerBuffer: vi.fn(async (_name: string, _bytes: Uint8Array) => true),
    dropBuffer: vi.fn(async () => {}),
    getDuckDBStatus: vi.fn(
      (): { state: string; extensions: Record<string, unknown> } => ready,
    ),
    READY_STATUS: ready,
    /** Every death listener `raced` installs, so a test can fire one. */
    deathListeners: [] as Array<() => void>,
  };
});

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

/**
 * Fire the engine's death the way `onEngineDeath` does: every waiter once, and
 * the list DROPPED as it fires ("a `raced` STARTED after the death hears
 * nothing"). Draining rather than iterating in place also matters mechanically
 * — `raced`'s own unsubscribe splices this array, so a live iteration would
 * skip half the listeners.
 */
function fireEngineDeath(): void {
  for (const listener of deathListeners.splice(0)) listener();
}

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
    sourceFeatureIds: null,
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

  it("calls the provider on EVERY read, against a hand-off that DETACHES", async () => {
    // The `SourceProvider` contract is the whole reason this matters:
    // `registerBuffer` hands the array to the worker in the TRANSFER list, which
    // DETACHES the caller's `ArrayBuffer` — after one hand-off the view has
    // length 0 and "must never be read, re-registered or handed to a second
    // consumer" (`duckdb.ts`'s own words). Two runs over one layer is the
    // ordinary case, so a `readSource` that cached the first array would hand
    // the second run an EMPTY file and the run would fail on a parse error.
    //
    // This mock detaches the way the real one does, so the second read's byte
    // count is the assertion: a live array or a dead one.
    const handed: number[] = [];
    registerBuffer.mockImplementation(async (_name, bytes) => {
      handed.push(bytes.byteLength);
      // The transfer's observable effect, for real: `structuredClone` with a
      // `transfer` list detaches the buffer exactly as `postTask` does.
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
      return true;
    });
    let calls = 0;
    const source = async () => {
      calls += 1;
      return new Uint8Array([1, 2, 3, 4]);
    };

    const first = await readSource({
      runId: "run_a",
      table: table({ source }),
      lod: "2.2",
      signal: new AbortController().signal,
    });
    await first.release();
    const second = await readSource({
      runId: "run_b",
      table: table({ source }),
      lod: "2.2",
      signal: new AbortController().signal,
    });

    expect(calls).toBe(2);
    // The SECOND 4 is the point: the second read handed over a LIVE array.
    expect(handed).toEqual([4, 4]);
    // And under its own name, so it cannot read the one the first read dropped.
    expect(second.from).toBe(
      "read_cityjson('layer_3_run_b.city.json', lod => '2.2')",
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
    fireEngineDeath();
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
    // `registerBuffer` answers `false` for both — no database, or a refused
    // allocation. The race the hand-off sits in covers the engine's DEATH as
    // well as the abort, but it cannot help here: `onEngineDeath` fires once and
    // drops its waiters, so a hand-off that STARTS after the engine has already
    // gone hears nothing and resolves `false` like any other refusal. The status
    // is the only thing that separates §6.1's memory sentence from "Analytics
    // engine stopped", and reading it the other way round tells the user their
    // file is too large when the engine has simply gone.
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
    fireEngineDeath();
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
    fireEngineDeath();
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
