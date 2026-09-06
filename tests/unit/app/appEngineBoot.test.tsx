/**
 * `App`'s engine-boot flag (Task C14, Option A for the C13 blocker).
 *
 * A `.fcb` layer cannot exist before the 3D engine does: streaming has no
 * parse step that produces a `CityModel`, so the layer only appears once
 * `FlatCityBufPlugin.openStream` has resolved — and the plugin only exists
 * once a `NavaraViewport` is mounted, which used to require a layer. That
 * circle is what made a `.fcb` impossible as the FIRST layer.
 *
 * `engineBooting` breaks it: an in-flight `.fcb` open mounts the viewer shell
 * with zero layers, and the open queues on the viewport publishing its
 * imperative handle. These cases pin the whole loop — the shell coming up
 * empty, the plugin reaching `openStreamingLayer`, the landing page coming
 * BACK when the open fails, the timeout when no viewport ever publishes, and
 * the fact that a non-streaming source does not boot anything.
 *
 * The engine itself is never imported: `NavaraViewport` is mocked (jsdom has
 * no WebGL, and `@navaramap/three` crashes at module scope under Node — Task
 * B1's NODE_IMPORT_SAFE = false). The real path is Task C14's browser smoke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../../src/persistence/types";
import type { StreamPlugin } from "../../../src/features/streaming/streamPlugin";
import type { StreamState } from "../../../src/features/streaming/streamStore";
import { ENGINE_BOOT_TIMEOUT_MS } from "../../../src/app/App";
import { useWorkspaceStore } from "../../../src/features/workspace/workspaceStore";

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

const FCB_URL = "https://example.test/delft.fcb";
const JSON_URL = "https://example.test/delft.city.json";

/** The plugin the mocked viewport hands out — identity is the assertion:
 *  `openStreamingLayer` must receive exactly this object. */
const streamPluginStub = {
  openStream: vi.fn(),
  getHandle: vi.fn(),
  handles: vi.fn(() => []),
  remove: vi.fn(),
  dispose: vi.fn(),
  suppressSettle: vi.fn(),
} as unknown as StreamPlugin;

/** Set false to simulate a viewport that never publishes a handle (the
 *  timeout case). */
let viewportPublishesHandle = true;

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(
        ref,
        () =>
          (viewportPublishesHandle
            ? {
                fitAll: () => {},
                fitLayer: () => {},
                fitBounds: () => {},
                alignView: () => {},
                getCameraState: () => null,
                setCameraState: () => {},
                ready: Promise.resolve(),
                getStreamingPlugin: async () => streamPluginStub,
              }
            : null) as unknown as CitySceneHandle,
        [],
      );
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

// DuckDB-wasm is irrelevant here and expensive to even import.
vi.mock("../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
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

/** What `openStreamingLayer` saw, and when. `layersAtCall` is the real
 *  evidence for the flag: a zero there means the shell was up with NO layer. */
const openCalls: Array<{ plugin: unknown; layersAtCall: number }> = [];
let openStreamingLayerImpl: (input: {
  plugin: unknown;
}) => Promise<string> = async () => "layer-1";

vi.mock("../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async (input: { plugin: unknown }) => {
    const { useLayerStore } =
      await import("../../../src/features/layers/layerStore");
    openCalls.push({
      plugin: input.plugin,
      layersAtCall: useLayerStore.getState().layers.length,
    });
    return openStreamingLayerImpl(input);
  }),
  closeStreamingLayer: vi.fn(),
  closeAllStreamingLayers: vi.fn(),
}));

const loadFromUrl = vi.fn();
vi.mock(
  "../../../src/domain/citymodel/loadCityModel",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/domain/citymodel/loadCityModel")
      >();
    return { ...actual, loadFromUrl: (url: string) => loadFromUrl(url) };
  },
);

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { useStreamStore } =
  await import("../../../src/features/streaming/streamStore");
const { useGeoLayerStore } =
  await import("../../../src/features/geoLayers/geoLayerStore");
const { useSelectionStore } =
  await import("../../../src/features/selection/selectionStore");

const emptyStore: ProjectStateStore = {
  list: async (): Promise<SnapshotSummary[]> => [],
  load: async () => null,
  save: async () => "snapshot-1",
  remove: async () => {},
};

/** Type the URL into the landing page's URL box and submit it. */
function loadFromUrlBox(url: string): void {
  const input = screen.getByPlaceholderText(
    "https://example.com/model.city.json",
  );
  fireEvent.change(input, { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
}

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

/** What `loadFromUrl` resolves since Task 15: the model PLUS the decoded
 *  source bytes and the encoding, for the layer's DuckDB table. */
const loaded = {
  model,
  bytes: new TextEncoder().encode("{}"),
  encoding: "cityjson" as const,
};

describe("App engine-boot flag for a first-layer .fcb open", () => {
  beforeEach(() => {
    openCalls.length = 0;
    viewportPublishesHandle = true;
    openStreamingLayerImpl = async () => {
      useLayerStore.getState().addLayer({
        id: "stream-1",
        name: "delft.fcb",
        model,
        modelRef: { type: "url", url: FCB_URL },
        visible: true,
        rules: [],
        rulesEnabled: true,
        isStreaming: true,
      });
      return "stream-1";
    };
    loadFromUrl.mockReset();
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("mounts the viewport with ZERO layers and resolves the plugin once it publishes", async () => {
    render(<App persistenceStore={emptyStore} />);
    // Landing page: no viewport, so no engine and no FlatCityBuf plugin.
    expect(screen.queryByTestId("navara-viewport")).toBeNull();

    loadFromUrlBox(FCB_URL);

    // The flag put the shell up before any layer existed.
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    // ...and the open queued on the handle rather than failing with "the 3D
    // engine is not running yet".
    await waitFor(() => expect(openCalls).toHaveLength(1));
    expect(openCalls[0]!.plugin).toBe(streamPluginStub);
    expect(openCalls[0]!.layersAtCall).toBe(0);

    // The layer lands and keeps the shell up on its own.
    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    expect(screen.getByTestId("navara-viewport")).toBeInTheDocument();
  });

  it("returns to the landing page when the .fcb open fails", async () => {
    openStreamingLayerImpl = async () => {
      throw new Error("Streaming refused: non-metric CRS");
    };
    render(<App persistenceStore={emptyStore} />);
    loadFromUrlBox(FCB_URL);

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    // The hold is released in `finally`, so the user gets the drop zone back
    // instead of being stranded on an empty globe.
    await waitFor(() =>
      expect(screen.queryByTestId("navara-viewport")).toBeNull(),
    );
    expect(
      screen.getByText("Streaming refused: non-metric CRS"),
    ).toBeInTheDocument();
  });

  it("does NOT boot the engine for a non-streaming source", async () => {
    let release!: (value: unknown) => void;
    loadFromUrl.mockReturnValue(
      new Promise((res) => {
        release = res;
      }),
    );
    render(<App persistenceStore={emptyStore} />);
    loadFromUrlBox(JSON_URL);

    await waitFor(() => expect(loadFromUrl).toHaveBeenCalledWith(JSON_URL));
    // Still parsing: a CityJSON layer mounts the viewport as a CONSEQUENCE of
    // existing, so there is nothing to boot early for.
    expect(screen.queryByTestId("navara-viewport")).toBeNull();

    release(loaded);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
  });

  it("fails the open with a clear error when no viewport ever publishes a handle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    viewportPublishesHandle = false;
    render(<App persistenceStore={emptyStore} />);
    loadFromUrlBox(FCB_URL);

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    expect(openCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(ENGINE_BOOT_TIMEOUT_MS + 1);

    // Resolve-or-reject, never a hang: the wait is bounded and the message
    // reaches the landing page's error slot. Two sentences, because the boot
    // gate is shared with the camera restore (Task C20) and so states only
    // that the viewport never came up; `resolveStreamPlugin` adds what that
    // cost this caller.
    await waitFor(() =>
      expect(
        screen.getByText(
          "The 3D viewport did not start. The .fcb layer could not be opened.",
        ),
      ).toBeInTheDocument(),
    );
    expect(openCalls).toHaveLength(0);
  });

  it("cancels the boot gate on unmount instead of letting its 15 s timer outlive the app", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    viewportPublishesHandle = false;
    const { unmount } = render(<App persistenceStore={emptyStore} />);
    loadFromUrlBox(FCB_URL);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    // The gate is armed while the open waits for a handle...
    const armed = vi.getTimerCount();
    expect(armed).toBeGreaterThan(0);
    unmount();
    // ...and dies with the component, rather than firing 15 s later into a
    // caller that is no longer on screen.
    expect(vi.getTimerCount()).toBeLessThan(armed);
    await vi.advanceTimersByTimeAsync(ENGINE_BOOT_TIMEOUT_MS + 1000);
    expect(openCalls).toHaveLength(0);
  });
});

describe("App object count across static and streaming layers", () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useStreamStore.setState({ streams: {} });
  });
  afterEach(cleanup);

  it("counts a streaming layer's RESIDENT features, not its empty model stub", async () => {
    // A streaming layer's `model.objects` is a deliberate stub, so the old
    // `layers.reduce(... model.objects ...)` read "Objects 0" next to a
    // viewport full of buildings (found by Task C14's browser smoke).
    useLayerStore.getState().addLayer({
      id: "stream-1",
      name: "delft.fcb",
      model,
      modelRef: { type: "url", url: FCB_URL },
      visible: true,
      rules: [],
      rulesEnabled: true,
      isStreaming: true,
    });
    useStreamStore.setState({
      streams: {
        "stream-1": {
          handle: {
            getResidentModel: () => ({
              objects: {},
              cellCount: 4,
              featureCount: 2123,
              surfaceAttrKeys: [],
            }),
          },
          disposers: [],
          version: 1,
          status: "idle",
          message: null,
          level: 3,
          ladder: [],
          ladderVersion: 0,
          types: [],
          typesVersion: 0,
        } as unknown as StreamState,
      },
    });

    render(<App persistenceStore={emptyStore} />);
    // The status bar is the ONE readout now — the toolbar's Objects pill was
    // deleted as a duplicate of it — and `getByText` throwing on a second
    // match is what keeps it that way.
    await waitFor(() => expect(screen.getByText("2123")).toBeTruthy());
  });
});

/**
 * The inspector follows VIEWPORT picks, not just clicks in the layer panel:
 * a pick activates the layer it landed on, whichever kind that is. The rule
 * lives in `installWorkspaceInvariants`, which `App` installs on mount — so
 * what this proves is that the shell really installs it, driven through the
 * selection store directly because the picks have no UI of their own.
 */
describe("App inspector follows viewport picks across the geo/city split", () => {
  const resetStores = () => {
    useLayerStore.setState({ layers: [] });
    useGeoLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useSelectionStore.getState().clear();
  };

  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("activates the picked feature's geo layer, then the city layer on a city pick", async () => {
    useLayerStore.getState().addLayer({
      id: "city-1",
      name: "delft.city.json",
      model,
      modelRef: { type: "url", url: JSON_URL },
      visible: true,
      rules: [],
      rulesEnabled: true,
      isStreaming: false,
    });
    const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });

    render(<App persistenceStore={emptyStore} />);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    act(() => {
      useSelectionStore.getState().selectGeoFeature({
        geoLayerId,
        batchId: 7,
        properties: { name: "A13" },
      });
    });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(geoLayerId);

    act(() => {
      useSelectionStore.getState().select({
        kind: "object",
        layerId: "city-1",
        objectId: "NL.IMBAG.Pand.1",
      });
    });
    // Not merely "no longer the geo layer": the city layer the pick landed on
    // is now THE active layer, so the inspector, the legend and the highlight
    // are all describing the same thing.
    expect(useWorkspaceStore.getState().activeLayerId).toBe("city-1");
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("Close empties the workspace — geospatial layers included — and leaves nothing active", async () => {
    // Geo layers used to SURVIVE Close, so the next city model opened onto
    // somebody else's roads with a geospatial inspector over it. "Close" now
    // means the whole workspace.
    useLayerStore.getState().addLayer({
      id: "city-1",
      name: "delft.city.json",
      model,
      modelRef: { type: "url", url: JSON_URL },
      visible: true,
      rules: [],
      rulesEnabled: true,
      isStreaming: false,
    });
    useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });

    render(<App persistenceStore={emptyStore} />);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    });

    expect(useLayerStore.getState().layers).toEqual([]);
    expect(useGeoLayerStore.getState().layers).toEqual([]);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });
});
