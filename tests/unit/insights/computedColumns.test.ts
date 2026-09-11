import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/insights/duckdb", () => ({
  runQuery: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {},
    loadedExtensions: [],
    platform: null,
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

const cc = await import("../../../src/insights/computedColumns");
const duck = await import("../../../src/insights/duckdb");

describe("computed column SQL", () => {
  it("adds a column idempotently", () => {
    expect(
      cc.buildAddColumnSql("layer_1", {
        name: "extent_height_m",
        type: "DOUBLE",
      }),
    ).toBe(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "extent_height_m" DOUBLE',
    );
  });
  it("backs up replaced columns for the touched ids only", () => {
    expect(
      cc.buildBackupSql("layer_1", "__undo_r1", ["a", "b"], ["x", "y'z"]),
    ).toBe(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a", "b" FROM "layer_1" WHERE "id" IN ('x', 'y''z')`,
    );
    expect(cc.buildBackupSql("layer_1", "__undo_r1", ["a"], null)).toBe(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a" FROM "layer_1"`,
    );
  });
  it("updates from the registered values", () => {
    expect(
      cc.buildUpdateFromValuesSql("layer_1", "__vals_r1.json", ["a", "b"]),
    ).toBe(
      `UPDATE "layer_1" SET "a" = v."a", "b" = v."b" FROM read_json_auto('__vals_r1.json') AS v WHERE "layer_1"."id" = v."id"`,
    );
  });
  it("restores and nullifies", () => {
    expect(cc.buildRestoreSql("layer_1", "__undo_r1", ["a"])).toBe(
      `UPDATE "layer_1" SET "a" = u."a" FROM "__undo_r1" AS u WHERE "layer_1"."id" = u."id"`,
    );
    expect(cc.buildNullifySql("layer_1", ["a"], ["x"])).toBe(
      `UPDATE "layer_1" SET "a" = NULL WHERE "id" IN ('x')`,
    );
  });
});

describe("writeComputedColumns", () => {
  it("issues backup, add, update inside one transaction and registers the rows", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r1",
      table: "layer_1",
      columns: [
        { name: "a", type: "DOUBLE" },
        { name: "b", type: "BOOLEAN" },
      ],
      rows: new Map([
        ["x", { a: 1.5, b: true }],
        ["y", { a: null, b: false }],
      ]),
      existing: new Set(["a"]),
    });
    expect(result).toEqual({ ok: true, backupTable: "__undo_r1" });
    expect(calls[0]).toBe("BEGIN TRANSACTION");
    expect(calls).toContain(
      `CREATE TABLE "__undo_r1" AS SELECT "id", "a" FROM "layer_1" WHERE "id" IN ('x', 'y')`,
    );
    expect(calls).toContain(
      'ALTER TABLE "layer_1" ADD COLUMN IF NOT EXISTS "b" BOOLEAN',
    );
    expect(calls.at(-1)).toBe("COMMIT");
    const registered = vi.mocked(duck.registerBuffer).mock.calls[0];
    expect(registered?.[0]).toBe("__vals_r1.json");
    expect(JSON.parse(new TextDecoder().decode(registered?.[1]))).toEqual([
      { id: "x", a: 1.5, b: true },
      { id: "y", a: null, b: false },
    ]);
    expect(duck.dropBuffer).toHaveBeenCalledWith("__vals_r1.json");
  });

  it("rolls back and reports the first failing statement", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return sql.startsWith("UPDATE")
        ? { ok: false, message: "Binder Error: x" }
        : { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r2",
      table: "layer_1",
      columns: [{ name: "a", type: "DOUBLE" }],
      rows: new Map([["x", { a: 1 }]]),
      existing: new Set(),
    });
    expect(result).toEqual({ ok: false, message: "Binder Error: x" });
    expect(calls).toContain("ROLLBACK");
  });
});

describe("undoComputedColumns", () => {
  it("restores the replaced values, drops the created columns and the backup", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.undoComputedColumns({
      table: "layer_1",
      backupTable: "__undo_r1",
      created: ["b"],
      replaced: ["a"],
      ids: ["x"],
    });
    expect(result).toEqual({ ok: true, columns: [], rows: [] });
    expect(calls).toEqual([
      "BEGIN TRANSACTION",
      `UPDATE "layer_1" SET "a" = u."a" FROM "__undo_r1" AS u WHERE "layer_1"."id" = u."id"`,
      'ALTER TABLE "layer_1" DROP COLUMN IF EXISTS "b"',
      'DROP TABLE IF EXISTS "__undo_r1"',
      "COMMIT",
    ]);
  });

  it("rolls back and returns the engine's message when a statement fails", async () => {
    const calls: string[] = [];
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return sql.startsWith("ALTER TABLE")
        ? { ok: false, message: "Catalog Error: no column b" }
        : { ok: true, columns: [], rows: [] };
    });
    const result = await cc.undoComputedColumns({
      table: "layer_1",
      backupTable: null,
      created: ["b"],
      replaced: [],
      ids: null,
    });
    expect(result).toEqual({
      ok: false,
      message: "Catalog Error: no column b",
    });
    expect(calls).toContain("ROLLBACK");
  });
});

describe("computed column registry", () => {
  it("records provenance per layer and column and clears it", () => {
    const p = {
      runId: "r1",
      toolName: "Height from extent",
      summary: "All · 2 buildings",
      at: 1,
      partial: null,
      previous: null,
    };
    cc.useComputedColumnStore
      .getState()
      .setProvenance("L1", "extent_height_m", p);
    expect([...cc.computedColumnsOf("L1")]).toEqual(["extent_height_m"]);
    expect(cc.provenanceOf("L1", "extent_height_m")).toEqual(p);
    cc.useComputedColumnStore
      .getState()
      .removeColumns("L1", ["extent_height_m"]);
    expect(cc.computedColumnsOf("L1").size).toBe(0);
    expect(cc.provenanceOf("L1", "extent_height_m")).toBeNull();
  });

  it("clears a whole layer without touching another", () => {
    const p = {
      runId: "r2",
      toolName: "Roof area",
      summary: "All · 3 buildings",
      at: 2,
      partial: null,
      previous: null,
    };
    const store = cc.useComputedColumnStore.getState();
    store.setProvenance("L1", "roof_area_m2", p);
    store.setProvenance("L2", "roof_area_m2", p);
    store.clearLayer("L1");
    expect(cc.computedColumnsOf("L1").size).toBe(0);
    expect([...cc.computedColumnsOf("L2")]).toEqual(["roof_area_m2"]);
  });
});
