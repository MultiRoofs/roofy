/**
 * "N of M loaded": the loaded count unions static layers and every stream's
 * resident model; the total is known only when every streamed layer's header
 * says how many objects its dataset holds (CityParquet does, FlatCityBuf
 * does not).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

// Publishing a layer's families ensures the active one's view; there is no
// DuckDB here and the file's CRS is a ranged read, so both are faked.
vi.mock("../../../../src/insights/familyViews", () => ({
  ensureFamilyView: vi.fn(async () => ({ ok: true }) as const),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));
import { useTotalObjectCount } from "../../../../src/features/streaming/useTotalObjectCount";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import {
  buildLayerFamilies,
  resetFamilyStoreForTest,
  useFamilyStore,
} from "../../../../src/features/layers/familyStore";
import type { Layer } from "../../../../src/features/layers/layerStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
  resetFamilyStoreForTest();
});

function layer(id: string, objectIds: string[], isStreaming: boolean): Layer {
  return {
    id,
    isStreaming,
    model: {
      objects: Object.fromEntries(objectIds.map((o) => [o, { id: o }])),
    },
  } as unknown as Layer;
}

function stream(featureCount: number, objectsCount: number | undefined) {
  return {
    handle: {
      getResidentModel: () => ({
        objects: {},
        cellCount: 1,
        featureCount,
        surfaceAttrKeys: [],
      }),
    },
    header: {
      version: "1",
      featuresCount: undefined,
      ...(objectsCount !== undefined ? { objectsCount } : {}),
      extent: undefined,
      referenceSystem: undefined,
      epsg: 28992,
    },
    version: 1,
  } as never;
}

describe("useTotalObjectCount", () => {
  it("static layers only: loaded and total are both the object count", () => {
    useLayerStore.setState({ layers: [layer("A", ["a", "b", "c"], false)] });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 3, total: 3 });
  });

  it("a CityParquet stream: total is the header's objectsCount, loaded the resident count", () => {
    useLayerStore.setState({ layers: [layer("P", [], true)] });
    useStreamStore.setState({ streams: { P: stream(12301, 884106) } });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 12301, total: 884106 });
  });

  it("a FlatCityBuf stream (no objectsCount): the total is unknown", () => {
    useLayerStore.setState({ layers: [layer("F", [], true)] });
    useStreamStore.setState({ streams: { F: stream(40, undefined) } });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 40, total: null });
  });

  it("mixed static + CityParquet: both halves sum", () => {
    useLayerStore.setState({
      layers: [layer("A", ["a", "b"], false), layer("P", [], true)],
    });
    useStreamStore.setState({ streams: { P: stream(10, 1000) } });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 12, total: 1002 });
  });

  it("any FlatCityBuf stream alongside a CityParquet one makes the total unknown", () => {
    useLayerStore.setState({
      layers: [layer("P", [], true), layer("F", [], true)],
    });
    useStreamStore.setState({
      streams: { P: stream(10, 1000), F: stream(5, undefined) },
    });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 15, total: null });
  });

  it("counts the OPENED families' objects for a package, not the whole package", () => {
    // Ruling R-D opens Building alone, so "N of M" must be N of the BUILDINGS —
    // measuring the loaded objects against a total that includes four families
    // nobody opened reads as a stream that has barely started.
    useLayerStore.setState({ layers: [layer("P", [], true)] });
    useStreamStore.setState({ streams: { P: stream(12301, 884106) } });
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
    ]).map((family) => ({
      ...family,
      rowCount: family.key === "building" ? 884106 : 4200,
    }));
    useFamilyStore.getState().setFamilies("P", families);
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 12301, total: 884106 });

    // Open the bridge family too, and the total grows by its rows.
    useFamilyStore.setState((s) => ({
      layers: {
        ...s.layers,
        P: { ...s.layers.P!, opened: ["building", "bridge"] },
      },
    }));
    const second = renderHook(() => useTotalObjectCount());
    expect(second.result.current.total).toBe(884106 + 4200);
  });

  it("falls back to the header when a family's size is not known yet", () => {
    useLayerStore.setState({ layers: [layer("P", [], true)] });
    useStreamStore.setState({ streams: { P: stream(10, 1000) } });
    const families = buildLayerFamilies([
      {
        key: "building",
        href: "building.parquet",
        size: null,
        source: { url: "https://x/building.parquet" },
      },
    ]);
    useFamilyStore.getState().setFamilies("P", families);
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 10, total: 1000 });
  });

  it("a stream whose layer has left the layer store does not count toward the total", () => {
    useLayerStore.setState({ layers: [layer("P", [], true)] });
    useStreamStore.setState({
      streams: { P: stream(10, 1000), GONE: stream(7, 500) },
    });
    const { result } = renderHook(() => useTotalObjectCount());
    expect(result.current).toEqual({ loaded: 10, total: 1000 });
  });
});
