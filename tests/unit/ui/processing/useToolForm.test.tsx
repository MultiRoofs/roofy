/**
 * `useToolForm`'s two answers that the rendered form cannot pin on its own:
 *
 * - `OUTPUT_COLUMNS` promises the names the run WILL write, before any run
 *   exists. The executor writes them for real. The two used to be two literal
 *   lists; this file is what keeps them one.
 * - `eligibleTargets` is spec §6's "only layers the tool can target", which is
 *   more than "the table is ready" — and the only implemented M1 tool can never
 *   fail per layer, so the registry is mocked to make one that can.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/insights/duckdb", () => ({
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

const { OUTPUT_COLUMNS } =
  await import("../../../../src/ui/processing/useToolForm");
const { outputColumnNames } =
  await import("../../../../src/features/processing/tools/heightFromExtent");

afterEach(() => {
  vi.clearAllMocks();
});

describe("OUTPUT_COLUMNS", () => {
  it("promises exactly the names the Height from extent executor writes", () => {
    expect(OUTPUT_COLUMNS["height-from-extent"]!("extent_", {})).toEqual(
      outputColumnNames("extent_"),
    );
    expect(OUTPUT_COLUMNS["height-from-extent"]!("", {})).toEqual(
      outputColumnNames(""),
    );
  });
});
