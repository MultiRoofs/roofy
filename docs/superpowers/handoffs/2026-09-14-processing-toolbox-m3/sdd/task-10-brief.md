### Task 10: Validate solids

**Files:**

- Create: `src/features/processing/tools/validateSolids.ts`
- Modify: `src/features/processing/toolRegistry.ts`, `src/features/processing/tools/register.ts`, `src/ui/processing/useLodOptions.ts`, `src/ui/processing/ToolView.tsx`, `tests/unit/features/processing/register.test.ts`
- Test: `tests/unit/features/processing/validateSolids.test.ts`, plus two cases appended to `tests/unit/ui/processing/solidsEnabled.test.tsx` and one to `tests/unit/features/processing/runQueue.test.ts` (the card §7.3 prints, through `summarise`, which that suite already imports)

**Interfaces:**

- Consumes: `validationColumns(prefix)`, `buildSolidValidationSql`, `buildScopeRowsSql` (Task 6), `readSource` + `assertSourceIds` + `readerQuery` (Task 5), `groupContributors` / `countsAsSkips` / the two skip causes (Task 7), `ToolResult.line` + `.caveats` (Task 7), `solidLodOptions` (Task 3), `StyleByResult` (Task 9).
- Produces: `validateSolids: ToolExecutor`; the registry entry's `outputColumns`, its `styleByResult`

```ts
    styleByResult: {
      kind: "rule",
      operator: "=",
      value: { kind: "literal", value: false },
      pick: (written) =>
        written.find((c) => c.name.toLowerCase().endsWith("valid")) ?? null,
    },
```

(already in place from Task 9), `implemented: true`, and the `useLodOptions` branch — **all in one commit**, since the tool has no parameters to stage.

**§7.3's card line is `line`, not two caveats.** The spec's card is `"1,079 valid · 125 with issues"` — the VALID count is this tool's own first phrase, which is exactly what `ToolResult.line` exists for (Task 7 declares it for this case). Putting both halves in `caveats` and leaving `line` unset would print the default phrase first and read `"1,204 buildings measured · 1,079 valid · 125 with issues · 2.4 s"` — a card with three counts where the spec has two, and a "measured" count the spec never shows for this tool. So `line` is `"<valid> valid"` and the ONE caveat is `"with issues"`; `measured` still carries `valid + withIssues`, because that is what the provenance summary and §6.2's "N objects" are counted from.

**`<prefix>valid` is INTERPOLATED, never the literal `solid_valid`.** The prefix is the user's (`defaultPrefix: "solid_"`, editable), so §7.3's names are `${prefix}closed` … `${prefix}degenerate_faces_n`. Task 9's `pick` matches `endsWith("valid")` for the same reason: the table's spelling wins over the typed one, so an exact interpolated match could miss a column whose case the table changed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/validateSolids.test.ts`:

```ts
/**
 * §7.3: seven columns per feature — four BOOLEAN flags ANDed over the
 * contributors and three diagnostic counts summed — the same two skip causes as
 * §7.2, and the card line "1,079 valid · 125 with issues".
 *
 * The tool never measures anything: it reports what
 * `ST_3DValidationReport` says, which is why it needs no `ST_3DVolume` guard
 * and no parameters.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { LayerTable } from "../../../../src/insights/layerTables";
import type { QueryOutcome } from "../../../../src/insights/duckdb";

const release = vi.fn(async () => {});
const readSource = vi.fn(async () => ({
  from: "read_cityjson('layer_1_run_1.city.json', lod => '2.2')",
  geometryColumn: "geometry_lod2_2",
  propertiesColumn: "geometry_properties_lod2_2",
  release,
}));
vi.mock("../../../../src/features/processing/sourceRead", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/sourceRead")
  >("../../../../src/features/processing/sourceRead");
  return { ...actual, readSource };
});
vi.mock("../../../../src/insights/duckdb", () => ({
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  runQuery: vi.fn(async () => ({ ok: false, message: "not used here" })),
  ddl: vi.fn(async () => ({ ok: false, message: "not used here" })),
  readFile: vi.fn(async () => null),
  getDuckDBStatus: vi.fn(() => ({ state: "ready", extensions: {} })),
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  formatDuckDBError: (e: unknown) => String(e),
  initDuckDB: vi.fn(async () => {}),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { SOURCE_IDS_DIFFER, SOURCE_READ_FAILED } =
  await import("../../../../src/features/processing/sourceRead");
const { validateSolids } =
  await import("../../../../src/features/processing/tools/validateSolids");

/** One row of `buildSolidValidationSql`'s output. */
const reportRow = (
  id: string,
  f: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  f,
  parsed: true,
  closed: true,
  manifold: true,
  oriented: true,
  valid: true,
  open_edges_n: 0,
  nonmanifold_edges_n: 0,
  degenerate_faces_n: 0,
  ...over,
});

function layerWith(lodsByObject: Record<string, string[]>): Layer {
  const objects: Record<string, unknown> = {};
  for (const [id, lods] of Object.entries(lodsByObject)) {
    objects[id] = {
      id,
      objectType: id.includes("P") ? "BuildingPart" : "Building",
      attributes: {},
      surfaces: lods.map((lod) => ({
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod,
        geometryType: "Solid",
      })),
      bbox: null,
      children: [],
      parents: [],
      lod: null,
    };
  }
  return {
    id: "L1",
    name: "Delft",
    isStreaming: false,
    selectedLod: "2.2",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects,
    },
  } as unknown as Layer;
}

const TABLE = {
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: async () => new Uint8Array(),
  reader: "read_cityjson",
  extension: "city.json",
  sourceBytes: 10,
  columns: [],
  lods: [{ label: "2.2", suffix: "2_2" }],
  rowCount: 2,
} as unknown as LayerTable;

function context(layer: Layer, answers: ReadonlyArray<QueryOutcome>) {
  let next = 0;
  const labels: string[] = [];
  /** The SQL of each statement, in order — what the cases assert against. */
  const statements: string[] = [];
  const warnings: string[] = [];
  return {
    labels,
    statements,
    warnings,
    ctx: {
      table: TABLE,
      layer,
      featureIds: null,
      signal: new AbortController().signal,
      // BOTH parameters, and the SQL is KEPT: a one-parameter `vi.fn` infers
      // the tuple `[label: string]`, so `ctx.query.mock.calls[1]?.[1]` is a
      // type error — and an assertion over `String(undefined)` would pass
      // against anything, including a statement that never ran.
      query: vi.fn(async (label: string, sql: string) => {
        labels.push(label);
        statements.push(sql);
        const answer = answers[next++];
        if (!answer) throw new Error(`unexpected query: ${label}`);
        if (!answer.ok) throw new Error(answer.message);
        return answer;
      }),
      phase: () => {},
      warn: (text: string) => warnings.push(text),
      throwIfCancelled: () => {},
    },
  };
}

const run = (over: Record<string, unknown> = {}) =>
  ({
    id: "run_1",
    toolId: "validate-solids",
    lod: "2.2",
    prefix: "solid_",
    params: {},
    ...over,
  }) as never;

afterEach(() => {
  vi.clearAllMocks();
});

describe("validateSolids", () => {
  it("writes §7.3's seven columns, in §7.3's order", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [reportRow("B1", "B1")] },
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.columns).toEqual([
      { name: "solid_closed", type: "BOOLEAN" },
      { name: "solid_manifold", type: "BOOLEAN" },
      { name: "solid_oriented", type: "BOOLEAN" },
      { name: "solid_valid", type: "BOOLEAN" },
      { name: "solid_open_edges_n", type: "DOUBLE" },
      { name: "solid_nonmanifold_edges_n", type: "DOUBLE" },
      { name: "solid_degenerate_faces_n", type: "DOUBLE" },
    ]);
  });

  it("honours the user's prefix", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [reportRow("B1", "B1")] },
    ]);
    const result = await validateSolids(run({ prefix: "chk_" }), ctx as never);
    expect(result.columns.map((c) => c.name)).toContain("chk_valid");
  });

  it("ANDs the flags and SUMS the counts over the contributors", async () => {
    // §7.3: "Feature roll-up per §7: flags AND, counts sum."
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"], B1Q: ["2.2"] });
    const { ctx } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B1P", f: "B1" },
          { id: "B1Q", f: "B1" },
        ],
      },
      {
        ok: true,
        columns: [],
        rows: [
          reportRow("B1P", "B1", {
            open_edges_n: 2,
            closed: false,
            valid: false,
          }),
          reportRow("B1Q", "B1", { open_edges_n: 3, degenerate_faces_n: 1 }),
        ],
      },
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")).toEqual({
      solid_closed: false,
      solid_manifold: true,
      solid_oriented: true,
      solid_valid: false,
      solid_open_edges_n: 5,
      solid_nonmanifold_edges_n: 0,
      solid_degenerate_faces_n: 1,
    });
    // §8: every other row carries its OWN report.
    expect(result.rows.get("B1Q")).toMatchObject({
      solid_open_edges_n: 3,
      solid_valid: true,
    });
    expect(result.measured).toBe(1);
  });

  it("reports NO count on an unparsed solid — NULL in all seven", async () => {
    // §7.3: "no geometry or unparseable geometry gives NULL in every column".
    // A zero count would read as "checked, and nothing is wrong".
    const layer = layerWith({ B1: ["2.2"], B2: ["1.2"] });
    const { ctx } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B2", f: "B2" },
        ],
      },
      {
        ok: true,
        columns: [],
        rows: [
          reportRow("B1", "B1", {
            parsed: false,
            closed: null,
            manifold: null,
            oriented: null,
            valid: null,
            open_edges_n: null,
            nonmanifold_edges_n: null,
            degenerate_faces_n: null,
          }),
        ],
      },
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")).toEqual({
      solid_closed: null,
      solid_manifold: null,
      solid_oriented: null,
      solid_valid: null,
      solid_open_edges_n: null,
      solid_nonmanifold_edges_n: null,
      solid_degenerate_faces_n: null,
    });
    expect(result.measured).toBe(0);
    expect(result.skipped).toEqual([
      { cause: "no geometry at LoD 2.2", count: 1 },
      { cause: "not a solid", count: 1 },
    ]);
  });

  it("carries §7.3's card line: the valid count IS the line", async () => {
    // §7.3: 'Card: "1,079 valid · 125 with issues"'. Two counts, not three —
    // so the VALID half is the tool's own `line` and only "with issues" is a
    // caveat. Both halves are FEATURES and they sum to `measured`, which is
    // what the provenance summary counts from even though the card omits it.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"], B3: ["2.2"] });
    const { ctx } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B2", f: "B2" },
          { id: "B3", f: "B3" },
        ],
      },
      {
        ok: true,
        columns: [],
        rows: [
          reportRow("B1", "B1"),
          reportRow("B2", "B2"),
          reportRow("B3", "B3", {
            valid: false,
            closed: false,
            open_edges_n: 4,
          }),
        ],
      },
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.measured).toBe(3);
    expect(result.line).toBe("2 valid");
    expect(result.caveats).toEqual([{ cause: "with issues", count: 1 }]);
  });

  it("omits an empty half of the card line", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [reportRow("B1", "B1")] },
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.line).toBe("1 valid");
    expect(result.caveats).toEqual([]);
  });

  it("never issues ST_3DVolume, and releases the bytes", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, statements } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [reportRow("B1", "B1")] },
    ]);
    await validateSolids(run(), ctx as never);
    // The REAL statement, not `String(undefined)` — which would satisfy
    // `.not.toContain("ST_3DVolume")` even if no statement had run at all.
    const sql = statements[1] ?? "";
    expect(sql).toContain("ST_3DValidationReport");
    expect(sql).toContain("r.is_closed AS closed");
    expect(sql).not.toContain("ST_3DVolume");
    expect(release).toHaveBeenCalled();
  });

  it("fails with §6.1's id sentence on a PARTIAL answer from the source", async () => {
    // The same threshold as §7.2's: every contributor, not "no match at all".
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B2", f: "B2" },
        ],
      },
      { ok: true, columns: [], rows: [reportRow("B1", "B1")] },
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("gives a reader failure §6.1's own sentence, engine words to the log", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: false, message: "IO Error: Could not read from file" },
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_READ_FAILED,
    );
    expect(warnings).toEqual(["IO Error: Could not read from file"]);
    expect(release).toHaveBeenCalled();
  });

  it("refuses a run with no LoD", async () => {
    const { ctx } = context(layerWith({ B1: ["2.2"] }), []);
    await expect(
      validateSolids(run({ lod: null }), ctx as never),
    ).rejects.toThrow("No solid geometry in this layer");
  });
});
```

And append to `tests/unit/features/processing/runQueue.test.ts`, which already imports `summarise`, the card §7.3 actually prints:

```ts
it("prints a tool's OWN line in place of the measured count", async () => {
  // §7.3's card, verbatim: "1,079 valid · 125 with issues". TWO counts, not
  // three — the valid count IS the line, so the default "N buildings
  // measured" phrase never appears for this tool.
  expect(
    summarise(
      {
        columns: [],
        rows: new Map(),
        measured: 1204,
        skipped: [],
        line: "1,079 valid",
        caveats: [{ cause: "with issues", count: 125 }],
      },
      2400,
      { streaming: false },
    ).line,
  ).toBe("1,079 valid · 125 with issues · 2.4 s");
});
```

And append to `tests/unit/ui/processing/solidsEnabled.test.tsx`:

```tsx
describe("Validate solids, switched on", () => {
  it("shares the solids LoD answer and promises §7.3's seven columns", () => {
    addSolidLayer();
    render(<ToolView toolId="validate-solids" />);
    expect(
      [
        ...screen
          .getByRole("combobox", { name: "LoD" })
          .querySelectorAll("option"),
      ].map((o) => o.textContent),
    ).toEqual([
      "2.2 (1 building with a solid)",
      "1.2 (1 building with a solid)",
    ]);
    expect(
      screen.getByText(
        "solid_closed, solid_manifold, solid_oriented, solid_valid, solid_open_edges_n, solid_nonmanifold_edges_n, solid_degenerate_faces_n",
      ),
    ).toBeInTheDocument();
  });

  it("has a PARAMETERS section that is one note, and Run is enabled", () => {
    addSolidLayer();
    render(<ToolView toolId="validate-solids" />);
    expect(
      screen.getByText("Validity is always written as <prefix>valid."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/validateSolids.test.ts \
  tests/unit/ui/processing/solidsEnabled.test.tsx
```

Expected: FAIL — `tools/validateSolids` does not exist, and the tool is still "Not available yet".

- [ ] **Step 3: Write the executor**

Create `src/features/processing/tools/validateSolids.ts`:

```ts
/**
 * Validate solids (spec §7.3).
 *
 * Structurally Measure solids' twin, and deliberately so: the same two
 * statements (the layer table for the scope's rows and their features, then the
 * re-read source for the contributors), the same §7 contributor rule from the
 * MODEL's tags, the same two skip causes. What differs is the statement it
 * issues and the roll-up: flags AND, counts SUM, and NOTHING is measured —
 * `ST_3DValidationReport` answers on any parsed solid, so there is no
 * `ST_3DVolume` here and nothing to guard.
 *
 * No parameters: §7.3's only input besides the target and the scope is the LoD.
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { geometryLodsByObject } from "../roofGeometrySource";
import { assertSourceIds, readSource, readerQuery } from "../sourceRead";
import { validationColumns } from "../solidParams";
import { buildScopeRowsSql, buildSolidValidationSql } from "../solidSql";
import {
  SKIP_NOT_A_SOLID,
  countsAsSkips,
  groupContributors,
  skipNoGeometry,
  type FeatureRow,
} from "../solidRollUp";
import type { ToolExecutor } from "../runQueue";
import { registerExecutor } from "./index";

/** Features per batch — the same bound Measure solids uses. */
export const VALIDATE_BATCH_FEATURES = 500;

/** One row of `buildSolidValidationSql`'s output. */
interface ReportRow {
  readonly id: string;
  readonly parsed: boolean;
  readonly closed: boolean | null;
  readonly manifold: boolean | null;
  readonly oriented: boolean | null;
  readonly valid: boolean | null;
  readonly open_edges_n: number | null;
  readonly nonmanifold_edges_n: number | null;
  readonly degenerate_faces_n: number | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

function toReportRow(row: Readonly<Record<string, unknown>>): ReportRow {
  return {
    id: String(row["id"]),
    parsed: row["parsed"] === true,
    closed: bool(row["closed"]),
    manifold: bool(row["manifold"]),
    oriented: bool(row["oriented"]),
    valid: bool(row["valid"]),
    open_edges_n: num(row["open_edges_n"]),
    nonmanifold_edges_n: num(row["nonmanifold_edges_n"]),
    degenerate_faces_n: num(row["degenerate_faces_n"]),
  };
}

/** §7: flags AND, counts sum, over the PARSED contributors. Null for none. */
function rollUpReports(
  parsed: ReadonlyArray<ReportRow>,
): Omit<ReportRow, "id" | "parsed"> | null {
  if (parsed.length === 0) return null;
  const and = (pick: (r: ReportRow) => boolean | null): boolean | null => {
    let out: boolean | null = true;
    for (const row of parsed) {
      const value = pick(row);
      if (value === false) return false;
      if (value === null) out = null;
    }
    return out;
  };
  const sum = (pick: (r: ReportRow) => number | null): number | null => {
    let total = 0;
    let any = false;
    for (const row of parsed) {
      const value = pick(row);
      if (value !== null) {
        total += value;
        any = true;
      }
    }
    return any ? total : null;
  };
  return {
    closed: and((r) => r.closed),
    manifold: and((r) => r.manifold),
    oriented: and((r) => r.oriented),
    valid: and((r) => r.valid),
    open_edges_n: sum((r) => r.open_edges_n),
    nonmanifold_edges_n: sum((r) => r.nonmanifold_edges_n),
    degenerate_faces_n: sum((r) => r.degenerate_faces_n),
  };
}

/** One roll-up as the run's column values, all seven, NULL when unavailable. */
function valuesOf(
  rollUp: Omit<ReportRow, "id" | "parsed"> | null,
  prefix: string,
): Record<string, unknown> {
  return {
    [`${prefix}closed`]: rollUp?.closed ?? null,
    [`${prefix}manifold`]: rollUp?.manifold ?? null,
    [`${prefix}oriented`]: rollUp?.oriented ?? null,
    [`${prefix}valid`]: rollUp?.valid ?? null,
    [`${prefix}open_edges_n`]: rollUp?.open_edges_n ?? null,
    [`${prefix}nonmanifold_edges_n`]: rollUp?.nonmanifold_edges_n ?? null,
    [`${prefix}degenerate_faces_n`]: rollUp?.degenerate_faces_n ?? null,
  };
}

export const validateSolids: ToolExecutor = async (run, ctx) => {
  // Unreachable through the UI (Run is refused with this sentence when no LoD
  // qualifies), and a skip cause reading "no geometry at LoD null" would be
  // worse than a failure.
  if (run.lod === null) throw new Error("No solid geometry in this layer");
  const lod = run.lod;
  const columns: ReadonlyArray<OutputColumn> = validationColumns(run.prefix);

  const handle = await readSource({
    runId: run.id,
    table: ctx.table,
    lod,
    signal: ctx.signal,
  });
  try {
    ctx.phase("compute");
    const scope = await ctx.query(
      "Reading features",
      buildScopeRowsSql(ctx.table.table, ctx.featureIds),
    );
    if (!scope.ok) throw new Error(scope.message);
    ctx.throwIfCancelled();

    const rows: FeatureRow[] = scope.rows.map((row) => ({
      id: String(row["id"]),
      f: String(row["f"]),
    }));
    // TAGS ONLY, and about geometry of ANY kind — §7's contributor rule.
    const lods = geometryLodsByObject(ctx.layer);
    const groups = groupContributors(
      rows,
      (id, at) => lods.get(id)?.has(at) ?? false,
      lod,
    );
    const contributorIds = groups.flatMap((g) => [...g.contributors]);

    const byId = new Map<string, ReportRow>();
    if (contributorIds.length > 0) {
      const reported = await readerQuery(
        ctx,
        "Validating solids",
        buildSolidValidationSql({
          from: handle.from,
          geometryColumn: handle.geometryColumn,
          ids: contributorIds,
        }),
      );
      for (const row of reported.rows) {
        const report = toReportRow(row);
        byId.set(report.id, report);
      }
      // §6.1's id join, over EVERY contributor — the same threshold Measure
      // solids uses, because it is the same rule from the same module.
      assertSourceIds(contributorIds, new Set(byId.keys()));
    }
    await handle.release();
    ctx.throwIfCancelled();

    const out = new Map<string, Record<string, unknown>>();
    let valid = 0;
    let withIssues = 0;
    let noGeometry = 0;
    let notASolid = 0;
    let sinceYield = 0;

    for (const group of groups) {
      const parsed = group.contributors
        .map((id) => byId.get(id))
        .filter((row): row is ReportRow => row !== undefined && row.parsed);
      const rollUp = rollUpReports(parsed);
      if (rollUp === null) {
        if (group.contributors.length === 0) noGeometry += 1;
        else notASolid += 1;
      } else if (rollUp.valid === true) {
        valid += 1;
      } else {
        // §7.3's card counts every measured feature on one side or the other,
        // so a NULL verdict over parsed contributors reads as "with issues"
        // rather than disappearing from the line.
        withIssues += 1;
      }

      for (const member of group.members) {
        // §8: the root row carries the feature's roll-up, every part its own.
        if (member.id === group.featureId) {
          out.set(member.id, valuesOf(rollUp, run.prefix));
        } else {
          const own = byId.get(member.id);
          out.set(
            member.id,
            valuesOf(
              own !== undefined && own.parsed ? rollUpReports([own]) : null,
              run.prefix,
            ),
          );
        }
      }

      sinceYield += 1;
      if (sinceYield >= VALIDATE_BATCH_FEATURES) {
        sinceYield = 0;
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    return {
      columns,
      rows: out,
      // Every feature the run reached a verdict on. The CARD does not print
      // it (§7.3's line is the valid count), but the provenance summary and
      // §6.2's object count are taken from here.
      measured: valid + withIssues,
      skipped: countsAsSkips([
        [skipNoGeometry(lod), noGeometry],
        [SKIP_NOT_A_SOLID, notASolid],
      ]),
      // §7.3's card, verbatim: "1,079 valid · 125 with issues". TWO counts,
      // so the valid half is this tool's OWN first phrase (`line`) and only
      // the other half is a caveat — `summarise` prints `line`, then each
      // caveat as "<count> <cause>", then the skipped count and the elapsed
      // time. Both halves as caveats would print a third count in front of
      // them that §7.3 never shows.
      //
      // Grouped like `summarise`'s own `fmt`, which is `toLocaleString`.
      line: `${valid.toLocaleString("en-US")} valid`,
      caveats: countsAsSkips([["with issues", withIssues]]),
    };
  } finally {
    await handle.release();
  }
};

registerExecutor("validate-solids", validateSolids);
```

- [ ] **Step 4: Wire it, switch it on, and give it its LoD answer**

In `src/features/processing/tools/register.ts`, append:

```ts
import "./validateSolids";
```

and in `tests/unit/features/processing/register.test.ts`:

```ts
expect(Object.keys(EXECUTORS)).toEqual([
  "height-from-extent",
  "roof-metrics",
  "measure-solids",
  "validate-solids",
]);
```

In `src/features/processing/toolRegistry.ts`, in the `validate-solids` entry, replace:

```ts
    defaultPrefix: "solid_",
    implemented: false,
```

with:

```ts
    defaultPrefix: "solid_",
    // No `validateParams` and no `normaliseParams`: §7.3 has no parameters, so
    // there is nothing to refuse and nothing to fill in.
    outputColumns: (prefix) => validationColumns(prefix),
    implemented: true,
```

and add `validationColumns` to the `./solidParams` import.

In `src/ui/processing/useLodOptions.ts`, change the solids branch's condition. Find:

```ts
    if (tool.id === "measure-solids") {
```

and replace with:

```ts
    if (tool.id === "measure-solids" || tool.id === "validate-solids") {
```

(and extend that branch's comment: "Both solids tools ask the same question of the same tags, so they share one answer — §7.3's parameters are the LoD alone.")

- [ ] **Step 5: Give it a PARAMETERS section that is one note**

In `src/ui/processing/ToolView.tsx`, after the `measure-solids` block, insert the `{…}` block below — the `<>` and `</>` are only there to keep the snippet valid on its own (a bare `{…}` in a code fence is a BLOCK statement, and the formatter rewrites it into one with a stray `;` inside the JSX). They are not part of the edit:

```tsx
<>
  {toolId === "validate-solids" && (
    <fieldset className="processing-section" disabled={locked}>
      <legend className="processing-group__label">PARAMETERS</legend>
      {/* §7.3 has no parameters. The section is still here, with the one
          thing a user would otherwise look for: §6.2's Style by result
          opens a rule on this column, so its name is worth stating. */}
      <p className="processing-note">
        Validity is always written as &lt;prefix&gt;valid.
      </p>
    </fieldset>
  )}
</>
```

- [ ] **Step 6: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, and `vp check` still 0 errors / 56 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/tools/validateSolids.ts \
  src/features/processing/tools/register.ts src/features/processing/toolRegistry.ts \
  src/ui/processing/useLodOptions.ts src/ui/processing/ToolView.tsx \
  tests/unit/features/processing/validateSolids.test.ts \
  tests/unit/features/processing/register.test.ts \
  tests/unit/features/processing/runQueue.test.ts \
  tests/unit/ui/processing/solidsEnabled.test.tsx
git commit -m "feat: Validate solids reports closed, manifold, oriented and the counts behind them"
```
