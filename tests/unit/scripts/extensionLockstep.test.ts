// @vitest-environment node
/**
 * The vendored DuckDB extensions, the manifest that describes them and the
 * pinned duckdb-wasm agree. duckdb-wasm refuses an extension built for another
 * DuckDB version, and without this test that would surface only in a browser.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script, typed by its use here
import { lockstepErrors } from "../../../scripts/check-lockstep.mjs";

describe("vendored DuckDB extensions", () => {
  it("match the manifest and the pinned duckdb-wasm", async () => {
    expect(await (lockstepErrors as () => Promise<string[]>)()).toEqual([]);
  }, 60_000);
});
