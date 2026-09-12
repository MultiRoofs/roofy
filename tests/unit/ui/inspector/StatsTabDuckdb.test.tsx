import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const runQuery = vi.fn();
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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

const { StatsTab } = await import("../../../../src/ui/inspector/StatsTab");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");

const model = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
} as unknown as CityModel;

const READY = {
  state: "ready" as const,
  info: {
    table: "layer_7",
    sourceName: null,
    source: null,
    reader: null,
    columns: [
      { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    ],
    lods: [],
    extension: null,
    sourceBytes: null,
    rowCount: 3,
  },
};

beforeEach(() => {
  runQuery.mockReset();
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
});

afterEach(cleanup);

describe("StatsTab's DuckDB section", () => {
  it("queries the LAYER's own table, grouped by object_type", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["object_type", "n"],
      rows: [
        { object_type: "Building", n: 2 },
        { object_type: "BuildingPart", n: 1 },
      ],
    });
    useLayerTableStore.setState({ tables: { L1: READY } });

    render(<StatsTab model={model} selection={null} layerId="L1" />);

    expect(await screen.findByText("DuckDB Analytics")).toBeTruthy();
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "object_type", COUNT(*) AS "n" FROM "layer_7" GROUP BY 1 ORDER BY 2 DESC',
    );
    expect(await screen.findByText("Building")).toBeTruthy();
    expect(screen.getByText("Rows loaded")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("says 'unknown' when the table's COUNT could not be taken", async () => {
    runQuery.mockResolvedValue({ ok: true, columns: [], rows: [] });
    useLayerTableStore.setState({
      tables: {
        L1: { ...READY, info: { ...READY.info, rowCount: null } },
      },
    });

    render(<StatsTab model={model} selection={null} layerId="L1" />);

    expect(await screen.findByText("DuckDB Analytics")).toBeTruthy();
    // Not "0", which would read as an empty table, and not "null".
    expect(screen.getByText("unknown")).toBeTruthy();
  });

  it("shows nothing DuckDB-ish while the table is still building", () => {
    useLayerTableStore.setState({ tables: { L1: { state: "building" } } });
    render(<StatsTab model={model} selection={null} layerId="L1" />);
    expect(screen.queryByText("DuckDB Analytics")).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("shows nothing DuckDB-ish for a layer with no table at all", () => {
    render(<StatsTab model={model} selection={null} layerId={null} />);
    expect(screen.queryByText("DuckDB Analytics")).toBeNull();
  });

  it("still renders the pure model statistics without a table", () => {
    render(<StatsTab model={model} selection={null} layerId={null} />);
    expect(screen.getByText("Statistics")).toBeTruthy();
  });
});
