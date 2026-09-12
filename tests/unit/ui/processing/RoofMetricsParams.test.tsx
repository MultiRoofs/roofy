/**
 * Spec §6/§7.1's PARAMETERS section for Roof metrics: the six measures, the
 * flat-threshold slider, the one validation that blocks Run, and the NORMALISED
 * bag the run freezes.
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
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
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
const { addRoofLayer } = await import("./roofLayerFixture");

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
});

describe("Roof metrics PARAMETERS (spec §6, §7.1)", () => {
  it("opens with all six measures ticked and the threshold at 5", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      expect(screen.getByLabelText(label)).toBeChecked();
    }
    expect(
      (screen.getByLabelText("Flat threshold") as HTMLInputElement).value,
    ).toBe("5");
  });

  it("prints the columns of the ticked measures, in the spec's order", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.click(screen.getByLabelText("Mean slope (deg)"));
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
  });

  it("blocks Run with 'Pick at least one measure' when nothing is ticked", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getAllByText("Pick at least one measure").length,
    ).toBeGreaterThan(0);
  });

  it("carries the measures and the threshold into the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.params).toEqual({
      measures: ["area", "flatArea", "slope", "azimuth", "surfaces"],
      flatThresholdDeg: 12,
    });
    expect(request.columns.map((c) => c.name)).toEqual([
      "roof_area_m2",
      "roof_flat_m2",
      "roof_slope_deg",
      "roof_azimuth_deg",
      "roof_surfaces_n",
    ]);
  });

  it("freezes the NORMALISED parameters even when the user changed nothing", () => {
    // §6.4: the log is "the reproducible record of the run". An untouched
    // draft is `{}`, and a log reading "Parameters: —" for a run that used six
    // measures and a 5° threshold is not a record of anything.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]![0]!.params).toEqual({
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

  it("shows the threshold's current value beside the slider", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "0" },
    });
    expect(screen.getByText("0°")).toBeInTheDocument();
  });

  it("explains each measure where the user can read it", () => {
    // §7.1 carries explanations the labels trim ("0-1", "area-weighted", "of
    // the largest non-flat surface"); they land as the label's tooltip.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByLabelText("Flat share").closest("label"),
    ).toHaveAttribute("title", "0-1: the flat area over the total roof area");
    expect(
      screen.getByLabelText("Mean slope (deg)").closest("label"),
    ).toHaveAttribute("title", "Area-weighted over every roof surface");
    expect(
      screen.getByLabelText("Dominant azimuth (deg)").closest("label"),
    ).toHaveAttribute("title", "Of the largest non-flat surface");
  });

  it("offers no PARAMETERS section for a tool that has none", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByText("PARAMETERS")).toBeNull();
  });
});
