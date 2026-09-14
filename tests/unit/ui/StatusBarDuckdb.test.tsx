import { describe, it, expect } from "vitest";
import { duckdbLabel, duckdbTooltip } from "../../../src/ui/duckdbStatusText";
import type { DuckDBStatus } from "../../../src/insights/duckdb";

const ready = (cityjson: "loaded" | "failed"): DuckDBStatus => ({
  state: "ready",
  platform: "wasm_eh",
  extensions: {
    cityjson:
      cityjson === "loaded"
        ? { state: "loaded" }
        : { state: "failed", error: "HTTP 404" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions:
    cityjson === "loaded"
      ? [
          { name: "cityjson", version: "0.4.0" },
          { name: "parquet", version: "v1.5.5" },
        ]
      : [{ name: "parquet", version: "v1.5.5" }],
});

describe("duckdbLabel", () => {
  it("says Ready when the cityjson extension loaded", () => {
    expect(duckdbLabel(ready("loaded"))).toBe("Ready");
  });

  it("says No ext when the engine came up without cityjson", () => {
    expect(duckdbLabel(ready("failed"))).toBe("No ext");
  });

  it("says Loading while initializing", () => {
    expect(duckdbLabel({ state: "initializing" })).toBe("Loading");
  });

  it("says Failed when the engine never started", () => {
    expect(duckdbLabel({ state: "failed", error: "no wasm" })).toBe("Failed");
  });
});

describe("duckdbTooltip", () => {
  it("names the platform and lists every loaded extension with its version", () => {
    expect(duckdbTooltip(ready("loaded"))).toBe(
      "Platform wasm_eh. Loaded extensions: cityjson 0.4.0, parquet v1.5.5",
    );
  });

  it("names the cityjson failure when there is one", () => {
    expect(duckdbTooltip(ready("failed"))).toBe(
      "cityjson did not load: HTTP 404. Platform wasm_eh. Loaded extensions: parquet v1.5.5",
    );
  });

  it("says so when the platform could not be read", () => {
    expect(
      duckdbTooltip({ ...ready("loaded"), platform: null } as DuckDBStatus),
    ).toBe(
      "Platform unknown. Loaded extensions: cityjson 0.4.0, parquet v1.5.5",
    );
  });

  it("reports the engine failure verbatim", () => {
    expect(duckdbTooltip({ state: "failed", error: "no wasm" })).toBe(
      "The analytics engine failed to start: no wasm",
    );
  });

  it("says so while still starting", () => {
    expect(duckdbTooltip({ state: "initializing" })).toBe(
      "The analytics engine is starting…",
    );
  });
});
