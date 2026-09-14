/**
 * The tool is ON: the catalogue row is enabled against the REAL registry, its
 * executor is wired, and the form it opens is usable end to end. No registry
 * mock — every other Roof metrics suite enables the tool by hand, and this one
 * is what proves the flip actually happened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const counts = {
  all: 4 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { EXECUTORS } = await import("../../../../src/features/processing/tools");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { addRoofLayer } = await import("./roofLayerFixture");
// The side-effect module, so `EXECUTORS` is populated the way a real session
// populates it (`runQueue.ts` imports it; nothing here imports the tool).
await import("../../../../src/features/processing/tools/register");

beforeEach(() => {
  counts.all = 4;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
  useShellStore.getState().requestSection(null);
});

describe("Roof metrics to attributes, switched on", () => {
  it("is registered as an executor", () => {
    expect(EXECUTORS["roof-metrics"]).toBeTypeOf("function");
  });

  it("has an enabled catalogue row on a ready city layer", () => {
    addRoofLayer();
    render(<CatalogueView />);
    const row = screen
      .getByText("Roof metrics to attributes")
      .closest("button")!;
    expect(row).toHaveAttribute("aria-disabled", "false");
    expect(row.textContent).not.toContain("Not available yet");
  });

  it("opens a form that can actually be run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toBeEnabled();
    expect(screen.getByLabelText("Total roof area (m²)")).toBeChecked();
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(vi.mocked(submitRun)).toHaveBeenCalledTimes(1);
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.toolId).toBe("roof-metrics");
    expect(request.lod).toBe("2.2");
    expect(request.params).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });
});
