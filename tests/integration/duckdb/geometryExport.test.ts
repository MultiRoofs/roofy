// @vitest-environment node
/**
 * The geometry export statement, run against the REAL cityjson extension.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vp test run tests/integration/duckdb`.
 *
 * Every statement comes from `buildGeometryExportSql`, and every read-back goes
 * through the app's own `validateExportBytes`. What only this suite can show:
 * that the extension's three `COPY` writers accept the column set the app
 * selects (the reader's own `address`, `implicit_geometry` and `other`
 * included), and that what they write reads back as the same objects.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Harness } from "./harness";
import { readerTableSelectList } from "../../../src/insights/columnKind";
import {
  buildFlatCityBufLossSql,
  buildGeometryExportSql,
  quoteIdent,
  quoteLiteral,
  type GeometryExportFormat,
} from "../../../src/insights/sql";
import { validateExportBytes } from "../../../src/insights/export";

/** `export.ts` imports the browser engine; only its pure validator is used. */
vi.mock("../../../src/insights/duckdb", () => {
  const unreachable = () => {
    throw new Error("this suite talks to the harness, not to insights/duckdb");
  };
  return {
    runQuery: unreachable,
    ddl: unreachable,
    registerBuffer: unreachable,
    dropBuffer: unreachable,
    readFile: unreachable,
  };
});

const enabled = process.env.DUCKDB_INTEGRATION === "1";

const TABLE = "layer_geom";
const SOURCE = "export_g_src.city.json";
const BASE = "export_g";

const READERS: Readonly<Record<GeometryExportFormat, string>> = {
  cityjson: "read_cityjson",
  cityjsonseq: "read_cityjsonseq",
  flatcitybuf: "read_flatcitybuf",
};
const EXTENSIONS: Readonly<Record<GeometryExportFormat, string>> = {
  cityjson: "city.json",
  cityjsonseq: "city.jsonl",
  flatcitybuf: "fcb",
};
const FORMATS = ["cityjson", "cityjsonseq", "flatcitybuf"] as const;

/** Under NODE_RUNTIME a COPY lands on the real filesystem (see the harness). */
const written = new Set<string>();

describe.skipIf(!enabled)("geometry export over the real writers", () => {
  let db: Harness;

  function exportTo(
    format: GeometryExportFormat,
    over: Partial<Parameters<typeof buildGeometryExportSql>[0]> = {},
  ): { outFile: string; bytes: Uint8Array } {
    const outFile = `${BASE}_${written.size}.${EXTENSIONS[format]}`;
    written.add(outFile);
    db.query(
      buildGeometryExportSql({
        reader: "read_cityjson",
        sourceFile: SOURCE,
        table: TABLE,
        lodSuffix: "2_2",
        attributes: [],
        computedAttributes: [],
        where: null,
        sourceFeatureIds: null,
        rootTypes: null,
        format,
        outFile,
        ...over,
      }),
    );
    const readback = validateExportBytes(outFile, format, db.readFile(outFile));
    if (!readback.ok) throw new Error(readback.message);
    return { outFile, bytes: readback.bytes };
  }

  function ids(format: GeometryExportFormat, file: string): string[] {
    return db
      .query(
        `SELECT "id" FROM ${READERS[format]}(${quoteLiteral(file)}) ORDER BY 1`,
      )
      .map((row) => String(row.id));
  }

  beforeAll(async () => {
    const { openDuckDB } = await import("./harness");
    db = await openDuckDB();
    db.register(SOURCE, "two-buildings.city.json");
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(TABLE)} AS SELECT ${readerTableSelectList()} FROM read_cityjson(${quoteLiteral(SOURCE)})`,
    );
  }, 180_000);

  afterAll(() => {
    db?.close();
    for (const file of written) {
      rmSync(resolve(process.cwd(), file), { force: true });
    }
  });

  it("writes every object, with its geometry, in all three formats", () => {
    const sourceIds = ids("cityjson", SOURCE);
    expect(sourceIds.length).toBe(3);
    for (const format of FORMATS) {
      const { outFile } = exportTo(format, {
        attributes: ["yearOfConstruction"],
      });
      expect(ids(format, outFile)).toEqual(sourceIds);
      const [row] = db.query(
        `SELECT count("geometry_lod2_2") AS n FROM ${READERS[format]}(${quoteLiteral(outFile)})`,
      );
      expect(Number(row!.n)).toBe(3);
    }
  });

  it("carries the source's CRS across through metadata_from", () => {
    const { outFile } = exportTo("cityjson");
    const [row] = db.query(
      `SELECT reference_system.code AS code FROM cityjson_metadata(${quoteLiteral(outFile)})`,
    );
    expect(String(row!.code)).toBe("7415");
  });

  it("writes only the features the root-type and filter predicates keep", () => {
    const [first] = db.query(
      `SELECT "id" FROM ${quoteIdent(TABLE)} WHERE "parents" IS NULL ORDER BY 1 LIMIT 1`,
    );
    const root = String(first!.id);
    const { outFile } = exportTo("cityjsonseq", {
      where: `"id" = ${quoteLiteral(root)}`,
      rootTypes: ["Building"],
    });
    // Feature-scoped: the root's parts follow it into the file.
    const kept = ids("cityjsonseq", outFile);
    expect(kept).toContain(root);
    expect(kept.every((id) => id === root || id.startsWith(`${root}-`))).toBe(
      true,
    );
    expect(kept.length).toBeLessThan(3);
  });

  it("writes an implicit geometry back out as an instance of the source's own template", () => {
    const source = "export_g_templates.city.json";
    const table = "layer_templates";
    db.register(source, "geometry-templates.city.json");
    db.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ${readerTableSelectList()} FROM read_cityjson(${quoteLiteral(source)})`,
    );
    const { bytes } = exportTo("cityjson", {
      sourceFile: source,
      table,
      // Implicit geometry only: there is no per-LoD group to choose.
      lodSuffix: null,
      attributes: ["species"],
    });
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as {
      CityObjects: Record<
        string,
        { attributes?: Record<string, unknown>; geometry?: { type: string }[] }
      >;
      "geometry-templates"?: { templates: unknown[] };
    };
    expect(doc["geometry-templates"]?.templates.length).toBe(2);
    expect(doc.CityObjects["tree-1"]?.geometry?.[0]?.type).toBe(
      "GeometryInstance",
    );
    expect(doc.CityObjects["tree-2"]?.attributes?.species).toBe("Tilia");
  });

  it("counts the implicit geometries a FlatCityBuf export leaves out", () => {
    const source = "export_g_templates.city.json";
    const scope = {
      reader: "read_cityjson" as const,
      sourceFile: source,
      table: "layer_templates",
      lodSuffix: null,
      attributes: [],
      computedAttributes: [],
      where: null,
      sourceFeatureIds: null,
      rootTypes: null,
    };
    const { outFile } = exportTo("flatcitybuf", scope);
    // The writer gap the warning reports: both trees come back without one.
    const [kept] = db.query(
      `SELECT count(*) FILTER (WHERE "implicit_geometry" IS NOT NULL) AS n FROM read_flatcitybuf(${quoteLiteral(outFile)})`,
    );
    expect(Number(kept!.n)).toBe(0);
    const [lost] = db.query(buildFlatCityBufLossSql(scope));
    expect(Number(lost!.implicit)).toBe(2);
    expect(Number(lost!.address)).toBe(0);
  });
});
