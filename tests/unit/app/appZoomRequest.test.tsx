/**
 * Spec §6.2's "Zoom to layer", from the result card to the camera.
 *
 * The card is three components deep in the RIGHT panel and the zoom is
 * `sceneRef.fitLayer` in `App`, which is the only place that holds the scene
 * handle — so the toolbox asks through `shellStore.requestZoom` and `App`
 * consumes the request. `RunFooter`'s own suite pins the ASK; this pins the
 * other end, and that the request is CLEARED so a second press flies again.
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../../src/persistence/types";
import type { CityObject } from "../../../src/domain/citymodel/types";

// jsdom ships no `matchMedia`, which `useTheme` reads on its first render.
window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

const fitLayer = vi.fn();

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(
        ref,
        () =>
          ({
            fitAll: () => {},
            fitLayer,
            fitBounds: () => {},
            alignView: () => {},
            flyTo: () => Promise.resolve(),
            getCameraState: () => null,
            setCameraState: () => {},
            getStreamingPlugin: async () => {
              throw new Error("no streaming in this suite");
            },
            ready: Promise.resolve(),
          }) as unknown as CitySceneHandle,
        [],
      );
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

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
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { useSelectionStore } =
  await import("../../../src/features/selection/selectionStore");
const { useGeoLayerStore } =
  await import("../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore } =
  await import("../../../src/features/workspace/workspaceStore");
const { useShellStore, defaultShellState } =
  await import("../../../src/ui/shell/shellStore");
const { useSceneSheetStore } =
  await import("../../../src/features/sceneSheet/sceneSheetStore");
const { useProcessingStore } =
  await import("../../../src/features/processing/processingStore");

const emptyStore: ProjectStateStore = {
  list: async (): Promise<SnapshotSummary[]> => [],
  load: async () => null,
  save: async () => "snapshot-1",
  remove: async () => {},
};

const building: CityObject = {
  id: "NL.IMBAG.Pand.0503100000025028",
  objectType: "Building",
  attributes: { measuredHeight: 12 },
  surfaces: [],
  bbox: [0, 0, 0, 10, 5, 3],
  children: [],
  parents: [],
  lod: "2.2",
};

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: { [building.id]: building },
  vertexCount: 0,
};

function renderViewer(): void {
  useLayerStore.getState().addLayer({
    id: "city-1",
    name: "delft.city.json",
    model,
    modelRef: { type: "url", url: "https://example.test/delft.city.json" },
    visible: true,
    rules: [],
    isStreaming: false,
  });
  render(<App persistenceStore={emptyStore} />);
}

beforeEach(() => {
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useSelectionStore.setState({ selections: [], geoSelection: null });
  useGeoLayerStore.setState({ layers: [] });
  useSceneSheetStore.setState({ sheet: null });
  useShellStore.setState(defaultShellState(1440, 900));
  fitLayer.mockClear();
});

afterEach(() => {
  cleanup();
  useShellStore.getState().requestZoom(null);
  useProcessingStore.getState().resetForTest();
});

describe("App's zoom request", () => {
  it("flies to the layer the shell asked for, and clears the request", () => {
    renderViewer();
    fitLayer.mockClear();
    act(() => useShellStore.getState().requestZoom("city-1"));
    expect(fitLayer).toHaveBeenCalledWith("city-1");
    // Cleared, or a second press of the same button would set the field to a
    // value it already holds and the effect would never fire again.
    expect(useShellStore.getState().requestedZoom).toBeNull();
  });

  it("clears a request for a layer that is no longer there", () => {
    // The card outlives the layer: a derived layer removed from the list while
    // its result card is still on screen must not leave a request standing.
    renderViewer();
    fitLayer.mockClear();
    act(() => useShellStore.getState().requestZoom("gone"));
    expect(fitLayer).not.toHaveBeenCalled();
    expect(useShellStore.getState().requestedZoom).toBeNull();
  });
});
