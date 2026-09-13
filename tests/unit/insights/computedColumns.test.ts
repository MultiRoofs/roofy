import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/insights/duckdb", () => ({
  runQuery: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
  registerBuffer: vi.fn(async () => true),
  dropBuffer: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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

const ENGINE_READY = {
  state: "ready",
  extensions: {},
  loadedExtensions: [],
  platform: null,
} as unknown as ReturnType<typeof duck.getDuckDBStatus>;

afterEach(() => {
  // `mockReturnValue` outlives the test that set it, and the cleanup guard
  // reads this on every failure path — a leaked `failed` would silence the
  // ROLLBACK of every case after it.
  vi.mocked(duck.getDuckDBStatus).mockReturnValue(ENGINE_READY);
});

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
  it("updates from the registered values, reading them at their DECLARED types", () => {
    // `read_json`, never `read_json_auto` (finding D9): JSON's sample is 20,480
    // rows, and a VARCHAR column whose first value appears after it is inferred
    // JSON — which renders a string WITH its quotes. `"id"` is declared with
    // the rest, because it is the join key.
    expect(
      cc.buildUpdateFromValuesSql("layer_1", "__vals_r1.json", [
        { name: "a", type: "DOUBLE" },
        { name: "b", type: "VARCHAR" },
      ]),
    ).toBe(
      `UPDATE "layer_1" SET "a" = v."a", "b" = v."b" FROM read_json('__vals_r1.json', columns = {"id": 'VARCHAR', "a": 'DOUBLE', "b": 'VARCHAR'}) AS v WHERE "layer_1"."id" = v."id"`,
    );
  });

  it("quotes a column name in the columns= list as an identifier", () => {
    // The struct literal's keys are identifiers: a name carrying a quotation
    // mark would otherwise end the key and change the read's shape.
    expect(
      cc.buildUpdateFromValuesSql("layer_1", "__vals_r1.json", [
        { name: 'odd "name"', type: "BOOLEAN" },
      ]),
    ).toBe(
      `UPDATE "layer_1" SET "odd ""name""" = v."odd ""name""" FROM read_json('__vals_r1.json', columns = {"id": 'VARCHAR', "odd ""name""": 'BOOLEAN'}) AS v WHERE "layer_1"."id" = v."id"`,
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
    // `calls` is what the fake database was SENT; `statements` is what the
    // write says it sent (§6.4). On a clean run they are the same list, and
    // saying so here is what stops the record drifting from the transaction.
    expect(result).toEqual({
      ok: true,
      backupTable: "__undo_r1",
      statements: calls,
    });
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
    expect(result).toEqual({
      ok: false,
      message: "Binder Error: x",
      statements: calls,
    });
    expect(calls).toContain("ROLLBACK");
  });

  it("sends NO rollback when the statement failed because the engine died", async () => {
    // Spec §6.1: the worker took the transaction, the backup table and the
    // whole database with it. There is nothing to roll back, and nothing left
    // to answer the statement — so the cleanup is skipped rather than posted.
    const calls: string[] = [];
    vi.mocked(duck.getDuckDBStatus).mockReturnValue({
      state: "failed",
      error: "worker gone",
    });
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      return sql.startsWith("UPDATE")
        ? { ok: false, message: "The analytics engine is not running." }
        : { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r9",
      table: "layer_1",
      columns: [{ name: "a", type: "DOUBLE" }],
      rows: new Map([["x", { a: 1 }]]),
      existing: new Set(),
    });
    expect(result).toEqual({
      ok: false,
      message: "The analytics engine is not running.",
      statements: calls,
    });
    expect(calls).not.toContain("ROLLBACK");
    // The record says what was SENT, so a ROLLBACK that was skipped is not in
    // it — a log claiming a rollback nobody issued would be worse than none.
    expect(result.statements).not.toContain("ROLLBACK");
  });

  it("rolls back instead of committing when the run was cancelled", async () => {
    // Spec §6.1: a cancel that lands BEFORE publication leaves nothing behind.
    // The window this closes is the UPDATE: it is the longest statement of the
    // write, and the abort arrives while it is in flight.
    const calls: string[] = [];
    const controller = new AbortController();
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      // The user presses Cancel while the UPDATE is running.
      if (sql.startsWith("UPDATE")) controller.abort();
      return { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r3",
      table: "layer_1",
      columns: [{ name: "a", type: "DOUBLE" }],
      rows: new Map([["x", { a: 1 }]]),
      existing: new Set(["a"]),
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: false,
      cancelled: true,
      message: "Cancelled",
      statements: calls,
    });
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    // The backup CTAS is inside the transaction, so the ROLLBACK is what takes
    // it away — no separate DROP, exactly as on the failure path.
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(duck.dropBuffer).toHaveBeenCalledWith("__vals_r3.json");
  });

  it("commits a write whose cancel arrived after the last statement", async () => {
    // The abort is checked ONCE, immediately before COMMIT: an abort that
    // arrives after it cannot un-commit anything, and the run says so on its
    // card ("finished before the cancel arrived").
    const calls: string[] = [];
    const controller = new AbortController();
    vi.mocked(duck.runQuery).mockImplementation(async (sql) => {
      calls.push(sql);
      if (sql === "COMMIT") controller.abort();
      return { ok: true, columns: [], rows: [] };
    });
    vi.mocked(duck.ddl).mockImplementation(async (sql) => {
      calls.push(sql);
      return { ok: true, columns: [], rows: [] };
    });
    const result = await cc.writeComputedColumns({
      runId: "r4",
      table: "layer_1",
      columns: [{ name: "a", type: "DOUBLE" }],
      rows: new Map([["x", { a: 1 }]]),
      existing: new Set(),
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      backupTable: null,
      statements: calls,
    });
    expect(calls.at(-1)).toBe("COMMIT");
    expect(calls).not.toContain("ROLLBACK");
  });
});

describe("WriteOutcome.statements", () => {
  /**
   * A plain, succeeding database. Each case below changes ONE thing about it,
   * and inheriting whatever `mockImplementation` the previous describe left
   * behind would hide which — this suite has no `vi.clearAllMocks()`.
   */
  beforeEach(() => {
    const ok = async () => ({ ok: true as const, columns: [], rows: [] });
    vi.mocked(duck.runQuery).mockImplementation(ok);
    vi.mocked(duck.ddl).mockImplementation(ok);
    vi.mocked(duck.registerBuffer).mockImplementation(async () => true);
  });

  /** One write of two columns, one of which the table already has. */
  const oneWrite = () =>
    cc.writeComputedColumns({
      runId: "run_1",
      table: "layer_1",
      columns: [
        { name: "a", type: "DOUBLE" as const },
        { name: "b", type: "BOOLEAN" as const },
      ],
      rows: new Map([["x", { a: 1, b: true }]]),
      existing: new Set(["a"]),
    });

  it("reports every statement the transaction issued, in order", async () => {
    const out = await oneWrite();
    expect(out.ok).toBe(true);
    // §6.4: "the SQL statements issued in order". BEGIN and COMMIT are part of
    // the record — a planner reading the log back has to know the write was one
    // transaction — and the backup CREATE is what makes the Undo legible.
    expect(out.statements).toEqual([
      "BEGIN TRANSACTION",
      expect.stringContaining('CREATE TABLE "__undo_run_1"'),
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "a"'),
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "b"'),
      expect.stringContaining("UPDATE"),
      "COMMIT",
    ]);
  });

  it("never prints a VALUE — the rows go through a registered buffer", async () => {
    // The UPDATE reads `read_json('__vals_run_1.json', …)`, so the log holds
    // the statement and not a thousand literals. A log that inlined the values
    // would be unusable and would leak the data into a bug report.
    const out = await oneWrite();
    const text = out.statements.join("\n");
    expect(text).toContain("__vals_run_1.json");
    expect(text).not.toContain("VALUES");
    expect(text).not.toContain("true");
  });

  it("reports the statements it got through on a FAILURE too", async () => {
    // §6.3 shows the error; §6.4 still has to say what was attempted.
    const fail = async (sql: string) =>
      sql.startsWith("UPDATE")
        ? { ok: false as const, message: "boom" }
        : { ok: true as const, columns: [], rows: [] };
    vi.mocked(duck.runQuery).mockImplementation(fail);
    vi.mocked(duck.ddl).mockImplementation(fail);
    const out = await oneWrite();
    expect(out.ok).toBe(false);
    // Everything up to and including the failed UPDATE, then the ROLLBACK that
    // undid it — which is the whole point of recording what was SENT rather
    // than the plan.
    expect(out.statements[0]).toBe("BEGIN TRANSACTION");
    expect(out.statements).toContain("ROLLBACK");
    expect(out.statements).not.toContain("COMMIT");
  });

  it("records a COMMIT that FAILED, and the rollback after it", async () => {
    // The COMMIT is sent outside the statement loop, so it is the one that a
    // record built from the loop alone would lose — and a write that failed
    // AT the commit is exactly the one a planner needs the record for.
    const fail = async (sql: string) =>
      sql === "COMMIT"
        ? { ok: false as const, message: "TransactionContext Error: x" }
        : { ok: true as const, columns: [], rows: [] };
    vi.mocked(duck.runQuery).mockImplementation(fail);
    const out = await oneWrite();
    expect(out.ok).toBe(false);
    expect(out.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });

  it("reports an empty list when the rows never reached the engine", async () => {
    // `registerBuffer` failing is the one exit before any statement is sent.
    vi.mocked(duck.registerBuffer).mockResolvedValueOnce(false);
    const out = await oneWrite();
    expect(out.ok).toBe(false);
    expect(out.statements).toEqual([]);
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

describe("formatProvenance", () => {
  // Built from local parts on purpose: a UTC literal would make these
  // assertions pass only in the timezone they were written in.
  const at = new Date(2026, 8, 10, 14, 2).getTime();

  it("reads tool, summary and a local YYYY-MM-DD HH:mm stamp", () => {
    expect(
      cc.formatProvenance({
        runId: "r1",
        toolName: "Measure solids",
        summary: "LoD 2.2",
        at,
        partial: null,
        previous: null,
      }),
    ).toBe("Measure solids · LoD 2.2 · 2026-09-10 14:02");
  });

  it("names the earlier run for the rest of the layer when the run was partial", () => {
    expect(
      cc.formatProvenance({
        runId: "r2",
        toolName: "Measure solids",
        summary: "LoD 2.2",
        at,
        partial: { count: 312, total: 1204 },
        previous: {
          runId: "r1",
          toolName: "Measure solids",
          summary: "LoD 1.2",
          at: new Date(2026, 8, 10, 13, 40).getTime(),
          partial: null,
          previous: null,
        },
      }),
    ).toBe(
      "Measure solids · LoD 2.2 · 2026-09-10 14:02 · 312 of 1,204 buildings in this run; the rest from Measure solids · 13:40",
    );
  });

  it("dates the earlier run in full when it was not on the same day", () => {
    expect(
      cc.formatProvenance({
        runId: "r2",
        toolName: "Height from extent",
        summary: "",
        at,
        partial: { count: 2, total: 4 },
        previous: {
          runId: "r1",
          toolName: "Height from extent",
          summary: "",
          at: new Date(2026, 8, 9, 13, 40).getTime(),
          partial: null,
          previous: null,
        },
      }),
    ).toBe(
      "Height from extent · 2026-09-10 14:02 · 2 of 4 buildings in this run; the rest from Height from extent · 2026-09-09 13:40",
    );
  });

  it("says only what it knows when a partial run replaced nothing", () => {
    // `runQueue` writes `previous: null` for a layer's first partial run:
    // there is no earlier tool to name, and the rest of the layer is unset.
    expect(
      cc.formatProvenance({
        runId: "r1",
        toolName: "Height from extent",
        summary: "Matching · 312 buildings",
        at,
        partial: { count: 312, total: 1204 },
        previous: null,
      }),
    ).toBe(
      "Height from extent · Matching · 312 buildings · 2026-09-10 14:02 · 312 of 1,204 buildings in this run",
    );
  });
});
