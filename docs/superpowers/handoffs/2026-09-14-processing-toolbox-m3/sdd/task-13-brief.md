### Task 13: The per-run vector table

**Files:**

- Create: `src/features/processing/vectorTable.ts`
- Modify: `src/features/processing/runQueue.ts` (the `"source"` phase's vector branch and its `finally`)
- Test: `tests/unit/features/processing/vectorTable.test.ts`, additions to `tests/unit/features/processing/crossLayerRun.test.ts` (the lifecycle: created before compute, dropped on every exit) and to `tests/integration/duckdb/crossLayer.test.ts` (the real-engine round-trip, see Step 6)

**Interfaces:**

- Consumes: `ProjectedFeature`, `VectorPreflight`, `YieldControl`, `reprojectGeoLayer` (Task 12); `ToolSource`, `ToolContext`, `FrozenRequest.computeLayerId` (Task 11); `SOURCE_OUT_OF_MEMORY` (Task 5's `sourceRead.ts`); `registerBuffer`/`dropBuffer`/`ddl`/`getDuckDBStatus` (`duckdb.ts:724-743`, `:695-697`, `:196`); `racedWithDeath`/`EngineDeadError` (`engineAwait.ts:104-106`); `epsgForLayer` (`cursorCrsReadout.ts:35-41`); `ensureModelCrsLoadable` (`src/features/layers/ensureCrs.ts:32`); `quoteIdent`/`quoteLiteral` (`sql.ts:28-48`).
- Produces:

```ts
export function vectorTableName(runId: string): string; // `__src_${runId}`
export function buildVectorTableSql(table: string, file: string): string;
export function buildDropVectorTableSql(table: string): string;
/** NDJSON, one feature per line. ASYNC and batched for the same reason
 *  `reprojectGeoLayer` is (Task 12's deviation 3): it yields every
 *  `ENCODE_BATCH` features and holds one batch of strings at a time, not the
 *  whole document three times over. */
export async function encodeProjectedFeatures(
  features: ReadonlyArray<ProjectedFeature>,
  control?: YieldControl,
): Promise<Uint8Array>;
export interface VectorTableHandle {
  readonly table: string;
  release(): Promise<void>;
}
export async function createVectorTable(input: {
  readonly runId: string;
  readonly preflight: VectorPreflight;
  readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
  /** Passed straight to `encodeProjectedFeatures`; the run gives its
   *  `ctx.throwIfCancelled`. */
  readonly control?: YieldControl;
}): Promise<VectorTableHandle>;
```

- `runQueue` gains the `"source"` phase's vector branch, which fills `ToolContext.source` with the `kind: "vector"` variant Task 11 left `null`. Tasks 16, 17 and 19 read `ctx.source.table`.

**Why `read_json` with an explicit `columns=` and never `read_json_auto`** (the ledger and Design decision (c) both say so; this is the reason behind them). Auto-inference reads a nested `props` object as a STRUCT, and the probed property accessors are JSON ones — `props->>'name'` for VARCHAR, `(props->>'n')::DOUBLE` for a number, `json_keys(props)` for the key list. A STRUCT answers none of them, and a heterogeneous source layer (one feature with a property, another without) is exactly what inference gets wrong. `columns={… props: 'JSON' …}` is the probed shape and it also pins the column TYPES, so a source whose `idx` happens to be uniform cannot be read back as something else.

**The shape, and why not the two alternatives** (Design decision (c), restated so the implementer does not have to look it up): a `VALUES` literal needs no VFS name but puts every ring of every feature into one statement string, which is unbounded and lands verbatim in §6.4's log. `read_json` of a GeoJSON FeatureCollection with `ST_GeomFromGeoJSON` works, but walks into the probed trap that an empty `coordinates` array yields an EMPTY geometry rather than NULL or an error — a trap preflight has already removed app-side. NDJSON of `{idx, sid, fid, props, wkt}` is `computedColumns.ts:152-186`'s own pattern, one `registerBuffer` and one `dropBuffer`.

**Five columns, and each earns its place.** `idx` is §7.5's tie rule (source order); `sid` is the stable feature id a vector TARGET's results are written back under (§7.6, Task 19); `fid` is §7.7's "the nearest feature's id" default; `props` is the copied fields (§7.5); `geom` is `ST_GeomFromText(wkt)` — the reprojected 2-D geometry, because the app reprojects app-side and `ST_Transform` is never called.

**The buffer is dropped the moment the CREATE has parsed; the TABLE is dropped in the run's `finally`.** That is `export.ts:558-578`'s shape exactly, and both halves are `racedWithDeath`: `release()` is awaited from a `finally` INSIDE the run's FIFO slot, and an unraced await caught by the engine's death never answers, holding the shared queue for the life of the page (`engineAwait.ts:4-12`). Task 25 puts that race in the primitive; until it lands, this module races its own.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/vectorTable.test.ts`:

```ts
/**
 * `__src_<runId>`: the NDJSON, the one CREATE, and a release that runs on
 * every exit path and never throws.
 *
 * The builders are asserted against exact strings — the statement lands
 * verbatim in §6.4's log and is what a planner reruns by hand — and
 * `createVectorTable` is driven over a fake `query` plus a mocked engine seam,
 * because what is under test is the ORDER of the four calls, not DuckDB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered: Array<{ name: string; text: string }> = [];
const dropped: string[] = [];
const statements: string[] = [];
let registerOk = true;
/** What `getDuckDBStatus()` reports — the only way to tell a dead engine from
 *  a registration that merely failed (`duckdb.ts:725-736`). */
let engineState: "ready" | "failed" = "ready";

vi.mock("../../../../src/insights/duckdb", () => ({
  registerBuffer: vi.fn(async (name: string, bytes: Uint8Array) => {
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
    // could not be served included (`duckdb.ts:725-736`) — so a false with the
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
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/vectorTable.test.ts
```

Expected: FAIL — `src/features/processing/vectorTable.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `src/features/processing/vectorTable.ts`:

```ts
/**
 * The vector source as ONE table, `__src_<runId>`, for the length of ONE run.
 *
 * A vector layer has no DuckDB table of its own and never gets one: its durable
 * copy is its feature `properties` (§7.6, Design decision (c)). What the
 * predicates, the largest-overlap area and the nearest-distance search need is
 * a relation, and that is what this builds — from an NDJSON document the app
 * has just produced by reprojecting the layer app-side.
 *
 * The pattern is `computedColumns.ts:152-186`'s: encode, `registerBuffer`, one
 * statement, `dropBuffer` the moment it has parsed. The TABLE outlives the
 * buffer by exactly the length of the compute, and the run drops it in a
 * `finally` that runs on every exit — done, failed, cancelled, engine death.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts`.
 */
import {
  ddl,
  dropBuffer,
  getDuckDBStatus,
  registerBuffer,
  type QueryOutcome,
} from "../../insights/duckdb";
import { EngineDeadError, racedWithDeath } from "../../insights/engineAwait";
import { quoteIdent, quoteLiteral } from "../../insights/sql";
import { SOURCE_OUT_OF_MEMORY } from "./sourceRead";
import type {
  ProjectedFeature,
  VectorPreflight,
  YieldControl,
} from "./vectorSource";

/** The log entry's own label for the one statement below — a statement label,
 *  not spec copy (§6.1's PHASE label "Reading source" is `runFormat.ts:13`'s
 *  and is unchanged). */
const SOURCE_LABEL = "Reading source layer";

/** How many features one encode batch holds before it is flushed and the walk
 *  yields. Small enough that no batch's strings are a large allocation, big
 *  enough that the yields are not the cost. */
const ENCODE_BATCH = 1_000;

export function vectorTableName(runId: string): string {
  return `__src_${runId}`;
}

/**
 * The one statement, with the column types SPELLED OUT.
 *
 * Not `read_json_auto`: inference reads the nested `props` object as a STRUCT,
 * and every probed property accessor is a JSON one (`props->>'name'`,
 * `(props->>'n')::DOUBLE`, `json_keys(props)`). A heterogeneous source layer —
 * one feature carrying a property another lacks — is exactly what inference
 * gets wrong, and `columns=` also pins `idx` to BIGINT so a uniform source
 * cannot be read back as something else.
 *
 * `ST_GeomFromText` and not `ST_GeomFromGeoJSON`: the WKT is already in the
 * target's CRS (the app reprojects app-side; `ST_Transform` is never called),
 * and the GeoJSON path carries the probed trap that an empty `coordinates`
 * array yields an EMPTY geometry rather than NULL — a case preflight has
 * already removed.
 */
export function buildVectorTableSql(table: string, file: string): string {
  return (
    `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ` +
    `"idx", "sid", "fid", "props", ST_GeomFromText("wkt") AS "geom" ` +
    `FROM read_json(${quoteLiteral(file)}, format = 'newline_delimited', ` +
    `columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', ` +
    `props: 'JSON', wkt: 'VARCHAR'})`
  );
}

export function buildDropVectorTableSql(table: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)}`;
}

/**
 * One JSON object per line: `{idx, sid, fid, props, wkt}`.
 *
 * `idx` is §7.5's tie rule (source order, gaps included); `sid` is the stable
 * feature id §7.6 writes its results back under; `fid` is §7.7's default
 * nearest-id property; `props` is the fields §7.5 copies; `wkt` becomes the
 * geometry. Every key is written even when its value is null, so the column
 * list above is satisfied by every line.
 */
export async function encodeProjectedFeatures(
  features: ReadonlyArray<ProjectedFeature>,
  control?: YieldControl,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let batch: string[] = [];
  const flush = (): void => {
    if (batch.length === 0) return;
    const bytes = encoder.encode(`${batch.join("\n")}\n`);
    chunks.push(bytes);
    total += bytes.byteLength;
    // The batch's strings are released here; the whole document never exists
    // as one string, which on a 200 MB source is the difference between one
    // copy and three.
    batch = [];
  };
  for (const [index, f] of features.entries()) {
    batch.push(
      JSON.stringify(
        {
          idx: f.idx,
          sid: f.stableId,
          fid: f.featureId,
          props: f.properties,
          wkt: f.wkt,
        },
        // A BIGINT that came from an upstream table arrives as a `BigInt`,
        // which `JSON.stringify` refuses outright rather than skipping — the
        // same replacer `computedColumns.ts:156-160` needs.
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      ),
    );
    if (batch.length < ENCODE_BATCH) continue;
    flush();
    // Same contract as `reprojectGeoLayer`'s walk: checkpoint (the run's
    // `ctx.throwIfCancelled`, which THROWS), then a macrotask so a Cancel and
    // a repaint can land.
    if (index + 1 < features.length) {
      control?.checkpoint?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  flush();
  // ONE allocation of the final size, filled from the chunks — `Blob` and
  // `concat` both cost a second copy of the whole document.
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export interface VectorTableHandle {
  readonly table: string;
  /** Idempotent, and it NEVER throws or hangs — see {@link releaseVectorTable}. */
  release(): Promise<void>;
}

/**
 * Both halves raced against the engine's death, and neither allowed to throw.
 *
 * This is awaited from a `finally` INSIDE the run's FIFO slot. An unraced await
 * caught by the death never answers (duckdb-wasm clears its pending requests
 * without rejecting them, `engineAwait.ts:4-12`), and the shared queue would be
 * held for the life of the page. A rejection would do the same damage a
 * different way. There is nothing to report either: the table died with the
 * database.
 */
async function releaseVectorTable(table: string, file: string): Promise<void> {
  await racedWithDeath(ddl(buildDropVectorTableSql(table))).catch(() => {});
  // A second drop of a name already dropped is free, and it is the only cover
  // for a throw between the register and the create (`export.ts:658`).
  await racedWithDeath(dropBuffer(file)).catch(() => {});
}

/**
 * Spec §6.1's "Reading source" phase for a VECTOR source.
 *
 * The caller has already refused an empty preflight (§7.5's "The source layer
 * has no features" / "No usable areas in Zones"), so `features` is non-empty
 * here and the NDJSON is never an empty file.
 */
export async function createVectorTable(input: {
  readonly runId: string;
  readonly preflight: VectorPreflight;
  readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
  readonly control?: YieldControl;
}): Promise<VectorTableHandle> {
  const table = vectorTableName(input.runId);
  const file = `${table}.json`;
  const handle: VectorTableHandle = {
    table,
    release: () => releaseVectorTable(table, file),
  };
  const bytes = await encodeProjectedFeatures(
    input.preflight.features,
    input.control,
  );
  if (!(await registerBuffer(file, bytes))) {
    // `registerBuffer` answers false for THREE different things: no database,
    // a status that is not `ready`, and ANY exception from
    // `registerFileBuffer` — it catches and returns false (`duckdb.ts:725-736`).
    // So the engine's own status is what tells a death from a registration
    // that merely failed, and only the first is §6.1's "Analytics engine
    // stopped". The second is an allocation the wasm heap could not serve,
    // which §6.1 already has a sentence for; no new copy is invented for it.
    await racedWithDeath(dropBuffer(file)).catch(() => {});
    if (getDuckDBStatus().state !== "ready") throw new EngineDeadError();
    throw new Error(SOURCE_OUT_OF_MEMORY);
  }
  try {
    await input.query(SOURCE_LABEL, buildVectorTableSql(table, file));
  } catch (error) {
    await handle.release();
    throw error;
  }
  // The moment the CREATE has parsed: a large source must not sit in the wasm
  // heap for the length of the compute (`export.ts:558-578`).
  await racedWithDeath(dropBuffer(file)).catch(() => {});
  return handle;
}
```

- [ ] **Step 4: Wire the `"source"` phase into the queue**

In `src/features/processing/runQueue.ts`, add the imports:

```ts
import { ensureModelCrsLoadable } from "../layers/ensureCrs";
import { epsgForLayer } from "../../scene/cursorCrsReadout";
import { reprojectGeoLayer, type VectorPreflight } from "./vectorSource";
import { createVectorTable, type VectorTableHandle } from "./vectorTable";
```

Declare the handle immediately before `execute`'s `try` (beside `const log`/`const warnings`):

```ts
// The run's own table, dropped in the `finally` below on EVERY exit path.
let vectorSourceHandle: VectorTableHandle | null = null;
```

Lift the context's `query` method out of the object literal, so the source phase can use it before the context exists — the body is the existing one, verbatim:

```ts
const query = async (label: string, sql: string): Promise<QueryOutcome> => {
  if (signal.aborted) throw new CancelledError();
  const t0 = performance.now();
  const out = await raced(runQuery(sql), signal);
  log.push({
    label,
    sql,
    ms: Math.round(performance.now() - t0),
    rows: out.ok ? out.rows.length : null,
  });
  patch(id, { log: [...log] });
  if (!out.ok) throw new Error(out.message);
  return out;
};
```

Then, between the scope's abort check and `patch(id, { status: "running", phase: "compute", … })`, and replacing Task 11's `const source: ToolSource | null = tool.sourceKind === "city" ? … : null;`:

```ts
let source: ToolSource | null =
  tool.sourceKind === "city" ? { kind: "city", layer, table } : null;
if (tool.sourceKind === "vector") {
  // Spec §6.1's second phase. `runFormat.ts:13` already labels it
  // "Reading source"; this is the first tool that enters it.
  patch(id, { status: "running", phase: "source" });
  const geo = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === request.sourceLayerId);
  if (!geo || geo.kind !== "geojson") {
    patch(id, {
      status: "failed",
      phase: null,
      error: "Layer removed",
      elapsedMs: elapsed(),
    });
    return;
  }
  // §7.5: the areas are reprojected into the TARGET's CRS, and
  // `crsFromGeodetic`'s `ensureProjDef` guard is SYNCHRONOUS — a definition
  // proj4 has not fetched yet answers `null` for every coordinate, which is
  // the difference between "4 areas skipped" and "every area skipped". It
  // costs nothing when the definition is already loaded, and it throws the
  // loader's own sentence when the CRS cannot be resolved at all.
  await raced(ensureModelCrsLoadable(layer.model), signal);
  if (signal.aborted) {
    if (!failedAlready(id)) {
      patch(id, { status: "cancelled", phase: null, elapsedMs: elapsed() });
    }
    return;
  }
  const epsg = epsgForLayer(layer.model.metadata?.referenceSystem);
  // The run's own cancel, handed to the batched walk so a Cancel lands
  // INSIDE the reprojection of a large source rather than after it.
  const control = {
    checkpoint: () => {
      if (signal.aborted) throw new CancelledError();
    },
  };
  // A city layer always has a recognised metric CRS (§7.5; the loader
  // refuses the others), so a null here is a layer nothing can be projected
  // INTO — the same outcome as every area failing to reproject, which §7.5
  // already has the sentence for.
  const preflight: VectorPreflight =
    epsg === null
      ? {
          features: [],
          skipped: geoRecords(geo.config.preparedData).length,
          propertyKeys: [],
          propertyTypes: new Map(),
          polygonOnly: true,
        }
      : await reprojectGeoLayer(geo.config.preparedData, epsg, control);
  if (preflight.features.length === 0) {
    // §7.5's source must be AREAS, so "No usable areas in Zones" is ITS
    // sentence; §7.7's source is any geometry type and its only sentence is
    // "The source layer has no features" (§7.7: "An empty source (no usable
    // geometry after preflight) disables Run with …"). Task 15's
    // `SOURCE_NEEDS_AREAS` is the FORM's copy of the same fact and replaces
    // this literal when it lands.
    const sourceMustBeAreas = tool.id === "join-by-location";
    patch(id, {
      status: "failed",
      phase: null,
      error:
        preflight.skipped > 0 && sourceMustBeAreas
          ? `No usable areas in ${geo.name}`
          : "The source layer has no features",
      elapsedMs: elapsed(),
    });
    return;
  }
  if (preflight.skipped > 0) {
    // §7.5's "4 areas skipped: invalid geometry", recorded on the run so
    // §6.4's log says what the compute never saw.
    warnings.push(
      `${plural(preflight.skipped, "area", "areas")} skipped: invalid geometry`,
    );
    patch(id, { warnings: [...warnings] });
  }
  vectorSourceHandle = await createVectorTable({
    runId: id,
    preflight,
    query,
    control,
  });
  source = {
    kind: "vector",
    layer: geo,
    table: vectorSourceHandle.table,
    propertyKeys: preflight.propertyKeys,
    propertyTypes: preflight.propertyTypes,
    skipped: preflight.skipped,
  };
}
```

and the context's `query` field becomes the lifted function:

```ts
const ctx: ToolContext = {
  table,
  layer,
  target,
  source,
  featureIds: scope.featureIds,
  signal,
  query,
  throwIfCancelled() {
    /* unchanged */
  },
  phase(p) {
    /* unchanged */
  },
  warn(text) {
    /* unchanged */
  },
};
```

Finally, the run's `finally`:

```ts
  } finally {
    controllers.delete(id);
    // EVERY exit path: done, failed, cancelled, the engine's death. The table
    // is this run's own, so nothing else will ever drop it — and `release`
    // neither throws nor hangs, because this `await` is inside the FIFO slot.
    await vectorSourceHandle?.release();
  }
```

- [ ] **Step 5: Extend the cross-layer run test**

Append to `tests/unit/features/processing/crossLayerRun.test.ts` (the duckdb mock already records every statement in `sql`):

```ts
describe("the per-run vector table", () => {
  it("is created in the source phase and dropped when the run is done", async () => {
    const zones = addZones();
    const box = capturing();
    submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(box.seen?.source).toMatchObject({
      kind: "vector",
      table: "__src_run_1",
      propertyKeys: ["zone"],
      skipped: 0,
    });
    expect(
      sql.some((s) => s.startsWith('CREATE OR REPLACE TABLE "__src_run_1"')),
    ).toBe(true);
    expect(sql).toContain('DROP TABLE IF EXISTS "__src_run_1"');
  });

  it("drops the table when the run FAILS, not only when it succeeds", async () => {
    const zones = addZones();
    registerExecutor("join-by-location", async () => {
      throw new Error("Binder Error: no function ST_Intersects");
    });
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.status).toBe("failed");
    expect(sql).toContain('DROP TABLE IF EXISTS "__src_run_1"');
  });

  it("refuses a source whose every feature is unusable, by name", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: null },
            { type: "Feature", properties: {}, geometry: null },
          ],
        },
      },
    });
    capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)).toMatchObject({
      status: "failed",
      error: "No usable areas in Zones",
    });
  });

  it("tells §7.7's all-skipped source apart from §7.5's, by tool", async () => {
    // §7.7's source is any geometry type, so "No usable AREAS" would be a
    // sentence about a rule that tool does not have.
    const roads = useGeoLayerStore.getState().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: null }],
        },
      },
    });
    capturing();
    registerExecutor("distance-to-nearest", async (run) => ({
      columns: [{ name: `${run.prefix}distance_m`, type: "DOUBLE" as const }],
      rows: new Map(),
      measured: 0,
      skipped: [],
    }));
    const id = submitRun({
      toolId: "distance-to-nearest",
      targetLayerId: "CITY",
      sourceLayerId: roads,
      scope: "all",
      lod: null,
      params: {},
      prefix: "roads_",
      columns: [{ name: "roads_distance_m", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.error).toBe("The source layer has no features");
  });

  it("refuses an EMPTY source with §7.5's other sentence", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.error).toBe("The source layer has no features");
  });

  it("records the skipped areas as a warning the log shows", async () => {
    const zones = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: null },
            {
              type: "Feature",
              id: "z2",
              properties: { zone: "B" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [4, 52],
                    [5, 52],
                    [5, 53],
                    [4, 52],
                  ],
                ],
              },
            },
          ],
        },
      },
    });
    capturing();
    const id = submitRun({
      toolId: "join-by-location",
      targetLayerId: "CITY",
      sourceLayerId: zones,
      scope: "all",
      lod: null,
      params: {},
      prefix: "zones_",
      columns: [{ name: "zones_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)?.warnings).toContain("1 area skipped: invalid geometry");
  });
});
```

This file's city layer needs a reference system for `epsgForLayer` to answer; add it to `model()`:

```ts
    metadata: { referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992" },
```

- [ ] **Step 6: Pin the statement against the real engine**

Append to `tests/integration/duckdb/crossLayer.test.ts` (Task 1's suite), so the builder's exact text is the text DuckDB 1.5.5 accepts — the probe was written before this builder existed, and a drift between the two is a bug in one of them:

```ts
it("round-trips the app's OWN vector-table statement", async () => {
  const features = [
    {
      idx: 0,
      stableId: "id:string:z1",
      featureId: "z1",
      properties: { zone: "A", noise: 62 },
      wkt: "POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))",
    },
    {
      idx: 2,
      stableId: "index:2",
      featureId: null,
      properties: { zone: "B" },
      wkt: "POLYGON ((20 0, 30 0, 30 10, 20 0))",
    },
  ];
  db.registerBytes("__src_probe.json", await encodeProjectedFeatures(features));
  db.query(buildVectorTableSql("__src_probe", "__src_probe.json"));
  const rows = db.query(
    `SELECT "idx", "sid", "fid", "props"->>'zone' AS zone,
            TRY_CAST("props"->>'noise' AS DOUBLE) AS noise, ST_Area("geom") AS area
     FROM "__src_probe" ORDER BY "idx"`,
  );
  // The harness narrows a BigInt to a Number on the way out (`harness.ts`'s
  // `query`), so `idx` is a plain 0 here.
  expect(rows).toEqual([
    { idx: 0, sid: "id:string:z1", fid: "z1", zone: "A", noise: 62, area: 100 },
    // The heterogeneous row is why the column list is explicit: inference
    // would have made `props` a STRUCT and `->>` would not compile.
    { idx: 2, sid: "index:2", fid: null, zone: "B", noise: null, area: 50 },
  ]);
  db.query(buildDropVectorTableSql("__src_probe"));
  db.dropFile("__src_probe.json");
});
```

`db` is the `Harness` Task 1's suite opens in its `beforeAll`; its API is `query(sql)`, `register(name, fixture)`, `registerBytes(name, bytes)`, `readFile`, `dropFile`, `close` (`tests/integration/duckdb/harness.ts:41-52`), and `spatial` is loaded by that suite's `installExtension(db, "spatial")`. `encodeProjectedFeatures`, `buildVectorTableSql` and `buildDropVectorTableSql` are imported from `src/features/processing/vectorTable`.

- [ ] **Step 7: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing
npx tsc -b --noEmit
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
```

Expected: PASS everywhere.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/vectorTable.ts src/features/processing/runQueue.ts \
  tests/unit/features/processing/vectorTable.test.ts \
  tests/unit/features/processing/crossLayerRun.test.ts \
  tests/integration/duckdb/crossLayer.test.ts
git commit -m "feat: a cross-layer run registers its vector source as a per-run table"
```

---
