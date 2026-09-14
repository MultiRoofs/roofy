import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const runQuery = vi.fn();
/** Whoever asked to hear about the engine dying, as a real set: a case drives a
 *  death through it, and an inert stub would leave the counts spinning. */
const deathListeners = new Set<() => void>();
vi.mock("../../../../src/insights/duckdb", () => ({
  runQuery: (sql: string) => runQuery(sql),
  // Every mock of this module carries the status subscription, whether or not
  // the file under test reaches it today. The moment one of its suites renders
  // something that does, a factory without them fails the whole file with
  // vitest's `No "subscribeDuckDBStatus" export is defined on the … mock`.
  subscribeDuckDBStatus: () => () => {},
  getDuckDBStatusVersion: () => 0,
  getEngineGeneration: () => 1,
  onEngineDeath: (listener: () => void) => {
    deathListeners.add(listener);
    return () => deathListeners.delete(listener);
  },
  // `layerTables` reads the status at MODULE LOAD now (spec §6.1 invalidates
  // every table when the engine's worker dies), so this import chain needs it
  // even though nothing here asks about the engine.
  getDuckDBStatus: () => ({ state: "uninitialized" }),
}));

const { useLayerCounts } =
  await import("../../../../src/ui/table/useLayerCounts");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");

const TABLE = {
  table: "layer_1",
  sourceName: null,
  source: null,
  reader: null,
  lods: [],
  extension: null,
  sourceBytes: null,
  sourceFeatureIds: null,
  rowCount: 3,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    { name: "parents", type: "VARCHAR[]", kind: "nested" as const },
    { name: "height", type: "DOUBLE", kind: "scalar" as const },
  ],
};

function Probe() {
  const counts = useLayerCounts("L");
  return <span data-testid="counts">{JSON.stringify(counts)}</span>;
}

beforeEach(() => {
  deathListeners.clear();
  runQuery.mockReset();
  useLayerTableStore.setState({
    tables: { L: { state: "ready", info: TABLE } },
    tablePanelOpen: false,
  });
  useQueryStore.setState({ queries: {} });
  useSelectionStore.setState({ selections: [] });
  useLayerStore.setState({
    layers: [
      {
        id: "L",
        isStreaming: false,
        model: {
          objects: {
            B1: { id: "B1", parents: [], children: ["P1"] },
            P1: { id: "P1", parents: ["B1"], children: [] },
          },
        },
      },
    ] as never,
  });
});
afterEach(cleanup);

describe("useLayerCounts", () => {
  it("counts root Buildings, matching features, and an off-page selected child independently", async () => {
    runQuery.mockImplementation(async (sql: string) => ({
      ok: true,
      columns: ["n"],
      rows: [
        { n: sql.includes("FALSE") ? 0 : sql.includes("COALESCE") ? 1 : 2 },
      ],
    }));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: "L", objectId: "P1" });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "h", column: "height", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    render(<Probe />);
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("counts").textContent!),
      ).toMatchObject({ all: 2, matching: 1, selected: 1 }),
    );
    expect(runQuery.mock.calls.map(([sql]) => sql)).toContain(
      'SELECT COUNT(*) AS "n" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" = \'Building\'',
    );
  });

  it("settles with §6.1's sentence when the engine dies under the counts", async () => {
    // THE OFF-QUEUE HAZARD. These three counts are awaited OUTSIDE the table
    // FIFO, and `duckdb.ts` used to leave a request its worker died under
    // unsettled for ever — so the footer kept its spinner for the life of the
    // page. Every primitive now settles with its ordinary failure value, which
    // this fake reproduces: the request answers only when the death does.
    runQuery.mockImplementation(
      () =>
        new Promise((resolve) => {
          deathListeners.add(() => {
            resolve({ ok: false, message: "Analytics engine stopped" });
          });
        }),
    );
    render(<Probe />);
    await waitFor(() => expect(deathListeners.size).toBeGreaterThan(0));
    for (const listener of Array.from(deathListeners)) {
      deathListeners.delete(listener);
      listener();
    }
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("counts").textContent!),
      ).toMatchObject({
        all: null,
        loading: false,
        message: "Analytics engine stopped",
      }),
    );
  });

  it("keeps failed or malformed count values unavailable instead of inventing zero", async () => {
    runQuery.mockResolvedValue({
      ok: true,
      columns: ["n"],
      rows: [{ n: "not-a-count" }],
    });
    render(<Probe />);
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("counts").textContent!),
      ).toMatchObject({ all: null, matching: null, selected: null }),
    );
  });
});
