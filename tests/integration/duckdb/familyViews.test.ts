// @vitest-environment node
/**
 * A family's VIEW over a real CityParquet file, run against a REAL DuckDB
 * 1.5.5 — ruling R-B′'s SQL, statement for statement.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`.
 *
 * WHAT THIS SUITE CAN AND CANNOT COVER. The statements are the app's own
 * (`familyViews`'s `describeParquetSql` / `buildFamilyViewSql`, `columnKind`'s
 * drop rule, `sql.ts`'s builders), so what it proves about the SQL holds in the
 * browser. The REGISTRATION does not come this way: the node bindings have no
 * `registerFileURL` over HTTP and no `BROWSER_FILEREADER`, so the file is
 * registered as bytes and `read_parquet` reads that name instead. The two
 * registration doors were measured in a browser — see
 * `docs/performance/cityparquet-2026-09-21/duckdb-read-parquet-spike.json`.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness } from "./harness";
import {
  isDroppedColumn,
  type ColumnInfo,
} from "../../../src/insights/columnKind";
import {
  buildCountSql,
  buildPageSql,
  quoteIdent,
} from "../../../src/insights/sql";

/**
 * `familyViews` reaches DuckDB through `insights/duckdb`, whose module scope
 * imports the BROWSER bundle of duckdb-wasm — which has no business being
 * evaluated by a Node suite that talks to the node bindings. Only the module's
 * PURE exports are used here, so the engine seam is stubbed out entirely and
 * every stub throws.
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
    registerParquetUrl: unreachable,
    registerParquetFile: unreachable,
    dropRegisteredFile: unreachable,
    dropBuffer: unreachable,
    readFile: unreachable,
  };
});

const { buildFamilyViewSql, describeParquetSql, keptFamilyColumns } =
  await import("../../../src/insights/familyViews");

const enabled = process.env.DUCKDB_INTEGRATION === "1";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * The two-buildings CityParquet package, read from the PLUGIN submodule where
 * it is generated rather than copied into the app's `fixtures/`: one file, one
 * source of truth, and the app has the submodule checked out either way.
 */
const FIXTURE = resolve(
  here,
  "../../../packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet/building.parquet",
);

/** The registered name, exactly as `familyViews` mints one. */
const SOURCE = "family_1.parquet";
const VIEW = "layer_fv1";

describe.skipIf(!enabled)("a family view over a real CityParquet file", () => {
  let db: Harness;
  let described: Record<string, unknown>[];
  let kept: ColumnInfo[];

  beforeAll(async () => {
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    db.registerBytes(SOURCE, new Uint8Array(readFileSync(FIXTURE)));
    described = db.query(describeParquetSql(SOURCE));
    kept = keptFamilyColumns(described);
    db.query(buildFamilyViewSql(VIEW, SOURCE, kept));
  }, 180_000);

  afterAll(() => {
    db?.close();
  });

  it("keeps the file's identity and attribute columns, and only those", () => {
    // The file's own vocabulary already matches the app's flat one, which is
    // why no mapping layer exists: `id`/`feature_id`/`object_type`/`parents`/
    // `children`/`bbox` come straight through.
    // MEASURED against this fixture: 15 of its 24 columns survive, in the
    // file's own order — the same 15-of-37 ratio the real Yokohama building
    // table showed in the spike.
    expect(kept.map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "parents",
      "children",
      "children_roles",
      "address",
      "bbox",
      "other",
      "other_attributes",
      "measuredHeight",
      "roofType",
      "yearOfConstruction",
      "status",
      "function",
    ]);
    // Every dropped column really was in the file — a rule that dropped
    // nothing would pass a bare "contains" check.
    const all = described.map((row) => String(row.column_name));
    expect(all).toHaveLength(24);
    expect(all.filter(isDroppedColumn)).toEqual([
      "geometry_lod0_0",
      "geometry_properties_lod0_0",
      "material_lod0_0",
      "texture_lod0_0",
      "geometry_lod2_2",
      "geometry_properties_lod2_2",
      "material_lod2_2",
      "texture_lod2_2",
      "template",
    ]);
  });

  it("publishes the same columns as the VIEW, with no geometry among them", () => {
    const viewColumns = db
      .query(`DESCRIBE SELECT * FROM ${quoteIdent(VIEW)}`)
      .map((row) => String(row.column_name));
    expect(viewColumns).toEqual(kept.map((c) => c.name));
    expect(viewColumns.some((name) => name.startsWith("geometry"))).toBe(false);
    expect(viewColumns).not.toContain("template");
  });

  it("counts and pages exactly what the file holds", () => {
    const fromFile = db.query(
      `SELECT count(*) AS n FROM read_parquet('${SOURCE}')`,
    )[0]?.n;
    const fromView = db.query(buildCountSql(VIEW, null))[0]?.n;
    expect(Number(fromView)).toBe(Number(fromFile));
    // The fixture's three objects include a BuildingPart, so a reader that
    // published only roots would not satisfy this.
    expect(Number(fromView)).toBe(3);

    const page = db.query(buildPageSql(VIEW, kept, null, null, 0, 10));
    expect(page).toHaveLength(3);
    expect(page.map((row) => String(row.id))).toContain(
      "NL.IMBAG.Pand.0001-part1",
    );
  });

  it("answers a WHERE over an attribute", () => {
    const rows = db.query(
      `SELECT "id" FROM ${quoteIdent(VIEW)} WHERE "measuredHeight" > 5`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it("is idempotent: CREATE OR REPLACE over the live view is one statement", () => {
    db.query(buildFamilyViewSql(VIEW, SOURCE, kept));
    expect(Number(db.query(buildCountSql(VIEW, null))[0]?.n)).toBe(3);
    // And ONE catalogue entry, not two: a fresh name per ensure would leave the
    // first view behind under a name nothing would ever use again.
    const views = db.query(
      `SELECT view_name FROM duckdb_views() WHERE view_name = '${VIEW}'`,
    );
    expect(views).toHaveLength(1);
  });

  it("DROP VIEW really removes it — a DROP TABLE is REFUSED", () => {
    // MEASURED here, and it is why `retire` branches on `fileBacked`: DuckDB
    // 1.5.5 does not treat a view as a missing table. `DROP TABLE IF EXISTS`
    // over one raises "Existing object … is of type View, trying to drop type
    // Table" — which `retire` only WARNS about, so the view would survive under
    // a name nothing will ever use again, holding its source registration open
    // for the life of the page.
    db.query(`CREATE OR REPLACE VIEW "layer_fv_tmp" AS SELECT 1 AS a`);
    expect(() => db.query(`DROP TABLE IF EXISTS "layer_fv_tmp"`)).toThrow(
      /type View, trying to drop type Table/,
    );
    expect(
      db.query(
        `SELECT view_name FROM duckdb_views() WHERE view_name = 'layer_fv_tmp'`,
      ),
    ).toHaveLength(1);

    db.query(`DROP VIEW IF EXISTS "layer_fv_tmp"`);
    expect(
      db.query(
        `SELECT view_name FROM duckdb_views() WHERE view_name = 'layer_fv_tmp'`,
      ),
    ).toHaveLength(0);
  });

  it("stops answering once its source registration is dropped", () => {
    // Which is why a dropped name is never read again and every registration is
    // minted fresh: the name still RESOLVES after the drop, to nothing.
    db.registerBytes(
      "family_tmp.parquet",
      new Uint8Array(readFileSync(FIXTURE)),
    );
    db.query(buildFamilyViewSql("layer_fv_src", "family_tmp.parquet", kept));
    expect(Number(db.query(buildCountSql("layer_fv_src", null))[0]?.n)).toBe(3);

    db.dropFile("family_tmp.parquet");
    expect(() => db.query(buildCountSql("layer_fv_src", null))).toThrow();
    db.query(`DROP VIEW IF EXISTS "layer_fv_src"`);
  });
});
