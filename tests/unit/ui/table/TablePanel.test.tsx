/**
 * Component test for TablePanel's streaming in-memory fallback: with no
 * DuckDB table loaded, a streaming active layer must read rows from
 * `getResidentModel(...)` (the merged resident cells) rather than
 * `activeLayer.model.objects`, which a streaming layer never populates
 * with real objects — see residentModel.ts's doc comment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TablePanel } from "../../../../src/ui/table/TablePanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
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

// jsdom doesn't implement IntersectionObserver (used for TablePanel's
// infinite-scroll sentinel) — a minimal no-op stub is enough since this
// suite never scrolls the sentinel into view.
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useSelectionStore.setState({ selections: [] });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
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
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    ...overrides,
  };
}

describe("TablePanel — streaming layer, no DuckDB table", () => {
  beforeEach(() => {
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set(
      "2/0/0",
      {
        objects: [
          {
            id: "row-a",
            objectType: "Building",
            attributes: { yearBuilt: 1990 },
            bbox: [0, 0, 0, 1, 1, 1],
            lod: "2.2",
            surfaceCount: 7,
            roofMetrics: [],
            footprintAreaSqM: 10,
            volumeCuM: 20,
            parents: [],
            children: [],
          },
        ],
        surfaceAttrKeys: [],
      } as never,
      { triangles: 1, bytes: 1 },
    );
    useStreamStore.setState({
      streams: { L: { handle: residentHandle(cache), version: 1 } as never },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });
  });

  it("reads surface_count from ResidentObjectRecord.surfaceCount, not `.surfaces.length`", async () => {
    render(<TablePanel onCollapse={() => {}} onHeightChange={() => {}} />);

    // The row and its attribute column render once loadPage's async
    // effect has committed the resident-model read.
    expect(await screen.findByText("row-a")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy(); // surface_count column
    expect(screen.getByText("1990")).toBeTruthy(); // yearBuilt attribute column
  });
});
