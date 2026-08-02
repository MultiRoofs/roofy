/**
 * NavaraViewport lifecycle tests.
 *
 * The engine is MOCKED here and never imported for real: `@navaramap/three`
 * crashes at module scope under Node (Task B1: NODE_IMPORT_SAFE = false), and
 * jsdom has no WebGL anyway. The real engine is exercised by the browser smoke
 * (docs/superpowers/research/assets/b11a-navara-viewport-globe.png), not here.
 */
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
const flyTo = vi.fn();
const on = vi.fn();
const off = vi.fn();
const viewInstances: unknown[] = [];
const viewOptions: unknown[] = [];
/** Reproduces the engine's real pre-first-frame behaviour (see the test). */
let cameraThrows = false;
/** Set to make `new DefaultPlugin()` throw, i.e. an unsupported browser. */
let defaultPluginThrows: string | null = null;

// NOTE: the factories below are `function` expressions, not arrows — the
// component calls `new ThreeView(...)` / `new DefaultPlugin()`, and an arrow
// is not constructible.
vi.mock("@navaramap/three", () => ({
  default: vi.fn(function (options: unknown) {
    viewOptions.push(options);
    const view = {
      addPlugin,
      init,
      dispose,
      on,
      off,
      camera: {
        get positionGeographic() {
          if (cameraThrows) throw new Error("Invariant failed");
          return { lng: 4.35, lat: 52, height: 500 };
        },
        orientation: { heading: 0, pitch: -60, roll: 0 },
      },
      setCamera,
      flyTo,
    };
    viewInstances.push(view);
    return view;
  }),
}));

const defaultPluginInstance = { addDefaultPhotorealScene: vi.fn() };
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    if (defaultPluginThrows !== null) throw new Error(defaultPluginThrows);
    return defaultPluginInstance;
  }),
}));

const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
const CityJSONPluginMock = vi.fn(function () {
  return cityPluginInstance;
});
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: CityJSONPluginMock,
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import type { CityModel } from "../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// Layer fixtures. The store is driven directly (`setState`) rather than through
// `addLayer`, so a test can pin ids and LoDs.
// ---------------------------------------------------------------------------

function makeModel(referenceSystem?: string): CityModel {
  return {
    objects: {},
    vertices: [],
    transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
    metadata: referenceSystem === undefined ? {} : { referenceSystem },
    bbox: [0, 0, 0, 1, 1, 1],
  } as unknown as CityModel;
}

function makeLayer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model: makeModel("EPSG:7415"),
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

/** A `CityModelHandle` stub: only the members `handleSync`/`boundsOf` touch. */
function makeHandle(id: string, triangles = 10) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(),
    batchIdMap: vi.fn(() => []),
    triangleCount: vi.fn(() => triangles),
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

describe("NavaraViewport lifecycle", () => {
  beforeEach(() => {
    addPlugin.mockClear();
    init.mockClear();
    dispose.mockClear();
    setCamera.mockClear();
    flyTo.mockClear();
    on.mockClear();
    off.mockClear();
    CityJSONPluginMock.mockClear();
    init.mockImplementation(async () => {});
    defaultPluginInstance.addDefaultPhotorealScene.mockClear();
    viewInstances.length = 0;
    viewOptions.length = 0;
    cameraThrows = false;
    defaultPluginThrows = null;
    cityPluginInstance.getHandle.mockReset();
    cityPluginInstance.addCityModel.mockReset();
    cityPluginInstance.addCityModel.mockImplementation(
      (_model: unknown, opts: { id: string }) => makeHandle(opts.id),
    );
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  it("registers DefaultPlugin then CityJSONPlugin, both before view.init()", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPluginInstance,
      cityPluginInstance,
    ]);
    expect(addPlugin.mock.invocationCallOrder[1]!).toBeLessThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("adds the photoreal scene after init, and resolves `ready`", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(
      defaultPluginInstance.addDefaultPhotorealScene,
    ).toHaveBeenCalledTimes(1);
    expect(
      defaultPluginInstance.addDefaultPhotorealScene.mock
        .invocationCallOrder[0]!,
    ).toBeGreaterThan(init.mock.invocationCallOrder[0]!);
  });

  it("builds the view on a real container, with picking and shadows", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    const options = viewOptions[0] as Record<string, unknown>;
    expect(options.container).toBeInstanceOf(HTMLElement);
    expect(options.picking).toBe(true);
    expect(options.shadow).toBe(true);
    // Task B1 finding 3: `Options` has no `useNormal` field.
    expect("useNormal" in options).toBe(false);
  });

  it("REJECTS `ready` and shows an error panel when view.init() fails", async () => {
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const ref = createRef<CitySceneHandle>();
    const { findByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).rejects.toThrow("wasm boom");
    // The failure is visible, not just a console line: C20's restore flow
    // catches the rejection, and the user sees why nothing rendered.
    expect((await findByRole("alert")).textContent).toMatch(/wasm boom/);
  });

  it("REJECTS `ready` and shows the panel when a plugin CONSTRUCTOR throws", async () => {
    // The boot sequence is more than `init()`: a plugin constructor can throw
    // on an unsupported browser long before a session exists. `ready` must
    // still settle — resolve-or-reject, never a hang.
    defaultPluginThrows = "no WebGL2";
    const ref = createRef<CitySceneHandle>();
    const { findByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).rejects.toThrow("no WebGL2");
    expect((await findByRole("alert")).textContent).toMatch(/no WebGL2/);
    expect(init).not.toHaveBeenCalled();
  });

  it("warns in DEV when a second viewport is mounted alongside the first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <>
        <NavaraViewport onTriangleCount={() => {}} />
        <NavaraViewport onTriangleCount={() => {}} />
      </>,
    );
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /NavaraViewport: 2 instances are mounted at once/,
    );
    warn.mockRestore();
  });

  it("getCameraState reads the engine camera; setCameraState writes it", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    expect(ref.current!.getCameraState()).toEqual({
      lng: 4.35,
      lat: 52,
      height: 500,
      heading: 0,
      pitch: -60,
      roll: 0,
    });

    const restored = {
      lng: 1,
      lat: 2,
      height: 3,
      heading: 4,
      pitch: 5,
      roll: 6,
    };
    ref.current!.setCameraState(restored);
    expect(setCamera).toHaveBeenCalledWith(restored);
  });

  it("has no camera state before the engine is up", () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    // The effect has run but `ready` has not settled yet.
    expect(ref.current!.getCameraState()).toBeNull();
    expect(() => {
      ref.current!.setCameraState({
        lng: 0,
        lat: 0,
        height: 0,
        heading: 0,
        pitch: 0,
        roll: 0,
      });
    }).not.toThrow();
  });

  it("reports no camera instead of throwing before the first frame", async () => {
    // BROWSER-VERIFIED: between `view.init()` resolving and the first rendered
    // frame, `camera.positionGeographic` throws a bare "Invariant failed".
    // C20's autosave/share capture must survive that window.
    cameraThrows = true;
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    expect(ref.current!.getCameraState()).toBeNull();
  });

  it("moves no camera while there are no layers to fit", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    ref.current!.fitAll();
    ref.current!.fitLayer("nope");
    ref.current!.alignView("top");
    expect(flyTo).not.toHaveBeenCalled();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it("disposes the view on unmount", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("builds exactly ONE engine across a StrictMode double mount", async () => {
    // Not cosmetic: `@navaramap/three` keeps its worker pool in a module-level
    // singleton, and a second `view.init()` overlapping the first throws
    // "Worker pool has already been initialized." — verified in the browser
    // before the mount serialisation went in.
    const ref = createRef<CitySceneHandle>();
    const { queryByRole } = render(
      <StrictMode>
        <NavaraViewport ref={ref} onTriangleCount={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(queryByRole("alert")).toBeNull();
    expect(viewInstances).toHaveLength(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(ref.current!.getCameraState()).not.toBeNull();
  });

  it("subscribes to postRender only when an FPS callback is given", async () => {
    const { unmount } = render(
      <NavaraViewport onTriangleCount={() => {}} onFps={() => {}} />,
    );
    await waitFor(() =>
      expect(on.mock.calls.some((c) => c[0] === "postRender")).toBe(true),
    );
    unmount();
    expect(off.mock.calls.some((c) => c[0] === "postRender")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Task B11b: the layer store -> CityJSONPlugin registry mirror.
  //
  // The reconciliation rules themselves are `handleSync.ts`'s (covered in
  // handleSync.test.ts); what is tested here is the WIRING — that the effect
  // binds the plugin's registry, reports triangles and errors, fits on a new
  // layer only, and drops its handles when the engine goes away.
  // -------------------------------------------------------------------------

  it("adds every static layer through the plugin registry, filtered to its LoD", async () => {
    useLayerStore.setState({
      layers: [
        makeLayer({ id: "a", selectedLod: "1.2" }),
        makeLayer({ id: "b", selectedLod: null }),
      ],
    });
    const onTriangleCount = vi.fn();
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);

    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(2),
    );
    expect(cityPluginInstance.addCityModel.mock.calls.map((c) => c[1])).toEqual(
      [
        { id: "a", crs: "EPSG:7415", lod: "1.2" },
        { id: "b", crs: "EPSG:7415", lod: null },
      ],
    );
    // 2 handles x 10 triangles.
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(20));
  });

  it("never adds a streaming layer (its meshes belong to the FCB plugin)", async () => {
    useLayerStore.setState({
      layers: [
        makeLayer({ id: "static" }),
        makeLayer({ id: "streamed", isStreaming: true }),
      ],
    });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    expect(cityPluginInstance.addCityModel.mock.calls[0]![1]).toMatchObject({
      id: "static",
    });
  });

  it("reports a refused layer through onLayerError and keeps the scene up", async () => {
    cityPluginInstance.addCityModel.mockImplementation(
      (_model: unknown, opts: { id: string }) => {
        if (opts.id === "bad") throw new Error("CRS is not metric");
        return makeHandle(opts.id);
      },
    );
    useLayerStore.setState({
      layers: [makeLayer({ id: "bad" }), makeLayer({ id: "good" })],
    });
    const onLayerError = vi.fn();
    const onTriangleCount = vi.fn();
    render(
      <NavaraViewport
        onTriangleCount={onTriangleCount}
        onLayerError={onLayerError}
      />,
    );

    await waitFor(() =>
      expect(onLayerError).toHaveBeenCalledWith("bad", "CRS is not metric"),
    );
    // The good layer still rendered and still counts.
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(10));
  });

  it("fits the camera when a layer is ADDED, and not when one is merely toggled", async () => {
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    // A camera derived from the handle's real bounds, not a NaN jump.
    const camera = flyTo.mock.calls[0]![0] as Record<string, number>;
    expect(camera.lng).toBeCloseTo(4.355, 6);
    // South of the box centre (52.005) and above it, looking north — the
    // default framing, derived from the handle's own bounds.
    expect(camera.lat).toBeLessThan(52.005);
    expect(camera.height).toBeGreaterThan(20);
    expect(camera.pitch).toBeCloseTo(-60, 6);

    // Visibility change: reconciled, but the camera stays put.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a", visible: false })],
    });
    await waitFor(() =>
      expect(
        cityPluginInstance.addCityModel.mock.results[0]!.value.setVisible,
      ).toHaveBeenCalledWith(false),
    );
    expect(flyTo).toHaveBeenCalledTimes(1);

    // A second layer IS a new fit.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a", visible: false }), makeLayer({ id: "b" })],
    });
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(2));
  });

  it("deletes the handle of a layer that left the store", async () => {
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    const onTriangleCount = vi.fn();
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    const handle = cityPluginInstance.addCityModel.mock.results[0]!.value;

    useLayerStore.setState({ layers: [] });
    await waitFor(() => expect(handle.delete).toHaveBeenCalledTimes(1));
    expect(onTriangleCount).toHaveBeenLastCalledWith(0);
  });

  it("fitLayer frames one layer; fitAll frames them all", async () => {
    useLayerStore.setState({
      layers: [makeLayer({ id: "a" }), makeLayer({ id: "b" })],
    });
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(2),
    );
    const handleA = cityPluginInstance.addCityModel.mock.results[0]!.value;
    const handleB = cityPluginInstance.addCityModel.mock.results[1]!.value;

    handleA.getBoundsGeodetic.mockClear();
    handleB.getBoundsGeodetic.mockClear();
    ref.current!.fitLayer("b");
    expect(handleA.getBoundsGeodetic).not.toHaveBeenCalled();
    expect(handleB.getBoundsGeodetic).toHaveBeenCalled();

    handleB.getBoundsGeodetic.mockClear();
    ref.current!.fitAll();
    expect(handleA.getBoundsGeodetic).toHaveBeenCalled();
    expect(handleB.getBoundsGeodetic).toHaveBeenCalled();

    // alignView reads the same union, so the align buttons work on real bounds.
    ref.current!.alignView("top");
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Task B14: per-layer rules -> handle.setStyle. The compile step and the
  // memoisation are `applyRuleColors`/`handleSync`'s (covered in their own
  // tests); what is tested here is that a rule edit in the store reaches the
  // engine at all, and that an unrelated store change does not repaint.
  // -------------------------------------------------------------------------

  it("pushes a layer's rules to its handle, and clears them when switched off", async () => {
    const rules = [
      {
        id: "r1",
        name: "all roofs",
        color: "#4ec84e",
        conditions: [],
        logic: "AND" as const,
        enabled: true,
      },
    ];
    useLayerStore.setState({ layers: [makeLayer({ id: "a", rules })] });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    const handle = cityPluginInstance.addCityModel.mock.results[0]!.value;
    await waitFor(() => expect(handle.setStyle).toHaveBeenCalledTimes(1));
    expect(typeof handle.setStyle.mock.calls[0]![0]).toBe("function");

    // An unrelated change (visibility) must not repaint the layer.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a", rules, visible: false })],
    });
    await waitFor(() => expect(handle.setVisible).toHaveBeenCalledWith(false));
    expect(handle.setStyle).toHaveBeenCalledTimes(1);

    // Switching the layer's rules off clears the style.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a", rules, rulesEnabled: false })],
    });
    await waitFor(() => expect(handle.setStyle).toHaveBeenCalledTimes(2));
    expect(handle.setStyle).toHaveBeenLastCalledWith(null);
  });

  it("forgets its handles when the engine is disposed, so a remount re-adds", async () => {
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalled());

    // Stale entries would make the second mount believe the (disposed) meshes
    // were still live and render nothing.
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(2),
    );
  });
});
