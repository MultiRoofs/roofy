/**
 * DuckDB-wasm initialization needs a browser Worker, so these tests verify the
 * module's status tracking and query guards without attempting a real init.
 * The engine's error formatting and VFS guards live in duckdbEngine.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  getDuckDBStatus,
  queryDuckDB,
  queryParquetBuffer,
} from "../../../src/insights/duckdb";

describe("DuckDB status", () => {
  it("starts in uninitialized state", () => {
    expect(getDuckDBStatus().state).toBe("uninitialized");
  });

  it("queryDuckDB returns null when not initialized", async () => {
    expect(await queryDuckDB("SELECT 1")).toBeNull();
  });

  it("queryParquetBuffer returns null when not initialized", async () => {
    const result = await queryParquetBuffer(
      "x.parquet",
      new Uint8Array(8),
      "SELECT 1",
    );
    expect(result).toBeNull();
  });
});
