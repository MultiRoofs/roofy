### Task 17: Distance to nearest

**Files:**

- Create: `src/features/processing/tools/distanceToNearest.ts`
- Modify: `src/features/processing/toolRegistry.ts` (`styleByResult`, `implemented: true`), `src/features/processing/tools/register.ts`, `tests/unit/features/processing/register.test.ts`
- Test: `tests/unit/features/processing/distanceToNearest.test.ts`

**Interfaces:**

- Consumes: `createVectorTable` (Task 13, through `ctx.source`), `buildFeatureProxySql`/`lodZeroLabel`/`proxyDistanceNote` (Task 14), `distanceParams`/`distanceColumns` (Task 15), `readSource`/`readerQuery`/`assertSourceIds` (Task 5 — the footprint statement reads the re-read source), `ToolExecutor`/`ToolContext` (Task 11).
- Produces: `buildDistanceSql(input)` and `distanceToNearest: ToolExecutor` in `tools/distanceToNearest.ts`, plus `registerExecutor("distance-to-nearest", distanceToNearest)`; the registry entry's `styleByResult` = `<prefix>distance_m <` median, and `implemented: true`.

**The same one statement, one window, one join-back** as §7.5 — the only differences are the ordering key and the nearest-id projection, so the two executors read the same way and a reviewer can compare them line for line.

**The max distance is in the JOIN predicate, not in a `HAVING`.** §7.7: "beyond it the distance is NULL and the building is counted as 'none within 500 m'". Filtering in the `ON` clause is what makes the LEFT JOIN produce no match at all for such a building, so `d` is NULL by the join's own semantics rather than by a second `CASE`. It is also the only form that lets the engine stop looking.

**`ST_Distance` is 0 when the geometries touch or overlap** (§7.7), so no special case is written for it: the ordering key sorts 0 first and the value is written as 0, which §6.2's rule calls "evaluated and found nothing to separate them".

**Ties go to the first source feature.** `ORDER BY "d" ASC NULLS LAST, "idx" ASC NULLS LAST` — never `arg_min`, whose behaviour on equal keys is unspecified and which would let the nearest ID disagree with the distance it was chosen by.

**The nearest id is `fid` or a property, never both.** §7.7's select "defaults to the GeoJSON feature `id` when the source has one"; `nearestIdProperty === null` means exactly that, and the column is then `m."fid"` — the value `encodeProjectedFeatures` wrote from `ProjectedFeature.featureId`. A chosen property is `m."props"->>'<key>'`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/distanceToNearest.test.ts`:

```ts
/**
 * §7.7: the nearest source geometry's 2D distance, in the target's CRS metres.
 *
 * The statement as a string (it is §6.4's record), and the executor over a fake
 * context, so the value rule and the two counts are tested without DuckDB.
 */
import { describe, expect, it, vi } from "vitest";

// `sourceRead` reaches `insights/duckdb`, the one importer of
// `@duckdb/duckdb-wasm`; mocked HOISTED, as every other suite mocks that seam.
vi.mock("../../../../src/features/processing/sourceRead", () => ({
  readSource: vi.fn(async () => ({
    from: "read_cityjson('layer_1_run_1.city.json', lod => '0')",
    geometryColumn: "geometry_lod0",
    propertiesColumn: "geometry_properties_lod0",
    release: async () => {},
  })),
  // Task 5's other two source doors, spied rather than reimplemented: what the
  // §6.1 sentences and the id-join THRESHOLD do is `sourceRead.test.ts`'s to
  // assert, and what this executor owns is that it goes through them.
  readerQuery: vi.fn(
    async (
      ctx: { query: (label: string, sql: string) => Promise<unknown> },
      label: string,
      sql: string,
    ) => ctx.query(label, sql),
  ),
  assertSourceIds: vi.fn(),
  sourceWorkloadNote: () => null,
}));

const { buildDistanceSql, distanceToNearest } =
  await import("../../../../src/features/processing/tools/distanceToNearest");
const { assertSourceIds, readerQuery } =
  await import("../../../../src/features/processing/sourceRead");
import type { LayerTable } from "../../../../src/insights/layerTables";
import type {
  ToolContext,
  ToolSource,
} from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
    lods: [{ label: "0", suffix: "0" }],
    rowCount: 3,
    ...over,
  } as LayerTable;
}

function source(over: Partial<Extract<ToolSource, { kind: "vector" }>> = {}) {
  return {
    kind: "vector" as const,
    layer: { id: "GEO", name: "Roads", kind: "geojson" },
    table: "__src_run_1",
    propertyKeys: ["name"],
    propertyTypes: new Map([["name", "VARCHAR" as const]]),
    skipped: 0,
    ...over,
  } as Extract<ToolSource, { kind: "vector" }>;
}

function run(params: Record<string, unknown>): RunRecord {
  return {
    id: "run_1",
    toolId: "distance-to-nearest",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: "GEO",
    sourceName: "Roads",
    scope: "all",
    scopeCount: 3,
    featureIds: null,
    lod: null,
    params,
    prefix: "roads_",
    columns: [],
    status: "running",
    phase: "compute",
    startedAt: 0,
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
  };
}

/** One result row of the statement, internal columns and all. */
function row(
  id: string,
  f: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return { id, f, no_proxy: false, ...values };
}

function context(
  rows: ReadonlyArray<Record<string, unknown>>,
  over: Partial<ToolContext> = {},
): {
  ctx: ToolContext;
  labels: string[];
  sql: string[];
} {
  const labels: string[] = [];
  const sql: string[] = [];
  const ctx = {
    layer: { id: "L1", name: "Delft", isStreaming: false },
    table: table(),
    target: { kind: "city", layer: { id: "L1" }, table: table() },
    source: source(),
    featureIds: null,
    signal: new AbortController().signal,
    query: vi.fn(async (label: string, statement: string) => {
      labels.push(label);
      sql.push(statement);
      return { ok: true as const, columns: [], rows: [...rows] };
    }),
    phase: vi.fn(),
    warn: vi.fn(),
    throwIfCancelled: vi.fn(),
    ...over,
  } as unknown as ToolContext;
  return { ctx, labels, sql };
}

describe("buildDistanceSql", () => {
  const base = {
    table: "layer_1",
    source: "__src_run_1",
    proxy: "rectangle" as const,
    from: null,
    geometryColumn: null,
    ids: null,
    maxDistanceM: 500,
    prefix: "roads_",
    nearestId: null as { readonly property: string | null } | null,
  };

  it("puts the search limit in the JOIN, so beyond it there is no match", () => {
    const sql = buildDistanceSql(base);
    expect(sql).toContain('ST_Distance(b."g", s."geom") <= 500');
    expect(sql).toContain('ST_Distance(b."g", s."geom") AS "d"');
    expect(sql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY "d" ASC NULLS LAST, "idx" ASC NULLS LAST)',
    );
    expect(sql).toContain('m."d" AS "roads_distance_m"');
    expect(sql).not.toContain("roads_nearest_id");
  });

  it("writes the feature's OWN id when no property was chosen (§7.7)", () => {
    expect(
      buildDistanceSql({ ...base, nearestId: { property: null } }),
    ).toContain('m."fid" AS "roads_nearest_id"');
  });

  it("writes a chosen property, quoted as a JSON key", () => {
    expect(
      buildDistanceSql({ ...base, nearestId: { property: "name" } }),
    ).toContain(`m."props"->>'name' AS "roads_nearest_id"`);
  });

  it("restricts to the frozen ids on both sides", () => {
    const sql = buildDistanceSql({ ...base, ids: ["b1"] });
    expect(sql).toContain(`WHERE "id" IN ('b1')`);
    expect(sql).toContain(`WHERE t."id" IN ('b1')`);
  });
});

describe("distanceToNearest", () => {
  const params = {
    proxy: "rectangle",
    maxDistanceM: 500,
    writeNearestId: true,
    nearestIdProperty: null,
  };

  it("writes the distance and the id onto every row of the feature", async () => {
    const { ctx } = context([
      row("B1", "B1", { roads_distance_m: 0, roads_nearest_id: "r7" }),
      row("B1P", "B1", { roads_distance_m: 0, roads_nearest_id: "r7" }),
      row("B2", "B2", { roads_distance_m: 12.5, roads_nearest_id: "r9" }),
    ]);
    const out = await distanceToNearest(run(params), ctx);
    expect(out.columns).toEqual([
      { name: "roads_distance_m", type: "DOUBLE" },
      { name: "roads_nearest_id", type: "VARCHAR" },
    ]);
    // §7.7: 0 when they touch or overlap — a real 0, never NULL.
    expect(out.rows.get("B1P")).toEqual({
      roads_distance_m: 0,
      roads_nearest_id: "r7",
    });
    expect(out.rows.get("B2")).toEqual({
      roads_distance_m: 12.5,
      roads_nearest_id: "r9",
    });
  });

  it("is §7.7's card: measured, then the ones with nothing in range", async () => {
    const { ctx } = context([
      row("B1", "B1", { roads_distance_m: 3, roads_nearest_id: "r7" }),
      row("B2", "B2", { roads_distance_m: null, roads_nearest_id: null }),
    ]);
    const out = await distanceToNearest(run(params), ctx);
    expect(out.measured).toBe(2);
    expect(out.line).toBeUndefined();
    expect(out.caveats).toEqual([{ cause: "none within 500 m", count: 1 }]);
    expect(out.skipped).toEqual([]);
  });

  it("uses the search limit the run actually froze in its sentence", async () => {
    const { ctx } = context([
      row("B1", "B1", { roads_distance_m: null, roads_nearest_id: null }),
    ]);
    const out = await distanceToNearest(
      run({ ...params, maxDistanceM: 250 }),
      ctx,
    );
    expect(out.caveats).toEqual([{ cause: "none within 250 m", count: 1 }]);
  });

  it("counts a feature with no proxy as skipped, never as out of range", async () => {
    const { ctx } = context([
      row("B1", "B1", { roads_distance_m: 3, roads_nearest_id: "r7" }),
      {
        ...row("B2", "B2", { roads_distance_m: null, roads_nearest_id: null }),
        no_proxy: true,
      },
    ]);
    const out = await distanceToNearest(run(params), ctx);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
    expect(out.caveats).toEqual([]);
    expect(out.measured).toBe(1);
  });

  it("names the proxy in the log, as §7.7 words it", async () => {
    const { ctx, labels } = context([
      row("B1", "B1", { roads_distance_m: 1, roads_nearest_id: "r7" }),
    ]);
    await distanceToNearest(run({ ...params, proxy: "centre" }), ctx);
    expect(labels).toEqual(["2D distance to the building centre"]);
  });

  it("sends the footprint statement through Task 5's two source doors", async () => {
    // §6.1's sentences and the id-join threshold belong to `sourceRead`; this
    // executor's job is to go through them rather than decide them again.
    vi.mocked(readerQuery).mockClear();
    vi.mocked(assertSourceIds).mockClear();
    const { ctx } = context([row("B1", "B1", { roads_distance_m: 1 })], {
      featureIds: ["B1", "B2"],
    });
    await distanceToNearest(run({ ...params, proxy: "footprint" }), ctx);
    expect(vi.mocked(readerQuery)).toHaveBeenCalledWith(
      ctx,
      "2D distance to the building footprint",
      expect.stringContaining("read_cityjson('layer_1_run_1.city.json'"),
    );
    expect(vi.mocked(assertSourceIds)).toHaveBeenCalledWith(
      ["B1", "B2"],
      new Set(["B1"]),
    );
  });

  it("leaves both doors alone for a proxy that reads no source", async () => {
    vi.mocked(readerQuery).mockClear();
    vi.mocked(assertSourceIds).mockClear();
    const { ctx } = context([row("B1", "B1", { roads_distance_m: 1 })]);
    await distanceToNearest(run({ ...params, proxy: "centre" }), ctx);
    expect(vi.mocked(readerQuery)).not.toHaveBeenCalled();
    expect(vi.mocked(assertSourceIds)).not.toHaveBeenCalled();
  });

  it("omits the id column when the checkbox is off", async () => {
    const { ctx, sql } = context([row("B1", "B1", { roads_distance_m: 1 })]);
    const out = await distanceToNearest(
      run({ ...params, writeNearestId: false }),
      ctx,
    );
    expect(out.columns).toEqual([{ name: "roads_distance_m", type: "DOUBLE" }]);
    expect(sql[0]).not.toContain("roads_nearest_id");
  });

  it("refuses when the FROZEN id property left the source (§6.1)", async () => {
    // Frozen with `name`; the source was re-linked while the run was queued and
    // carries `label` now. `props->>'name'` would write NULL into every
    // building under a card that says the run measured them all.
    const { ctx, sql } = context([], {
      source: source({ propertyKeys: ["label"] }),
    });
    await expect(
      distanceToNearest(run({ ...params, nearestIdProperty: "name" }), ctx),
    ).rejects.toThrow("Layer changed while running; run again");
    expect(sql).toEqual([]);
  });

  it("does not mind a changed source when the id comes from the FEATURE id", async () => {
    // `nearestIdProperty: null` is §7.7's "the GeoJSON feature `id`", which is
    // `fid` — a column of the per-run table, not a property of the document.
    const { ctx } = context(
      [row("B1", "B1", { roads_distance_m: 1, roads_nearest_id: "r7" })],
      { source: source({ propertyKeys: [] }) },
    );
    const out = await distanceToNearest(run(params), ctx);
    expect(out.rows.get("B1")).toMatchObject({ roads_nearest_id: "r7" });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/distanceToNearest.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the executor**

Create `src/features/processing/tools/distanceToNearest.ts`:

```ts
/**
 * Distance to nearest (spec §7.7).
 *
 * The same one-statement shape as §7.5 — feature proxy, LEFT JOIN, a window per
 * feature, joined back to the rows — so the two can be read side by side. Three
 * differences, each from §7.7:
 *
 *  - the max search distance is in the JOIN's `ON`, which is what makes the
 *    distance NULL "beyond it" by the join's own semantics rather than by a
 *    second CASE, and what lets the engine stop looking;
 *  - the ordering key is the distance, then the source order, so "ties go to
 *    the first source feature" is stated rather than left to `arg_min`;
 *  - the nearest id is the feature's OWN GeoJSON id (`fid`) unless a property
 *    was chosen.
 *
 * `ST_Distance` is 0 when the proxies touch or overlap (§7.7), so no special
 * case is written: 0 sorts first and is written as 0, which §6.2 distinguishes
 * from the NULL of "could not be evaluated".
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import {
  buildFeatureProxySql,
  lodZeroLabel,
  proxyDistanceNote,
  type BuildingProxy,
} from "../buildingProxy";
import { distanceColumns, distanceParams } from "../crossLayerParams";
import {
  assertSourceIds,
  readSource,
  readerQuery,
  type ReadSourceHandle,
} from "../sourceRead";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

export interface DistanceSqlInput {
  readonly table: string;
  readonly source: string;
  readonly proxy: BuildingProxy;
  readonly from: string | null;
  readonly geometryColumn: string | null;
  readonly ids: ReadonlyArray<string> | null;
  readonly maxDistanceM: number;
  readonly prefix: string;
  /** Null when the id is not written; `{ property: null }` is §7.7's default,
   *  the source feature's OWN GeoJSON id. */
  readonly nearestId: { readonly property: string | null } | null;
}

export function buildDistanceSql(input: DistanceSqlInput): string {
  const b = buildFeatureProxySql({
    proxy: input.proxy,
    table: input.table,
    from: input.from,
    geometryColumn: input.geometryColumn,
    ids: input.ids,
  });
  // `quoteLiteral` throws on a non-finite number, which is the guard: §6's
  // validation has already refused a limit that is not positive.
  const limit = quoteLiteral(input.maxDistanceM);
  const selected = [`m."d" AS ${quoteIdent(`${input.prefix}distance_m`)}`];
  if (input.nearestId !== null) {
    selected.push(
      `${
        input.nearestId.property === null
          ? `m."fid"`
          : `m."props"->>${quoteLiteral(input.nearestId.property)}`
      } AS ${quoteIdent(`${input.prefix}nearest_id`)}`,
    );
  }
  const where =
    input.ids === null
      ? ""
      : ` WHERE t."id" IN (${input.ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `WITH b AS (${b}), ` +
    `j AS (SELECT b."f" AS "f", (b."g" IS NULL) AS "no_proxy", s."idx" AS "idx", ` +
    `s."fid" AS "fid", s."props" AS "props", ST_Distance(b."g", s."geom") AS "d" ` +
    `FROM b LEFT JOIN ${quoteIdent(input.source)} s ` +
    `ON b."g" IS NOT NULL AND ST_Distance(b."g", s."geom") <= ${limit}), ` +
    `r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY "f" ` +
    `ORDER BY "d" ASC NULLS LAST, "idx" ASC NULLS LAST) AS "rn" FROM j), ` +
    `m AS (SELECT * FROM r WHERE "rn" = 1) ` +
    `SELECT t."id" AS "id", m."f" AS "f", m."no_proxy" AS "no_proxy", ` +
    `${selected.join(", ")} ` +
    `FROM ${quoteIdent(input.table)} t JOIN m ON COALESCE(t."feature_id", t."id") = m."f"${where}`
  );
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const DISTANCE_BATCH_ROWS = 5000;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export const distanceToNearest: ToolExecutor = async (run, ctx) => {
  const source = ctx.source;
  if (source === null || source.kind !== "vector") {
    throw new Error("Add a vector layer to join with");
  }
  const params = distanceParams(run.params);
  // §6.1's head re-validation of the FROZEN parameters against the source
  // preflight actually read: a run can wait minutes in the queue, and a source
  // re-linked in between may no longer carry the property the nearest id was
  // promised from. `props->>'gone'` writes NULL into every building and the
  // card still says "1,204 buildings measured", which is the failure this
  // prevents. §6.1's own sentence, not a new one.
  if (
    params.writeNearestId &&
    params.nearestIdProperty !== null &&
    !source.propertyKeys.includes(params.nearestIdProperty)
  ) {
    throw new Error("Layer changed while running; run again");
  }
  const columns: ReadonlyArray<OutputColumn> = distanceColumns(
    run.prefix,
    params,
  );
  const distanceColumn = `${run.prefix}distance_m`;

  let handle: ReadSourceHandle | null = null;
  try {
    if (params.proxy === "footprint") {
      const label = lodZeroLabel(ctx.table);
      if (label === null) {
        // The form cannot offer a footprint without an LoD 0 rung, so this is a
        // frozen draft whose target was rebuilt (§6.1).
        throw new Error("Layer changed while running; run again");
      }
      ctx.phase("source");
      handle = await readSource({
        runId: run.id,
        table: ctx.table,
        lod: label,
        signal: ctx.signal,
      });
    }
    ctx.phase("compute");
    // §7.7: "The description and the log say '2D distance to the building
    // footprint / extent / centre' accordingly."
    const distanceLabel = proxyDistanceNote(params.proxy);
    const sql = buildDistanceSql({
      table: ctx.table.table,
      source: source.table,
      proxy: params.proxy,
      from: handle?.from ?? null,
      geometryColumn: handle?.geometryColumn ?? null,
      ids: ctx.featureIds,
      maxDistanceM: params.maxDistanceM,
      prefix: run.prefix,
      nearestId: params.writeNearestId
        ? { property: params.nearestIdProperty }
        : null,
    });
    // The footprint proxy parses the re-read source inside this statement, so
    // it goes through Task 5's one door for §6.1's sentences; every other proxy
    // reads the browsing table only.
    const out =
      handle === null
        ? await ctx.query(distanceLabel, sql)
        : await readerQuery(ctx, distanceLabel, sql);
    // A type guard, not logic: the context throws on a failed query.
    if (!out.ok) throw new Error(out.message);
    if (handle !== null) {
      // §6.1's id join at Task 5's ONE threshold — the same reasoning as Join's:
      // the footprint relation is `FROM <handle.from>`, so a lost object leaves
      // the building out of the result and it would be written as "no geometry".
      assertSourceIds(
        ctx.featureIds ?? [],
        new Set(out.rows.map((row) => String(row["id"]))),
      );
    }

    const rows = new Map<string, Record<string, unknown>>();
    const byFeature = new Map<string, { proxy: boolean; inRange: boolean }>();
    for (const [index, row] of out.rows.entries()) {
      if (index % DISTANCE_BATCH_ROWS === 0 && index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
      const values: Record<string, unknown> = {};
      for (const column of columns)
        values[column.name] = row[column.name] ?? null;
      rows.set(String(row["id"]), values);
      const f = row["f"];
      const key = typeof f === "string" ? f : String(row["id"]);
      if (!byFeature.has(key)) {
        byFeature.set(key, {
          proxy: row["no_proxy"] !== true,
          inRange: num(row[distanceColumn]) !== null,
        });
      }
    }

    let measured = 0;
    let none = 0;
    let noGeometry = 0;
    for (const entry of byFeature.values()) {
      if (!entry.proxy) {
        noGeometry += 1;
        continue;
      }
      measured += 1;
      if (!entry.inRange) none += 1;
    }
    const skipped: SkipCount[] = [];
    if (noGeometry > 0)
      skipped.push({ cause: "no geometry", count: noGeometry });
    return {
      columns,
      rows,
      measured,
      skipped,
      // The default line IS §7.7's ("1,204 buildings measured"); only the
      // caveat is the tool's own.
      // A `SkipCount` (Task 7's channel): the COUNT is `summarise`'s to
      // render, so the cause carries the limit and no number.
      caveats:
        none > 0
          ? [{ cause: `none within ${params.maxDistanceM} m`, count: none }]
          : [],
    };
  } finally {
    await handle?.release();
  }
};

registerExecutor("distance-to-nearest", distanceToNearest);
```

- [ ] **Step 4: The registry entry**

In `src/features/processing/toolRegistry.ts`, the `distance-to-nearest` entry gains:

```ts
    // §7.7: "rule on `<prefix>distance_m <` median" — the nearer half.
    styleByResult: {
      kind: "rule",
      operator: "<",
      value: { kind: "median" },
      pick: (written) =>
        written.find((c) => c.name.endsWith("distance_m")) ?? null,
    },
    implemented: true,
```

In `src/features/processing/tools/register.ts`, add `import "./distanceToNearest";`, and add the id to `register.test.ts`'s expected list.

- [ ] **Step 5: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/processing/tools/distanceToNearest.ts \
  src/features/processing/tools/register.ts \
  src/features/processing/toolRegistry.ts \
  tests/unit/features/processing/distanceToNearest.test.ts \
  tests/unit/features/processing/register.test.ts
git commit -m "feat: Distance to nearest measures the 2D distance to a vector layer"
```

---
