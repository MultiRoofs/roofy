import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const registered: string[] = [];
const dropped: string[] = [];
let failOn: string | null = null;
let output: Uint8Array | null = null;
/** What the COPY's own result row says it wrote. */
let copied = 2;
/** What the FlatCityBuf loss count answers. */
let losses = { implicit: 0, address: 0 };

vi.mock("../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (failOn !== null && statement.includes(failOn)) {
      return { ok: false as const, message: "Binder Error: no such column" };
    }
    if (statement.startsWith("COPY")) {
      return {
        ok: true as const,
        columns: ["Count"],
        rows: [{ Count: copied }],
      };
    }
    if (statement.includes('AS "implicit"')) {
      return { ok: true as const, columns: [], rows: [losses] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    onEngineDeath: vi.fn(() => () => {}),
    getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => false),
    formatDuckDBError: (e: unknown) =>
      e instanceof Error ? e.message : String(e),
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async (name: string) => {
      registered.push(name);
      return true;
    }),
    dropBuffer: vi.fn(async (name: string) => {
      dropped.push(name);
    }),
    readFile: vi.fn(async () => output),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const { resetExportCounterForTests, runExport } =
  await import("../../../src/insights/export");

const FCB_MAGIC = [0x66, 0x63, 0x62, 0x01, 0x66, 0x63, 0x62, 0x00];

function request(over: Record<string, unknown> = {}) {
  return {
    kind: "geometry" as const,
    format: "cityjson" as const,
    table: "layer_1",
    reader: "read_cityjson" as const,
    source: async () => new Uint8Array([9, 9]),
    sourceExtension: "city.json",
    lodSuffix: "2_2",
    attributes: ["bouwjaar"],
    computedAttributes: [] as ReadonlyArray<string>,
    where: null,
    sourceFeatureIds: null as ReadonlyArray<string> | null,
    rootTypes: ["Building"],
    allRootTypes: ["Building"],
    fileName: "delft.city.json",
    ...over,
  };
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  failOn = null;
  copied = 2;
  losses = { implicit: 0, address: 0 };
  output = new TextEncoder().encode('{"type":"CityJSON","CityObjects":{}}');
  resetExportCounterForTests();
});

describe("geometry export", () => {
  it("registers the source, copies it out through the writer and hands back the file", async () => {
    const result = await runExport(request());

    expect(registered).toEqual(["export_1_src.city.json"]);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(
      /^COPY \(SELECT COLUMNS\(.*\) FROM read_cityjson\('export_1_src\.city\.json'\)\) TO 'export_1\.city\.json' \(FORMAT cityjson, metadata_from 'export_1_src\.city\.json'\)$/,
    );
    expect(result.fileName).toBe("delft.city.json");
    expect(result.blob.type).toBe("application/city+json");
    expect(await result.blob.text()).toContain('"CityJSON"');
    // Both the source and the output are released, whatever happened.
    expect(dropped).toEqual(
      expect.arrayContaining(["export_1_src.city.json", "export_1.city.json"]),
    );
  });

  it("writes each format under its own extension and media type", async () => {
    output = new Uint8Array([...FCB_MAGIC, 0, 0]);
    const fcb = await runExport(
      request({ format: "flatcitybuf", fileName: "delft.fcb" }),
    );
    expect(sql[0]).toContain("TO 'export_1.fcb' (FORMAT flatcitybuf");
    expect(fcb.blob.type).toBe("application/octet-stream");

    output = new TextEncoder().encode('{"type":"CityJSON"}\n');
    const seq = await runExport(
      request({
        format: "cityjsonseq",
        reader: "read_cityjsonseq",
        sourceExtension: "city.jsonl",
      }),
    );
    expect(sql.filter((q) => q.startsWith("COPY"))[1]).toContain(
      "TO 'export_2.city.jsonl' (FORMAT cityjsonseq",
    );
    expect(seq.blob.type).toBe("application/city+json-seq");
  });

  it("emits no type predicate when every root type is chosen, and one when not", async () => {
    await runExport(request());
    expect(sql[0]).not.toContain('"object_type" IN');
    await runExport(
      request({ rootTypes: ["Building"], allRootTypes: ["Building", "Road"] }),
    );
    expect(sql[1]).toContain(`"object_type" IN ('Building')`);
  });

  it("refuses an empty type selection before touching the engine", async () => {
    await expect(runExport(request({ rootTypes: [] }))).rejects.toThrow(
      "Choose at least one object type to export.",
    );
    expect(registered).toEqual([]);
  });

  it("refuses a write that produced nothing, and still cleans up", async () => {
    // The missing-file signature: one garbage byte, no error.
    output = new Uint8Array([0x2a]);
    await expect(runExport(request())).rejects.toThrow(
      "DuckDB produced no output for export_1.city.json",
    );
    expect(dropped).toEqual(
      expect.arrayContaining(["export_1_src.city.json", "export_1.city.json"]),
    );
  });

  it("reports the engine's sentence when the COPY fails", async () => {
    failOn = "COPY";
    await expect(runExport(request())).rejects.toThrow(
      "Binder Error: no such column",
    );
    expect(dropped).toContain("export_1_src.city.json");
  });

  it("warns when a FlatCityBuf could not carry implicit geometries or addresses", async () => {
    output = new Uint8Array([...FCB_MAGIC, 0, 0]);
    losses = { implicit: 2, address: 1 };
    const result = await runExport(
      request({ format: "flatcitybuf", fileName: "delft.fcb" }),
    );
    expect(result.warnings).toEqual([
      "FlatCityBuf cannot hold implicit geometries or addresses: 2 objects were written without their implicit geometry and 1 without its address. CityJSON and CityJSONSeq keep both.",
    ]);
  });

  it("asks nothing extra of a CityJSON export, which keeps both", async () => {
    losses = { implicit: 2, address: 1 };
    const result = await runExport(request());
    expect(result.warnings).toEqual([]);
    expect(sql).toHaveLength(1);
  });

  it("says so when no object matched", async () => {
    copied = 0;
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "No objects matched, so the file is empty.",
    ]);
  });
});
