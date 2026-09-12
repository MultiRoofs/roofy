/**
 * Measure solids, switched on: the LoD select's options and their FEATURE
 * counts, §6's empty state, the PARAMETERS section, the validation that blocks
 * Run, and the frozen request the Run button produces.
 *
 * A layer of its own rather than `roofLayerFixture`'s: this tool needs a READER
 * and an available SOURCE (`eligibility.ts`) and surfaces tagged with their
 * geometry TYPE, none of which the roof fixture has.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";

vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => ({
    objects: {},
    cellCount: 0,
    featureCount: 0,
    surfaceAttrKeys: [],
  })),
}));

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
  all: 2 as number | null,
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
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

const surface = (lod: string, geometryType: string | null) => ({
  type: "RoofSurface",
  rings: [],
  attributes: {},
  lod,
  geometryType,
});

/** B1 (+part B1P) and B2 both carry a Solid at 2.2; B3 has only a MultiSurface. */
function solidModel(options: { solids?: boolean } = {}): CityModel {
  const kind = options.solids === false ? "MultiSurface" : "Solid";
  const object = (
    id: string,
    objectType: string,
    surfaces: unknown[],
    parents: string[] = [],
    children: string[] = [],
  ) => ({
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  });
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object("B1", "Building", [surface("2.2", kind)], [], ["B1P"]),
      B1P: object("B1P", "BuildingPart", [surface("2.2", kind)], ["B1"]),
      B2: object("B2", "Building", [surface("1.2", kind)]),
      B3: object("B3", "Building", [surface("2.2", "MultiSurface")]),
    },
  } as unknown as CityModel;
}

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function addSolidLayer(options: { solids?: boolean } = {}): string {
  const input: LayerInput = {
    name: "Delft",
    model: solidModel(options),
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: false,
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState((state) => ({
    tables: {
      ...state.tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: "layer_1.city.json",
          // A READER and an available SOURCE: without both, eligibility
          // refuses the tool before the LoD select is ever rendered.
          source: async () => new Uint8Array(),
          reader: "read_cityjson",
          extension: "city.json",
          sourceBytes: 1024,
          columns: [
            { name: "id", type: "VARCHAR", kind: "scalar" },
            { name: "feature_id", type: "VARCHAR", kind: "scalar" },
          ],
          lods: [
            { label: "2.2", suffix: "2_2" },
            { label: "1.2", suffix: "1_2" },
          ],
          rowCount: 4,
        },
      },
    },
  }));
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

describe("Measure solids, switched on", () => {
  it("is no longer 'Not available yet' and offers §6's LoD options", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    const select = screen.getByRole("combobox", { name: "LoD" });
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("Not available yet")).toBeNull();
    // §6's own sentence: "2.2 (1,115 buildings with a solid)". 2.2 counts B1
    // (through its part) — one FEATURE, not two rows. B3's MultiSurface is not
    // a solid, and B2's solid is at 1.2.
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual([
      "2.2 (1 building with a solid)",
      "1.2 (1 building with a solid)",
    ]);
  });

  it("shows §6's empty state and blocks Run when nothing has a solid", () => {
    addSolidLayer({ solids: false });
    render(<ToolView toolId="measure-solids" />);
    // The same sentence stands in TWO places — the disabled select's one
    // option and the footer's reason — so each is asserted where it belongs;
    // an unscoped `getByText` would match both and throw.
    const select = screen.getByRole("combobox", {
      name: "LoD",
    }) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "No solid geometry in this layer",
    ]);
    expect(
      screen.getByText("No solid geometry in this layer", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("renders the PARAMETERS section and lists the promised columns", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    expect(screen.getByRole("checkbox", { name: "Volume (m³)" })).toBeChecked();
    expect(
      screen.getByText(
        "solid_volume_m3, solid_envelope_m2, solid_footprint_m2, solid_height_m, solid_valid",
      ),
    ).toBeInTheDocument();
  });

  it("blocks Run with §6's message when every measure is unticked", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    for (const label of [
      "Volume (m³)",
      "Envelope area (m²)",
      "Footprint area (m²)",
      "Height (m)",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    expect(screen.getByText("Pick at least one measure")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    // `<prefix>valid` is still promised: §7.2 writes it always.
    expect(screen.getByText("solid_valid")).toBeInTheDocument();
  });

  it("freezes the normalised parameters, the LoD and the typed columns", () => {
    const id = addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "measure-solids",
        targetLayerId: id,
        // §6's default: "the layer's selected LoD when it qualifies, else the
        // highest qualifying one".
        lod: "2.2",
        prefix: "solid_",
        params: { measures: ["volume", "envelope", "footprint", "height"] },
        columns: [
          { name: "solid_volume_m3", type: "DOUBLE" },
          { name: "solid_envelope_m2", type: "DOUBLE" },
          { name: "solid_footprint_m2", type: "DOUBLE" },
          { name: "solid_height_m", type: "DOUBLE" },
          { name: "solid_valid", type: "BOOLEAN" },
        ],
      }),
    );
  });

  it("shows the workload note for a large source", () => {
    // §6, and the positive half of Task 5's test: this tool re-reads the
    // source, so the warning applies to it.
    const id = addSolidLayer();
    useLayerTableStore.setState((s) => {
      const entry = s.tables[id];
      if (entry?.state !== "ready") return s;
      return {
        tables: {
          ...s.tables,
          [id]: { ...entry, info: { ...entry.info, sourceBytes: 180_000_000 } },
        },
      };
    });
    render(<ToolView toolId="measure-solids" />);
    expect(
      screen.getByText(
        "Re-reads a 180 MB source; this can take a minute and needs memory",
      ),
    ).toBeInTheDocument();
  });
});
