/**
 * Unit tests for DuckDB status management.
 *
 * DuckDB-wasm initialization requires a browser Worker environment,
 * so these tests verify the module's status tracking and query-guard
 * behavior without attempting full initialization.
 */

import { describe, it, expect } from "vitest";
import {
  getDuckDBStatus,
  queryDuckDB,
  queryParquetBuffer,
} from "../../../src/analytics/duckdb";

describe("DuckDB status", () => {
  it("starts in uninitialized state", () => {
    const status = getDuckDBStatus();
    expect(status.state).toBe("uninitialized");
  });

  it("queryDuckDB returns null when not initialized", async () => {
    const result = await queryDuckDB("SELECT 1");
    expect(result).toBeNull();
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
