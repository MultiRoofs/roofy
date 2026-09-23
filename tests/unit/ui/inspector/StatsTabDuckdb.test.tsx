import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const runQuery = vi.fn();
/** Whoever asked to hear about the engine dying, as a real set: a case drives a
 *  death through it, and the inert stub would leave the breakdown read hanging. */
const deathListeners = new Set<() => void>();
/** What a primitive answers when the engine's death takes it (`duckdb.ts`'s
 *  `settleOnDeath`), and the promise that never answers until then. */
const diesWithEngine = () =>
  new Promise<{ ok: false; message: string }>((resolve) => {
    deathListeners.add(() => {
      resolve({ ok: false, message: "Analytics engine stopped" });
    });
  });
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn((listener: () => void) => {
    deathListeners.add(listener);
    return () => deathListeners.delete(listener);
  }),
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
    sourceFeatureIds: null,
    rowCount: 3,
  },
};

beforeEach(() => {
  deathListeners.clear();
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

  it("STOPS WAITING when the engine dies under the type breakdown", async () => {
    // THE OFF-QUEUE HAZARD, at the Stats tab: this read is awaited OUTSIDE the
    // table FIFO, and `duckdb.ts` used to leave a request its worker died under
    // unsettled for ever — so the section below never appeared at all, for the
    // life of the page. The primitive now answers `ok: false`, and this tab's
    // existing handling renders the section with the count it already had and
    // no breakdown.
    //
    // NOTE what this component does NOT have: a spinner and a failure message.
    // `duckdbStats` is null until the read answers, so "the section is absent"
    // IS the waiting state, and its appearance is the release.
    runQuery.mockImplementation(diesWithEngine);
    useLayerTableStore.setState({ tables: { L1: READY } });

    render(<StatsTab model={model} selection={null} layerId="L1" />);
    await vi.waitFor(() => expect(deathListeners.size).toBeGreaterThan(0));
    expect(screen.queryByText("DuckDB Analytics")).toBeNull();

    for (const listener of Array.from(deathListeners)) {
      deathListeners.delete(listener);
      listener();
    }

    expect(await screen.findByText("DuckDB Analytics")).toBeTruthy();
    expect(screen.getByText("Rows loaded")).toBeTruthy();
    // The breakdown is empty rather than invented: nothing was read.
    expect(screen.queryByText("Building")).toBeNull();
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

/**
 * The fix-round review's N3. The per-object block's "Avg azimuth" row was gated
 * on `avgRoofAzimuth > 0`, and `computeStats` returned 0 both for "nothing to
 * average" and for "due north" — so the row was correctly hidden for an all-flat
 * building and WRONGLY hidden for a genuinely north-facing one. Same collision
 * the milestone removed from `computeRoofMetrics`, `aggregate.ts` and
 * `roofRollUp.ts`; this is the file those two left behind.
 */
describe("StatsTab's mean azimuth row", () => {
  /** One Building whose single RoofSurface slopes down toward `dir`. */
  const modelWithRoof = (ring: [number, number, number][]): CityModel =>
    ({
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [0, 0, 0, 10, 10, 3],
      vertexCount: 4,
      objects: {
        b: {
          id: "b",
          objectType: "Building",
          attributes: {},
          bbox: [0, 0, 0, 10, 10, 3],
          lod: "2",
          parents: [],
          children: [],
          surfaces: [
            { type: "RoofSurface", lod: "2", attributes: {}, rings: [ring] },
          ],
        },
      },
    }) as unknown as CityModel;

  const selection = {
    kind: "object" as const,
    layerId: "L1",
    objectId: "b",
  };

  it("shows the row for a north-facing roof, whose mean azimuth IS 0", () => {
    // z falls from 3 at y = 0 to 0 at y = 10, so the plane's normal tilts
    // toward +y: it faces north, azimuth 0.
    render(
      <StatsTab
        model={modelWithRoof([
          [0, 0, 3],
          [10, 0, 3],
          [10, 10, 0],
          [0, 10, 0],
        ])}
        selection={selection}
        layerId={null}
      />,
    );
    expect(screen.getByText("Avg azimuth")).toBeTruthy();
    expect(screen.getByText(/^N \(0°\)$/)).toBeTruthy();
  });

  it("hides the row for a flat roof, which has no azimuth at all", () => {
    render(
      <StatsTab
        model={modelWithRoof([
          [0, 0, 3],
          [10, 0, 3],
          [10, 10, 3],
          [0, 10, 3],
        ])}
        selection={selection}
        layerId={null}
      />,
    );
    expect(screen.queryByText("Avg azimuth")).toBeNull();
  });
});
