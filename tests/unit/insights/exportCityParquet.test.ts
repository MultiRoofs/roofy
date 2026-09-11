import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

const sql: string[] = [];
const registered: string[] = [];
const dropped: string[] = [];
const readFiles: string[] = [];
let writeRows: Record<string, unknown>[] = [];
/** What `SELECT "severity", count(*) … FROM cityparquet_validation` answers. */
let validationRows: Record<string, unknown>[] = [];
let validationReadFails = false;
let failOn: string | null = null;
/** Override a single read-back to exercise the validators. */
let badFile: { name: string; bytes: Uint8Array | null } | null = null;
/**
 * What `glob('<outDir>/*')` answers, as BARE names — the cleanup's second
 * source of truth. It matters only when the write itself failed part-way, so
 * it is empty for every other test and the union is a no-op.
 */
let globNames: string[] = [];

/** What the writer really produces, in miniature. */
function sampleBytes(path: string): Uint8Array {
  return path.endsWith(".parquet")
    ? new TextEncoder().encode("PAR1......PAR1")
    : new TextEncoder().encode('{"type":"Feature","id":"exp"}');
}

vi.mock("../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (failOn !== null && statement.includes(failOn)) {
      return { ok: false as const, message: "Binder Error: bad module" };
    }
    if (statement.startsWith("SELECT file FROM glob(")) {
      const dir = /glob\('([^']+)\/\*'\)/.exec(statement)?.[1] ?? "";
      return {
        ok: true as const,
        columns: ["file"],
        rows: globNames.map((name) => ({ file: `${dir}/${name}` })),
      };
    }
    if (statement.includes("cityparquet_write")) {
      return { ok: true as const, columns: [], rows: writeRows };
    }
    if (statement.startsWith('SELECT "severity"')) {
      if (validationReadFails) {
        return {
          ok: false as const,
          message:
            "Catalog Error: Table with name cityparquet_validation does not exist!",
        };
      }
      return {
        ok: true as const,
        columns: ["severity", "n"],
        rows: validationRows,
      };
    }
    // The PRAGMA itself returns NO ROWS — it materialises a temp table.
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    initDuckDB: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
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
    readFile: vi.fn(async (name: string) => {
      readFiles.push(name);
      if (badFile !== null && name.endsWith(badFile.name)) return badFile.bytes;
      return sampleBytes(name);
    }),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
  };
});

const { resetExportCounterForTests, runExport } =
  await import("../../../src/insights/export");

function request(over: Record<string, unknown> = {}) {
  return {
    kind: "cityparquet" as const,
    table: "layer_1",
    reader: "read_cityjson" as const,
    source: async () => new Uint8Array([9, 9]),
    sourceExtension: "city.json",
    lodSuffix: "2_2",
    attributes: ["b3_h_dak_max"],
    computedAttributes: [] as ReadonlyArray<string>,
    where: null,
    rootTypes: ["Building"],
    epsg: 7415,
    fileName: "delft.cityparquet.zip",
    ...over,
  };
}

beforeEach(() => {
  sql.length = 0;
  registered.length = 0;
  dropped.length = 0;
  readFiles.length = 0;
  validationRows = [];
  validationReadFails = false;
  failOn = null;
  badFile = null;
  globNames = [];
  // Module state; the `exp_<n>` names in the regexes below are per-run.
  resetExportCounterForTests();
  writeRows = [
    { file: "building.parquet", action: "written", rows: 765, bytes: 1539498 },
    { file: "metadata.json", action: "written", rows: 0, bytes: 6517 },
  ];
});

describe("CityParquet package export", () => {
  it("runs the whole sequence in order", async () => {
    await runExport(request());

    expect(sql[0]).toMatch(/^CREATE SCHEMA "exp_\d+_src"$/);
    expect(sql[1]).toMatch(/^CREATE SCHEMA "exp_\d+"$/);
    expect(sql[2]).toMatch(/^CREATE TABLE "exp_\d+_src"\."src" AS SELECT/);
    expect(sql[3]).toContain('."building" AS SELECT * FROM "exp_');
    expect(sql[4]).toMatch(/^PRAGMA cityparquet_init\('exp_\d+'\)$/);
    expect(sql[5]).toBe("DROP TABLE IF EXISTS cityparquet_validation");
    expect(sql[6]).toMatch(/^PRAGMA cityparquet_validate\('exp_\d+'\)$/);
    expect(sql[7]).toBe(
      'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1 ORDER BY 1',
    );
    expect(sql[8]).toMatch(
      /^SELECT \* FROM cityparquet_write\('exp_\d+', 'exp_\d+', crs => 'EPSG:7415'\)$/,
    );
  });

  it("joins a computed column in from the layer table (§8)", async () => {
    // §8: "computed columns are included … in CityParquet as attributes". The
    // reader has never heard of them, so the one read of the source picks them
    // up from the table the run wrote them to, by object id.
    await runExport(
      request({
        attributes: ["b3_h_dak_max", "extent_height_m"],
        computedAttributes: ["extent_height_m"],
      }),
    );
    expect(sql[2]).toContain(
      '"b3_h_dak_max", "extent_height_m" FROM read_cityjson(',
    );
    expect(sql[2]).toContain(
      'LEFT JOIN (SELECT "id", "extent_height_m" FROM "layer_1") AS "computed" USING ("id")',
    );
  });

  it("re-registers the source under a FRESH name, reads it ONCE, and drops it", async () => {
    await runExport(
      request({ rootTypes: ["Building", "SolitaryVegetationObject"] }),
    );
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatch(/^exp_\d+_src\.city\.json$/);
    // Exactly ONE statement names the reader, however many modules there are:
    // re-reading per module would re-parse the whole file each time.
    expect(sql.filter((s) => s.includes("read_cityjson("))).toHaveLength(1);
    // And the bytes go as soon as the parse is done, not at the end.
    expect(dropped).toContain(registered[0]!);
  });

  it("puts the scratch table in a SEPARATE schema from the module tables", async () => {
    await runExport(request());
    const scratch = sql.find((s) => s.includes('."src" AS SELECT'))!;
    const module = sql.find((s) => s.includes('."building" AS SELECT'))!;
    expect(scratch).toMatch(/CREATE TABLE "exp_\d+_src"\."src"/);
    expect(module).toMatch(/CREATE TABLE "exp_\d+"\."building"/);
    // cityparquet_init describes every table in the schema it is handed, and
    // `src` is not a CityGML module.
    expect(module).not.toContain('"src" AS SELECT');
  });

  it("writes ONE table per CityGML module, cut from the scratch table", async () => {
    await runExport(
      request({ rootTypes: ["Building", "SolitaryVegetationObject"] }),
    );
    // The scratch statement is the one that CREATES `src`; every module
    // statement READS from it (`FROM "exp_N_src"."src" WHERE …`), so the
    // scratch table is identified by `."src" AS SELECT`, as elsewhere here.
    const creates = sql.filter(
      (s) => s.startsWith("CREATE TABLE") && !s.includes('."src" AS SELECT'),
    );
    expect(creates).toHaveLength(2);
    expect(creates[0]).toContain('."building" AS SELECT * FROM "exp_');
    expect(creates[1]).toContain('."vegetation" AS SELECT * FROM "exp_');
  });

  it("zips every file the write NAMED, pulled with readFile from the output dir", async () => {
    const result = await runExport(request());
    expect(readFiles).toHaveLength(2);
    expect(readFiles[0]).toMatch(/^exp_\d+\/building\.parquet$/);
    expect(readFiles[1]).toMatch(/^exp_\d+\/metadata\.json$/);

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
    ]);
    expect(result.fileName).toBe("delft.cityparquet.zip");
  });

  it("reports validation findings as a WARNING, never a refusal", async () => {
    validationRows = [
      { severity: "error", n: 2 },
      { severity: "warning", n: 1 },
    ];
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "cityparquet_validate reported 3 findings (2 error, 1 warning). The package was written anyway.",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("says so when the validation could not be RUN, and still writes", async () => {
    failOn = "PRAGMA cityparquet_validate";
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "Validation could not be run: Binder Error: bad module",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("says so when the findings could not be READ — never a silent skip", async () => {
    // The real shape of this failure: a PRAGMA that threw never created the
    // temp table, so the follow-up SELECT raises a Catalog Error (probe P6g).
    validationReadFails = true;
    const result = await runExport(request());
    expect(result.warnings).toEqual([
      "Validation could not be read: Catalog Error: Table with name cityparquet_validation does not exist!",
    ]);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("drops the PREVIOUS run's findings table before validating", async () => {
    // The temp table lives on the CONNECTION, so a second export would
    // otherwise read the first one's findings as its own.
    await runExport(request());
    expect(sql).toContain("DROP TABLE IF EXISTS cityparquet_validation");
  });

  it("drops BOTH schemas, the source and every output — always", async () => {
    await runExport(request());
    expect(
      sql.some((s) => /^DROP SCHEMA IF EXISTS "exp_\d+" CASCADE$/.test(s)),
    ).toBe(true);
    expect(
      sql.some((s) => /^DROP SCHEMA IF EXISTS "exp_\d+_src" CASCADE$/.test(s)),
    ).toBe(true);
    expect(dropped).toContainEqual(
      expect.stringMatching(/^exp_\d+_src\.city\.json$/),
    );
    expect(dropped).toContainEqual(expect.stringMatching(/building\.parquet$/));
    expect(dropped).toContainEqual(expect.stringMatching(/metadata\.json$/));
  });

  it("cleans up after a failure and reports DuckDB's message", async () => {
    failOn = "CREATE TABLE";
    await expect(runExport(request())).rejects.toThrow(
      "Binder Error: bad module",
    );
    expect(
      sql.filter((s) => s.startsWith("DROP SCHEMA IF EXISTS")),
    ).toHaveLength(2);
    expect(dropped).toContainEqual(expect.stringMatching(/_src\.city\.json$/));
  });

  it("removes a PARTIAL package the failed write left behind", async () => {
    // The gap: `cityparquet_write` throws after creating
    // `exp_N/building.parquet`, so it never returns the rows `writtenFiles` is
    // filled from — the `finally` had nothing on its list and the file stayed
    // in the VFS for the life of the page. The glob is what finds it.
    failOn = "cityparquet_write";
    globNames = ["building.parquet"];
    await expect(runExport(request())).rejects.toThrow(
      "Binder Error: bad module",
    );
    expect(sql).toContainEqual(
      expect.stringMatching(/^SELECT file FROM glob\('exp_\d+\/\*'\)$/),
    );
    expect(dropped).toContainEqual(
      expect.stringMatching(/^exp_\d+\/building\.parquet$/),
    );
  });

  it("drops each leftover ONCE when the glob and the write rows agree", async () => {
    // Both sources name the same two files; the union must not drop them
    // twice, which would log a warning per file for nothing.
    globNames = ["building.parquet", "metadata.json"];
    await runExport(request());
    const packageDrops = dropped.filter((d) => /^exp_\d+\//.test(d));
    expect(packageDrops).toHaveLength(2);
    expect(new Set(packageDrops).size).toBe(2);
  });

  it("refuses when the write named no files", async () => {
    writeRows = [];
    await expect(runExport(request())).rejects.toThrow(
      "The CityParquet writer produced no files.",
    );
  });

  it("refuses a MISSING output — one garbage byte, no error — and cleans up", async () => {
    badFile = { name: "building.parquet", bytes: new Uint8Array([0x2a]) };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for exp_\d+\/building\.parquet/,
    );
    expect(sql.some((s) => s.startsWith("DROP SCHEMA"))).toBe(true);
  });

  it("refuses a parquet output without PAR1 magic", async () => {
    badFile = {
      name: "building.parquet",
      bytes: new TextEncoder().encode("not parquet at all"),
    };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for/,
    );
  });

  it("refuses a metadata.json that does not parse", async () => {
    badFile = {
      name: "metadata.json",
      bytes: new TextEncoder().encode("{ not json"),
    };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for/,
    );
  });

  it("takes the name from the FIRST string column, and strips a repeated dir prefix", async () => {
    // The column is called `file` today, but that is the extension's private
    // spelling; and the writer has been seen to report a path relative to the
    // database rather than a bare name, which would otherwise be read back as
    // `exp_1/exp_1/building.parquet` — the missing-file signature.
    writeRows = [
      { name: "exp_1/building.parquet", action: "written", rows: 1, bytes: 10 },
      { name: "metadata.json", action: "written", rows: 0, bytes: 10 },
    ];
    const result = await runExport(request());
    for (const path of readFiles) {
      expect(path).not.toMatch(/exp_\d+\/exp_\d+\//);
    }
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
    ]);
  });

  it("puts EVERY named output on the cleanup list BEFORE validating any", async () => {
    // A validation failure on the first file used to throw with the rest of
    // the package still in the VFS and nothing left holding their names, so a
    // FAILED export of a large city leaked more than a successful one did.
    badFile = { name: "building.parquet", bytes: new Uint8Array([0x2a]) };
    await expect(runExport(request())).rejects.toThrow(
      /DuckDB produced no output for/,
    );
    expect(dropped).toContainEqual(expect.stringMatching(/building\.parquet$/));
    expect(dropped).toContainEqual(expect.stringMatching(/metadata\.json$/));
    // …and the one that failed was never read past.
    expect(readFiles).toHaveLength(1);
  });

  it("drops the findings table on the way OUT as well", async () => {
    await runExport(request());
    expect(
      sql.filter((s) => s === "DROP TABLE IF EXISTS cityparquet_validation"),
    ).toHaveLength(2);
  });

  it("refuses an EPSG code that is not a whole number", async () => {
    await expect(runExport(request({ epsg: 7415.5 }))).rejects.toThrow(
      '"7415.5" is not an EPSG code',
    );
    // Refused before the first statement: nothing to clean up.
    expect(sql).toEqual([]);
    expect(registered).toEqual([]);
  });

  it("quotes the schema, the output directory and the CRS as literals", async () => {
    await runExport(request());
    expect(sql).toContainEqual(
      expect.stringMatching(/^PRAGMA cityparquet_init\('exp_\d+'\)$/),
    );
    expect(sql).toContainEqual(
      expect.stringMatching(
        /^SELECT \* FROM cityparquet_write\('exp_\d+', 'exp_\d+', crs => 'EPSG:7415'\)$/,
      ),
    );
  });

  it("zips EVERY file the write named — a package missing one is not a package", async () => {
    writeRows = [
      { file: "building.parquet", action: "written", rows: 1, bytes: 10 },
      { file: "vegetation.parquet", action: "written", rows: 1, bytes: 10 },
      { file: "metadata.json", action: "written", rows: 0, bytes: 10 },
    ];
    const result = await runExport(
      request({ rootTypes: ["Building", "PlantCover"] }),
    );
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "building.parquet",
      "metadata.json",
      "vegetation.parquet",
    ]);
  });
});
