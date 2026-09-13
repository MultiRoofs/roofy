/**
 * BOTH solids tools, switched on: the LoD select's options and their FEATURE
 * counts, §6's empty state, the PARAMETERS section, the validation that blocks
 * Run, and the frozen request the Run button produces.
 *
 * One file for the two because they share one LoD answer (`solidLodOptions`,
 * the same noun and the same empty reason) and one fixture — so a change that
 * split them apart fails here rather than in whichever suite was written second.
 *
 * A layer of its own rather than `roofLayerFixture`'s: these tools need a READER
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
function solidModel(options: LayerOptions = {}): CityModel {
  // `untagged` is CityParquet's shape (design decision (a)): the parser there
  // builds surfaces from a flat face list and genuinely has no geometry type,
  // so every tag is null and `hasSolidAt` reads the layer as solid-less.
  const kind =
    options.untagged === true
      ? null
      : options.solids === false
        ? "MultiSurface"
        : "Solid";
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
    sourceEncoding: options.encoding ?? "cityjson",
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

interface LayerOptions {
  readonly solids?: boolean;
  readonly selectedLod?: string | null;
  /** CityParquet's untagged surfaces (`geometryType: null`). */
  readonly untagged?: boolean;
  /** The model's own encoding, which is what §5's reader sentence names. */
  readonly encoding?: string;
  /** False for a layer whose table was built without a CityJSON reader. */
  readonly reader?: boolean;
  readonly isStreaming?: boolean;
}

function addSolidLayer(options: LayerOptions = {}): string {
  const hasReader = options.reader !== false;
  const input: LayerInput = {
    name: "Delft",
    model: solidModel(options),
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: options.isStreaming ?? false,
  };
  const id = useLayerStore.getState().addLayer(input);
  if (options.selectedLod !== undefined) {
    useLayerStore.setState((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, selectedLod: options.selectedLod ?? null } : l,
      ),
    }));
  }
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
          source: hasReader ? async () => new Uint8Array() : null,
          reader: hasReader ? "read_cityjson" : null,
          extension: hasReader ? "city.json" : null,
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

  it("defaults to the layer's SELECTED LoD when that one qualifies", () => {
    // §6's default has two halves and the frozen-request case below pins only
    // the second ("else the highest qualifying one" — 2.2, with no selected LoD
    // on the layer). 1.2 qualifies through B2's solid and is NOT the highest,
    // so this is the case that separates the two rules.
    addSolidLayer({ selectedLod: "1.2" });
    render(<ToolView toolId="measure-solids" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "measure-solids", lod: "1.2" }),
    );
  });

  it("falls back to the highest qualifying LoD when the layer's does not", () => {
    // The other side of the same rule: 0 is not a rung this layer offers, so
    // the selected LoD is overridden rather than submitted.
    addSolidLayer({ selectedLod: "0" });
    render(<ToolView toolId="measure-solids" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("2.2");
  });

  it("claims NOTHING about a streaming target's geometry", () => {
    // §5 refuses the tool on a streaming FlatCityBuf (no reader), and
    // `hasSolidAt` answers `false` for such a layer BY CONSTRUCTION — the
    // resident record carries no geometry type. So a select reading "No solid
    // geometry in this layer" would be a verdict on data the app never
    // inspected, next to a footer saying the source cannot be read at all.
    addSolidLayer({
      isStreaming: true,
      reader: false,
      encoding: "flatcitybuf",
    });
    render(<ToolView toolId="measure-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
    expect(
      screen.getByText(
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from a streaming FlatCityBuf",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("claims NOTHING about a CityParquet target's geometry", () => {
    // The same gate for the other refused kind: CityParquet's surfaces carry
    // `geometryType: null` (decision (a)), so tags cannot tell a solid from a
    // MultiSurface there either.
    addSolidLayer({ untagged: true, reader: false, encoding: "cityparquet" });
    render(<ToolView toolId="measure-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
    expect(
      screen.getByText(
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityParquet",
      ),
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

describe("Validate solids, switched on", () => {
  it("shares the solids LoD answer and promises §7.3's seven columns", () => {
    addSolidLayer();
    render(<ToolView toolId="validate-solids" />);
    expect(
      [
        ...screen
          .getByRole("combobox", { name: "LoD" })
          .querySelectorAll("option"),
      ].map((o) => o.textContent),
    ).toEqual([
      "2.2 (1 building with a solid)",
      "1.2 (1 building with a solid)",
    ]);
    expect(
      screen.getByText(
        "solid_closed, solid_manifold, solid_oriented, solid_valid, solid_open_edges_n, solid_nonmanifold_edges_n, solid_degenerate_faces_n",
      ),
    ).toBeInTheDocument();
  });

  it("has a PARAMETERS section that is one note, and Run is enabled", () => {
    addSolidLayer();
    render(<ToolView toolId="validate-solids" />);
    expect(
      screen.getByText("Validity is always written as <prefix>valid."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("freezes the LoD and §7.3's typed columns, with no parameters", () => {
    const id = addSolidLayer();
    render(<ToolView toolId="validate-solids" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "validate-solids",
        targetLayerId: id,
        lod: "2.2",
        prefix: "solid_",
        params: {},
        columns: [
          { name: "solid_closed", type: "BOOLEAN" },
          { name: "solid_manifold", type: "BOOLEAN" },
          { name: "solid_oriented", type: "BOOLEAN" },
          { name: "solid_valid", type: "BOOLEAN" },
          { name: "solid_open_edges_n", type: "DOUBLE" },
          { name: "solid_nonmanifold_edges_n", type: "DOUBLE" },
          { name: "solid_degenerate_faces_n", type: "DOUBLE" },
        ],
      }),
    );
  });

  it("claims NOTHING about a streaming target's geometry", () => {
    // The gate `ToolView` applies to every LoD-bearing tool: a target the tool
    // is REFUSED on gets no LoD control and no verdict about its geometry,
    // only §5's real reason.
    addSolidLayer({
      isStreaming: true,
      reader: false,
      encoding: "flatcitybuf",
    });
    render(<ToolView toolId="validate-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
    expect(
      screen.getByText(
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from a streaming FlatCityBuf",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("shows §6's empty state and blocks Run when nothing has a solid", () => {
    addSolidLayer({ solids: false });
    render(<ToolView toolId="validate-solids" />);
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
});
