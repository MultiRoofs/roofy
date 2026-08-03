/**
 * NavaraViewport streaming wiring (Task C13).
 *
 * Companion to `navaraViewport.test.tsx`, which covers the static half. Same
 * rules apply: the engine and BOTH plugin subpaths are mocked and never
 * imported for real — `@navaramap/three` crashes at module scope under Node
 * (Task B1: NODE_IMPORT_SAFE = false) and jsdom has no WebGL or WASM. The real
 * streaming path is exercised by Task C14's browser smoke.
 *
 * What is asserted here is the WIRING that turns streaming on:
 *
 *  - the FlatCityBuf plugin joins the session's ordered plugin list, so it is
 *    registered BEFORE `view.init()` (the engine rejects `addPlugin` after);
 *  - the live plugin is published to `streamPlugin.ts` and handed out through
 *    `CitySceneHandle.getStreamingPlugin()`, which QUEUES behind `ready`
 *    instead of dereferencing a null ref;
 *  - streaming handles join `streamsRef`, so picking, highlighting, fit and the
 *    triangle readout cover streamed cells;
 *  - rules / LoD / visibility reach the streaming handle (styling is the only
 *    capability that branches — shared contract -> Streaming styling);
 *  - every programmatic camera move is routed through `suppressSettle`.
 */
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
const flyTo = vi.fn();

/** The engine's event bus, reduced to what `view.on/off` need. */
const listeners = new Map<string, Set<(...args: never[]) => void>>();
const on = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
});
const off = vi.fn((name: string, fn: (...args: never[]) => void) => {
  listeners.get(name)?.delete(fn);
});
/** Fire an engine event, the only input surface this component has. */
function emitViewEvent(name: string, ...args: unknown[]): void {
  act(() => {
    for (const fn of Array.from(listeners.get(name) ?? [])) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  });
}
/** A mouse event as the engine delivers it: canvas-relative offsets. */
function mouse(x: number, y: number, patch: Record<string, unknown> = {}) {
  return { offsetX: x, offsetY: y, clientX: x + 300, clientY: y, ...patch };
}

/** A deliberately un-settled `view.init()`, released in `afterEach` so one
 *  failing test cannot hang the rest of the file (see the QUEUES case). */
let pendingInitRelease: (() => void) | null = null;

const RAY = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
const getPickRay = vi.fn(() => RAY as unknown);
const viewInstances: Array<Record<string, unknown>> = [];

vi.mock("@navaramap/three", () => ({
  default: vi.fn(function (_options: unknown) {
    const view = {
      addPlugin,
      init,
      dispose,
      on,
      off,
      camera: {
        raw: {},
        positionGeographic: { lng: 4.35, lat: 52, height: 500 },
        orientation: { heading: 0, pitch: -60, roll: 0 },
      },
      setCamera,
      flyTo,
      screenSize: { x: 800, y: 600 },
      pixelRatio: 1,
      pickDepthPosition: vi.fn(() => null as unknown),
    };
    viewInstances.push(view);
    return view;
  }),
  getPickRay,
  vector3ToGeodetic: vi.fn((v: { x: number; y: number; z: number }) => ({
    lng: v.x,
    lat: v.y,
    height: v.z,
  })),
  radianToDegree: vi.fn((r: number) => (r * 180) / Math.PI),
}));

const defaultPluginInstance = { addDefaultPhotorealScene: vi.fn() };
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return defaultPluginInstance;
  }),
}));

const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: vi.fn(function () {
    return cityPluginInstance;
  }),
}));

/** The live FlatCityBuf plugin, as `NavaraViewport` sees it. `suppressSettle`
 *  is a PASSTHROUGH by default: the camera call still happens, and a test can
 *  assert it was routed through here. */
const flatPluginInstance = {
  openStream: vi.fn(),
  getHandle: vi.fn(),
  remove: vi.fn(),
  dispose: vi.fn(),
  suppressSettle: vi.fn(async (fn: () => unknown) => fn()),
};
/** Options the component constructed the plugin with (the viewport-size seam). */
const flatPluginOptions: Array<Record<string, unknown>> = [];
/** Set to make `new FlatCityBufPlugin()` throw — a build where streaming is
 *  unavailable, which must still leave the static viewer fully usable. */
let flatPluginThrows: string | null = null;
const FlatCityBufPluginMock = vi.fn(function (
  options: Record<string, unknown>,
) {
  if (flatPluginThrows !== null) throw new Error(flatPluginThrows);
  flatPluginOptions.push(options);
  return flatPluginInstance;
});
vi.mock("@cityjson/navara-flatcitybuf/plugin", () => ({
  FlatCityBufPlugin: FlatCityBufPluginMock,
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import {
  useStreamStore,
  type StreamState,
} from "../../../src/features/streaming/streamStore";
import { getStreamPlugin } from "../../../src/features/streaming/streamPlugin";
import type { CityModel } from "../../../src/domain/citymodel/types";
import type { Rule } from "../../../src/features/rules/types";
import type { Selection } from "../../../src/domain/selection/types";

const CRS_URI = "https://www.opengis.net/def/crs/EPSG/0/7415";

function makeModel(): CityModel {
  return {
    objects: {},
    vertices: [],
    transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
    metadata: { referenceSystem: CRS_URI },
    bbox: [0, 0, 0, 1, 1, 1],
  } as unknown as CityModel;
}

function makeLayer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model: makeModel(),
    modelRef: { type: "url", url: `https://example.test/${patch.id}` },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "auto",
    isStreaming: false,
    ...patch,
  } as Layer;
}

/** A `CityModelHandle` stub, for the mixed static/streaming cases. */
function makeStaticHandle(id: string, triangles = 10) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(() => null as unknown),
    resolveRaycast: vi.fn(() => null as unknown),
    triangleCount: vi.fn(() => triangles),
    heightOffset: vi.fn(() => 0),
    getBoundsGeodetic: vi.fn(() => ({
      west: 4.35,
      south: 52,
      east: 4.36,
      north: 52.01,
      minHeight: 0,
      maxHeight: 20,
    })),
    delete: vi.fn(),
  };
}

/**
 * An `FcbStreamLayerHandle` stub: the `InteractionHandle` members plus the
 * event subscriptions and the per-layer setters the viewport drives.
 * `triangles` is mutable so a test can simulate cells arriving.
 */
function makeFakeStreamHandle(
  options: {
    id?: string;
    triangles?: number;
    pick?: Selection | null;
  } = {},
) {
  const commitListeners = new Set<(version: number) => void>();
  const handle = {
    id: options.id ?? "S1",
    triangles: options.triangles ?? 0,
    setHighlight: vi.fn(),
    resolvePick: vi.fn(() => options.pick ?? null),
    // A REAL streaming handle answers with its winning cell's key, because its
    // indices are cell-scoped; the router must carry that back into
    // `resolvePick` or the pick resolves to nothing.
    resolveRaycast: vi.fn(() =>
      options.pick
        ? {
            objectIndex: 0,
            surfaceIndex: 0,
            distance: 5,
            cellKey: "4/7/9",
          }
        : null,
    ),
    getBoundsGeodetic: vi.fn(() => ({
      west: 4.36,
      south: 52.01,
      east: 4.37,
      north: 52.02,
      minHeight: 0,
      maxHeight: 30,
    })),
    triangleCount: vi.fn(() => handle.triangles),
    /** The vertical-datum offset its cells were placed with — what the cursor
     *  readout subtracts to report the source file's own z. */
    heightOffset: vi.fn(() => 43.2),
    setRules: vi.fn(),
    setLod: vi.fn(),
    setVisible: vi.fn(),
    delete: vi.fn(),
    onStatus: vi.fn(() => () => undefined),
    onLadder: vi.fn(() => () => undefined),
    onCommit: vi.fn((cb: (version: number) => void) => {
      commitListeners.add(cb);
      return () => {
        commitListeners.delete(cb);
      };
    }),
    /** Fire the handle's commit event, as a cell arrival would. */
    emitCommit(version: number) {
      act(() => {
        for (const cb of Array.from(commitListeners)) cb(version);
      });
    },
    commitListenerCount: () => commitListeners.size,
  };
  // The stream handle answers a raycast with the same Selection it would
  // resolve, so a pick routed to it lands in the selection store.
  handle.resolvePick.mockImplementation(() => options.pick ?? null);
  return handle;
}

type FakeStreamHandle = ReturnType<typeof makeFakeStreamHandle>;

/** Add a streaming layer to `layerStore` and register its handle in
 *  `streamStore`, exactly as `openStreamingLayer` does (layer first). */
function registerStreamingLayer(
  layerId: string,
  handle: FakeStreamHandle,
  patch: Partial<Layer> = {},
): void {
  useLayerStore.setState((s) => ({
    layers: [
      ...s.layers,
      makeLayer({ id: layerId, isStreaming: true, ...patch }),
    ],
  }));
  useStreamStore.getState().register(layerId, {
    handle,
    disposers: [],
    grid: { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 },
    header: { version: "1.0", featuresCount: 1, extent: [0, 0, 0, 1, 1, 1] },
    level: null,
    ladder: [],
    ladderVersion: 0,
    status: "idle",
    message: null,
    version: 0,
  } as unknown as StreamState);
}

describe("NavaraViewport streaming wiring", () => {
  beforeEach(() => {
    addPlugin.mockClear();
    init.mockClear();
    init.mockImplementation(async () => {});
    dispose.mockClear();
    setCamera.mockClear();
    flyTo.mockClear();
    on.mockClear();
    off.mockClear();
    listeners.clear();
    getPickRay.mockClear();
    viewInstances.length = 0;
    flatPluginOptions.length = 0;
    flatPluginThrows = null;
    FlatCityBufPluginMock.mockClear();
    flatPluginInstance.remove.mockClear();
    flatPluginInstance.suppressSettle.mockClear();
    flatPluginInstance.suppressSettle.mockImplementation(
      async (fn: () => unknown) => fn(),
    );
    cityPluginInstance.getHandle.mockReset();
    cityPluginInstance.addCityModel.mockReset();
    cityPluginInstance.addCityModel.mockImplementation(
      (_model: unknown, opts: { id: string }) => makeStaticHandle(opts.id),
    );
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useStreamStore.setState({ streams: {} });
    useSelectionStore.setState({
      mode: "object",
      toolMode: "select",
      selections: [],
      hovered: null,
    });
  });

  afterEach(() => {
    pendingInitRelease?.();
    pendingInitRelease = null;
    cleanup();
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useStreamStore.setState({ streams: {} });
  });

  // -------------------------------------------------------------------------
  // Registration order (Step 4)
  // -------------------------------------------------------------------------

  it("registers the FlatCityBuf plugin BEFORE view.init(), as the engine requires", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin).toHaveBeenCalledWith(flatPluginInstance);
    const pluginCallOrder = addPlugin.mock.invocationCallOrder[0]!;
    expect(pluginCallOrder).toBeLessThan(init.mock.invocationCallOrder[0]!);
  });

  it("passes [DefaultPlugin, CityJSONPlugin, FlatCityBufPlugin] to the session, ALL before init", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin).toHaveBeenCalledTimes(3);
    expect(addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPluginInstance,
      cityPluginInstance,
      flatPluginInstance,
    ]);
    // The engine rejects addPlugin() after init(), so the LAST one still has
    // to precede it. This is the whole reason Task B8 takes an ordered list.
    expect(addPlugin.mock.invocationCallOrder[2]!).toBeLessThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("never calls view.addPlugin after init has resolved", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    const afterInit = addPlugin.mock.invocationCallOrder.filter(
      (o) => o > init.mock.invocationCallOrder[0]!,
    );
    expect(afterInit).toEqual([]);
  });

  it("measures the viewport from the container it owns, not from the plugin", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    const options = flatPluginOptions[0]!;
    expect(typeof options.getViewportSize).toBe("function");
    // jsdom lays nothing out, so the numbers are 0 — what matters is that the
    // seam exists and answers with the container's own dimensions.
    expect((options.getViewportSize as () => unknown)()).toEqual({
      width: 0,
      height: 0,
    });
  });

  // -------------------------------------------------------------------------
  // Publication + the open-before-ready race (Steps 4/5)
  // -------------------------------------------------------------------------

  it("publishes the live plugin for the app's open paths, and retracts it on unmount", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(getStreamPlugin()).toBe(flatPluginInstance));
    unmount();
    expect(getStreamPlugin()).toBeNull();
  });

  it("resolves the handle's `ready` promise only after view.init() settles", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(init).toHaveBeenCalled();
  });

  it("QUEUES a getStreamingPlugin() call made before the session resolves", async () => {
    // init never settles until we let it, mirroring a share link that opens a
    // stream during the first render. Registered for release in `afterEach`
    // too: the module-level engine slot serialises MOUNTS across the whole
    // file, so an init left pending by a failing assertion would hang every
    // test after this one rather than failing just this one.
    let resolveInit!: () => void;
    init.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveInit = r;
          pendingInitRelease = r;
        }),
    );
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);

    let settled = false;
    const pending = ref.current!.getStreamingPlugin().then((p) => {
      settled = true;
      return p;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await waitFor(() => expect(init).toHaveBeenCalled());
    await act(async () => {
      resolveInit();
      await Promise.resolve();
    });
    await expect(pending).resolves.toBe(flatPluginInstance);
  });

  it("rejects getStreamingPlugin() if the engine never comes up, instead of hanging", async () => {
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await expect(ref.current!.getStreamingPlugin()).rejects.toThrow(
      "wasm boom",
    );
  });

  it("rejects getStreamingPlugin() when the plugin itself could not be built", async () => {
    // A build without streaming support: the static viewer must still come up,
    // and the failure must reach the caller that asked for a .fcb.
    flatPluginThrows = "no WebAssembly";
    const ref = createRef<CitySceneHandle>();
    const { queryByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(queryByRole("alert")).toBeNull();
    await expect(ref.current!.getStreamingPlugin()).rejects.toThrow(
      /no WebAssembly/,
    );
  });

  // -------------------------------------------------------------------------
  // Programmatic camera suppression (Step 5b)
  // -------------------------------------------------------------------------

  it("wraps a programmatic camera move in the streaming plugin's suppressSettle", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    await ref.current!.ready;

    ref.current!.setCameraState({
      lng: 4.35,
      lat: 52,
      height: 500,
      heading: 0,
      pitch: -60,
      roll: 0,
    });
    expect(flatPluginInstance.suppressSettle).toHaveBeenCalledTimes(1);
    // The camera really moved — suppression must not swallow the call itself.
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  it("routes fitAll, fitLayer and alignView through suppressSettle too", async () => {
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    // The automatic fit for the newly added layer already went through it.
    await waitFor(() => expect(flyTo).toHaveBeenCalled());
    flatPluginInstance.suppressSettle.mockClear();

    act(() => ref.current!.fitAll());
    act(() => ref.current!.fitLayer("a"));
    act(() => ref.current!.alignView("top"));
    expect(flatPluginInstance.suppressSettle).toHaveBeenCalledTimes(3);
    expect(flyTo).toHaveBeenCalledTimes(3); // 1 auto-fit + fitAll + fitLayer
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  it("moves the camera directly when no streaming plugin is present, without awaiting anything", async () => {
    // Simulates a static-only build: the ref never gets a plugin.
    flatPluginThrows = "not configured";
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    act(() => ref.current!.alignView("top"));
    expect(setCamera).toHaveBeenCalled();
    expect(flatPluginInstance.suppressSettle).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // The interaction registry (Step 6)
  // -------------------------------------------------------------------------

  it("counts a streaming layer's triangles, so an FCB-only workspace is not reported as 0", async () => {
    const onTriangleCount = vi.fn();
    const streamHandle = makeFakeStreamHandle({ triangles: 1234 });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(1234));
  });

  it("re-counts and re-highlights when the stream commits new cells", async () => {
    const onTriangleCount = vi.fn();
    const streamHandle = makeFakeStreamHandle({ triangles: 10 });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(10));
    streamHandle.setHighlight.mockClear();

    streamHandle.triangles = 99;
    streamHandle.emitCommit(1);
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(99));
    // A cell that arrives while something is selected must not render
    // unhighlighted: the viewport re-pushes the current selection.
    expect(streamHandle.setHighlight).toHaveBeenCalled();
  });

  it("keeps the commit subscription alive across an unrelated layer change", async () => {
    // A re-run of the reconciliation effect unsubscribes the previous run's
    // listeners; if it only re-subscribes handles it considers NEW, the
    // triangle readout goes deaf after the first rule edit.
    const onTriangleCount = vi.fn();
    const streamHandle = makeFakeStreamHandle({ triangles: 10 });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(10));

    act(() => {
      useLayerStore.setState((s) => ({
        layers: [...s.layers, makeLayer({ id: "static" })],
      }));
    });
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalled(),
    );

    streamHandle.triangles = 77;
    streamHandle.emitCommit(2);
    // 77 streamed + 10 from the static layer.
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(87));
    // Exactly one listener, not one per effect run.
    expect(streamHandle.commitListenerCount()).toBe(1);
  });

  it("routes a pick to the streaming handle, not only to static layers", async () => {
    const streamHandle = makeFakeStreamHandle({
      pick: {
        kind: "surface",
        layerId: "S1",
        objectId: "B4",
        surfaceIndex: 2,
      },
    });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(on.mock.calls.some((c) => c[0] === "click")).toBe(true),
    );
    emitViewEvent("mousedown", mouse(100, 100));
    emitViewEvent("click", mouse(100, 100));
    await waitFor(() =>
      expect(useSelectionStore.getState().selections[0]?.objectId).toBe("B4"),
    );
    // The full round trip: the router raycast the streaming handle and handed
    // the winning hit back WITH its cell key, which is the only thing that
    // makes the cell-scoped indices interpretable.
    expect(streamHandle.resolveRaycast).toHaveBeenCalled();
    expect(streamHandle.resolvePick).toHaveBeenLastCalledWith({
      layerId: "S1",
      properties: {
        layerId: "S1",
        objectIndex: 0,
        surfaceIndex: 0,
        cellKey: "4/7/9",
      },
    });
  });

  it("frames a streaming layer with fitAll, so an FCB-only workspace can be fitted", async () => {
    const streamHandle = makeFakeStreamHandle({ triangles: 10 });
    registerStreamingLayer("S1", streamHandle);
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    flyTo.mockClear();
    act(() => ref.current!.fitAll());
    expect(streamHandle.getBoundsGeodetic).toHaveBeenCalled();
    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("pushes the selection to a streaming handle, hidden or not", async () => {
    const streamHandle = makeFakeStreamHandle();
    registerStreamingLayer("S1", streamHandle, { visible: false });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    streamHandle.setHighlight.mockClear();

    const sel: Selection = { kind: "object", layerId: "S1", objectId: "B1" };
    act(() => useSelectionStore.setState({ selections: [sel] }));
    await waitFor(() =>
      expect(streamHandle.setHighlight).toHaveBeenCalledWith([sel], undefined),
    );
  });

  // -------------------------------------------------------------------------
  // Per-stream rules / LoD / visibility (Step 8)
  // -------------------------------------------------------------------------

  it("pushes rules to the streaming handle as DATA, never a style evaluator", async () => {
    const rules: Rule[] = [
      {
        id: "r1",
        name: "all roofs",
        color: "#4ec84e",
        conditions: [],
        logic: "AND",
        enabled: true,
      },
    ];
    const streamHandle = makeFakeStreamHandle();
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    streamHandle.setRules.mockClear();

    act(() => {
      useLayerStore.setState((s) => ({
        layers: s.layers.map((l) => (l.id === "S1" ? { ...l, rules } : l)),
      }));
    });
    await waitFor(() =>
      expect(streamHandle.setRules).toHaveBeenCalledWith(rules, true),
    );
    // An unrelated store change must not re-push: every push re-bakes every
    // resident cell in the worker.
    streamHandle.setRules.mockClear();
    act(() => useSelectionStore.setState({ hovered: null }));
    act(() => {
      useLayerStore.setState((s) => ({
        layers: s.layers.map((l) =>
          l.id === "S1" ? { ...l, visible: false } : l,
        ),
      }));
    });
    await waitFor(() =>
      expect(streamHandle.setVisible).toHaveBeenCalledWith(false),
    );
    expect(streamHandle.setRules).not.toHaveBeenCalled();
  });

  it("pushes the LoD selection to the streaming handle when it changes", async () => {
    const streamHandle = makeFakeStreamHandle();
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    streamHandle.setLod.mockClear();

    act(() => {
      useLayerStore.getState().setLodMode("S1", "manual");
      useLayerStore.getState().setLayerLod("S1", "1.2");
    });
    await waitFor(() =>
      expect(streamHandle.setLod).toHaveBeenLastCalledWith("manual", "1.2"),
    );
    streamHandle.setLod.mockClear();
    // Unchanged LoD, unrelated edit: no re-push.
    act(() => {
      useLayerStore.setState((s) => ({
        layers: s.layers.map((l) => (l.id === "S1" ? { ...l, name: "x" } : l)),
      }));
    });
    await waitFor(() => expect(streamHandle.setLod).not.toHaveBeenCalled());
  });

  // -------------------------------------------------------------------------
  // Teardown (Step 7 + the C12 carry-forward)
  // -------------------------------------------------------------------------

  it("removes a streaming layer's plugin state when the layer leaves the store", async () => {
    const streamHandle = makeFakeStreamHandle({ triangles: 50 });
    registerStreamingLayer("S1", streamHandle);
    const onTriangleCount = vi.fn();
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(50));

    act(() => useLayerStore.getState().removeLayer("S1"));

    await waitFor(() =>
      expect(flatPluginInstance.remove).toHaveBeenCalledWith("S1"),
    );
    expect(useStreamStore.getState().get("S1")).toBeUndefined();
    // Dropped from the interaction registry too, or fit/pick/triangles would
    // keep reading a deleted handle.
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(0));
  });

  it("clears the streams map when the engine goes away", async () => {
    const streamHandle = makeFakeStreamHandle({ triangles: 50 });
    registerStreamingLayer("S1", streamHandle);
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());

    unmount();
    // The plugin dies with the view, so its handles do too: leaving the store
    // entry behind would leave the UI showing a dead handle.
    expect(useStreamStore.getState().get("S1")).toBeUndefined();
    expect(getStreamPlugin()).toBeNull();
  });
});
