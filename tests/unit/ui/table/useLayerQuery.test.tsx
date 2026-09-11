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
  getEngineGeneration: vi.fn(() => 1),
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
  await import("../../../../src/insights/layerTables");
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
      <span data-testid="loading">{String(view.loading)}</span>
      <button type="button" onClick={view.reload}>
        reload
      </button>
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
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\' LIMIT 20 OFFSET 0',
    );
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS "n" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\'',
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
            rows: [{ n: sql.includes("COALESCE") ? 7 : 42 }],
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
      'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE (COALESCE("feature_id", "id") IN (SELECT COALESCE("feature_id", "id") FROM "layer_1" WHERE "object_type" = \'Building\')) AND "parents" IS NULL AND "object_type" = \'Building\' LIMIT 20 OFFSET 0',
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
        'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\' LIMIT 500 OFFSET 1000',
      ),
    );
  });
  it("CLAMPS a stored page the table has shrunk past, and fetches the real one", async () => {
    // The page index is per layer and survives a rebuild. A streaming layer
    // whose cells were dropped goes from 1000 rows to 50 with the store still
    // on page 9, and every query after that asks for `OFFSET 900` of a 50-row
    // table: an empty grid under a footer that says there are rows.
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 50 }] }
        : { ok: true, columns: [], rows: [{ id: "a" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    act(() => {
      useQueryStore.getState().setPage("L", 9);
    });
    render(<Probe layerId="L" />);

    // 50 rows at the default page size of 20 has three pages, so page 9 is
    // clamped to index 2 and re-runs against that real final page.
    await waitFor(() =>
      expect(useQueryStore.getState().queries.L?.page).toBe(2),
    );
    await waitFor(() =>
      expect(runQuery).toHaveBeenCalledWith(
        'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\' LIMIT 20 OFFSET 40',
      ),
    );
    // And the rows on screen are that page's, not the empty one that provoked
    // the clamp.
    await waitFor(() =>
      expect(screen.getByTestId("rows").textContent).toBe("1"),
    );
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("leaves a page that is still valid, and clamps nothing on an unknown total", async () => {
    // No last page can be computed from a COUNT that failed, so the stored
    // page stands — the alternative is throwing the user back to page 1 on a
    // transient engine error.
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: false, message: "IO Error: boom" }
        : { ok: true, columns: [], rows: [{ id: "a" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    act(() => {
      useQueryStore.getState().setPage("L", 4);
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("total").textContent).toBe(""),
    );
    expect(useQueryStore.getState().queries.L?.page).toBe(4);
  });

  it("never lets a STALE page response overwrite a newer one", async () => {
    // Two pages in flight at once, answered in the WRONG order. Without the
    // generation counter the first (slow) page lands last and the grid shows
    // page 1 while the footer says page 2.
    const gate: Array<() => void> = [];
    runQuery.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          if (sql.includes("COUNT(*)")) {
            // 420 rows, not 42: page 1 has to EXIST at the default page
            // size of 100, or the clamp (rightly) sends this query back to
            // page 0 and there is no out-of-order race left to test.
            resolve({ ok: true, columns: ["n"], rows: [{ n: 420 }] });
            return;
          }
          gate.push(() =>
            resolve({
              ok: true,
              columns: [],
              rows: sql.includes("OFFSET 0")
                ? [{ id: "page-one" }]
                : [{ id: "page-two" }, { id: "page-two-b" }],
            }),
          );
        }),
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() => expect(gate).toHaveLength(1));

    // The second page is asked for before the first has answered.
    act(() => {
      useQueryStore.getState().setPage("L", 1);
    });
    await waitFor(() => expect(gate).toHaveLength(2));

    // ...and answers FIRST.
    await act(async () => {
      gate[1]!();
    });
    expect(screen.getByTestId("rows").textContent).toBe("2");

    // The stale first page lands afterwards and must be discarded.
    await act(async () => {
      gate[0]!();
    });
    expect(screen.getByTestId("rows").textContent).toBe("2");
  });

  it("re-runs the same page on reload()", async () => {
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    runQuery.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "reload" }));

    await waitFor(() =>
      expect(runQuery).toHaveBeenCalledWith(
        'SELECT "id", "feature_id", "object_type" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\' LIMIT 20 OFFSET 0',
      ),
    );
  });

  it("keeps a REBUILDING layer's page and counts until the new one lands", async () => {
    // A streaming layer rebuilds on every camera settle while the panel is
    // open, and each rebuild mints a fresh `layer_<n>`. Blanking on the new
    // NAME flashed "no rows yet", dropped the header count and flipped the
    // footer to "of ?" several times a pan.
    const gate: Array<() => void> = [];
    runQuery.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          if (sql.includes("COUNT(*)")) {
            resolve({ ok: true, columns: ["n"], rows: [{ n: 42 }] });
            return;
          }
          gate.push(() =>
            resolve({
              ok: true,
              columns: [],
              rows: sql.includes('"layer_1"')
                ? [{ id: "old" }]
                : [{ id: "new-a" }, { id: "new-b" }],
            }),
          );
        }),
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);
    await waitFor(() => expect(gate).toHaveLength(1));
    await act(async () => {
      gate[0]!();
    });
    expect(screen.getByTestId("rows").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("42");

    // The settle: same layer, brand-new table name.
    act(() => {
      useLayerTableStore.setState({
        tables: {
          L: { state: "ready", info: { ...TABLE, table: "layer_2" } },
        },
      });
    });

    // Still the old page and the old counts, dimmed by `loading` — not a
    // blank grid and not "of ?".
    expect(screen.getByTestId("rows").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("42");
    expect(screen.getByTestId("unfiltered").textContent).toBe("42");
    expect(screen.getByTestId("loading").textContent).toBe("true");

    await waitFor(() => expect(gate).toHaveLength(2));
    await act(async () => {
      gate[1]!();
    });
    expect(screen.getByTestId("rows").textContent).toBe("2");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("clears the page when the LAYER changes, before the new one answers", async () => {
    const gate: Array<() => void> = [];
    runQuery.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          if (sql.includes("COUNT(*)")) {
            resolve({ ok: true, columns: ["n"], rows: [{ n: 42 }] });
            return;
          }
          gate.push(() =>
            resolve({ ok: true, columns: [], rows: [{ id: "from-L" }] }),
          );
        }),
    );
    useLayerTableStore.setState({
      tables: {
        L: { state: "ready", info: TABLE },
        M: { state: "ready", info: { ...TABLE, table: "layer_9" } },
      },
    });
    const { rerender } = render(<Probe layerId="L" />);
    await waitFor(() => expect(gate).toHaveLength(1));
    await act(async () => {
      gate[0]!();
    });
    expect(screen.getByTestId("rows").textContent).toBe("1");

    // M is READY too, so the ready branch would happily paint L's rows under
    // M's columns if the reset did not fire.
    rerender(<Probe layerId="M" />);
    expect(screen.getByTestId("rows").textContent).toBe("0");
    expect(screen.getByTestId("total").textContent).toBe("");
  });

  it("drops the old layer's rows the instant the table changes", async () => {
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: true, columns: ["n"], rows: [{ n: 42 }] }
        : { ok: true, columns: [], rows: [{ id: "from-L" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    const { rerender } = render(<Probe layerId="L" />);
    await waitFor(() =>
      expect(screen.getByTestId("rows").textContent).toBe("1"),
    );

    // A second layer whose table is still building. Painting L's rows under
    // M's (absent) columns is the failure this guards.
    useLayerTableStore.setState({
      tables: {
        L: { state: "ready", info: TABLE },
        M: { state: "building" },
      },
    });
    rerender(<Probe layerId="M" />);
    expect(screen.getByTestId("rows").textContent).toBe("0");
    expect(screen.getByTestId("status").textContent).toBe("building");
  });

  it("clears the page when the table goes away", async () => {
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
      expect(screen.getByTestId("rows").textContent).toBe("1"),
    );

    act(() => {
      useLayerTableStore.setState({
        tables: { L: { state: "failed", message: "dropped" } },
      });
    });
    expect(screen.getByTestId("rows").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("reports an UNKNOWN total when only the COUNT fails", async () => {
    // The page query is a separate statement: its rows are on screen, so the
    // total is unknown rather than zero, and the failure is still named.
    runQuery.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)")
        ? { ok: false, message: "Out of Memory Error" }
        : { ok: true, columns: [], rows: [{ id: "B1" }] },
    );
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    render(<Probe layerId="L" />);

    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toBe(
        "Out of Memory Error",
      ),
    );
    expect(screen.getByTestId("rows").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("");
    expect(screen.getByTestId("unfiltered").textContent).toBe("");
  });

  it("hands the grid the SAME columns array while the table's columns hold", async () => {
    // `DataGrid` is `React.memo`'d; a fresh array per render defeats it.
    const seen: Array<ReadonlyArray<unknown>> = [];
    function ColumnProbe() {
      const view = useLayerQuery("L");
      seen.push(view.columns);
      return <span data-testid="cols2">{view.columns.length}</span>;
    }
    useLayerTableStore.setState({
      tables: { L: { state: "ready", info: TABLE } },
    });
    const { rerender } = render(<ColumnProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("cols2").textContent).toBe("3"),
    );
    rerender(<ColumnProbe />);
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });
});
