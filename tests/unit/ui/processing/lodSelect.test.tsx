/**
 * Spec §6's LoD select for Roof metrics: the options, their FEATURE counts,
 * the default, the empty state, and the tools that get no select at all.
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

/**
 * Roof metrics is `implemented: false` until Task 13. `TOOLS` is an array of
 * plain readonly object literals, so a getter spy has nothing to attach to —
 * the registry is MOCKED instead, the same way `useToolForm.test.tsx` already
 * enables `measure-solids`. Task 13 deletes this block and reruns these
 * assertions against the real registry.
 */
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const TOOLS = actual.TOOLS.map((t) =>
    t.id === "roof-metrics" ? { ...t, implemented: true } : t,
  );
  return {
    ...actual,
    TOOLS,
    toolById: (id: string) => {
      const tool = TOOLS.find((t) => t.id === id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      return tool;
    },
  };
});

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

describe("the LoD select (spec §6)", () => {
  it("lists each LoD with its FEATURE count, highest detail first", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    const select = screen.getByRole("combobox", {
      name: "LoD",
    }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "2.2 (2 buildings with roof surfaces)",
      "1.2 (1 building with roof surfaces)",
    ]);
  });

  it("defaults to the layer's selected LoD when it qualifies", () => {
    addRoofLayer({ selectedLod: "1.2" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
  });

  it("defaults to the highest qualifying LoD when the layer's does not qualify", () => {
    addRoofLayer({ selectedLod: "0" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("2.2");
  });

  it("shows the empty state and blocks Run when no LoD qualifies", () => {
    addRoofLayer({ roofs: false });
    render(<ToolView toolId="roof-metrics" />);
    // The same sentence stands in TWO places — the disabled select's one
    // option and the footer's reason — so each is asserted where it belongs;
    // an unscoped `getByText` would match both and throw.
    const select = screen.getByRole("combobox", {
      name: "LoD",
    }) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "No roof surfaces in this layer",
    ]);
    expect(
      screen.getByText("No roof surfaces in this layer", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("does not offer a LoD for a tool that reads no geometry at one level", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
  });

  it("does not offer a LoD, or any geometry verdict, for an UNIMPLEMENTED tool", () => {
    // Measure solids has `needsLod: true` and no source of counts in M2. A
    // select reading "No solid geometry in this layer" over a layer full of
    // solids would be a fact the app never checked.
    addRoofLayer();
    render(<ToolView toolId="measure-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });

  it("submits the chosen LoD with the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByRole("combobox", { name: "LoD" }), {
      target: { value: "1.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "roof-metrics", lod: "1.2" }),
    );
  });
});
