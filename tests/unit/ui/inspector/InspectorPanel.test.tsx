/**
 * Component-level tests for InspectorPanel's static-vs-streaming branching.
 *
 * The rest of Task 15's tests (residentModel.test.ts, useResidentSurfaces.
 * test.ts) prove the underlying pieces in isolation — this file proves the
 * ORCHESTRATION in InspectorPanel.tsx itself: that a streaming layer's
 * selection resolves through `getResidentModel`/`ObjectDisplayData` instead
 * of `model.objects`, that the Surfaces/Analysis tabs gate on the async
 * fetch for streaming layers while staying synchronous for static ones, and
 * that multi-select degrades gracefully when full surfaces aren't
 * available. This is exactly the logic a code review flagged as
 * unexercised by any test (see task-15-report.md) — and writing it caught a
 * real gap: the surfaces fetch originally fired for ANY selected object on
 * a streaming layer regardless of which tab was showing, not just when the
 * Surfaces/Analysis tab actually needed rings. Fixed in InspectorPanel.tsx
 * (`needsSurfaces`), proven here by asserting the handle's `fetchSurfaces`
 * is NOT called while the Object tab is showing.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { InspectorPanel } from "../../../../src/ui/inspector/InspectorPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "../../../../src/features/streaming/cellCache";
import { buildResidentModel } from "@cityjson/navara-flatcitybuf";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../../../src/domain/citymodel/types";
import type {
  CityModel,
  CityObject,
} from "../../../../src/domain/citymodel/types";
import type { Selection } from "../../../../src/domain/selection/types";

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

function tabButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

// ---------------------------------------------------------------------------
// Static (non-streaming) layer
// ---------------------------------------------------------------------------

describe("InspectorPanel — static layer", () => {
  // Roof (6x4=24) and ground (10x5=50) deliberately have different areas so
  // assertions on one can't accidentally match the other.
  const staticObject: CityObject = {
    id: "static-1",
    objectType: "Building",
    attributes: { measuredHeight: 12 },
    surfaces: [
      {
        type: "RoofSurface",
        rings: [
          [
            [0, 0, 3],
            [6, 0, 3],
            [6, 4, 3],
            [0, 4, 3],
          ],
        ],
        attributes: {},
        lod: "2.2",
      },
      {
        type: "GroundSurface",
        rings: [
          [
            [0, 0, 0],
            [10, 0, 0],
            [10, 5, 0],
            [0, 5, 0],
          ],
        ],
        attributes: {},
        lod: "2.2",
      },
    ],
    bbox: [0, 0, 0, 10, 5, 3],
    children: [],
    parents: [],
    lod: "2.2",
  };

  beforeEach(() => {
    const model: CityModel = {
      ...emptyModel(),
      objects: { [staticObject.id]: staticObject },
    };
    useLayerStore.setState({
      layers: [baseLayer({ model, isStreaming: false })],
      activeLayerId: "L",
    });
  });

  it("renders Object tab geometry synchronously from CityObject", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "static-1" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    expect(screen.getByText("50.0 m²")).toBeTruthy(); // footprint (ground)
    expect(screen.getByText("24.0 m²")).toBeTruthy(); // roof area
  });

  it("renders the Surfaces tab synchronously — no loading state for a static layer", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "static-1" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    fireEvent.click(tabButton("Surfaces"));

    expect(screen.queryByText("Loading surfaces…")).toBeNull();
    expect(screen.getByText("RoofSurface")).toBeTruthy();
    expect(screen.getByText("GroundSurface")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Streaming layer
// ---------------------------------------------------------------------------

describe("InspectorPanel — streaming layer", () => {
  const record1 = {
    id: "stream-1",
    objectType: "Building",
    attributes: { measuredHeight: 8 },
    bbox: [0, 0, 0, 4, 4, 4] as const,
    lod: "2.2",
    surfaceCount: 6,
    roofMetrics: [
      { areaSqM: 20, inclinationDeg: 15, azimuthDeg: 90, elevationM: 4 },
    ],
    footprintAreaSqM: 16,
    volumeCuM: 128,
    parents: [],
    children: [],
  };

  const record2 = {
    id: "stream-2",
    objectType: "Building",
    attributes: {},
    bbox: [0, 0, 0, 2, 2, 2] as const,
    lod: "2.2",
    surfaceCount: 4,
    roofMetrics: [],
    footprintAreaSqM: 5,
    volumeCuM: null,
    parents: [],
    children: [],
  };

  let fetchSurfaces: Mock<FcbStreamLayerHandle["fetchSurfaces"]>;
  let resolveSurfaces: (s: readonly Surface[]) => void;
  let rejectSurfaces: (e: Error) => void;

  beforeEach(() => {
    fetchSurfaces = vi.fn(
      () =>
        new Promise<readonly Surface[]>((res, rej) => {
          resolveSurfaces = res;
          rejectSurfaces = rej;
        }),
    );
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set(
      "2/0/0",
      { objects: [record1, record2], surfaceAttrKeys: ["slope"] } as never,
      { triangles: 1, bytes: 1 },
    );
    useStreamStore.setState({
      streams: {
        L: {
          handle: { ...residentHandle(cache), fetchSurfaces },
          version: 1,
        } as never,
      },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });
  });

  it("renders Object tab geometry from the ResidentObjectRecord's precomputed fields, without fetching rings", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-1" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    // footprintAreaSqM (16) and the sum of roofMetrics.areaSqM (20) come
    // straight from the record.
    expect(screen.getByText("16.0 m²")).toBeTruthy();
    expect(screen.getByText("20.0 m²")).toBeTruthy();
    expect(screen.getByText("≈ 128.0 m³")).toBeTruthy();
    // The Object tab needs no ring geometry, so the worker's 'surfaces'
    // message must not have been sent just from selecting the object.
    expect(fetchSurfaces).not.toHaveBeenCalled();
  });

  it("renders 'N/A' for a null volumeCuM instead of crashing", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-2" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    expect(screen.getByText("N/A")).toBeTruthy();
  });

  it("gates the Surfaces tab on the async fetch: loading, then ready with fetched rings", async () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-1" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    fireEvent.click(tabButton("Surfaces"));
    expect(screen.getByText("Loading surfaces…")).toBeTruthy();
    expect(fetchSurfaces).toHaveBeenCalledWith("stream-1");

    await act(async () => {
      resolveSurfaces([
        { type: "WallSurface", rings: [], attributes: {}, lod: null },
      ]);
      await Promise.resolve();
    });

    expect(screen.queryByText("Loading surfaces…")).toBeNull();
    expect(screen.getByText("WallSurface")).toBeTruthy();
  });

  it("shows an error message instead of hanging when the fetch rejects", async () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-1" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    fireEvent.click(tabButton("Analysis"));
    await act(async () => {
      rejectSurfaces(new Error("not resident"));
      await Promise.resolve();
    });

    expect(
      screen.getByText(/Failed to load surfaces: not resident/),
    ).toBeTruthy();
  });

  it("multi-select surfaces breakdown shows an explicit 'unavailable' message rather than an empty table", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-1" },
      { kind: "object", layerId: "L", objectId: "stream-2" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    fireEvent.click(tabButton("Surfaces"));
    expect(
      screen.getByText(/isn.t available for streaming layers in/),
    ).toBeTruthy();
  });

  it("multi-select Object tab still aggregates footprint/roof/volume from records", () => {
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "stream-1" },
      { kind: "object", layerId: "L", objectId: "stream-2" },
    ];
    render(<InspectorPanel selections={selections} onClose={() => {}} />);

    // Sum mode is the default. Footprint: 16 + 5 = 21. Roof area: 20 + 0 =
    // 20 (record2 has no roofMetrics). Volume: only record1's 128 is
    // non-null, so it's the only value aggregated.
    expect(screen.getByText("21.0 m²")).toBeTruthy();
    expect(screen.getByText("20.0 m²")).toBeTruthy();
    expect(screen.getByText("128.0 m³")).toBeTruthy();
  });
});
