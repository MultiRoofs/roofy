import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

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

const { useLayerQuery } =
  await import("../../../../src/ui/table/useLayerQuery");
const { useLayerTableStore } =
  await import("../../../../src/analytics/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    { name: "g", type: "BLOB", kind: "blob" as const },
  ],
  lods: [],
  rowCount: 42,
};

function Probe({ layerId }: { readonly layerId: string | null }) {
  const view = useLayerQuery(layerId);
  return (
    <div>
      <span data-testid="status">{view.status}</span>
      <span data-testid="rows">{view.rows.length}</span>
      <span data-testid="total">{view.totalRows}</span>
      <span data-testid="unfiltered">{view.unfilteredRows}</span>
      <span data-testid="cols">
        {view.columns.map((c) => c.name).join(",")}
      </span>
      <span data-testid="message">{view.message ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  runQuery.mockReset();
  runQuery.mockResolvedValue({ ok: true, columns: [], rows: [] });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useQueryStore.setState({ queries: {} });
});

afterEach(cleanup);

describe("useLayerQuery", () => {
  it("reports no-layer with nothing selected", () => {
    render(<Probe layerId={null} />);
    expect(screen.getByTestId("status").textContent).toBe("no-layer");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("reports QUEUED for a selected layer whose entry has not been written yet", () => {
    // `addCityLayer` adds the layer, THEN enqueues: there is a commit in
    // between with no registry entry, and "Select a layer…" must not flash
    // over a layer the user just dropped.
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("queued");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("mirrors the table's queued and building states without querying", () => {
    useLayerTableStore.setState({ tables: { L: { state: "queued" } } });
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("queued");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("surfaces a build failure's message", () => {
    useLayerTableStore.setState({
      tables: { L: { state: "failed", message: "Binder Error: nope" } },
    });
    render(<Probe layerId="L" />);
    expect(screen.getByTestId("status").textContent).toBe("failed");
    expect(screen.getByTestId("message").textContent).toBe(
      "Binder Error: nope",
    );
  });

  it("runs the page and the count, and drops the blob column from the grid", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 42 }] }
        : { ok: true, columns: [], rows: [{ id: "B1" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("cols").textContent).toBe(
      "id,feature_id,object_type",
    );
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" LIMIT 100 OFFSET 0',
    );
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS "n" FROM "layer_1"',
    );
    expect(screen.getByTestId("rows").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("42");
    expect(screen.getByTestId("unfiltered").textContent).toBe("42");
  });

  it("re-queries with the applied filter, and counts filtered vs unfiltered", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? {
            ok: true,
            columns: ["n"],
            rows: [{ n: sql.includes("WHERE") ? 7 : 42 }],
          }
        : { ok: true, columns: [], rows: [] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );

    act(() => {
      useQueryStore.getState().setFilter("L", {
        logic: "AND",
        conditions: [
          { id: "c", column: "object_type", op: "=", value: "Building" },
        ],
      });
      useQueryStore.getState().applyFilter("L");
    });

    await waitFor(() =>
      expect(screen.getByTestId("total").textContent).toBe("7"),
    );
    expect(screen.getByTestId("unfiltered").textContent).toBe("42");
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "object_type" = \'Building\' LIMIT 100 OFFSET 0',
    );
  });

  it("reports a compile refusal WITHOUT sending a query", async () => {
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    runQuery.mockClear();

    act(() => {
      useQueryStore.getState().setFilter("L", {
        logic: "AND",
        conditions: [{ id: "c", column: "gone", op: "=", value: "x" }],
      });
      useQueryStore.getState().applyFilter("L");
    });

    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toBe(
        'This layer has no column called "gone".',
      ),
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("reports DuckDB's own message when the page query fails", async () => {
    runQuery.mockResolvedValue({ ok: false, message: "Conversion Error: bad" });
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toBe(
        "Conversion Error: bad",
      ),
    );
  });

  it("pages with the store's page and page size", async () => {
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    runQuery.mockClear();

    act(() => {
      useQueryStore.getState().setPageSize("L", 500);
      useQueryStore.getState().setPage("L", 2);
    });

    await waitFor(() =>
      expect(runQuery).toHaveBeenCalledWith(
        'SELECT "id", "feature_id", "object_type" FROM "layer_1" LIMIT 500 OFFSET 1000',
      ),
    );
  });
});
