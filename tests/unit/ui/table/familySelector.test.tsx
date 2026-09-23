/**
 * The table panel, for a layer that is a SET of object families.
 *
 * Three questions this file pins, all of them about honesty rather than data:
 * which family the panel is showing (and how the user changes it), whether the
 * "Buildings" reading is offered at all (a bridge table has no root Buildings,
 * so it would count zero of them), and what a family whose view has never been
 * created says — an explicit "Load table", never a spinner that never resolves
 * and never an error about a table nobody asked for yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn(
  async (_sql: string) =>
    ({ ok: true, columns: ["n"], rows: [{ n: 2 }] }) as unknown,
);
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "ready" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: true }) as const),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  registerParquetUrl: vi.fn(async () => ({ ok: true }) as const),
  registerParquetFile: vi.fn(async () => ({ ok: true }) as const),
  dropRegisteredFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const ensureFamilyView = vi.fn(
  async (_input: unknown) => ({ ok: true }) as const,
);
vi.mock("../../../../src/insights/familyViews", () => ({
  ensureFamilyView: (input: unknown) => ensureFamilyView(input),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));

const { TablePanel } = await import("../../../../src/ui/table/TablePanel");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useFamilyStore, buildLayerFamilies, resetFamilyStoreForTest } =
  await import("../../../../src/features/layers/familyStore");
const { useLayerTableStore, layerTableKey } =
  await import("../../../../src/insights/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { LayerTable } from "../../../../src/insights/layerTables";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { DuckDBStatus } from "../../../../src/insights/duckdb";

const READY: DuckDBStatus = {
  state: "ready",
  extensions: {
    cityjson: { state: "loaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
  platform: "wasm_eh",
} as unknown as DuckDBStatus;

function table(name: string): LayerTable {
  return {
    table: name,
    sourceName: `${name}.parquet`,
    source: null,
    reader: null,
    extension: null,
    sourceBytes: null,
    columns: [
      { name: "id", type: "VARCHAR", kind: "scalar" },
      { name: "object_type", type: "VARCHAR", kind: "scalar" },
    ],
    lods: [],
    sourceFeatureIds: null,
    rowCount: 2,
    fileBacked: true,
    sourceCrs: "EPSG:6697",
  };
}

const MODEL = {
  sourceEncoding: "cityparquet",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
} as unknown as CityModel;

/** A streamed package of Building + Bridge, with Building's view ready. */
function seed(over: { readonly bridgeReady?: boolean } = {}): void {
  const families = buildLayerFamilies([
    {
      key: "building",
      href: "building.parquet",
      size: null,
      source: { url: "https://x/building.parquet" },
    },
    {
      key: "bridge",
      href: "bridge.parquet",
      size: null,
      source: { url: "https://x/bridge.parquet" },
    },
  ]);
  useFamilyStore.getState().setFamilies("L", families);
  useLayerStore.setState({
    layers: [
      {
        id: "L",
        name: "yokohama",
        model: MODEL,
        modelRef: { type: "url", url: "https://x/" },
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
        isStreaming: true,
        visibleObjectIds: null,
      } as unknown as Layer,
    ],
  });
  useWorkspaceStore.setState({ activeLayerId: "L" });
  useLayerTableStore.setState({
    tables: {
      [layerTableKey("L", "building")]: {
        state: "ready",
        info: table("family_building"),
      },
      ...(over.bridgeReady === true
        ? {
            [layerTableKey("L", "bridge")]: {
              state: "ready" as const,
              info: table("family_bridge"),
            },
          }
        : {}),
    },
  });
  useFamilyStore.getState().setFamilyTableState("L", "building", "ready");
  if (over.bridgeReady === true) {
    useFamilyStore.getState().setFamilyTableState("L", "bridge", "ready");
  }
}

beforeEach(() => {
  runQuery.mockClear();
  ensureFamilyView.mockClear();
  resetFamilyStoreForTest();
  useLayerStore.setState({ layers: [] });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {} });
  useWorkspaceStore.setState({ activeLayerId: null });
});

afterEach(() => {
  cleanup();
});

function panel() {
  render(<TablePanel duckdbStatus={READY} onRetryDuckDB={vi.fn()} />);
}

describe("the table panel's family selector", () => {
  it("offers the layer's families and switches the table to the chosen one", async () => {
    seed({ bridgeReady: true });
    panel();
    const select = (await screen.findByLabelText(
      "Object family",
    )) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Building",
      "Bridge",
    ]);
    expect(select.value).toBe("building");
    fireEvent.change(select, { target: { value: "bridge" } });
    expect(useFamilyStore.getState().layers.L!.active).toBe("bridge");
    await waitFor(() => {
      const sql = runQuery.mock.calls.map((c) => String(c[0])).join("\n");
      expect(sql).toContain("family_bridge");
    });
  });

  it("offers the Buildings reading only for a family that holds Buildings", async () => {
    seed({ bridgeReady: true });
    panel();
    // Building family: the raw/buildings switch is there.
    expect(
      await screen.findByRole("button", { name: /raw objects/i }),
    ).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Object family"), {
      target: { value: "bridge" },
    });
    // A bridge table has no root Buildings, so the reading is not offered and
    // the family is browsed raw — never a "Buildings" view that counts zero.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /raw objects/i })).toBeNull();
    });
    expect(
      useQueryStore.getState().queries[layerTableKey("L", "bridge")]?.view,
    ).toBe("raw");
  });

  it("says a family's table is not loaded, and loads it on demand", async () => {
    // The bridge family has NO view: its ensure found the engine down, or the
    // user gave the table up again. That is an empty state with an action — not
    // an endless "building this layer's table…", which is what a reader that
    // only knew the registry would show for ever.
    seed();
    useFamilyStore.getState().setActiveFamily("L", "bridge");
    await waitFor(() =>
      expect(useFamilyStore.getState().layers.L!.table.bridge).toBe("ready"),
    );
    useFamilyStore.getState().setFamilyTableState("L", "bridge", "absent");
    panel();
    expect(await screen.findByText(/table has not been loaded/i)).toBeTruthy();
    ensureFamilyView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Load table" }));
    await waitFor(() => expect(ensureFamilyView).toHaveBeenCalledTimes(1));
    expect(ensureFamilyView.mock.calls[0]?.[0]).toMatchObject({
      layerId: "L",
      family: "bridge",
    });
  });

  it("says so when a family's view could not be created", async () => {
    seed();
    useFamilyStore.getState().setActiveFamily("L", "bridge");
    await waitFor(() =>
      expect(useFamilyStore.getState().layers.L!.table.bridge).toBe("ready"),
    );
    useFamilyStore.getState().setFamilyTableState("L", "bridge", "failed");
    panel();
    expect(await screen.findByText(/could not be created/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load table" })).toBeTruthy();
  });

  it("never calls a family's table partial — it reads the whole file", async () => {
    // "currently loaded" is true of a FlatCityBuf layer's resident table and
    // false of a family view (ruling R-B′), which is the whole point of the
    // milestone. "Table only" stays: map filtering is off for every stream.
    seed({ bridgeReady: true });
    panel();
    await screen.findByLabelText("Object family");
    await waitFor(() => expect(screen.getByText(/Table only/)).toBeTruthy());
    expect(document.body.textContent).not.toContain("currently loaded");
  });

  it("shows no family selector for a layer with one table", async () => {
    useLayerStore.setState({
      layers: [
        {
          id: "P",
          name: "delft",
          model: MODEL,
          modelRef: { type: "url", url: "https://x/a.city.json" },
          visible: true,
          rules: [],
          hiddenTypes: [],
          availableObjectTypes: [],
          availableLods: [],
          appearanceThemes: [],
          isStreaming: false,
          visibleObjectIds: null,
        } as unknown as Layer,
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: "P" });
    useLayerTableStore.setState({
      tables: { P: { state: "ready", info: table("layer_1") } },
    });
    panel();
    await waitFor(() => expect(runQuery).toHaveBeenCalled());
    expect(screen.queryByLabelText("Object family")).toBeNull();
  });
});
