### Task 7: The Measure solids executor

**Files:**

- Create: `src/features/processing/tools/measureSolids.ts`, `src/features/processing/solidRollUp.ts`
- Modify: `src/features/processing/tools/register.ts`, `src/features/processing/runQueue.ts` (`ToolResult.caveats` and `summarise`), `tests/unit/features/processing/register.test.ts`
- Test: `tests/unit/features/processing/measureSolids.test.ts`, plus one case appended to `tests/unit/features/processing/runQueue.test.ts`

**Interfaces:**

- Consumes: `ToolExecutor`, `ToolContext` (`table`, `layer`, `featureIds`, `query`, `phase`, `warn`, `throwIfCancelled`), `readSource` + `assertSourceIds` + `classifySourceFailure` (Task 5), `buildSolidMeasureSql` + `buildScopeRowsSql` (Task 6), `solidColumns`, `solidParams` (Task 6), `geometryLodsByObject` (Task 3).
- Produces: `measureSolids: ToolExecutor` and `registerExecutor("measure-solids", measureSolids)`; `solidRollUp.ts`'s `FeatureRow`, `SolidRow`, `FeatureGroup`, `groupContributors`, `rollUpSolids`, `SKIP_NOT_A_SOLID`, `skipNoGeometry(lod)`, `CAVEAT_INVALID_SOLIDS`; and on `runQueue`'s `ToolResult`:

```ts
  /**
   * Spec §6.2: the card's OWN first phrase, when "N buildings measured" is not
   * what this tool measured — "1,143 buildings joined" (§7.5), "6 areas
   * aggregated over 1,204 buildings" (§7.6), "1,079 valid" (§7.3). Absent for
   * a tool whose line is the default, which Measure solids' is; Task 10 is the
   * first tool to set it. Declared HERE so there is one channel and one
   * `summarise` edit.
   */
  readonly line?: string;
  /**
   * §6.2's CAVEATS: objects that WERE evaluated but with something withheld —
   * distinct from `skipped`, which is "could not be evaluated, NULL
   * everywhere". Rendered into the card's FIRST line between the measured
   * count and the skipped count: "1,115 buildings measured · 37 invalid solids
   * (no volume) · 12 skipped · 2.4 s". Each entry renders as
   * `"<count> <cause>"`, so a cause carries no number of its own.
   */
  readonly caveats?: ReadonlyArray<SkipCount>;
```

**This is the ONE caveat channel for the whole milestone** (commander's ruling, Decisions recorded item 6 (i)). Tasks 10, 16, 17 and 19 set `line` and `caveats` with exactly these names and types; no later task re-declares either field or re-edits `summarise`'s list-building blocks.

**Two modules, because two tools share one rule.** `groupContributors` and `rollUpSolids` live in `solidRollUp.ts` rather than in this tool module: Task 10's Validate solids needs the identical contributor selection and the identical two skip causes, and it cannot import them from here without firing this module's `registerExecutor("measure-solids", …)` side effect — which would break `tools/register.ts`'s single-wire contract and `register.test.ts`'s ordering assertion.

**How the three §7.2/§6.1 verdicts are each detected, with no guessing.**

| Verdict                  | Detector                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `no geometry` (skipped)  | the MODEL's tags: the feature has no contributor at the LoD (`geometryLodsByObject`), decided before any SQL |
| `not a solid` (skipped)  | the reader's `parsed` column (`s IS NULL`), per contributor                                                  |
| `invalid solid` (caveat) | `parsed && is_valid === false` — never `is_valid` alone, which is NULL for an unparsed row                   |
| ids differ (failure)     | `assertSourceIds` (Task 5): the reader did not answer for EVERY contributor id the run asked about           |
| a reader-statement error | `readerQuery` (Task 5): §6.1's read or memory sentence, with the engine's own words into `ctx.warn`          |

**The id-join threshold is EVERY id, not "no match at all".** A contributor is chosen because the loaded MODEL says it has geometry at this LoD, and `read_cityjson` returns a row per object of the file — so an id that does not come back means the file no longer holds that object, which is exactly §6.1's "no longer reads as the loaded layer". Accepting a partial answer would write those features as `not a solid`: a verdict on geometry nobody looked at, published as a result. What §6.1 excludes stays excluded — a URL whose CONTENT changed under the same ids answers for every id and is not detected — and that is the spec's own stated limit. The rule itself is `assertSourceIds`'s, so both solids tools obey one threshold.

**A failure of the READER STATEMENT is a source failure too.** The fetch is the obvious place for one, but the parse and the wasm allocation happen inside `ctx.query`'s statement: a source that gunzips to garbage or exhausts the heap fails there, and §6.1 promises a sentence for it. `readerQuery` (Task 5) is the one door for such a statement, over the one classifier both stages share. It returns `null`-classified errors — a Binder/Catalog/Parser error, this app's own SQL being wrong — untouched, rather than telling the user to check their connection over a bug in the app, and the engine's own words go into `ctx.warn`, exactly as the extension phase already keeps DuckDB's reason in the log while the card shows the offline sentence (`runQueue.ts:596-601`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/measureSolids.test.ts`:

```ts
/**
 * §7.2's four outcomes per object, §7's roll-ups from contributors to the
 * feature, and the skip/caveat arithmetic the card prints.
 *
 * The ENGINE fact underneath the roll-up — `ST_3DVolume` over a CompositeSolid
 * returns its members' SUM — is Task 1's, pinned on
 * `fixtures/composite-solid.city.json`. These cases are app-side and use
 * literal rows; they do not re-probe it.
 *
 * The roll-ups are tested PURE (`rollUpSolids` over literal reader rows), and
 * the executor is tested over a stubbed `ToolContext` — the queue, the engine
 * and the source read are all seams, so what is asserted here is the tool's
 * behaviour and never a mock's.
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
const { groupContributors, rollUpSolids } =
  await import("../../../../src/features/processing/solidRollUp");
const { measureSolids } =
  await import("../../../../src/features/processing/tools/measureSolids");

/** One reader row, with every field the measure statement selects. */
const solidRow = (
  id: string,
  f: string,
  over: Partial<{
    parsed: boolean;
    is_valid: boolean | null;
    volume_m3: number | null;
    envelope_m2: number | null;
    footprint_m2: number | null;
    ground_m: number | null;
    ridge_m: number | null;
  }> = {},
) => ({
  id,
  f,
  parsed: true,
  is_valid: true,
  volume_m3: 100,
  envelope_m2: 20,
  footprint_m2: 10,
  ground_m: 0,
  ridge_m: 8,
  ...over,
});

describe("rollUpSolids", () => {
  it("sums volume, envelope and footprint over the contributors", () => {
    expect(
      rollUpSolids([
        solidRow("p1", "B", {
          volume_m3: 100,
          envelope_m2: 20,
          footprint_m2: 10,
        }),
        solidRow("p2", "B", { volume_m3: 50, envelope_m2: 6, footprint_m2: 4 }),
      ]),
    ).toMatchObject({ volume: 150, envelope: 26, footprint: 14 });
  });

  it("makes the feature's volume NULL when ANY contributor's is NULL", () => {
    // §7: "volume: sum over contributors, but NULL for the feature when any
    // contributor's volume is NULL (a partial volume would mislead)".
    expect(
      rollUpSolids([
        solidRow("p1", "B"),
        solidRow("p2", "B", { is_valid: false, volume_m3: null }),
      ])?.volume,
    ).toBeNull();
  });

  it("takes height as the COMBINED extent, never a sum of part heights", () => {
    // §7: "height: combined extent, max ridge over parts minus min ground over
    // parts (never the sum or max of part heights)". Two 8 m parts sitting at
    // different elevations are one 12 m building, not a 16 m one.
    expect(
      rollUpSolids([
        solidRow("p1", "B", { ground_m: 0, ridge_m: 8 }),
        solidRow("p2", "B", { ground_m: 4, ridge_m: 12 }),
      ]),
    ).toMatchObject({ ground: 0, ridge: 12, height: 12 });
  });

  it("ANDs the validity flags", () => {
    expect(
      rollUpSolids([
        solidRow("p1", "B"),
        solidRow("p2", "B", { is_valid: false }),
      ])?.valid,
    ).toBe(false);
    expect(rollUpSolids([solidRow("p1", "B")])?.valid).toBe(true);
  });

  it("is null for no contributors at all", () => {
    expect(rollUpSolids([])).toBeNull();
  });
});

describe("groupContributors", () => {
  const rows = [
    { id: "B1", f: "B1" },
    { id: "B1P", f: "B1" },
    { id: "B2", f: "B2" },
  ];

  it("prefers the PARTS when any part has geometry at the LoD", () => {
    // §7, verbatim: "if any part of the feature has geometry, the PARTS are the
    // contributors and the root's own geometry at that LoD is ignored (3D BAG
    // stores the same building on both)".
    const groups = groupContributors(rows, (id) => id !== "B2", "2.2");
    expect(groups.find((g) => g.featureId === "B1")?.contributors).toEqual([
      "B1P",
    ]);
  });

  it("falls back to the ROOT when no part has geometry there", () => {
    const groups = groupContributors(rows, (id) => id === "B1", "2.2");
    expect(groups.find((g) => g.featureId === "B1")?.contributors).toEqual([
      "B1",
    ]);
  });

  it("leaves a feature with no geometry anywhere with no contributors", () => {
    const groups = groupContributors(rows, () => false, "2.2");
    expect(groups.every((g) => g.contributors.length === 0)).toBe(true);
    // The members are still carried: §7 writes both the root row and the part
    // rows, NULL included.
    expect(groups.find((g) => g.featureId === "B1")?.members).toHaveLength(2);
  });
});

/** A layer whose model tags say who has geometry at 2.2. */
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
  rowCount: 3,
} as unknown as LayerTable;

/** A `ToolContext` whose `query` answers the two statements in order. */
function context(
  layer: Layer,
  answers: ReadonlyArray<QueryOutcome>,
  over: { featureIds?: ReadonlyArray<string> | null } = {},
) {
  const labels: string[] = [];
  /** The SQL of each statement, in order — what the cases assert against. */
  const statements: string[] = [];
  const phases: string[] = [];
  const warnings: string[] = [];
  let next = 0;
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
      // BOTH parameters, and the SQL is KEPT. A one-parameter `vi.fn` infers
      // the tuple `[label: string]`, so `ctx.query.mock.calls[1]?.[1]` is a
      // type error and the statement would be unassertable — the cases below
      // read `statements[1]` instead, which needs no indexing past a tuple's
      // length and leaves no unused parameter for the lint to refuse.
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
      throwIfCancelled: () => {},
    },
  };
}

const run = (over: Record<string, unknown> = {}) =>
  ({
    id: "run_1",
    toolId: "measure-solids",
    lod: "2.2",
    prefix: "solid_",
    params: {},
    ...over,
  }) as never;

afterEach(() => {
  vi.clearAllMocks();
  release.mockImplementation(async () => {});
});

describe("measureSolids", () => {
  it("reads the source, measures the contributors, and releases the bytes", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"], B2: ["2.2"] });
    const { ctx, labels, phases } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B1P", f: "B1" },
          { id: "B2", f: "B2" },
        ],
      },
      {
        ok: true,
        columns: [],
        rows: [
          solidRow("B1P", "B1", {
            volume_m3: 200,
            footprint_m2: 40,
            ridge_m: 10,
          }),
          solidRow("B2", "B2"),
        ],
      },
    ]);
    const result = await measureSolids(run(), ctx as never);

    expect(phases).toEqual(["compute"]); // the queue already set "source"
    expect(labels).toEqual(["Reading features", "Measuring solids"]);
    expect(release).toHaveBeenCalled();
    expect(result.columns).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_envelope_m2", type: "DOUBLE" },
      { name: "solid_footprint_m2", type: "DOUBLE" },
      { name: "solid_height_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
    // TWO features measured, over THREE rows. A part is never a building.
    expect(result.measured).toBe(2);
    // §8: the ROOT row carries the feature's roll-up (here, its part's), and
    // every other row carries its OWN.
    expect(result.rows.get("B1")).toMatchObject({
      solid_volume_m3: 200,
      solid_footprint_m2: 40,
      solid_height_m: 10,
      solid_valid: true,
    });
    expect(result.rows.get("B1P")).toMatchObject({ solid_volume_m3: 200 });
    expect(result.rows.get("B2")).toMatchObject({ solid_volume_m3: 100 });
    expect(result.skipped).toEqual([]);
  });

  it("writes NULL everywhere and skips 'no geometry' with no contributor", async () => {
    // §7.2's first outcome, decided from the MODEL's tags before any SQL: a
    // feature whose only geometry is at another LoD is never asked about.
    const layer = layerWith({ B1: ["1.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B2", f: "B2" },
        ],
      },
      { ok: true, columns: [], rows: [solidRow("B2", "B2")] },
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([
      { cause: "no geometry at LoD 2.2", count: 1 },
    ]);
    expect(result.rows.get("B1")).toEqual({
      solid_volume_m3: null,
      solid_envelope_m2: null,
      solid_footprint_m2: null,
      solid_height_m: null,
      solid_valid: null,
    });
  });

  it("skips 'not a solid' when the parser returned NULL, with valid NULL too", async () => {
    // §7.2's second outcome. `is_valid` is NULL for an unparsed row
    // (`ST_3DValidationReport(NULL)` is NULL), so `valid` must be NULL and
    // never false — false would claim the solid was checked and rejected.
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
      {
        ok: true,
        columns: [],
        rows: [
          solidRow("B1", "B1", {
            parsed: false,
            is_valid: null,
            volume_m3: null,
            envelope_m2: null,
            footprint_m2: null,
            ground_m: null,
            ridge_m: null,
          }),
          solidRow("B2", "B2"),
        ],
      },
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
    expect(result.rows.get("B1")?.["solid_valid"]).toBeNull();
  });

  it("keeps every other measure on an INVALID solid and reports the caveat", async () => {
    // §7.2's third outcome: "volume NULL, `valid` false; envelope area,
    // footprint area, height, ground and ridge still computed". An invalid
    // solid is NOT a skip — the building WAS measured.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      {
        ok: true,
        columns: [],
        rows: [solidRow("B1", "B1", { is_valid: false, volume_m3: null })],
      },
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.caveats).toEqual([
      { cause: "invalid solids (no volume)", count: 1 },
    ]);
    expect(result.rows.get("B1")).toMatchObject({
      solid_volume_m3: null,
      solid_envelope_m2: 20,
      solid_footprint_m2: 10,
      solid_height_m: 8,
      solid_valid: false,
    });
  });

  it("adds the skip causes up to the skipped count, with both causes present", async () => {
    // §6.2: "skipped objects are explained in a second muted line by cause, and
    // the causes add up to the skipped count".
    const layer = layerWith({ B1: ["2.2"], B2: ["1.2"], B3: ["2.2"] });
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
          solidRow("B1", "B1"),
          solidRow("B3", "B3", { parsed: false, is_valid: null }),
        ],
      },
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([
      { cause: "no geometry at LoD 2.2", count: 1 },
      { cause: "not a solid", count: 1 },
    ]);
  });

  it("writes only the ticked measures, plus the always-written flag", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [solidRow("B1", "B1")] },
    ]);
    const result = await measureSolids(
      run({ params: { measures: ["ground", "ridge"] } }),
      ctx as never,
    );
    expect(result.columns.map((c) => c.name)).toEqual([
      "solid_ground_m",
      "solid_ridge_m",
      "solid_valid",
    ]);
    expect(result.rows.get("B1")).toEqual({
      solid_ground_m: 0,
      solid_ridge_m: 8,
      solid_valid: true,
    });
  });

  it("scopes the reader statement to the CONTRIBUTOR rows only", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] });
    const { ctx, statements } = context(layer, [
      {
        ok: true,
        columns: ["id", "f"],
        rows: [
          { id: "B1", f: "B1" },
          { id: "B1P", f: "B1" },
        ],
      },
      { ok: true, columns: [], rows: [solidRow("B1P", "B1")] },
    ]);
    await measureSolids(run(), ctx as never);
    const measureSql = statements[1] ?? "";
    // The ROOT is displaced by its part (§7), so its solid is never parsed.
    expect(measureSql).toContain(`WHERE "id" IN ('B1P')`);
    expect(measureSql).not.toContain("'B1'");
  });

  it("fails with §6.1's id sentence when the source matches NOTHING", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: true, columns: [], rows: [] },
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    // The bytes are still released: the `finally` runs on every exit path.
    expect(release).toHaveBeenCalled();
  });

  it("fails on a PARTIAL answer too, rather than publishing half a run", async () => {
    // §6.1's id join over EVERY contributor. B1 came back and B2 did not: the
    // file no longer holds B2. Counting B2 as "not a solid" would publish a
    // verdict on geometry nobody looked at, alongside a real measurement.
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
      { ok: true, columns: [], rows: [solidRow("B1", "B1")] },
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("gives a reader failure §6.1's own sentence, engine words to the log", async () => {
    // The parse and the wasm allocation happen INSIDE this statement, so a
    // source that gunzips to garbage fails here — §6.1 promises a sentence for
    // it, and §6.4 keeps DuckDB's own reason in the log.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: false, message: "Invalid Input Error: Malformed JSON in file" },
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_READ_FAILED,
    );
    expect(warnings).toEqual(["Invalid Input Error: Malformed JSON in file"]);
    expect(release).toHaveBeenCalled();
  });

  it("lets an error that is OUR SQL's fault travel as itself", async () => {
    // A Binder Error is this app's statement being wrong. "Could not re-read
    // the source (network or decompression error)" would send the user to
    // check their connection over a bug in the app.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      { ok: true, columns: ["id", "f"], rows: [{ id: "B1", f: "B1" }] },
      { ok: false, message: "Binder Error: no such column" },
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      /Binder Error/,
    );
    expect(warnings).toEqual([]);
    expect(release).toHaveBeenCalled();
  });

  it("refuses a run with no LoD rather than skipping 'at LoD null'", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, []);
    await expect(
      measureSolids(run({ lod: null }), ctx as never),
    ).rejects.toThrow("No solid geometry in this layer");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/measureSolids.test.ts
```

Expected: FAIL — neither `solidRollUp` nor `tools/measureSolids` exists.

- [ ] **Step 3: Write the shared roll-up**

Create `src/features/processing/solidRollUp.ts`:

```ts
/**
 * Spec §7's contributor rule and solid roll-ups — shared by Measure solids
 * (§7.2) and Validate solids (§7.3), which select contributors identically and
 * skip for identically two reasons.
 *
 * It is a module of its own rather than an export of `tools/measureSolids.ts`
 * because importing a TOOL module runs its `registerExecutor` side effect, and
 * `tools/register.ts` is the single wire that decides which executors exist.
 *
 * Pure: no engine, no store, no React.
 */
import type { SkipCount } from "./types";

/** One LAYER-TABLE row: its own id, and the feature it belongs to. */
export interface FeatureRow {
  readonly id: string;
  readonly f: string;
}

/** One row of `buildSolidMeasureSql`'s output. */
export interface SolidRow {
  readonly id: string;
  readonly parsed: boolean;
  readonly is_valid: boolean | null;
  readonly volume_m3: number | null;
  readonly envelope_m2: number | null;
  readonly footprint_m2: number | null;
  readonly ground_m: number | null;
  readonly ridge_m: number | null;
}

export interface FeatureGroup {
  readonly featureId: string;
  /** Every row of the feature in scope — §7 writes them all, NULL included. */
  readonly members: ReadonlyArray<FeatureRow>;
  /** The row ids §7's contributor rule chose; `[]` means "no geometry". */
  readonly contributors: ReadonlyArray<string>;
}

/** §7.2's two skip causes — the only two either solids tool reports. */
export const SKIP_NOT_A_SOLID = "not a solid";
export const skipNoGeometry = (lod: string): string =>
  `no geometry at LoD ${lod}`;
/** §6.2's caveat for a building measured with its volume withheld. */
export const CAVEAT_INVALID_SOLIDS = "invalid solids (no volume)";

/**
 * §7's contributor rule, verbatim: "At the chosen LoD, if any part of the
 * feature has GEOMETRY, the PARTS are the contributors and the root's own
 * geometry at that LoD is ignored (3D BAG stores the same building on both);
 * otherwise the root is the sole contributor."
 *
 * GEOMETRY of any kind — `hasGeometryAt` must NOT be a "has a solid" test. A
 * wall-only part that falls back to the root's solid is exactly the double
 * count this rule exists to prevent.
 */
export function groupContributors(
  rows: ReadonlyArray<FeatureRow>,
  hasGeometryAt: (objectId: string, lod: string) => boolean,
  lod: string,
): ReadonlyArray<FeatureGroup> {
  const members = new Map<string, FeatureRow[]>();
  for (const row of rows) {
    const list = members.get(row.f);
    if (list) list.push(row);
    else members.set(row.f, [row]);
  }
  const groups: FeatureGroup[] = [];
  for (const [featureId, memberRows] of members) {
    const parts = memberRows.filter((row) => row.id !== featureId);
    const partContributors = parts
      .filter((row) => hasGeometryAt(row.id, lod))
      .map((row) => row.id);
    const contributors =
      partContributors.length > 0
        ? partContributors
        : memberRows
            .filter((row) => row.id === featureId && hasGeometryAt(row.id, lod))
            .map((row) => row.id);
    groups.push({ featureId, members: memberRows, contributors });
  }
  return groups;
}

export interface SolidRollUp {
  readonly volume: number | null;
  readonly envelope: number | null;
  readonly footprint: number | null;
  readonly height: number | null;
  readonly ground: number | null;
  readonly ridge: number | null;
  readonly valid: boolean | null;
  /** At least one contributor parsed but did not validate (§7.2's caveat). */
  readonly hasInvalid: boolean;
}

/**
 * §7's roll-ups from contributors to the feature, over the PARSED rows only.
 *
 * "A contributor that cannot be parsed is left out; an INVALID solid still
 * contributes the measures that do not need validity." So an unparsed row does
 * not poison its siblings — it simply is not there — and a feature with no
 * remaining contributor gets `null`, which the caller reports as a skip.
 *
 * The one asymmetry is VOLUME: "sum over contributors, but NULL for the feature
 * when any contributor's volume is NULL (a partial volume would mislead)".
 */
export function rollUpSolids(
  parsed: ReadonlyArray<SolidRow>,
): SolidRollUp | null {
  if (parsed.length === 0) return null;
  let volume: number | null = 0;
  let envelope = 0;
  let footprint = 0;
  let ground = Number.POSITIVE_INFINITY;
  let ridge = Number.NEGATIVE_INFINITY;
  let valid: boolean | null = true;
  let hasInvalid = false;
  for (const row of parsed) {
    if (row.volume_m3 === null) volume = null;
    else if (volume !== null) volume += row.volume_m3;
    envelope += row.envelope_m2 ?? 0;
    footprint += row.footprint_m2 ?? 0;
    if (row.ground_m !== null) ground = Math.min(ground, row.ground_m);
    if (row.ridge_m !== null) ridge = Math.max(ridge, row.ridge_m);
    if (row.is_valid === false) {
      valid = false;
      hasInvalid = true;
    } else if (row.is_valid === null) {
      valid = null;
    }
  }
  const groundOut = Number.isFinite(ground) ? ground : null;
  const ridgeOut = Number.isFinite(ridge) ? ridge : null;
  return {
    volume,
    envelope,
    footprint,
    // §7: "height: combined extent, max ridge over parts minus min ground over
    // parts (never the sum or max of part heights)".
    height:
      groundOut === null || ridgeOut === null ? null : ridgeOut - groundOut,
    ground: groundOut,
    ridge: ridgeOut,
    valid,
    hasInvalid,
  };
}

/** `[]` when the count is zero, so an empty list means "nothing to report". */
export function countsAsSkips(
  entries: ReadonlyArray<readonly [string, number]>,
): ReadonlyArray<SkipCount> {
  return entries
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => ({ cause, count }));
}
```

- [ ] **Step 4: Write the executor**

Create `src/features/processing/tools/measureSolids.ts`:

```ts
/**
 * Measure solids (spec §7.2).
 *
 * TWO statements, in this order:
 *
 *   1. against the LAYER TABLE — which rows are in scope, and which FEATURE
 *      does each belong to? The table is the authority on that: it is what the
 *      write targets and what `feature_id` means.
 *   2. against the RE-READ SOURCE, restricted to the contributor ids §7's rule
 *      chose — the guarded `three_d` measure statement.
 *
 * The contributor rule is answered from the MODEL's surface TAGS, never from
 * the reader, which is what lets §7.2's "no geometry" outcome be decided before
 * a single solid is parsed and keeps the parse to the rows that can produce a
 * value.
 *
 * BOUNDED WORK. Features are rolled up in batches of `SOLID_BATCH_FEATURES`,
 * and between batches the executor yields a MACROTASK and re-checks the
 * cancellation. That buys responsiveness and an early exit, nothing more: the
 * queue already refuses to publish an aborted run.
 */
import type { OutputColumn } from "../../../insights/computedColumns";
import { geometryLodsByObject } from "../roofGeometrySource";
import { assertSourceIds, readSource, readerQuery } from "../sourceRead";
import { solidColumns, solidParams, type SolidParams } from "../solidParams";
import { buildScopeRowsSql, buildSolidMeasureSql } from "../solidSql";
import {
  CAVEAT_INVALID_SOLIDS,
  SKIP_NOT_A_SOLID,
  countsAsSkips,
  groupContributors,
  rollUpSolids,
  skipNoGeometry,
  type FeatureRow,
  type SolidRollUp,
  type SolidRow,
} from "../solidRollUp";
import type { ToolExecutor } from "../runQueue";
import { registerExecutor } from "./index";

/** Features per batch. A bound, not a tuning knob (see the module comment). */
export const SOLID_BATCH_FEATURES = 500;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

/** One reader row, narrowed out of DuckDB's untyped record. */
function toSolidRow(row: Readonly<Record<string, unknown>>): SolidRow {
  return {
    id: String(row["id"]),
    parsed: row["parsed"] === true,
    is_valid: bool(row["is_valid"]),
    volume_m3: num(row["volume_m3"]),
    envelope_m2: num(row["envelope_m2"]),
    footprint_m2: num(row["footprint_m2"]),
    ground_m: num(row["ground_m"]),
    ridge_m: num(row["ridge_m"]),
  };
}

/** One roll-up as the run's column values, ticked measures only. */
function valuesOf(
  rollUp: SolidRollUp | null,
  params: SolidParams,
  prefix: string,
): Record<string, unknown> {
  const ticked = new Set(params.measures);
  const out: Record<string, unknown> = {};
  if (ticked.has("volume")) out[`${prefix}volume_m3`] = rollUp?.volume ?? null;
  if (ticked.has("envelope"))
    out[`${prefix}envelope_m2`] = rollUp?.envelope ?? null;
  if (ticked.has("footprint"))
    out[`${prefix}footprint_m2`] = rollUp?.footprint ?? null;
  if (ticked.has("height")) out[`${prefix}height_m`] = rollUp?.height ?? null;
  if (ticked.has("ground")) out[`${prefix}ground_m`] = rollUp?.ground ?? null;
  if (ticked.has("ridge")) out[`${prefix}ridge_m`] = rollUp?.ridge ?? null;
  // §7.2: always written.
  out[`${prefix}valid`] = rollUp?.valid ?? null;
  return out;
}

export const measureSolids: ToolExecutor = async (run, ctx) => {
  // The form guarantees a LoD (Run is refused with "No solid geometry in this
  // layer" when none qualifies), so this is unreachable through the UI. It is
  // here because a skip cause reading "no geometry at LoD null" would be worse
  // than a failure.
  if (run.lod === null) throw new Error("No solid geometry in this layer");
  const lod = run.lod;
  const params = solidParams(run.params);
  const columns: ReadonlyArray<OutputColumn> = solidColumns(run.prefix, params);

  // §6.1's "Reading source": the queue already put the card in this phase, so
  // the progress block does not flash "Computing" before a 300 MB read.
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
    // A type guard, not logic: the context throws on a failed query.
    if (!scope.ok) throw new Error(scope.message);
    ctx.throwIfCancelled();

    const rows: FeatureRow[] = scope.rows.map((row) => ({
      id: String(row["id"]),
      f: String(row["f"]),
    }));
    // TAGS ONLY, one walk of the model: §7's contributor question is about
    // geometry of ANY kind at the LoD, which is what `geometryLodsByObject`
    // answers. Using a "has a solid" test here instead would make a wall-only
    // part fall back to the root's solid — the 3D BAG double count.
    const lods = geometryLodsByObject(ctx.layer);
    const groups = groupContributors(
      rows,
      (id, at) => lods.get(id)?.has(at) ?? false,
      lod,
    );
    const contributorIds = groups.flatMap((g) => [...g.contributors]);

    const byId = new Map<string, SolidRow>();
    if (contributorIds.length > 0) {
      const measured = await readerQuery(
        ctx,
        "Measuring solids",
        buildSolidMeasureSql({
          from: handle.from,
          geometryColumn: handle.geometryColumn,
          ids: contributorIds,
        }),
      );
      for (const row of measured.rows) {
        const solid = toSolidRow(row);
        byId.set(solid.id, solid);
      }
      // §6.1's id join, "the only check possible", over EVERY contributor: the
      // reader returns a row per object of the file, so an id that did not come
      // back means the file no longer holds that object. Accepting a partial
      // answer would write those features as "not a solid".
      assertSourceIds(contributorIds, new Set(byId.keys()));
    }
    // The parse is done; a multi-megabyte buffer must not outlive it.
    await handle.release();
    ctx.throwIfCancelled();

    const out = new Map<string, Record<string, unknown>>();
    let measuredFeatures = 0;
    let noGeometry = 0;
    let notASolid = 0;
    let invalid = 0;
    let sinceYield = 0;

    for (const group of groups) {
      const parsed = group.contributors
        .map((id) => byId.get(id))
        .filter((row): row is SolidRow => row !== undefined && row.parsed);
      const rollUp = rollUpSolids(parsed);
      if (rollUp === null) {
        // §7.2's first two outcomes, told apart by whether §7's rule found a
        // contributor at all — never by the validation report, which is NULL
        // for both a missing solid and a missing row.
        if (group.contributors.length === 0) noGeometry += 1;
        else notASolid += 1;
      } else {
        measuredFeatures += 1;
        // §6.2's caveat, and only when a volume was actually withheld.
        if (rollUp.hasInvalid && params.measures.includes("volume")) {
          invalid += 1;
        }
      }

      for (const member of group.members) {
        // §8: the ROOT row carries the feature's roll-up; every other row
        // carries its OWN. A part stamped with its building's total is a
        // measurement of something the user never selected.
        if (member.id === group.featureId) {
          out.set(member.id, valuesOf(rollUp, params, run.prefix));
        } else {
          const own = byId.get(member.id);
          out.set(
            member.id,
            valuesOf(
              own !== undefined && own.parsed ? rollUpSolids([own]) : null,
              params,
              run.prefix,
            ),
          );
        }
      }

      sinceYield += 1;
      if (sinceYield >= SOLID_BATCH_FEATURES) {
        sinceYield = 0;
        // YIELD FIRST, then check. A MACROTASK, so the event loop actually
        // turns and a Cancel click can land — which is why the check comes
        // after the await.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ctx.throwIfCancelled();
      }
    }

    return {
      columns,
      rows: out,
      measured: measuredFeatures,
      skipped: countsAsSkips([
        [skipNoGeometry(lod), noGeometry],
        [SKIP_NOT_A_SOLID, notASolid],
      ]),
      caveats: countsAsSkips([[CAVEAT_INVALID_SOLIDS, invalid]]),
    };
  } finally {
    // ALWAYS: done, failed or cancelled, the buffer must not outlive the run.
    // `release()` is idempotent, so the happy path's early drop is not undone.
    await handle.release();
  }
};

registerExecutor("measure-solids", measureSolids);
```

- [ ] **Step 5: Teach `ToolResult` and the card about the tool's own line and its caveats**

In `src/features/processing/runQueue.ts`, inside `interface ToolResult`, after `skipped`, add BOTH optional fields — this is the single declaration the whole milestone shares (Decisions recorded item 6 (i)):

```ts
  /**
   * Spec §6.2: the card's OWN first phrase, when "N buildings measured" is not
   * what this tool measured — "1,143 buildings joined" (§7.5), "6 areas
   * aggregated over 1,204 buildings" (§7.6), "1,079 valid" (§7.3). Absent for
   * a tool whose line is the default, which Measure solids' is.
   */
  readonly line?: string;
  /**
   * §6.2's CAVEATS: objects that WERE evaluated, with something withheld —
   * "37 invalid solids (no volume)". Distinct from `skipped`, which is "could
   * not be evaluated" and NULL everywhere. Optional: the M1 and M2 executors
   * have none and say nothing.
   */
  readonly caveats?: ReadonlyArray<SkipCount>;
```

and in `summarise`, find:

```ts
const parts = [
  plural(result.measured, "building measured", "buildings measured"),
];
if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
```

and replace with:

```ts
const parts = [
  result.line ??
    plural(result.measured, "building measured", "buildings measured"),
];
// §6.2's order, from the mockup's own card: "1,115 buildings measured · 37
// invalid solids (no volume) · 12 skipped · 2.4 s". A caveat sits between
// the measured count and the skipped count because it qualifies the first
// and is not part of the second.
for (const caveat of result.caveats ?? []) {
  parts.push(`${fmt(caveat.count)} ${caveat.cause}`);
}
if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
```

`canonicalise` already rebuilds the result with `{ ...result, columns, rows }`, so `line` and `caveats` survive it untouched. No later task edits these two blocks again.

Append to `tests/unit/features/processing/runQueue.test.ts`:

```ts
it("prints a caveat between the measured count and the skipped count", async () => {
  // §6.2, and the mockup's own card: the building WAS measured, with its
  // volume withheld — that is not a skip.
  registerExecutor("height-from-extent", async () => ({
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([["a", { extent_height_m: 3 }]]),
    measured: 1115,
    skipped: [{ cause: "no geometry at LoD 2.2", count: 12 }],
    caveats: [{ cause: "invalid solids (no volume)", count: 37 }],
  }));
  const id = submitRun(request());
  await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
  expect(runById(id)?.summary?.line).toMatch(
    /^1,115 buildings measured · 37 invalid solids \(no volume\) · 12 skipped · /,
  );
});
```

(Use the suite's own `request` helper. There is no `flush()` in that suite — every case settles with `await vi.waitFor(() => expect(runById(id)?.status).toBe("done"))`.)

- [ ] **Step 6: Wire the executor**

In `src/features/processing/tools/register.ts`, append after the two existing lines:

```ts
import "./measureSolids";
```

and update `tests/unit/features/processing/register.test.ts`:

```ts
it("registers every shipped executor, in `register.ts`'s import order", () => {
  expect(Object.keys(EXECUTORS)).toEqual([
    "height-from-extent",
    "roof-metrics",
    "measure-solids",
  ]);
});
```

- [ ] **Step 7: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. Measure solids now has an executor but is still `implemented: false`, so a run of it is unreachable from the UI — Task 8 is the switch.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/solidRollUp.ts \
  src/features/processing/tools/measureSolids.ts \
  src/features/processing/tools/register.ts src/features/processing/runQueue.ts \
  tests/unit/features/processing/measureSolids.test.ts \
  tests/unit/features/processing/register.test.ts \
  tests/unit/features/processing/runQueue.test.ts
git commit -m "feat: Measure solids computes volume, envelope, footprint and height"
```

---
