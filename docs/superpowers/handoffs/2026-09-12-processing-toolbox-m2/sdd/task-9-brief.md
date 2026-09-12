### Task 9: The Roof metrics executor, in bounded batches

**Files:**

- Create: `src/features/processing/tools/roofMetrics.ts`
- Modify: `src/features/processing/runQueue.ts` (add `throwIfCancelled` to `ToolContext`), `src/features/processing/tools/register.ts:10`
- Test: `tests/unit/features/processing/roofMetricsTool.test.ts` (the pure halves), `tests/unit/features/processing/roofMetricsRun.test.ts` (lifecycle, in `runQueue.test.ts`'s style), `tests/unit/features/processing/register.test.ts:18`

**Interfaces:**

- Consumes: `ToolExecutor`/`ToolContext`/`ToolResult` (`runQueue.ts:85-108`); `rollUpRoofSurfaces` (Task 5); `roofGeometrySource`, `RoofGeometrySource` (Task 7); `roofParams`, `ROOF_MEASURES` (Task 8); `quoteIdent`, `quoteLiteral` from `src/insights/sql.ts`.
- Produces:
  - `runQueue.ts`: `ToolContext.throwIfCancelled(): void`.
  - `roofMetrics.ts`: `buildFeatureRowsReadSql(table, ids)`, `groupRowsByFeature(rows)`, `computeRoofRows(input): Promise<RoofComputeOutput>`, `ROOF_BATCH_FEATURES`, `roofMetrics: ToolExecutor`, and the registration.
- Task 10 consumes the executor's all-NULL case; Task 13 consumes the registration.

**The batch bound, stated.** `ROOF_BATCH_FEATURES = 500`. Between batches the executor yields with `await new Promise((r) => setTimeout(r, 0))` — a MACROTASK, so the event loop actually turns and the browser can paint and deliver the Cancel click. A microtask (`await Promise.resolve()`) would not: it runs before the loop turns. The abort is checked **after** the yield, not before it, because the click the yield exists to let through lands DURING the yield; checking first would run one more batch than necessary every time. 500 features is a few milliseconds of `computeRoofMetrics` on 3D BAG-shaped data and keeps the yield overhead under a percent on a 100k-feature layer; it is a constant in one place, so it is one edit if a real profile disagrees.

**What batching does and does not buy.** It does NOT make cancellation correct: `execute` already refuses to publish an aborted run (`runQueue.ts:515` re-checks `signal.aborted` immediately after the executor returns, and the catch reads `CancelledError` as "cancelled"), so a Cancel during a long compute was always honoured — it just had to wait for the whole computation first. What the yield buys is RESPONSIVENESS: the page keeps painting, the elapsed ticker keeps ticking, the Cancel button stays clickable, and the run stops at the next boundary instead of minutes later. `heightFromExtent` needs none of this and is unaffected.

**Why `throwIfCancelled` belongs on the context.** `CancelledError` is private to `runQueue.ts` (it is what tells `execute`'s catch "cancelled" rather than "failed"), and `ctx.query` is the only way an executor could reach it today. A tool that computes for seconds without querying can only stop at its own end. One method gives every future long executor the early exit.

- [ ] **Step 1: Write the failing tests for the pure halves**

Create `tests/unit/features/processing/roofMetricsTool.test.ts`:

```ts
/**
 * Spec §7.1's tool, and §7's contributor and roll-up rules through it.
 *
 * The pure halves are tested directly: `buildFeatureRowsReadSql` (the run's one
 * statement) and `computeRoofRows` (everything else). The executor itself is
 * glue over them, and Task 9's second file drives it through a real run.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildFeatureRowsReadSql,
  computeRoofRows,
} from "../../../../src/features/processing/tools/roofMetrics";
import type { RoofSurfaceMetric } from "../../../../src/domain/roofMetrics/roofRollUp";
import type { RoofGeometrySource } from "../../../../src/features/processing/roofGeometrySource";

const s = (
  lod: string,
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

/**
 * A source built from two plain maps: which LoDs each object has GEOMETRY at
 * (of any type), and which roof surfaces it has there. The separation IS the
 * rule under test.
 */
function source(
  geometry: Record<string, string[]>,
  roofs: Record<string, RoofSurfaceMetric[]>,
): RoofGeometrySource {
  return {
    has: (id) => id in geometry,
    hasGeometryAt: (id, lod) => (geometry[id] ?? []).includes(lod),
    roofSurfacesAt: (id, lod) =>
      (roofs[id] ?? []).filter((surface) => surface.lod === lod),
  };
}

describe("buildFeatureRowsReadSql", () => {
  it("reads every row when the scope named none", () => {
    expect(buildFeatureRowsReadSql("layer_1", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"',
    );
  });

  it("restricts to the frozen row ids, quoted", () => {
    expect(buildFeatureRowsReadSql("layer_1", ["b1", "o'x"])).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_1"' +
        ` WHERE "id" IN ('b1', 'o''x')`,
    );
  });
});

describe("computeRoofRows", () => {
  const rows = [
    { id: "B1", f: "B1" },
    { id: "B1P", f: "B1" },
    { id: "B2", f: "B2" },
  ];

  it("gives the ROOT the contributors' roll-up and a PART its own (§8)", async () => {
    const out = await computeRoofRows({
      rows,
      // The part has geometry at 2.2, so per §7 the PART is the contributor and
      // the root's own 2.2 surfaces are ignored (3D BAG stores both).
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        {
          B1: [s("2.2", 999, 0, 0)],
          B1P: [s("2.2", 10, 30, 180), s("2.2", 10, 0, 0)],
          B2: [s("2.2", 4, 45, 90)],
        },
      ),
      params: {
        measures: ["area", "flatShare", "azimuth"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B1P")).toEqual({
      roof_area_m2: 20,
      roof_flat_share: 0.5,
      roof_azimuth_deg: 180,
    });
    expect(out.rows.get("B2")).toEqual({
      roof_area_m2: 4,
      roof_flat_share: 0,
      roof_azimuth_deg: 90,
    });
    expect(out.measured).toBe(2);
    expect(out.skipped).toEqual([]);
  });

  it("selects a WALL-ONLY part as the contributor, and then finds no roof", async () => {
    // §7's rule is about GEOMETRY, not roofs: "if any part of the feature has
    // geometry, the PARTS are the contributors and the root's own geometry at
    // that LoD is ignored". A root roof beside a wall-only part is exactly the
    // 3D BAG double-storage the rule exists for, and measuring the root here
    // would report a roof the chosen contributor does not have.
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] },
        { B1: [s("2.2", 40, 30, 180)], B1P: [], B2: [s("2.2", 4, 45, 90)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.rows.get("B2")).toEqual({ roof_area_m2: 4 });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("falls back to the ROOT when no part has geometry at the LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], B1P: ["1.2"], B2: [] },
        { B1: [s("2.2", 12, 20, 270)], B1P: [s("1.2", 99, 20, 0)], B2: [] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: 12 });
    // The part has nothing at 2.2 — its OWN value is NULL, and that does not
    // take the building's away.
    expect(out.rows.get("B1P")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
  });

  it("sums UNEQUAL parts and weights the slope by their areas", async () => {
    const out = await computeRoofRows({
      rows: [
        { id: "B1", f: "B1" },
        { id: "P1", f: "B1" },
        { id: "P2", f: "B1" },
      ],
      source: source(
        { B1: ["2.2"], P1: ["2.2"], P2: ["2.2"] },
        {
          B1: [s("2.2", 500, 90, 0)],
          P1: [s("2.2", 30, 40, 180)],
          P2: [s("2.2", 10, 0, 0)],
        },
      ),
      params: {
        measures: ["area", "slope", "surfaces", "flatArea"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: 40,
      roof_flat_m2: 10,
      roof_slope_deg: (30 * 40) / 40,
      roof_surfaces_n: 2,
    });
    expect(out.rows.get("P1")).toEqual({
      roof_area_m2: 30,
      roof_flat_m2: 0,
      roof_slope_deg: 40,
      roof_surfaces_n: 1,
    });
    expect(out.rows.get("P2")).toEqual({
      roof_area_m2: 10,
      roof_flat_m2: 10,
      roof_slope_deg: 0,
      roof_surfaces_n: 1,
    });
  });

  it("writes NULL everywhere and counts the feature skipped, by LoD", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["1.2"], B1P: [], B2: [] },
        { B1: [s("1.2", 5, 0, 0)], B1P: [], B2: [] },
      ),
      params: {
        measures: ["area", "slope", "surfaces"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({
      roof_area_m2: null,
      roof_slope_deg: null,
      roof_surfaces_n: null,
    });
    expect(out.measured).toBe(0);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 2 },
    ]);
  });

  it("treats a row the source has never heard of as having nothing", async () => {
    // A streaming feature evicted between Run and the head of the queue. It is
    // in the frozen scope and in the table; it has no geometry NOW, which is
    // exactly what "no roof surfaces at LoD 2.2" says.
    const out = await computeRoofRows({
      rows,
      source: source({ B2: ["2.2"] }, { B2: [s("2.2", 4, 45, 90)] }),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.rows.get("B1")).toEqual({ roof_area_m2: null });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
  });

  it("writes a row for every row the table gave it, and no others", async () => {
    const out = await computeRoofRows({
      rows,
      source: source(
        { B1: ["2.2"], ghost: ["2.2"] },
        { B1: [s("2.2", 1, 0, 0)], ghost: [s("2.2", 1, 0, 0)] },
      ),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
    });
    expect([...out.rows.keys()].sort()).toEqual(["B1", "B1P", "B2"]);
  });

  it("respects the threshold in flat area and in the dominant azimuth", async () => {
    const build = (flatThresholdDeg: number) =>
      computeRoofRows({
        rows: [{ id: "B2", f: "B2" }],
        source: source(
          { B2: ["2.2"] },
          { B2: [s("2.2", 10, 4, 45), s("2.2", 6, 9, 270)] },
        ),
        params: { measures: ["flatArea", "azimuth"], flatThresholdDeg },
        prefix: "roof_",
        lod: "2.2",
      });
    expect((await build(5)).rows.get("B2")).toEqual({
      roof_flat_m2: 10,
      roof_azimuth_deg: 270,
    });
    expect((await build(15)).rows.get("B2")).toEqual({
      roof_flat_m2: 16,
      roof_azimuth_deg: null,
    });
  });

  it("declares one DOUBLE column per ticked measure, in the spec's order", async () => {
    const out = await computeRoofRows({
      rows,
      source: source({}, {}),
      params: {
        measures: ["surfaces", "area", "slope"],
        flatThresholdDeg: 5,
      },
      prefix: "roof_",
      lod: "2.2",
    });
    expect(out.columns).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("calls onBatch between bounded batches, not per feature", async () => {
    const onBatch = vi.fn(async () => {});
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await computeRoofRows({
      rows: many,
      source: source({}, {}),
      params: { measures: ["area"], flatThresholdDeg: 5 },
      prefix: "roof_",
      lod: "2.2",
      onBatch,
    });
    // 1200 features at 500 per batch: after the first and second batches.
    expect(onBatch).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as onBatch throws, instead of computing to the end", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `B${i}`,
      f: `B${i}`,
    }));
    await expect(
      computeRoofRows({
        rows: many,
        source: source({}, {}),
        params: { measures: ["area"], flatThresholdDeg: 5 },
        prefix: "roof_",
        lod: "2.2",
        onBatch: async () => {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
  });
});
```

Also update `tests/unit/features/processing/register.test.ts:17-19`:

```ts
it("registers exactly M2's executors, in `register.ts`'s import order", () => {
  expect(Object.keys(EXECUTORS)).toEqual([
    "height-from-extent",
    "roof-metrics",
  ]);
});
```

- [ ] **Step 2: Run and watch both fail**

```bash
npx vitest run tests/unit/features/processing/roofMetricsTool.test.ts \
  tests/unit/features/processing/register.test.ts
```

Expected: FAIL — the tool module does not exist, and `EXECUTORS` still holds one key.

- [ ] **Step 3: Give the context a cancellation check**

In `src/features/processing/runQueue.ts`, add to `ToolContext` (`:85-94`):

```ts
  /**
   * Throw if the user has cancelled — the ONE way a long, query-free executor
   * can be stopped.
   *
   * `ctx.query` already does this, which is enough for a tool whose work IS
   * queries — and `execute` already refuses to PUBLISH an aborted run right
   * after the executor returns. What a long, query-free executor lacks is the
   * early EXIT: without this it computes to the end and then discovers the run
   * was cancelled minutes ago. `CancelledError` is private to this module on
   * purpose: it is what makes `execute`'s catch read "cancelled" rather than
   * "failed", and an executor must not be able to fake either.
   */
  throwIfCancelled(): void;
```

and to the `ctx` literal (`:482-509`), beside `phase` and `warn`:

```ts
      throwIfCancelled() {
        if (signal.aborted) throw new CancelledError();
      },
```

- [ ] **Step 4: Write the executor**

Create `src/features/processing/tools/roofMetrics.ts`:

```ts
/**
 * Roof metrics to attributes (spec §7.1).
 *
 * NOTHING IS COMPUTED IN SQL. Roof area, inclination and azimuth are derived
 * from ring geometry, which exists nowhere in DuckDB (spec §2) and which the
 * app has already parsed. So this tool issues exactly ONE statement, and it is
 * a question about ROWS, not geometry:
 *
 *   which rows are in scope, and which FEATURE does each belong to?
 *
 * The table is the authority on that (it is what the write targets, and what
 * `feature_id` means); `RoofGeometrySource` is the authority on geometry, and
 * measures only what it is asked for. A row the source has never heard of
 * simply has nothing — which is true for a streaming feature that left the
 * resident set between Run and the head of the queue, and is reported as a
 * skip rather than as an error.
 *
 * `needsReader` is false and no source is registered, so §6.1's "Reading
 * source" phase is skipped and the run goes straight to Computing.
 *
 * BOUNDED WORK. Features are rolled up in batches of `ROOF_BATCH_FEATURES`,
 * and between batches the caller's `onBatch` runs — in the executor that is a
 * cancellation check plus a yield to the event loop, so a run over a large
 * layer neither freezes the page nor outruns the Cancel button.
 */

import { quoteIdent, quoteLiteral } from "../../../insights/sql";
import type { OutputColumn } from "../../../insights/computedColumns";
import {
  rollUpRoofSurfaces,
  type RoofRollUp,
  type RoofSurfaceMetric,
} from "../../../domain/roofMetrics/roofRollUp";
import {
  ROOF_MEASURES,
  roofParams,
  type RoofMeasure,
  type RoofMetricsParams,
} from "../roofMetricsParams";
import {
  roofGeometrySource,
  type RoofGeometrySource,
} from "../roofGeometrySource";
import type { ToolExecutor } from "../runQueue";
import type { SkipCount } from "../types";
import { registerExecutor } from "./index";

/** Features per batch. See the module comment: a bound, not a tuning knob. */
export const ROOF_BATCH_FEATURES = 500;

/** One table row: its own id, and the feature it belongs to. */
export interface FeatureRow {
  readonly id: string;
  readonly f: string;
}

/**
 * The run's one statement.
 *
 * `ids` are ROW ids — `resolveScope` has already expanded the user's selection
 * or filter to whole features — and `null` means every row.
 */
export function buildFeatureRowsReadSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f FROM ${quoteIdent(table)}` +
    where
  );
}

/** The scope's rows, grouped by feature, in first-seen order. */
export function groupRowsByFeature(
  rows: ReadonlyArray<FeatureRow>,
): ReadonlyArray<readonly [string, ReadonlyArray<FeatureRow>]> {
  const members = new Map<string, FeatureRow[]>();
  for (const row of rows) {
    const list = members.get(row.f);
    if (list) list.push(row);
    else members.set(row.f, [row]);
  }
  return [...members.entries()];
}

/** One measure of one roll-up, or null when it could not be evaluated. */
function valueOf(measure: RoofMeasure, rollUp: RoofRollUp): number | null {
  switch (measure) {
    case "area":
      return rollUp.areaM2;
    case "flatArea":
      return rollUp.flatM2;
    case "flatShare":
      return rollUp.flatShare;
    case "slope":
      return rollUp.slopeDeg;
    case "azimuth":
      return rollUp.azimuthDeg;
    case "surfaces":
      return rollUp.surfaces;
  }
}

export interface RoofComputeInput {
  readonly rows: ReadonlyArray<FeatureRow>;
  readonly source: RoofGeometrySource;
  readonly params: RoofMetricsParams;
  readonly prefix: string;
  readonly lod: string;
  /** Run between batches. Throwing from it aborts the whole computation. */
  readonly onBatch?: () => Promise<void>;
}

export interface RoofComputeOutput {
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Record<string, number | null>>;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

/**
 * Spec §7's contributor rule and roll-ups, over the rows the table gave us.
 *
 * CONTRIBUTORS (§7, verbatim): "At the chosen LoD, if any part of the feature
 * has GEOMETRY, the PARTS are the contributors and the root's own geometry at
 * that LoD is ignored (3D BAG stores the same building on both); otherwise the
 * root is the sole contributor." GEOMETRY — of any semantic type. A root with
 * a roof and a part with only walls selects the PART, and the feature is then
 * skipped for having no roof. Using the root's roof instead would report the
 * very double-storage this rule exists to avoid.
 *
 * WHAT EACH ROW GETS (§8): the ROOT row carries the feature's roll-up; every
 * other row carries its OWN. A part stamped with its building's total is a
 * measurement of something the user never selected.
 *
 * COUNTING (§7): per FEATURE. A building with one measurable contributor is
 * one building measured, whatever its other parts lack.
 */
export async function computeRoofRows(
  input: RoofComputeInput,
): Promise<RoofComputeOutput> {
  const ticked = ROOF_MEASURES.filter((m) =>
    input.params.measures.includes(m.key),
  );
  const columns: OutputColumn[] = ticked.map((m) => ({
    name: `${input.prefix}${m.suffix}`,
    type: "DOUBLE",
  }));

  const values = (rollUp: RoofRollUp | null): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const measure of ticked) {
      out[`${input.prefix}${measure.suffix}`] =
        rollUp === null ? null : valueOf(measure.key, rollUp);
    }
    return out;
  };

  const rows = new Map<string, Record<string, number | null>>();
  let measured = 0;
  let skipped = 0;
  let sinceYield = 0;

  for (const [featureId, memberRows] of groupRowsByFeature(input.rows)) {
    const parts = memberRows.filter((row) => row.id !== featureId);
    const partContributors = parts.filter((row) =>
      input.source.hasGeometryAt(row.id, input.lod),
    );
    const contributors =
      partContributors.length > 0
        ? partContributors
        : memberRows.filter(
            (row) =>
              row.id === featureId &&
              input.source.hasGeometryAt(row.id, input.lod),
          );

    const surfaces: RoofSurfaceMetric[] = [];
    for (const row of contributors) {
      surfaces.push(...input.source.roofSurfacesAt(row.id, input.lod));
    }
    const featureRollUp = rollUpRoofSurfaces(
      surfaces,
      input.params.flatThresholdDeg,
    );
    if (featureRollUp === null) skipped += 1;
    else measured += 1;

    for (const row of memberRows) {
      rows.set(
        row.id,
        row.id === featureId
          ? values(featureRollUp)
          : values(
              rollUpRoofSurfaces(
                [...input.source.roofSurfacesAt(row.id, input.lod)],
                input.params.flatThresholdDeg,
              ),
            ),
      );
    }

    sinceYield += 1;
    if (sinceYield >= ROOF_BATCH_FEATURES && input.onBatch) {
      sinceYield = 0;
      await input.onBatch();
    }
  }

  return {
    columns,
    rows,
    measured,
    skipped:
      skipped > 0
        ? [{ cause: `no roof surfaces at LoD ${input.lod}`, count: skipped }]
        : [],
  };
}

export const roofMetrics: ToolExecutor = async (run, ctx) => {
  // The form guarantees a LoD (Run is refused with "No roof surfaces in this
  // layer" when none qualifies), so this is unreachable through the UI. It is
  // here because a skip cause reading "no roof surfaces at LoD null" would be
  // worse than a failure.
  if (run.lod === null) throw new Error("No roof surfaces in this layer");

  ctx.phase("compute");
  const out = await ctx.query(
    "Reading features",
    buildFeatureRowsReadSql(ctx.table.table, ctx.featureIds),
  );
  // A type guard, not logic: the context throws on a failed query.
  if (!out.ok) throw new Error(out.message);
  // The query above can take a while on a large scope, and a Cancel pressed
  // during it should not be answered by starting the compute.
  ctx.throwIfCancelled();

  const computed = await computeRoofRows({
    rows: out.rows.map((row) => ({ id: String(row.id), f: String(row.f) })),
    source: roofGeometrySource(ctx.layer),
    params: roofParams(run.params),
    prefix: run.prefix,
    lod: run.lod,
    onBatch: async () => {
      // YIELD FIRST, then check. A MACROTASK, so the event loop actually turns:
      // the page can paint and the Cancel click can land — and it lands DURING
      // this await, which is why the check comes after it. `await
      // Promise.resolve()` is a microtask and would yield to nothing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      ctx.throwIfCancelled();
    },
  });

  return {
    columns: computed.columns,
    rows: computed.rows,
    measured: computed.measured,
    skipped: computed.skipped,
  };
};

registerExecutor("roof-metrics", roofMetrics);
```

- [ ] **Step 5: Wire the registration**

`src/features/processing/tools/register.ts` — append after `import "./heightFromExtent";`:

```ts
import "./roofMetrics";
```

The import ORDER is the assertion in `register.test.ts`: `EXECUTORS` is a plain object, so `Object.keys` follows insertion order, which follows this file.

- [ ] **Step 6: Write the lifecycle tests**

Create `tests/unit/features/processing/roofMetricsRun.test.ts` by **copying `tests/unit/features/processing/runQueue.test.ts`'s header verbatim** (`:1-235`: the `sql`/`registered` arrays, `freshTable`, `featureTotal`, `scopeRows`, `gate`, `failing`, `liveColumns`, the `vi.mock` of `insights/duckdb` and of `insights/layerTables`, the dynamic imports, `deferred`, `computedAlready`, `request`, `attributesOf`, and its `beforeEach`/`afterEach`) plus Task 1's two new duckdb keys. Then change three things:

1. `model()` returns the roof fixture below instead of the single empty `a`.
2. `layer()` gains `selectedLod: "2.2"` and `availableLods: ["2.2", "1.2"]`.
3. `afterEach` also does `delete EXECUTORS["roof-metrics"]`, and the suite imports `"../../../../src/features/processing/tools/register"` for its side effect (this file is about the REAL executor).

The gate is `{ needle, promise }` (`runQueue.test.ts:53-54,65`), armed as `gate = { needle: "…", promise: held.promise }` where `held = deferred<void>()`; it is released with `held.resolve()`. **There is no `gate?.resolve()`.**

```ts
/**
 * Roof metrics driven through a REAL run: the queue, the write, the model
 * merge, scoped replacement, Undo, cancellation and the streaming
 * invalidation. The pure roll-ups are covered in `roofMetricsTool.test.ts`;
 * this file is about what a user has afterwards.
 */

/** A unit square of `type` at `lod`, scaled so its area is `area`. */
function square(type: string, lod: string, area: number, slope = 0) {
  const w = Math.sqrt(area);
  // `slope` is baked by lifting one edge: inclination is only asserted through
  // the roll-up, so a 0/45 pair is enough to make the threshold matter.
  const dz = slope === 0 ? 0 : w;
  return {
    type,
    rings: [
      [
        [0, 0, 3],
        [w, 0, 3],
        [w, w, 3 + dz],
        [0, w, 3 + dz],
      ],
    ],
    attributes: {},
    lod,
  };
}

/**
 * B1 (Building) + P1 (roof 30 m², pitched 45°) + P2 (roof 10 m², flat);
 * B2 (Building, roof 12 m² flat at 2.2, NO parts);
 * B3 (Building, roof at 1.2 only).
 *
 * B1's two parts are UNEQUAL, so a sum can be told from a max; B2 is in the
 * layer but outside the Selected scope below, so a replacement can be shown to
 * leave a NON-NULL value alone; B3 is the skip.
 */
function model(): CityModel {
  const object = (
    id: string,
    objectType: string,
    surfaces: unknown[],
    parents: string[] = [],
    children: string[] = [],
  ) => ({
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  });
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object(
        "B1",
        "Building",
        [square("RoofSurface", "2.2", 99)],
        [],
        ["P1", "P2"],
      ),
      P1: object(
        "P1",
        "BuildingPart",
        [square("RoofSurface", "2.2", 30, 45)],
        ["B1"],
      ),
      P2: object(
        "P2",
        "BuildingPart",
        [square("RoofSurface", "2.2", 10)],
        ["B1"],
      ),
      B2: object("B2", "Building", [square("RoofSurface", "2.2", 12)]),
      B3: object("B3", "Building", [square("RoofSurface", "1.2", 5)]),
    },
  } as unknown as CityModel;
}

/** Every row of the fake table, which is what `scopeRows` answers with. */
const ALL_ROWS = [
  { id: "B1", f: "B1" },
  { id: "P1", f: "B1" },
  { id: "P2", f: "B1" },
  { id: "B2", f: "B2" },
  { id: "B3", f: "B3" },
];

/** The roof request, with the shape `submitRun` wants. */
function roofRequest(overrides: Record<string, unknown> = {}) {
  return request({
    toolId: "roof-metrics",
    lod: "2.2",
    prefix: "roof_",
    params: {
      measures: ["area", "flatArea", "surfaces"],
      flatThresholdDeg: 5,
    },
    columns: [
      { name: "roof_area_m2", type: "DOUBLE" as const },
      { name: "roof_flat_m2", type: "DOUBLE" as const },
      { name: "roof_surfaces_n", type: "DOUBLE" as const },
    ],
    ...overrides,
  });
}

describe("a Roof metrics run", () => {
  beforeEach(() => {
    featureTotal = 3;
    scopeRows = ALL_ROWS;
  });

  it("sums UNEQUAL parts onto the building and leaves each part its own", async () => {
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));

    // §7's contributor rule: B1's PARTS contribute, its own 99 m² roof is
    // ignored. 30 + 10 = 40, and a max or a root read would not give 40.
    expect(attributesOf("B1").roof_area_m2).toBeCloseTo(40, 6);
    expect(attributesOf("P1").roof_area_m2).toBeCloseTo(30, 6);
    expect(attributesOf("P2").roof_area_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B1").roof_surfaces_n).toBe(2);
    expect(attributesOf("B2").roof_area_m2).toBeCloseTo(12, 6);
    // B3 has no roof at 2.2: NULL, and one skip naming the LoD.
    expect(attributesOf("B3").roof_area_m2).toBeNull();
    expect(runById(id)!.summary!.skipped).toEqual([
      { cause: "no roof surfaces at LoD 2.2", count: 1 },
    ]);
    expect(
      sql.some((q) => q.includes('COALESCE("feature_id", "id") AS f')),
    ).toBe(true);
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(true);
  });

  it("replaces inside the scope only, with a THRESHOLD that changes the value", async () => {
    // Run 1, All, threshold 5: P1 (45°) is not flat, P2 (0°) is.
    const first = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(first)?.status).toBe("done"));
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);

    // Run 2, Selected on B1's family, threshold 50: now P1 counts as flat too,
    // so B1's flat area MUST move from 10 to 40. B2 is outside the scope and
    // its value is NON-NULL, so §7's "values in a replaced column outside the
    // scope keep their existing value" has something real to preserve.
    useSelectionStore.getState().select({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
    scopeRows = ALL_ROWS.filter((r) => r.f === "B1");
    const second = submitRun(
      roofRequest({
        scope: "selected",
        params: {
          measures: ["area", "flatArea", "surfaces"],
          flatThresholdDeg: 50,
        },
      }),
    );
    await vi.waitFor(() => expect(runById(second)?.status).toBe("done"));

    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(40, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
    // §6.2: the later run takes the earlier one's Undo.
    expect(runById(first)?.undoable).toBe(false);
    expect(runById(second)?.undoable).toBe(true);

    await undoRun(second);
    expect(attributesOf("B1").roof_flat_m2).toBeCloseTo(10, 6);
    expect(attributesOf("B2").roof_flat_m2).toBeCloseTo(12, 6);
  });

  it("publishes NOTHING when the Cancel lands during the compute", async () => {
    // The gate holds the executor's OWN read — the statement no other run
    // issues — so the run is demonstrably inside `roofMetrics` when Cancel is
    // pressed, not still queued.
    const held = deferred<void>();
    gate = { needle: "AS f FROM", promise: held.promise };
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.phase).toBe("compute"));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("AS f FROM"))).toBe(true),
    );
    cancelRun(id);
    held.resolve();

    await vi.waitFor(() => expect(runById(id)?.status).toBe("cancelled"));
    expect(attributesOf("B1").roof_area_m2).toBeUndefined();
    expect(computedColumnsOf("L1").has("roof_area_m2")).toBe(false);
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("fails rather than writing when the table was rebuilt under it", async () => {
    // Held at the FEATURE COUNT, which `resolveScope` issues at the head of
    // the queue — before the table name is re-checked for the write.
    const held = deferred<void>();
    gate = { needle: "COUNT(DISTINCT", promise: held.promise };
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() =>
      expect(sql.some((q) => q.includes("COUNT(DISTINCT"))).toBe(true),
    );
    tableInfo = { ...tableInfo, table: "layer_2" }; // a streaming rebuild
    held.resolve();

    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe("Layer changed while running; run again");
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  it("marks a finished run stale when the layer's table is rebuilt after it", async () => {
    const stop = installStaleWatcher();
    const id = submitRun(roofRequest({ scope: "all" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    useLayerTableStore.setState({
      tables: {
        L1: { state: "ready", info: { ...tableInfo, table: "layer_9" } },
      },
    });
    await vi.waitFor(() => expect(runById(id)?.stale).toBe(true));
    stop();
  });
});
```

Two details the copy has to get right. `tableInfo` is the file's mutable table fixture (`freshTable()`, reset in `beforeEach`), and the `layerTables` mock reads it — reassigning it IS the rebuild. `installStaleWatcher` and `useLayerTableStore` come from the same imports `runQueue.test.ts`'s own stale-watcher case uses; copy that case's setup rather than inventing a second pattern. If the rebuilt-table case turns out to be covered identically by the existing suite for Height from extent, keep only the roof-specific ones and say so in the file's header comment — duplicated coverage is worse than a named gap.

- [ ] **Step 7: Run everything**

```bash
npx vitest run tests/unit/features/processing
npx tsc -b --noEmit
```

Expected: PASS, including the updated `EXECUTORS` pin.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/tools/roofMetrics.ts \
  src/features/processing/tools/register.ts src/features/processing/runQueue.ts \
  tests/unit/features/processing/roofMetricsTool.test.ts \
  tests/unit/features/processing/roofMetricsRun.test.ts \
  tests/unit/features/processing/register.test.ts
git commit -m "feat(processing): Roof metrics computes the six columns in bounded batches"
```

---
