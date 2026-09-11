import { ActiveLayerPanel } from "../../../../src/ui/layers/ActiveLayerPanel";
/**
 * The panel's STATES. Data itself is `useLayerQuery`'s test; this file is
 * about what the user sees when the engine is down, the table is still
 * building, the build failed, or nothing is selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { TablePanel } = await import("../../../../src/ui/table/TablePanel");
const { SummaryView } = await import("../../../../src/ui/drawer/SummaryView");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
const { useShellStore, defaultShellState } =
  await import("../../../../src/ui/shell/shellStore");
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { DuckDBStatus } from "../../../../src/insights/duckdb";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { DEFAULT_LAYER_QUERY } from "../../../../src/features/query/types";

const READY_STATUS: DuckDBStatus = {
  state: "ready",
  extensions: {
    cityjson: { state: "loaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
  platform: "wasm_eh",
};

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [],
  rowCount: 2,
};

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "delft",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

function panel(status: DuckDBStatus = READY_STATUS) {
  const onRetry = vi.fn();
  render(<TablePanel duckdbStatus={status} onRetryDuckDB={onRetry} />);
  return { onRetry };
}

function buildingModel(id: string): CityModel {
  return {
    ...emptyModel(),
    objects: {
      [id]: {
        id,
        objectType: "Building",
        attributes: {},
        surfaces: [],
        children: [],
        parents: [],
      },
    },
  } as unknown as CityModel;
}

beforeEach(() => {
  runQuery.mockReset();
  runQuery.mockImplementation(async (sql: string) =>
    sql.includes("COUNT(*)")
      ? { ok: true, columns: ["n"], rows: [{ n: 2 }] }
      : {
          ok: true,
          columns: [],
          rows: [
            { id: "B1", object_type: "Building" },
            { id: "B2", object_type: "BuildingPart" },
          ],
        },
  );
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useQueryStore.setState({ queries: {} });
  useSelectionStore.setState({ selections: [] });
  useStreamStore.setState({ streams: {} });
  // jsdom is 1024×768, below both of `defaultShellState`'s breakpoints.
  useShellStore.setState({ ...defaultShellState(1440, 900), drawerOpen: true });
});

afterEach(cleanup);

describe("Layer panel — the export dialog", () => {
  it("closes it when the active layer changes under it", async () => {
    // The dialog is about ONE layer: its table, its types, its LoD ladder. A
    // layer switch behind an open dialog would leave it pointed at the old
    // table while its heading named the new layer.
    useLayerStore.setState({
      layers: [layer(), layer({ id: "L2", name: "rotterdam" })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: {
        L: { state: "ready", info: TABLE },
        L2: { state: "ready", info: { ...TABLE, table: "layer_2" } },
      },
    });
    useShellStore.getState().closeDrawer();
    render(<ActiveLayerPanel onZoomToLayer={() => {}} />);
    expect(useShellStore.getState().drawerOpen).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    useWorkspaceStore.setState({ activeLayerId: "L2" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("TablePanel states", () => {
  it("offers a Retry when the engine failed to start", () => {
    const { onRetry } = panel({ state: "failed", error: "no wasm" });
    expect(screen.getByText(/no wasm/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says so when no layer is selected", () => {
    panel();
    expect(
      screen.getByText("Select a layer to browse its table."),
    ).toBeTruthy();
  });

  it("does NOT offer a Retry while the engine is still starting", () => {
    // The cold boot is ~3.5 s. "The analytics engine is not running" with a
    // Retry button, for three and a half seconds of every session, is a lie.
    panel({ state: "initializing" });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/is not running/)).toBeNull();
  });

  it("shows a DuckDB page error in the BODY, with the filter bar closed", async () => {
    runQuery.mockResolvedValue({
      ok: false,
      message: "Conversion Error: could not convert",
    });
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    // The bar is collapsed by default, so its inline alert is off screen —
    // without the body copy the grid would simply go stale in silence.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Conversion Error: could not convert");
    // And it replaces the empty-grid sentence rather than sitting above it:
    // a page error is not a claim about the layer's contents.
    expect(screen.queryByText("This layer has no rows yet.")).toBeNull();
    expect(screen.queryByText("No rows match this filter.")).toBeNull();
    expect(document.querySelector(".data-table")).toBeNull();
  });

  it("shows the engine starting, over a table left failed by the outage", () => {
    // A Retry sets the status back to `initializing` while every table is
    // still `failed` from the outage. "This layer's table could not be built"
    // over a retry in progress reads as a Retry that did nothing.
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    panel({ state: "initializing" });
    expect(screen.getByText("Starting the analytics engine…")).toBeTruthy();
    expect(screen.queryByText(/could not be built/)).toBeNull();
  });

  it("shows a spinner while the table is building", () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({ tables: { L: { state: "building" } } });
    panel();
    expect(screen.getByText("Building this layer's table…")).toBeTruthy();
  });

  it("shows the build failure and offers no grid", () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    panel();
    expect(screen.getByRole("alert").textContent).toContain(
      "Binder Error: nope",
    );
  });

  it("renders the layer's name and its rows once ready", async () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(await screen.findByText("B1")).toBeTruthy();
    expect(screen.getByText("delft")).toBeTruthy();
    expect(screen.getByText("1–2 of 2")).toBeTruthy();
    // The header counts the LAYER, before any filter — see (D).
    expect(document.querySelector(".table-count")!.getAttribute("title")).toBe(
      "All buildings, before any filter",
    );
  });

  it("heads with the UNFILTERED size while the footer counts the matches", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 1 : 2231 }],
          }
        : {
            ok: true,
            columns: [],
            rows: [{ id: "B1", object_type: "Building" }],
          },
    );
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Building" },
      ],
    });
    useQueryStore.getState().applyFilter("L");
    panel();

    expect(
      await screen.findByText(/All 1 · Matching 1 · Selected 1 buildings/),
    ).toBeTruthy();
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByText("filtered from 1")).toBeTruthy();
  });

  it("selects a city object when a row is clicked", async () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    fireEvent.click(await screen.findByText("B1"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "B1" },
    ]);
  });

  it("offers no way to detach the table from the scene selection", () => {
    // There was a "Sync selection" checkbox, and turning it off gave the grid
    // a SECOND selection of its own — one highlighted in the table, another in
    // the viewport, neither telling the user which one the inspector meant.
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(screen.queryByText("Sync selection")).toBeNull();
  });

  it("still writes the global selection after the panel has re-mounted", async () => {
    // The old local `tableSelection` state died with the component; the global
    // store is the only thing a collapse-and-reopen must not be able to lose.
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    cleanup();
    panel();
    fireEvent.click(await screen.findByText("B2"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "B2" },
    ]);
  });

  it("explains an EMPTY filtered result with no matching map features", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 0 : 2231 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Nothing" },
      ],
    });
    useQueryStore.getState().applyFilter("L");

    panel();
    expect(
      await screen.findByText(
        "0 of 0 rows match; the map shows no matching features",
      ),
    ).toBeTruthy();
  });

  it("says the TABLE is empty when there is no filter at all", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 0 }] }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({
      layers: [layer({ isStreaming: true })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    // "No rows match this filter" over a table that has no rows — a streaming
    // layer whose first cells have not landed — is simply untrue.
    expect(await screen.findByText("This layer has no rows yet.")).toBeTruthy();
  });

  it("states that static filters apply to map and table automatically", async () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(await screen.findByText("Map + table")).toBeTruthy();
    expect(screen.queryByLabelText("Filter map")).toBeNull();
  });

  it("keeps a streaming filter table-only", async () => {
    useLayerStore.setState({ layers: [layer({ isStreaming: true })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(
      await screen.findByText("Table only · currently loaded"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Filter map")).toBeNull();
  });

  it("does not own map-filter synchronization", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : sql.startsWith('SELECT "id" FROM')
          ? { ok: true, columns: ["id"], rows: [{ id: "B1" }] }
          : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Building" },
      ],
    });
    useQueryStore.getState().applyFilter("L");

    panel();
    await screen.findByText("delft");
    expect(useLayerStore.getState().layers[0]!.visibleObjectIds).toBeNull();
  });

  it("tells the registry the panel is open, and shut on unmount", async () => {
    panel();
    await waitFor(() =>
      expect(useLayerTableStore.getState().tablePanelOpen).toBe(true),
    );
    cleanup();
    expect(useLayerTableStore.getState().tablePanelOpen).toBe(false);
  });
});

describe("TablePanel — the shell's drawer", () => {
  it("closes the drawer itself when Collapse is clicked", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Collapse table" }));
    expect(useShellStore.getState().drawerOpen).toBe(false);
  });

  it("resizes the drawer by dragging its top edge UP", () => {
    panel();
    const handle = screen.getByRole("separator", { name: "Resize table" });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientY: 460, pointerId: 1 }),
    );
    expect(useShellStore.getState().drawerHeight).toBe(320);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  });

  it("widens the drawer with ArrowUp and respects its viewport ceiling", () => {
    panel();
    const handle = screen.getByRole("separator", { name: "Resize table" });

    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(useShellStore.getState().drawerHeight).toBe(296);
    fireEvent.keyDown(handle, { key: "End" });
    expect(useShellStore.getState().drawerHeight).toBe(568);
    fireEvent.keyDown(handle, { key: "PageUp" });
    expect(useShellStore.getState().drawerHeight).toBe(568);
  });
});

describe("SummaryView matching state", () => {
  const applied = {
    logic: "AND" as const,
    conditions: [
      { id: "type", column: "object_type", op: "=", value: "Building" },
    ],
  } as const;

  it("shows a query failure instead of a false zero matching count", async () => {
    runQuery.mockResolvedValue({ ok: false, message: "Binder Error: broken" });
    render(
      <SummaryView
        layer={layer({ model: buildingModel("B1") })}
        query={{ ...DEFAULT_LAYER_QUERY, applied }}
        table={TABLE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Matching" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Binder Error: broken",
    );
  });

  it("resets Matching to All when the filter is cleared", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }],
    });
    const { rerender } = render(
      <SummaryView
        layer={layer({ model: buildingModel("B1") })}
        query={{ ...DEFAULT_LAYER_QUERY, applied }}
        table={TABLE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Matching" }));
    await screen.findByText("1 matching buildings");
    rerender(
      <SummaryView
        layer={layer({ model: buildingModel("B1") })}
        query={DEFAULT_LAYER_QUERY}
        table={TABLE}
      />,
    );
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("1 buildings")).toBeTruthy();
  });

  it("does not retain matching state after switching layers", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["id"],
      rows: [{ id: "B1" }],
    });
    const { rerender } = render(
      <SummaryView
        layer={layer({ id: "L", model: buildingModel("B1") })}
        query={{ ...DEFAULT_LAYER_QUERY, applied }}
        table={TABLE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Matching" }));
    await screen.findByText("1 matching buildings");
    rerender(
      <SummaryView
        layer={layer({ id: "L2", model: buildingModel("B2") })}
        query={DEFAULT_LAYER_QUERY}
        table={TABLE}
      />,
    );
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("1 buildings")).toBeTruthy();
  });
});

describe("TablePanel raw target", () => {
  it("shows and clears an exact raw-object target without clearing the applied filter", () => {
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "height", column: "object_type", op: "=", value: "Building" },
      ],
    });
    useQueryStore.getState().applyFilter("L");
    const applied = useQueryStore.getState().queries.L!.applied;
    useQueryStore.getState().navigateRawObject("L", "child-off-page");
    panel();
    expect(screen.getByText("Viewing raw object child-off-page")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Return to filtered records" }),
    );
    expect(useQueryStore.getState().queries.L!.rawObjectId).toBeNull();
    expect(useQueryStore.getState().queries.L!.applied).toBe(applied);
  });
});

describe("TablePanel columns and child records", () => {
  const extendedTable = {
    ...TABLE,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" as const },
      { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
      { name: "custom_source", type: "VARCHAR", kind: "scalar" as const },
      { name: "__roofy_roof_area", type: "DOUBLE", kind: "scalar" as const },
      { name: "height", type: "DOUBLE", kind: "scalar" as const },
    ],
  };

  it("keeps selected derived columns when a custom source field is chosen", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : {
            ok: true,
            columns: [],
            rows: [
              { id: "B1", object_type: "Building", custom_source: "kept" },
            ],
          },
    );
    useLayerStore.setState({ layers: [layer({ model: buildingModel("B1") })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: extendedTable } },
    });
    panel();
    await screen.findByText("B1");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const derived = screen.getByRole("checkbox", { name: /Roof area/ });
    expect(derived).toBeChecked();
    fireEvent.click(screen.getByLabelText("custom_source"));
    expect(screen.getByRole("checkbox", { name: /Roof area/ })).toBeChecked();
    expect((await screen.findAllByText("Roof area")).length).toBeGreaterThan(0);
  });

  it("keeps a raw source __roofy collision literal and exposes structural columns", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : {
            ok: true,
            columns: [],
            rows: [
              {
                id: "P1",
                object_type: "BuildingPart",
                __roofy_roof_area: 77,
                custom_source: "raw",
              },
            ],
          },
    );
    useLayerStore.setState({ layers: [layer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: extendedTable } },
    });
    useQueryStore.getState().setView("L", "raw");
    panel();
    expect(await screen.findByText("P1")).toBeTruthy();
    expect(screen.getByText("__roofy_roof_area")).toBeTruthy();
    expect(screen.getByText("77")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByLabelText("object_type")).toBeChecked();
  });

  it("expands a resident child with its loaded attributes and selects its exact id", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : {
            ok: true,
            columns: [],
            rows: [{ id: "B1", object_type: "Building", height: 10 }],
          },
    );
    const resident = {
      objects: {
        B1: {
          id: "B1",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          children: ["P1"],
          parents: [],
        },
        P1: {
          id: "P1",
          objectType: "BuildingPart",
          attributes: { height: 23 },
          surfaces: [],
          children: [],
          parents: ["B1"],
        },
      },
      cellCount: 1,
      featureCount: 1,
      surfaceAttrKeys: [],
    };
    useLayerStore.setState({ layers: [layer({ isStreaming: true })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: extendedTable } },
    });
    useQueryStore.getState().setColumns("L", ["id", "height"]);
    useStreamStore.setState({
      streams: {
        L: { handle: { getResidentModel: () => resident }, version: 0 },
      } as never,
    });
    panel();
    fireEvent.click(await screen.findByLabelText("Toggle parts for B1"));
    expect(screen.getByText("23")).toBeTruthy();
    fireEvent.click(screen.getByText("↳ P1"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "P1" },
    ]);
  });

  it("expands a static child with its attributes and selects its exact id", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : {
            ok: true,
            columns: [],
            rows: [{ id: "B1", object_type: "Building", height: 10 }],
          },
    );
    const model = {
      ...emptyModel(),
      objects: {
        B1: {
          id: "B1",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          children: ["P1"],
          parents: [],
        },
        P1: {
          id: "P1",
          objectType: "BuildingPart",
          attributes: { height: 22 },
          surfaces: [],
          children: [],
          parents: ["B1"],
        },
      },
    } as unknown as CityModel;
    useLayerStore.setState({ layers: [layer({ model })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: extendedTable } },
    });
    useQueryStore.getState().setColumns("L", ["id", "height"]);
    panel();
    fireEvent.click(await screen.findByLabelText("Toggle parts for B1"));
    expect(screen.getByText("22")).toBeTruthy();
    fireEvent.click(screen.getByText("↳ P1"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "P1" },
    ]);
  });
});

it("returns from Summary to Records when filter setup is requested", async () => {
  useLayerStore.setState({ layers: [layer()] });
  useWorkspaceStore.setState({ activeLayerId: "L" });
  useLayerTableStore.setState({
    tables: { L: { state: "ready", info: TABLE } },
  });
  panel();
  fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
  expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  act(() => useShellStore.getState().openFilter());
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Records" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
});

it("keeps column picker and table in the same chosen order", async () => {
  runQuery.mockImplementation(async (sql: string) =>
    sql.includes("COUNT(*)")
      ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
      : {
          ok: true,
          columns: [],
          rows: [{ id: "B1", object_type: "Building" }],
        },
  );
  useLayerStore.setState({ layers: [layer()] });
  useWorkspaceStore.setState({ activeLayerId: "L" });
  useLayerTableStore.setState({
    tables: { L: { state: "ready", info: TABLE } },
  });
  useQueryStore.getState().setColumns("L", ["id", "object_type"]);
  panel();
  await screen.findByText("B1");
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByRole("button", { name: "Move object_type up" }));
  expect(useQueryStore.getState().queries.L!.columns).toEqual([
    "object_type",
    "id",
  ]);
  expect(
    screen.getAllByRole("columnheader").map((el) => el.textContent),
  ).toEqual(["object_type", "id"]);
  const boxes = document.querySelectorAll(
    ".columns-popover input[type=checkbox]",
  );
  expect(boxes[0]?.parentElement?.textContent).toBe("object_type");
  expect(boxes[1]?.parentElement?.textContent).toBe("id");
});

it("reveals the map when the expanded table separator is dragged down", () => {
  useShellStore.setState({ drawerExpanded: true, drawerHeight: 280 });
  render(<TablePanel duckdbStatus={READY_STATUS} onRetryDuckDB={vi.fn()} />);
  const handle = screen.getByRole("separator", { name: "Resize table" });
  fireEvent.pointerDown(handle, { clientY: 44, pointerId: 1 });
  window.dispatchEvent(new PointerEvent("pointermove", { clientY: 144 }));
  window.dispatchEvent(new PointerEvent("pointerup"));
  expect(useShellStore.getState().drawerExpanded).toBe(false);
  expect(useShellStore.getState().drawerHeight).toBeGreaterThan(280);
});
it("can drag back upward after leaving expanded mode in the same gesture", () => {
  useShellStore.setState({ drawerExpanded: true, drawerHeight: 280 });
  render(<TablePanel duckdbStatus={READY_STATUS} onRetryDuckDB={vi.fn()} />);
  const handle = screen.getByRole("separator", { name: "Resize table" });
  const max = Number(handle.getAttribute("aria-valuemax"));
  fireEvent.pointerDown(handle, { clientY: 44, pointerId: 1 });
  act(() =>
    window.dispatchEvent(new PointerEvent("pointermove", { clientY: 144 })),
  );
  act(() =>
    window.dispatchEvent(new PointerEvent("pointermove", { clientY: 44 })),
  );
  window.dispatchEvent(new PointerEvent("pointerup"));
  expect(useShellStore.getState().drawerHeight).toBe(max);
});
