/**
 * NavaraViewport camera wiring and its imperative handle.
 *
 * Companion to `navaraViewport.test.tsx` (the static half),
 * `navaraViewportSolar.test.tsx` and `navaraViewportStreaming.test.tsx`, and it
 * plays by the same rules: the engine and both plugin subpaths are MOCKED and
 * never imported for real (`@navaramap/three` crashes at module scope under
 * Node — Task B1: NODE_IMPORT_SAFE = false — and jsdom has no WebGL).
 *
 * What is asserted here is the wiring the pure maths in
 * `cameraControls.test.ts` cannot reach:
 *
 *  - the compass follows the camera through the engine's `movestart`/`move`/
 *    `moveend` events, which live on `view.camera`, NOT on the view;
 *  - it also follows the moves that emit NO events — `setCamera`, such as an
 *    alignment — because those publish their own pose;
 *  - imperative zoom and north-reset moves go through streaming settle
 *    suppression, so they cannot masquerade as pans and re-trigger FCB fetches;
 *  - no pose is exposed until the engine has a camera to report, and it is
 *    cleared once the engine is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
// Returns the never-landing flight declared below (called only after module init).
const flyTo = vi.fn((..._args: unknown[]): unknown => flightInProgress);

/** The view's own bus (`postRender` is what seeds the first pose). */
const listeners = new Map<string, Set<(...args: never[]) => void>>();
const on = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
});
const off = vi.fn((name: string, fn: (...args: never[]) => void) => {
  listeners.get(name)?.delete(fn);
});

/** The CAMERA's bus — `movestart`/`move`/`moveend` are emitted here, which is
 *  the whole reason this file exists (Task B1 finding 6). */
const cameraListeners = new Map<string, Set<(...args: never[]) => void>>();
const cameraOn = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = cameraListeners.get(name) ?? new Set();
  set.add(fn);
  cameraListeners.set(name, set);
});
const cameraOff = vi.fn((name: string, fn: (...args: never[]) => void) => {
  cameraListeners.get(name)?.delete(fn);
});

/** Reproduces the engine's real pre-first-frame behaviour: `positionGeographic`
 *  throws a bare "Invariant failed" until the camera reaches the Rust core. */
let cameraThrows = true;
/** What the mocked camera currently reports. */
let pose = { heading: 45, pitch: -60, roll: 0 };
let position = { lng: 4.35, lat: 52, height: 500 };
let cameraZoom: number | undefined = 15.5;
/** Every `camera.options = ...` assignment, in order. */
let cameraOptions: { enableSpin?: boolean; enableTilt?: boolean }[] = [];

function fireView(name: string, ...args: unknown[]): void {
  act(() => {
    for (const fn of Array.from(listeners.get(name) ?? [])) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  });
}
function fireCamera(name: string): void {
  act(() => {
    for (const fn of Array.from(cameraListeners.get(name) ?? [])) {
      (fn as () => void)();
    }
  });
}

const atmosphere = {
  date: new Date("2026-06-21T12:00:00.000Z"),
  getSunDirection: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("@navaramap/three", () => ({
  // The engine's terrarium DEM decoder — the elevation-heatmap basemap's
  // source names it as a MARKER in `basemaps.ts` (engine-free) and the
  // viewport resolves it here, at the engine seam.
  TERRARIUM_ELEVATION_DECODER: vi.fn(() => ({ decoder: "terrarium" })),
  // The base classes the theme's bloom descriptor is built out of
  // (`bloomEffect.ts`, reached through `NavaraViewport`'s import). Every named
  // import of a mocked module has to exist or the mock refuses to link, so
  // these are here even though nothing in this suite ever enters a themed look
  // — the bloom behaviour itself is covered in `navaraViewportTheme.test.tsx`.
  EffectDesc: class {},
  Effect: class {},
  // The engine's `Color`, which declares NO constructor parameters — the
  // documented forms are `new Color().setHex(...)` / `.setStyle(...)`. Present
  // in every viewport suite's mock because `NavaraViewport` imports it for the
  // geospatial highlight, and a named import of a mocked module that the
  // factory does not export refuses to link.
  // The engine's `ColorMap` — `addBasemap` builds the elevation heatmap's
  // ramp out of it. A named import of a mocked module has to exist to link.
  ColorMap: class {},
  Color: class {
    setHex() {
      return this;
    }
    setStyle() {
      return this;
    }
  },
  default: vi.fn(function () {
    return {
      addPlugin: vi.fn(),
      init,
      dispose,
      on,
      off,
      atmosphere,
      camera: {
        raw: {},
        // The scale bar's input. `number | undefined` in the engine's own
        // typing — undefined until it has rendered.
        get zoom() {
          return cameraZoom;
        },
        // The view modes' only controller knob (a partial-assignment setter).
        set options(next: { enableSpin?: boolean; enableTilt?: boolean }) {
          cameraOptions.push(next);
        },
        get positionGeographic() {
          if (cameraThrows) throw new Error("Invariant failed");
          return position;
        },
        get orientation() {
          return pose;
        },
        on: cameraOn,
        off: cameraOff,
      },
      setCamera,
      flyTo,
      addSource: vi.fn(() => ({ id: "src", delete: vi.fn(() => true) })),
      addLayer: vi.fn(() => ({ id: "layer", delete: vi.fn() })),
      addEffect: vi.fn(() => ({ id: "fx", update: vi.fn(), delete: vi.fn() })),
      resize: vi.fn(),
      toneMappingExposure: 1,
      screenSize: { x: 800, y: 600 },
      pixelRatio: 1,
      pickDepthPosition: vi.fn(() => null as unknown),
    };
  }),
  getPickRay: vi.fn(() => null as unknown),
  vector3ToGeodetic: vi.fn(() => ({ lng: 0, lat: 0, height: 0 })),
  radianToDegree: vi.fn((r: number) => (r * 180) / Math.PI),
  degreeToRadian: vi.fn((d: number) => (d * Math.PI) / 180),
  geodeticToVector3: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
}));

vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return { addDefaultPhotorealScene: vi.fn() };
  }),
}));

const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: vi.fn(function () {
    return cityPluginInstance;
  }),
}));

/** The settle-suppression bracket every programmatic move must pass through.
 *  A passthrough, so the move still happens — but a RECORDED one, because "did
 *  this move run inside the window?" is the assertion. */
const suppressSettleThenCommit = vi.fn(async (fn: () => unknown) => fn());
/** A flight that never lands — `view.flyTo`'s return on Navara 0.1.x resolves
 *  at the END of the flight, and the settle gate holds only as long as the
 *  move hands that very promise to `suppressSettleThenCommit`. */
const flightInProgress = new Promise<boolean>(() => {});
function settleWrappedMove(): unknown {
  const move = suppressSettleThenCommit.mock.calls.at(-1)![0] as () => unknown;
  return move();
}
vi.mock("@cityjson/navara-flatcitybuf/plugin", () => ({
  FlatCityBufPlugin: vi.fn(function () {
    return {
      openStream: vi.fn(),
      remove: vi.fn(),
      dispose: vi.fn(),
      suppressSettleThenCommit,
    };
  }),
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import { getCameraPose } from "../../../src/scene/cameraPose";
import { ZOOM_IN_FACTOR } from "../../../src/scene/cameraControls";
import type { GeographicCameraState } from "../../../src/scene/geographicCamera";
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import { useSolarStore } from "../../../src/features/solar/solarStore";
import {
  DEFAULT_VIEW_MODE,
  useViewModeStore,
} from "../../../src/features/viewMode/viewModeStore";
import {
  PLAN_PITCH_DEG,
  TILTED_PITCH_DEG,
} from "../../../src/scene/viewModePolicy";
import type { CityModel } from "../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../src/features/workspace/workspaceStore";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../src/scene/cityColors";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const BOUNDS = {
  west: 4.35,
  south: 52,
  east: 4.36,
  north: 52.01,
  minHeight: 0,
  maxHeight: 20,
};

function makeLayer(id: string): Layer {
  return {
    id,
    name: id,
    model: {
      objects: {},
      vertices: [],
      transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
      metadata: {
        referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
      },
      bbox: [0, 0, 0, 1, 1, 1],
    } as unknown as CityModel,
    modelRef: { type: "url", url: `https://example.test/${id}` },
    visible: true,
    rules: [],
    rulesEnabled: true,
    // Defaults, like every other field of this fixture: a layer with no
    // rules colours by surface type. A case that needs a mode sets one.
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
  } as Layer;
}

function makeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setVisibleObjectIds: vi.fn(),
    setStyle: vi.fn(),
    // The real `CityModelHandle` gained this with the scene themes; the
    // viewport pushes the active theme's style on the same beat as LoD.
    setThemeStyle: vi.fn(),
    setAppearance: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(() => null as unknown),
    batchIdMap: vi.fn(() => []),
    triangleCount: vi.fn(() => 10),
    heightOffset: vi.fn(() => 0),
    getBoundsGeodetic: vi.fn(() => BOUNDS),
    delete: vi.fn(),
  };
}

/** The last camera `setCamera` was handed. */
function lastCamera(): GeographicCameraState {
  const call = setCamera.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0] as GeographicCameraState;
}

/** Mount, let the engine come up, and give it the first rendered frame that
 *  makes the camera readable. */
async function mount(withLayer = false) {
  if (withLayer) {
    useLayerStore.setState({ layers: [makeLayer("a")] });
    useWorkspaceStore.setState({ activeLayerId: "a" });
    cityPluginInstance.addCityModel.mockImplementation(() => makeHandle("a"));
  }
  const ref = { current: null as CitySceneHandle | null };
  const result = render(
    <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
  );
  await waitFor(() => expect(cameraOn).toHaveBeenCalled());
  return { ...result, ref };
}

describe("NavaraViewport camera controls", () => {
  beforeEach(() => {
    listeners.clear();
    cameraListeners.clear();
    cameraThrows = true;
    pose = { heading: 45, pitch: -60, roll: 0 };
    position = { lng: 4.35, lat: 52, height: 500 };
    cameraZoom = 15.5;
    cameraOptions = [];
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
    setCamera.mockClear();
    flyTo.mockClear();
    cameraOn.mockClear();
    cameraOff.mockClear();
    suppressSettleThenCommit.mockClear();
    cityPluginInstance.addCityModel.mockReset();
    cityPluginInstance.getHandle.mockReset();
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useSolarStore.getState().setLatLon(null);
  });

  afterEach(() => {
    cleanup();
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
  });

  it("subscribes to the CAMERA's move events, not the view's", async () => {
    await mount();
    const names = cameraOn.mock.calls.map((c) => c[0]);
    expect(names).toContain("movestart");
    expect(names).toContain("move");
    expect(names).toContain("moveend");
  });

  it("stays idle until the engine has rendered a frame it can read", async () => {
    await mount();
    // `positionGeographic` still throws — no camera pose is available yet.
    expect(getCameraPose()).toBeNull();

    cameraThrows = false;
    fireView("postRender");
    expect(getCameraPose()).toEqual({
      heading: 45,
      pitch: -60,
      lat: 52,
      zoom: 15.5,
    });
  });

  it("follows a gesture: the dial tracks the camera's own move events", async () => {
    await mount();
    cameraThrows = false;
    fireView("postRender");
    pose = { heading: 200, pitch: -30, roll: 0 };
    fireCamera("moveend");
    expect(getCameraPose()).toMatchObject({ heading: 200, pitch: -30 });
  });

  it("follows an alignment too, though `setCamera` emits no events", async () => {
    // The regression this guards: `setCamera` is instant and silent (Task C7),
    // so an alignment would leave the compass reading the heading it replaced.
    const { ref } = await mount(true);
    cameraThrows = false;
    fireView("postRender");
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalled(),
    );
    setCamera.mockClear();

    act(() => ref.current!.alignView("left"));
    const aligned = lastCamera();
    expect(getCameraPose()).toMatchObject({ heading: aligned.heading });
    // A view from the left is a view towards the east.
    expect(aligned.heading).toBeCloseTo(90, 6);
  });

  it("zooms towards what the camera is looking at, inside the settle window", async () => {
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");

    act(() => ref.current!.zoomIn());

    expect(suppressSettleThenCommit).toHaveBeenCalled();
    const next = lastCamera();
    // A pivot-anchored zoom keeps the aim and scales the distance.
    expect(next.heading).toBeCloseTo(45, 6);
    expect(next.pitch).toBeCloseTo(-60, 6);
    expect(next.height).toBeCloseTo(500 * ZOOM_IN_FACTOR, 6);
  });

  it("zooms out by exactly the inverse step", async () => {
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");

    act(() => ref.current!.zoomOut());
    expect(suppressSettleThenCommit).toHaveBeenCalled();
    expect(lastCamera().height).toBeCloseTo(500 / ZOOM_IN_FACTOR, 6);
  });

  it("faces north through the imperative API inside the settle window", async () => {
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");

    act(() => ref.current!.resetNorth());

    expect(suppressSettleThenCommit).toHaveBeenCalled();
    expect(lastCamera().heading).toBe(0);
    expect(getCameraPose()).toMatchObject({ heading: 0 });
  });

  it("hands the camera back and unsubscribes when the engine goes away", async () => {
    const { unmount } = await mount();
    cameraThrows = false;
    fireView("postRender");
    expect(getCameraPose()).not.toBeNull();

    unmount();

    // A dial still reading its last heading would be a readout for a scene
    // that is gone.
    expect(getCameraPose()).toBeNull();
    const names = cameraOff.mock.calls.map((c) => c[0]);
    expect(names).toContain("movestart");
    expect(names).toContain("move");
    expect(names).toContain("moveend");
  });
});

/**
 * The view modes and the search flight — the half of both features that only
 * exists once there is an engine to talk to.
 */
describe("NavaraViewport view modes and flyTo", () => {
  beforeEach(() => {
    listeners.clear();
    cameraListeners.clear();
    cameraThrows = true;
    pose = { heading: 45, pitch: -60, roll: 0 };
    position = { lng: 4.35, lat: 52, height: 500 };
    cameraZoom = 15.5;
    cameraOptions = [];
    setCamera.mockClear();
    flyTo.mockClear();
    // `mount()` waits on `cameraOn`, so a stale call from the previous test's
    // view would let it return before THIS engine is up.
    cameraOn.mockClear();
    cameraOff.mockClear();
    suppressSettleThenCommit.mockClear();
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
  });

  afterEach(() => {
    cleanup();
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
  });

  it("hands the engine the controller flags the mode asks for", async () => {
    await mount();
    cameraThrows = false;
    fireView("postRender");
    expect(cameraOptions.at(-1)).toEqual({
      enableSpin: true,
      enableTilt: true,
    });

    act(() => useViewModeStore.getState().setViewMode("2.5d"));
    expect(cameraOptions.at(-1)).toEqual({
      enableSpin: true,
      enableTilt: false,
    });

    act(() => useViewModeStore.getState().setViewMode("2d"));
    expect(cameraOptions.at(-1)).toEqual({
      enableSpin: false,
      enableTilt: false,
    });
  });

  it("flies the camera flat when 2D is entered, keeping where it is", async () => {
    await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();

    act(() => useViewModeStore.getState().setViewMode("2d"));

    expect(flyTo).toHaveBeenCalledTimes(1);
    const [next] = flyTo.mock.calls[0]!;
    expect(next).toMatchObject({
      lng: 4.35,
      lat: 52,
      height: 500,
      heading: 0,
      pitch: PLAN_PITCH_DEG,
    });
    // A programmatic move is not a gesture: it goes through the streaming
    // settle window like every other one — holding it for the whole flight.
    expect(suppressSettleThenCommit).toHaveBeenCalled();
    expect(settleWrappedMove()).toBe(flightInProgress);
  });

  it("tilts to exactly 60 degrees for 2.5D, keeping the heading", async () => {
    await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();

    act(() => useViewModeStore.getState().setViewMode("2.5d"));
    expect(flyTo.mock.calls[0]![0]).toMatchObject({
      heading: 45,
      pitch: TILTED_PITCH_DEG,
    });
  });

  it("does NOT fly when a restored snapshot mounts in a mode", async () => {
    // The camera the snapshot saved is applied around the same moment; an
    // entry flight here would throw the restored viewpoint away.
    useViewModeStore.setState({ mode: "2d" });
    await mount();
    cameraThrows = false;
    fireView("postRender");

    expect(flyTo).not.toHaveBeenCalled();
    // The controller flags ARE applied, though — the mode has to be real.
    expect(cameraOptions.at(-1)).toEqual({
      enableSpin: false,
      enableTilt: false,
    });
  });

  it("frees the camera for 3D without moving it", async () => {
    useViewModeStore.setState({ mode: "2d" });
    await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();

    act(() => useViewModeStore.getState().setViewMode("3d"));
    expect(flyTo).not.toHaveBeenCalled();
    expect(cameraOptions.at(-1)).toEqual({
      enableSpin: true,
      enableTilt: true,
    });
  });

  it("flies to a searched place, animated, and lets the mode pin the angle", async () => {
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();

    act(() =>
      ref.current!.flyTo({ lng: 6.92, lat: 53.33, heightM: 1500 }, 1200),
    );
    expect(flyTo).toHaveBeenCalledTimes(1);
    const [target, options] = flyTo.mock.calls[0]!;
    expect(target).toMatchObject({
      lng: 6.92,
      lat: 53.33,
      height: 1500,
      heading: 0,
      pitch: -60,
    });
    // Navara 0.1.x: the duration travels in a `FlyToOptions` object (with
    // `maxHeight`/`easing`), no longer as a bare second argument.
    expect(options).toEqual({ duration: 1200 });
    expect(suppressSettleThenCommit).toHaveBeenCalled();
    // ...and the flight promise (resolved at the END of the flight) is what
    // the settle gate holds on: the move RETURNS it, never `void`s it.
    expect(settleWrappedMove()).toBe(flightInProgress);
  });

  it("keeps a searched flight flat while in 2D", async () => {
    useViewModeStore.setState({ mode: "2d" });
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();

    act(() => ref.current!.flyTo({ lng: 6.92, lat: 53.33, heightM: 1500 }));
    expect(flyTo.mock.calls[0]![0]).toMatchObject({
      pitch: PLAN_PITCH_DEG,
      heading: 0,
    });
  });

  it("refuses a target it cannot fly to", async () => {
    const { ref } = await mount();
    cameraThrows = false;
    fireView("postRender");
    flyTo.mockClear();
    act(() =>
      ref.current!.flyTo({ lng: Number.NaN, lat: 53.33, heightM: 1500 }),
    );
    expect(flyTo).not.toHaveBeenCalled();
  });

  it("publishes the zoom the scale bar reads, and hides it when there is none", async () => {
    await mount();
    cameraThrows = false;
    fireView("postRender");
    expect(getCameraPose()!.zoom).toBe(15.5);
    expect(getCameraPose()!.lat).toBe(52);

    cameraZoom = 16.5;
    pose = { heading: 45, pitch: -60, roll: 0 };
    fireCamera("moveend");
    expect(getCameraPose()!.zoom).toBe(16.5);

    cameraZoom = undefined;
    fireCamera("moveend");
    expect(getCameraPose()!.zoom).toBeUndefined();
  });
});
