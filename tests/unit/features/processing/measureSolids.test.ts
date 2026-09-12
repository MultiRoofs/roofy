/**
 * §7.2's four outcomes per object, §7's roll-ups from contributors to the
 * feature, and the skip/caveat arithmetic the card prints.
 *
 * The ENGINE facts underneath — `ST_3DVolume` over a CompositeSolid returns its
 * members' SUM, an invalid solid answers every measure but the volume, a
 * MultiSurface at a solid LoD does not parse — are Task 1's, pinned on
 * `fixtures/{composite-solid,invalid-solid,two-buildings}.city.json` by
 * `tests/integration/duckdb/solids.test.ts`. These cases are app-side and use
 * literal reader rows; they do not re-probe them. What they DO take from the
 * fixtures is the MODEL: `layerFromFixture` builds the layer's surface tags out
 * of each CityObject's own `geometry[].{type, lod}`, so "Pand.0001's
 * MultiSurface part is the contributor" is the fixture's fact and not this
 * file's assumption.
 *
 * The roll-ups are tested PURE (`rollUpSolids` over literal rows), and the
 * executor over a stubbed `ToolContext` — the queue, the engine and the source
 * read are all seams, so what is asserted here is the tool's behaviour and
 * never a mock's.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    geometry_type: string | null;
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
  geometry_type: "Solid",
  parsed: true,
  is_valid: true,
  volume_m3: 100,
  envelope_m2: 20,
  footprint_m2: 10,
  ground_m: 0,
  ridge_m: 8,
  ...over,
});

/** The reader's row for a MultiSurface at a solid LoD: parses to NULL (D4). */
const notASolidRow = (id: string, f: string) =>
  solidRow(id, f, {
    geometry_type: "MultiSurface",
    parsed: false,
    is_valid: null,
    volume_m3: null,
    envelope_m2: null,
    footprint_m2: null,
    ground_m: null,
    ridge_m: null,
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

  it("lets FALSE dominate an unknown, in either order", () => {
    // Three-valued AND: one contributor the engine checked and REJECTED makes
    // the feature invalid whatever a sibling with no report says. Order must
    // not decide it — a `valid` that depended on the reader's row order would
    // flip between two runs of the same scope.
    const rejected = solidRow("p1", "B", { is_valid: false });
    const unknown = solidRow("p2", "B", { is_valid: null });
    expect(rollUpSolids([rejected, unknown])?.valid).toBe(false);
    expect(rollUpSolids([unknown, rejected])?.valid).toBe(false);
    // With no rejection, an unknown still withholds the verdict.
    expect(rollUpSolids([solidRow("p1", "B"), unknown])?.valid).toBeNull();
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

/**
 * A layer whose model tags say who has geometry at which LoD — built from a
 * REAL fixture's `CityObjects`, so the contributor rule is exercised against the
 * file the engine probes read and not against a hand-written guess. Only the
 * fields `geometryLodsByObject` and `featureIdsByObject` read are filled.
 */
function layerFromFixture(file: string): Layer {
  const doc = JSON.parse(
    readFileSync(resolve(import.meta.dirname!, "../../../../fixtures", file), {
      encoding: "utf-8",
    }),
  ) as {
    readonly CityObjects: Readonly<
      Record<
        string,
        {
          readonly type: string;
          readonly parents?: ReadonlyArray<string>;
          readonly children?: ReadonlyArray<string>;
          readonly geometry?: ReadonlyArray<{
            readonly type: string;
            readonly lod?: string;
          }>;
        }
      >
    >;
  };
  const objects: Record<string, unknown> = {};
  for (const [id, object] of Object.entries(doc.CityObjects)) {
    objects[id] = {
      id,
      objectType: object.type,
      attributes: {},
      surfaces: (object.geometry ?? []).map((geometry) => ({
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod: geometry.lod ?? null,
        geometryType: geometry.type,
      })),
      bbox: null,
      children: object.children ?? [],
      parents: object.parents ?? [],
      lod: null,
    };
  }
  return layerWithObjects(objects, file);
}

/** A layer whose model tags say who has geometry at 2.2 — ids of this file's own. */
function layerWith(lodsByObject: Record<string, string[]>): Layer {
  const objects: Record<string, unknown> = {};
  for (const [id, lods] of Object.entries(lodsByObject)) {
    objects[id] = {
      id,
      objectType: id.endsWith("P") ? "BuildingPart" : "Building",
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
      // A part is a part because it names its parent: `featureIdsByObject`
      // reads `parents`, exactly as the fixtures do.
      parents: id.endsWith("P") ? [id.slice(0, -1)] : [],
      lod: null,
    };
  }
  return layerWithObjects(objects, "Delft");
}

function layerWithObjects(
  objects: Record<string, unknown>,
  name: string,
): Layer {
  return {
    id: "L1",
    name,
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

/** A `ToolContext` whose `query` answers the statements in order. */
function context(
  layer: Layer,
  answers: ReadonlyArray<QueryOutcome>,
  over: {
    featureIds?: ReadonlyArray<string> | null;
    throwIfCancelled?: () => void;
  } = {},
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

const measured = (
  rows: ReadonlyArray<Record<string, unknown>>,
): QueryOutcome => ({ ok: true, columns: [], rows: [...rows] });

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
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B1P", "B2"]),
      measured([
        solidRow("B1P", "B1", {
          volume_m3: 200,
          footprint_m2: 40,
          ridge_m: 10,
        }),
        solidRow("B2", "B2"),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);

    expect(phases).toEqual(["compute"]); // the queue already set "source"
    expect(labels).toEqual([
      "Reading features",
      "Checking source ids",
      "Measuring solids",
    ]);
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
    expect(result.caveats).toEqual([]);
  });

  it("writes NULL everywhere and skips 'no geometry' with no contributor", async () => {
    // §7.2's first outcome, decided from the MODEL's tags before any SQL: a
    // feature whose only geometry is at another LoD is never asked about.
    const layer = layerWith({ B1: ["1.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B2"]),
      measured([solidRow("B2", "B2")]),
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

  it("skips 'not a solid' on the CityJSON geometry type, with valid NULL too", async () => {
    // §7.2's second outcome, keyed on the reader's `geometry_type` (D4) — a
    // CompositeSolid's WKB type is "GeometryCollection Z", so the CityJSON type
    // is the only reliable answer. `is_valid` is NULL for a row that did not
    // parse (the statement guards every report field on `s IS NOT NULL`), so
    // `valid` must be NULL and never false — false would claim the solid was
    // checked and rejected.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B2"]),
      measured([notASolidRow("B1", "B1"), solidRow("B2", "B2")]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
    expect(result.rows.get("B1")?.["solid_valid"]).toBeNull();
  });

  it("measures a CompositeSolid: D4's type is a solid type", async () => {
    // `fixtures/composite-solid.city.json`: two unit cubes, volume 2, envelope
    // 12, footprint 2 (pinned on the real engine by the probe suite). Keying
    // "is this a solid?" on the WKB type would have skipped it.
    const layer = layerFromFixture("composite-solid.city.json");
    const id = "NL.TEST.Composite.0001";
    const { ctx } = context(layer, [
      scopeRows([[id, id]]),
      sourceIds([id]),
      measured([
        solidRow(id, id, {
          geometry_type: "CompositeSolid",
          volume_m3: 2,
          envelope_m2: 12,
          footprint_m2: 2,
          ground_m: 0,
          ridge_m: 1,
        }),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.rows.get(id)).toMatchObject({
      solid_volume_m3: 2,
      solid_envelope_m2: 12,
      solid_footprint_m2: 2,
      solid_height_m: 1,
      solid_valid: true,
    });
  });

  it("skips a row that PARSED but is not a solid in the CityJSON model", async () => {
    // The reason the detector is the TYPE and not the parse (D4): a
    // CompositeSurface's WKB is a PolyhedralSurface Z, the same shape a Solid
    // carries, so `ST_3DTryFromWKB` reads it as a SOLID_3D and `ST_3DVolume`
    // answers for it. Measuring the volume of something CityJSON does not call
    // a solid is a number the model does not support.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      measured([
        solidRow("B1", "B1", {
          geometry_type: "CompositeSurface",
          parsed: true,
        }),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(0);
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
    expect(result.rows.get("B1")).toEqual({
      solid_volume_m3: null,
      solid_envelope_m2: null,
      solid_footprint_m2: null,
      solid_height_m: null,
      solid_valid: null,
    });
  });

  it("skips a solid-typed row the parser could not read", async () => {
    // A row the FILE calls a Solid but `ST_3DTryFromWKB` returned NULL for
    // (garbage WKB). §7.2 has two skip causes and this is not "no geometry":
    // the feature had geometry at the LoD and nothing solid came out of it.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      measured([
        solidRow("B1", "B1", {
          parsed: false,
          is_valid: null,
          volume_m3: null,
          envelope_m2: null,
          footprint_m2: null,
          ground_m: null,
          ridge_m: null,
        }),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(0);
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
  });

  it("reads two-buildings' MultiSurface PART as the contributor (1 measured, 1 skipped)", async () => {
    // `fixtures/two-buildings.city.json` at LoD 2.2: Pand.0001 carries a Solid
    // AND a BuildingPart whose geometry is a MultiSurface. §7's contributor
    // rule is about GEOMETRY OF ANY KIND, so the PART is the contributor and
    // the root's solid is ignored — the whole FEATURE is "not a solid". Keying
    // the contributor rule on "has a solid" instead would measure the root and
    // double-count the 3D BAG's own duplicate.
    const layer = layerFromFixture("two-buildings.city.json");
    const root = "NL.IMBAG.Pand.0001";
    const part = "NL.IMBAG.Pand.0001-part1";
    const valid = "NL.IMBAG.Pand.0002";
    const { ctx, statements } = context(layer, [
      scopeRows([
        [root, root],
        [part, root],
        [valid, valid],
      ]),
      sourceIds([root, part, valid]),
      measured([
        notASolidRow(part, root),
        solidRow(valid, valid, {
          volume_m3: 2178,
          envelope_m2: 1013.4,
          footprint_m2: 180,
          ground_m: 0,
          ridge_m: 12.1,
        }),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([{ cause: "not a solid", count: 1 }]);
    // The root's own solid is never parsed: only the part was asked about.
    expect(statements[2]).toContain(`WHERE "id" IN ('${part}', '${valid}')`);
    expect(result.rows.get(root)?.["solid_volume_m3"]).toBeNull();
    expect(result.rows.get(valid)).toMatchObject({
      solid_volume_m3: 2178,
      solid_height_m: 12.1,
      solid_valid: true,
    });
  });

  it("keeps every other measure on the INVALID-solid fixture and reports the caveat", async () => {
    // §7.2's third outcome, on `fixtures/invalid-solid.city.json` — the same
    // unclosed solid as two-buildings' Pand.0001, on a building with NO parts,
    // so the FEATURE is measurable. Its engine numbers (volume NULL, envelope
    // 388, footprint 80, zmin 0, zmax 8.4) are the probe suite's. An invalid
    // solid is NOT a skip: the building WAS measured.
    const layer = layerFromFixture("invalid-solid.city.json");
    const id = "NL.IMBAG.Pand.0001";
    const { ctx } = context(layer, [
      scopeRows([[id, id]]),
      sourceIds([id]),
      measured([
        solidRow(id, id, {
          is_valid: false,
          volume_m3: null,
          envelope_m2: 388,
          footprint_m2: 80,
          ground_m: 0,
          ridge_m: 8.4,
        }),
      ]),
    ]);
    const result = await measureSolids(run(), ctx as never);
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.caveats).toEqual([
      { cause: "invalid solids (no volume)", count: 1 },
    ]);
    expect(result.rows.get(id)).toMatchObject({
      solid_volume_m3: null,
      solid_envelope_m2: 388,
      solid_footprint_m2: 80,
      solid_height_m: 8.4,
      solid_valid: false,
    });
  });

  it("reports no caveat when the volume was not asked for", async () => {
    // The caveat is "invalid solids (no volume)": nothing was withheld from a
    // run that never ticked the volume.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      measured([solidRow("B1", "B1", { is_valid: false, volume_m3: null })]),
    ]);
    const result = await measureSolids(
      run({ params: { measures: ["envelope"] } }),
      ctx as never,
    );
    expect(result.measured).toBe(1);
    expect(result.caveats).toEqual([]);
  });

  it("adds the skip causes up to the skipped count, with both causes present", async () => {
    // §6.2: "skipped objects are explained in a second muted line by cause, and
    // the causes add up to the skipped count".
    const layer = layerWith({ B1: ["2.2"], B2: ["1.2"], B3: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
        ["B3", "B3"],
      ]),
      sourceIds(["B1", "B2", "B3"]),
      measured([solidRow("B1", "B1"), notASolidRow("B3", "B3")]),
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
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      measured([solidRow("B1", "B1")]),
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
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1", "B1P"]),
      measured([solidRow("B1P", "B1")]),
    ]);
    await measureSolids(run(), ctx as never);
    const measureSql = statements[2] ?? "";
    // The ROOT is displaced by its part (§7), so its solid is never parsed.
    expect(measureSql).toContain(`WHERE "id" IN ('B1P')`);
    expect(measureSql).not.toContain("'B1'");
  });

  it("checks the source ids over the WHOLE SCOPE, unfiltered for scope 'all'", async () => {
    // The identity statement is the SCOPE's, not the contributors': it asks
    // the source which of the scoped rows it still holds. On scope "all"
    // `ctx.featureIds` is null, so the statement carries no WHERE at all —
    // which is also what keeps a 100k-building run's §6.4 log readable.
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] });
    const { ctx, statements } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1", "B1P"]),
      measured([solidRow("B1P", "B1")]),
    ]);
    await measureSolids(run(), ctx as never);
    const identity = statements[1] ?? "";
    expect(identity).toContain(
      `read_cityjson('layer_1_run_1.city.json', lod => '2.2')`,
    );
    expect(identity).not.toContain("WHERE");
  });

  it("fails with §6.1's id sentence when the source matches NOTHING", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(layer, [scopeRows([["B1", "B1"]]), sourceIds([])]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    // The bytes are still released: the `finally` runs on every exit path.
    expect(release).toHaveBeenCalled();
  });

  it("fails on a PARTIAL answer too, rather than publishing half a run", async () => {
    // §6.1's id join over EVERY scoped row. B1 came back and B2 did not: the
    // file no longer holds B2. Counting B2 as "not a solid" would publish a
    // verdict on geometry nobody looked at, alongside a real measurement.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1"]),
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("fails when the MEASURE answer drops a contributor the id check saw", async () => {
    // The second threshold, over the rows that are actually measured: the id
    // check answered for both, and then the measure statement came back without
    // B2. Rolling that up would publish B2 as "not a solid" — a verdict on
    // geometry nobody looked at — beside a real measurement of B1.
    const layer = layerWith({ B1: ["2.2"], B2: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B2", "B2"],
      ]),
      sourceIds(["B1", "B2"]),
      measured([solidRow("B1", "B1")]),
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    expect(release).toHaveBeenCalled();
  });

  it("detects a missing ROOT under scope 'all', which measures no root row", async () => {
    // The root is displaced by its part, so nothing ever asks the source to
    // measure it — and a contributor-only identity check would never notice
    // that the file has stopped holding it. §6.1's promise is about the LOADED
    // LAYER, not about the rows this run happens to parse.
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1P"]),
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("detects a missing ROOT under a frozen id list too", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["2.2"] });
    const { ctx, statements } = context(
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
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
    // Scoped, and by the SCOPE's ids rather than the contributors'.
    expect(statements[1]).toContain(`WHERE "id" IN ('B1', 'B1P')`);
  });

  it("detects a missing NON-CONTRIBUTING part under scope 'all'", async () => {
    // A part with no geometry at this LoD contributes nothing and is measured
    // never — and its disappearance from the file is exactly as much evidence
    // that the source moved as a missing contributor's is.
    const layer = layerWith({ B1: ["2.2"], B1P: ["1.2"] });
    const { ctx } = context(layer, [
      scopeRows([
        ["B1", "B1"],
        ["B1P", "B1"],
      ]),
      sourceIds(["B1"]),
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("detects a missing NON-CONTRIBUTING part under a frozen id list too", async () => {
    const layer = layerWith({ B1: ["2.2"], B1P: ["1.2"] });
    const { ctx } = context(
      layer,
      [
        scopeRows([
          ["B1", "B1"],
          ["B1P", "B1"],
        ]),
        sourceIds(["B1"]),
      ],
      { featureIds: ["B1", "B1P"] },
    );
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      SOURCE_IDS_DIFFER,
    );
  });

  it("gives a reader failure §6.1's own sentence, engine words to the log", async () => {
    // The parse and the wasm allocation happen INSIDE this statement, so a
    // source that gunzips to garbage fails here — §6.1 promises a sentence for
    // it, and §6.4 keeps DuckDB's own reason in the log.
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx, warnings } = context(layer, [
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
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
      scopeRows([["B1", "B1"]]),
      sourceIds(["B1"]),
      { ok: false, message: "Binder Error: no such column" },
    ]);
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      /Binder Error/,
    );
    expect(warnings).toEqual([]);
    expect(release).toHaveBeenCalled();
  });

  it("releases the bytes when the run is CANCELLED mid-compute", async () => {
    const layer = layerWith({ B1: ["2.2"] });
    const { ctx } = context(
      layer,
      [scopeRows([["B1", "B1"]]), sourceIds(["B1"])],
      {
        throwIfCancelled: () => {
          throw new Error("cancelled");
        },
      },
    );
    await expect(measureSolids(run(), ctx as never)).rejects.toThrow(
      "cancelled",
    );
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
