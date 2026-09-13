// @vitest-environment node
/**
 * The processing toolbox's WRITE-BACK, run against a REAL DuckDB 1.5.5.
 *
 * Three questions the unit tests cannot answer, owed by the Task 8 review
 * ruling of the processing-toolbox milestone (M13.1). Every one of them is a
 * question about the ENGINE, not about the strings the app builds:
 *
 *  1. Is `ALTER TABLE … ADD COLUMN` followed by `UPDATE … FROM
 *     read_json_auto(<file>)` accepted inside ONE transaction? (`sqlite` and
 *     several engines refuse DDL in a transaction; if DuckDB does, the ruling
 *     is to move the ALTERs outside and keep backup + UPDATE inside.)
 *  2. What does `read_json_auto` INFER for the value files
 *     `writeComputedColumns` registers — an output column that is NULL in
 *     every row, a BigInt the replacer stringified, a whole-number double —
 *     and does the inferred type assign into a DOUBLE column?
 *  3. Do the table panel's own reads (`buildCountSql`, `buildPageSql`) still
 *     answer while the write transaction is open on the same connection, and
 *     does the transaction still commit?
 *
 * Opt-in, exactly like `layerTables.test.ts`:
 * `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 *
 * Every statement comes from the app's OWN builders — `computedColumns.ts` for
 * the write, `sql.ts` for the reads. A test that re-spelled the SQL would only
 * prove that the test's SQL works.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { Harness } from "./harness";
import {
  buildAddColumnSql,
  buildBackupSql,
  buildNullifySql,
  buildRestoreSql,
  buildUpdateFromValuesSql,
  type OutputColumn,
} from "../../../src/insights/computedColumns";
import {
  buildCountSql,
  buildMedianSql,
  buildPageSql,
  quoteIdent,
} from "../../../src/insights/sql";
import { classifyColumnType } from "../../../src/insights/columnKind";

/**
 * `computedColumns.ts` and `sql.ts` are imported for their PURE builders, but
 * the first one's module scope imports `insights/duckdb`, which imports the
 * BROWSER bundle of `@duckdb/duckdb-wasm`. This suite talks to the node
 * bindings through the harness, and the default offline run collects this file
 * before skipping it — so the engine seam is stubbed out entirely and every
 * stub throws, because nothing here may reach one.
 */
vi.mock("../../../src/insights/duckdb", () => {
  const unreachable = () => {
    throw new Error("this suite talks to the harness, not to insights/duckdb");
  };
  return {
    initDuckDB: unreachable,
    subscribeDuckDBStatus: () => () => {},
    getDuckDBStatusVersion: () => 0,
    getEngineGeneration: () => 1,
    onEngineDeath: () => () => {},
    getDuckDBStatus: unreachable,
    isExtensionLoaded: unreachable,
    ensureExtension: unreachable,
    formatDuckDBError: unreachable,
    queryDuckDB: unreachable,
    queryParquetBuffer: unreachable,
    runQuery: unreachable,
    ddl: unreachable,
    registerBuffer: unreachable,
    dropBuffer: unreachable,
    readFile: unreachable,
  };
});

const enabled = process.env.DUCKDB_INTEGRATION === "1";

/** `read_json_auto`'s documented default sample size. Probe 2 straddles it. */
const SAMPLE_SIZE = 20_480;

/** The app's own replacer, from `writeComputedColumns`: a BIGINT arriving from
 *  an upstream table is a `BigInt`, which `JSON.stringify` refuses outright. */
function encodeValues(
  rows: ReadonlyArray<Record<string, unknown>>,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

describe.skipIf(!enabled)("computed columns against real DuckDB", () => {
  let db: Harness;

  /** What a statement did: the engine's own message on a refusal. */
  interface Attempt {
    readonly ok: boolean;
    readonly message: string;
  }

  function attempt(sql: string): Attempt {
    try {
      db.query(sql);
      return { ok: true, message: "" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Runs a statement list, stopping at the first refusal. After a thrown
   *  statement DuckDB marks the transaction aborted, so the caller ROLLBACKs. */
  function attemptAll(statements: ReadonlyArray<string>): Attempt {
    for (const sql of statements) {
      const out = attempt(sql);
      if (!out.ok) return out;
    }
    return { ok: true, message: "" };
  }

  /** `DESCRIBE` over a values file: what `read_json_auto` INFERRED, which is
   *  the fact the architecture notes want, not just accepted/refused. */
  function inferred(file: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of db.query(
      `DESCRIBE SELECT * FROM read_json_auto('${file}')`,
    )) {
      out[String(row.column_name)] = String(row.column_type);
    }
    return out;
  }

  function tableTypes(table: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of db.query(`DESCRIBE ${quoteIdent(table)}`)) {
      out[String(row.column_name)] = String(row.column_type);
    }
    return out;
  }

  /** A tiny stand-in for a layer table: `id` VARCHAR, as every layer table has. */
  function makeTable(table: string, ids: ReadonlyArray<string>): void {
    const values = ids.map((id) => `('${id}')`).join(", ");
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM (VALUES ${values}) AS t("id")`,
    );
  }

  beforeAll(async () => {
    // DYNAMIC, inside `beforeAll`, for the same reason `layerTables.test.ts`
    // does it: the default offline run collects this file and only
    // `describe.skipIf` keeps it from executing.
    const started = Date.now();
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    console.log(`[cc] engine ready in ${Date.now() - started} ms`);
  }, 180_000);

  afterAll(() => {
    db?.close();
  });

  describe("probe 1: ALTER then UPDATE inside one transaction", () => {
    const TABLE = "layer_cc1";
    const COLUMNS: ReadonlyArray<OutputColumn> = [
      { name: "extent_height_m", type: "DOUBLE" },
      { name: "extent_zmin_m", type: "DOUBLE" },
      { name: "extent_zmax_m", type: "DOUBLE" },
    ];
    const NAMES = COLUMNS.map((c) => c.name);

    it("accepts BEGIN → ALTER … ADD COLUMN → UPDATE … FROM read_json_auto → COMMIT", () => {
      makeTable(TABLE, ["b1", "b2"]);
      const file = "__vals_p1.json";
      db.registerBytes(
        file,
        encodeValues([
          {
            id: "b1",
            extent_height_m: 7.5,
            extent_zmin_m: 1.5,
            extent_zmax_m: 9,
          },
          {
            id: "b2",
            extent_height_m: 3.25,
            extent_zmin_m: 0.5,
            extent_zmax_m: 3.75,
          },
        ]),
      );

      const out = attemptAll([
        "BEGIN TRANSACTION",
        ...COLUMNS.map((c) => buildAddColumnSql(TABLE, c)),
        buildUpdateFromValuesSql(TABLE, file, NAMES),
        "COMMIT",
      ]);
      if (!out.ok) {
        attempt("ROLLBACK");
        console.log(`[cc] probe 1 REFUSED: ${out.message}`);
      }
      expect(out).toEqual({ ok: true, message: "" });

      const types = tableTypes(TABLE);
      expect(types.extent_height_m).toBe("DOUBLE");
      expect(classifyColumnType(String(types.extent_height_m))).toBe("scalar");
      const rows = db.query(
        `SELECT "id", "extent_height_m" FROM ${quoteIdent(TABLE)} ORDER BY "id"`,
      );
      expect(rows).toEqual([
        { id: "b1", extent_height_m: 7.5 },
        { id: "b2", extent_height_m: 3.25 },
      ]);
      db.dropFile(file);
    });

    it("accepts the second run's CREATE TABLE AS backup in the same transaction, and the restore undoes it", () => {
      // The table already carries the three columns from the first test, so
      // this is the app's `existing`-non-empty path: backup CTAS + ALTER (a
      // no-op through IF NOT EXISTS) + UPDATE, all inside one transaction.
      const file = "__vals_p1b.json";
      const backup = "__undo_p1b";
      db.registerBytes(
        file,
        encodeValues([
          {
            id: "b1",
            extent_height_m: 99.5,
            extent_zmin_m: 0,
            extent_zmax_m: 99.5,
          },
        ]),
      );
      const out = attemptAll([
        "BEGIN TRANSACTION",
        buildBackupSql(TABLE, backup, NAMES, ["b1"]),
        ...COLUMNS.map((c) => buildAddColumnSql(TABLE, c)),
        buildUpdateFromValuesSql(TABLE, file, NAMES),
        "COMMIT",
      ]);
      if (!out.ok) {
        attempt("ROLLBACK");
        console.log(`[cc] probe 1 (replace) REFUSED: ${out.message}`);
      }
      expect(out).toEqual({ ok: true, message: "" });
      expect(
        db.query(
          `SELECT "extent_height_m" FROM ${quoteIdent(TABLE)} WHERE "id" = 'b1'`,
        ),
      ).toEqual([{ extent_height_m: 99.5 }]);

      // Undo, through the app's own restore + drop-column sequence.
      const undo = attemptAll([
        "BEGIN TRANSACTION",
        buildRestoreSql(TABLE, backup, NAMES),
        `DROP TABLE IF EXISTS ${quoteIdent(backup)}`,
        "COMMIT",
      ]);
      if (!undo.ok) attempt("ROLLBACK");
      expect(undo).toEqual({ ok: true, message: "" });
      expect(
        db.query(
          `SELECT "extent_height_m" FROM ${quoteIdent(TABLE)} ORDER BY "id"`,
        ),
      ).toEqual([{ extent_height_m: 7.5 }, { extent_height_m: 3.25 }]);

      // And the created-column half of Undo: DROP COLUMN, then the nullify
      // path over what is left.
      const drop = attemptAll([
        "BEGIN TRANSACTION",
        ...NAMES.slice(1).map(
          (c) =>
            `ALTER TABLE ${quoteIdent(TABLE)} DROP COLUMN IF EXISTS ${quoteIdent(c)}`,
        ),
        buildNullifySql(TABLE, [NAMES[0] as string], ["b1"]),
        "COMMIT",
      ]);
      if (!drop.ok) attempt("ROLLBACK");
      expect(drop).toEqual({ ok: true, message: "" });
      expect(Object.keys(tableTypes(TABLE))).toEqual(["id", "extent_height_m"]);
      db.dropFile(file);
    });
  });

  describe("probe 1c: identifiers differing only in case", () => {
    const TABLE = "layer_cc1c";

    it("adds nothing for a differently-cased name and updates the column there", () => {
      // The premise `runQueue.canonicalise` rests on. DuckDB matches
      // identifiers WITHOUT regard to case, so a second run whose prefix is
      // typed "EXTENT_" neither creates a column nor writes a second one: the
      // ALTER is a no-op and the UPDATE lands on `extent_height_m`. The app's
      // own keys are exact strings, which is why the run resolves its output
      // names to the table's spelling before any of this.
      makeTable(TABLE, ["b1", "b2"]);
      const file = "__vals_cc1c.json";
      db.registerBytes(
        file,
        encodeValues([
          { id: "b1", EXTENT_height_m: 7.5 },
          { id: "b2", EXTENT_height_m: 9.5 },
        ]),
      );
      expect(
        attemptAll([
          buildAddColumnSql(TABLE, {
            name: "extent_height_m",
            type: "DOUBLE",
          }),
          buildAddColumnSql(TABLE, {
            name: "EXTENT_height_m",
            type: "DOUBLE",
          }),
          buildUpdateFromValuesSql(TABLE, file, ["EXTENT_height_m"]),
        ]).ok,
      ).toBe(true);

      // ONE column, under the spelling the first ALTER gave it.
      expect(
        db.query(`DESCRIBE ${quoteIdent(TABLE)}`).map((r) => r.column_name),
      ).toEqual(["id", "extent_height_m"]);
      expect(
        db.query(
          `SELECT "extent_height_m" FROM ${quoteIdent(TABLE)} ORDER BY "id"`,
        ),
      ).toEqual([{ extent_height_m: 7.5 }, { extent_height_m: 9.5 }]);
      db.dropFile(file);
    });
  });

  describe("probe 2: read_json_auto inference", () => {
    /** Builds a values file, reports what was inferred, and tries to assign it
     *  into a DOUBLE column through the app's UPDATE. */
    function assignInto(
      label: string,
      rows: ReadonlyArray<Record<string, unknown>>,
    ): { readonly inferred: Record<string, string>; readonly write: Attempt } {
      const table = `layer_cc2_${label}`;
      const file = `__vals_${label}.json`;
      makeTable(
        table,
        rows.map((r) => String(r.id)),
      );
      db.registerBytes(file, encodeValues(rows));
      const types = inferred(file);
      const write = attemptAll([
        "BEGIN TRANSACTION",
        buildAddColumnSql(table, { name: "extent_height_m", type: "DOUBLE" }),
        buildUpdateFromValuesSql(table, file, ["extent_height_m"]),
        "COMMIT",
      ]);
      if (!write.ok) attempt("ROLLBACK");
      console.log(
        `[cc] probe 2/${label}: inferred ${JSON.stringify(types)} → ${
          write.ok ? "accepted" : `REFUSED: ${write.message}`
        }`,
      );
      return { inferred: types, write };
    }

    function heightOf(label: string, id: string): unknown {
      const rows = db.query(
        `SELECT "extent_height_m" FROM ${quoteIdent(`layer_cc2_${label}`)} WHERE "id" = '${id}'`,
      );
      return rows[0]?.extent_height_m;
    }

    it("(a) a column that is NULL in every row assigns into DOUBLE and lands as NULL", () => {
      const rows = [
        { id: "b1", extent_height_m: null },
        { id: "b2", extent_height_m: null },
      ];
      const { inferred: types, write } = assignInto("allnull", rows);
      expect(write.ok).toBe(true);
      expect(heightOf("allnull", "b1")).toBeNull();
      // PINNED, now that the probe has answered: `JSON`, not `SQLNULL`. The
      // architecture note carries this, and a duckdb-wasm bump that changed it
      // has to say so here first.
      expect(types.extent_height_m).toBe("JSON");
    });

    it("(a-big) an all-NULL column past the sample size still assigns into DOUBLE", () => {
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < SAMPLE_SIZE + 1; i++) {
        rows.push({ id: `b${i}`, extent_height_m: null });
      }
      const { write } = assignInto("allnullbig", rows);
      expect(write.ok).toBe(true);
      expect(heightOf("allnullbig", "b0")).toBeNull();
    });

    it("(a-late) a column NULL through the whole sample with a double just past it", () => {
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        rows.push({ id: `b${i}`, extent_height_m: null });
      }
      rows.push({ id: `b${SAMPLE_SIZE}`, extent_height_m: 12.5 });
      const { inferred: types, write } = assignInto("latedouble", rows);
      console.log(
        `[cc] probe 2/latedouble: ${JSON.stringify(types)}, ok=${write.ok}, msg=${write.message}`,
      );
      // There is no sample-size cliff for the all-NULL case: `JSON` absorbs the
      // late value rather than the sample fixing the column to NULL. A tool
      // whose first 20,480 features have no value depends on this.
      expect(types.extent_height_m).toBe("JSON");
      expect(write.ok).toBe(true);
      expect(heightOf("latedouble", `b${SAMPLE_SIZE}`)).toBe(12.5);
    });

    it("(b) a BigInt stringified by the replacer, assigned into DOUBLE", () => {
      const rows = [
        { id: "b1", extent_height_m: 12345678901234567890n },
        { id: "b2", extent_height_m: 42n },
      ];
      const { inferred: types, write } = assignInto("bigint", rows);
      console.log(
        `[cc] probe 2/bigint: inferred ${JSON.stringify(types)}, ok=${write.ok}, msg=${write.message}`,
      );
      // The replacer's string is inferred VARCHAR and casts implicitly — the
      // write never fails. What it costs is precision: the value comes back as
      // the DOUBLE nearest to it, which no DOUBLE column could have held
      // anyway. Pinned so a bump that started REFUSING the cast is caught here.
      expect(types.extent_height_m).toBe("VARCHAR");
      expect(write.ok).toBe(true);
      expect(heightOf("bigint", "b1")).toBe(12345678901234567000);
      expect(heightOf("bigint", "b2")).toBe(42);
    });

    it("(b-big) the same BigInt-as-string past the sample size", () => {
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        rows.push({ id: `b${i}`, extent_height_m: 1.5 });
      }
      rows.push({
        id: `b${SAMPLE_SIZE}`,
        extent_height_m: 12345678901234567890n,
      });
      const { inferred: types, write } = assignInto("bigintbig", rows);
      console.log(
        `[cc] probe 2/bigintbig: inferred ${JSON.stringify(types)}, ok=${write.ok}, msg=${write.message}`,
      );
      // Past the sample the inference flips to DOUBLE, and the one string
      // outside it still casts rather than landing as NULL — which is what
      // matters: a silent NULL there would be data loss nothing warns about.
      expect(types.extent_height_m).toBe("DOUBLE");
      expect(write.ok).toBe(true);
      expect(heightOf("bigintbig", `b${SAMPLE_SIZE}`)).toBe(
        12345678901234567000,
      );
      expect(heightOf("bigintbig", "b0")).toBe(1.5);
    });

    it("(c) whole-number heights infer an integer type and still assign into DOUBLE", () => {
      const rows = [
        { id: "b1", extent_height_m: 12 },
        { id: "b2", extent_height_m: 7 },
      ];
      const { inferred: types, write } = assignInto("wholenumbers", rows);
      expect(write.ok).toBe(true);
      expect(heightOf("wholenumbers", "b1")).toBe(12);
      // Heights are often whole numbers, and JSON gives DuckDB no reason to
      // read 12 as a double. BIGINT into a DOUBLE column is fine; pinned so a
      // bump that inferred something narrower (and overflowed) is caught.
      expect(types.extent_height_m).toBe("BIGINT");
    });
  });

  describe("probe 3: the panel's reads inside the open write transaction", () => {
    const TABLE = "layer_cc3";

    it("answers COUNT and a page mid-transaction, and the transaction still commits", () => {
      makeTable(TABLE, ["b1", "b2", "b3"]);
      const file = "__vals_p3.json";
      db.registerBytes(
        file,
        encodeValues([
          { id: "b1", extent_height_m: 1.5 },
          { id: "b2", extent_height_m: 2.5 },
          { id: "b3", extent_height_m: 3.5 },
        ]),
      );

      expect(attempt("BEGIN TRANSACTION").ok).toBe(true);
      expect(
        attempt(
          buildAddColumnSql(TABLE, { name: "extent_height_m", type: "DOUBLE" }),
        ).ok,
      ).toBe(true);
      expect(
        attempt(buildUpdateFromValuesSql(TABLE, file, ["extent_height_m"])).ok,
      ).toBe(true);

      // The table panel's OWN two reads, before COMMIT. The node bindings are
      // blocking, so this is interleaved statements inside the open
      // transaction on ONE connection — which is exactly the app's shape (one
      // connection, runs serialised on the table FIFO, no other BEGIN user).
      const count = db.query(buildCountSql(TABLE, null));
      expect(count).toEqual([{ n: 3 }]);
      const page = db.query(
        buildPageSql(
          TABLE,
          [
            {
              name: "id",
              type: "VARCHAR",
              kind: classifyColumnType("VARCHAR"),
            },
            {
              name: "extent_height_m",
              type: "DOUBLE",
              kind: classifyColumnType("DOUBLE"),
            },
          ],
          null,
          { column: "id", dir: "asc" },
          0,
          50,
        ),
      );
      expect(page).toHaveLength(3);
      // The write is visible to its own transaction — the read is not blocked
      // and does not see a half-table.
      expect(page[0]).toEqual({ id: "b1", extent_height_m: 1.5 });

      expect(attempt("COMMIT").ok).toBe(true);
      expect(db.query(buildCountSql(TABLE, null))).toEqual([{ n: 3 }]);
      expect(
        db.query(
          `SELECT "extent_height_m" FROM ${quoteIdent(TABLE)} ORDER BY "id"`,
        ),
      ).toEqual([
        { extent_height_m: 1.5 },
        { extent_height_m: 2.5 },
        { extent_height_m: 3.5 },
      ]);
      db.dropFile(file);
    });
  });

  describe("probe 4: the Style-by-result median over root rows", () => {
    const TABLE = "layer_cc4";

    it("is the median of the FEATURES, not of the rows a part count weights", () => {
      // §7.3: a run copies a feature's value onto its root AND its parts. Two
      // buildings measured, 10 and 2 — but the first has three parts, so the
      // rows read 10, 10, 10, 10, 2 and the row median is 10: the value of the
      // bigger building, offered as the threshold that is supposed to split
      // them. The root-only median is 6, which is the median of what the user
      // measured and what §6.2's draft rule needs.
      //
      // `feature_id` as the reader writes it (a part carries its root's id, a
      // root its own), and the NULL a fallback table may carry for a root —
      // both branches of the predicate, in one table.
      // CAST to DOUBLE because that is what `writeComputedColumns` declares the
      // column as — and because an uncast `10.0` literal infers DECIMAL, whose
      // `median()` comes back from the bindings as a raw Uint32Array rather than
      // a number (measured here, DuckDB 1.5.5).
      db.query(
        `CREATE OR REPLACE TABLE ${quoteIdent(TABLE)} AS
           SELECT "id", "feature_id", CAST("h" AS DOUBLE) AS "extent_height_m"
           FROM (VALUES
             ('b1', 'b1', 10.0),
             ('b1-1', 'b1', 10.0),
             ('b1-2', 'b1', 10.0),
             ('b1-3', 'b1', 10.0),
             ('b2', NULL, 2.0)
           ) AS t("id", "feature_id", "h")`,
      );

      expect(
        db.query(
          `SELECT median("extent_height_m") AS m FROM ${quoteIdent(TABLE)}`,
        ),
      ).toEqual([{ m: 10 }]);
      expect(db.query(buildMedianSql(TABLE, "extent_height_m"))).toEqual([
        { m: 6 },
      ]);
    });

    it("reads a DECIMAL column back as a NUMBER through buildMedianSql", () => {
      // The M2 DECIMAL trap, against the real engine and through the BUILDER —
      // not through a hand-written `median(CAST(...))`, which would pass while
      // the builder went on emitting the uncast form. A joined column (§7.5)
      // carries the source's own type, and DuckDB hands a DECIMAL to JS as an
      // object.
      const DECIMAL_TABLE = "layer_cc5";
      db.query(
        `CREATE OR REPLACE TABLE ${quoteIdent(DECIMAL_TABLE)} AS
           SELECT "id", "feature_id", CAST("v" AS DECIMAL(18, 3)) AS "zones_rate"
           FROM (VALUES
             ('b1', 'b1', 1.5),
             ('b2', 'b2', 2.5),
             ('b3', 'b3', 9.5)
           ) AS t("id", "feature_id", "v")`,
      );
      const rows = db.query(buildMedianSql(DECIMAL_TABLE, "zones_rate"));
      expect(typeof rows[0]?.["m"]).toBe("number");
      expect(Number(rows[0]?.["m"])).toBeCloseTo(2.5, 6);
    });
  });
});
