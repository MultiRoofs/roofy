/**
 * `eligibleTargets`: spec §6's "a layer select listing only layers the tool can
 * target", which is more than "the table is ready". The only implemented M1
 * tool can never fail per layer (no reader, no extension, city target), so the
 * registry is mocked here to make one that can.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { LayerTableState } from "../../../../src/insights/layerTables";

vi.mock("../../../../src/insights/duckdb", () => ({
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => ({
    all: 2,
    matching: null,
    selected: 0,
    loading: false,
    message: null,
  }),
}));

/** Measure solids is still M3's, and it is still the only tool whose
 *  eligibility can fail on one ready layer and pass on another (it needs a
 *  reader). M2's Roof metrics needs neither a reader nor an extension and runs
 *  on streaming targets too, so it cannot discriminate the ready-table
 *  `candidates` any more than Height from extent can — this mock stays until a
 *  reader- or extension-needing tool ships. */
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const TOOLS = actual.TOOLS.map((t) =>
    t.id === "measure-solids" ? { ...t, implemented: true } : t,
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
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** A ready table, with or without the reader Measure solids needs. */
function readyTable(withReader: boolean): LayerTableState {
  return {
    state: "ready",
    info: {
      table: "layer_1",
      sourceName: withReader ? "delft.city.json" : null,
      source: withReader ? ({} as never) : null,
      reader: withReader ? "read_cityjson" : null,
      columns: [],
      lods: [],
      rowCount: 2,
    },
  };
}

function addCityLayer(name: string, withReader: boolean): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name,
    model,
    modelRef: { type: "url", url: `https://x/${name}.city.json` },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: false,
  };
  const id = useLayerStore.getState().addLayer(input);
  useLayerTableStore.setState({
    tables: {
      ...useLayerTableStore.getState().tables,
      [id]: readyTable(withReader),
    },
  });
  return id;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
});

describe("the Layer select (spec §6 TARGET)", () => {
  it("offers only the layers the tool can target, not every ready table", () => {
    const withReader = addCityLayer("Delft", true);
    addCityLayer("Rotterdam", false);
    useWorkspaceStore.getState().setActiveLayerId(withReader);
    render(<ToolView toolId="measure-solids" />);
    const select = screen.getByRole("combobox", { name: "Layer" });
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual(["Delft"]);
  });

  it("keeps an ineligible target the user already chose, and says why", () => {
    const withReader = addCityLayer("Delft", true);
    const withoutReader = addCityLayer("Rotterdam", false);
    useWorkspaceStore.getState().setActiveLayerId(withReader);
    useProcessingStore.getState().setDraft("measure-solids", {
      targetLayerId: withoutReader,
      scope: "all",
      lod: null,
      prefix: "solid_",
      params: {},
    });
    render(<ToolView toolId="measure-solids" />);
    // §5: "A disabled row still opens the tool view" — the select is never
    // blank, and Run carries the reason.
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(
      withoutReader,
    );
    expect(
      screen.getByText(
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityJSON",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
