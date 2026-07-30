/**
 * `shouldUseSourceUrlPath` is the gate that stops a streaming layer from
 * triggering a second, complete read of the remote file just to populate
 * DuckDB's `city_objects` table (see App.tsx's DuckDB-loading effect and
 * duckdb.ts's doc comment on the function). `loadResidentObjectsIntoDuckDB`
 * is the replacement path — it needs a real DuckDB-wasm instance to do
 * anything beyond its readiness guard (same reason `loadModelIntoDuckDB`/
 * `loadCityModelFromMemory` were never exercised beyond that guard either,
 * per duckdbStatus.test.ts), so only that guard is asserted here.
 */
import { describe, it, expect } from "vitest";
import {
  shouldUseSourceUrlPath,
  loadResidentObjectsIntoDuckDB,
} from "../../../src/analytics/duckdb";

describe("shouldUseSourceUrlPath", () => {
  it("allows the whole-file path for a static URL layer", () => {
    expect(
      shouldUseSourceUrlPath(
        { type: "url", url: "https://x/a.city.json" },
        false,
      ),
    ).toBe(true);
  });

  it("REFUSES the whole-file path for a streaming layer", () => {
    expect(
      shouldUseSourceUrlPath({ type: "url", url: "https://x/a.fcb" }, true),
    ).toBe(false);
  });

  it("refuses for file-backed layers as today", () => {
    expect(
      shouldUseSourceUrlPath({ type: "file", fileName: "a.fcb" }, false),
    ).toBe(false);
  });

  it("refuses a file-backed layer even if (hypothetically) marked streaming", () => {
    // File-backed layers can never be `isStreaming` today (streaming only
    // ever opens a `url` layer), but the function's own contract is
    // `ref.type === "url" && !isStreaming` — both conditions independently
    // gate it, not just `isStreaming`. Guards against a future regression
    // that collapses this to `!isStreaming` alone.
    expect(
      shouldUseSourceUrlPath({ type: "file", fileName: "a.fcb" }, true),
    ).toBe(false);
  });
});

describe("loadResidentObjectsIntoDuckDB", () => {
  it("returns false when DuckDB is not initialized", async () => {
    const result = await loadResidentObjectsIntoDuckDB([]);
    expect(result).toBe(false);
  });
});
