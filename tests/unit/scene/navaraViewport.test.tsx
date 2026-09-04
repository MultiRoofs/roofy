/**
 * NavaraViewport lifecycle tests.
 *
 * The engine is MOCKED here and never imported for real: `@navaramap/three`
 * crashes at module scope under Node (Task B1: NODE_IMPORT_SAFE = false), and
 * jsdom has no WebGL anyway. The real engine is exercised by browser smokes,
 * not here.
 */
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
// Returns the never-landing flight declared below (called only after module init).
const flyTo = vi.fn((..._args: unknown[]): unknown => flightInProgress);
/** `view.addSource` / `view.addLayer` — the whole of the Google tiles seam
 *  (Task C17, toggled since Task C21). `addSource` answers with a
 *  `Source`-shaped stub, which is what the layer must reference; both stubs
 *  carry the `delete()` the toggle-off path calls. */
const deleteSource = vi.fn(() => true);
const deleteLayer = vi.fn();
const addSource = vi.fn((_source: unknown) => ({
  id: "src-1",
  type: "3d-tiles",
  delete: deleteSource,
}));
/**
 * One layer handle, as `view.addLayer` answers with.
 *
 * The id is MINTED PER CALL rather than shared. `geoLayerIdForEngineLayerId`
 * maps an engine pick back to a store record by comparing `Layer.id`, so a
 * mock that gave terrain, the basemap and a geo layer the same `"layer-1"`
 * would resolve a basemap pick to the geo layer — and would invert the
 * "unknown layer" test into a pass for the wrong reason.
 *
 * `update`/`forceUpdate`/`on` are the rest of the surface `geoLayerSync` uses:
 * a re-describe, a re-evaluation pass, and the `featureCreated` subscription
 * that carries the engine's per-material `FeatureEvaluator`.
 */
interface MockLayerHandle {
  readonly id: string;
  readonly config: unknown;
  readonly update: ReturnType<typeof vi.fn>;
  readonly forceUpdate: ReturnType<typeof vi.fn>;
  readonly delete: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
  /** The callbacks `on` recorded, by event name — how a test plays the engine
   *  and hands a layer its evaluator. */
  readonly listeners: Map<string, Array<(params: never) => void>>;
}
/** Every handle minted so far, newest last. Cleared per suite alongside
 *  `addLayer.mockClear()`. */
const layerHandles: MockLayerHandle[] = [];
let nextLayerNumber = 0;
const defaultAddLayer = (layer: unknown): MockLayerHandle => {
  nextLayerNumber += 1;
  const listeners = new Map<string, Array<(params: never) => void>>();
  const handle: MockLayerHandle = {
    id: `layer-${nextLayerNumber}`,
    config: layer,
    update: vi.fn(),
    forceUpdate: vi.fn(),
    // The SHARED spy, deliberately: several suites count removals globally.
    delete: deleteLayer,
    on: vi.fn((name: string, cb: (params: never) => void) => {
      const list = listeners.get(name) ?? [];
      list.push(cb);
      listeners.set(name, list);
    }),
    listeners,
  };
  layerHandles.push(handle);
  return handle;
};
const addLayer = vi.fn(defaultAddLayer);

/** The most recently minted handle for a layer description of this type — the
 *  counterpart of {@link lastIndexOfType}, by handle rather than by call. */
function lastHandleOfType(type: string): MockLayerHandle | undefined {
  for (let i = layerHandles.length - 1; i >= 0; i--) {
    const handle = layerHandles[i]!;
    if ((handle.config as { type?: string } | undefined)?.type === type) {
      return handle;
    }
  }
  return undefined;
}

/**
 * Find a source/layer call BY TYPE rather than by call index.
 *
 * The viewport adds global terrain before either backdrop (render order = add
 * order, and the basemap is draped over the terrain), so "the first source" is
 * the terrain's, not the one any given test is about. Filtering by type keeps
 * each test pinned to its own layer and immune to another backdrop joining
 * the scene later.
 */
function indexOfType(
  mock: { mock: { calls: unknown[][] } },
  type: string,
): number {
  return mock.mock.calls.findIndex(
    (call) => (call[0] as { type?: string } | undefined)?.type === type,
  );
}

function countOfType(
  mock: { mock: { calls: unknown[][] } },
  type: string,
): number {
  return mock.mock.calls.filter(
    (call) => (call[0] as { type?: string } | undefined)?.type === type,
  ).length;
}

/** The LAST call of a type — the re-added layer after a swap. Hand-rolled
 *  rather than `findLastIndex`, which needs a newer `lib` than this project
 *  targets. */
function lastIndexOfType(
  mock: { mock: { calls: unknown[][] } },
  type: string,
): number {
  const calls = mock.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    if ((calls[i]![0] as { type?: string } | undefined)?.type === type)
      return i;
  }
  return -1;
}

/**
 * Make the next `addLayer` for THIS type throw, leaving every other layer
 * working — `mockImplementationOnce` would now hit the terrain instead of the
 * backdrop the test is about. Restores itself once it has fired.
 */
function failAddLayerOnce(type: string): void {
  addLayer.mockImplementation((config: unknown) => {
    if ((config as { type?: string } | undefined)?.type === type) {
      addLayer.mockImplementation(defaultAddLayer);
      throw new Error("unsupported source");
    }
    return defaultAddLayer(config);
  });
}
/** `view.addEffect` — the clouds seam. The default photoreal scene does NOT
 *  add clouds (verified against the 0.0.5 bundle), so every call here is one
 *  the viewport made itself. */
const updateEffect = vi.fn();
const deleteEffect = vi.fn();
/** `EffectHandle.ref.raw.dispose()` — the CLOUDS PASS's own dispose, which is
 *  the only thing that resets `atmosphere.overlay` and therefore the only thing
 *  that actually takes the clouds out of the frame. The engine never calls it
 *  on `handle.delete()`; the viewport does. */
const disposeEffectPass = vi.fn();
const addEffect = vi.fn((_config: unknown) => ({
  id: "effect-1",
  update: updateEffect,
  delete: deleteEffect,
  ref: { raw: { dispose: disposeEffectPass } },
}));
/** `view.addLight` — nothing in the app calls it any more (the ambient fill
 *  light belonged to the retired scene-lights calibration), so it is here only
 *  so a regression that re-introduces one is a failing assertion rather than a
 *  TypeError. */
const addLight = vi.fn((_config: unknown) => ({
  id: "light-1",
  update: vi.fn(),
  delete: vi.fn(),
}));
/** `view.resize` — driven by the container ResizeObserver, because the engine
 *  itself only listens on `window`. */
const resize = vi.fn();
/** The handles `DefaultPlugin.addDefaultPhotorealScene()` returns. These ARE
 *  the engine counterparts of the Advanced Settings panel, so the mock has to
 *  return real, mutable objects rather than `undefined`. */
const photorealHandles = {
  sky: { visible: true },
  stars: { visible: true },
  skyLightProbe: { visible: true },
  sun: { visible: true, update: vi.fn() },
  // `update` too: the viewport switches this pass into `irradiance` mode right
  // after `addDefaultPhotorealScene()`, which is what lights the whole scene.
  aerialPerspective: { visible: true, update: vi.fn() },
  lensFlare: { visible: true },
  toneMapping: { visible: true },
  antialiasing: { visible: true },
};
function resetPhotorealHandles(): void {
  for (const handle of Object.values(photorealHandles)) handle.visible = true;
  photorealHandles.sun.update.mockClear();
  photorealHandles.aerialPerspective.update.mockClear();
  photorealHandles.aerialPerspective.update.mockImplementation(() => {});
}

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
  // Snapshot, not a redundant copy: a handler may register or unregister a
  // listener while it runs, and mutating the live Set mid-iteration would let
  // a just-added handler receive the event it was not present for.
  for (const fn of Array.from(listeners.get(name) ?? [])) {
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
  // documented forms are `new Color().setHex(...)` / `.setStyle(...)`. The geo
  // highlight passes instances of it into the engine's feature evaluators, so
  // the mock only has to be constructible and chainable; `hex` is recorded so a
  // test can assert WHICH colour a feature was given.
  // The engine's `ColorMap` — `addBasemap` builds the elevation heatmap's
  // ramp out of it. A named import of a mocked module has to exist to link.
  ColorMap: class {},
  Color: class {
    hex: number | undefined;
    style: string | undefined;
    setHex(hex: number) {
      this.hex = hex;
      return this;
    }
    setStyle(style: string) {
      this.style = style;
      return this;
    }
  },
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
        // `movestart`/`move`/`moveend` live on the CAMERA, not the view
        // (Task B1 finding 6). The compass overlay subscribes to them; the
        // wiring itself is asserted in `navaraViewportCamera.test.tsx`.
        on: vi.fn(),
        off: vi.fn(),
      },
      setCamera,
      flyTo,
      addSource,
      addLayer,
      addEffect,
      addLight,
      resize,
      // Written by the exposure effect. `1` is three's own default, which is
      // exactly the value that made the scene dark before Issue 2.
      toneMappingExposure: 1,
      atmosphere,
      screenSize: { x: 800, y: 600 },
      pixelRatio: 2,
      pickDepthPosition,
    };
    viewInstances.push(view);
    return view;
  }),
  getPickRay,
  // The engine reports geodetic angles in DEGREES (since 0.1.0) and the
  // readout wants degrees, so an identity mock lets a test assert exact numbers.
  vector3ToGeodetic: vi.fn((v: { x: number; y: number; z: number }) => ({
    lng: v.x,
    lat: v.y,
    height: v.z,
  })),
  radianToDegree: vi.fn((r: number) => (r * 180) / Math.PI),
}));

const defaultPluginInstance = {
  addDefaultPhotorealScene: vi.fn(() => photorealHandles),
};
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
/** A flight that never lands. `view.flyTo` returns it (Navara 0.1.x resolves
 *  the promise at the END of the flight), and the assertion that matters is
 *  that the very same object reaches `suppressSettleThenCommit` — the settle
 *  gate holds for the whole animation only if the move RETURNS it. */
const flightInProgress = new Promise<boolean>(() => {});
/** What the last settle-suppressed move hands back when re-invoked. */
function settleWrappedMove(): unknown {
  const calls = flatPluginInstance.suppressSettleThenCommit.mock.calls;
  const move = calls.at(-1)![0] as () => unknown;
  return move();
}
vi.mock("@cityjson/navara-flatcitybuf/plugin", () => ({
  FlatCityBufPlugin: vi.fn(function () {
    return flatPluginInstance;
  }),
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
// The mocked engine export the elevation-heatmap source's marker resolves to.
// DYNAMIC, like the component above: a static import would evaluate the
// `@navaramap/three` mock factory before the stubs it closes over exist.
const { TERRARIUM_ELEVATION_DECODER } = await import("@navaramap/three");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import { suppressAutoFit } from "../../../src/scene/autoFitSuppression";
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import { useViewModeStore } from "../../../src/features/viewMode/viewModeStore";
import { useTilesStore } from "../../../src/features/tiles/tilesStore";
import { useBasemapStore } from "../../../src/features/basemap/basemapStore";
import { useGeoLayerStore } from "../../../src/features/geoLayers/geoLayerStore";
import {
  DEFAULT_EXPOSURE,
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";
import { useAtmosphereStore } from "../../../src/features/atmosphere/atmosphereStore";
import { BASEMAPS } from "../../../src/scene/basemaps";
import { GEO_HIGHLIGHT_COLOR_HEX } from "../../../src/scene/geoLayerSync";
import { TERRAIN_ATTRIBUTION } from "../../../src/scene/terrain";
import type { CityModel } from "../../../src/domain/citymodel/types";
// The licence text the attribution overlay must show whatever else is on
// screen (Task C17 / Global Constraints -> Vertical datum).
import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";

/**
 * jsdom has no `ResizeObserver`, and the container-resize wiring is exactly
 * what the panel-collapse bug needed, so it is stubbed rather than skipped:
 * every instance records its callback so a test can fire it, which is the only
 * way to simulate a container that changed size without a window resize.
 */
const resizeObservers: Array<{
  callback: () => void;
  observed: Element[];
  disconnected: boolean;
}> = [];
class ResizeObserverStub {
  private entry: (typeof resizeObservers)[number];
  constructor(callback: () => void) {
    this.entry = { callback, observed: [], disconnected: false };
    resizeObservers.push(this.entry);
  }
  observe(element: Element) {
    this.entry.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

/**
 * Every suite below starts with NO basemap and NO clouds.
 *
 * A basemap is on by default in production (a black globe reads as a broken
 * viewer), but it would put an extra `addSource`/`addLayer` in front of every
 * assertion about the Google tiles. Clouds already default off; they are
 * spelled out here so the suite does not silently change meaning if that
 * default moves again. The suites that DO test them opt back in.
 */
beforeEach(() => {
  useBasemapStore.setState({ basemapId: "none" });
  useRenderDebugStore.setState({
    ...DEFAULT_RENDER_DEBUG_STATE,
    cloudsEnabled: false,
    postProcessingEnabled: true,
  });
  useAtmosphereStore.setState({ cloudCoverage: 0.3, lensFlareEnabled: true });
  addEffect.mockClear();
  updateEffect.mockClear();
  deleteEffect.mockClear();
  disposeEffectPass.mockClear();
  disposeEffectPass.mockImplementation(() => {});
  addLight.mockClear();
  resetPhotorealHandles();
  resize.mockClear();
  resizeObservers.length = 0;
});

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

/** The OGC URI spelling, as CityJSON 1.1+ writes it. `parseEpsgCode` now also
 *  accepts the v1.0 URN and a bare "EPSG:7415"; this fixture keeps the
 *  spec-recommended form. */
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
    // The real `CityModelHandle` gained this with the scene themes; the
    // viewport pushes the active theme's style on the same beat as LoD.
    setThemeStyle: vi.fn(),
    setAppearance: vi.fn(),
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
    layerHandles.length = 0;
    // Reset with them: a carried-over counter makes the minted ids depend on
    // test ORDER.
    nextLayerNumber = 0;
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
    useViewModeStore.setState({ mode: "3d" });
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

  it("fitBounds flies to caller-supplied bounds without consulting any layer", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    ref.current!.fitBounds({
      west: 4.1,
      south: 51.9,
      east: 4.6,
      north: 52.3,
      minHeight: 0,
      maxHeight: 0,
    });

    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(settleWrappedMove()).toBe(flightInProgress);
    const target = flyTo.mock.calls[0]![0] as {
      lng: number;
      lat: number;
      height: number;
    };
    // Longitude IS the box centre — the default framing offsets only along the
    // view axis, which is due north. Latitude is deliberately NOT asserted to
    // lie inside the box: `cameraForBounds` parks the camera one fit distance
    // back down a -60 degree view axis, i.e. SOUTH of and above the box, so a
    // 44 km-tall box puts the camera ~0.4 degrees south of `south`. What the
    // fit owes the caller is that it framed THEIR box: centred in longitude,
    // south of their centre, at a real height.
    expect(target.lng).toBeCloseTo(4.35, 6);
    expect(target.lat).toBeLessThan((51.9 + 52.3) / 2);
    expect(target.lat).toBeGreaterThan(51.0);
    expect(target.height).toBeGreaterThan(0);
    expect(Number.isFinite(target.height)).toBe(true);
  });

  it("fitBounds refuses a box that frames to a non-finite camera", async () => {
    // A no-view call cannot be tested deterministically (init is async and may
    // already have run), so the guard under test is the finite check — the
    // deterministic half of "bad input moves no camera".
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    ref.current!.fitBounds({
      west: Number.NaN,
      south: Number.NaN,
      east: Number.NaN,
      north: Number.NaN,
      minHeight: 0,
      maxHeight: 0,
    });

    expect(flyTo).not.toHaveBeenCalled();
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
        {
          id: "a",
          crs: CRS_URI,
          lod: "1.2",
          textureBaseUrl: "https://example.test/a",
        },
        {
          id: "b",
          crs: CRS_URI,
          lod: null,
          textureBaseUrl: "https://example.test/b",
        },
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

  it("fits WITHIN the active view mode: a 2D fit stays a plan view", async () => {
    // Adding a layer in 2D must not tilt the camera to the -60 framing pitch:
    // the mode's controller flags and disabled tilt buttons would leave the
    // user stranded in an oblique view 2D cannot recover from.
    useViewModeStore.setState({ mode: "2d" });
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalled());
    const fit = flyTo.mock.calls.at(-1)![0] as Record<string, number>;
    expect(fit.pitch).toBeCloseTo(-89.9, 6);
    expect(fit.heading).toBeCloseTo(0, 6);
    // Still framed on the layer's bounds — the mode changes the angle, not
    // the destination.
    expect(fit.lng).toBeCloseTo(4.355, 6);
  });

  // Task C26. A restore adds layers and then applies the camera it saved; the
  // fit-on-add would otherwise race that camera and, landing second, replace
  // the saved viewpoint with a framing of the layers. The browser smoke caught
  // it as two snapshots saved 65 degrees of longitude apart restoring to a
  // bit-identical camera.
  it("does not fit a layer added inside a suppressAutoFit scope, so the restored camera survives", async () => {
    const release = suppressAutoFit();
    try {
      const ref = createRef<CitySceneHandle>();
      useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
      render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);

      // The layer really was reconciled — this is a suppressed fit, not a
      // viewport that never got as far as adding anything.
      await waitFor(() =>
        expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
      );
      await ref.current!.ready;

      // The restore's own camera, applied last, exactly as App.tsx does it.
      const restored = {
        lng: 4.9,
        lat: 52.37,
        height: 2283.81,
        heading: 0.0106,
        pitch: -59.81,
        roll: 0.00007,
      };
      ref.current!.setCameraState(restored);

      expect(flyTo).not.toHaveBeenCalled();
      expect(setCamera).toHaveBeenCalledTimes(1);
      expect(setCamera).toHaveBeenCalledWith(restored);
    } finally {
      release();
    }
  });

  it("resumes fitting once the suppressAutoFit scope is released", async () => {
    const release = suppressAutoFit();
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    expect(flyTo).not.toHaveBeenCalled();

    release();

    // A layer added AFTER the restore is an ordinary user action and still
    // earns its fit — the suppression is scoped, not a permanent opt-out.
    useLayerStore.setState({
      layers: [makeLayer({ id: "a" }), makeLayer({ id: "b" })],
    });
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
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
    // The fit's flight promise (Navara 0.1.x resolves it at the END of the
    // flight) is what the streaming settle gate waits on — `void`ing it here
    // would re-open the gate two seconds after take-off, mid-flight.
    expect(settleWrappedMove()).toBe(flightInProgress);

    handleB.getBoundsGeodetic.mockClear();
    ref.current!.fitAll();
    expect(handleA.getBoundsGeodetic).toHaveBeenCalled();
    expect(handleB.getBoundsGeodetic).toHaveBeenCalled();
    expect(settleWrappedMove()).toBe(flightInProgress);

    // alignView reads the same union, so it aligns against real bounds too.
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
      expect(on.mock.calls.some((c) => c[0] === "pointermove")).toBe(true),
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
    const ev = new PointerEvent(type, { bubbles: true, clientX: x + 300 });
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
    act(() => fire("pointermove", mouse(10, 20)));

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
    act(() => fire("pointermove", mouse(10, 20)));
    const [windowLike, camera, point] = getPickRay.mock
      .calls[0]! as unknown as [
      { width: number; height: number; pixelRatio: number },
      unknown,
      { x: number; y: number },
    ];
    expect(point.x).toBe(10);
    expect(point.y).toBe(20);
    expect(windowLike).toEqual({ width: 800, height: 600, pixelRatio: 2 });
    expect(camera).toBe(
      (viewInstances[0] as { camera: { raw: unknown } }).camera.raw,
    );
  });

  it("does not re-push an unchanged hover (a repaint per pointermove otherwise)", async () => {
    const { handles } = await mountTwoLayers({ a: null, b: 12 });
    act(() => fire("pointermove", mouse(10, 20)));
    handles.b.setHighlight.mockClear();
    act(() => fire("pointermove", mouse(11, 21)));
    // Same surface: the resolved Selection is a fresh object each time, so
    // without a value comparison the store would churn and every layer would
    // repaint its vertex colors at pointer rate.
    expect(handles.b.setHighlight).not.toHaveBeenCalled();
  });

  it("selects on click and toggles on shift-click", async () => {
    await mountTwoLayers({ a: null, b: 12 });
    act(() => {
      fire("pointerdown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "b", objectId: "b-obj" },
    ]);

    act(() => {
      fire("pointerdown", mouse(10, 20));
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
      fire("pointerdown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("ignores the click that ends a camera DRAG", async () => {
    // Since Navara 0.1.1 the engine never emits `click` after a drag itself;
    // the gate is defence in depth, and a drag it saw must not commit.
    await mountTwoLayers({ a: null, b: 12 });
    act(() => {
      fire("pointerdown", mouse(100, 100));
      fire("pointermove", mouse(160, 100));
      fire("click", mouse(160, 100));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("swallows both gestures in measure mode and never commits in box-select", async () => {
    await mountTwoLayers({ a: null, b: 12 });
    useSelectionStore.setState({ toolMode: "measure" });
    act(() => {
      fire("pointermove", mouse(10, 20));
      fire("pointerdown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(useSelectionStore.getState().selections).toEqual([]);

    // box-select still hovers (the old app did) but leaves the commit to its
    // drag overlay.
    useSelectionStore.setState({ toolMode: "box-select" });
    act(() => fire("pointermove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();
    act(() => {
      fire("pointerdown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("clears the hover and the readout when the pointer leaves the canvas", async () => {
    // A DOM listener, not the engine's `pointerleave`: the engine skips the emit
    // whenever the screen ray misses the ellipsoid, so leaving the canvas
    // across a sky pixel would never be reported.
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    act(() => fire("pointermove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();

    onCursorPosition.mockClear();
    domMouse(host, "pointerleave", 0, 0);
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(onCursorPosition).toHaveBeenCalledWith(null);
  });

  it("clears hover and readout on a move the engine never reported (SKY)", async () => {
    // The engine emits nothing at all — not even pointerleave — when the screen
    // ray misses the ellipsoid, so without this the highlight and the status
    // bar freeze at their last on-globe values.
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    act(() => fire("pointermove", mouse(10, 20)));
    expect(useSelectionStore.getState().hovered).not.toBeNull();

    onCursorPosition.mockClear();
    domMouse(host, "pointermove", 400, 400); // engine stayed silent => sky
    expect(useSelectionStore.getState().hovered).toBeNull();
    expect(onCursorPosition).toHaveBeenCalledWith(null);
  });

  it("does NOT clear on a move the engine did report", async () => {
    const onCursorPosition = vi.fn();
    const { host } = await mountTwoLayers(
      { a: null, b: 12 },
      { onCursorPosition },
    );
    // Degrees, like every geodetic value the 0.1.x engine hands back.
    pickDepthPosition.mockReturnValue({ x: 4.348, y: 52.006, z: 14 });
    onCursorPosition.mockClear();
    domMouse(host, "pointermove", 10, 20, { engineSees: true });
    // Same event object reached both listeners: the cursor is on the globe.
    expect(useSelectionStore.getState().hovered).not.toBeNull();
    expect(onCursorPosition.mock.calls.at(-1)![0]).not.toBeNull();
  });

  it("arms the drag gate from the DOM too, so a gesture over sky still blocks", async () => {
    // A pointerdown over the sky is invisible to the engine; a gate armed only by
    // engine events would still be holding the previous gesture's state.
    const { host } = await mountTwoLayers({ a: null, b: 12 });
    domMouse(host, "pointerdown", 100, 100);
    domMouse(host, "pointermove", 160, 100);
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
    // Degrees straight from the engine, no conversion in between (0.0.5
    // returned radians here and the viewport converted).
    pickDepthPosition.mockReturnValue({
      x: 4.348,
      y: 52.006,
      z: 14 + 43.2,
    });

    act(() => fire("pointermove", mouse(10, 20)));
    expect(pickDepthPosition).toHaveBeenCalledWith(10, 20);
    const out = onCursorPosition.mock.calls.at(-1)![0] as [
      number,
      number,
      number,
    ];
    // RD New metres for Delft (PROJ ground truth), and the file's own z back —
    // NOT 57.2.
    expect(out[0]).toBeCloseTo(83647.09, 1);
    expect(out[1]).toBeCloseTo(446913.56, 1);
    expect(out[2]).toBeCloseTo(14, 6);
  });

  it("reports no position when the cursor is on the sky", async () => {
    const onCursorPosition = vi.fn();
    await mountTwoLayers({ a: null, b: null }, { onCursorPosition });
    pickDepthPosition.mockReturnValue(null);
    act(() => fire("pointermove", mouse(10, 20)));
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

  it("never lets the engine's pick event commit a CITY selection", async () => {
    // `PickableMeshWrapper` carries one uniform batch id per MESH (Task B1), so
    // a pick could only ever resolve a layer, not a surface. The listener does
    // exist now — geospatial layers are drawn BY the engine and have no other
    // pick path (Task 12) — but it only stashes, and a stash that names no geo
    // layer changes nothing about a city gesture.
    await mountTwoLayers({ a: null, b: 12 });
    act(() => {
      fire("pointerdown", mouse(10, 20));
      fire("featureClick", { batchId: 4, properties: {}, layerId: "layer-1" });
      fire("click", mouse(10, 20));
    });
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "b", objectId: "b-obj" },
    ]);
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("unsubscribes every pointer listener on unmount", async () => {
    const { unmount, host } = await mountTwoLayers({ a: null, b: 12 });
    act(() => fire("pointermove", mouse(10, 20)));
    const hovered = useSelectionStore.getState().hovered;
    expect(hovered).not.toBeNull();
    unmount();

    // The DOM listeners went with it: a stray move must not clear a hover the
    // component no longer owns.
    domMouse(host, "pointermove", 400, 400);
    domMouse(host, "pointerleave", 0, 0);
    expect(useSelectionStore.getState().hovered).toBe(hovered);

    const removed = off.mock.calls.map((c) => c[0]);
    for (const name of ["pointerdown", "pointermove", "click"]) {
      expect(removed).toContain(name);
    }
    expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
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
    layerHandles.length = 0;
    // Reset with them: a carried-over counter makes the minted ids depend on
    // test ORDER.
    nextLayerNumber = 0;
    deleteSource.mockClear();
    deleteLayer.mockClear();
    useTilesStore.setState({ enabled: true });
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
    useTilesStore.setState({ enabled: true });
  });

  it("registers ONE 3d-tiles source and layer with the key in the URL, after init", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test key&1");
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "3d-tiles")).toBe(1));

    expect(countOfType(addSource, "3d-tiles")).toBe(1);
    const si = indexOfType(addSource, "3d-tiles");
    const li = indexOfType(addLayer, "3d-tiles");
    expect(addSource.mock.calls[si]![0]).toEqual({
      type: "3d-tiles",
      url: "https://tile.googleapis.com/v1/3dtiles/root.json?key=test%20key%261",
    });
    // The layer references the SOURCE HANDLE `addSource` returned — an
    // inlined URL or a guessed id would silently render nothing.
    expect(addLayer.mock.calls[li]![0]).toEqual({
      type: "3d-tiles",
      source: addSource.mock.results[si]!.value,
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
    expect(addSource.mock.invocationCallOrder[si]!).toBeGreaterThan(
      init.mock.invocationCallOrder[0]!,
    );
    expect(addSource.mock.invocationCallOrder[si]!).toBeLessThan(
      addLayer.mock.invocationCallOrder[li]!,
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
    // Terrain is unconditional, so "nothing" means no TILES of their own.
    expect(countOfType(addSource, "3d-tiles")).toBe(0);
    expect(countOfType(addLayer, "3d-tiles")).toBe(0);

    // The geoid credit is NOT conditional: every georeferenced layer samples
    // that service, so it is shown even with an empty, tile-free viewport.
    const overlay = container.querySelector(".attribution-overlay");
    expect(overlay?.textContent).not.toMatch(/Google/);
    for (const line of GEOID_ATTRIBUTION) {
      expect(overlay?.textContent).toContain(line);
    }
  });

  // -------------------------------------------------------------------------
  // The sidebar / advanced-settings toggle (`tilesStore.enabled`), wired to the
  // engine in Task C21. Between C17 and C21 the flag was read only by the two
  // toggle UIs: clicking the eye changed an icon and nothing else.
  // -------------------------------------------------------------------------

  it("adds nothing while the toggle is off, even with a key configured", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    useTilesStore.setState({ enabled: false });
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    // Terrain is unconditional, so "nothing" means no TILES of their own.
    expect(countOfType(addSource, "3d-tiles")).toBe(0);
    expect(countOfType(addLayer, "3d-tiles")).toBe(0);
    expect(
      container.querySelector(".attribution-overlay")?.textContent,
    ).not.toMatch(/Google/);
  });

  it("removes the layer AND its source, layer first, when the toggle goes off", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "3d-tiles")).toBe(1));

    act(() => useTilesStore.getState().setEnabled(false));

    await waitFor(() => expect(deleteLayer).toHaveBeenCalledTimes(1));
    expect(deleteSource).toHaveBeenCalledTimes(1);
    // `Source.delete()` removes nothing while a layer still references the
    // source, so the reverse order would leak it.
    expect(deleteLayer.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteSource.mock.invocationCallOrder[0]!,
    );
    // Nothing is on screen any more, so nobody is credited for it.
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).not.toMatch(/Google/),
    );
  });

  it("re-adds a fresh source and layer when the toggle comes back on", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "3d-tiles")).toBe(1));

    act(() => useTilesStore.getState().setEnabled(false));
    await waitFor(() => expect(deleteLayer).toHaveBeenCalledTimes(1));
    act(() => useTilesStore.getState().setEnabled(true));

    await waitFor(() => expect(countOfType(addLayer, "3d-tiles")).toBe(2));
    // A NEW source, not the deleted one: `Source.delete()` disposed the first.
    expect(countOfType(addSource, "3d-tiles")).toBe(2);
    const reSi = lastIndexOfType(addSource, "3d-tiles");
    const reLi = lastIndexOfType(addLayer, "3d-tiles");
    expect(addLayer.mock.calls[reLi]![0]).toMatchObject({
      source: addSource.mock.results[reSi]!.value,
    });
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toMatch(/Google/),
    );
  });

  it("does not delete tiles handles through a view the engine already disposed", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "3d-tiles")).toBe(1));

    unmount();

    // `session.dispose()` already tore the whole view down; calling `delete()`
    // on handles belonging to it would be an operation on a dead engine.
    expect(deleteLayer).not.toHaveBeenCalled();
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it("keeps the viewer alive when the engine refuses the tiles layer", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    failAddLayerOnce("3d-tiles");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CitySceneHandle>();
    const { container } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    // A backdrop that fails to load must not take the engine — or `ready` —
    // down with it, and must not claim a Google credit either.
    await expect(ref.current!.ready).resolves.toBeUndefined();
    // The tiles are attached from an effect since Task C21 (they follow
    // `tilesStore.enabled`), so the failure lands a render AFTER `ready`
    // settles rather than inside the init sequence.
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(container.querySelector(".navara-viewport__error")).toBeNull();
    expect(
      container.querySelector(".attribution-overlay")?.textContent,
    ).not.toMatch(/Google/);
    // ...and the source it did accept is taken back out rather than leaked.
    await waitFor(() => expect(deleteSource).toHaveBeenCalledTimes(1));
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The raster basemap (the fix for "the globe is black").
//
// `DefaultPlugin.addDefaultPhotorealScene()` adds sky, stars, a sun light and
// the post chain — and no imagery at all — so without a `raster-tile` source
// plus a `raster` layer there is literally nothing draped on the ellipsoid.
// ---------------------------------------------------------------------------
describe("NavaraViewport basemap", () => {
  beforeEach(() => {
    addSource.mockClear();
    addLayer.mockClear();
    layerHandles.length = 0;
    // Reset with them: a carried-over counter makes the minted ids depend on
    // test ORDER.
    nextLayerNumber = 0;
    deleteSource.mockClear();
    deleteLayer.mockClear();
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    // The basemap suite owns `addSource`/`addLayer`, so the Google tiles stay
    // out of the way (no key configured is the same as the toggle being off).
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    useTilesStore.setState({ enabled: true });
  });

  it("drapes OpenStreetMap by default, as a raster-tile source plus a raster layer", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));

    const si = indexOfType(addSource, "raster-tile");
    const li = indexOfType(addLayer, "raster");
    expect(addSource.mock.calls[si]![0]).toEqual({
      type: "raster-tile",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxZoom: 19,
    });
    // The layer references the SOURCE HANDLE, not a guessed id.
    expect(addLayer.mock.calls[li]![0]).toEqual({
      type: "raster",
      source: addSource.mock.results[si]!.value,
    });
    // After `init()` — the engine refuses a source before it — and after the
    // default photoreal scene the imagery is lit by.
    expect(addSource.mock.invocationCallOrder[si]!).toBeGreaterThan(
      init.mock.invocationCallOrder[0]!,
    );
    expect(addSource.mock.invocationCallOrder[si]!).toBeLessThan(
      addLayer.mock.invocationCallOrder[li]!,
    );
    // The terrain the basemap is draped over was added FIRST — render order
    // is add order, so the reverse would hide the relief under the imagery.
    expect(
      addLayer.mock.invocationCallOrder[indexOfType(addLayer, "terrain")]!,
    ).toBeLessThan(addLayer.mock.invocationCallOrder[li]!);
  });

  it("adds nothing for the None option", async () => {
    useBasemapStore.setState({ basemapId: "none" });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    // Terrain is unconditional, so "nothing" means no RASTER of its own.
    expect(countOfType(addSource, "raster-tile")).toBe(0);
    expect(countOfType(addLayer, "raster")).toBe(0);
  });

  it("swaps the layer and its source, layer first, when the option changes", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));

    act(() => useBasemapStore.getState().setBasemapId("esri-imagery"));

    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(2));
    expect(deleteLayer).toHaveBeenCalledTimes(1);
    expect(deleteSource).toHaveBeenCalledTimes(1);
    // `Source.delete()` is a no-op while a layer still references it.
    expect(deleteLayer.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteSource.mock.invocationCallOrder[0]!,
    );
    const swapped = lastIndexOfType(addSource, "raster-tile");
    expect(addSource.mock.calls[swapped]![0]).toMatchObject({
      url: BASEMAPS.find((b) => b.id === "esri-imagery")!.source!.url,
    });
  });

  it("credits the ACTIVE basemap, and only it", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toContain("© OpenStreetMap contributors"),
    );

    act(() => useBasemapStore.getState().setBasemapId("esri-imagery"));
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toContain("Esri, Vantor, Earthstar Geographics"),
    );

    act(() => useBasemapStore.getState().setBasemapId("carto-positron"));
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toContain("© CARTO"),
    );
    expect(
      container.querySelector(".attribution-overlay")?.textContent,
    ).not.toContain("Esri");
  });

  it("credits nobody for imagery the engine refused", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    failAddLayerOnce("raster");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CitySceneHandle>();
    const { container } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    // A backdrop that fails must not take the engine — or `ready` — down.
    await expect(ref.current!.ready).resolves.toBeUndefined();
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(container.querySelector(".navara-viewport__error")).toBeNull();
    // The geoid lines happen to name OpenStreetMap too (ODbL), so the honest
    // assertion is that no BASEMAP line was added on top of them. Terrain is
    // credited because terrain really is in the scene — only the imagery
    // failed.
    expect(
      container.querySelectorAll(".attribution-overlay span"),
    ).toHaveLength(GEOID_ATTRIBUTION.length + TERRAIN_ATTRIBUTION.length);
    errors.mockRestore();
  });

  it("deletes the source when the LAYER is what the engine refused", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    failAddLayerOnce("raster");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NavaraViewport onTriangleCount={() => {}} />);
    // Wait for the basemap's OWN attempt, not merely for the first
    // console.error of the run — the terrain effect now runs first, so a
    // generic error gate could fire before the basemap had tried anything.
    await waitFor(() => expect(countOfType(addSource, "raster-tile")).toBe(1));
    // The source registered fine and nothing else holds a reference to it, so
    // returning without deleting it would leak it into the engine for the rest
    // of the session — once per failed attempt.
    await waitFor(() => expect(deleteSource).toHaveBeenCalledTimes(1));
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("resolves the DEM decoder marker and merges the heatmap layer block", async () => {
    // The elevation heatmap is the one option whose descriptor is not what the
    // catalogue holds. `basemaps.ts` cannot import `TERRARIUM_ELEVATION_DECODER`
    // (it is an engine export, and that module is unit-tested under Node), so it
    // carries the string `"terrarium"` and THIS seam swaps in the real decoder —
    // and the layer needs the `elevationHeatmap` ramp merged in, or the engine
    // draws raw DEM bytes as a picture instead of a heatmap.
    useBasemapStore.setState({ basemapId: "elevation-heatmap" });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addSource, "raster-dem")).toBe(1));

    const si = indexOfType(addSource, "raster-dem");
    expect(addSource.mock.calls[si]![0]).toEqual({
      type: "raster-dem",
      url: "https://terrain.reearth.land/terrarium/elevation/{z}/{x}/{y}.png",
      // The engine's own decoder object, never the marker string.
      elevationDecoder: { decoder: "terrarium" },
      tileSize: 512,
      maxZoom: 15,
    });
    expect(TERRARIUM_ELEVATION_DECODER).toHaveBeenCalled();

    const li = lastIndexOfType(addLayer, "raster");
    expect(addLayer.mock.calls[li]![0]).toEqual({
      type: "raster",
      elevationHeatmap: {
        maxHeight: 3200,
        minHeight: 0,
        logarithmic: true,
        logBoundary: 1000,
      },
      source: addSource.mock.results[si]!.value,
    });
  });

  it("adds no heatmap block for an imagery basemap", async () => {
    // `addBasemap` spreads `option.layer`, which is absent everywhere else —
    // an imagery layer must reach the engine as the bare pair it always was.
    useBasemapStore.setState({ basemapId: "esri-imagery" });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));
    const li = indexOfType(addLayer, "raster");
    expect(addLayer.mock.calls[li]![0]).toEqual({
      type: "raster",
      source:
        addSource.mock.results[indexOfType(addSource, "raster-tile")]!.value,
    });
  });

  it("credits the DEM's provider while the heatmap is draped", async () => {
    useBasemapStore.setState({ basemapId: "elevation-heatmap" });
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(
        container.querySelector(".attribution-overlay")?.textContent,
      ).toContain("Elevation: © Re:Earth Terrain"),
    );
    expect(
      container.querySelector(".attribution-overlay")?.textContent,
    ).toContain("© Mapterhorn, CC BY 4.0");
  });

  it("does not delete basemap handles through a view the engine already disposed", async () => {
    useBasemapStore.setState({ basemapId: "osm" });
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));

    unmount();

    expect(deleteLayer).not.toHaveBeenCalled();
    expect(deleteSource).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The wheel. The engine's own listener forwards the delta to the Rust core
// without `preventDefault()`, so the page scrolled while the camera zoomed.
// ---------------------------------------------------------------------------
describe("NavaraViewport wheel", () => {
  beforeEach(() => {
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    useTilesStore.setState({ enabled: true });
  });

  it("cancels the page scroll a wheel over the viewport would otherwise cause", () => {
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    const host = container.querySelector(".navara-viewport__canvas")!;
    const wheel = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    host.dispatchEvent(wheel);
    // The engine's own listener (on its canvas, inside this host) has already
    // consumed the delta by the time this fires, so the zoom is unaffected —
    // only the browser's default scroll is cancelled.
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("cancels a touch drag over the viewport too", () => {
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    const host = container.querySelector(".navara-viewport__canvas")!;
    const touch = new Event("touchmove", { bubbles: true, cancelable: true });
    host.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clouds. `addDefaultPhotorealScene()` registers the `"clouds"` descriptor but
// never adds the effect, so the advanced-settings toggle and coverage slider
// were both inert until the viewport started adding it itself.
// ---------------------------------------------------------------------------
describe("NavaraViewport clouds", () => {
  beforeEach(() => {
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    useTilesStore.setState({ enabled: true });
  });

  it("adds the clouds effect with the store's coverage once the engine is up", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: true });
    useAtmosphereStore.setState({ cloudCoverage: 0.42 });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addEffect).toHaveBeenCalledTimes(1));
    expect(addEffect.mock.calls[0]![0]).toEqual({
      clouds: { coverage: 0.42 },
    });
    // After init: the engine only accepts descriptors on a live view, and the
    // `"clouds"` key is registered by `DefaultPlugin.init()`.
    expect(addEffect.mock.invocationCallOrder[0]!).toBeGreaterThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("pushes coverage to the live pass instead of rebuilding it", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: true });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addEffect).toHaveBeenCalledTimes(1));

    act(() => useAtmosphereStore.getState().setCoverage(0.8));

    await waitFor(() =>
      expect(updateEffect).toHaveBeenCalledWith({ clouds: { coverage: 0.8 } }),
    );
    // Rebuilding the pass per slider step would re-load its 3D textures.
    expect(addEffect).toHaveBeenCalledTimes(1);
    expect(deleteEffect).not.toHaveBeenCalled();
  });

  it("adds nothing while the toggle is off, and removes the pass when it goes off", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: false });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addEffect).not.toHaveBeenCalled();

    act(() => useRenderDebugStore.getState().setCloudsEnabled(true));
    await waitFor(() => expect(addEffect).toHaveBeenCalledTimes(1));

    act(() => useRenderDebugStore.getState().setCloudsEnabled(false));
    await waitFor(() => expect(deleteEffect).toHaveBeenCalledTimes(1));
  });

  // ENGINE-BUG WORKAROUND, pinned because it is invisible from the store: the
  // clouds composite through the AERIAL-PERSPECTIVE pass
  // (`Clouds` publishes `atmosphere.overlay`; AP samples it), and
  // `EffectDesc.onDestroy()` removes the pass from the composer WITHOUT
  // disposing it — so `handle.delete()` alone leaves the AP pass compositing the
  // clouds' last frame and the toggle reads as inert. `Clouds.dispose()` is what
  // clears the overlay, so the viewport calls it itself, BEFORE the delete.
  it("disposes the clouds pass before deleting its handle, so the toggle bites", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: true });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addEffect).toHaveBeenCalledTimes(1));
    expect(disposeEffectPass).not.toHaveBeenCalled();

    act(() => useRenderDebugStore.getState().setCloudsEnabled(false));

    await waitFor(() => expect(disposeEffectPass).toHaveBeenCalledTimes(1));
    expect(deleteEffect).toHaveBeenCalledTimes(1);
    expect(disposeEffectPass.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteEffect.mock.invocationCallOrder[0]!,
    );
  });

  it("still deletes the handle when disposing the pass throws", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: true });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(addEffect).toHaveBeenCalledTimes(1));
    disposeEffectPass.mockImplementationOnce(() => {
      throw new Error("pass already disposed");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => useRenderDebugStore.getState().setCloudsEnabled(false));

    await waitFor(() => expect(deleteEffect).toHaveBeenCalledTimes(1));
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("adds no clouds while post-processing is off (there is no pass chain to join)", async () => {
    useRenderDebugStore.setState({
      cloudsEnabled: true,
      postProcessingEnabled: false,
    });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addEffect).not.toHaveBeenCalled();
  });

  it("keeps the viewer alive when the engine refuses the clouds pass", async () => {
    useRenderDebugStore.setState({ cloudsEnabled: true });
    addEffect.mockImplementationOnce(() => {
      throw new Error("no cloud textures");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CitySceneHandle>();
    const { container } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(container.querySelector(".navara-viewport__error")).toBeNull();
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Render settings -> the engine.
//
// The regression these pin is "the Advanced Settings toggles do nothing": the
// panel wrote booleans into `renderDebugStore` and NOTHING read them. Every
// assertion below therefore reads ENGINE state (a handle's `visible`, a
// `sun.update()` call, `view.toneMappingExposure`) — never the store, which is
// what the old tests checked and why they passed while the feature was dead.
// ---------------------------------------------------------------------------
describe("NavaraViewport render settings", () => {
  beforeEach(() => {
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    useTilesStore.setState({ enabled: true });
  });

  /** The live view the component built — the object the effects mutate. */
  function currentView() {
    return viewInstances.at(-1) as { toneMappingExposure: number };
  }

  it("sets Navara's own tone-mapping exposure instead of three's default of 1", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(currentView().toneMappingExposure).toBe(DEFAULT_EXPOSURE),
    );
    expect(DEFAULT_EXPOSURE).toBeGreaterThan(1);
  });

  it("follows the exposure slider", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());

    act(() => useRenderDebugStore.getState().setExposure(3.5));
    await waitFor(() => expect(currentView().toneMappingExposure).toBe(3.5));
  });

  it("captures the photoreal scene handles and toggles the post chain through them", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(defaultPluginInstance.addDefaultPhotorealScene).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(photorealHandles.aerialPerspective.visible).toBe(true),
    );

    act(() =>
      useRenderDebugStore.getState().setAerialPerspectiveEnabled(false),
    );
    await waitFor(() =>
      expect(photorealHandles.aerialPerspective.visible).toBe(false),
    );
    // Independent controls: the lens flare is untouched by the aerial toggle.
    expect(photorealHandles.lensFlare.visible).toBe(true);

    act(() => useAtmosphereStore.getState().setLensFlareEnabled(false));
    await waitFor(() => expect(photorealHandles.lensFlare.visible).toBe(false));
  });

  it("takes the whole post chain out when post-processing goes off, but keeps tone mapping", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(photorealHandles.antialiasing.visible).toBe(true),
    );

    act(() => useRenderDebugStore.getState().setPostProcessingEnabled(false));

    await waitFor(() =>
      expect(photorealHandles.antialiasing.visible).toBe(false),
    );
    expect(photorealHandles.aerialPerspective.visible).toBe(false);
    expect(photorealHandles.lensFlare.visible).toBe(false);
    // Hiding the tone mapper would blow the frame to white, not darken it —
    // it stays in the chain whatever the master switch says.
    expect(photorealHandles.toneMapping.visible).toBe(true);
  });

  it("drives sun shadows through the sun light's own config", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(photorealHandles.sun.update).toHaveBeenCalledWith({
        sun: { castShadow: true },
      }),
    );

    act(() => useRenderDebugStore.getState().setSunShadowsEnabled(false));
    await waitFor(() =>
      expect(photorealHandles.sun.update).toHaveBeenCalledWith({
        sun: { castShadow: false },
      }),
    );
    // Never `visible`: the sun is the scene's only key light.
    expect(photorealHandles.sun.visible).toBe(true);
  });

  // THE lighting model. The aerial-perspective pass defaults to
  // `irradiance: false` — it only hazes whatever the scene lights produced.
  // Turning it on sets `sunLight = skyLight = true` on the pass, so the physical
  // atmosphere lights the g-buffer albedo directly. That is the calibration
  // `DEFAULT_EXPOSURE = 10` belongs to, and the reason the city meshes are unlit
  // (`MeshBasicMaterial`, @cityjson/navara-cityjson). Without this push the
  // whole scene is lit twice and clips to white.
  it("switches the aerial-perspective pass into irradiance mode at startup", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(photorealHandles.aerialPerspective.update).toHaveBeenCalledWith({
        // `useNormalBuffer: true` is only safe because the TERRAIN layer feeds
        // the MRT normal attachment (`requestVertexNormals`). Without terrain
        // the globe writes no normals, a raster basemap turns the attachment
        // to half-float NaN, and the frame renders black — which is why this
        // pair is asserted together. See `enableAtmosphericLighting`.
        aerialPerspective: { irradiance: true, useNormalBuffer: true },
      }),
    );
    // The other half of the calibration since Navara 0.1.0: `view.lit = false`
    // makes every ENGINE-drawn material (terrain, basemap, tiles) output plain
    // albedo too, so the irradiance pass is the only thing lighting the frame.
    // The docs pair the two explicitly; without it the ground is lit twice.
    expect((viewInstances[0] as { lit?: boolean }).lit).toBe(false);
  });

  // The scene-lights calibration is GONE, ambient fill and all. A regression
  // that adds one back is a double-exposed frame, not a brighter one.
  it("adds no scene lights of its own", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(photorealHandles.aerialPerspective.update).toHaveBeenCalled(),
    );
    expect(addLight).not.toHaveBeenCalled();
  });

  // The other half of capturing the photoreal handles: they die with the view,
  // and the cleanup drops them. Without that, a store change after an unmount
  // would push `visible` through a descriptor whose scene has been disposed —
  // and under StrictMode, through the PREVIOUS engine's handles over a live
  // view.
  it("stops pushing settings once the engine is gone", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() =>
      expect(photorealHandles.sun.update).toHaveBeenCalledWith({
        sun: { castShadow: true },
      }),
    );
    const view = currentView();

    unmount();
    // What must NOT happen is a fresh push afterwards.
    photorealHandles.sun.update.mockClear();
    photorealHandles.aerialPerspective.update.mockClear();
    const exposureBefore = view.toneMappingExposure;

    act(() => {
      useRenderDebugStore.getState().setSunShadowsEnabled(false);
      useRenderDebugStore.getState().setAerialPerspectiveEnabled(false);
      useRenderDebugStore.getState().setExposure(2);
    });

    expect(photorealHandles.sun.update).not.toHaveBeenCalled();
    expect(photorealHandles.aerialPerspective.update).not.toHaveBeenCalled();
    expect(view.toneMappingExposure).toBe(exposureBefore);
    // The handles themselves are untouched, which is the visible symptom the
    // ref-nulling prevents.
    expect(photorealHandles.aerialPerspective.visible).toBe(true);
  });

  it("keeps the viewer alive when the engine refuses a settings push", async () => {
    photorealHandles.aerialPerspective.update.mockImplementationOnce(() => {
      throw new Error("this build has no irradiance mode");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CitySceneHandle>();
    const { container } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(container.querySelector(".navara-viewport__error")).toBeNull();
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Container resize. The engine's auto-resize listens on `window` ONLY, so
// collapsing a side panel left the canvas at its old width.
// ---------------------------------------------------------------------------
describe("NavaraViewport container resize", () => {
  beforeEach(() => {
    init.mockClear();
    init.mockImplementation(async () => {});
    listeners.clear();
    viewInstances.length = 0;
    defaultPluginThrows = null;
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(() => {
    cleanup();
    useTilesStore.setState({ enabled: true });
  });

  it("observes the CONTAINER and resizes the engine at its pixel ratio", async () => {
    const { container } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(resizeObservers.length).toBe(1));
    const host = container.querySelector(".navara-viewport__canvas")!;
    expect(resizeObservers[0]!.observed).toContain(host);

    Object.defineProperty(host, "clientWidth", {
      value: 640,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 480,
      configurable: true,
    });
    act(() => resizeObservers[0]!.callback());

    // `view.pixelRatio`, not an omitted argument: `resize()` passes `1` to the
    // WASM core when the ratio is missing, halving the effective resolution on
    // a HiDPI display the first time a panel is toggled.
    expect(resize).toHaveBeenCalledWith(640, 480, 2);
  });

  it("ignores a zero-sized container instead of resizing to a degenerate aspect", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(resizeObservers.length).toBe(1));
    // jsdom reports 0×0 for an unlaid-out element, which is also what a fully
    // collapsed shell reports.
    act(() => resizeObservers[0]!.callback());
    expect(resize).not.toHaveBeenCalled();
  });

  it("disconnects the observer when the viewport goes away", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(resizeObservers.length).toBe(1));
    unmount();
    expect(resizeObservers[0]!.disconnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Geospatial layers (section 4). The reconciliation itself is unit-tested in
// `geoLayerSync.test.ts` against a fake view; what is checked HERE is the
// wiring only — that the store reaches the engine at all, in the right order,
// and that the pairs are taken back out when the viewport goes away.
// ---------------------------------------------------------------------------
describe("NavaraViewport geospatial layers", () => {
  beforeEach(() => {
    addSource.mockClear();
    addLayer.mockClear();
    layerHandles.length = 0;
    // Reset with them: a carried-over counter makes the minted ids depend on
    // test ORDER.
    nextLayerNumber = 0;
    deleteSource.mockClear();
    deleteLayer.mockClear();
    listeners.clear();
    on.mockClear();
    off.mockClear();
    viewInstances.length = 0;
    cityPluginInstance.addCityModel.mockReset();
    cityPluginInstance.addCityModel.mockImplementation(
      (_model: unknown, opts: { id: string }) => makeHandle(opts.id),
    );
    // This suite owns `addSource`/`addLayer`: no backdrop of its own.
    useTilesStore.setState({ enabled: false });
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useGeoLayerStore.setState({ layers: [] });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
      toolMode: "select",
      mode: "object",
    });
  });

  afterEach(() => {
    cleanup();
    useGeoLayerStore.setState({ layers: [] });
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
    });
    useTilesStore.setState({ enabled: true });
  });

  function addXyz(): string {
    return useGeoLayerStore.getState().addGeoLayer({
      name: "overlay",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
  }

  it("adds a source+layer pair for a layer already in the store", async () => {
    addXyz();
    render(<NavaraViewport onTriangleCount={() => {}} />);

    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));
    const si = indexOfType(addSource, "raster-tile");
    expect(addSource.mock.calls[si]![0]).toEqual({
      type: "raster-tile",
      url: "https://tile.example/{z}/{x}/{y}.png",
    });
    // ON TOP of the terrain: render order is add order, and imported data
    // belongs over the ground rather than under it.
    expect(
      addLayer.mock.invocationCallOrder[indexOfType(addLayer, "terrain")]!,
    ).toBeLessThan(
      addLayer.mock.invocationCallOrder[indexOfType(addLayer, "raster")]!,
    );
  });

  it("adds a pair for a layer added after the engine is up", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(countOfType(addLayer, "raster")).toBe(0);

    act(() => {
      addXyz();
    });

    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));
  });

  it("removes the pair layer-first when the record leaves the store", async () => {
    const id = addXyz();
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));

    act(() => useGeoLayerStore.getState().removeGeoLayer(id));

    await waitFor(() => expect(deleteLayer).toHaveBeenCalledTimes(1));
    expect(deleteSource).toHaveBeenCalledTimes(1);
    // `Source.delete()` removes nothing while a layer still references it.
    expect(deleteLayer.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteSource.mock.invocationCallOrder[0]!,
    );
  });

  it("takes every pair back out when the viewport unmounts", async () => {
    addXyz();
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "raster")).toBe(1));

    unmount();

    // The store KEEPS the record — it is the user's layer, not the engine's —
    // so the next mount rebuilds the pair from it.
    expect(deleteLayer).toHaveBeenCalledTimes(1);
    expect(useGeoLayerStore.getState().layers).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Task 12: click-selecting a geo feature.
  //
  // Geo layers are drawn BY the engine, so their picks arrive through the
  // engine's own `pick` event rather than the own-raycast path the city
  // plugins use. The viewport stashes the pick and asks for it on the next
  // `click`; the decisions themselves are `geoSelectionFromStash` (pure) and
  // `geoLayerIdForEngineLayerId` (the live registry's lookup), both unit-tested
  // elsewhere. What is checked here is the wiring.
  // -------------------------------------------------------------------------

  function addGeoJson(name = "parks"): string {
    return useGeoLayerStore.getState().addGeoLayer({
      name,
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
  }

  /** Mount with one GeoJSON layer up, and answer with its store id plus the
   *  engine layer handle the pair was built on. */
  async function mountGeoJson(): Promise<{
    geoLayerId: string;
    handle: MockLayerHandle;
    unmount: () => void;
  }> {
    const geoLayerId = addGeoJson();
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(countOfType(addLayer, "vector")).toBe(1));
    return { geoLayerId, handle: lastHandleOfType("vector")!, unmount };
  }

  /** The gesture as the engine really delivers it: pointerdown, then the pick
   *  (emitted on a clean mouseup), then the DOM click. */
  function pickThenClick(info: unknown, patch: Record<string, unknown> = {}) {
    act(() => {
      fire("pointerdown", mouse(10, 20));
      fire("featureClick", info);
      fire("click", mouse(10, 20, patch));
    });
  }

  it("subscribes the engine's pick event and unsubscribes it on teardown", async () => {
    const { unmount } = await mountGeoJson();
    const subscribed = on.mock.calls.filter((c) => c[0] === "featureClick");
    // ONE handler, not one per layer edit: the hosting effect re-runs on every
    // city-layer change, so a missing `off` would accumulate them.
    expect(subscribed).toHaveLength(1);

    unmount();

    expect(off.mock.calls).toContainEqual(["featureClick", subscribed[0]![1]]);
  });

  it("selects the picked geo feature when the own-raycast misses", async () => {
    const { geoLayerId, handle } = await mountGeoJson();

    pickThenClick({
      batchId: 7,
      properties: { name: "Park" },
      layerId: handle.id,
    });

    expect(useSelectionStore.getState().geoSelection).toEqual({
      geoLayerId,
      batchId: 7,
      properties: { name: "Park" },
    });
  });

  it("clears as before when the pick names a layer that is not the user's", async () => {
    await mountGeoJson();
    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "a", objectId: "a-obj" }],
    });
    // The engine picks everything it DRAWS, the global terrain included.
    const terrain = lastHandleOfType("terrain")!;

    pickThenClick({ batchId: 3, properties: {}, layerId: terrain.id });

    expect(useSelectionStore.getState().geoSelection).toBeNull();
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("lets a city hit win over a geo pick on the same gesture", async () => {
    useLayerStore.setState({ layers: [makeLayer({ id: "a" })] });
    const { handle } = await mountGeoJson();
    await waitFor(() =>
      expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
    );
    const cityHandle = cityPluginInstance.addCityModel.mock.results[0]!.value;
    cityHandle.resolveRaycast.mockReturnValue({
      objectIndex: 0,
      surfaceIndex: 7,
      distance: 12,
    });

    pickThenClick({
      batchId: 7,
      properties: { name: "Park" },
      layerId: handle.id,
    });

    // The store's own invariant does the clearing; what matters here is that
    // the geo arm was never reached.
    expect(useSelectionStore.getState().selections).toEqual([
      { kind: "object", layerId: "a", objectId: "a-obj" },
    ]);
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("consumes the stash, so the NEXT click clears rather than re-selects", async () => {
    const { handle } = await mountGeoJson();
    pickThenClick({ batchId: 7, properties: {}, layerId: handle.id });
    expect(useSelectionStore.getState().geoSelection).not.toBeNull();

    act(() => {
      fire("pointerdown", mouse(10, 20));
      fire("click", mouse(10, 20));
    });

    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("paints the picked feature through the layer's feature evaluator", async () => {
    const { handle } = await mountGeoJson();
    // The engine creates a feature set per material and hands its evaluator to
    // the `featureCreated` subscription `geoLayerSync` installed on the pair.
    const evaluate = vi.fn();
    const created = handle.listeners.get("featureCreated") ?? [];
    expect(created.length).toBeGreaterThan(0);
    act(() => {
      for (const cb of created) {
        (cb as (p: unknown) => void)({
          featureSetId: "fs-1",
          evaluator: { evaluate },
        });
      }
    });

    pickThenClick({ batchId: 7, properties: {}, layerId: handle.id });

    // The selection-store subscription is what drives this — nothing in the
    // click path touches the engine directly.
    await waitFor(() => expect(evaluate).toHaveBeenCalled());
    expect(handle.forceUpdate).toHaveBeenCalled();
    const evaluator = evaluate.mock.calls[0]![0] as (info: {
      batchId: number;
    }) => { color: { hex?: number } };
    expect(evaluator({ batchId: 7 }).color.hex).toBe(GEO_HIGHLIGHT_COLOR_HEX);
    // An omitted key would leave a previous override in place, so a feature
    // that is NOT selected is told the layer's own colour explicitly.
    expect(evaluator({ batchId: 8 }).color.hex).not.toBe(
      GEO_HIGHLIGHT_COLOR_HEX,
    );
  });

  it("re-highlights a pair REBUILT while the selection stood", async () => {
    const { handle } = await mountGeoJson();
    pickThenClick({ batchId: 7, properties: {}, layerId: handle.id });

    // A new document replaces `config`, which rebuilds the pair — and a fresh
    // pair starts with no highlight and no colour factory of its own.
    act(() =>
      useGeoLayerStore
        .getState()
        .relinkGeoJsonLayer(useGeoLayerStore.getState().layers[0]!.id, {
          type: "FeatureCollection",
          features: [],
        }),
    );
    await waitFor(() => expect(countOfType(addLayer, "vector")).toBe(2));
    const rebuilt = lastHandleOfType("vector")!;
    expect(rebuilt).not.toBe(handle);

    const evaluate = vi.fn();
    act(() => {
      for (const cb of rebuilt.listeners.get("featureCreated") ?? []) {
        (cb as (p: unknown) => void)({
          featureSetId: "fs-1",
          evaluator: { evaluate },
        });
      }
    });

    expect(evaluate).toHaveBeenCalled();
    const evaluator = evaluate.mock.calls[0]![0] as (info: {
      batchId: number;
    }) => { color: { hex?: number } };
    expect(evaluator({ batchId: 7 }).color.hex).toBe(GEO_HIGHLIGHT_COLOR_HEX);
  });
});
