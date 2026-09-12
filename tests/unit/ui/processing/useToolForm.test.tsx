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
import type {
  LayerTable,
  LayerTableState,
} from "../../../../src/insights/layerTables";

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
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** A ready table's INFO, with or without the reader Measure solids needs.
 *  Split out so a case can stand the same table up with its own `columns`. */
function readyTableInfo(withReader: boolean): LayerTable {
  return {
    table: "layer_1",
    sourceName: withReader ? "delft.city.json" : null,
    source: withReader ? ({} as never) : null,
    reader: withReader ? "read_cityjson" : null,
    extension: withReader ? "city.json" : null,
    sourceBytes: null,
    columns: [],
    lods: [],
    rowCount: 2,
  };
}

/** A ready table, with or without the reader Measure solids needs. */
function readyTable(withReader: boolean): LayerTableState {
  return { state: "ready", info: readyTableInfo(withReader) };
}

/** One run's provenance, so a colliding column reads as REPLACEABLE (this
 *  app wrote it) rather than as the source data's own. */
const PROVENANCE = {
  runId: "run_0",
  toolName: "Roof metrics to attributes",
  summary: "All 2 buildings",
  at: 0,
  partial: null,
  previous: null,
};

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
  useComputedColumnStore.setState({ byLayer: {} });
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

describe("the OUTPUT column list, typed (spec §7)", () => {
  it("still counts the columns that exist, over typed columns", () => {
    // `existing` is `columns.filter(c => onTable.has(c.name.toLowerCase()))`
    // after this task. A filter left on the OBJECT would match nothing and the
    // replace warning would silently stop appearing.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [{ name: "roof_area_m2", type: "DOUBLE", kind: "scalar" }],
          },
        },
      },
    });
    useComputedColumnStore
      .getState()
      .setProvenance(id, "roof_area_m2", PROVENANCE);
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText("1 of these columns exist; they will be replaced."),
    ).toBeInTheDocument();
  });

  it("names the TABLE's spelling when a typed column collides with the file", () => {
    // §6, verbatim: "'height' belongs to the source data; choose another
    // prefix" — and the spelling in the message is the table's, which is now
    // reached through `onTable.get(c.name.toLowerCase())`.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [
              { name: "EXTENT_height_m", type: "DOUBLE", kind: "scalar" },
            ],
          },
        },
      },
    });
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByText(
        "'EXTENT_height_m' belongs to the source data; choose another prefix",
      ),
    ).toBeInTheDocument();
  });
});
