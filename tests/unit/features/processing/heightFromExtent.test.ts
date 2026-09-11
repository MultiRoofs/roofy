/**
 * Height from extent (spec §7.4).
 *
 * The SQL and the roll-up are PURE and tested against exact values; the executor
 * is tested through a fake `ToolContext`, so no DuckDB and no store are needed
 * to pin what a run actually writes.
 */
import { describe, expect, it } from "vitest";

import {
  buildExtentSql,
  heightFromExtent,
  rollUpExtents,
} from "../../../../src/features/processing/tools/heightFromExtent";
import type {
  ToolContext,
  ToolResult,
} from "../../../../src/features/processing/runQueue";
import type { RunRecord } from "../../../../src/features/processing/types";

const PROJECTION =
  `SELECT "id", COALESCE("feature_id", "id") AS f, ` +
  `"bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM "layer_1"`;

interface Fake {
  readonly ctx: ToolContext;
  readonly sql: string[];
  readonly labels: string[];
  readonly phases: string[];
}

function fakeContext(
  rows: ReadonlyArray<Record<string, unknown>>,
  featureIds: ReadonlyArray<string> | null,
): Fake {
  const sql: string[] = [];
  const labels: string[] = [];
  const phases: string[] = [];
  const ctx = {
    table: { table: "layer_1" },
    featureIds,
    signal: new AbortController().signal,
    async query(label: string, statement: string) {
      labels.push(label);
      sql.push(statement);
      return { ok: true as const, columns: ["id", "f", "zmin", "zmax"], rows };
    },
    phase(p: string) {
      phases.push(p);
    },
    warn() {},
  } as unknown as ToolContext;
  return { ctx, sql, labels, phases };
}

const run = { prefix: "extent_" } as unknown as RunRecord;

describe("buildExtentSql", () => {
  it("selects the bbox fields per row within the scope", () => {
    expect(buildExtentSql("layer_1", null)).toBe(PROJECTION);
    expect(buildExtentSql("layer_1", ["a", "b"])).toBe(
      `${PROJECTION} WHERE "id" IN ('a', 'b')`,
    );
  });

  it("quotes the identifier and escapes a literal", () => {
    expect(buildExtentSql('odd"name', ["o'brien"])).toContain(
      `FROM "odd""name" WHERE "id" IN ('o''brien')`,
    );
  });
});

describe("rollUpExtents", () => {
  it("rolls parts up to the feature: max zmax minus min zmin, written to root and parts", () => {
    const out = rollUpExtents(
      [
        { id: "B", f: "B", zmin: 1, zmax: 5 },
        { id: "B-1", f: "B", zmin: 0.5, zmax: 9 },
        { id: "C", f: "C", zmin: null, zmax: null },
      ],
      "extent_",
    );
    expect(out.rows.get("B")).toEqual({
      extent_height_m: 8.5,
      extent_zmin_m: 0.5,
      extent_zmax_m: 9,
    });
    expect(out.rows.get("B-1")).toEqual({
      extent_height_m: 8.5,
      extent_zmin_m: 0.5,
      extent_zmax_m: 9,
    });
    expect(out.rows.get("C")).toEqual({
      extent_height_m: null,
      extent_zmin_m: null,
      extent_zmax_m: null,
    });
    expect(out.measured).toBe(1);
    expect(out.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
  });

  it("measures a feature whose OTHER member has a bbox, whichever came first", () => {
    // Spec §7: only a feature with no bbox on ANY member is skipped. The member
    // that had none still receives the feature's values, so the column is not
    // half-null across one building.
    const nullFirst = rollUpExtents(
      [
        { id: "B", f: "B", zmin: null, zmax: null },
        { id: "B-1", f: "B", zmin: 2, zmax: 7 },
      ],
      "extent_",
    );
    expect(nullFirst.measured).toBe(1);
    expect(nullFirst.skipped).toEqual([]);
    expect(nullFirst.rows.get("B")).toEqual({
      extent_height_m: 5,
      extent_zmin_m: 2,
      extent_zmax_m: 7,
    });
    expect(nullFirst.rows.get("B-1")).toEqual(nullFirst.rows.get("B"));

    const nullLast = rollUpExtents(
      [
        { id: "B-1", f: "B", zmin: 2, zmax: 7 },
        { id: "B", f: "B", zmin: null, zmax: null },
      ],
      "extent_",
    );
    expect(nullLast.measured).toBe(1);
    expect(nullLast.skipped).toEqual([]);
    expect(nullLast.rows.get("B")).toEqual({
      extent_height_m: 5,
      extent_zmin_m: 2,
      extent_zmax_m: 7,
    });
  });

  it("counts FEATURES, not rows, and reports no skips as an empty list", () => {
    const out = rollUpExtents(
      [
        { id: "B", f: "B", zmin: 0, zmax: 3 },
        { id: "B-1", f: "B", zmin: 0, zmax: 4 },
        { id: "C", f: "C", zmin: 1, zmax: 2 },
      ],
      "h_",
    );
    expect(out.measured).toBe(2);
    expect(out.skipped).toEqual([]);
    expect(out.rows.size).toBe(3);
    expect(out.rows.get("B")).toEqual({
      h_height_m: 4,
      h_zmin_m: 0,
      h_zmax_m: 4,
    });
  });

  it("has no rows and no counts for an empty read", () => {
    const out = rollUpExtents([], "extent_");
    expect(out.rows.size).toBe(0);
    expect(out.measured).toBe(0);
    expect(out.skipped).toEqual([]);
  });
});

describe("heightFromExtent executor", () => {
  it("reads the scope's extents and returns the three DOUBLE columns", async () => {
    const fake = fakeContext(
      [
        { id: "B", f: "B", zmin: 1, zmax: 5 },
        { id: "B-1", f: "B", zmin: 0.5, zmax: 9 },
        { id: "C", f: "C", zmin: null, zmax: null },
      ],
      ["B", "B-1", "C"],
    );
    const result: ToolResult = await heightFromExtent(run, fake.ctx);

    expect(fake.sql).toEqual([`${PROJECTION} WHERE "id" IN ('B', 'B-1', 'C')`]);
    expect(fake.labels).toEqual(["Reading extents"]);
    expect(fake.phases).toEqual(["compute"]);
    expect(result.columns).toEqual([
      { name: "extent_height_m", type: "DOUBLE" },
      { name: "extent_zmin_m", type: "DOUBLE" },
      { name: "extent_zmax_m", type: "DOUBLE" },
    ]);
    expect(result.rows.get("B-1")).toEqual({
      extent_height_m: 8.5,
      extent_zmin_m: 0.5,
      extent_zmax_m: 9,
    });
    expect(result.rows.get("C")).toEqual({
      extent_height_m: null,
      extent_zmin_m: null,
      extent_zmax_m: null,
    });
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
  });

  it("reads every row when the scope is 'all'", async () => {
    const fake = fakeContext([{ id: "B", f: "B", zmin: 0, zmax: 2 }], null);
    const result = await heightFromExtent(run, fake.ctx);
    expect(fake.sql).toEqual([PROJECTION]);
    expect(result.measured).toBe(1);
  });

  it("coerces the engine's values: a BigInt id and undefined bbox fields", async () => {
    // duckdb-wasm hands back whatever the column's arrow type is: an id can
    // arrive as a BigInt, a DECIMAL as a string, and a missing STRUCT field as
    // `undefined`.
    const fake = fakeContext(
      [
        { id: 7n, f: 7n, zmin: "1.5", zmax: "4" },
        { id: 8n, f: 8n, zmin: undefined, zmax: undefined },
      ],
      null,
    );
    const result = await heightFromExtent(run, fake.ctx);
    expect(result.rows.get("7")).toEqual({
      extent_height_m: 2.5,
      extent_zmin_m: 1.5,
      extent_zmax_m: 4,
    });
    expect(result.rows.get("8")).toEqual({
      extent_height_m: null,
      extent_zmin_m: null,
      extent_zmax_m: null,
    });
    expect(result.measured).toBe(1);
    expect(result.skipped).toEqual([{ cause: "no geometry", count: 1 }]);
  });

  it("registers itself for the run queue", async () => {
    const { EXECUTORS } =
      await import("../../../../src/features/processing/tools");
    expect(EXECUTORS["height-from-extent"]).toBe(heightFromExtent);
  });
});
