/**
 * The catalogue's copy and behaviour (spec §5): the three group headings, a
 * disabled row that still opens the tool view, the search filter and its
 * empty message, and the empty history line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";

vi.mock("../../../../src/insights/duckdb", () => ({
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
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

const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function addCityLayer(): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name: "two-buildings",
    model,
    modelRef: { type: "url", url: "https://x/two-buildings.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useShellStore.getState().setRightCollapsed(false);
});

describe("CatalogueView", () => {
  it("lists the three groups and marks unavailable tools with a reason", () => {
    addCityLayer();
    render(<CatalogueView />);
    expect(screen.getByText("ROOF")).toBeInTheDocument();
    expect(screen.getByText("3D MEASUREMENTS")).toBeInTheDocument();
    expect(screen.getByText("CROSS-LAYER")).toBeInTheDocument();
    const height = screen.getByRole("button", { name: /Height from extent/ });
    expect(height).not.toHaveAttribute("aria-disabled", "true");
    const join = screen.getByRole("button", {
      name: /Join attributes by location/,
    });
    expect(join).toHaveAttribute("aria-disabled", "true");
    // Every tool but Height from extent is still unimplemented, so that is the
    // reason `toolEligibility` returns for the rest of the catalogue. The
    // spec's per-cause copy is pinned in `eligibility.test.ts`; what this
    // asserts is that a disabled row RENDERS its reason as a second line.
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThan(0);
  });

  it("carries the capability chip and its cost tooltip", () => {
    addCityLayer();
    render(<CatalogueView />);
    const join = screen.getByRole("button", {
      name: /Join attributes by location/,
    });
    const chip = join.querySelector(".processing-chip");
    expect(chip?.textContent).toBe("Spatial");
    expect(chip).toHaveAttribute(
      "title",
      "Loads the spatial extension on first run (about 24 MB, once per session)",
    );
    expect(
      screen
        .getByRole("button", { name: /Measure solids/ })
        .querySelector(".processing-chip")?.textContent,
    ).toBe("3D");
    expect(
      screen
        .getByRole("button", { name: /Height from extent/ })
        .querySelector(".processing-chip"),
    ).toBeNull();
  });

  it("filters by search and shows the empty message", () => {
    addCityLayer();
    render(<CatalogueView />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tools" }), {
      target: { value: "buffer" },
    });
    expect(
      screen.getByText(
        "No tool matches 'buffer'. Footprint operations arrive in a later release.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("ROOF")).toBeNull();
  });

  it("hides a group heading with no match", () => {
    addCityLayer();
    render(<CatalogueView />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tools" }), {
      target: { value: "roof" },
    });
    expect(screen.getByText("ROOF")).toBeInTheDocument();
    expect(screen.queryByText("CROSS-LAYER")).toBeNull();
  });

  it("opens the tool view on click, even for a disabled row", () => {
    addCityLayer();
    render(<CatalogueView />);
    fireEvent.click(screen.getByRole("button", { name: /Join attributes/ }));
    expect(useProcessingStore.getState().view).toEqual({
      kind: "tool",
      toolId: "join-by-location",
    });
  });

  it("expands a collapsed right panel when it opens a tool view", () => {
    addCityLayer();
    useShellStore.getState().setRightCollapsed(true);
    render(<CatalogueView />);
    fireEvent.click(screen.getByRole("button", { name: /Height from extent/ }));
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("shows the empty history text", () => {
    addCityLayer();
    render(<CatalogueView />);
    expect(screen.getByText("Runs you start appear here")).toBeInTheDocument();
  });

  it("needs a city model layer when nothing is active", () => {
    render(<CatalogueView />);
    expect(
      screen.getByRole("button", { name: /Height from extent/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getAllByText("Needs a city model layer").length,
    ).toBeGreaterThan(0);
  });
});
