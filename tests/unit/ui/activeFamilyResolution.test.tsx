/**
 * Ruling S3: every reader of a layer's table resolves through its ACTIVE family.
 *
 * A CityParquet package is a set of object families, each with its own table
 * under the composite key `${layerId}::${family}` (R-C′). A reader that still
 * looked a table up by the bare layer id would find NOTHING for such a layer —
 * the lifecycle deliberately never builds it a bare resident table, precisely so
 * there is no frozen snapshot to find. Every layer with no families keeps the
 * bare key and is unaffected, which is what the "no families" cases pin.
 *
 * The UI these readers feed is Task 4's; what is asserted here is only which
 * table each of them ends up on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const runQuery = vi.fn(
  async (_sql: string) =>
    ({ ok: true, rows: [] }) as { ok: boolean; rows: unknown[] },
);
vi.mock("../../../src/insights/duckdb", () => ({
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
  registerParquetUrl: vi.fn(async () => ({ ok: true }) as const),
  registerParquetFile: vi.fn(async () => ({ ok: true }) as const),
  dropRegisteredFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { useLayerQuery } = await import("../../../src/ui/table/useLayerQuery");
const { useLayerCounts } = await import("../../../src/ui/table/useLayerCounts");
const { citySourceReason, eligibilityContextFor } =
  await import("../../../src/ui/processing/useEligibilityContext");
const { useLayerTableStore, layerTableKey } =
  await import("../../../src/insights/layerTables");
const { useFamilyStore } =
  await import("../../../src/features/layers/familyStore");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { useQueryStore } =
  await import("../../../src/features/query/queryStore");
import type { LayerTable } from "../../../src/insights/layerTables";
import type { CityModel } from "../../../src/domain/citymodel/types";
import type { Layer } from "../../../src/features/layers/layerStore";

function table(name: string, over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: name,
    sourceName: null,
    source: null,
    reader: null,
    extension: null,
    sourceBytes: null,
    columns: [{ name: "id", type: "VARCHAR", kind: "scalar" }],
    lods: [],
    sourceFeatureIds: null,
    rowCount: 7,
    ...over,
  };
}

const MODEL: CityModel = {
  sourceEncoding: "cityparquet",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
};

/** A streamed CityParquet layer with two families, `bridge` active. */
function seedTwoFamilyLayer(): string {
  const id = "L1";
  useFamilyStore.getState().setFamilies(id, [
    {
      key: "building",
      rawKey: "building",
      label: "Building",
      href: "building.parquet",
      source: { url: "https://x.test/building.parquet" },
      size: null,
      rowCount: null,
    },
    {
      key: "bridge",
      rawKey: "bridge",
      label: "Bridge",
      href: "bridge.parquet",
      source: { url: "https://x.test/bridge.parquet" },
      size: null,
      rowCount: null,
    },
  ]);
  useLayerStore.getState().addLayer({
    id,
    name: "yokohama",
    model: MODEL,
    modelRef: { type: "url", url: "https://x.test/" },
    visible: true,
    rules: [],
    isStreaming: true,
  });
  useLayerTableStore.setState({
    tables: {
      // What a frozen bare resident table WOULD look like if one existed. It
      // must never be what a reader lands on for a family layer.
      [id]: { state: "ready", info: table("stale_resident") },
      [layerTableKey(id, "building")]: {
        state: "ready",
        info: table("family_building", {
          fileBacked: true,
          familyKey: "building",
        }),
      },
      [layerTableKey(id, "bridge")]: {
        state: "ready",
        info: table("family_bridge", {
          fileBacked: true,
          familyKey: "bridge",
        }),
      },
    },
  });
  useFamilyStore.getState().setActiveFamily(id, "bridge");
  return id;
}

beforeEach(() => {
  runQuery.mockClear();
  useFamilyStore.setState({ layers: {} });
  useLayerStore.setState({ layers: [] });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {} });
});

afterEach(() => {
  cleanup();
});

describe("useLayerQuery", () => {
  function Probe({ layerId }: { readonly layerId: string }) {
    const view = useLayerQuery(layerId);
    return <output>{view.table?.table ?? "none"}</output>;
  }

  it("shows the ACTIVE family's table, never the bare key", async () => {
    const id = seedTwoFamilyLayer();
    render(<Probe layerId={id} />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("family_bridge"),
    );
  });

  it("follows the family the user switches to", async () => {
    const id = seedTwoFamilyLayer();
    render(<Probe layerId={id} />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("family_bridge"),
    );
    useFamilyStore.getState().setActiveFamily(id, "building");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("family_building"),
    );
  });

  it("keeps the bare key for a layer with no families", async () => {
    useLayerTableStore.setState({
      tables: { plain: { state: "ready", info: table("layer_1") } },
    });
    render(<Probe layerId="plain" />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("layer_1"),
    );
  });
});

describe("useLayerCounts", () => {
  function Probe({ layerId }: { readonly layerId: string }) {
    useLayerCounts(layerId);
    // The counts themselves are DuckDB's; what this pins is which table the
    // COUNT was taken from.
    return <output>ok</output>;
  }

  it("counts the ACTIVE family's table", async () => {
    const id = seedTwoFamilyLayer();
    render(<Probe layerId={id} />);
    await waitFor(() => expect(runQuery).toHaveBeenCalled());
    const sql = runQuery.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(sql).toContain("family_bridge");
    expect(sql).not.toContain("stale_resident");
  });
});

describe("eligibilityContextFor", () => {
  function inputs() {
    return {
      tables: useLayerTableStore.getState().tables,
      families: useFamilyStore.getState().layers,
      hasVectorLayer: false,
      hasCityLayer: true,
      status: {
        state: "ready" as const,
        extensions: {
          spatial: { state: "unloaded" },
          three_d: { state: "unloaded" },
        },
      } as never,
    };
  }

  it("reads the ACTIVE family's table state", () => {
    const id = seedTwoFamilyLayer();
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        [layerTableKey(id, "bridge")]: {
          state: "failed",
          message: "that family's view could not be created",
        },
      },
    }));
    const ctx = eligibilityContextFor({ kind: "city", layer }, inputs());
    // The bare key is `ready`; the ACTIVE family's is not, and that is the one
    // the toolbox has to believe.
    expect(ctx.tableState).toBe("failed");
  });

  it("still reads the bare key for a layer with no families", () => {
    const plain = {
      id: "plain",
      name: "delft",
      model: MODEL,
      visible: true,
    } as unknown as Layer;
    useLayerTableStore.setState({
      tables: { plain: { state: "ready", info: table("layer_1") } },
    });
    const ctx = eligibilityContextFor({ kind: "city", layer: plain }, inputs());
    expect(ctx.tableState).toBe("ready");
  });

  /** Ruling S2: the active family's own CRS, and whether it is metre-based. */
  it("reports the ACTIVE family's CRS as non-metric for a PLATEAU package", () => {
    const id = seedTwoFamilyLayer();
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        [layerTableKey(id, "bridge")]: {
          state: "ready",
          info: table("family_bridge", {
            fileBacked: true,
            familyKey: "bridge",
            sourceCrs: "EPSG:6697",
          }),
        },
      },
    }));
    const ctx = eligibilityContextFor({ kind: "city", layer }, inputs());
    expect(ctx.activeTableCrs).toBe("EPSG:6697");
    expect(ctx.activeTableCrsMetric).toBe(false);
  });

  it("reports a metre-based family CRS as metric", () => {
    const id = seedTwoFamilyLayer();
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        [layerTableKey(id, "bridge")]: {
          state: "ready",
          info: table("family_bridge", {
            fileBacked: true,
            familyKey: "bridge",
            sourceCrs: "EPSG:7415",
          }),
        },
      },
    }));
    const ctx = eligibilityContextFor({ kind: "city", layer }, inputs());
    expect(ctx.activeTableCrsMetric).toBe(true);
  });

  it("makes NO claim for a table that records no CRS", () => {
    const id = seedTwoFamilyLayer();
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    const ctx = eligibilityContextFor({ kind: "city", layer }, inputs());
    expect(ctx.activeTableCrs).toBeNull();
    expect(ctx.activeTableCrsMetric).toBeNull();
  });

  it("gives Aggregate's CITY SOURCE rows the same refusal (its target is the vector layer)", () => {
    // `toolEligibility` only ever sees the TARGET, so a degree-based city layer
    // chosen as Aggregate's source would otherwise slip through.
    const id = seedTwoFamilyLayer();
    useLayerTableStore.setState((s) => ({
      tables: {
        ...s.tables,
        [layerTableKey(id, "bridge")]: {
          state: "ready",
          info: table("family_bridge", {
            fileBacked: true,
            familyKey: "bridge",
            sourceCrs: "EPSG:6697",
          }),
        },
      },
    }));
    expect(citySourceReason(inputs(), id, "aggregate-per-area")).toMatch(
      /not metre-based/,
    );
    expect(citySourceReason(inputs(), id, "roof-metrics")).toBeNull();
  });
});
