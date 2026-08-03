/**
 * Component tests for LayerPanel's streaming badge and resident-cache
 * object count.
 *
 * Two correctness requirements from the task brief, both checked here:
 *  1. Counts are labelled FEATURES, never buildings — one FlatCityBuf
 *     feature can carry a Building plus several BuildingParts, so a
 *     "buildings" count wouldn't add up against anything.
 *  2. The count is qualified as the RESIDENT CACHE, not "visible area" —
 *     the cover includes a one-cell margin and the LRU keeps cells after
 *     they leave view, so this number can outlive what's actually on
 *     screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LayerPanel } from "../../../../src/ui/layers/LayerPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "@cityjson/navara-flatcitybuf";
import { buildResidentModel } from "@cityjson/navara-flatcitybuf";
import type { CityModel } from "../../../../src/domain/citymodel/types";

/** The streaming layer's plugin handle, reduced to the one method the UI
 *  reaches: the resident-model merge (which the plugin owns and memoises on
 *  its own commit counter). Built over a real `CellCache` so the merge under
 *  test is the real `buildResidentModel`, not a hand-written stand-in. */
function residentHandle(cache: unknown) {
  return {
    getResidentModel: () =>
      buildResidentModel(cache as Parameters<typeof buildResidentModel>[0]),
  };
}

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  // getResidentModel's memo is module-global and keyed by (layerId,
  // version) — several tests below reuse layerId "L" at version 1 with
  // DIFFERENT cache contents, so a stale memo entry would silently serve
  // the wrong test's data instead of recomputing.
});

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function baseLayer(overrides: Partial<Layer>): Layer {
  return {
    id: "L",
    name: "test layer",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    isStreaming: false,
    ...overrides,
  };
}

function residentEntry(ids: string[]) {
  return {
    objects: ids.map((id) => ({
      id,
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 2,
      roofMetrics: [],
      footprintAreaSqM: 10,
      volumeCuM: 30,
      parents: [],
      children: [],
    })),
    surfaceAttrKeys: [],
  };
}

const noop = () => {};

describe("LayerPanel — static layer", () => {
  it("shows a plain object count with no streaming badge", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          model: { ...emptyModel(), objects: { a: {}, b: {} } as never },
        }),
      ],
      activeLayerId: "L",
    });

    render(<LayerPanel onAddFile={noop} onAddUrl={noop} loading={false} />);

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("STREAM")).toBeNull();
    expect(screen.queryByText(/resident cache/i)).toBeNull();
  });
});

describe("LayerPanel — streaming layer", () => {
  it("shows the streaming badge and a resident-cache FEATURE count, never buildings", () => {
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("2/0/0", residentEntry(["a", "b"]) as never, {
      triangles: 1,
      bytes: 1,
    });
    cache.set("2/1/0", residentEntry(["c"]) as never, {
      triangles: 1,
      bytes: 1,
    });
    useStreamStore.setState({
      streams: { L: { handle: residentHandle(cache), version: 1 } as never },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });

    render(<LayerPanel onAddFile={noop} onAddUrl={noop} loading={false} />);

    expect(screen.getByText("STREAM")).toBeTruthy();
    expect(screen.getByText("3 features loaded (resident cache)")).toBeTruthy();
    expect(screen.queryByText(/buildings/i)).toBeNull();
  });

  it("qualifies the tooltip as the resident cache, explicitly not 'visible area'", () => {
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("2/0/0", residentEntry(["a"]) as never, {
      triangles: 1,
      bytes: 1,
    });
    useStreamStore.setState({
      streams: { L: { handle: residentHandle(cache), version: 1 } as never },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });

    render(<LayerPanel onAddFile={noop} onAddUrl={noop} loading={false} />);

    const badge = screen.getByText("1 feature loaded (resident cache)");
    expect(badge.title.toLowerCase()).toContain("resident cache");
    expect(badge.title.toLowerCase()).not.toContain("visible area");
  });

  it("updates the count when the stream version bumps (new cells committed)", () => {
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("2/0/0", residentEntry(["a"]) as never, {
      triangles: 1,
      bytes: 1,
    });
    useStreamStore.setState({
      streams: { L: { handle: residentHandle(cache), version: 1 } as never },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });

    render(<LayerPanel onAddFile={noop} onAddUrl={noop} loading={false} />);
    expect(screen.getByText("1 feature loaded (resident cache)")).toBeTruthy();

    act(() => {
      cache.set("2/1/0", residentEntry(["b", "c"]) as never, {
        triangles: 1,
        bytes: 1,
      });
      useStreamStore.getState().bumpVersion("L");
    });

    expect(screen.getByText("3 features loaded (resident cache)")).toBeTruthy();
  });
});
