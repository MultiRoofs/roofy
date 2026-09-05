import { beforeEach, describe, expect, it, vi } from "vitest";

const sql: string[] = [];
const dropped: string[] = [];
let ddlFailure: string | null = null;
/** `undefined` = "hand back something the format's validator accepts"; a
 *  Uint8Array or null overrides it for the failure cases. */
let fileBytes: Uint8Array | null | undefined = undefined;

/** What DuckDB really writes, in miniature — enough for the content checks. */
function sampleBytes(name: string): Uint8Array {
  if (name.endsWith(".parquet")) {
    return new TextEncoder().encode("PAR1......PAR1");
  }
  if (name.endsWith(".json")) return new TextEncoder().encode('[{"id":"B1"}]');
  return new TextEncoder().encode(
    "id,feature_id,object_type,b3_h_dak_max\nB1,B1,Building,12.5\n",
  );
}

vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async (statement: string) => {
    sql.push(statement);
    return { ok: true as const, columns: [], rows: [] };
  }),
  ddl: vi.fn(async (statement: string) => {
    sql.push(statement);
    return ddlFailure === null
      ? { ok: true as const, columns: [], rows: [] }
      : { ok: false as const, message: ddlFailure };
  }),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async (name: string) => {
    dropped.push(name);
  }),
  readFile: vi.fn(async (name: string) =>
    fileBytes === undefined ? sampleBytes(name) : fileBytes,
  ),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { resetExportCounterForTests, runExport, validateExportBytes } =
  await import("../../../src/analytics/export");
import type { ColumnInfo } from "../../../src/analytics/columnKind";

/** The layer's whole set — a selection equal to it needs no predicate. */
const ROOT_TYPES: ReadonlyArray<string> = [
  "Building",
  "SolitaryVegetationObject",
];

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "feature_id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

beforeEach(() => {
  sql.length = 0;
  dropped.length = 0;
  ddlFailure = null;
  fileBytes = undefined;
  // The counter is MODULE state: without this every test after the first
  // writes export_2, export_3 … and the exact-name assertions below — the
  // "never reuses a VFS name" one above all — check the wrong numbers.
  resetExportCounterForTests();
});

describe("validateExportBytes", () => {
  it("refuses null and a zero-length read", () => {
    expect(validateExportBytes("a.csv", "csv", null)).toEqual({
      ok: false,
      message: "DuckDB produced no output for a.csv",
    });
    expect(validateExportBytes("a.csv", "csv", new Uint8Array()).ok).toBe(
      false,
    );
  });

  it("refuses the ONE-BYTE missing-file signature for every format", () => {
    // A VFS name that was never created reads back as one garbage byte, with
    // no error anywhere. Length alone catches it before any format check.
    for (const format of ["parquet", "csv", "json"] as const) {
      expect(validateExportBytes("x", format, new Uint8Array([0x2a])).ok).toBe(
        false,
      );
    }
  });

  it("requires PAR1 magic for parquet", () => {
    expect(
      validateExportBytes(
        "a.parquet",
        "parquet",
        new TextEncoder().encode("PAR1xxxx"),
      ).ok,
    ).toBe(true);
    expect(
      validateExportBytes(
        "a.parquet",
        "parquet",
        new TextEncoder().encode("not a parquet file"),
      ),
    ).toEqual({
      ok: false,
      message: "DuckDB produced no output for a.parquet",
    });
  });

  it("requires JSON to parse", () => {
    expect(
      validateExportBytes("a.json", "json", new TextEncoder().encode("[{}]"))
        .ok,
    ).toBe(true);
    expect(
      validateExportBytes("a.json", "json", new TextEncoder().encode("[{")).ok,
    ).toBe(false);
  });

  it("requires CSV to carry a newline-terminated header line", () => {
    expect(
      validateExportBytes(
        "a.csv",
        "csv",
        new TextEncoder().encode("id,type\nB1,Building\n"),
      ).ok,
    ).toBe(true);
    // A header with no newline is a truncated write, not a one-column file.
    expect(
      validateExportBytes("a.csv", "csv", new TextEncoder().encode("id,type"))
        .ok,
    ).toBe(false);
    // A leading newline means the header itself is missing.
    expect(
      validateExportBytes("a.csv", "csv", new TextEncoder().encode("\nB1\n"))
        .ok,
    ).toBe(false);
  });

  it("hands the bytes back unchanged on success", () => {
    const bytes = new TextEncoder().encode("PAR1xxxx");
    expect(validateExportBytes("a.parquet", "parquet", bytes)).toEqual({
      ok: true,
      bytes,
    });
  });
});

describe("attribute export", () => {
  it("COPYs to a fresh VFS name, reads it back, and drops it", async () => {
    const result = await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "delft.csv",
    });

    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(
      /^COPY \(SELECT "id", "feature_id", "object_type", "b3_h_dak_max" FROM "layer_1"\) TO 'export_1\.csv' \(FORMAT csv, HEADER\)$/,
    );
    expect(dropped).toEqual(["export_1.csv"]);
    expect(result.fileName).toBe("delft.csv");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("uses the extension the format names", async () => {
    await runExport({
      kind: "attributes",
      format: "parquet",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "delft.parquet",
    });
    expect(sql[0]).toContain("'export_1.parquet'");
    expect(sql[0]).toContain("(FORMAT parquet)");
  });

  it("carries the feature scope through for a filtered export", async () => {
    await runExport({
      kind: "attributes",
      format: "json",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: `"b3_h_dak_max" > 10`,
      fileName: "delft.json",
    });
    expect(sql[0]).toContain(
      'WHERE COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "b3_h_dak_max" > 10)',
    );
  });

  it("never reuses a VFS name", async () => {
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "a.csv",
    });
    sql.length = 0;
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "b.csv",
    });
    expect(sql[0]).toContain("'export_2.csv'");
  });

  it("throws DuckDB's own message and still drops the file", async () => {
    ddlFailure = "IO Error: could not write";
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: ROOT_TYPES,
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("IO Error: could not write");
    expect(dropped).toEqual(["export_1.csv"]);
  });

  it("explains an empty write rather than handing back a 0-byte file", async () => {
    fileBytes = new Uint8Array();
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: ROOT_TYPES,
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.csv");
    expect(dropped).toEqual(["export_1.csv"]);
  });

  it("refuses the one-garbage-byte read of a file that was never created", async () => {
    // The whole reason the read-back is validated by CONTENT: this case comes
    // back with no error at all, and a 1-byte "CSV" would download happily.
    fileBytes = new Uint8Array([0x2a]);
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: ROOT_TYPES,
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.csv");
  });

  it("refuses a parquet read-back without PAR1 magic", async () => {
    fileBytes = new TextEncoder().encode("this is not parquet");
    await expect(
      runExport({
        kind: "attributes",
        format: "parquet",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: ROOT_TYPES,
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.parquet",
      }),
    ).rejects.toThrow("DuckDB produced no output for export_1.parquet");
  });

  it("carries a STRICT SUBSET of the types into the SQL", async () => {
    // The whole point of the fix: the dialog's type tick-boxes used to reach
    // the CityParquet route only, so a CSV of "Buildings" quietly held the
    // vegetation as well.
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ["Building"],
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "a.csv",
    });
    expect(sql[0]).toContain(
      'WHERE COALESCE("feature_id", "id") IN (SELECT "id" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IN (\'Building\'))',
    );
  });

  it("emits NO type predicate when every type is chosen", async () => {
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: [...ROOT_TYPES],
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "a.csv",
    });
    expect(sql[0]).not.toContain('"parents" IS NULL');
  });

  it("refuses an EMPTY selection rather than writing `IN ()`", async () => {
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: [],
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow("Choose at least one object type to export.");
    // Refused before anything was written, so no VFS name was burned.
    expect(sql).toEqual([]);
  });

  it("spells HEADER, and checks the header it gets back", async () => {
    await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: COLUMNS,
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "a.csv",
    });
    expect(sql[0]).toContain("(FORMAT csv, HEADER)");
  });

  it("refuses a CSV whose header is not the columns asked for", async () => {
    // A stale file under a name we believed was fresh reads back as a
    // perfectly valid CSV — of the wrong columns.
    fileBytes = new TextEncoder().encode("wrong,columns\n1,2\n");
    await expect(
      runExport({
        kind: "attributes",
        format: "csv",
        table: "layer_1",
        columns: COLUMNS,
        rootTypes: ROOT_TYPES,
        allRootTypes: ROOT_TYPES,
        where: null,
        fileName: "a.csv",
      }),
    ).rejects.toThrow(
      "The CSV DuckDB wrote has the columns wrong, columns, not the id, feature_id, object_type, b3_h_dak_max that were asked for.",
    );
    expect(dropped).toEqual(["export_1.csv"]);
  });

  it("reads a quoted header field as ONE column", async () => {
    // An attribute name may hold a comma; DuckDB quotes it, and splitting on
    // commas would refuse a good file.
    fileBytes = new TextEncoder().encode('"a,b"\n1\n');
    const result = await runExport({
      kind: "attributes",
      format: "csv",
      table: "layer_1",
      columns: [{ name: "a,b", type: "VARCHAR", kind: "scalar" }],
      rootTypes: ROOT_TYPES,
      allRootTypes: ROOT_TYPES,
      where: null,
      fileName: "a.csv",
    });
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
