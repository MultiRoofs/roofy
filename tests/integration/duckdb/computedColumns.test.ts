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
  buildDropColumnSql,
  buildNullifySql,
  buildRestoreSql,
  buildUpdateFromValuesSql,
  type OutputColumn,
} from "../../../src/insights/computedColumns";
import {
  buildCountSql,
  buildMedianSql,
  buildMostFrequentSql,
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
        buildUpdateFromValuesSql(TABLE, file, COLUMNS),
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
        buildUpdateFromValuesSql(TABLE, file, COLUMNS),
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
          buildUpdateFromValuesSql(TABLE, file, [
            { name: "EXTENT_height_m", type: "DOUBLE" },
          ]),
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
    /**
     * Builds a values file, reports what `read_json_auto` INFERS for it, and
     * assigns it into a DOUBLE column through the app's UPDATE.
     *
     * The two halves came apart at finding D9: the app's UPDATE now reads the
     * file at its DECLARED types (`read_json` with `columns=`), so what is
     * inferred no longer decides what is written. The inference is still
     * pinned — it is the fact the architecture note carries, and `layerRows`
     * and the flat fallback still depend on `read_json_auto` — and the write
     * assertions below now say what the TYPED read does with the same bytes.
     */
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
        buildUpdateFromValuesSql(table, file, [
          { name: "extent_height_m", type: "DOUBLE" },
        ]),
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
        attempt(
          buildUpdateFromValuesSql(TABLE, file, [
            { name: "extent_height_m", type: "DOUBLE" },
          ]),
        ).ok,
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

  describe("probe 5: the Style-by-result modal value over root rows", () => {
    /**
     * The §7.5 fixture, built twice in opposite insertion orders.
     *
     * Four ROOTS carry a value — `'A'` once, `'B'` once, and two NULLs — so the
     * two real values are TIED. Three PARTS of the first feature carry `'Z'`,
     * which is the most frequent string in the table and must not be the
     * answer: a building with three parts modelled cannot outvote one with
     * none (§7, "copied to root and parts alike").
     */
    const ROWS = [
      "('b1', 'b1', 'A')",
      "('b1-1', 'b1', 'Z')",
      "('b1-2', 'b1', 'Z')",
      "('b1-3', 'b1', 'Z')",
      "('b2', 'b2', 'B')",
      "('b3', NULL, NULL)",
      "('b4', 'b4', NULL)",
    ];

    const create = (table: string, rows: ReadonlyArray<string>): void => {
      db.query(
        `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS
           SELECT "id", "feature_id", CAST("v" AS VARCHAR) AS "zones_name"
           FROM (VALUES ${rows.join(", ")}) AS t("id", "feature_id", "v")`,
      );
    };

    it("breaks a tie on the LOWEST value, ignoring NULLs and non-root rows", () => {
      // `'Z'` is the most frequent string in the table and loses because it is
      // only on parts; NULL is the most frequent ROOT value and loses because
      // a NULL prefilled into a rule is a condition that matches nothing; `'A'`
      // and `'B'` are tied among the roots and the LOWER one wins, which is
      // what makes the answer a function of the data rather than of the engine.
      create("layer_cc6", ROWS);
      expect(db.query(buildMostFrequentSql("layer_cc6", "zones_name"))).toEqual(
        [{ m: "A" }],
      );
    });

    it("gives the same answer when the same rows are inserted in reverse", () => {
      // The tie-break is deterministic or it is not a tie-break: an unordered
      // `mode()` may answer with whichever row it met first, so the same data
      // re-read after a table rebuild could prefill a different threshold into
      // the user's rule with nothing on screen to explain it.
      create("layer_cc7", [...ROWS].reverse());
      expect(db.query(buildMostFrequentSql("layer_cc7", "zones_name"))).toEqual(
        [{ m: "A" }],
      );
    });

    it("prefers the more FREQUENT value over the alphabetically lower one", () => {
      // The other half of the ordering: `"n" DESC` comes first, so this is a
      // modal value with a tie-break and not an alphabetical minimum. Two roots
      // say `'B'` against one `'A'`, and `'B'` wins.
      create("layer_cc8", [
        "('b1', 'b1', 'A')",
        "('b2', 'b2', 'B')",
        "('b3', 'b3', 'B')",
      ]);
      expect(db.query(buildMostFrequentSql("layer_cc8", "zones_name"))).toEqual(
        [{ m: "B" }],
      );
    });
  });
  describe("probe 6: the write preserves the DECLARED column types", () => {
    /**
     * §7.5's "copied values keep their type", at the write.
     *
     * The values file is a document the APP just built out of columns whose
     * types the run already declared, so nothing about it needs inferring — and
     * inference is not merely redundant here, it is wrong: JSON's sample is
     * 20,480 rows, and a VARCHAR column whose first value appears after it is
     * read back as JSON, which renders a string WITH ITS QUOTES. A join whose
     * first 20,480 buildings fall outside every area would then write the
     * two-character value `""` into every empty zone name.
     */
    function write(
      label: string,
      columns: ReadonlyArray<OutputColumn>,
      rows: ReadonlyArray<Record<string, unknown>>,
    ): { readonly table: string; readonly write: Attempt } {
      const table = `layer_cc9_${label}`;
      const file = `__vals_${label}.json`;
      makeTable(
        table,
        rows.map((r) => String(r.id)),
      );
      db.registerBytes(file, encodeValues(rows));
      const out = attemptAll([
        "BEGIN TRANSACTION",
        ...columns.map((c) => buildAddColumnSql(table, c)),
        buildUpdateFromValuesSql(table, file, columns),
        "COMMIT",
      ]);
      if (!out.ok) {
        attempt("ROLLBACK");
        console.log(`[cc] probe 5/${label} REFUSED: ${out.message}`);
      }
      db.dropFile(file);
      return { table, write: out };
    }

    it("stores TEXT that first appears past the sample size as itself, unquoted", () => {
      const columns: ReadonlyArray<OutputColumn> = [
        { name: "zones_name", type: "VARCHAR" },
      ];
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        rows.push({ id: `b${i}`, zones_name: null });
      }
      // The empty string is the one that exposes the defect most plainly — a
      // JSON-typed read renders it as two quotation marks — and the non-empty
      // one shows the same rendering with content in it.
      rows.push({ id: `b${SAMPLE_SIZE}`, zones_name: "" });
      rows.push({ id: `b${SAMPLE_SIZE + 1}`, zones_name: "Centrum" });
      const out = write("latetext", columns, rows);
      expect(out.write.ok).toBe(true);
      expect(
        db.query(
          `SELECT "id", "zones_name" FROM ${quoteIdent(out.table)} WHERE "id" IN ('b${SAMPLE_SIZE}', 'b${SAMPLE_SIZE + 1}') ORDER BY "id"`,
        ),
      ).toEqual([
        { id: `b${SAMPLE_SIZE}`, zones_name: "" },
        { id: `b${SAMPLE_SIZE + 1}`, zones_name: "Centrum" },
      ]);
      // And the NULLs before it are still NULL, not the string "null".
      expect(
        db.query(
          `SELECT COUNT(*) AS n FROM ${quoteIdent(out.table)} WHERE "zones_name" IS NULL`,
        ),
      ).toEqual([{ n: SAMPLE_SIZE }]);
    });

    it("stores an early empty string and a quote-bearing one as themselves", () => {
      const columns: ReadonlyArray<OutputColumn> = [
        { name: "zones_name", type: "VARCHAR" },
      ];
      const out = write("text", columns, [
        { id: "b1", zones_name: "" },
        { id: "b2", zones_name: 'He said "hi"' },
        { id: "b3", zones_name: null },
        // A nested object arrives from §7.5's copy as JSON TEXT already.
        { id: "b4", zones_name: '{"k":1}' },
      ]);
      expect(out.write.ok).toBe(true);
      expect(
        db.query(
          `SELECT "id", "zones_name" FROM ${quoteIdent(out.table)} ORDER BY "id"`,
        ),
      ).toEqual([
        { id: "b1", zones_name: "" },
        { id: "b2", zones_name: 'He said "hi"' },
        { id: "b3", zones_name: null },
        { id: "b4", zones_name: '{"k":1}' },
      ]);
    });

    it("keeps DOUBLE and BOOLEAN columns typed, sample or no sample", () => {
      const columns: ReadonlyArray<OutputColumn> = [
        { name: "zones_noise", type: "DOUBLE" },
        { name: "solid_valid", type: "BOOLEAN" },
      ];
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        rows.push({ id: `b${i}`, zones_noise: null, solid_valid: null });
      }
      rows.push({
        id: `b${SAMPLE_SIZE}`,
        zones_noise: 62.5,
        solid_valid: false,
      });
      const out = write("latenumber", columns, rows);
      expect(out.write.ok).toBe(true);
      expect(
        db.query(
          `SELECT "zones_noise", "solid_valid" FROM ${quoteIdent(out.table)} WHERE "id" = 'b${SAMPLE_SIZE}'`,
        ),
      ).toEqual([{ zones_noise: 62.5, solid_valid: false }]);
    });

    it("takes a column name that needs quoting in the columns= list", () => {
      // Output names are slugified, but the TABLE's own spelling wins
      // (`canonicalise`), and a file's column can be anything.
      const columns: ReadonlyArray<OutputColumn> = [
        { name: 'odd "name"', type: "VARCHAR" },
      ];
      const out = write("oddname", columns, [{ id: "b1", 'odd "name"': "x" }]);
      expect(out.write.ok).toBe(true);
      expect(
        db.query(
          `SELECT ${quoteIdent('odd "name"')} AS v FROM ${quoteIdent(out.table)}`,
        ),
      ).toEqual([{ v: "x" }]);
    });
  });
  /**
   * Finding S2, against the engine: a REPLACED column whose declared type has
   * changed is migrated inside the write's transaction, and Undo puts the
   * original type AND the original values back.
   *
   * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is the reason this is needed at
   * all — it is a no-op on a column that already exists, TYPE included — and
   * the first case pins that on the real engine rather than assuming it.
   */
  describe("probe 7: a replaced column whose TYPE changed (S2)", () => {
    /** The migration the write issues, and the state it leaves. */
    function migrate(
      table: string,
      backup: string,
      columns: ReadonlyArray<OutputColumn>,
      migrated: ReadonlyArray<{ readonly name: string; readonly type: string }>,
      rows: ReadonlyArray<Record<string, unknown>>,
    ): Attempt {
      const file = `__vals_${backup}.json`;
      db.registerBytes(file, encodeValues(rows));
      const out = attemptAll([
        "BEGIN TRANSACTION",
        // The WHOLE column, not the scoped rows: a DROP loses every row's value.
        buildBackupSql(
          table,
          backup,
          columns.map((c) => c.name),
          null,
        ),
        ...migrated.map((c) => buildDropColumnSql(table, c.name)),
        ...columns.map((c) => buildAddColumnSql(table, c)),
        buildUpdateFromValuesSql(table, file, columns),
        "COMMIT",
      ]);
      if (!out.ok) attempt("ROLLBACK");
      db.dropFile(file);
      return out;
    }

    it("proves ADD COLUMN IF NOT EXISTS does NOT change an existing type", () => {
      // The bug, on the engine: without a DROP the column stays DOUBLE, and
      // `true` lands in it as 1.0 while the model attribute the same run
      // publishes holds `true`.
      makeTable("layer_s2a", ["b1"]);
      db.query(`ALTER TABLE "layer_s2a" ADD COLUMN "solid_valid" DOUBLE`);
      db.query(
        buildAddColumnSql("layer_s2a", {
          name: "solid_valid",
          type: "BOOLEAN",
        }),
      );
      expect(tableTypes("layer_s2a")["solid_valid"]).toBe("DOUBLE");
      const file = "__vals_s2a.json";
      db.registerBytes(file, encodeValues([{ id: "b1", solid_valid: true }]));
      db.query(
        buildUpdateFromValuesSql("layer_s2a", file, [
          { name: "solid_valid", type: "BOOLEAN" },
        ]),
      );
      db.dropFile(file);
      expect(db.query(`SELECT "solid_valid" AS v FROM "layer_s2a"`)).toEqual([
        { v: 1 },
      ]);
    });

    it("migrates DOUBLE to BOOLEAN, and Undo restores both type and values", () => {
      makeTable("layer_s2b", ["b1", "b2"]);
      db.query(`ALTER TABLE "layer_s2b" ADD COLUMN "solid_valid" DOUBLE`);
      db.query(
        `UPDATE "layer_s2b" SET "solid_valid" = CASE WHEN "id" = 'b1' THEN 2178.0 ELSE 42.0 END`,
      );
      const columns: ReadonlyArray<OutputColumn> = [
        { name: "solid_valid", type: "BOOLEAN" },
      ];
      // Only b1 is in scope; b2's old value is what the whole-column backup is
      // for.
      expect(
        migrate(
          "layer_s2b",
          "__undo_s2b",
          columns,
          [{ name: "solid_valid", type: "DOUBLE" }],
          [{ id: "b1", solid_valid: true }],
        ).ok,
      ).toBe(true);
      expect(tableTypes("layer_s2b")["solid_valid"]).toBe("BOOLEAN");
      expect(
        db.query(
          `SELECT "id", "solid_valid" AS v FROM "layer_s2b" ORDER BY "id"`,
        ),
      ).toEqual([
        { id: "b1", v: true },
        // Out of scope, and the column is a new one: NULL, not 42.
        { id: "b2", v: null },
      ]);

      // Undo: the schema back first, THEN the values.
      expect(
        attemptAll([
          "BEGIN TRANSACTION",
          buildDropColumnSql("layer_s2b", "solid_valid"),
          buildAddColumnSql("layer_s2b", {
            name: "solid_valid",
            type: "DOUBLE" as const,
          }),
          buildRestoreSql("layer_s2b", "__undo_s2b", ["solid_valid"]),
          `DROP TABLE IF EXISTS "__undo_s2b"`,
          "COMMIT",
        ]).ok,
      ).toBe(true);
      expect(tableTypes("layer_s2b")["solid_valid"]).toBe("DOUBLE");
      expect(
        db.query(
          `SELECT "id", "solid_valid" AS v FROM "layer_s2b" ORDER BY "id"`,
        ),
      ).toEqual([
        { id: "b1", v: 2178 },
        // The whole-column backup is what gets this one back.
        { id: "b2", v: 42 },
      ]);
    });

    it("migrates the OTHER way too, DOUBLE from BOOLEAN, and back to VARCHAR", () => {
      // Both directions the review names, on one table: a BOOLEAN column
      // replaced by a DOUBLE one, then that DOUBLE replaced by VARCHAR text.
      makeTable("layer_s2c", ["b1"]);
      db.query(`ALTER TABLE "layer_s2c" ADD COLUMN "zones_name" BOOLEAN`);
      db.query(`UPDATE "layer_s2c" SET "zones_name" = true`);
      expect(
        migrate(
          "layer_s2c",
          "__undo_s2c1",
          [{ name: "zones_name", type: "DOUBLE" }],
          [{ name: "zones_name", type: "BOOLEAN" }],
          [{ id: "b1", zones_name: 62.5 }],
        ).ok,
      ).toBe(true);
      expect(tableTypes("layer_s2c")["zones_name"]).toBe("DOUBLE");
      expect(db.query(`SELECT "zones_name" AS v FROM "layer_s2c"`)).toEqual([
        { v: 62.5 },
      ]);

      expect(
        migrate(
          "layer_s2c",
          "__undo_s2c2",
          [{ name: "zones_name", type: "VARCHAR" }],
          [{ name: "zones_name", type: "DOUBLE" }],
          [{ id: "b1", zones_name: "Centrum" }],
        ).ok,
      ).toBe(true);
      expect(tableTypes("layer_s2c")["zones_name"]).toBe("VARCHAR");
      // Unquoted, which is finding D9's whole point, and typed as text rather
      // than as the DOUBLE the column used to be.
      expect(db.query(`SELECT "zones_name" AS v FROM "layer_s2c"`)).toEqual([
        { v: "Centrum" },
      ]);
    });

    it("would REFUSE the text write without the migration", () => {
      // Why the migration is not cosmetic: assigning 'Centrum' into the DOUBLE
      // column the ADD left alone is a conversion the engine rejects, and the
      // whole transaction fails with it.
      makeTable("layer_s2d", ["b1"]);
      db.query(`ALTER TABLE "layer_s2d" ADD COLUMN "zones_name" DOUBLE`);
      const file = "__vals_s2d.json";
      db.registerBytes(
        file,
        encodeValues([{ id: "b1", zones_name: "Centrum" }]),
      );
      const out = attempt(
        buildUpdateFromValuesSql("layer_s2d", file, [
          { name: "zones_name", type: "VARCHAR" },
        ]),
      );
      db.dropFile(file);
      expect(out.ok).toBe(false);
      expect(out.message).toMatch(/Conversion|Could not convert/i);
    });
  });
});
