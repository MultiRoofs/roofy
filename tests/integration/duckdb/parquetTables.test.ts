// @vitest-environment node
/**
 * A static CityParquet layer's table, built from the package's own Parquet by
 * the app's builders, against the real engine.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vp test run tests/integration/duckdb`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Harness } from "./harness";
import {
  isDroppedColumn,
  LOD_MARKER_PREFIX,
} from "../../../src/insights/columnKind";
import {
  buildOtherStructureSql,
  buildParquetTableSql,
  buildUnpackOtherSql,
} from "../../../src/insights/sql";

const enabled = process.env.DUCKDB_INTEGRATION === "1";

/** A package written by the extension's own writer, with three families
 *  whose attribute columns differ. */
const PACKAGE = resolve(
  process.cwd(),
  "packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/spec-columns-cityparquet",
);
const FAMILIES = ["building", "generics", "vegetation"];

describe.skipIf(!enabled)("a CityParquet package's table", () => {
  let db: Harness;

  function columns(table: string): string[] {
    return db.query(`DESCRIBE ${table}`).map((row) => String(row.column_name));
  }

  beforeAll(async () => {
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    for (const family of FAMILIES) {
      db.registerBytes(
        `pkg_${family}.parquet`,
        new Uint8Array(readFileSync(`${PACKAGE}/${family}.parquet`)),
      );
    }
  }, 180_000);

  afterAll(() => db?.close());

  it("reads every family into one table, without geometry, with the LoD markers", () => {
    db.query(
      buildParquetTableSql(
        "pkg_all",
        FAMILIES.map((f) => `pkg_${f}.parquet`),
      ),
    );
    const names = columns("pkg_all");
    for (const reserved of [
      "id",
      "feature_id",
      "object_type",
      "parents",
      "bbox",
    ]) {
      expect(names).toContain(reserved);
    }
    expect(names.filter(isDroppedColumn)).toEqual([]);
    expect(names).toContain(`${LOD_MARKER_PREFIX}geometry_lod2_2`);
    const [row] = db.query(`SELECT count(*) AS n FROM pkg_all`);
    expect(Number(row!.n)).toBe(3);
  });

  it("unpacks `other` into typed columns, and never over a column of the same name", () => {
    db.query(
      `CREATE TABLE pkg_other AS SELECT * FROM (VALUES ('a', 'x', '{"roofType":"flat","storeys":3,"ID":"clash"}'::JSON), ('b', 'y', NULL::JSON)) v(id, name, other)`,
    );
    const [structure] = db.query(buildOtherStructureSql("pkg_other"));
    const sql = buildUnpackOtherSql(
      "pkg_other",
      columns("pkg_other"),
      String(structure!.s),
    );
    expect(sql).not.toBeNull();
    db.query(sql!);
    const described = db.query("DESCRIBE pkg_other");
    const typeOf = (name: string) =>
      String(described.find((r) => r.column_name === name)?.column_type);
    expect(typeOf("roofType")).toBe("VARCHAR");
    expect(typeOf("storeys")).toBe("UBIGINT");
    // `ID` would have replaced `id`; it stays in `other`, which stays.
    expect(typeOf("other")).toBe("JSON");
    const rows = db.query(
      `SELECT id, "roofType", storeys::INTEGER AS storeys FROM pkg_other ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: "a", roofType: "flat", storeys: 3 },
      { id: "b", roofType: null, storeys: null },
    ]);
  });
});
