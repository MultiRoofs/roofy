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
import { act, cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
const flyTo = vi.fn();
/** `view.addSource` / `view.addLayer` — the whole of the Google tiles seam
 *  (Task C17). `addSource` answers with a `Source`-shaped stub, which is what
 *  the layer must reference. */
const addSource = vi.fn((_source: unknown) => ({
  id: "src-1",
  type: "3d-tiles",
}));
const addLayer = vi.fn();

/** The engine's event bus, reduced to what `view.on/off` need. Tests drive the
 *  viewport by FIRING these, which is the only honest way to exercise a
 *  component whose whole input surface is `view.on(...)`. */
const listeners = new Map<string, Set<(...args: never[]) => void>>();
const on = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
});
const off = vi.fn((name: string, fn: (...args: never[]) => void) => {
  listeners.get(name)?.delete(fn);
});
function fire(name: string, ...args: unknown[]): void {
  for (const fn of [...(listeners.get(name) ?? [])]) {
    (fn as (...a: unknown[]) => void)(...args);
  }
}
/** A mouse event as the engine delivers it: canvas-relative `offsetX/offsetY`
 *  plus the viewport-relative `clientX/clientY` the router must NOT use. */
function mouse(x: number, y: number, patch: Record<string, unknown> = {}) {
  return { offsetX: x, offsetY: y, clientX: x + 300, clientY: y, ...patch };
}

/** The engine's atmosphere, reduced to the surface the solar wiring touches
 *  (Task C16). Exercised for real in `navaraViewportSolar.test.tsx`; here it
 *  only has to exist, because the viewport pushes the store's datetime into it
 *  as soon as the engine is up. */
const atmosphere = {
  date: new Date("2026-06-21T12:00:00.000Z"),
  getSunDirection: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
  on: vi.fn(),
  off: vi.fn(),
};

/** `pickDepthPosition` — the ECEF point under the cursor, or null (sky). */
const pickDepthPosition = vi.fn((_x: number, _y: number) => null as unknown);
/** `getPickRay` — the ECEF ray the router raycasts every handle with. */
const RAY = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
const getPickRay = vi.fn(() => RAY as unknown);
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
        raw: {},
        get positionGeographic() {
          if (cameraThrows) throw new Error("Invariant failed");
          return { lng: 4.35, lat: 52, height: 500 };
        },
        orientation: { heading: 0, pitch: -60, roll: 0 },
      },
      setCamera,
      flyTo,
      addSource,
      addLayer,
      atmosphere,
      screenSize: { x: 800, y: 600 },
      pixelRatio: 1,
      pickDepthPosition,
    };
    viewInstances.push(view);
    return view;
  }),
  getPickRay,
  // The engine reports geodetic angles in RADIANS; the readout wants degrees.
  // Both are identity-ish here so a test can assert the exact numbers.
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

/** The streaming plugin is mocked here only so this file can keep testing the
 *  STATIC half in isolation — `suppressSettleThenCommit` is a passthrough, so every
 *  camera assertion below reads exactly as it did before Task C13 wrapped the
 *  four programmatic moves. The streaming wiring itself is asserted in
 *  `navaraViewportStreaming.test.tsx`. */
const flatPluginInstance = {
  openStream: vi.fn(),
  remove: vi.fn(),
  dispose: vi.fn(),
  suppressSettleThenCommit: vi.fn(async (fn: () => unknown) => fn()),
};
vi.mock("@cityjson/navara-flatcitybuf/plugin", () => ({
  FlatCityBufPlugin: vi.fn(function () {
    return flatPluginInstance;
  }),
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import type { CityModel } from "../../../src/domain/citymodel/types";
// The licence text the attribution overlay must show whatever else is on
// screen (Task C17 / Global Constraints -> Vertical datum).
import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";

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

/** CityJSON spells its CRS as an OGC URI, and that is the only form
 *  `parseEpsgCode` accepts — a bare "EPSG:7415" would be refused by the CRS
 *  gate, so the fixture must not use one. */
const CRS_URI = "https://www.opengis.net/def/crs/EPSG/0/7415";

function makeLayer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model: makeModel(CRS_URI),
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
    resolvePick: vi.fn((pick: { properties?: { surfaceIndex?: number } }) => ({
      kind: "surface",
      layerId: id,
      objectId: `${id}-obj`,
      surfaceIndex: pick.properties?.surfaceIndex ?? 0,
    })),
    resolveRaycast: vi.fn(() => null as unknown),
    batchIdMap: vi.fn(() => []),
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

describe("NavaraViewport lifecycle", () => {
  beforeEach(() => {
    addPlugin.mockClear();
    init.mockClear();
    dispose.mockClear();
    setCamera.mockClear();
    flyTo.mockClear();
    addSource.mockClear();
    addLayer.mockClear();
    on.mockClear();
    off.mockClear();
    listeners.clear();
    getPickRay.mockClear();
    pickDepthPosition.mockClear();
    pickDepthPosition.mockReturnValue(null);
    CityJSONPluginMock.mockClear();
    useSelectionStore.setState({
      mode: "object",
      toolMode: "select",
      selections: [],
      hovered: null,
    });
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
    useSelectionStore.setState({
      toolMode: "select",
      selections: [],
      hovered: null,
    });
  });

  it("registers DefaultPlugin then CityJSONPlugin, both before view.init()", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    // The FlatCityBuf plugin is third; its own ordering guarantees live in
    // `navaraViewportStreaming.test.tsx`.
    expect(addPlugin.mock.calls.map((c) => c[0]).slice(0, 2)).toEqual([
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

  it("REJECTS `ready` when the viewport unmounts before the engine came up", async () => {
    // A real race, not a hypothetical: `App.tsx` unmounts the viewport the
    // moment the last layer goes away (`handleClose` -> `removeAllLayers`), and
    // Task C20 replaces its 100 ms setTimeout with `await sceneRef.current
    // .ready`. Every `return` inside the queued init body is guarded by
    // `cancelled`, so once the cleanup has run NOTHING can resolve that gate —
    // a consumer awaiting it would wait forever unless the cleanup settles it.
    let release!: () => void;
    init.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const ref = createRef<CitySceneHandle>();
    const { unmount } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(init).toHaveBeenCalled());
    // What a consumer would already be holding — `ref.current` is null after
    // the unmount, so this has to be captured first.
    const pending = ref.current!.ready;

    unmount();
    await expect(pending).rejects.toThrow(
      /unmounted before the 3D engine finished starting/,
    );

    // The engine finally comes up with nobody home: the dead gate must not be
    // re-settled, and nothing may throw.
    release();
    await act(async () => {
      await Promise.resolve();
    });

    // …and the rejection must not poison the module-level engine slot: the
    // next mount still comes up and resolves its OWN gate.
    init.mockImplementation(async () => {});
    const ref2 = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref2} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref2.current).not.toBeNull());
    await expect(ref2.current!.ready).resolves.toBeUndefined();
  });

  // ALSO the regression guard for the ready gate's RE-ARM. StrictMode runs
  // setup/cleanup/setup against one render, so the first pass's cleanup rejects
  // the gate the component was born with; without the replacement installed in
  // the same breath, the second pass would resolve a promise nobody can reuse
  // and `ready` below would stay rejected forever. (It does NOT guard the
  // getter on the handle — React happens to rebuild the imperative handle in
  // lockstep with this cleanup, so a captured promise would pass here too.
  // The getter is there to stop the component depending on that ordering.)
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
        { id: "a", crs: CRS_URI, lod: "1.2" },
        { id: "b", crs: CRS_URI, lod: null },
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

  // -------------------------------------------------------------------------
  // Task B15: the interaction hub. Pointer events -> pick intents -> the
  // selection store, selection/hover -> setHighlight, and the cursor readout.
  // The decisions themselves live in `pickEventHandlers`/`handleSync`/
  // `cursorCrsReadout`; what is tested here is that the engine's events reach
  // them, in the right coordinate space, and that the results reach the store.
  // -------------------------------------------------------------------------

  /** Two static layers whose raycasts land at the given distances. Layer "a"
   *  comes FIRST in the store, so a first-layer-wins router would always
   *  return it. */
  async function mountTwoLayers(
    distances: { a: number | null; b: number | null },
    props: Record<string, unknown> = {},
  ) {
    useLayerStore.setState({
      layers: [makeLayer({ id: "a" }), makeLayer({ id: "b" })],
    });
    const view = render(
      <NavaraViewport onTriangleCount={() => {}} {...props} />,
    );
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(2),
    );
    const handles = {
      a: cityPluginInstance.addCityModel.mock.results[0]!.value,
      b: cityPluginInstance.addCityModel.mock.results[1]!.value,
    };
    for (const key of ["a", "b"] as const) {
      const d = distances[key];
      handles[key].resolveRaycast.mockReturnValue(
        d === null ? null : { objectIndex: 0, surfaceIndex: 7, distance: d },
      );
    }
    await waitFor(() =>
      expect(on.mock.calls.some((c) => c[0] === "mousemove")).toBe(true),
    );
    // The div the engine would append its canvas to — and the element the
    // viewport binds its own DOM listeners to.
    const host = view.container.querySelector(
      ".navara-viewport__canvas",
    ) as HTMLElement;
    return { ...view, handles, host };
  }

  /** A real DOM mouse event, optionally announced to the engine bus FIRST —
   *  which is the real ordering: the engine listens on the canvas, the viewport
   *  on its parent, so bubbling puts the engine handler first. */
  function domMouse(
    host: HTMLElement,
    type: string,
    x: number,
    y: number,
    opts: { engineSees?: boolean } = {},
  ) {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x + 300 });
    Object.defineProperty(ev, "offsetX", { value: x });
    Object.defineProperty(ev, "offsetY", { value: y });
    const relay = (e: Event) => fire(type, e);
    if (opts.engineSees) host.addEventListener(type, relay, true);
    act(() => {
      host.dispatchEvent(ev);
    });
    if (opts.engineSees) host.removeEventListener(type, relay, true);
    return ev;
  }

  it("hovers the NEAREST layer under the cursor, not the first in the list", async () => {
    const { handles } = await mountTwoLayers({ a: 900, b: 12 });
    act(() => fire("mousemove", mouse(10, 20)));

    // Every visible layer is raycast — you cannot know which is nearest
    // without asking — but only the winner interprets its own indices.
    expect(handles.a.resolveRaycast).toHaveBeenCalledWith(RAY);
    expect(handles.b.resolveRaycast).toHaveBeenCalledWith(RAY);
    expect(handles.a.resolvePick).not.toHaveBeenCalled();
    // Default PickMode is "object", so the surface hit is narrowed.
    expect(useSelectionStore.getState().hovered).toEqual({
      kind: "object",
      layerId: "b",
      objectId: "b-obj",
    });
  });

  it("raycasts from CANVAS-relative pixels, not viewport clientX/clientY", async () => {
    // The app renders the canvas beside a left sidebar; using clientX would
    // put every pick a sidebar's width to the right of the cursor.
    await mountTwoLayers({ a: null, b: null });
    act(() => fire("mousemove", mouse(10, 20)));
    const [windowLike, camera, point] = getPickRay.mock
      .calls[0]! as unknown as [
      { width: number; height: number; pixelRatio: number },
      unknown,
      { x: number; y: number },
    ];
    expect(point.x).toBe(10);
    expect(point.y).toBe(20);
    expect(windowLike).toEqual({ width: 800, height: 600, pixelRatio: 1 });
    expect(camera).toBe(
      (viewInstances[0] as { camera: { raw: unknown } }).camera.raw,
    );
  });

  it("does not re-push an unchanged hover (a repaint per mousemove otherwise)", async () => {
    const { handles } = await mountTwoLayers({ a: null, b: 12 });
    act(() => fire("mousemove", mouse(10, 20)));
    handles.b.setHighlight.mockClear();
    act(() => fire("mousemove", mouse(11, 21)));
    // Same surface: the resolved Selection is a fresh object each time, so
    // without a value comparison the store would churn and every layer would
    // repaint its vertex colors at pointer rate.
    expect(handles.b.setHighlight).not.toHaveBeenCalled();
  });

  it("selects on click and toggles on shift-click", async () => {
    await mountTwoLayers({ a: null, b: 12 });
    act(() => {
      fire("mousedown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "b", objectId: "b-obj" },
    ]);

    act(() => {
      fire("mousedown", mouse(10, 20));
      fire("click", mouse(10, 20, { shiftKey: true }));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("clicking empty space clears the selection", async () => {
    await mountTwoLayers({ a: null, b: null });
    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "b", objectId: "b-obj" }],
    });
    act(() => {
      fire("mousedown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("ignores the click that ends a camera DRAG", async () => {
    // The engine's `click` is the raw DOM click and fires after an orbit too;
    // without the gate every camera gesture would clear the selection.
    await mountTwoLayers({ a: null, b: 12 });
    act(() => {
      fire("mousedown", mouse(100, 100));
      fire("mousemove", mouse(160, 100));
      fire("click", mouse(160, 100));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("swallows both gestures in measure mode and never commits in box-select", async () => {
    await mountTwoLayers({ a: null, b: 12 });
    useSelectionStore.setState({ toolMode: "measure" });
    act(() => {
      fire("mousemove", mouse(10, 20));
      fire("mousedown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(useSelectionStore.getState().selections).toEqual([]);

    // box-select still hovers (the old app did) but leaves the commit to its
    // drag overlay.
    useSelectionStore.setState({ toolMode: "box-select" });
    act(() => fire("mousemove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();
    act(() => {
      fire("mousedown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("clears the hover and the readout when the pointer leaves the canvas", async () => {
    // A DOM listener, not the engine's `mouseleave`: the engine skips the emit
    // whenever the screen ray misses the ellipsoid, so leaving the canvas
    // across a sky pixel would never be reported.
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    act(() => fire("mousemove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();

    onCursorPosition.mockClear();
    domMouse(host, "mouseleave", 0, 0);
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(onCursorPosition).toHaveBeenCalledWith(null);
  });

  it("clears hover and readout on a move the engine never reported (SKY)", async () => {
    // The engine emits nothing at all — not even mouseleave — when the screen
    // ray misses the ellipsoid, so without this the highlight and the status
    // bar freeze at their last on-globe values.
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    act(() => fire("mousemove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();

    onCursorPosition.mockClear();
    domMouse(host, "mousemove", 400, 400); // engine stayed silent => sky
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(onCursorPosition).toHaveBeenCalledWith(null);
  });

  it("does NOT clear on a move the engine did report", async () => {
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    pickDepthPosition.mockReturnValue({
      x: (4.348 * Math.PI) / 180,
      y: (52.006 * Math.PI) / 180,
      z: 14,
    });
    onCursorPosition.mockClear();
    domMouse(host, "mousemove", 10, 20, { engineSees: true });
    // Same event object reached both listeners: the cursor is on the globe.
    expect(useSelectionStore.getState().hovered).not.toBeNull();
    expect(onCursorPosition.mock.calls.at(-1)![0]).not.toBeNull();
  });

  it("arms the drag gate from the DOM too, so a gesture over sky still blocks", async () => {
    // A mousedown over the sky is invisible to the engine; a gate armed only by
    // engine events would still be holding the previous gesture's state.
    const { host } = await mountTwoLayers({ a: null, b: 12 });
    domMouse(host, "mousedown", 100, 100);
    domMouse(host, "mousemove", 160, 100);
    act(() => fire("click", mouse(160, 100)));
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("reports the cursor in the layer's source CRS at ORTHOMETRIC height", async () => {
    const onCursorPosition = vi.fn();
    const { handles } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    // The layer is placed 43.2 m up by the geoid sample, so the ellipsoidal
    // height under the cursor is 43.2 m above the file's own z.
    handles.b.heightOffset.mockReturnValue(43.2);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    pickDepthPosition.mockReturnValue({
      x: rad(4.348),
      y: rad(52.006),
      z: 14 + 43.2,
    });

    act(() => fire("mousemove", mouse(10, 20)));
    expect(pickDepthPosition).toHaveBeenCalledWith(10, 20);
    const out = onCursorPosition.mock.calls.at(-1)![0] as [
      number,
      number,
      number,
    ];
    // RD New metres for Delft, and the file's own z back — NOT 57.2.
    expect(out[0]).toBeCloseTo(83574.16, 1);
    expect(out[1]).toBeCloseTo(446893.03, 1);
    expect(out[2]).toBeCloseTo(14, 6);
  });

  it("reports no position when the cursor is on the sky", async () => {
    const onCursorPosition = vi.fn();
    await mountTwoLayers({ a: null, b: null }, { onCursorPosition });
    pickDepthPosition.mockReturnValue(null);
    act(() => fire("mousemove", mouse(10, 20)));
    expect(onCursorPosition).toHaveBeenLastCalledWith(null);
  });

  it("pushes a selection to its owning handle, HIDDEN or not", async () => {
    const { handles } = await mountTwoLayers({ a: null, b: null });
    const inB = { kind: "object" as const, layerId: "b", objectId: "b-obj" };
    handles.a.setHighlight.mockClear();
    handles.b.setHighlight.mockClear();

    // The whole array goes to the handle unfiltered — it keeps only its own
    // entries — but only the handle whose own view moved is pushed to.
    act(() => useSelectionStore.setState({ selections: [inB] }));
    await waitFor(() =>
      expect(handles.b.setHighlight).toHaveBeenCalledWith([inB], undefined),
    );
    expect(handles.a.setHighlight).not.toHaveBeenCalled();

    // A HIDDEN layer still keeps up, so re-showing it cannot reveal a stale
    // highlight.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a", visible: false }), makeLayer({ id: "b" })],
    });
    const inA = { kind: "object" as const, layerId: "a", objectId: "a-obj" };
    act(() => useSelectionStore.setState({ selections: [inA] }));
    await waitFor(() =>
      expect(handles.a.setHighlight).toHaveBeenCalledWith([inA], undefined),
    );
    // ...and "b" is cleared, because its own selection went away.
    expect(handles.b.setHighlight).toHaveBeenLastCalledWith([inA], undefined);
  });

  it("repaints only the layer whose own highlight changed", async () => {
    // `setHighlight` recolors the WHOLE layer, and this runs on every hover
    // step: without a per-handle memo, hovering a building in one layer costs a
    // full recolor of every other layer too.
    const { handles } = await mountTwoLayers({ a: null, b: null });
    const inB = (objectId: string) => ({
      kind: "object" as const,
      layerId: "b",
      objectId,
    });

    act(() => useSelectionStore.setState({ hovered: inB("B1") }));
    await waitFor(() => expect(handles.b.setHighlight).toHaveBeenCalled());
    handles.a.setHighlight.mockClear();
    handles.b.setHighlight.mockClear();

    // Hover moves to another building WITHIN layer b.
    act(() => useSelectionStore.setState({ hovered: inB("B2") }));
    await waitFor(() =>
      expect(handles.b.setHighlight).toHaveBeenCalledTimes(1),
    );
    expect(handles.a.setHighlight).not.toHaveBeenCalled();
  });

  it("repaints BOTH layers when a selection change touches both", async () => {
    const { handles } = await mountTwoLayers({ a: null, b: null });
    act(() =>
      useSelectionStore.setState({
        selections: [{ kind: "object", layerId: "a", objectId: "A1" }],
      }),
    );
    await waitFor(() => expect(handles.a.setHighlight).toHaveBeenCalled());
    handles.a.setHighlight.mockClear();
    handles.b.setHighlight.mockClear();

    // Selecting in b instead: a must CLEAR and b must paint.
    act(() =>
      useSelectionStore.setState({
        selections: [{ kind: "object", layerId: "b", objectId: "B1" }],
      }),
    );
    await waitFor(() =>
      expect(handles.b.setHighlight).toHaveBeenCalledTimes(1),
    );
    expect(handles.a.setHighlight).toHaveBeenCalledTimes(1);
  });

  it("never subscribes to the engine's pick event (PICK_PATH = own-raycast)", async () => {
    // `PickableMeshWrapper` carries one uniform batch id per MESH (Task B1), so
    // a `pick` listener could only ever resolve a layer, not a surface — and it
    // would fire alongside `click`, committing a second, coarser selection.
    await mountTwoLayers({ a: null, b: null });
    expect(on.mock.calls.some((c) => c[0] === "pick")).toBe(false);
  });

  it("unsubscribes every pointer listener on unmount", async () => {
    const { unmount, host } = await mountTwoLayers({ a: null, b: 12 });
    act(() => fire("mousemove", mouse(10, 20)));
    const hovered = useSelectionStore.getState().hovered;
    expect(hovered).not.toBeNull();
    unmount();

    // The DOM listeners went with it: a stray move must not clear a hover the
    // component no longer owns.
    domMouse(host, "mousemove", 400, 400);
    domMouse(host, "mouseleave", 0, 0);
    expect(useSelectionStore.getState().hovered).toBe(hovered);

    const removed = off.mock.calls.map((c) => c[0]);
    for (const name of ["mousedown", "mousemove", "click"]) {
      expect(removed).toContain(name);
    }
    expect(listeners.get("mousemove")?.size ?? 0).toBe(0);
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

// ---------------------------------------------------------------------------
// Google Photorealistic 3D Tiles + the attribution overlay (Task C17).
//
// The API key is a build-time env var, so both branches are driven with
// `vi.stubEnv` rather than by importing the module twice. The pure config
// itself is tested in `googleTiles.test.ts`; what matters HERE is the seam —
// which engine calls happen, in what order, and what the overlay credits as a
// result.
// ---------------------------------------------------------------------------
describe("NavaraViewport Google tiles", () => {
  beforeEach(() => {
    addSource.mockClear();
    addLayer.mockClear();
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    cityPluginInstance.getHandle.mockReset();
    cityPluginInstance.addCityModel.mockReset();
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("registers ONE 3d-tiles source and layer with the key in the URL, after init", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test key&1");
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addLayer).toHaveBeenCalledTimes(1));

    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource.mock.calls[0]![0]).toEqual({
      type: "3d-tiles",
      url: "https://tile.googleapis.com/v1/3dtiles/root.json?key=test%20key%261",
    });
    // The layer references the SOURCE HANDLE `addSource` returned — an
    // inlined URL or a guessed id would silently render nothing.
    expect(addLayer.mock.calls[0]![0]).toEqual({
      type: "3d-tiles",
      source: addSource.mock.results[0]!.value,
      model: {
        normals: true,
        creaseNormalAngle: Math.PI / 6,
        castShadow: false,
        receiveShadow: true,
        maxSse: 8,
      },
    });
    // After `init()` (the engine rejects a source before it), and after the
    // default photoreal scene, which the tiles are drawn on top of.
    expect(addSource.mock.invocationCallOrder[0]!).toBeGreaterThan(
      init.mock.invocationCallOrder[0]!,
    );
    expect(addSource.mock.invocationCallOrder[0]!).toBeLessThan(
      addLayer.mock.invocationCallOrder[0]!,
    );
  });

  it("credits Google in the attribution overlay only once the layer is in the scene", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addLayer).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toMatch(/Google/),
    );
  });

  it("adds nothing and credits nobody for imagery when no key is configured", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addSource).not.toHaveBeenCalled();
    expect(addLayer).not.toHaveBeenCalled();

    // The geoid credit is NOT conditional: every georeferenced layer samples
    // that service, so it is shown even with an empty, tile-free viewport.
    const overlay = container.querySelector(".attribution-overlay");
    expect(overlay?.textContent).not.toMatch(/Google/);
    for (const line of GEOID_ATTRIBUTION) {
      expect(overlay?.textContent).toContain(line);
    }
  });

  it("keeps the viewer alive when the engine refuses the tiles layer", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    addLayer.mockImplementationOnce(() => {
      throw new Error("unsupported source");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CitySceneHandle>();
    const { container } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    // A backdrop that fails to load must not take the engine — or `ready` —
    // down with it, and must not claim a Google credit either.
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(container.querySelector(".navara-viewport__error")).toBeNull();
    expect(
      container.querySelector(".attribution-overlay")?.textContent,
    ).not.toMatch(/Google/);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
