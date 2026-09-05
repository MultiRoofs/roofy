/**
 * The panel's STATES. Data itself is `useLayerQuery`'s test; this file is
 * about what the user sees when the engine is down, the table is still
 * building, the build failed, or nothing is selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
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
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { DuckDBStatus } from "../../../../src/analytics/duckdb";

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
  render(
    <TablePanel
      duckdbStatus={status}
      onRetryDuckDB={onRetry}
      onCollapse={() => {}}
      onHeightChange={() => {}}
    />,
  );
  return { onRetry };
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
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useQueryStore.setState({ queries: {} });
  useSelectionStore.setState({ selections: [] });
});

afterEach(cleanup);

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
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
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
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    panel({ state: "initializing" });
    expect(screen.getByText("Starting the analytics engine…")).toBeTruthy();
    expect(screen.queryByText(/could not be built/)).toBeNull();
  });

  it("shows a spinner while the table is building", () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({ tables: { L: { state: "building" } } });
    panel();
    expect(screen.getByText("Building this layer's table…")).toBeTruthy();
  });

  it("shows the build failure and offers no grid", () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    panel();
    expect(screen.getByRole("alert").textContent).toContain(
      "Binder Error: nope",
    );
  });

  it("renders the layer's name and its rows once ready", async () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    expect(await screen.findByText("B1")).toBeTruthy();
    expect(screen.getByText("delft")).toBeTruthy();
    expect(screen.getByText("1–2 of 2")).toBeTruthy();
    // The header counts the LAYER, before any filter — see (D).
    expect(document.querySelector(".table-count")!.getAttribute("title")).toBe(
      "Rows in this layer's table, before any filter",
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
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
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

    expect(await screen.findByText("(2,231 rows)")).toBeTruthy();
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByText("filtered from 2,231")).toBeTruthy();
  });

  it("selects a city object when a row is clicked with Sync selection on", async () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    fireEvent.click(await screen.findByText("B1"));
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "L", objectId: "B1" },
    ]);
  });

  it("explains an EMPTY filtered result while Filter map is on", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 0 : 2231 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap("L", true);
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
        "0 of 2,231 rows match; the map shows nothing while Filter map is on",
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
      activeLayerId: "L",
    });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    // "No rows match this filter" over a table that has no rows — a streaming
    // layer whose first cells have not landed — is simply untrue.
    expect(await screen.findByText("This layer has no rows yet.")).toBeTruthy();
  });

  it("says only 'no rows match' when the map is NOT being filtered", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 0 : 2231 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
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
    expect(await screen.findByText("No rows match this filter.")).toBeTruthy();
  });

  it("disables the Filter map toggle for a streaming layer, and says why", () => {
    useLayerStore.setState({
      layers: [layer({ isStreaming: true })],
      activeLayerId: "L",
    });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    const toggle = screen.getByLabelText("Filter map") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.closest("label")!.title).toBe(
      "Map filtering is not available for streaming layers yet",
    );
  });

  it("ENABLES the Filter map toggle for a static layer with a ready table", async () => {
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    panel();
    const toggle = screen.getByLabelText("Filter map") as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    // No streaming reason on a layer that is not streaming.
    expect(toggle.closest("label")!.title).toBe("");

    fireEvent.click(toggle);
    expect(useQueryStore.getState().queries.L?.syncToMap).toBe(true);
  });

  it("drives the map filter from the applied filter, and again when the table is REBUILT", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 1 }] }
        : sql.startsWith('SELECT "id" FROM')
          ? { ok: true, columns: ["id"], rows: [{ id: "B1" }] }
          : { ok: true, columns: [], rows: [] },
    );
    useLayerStore.setState({ layers: [layer()], activeLayerId: "L" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    useQueryStore.getState().setSyncToMap("L", true);
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [
        { id: "c", column: "object_type", op: "=", value: "Building" },
      ],
    });
    useQueryStore.getState().applyFilter("L");

    panel();
    await waitFor(() => {
      const ids = useLayerStore.getState().layers[0]!.visibleObjectIds;
      expect(ids === null ? null : [...ids]).toEqual(["B1"]);
    });

    // A REBUILD mints a new `layer_<n>`, and the effect keys on the table
    // OBJECT so the ids are recomputed against the table that now exists.
    const idQueries = () =>
      runQuery.mock.calls
        .map((args) => String(args[0]))
        .filter((sql) => sql.startsWith('SELECT "id" FROM'));
    expect(idQueries().at(-1)).toContain('FROM "layer_1"');

    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: { ...TABLE, table: "layer_2" } } },
    });
    await waitFor(() => expect(idQueries().at(-1)).toContain('FROM "layer_2"'));
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
