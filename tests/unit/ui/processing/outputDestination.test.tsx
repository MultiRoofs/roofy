/**
 * Spec §6's OUTPUT destination: two radios, the Name field and its two
 * validation messages, the replace warning scoped to the copy, and the
 * `destination` / `newLayerName` the form freezes into the request.
 *
 * The run queue is mocked: what this pins is the REQUEST the form builds and
 * the copy on screen, never the execution (a later task owns that).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

// The mock block is `ToolView.test.tsx`'s, repeated rather than shared: a
// fixture module between two suites is a third thing to keep in step.
vi.mock("../../../../src/insights/duckdb", async () => ({
  formatDuckDBError: (
    await vi.importActual<typeof import("../../../../src/insights/duckdb")>(
      "../../../../src/insights/duckdb",
    )
  ).formatDuckDBError,
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
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { TOOLS } =
  await import("../../../../src/features/processing/toolRegistry");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function column(name: string): ColumnInfo {
  return { name, type: "DOUBLE", kind: "scalar" };
}

function addCityLayer(
  name = "Delft",
  columns: ReadonlyArray<ColumnInfo> = [],
  isStreaming = false,
): string {
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
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming,
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      ...useLayerTableStore.getState().tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          extension: null,
          sourceBytes: null,
          columns,
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** A prepared GeoJSON polygon layer — §7.6's TARGET needs areas. */
function addZones(name = "Zones"): string {
  return useGeoLayerStore.getState().addGeoLayer({
    kind: "geojson",
    name,
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: `${name}-1`,
            properties: { zone: "A" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [4, 52],
                  [5, 52],
                  [5, 53],
                  [4, 52],
                ],
              ],
            },
          },
        ],
      },
    },
  });
}

const newLayerRadio = () =>
  screen.getByRole("radio", { name: "New layer" }) as HTMLInputElement;
const thisLayerRadio = () =>
  screen.getByRole("radio", { name: /^This layer/ }) as HTMLInputElement;

/**
 * Give ONE tool the `"new"` destination for the length of one case.
 *
 * This task deliberately ships `destinations: ["layer"]` on all seven entries —
 * the alternative, shipping `"new"` early so a test can click the radio, is
 * exactly the "radio reachable before the executor" a reviewer must reject. So
 * the cases that exercise the Name field override the registry entry for their
 * own duration and put it back. `vi.spyOn(tool, "destinations", "get")` cannot
 * be used: `destinations` is a data property on an object literal, not an
 * accessor. The later tasks delete this helper with the last `["layer"]`.
 */
function withNewLayer(toolId: string, body: () => void): void {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`no tool ${toolId}`);
  const before = tool.destinations;
  const set = (value: ReadonlyArray<string>) =>
    Object.defineProperty(tool, "destinations", {
      value,
      configurable: true,
      writable: true,
    });
  set(["layer", "new"]);
  try {
    body();
  } finally {
    set(before);
  }
}

beforeEach(() => {
  counts.all = 2;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useGeoLayerStore.getState().removeAllGeoLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
});

describe("OUTPUT destination", () => {
  it("offers BOTH of §6's radios, with This layer checked", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(thisLayerRadio().checked).toBe(true);
    expect(newLayerRadio().checked).toBe(false);
  });

  it("disables New layer for a tool whose destinations do not include it", () => {
    // The staging gate: every entry is `["layer"]` until the executor tasks
    // flip them, so the radio is visible (§6 draws two) and unreachable.
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(newLayerRadio().disabled).toBe(true);
    expect(screen.queryByText("Name")).toBeNull();
  });

  it("shows the Name field prefilled once New layer is chosen", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      const name = screen.getByLabelText("Name") as HTMLInputElement;
      expect(name.value).toBe("Delft · extent");
    });
  });

  it("prefills a VECTOR target's own name, which `target` does not carry", () => {
    // Residual C2. §7.6 reverses the two layers: the TARGET is the vector
    // layer and the buildings come from a city SOURCE, and the form's `target`
    // is deliberately null for it. A prefill read off `target.name` would be
    // empty here; the one read off `targetName` is §6's "Zones · buildings".
    withNewLayer("aggregate-per-area", () => {
      addCityLayer("Delft");
      addZones();
      render(<ToolView toolId="aggregate-per-area" />);
      fireEvent.click(newLayerRadio());
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Zones · buildings",
      );
    });
  });

  it("flags an EMPTY name inline at Run and refuses to run", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "   " },
      });
      expect(screen.getByRole("alert").textContent).toBe("Name the new layer");
      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    });
  });

  it("flags a name an existing layer already has, GEO layers included", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      useGeoLayerStore.getState().addGeoLayer({
        kind: "geojson",
        name: "Zones",
        config: { data: { type: "FeatureCollection", features: [] } },
      });
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: " zones " },
      });
      expect(screen.getByRole("alert").textContent).toBe(
        "A layer is already called that",
      );
      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    });
  });

  it("scopes the replace warning to the COPY when writing to a new layer", () => {
    withNewLayer("height-from-extent", () => {
      const id = addCityLayer("Delft", [
        column("id"),
        column("extent_height_m"),
        column("extent_zmin_m"),
      ]);
      // Both existing columns are INHERITED computed ones; a source column of
      // the same name is still the prefix error, unchanged.
      for (const name of ["extent_height_m", "extent_zmin_m"]) {
        useComputedColumnStore.getState().setProvenance(id, name, {
          runId: "run_0",
          toolName: "Height from extent",
          summary: "All 2 buildings",
          at: Date.now(),
          partial: null,
          previous: null,
        });
      }
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      expect(
        screen.getByText(
          "2 inherited computed columns will be replaced in the new layer",
        ),
      ).toBeTruthy();
      expect(
        screen.queryByText(/of these columns exist; they will be replaced/),
      ).toBeNull();
    });
  });

  it("freezes the destination and the name into the request", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.submit(screen.getByRole("button", { name: "Run" }));
      expect(vi.mocked(submitRun).mock.calls[0]?.[0]).toMatchObject({
        destination: "new",
        newLayerName: "Delft · extent",
      });
    });
  });

  it("sends destination 'layer' and a null name by default", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.submit(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]?.[0]).toMatchObject({
      destination: "layer",
      newLayerName: null,
    });
  });

  it("refuses New layer on a STREAMING target, with A2's reason", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer("Delft", [], true);
      render(<ToolView toolId="height-from-extent" />);
      expect(newLayerRadio().disabled).toBe(true);
      expect(
        screen.getByText(
          "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
        ),
      ).toBeTruthy();
    });
  });

  it("REFUSES RUN when a chosen New layer is retargeted to a streaming layer", () => {
    // The draft outlives the radio. Disabling the control says nothing about
    // the `destination: "new"` already on the draft, and without this the form
    // would offer Run for a destination it has just declared impossible.
    withNewLayer("height-from-extent", () => {
      const stat = addCityLayer("Delft", []);
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();

      const streaming = addCityLayer("Delft stream", [], true);
      expect(stat).not.toBe(streaming);
      fireEvent.change(screen.getByLabelText("Layer"), {
        target: { value: streaming },
      });

      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
      expect(
        screen.getByText(
          "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
        ),
      ).toBeTruthy();
    });
  });
});
