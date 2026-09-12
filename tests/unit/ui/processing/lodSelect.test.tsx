/**
 * Spec §6's LoD select for Roof metrics: the options, their FEATURE counts,
 * the default, the empty state, the tools that get no select at all, and the
 * two ways the answer has to be recomputed — a new target, and a new commit on
 * a streaming one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

/**
 * A streaming layer's options come from the RESIDENT set, so the suite owns it:
 * `residents.objects` is rewritten in place and the stream's version bumped, the
 * way a commit reaches the form.
 */
const residents: {
  objects: Record<string, unknown>;
  cellCount: number;
  featureCount: number;
  surfaceAttrKeys: string[];
} = { objects: {}, cellCount: 0, featureCount: 0, surfaceAttrKeys: [] };
vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => residents),
}));

/** A resident record reduced to the two LoD lists `roofLodOptions` reads. */
const resident = (geometryLods: string[], roofLods: string[]) => ({
  parents: [],
  geometryLods,
  roofMetrics: roofLods.map((lod) => ({
    lod,
    areaSqM: 1,
    inclinationDeg: 0,
    azimuthDeg: 0,
  })),
});

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
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
const { useLodOptions } =
  await import("../../../../src/ui/processing/useLodOptions");
const { toolById } =
  await import("../../../../src/features/processing/toolRegistry");
const { addRoofLayer } = await import("./roofLayerFixture");
const duckdb = await import("../../../../src/insights/duckdb");

/** The status every case but the refused-target one runs against. Re-set in
 *  `beforeEach` because `mockReturnValue` outlives `vi.clearAllMocks()`. */
const READY_STATUS = {
  state: "ready",
  extensions: {
    cityjson: { state: "loaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions: [],
  platform: "wasm_eh",
} as const;

beforeEach(() => {
  counts.all = 4;
  counts.matching = null;
  counts.selected = 0;
  residents.objects = {};
  vi.mocked(duckdb.getDuckDBStatus).mockReturnValue(READY_STATUS);
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
  useStreamStore.setState({ streams: {} });
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

  it("drops the LoD control entirely when the tool is REFUSED on this target", () => {
    // The gate is shared by every `needsLod` tool, so it is pinned on Roof
    // metrics too: a form whose tool cannot run here states nothing about the
    // layer's geometry, and §5's row reason is the only true sentence. A failed
    // engine is the reason that reaches Roof metrics (it needs no reader).
    vi.mocked(duckdb.getDuckDBStatus).mockReturnValue({
      state: "failed",
      error: "boom",
    });
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No roof surfaces/)).toBeNull();
    expect(
      screen.getByText("Not available while DuckDB is unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("does not offer a LoD for a tool that reads no geometry at one level", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
  });

  it("answers NOTHING for an unimplemented tool, whatever the layer holds", () => {
    // §6: a tool whose executor has not shipped has no source of truthful
    // counts, so printing "No solid geometry in this layer" over a layer full
    // of solids would be a verdict the app never reached. Stated on a
    // definition that declares itself unimplemented, so the invariant survives
    // every tool in the registry shipping — and the view-level half of it now
    // lives in `solidsEnabled.test.tsx`, where Measure solids really is on.
    addRoofLayer();
    const target = useLayerStore.getState().layers[0]!;
    const tool = { ...toolById("measure-solids"), implemented: false };
    const { result } = renderHook(() => useLodOptions(tool, target));
    expect(result.current).toEqual({
      options: [],
      noun: "",
      emptyReason: null,
    });
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

  it("applies the NEW target's default when the target changes", () => {
    // The LoD belongs to the layer it was read off: a choice (or a default)
    // carried across a target change is a claim about the new layer that
    // nobody made. Both layers offer 2.2 and 1.2, so the old value would
    // still "qualify" — which is exactly how it used to survive.
    const other = addRoofLayer({ name: "B", selectedLod: "1.2" });
    addRoofLayer({ name: "A", selectedLod: "2.2" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("2.2");
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: other },
    });
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ targetLayerId: other, lod: "1.2" }),
    );
  });

  it("applies the new target's default when the stored target is GONE", () => {
    // The same reset on the automatic replacement path: the stored draft names
    // a layer that has since been removed, so the form retargets itself — and
    // the LoD it carried was about that removed layer.
    const layerId = addRoofLayer({ selectedLod: "1.2" });
    useProcessingStore.getState().setDraft("roof-metrics", {
      targetLayerId: "gone",
      scope: "all",
      lod: "2.2",
      prefix: "roof_",
      params: {},
    });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ targetLayerId: layerId, lod: "1.2" }),
    );
  });

  it("keeps an explicit LoD across an edit that is not a target change", () => {
    // The other side of the reset: only a NEW target drops the choice.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByRole("combobox", { name: "LoD" }), {
      target: { value: "1.2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "r_" },
    });
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "r_", lod: "1.2" }),
    );
  });

  it("follows a streaming target's commits, and drops a LoD they take away", () => {
    // §6's counts come from the resident set on a streaming layer, so a commit
    // can both change them and remove the rung the user picked.
    residents.objects = {
      A: resident(["2.2", "1.2"], ["2.2", "1.2"]),
      B: resident(["1.2"], ["1.2"]),
    };
    const layerId = addRoofLayer({ isStreaming: true, selectedLod: "2.2" });
    useStreamStore.setState({
      streams: { [layerId]: { version: 0 } as never },
    });
    render(<ToolView toolId="roof-metrics" />);
    const select = () =>
      screen.getByRole("combobox", { name: "LoD" }) as HTMLSelectElement;
    expect([...select().options].map((o) => o.textContent)).toEqual([
      "2.2 (1 building with roof surfaces)",
      "1.2 (2 buildings with roof surfaces)",
    ]);
    fireEvent.change(select(), { target: { value: "1.2" } });
    expect(select()).toHaveValue("1.2");

    // A commit in which every resident roof is at 2.2: the counts move and 1.2
    // stops existing, so the form falls back to the default rather than
    // submitting a rung the layer no longer has.
    act(() => {
      residents.objects = {
        A: resident(["2.2"], ["2.2"]),
        B: resident(["2.2"], ["2.2"]),
      };
      useStreamStore.setState({
        streams: { [layerId]: { version: 1 } as never },
      });
    });
    expect([...select().options].map((o) => o.textContent)).toEqual([
      "2.2 (2 buildings with roof surfaces)",
    ]);
    expect(select()).toHaveValue("2.2");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ targetLayerId: layerId, lod: "2.2" }),
    );
  });
});
