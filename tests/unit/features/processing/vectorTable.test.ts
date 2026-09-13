/**
 * `__src_<runId>`: the NDJSON, the one CREATE, and a release that runs on
 * every exit path and never throws.
 *
 * The builders are asserted against exact strings — the statement lands
 * verbatim in §6.4's log and is what a planner reruns by hand — and
 * `createVectorTable` is driven over a fake `query` plus a mocked engine seam,
 * because what is under test is the ORDER of the four calls, not DuckDB.
 *
 * The encoder is under test for its BOUNDS as much as for its shape: a source
 * whose one feature is a five-megabyte ring must not block Cancel inside
 * `JSON.stringify`, the UTF-8 encoding or the final copy, so every budget has
 * a case that proves where it stopped by counting what was never read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered: Array<{ name: string; text: string }> = [];
const dropped: string[] = [];
const statements: string[] = [];
let registerOk = true;
/** A registration the test holds open, so the race above it can be lost while
 *  the hand-off is still in flight. `null` = answer immediately. */
let registerGate: { resolve: (ok: boolean) => void } | null = null;
/** What `getDuckDBStatus()` reports — the only way to tell a dead engine from
 *  a registration that merely failed (`duckdb.ts:240`). */
let engineState: "ready" | "failed" = "ready";

vi.mock("../../../../src/insights/duckdb", () => ({
  registerBuffer: vi.fn(async (name: string, bytes: Uint8Array) => {
    if (registerGate !== null) {
      const gate = registerGate;
      return await new Promise<boolean>((resolve) => {
        gate.resolve = (ok: boolean) => {
          if (ok) registered.push({ name, text: "" });
          resolve(ok);
        };
      });
    }
    if (!registerOk) return false;
    registered.push({ name, text: new TextDecoder().decode(bytes) });
    return true;
  }),
  dropBuffer: vi.fn(async (name: string) => {
    dropped.push(name);
  }),
  ddl: vi.fn(async (sql: string) => {
    statements.push(sql);
    return { ok: true as const, columns: [], rows: [] };
  }),
  runQuery: vi.fn(async () => ({ ok: true as const, columns: [], rows: [] })),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: engineState,
    extensions: {},
    loadedExtensions: [],
    platform: null,
  })),
  // The rest of the seam, so `sourceRead` (whose §6.1 sentences this file
  // imports) links against the mock rather than pulling in the ONE module that
  // imports `@duckdb/duckdb-wasm`. A named import missing from a mock factory
  // is a link error, not a lazy one.
  ddlBatch: vi.fn(async () => ({ ok: true as const, columns: [], rows: [] })),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  formatDuckDBError: (e: unknown) => String(e),
  getEngineGeneration: vi.fn(() => 1),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
}));

// EVERY import that reaches `insights/duckdb` is dynamic and comes AFTER the
// mock state above is initialised: a static one is hoisted past those `let`s
// and the factory reads them in their temporal dead zone.
const {
  buildDropVectorTableSql,
  buildVectorTableSql,
  createVectorTable,
  encodeProjectedFeatures,
  vectorTableName,
} = await import("../../../../src/features/processing/vectorTable");
type Projected =
  import("../../../../src/features/processing/vectorSource").ProjectedFeature;
type Preflight =
  import("../../../../src/features/processing/vectorSource").VectorPreflight;

function feature(idx: number, over: Partial<Projected> = {}): Projected {
  return {
    idx,
    stableId: `id:string:z${idx}`,
    featureId: `z${idx}`,
    properties: { zone: "A", noise: 62 },
    wkt: "POLYGON ((0 0, 1 0, 1 1, 0 0))",
    ...over,
  };
}

/** A feature whose `wkt` is only produced when something reads it, so a test
 *  can prove a walk stopped BEFORE serialising the rest. */
function counted(
  idx: number,
  wkt: string,
  seen: { reads: number; onRead?: () => void },
): Projected {
  return {
    idx,
    stableId: `id:string:z${idx}`,
    featureId: `z${idx}`,
    properties: { zone: "A" },
    get wkt() {
      seen.reads += 1;
      seen.onRead?.();
      return wkt;
    },
  };
}

/** ~5 MB of ring, which is one feature over any sane byte budget. */
function hugeWkt(): string {
  return `POLYGON ((${"0 0, ".repeat(1_000_000)}0 0))`;
}

function preflight(...features: Projected[]): Preflight {
  return {
    features,
    skipped: 0,
    propertyKeys: ["zone", "noise"],
    propertyTypes: new Map([
      ["zone", "VARCHAR"],
      ["noise", "DOUBLE"],
    ]),
    polygonOnly: true,
  };
}

beforeEach(() => {
  registered.length = 0;
  dropped.length = 0;
  statements.length = 0;
  registerOk = true;
  registerGate = null;
  engineState = "ready";
});

describe("the per-run names and statements", () => {
  it("names the table after the run, so nothing outlives its owner", () => {
    expect(vectorTableName("run_7")).toBe("__src_run_7");
  });

  it("reads the NDJSON with an explicit column list, not by inference", () => {
    expect(buildVectorTableSql("__src_run_7", "__src_run_7.json")).toBe(
      'CREATE OR REPLACE TABLE "__src_run_7" AS SELECT "idx", "sid", "fid", ' +
        '"props", ST_GeomFromText("wkt") AS "geom" FROM ' +
        "read_json('__src_run_7.json', format = 'newline_delimited', " +
        "columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', " +
        "props: 'JSON', wkt: 'VARCHAR'})",
    );
  });

  it("drops the table by name, tolerating one that was never made", () => {
    expect(buildDropVectorTableSql("__src_run_7")).toBe(
      'DROP TABLE IF EXISTS "__src_run_7"',
    );
  });
});

describe("encodeProjectedFeatures", () => {
  it("writes one JSON object per line, with the five columns", async () => {
    const text = new TextDecoder().decode(
      await encodeProjectedFeatures([feature(0), feature(3)]),
    );
    expect(text.trimEnd().split("\n")).toEqual([
      '{"idx":0,"sid":"id:string:z0","fid":"z0","props":{"zone":"A","noise":62},"wkt":"POLYGON ((0 0, 1 0, 1 1, 0 0))"}',
      '{"idx":3,"sid":"id:string:z3","fid":"z3","props":{"zone":"A","noise":62},"wkt":"POLYGON ((0 0, 1 0, 1 1, 0 0))"}',
    ]);
  });

  it("keeps a null feature id as null rather than dropping the key", async () => {
    const text = new TextDecoder().decode(
      await encodeProjectedFeatures([feature(0, { featureId: null })]),
    );
    expect(text).toContain('"fid":null');
  });

  it("survives a BIGINT property, which JSON.stringify refuses outright", async () => {
    const text = new TextDecoder().decode(
      await encodeProjectedFeatures([
        feature(0, { properties: { big: 9007199254740993n } }),
      ]),
    );
    expect(text).toContain('"big":"9007199254740993"');
  });

  it("encodes in batches: it checkpoints and yields on a large source", async () => {
    const many = Array.from({ length: 2_500 }, (_, i) => feature(i));
    let checkpoints = 0;
    let turned = false;
    setTimeout(() => {
      turned = true;
    }, 0);
    const bytes = await encodeProjectedFeatures(many, {
      checkpoint: () => (checkpoints += 1),
    });
    expect(checkpoints).toBeGreaterThan(0);
    expect(turned).toBe(true);
    expect(new TextDecoder().decode(bytes).trimEnd().split("\n")).toHaveLength(
      2_500,
    );
  });

  it("stops where a throwing checkpoint says, without building the rest", async () => {
    const many = Array.from({ length: 2_500 }, (_, i) => feature(i));
    await expect(
      encodeProjectedFeatures(many, {
        checkpoint: () => {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
  });

  it("yields on BYTES too, long before a thousand features have gone by", async () => {
    // Two features is nowhere near the feature batch, so a checkpoint here can
    // only have come from the byte budget — which is the half of the bound
    // that a source of few enormous features needs.
    const seen = { reads: 0 };
    let checkpoints = 0;
    const bytes = await encodeProjectedFeatures(
      [counted(0, hugeWkt(), seen), counted(1, "POINT (1 1)", seen)],
      { checkpoint: () => (checkpoints += 1) },
    );
    expect(checkpoints).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes).trimEnd().split("\n")).toHaveLength(
      2,
    );
  });

  it("stops after ONE very large feature when Cancel lands on a timer", async () => {
    // §6.1's Cancel must land INSIDE the encoding of a source whose features
    // are few and enormous. The timer can only fire while the walk is at a
    // yield, so the checkpoint AFTER the macrotask is the one that sees it —
    // and the second feature's `wkt` is never even read.
    const seen = { reads: 0 };
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);
    await expect(
      encodeProjectedFeatures(
        [counted(0, hugeWkt(), seen), counted(1, "POINT (1 1)", seen)],
        {
          checkpoint: () => {
            if (cancelled) throw new Error("cancelled");
          },
        },
      ),
    ).rejects.toThrow("cancelled");
    expect(seen.reads).toBe(1);
  });

  it("yields INSIDE one feature, when that feature is all there is", async () => {
    // The budget that matters for a roads layer of a few enormous geometries.
    // ONE feature: nothing here can yield "between features", so a checkpoint
    // at all proves the serialisation of a single line is itself bounded.
    const seen = { reads: 0 };
    let checkpoints = 0;
    let turned = false;
    setTimeout(() => {
      turned = true;
    }, 0);
    const wkt = hugeWkt();
    const bytes = await encodeProjectedFeatures([counted(0, wkt, seen)], {
      checkpoint: () => (checkpoints += 1),
    });
    expect(checkpoints).toBeGreaterThan(0);
    expect(turned).toBe(true);
    // And the line it built is still ONE line that reads back exactly.
    const text = new TextDecoder().decode(bytes);
    expect(text.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(text.trim())).toMatchObject({ idx: 0, wkt });
  });

  it("cancels mid-encode of a source that is ONE long WKT", async () => {
    // Read through a try/catch for the reason the assembly case is: an encoder
    // that does NOT stop resolves with five megabytes, and `rejects.toThrow`
    // would spend half a minute printing it.
    const seen = { reads: 0 };
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);
    let outcome = "";
    try {
      await encodeProjectedFeatures([counted(0, hugeWkt(), seen)], {
        checkpoint: () => {
          if (cancelled) throw new Error("cancelled");
        },
      });
      outcome = "encoded the whole feature";
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    }
    expect(outcome).toBe("cancelled");
  });

  it("escapes a value that spans slice boundaries exactly as one piece would", async () => {
    // The geometry is written into the line in slices, so the JSON escape has
    // to be per character (it is) and a slice must never split a surrogate
    // pair (an emoji is two code units). Nothing §7.5 produces looks like
    // this; the encoder still has to be right about it.
    const tricky = 'a"b\\c\nd\u00e9\u{1F600}'.repeat(40_000);
    const seen = { reads: 0 };
    const text = new TextDecoder().decode(
      await encodeProjectedFeatures([counted(0, tricky, seen)]),
    );
    expect(text.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(text.trim()).wkt).toBe(tricky);
  });

  it("checkpoints during the final assembly, not only during the walk", async () => {
    // The copy of ten megabytes of chunks into one buffer is work of its own,
    // and a Cancel delivered while it runs must be honoured there too.
    //
    // The outcome is read through a try/catch rather than `rejects.toThrow`:
    // without the assembly's checkpoint this RESOLVES with a ten-megabyte
    // array, and vitest would spend half a minute serialising it into the
    // failure message before saying so.
    const seen = { reads: 0, onRead: () => {} };
    let walked = false;
    seen.onRead = () => {
      if (seen.reads === 2) walked = true;
    };
    let outcome = "";
    try {
      await encodeProjectedFeatures(
        [counted(0, hugeWkt(), seen), counted(1, hugeWkt(), seen)],
        {
          checkpoint: () => {
            if (walked) throw new Error("cancelled in assembly");
          },
        },
      );
      outcome = "resolved with the whole document";
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    }
    expect(outcome).toBe("cancelled in assembly");
  });
});

describe("createVectorTable", () => {
  const query = async (_label: string, sql: string) => {
    statements.push(sql);
    return { ok: true as const, columns: [], rows: [] };
  };

  it("registers, creates, then drops the BUFFER — not the table", async () => {
    const handle = await createVectorTable({
      runId: "run_7",
      preflight: preflight(feature(0)),
      query,
    });
    expect(handle.table).toBe("__src_run_7");
    expect(registered.map((r) => r.name)).toEqual(["__src_run_7.json"]);
    expect(statements).toEqual([
      buildVectorTableSql("__src_run_7", "__src_run_7.json"),
    ]);
    // The bytes go the moment the parse is done; the TABLE is the run's to
    // hold until its `finally`.
    expect(dropped).toEqual(["__src_run_7.json"]);
    expect(statements.some((s) => s.startsWith("DROP TABLE"))).toBe(false);
  });

  it("drops the table and the buffer on release, in that order", async () => {
    const handle = await createVectorTable({
      runId: "run_7",
      preflight: preflight(feature(0)),
      query,
    });
    await handle.release();
    expect(statements).toContain('DROP TABLE IF EXISTS "__src_run_7"');
    // A second drop of a name already dropped is harmless and deliberate —
    // `export.ts:658` does the same, because a throw between the register and
    // the drop would otherwise strand the buffer.
    expect(dropped).toEqual(["__src_run_7.json", "__src_run_7.json"]);
  });

  it("releases what it made when the CREATE fails, and rethrows", async () => {
    const failing = async () => {
      throw new Error("Binder Error: no function ST_GeomFromText");
    };
    await expect(
      createVectorTable({
        runId: "run_7",
        preflight: preflight(feature(0)),
        query: failing,
      }),
    ).rejects.toThrow("ST_GeomFromText");
    expect(statements).toContain('DROP TABLE IF EXISTS "__src_run_7"');
    expect(dropped).toContain("__src_run_7.json");
  });

  it("reads a refused registration as the engine being gone ONLY when it is", async () => {
    registerOk = false;
    engineState = "failed";
    await expect(
      createVectorTable({
        runId: "run_7",
        preflight: preflight(feature(0)),
        query,
      }),
    ).rejects.toBeInstanceOf(
      (await import("../../../../src/insights/engineAwait")).EngineDeadError,
    );
  });

  it("reports an ordinary registration failure as §6.1's memory sentence", async () => {
    // `registerBuffer` answers false for ANY exception — an allocation that
    // could not be served included (`duckdb.ts:724-738`) — so a false with the
    // engine still `ready` is NOT a death, and saying "Analytics engine
    // stopped" about it would send the user to Retry for nothing.
    registerOk = false;
    engineState = "ready";
    const { SOURCE_OUT_OF_MEMORY } =
      await import("../../../../src/features/processing/sourceRead");
    await expect(
      createVectorTable({
        runId: "run_7",
        preflight: preflight(feature(0)),
        query,
      }),
    ).rejects.toThrow(SOURCE_OUT_OF_MEMORY);
    // And the buffer name it may have half-claimed is released either way.
    expect(dropped).toContain("__src_run_7.json");
  });

  it("cancels a registration in flight, and drops what lands afterwards", async () => {
    // The hand-off may still SUCCEED after the race is lost — a cancel does not
    // reach the worker — and a multi-megabyte buffer left under a name nobody
    // holds sits in the wasm heap for the life of the page.
    const gate = { resolve: (_ok: boolean) => {} };
    registerGate = gate;
    const controller = new AbortController();
    const { CancelledError } =
      await import("../../../../src/insights/engineAwait");
    const pending = createVectorTable({
      runId: "run_7",
      preflight: preflight(feature(0)),
      query,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    gate.resolve(true);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(dropped).toContain("__src_run_7.json");
    expect(statements).toEqual([]);
  });

  it("never throws out of release, whatever the engine says", async () => {
    const handle = await createVectorTable({
      runId: "run_7",
      preflight: preflight(feature(0)),
      query,
    });
    const duckdb = await import("../../../../src/insights/duckdb");
    vi.mocked(duckdb.ddl).mockRejectedValueOnce(new Error("Database closed"));
    await expect(handle.release()).resolves.toBeUndefined();
  });
});
