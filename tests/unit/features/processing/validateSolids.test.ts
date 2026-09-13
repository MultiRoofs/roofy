/**
 * §7.3: seven columns per feature — four BOOLEAN flags ANDed over the
 * contributors and three diagnostic counts summed — the same two skip causes as
 * §7.2, and the card line "1,079 valid · 125 with issues".
 *
 * The tool never measures anything: it reports what `ST_3DValidationReport`
 * says, which is why it needs no `ST_3DVolume` guard and no parameters.
 *
 * THE ROWS HERE CARRY TASK 6'S OWN COLUMN NAMES (`is_closed`, `open_n`, …),
 * not §7.3's output names. `buildSolidValidationSql` is pinned character for
 * character against real DuckDB 1.5.5 by `tests/integration/duckdb/solids.test.ts`,
 * so the reader's spelling is a fact this suite obeys rather than one it picks.
 *
 * Three statements, in the order the executor issues them: the layer table's
 * scoped rows, then §6.1's id-only identity read over the WHOLE scope, then the
 * guarded report over the contributors alone.
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

/**
 * One row of `buildSolidValidationSql`'s output, with every column it selects.
 *
 * `ori_n` is read by the statement and spent by nothing: §7.3 names seven
 * columns and `orientation_error_count` is not one of them. It is here because
 * the row the reader hands the executor really does carry it.
 */
const reportRow = (
  id: string,
  f: string,
  over: Partial<{
    geometry_type: string | null;
    parsed: boolean;
    is_valid: boolean | null;
    is_closed: boolean | null;
    is_manifold: boolean | null;
    is_oriented: boolean | null;
    open_n: number | null;
    nm_n: number | null;
    deg_n: number | null;
    ori_n: number | null;
  }> = {},
) => ({
  id,
  f,
  geometry_type: "Solid",
  parsed: true,
  is_valid: true,
  is_closed: true,
  is_manifold: true,
  is_oriented: true,
  open_n: 0,
  nm_n: 0,
  deg_n: 0,
  ori_n: 0,
  ...over,
});

/** The reader's row for a MultiSurface at a solid LoD: parses to NULL (D4). */
const notASolidRow = (id: string, f: string) =>
  reportRow(id, f, {
    geometry_type: "MultiSurface",
    parsed: false,
    is_valid: null,
    is_closed: null,
    is_manifold: null,
    is_oriented: null,
    open_n: null,
    nm_n: null,
    deg_n: null,
    ori_n: null,
  });

/**
 * A layer whose model tags say who has geometry at which LoD.
 *
 * A part is a part because it NAMES ITS PARENT: `featureIdsByObject` reads
 * `parents`, never the id's spelling.
 */
function layerWith(
  lodsByObject: Record<string, string[]>,
  parents: Record<string, string> = {},
): Layer {
  const objects: Record<string, unknown> = {};
  for (const [id, lods] of Object.entries(lodsByObject)) {
    const parent = parents[id];
    objects[id] = {
      id,
      objectType: parent === undefined ? "Building" : "BuildingPart",
      attributes: {},
      surfaces: lods.map((lod) => ({
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod,
        geometryType: "Solid",
      })),
      bbox: null,
      children: Object.entries(parents)
        .filter(([, p]) => p === id)
        .map(([child]) => child),
      parents: parent === undefined ? [] : [parent],
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

function context(
  layer: Layer,
  answers: ReadonlyArray<QueryOutcome>,
  over: {
    featureIds?: ReadonlyArray<string> | null;
    throwIfCancelled?: () => void;
  } = {},
) {
  let next = 0;
  const labels: string[] = [];
  /** The SQL of each statement, in order — what the cases assert against. */
  const statements: string[] = [];
  const phases: string[] = [];
  const warnings: string[] = [];
  return {
    labels,
    statements,
    phases,
    warnings,
    ctx: {
      table: TABLE,
      layer,
      featureIds: over.featureIds ?? null,
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
      phase: (p: string) => phases.push(p),
      warn: (text: string) => warnings.push(text),
      throwIfCancelled: over.throwIfCancelled ?? (() => {}),
    },
  };
}

/** The scope-rows answer for a list of `[rowId, featureId]` pairs. */
const scopeRows = (
  pairs: ReadonlyArray<readonly [string, string]>,
): QueryOutcome => ({
  ok: true,
  columns: ["id", "f"],
  rows: pairs.map(([id, f]) => ({ id, f })),
});

/** The source-identity answer: the ids the reader says the file still holds. */
const sourceIds = (ids: ReadonlyArray<string>): QueryOutcome => ({
  ok: true,
  columns: ["id"],
  rows: ids.map((id) => ({ id })),
});

/** The validation statement's answer. */
const reported = (
  rows: ReadonlyArray<Record<string, unknown>>,
): QueryOutcome => ({ ok: true, columns: [], rows: [...rows] });

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
  release.mockImplementation(async () => {});
});

describe("validateSolids", () => {
  it("writes §7.3's seven columns, in §7.3's order", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, labels, phases } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1")]),
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
    // §6.1: the handle is open, so the card leaves "Reading source".
    expect(phases).toEqual(["compute"]);
    expect(labels).toEqual([
      "Reading features",
      "Checking source ids",
      "Validating solids",
    ]);
  });

  it("honours the user's prefix", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1")]),
    ]);
    const result = await validateSolids(run({ prefix: "chk_" }), ctx as never);
    expect(result.columns.map((c) => c.name)).toContain("chk_valid");
  });

  it("ANDs the flags and SUMS the counts over the contributors", async () => {
    // §7.3: "Feature roll-up per §7: flags AND, counts sum."
    const layer = layerWith(
      { B1: ["2.2"], B1P: ["2.2"], B1Q: ["2.2"] },
      { B1P: "B1", B1Q: "B1" },
    );
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
        ["B1Q", "B1"],
      ]),
      sourceIds(["B1", "B1P", "B1Q"]),
      reported([
        reportRow("B1P", "B1", {
          open_n: 2,
          is_closed: false,
          is_valid: false,
        }),
        reportRow("B1Q", "B1", { open_n: 3, deg_n: 1 }),
      ]),
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
    // The ROOT is a member of the feature but not a contributor (its parts
    // displaced it), so it carries the feature's roll-up and nothing of its own.
    expect(result.measured).toBe(1);
  });

  it("gives NULL, not 0, for a count NO contributor supplied", async () => {
    // The per-measure NULL rule, on a tool whose measures are counts: a zero is
    // an answer — "this building has no open edges" — and writing one where the
    // engine reported nothing publishes a fact nobody checked. A count that a
    // sibling DID supply still sums over the ones that answered.
    const layer = layerWith(
      { B1: ["2.2"], B1P: ["2.2"], B1Q: ["2.2"] },
      { B1P: "B1", B1Q: "B1" },
    );
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
        ["B1Q", "B1"],
      ]),
      sourceIds(["B1", "B1P", "B1Q"]),
      reported([
        reportRow("B1P", "B1", { open_n: 4, nm_n: null, deg_n: null }),
        reportRow("B1Q", "B1", { open_n: null, nm_n: null, deg_n: null }),
      ]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")).toMatchObject({
      solid_open_edges_n: 4,
      solid_nonmanifold_edges_n: null,
      solid_degenerate_faces_n: null,
    });
  });

  it("keeps a genuine zero a zero", async () => {
    // The flip side of the rule above: 0 open edges reported IS a measurement.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1")]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")).toMatchObject({
      solid_open_edges_n: 0,
      solid_nonmanifold_edges_n: 0,
      solid_degenerate_faces_n: 0,
    });
  });

  it("lets FALSE dominate an unknown flag, in either row order", async () => {
    // Three-valued AND, decided after the loop: the reader's row ORDER cannot
    // decide a feature's verdict.
    for (const order of [0, 1]) {
      const rows = [
        reportRow("B1P", "B1", { is_closed: false, is_valid: false }),
        reportRow("B1Q", "B1", { is_closed: null, is_valid: null }),
      ];
      const layer = layerWith(
        { B1: ["2.2"], B1P: ["2.2"], B1Q: ["2.2"] },
        { B1P: "B1", B1Q: "B1" },
      );
      const { ctx } = context(layer, [
        scopeRows([
          ["B1", "B1"],
          ["B1P", "B1"],
          ["B1Q", "B1"],
        ]),
        sourceIds(["B1", "B1P", "B1Q"]),
        reported(order === 0 ? rows : [...rows].reverse()),
      ]);
      const result = await validateSolids(run(), ctx as never);
      expect(result.rows.get("B1")).toMatchObject({
        solid_closed: false,
        solid_valid: false,
      });
    }
  });

  it("withholds a flag no contributor decided, without inventing a verdict", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([
        reportRow("B1", "B1", {
          is_oriented: null,
          ori_n: null,
          is_valid: null,
        }),
      ]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")).toMatchObject({
      solid_oriented: null,
      solid_valid: null,
      solid_closed: true,
    });
    // §7.3's card counts every feature the run reached a verdict on; a feature
    // whose validity is UNKNOWN was still looked at, so it is "with issues"
    // rather than missing from both halves of the line.
    expect(result.measured).toBe(1);
    expect(result.caveats).toEqual([{ cause: "with issues", count: 1 }]);
  });

  it("reports NO count on an unparsed solid — NULL in all seven", async () => {
    // §7.3: "no geometry or unparseable geometry gives NULL in every column".
    // A zero count would read as "checked, and nothing is wrong".
    const layer = layerWith({ B1: ["2.2"], B2: ["1.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B2"]),
      reported([notASolidRow("B1", "B1")]),
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
    expect(result.rows.get("B2")).toEqual(result.rows.get("B1"));
    expect(result.measured).toBe(0);
    expect(result.skipped).toEqual([
      { cause: "no geometry at LoD 2.2", count: 1 },
      { cause: "not a solid", count: 1 },
    ]);
    expect(result.line).toBe("0 valid");
  });

  it("skips a row that PARSED but is not a solid in the CityJSON model", async () => {
    // D4: the CityJSON type is the detector, never the WKB name. A
    // CompositeSurface parses to something `three_d` will report on, and §7.3
    // still owes it NULL: the file never called it a solid.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1", { geometry_type: "CompositeSurface" })]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")?.["solid_valid"]).toBeNull();
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
  });

  it("skips a solid-typed row the parser could not read", async () => {
    // The other half of the detector: the file says Solid and nothing solid
    // came out. §7.3 gives the two cases one cause between them.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([
        reportRow("B1", "B1", {
          parsed: false,
          is_valid: null,
          is_closed: null,
          is_manifold: null,
          is_oriented: null,
          open_n: null,
          nm_n: null,
          deg_n: null,
        }),
      ]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.rows.get("B1")?.["solid_closed"]).toBeNull();
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
  });

  it("counts a CompositeSolid as a solid", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1", { geometry_type: "CompositeSolid" })]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("carries §7.3's card line: the valid count IS the line", async () => {
    // §7.3: 'Card: "1,079 valid · 125 with issues"'. Two counts, not three —
    // so the VALID half is the tool's own `line` and only "with issues" is a
    // caveat. Both halves are FEATURES and they sum to `measured`, which is
    // what the provenance summary counts from even though the card omits it.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"], B3: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
        ["B3", "B3"],
      ]),
      sourceIds(["B1", "B2", "B3"]),
      reported([
        reportRow("B1", "B1"),
        reportRow("B2", "B2"),
        reportRow("B3", "B3", {
          is_valid: false,
          is_closed: false,
          open_n: 4,
        }),
      ]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.measured).toBe(3);
    expect(result.line).toBe("2 valid");
    expect(result.caveats).toEqual([{ cause: "with issues", count: 1 }]);
  });

  it("groups the valid count the way the card does", async () => {
    // `summarise`'s own `fmt` is `toLocaleString("en-US")`, and §7.3's card
    // reads "1,079 valid" — so the tool's own phrase is grouped too, or the
    // card would print one grouped number beside one ungrouped one.
    const ids = Array.from({ length: 1079 }, (_, i) => `B${i}`);
    const layer = layerWith(Object.fromEntries(ids.map((id) => [id, ["2.2"]])));
    const { ctx } = context(layer, [
      scopeRows(ids.map((id) => [id, id] as const)),
      sourceIds(ids),
      reported(ids.map((id) => reportRow(id, id))),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.line).toBe("1,079 valid");
  });

  it("omits an empty half of the card line", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1")]),
    ]);
    const result = await validateSolids(run(), ctx as never);
    expect(result.line).toBe("1 valid");
    expect(result.caveats).toEqual([]);
  });

  it("never issues ST_3DVolume, and releases the bytes", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, statements } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      reported([reportRow("B1", "B1")]),
    ]);
    await validateSolids(run(), ctx as never);
    // The REAL statement, not `String(undefined)` — which would satisfy
    // `.not.toContain("ST_3DVolume")` even if no statement had run at all.
    const sql = statements[2] ?? "";
    expect(sql).toContain("ST_3DValidationReport");
    // Task 6's own spelling, D1's guard included.
    expect(sql).toContain("CASE WHEN s IS NOT NULL THEN r.is_closed END");
    expect(sql).toContain("ST_3DTryFromWKB");
    expect(sql).not.toContain("ST_3DVolume");
    expect(sql).not.toContain("r.code");
    expect(sql).not.toContain("r.message");
    expect(release).toHaveBeenCalled();
  });

  it("parses the CONTRIBUTORS only, and checks the ids over the WHOLE scope", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] }, { B1P: "B1" });
    const { ctx, statements } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1", "B1P"]),
      reported([reportRow("B1P", "B1")]),
    ]);
    await validateSolids(run(), ctx as never);
    // Scope "all": the identity statement carries NO `WHERE` — the pin that
    // `ctx.featureIds` was not smuggled in as the requested id set.
    expect(statements[1]).toBe(
      `SELECT "id" FROM read_cityjson('layer_1_run_1.city.json', lod => '2.2')`,
    );
    // The report parses the part alone; the displaced root is never parsed.
    expect(statements[2]).toContain(`WHERE "id" IN ('B1P')`);
    expect(statements[2]).not.toContain("'B1'");
  });

  it("fails with §6.1's id sentence on a PARTIAL answer from the source", async () => {
    // The same threshold as §7.2's: every contributor, not "no match at all".
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1"]),
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("detects a missing ROOT under scope 'all', which contributes nothing", async () => {
    // The root is displaced by its part, so nothing parses it — and its
    // disappearance from the file is exactly as much evidence that the source
    // moved as a missing contributor's would be.
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] }, { B1P: "B1" });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1P"]),
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("detects a missing ROOT under a frozen id list too", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] }, { B1P: "B1" });
    const { ctx } = context(
      layer,
      [
        scopeRows([
          ["B1", "B1"],
          ["B1P", "B1"],
        ]),
        sourceIds(["B1P"]),
      ],
      { featureIds: ["B1", "B1P"] },
    );
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("detects a missing NON-CONTRIBUTING part under scope 'all'", async () => {
    // B1Q has no geometry at 2.2, so §7's rule never chose it. It is still a
    // row of the scope and still has to be in the file.
    const layer = layerWith(
      { B1: ["2.2"], B1P: ["2.2"], B1Q: ["1.2"] },
      { B1P: "B1", B1Q: "B1" },
    );
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
        ["B1Q", "B1"],
      ]),
      sourceIds(["B1", "B1P"]),
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("detects a missing NON-CONTRIBUTING part under a frozen id list too", async () => {
    const layer = layerWith(
      { B1: ["2.2"], B1P: ["2.2"], B1Q: ["1.2"] },
      { B1P: "B1", B1Q: "B1" },
    );
    const { ctx } = context(
      layer,
      [
        scopeRows([
          ["B1", "B1"],
          ["B1P", "B1"],
          ["B1Q", "B1"],
        ]),
        sourceIds(["B1", "B1P"]),
      ],
      { featureIds: ["B1", "B1P", "B1Q"] },
    );
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("fails when the REPORT drops a contributor the id check saw", async () => {
    // The second threshold: a contributor missing from THIS answer would be
    // rolled up as "not a solid", a verdict on geometry nobody looked at.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B2"]),
      reported([reportRow("B1", "B1")]),
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("gives a reader failure §6.1's own sentence, engine words to the log", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      { ok: false, message: "IO Error: Could not read from file" },
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_READ_FAILED,
    );
    expect(warnings).toEqual(["IO Error: Could not read from file"]);
    expect(release).toHaveBeenCalled();
  });

  it("rethrows a statement the APP built wrong as itself", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      {
        ok: false,
        message: 'Binder Error: Referenced column "nope" not found',
      },
    ]);
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      "Binder Error",
    );
    expect(warnings).toEqual([]);
  });

  it("releases the bytes when the run is cancelled mid-way", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    let calls = 0;
    const { ctx } = context(
      layer,
      [scopeRows([["B1", "B1"]]), sourceIds(["B1"])],
      {
        throwIfCancelled: () => {
          calls += 1;
          if (calls > 1) throw new Error("cancelled");
        },
      },
    );
    await expect(validateSolids(run(), ctx as never)).rejects.toThrow(
      "cancelled",
    );
    expect(release).toHaveBeenCalled();
  });

  it("issues no reader statement at all for an EMPTY scope", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, labels } = context(layer, [scopeRows([])], {
      featureIds: [],
    });
    const result = await validateSolids(run(), ctx as never);
    expect(labels).toEqual(["Reading features"]);
    expect(result.measured).toBe(0);
    expect(result.line).toBe("0 valid");
  });

  it("refuses a run with no LoD", async () => {
    const { ctx } = context(layerWith({ B1: ["2.2"] }), []);
    await expect(
      validateSolids(run({ lod: null }), ctx as never),
    ).rejects.toThrow("No solid geometry in this layer");
  });
});
